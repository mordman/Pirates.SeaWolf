import * as THREE from 'three';
import { ShipPreset, hullProfile, gunLayout, wheelZFor, quarterFrontZ } from './buildShip';
import type { GibPool } from '../fx/gibs';
import type { Particles } from '../fx/particles';

// ============================================================
// Экипаж на палубе: процедурные типажи «наугад» — бороды,
// крюки вместо руки, деревянные ноги, повязки на глаз, тель-
// нявки/банданы/треуголки. Роли: капитан (шкафут у штурвала),
// боцман (у шпиля), канониры у пушек, вахтенные у мачт,
// «ходоки» — бродят по палубе (4 полосы движения).
// ЧИСЛЕННОСТЬ (по ТЗ пользователя): одна фигура = ОДИН
// человек. На палубе видно deckCrewFor(экипаж):
//   500 человек → 50 фигур; 50 → 10; ≥10 всегда минимум 10;
//   осталось ≤10 — показываем ВСЕХ (экипаж 10 → 10 фигур).
// Степенная интерполяция 10·(N/50)^0.7 между опорными точками.
// ПОТЕРИ: картечь ВАЛИТ фигуры (падают трупами на палубу),
// ядро насквозь РАЗРЫВАЕТ на куски (гибы + кровь); каждая
// убитая фигура = −1 человек экипажа. Абстрактные потери
// (пожар/сдача в плен) тоже обращаются в трупы. При затоплении
// экипаж «покидает» корабль.
// buildFigure/rollTraits экспортируются — те же пираты живут
// на острове логова (world/islandFolk.ts).
// ============================================================

/** Живая ёмкость палубы (перф-потолок числа фигур) */
export const MAX_DECK_FIGURES = 80;

/** Сколько человек видно на палубе (1 фигура = 1 человек).
 *  Опоры от пользователя: 500→50, 50→10, всегда ≥10, при N≤10 —
 *  все; между точками — степень 10·(N/50)^0.7; 0 → палуба пуста */
export function deckCrewFor(crew: number): number {
  const n = Math.max(0, Math.round(crew));
  if (n <= 0) return 0;
  if (n <= 10) return n;                    // осталось мало — показываем всех
  const scaled = Math.round(10 * Math.pow(n / 50, 0.7));
  return Math.min(n, Math.max(10, scaled)); // никогда < 10 (если есть хоть 10)
}

// глобальные эффекты для смертей (один экземпляр на игру;
// общий для палубного экипажа и островных пиратов)
let FX: { gibs: GibPool | null; particles: Particles | null } = { gibs: null, particles: null };
/** Вызывается один раз из game.ts после создания GibPool */
export function setCrewFx(gibs: GibPool, particles: Particles) {
  FX = { gibs, particles };
}
/** Текущие эффекты (гибы/частицы) — для islandFolk.ts */
export function crewFx() { return FX; }

type CrewRole = 'captain' | 'boatswain' | 'gunner' | 'watch' | 'walker' | 'helmsman' | 'rower';
export type DeathMode = 'fall' | 'gib';
/** способ поражения: картечь валит, ядро разрывает */
export type KillMode = 'grape' | 'ball';

