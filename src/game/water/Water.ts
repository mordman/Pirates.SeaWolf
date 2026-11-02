import * as THREE from 'three';
import { gerstnerGLSL, SEA, waterHeightAt, waveUniformData, seaAmpLoHi } from './waves';

const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

interface OceanUniforms {
  [k: string]: THREE.IUniform;
}

// Настройки качества воды по умолчанию (переопределяется из GameSettings)
export const WATER_DEFAULTS = { detailSegs: 176, chunkSize: 900, far: 5600, lodSkip: 0 };

// Параметр одного LOD-кольца (для телеметрии/отладки)
export interface RingInfo { inner: number; outer: number; cell: number; quads: number; }

export class Water {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;
  private detail: THREE.Mesh;
  // Дальняя вода — LOD-КОЛЬЦА ВСТЫК к детальному чанку (clipmap):
  // сторона каждого кольца вдвое больше, ячейка — в 2/4/8 раз крупнее
  // (настройка «Дальние кольца»), все вершины лежат на ОБЩЕЙ решётке
  // детального чанка → стыки без T-швов, сетка не читается как «квадраты».
  // (Раньше: 4 полосы с ячейкой 64 м — волны короче 128 м алиасились
  // в гигантские фасетки, а на границе чанка был виден шов.)
  private rings: THREE.Mesh[] = [];
  private cam = new THREE.Vector3();
  uniforms: OceanUniforms;

  private segs = WATER_DEFAULTS.detailSegs;
  private chunk = WATER_DEFAULTS.chunkSize;
  private far = WATER_DEFAULTS.far;
  private lodSkip = WATER_DEFAULTS.lodSkip;
  private step = WATER_DEFAULTS.chunkSize / WATER_DEFAULTS.detailSegs;

