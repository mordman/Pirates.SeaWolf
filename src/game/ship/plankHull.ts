// ============================================================
// Task 46/47: ДОЩАТЫЙ КОРПУС (модель v2, «на основе текущих»).
// Корабль собирается из НАСТОЯЩИХ ДОСОК — обшивка борта и палуба:
// каждая доска — отдельная запись с HP и 4 состояниями геометрии
// (та же точка пивота в центре доски):
//   State_0 — целая (HP > 75%);
//   State_1 — помятая (HP 75–50%): вмятина от ядра, трещины;
//   State_2 — сильно смятая (HP 50–15%): прогиб внутрь, расщепы,
//             светлая древесина на сколах;
//   State_3 — сломанная (HP < 15%): сквозной пролом — рваные
//             обломки у шпангоутов, виден внутренний каркас.
//
// Task 47 (по замечаниям игрока):
//   • НЕТ ЩЕЛЕЙ: пояса обшивки идут ВНАКРОЙ (clinker) — доска
//     выше ЗАХОДИТ на доску ниже с нахлёстом, нижняя кромка
//     каждого пояса выступает наружу (наклон поясья), у стыков
//     по длине — микронахлёст 6 мм;
//   • ПАЛУБА: доски лежат ПЛАШМЯ и идут ВДОЛЬ корабля (нос-корма),
//     колонки с нахлёстом 2.5 см, кромка уходит ПОД обшивку борта;
//   • ТРАНЕЦ (задник): корма выше среза закрыта дощатой стеной
//     (клинкерные пояса, наклон-развал кормы), стык с бортами
//     заправлен под обшивку;
//   • КВАРТЕРДЕК: настил из таких же досок на своём уровне
//     (для судов с кормовой надстройкой);
//   • ПРОЧНОСТЬ ДОСОК — в настройках (setPlankRules: hpMul).
//
// ПРОГРАММНЫЙ ДОСТУП (вместо Plank_[ID]_State_N в сцене —
// слияние в 4 меша ради производительности):
//   визуальная группа 'Hull_Planks'.userData.planks → PlankRec[]
//   (у каждой записи id 'Plank_P07_12' / 'Plank_D3_04' / 'Plank_T02_01',
//   state 0..3, hp, координаты); PlankSystem.plankById(id).
// Меши: Planks_Port / Planks_Starboard / Planks_Deck(+квартердэк) /
// Planks_Transom. Разрушение — ТОЛЬКО от нескольких попаданий:
// одно ядро даёт доске ~25–40 урона из 100 HP (3 прямых = слом).
// ============================================================
import * as THREE from 'three';
import { ShipPreset, hullProfile, hullHalfWidthAt, quarterFrontZ } from './buildShip';
import { applyPlankShader, plankPaint } from './woodShader';
import { mulberry32 } from './crew';

export interface PlankRec {
  id: string;
  cls: 0 | 1 | 2;       // 0 — борт, 1 — палуба/квартердэк, 2 — транец
  side: -1 | 1;         // борт: +1 порт (+X), −1 штирборт; палуба: side по x
  y: number;            // центр (борт/транец: высота; палуба: уровень палубы)
  z: number;
  x: number;            // палуба/транец: центр колонки
  len: number;          // длина (борт: вдоль корпуса; транец: поперёк)
  w: number;            // ширина поясья/доски палубы
  thick: number;
  quat: THREE.Quaternion;
  center: THREE.Vector3; // в координатах корабля
  tone: number;        // разброс тона живой доски
  color: THREE.Color;  // базовый цвет (с учётом подводной части)
  state: 0 | 1 | 2 | 3;
  hp: number;          // 100..0
  belowWL: boolean;
  /** Task 82: форма доски в шаблоне (доли ширины w): [k0, k1] — во
   *  сколько раз сужена НАРУЖНАЯ половина сечения у кормового/носового
   *  торца (кромка настила следует обводу корпуса), [sh0, sh1] — сдвиг
   *  всего сечения у торцов (ватервейс — параллелограмм по обводу) */
  shape?: [number, number, number, number];
  /** Task 82: seed доски для процедурной древесины (0..1, из id) */
  seed?: number;
  /** каскад «панель вырвано» уже разыгран для этой доски */
  cascadeHit?: boolean;
  /** мировая точка (заполняет Ship при создании FX) */
  world?: THREE.Vector3;
}

// ---------- правила прочности (настройки, Task 47) ----------
export interface PlankRules {
  /** прочность досок: >1 — прочнее (урон делится), <1 — хрупче */
  hpMul: number;
}
const PLANK_RULES: PlankRules = { hpMul: 1 };
export function setPlankRules(r: Partial<PlankRules>) {
  if (typeof r.hpMul === 'number' && isFinite(r.hpMul) && r.hpMul > 0) {
    PLANK_RULES.hpMul = r.hpMul;
  }
}

/** разрез гладкого корпуса: выше этой линии борта — доски */
export function plankCutY(P: ShipPreset): number {
  return -P.draft * 0.62;
}

// ---------- геометрия поясов/досок (метры) ----------
/** высота доски поясья обшивки */
const STRAKE_W = 0.48;
/** шаг поясов: МЕНЬШЕ высоты доски → нахлёст 6 см (внакрой, Task 49:
 *  ослаблен с 8 см — сплошная «чешуя» на рельефе убавлена) */
const STRAKE_PITCH = 0.42;
/** наклон поясья вокруг оси длины: нижняя кромка НАРУЖУ —
 *  видимая линия нахлёста, как у настоящей клинкерной обшивки.
 *  Task 49: 0.20 → 0.09 — рельеф «чешуёк» заметно мягче */
const LAP_TILT = 0.09;
/** Task 82: насколько верхняя кромка верхнего пояса заходит ПОД
 *  планширь (планширь перекрывает её на 4.5 см — щели под ним нет) */
const RAIL_LAP = 0.015;
/** Task 82: ширина/толщина ватервейса — тяжёлой доски вдоль борта
 *  поверх настила (закрывает стык палубы с обшивкой) */
const WATERWAY_W = 0.30;
const WATERWAY_T = 0.05;
/** Task 82: минимальная ширина суженной палубной доски у торца */
const DECK_MIN_W = 0.10;
/** Task 82: стена транца — шпация (доля L от кормы) и рая: z низа/верха
 *  стены в долях L (верх отступает в корму — развал кормы) */
const TRANSOM_T = 0.035;
const TRANSOM_Z_BOT = -0.470;
export const TRANSOM_Z_TOP = -0.484;
/** ширина доски палубы */
const DECK_W = 0.385;
/** шаг колонок палубы: нахлёст 2.5 см поперёк */
const DECK_STEP = 0.36;
/** нахлёст торцов соседних досок по линии стыка */
const END_LAP = 0.006;
/** микровариация наружной плоскости соседних досок (анти-мерцание
 *  совпадающих граней в зоне нахлёста — вместо z-fighting шаг) */
const EDGE_ALT = 0.0007;

// ---------- шаблоны геометрии (единица: доска 1×1×1, центр 0) ----------
// x — ТОЛЩИНА (нормаль наружу), y — ВЫСОТА поясья, z — ДЛИНА.
interface Tpl { pos: Float32Array; uv: Float32Array; col: Float32Array; idx: Uint16Array }

