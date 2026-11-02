import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng';
import { buildFigure, rollTraits, mulberry32 } from '../ship/crew';
import type { PortDef, IslandDef } from './world';

// ============================================================
// Рыбацкие детали каждой гавани (по фидбеку: «причалы с лодками,
// краболовки и т.п. Рыбацкие лодки, лодки можно топить»):
//  - шлюпки у пирса (качаются на волнах) и вытащенные на песок,
//  - стопки краболовок на пирсе и берегу,
//  - вешала с развешенной рыбой, сети, поплавки-вехи на воде,
//  - рыбаки на пирсе (те же фигурки, что и экипаж/пираты).
// ЛОДКИ ТОПЯТСЯ: разрыв снаряда рядом (combat → world.hitBoats)
// разбивает шлюпку в щепу, и она уходит под воду с креном.
// Вся геометрия слита в единичные меши (mergeGeometries + цвет
// вершин) — одна лодка = один draw call.
// ============================================================

/** Лодка гавани: на воде (качается) или на берегу; тонет от снарядов */
export interface WorldBoat {
  mesh: THREE.Mesh;
  x: number; z: number;
  yaw: number;
  /** true — на воде (следует за волнами), false — на песке */
  floating: boolean;
  /** опорная высота (вода или пляж) */
  baseY: number;
  sinking: boolean;
  /** 0..1 прогресс затопления */
  sunkT: number;
  /** направление крена при затоплении */
  rollDir: number;
  phase: number;
  scale: number;
}

/** Рыбацкий декор одной гавани */
export interface FishingVillage {
  /** вся статика (лодки/краболовки/вешала/сети/поплавки/рыбаки) */
  group: THREE.Group;
  boats: WorldBoat[];
  buoys: { mesh: THREE.Mesh; x: number; z: number; phase: number }[];
  /** вешала с рыбой (для прицельного кадрирования/E2E) */
  racks: { x: number; z: number }[];
  fishermen: { g: THREE.Group; phase: number }[];
  /** Поразить лодки в радиусе r от (x,z): щепа + затопление.
   *  Возвращает число поражённых лодок (для сообщения/телеметрии) */
  hitBoats(x: number, z: number, r: number): WorldBoat[];
  update(time: number, dt: number, waterHeight: (x: number, z: number, t: number) => number): void;
}

// ---------- геометрия с цветом (как в world.ts) ----------
function paint(g: THREE.BufferGeometry, color: number, jitter = 0.06): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (Math.random() - 0.5) * 2 * jitter;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function tf(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s));
  g.applyMatrix4(m);
  return g;
}

