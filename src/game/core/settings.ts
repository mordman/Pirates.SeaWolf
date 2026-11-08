// ============================================================
// Настройки игры: графика (дальность прорисовки, детализация
// воды, тени, pixel ratio, качество пены), управление
// (переназначение клавиш), звук. Сохранение в localStorage.
// ============================================================

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

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
}

export interface GameSettings {
  graphics: GraphicsSettings;
  controls: ControlsSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
  weather: WeatherSettings;
  fx: FxSettings;
  physics: PhysicsSettings;   // режим физики + плавучесть (Task 33)
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
const SCHEMA_VER = 8;

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
 *  настройка пользователя, пресетом не перетирается) */
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
