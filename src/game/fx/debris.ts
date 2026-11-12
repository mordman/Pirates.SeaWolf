import * as THREE from 'three';
import { waterHeightAt } from '../water/waves';

// ============================================================
// Плавающие обломки: доски, бочки, реи, ящики. Всплывают,
// качаются на волнах и дрейфуют по ветру, пока корабль уходит
// на дно (требование ТЗ «затопление»); также осыпаются при
// тяжёлых попаданиях в корпус/рангоут.
// Пул фиксированного размера, меши шарят геометрии/материалы.
// ============================================================

type DebrisKind = 'plank' | 'barrel' | 'spar' | 'crate' | 'shard' | 'hullplate';

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  buoy: number;      // запас плавучести: скорость всплытия к поверхности
  ttl: number;
  bobPh: number;
  active: boolean;
}

// Task 43: пул расширен (щепы пробоин + секции обшивки при разломе)
const POOL_N = 112;
const pieces: Piece[] = [];
let root: THREE.Group | null = null;

let geoPlank: THREE.BoxGeometry;
let geoBarrel: THREE.CylinderGeometry;
let geoSpar: THREE.CylinderGeometry;
let geoCrate: THREE.BoxGeometry;
let geoShard: THREE.BoxGeometry;
let geoPlate: THREE.BoxGeometry;
let matWood: THREE.MeshStandardMaterial;
let matDark: THREE.MeshStandardMaterial;
let matPlate: THREE.MeshStandardMaterial;

function makeMesh(kind: DebrisKind): THREE.Mesh {
  switch (kind) {
    case 'plank': return new THREE.Mesh(geoPlank, matWood);
    case 'barrel': return new THREE.Mesh(geoBarrel, matWood);
    case 'spar': return new THREE.Mesh(geoSpar, matWood);
    case 'crate': return new THREE.Mesh(geoCrate, matDark);
    case 'shard': return new THREE.Mesh(geoShard, matDark);
    case 'hullplate': return new THREE.Mesh(geoPlate, matPlate);
  }
}

/** Создать пул (один раз из game.ts) */
export function initDebris(parent: THREE.Object3D) {
  if (root) return;
  root = new THREE.Group();
  root.name = 'debris';
  geoPlank = new THREE.BoxGeometry(1.7, 0.09, 0.26);
  geoBarrel = new THREE.CylinderGeometry(0.3, 0.3, 0.78, 8);
  geoSpar = new THREE.CylinderGeometry(0.08, 0.11, 3.4, 6);
  geoCrate = new THREE.BoxGeometry(0.6, 0.5, 0.5);
  // щепа пробоины: короткая толстая деревяшка (рваный скол обшивки)
  geoShard = new THREE.BoxGeometry(0.55, 0.07, 0.13);
  // секция обшивки при разломе борта (изогнутая полоса)
  geoPlate = new THREE.BoxGeometry(2.3, 0.12, 1.15);
  matWood = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.9 });
  matDark = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.92 });
  matPlate = new THREE.MeshStandardMaterial({ color: 0x6a4c2c, roughness: 0.88, side: THREE.DoubleSide });
  const kinds: DebrisKind[] = [
    ...Array(20).fill('plank'), ...Array(10).fill('barrel'),
    ...Array(12).fill('spar'), ...Array(6).fill('crate'),
    ...Array(58).fill('shard'), ...Array(6).fill('hullplate'),
  ] as DebrisKind[];
  for (let i = 0; i < POOL_N; i++) {
    const m = makeMesh(kinds[i]);
    m.visible = false;
    m.castShadow = false;
    root.add(m);
    pieces.push({
      mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      buoy: 1, ttl: 0, bobPh: Math.random() * 6.28, active: false,
    });
  }
  parent.add(root);
}