  constructor(opts?: { detailSegs?: number; chunkSize?: number; far?: number; lodSkip?: number }) {
    // волны — в UNIFORM-массивах (набор PHYS/RIDE переключается
    // без пересборки материала, Task 27)
    const wu = waveUniformData();
    const amp = seaAmpLoHi();
    this.uniforms = {
      uTime: { value: 0 },
      uAmp: { value: SEA.amplitude },
      uAmpLo: { value: amp.lo },
      uAmpHi: { value: amp.hi },
      uWaveA: { value: wu.wa.map((v) => new THREE.Vector4(...v)) },
      uWaveB: { value: wu.wb.map((v) => new THREE.Vector4(...v)) },
      uShift: { value: new THREE.Vector3() },   // floating origin
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyColor: { value: new THREE.Color(0.45, 0.68, 0.78) },
      uHorizonColor: { value: new THREE.Color(0.75, 0.85, 0.88) },
      uDeepColor: { value: new THREE.Color(0.015, 0.12, 0.16) },
      uShallowColor: { value: new THREE.Color(0.06, 0.38, 0.42) },
      uFogColor: { value: new THREE.Color(0.72, 0.82, 0.86) },
      uFogDensity: { value: 0.00035 },
      uFoamTex: { value: null },
      uFoamQ: { value: 2.0 },                       // качество/сложность пены 0..2
      uFarFade: { value: new THREE.Vector2(600, 4600) }, // диапазон затухания зыби
      uHiFade: { value: new THREE.Vector2(270, 440) },   // затухание коротких волн (к краю чанка)
      uEdge: { value: 7200 },                       // дистанция кромки воды (растворение в небо)
    };

    // Процедурная текстура пены
    this.uniforms.uFoamTex.value = makeFoamTexture();

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        varying vec3 vScenePos;
        varying vec3 vNormal;
        varying float vDist;
        varying float vFoamWave;
        varying vec2 vWorldXZ;
        ${gerstnerGLSL()}
        uniform vec3 uShift; // = -worldGroup.position (сцена -> мир)
        uniform vec2 uFarFade;
        uniform vec2 uHiFade;
        void main() {
          vec3 sceneP = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 worldXZ = sceneP.xz + uShift.xz; // мировые координаты вершины
          float d = length(sceneP.xz - cameraPosition.xz);
          // два диапазона: короткие волны гаснут к краю чанка (у дальних
          // колец крупная ячейка — иначе граница читается как «квадрат»),
          // длинная зыбь живёт до горизонта
          float fadeLo = 1.0 - smoothstep(uFarFade.x, uFarFade.y, d);
          float fadeHi = 1.0 - smoothstep(uHiFade.x, uHiFade.y, d);
          vec3 disp; vec3 nrm;
          gerstner(worldXZ, uAmpLo * fadeLo, uAmpHi * fadeHi, disp, nrm);
          vec3 p = sceneP + disp;
          vNormal = nrm;
          vScenePos = p;
          vWorldPos = vec3(worldXZ.x + disp.x, disp.y, worldXZ.y + disp.z);
          vWorldXZ = worldXZ + disp.xz;
          vDist = d;
          vFoamWave = fadeLo;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorldPos;
        varying vec3 vScenePos;
        varying vec3 vNormal;
        varying float vDist;
        varying float vFoamWave;
        varying vec2 vWorldXZ;
        uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizonColor, uDeepColor, uShallowColor, uFogColor;
        uniform float uTime, uFogDensity, uFoamQ, uEdge;
        uniform sampler2D uFoamTex;
        ${NOISE_GLSL}

        void main() {
          vec3 N = normalize(vNormal);
          // мелкая деталь-нормаль (рябь)
          vec2 uv = vWorldXZ * 0.35 + vec2(uTime * 0.25, uTime * -0.18);
          float n1 = fbm(uv);
          float n2 = fbm(uv * 2.7 + 13.7 + vec2(uTime * 0.4, uTime * 0.31));
          N = normalize(N + vec3((n1 - 0.5) * 0.35, 0.0, (n2 - 0.5) * 0.35));

          vec3 V = normalize(cameraPosition - vScenePos);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

          // цвет воды: глубина -> мелководье (по нормали X/Z — у берега упрощённо по шуму)
          float depthMix = clamp(1.0 - fres * 1.2, 0.0, 1.0);
          vec3 waterCol = mix(uShallowColor, uDeepColor, depthMix);
          vec3 skyRef = mix(uSkyColor, uHorizonColor, 0.35);
          vec3 col = mix(waterCol, skyRef, fres * 0.75);

          // солнечный блик
          vec3 R = reflect(-V, N);
          float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0);
          float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 24.0) * 0.25;
          col += uSunColor * (spec * 1.4 + glint);

          // ===== ПЕНА: независимые слои + сильная пятнистость =====
          // (1) «поля пятнистости»: крупные медленные области, где пена
          //     вообще появляется — часть гребней пенная, часть чистых;
          //     контраст усилен (0..1.25): есть «пустыни» и «кипящие» зоны
          float foamPatch = fbm(vWorldXZ * 0.011 + vec2(uTime * 0.011, -uTime * 0.008));
          foamPatch = 0.15 + smoothstep(0.26, 0.74, foamPatch) * 1.10;
          // (1b) пятнистость СРЕДНЕГО масштаба (~6 м) — читается на дистанции,
          //      где мелкая рябь пены уже сливается
          float foamPatchM = fbm(vWorldXZ * 0.16 + vec2(uTime * 0.05, -uTime * 0.033) + 5.1);
          foamPatchM = smoothstep(0.28, 0.72, foamPatchM) * 0.9;
          // (2) гребень: высота волны + крутизна (нормаль)
          float crest = smoothstep(0.94, 1.3, vWorldPos.y * 0.42 + 0.5) * vFoamWave;
          float steep = clamp(1.0 - vNormal.y, 0.0, 1.0);
          // (3) три слоя шума разного масштаба и скорости
          float fn1 = fbm(vWorldXZ * 0.9 + vec2(uTime * 0.32, uTime * -0.21));
          float fn2 = fbm(vWorldXZ * 2.9 + vec2(-uTime * 0.5, uTime * 0.36) + 17.3);
          float fn3 = fbm(vWorldXZ * 0.055 + vec2(uTime * 0.1, uTime * 0.07) + 31.7);
          // (4) «прожилки» — анизотропный шум, вытянутый вдоль главной волны
          vec2 wdir = normalize(vec2(1.0, 0.25));
          vec2 sp = vec2(dot(vWorldXZ, wdir) * 0.030, dot(vWorldXZ, vec2(-wdir.y, wdir.x)) * 0.40);
          float streak = fbm(sp + vec2(uTime * 0.05, uTime * 0.022));
          float streakFoam = smoothstep(0.78, 1.04, streak * 0.5 + crest * 0.5 + fn2 * 0.25)
                             * clamp(foamPatch, 0.0, 1.0) * crest * 1.7;
          // (5) основная пена гребней: порог гуляет от пятнистости обоих
          //     масштабов, fn1 и медленного fn3 — рисунок всё время разный
          float crestFoam = smoothstep(0.58, 0.97,
            crest * (0.50 + 0.85 * clamp(foamPatch, 0.0, 1.2))
            + fn1 * 0.30 * (0.40 + 0.60 * clamp(foamPatch, 0.0, 1.0))
            + fn3 * 0.22 * foamPatchM
            + steep * 0.5);
          crestFoam *= 0.55 + 0.45 * foamPatchM + 0.25; // средние пятна дают «дыры» в пене
          // качество 0 — упрощённая пена (без прожилок и с одним слоем)
          if (uFoamQ < 0.5) {
            crestFoam = smoothstep(0.72, 0.98, crest * 0.8 + fn1 * 0.32);
            streakFoam = 0.0;
          } else if (uFoamQ < 1.5) {
            streakFoam *= 0.6;
            crestFoam *= 0.8;
          }
          // (6) пузырьковая текстура в ДВА масштаба с разными скоростями
          float ft = texture2D(uFoamTex, vWorldXZ * 0.11 + vec2(uTime * 0.021, uTime * -0.014)).r;
          float ft2 = texture2D(uFoamTex, vWorldXZ * 0.037 - vec2(uTime * 0.012, uTime * 0.017)).r;
          float texFoam = smoothstep(0.66, 1.05, ft * 0.6 + ft2 * 0.6 + crest * 0.35) * (0.10 + 0.14 * clamp(foamPatch, 0.0, 1.2));
          float foamAmt = crestFoam * (0.55 + 0.45 * fn2) + streakFoam * 0.65 + texFoam;
          foamAmt = clamp(foamAmt, 0.0, 1.0) * (0.35 + 0.65 * vFoamWave);
          // цвет пены: от голубовато-серой «отработанной» до свежей белой,
          // яркость следует солнцу (ночью пена тускнеет)
          vec3 foamCol = mix(vec3(0.78, 0.84, 0.88), vec3(0.97, 0.99, 1.0),
                             clamp(fn2 * 0.55 + foamPatchM * 0.45, 0.0, 1.0));
          foamCol *= (uSunColor * 0.35 + 0.65);
          col = mix(col, foamCol, foamAmt * 0.8);

          // туман
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

          // кромка воды: цвет и альфа растворяются в небо у горизонта —
          // внешний квадрат дальних колец НЕ читается (раньше 9% контраста)
          float edge = smoothstep(uEdge * 0.72, uEdge * 0.99, vDist);
          col = mix(col, uFogColor, edge);

          gl_FragColor = vec4(col, 0.94 * (1.0 - edge));
        }
      `,
      transparent: true,
    });
    this.material = mat;

    // детальный чанк следует за камерой с шагом сетки; LOD-кольца
    // создаются в configure()
    const dg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.detail = new THREE.Mesh(dg, mat);
    this.detail.frustumCulled = false;
    this.detail.renderOrder = 1;
    this.group.add(this.detail);

    this.configure(
      opts?.detailSegs ?? WATER_DEFAULTS.detailSegs,
      opts?.chunkSize ?? WATER_DEFAULTS.chunkSize,
      opts?.far ?? WATER_DEFAULTS.far,
      opts?.lodSkip ?? WATER_DEFAULTS.lodSkip,
    );
  }

  /** Перестройка сетки воды под настройки качества/дальности (runtime) */
  configure(detailSegs: number, chunkSize: number, far: number, lodSkip = 0) {
    // Сегменты кратно 16: все размеры LOD-колец остаются целыми кратными
    // своей ячейки при любом режиме плотности (x2/x4/x8) — решётка общая.
    this.segs = Math.max(64, Math.round(detailSegs / 16) * 16);
    this.chunk = Math.min(2000, Math.max(300, chunkSize));
    this.lodSkip = Math.min(2, Math.max(0, Math.round(lodSkip)));
    this.step = this.chunk / this.segs;
    this.far = Math.max(this.chunk + 600, far);

    this.detail.geometry.dispose();
    const dg = new THREE.PlaneGeometry(this.chunk, this.chunk, this.segs, this.segs);
    dg.rotateX(-Math.PI / 2);
    this.detail.geometry = dg;

    // LOD-кольца: от половины чанка до дальности, сторона удваивается,
    // ячейка растёт в 2^(1+lodSkip) раз за уровень. Кромки колец — точные
    // кратные ячейки (математика выше), совпадают с вершинами соседа.
    for (const r of this.rings) { r.geometry.dispose(); this.group.remove(r); }
    this.rings = [];
    let half = this.chunk / 2;
    let level = 0;
    while (half < this.far - 0.5) {
      const outer = half * 2;
      const cell = this.step * Math.pow(2, level + 1 + this.lodSkip);
      const m = new THREE.Mesh(makeRingGeometry(half, outer, cell), this.material);
      m.frustumCulled = false;
      m.renderOrder = 0;
      m.userData.ring = { inner: half, outer, cell, quads: m.geometry.index!.count / 6 } as RingInfo;
      this.rings.push(m);
      this.group.add(m);
      half = outer;
      level++;
    }

    // затухание волн: короткие — к краю чанка (до границы с кольцами),
    // длинная зыбь — к горизонту; кромка воды растворяется в небо
    (this.uniforms.uFarFade.value as THREE.Vector2).set(this.chunk / 2 + 180, this.far * 0.82);
    (this.uniforms.uHiFade.value as THREE.Vector2).set(this.chunk * 0.28, this.chunk * 0.485);
    this.uniforms.uEdge.value = this.getInfo().farEff * 0.99;
  }

  /** Сводка сетки для HUD/телеметрии: чанк, кольца, ячейки */
  getInfo(): { chunkSize: number; segs: number; step: number; rings: RingInfo[]; farEff: number } {
    return {
      chunkSize: this.chunk, segs: this.segs, step: this.step,
      rings: this.rings.map(r => r.userData.ring as RingInfo),
      farEff: this.rings.length ? (this.rings[this.rings.length - 1].userData.ring as RingInfo).outer : this.chunk / 2,
    };
  }

  setFoamQuality(q: number) {
    this.uniforms.uFoamQ.value = q;
  }

  setEnvironment(sunDir: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, horizon: THREE.Color, fogColor: THREE.Color, fogDensity: number) {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    (this.uniforms.uSkyColor.value as THREE.Color).copy(sky);
    (this.uniforms.uHorizonColor.value as THREE.Color).copy(horizon);
    (this.uniforms.uFogColor.value as THREE.Color).copy(fogColor);
    this.uniforms.uFogDensity.value = fogDensity;
  }

  /** worldShift = -worldGroup.position: перевод координат сцены в мировые */
  update(time: number, camScenePos: THREE.Vector3, worldShift: THREE.Vector3) {
    this.uniforms.uTime.value = time;
    this.uniforms.uAmp.value = SEA.amplitude;
    // две модели моря (Task 27): набор волн и погодные множители —
    // каждый кадр из waves.ts (переключение в настройках мгновенное)
    const wu = waveUniformData();
    const wa = this.uniforms.uWaveA.value as THREE.Vector4[];
    const wb = this.uniforms.uWaveB.value as THREE.Vector4[];
    for (let i = 0; i < wa.length; i++) {
      wa[i].set(wu.wa[i][0], wu.wa[i][1], wu.wa[i][2], wu.wa[i][3]);
      wb[i].set(wu.wb[i][0], wu.wb[i][1], wu.wb[i][2], wu.wb[i][3]);
    }
    const amp = seaAmpLoHi();
    this.uniforms.uAmpLo.value = amp.lo;
    this.uniforms.uAmpHi.value = amp.hi;
    (this.uniforms.uShift.value as THREE.Vector3).copy(worldShift);
    this.cam.copy(camScenePos);
    // снапим к шагу СЕТКИ (общая решётка чанка и всех колец): вершины
    // не «плывут», кромки остаются совмещёнными
    const step = this.step;
    const sx = Math.round(camScenePos.x / step) * step;
    const sz = Math.round(camScenePos.z / step) * step;
    this.detail.position.set(sx, 0, sz);
    for (const r of this.rings) r.position.set(sx, 0, sz);
  }

  heightAt(x: number, z: number, t: number) {
    return waterHeightAt(x, z, t);
  }

  dispose() {
    this.detail.geometry.dispose();
    for (const r of this.rings) r.geometry.dispose();
    this.material.dispose();
    (this.uniforms.uFoamTex.value as THREE.Texture | null)?.dispose();
  }
}

/**
 * Геометрия LOD-кольца: квадратный «пончик» между inner и outer,
 * разбитый на 4 прямоугольника с шагом ~cell. Размеры прямоугольников —
 * целые кратные cell (гарантия configure), поэтому вершины кромок
  * совпадают с вершинами соседнего (более мелкого) уровня.
 */
function makeRingGeometry(inner: number, outer: number, cell: number): THREE.BufferGeometry {
  const rects: [number, number, number, number][] = [
    [-outer, -outer, outer, -inner], // север (во всю ширину)
    [-outer, inner, outer, outer],   // юг
    [-outer, -inner, -inner, inner], // запад (между С и Ю)
    [inner, -inner, outer, inner],   // восток (x от +inner до +outer!)
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  let vBase = 0;
  for (const [x0, z0, x1, z1] of rects) {
    const nx = Math.max(1, Math.round((x1 - x0) / cell));
    const nz = Math.max(1, Math.round((z1 - z0) / cell));
    const dx = (x1 - x0) / nx;
    const dz = (z1 - z0) / nz;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        pos.push(x0 + i * dx, 0, z0 + j * dz);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = vBase + j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d); // нормаль +Y (как у повёрнутого PlaneGeometry)
      }
    }
    vBase += (nx + 1) * (nz + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Текстура пены: тайлящийся шум */
function makeFoamTexture(): THREE.Texture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const rnd = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const grid = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0, amp = 0.5, f = 4;
      for (let o = 0; o < 4; o++) {
        s += amp * grid((x / S) * f, (y / S) * f);
        amp *= 0.5; f *= 2;
      }
      const v = Math.floor(s * 255);
      const i = (y * S + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
