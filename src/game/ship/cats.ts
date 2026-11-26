import * as THREE from 'three';
import { ShipPreset, hullProfile, gunLayout, quarterFrontZ } from './buildShip';
import { CREW_MAT, CrewFigure, CrewRole, mulberry32 } from './crew';

// ============================================================
// КОТЫ НА БОРТУ (по заказу игрока):
//  * корабельные коты — ТОЛЬКО у игрока: покупаются в порту
//    (не более MAX_SHIP_CATS), бродят по палубе, бегают,
//    ловят мышей (мыши заводятся в трюме и пробегают по
//    палубе — кот бросается в погоню);
//  * режим «экипаж из котов» (настройка): все фигуры матросов
//    на палубе игрока заменены котами — капитан-кот расхаживает
//    за штурвалом, боцман-кот вращает шпиль, канониры-коты
//    таскают ядра (та же логика работы, кошачьи тела).
// Коты НЕ живут на кораблях NPC — только на корабле игрока.
// ============================================================

/** максимум корабельных котов (по ТЗ игрока: «не более 5») */
export const MAX_SHIP_CATS = 5;
/** цена кота в порту, зол. */
export const CAT_PRICE = 50;

/** клички корабельных котов (порт даёт первую свободную) */
export const CAT_NAMES = [
  'Барсик', 'Мурзик', 'Васька', 'Рыжик', 'Пират',
  'Боцман', 'Котофей', 'Матроскин', 'Крюк', 'Сивый',
];

/** кошачьи шубки: остевая шерсть + светлое брюхо/морда */
const CAT_COATS: { fur: number; light: number }[] = [
  { fur: 0xa8622d, light: 0xc98a4f },  // рыжий
  { fur: 0x26262e, light: 0x3d3d48 },  // чёрный
  { fur: 0xd9d2c4, light: 0xeae4d8 },  // белый
  { fur: 0x71757c, light: 0x8d9199 },  // серый
  { fur: 0x83643e, light: 0xa3834f },  // бурый
  { fur: 0xbfa98c, light: 0xd6c5a8 },  // кремовый
];
/** глаза: зелёные / янтарные / голубые */
const CAT_EYES = [0x7fbf3f, 0xd9a33c, 0x5aa0c8];
/** Task 84: кот-МЕРТВЕЦ (проклятие «Чёрной жемчужины») — как экипаж
 *  мертвецов: пепельно-зелёная шубка «гнили», тёмные провалы глазниц,
 *  оскал, рёбра сквозь шерсть, порванное ухо, голый хвост-костяшка */
const CAT_COAT_UNDEAD = { fur: 0x3a4038, light: 0x566158 };
const CAT_HAT = 0x2b2018;       // треуголка капитана-кота
const MOUSE_FUR = 0x8a8578;

// размеры кота, м (чуть крупнее натуры — чтобы читался с палубы)
const LEG_H = 0.17;
const BODY_L = 0.42;
const BODY_W = 0.155;
const BACK_Y = LEG_H + 0.08;    // высота спины
const HEAD_Y = 0.345;

type Bake = { pos: number[]; col: number[] };

function bake(target: Bake, geo: THREE.BufferGeometry, color: number,
  x: number, y: number, z: number, euler?: THREE.Euler,
  scale?: [number, number, number]) {
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

function bakeGeom(t: Bake): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  g.computeVertexNormals();
  return g;
}

/** запечь туловище кота (без ног и хвоста): корпус, грудка,
 *  голова, мордочка, уши, глаза; капитан — в треуголке */
