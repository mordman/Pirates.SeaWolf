import * as THREE from 'three';
import { InputManager } from './core/input';
import { EventBus, GameEvents } from './core/events';
import { clamp } from './core/rng';
import { Water } from './water/Water';
import { SEA, waterHeightAt } from './water/waves';
import { Ship } from './ship/Ship';
import { CameraRig, CAMERA_LABEL, CameraMode } from './camera/cameraRig';
import { CombatSystem, AMMO_INFO, AmmoType } from './combat/combat';
import { World, heightAt } from './world/world';
import { Particles } from './fx/particles';
import { SkySystem } from './fx/sky';
import { AudioSys } from './audio/audio';
import { AIShip } from './ai/ai';

// ============================================================
// Game: интеграция всех систем. Фиксированный шаг физики 60 Гц,
// floating origin, события, HUD-снимок для React.
// ============================================================

export interface HudMessage { id: number; text: string; }

export interface HudState {
  started: boolean;
  dead: boolean;
  speed: number;         // узлы
  headingDeg: number;
  windFromDeg: number;   // компас, откуда
  windSpeed: number;     // м/с
  windRelDeg: number;    // относительно курса
  sailLevel: number;
  rudder: number;
  hullPct: number;
  sailPct: number;
  crew: number; maxCrew: number;
  waterPct: number;
  onFire: boolean;
  anchored: boolean;
  grounded: boolean;
  sinking: boolean;
  ammoType: AmmoType;
  ammoCounts: Record<string, number>;
  planks: number;
  gold: number;
  cargo: Record<string, number>;
  aiming: boolean;
  aimSide: string;
  aimRange: number;
  gunsReadyPct: number;
  targetName: string | null;
  cameraLabel: string;
  clock: string;
  seaState: number;
  repairAction: string | null;
  canDock: boolean;
  canBoard: boolean;
  boardedName: string | null;
  docked: boolean;
  messages: HudMessage[];
  mapIslands: { x: number; z: number; r: number; name: string; discovered: boolean }[];
  mapShips: { x: number; z: number; kind: string; surrendered: boolean }[];
  mapPlayer: { x: number; z: number; h: number };
  fps: number;
  dayF: number;
}

const CARGO_PRICES: Record<string, number> = { sugar: 24, rum: 46, timber: 9 };
const CARGO_NAMES: Record<string, string> = { sugar: 'Сахар', rum: 'Ром', timber: 'Древесина' };

export class Game {
  bus = new EventBus();
  input: InputManager;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  water: Water;
  sky: SkySystem;
  world: World;
  particles = new Particles(1400);
  audio = new AudioSys();

  player!: Ship;
  aiShips: AIShip[] = [];
  combat!: CombatSystem;

  worldGroup = new THREE.Group();
  private shift = new THREE.Vector3();     // worldGroup.position
  private negShift = new THREE.Vector3();  // для воды

  wind = { from: 0.7, speed: 7.5 };
  private windTargetSpeed = 7.5;
  private windTimer = 12;
  private gustT = 0;

  docked = false;
  dead = false;
  started = false;
  private msgId = 1;
  messages: HudMessage[] = [];
  private msgTtl: number[] = [];

  hud: HudState;
  private accum = 0;
  private time = 0;
  private lastFrame = performance.now();
  private fpsSmooth = 60;
  private rafId = 0;
  private lastSOffset = 0; // удержание S для заднего хода
  private boardingTarget: AIShip | null = null;
  private spawnPos = new THREE.Vector3(315, 0, 620);

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.input = new InputManager(canvas);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.scene.add(this.worldGroup);
    this.scene.fog = new THREE.FogExp2(0x9fb6bd, 0.00035);

    this.water = new Water();
    this.scene.add(this.water.group);
    this.sky = new SkySystem(this.scene);
    this.world = new World();
    this.worldGroup.add(this.world.group);
    this.worldGroup.add(this.particles.points);
    this.world.onDiscover = (isl) => this.pushMessage(`Открыт остров: ${isl.name}!`);

    this.spawnShips();
    this.wireEvents();

