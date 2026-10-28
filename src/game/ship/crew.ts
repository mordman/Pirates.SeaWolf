import * as THREE from 'three';
import { ShipPreset, hullProfile } from './buildShip';
import type { GibPool } from '../fx/gibs';
import type { Particles } from '../fx/particles';

// ============================================================
// Экипаж на палубе: процедурные типажи «наугад» — бороды,
// крюки вместо руки, деревянные ноги, повязки на глаз, тель-
// нявки/банданы/треуголки. Роли: капитан (шкафут у штурвала),
// боцман (у шпиля), канониры у пушек, вахтенные у мачт,
// «ходоки» — бродят по палубе.
// ПОТЕРИ: картечь ВАЛИТ фигуры (падают трупами на палубу),
// ядро насквозь РАЗРЫВАЕТ на куски (гибы + кровь); абстракт-
// ные потери тоже обращаются в трупы. При затоплении экипаж
// «покидает» корабль.
// ============================================================

// глобальные эффекты для смертей (один экземпляр на игру)
let FX: { gibs: GibPool | null; particles: Particles | null } = { gibs: null, particles: null };
/** Вызывается один раз из game.ts после создания GibPool */
export function setCrewFx(gibs: GibPool, particles: Particles) {
  FX = { gibs, particles };
}

type CrewRole = 'captain' | 'boatswain' | 'gunner' | 'watch' | 'walker';
type DeathMode = 'fall' | 'gib';
/** способ поражения: картечь валит, ядро разрывает */
type KillMode = 'grape' | 'ball';

interface CrewFigure {
  group: THREE.Group;
  role: CrewRole;
  legL?: THREE.Mesh;          // только у ходоков (анимация шага)
  legR?: THREE.Mesh;
  seed: number;
  // ходьба: путь туда-обратно по палубе
  walkA?: number; walkB?: number; // z-границы пути
  walkT: number;              // 0..1 фаза пути
  walkDir: number;            // ±1
  walkSpeed: number;
  xPath?: number;
  phase: number;              // фаза покачивания
  // --- смерть ---
  dead: boolean;
  deadT: number;              // сек с момента смерти
  deathMode: DeathMode;       // 'fall' — труп, 'gib' — разорвало
  corpseLife: number;         // сколько труп лежит, сек
  fallDir: number;            // ±1: упасть вперёд/назад
  fallRoll: number;           // боковой наклон при падении
  // цвета/протезы — для кусков при разрыве
  skin: number; shirt: number; pants: number;
  hasHook: boolean; hasPeg: boolean;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// палитры (наугад комбинируются)
const SKIN = [0xd9a184, 0xc98d68, 0xb3765a, 0xa06a4f, 0x8a5a42, 0xe0b294];
const SHIRT = [0xcbb8a0, 0x8f3b34, 0x35526b, 0x5b6e46, 0x7a5f8a, 0xa8763e, 0x3d4a5c];
const PANTS = [0x4a3a2a, 0x33404a, 0x5a4a38, 0x2c2c30, 0x614b33];
const BANDANA = [0xa3362c, 0x2f5e8a, 0x3c6b3f, 0x8a6a2a, 0x55355f];
const HAT = 0x2b2018;
const COAT = [0x2e2a3a, 0x3a2620, 0x1f3038, 0x40222a];
const BEARD = [0x2c2118, 0x4a3524, 0x6b5136, 0x8a8a86, 0x1d1712];
const WOOD = 0x8a6a42;
const METAL = 0x3a3f46;

interface Traits {
  skin: number; shirt: number; pants: number;
  beard: 0 | 1 | 2;        // нет / короткая / длинная
  hook: -1 | 0 | 1;        // нет / правая / левая рука
  pegLeg: -1 | 0 | 1;      // нет / правая / левая нога
  eyePatch: boolean;
  headwear: 'none' | 'bandana' | 'hat';
  striped: boolean;
  height: number;          // 0.92..1.08
}

function rollTraits(rnd: () => number, role: CrewRole): Traits {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  return {
    skin: pick(SKIN),
    shirt: pick(SHIRT),
    pants: pick(PANTS),
    beard: rnd() < 0.55 ? (rnd() < 0.4 ? 2 : 1) : 0,
    hook: rnd() < 0.22 ? (rnd() < 0.5 ? 1 : -1) : 0,
    pegLeg: rnd() < 0.18 ? (rnd() < 0.5 ? 1 : -1) : 0,
    eyePatch: rnd() < 0.25,
    headwear: role === 'captain' ? 'hat' : rnd() < 0.45 ? 'bandana' : rnd() < 0.35 ? 'hat' : 'none',
    striped: role !== 'captain' && rnd() < 0.4,
    height: 0.92 + rnd() * 0.16,
  };
}

/** Запечь геометрию с цветом в общие массивы (как реквизит палубы) */
function bake(target: { pos: number[]; col: number[] }, geo: THREE.BufferGeometry, color: number,
  x: number, y: number, z: number, euler?: THREE.Euler, scale?: [number, number, number]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const c = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (scale) v.multiply(new THREE.Vector3(...scale));
    if (euler) v.applyEuler(euler);
    target.pos.push(v.x + x, v.y + y, v.z + z);
    target.col.push(c.r, c.g, c.b);
  }
}

