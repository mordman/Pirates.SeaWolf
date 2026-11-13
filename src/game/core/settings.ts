// ============================================================
// Настройки игры: графика (дальность прорисовки, детализация
// воды, тени, pixel ratio, качество пены), управление
// (переназначение клавиш), звук. Сохранение в localStorage.
// ============================================================

import type { TextureSlotId } from '../assets/textures';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

// ============================================================
// РЕСУРСЫ (Task 37): текстуры рельефа островов (3 режима —
// выкл / процедурное зерно / PBR-карты) + шейдер рельефа.
// PBR: альбедо × цвет вершин (биом) + карта нормалей + карта
// шероховатости; Lambert/Phong — упрощённые шейдеры (без PBR-карт).
// ============================================================
export type IslandTextureMode = 'off' | 'grain' | 'pbr' | 'url' | 'zones';
export type TerrainShaderKind = 'standard' | 'physical' | 'lambert' | 'phong';

export const ISLAND_TEXTURE_MODE_LABELS: Record<IslandTextureMode, string> = {
  off: 'Выкл (ровный цвет вершин)',
  grain: 'Зерно (процедурная детализация)',
  pbr: 'PBR (текстуры + нормали + шероховатость)',
  url: 'Своя текстура (ссылка)',
  zones: 'Зоны: песок/трава/грязь/скалы (свои текстуры)',
};

export const TERRAIN_SHADER_LABELS: Record<TerrainShaderKind, string> = {
  standard: 'Standard (PBR, сбалансированный)',
  physical: 'Physical (PBR, продвинутый: клиркоут/блик)',
  lambert: 'Lambert (быстрый, без бликов)',
  phong: 'Phong (дешёвый блик)',
};

export interface AssetsSettings {
  islandTextures: IslandTextureMode; // режим текстурирования рельефа
  texScale: number;        // м: размер повторения текстуры на местности (3..30)
  terrainShader: TerrainShaderKind; // шейдер рельефа островов
  roughness: number;       // 0..1 — шероховатость PBR-материала рельефа
  metalness: number;       // 0..1 — металличность (камень ~0)
  normalStrength: number;  // 0..2 — сила карты нормалей (только PBR)
  texUrl: string;          // УСТАРЕЛО (v11): ссылка на текстуру рельефа — переехала в texUrls.terrain
  /** Task 39 (v12): СВОИ текстуры по ссылке для ВСЕХ поверхностей.
   *  Каталог слотов — src/game/assets/textures.ts (TEXTURE_SLOTS):
   *  земля/борт/палуба/парус/вода. Пустая строка — процедурная. */
  texUrls: Record<TextureSlotId, string>;
}

// ============================================================
// ВНЕШНОСТЬ ИГРОКА (Task 39): экран создания капитана в начале
// игры — одежда, головной убор, борода, повязка на глаз,
// попугай на плече, деревянная нога, крюк. Палитры — ЕДИНЫЙ
// источник для фигурки игрока (lander) и процедурных
// «человечков» (crew.ts): массивы цветов лежат здесь, в
// настройках (чистые данные, без three.js).
// Task 42: ГАРДЕРОБ расширения — головные уборы (7 видов), торс
// (8 видов: рубаха/тельняшка/вертикальные полосы/футболка/свитер/
// жилет/камзол/голый торс) и штаны (длинные/шорты/рваные шорты).
// ============================================================
export type HeadwearKind = 'none' | 'bandana' | 'hat' | 'wide' | 'straw' | 'cap' | 'top';
export type TorsoKind = 'shirt' | 'striped' | 'stripedV' | 'tshirt' | 'sweater' | 'vest' | 'coat' | 'bare';
export type PantsKind = 'long' | 'shorts' | 'torn';

export const APPEARANCE_SKIN = [0xd9a184, 0xc98d68, 0xb3765a, 0xa06a4f, 0x8a5a42, 0xe0b294] as const;
export const APPEARANCE_SHIRT = [0xcbb8a0, 0x8f3b34, 0x35526b, 0x5b6e46, 0x7a5f8a, 0xa8763e, 0x3d4a5c] as const;
export const APPEARANCE_PANTS = [0x4a3a2a, 0x33404a, 0x5a4a38, 0x2c2c30, 0x614b33] as const;
export const APPEARANCE_BANDANA = [0xa3362c, 0x2f5e8a, 0x3c6b3f, 0x8a6a2a, 0x55355f] as const;

export const HEADWEAR_LABELS: Record<HeadwearKind, string> = {
  none: 'Без убора', bandana: 'Бандана', hat: 'Треуголка',
  wide: 'Широкополая', straw: 'Соломенная', cap: 'Вязаная шапка', top: 'Цилиндр',
};
export const TORSO_LABELS: Record<TorsoKind, string> = {
  shirt: 'Рубаха', striped: 'Тельняшка', stripedV: 'Полосы (вертик.)',
  tshirt: 'Футболка', sweater: 'Свитер', vest: 'Жилет', coat: 'Камзол', bare: 'Голый торс',
};
export const PANTS_LABELS: Record<PantsKind, string> = {
  long: 'Длинные', shorts: 'Шорты', torn: 'Рваные шорты',
};
export const BEARD_LABELS: Record<0 | 1 | 2, string> = {
  0: 'Чисто выбрит', 1: 'Короткая борода', 2: 'Длинная борода',
};