function bakeCatBody(t: Bake, fur: number, light: number, rnd: () => number,
  captainHat = false, seated = false, undead = false) {
  const y0 = seated ? -0.05 : 0;
  // Task 84: у мертвеца шубка «гниль» — пепельно-зелёная, брюхо бледное
  const fC = undead ? CAT_COAT_UNDEAD.fur : fur;
  const lC = undead ? CAT_COAT_UNDEAD.light : light;
  // корпус
  bake(t, new THREE.BoxGeometry(BODY_W, 0.15, BODY_L), fC, 0, y0 + BACK_Y - 0.075, 0);
  // грудка (шире и светлее)
  bake(t, new THREE.BoxGeometry(BODY_W + 0.02, 0.16, 0.14), lC, 0, y0 + BACK_Y - 0.08, 0.10);
  // голова
  bake(t, new THREE.BoxGeometry(0.13, 0.115, 0.13), fC, 0, y0 + HEAD_Y, 0.235);
  // мордочка
  bake(t, new THREE.BoxGeometry(0.082, 0.05, 0.06), lC, 0, y0 + HEAD_Y - 0.028, 0.305);
  // носик
  bake(t, new THREE.BoxGeometry(0.024, 0.018, 0.014), undead ? 0x39443c : 0xc87a8a, 0, y0 + HEAD_Y - 0.012, 0.332);
  // уши (конусы); Task 84: у мертвеца одно ухо ПОРВАНО (клин короче)
  for (const s of [-1, 1]) {
    const torn = undead && s < 0;
    bake(t, new THREE.ConeGeometry(torn ? 0.02 : 0.03, torn ? 0.03 : 0.055, 4), fC,
      s * 0.045, y0 + HEAD_Y + 0.075, 0.225, new THREE.Euler(0.15, 0, s * -0.22));
  }
  // глаза; Task 84: у мертвеца — ТЁМНЫЕ ПРОВАЛА глазниц (как у экипажа)
  if (undead) {
    for (const s of [-1, 1]) {
      bake(t, new THREE.BoxGeometry(0.022, 0.019, 0.012), 0x0c0f0a, s * 0.036, y0 + HEAD_Y + 0.012, 0.297);
    }
    // оскал: ряд мелких зубов под носом
    bake(t, new THREE.BoxGeometry(0.05, 0.012, 0.01), 0xd8d4c0, 0, y0 + HEAD_Y - 0.03, 0.318);
  } else {
    const eye = CAT_EYES[Math.floor(rnd() * CAT_EYES.length)];
    for (const s of [-1, 1]) {
      bake(t, new THREE.BoxGeometry(0.017, 0.015, 0.01), eye, s * 0.036, y0 + HEAD_Y + 0.012, 0.297);
    }
  }
  // Task 84: рёбра проступают сквозь шерсть мертвеца (как у матросов)
  if (undead) {
    for (let ri = 0; ri < 3; ri++) {
      bake(t, new THREE.BoxGeometry(BODY_W + 0.012, 0.014, 0.012), 0x9aa596,
        0, y0 + BACK_Y + 0.015 - ri * 0.038, 0.02 + ri * 0.012);
    }
  }
  // треуголка капитана-кота
  if (captainHat) {
    bake(t, new THREE.BoxGeometry(0.15, 0.02, 0.12), CAT_HAT, 0, y0 + HEAD_Y + 0.062, 0.235,
      new THREE.Euler(0, 0.3, 0));
    bake(t, new THREE.BoxGeometry(0.1, 0.06, 0.075), CAT_HAT, 0, y0 + HEAD_Y + 0.09, 0.235,
      new THREE.Euler(0, 0.3, 0));
  }
}

/** нога-пару для фигуры экипажа-кота: передняя + задняя одного
 *  борта в одном меше (пивот в бедре) — анимация шага из crew.ts
 *  качает пары, как иноходь */
function catSideLegGeom(side: number, fur: number, paws: number): THREE.BufferGeometry {
  const t: Bake = { pos: [], col: [] };
  for (const z of [0.115, -0.125]) {
    bake(t, new THREE.BoxGeometry(0.05, LEG_H, 0.055), fur, side * 0.055, LEG_H / 2, z);
    // лапка (у многих котов белые носки)
    bake(t, new THREE.BoxGeometry(0.054, 0.03, 0.06), paws, side * 0.055, 0.015, z + 0.004);
  }
  const g = bakeGeom(t);
  g.translate(0, -LEG_H, 0);   // пивот — бедро
  return g;
}

