// ============================================================
// ОБЩИЕ Gerstner-волны: одна функция высоты для ФИЗИКИ (TS)
// и для ШЕЙДЕРА (GLSL). Никаких расхождений между визуалом и
// плавучестью — жёсткое требование ТЗ (разделы 15/16).
//
// ТРИ РЕАЛИЗАЦИИ МОРЯ:
//  'physical' — Архимед по точкам корпуса (rigid body):
//    набор PHYS: пологая зыбь, корабль честно кренится/дифферентится
//    и РЕЖЕТ волны носом (Task 25);
//  'riding' — «волна-опора» (Task 27): набор RIDE из файла игрока;
//  'storm' — АВТОНОМНЫЙ МОДУЛЬ sea.js (Task 29): свой рендер
//    (две сетки + пена вокруг корпуса в шейдере), свой CPU-расчёт
//    высоты (3 итерации инверсии) и качка через ShipBuoyancy
//    (shipPhysics.js). Когда модель активна, waterHeightAt/
//    waveUniformData/seaAmpLoHi делегируют модулю — ВСЕ системы
//    (кильватеры, пенные воротники, брызги, бои) видят то же море.
// ============================================================
import { SeaModule } from '../sea/sea';

export interface WaveDef {
  dirX: number; dirZ: number;   // нормализованное направление
  steepness: number;            // крутизна
  wavelength: number;           // длина волны, м
  phase?: number;               // сдвиг фазы, рад (набор RIDE)
  micro?: boolean;              // только для картинки (физика не считает)
}

/** Модель моря/плавучести — выбирается в настройках (Task 27/29) */
export type SeaModel = 'physical' | 'riding' | 'storm';

/** Активный экземпляр штормового модуля (регистрирует Game) */
let stormSea: SeaModule | null = null;
export function setStormSea(s: SeaModule | null) { stormSea = s; }
export function stormSeaInstance(): SeaModule | null { return stormSea; }

// Штормовое состояние масштабирует амплитуды (0.4 штиль .. 1.8 шторм)
export interface SeaState {
  amplitude: number;
  model: SeaModel;
}

export const SEA: SeaState = { amplitude: 1.0, model: 'physical' };

// --- набор PHYS: пологая зыбь для честной гидростатики (Task 12–25) ---
export const WAVES_PHYS: WaveDef[] = [
  { dirX: 1.0, dirZ: 0.25, steepness: 0.075, wavelength: 110.0 },
  { dirX: 0.8, dirZ: 0.6, steepness: 0.062, wavelength: 55.0 },
  { dirX: 0.95, dirZ: -0.32, steepness: 0.05, wavelength: 28.0 },
  { dirX: 0.5, dirZ: 0.86, steepness: 0.04, wavelength: 15.0 },
  { dirX: 0.88, dirZ: 0.48, steepness: 0.03, wavelength: 8.0 },
];

// --- набор RIDE: из файла игрока («ФРЕГАТ ПЕРУН», штормовое
//     плавание): 3 крутые физические волны + 3 микроряби (только
//     визуал). Фазовые сдвиги разводят гребни — море «дышит» ---
export const WAVES_RIDE: WaveDef[] = [
  { dirX: 1.00, dirZ: 0.25, steepness: 0.180, wavelength: 118.0, phase: 0.0 },
  { dirX: -0.72, dirZ: 1.00, steepness: 0.150, wavelength: 64.0, phase: 1.7 },
  { dirX: 0.35, dirZ: -0.94, steepness: 0.120, wavelength: 38.0, phase: 4.1 },
  { dirX: 0.90, dirZ: -0.40, steepness: 0.110, wavelength: 15.0, phase: 0.5, micro: true },
  { dirX: -0.30, dirZ: -0.95, steepness: 0.090, wavelength: 8.5, phase: 2.6, micro: true },
  { dirX: 0.60, dirZ: 0.75, steepness: 0.070, wavelength: 4.8, phase: 5.2, micro: true },
];

/** максимум слотов под волны в шейдере (наборы 5 и 6) */
export const MAX_WAVES = 6;

/** АКТИВНЫЙ набор волн по выбранной модели моря (для 'storm' набор
 * не используется напрямую — данные идут из модуля, здесь только
 * резерв на случай, когда модуль ещё не создан) */
export function activeWaves(): WaveDef[] {
  return SEA.model === 'physical' ? WAVES_PHYS : WAVES_RIDE;
}

const K = (w: WaveDef) => (Math.PI * 2) / w.wavelength;
const C = (w: WaveDef) => Math.sqrt(9.81 / K(w)); // фазовая скорость
const A0 = (w: WaveDef) => w.steepness / K(w);     // амплитуда без погоды

