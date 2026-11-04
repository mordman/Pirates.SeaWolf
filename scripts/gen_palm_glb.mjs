// Генерация демонстрационной GLB-модели пальмы для системы замены
// деталей (Task 30): красивее процедурной — изогнутый ствол из
// сегментов, 9 листьев-полосок с прогибом, кокосы; вершины < 1200,
// треугольники ~316 (быстрый рендер сотен инстансов).
// Запуск: node scripts/gen_palm_glb.mjs
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// --- шимы Blob/FileReader для GLTFExporter в Node ---
// (экспортёр собирает бинарник через new Blob(parts) + FileReader.onloadend)
if (typeof globalThis.Blob === 'undefined' || globalThis.Blob.length === 0) {
  globalThis.Blob = class {
    constructor(parts) {
      this.parts = parts || [];
      this.size = this.parts.reduce((a, p) => a + (p.byteLength ?? p.length ?? 0), 0);
    }
  };
}
if (typeof globalThis.FileReader === 'undefined' || globalThis.FileReader.length === 0) {
  globalThis.FileReader = class {
    onloadend = null; onerror = null; result = null;
    readAsArrayBuffer(blob) {
      const parts = blob.parts || [];
      const total = parts.reduce((a, p) => a + (p.byteLength ?? p.length ?? 0), 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) {
        const u = p instanceof Uint8Array ? p : new Uint8Array(p.buffer ?? p);
        out.set(u, o); o += p.byteLength ?? p.length ?? 0;
      }
      this.result = out.buffer;
      queueMicrotask(() => this.onloadend?.());
    }
    readAsDataURL() { queueMicrotask(() => this.onloadend?.()); }
  };
}

const rng = (() => { let s = 20261103 >>> 0; return () => {
  s = (s + 0x6d2b79f5) >>> 0; let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}; })();

// цвет с лёгким джиттером → вершинные цвета
function paint(g, hex, jitter = 0.05) {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (rng() - 0.5) * 2 * jitter;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const parts = [];

// --- изогнутый ствол: 8 сегментов, каждый наклоняется сильнее ---
const SEG = 8, SEG_H = 1.08, LEAN = 0.13;
let x = 0, z = 0;
let leanX = 0, leanZ = 0;
const leanTo = [0.55, -0.35]; // куда тянется макушка
for (let i = 0; i < SEG; i++) {
  const rBot = 0.26 - i * 0.014, rTop = 0.26 - (i + 1) * 0.014;
  leanX += (leanTo[0] - leanX) * 0.16; leanZ += (leanTo[1] - leanZ) * 0.16;
  const g = new THREE.CylinderGeometry(rTop, rBot, SEG_H, 5, 1, true);
  // сегмент стоит серединой в текущей точке, наклонён по累积ленному крену
  const ang = Math.atan2(leanZ, leanX) * 0.5;
  const tilt = Math.hypot(leanX, leanZ) * 0.45;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x + leanX * 0.1, i * SEG_H + SEG_H / 2, z + leanZ * 0.1),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(ang) * tilt, 0, -Math.cos(ang) * tilt)),
    new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  // кора темнее к низу, светлее к верхушке
  const t = i / SEG;
  parts.push(paint(g, new THREE.Color().setHSL(0.08, 0.38, 0.26 + t * 0.1).getHex(), 0.05));
  x += leanX * 0.22; z += leanZ * 0.22;
}
const crownX = x, crownZ = z, crownY = SEG * SEG_H;

// --- 9 листьев: полоска из 3 сегментов с прогибом вниз ---
for (let f = 0; f < 9; f++) {
  const a = (f / 9) * Math.PI * 2 + 0.31;
  const len = 2.6 + rng() * 0.9;
  const frond = new THREE.BufferGeometry();
  const pos = [], col = [], idx = [];
  const SEGS = 3, W = 0.30;
  const c0 = new THREE.Color(0x2f7a2c), c1 = new THREE.Color(0x54a33a);
  for (let s = 0; s <= SEGS; s++) {
    const t = s / SEGS;
    const r = t * len;
    const drop = Math.pow(t, 2.1) * 1.9;        // прогиб вниз
    const rise = Math.sin(t * 1.2) * 0.55;       // сначала вверх
    const w = W * (1 - t * 0.85);                // сужение к концу
    const cx = crownX + Math.cos(a) * r, cz = crownZ + Math.sin(a) * r;
    const cy = crownY + 0.15 + rise - drop;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(cx - px, cy, cz - pz, cx + px, cy, cz + pz);
    const c = c0.clone().lerp(c1, t);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (s < SEGS) {
      const b = s * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  frond.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  frond.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  frond.setIndex(idx);
  frond.computeVertexNormals();
  parts.push(frond);
}

// --- кокосы у кроны: 3 штуки ---
for (let k = 0; k < 3; k++) {
  const a = (k / 3) * Math.PI * 2 + 0.8;
  const g = new THREE.SphereGeometry(0.17, 6, 4);
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(
    crownX + Math.cos(a) * 0.3, crownY - 0.3, crownZ + Math.sin(a) * 0.3));
  parts.push(paint(g, 0x5c4322, 0.08));
}

// --- верхушка ствола под листьями ---
{
  const g = new THREE.ConeGeometry(0.2, 0.5, 5);
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(crownX, crownY + 0.1, crownZ));
  parts.push(paint(g, 0x8a6a44, 0.06));
}

let merged = mergeGeometries(parts, false);
if (!merged) {
  // у частей разные наборы атрибутов (uv есть у примитивов, нет у полосок)
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
  }
  merged = mergeGeometries(parts, false);
}
if (!merged) { for (const g of parts) if (g.index) g.toNonIndexed(); merged = mergeGeometries(parts, false); }
merged.computeVertexNormals();

// базис на y=0, высота ≈ 8.6
merged.computeBoundingBox();
const bb = merged.boundingBox;
merged.translate(0, -bb.min.y, 0);
merged.computeBoundingBox();
const tris = merged.index ? merged.index.count / 3 : merged.getAttribute('position').count / 3;
const verts = merged.getAttribute('position').count;
console.log(`palm_demo: ${verts} вершин, ${Math.round(tris)} треугольников, высота ${(merged.boundingBox.max.y - merged.boundingBox.min.y).toFixed(2)} м`);

// --- экспорт GLB ---
const exporter = new GLTFExporter();
const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
const glb = await exporter.parseAsync(mesh, { binary: true });
mkdirSync('public/models', { recursive: true });
writeFileSync('public/models/palm_demo.glb', Buffer.from(glb));
console.log('OK -> public/models/palm_demo.glb', Buffer.from(glb).length, 'байт');