// ---------- шлюпка (одна геометрия на весь мир) ----------
const WOOD = 0x7d5f3a, WOOD_DK = 0x54401f, TRIM = 0x9a7a4c, FISH = 0xaebfc9;
let rowboatGeo: THREE.BufferGeometry | null = null;
function getRowboatGeo(): THREE.BufferGeometry {
  if (rowboatGeo) return rowboatGeo;
  const p: THREE.BufferGeometry[] = [];
  // днище (киль по оси Z, нос +Z)
  p.push(paint(tf(new THREE.BoxGeometry(0.92, 0.12, 3.5), 0, 0.06, 0), WOOD_DK));
  // борта — чуть развалены
  for (const s of [-1, 1]) {
    p.push(paint(tf(new THREE.BoxGeometry(0.08, 0.4, 3.4), s * 0.52, 0.26, 0, 0, 0, s * -0.1), WOOD));
    // привальный брус поверх борта
    p.push(paint(tf(new THREE.BoxGeometry(0.11, 0.06, 3.42), s * 0.57, 0.47, 0, 0, 0, s * -0.1), TRIM));
  }
  // форштевень и ахтерштевень (транцы)
  p.push(paint(tf(new THREE.BoxGeometry(0.9, 0.42, 0.09), 0, 0.26, 1.72, 0.14), WOOD));
  p.push(paint(tf(new THREE.BoxGeometry(0.82, 0.4, 0.09), 0, 0.25, -1.7, -0.12), WOOD));
  // банки-скамьи
  for (const z of [0.65, -0.75]) {
    p.push(paint(tf(new THREE.BoxGeometry(0.95, 0.06, 0.26), 0, 0.38, z), TRIM));
  }
  // мачточка с реей у рыболовной шлюпки
  p.push(paint(tf(new THREE.CylinderGeometry(0.035, 0.05, 1.7, 5), 0, 1.0, 0.55), WOOD_DK));
  p.push(paint(tf(new THREE.CylinderGeometry(0.028, 0.028, 1.1, 4), 0, 1.62, 0.55, 0, 0, Math.PI / 2), WOOD_DK));
  // пара вёсел уложена поперёк
  for (const x of [-0.62, 0.62]) {
    p.push(paint(tf(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 4), x, 0.5, -0.1, Math.PI / 2, 0.18, Math.PI / 2), 0x8a6a42));
  }
  // улов в корме — горка серебристой рыбы
  for (const [fx, fy, fz] of [[-0.16, 0.5, -1.25], [0.14, 0.5, -1.32], [0, 0.55, -1.2], [-0.1, 0.46, -1.42]] as [number, number, number][]) {
    p.push(paint(tf(new THREE.SphereGeometry(0.11, 5, 4), fx, fy, fz).scale(1, 0.55, 2.1) as THREE.BufferGeometry, FISH, 0.1));
  }
  rowboatGeo = mergeGeometries(p)!;
  return rowboatGeo;
}

// ---------- краболовка: каркасная клетка ----------
let trapGeo: THREE.BufferGeometry | null = null;
function getTrapGeo(): THREE.BufferGeometry {
  if (trapGeo) return trapGeo;
  const p: THREE.BufferGeometry[] = [];
  const W = 0.72, H = 0.38, D = 0.5;
  // рамки низ/верх
  for (const y of [0.02, H]) {
    p.push(paint(tf(new THREE.BoxGeometry(W, 0.035, D), 0, y, 0), WOOD_DK));
  }
  // стойки по углам
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.push(paint(tf(new THREE.BoxGeometry(0.04, H, 0.04), sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02)), WOOD_DK));
  }
  // решётка: продольные рейки по бокам
  for (const y of [0.13, 0.26]) {
    for (const sx of [-1, 1]) {
      p.push(paint(tf(new THREE.BoxGeometry(0.025, 0.025, D), sx * W / 2, y, 0), 0x4a4a50));
    }
    p.push(paint(tf(new THREE.BoxGeometry(W, 0.025, 0.025), 0, y, D / 2), 0x4a4a50));
    p.push(paint(tf(new THREE.BoxGeometry(W, 0.025, 0.025), 0, y, -D / 2), 0x4a4a50));
  }
  // «горло»-воронка сбоку (вход краба)
  p.push(paint(tf(new THREE.TorusGeometry(0.1, 0.02, 4, 8), 0, H * 0.55, D / 2 + 0.01, Math.PI / 2), 0x4a4a50));
  trapGeo = mergeGeometries(p)!;
  return trapGeo;
}

// ---------- вешало с рыбой ----------
let rackGeo: THREE.BufferGeometry | null = null;
function getRackGeo(): THREE.BufferGeometry {
  if (rackGeo) return rackGeo;
  const p: THREE.BufferGeometry[] = [];
  const W = 2.6, H = 1.7;
  // козлы-опоры (Х-образные) + перекладина
  for (const sx of [-1, 1]) {
    p.push(paint(tf(new THREE.CylinderGeometry(0.045, 0.055, 2.1, 4), sx * W / 2, H / 2, 0, 0, 0, sx * 0.32), WOOD_DK));
    p.push(paint(tf(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 4), sx * W / 2, H / 2, 0.24, 0, 0, sx * -0.32), WOOD_DK));
  }
  p.push(paint(tf(new THREE.CylinderGeometry(0.05, 0.05, W + 0.5, 5), 0, H, 0.1, 0, 0, Math.PI / 2), WOOD));
  // развешенная рыба (спинками вниз, хвостами вверх) — крупно и
  // контрастно, чтобы читалась с дистанции
  const rng = new RNG(777);
  for (let i = 0; i < 9; i++) {
    const fx = -W / 2 + 0.3 + (i / 8) * (W - 0.6) + rng.range(-0.08, 0.08);
    p.push(paint(tf(new THREE.BoxGeometry(0.02, 0.18, 0.02), fx, H - 0.12, 0.1), WOOD_DK)); // шнур
    p.push(paint(tf(new THREE.SphereGeometry(0.1, 5, 4), fx, H - 0.26, 0.1).scale(0.9, 1, 2.7) as THREE.BufferGeometry, FISH, 0.15));
  }
  rackGeo = mergeGeometries(p)!;
  return rackGeo;
}

