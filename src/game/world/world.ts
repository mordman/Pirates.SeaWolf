import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG, fbm2, clamp, smoothstep } from '../core/rng';

// ============================================================
// Мир: детерминированные острова по сиду, густая растительность
// (инстансинг + ветровая анимация), животные-атмосфера, порт.
// ============================================================

export interface IslandDef {
  cx: number; cz: number; r: number; maxH: number;
  type: 'port' | 'jungle' | 'rock' | 'atoll';
  name: string;
  discovered: boolean;
}

export const WORLD_SEED = 20261027;

// 8 «рукописных» островов (порт + ориентиры) — их индексы используют животные
const BASE_ISLANDS: IslandDef[] = [
  { cx: 450, cz: 350, r: 240, maxH: 26, type: 'port', name: 'Пальмовая гавань', discovered: false },
  { cx: -650, cz: 500, r: 175, maxH: 13, type: 'jungle', name: 'Зелёный атолл', discovered: false },
  { cx: -520, cz: -700, r: 85, maxH: 30, type: 'rock', name: 'Скала Морского Дьявола', discovered: false },
  { cx: 900, cz: -620, r: 105, maxH: 9, type: 'atoll', name: 'Черепаший риф', discovered: false },
  { cx: 1400, cz: 900, r: 210, maxH: 19, type: 'jungle', name: 'Остров Бакунов', discovered: false },
  { cx: -1500, cz: -220, r: 150, maxH: 15, type: 'jungle', name: 'Дальний ключ', discovered: false },
  { cx: -1050, cz: 1150, r: 75, maxH: 24, type: 'rock', name: 'Клык', discovered: false },
  { cx: 250, cz: -1400, r: 185, maxH: 11, type: 'atoll', name: 'Плёс', discovered: false },
];

/** Процедурная генерация архипелага: детерминированно по сиду —
 *  кольцом вокруг порта, с минимальными проливами между островами.
 *  Базовые острова не трогаем (животные/порт привязаны к индексам). */
function generateIslands(): IslandDef[] {
  const rng = new RNG(WORLD_SEED + 9173);
  const names = [
    'Остров Черепа', 'Мыс Багровой Луны', 'Скалы Трёх Братьев', 'Лагуна Сирен',
    'Кайманов ключ', 'Затерянный риф', 'Бухта Повешенного', 'Остров Гвоздей',
    'Перьевой атолл', 'Голый риф', 'Отмель Мёртвого Якоря', 'Тихая банка',
  ];
  const pool = [...names];
  const out: IslandDef[] = [];
  let guard = 0;
  while (out.length < 11 && guard++ < 600) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1000, 2850);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d * 0.82; // мир чуть шире по X — под карту 640×520
    if (Math.abs(cx) > 2850 || Math.abs(cz) > 2250) continue;
    const roll = rng.next();
    const type: IslandDef['type'] = roll < 0.5 ? 'jungle' : roll < 0.78 ? 'rock' : 'atoll';
    const r = rng.range(85, 230);
    // проливы не уже 520 м между берегами
    let ok = true;
    for (const isl of [...BASE_ISLANDS, ...out]) {
      if (Math.hypot(cx - isl.cx, cz - isl.cz) < isl.r + r + 520) { ok = false; break; }
    }
    if (!ok) continue;
    const maxH = type === 'rock' ? rng.range(18, 34) : type === 'jungle' ? rng.range(10, 26) : rng.range(6, 11);
    const name = pool.length ? pool.splice(Math.floor(rng.next() * pool.length), 1)[0] : `Безымянный риф ${out.length + 1}`;
    out.push({ cx: Math.round(cx), cz: Math.round(cz), r: Math.round(r), maxH: Math.round(maxH), type, name, discovered: false });
  }
  return out;
}

export const ISLANDS: IslandDef[] = [...BASE_ISLANDS, ...generateIslands()];

