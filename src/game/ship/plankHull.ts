// ============================================================
// Task 46: ДОЩАТЫЙ КОРПУС (модель v2, «на основе текущих»).
// Корабль собирается из НАСТОЯЩИХ ДОСОК — обшивка борта и палуба:
// каждая доска — отдельная запись с HP и 4 состояниями геометрии
// (та же точка пивота в центре доски):
//   State_0 — целая (HP > 75%);
//   State_1 — помятая (HP 75–50%): вмятина от ядра, трещины;
//   State_2 — сильно смятая (HP 50–15%): прогиб внутрь, расщепы,
//             светлая древесина на сколах;
//   State_3 — сломанная (HP < 15%): сквозной пролом — рваные
//             обломки у шпангоутов, виден внутренний каркас.
// Внутренний каркас (Skeleton) смоделирован полностью: киль,
// штевни, шпангоуты (3 яруса на борт), бимсы, переборки отсеков,
// транцевая стена, груз в трюме — при State_3 корабль виден насквозь.
//
// ПРОГРАММНЫЙ ДОСТУП (вместо Plank_[ID]_State_N в сцене —
// слияние в 3 меша ради производительности):
//   визуальная группа 'Hull_Planks'.userData.planks → PlankRec[]
//   (у каждой записи id 'Plank_P07_12' / 'Plank_D3_04', state 0..3,
//   hp, координаты); PlankSystem.plankById(id).
// Разрушение — ТОЛЬКО от нескольких попаданий: одно ядро даёт
// доске ~25–40 урона из 100 HP (3 прямых попадания = слом).
// ============================================================
import * as THREE from 'three';
import { ShipPreset, hullProfile, hullHalfWidthAt } from './buildShip';
import { mulberry32 } from './crew';

export interface PlankRec {
  id: string;
  cls: 0 | 1;          // 0 — борт, 1 — палуба
  side: -1 | 1;        // борт: +1 порт (+X), −1 штирборт; палуба: side по x
  y: number;           // центр (борт: высота; палуба: уровень палубы)
  z: number;
  x: number;           // палуба: центр колонки
  len: number;         // длина (вдоль корпуса)
  w: number;           // ширина поясья/доски палубы
  thick: number;
  quat: THREE.Quaternion;
  center: THREE.Vector3; // в координатах корабля
  tone: number;        // разброс тона живой доски
  color: THREE.Color;  // базовый цвет (с учётом подводной части)
  state: 0 | 1 | 2 | 3;
  hp: number;          // 100..0
  belowWL: boolean;
  /** каскад «панель вырвано» уже разыгран для этой доски */
  cascadeHit?: boolean;
  /** мировая точка (заполняет Ship при создании FX) */
  world?: THREE.Vector3;
}