// ---------- поплавок-веха над подводной краболовкой ----------
let buoyGeo: THREE.BufferGeometry | null = null;
function getBuoyGeo(): THREE.BufferGeometry {
  if (buoyGeo) return buoyGeo;
  const p: THREE.BufferGeometry[] = [];
  p.push(paint(tf(new THREE.SphereGeometry(0.16, 8, 6), 0, 0.1, 0), 0xd9722c, 0.08));
  p.push(paint(tf(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 4), 0, 0.45, 0), WOOD_DK));
  p.push(paint(tf(new THREE.BoxGeometry(0.3, 0.18, 0.015), 0.16, 0.68, 0), 0xe8e4d8));
  buoyGeo = mergeGeometries(p)!;
  return buoyGeo;
}

// ---------- ворох сетей с поплавками ----------
let netGeo: THREE.BufferGeometry | null = null;
function getNetGeo(): THREE.BufferGeometry {
  if (netGeo) return netGeo;
  const p: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.TorusGeometry(0.55 - i * 0.09, 0.09, 5, 10);
    p.push(paint(tf(t, (i - 1) * 0.1, 0.12 + i * 0.09, (i - 1) * 0.14, Math.PI / 2 + i * 0.35, i * 0.7), 0x8a7a56, 0.1));
  }
  // пробковые поплавки по краю
  for (const [cx, cz] of [[0.5, 0.2], [-0.42, -0.3], [0.1, -0.52]] as [number, number][]) {
    p.push(paint(tf(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 6), cx, 0.3, cz, Math.PI / 2, 0.5), 0xc9a86a));
  }
  netGeo = mergeGeometries(p)!;
  return netGeo;
}

const VILLAGE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.03 });

