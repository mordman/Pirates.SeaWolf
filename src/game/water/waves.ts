// ============================================================
// ЕДИНОЕ МОРЕ (Task 33): волны Герстнера + микронормали
// поверхности на основе FBM. Одна реализация для ФИЗИКИ (TS)
// и для ШЕЙДЕРА (GLSL) — расхождений между визуалом и
// плавучестью нет.
//
//   • ВЫСОТА ВОЛН ЗАВИСИТ ОТ СКОРОСТИ ВЕТРА: амплитуда каждой
//     гармоники = A0 · (0.10 + 0.90·(v/24)^1.25); штиль — рябь,
//     12 м/с — свежая волна, 24 м/с — штормовые валы.
//   • ВЕСЬ СПЕКТР БЕЖИТ ПО ВЕТРУ: направления волн
//     поворачиваются за направлением ветра (оно в погоде уже
//     сглажено — спектр следует без щелчков фаз).
//   • ВОЛНЫ РАЗБИВАЮТСЯ ОБ ОСТРОВА: у берега (глубина < ~30 м)
//     амплитуда гаснет до нуля — вал «ложится» на мель; на
//     островах с горами от самого берега полоса прибоя узкая
//     (глубина нарастает резко). CPU считает то же по heightAt,
//     GPU — по текстуре рельефа (см. Water.ts).
//
// Прежние «физическая»/«волна-опора»/«штормовой модуль sea.js»
// УДАЛЕНЫ — это была единственная оставшаяся реализация моря.
// ============================================================
import * as THREE from 'three';
import { heightAt } from '../world/world';

export interface WaveDef {
  /** базовый угол волны в спектре (рад, относительно оси бега волн) */
  ang: number;
  len: number;      // длина волны, м
  st: number;       // крутизна (A = st/k)
  phase: number;    // сдвиг фазы, рад — гребни «дышат»
}

/** СПЕКТР: 3 длинные зыби + 3 короткие chop-волны; все участвуют
 *  и в физике, и в картинке (набор штормового демо «Перун») */
export const WAVES: WaveDef[] = [
  { ang: 0.000, len: 118.0, st: 0.180, phase: 0.0 },
  { ang: 1.944, len: 64.0, st: 0.150, phase: 1.7 },
  { ang: -1.212, len: 38.0, st: 0.120, phase: 4.1 },
  { ang: -0.419, len: 15.0, st: 0.110, phase: 0.5 },
  { ang: -1.874, len: 8.5, st: 0.090, phase: 2.6 },
  { ang: 0.896, len: 4.8, st: 0.070, phase: 5.2 },
];

/** максимум слотов под волны в шейдере */
export const MAX_WAVES = WAVES.length;

const K = (w: WaveDef) => (Math.PI * 2) / w.len;
const C = (w: WaveDef) => Math.sqrt(9.81 / K(w));   // фазовая скорость
const A0 = (w: WaveDef) => w.st / K(w);             // амплитуда при штиле

// ------------------------------------------------------------
// СОСТОЯНИЕ МОРЯ (обновляет Game из погоды; штиль на полигоне
// задаёт 0.42/маленький ветер — там чистая вода)
// ------------------------------------------------------------
export interface SeaState {
  /** скорость ветра, м/с — высота волн зависит от неё */
  windSpeed: number;
  /** направление ОТКУДА дует, рад (спектр бежит ПО ветру) */
  windFrom: number;
  /** сглаженный множитель амплитуд 0..1+ (море набирает волну) */
  amp01: number;
}

export const SEA: SeaState = { windSpeed: 7.5, windFrom: 0.7, amp01: 0.35 };

/** множитель амплитуды от ветра (и CPU, и GPU): штиль 0.10,
 *  12 м/с ≈ 0.53, 24 м/с = 1.0 */
export function windFactor(v: number): number {
  const t = Math.max(0, Math.min(1, v / 24));
  return 0.10 + 0.90 * Math.pow(t, 1.25);
}

/** текущая амплитуда гармоники (ветер × сглаженный набег) */
function amplitudeOf(w: WaveDef): number {
  return A0(w) * SEA.amp01;
}

/** направление бега волны (рад, мир): базовый угол + ось ветра
 *  (волны бегут ПО ветру: ось = from + π) */
function dirOf(w: WaveDef): { x: number; z: number } {
  const a = w.ang + SEA.windFrom + Math.PI;
  return { x: Math.cos(a), z: Math.sin(a) };
}

// ------------------------------------------------------------
// ВОЛНЫ РАЗБИВАЮТСЯ ОБ ОСТРОВА (CPU): множитель амплитуды от
// глубины. Глубина < 30 м — амплитуда гаснет; суша — 0.
// Кэш по сетке 12 м (физика спрашивает одни точки много раз).
// ------------------------------------------------------------
const SHORE_DIST = 30;      // глубина, с которой начинается гашение, м
const shoreCache = new Map<number, number>();
const SHORE_GRID = 12;

