/* ============================================================
   sea.js — автономный модуль штормового моря (волны Герстнера)
   GPU-рендер + идентичный CPU-расчёт высоты для физики судов.

   Модуль игрока (Task 29). Адаптация к игре «Морские волки»:
   • floating origin: uSceneShift переводит мировые координаты
     волн в координаты сцены (мир = сцена − worldGroup.position);
   • ОБЩИЙ ветер из настроек погоды: setWind(v01) — сила (амплитуды
     растут нелинейно, как в модуле), setWindDir(from) — весь спектр
     поворачивается за направлением ветра (плавно, без щелчков);
   • окружение (солнце/небо/туман/день-ночь) — из глобального неба
     через setEnvironment();
   • все параметры (высота/длина волн, пена, сетки) — в настройках.

   API: new SeaModule(scene, opts) → setWind(v) / setWindDir(from)
        / heightAt(x,z,t) / update(t, shipState, sceneShift)
        / configure(...) / dispose()
============================================================ */
import * as THREE from 'three';

const G = 9.81;

/* Базовый спектр: 3 штормовые зыби (phys:1 — участвуют в физике)
   + 3 ветровые микряби (phys:0 — только визуал) */
export interface SeaWaveDef {
  dx: number; dz: number; len: number; st: number; phys: 0 | 1; phase: number;
}

export const DEFAULT_WAVES: SeaWaveDef[] = [
  { dx: 1.00, dz: 0.25, len: 118.0, st: 0.180, phys: 1, phase: 0.0 },
  { dx: -0.72, dz: 1.00, len: 64.0, st: 0.150, phys: 1, phase: 1.7 },
  { dx: 0.35, dz: -0.94, len: 38.0, st: 0.120, phys: 1, phase: 4.1 },
  { dx: 0.90, dz: -0.40, len: 15.0, st: 0.110, phys: 0, phase: 0.5 },
  { dx: -0.30, dz: -0.95, len: 8.5, st: 0.090, phys: 0, phase: 2.6 },
  { dx: 0.60, dz: 0.75, len: 4.8, st: 0.070, phys: 0, phase: 5.2 },
];

/** одна волна спектра: направление хранится базовым углом
 *  (offset от оси ветра) + текущим поворотом всего спектра */
interface StormWave {
  baseAng: number;    // угол волны в спектре (рад)
  d: THREE.Vector2;   // текущее направление (baseAng + rot)
  len0: number;       // длина волны из спектра, м
  st: number;         // крутизна
  k: number;          // волновое число
  A0: number;         // амплитуда без погоды
  A: number;          // текущая амплитуда
  c: number;          // фазовая скорость
  phys: boolean;      // участвует в физике
  phase: number;
}

/** состояние судна для пены в шейдере (uS0/uS1) */
export interface SeaShipState {
  x: number; z: number;      // мировая позиция
  fx: number; fz: number;    // единичный вектор курса (нос)
  speed: number;             // 0..1 — нормированный ход
  beam: number; len: number; // габариты, м
  flood?: number;            // импульс заливания палубы 0..1
}

export interface SeaModuleOpts {
  wind?: number;
  waves?: SeaWaveDef[];
  sunDir?: THREE.Vector3;
  fogColor?: number;
  fogDensity?: number;
  deep?: number;
  shallow?: number;
  skyReflect?: number;
  farSize?: number;
  farSeg?: number;
  nearSize?: number;
  nearSeg?: number;
  foam?: number;        // множитель пены/барашков
  heightScale?: number; // множитель крутизны (высоты) волн
  lenScale?: number;    // множитель длин волн
}

