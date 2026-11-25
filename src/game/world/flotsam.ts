import * as THREE from 'three';
import { waterHeightAt } from '../water/waves';

// ============================================================
// Task 51: ПЛАВАЮЩИЙ ЛУТ ПОТОПЛЕННЫХ КОРАБЛЕЙ. Когда судно уходит
// под воду, на поверхности остаются СУНДУК С ДЕНЬГАМИ и МЕШКИ С
// ТОВАРАМИ из трюма (воздух в бочках держит их на плаву). Качаются
// на волнах, дрейфуют по ветру, тускнеют по TTL (~3 мин) — за это
// время нужно подойти вплотную (7 м), чтобы подобрать.
// ============================================================

export type FlotsamKind = 'chest' | 'sack';

interface FlotsamItem {
  mesh: THREE.Group;
  kind: FlotsamKind;
  gold: number;                       // сундук: золото
  cargoKind: string;                  // мешок: вид товара
  cargoN: number;                     // мешок: количество
  ttl: number;
  bobPh: number;
  active: boolean;
}

const POOL_N = 24;
const items: FlotsamItem[] = [];
let root: THREE.Group | null = null;

/** сундук: корпус + выпуклая крышка + латунные полосы + замок */
function buildChest(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5c4128, roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8912f, roughness: 0.4, metalness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 0.72), wood);
  body.position.y = 0.31;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.15, 10, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.62;
  g.add(lid);
  for (const bx of [-0.34, 0.34]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.66, 0.76), brass);
    band.position.set(bx, 0.31, 0);
    g.add(band);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.1), brass);
  lock.position.set(0, 0.42, 0.38);
  g.add(lock);
  return g;
}

/** мешок с товаром: туго набитый тюк с горловиной и обвязкой */
function buildSack(): THREE.Group {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.95 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 7), cloth);
  belly.scale.set(1, 0.82, 1);
  belly.position.y = 0.34;
  g.add(belly);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.22, 8), cloth);
  neck.position.y = 0.72;
  g.add(neck);
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 5, 10), rope);
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.66;
  g.add(tie);
  return g;
}

/** Создать пул (один раз из game.ts) */
export function initFlotsam(parent: THREE.Object3D) {
  if (root) return;
  root = new THREE.Group();
  root.name = 'flotsam';
  for (let i = 0; i < POOL_N; i++) {
    const kind: FlotsamKind = i < 8 ? 'chest' : 'sack';
    const mesh = kind === 'chest' ? buildChest() : buildSack();
    mesh.visible = false;
    mesh.traverse(o => { o.castShadow = false; });
    root.add(mesh);
    items.push({
      mesh, kind, gold: 0, cargoKind: '', cargoN: 0,
      ttl: 0, bobPh: Math.random() * 6.28, active: false,
    });
  }
  parent.add(root);
}

/** Рассыпать лут потопленного корабля: сундук с золотом (если было)
 *  + мешки с товарами из трюма (по виду груза), разброс 6-18 м.
 *  Task 81: maxBags — число мешков масштабируется размером судна
 *  (шлюп 2-4, тяжёлый ост-индец до 6) */