    this.hud = this.makeHud();
    (window as unknown as { __game?: Game }).__game = this;
    window.addEventListener('resize', this.onResize);
  }

  private spawnShips() {
    const terrain = (x: number, z: number) => heightAt(x, z);
    // игрок: шлюп в глубокой воде за пирсом
    this.player = new Ship('sloop', true, this.wind, terrain, this.particles);
    const seaDir = new THREE.Vector3().subVectors(this.world.port.dockEnd,
      new THREE.Vector3(this.world.islands[0].cx, 0, this.world.islands[0].cz)).setY(0).normalize();
    this.spawnPos = this.world.port.dockEnd.clone().addScaledVector(seaDir, 130);
    this.player.position.copy(this.spawnPos);
    this.player.position.y = 0;
    this.player.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(seaDir.x, seaDir.z), 0));
    this.player.gold = 350;
    this.player.cargo = { sugar: 0, rum: 0, timber: 0 };
    this.worldGroup.add(this.player.visual.group);
    this.worldGroup.add(this.player.foam.mesh);
    this.worldGroup.add(this.player.wake.mesh);

    // торговцы (спавн в проверенно глубокой воде)
    const routes: THREE.Vector3[][] = [
      [new THREE.Vector3(850, 0, -380), new THREE.Vector3(500, 0, 760), new THREE.Vector3(-350, 0, 560), new THREE.Vector3(-100, 0, -80)],
      [new THREE.Vector3(-1350, 0, -260), new THREE.Vector3(-900, 0, -520), new THREE.Vector3(-380, 0, -740), new THREE.Vector3(-700, 0, -60)],
    ];
    const safeSpawns = [new THREE.Vector3(820, 0, -150), new THREE.Vector3(-1000, 0, -350)];
    routes.forEach((route, i) => {
      const trader = new Ship('fluyt', false, this.wind, terrain, this.particles);
      trader.position.copy(safeSpawns[i]);
      trader.quaternion.setFromEuler(new THREE.Euler(0, i * 1.3, 0));
      trader.gold = 260 + i * 190;
      trader.cargo = { sugar: 18 + i * 9, rum: 6 + i * 5, timber: 22 + i * 11 };
      this.worldGroup.add(trader.visual.group);
      this.worldGroup.add(trader.foam.mesh);
      this.worldGroup.add(trader.wake.mesh);
      const ai = new AIShip(trader, route, 'route');
      this.aiShips.push(ai);
    });

    // военный патруль
    const patrol = [
      new THREE.Vector3(940, 0, 380), new THREE.Vector3(660, 0, 720),
      new THREE.Vector3(240, 0, 730), new THREE.Vector3(30, 0, 380),
      new THREE.Vector3(240, 0, 30), new THREE.Vector3(660, 0, 30),
    ];
    const brig = new Ship('brig', false, this.wind, terrain, this.particles);
    brig.position.set(940, 0, 380);
    brig.crew = 52;
    this.worldGroup.add(brig.visual.group);
    this.worldGroup.add(brig.foam.mesh);
    this.worldGroup.add(brig.wake.mesh);
    this.aiShips.push(new AIShip(brig, patrol, 'patrol'));

    this.combat = new CombatSystem(this.player, this.particles, (t, p) => this.bus.emit(t, p));
    this.combat.others = this.aiShips.map(a => a.ship);
    this.combat.addTo(this.worldGroup);
  }

  private wireEvents() {
    const distToPlayer = (p: THREE.Vector3) => p.distanceTo(this.player.position);
    this.bus.on(GameEvents.CANNON_FIRED, (p) => {
      const d = (p as { pos: THREE.Vector3; power: number });
      this.audio.cannon(d.power, distToPlayer(d.pos));
      if (distToPlayer(d.pos) < 60) this.rig.addShake(0.35 * d.power);
    });
    this.bus.on(GameEvents.PROJECTILE_SPLASH, (p) => {
      this.audio.splash(distToPlayer((p as { pos: THREE.Vector3 }).pos));
    });
    this.bus.on(GameEvents.PROJECTILE_HIT, (p) => {
      const d = (p as { pos: THREE.Vector3; target: Ship });
      this.audio.woodHit(distToPlayer(d.pos));
      if (d.target === this.player) this.rig.addShake(0.5);
      // ИИ реагирует на агрессию игрока
      const ai = this.aiShips.find(a => a.ship === d.target);
      if (ai) ai.onPlayerAggression(this.aiShips);
    });
    this.bus.on(GameEvents.MESSAGE, (p) => {
      this.pushMessage((p as { text: string }).text);
    });
  }

  pushMessage(text: string) {
    this.messages.push({ id: this.msgId++, text });
    this.msgTtl.push(4.5);
    if (this.messages.length > 4) { this.messages.shift(); this.msgTtl.shift(); }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.audio.init();
    this.pushMessage('Поднять паруса! W — паруса, A/D — руль, Q/E — прицел, C — камера');
  }

  // ---------- порт ----------
  canDock(): boolean {
    if (this.docked || this.player.sinking) return false;
    const d = this.player.position.distanceTo(this.world.port.dockEnd);
    return d < 110 && this.player.speedKnots() < 4.5;
  }

  dock() {
    this.docked = true;
    this.player.anchored = true;
    this.player.sailTarget = 0;
    this.player.velocity.multiplyScalar(0.1);
    this.audio.bell();
    this.pushMessage('Швартовка в Пальмовой гавани');
  }

  undock() {
    this.docked = false;
    this.player.anchored = false;
    // лёгкий толчок от пирса
    const away = new THREE.Vector3().subVectors(this.player.position, this.world.port.dockEnd).setY(0).normalize();
    this.player.velocity.addScaledVector(away, 1.2);
    this.pushMessage('Отдать швартовы!');
  }

  get repairCost(): number { return Math.ceil((this.player.hullMax - this.player.hullHP) * 2.2); }

  portRepair() {
    const cost = this.repairCost;
    if (cost <= 0) return 'Корпус уже в порядке';
    if (this.player.gold < cost) return 'Не хватает золота';
    this.player.gold -= cost;
    this.player.hullHP = this.player.hullMax;
    this.player.sailHP = this.player.preset.sailHP;
    this.player.water = 0;
    this.player.leakRate = 0;
    this.pushMessage(`Полный ремонт выполнен (-${cost} зол.)`);
    return null;
  }

  portBuyAmmo(kind: AmmoType): string | null {
    const price = kind === 'ball' ? 4 : kind === 'grape' ? 5 : kind === 'chain' ? 9 : 12;
    const qty = kind === 'chain' ? 5 : 10;
    if (this.player.gold < price) return 'Не хватает золота';
    this.player.gold -= price;
    this.player.ammo[kind] += qty;
    return null;
  }

  portBuyPlanks(): string | null {
    if (this.player.gold < 15) return 'Не хватает золота';
    this.player.gold -= 15;
    this.player.planks += 5;
    return null;
  }

  portHireCrew(): string | null {
    if (this.player.crew >= this.player.preset.maxCrew) return 'Команда уже полная';
    if (this.player.gold < 30) return 'Не хватает золота';
    this.player.gold -= 30;
    this.player.crew++;
    return null;
  }

  portSellCargo(): string | null {
    let total = 0;
    for (const k of Object.keys(this.player.cargo)) {
      total += (this.player.cargo[k] || 0) * CARGO_PRICES[k];
      this.player.cargo[k] = 0;
    }
    if (total <= 0) return 'Трюм пуст';
    this.player.gold += total;
    this.pushMessage(`Груз продан: +${total} зол.`);
    return null;
  }

  // ---------- абордаж/приз ----------
  canBoard(): AIShip | null {
    if (this.docked || this.player.sinking) return null;
    for (const ai of this.aiShips) {
      if (ai.state !== 'surrender' || ai.ship.sinking || ai.ship.sunk) continue;
      const d = ai.ship.position.distanceTo(this.player.position);
      if (d < 55 && this.player.speedKnots() < 5) return ai;
    }
    return null;
  }

  takePrize(ai: AIShip) {
    const s = ai.ship;
    const gold = Math.round(s.gold * (0.85 + Math.random() * 0.5));
    this.player.gold += gold;
    const loot: string[] = [];
    for (const k of Object.keys(s.cargo)) {
      const amt = s.cargo[k] || 0;
      if (amt > 0) {
        this.player.cargo[k] = (this.player.cargo[k] || 0) + amt;
        loot.push(`${CARGO_NAMES[k]} ×${amt}`);
      }
    }
    this.player.ammo.ball += 8; this.player.ammo.grape += 4;
    if (this.player.crew < this.player.preset.maxCrew) this.player.crew = Math.min(this.player.preset.maxCrew, this.player.crew + 2);
    ai.makeDerelict();
    this.audio.bell();
    this.pushMessage(`Приз взят! +${gold} зол., ${loot.join(', ') || 'груза нет'}. Судно брошено.`);
  }

  // ---------- управление ----------
  private handleInput(dt: number) {
    const inp = this.input;
    if (!this.started || this.dead) { inp.endFrame(); return; }
    const p = this.player;

    // паруса
    if (inp.pressed('KeyW')) { p.sailTarget = Math.min(3, p.sailTarget + 1); if (p.anchored) this.pushMessage('Сначала поднять якорь (F)'); }
    if (inp.pressed('KeyS')) {
      if (p.sailTarget > 0) p.sailTarget = Math.max(0, p.sailTarget - 1);
    }
    // задний ход на вёслах: держать S при убранных парусах
    p.reverseThrust = inp.isDown('KeyS') && p.sailTarget === 0 && !p.anchored;
    if (p.reverseThrust) this.lastSOffset += dt; else this.lastSOffset = 0;

    // руль: A — влево, D — вправо (положительный руль = поворот вправо)
    const steer = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
    if (this.docked) p.rudderTarget = 0;
    else p.rudderTarget = steer; // A — лево (+yaw?), D — право

    // якорь
    if (inp.pressed('KeyF')) {
      if (this.docked) { this.undock(); }
      else {
        p.anchored = !p.anchored;
        this.audio.bell();
        this.pushMessage(p.anchored ? 'Якорь отдан' : 'Якорь поднят');
      }
    }

    // камера
    if (inp.pressed('KeyC')) {
      this.rig.cycleMode();
      this.pushMessage(`Камера: ${CAMERA_LABEL[this.rig.mode]}`);
    }

    // боеприпасы
    const ammoKeys: [string, AmmoType][] = [['Digit1', 'ball'], ['Digit2', 'chain'], ['Digit3', 'grape'], ['Digit4', 'fire']];
    for (const [key, kind] of ammoKeys) {
      if (inp.pressed(key)) {
        this.combat.ammo = kind;
        this.pushMessage(`Боеприпас: ${AMMO_INFO[kind].name}`);
      }
    }

    // прицеливание: наведение мышью
    if (this.combat.aim.active) {
      this.combat.aim.azimuth = clamp(this.combat.aim.azimuth - inp.mouseDX * 0.0022, -0.62, 0.62);
      this.combat.aim.elevation = clamp(this.combat.aim.elevation + inp.mouseDY * 0.0016, 0.01, 0.24);
    }

    // Q/E — борта; E ещё и взаимодействие
    const boardTarget = this.canBoard();
    const canDockHere = this.canDock();
    this.boardingTarget = boardTarget;
    if (inp.pressed('KeyQ')) {
      this.combat.toggleAim(-1);
    }
    if (inp.pressed('KeyE')) {
      if (boardTarget) {
        this.takePrize(boardTarget);
      } else if (canDockHere && !this.combat.aim.active) {
        this.dock();
      } else {
        this.combat.toggleAim(1);
      }
    }

    // огонь
    if (this.combat.aim.active) {
      if (inp.lmbJust) this.combat.fireOne();
      if (inp.pressed('Space')) this.combat.fireBroadside();
    }

    // ремонт/откачка (R)
    p.pumpAction = inp.isDown('KeyR');
  }

  // ---------- столкновения кораблей ----------
  private shipCollisions() {
    const all = [this.player, ...this.aiShips.map(a => a.ship)];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.sunk || b.sunk) continue;
        const minD = (a.preset.length + b.preset.length) * 0.30;
        const d = a.position.distanceTo(b.position);
        if (d < minD && d > 0.01) {
          const n = new THREE.Vector3().subVectors(a.position, b.position).setY(0).normalize();
          const push = (minD - d) * 0.5;
          a.position.addScaledVector(n, push);
          b.position.addScaledVector(n, -push);
          const relV = new THREE.Vector3().subVectors(a.velocity, b.velocity).dot(n);
          if (relV < -1.2) {
            const dmg = Math.min(22, -relV * 2.4);
            a.applyDamage({ kind: 'ram', amount: dmg });
            b.applyDamage({ kind: 'ram', amount: dmg });
            const mid = new THREE.Vector3().addVectors(a.position, b.position).multiplyScalar(0.5);
            this.particles.splash(mid.x, 0.5, mid.z, 1.2);
            this.audio.woodHit(0);
            this.rig.addShake(0.5);
            if (a === this.player || b === this.player) {
              this.pushMessage('Столкновение! Корпус повреждён');
            }
            // военный реагирует на таран
            for (const ai of this.aiShips) {
              if (ai.ship === a || ai.ship === b) ai.onPlayerAggression(this.aiShips);
            }
          }
          a.velocity.multiplyScalar(0.85);
          b.velocity.multiplyScalar(0.85);
        }
      }
    }
  }

  // ---------- HUD ----------
  private makeHud(): HudState {
    return {
      started: false, dead: false,
      speed: 0, headingDeg: 0, windFromDeg: 0, windSpeed: 0, windRelDeg: 0,
      sailLevel: 0, rudder: 0, hullPct: 1, sailPct: 1, crew: 0, maxCrew: 0, waterPct: 0,
      onFire: false, anchored: false, grounded: false, sinking: false,
      ammoType: 'ball', ammoCounts: {}, planks: 0, gold: 0, cargo: {},
      aiming: false, aimSide: '', aimRange: 0, gunsReadyPct: 0, targetName: null,
      cameraLabel: CAMERA_LABEL.iso, clock: '', seaState: 0, repairAction: null,
      canDock: false, canBoard: false, boardedName: null, docked: false,
      messages: [], mapIslands: [], mapShips: [], mapPlayer: { x: 0, z: 0, h: 0 },
      fps: 60, dayF: 1,
    };
  }

  private updateHud() {
    const p = this.player;
    const h = this.hud;
    const hdgDeg = ((-p.heading * 180 / Math.PI) % 360 + 360) % 360;
    const windDeg = ((-this.wind.from * 180 / Math.PI) % 360 + 360) % 360;
    const rel = ((windDeg - hdgDeg) % 360 + 360) % 360;
    h.started = this.started;
    h.dead = this.dead;
    h.speed = p.speedKnots();
    h.headingDeg = Math.round(hdgDeg);
    h.windFromDeg = Math.round(windDeg);
    h.windSpeed = this.wind.speed;
    h.windRelDeg = Math.round(rel);
    h.sailLevel = p.sailTarget;
    h.rudder = p.rudder;
    h.hullPct = clamp(p.hullHP / p.hullMax, 0, 1);
    h.sailPct = clamp(p.sailHP / p.preset.sailHP, 0, 1);
    h.crew = Math.round(p.crew);
    h.maxCrew = p.preset.maxCrew;
    h.waterPct = clamp(p.water / p.holdCap, 0, 1);
    h.onFire = p.onFire;
    h.anchored = p.anchored;
    h.grounded = p.grounded;
    h.sinking = p.sinking;
    h.ammoType = this.combat.ammo;
    h.ammoCounts = { ...p.ammo };
    h.planks = Math.floor(p.planks);
    h.gold = Math.floor(p.gold);
    h.cargo = { ...p.cargo };
    h.aiming = this.combat.aim.active;
    h.aimSide = this.combat.aim.side === 1 ? 'правый борт' : 'левый борт';
    h.aimRange = Math.round(this.combat.aim.range);
    h.gunsReadyPct = this.combat.readiness();
    h.targetName = this.combat.aim.target ? this.combat.aim.target.preset.name : null;
    h.cameraLabel = CAMERA_LABEL[this.rig.mode];
    // часы: 0.0 = полночь
    const hours = (this.sky.timeOfDay * 24 + 6) % 24;
    const hh = Math.floor(hours);
    const mm = Math.floor((hours - hh) * 60);
    h.clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    h.seaState = SEA.amplitude;
    h.repairAction = p.pumpAction ? (p.onFire ? 'Тушение пожара...' : p.water > 0.05 ? 'Откачка воды...' : p.planks > 0 && p.hullHP < p.hullMax ? 'Ремонт...' : null) : null;
    h.canDock = this.canDock();
    h.canBoard = !!this.boardingTarget;
    h.boardedName = this.boardingTarget?.ship.preset.name ?? null;
    h.docked = this.docked;
    h.messages = [...this.messages];
    h.mapIslands = this.world.islands.map(i => ({ x: i.cx, z: i.cz, r: i.r, name: i.name, discovered: this.world.discovered.has(i.name) }));
    h.mapShips = this.aiShips.filter(a => !a.ship.sunk).map(a => ({
      x: a.ship.position.x, z: a.ship.position.z,
      kind: a.ship.preset.id, surrendered: a.ship.surrendered,
    }));
    h.mapPlayer = { x: p.position.x, z: p.position.z, h: p.heading };
    h.fps = Math.round(this.fpsSmooth);
  }

  // ---------- погода ----------
  private updateWeather(dt: number) {
    this.windTimer -= dt;
    if (this.windTimer < 0) {
      this.windTimer = 18 + Math.random() * 22;
      this.windTargetSpeed = 3.5 + Math.random() * 9.5;
    }
    this.gustT += dt;
    const gust = Math.sin(this.gustT * 0.5) * 0.9 + Math.sin(this.gustT * 1.7 + 2) * 0.5;
    this.wind.speed += (this.windTargetSpeed + gust - this.wind.speed) * Math.min(1, dt * 0.3);
    this.wind.from += dt * 0.008 * Math.sin(this.time * 0.037 + 1.3);
    SEA.amplitude = clamp(0.45 + (this.wind.speed - 3) * 0.09, 0.4, 1.5);
  }

  // ---------- кадр ----------
  private frame = () => {
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    dt = Math.min(dt, 0.1);
    this.fpsSmooth += (1 / Math.max(dt, 1e-4) - this.fpsSmooth) * 0.05;

    this.handleInput(dt);

    // физика фиксированным шагом
    this.accum += dt;
    const STEP = 1 / 60;
    let steps = 0;
    while (this.accum >= STEP && steps < 5) {
      this.time += STEP;
      this.updateWeather(STEP);
      this.player.fixedStep(STEP, this.time);
      for (const ai of this.aiShips) ai.ship.fixedStep(STEP, this.time);
      for (const ai of this.aiShips) {
        ai.update(STEP, this.time, this.player, this.combat, (t) => this.pushMessage(t));
      }
      this.shipCollisions();
      this.accum -= STEP;
      steps++;
    }

    // действия команды (R)
    if (this.player.pumpAction && !this.docked) {
      const msg = this.player.crewAction(dt);
      if (msg && Math.random() < dt * 2) this.pushMessage(msg);
    }

    // sinking игрока
    if (this.player.sinking && !this.dead && this.player.sinkT > 5) {
      this.dead = true;
      this.pushMessage('Корабль затонул...');
    }

    // floating origin
    const playerScene = this._v1.copy(this.player.position).add(this.shift);
    if (Math.hypot(playerScene.x, playerScene.z) > 2200) {
      this.shift.x -= Math.round(playerScene.x / 50) * 50;
      this.shift.z -= Math.round(playerScene.z / 50) * 50;
      this.worldGroup.position.copy(this.shift);
      this.pushMessage('Смена квадрата моря');
    }
    this.negShift.copy(this.shift).negate();

    // визуал кораблей
    this.player.updateVisual(this.time, dt, this.particles);
    for (const ai of this.aiShips) ai.ship.updateVisual(this.time, dt, this.particles);

    // системы
    this.combat.update(dt, this.time, waterHeightAt);
    this.particles.update(dt);
    this.world.update(this.time, dt, this.player.position, waterHeightAt);

    // небо и свет
    playerScene.copy(this.player.position).add(this.shift);
    const { dayF } = this.sky.update(dt, this.time, this.rig.camera.position, playerScene, 0.42);
    const env = this.sky.environmentColors(dayF, 0);
    this.water.setEnvironment(this.sky.sunDir, env.sun, env.sky, env.horizon, env.fog, 0.00035);
    (this.scene.fog as THREE.FogExp2).color.copy(env.fog);
    (this.scene.fog as THREE.FogExp2).density = 0.00030 + (1 - dayF) * 0.00006;

    // фонарь игрока ночью
    if (this.player.visual.lantern) {
      this.player.visual.lantern.intensity = dayF < 0.35 ? 5 : 0;
    }

    // камера
    const shipInfo = {
      scenePos: playerScene,
      heading: this.player.heading,
      roll: this.player.euler.z,
      pitch: this.player.euler.x,
      speedFrac: clamp(this.player.speed() / this.player.preset.maxSpeed, 0, 1),
    };
    const aimDir = this.combat.aim.active ? this.combat.aimDirection(this._v2) : null;
    this.rig.update(dt, {
      active: this.combat.aim.active,
      side: this.combat.aim.side,
      dir: aimDir ?? this._v2.set(1, 0, 0),
    }, shipInfo, {
      mouseDX: this.input.mouseDX, mouseDY: this.input.mouseDY,
      wheel: this.input.wheelDelta, rmb: this.input.rmb,
    });

    // вода
    this.water.update(this.time, this.rig.camera.position, this.negShift);

    // звук
    this.audio.update(dt, {
      windSpeed: this.wind.speed,
      speed: this.player.speed(),
      rollRate: this.player.angular.z,
      nearLand: this.nearLand(),
      dayF,
    });

    // сообщения
    for (let i = this.msgTtl.length - 1; i >= 0; i--) {
      this.msgTtl[i] -= dt;
      if (this.msgTtl[i] <= 0) { this.messages.splice(i, 1); this.msgTtl.splice(i, 1); }
    }

    this.updateHud();
    this.renderer.render(this.scene, this.rig.camera);
    this.input.endFrame();
  };

  private _v1 = new THREE.Vector3();
  private _v2 = new THREE.Vector3();

  private nearLand(): boolean {
    for (const isl of this.world.islands) {
      if (Math.hypot(this.player.position.x - isl.cx, this.player.position.z - isl.cz) < isl.r + 260) return true;
    }
    return false;
  }

  respawn() {
    const p = this.player;
    p.hullHP = p.hullMax;
    p.sailHP = p.preset.sailHP;
    p.crew = Math.round(p.preset.maxCrew * 0.8);
    p.water = 0; p.leakRate = 0; p.onFire = false; p.fireT = 0;
    p.sinking = false; p.sinkT = 0; p.sunk = false;
    p.mastsBroken = 0; p.mastAnim = -1;
    for (const m of p.visual.masts) { m.rotation.x = 0; m.position.y = 0; }
    p.visual.group.visible = true;
    p.velocity.set(0, 0, 0);
    p.angular.set(0, 0, 0);
    p.position.copy(this.spawnPos);
    p.position.y = 0;
    p.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(
      this.spawnPos.x - this.world.islands[0].cx, this.spawnPos.z - this.world.islands[0].cz), 0));
    p.gold = Math.floor(p.gold * 0.5);
    p.cargo = { sugar: 0, rum: 0, timber: 0 };
    p.sailTarget = 0;
    this.dead = false;
    this.pushMessage(`Новый корабль у гавани. Половина золота ушла на дно...`);
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize(window.innerWidth / window.innerHeight);
  };

  run() {
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }

  setCameraMode(mode: CameraMode) { this.rig.mode = mode; }
}