const VERT = (NW: number) => `
uniform float uTime;
uniform vec2  uOffset;
uniform vec2  uSceneShift;  // мир -> сцена (floating origin)
uniform vec4  uWA[${NW}];   // dir.x, dir.y, k, A
uniform vec4  uWB[${NW}];   // c, A, phase, microFlag
varying vec3  vW; varying vec3 vS; varying vec3 vN; varying float vC;
#ifdef HAS_MICRO
float mf(vec2 p){ return smoothstep(118.,82.,length(p)); }
#endif
void main(){
  vec2 xz = position.xz + uOffset;
  vec2 d2 = vec2(0.0);
  float h=0.0, nx=0.0, nz=0.0, cr=0.0;
  for(int i=0;i<${NW};i++){
    vec2  dr = uWA[i].xy;
    float k  = uWA[i].z;
    float A  = uWA[i].w;
    float ph = uWB[i].z;
    #ifdef HAS_MICRO
      A *= mix(1.0, mf(position.xz), uWB[i].w);
    #endif
    float f = k*dot(dr,xz) - k*uWB[i].x*uTime + ph;
    float s = sin(f), c = cos(f);
    d2  += dr*(A*c);
    h   += A*s;
    nx  -= dr.x*k*A*c;
    nz  -= dr.y*k*A*c;
    cr  += k*A*s;
  }
  vec3 wp = vec3(xz.x+d2.x, h, xz.y+d2.y);
  vW = wp;                                   // мир — для пены/высот
  vS = vec3(wp.x+uSceneShift.x, wp.y, wp.z+uSceneShift.y); // сцена
  vN = normalize(vec3(nx, 1.0-cr, nz));
  vC = cr;
  gl_Position = projectionMatrix * viewMatrix * vec4(vS,1.0);
}`;

const FRAG = `
uniform vec3  uSunDir, uDeep, uShal, uSkyC, uFogC;
uniform float uFogD, uTime, uWind, uFoam;
uniform vec4  uS0;   // x, z, fwd.x, fwd.z
uniform vec4  uS1;   // speedNorm, beam, length, floodPulse
varying vec3  vW; varying vec3 vS; varying vec3 vN; varying float vC;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float nse(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x),
             mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec3 N = normalize(vN);
  vec2 np = vW.xz*0.55 + uTime*vec2(0.35,-0.22);
  N.xz += (vec2(nse(np), nse(np+37.0))-0.5)*(0.08+0.14*uWind);
  N = normalize(N);
  vec3 V = normalize(cameraPosition - vS);
  float fr = pow(1.0-max(dot(N,V),0.0), 3.0);
  float hg = clamp(vW.y*0.10+0.45, 0.0, 1.0);
  vec3 col = mix(uDeep, uShal, hg*0.7 + vC*0.22);
  col = mix(col, uSkyC, fr*0.75);
  vec3 H = normalize(V + uSunDir);
  col += pow(max(dot(N,H),0.0), 240.0)*1.2*vec3(1.0,0.93,0.82);
  col *= 0.72 + 0.38*max(dot(N,uSunDir),0.0);

  /* барашки на гребнях — только при ветре */
  float n1 = nse(vW.xz*0.22 + uTime*0.35);
  /* порог калиброван под спектр: ΣkA на гребне ≈ 0.45 при
     wind=1 (A0=st/k родного набора) — с порогом 0.50 из
     исходника барашки не срабатывали никогда; 0.34..0.62
     дают редкие барашки в бриз и сплошные в шторм */
  float wf = smoothstep(0.34,0.62, vC + (n1-0.5)*0.28) * smoothstep(0.12,0.55,uWind);

  /* пена: обводка корпуса, кильватер, напорная пена у форштевня */
  vec2 rel = vW.xz - uS0.xy;
  vec2 f = uS0.zw; vec2 r = vec2(f.y,-f.x);
  float al = dot(rel,f), la = dot(rel,r);
  float hL = uS1.z*0.55, bm = uS1.y;
  float hull = (1.0-smoothstep(bm*0.85, bm*0.85+1.6, abs(la)))
             *  smoothstep(hL+2.5, hL*0.5, abs(al));
  float bh = max(-al-hL*0.35, 0.0);
  float sp = bm*0.9 + bh*0.25;
  float wk = (1.0-smoothstep(sp*0.5, sp, abs(la)))
           * smoothstep(hL+2.0, hL*0.1, al)
           * exp(-bh*0.03) * (0.3+0.7*clamp(uS1.x,0.0,1.0));
  float bp = (1.0-smoothstep(1.2,4.5,abs(la)))
           * smoothstep(3.0,0.0,abs(al-hL)) * clamp(uS1.x*1.7,0.0,1.0);
  float fm = clamp(wf + hull*0.95 + wk*0.95 + bp*0.9, 0.0, 1.0);
  fm *= 0.5 + 0.65*(nse(vW.xz*1.7-uTime*1.2)*0.5 + nse(vW.xz*4.0+uTime*0.8)*0.5);
  fm = clamp(fm * uFoam, 0.0, 1.0);
  col = mix(col, vec3(0.82,0.90,0.92)*(0.6+0.5*max(dot(N,uSunDir),0.0)), clamp(fm,0.0,1.0));

  float ff = 1.0 - exp(-pow(distance(cameraPosition,vS)*uFogD, 2.0));
  col = mix(col, uFogC, ff);
  gl_FragColor = vec4(col, 1.0);
}`;