/** Высота суши в мировой точке. Открытое море = -14 (глубина), суша > 0 */
export function heightAt(x: number, z: number): number {
  let h = -14; // дно открытого моря
  for (const isl of ISLANDS) {
    const dx = x - isl.cx, dz = z - isl.cz;
    const d = Math.hypot(dx, dz);
    if (d > isl.r * 2.0) continue;
    // рваная береговая линия: радиус модулируется шумом
    const coastNoise = fbm2(x * 0.008, z * 0.008, 3, WORLD_SEED + isl.r);
    const rEff = isl.r * (0.78 + 0.5 * coastNoise);
    if (d > rEff * 1.5) continue;
    const fall = smoothstep(1.18, 0.22, d / rEff);
    const detail = 0.55 + 0.45 * fbm2(x * 0.02, z * 0.02, 4, WORLD_SEED + isl.cx);
    const ridge = isl.type === 'rock' ? Math.pow(fall, 1.6) : fall;
    let hi = isl.maxH * ridge * detail - 2.6;
    // плавный склон к морскому дну за отмелью
    hi = THREE.MathUtils.lerp(hi, -14, smoothstep(1.12, 1.5, d / rEff));
    if (hi > h) h = hi;
  }
  return h;
}

function slopeAt(x: number, z: number): number {
  const e = 1.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

// ---------- геометрия с цветом ----------
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

// ветровая анимация крон (общий uniform)
export const windTimeUniform = { value: 0 };
function applySway(mat: THREE.Material, amp: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTimeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ipos2 = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          float swayA = ${amp.toFixed(3)} * sin(uTime * 1.35 + ipos2.x * 0.37 + ipos2.y * 0.43);
          float hf2 = max(transformed.y - 0.6, 0.0);
          transformed.x += swayA * hf2;
          transformed.z += swayA * 0.55 * hf2;
        #endif`);
  };
  mat.customProgramCacheKey = () => `sway-${amp}`;
}

// ---------- деревья ----------
function palmGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(tf(new THREE.CylinderGeometry(0.13, 0.24, 8.5, 5), 0, 4.25, 0), 0x7a5a38));
  const rng = new RNG(42);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const frond = new THREE.ConeGeometry(0.42, 3.4, 4);
    frond.scale(1, 1, 0.16);
    parts.push(paint(tf(frond, Math.cos(a) * 1.35, 8.3, Math.sin(a) * 1.35, 0.9, -a, 0), 0x3f7d33, 0.12));
    void rng;
  }
  // кокосы
  parts.push(paint(tf(new THREE.SphereGeometry(0.18, 5, 4), 0.35, 8.1, 0.2), 0x5c4322));
  parts.push(paint(tf(new THREE.SphereGeometry(0.18, 5, 4), -0.3, 8.05, -0.25), 0x5c4322));
  return mergeGeometries(parts)!;
}
function ficusGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(tf(new THREE.CylinderGeometry(0.42, 0.66, 4.2, 6), 0, 2.1, 0), 0x6b4e2f));
  parts.push(paint(tf(new THREE.SphereGeometry(2.6, 8, 6), 0, 5.6, 0, 0, 0, 0).scale(1, 0.72, 1) as THREE.BufferGeometry, 0x2f5e2b, 0.14));
  parts.push(paint(tf(new THREE.SphereGeometry(1.7, 7, 5), 1.6, 4.6, 0.8), 0x39682f, 0.14));
  parts.push(paint(tf(new THREE.SphereGeometry(1.4, 7, 5), -1.4, 5.1, -0.9), 0x35622c, 0.14));
  return mergeGeometries(parts)!;
}
function jungleGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(tf(new THREE.CylinderGeometry(0.2, 0.38, 5.4, 5), 0, 2.7, 0), 0x6e5230));
  parts.push(paint(tf(new THREE.SphereGeometry(1.9, 7, 6), 0, 6.0, 0, 0, 0, 0).scale(1, 1.25, 1) as THREE.BufferGeometry, 0x477a34, 0.15));
  parts.push(paint(tf(new THREE.SphereGeometry(1.2, 6, 5), 0.9, 5.0, 0.5), 0x3d6b2f, 0.15));
  return mergeGeometries(parts)!;
}
function bushGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(tf(new THREE.SphereGeometry(0.85, 6, 5), 0, 0.6, 0), 0x4a7032, 0.2));
  parts.push(paint(tf(new THREE.SphereGeometry(0.55, 6, 4), 0.6, 0.45, 0.3), 0x567b36, 0.2));
  return mergeGeometries(parts)!;
}
function bambooGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rng = new RNG(7);
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2), rr = rng.range(0, 0.5);
    parts.push(paint(tf(new THREE.CylinderGeometry(0.045, 0.07, 5.2, 4),
      Math.cos(a) * rr, 2.6, Math.sin(a) * rr, rng.range(-0.08, 0.08), 0, rng.range(-0.08, 0.08)), 0x8a9a3a, 0.1));
  }
  return mergeGeometries(parts)!;
}
function rockGeo(): THREE.BufferGeometry {
  return paint(new THREE.DodecahedronGeometry(1.3, 0), 0x7d7668, 0.1);
}

