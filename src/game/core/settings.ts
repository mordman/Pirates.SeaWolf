// ============================================================
// Настройки игры: графика (дальность прорисовки, детализация
// воды, тени, pixel ratio, качество пены), управление
// (переназначение клавиш), звук. Сохранение в localStorage.
// ============================================================

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

// ============================================================
// Погода: режим явлений + ветер. От силы ветра зависят волны.
// ============================================================
export type WeatherMode = 'clear' | 'rain' | 'storm' | 'fog';

/** Море и волны — ТРИ реализации: физическая (Task 12–25),
 *  «волна-опора» (Task 27) и АВТОНОМНЫЙ ШТОРМОВОЙ МОДУЛЬ sea.js
 *  (Task 29: две сетки Gerstner + пена вокруг корпуса в шейдере
 *  + качка ShipBuoyancy из shipPhysics.js) */
export type SeaModelKind = 'physical' | 'riding' | 'storm';

export const SEA_MODEL_LABELS: Record<SeaModelKind, string> = {
  physical: 'Физическая (Архимед, корабль режет волны)',
  riding: 'Волна-опора (по поверхности, из файла «Перун»)',
  storm: 'Штормовой модуль (sea.js: Герстнер + качка корпуса)',
};

/** Параметры штормового модуля (sea.js) — всё, что можно
 *  настроить в приложенном коде; ветер/направление — ОБЩИЕ
 *  настройки погоды (действуют на модуль так же) */
export interface SeaModuleSettings {
  waveHeight: number;   // 0.3..2 — множитель крутизны (высоты) волн
  waveLength: number;   // 0.6..1.8 — множитель длин волн
  foam: number;         // 0..1.5 — пена: барашки, обводка корпуса, кильватер
  farSeg: number;       // 128..320 — сегменты дальней сетки (качество)
  nearSeg: number;      // 128..320 — сегменты ближней сетки (детализация)
  nearSize: number;     // 260..500 — сторона ближней сетки, м
}

/** Качка корпуса (shipPhysics.js) — пружины/ориентация/посадка */
export interface BuoyancySettings {
  heaveStiffness: number;    // 1..12 — жёсткость пружины вертикальной качки
  heaveDamping: number;      // 0.5..6 — демпфер вертикальной качки
  orientResponse: number;    // 0.5..8 — «вязкость» доворота к склону волны
  sinkHeel: number;          // 0..3 — заглубление от крена, м
  sinkSpeed: number;         // 0..0.08 — заглубление от хода, м/м·с⁻¹
  sampleForeAft: number;     // 0.2..0.6 — доля длины: точки замера нос/корма
  sampleSide: number;        // 0.4..1 — доля полуширины: точки замера бортов
  immersionFrigate: number;  // 0.25..0.75 — посадка крупных судов
  immersionBoat: number;     // 0.25..0.85 — посадка шлюпки
  immersionDefault: number;  // 0.25..0.75 — посадка остальных судов
  floodCooldown: number;     // 0.5..6 — пауза между событиями заливания, с
}

export interface WeatherSettings {
  mode: WeatherMode;   // ясно / дождь / гроза / туман
  windSpeed: number;   // 0..24 м/с — сила ветра (задаёт и волнение)
  windDir: number;     // 0..355° — направление ОТКУДА дует (компас)
  seaModel: SeaModelKind; // модель моря/плавучести (Task 27)
}

export interface FxSettings {
  smokeVisible: boolean;      // видимость дыма (и огня выстрелов)
  smokeSize: number;          // 0.3..2.5× — размер клубов
  smokeDensity: number;       // 0..2× — количество клубов
  smokeTransparency: number;  // 0..0.95 — прозрачность (выше = прозрачнее)
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
  foamQuality: number;    // 0 простая пена .. 2 Rich (слои шума)
  detailLod: number;      // м: дальность показа мелких деталей кораблей (100..420)
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
}

export interface GameSettings {
  graphics: GraphicsSettings;
  controls: ControlsSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
  weather: WeatherSettings;
  fx: FxSettings;
  sea: SeaModuleSettings;      // штормовой модуль sea.js (Task 29)
  buoyancy: BuoyancySettings;  // качка корпуса shipPhysics.js (Task 29)
}