// ---------- пенное кольцо по ватерлинии шлюпок (Task 28) ----------
// Плоская полупрозрачная лента вокруг корпуса на уровне воды: без
// неё плоскость океана ПРОРЕЗАЛА борта деревенских шлюпок линией
// («вода режет лодку»). Кольцо общее для всех лодок — один буфер.
let foamRingGeo: THREE.BufferGeometry | null = null;
const FOAM_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xe9f3f5, transparent: true, opacity: 0.5,
  depthWrite: false, side: THREE.DoubleSide,
});
function getFoamRingGeo(): THREE.BufferGeometry {
  if (foamRingGeo) return foamRingGeo;
  // «стадион» — прямоугольник с полукруглыми оконечностями (как
  // обвод шлюпки): внутренний контур у борта, внешний на 0.3 м
  const inner = 0.10, outer = 0.34, y = 0.13;
  const hw = 0.5, hl = 1.78, cap = hw;
  const N = 28;
  const pos: number[] = [];
  const idx: number[] = [];
  const Z = hl - cap;
  // t 0..1 — обход контура: левый борт → нос → правый борт → корма
  const stadium = (t: number, r: number): [number, number] => {
    const q = t * 4;
    if (q < 1) return [-(hw + r), -Z + q * 2 * Z];
    if (q < 2) {
      const a = -Math.PI / 2 + (q - 1) * Math.PI;
      return [Math.sin(a) * (cap + r), Z + Math.cos(a) * (cap + r)];
    }
    if (q < 3) return [(hw + r), Z - (q - 2) * 2 * Z];
    const a = Math.PI / 2 + (q - 3) * Math.PI;
    return [Math.sin(a) * (cap + r), -Z + Math.cos(a) * (cap + r)];
  };
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const [ix, iz] = stadium(t, inner);
    const [ox, oz] = stadium(t, outer);
    pos.push(ix, y, iz, ox, y, oz);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % N) * 2, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  foamRingGeo = g;
  return g;
}
/** Дочерняя пенная лента для шлюпки (деревни и береговой флот) */
function makeFoamRing(): THREE.Mesh {
  const m = new THREE.Mesh(getFoamRingGeo(), FOAM_RING_MAT);
  m.renderOrder = 2;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Собрать рыбацкий декор гавани: лодки у пирса и на берегу,
 *  краболовки, вешала, сети, поплавки, рыбаки */
export function buildFishingVillage(port: PortDef, rng: RNG, heightAt: (x: number, z: number) => number): FishingVillage {
  const group = new THREE.Group();
  const dir = port.dir;
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);
  const dirA = Math.atan2(dir.x, dir.z);
  const dockLen = [26, 36, 46, 52][port.tier];
  const shore = port.dockEnd.clone().addScaledVector(dir, -(dockLen - 4));
  const boats: WorldBoat[] = [];
  const buoys: FishingVillage['buoys'] = [];
  const racks: FishingVillage['racks'] = [];
  const fishermen: FishingVillage['fishermen'] = [];

  const addBoat = (x: number, z: number, yaw: number, floating: boolean, scale = 1) => {
    const mesh = new THREE.Mesh(getRowboatGeo(), VILLAGE_MAT);
    // тени выкл: 79+ шлюпок по всему архипелагу — дорого в shadow-pass,
    // а мелкие тени у причалов не читаются
    mesh.castShadow = false;
    // пенная лента по ватерлинии (Task 28): вода «обтекает» борта
    if (floating) mesh.add(makeFoamRing());
    const baseY = floating ? 0 : Math.max(heightAt(x, z), 0.1) + 0.1;
    mesh.position.set(x, baseY, z);
    mesh.rotation.y = yaw;
    mesh.scale.setScalar(scale);
    group.add(mesh);
    boats.push({
      mesh, x, z, yaw, floating, baseY,
      sinking: false, sunkT: 0, rollDir: rng.next() < 0.5 ? -1 : 1,
      phase: rng.next() * 6.28, scale,
    });
  };

  // --- шлюпки у пирса: вдоль бортов причала, носом к морю ---
  const nMoored = 1 + Math.min(2, port.tier); // пристань 1 .. город 3
  for (let i = 0; i < nMoored; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const t = 0.3 + (i / 2) * 0.22;
    const p = shore.clone().addScaledVector(dir, dockLen * t)
      .addScaledVector(perp, side * 3.4);
    addBoat(p.x, p.z, dirA + (rng.next() - 0.5) * 0.2, true, rng.range(0.86, 1.05));
  }
  // --- вытащенные на песок: по бокам от пирса, килем на склон ---
  const nBeached = 1 + Math.min(2, port.tier);
  for (let i = 0; i < nBeached; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const p = shore.clone().addScaledVector(dir, -6 - rng.range(0, 8))
      .addScaledVector(perp, side * (9 + rng.range(0, 9)));
    const h = heightAt(p.x, p.z);
    if (h < 0.15 || h > 2.6) continue; // только пологий пляж
    addBoat(p.x, p.z, dirA + (rng.next() - 0.5) * 0.8, false, rng.range(0.82, 1));
  }

  // --- краболовки: стопки на пирсе (у берега) и на песке ---
  const addTrapStack = (x: number, y: number, z: number, ry: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(getTrapGeo(), VILLAGE_MAT);
      m.position.set(x + (rng.next() - 0.5) * 0.15, y + 0.02 + k * 0.37, z + (rng.next() - 0.5) * 0.15);
      m.rotation.y = ry + (rng.next() - 0.5) * 0.5;
      group.add(m);
    }
  };
  const tp = shore.clone().addScaledVector(dir, 4);
  addTrapStack(tp.x + perp.x * 1.5, 1.32, tp.z + perp.z * 1.5, dirA, 3);
  addTrapStack(tp.x - perp.x * 1.6, 1.32, tp.z - perp.z * 1.6, dirA + 0.4, 2);
  const bs = shore.clone().addScaledVector(dir, -3).addScaledVector(perp, 6.5);
  const bsh = heightAt(bs.x, bs.z);
  if (bsh > 0.3 && bsh < 2.2) addTrapStack(bs.x, bsh, bs.z, dirA + 1.2, 3);

  // --- вешала с рыбой и сети на берегу ---
  for (let i = 0; i < 2; i++) {
    const p = shore.clone().addScaledVector(dir, -4 - i * 7)
      .addScaledVector(perp, i === 0 ? -7.5 : 8.5);
    const h = heightAt(p.x, p.z);
    if (h < 0.25 || h > 2.4) continue;
    const rack = new THREE.Mesh(i === 0 ? getRackGeo() : getRackGeo(), VILLAGE_MAT);
    rack.position.set(p.x, h - 0.05, p.z);
    rack.rotation.y = dirA + Math.PI / 2 + (rng.next() - 0.5) * 0.6;
    group.add(rack);
    racks.push({ x: p.x, z: p.z });
  }
  const np = shore.clone().addScaledVector(dir, -2).addScaledVector(perp, -6);
  const nph = heightAt(np.x, np.z);
  if (nph > 0.25 && nph < 2.2) {
    const net = new THREE.Mesh(getNetGeo(), VILLAGE_MAT);
    net.position.set(np.x, nph, np.z);
    net.rotation.y = rng.next() * 6.28;
    group.add(net);
  }

  // --- поплавки-вехи: цепочка за пирсом (подводные краболовки) ---
  for (let i = 0; i < 4; i++) {
    const p = port.dockEnd.clone().addScaledVector(dir, 7 + i * 5.5)
      .addScaledVector(perp, (i % 2 === 0 ? 1 : -1) * rng.range(2.5, 6));
    const m = new THREE.Mesh(getBuoyGeo(), VILLAGE_MAT);
    m.position.set(p.x, 0.08, p.z);
    m.rotation.y = rng.next() * 6.28;
    group.add(m);
    buoys.push({ mesh: m, x: p.x, z: p.z, phase: rng.next() * 6.28 });
  }

  // --- рыбаки на пирсе (те же фигурки, что экипаж/пираты) ---
  const frnd = mulberry32((port.island.cx * 31 + port.island.cz * 17 + 99) | 0);
  for (let i = 0; i < 2; i++) {
    const role = 'watch';
    const fig = buildFigure(role, rollTraits(frnd, role), Math.floor(frnd() * 99999));
    const p = shore.clone().addScaledVector(dir, dockLen * (0.34 + i * 0.3))
      .addScaledVector(perp, i === 0 ? 1.55 : -1.55);
    fig.group.position.set(p.x, 1.31, p.z);
    // смотрят в сторону моря / на свою шлюпку
    fig.group.rotation.y = i === 0
      ? dirA + Math.PI / 2 + (frnd() - 0.5) * 0.8
      : dirA - Math.PI / 2 + (frnd() - 0.5) * 0.8;
    fig.group.traverse(ob => { ob.castShadow = false; ob.receiveShadow = false; });
    group.add(fig.group);
    fishermen.push({ g: fig.group, phase: frnd() * 6.28 });
  }

  const vis: FishingVillage = {
    group, boats, buoys, racks, fishermen,
    hitBoats(x, z, r) {
      const hit: WorldBoat[] = [];
      for (const b of boats) {
        if (b.sinking) continue;
        if (Math.hypot(b.x - x, b.z - z) > r + 2.4) continue;
        b.sinking = true;
        b.sunkT = 0;
        if (!b.floating) {
          // выброшенную на песок шлюпку разносит в щепу сразу
          b.mesh.visible = false;
        }
        hit.push(b);
      }
      return hit;
    },
    update(time, dt, waterHeight) {
      for (const b of boats) {
        if (b.sinking) {
          if (!b.floating && !b.mesh.visible) continue;
          b.sunkT = Math.min(1, b.sunkT + dt / 3.2);
          const k = b.sunkT * b.sunkT;
          b.mesh.position.y = b.baseY - k * 2.6 * b.scale;
          b.mesh.rotation.z += b.rollDir * dt * 0.22;
          b.mesh.rotation.x += dt * 0.1;
          // пенная лента тонет вместе с лодкой — прячем сразу
          for (const c of b.mesh.children) c.visible = false;
          if (b.sunkT >= 1) b.mesh.visible = false;
          continue;
        }
        if (b.floating) {
          // шлюпка на воде: следует за волнами + лёгкая качка.
          // Task 28: сидит ПОВЫШЕ (0.03·масштаб вместо 0.1) —
          // вода не «режет» борта, лента пены у самой воды
          const wy = waterHeight(b.x, b.z, time);
          b.mesh.position.y = wy - 0.03 * b.scale;
          b.mesh.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.055;
          b.mesh.rotation.x = Math.sin(time * 0.68 + b.phase * 1.3) * 0.035;
        }
      }
      for (const bu of buoys) {
        bu.mesh.position.y = waterHeight(bu.x, bu.z, time) + 0.06;
        bu.mesh.rotation.z = Math.sin(time * 1.15 + bu.phase) * 0.16;
      }
      for (const f of fishermen) {
        f.g.rotation.z = Math.sin(time * 1.25 + f.phase) * 0.03;
      }
    },
  };
  return vis;
}

