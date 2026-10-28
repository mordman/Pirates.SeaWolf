import * as THREE from 'three';

// ============================================================
// Частицы: брызги, дым, всплески, огонь, кровь.
// Два пула точечных спрайтов:
//   обычный блендинг — брызги/дым/кровь (клубы с вращением)
//   аддитивный       — огонь (полупрозрачное свечение)
// Спрайты — НЕ круги: canvas-текстура из наложенных клубов
// с «выкушенными» рваными краями, каждый повёртывается и
// вращается вокруг своей оси → живой, полупрозрачный дым.
//
// ⚠ Урок (Task 10): BufferAttribute НЕ должен алиаситься на
// счётчик жизни — запись дроби life/life0 в этот же массив
// взрывала счётчик экспоненциально (vLife→∞) → гигантские
// ЧЁРНЫЕ непрозрачные пятна. Дробь живёт в ОТДЕЛЬНОМ массиве.
//
// Размер спрайта задаётся В МЕТРАХ (мировой диаметр клуба):
// gl_PointSize = size·uScale/дистанция, uScale зависит от
// высоты буфера и fov → одинаково на любых разрешениях.
// ============================================================
export type PKind = 0 | 1 | 2 | 3; // 0=брызги, 1=дым, 2=огонь, 3=кровь

/** Настройки эффектов дыма/огня (применяются на лету) */
export interface FxParams {
  smokeVisible: boolean;   // видимость дыма (и огня выстрелов)
  smokeSize: number;       // × размер клубов
  smokeDensity: number;    // × количество клубов (0..2)
  smokeAlpha: number;      // пиковая непрозрачность клуба (0.03..0.55)
}

const DEFAULT_FX: FxParams = { smokeVisible: true, smokeSize: 1, smokeDensity: 1, smokeAlpha: 0.3 };

const VERT = /* glsl */`
  attribute float aLifeFrac;
  attribute float aSize;
  attribute float aKind;
  attribute float aRot;
  uniform float uScale;      // пиксели буфера на метр на дистанции 1
  varying float vLife;
  varying float vKind;
  varying float vRot;
  void main() {
    vLife = aLifeFrac;
    vKind = aKind;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // дым растёт и тает, брызги/кровь сжимаются, огонь вспыхивает и гаснет
    float grow = aKind < 0.5 ? mix(1.3, 0.55, aLifeFrac)
              : aKind < 1.5 ? mix(0.6, 1.9, aLifeFrac)
              : aKind < 2.5 ? mix(1.3, 0.55, aLifeFrac)
              : mix(1.4, 0.5, aLifeFrac);
    gl_PointSize = aSize * grow * uScale / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uTex;
  uniform float uSmokeGain;  // непрозрачность дыма (0 = скрыт)
  uniform float uFireGain;   // масштаб огня выстрелов
  varying float vLife;
  varying float vKind;
  varying float vRot;
  void main() {
    // поворот спрайта: каждый клуб лежит под своим углом
    vec2 pc = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    pc = vec2(pc.x * cs - pc.y * sn, pc.x * sn + pc.y * cs) + 0.5;
    vec4 t = texture2D(uTex, pc);
    float a = 0.0;
    vec3 col = vec3(1.0);
    if (vKind < 0.5) {
      // брызги
      col = vec3(0.93, 0.97, 1.0);
      a = t.a * pow(vLife, 0.55) * 0.95;
    } else if (vKind < 1.5) {
      // дым: светлые пороховые клубы, чуть плотнее к ядру;
      // рассеиваясь — светлеют и тают
      float dens = t.a;
      col = mix(vec3(0.99, 0.99, 1.0), vec3(0.74, 0.73, 0.72), clamp(dens * 1.05, 0.0, 1.0));
      col = mix(col, vec3(0.995, 0.995, 1.0), (1.0 - vLife) * 0.4);
      a = dens * smoothstep(0.0, 0.08, vLife) * pow(vLife, 0.9) * uSmokeGain;
    } else if (vKind < 2.5) {
      // огонь: аддитивное свечение, горячее ядро -> алое
      float r = length(pc - 0.5);
      col = mix(vec3(1.0, 0.87, 0.5), vec3(1.0, 0.27, 0.04), smoothstep(0.08, 0.42, r));
      col *= 0.7 + 0.55 * t.a;
      a = t.a * pow(vLife, 0.65) * 0.9 * uFireGain;
    } else {
      // кровь
      col = mix(vec3(0.30, 0.012, 0.008), vec3(0.58, 0.06, 0.03), t.a);
      a = t.a * pow(vLife, 0.6) * 0.95;
    }
    if (a < 0.008) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
  }
`;

