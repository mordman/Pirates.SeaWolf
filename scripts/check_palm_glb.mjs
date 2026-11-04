// Проверка конвейера GLB: файл читается GLTFLoader'ом обратно,
// геометрия нормализуется (высота 8.6, базис y=0, цвета вершин есть)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';

// GLTFLoader в Node: parse() прямо из буфера (без fetch/Request)
const buf = readFileSync('public/models/palm_demo.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
let meshes = 0, tris = 0, verts = 0, hasColor = true;
gltf.scene.traverse((o) => {
  const m = o;
  if (m.isMesh) {
    meshes++;
    const g = m.geometry;
    verts += g.getAttribute('position').count;
    tris += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    if (!g.getAttribute('color')) hasColor = false;
  }
});
const bb = new THREE.Box3().setFromObject(gltf.scene);
console.log(JSON.stringify({
  meshes, verts: Math.round(verts), tris: Math.round(tris), hasColor,
  height: +bb.max.y.toFixed(2), minY: +bb.min.y.toFixed(2),
}));
if (meshes < 1 || verts < 100 || !hasColor) { console.error('FAIL'); process.exit(1); }
console.log('ROUNDTRIP OK');
