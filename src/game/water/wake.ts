import * as THREE from 'three';
import { gerstnerGLSL, SEA, waveUniformData, seaAmpLoHi } from './waves';

// ============================================================
// Кильватерный след + пена по ватерлинии (без «линии разреза»):
//  - WakeTrail: лента пенной дорожки за кормой (турбулентный след)
//  - WaterlineFoam: пенный «воротник» вокруг корпуса, повторяющий
//    контур ватерлинии, с шумом и усилением от скорости (носовой бурун)
// ============================================================

export class WakeTrail {
  mesh: THREE.Mesh;
  private maxPts = 90;
  private pts: THREE.Vector3[] = [];
  private times: number[] = [];
  private widths: number[] = [];
  private alphas: number[] = [];
  private geometry: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private lifetime = 16;
  // параметры ленты (масштабируются под судно: корабль vs шлюпка)
  private spacing = 3.0;      // шаг точек по дистанции, м
  private width0 = 0.5;       // полуширина дорожки на стоянке
  private widthSpd = 0.9;     // прибавка на полном ходу
  private alpha0 = 0.18;
  private alphaSpd = 0.62;
  private yOff = 0.14;        // подъём ленты над водой (пена толщиной)
  private widen = 4.5;        // расширение клина со временем
  private waterHeight: (x: number, z: number, t: number) => number = () => 0;

  /** Настройка ленты под размер судна (Task 26: след от ШЛЮПКИ —
   *  узкая короткая дорожка пены за транцем яла, корабль — широкая) */
  constructor(opts?: {
    spacing?: number; lifetime?: number; maxPts?: number;
    width0?: number; widthSpd?: number; alpha0?: number; alphaSpd?: number;
    yOff?: number; widen?: number;
  }) {
    if (opts) {
      if (opts.spacing !== undefined) this.spacing = opts.spacing;
      if (opts.lifetime !== undefined) this.lifetime = opts.lifetime;
      if (opts.maxPts !== undefined) this.maxPts = opts.maxPts;
      if (opts.width0 !== undefined) this.width0 = opts.width0;
      if (opts.widthSpd !== undefined) this.widthSpd = opts.widthSpd;
      if (opts.alpha0 !== undefined) this.alpha0 = opts.alpha0;
      if (opts.alphaSpd !== undefined) this.alphaSpd = opts.alphaSpd;
      if (opts.yOff !== undefined) this.yOff = opts.yOff;
      if (opts.widen !== undefined) this.widen = opts.widen;
    }
    this.geometry = new THREE.BufferGeometry();
    const verts = (this.maxPts) * 2;
    this.posAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(verts), 1);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    // индексы перестраиваются в update
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aAlpha;
        varying float vA;
        varying vec2 vXZ;
        void main() {
          vA = aAlpha;
          vXZ = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vA;
        varying vec2 vXZ;
        uniform float uTime;
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p*=2.1; a*=0.5; } return s; }
        void main() {
          float n = fbm(vXZ * 0.7 + uTime * 0.22);
          float n2 = fbm(vXZ * 0.25 - uTime * 0.06);
          float foam = smoothstep(0.25, 0.75, n * 0.65 + n2 * 0.55);
          float a = vA * (0.35 + 0.65 * foam);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.94, 0.97, 0.99), a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Функция высоты волны — чтобы лента лежала НА воде, а не под ней */
  setWaterHeight(fn: (x: number, z: number, t: number) => number) {
    this.waterHeight = fn;
  }

  /** Добавить точку следа (мировые координаты) */
  push(p: THREE.Vector3, speedFrac: number, dt: number, accumulate: number) {
    const last = this.pts[this.pts.length - 1];
    if (!last || last.distanceTo(p) > this.spacing) {
      this.pts.push(p.clone());
      this.times.push(accumulate);
      this.widths.push(this.width0 + speedFrac * this.widthSpd); // ширина дорожки от скорости
      this.alphas.push(Math.min(1, this.alpha0 + speedFrac * this.alphaSpd));
      if (this.pts.length > this.maxPts) {
        this.pts.shift(); this.times.shift(); this.widths.shift(); this.alphas.shift();
      }
    }
    this.mat.uniforms.uTime.value = accumulate;
  }

  /** число живых точек ленты (телеметрия/E2E) */
  count(): number { return this.pts.length; }

  update(now: number) {
    // убрать старые точки
    while (this.pts.length && now - this.times[0] > this.lifetime) {
      this.pts.shift(); this.times.shift(); this.widths.shift(); this.alphas.shift();
    }
    const n = this.pts.length;
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const pos = this.posAttr.array as Float32Array;
    const al = this.alphaAttr.array as Float32Array;
    const side = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const prev = this.pts[Math.max(0, i - 1)];
      const next = this.pts[Math.min(n - 1, i + 1)];
      side.subVectors(next, prev).normalize();
      const tx = -side.z, tz = side.x;
      const age = (now - this.times[i]) / this.lifetime;
      // расширение дорожки со временем (турбулентный клин)
      const w = this.widths[i] * (1 + age * this.widen);
      const fade = (1 - age) * this.alphas[i];
      // высота волны в точке — лента лежит на поверхности
      const wy = this.waterHeight(p.x, p.z, now) + this.yOff;
      const i6 = i * 6;
      pos[i6] = p.x - tx * w; pos[i6 + 1] = wy; pos[i6 + 2] = p.z - tz * w;
      pos[i6 + 3] = p.x + tx * w; pos[i6 + 4] = wy; pos[i6 + 5] = p.z + tz * w;
      al[i * 2] = fade; al[i * 2 + 1] = fade;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    // индексы
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geometry.setIndex(idx);
    this.geometry.setDrawRange(0, idx.length);
  }

  /** Сдвиг при floating origin */
  shiftWorld(delta: THREE.Vector3) {
    for (const p of this.pts) p.add(delta);
  }

  clear() {
    this.pts.length = 0; this.times.length = 0; this.widths.length = 0; this.alphas.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}