export const QUALITY_PRESETS: Record<QualityPreset, Omit<GraphicsSettings, 'preset'>> = {
  low:    { drawDistance: 2600, waterDetail: 96,  waterChunkSize: 800,  waterLodStep: 2, shadows: false, shadowRes: 1024, pixelRatio: 1.0,  foamQuality: 0, detailLod: 150 },
  medium: { drawDistance: 4000, waterDetail: 128, waterChunkSize: 900,  waterLodStep: 1, shadows: true,  shadowRes: 1024, pixelRatio: 1.25, foamQuality: 1, detailLod: 210 },
  high:   { drawDistance: 5600, waterDetail: 176, waterChunkSize: 900,  waterLodStep: 0, shadows: true,  shadowRes: 2048, pixelRatio: 1.5,  foamQuality: 2, detailLod: 270 },
  ultra:  { drawDistance: 7800, waterDetail: 208, waterChunkSize: 1100, waterLodStep: 0, shadows: true,  shadowRes: 2048, pixelRatio: 2.0,  foamQuality: 2, detailLod: 340 },
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: { preset: 'high', ...QUALITY_PRESETS.high },
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
  },
  weather: { mode: 'clear', windSpeed: 7.5, windDir: 40, seaModel: 'physical' },
  fx: { smokeVisible: true, smokeSize: 1, smokeDensity: 1, smokeTransparency: 0.45 },
  sea: { waveHeight: 1, waveLength: 1, foam: 1, farSeg: 256, nearSeg: 256, nearSize: 300 },
  buoyancy: {
    heaveStiffness: 5, heaveDamping: 2.4, orientResponse: 2.6,
    sinkHeel: 1.2, sinkSpeed: 0.02, sampleForeAft: 0.42, sampleSide: 0.78,
    immersionFrigate: 0.45, immersionBoat: 0.65, immersionDefault: 0.5,
    floodCooldown: 1.4,
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
// v3: (1) высота волн больше НЕ настраивается — только сила ветра
//     (настройка waveHeight удалена); (2) стартовый боезапас приведён к
//     реалистичному 40/12/20/8 (было 90/30/60/20 — песочница);
//     (3) новая настройка «случайная недостача боезапаса 1–10%».
// v4 (Task 29): новые разделы sea (штормовой модуль sea.js) и
//     buoyancy (качка shipPhysics.js) + модель моря 'storm'.
//     Старые сохранения: боезапас сбрасывается только если версия < 3.
const SCHEMA_VER = 4;

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
      if (typeof g.foamQuality === 'number') s.graphics.foamQuality = Math.min(2, Math.max(0, Math.round(g.foamQuality)));
      if (typeof g.detailLod === 'number') s.graphics.detailLod = Math.min(420, Math.max(100, Math.round(g.detailLod)));
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
    }
    if (isObj(data.weather)) {
      const w = data.weather;
      if (typeof w.mode === 'string' && ['clear', 'rain', 'storm', 'fog'].includes(w.mode)) s.weather.mode = w.mode as WeatherMode;
      if (typeof w.windSpeed === 'number') s.weather.windSpeed = Math.min(24, Math.max(0, w.windSpeed));
      if (typeof w.windDir === 'number') s.weather.windDir = ((Math.round(w.windDir) % 360) + 360) % 360;
      if (w.seaModel === 'riding' || w.seaModel === 'physical' || w.seaModel === 'storm') s.weather.seaModel = w.seaModel;
    }
    if (isObj(data.sea)) {
      const m = data.sea;
      if (typeof m.waveHeight === 'number') s.sea.waveHeight = Math.min(2, Math.max(0.3, m.waveHeight));
      if (typeof m.waveLength === 'number') s.sea.waveLength = Math.min(1.8, Math.max(0.6, m.waveLength));
      if (typeof m.foam === 'number') s.sea.foam = Math.min(1.5, Math.max(0, m.foam));
      if (typeof m.farSeg === 'number') s.sea.farSeg = Math.min(320, Math.max(128, Math.round(m.farSeg / 16) * 16));
      if (typeof m.nearSeg === 'number') s.sea.nearSeg = Math.min(320, Math.max(128, Math.round(m.nearSeg / 16) * 16));
      if (typeof m.nearSize === 'number') s.sea.nearSize = Math.min(500, Math.max(260, Math.round(m.nearSize / 20) * 20));
    }
    if (isObj(data.buoyancy)) {
      const b = data.buoyancy;
      if (typeof b.heaveStiffness === 'number') s.buoyancy.heaveStiffness = Math.min(12, Math.max(1, b.heaveStiffness));
      if (typeof b.heaveDamping === 'number') s.buoyancy.heaveDamping = Math.min(6, Math.max(0.5, b.heaveDamping));
      if (typeof b.orientResponse === 'number') s.buoyancy.orientResponse = Math.min(8, Math.max(0.5, b.orientResponse));
      if (typeof b.sinkHeel === 'number') s.buoyancy.sinkHeel = Math.min(3, Math.max(0, b.sinkHeel));
      if (typeof b.sinkSpeed === 'number') s.buoyancy.sinkSpeed = Math.min(0.08, Math.max(0, b.sinkSpeed));
      if (typeof b.sampleForeAft === 'number') s.buoyancy.sampleForeAft = Math.min(0.6, Math.max(0.2, b.sampleForeAft));
      if (typeof b.sampleSide === 'number') s.buoyancy.sampleSide = Math.min(1, Math.max(0.4, b.sampleSide));
      if (typeof b.immersionFrigate === 'number') s.buoyancy.immersionFrigate = Math.min(0.75, Math.max(0.25, b.immersionFrigate));
      if (typeof b.immersionBoat === 'number') s.buoyancy.immersionBoat = Math.min(0.85, Math.max(0.25, b.immersionBoat));
      if (typeof b.immersionDefault === 'number') s.buoyancy.immersionDefault = Math.min(0.75, Math.max(0.25, b.immersionDefault));
      if (typeof b.floodCooldown === 'number') s.buoyancy.floodCooldown = Math.min(6, Math.max(0.5, b.floodCooldown));
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

/** Применить пресет к графике (копируем поля пресета) */
export function applyPreset(g: GraphicsSettings, preset: QualityPreset): GraphicsSettings {
  return { preset, ...QUALITY_PRESETS[preset] };
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
  boat: 'Шлюпка: спустить/поднять (на воде — вёсла/руль)',
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