/** разрез гладкого корпуса: выше этой линии борта — доски */
export function plankCutY(P: ShipPreset): number {
  return -P.draft * 0.62;
}

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
  // касательная поясья (вверх по борту с развалом) и нормаль наружу
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
  private meshes: THREE.Mesh[] = [];           // [порт, штирборт, палуба]
  private recsByMesh: PlankRec[][] = [];
  private brokenBelowWL: PlankRec[] = [];

  constructor(P: ShipPreset) {
    this.group.name = 'Hull_Planks';
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0.03,
    });
    this.buildSides(P);
    this.buildDeck(P);
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

  /** Task 46: полный сброс (clearDamage): все доски целы */
  reset() {
    for (const r of this.records) {
      r.state = 0;
      r.hp = 100;
      r.cascadeHit = false;
    }
    this.brokenBelowWL.length = 0;
    this.rebuildAll();
  }

  // ---------- раскладка бортов ----------
  private buildSides(P: ShipPreset) {
    let idN = 0;
    const L = P.length;
    const yCut = plankCutY(P);
    const yTop = hullProfile(0.5, P).bulwark - 0.10;
    const pitch = 0.42, plankH = 0.385, gap = 0.035;
    const nStr = Math.max(3, Math.ceil((yTop - yCut) / pitch));
    const rnd = mulberry32(this.seedOf(P) ^ 0x2f13);
    const zA = -L * 0.455, zB = L * 0.455;
    for (const s of [1, -1] as const) {
      for (let k = 0; k < nStr; k++) {
        const y = yCut + 0.06 + plankH / 2 + k * pitch;
        if (y > yTop) break;
        const below = y < 0.05;
        const thick = below ? 0.105 : 0.09;
        const stagger = (k % 2) * 0.78;
        const len = 1.52, step = len + 0.045;
        for (let z = zA + stagger + step / 2; z + len / 2 <= zB; z += step) {
          const t = (z + L / 2) / L;
          const hw = hullHalfWidthAt(P, t, y);
          const off = Math.max(hw, 0.30) + thick / 2 + 0.022;
          const cx = s * off;
          const quat = new THREE.Quaternion();
          const N = new THREE.Vector3(), T = new THREE.Vector3();
          sideBasis(P, t, y, s, N, T);
          const Z = new THREE.Vector3(0, 0, 1);
          _m.makeBasis(N, T, Z);
          quat.setFromRotationMatrix(_m);
          const tone = 0.86 + rnd() * 0.28;
          const color = new THREE.Color(P.colors.hull);
          if (below) {
            const f = Math.min(1, (0.05 - y) / Math.max(0.8, P.draft * 0.45));
            color.lerp(new THREE.Color(0x33402a), f * 0.82);
          }
          idN++;
          this.records.push({
            id: `Plank_${s > 0 ? 'P' : 'S'}${String(k).padStart(2, '0')}_${String(idN).padStart(3, '0')}`,
            cls: 0, side: s, y, z, x: 0, len,
            w: plankH - gap, thick, quat,
            center: new THREE.Vector3(cx, y, z),
            tone, color, state: 0, hp: 100, belowWL: below,
          });
        }
      }
    }
  }

  // ---------- раскладка палубы ----------
  private buildDeck(P: ShipPreset) {
    const L = P.length;
    const rnd = mulberry32(this.seedOf(P) ^ 0x51d7);
    const deckY = (z: number) => hullProfile((z + L / 2) / L, P).bulwark - 1.0;
    const midW = hullHalfWidthAt(P, 0.5, deckY(0));
    const colStep = 0.42, plankW = 0.385, gap = 0.035;
    const nCols = Math.max(3, Math.floor((midW * 2 - 0.5) / colStep));
    for (let c = 0; c < nCols; c++) {
      const x = (c - (nCols - 1) / 2) * colStep;
      const ax = Math.abs(x);
      // зона существования колонки: где полуширина палубы даёт запас
      const zA = -L * 0.44, zB = L * 0.30;
      const len = 1.98, step = len + 0.05;
      const stagger = (Math.abs(c) % 2) * (step / 2);
      for (let z = zA + stagger + step / 2; z + len / 2 <= zB; z += step) {
        const t = (z + L / 2) / L;
        // у оконечностей корпус сужается — не выпускать доску за борт
        if (hullHalfWidthAt(P, t, deckY(z)) < ax + 0.30) continue;
        const tone = 0.88 + rnd() * 0.24;
        this.records.push({
          id: `Plank_D${String(c).padStart(2, '0')}_${String(this.records.length).padStart(3, '0')}`,
          cls: 1, side: x >= 0 ? 1 : -1, y: deckY(z), z, x,
          len, w: plankW - gap, thick: 0.075,
          quat: new THREE.Quaternion(),
          center: new THREE.Vector3(x, deckY(z) - 0.037, z),
          tone, color: new THREE.Color(P.colors.deck), state: 0, hp: 100,
          belowWL: false,
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
    // вызвать один раз после раскладки: создаёт 3 меша
    const groups: PlankRec[][] = [
      this.records.filter(r => r.cls === 0 && r.side === 1),
      this.records.filter(r => r.cls === 0 && r.side === -1),
      this.records.filter(r => r.cls === 1),
    ];
    this.recsByMesh = groups;
    const names = ['Planks_Port', 'Planks_Starboard', 'Planks_Deck'];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
      mesh.name = names[i];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { class: i === 2 ? 'deck' : 'side', planks: groups[i] };
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.rebuildAll();
  }

  rebuildAll() {
    for (let i = 0; i < 3; i++) this.rebuild(i);
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
    const v = new THREE.Vector3();
    let vo = 0, io = 0;
    for (const r of recs) {
      const tp = tpls[r.state];
      _m.compose(r.center, r.quat, _vScale.set(r.thick, r.w, r.len));
      const n = tp.pos.length / 3;
      for (let i = 0; i < n; i++) {
        v.set(tp.pos[i * 3], tp.pos[i * 3 + 1], tp.pos[i * 3 + 2]);
        v.applyMatrix4(_m);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        uv[(vo + i) * 2] = tp.uv[i * 2] * r.len;
        uv[(vo + i) * 2 + 1] = tp.uv[i * 2 + 1] * r.w;
        // цвет доски = базовый × живой тон × множитель состояния
        const cm = tp.col[i * 3];
        col[(vo + i) * 3] = r.color.r * r.tone * cm;
        col[(vo + i) * 3 + 1] = r.color.g * r.tone * (tp.col[i * 3 + 1] ?? cm);
        col[(vo + i) * 3 + 2] = r.color.b * r.tone * (tp.col[i * 3 + 2] ?? cm);
      }
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      vo += n; io += n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();       // фасетные нормали: рёбра досок читаются
    mesh.geometry.dispose();
    mesh.geometry = g;
  }

  // ============================================================
  // УРОН: попадание в борт (y, z — локальные) → доски в радиусе.
  // Ближайшие доски получают больше; HP 100; state по HP:
  // >75 → 0, 75–50 → 1, 50–15 → 2, ≤15 → 3 (сквозной пролом).
  // ============================================================
  damageSide(side: 1 | -1, y: number, z: number, dmg: number): PlankDamageResult {
    const R = 1.18;
    const cands = this.recsByMesh[side === 1 ? 0 : 1]
      .map(r => ({ r, d: Math.hypot((r.y - y) * 1.1, (r.z - z) * 0.8) }))
      .filter(c => c.d < R)
      .sort((a, b) => a.d - b.d);
    return this.applyDamage(cands, dmg, y, z);
  }

  damageDeck(x: number, z: number, dmg: number): PlankDamageResult {
    const R = 1.0;
    const cands = this.recsByMesh[2]
      .map(r => ({ r, d: Math.hypot((r.x - x) * 1.25, (r.z - z) * 0.9) }))
      .filter(c => c.d < R)
      .sort((a, b) => a.d - b.d);
    return this.applyDamage(cands, dmg, x, z);
  }

  private applyDamage(cands: { r: PlankRec; d: number }[], dmg: number, y: number, z: number): PlankDamageResult {
    const res: PlankDamageResult = { changed: 0, broken: [], cascade: false };
    if (!cands.length) return res;
    const meshIdxOf = (r: PlankRec) => r.cls === 1 ? 2 : (r.side === 1 ? 0 : 1);
    const dirty = new Set<number>();
    const touch = (r: PlankRec, amount: number) => {
      if (amount <= 0) return;
      r.hp = Math.max(0, r.hp - amount);
      const st = (r.hp > 75 ? 0 : r.hp > 50 ? 1 : r.hp > 15 ? 2 : 3) as 0 | 1 | 2 | 3;
      if (st !== r.state) {
        r.state = st;
        res.changed++;
        dirty.add(meshIdxOf(r));
        if (st === 3) {
          res.broken.push(r);
          if (r.cls === 0 && r.belowWL) {
            this.brokenBelowWL.push(r);
          }
        }
      }
    };
    for (const c of cands) {
      const fall = 1 - c.d / 1.18;            // 1 в центре .. 0 на краю
      touch(c.r, dmg * (0.32 + 0.68 * fall));  // ближайшая — полным весом
    }
    // ============================================================
    // КАСКАД «ПАНЕЛЬ ОБШИВКИ ВЫРВАНО»: в зоне 2.2 м вокруг точки
    // УДАРА накоплено ≥6 СЛОМАННЫХ досок (за серию попаданий) и
    // бонус ещё не разыгран — оставшиеся доски зоны получают −46:
    // дыра расширяется СКАЧКОМ, панель отлетает целиком
    // ============================================================
    const mIdx = meshIdxOf(cands[0].r);
    const hitY = cands[0].r.cls === 1 ? cands[0].r.y : y;
    const zoneDist = (r: PlankRec) => r.cls === 1
      ? Math.hypot((r.x - cands[0].r.x) * 1.2, (r.z - z) * 0.9)
      : Math.hypot((r.y - hitY) * 1.05, (r.z - z) * 0.75);
    const inZone = this.recsByMesh[mIdx].filter(r => zoneDist(r) < 2.2);
    const brokenInZone = inZone.filter(r => r.state === 3).length;
    const zoneRest = inZone.filter(r => r.state < 3 && !r.cascadeHit);
    if (brokenInZone >= 6 && zoneRest.length) {
      for (const r of zoneRest) {
        r.cascadeHit = true;
        touch(r, 46);      // добивание соседей панели
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
  const boxMUnused = 0;
  void boxMUnused;

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
