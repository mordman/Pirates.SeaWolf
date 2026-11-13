import * as THREE from 'three';
import { ShipPreset, hullProfile, gunLayout, wheelZFor, quarterFrontZ } from './buildShip';
import type { GibPool } from '../fx/gibs';
import type { Particles } from '../fx/particles';
import { buildCatCrewFigure } from './cats';
import { waterHeightAt } from '../water/waves';
import { APPEARANCE_SKIN, APPEARANCE_SHIRT, APPEARANCE_PANTS, APPEARANCE_BANDANA,
  type HeadwearKind, type TorsoKind, type PantsKind } from '../core/settings';

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
let FX: { gibs: GibPool | null; particles: Particles | null; worldRoot: THREE.Group | null }
  = { gibs: null, particles: null, worldRoot: null };
/** Вызывается один раз из game.ts после создания GibPool */
export function setCrewFx(gibs: GibPool, particles: Particles) {
  FX = { gibs, particles, worldRoot: FX.worldRoot };
}
// ============================================================
// Task 46: ПРАВИЛА ЭКИПАЖА (настройки «Игра»):
//  replacement — поднимать замену погибшим из трюма;
//  marksmen — стрелковый огонь экипажа (ружья/пистолеты)
// ============================================================
export const CREW_RULES = { replacement: true, marksmen: true };
export function setCrewRules(r: { replacement?: boolean; marksmen?: boolean }) {
  if (typeof r.replacement === 'boolean') CREW_RULES.replacement = r.replacement;
  if (typeof r.marksmen === 'boolean') CREW_RULES.marksmen = r.marksmen;
}
/** Task 43: мир для пловцов (вызывается из game.ts) */
export function setCrewWorldRoot(root: THREE.Group) { FX.worldRoot = root; }
/** Текущие эффекты (гибы/частицы) — для islandFolk.ts */
export function crewFx() { return FX; }

export type CrewRole = 'captain' | 'boatswain' | 'gunner' | 'watch' | 'walker' | 'helmsman' | 'rower';
export type DeathMode = 'fall' | 'gib';
/** способ поражения: картечь валит, ядро разрывает */
export type KillMode = 'grape' | 'ball';

export interface CrewFigure {
  group: THREE.Group;
  role: CrewRole;
  legL?: THREE.Mesh;          // у ходоков и «работяг» (анимация шага)
  legR?: THREE.Mesh;
  /** Task 40: руки отдельными мешами (пивот — плечо) — махи при
   *  ходьбе, поднятая рука капитана «раздавать указания» */
  armL?: THREE.Mesh;
  armR?: THREE.Mesh;
  /** Task 42: МАУНТ У КИСТИ (рука БЕЗ крюка — правая или левая):
   *  сюда lander вешает саблю/пистолет — оружие следует за рукой
   *  во ВСЕХ анимациях (нет «третьей руки») */
  wristMount?: THREE.Object3D | null;
  /** Task 40: >0 — фигура МАШЕТ рукой (сек до конца анимации) */
  waveT?: number;
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
  /** «Полезная работа» (по замечанию игрока: экипаж не стоит на
   *  месте — все ходят и чем-то заняты): капитан расхаживает у
   *  штурвала, боцман наваливается на шпиль, канониры таскают
   *  ядра от кучи к орудию, вахтенные ходят вдоль планширя и
   *  вглядываются в море. Рулевой остаётся у штурвала (это его
   *  работа), гребцы гребут, ходоки гуляют. */
  work?: WorkPath;
  baseScaleY: number;         // исходный рост (гребцы «сидят» — 0.78)
  // --- Task 43: СТРЕЛКИ (ружья 70% / пистолеты 30%) ---
  /** оружие фигуры: 'musket' (дальность 85 м) | 'pistol' (32 м) | null */
  weapon?: 'musket' | 'pistol' | null;
  /** меш оружия (ребёнок руки; создаётся лениво при первом бое) */
  weaponMesh?: THREE.Object3D | null;
  /** кулдаун перезарядки, сек (>0 — заряжается) */
  gunCd?: number;
  /** фаза прижатия к борту на колено (0..1, нарастает/спадает) */
  crouchT?: number;
  /** Task 43: рука-стрелок (к ней прикреплено оружие) */
  gunArm?: THREE.Mesh | null;
  // --- Task 45: БОЕВЫЕ ПОСТА ВДОЛЬ БОРТА + ПОДМЕНА ПОГИБШИХ ---
  /** пост стрелка: z вдоль борта (назначается при атаке) */
  stZ?: number;
  /** борт поста: +1 порт / −1 штирборт (сторона УГРОЗЫ) */
  stSide?: number;
  /** >0 — держит пост после боя / замена идёт на пост, сек */
  postT?: number;
  /** заявка на подмену уже стоит в очереди */
  replQueued?: boolean;
  /** Task 45: фигура поднята из трюма (замена погибшего) */
  fromSpare?: boolean;
  /** Task 43: эвакуация — фигура плывёт (нестандартное поведение).
   *  Task 48: фаза 'float' — СБИТЫЙ ЗА БОРТ труп: приводнится лицом
   *  вниз, дрейфует с волнами, потом медленно уходит под воду */
  swim?: { phase: 'run' | 'jump' | 'swim' | 'drown' | 'float'; t: number;
    vx: number; vz: number; drownAt: number; jumpY: number; };
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
  hasParrot?: boolean;      // Task 39: попугай на плече (гибы/проба E2E)
  verts?: number;           // Task 39: вершин тела (детализация — E2E)
  // КОШАЧЬИ размеры (режим «экипаж из котов»): капсула попаданий
  // ниже человеческой, центр тела у палубы; дефолты — матрос 1.62 м
  hitLo?: number;   // низ капсулы над палубой (человек 0.12, кот 0.03)
  hitH?: number;    // верх капсулы (человек 1.62, кот 0.40)
  midY?: number;    // центр тела для гибов/смыва (человек 0.75, кот 0.22)
}

/** Маршрут полезной работы фигуры (локальные координаты корабля):
 *  pace    — расхаживание между двумя точками (a→b) с паузами;
 *  circle  — хождение по кругу (шпиль);
 *  shuttle — челнок: а→b, на концах НАКЛОН (взять/положить). */
export interface WorkPath {
  kind: 'pace' | 'circle' | 'shuttle';
  a?: THREE.Vector3;            // конец маршрута A (pace/shuttle)
  b?: THREE.Vector3;            // конец маршрута B
  faceA?: number;               // куда смотрит на паузе в A (рад, yaw)
  faceB?: number;               // куда смотрит на паузе в B
  leanA?: number;               // глубина наклона на паузе в A (рад)
  leanB?: number;               // наклон в B (взять ядро / зарядить)
  hullFollow?: number;          // pace: x = k·halfW(z) — вдоль борта по кривизне
  cx?: number; cz?: number; r?: number;  // circle: центр/радиус
  ang?: number; angSpd?: number;         // circle: угол/скорость
  pauseDur: number;             // длительность паузы на конце, с
  pause: number;                // остаток паузы, с
  pauseAt: 'a' | 'b';           // где сейчас пауза
  t: number;                    // 0..1 по маршруту
  dir: number;                  // ±1 направление
  speed: number;                // м/с
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

// палитры (наугад комбинируются) — ЦВЕТА живут в настройках
// (settings.ts): те же палитры предлагает экран создания капитана
const SKIN = APPEARANCE_SKIN;
const SHIRT = APPEARANCE_SHIRT;
const PANTS = APPEARANCE_PANTS;
const BANDANA = APPEARANCE_BANDANA;
const HAT = 0x2b2018;
const COAT = [0x2e2a3a, 0x3a2620, 0x1f3038, 0x40222a];
const BEARD = [0x2c2118, 0x4a3524, 0x6b5136, 0x8a8a86, 0x1d1712];
const WOOD = 0x8a6a42;
const METAL = 0x3a3f46;
// Task 42: ГАРДЕРОБ — палитры новых видов одежды
const VEST = [0x3a2c22, 0x26303a, 0x402a34, 0x2c3a2e];      // жилеты (поверх рубахи)
const STRAW = 0xd9c06a;                                     // соломенная шляпа
const CAPS = [0x8a2f2a, 0x2e4a6b, 0x3a5c38, 0x6b5a2e, 0x4a3a5c]; // вязаные шапки
const BUTTON = 0xd8c27a;                                    // пуговицы жилета/камзола
export type { HeadwearKind, TorsoKind, PantsKind };

export interface Traits {
  skin: number; shirt: number; pants: number;
  beard: 0 | 1 | 2;        // нет / короткая / длинная
  hook: -1 | 0 | 1;        // нет / правая / левая рука
  pegLeg: -1 | 0 | 1;      // нет / правая / левая нога
  eyePatch: boolean;
  headwear: HeadwearKind;   // 7 видов (Task 42)
  torso: TorsoKind;         // 8 видов одежды торса (Task 42; было striped)
  pantsKind: PantsKind;     // длинные / шорты / рваные шорты (Task 42)
  height: number;          // 0.92..1.08
  parrot: boolean;         // Task 39: попугай на плече (~10% фигур)
}

/** Вероятность попугая на плече у процедурной фигуры (ТЗ: 10%) */
export const PARROT_CHANCE = 0.10;

/** ТЕЛО ТОРСА (Task 42): вероятности видов для процедурной
 *  фигуры — рубаха / тельняшка / вертикальные полосы / футболка /
 *  свитер / жилет / камзол / ГОЛЫЙ ТОРС. Взвешенный выбор. */
function rollTorso(rnd: () => number, role: CrewRole): TorsoKind {
  if (role === 'captain') return rnd() < 0.7 ? 'coat' : 'vest';
  const w: [TorsoKind, number][] = [
    ['shirt', 28], ['striped', 17], ['stripedV', 6], ['tshirt', 14],
    ['sweater', 8], ['vest', 10], ['coat', 5], ['bare', 12],
  ];
  let sum = 0; for (const [, p] of w) sum += p;
  let r = rnd() * sum;
  for (const [k, p] of w) { r -= p; if (r <= 0) return k; }
  return 'shirt';
}

export function rollTraits(rnd: () => number, role: CrewRole): Traits {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  // головной убор: 7 видов (капитану — офицерские)
  let headwear: HeadwearKind;
  if (role === 'captain') headwear = rnd() < 0.7 ? 'hat' : 'top';
  else {
    const r = rnd();
    headwear = r < 0.18 ? 'none'
      : r < 0.48 ? 'bandana'
      : r < 0.62 ? 'hat'
      : r < 0.72 ? 'wide'
      : r < 0.82 ? 'straw'
      : r < 0.92 ? 'cap'
      : 'top';
  }
  return {
    skin: pick(SKIN),
    shirt: pick(SHIRT),
    pants: pick(PANTS),
    beard: rnd() < 0.55 ? (rnd() < 0.4 ? 2 : 1) : 0,
    hook: rnd() < 0.22 ? (rnd() < 0.5 ? 1 : -1) : 0,
    pegLeg: rnd() < 0.18 ? (rnd() < 0.5 ? 1 : -1) : 0,
    eyePatch: rnd() < 0.25,
    headwear,
    torso: rollTorso(rnd, role),
    pantsKind: rnd() < 0.58 ? 'long' : rnd() < 0.65 ? 'shorts' : 'torn',
    height: 0.92 + rnd() * 0.16,
    parrot: rnd() < PARROT_CHANCE,
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

/** Ориентированный «сегмент конечности»: бокс между точками a→b
 *  (рука/нога считаются цепочкой суставов — плечо→локоть→кисть,
 *  бедро→колено→лодыжка; выравнивание по направлению сегмента) */
function segBox(t: { pos: number[]; col: number[] }, w: number, a: THREE.Vector3, b: THREE.Vector3,
  color: number, d?: number) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-5) return;
  const q = new THREE.Quaternion().setFromUnitVectors(UP_UNIT, dir.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  bake(t, new THREE.BoxGeometry(w, len, d ?? w), color, c.x, c.y, c.z, e);
}
const UP_UNIT = new THREE.Vector3(0, 1, 0);

export const CREW_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.03 });