/** Пул частиц на Points с вращающимися спрайтами */
class ParticlePool {
  points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private life0: Float32Array;
  /** ОТДЕЛЬНЫЙ массив дроби жизни (аLifeFrac) — не алиасится на life! */
  private frac: Float32Array;
  private size: Float32Array;
  private kind: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private aPos: THREE.BufferAttribute;
  private aLife: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aKind: THREE.BufferAttribute;
  private aRot: THREE.BufferAttribute;
  private cursor = 0;
  private alive = 0;

  constructor(max: number, tex: THREE.Texture, blending: THREE.Blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.frac = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aLife = new THREE.BufferAttribute(this.frac, 1); // отдельный массив!
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aKind = new THREE.BufferAttribute(this.kind, 1);
    this.aRot = new THREE.BufferAttribute(this.rot, 1);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aLifeFrac', this.aLife);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aKind', this.aKind);
    g.setAttribute('aRot', this.aRot);
    g.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uScale: { value: 800 },
        uSmokeGain: { value: 0.3 },
        uFireGain: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Метры → пиксели: высота буфера / (2·tan(fov/2)) на дистанции 1 */
  setScale(pxPerMeter: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = pxPerMeter;
  }

  setGain(smoke: number, fire: number) {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms;
    u.uSmokeGain.value = smoke;
    u.uFireGain.value = fire;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    lifetime: number, size: number, kind: PKind, drag: number, gravity: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = lifetime; this.life0[i] = lifetime;
    this.frac[i] = 1;
    this.size[i] = size;
    this.kind[i] = kind;
    this.drag[i] = drag; this.grav[i] = gravity;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * (kind === 1 ? 1.1 : kind === 2 ? 6 : 3.5);
    if (i >= this.alive) this.alive = i + 1;
  }

  update(dt: number, windX: number, windZ: number) {
    let any = false;
    for (let i = 0; i < this.alive; i++) {
      if (this.life[i] <= 0) { if (this.frac[i] !== 0) { this.frac[i] = 0; any = true; } continue; }
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.frac[i] = 0; continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // дым относит ветром
      if (this.kind[i] === 1) {
        this.pos[i3] += windX * dt * 0.45;
        this.pos[i3 + 2] += windZ * dt * 0.45;
      }
      if (this.kind[i] === 0 && this.pos[i3 + 1] < 0.05) { // брызги падают в воду
        this.pos[i3 + 1] = 0.02;
        this.vel[i3] *= 0.3; this.vel[i3 + 1] = 0; this.vel[i3 + 2] *= 0.3;
        this.life[i] = Math.min(this.life[i], 0.25);
      }
      this.rot[i] += this.spin[i] * dt;
      this.frac[i] = this.life[i] / this.life0[i];
      this.aRot.array[i] = this.rot[i];
    }
    if (any) {
      this.aPos.needsUpdate = true;
      this.aLife.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aKind.needsUpdate = true;
      this.aRot.needsUpdate = true;
      this.points.geometry.setDrawRange(0, this.alive);
    }
  }
}

export class Particles {
  /** обычный блендинг: брызги/дым/кровь */
  points: THREE.Points;
  /** аддитивный огонь: полупрозрачное свечение */
  firePoints: THREE.Points;
  private poolN: ParticlePool;
  private poolF: ParticlePool;
  private fx: FxParams = { ...DEFAULT_FX };
  /** ветер (м/с, XZ) — относит дым */
  windX = 0;
  windZ = 0;

  constructor(max = 1200) {
    this.poolN = new ParticlePool(max, makeSmokeTexture(), THREE.NormalBlending);
    this.poolF = new ParticlePool(Math.max(120, Math.round(max * 0.3)), makeFireTexture(), THREE.AdditiveBlending);
    this.points = this.poolN.points;
    this.firePoints = this.poolF.points;
    this.applyFx(this.fx);
  }

  /** Применить настройки дыма/огня на лету */
  applyFx(fx: FxParams) {
    this.fx = { ...fx };
    const smoke = fx.smokeVisible ? fx.smokeAlpha : 0;
    const fire = fx.smokeVisible ? Math.min(1, 0.4 + fx.smokeSize * 0.4) : 0;
    this.poolN.setGain(smoke, fire);
    this.poolF.setGain(smoke, fire);
  }

  /** пикселей на метр (высота буфера / 2·tan(fov/2)) — при ресайзе */
  setScale(pxPerMeter: number) {
    this.poolN.setScale(pxPerMeter);
    this.poolF.setScale(pxPerMeter);
  }

