import * as THREE from 'three';
import { waterHeightAt } from '../water/waves';

// ============================================================
// Плавающие обломки: доски, бочки, реи, ящики. Всплывают,
// качаются на волнах и дрейфуют по ветру, пока корабль уходит
// на дно (требование ТЗ «затопление»); также осыпаются при
// тяжёлых попаданиях в корпус/рангоут.
// Пул фиксированного размера, меши шарят геометрии/материалы.
// ============================================================

type DebrisKind = 'plank' | 'barrel' | 'spar' | 'crate';

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  buoy: number;      // запас плавучести: скорость всплытия к поверхности
  ttl: number;
  bobPh: number;
  active: boolean;
}

const POOL_N = 56;
const pieces: Piece[] = [];
let root: THREE.Group | null = null;

let geoPlank: THREE.BoxGeometry;
let geoBarrel: THREE.CylinderGeometry;
let geoSpar: THREE.CylinderGeometry;
let geoCrate: THREE.BoxGeometry;
let matWood: THREE.MeshStandardMaterial;
let matDark: THREE.MeshStandardMaterial;

function makeMesh(kind: DebrisKind): THREE.Mesh {
  switch (kind) {
    case 'plank': return new THREE.Mesh(geoPlank, matWood);
    case 'barrel': return new THREE.Mesh(geoBarrel, matWood);
    case 'spar': return new THREE.Mesh(geoSpar, matWood);
    case 'crate': return new THREE.Mesh(geoCrate, matDark);
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
  matWood = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.9 });
  matDark = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.92 });
  const kinds: DebrisKind[] = [
    ...Array(22).fill('plank'), ...Array(12).fill('barrel'),
    ...Array(14).fill('spar'), ...Array(8).fill('crate'),
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
  p.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
  p.vel.copy(vel ?? new THREE.Vector3((Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 2.4));
  p.spin.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.4);
}

function geoOf(k: DebrisKind): THREE.BufferGeometry {
  return k === 'plank' ? geoPlank : k === 'barrel' ? geoBarrel : k === 'spar' ? geoSpar : geoCrate;
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

/** Шаг физики: всплытие, качка на волне, дрейф по ветру */
export function updateDebris(dt: number, time: number, wind?: { from: number; speed: number }) {
  if (!root) return;
  for (const p of pieces) {
    if (!p.active) continue;
    p.ttl -= dt;
    if (p.ttl <= 0) { p.active = false; p.mesh.visible = false; continue; }
    const m = p.mesh;
    const wy = waterHeightAt(m.position.x, m.position.z, time);
    // плавучесть: кусок стремится к поверхности волны (плюс собственный запас)
    const target = wy + 0.05 + p.buoy * 0.14 + Math.sin(time * 1.3 + p.bobPh) * 0.10;
    p.vel.y += (target - m.position.y) * 6.5 * dt;
    p.vel.y *= Math.exp(-dt * 3.2);
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
    // исчезновение: уплыл за 260 м или потонул (для тяжёлых)
    if (m.position.y < wy - 2.5 || Math.abs(m.position.x) > 3200 || Math.abs(m.position.z) > 3200) {
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

/** Убрать все обломки (сброс мишени полигона / выход) */
export function clearDebris() {
  for (const p of pieces) {
    p.active = false;
    p.mesh.visible = false;
  }
}
