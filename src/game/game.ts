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
import { GibPool } from './fx/gibs';
import { setCrewFx } from './ship/crew';
import { SkySystem } from './fx/sky';
import { WeatherSystem } from './fx/weather';
import { AudioSys } from './audio/audio';
import { AIShip } from './ai/ai';
import { GameSettings, loadSettings, type FxSettings } from './core/settings';

// ============================================================
// Game: интеграция всех систем. Фиксированный шаг физики 60 Гц,
// floating origin, события, HUD-снимок для React.
// ============================================================

export interface HudMessage { id: number; text: string; }

/** Отчёт о состоянии мишени полигона (для панели мини-игры) */
export interface TargetReport {
  name: string;
  modelId: string;
  hullPct: number;
  waterPct: number;
  leakRate: number;
  crew: number; maxCrew: number;
  masts: { broken: boolean; hpPct: number }[];
  holesBelow: number; holesAbove: number;
  sinking: boolean; sunk: boolean;
  dist: number;
  returnFire: boolean;
}

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
  proving: boolean;
  target: TargetReport | null;
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
  weather: WeatherSystem;
  world: World;
  particles = new Particles(1400);
  /** куски тел, разорванных ядрами (мировые координаты) */
  gibs = new GibPool();
  audio = new AudioSys();

  player!: Ship;
  aiShips: AIShip[] = [];
  combat!: CombatSystem;

  worldGroup = new THREE.Group();
  private shift = new THREE.Vector3();     // worldGroup.position
  private negShift = new THREE.Vector3();  // для воды

  wind = { from: 0.7, speed: 7.5 };

  docked = false;
  dead = false;
  started = false;
  settings: GameSettings;         // графика/управление/звук (см. core/settings.ts)
  uiOpen = false;                 // открыт ли модальный экран (пауза ввода)
  paused = false;                 // отладка/E2E: заморозить физику (рендер идёт)

  // ===== Полигон (мини-игра проверки повреждений) =====
  proving = false;                // активен ли режим полигона
  pgTarget: AIShip | null = null; // мишень на якоре
  pgModel = 'fluyt';              // модель мишени
  pgReturnFire = false;           // отвечает ли мишень огнём
  private PG_ANCHOR = new THREE.Vector3(2300, 0, 2300); // чистая вода вдали от островов

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
    this.settings = loadSettings();
    const g = this.settings.graphics;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, g.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = g.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.input = new InputManager(canvas);
    this.input.setPreventCodes(this.preventCodes());
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.camera.far = g.drawDistance * 2 + 4000;
    this.rig.camera.updateProjectionMatrix();
    this.scene.add(this.worldGroup);
    this.scene.fog = new THREE.FogExp2(0x9fb6bd, this.fogBase());

    this.water = new Water({
      detailSegs: g.waterDetail,
      chunkSize: g.waterChunkSize,
      far: g.drawDistance,
      lodSkip: g.waterLodStep,
    });
    this.water.setFoamQuality(g.foamQuality);
    this.scene.add(this.water.group);
    this.sky = new SkySystem(this.scene);
    this.sky.setShadowRes(g.shadowRes);
    this.sky.setDomeScale(g.drawDistance / 6500 * 1.12);
    this.weather = new WeatherSystem(this.scene);
    this.weather.applySettings(this.settings.weather);
    this.weather.onThunder = (dist) => this.audio.thunder(dist);
    this.applyFx(this.settings.fx);
    this.updateParticleScale();
    this.world = new World();
    this.worldGroup.add(this.world.group);
    this.worldGroup.add(this.particles.points);
    this.worldGroup.add(this.particles.firePoints); // огонь — аддитивный пул
    this.gibs.addTo(this.worldGroup);
    setCrewFx(this.gibs, this.particles);
    this.world.onDiscover = (isl) => this.pushMessage(`Открыт остров: ${isl.name}!`);

    this.spawnShips();
    this.wireEvents();

    this.hud = this.makeHud();
    (window as unknown as { __game?: Game }).__game = this;
    window.addEventListener('resize', this.onResize);
  }

  /** Базовая плотность тумана из дальности прорисовки: к краю воды ~92% тумана */
  private fogBase(): number {
    return 1.55 / Math.max(1500, this.settings.graphics.drawDistance);
  }

  /** Коды клавиш, которые не должен обрабатывать браузер (страница/скролл) */
  private preventCodes(): Set<string> {
    const c = this.settings.controls;
    return new Set([c.sailsUp, c.sailsDown, c.steerLeft, c.steerRight, c.anchor,
      c.camera, c.aimPort, c.aimStarboard, c.fire, c.repair, c.map, c.help,
      ...c.ammo, 'Tab', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  }

  /** Применить настройки эффектов дыма/огня */
  private applyFx(fx: FxSettings) {
    // прозрачность ↑ → непрозрачность ↓ (пик альфы клуба)
    const alpha = 0.55 * (1 - fx.smokeTransparency);
    this.particles.applyFx({
      smokeVisible: fx.smokeVisible,
      smokeSize: fx.smokeSize,
      smokeDensity: fx.smokeDensity,
      smokeAlpha: Math.max(0.03, alpha),
    });
  }

  /** Применить новые настройки на лету (вызывается экраном настроек) */
  applySettings(s: GameSettings) {
    const prev = this.settings;
    this.settings = s;
    const g = s.graphics;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, g.pixelRatio));
    if (prev.graphics.shadows !== g.shadows) this.setShadows(g.shadows);
    if (prev.graphics.shadowRes !== g.shadowRes) this.sky.setShadowRes(g.shadowRes);
    if (prev.graphics.waterDetail !== g.waterDetail || prev.graphics.drawDistance !== g.drawDistance
      || prev.graphics.waterChunkSize !== g.waterChunkSize || prev.graphics.waterLodStep !== g.waterLodStep) {
      this.water.configure(g.waterDetail, g.waterChunkSize, g.drawDistance, g.waterLodStep);
    }
    // дистанция мишени на полигоне — переставить цель без сброса повреждений
    if (prev.gameplay.provingDistance !== s.gameplay.provingDistance
      && this.proving && this.pgTarget) {
      const t = this.pgTarget.ship;
      t.position.copy(this.pgTargetPos());
      t.position.y = 0;
      this.pushMessage(`Мишень переставлена: ${s.gameplay.provingDistance} м`);
    }
    this.water.setFoamQuality(g.foamQuality);
    this.rig.camera.far = g.drawDistance * 2 + 4000;
    this.rig.camera.updateProjectionMatrix();
    this.sky.setDomeScale(g.drawDistance / 6500 * 1.12);
    (this.scene.fog as THREE.FogExp2).density = this.fogBase();
    this.audio.setVolume(s.audio.volume);
    this.input.setPreventCodes(this.preventCodes());
    this.applyFx(s.fx);
    if (prev.weather.mode !== s.weather.mode
      || prev.weather.windSpeed !== s.weather.windSpeed
      || prev.weather.windDir !== s.weather.windDir) {
      this.weather.applySettings(s.weather);
    }
  }

  private setShadows(on: boolean) {
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.needsUpdate = true;
    // переключение теней требует перекомпиляции материалов
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) (m as THREE.Material).needsUpdate = true;
      }
    });
  }

  /** Отладочный хук для E2E: принудительный ветер (→ состояние моря) */
  debugSetWind(speed: number) {
    this.settings.weather.windSpeed = speed;
    this.weather.applySettings(this.settings.weather);
    this.wind.speed = speed;
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
    const traderModels = ['fluyt', 'pinnace']; // флейт и пинасс — торговые суда эпохи
    routes.forEach((route, i) => {
      const trader = new Ship(traderModels[i], false, this.wind, terrain, this.particles);
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

    // каравелла — быстрый торговец северными путями (латинские паруса)
    const caravelRoute = [
      new THREE.Vector3(1200, 0, 600), new THREE.Vector3(0, 0, 950),
      new THREE.Vector3(-1100, 0, 850), new THREE.Vector3(-500, 0, 150),
    ];
    const caravel = new Ship('caravel', false, this.wind, terrain, this.particles);
    caravel.position.copy(caravelRoute[0]);
    caravel.quaternion.setFromEuler(new THREE.Euler(0, -1.2, 0));
    caravel.gold = 340;
    caravel.cargo = { sugar: 14, rum: 9, timber: 30 };
    this.worldGroup.add(caravel.visual.group);
    this.worldGroup.add(caravel.foam.mesh);
    this.worldGroup.add(caravel.wake.mesh);
    this.aiShips.push(new AIShip(caravel, caravelRoute, 'route'));

    // галеон — флагман на якоре в гавани (для осмотра и проверки повреждений)
    const galleon = new Ship('galleon', false, this.wind, terrain, this.particles);
    const perp = new THREE.Vector3(-seaDir.z, 0, seaDir.x);
    galleon.position.copy(this.spawnPos).addScaledVector(perp, 85).addScaledVector(seaDir, 45);
    galleon.position.y = 0;
    galleon.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(seaDir.x, seaDir.z) + 0.7, 0));
    galleon.crew = 70;
    this.worldGroup.add(galleon.visual.group);
    this.worldGroup.add(galleon.foam.mesh);
    this.worldGroup.add(galleon.wake.mesh);
    this.aiShips.push(new AIShip(galleon, [], 'anchored'));

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
    this.bus.on(GameEvents.TERRAIN_HIT, (p) => {
      const d = p as { pos: THREE.Vector3; trees: number };
      this.audio.woodHit(distToPlayer(d.pos));
      if (d.trees > 0) {
        this.rig.addShake(Math.min(0.3, 0.12 * d.trees));
        this.pushMessage(`Снаряд повалил деревьев: ${d.trees}`);
      }
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
    this.bus.on(GameEvents.MAST_BROKEN, (p) => {
      const d = (p as { target: Ship; pos: THREE.Vector3 });
      this.audio.woodHit(distToPlayer(d.pos));
      this.rig.addShake(0.35);
      const who = d.target === this.player ? 'Наш корабль' : d.target.preset.name;
      this.pushMessage(`${who}: мачта переломлена!`);
    });
  }

  // ===== Полигон: чистое море + корабль-мишень на якоре =====
  /** Мишень на траверзе ПРАВОГО борта игрока (курс игрока — восток, right = +Z) */
  private pgTargetPos(): THREE.Vector3 {
    // дистанция до мишени — настраивается (Настройки → Игра)
    return this.PG_ANCHOR.clone().add(new THREE.Vector3(0, 0, this.settings.gameplay.provingDistance));
  }

  private spawnProvingTarget(modelId: string) {
    this.removeProvingTarget();
    const terrain = (x: number, z: number) => heightAt(x, z);
    const ship = new Ship(modelId, false, this.wind, terrain, this.particles);
    ship.position.copy(this.pgTargetPos());
    ship.position.y = 0;
    ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)); // параллельно игроку
    ship.noSurrender = true;
    this.worldGroup.add(ship.visual.group);
    this.worldGroup.add(ship.foam.mesh);
    this.worldGroup.add(ship.wake.mesh);
    const ai = new AIShip(ship, [], 'anchored');
    ai.returnFire = this.pgReturnFire;
    this.pgTarget = ai;
    this.combat.others.push(ship);
  }

  private removeProvingTarget() {
    if (!this.pgTarget) return;
    const s = this.pgTarget.ship;
    const idx = this.combat.others.indexOf(s);
    if (idx >= 0) this.combat.others.splice(idx, 1);
    this.worldGroup.remove(s.visual.group);
    this.worldGroup.remove(s.foam.mesh);
    this.worldGroup.remove(s.wake.mesh);
    s.dispose();
    this.pgTarget = null;
  }

  startProving(modelId = 'fluyt') {
    if (!this.started) this.start();
    this.exitProving();
    this.proving = true;
    this.pgModel = modelId;
    // штиль: ровный ветер и лёгкая зыбь (блокируется в updateWeather)
    this.wind.speed = 4.2;
    SEA.amplitude = 0.42;
    const p = this.player;
    p.clearDamage();
    p.position.copy(this.PG_ANCHOR); p.position.y = 0;
    p.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)); // курс на восток
    p.anchored = false;
    p.ammo = { ball: 250, chain: 120, grape: 150, fire: 60 };
    p.planks = 30;
    this.combat.aim.active = false;
    this.docked = false;
    this.spawnProvingTarget(modelId);
    this.pushMessage(`Полигон: чистое море, мишень на якоре с правого борта (${this.settings.gameplay.provingDistance} м)`);
  }

  pgSetModel(modelId: string) {
    this.pgModel = modelId;
    if (this.proving) this.spawnProvingTarget(modelId);
  }

  setPgReturnFire(on: boolean) {
    this.pgReturnFire = on;
    if (this.pgTarget) this.pgTarget.returnFire = on;
  }

  resetProvingTarget() {
    if (!this.pgTarget) return;
    const s = this.pgTarget.ship;
    s.clearDamage();
    s.position.copy(this.pgTargetPos());
    s.position.y = 0;
    s.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    this.player.ammo = { ball: 250, chain: 120, grape: 150, fire: 60 };
    this.pushMessage('Мишень восстановлена, боезапас пополнен');
  }

  exitProving() {
    this.removeProvingTarget();
    this.proving = false;
    this.pgReturnFire = false;
    // вернуть игрока к гавани (как при возрождении)
    const p = this.player;
    p.clearDamage();
    const seaDir = new THREE.Vector3().subVectors(this.world.port.dockEnd,
      new THREE.Vector3(this.world.islands[0].cx, 0, this.world.islands[0].cz)).setY(0).normalize();
    const pos = this.world.port.dockEnd.clone().addScaledVector(seaDir, 130);
    p.position.copy(pos); p.position.y = 0;
    p.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(seaDir.x, seaDir.z), 0));
    p.anchored = false;
    this.combat.aim.active = false;
    this.pushMessage('Возврат к Пальмовой гавани');
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
    if (!this.started || this.dead || this.uiOpen) { inp.endFrame(); return; }
    const p = this.player;
    const c = this.settings.controls;

    // паруса
    if (inp.pressed(c.sailsUp)) { p.sailTarget = Math.min(3, p.sailTarget + 1); if (p.anchored) this.pushMessage('Сначала поднять якорь (F)'); }
    if (inp.pressed(c.sailsDown)) {
      if (p.sailTarget > 0) p.sailTarget = Math.max(0, p.sailTarget - 1);
    }
    // задний ход на вёслах: держать «убрать паруса» при убранных парусах
    p.reverseThrust = inp.isDown(c.sailsDown) && p.sailTarget === 0 && !p.anchored;
    if (p.reverseThrust) this.lastSOffset += dt; else this.lastSOffset = 0;

    // руль: A — влево, D — вправо (положительный руль = поворот вправо,
    // ползунок HUD при D уходит вправо — и корабль поворачивает вправо).
    // invertRudder — настройка для тех, кто привык к обратной схеме
    let steer = (inp.isDown(c.steerRight) ? 1 : 0) - (inp.isDown(c.steerLeft) ? 1 : 0);
    if (c.invertRudder) steer = -steer;
    if (this.docked) p.rudderTarget = 0;
    else p.rudderTarget = steer; // D — штирборт (право), A — порт (лево)

    // якорь
    if (inp.pressed(c.anchor)) {
      if (this.docked) { this.undock(); }
      else {
        p.anchored = !p.anchored;
        this.audio.bell();
        this.pushMessage(p.anchored ? 'Якорь отдан' : 'Якорь поднят');
      }
    }

    // камера
    if (inp.pressed(c.camera)) {
      this.rig.cycleMode();
      this.pushMessage(`Камера: ${CAMERA_LABEL[this.rig.mode]}`);
    }

    // боеприпасы
    const ammoKeys: [string, AmmoType][] = [[c.ammo[0], 'ball'], [c.ammo[1], 'chain'], [c.ammo[2], 'grape'], [c.ammo[3], 'fire']];
    for (const [key, kind] of ammoKeys) {
      if (inp.pressed(key)) {
        this.combat.ammo = kind;
        this.pushMessage(`Боеприпас: ${AMMO_INFO[kind].name}`);
      }
    }

    // прицеливание: наведение мышью
    // мышь ОТ СЕБЯ (вверх экрана, mouseDY<0) — стволы ПОДНИМАЮТСЯ
    if (this.combat.aim.active) {
      this.combat.aim.azimuth = clamp(this.combat.aim.azimuth - inp.mouseDX * 0.0022, -0.62, 0.62);
      this.combat.aim.elevation = clamp(this.combat.aim.elevation - inp.mouseDY * 0.0016, 0.01, 0.24);
    }

    // борта; «правый борт» ещё и взаимодействие
    const boardTarget = this.canBoard();
    const canDockHere = this.canDock();
    this.boardingTarget = boardTarget;
    if (inp.pressed(c.aimPort)) {
      this.combat.toggleAim(-1);
    }
    if (inp.pressed(c.aimStarboard)) {
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
      if (inp.pressed(c.fire)) this.combat.fireBroadside();
    }

    // ремонт/откачка
    p.pumpAction = inp.isDown(c.repair);
  }

  // ---------- столкновения кораблей ----------
  private shipCollisions() {
    const all = [this.player, ...this.aiShips.map(a => a.ship)];
    if (this.pgTarget && !this.pgTarget.ship.sunk) all.push(this.pgTarget.ship);
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
      proving: false, target: null,
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
    // полигон: отчёт о мишени
    h.proving = this.proving;
    if (this.proving && this.pgTarget) {
      const t = this.pgTarget.ship;
      h.target = {
        name: t.preset.name,
        modelId: t.preset.id,
        hullPct: clamp(t.hullHP / t.hullMax, 0, 1),
        waterPct: clamp(t.water / t.holdCap, 0, 1),
        leakRate: t.leakRate,
        crew: Math.round(t.crew), maxCrew: t.preset.maxCrew,
        masts: t.mastFall.map((f, i) => ({
          broken: f >= 0,
          hpPct: clamp(t.mastHP[i] / t.mastMaxHP, 0, 1),
        })),
        holesBelow: t.hullHoles.filter(x => x.belowWL).length,
        holesAbove: t.hullHoles.filter(x => !x.belowWL).length,
        sinking: t.sinking, sunk: t.sunk,
        dist: Math.round(t.position.distanceTo(p.position)),
        returnFire: this.pgReturnFire,
      };
    } else {
      h.target = null;
    }
  }

  // ---------- погода ----------
  /** Сглаженная амплитуда волн (море набирает волну с запаздыванием) */
  private seaAmpSmooth = 1;
  /** последний визуал погоды (облачность/солнце/туман/дождь) */
  private weatherVis = { cloudiness: 0.35, sunDim: 1, fogMul: 1, rainI: 0 };
  private updateWeather(dt: number) {
    // полигон: чистое море, ровный слабый ветер — всегда
    const calm = this.proving;
    const vis = this.weather.update(dt, this.rig.camera.position, calm);
    this.weatherVis = vis;
    if (calm) {
      this.wind.speed += (4.2 - this.wind.speed) * Math.min(1, dt * 0.6);
      SEA.amplitude = 0.42;
      this.seaAmpSmooth = 0.42;
      return vis;
    }
    this.wind.speed = this.weather.wind.speed;
    this.wind.from = this.weather.wind.from;
    // амплитуда волн от силы ветра (0.3 штиль .. волна шторма,
    // ограничена настройкой графики waveHeight — палубу не топит);
    // swell набирается/спадает с запаздыванием — как настоящее море
    const waveCap = this.settings.graphics.waveHeight;
    const ampTarget = clamp(0.32 + this.wind.speed * 0.052, 0.3, waveCap);
    this.seaAmpSmooth += (ampTarget - this.seaAmpSmooth) * Math.min(1, dt * 0.22);
    SEA.amplitude = this.seaAmpSmooth;
    return vis;
  }

  /** Отладочный хук: задать погоду (E2E/телеметрия) */
  debugSetWeather(mode: 'clear' | 'rain' | 'storm' | 'fog', windSpeed = -1, windDir = -1) {
    this.settings = structuredClone(this.settings);
    this.settings.weather.mode = mode;
    if (windSpeed >= 0) this.settings.weather.windSpeed = windSpeed;
    if (windDir >= 0) this.settings.weather.windDir = windDir;
    this.weather.applySettings(this.settings.weather);
    return this.settings.weather;
  }

  // ---------- кадр ----------
  private frame = () => {
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.fpsSmooth += (1 / Math.max(dt, 1e-4) - this.fpsSmooth) * 0.05; // истинный FPS
    dt = Math.min(dt, 0.1);

    this.handleInput(dt);

    // физика фиксированным шагом
    this.accum += dt;
    const STEP = 1 / 60;
    let steps = 0;
    while (!this.paused && this.accum >= STEP && steps < 5) {
      this.time += STEP;
      this.updateWeather(STEP);
      this.player.fixedStep(STEP, this.time);
      for (const ai of this.aiShips) ai.ship.fixedStep(STEP, this.time);
      if (this.pgTarget) this.pgTarget.ship.fixedStep(STEP, this.time);
      for (const ai of this.aiShips) {
        ai.update(STEP, this.time, this.player, this.combat, (t) => this.pushMessage(t));
      }
      if (this.pgTarget) this.pgTarget.update(STEP, this.time, this.player, this.combat, (t) => this.pushMessage(t));
      this.shipCollisions();
      this.accum -= STEP;
      steps++;
    }

    // телеметрия для отладки/E2E: window.__sea
    const dbg = window as unknown as { __sea: Record<string, unknown> };
    const sailsV = this.player.visual.sails.sails;
    let furlSum = 0, furlMin = 1, furlMax = 0;
    for (const sv of sailsV) {
      furlSum += sv.furl;
      furlMin = Math.min(furlMin, sv.furl);
      furlMax = Math.max(furlMax, sv.furl);
    }
    // минимальный надводный борт: высота палубы у планширя минус вода
    // по носу/корме/миделю И ПО КРАЯМ ПАЛУБЫ (крен топит борт) —
    // учитываем крен/дифферент кватернионом
    let freeboard = Infinity;
    const deckLocal = this.player.preset.freeboard * 0.82 - 1.0;
    for (const lz of [-this.player.preset.length * 0.38, 0, this.player.preset.length * 0.38]) {
      for (const lx of [0, -this.player.halfWidthAt(lz), this.player.halfWidthAt(lz)]) {
        this._v3.set(lx, deckLocal, lz).applyQuaternion(this.player.quaternion).add(this.player.position);
        freeboard = Math.min(freeboard, this._v3.y - waterHeightAt(this._v3.x, this._v3.z, this.time));
      }
    }
    // доля постановки парусов (0..1): уровень W/S, ограниченный фактическим ходом
    const p = this.player;
    const windPow = Math.pow(clamp(this.wind.speed / 8.0, 0.05, 1.6), 1.6);
    const attainable = p.preset.maxSpeed * 0.85 * Math.sqrt(clamp(Ship.polar(p.apparentWindAngle()) * windPow, 0, 1.5));
    const setTot = Math.min(p.sailFrac, attainable > 1.5 ? clamp(p.speed() / attainable, 0, 1) : 1);
    const tgt = this.proving && this.pgTarget ? this.pgTarget.ship : null;
    dbg.__sea = {
      fps: this.fpsSmooth,
      x: p.position.x, y: p.position.y, z: p.position.z,
      waterY: waterHeightAt(p.position.x, p.position.z, this.time),
      roll: p.euler.z, pitch: p.euler.x,
      heading: p.heading,
      rudder: p.rudder, angY: p.angular.y,
      speed: p.speedKnots(),
      sailLevel: p.sailTarget, sailFrac: p.sailFrac,
      setTot,
      furlAvg: furlSum / Math.max(1, sailsV.length), furlMin, furlMax,
      sailSet: sailsV.filter(sv => sv.furl < 0.5).length,
      freeboard, seaAmp: SEA.amplitude, wind: this.wind.speed,
      // погода (e2e/диагностика): режим, дождь, туман, молнии
      weather: {
        mode: this.weather.mode,
        rain: this.weather.rainCount,
        fogMul: +this.weatherVis.fogMul.toFixed(2),
        cloud: +this.weatherVis.cloudiness.toFixed(2),
        flash: +this.weather.flash.toFixed(2),
        flashes: this.weather.flashes,
        windDir: Math.round((this.wind.from * 180 / Math.PI + 360) % 360),
        sunDim: +this.weatherVis.sunDim.toFixed(2),
      },
      proving: this.proving ? 1 : 0,
      tgtDist: tgt ? +p.position.distanceTo(tgt.position).toFixed(1) : -1,
      tgtHull: tgt ? +clamp(tgt.hullHP / tgt.hullMax, 0, 1).toFixed(3) : -1,
      tgtWater: tgt ? +clamp(tgt.water / tgt.holdCap, 0, 1).toFixed(3) : -1,
      tgtMastsBroken: tgt ? tgt.mastFall.filter(f => f >= 0).length : -1,
      tgtHoles: tgt ? tgt.hullHoles.length : -1,
      tgtCrew: tgt ? tgt.crew : -1,
      tgtSinking: tgt && tgt.sinking ? 1 : 0,
      tgtSunk: tgt && tgt.sunk ? 1 : 0,
      tgtShown: tgt ? tgt.crew3d.shown : -1,
      tgtCrewDead: tgt ? tgt.crew3d.dead : -1,
      gibsAlive: this.gibs.alive,
      crewShown: p.crew3d.shown,
      crewDead: p.crew3d.dead,
      // сетка воды (e2e/диагностика «квадратов»): чанк + LOD-кольца
      water: (() => {
        const w = this.water.getInfo();
        return {
          chunk: w.chunkSize, segs: w.segs, step: +w.step.toFixed(3),
          rings: w.rings.map(r => ({ i: Math.round(r.inner), o: Math.round(r.outer), c: +r.cell.toFixed(2), q: r.quads })),
          farEff: Math.round(w.farEff),
          pgDist: this.settings.gameplay.provingDistance,
        };
      })(),
    };

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
    if (this.pgTarget) this.pgTarget.ship.updateVisual(this.time, dt, this.particles);

    // мелкие детали кораблей — только когда камера рядом (LOD)
    const camPos = this.rig.camera.position;
    const lodD = this.settings.graphics.detailLod;
    this._v3.copy(this.player.position).add(this.shift);
    this.setDetailLod(this.player, camPos, lodD);
    for (const ai of this.aiShips) this.setDetailLod(ai.ship, camPos, lodD);
    if (this.pgTarget) this.setDetailLod(this.pgTarget.ship, camPos, lodD);

    // системы (земля: рельеф островов + повал деревьев от снарядов)
    this.combat.update(dt, this.time, waterHeightAt, heightAt,
      (x, y, z, r) => this.world.breakTrees(x, y, z, r, this.particles));
    this.particles.update(dt);
    this.gibs.update(dt);
    this.world.update(this.time, dt, this.player.position, waterHeightAt);

    // небо и свет (+ погода: облачность, приглушение, вспышки молний)
    playerScene.copy(this.player.position).add(this.shift);
    const wv = this.weatherVis;
    this.sky.flash = this.weather.flash;
    this.sky.setWeather(wv.sunDim, clamp((wv.fogMul - 1) / 2.4, 0, 1) * 0.85);
    const { dayF } = this.sky.update(dt, this.time, this.rig.camera.position, playerScene, wv.cloudiness);
    const env = this.sky.environmentColors(dayF, 0);
    const fogD = this.fogBase() * (1 + (1 - dayF) * 0.18) * wv.fogMul;
    // молния вспыхивает и в блеске воды
    env.sun.multiplyScalar(1 + this.weather.flash * 5);
    this.water.setEnvironment(this.sky.sunDir, env.sun, env.sky, env.horizon, env.fog, fogD);
    (this.scene.fog as THREE.FogExp2).color.copy(env.fog);
    (this.scene.fog as THREE.FogExp2).density = fogD;
    // дым относит реальным ветром
    this.particles.setWind(this.wind.from, this.wind.speed);
    // реальное солнце — в материалы парусов (иначе «пузо» не заливается
    // светом и паруса читаются плоскими при любом ветре)
    {
      const sd = this.sky.sunDir;
      for (const ship of [this.player, ...this.aiShips.map(a => a.ship)]) {
        for (const sv of ship.visual.sails.sails) {
          (sv.mat.uniforms.uSunDir.value as THREE.Vector3).copy(sd);
        }
      }
    }

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
    // стрелки — вращение камеры (в свободном режиме напрямую,
    // в остальных — отклонение с плавным возвратом за корму)
    let arrX = 0, arrY = 0;
    if (this.input.isDown('ArrowLeft')) arrX -= 1;
    if (this.input.isDown('ArrowRight')) arrX += 1;
    if (this.input.isDown('ArrowUp')) arrY -= 1;
    if (this.input.isDown('ArrowDown')) arrY += 1;
    this.rig.update(dt, {
      active: this.combat.aim.active,
      side: this.combat.aim.side,
      dir: aimDir ?? this._v2.set(1, 0, 0),
    }, shipInfo, {
      mouseDX: this.input.mouseDX, mouseDY: this.input.mouseDY,
      wheel: this.input.wheelDelta, rmb: this.input.rmb,
      arrowX: arrX, arrowY: arrY,
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
      rain: this.proving ? 0 : wv.rainI,
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
  private _v3 = new THREE.Vector3();

  /** Мелкие детали корабля — только когда камера рядом (LOD) */
  private setDetailLod(ship: Ship, camPos: THREE.Vector3, maxDist: number) {
    const d = ship.visual.detail;
    if (!d) return;
    this._v3.copy(ship.position).add(this.shift);
    d.visible = camPos.distanceTo(this._v3) < maxDist;
  }

  private nearLand(): boolean {
    for (const isl of this.world.islands) {
      if (Math.hypot(this.player.position.x - isl.cx, this.player.position.z - isl.cz) < isl.r + 260) return true;
    }
    return false;
  }

  respawn() {
    if (this.proving) this.exitProving();
    const p = this.player;
    p.hullHP = p.hullMax;
    p.sailHP = p.preset.sailHP;
    p.crew = Math.round(p.preset.maxCrew * 0.8);
    p.water = 0; p.leakRate = 0; p.onFire = false; p.fireT = 0;
    p.sinking = false; p.sinkT = 0; p.sunk = false;
    p.mastsBroken = 0; p.mastAnim = -1;
    for (let i = 0; i < p.mastHP.length; i++) { p.mastHP[i] = p.mastMaxHP; p.mastFall[i] = -1; }
    for (const m of p.visual.masts) { m.rotation.set(0, 0, 0); m.position.y = 0; }
    for (const h of p.hullHoles) { p.visual.group.remove(h.mesh); h.mesh.geometry.dispose(); }
    p.hullHoles = [];
    p.leakBias = 0;
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
    this.updateParticleScale();
  };

  /** пикселей на метр для спрайтов частиц (зависит от буфера и fov) */
  private updateParticleScale() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const fovRad = (this.rig.camera.fov * Math.PI) / 180;
    this.particles.setScale(size.y / (2 * Math.tan(fovRad / 2)));
  }

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