// ============================================================
// БЕРЕГОВОЙ РЫБАЦКИЙ ФЛОТ (Task 28: «добавь больше лодок с
// рыбаками у островов»). Лодки с РЫБАКАМИ дрейфуют вдоль берегов
// ВСЕХ островов архипелага — не только у пирсов гаваней:
//  - в каждой лодке 1-2 рыбака (сидят на банках) с удилищами
//    за бортом; изредка всплеск у поплавка — поклёвка;
//  - лодки медленно дрейфуют по кругу острова у самой отмели,
//    качаются на волнах (посадка ПОВЫШЕ + пенная лента —
//    вода обтекает борта, Task 28);
//  - разрыв снаряда рядом топит лодку вместе с рыбаком
//    (combat → game.sinkBoatsAt → world.hitBoats).
// Каждая лодка — ОДИН меш: корпус + фигуры + удилища запечены
// в общую геометрию (6 вариантов переиспользуются) + дочерняя
// пенная лента — 2 draw call на лодку, обновляются только
// лодки в радиусе 3.6 км от игрока.
// ============================================================

/** Лодка берегового флота: дрейф в полярных координатах острова */
export interface CoastBoat extends WorldBoat {
  cx: number; cz: number;   // остров-хозяин
  ang: number;              // угол у острова, рад
  rad: number;              // радиус от центра острова, м
  w: number;                // угловая скорость дрейфа, рад/с
  /** кончики удилищ в ЛОКАЛЬНЫХ координатах (всплески поклёвки) */
  rodTips: THREE.Vector3[];
}

