import * as THREE from 'three';
import { gerstnerGLSL, SEA, waterHeightAt } from './waves';

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
export const WATER_DEFAULTS = { detailSegs: 176, far: 5600 };

export class Water {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;
  private detail: THREE.Mesh;
  // Дальняя вода — 4 полосы ВСТЫК к детальной сетке (не сплошное полотно!):
  // сплошной план с ячейками 100м рисовался под кораблём и его линейная
  // интерполяция резала корпус («корабль внутри волны»)
  private bands: THREE.Mesh[] = [];
  private cam = new THREE.Vector3();
  uniforms: OceanUniforms;

  private segs = WATER_DEFAULTS.detailSegs;
  private far = WATER_DEFAULTS.far;
  private detailHalf = 450;

  constructor(opts?: { detailSegs?: number; far?: number }) {
    this.uniforms = {
      uTime: { value: 0 },
      uAmp: { value: SEA.amplitude },
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
      uFarFade: { value: new THREE.Vector2(600, 4600) }, // диапазон затухания волн
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
        void main() {
          vec3 sceneP = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 worldXZ = sceneP.xz + uShift.xz; // мировые координаты вершины
          float d = length(sceneP.xz - cameraPosition.xz);
          float farFade = 1.0 - smoothstep(uFarFade.x, uFarFade.y, d);
          vec3 disp; vec3 nrm;
          gerstner(worldXZ, uAmp * farFade, disp, nrm);
          vec3 p = sceneP + disp;
          vNormal = nrm;
          vScenePos = p;
          vWorldPos = vec3(worldXZ.x + disp.x, disp.y, worldXZ.y + disp.z);
          vWorldXZ = worldXZ + disp.xz;
          vDist = d;
          vFoamWave = farFade;
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
        uniform float uTime, uFogDensity, uFoamQ;
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
          float patch = fbm(vWorldXZ * 0.011 + vec2(uTime * 0.011, -uTime * 0.008));
          patch = 0.15 + smoothstep(0.26, 0.74, patch) * 1.10;
          // (1b) пятнистость СРЕДНЕГО масштаба (~6 м) — читается на дистанции,
          //      где мелкая рябь пены уже сливается
          float patchM = fbm(vWorldXZ * 0.16 + vec2(uTime * 0.05, -uTime * 0.033) + 5.1);
          patchM = smoothstep(0.28, 0.72, patchM) * 0.9;
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
                             * clamp(patch, 0.0, 1.0) * crest * 1.7;
          // (5) основная пена гребней: порог гуляет от пятнистости обоих
          //     масштабов, fn1 и медленного fn3 — рисунок всё время разный
          float crestFoam = smoothstep(0.58, 0.97,
            crest * (0.50 + 0.85 * clamp(patch, 0.0, 1.2))
            + fn1 * 0.30 * (0.40 + 0.60 * clamp(patch, 0.0, 1.0))
            + fn3 * 0.22 * patchM
            + steep * 0.5);
          crestFoam *= 0.55 + 0.45 * patchM + 0.25; // средние пятна дают «дыры» в пене
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
          float texFoam = smoothstep(0.66, 1.05, ft * 0.6 + ft2 * 0.6 + crest * 0.35) * (0.10 + 0.14 * clamp(patch, 0.0, 1.2));
          float foamAmt = crestFoam * (0.55 + 0.45 * fn2) + streakFoam * 0.65 + texFoam;
          foamAmt = clamp(foamAmt, 0.0, 1.0) * (0.35 + 0.65 * vFoamWave);
          // цвет пены: от голубовато-серой «отработанной» до свежей белой,
          // яркость следует солнцу (ночью пена тускнеет)
          vec3 foamCol = mix(vec3(0.78, 0.84, 0.88), vec3(0.97, 0.99, 1.0),
                             clamp(fn2 * 0.55 + patchM * 0.45, 0.0, 1.0));
          foamCol *= (uSunColor * 0.35 + 0.65);
          col = mix(col, foamCol, foamAmt * 0.8);

          // туман
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

          gl_FragColor = vec4(col, 0.94);
        }
      `,
      transparent: true,
    });
    this.material = mat;

    // Детальный план: следует за камерой с шагом сетки (размер/сегменты из настроек)
    const dg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.detail = new THREE.Mesh(dg, mat);
    this.detail.frustumCulled = false;
    this.detail.renderOrder = 1;
    this.group.add(this.detail);

    // полосы дальней воды создаются в configure()
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.frustumCulled = false;
      m.renderOrder = 0;
      this.bands.push(m);
      this.group.add(m);
    }
    this.configure(opts?.detailSegs ?? WATER_DEFAULTS.detailSegs, opts?.far ?? WATER_DEFAULTS.far);
  }

  /** Перестройка сетки воды под настройки качества/дальности (runtime) */
  configure(detailSegs: number, far: number) {
    this.segs = Math.max(48, Math.round(detailSegs));
    this.far = Math.max(1200, far);
    this.detailHalf = Math.min(450, this.far * 0.3);
    const size = this.detailHalf * 2;

    this.detail.geometry.dispose();
    const dg = new THREE.PlaneGeometry(size, size, this.segs, this.segs);
    dg.rotateX(-Math.PI / 2);
    this.detail.geometry = dg;

    // Дальняя вода: 4 полосы вокруг детального квадрата до горизонта.
    // Внутренние кромки полос ВСЕГДА совпадают с кромками детальной сетки
    // (двигаем их вместе с ней), стык бесшовный: вершины совпадают и
    // смещаются одной функцией gerstner. Перекрытия нет вовсе.
    const H = this.detailHalf;
    const FAR = this.far;
    const long = FAR - H;
    const dims: [number, number, number, number][] = [
      [2 * FAR, long, 0, -(H + long / 2)],   // север
      [2 * FAR, long, 0, +(H + long / 2)],   // юг
      [long, 2 * H, -(H + long / 2), 0],     // запад
      [long, 2 * H, +(H + long / 2), 0],     // восток
    ];
    dims.forEach(([w, h, sx, sz], i) => {
      const m = this.bands[i];
      m.geometry.dispose();
      const g = new THREE.PlaneGeometry(w, h, Math.max(2, Math.round(w / 64)), Math.max(2, Math.round(h / 64)));
      g.rotateX(-Math.PI / 2);
      m.geometry = g;
      m.userData.off = { x: sx, z: sz };
    });

    (this.uniforms.uFarFade.value as THREE.Vector2).set(this.detailHalf + 180, this.far * 0.82);
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
    (this.uniforms.uShift.value as THREE.Vector3).copy(worldShift);
    this.cam.copy(camScenePos);
    // снапим к шагу сетки, чтобы вершины не «плыли»
    const step = (this.detailHalf * 2) / this.segs;
    const sx = Math.round(camScenePos.x / step) * step;
    const sz = Math.round(camScenePos.z / step) * step;
    this.detail.position.set(sx, 0, sz);
    // полосы дальней воды прижаты к кромкам детального плана
    for (const b of this.bands) {
      const off = b.userData.off as { x: number; z: number };
      b.position.set(sx + off.x, 0, sz + off.z);
    }
  }

  heightAt(x: number, z: number, t: number) {
    return waterHeightAt(x, z, t);
  }

  dispose() {
    this.detail.geometry.dispose();
    for (const b of this.bands) b.geometry.dispose();
    this.material.dispose();
    (this.uniforms.uFoamTex.value as THREE.Texture | null)?.dispose();
  }
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
