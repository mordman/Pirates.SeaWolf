import * as THREE from 'three';
import { InputManager } from './core/input';
import { EventBus, GameEvents } from './core/events';
import { clamp } from './core/rng';
import { Water } from './water/Water';
import { SEA, waterHeightAt } from './water/waves';
import { Ship } from './ship/Ship';
import { PRESETS, setFlagKind, setSailColor, setHullTint, shipPrice, setFigurehead, setDecoration, type FlagKind } from './ship/buildShip';
import { FIGUREHEADS } from './ship/figurehead';
import { DECOS } from './ship/hullDeco';
import { CameraRig, CAMERA_LABEL, CameraMode } from './camera/cameraRig';
import { CombatSystem, AMMO_INFO, AmmoType } from './combat/combat';
import { World, heightAt, type PortDef } from './world/world';
import { buildLandFolk, folkCountFor, type LandFolk } from './world/islandFolk';
import { Particles } from './fx/particles';
import { GibPool } from './fx/gibs';
import { initDebris, updateDebris, clearDebris, debrisAlive } from './fx/debris';
import { setCrewFx, deckCrewFor } from './ship/crew';
import { BoatLaunch } from './ship/launch';
import { SkySystem } from './fx/sky';
import { WeatherSystem } from './fx/weather';
import { AudioSys } from './audio/audio';
import { AIShip } from './ai/ai';
import { GameSettings, loadSettings, rollStartingAmmo, type FxSettings } from './core/settings';

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
  firePct: number;        // сила пожара 0..1
  anchored: boolean;
  grounded: boolean;
  sinking: boolean;
  ammoType: AmmoType;
  ammoCounts: Record<string, number>;
  planks: number;
  gold: number;
  cargo: Record<string, number>;
  cargoT: number;          // занято трюма, т
  cargoMaxT: number;       // грузоподъёмность, т
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
  nearPortName: string | null; // ближайшая гавань (подсказка швартовки)
  canBoard: boolean;
  boardedName: string | null;
  shipId: string;        // пресет корабля игрока (подсветка в порту)
  shipName: string;
  shipClass: string;
  docked: boolean;
  /** порт, в котором стоим (имя/уровень/население) */
  portInfo: { name: string; tierName: string; population: number } | null;
  /** вёсла (гребные суда): вывалены/выкладываются/гребут */
  oars: { has: boolean; out: boolean; deploy: number; rowing: number } | null;
  /** пушечные порты: закрытые батареи (открыты/анимация/число) */
  gunPorts: { has: boolean; open: boolean; anim: number; count: number } | null;
  /** надетые фигура и украшение (магазин порта) */
  figureOn: string | null;
  decoOn: string | null;
  messages: HudMessage[];
  mapIslands: { x: number; z: number; r: number; name: string; discovered: boolean; type: string }[];
  mapShips: { x: number; z: number; kind: string; cat: 'war' | 'merchant'; surrendered: boolean }[];
  mapPlayer: { x: number; z: number; h: number };
  fps: number;
  dayF: number;
  proving: boolean;
  target: TargetReport | null;
  /** шлюпка за кормой: фаза спуска, ход, расстояние до кормы */
  boat: { phase: string; t: number; dist: number; speed: number; row: number } | null;
}

// ---------- товары (рынок в порту) ----------
export interface GoodDef { key: string; name: string; base: number; weight: number; icon: string; }
/** Товары: цена зависит от порта (priceMul) — основа торговых маршрутов */
export const GOODS: GoodDef[] = [
  { key: 'sugar', name: 'Сахар', base: 24, weight: 1, icon: '🍬' },
  { key: 'rum', name: 'Ром', base: 46, weight: 1, icon: '🍾' },
  { key: 'timber', name: 'Древесина', base: 9, weight: 1, icon: '🌲' },
  { key: 'spice', name: 'Пряности', base: 85, weight: 0.5, icon: '🌶' },
  { key: 'silk', name: 'Шёлк', base: 120, weight: 0.5, icon: '🧵' },
];

// ---------- скины (флаг / паруса / корпус) + гальюнные фигуры + украшения ----------
export interface SkinDef {
  id: string;
  kind: 'flag' | 'sail' | 'hull' | 'figure' | 'deco';
  name: string;
  price: number;
  flag?: FlagKind;
  hex?: number;   // -1 = вернуть штатный вид пресета
  swatch: string; // цвет кружка в UI
  desc?: string;  // описание (фигуры/украшения)
}
export const SKINS: SkinDef[] = [
  { id: 'flag.pirate', kind: 'flag', name: 'Весёлый Роджер', price: 150, flag: 'pirate', swatch: '#14100c' },
  { id: 'flag.pirateRed', kind: 'flag', name: 'Кровавый Роджер', price: 400, flag: 'pirateRed', swatch: '#8a1f16' },
  { id: 'flag.jollyCrown', kind: 'flag', name: 'Роджер с короной', price: 600, flag: 'jollyCrown', swatch: '#0d0a08' },
  { id: 'flag.blackplain', kind: 'flag', name: 'Проклятый (чёрный)', price: 500, flag: 'blackplain', swatch: '#0a0908' },
  { id: 'flag.maiden', kind: 'flag', name: 'Дева моря', price: 500, flag: 'maiden', swatch: '#efe7d2' },
  { id: 'flag.navy', kind: 'flag', name: 'Военный вымпел', price: 250, flag: 'navy', swatch: '#a3362c' },
  { id: 'flag.merchant', kind: 'flag', name: 'Торговый флаг', price: 200, flag: 'merchant', swatch: '#d8cfbd' },
  { id: 'sail.default', kind: 'sail', name: 'Штатная парусина', price: 0, hex: -1, swatch: '#e9dcc2' },
  { id: 'sail.black', kind: 'sail', name: 'Чёрные паруса', price: 500, hex: 0x23232a, swatch: '#23232a' },
  { id: 'sail.red', kind: 'sail', name: 'Багряные паруса', price: 450, hex: 0x8a3a30, swatch: '#8a3a30' },
  { id: 'sail.blue', kind: 'sail', name: 'Лазурные паруса', price: 400, hex: 0x51749a, swatch: '#51749a' },
  { id: 'sail.emerald', kind: 'sail', name: 'Изумрудные паруса', price: 400, hex: 0x4e7a5a, swatch: '#4e7a5a' },
  { id: 'hull.default', kind: 'hull', name: 'Естественное дерево', price: 0, hex: -1, swatch: '#7a5c38' },
  { id: 'hull.darkoak', kind: 'hull', name: 'Тёмный дуб', price: 350, hex: 0x8a7460, swatch: '#8a7460' },
  { id: 'hull.black', kind: 'hull', name: 'Чёрный корпус', price: 550, hex: 0x4a4a50, swatch: '#4a4a50' },
  { id: 'hull.blue', kind: 'hull', name: 'Адмиральский синий', price: 450, hex: 0x6a7a9a, swatch: '#6a7a9a' },
  { id: 'hull.crimson', kind: 'hull', name: 'Багровый корпус', price: 450, hex: 0xa86058, swatch: '#a86058' },
  // гальюнные фигуры — резные украшения форштевня (порт)
  ...FIGUREHEADS.map(f => ({
    id: f.id, kind: 'figure' as const, name: f.name, price: f.price,
    swatch: f.swatch, desc: f.desc,
  })),
  // украшения бортов — золотые узоры/вензеля/эмблемы (порт)
  ...DECOS.map(d => ({
    id: d.id, kind: 'deco' as const, name: d.name, price: d.price,
    swatch: '#d8ab48', desc: d.desc,
  })),
];

// ---------- улучшения корабля (верфь) ----------
export interface ShipUpgrades { hull: number; sails: number; masts: number; cargo: number; }
export const UPGRADE_MAX = 3;
export const UPGRADE_INFO: { key: keyof ShipUpgrades; name: string; desc: string; icon: string }[] = [
  { key: 'hull', name: 'Обшивка корпуса', desc: '+15% прочности корпуса за уровень', icon: '🛡' },
  { key: 'sails', name: 'Парусина', desc: '+15% прочности парусов за уровень', icon: '⛵' },
  { key: 'masts', name: 'Мачты и такелаж', desc: '+20% прочности мачт за уровень', icon: '⚓' },
  { key: 'cargo', name: 'Переоборудование трюма', desc: '+20% грузоподъёмности за уровень', icon: '📦' },
];