export interface CoastFleet {
  group: THREE.Group;
  boats: CoastBoat[];
  /** сколько рыбаков в лодках (телеметрия/E2E) */
  fishermen: number;
  /** привязать эффекты (всплески поклёвки) — game.ts после создания мира */
  setFx(fn: (x: number, y: number, z: number, a: number) => void): void;
  hitBoats(x: number, z: number, r: number): WorldBoat[];
  update(time: number, dt: number, waterHeight: (x: number, z: number, t: number) => number,
    playerPos: { x: number; z: number }): void;
}

// ---------- варианты лодок с рыбаками (запечённая геометрия) ----------
const strip = (g: THREE.BufferGeometry) => {
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
};
let coastVariants: { geo: THREE.BufferGeometry; rodTips: THREE.Vector3[]; fishermen: number }[] | null = null;
function getCoastVariants(): { geo: THREE.BufferGeometry; rodTips: THREE.Vector3[]; fishermen: number }[] {
  if (coastVariants) return coastVariants;
  coastVariants = [];
  const rnd = mulberry32(88123);
  for (let v = 0; v < 6; v++) {
    const parts: THREE.BufferGeometry[] = [];
    const rodTips: THREE.Vector3[] = [];
    // корпус (общая геометрия шлюпки; uv долой — фигуры без uv)
    parts.push(strip(getRowboatGeo().clone()));
    const nFisher = v % 3 === 0 ? 1 : 2;
    for (let f = 0; f < nFisher; f++) {
      const side = f === 0 ? 1 : -1;
      const z = v % 2 === 0 ? 0.65 : -0.75;          // носовая или кормовая банка
      // рыбак: та же процедурная фигурка, что экипаж — сидит на банке
      const fig = buildFigure('rower', rollTraits(rnd, 'rower'), Math.floor(rnd() * 99999), true);
      fig.group.scale.set(0.92, 0.78, 0.92);
      fig.group.position.set(side * 0.2, 0.12, z);
      // лицом к борту с удочкой (чуть от кормы)
      fig.group.rotation.y = Math.PI + side * 0.85;
      fig.group.updateMatrixWorld(true);
      fig.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
        parts.push(strip(m.geometry.clone().applyMatrix4(m.matrixWorld)));
      });
      // УДИЛИЩЕ: бамбуковый хлыст через борт — от колен рыбака
      // наружу и вперёд, кончик над водой (для всплесков поклёвки)
      const rodLen = 1.7;
      const rx = side * 0.35, ry = 0.62, rz = z - 0.1;
      const tipX = side * 1.25, tipY = 0.55, tipZ = z + 0.75;
      const dir = new THREE.Vector3(tipX - rx, tipY - ry, tipZ - rz);
      const rod = new THREE.CylinderGeometry(0.012, 0.02, rodLen, 4);
      // ось цилиндра Y → вдоль dir
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      rod.applyQuaternion(q);
      rod.translate((rx + tipX) / 2, (ry + tipY) / 2, (rz + tipZ) / 2);
      parts.push(strip(paint(rod, 0x6a4a28, 0.08)));
      // леска не видна с расстояния — поплавок-кивок у кончика
      parts.push(strip(paint(tf(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 4), 0, 0.02, 0), 0xd94f2c)));
      rodTips.push(new THREE.Vector3(tipX, 0.5, tipZ));
      // садок с уловом у ног
      parts.push(strip(paint(tf(new THREE.SphereGeometry(0.14, 5, 4), side * 0.45, 0.42, z - 0.3)
        .scale(1, 0.6, 1.6) as THREE.BufferGeometry, FISH, 0.12)));
    }
    coastVariants.push({ geo: mergeGeometries(parts)!, rodTips, fishermen: nFisher });
  }
  return coastVariants;
}