/** ФИГУРА ЭКИПАЖА-КОТА (CrewFigure-совместима): тот же интерфейс,
 *  что у матросов — роли/маршруты/смерть из crew.ts работают как
 *  есть. hitLo/hitH/midY — кошачьи размеры для попаданий и смыва */
export function buildCatCrewFigure(role: CrewRole, seed: number, movable: boolean,
  undead = false): CrewFigure {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const coat = undead ? CAT_COAT_UNDEAD : CAT_COATS[Math.floor(rnd() * CAT_COATS.length)];
  const paws = undead ? 0x47524a : (rnd() < 0.45 ? 0xe3ddd0 : coat.light);
  const t: Bake = { pos: [], col: [] };
  bakeCatBody(t, coat.fur, coat.light, rnd, role === 'captain', false, undead);
  // хвост — в общий меш (у фигур экипажа хвост не анимируется);
  // Task 84: у мертвеца хвост ГОЛЫЙ-костяшка — тонкий и тёмный
  bake(t, new THREE.CylinderGeometry(undead ? 0.009 : 0.013, undead ? 0.012 : 0.02, 0.33, 5),
    undead ? 0x31382f : coat.fur,
    0, BACK_Y + 0.09, -BODY_L / 2 - 0.04, new THREE.Euler(-1.0, 0, 0));
  const body = new THREE.Mesh(bakeGeom(t), CREW_MAT);
  group.add(body);

  let legL: THREE.Mesh | undefined;
  let legR: THREE.Mesh | undefined;
  if (movable) {
    legL = new THREE.Mesh(catSideLegGeom(-1, coat.fur, paws), CREW_MAT);
    legR = new THREE.Mesh(catSideLegGeom(1, coat.fur, paws), CREW_MAT);
    legL.position.y = LEG_H;
    legR.position.y = LEG_H;
    group.add(legL, legR);
  } else {
    // статичная фигура: все 4 ноги в общий меш
    const lt: Bake = { pos: [], col: [] };
    for (const s of [-1, 1]) {
      for (const z of [0.115, -0.125]) {
        bake(lt, new THREE.BoxGeometry(0.05, LEG_H, 0.055), coat.fur, s * 0.055, LEG_H / 2, z);
        bake(lt, new THREE.BoxGeometry(0.054, 0.03, 0.06), paws, s * 0.055, 0.015, z + 0.004);
      }
    }
    group.add(new THREE.Mesh(bakeGeom(lt), CREW_MAT));
  }

  return {
    group, role, legL, legR, seed,
    walkT: rnd(), walkDir: rnd() < 0.5 ? 1 : -1, baseScaleY: 1,
    walkSpeed: 0.6 + rnd() * 0.5,       // коты гуляют шустрее матросов
    phase: rnd() * 6.28,
    dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
    skin: coat.fur, shirt: coat.light, pants: coat.fur,
    hasHook: false, hasPeg: false,
    hitLo: 0.03, hitH: 0.40, midY: 0.22,   // кошачья капсула попаданий
  };
}

// ============================================================
// КОРАБЕЛЬНЫЕ КОТЫ (питомцы): 5 штук, активны первые count
// ============================================================

interface CatPet {
  group: THREE.Group;
  legs: THREE.Mesh[];        // [FL, FR, BL, BR] — пивот в бедре
  tail: THREE.Mesh;          // пивот у основания
  x: number; z: number; yaw: number;
  st: 'idle' | 'walk' | 'run' | 'chase' | 'eat';
  tx: number; tz: number;    // цель маршрута
  speed: number;
  timer: number;             // до смены состояния, с
  phase: number;             // фаза лап
  tphase: number;            // фаза хвоста
}

interface DeckMouse {
  mesh: THREE.Mesh;
  x: number; z: number; yaw: number;
  tx: number; tz: number;
  st: 'dash' | 'pause';
  timer: number;
  life: number;
}