/** Собрать фигурку (экспорт для островных пиратов islandFolk.ts).
 *  feetY задаётся позиционированием группы: фигура ~1.6 м.
 *  Оси: +Z — лицо (по умолчанию к носу корабля), +X — порт.
 *  movable — отдельные ноги (анимация шага): ходоки и «работяги»
 *  (капитан/боцман/канониры/вахтенные ходят по палубе); статичные
 *  роли (рулевой, гребцы) — ноги в общем мешу.
 *  Task 39: КОНЕЧНОСТИ С СУСТАВАМИ — руки плечо→ЛОКОТЬ→кисть,
 *  ноги бедро→КОЛЕНО→лодыжка (сегменты выровнены по направлению),
 *  плюс детали: кисти, ботинки, ремень с пряжкой, шея, а у ~10%
 *  фигур — ПОПУГАЙ на плече (тело/голова/клюв/крыло/хвост). */
export function buildFigure(role: CrewRole, traits: Traits, seed: number,
  movable = role === 'walker'): CrewFigure {
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

  // --- ТОРС (Task 42: ГАРДЕРОБ — 8 видов) ---
  const bare = traits.torso === 'bare';
  const torsoCol = bare ? traits.skin : traits.shirt;
  if (traits.torso === 'striped') {
    // тельняшка — горизонтальные полосы
    const stripeC = [0xe8e2d4, traits.shirt];
    const n = 5;
    for (let i = 0; i < n; i++) {
      bake(t, new THREE.BoxGeometry(torsoW, torsoH / n + 0.005, 0.22),
        stripeC[i % 2], 0, hipY + torsoH * (i + 0.5) / n, 0);
    }
  } else if (traits.torso === 'stripedV') {
    // вертикальные полосы (узор «матросский»)
    const stripeC = [0xe8e2d4, traits.shirt];
    const n = 4;
    for (let i = 0; i < n; i++) {
      bake(t, new THREE.BoxGeometry(torsoW / n + 0.004, torsoH, 0.22),
        stripeC[i % 2], -torsoW / 2 + torsoW * (i + 0.5) / n, torsoY, 0);
    }
  } else {
    bake(t, new THREE.BoxGeometry(torsoW, torsoH, 0.22), torsoCol, 0, torsoY, 0);
  }
  // СВИТЕР: плотнее + ворот-стойка
  if (traits.torso === 'sweater') {
    bake(t, new THREE.BoxGeometry(torsoW + 0.02, torsoH + 0.005, 0.245), traits.shirt, 0, torsoY, 0);
    bake(t, new THREE.CylinderGeometry(0.1, 0.118, 0.07, 8), traits.shirt, 0, hipY + torsoH - 0.015, 0);
    // узор «ромб» на груди
    bake(t, new THREE.BoxGeometry(0.07, 0.07, 0.012), 0xd8c27a, 0, torsoY + 0.04, 0.115,
      new THREE.Euler(0, 0, Math.PI / 4));
  }
  // ЖИЛЕТ поверх рубахи: две пола спереди + спинка + пуговицы
  if (traits.torso === 'vest') {
    const vc = VEST[Math.floor(rnd() * VEST.length)];
    bake(t, new THREE.BoxGeometry(torsoW * 0.42, torsoH * 0.94, 0.03), vc, -torsoW * 0.22, torsoY - 0.01, 0.115);
    bake(t, new THREE.BoxGeometry(torsoW * 0.42, torsoH * 0.94, 0.03), vc, torsoW * 0.22, torsoY - 0.01, 0.115);
    bake(t, new THREE.BoxGeometry(torsoW + 0.02, torsoH * 0.94, 0.235), vc, 0, torsoY - 0.01, -0.004);
    for (let i = 0; i < 3; i++) {
      bake(t, new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6), BUTTON, 0, torsoY + 0.1 - i * 0.11, 0.132,
        new THREE.Euler(Math.PI / 2, 0, 0));
    }
  }
  // КАМЗОЛ: длинный, до бёдер, с золотыми пуговицами
  if (traits.torso === 'coat') {
    bake(t, new THREE.BoxGeometry(torsoW + 0.05, 0.4, 0.25), COAT[Math.floor(rnd() * COAT.length)], 0, hipY + 0.05, 0);
    for (let i = 0; i < 3; i++) {
      bake(t, new THREE.CylinderGeometry(0.012, 0.012, 0.012, 6), BUTTON, 0, torsoY + 0.08 - i * 0.12, 0.13,
        new THREE.Euler(Math.PI / 2, 0, 0));
    }
  }
  // ГОЛЫЙ ТОРС: у половины — перевязь через плечо (кожух сабли)
  if (bare && rnd() < 0.5) {
    bake(t, new THREE.BoxGeometry(0.055, torsoH * 1.12, 0.018), 0x3a2c1e, -torsoW * 0.28, torsoY, 0.115,
      new THREE.Euler(0, 0, 0.45));
    bake(t, new THREE.BoxGeometry(0.055, torsoH * 1.12, 0.018), 0x3a2c1e, torsoW * 0.28, torsoY, -0.115,
      new THREE.Euler(0, 0, 0.45));
  }
  // капитан: длинный кафтан + золотой кант
  if (role === 'captain') {
    bake(t, new THREE.BoxGeometry(torsoW + 0.06, 0.42, 0.26), rnd() < 0.5 ? COAT[0] : COAT[1], 0, hipY + 0.05, 0);
    bake(t, new THREE.BoxGeometry(0.05, torsoH * 0.9, 0.015), 0xb8912f, 0, torsoY, 0.135);
  }
  // РЕМЕНЬ с пряжкой (Task 39: детализация) — на бёдрах, у всех
  bake(t, new THREE.BoxGeometry(torsoW + 0.035, 0.06, 0.245), 0x241a12, 0, hipY + 0.02, 0);
  bake(t, new THREE.BoxGeometry(0.055, 0.045, 0.018), 0xb8912f, 0, hipY + 0.02, 0.125);
  // ШЕЯ (голова больше не «висит» над рубахой)
  bake(t, new THREE.CylinderGeometry(0.05, 0.06, 0.06, 6), traits.skin, 0, headY - headR - 0.015, 0);

  // --- руки: ПЛЕЧО → ЛОКОТЬ → КИСТЬ (Task 39; Task 40: у ПОДВИЖНЫХ
  //     фигур руки — ОТДЕЛЬНЫЕ меши с пивотом в плече — махи при
  //     ходьбе и поднятая рука капитана; статичные роли (рулевой
  //     с руками на штурвале, сидячие гребцы) — запечены в тело) ---
  const armLen = 0.5;
  const upA = armLen * 0.52;   // плечо→локоть
  const foA = armLen * 0.5;    // локоть→запястье
  const shoulderY = hipY + torsoH - 0.05;
  let armL: THREE.Mesh | undefined;
  let armR: THREE.Mesh | undefined;
  // Task 42: маунт у кисти (заполняется в mkArmMesh — рука без крюка)
  let wristMount: THREE.Object3D | null = null;
  // запечь руку в ОБЩИЙ меш тела (абсолютные координаты) — рулевой/
  // гребцы/статика; в точности прежняя геометрия
  // Task 42: рукава по одежде торса — ГОЛЫЙ ТОРС: рука вся в коже,
  // ФУТБОЛКА: плечо в рубахе, предплечье голое, прочие — длинный рукав
  const bakeArmInto = (target: { pos: number[]; col: number[] }, side: -1 | 1) => {
    const isHook = traits.hook === side;
    const sx = side * (torsoW / 2 + 0.05);
    const sleeve = role === 'captain' ? COAT[0] : traits.shirt;
    const upperSleeve = traits.torso === 'bare' ? traits.skin : sleeve;
    const foreSleeve = traits.torso === 'bare' || traits.torso === 'tshirt' ? traits.skin : sleeve;
    if (role === 'helmsman') {
      // рулевой: руки вытянуты ВПЕРЁД к штуруалу (+Z — нос),
      // два сегмента с локтем + кисти на ободе
      const S = new THREE.Vector3(sx * 0.8, shoulderY - 0.03, 0.08);
      const E = new THREE.Vector3(sx * 0.92, shoulderY - 0.13, 0.24);
      const W = new THREE.Vector3(sx * 1.0, shoulderY - 0.07, 0.44);
      segBox(target, 0.1, S, E, upperSleeve, 0.115);
      if (isHook) {
        segBox(target, 0.08, E, E.clone().lerp(W, 0.4), WOOD, 0.09);
      } else {
        segBox(target, 0.088, E, W, foreSleeve, 0.098);
        const dH = W.clone().sub(E).normalize();
        const H = W.clone().addScaledVector(dH, 0.05);
        segBox(target, 0.082, W, H, traits.skin, 0.09);
      }
      return;
    }
    // висящая рука с СОГНУТЫМ ЛОКТЕМ: локоть в сторону, кисть вперёд
    const S = new THREE.Vector3(sx, shoulderY, 0.01);
    const E = new THREE.Vector3(sx * 1.16, shoulderY - upA, 0.05);
    const W = new THREE.Vector3(sx * 1.26, shoulderY - upA - foA * 0.68, 0.05 + foA * 0.64);
    segBox(target, 0.1, S, E, upperSleeve, 0.115);                     // плечо
    bake(target, new THREE.BoxGeometry(0.105, 0.065, 0.112), upperSleeve, E.x, E.y, E.z); // локоть
    if (isHook) {
      // деревянная культа + крюк (предплечье короткое)
      const d = W.clone().sub(E).normalize();
      const st = E.clone().addScaledVector(d, foA * 0.45);
      segBox(target, 0.08, E, st, WOOD, 0.09);
      bake(target, new THREE.TorusGeometry(0.06, 0.018, 5, 10, Math.PI * 1.2), METAL,
        E.x + d.x * foA * 0.62, E.y + d.y * foA * 0.62, E.z + d.z * foA * 0.62,
        new THREE.Euler(0, 0, side * 1.57));;
    } else {
      segBox(target, 0.088, E, W, foreSleeve, 0.098);                 // предплечье
      const dH = W.clone().sub(E).normalize();
      const H = W.clone().addScaledVector(dH, 0.055);
      segBox(target, 0.082, W, H, traits.skin, 0.09);             // КИСТЬ
    }
  };
  // отдельный меш руки: геометрия относительно ПЛЕЧА (пивот),
  // при rotation.x=0 висит вдоль тела — как запечённая
  // Task 42: рукава по одежде (голый торс/футболка) + МАУНТ У КИСТИ
  // для оружия (рука без крюка) — оружие следует за рукой
  const mkArmMesh = (side: -1 | 1): THREE.Mesh => {
    const at: { pos: number[]; col: number[] } = { pos: [], col: [] };
    const isHook = traits.hook === side;
    const sx = side * (torsoW / 2 + 0.05);
    const sleeve = role === 'captain' ? COAT[0] : traits.shirt;
    const upperSleeve = traits.torso === 'bare' ? traits.skin : sleeve;
    const foreSleeve = traits.torso === 'bare' || traits.torso === 'tshirt' ? traits.skin : sleeve;
    const E = new THREE.Vector3(sx * 0.16, -upA, 0.04);
    const W = new THREE.Vector3(sx * 0.26, -upA - foA * 0.68, 0.04 + foA * 0.64);
    segBox(at, 0.1, new THREE.Vector3(0, 0, 0), E, upperSleeve, 0.115);  // плечо
    bake(at, new THREE.BoxGeometry(0.105, 0.065, 0.112), upperSleeve, E.x, E.y, E.z); // локоть
    let mount: THREE.Object3D | null = null;
    if (isHook) {
      const d = W.clone().sub(E).normalize();
      const st = E.clone().addScaledVector(d, foA * 0.45);
      segBox(at, 0.08, E, st, WOOD, 0.09);
      bake(at, new THREE.TorusGeometry(0.06, 0.018, 5, 10, Math.PI * 1.2), METAL,
        E.x + d.x * foA * 0.62, E.y + d.y * foA * 0.62, E.z + d.z * foA * 0.62,
        new THREE.Euler(0, 0, side * 1.57));
    } else {
      segBox(at, 0.088, E, W, foreSleeve, 0.098);                     // предплечье
      const dH = W.clone().sub(E).normalize();
      const H = W.clone().addScaledVector(dH, 0.055);
      segBox(at, 0.082, W, H, traits.skin, 0.09);                 // КИСТЬ
      // Task 42: маунт у кисти (рука БЕЗ крюка) — правая или левая
      mount = new THREE.Object3D();
      mount.position.copy(H);
      mount.userData.wristMount = true;
    }
    const m = new THREE.Mesh(bakeGeom(at), CREW_MAT);
    m.position.set(sx, shoulderY, 0.01);
    if (mount) { m.add(mount); if (traits.hook !== side) wristMount = mount; }
    return m;
  };
  for (const side of [-1, 1] as const) {
    if (movable && role !== 'helmsman') {
      const m = mkArmMesh(side);
      if (side < 0) armL = m; else armR = m;
      group.add(m);
    } else {
      bakeArmInto(t, side);
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
  } else if (traits.headwear === 'wide') {
    // Task 42: ШИРОКОПОЛАЯ — круглые поля + низкая тулья + лента
    bake(t, new THREE.CylinderGeometry(0.3, 0.33, 0.022, 10), HAT, 0, headY + headR * 0.82, 0);
    bake(t, new THREE.CylinderGeometry(0.125, 0.16, 0.13, 8), HAT, 0, headY + headR * 0.95, 0);
    bake(t, new THREE.CylinderGeometry(0.162, 0.162, 0.032, 8), 0x6b4a2a, 0, headY + headR * 0.91, 0);
  } else if (traits.headwear === 'straw') {
    // Task 42: СОЛОМЕННАЯ — жёлтые поля + конус + тёмная лента
    bake(t, new THREE.CylinderGeometry(0.32, 0.36, 0.024, 10), STRAW, 0, headY + headR * 0.8, 0);
    bake(t, new THREE.ConeGeometry(0.155, 0.17, 8), STRAW, 0, headY + headR * 0.96, 0);
    bake(t, new THREE.CylinderGeometry(0.16, 0.16, 0.035, 8), 0x7a4a3a, 0, headY + headR * 0.9, 0);
  } else if (traits.headwear === 'cap') {
    // Task 42: ВЯЗАНАЯ ШАПКА — колпак + отворот (+помпон у трети)
    const cc = CAPS[Math.floor(rnd() * CAPS.length)];
    bake(t, new THREE.SphereGeometry(headR * 1.09, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), cc, 0, headY + 0.015, 0);
    bake(t, new THREE.CylinderGeometry(headR * 1.1, headR * 1.12, 0.05, 10), cc, 0, headY + 0.028, 0);
    if (rnd() < 0.34) bake(t, new THREE.SphereGeometry(0.048, 6, 5), 0xe8e2d4, 0, headY + headR * 1.16, 0);
  } else if (traits.headwear === 'top') {
    // Task 42: ЦИЛИНДР — узкие поля + высокая тулья + лента
    bake(t, new THREE.CylinderGeometry(0.185, 0.205, 0.022, 10), HAT, 0, headY + headR * 0.82, 0);
    bake(t, new THREE.CylinderGeometry(0.108, 0.128, 0.24, 8), HAT, 0, headY + headR * 0.82 + 0.12, 0);
    bake(t, new THREE.CylinderGeometry(0.13, 0.13, 0.032, 8), 0x5c2e2e, 0, headY + headR * 0.82 + 0.035, 0);
  }

  // --- ПОПУГАЙ НА ПЛЕЧЕ (Task 39, ~10% фигур) ---
  if (traits.parrot) {
    const side = traits.hook === 1 ? -1 : 1;   // на плече БЕЗ крюка
    const px = side * (torsoW / 2 + 0.03);
    const base = hipY + torsoH + 0.01;
    const plumage = rnd() < 0.5 ? 0x3f8f3a : 0xc23b2e;   // зелёный / алый
    const wing = plumage === 0x3f8f3a ? 0x2e6b2a : 0x8f2020;
    // тело — наклонённое веретено (грудью вперёд)
    bake(t, new THREE.SphereGeometry(0.055, 8, 6), plumage, px, base + 0.055, -0.005,
      new THREE.Euler(0.45, 0, 0), [1, 1, 1.3]);
    // голова + клюв
    bake(t, new THREE.SphereGeometry(0.034, 8, 6), plumage, px, base + 0.128, 0.02);
    bake(t, new THREE.ConeGeometry(0.013, 0.05, 5), 0xe8a13a, px, base + 0.122, 0.058,
      new THREE.Euler(1.35, 0, 0));
    // сложенное крыло
    bake(t, new THREE.SphereGeometry(0.045, 8, 6), wing, px - side * 0.022, base + 0.06, -0.02,
      new THREE.Euler(0.45, 0, 0), [0.5, 1.1, 1.35]);
    // хвост — 3 пера назад-вниз
    for (let k = -1; k <= 1; k++) {
      bake(t, new THREE.BoxGeometry(0.012, 0.014, 0.1), k === 0 ? 0x3a6bd0 : plumage,
        px + k * 0.022, base + 0.03 - Math.abs(k) * 0.01, -0.085,
        new THREE.Euler(-0.45 + Math.abs(k) * 0.18, 0, 0));
    }
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

  // --- ноги: БЕДРО → КОЛЕНО → ЛОДЫЖКА (Task 39; Task 42: КРОЙ
  //     ШТАНОВ — длинные / ШОРТЫ до колена / РВАНЫЕ ШОРТЫ с
  //     лоскутами) ---
  // у ходоков отдельные (шаг), у остальных в общий меш
  const mkLegParts = (side: number, wood: boolean, ox: number): { pos: number[]; col: number[] } => {
    const lt: { pos: number[]; col: number[] } = { pos: [], col: [] };
    const upH = legH * 0.5, loH = legH * 0.5;
    const H = new THREE.Vector3(ox, legH, 0);                 // бедро (пивот)
    const K = new THREE.Vector3(ox, legH - upH, 0.035);       // колено чуть вперёд
    const A = new THREE.Vector3(ox, 0.075, 0.025);            // лодыжка (над ботинком)
    if (wood) {
      // деревянный протез: ткань сверху + шарнир + стойка
      segBox(lt, 0.115, H, K, traits.pants, 0.13);
      bake(lt, new THREE.BoxGeometry(0.1, 0.07, 0.11), WOOD, K.x, K.y, K.z);
      bake(lt, new THREE.CylinderGeometry(0.045, 0.062, legH - upH + 0.07, 6), WOOD,
        ox, (legH - upH + 0.07) / 2 - 0.005, 0.025);
    } else if (traits.pantsKind === 'long') {
      segBox(lt, 0.115, H, K, traits.pants, 0.135);           // бедро
      bake(lt, new THREE.BoxGeometry(0.125, 0.075, 0.155), traits.pants, K.x, K.y + 0.005, K.z + 0.005); // колено
      segBox(lt, 0.104, K, A, traits.pants, 0.12);            // голень
      bake(lt, new THREE.BoxGeometry(0.115, 0.07, 0.2), 0x1f1a14, ox, 0.035, 0.03); // ботинок
    } else {
      // ШОРТЫ (и РВАНЫЕ): штанина до колена, ниже — голая голень
      segBox(lt, 0.12, H, K, traits.pants, 0.14);             // бедро в штанине
      bake(lt, new THREE.BoxGeometry(0.13, 0.08, 0.16), traits.pants, K.x, K.y + 0.005, K.z + 0.005); // колено
      segBox(lt, 0.09, K, A, traits.skin, 0.1);               // ГОЛАЯ голень
      bake(lt, new THREE.BoxGeometry(0.115, 0.07, 0.2), 0x1f1a14, ox, 0.035, 0.03); // ботинок
      if (traits.pantsKind === 'torn') {
        // РВАНЫЙ край: 3 свисающих лоскута у колена (разной длины)
        const rng2 = mulberry32((seed + side * 77) | 0);
        for (let k = -1; k <= 1; k++) {
          const fl = 0.07 + rng2() * 0.09;                     // длина лоскута
          bake(lt, new THREE.BoxGeometry(0.045, fl, 0.018), traits.pants,
            ox + k * 0.055, K.y - 0.01 - fl * 0.4, 0.045 - k * 0.02,
            new THREE.Euler(k * 0.16, 0, k * 0.22));
        }
      }
    }
    return lt;
  };
  const mkLeg = (side: number, wood: boolean): THREE.Mesh => {
    const lt = mkLegParts(side, wood, 0);
    const m = new THREE.Mesh(bakeGeom(lt), CREW_MAT);
    m.position.set(side * 0.095, legH, 0);
    return m;
  };

  if (movable) {
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
      group, role, legL, legR, armL, armR, wristMount, seed, walkT: rnd(), walkDir: rnd() < 0.5 ? 1 : -1, baseScaleY: 1,
      walkSpeed: 0.55 + rnd() * 0.5, phase: rnd() * 6.28,
      dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
      skin: traits.skin, shirt: traits.shirt, pants: traits.pants,
      hasHook: traits.hook !== 0, hasPeg: traits.pegLeg !== 0, hasParrot: traits.parrot,
      verts: t.pos.length / 3,
    };
  }
  // статичные: ноги вторым мешом (деревянная нога заменяет одну из них)
  const lt2: { pos: number[]; col: number[] } = { pos: [], col: [] };
  for (const side of [-1, 1]) {
    const parts = mkLegParts(side, traits.pegLeg === side, side * 0.095);
    lt2.pos.push(...parts.pos);
    lt2.col.push(...parts.col);
  }
  const legsStatic = new THREE.Mesh(bakeGeom(lt2), CREW_MAT);
  group.add(legsStatic);
  return {
    group, role, seed, walkT: 0, walkDir: 1, walkSpeed: 0, phase: rnd() * 6.28, baseScaleY: 1,
    dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
    skin: traits.skin, shirt: traits.shirt, pants: traits.pants,
    hasHook: traits.hook !== 0, hasPeg: traits.pegLeg !== 0, hasParrot: traits.parrot,
    verts: t.pos.length / 3,
  };
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
  /** Task 43: сек с последнего попадания по кораблю (<8 — «под
   *  обстрелом»: экипаж прижимается к бортам на одно колено) */
  sinceHit?: number;
  /** Task 43: противник для стрелков (мировая позиция; null — нет) */
  threatPos?: THREE.Vector3 | null;
  /** Task 43: дистанция до противника, м */
  threatDist?: number;
  /** Task 43: коллбек выстрела (ружьё/пистолет) — Ship.smallArmsFire */
  shoot?: (weapon: 'musket' | 'pistol', fromWorld: THREE.Vector3, muzzleWorld: THREE.Vector3) => void;
  /** Task 43: сек с начала потопления (для прыжков за борт) */
  sinkT?: number;
}