export interface PlayerAppearance {
  skin: number;             // тон кожи (APPEARANCE_SKIN)
  shirt: number;            // рубаха (APPEARANCE_SHIRT)
  pants: number;            // штаны (APPEARANCE_PANTS)
  headwear: HeadwearKind;   // головной убор (7 видов)
  torso: TorsoKind;         // одежда торса (8 видов, Task 42)
  pantsKind: PantsKind;     // крой штанов (3 вида, Task 42)
  beard: 0 | 1 | 2;         // борода: нет/короткая/длинная
  eyePatch: boolean;        // повязка на глаз
  parrot: boolean;          // попугай на плече
  pegLeg: boolean;          // деревянная нога (правая)
  hook: boolean;            // крюк вместо правой кисти
}

export const DEFAULT_APPEARANCE: PlayerAppearance = {
  skin: 0xc98d68, shirt: 0x8f3b34, pants: 0x33404a,
  headwear: 'bandana', torso: 'shirt', pantsKind: 'long', beard: 1, eyePatch: false,
  parrot: true, pegLeg: false, hook: false,
};

export const HEADWEAR_KINDS: readonly HeadwearKind[] = ['none', 'bandana', 'hat', 'wide', 'straw', 'cap', 'top'];
export const TORSO_KINDS: readonly TorsoKind[] = ['shirt', 'striped', 'stripedV', 'tshirt', 'sweater', 'vest', 'coat', 'bare'];
export const PANTS_KINDS: readonly PantsKind[] = ['long', 'shorts', 'torn'];

// ============================================================
// Погода: режим явлений + ветер. ОТ ВЕТРА ЗАВИСЯТ ВОЛНЫ —
// высота волн прямо следует силе ветра (единое море Task 33).
// ============================================================
export type WeatherMode = 'clear' | 'rain' | 'storm' | 'fog';

/** Режим физики корабля (Task 33/34): обе модели — корабль ПЛЫВЁТ
 *  ПО ПОВЕРХНОСТИ волн (не проваливается внутрь вала);
 *  «реалистичная» — крен/дифферент от честных моментов (ветер,
 *  поворот, затопление, склон волны), «простая» — кинематическая
 *  рамка по 5 точкам замера */
export type PhysicsMode = 'realistic' | 'simple';

export const PHYSICS_MODE_LABELS: Record<PhysicsMode, string> = {
  realistic: 'Реалистичная (крен/дифферент от моментов — корабль идёт по волне)',
  simple: 'Простая (корабль скользит по поверхности волн)',
};

/** Плавучесть и посадка — НАСТРОЙКИ ПО НОВОЙ (Task 33): только
 *  общие для обеих физик величины + механика смыва матросов
 *  (залитие палубы может смыть моряка с вероятностью 30%) */
export interface BuoyancySettings {
  heelMaxDeg: number;        // 6..35° — предел статического крена
  pitchMaxDeg: number;       // 8..35° — предел дифферента
  draftOffset: number;       // −0.8..0.8 м — осадка глубже(+)/мельче(−)
  boatDraftMul: number;      // 0.5..3× — осадка шлюпки
  boatSmooth: number;        // 6..25 1/с — плавность посадки шлюпки
  washProbabilityPct: number; // 0..100% — вероятность смыва матроса при залитии палубы
  washCooldownS: number;     // 2..25 с — пауза между бросками на смыв
}

export interface WeatherSettings {
  mode: WeatherMode;   // ясно / дождь / гроза / туман
  windSpeed: number;   // 0..24 м/с — сила ветра (задаёт и волнение)
  windDir: number;     // 0..355° — направление ОТКУДА дует (компас)
}

export interface FxSettings {
  smokeVisible: boolean;      // видимость дыма (и огня выстрелов)
  smokeSize: number;          // 0.3..2.5× — размер клубов
  smokeDensity: number;       // 0..2× — количество клубов
  smokeTransparency: number;  // 0..0.95 — прозрачность (выше = прозрачнее)
}

/** Каркас (показывать только треугольники без текстур) —
 *  ОТДЕЛЬНО для разных категорий объектов (Task 33) */
export interface WireframeSettings {
  water: boolean;        // поверхность воды
  ships: boolean;        // корпуса/паруса/экипаж всех судов
  islands: boolean;      // острова, постройки, причалы, животные
  vegetation: boolean;   // деревья/кусты/валуны (инстансинг)
}

export interface GraphicsSettings {
  preset: QualityPreset;
  drawDistance: number;   // м: радиус дальней воды/видимости (2400..8000)
  waterDetail: number;    // сегментов детальной сетки воды по стороне (64..208)
  waterChunkSize: number; // м: сторона детального «чанка» воды вокруг корабля (300..2000)
  waterLodStep: number;   // плотность дальних LOD-колец: 0 плавные (ячейка x2), 1 баланс (x4), 2 экономно (x8)
  shadows: boolean;
  shadowRes: number;      // 512 | 1024 | 2048
  pixelRatio: number;     // ограничение devicePixelRatio (1..2)
  detailLod: number;      // м: дальность показа мелких деталей кораблей (100..420)
  useGLBModels: boolean;  // GLB-модели вместо процедурных деталей (фолбэк — процедурные)
  wireframe: WireframeSettings; // режим «треугольники без текстур» по категориям
  // ТЕКСТУРЫ/ШЕЙДЕРЫ РЕЛЬЕФА ПЕРЕЕХАЛИ в раздел assets (вкладка «Ресурсы», Task 37)
}