export function shoreFadeAt(x: number, z: number): number {
  const qx = Math.round(x / SHORE_GRID), qz = Math.round(z / SHORE_GRID);
  const key = qx * 100003 + qz;
  let f = shoreCache.get(key);
  if (f === undefined) {
    const depth = -heightAt(x, z);          // дно ниже уровня моря
    f = depth <= 0 ? 0 : Math.min(1, depth / SHORE_DIST);
    // мягкая S-кривая: у самой кромки гаснет быстрее, в море — 1
    f = f * f * (3 - 2 * f);
    if (shoreCache.size > 8192) shoreCache.clear();
    shoreCache.set(key, f);
  }
  return f;
}

// ------------------------------------------------------------
// ВЫСОТА ВОДЫ (мировая точка, CPU — для физики). Итеративное
// обращение горизонтального смещения Герстнера + гашение у берега
// ------------------------------------------------------------
export function waterHeightAt(x: number, z: number, t: number): number {
  const fade = shoreFadeAt(x, z);
  if (fade <= 0.001) return 0;
  let px = x, pz = z;
  for (let it = 0; it < 3; it++) {          // инверсия смещения
    let dx = 0, dz = 0;
    for (const w of WAVES) {
      const k = K(w), c = C(w), a = amplitudeOf(w);
      const d = dirOf(w);
      const f = k * (d.x * px + d.z * pz - c * t) + w.phase;
      dx += d.x * a * Math.cos(f);
      dz += d.z * a * Math.cos(f);
    }
    px = x - dx; pz = z - dz;
  }
  let y = 0;
  for (const w of WAVES) {
    const k = K(w), c = C(w), a = amplitudeOf(w);
    const d = dirOf(w);
    const f = k * (d.x * px + d.z * pz - c * t) + w.phase;
    y += a * Math.sin(f);
  }
  return y * fade;
}

/** Огибающая волнения: сумма амплитуд гармоник (макс. высота
 *  гребня над средним уровнем) при текущем ветре */
export function waveEnvelope(): number {
  let s = 0;
  for (const w of WAVES) s += amplitudeOf(w);
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

/** Погодный множитель амплитуд для ШЕЙДЕРА — единый (набег уже
 *  сглажен в SEA.amp01; направления спектра — в uniform'ах) */
export function seaAmpUniforms(): number {
  return SEA.amp01;
}

/** Данные волн для UNIFORM-массивов шейдера: wa=[dir.x, dir.z, k, A]
 *  (A — БЕЗ погоды, погода приходит множителем uAmp), wb=[k·c,
 *  phase, micro-флаг, —]. Короткие волны (индексы ≥ N_LO) гаснут
 *  к краю детального чанка — крупная ячейка LOD-колец их не держит */
export function waveUniformData(): {
  wa: [number, number, number, number][];
  wb: [number, number, number, number][];
} {
  const wa: [number, number, number, number][] = [];
  const wb: [number, number, number, number][] = [];
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = WAVES[i];
    if (!w) { wa.push([1, 0, 0.001, 0]); wb.push([0, 0, 0, 0]); continue; }
    const d = dirOf(w);
    wa.push([d.x, d.z, K(w), A0(w)]);
    wb.push([K(w) * C(w), w.phase, i >= 3 ? 1 : 0, 0]);
  }
  return { wa, wb };
}

/** GLSL-фрагмент с теми же волнами — вставляется в вершинный
 *  шейдер воды/кильватеров. Волны в UNIFORM-массивах: смена
 *  ветра меняет только значения, материалы не пересобираются.
 *  Два диапазона амплитуд: ampLo — длинная зыбь (N_LO), ampHi —
 *  короткие волны/рябь (дальние кольца теряют только их). */
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

/** Мир → UV текстуры рельефа (общая для CPU-затухания и GPU) */
export const TERRAIN_TEX_SIZE = 2048;
export const TERRAIN_WORLD_SIZE = 98000;    // ±49 км — весь архипелаг (Task 36: карта ×10)

export function worldToTerrainUV(x: number, z: number): [number, number] {
  return [(x / TERRAIN_WORLD_SIZE) + 0.5, (z / TERRAIN_WORLD_SIZE) + 0.5];
}

let terrainTex: THREE.DataTexture | null = null;

/** Текстура рельефа мира для шейдера воды: R-канал = высота
 *  (−16..48 м → 0..1). Генерируется ОДИН раз (лаzy) по heightAt —
 *  шейдер гасит волны на мелководье и рисует прибой. */
export function terrainTexture(): THREE.DataTexture {
  if (terrainTex) return terrainTex;
  const S = TERRAIN_TEX_SIZE;
  const data = new Uint8Array(S * S * 4);
  const lo = -16, hi = 48, scale = 255 / (hi - lo);
  for (let j = 0; j < S; j++) {
    const z = (j / (S - 1) - 0.5) * TERRAIN_WORLD_SIZE;
    for (let i = 0; i < S; i++) {
      const x = (i / (S - 1) - 0.5) * TERRAIN_WORLD_SIZE;
      const h = heightAtRaw(x, z);
      const v = Math.max(0, Math.min(255, Math.round((h - lo) * scale)));
      const idx = (j * S + i) * 4;
      data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  terrainTex = tex;
  return tex;
}

/** ленивая ссылка на heightAt мира (ставится Water.ts при создании —
 *  избегаем циклического импорта при инициализации) */
let heightAtRaw: (x: number, z: number) => number = () => -14;
export function bindTerrainSampler(fn: (x: number, z: number) => number) {
  heightAtRaw = fn;
}