/** Task 40: МАХИ РУКАМИ при ходьбе — противофаза ногам */
function swingArms(f: CrewFigure, step: number) {
  if (f.armL && f.armR) {
    f.armL.rotation.x = -Math.sin(step) * 0.5;
    f.armR.rotation.x = Math.sin(step) * 0.5;
    f.armL.rotation.z = 0.05;
    f.armR.rotation.z = -0.05;
  }
}
/** руки в покое (пауза/idle) — плавно опускаются */
function swingArmsIdle(f: CrewFigure) {
  if (f.armL && f.armR) {
    f.armL.rotation.x *= 0.8;
    f.armR.rotation.x *= 0.8;
    f.armL.rotation.z = 0.05;
    f.armR.rotation.z = -0.05;
  }
}

/** Task 43: РУЖЬЁ / ПИСТОЛЕТ — меш оружия (ребёнок руки с пивотом
 *  в плече; геометрия ВДОЛЬ руки: при поднятой руке (rotation.x≈−π/2)
 *  дуло смотрит вперёд — как сабля/пистолет капитана у lander) */
function makeWeaponMesh(kind: 'musket' | 'pistol'): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4025, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.7, roughness: 0.45 });
  if (kind === 'musket') {
    // ложа вдоль руки (вниз от кисти — к плечу приклад вверх)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.92, 0.055), wood);
    stock.position.set(0, -0.14, 0.01);
    g.add(stock);
    // ствол — тонкий, тёмный, ниже кисти (к дулу)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.55, 0.032), steel);
    barrel.position.set(0, -0.42, 0.035);
    g.add(barrel);
    // курок/замок
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.06), steel);
    lock.position.set(0, -0.08, 0.05);
    g.add(lock);
  } else {
    // пистолет: короткий — рукоять в кулаке + ствол вперёд
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.05), wood);
    grip.position.set(0, -0.04, 0.015);
    g.add(grip);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.035), steel);
    barrel.position.set(0, -0.2, 0.03);
    g.add(barrel);
  }
  return g;
}