/** bake: может сдвинуть вершину v; возвращает [r,g,b]-множитель цвета вершины */
function tplFrom(geo: THREE.BufferGeometry, bake: (v: THREE.Vector3) => [number, number, number] | null): Tpl {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  const u = g.attributes.uv as THREE.BufferAttribute;
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  const v = new THREE.Vector3();
  const one: [number, number, number] = [1, 1, 1];
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const cm = bake(v) ?? one;
    pos.push(v.x, v.y, v.z);
    uv.push(u.getX(i), u.getY(i));
    col.push(cm[0], cm[1], cm[2]);
  }
  const idx = new Uint16Array(p.count);
  for (let i = 0; i < p.count; i++) idx[i] = i;
  return {
    pos: new Float32Array(pos), uv: new Float32Array(uv),
    col: new Float32Array(col),
    idx,
  };
}

let TEMPLATES: Tpl[] | null = null;

function templates(): Tpl[] {
  if (TEMPLATES) return TEMPLATES;
  // State_0: целая доска
  const t0 = tplFrom(new THREE.BoxGeometry(1, 1, 1), () => null);
  // State_1: помятая — средние ряды вдавлены внутрь (−0.45 ед.),
  // потемнение вмятины
  const t1 = tplFrom(new THREE.BoxGeometry(1, 1, 1, 1, 3, 1), v => {
    if (v.x > 0.49 && Math.abs(v.y) < 0.21) {
      v.x -= 0.45;
      return [0.7, 0.7, 0.72];
    }
    return null;
  });
  // State_2: сильно смятая — глубокий прогиб (до 0.75), сдвиг по
  // длине (сдвиг), сужение лопнувшей доски, СВЕТЛАЯ древесина на
  // сколах + тёмная трещина
  const t2 = tplFrom(new THREE.BoxGeometry(1, 1, 1, 1, 5, 1), v => {
    if (v.x > 0.49) {
      const a = Math.abs(v.y);
      if (a < 0.12) {          // центральные ряды — вглубь сильнее всего
        v.x -= 0.75; v.z += v.y * 0.5; v.y *= 0.88;
        return [1.38, 1.34, 1.24];   // светлое дерево скола
      }
      if (a < 0.32) {          // соседние — чуть меньше
        v.x -= 0.5; v.y *= 0.93;
        return [0.6, 0.56, 0.5];     // тёмная трещина
      }
      if (v.y < 0) {           // асимметрия удара (ниже центра)
        v.x -= 0.34;
        return [1.2, 1.16, 1.08];
      }
    }
    return null;
  });
  // State_3: сломанная — только рваные огрызки у шпангоутов
  // (торцы досок) + пара торчащих щепок; скол на внутренних
  // кромках — СВЕТЛЫЙ (свежий излом)
  {
    const pos: number[] = [], col: number[] = [], uv: number[] = [];
    for (const zc of [0.28, -0.28] as const) {
      const g = new THREE.BoxGeometry(1, 1, 0.42).toNonIndexed();
      const p = g.attributes.position as THREE.BufferAttribute;
      const u = g.attributes.uv as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i));
        v.z += zc;
        const inner = Math.sign(zc) * v.z < 0.1; // кромка к разлому
        if (inner) {
          v.x -= 0.34;          // рваный наклон внутрь
          v.y += v.x > 0 ? 0.1 : -0.08;
          col.push(1.5, 1.46, 1.34);   // светлая древесина излома
        } else {
          col.push(0.82, 0.8, 0.76);   // выгоревший огрызок
        }
        pos.push(v.x, v.y, v.z);
        uv.push(u.getX(i), u.getY(i));
      }
    }
    // торчащие щепки у разлома (наружу от борта)
    for (const [sy, rot] of [[-0.18, 0.7], [0.14, -0.5]] as const) {
      const g = new THREE.BoxGeometry(0.55, 0.1, 0.035).toNonIndexed();
      const p = g.attributes.position as THREE.BufferAttribute;
      const u = g.attributes.uv as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i));
        const nx = v.x * Math.cos(rot) - v.y * Math.sin(rot) * 0.4 + 0.42;
        const ny = v.x * Math.sin(rot) * 0.6 + v.y * Math.cos(rot) + sy;
        v.set(nx, ny, v.z);
        pos.push(v.x, v.y, v.z);
        uv.push(u.getX(i), u.getY(i));
        col.push(1.42, 1.36, 1.22);
      }
    }
    const idx3 = new Uint16Array(pos.length / 3);
    for (let i = 0; i < idx3.length; i++) idx3[i] = i;
    const t3: Tpl = {
      pos: new Float32Array(pos), uv: new Float32Array(uv),
      col: new Float32Array(col), idx: idx3,
    };
    TEMPLATES = [t0, t1, t2, t3];
  }
  return TEMPLATES!;
}

// ---------- базис поверхности борта ----------
const _m = new THREE.Matrix4();

/** наружная нормаль и касательная поясья в точке (t по длине, y) */
function sideBasis(P: ShipPreset, t: number, y: number, side: 1 | -1,
  outN: THREE.Vector3, outT: THREE.Vector3) {
  const d = 0.17;
  const hw1 = hullHalfWidthAt(P, t, Math.min(y + d, P.freeboard));
  const hw0 = hullHalfWidthAt(P, t, Math.max(y - d, -P.draft * 0.9));
  const s = (hw1 - hw0) / (2 * d);        // d(полуширина)/dy — развал борта
  const len = Math.hypot(1, s);
  // касательная поясья (вверх по борту с развалами) и нормаль наружу
  outT.set(side * s / len, 1 / len, 0);
  outN.set(side / len, -s / len, 0);
}

// ============================================================
// PlankSystem: доски одного корабля
// ============================================================
export interface PlankDamageResult {
  changed: number;        // сколько досок сменили состояние
  broken: PlankRec[];     // ТОЛЬКО что сломанные (State_3)
  cascade: boolean;       // вырвало панель обшивки (≥6 в зоне)
}

export class PlankSystem {
  readonly group = new THREE.Group();          // 'Hull_Planks'
  readonly records: PlankRec[] = [];
  readonly mat: THREE.MeshStandardMaterial;
  private meshes: THREE.Mesh[] = [];           // [порт, штирборт, палуба, транец]
  private recsByMesh: PlankRec[][] = [];
  private brokenBelowWL: PlankRec[] = [];

