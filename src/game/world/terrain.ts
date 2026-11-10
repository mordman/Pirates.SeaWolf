import * as THREE from 'three';
import { ISLANDS, heightAt, terrainColorAt } from './world';
import type { AssetsSettings, IslandTextureMode, TerrainShaderKind } from '../core/settings';
import { textureUrls } from '../assets/textures';

// ============================================================
// РЕЛЬЕФ ОСТРОВОВ — СТРИМЕР ТАЙЛОВ (Task 36/37/38).
// Мир вырос в 100 раз: острова 1–3.3 км радиусом не вытянуть
// одним мешем на остров. Рельеф собирается ТАЙЛАМИ вокруг
// игрока: дальние — ячейка 24 м (силуэт с моря), ближние
// (< 900 м) — ячейка 8 м (ходьба, пляжи, тропы, обрывы).
// У каждого тайла ЮБКА (skirt) по периметру — стыки LOD без дыр
// (ФИКС Task 38: индексы юбки считались от ИНДЕКСОВ ВЕРШИН и
// выходили за буфер — рисовали мусорные «шторы»/«паруса» у
// островов; теперь от ПОЗИЦИЙ в массиве кромки + наружный
// обход). Построение — через ОЧЕРЕДЬ (без фризов). ЦВЕТ —
// terrainColorAt; ТЕКСТУРЫ — Task 37: режимы выкл/зерно/PBR,
// Task 38: режим 'url' — СВОЯ текстура по ссылке из настроек
// (вкладка «Ресурсы»): пока грузится или при ошибке — зерно.
// ============================================================

const TILE = 480;            // сторона тайла, м
const FAR_SEG = 20;          // дальний тайл: ячейка 24 м
const NEAR_SEG = 60;         // ближний тайл: ячейка 8 м
const NEAR_DIST = 900;       // радиус детальных тайлов вокруг игрока
const SKIRT = 10;            // глубина юбки, м
const BUILD_PER_FRAME = 4;   // построить тайлов за кадр
const UV_BASE = 7;           // UV запечён как wx/7 — масштаб через texture.repeat

// ---------- детерминированный шум (общий для всех текстур) ----------
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Поле высот детализации (общая база зерна/альбедо/нормалей —
 *  рельеф нормалей СОВПАДАЕТ со светлыми пятнами альбедо) */