export function spawnFlotsam(x: number, z: number,
  gold: number, cargo: Record<string, number>, ttl = 180, maxBags = 4) {
  if (!root) return;
  if (gold > 0) {
    // сундук: центр точки гибели, до двух — если золота очень много
    const n = gold >= 1500 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const dx = (Math.random() - 0.5) * 8, dz = (Math.random() - 0.5) * 8;
      const it = items.find(q => !q.active && q.kind === 'chest') ?? items.find(q => !q.active);
      if (!it) break;
      it.active = true;
      it.mesh.visible = true;
      it.ttl = ttl;
      it.gold = i === 0 ? Math.round(gold * (n === 1 ? 1 : 0.6)) : gold - Math.round(gold * 0.6);
      it.cargoKind = '';
      it.mesh.position.set(x + dx, 0, z + dz);
      it.mesh.rotation.set(0, Math.random() * 6.28, 0);
    }
  }
  // мешки: по одному на ВИД товара (число мешков — по размеру судна)
  const kinds = Object.keys(cargo).filter(k => (cargo[k] ?? 0) >= 1);
  let bag = 0;
  for (const k of kinds) {
    if (bag >= maxBags) break;
    const nBags = Math.min(3, Math.max(1, Math.floor(cargo[k] / 3)));
    for (let b = 0; b < nBags && bag < maxBags; b++) {
      const it = items.find(q => !q.active && q.kind === 'sack');
      if (!it) break;
      it.active = true;
      it.mesh.visible = true;
      it.ttl = ttl;
      it.gold = 0;
      it.cargoKind = k;
      it.cargoN = Math.max(1, Math.floor(cargo[k] / nBags));
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 12;
      it.mesh.position.set(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
      it.mesh.rotation.set(0, Math.random() * 6.28, 0);
      bag++;
    }
  }
}

/** Шаг: качание на волнах, дрейф по ветру, исчезновение по TTL */
export function updateFlotsam(dt: number, time: number,
  wind?: { from: number; speed: number }, origin?: { x: number; z: number }) {
  if (!root) return;
  for (const it of items) {
    if (!it.active) continue;
    it.ttl -= dt;
    if (it.ttl <= 0) { it.active = false; it.mesh.visible = false; continue; }
    const m = it.mesh;
    const wy = waterHeightAt(m.position.x, m.position.z, time);
    const target = wy - 0.1 + Math.sin(time * 1.1 + it.bobPh) * 0.09;
    m.position.y += (target - m.position.y) * Math.min(1, dt * 5);
    m.rotation.z = Math.sin(time * 0.9 + it.bobPh) * 0.16;
    m.rotation.x = Math.sin(time * 0.7 + it.bobPh * 1.3) * 0.12;
    if (wind) {
      m.position.x -= Math.cos(wind.from) * wind.speed * 0.02 * dt;
      m.position.z -= Math.sin(wind.from) * wind.speed * 0.02 * dt;
    }
    // уплыл далеко от игрока — убираем (пул маленький)
    if (origin && Math.hypot(m.position.x - origin.x, m.position.z - origin.z) > 900) {
      it.active = false;
      m.visible = false;
    }
  }
}

/** Подобрать всё в радиусе r от (x,z): возвращает золото и груз,
 *  убирает подобранное из воды */
export function pickFlotsam(x: number, z: number, r: number):
  { gold: number; cargo: Record<string, number> } {
  const res = { gold: 0, cargo: {} as Record<string, number> };
  if (!root) return res;
  for (const it of items) {
    if (!it.active) continue;
    if (Math.hypot(it.mesh.position.x - x, it.mesh.position.z - z) > r) continue;
    res.gold += it.gold;
    if (it.cargoKind && it.cargoN > 0) {
      res.cargo[it.cargoKind] = (res.cargo[it.cargoKind] ?? 0) + it.cargoN;
    }
    it.active = false;
    it.mesh.visible = false;
  }
  return res;
}

/** Телеметрия (e2e): сколько чего плавает + где (для сбора) */
export function flotsamInfo(): {
  alive: number; chests: number; sacks: number; gold: number;
  items: { kind: FlotsamKind; x: number; z: number }[];
} {
  let chests = 0, sacks = 0, gold = 0;
  const list: { kind: FlotsamKind; x: number; z: number }[] = [];
  for (const it of items) {
    if (!it.active) continue;
    if (it.kind === 'chest') { chests++; gold += it.gold; } else sacks++;
    list.push({ kind: it.kind, x: +it.mesh.position.x.toFixed(1), z: +it.mesh.position.z.toFixed(1) });
  }
  return { alive: chests + sacks, chests, sacks, gold, items: list };
}

/** Убрать весь лут (сброс) */
export function clearFlotsam() {
  for (const it of items) { it.active = false; it.mesh.visible = false; }
}