export interface ControlsSettings {
  sailsUp: string;        // поднять паруса
  sailsDown: string;      // убрать паруса / задний ход
  steerLeft: string;
  steerRight: string;
  invertRudder: boolean;  // инверсия A/D (для тех, кто привык наоборот)
  anchor: string;
  camera: string;
  aimPort: string;        // прицел левый борт
  aimStarboard: string;   // прицел правый борт / действие
  fire: string;           // залп
  repair: string;
  map: string;
  help: string;
  oars: string;           // вёсла: вывалить/убрать (гребные суда)
  gunports: string;       // пушечные порты: открыть/закрыть (батареи)
  boat: string;           // шлюпка: спустить на воду / поднять на борт
  deckWalk: string;       // Task 40: прогуляться по палубе (капитан)
  ammo: [string, string, string, string];
}

export interface AudioSettings {
  volume: number;         // 0..1
}

export interface GameplaySettings {
  provingDistance: number;  // м: дистанция до мишени на полигоне (50..400)
  startingAmmo: { ball: number; chain: number; grape: number; fire: number }; // стартовый боезапас
  hullDurability: number;   // множитель прочности всех кораблей (0.5..3)
  infiniteAmmo: boolean;    // не расходовать боеприпасы (чит)
  ammoJitter: boolean;      // случайная недостача боезапаса при выходе в море (1–10% на тип)
  startMoney: number;       // стартовое золото игрока (0..100000, применяется сразу)
  boatCount: number;        // 0..2 — СКОЛЬКО ШЛЮПОК на борту (штирборт/порт)
  simpleControls: boolean;  // УПРОЩЁННОЕ УПРАВЛЕНИЕ: руль на любой скорости, паруса тянут при любом курсе
  catsInsteadOfCrew: boolean; // ЗАМЕНИТЬ ВСЕХ МАТРОСОВ НА КОТОВ: экипаж на палубе игрока — коты
  /** Task 46: модель корпуса — дощатая (разрушаемые доски, 4 стадии,
   *  скелет в проломах) или обычная (гладкая обшивка, декали-пробоины) */
  hullModel: 'planks' | 'smooth';
  /** Task 46: поднимать замену погибшим из трюма (пока есть живые) */
  crewReplacement: boolean;
  /** Task 46: стрелковый огонь экипажа (ружья/пистолеты у борта) */
  crewMarksmen: boolean;
}

// ============================================================
// ОСТРОВА (Task 41): сколько чего генерится в мире — деревья и
// кусты, деревни, жители, рыбацкие лодки. ГЛОБАЛЬНЫЕ множители
// + ПЕРЕОПРЕДЕЛЕНИЯ по каждому острову (вкладка «Острова»).
// Деревья перестраиваются на лету (с общим бюджетом инстансов —
// иначе ×1000 убивает GPU); деревни/жители/лодки — пересборка
// (может подлагнуть, постпроизводительности — секунды).
// ============================================================
export interface IslandOverrides {
  treesMul?: number;    // 0.25..1000 — деревья/кусты (undefined = глобально)
  villagesMul?: number; // 0..3 — деревни (0 — без деревень)
  folkMul?: number;     // 0..5 — жители деревень
  boatsMul?: number;    // 0..5 — рыбацкие лодки
}

export interface IslandsSettings {
  treesMul: number;       // деревья и кусты (глобально)
  villagesMul: number;    // деревни (глобально)
  folkMul: number;        // жители деревень (глобально)
  boatsMul: number;       // рыбацкие лодки (глобально)
  /** переопределения по индексу острова (ключ — String(idx)) */
  perIsland: Record<string, IslandOverrides>;
}

export const TREE_MUL_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 125, 250, 500, 1000] as const;
export const SMALL_MUL_STEPS = [0, 0.5, 1, 2, 3, 5] as const;

export const MUL_LABELS: Record<string, (v: number) => string> = {
  trees: v => v === 0.25 ? '×0.25 — редкие кусты'
    : v === 0.5 ? '×0.5 — редкий лес'
    : v === 1 ? '×1 — обычный'
    : v === 1000 ? '×1000 — ДЖУНГЛИ (бюджет ~1,5 млн)'
    : `×${v}`,
};

// ============================================================
// КОРАБЛИ (Task 47): прочность досок обшивки, урон ядер и
// живучесть КАЖДОГО корабля по отдельности (по id пресета).
// Всё применяется НА ЛЕТУ.
// ============================================================
export interface ShipsSettings {
  /** прочность досок обшивки (×0.25..×4): >1 — доски держат больше
 *  попаданий, <1 — хрупкие; влияет на все корабли в дощатом режиме */
  plankStrength: number;
  /** урон ядер (×0.25..×4): сила попаданий снарядов по корпусу
 *  (доски, HP корпуса, срыв деталей) и мачтам */
  ballDamage: number;
  /** живучесть по каждому кораблю: id пресета → множитель ×0.25..×4
 *  (корпус/паруса/мачты этого судна; 1/отсутствует — норма) */
  durability: Record<string, number>;
}

export interface GameSettings {
  graphics: GraphicsSettings;
  controls: ControlsSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
  weather: WeatherSettings;
  fx: FxSettings;
  physics: PhysicsSettings;   // режим физики + плавучесть (Task 33)
  assets: AssetsSettings;     // текстуры/шейдеры рельефа + модели (Task 37)
  player: PlayerAppearance;   // внешность капитана (Task 39)
  islands: IslandsSettings;   // мир: деревья/деревни/жители/лодки (Task 41)
  ships: ShipsSettings;       // корабли: доски/ядра/живучесть (Task 47)
}

/** Физика корабля и плавучесть (Task 33) */
export interface PhysicsSettings {
  mode: PhysicsMode;        // реалистичная / простая
  buoyancy: BuoyancySettings; // посадка/углы/смыв матросов
}