/** Выбросить один обломок (мировые координаты). kind 'auto' — случайный. */
export function spawnDebrisAt(x: number, y: number, z: number,
  kind: DebrisKind | 'auto' = 'auto', vel?: THREE.Vector3, ttl = 30 + Math.random() * 30) {
  if (!root) return;
  const k: DebrisKind = kind === 'auto'
    ? (['plank', 'plank', 'spar', 'barrel', 'crate'] as DebrisKind[])[(Math.random() * 5) | 0]
    : kind;
  // ищем свободный кусок нужного типа, иначе любой свободный
  let p = pieces.find(q => !q.active && q.mesh.geometry === geoOf(k));
  if (!p) p = pieces.find(q => !q.active);
  if (!p) return; // пул исчерпан — молча пропускаем
  p.active = true;
  p.ttl = ttl;
  p.buoy = 0.6 + Math.random() * 0.9;
  p.mesh.visible = true;
  p.mesh.position.set(x, y, z);
  p.mesh.scale.set(1, 1, 1);   // Task 46: сброс масштаба после spawnSpar
  p.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
  p.vel.copy(vel ?? new THREE.Vector3((Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 2.4));
  p.spin.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.4);
}

function geoOf(k: DebrisKind): THREE.BufferGeometry {
  return k === 'plank' ? geoPlank : k === 'barrel' ? geoBarrel : k === 'spar' ? geoSpar
    : k === 'shard' ? geoShard : k === 'hullplate' ? geoPlate : geoCrate;
}

/** Task 43: РАЗЛЁТ ЩЕПЫ при пробоине/разломе — веером по ходу снаряда.
 *  n shard-щепок + доски, дир — мировое направление полёта ядра */
export function spawnSplinterBurst(x: number, y: number, z: number,
  dir: THREE.Vector3, n = 10, planks = 2) {
  if (!root) return;
  const dl = dir.length() > 1e-4 ? dir.clone().normalize() : new THREE.Vector3(0, 0.4, 1).normalize();
  // разброс вокруг направления (конус ~55°)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const spread = 0.35 + Math.random() * 0.55;
    const v = new THREE.Vector3(
      dl.x + Math.cos(a) * spread,
      dl.y * 0.4 + 0.35 + Math.random() * 0.9,
      dl.z + Math.sin(a) * spread,
    ).normalize().multiplyScalar(3.5 + Math.random() * 7);
    spawnDebrisAt(x, y, z, 'shard', v, 14 + Math.random() * 14);
  }
  // крупные доски — вылетают вдоль удара, кувыркаются
  for (let i = 0; i < planks; i++) {
    const v = new THREE.Vector3(
      dl.x * (2.4 + Math.random() * 2.2) + (Math.random() - 0.5) * 1.6,
      1.4 + Math.random() * 2.6,
      dl.z * (2.4 + Math.random() * 2.2) + (Math.random() - 0.5) * 1.6);
    spawnDebrisAt(x, y + 0.15, z, 'plank', v, 30 + Math.random() * 26);
  }
}

/** Task 43: СЕКЦИЯ ОБШИВКИ ВЫЛОМАНА (3+ пробоины в ряд): панель
 *  борта отлетает наружу, вращаясь */
export function spawnHullPlate(x: number, y: number, z: number, dir: THREE.Vector3) {
  if (!root) return;
  const v = new THREE.Vector3(
    dir.x * 2.6 + (Math.random() - 0.5),
    1.6 + Math.random() * 1.6,
    dir.z * 2.6 + (Math.random() - 0.5));
  spawnDebrisAt(x, y, z, 'hullplate', v, 45 + Math.random() * 25);
}

/** Task 46: СЕГМЕНТ МАЧТЫ (стеньга/брам-стеньга) отстыкован при
 *  переломе — падает с физикой: масштаб под фактический диаметр/
 *  длину сегмента, ориентация — мировая ориентация сегмента */
export function spawnSpar(x: number, y: number, z: number,
  quat: THREE.Quaternion, vel: THREE.Vector3,
  radTop: number, radBot: number, len: number) {
  if (!root) return;
  let p = pieces.find(q => !q.active && q.mesh.geometry === geoSpar);
  if (!p) p = pieces.find(q => !q.active);
  if (!p) return;
  p.active = true;
  p.ttl = 25 + Math.random() * 20;
  p.buoy = 0.8 + Math.random() * 0.4;   // дерево плавает: сегмент качается на волнах
  p.mesh.visible = true;
  p.mesh.position.set(x, y, z);
  p.mesh.quaternion.copy(quat);
  const rAvg = (radTop + radBot) * 0.5;
  p.mesh.scale.set(rAvg / 0.095, len / 3.4, rAvg / 0.095);
  p.vel.copy(vel);
  p.spin.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.6);
}