  constructor(P: ShipPreset) {
    this.group.name = 'Hull_Planks';
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0.03,
      // Task 82: обратные грани досок = внутренняя поверхность борта
      // (фальшборт изнутри, стены проломов) — сквозь узкие щели у
      // кромки настила видно дерево, а не море
      side: THREE.DoubleSide,
    });
    // Task 82: процедурная древесина — волокна, пазы, нагели, окраска
    // поясов, порты, ватерлиния (атрибуты досок пишет rebuild)
    applyPlankShader(this.mat, plankPaint(P));
    this.buildSides(P);
    this.buildDeck(P);
    this.buildQuarterdeck(P);
    this.buildTransom(P);
    this.group.userData.planks = this.records;
    this.group.userData.plankById = (id: string) => this.plankById(id);
  }

  plankById(id: string): PlankRec | null {
    return this.records.find(r => r.id === id) ?? null;
  }

  byState() {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, d3 = 0;
    for (const r of this.records) {
      if (r.state === 0) s0++; else if (r.state === 1) s1++;
      else if (r.state === 2) s2++;
      else { s3++; if (r.cls === 1) d3++; }
    }
    return { total: this.records.length, s0, s1, s2, s3, deckBroken: d3 };
  }

  belowWLBroken(): PlankRec[] { return this.brokenBelowWL; }

  /** Task 80: насколько борт УЖЕ ПРОБИТ в точке (y, z)? Доля досок
   *  в радиусе r вокруг точки, сломанных ДОСКОНЧАТЕЛЬНО (State_3 —
   *  сквозной пролом). 0 — свежий борт (ядро застревает), ≥0.45 —
   *  решето: ядро ПРОЛЕТАЕТ ВНУТРЬ корпуса и бьёт в противоположный
   *  борт (реалистичное пробитие насквозь). */
  sideOpen(side: 1 | -1, y: number, z: number, r = 1.9): number {
    const arr = this.recsByMesh[side === 1 ? 0 : 1];
    if (!arr.length) return 0;
    let near = 0, broken = 0;
    for (const rec of arr) {
      if (rec.state !== 3 && rec.hp > 15) { if (this.rectDist(rec, y, z) < r) near++; }
      else if (this.rectDist(rec, y, z) < r) { near++; broken++; }
    }
    return near > 0 ? broken / near : 0;
  }

  /** Task 49: геометрия поясов (телеметрия e2e: нахлёст/наклон/тон) */
  geomInfo() {
    return {
      strakeW: STRAKE_W, strakePitch: STRAKE_PITCH, lapTilt: LAP_TILT,
      overlap: +(STRAKE_W - STRAKE_PITCH).toFixed(3),
      deckStep: DECK_STEP,
    };
  }

  /** полный сброс (clearDamage): все доски целы */
  reset() {
    for (const r of this.records) {
      r.state = 0;
      r.hp = 100;
      r.cascadeHit = false;
    }
    this.brokenBelowWL.length = 0;
    this.rebuildAll();
  }

  // ============================================================
  // БОРТА: пояса ВНАКРОЙ — шаг поясов МЕНЬШЕ высоты доски
  // (нахлёст 8 см), каждый пояс наклонён (нижняя кромка наружу —
  // линия нахлёста читается как у настоящей обшивки). Каждая доска
  // — ХОРДА кривой корпуса: обе кромки стыка лежат НА поверхности,
  // у оконечностей (сильная кривизна) доски автоматически КОРОЧЕ —
  // обшивка следует обводам без ступеней и щелей.
  // ============================================================
  private buildSides(P: ShipPreset) {
    let idN = 0;
    const L = P.length;
    const yCut = plankCutY(P);
    const rnd = mulberry32(this.seedOf(P) ^ 0x2f13);
    const zA = -L * 0.478, zB = L * 0.472;
    const zAxis = new THREE.Vector3(0, 0, 1);
    // Task 82: верхний пояс идёт ПОД планширем по всей длине. Планширь
    // следует седловатости фальшборта (у миделя ниже, к носу и корме
    // выше), поэтому пояса «расходятся» к оконечностям: высота пояса k
    // в шпации z равна y0 + k·pitch(z). Прежде верхний пояс обрывался
    // на постоянной высоте bulwark(0.5) − 0.10, и между ним и планширем
    // оставалась сквозная щель до 1.1 м — фальшборт просвечивал.
    const y0 = yCut - 0.01 + STRAKE_W / 2;              // центр нижнего пояса
    const topC = (z: number) =>
      hullProfile((z + L / 2) / L, P).bulwark - RAIL_LAP - STRAKE_W / 2;
    let topMax = -Infinity;
    for (let i = 0; i <= 32; i++) {
      topMax = Math.max(topMax, topC(THREE.MathUtils.lerp(zA, zB, i / 32)));
    }
    // число поясов: у самого высокого фальшборта шаг ≤ STRAKE_PITCH
    // (нахлёст ≥ 6 см); у миделя шаг меньше — нахлёст больше
    const nStr = Math.max(3, Math.ceil((topMax - y0) / STRAKE_PITCH) + 1);
    const qTilt = new THREE.Quaternion().setFromAxisAngle(zAxis, LAP_TILT);
    const N = new THREE.Vector3(), T = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const X = new THREE.Vector3(), Yv = new THREE.Vector3(), Zc = new THREE.Vector3();
    for (const s of [1, -1] as const) {
      for (let k = 0; k < nStr; k++) {
        // номинальный уровень пояса (шаг 0.42 — урон и аудиты) и его
        // ФАКТИЧЕСКАЯ высота в шпации z
        const yNom = y0 + k * STRAKE_PITCH;
        const yAt = (z: number) => y0 + (k * (topC(z) - y0)) / (nStr - 1);
        const thick = yAt(0) < 0.05 ? 0.105 : 0.09;
        // наружная плоскость пояса (линия хорд): отступ от обвода
        const offAt = (z: number) => {
          const hw = hullHalfWidthAt(P, (z + L / 2) / L, yAt(z));
          return Math.max(hw, 0.30) + thick * 0.30;
        };
        // разбежка стыков: у нечётных поясов первая доска короче
        const stagger = (k % 2) * 0.78;
        let planLen = stagger > 0 ? Math.max(0.5, 1.52 - stagger) : 1.52;
        let z0 = zA;                  // кормовая кромка очередной доски
        let j = 0;
        while (z0 < zB - 0.02) {
          const step = Math.min(planLen, zB - z0);
          // у оконечностей корпус сужается быстро — РЕЗАТЬ короче,
          // чтобы хорда следовала кривизне (как у настоящих корпусов)
          const dhw = Math.abs(offAt(z0 + step) - offAt(z0)) / Math.max(step, 0.01);
          const maxStep = Math.max(0.55, 0.26 / Math.max(0.05, dhw));
          const stepK = Math.min(step, maxStep);
          if (stepK < 0.45) break;
          const z1 = z0 + stepK;
          // хорда P0→P1 по наружной плоскости пояса (с подъёмом по
          // седловатости: концы доски лежат на поверхности корпуса)
          const x0 = s * offAt(z0), x1 = s * offAt(z1);
          const ya = yAt(z0), yb = yAt(z1);
          const zm = (z0 + z1) / 2, ym = (ya + yb) / 2;
          const len = Math.hypot(x1 - x0, yb - ya, z1 - z0);
          // базис: длина — по хорде, наружу — нормаль обвода в середине
          // (ортогонализация: N⊥Z всегда)
          sideBasis(P, (zm + L / 2) / L, ym, s, N, T);
          // хорда: на штирборте — от носа К КОРМЕ (множитель s). Тогда
          // ось Y доски (высота) смотрит ВВЕРХ на обоих бортах, и один
          // наклон даёт одинаковый нахлёст «нижняя кромка наружу»
          // (Task 82: прежде на штирборте он был зеркальным)
          Zc.set((x1 - x0) * s, (yb - ya) * s, (z1 - z0) * s).normalize();
          X.copy(N).addScaledVector(Zc, -N.dot(Zc)).normalize();
          Yv.crossVectors(Zc, X);
          _m.makeBasis(X, Yv, Zc);
          q.setFromRotationMatrix(_m);
          q.multiply(qTilt);                       // внакрой: кромка наружу
          // центр: наклонённая наружная грань проходит по хорде
          const center = new THREE.Vector3((x0 + x1) / 2, ym, zm)
            .addScaledVector(X, -Math.cos(LAP_TILT) * thick / 2 + (j % 2) * EDGE_ALT)
            .addScaledVector(Yv, -Math.sin(LAP_TILT) * thick / 2);
          const tone = 0.93 + rnd() * 0.14;   // Task 49: ±7% (было ±14% — «шахматы»)
          const color = new THREE.Color(P.colors.hull);
          const below = ym < 0.05;
          if (below) {
            const f = Math.min(1, (0.05 - ym) / Math.max(0.8, P.draft * 0.45));
            color.lerp(new THREE.Color(0x33402a), f * 0.82);
          }
          idN++;
          this.records.push({
            id: `Plank_${s > 0 ? 'P' : 'S'}${String(k).padStart(2, '0')}_${String(idN).padStart(3, '0')}`,
            cls: 0, side: s, y: yNom, z: zm, x: 0, len,
            w: STRAKE_W, thick, quat: q.clone(),
            center,
            tone, color, state: 0, hp: 100, belowWL: below,
          });
          // следующая доска: стык с микронахлёстом (без щели)
          z0 = z1 - END_LAP;
          planLen = 1.52;
          j++;
        }
      }
    }
  }

  // ============================================================
  // ПАЛУБА (главный настил): доски лежат ПЛАШМЯ и идут ВДОЛЬ
  // корабля (нос-корма). Колонки шириной 0.385 с шагом 0.36 —
  // нахлёст 2.5 см поперёк; по длине — микронахлёст стыков;
  // разбежка стыков между колонками. Кромка настила уходит ПОД
  // обшивку борта (край колонки заправлен внутрь пояса), вдоль борта
  // поверх стыка — ватервейс (Task 82).
  // ============================================================
  private buildDeck(P: ShipPreset) {
    const L = P.length;
    const deckY = (z: number) => hullProfile((z + L / 2) / L, P).bulwark - 1.0;
    // главный настил: от квартердека (если есть) до сужения в носу;
    // без квартердека — от стены транца: стена наклонена (развальна),
    // её положение на высоте палубы считаем по линии рая и заправляем
    // кромку настила ПОД её доски
    let zFrom: number;
    if (P.quarter) {
      zFrom = quarterFrontZ(P) + 0.06;
    } else {
      const y0 = plankCutY(P) - 0.01 + STRAKE_W / 2;
      const yTopC = hullProfile(TRANSOM_T, P).bulwark - RAIL_LAP - STRAKE_W / 2;
      const f = THREE.MathUtils.clamp((deckY(-L * 0.47) - y0) / (yTopC - y0), 0, 1);
      zFrom = THREE.MathUtils.lerp(TRANSOM_Z_BOT, TRANSOM_Z_TOP, f) * L + 0.025;
    }
    const zTo = L * 0.44;
    // inset: зазор от обвода до кромки — на 4.5 см внутрь корпуса,
    // т.е. кромка сидит ВНУТРИ толщины пояса обшивки (наружная грань
    // пояса на +2.7 см от обвода, внутренняя на −6.3 см)
    this.buildDeckArea(P, zFrom, zTo, deckY, 'D', 0.045);
    this.buildWaterway(P, zFrom, zTo, deckY, 0.04);
  }

  // ============================================================
  // КВАРТЕРДЕК: настил из таких же досок на СВОЁМ уровне
  // (deckY + высота надстройки), от транца до передней кромки.
  // Кромки заправлены под гладкие стенки надстройки.
  // ============================================================
  private buildQuarterdeck(P: ShipPreset) {
    if (!P.quarter) return;
    const L = P.length;
    const q = P.quarter;
    const deckY = (z: number) => hullProfile((z + L / 2) / L, P).bulwark - 1.0;
    const floorY = (z: number) => deckY(z) + q;
    const sternZ = -L / 2 + Math.max(0.35, L * 0.012);
    // стенки надстройки: от hw − 0.15 до hw + 0.11 — кромка настила
    // заканчивается внутри их толщины (inset 0.145)
    this.buildDeckArea(P, sternZ, quarterFrontZ(P) - 0.02, floorY, 'Q', 0.145);
  }

  /** общий настил: продольные доски колонками с нахлёстом.
   *  Верхняя грань каждой доски — ХОРДА седловатости палубы
   *  (продольного изгиба): соседние доски колонки сходятся на
   *  самой кривой, без ступеней на стыках у оконечностей.
   *  Task 82: наружная кромка досок крайних колонок СУЖАЕТСЯ по
   *  обводу корпуса (форма сечения в записи — shape). Прежде колонка
   *  допускалась, если обвод в СЕРЕДИНЕ доски был шире её центра:
   *  прямая доска у носа, где корпус сужается на 20–27 см/м, торчала
   *  концами сквозь обшивку — на борту светились «плашки» палубы.
   *  Теперь на 5 сечениях доски считается доступная ширина; кромка
   *  идёт по хорде, заведённой внутрь на величину прогиба обвода. */
  private buildDeckArea(
    P: ShipPreset, zFrom: number, zTo: number,
    yAt: (z: number) => number, tag: string, inset: number,
  ) {
    const L = P.length;
    const rnd = mulberry32(this.seedOf(P) ^ (tag === 'D' ? 0x51d7 : 0x71a3));
    const half = DECK_W / 2;
    // предел НАРУЖНОЙ кромки: обвод корпуса на высоте палубы минус зазор
    const limAt = (z: number) =>
      hullHalfWidthAt(P, (z + L / 2) / L, yAt(z)) - inset;
    const midW = hullHalfWidthAt(P, 0.5, yAt(0));
    const nCols = Math.max(3, Math.floor((midW * 2 + 0.2) / DECK_STEP));
    const fullLen = 1.98;
    // поворот плашмя: толщина — вертикаль, ширина — поперёк, длина — вдоль
    const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const qPitch = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    /** помещается ли доска колонки |x| = ax на участке [za, zb]:
     *  возвращает сужение наружной половины у торцов [k0, k1]
     *  (1 — полная ширина) либо null — не помещается */
    const fit = (ax: number, za: number, zb: number): [number, number] | null => {
      const inner = ax - half;              // внутренняя кромка (не сужается)
      const n = 5;
      const outs: number[] = [];
      for (let i = 0; i <= n; i++) {
        outs.push(Math.min(DECK_W, limAt(za + (zb - za) * i / n) - inner));
      }
      let e0 = outs[0], e1 = outs[n];
      // обвод между торцами может отойти от хорды — кромку заводим
      // внутрь на наибольшее отклонение
      let sag = 0;
      for (let i = 1; i < n; i++) {
        sag = Math.max(sag, e0 + (e1 - e0) * i / n - outs[i]);
      }
      e0 -= sag; e1 -= sag;
      if (Math.min(e0, e1) < DECK_MIN_W) return null;
      return [Math.min(1, (2 * e0) / DECK_W - 1), Math.min(1, (2 * e1) / DECK_W - 1)];
    };
    // колонки — ОТ СЕРЕДИНЫ к бортам: первые записи настила — длинные
    // полноразмерные доски (их смотрят аудиты и e2e)
    const mid = (nCols - 1) / 2;
    const order: number[] = [];
    for (let d = 0; d < nCols; d++) {
      order.push(d % 2 === 0 ? Math.ceil(mid) + d / 2 : Math.floor(mid) - (d - 1) / 2);
    }
    for (const c of order) {
      const x = (c - mid) * DECK_STEP;
      const ax = Math.abs(x);
      const stagger = (Math.abs(c) % 2) * 0.95;
      let planLen = stagger > 0 ? Math.max(0.55, fullLen - stagger) : fullLen;
      let z0 = zFrom;
      let i = 0;
      while (z0 < zTo - 0.02) {
        let lenK = Math.min(planLen, zTo - z0);
        let kp = fit(ax, z0, z0 + lenK);
        if (!kp) {
          if (i === 0) {
            // у кормы корпус уже — колонка начнётся дальше к носу
            z0 += 0.4;
            continue;
          }
          // к носу корпус сужается — укорачиваем доску, пока кромка
          // не вместится (мин. длина 0.46)
          while (!kp && lenK > 0.46) {
            lenK = Math.max(0.46, lenK * 0.72);
            kp = fit(ax, z0, z0 + lenK);
          }
          if (!kp) break;                   // колонка закончилась
        }
        const z1 = z0 + lenK;
        const z = (z0 + z1) / 2;
        const ym = (yAt(z0) + yAt(z1)) / 2;
        const tone = 0.94 + rnd() * 0.12;   // Task 49: ±6% (было ±12%)
        // наклон по хорде седловатости (стык без ступени)
        const pitch = Math.atan2(yAt(z1) - yAt(z0), z1 - z0);
        const quat = qFlat.clone().multiply(qPitch.setFromAxisAngle(yAxis, pitch));
        this.records.push({
          id: `Plank_${tag}${String(c).padStart(2, '0')}_${String(this.records.length).padStart(3, '0')}`,
          cls: 1, side: x >= 0 ? 1 : -1, y: ym, z, x,
          len: Math.hypot(z1 - z0, yAt(z1) - yAt(z0)), w: DECK_W, thick: 0.075,
          quat,
          // верхняя грань — по хорде; микровариация высоты соседних
          // досок — вместо мерцания совпадающих граней в нахлёсте
          center: new THREE.Vector3(x, ym - 0.0375 + ((c + i) % 2) * 0.0008, z),
          shape: [kp[0], kp[1], 0, 0],
          tone, color: new THREE.Color(P.colors.deck), state: 0, hp: 100,
          belowWL: false,
        });
        // следующая доска колонки: стык с микронахлёстом
        z0 = z1 - END_LAP;
        planLen = fullLen;
        i++;
      }
    }
  }

  // ============================================================
  // ВАТЕРВЕЙС (Task 82): тяжёлая доска ВДОЛЬ борта поверх настила —
  // закрывает стык палубы с обшивкой (на настоящих судах именно она
  // держит воду и связывает палубный набор с обшивкой). Сечение —
  // параллелограмм: наружная кромка следует обводу, внутренняя
  // параллельна ей (shape: сдвиг сечения). Класс 1 (настил): та же
  // окраска/урон, хранится в меше палубы.
  // ============================================================
  private buildWaterway(
    P: ShipPreset, zFrom: number, zTo: number,
    yAt: (z: number) => number, inset: number,
  ) {
    const L = P.length;
    const rnd = mulberry32(this.seedOf(P) ^ 0x3b9d);
    const W = WATERWAY_W, T = WATERWAY_T, half = W / 2;
    // наружная кромка — по обводу на высоте ВЕРХА ватервейса
    const outAt = (z: number) =>
      hullHalfWidthAt(P, (z + L / 2) / L, yAt(z) + T) - inset;
    const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const qPitch = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    // x записей — уникальны с точностью до мм и не совпадают с сеткой
    // колонок настила (аудиты группируют записи настила по x)
    const used = new Set<number>();
    for (let k = 0; k < 400; k++) used.add(k * 180);
    for (let k = 1; k < 400; k++) used.add(-k * 180);
    for (const s of [1, -1] as const) {
      let z0 = zFrom;
      let j = 0;
      while (z0 < zTo - 0.02) {
        const step = Math.min(1.6, zTo - z0);
        // у оконечностей корпус сужается быстро — куски короче
        const dhw = Math.abs(outAt(z0 + step) - outAt(z0)) / Math.max(step, 0.01);
        const stepK = Math.min(step, Math.max(0.5, 0.2 / Math.max(0.05, dhw)));
        const z1 = z0 + stepK;
        const o0 = outAt(z0), o1 = outAt(z1);
        // в носу ватервейс уже не помещается между обводом и
        // диаметральной плоскостью — борта не должны пересекаться
        if (Math.min(o0, o1) < half + 0.05) break;
        const mo = (o0 + o1) / 2;
        let xc = s * (mo - half);
        for (let n = 0; n < 60; n++) {
          const key = Math.round(xc * 1000);
          if (!used.has(key)) { used.add(key); break; }
          xc += s * 0.0015;
        }
        const ym = (yAt(z0) + yAt(z1)) / 2;
        const pitch = Math.atan2(yAt(z1) - yAt(z0), z1 - z0);
        const quat = qFlat.clone().multiply(qPitch.setFromAxisAngle(yAxis, pitch));
        // сдвиг сечения (в долях ширины): наружная кромка — на обводе
        const sh = (o: number) => (-s * 2 * (o - mo)) / W;
        this.records.push({
          id: `Plank_W${s > 0 ? 'P' : 'S'}_${String(this.records.length).padStart(3, '0')}`,
          cls: 1, side: s, y: ym, z: (z0 + z1) / 2, x: xc,
          len: Math.hypot(z1 - z0, yAt(z1) - yAt(z0)), w: W, thick: T,
          quat, shape: [1, 1, sh(o0), sh(o1)],
          center: new THREE.Vector3(xc, ym + T / 2 - 0.006 + (j % 2) * 0.0008, (z0 + z1) / 2),
          tone: 0.9 + rnd() * 0.1, color: new THREE.Color(P.colors.deck), state: 0, hp: 100,
          belowWL: false,
        });
        z0 = z1 - END_LAP;
        j++;
      }
    }
  }

  // ============================================================
  // ТРАНЕЦ (задник): корма выше среза закрыта ДОЩАТОЙ стеной —
  // те же клинкерные пояса (шаг/высота/наклон как у бортов),
  // развал кормы: верхние пояса отступают в корму. Стык с бортами
  // заправлен ПОД их обшивку. Поперёк — доски со стыками.
  // Task 82: верхний пояс доходит до планширя кормы (прежде стена
  // обрывалась на 12 см ниже — под планширем светилась щель).
  // ============================================================
  private buildTransom(P: ShipPreset) {
    const L = P.length;
    const yCut = plankCutY(P);
    const rnd = mulberry32(this.seedOf(P) ^ 0x9c2f);
    const tWall = TRANSOM_T;
    const zWallBot = TRANSOM_Z_BOT * L, zWallTop = TRANSOM_Z_TOP * L;
    const y0 = yCut - 0.01 + STRAKE_W / 2;
    const yTopC = hullProfile(tWall, P).bulwark - RAIL_LAP - STRAKE_W / 2;
    // шаг поясов ≤ STRAKE_PITCH, верхний пояс — точно под планширем
    const nStr = Math.max(3, Math.ceil((yTopC - y0) / STRAKE_PITCH) + 1);
    const pitchT = (yTopC - y0) / (nStr - 1);
    const zAxis = new THREE.Vector3(1, 0, 0);        // ось наклона поясья
    const qTilt = new THREE.Quaternion().setFromAxisAngle(zAxis, LAP_TILT);
    // базис: наружу — в корму (−Z), вверх — +Y, длина доски — +X
    _m.makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
      zAxis.clone(),
    );
    const qBase = new THREE.Quaternion().setFromRotationMatrix(_m);
    let idN = 0;
    for (let k = 0; k < nStr; k++) {
      const y = y0 + k * pitchT;
      const below = y < 0.05;
      const zk = THREE.MathUtils.lerp(zWallBot, zWallTop, k / Math.max(1, nStr - 1));
      const hwT = hullHalfWidthAt(P, tWall, y);
      // полуширина стены: с запасом 5 см под обшивку бортов
      const half = Math.max(hwT, 0.34) + 0.05;
      const width = half * 2;
      const nSplit = Math.max(1, Math.ceil(width / 1.4));
      const segLen = width / nSplit;
      const q = qBase.clone().multiply(qTilt);
      const thick = below ? 0.105 : 0.09;
      const tone = 0.93 + rnd() * 0.14;   // Task 49: ±7% (было ±13%)
      const color = new THREE.Color(P.colors.hull);
      if (below) {
        const f = Math.min(1, (0.05 - y) / Math.max(0.8, P.draft * 0.45));
        color.lerp(new THREE.Color(0x33402a), f * 0.82);
      }
      for (let p = 0; p < nSplit; p++) {
        const x0 = -half + p * segLen;
        const lenK = Math.min(segLen + END_LAP, half - x0); // нахлёст стыка
        if (lenK < 0.3) continue;
        idN++;
        this.records.push({
          id: `Plank_T${String(k).padStart(2, '0')}_${String(idN).padStart(3, '0')}`,
          cls: 2, side: x0 + lenK / 2 >= 0 ? 1 : -1, y, z: zk, x: x0 + segLen / 2,
          len: lenK, w: STRAKE_W, thick, quat: q,
          center: new THREE.Vector3(x0 + segLen / 2, y, zk + (p % 2) * EDGE_ALT),
          tone, color, state: 0, hp: 100, belowWL: below,
        });
      }
    }
  }

  private seedOf(P: ShipPreset): number {
    let h = 0;
    for (const ch of P.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return (h ^ Math.round(P.length * 7)) | 0;
  }

  // ---------- сборка мешей ----------
  finishBuild() {
    // вызвать один раз после раскладки: создаёт 4 меша
    const groups: PlankRec[][] = [
      this.records.filter(r => r.cls === 0 && r.side === 1),
      this.records.filter(r => r.cls === 0 && r.side === -1),
      this.records.filter(r => r.cls === 1),
      this.records.filter(r => r.cls === 2),
    ];
    this.recsByMesh = groups;
    const names = ['Planks_Port', 'Planks_Starboard', 'Planks_Deck', 'Planks_Transom'];
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
      mesh.name = names[i];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        class: i === 2 ? 'deck' : i === 3 ? 'transom' : 'side',
        planks: groups[i],
      };
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.rebuildAll();
  }

  rebuildAll() {
    for (let i = 0; i < this.meshes.length; i++) this.rebuild(i);
  }

  private rebuild(meshIdx: number) {
    const recs = this.recsByMesh[meshIdx];
    const mesh = this.meshes[meshIdx];
    const tpls = templates();
    let vCount = 0;
    for (const r of recs) vCount += tpls[r.state].pos.length / 3;
    const pos = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const col = new Float32Array(vCount * 3);
    const idx = new Uint16Array(vCount);
    // Task 82: параметры доски для шейдера древесины (на вершину)
    const aPlank = new Float32Array(vCount * 4);
    const aPlankN = new Float32Array(vCount * 4);
    const v = new THREE.Vector3();
    const pn = new THREE.Vector3();
    let vo = 0, io = 0;
    for (const r of recs) {
      const tp = tpls[r.state];
      _m.compose(r.center, r.quat, _vScale.set(r.thick, r.w, r.len));
      const n = tp.pos.length / 3;
      pn.set(1, 0, 0).applyQuaternion(r.quat);
      if (r.seed === undefined) {
        let h = 0;
        for (let c = 0; c < r.id.length; c++) h = (h * 31 + r.id.charCodeAt(c)) | 0;
        r.seed = ((h >>> 0) % 100003) / 100003;
      }
      for (let i = 0; i < n; i++) {
        v.set(tp.pos[i * 3], tp.pos[i * 3 + 1], tp.pos[i * 3 + 2]);
        const shp = r.shape;
        if (shp) {
          // Task 82: сужение наружной половины доски к торцу + сдвиг
          // всего сечения (ватервейс). Шаблон: +Y после поворота
          // плашмя → −X корабля, т.е. «наружу» для x ≥ 0 — это −Y
          const t01 = v.z + 0.5;
          if (v.y * (r.x >= 0 ? -1 : 1) > 0) v.y *= shp[0] + (shp[1] - shp[0]) * t01;
          v.y += 0.5 * (shp[2] + (shp[3] - shp[2]) * t01);
        }
        v.applyMatrix4(_m);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        uv[(vo + i) * 2] = tp.uv[i * 2] * r.len;
        uv[(vo + i) * 2 + 1] = tp.uv[i * 2 + 1] * r.w;
        // цвет доски = базовый × живой тон × множитель состояния
        const cm = tp.col[i * 3];
        col[(vo + i) * 3] = r.color.r * r.tone * cm;
        col[(vo + i) * 3 + 1] = r.color.g * r.tone * (tp.col[i * 3 + 1] ?? cm);
        col[(vo + i) * 3 + 2] = r.color.b * r.tone * (tp.col[i * 3 + 2] ?? cm);
        const a = (vo + i) * 4;
        aPlank[a] = r.w; aPlank[a + 1] = r.len; aPlank[a + 2] = r.seed; aPlank[a + 3] = r.cls;
        aPlankN[a] = pn.x; aPlankN[a + 1] = pn.y; aPlankN[a + 2] = pn.z; aPlankN[a + 3] = r.tone;
      }
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      vo += n; io += n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPlank', new THREE.BufferAttribute(aPlank, 4));
    g.setAttribute('aPlankN', new THREE.BufferAttribute(aPlankN, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();       // фасетные нормали: рёбра досок читаются
    mesh.geometry.dispose();
    mesh.geometry = g;
  }

  // ============================================================
  // УРОН (Task 48): удар вырезает в обшивке СПЛОШНУЮ дыру — как в
  // референсе (tearPlank): все доски, ТЕЛО которых попало в радиус
  // разрыва, ломаются ВМЕСТЕ с первой сломанной. Раньше урон шёл
  // по ЦЕНТРАМ досок — из-за разбежки стыков ломались доски через
  // одну и борт превращался в «шахматную доску».
  //  • дистанция — от ПРЯМОУГОЛЬНИКА доски (rectDist), не от центра:
  //    ядро, попавшее в кромку, ломает ЭТУ доску, а не соседнюю,
  //    чей центр оказался ближе;
  //  • прямой зоне (rectDist < R_TEAR) — полный урон; когда первая
  //    доска ломается, ВСЕ доски внутри R_TEAR вырываются с корнем —
  //    непрерывный пролом;
  //  • кольцо (R_TEAR..R_SPRAY) — частичный урон с спадом (вмятины
  //    → прогибы → следующее попадание расширяет дыру);
  //  • HP 100; state по HP: >75 → 0, 75–50 → 1, 50–15 → 2, ≤15 → 3.
  //  Прочность досок — из настроек (hpMul: урон и радиус разрыва).
  // ============================================================
  /** расстояние от точки (a,b) до ПРЯМОУГОЛЬНИКА доски в её
   *  плоскости (0 — точка внутри доски):
   *    борт (cls 0):   (a,b) = (y, z);  полуразмеры (w/2, len/2)
   *    палуба (cls 1): (a,b) = (x, z);  полуразмеры (w/2, len/2)
   *    транец (cls 2): (a,b) = (y, x);  полуразмеры (w/2, len/2) */
  private rectDist(r: PlankRec, a: number, b: number): number {
    const ha = r.w / 2, hb = r.len / 2;
    // палуба — по x; борт/транец — по y ФАКТИЧЕСКОГО центра (Task 82:
    // пояса борта следуют седловатости — их высота меняется по длине)
    const ca = r.cls === 1 ? r.x : r.center.y;
    const cb = r.cls === 2 ? r.x : r.z;   // транец — по x; борт/палуба — по z (вдоль!)
    const da = Math.abs(a - ca) - ha;
    const db = Math.abs(b - cb) - hb;
    return Math.hypot(da > 0 ? da : 0, db > 0 ? db : 0);
  }

  /** максимальный радиус урона от точки удара (кольцо щепы) */
  private sprayR(eff: number): number {
    return this.tearR(eff) + 1.05;
  }

  /** радиус СПЛОШНОГО разрыва при сломе (растёт с уроном ядра,
   *  падает с прочностью досок из настроек) */
  private tearR(eff: number): number {
    return 0.40 + Math.min(0.55, Math.max(0, eff) * 0.006);
  }

  damageSide(side: 1 | -1, y: number, z: number, dmg: number): PlankDamageResult {
    const hpMul = Math.max(0.05, PLANK_RULES.hpMul);
    const R = this.sprayR(dmg / hpMul);
    const cands = this.recsByMesh[side === 1 ? 0 : 1]
      .map(r => ({ r, d: this.rectDist(r, y, z) }))
      .filter(c => c.d < R)
      .sort((a, b) => a.d - b.d);
    return this.applyDamage(cands, dmg, y, z);
  }

  damageDeck(x: number, z: number, dmg: number): PlankDamageResult {
    const hpMul = Math.max(0.05, PLANK_RULES.hpMul);
    const R = this.sprayR(dmg / hpMul);
    const cands = this.recsByMesh[2]
      .map(r => ({ r, d: this.rectDist(r, x, z) }))
      .filter(c => c.d < R)
      .sort((a, b) => a.d - b.d);
    return this.applyDamage(cands, dmg, x, z);
  }

  /** попадание в ТРАНЕЦ: y — высота, x — точка по ширине кормы */
  damageTransom(y: number, x: number, dmg: number): PlankDamageResult {
    const hpMul = Math.max(0.05, PLANK_RULES.hpMul);
    const R = this.sprayR(dmg / hpMul);
    const cands = this.recsByMesh[3]
      .map(r => ({ r, d: this.rectDist(r, y, x) }))
      .filter(c => c.d < R)
      .sort((a, b) => a.d - b.d);
    return this.applyDamage(cands, dmg, y, x);
  }

  private applyDamage(cands: { r: PlankRec; d: number }[], dmg: number, y: number, z: number): PlankDamageResult {
    const res: PlankDamageResult = { changed: 0, broken: [], cascade: false };
    if (!cands.length) return res;
    const meshIdxOf = (r: PlankRec) => r.cls === 1 ? 2 : r.cls === 2 ? 3 : (r.side === 1 ? 0 : 1);
    const dirty = new Set<number>();
    // прочность досок из настроек: урон делится на множитель
    const hpMul = Math.max(0.05, PLANK_RULES.hpMul);
    const eff = dmg / hpMul;
    const R_TEAR = this.tearR(eff);
    const R_SPRAY = R_TEAR + 1.05;
    /** возвращает true, если ЭТОТ вызов сломал доску (state → 3) */
    const touch = (r: PlankRec, amount: number, forceBreak = false) => {
      if (amount <= 0 && !forceBreak) return false;
      r.hp = forceBreak ? 0 : Math.max(0, r.hp - amount);
      const st = (r.hp > 75 ? 0 : r.hp > 50 ? 1 : r.hp > 15 ? 2 : 3) as 0 | 1 | 2 | 3;
      if (st !== r.state) {
        r.state = st;
        res.changed++;
        dirty.add(meshIdxOf(r));
        if (st === 3) {
          res.broken.push(r);
          if (r.cls !== 1 && r.belowWL) {
            this.brokenBelowWL.push(r);
          }
          return true;
        }
      }
      return false;
    };
    // --- прямой зоне — полный урон, кольцу — с спадом (край дыры
    // подтачивается: 4-е попадание расширяет разрыв) ---
    let tore = false;
    for (const c of cands) {
      if (c.d >= R_SPRAY) break;
      if (c.d < R_TEAR) {
        if (touch(c.r, eff)) tore = true;
      } else {
        const fall = 1 - (c.d - R_TEAR) / (R_SPRAY - R_TEAR);
        touch(c.r, eff * (0.16 + 0.58 * fall));
      }
    }
    // ============================================================
    // СПЛОШНОЙ РАЗРЫВ (Task 48, по референсу tearPlank): первая
    // сломанная доска вырывается С КОРНЕМ — все доски, чьё тело в
    // радиусе R_TEAR от точки удара, уходят вместе с ней. Пролом
    // растёт НЕПРЕРЫВНО (все доски подряд), а не «через одну»
    // ============================================================
    if (tore) {
      for (const c of cands) {
        if (c.d < R_TEAR) touch(c.r, 0, true);
      }
    }
    // ============================================================
    // КАСКАД «ПАНЕЛЬ ОБШИВКИ ВЫРВАНО»: в зоне 2.2 м вокруг точки
    // УДАРА накоплено ≥12 СЛОМАННЫХ досок (Task 48: разрыв сам
    // даёт 8-10, порог поднят — раньше срабатывал с одного разрыва)
    // — оставшиеся доски зоны получают −46: дыра расширяется
    // СКАЧКОМ, панель отлетает целиком
    // ============================================================
    const mIdx = meshIdxOf(cands[0].r);
    const hitY = cands[0].r.cls === 1 ? cands[0].r.y : y;
    const zoneDist = (r: PlankRec) => r.cls === 1
      ? Math.hypot((r.x - cands[0].r.x) * 1.2, (r.z - z) * 0.9)
      : r.cls === 2
        ? Math.hypot((r.y - hitY) * 1.05, (r.x - z) * 0.75)
        : Math.hypot((r.y - hitY) * 1.05, (r.z - z) * 0.75);
    const inZone = this.recsByMesh[mIdx].filter(r => zoneDist(r) < 2.2);
    const brokenInZone = inZone.filter(r => r.state === 3).length;
    const zoneRest = inZone.filter(r => r.state < 3 && !r.cascadeHit);
    if (brokenInZone >= 12 && zoneRest.length) {
      for (const r of zoneRest) {
        r.cascadeHit = true;
        touch(r, 46 / hpMul);   // добивание соседей
      }
      res.cascade = true;
    }
    for (const mi of dirty) this.rebuild(mi);
    return res;
  }
}

const _vScale = new THREE.Vector3();

// ============================================================
// КАРКАС (Skeleton): киль, штевни, шпангоуты, бимсы, переборки,
// транец, груз — ОДНИМ мешем (неразрушаемый, виден сквозь проломы)
// ============================================================
export function buildSkeleton(P: ShipPreset): THREE.Group {
  const L = P.length;
  const group = new THREE.Group();
  group.name = 'Skeleton';
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const pushGeo = (geo: THREE.BufferGeometry, color: number, m: THREE.Matrix4) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      uv.push(u.getX(i), u.getY(i));
      col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < p.count; i++) idx.push(base + i);
  };

  const deckY = (z: number) => hullProfile((z + L / 2) / L, P).bulwark - 1.0;
  const yCut = plankCutY(P);
  const hw = (z: number, y: number) => hullHalfWidthAt(P, (z + L / 2) / L, y);

  const idq = new THREE.Quaternion();
  const mk = (geo: THREE.BufferGeometry, color: number,
    px: number, py: number, pz: number, sx: number, sy: number, sz: number,
    quat?: THREE.Quaternion) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz),
      quat ?? idq,
      _vScale.set(sx, sy, sz));
    pushGeo(geo, color, m);
  };

  // киль + кильсон
  const box = new THREE.BoxGeometry(1, 1, 1);
  mk(box, 0x352718, 0, -P.draft * 0.72, 0, 0.3, P.draft * 0.5, L * 0.94);
  mk(box, 0x4a3620, 0, -P.draft * 0.42, 0, 0.2, 0.14, L * 0.72);
  // штевни (форштевень / ахтерштевень) — вдоль линии подъёма
  const dirBox = (color: number, a: THREE.Vector3, b: THREE.Vector3, w: number) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mk(box, color, mid.x, mid.y, mid.z, w, len, w * 1.4, q);
  };
  const bowTop = hullProfile(1, P).bulwark;
  dirBox(0x352718,
    new THREE.Vector3(0, -P.draft * 0.5, L * 0.47),
    new THREE.Vector3(0, bowTop * 0.9, L * 0.52), 0.26);
  const sternTop = hullProfile(0, P).bulwark;
  dirBox(0x352718,
    new THREE.Vector3(0, -P.draft * 0.5, -L * 0.47),
    new THREE.Vector3(0, sternTop * 0.8, -L / 2 - 0.02), 0.24);

  // шпангоуты: 12 станций × 2 борта × 3 яруса (киль→срез, срез→палуба,
  // палуба→фальшборт) — по касательной борта
  const NFR = 12;
  const N = new THREE.Vector3(), T = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < NFR; i++) {
    const z = THREE.MathUtils.lerp(-L * 0.40, L * 0.40, i / (NFR - 1));
    const t = (z + L / 2) / L;
    const dY = deckY(z);
    for (const s of [1, -1] as const) {
      const seg = (y0: number, y1: number, inset: number) => {
        const ym = (y0 + y1) / 2;
        const len = y1 - y0 + 0.12;
        if (len < 0.25) return;
        sideBasis(P, t, ym, s, N, T);
        _m.makeBasis(N, T, Z);
        const q = new THREE.Quaternion().setFromRotationMatrix(_m);
        const off = Math.max(hw(z, ym), 0.3) - inset;
        mk(box, 0x4a3620, s * off, ym, z, 0.15, len, 0.16, q);
      };
      seg(-P.draft * 0.55, yCut, 0.13);
      seg(yCut, dY, 0.11);
      seg(dY, hullProfile(t, P).bulwark * 0.96, 0.09);
    }
  }
  // бимсы (поперечные балки) на уровне палубы
  for (let i = 0; i < 7; i++) {
    const z = THREE.MathUtils.lerp(-L * 0.30, L * 0.26, i / 6);
    const w = hw(z, deckY(z)) * 2 - 0.35;
    mk(box, 0x5a432c, 0, deckY(z) - 0.11, z, w, 0.17, 0.22);
  }
  // переборки отсеков (тройные: границы 4 рядов по длине)
  const wall = new THREE.PlaneGeometry(1, 1);
  for (const fz of [-L * 0.25, 0, L * 0.25]) {
    const t = (fz + L / 2) / L;
    const w = hw(fz, deckY(fz)) * 2 * 0.82;
    const h = deckY(fz) - yCut - 0.08;
    if (h < 0.4) continue;
    const qy = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    mk(wall, 0x40301f, 0, (yCut + deckY(fz)) / 2 + 0.02, fz, w, h, 1, qy);
  }
  // транцевая стена (закрывает корму выше среза)
  {
    const w = hw(-L / 2, deckY(-L / 2)) * 2 * 0.88;
    const h = deckY(-L * 0.44) - yCut + 0.5;
    const qy = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    mk(wall, 0x3a2c1e, 0, (yCut + 0.1 + deckY(-L * 0.44)) / 2 + 0.2, -L / 2 + 0.30, w, h, 1, qy);
  }
  // груз в трюме: кипы + бочки (видны в проломы)
  const crate = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const rnd = mulberry32((P.length * 131) | 0);
  for (let i = 0; i < 6; i++) {
    const z = THREE.MathUtils.lerp(-L * 0.18, L * 0.14, rnd());
    const x = (rnd() - 0.5) * Math.max(0.4, hw(z, yCut + 0.4) * 1.1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 0.5, 0));
    mk(crate, i % 2 ? 0x6a5236 : 0x7a5a3a, x, yCut + 0.33, z, 0.56, 0.5, 0.62, q);
  }
  for (let i = 0; i < 2; i++) {
    const z = THREE.MathUtils.lerp(-L * 0.1, L * 0.08, rnd());
    const x = (rnd() - 0.5) * 0.8;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    mk(cyl, 0x8a6a42, x, yCut + 0.36, z, 0.33, 0.8, 0.33, q);
  }
  // шаги мачт на кильсоне
  for (const mz of (P.masts === 2 ? [L * 0.16, -L * 0.10] : [L * 0.18, -L * 0.05, -L * 0.28])) {
    mk(box, 0x352718, 0, -P.draft * 0.34, mz, 0.55, 0.3, 0.55);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.02,
    side: THREE.DoubleSide,   // переборки/транец видны с обеих сторон
  }));
  mesh.name = 'Skeleton_Frames';
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}