export const QUALITY_PRESETS: Record<QualityPreset, Omit<GraphicsSettings, 'preset' | 'wireframe'>> = {
  low:    { drawDistance: 2600, waterDetail: 96,  waterChunkSize: 800,  waterLodStep: 2, shadows: false, shadowRes: 1024, pixelRatio: 1.0,  detailLod: 150, useGLBModels: true },
  medium: { drawDistance: 4000, waterDetail: 128, waterChunkSize: 900,  waterLodStep: 1, shadows: true,  shadowRes: 1024, pixelRatio: 1.25, detailLod: 210, useGLBModels: true },
  high:   { drawDistance: 5600, waterDetail: 176, waterChunkSize: 900,  waterLodStep: 0, shadows: true,  shadowRes: 2048, pixelRatio: 1.5,  detailLod: 270, useGLBModels: true },
  ultra:  { drawDistance: 7800, waterDetail: 208, waterChunkSize: 1100, waterLodStep: 0, shadows: true,  shadowRes: 2048, pixelRatio: 2.0,  detailLod: 340, useGLBModels: true },
};

export const DEFAULT_WIREFRAME: WireframeSettings = { water: false, ships: false, islands: false, vegetation: false };

export const DEFAULT_ASSETS: AssetsSettings = {
  islandTextures: 'grain',   // зерно по умолчанию (быстро, детализирует рельеф)
  texScale: 7,               // м на повтор — выверенный масштаб зерна
  terrainShader: 'standard', // MeshStandardMaterial — базовый PBR
  roughness: 0.96,           // матовая земля/песок/камень
  metalness: 0,
  normalStrength: 1,         // нормали PBR-режима в полную силу
  texUrl: '',                // УСТАРЕЛО (v11→v12): теперь texUrls.terrain
  texUrls: { terrain: '', hull: '', deck: '', sail: '', water: '', sand: '', grass: '', dirt: '', rock: '' },
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: { preset: 'high', ...QUALITY_PRESETS.high, wireframe: { ...DEFAULT_WIREFRAME } },
  controls: {
    sailsUp: 'KeyW',
    sailsDown: 'KeyS',
    steerLeft: 'KeyA',
    steerRight: 'KeyD',
    invertRudder: false,
    anchor: 'KeyF',
    camera: 'KeyC',
    aimPort: 'KeyQ',
    aimStarboard: 'KeyE',
    fire: 'Space',
    repair: 'KeyR',
    map: 'Tab',
    help: 'KeyH',
    oars: 'KeyO',
    gunports: 'KeyP',
    boat: 'KeyB',
    deckWalk: 'KeyV',
    ammo: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  },
  audio: { volume: 0.55 },
  gameplay: {
    provingDistance: 90,
    // реалистичный боевой комплект шлюпа: ~40 ядер на ствол не возили —
    // запас считали на 2–3 жарких боя, остальное — трофеи
    startingAmmo: { ball: 40, chain: 12, grape: 20, fire: 8 },
    hullDurability: 1,
    infiniteAmmo: false,
    ammoJitter: true,
    startMoney: 350,
    boatCount: 2,        // шлюпки на обоих бортах (настройка)
    simpleControls: false,
    catsInsteadOfCrew: false,   // экипаж — матросы; коты покупаются в порту
    // Task 46: модель/правила — дощатая обшивка по умолчанию
    // («убери странные круги — корабль из досок»)
    hullModel: 'planks',
    crewReplacement: true,     // погибшие подменяются живыми из трюма
    crewMarksmen: true,        // ружья/пистолеты у борта
  },
  islands: {
    treesMul: 1,      // обычный лес
    villagesMul: 1,   // штатное число деревень
    folkMul: 1,       // штатное число жителей
    boatsMul: 1,      // штатное число рыбацких лодок
    perIsland: {},    // переопределений нет — все как глобально
  },
  ships: {
    plankStrength: 1,   // доски — норма (3 прямых ядра = пролом)
    ballDamage: 1,      // ядра — историческая сила
    durability: {},     // у каждого корабля — норма (×1)
  },
  weather: { mode: 'clear', windSpeed: 7.5, windDir: 40 },
  fx: { smokeVisible: true, smokeSize: 1, smokeDensity: 1, smokeTransparency: 0.45 },
  physics: {
    mode: 'realistic',
    buoyancy: {
      // дефолты = выверенные значения прежних моделей;
      // вероятность смыва матроса — 30% по ТЗ
      heelMaxDeg: 20.6, pitchMaxDeg: 24.1,
      draftOffset: 0, boatDraftMul: 1, boatSmooth: 13,
      washProbabilityPct: 30, washCooldownS: 8,
    },
  },
  assets: { ...DEFAULT_ASSETS, texUrls: { ...DEFAULT_ASSETS.texUrls } },
  player: { ...DEFAULT_APPEARANCE },
};

/** Рекомендуемые параметры погоды по режиму (кнопка режима подтягивает ветер) */
export const WEATHER_PRESETS: Record<WeatherMode, { windSpeed: number; label: string }> = {
  clear: { windSpeed: 7, label: 'Ясно' },
  rain: { windSpeed: 10, label: 'Дождь' },
  storm: { windSpeed: 19, label: 'Гроза' },
  fog: { windSpeed: 3, label: 'Туман' },
};