export class SeaModule {
  group = new THREE.Group();     // обе сетки — здесь (видимость целиком)
  wind = 0.6;                    // 0..1 — сила ветра (из общих настроек)
  rot = 0;                       // текущий поворот спектра за ветром, рад
  private rotTarget = 0;

  /* --- спектр --- */
  waves: StormWave[] = [];
  private PHYS: StormWave[] = [];
  private WAVE_A: THREE.Vector4[] = [];
  private WAVE_B: THREE.Vector4[] = [];

  private far!: THREE.Mesh;
  private near!: THREE.Mesh;
  private farSeg = 256;
  private nearSeg = 256;
  private farSize = 5200;
  private nearSize = 300;

  private heightScale = 1;   // настройка «высота волн»
  private lenScale = 1;      // настройка «длина волн»

  /* --- общие uniform'ы --- */
  private windU: { value: number };
  private foamU: { value: number };
  private shipU0 = { value: new THREE.Vector4() };
  private shipU1 = { value: new THREE.Vector4() };
  private sunU: { value: THREE.Vector3 };
  private deepU: { value: THREE.Color };
  private shalU: { value: THREE.Color };
  private skyU: { value: THREE.Color };
  private fogCU: { value: THREE.Color };
  private fogDU: { value: number };

  private _d = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: SeaModuleOpts = {}) {
    this.wind = opts.wind ?? 0.6;
    this.heightScale = opts.heightScale ?? 1;
    this.lenScale = opts.lenScale ?? 1;
    this.foamU = { value: opts.foam ?? 1 };
    this.windU = { value: this.wind };

    this.buildSpectrum(opts.waves || DEFAULT_WAVES);

    const sunDir = (opts.sunDir || new THREE.Vector3(-0.62, 0.42, -0.67)).clone().normalize();
    this.sunU = { value: sunDir };
    this.deepU = { value: new THREE.Color(opts.deep ?? 0x07222e) };
    this.shalU = { value: new THREE.Color(opts.shallow ?? 0x1d6b6e) };
    this.skyU = { value: new THREE.Color(opts.skyReflect ?? 0xaebfc6) };
    this.fogCU = { value: new THREE.Color(opts.fogColor ?? 0x9fb0b5) };
    this.fogDU = { value: opts.fogDensity ?? 0.0013 };

    const mkMat = (micro: boolean) => new THREE.ShaderMaterial({
      defines: micro ? { HAS_MICRO: '' } : {},
      uniforms: {
        uTime: { value: 0 },
        uOffset: { value: new THREE.Vector2() },
        uSceneShift: { value: new THREE.Vector2() },
        uWA: { value: this.WAVE_A },
        uWB: { value: this.WAVE_B },
        uWind: this.windU,
        uFoam: this.foamU,
        uSunDir: this.sunU,
        uDeep: this.deepU,
        uShal: this.shalU,
        uSkyC: this.skyU,
        uFogC: this.fogCU,
        uFogD: this.fogDU,
        uS0: this.shipU0,
        uS1: this.shipU1,
      },
      vertexShader: VERT(this.waves.length),
      fragmentShader: FRAG,
    });

    const mkGrid = (size: number, seg: number, micro: boolean) => {
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mkMat(micro));
      m.frustumCulled = false;
      m.userData.cell = size / seg;
      this.group.add(m);
      return m;
    };
    this.far = mkGrid(opts.farSize ?? 5200, opts.farSeg ?? 256, false);
    this.near = mkGrid(opts.nearSize ?? 300, opts.nearSeg ?? 256, true);
    this.far.renderOrder = 0;
    this.near.renderOrder = 1;
    this.farSeg = opts.farSeg ?? 256;
    this.nearSeg = opts.nearSeg ?? 256;
    this.farSize = opts.farSize ?? 5200;
    this.nearSize = opts.nearSize ?? 300;

    scene.add(this.group);
    this.setWind(this.wind);
  }

  /* ---------- спектр: пересборка (настройки высоты/длины) ----------
     ВАЖНО: uniform-массивы uWA/uWB обоих материалов держат ссылки
     на ЭТИ массивы Vector4 — при пересборке обновляем их НА МЕСТЕ,
     иначе настройки не дошли бы до GPU */
  private buildSpectrum(defs: SeaWaveDef[]) {
    const rebuilt = defs.map((w) => {
      const baseAng = Math.atan2(w.dz, w.dx);
      const len = Math.max(3, w.len * this.lenScale);
      const k = (Math.PI * 2) / len;
      const A0 = (w.st * this.heightScale) / k;
      return {
        baseAng, d: new THREE.Vector2(w.dx, w.dz).normalize(),
        len0: w.len, st: w.st, k, A0, A: A0,
        c: Math.sqrt(G / k), phys: !!w.phys, phase: w.phase,
      } as StormWave;
    });
    const inPlace = this.WAVE_A.length === rebuilt.length;
    this.waves = rebuilt;
    this.PHYS = this.waves.filter((w) => w.phys);
    if (!inPlace) {
      this.WAVE_A = this.waves.map(() => new THREE.Vector4());
      this.WAVE_B = this.waves.map(() => new THREE.Vector4());
    }
    this.waves.forEach((w, i) => {
      const va = this.WAVE_A[i], vb = this.WAVE_B[i];
      if (!va) { this.WAVE_A[i] = new THREE.Vector4(); this.WAVE_B[i] = new THREE.Vector4(); return; }
      va.set(w.d.x, w.d.y, w.k, w.A);
      vb.set(w.c, w.A, w.phase, w.phys ? 0 : 1);
    });
  }

  /** Настройки модуля из панели (высота/длина волн, пена) */
  applySpectrumSettings(heightScale: number, lenScale: number, foam: number) {
    this.heightScale = heightScale;
    this.lenScale = lenScale;
    this.foamU.value = foam;
    const defs = this.waves.map((w, i) => ({
      dx: Math.cos(w.baseAng), dz: Math.sin(w.baseAng),
      len: DEFAULT_WAVES[i]?.len ?? w.len0, st: w.st,
      phys: (w.phys ? 1 : 0) as 0 | 1, phase: w.phase,
    }));
    this.buildSpectrum(defs);
    this.applyRot(this.rot);      // направления после пересборки
    this.setWind(this.wind);      // амплитуды под текущий ветер
  }

  /** Перестройка сеток (качество/дальность) */
  configure(farSize: number, farSeg: number, nearSize: number, nearSeg: number) {
    this.farSize = Math.max(2600, farSize);
    this.nearSize = THREE.MathUtils.clamp(nearSize, 260, 600);
    this.farSeg = THREE.MathUtils.clamp(Math.round(farSeg / 16) * 16, 96, 384);
    this.nearSeg = THREE.MathUtils.clamp(Math.round(nearSeg / 16) * 16, 96, 384);
    const rebuild = (mesh: THREE.Mesh, size: number, seg: number) => {
      mesh.geometry.dispose();
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      mesh.geometry = g;
      mesh.userData.cell = size / seg;
    };
    rebuild(this.far, this.farSize, this.farSeg);
    rebuild(this.near, this.nearSize, this.nearSeg);
  }

  /** Окружение из глобального неба: солнце, отражение неба,
   *  туман и затемнение глубины/мелководья ночью */
  setEnvironment(sunDir: THREE.Vector3, sky: THREE.Color, fogColor: THREE.Color, fogDensity: number, nightMul: number) {
    this.sunU.value.copy(sunDir).normalize();
    this.skyU.value.copy(sky);
    this.fogCU.value.copy(fogColor);
    // плотность тумана в экспоненциальной форме сцены (FogExp2):
    // шейдер считает exp(-(d*ρ)²) — передаём ρ как есть
    this.fogDU.value = fogDensity;
    this.deepU.value.setHex(0x07222e).multiplyScalar(nightMul);
    this.shalU.value.setHex(0x1d6b6e).multiplyScalar(nightMul);
  }

  /* ---------- ветер → амплитуды (GPU и CPU синхронно) ---------- */
  setWind(v: number) {
    this.wind = THREE.MathUtils.clamp(v, 0, 1);
    this.waves.forEach((w, i) => {
      const calm = w.phys ? 0.10 : 0.04;
      w.A = w.A0 * (calm + (1 - calm) * Math.pow(this.wind, w.phys ? 1.25 : 1.7));
      this.WAVE_A[i].w = w.A;
      this.WAVE_B[i].y = w.A;
    });
    this.windU.value = this.wind;
  }

  /* ---------- направление ветра → поворот спектра ----------
     Волны бегут ПО ВЕТРУ (куда дует). Спектр поворачивается
     целиком — форма сохраняется; rot плавно следует за целью,
     поэтому фазы не щёлкают. */
  setWindDir(fromRad: number) {
    // ось бега волн = куда дует ветер
    this.rotTarget = fromRad + Math.PI;
  }

  private applyRot(rot: number) {
    this.waves.forEach((w, i) => {
      const a = w.baseAng + rot;
      w.d.set(Math.cos(a), Math.sin(a));
      this.WAVE_A[i].x = w.d.x;
      this.WAVE_A[i].y = w.d.y;
    });
  }

  private stepRot(dt: number) {
    let d = this.rotTarget - this.rot;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 1e-4) { this.rot = this.rotTarget; return; }
    // плавный поворот спектра без щелчков фаз: далеко от цели —
    // быстро (до 3.5 рад/с, настройку направления ветер догоняет за
    // ~секунду), у цели — пропорционально (τ ≈ 1.2 с)
    const rate = Math.max(0.8, Math.min(3.5, Math.abs(d) * 3));
    this.rot += d * Math.min(1, rate * dt);
    this.applyRot(this.rot);
  }

  /* ---------- CPU: смещение Герстнера ---------- */
  private _eval(x: number, z: number, t: number, list: StormWave[], out: THREE.Vector3): THREE.Vector3 {
    let dx = 0, dz = 0, h = 0;
    for (const w of list) {
      const f = w.k * (w.d.x * x + w.d.y * z) - w.k * w.c * t + w.phase;
      const s = Math.sin(f), c = Math.cos(f);
      dx += w.d.x * w.A * c; dz += w.d.y * w.A * c; h += w.A * s;
    }
    return out.set(dx, h, dz);
  }

  /* ---------- CPU: высота воды в мировой точке (3 итерации инверсии) ---------- */
  heightAt(x: number, z: number, t: number): number {
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) {
      this._eval(px, pz, t, this.PHYS, this._d);
      px = x - this._d.x; pz = z - this._d.z;
    }
    return this._eval(px, pz, t, this.PHYS, this._d).y;
  }

  /** Огибающая волнения: сумма текущих амплитуд физических зыбей, м */
  envelope(): number {
    let s = 0;
    for (const w of this.PHYS) s += w.A;
    return s;
  }

  /** ТОЧНЫЕ данные волн в формате waves.ts (uWaveA/uWaveB) — без
   *  округлений, чтобы пенные воротники/кильватеры легли точно на
   *  поверхность штормового моря: wa=[dir.x,dir.z,k,A], wb=[k*c,phase,micro,0] */
  uniformDataExact(): {
    wa: [number, number, number, number][];
    wb: [number, number, number, number][];
  } {
    const wa: [number, number, number, number][] = [];
    const wb: [number, number, number, number][] = [];
    for (const w of this.waves) {
      wa.push([w.d.x, w.d.y, w.k, w.A]);
      wb.push([w.k * w.c, w.phase, w.phys ? 0 : 1, 0]);
    }
    return { wa, wb };
  }

  /** Уровень пены обводки/кильватера в шейдере (0..1) */
  get foamLevel(): number { return this.foamU.value; }

  /** Покадровое обновление. ship: {x,z,fx,fz,speed,beam,len,flood} или null;
   *  sceneShift = worldGroup.position (мир -> сцена, xz) */
  update(t: number, dt: number, ship: SeaShipState | null, sceneShift: { x: number; z: number }) {
    this.stepRot(dt);
    (this.far.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    (this.near.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    const cx = ship ? ship.x : 0, cz = ship ? ship.z : 0;
    for (const g of [this.far, this.near]) {
      const c = g.userData.cell as number;
      (g.material as THREE.ShaderMaterial).uniforms.uOffset.value.set(
        Math.round(cx / c) * c, Math.round(cz / c) * c);
      ((g.material as THREE.ShaderMaterial).uniforms.uSceneShift.value as THREE.Vector2)
        .set(sceneShift.x, sceneShift.z);
    }
    if (ship) {
      this.shipU0.value.set(ship.x, ship.z, ship.fx, ship.fz);
      this.shipU1.value.set(ship.speed, ship.beam, ship.len, ship.flood ?? 0);
    }
  }

  /** Телеметрия для E2E/диагностики */
  stats() {
    return {
      wind: +this.wind.toFixed(3),
      dirDeg: Math.round(((this.rot * 180 / Math.PI) % 360 + 360) % 360),
      envelope: +this.envelope().toFixed(3),
      foam: +this.foamU.value.toFixed(2),
      waves: this.waves.map((w) => ({
        ang: Math.round(((Math.atan2(w.d.y, w.d.x) * 180 / Math.PI) % 360 + 360) % 360),
        len: Math.round((2 * Math.PI) / w.k),
        A: +w.A.toFixed(3),
        phys: w.phys ? 1 : 0,
      })),
      grid: {
        far: { size: this.farSize, seg: this.farSeg },
        near: { size: this.nearSize, seg: this.nearSeg },
      },
      ship: {
        uS0: this.shipU0.value.toArray().map((v: number) => +v.toFixed(1)),
        uS1: this.shipU1.value.toArray().map((v: number) => +v.toFixed(2)),
      },
    };
  }

  setVisible(v: boolean) { this.group.visible = v; }

  dispose() {
    for (const g of [this.far, this.near]) {
      this.group.remove(g);
      g.geometry.dispose();
      (g.material as THREE.Material).dispose();
    }
    this.group.parent?.remove(this.group);
  }
}

export default SeaModule;
