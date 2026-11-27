import * as THREE from 'three';
import { InputManager } from './core/input';
import { EventBus, GameEvents } from './core/events';
import { clamp } from './core/rng';
import { Water } from './water/Water';
import { SEA, waterHeightAt, waveEnvelope, windFactor } from './water/waves';
import { applyBuoyancyConfig, PHYSICS, CONTROLS, BUOYANCY_CONFIG } from './water/buoyancy';
import { Ship } from './ship/Ship';
import { PRESETS, setFlagKind, setSailColor, setHullTint, shipPrice, setFigurehead, setDecoration, hullProfile, hullHalfWidthAt, deckPlan, sailAuditAll, buildShip, type FlagKind } from './ship/buildShip';
import { FIGUREHEADS } from './ship/figurehead';
import { DECOS } from './ship/hullDeco';
import { CameraRig, CAMERA_LABEL, CameraMode } from './camera/cameraRig';
import { CombatSystem, AMMO_INFO, AmmoType, setHullDamageMul } from './combat/combat';
import { Boarding, type BoardingResult } from './combat/boarding';
import { World, heightAt, VILLAGES, type PortDef } from './world/world';
import { Lander } from './player/lander';
import { appearanceToTraits } from './player/appearance';
import { GLBPartSystem } from './glb/glbParts';
import { buildLandFolk, folkCountFor, type LandFolk } from './world/islandFolk';
import { Particles } from './fx/particles';
import { GibPool } from './fx/gibs';
import { initDebris, updateDebris, clearDebris, debrisAlive, debrisInfo } from './fx/debris';
import { initFlotsam, spawnFlotsam, updateFlotsam, pickFlotsam, flotsamInfo, clearFlotsam } from './world/flotsam';
import { setCrewFx, setCrewWorldRoot, deckCrewFor, buildFigure, rollTraits, setCrewRules, CREW_RULES } from './ship/crew';
import { setPlankRules } from './ship/plankHull';
import { setShipDurabilityMap } from './ship/Ship';
import { buildCats, CAT_NAMES, CAT_PRICE, MAX_SHIP_CATS, type CatsVisual } from './ship/cats';
import { BoatLaunch } from './ship/launch';
import { SkySystem } from './fx/sky';
import { WeatherSystem } from './fx/weather';
import { SpyglassFX } from './fx/spyglassFx';
import { AudioSys } from './audio/audio';
import { AIShip } from './ai/ai';
import { GameSettings, loadSettings, saveSettings, rollStartingAmmo, type FxSettings, type PhysicsSettings, type PhysicsMode, type WireframeSettings } from './core/settings';
import { textureUrls } from './assets/textures';

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
  /** Task 85: чем закончилось — 'sunk' (потонул) / 'captured' (проигран абордаж) */
  deadReason: 'sunk' | 'captured' | null;
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
  /** Task 51: подзорная труба поднята (виньетка + суженый FOV) */
  spyglass: boolean;
  /** Task 52: кратность трубы (2..8, колесо мыши) */
  spyZoom: number;
  anchored: boolean;
  grounded: boolean;
  sinking: boolean;
  ammoType: AmmoType;
  ammoCounts: Record<string, number>;
  planks: number;
  gold: number;
  /** корабельные коты (покупаются в порту, 0..5) */
  cats: number;
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
  /** Task 85: что предложит клавиша E у борта — приз (сдался)
   *  или штурм (живой противник — начинается АБОРДАЖ) */
  boardKind: 'prize' | 'assault' | null;
  /** Task 85: состояние абордажа (null — боя нет) */
  boarding: ReturnType<Boarding['snapshot']> | null;
  /** Task 86: результат ПОСЛЕДНЕГО абордажа (панель полигона —
   *  итог проверки: won/lost/repelled/aborted; null — не было) */
  lastBoardingResult: string | null;
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
  mapIslands: { x: number; z: number; r: number; name: string; discovered: boolean; type: string; pts: { x: number; z: number }[] }[];
  mapShips: { x: number; z: number; kind: string; cat: 'war' | 'merchant'; surrendered: boolean }[];
  mapPlayer: { x: number; z: number; h: number };
  fps: number;
  dayF: number;
  proving: boolean;
  target: TargetReport | null;
  /** шлюпка за кормой: фаза спуска, ход, расстояние до кормы */
  boat: { phase: string; t: number; dist: number; speed: number; row: number } | null;
  /** ВЫСАДКА (Task 36): моряк на берегу — третье лицо/оружие/прицел */
  land: { active: boolean; mode: string; weapon: string; weaponLabel: string; aiming: boolean; nearBoat: boolean; nearWheel: boolean; canLand: boolean; hint: string } | null;
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
  /** ЕДИНОЕ МОРЕ (Task 33): Герстнер + FBM — вода Water.ts,
  *  физика волн в water/waves.ts; моделей моря больше нет */
  sky: SkySystem;
  weather: WeatherSystem;
  world: World;
  /** GLB-замена процедурных деталей (пальма — демо-конвейер) */
  glbParts: GLBPartSystem;
  particles = new Particles(1400);
  /** куски тел, разорванных ядрами (мировые координаты) */
  gibs = new GibPool();
  audio = new AudioSys();

  player!: Ship;
  aiShips: AIShip[] = [];
  // Task 56: редкая эскадра — таймер появления и уборки ушедших
  private sqnT = 75;
  private sqnDespawnT = 10;
  private sqnSpawnedTotal = 0;
  combat!: CombatSystem;
  /** спуск/подъём шлюпки и управление ею на воде (клавиша B) */
  boatLaunch: BoatLaunch | null = null;

  worldGroup = new THREE.Group();
  private shift = new THREE.Vector3();     // worldGroup.position
  private negShift = new THREE.Vector3();  // для воды

  wind = { from: 0.7, speed: 7.5 };
  /** Task 51: таймер спавна дыма из труб (раз в 0.8 с на трубу) */
  private chimneyT = 0;
  /** Task 52: таймер LOD-пересборки экипажей AI по дистанции */
  private crewLodT = 0;
  /** Task 51: суда, с которых лут уже рассыпан (Set ссылок) */
  private looted = new Set<Ship>();
  /** Task 51: ПОДЗОРНАЯ ТРУБА поднята (FOV ×4) */
  spyglassOn = false;
  /** Task 77: СТЕКЛО ТРУБЫ — пост-процесс «взгляд сквозь оптику»
   *  (зерно/пыль/царапины/хроматика/бочка); включается, пока
   *  spyglassOn, с плавным blend */
  private spyFx = new SpyglassFX();

  /** Task 51: поднять/опустить подзорную трубу: в прицеле нельзя */
  toggleSpyglass(): boolean {
    if (this.combat.aim.active || this.docked) return this.spyglassOn;
    this.spyglassOn = !this.spyglassOn;
    this.rig.spyglass = this.spyglassOn;
    // Task 77: капитан поднимает/опускает ТРУБУ («как пистолет»)
    this.player.crew3d?.captainSpyglass(this.spyglassOn);
    this.pushMessage(this.spyglassOn
      ? `Подзорная труба поднята (×${this.rig.spyZoom.toFixed(0)}, колесо мыши — зум)`
      : 'Труба опущена');
    return this.spyglassOn;
  }

  /** Task 77: после пересборки экипажа/смены корабля капитан
   *  продолжает смотреть в трубу, если она поднята */
  private syncCaptainSpyglass() {
    if (this.spyglassOn) this.player.crew3d?.captainSpyglass(true);
  }

  docked = false;
  dead = false;
  /** Task 85: причина гибели (экран смерти) */
  deadReason: 'sunk' | 'captured' | null = null;
  /** Task 85 (e2e/отладка): «ускорение времени» — макс. шагов физики
   *  на кадр и потолок dt (0 — обычный режим). В песочнице со
   *  SwiftShader fps падает до ~1 и симуляция ползёт; warp возвращает
   *  ей реальное время. Игровая логика НЕ ветвится по нему */
  testWarp = 0;
  started = false;
  settings: GameSettings;         // графика/управление/звук (см. core/settings.ts)
  uiOpen = false;                 // открыт ли модальный экран (пауза ввода)
  paused = false;                 // отладка/E2E: заморозить физику (рендер идёт)

  // ===== Корабельные коты (только игрок; покупаются в порту) =====
  /** сколько котов на борту (0..MAX_SHIP_CATS) */
  catCount = 0;
  /** клички котов по индексам (порт даёт первую свободную) */
  catNames: string[] = [];
  /** визуал котов на корабле игрока (пересоздаётся со сменой судна) */
  cats3d: CatsVisual | null = null;

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
  /** Task 46: счётчик попаданий по игроку (телеметрия: ответный огонь) */
  playerHitCount = 0;
  // Task 80: проклятие капитана — ПО СВЯЗИ с кораблём (player =
  // «Чёрная жемчужина»), триггер попаданий удалён. Телеметрия:
  // __crewModelInfo().captain.undead (экипаж) и lander.cursed
  captainCursed = false;
  // ПОЛИГОН на чистой воде (Task 36: карта ×10 — полигон уехал к 32 км)
  private PG_ANCHOR = new THREE.Vector3(32000, 0, 23000);

  /** ВЫСАДКА НА ОСТРОВ (Task 36): моряк на берегу — третье лицо,
   *  WASD+мышь, сабля/пистолет */
  lander: Lander | null = null;

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
  /** Task 85: тип подсказки у борта: 'prize' (сдался — забрать
   *  приз) или 'assault' (живой противник — АБОРДАЖ) */
  private boardKind: 'prize' | 'assault' | null = null;
  /** Task 85: АКТИВНЫЙ АБОРДАЖ (модуль Boarding: подход →
   *  сцепка/мостки → бой на палубах → исход) */
  boarding: Boarding | null = null;
  /** Task 85 (e2e/отладка): результат ПОСЛЕДНЕГО закончившегося
   *  абордажа (won/lost/repelled/aborted) */
  lastBoardingResult: string | null = null;
  private spawnPos = new THREE.Vector3(315, 0, 620);

  constructor(private canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    // Task 39: URL-текстуры всех поверхностей (земля/борт/палуба/
    // парус/вода) — реестр грузит их заранее; материалы кораблей и
    // воды регистрируются по мере создания и получают текстуру
    // сразу или по готовности загрузки
    textureUrls.setFromAssets(this.settings.assets.texUrls);
    const g = this.settings.graphics;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, g.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = g.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    // Task 77: буфер пост-процесса ТРУБЫ под размер канваса
    {
      const size = new THREE.Vector2();
      this.renderer.getDrawingBufferSize(size);
      this.spyFx.resize(size.x, size.y, this.renderer.capabilities.isWebGL2 === true);
    }

    this.input = new InputManager(canvas);
    this.input.setPreventCodes(this.preventCodes());
    this.input.setMouseCapture(this.settings.controls.mouseCapture);   // Task 50
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
    this.scene.add(this.water.group);
    this.sky = new SkySystem(this.scene);
    this.sky.setShadowRes(g.shadowRes);
    this.sky.setDomeScale(g.drawDistance / 6500 * 1.12);
    this.weather = new WeatherSystem(this.scene);
    this.weather.applySettings(this.settings.weather);
    // ЕДИНОЕ МОРЕ (Task 33): режим физики + упрощённое управление +
    // настройки плавучести — до создания кораблей; вода следует за
    // ветром (высота волн зависит от скорости ветра)
    PHYSICS.mode = this.settings.physics.mode;
    CONTROLS.simple = this.settings.gameplay.simpleControls;
    // Task 46: правила экипажа — подмена погибших / стрелковый огонь
    setCrewRules({
      replacement: this.settings.gameplay.crewReplacement,
      marksmen: this.settings.gameplay.crewMarksmen,
      emergenceDelay: this.settings.gameplay.crewEmergenceDelay,
    });
    // Task 47: КОРАБЛИ — прочность досок, урон ядер, живучесть
    // по каждому кораблю (до создания судов — карта множителей)
    setPlankRules({ hpMul: this.settings.ships.plankStrength });
    setHullDamageMul(this.settings.ships.ballDamage);
    setShipDurabilityMap(this.settings.ships.durability);
    this.applyPhysicsConfig(this.settings.physics);
    this.weather.onThunder = (dist) => this.audio.thunder(dist);
    this.applyFx(this.settings.fx);
    this.updateParticleScale();
    // МИР ×10 (Task 36): видимость статики — от дальности прорисовки;
    // текстуры/шейдер рельефа — раздел assets (Task 37)
    this.world = new World({
      visDistance: g.drawDistance,
      textures: this.settings.assets,
      islands: this.settings.islands,   // Task 41: настройки островов
    });
    // Task 50/52: дальность видимости деревьев (сразу верные LOD-tier'ы:
    // гистерезис в update стартует от реального состояния, а не от 0,
    // иначе дальние острова «застревали» на полных моделях) + тайл рельефа
    this.world.setTreeVis(g.treeVisDistance);
    this.world.terrain.setTileSize(g.terrainTileSize);
    // стрим рельефа: тайлы держим с запасом за дальностью видимости
    this.world.terrain.streamDist = g.drawDistance + 2200;
    this.worldGroup.add(this.world.group);
    // GLB-модели деталей: асинхронная замена с фолбэком на процедурные
    // (реестр: описания + промпты генерации — вкладка «Графика»)
    this.glbParts = new GLBPartSystem((id, geo) => this.world.swapVegetationModel(id, geo));
    if (this.settings.graphics.useGLBModels) this.glbParts.loadAll();
    this.worldGroup.add(this.particles.points);
    this.worldGroup.add(this.particles.firePoints); // огонь — аддитивный пул
    this.gibs.addTo(this.worldGroup);
    initDebris(this.worldGroup);
    initFlotsam(this.worldGroup);   // Task 51: лут потопленных судов
    setCrewFx(this.gibs, this.particles);
    // Task 43: мировой корень для ПЛОВЦОВ — матросы, прыгнувшие за
    // борт с тонущего корабля, живут в мире (не в группе корабля)
    setCrewWorldRoot(this.worldGroup);
    Ship.gibs = this.gibs;
    this.world.onDiscover = (isl) => this.pushMessage(`Открыт остров: ${isl.name}!`);

    this.spawnShips();
    // каркас «треугольники без текстур» — после создания мира/судов
    this.applyWireframe(this.settings.graphics.wireframe);
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
      c.deckWalk,
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

  /** Настройки физики/плавучести → конфиг (Task 33: углы — в радианы,
   *  вероятность смыва — в долю) */
  private applyPhysicsConfig(ph: PhysicsSettings) {
    applyBuoyancyConfig({
      heelMax: ph.buoyancy.heelMaxDeg * Math.PI / 180,
      pitchMax: ph.buoyancy.pitchMaxDeg * Math.PI / 180,
      draftOffset: ph.buoyancy.draftOffset,
      boatDraftMul: ph.buoyancy.boatDraftMul,
      boatSmooth: ph.buoyancy.boatSmooth,
      washProbability: ph.buoyancy.washProbabilityPct / 100,
      washCooldown: ph.buoyancy.washCooldownS,
    });
  }

  /** Применить настройки плавучести ко ВСЕМ судам (осадка ± у
   *  реалистичной физики — перекалибровкой колонн каждого корпуса) */
  private applyBuoyancySettings(ph: PhysicsSettings) {
    this.applyPhysicsConfig(ph);
    const all: Ship[] = [this.player, ...this.aiShips.map(a => a.ship)];
    if (this.pgTarget) all.push(this.pgTarget.ship);
    for (const s of all) {
      s.applyDraftOffset(ph.buoyancy.draftOffset);
    }
  }

  /** Смена режима физики (реалистичная ↔ простая): посадить
   *  вертикаль судов на равновесие новой модели — без транзиента */
  private applyPhysicsMode(mode: PhysicsMode, announce = true) {
    if (PHYSICS.mode === mode) return;
    PHYSICS.mode = mode;
    if (this.player) {
      this.player.seedVertical(this.time);
      for (const a of this.aiShips) a.ship.seedVertical(this.time);
      if (this.pgTarget) this.pgTarget.ship.seedVertical(this.time);
    }
    if (announce) {
      this.pushMessage(mode === 'simple'
        ? 'Физика: простая — корабль скользит по поверхности волн'
        : 'Физика: реалистичная — Архимед, корабль режет волны');
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
    // ===== Task 47: КОРАБЛИ — доски/ядра/живучесть по судам =====
    if (prev.ships.plankStrength !== s.ships.plankStrength) {
      setPlankRules({ hpMul: s.ships.plankStrength });
      this.pushMessage(`Прочность досок обшивки: ×${s.ships.plankStrength.toFixed(2)} ` +
        `(×1 — пролом с 3 попаданий, ×2 — с 5-6, ×0.5 — с 1-2)`);
    }
    if (prev.ships.ballDamage !== s.ships.ballDamage) {
      setHullDamageMul(s.ships.ballDamage);
      this.pushMessage(`Урон ядер: ×${s.ships.ballDamage.toFixed(2)} (по корпусу и мачтам)`);
    }
    if (JSON.stringify(prev.ships.durability) !== JSON.stringify(s.ships.durability)) {
      setShipDurabilityMap(s.ships.durability);
      // перемасштабировать живучесть судов, у которых сменился
      // личный множитель (текущие повреждения — пропорционально)
      const rescaleShip = (sh: Ship) => {
        const k = (s.ships.durability[sh.preset.id] ?? 1)
          / (prev.ships.durability[sh.preset.id] ?? 1);
        if (k === 1) return;
        sh.hullMax *= k; sh.hullHP *= k;
        sh.sailMax *= k; sh.sailHP *= k;
        sh.mastMaxHP *= k;
        for (let i = 0; i < sh.mastHP.length; i++) sh.mastHP[i] *= k;
      };
      rescaleShip(this.player);
      for (const a of this.aiShips) rescaleShip(a.ship);
      if (this.pgTarget) rescaleShip(this.pgTarget.ship);
    }
    this.rig.camera.far = g.drawDistance * 2 + 4000;
    this.rig.camera.updateProjectionMatrix();
    this.sky.setDomeScale(g.drawDistance / 6500 * 1.12);
    (this.scene.fog as THREE.FogExp2).density = this.fogBase();
    this.audio.setVolume(s.audio.volume);
    this.input.setPreventCodes(this.preventCodes());
    if (prev.controls.mouseCapture !== s.controls.mouseCapture) {
      this.input.setMouseCapture(s.controls.mouseCapture);   // Task 50
    }
    this.combat.infiniteAmmo = s.gameplay.infiniteAmmo;
    this.applyFx(s.fx);
    // GLB-модели деталей: включение/выключение на лету
    if (prev.graphics.useGLBModels !== g.useGLBModels) {
      if (g.useGLBModels) this.glbParts.enableAll(); else this.glbParts.disableAll();
      this.pushMessage(g.useGLBModels
        ? '3D-модели деталей: GLB (с фолбэком на процедурные)'
        : '3D-модели деталей: процедурные');
    }
    if (prev.weather.mode !== s.weather.mode
      || prev.weather.windSpeed !== s.weather.windSpeed
      || prev.weather.windDir !== s.weather.windDir) {
      this.weather.applySettings(s.weather);
    }
    // ===== Task 33: физика/плавучесть/шлюпки/каркас =====
    // режим физики (реалистичная ↔ простая) — мгновенное переключение
    if (prev.physics.mode !== s.physics.mode) {
      this.applyPhysicsMode(s.physics.mode);
    }
    // настройки плавучести — ко всем судам на лету
    if (JSON.stringify(prev.physics.buoyancy) !== JSON.stringify(s.physics.buoyancy)) {
      this.applyBuoyancySettings(s.physics);
    }
    // упрощённое управление — глобальный флаг
    if (prev.gameplay.simpleControls !== s.gameplay.simpleControls) {
      CONTROLS.simple = s.gameplay.simpleControls;
      this.pushMessage(s.gameplay.simpleControls
        ? 'Управление: упрощённое (руль на любой скорости, паруса тянут при любом курсе)'
        : 'Управление: обычное (парусные поляры, авторитет руля от хода)');
    }
    // количество шлюпок — пересборка корабля игрока (кранбалки/фалы
    // запечены в корпус; меняется визуал целиком, состояние сохраняется)
    if (prev.gameplay.boatCount !== s.gameplay.boatCount) {
      this.changeShip(this.player.preset.id, true, true);
      this.pushMessage(`Шлюпок на борту: ${s.gameplay.boatCount}`);
    }
    // Task 52: МОДЕЛЬ ЭКИПАЖА — классические ↔ детальные фигурки
    // (пересборка на лету; у AI детальные только в ближней зоне)
    if (prev.graphics.crewDetail !== g.crewDetail) {
      this.player.rebuildCrew(s.gameplay.catsInsteadOfCrew, g.crewDetail === 'detailed');
      for (const a of this.aiShips) {
        a.ship.crewDetailZone = -1;   // сброс LOD-зоны: пересчитается
      }
      this.crewLodT = 0;              // и сразу проверить дистанции
      this.syncCaptainSpyglass();     // Task 77: труба не теряется
      this.pushMessage(g.crewDetail === 'detailed'
        ? 'Экипаж: ДЕТАЛЬНЫЕ фигурки (скелет, лица, кисти, обувь)'
        : 'Экипаж: классические фигурки');
    }
    // экипаж из котов — пересобрать фигуры на палубе игрока
    // (NPC-корабли остаются с матросами: коты — только у игрока)
    if (prev.gameplay.catsInsteadOfCrew !== s.gameplay.catsInsteadOfCrew) {
      this.player.rebuildCrew(s.gameplay.catsInsteadOfCrew);
      this.syncCaptainSpyglass();     // Task 77: труба не теряется
      this.pushMessage(s.gameplay.catsInsteadOfCrew
        ? '🐱 Экипаж заменён котами: капитан-кот у штурвала, боцман-кот у шпиля, канониры-коты таскают ядра'
        : 'Экипаж снова из матросов');
    }
    // ===== Task 76: КАПИТАН НА БОРТУ — ИГРОК =====
    // смена внешности (экран создания персонажа) пересобирает
    // капитана на палубе из НОВОГО выбора игрока
    if (JSON.stringify(prev.player) !== JSON.stringify(s.player)) {
      this.player.setCaptainTraits(appearanceToTraits(s.player));
      this.syncCaptainSpyglass();     // Task 77: труба не теряется
    }
    // ===== Task 46: МОДЕЛЬ КОРПУСА — дощатая ↔ обычная =====
    if (prev.gameplay.hullModel !== s.gameplay.hullModel) {
      this.rebuildAllVisuals(s.gameplay.hullModel === 'planks');
    }
    // ===== Task 46/56: правила экипажа =====
    setCrewRules({ replacement: s.gameplay.crewReplacement, marksmen: s.gameplay.crewMarksmen,
      emergenceDelay: s.gameplay.crewEmergenceDelay });
    if (prev.gameplay.crewEmergenceDelay !== s.gameplay.crewEmergenceDelay) {
      this.pushMessage(`Подмена выходит на палубу через ~${s.gameplay.crewEmergenceDelay.toFixed(1)}-${(s.gameplay.crewEmergenceDelay * 2.25).toFixed(1)} с`);
    }
    if (prev.gameplay.crewReplacement !== s.gameplay.crewReplacement) {
      this.pushMessage(s.gameplay.crewReplacement
        ? 'Подмена экипажа: погибшие поднимаются заменой из трюма (люк у мачты)'
        : 'Подмена экипажа: выключена — на палубе остаются выжившие');
    }
    if (prev.gameplay.crewMarksmen !== s.gameplay.crewMarksmen) {
      this.pushMessage(s.gameplay.crewMarksmen
        ? 'Стрелки экипажа: ружья/пистолеты с постов у борта'
        : 'Стрелки экипажа: выключены — только артиллерия (поза у борта остаётся)');
    }
    // каркас «треугольники без текстур» по категориям
    if (JSON.stringify(prev.graphics.wireframe) !== JSON.stringify(g.wireframe)) {
      this.applyWireframe(g.wireframe);
    }
    // Task 37/38/39: РЕСУРСЫ — режим текстур/шейдер/PBR-параметры
    // рельефа + СВОИ текстуры ВСЕХ поверхностей по ссылке (земля/
    // борт/палуба/парус/вода — каталог assets/textures.ts);
    // применяется на лету без перестройки тайлов
    if (JSON.stringify(prev.assets) !== JSON.stringify(s.assets)) {
      this.world.setTerrainAssets(s.assets);
      textureUrls.setFromAssets(s.assets.texUrls);
      const modeLabels: Record<string, string> = {
        off: 'ВЫКЛ (ровный цвет вершин)',
        grain: 'зерно (процедурная детализация)',
        pbr: 'PBR (текстуры + нормали + шероховатость)',
        url: s.assets.texUrls.terrain ? 'своя текстура по ссылке' : 'своя текстура (ссылка не задана — зерно)',
        zones: 'ЗОНЫ: песок/трава/грязь/скалы',
      };
      this.pushMessage(`Рельеф островов: ${modeLabels[s.assets.islandTextures]} · шейдер ${s.assets.terrainShader}`);
      // сводка по своим текстурам (что загрузилось, что нет)
      const st = textureUrls.describe();
      const parts: string[] = [];
      const slotNames: Record<string, string> = {
        terrain: 'земля', hull: 'борт', deck: 'палуба', sail: 'парус', water: 'вода',
        sand: 'песок', grass: 'трава', dirt: 'грязь', rock: 'скалы',
      };
      for (const k of Object.keys(st) as (keyof typeof st)[]) {
        if (st[k].urlLen === 0) continue;
        parts.push(`${slotNames[k]}: ${st[k].state === 'ok' ? 'загружена' : st[k].state === 'error' ? 'ошибка (процедурная)' : 'грузится…'}`);
      }
      if (parts.length) this.pushMessage(`Свои текстуры — ${parts.join(' · ')}`);
    }
    // Task 41: НАСТРОЙКИ ОСТРОВОВ — деревья (до ×1000, с бюджетом),
    // деревни, жители, рыбацкие лодки; глобально + по островам.
    // Перестройка на лету (лес — мгновенно, деревни/лодки — секунды)
    if (JSON.stringify(prev.islands) !== JSON.stringify(s.islands)) {
      const res = this.world.applyIslandConfig(s.islands);
      if (res.trees) {
        if (this.settings.graphics.useGLBModels) this.glbParts.enableAll();
        this.applyWireframe(this.settings.graphics.wireframe);
      }
      const info = this.world.islandsInfo();
      const parts: string[] = [];
      if (res.trees) {
        parts.push(`лес ×${s.islands.treesMul}${info.trees.budgetHit ? ' (бюджет)' : ''}: ${info.trees.instances.toLocaleString('ru-RU')} дер.`);
      }
      if (res.villages) {
        parts.push(`деревни ×${s.islands.villagesMul}: ${info.villages.active} (жителей ${info.folk.total})`);
      }
      if (res.boats) {
        parts.push(`лодки ×${s.islands.boatsMul}: ${info.boats.n}`);
      }
      if (parts.length) this.pushMessage(`Острова: ${parts.join(' · ')}`);
    }
    // Task 39: ВНЕШНОСТЬ КАПИТАНА — пересобрать фигурку на берегу
    if (JSON.stringify(prev.player) !== JSON.stringify(s.player)) {
      this.lander?.setAppearance(s.player);
    }
    if (prev.graphics.drawDistance !== g.drawDistance) {
      this.world.visDistance = g.drawDistance;
      this.world.terrain.streamDist = g.drawDistance + 2200;
    }
    // Task 50/52: дальность видимости деревьев (пороги LOD — доли от
    // неё); смена настройки пересчитывает уровни НЕМЕДЛЕННО (без
    // гистерезисного застревания на старом уровне)
    if (prev.graphics.treeVisDistance !== g.treeVisDistance) {
      this.world.setTreeVis(g.treeVisDistance, this.player.position.x, this.player.position.z);
    }
    // Task 50: размер тайла рельефа («чанка») — пересборка сетки
    if (prev.graphics.terrainTileSize !== g.terrainTileSize) {
      this.world.terrain.setTileSize(g.terrainTileSize);
      this.pushMessage(`Рельеф: тайл ${g.terrainTileSize} м — пересборка`);
    }
  }

  /** КАРКАС (Task 33): показывать только треугольники без текстур —
   *  отдельно для воды / кораблей / островов / растительности.
   *  Материалы общие — переключение применяется по категории */
  applyWireframe(w: WireframeSettings) {
    this.water.material.wireframe = w.water;
    // корабли: корпуса/паруса/экипаж всех судов
    const all: Ship[] = [this.player, ...this.aiShips.map(a => a.ship)];
    if (this.pgTarget) all.push(this.pgTarget.ship);
    for (const s of all) {
      if (!s?.visual) continue;
      s.visual.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) (m as THREE.Material & { wireframe?: boolean }).wireframe = w.ships;
        }
      });
    }
    // острова (рельеф + постройки + животные) и растительность:
    // категория помечена в userData.wire при сборке мира.
    // РЕЛЬЕФ — через метод стримера: флаг каркаса переносится на
    // ЛЮБОЙ будущий материал (шейдер меняется — каркас остаётся)
    this.world.setTerrainWireframe(w.islands);
    this.world.group.traverse((o) => {
      const cat = o.userData.wire as string | undefined;
      if (cat !== 'island' && cat !== 'veg') return;
      const on = cat === 'veg' ? w.vegetation : w.islands;
      const mesh = o as THREE.Mesh;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) (m as THREE.Material & { wireframe?: boolean }).wireframe = on;
      }
    });
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

  /** Отладочный хук для E2E: выпустить мышь на палубу (котам нужна добыча) */
  debugSpawnMouse() {
    this.cats3d?.spawnMouseNow();
  }

  /** Отладочный хук для E2E (Task 36): ближайший ломаемый куст/дерево */
  debugNearestCuttable(x: number, z: number, maxR = 120, withCollider = false) {
    return this.world.nearestCuttable(x, z, maxR, withCollider);
  }

  /** Отладочный хук для E2E (Task 36): ближайший живой житель деревни */
  debugNearestFolk(x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const f of this.world.villageFolk) {
      const gpos = f.group.children.map(c => (c as THREE.Group).position);
      for (const p of gpos) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) { bestD = d; best = { x: p.x, z: p.z }; }
      }
    }
    return best;
  }

  /** КОЛЬЦЕВОЙ МАРШРУТ вокруг острова (Task 36: карта ×10 — прежние
   *  фиксированные точки легли СКВОЗЬ выросшие острова). Точки на
   *  кольце isl.r·1.15 + dist, каждая выталкивается наружу до
   *  глубокой воды (heightAt < −8) */
  private ringRoute(islandIdx: number, dist: number, n: number, a0 = 0): THREE.Vector3[] {
    const isl = this.world.islands[islandIdx];
    const out: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2;
      let rr = isl.r * 1.15 + dist;
      let x = isl.cx + Math.cos(a) * rr;
      let z = isl.cz + Math.sin(a) * rr;
      for (let t = 0; t < 40 && heightAt(x, z) > -8; t++) {
        rr += 150;
        x = isl.cx + Math.cos(a) * rr;
        z = isl.cz + Math.sin(a) * rr;
      }
      out.push(new THREE.Vector3(x, 0, z));
    }
    return out;
  }

  private spawnShips() {
    const terrain = (x: number, z: number) => heightAt(x, z);
    const gp = this.settings.gameplay;
    const startAmmo = gp.ammoJitter
      ? rollStartingAmmo(gp.startingAmmo).ammo
      : { ...gp.startingAmmo };
    const playerOpts = { durabilityMul: gp.hullDurability, ammo: startAmmo, boatCount: gp.boatCount,
      crewCats: gp.catsInsteadOfCrew, planking: gp.hullModel === 'planks',
      crewDetailed: this.settings.graphics.crewDetail === 'detailed',
      // Task 76: капитан на борту — ИГРОК (внешность со старта игры)
      captainTraits: appearanceToTraits(this.settings.player) };
    // Task 52: AI-экипажи — ДЕТАЛЬНЫЕ только у БЛИЖНИХ кораблей (LOD
    // по дистанции, как у деревьев): дальние остаются классикой
    const aiOpts = { durabilityMul: gp.hullDurability, boatCount: gp.boatCount,
      planking: gp.hullModel === 'planks' };
    // игрок: шлюп в глубокой воде за пирсом
    this.player = new Ship('sloop', true, this.wind, terrain, this.particles, playerOpts);
    const seaDir = new THREE.Vector3().subVectors(this.world.port.dockEnd,
      new THREE.Vector3(this.world.islands[0].cx, 0, this.world.islands[0].cz)).setY(0).normalize();
    this.spawnPos = this.world.port.dockEnd.clone().addScaledVector(seaDir, 260);
    this.player.position.copy(this.spawnPos);
    this.player.position.y = 0;
    this.player.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(seaDir.x, seaDir.z), 0));
    this.player.gold = this.settings.gameplay.startMoney;
    this.player.cargo = { sugar: 0, rum: 0, timber: 0 };
    this.worldGroup.add(this.player.visual.group);
    this.worldGroup.add(this.player.foam.mesh);
    this.worldGroup.add(this.player.wake.mesh);

    // шлюпка за кормой (Task 36: рельеф передан — мель по ГЛУБИНЕ)
    this.boatLaunch = new BoatLaunch({
      ship: this.player, worldGroup: this.worldGroup, particles: this.particles,
      islands: () => this.world.islands,
      heightAt: (x, z) => heightAt(x, z),
      msg: (t) => this.pushMessage(t),
      onSplash: () => this.audio.splash(0),
    });

    // ВЫСАДКА НА ОСТРОВ (Task 36): моряк для прогулок по берегу;
    // Task 39: фигурка капитана — по ВЫБРАННОЙ внешности
    this.lander = new Lander({
      worldGroup: this.worldGroup,
      particles: this.particles,
      world: this.world,
      camera: this.rig.camera,
      appearance: this.settings.player,
      msg: (t) => this.pushMessage(t),
      audio: {
        shot: () => this.audio.pistolShot(),
        saber: () => this.audio.saberSwing(),
      },
      folkKill: (x, y, z, r, mode, dx, dz) => this.killFolkNear(x, y, z, r, mode, dx, dz),
      chop: (x, y, z, r) => this.world.breakTrees(x, y, z, r, this.particles, this.gibs),
    });

    // корабельные коты — палуба игрока (если уже куплены)
    this.attachCats();

    // торговцы: КОЛЬЦА вокруг островов (маршруты в чистой воде)
    const routes: THREE.Vector3[][] = [
      this.ringRoute(0, 900, 5),
      this.ringRoute(4, 1200, 6),
    ];
    const safeSpawns = [routes[0][0].clone(), routes[1][0].clone()];
    const traderModels = ['fluyt', 'pinnace'];
    routes.forEach((route, i) => {
      const trader = new Ship(traderModels[i], false, this.wind, terrain, this.particles, aiOpts);
      trader.position.copy(safeSpawns[i]);
      trader.quaternion.setFromEuler(new THREE.Euler(0, i * 1.3, 0));
      trader.gold = 260 + i * 190;
      trader.cargo = { sugar: 18 + i * 9, rum: 6 + i * 5, timber: 22 + i * 11 };
      this.worldGroup.add(trader.visual.group);
      this.worldGroup.add(trader.foam.mesh);
      this.worldGroup.add(trader.wake.mesh);
      this.aiShips.push(new AIShip(trader, route, 'route'));
    });

    // каравелла — быстрый торговец вокруг Зелёного атолла
    const caravelRoute = this.ringRoute(1, 1000, 6, 0.7);
    const caravel = new Ship('caravel', false, this.wind, terrain, this.particles, aiOpts);
    caravel.position.copy(caravelRoute[0]);
    caravel.quaternion.setFromEuler(new THREE.Euler(0, -1.2, 0));
    caravel.gold = 340;
    caravel.cargo = { sugar: 14, rum: 9, timber: 30 };
    this.worldGroup.add(caravel.visual.group);
    this.worldGroup.add(caravel.foam.mesh);
    this.worldGroup.add(caravel.wake.mesh);
    this.aiShips.push(new AIShip(caravel, caravelRoute, 'route'));

    // галеон — флагман на якоре в гавани
    const galleon = new Ship('galleon', false, this.wind, terrain, this.particles, aiOpts);
    const perp = new THREE.Vector3(-seaDir.z, 0, seaDir.x);
    galleon.position.copy(this.spawnPos).addScaledVector(perp, 170).addScaledVector(seaDir, 90);
    galleon.position.y = 0;
    galleon.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(seaDir.x, seaDir.z) + 0.7, 0));
    galleon.crew = 70;
    this.worldGroup.add(galleon.visual.group);
    this.worldGroup.add(galleon.foam.mesh);
    this.worldGroup.add(galleon.wake.mesh);
    this.aiShips.push(new AIShip(galleon, [], 'anchored'));

    // военный патруль — широкое кольцо вокруг гавани
    const patrol = this.ringRoute(0, 2600, 6, 0.4);
    const brig = new Ship('brig', false, this.wind, terrain, this.particles, aiOpts);
    brig.position.copy(patrol[0]);
    brig.crew = 52;
    this.worldGroup.add(brig.visual.group);
    this.worldGroup.add(brig.foam.mesh);
    this.worldGroup.add(brig.wake.mesh);
    this.aiShips.push(new AIShip(brig, patrol, 'patrol'));

    // фрегат Surprise — патруль вокруг атолла Плёс
    const surpriseRoute = this.ringRoute(7, 1400, 6, 1.1);
    const surprise = new Ship('surprise', false, this.wind, terrain, this.particles, aiOpts);
    surprise.position.copy(surpriseRoute[0]);
    surprise.quaternion.setFromEuler(new THREE.Euler(0, 2.1, 0));
    surprise.crew = 170;
    this.worldGroup.add(surprise.visual.group);
    this.worldGroup.add(surprise.foam.mesh);
    this.worldGroup.add(surprise.wake.mesh);
    this.aiShips.push(new AIShip(surprise, surpriseRoute, 'patrol'));

    // ост-индец Amsterdam — тяжёлый торговец: дальний круг Бакунов
    const eicRoute = this.ringRoute(4, 2600, 8, 2.3);
    const eic = new Ship('amsterdam', false, this.wind, terrain, this.particles, aiOpts);
    eic.position.copy(eicRoute[0]);
    eic.quaternion.setFromEuler(new THREE.Euler(0, -0.4, 0));
    eic.gold = 720;
    eic.cargo = { sugar: 40, rum: 22, timber: 55 };
    this.worldGroup.add(eic.visual.group);
    this.worldGroup.add(eic.foam.mesh);
    this.worldGroup.add(eic.wake.mesh);
    this.aiShips.push(new AIShip(eic, eicRoute, 'route'));

    // шлюп Lady Washington — каботажник: ближний круг гавани
    const ladyRoute = this.ringRoute(0, 500, 5, 2.6);
    const lady = new Ship('ladyw', false, this.wind, terrain, this.particles, aiOpts);
    lady.position.copy(ladyRoute[0]);
    lady.gold = 180;
    lady.cargo = { sugar: 6, rum: 3, timber: 12 };
    this.worldGroup.add(lady.visual.group);
    this.worldGroup.add(lady.foam.mesh);
    this.worldGroup.add(lady.wake.mesh);
    this.aiShips.push(new AIShip(lady, ladyRoute, 'route'));

    // === ПИРАТСКОЕ ЛОГОВО: эскадра у острова «Логово пиратов» ===
    this.spawnPirateFleet(aiOpts);

    this.combat = new CombatSystem(this.player, this.particles, (t, p) => this.bus.emit(t, p));
    this.combat.others = this.aiShips.map(a => a.ship);
    this.combat.addTo(this.worldGroup);
    this.combat.infiniteAmmo = gp.infiniteAmmo;
  }

  /** ============================================================
   *  Task 56: РЕДКАЯ ЭСКАДРА — 3-4 корабля КИЛЬВАТЕРНОЙ КОЛОННОЙ
   *  пересекают горизонт: торговый конвой (флейт/каравелла/когг с
   *  конвоиром) или военный отряд (бриг/фрегат). Ведущий идёт по
   *  маршруту, ведомые держат точку за кормой впереди идущего
   *  (AIShip.leader). Появление редкое: проверка раз в 60 с,
   *  шанс 14% — в среднем эскадра раз в ~7 минут. Ушедшие за
   *  горизонт (>5.2 км) снимаются с карты — флот не плодится */
  spawnSquadron(): { ships: string[]; theme: string; n: number } | null {
    const terrain = (x: number, z: number) => heightAt(x, z);
    // точка спавна: за горизонтом, случайная сторона от игрока,
    // на глубокой воде; маршрут — прямая через район игрока
    let base: THREE.Vector3 | null = null;
    let dir = new THREE.Vector3(1, 0, 0);
    for (let t = 0; t < 12 && !base; t++) {
      const a = Math.random() * Math.PI * 2;
      const d = 900 + Math.random() * 250;
      const p = new THREE.Vector3(this.player.position.x + Math.sin(a) * d, 0,
        this.player.position.z + Math.cos(a) * d);
      // курс эскадры — ПО ВЕТРУ (бейдевинд колонне ни к чему:
      // против ветра корабли еле ползут и строй рассыпается)
      const fair = this.wind.from + Math.PI + (Math.random() - 0.5) * 1.4;
      const dd = new THREE.Vector3(Math.sin(fair), 0, Math.cos(fair)).normalize();
      if (heightAt(p.x, p.z) < -6 && heightAt(p.x + dd.x * 1200, p.z + dd.z * 1200) < -6) {
        base = p;
        dir = dd;
      }
    }
    if (!base) return null;
    // состав: военный отряд или торговый конвой
    const war = Math.random() < 0.45;
    const n = 3 + (Math.random() < 0.55 ? 1 : 0);
    const pool = war ? ['brig', 'frigate', 'cog', 'fluyt'] : ['fluyt', 'caravel', 'cog', 'amsterdam'];
    const models: string[] = [];
    for (let i = 0; i < n; i++) models.push(pool[Math.floor(Math.random() * pool.length)]);
    // медленнейший — ведущий (остальные за ним поспевают)
    const stats = models.map(m => ({ m, v: PRESETS[m].maxSpeed, L: PRESETS[m].length }));
    stats.sort((a, b) => a.v - b.v);
    const gpS = this.settings.gameplay;
    const heading = Math.atan2(dir.x, dir.z);
    const waypoints = [0, 1300, 2600, 3900].map(k =>
      base!.clone().addScaledVector(dir, k));
    let prevAI: AIShip | null = null;
    let back = 0;   // накопленное расстояние позади ведущего
    for (const st of stats) {
      const flag: FlagKind = war ? 'navy' : 'merchant';
      const sh = new Ship(st.m, false, this.wind, terrain, this.particles,
        { durabilityMul: gpS.hullDurability, boatCount: gpS.boatCount, flag });
      const gap = prevAI ? (prevAI.ship.preset.length + st.L) * 0.5 + 55 : 0;
      back += gap;
      sh.position.copy(base!).addScaledVector(dir, -back);
      sh.quaternion.setFromEuler(new THREE.Euler(0, heading, 0));
      sh.crew = Math.round(sh.preset.maxCrew * 0.8);
      sh.gold = Math.round(200 + Math.random() * 500);
      sh.cargo = { sugar: 4, rum: 3, timber: 6, spice: 1, silk: Math.random() < 0.4 ? 1 : 0 };
      sh.sailTarget = 3;
      setFlagKind(sh.visual, flag);
      this.worldGroup.add(sh.visual.group);
      this.worldGroup.add(sh.foam.mesh);
      this.worldGroup.add(sh.wake.mesh);
      const ai = new AIShip(sh, waypoints.map(w => w.clone()), 'route');
      ai.squadron = true;
      if (prevAI) ai.leader = prevAI;
      this.aiShips.push(ai);
      // Task 81: КОРЕНЬ «нельзя уничтожить эскадру» — combat.others
      // заполнялся ТОЛЬКО при старте игры (game.ts:993), а эскадра
      // спавнится позже: снаряды игрока пролетали корабли насквозь
      // (цели берутся из combat.others), эскадра стала неуязвимой
      this.combat.others.push(sh);
      prevAI = ai;
    }
    this.sqnSpawnedTotal++;
    this.pushMessage(war
      ? `⚔️ На горизонте — военная эскадра: ${n} судна кильватерной колонной`
      : `📦 На горизонте — торговый конвой: ${n} судна друг за другом`);
    return { ships: stats.map(x => x.m), theme: war ? 'war' : 'convoy', n };
  }

  /** Task 56: цикл эскадры — редкое появление + уборка ушедших */
  private updateSquadron(dt: number) {
    this.sqnT -= dt;
    if (this.sqnT <= 0) {
      this.sqnT = 60;
      // максимум ОДНА эскадра на карте (память/флот не плодятся;
      // следующая — когда эта уйдёт за горизонт или погибнет)
      const alive = this.aiShips.some(a => a.squadron && !a.ship.sunk);
      if (!alive && Math.random() < 0.14) this.spawnSquadron();
    }
    this.sqnDespawnT -= dt;
    if (this.sqnDespawnT <= 0) {
      this.sqnDespawnT = 10;
      for (let i = this.aiShips.length - 1; i >= 0; i--) {
        const a = this.aiShips[i];
        if (!a.squadron) continue;
        const d = a.ship.position.distanceTo(this.player.position);
        if (d > 5200 || (a.ship.sunk && d > 900)) {
          // Task 81: убрать и из списка целей (иначе тонул бы «фантом»)
          const oi = this.combat.others.indexOf(a.ship);
          if (oi >= 0) this.combat.others.splice(oi, 1);
          this.worldGroup.remove(a.ship.visual.group, a.ship.foam.mesh, a.ship.wake.mesh);
          this.aiShips.splice(i, 1);
        }
      }
    }
  }

  /** Аудит парусов всех пресетов (e2e/VLM) */
  debugSailAudit() {
    return sailAuditAll();
  }

  /** Task 78: АУДИТ «ПАРУС РЕЖЕТ ДОЩАТЫЙ (разрушаемый) КОРПУС» —
   *  паруса всех пресетов против ФАКТИЧЕСКИХ боксов досок обшивки
   *  (PlankSystem: борт/палуба/транец) и, для сравнения, против
   *  гладкого обвода (hullHalfWidthAt). Прямые паруса проверяются
   *  и ПРИ БРАСОПКЕ (реи ±0.96 рад — шкоты-углы уходят к оконечностям,
   *  а у носа/кормы дощатые пояса не сужаются тоньше 0.30 м —
   *  «тупой клин» режется парусом). Возвращает худшее проникновение
   *  (м) по каждой модели в обоих режимах корпуса.
   *  Task 79: belly > 0 — сэмплировать и «ПУЗО» паруса (вершинный
   *  шейдер uBelly смещает полотно на sin(uπ)·sin(vπ)·(0.72+0.28(1−v))
   *  поперёк плоскости; у косых — в ОБЕ стороны, знак зависит от
   *  борта ветра) и РЕИ (прямой — цилиндр на пивоте при брасопке,
   *  латинский — диагональная рейка к носу). Числами воспроизводит
   *  то, что игрок видит глазом на полном ветру. */
  debugPlankSailAudit(belly = 0) {
    type Row = { id: string; name: string; planksMax: number; smoothMax: number; bowMax: number; hits: number; worst: string };
    const out: Row[] = [];
    const inv = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const loc = new THREE.Vector3();
    for (const P of Object.values(PRESETS)) {
      const vis = buildShip(P, { planking: true });
      const recs = vis.planks?.records ?? [];
      let planksMax = 0, smoothMax = 0, bowMax = 0, hits = 0;
      let worst = '';
      // Task 79: «НОС» — штевень (каркас, поднимается над палубой в ДП)
      // и галеонная фигура: парусина, проходящая сквозь них, на
      // носовых ракурсах «рассекает переднюю часть пополам» (скрин
      // игрока) — хотя между фальшбортами она «легальна»
      const L0 = P.length;
      const bowTop = hullProfile(1, P).bulwark;
      const stemBox = {
        x: 0.20, z0: L0 * 0.47, z1: L0 * 0.52,
        y0: -P.draft * 0.5, y1: bowTop * 0.9,
      };
      const figS = THREE.MathUtils.clamp(P.freeboard * 0.26, 0.55, 1.25)
        * THREE.MathUtils.clamp(P.freeboard * 0.30, 0.8, 1.6);
      // бокс фигуры — С ЗАПАСОМ (фигуры шире формулы: русалки с зеркалом,
      // львы с лапами; «Виктория» прежде проходила впритык кромкой кливера)
      const figBox = {
        x: 0.45 + figS * 0.55, z0: L0 / 2 - 0.15 - figS * 0.55, z1: L0 / 2 - 0.15 + figS * 0.65 + 0.35,
        y0: P.freeboard * 1.02, y1: P.freeboard * 1.02 + figS * 2.1,
      };
      const test = (label: string) => {
        // (а) гладкий корпус: точка внутри обвода НИЖЕ ПАЛУБЫ
        // (bulwark − 1.0 — между фальшбортами парус легален)
        const t = THREE.MathUtils.clamp((p.z + P.length / 2) / P.length, 0, 1);
        const hw = hullHalfWidthAt(P, t, p.y);
        const bw = hullProfile(t, P).bulwark;
        if (p.y < bw - 1.05 && Math.abs(p.x) < hw) {
          smoothMax = Math.max(smoothMax, hw - Math.abs(p.x));
        }
        // (в) Task 79: НОС — штевень/фигура в диаметральной плоскости
        for (const b of [stemBox, figBox]) {
          if (Math.abs(p.x) < b.x && p.z > b.z0 && p.z < b.z1 && p.y > b.y0 && p.y < b.y1) {
            const depth = Math.min(b.x - Math.abs(p.x), b.z1 - p.z, p.z - b.z0, b.y1 - p.y);
            if (depth > bowMax) {
              bowMax = depth;
              worst = `${label}:нос@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
            }
          }
        }
        // (б) дощатый корпус: внутри бокса какой-либо доски
        for (const r of recs) {
          const ext = Math.max(r.len, r.w, r.thick) * 0.5 + 0.12;
          if (Math.abs(r.center.z - p.z) > ext) continue;
          if (Math.abs(r.center.y - p.y) > ext) continue;
          if (Math.abs(r.center.x - p.x) > ext) continue;
          inv.copy(r.quat).invert();
          loc.copy(p).sub(r.center).applyQuaternion(inv);
          if (Math.abs(loc.x) < r.thick / 2 && Math.abs(loc.y) < r.w / 2
            && Math.abs(loc.z) < r.len / 2) {
            const depth = Math.min(
              r.thick / 2 - Math.abs(loc.x),
              r.w / 2 - Math.abs(loc.y),
              r.len / 2 - Math.abs(loc.z));
            hits++;
            if (depth > planksMax) {
              planksMax = depth;
              worst = `${label}@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
            }
          }
        }
      };
      for (const sl of vis.sails.sails) {
        const c = sl.quad.corners;
        const pv = sl.quad.pivot;
        if (sl.square) {
          // ПРЯМОЙ парус: параметрика полотна W×H (верхняя кромка у
          // реи), плоскость на −0.25 позади мачты; «пузо» +Z (по
          // ветру, uBelly ≥ 0); брасопка — поворот локальной точки
          // вокруг мачты (как уголки квада в Task 78)
          const W = sl.holeW, H = sl.holeH;
          for (const br of [0, 0.94, -0.94]) {
            const cb = Math.cos(br), sb = Math.sin(br);
            // РЕЯ: цилиндр длиной W·1.04 на пивоте — тоже режет доски
            for (let iu = 0; iu <= 8; iu++) {
              const x = (iu / 8 - 0.5) * W * 1.04;
              p.set(x * cb, pv.y, pv.z - x * sb);
              test(br === 0 ? 'рея' : `рея${br > 0 ? '+' : '−'}`);
            }
            for (let iu = 0; iu <= 6; iu++) {
              for (let iv = 0; iv <= 4; iv++) {
                const u = iu / 6, v = iv / 4;
                const lx = (u - 0.5) * W, ly = -H + v * H;
                const d = belly * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)
                  * (0.72 + 0.28 * (1 - v));
                const lz = -0.25 + d;
                p.set(lx * cb + lz * sb, pv.y + ly, pv.z + lz * cb - lx * sb);
                test(br === 0 ? (d ? 'прямой+пузо' : 'прямой') : `брасоп${br > 0 ? '+' : '−'}`);
              }
            }
          }
        } else {
          // КОСОЙ парус (кливер/латинский): треугольник голова—(конец
          // штага/рейки)—(шкот); «пузо» ±X (в подветренную сторону —
          // знак зависит от борта ветра, проверяем оба). Ориентация
          // меша: кливер rotY=+90° (мирZ = −локX), латинский rotY=−90°
          // (мирZ = +локX)
          const isLat = Math.abs(sl.mesh.rotation.y + Math.PI / 2) < 0.01;
          const sgn = isLat ? 1 : -1;
          const ax = sgn * c[1].z, ay = c[1].y;   // кливер: к галсовому / лат.: конец рейки
          const bx = sgn * c[2].z, by = c[2].y;   // кливер: шкот / лат.: шкотовый угол
          const sides = belly > 0 ? [belly, -belly] : [0];
          for (const ds of sides) {
            for (let iu = 0; iu <= 6; iu++) {
              for (let iv = 0; iv <= 4; iv++) {
                const u = iu / 6, v = iv / 4;
                const lx = u * THREE.MathUtils.lerp(ax, bx, v);
                const ly = u * THREE.MathUtils.lerp(ay, by, v);
                const d = ds * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)
                  * (0.72 + 0.28 * (1 - v));
                p.set(pv.x + d, pv.y + ly, pv.z + sgn * lx);
                test((isLat ? 'латин' : 'кливер') + (ds !== 0 ? (ds > 0 ? 'пузо+' : 'пузо−') : ''));
              }
            }
          }
          // ЛАТИНСКАЯ РЕЙКА: диагональ голова→конец у мачты — жёсткий
          // рангоут в диаметральной плоскости, проходит над носом
          if (isLat) {
            for (let iu = 0; iu <= 8; iu++) {
              const u = iu / 8;
              p.set(pv.x, pv.y + u * ay, pv.z + u * ax);
              test('латин.рей');
            }
          }
        }
      }
      // прибраться: геометрия аудита не нужна в сцене
      vis.group.traverse(o => {
        const m = o as THREE.Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh) m.geometry?.dispose();
      });
      out.push({
        id: P.id, name: P.name,
        planksMax: +planksMax.toFixed(3), smoothMax: +smoothMax.toFixed(3),
        bowMax: +bowMax.toFixed(3),
        hits, worst,
      });
    }
    return out;
  }

  /** Task 80: МЕШ-УРОВЕНЬ аудит парусов. Прежние аудиты (Task 78/79)
   *  параметризовали полотно КВАДОМ (углы+пивот) — а шейдер живёт на
   *  РЕАЛЬНЫХ вершинах меша (uBelly по uv, локальная ось Z меша,
   *  повороты родителей: мачта/сегмент/рея). Здесь проверяются сами
   *  вершины: matrixWorld (свежепостроенного visual, с брасопкой
   *  реи ±0.94 и промежуточными углами) + «пузо» шейдера ОБЕИХ
   *  сторон (до bellyMax), против штевня/галеонной фигуры, боксов
   *  досок и гладкого обвода (ниже кромки фальшборта). Возвращает
   *  ТОЛЬКО пресеты с нарушениями (для e2e-гарда). */
  debugSailMeshAudit(bellyMax = 1.7): { id: string; planksMax: number; bowMax: number; smoothMax: number; worst: string }[] {
    const out: { id: string; planksMax: number; bowMax: number; smoothMax: number; worst: string }[] = [];
    const p = new THREE.Vector3();
    const invq = new THREE.Quaternion();
    const loc = new THREE.Vector3();
    for (const P of Object.values(PRESETS)) {
      const vis = buildShip(P, { planking: true });
      const recs = vis.planks?.records ?? [];
      let planksMax = 0, bowMax = 0, smoothMax = 0;
      let worst = '';
      // нос: штевень + галеонная фигура (как в debugPlankSailAudit)
      const L0 = P.length;
      const stemBox = {
        x: 0.20, z0: L0 * 0.47, z1: L0 * 0.52,
        y0: -P.draft * 0.5, y1: hullProfile(1, P).bulwark * 0.9,
      };
      const figS = THREE.MathUtils.clamp(P.freeboard * 0.26, 0.55, 1.25)
        * THREE.MathUtils.clamp(P.freeboard * 0.30, 0.8, 1.6);
      const figBox = {
        x: 0.45 + figS * 0.55, z0: L0 / 2 - 0.15 - figS * 0.55, z1: L0 / 2 - 0.15 + figS * 0.65 + 0.35,
        y0: P.freeboard * 1.02, y1: P.freeboard * 1.02 + figS * 2.1,
      };
      const test = (label: string) => {
        // гладкий обвод: точка внутри корпуса НИЖЕ палубы
        const t = THREE.MathUtils.clamp((p.z + P.length / 2) / P.length, 0, 1);
        const hw = hullHalfWidthAt(P, t, p.y);
        const bw = hullProfile(t, P).bulwark;
        if (p.y < bw - 1.05 && Math.abs(p.x) < hw) {
          smoothMax = Math.max(smoothMax, hw - Math.abs(p.x));
        }
        // нос: штевень/фигура в диаметральной плоскости
        for (const b of [stemBox, figBox]) {
          if (Math.abs(p.x) < b.x && p.z > b.z0 && p.z < b.z1 && p.y > b.y0 && p.y < b.y1) {
            const depth = Math.min(b.x - Math.abs(p.x), b.z1 - p.z, p.z - b.z0, b.y1 - p.y);
            if (depth > bowMax) {
              bowMax = depth;
              worst = `${label}:нос@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
            }
          }
        }
        // дощатая обшивка
        for (const r of recs) {
          const ext = Math.max(r.len, r.w, r.thick) * 0.5 + 0.12;
          if (Math.abs(r.center.z - p.z) > ext) continue;
          if (Math.abs(r.center.y - p.y) > ext) continue;
          if (Math.abs(r.center.x - p.x) > ext) continue;
          invq.copy(r.quat).invert();
          loc.copy(p).sub(r.center).applyQuaternion(invq);
          if (Math.abs(loc.x) < r.thick / 2 && Math.abs(loc.y) < r.w / 2
            && Math.abs(loc.z) < r.len / 2) {
            const depth = Math.min(
              r.thick / 2 - Math.abs(loc.x),
              r.w / 2 - Math.abs(loc.y),
              r.len / 2 - Math.abs(loc.z));
            if (depth > planksMax) {
              planksMax = depth;
              worst = `${label}@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
            }
          }
        }
      };
      // свежий visual не в сцене — матрицы считаются от локальных
      vis.group.updateMatrixWorld(true);
      for (const sl of vis.sails.sails) {
        const mesh = sl.mesh;
        const geo = mesh.geometry;
        const posA = geo.attributes.position as THREE.BufferAttribute;
        const uvA = geo.attributes.uv as THREE.BufferAttribute;
        if (!posA || !uvA) continue;
        // прямые паруса: рея брасопится — проверяем углы между 0 и ±0.94
        // (дискретные 0/±0.94 пропускали попадания на промежуточных)
        const braces = sl.square && sl.brace
          ? [0, 0.94, -0.94, 0.55, -0.55, 0.78, -0.78] : [0];
        const savedBrace = sl.square && sl.brace ? sl.brace.rotation.y : 0;
        for (const br of braces) {
          if (sl.square && sl.brace) {
            sl.brace.rotation.y = br;
            mesh.updateWorldMatrix(true, false);
          }
          // «пузо» шейдера — ОБЕ стороны (борт ветра)
          for (const sgn of [1, -1]) {
            for (let i = 0; i < posA.count; i++) {
              const uvx = uvA.getX(i), uvy = uvA.getY(i);
              const belly = bellyMax * sgn * Math.sin(uvx * Math.PI) * Math.sin(uvy * Math.PI)
                * (0.72 + 0.28 * (1 - uvy));
              p.set(posA.getX(i), posA.getY(i), posA.getZ(i) + belly)
                .applyMatrix4(mesh.matrixWorld);
              test(`${sl.square ? 'прямой' : 'косой'}${sgn > 0 ? '+' : '−'}${sl.square ? '@br' + br.toFixed(2) : ''}`);
            }
          }
        }
        if (sl.square && sl.brace) {
          sl.brace.rotation.y = savedBrace;
          mesh.updateWorldMatrix(true, false);
        }
      }
      vis.group.traverse(o => {
        const m = o as THREE.Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh) m.geometry?.dispose();
      });
      if (planksMax > 0.02 || bowMax > 0.02 || smoothMax > 0.02) {
        out.push({
          id: P.id,
          planksMax: +planksMax.toFixed(3), bowMax: +bowMax.toFixed(3),
          smoothMax: +smoothMax.toFixed(3), worst,
        });
      }
    }
    return out;
  }

  /** Task 79: АУДИТ «МЁРТВЫЙ РАНГОУТ» — латинская рейка СЛОМАННОЙ
   *  мачты (фокус Task 78 не покрывал латинские суда). В гладком
   *  режиме рангоут не отстыковывается — вся мачта валится с рейкой:
   *  раньше длинная диагональная рейка прошивала нос/палубу. Теперь
   *  (Ship.ts) рейка складывается ВДОЛЬ мачты и пивот съезжает к
   *  пню — аудит проверяет ФИНАЛЬНУЮ позу мёртвой мачты (поворот
   *  1.38 рад + крен ±0.52 + посадка −2.6): ни одна точка рейки и
   *  пучка полотна не должна быть внутри дощатых боксов или
   *  гладкого обвода. */
  debugDeadRigAudit() {
    type Row = { id: string; lateen: number; planksMax: number; smoothMax: number; worst: string };
    const out: Row[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    for (const P of Object.values(PRESETS)) {
      const vis = buildShip(P, { planking: true });
      const recs = vis.planks?.records ?? [];
      let planksMax = 0, smoothMax = 0, lateenN = 0;
      let worst = '';
      const test = (label: string) => {
        const t = THREE.MathUtils.clamp((p.z + P.length / 2) / P.length, 0, 1);
        const hw = hullHalfWidthAt(P, t, p.y);
        const bw = hullProfile(t, P).bulwark;
        // внутрь гладкого корпуса (обвод) НАД ВОДОЙ до фальшборта
        if (p.y > 0.3 && p.y < bw && Math.abs(p.x) < hw) {
          const d = hw - Math.abs(p.x);
          if (d > smoothMax) { smoothMax = d; worst = `${label}@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`; }
        }
        for (const r of recs) {
          const ext = Math.max(r.len, r.w, r.thick) * 0.5 + 0.12;
          if (Math.abs(r.center.z - p.z) > ext) continue;
          if (Math.abs(r.center.y - p.y) > ext) continue;
          if (Math.abs(r.center.x - p.x) > ext) continue;
          const inv2 = new THREE.Quaternion().copy(r.quat).invert();
          const loc2 = new THREE.Vector3().copy(p).sub(r.center).applyQuaternion(inv2);
          if (Math.abs(loc2.x) < r.thick / 2 && Math.abs(loc2.y) < r.w / 2
            && Math.abs(loc2.z) < r.len / 2) {
            const depth = Math.min(
              r.thick / 2 - Math.abs(loc2.x),
              r.w / 2 - Math.abs(loc2.y),
              r.len / 2 - Math.abs(loc2.z));
            if (depth > planksMax) {
              planksMax = depth;
              worst = `${label}:доски@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
            }
          }
        }
      };
      for (let mi = 0; mi < vis.masts.length; mi++) {
        const mast = vis.masts[mi];
        // мачта УПАЛА: поворот и посадка из Ship.updateVisual
        const lean = (mi % 2 === 0 ? 1 : -1) * 0.52;
        eul.set(1.38, 0, lean);
        q.setFromEuler(eul);
        const mz = mast.position.z;
        const toShip = (lx: number, ly: number, lz: number) => {
          p.set(lx, ly, lz).applyQuaternion(q);
          p.y += -2.6; p.z += mz;
        };
        // Task 79: и сам МАЧТОВЫЙ ШЕСТ (в гладком режиме падает
        // ЦЕЛИКОМ — весь рангоут его потомки): не должен прошивать
        // корпус/носовые доски
        const mh = ((mast.userData.height as number) || 20) - P.draft * 0.3;
        for (let iu = 0; iu <= 10; iu++) {
          toShip(0, mh * iu / 10, 0);
          test('мачта');
        }
        for (const s of vis.sails.sails) {
          if (s.mastIndex !== mi || !s.lateenYard) continue;
          lateenN++;
          const len = ((s.lateenYard.geometry as unknown) as { parameters: { height: number } }).parameters.height;
          // ФИНАЛЬНАЯ поза фикса: пивот у пня (мачта-локаль y=1.0),
          // рейка вдоль мачты: (0.26, 2.2..2.2+len, 0.12) в локале мачты
          for (let iu = 0; iu <= 8; iu++) {
            toShip(0.26, 2.2 + len * iu / 8, 0.12);
            test('рейка');
          }
          // пучок зарифленного полотна у пня
          toShip(0, 1.1, 0);
          test('полотно');
        }
      }
      vis.group.traverse(o => {
        const m = o as THREE.Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh) m.geometry?.dispose();
      });
      if (lateenN > 0) out.push({
        id: P.id, lateen: lateenN,
        planksMax: +planksMax.toFixed(3), smoothMax: +smoothMax.toFixed(3), worst,
      });
    }
    return out;
  }

  /** Поразить «человечков» на берегу (жители деревень + пираты
   *  логова) — сабля/пистолет игрока (Task 36) */
  killFolkNear(x: number, y: number, z: number, r: number, mode: 'grape' | 'ball', dx?: number, dz?: number): number {
    let killed = 0;
    for (const f of this.world.villageFolk) {
      killed += f.killNear(x, y, z, r, mode, dx, dz);
    }
    if (this.lairFolk) killed += this.lairFolk.killNear(x, y, z, r, mode, dx, dz);
    return killed;
  }


  /** Пиратская эскадра в логове: 7 судов плотным кольцом у берега +
   *  2 патруля вокруг острова; флагман — «Чёрная жемчужина» */
  private spawnPirateFleet(aiOpts: { durabilityMul: number }) {
    const isl = this.world.islands.find(i => i.name === 'Логово пиратов');
    if (!isl) return;
    const terrain = (x: number, z: number) => heightAt(x, z);
    // Task 36: якорные стоянки на ГЛУБОКОЙ воде (кромка выросшего
    // острова дальше от центра, чем прежний r)
    const ring = (aDeg: number, dist: number) => {
      const a = aDeg * Math.PI / 180;
      let rr = isl.r * 1.25 + dist;
      let p = new THREE.Vector3(isl.cx + Math.cos(a) * rr, 0, isl.cz + Math.sin(a) * rr);
      for (let t = 0; t < 30 && heightAt(p.x, p.z) > -7; t++) {
        rr += 120;
        p = new THREE.Vector3(isl.cx + Math.cos(a) * rr, 0, isl.cz + Math.sin(a) * rr);
      }
      return p;
    };
    // [модель, угол°, дистанция от берега, yaw, экипаж, золото, груз]
    // Task 50: [модель, угол°, дистанция, yaw, экипаж, золото, груз, ФЛАГ].
    // Флот у острова теперь СМЕШАННЫЙ: «Чёрная жемчужина» и Le
    // Mystique со шлюпом — пираты (чёрный флаг, пиратская вольница
    // на палубе); бриг — ВОЕННЫЙ патруль (солдаты в мундирах);
    // каравелла/когг/флейт-шлюп — ТОРГОВЦЫ (простые матросы).
    const specs: [string, number, number, number, number, number, number[], FlagKind][] = [
      ['blackpearl', 180, 95, 0.1, 120, 2600, [12, 8, 10, 4, 3], 'pirate'],
      ['sloop', 152, 55, 0.7, 20, 260, [3, 2, 4, 0, 0], 'pirate'],
      ['sloop', 208, 55, -0.6, 20, 240, [2, 3, 3, 1, 0], 'merchant'],
      ['brig', 122, 75, 1.1, 52, 720, [6, 4, 8, 2, 1], 'navy'],
      ['mystique', 252, 65, -1.2, 92, 820, [5, 6, 4, 3, 2], 'pirate'],
      ['caravel', 92, 90, 2.0, 24, 420, [4, 3, 5, 1, 1], 'merchant'],
      ['cog', 300, 85, -2.2, 26, 380, [7, 2, 9, 0, 0], 'merchant'],
    ];
    for (const [model, a, dist, yaw, crew, gold, loot, flag] of specs) {
      // Task 56: мертвецы — ТОЛЬКО на «Чёрной жемчужине»; шлюп и
      // Mystique при логове — обычные живые пираты
      const sh = new Ship(model, false, this.wind, terrain, this.particles,
        { ...aiOpts, flag, crewUndead: model === 'blackpearl' });
      sh.position.copy(ring(a, dist));
      sh.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
      sh.crew = crew;
      sh.gold = gold;
      sh.cargo = { sugar: loot[0], rum: loot[1], timber: loot[2], spice: loot[3], silk: loot[4] };
      setFlagKind(sh.visual, flag);  // паруса/флаг соответствуют судну
      this.worldGroup.add(sh.visual.group);
      this.worldGroup.add(sh.foam.mesh);
      this.worldGroup.add(sh.wake.mesh);
      this.aiShips.push(new AIShip(sh, [], 'anchored'));
    }
    // два ПАТРУЛЯ вокруг острова — ВОЕННЫЕ корветы с солдатами
    // (Task 50: прежде ходили под чёрным флагом с пиратами на палубе)
    for (const [model, a0, crew, gold] of [
      ['sloop', 0, 18, 300], ['brig', 180, 48, 650],
    ] as [string, number, number, number][]) {
      const sh = new Ship(model, false, this.wind, terrain, this.particles,
        { ...aiOpts, flag: 'navy' });
      sh.position.copy(ring(a0, 280));
      sh.crew = crew;
      sh.gold = gold;
      setFlagKind(sh.visual, 'navy');
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
    // Task 80: НАБОР КОРПУСА — треск и ПЕРЕЛОМ (все корабли: игрок,
    // ИИ, мишени полигона; статический хук Ship)
    Ship.onAnyKeelCrack = (s, broke) => {
      const who = s === this.player ? 'Наш корабль' : s.preset.name;
      this.audio.creak(broke ? 1 : 0.55);
      if (broke) {
        this.rig.addShake(s === this.player ? 0.9 : 0.4);
        this.pushMessage(`☠ ${who}: корпус ПЕРЕЛОМИЛСЯ пополам — корабль уходит под воду!`);
      } else {
        this.pushMessage(`${who}: набор корпуса трещит по швам!`);
      }
    };
    Ship.onAnyMastBroken = (s, idx) => {
      const who = s === this.player ? 'Наш корабль' : s.preset.name;
      const wp = s.visual.masts[idx]?.getWorldPosition(new THREE.Vector3()) ?? s.position;
      this.audio.woodHit(distToPlayer(wp));
      this.pushMessage(`${who}: мачта переломлена!`);
    };
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
      const d = (p as { pos: THREE.Vector3; target: Ship; shooter?: Ship });
      this.audio.woodHit(distToPlayer(d.pos));
      if (d.target === this.player) { this.rig.addShake(0.5); this.playerHitCount++; }
      // ИИ реагирует на агрессию игрока
      const ai = this.aiShips.find(a => a.ship === d.target);
      if (ai) ai.onPlayerAggression(this.aiShips);
      // Task 80: триггер проклятия от ПОПАДАНИЙ УДАЛЁН — капитан
      // становится мертвецом только когда корабль игрока сам
      // становится «Чёрной жемчужиной» (выбор на полигоне/верфи:
      // changeShip → lander.setCursed + crewUndead у экипажа)
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
      { durabilityMul: this.settings.gameplay.hullDurability, boatCount: this.settings.gameplay.boatCount,
        planking: this.settings.gameplay.hullModel === 'planks' });
    ship.position.copy(this.pgTargetPos());
    ship.position.y = 0;
    ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)); // параллельно игроку
    ship.noSurrender = true;
    this.worldGroup.add(ship.visual.group);
    this.worldGroup.add(ship.foam.mesh);
    this.worldGroup.add(ship.wake.mesh);
    const ai = new AIShip(ship, [], 'anchored');
    ai.returnFire = this.pgReturnFire;
    ai.isProvingTarget = true;              // Task 46: без инициативы — только тумблер игрока
    ship.crewEngage = this.pgReturnFire;   // Task 44: без «отвечать огнём» ружья мишени молчат
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
    SEA.amp01 = windFactor(4.2);
    this.seaAmpSmooth = SEA.amp01;
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
    if (this.pgTarget) {
      this.pgTarget.returnFire = on;
      this.pgTarget.ship.crewEngage = on;   // Task 44: стрелки мишени — только в этом режиме
    }
  }

  resetProvingTarget() {
    if (!this.pgTarget) return;
    const s = this.pgTarget.ship;
    s.clearDamage();
    // Task 86: абордаж выбивал экипаж мишени — вернуть команду
    // (как при спавне: 80% от полного состава), иначе после первой
    // проверки штурмать некого
    s.crew = Math.round(s.preset.maxCrew * 0.8);
    s.surrendered = false;
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
  //  на полигоне смена бесплатная — песочница; force — пересборка
  //  того же корпуса при смене КОЛИЧЕСТВА ШЛЮПОК, Task 33) =====
  changeShip(presetId: string, free = false, force = false): string | null {
    if (!PRESETS[presetId]) return 'Судно не найдено на верфи';
    if (presetId === this.player.preset.id && !force) return 'Вы уже на этом корабле';
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
    // новый корабль (прочность — из настроек; шлюпок — сколько
    // выставлено в настройках, Task 33)
    const gp = this.settings.gameplay;
    const np = new Ship(presetId, true, this.wind, (x, z) => heightAt(x, z), this.particles,
      { durabilityMul: gp.hullDurability, ammo: { ...gp.startingAmmo }, boatCount: gp.boatCount,
        planking: gp.hullModel === 'planks',
        crewCats: gp.catsInsteadOfCrew,
        crewDetailed: this.settings.graphics.crewDetail === 'detailed',
        // Task 57: «Чёрная жемчужина» несёт ПРОКЛЯТУЮ команду —
        // мертвецы и при выборе на полигоне, и при покупке на верфи.
        // Task 76: капитан нового корабля — по-прежнему ИГРОК
        crewUndead: presetId === 'blackpearl',
        captainTraits: appearanceToTraits(this.settings.player) });
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
    this.syncCaptainSpyglass();       // Task 77: капитан продолжает смотреть в трубу
    // Task 80: корабль игрока стал «Чёрной жемчужиной» → капитан-игрок
    // (и на палубе, и в прогулке/высадке) — МЕРТВЕЦ с ЗЕЛЁНЫМ клинком;
    // никакие попадания снарядов больше не участвуют
    const cursedNow = presetId === 'blackpearl';
    this.lander?.setCursed(cursedNow);
    this.captainCursed = cursedNow;
    if (cursedNow) this.pushMessage('☠ Капитан «Чёрной жемчужины»: кожа мертвеца, в ножнах светится зелёный клинок');
    // шлюпка нового корабля — свой контроллер спуска (след пены
    // старой шлюпки снимается со сцены)
    this.boatLaunch?.dispose();
    this.boatLaunch = new BoatLaunch({
      ship: np, worldGroup: this.worldGroup, particles: this.particles,
      islands: () => this.world.islands,
      heightAt: (x, z) => heightAt(x, z),
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
    // коты перебираются на новый корабль вместе с капитаном
    this.attachCats();
    // каркас кораблей — на новый визуал
    this.applyWireframe(this.settings.graphics.wireframe);
    this.rig.snap();
    this.pushMessage(`⚓ Новый корабль: ${np.preset.name} (${np.preset.shipClass})` +
      (free ? ` — экипаж ${np.crew}/${np.preset.maxCrew}` : ''));
    return null;
  }

  /** ============================================================
   *  Task 46: ПЕРЕСБОРКА ВИЗУАЛОВ ВСЕХ КОРАБЛЕЙ — дощатая модель
   *  корпуса ↔ обычная (настройка «Игра → Модель корпуса»).
   *  Физика/урон/вода/экипаж/мачты — СОХРАНЯЮТСЯ; внешние
   *  повреждения (декали/доски/сорванные детали) — с нуля.
   *  ============================================================ */
  private rebuildAllVisuals(planking: boolean) {
    const ships: Ship[] = [this.player, ...this.aiShips.map(a => a.ship)];
    if (this.pgTarget) ships.push(this.pgTarget.ship);
    for (const sh of ships) {
      if (!sh || sh.sunk) continue;
      sh.rebuildVisual(planking);
      // купленный флаг/скины — на новый визуал
      if (sh.flagKind) setFlagKind(sh.visual, sh.flagKind);
      if (sh === this.player) {
        this.applyUpgrades(sh);
        this.applySkins(sh);
        this.attachCats();
        // контроллер шлюпки держит ссылки на старый визуал
        this.boatLaunch?.abort();
        this.boatLaunch?.dispose();
        this.boatLaunch = new BoatLaunch({
          ship: sh, worldGroup: this.worldGroup, particles: this.particles,
          islands: () => this.world.islands,
          heightAt: (x, z) => heightAt(x, z),
          msg: (t) => this.pushMessage(t),
          onSplash: () => this.audio.splash(0),
        });
        this.combat.resizeReloads(sh.visual.gunsPort.length + sh.visual.gunsStarboard.length);
      }
    }
    // каркас (wireframe) — на новые материалы
    this.applyWireframe(this.settings.graphics.wireframe);
    this.rig.snap();
    this.pushMessage(planking
      ? 'Модель корпуса: ДОЩАТАЯ — обшивка из досок, 4 стадии повреждения, скелет виден в проломах'
      : 'Модель корпуса: обычная (гладкая обшивка, прежние пробоины)');
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
    this.pushMessage('Поднять паруса! W — паруса, A/D — руль, Q/E — прицел, C — камера, B — шлюпка');
    this.pushMessage('Новый архипелаг в 100 раз больше: 30 островов с горами и джунглями. Шлюпка (B) — к берегу, E — высадка с саблей и пистолетом');
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

  // ===== КОРАБЕЛЬНЫЕ КОТЫ: покупка в порту (только игрок, ≤5) =====
  /** собрать «кошачью палубу» на текущем корабле игрока
   *  (вызывается при старте и после смены судна) */
  private attachCats() {
    const seed = Array.from(this.player.preset.id)
      .reduce((a, ch) => a + ch.charCodeAt(0) * 17, 5)
      + Math.round(this.player.preset.beam * 91);
    // Task 84: на проклятом корабле (жемчужина) коты — МЕРТВЕЦЫ
    this.cats3d = buildCats(this.player.preset, seed, (idx) => {
      // кот поймал мышь — сообщение с кличкой (не чаще раза в 20 с)
      const now = this.time;
      if (now - this._lastCatMsg < 20) return;
      this._lastCatMsg = now;
      const nm = this.catNames[idx] ?? 'Кот';
      this.pushMessage(`🐱 ${nm} поймал мышь!`);
    }, this.player.crewUndeadOpt);
    this.cats3d.setCount(this.catCount);
    this.player.visual.group.add(this.cats3d.group);
  }

  private _lastCatMsg = -1e9;

  /** купить кота в порту: 50 зол., не более 5 на борту */
  portBuyCat(): string | null {
    if (this.catCount >= MAX_SHIP_CATS) return 'На борту уже пять котов — больше не возьмут';
    if (this.player.gold < CAT_PRICE) return `Не хватает золота (кот стоит ${CAT_PRICE} зол.)`;
    this.player.gold -= CAT_PRICE;
    const used = new Set(this.catNames);
    const name = CAT_NAMES.find(n => !used.has(n)) ?? 'Кот';
    this.catNames[this.catCount] = name;
    this.catCount++;
    this.cats3d?.setCount(this.catCount);
    this.pushMessage(`🐱 Кот ${name} взошёл по трапу! Котов на борту: ${this.catCount}/${MAX_SHIP_CATS}`);
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
      this.player.flagKind = sk.flag;
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
    if (this.skinsOn.flag) { setFlagKind(sh.visual, this.skinsOn.flag); sh.flagKind = this.skinsOn.flag; }
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
  /** Task 85: цель у борта. 'prize' — сдавшееся судно (G — забрать
   *  приз), 'assault' — живой противник (G — АБОРДАЖ: кошки, талы,
   *  мостки, бой на палубах; Task 88 — своя клавиша c.boarding).
   *  Абордируем ЛЮБОЕ непотопленное судно — морская пиратская
   *  песочница, торговцы тоже жертвы. */
  canBoard(): { ai: AIShip; kind: 'prize' | 'assault' } | null {
    if (this.docked || this.player.sinking || this.boarding) return null;
    // Task 86: ПРОВЕРКА АБОРДАЖА НА ПОЛИГОНЕ — мишень на якоре
    // абордируема (она никогда не сдаётся — всегда штурм). Чистая
    // вода + стоячая цель = детерминированный стенд конвейера
    // подход → сцепка → мостки → бой → исход. Проверяется ПЕРВОЙ,
    // чтобы случайный ИИ-корабль не перебивал мишень
    if (this.proving && this.pgTarget && !this.pgTarget.ship.sinking && !this.pgTarget.ship.sunk) {
      const dpg = this.pgTarget.ship.position.distanceTo(this.player.position);
      if (dpg <= 55 && this.player.speedKnots() <= 5) {
        return { ai: this.pgTarget, kind: 'assault' };
      }
    }
    for (const ai of this.aiShips) {
      if (ai.ship.sinking || ai.ship.sunk || ai.state === 'derelict') continue;
      if (ai.ship === this.player) continue;
      const d = ai.ship.position.distanceTo(this.player.position);
      if (d > 55) continue;
      if (this.player.speedKnots() > 5) continue;
      if (ai.state === 'surrender' || ai.ship.surrendered) return { ai, kind: 'prize' };
      return { ai, kind: 'assault' };
    }
    return null;
  }

  /** Task 85/87: НАЧАТЬ АБОРДАЖ. byPlayer=true — штурмует игрок (E),
   *  false — brawler-ИИ сам полез на борт. На время боя корабли
   *  ведёт модуль (крючья + тали), ИИ цели замораживается. Ход
   *  обоих корпусов гасит сам модуль — тросы легли на планширь */
  startBoarding(ai: AIShip, byPlayer: boolean) {
    if (this.boarding || this.docked || this.player.sinking || ai.ship.sinking) return;
    const attacker = byPlayer ? this.player : ai.ship;
    const defender = byPlayer ? ai.ship : this.player;
    ai.frozen = true;
    // цель-обороняющийся ложится в дрейф (паруса вниз)
    if (byPlayer) {
      ai.ship.sailTarget = 0;
      ai.ship.rudderTarget = 0;
    }
    // выход из режима прицела — капитан идёт на абордаж
    if (this.combat.aim.active) this.combat.toggleAim(this.combat.aim.side);
    this.boarding = new Boarding(attacker, defender, {
      pushMessage: (t) => this.pushMessage(t),
      audio: {
        woodHit: () => this.audio.woodHit(),
        saber: () => this.audio.saberSwing(),
        bell: () => this.audio.bell(),
      },
      splash: (x, y, z, size) => this.particles.splash(x, y, z, size),
      sceneRoot: this.worldGroup,
      onEnd: (result: BoardingResult) => this.finishBoarding(ai, result),
    });
    this.boardingTarget = null;
    this.boardKind = null;
  }

  /** Task 85: абордаж окончен — снять блокировки, применить исход */
  private finishBoarding(ai: AIShip, result: BoardingResult) {
    this.boarding = null;
    this.lastBoardingResult = result;
    ai.frozen = false;
    ai.boardCd = 90;   // повторное нападение — не сразу
    if (result === 'lost') {
      this.dead = true;
      this.deadReason = 'captured';
      this.pushMessage('Корабль захвачен абордажной командой...');
    }
    // Task 86: ПОЛИГОН — итог проверки абордажа в судовой журнал;
    // мишень после штурма без экипажа — «⟳ Восстановить» вернёт
    // и команду, и корпус — проверку можно повторять
    if (this.proving && ai.isProvingTarget && result !== 'lost') {
      const label = result === 'won'
        ? 'проверка пройдена — мишень взята'
        : result === 'repelled' ? 'атака отбита' : 'проверка сорвана';
      this.pushMessage(`Полигон (абордаж): ${label}. «⟳ Восстановить» — повтор`);
    }
  }

  /** Task 85 (e2e/отладка): телеметрия абордажа */
  boardingInfo() {
    return this.boarding ? this.boarding.snapshot() : null;
  }

  /** Task 85 (e2e/отладка): насильно начать абордаж с ИИ-кораблём
   *  номер i — игрок телепортируется ПОЗАДИ цели по её курсу, носом
   *  на неё (детерминированный быстрый подход), скорости обнуляются;
   *  полный конвейер фаз сохранён */
  forceBoarding(i: number): boolean {
    const ai = this.aiShips[i];
    if (!ai || !this.started || this.boarding || ai.ship.sinking || ai.ship.sunk) return false;
    const cd = (this.player.preset.beam + ai.ship.preset.beam) / 2 + 2.6;
    // позади цели по её курсу — автопилоту остаётся прямой сближающийся
    // проход (без разворота на 90°, который на слабом fps длителен)
    const off = new THREE.Vector3(0, 0, -(cd * 2.3)).applyQuaternion(ai.ship.quaternion);
    this.player.position.copy(ai.ship.position).add(off);
    this.player.position.y = ai.ship.position.y;
    this.player.quaternion.copy(ai.ship.quaternion);
    this.player.velocity.set(0, 0, 0);
    if (this.player.angular) this.player.angular.set(0, 0, 0);
    this.player.anchored = false;
    this.player.rudderTarget = 0;
    this.player.sailTarget = 0;
    ai.ship.velocity.set(0, 0, 0);
    if (ai.ship.angular) ai.ship.angular.set(0, 0, 0);
    this.startBoarding(ai, true);
    return true;
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

    // === НА БЕРЕГУ / НА ПАЛУБЕ ПЕШКОМ (Task 36/40): третье лицо,
    //     WASD+мышь, сабля/пистолет; управление кораблём отключено ===
    if (this.lander && this.lander.active) {
      const bl0 = this.boatLaunch;
      this.lander.nearBoat = this.lander.mode === 'island' && !!(bl0 && bl0.phase === 'afloat'
        && Math.hypot(bl0.pos.x - this.lander.pos.x, bl0.pos.z - this.lander.pos.z) < 6);
      this.lander.handleInput({
        isDown: (code) => inp.isDown(code),
        pressed: (code) => inp.pressed(code),
        mouseDX: inp.mouseDX, mouseDY: inp.mouseDY, wheel: inp.wheelDelta,
        lmbJust: inp.lmbJust, rmb: inp.rmb || this.lander.debugHoldRmb,
      });
      if (this.lander.mode === 'deck') {
        // ВЫХОД С ПАЛУБЫ: та же клавиша (V) или E у штурвала
        if (inp.pressed(c.deckWalk) || (inp.pressed(c.aimStarboard) && this.lander.nearWheel)) {
          this.lander.exitDeck();
          this.lander.restoreCamera();
          this.rig.snap();
          this.pushMessage('Капитан снова за штурвалом!');
        }
      } else if (inp.pressed(c.aimStarboard) && this.lander.nearBoat) {
        this.lander.despawn();
        this.lander.restoreCamera();
        bl0!.resumeFromShore();
        this.rig.snap();
        this.pushMessage('Матрос снова в шлюпке — вёсла на воду!');
      }
      inp.endFrame();
      return;
    }

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
      // ВЫСАДКА НА БЕРЕГ (Task 36): E на мелководье у кромки —
      // моряк сходит на землю (третье лицо, WASD+мышь, оружие)
      if (inp.pressed(c.aimStarboard) && bl.phase === 'afloat' && !bl.frozen && bl.nearShore()) {
        const lp = bl.landingPoint();
        if (lp) {
          bl.freezeAtShore();
          // лицом к суше: направление шлюпка → точка высадки
          const fx = lp.x - bl.pos.x, fz = lp.z - bl.pos.z;
          const fl = Math.hypot(fx, fz) || 1;
          this.lander!.spawn(lp.x, lp.z, fx / fl, fz / fl);
          this.rig.snap();
        } else {
          this.pushMessage('Берег слишком крут — не сойти');
        }
      }
      p.rudderTarget = 0;
      inp.endFrame();
      return;
    }

    // === АБОРДАЖ (Task 85): руль и паруса ведёт абордажная
    //     команда (модуль Boarding: авто-подход → сцепка → бой).
    //     ВАЖНО: здесь НЕ обнуляем sailTarget/rudderTarget — модуль
    //     выставляет их ПОСЛЕ физики (boarding.update в stepFrame),
    //     обнуление здесь затирало бы команды автопилота каждый
    //     кадр. В сцепке (lash/fight) руль и паруса гасит сам модуль
    //     (holdLash). Камера и сообщения остаются доступны игроку ===
    if (this.boarding) {
      p.rowing = 0;
      if (inp.pressed(c.camera)) {
        this.rig.cycleMode();
        this.pushMessage(`Камера: ${CAMERA_LABEL[this.rig.mode]}`);
      }
      inp.endFrame();
      return;
    }

    // === ПРОГУЛКА ПО ПАЛУБЕ (Task 40): V — капитан сходит с мостика
    //     и идёт по палубе/квартердеку (рулевой остаётся у штурвала,
    //     корабль продолжает идти заданным курсом) ===
    if (inp.pressed(c.deckWalk)) {
      this.lander!.enterDeck(deckPlan(p.preset), p.visual.group);
      this.rig.snap();
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
      // Task 88: ДЕПРЕССИЯ ПРИЦЕЛА — вниз до −0.10 рад (≈ −6°):
      // близкая цель и ватерлиния НИЖЕ линии стволов; раньше элевация
      // была зажата в [0.01, 0.24] (только вверх) — в упор стрелять
      // по корпусу было нечем. Дальность — симуляция траектории,
      // отрицательная элевация обрабатывается штатно
      this.combat.aim.elevation = clamp(this.combat.aim.elevation - inp.mouseDY * 0.0016, -0.10, 0.24);
    }

    // борта; «правый борт» ещё и взаимодействие
    const boardTarget = this.canBoard();
    const canDockHere = this.canDock();
    this.boardingTarget = boardTarget?.ai ?? null;
    this.boardKind = boardTarget?.kind ?? null;
    // Task 50: прицел требует ВИДИМЫЙ курсор (наведение по позиции
    // мыши) — при активации прицела освобождаем перехват
    if (this.combat.aim.active && this.input.pointerLocked) this.input.releaseLock();
    // Task 51: прицеливание — опустить трубу (нужен широкий обзор)
    if (this.combat.aim.active && this.spyglassOn) {
      this.spyglassOn = false;
      this.rig.spyglass = false;
      // Task 77: капитан складывает трубу
      this.player.crew3d?.captainSpyglass(false);
    }
    if (inp.pressed(c.aimPort)) {
      this.combat.toggleAim(-1);
    }
    // Task 51: подзорная труба (T) — независимо от бортов
    if (inp.pressed(c.spyglass)) {
      this.toggleSpyglass();
    }
    if (inp.pressed(c.aimStarboard)) {
      if (canDockHere && !this.combat.aim.active && !boardTarget) {
        this.dock();
      } else if (!boardTarget) {
        this.combat.toggleAim(1);
      }
    }
    // Task 88: АБОРДАЖ/приз — СВОЯ клавиша (по умолчанию G, настройка
    // «Управление»). Раньше висел на E вместе с прицелом правого
    // борта, высадкой и причалом — E была перегружена
    if (inp.pressed(c.boarding)) {
      if (boardTarget) {
        if (boardTarget.kind === 'prize') this.takePrize(boardTarget.ai);
        else this.startBoarding(boardTarget.ai, true);
      }
    }

    // огонь; ЛКМ — одиночный выстрел (при прицеле);
    // КОМБИНАЦИИ (Task 29): E+Пробел — залп ПРАВОГО борта,
    // Q+Пробел — ЛЕВОГО (прицел на нужную сторону включается сам)
    if (this.combat.aim.active && inp.lmbJust) this.combat.fireOne();
    if (inp.pressed(c.fire)) {
      const starHeld = inp.isDown(c.aimStarboard);
      const portHeld = inp.isDown(c.aimPort);
      if (starHeld || portHeld) {
        const side = starHeld ? 1 : -1;
        // авто-открытие портов при залпе (как при прицельном)
        if (p.visual.gunPorts.length && !p.portsOpen) {
          p.portsOpen = true;
          this.pushMessage('Порты открываются — залп задержится!');
        }
        const fired = this.combat.fireSideVolley(side);
        if (fired > 0) {
          this.pushMessage(side === 1 ? 'Залп правого борта!' : 'Залп левого борта!');
        }
      } else if (this.combat.aim.active) {
        this.combat.fireBroadside();
      }
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
        // Task 85: сцепленные абордажной паре корабли НЕ расталкиваются —
        // они сходятся борт-в-борт НАРОЧНО (подход ведёт модуль Boarding,
        // скорость к моменту сцепки погашена, таран не засчитывается)
        if (this.boarding) {
          const A = this.boarding.attacker, B = this.boarding.defender;
          if ((a === A && b === B) || (a === B && b === A)) continue;
        }
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
      started: false, dead: false, deadReason: null,
      speed: 0, headingDeg: 0, windFromDeg: 0, windSpeed: 0, windRelDeg: 0,
      sailLevel: 0, rudder: 0, hullPct: 1, sailPct: 1, crew: 0, maxCrew: 0, waterPct: 0,
      onFire: false, firePct: 0, anchored: false, grounded: false, sinking: false,
      spyglass: false,
      spyZoom: 4,
      ammoType: 'ball', ammoCounts: {}, planks: 0, gold: 0, cats: 0, cargo: {},
      cargoT: 0, cargoMaxT: 0,
      aiming: false, aimSide: '', aimRange: 0, gunsReadyPct: 0, targetName: null,
      cameraLabel: CAMERA_LABEL.iso, clock: '', seaState: 0, repairAction: null,
      canDock: false, nearPortName: null, canBoard: false, boardedName: null,
      boardKind: null, boarding: null, lastBoardingResult: null,
      shipId: 'sloop', shipName: '', shipClass: '', docked: false,
      portInfo: null, oars: null, gunPorts: null, figureOn: 'figure.stock', decoOn: 'deco.none',
      messages: [], mapIslands: [], mapShips: [], mapPlayer: { x: 0, z: 0, h: 0 },
      fps: 60, dayF: 1,
      proving: false, target: null, boat: null, land: null,
    };
  }

  private updateHud() {
    const p = this.player;
    const h = this.hud;
    // КОМПАС (Task 33 — фикс «кренит по правому борту непонятно
    // откуда»): единая система координат — север = −Z (как на карте
    // и миникарте), восток = +X. Раньше курс и ветер считались
    // ОДНОЙ формулой (−угол), но курс 0 смотрел на +Z, а ветер 0 —
    // на +X: указатель ветра был повернут на 90° от реальности,
    // игрок ставил корабль «по ветру» — а ветер дул в борт
    const compass = (dx: number, dz: number) =>
      ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
    const f = p.forward;
    const hdgDeg = Math.round(compass(f.x, f.z));
    const windDeg = Math.round(compass(Math.cos(this.wind.from), Math.sin(this.wind.from)));
    const rel = (windDeg - hdgDeg + 360) % 360;   // 0=в нос, 90=правый борт
    h.started = this.started;
    h.dead = this.dead;
    h.deadReason = this.dead ? this.deadReason : null;
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
    h.cats = this.catCount;
    h.cargo = { ...p.cargo };
    h.spyglass = this.spyglassOn;          // Task 51: труба капитана
    h.spyZoom = +this.rig.spyZoom.toFixed(1);   // Task 52: кратность
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
    // волнение: огибающая единого моря (сумма амплитуд гармоник)
    h.seaState = +(waveEnvelope()).toFixed(2);
    h.repairAction = p.pumpAction ? (p.onFire ? 'Тушение пожара...' : p.water > 0.05 ? 'Откачка воды...' : p.planks > 0 && p.hullHP < p.hullMax ? 'Ремонт...' : null) : null;
    h.canDock = this.canDock();
    h.nearPortName = this.nearPort?.name ?? null;
    h.canBoard = !!this.boardingTarget;
    h.boardedName = this.boardingTarget?.ship.preset.name ?? null;
    h.boardKind = this.boardKind;
    h.boarding = this.boarding ? this.boarding.snapshot() : null;
    h.lastBoardingResult = this.lastBoardingResult;
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
    // острова на карте: ПОЛИГОНЫ берега (неправильная форма), не круги
    h.mapIslands = this.world.islands.map((i, idx) => ({
      x: i.cx, z: i.cz, r: i.r, name: i.name,
      discovered: this.world.discovered.has(i.name), type: i.type,
      pts: this.world.outlines[idx] ?? [],
    }));
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
    // ВЫСАДКА/ПАЛУБА: HUD — оружие/прицел/подсказки
    if (this.lander?.active) {
      const lh = this.lander.hud();
      const onDeck = lh.mode === 'deck';
      h.land = {
        active: true, mode: lh.mode, weapon: lh.weapon, weaponLabel: lh.weaponLabel,
        aiming: lh.aiming, nearBoat: lh.nearBoat, nearWheel: lh.nearWheel,
        canLand: false,
        hint: onDeck
          ? (lh.nearWheel ? 'E — за штурвал' : lh.weapon === 'none' ? '1 — сабля · 2 — пистолет · 3 — труба · V — к штурвалу' : 'ЛКМ — атака · ПКМ — труба/прицел · X — убрать · V — к штурвалу')
          : lh.nearBoat
            ? 'E — в шлюпку'
            : lh.weapon === 'none' ? '1 — сабля · 2 — пистолет · 3 — труба · WASD — идти'
            : 'ЛКМ — атака · X — убрать оружие · Shift — бег',
      };
    } else {
      const bl = this.boatLaunch;
      const canLand = !!(bl && bl.phase === 'afloat' && !bl.frozen && bl.nearShore());
      h.land = {
        active: false, mode: 'off', weapon: 'none', weaponLabel: '', aiming: false,
        nearBoat: false, nearWheel: false, canLand,
        hint: canLand ? 'E — высадиться на берег' : '',
      };
    }
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
  /** Сглаженный набег волны (море набирает волну с запаздыванием) */
  private seaAmpSmooth = 0.31;
  /** последнее значение счётчика зелёной воды игрока (для сообщений) */
  private lastGreenWater = 0;
  private lastGreenWaterMsgT = -99;
  /** сколько матросов уже смыло (сообщение при росте) — Task 32 */
  private lastWashedCrew = 0;
  /** последний визуал погоды (облачность/солнце/туман/дождь) */
  private weatherVis = { cloudiness: 0.35, sunDim: 1, fogMul: 1, rainI: 0 };
  // Task 40: КАПИТАН РАЗДАЁТ УКАЗАНИЯ — фигурка на мостике машет
  // рукой, реплика идёт в журнал (не чаще раза в 22–38 с, только
  // в море под ходом, пока капитан не гуляет по палубе)
  private captainOrderT = 14;
  private captainOrders = 0;
  private lastOrder = '';
  private readonly ORDER_QUOTES = [
    'Свистать всех наверх!',
    'Рулевой, держать курс!',
    'На вахте смотреть в оба!',
    'Порох держать сухим!',
    'Такелаж осмотреть после шторма!',
    'Глаза вострее — острова близко!',
    'Канониры, к орудиям!',
    'Полный вперёд, веселей!',
    'Свежий ветер — паруса в полный!',
    'Смотри за борт — рифы коварны!',
  ];
  private updateWeather(dt: number) {
    // полигон: чистое море, ровный слабый ветер — всегда
    const calm = this.proving;
    const vis = this.weather.update(dt, this.rig.camera.position, calm);
    this.weatherVis = vis;
    if (calm) {
      this.wind.speed += (4.2 - this.wind.speed) * Math.min(1, dt * 0.6);
      SEA.windSpeed = 4.2;
      SEA.windFrom = this.wind.from;
      this.seaAmpSmooth += (windFactor(4.2) - this.seaAmpSmooth) * Math.min(1, dt * 0.5);
      SEA.amp01 = this.seaAmpSmooth;
    } else {
      this.wind.speed = this.weather.wind.speed;
      this.wind.from = this.weather.wind.from;
      // ВЫСОТА ВОЛН ЗАВИСИТ ОТ СКОРОСТИ ВЕТРА (Task 33): амплитуда
      // гармоник = A0 · (0.10 + 0.90·(v/24)^1.25); 3 м/с — рябь,
      // 7.5 — свежий бриз, 15 — крепкий ветер, 24 — штормовые валы;
      // спектр бежит ПО ВЕТРУ (направление — из погоды), набор волны
      // с запаздыванием — как настоящее море
      SEA.windSpeed = this.wind.speed;
      SEA.windFrom = this.wind.from;
      const ampTarget = windFactor(this.wind.speed);
      this.seaAmpSmooth += (ampTarget - this.seaAmpSmooth) * Math.min(1, dt * 0.22);
      SEA.amp01 = this.seaAmpSmooth;
    }
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
    // Task 85: обычный режим — анти-спираль (dt ≤ 0.1); testWarp —
    // до 4 с реального времени на кадр (аккумулятор догонит физику)
    dt = this.testWarp > 0 ? Math.min(dt, 4) : Math.min(dt, 0.1);
    this.stepFrame(dt);
  };

  /** Полный кадр симуляции (физика + системы + рендер).
   *  Вызывается из RAF и напрямую из E2E (stepDebug): в headless-
   *  браузере кадры душатся до ~0.4 fps — тесты гоняют мир сами. */
  /** Task 51: КОЛЛИЗИИ С ПРИЧАЛАМИ И ЛОДКАМИ. Корабль больше не
   *  проходит сквозь пирс: нос/мидель/корма выталкиваются от
   *  ПРЯМОУГОЛЬНИКА пирса (ширина 7.2, длина dockLen) по ближайшей
   *  грани — вдоль пирса проходить МОЖНО, сквозь — нельзя; рыбацкие
   *  шлюпки сносит волной от корпуса — лодка лёгкая, сдвигаем её
   *  (дрейф продолжается с нового места) */
  private collideSmallCraft(): boolean {
    const p = this.player;
    if (p.sinking || p.sunk) return false;
    const T = THREE;
    const fwd = p.forward;
    let bumped = false;
    for (const port of this.world.ports) {
      const dockLen = [62, 86, 110, 124][port.tier];
      const a = port.dockEnd.clone().addScaledVector(port.dir, -(dockLen - 8));
      const b = port.dockEnd;
      const ex = (b.x - a.x) / dockLen, ez = (b.z - a.z) / dockLen;   // ось ВДОЛЬ
      const px2 = -ez, pz2 = ex;                                       // ось ПОПЕРЁК
      const halfDock = 3.6 + p.preset.beam * 0.55;
      const halfShip = p.preset.length * 0.42;
      for (const t of [0.42, 0, -0.42]) {
        const cx = p.position.x + fwd.x * p.preset.length * t - a.x;
        const cz = p.position.z + fwd.z * p.preset.length * t - a.z;
        const lx = cx * ex + cz * ez;        // вдоль пирса (0..dockLen)
        const ly = cx * px2 + cz * pz2;      // поперёк (0 = ось)
        if (lx < -halfShip || lx > dockLen + halfShip) continue;
        const penSide = halfDock - Math.abs(ly);
        if (penSide <= 0) continue;         // борт вне полосы — свободно
        const penFront = lx + halfShip;     // до носового торца полосы
        const penBack = (dockLen + halfShip) - lx;
        // минимальное проникновение — ту грань и выталкиваем
        let nx = 0, nz = 0, pen = penSide;
        if (penFront < pen) { pen = penFront; nx = -ex; nz = -ez; }
        else if (penBack < pen) { pen = penBack; nx = ex; nz = ez; }
        else { const sgn = ly >= 0 ? 1 : -1; nx = sgn * px2; nz = sgn * pz2; }
        p.pushAway(new T.Vector3(nx, 0, nz), 16, 0.9);
        bumped = true;
        if (p.speed() > 4 && Math.random() < 0.25) {
          p.applyDamage({ kind: 'ground', amount: 2 + p.speed() * 0.5 });
        }
      }
    }
    // --- ЛОДКИ: сносим шлюпку от корпуса (эллипс корабля в его осях) ---
    const invQ = p.quaternion.clone().invert();
    const pushBoat = (bx: number, bz: number, apply: (dx: number, dz: number) => void) => {
      const v = new T.Vector3(bx - p.position.x, 0, bz - p.position.z).applyQuaternion(invQ);
      const halfB = p.preset.beam * 0.55 + 1.6;
      const halfL = p.preset.length * 0.5 + 2.4;
      if (Math.abs(v.x) < halfB && Math.abs(v.z) < halfL) {
        const side = v.x >= 0 ? 1 : -1;
        const push = (halfB - Math.abs(v.x)) + 1.5;
        // мировая нормаль борта (перпендикуляр к ДП)
        const wx = side * fwd.z, wz = -side * fwd.x;
        apply(wx * push, wz * push);
        p.velocity.multiplyScalar(0.985);   // лодка не пробка, но мешает ходу
        bumped = true;
      }
    };
    for (const b of this.world.coastFleet.boats) {
      if (b.sinking || !b.mesh.visible) continue;
      if (Math.hypot(b.x - p.position.x, b.z - p.position.z) > 220) continue;
      pushBoat(b.x, b.z, (dx, dz) => {
        b.x += dx; b.z += dz;
        b.mesh.position.x = b.x; b.mesh.position.z = b.z;
        // дрейф продолжится с новой точки: пересчитать ang/rad
        b.ang = Math.atan2(b.z - b.cz, b.x - b.cx);
        b.rad = Math.hypot(b.x - b.cx, b.z - b.cz);
        b.mesh.rotation.y += 0.25 * Math.sign(dx * fwd.z - dz * fwd.x);
      });
    }
    for (const fv of this.world.fishing) {
      for (const b of fv.boats) {
        if (b.sinking || !b.mesh.visible) continue;
        if (Math.hypot(b.x - p.position.x, b.z - p.position.z) > 220) continue;
        pushBoat(b.x, b.z, (dx, dz) => {
          b.x += dx; b.z += dz;
          b.mesh.position.x = b.x; b.mesh.position.z = b.z;
        });
      }
    }
    return bumped;
  }

  stepFrame(dt: number) {
    this.handleInput(dt);

    // физика фиксированным шагом
    this.accum += dt;
    const STEP = 1 / 60;
    // Task 85 (e2e/отладка): «ускорение времени» — сколько шагов
    // физики разрешено на кадр. В песочнице SwiftShader душит fps
    // до ~1 (симуляция ползёт в 10%); testWarp>5 позволяет догнать
    // реальное время. 0/5 — обычный лимит (анти-спираль смерти)
    const maxSteps = this.testWarp > 0 ? this.testWarp : 5;
    let steps = 0;
    while (!this.paused && this.accum >= STEP && steps < maxSteps) {
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

    // Task 85: АБОРДАЖ. brawler-ИИ в упор сам лезет на борт игрока
    // (таранно-абордажная тактика); кулдаун guard от мгновенного
    // повторного нападения после отбоя
    if (!this.boarding && !this.docked && !this.player.sinking && !this.dead) {
      for (const ai of this.aiShips) {
        if (ai.state !== 'combat' || ai.tactic !== 'brawler' || ai.frozen) continue;
        if (ai.boardCd > 0 || ai.ship.sinking) continue;
        if (ai.ship.position.distanceTo(this.player.position) < 34
          && this.player.speedKnots() < 9) {
          this.startBoarding(ai, false);
          break;
        }
      }
    }
    // абордаж: тяга крючьев, сцепка, мостки, бой (после шагов
    // физики — позы кораблей уже посчитаны). dt = СИМ-время кадра:
    // при warp и медленном fps бой идёт в темпе физики, а не
    // каркасов рендера. Task 87: фаза ПОДХОДА удалена — тросы
    // тянут корабли напрямую, подшагового управления больше нет
    this.boarding?.update(steps * STEP, this.time);

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

    // зелёная вода СМЫЛА матроса за борт (Task 32/33): честная
    // механика — только когда палуба ДЕЙСТВИТЕЛЬНО под водой
    // (> 0.3 м над кромкой), с вероятностью из настроек (30%)
    if (this.player.washedCrew > this.lastWashedCrew) {
      this.pushMessage(`Волной смыло матроса за борт! (−${this.player.washedCrew - this.lastWashedCrew})`);
      this.lastWashedCrew = this.player.washedCrew;
      this.rig.addShake(0.2);
    }

    // телеметрия для отладки/E2E: window.__sea
    const dbg = window as unknown as { __sea: Record<string, unknown>; __seaPatchSettings?: (patch: Record<string, unknown>) => string; __seaDebrisInfo?: () => { alive: number; byKind: Record<string, number>; tints: Record<string, number>; tinted: number }; __flotsamInfo?: () => { alive: number; chests: number; sacks: number; gold: number; items: { kind: string; x: number; z: number }[] }; __chimneyInfo?: () => { pipes: number; near: number }; __fortInfo?: () => { found: boolean; parts: number; embrasures: number }; __crewModelInfo?: () => { setting: string; player: { detailed: boolean; figures: number; tris: number; detailJoints: number }; near: number; far: number }; __squadronInfo?: () => { total: number; ships: { model: string; leader: boolean; speed: number; pos: number[]; heading: number; state: string; hittable: boolean; tactic: string; mastsBroken: number }[] }; __aiInfo?: () => { model: string; state: string; tactic: string; crewEngage: boolean; anchored: boolean; mastsBroken: number; masts: number; speed: number; dist: number; hullFrac: number; sunk: boolean }[]; __crewRules?: () => { replacement: boolean; marksmen: boolean; emergenceDelay: number }; __undeadShips?: () => string[]; __spyglassInfo?: () => { on: boolean; fov: number; zoom: number; fx: { rt: boolean; w: number; h: number; uTime: number; uBlend: number; blend: number }; captain: { phase: string; inHand: boolean; ext: number; hand: string } | null; hud: boolean } };
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
    // ПАЛУБА (не борт/планширь): bulwark − 1.0 по мидель-шпангоуту —
    // «расчёты идут от палубы» (Task 32)
    const deckLocal = hullProfile(0.5, this.player.preset).bulwark - 1.0;
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
      freeboard, seaAmp: SEA.amp01, wind: this.wind.speed,
      envelope: +waveEnvelope().toFixed(2),          // огибающая волнения, м
      // «зелёная вода» (Task 25): сколько раз волна накрывала палубу
      greenWater: p.greenWater, greenWaterT: +p.greenWaterT.toFixed(1),
      washedCrew: p.washedCrew,          // смыто за борт зелёной водой (Task 32/33)
      deckRollLimDeg: +(p.deckRollLim() * 180 / Math.PI).toFixed(1),
      // Task 33: единое море — режим физики + настройки плавучести
      physics: {
        mode: PHYSICS.mode,
        simpleControls: CONTROLS.simple,
        washProbability: BUOYANCY_CONFIG.washProbability,
        washCooldown: BUOYANCY_CONFIG.washCooldown,
        draftOffset: this.settings.physics.buoyancy.draftOffset,
        draftOffApplied: +p.draftOff.toFixed(2),   // перекалибровка колонн (реалистичная)
        boatDraftMul: this.settings.physics.buoyancy.boatDraftMul,
        heelMaxDeg: this.settings.physics.buoyancy.heelMaxDeg,
        pitchMaxDeg: this.settings.physics.buoyancy.pitchMaxDeg,
        boatSmooth: this.settings.physics.buoyancy.boatSmooth,
        heelDeg: +(p.rideHeel * 180 / Math.PI).toFixed(1),   // крен от ветра (простая физика)
        boatDraft: this.boatLaunch && this.boatLaunch.phase === 'afloat'
          ? +(this.boatLaunch.state().draft ?? 0).toFixed(3) : -1,
        boats: this.boatLaunch
          ? { count: this.boatLaunch.boatCount(), active: this.boatLaunch.activeSide(), phase: this.boatLaunch.phase }
          : null,
        wireframe: { ...this.settings.graphics.wireframe },
      },
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
      // Task 43: РАЗРУШАЕМОСТЬ — телеметрия игрока и цели полигона
      damage: p.damageInfo(),
      crewArmed: p.crew3d.armedInfo(),
      crewCrouched: p.crew3d.crouchedCount(),
      crewSwimmers: p.crew3d.swimmersAlive(),
      // Task 45: подмена погибших — резерв экипажа (живые в трюме)
      crewReserves: p.crew3d.reservesInfo(),
      // Task 46: дощатая модель — состояние досок игрока и мишени
      plankInfo: p.plankHull ? p.plankHull.byState() : null,
      model: p.plankHull ? 'planks' : 'smooth',
      // Task 46: иерархия визуала игрока (имена групп + сегменты мачт)
      hullHier: {
        root: p.visual.group.name,
        groups: p.visual.group.children.map(c => c.name || c.type),
        plankMeshes: p.plankHull
          ? p.plankHull.group.children.map(m => `${m.name}:${(((m as THREE.Mesh).geometry?.attributes.position?.count ?? 0) / 3) | 0}`)
          : [],
        skeletonTris: p.visual.group.getObjectByName('Skeleton')
          ? (() => {
            let n = 0;
            p.visual.group.getObjectByName('Skeleton')!.traverse((o: THREE.Object3D) => {
              const geo = (o as THREE.Mesh).geometry;
              if (geo && geo.index) n += geo.index.count / 3;
              else if (geo) n += (geo.attributes.position?.count ?? 0) / 3;
            });
            return n | 0;
          })()
          : -1,
      },
      mastSegments: p.visual.masts[0]?.userData?.segments
        ? p.visual.masts.map((m: THREE.Object3D) =>
            (m.userData.segments as THREE.Object3D[] | undefined)?.filter(s => s.parent).length ?? 0)
        : null,
      // Task 46: счётчик попаданий ПО игроку (ответный огонь пиратов)
      playerHitCount: this.playerHitCount,
      // Task 46: пиратская эскадра — состояние ответного огня
      pirates: this.aiShips
        .filter(a => a.ship.flagKind === 'pirate')
        .slice(0, 9)
        .map(a => ({
          model: a.ship.preset.id,
          state: a.state,
          returnFire: a.returnFire,
          crewEngage: a.ship.crewEngage,
          dist: Math.round(a.ship.position.distanceTo(p.position)),
        })),
      tgtDamage: tgt ? tgt.damageInfo() : null,
      tgtArmed: tgt ? tgt.crew3d.armedInfo() : null,
      tgtCrouched: tgt ? tgt.crew3d.crouchedCount() : -1,
      tgtSwimmers: tgt ? tgt.crew3d.swimmersAlive() : -1,
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
      debris: debrisInfo(),
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
      crewIsCats: p.crew3d.isCats === true,
      // корабельные коты (e2e): сколько куплено/активно/поймано мышей
      cats: {
        bought: this.catCount,
        active: this.cats3d?.count ?? 0,
        caught: this.cats3d?.caught ?? 0,
        mice: this.cats3d?.mice ?? 0,
        names: this.catNames.slice(0, this.catCount),
        state: this.cats3d?.catState() ?? [],
      },
      deckFor: deckCrewFor(p.crew),          // сколько ДОЛЖНО быть на палубе
      rigSnapped: p.riggingSnapped(),         // обрывов такелажа (обвязка мачт)
      lairFolk: this.lairFolk
        ? { total: this.lairFolk.total, shown: this.lairFolk.shown, dead: this.lairFolk.dead }
        : null,
      treesBroken: this.world.treesBroken,
      // Task 36: ВЫСАДКА — состояние моряка на берегу
      land: this.lander
        ? (() => {
            const lh = this.lander!.hud();
            const plan = this.lander!.deckPlan;
            return {
              active: lh.active, mode: lh.mode, weapon: lh.weapon, aiming: lh.aiming,
              nearBoat: lh.nearBoat, nearWheel: lh.nearWheel, moving: lh.moving,
              x: +this.lander!.pos.x.toFixed(1), z: +this.lander!.pos.z.toFixed(1),
              h: +this.lander!.pos.y.toFixed(2),
              camYaw: +lh.camYaw.toFixed(2),
              frozenBoat: this.boatLaunch?.frozen ?? false,
              // Task 39: СКОЛЬКО гребцов видно в шлюпке (после
              // высадки — 1: место сошедшего игрока пусто)
              boatRowers: this.boatLaunch?.state().rowersVisibleCount ?? 0,
              // Task 40: прогулка по палубе — локальные координаты,
              // уровень (квартердек), пули в полёте, сабля (прямая)
              deck: lh.mode === 'deck'
                ? {
                    x: +this.lander!.pos.x.toFixed(2),
                    z: +this.lander!.pos.z.toFixed(2),
                    y: +this.lander!.pos.y.toFixed(2),
                    onQuarter: !!(plan?.hasQuarter && this.lander!.pos.z < plan.qFrontZ),
                    onStair: !!(plan && this.lander!.pos.z > plan.qFrontZ && this.lander!.pos.z < plan.stairZ0
                      && Math.abs(Math.abs(this.lander!.pos.x) - plan.stairX) < 0.46),
                    bullets: lh.bullets,
                  }
                : null,
              bullets: lh.bullets,
              saber: this.lander!.saberInfo(),
            };
          })()
        : null,
      // Task 40/41: капитан раздаёт указания (реплики в журнал)
      captain: { orders: this.captainOrders, last: this.lastOrder },
      // Task 41: настройки островов — деревья/деревни/жители/лодки
      islands: this.world.islandsInfo(),
      zones: this.world.terrain.zoneInfo(),
      // Task 39: СВОИ текстуры по ссылке — состояние всех слотов
      tex: textureUrls.describe(),
      // Task 39: фигурка капитана (попугай/повязка/детали) — E2E
      playerFig: this.lander ? this.lander.figureInfo() : null,
      // Task 36: рельеф-стример + деревни + рыбацкие лодки
      terrain: this.world.terrain.stats(),
      terrainTex: this.world.terrain.texturesOn(),
      villages: {
        total: VILLAGES.length,
        // Task 41: хижины/тропы — только АКТИВНЫЕ деревни (пул шире)
        active: VILLAGES.filter(v => v.active !== false).length,
        folk: this.world.villageFolk.reduce((s, f) => s + f.shown, 0),
        folkDead: this.world.villageFolk.reduce((s, f) => s + f.dead, 0),
        huts: VILLAGES.reduce((s, v) => s + (v.active === false ? 0 : v.huts), 0),
        trails: VILLAGES.reduce((s, v) => s + (v.active === false ? 0 : v.trail.length), 0),
      },
      coastFleet: {
        boats: this.world.coastFleet.boats.length,
        fishermen: this.world.coastFleet.fishermen,
        floating: this.world.coastFleet.boats.filter(b => !b.sinking).length,
      },
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
      // шлюпки на шлюпбалках (Task 22-24 + 31: ДВЕ — штирборт и порт,
      // спускается любая из целых)
      boats: (p.visual.boat || p.visual.boat2)
        ? {
            ok: true,
            count: this.boatLaunch ? this.boatLaunch.boatCount() : 0,
            active: this.boatLaunch ? this.boatLaunch.activeSide() : null,
            stb: p.visual.boat
              ? { visible: p.visual.boat.group.visible, x: +p.visual.boat.group.position.x.toFixed(1),
                  rotY: +p.visual.boat.group.rotation.y.toFixed(2), len: +p.visual.boat.len.toFixed(2) }
              : null,
            port: p.visual.boat2
              ? { visible: p.visual.boat2.group.visible, x: +p.visual.boat2.group.position.x.toFixed(1),
                  rotY: +p.visual.boat2.group.rotation.y.toFixed(2), len: +p.visual.boat2.len.toFixed(2) }
              : null,
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
      // острова неправильной формы: полигоны + метрики (E2E)
      islandsShape: this.world.islands.map((i, idx) => {
        const pts = this.world.outlines[idx] ?? [];
        let minR = Infinity, maxR = 0, per = 0;
        const rs = pts.map(p => Math.hypot(p.x - i.cx, p.z - i.cz));
        for (let k = 0; k < rs.length; k++) {
          minR = Math.min(minR, rs[k]); maxR = Math.max(maxR, rs[k]);
          const a = pts[k], b = pts[(k + 1) % pts.length];
          per += Math.hypot(a.x - b.x, a.z - b.z);
        }
        const meanR = rs.reduce((s, v) => s + v, 0) / Math.max(1, rs.length);
        return {
          name: i.name, ratio: +(maxR / Math.max(1, minR)).toFixed(2),
          rugosity: +(per / (2 * Math.PI * Math.max(1, meanR))).toFixed(2),
          minR: Math.round(minR), maxR: Math.round(maxR),
        };
      }),
      // мелководье у берега: ширина полосы h:0→−6 (не должно быть отмелей)
      shelf: (() => {
        const isl = this.world.islands[0];
        let worst = 0;
        for (let k = 0; k < 8; k++) {
          const th = (k / 8) * Math.PI * 2;
          const ux = Math.cos(th), uz = Math.sin(th);
          // где h=0.3 и где h=-6: разница — ширина мелководья
          let lo = 0, hi = isl.r * 2;
          for (let it = 0; it < 16; it++) {
            const mid = (lo + hi) / 2;
            if (heightAt(isl.cx + ux * mid, isl.cz + uz * mid) > 0.3) lo = mid; else hi = mid;
          }
          const rCoast = (lo + hi) / 2;
          lo = rCoast; hi = isl.r * 2;
          for (let it = 0; it < 16; it++) {
            const mid = (lo + hi) / 2;
            if (heightAt(isl.cx + ux * mid, isl.cz + uz * mid) > -6) lo = mid; else hi = mid;
          }
          worst = Math.max(worst, (lo + hi) / 2 - rCoast);
        }
        return Math.round(worst);
      })(),
      // GLB-замена деталей: статусы и счётчики инстансов
      glb: { use: this.settings.graphics.useGLBModels, parts: this.glbParts.info(), lastError: this.glbParts.lastError || null },
      // растительность: виды/инстансы/источник геометрии
      veg: this.world.vegStats(),
      // чайки: режимы полёта и дистанции (E2E «чайки в полёте»)
      gulls: (() => {
        let ship = 0, island = 0, nearShip = 0, maxBank = 0;
        const p = this.player.position;
        for (const g of this.world.gullsPublic()) {
          if (g.mode === 'ship') ship++; else island++;
          if (Math.hypot(g.x - p.x, g.z - p.z) < 90) nearShip++;
          maxBank = Math.max(maxBank, Math.abs(g.bank));
        }
        return { total: ship + island, ship, island, nearShip, maxBank: +maxBank.toFixed(2) };
      })(),
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
    // Task 46: точечная правка настроек из консоли/e2e (глубокий мердж
    // патча в текущие настройки + applySettings — как из панели)
    dbg.__seaPatchSettings = (patch: Record<string, unknown>) => {
      const deep = (base: unknown, over: unknown): unknown => {
        if (typeof base !== 'object' || base === null
          || typeof over !== 'object' || over === null || Array.isArray(over)) return over;
        const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
        const src = over as Record<string, unknown>;
        for (const k of Object.keys(src)) {
          out[k] = k in out ? deep(out[k], src[k]) : src[k];
        }
        return out;
      };
      this.applySettings(deep(this.settings, patch) as GameSettings);
      saveSettings(this.settings);
      return 'ok:' + JSON.stringify(patch);
    };
    // Task 46: СВЕЖИЕ данные обломков (телеметрия __sea.refreshes
    // только на рендер-кадрах; e2e зовёт эту функцию для точных
    // замеров сразу после синхронных мутаций). Task 49: + tints/tinted
    dbg.__seaDebrisInfo = () => debrisInfo();
    // Task 50: сборка процедурной фигурки для e2e/VLM (крупные планы
    // одежды/уборов — на реальном рендере, не по константам)
    {
      const w = window as unknown as { __buildFigure?: typeof buildFigure };
      w.__buildFigure ??= buildFigure;
    }
    // Task 51: лут на воде + трубы/форт (телеметрия e2e)
    dbg.__flotsamInfo = () => flotsamInfo();
    // Task 52: модель экипажа — кто на какой модели (e2e/VLM)
    // Task 56/57: эскадра — состав/кильватер (e2e)
    dbg.__squadronInfo = () => {
      const sqn = this.aiShips.filter(a => a.squadron && !a.ship.sunk);
      return {
        total: this.sqnSpawnedTotal,
        ships: sqn.map(a => ({
          model: a.ship.preset.id,
          leader: !!a.leader,
          speed: +a.ship.speed().toFixed(1),
          pos: [+(a.ship.position.x - this.player.position.x).toFixed(0),
                +(a.ship.position.z - this.player.position.z).toFixed(0)],
          heading: +a.ship.heading.toFixed(2),
          state: a.state,
          // Task 81: цель видна снарядам игрока (combat.others) —
          // раньше эскадра НЕ регистрировалась и была неуязвимой
          hittable: this.combat.others.includes(a.ship),
          tactic: a.tactic,
          mastsBroken: a.ship.mastsBroken,
        })),
      };
    };
    // Task 81: боевая логика ИИ — состояние/тактика/экипаж/мачты по
    // каждому судну (e2e: маневр под атакой, выход из боя, посты)
    dbg.__aiInfo = () => this.aiShips
      .filter(a => !a.ship.sunk)
      .map(a => ({
        model: a.ship.preset.id,
        state: a.state,
        tactic: a.tactic,
        crewEngage: a.ship.crewEngage,
        anchored: a.ship.anchored,
        mastsBroken: a.ship.mastsBroken,
        masts: a.ship.mastHP.length,
        speed: +a.ship.speed().toFixed(2),
        dist: +a.ship.position.distanceTo(this.player.position).toFixed(0),
        hullFrac: +(a.ship.hullHP / a.ship.hullMax).toFixed(2),
        sunk: a.ship.sunk,
      }));
    // Task 56: правила экипажа (задержка выхода подмены — e2e)
    dbg.__crewRules = () => ({ ...CREW_RULES });
    // Task 77: телеметрия ТРУБЫ — состояние капитана + пост-процесс
    dbg.__spyglassInfo = () => ({
      on: this.spyglassOn,
      fov: +this.rig.camera.fov.toFixed(2),
      zoom: +this.rig.spyZoom.toFixed(1),
      fx: this.spyFx.info(),
      captain: this.player.crew3d.captainInfo()?.spy ?? null,
      hud: this.hud.spyglass,
    });
    // Task 55/56: мертвецы — какие корабли прокляты (e2e/VLM)
    dbg.__undeadShips = () => this.aiShips
      .filter(a => !a.ship.sunk && a.ship.crewUndeadOpt)
      .map(a => a.ship.preset.id)
      .concat(this.player.crewUndeadOpt ? ['__player__'] : []);
    dbg.__crewModelInfo = () => {
      const one = (sh: Ship) => ({
        detailed: sh.crewDetailedOpt,
        figures: sh.crew3d.total,
        tris: sh.crew3d.group.children.length
          ? Math.round(sh.crew3d.group.children.reduce((a, g) => a + (g as THREE.Group).children!.length, 0))
          : 0,
        detailJoints: (() => {
          let n = 0;
          sh.crew3d.group.traverse(() => { n++; });
          return n;
        })(),
      });
      return {
        setting: this.settings.graphics.crewDetail,
        player: one(this.player),
        // Task 76: капитан на борту — ИГРОК (внешность со старта);
        // на «Чёрной жемчужине» его модель — МЕРТВЕЦ;
        // Task 80: проклятие — от ВЫБОРА «Жемчужины» кораблём игрока
        // (без попаданий): капитан-мертвец + светящийся клинок
        captain: this.player.crew3d.captainInfo(),
        captainCursed: this.player.preset.id === 'blackpearl',
        playerAppearance: { ...this.settings.player },
        // Task 81: РАЗБРОС ТЕЛОСЛОЖЕНИЙ экипажа игрока (kindStats.builds)
        crewBuilds: this.player.crew3d.kindStats.builds,
        near: this.aiShips.filter(a => !a.ship.sunk && a.ship.crewDetailedOpt).length,
        far: this.aiShips.filter(a => !a.ship.sunk && !a.ship.crewDetailedOpt).length,
      };
    };
    dbg.__chimneyInfo = () => ({
      pipes: this.world.chimneys.length,
      near: this.world.chimneys.filter(ch =>
        Math.hypot(ch.x - this.player.position.x, ch.z - this.player.position.z) < 1200).length,
    });
    dbg.__fortInfo = () => {
      let fort: THREE.Object3D | null = null;
      this.scene.traverse(o => { if (!fort && o.name === 'fort') fort = o; });
      const f = fort as THREE.Group | null;
      // амбразуры/ворота/флаг — считаем детей форта по материалам:
      // тёмные (бойницы/щели) и латунные полосы ворот
      let darks = 0, parts = 0;
      if (f) {
        f.traverse(o => {
          const m = o as THREE.Mesh;
          if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
          parts++;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat && mat.color && mat.color.getHex() === 0x1c1a18) darks++;
        });
      }
      return { found: !!f, parts, embrasures: darks };
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
      this.deadReason = 'sunk';
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
    this.boatLaunch?.update(dt, this.time, this.negShift);

    // ВЫСАДКА (Task 36): моряк на берегу — третье лицо, оружие
    this.lander?.update(dt, this.time, this.shift, (code) => this.input.isDown(code));

    // корабельные коты: бродят/бегают/ловят мышей (только игрок)
    this.cats3d?.update(dt, this.time, {
      sinking: this.player.sinking, sunk: this.player.sunk,
    });

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
    updateDebris(dt, this.time, this.wind, { x: this.player.position.x, z: this.player.position.z });
    this.world.update(this.time, dt, this.player.position, waterHeightAt);

    // Task 51: ДЫМ ИЗ ТРУБ — над ближними трубами хижин/таверн/домов
    // вятся редкие клубы (тёплые очаги); экономим частицы — спавн
    // раз в ~0.8 с на трубу и только ближе 1200 м
    {
      const pp = this.player.position;
      this.chimneyT -= dt;
      if (this.chimneyT <= 0) {
        this.chimneyT = 0.8;
        for (const ch of this.world.chimneys) {
          const d = Math.hypot(ch.x - pp.x, ch.z - pp.z);
          if (d > 1200) continue;
          const w = this.wind;
          this.particles.smoke(ch.x, ch.y, ch.z,
            -Math.cos(w.from) * 0.55 + (Math.random() - 0.5) * 0.3,
            1.05 + Math.random() * 0.4,
            -Math.sin(w.from) * 0.55 + (Math.random() - 0.5) * 0.3,
            1.5, 3.8 + Math.random() * 1.6);
        }
      }
    }

    // Task 51: ЛУТ ПОТОПЛЕННЫХ — судно ушло под воду: на месте
    // остаются сундук с деньгами и мешки с товарами (один раз).
    // Task 81: МАСШТАБ ПО РАЗМЕРУ СУДНА + случайный индекс — чем
    // больше корпус, тем богаче добыча (24 м — базовый множитель);
    // гарантия: сундук ≥60 золота и ≥2 мешка даже со шлюпа
    for (const a of this.aiShips) {
      const sh = a.ship;
      if (sh.sunk && !this.looted.has(sh)) {
        this.looted.add(sh);
        const sizeK = Math.max(0.75, sh.preset.length / 24);
        const rndK = 0.7 + Math.random() * 0.8;
        const gold = Math.round(Math.max(60, sh.gold * sizeK * rndK));
        const cargo: Record<string, number> = {};
        for (const [k, n] of Object.entries(sh.cargo)) {
          const v = Math.round(n * sizeK * rndK);
          if (v > 0) cargo[k] = v;
        }
        const bags = Math.min(6, Math.max(2, Math.round(2 * sizeK + Math.random() * 2)));
        spawnFlotsam(sh.position.x, sh.position.z, gold, cargo, 180, bags);
        this.pushMessage('Судно затонуло — на волнах остался груз!');
      }
    }
    updateFlotsam(dt, this.time, this.wind, this.player.position);
    // подбор: подойти вплотную (7 м) — сундук/мешок поднимают с борта
    if (!this.player.sinking && !this.player.sunk && !this.docked) {
      const got = pickFlotsam(this.player.position.x, this.player.position.z, 7);
      if (got.gold > 0 || Object.keys(got.cargo).length) {
        this.player.gold += got.gold;
        const parts: string[] = [];
        if (got.gold > 0) parts.push(`${got.gold} золотых`);
        for (const [k, n] of Object.entries(got.cargo)) {
          const have = this.player.cargo[k] ?? 0;
          const held = Object.values(this.player.cargo).reduce((a, b) => a + b, 0);
          const room = Math.max(0, this.player.holdCap - held + have);
          const take = Math.min(n, room);
          if (take > 0) {
            this.player.cargo[k] = have + take;
            parts.push(`${k} ×${take}`);
          }
        }
        this.pushMessage(`Подобрано с воды: ${parts.join(', ')}`);
      }
    }

    // Task 51: столкновения с причалами и лодками (после физики)
    if (this.collideSmallCraft() && this.player.speed() > 2.5 && Math.random() < dt * 2) {
      this.pushMessage('Корпус задел препятствие!');
    }

    // Task 52: LOD ЭКИПАЖА AI-КОРАБЛЕЙ (как у деревьев): ближние —
    // ДЕТАЛЬНЫЕ фигурки, дальние — классические. Порог — доля от
    // «детализации вблизи» (detailLod); гистерезис ±25%, проверка
    // раз в 0.8 с, пересборка ТОЛЬКО при смене зоны (без дёрганья)
    this.crewLodT -= dt;
    if (this.crewLodT <= 0) {
      this.crewLodT = 0.8;
      const near = this.settings.graphics.detailLod * 2.5;
      const gD = this.settings.graphics.crewDetail === 'detailed';
      for (const a of this.aiShips) {
        const sh = a.ship;
        if (sh.sunk || sh.sinking) continue;
        const d = Math.hypot(sh.position.x - this.player.position.x,
          sh.position.z - this.player.position.z);
        let zone = d < near ? 1 : 0;
        if (sh.crewDetailZone === 1 && d < near * 1.25) zone = 1;      // гистерезис
        else if (sh.crewDetailZone === 0 && d > near * 0.75) zone = 0;
        if (zone !== sh.crewDetailZone) {
          sh.crewDetailZone = zone;
          const want = gD && zone === 1;
          if (want !== sh.crewDetailedOpt) sh.rebuildCrew(false, want);
        }
      }
    }
    this.lairFolk?.update(dt, this.time, { x: this.player.position.x, z: this.player.position.z });
    // Task 56: редкая эскадра на горизонте + уборка ушедших
    this.updateSquadron(dt);

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
    if (this.boatLaunch && this.boatLaunch.phase === 'afloat' && !(this.lander?.active)) {
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
    // НА БЕРЕГУ: камеру ведёт Lander (третье лицо/прицел)
    if (!this.lander?.active) {
      this.rig.update(dt, {
        active: this.combat.aim.active,
        side: this.combat.aim.side,
        dir: aimDir ?? this._v2.set(1, 0, 0),
      }, shipInfo, {
        mouseDX: this.input.mouseDX, mouseDY: this.input.mouseDY,
        wheel: this.input.wheelDelta, rmb: this.input.rmb,
        arrowX: arrX, arrowY: arrY,
      });
    }

    // вода единого моря — сетки следуют за камерой/судном, волны
    // (uniform-амплитуды/направления) — за ветром из состояния SEA
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

    // Task 40: КАПИТАН РАЗДАЁТ УКАЗАНИЯ (машик рукой + реплика)
    this.captainOrderT -= dt;
    if (this.captainOrderT <= 0) {
      this.captainOrderT = 22 + Math.random() * 16;
      const crew3d = this.player.crew3d;
      if (this.started && !this.dead && !this.uiOpen && !this.lander?.active
        && !this.dockedPort && crew3d && crew3d.waveCaptain()) {
        this.lastOrder = this.ORDER_QUOTES[Math.floor(Math.random() * this.ORDER_QUOTES.length)];
        this.captainOrders++;
        this.pushMessage(`${crew3d.isCats ? 'Капитан (кот)' : 'Капитан'}: «${this.lastOrder}»`);
      }
    }

    this.updateHud();
    // Task 77: сглаживание blend ТРУБЫ — в СИМУЛЯЦИИ (e2e шагает
    // мир без рендера; blend/зерно должны жить и там)
    // Task 80: труба «как пистолет» (3, осмотр по ПКМ) — смотреть
    // сквозь стекло можно и ПЕШКОМ/НА ПАЛУБЕ, не только с корабля (T)
    {
      const want = (this.spyglassOn || this.lander?.spyAiming) ? 1 : 0;
      this.spyFx.blend += (want - this.spyFx.blend) * Math.min(1, dt * 4.5);
      if (!want && this.spyFx.blend < 0.001) this.spyFx.blend = 0;
      this.spyFx.tick(dt);
    }
    if (!this.debugNoRender) this.renderFrame();
    this.input.endFrame();
  }

  /** Task 77: кадр на экран — с ПОСТ-ПРОЦЕССОМ ТРУБЫ («взгляд
   *  сквозь стекло»: зерно/пыль/царапины/хроматика), пока она
   *  поднята; blend сглажен в stepFrame — вход/выход без рывка */
  private renderFrame() {
    if (this.spyFx.active) {
      this.spyFx.render(this.renderer, this.scene, this.rig.camera);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.rig.camera);
    }
  }

  /** E2E: не рендерить кадры внутри stepDebug (гнать только физику) */
  private debugNoRender = false;

  /** E2E (Task 39): проба процедурных фигурок — построить n
   *  «человечков» и вернуть статистику: доля с попугаем (ТЗ ~10%),
   *  среднее число вершин тела (локти/колени/детали). */
  debugFigureProbe(n: number) {
    let parrots = 0, pegs = 0, hooks = 0, verts = 0, maxVerts = 0, legVerts = 0, legN = 0;
    // Task 42: распределение гардероба (торс/крой штанов/головной убор)
    const torsoKinds: Record<string, number> = {};
    const pantsKinds: Record<string, number> = {};
    const hatKinds: Record<string, number> = {};
    let wristMounts = 0;
    const count = Math.max(1, Math.min(400, Math.round(n)));
    for (let i = 0; i < count; i++) {
      const traits = rollTraits(Math.random, 'walker');
      torsoKinds[traits.torso] = (torsoKinds[traits.torso] ?? 0) + 1;
      pantsKinds[traits.pantsKind] = (pantsKinds[traits.pantsKind] ?? 0) + 1;
      hatKinds[traits.headwear] = (hatKinds[traits.headwear] ?? 0) + 1;
      const fig = buildFigure('walker', traits, 1000 + i * 17);
      if (fig.wristMount) wristMounts++;
      if (fig.hasParrot) parrots++;
      if (fig.hasPeg) pegs++;
      if (fig.hasHook) hooks++;
      // Task 40: руки — ОТДЕЛЬНЫЕ меши: считаем вершины тела+рук
      let v = fig.verts ?? 0;
      // Task 52: у детальной модели руки — ГРУППЫ (треугольники
      // уже посчитаны в verts); geometry есть только у простой
      const armLM = fig.armL as THREE.Mesh | undefined;
      const armRM = fig.armR as THREE.Mesh | undefined;
      if (armLM?.geometry) v += (armLM.geometry.attributes.position as THREE.BufferAttribute).count;
      if (armRM?.geometry) v += (armRM.geometry.attributes.position as THREE.BufferAttribute).count;
      verts += v;
      maxVerts = Math.max(maxVerts, v);
      // ноги: бедро+КОЛЕНО+голень+ботинок — у новой модели ≥ 4 боксов
      const legLM = fig.legL as THREE.Mesh | undefined;
      if (legLM?.geometry) {
        legVerts += (legLM.geometry.attributes.position as THREE.BufferAttribute).count;
        legN++;
      }
      fig.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    return {
      n: count, parrots, parrotPct: +(parrots / count * 100).toFixed(1),
      pegs, hooks, avgVerts: Math.round(verts / count), maxVerts,
      avgLegVerts: legN ? Math.round(legVerts / legN) : 0,
      // Task 42: гардероб — какие виды встретились + маунт у кисти
      torsoKinds, pantsKinds, hatKinds, wristMounts,
    };
  }

  /** Task 40 E2E: форсировать «указание капитана» (мах рукой + реплика
   *  в журнал) — не ждать таймера 22–38 с */
  debugCaptainOrder(): boolean {
    const c = this.player.crew3d;
    if (!c || !c.waveCaptain()) return false;
    this.lastOrder = this.ORDER_QUOTES[Math.floor(Math.random() * this.ORDER_QUOTES.length)];
    this.captainOrders++;
    this.pushMessage(`Капитан: «${this.lastOrder}»`);
    return true;
  }

  /** Task 40 E2E: план палубы текущего корабля (высоты/трапы/границы) */
  debugDeckPlan() {
    const plan = deckPlan(this.player.preset);
    return {
      length: +plan.length.toFixed(1),
      hasQuarter: plan.hasQuarter,
      qHeight: +plan.qHeight.toFixed(2),
      qFrontZ: +plan.qFrontZ.toFixed(2),
      stairX: +plan.stairX.toFixed(2),
      stairZ0: +plan.stairZ0.toFixed(2),
      wheelZ: +plan.wheelZ.toFixed(2),
      // вертикальный профиль через трап: главная палуба → ступени → настил
      profile: Array.from({ length: 7 }, (_, i) => {
        const z = plan.stairZ0 + (plan.qFrontZ - plan.stairZ0) * (i / 6);
        return +plan.surfaceY(plan.stairX, z).toFixed(2);
      }),
      offStairY: +plan.surfaceY(plan.stairX + 1.2, (plan.stairZ0 + plan.qFrontZ) / 2).toFixed(2),
      obstacles: plan.obstacles.length,
    };
  }

  /** Task 82 отладка: «пипетка» — что видно в пикселе (px, py) окна?
   *  Луч из камеры, пересечения с кораблём игрока (только меши); для
   *  дощатых мешей — атрибуты доски hit-треугольника (aPlank/aPlankN),
   *  чтобы сверить данные шейдера древесины с точкой попадания. */
  debugPick(px: number, py: number, maxHits = 4) {
    const rc = new THREE.Raycaster();
    rc.params.Line.threshold = 0;
    rc.params.Points.threshold = 0;
    rc.setFromCamera(
      new THREE.Vector2((px / window.innerWidth) * 2 - 1, 1 - (py / window.innerHeight) * 2),
      this.rig.camera,
    );
    const grp = this.player.visual.group;
    const inv = grp.matrixWorld.clone().invert();
    const r3 = (v: THREE.Vector3) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
    return rc.intersectObject(grp, true)
      .filter(h => (h.object as THREE.Mesh).isMesh)
      .slice(0, maxHits)
      .map((h) => {
        const m = h.object as THREE.Mesh;
        const lp = h.point.clone().applyMatrix4(inv);
        const g = m.geometry as THREE.BufferGeometry;
        const aP = g?.attributes?.aPlank as THREE.BufferAttribute | undefined;
        let plank: unknown = null;
        if (aP && h.face) {
          const i = g.index ? g.index.getX(h.face.a) : h.face.a;
          const aN = g.attributes.aPlankN as THREE.BufferAttribute;
          const comp = (a: THREE.BufferAttribute) => [0, 1, 2, 3].map(k => +a.getComponent(i, k).toFixed(4));
          plank = { aPlank: comp(aP), aPlankN: comp(aN), tri: [h.face.a, h.face.b, h.face.c] };
        }
        return {
          name: m.name, cls: m.userData?.class, dist: +h.distance.toFixed(2), local: r3(lp),
          plank, mat: (m.material as THREE.Material)?.type,
        };
      });
  }

  /** Task 80 E2E/отладка: войти в режим ПРОГУЛКИ ПО ПАЛУБЕ (как V)
   *  или выйти — без клавиатуры (headless-пробы трубы/оружия) */
  debugDeckWalk(on: boolean) {
    if (on && this.lander && !this.lander.active) {
      const p = this.player;
      this.lander.enterDeck(deckPlan(p.preset), p.visual.group);
    } else if (!on && this.lander?.active) {
      this.lander.exitDeck();
      this.lander.restoreCamera();
      this.rig.snap();
    }
    return this.lander?.hud() ?? null;
  }

  /** E2E/отладка: прогнать симуляцию seconds секунд БЕЗ рендера
   *  (headless-браузер рендерит сложные сцены минутами) */
  stepDebugNR(seconds: number) {
    this.debugNoRender = true;
    let left = seconds;
    let guard = 0;
    try {
      while (left > 1e-6 && guard++ < 6000) {
        const dt = Math.min(left, 1 / 30);
        this.stepFrame(dt);
        left -= dt;
      }
    } finally {
      this.debugNoRender = false;
    }
  }

  /** E2E/отладка: прогнать симуляцию seconds секунд БЕЗ RAF
   *  (порциями по 1/30 с — внутри фиксированный шаг 1/60).
   *  Рендер пропускается, в конце — один свежий кадр (для скриншота). */
  stepDebug(seconds: number) {
    this.debugNoRender = true;
    let left = seconds;
    let guard = 0;
    try {
      while (left > 1e-6 && guard++ < 4000) {
        const dt = Math.min(left, 1 / 30);
        this.stepFrame(dt);
        left -= dt;
      }
    } finally {
      this.debugNoRender = false;
    }
    // Task 77: финальный кадр e2e — ЧЕРЕЗ ТРУБУ, если она поднята
    // (скриншот показывает эффект стекла)
    this.renderFrame();
  }

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
    // Task 40: капитан был на палубе — вернуть за штурвал
    if (this.lander?.mode === 'deck') {
      this.lander.exitDeck();
      this.lander.restoreCamera();
      this.rig.snap();
    }
    const p = this.player;
    // Task 48: полный сброс повреждений ОДНИМ вызовом — раньше respawn
    // чистил корпус/мачты вручную и ЗАБЫВАЛ отсеки трюма (течь жила
    // дольше корабля: возрождённый корабль снова набирал воду и тонул
    // вторично) и дощатую обшивку (дыры оставались на новом корпусе)
    p.clearDamage();
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
    this.deadReason = null;
    this.pushMessage(`Новый корабль у гавани. Половина золота ушла на дно...`);
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize(window.innerWidth / window.innerHeight);
    // Task 77: буфер ТРУБЫ следует за канвасом
    {
      const size = new THREE.Vector2();
      this.renderer.getDrawingBufferSize(size);
      this.spyFx.resize(size.x, size.y, this.renderer.capabilities.isWebGL2 === true);
    }
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
    this.spyFx.dispose();            // Task 77: буфер трубы
    this.renderer.dispose();
    this.bus.clear();
  }

  setCameraMode(mode: CameraMode) { this.rig.mode = mode; }
}