export function goodName(key: string): string {
  return GOODS.find(g => g.key === key)?.name ?? key;
}

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
  /** спуск/подъём шлюпки и управление ею на воде (клавиша B) */
  boatLaunch: BoatLaunch | null = null;

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

  // ===== Экономика порта =====
  /** ближайшая гавань (для подсказки швартовки) */
  nearPort: PortDef | null = null;
  /** порт, в котором стоим */
  dockedPort: PortDef | null = null;
  /** улучшения по типам судов (сохраняются при возврате к модели) */
  shipUpgrades: Record<string, ShipUpgrades> = {};
  /** купленные скины */
  skinsOwned = new Set<string>(['flag.pirate', 'sail.default', 'hull.default', 'figure.stock', 'deco.none']);
  /** надетые скины (переносятся на любой корабль игрока) */
  skinsOn: { flag: FlagKind | null; sail: number | null; hull: number | null;
    figure: string | null; deco: string | null } =
    { flag: null, sail: null, hull: null, figure: null, deco: null };

  // ===== Полигон (мини-игра проверки повреждений) =====
  proving = false;                // активен ли режим полигона
  /** ватага пиратов на острове логова (густо, по ТЗ) */
  lairFolk: LandFolk | null = null;
  pgTarget: AIShip | null = null; // мишень на якоре
  pgModel = 'fluyt';              // модель мишени
  pgReturnFire = false;           // отвечает ли мишень огнём
  private PG_ANCHOR = new THREE.Vector3(3200, 0, 2300); // чистая вода (запас до берега >1.1 км) вдали от островов

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
    // модель моря (Task 27): физическая или «волна-опора» — до
    // создания кораблей (набор волн задаёт и посадку)
    SEA.model = this.settings.weather.seaModel;
    this.weather.onThunder = (dist) => this.audio.thunder(dist);
    this.applyFx(this.settings.fx);
    this.updateParticleScale();
    this.world = new World();
    this.worldGroup.add(this.world.group);
    this.worldGroup.add(this.particles.points);
    this.worldGroup.add(this.particles.firePoints); // огонь — аддитивный пул
    this.gibs.addTo(this.worldGroup);
    initDebris(this.worldGroup);
    setCrewFx(this.gibs, this.particles);
    Ship.gibs = this.gibs;
    this.world.onDiscover = (isl) => this.pushMessage(`Открыт остров: ${isl.name}!`);

    this.spawnShips();
    this.wireEvents();

    this.hud = this.makeHud();
    (window as unknown as { __game?: Game }).__game = this;
    // THREE для E2E-тестов (повороты кватернионами в eval без бандла)
    (window as unknown as { __THREE?: typeof THREE }).__THREE = THREE;
    // высота суши для E2E (проверки лагеря/островов)
    (window as unknown as { __heightAt?: (x: number, z: number) => number }).__heightAt = heightAt;
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
      c.camera, c.aimPort, c.aimStarboard, c.fire, c.repair, c.map, c.help, c.oars, c.boat,
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

  /** Переключение модели моря (Task 27): физическая (Архимед по
   *  точкам корпуса) или «волна-опора» (по файлу игрока «Перун» —
   *  корабль идёт по поверхности, нос всходит на волну). Волны
   *  живут в uniform-массивах шейдера — переключение мгновенное */
  applySeaModel(model: 'physical' | 'riding', announce = true) {
    if (SEA.model === model) return;
    SEA.model = model;
    // сброс вертикальной динамики кораблей (пружина riding-режима
    // подхватит посадку сама; у физической — Архимед)
    if (this.player) {
      this.player.velocity.y = 0;
      for (const a of this.aiShips) a.ship.velocity.y = 0;
    }
    if (announce) {
      this.pushMessage(model === 'riding'
        ? 'Море: волна-опора — корабль идёт по поверхности волн'
        : 'Море: физическое — Архимед по точкам корпуса');
    }
  }

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
    // боезапас: изменение настройки сразу выдается игроку (песочница)
    const prevAmmo = prev.gameplay.startingAmmo;
    const nextAmmo = s.gameplay.startingAmmo;
    if (prevAmmo.ball !== nextAmmo.ball || prevAmmo.chain !== nextAmmo.chain
      || prevAmmo.grape !== nextAmmo.grape || prevAmmo.fire !== nextAmmo.fire) {
      this.player.ammo = { ...nextAmmo };
      this.pushMessage(`Боезапас: ядра ${nextAmmo.ball} · книппели ${nextAmmo.chain} · картечь ${nextAmmo.grape} · зажигательные ${nextAmmo.fire}`);
    }
    // кошелёк: смена настройки стартового золота применяется сразу
    if (prev.gameplay.startMoney !== s.gameplay.startMoney) {
      this.player.gold = s.gameplay.startMoney;
      this.pushMessage(`Кошелёк капитана: ${s.gameplay.startMoney} зол.`);
    }
    // прочность: перемасштабировать корпуса/парусы/мачты ВСЕХ кораблей
    if (prev.gameplay.hullDurability !== s.gameplay.hullDurability) {
      const k = s.gameplay.hullDurability / prev.gameplay.hullDurability;
      const rescale = (sh: Ship) => {
        sh.hullMax *= k; sh.hullHP *= k;
        sh.sailMax *= k; sh.sailHP *= k;
        sh.mastMaxHP *= k;
        for (let i = 0; i < sh.mastHP.length; i++) sh.mastHP[i] *= k;
      };
      rescale(this.player);
      for (const a of this.aiShips) rescale(a.ship);
      if (this.pgTarget) rescale(this.pgTarget.ship);
      this.pushMessage(`Прочность кораблей: ×${s.gameplay.hullDurability.toFixed(2)}`);
    }
    this.water.setFoamQuality(g.foamQuality);
    this.rig.camera.far = g.drawDistance * 2 + 4000;
    this.rig.camera.updateProjectionMatrix();
    this.sky.setDomeScale(g.drawDistance / 6500 * 1.12);
    (this.scene.fog as THREE.FogExp2).density = this.fogBase();
    this.audio.setVolume(s.audio.volume);
    this.input.setPreventCodes(this.preventCodes());
    this.combat.infiniteAmmo = s.gameplay.infiniteAmmo;
    this.applyFx(s.fx);
    if (prev.weather.mode !== s.weather.mode
      || prev.weather.windSpeed !== s.weather.windSpeed
      || prev.weather.windDir !== s.weather.windDir) {
      this.weather.applySettings(s.weather);
    }
    // модель моря — мгновенное переключение (Task 27)
    if (prev.weather.seaModel !== s.weather.seaModel) {
      this.applySeaModel(s.weather.seaModel);
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
    // прочность кораблей — из настроек; боезапас игрока — стартовый набор
    // с реалистичной недостачей 1–10% (порох отсырел, расстреляли, не доехало)
    const gp = this.settings.gameplay;
    const startAmmo = gp.ammoJitter
      ? rollStartingAmmo(gp.startingAmmo).ammo
      : { ...gp.startingAmmo };
    const playerOpts = { durabilityMul: gp.hullDurability, ammo: startAmmo };
    const aiOpts = { durabilityMul: gp.hullDurability };
    // игрок: шлюп в глубокой воде за пирсом
    this.player = new Ship('sloop', true, this.wind, terrain, this.particles, playerOpts);
    const seaDir = new THREE.Vector3().subVectors(this.world.port.dockEnd,
      new THREE.Vector3(this.world.islands[0].cx, 0, this.world.islands[0].cz)).setY(0).normalize();
    this.spawnPos = this.world.port.dockEnd.clone().addScaledVector(seaDir, 130);
    this.player.position.copy(this.spawnPos);
    this.player.position.y = 0;
    this.player.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(seaDir.x, seaDir.z), 0));
    this.player.gold = this.settings.gameplay.startMoney;
    this.player.cargo = { sugar: 0, rum: 0, timber: 0 };
    this.worldGroup.add(this.player.visual.group);
    this.worldGroup.add(this.player.foam.mesh);
    this.worldGroup.add(this.player.wake.mesh);

    // шлюпка за кормой: спуск на воду и управление (клавиша B)
    this.boatLaunch = new BoatLaunch({
      ship: this.player, worldGroup: this.worldGroup, particles: this.particles,
      islands: () => this.world.islands,
      msg: (t) => this.pushMessage(t),
      onSplash: () => this.audio.splash(0),
    });

    // торговцы (спавн в проверенно глубокой воде)
    const routes: THREE.Vector3[][] = [
      [new THREE.Vector3(850, 0, -380), new THREE.Vector3(500, 0, 760), new THREE.Vector3(-350, 0, 560), new THREE.Vector3(-100, 0, -80)],
      [new THREE.Vector3(-1350, 0, -260), new THREE.Vector3(-900, 0, -520), new THREE.Vector3(-380, 0, -740), new THREE.Vector3(-700, 0, -60)],
    ];
    const safeSpawns = [new THREE.Vector3(820, 0, -150), new THREE.Vector3(-1000, 0, -350)];
    const traderModels = ['fluyt', 'pinnace']; // флейт и пинасс — торговые суда эпохи
    routes.forEach((route, i) => {
      const trader = new Ship(traderModels[i], false, this.wind, terrain, this.particles, aiOpts);
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
    const caravel = new Ship('caravel', false, this.wind, terrain, this.particles, aiOpts);
    caravel.position.copy(caravelRoute[0]);
    caravel.quaternion.setFromEuler(new THREE.Euler(0, -1.2, 0));
    caravel.gold = 340;
    caravel.cargo = { sugar: 14, rum: 9, timber: 30 };
    this.worldGroup.add(caravel.visual.group);
    this.worldGroup.add(caravel.foam.mesh);
    this.worldGroup.add(caravel.wake.mesh);
    this.aiShips.push(new AIShip(caravel, caravelRoute, 'route'));

    // галеон — флагман на якоре в гавани (для осмотра и проверки повреждений)
    const galleon = new Ship('galleon', false, this.wind, terrain, this.particles, aiOpts);
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
    const brig = new Ship('brig', false, this.wind, terrain, this.particles, aiOpts);
    brig.position.set(940, 0, 380);
    brig.crew = 52;
    this.worldGroup.add(brig.visual.group);
    this.worldGroup.add(brig.foam.mesh);
    this.worldGroup.add(brig.wake.mesh);
    this.aiShips.push(new AIShip(brig, patrol, 'patrol'));

    // фрегат Surprise — быстрый патруль южных маршрутов
    const surpriseRoute = [
      new THREE.Vector3(-350, 0, -1100), new THREE.Vector3(400, 0, -1500),
      new THREE.Vector3(1100, 0, -900), new THREE.Vector3(600, 0, -350),
    ];
    const surprise = new Ship('surprise', false, this.wind, terrain, this.particles, aiOpts);
    surprise.position.copy(surpriseRoute[0]);
    surprise.quaternion.setFromEuler(new THREE.Euler(0, 2.1, 0));
    surprise.crew = 170;
    this.worldGroup.add(surprise.visual.group);
    this.worldGroup.add(surprise.foam.mesh);
    this.worldGroup.add(surprise.wake.mesh);
    this.aiShips.push(new AIShip(surprise, surpriseRoute, 'patrol'));

    // ост-индец Amsterdam — тяжёлый торговец через весь архипелаг
    const eicRoute = [
      new THREE.Vector3(-1900, 0, 1300), new THREE.Vector3(-400, 0, 1500),
      new THREE.Vector3(900, 0, 1200), new THREE.Vector3(1800, 0, 200),
    ];
    const eic = new Ship('amsterdam', false, this.wind, terrain, this.particles, aiOpts);
    eic.position.copy(eicRoute[0]);
    eic.quaternion.setFromEuler(new THREE.Euler(0, -0.4, 0));
    eic.gold = 720;
    eic.cargo = { sugar: 40, rum: 22, timber: 55 };
    this.worldGroup.add(eic.visual.group);
    this.worldGroup.add(eic.foam.mesh);
    this.worldGroup.add(eic.wake.mesh);
    this.aiShips.push(new AIShip(eic, eicRoute, 'route'));

    // шлюп Lady Washington — каботажник у гавани (пушнинная торговля)
    const ladyRoute = [
      new THREE.Vector3(700, 0, 700), new THREE.Vector3(300, 0, 950),
      new THREE.Vector3(-100, 0, 800), new THREE.Vector3(250, 0, 550),
    ];
    const lady = new Ship('ladyw', false, this.wind, terrain, this.particles, aiOpts);
    lady.position.copy(ladyRoute[0]);
    lady.gold = 180;
    lady.cargo = { sugar: 6, rum: 3, timber: 12 };
    this.worldGroup.add(lady.visual.group);
    this.worldGroup.add(lady.foam.mesh);
    this.worldGroup.add(lady.wake.mesh);
    this.aiShips.push(new AIShip(lady, ladyRoute, 'route'));

    // === ПИРАТСКОЕ ЛОГОВО: эскадра у острова «Логово пиратов» ===
    // (рядом с полигоном): все под чёрными флагами, включая
    // легендарную «Чёрную жемчужину» — флагман на рейде
    this.spawnPirateFleet(aiOpts);

    this.combat = new CombatSystem(this.player, this.particles, (t, p) => this.bus.emit(t, p));
    this.combat.others = this.aiShips.map(a => a.ship);
    this.combat.addTo(this.worldGroup);
    this.combat.infiniteAmmo = gp.infiniteAmmo;
  }

  /** Пиратская эскадра в логове: 7 судов плотным кольцом у берега +
   *  2 патруля вокруг острова; флагман — «Чёрная жемчужина» */
  private spawnPirateFleet(aiOpts: { durabilityMul: number }) {
    const isl = this.world.islands.find(i => i.name === 'Логово пиратов');
    if (!isl) return;
    const terrain = (x: number, z: number) => heightAt(x, z);
    const ring = (aDeg: number, dist: number) => {
      const a = aDeg * Math.PI / 180;
      return new THREE.Vector3(isl.cx + Math.cos(a) * (isl.r + dist), 0, isl.cz + Math.sin(a) * (isl.r + dist));
    };
    // [модель, угол°, дистанция от берега, yaw, экипаж, золото, груз]
    const specs: [string, number, number, number, number, number, number[]][] = [
      ['blackpearl', 180, 95, 0.1, 120, 2600, [12, 8, 10, 4, 3]],
      ['sloop', 152, 55, 0.7, 20, 260, [3, 2, 4, 0, 0]],
      ['sloop', 208, 55, -0.6, 20, 240, [2, 3, 3, 1, 0]],
      ['brig', 122, 75, 1.1, 52, 720, [6, 4, 8, 2, 1]],
      ['mystique', 252, 65, -1.2, 92, 820, [5, 6, 4, 3, 2]],
      ['caravel', 92, 90, 2.0, 24, 420, [4, 3, 5, 1, 1]],
      ['cog', 300, 85, -2.2, 26, 380, [7, 2, 9, 0, 0]],
    ];
    for (const [model, a, dist, yaw, crew, gold, loot] of specs) {
      const sh = new Ship(model, false, this.wind, terrain, this.particles, aiOpts);
      sh.position.copy(ring(a, dist));
      sh.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
      sh.crew = crew;
      sh.gold = gold;
      sh.cargo = { sugar: loot[0], rum: loot[1], timber: loot[2], spice: loot[3], silk: loot[4] };
      setFlagKind(sh.visual, 'pirate'); // все — под чёрным флагом
      this.worldGroup.add(sh.visual.group);
      this.worldGroup.add(sh.foam.mesh);
      this.worldGroup.add(sh.wake.mesh);
      this.aiShips.push(new AIShip(sh, [], 'anchored'));
    }
    // два патруля вокруг острова
    for (const [model, a0, crew, gold] of [
      ['sloop', 0, 18, 300], ['brig', 180, 48, 650],
    ] as [string, number, number, number][]) {
      const sh = new Ship(model, false, this.wind, terrain, this.particles, aiOpts);
      sh.position.copy(ring(a0, 280));
      sh.crew = crew;
      sh.gold = gold;
      setFlagKind(sh.visual, 'pirate');
      this.worldGroup.add(sh.visual.group);
      this.worldGroup.add(sh.foam.mesh);
      this.worldGroup.add(sh.wake.mesh);
      const route: THREE.Vector3[] = [];
      for (let k = 0; k < 6; k++) route.push(ring(a0 + k * 60, 280));
      this.aiShips.push(new AIShip(sh, route, 'patrol'));
    }
    // ПИРАТЫ НА САМОМ ОСТРОВЕ: густая ватага «человечков» — ходоки
    // по тропам, дворовые у костра, часовые у кромки воды; картечь
    // по берегу выкашивает их (combat.onGroundHit → killNear)
    this.lairFolk = buildLandFolk(folkCountFor(isl.r), {
      cx: isl.cx, cz: isl.cz, r: isl.r, maxH: isl.maxH,
      heightAt: (x, z) => heightAt(x, z), seed: 4242,
    });
    this.worldGroup.add(this.lairFolk.group);
    this.worldGroup.add(this.lairFolk.props); // костры лагеря
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

  // ===== Карта окружения для PBR-металла =====
  // Панорама 64×32 из цветов неба (sky/horizon/fog) + пятно солнца
  // по sunDir → PMREM → scene.environment: орудия, фурнитура и золото
  // отражают небо, а не выглядят чёрными «картонками». Дереву (metalness
  // 0.05) отражения почти не видны — только лёгкий подсвет.
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTex: THREE.DataTexture | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envNextUpd = 2;
  private updateEnvMap(dayF: number, env: { sky: THREE.Color; horizon: THREE.Color; fog: THREE.Color; sun: THREE.Color }) {
    if (this.envNextUpd > 0) { this.envNextUpd -= 1; return; }
    this.envNextUpd = 150; // ~2.5 с при 60 к/с
    const W = 64, H = 32;
    if (!this.envTex) {
      this.envTex = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H,
        THREE.RGBAFormat, THREE.UnsignedByteType);
      this.envTex.mapping = THREE.EquirectangularReflectionMapping;
      this.envTex.minFilter = THREE.LinearFilter;
      this.envTex.magFilter = THREE.LinearFilter;
      this.envTex.generateMipmaps = false;
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
    }
    const d = this.envTex.image.data as Uint8Array;
    const sd = this.sky.sunDir;
    const sunI = Math.max(0.15, dayF);
    const water = env.fog.clone().multiplyScalar(0.4);
    const c = new THREE.Color();
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;                 // v=0 низ (вода), v=1 зенит
      const dy = Math.sin((v - 0.5) * Math.PI);
      const rh = Math.sqrt(Math.max(0, 1 - dy * dy));
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const phi = (u - 0.5) * Math.PI * 2;
        const dx = Math.cos(phi) * rh, dz = Math.sin(phi) * rh;
        // небо над горизонтом, тёмная вода под ним
        if (dy >= 0) c.copy(env.horizon).lerp(env.sky, Math.pow(Math.min(1, dy * 1.6), 0.6));
        else c.copy(env.horizon).lerp(water, Math.min(1, -dy * 2.2));
        // солнце: яркое ядро + мягкий ореол
        const s = Math.max(0, dx * sd.x + dy * sd.y + dz * sd.z);
        const core = Math.pow(s, 380) * 255 * sunI;
        const halo = Math.pow(s, 14) * 60 * sunI;
        const k = Math.min(1, core + halo);
        if (k > 0) c.lerp(env.sun, k);
        const o = (y * W + x) * 4;
        d[o] = Math.min(255, Math.round(c.r * 255));
        d[o + 1] = Math.min(255, Math.round(c.g * 255));
        d[o + 2] = Math.min(255, Math.round(c.b * 255));
        d[o + 3] = 255;
      }
    }
    this.envTex.needsUpdate = true;
    this.envRT?.dispose();
    this.envRT = this.pmrem!.fromEquirectangular(this.envTex);
    this.scene.environment = this.envRT.texture;
    // сдержанно: стилистика — не «хромированный» флот
    (this.scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = 0.75;
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
    const ship = new Ship(modelId, false, this.wind, terrain, this.particles,
      { durabilityMul: this.settings.gameplay.hullDurability });
    ship.position.copy(this.pgTargetPos());
    ship.position.y = 0;
    ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)); // параллельно игроку
    ship.noSurrender = true;
    this.worldGroup.add(ship.visual.group);
    this.worldGroup.add(ship.foam.mesh);
    this.worldGroup.add(ship.wake.mesh);
    const ai = new AIShip(ship, [], 'anchored');
    ai.returnFire = this.pgReturnFire;
    // мишень с поставленным рангоутом: стрелять есть по чему — и по парусам
    ship.sailOverride = 0.85;
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
    clearDebris(); // обломки старой мишени не мешают новому заходу
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
    // боезапас полигона — не меньше стандартного набора
    const am = this.settings.gameplay.startingAmmo;
    p.ammo = {
      ball: Math.max(250, am.ball),
      chain: Math.max(120, am.chain),
      grape: Math.max(150, am.grape),
      fire: Math.max(60, am.fire),
    };
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
    clearDebris();
    s.position.copy(this.pgTargetPos());
    s.position.y = 0;
    s.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const am = this.settings.gameplay.startingAmmo;
    this.player.ammo = {
      ball: Math.max(250, am.ball),
      chain: Math.max(120, am.chain),
      grape: Math.max(150, am.grape),
      fire: Math.max(60, am.fire),
    };
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

  // ===== Смена корабля игрока (верфь в порту — ЗА ЗОЛОТО;
  //  на полигоне смена бесплатная — песочница) =====
  changeShip(presetId: string, free = false): string | null {
    if (!PRESETS[presetId]) return 'Судно не найдено на верфи';
    if (presetId === this.player.preset.id) return 'Вы уже на этом корабле';
    const old = this.player;
    // шлюпку вернуть на шлюпбалки до пересборки корабля
    this.boatLaunch?.abort();
    // сохранить состояние игрока
    const pos = old.position.clone();
    const quat = old.quaternion.clone();
    let gold = old.gold;
    const planks = old.planks, crew = old.crew;
    const cargo = { ...old.cargo };
    const ammo = { ...old.ammo };
    const sailTarget = old.sailTarget;
    if (!free) {
      const price = shipPrice(PRESETS[presetId]);
      const refund = Math.round(shipPrice(old.preset) * 0.4);
      const cost = price - refund;
      if (gold < cost) return `Нужно ${cost} зол. (цена ${price} − возврат за текущий ${refund})`;
      gold -= cost;
      this.pushMessage(`Куплено: ${PRESETS[presetId].name} за ${price} зол. (возврат ${refund})`);
    }
    // убрать старый корабль из сцены
    this.worldGroup.remove(old.visual.group);
    this.worldGroup.remove(old.foam.mesh);
    this.worldGroup.remove(old.wake.mesh);
    old.dispose();
    // новый корабль (прочность — из настроек)
    const gp = this.settings.gameplay;
    const np = new Ship(presetId, true, this.wind, (x, z) => heightAt(x, z), this.particles,
      { durabilityMul: gp.hullDurability, ammo: { ...gp.startingAmmo } });
    // не отнимать боезапас при смене (берём максимум из текущего и стартового)
    (['ball', 'chain', 'grape', 'fire'] as const).forEach(k => {
      np.ammo[k] = Math.max(ammo[k] ?? 0, np.ammo[k] ?? 0);
    });
    np.position.copy(pos);
    np.position.y = 0;
    np.quaternion.copy(quat);
    np.velocity.set(0, 0, 0);
    np.angular.set(0, 0, 0);
    np.gold = gold;
    np.planks = planks;
    np.cargo = cargo;
    // экипаж: в порту команда переходит на новый корабль (в пределах
    // штата), а на ПОЛИГОНЕ (бесплатная смена) — набирается под
    // НОВЫЙ корабль по норме (по замечанию игрока: количество команды
    // должно меняться вместе с судном)
    np.crew = free
      ? Math.round(np.preset.maxCrew * 0.8)
      : Math.min(crew, np.preset.maxCrew);
    np.sailTarget = sailTarget;
    np.sailOverride = null;
    np.anchored = old.anchored;
    np.oarsOut = false; // вёсла нового корабля убраны
    np.rowing = 0;
    np.portsOpen = false; // порты задраены (батареи молчат до команды P)
    np.portsT = 0;
    // улучшения и скины этого игрока — на новый корабль
    this.applyUpgrades(np);
    this.applySkins(np);
    this.player = np;
    this.combat.player = np;
    // шлюпка нового корабля — свой контроллер спуска (след пены
    // старой шлюпки снимается со сцены)
    this.boatLaunch?.dispose();
    this.boatLaunch = new BoatLaunch({
      ship: np, worldGroup: this.worldGroup, particles: this.particles,
      islands: () => this.world.islands,
      msg: (t) => this.pushMessage(t),
      onSplash: () => this.audio.splash(0),
    });
    this.combat.resizeReloads(np.visual.gunsPort.length + np.visual.gunsStarboard.length);
    this.combat.aim.active = false;
    this.combat.aim.target = null;
    this.boardingTarget = null;
    this.worldGroup.add(np.visual.group);
    this.worldGroup.add(np.foam.mesh);
    this.worldGroup.add(np.wake.mesh);
    this.rig.snap();
    this.pushMessage(`⚓ Новый корабль: ${np.preset.name} (${np.preset.shipClass})` +
      (free ? ` — экипаж ${np.crew}/${np.preset.maxCrew}` : ''));
    return null;
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

  // ---------- порт (любая гавань архипелага) ----------
  canDock(): boolean {
    if (this.docked || this.player.sinking) { this.nearPort = null; return false; }
    this.nearPort = null;
    if (this.player.speedKnots() < 4.5) {
      let best = Infinity;
      for (const p of this.world.ports) {
        const d = this.player.position.distanceTo(p.dockEnd);
        if (d < 110 && d < best) { best = d; this.nearPort = p; }
      }
    }
    return !!this.nearPort;
  }

  dock() {
    this.docked = true;
    this.dockedPort = this.nearPort ?? this.world.ports[0];
    this.player.anchored = true;
    this.player.sailTarget = 0;
    this.player.velocity.multiplyScalar(0.1);
    this.audio.bell();
    const p = this.dockedPort;
    this.pushMessage(`Швартовка: ${p.name} — ${p.tierName.toLowerCase()}, ${p.population} жителей`);
  }

  undock() {
    this.docked = false;
    this.player.anchored = false;
    const port = this.dockedPort ?? this.world.ports[0];
    // лёгкий толчок от пирса
    const away = new THREE.Vector3().subVectors(this.player.position, port.dockEnd).setY(0).normalize();
    this.player.velocity.addScaledVector(away, 1.2);
    this.dockedPort = null;
    this.pushMessage('Отдать швартовы!');
  }

  // ---------- грузоподъёмность ----------
  /** Занято трюма (т): товары + вооружение (снаряды) + команда с
   *  припасами + доски. Суммарно не больше грузоподъёмности! */
  cargoUsedT(s: Ship = this.player): number {
    let t = 0;
    for (const g of GOODS) t += (s.cargo[g.key] || 0) * g.weight;
    t += (s.ammo.ball || 0) * 0.02 + (s.ammo.chain || 0) * 0.03
      + (s.ammo.grape || 0) * 0.025 + (s.ammo.fire || 0) * 0.02;
    t += s.crew * 0.12 + s.planks * 0.15;
    return +t.toFixed(1);
  }

  /** Полная грузоподъёмность (т) с учётом улучшения трюма */
  cargoMaxT(s: Ship = this.player): number {
    const up = this.shipUpgrades[s.preset.id];
    return +(s.preset.cargo * (1 + 0.2 * (up?.cargo ?? 0))).toFixed(1);
  }

  get repairCost(): number {
    const base = Math.ceil((this.player.hullMax - this.player.hullHP) * 2.2);
    // в большом порту верфи дешевле (конкуренция), на пристани — дороже
    const mul = this.dockedPort ? 1.2 - this.dockedPort.tier * 0.1 : 1;
    return Math.max(1, Math.round(base * mul));
  }

  portRepair() {
    const cost = this.repairCost;
    if (cost <= 0) return 'Корпус уже в порядке';
    if (this.player.gold < cost) return 'Не хватает золота';
    this.player.gold -= cost;
    this.player.hullHP = this.player.hullMax;
    this.player.sailHP = this.player.sailMax;
    this.player.water = 0;
    this.player.leakRate = 0;
    this.pushMessage(`Полный ремонт выполнен (-${cost} зол.)`);
    return null;
  }

  portBuyAmmo(kind: AmmoType): string | null {
    const price = kind === 'ball' ? 4 : kind === 'grape' ? 5 : kind === 'chain' ? 9 : 12;
    const qty = kind === 'chain' ? 5 : 10;
    const w = qty * (kind === 'chain' ? 0.03 : kind === 'grape' ? 0.025 : 0.02);
    if (this.cargoUsedT() + w > this.cargoMaxT()) return 'Трюм полон — вооружение не влезает';
    if (this.player.gold < price) return 'Не хватает золота';
    this.player.gold -= price;
    this.player.ammo[kind] += qty;
    return null;
  }

  portBuyPlanks(): string | null {
    if (this.cargoUsedT() + 5 * 0.15 > this.cargoMaxT()) return 'Трюм полон — доски не влезают';
    if (this.player.gold < 15) return 'Не хватает золота';
    this.player.gold -= 15;
    this.player.planks += 5;
    return null;
  }

  portHireCrew(): string | null {
    if (this.player.crew >= this.player.preset.maxCrew) return 'Команда уже полная';
    if (this.cargoUsedT() + 0.12 > this.cargoMaxT()) return 'Трюм полон — припасы для матроса не влезают';
    if (this.player.gold < 30) return 'Не хватает золота';
    this.player.gold -= 30;
    this.player.crew++;
    return null;
  }

  // ---------- рынок товаров (цены зависят от порта) ----------
  /** цена товара в ТЕКУЩЕМ порту: покупка / продажа */
  portGoodPrice(g: GoodDef, mode: 'buy' | 'sell'): number {
    const m = this.dockedPort?.priceMul ?? 1;
    return Math.max(1, Math.round(g.base * m * (mode === 'buy' ? 1 : 0.82)));
  }

  portBuyGood(key: string, qty: number): string | null {
    const g = GOODS.find(x => x.key === key);
    if (!g || qty <= 0) return 'Товар не найден';
    const total = this.portGoodPrice(g, 'buy') * qty;
    if (this.cargoUsedT() + qty * g.weight > this.cargoMaxT()) return 'Трюм полон — не влезает';
    if (this.player.gold < total) return 'Не хватает золота';
    this.player.gold -= total;
    this.player.cargo[key] = (this.player.cargo[key] || 0) + qty;
    return null;
  }

  portSellGood(key: string, qty: number): string | null {
    const g = GOODS.find(x => x.key === key);
    if (!g) return 'Товар не найден';
    const have = this.player.cargo[key] || 0;
    const n = Math.min(qty, have);
    if (n <= 0) return 'Этого товара нет в трюме';
    const total = this.portGoodPrice(g, 'sell') * n;
    this.player.cargo[key] = have - n;
    this.player.gold += total;
    this.pushMessage(`Продано: ${g.name} ×${n} — +${total} зол.`);
    return null;
  }

  portSellCargo(): string | null {
    let total = 0;
    for (const g of GOODS) {
      const amt = this.player.cargo[g.key] || 0;
      if (amt > 0) total += amt * this.portGoodPrice(g, 'sell');
      this.player.cargo[g.key] = 0;
    }
    if (total <= 0) return 'Трюм пуст';
    this.player.gold += total;
    this.pushMessage(`Груз продан: +${total} зол.`);
    return null;
  }

  // ---------- улучшения корабля ----------
  upgradePrice(kind: keyof ShipUpgrades, level: number): number {
    const base = shipPrice(this.player.preset) * 0.15;
    return Math.round(base * [1, 2.2, 3.6][level - 1] / 10) * 10;
  }

  buyUpgrade(kind: keyof ShipUpgrades): string | null {
    const id = this.player.preset.id;
    const up = this.shipUpgrades[id] ?? (this.shipUpgrades[id] = { hull: 0, sails: 0, masts: 0, cargo: 0 });
    if (up[kind] >= UPGRADE_MAX) return 'Достигнут максимальный уровень';
    const price = this.upgradePrice(kind, up[kind] + 1);
    if (this.player.gold < price) return 'Не хватает золота';
    this.player.gold -= price;
    up[kind]++;
    this.applyUpgrades(this.player);
    this.pushMessage(`Улучшение установлено (${UPGRADE_INFO.find(u => u.key === kind)?.name})`);
    return null;
  }

  /** Перемасштабировать прочность/груз корабля под улучшения его модели */
  private applyUpgrades(sh: Ship) {
    const up = this.shipUpgrades[sh.preset.id];
    if (!up) return;
    const dur = this.settings.gameplay.hullDurability;
    const kH = (sh.preset.hullHP * dur * (1 + 0.15 * up.hull)) / Math.max(1, sh.hullMax);
    sh.hullMax *= kH; sh.hullHP *= kH;
    const kS = (sh.preset.sailHP * dur * (1 + 0.15 * up.sails)) / Math.max(1, sh.sailMax);
    sh.sailMax *= kS; sh.sailHP *= kS;
    const kM = (32 * dur * (1 + 0.2 * up.masts)) / Math.max(1, sh.mastMaxHP);
    sh.mastMaxHP *= kM;
    for (let i = 0; i < sh.mastHP.length; i++) sh.mastHP[i] *= kM;
  }

  // ---------- скины (флаг / паруса / корпус) ----------
  buySkin(id: string): string | null {
    const sk = SKINS.find(s => s.id === id);
    if (!sk) return 'Скин не найден';
    if (this.skinsOwned.has(id)) return 'Уже куплено';
    if (this.player.gold < sk.price) return 'Не хватает золота';
    this.player.gold -= sk.price;
    this.skinsOwned.add(id);
    return this.equipSkin(id);
  }

  equipSkin(id: string): string | null {
    const sk = SKINS.find(s => s.id === id);
    if (!sk) return 'Скин не найден';
    if (!this.skinsOwned.has(id)) return 'Скин ещё не куплен';
    if (sk.kind === 'flag' && sk.flag) {
      this.skinsOn.flag = sk.flag;
      setFlagKind(this.player.visual, sk.flag);
    } else if (sk.kind === 'sail') {
      this.skinsOn.sail = sk.hex !== undefined && sk.hex >= 0 ? sk.hex : null;
      setSailColor(this.player.visual, this.skinsOn.sail ?? this.player.preset.colors.sail);
    } else if (sk.kind === 'hull') {
      this.skinsOn.hull = sk.hex !== undefined && sk.hex >= 0 ? sk.hex : null;
      setHullTint(this.player.visual, this.skinsOn.hull ?? 0xffffff);
    } else if (sk.kind === 'figure') {
      this.skinsOn.figure = sk.id;
      setFigurehead(this.player.visual, this.player.preset, sk.id);
    } else if (sk.kind === 'deco') {
      this.skinsOn.deco = sk.id;
      setDecoration(this.player.visual, this.player.preset, sk.id);
    }
    this.pushMessage(`Скин применён: ${sk.name}`);
    return null;
  }

  /** Надетые скины — на любой корабль игрока (после смены/покупки) */
  private applySkins(sh: Ship) {
    if (this.skinsOn.flag) setFlagKind(sh.visual, this.skinsOn.flag);
    if (this.skinsOn.sail != null) setSailColor(sh.visual, this.skinsOn.sail);
    if (this.skinsOn.hull != null) setHullTint(sh.visual, this.skinsOn.hull);
    // фигура и украшение — на любом корабле (штатные по умолчанию)
    if (this.skinsOn.figure) setFigurehead(sh.visual, sh.preset, this.skinsOn.figure);
    if (this.skinsOn.deco) setDecoration(sh.visual, sh.preset, this.skinsOn.deco);
  }

  // ---------- быстрое перемещение (глобальная карта) ----------
  /** Телепорт к открытому острову: точка в море у берега со стороны
   *  текущего положения игрока. Возвращает ошибку или null при успехе. */
  fastTravelTo(islandName: string): string | null {
    const isl = this.world.islands.find(i => i.name === islandName);
    if (!isl) return 'Остров не найден';
    if (!this.started) this.start();
    const p = this.player;
    if (p.sinking) return 'Мы тонем — не до путешествий';
    const d = Math.hypot(p.position.x - isl.cx, p.position.z - isl.cz);
    if (d < isl.r + 420) return 'Вы уже рядом с этим островом';
    // ищем глубокую воду у берега: расходящиеся кольца от r+240,
    // в каждом 16 направлений, стартуя со стороны игрока
    const baseA = Math.atan2(p.position.x - isl.cx, p.position.z - isl.cz);
    let pos: THREE.Vector3 | null = null;
    outer:
    for (const rr of [isl.r + 240, isl.r + 400, isl.r + 600]) {
      for (let k = 0; k < 16; k++) {
        const a = baseA + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.4;
        const x = isl.cx + Math.sin(a) * rr;
        const z = isl.cz + Math.cos(a) * rr;
        if (heightAt(x, z) < -6) { pos = new THREE.Vector3(x, 0, z); break outer; }
      }
    }
    if (!pos) pos = new THREE.Vector3(isl.cx + isl.r + 700, 0, isl.cz);
    if (this.docked) this.undock();
    p.position.copy(pos);
    p.velocity.set(0, 0, 0);
    p.angular.set(0, 0, 0);
    p.anchored = false;
    p.wake.clear();
    p.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(isl.cx - pos.x, isl.cz - pos.z), 0));
    this.combat.aim.active = false;
    this.rig.snap();
    this.pushMessage(`Быстрое перемещение: ${isl.name}`);
    this.audio.bell();
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
        loot.push(`${goodName(k)} ×${amt}`);
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
    const bl = this.boatLaunch;

    // === В ШЛЮПКЕ (спущена/спускается/поднимается): управление
    //     кораблём отключено — только вёсла/румпель и камера ===
    if (bl && bl.phase !== 'stowed') {
      bl.steer = (inp.isDown(c.steerRight) ? 1 : 0) - (inp.isDown(c.steerLeft) ? 1 : 0);
      if (c.invertRudder) bl.steer = -bl.steer;
      bl.row = (inp.isDown(c.sailsUp) ? 1 : 0) - (inp.isDown(c.sailsDown) ? 1 : 0);
      if (inp.pressed(c.camera)) {
        this.rig.cycleMode();
        this.pushMessage(`Камера: ${CAMERA_LABEL[this.rig.mode]}`);
      }
      if (inp.pressed(c.boat)) {
        if (bl.phase === 'afloat') {
          const err = bl.tryHoist();
          if (err) this.pushMessage(err);
          else this.pushMessage('Команда на талях — шлюпка поднимается…');
        }
      }
      p.rudderTarget = 0;
      inp.endFrame();
      return;
    }

    // паруса / вёсла: W/S — паруса; на гребных судах Alt+W/S — гребля
    // вперёд/назад (вёсла достаются автоматически); O — вывалить/убрать
    // вёсла отдельной кнопкой. Вёсла достаются ТОЛЬКО когда гребут:
    // через 5 с без гребли убираются сами
    const altHeld = inp.isDown('AltLeft') || inp.isDown('AltRight');
    const hasOars = !!p.preset.oars;
    const rowSteer = altHeld && hasOars;
    if (!rowSteer) {
      if (inp.pressed(c.sailsUp)) { p.sailTarget = Math.min(3, p.sailTarget + 1); if (p.anchored) this.pushMessage('Сначала поднять якорь (F)'); }
      if (inp.pressed(c.sailsDown)) {
        if (p.sailTarget > 0) p.sailTarget = Math.max(0, p.sailTarget - 1);
      }
    }
    if (hasOars) {
      // Alt+W/S — гребля вперёд/назад; ПРОСТОЕ S при убранных парусах —
      // тоже задний ход (как у парусных судов, «спиной»): вёсла
      // вываливаются и гребут назад — не нужно угадывать про Alt
      const plainBack = !altHeld && inp.isDown(c.sailsDown)
        && p.sailTarget === 0 && !p.anchored;
      p.rowing = altHeld
        ? (inp.isDown(c.sailsUp) ? 1 : 0) - (inp.isDown(c.sailsDown) ? 1 : 0)
        : (plainBack ? -1 : 0);
      if (p.rowing !== 0) {
        if (!p.oarsOut) { p.oarsOut = true; this.pushMessage('Вёсла на воду!'); }
        p.oarsIdleT = 0;
      }
      if (inp.pressed(c.oars)) {
        p.oarsOut = !p.oarsOut;
        p.oarsIdleT = 0;
        this.pushMessage(p.oarsOut ? 'Вёсла вывалены' : 'Вёсла убраны');
      }
    } else {
      p.rowing = 0;
    }
    // пушечные порты: P — открыть/закрыть. Открыты: крышки подняты,
    // орудия выехали — батареи стреляют; закрыты — стреляют только
    // палубные орудия (механика по ТЗ пользователя)
    if (inp.pressed(c.gunports)) {
      if (p.visual.gunPorts.length) {
        p.portsOpen = !p.portsOpen;
        this.audio.bell();
        this.pushMessage(p.portsOpen
          ? 'Порты открыты — батареи к бою!'
          : 'Порты закрыты — орудия задраены');
      } else {
        this.pushMessage('На этом судне нет закрытых батарей');
      }
    }
    // авто-открытие портов при залпе с прицелом (удобство: игрок
    // жмёт огонь — команда готовит батареи, залп задержится на
    // время анимации крышек)
    if (p.visual.gunPorts.length && !p.portsOpen && this.combat
        && this.combat.isAiming() && inp.pressed(c.fire)) {
      p.portsOpen = true;
      this.pushMessage('Порты открываются — залп задержится!');
    }
    // задний ход: обычные суда — «спиной к ветру» (S при убранных
    // парусах); гребные — S (или Alt+S) гребут назад вёслами
    p.reverseThrust = !hasOars && !altHeld && inp.isDown(c.sailsDown) && p.sailTarget === 0 && !p.anchored;
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

    // шлюпка: B — спустить на воду (замечание игрока: управлять
    // шлюпкой, пока не вернёшься на борт; спуск/подъём — анимация)
    if (inp.pressed(c.boat)) {
      if (bl) {
        const err = bl.tryLaunch(this.docked);
        if (err) this.pushMessage(err);
        else {
          this.pushMessage('Шлюпка на талях — спуск на воду…');
          this.audio.bell();
          p.rudderTarget = 0;
          p.rowing = 0;
        }
      } else {
        this.pushMessage('На этом судне нет шлюпки');
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
      onFire: false, firePct: 0, anchored: false, grounded: false, sinking: false,
      ammoType: 'ball', ammoCounts: {}, planks: 0, gold: 0, cargo: {},
      cargoT: 0, cargoMaxT: 0,
      aiming: false, aimSide: '', aimRange: 0, gunsReadyPct: 0, targetName: null,
      cameraLabel: CAMERA_LABEL.iso, clock: '', seaState: 0, repairAction: null,
      canDock: false, nearPortName: null, canBoard: false, boardedName: null,
      shipId: 'sloop', shipName: '', shipClass: '', docked: false,
      portInfo: null, oars: null, gunPorts: null, figureOn: 'figure.stock', decoOn: 'deco.none',
      messages: [], mapIslands: [], mapShips: [], mapPlayer: { x: 0, z: 0, h: 0 },
      fps: 60, dayF: 1,
      proving: false, target: null, boat: null,
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
    h.firePct = clamp(p.fireIntensity, 0, 1);
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
    h.nearPortName = this.nearPort?.name ?? null;
    h.canBoard = !!this.boardingTarget;
    h.boardedName = this.boardingTarget?.ship.preset.name ?? null;
    h.shipId = p.preset.id;
    h.shipName = p.preset.name;
    h.shipClass = p.preset.shipClass;
    h.docked = this.docked;
    h.portInfo = this.docked && this.dockedPort
      ? { name: this.dockedPort.name, tierName: this.dockedPort.tierName, population: this.dockedPort.population }
      : null;
    h.oars = p.preset.oars
      ? { has: true, out: p.oarsOut, deploy: +p.oarsDeployT.toFixed(2), rowing: p.rowing }
      : null;
    h.gunPorts = p.visual.gunPorts.length
      ? { has: true, open: p.portsOpen, anim: +p.portsT.toFixed(2), count: p.visual.gunPorts.length }
      : null;
    h.figureOn = this.skinsOn.figure ?? 'figure.stock';
    h.decoOn = this.skinsOn.deco ?? 'deco.none';
    h.cargoT = this.cargoUsedT();
    h.cargoMaxT = this.cargoMaxT();
    h.messages = [...this.messages];
    h.mapIslands = this.world.islands.map(i => ({ x: i.cx, z: i.cz, r: i.r, name: i.name, discovered: this.world.discovered.has(i.name), type: i.type }));
    h.mapShips = this.aiShips.filter(a => !a.ship.sunk).map(a => ({
      x: a.ship.position.x, z: a.ship.position.z,
      kind: a.ship.preset.id, cat: a.ship.preset.category, surrendered: a.ship.surrendered,
    }));
    h.mapPlayer = { x: p.position.x, z: p.position.z, h: p.heading };
    h.fps = Math.round(this.fpsSmooth);
    // полигон: отчёт о мишени
    h.proving = this.proving;
    h.boat = this.boatLaunch
      ? { phase: this.boatLaunch.phase, t: +this.boatLaunch.t.toFixed(2),
          dist: +this.boatLaunch.distToHoist().toFixed(0),
          speed: +(Math.abs(this.boatLaunch.vel) * 1.944).toFixed(1),
          row: this.boatLaunch.row }
      : null;
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
  /** последнее значение счётчика зелёной воды игрока (для сообщений) */
  private lastGreenWater = 0;
  private lastGreenWaterMsgT = -99;
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
    // амплитуда волн — ТОЛЬКО от силы ветра (настройки больше нет):
    // 3 м/с ≈ 0.44 (рябь), 7.5 м/с ≈ 0.76 (свежий бриз),
    // 15 м/с ≈ 1.3 (крепкий), 22 м/с ≈ 1.8 (шторм), потолок 2.0;
    // swell набирается/спадает с запаздыванием — как настоящее море
    const ampTarget = clamp(0.22 + this.wind.speed * 0.072, 0.3, 2.0);
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

  /** Отладочный хук: высота водной поверхности в мировой точке (E2E) */
  waterHeight(x: number, z: number) {
    return waterHeightAt(x, z, this.time);
  }

  /** Отладочный хук: высота воды в ЯВНОЕ время t — для E2E-циклов,
   *  шагающих физику с собственным счётчиком времени (Task 27:
   *  замеры посадки шлюпки/корабля по тому же t, что и физика) */
  waterHeightAtT(x: number, z: number, t: number) {
    return waterHeightAt(x, z, t);
  }

  /** Разрыв снаряда у гавани: рыбацкие шлюпки в радиусе идут ко дну —
   *  щепа гибами, брызги, выброшенные на песок разносит вдребезги.
   *  Возвращает число поражённых шлюпок */
  sinkBoatsAt(x: number, z: number, r: number): number {
    const hit = this.world.hitBoats(x, z, r);
    for (const b of hit) {
      const y = b.mesh.position.y + 0.28;
      for (let k = 0; k < 8; k++) {
        this.gibs.spawnPart(
          new THREE.Vector3(b.x + (Math.random() - 0.5) * 1.4, y,
            b.z + (Math.random() - 0.5) * 2.6),
          new THREE.Vector3((Math.random() - 0.5) * 4.6, 1.5 + Math.random() * 2.8,
            (Math.random() - 0.5) * 4.6),
          0.06, 0.06, 0.45 + Math.random() * 0.75,
          Math.random() < 0.5 ? 0x8a6a42 : 0x5c4128, 1.7 + Math.random() * 1.3);
      }
      this.particles.debris(b.x, y + 0.35, b.z, 9, 1.0);
      if (b.floating) this.particles.splash(b.x, 0.1, b.z, 1.15);
    }
    if (hit.length > 0) {
      this.pushMessage(hit.length === 1
        ? 'Рыбацкая шлюпка пошла ко дну'
        : `Рыбацкие шлюпки пошли ко дну: ${hit.length}`);
    }
    return hit.length;
  }

  // ---------- пожары: перекидывание огня на соседей + дождь ----------
  /** Шаг системы пожаров (вызывается из кадра с dt кадра; детерминирован
   *  для E2E — можно дергать напрямую). Открытое пламя (I > 0.35) летит
   *  на близкие корабли: ПО ВЕТРУ огонь перекидывается втрое охотнее */
  updateFires(dt: number) {
    const rain = this.proving ? 0 : this.weatherVis.rainI;
    const ships: Ship[] = [this.player, ...this.aiShips.map(a => a.ship)];
    if (this.pgTarget) ships.push(this.pgTarget.ship);
    // дождь мочит все палубы
    for (const s of ships) s.rainRate = rain;
    // перекидывание: источник горит, цель рядом и не тонет
    for (const src of ships) {
      if (!src.onFire || src.fireIntensity < 0.35 || src.sinking || src.sunk) continue;
      // направление КУДА дует ветер (откуда + PI)
      const wdx = -Math.cos(this.wind.from), wdz = -Math.sin(this.wind.from);
      for (const dst of ships) {
        if (dst === src || dst.onFire || dst.sinking || dst.sunk) continue;
        const dx = dst.position.x - src.position.x;
        const dz = dst.position.z - src.position.z;
        const dist = Math.hypot(dx, dz);
        const reach = 26 + (src.preset.length + dst.preset.length) * 0.35;
        if (dist > reach) continue;
        const downwind = (dx * wdx + dz * wdz) / Math.max(1, dist); // −1..1
        const chance = dt * 0.045 * src.fireIntensity
          * (1 - dist / (reach * 1.05))
          * (downwind > 0.2 ? 2.4 : downwind < -0.5 ? 0.25 : 1);
        if (Math.random() < chance) {
          dst.ignite(0.25 + Math.random() * 0.2);
          this.pushMessage(`${dst === this.player ? 'Наш корабль' : dst.preset.name}: пламя перекинулось с ${src.preset.name}!`);
        }
      }
    }
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
      this.updateFires(STEP);
      for (const ai of this.aiShips) {
        ai.update(STEP, this.time, this.player, this.combat, (t) => this.pushMessage(t));
        // ИИ открывает порты входя в бой и задраивает вне боя
        // (крышки анимируются, орудия выезжают — как у игрока)
        const want = ai.state === 'combat';
        if (ai.ship.visual.gunPorts.length && ai.ship.portsOpen !== want) {
          ai.ship.portsOpen = want;
        }
      }
      if (this.pgTarget) {
        this.pgTarget.update(STEP, this.time, this.player, this.combat, (t) => this.pushMessage(t));
        // мишень полигона с ответным огнём — порты открыты
        if (this.pgTarget.ship.visual.gunPorts.length) this.pgTarget.ship.portsOpen = true;
      }
      this.shipCollisions();
      this.accum -= STEP;
      steps++;
    }

    // «зелёная вода» (Task 25): слишком большая волна накрыла палубу —
    // сообщить игроку (не чаще раза в 12 с)
    if (this.player.greenWater > this.lastGreenWater) {
      if (this.time - this.lastGreenWaterMsgT > 12
        && this.player.greenWaterT > this.lastGreenWaterMsgT) {
        this.pushMessage('Волна накрыла палубу!');
        this.lastGreenWaterMsgT = this.time;
      }
      this.lastGreenWater = this.player.greenWater;
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
    // по ВСЕЙ длине корпуса, включая оконечности (±0.46 полудлины —
    // форштевень/корму) И ПО КРАЯМ ПАЛУБЫ (крен топит борт) —
    // учитываем крен/дифферент кватернионом
    let freeboard = Infinity;
    const deckLocal = this.player.preset.freeboard * 0.82 - 1.0;
    for (const lz of [-this.player.preset.length * 0.46, 0, this.player.preset.length * 0.46]) {
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
      // «зелёная вода» (Task 25): сколько раз волна накрывала палубу
      greenWater: p.greenWater, greenWaterT: +p.greenWaterT.toFixed(1),
      seaModel: SEA.model,
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
      tgtSinkPhase: tgt ? tgt.sinkPhase : -1,
      tgtSinkT: tgt ? +tgt.sinkT.toFixed(1) : -1,
      tgtSunk: tgt && tgt.sunk ? 1 : 0,
      tgtFire: tgt ? +tgt.fireIntensity.toFixed(2) : -1,
      playerFire: +p.fireIntensity.toFixed(2),
      debrisAlive: debrisAlive(),
      tgtShown: tgt ? tgt.crew3d.shown : -1,
      tgtCrewDead: tgt ? tgt.crew3d.dead : -1,
      // паруса мишени по мачтам: дыры/uDamage (проверка каскада ломания)
      tgtSailHoles: tgt ? tgt.visual.sails.sails.map(s => ({
        m: s.mastIndex,
        n: s.mat.uniforms.uHoleN.value as number,
        dmg: +(s.mat.uniforms.uDamage.value as number).toFixed(2),
      })) : null,
      gibsAlive: this.gibs.alive,
      crewShown: p.crew3d.shown,
      crewDead: p.crew3d.dead,
      crewTotal: p.crew3d.total,
      deckFor: deckCrewFor(p.crew),          // сколько ДОЛЖНО быть на палубе
      rigSnapped: p.riggingSnapped(),         // обрывов такелажа (обвязка мачт)
      lairFolk: this.lairFolk
        ? { total: this.lairFolk.total, shown: this.lairFolk.shown, dead: this.lairFolk.dead }
        : null,
      treesBroken: this.world.treesBroken,
      // вёсла игрока (гребные суда)
      oars: p.preset.oars
        ? { out: p.oarsOut, deploy: +p.oarsDeployT.toFixed(2), rowing: p.rowing, idle: +p.oarsIdleT.toFixed(1), phase: +p.strokePhase.toFixed(2) }
        : null,
      // пушечные порты игрока (закрытые батареи)
      gunPorts: p.visual.gunPorts.length
        ? { open: p.portsOpen, anim: +p.portsT.toFixed(2), count: p.visual.gunPorts.length,
            lidsOpen: p.visual.gunPorts.filter(gp => gp.open > 0.85).length,
            gunsOut: p.visual.gunPorts.filter(gp => gp.gun.position.x * Math.sign(gp.gun.userData.baseX) > Math.abs(gp.gun.userData.baseX) + 0.2).length }
        : null,
      // шлюпка за кормой (Task 22-24): разворот, видимость, спуск
      boat: p.visual.boat
        ? {
            ok: true, visible: p.visual.boat.group.visible,
            rotY: +p.visual.boat.group.rotation.y.toFixed(2),
            len: +p.visual.boat.len.toFixed(2),
            x: +p.visual.boat.group.position.x.toFixed(1),
            z: +p.visual.boat.group.position.z.toFixed(1),
            phase: this.boatLaunch ? this.boatLaunch.phase : 'stowed',
          }
        : { ok: false },
      // якоря игрока: отдача (F) — анимация 0..1 + буй на воде
      anchors: p.visual.anchors?.length
        ? {
            n: p.visual.anchors.length, down: p.anchored, t: +p.anchorT.toFixed(2),
            anchorY: p.visual.anchors.map(A => +A.anchor.position.y.toFixed(2)),
            buoyY: p.visual.anchors.map(A => +A.buoy.position.y.toFixed(2)),
            stowQuatX: p.visual.anchors.map(A => +(Math.abs(A.anchor.quaternion.x) + Math.abs(A.anchor.quaternion.z)).toFixed(2)),
          }
        : null,
      figureOn: this.skinsOn.figure ?? 'figure.stock',
      decoOn: this.skinsOn.deco ?? 'deco.none',
      // острова: размеры/дистанции для E2E карты
      islandsBig: this.world.islands.map(i => ({ name: i.name, r: i.r, x: Math.round(i.cx), z: Math.round(i.cz) })),
      // экономика: груз, порты архипелага
      gold: Math.floor(p.gold),
      cargoT: this.cargoUsedT(),
      cargoMaxT: this.cargoMaxT(),
      dockedPort: this.dockedPort?.name ?? null,
      ports: this.world.ports.map(pt => ({
        name: pt.name, tier: pt.tier, pop: pt.population, mul: pt.priceMul,
        x: Math.round(pt.dockEnd.x), z: Math.round(pt.dockEnd.z),
      })),
      // пиратское логово: сколько судов рядом с островом
      piratesNearLair: (() => {
        const isl = this.world.islands.find(i => i.name === 'Логово пиратов');
        if (!isl) return -1;
        return this.aiShips.filter(a => !a.ship.sunk
          && Math.hypot(a.ship.position.x - isl.cx, a.ship.position.z - isl.cz) < isl.r + 400).length;
      })(),
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

    // вёсла без гребли дольше 5 с — убираются сами
    // («достаются только когда гребут»)
    if (this.player.preset.oars && this.player.oarsOut && this.player.rowing === 0) {
      this.player.oarsIdleT += dt;
      if (this.player.oarsIdleT > 5) {
        this.player.oarsOut = false;
        this.pushMessage('Вёсла убраны');
      }
    }

    // sinking игрока
    if (this.player.sinking && !this.dead && this.player.sinkT > 5) {
      this.dead = true;
      this.boatLaunch?.abort();
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
    this.player.updateVisual(this.time, dt, this.particles, this.negShift);
    for (const ai of this.aiShips) ai.ship.updateVisual(this.time, dt, this.particles, this.negShift);
    if (this.pgTarget) this.pgTarget.ship.updateVisual(this.time, dt, this.particles, this.negShift);

    // шлюпка: спуск/подъём/гребля — после визуала корабля
    this.boatLaunch?.update(dt, this.time);

    // мелкие детали кораблей — только когда камера рядом (LOD)
    const camPos = this.rig.camera.position;
    const lodD = this.settings.graphics.detailLod;
    this._v3.copy(this.player.position).add(this.shift);
    this.setDetailLod(this.player, camPos, lodD);
    for (const ai of this.aiShips) this.setDetailLod(ai.ship, camPos, lodD);
    if (this.pgTarget) this.setDetailLod(this.pgTarget.ship, camPos, lodD);

    // системы (земля: рельеф островов + повал деревьев от снарядов;
    // картечь по берегу заодно косит пиратов логова; вода: разрывы
    // у гаваней топят рыбацкие шлюпки)
    this.combat.update(dt, this.time, waterHeightAt, heightAt,
      (x, y, z, r, kind) => {
        const trees = this.world.breakTrees(x, y, z, r, this.particles, this.gibs);
        if (this.lairFolk) {
          const folk = this.lairFolk.killNear(x, y, z, r * 1.25,
            kind === 'ball' || kind === 'fire' ? 'ball' : 'grape');
          if (folk > 0) this.pushMessage(`Берег логова: погибло пиратов ${folk}`);
        }
        this.sinkBoatsAt(x, z, r + 1.5); // выброшенные на песок шлюпки
        return trees;
      },
      (x, _y, z, kind) => {
        // радиус поражения шлюпок — от типа снаряда
        const r = kind === 'ball' || kind === 'chain' ? 3.6
          : kind === 'fire' ? 4.2 : 2.4;
        this.sinkBoatsAt(x, z, r);
      });
    this.particles.update(dt);
    this.gibs.update(dt);
    updateDebris(dt, this.time, this.wind);
    this.world.update(this.time, dt, this.player.position, waterHeightAt);
    this.lairFolk?.update(dt, this.time, { x: this.player.position.x, z: this.player.position.z });

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
    // карта окружения для PBR-металла (орудия/фурнитура): панорама
    // неба из тех же цветов, что и вода — обновляем нечасто
    this.updateEnvMap(dayF, env);
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
    let camTarget = playerScene;
    let camHeading = this.player.heading;
    let camRoll = this.player.euler.z;
    let camPitch = this.player.euler.x;
    let camSpeedFrac = clamp(this.player.speed() / this.player.preset.maxSpeed, 0, 1);
    if (this.boatLaunch && this.boatLaunch.phase === 'afloat') {
      // камера — за шлюпкой, пока игрок в ней (замечание игрока:
      // управлять шлюпкой, пока не вернёшься на борт); ял в 6 раз
      // короче корабля — камера ПРИБЛИЖАЕТСЯ (дистанция × 0.35),
      // иначе с корабельной дистанции шлюпку и её след не разглядеть
      this.rig.distScale = 0.35;
      camTarget = this._v3.copy(this.boatLaunch.pos).add(this.shift);
      camHeading = this.boatLaunch.heading;
      camRoll = this.boatLaunch.roll;
      camPitch = this.boatLaunch.pitch;
      camSpeedFrac = clamp(Math.abs(this.boatLaunch.vel) / 2, 0, 1);
    } else {
      this.rig.distScale = 1;
    }
    const shipInfo = {
      scenePos: camTarget,
      heading: camHeading,
      roll: camRoll,
      pitch: camPitch,
      speedFrac: camSpeedFrac,
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
    this.boatLaunch?.abort();
    const p = this.player;
    p.hullHP = p.hullMax;
    p.sailHP = p.sailMax;
    p.crew = Math.round(p.preset.maxCrew * 0.8);
    p.water = 0; p.leakRate = 0; p.onFire = false; p.fireT = 0; p.fireIntensity = 0;
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
    p.oarsOut = false;
    p.rowing = 0;
    p.oarsIdleT = 0;
    p.portsOpen = false;
    p.portsT = 0;
    // новый корабль — новый боекомплект (с недостачей, если включена)
    p.ammo = this.settings.gameplay.ammoJitter
      ? rollStartingAmmo(this.settings.gameplay.startingAmmo).ammo
      : { ...this.settings.gameplay.startingAmmo };
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
    this.envRT?.dispose();
    this.envTex?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }

  setCameraMode(mode: CameraMode) { this.rig.mode = mode; }
}