const STORAGE_KEY = 'seawolves.settings.v1';
// Версия схемы сохранения: при изменении — что делать со старыми данными.
// v3: высота волн больше НЕ настраивается — только сила ветра;
//     стартовый боезапас реалистичный 40/12/20/8.
// v4 (Task 29): разделы sea/buoyancy + модель моря 'storm'.
// v5 (Task 31): плавание/посадка/углы для всех моделей моря.
// v6 (Task 33): ЕДИНОЕ МОРЕ (Герстнер + FBM) — модели моря и
//     штормовой модуль УДАЛЕНЫ: разделы sea/buoyancy и
//     weather.seaModel больше не читаются. Новые разделы:
//     physics (режим реалистичная/простая + НОВАЯ плавучесть:
//     осадка/углы/шлюпка + вероятность смыва матросов 30%),
//     gameplay.boatCount (количество шлюпок 0..2),
//     gameplay.simpleControls (упрощённое управление),
//     graphics.wireframe (треугольники без текстур по категориям).
//     Старые сохранения v5 и ниже: боезапас сбрасывается только если
//     версия < 3; прочие старые поля игнорируются, новые — дефолты.
// v7 (Task 34): ПЕНА НА ВОЛНАХ УДАЛЕНА (открытое море — чистая
//     вода, белое — только прибой у островов): настройка
//     graphics.foamQuality больше не существует и игнорируется.
//     Обе физики плывут ПО поверхности волн.
// v8 (Task 35): КОТЫ — gameplay.catsInsteadOfCrew: заменить всех
//     матросов на котов (экипаж на палубе игрока); корабельные
//     коты покупаются в порту (до 5) — состояние игры, не настроек.
// v9 (Task 36): ОСТРОВА — graphics.islandTextures: процедурное
//     текстурирование рельефа. Мир и острова ×10 по площади.
// v10 (Task 37): РЕСУРСЫ — новый раздел assets: islandTextures
//     теперь РЕЖИМ ('off'|'grain'|'pbr', было boolean в graphics),
//     texScale/terrainShader/roughness/metalness/normalStrength.
//     Миграция: graphics.islandTextures=true → 'grain', false → 'off'.
//     Все процедурные объекты — в каталоге GLB с габаритами.
// v11 (Task 38): режим 'url' — СВОЯ текстура рельефа по ссылке
//     (assets.texUrl): png/jpg/webp/http(s)/data:, укладывается
//     плиткой поверх цвета вершин; пока грузится/ошибка — зерно.
// v12 (Task 39): ВСЕ текстуры по ссылкам — assets.texUrls
//     (terrain/hull/deck/sail/water, каталог в assets/textures.ts);
//     texUrl (v11) мигрирует в texUrls.terrain. Новый раздел
//     player — внешность капитана (экран создания персонажа).
// v13 (Task 40): режим 'zones' — СВОИ текстуры ЗОН островов
//     (песок/трава/грязь/скалы: слоты sand/grass/dirt/rock
//     накладываются по высоте/уклону поверх цвета вершин);
//     controls.deckWalk — прогулка капитана по палубе (V);
//     gameplay.vegDensity — плотность леса на островах (×0.25..8).
// v14 (Task 41): НОВЫЙ раздел islands — деревья (до ×1000),
//     деревни, жители, рыбацкие лодки: глобальные множители +
//     переопределения ПО КАЖДОМУ острову (вкладка «Острова»).
//     gameplay.vegDensity (v13) мигрирует в islands.treesMul.
// v15 (Task 42): гардероб капитана — headwear расширен до 7
//     видов (+широкополая/соломенная/вязаная/цилиндр), новые
//     player.torso (8 видов одежды торса) и player.pantsKind
//     (длинные/шорты/рваные шорты); старые записи читаются с
//     дефолтами torso='shirt', pantsKind='long'.
// v16 (Task 46): модель корпуса + правила экипажа — gameplay:
//     hullModel 'planks'|'smooth' (дощатая обшивка из досок с 4
//     стадиями разрушения / обычная гладкая с декалями),
//     crewReplacement (подмена погибших из трюма),
//     crewMarksmen (стрелковый огонь). Старые сохранения — дефолты
//     'planks'/true/true.
// v17 (Task 47): НОВЫЙ раздел ships — прочность досок обшивки
//     (plankStrength ×0.25..4), урон ядер (ballDamage ×0.25..4),
//     живучесть КАЖДОГО корабля по отдельности (durability:
//     id пресета → множитель; отсутствующие — ×1). Старые
//     сохранения — дефолты 1/1/{}.
const SCHEMA_VER = 17;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** Загрузка с защитой от битых/частичных данных */
export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const data = JSON.parse(raw) as unknown;
    if (!isObj(data)) return structuredClone(DEFAULT_SETTINGS);
    const s = structuredClone(DEFAULT_SETTINGS);
    if (isObj(data.graphics)) {
      const g = data.graphics;
      if (typeof g.preset === 'string' && g.preset in QUALITY_PRESETS) s.graphics.preset = g.preset as QualityPreset;
      if (typeof g.drawDistance === 'number') s.graphics.drawDistance = Math.min(8000, Math.max(2000, g.drawDistance));
      if (typeof g.waterDetail === 'number') s.graphics.waterDetail = Math.min(208, Math.max(64, Math.round(g.waterDetail / 16) * 16));
      if (typeof g.waterChunkSize === 'number') s.graphics.waterChunkSize = Math.min(2000, Math.max(300, Math.round(g.waterChunkSize / 50) * 50));
      if (typeof g.waterLodStep === 'number') s.graphics.waterLodStep = Math.min(2, Math.max(0, Math.round(g.waterLodStep)));
      if (typeof g.shadows === 'boolean') s.graphics.shadows = g.shadows;
      if (typeof g.shadowRes === 'number') s.graphics.shadowRes = [512, 1024, 2048].includes(g.shadowRes) ? g.shadowRes : 1024;
      if (typeof g.pixelRatio === 'number') s.graphics.pixelRatio = Math.min(2, Math.max(1, g.pixelRatio));
      if (typeof g.detailLod === 'number') s.graphics.detailLod = Math.min(420, Math.max(100, Math.round(g.detailLod)));
      if (typeof g.useGLBModels === 'boolean') s.graphics.useGLBModels = g.useGLBModels;
      // v10: graphics.islandTextures (boolean) переехал в assets.islandTextures (режим)
      if (typeof g.islandTextures === 'boolean') {
        s.assets.islandTextures = g.islandTextures ? 'grain' : 'off';
      }
      if (isObj(g.wireframe)) {
        const w = g.wireframe;
        for (const k of ['water', 'ships', 'islands', 'vegetation'] as const) {
          if (typeof w[k] === 'boolean') s.graphics.wireframe[k] = w[k] as boolean;
        }
      }
    }
    if (isObj(data.controls)) {
      const c = data.controls;
      const keys = Object.keys(s.controls) as (keyof ControlsSettings)[];
      for (const k of keys) {
        if (k === 'ammo') continue;
        if (k === 'invertRudder') {
          if (typeof c.invertRudder === 'boolean') s.controls.invertRudder = c.invertRudder;
          continue;
        }
        const v = c[k];
        if (typeof v === 'string' && v.length > 0) s.controls[k] = v;
      }
      if (Array.isArray(c.ammo)) {
        for (let i = 0; i < 4; i++) {
          if (typeof c.ammo[i] === 'string' && c.ammo[i].length > 0) s.controls.ammo[i] = c.ammo[i];
        }
      }
    }
    if (isObj(data.audio)) {
      if (typeof data.audio.volume === 'number') s.audio.volume = Math.min(1, Math.max(0, data.audio.volume));
    }
    if (isObj(data.gameplay)) {
      if (typeof data.gameplay.provingDistance === 'number') s.gameplay.provingDistance = Math.min(400, Math.max(10, Math.round(data.gameplay.provingDistance)));
      if (isObj(data.gameplay.startingAmmo)) {
        const a = data.gameplay.startingAmmo;
        for (const k of ['ball', 'chain', 'grape', 'fire'] as const) {
          if (typeof a[k] === 'number') s.gameplay.startingAmmo[k] = Math.min(999, Math.max(0, Math.round(a[k])));
        }
      }
      if (typeof data.gameplay.hullDurability === 'number') s.gameplay.hullDurability = Math.min(3, Math.max(0.5, data.gameplay.hullDurability));
      if (typeof data.gameplay.infiniteAmmo === 'boolean') s.gameplay.infiniteAmmo = data.gameplay.infiniteAmmo;
      if (typeof data.gameplay.ammoJitter === 'boolean') s.gameplay.ammoJitter = data.gameplay.ammoJitter;
      if (typeof data.gameplay.startMoney === 'number') s.gameplay.startMoney = Math.min(100000, Math.max(0, Math.round(data.gameplay.startMoney)));
      if (typeof data.gameplay.boatCount === 'number') s.gameplay.boatCount = Math.min(2, Math.max(0, Math.round(data.gameplay.boatCount)));
      if (typeof data.gameplay.simpleControls === 'boolean') s.gameplay.simpleControls = data.gameplay.simpleControls;
      if (typeof data.gameplay.catsInsteadOfCrew === 'boolean') s.gameplay.catsInsteadOfCrew = data.gameplay.catsInsteadOfCrew;
      // Task 46 (v16): модель корпуса + правила экипажа
      if (data.gameplay.hullModel === 'planks' || data.gameplay.hullModel === 'smooth') {
        s.gameplay.hullModel = data.gameplay.hullModel;
      }
      if (typeof data.gameplay.crewReplacement === 'boolean') s.gameplay.crewReplacement = data.gameplay.crewReplacement;
      if (typeof data.gameplay.crewMarksmen === 'boolean') s.gameplay.crewMarksmen = data.gameplay.crewMarksmen;
    }
    // Task 41: ОСТРОВА — деревья/деревни/жители/лодки (глобально +
    // переопределения по островам). v13-миграция: gameplay.vegDensity → treesMul
    if (isObj(data.islands)) {
      const isl = data.islands;
      if (typeof isl.treesMul === 'number') s.islands.treesMul = Math.min(1000, Math.max(0.25, isl.treesMul));
      if (typeof isl.villagesMul === 'number') s.islands.villagesMul = Math.min(3, Math.max(0, isl.villagesMul));
      if (typeof isl.folkMul === 'number') s.islands.folkMul = Math.min(5, Math.max(0, isl.folkMul));
      if (typeof isl.boatsMul === 'number') s.islands.boatsMul = Math.min(5, Math.max(0, isl.boatsMul));
      if (isObj(isl.perIsland)) {
        for (const [key, ov] of Object.entries(isl.perIsland)) {
          const idx = Number(key);
          if (!Number.isInteger(idx) || idx < 0 || idx > 200 || !isObj(ov)) continue;
          const o: IslandOverrides = {};
          if (typeof ov.treesMul === 'number') o.treesMul = Math.min(1000, Math.max(0.25, ov.treesMul));
          if (typeof ov.villagesMul === 'number') o.villagesMul = Math.min(3, Math.max(0, ov.villagesMul));
          if (typeof ov.folkMul === 'number') o.folkMul = Math.min(5, Math.max(0, ov.folkMul));
          if (typeof ov.boatsMul === 'number') o.boatsMul = Math.min(5, Math.max(0, ov.boatsMul));
          if (Object.keys(o).length) s.islands.perIsland[String(idx)] = o;
        }
      }
    }
    // Task 47: КОРАБЛИ — доски/ядра/живучесть по судам
    if (isObj(data.ships)) {
      const sh = data.ships;
      if (typeof sh.plankStrength === 'number') s.ships.plankStrength = Math.min(4, Math.max(0.25, sh.plankStrength));
      if (typeof sh.ballDamage === 'number') s.ships.ballDamage = Math.min(4, Math.max(0.25, sh.ballDamage));
      if (isObj(sh.durability)) {
        for (const [id, mul] of Object.entries(sh.durability)) {
          if (typeof mul === 'number' && isFinite(mul)) {
            const v = Math.min(4, Math.max(0.25, mul));
            if (v !== 1) s.ships.durability[id] = v;
          }
        }
      }
    }
    // v13→v14: плотность леса жила в gameplay.vegDensity
    if (typeof (data.gameplay as Record<string, unknown> | undefined)?.vegDensity === 'number'
      && typeof (data.islands as Record<string, unknown> | undefined)?.treesMul !== 'number') {
      const vd = (data.gameplay as Record<string, unknown>).vegDensity;
      if (typeof vd === 'number') s.islands.treesMul = Math.min(1000, Math.max(0.25, vd));
    }
    if (isObj(data.weather)) {
      const w = data.weather;
      if (typeof w.mode === 'string' && ['clear', 'rain', 'storm', 'fog'].includes(w.mode)) s.weather.mode = w.mode as WeatherMode;
      if (typeof w.windSpeed === 'number') s.weather.windSpeed = Math.min(24, Math.max(0, w.windSpeed));
      if (typeof w.windDir === 'number') s.weather.windDir = ((Math.round(w.windDir) % 360) + 360) % 360;
      // v6: weather.seaModel удалён (единое море) — игнорируем старое поле
    }
    if (isObj(data.physics)) {
      const p = data.physics;
      if (p.mode === 'realistic' || p.mode === 'simple') s.physics.mode = p.mode;
      if (isObj(p.buoyancy)) {
        const b = p.buoyancy;
        if (typeof b.heelMaxDeg === 'number') s.physics.buoyancy.heelMaxDeg = Math.min(35, Math.max(6, b.heelMaxDeg));
        if (typeof b.pitchMaxDeg === 'number') s.physics.buoyancy.pitchMaxDeg = Math.min(35, Math.max(8, b.pitchMaxDeg));
        if (typeof b.draftOffset === 'number') s.physics.buoyancy.draftOffset = Math.min(0.8, Math.max(-0.8, b.draftOffset));
        if (typeof b.boatDraftMul === 'number') s.physics.buoyancy.boatDraftMul = Math.min(3, Math.max(0.5, b.boatDraftMul));
        if (typeof b.boatSmooth === 'number') s.physics.buoyancy.boatSmooth = Math.min(25, Math.max(6, b.boatSmooth));
        if (typeof b.washProbabilityPct === 'number') s.physics.buoyancy.washProbabilityPct = Math.min(100, Math.max(0, b.washProbabilityPct));
        if (typeof b.washCooldownS === 'number') s.physics.buoyancy.washCooldownS = Math.min(25, Math.max(2, b.washCooldownS));
      }
    }
    if (isObj(data.fx)) {
      const f = data.fx;
      if (typeof f.smokeVisible === 'boolean') s.fx.smokeVisible = f.smokeVisible;
      if (typeof f.smokeSize === 'number') s.fx.smokeSize = Math.min(2.5, Math.max(0.3, f.smokeSize));
      if (typeof f.smokeDensity === 'number') s.fx.smokeDensity = Math.min(2, Math.max(0, f.smokeDensity));
      if (typeof f.smokeTransparency === 'number') s.fx.smokeTransparency = Math.min(0.95, Math.max(0, f.smokeTransparency));
    }
    // v10 (Task 37): раздел assets — текстуры/шейдеры рельефа
    if (isObj(data.assets)) {
      const a = data.assets;
      if (a.islandTextures === 'off' || a.islandTextures === 'grain' || a.islandTextures === 'pbr'
        || a.islandTextures === 'url' || a.islandTextures === 'zones') {
        s.assets.islandTextures = a.islandTextures;
      }
      if (typeof a.texScale === 'number') s.assets.texScale = Math.min(30, Math.max(3, a.texScale));
      if (a.terrainShader === 'standard' || a.terrainShader === 'physical' || a.terrainShader === 'lambert' || a.terrainShader === 'phong') {
        s.assets.terrainShader = a.terrainShader;
      }
      if (typeof a.roughness === 'number') s.assets.roughness = Math.min(1, Math.max(0, a.roughness));
      if (typeof a.metalness === 'number') s.assets.metalness = Math.min(1, Math.max(0, a.metalness));
      if (typeof a.normalStrength === 'number') s.assets.normalStrength = Math.min(2, Math.max(0, a.normalStrength));
      // v11 (Task 38): ссылка на свою текстуру рельефа (режим 'url').
      // data:URL — до 200К символов (вшитая картинка), ссылки — до 600
      if (typeof a.texUrl === 'string') {
        const raw = a.texUrl.trim();
        const cap = /^data:image\//i.test(raw) ? 200000 : 600;
        const u = raw.slice(0, cap);
        if (u === '' || /^(https?:\/\/|data:image\/|\/)/i.test(u)) s.assets.texUrl = u;
      }
      // v12 (Task 39): ссылки на свои текстуры ВСЕХ поверхностей.
      // v13 (Task 40): + слоты ЗОН островов (sand/grass/dirt/rock).
      // Миграция v11→v12: texUrl → texUrls.terrain (если та пустая)
      if (isObj(a.texUrls)) {
        for (const id of ['terrain', 'hull', 'deck', 'sail', 'water', 'sand', 'grass', 'dirt', 'rock'] as const) {
          if (typeof a.texUrls[id] === 'string') {
            const raw = (a.texUrls[id] as string).trim();
            const cap = /^data:image\//i.test(raw) ? 200000 : 600;
            const u = raw.slice(0, cap);
            if (u === '' || /^(https?:\/\/|data:image\/|\/)/i.test(u)) s.assets.texUrls[id] = u;
          }
        }
      }
      if (!s.assets.texUrls.terrain && s.assets.texUrl) {
        s.assets.texUrls.terrain = s.assets.texUrl;
      }
    }
    // v12 (Task 39): внешность капитана (экран создания персонажа)
    if (isObj(data.player)) {
      const p = data.player as Record<string, unknown>;
      const isColor = (v: unknown, pal: readonly number[]) =>
        typeof v === 'number' && pal.includes(v);
      if (isColor(p.skin, APPEARANCE_SKIN)) s.player.skin = p.skin as number;
      if (isColor(p.shirt, APPEARANCE_SHIRT)) s.player.shirt = p.shirt as number;
      if (isColor(p.pants, APPEARANCE_PANTS)) s.player.pants = p.pants as number;
      if (typeof p.headwear === 'string' && HEADWEAR_KINDS.includes(p.headwear as HeadwearKind)) {
        s.player.headwear = p.headwear as HeadwearKind;
      }
      if (typeof p.torso === 'string' && TORSO_KINDS.includes(p.torso as TorsoKind)) {
        s.player.torso = p.torso as TorsoKind;
      }
      if (typeof p.pantsKind === 'string' && PANTS_KINDS.includes(p.pantsKind as PantsKind)) {
        s.player.pantsKind = p.pantsKind as PantsKind;
      }
      if (p.beard === 0 || p.beard === 1 || p.beard === 2) s.player.beard = p.beard;
      if (typeof p.eyePatch === 'boolean') s.player.eyePatch = p.eyePatch;
      if (typeof p.parrot === 'boolean') s.player.parrot = p.parrot;
      if (typeof p.pegLeg === 'boolean') s.player.pegLeg = p.pegLeg;
      if (typeof p.hook === 'boolean') s.player.hook = p.hook;
    }
    // МИГРАЦИЯ v3: сохранение сделано до «реалистичного» боекомплекта —
    // сбрасываем только стартовый боезапас на новые дефолты.
    // v4: новые разделы sea/buoyancy просто берут дефолты (выше).
    if (typeof (data as { v?: number }).v !== 'number' || (data as { v: number }).v < 3) {
      s.gameplay.startingAmmo = { ...DEFAULT_SETTINGS.gameplay.startingAmmo };
    }
    if (data.v !== SCHEMA_VER) {
      saveSettings(s); // сразу перезаписываем с новой версией схемы
    }
    return s;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, v: SCHEMA_VER }));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Применить пресет к графике (копируем поля пресета; каркас —
 *  настройка пользователя, не перетирается; текстуры рельефа —
 *  в разделе assets, пресетом не трогаются) */