export interface CrewFigure {
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
  walkPause?: number;         // сек паузы у поворота (осматривается)
  driftAmp?: number;          // дрейф полосы поперёк палубы, м
  driftPeriod?: number;       // период дрейфа, сек
  xPath?: number;
  phase: number;              // фаза покачивания
  baseScaleY: number;         // исходный рост (гребцы «сидят» — 0.78)
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

export function mulberry32(seed: number) {
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

export function rollTraits(rnd: () => number, role: CrewRole): Traits {
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

export const CREW_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.03 });

/** Собрать фигурку (экспорт для островных пиратов islandFolk.ts).
 *  feetY задаётся позиционированием группы: фигура ~1.6 м.
 *  Оси: +Z — лицо (по умолчанию к носу корабля), +X — порт. */
export function buildFigure(role: CrewRole, traits: Traits, seed: number): CrewFigure {
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
    if (role === 'helmsman') {
      // рулевой: руки вытянуты ВПЕРЁД к штурвалу (+Z — нос)
      const rot = new THREE.Euler(-1.15, 0, side * -0.22);
      bake(t, new THREE.BoxGeometry(0.1, armLen * 0.55, 0.11), traits.shirt,
        sh.x * 0.8, sh.y - 0.06, 0.16, rot);
      if (!isHook) {
        bake(t, new THREE.BoxGeometry(0.09, 0.24, 0.1), traits.skin,
          sh.x * 1.0, sh.y - 0.02, 0.42, rot);
      } else {
        bake(t, new THREE.BoxGeometry(0.085, 0.2, 0.09), WOOD, sh.x * 1.0, sh.y - 0.02, 0.4, rot);
      }
      continue;
    }
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
      group, role, legL, legR, seed, walkT: rnd(), walkDir: rnd() < 0.5 ? 1 : -1, baseScaleY: 1,
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
    group, role, seed, walkT: 0, walkDir: 1, walkSpeed: 0, phase: rnd() * 6.28, baseScaleY: 1,
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

/** Расстояние между отрезками AB и CD в 3D (для капсул фигур);
 *  при c=d — расстояние от точки до отрезка */
export function segSegDist3D(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const uu = u.dot(u), vv = v.dot(v), uv = u.dot(v);
  const wu = w.dot(u), wv = w.dot(v);
  const den = uu * vv - uv * uv;
  let s: number, t: number;
  if (den < 1e-9) { s = 0; t = vv > 1e-9 ? clampN(wv / vv, 0, 1) : 0; }
  else { s = clampN((uv * wv - vv * wu) / den, 0, 1); t = clampN((uv * wu - uu * wv) / den, 0, 1); }
  // одна итерация уточнения (границы)
  const t2 = clampN((uv * s + wv) / (vv > 1e-9 ? vv : 1), 0, 1);
  const s2 = clampN((uv * t2 - wu) / (uu > 1e-9 ? uu : 1), 0, 1);
  const p1 = a.clone().addScaledVector(u, s2);
  const p2 = c.clone().addScaledVector(v, t2);
  return p1.distanceTo(p2);
}
function clampN(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

/** Состояние корабля для анимации экипажа.
 *  stroke — фаза гребка для гребцов (гребные суда): phase (рад),
 *  active (0/1 — гребут сейчас), dir (+1 вперёд / −1 назад) */
export interface CrewShipState {
  crew: number; maxCrew: number; sinking: boolean; sunk: boolean;
  position: THREE.Vector3; quaternion: THREE.Quaternion;
  stroke?: { phase: number; active: number; dir: number };
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
   *  Возвращает число убитых (1 фигура = 1 человек). */
  killNearPath(a: THREE.Vector3, b: THREE.Vector3, mode: KillMode,
    maxCount: number, radius: number,
    shipPos: THREE.Vector3, shipQuat: THREE.Quaternion): number;
  /** Оживить всех (полигон/сброс повреждений) */
  reset(): void;
}

/** Собрать экипаж для корабля (local coords: +Z нос, +X порт).
 *  Число фигур = deckCrewFor(maxCrew): 1 фигура = 1 человек;
 *  500-экипаж → 50 фигур, минимум 10 — от 10 на шлюпе до ~73
 *  на линейном корабле */
export function buildCrew(P: ShipPreset, seed: number): CrewVisual {
  const group = new THREE.Group();
  const L = P.length;
  // палуба под ногами: на квартердеке — приподнята; корма судов
  // без квартердека — обычная палуба
  const qFront = P.quarter ? quarterFrontZ(P) : -Infinity;
  const deckYAt = (z: number) => {
    const t = Math.min(1, Math.max(0, (z + L / 2) / L));
    return hullProfile(t, P).bulwark - 1.0 + (z < qFront ? (P.quarter ?? 0) : 0);
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

  // === СКОЛЬКО ЛЮДЕЙ НА ПАЛУБЕ: 1 фигура = 1 человек;
  // deckCrewFor по формуле пользователя (500→50, 50→10,
  // всегда ≥10, при N≤10 — все) ===
  const nDeck = Math.max(1, Math.min(MAX_DECK_FIGURES, deckCrewFor(P.maxCrew)));

  const mastZ = P.masts === 2 ? [L * 0.16, -L * 0.10] : [L * 0.18, -L * 0.05, -L * 0.28];
  const deckGuns = gunLayout(P).filter(sl => sl.tier === 0).map(sl => sl.z);
  const wheelZ = wheelZFor(P);

  // план ролей по приоритету: капитан → рулевой → боцман →
  // ГРЕБЦЫ (гребные суда, на банках у вёсел) → канониры у орудий
  // (до 2 на ствол) → вахтенные у мачт (2 на мачту) → ходоки
  const plan: CrewRole[] = ['captain'];
  if (nDeck >= 2) plan.push('helmsman');
  if (nDeck >= 4) plan.push('boatswain');
  const nRest = nDeck - plan.length;
  const nRowers = P.oars ? Math.min(Math.max(2, nRest * 0.45), 14) : 0;
  const nGunners = Math.min(Math.floor((nRest - nRowers) * 0.5), deckGuns.length * 2, 16);
  const nWatch = Math.min(Math.max(0, nRest - nRowers - nGunners), P.masts * 2, 6);
  const nWalk = Math.max(0, nRest - nRowers - nGunners - nWatch);
  for (let i = 0; i < nRowers; i++) plan.push('rower');
  for (let i = 0; i < nGunners; i++) plan.push('gunner');
  for (let i = 0; i < nWatch; i++) plan.push('watch');
  for (let i = 0; i < nWalk; i++) plan.push('walker');

  let gi = 0, wi = 0, ki = 0, ri = 0;
  // банки гребцов: позиции вёсел (z от buildOars) — гребцы сидят
  // лицом к корме (как на галерах), по двое на банку с обоих бортов
  const oarN = P.oars ?? 0;
  const oarZ = oarN
    ? Array.from({ length: oarN }, (_, i) =>
        THREE.MathUtils.lerp(-L * 0.26, L * 0.30, oarN === 1 ? 0.5 : i / (oarN - 1)))
    : [];
  for (const role of plan) {
    const f = buildFigure(role, rollTraits(rot, role), nextSeed());
    if (role === 'captain') {
      // капитан — на квартердеке (если есть), у штурвала
      place(f, 0.55, wheelZ - 1.6, 0.3);
    } else if (role === 'helmsman') {
      // рулевой — за штурвалом (руки на ободе), лицом к носу
      place(f, 0, wheelZ - 0.52, 0);
    } else if (role === 'boatswain') {
      // боцман — у шпиля (шпиль перед квартердеком), лицом к носу-борту
      place(f, -0.75, wheelZ + 2.4, 0.5);
    } else if (role === 'rower') {
      // гребец — на банке у своего весла, лицом к корме (сидя)
      const z = oarZ.length ? oarZ[(ri * 2) % oarZ.length] : L * 0.1;
      const side = ri % 2 === 0 ? -1 : 1;
      ri++;
      place(f, side * Math.max(0.55, halfW(z) * 0.5), z + 0.35, Math.PI);
      // «сидит»: приземнее и приземистее стоящего матроса
      f.group.position.y -= 0.30;
      f.group.scale.y = 0.78;
      f.baseScaleY = 0.78;
    } else if (role === 'gunner') {
      // канонир — за ПАЛУБНЫМ орудием (через одно), борт чередуется;
      // при 16 канонирах — лёгкий разброс вдоль ствола (без слипаний)
      const z = deckGuns[Math.floor(gi / 2) % Math.max(1, deckGuns.length)];
      const side = gi % 2 === 0 ? -1 : 1;
      gi++;
      const w = halfW(z);
      const jz = (rot() - 0.5) * 1.3;
      place(f, side * (w * 0.56), z + 0.55 + jz, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else if (role === 'watch') {
      // вахтенный — у мачты, борт чередуется
      const mz = mastZ[wi % mastZ.length];
      const side = wi % 2 === 0 ? -1 : 1;
      wi++;
      place(f, side * Math.max(0.7, halfW(mz) * 0.42), mz + 0.9, side * (Math.PI / 2));
    } else {
      // ходок — гуляет по палубе туда-обратно; полосы движения +
      // живой дрейф поперёк (каждый со своим периодом), паузы у
      // поворотов и разный темп — толпа не марширует строем
      // (по замечанию игрока: экипаж ходит по палубе живее)
      const LANES = [-0.31, -0.13, 0.13, 0.31];
      f.xPath = LANES[ki % 4] * Math.max(0.55, halfW(0)) + (rot() - 0.5) * 0.3;
      f.walkA = Math.max(P.castleH ? -L * 0.22 : -L * 0.3, qFront + 1.2);
      f.walkB = P.castleH ? L * 0.2 : L * 0.28;
      f.walkT = rot();
      f.walkSpeed = 0.5 + rot() * 0.45;                    // разный темп
      f.driftAmp = 0.1 + rot() * 0.22;                     // дрейф полосы
      f.driftPeriod = 7 + rot() * 9;
      f.walkPause = 0;
      ki++;
      figures.push(f);
      group.add(f.group);
    }
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
      // ТОЧНОЕ поражение: путь снаряда (a→b, локальные координаты корабля)
      // против вертикальной капсулы КАЖДОЙ фигуры (ноги → голова).
      // Ядро/пуля картечи убивают только фигуру, которую ПРОШЁЛ снаряд —
      // залп в борт рядом с матросом его не трогает.
      const A = new THREE.Vector3(a.x, a.y, a.z);
      const B = new THREE.Vector3(b.x, b.y, b.z);
      const cands: { f: CrewFigure; d: number }[] = [];
      for (const f of figures) {
        if (f.dead || !f.group.visible) continue;
        const p = f.group.position;
        const lo = new THREE.Vector3(p.x, p.y + 0.12, p.z);
        const hi = new THREE.Vector3(p.x, p.y + 1.62, p.z);
        const d = segSegDist3D(A, B, lo, hi);
        if (d > radius) continue;
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
        f.group.scale.set(1, f.baseScaleY, 1);
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

      // --- потери команды: живых фигур РОВНО столько, сколько
      // людей на палубе — deckCrewFor(crew): 1 фигура = 1 человек.
      // crew = 0 → палуба ПУСТАЕТ (все фигуры погибают).
      // Избыток умирает по одной за кадр — трупы падают естественно
      const target = Math.min(figures.length, deckCrewFor(Math.max(ship.crew, 0)));
      const nAlive = figures.reduce((a, f) => a + (f.dead ? 0 : 1), 0);
      const order: CrewRole[] = ['walker', 'rower', 'watch', 'gunner', 'boatswain', 'helmsman', 'captain'];
      let shownAlive = 0;
      let excess: CrewFigure | null = null; // одна «потеря» за кадр
      if (nAlive > target) {
        outer:
        for (const role of order) {
          for (const f of figures) {
            if (f.role !== role || f.dead) continue;
            if (shownAlive < target) shownAlive++;
            else { excess = f; break outer; }
          }
        }
      } else shownAlive = nAlive;
      if (excess) killFigure(excess, 'grape', excess.group.position,
        excess.group.position.clone().add(new THREE.Vector3(0, 0, 1)),
        ship.position, ship.quaternion);
      vis.dead = figures.reduce((a, f) => a + (f.dead ? 1 : 0), 0);
      vis.shown = shownAlive;

      // --- анимация живых ---
      const stroke = ship.stroke;
      for (const f of figures) {
        if (!f.group.visible || f.dead) continue;
        if (f.role === 'rower' && stroke && stroke.active) {
          // гребец отклоняется в такт: замах на переносе, наклон
          // корпуса на рабочем ходу (лёгкая асимметрия от фазы)
          const lean = Math.sin(stroke.phase) * stroke.dir;
          f.group.rotation.x = -0.26 * lean;
          f.group.rotation.z = Math.sin(stroke.phase * 2) * 0.03;
        } else if (f.role === 'walker' && f.xPath !== undefined && f.walkA !== undefined && f.walkB !== undefined) {
          const span = f.walkB - f.walkA;
          if ((f.walkPause ?? 0) > 0) {
            // пауза у планширя: осматривается, ноги стоят
            f.walkPause = (f.walkPause ?? 0) - dt;
            const swayP = Math.sin(time * 1.1 + f.phase) * 0.05;
            f.group.rotation.z = swayP;
            f.group.rotation.y = (f.walkDir > 0 ? 0 : Math.PI) + Math.sin(time * 0.5 + f.phase) * 0.7;
            if (f.legL && f.legR) {
              f.legL.rotation.x *= 0.8; f.legR.rotation.x *= 0.8;
            }
          } else {
            f.walkT += (f.walkDir * f.walkSpeed * dt) / span;
            if (f.walkT > 1) { f.walkT = 1; f.walkDir = -1; f.walkPause = 0.7 + f.phase * 2.2; }
            if (f.walkT < 0) { f.walkT = 0; f.walkDir = 1; f.walkPause = 0.7 + (1 - f.phase) * 2.2; }
            const z = THREE.MathUtils.lerp(f.walkA, f.walkB, f.walkT);
            // живой дрейф полосы поперёк палубы (у каждого свой)
            const x = f.xPath + Math.sin(time / (f.driftPeriod ?? 10) + f.phase * 6) * (f.driftAmp ?? 0.15);
            f.group.position.set(x, deckYAt(z), z);
            f.group.rotation.y = f.walkDir > 0 ? 0 : Math.PI;
            f.group.rotation.z = 0;
            const step = time * f.walkSpeed * 7;
            if (f.legL && f.legR) {
              f.legL.rotation.x = Math.sin(step) * 0.55;
              f.legR.rotation.x = -Math.sin(step) * 0.55;
            }
            f.group.position.y += Math.abs(Math.sin(step)) * 0.03;
          }
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