function bakeGeom(t: { pos: number[]; col: number[] }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  g.computeVertexNormals();
  return g;
}

const CREW_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.03 });

/**
 * Собрать фигурку. feetY — уровень палубы под ногами (в локальных
 * координатах корабля). Возвращает группу с 1..3 мешами.
 * Оси: +Z — нос (лицо по умолчанию к носу), +X — порт.
 */
function buildFigure(role: CrewRole, traits: Traits, seed: number): CrewFigure {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const t: { pos: number[]; col: number[] } = { pos: [], col: [] };
  const h = traits.height;
  // размеры (м): фигура ~1.6 м
  const legH = 0.62, torsoH = role === 'captain' ? 0.62 : 0.5, torsoW = role === 'captain' ? 0.4 : 0.36;
  const hipY = legH;
  const torsoY = hipY + torsoH / 2;
  const headR = 0.13;
  const headY = hipY + torsoH + headR + 0.02;

  // --- торс (тельняшка — полосами) ---
  if (traits.striped) {
    const stripeC = [0xe8e2d4, traits.shirt];
    const n = 5;
    for (let i = 0; i < n; i++) {
      bake(t, new THREE.BoxGeometry(torsoW, torsoH / n + 0.005, 0.22),
        stripeC[i % 2], 0, hipY + torsoH * (i + 0.5) / n, 0);
    }
  } else {
    bake(t, new THREE.BoxGeometry(torsoW, torsoH, 0.22), traits.shirt, 0, torsoY, 0);
  }
  // капитан: длинный кафтан + золотой кант
  if (role === 'captain') {
    bake(t, new THREE.BoxGeometry(torsoW + 0.06, 0.42, 0.26), rnd() < 0.5 ? COAT[0] : COAT[1], 0, hipY + 0.05, 0);
    bake(t, new THREE.BoxGeometry(0.05, torsoH * 0.9, 0.015), 0xb8912f, 0, torsoY, 0.135);
  }

  // --- руки: плечо→кисть, у боцмана/канонира правая рука к борту ---
  const armLen = 0.48;
  for (const side of [-1, 1] as const) {
    const isHook = traits.hook === side;
    const sh = new THREE.Vector3(side * (torsoW / 2 + 0.05), hipY + torsoH - 0.06, 0);
    const rot = new THREE.Euler(0, 0, side * -0.35);
    bake(t, new THREE.BoxGeometry(0.1, armLen * 0.55, 0.11), role === 'captain' ? COAT[0] : traits.shirt,
      sh.x * 0.75, sh.y - armLen * 0.26, 0.03, rot);
    // предплечье/кисть
    if (isHook) {
      // деревянная культа + крюк
      bake(t, new THREE.BoxGeometry(0.085, 0.2, 0.09), WOOD, sh.x * 1.25, sh.y - armLen * 0.62, 0.08, rot);
      const hookE = new THREE.Euler(0, 0, side * 1.57);
      bake(t, new THREE.TorusGeometry(0.06, 0.018, 5, 10, Math.PI * 1.2), METAL,
        sh.x * 1.32, sh.y - armLen * 0.78, 0.1, hookE);
    } else {
      bake(t, new THREE.BoxGeometry(0.09, 0.22, 0.1), traits.skin,
        sh.x * 1.2, sh.y - armLen * 0.72, 0.06, rot);
    }
  }

  // --- голова ---
  bake(t, new THREE.SphereGeometry(headR, 10, 8), traits.skin, 0, headY, 0);
  // волосы (если нет головного убора или под ним)
  bake(t, new THREE.SphereGeometry(headR * 1.04, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    BEARD[Math.floor(rnd() * BEARD.length)], 0, headY + 0.01, 0);
  // повязка на глаз: наглазник + ремешок через лоб
  if (traits.eyePatch) {
    const eyeX = rnd() < 0.5 ? -0.052 : 0.052;
    bake(t, new THREE.BoxGeometry(0.075, 0.07, 0.02), 0x141414, eyeX, headY + 0.01, headR - 0.008);
    bake(t, new THREE.BoxGeometry(headR * 2.05, 0.024, 0.02), 0x141414, 0, headY + 0.045, headR - 0.006,
      new THREE.Euler(0, 0, 0.16));
  }
  // борода
  if (traits.beard > 0) {
    const bl = traits.beard === 2 ? 0.3 : 0.14;
    bake(t, new THREE.BoxGeometry(0.15, bl, 0.08),
      BEARD[Math.floor(rnd() * BEARD.length)], 0, headY - headR * 0.55 - bl * 0.25, headR - 0.045);
    if (traits.beard === 2) {
      bake(t, new THREE.BoxGeometry(0.1, 0.14, 0.06), 0x1d1712, 0, headY - headR * 0.55 - bl - 0.05, headR - 0.05);
    }
  }
  // головной убор
  if (traits.headwear === 'bandana') {
    const bc = BANDANA[Math.floor(rnd() * BANDANA.length)];
    bake(t, new THREE.SphereGeometry(headR * 1.06, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), bc, 0, headY + 0.02, 0);
    bake(t, new THREE.BoxGeometry(0.05, 0.05, 0.12), bc, 0.06, headY + 0.06, -headR - 0.03);
  } else if (traits.headwear === 'hat') {
    // треуголка: поля + тулья
    const brim = role === 'captain' ? 0.34 : 0.28;
    bake(t, new THREE.BoxGeometry(brim, 0.025, brim * 0.8), HAT, 0, headY + headR * 0.82, 0,
      new THREE.Euler(0, 0.35, 0));
    bake(t, new THREE.BoxGeometry(brim * 0.62, 0.12, brim * 0.5), HAT, 0, headY + headR * 0.95, 0,
      new THREE.Euler(0, 0.35, 0));
    if (role === 'captain') bake(t, new THREE.BoxGeometry(0.06, 0.02, 0.1), 0xb8912f, 0, headY + headR * 0.86, brim * 0.28);
  }

  // --- предметы ролей ---
  if (role === 'captain') {
    // подзорная труба в правой руке
    bake(t, new THREE.CylinderGeometry(0.035, 0.05, 0.34, 6), 0xb8912f, torsoW / 2 + 0.14, hipY + 0.18, 0.14,
      new THREE.Euler(1.1, 0, -0.5));
  }
  if (role === 'boatswain') {
    // свисток боцмана на груди
    bake(t, new THREE.CylinderGeometry(0.018, 0.018, 0.1, 5), 0xb8912f, 0.07, torsoY + 0.04, 0.125,
      new THREE.Euler(1.57, 0, 0.2));
  }

  const body = new THREE.Mesh(bakeGeom(t), CREW_MAT);
  group.add(body);

  // --- ноги: у ходоков отдельные (шаг), у остальных в общий меш ---
  const mkLeg = (side: number, wood: boolean): THREE.Mesh => {
    const lt: { pos: number[]; col: number[] } = { pos: [], col: [] };
    if (wood) {
      bake(lt, new THREE.CylinderGeometry(0.05, 0.062, legH + 0.06, 6), WOOD, 0, (legH + 0.06) / 2, 0);
    } else {
      bake(lt, new THREE.BoxGeometry(0.11, legH, 0.13), traits.pants, 0, legH / 2, 0);
      bake(lt, new THREE.BoxGeometry(0.115, 0.07, 0.2), 0x1f1a14, 0, 0.035, 0.03);
    }
    const m = new THREE.Mesh(bakeGeom(lt), CREW_MAT);
    m.position.set(side * 0.095, legH, 0);
    return m;
  };

  if (role === 'walker') {
    const legL = mkLeg(-1, traits.pegLeg === -1);
    const legR = mkLeg(1, traits.pegLeg === 1);
    group.add(legL, legR);
    // центр вращения ноги — бедро
    for (const leg of [legL, legR]) {
      const off = leg.position.y;
      leg.geometry.translate(0, -off, 0);
      leg.position.y = off;
    }
    return {
      group, role, legL, legR, seed, walkT: rnd(), walkDir: rnd() < 0.5 ? 1 : -1,
      walkSpeed: 0.55 + rnd() * 0.5, phase: rnd() * 6.28,
      dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
      skin: traits.skin, shirt: traits.shirt, pants: traits.pants,
      hasHook: traits.hook !== 0, hasPeg: traits.pegLeg !== 0,
    };
  }
  // статичные: ноги вторым мешом (деревянная нога заменяет одну из них)
  const legsStatic = new THREE.Mesh(bakeGeom(t2legs(traits, legH)), CREW_MAT);
  group.add(legsStatic);
  return {
    group, role, seed, walkT: 0, walkDir: 1, walkSpeed: 0, phase: rnd() * 6.28,
    dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
    skin: traits.skin, shirt: traits.shirt, pants: traits.pants,
    hasHook: traits.hook !== 0, hasPeg: traits.pegLeg !== 0,
  };
}

/** ноги для статичной фигуры отдельным мешом */
function t2legs(traits: Traits, legH: number): { pos: number[]; col: number[] } {
  const t: { pos: number[]; col: number[] } = { pos: [], col: [] };
  for (const side of [-1, 1]) {
    if (traits.pegLeg === side) {
      bake(t, new THREE.CylinderGeometry(0.05, 0.062, legH + 0.06, 6), WOOD, side * 0.095, (legH + 0.06) / 2, 0);
    } else {
      bake(t, new THREE.BoxGeometry(0.11, legH, 0.13), traits.pants, side * 0.095, legH / 2, 0);
      bake(t, new THREE.BoxGeometry(0.115, 0.07, 0.2), 0x1f1a14, side * 0.095, 0.035, 0.03);
    }
  }
  return t;
}

/** Состояние корабля для анимации экипажа */
export interface CrewShipState {
  crew: number; maxCrew: number; sinking: boolean; sunk: boolean;
  position: THREE.Vector3; quaternion: THREE.Quaternion;
}

export interface CrewVisual {
  group: THREE.Group;
  total: number;
  shown: number;          // живые видимые фигуры
  dead: number;           // потери (трупы + разорванные)
  update(dt: number, time: number, ship: CrewShipState): void;
  setVisible(v: boolean): void;
  /** Поражение экипажа вдоль пути снаряда (a→b в ЛОКАЛЬНЫХ координатах
   *  корабля). grape — фигуры падают; ball — разрывает на куски.
   *  Возвращает число убитых. */
  killNearPath(a: THREE.Vector3, b: THREE.Vector3, mode: KillMode,
    maxCount: number, radius: number,
    shipPos: THREE.Vector3, shipQuat: THREE.Quaternion): number;
  /** Оживить всех (полигон/сброс повреждений) */
  reset(): void;
}

/** Собрать экипаж для корабля (local coords: +Z нос, +X порт) */
export function buildCrew(P: ShipPreset, seed: number): CrewVisual {
  const group = new THREE.Group();
  const L = P.length;
  const deckYAt = (z: number) => {
    const t = Math.min(1, Math.max(0, (z + L / 2) / L));
    return hullProfile(t, P).bulwark - 1.0;
  };
  const halfW = (z: number) => {
    const t = Math.min(1, Math.max(0, (z + L / 2) / L));
    return hullProfile(t, P).w;
  };
  const figures: CrewFigure[] = [];
  const place = (f: CrewFigure, x: number, z: number, faceDir: number) => {
    f.group.position.set(x, deckYAt(z), z);
    f.group.rotation.y = faceDir;
    group.add(f.group);
    figures.push(f);
  };
  const rot = mulberry32(seed * 7919 + 13);
  let s = seed * 104729 + 7;
  const nextSeed = () => { s = (s * 16807) % 2147483647; return s % 100000; };

  // капитан — у штурвала, лицом к носу
  place(buildFigure('captain', rollTraits(rot, 'captain'), nextSeed()), 0.55, -L * 0.245, 0.3);
  // боцман — у шпиля (шпиль на -L*0.16), спиной к ветру, лицом к носу-борту
  place(buildFigure('boatswain', rollTraits(rot, 'boatswain'), nextSeed()), -0.75, -L * 0.115, 0.5);

  // канониры: за орудиями обоих бортов (через одно — чтобы не толпиться)
  const gunZ0 = -L * 0.22, gunZ1 = L * 0.24;
  const nGuns = P.gunsPerSide;
  let gi = 0;
  for (let i = 0; i < nGuns; i += 2) {
    const z = THREE.MathUtils.lerp(gunZ0, gunZ1, nGuns === 1 ? 0.5 : i / (nGuns - 1));
    const w = halfW(z);
    for (const side of [-1, 1]) {
      const f = buildFigure('gunner', rollTraits(rot, 'gunner'), nextSeed());
      place(f, side * (w * 0.56), z + 0.55, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      gi++;
    }
  }
  // вахтенные у мачт
  const mastZ = P.masts === 2 ? [L * 0.16, -L * 0.10] : [L * 0.18, -L * 0.05, -L * 0.28];
  mastZ.forEach((mz, i) => {
    const f = buildFigure('watch', rollTraits(rot, 'watch'), nextSeed());
    place(f, (i % 2 ? 1 : -1) * Math.max(0.7, halfW(mz) * 0.42), mz + 0.9, (i % 2 ? 1 : -1) * (Math.PI / 2));
  });

  // ходоки: 2–3 фигуры гуляют по палубе
  const nWalk = P.masts === 3 ? 3 : 2;
  for (let i = 0; i < nWalk; i++) {
    const f = buildFigure('walker', rollTraits(rot, 'walker'), nextSeed());
    f.xPath = (i % 2 ? 1 : -1) * Math.max(0.55, halfW(0) * 0.34);
    f.walkA = -L * 0.3;
    f.walkB = L * 0.28;
    f.walkT = rot();
    figures.push(f);
    group.add(f.group);
  }

  group.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  // масштаб по высоте применяем к группе (высота фигурки внутри)
  for (const f of figures) f.group.scale.setScalar(1);

  // --- убийство фигуры: картечь валит трупом, ядро разрывает ---
  const killFigure = (f: CrewFigure, mode: KillMode,
    a: THREE.Vector3, b: THREE.Vector3,
    shipPos: THREE.Vector3, shipQuat: THREE.Quaternion) => {
    f.dead = true;
    f.deadT = 0;
    f.deathMode = mode === 'grape' ? 'fall' : 'gib';
    // мировые координаты центра тела
    const lp = f.group.position;
    const wpos = new THREE.Vector3(lp.x, lp.y + 0.75, lp.z).applyQuaternion(shipQuat).add(shipPos);
    // мировое направление пути снаряда
    const wdir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    if (wdir.lengthSq() < 1e-6) wdir.set(0, 0, 1);
    wdir.applyQuaternion(shipQuat).normalize();

    if (mode === 'grape') {
      // картечь: осел — падает на палубу трупом
      f.corpseLife = 28 + Math.random() * 27;
      f.fallDir = Math.random() < 0.5 ? 1 : -1;
      f.fallRoll = (Math.random() - 0.5) * 0.8;
      FX.particles?.blood(wpos.x, wpos.y - 0.35, wpos.z, wdir.x * 1.5, 0.4, wdir.z * 1.5, 7, 0.7);
    } else {
      // ядро насквозь: фигуры больше нет — куски летят вдоль пути
      f.group.visible = false;
      f.corpseLife = 0;
      const gibs = FX.gibs;
      if (gibs) {
        const mk = (sx: number, sy: number, sz: number, hex: number, extra = 1) => {
          const push = (2.6 + Math.random() * 3.6) * extra;
          gibs.spawnPart(
            new THREE.Vector3(
              wpos.x + (Math.random() - 0.5) * 0.35,
              wpos.y + (Math.random() - 0.5) * 0.7,
              wpos.z + (Math.random() - 0.5) * 0.35),
            new THREE.Vector3(
              wdir.x * push + (Math.random() - 0.5) * 3.4,
              1.5 + Math.random() * 3.0,
              wdir.z * push + (Math.random() - 0.5) * 3.4),
            sx, sy, sz, hex, 1.5 + Math.random() * 1.1);
        };
        mk(0.14, 0.14, 0.14, f.skin);        // голова
        mk(0.24, 0.2, 0.16, f.shirt, 1.15);  // торс
        mk(0.09, 0.3, 0.09, f.shirt, 0.9);   // рука
        mk(0.09, 0.28, 0.09, f.skin, 0.85);  // рука
        mk(0.11, 0.44, 0.12, f.pants, 0.8);  // нога
        if (f.hasPeg) mk(0.09, 0.48, 0.09, 0x8a6a42, 0.75); // деревянная нога
        if (f.hasHook) mk(0.09, 0.09, 0.09, 0x3a3f46, 1.3); // крюк
      }
      FX.particles?.blood(wpos.x, wpos.y, wpos.z, wdir.x * 4, 1.1, wdir.z * 4, 16, 1.4);
    }
  };

  const vis: CrewVisual = {
    group, total: figures.length, shown: figures.length, dead: 0,
    setVisible(v: boolean) { group.visible = v; },
    killNearPath(a, b, mode, maxCount, radius, shipPos, shipQuat) {
      // кандидаты: живые видимые фигуры у пути снаряда
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const cands: { f: CrewFigure; d: number }[] = [];
      for (const f of figures) {
        if (f.dead || !f.group.visible) continue;
        const p = f.group.position;
        let t = len2 > 1e-9 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
        if (d > radius) continue;
        // путь должен проходить на высоте тела (не под палубой и не над головами)
        const yPath = a.y + (b.y - a.y) * t;
        if (yPath < p.y - 0.15 || yPath > p.y + 2.05) continue;
        cands.push({ f, d });
      }
      if (!cands.length) return 0;
      cands.sort((u, v) => u.d - v.d);
      const n = Math.min(maxCount, cands.length);
      for (let i = 0; i < n; i++) killFigure(cands[i].f, mode, a, b, shipPos, shipQuat);
      vis.dead = figures.filter(f => f.dead).length;
      vis.shown = figures.filter(f => !f.dead && f.group.visible).length;
      return n;
    },
    reset() {
      for (const f of figures) {
        f.dead = false;
        f.deadT = 0;
        f.corpseLife = 0;
        f.deathMode = 'fall';
        f.group.visible = true;
        f.group.rotation.x = 0;
        f.group.rotation.z = 0;
        f.group.scale.setScalar(1);
      }
      vis.dead = 0;
      vis.shown = figures.length;
    },
    update(dt, time, ship) {
      if (ship.sunk) { group.visible = false; return; }
      group.visible = !ship.sinking;
      if (ship.sinking) return;

      // --- трупы: падение и истлевание ---
      for (const f of figures) {
        if (!f.dead || f.deathMode !== 'fall') continue;
        f.deadT += dt;
        const k = Math.min(1, f.deadT / 0.5);
        const e = 1 - (1 - k) * (1 - k); // easeOut
        f.group.rotation.x = f.fallDir * (Math.PI / 2 - 0.07) * e;
        f.group.rotation.z = f.fallRoll * e;
        if (f.deadT > f.corpseLife) {
          // истлел: усох за 1.2 с
          const fade = Math.max(0, 1 - (f.deadT - f.corpseLife) / 1.2);
          f.group.scale.setScalar(Math.max(0.01, fade));
          if (fade <= 0) f.group.visible = false;
        }
      }

      // --- потери команды: недостающие фигуры становятся трупами ---
      const frac = Math.max(ship.crew, 0) / Math.max(ship.maxCrew, 1);
      const nAlive = figures.reduce((a, f) => a + (f.dead ? 0 : 1), 0);
      const budget = Math.max(1, Math.ceil(nAlive * Math.min(1, frac * 1.3)));
      const order: CrewRole[] = ['walker', 'watch', 'gunner', 'boatswain', 'captain'];
      let shownAlive = 0;
      let excess: CrewFigure | null = null; // одна «потеря» за кадр
      for (const role of order) {
        for (const f of figures) {
          if (f.role !== role || f.dead) continue;
          if (shownAlive < budget) shownAlive++;
          else if (!excess) excess = f;
        }
      }
      if (excess) killFigure(excess, 'grape', excess.group.position,
        excess.group.position.clone().add(new THREE.Vector3(0, 0, 1)),
        ship.position, ship.quaternion);
      vis.dead = figures.reduce((a, f) => a + (f.dead ? 1 : 0), 0);
      vis.shown = shownAlive;

      // --- анимация живых ---
      for (const f of figures) {
        if (!f.group.visible || f.dead) continue;
        if (f.role === 'walker' && f.xPath !== undefined && f.walkA !== undefined && f.walkB !== undefined) {
          const span = f.walkB - f.walkA;
          f.walkT += (f.walkDir * f.walkSpeed * dt) / span;
          if (f.walkT > 1) { f.walkT = 1; f.walkDir = -1; }
          if (f.walkT < 0) { f.walkT = 0; f.walkDir = 1; }
          const z = THREE.MathUtils.lerp(f.walkA, f.walkB, f.walkT);
          f.group.position.set(f.xPath, deckYAt(z), z);
          f.group.rotation.y = f.walkDir > 0 ? 0 : Math.PI;
          const step = time * f.walkSpeed * 7;
          if (f.legL && f.legR) {
            f.legL.rotation.x = Math.sin(step) * 0.55;
            f.legR.rotation.x = -Math.sin(step) * 0.55;
          }
          f.group.position.y += Math.abs(Math.sin(step)) * 0.03;
        } else {
          // idle: лёгкое покачивание, боцман «осматривается»
          const sway = Math.sin(time * 1.3 + f.phase) * 0.035;
          f.group.rotation.z = sway;
          if (f.role === 'boatswain') {
            f.group.rotation.y = 0.5 + Math.sin(time * 0.4 + f.phase) * 0.8;
          } else if (f.role === 'gunner') {
            f.group.rotation.z = sway * 0.5;
          }
        }
      }
    },
  };
  return vis;
}