export interface CrewVisual {
  group: THREE.Group;
  total: number;
  shown: number;          // живые видимые фигуры
  dead: number;           // потери (трупы + разорванные)
  /** режим «экипаж из котов»: все фигуры — коты (настройка) */
  isCats?: boolean;
  update(dt: number, time: number, ship: CrewShipState): void;
  setVisible(v: boolean): void;
  /** Task 40: капитан РАЗДАЁТ УКАЗАНИЯ — машет рукой (2.2 с);
   *  false — капитана на палубе нет (погиб/смыт) */
  waveCaptain(): boolean;
  /** Поражение экипажа вдоль пути снаряда (a→b в ЛОКАЛЬНЫХ координатах
   *  корабля). grape — фигуры падают; ball — разрывает на куски.
   *  Возвращает число убитых (1 фигура = 1 человек). */
  killNearPath(a: THREE.Vector3, b: THREE.Vector3, mode: KillMode,
    maxCount: number, radius: number,
    shipPos: THREE.Vector3, shipQuat: THREE.Quaternion): number;
  /** СМЫЛО ЗА БОРТ (зелёная вода): фигура исчезает с палубы БЕЗ трупа —
   *  обрывки летят за фальшборт + всплеск в воде. Честная механика:
   *  вызывается ТОЛЬКО когда палуба действительно под водой */
  washAway(n: number, shipPos: THREE.Vector3,
    shipQuat: THREE.Quaternion): number;
  /** Оживить всех (полигон/сброс повреждений) */
  reset(): void;
  /** Task 43: пуля стрелка противника снимает фигуру с палубы.
   *  Task 45: fromDirWorld — направление полёта (мир): приоритет —
   *  фигуры у борта СО СТОРОНЫ СТРЕЛКА (линия у фальшборта). */
  smallArmsKill(maxCount: number,
    shipPos: THREE.Vector3, shipQuat: THREE.Quaternion,
    fromDirWorld?: THREE.Vector3 | null): number;
  /** Task 43: живых пловцов в воде (после прыжков с тонущего) */
  swimmersAlive(): number;
  /** Task 43: число стрелков (ружья/пистолеты) на палубе */
  armedInfo(): { musket: number; pistol: number };
  /** Task 43: фигуры в позе «на колене у борта» (обстрел) */
  crouchedCount(): number;
  /** Task 45: резерв экипажа: below — живых в трюме (можно поднять
   *  на палубу), spares — запасных фигур «ниже палубы», pending —
   *  заявок на подмену в очереди */
  reservesInfo(): { below: number; spares: number; pending: number };
}

// temporaries для стрельбы (не аллоцировать в кадре)
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _tmpD = new THREE.Vector3();
const _shipInvQ = new THREE.Quaternion();

/** Собрать экипаж для корабля (local coords: +Z нос, +X порт).
 *  Число фигур = deckCrewFor(maxCrew): 1 фигура = 1 человек;
 *  500-экипаж → 50 фигур, минимум 10 — от 10 на шлюпе до ~73
 *  на линейном корабле.
 *  allCats — режим «заменить всех матросов на котов»: та же
 *  логика ролей/маршрутов, но фигуры — коты (cats.ts) */