export interface CatsVisual {
  group: THREE.Group;
  /** сколько котов на палубе (0..MAX_SHIP_CATS) */
  count: number;
  /** поймано мышей за всё время (e2e) */
  caught: number;
  /** мыши на палубе сейчас (e2e) */
  mice: number;
  setCount(n: number): void;
  update(dt: number, time: number, st: { sinking: boolean; sunk: boolean }): void;
  /** выпустить мышь на палубу прямо сейчас (отладка/e2e) */
  spawnMouseNow(): void;
  /** состояние котов (e2e: двигаются/ловят) */
  catState(): { x: number; z: number; st: string }[];
}

const clampN = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;

/** Собрать «кошачью палубу»: 5 котов (показываются первые count),
 *  мыши заводятся сами, коты их ловят. onCatch — кличка по индексу */
export function buildCats(P: ShipPreset, seed: number,
  onCatch?: (catIdx: number) => void, undead = false): CatsVisual {
  const group = new THREE.Group();
  const L = P.length;
  // палуба: главная палуба (квартердек котам не нужен — там штурвал)
  const qFront = P.quarter ? quarterFrontZ(P) : -Infinity;
  const zMin = Math.max(-L * 0.36, qFront > -Infinity ? qFront + 0.85 : -L * 0.36);
  const zMax = L * 0.30;
  const halfW = (z: number) =>
    hullProfile(clampN((z + L / 2) / L, 0, 1), P).w;
  const deckY = (z: number) =>
    hullProfile(clampN((z + L / 2) / L, 0, 1), P).bulwark - 1.0;

  // препятствия (мачты/шпиль/орудия) — коты их обтекают
  const obstacles: { x: number; z: number; r: number }[] = [];
  const mastZ = P.masts === 2 ? [L * 0.16, -L * 0.10] : [L * 0.18, -L * 0.05, -L * 0.28];
  for (const mz of mastZ) obstacles.push({ x: 0, z: mz, r: 0.45 });
  const capstanZ = P.quarter
    ? quarterFrontZ(P) + Math.max(1.2, L * 0.05) : -L * 0.16;
  obstacles.push({ x: 0, z: capstanZ, r: 1.0 });
  for (const sl of gunLayout(P)) {
    if (sl.tier !== 0) continue;
    const w = halfW(sl.z);
    obstacles.push({ x: -w * 0.56, z: sl.z, r: 0.6 });
    obstacles.push({ x: w * 0.56, z: sl.z, r: 0.6 });
  }

  const rnd = mulberry32(seed * 31 + 77);

  // --- модель питомца-кота: 4 отдельные ноги + анимированный хвост ---
  const buildPetCat = (): CatPet => {
    const rg = mulberry32(Math.floor(rnd() * 1e6) + 11);
    const catGroup = new THREE.Group();
    // Task 84: на проклятом корабле корабельные коты — МЕРТВЕЦЫ
    const coat = undead ? CAT_COAT_UNDEAD : CAT_COATS[Math.floor(rg() * CAT_COATS.length)];
    const paws = undead ? 0x47524a : (rg() < 0.45 ? 0xe3ddd0 : coat.light);
    const t: Bake = { pos: [], col: [] };
    bakeCatBody(t, coat.fur, coat.light, rg, false, false, undead);
    catGroup.add(new THREE.Mesh(bakeGeom(t), CREW_MAT));
    // ноги: пивот в бедре (геометрия свисает вниз)
    const legs: THREE.Mesh[] = [];
    for (const [sx, sz] of [[-1, 0.115], [1, 0.115], [-1, -0.125], [1, -0.125]] as const) {
      const lt: Bake = { pos: [], col: [] };
      bake(lt, new THREE.BoxGeometry(0.05, LEG_H, 0.055), coat.fur, 0, LEG_H / 2, 0);
      bake(lt, new THREE.BoxGeometry(0.054, 0.03, 0.06), paws, 0, 0.015, 0.004);
      const g = bakeGeom(lt);
      g.translate(0, -LEG_H, 0);
      const m = new THREE.Mesh(g, CREW_MAT);
      m.position.set(sx * 0.055, LEG_H, sz);
      legs.push(m);
      catGroup.add(m);
    }
    // хвост: пивот у основания, геометрия вверх; у мертвеца — голый
    const tt: Bake = { pos: [], col: [] };
    bake(tt, new THREE.CylinderGeometry(undead ? 0.008 : 0.012, undead ? 0.011 : 0.019, 0.34, 5),
      undead ? 0x31382f : coat.fur, 0, 0.17, 0);
    const tail = new THREE.Mesh(bakeGeom(tt), CREW_MAT);
    tail.position.set(0, BACK_Y - 0.02, -BODY_L / 2 + 0.04);
    tail.rotation.x = -0.95;   // вверх и назад
    catGroup.add(tail);
    catGroup.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    catGroup.visible = false;
    group.add(catGroup);
    const z0 = THREE.MathUtils.lerp(zMin, zMax, rnd());
    return {
      group: catGroup, legs, tail,
      x: (rnd() * 2 - 1) * halfW(z0) * 0.6, z: z0, yaw: rnd() * Math.PI * 2,
      st: 'idle', tx: 0, tz: 0, speed: 0,
      timer: 0.5 + rnd() * 2.5, phase: rnd() * 6.28, tphase: rnd() * 6.28,
    };
  };
  const cats: CatPet[] = Array.from({ length: MAX_SHIP_CATS }, buildPetCat);

  // --- мышь ---
  const mice: DeckMouse[] = [];
  const spawnMouse = () => {
    const t: Bake = { pos: [], col: [] };
    bake(t, new THREE.BoxGeometry(0.06, 0.042, 0.12), MOUSE_FUR, 0, 0.021, 0);
    bake(t, new THREE.BoxGeometry(0.042, 0.032, 0.045), MOUSE_FUR, 0, 0.026, 0.075);
    for (const s of [-1, 1]) bake(t, new THREE.BoxGeometry(0.022, 0.02, 0.008), 0xb8a898, s * 0.018, 0.048, 0.07);
    bake(t, new THREE.BoxGeometry(0.012, 0.012, 0.006), 0x3a3a3a, 0, 0.026, 0.096);
    bake(t, new THREE.BoxGeometry(0.01, 0.008, 0.13), 0xa89f92, 0, 0.024, -0.115);
    const mesh = new THREE.Mesh(bakeGeom(t), CREW_MAT);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const z = THREE.MathUtils.lerp(zMin, zMax, Math.random());
    const side = Math.random() < 0.5 ? -1 : 1;
    const m: DeckMouse = {
      mesh, x: side * halfW(z) * 0.62, z, yaw: 0,
      tx: 0, tz: 0, st: 'pause', timer: 0.3 + Math.random() * 0.6,
      life: 24 + Math.random() * 14,
    };
    mice.push(m);
    group.add(mesh);
  };
  let spawnT = 12 + Math.random() * 10;   // первая мышь — скоро

  // --- цель на палубе (не внутри препятствия) ---
  const pickTarget = (far: boolean): { x: number; z: number } => {
    for (let i = 0; i < 14; i++) {
      const z = THREE.MathUtils.lerp(zMin, zMax, Math.random());
      const w = halfW(z) * 0.72;
      const x = (Math.random() * 2 - 1) * w;
      if (far && Math.abs(z - zMin) + Math.abs(zMax - z) < (zMax - zMin) * 0.5) continue;
      if (obstacles.every(o => Math.hypot(x - o.x, z - o.z) > o.r + 0.25)) return { x, z };
    }
    return { x: 0, z: (zMin + zMax) / 2 };
  };

  const dist2 = (ax: number, az: number, bx: number, bz: number) =>
    (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

  /** шаг к цели с поворотом корпуса, обход препятствий, границы палубы */
  const moveAcrossDeck = (e: { x: number; z: number; yaw: number; tx: number; tz: number; speed: number },
    dt: number, turnRate = 7) => {
    const dx = e.tx - e.x, dz = e.tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      const want = Math.atan2(dx, dz);
      let dy = want - e.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const t = turnRate * dt;
      e.yaw += Math.max(-t, Math.min(t, dy));
      const step = Math.min(d, e.speed * dt);
      e.x += Math.sin(e.yaw) * step;
      e.z += Math.cos(e.yaw) * step;
    }
    for (const o of obstacles) {
      const ox = e.x - o.x, oz = e.z - o.z;
      const od = Math.hypot(ox, oz), min = o.r + 0.1;
      if (od < min && od > 1e-4) { e.x = o.x + ox / od * min; e.z = o.z + oz / od * min; }
    }
    e.z = clampN(e.z, zMin, zMax);
    const w = halfW(e.z) * 0.86;
    e.x = clampN(e.x, -w, w);
    return d;
  };

  const vis: CatsVisual = {
    group, count: 0, caught: 0, mice: 0,
    setCount(n) {
      vis.count = clampN(Math.round(n), 0, MAX_SHIP_CATS);
      for (let i = 0; i < cats.length; i++) {
        cats[i].group.visible = i < vis.count;
        if (i === vis.count - 1) {  // новоприбывший кот осваивается
          cats[i].st = 'idle';
          cats[i].timer = 0.6 + Math.random() * 1.6;
        }
      }
    },
    spawnMouseNow() { if (mice.length < 3) spawnMouse(); },
    catState() {
      return cats.slice(0, vis.count)
        .map(c => ({ x: +c.x.toFixed(2), z: +c.z.toFixed(2), st: c.st }));
    },
    update(dt, time, st) {
      if (st.sunk) { group.visible = false; return; }
      group.visible = !st.sinking;
      if (st.sinking) return;
      vis.mice = mice.length;

      // мыши заводятся в трюме, только когда на борту есть коты
      if (vis.count > 0) {
        spawnT -= dt;
        if (spawnT <= 0 && mice.length < 2) {
          spawnMouse();
          spawnT = 22 + Math.random() * 26;
        }
      }

      // --- коты ---
      for (let ci = 0; ci < vis.count; ci++) {
        const c = cats[ci];
        const moving = c.st === 'walk' || c.st === 'run' || c.st === 'chase';

        // учуял мышь — бросается в погоню
        if (!moving && c.st !== 'eat' && mice.length) {
          let best: DeckMouse | null = null, bd = 8.5 * 8.5;
          for (const m of mice) {
            const d = dist2(c.x, c.z, m.x, m.z);
            if (d < bd) { bd = d; best = m; }
          }
          if (best) {
            c.st = 'chase';
            c.tx = best.x; c.tz = best.z;
            c.speed = 3.4 + Math.random() * 0.4;
          }
        }

        if (c.st === 'idle' || c.st === 'eat') {
          c.timer -= dt;
          if (c.st === 'eat' && c.timer <= 0) {
            c.st = 'idle';
            c.timer = 1 + Math.random() * 2;
          } else if (c.st === 'idle' && c.timer <= 0) {
            const r = Math.random();
            if (r < 0.55) {          // прогуляться
              c.st = 'walk';
              c.speed = 0.75 + Math.random() * 0.45;
              const tgt = pickTarget(false);
              c.tx = tgt.x; c.tz = tgt.z;
            } else if (r < 0.85) {   // пробежка (азарт!)
              c.st = 'run';
              c.speed = 2.6 + Math.random() * 0.9;
              const tgt = pickTarget(true);
              c.tx = tgt.x; c.tz = tgt.z;
            } else {
              c.timer = 1.5 + Math.random() * 3.5;
            }
          }
        } else {
          if (c.st === 'chase') {
            // догоняет живую мышь; мышь исчезла — ищет новую
            let tgt: DeckMouse | null = null, bd = 1e9;
            for (const m of mice) {
              const d = dist2(c.x, c.z, m.x, m.z);
              if (d < bd) { bd = d; tgt = m; }
            }
            if (!tgt) {
              c.st = 'idle'; c.timer = 0.8 + Math.random() * 1.5;
            } else {
              c.tx = tgt.x; c.tz = tgt.z;
              if (bd < 0.3 * 0.3) {
                // ПОЙМАЛ: мышь исчезает, кот занимается ею
                mice.splice(mice.indexOf(tgt), 1);
                group.remove(tgt.mesh);
                tgt.mesh.geometry.dispose();
                vis.mice = mice.length;
                vis.caught++;
                onCatch?.(ci);
                c.st = 'eat';
                c.timer = 2.6 + Math.random() * 1.6;
              }
            }
          }
          const d = moveAcrossDeck(c, dt);
          if (c.st !== 'chase' && d < 0.3) {
            c.st = 'idle';
            c.timer = 0.8 + Math.random() * 2.4;
          }
        }

        // --- анимация ---
        c.group.position.set(c.x, deckY(c.z), c.z);
        if (moving) {
          c.group.rotation.y = c.yaw;
          c.phase += dt * c.speed * 8.5;
          const fast = c.st === 'run' || c.st === 'chase';
          const amp = fast ? 0.85 : 0.5;
          const s = Math.sin(c.phase) * amp;
          c.legs[0].rotation.x = s;    // передняя левая
          c.legs[3].rotation.x = s;    // задняя правая (рысь — диагональ)
          c.legs[1].rotation.x = -s;
          c.legs[2].rotation.x = -s;
          c.group.position.y += Math.abs(Math.sin(c.phase)) * (fast ? 0.02 : 0.008);
          c.tail.rotation.z = Math.sin(time * 7 + c.tphase) * 0.2;
          c.group.rotation.x = 0;
        } else {
          // сидит: лапы поджаты, хвост медленно гуляет, оглядывается
          for (const leg of c.legs) leg.rotation.x *= Math.max(0, 1 - dt * 6);
          c.tail.rotation.z = Math.sin(time * 1.4 + c.tphase) * 0.32;
          c.group.rotation.y = c.yaw + Math.sin(time * 0.6 + c.tphase) * 0.2;
          // ест: нос к палубе
          const want = c.st === 'eat' ? 0.42 : 0;
          c.group.rotation.x += (want - c.group.rotation.x) * Math.min(1, dt * 5);
        }
      }

      // --- мыши ---
      for (let i = mice.length - 1; i >= 0; i--) {
        const m = mice[i];
        m.life -= dt;
        if (m.life <= 0) {   // спряталась в трюме
          group.remove(m.mesh);
          m.mesh.geometry.dispose();
          mice.splice(i, 1);
          continue;
        }
        // кот близко — удирать от него
        let danger: CatPet | null = null;
        for (let ci = 0; ci < vis.count; ci++) {
          const c = cats[ci];
          if (dist2(c.x, c.z, m.x, m.z) < 2.3 * 2.3) { danger = c; break; }
        }
        if (danger) {
          const dx = m.x - danger.x, dz = m.z - danger.z;
          const d = Math.max(0.01, Math.hypot(dx, dz));
          m.tx = m.x + dx / d * 1.6;
          m.tz = m.z + dz / d * 1.6;
          m.st = 'dash';
          m.timer = Math.max(m.timer, 0.35);
        }
        if (m.st === 'pause') {
          m.timer -= dt;
          if (m.timer <= 0) {
            m.st = 'dash';
            const nz = clampN(m.z + (Math.random() * 2 - 1) * 1.6, zMin, zMax);
            const w = halfW(nz) * 0.7;
            m.tx = clampN(m.x + (Math.random() * 2 - 1) * 1.4, -w, w);
            m.tz = nz;
            m.timer = 0.45 + Math.random() * 0.8;
          }
        } else {
          const mouseMover = { x: m.x, z: m.z, yaw: m.yaw, tx: m.tx, tz: m.tz, speed: 2.15 };
          const d = moveAcrossDeck(mouseMover, dt, 12);
          m.x = mouseMover.x; m.z = mouseMover.z; m.yaw = mouseMover.yaw;
          m.timer -= dt;
          if (d < 0.08 || m.timer <= 0) {
            m.st = 'pause';
            m.timer = 0.15 + Math.random() * 0.55;
          }
        }
        m.mesh.position.set(m.x, deckY(m.z) + 0.015 + Math.abs(Math.sin(time * 16)) * 0.006, m.z);
        m.mesh.rotation.y = m.yaw + Math.sin(time * 21) * 0.15;
      }
    },
  };
  return vis;
}
