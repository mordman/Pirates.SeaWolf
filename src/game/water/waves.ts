// ============================================================
// ОБЩИЕ Gerstner-волны: одна функция высоты для ФИЗИКИ (TS)
// и для ШЕЙДЕРА (GLSL). Никаких расхождений между визуалом и
// плавучестью — жёстное требование ТЗ (разделы 15/16).
// ============================================================
export interface WaveDef {
  dirX: number; dirZ: number;   // нормализованное направление
  steepness: number;            // крутизна
  wavelength: number;           // длина волны, м
}

// Штормовое состояние масштабирует амплитуды (0.4 штиль .. 1.6 шторм)
export interface SeaState { amplitude: number; }

export const SEA: SeaState = { amplitude: 1.0 };

// Набор волн: крупная зыбь -> мелкая рябь (детерминированно, без сида — погода общая)
export const WAVES: WaveDef[] = [
  { dirX: 1.0, dirZ: 0.25, steepness: 0.075, wavelength: 110.0 },
  { dirX: 0.8, dirZ: 0.6, steepness: 0.062, wavelength: 55.0 },
  { dirX: 0.95, dirZ: -0.32, steepness: 0.05, wavelength: 28.0 },
  { dirX: 0.5, dirZ: 0.86, steepness: 0.04, wavelength: 15.0 },
  { dirX: 0.88, dirZ: 0.48, steepness: 0.03, wavelength: 8.0 },
];

const K = (w: WaveDef) => (Math.PI * 2) / w.wavelength;
const C = (w: WaveDef) => Math.sqrt(9.81 / K(w)); // фазовая скорость
const A = (w: WaveDef) => (w.steepness * SEA.amplitude) / K(w); // амплитуда

/** Высота воды в мировой точке (x,z) в момент t. Итеративная оценка Gerstner. */
export function waterHeightAt(x: number, z: number, t: number): number {
  // 2 итерации обращения горизонтального смещения
  let px = x, pz = z;
  for (let it = 0; it < 2; it++) {
    let dx = 0, dz = 0;
    for (const w of WAVES) {
      const k = K(w), c = C(w), a = A(w);
      const f = k * (w.dirX * px + w.dirZ * pz - c * t);
      dx += w.dirX * a * Math.cos(f);
      dz += w.dirZ * a * Math.cos(f);
    }
    px = x - dx; pz = z - dz;
  }
  let y = 0;
  for (const w of WAVES) {
    const k = K(w), c = C(w), a = A(w);
    const f = k * (w.dirX * px + w.dirZ * pz - c * t);
    y += a * Math.sin(f);
  }
  return y;
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

/** GLSL-фрагмент с теми же константами — вставляется в вершинный шейдер воды */
export function gerstnerGLSL(): string {
  return `
#define N_WAVES ${WAVES.length}
uniform float uTime;
uniform float uAmp; // общий множитель погоды ( SEA.amplitude )
// Основная функция: смещение вершины и нормаль
void gerstner(vec2 p, float amp, out vec3 disp, out vec3 normal) {
  disp = vec3(0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bino = vec3(0.0, 0.0, 1.0);
  vec2 dirs[N_WAVES] = vec2[N_WAVES](${WAVES.map((w) => `vec2(${w.dirX.toFixed(4)}, ${w.dirZ.toFixed(4)})`).join(', ')});
  float ks[N_WAVES] = float[N_WAVES](${WAVES.map((w) => (K(w)).toFixed(6)).join(', ')});
  float as_[N_WAVES] = float[N_WAVES](${WAVES.map((w) => (A(w)).toFixed(6)).join(', ')});
  float cph[N_WAVES] = float[N_WAVES](${WAVES.map((w) => (K(w) * C(w)).toFixed(6)).join(', ')});
  for (int i = 0; i < N_WAVES; i++) {
    float k = ks[i];
    float a = as_[i] * amp;
    float f = k * (dot(dirs[i], p) - cph[i] * uTime);
    float sf = sin(f), cf = cos(f);
    disp += vec3(dirs[i].x * a * cf, a * sf, dirs[i].y * a * cf);
    tang += vec3(-dirs[i].x * dirs[i].x * (k * a * sf), dirs[i].x * (k * a * cf), -dirs[i].x * dirs[i].y * (k * a * sf));
    bino += vec3(-dirs[i].y * dirs[i].x * (k * a * sf), dirs[i].y * (k * a * cf), -dirs[i].y * dirs[i].y * (k * a * sf));
  }
  normal = normalize(cross(bino, tang));
}
`;
}