function detailHeightField(S: number): Float32Array {
  const h = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const fine = vnoise(i * 0.9, j * 0.9);
      const mid = vnoise(i * 0.11 + 37, j * 0.11 + 91);
      const cracks = vnoise(i * 0.33 + 713, j * 0.33 + 29);
      // мелкая крошка + средние пятна + редкие «трещины» потемнее
      h[j * S + i] = 0.5 + (fine - 0.5) * 0.34 + (mid - 0.5) * 0.30
        + (cracks < 0.18 ? -0.22 : 0) + (cracks > 0.9 ? 0.14 : 0);
    }
  }
  return h;
}
function makeDataTexture(S: number, fill: (i: number, j: number, h: number) => [number, number, number, number]): THREE.DataTexture {
  const hfield = detailHeightField(S);
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const [r, g, b, a] = fill(i, j, hfield[j * S + i]);
      const o = (j * S + i) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  // RGBAFormat — ЕДИНСТВЕННЫЙ надёжный формат DataTexture в WebGL2:
  // RGBFormat из конвейера удалён и грузится битой (чёрный рендер)
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Процедурная текстура зерна рельефа (Task 36): мелкая крошка +
 *  средние пятна, нейтральный серый вокруг 1.0 (умножается на
 *  цвет вершин). ФИКС: RGBA, 4 байта/пиксель */
function makeDetailTexture(): THREE.DataTexture {
  const S = 256;
  return makeDataTexture(S, (_i, _j, v) => {
    const g = Math.round(255 * Math.max(0, Math.min(1, 0.78 + v * 0.38)));
    return [g, g, g, 255];
  });
}

/** PBR-альбедо рельефа: нейтральная основа ~1.0 (биом задаёт цвет
 *  вершин) + цветные вкрапления — песчаная крошка, тёмные
 *  «трещины», редкие светлые камешки и травяные штрихи */
function makeAlbedoTexture(): THREE.DataTexture {
  const S = 256;
  return makeDataTexture(S, (i, j, v) => {
    // базовый нейтральный с лёгким тёплым уклоном
    let r = 236, g = 232, b = 224;
    const k = 0.78 + v * 0.38;                    // яркость из поля высот
    r *= k; g *= k; b *= k;
    // травяные штрихи на «высоких» местах поля
    if (v > 0.62) {
      const t = Math.min(1, (v - 0.62) / 0.3);
      r = r * (1 - t * 0.25) ; g = g * (1 - t * 0.08); b = b * (1 - t * 0.32);
    }
    // трещины/впадины — темнее и холоднее
    if (v < 0.36) {
      const t = Math.min(1, (0.36 - v) / 0.25);
      r *= 1 - t * 0.38; g *= 1 - t * 0.34; b *= 1 - t * 0.28;
    }
    // редкие светлые камешки
    if (hash2(i * 3.7 + 11, j * 2.9 + 5) > 0.987) { r = 250; g = 248; b = 242; }
    return [Math.min(255, r), Math.min(255, g), Math.min(255, b), 255];
  });
}

/** Карта нормалей из поля высот (Sobel, бесшовная завёртка) */
function makeNormalTexture(): THREE.DataTexture {
  const S = 256;
  const h = detailHeightField(S);
  const amp = 1.6; // условная высота рельефа в «пикселях»
  return makeDataTexture(S, (i, j) => {
    const H = (pi: number, pj: number) => h[(((pj % S) + S) % S) * S + (((pi % S) + S) % S)];
    const dx = (H(i + 1, j) - H(i - 1, j)) * amp;
    const dy = (H(i, j + 1) - H(i, j - 1)) * amp;
    // нормаль плоскости (0,1,0) с возмущением (-dx, 1, -dy)
    const len = Math.hypot(dx, 1, dy);
    return [
      Math.round((-dx / len * 0.5 + 0.5) * 255),
      Math.round((1 / len * 0.5 + 0.5) * 255),
      Math.round((-dy / len * 0.5 + 0.5) * 255),
      255,
    ];
  });
}

/** Карта шероховатости: крошка/трещины матовые, камешки глаже */
function makeRoughTexture(): THREE.DataTexture {
  const S = 256;
  return makeDataTexture(S, (i, j, v) => {
    let rr = 0.82 + (v - 0.5) * 0.3;               // 0.67..0.97
    if (hash2(i * 5.1 + 91, j * 4.3 + 17) > 0.987) rr = 0.45; // камешек — глаже
    return [Math.round(Math.min(1, Math.max(0, rr)) * 255), 0, 0, 255];
  });
}

interface TileRec {
  mesh: THREE.Mesh;
  near: boolean;
}

export interface TerrainStats {
  tiles: number; nearTiles: number; queue: number;
  tris: number; built: number;
}

export class TerrainStreamer {
  group = new THREE.Group();
  /** дальность стрима: тайлы острова строятся, если игрок ближе */
  streamDist = 9000;
  private tiles = new Map<string, TileRec>();
  private queue: { key: string; cx: number; cz: number; near: boolean; d: number }[] = [];
  /** текущий материал рельефа (тип зависит от настройки шейдера) */
  private mat!: THREE.Material;
  /** каркас (переносится при пересоздании материала) */
  private wire = false;
  private grainTex: THREE.DataTexture;
  private albedoTex: THREE.DataTexture;
  private normalTex: THREE.DataTexture;
  private roughTex: THREE.DataTexture;
  private refreshT = -1;
  private totalBuilt = 0;
  private _color = new THREE.Color();
  /** текущая конфигурация текстур (для телеметрии/настроек) */
  private cfg: AssetsSettings;
  /** Task 38/39: своя текстура рельефа по ссылке — живёт в ОБЩЕМ
   *  реестре textureUrls (слот 'terrain', каталог assets/textures.ts);
   *  здесь — только подписка: по готовности/ошибке пересобираем
   *  материал (пока грузится/при ошибке — зерно, не чёрный рельеф) */
  constructor(opts?: { textures?: AssetsSettings; streamDist?: number }) {
    if (opts?.streamDist) this.streamDist = opts.streamDist;
    this.grainTex = makeDetailTexture();
    this.albedoTex = makeAlbedoTexture();
    this.normalTex = makeNormalTexture();
    this.roughTex = makeRoughTexture();
    this.cfg = opts?.textures ?? {
      islandTextures: 'grain', texScale: 7, terrainShader: 'standard',
      roughness: 0.96, metalness: 0, normalStrength: 1, texUrl: '',
      texUrls: { terrain: '', hull: '', deck: '', sail: '', water: '' },
    };
    textureUrls.listen('terrain', () => this.rebuildMaterial());
    if (this.cfg.islandTextures === 'url' && this.cfg.texUrls.terrain) {
      textureUrls.setUrl('terrain', this.cfg.texUrls.terrain);
    }
    this.rebuildMaterial();
    this.group.matrixAutoUpdate = false;
  }

  /** Собрать материал рельефа по настройкам: режим текстур +
   *  шейдер + PBR-параметры. Все меши тайлов делят ОДИН материал */
  private rebuildMaterial() {
    const old = this.mat;
    const m = this.cfg.islandTextures;
    const shader = this.cfg.terrainShader;
    const rep = UV_BASE / Math.max(3, this.cfg.texScale);
    let mat: THREE.Material;
    const common = {
      vertexColors: true, side: THREE.FrontSide,
    } as Record<string, unknown>;
    if (shader === 'lambert') {
      mat = new THREE.MeshLambertMaterial({ ...common, map: m === 'off' ? null : this.grainTex });
    } else if (shader === 'phong') {
      const pm = new THREE.MeshPhongMaterial({
        ...common, shininess: 4, specular: new THREE.Color(0x17140e),
        map: m === 'off' ? null : this.grainTex,
      });
      if (m === 'pbr') {
        // Phong понимает normalMap — даём рельеф и альбедо вместо зерна
        pm.map = this.albedoTex;
        pm.normalMap = this.normalTex;
        pm.normalScale = new THREE.Vector2(this.cfg.normalStrength, this.cfg.normalStrength);
      }
      mat = pm;
    } else {
      const std = shader === 'physical'
        ? new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 0.04, sheen: 0.05 })
        : new THREE.MeshStandardMaterial({ ...common });
      std.roughness = this.cfg.roughness;
      std.metalness = this.cfg.metalness;
      if (m === 'grain') {
        std.map = this.grainTex;
      } else if (m === 'pbr') {
        std.map = this.albedoTex;
        std.normalMap = this.normalTex;
        std.roughnessMap = this.roughTex;
        std.normalScale = new THREE.Vector2(this.cfg.normalStrength, this.cfg.normalStrength);
      } else if (m === 'url') {
        // Task 38/39: СВОЯ текстура по ссылке (реестр textureUrls,
        // слот 'terrain'). Пока не загрузилась (или ошибка/пустая
        // ссылка) — НЕ оставляем рельеф голым: зерно.
        std.map = textureUrls.get('terrain') ?? this.grainTex;
      }
      mat = std;
    }
    // масштаб текстуры: UV запечён wx/7 — повтор = 7/масштаб
    const allTex: THREE.Texture[] = [this.grainTex, this.albedoTex, this.normalTex, this.roughTex];
    const urlTex = textureUrls.get('terrain');
    if (urlTex) allTex.push(urlTex);
    for (const t of allTex) {
      t.repeat.set(rep, rep);
    }
    (mat as THREE.MeshStandardMaterial).wireframe = this.wire;
    this.mat = mat;
    // раздать новый материал всем построенным тайлам
    for (const t of this.tiles.values()) t.mesh.material = mat;
    if (old && old !== mat) old.dispose();
  }

  /** Применить настройки текстур/шейдера на лету (вкладка «Ресурсы») */
  setTextureConfig(cfg: AssetsSettings) {
    this.cfg = { ...cfg };
    // Task 38/39: сменилась ссылка в режиме 'url' — грузим новую
    // (реестр сам вызовет rebuildMaterial по готовности)
    const url = cfg.islandTextures === 'url' ? cfg.texUrls.terrain : '';
    if (textureUrls.url('terrain') !== url) textureUrls.setUrl('terrain', url);
    else this.rebuildMaterial();
  }

  /** Task 38/39: состояние загрузки своей текстуры рельефа (E2E) */
  urlTexState(): 'none' | 'loading' | 'ok' | 'error' { return textureUrls.state('terrain'); }

  /** Режим текстур по-прежнему включён (не 'off')? */
  texturesOn(): boolean { return this.cfg.islandTextures !== 'off'; }

  /** Телеметрия: текущий режим (E2E/настройки) */
  mode(): IslandTextureMode { return this.cfg.islandTextures; }
  shaderKind(): TerrainShaderKind { return this.cfg.terrainShader; }

  /** Каркас рельефа (переносится на пересобранный материал) */
  setWireframe(on: boolean) {
    this.wire = on;
    (this.mat as THREE.MeshStandardMaterial).wireframe = on;
  }

  stats(): TerrainStats {
    let near = 0, tris = 0;
    for (const t of this.tiles.values()) {
      if (t.near) near++;
      tris += (t.mesh.geometry.index?.count ?? 0) / 3;
    }
    return { tiles: this.tiles.size, nearTiles: near, queue: this.queue.length, tris: Math.round(tris), built: this.totalBuilt };
  }

  update(playerPos: THREE.Vector3, dt: number) {
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.5;
      this.refresh(playerPos);
    }
    let n = BUILD_PER_FRAME;
    while (n > 0 && this.queue.length) {
      this.queue.sort((a, b) => a.d - b.d);
      const job = this.queue.shift()!;
      if (this.tiles.has(job.key)) continue;
      this.buildTile(job.cx, job.cz, job.near, job.key);
      n--;
    }
  }

  /** Пересчёт множества нужных тайлов */
  private refresh(playerPos: THREE.Vector3) {
    const need = new Set<string>();
    const jobs: { key: string; cx: number; cz: number; near: boolean; d: number }[] = [];
    for (let i = 0; i < ISLANDS.length; i++) {
      const isl = ISLANDS[i];
      const dIsl = Math.hypot(playerPos.x - isl.cx, playerPos.z - isl.cz);
      if (dIsl > this.streamDist + isl.r * 1.45) continue;
      const cover = isl.r * 1.5;
      const x0 = Math.floor((isl.cx - cover) / TILE);
      const x1 = Math.floor((isl.cx + cover) / TILE);
      const z0 = Math.floor((isl.cz - cover) / TILE);
      const z1 = Math.floor((isl.cz + cover) / TILE);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const cx = gx * TILE + TILE / 2;
          const cz = gz * TILE + TILE / 2;
          const dx = Math.max(Math.abs(cx - isl.cx) - TILE / 2, 0);
          const dz = Math.max(Math.abs(cz - isl.cz) - TILE / 2, 0);
          if (dx * dx + dz * dz > cover * cover) continue;
          // в тайле есть суша? (вода непрозрачная: рельеф под
          // водой не нужен, кроме полосы у кромки)
          let land = false;
          for (let sx = -1; sx <= 1 && !land; sx++) {
            for (let sz = -1; sz <= 1 && !land; sz++) {
              if (heightAt(cx + sx * TILE / 3, cz + sz * TILE / 3) > -1.2) land = true;
            }
          }
          if (!land) continue;
          const key = `${gx}:${gz}`;
          need.add(key);
          const d = Math.hypot(cx - playerPos.x, cz - playerPos.z);
          const near = d < NEAR_DIST;
          const cur = this.tiles.get(key);
          if (cur && cur.near === near) continue;
          jobs.push({ key, cx, cz, near, d: near ? d - 10000 : d });
        }
      }
    }
    for (const [key, t] of this.tiles) {
      if (!need.has(key)) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.tiles.delete(key);
      }
    }
    this.queue = jobs.filter(j => !this.tiles.has(j.key) || this.tiles.get(j.key)!.near !== j.near);
  }

  /** Построить тайл: сетка, высоты, цвет, UV по миру, ЮБКА */
  private buildTile(cx: number, cz: number, near: boolean, key: string) {
    const seg = near ? NEAR_SEG : FAR_SEG;
    const g = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, 0, cz);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const step = TILE / seg;
    const e = Math.max(2, step);
    let islIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < ISLANDS.length; i++) {
      const d = Math.hypot(cx - ISLANDS[i].cx, cz - ISLANDS[i].cz) - ISLANDS[i].r;
      if (d < bestD) { bestD = d; islIdx = i; }
    }
    for (let i = 0; i < n; i++) {
      const wx = pos.getX(i), wz = pos.getZ(i);
      const h = heightAt(wx, wz);
      pos.setY(i, Math.max(h, -6));
      const hx = heightAt(wx + e, wz) - heightAt(wx - e, wz);
      const hz = heightAt(wx, wz + e) - heightAt(wx, wz - e);
      const slope = Math.hypot(hx, hz) / (2 * e);
      const c = terrainColorAt(islIdx, wx, wz, h, slope, this._color);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      uvs[i * 2] = wx / UV_BASE; uvs[i * 2 + 1] = wz / UV_BASE;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    // ЮБКА: стенка вниз по периметру (стыки LOD без дыр)
    const side = seg + 1;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const pArr = pos.array as Float32Array;
    const cArr = colors, nArr = nrm.array as Float32Array, uArr = uvs;
    const border: number[] = [];
    for (let i = 0; i < side; i++) border.push(i);
    for (let i = 0; i < side; i++) border.push(seg * side + i);
    for (let j = 0; j < side; j++) border.push(j * side);
    for (let j = 0; j < side; j++) border.push(j * side + seg);
    const nb = border.length;
    const skirtPos = new Float32Array(nb * 3);
    const skirtCol = new Float32Array(nb * 3);
    const skirtNrm = new Float32Array(nb * 3);
    const skirtUv = new Float32Array(nb * 2);
    for (let k = 0; k < nb; k++) {
      const vi = border[k];
      skirtPos[k * 3] = pArr[vi * 3];
      skirtPos[k * 3 + 1] = pArr[vi * 3 + 1] - SKIRT;
      skirtPos[k * 3 + 2] = pArr[vi * 3 + 2];
      skirtCol[k * 3] = cArr[vi * 3] * 0.82;
      skirtCol[k * 3 + 1] = cArr[vi * 3 + 1] * 0.82;
      skirtCol[k * 3 + 2] = cArr[vi * 3 + 2] * 0.82;
      skirtNrm[k * 3] = nArr[vi * 3];
      skirtNrm[k * 3 + 1] = nArr[vi * 3 + 1];
      skirtNrm[k * 3 + 2] = nArr[vi * 3 + 2];
      skirtUv[k * 2] = uArr[vi * 2];
      skirtUv[k * 2 + 1] = uArr[vi * 2 + 1];
    }
    const idx: number[] = [];
    // ЮБКА: quad между СОСЕДНИМИ кромочными вершинами. Дубль кромки
    // №k живёт на позиции n + k, где k — ПОЗИЦИЯ В МАССИВЕ border.
    // ФИКС Task 38: раньше pushQuad получал ИНДЕКС ВЕРШИНЫ (до
    // seg²·2), а не позицию в border — для нижней/боковых кромок
    // индексы уходили ЗА ПРЕДЕЛЫ буфера вершин, и WebGL рисовал
    // мусорные треугольники из видеопамяти: чёрные «шторы»,
    // висящие «паруса», пики у корабля. flip — обход наружу для
    // кромок, идущих в обратную сторону (низ и левый борт).
    const pushQuad = (k: number, k2: number, flip = false) => {
      const a = border[k], b = border[k2];
      const a2 = n + k, b2 = n + k2;
      if (flip) idx.push(b, a, a2, b, a2, b2);
      else idx.push(a, b, b2, a, b2, a2);
    };
    for (let i = 0; i + 1 < side; i++) pushQuad(i, i + 1);                             // z=−TILE/2, наружу −Z
    for (let i = 0; i + 1 < side; i++) pushQuad(side + i, side + i + 1, true);         // z=+TILE/2, наружу +Z
    for (let j = 0; j + 1 < side; j++) pushQuad(2 * side + j, 2 * side + j + 1, true); // x=−TILE/2, наружу −X
    for (let j = 0; j + 1 < side; j++) pushQuad(3 * side + j, 3 * side + j + 1);       // x=+TILE/2, наружу +X
    const merged = new THREE.BufferGeometry();
    const allPos = new Float32Array(n * 3 + nb * 3);
    allPos.set(pArr); allPos.set(skirtPos, n * 3);
    const allCol = new Float32Array(n * 3 + nb * 3);
    allCol.set(cArr); allCol.set(skirtCol, n * 3);
    const allNrm = new Float32Array(n * 3 + nb * 3);
    allNrm.set(nArr); allNrm.set(skirtNrm, n * 3);
    const allUv = new Float32Array(n * 2 + nb * 2);
    allUv.set(uArr); allUv.set(skirtUv, n * 2);
    const baseIdx = Array.from(g.index!.array as ArrayLike<number>);
    merged.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(allCol, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(allNrm, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
    merged.setIndex(baseIdx.concat(idx.map(v => v)));
    g.dispose();
    const mesh = new THREE.Mesh(merged, this.mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.userData.wire = 'island';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.tiles.set(key, { mesh, near });
    this.totalBuilt++;
  }

  /** удалить все тайлы */
  clear() {
    for (const t of this.tiles.values()) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.queue = [];
  }
}