/** Пенный воротник вокруг корпуса: контур ватерлинии из набора точек.
 *  Кольцо ЛЕЖИТ НА ВОЛНАХ: в вершинном шейдере — тот же Gerstner, что
 *  и у океана (высота в мировой точке), поэтому на гребне воротник
 *  поднимается вместе с водой, а в ложбине опускается — без «белой
 *  полосы», повисшей в воздухе у борта (жалоба VLM-проверки).
 *  opts.width — ширина пенной кромки (корабль 2.6 м, ял ~0.5 м);
 *  opts.size — характерная длина корпуса для нормировки носового
 *  буруна (пороговые константы шейдера — в масштабе корабля). */
export class WaterlineFoam {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private outline: THREE.Vector2[];

  constructor(outline: THREE.Vector2[], opts?: { width?: number; size?: number }) {
    this.outline = outline;
    const width = Math.max(0.15, opts?.width ?? 2.6);
    const size = Math.max(4, opts?.size ?? 38);
    // Строим кольцо: внутренний радиус = контур корпуса (масштаб 1), внешний = контур + width
    const N = outline.length;
    const verts = N * 2 + 2;
    const pos = new Float32Array(verts * 3);
    const inner = new Float32Array(verts);
    const idx: number[] = [];
    // центроид
    let cx = 0, cy = 0;
    for (const p of outline) { cx += p.x; cy += p.y; }
    cx /= N; cy /= N;
    for (let i = 0; i <= N; i++) {
      const p = outline[i % N];
      const nx = (p.x - cx), ny = (p.y - cy);
      const len = Math.hypot(nx, ny) || 1;
      const ox = nx / len, oy = ny / len;
      pos[i * 6] = p.x; pos[i * 6 + 2] = p.y;
      pos[i * 6 + 3] = p.x + ox * width; pos[i * 6 + 4] = 0; pos[i * 6 + 5] = p.y + oy * width;
      inner[i * 2] = 1; inner[i * 2 + 1] = 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aInner', new THREE.BufferAttribute(inner, 1));
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0 },      // 0..1 доля скорости
        uRoll: { value: 0 },
        uSize: { value: size },    // характерная длина корпуса (нормировка буруна)
        uAmp: { value: SEA.amplitude },   // погода (высота волн)
        uAmpLo: { value: SEA.amplitude }, // погодные множители (Task 27)
        uAmpHi: { value: SEA.amplitude },
        uWaveA: { value: waveUniformData().wa.map((v) => new THREE.Vector4(...v)) },
        uWaveB: { value: waveUniformData().wb.map((v) => new THREE.Vector4(...v)) },
        uShift: { value: new THREE.Vector3() }, // floating origin: сцена -> мир
      },
      vertexShader: /* glsl */`
        attribute float aInner;
        varying float vInner;
        varying vec2 vXY;
        ${gerstnerGLSL()}
        // uTime и uAmp объявлены внутри gerstnerGLSL()
        uniform vec3 uShift;
        void main() {
          vInner = aInner;
          vXY = position.xz;
          // мировая точка кольца: сцена + uShift (как у океана)
          vec3 sceneP = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 worldXZ = sceneP.xz + uShift.xz;
          vec3 disp; vec3 nrm;
          gerstner(worldXZ, uAmpLo, uAmpHi, disp, nrm);
          // кольцо следует высоте волны (без горизонтального сдвига —
          // контур привязан к корпусу)
          vec3 p = sceneP + vec3(0.0, disp.y, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vInner;
        varying vec2 vXY;
        uniform float uTime, uSpeed, uRoll, uSize;
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p*=2.2; a*=0.5; } return s; }
        void main() {
          float band = 1.0 - vInner; // 0 у корпуса, 1 снаружи
          // ОСИ: vXY.y — ВДОЛЬ корпуса (+ = нос), vXY.x — поперёк (борт).
          // (старый шейдер считал носом vXY.x и подсвечивал мидель —
          //  получалась сплошная одинаковая полоса вдоль всего борта)
          // uSize нормирует масштаб: константы заданы для корабля ~38 м,
          // у шлюпки (6 м) носовой бурун сжимается к форштевню
          float lon = vXY.y * (38.0 / uSize);
          // (1) крупная пятнистость ВДОЛЬ корпуса: пенные секции чередуются
          //     с «дырами» — воротник не сплошной
          float lane = fbm(vec2(lon * 0.24, vXY.x * 0.4) + vec2(uTime * 0.10, -uTime * 0.06));
          float laneM = 0.30 + 0.90 * smoothstep(0.28, 0.72, lane);
          // (2) рваная кромка — два масштаба с разными скоростями
          float n1 = fbm(vXY * (38.0 / uSize) * 1.6 + vec2(uTime * 0.7, uTime * -0.5));
          float n2 = fbm(vXY * (38.0 / uSize) * 0.5 - vec2(uTime * 0.25, uTime * 0.18) + 7.3);
          // (3) нос: бурун сильнее и РАСХОДИТСЯ клином на ходу; корма тише
          float bowNear = smoothstep(-2.0, 12.0, lon);
          float bowSpread = uSpeed * 1.3 * bowNear;          // шире у носа
          float bowGlow = 0.7 + 0.6 * bowNear * uSpeed;      // ярче у носа
          float sternFade = mix(0.45, 1.0, smoothstep(-15.0, 2.0, lon));
          // (4) кромка: изнутри пена прижата к борту, снаружи сходит на нет
          float edgeIn = 0.10 + n2 * 0.30;
          float edgeOut = 0.85 + n1 * 0.35 + bowSpread;
          float edge = smoothstep(edgeOut, edgeIn, band);
          // (5) интенсивность: скорость + пятнистость + нос/корма
          float a = edge * (0.16 + uSpeed * 0.85) * laneM * sternFade * bowGlow;
          a *= 0.85 + 0.15 * sin(uTime * 8.0 + lon * 2.2 + n1 * 4.0);
          a *= 0.75 + 0.5 * n1; // пузырьковая фактура
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.93, 0.97, 0.99), clamp(a, 0.0, 0.95));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 3;
  }

  update(time: number, speedFrac: number, roll: number, shift?: THREE.Vector3) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uSpeed.value = speedFrac;
    this.mat.uniforms.uRoll.value = roll;
    this.mat.uniforms.uAmp.value = SEA.amplitude;
    // волны активной модели моря (Task 27) — значения uniform'ов
    const wu = waveUniformData();
    const wa = this.mat.uniforms.uWaveA.value as THREE.Vector4[];
    const wb = this.mat.uniforms.uWaveB.value as THREE.Vector4[];
    for (let i = 0; i < wa.length; i++) {
      wa[i].set(wu.wa[i][0], wu.wa[i][1], wu.wa[i][2], wu.wa[i][3]);
      wb[i].set(wu.wb[i][0], wu.wb[i][1], wu.wb[i][2], wu.wb[i][3]);
    }
    const amp = seaAmpLoHi();
    this.mat.uniforms.uAmpLo.value = amp.lo;
    this.mat.uniforms.uAmpHi.value = amp.hi;
    if (shift) (this.mat.uniforms.uShift.value as THREE.Vector3).copy(shift);
  }
}