/** Собрать береговой флот: лодки с рыбаками вдоль берегов всех островов */
export function buildCoastFleet(
  islands: IslandDef[],
  heightAt: (x: number, z: number) => number,
  seed = 20261102,
): CoastFleet {
  const group = new THREE.Group();
  const boats: CoastBoat[] = [];
  const variants = getCoastVariants();
  const rng = new RNG(seed);
  let fishermen = 0;

  for (const isl of islands) {
    // плотность: от 2 лодок у мелкой до 9 у большой
    const n = Math.max(2, Math.min(9, Math.round(isl.r / 130)));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      // ищем воду глубиной 1.5..12 м у кромки (не в отмели, не в глубине)
      let rad = 0;
      for (const rr of [isl.r * 1.0, isl.r * 1.07, isl.r * 1.15, isl.r * 1.28]) {
        const h = heightAt(isl.cx + Math.cos(ang) * rr, isl.cz + Math.sin(ang) * rr);
        if (h < -1.5 && h > -14) { rad = rr + rng.range(0, 16); break; }
      }
      if (!rad) continue;   // скала в море без пригодной кромки
      const variant = variants[Math.floor(rng.next() * variants.length)];
      const scale = rng.range(0.9, 1.06);
      const mesh = new THREE.Mesh(variant.geo, VILLAGE_MAT);
      mesh.castShadow = false;
      mesh.add(makeFoamRing());
      const x = isl.cx + Math.cos(ang) * rad;
      const z = isl.cz + Math.sin(ang) * rad;
      mesh.position.set(x, 0, z);
      mesh.scale.setScalar(scale);
      group.add(mesh);
      boats.push({
        mesh, x, z, yaw: 0, floating: true, baseY: 0,
        sinking: false, sunkT: 0,
        rollDir: rng.next() < 0.5 ? -1 : 1,
        phase: rng.next() * 6.28, scale,
        cx: isl.cx, cz: isl.cz, ang, rad,
        w: (rng.next() < 0.5 ? -1 : 1) * rng.range(0.0012, 0.0034),
        rodTips: variant.rodTips.map((t) => t.clone()),
      });
      fishermen += variant.fishermen;
    }
  }

  let fx: ((x: number, y: number, z: number, a: number) => void) | null = null;
  const fleet: CoastFleet = {
    group, boats, fishermen,
    setFx(fn) { fx = fn; },
    hitBoats(x, z, r) {
      const hit: WorldBoat[] = [];
      for (const b of boats) {
        if (b.sinking) continue;
        if (Math.hypot(b.x - x, b.z - z) > r + 2.4) continue;
        b.sinking = true;
        b.sunkT = 0;
        for (const c of b.mesh.children) c.visible = false;
        hit.push(b);
      }
      return hit;
    },
    update(time, dt, waterHeight, playerPos) {
      for (const b of boats) {
        const dPl = Math.hypot(b.x - playerPos.x, b.z - playerPos.z);
        if (b.sinking) {
          b.sunkT = Math.min(1, b.sunkT + dt / 3.2);
          const k = b.sunkT * b.sunkT;
          b.mesh.position.y = b.baseY - k * 2.6 * b.scale;
          b.mesh.rotation.z += b.rollDir * dt * 0.22;
          b.mesh.rotation.x += dt * 0.1;
          if (b.sunkT >= 1) b.mesh.visible = false;
          continue;
        }
        // дальние лодки: не двигаем и не рисуем (LOD)
        if (dPl > 3600) { b.mesh.visible = false; continue; }
        b.mesh.visible = true;
        // медленный дрейф вдоль берега по кругу острова
        b.ang += b.w * dt;
        b.x = b.cx + Math.cos(b.ang) * b.rad;
        b.z = b.cz + Math.sin(b.ang) * b.rad;
        const wy = waterHeight(b.x, b.z, time);
        // посадка ПОВЫШЕ + лёгкая качка (как у деревенских шлюпок)
        b.mesh.position.set(b.x, wy - 0.03 * b.scale, b.z);
        const dirX = -Math.sin(b.ang) * Math.sign(b.w);
        const dirZ = Math.cos(b.ang) * Math.sign(b.w);
        b.mesh.rotation.y = Math.atan2(dirX, dirZ);
        b.mesh.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.055;
        b.mesh.rotation.x = Math.sin(time * 0.68 + b.phase * 1.3) * 0.035;
        // поклёвка: редкий всплеск у кончика удилища (только рядом)
        if (fx && dPl < 650 && Math.random() < dt * 0.10) {
          const tip = b.rodTips[Math.floor(Math.random() * b.rodTips.length)];
          const ca = Math.cos(b.mesh.rotation.y), sa = Math.sin(b.mesh.rotation.y);
          const wx = b.x + tip.x * ca + tip.z * sa;
          const wz = b.z - tip.x * sa + tip.z * ca;
          fx(wx, waterHeight(wx, wz, time) + 0.02, wz, 0.22);
        }
      }
    },
  };
  return fleet;
}