export function buildCrew(P: ShipPreset, seed: number, allCats = false): CrewVisual {
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

  // ============================================================
  // Task 45: ПОДМЕНА ПОГИБШИХ ЖИВЫМИ ИЗ ЭКИПАЖА. На палубе — боевой
  // расчёт (baseDeck = nDeck); остальной экипаж «ниже палубы»
  // (spares — скрытые фигуры, не в figures). Когда стрелок на посту
  // гибнет, из люка у мачты поднимается замена и встаёт на его
  // место. Очередь replQueue копит заявки (после гибели 2-4.5 с);
  // активация — в update(), пока в трюме есть живые.
  // ============================================================
  const baseDeck = nDeck;                    // полный состав палубы
  const spares: CrewFigure[] = [];          // живые «ниже палубы» (не в figures)
  const replQueue: number[] = [];           // заявки на подмену: время готовности
  let lastSide = 1;                         // борт последней угрози (гистерезис у ДП)
  let lastTime = 0;                         // время симуляции для очереди
  let lastCrew = 0;                         // экипаж с последнего update (reservesInfo)
  const hatchZ = mastZ[0] - 1.7;            // люк у грот-мачты — вход подмены
  const nSpares = Math.min(12, Math.max(0, Math.round(P.maxCrew * 0.8) - nDeck));
  for (let i = 0; i < nSpares; i++) {
    const f = allCats
      ? buildCatCrewFigure('watch', nextSeed(), true)
      : buildFigure('watch', rollTraits(rot, 'watch'), nextSeed(), true);
    if (!allCats && f.wristMount) {
      f.weapon = rot() < 0.7 ? 'musket' : 'pistol';
      f.gunCd = 1 + rot() * 2;
      f.crouchT = 0;
      f.gunArm = (f.wristMount.parent as THREE.Mesh) ?? f.armR ?? f.armL ?? null;
    }
    f.group.visible = false;        // ниже палубы: не виден и не считается
    group.add(f.group);
    spares.push(f);
  }

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
  // === ПОЛЕЗНАЯ РАБОТА (замечание игрока: «экипаж не должен стоять
  // на месте — должны постоянно ходить и что-то делать полезное»):
  // маршруты в границах ОДНОЙ палубы (без шага через квартердек
  // посреди пути). Шпиль — как в buildShip: перед квартердеком. ===
  const capstanZ = P.quarter
    ? quarterFrontZ(P) + Math.max(1.2, L * 0.05)
    : -L * 0.16;
  // интервалы палуб по z: квартердек [QD] и главная палуба [MD]
  const QD: number[] | null = qFront > -Infinity
    ? [-L / 2 + 0.85, qFront - 0.55] : null;
  const MD: number[] = [
    Math.max(-L * 0.36, qFront > -Infinity ? qFront + 0.75 : -L * 0.36), L * 0.30];
  const laneZ = (za: number, zb: number, iv: number[] | null): [number, number] | null => {
    if (!iv) return null;
    const a = Math.min(Math.max(za, iv[0]), iv[1]);
    const b = Math.min(Math.max(zb, iv[0]), iv[1]);
    if (Math.abs(b - a) >= 1.15) return [a, b];
    // слишком коротко — минимальный маршрут от za
    const a2 = Math.min(Math.max(za, iv[0]), Math.max(iv[0], iv[1] - 1.15));
    const b2 = a2 + 1.15;
    return b2 <= iv[1] + 1e-6 ? [a2, b2] : null;
  };
  for (const role of plan) {
    // капитан/боцман/канониры/вахтенные — «работяги»: отдельные
    // ноги (шагают), маршруты задаются ниже
    const busy = role === 'captain' || role === 'boatswain'
      || role === 'gunner' || role === 'watch';
    const f = allCats
      ? buildCatCrewFigure(role, nextSeed(), busy || role === 'walker')
      : buildFigure(role, rollTraits(rot, role), nextSeed(), busy || role === 'walker');
    // Task 43: ВООРУЖЕНИЕ МАТРОСОВ — ружьё 70% (дальность 50 м),
    // пистолет 30% (20 м). Стрелки — роли с подвижными руками
    // (рулевой у штурвала, гребцы на банках, капитан на мостике —
    // без оружия; коты не стреляют). Оружие вешается в МАУНТ У
    // КИСТИ (рука без крюка) — как сабля капитана у lander
    if (!allCats && role !== 'captain' && role !== 'helmsman' && role !== 'rower'
      && f.wristMount) {
      f.weapon = rot() < 0.7 ? 'musket' : 'pistol';
      f.gunCd = 1 + rot() * 2;    // первая очередь — не залпом
      f.crouchT = 0;
      // рука-стрелок: родитель маунта (та, что без крюка)
      f.gunArm = (f.wristMount.parent as THREE.Mesh) ?? f.armR ?? f.armL ?? null;
    }
    if (role === 'captain') {
      // капитан — РАСХАЖИВАЕТ по квартердеку за спиной рулевого
      // (замирает и смотрит на горизонт)
      place(f, 0.55, wheelZ - 1.6, 0.3);
      const lane = laneZ(wheelZ - 2.5, wheelZ - 1.1, QD ?? MD);
      if (lane) f.work = {
        kind: 'pace',
        a: new THREE.Vector3(0.74, 0, lane[0]),
        b: new THREE.Vector3(-0.66, 0, lane[1]),
        faceA: 0.3, faceB: -0.35, leanA: 0.05, leanB: 0.05,
        pauseDur: 1.4 + rot() * 1.6, pause: 0, pauseAt: 'a',
        t: rot(), dir: rot() < 0.5 ? 1 : -1, speed: 0.52,
      };
    } else if (role === 'helmsman') {
      // рулевой — за штурвалом (руки на ободе), лицом к носу
      place(f, 0, wheelZ - 0.52, 0);
    } else if (role === 'boatswain') {
      // боцман — ВРАЩАЕТ ШПИЛЬ: ходит по кругу, наваливаясь на бар
      place(f, -0.75, capstanZ + 1.0, 0.5);
      f.work = {
        kind: 'circle', cx: 0, cz: capstanZ,
        r: Math.max(0.85, 0.95 + (rot() - 0.5) * 0.2),
        ang: rot() * Math.PI * 2,
        angSpd: (rot() < 0.5 ? -1 : 1) * (0.42 + rot() * 0.22),
        pauseDur: 0, pause: 0, pauseAt: 'a', t: 0, dir: 1, speed: 0.6,
      };
    } else if (role === 'rower') {
      // гребец — на банке у своего весла, лицом к корме (сидя)
      const z = oarZ.length ? oarZ[(ri * 2) % oarZ.length] : L * 0.1;
      const side = ri % 2 === 0 ? -1 : 1;
      ri++;
      place(f, side * Math.max(0.55, halfW(z) * 0.5), z + 0.35, Math.PI);
      // «сидит»: матрос приземленее и приземистее (гребная банка);
      // кот-гребец просто сидит — он и так низенький
      if (!allCats) {
        f.group.position.y -= 0.30;
        f.group.scale.y = 0.78;
        f.baseScaleY = 0.78;
      }
    } else if (role === 'gunner') {
      // канонир — ОБСЛУЖИВАЕТ орудие: челнок орудие↔пороховая яма,
      // у ствола наклоняется (заряжает), у кучи — берёт ядро
      const z = deckGuns[Math.floor(gi / 2) % Math.max(1, deckGuns.length)];
      const side = gi % 2 === 0 ? -1 : 1;
      gi++;
      const w = halfW(z);
      const jz = (rot() - 0.5) * 1.3;
      place(f, side * (w * 0.56), z + 0.55 + jz, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const lane = laneZ(z + 0.55 + jz, z - 0.5 + jz * 0.5, MD);
      if (lane) f.work = {
        kind: 'shuttle',
        a: new THREE.Vector3(side * (w * 0.56), 0, lane[0]),   // у орудия
        b: new THREE.Vector3(side * (w * 0.2), 0, lane[1]),     // яма с ядрами
        faceA: side * Math.PI / 2, faceB: side * Math.PI / 2,
        leanA: 0.4, leanB: 0.5,
        pauseDur: 1.1 + rot() * 0.9, pause: 0, pauseAt: 'a',
        t: rot(), dir: rot() < 0.5 ? 1 : -1, speed: 0.6,
      };
    } else if (role === 'watch') {
      // вахтенный — ПАТРУЛИРУЕТ вдоль планширя у своей мачты,
      // на концах замирает и вглядывается в море (лёгкий наклон)
      const mz = mastZ[wi % mastZ.length];
      const side = wi % 2 === 0 ? -1 : 1;
      const toBow = wi % 4 < 2;   // кто-то к носу, кто-то к корме
      wi++;
      place(f, side * Math.max(0.7, halfW(mz) * 0.42), mz + 0.9, side * (Math.PI / 2));
      const onQ = !!(QD && mz < qFront);
      const lane = laneZ(mz + 0.9, toBow ? mz + 4.2 : mz - 3.0, onQ ? QD : MD);
      if (lane) f.work = {
        kind: 'pace',
        a: new THREE.Vector3(side * 0.5, 0, lane[0]),
        b: new THREE.Vector3(side * 0.5, 0, lane[1]),
        faceA: side * Math.PI / 2, faceB: side * Math.PI / 2,   // лицом в море
        leanA: 0.13, leanB: 0.13,
        hullFollow: side * 0.78,                                // вдоль борта по кривизне
        pauseDur: 1.6 + rot() * 1.8, pause: 0, pauseAt: 'a',
        t: rot(), dir: rot() < 0.5 ? 1 : -1, speed: 0.42 + rot() * 0.22,
      };
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
    // мировые координаты центра тела (у котов центр у самой палубы)
    const lp = f.group.position;
    const wpos = new THREE.Vector3(lp.x, lp.y + (f.midY ?? 0.75), lp.z).applyQuaternion(shipQuat).add(shipPos);
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

  // ============================================================
  // Task 43: ЭВАКУАЦИЯ И ПЛОВЦЫ
  // ============================================================
  let abandonStarted = false;
  /** убрать пловца из мира (утонул/сброс) — с очисткой геометрии */
  const removeSwimmer = (f: CrewFigure) => {
    const root = FX.worldRoot;
    if (root && f.group.parent === root) {
      root.remove(f.group);
      f.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    f.swim = undefined;
    f.group.visible = false;
  };
  // ============================================================
  // Task 48: СБИТ ЗА БОРТ. Пуля/удар валит матроса ЗА фальшборт:
  // фигура отцепляется в мир, летит наружу параболой (фаза 'jump')
  // и приводнится мёртвым телом (фаза 'float' — лицом вниз,
  // дрейф + пузыри, затем 'drown' — медленно уходит под воду)
  // ============================================================
  const killOverboard = (f: CrewFigure, shipPos: THREE.Vector3,
    shipQuat: THREE.Quaternion) => {
    const root = FX.worldRoot;
    f.dead = true;
    f.deadT = 0;
    f.deathMode = 'fall';
    f.corpseLife = 0;
    f.fallDir = Math.random() < 0.5 ? 1 : -1;
    f.fallRoll = (Math.random() - 0.5) * 0.8;
    if (!root) { f.group.visible = false; return; }
    const side = f.group.position.x >= 0 ? 1 : -1;   // +X порт: наружу
    const lp = f.group.position;
    const wpos = new THREE.Vector3(lp.x, lp.y + (f.midY ?? 0.75), lp.z)
      .applyQuaternion(shipQuat).add(shipPos);
    root.add(f.group);
    f.group.position.copy(wpos);
    f.group.rotation.set(0, f.group.rotation.y, 0);
    const out = new THREE.Vector3(side, 0, 0).applyQuaternion(shipQuat);
    f.swim = {
      phase: 'jump', t: 0,
      vx: out.x * (1.7 + Math.random() * 1.3),
      vz: out.z * (1.7 + Math.random() * 1.3),
      drownAt: 0, jumpY: 0.9 + Math.random() * 0.7,
    };
    // кровь в полёте + крик брызг при приводнении даст updateSwimmers
    FX.particles?.blood(wpos.x, wpos.y, wpos.z,
      out.x * 2.2, 0.6, out.z * 2.2, 6, 0.9);
  };

  /** корабль тонет: раздать «прыжки» живым фигурам и вести их к
   *  борту (фаза run); прыжок/плавание — updateSwimmers */
  const startAbandon = (dt: number, time: number, ship: CrewShipState) => {
    const root = FX.worldRoot;
    const deckGone = (ship.sinkT ?? 99) > 3.5;
    for (const f of figures) {
      if (f.dead || f.swim || !f.group.visible) continue;
      if (!abandonStarted && Math.random() < 0.65 || deckGone) {
        // станет пловцом: бежит к ближнему борту
        const side = f.group.position.x >= 0 ? 1 : -1;
        f.swim = {
          phase: 'run', t: 0,
          vx: 0, vz: 0,
          drownAt: 0, jumpY: f.group.position.y,
        };
        (f as CrewFigure & { swimSide?: number }).swimSide = side;
      }
    }
    abandonStarted = true;
    // фаза run — бег к борту (пока в группе корабля)
    for (const f of figures) {
      if (!f.swim || f.swim.phase !== 'run') continue;
      const s = f.swim;
      s.t += dt;
      const side = (f as CrewFigure & { swimSide?: number }).swimSide ?? 1;
      const w = halfW(f.group.position.z);
      const targetX = side * Math.max(0.55, w * 0.92);
      const k = Math.min(1, s.t / 0.9);
      f.group.position.x += (targetX - f.group.position.x) * Math.min(1, dt * 5);
      f.group.rotation.y = side * Math.PI / 2;   // лицом к морю
      // семенит ногами
      const step = time * 11;
      if (f.legL && f.legR) {
        f.legL.rotation.x = Math.sin(step) * 0.75;
        f.legR.rotation.x = -Math.sin(step) * 0.75;
      }
      swingArms(f, step);
      if (k >= 1) {
        // ПРЫЖОК: отцепить фигуру в мировой корень (сохраняя позу)
        s.phase = 'jump';
        s.t = 0;
        if (root) {
          const worldPos = new THREE.Vector3().copy(f.group.position)
            .applyQuaternion(ship.quaternion).add(ship.position);
          root.add(f.group);
          f.group.position.copy(worldPos);
          f.group.rotation.set(0, 0, 0);
          // мировое направление наружу борта
          const out = new THREE.Vector3(side, 0, 0).applyQuaternion(ship.quaternion);
          s.vx = out.x * (2.6 + Math.random() * 1.6);
          s.vz = out.z * (2.6 + Math.random() * 1.6);
          s.jumpY = 2.0 + Math.random() * 1.1;   // вертикальная скорость прыжка
        } else {
          // мир недоступен — просто скрыть (страховка)
          f.group.visible = false;
          f.swim = undefined;
        }
      }
    }
  };
  /** пловцы: прыжок (парабола), плавание на волнах, утопление */
  const updateSwimmers = (dt: number, time: number) => {
    const P = FX.particles;
    for (const f of figures) {
      const s = f.swim;
      if (!s || !f.group.visible) continue;
      const g = f.group;
      s.t += dt;
      if (s.phase === 'jump') {
        // парабола наружу борта
        s.jumpY -= 9.8 * dt;
        g.position.x += s.vx * dt;
        g.position.z += s.vz * dt;
        g.position.y += s.jumpY * dt;
        g.rotation.x = -Math.min(0.6, s.t * 1.4);   // «рыбкой» вперёд
        const wy = waterHeightAt(g.position.x, g.position.z, time);
        if (g.position.y <= wy + 0.1) {
          // приводнение! (Task 48: мёртвое тело — фаза 'float')
          P?.splash(g.position.x, wy, g.position.z, 0.75);
          if (f.dead) {
            s.phase = 'float';
            s.t = 0;
            s.drownAt = 8 + Math.random() * 9;   // сколько продержится
            g.rotation.x = 1.5;                    // лицом вниз
            g.position.y = wy - 0.55;
          } else {
            s.phase = 'swim';
            s.t = 0;
            s.drownAt = 7 + Math.random() * 13;   // сколько продержится
            g.rotation.x = 1.35;                   // лёжа в воде
            g.position.y = wy - 0.52;
          }
        }
      } else if (s.phase === 'float') {
        // Task 48: СБИТЫЙ ЗА БОРТ — мёртвый дрейф: лицом вниз,
        // качается на волне, редкие пузыри; потом уходит под воду
        const wy = waterHeightAt(g.position.x, g.position.z, time);
        g.position.y = wy - 0.55 + Math.sin(time * 1.6 + f.phase) * 0.04;
        g.position.x += s.vx * dt;
        g.position.z += s.vz * dt;
        s.vx *= Math.exp(-dt * 0.4);
        s.vz *= Math.exp(-dt * 0.4);
        g.rotation.x = 1.5 + Math.sin(time * 1.2 + f.phase) * 0.07;
        g.rotation.z = Math.sin(time * 0.9 + f.phase) * 0.12;
        if (P && Math.random() < dt * 0.7) {
          P.spawn(g.position.x, wy, g.position.z,
            (Math.random() - 0.5) * 0.3, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3,
            0.4, 0.12, 0, 0.4, 9);
        }
        if (s.t > s.drownAt) { s.phase = 'drown'; s.t = 0; }
      } else if (s.phase === 'swim') {
        // на волне: дрейф + барахтанье руками
        const wy = waterHeightAt(g.position.x, g.position.z, time);
        g.position.y = wy - 0.52 + Math.sin(time * 2.2 + f.phase) * 0.05;
        // медленный дрейф по инерции прыжка
        g.position.x += s.vx * dt;
        g.position.z += s.vz * dt;
        s.vx *= Math.exp(-dt * 0.5);
        s.vz *= Math.exp(-dt * 0.5);
        g.rotation.x = 1.35 + Math.sin(time * 1.7 + f.phase) * 0.09;
        g.rotation.z = Math.sin(time * 1.3 + f.phase) * 0.16;
        // гребки руками
        if (f.armL && f.armR) {
          f.armL.rotation.x = -1.2 + Math.sin(time * 5.5 + f.phase) * 0.75;
          f.armR.rotation.x = -1.2 + Math.sin(time * 5.5 + f.phase + Math.PI) * 0.75;
        }
        // бульки/барашки
        if (P && Math.random() < dt * 1.4) {
          P.spawn(g.position.x, wy, g.position.z,
            (Math.random() - 0.5) * 0.7, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7,
            0.55, 0.14, 0, 0.5, 9);
        }
        if (s.t > s.drownAt) { s.phase = 'drown'; s.t = 0; }
      } else if (s.phase === 'drown') {
        // ТОНЕТ: медленно уходит под воду, кувырок, пузыри
        g.position.y -= dt * (0.35 + s.t * 0.16);
        g.rotation.x += dt * 0.55;
        g.rotation.z += dt * 0.3;
        if (P && Math.random() < dt * 5) {
          P.spawn(g.position.x, waterHeightAt(g.position.x, g.position.z, time), g.position.z,
            (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 1.1, (Math.random() - 0.5) * 0.3,
            0.8, 0.1, 0, 0.05, -1.4);
        }
        if (s.t > 3.2) {
          removeSwimmer(f);
        }
      }
    }
  };

  const vis: CrewVisual = {
    group, total: figures.length, shown: figures.length, dead: 0, isCats: allCats,
    setVisible(v: boolean) { group.visible = v; },
    waveCaptain() {
      // Task 40: найти ЖИВОГО капитана и поднять руку (2.2 с)
      const cap = figures.find(f => f.role === 'captain' && !f.dead && f.group.visible);
      if (!cap) return false;
      cap.waveT = 2.2;
      return true;
    },
    killNearPath(a, b, mode, maxCount, radius, shipPos, shipQuat) {
      // ТОЧНОЕ поражение: путь снаряда (a→b, локальные координаты корабля)
      // против вертикальной капсулы КАЖДОЙ фигуры (ноги → голова).
      // Ядро/пуля картечи убивают только фигуру, которую ПРОШЁЛ снаряд —
      // залп в борт рядом с матросом его не трогает.
      const A = new THREE.Vector3(a.x, a.y, a.z);
      const B = new THREE.Vector3(b.x, b.y, b.z);
      const cands: { f: CrewFigure; d: number }[] = [];
      for (const f of figures) {
        if (f.dead || f.swim || !f.group.visible) continue;
        const p = f.group.position;
        const lo = new THREE.Vector3(p.x, p.y + (f.hitLo ?? 0.12), p.z);
        const hi = new THREE.Vector3(p.x, p.y + (f.hitH ?? 1.62), p.z);
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
    washAway(n, shipPos, shipQuat) {
      // смыв за борт: без трупа на палубе — фигуру УНОСИТ потоком
      // (несколько обрывков летят ЗА фальшборт + барашки в воде)
      let washed = 0;
      const wpos = new THREE.Vector3();
      const gibs = FX.gibs;
      for (const f of figures) {
        if (washed >= n) break;
        if (f.dead || f.swim || !f.group.visible) continue;
        const lp = f.group.position;
        wpos.set(lp.x, lp.y + (f.midY ?? 0.75), lp.z).applyQuaternion(shipQuat).add(shipPos);
        f.dead = true;
        f.deadT = 0;
        f.deathMode = 'gib';
        f.corpseLife = 0;
        f.group.visible = false;
        // обрывки летят ЗА БОРТ (к ближайшему борту от фигуры)
        const side = lp.x >= 0 ? 1 : -1;        // +X порт: наружу — в ту же сторону
        const out = new THREE.Vector3(side, 0, 0).applyQuaternion(shipQuat);
        if (gibs) {
          for (let k = 0; k < 3; k++) {
            gibs.spawnPart(
              new THREE.Vector3(wpos.x, wpos.y - 0.2 + k * 0.3, wpos.z),
              new THREE.Vector3(
                out.x * (3.2 + Math.random() * 2.6) + (Math.random() - 0.5) * 1.6,
                0.8 + Math.random() * 1.8,
                out.z * (3.2 + Math.random() * 2.6) + (Math.random() - 0.5) * 1.6),
              0.1 + Math.random() * 0.12, 0.1 + Math.random() * 0.14, 0.1 + Math.random() * 0.12,
              k === 0 ? f.shirt : (k === 1 ? f.pants : f.skin), 1.2 + Math.random());
          }
        }
        FX.particles?.splash(wpos.x + out.x * 1.6, wpos.y - 0.5, wpos.z + out.z * 1.6, 0.9);
        washed++;
      }
      vis.dead = figures.filter(f2 => f2.dead).length;
      vis.shown = figures.filter(f2 => !f2.dead && f2.group.visible).length;
      return washed;
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
        // Task 43/45: сброс боя/эвакуации/постов
        f.crouchT = 0;
        f.postT = 0;
        f.replQueued = false;
        if (f.swim) {
          // пловец ещё в мире — убрать (возврата на палубу нет)
          removeSwimmer(f);
        }
      }
      // Task 45: поднятых из трюма — обратно «ниже палубы» (сброс)
      for (let i = figures.length - 1; i >= 0; i--) {
        const f = figures[i];
        if (!f.fromSpare) continue;
        f.group.visible = false;
        f.postT = 0;
        figures.splice(i, 1);
        spares.push(f);
      }
      replQueue.length = 0;
      abandonStarted = false;
      vis.dead = 0;
      vis.shown = figures.length;
    },
    smallArmsKill(maxCount, shipPos, shipQuat, fromDirWorld) {
      // Task 43/45: пуля противника — фигура падает. Предпочтение —
      // стрелки на СТОРОНЕ СТРЕЛКА (они стоят в линии у борта и
      // видны из-за фальшборта); без направления — случайная.
      // Task 48: фигура У БОРТА (или 1 из 3 в любом месте) валится
      // ЗА ФАЛЬШБОРТ — пуля «снимает матроса с корабля» в воду
      const alive = figures.filter(f => !f.dead && !f.swim && f.group.visible);
      if (!alive.length) return 0;
      if (fromDirWorld) {
        // мировое направление полёта → локальные координаты корабля
        _tmpA.copy(fromDirWorld);
        _shipInvQ.copy(shipQuat).invert();
        _tmpA.applyQuaternion(_shipInvQ);
        const side = _tmpA.x >= 0 ? 1 : -1;
        // ближе к борту со стороны стрелка — выше в списке
        alive.sort((a, b) => (b.group.position.x * side) - (a.group.position.x * side));
      } else {
        for (let i = alive.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [alive[i], alive[j]] = [alive[j], alive[i]];
        }
      }
      const n = Math.min(maxCount, alive.length);
      for (let i = 0; i < n; i++) {
        const f = alive[i];
        const lp = f.group.position;
        // у самого борта (кромка фальшборта) или каждый третий — ЗА БОРТ
        const nearRail = Math.abs(lp.x) >= Math.max(0.55, halfW(lp.z) * 0.62);
        if (nearRail || Math.random() < 0.34) {
          killOverboard(f, shipPos, shipQuat);
        } else {
          killFigure(f, 'grape', f.group.position,
            f.group.position.clone().add(new THREE.Vector3(0, 0, 1)),
            shipPos, shipQuat);
        }
      }
      vis.dead = figures.filter(f => f.dead).length;
      vis.shown = figures.filter(f => !f.dead && f.group.visible).length;
      return n;
    },
    swimmersAlive() {
      return figures.filter(f => f.swim && !f.dead && f.swim.phase !== 'drown' && f.group.visible).length;
    },
    armedInfo() {
      let musket = 0, pistol = 0;
      for (const f of figures) {
        if (f.dead || f.swim || !f.group.visible) continue;
        if (f.weapon === 'musket') musket++;
        else if (f.weapon === 'pistol') pistol++;
      }
      return { musket, pistol };
    },
    crouchedCount() {
      return figures.filter(f => !f.dead && !f.swim
        && f.group.visible && (f.crouchT ?? 0) > 0.5).length;
    },
    reservesInfo() {
      const onDeck = figures.reduce((a, f) =>
        a + ((f.dead || f.swim || !f.group.visible) ? 0 : 1), 0);
      return {
        below: Math.max(0, lastCrew - onDeck),
        spares: spares.length,
        pending: replQueue.length,
      };
    },
    update(dt, time, ship) {
      // ==========================================================
      // Task 43: ПЛОВЦЫ живут в МИРОВЫХ координатах — обновляются
      // ВСЕГДА, даже когда корабль уже утонул и скрыт
      // ==========================================================
      updateSwimmers(dt, time);
      if (ship.sunk) { group.visible = false; return; }

      // ==========================================================
      // Task 43: ЭВАКУАЦИЯ — корабль тонет: живые матросы бегут
      // к борту и ПРЫГАЮТ В ВОДУ (65% сразу, остальные — когда
      // палуба уходит под воду, sinkT>3.5); плавают, потом ТОНУТ
      // ==========================================================
      if (ship.sinking) {
        replQueue.length = 0;   // Task 45: тонем — подмена отменяется
        startAbandon(dt, time, ship);
        return;
      }
      group.visible = true;
      abandonStarted = false;

      // ==========================================================
      // Task 45: БОЕВЫЕ ПОСТА ВДОЛЬ БОРТА + ПОДМЕНА ПОГИБШИХ.
      // Сторона угрози — с гистерезисом у ДП (строй не перебегает
      // туда-сюда); посты — равномерно вдоль борта УГРОЗЫ. Когда
      // стрелок на посту гибнет, через 2-4.5 с из люка у мачты
      // поднимается замена из трюма (пока там есть живые).
      // ==========================================================
      lastTime = time;
      lastCrew = ship.crew;
      {
        // Task 46: заявки на подмену — КАЖДЫЙ погибший (не только
        // вооружённый): «погибшие матросы подменяются живыми из
        // общего количества экипажа на корабле» — включая гребцов,
        // канониров и вахтенных, убитых картечью/ядрами.
        // Task 48: и СБИТЫХ ЗА БОРТ (у них стоит f.swim, но они
        // мертвы — мёртвый пловец ≠ живый пловец: замена нужна)
        if (CREW_RULES.replacement) {
          for (const f of figures) {
            if (f.dead && !f.replQueued) {
              f.replQueued = true;
              replQueue.push(time + 2 + Math.random() * 2.5);
            }
          }
        }
        // активация: пока есть запасные фигуры и живые в трюме
        // (экипаж > уже стоящих на палубе) — поднять из люка
        let onDeck = figures.reduce((a, f) =>
          a + ((f.dead || f.swim || !f.group.visible) ? 0 : 1), 0);
        for (let qi = 0; qi < replQueue.length; ) {
          if (replQueue[qi] > time) { qi++; continue; }
          if (!(spares.length > 0 && ship.crew > onDeck)) {
            replQueue.splice(qi, 1); continue;   // некем — заявку снять
          }
          const f = spares.shift()!;
          figures.push(f);
          f.fromSpare = true;
          f.group.visible = true;
          f.group.position.set(
            0.35 + (Math.random() - 0.5) * 0.35,
            deckYAt(hatchZ),
            hatchZ + (Math.random() - 0.5) * 0.5);
          f.group.rotation.set(0, Math.PI, 0);   // из люка — лицом к корме
          f.postT = 9 + Math.random() * 4;       // идёт на пост и остаётся
          f.gunCd = 1 + Math.random() * 2;
          onDeck++;
          replQueue.splice(qi, 1);
        }
      }
      // сторона угрози (локальные координаты)
      let engageSide = lastSide;
      if (ship.threatPos) {
        _tmpA.copy(ship.threatPos).sub(ship.position);
        _shipInvQ.copy(ship.quaternion).invert();
        _tmpA.applyQuaternion(_shipInvQ);
        if (Math.abs(_tmpA.x) > 1.2) engageSide = _tmpA.x >= 0 ? 1 : -1;
      }
      lastSide = engageSide;
      const underFire = (ship.sinceHit ?? 999) < 8;
      const threatPos = ship.threatPos ?? null;
      const tDistShip = ship.threatDist ?? Infinity;
      // посты: живые стрелки (по текущему z) — равномерно вдоль борта
      {
        const gunners = figures
          .filter(g => g.weapon && !g.dead && !g.swim && g.group.visible)
          .sort((a, b) => a.group.position.z - b.group.position.z);
        const zA = -L * 0.30, zB = L * 0.28;
        const n = gunners.length;
        gunners.forEach((g, i) => {
          g.stZ = n === 1 ? (zA + zB) * 0.5 : zA + (zB - zA) * (i + 0.5) / n;
          g.stSide = engageSide;
        });
      }

      // --- трупы: падение и истлевание (Task 48: сбитые за борт —
      // в мире, ими управляет updateSwimmers, тут не трогаем) ---
      for (const f of figures) {
        if (!f.dead || f.swim || f.deathMode !== 'fall') continue;
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

      // --- потери команды: Task 45 — палуба держит полный строй
      // (baseDeck), пока в трюме есть живые; погибших подменяют.
      // Когда экипаж (ship.crew) падает ниже состава палубы — строй
      // редеет: избыток умирает по одной за кадр, трупы падают
      // естественно (crew = 0 → палуба ПУСТАЕТ)
      const target = Math.min(baseDeck, Math.max(0, Math.round(ship.crew)));
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
        // ========================================================
        // Task 45: СТРЕЛОК НА БОЕВОМ ПОСТУ — до основной анимации:
        // под атакой фигура БЕЖИТ на пост вдоль борта угрози и
        // стреляет ОТТУДА (на колене за фальшбортом), а не ходит
        // по палубе. Замена из трюма (postT) идёт к посту даже
        // после боя и остаётся вахтой у планширя.
        // ========================================================
        if (f.weapon && !f.swim) {
          let handled = false;
          const range = f.weapon === 'musket' ? 85 : 32;
          // «наша» атака: противник в пределах дальности оружия (+10 м):
          // и когда НАС атакуют (underFire), и когда МЫ атакуем (threat
          // рядом) — в обоих случаях стрелки занимают посты у борта
          const near = !!threatPos && tDistShip < range + 10;
          const engaged = underFire || (f.postT ?? 0) > 0 || near;
          // ленивое создание меша оружия
          if ((engaged || near) && !f.weaponMesh) {
            f.weaponMesh = makeWeaponMesh(f.weapon);
            if (f.wristMount) f.wristMount.add(f.weaponMesh);
            else f.group.add(f.weaponMesh);
          }
          if (f.weaponMesh) f.weaponMesh.visible = engaged || near;
          f.gunCd = (f.gunCd ?? 1) - dt;
          if (engaged) {
            handled = true;
            // после боя стрелок ещё немного держит пост
            f.postT = 3 + Math.random() * 2.5;
            const side = f.stSide ?? 1;
            const stZ = f.stZ ?? f.group.position.z;
            const stX = side * Math.max(0.55, halfW(stZ) * 0.80);
            const dx = stX - f.group.position.x;
            const dz = stZ - f.group.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.42) {
              // БЕГ К ПОСТУ (оружие в руках, во весь рост)
              f.crouchT = Math.max(0, (f.crouchT ?? 0) - dt * 2.2);
              const step = Math.min(dist, 2.4 * dt);
              f.group.position.x += (dx / dist) * step;
              f.group.position.z += (dz / dist) * step;
              f.group.position.y = deckYAt(f.group.position.z);
              f.group.rotation.y = Math.atan2(dx, dz);   // лицом по ходу
              f.group.rotation.x = 0;
              f.group.rotation.z = Math.sin(time * 1.7 + f.phase) * 0.03;
              const st = time * 12.5;
              if (f.legL && f.legR) {
                f.legL.rotation.x = Math.sin(st) * 0.78;
                f.legR.rotation.x = -Math.sin(st) * 0.78;
              }
              swingArms(f, st);
              f.group.position.y += Math.abs(Math.sin(st)) * 0.04;
            } else {
              // НА ПОСТУ: на колено за фальшбортом, лицом в море
              const ct = f.crouchT = Math.min(1, (f.crouchT ?? 0) + dt * 3.2);
              f.group.position.set(stX, deckYAt(stZ) - 0.26 * ct, stZ);
              f.group.rotation.y = side * Math.PI / 2;
              f.group.rotation.x = 0.38 * ct;
              f.group.rotation.z = Math.sin(time * 1.9 + f.phase) * 0.05 * ct;
              if (f.legL && f.legR) {
                f.legL.rotation.x = -0.55 * ct;   // передняя вперёд
                f.legR.rotation.x = 1.18 * ct;    // задняя коленом в палубу
              }
              if (f.gunArm) { f.gunArm.rotation.x = -1.15 * ct; f.gunArm.rotation.z = 0; }
              // ОГОНЬ С ПОСТА (только с колена — «стреляют оттуда»);
              // Task 46: выключен в настройках — ружья молчат
              // (поза у борта остаётся — это укрытие)
              if (CREW_RULES.marksmen && threatPos && tDistShip < range
                && (f.gunCd ?? 1) <= 0 && ct > 0.5) {
                const chest = _tmpA.copy(f.group.position);
                chest.y += (f.midY ?? 0.75) + 0.15;
                chest.applyQuaternion(ship.quaternion).add(ship.position);
                _tmpB.copy(threatPos).sub(chest);
                const dLen = _tmpB.length() || 1;
                _tmpB.divideScalar(dLen);
                const muzzle = _tmpC.copy(chest).addScaledVector(_tmpB, 0.55);
                ship.shoot?.(f.weapon, chest, muzzle);
                if (f.gunArm) f.gunArm.rotation.x += 0.22;   // отдача
                // доворот к цели (yaw — в локальных координатах)
                const lt = _tmpD.copy(threatPos).sub(ship.position)
                  .applyQuaternion(_shipInvQ.copy(ship.quaternion).invert());
                f.group.rotation.y = Math.atan2(lt.x, lt.z) * (1 - ct * 0.35);
                f.gunCd = f.weapon === 'musket'
                  ? 4.5 + Math.random() * 3
                  : 2.2 + Math.random() * 1.6;
              }
            }
          } else if ((f.postT ?? 0) > 0) {
            // после боя: держит пост у планширя, сторожит море
            handled = true;
            f.postT = (f.postT ?? 0) - dt;
            f.crouchT = Math.max(0, (f.crouchT ?? 0) - dt * 1.4);
            const side = f.stSide ?? (f.group.position.x >= 0 ? 1 : -1);
            f.group.rotation.y = side * Math.PI / 2;
            f.group.rotation.x = 0;
            f.group.rotation.z = Math.sin(time * 1.2 + f.phase) * 0.04;
            if (f.legL && f.legR) { f.legL.rotation.x *= 0.85; f.legR.rotation.x *= 0.85; }
            swingArmsIdle(f);
          } else if ((f.crouchT ?? 0) > 0.01) {
            // встаёт с колена — поза плавно гаснет
            handled = true;
            f.crouchT = Math.max(0, (f.crouchT ?? 0) - dt * 1.6);
            const ct = f.crouchT ?? 0;
            f.group.rotation.x = 0.38 * ct;
            f.group.rotation.y = (f.stSide ?? 1) * Math.PI / 2;
            if (f.legL && f.legR) {
              f.legL.rotation.x = -0.55 * ct;
              f.legR.rotation.x = 1.18 * ct;
            }
          }
          if (handled) continue;   // пост перекрывает работу/пешие маршруты
        }
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
            swingArmsIdle(f);
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
            swingArms(f, step);
            f.group.position.y += Math.abs(Math.sin(step)) * 0.03;
          }
        } else if (f.work) {
          // === ПОЛЕЗНАЯ РАБОТА: фигура НЕ стоит на месте ===
          const w = f.work;
          const legs = (spd: number) => {
            const step = time * spd * 7;
            if (f.legL && f.legR) {
              f.legL.rotation.x = Math.sin(step) * 0.55;
              f.legR.rotation.x = -Math.sin(step) * 0.55;
            }
            swingArms(f, step);
            return step;
          };
          if (w.kind === 'circle' && w.cx !== undefined && w.cz !== undefined && w.r !== undefined) {
            // шпиль: по кругу, навалившись на бар
            w.ang = (w.ang ?? 0) + (w.angSpd ?? 0.5) * dt;
            const ang = w.ang;
            const x = w.cx + Math.sin(ang) * w.r;
            const z = w.cz + Math.cos(ang) * w.r;
            f.group.position.set(x, deckYAt(z), z);
            // лицом по касательной (в сторону движения)
            const s = Math.sign(w.angSpd ?? 1);
            f.group.rotation.y = Math.atan2(Math.cos(ang) * s, -Math.sin(ang) * s);
            f.group.rotation.z = Math.sin(time * 2.1 + f.phase) * 0.045;
            f.group.rotation.x = 0.12; // наваливается на бар
            const step = legs(Math.abs(w.angSpd ?? 0.5) * w.r * 1.35);
            f.group.position.y += Math.abs(Math.sin(step)) * 0.03;
          } else if (w.pause > 0) {
            // пауза на конце маршрута: наклониться (работа) и обратно
            w.pause -= dt;
            const atA = w.pauseAt === 'a';
            const face = atA ? (w.faceA ?? 0) : (w.faceB ?? 0);
            // плавный доворот к цели работы
            let dy = face - f.group.rotation.y;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            f.group.rotation.y += dy * Math.min(1, dt * 4);
            const k = 1 - Math.max(0, w.pause) / Math.max(0.2, w.pauseDur);
            const lean = atA ? (w.leanA ?? 0) : (w.leanB ?? 0);
            f.group.rotation.x = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * lean;
            f.group.rotation.z = Math.sin(time * 1.3 + f.phase) * 0.03;
            if (f.legL && f.legR) { f.legL.rotation.x *= 0.8; f.legR.rotation.x *= 0.8; }
            if (w.pause <= 0) {
              f.group.rotation.x = 0;
              w.dir = -w.dir;
            }
          } else {
            // движение по маршруту a→b
            const A = w.a!, B = w.b!;
            const span = Math.max(0.5, A.distanceTo(B));
            w.t += (w.dir * w.speed * dt) / span;
            if (w.t >= 1) { w.t = 1; w.pause = w.pauseDur; w.pauseAt = 'b'; }
            else if (w.t <= 0) { w.t = 0; w.pause = w.pauseDur; w.pauseAt = 'a'; }
            const z = THREE.MathUtils.lerp(A.z, B.z, w.t);
            let x = THREE.MathUtils.lerp(A.x, B.x, w.t);
            if (w.hullFollow !== undefined) x = w.hullFollow * halfW(z);
            f.group.position.set(x, deckYAt(z), z);
            const dx = (B.x - A.x) * w.dir, dz = (B.z - A.z) * w.dir;
            f.group.rotation.y = Math.atan2(dx, dz);
            f.group.rotation.x = 0;
            f.group.rotation.z = 0;
            const step = legs(w.speed);
            f.group.position.y += Math.abs(Math.sin(step)) * 0.03;
          }
        } else {
          // idle: лёгкое покачивание (рулевой держит штурвал)
          const sway = Math.sin(time * 1.3 + f.phase) * 0.035;
          f.group.rotation.z = sway;
          if (f.role === 'helmsman') {
            // рулевой слегка налегает на штурвал по курсу
            f.group.rotation.x = 0.06 + Math.sin(time * 0.9 + f.phase) * 0.02;
          }
          swingArmsIdle(f);
        }
        // Task 40: КАПИТАН РАЗДАЁТ УКАЗАНИЯ — рука поднята, машет;
        // перекрывает позу роли (маррут/поворот продолжаются)
        if ((f.waveT ?? 0) > 0) {
          f.waveT = Math.max(0, (f.waveT ?? 0) - dt);
          if (f.armR || f.armL) {
            const arm = (f.armR ?? f.armL)!;
            arm.rotation.z = 2.55 + Math.sin(time * 9 + f.phase) * 0.3;
            arm.rotation.x = 0;
          } else {
            // кот-капитан: воодушевлённо прыгает на месте
            f.group.position.y += Math.abs(Math.sin(time * 9)) * 0.08;
          }
        }
      }
    },
  };
  return vis;
}
