// ============================================================
// Настройки игры: графика (дальность прорисовки, детализация
// воды, тени, pixel ratio, качество пены), управление
// (переназначение клавиш), звук. Сохранение в localStorage.
// ============================================================

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  preset: QualityPreset;
  drawDistance: number;   // м: радиус дальней воды/видимости (2400..8000)
  waterDetail: number;    // сегментов детальной сетки воды по стороне (64..208)
  shadows: boolean;
  shadowRes: number;      // 512 | 1024 | 2048
  pixelRatio: number;     // ограничение devicePixelRatio (1..2)
  foamQuality: number;    // 0 простая пена .. 2 Rich (слои шума)
  waveHeight: number;     // множитель высоты волн 0.6..1.3 (погода всё равно меняет море)
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
  ammo: [string, string, string, string];
}

export interface AudioSettings {
  volume: number;         // 0..1
}

export interface GameSettings {
  graphics: GraphicsSettings;
  controls: ControlsSettings;
  audio: AudioSettings;
}

export const QUALITY_PRESETS: Record<QualityPreset, Omit<GraphicsSettings, 'preset'>> = {
  low:    { drawDistance: 2600, waterDetail: 88,  shadows: false, shadowRes: 1024, pixelRatio: 1.0,  foamQuality: 0, waveHeight: 1.15 },
  medium: { drawDistance: 4000, waterDetail: 128, shadows: true,  shadowRes: 1024, pixelRatio: 1.25, foamQuality: 1, waveHeight: 1.15 },
  high:   { drawDistance: 5600, waterDetail: 176, shadows: true,  shadowRes: 2048, pixelRatio: 1.5,  foamQuality: 2, waveHeight: 1.15 },
  ultra:  { drawDistance: 7800, waterDetail: 208, shadows: true,  shadowRes: 2048, pixelRatio: 2.0,  foamQuality: 2, waveHeight: 1.15 },
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
    ammo: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  },
  audio: { volume: 0.55 },
};

const STORAGE_KEY = 'seawolves.settings.v1';

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
      if (typeof g.waterDetail === 'number') s.graphics.waterDetail = Math.min(208, Math.max(64, Math.round(g.waterDetail)));
      if (typeof g.shadows === 'boolean') s.graphics.shadows = g.shadows;
      if (typeof g.shadowRes === 'number') s.graphics.shadowRes = [512, 1024, 2048].includes(g.shadowRes) ? g.shadowRes : 1024;
      if (typeof g.pixelRatio === 'number') s.graphics.pixelRatio = Math.min(2, Math.max(1, g.pixelRatio));
      if (typeof g.foamQuality === 'number') s.graphics.foamQuality = Math.min(2, Math.max(0, Math.round(g.foamQuality)));
      if (typeof g.waveHeight === 'number') s.graphics.waveHeight = Math.min(1.3, Math.max(0.6, g.waveHeight));
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
    return s;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Применить пресет к графике (копируем поля пресета) */
export function applyPreset(g: GraphicsSettings, preset: QualityPreset): GraphicsSettings {
  return { preset, ...QUALITY_PRESETS[preset] };
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
  fire: 'Залп бортом',
  repair: 'Ремонт / откачка',
  map: 'Карта',
  help: 'Помощь',
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