/** Амплитуда волны при текущей погоде. Набор PHYS: линейно от
 *  SEA.amplitude (как всегда). Набор RIDE — кривая из файла игрока:
 *  штиль почти гладкий (calm), ветер качает амплитуду нелинейно
 *  (физические волны ~wind^1.25, микроряби ~wind^1.7), наш
 *  диапазон погоды 0.42..1.9 приводится к их 0..1.6 делением на 1.6 */
function amplitudeOf(w: WaveDef): number {
  if (SEA.model !== 'riding') return (w.steepness * SEA.amplitude) / K(w);
  const wind = Math.min(1.25, Math.max(0, SEA.amplitude / 1.6));
  const calm = w.micro ? 0.04 : 0.10;
  const pw = w.micro ? 1.7 : 1.25;
  return A0(w) * (calm + (1 - calm) * Math.pow(wind, pw));
}

/** Погодные множители амплитуд для ШЕЙДЕРА (два диапазона волн):
 *  набор PHYS — оба равны SEA.amplitude (как раньше);
 *  набор RIDE — кривые calm+…^pw из файла игрока */
export function seaAmpLoHi(): { lo: number; hi: number } {
  // штормовой модуль: амплитуды уже учтены в A (модуль сам ведёт
  // погоду) — множители единичные, чтобы пенные воротники/кильватеры
  // совпали с поверхностью модуля
  if (SEA.model === 'storm' && stormSea) return { lo: 1, hi: 1 };
  if (SEA.model !== 'riding') return { lo: SEA.amplitude, hi: SEA.amplitude };
  const wind = Math.min(1.25, Math.max(0, SEA.amplitude / 1.6));
  return {
    lo: 0.10 + 0.90 * Math.pow(wind, 1.25),   // длинные физические
    hi: 0.04 + 0.96 * Math.pow(wind, 1.7),    // короткие/микроряби
  };
}

/** Волны для ФИЗИКИ: активный набор БЕЗ микроряби (микро — только
 *  картинка, как в файле игрока: PHYS-список для waterHeightAt) */
function physicsWaves(): WaveDef[] {
  const all = activeWaves();
  return SEA.model === 'physical' ? all : all.filter((w) => !w.micro);
}

/** Высота воды в мировой точке (x,z) в момент t. Штормовой модуль
 *  (sea.js) считает сам (свои фазы/направления/амплитуды); без
 *  модуля — резервный набор RIDE. Итеративная оценка Gerstner. */
export function waterHeightAt(x: number, z: number, t: number): number {
  if (SEA.model === 'storm') {
    if (stormSea) return stormSea.heightAt(x, z, t);
    // модуль ещё не создан (первая сборка сцены) — считаем по RIDE
    const wavesR = WAVES_RIDE.filter((w) => !w.micro);
    let px0 = x, pz0 = z;
    for (let it = 0; it < 3; it++) {
      let dx = 0, dz = 0;
      for (const w of wavesR) {
        const k = K(w), c = C(w), a = A0(w);
        const f = k * (w.dirX * px0 + w.dirZ * pz0 - c * t) + (w.phase ?? 0);
        dx += w.dirX * a * Math.cos(f);
        dz += w.dirZ * a * Math.cos(f);
      }
      px0 = x - dx; pz0 = z - dz;
    }
    let y0 = 0;
    for (const w of wavesR) {
      const k = K(w), c = C(w), a = A0(w);
      const f = k * (w.dirX * px0 + w.dirZ * pz0 - c * t) + (w.phase ?? 0);
      y0 += a * Math.sin(f);
    }
    return y0;
  }
  const waves = physicsWaves();
  // 2 итерации обращения горизонтального смещения
  // (набор RIDE — 3, как в файле игрока: волны круче, сходимость хуже)
  const iter = SEA.model === 'riding' ? 3 : 2;
  let px = x, pz = z;
  for (let it = 0; it < iter; it++) {
    let dx = 0, dz = 0;
    for (const w of waves) {
      const k = K(w), c = C(w), a = amplitudeOf(w);
      const f = k * (w.dirX * px + w.dirZ * pz - c * t) + (w.phase ?? 0);
      dx += w.dirX * a * Math.cos(f);
      dz += w.dirZ * a * Math.cos(f);
    }
    px = x - dx; pz = z - dz;
  }
  let y = 0;
  for (const w of waves) {
    const k = K(w), c = C(w), a = amplitudeOf(w);
    const f = k * (w.dirX * px + w.dirZ * pz - c * t) + (w.phase ?? 0);
    y += a * Math.sin(f);
  }
  return y;
}

/** Огибающая волнения: сумма амплитуд всех гармоник (м) при текущей
 *  погоде. Физически — максимально возможная высота гребня над
 *  средним уровнем. */
export function waveEnvelope(): number {
  if (SEA.model === 'storm' && stormSea) return stormSea.envelope();
  let s = 0;
  for (const w of activeWaves()) s += amplitudeOf(w);
  return s;
}

