import * as THREE from 'three';
import { ISLANDS, heightAt, terrainColorAt } from './world';

// ============================================================
// РЕЛЬЕФ ОСТРОВОВ — СТРИМЕР ТАЙЛОВ (Task 36).
// Мир вырос в 100 раз: острова 1–3.3 км радиусом не вытянуть
// одним мешем на остров. Рельеф собирается ТАЙЛАМИ вокруг
// игрока: дальние — ячейка 24 м (силуэт с моря), ближние
// (< 900 м) — ячейка 8 м (ходьба, пляжи, тропы, обрывы).
// У каждого тайла ЮБКА (skirt) по периметру — стыки LOD без дыр.
// Построение — через ОЧЕРЕДЬ (без фризов). ЦВЕТ —
// terrainColorAt; ТЕКСТУРА — процедурное зерно (настройка).
// ============================================================

const TILE = 480;            // сторона тайла, м
const FAR_SEG = 20;          // дальний тайл: ячейка 24 м
const NEAR_SEG = 60;         // ближний тайл: ячейка 8 м
const NEAR_DIST = 900;       // радиус детальных тайлов вокруг игрока
const SKIRT = 10;            // глубина юбки, м
const BUILD_PER_FRAME = 4;   // построить тайлов за кадр

/** Процедурная текстура зерна рельефа: мелкая крошка + средние
 *  пятна, нейтральный серый вокруг 1.0 (умножается на цвет вершин) */
function makeDetailTexture(): THREE.DataTexture {
  const S = 256;
  const data = new Uint8Array(S * S * 3);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const fine = vnoise(i * 0.9, j * 0.9);
      const mid = vnoise(i * 0.11 + 37, j * 0.11 + 91);
      let v = 0.5 + (fine - 0.5) * 0.34 + (mid - 0.5) * 0.30;
      v = Math.max(0, Math.min(1, v));
      const g = Math.round(200 * (0.78 + v * 0.38));
      const o = (j * S + i) * 3;
      data[o] = g; data[o + 1] = g; data[o + 2] = g;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
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
  private mat: THREE.MeshStandardMaterial;
  private detailTex: THREE.DataTexture;
  private refreshT = -1;
  private totalBuilt = 0;
  private _color = new THREE.Color();

  constructor(opts?: { textures?: boolean; streamDist?: number }) {
    if (opts?.streamDist) this.streamDist = opts.streamDist;
    this.detailTex = makeDetailTexture();
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0,
      map: (opts?.textures ?? true) ? this.detailTex : null,
    });
    this.group.matrixAutoUpdate = false;
  }

  /** Включить/выключить текстуру зерна (настройка) */
  setTextures(on: boolean) {
    this.mat.map = on ? this.detailTex : null;
    this.mat.needsUpdate = true;
  }

  texturesOn(): boolean { return this.mat.map === this.detailTex; }

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
      uvs[i * 2] = wx / 7; uvs[i * 2 + 1] = wz / 7;
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
    const pushQuad = (a: number, b: number) => {
      const a2 = n + a, b2 = n + b;
      idx.push(a, b, b2, a, b2, a2);
    };
    for (let i = 0; i + 1 < side; i++) pushQuad(border[i], border[i + 1]);
    for (let i = 0; i + 1 < side; i++) pushQuad(border[side + i], border[side + i + 1]);
    for (let j = 0; j + 1 < side; j++) pushQuad(border[2 * side + j], border[2 * side + j + 1]);
    for (let j = 0; j + 1 < side; j++) pushQuad(border[3 * side + j], border[3 * side + j + 1]);
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