/** Обломки с гибнущего корабля: россыпь с палубы и бортов */
export function spawnShipDebris(P: { position: THREE.Vector3; quaternion: THREE.Quaternion; length: number; beam: number; freeboard: number }) {
  if (!root) return;
  const n = 7 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const lx = (Math.random() - 0.5) * P.beam * 0.9;
    const lz = (Math.random() - 0.5) * P.length * 0.8;
    const wp = new THREE.Vector3(lx, P.freeboard * 0.5, lz).applyQuaternion(P.quaternion).add(P.position);
    const outward = new THREE.Vector3(lx, 0, lz).normalize().multiplyScalar(1.2 + Math.random() * 1.8);
    outward.y = 0.8 + Math.random() * 1.6;
    spawnDebrisAt(wp.x, Math.max(wp.y, 0.4), wp.z, 'auto', outward);
  }
}

/** Шаг физики: всплытие, качка на волне, дрейф по ветру.
 *  origin — позиция игрока: обломки дальше 500 м от него убираются
 *  (мир огромный, жёсткий лимит от нуля — легаси, ломался на
 *  дистанциях 3000+ м от спавна) */
export function updateDebris(dt: number, time: number, wind?: { from: number; speed: number },
  origin?: { x: number; z: number }) {
  if (!root) return;
  const limX = origin ? origin.x : 0;
  const limZ = origin ? origin.z : 0;
  for (const p of pieces) {
    if (!p.active) continue;
    p.ttl -= dt;
    if (p.ttl <= 0) { p.active = false; p.mesh.visible = false; continue; }
    const m = p.mesh;
    const wy = waterHeightAt(m.position.x, m.position.z, time);
    // плавучесть: кусок стремится к поверхности волны (плюс собственный запас)
    const target = wy + 0.05 + p.buoy * 0.14 + Math.sin(time * 1.3 + p.bobPh) * 0.10;
    p.vel.y += (target - m.position.y) * 6.5 * dt;
    // под ВОДОЙ торможение сильнее (вход с высоты мачты не уносит
    // кусок на дно мгновенно — дерево всплывает)
    p.vel.y *= Math.exp(-dt * (m.position.y < wy ? 20 : 3.2));
    // горизонтальный дрейф: инерция + слабый ветер
    if (wind) {
      const wx = -Math.cos(wind.from) * wind.speed * 0.045;
      const wz = -Math.sin(wind.from) * wind.speed * 0.045;
      p.vel.x += (wx - p.vel.x) * Math.min(1, dt * 0.5);
      p.vel.z += (wz - p.vel.z) * Math.min(1, dt * 0.5);
    }
    p.vel.x *= Math.exp(-dt * 0.4);
    p.vel.z *= Math.exp(-dt * 0.4);
    m.position.addScaledVector(p.vel, dt);
    m.rotation.x += p.spin.x * dt;
    m.rotation.y += p.spin.y * dt;
    m.rotation.z += p.spin.z * dt;
    p.spin.multiplyScalar(Math.exp(-dt * 0.7));
    // исчезновение: уплыл от игрока за 500 м или потонул (для тяжёлых)
    if (m.position.y < wy - 2.5
      || Math.hypot(m.position.x - limX, m.position.z - limZ) > 500) {
      p.active = false;
      m.visible = false;
    }
  }
}

/** Число активных обломков (телеметрия E2E) */
export function debrisAlive(): number {
  let n = 0;
  for (const p of pieces) if (p.active) n++;
  return n;
}

/** Task 46: телеметрия по видам (e2e: падение сегментов мачт) */
export function debrisInfo(): { alive: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {
    plank: 0, barrel: 0, spar: 0, crate: 0, shard: 0, hullplate: 0,
  };
  for (const p of pieces) {
    if (!p.active) continue;
    if (p.mesh.geometry === geoSpar) byKind.spar++;
    else if (p.mesh.geometry === geoShard) byKind.shard++;
    else if (p.mesh.geometry === geoPlate) byKind.hullplate++;
    else if (p.mesh.geometry === geoPlank) byKind.plank++;
    else if (p.mesh.geometry === geoBarrel) byKind.barrel++;
    else byKind.crate++;
  }
  return { alive: debrisAlive(), byKind };
}

/** Убрать все обломки (сброс мишени полигона / выход) */
export function clearDebris() {
  for (const p of pieces) {
    p.active = false;
    p.mesh.visible = false;
  }
}