/** Приближённая нормаль воды в точке (центральные разности) */
export function waterNormalAt(x: number, z: number, t: number, out: [number, number, number]) {
  const e = 1.2;
  const hL = waterHeightAt(x - e, z, t), hR = waterHeightAt(x + e, z, t);
  const hD = waterHeightAt(x, z - e, t), hU = waterHeightAt(x, z + e, t);
  out[0] = (hL - hR) / (2 * e);
  out[1] = 1.0;
  out[2] = (hD - hU) / (2 * e);
  const len = Math.hypot(out[0], out[1], out[2]);
  out[0] /= len; out[1] /= len; out[2] /= len;
  return out;
}

/** Данные волн для UNIFORM-массивов шейдера (активный набор,
 *  добитый нулями до MAX_WAVES). A — без погоды: погода приходит
 *  множителями uAmpLo/uAmpHi (два диапазона волн).
 *  Для 'storm' данные идут из модуля sea.js — с УЖЕ учтённой
 *  погодой в A (поэтому seaAmpLoHi даёт 1/1): так пенные воротники
 *  и кильватеры ложатся точно на поверхность штормового моря. */
export function waveUniformData(): {
  wa: [number, number, number, number][];  // dir.x, dir.z, k, A
  wb: [number, number, number, number][];  // k*c, phase, micro?, —
} {
  if (SEA.model === 'storm' && stormSea) {
    const exact = stormSea.uniformDataExact();
    const wa: [number, number, number, number][] = [];
    const wb: [number, number, number, number][] = [];
    for (let i = 0; i < MAX_WAVES; i++) {
      if (!exact.wa[i]) { wa.push([1, 0, 0.001, 0]); wb.push([0, 0, 0, 0]); continue; }
      wa.push(exact.wa[i]);
      wb.push(exact.wb[i]);
    }
    return { wa, wb };
  }
  const list = activeWaves();
  const wa: [number, number, number, number][] = [];
  const wb: [number, number, number, number][] = [];
  const len2 = Math.hypot(1, 0.25); // нормализация направлений RIDE
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = list[i];
    if (!w) {
      wa.push([1, 0, 0.001, 0]);
      wb.push([0, 0, 0, 0]);
      continue;
    }
    // направления в файле игрока не нормализованы — нормализуем здесь
    const dl = Math.hypot(w.dirX, w.dirZ) || 1;
    const dx = w.dirX / dl, dz = w.dirZ / dl;
    void len2;
    wa.push([dx, dz, K(w), A0(w)]);
    wb.push([K(w) * C(w), w.phase ?? 0, w.micro ? 1 : 0, 0]);
  }
  return { wa, wb };
}

/** GLSL-фрагмент с теми же волнами — вставляется в вершинный шейдер
 *  воды. Волны в UNIFORM-массивах (uWaveA/uWaveB): переключение
 *  модели моря меняет только значения uniform'ов, материалы не
 *  пересобираются. Два диапазона амплитуд: множитель ampLo —
 *  длинная зыбь (индексы < N_LO), ampHi — короткие волны/рябь.
 *  Дальние LOD-кольца с крупной ячейкой теряют только короткий
 *  диапазон — переход на границе детального чанка не читается
 *  как «квадрат». */
export function gerstnerGLSL(): string {
  return `
#define N_WAVES ${MAX_WAVES}
#define N_LO 3
uniform float uTime;
uniform vec4 uWaveA[N_WAVES];   // xy = dir, z = k, w = A0 (без погоды)
uniform vec4 uWaveB[N_WAVES];   // x = k*c, y = phase, z = micro-флаг
uniform float uAmpLo;           // погодный множитель длинных волн
uniform float uAmpHi;           // погодный множитель коротких волн
// Основная функция: смещение вершины и нормаль
void gerstner(vec2 p, float ampLo, float ampHi, out vec3 disp, out vec3 normal) {
  disp = vec3(0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bino = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < N_WAVES; i++) {
    vec2 dir = uWaveA[i].xy;
    float k = uWaveA[i].z;
    float a = uWaveA[i].w * (i < N_LO ? ampLo : ampHi);
    float f = k * (dot(dir, p) - uWaveB[i].x * uTime) + uWaveB[i].y;
    float sf = sin(f), cf = cos(f);
    disp += vec3(dir.x * a * cf, a * sf, dir.y * a * cf);
    tang += vec3(-dir.x * dir.x * (k * a * sf), dir.x * (k * a * cf), -dir.x * dir.y * (k * a * sf));
    bino += vec3(-dir.y * dir.x * (k * a * sf), dir.y * (k * a * cf), -dir.y * dir.y * (k * a * sf));
  }
  normal = normalize(cross(bino, tang));
}
`;
}