export function applyPreset(g: GraphicsSettings, preset: QualityPreset): GraphicsSettings {
  return { preset, ...QUALITY_PRESETS[preset], wireframe: { ...g.wireframe } };
}

/** Реалистичная «недостача» боезапаса при выходе в море: каждый тип
 *  снарядов уменьшается на случайные 1–10% (порох отсырел, часть
 *  расстреляна, погрузили не всё). Возвращает НОВЫЙ объект. */
export function rollStartingAmmo(a: GameplaySettings['startingAmmo']):
  { ammo: GameplaySettings['startingAmmo']; cut: Record<string, number> } {
  const ammo = { ...a };
  const cut: Record<string, number> = {};
  for (const k of ['ball', 'chain', 'grape', 'fire'] as const) {
    const pct = 0.01 + Math.random() * 0.09; // 1..10%
    const before = ammo[k];
    ammo[k] = Math.max(0, Math.round(before * (1 - pct)));
    cut[k] = +(pct * 100).toFixed(1);
  }
  return { ammo, cut };
}

/** Русские подписи действий для экрана управления */
export const CONTROL_LABELS: Record<keyof ControlsSettings, string> = {
  sailsUp: 'Паруса: поднять',
  sailsDown: 'Паруса: убрать / задний ход',
  steerLeft: 'Руль влево',
  steerRight: 'Руль вправо',
  invertRudder: 'Инверсия руля (A/D наоборот)',
  anchor: 'Якорь',
  camera: 'Камера',
  aimPort: 'Прицел: левый борт',
  aimStarboard: 'Прицел: правый борт / действие',
  fire: 'Залп (Пробел; E+Пробел — правый борт, Q+Пробел — левый)',
  repair: 'Ремонт / откачка',
  map: 'Карта',
  help: 'Помощь',
  oars: 'Вёсла: вывалить/убрать',
  gunports: 'Пушечные порты: открыть/закрыть',
  boat: 'Шлюпка: спустить/поднять (две — правого и левого борта; на воде — вёсла/руль)',
  deckWalk: 'Прогулка по палубе: капитан сходит с мостика (лесенки на квартердек работают)',
  ammo: 'Боеприпасы 1–4',
};

/** Человекочитаемое имя клавиши по code */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map: Record<string, string> = {
    Space: 'Пробел', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', ShiftLeft: 'LShift',
    ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl', AltLeft: 'LAlt',
    AltRight: 'RAlt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '−', Equal: '=', Backslash: '\\', Comma: ',', Period: '.',
    Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  };
  return map[code] ?? code;
}