  /** Ветер в XZ (м/с) — дым относит */
  setWind(fromRad: number, speed: number) {
    this.windX = -Math.cos(fromRad) * speed;
    this.windZ = -Math.sin(fromRad) * speed;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    lifetime: number, size: number, kind: PKind, drag = 0.5, gravity = 9.81) {
    (kind === 2 ? this.poolF : this.poolN)
      .spawn(x, y, z, vx, vy, vz, lifetime, size, kind, drag, gravity);
  }

  /** Всплеск воды: корона + брызги */
  splash(x: number, y: number, z: number, power = 1) {
    const n = Math.floor(6 + power * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.2 * power;
      this.spawn(x, y + 0.2, z,
        Math.cos(a) * r, 3 + Math.random() * 5 * power, Math.sin(a) * r,
        0.6 + Math.random() * 0.5, 0.3 + Math.random() * 0.35, 0, 0.4, 12);
    }
  }

  /** Дым (выстрел/пожар) — клуб, растущий и тающий.
   *  Настройки: размер ×smokeSize, количество по плотности
   *  (probability-гейт: при density>1 доп. клуб). */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size = 1.1, lifetime = 1.2) {
    if (!this.fx.smokeVisible || this.fx.smokeDensity <= 0.01) return;
    const s = size * this.fx.smokeSize;
    this.spawn(x, y, z, vx, vy, vz, lifetime, s, 1, 1.6, -0.6);
    // плотность > 1: вероятностный дополнительный клуб
    if (this.fx.smokeDensity > 1 && Math.random() < this.fx.smokeDensity - 1) {
      this.spawn(x + (Math.random() - 0.5) * s, y + Math.random() * 0.4, z + (Math.random() - 0.5) * s,
        vx * 0.7, vy * 0.8, vz * 0.7, lifetime * 0.85, s * 0.8, 1, 1.6, -0.6);
    }
  }

  /** Вернуть «эффективное» количество клубов (для гейта в бою) */
  get smokeDensity(): number { return this.fx.smokeDensity; }
  get smokeOn(): boolean { return this.fx.smokeVisible; }

  /** Огонь — аддитивное свечение */
  fire(x: number, y: number, z: number) {
    if (!this.fx.smokeVisible) return;
    this.spawn(x, y, z, (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6,
      0.4 + Math.random() * 0.35, (0.5 + Math.random() * 0.6) * this.fx.smokeSize, 2, 0.8, -2.0);
  }

  /** Кровь: веер тёмно-красных капель (n — количество, power — разлёт) */
  blood(x: number, y: number, z: number, vx: number, vy: number, vz: number, n = 10, power = 1) {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y + 0.5 + Math.random() * 0.9, z,
        vx + (Math.random() - 0.5) * 5 * power,
        vy + 0.5 + Math.random() * 3.5 * power,
        vz + (Math.random() - 0.5) * 5 * power,
        0.5 + Math.random() * 0.45, 0.25 + Math.random() * 0.25, 3, 0.7, 11);
    }
  }

  update(dt: number) {
    this.poolN.update(dt, this.windX, this.windZ);
    this.poolF.update(dt, this.windX, this.windZ);
  }
}

/** Текстура дымного клубка: наложенные градиенты-«клубы» +
 *  мягкое ядро + слегка рваные края — НЕ идеальный круг */
function makeSmokeTexture(): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  let rs = 987654321;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  // масса клубка из наложенных пузырей (больше — мягче переходы)
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, off = rnd() * 21;
    const gx = S / 2 + Math.cos(a) * off, gy = S / 2 + Math.sin(a) * off;
    const gr = 22 + rnd() * 27;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(255,255,255,0.26)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
  }
  // мягкое ядро
  const g0 = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 42);
  g0.addColorStop(0, 'rgba(255,255,255,0.42)');
  g0.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g0.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g0;
  x.fillRect(0, 0, S, S);
  // рваные края: мягко выкусываем кромку (менее агрессивно — дым мягкий)
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2, off = 30 + rnd() * 22;
    const gx = S / 2 + Math.cos(a) * off, gy = S / 2 + Math.sin(a) * off;
    const gr = 9 + rnd() * 14;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** Текстура огня: горячее ядро с языками по кромке */
function makeFireTexture(): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  let rs = 123456789;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, off = rnd() * 13;
    const gx = S / 2 + Math.cos(a) * off, gy = S / 2 + Math.sin(a) * off;
    const gr = 9 + rnd() * 18;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
  }
  const g0 = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 30);
  g0.addColorStop(0, 'rgba(255,255,255,0.9)');
  g0.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  g0.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g0;
  x.fillRect(0, 0, S, S);
  // языки пламени: неровная кромка
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2, off = 22 + rnd() * 16;
    const gx = S / 2 + Math.cos(a) * off, gy = S / 2 + Math.sin(a) * off;
    const gr = 6 + rnd() * 11;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
  }
  return new THREE.CanvasTexture(c);
}
