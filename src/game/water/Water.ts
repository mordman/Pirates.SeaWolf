import * as THREE from 'three';
import { gerstnerGLSL, SEA, waterHeightAt, waveUniformData, seaAmpUniforms, terrainTexture, TERRAIN_WORLD_SIZE, bindTerrainSampler } from './waves';
import { textureUrls } from '../assets/textures';
import { heightAt } from '../world/world';

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
    // сэмплер рельефа для запекания текстуры глубин (мир ×10)
    bindTerrainSampler(heightAt);
    // волны — в UNIFORM-массивах (набор PHYS/RIDE переключается
    // без пересборки материала, Task 27)
    const wu = waveUniformData();
    this.uniforms = {
      uTime: { value: 0 },
      uAmpLo: { value: seaAmpUniforms() },
      uAmpHi: { value: seaAmpUniforms() },
      uWind01: { value: 0.3 },                     // 0..1 — микронормали/прибой от ветра
      uTerrain: { value: terrainTexture() },       // рельеф: затухание волн у берега + прибой
      uTerrainHalf: { value: TERRAIN_WORLD_SIZE / 2 },
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
      uFarFade: { value: new THREE.Vector2(600, 4600) }, // диапазон затухания зыби
      uHiFade: { value: new THREE.Vector2(270, 440) },   // затухание коротких волн (к краю чанка)
      uEdge: { value: 7200 },                       // дистанция кромки воды (растворение в небо)
      // Task 39: СВОЯ текстура воды по ссылке (assets.texUrls.water)
      // — подмешивается к цвету волн; uTexScale — плитка в МЕТРАХ
      // (мировые координаты, не UV меша)
      uTex: { value: null as THREE.Texture | null },
      uTexOn: { value: 0 },
      uTexScale: { value: 1.0 / 80.0 },            // плитка каждые 80 м
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        varying vec3 vScenePos;
        varying vec3 vNormal;
        varying float vDist;
        varying vec2 vWorldXZ;
        ${gerstnerGLSL()}
        uniform vec3 uShift; // = -worldGroup.position (сцена -> мир)
        uniform vec2 uFarFade;
        uniform vec2 uHiFade;
        uniform sampler2D uTerrain;   // рельеф мира (R = высота)
        uniform float uTerrainHalf;   // половина стороны текстуры, м
        varying float vDepth;         // глубина под вершиной (для прибоя)
        float terrainDepth(vec2 wxz) {
          vec2 uv = wxz / (2.0 * uTerrainHalf) + 0.5;
          float h = texture2D(uTerrain, clamp(uv, 0.0, 1.0)).r * 64.0 - 16.0;
          return -h;
        }
        void main() {
          vec3 sceneP = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 worldXZ = sceneP.xz + uShift.xz; // мировые координаты вершины
          float d = length(sceneP.xz - cameraPosition.xz);
          // ВОЛНЫ РАЗБИВАЮТСЯ ОБ ОСТРОВА: на мелководье (< 30 м) амплитуда
          // гаснет — вал «ложится» у берега. Горы от самого берега — узкая
          // полоса прибоя (глубина нарастает резко), пляжи — широкая
          float depth = terrainDepth(worldXZ);
          vDepth = depth;
          float shoreFade = smoothstep(0.0, 30.0, depth);
          // два диапазона: короткие волны гаснут к краю чанка (у дальних
          // колец крупная ячейка — иначе граница читается как «квадрат»),
          // длинная зыбь живёт до горизонта
          float fadeLo = 1.0 - smoothstep(uFarFade.x, uFarFade.y, d);
          float fadeHi = 1.0 - smoothstep(uHiFade.x, uHiFade.y, d);
          vec3 disp; vec3 nrm;
          gerstner(worldXZ, uAmpLo * fadeLo * shoreFade, uAmpHi * fadeHi * shoreFade, disp, nrm);
          vec3 p = sceneP + disp;
          vNormal = nrm;
          vScenePos = p;
          vWorldPos = vec3(worldXZ.x + disp.x, disp.y, worldXZ.y + disp.z);
          vWorldXZ = worldXZ + disp.xz;
          vDist = d;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorldPos;
        varying vec3 vScenePos;
        varying vec3 vNormal;
        varying float vDist;
        varying vec2 vWorldXZ;
        varying float vDepth;
        uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizonColor, uDeepColor, uShallowColor, uFogColor;
        uniform float uTime, uFogDensity, uEdge, uWind01;
        uniform sampler2D uTex;     // Task 39: своя текстура воды
        uniform float uTexOn;
        uniform float uTexScale;    // плитка в метрах (мировые координаты)
        ${NOISE_GLSL}

        void main() {
          vec3 N = normalize(vNormal);
          // МИКРОНОРМАЛИ ПОВЕРХНОСТИ НА ОСНОВЕ FBM: рябь из двух
          // многооктавных шумов, дрейфует по ветру; амплитуда растёт
          // с ветром (в штиль море стеклянное, в шторм кипит)
          vec2 uv = vWorldXZ * 0.35 + vec2(uTime * 0.25, uTime * -0.18);
          float n1 = fbm(uv);
          float n2 = fbm(uv * 2.7 + 13.7 + vec2(uTime * 0.4, uTime * 0.31));
          float microAmp = 0.06 + 0.34 * uWind01;
          N = normalize(N + vec3((n1 - 0.5) * microAmp, 0.0, (n2 - 0.5) * microAmp));

          vec3 V = normalize(cameraPosition - vScenePos);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

          // ФИКС «прозрачная поверхность у островов» (Task 36): вода
          // НЕПРОЗРАЧНАЯ — цвет по ГЛУБИНЕ (текстура рельефа):
          // бирюзовая кромка у пляжей → тёмная синева в море
          float deepMix = smoothstep(2.0, 14.0, vDepth);
          vec3 waterCol = mix(uShallowColor, uDeepColor, deepMix);
          vec3 skyRef = mix(uSkyColor, uHorizonColor, 0.35);
          vec3 col = mix(waterCol, skyRef, fres * 0.75);

          // Task 39: СВОЯ текстура воды — подмешивается к базовому
          // цвету (текстура в sRGB, выравниваем среднюю яркость ×1.7);
          // френель/блик/прибой/туман работают ПОВЕРХ — вода остаётся
          // «водой», но с вашим узором (каустика/чешуя/мрамор)
          if (uTexOn > 0.5) {
            vec3 wtex = texture2D(uTex, vWorldXZ * uTexScale).rgb * 1.7;
            col = mix(col, col * wtex, 0.85);
          }

          // солнечный блик
          vec3 R = reflect(-V, N);
          float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0);
          float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 24.0) * 0.25;
          col += uSunColor * (spec * 1.4 + glint);

          // ===== ПЕНА НА ВОЛНАХ УДАЛЕНА (по жалобе игрока: «море
          // покрывается всё какой-то пеной — убери пену на волнах»):
          // открытое море — чистая вода (цвет + френель + блик +
          // FBM-микронормали). Белое осталось ТОЛЬКО у берегов —
          // прибой, где волны разбиваются об острова =====

          // ===== ПРИБОЙ: волны РАЗБИВАЮТСЯ об острова =====
          // (1) кромка воды — белая полоса у самого берега
          float surfEdge = 1.0 - smoothstep(0.0, 5.0, vDepth);
          // (2) ЛОМАЮЩИЕСЯ ВАЛЫ: полосы пены ВДОЛЬ изолиний глубины
          //     (const vDepth = параллельно берегу), накатываются на
          //     отмель (полоса ползёт к берегу), шум рвёт их в гребни;
          //     с ветром прибой злее, гребни привязаны к волнам.
          //     ЗОНА УЗКАЯ (до ~16 м глубины): прибой — кромка у
          //     берега, а не «пенное поле» вокруг острова
          float surfZone = 1.0 - smoothstep(0.0, 16.0, vDepth);
          float brk = fbm(vWorldXZ * vec2(0.14, 0.14) - vec2(uTime * 0.22, uTime * 0.17) + 7.7);
          float crestNear = smoothstep(0.12, 0.9, vWorldPos.y * 0.55 + 0.32);
          float rollPhase = vDepth * 0.55 - uTime * 1.35 + brk * 2.6;
          float roller = smoothstep(0.42, 0.92, sin(rollPhase) * 0.5 + 0.5);
          float surfBreak = surfZone * (0.55 + 0.45 * uWind01)
                          * roller * (0.7 + 0.3 * crestNear);
          float surfFoam = clamp(surfEdge * 1.15 + surfBreak * 1.0, 0.0, 1.0);
          // цвет прибоя: от голубовато-серой «отработанной» пены до
          // свежей белой, яркость следует солнцу (ночью тускнеет)
          float foamColN = fbm(vWorldXZ * 1.7 + vec2(uTime * 0.3, -uTime * 0.2) + 3.3);
          vec3 foamCol = mix(vec3(0.78, 0.84, 0.88), vec3(0.97, 0.99, 1.0),
                             clamp(foamColN, 0.0, 1.0));
          foamCol *= (uSunColor * 0.35 + 0.65);
          // прибой — ОТДЕЛЬНЫЙ проход ярче: переярченный цвет даёт
          // ЧИСТО БЕЛУЮ полосу ломающихся валов у берега
          col = mix(col, foamCol * 1.32, surfFoam * 0.92);

          // туман
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

          // кромка воды: цвет растворяется в туман у горизонта —
          // внешний квадрат дальних колец НЕ читается (раньше 9% контраста)
          float edge = smoothstep(uEdge * 0.72, uEdge * 0.99, vDist);
          col = mix(col, uFogColor, edge);

          // ВОДА НЕПРОЗРАЧНАЯ (Task 36): альфа 1.0 — берег больше
          // не «просвечивает»; растворение в горизонт — ЦВЕТОМ
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: false,
      depthWrite: true,
    });
    this.material = mat;
    // Task 39: реестр подмешивает свою текстуру воды по ссылке
    textureUrls.registerWater('water', mat);

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

  setEnvironment(sunDir: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, horizon: THREE.Color, fogColor: THREE.Color, fogDensity: number) {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    (this.uniforms.uSkyColor.value as THREE.Color).copy(sky);
    (this.uniforms.uHorizonColor.value as THREE.Color).copy(horizon);
    (this.uniforms.uFogColor.value as THREE.Color).copy(fogColor);
    this.uniforms.uFogDensity.value = fogDensity;
  }

  /** worldShift = -worldGroup.position: перевод координат сцены в мировые.
   *  Ветер — из состояния моря SEA (направления спектра/амплитуды
   *  обновляются каждый кадр: волны бегут за ветром) */
  update(time: number, camScenePos: THREE.Vector3, worldShift: THREE.Vector3) {
    this.uniforms.uTime.value = time;
    const wu = waveUniformData();
    const wa = this.uniforms.uWaveA.value as THREE.Vector4[];
    const wb = this.uniforms.uWaveB.value as THREE.Vector4[];
    for (let i = 0; i < wa.length; i++) {
      wa[i].set(wu.wa[i][0], wu.wa[i][1], wu.wa[i][2], wu.wa[i][3]);
      wb[i].set(wu.wb[i][0], wu.wb[i][1], wu.wb[i][2], wu.wb[i][3]);
    }
    const amp = seaAmpUniforms();
    this.uniforms.uAmpLo.value = amp;
    this.uniforms.uAmpHi.value = amp;
    this.uniforms.uWind01.value = Math.max(0, Math.min(1, SEA.windSpeed / 24));
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