// ---------- животные ----------
interface AnimalInst { mesh: THREE.InstancedMesh; count: number; }
interface Wanderer {
  x: number; z: number; dirA: number; speed: number;
  timer: number; phase: number; island: IslandDef;
}
interface Hopper { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; island: IslandDef; }
interface Circler { island: IslandDef; a: number; r: number; speed: number; h: number; phase: number; }

export class World {
  group = new THREE.Group();
  islands: IslandDef[] = ISLANDS;
  port = {
    dockEnd: new THREE.Vector3(190, 0, 588),
    name: 'Пальмовая гавань',
  };
  discovered = new Set<string>();

  // животные
  private gullMesh!: THREE.InstancedMesh;
  private gullMat!: THREE.ShaderMaterial;
  private gulls: Circler[] = [];
  private crabMesh!: THREE.InstancedMesh;
  private crabs: Wanderer[] = [];
  private turtleMesh!: THREE.InstancedMesh;
  private turtles: Circler[] = [];
  private monkeyMesh!: THREE.InstancedMesh;
  private monkeys: Hopper[] = [];
  private boarMesh!: THREE.InstancedMesh;
  private boars: Wanderer[] = [];
  private sharkMesh!: THREE.InstancedMesh;
  private sharks: Circler[] = [];
  private dummy = new THREE.Object3D();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();

  // ломающаяся растительность: позиции инстансов по видам
  private vegSlots: {
    inst: THREE.InstancedMesh;
    positions: THREE.Vector3[];
    broken: boolean[];
    breakable: boolean;
  }[] = [];
  /** счётчик поваленных деревьев (телеметрия) */
  treesBroken = 0;

  constructor() {
    this.buildIslands();
    this.buildVegetation();
    this.buildPort();
    this.buildAnimals();
  }

  // ---------- острова ----------
  private buildIslands() {
    this.islands.forEach((isl, islIdx) => {
      // размер квадрата: с запасом за всю зону влияния рельефа
      // (rEff·1.5 до ~1.9r) — раньше 3.2r обрезали отмель НА КВАДРАТЕ,
      // и под водой читался «квадрат под островом»; теперь кромка
      // уходит на глубину -14 и не видна
      const size = isl.r * 4.3;
      const seg = 110;
      // у каждого острова своё дно с крошечным сдвигом: перекрывающиеся
      // плоскости не мерцают z-fight в открытом море
      const deep = -14 - islIdx * 0.06;
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const cUnder = new THREE.Color(0x9a8a66);
      const cSand = new THREE.Color(0xd9c28f);
      const cGrass = new THREE.Color(0x5f863d);
      const cJungle = new THREE.Color(0x33642e);
      const cRock = new THREE.Color(0x8a8378);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const wx = pos.getX(i) + isl.cx;
        const wz = pos.getZ(i) + isl.cz;
        let h = heightAt(wx, wz);
        if (h < deep) h = deep;
        pos.setY(i, h);
        // цвет по высоте и уклону (уклон приблизим после)
        if (h < -0.4) c.copy(cUnder).lerp(cSand, clamp((h + 3) / 2.6, 0, 1));
        else if (h < 1.3) c.copy(cSand);
        else if (h < isl.maxH * 0.62) c.copy(cGrass).lerp(cJungle, fbm2(wx * 0.05, wz * 0.05, 3, WORLD_SEED + 9));
        else c.copy(cRock);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.computeVertexNormals();
      // скалы на крутых склонах
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (nrm.getY(i) < 0.62 && pos.getY(i) > 0.3) {
          colors[i * 3] = cRock.r; colors[i * 3 + 1] = cRock.g; colors[i * 3 + 2] = cRock.b;
        }
      }
      (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(isl.cx, 0, isl.cz);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);
    });
  }

  // ---------- растительность ----------
  private buildVegetation() {
    interface Slot { geo: () => THREE.BufferGeometry; sway: number; }
    const types: Record<string, Slot> = {
      palm: { geo: palmGeo, sway: 0.05 },
      ficus: { geo: ficusGeo, sway: 0.028 },
      jungle: { geo: jungleGeo, sway: 0.035 },
      bush: { geo: bushGeo, sway: 0.05 },
      bamboo: { geo: bambooGeo, sway: 0.06 },
      rock: { geo: rockGeo, sway: 0 },
    };
    const placements: Record<string, { m: THREE.Matrix4; islandType: string; h: number }[]> = {};
    for (const k of Object.keys(types)) placements[k] = [];

    for (const isl of this.islands) {
      const density = isl.type === 'rock' ? 0.35 : isl.type === 'atoll' ? 1.0 : 1.25;
      const area = Math.PI * isl.r * isl.r;
      const target = Math.floor(area / 220 * density);
      const rng = new RNG(WORLD_SEED + isl.cx * 31 + isl.cz);
      let tries = 0;
      let placed = 0;
      while (placed < target && tries < target * 14) {
        tries++;
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(rng.next()) * isl.r * 1.25;
        const x = isl.cx + Math.cos(a) * rr;
        const z = isl.cz + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 0.75 || h > isl.maxH * 0.9) continue;
        const sl = slopeAt(x, z);
        if (sl > 0.62) continue;
        // тип дерева по высоте и типу острова
        let kind: string;
        const roll = rng.next();
        if (isl.type === 'rock') kind = roll < 0.7 ? 'rock' : 'bush';
        else if (h < 4.2) kind = roll < 0.72 ? 'palm' : roll < 0.85 ? 'bush' : 'rock';
        else if (h < isl.maxH * 0.55) kind = roll < 0.42 ? 'jungle' : roll < 0.62 ? 'palm' : roll < 0.82 ? 'bamboo' : roll < 0.94 ? 'bush' : 'ficus';
        else kind = roll < 0.5 ? 'jungle' : roll < 0.75 ? 'bush' : 'rock';
        if (kind === 'rock' && h < 1.0 && roll < 0.5) kind = 'palm';
        const s = rng.range(0.7, 1.35);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, h - 0.15, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.06, 0.06), rng.range(0, Math.PI * 2), rng.range(-0.06, 0.06))),
          new THREE.Vector3(s, s * rng.range(0.85, 1.2), s));
        placements[kind].push({ m, islandType: isl.type, h });
        placed++;
      }
    }

    for (const [kind, list] of Object.entries(placements)) {
      if (!list.length) continue;
      const geo = types[kind].geo();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      if (types[kind].sway > 0) applySway(mat, types[kind].sway);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => inst.setMatrixAt(i, p.m));
      inst.castShadow = true;
      inst.receiveShadow = false;
      inst.frustumCulled = false; // острова распределены широко — оставляем всегда видимыми
      this.group.add(inst);
      // позиции для ломания (камни не ломаются)
      const positions = list.map((p) => {
        const v = new THREE.Vector3();
        v.setFromMatrixPosition(p.m);
        return v;
      });
      this.vegSlots.push({
        inst, positions,
        broken: new Array(list.length).fill(false),
        breakable: kind !== 'rock',
      });
    }
  }

  /** Ядро/книппель валят деревья: ломает экземпляры в радиусе,
   *  возвращает количество поваленных (0 = промах/камни) */
  breakTrees(x: number, y: number, z: number, radius: number,
    fx?: { debris: (x: number, y: number, z: number, n?: number, power?: number) => void }): number {
    let broke = 0;
    const r2 = radius * radius;
    for (const slot of this.vegSlots) {
      if (!slot.breakable) continue;
      for (let i = 0; i < slot.positions.length; i++) {
        if (slot.broken[i]) continue;
        const p = slot.positions[i];
        const dx = p.x - x, dz = p.z - z, dy = p.y - y;
        if (dx * dx + dz * dz > r2 || dy < -3 || dy > 9) continue;
        slot.broken[i] = true;
        // спрятать экземпляр: сдвинуть под дно + сжать в точку
        this.dummy.position.set(p.x, -40, p.z);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        slot.inst.setMatrixAt(i, this.dummy.matrix);
        slot.inst.instanceMatrix.needsUpdate = true;
        // щепа и листва из точки удара
        fx?.debris(p.x, p.y + 1.6, p.z, 12, 1.2);
        broke++;
      }
    }
    this.treesBroken += broke;
    return broke;
  }

  // ---------- порт ----------
  private buildPort() {
    const isl = this.islands[0];
    // найти берег в юго-западном направлении
    const dir = new THREE.Vector3(-1, 0, 1).normalize();
    let shore = new THREE.Vector3(isl.cx, 0, isl.cz);
    for (let d = 0; d < isl.r * 1.4; d += 4) {
      const p = new THREE.Vector3(isl.cx, 0, isl.cz).addScaledVector(dir, d);
      if (heightAt(p.x, p.z) < 0.4) { shore = p; break; }
    }
    const dockEnd = shore.clone().addScaledVector(dir, 42);
    dockEnd.y = 0;
    this.port.dockEnd.copy(dockEnd);

    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xb09055, roughness: 0.95 });

    const dockLen = 46;
    const dock = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, dockLen), wood);
    const mid = shore.clone().addScaledVector(dir, dockLen / 2 - 2);
    dock.position.set(mid.x, 1.15, mid.z);
    dock.rotation.y = Math.atan2(dir.x, dir.z);
    dock.castShadow = true;
    this.group.add(dock);
    // сваи
    for (let i = 0; i <= 7; i++) {
      const p = shore.clone().addScaledVector(dir, i * (dockLen / 7));
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 4.4, 6), dark);
        post.position.set(p.x + Math.cos(Math.atan2(dir.x, dir.z)) * side * 2.0, -0.8, p.z - Math.sin(Math.atan2(dir.x, dir.z)) * side * 2.0);
        this.group.add(post);
      }
    }
    // фонари на конце пирса
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.4, 6), dark);
      const p = dockEnd.clone().add(new THREE.Vector3(Math.cos(Math.atan2(dir.x, dir.z)) * side * 1.9, 0, -Math.sin(Math.atan2(dir.x, dir.z)) * side * 1.9));
      pole.position.set(p.x, 2.6, p.z);
      this.group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb648, emissiveIntensity: 2.2 }));
      lamp.position.set(p.x, 4.4, p.z);
      this.group.add(lamp);
    }
    // хижины на берегу
    const hutBase = shore.clone().addScaledVector(dir, -16);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = -1; i <= 1; i++) {
      const hp = hutBase.clone().addScaledVector(perp, i * 12);
      const h = heightAt(hp.x, hp.z);
      const hut = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 4.6),
        new THREE.MeshStandardMaterial({ color: 0xbfa27a, roughness: 0.9 }));
      walls.position.y = 1.6;
      hut.add(walls);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.6, 4), roofMat);
      roof.position.y = 4.4;
      roof.rotation.y = Math.PI / 4;
      hut.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.15), dark);
      door.position.set(0, 1.1, 2.35);
      hut.add(door);
      hut.position.set(hp.x, Math.max(h, 0.8), hp.z);
      hut.rotation.y = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 0.5;
      hut.castShadow = true;
      this.group.add(hut);
    }
    // пальмы у порта гуще
    const rng = new RNG(WORLD_SEED + 777);
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2), rr = rng.range(18, 60);
      const x = hutBase.x + Math.cos(a) * rr, z = hutBase.z + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 1.0 || h > 8) continue;
      const palm = new THREE.Mesh(palmGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      const s = rng.range(0.8, 1.3);
      palm.scale.setScalar(s);
      palm.position.set(x, h - 0.1, z);
      palm.rotation.y = rng.range(0, 7);
      palm.castShadow = true;
      this.group.add(palm);
    }
  }

  // ---------- животные ----------
  private buildAnimals() {
    const rng = new RNG(WORLD_SEED + 555);

    // чайки: 3 стаи
    const gullGeo = new THREE.BufferGeometry();
    gullGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.55, 1.15, 0, -0.5, 1.15, 0, 0.5,   // правое крыло
      0, 0, 0.55, -1.15, 0, -0.5, -1.15, 0, 0.5,  // левое крыло
      0, 0, 0.9, 0.14, 0.05, -0.35, -0.14, 0.05, -0.35, // тельце
    ], 3));
    gullGeo.computeVertexNormals();
    const phases = new Float32Array(42);
    for (let i = 0; i < 42; i++) phases[i] = rng.range(0, Math.PI * 2);
    gullGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.gullMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aPhase;
        uniform float uTime;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 9.0 + aPhase) * abs(p.x) * 0.55;
          #ifdef USE_INSTANCING
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          #else
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
          #endif
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        void main() { gl_FragColor = vec4(0.93, 0.93, 0.9, 1.0); }`,
      side: THREE.DoubleSide,
    });
    this.gullMesh = new THREE.InstancedMesh(gullGeo, this.gullMat, 42);
    const flockIslands = [this.islands[0], this.islands[0], this.islands[4]];
    for (let i = 0; i < 42; i++) {
      const isl = flockIslands[Math.floor(i / 14)];
      this.gulls.push({
        island: isl, a: rng.range(0, Math.PI * 2), r: rng.range(isl.r * 0.35, isl.r * 0.85),
        speed: rng.range(0.12, 0.3) * (rng.next() < 0.5 ? 1 : -1),
        h: rng.range(22, 48), phase: rng.range(0, Math.PI * 2),
      });
    }
    this.group.add(this.gullMesh);

    // крабы
    const crabParts = [
      paint(tf(new THREE.BoxGeometry(0.5, 0.2, 0.36), 0, 0.12, 0), 0xc2542e),
      paint(tf(new THREE.BoxGeometry(0.16, 0.12, 0.22), 0.3, 0.14, 0.12, 0, 0, 0.5), 0xa8431f),
      paint(tf(new THREE.BoxGeometry(0.16, 0.12, 0.22), -0.3, 0.14, -0.12, 0, 0, -0.5), 0xa8431f),
    ];
    this.crabMesh = new THREE.InstancedMesh(mergeGeometries(crabParts)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 56);
    const crabIslands = [this.islands[0], this.islands[3], this.islands[7]];
    for (let i = 0; i < 56; i++) {
      const isl = crabIslands[i % crabIslands.length];
      const a = rng.range(0, Math.PI * 2);
      const r = isl.r * rng.range(0.75, 1.05);
      const x = isl.cx + Math.cos(a) * r, z = isl.cz + Math.sin(a) * r;
      this.crabs.push({ x, z, dirA: rng.range(0, Math.PI * 2), speed: rng.range(0.3, 0.9), timer: rng.range(0, 3), phase: rng.range(0, 7), island: isl });
    }
    this.group.add(this.crabMesh);

    // черепахи
    const turtleParts = [
      paint(tf(new THREE.SphereGeometry(0.75, 8, 6), 0, 0, 0).scale(1, 0.42, 1.2) as THREE.BufferGeometry, 0x4d6b3a),
      paint(tf(new THREE.SphereGeometry(0.22, 6, 5), 0, 0.02, 0.86), 0x6d8a52),
      paint(tf(new THREE.SphereGeometry(0.12, 5, 4), 0.55, -0.05, 0), 0x6d8a52),
      paint(tf(new THREE.SphereGeometry(0.12, 5, 4), -0.55, -0.05, 0), 0x6d8a52),
    ];
    this.turtleMesh = new THREE.InstancedMesh(mergeGeometries(turtleParts)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 14);
    for (let i = 0; i < 14; i++) {
      const isl = this.islands[i % 2 === 0 ? 3 : 0];
      this.turtles.push({ island: isl, a: rng.range(0, Math.PI * 2), r: isl.r * rng.range(1.02, 1.25), speed: rng.range(0.015, 0.05), h: 0, phase: rng.range(0, 7) });
    }
    this.group.add(this.turtleMesh);

    // обезьяны (прыгают в джунглях)
    const monkeyParts = [
      paint(tf(new THREE.BoxGeometry(0.32, 0.44, 0.26), 0, 0.32, 0), 0x4c3626),
      paint(tf(new THREE.SphereGeometry(0.17, 6, 5), 0, 0.68, 0.06), 0x5a4230),
      paint(tf(new THREE.CylinderGeometry(0.03, 0.05, 0.7, 4), 0, 0.45, -0.24, 0.7, 0, 0), 0x4c3626),
    ];
    this.monkeyMesh = new THREE.InstancedMesh(mergeGeometries(monkeyParts)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 22);
    const monkIslands = [this.islands[0], this.islands[1], this.islands[4]];
    for (let i = 0; i < 22; i++) {
      const isl = monkIslands[i % 3];
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        const a = rng.range(0, Math.PI * 2), rr = rng.range(0, isl.r * 0.8);
        x = isl.cx + Math.cos(a) * rr; z = isl.cz + Math.sin(a) * rr;
        ok = heightAt(x, z) > 2.2;
      }
      this.monkeys.push({
        from: new THREE.Vector3(x, heightAt(x, z), z),
        to: new THREE.Vector3(x, heightAt(x, z), z),
        t: 1, dur: 1.2, island: isl,
      });
    }
    this.group.add(this.monkeyMesh);

    // кабаны
    const boarParts = [
      paint(tf(new THREE.BoxGeometry(1.15, 0.62, 0.52), 0, 0.45, 0), 0x5d4a33),
      paint(tf(new THREE.BoxGeometry(0.42, 0.4, 0.34), 0.72, 0.42, 0), 0x51402c),
      paint(tf(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5), 0.95, 0.36, 0, 0, 0, Math.PI / 2), 0x3d2f1f),
    ];
    this.boarMesh = new THREE.InstancedMesh(mergeGeometries(boarParts)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 14);
    const boarIslands = [this.islands[0], this.islands[1], this.islands[4], this.islands[5]];
    for (let i = 0; i < 14; i++) {
      const isl = boarIslands[i % 4];
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        const a = rng.range(0, Math.PI * 2), rr = rng.range(0, isl.r * 0.75);
        x = isl.cx + Math.cos(a) * rr; z = isl.cz + Math.sin(a) * rr;
        const h = heightAt(x, z);
        ok = h > 1.6 && h < isl.maxH * 0.7;
      }
      this.boars.push({ x, z, dirA: rng.range(0, Math.PI * 2), speed: rng.range(0.4, 1.0), timer: rng.range(0, 4), phase: rng.range(0, 7), island: isl });
    }
    this.group.add(this.boarMesh);

    // акулы: плавники у рифов
    const finGeo = paint(tf(new THREE.ConeGeometry(0.34, 1.15, 4), 0, 0.5, 0).scale(1, 1, 0.45) as THREE.BufferGeometry, 0x5a6068);
    this.sharkMesh = new THREE.InstancedMesh(finGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 7);
    for (let i = 0; i < 7; i++) {
      const isl = this.islands[i % 2 === 0 ? 2 : 3];
      this.sharks.push({ island: isl, a: rng.range(0, Math.PI * 2), r: isl.r * rng.range(1.1, 1.5), speed: rng.range(0.06, 0.14), h: 0, phase: rng.range(0, 7) });
    }
    this.group.add(this.sharkMesh);
  }

  update(time: number, dt: number, playerPos: THREE.Vector3, waterHeight: (x: number, z: number, t: number) => number) {
    windTimeUniform.value = time;
    this.gullMat.uniforms.uTime.value = time;

    // чайки
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i];
      g.a += g.speed * dt;
      const x = g.island.cx + Math.cos(g.a) * g.r;
      const z = g.island.cz + Math.sin(g.a) * g.r;
      const y = g.h + Math.sin(time * 1.7 + g.phase) * 2.2;
      this.dummy.position.set(x, y, z);
      const heading = g.a + (g.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, heading, Math.sin(time * 9 + g.phase) * 0.14)));
      this.dummy.scale.setScalar(1.35);
      this.dummy.updateMatrix();
      this.gullMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.gullMesh.instanceMatrix.needsUpdate = true;

    // крабы: суета по пляжу
    for (let i = 0; i < this.crabs.length; i++) {
      const c = this.crabs[i];
      c.timer -= dt;
      if (c.timer < 0) { c.timer = 1 + Math.random() * 3; c.dirA += (Math.random() - 0.5) * 2.4; }
      const nx = c.x + Math.cos(c.dirA) * c.speed * dt;
      const nz = c.z + Math.sin(c.dirA) * c.speed * dt;
      const h = heightAt(nx, nz);
      if (h > 0.15 && h < 1.8 && Math.hypot(nx - c.island.cx, nz - c.island.cz) < c.island.r * 1.15) { c.x = nx; c.z = nz; }
      else c.dirA += Math.PI * 0.6;
      this.dummy.position.set(c.x, h, c.z);
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, -c.dirA, 0))); // боком
      this.dummy.scale.setScalar(0.9 + Math.sin(time * 8 + c.phase) * 0.05);
      this.dummy.updateMatrix();
      this.crabMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.crabMesh.instanceMatrix.needsUpdate = true;

    // черепахи и акулы — медленные круги у берега
    for (let i = 0; i < this.turtles.length; i++) {
      const t = this.turtles[i];
      t.a += t.speed * dt;
      const x = t.island.cx + Math.cos(t.a) * t.r;
      const z = t.island.cz + Math.sin(t.a) * t.r;
      const wy = waterHeight(x, z, time);
      this.dummy.position.set(x, wy - 0.12, z);
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, -(t.a + Math.PI / 2) * Math.sign(t.speed), 0)));
      this.dummy.scale.setScalar(1.1);
      this.dummy.updateMatrix();
      this.turtleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.turtleMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.sharks.length; i++) {
      const s = this.sharks[i];
      s.a += s.speed * dt;
      const x = s.island.cx + Math.cos(s.a) * s.r;
      const z = s.island.cz + Math.sin(s.a) * s.r;
      const wy = waterHeight(x, z, time);
      this.dummy.position.set(x, wy + 0.28, z);
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, -(s.a + Math.PI / 2), 0)));
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.sharkMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.sharkMesh.instanceMatrix.needsUpdate = true;

    // обезьяны: прыжки
    for (let i = 0; i < this.monkeys.length; i++) {
      const mk = this.monkeys[i];
      mk.t += dt / mk.dur;
      if (mk.t >= 1) {
        mk.t = 0;
        mk.dur = 0.9 + Math.random() * 0.8;
        mk.from.copy(mk.to);
        let ok = false;
        for (let t = 0; t < 20 && !ok; t++) {
          const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 7;
          const x = mk.from.x + Math.cos(a) * rr, z = mk.from.z + Math.sin(a) * rr;
          const h = heightAt(x, z);
          if (h > 2.0 && h < mk.island.maxH * 0.85 && Math.hypot(x - mk.island.cx, z - mk.island.cz) < mk.island.r * 0.9) {
            mk.to.set(x, h, z); ok = true;
          }
        }
        if (!ok) mk.to.copy(mk.from);
      }
      const k = Math.min(1, mk.t);
      const x = THREE.MathUtils.lerp(mk.from.x, mk.to.x, k);
      const z = THREE.MathUtils.lerp(mk.from.z, mk.to.z, k);
      const y = THREE.MathUtils.lerp(mk.from.y, mk.to.y, k) + Math.sin(k * Math.PI) * 1.35;
      this.dummy.position.set(x, y, z);
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, Math.atan2(mk.to.x - mk.from.x, mk.to.z - mk.from.z), 0)));
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.monkeyMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.monkeyMesh.instanceMatrix.needsUpdate = true;

    // кабаны: блуждание
    for (let i = 0; i < this.boars.length; i++) {
      const b = this.boars[i];
      b.timer -= dt;
      if (b.timer < 0) { b.timer = 2 + Math.random() * 4; b.dirA += (Math.random() - 0.5) * 1.8; }
      const nx = b.x + Math.cos(b.dirA) * b.speed * dt;
      const nz = b.z + Math.sin(b.dirA) * b.speed * dt;
      const h = heightAt(nx, nz);
      if (h > 1.4 && h < b.island.maxH * 0.75 && Math.hypot(nx - b.island.cx, nz - b.island.cz) < b.island.r * 0.85) { b.x = nx; b.z = nz; }
      else b.dirA += Math.PI * 0.7;
      this.dummy.position.set(b.x, h, b.z);
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, -b.dirA + Math.PI / 2, 0)));
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.boarMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.boarMesh.instanceMatrix.needsUpdate = true;

    // открытие островов
    for (const isl of this.islands) {
      if (this.discovered.has(isl.name)) continue;
      const d = Math.hypot(playerPos.x - isl.cx, playerPos.z - isl.cz);
      if (d < isl.r + 320) {
        this.discovered.add(isl.name);
        isl.discovered = true;
        this.onDiscover?.(isl);
      }
    }
  }

  onDiscover?: (isl: IslandDef) => void;
}
