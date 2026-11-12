import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG, fbm2, clamp, smoothstep } from '../core/rng';
import type { AssetsSettings } from '../core/settings';
import type { IslandsSettings } from '../core/settings';
import { buildFishingVillage, type FishingVillage, type WorldBoat, buildCoastFleet, type CoastFleet } from './fishing';
import { TerrainStreamer } from './terrain';
import { buildVillageFolk, type LandFolk } from './islandFolk';

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

// ---------- порты: по одному на КАЖДОМ острове ----------
/** Уровень порта зависит от размера острова: пристань → деревня →
 *  городок → город-крепость с пушками и населением */
export interface PortDef {
  island: IslandDef;
  name: string;          // название гавани (совпадает с островом)
  tier: 0 | 1 | 2 | 3;   // пристань / деревня / городок / город-крепость
  tierName: string;
  population: number;    // население посёлка/города
  dockEnd: THREE.Vector3; // конец пирса (точка швартовки)
  /** направление от берега в море (куда смотрит пирс) */
  dir: THREE.Vector3;
  /** множитель цен на товары: <1 — порт производит (дёшево покупает),
   *  >1 — порт требует (дорого продаёт) — основа торговых маршрутов */
  priceMul: number;
}

export const TIER_NAMES = ['Пристань', 'Деревня', 'Городок', 'Город-крепость'] as const;

function tierForIsland(isl: IslandDef): 0 | 1 | 2 | 3 {
  // пороги ×10: острова выросли вдесятеро (Task 36)
  if (isl.r >= 2700) return 3;
  if (isl.r >= 2000) return 2;
  if (isl.r >= 1350) return 1;
  return 0;
}

/** множитель масштаба мира (Task 36): карта и острова в 100 раз
 *  больше по ПЛОЩАДИ — радиусы и дистанции ×10 */
export const WORLD_SCALE = 10;

export const WORLD_SEED = 20261027;

// 9 «рукописных» островов (порт + ориентиры) — их индексы используют животные.
// Task 36: КАРТА И ОСТРОВА ×10 (площадь ×100): острова 1–3.3 км радиусом
// с настоящими горами (до 340 м), карта растянута до ±45 км.
// 9-й — ПИРАТСКОЕ ЛОГОВО у полигона (4400, 3050): остров, густо
// набитый пиратской эскадрой (эскадра спавнится в game.ts)
const BASE_ISLANDS: IslandDef[] = [
  { cx: 6750, cz: 5250, r: 3300, maxH: 300, type: 'port', name: 'Пальмовая гавань', discovered: false },
  { cx: -9750, cz: 7500, r: 2350, maxH: 210, type: 'jungle', name: 'Зелёный атолл', discovered: false },
  { cx: -7800, cz: -10500, r: 1200, maxH: 320, type: 'rock', name: 'Скала Морского Дьявола', discovered: false },
  { cx: 13500, cz: -9300, r: 1450, maxH: 80, type: 'atoll', name: 'Черепаший риф', discovered: false },
  { cx: 21000, cz: 13500, r: 2900, maxH: 260, type: 'jungle', name: 'Остров Бакунов', discovered: false },
  { cx: -22500, cz: -3300, r: 2050, maxH: 190, type: 'jungle', name: 'Дальний ключ', discovered: false },
  { cx: -15750, cz: 17250, r: 1050, maxH: 250, type: 'rock', name: 'Клык', discovered: false },
  { cx: 3750, cz: -21000, r: 2550, maxH: 85, type: 'atoll', name: 'Плёс', discovered: false },
  { cx: 44000, cz: 30500, r: 2050, maxH: 230, type: 'jungle', name: 'Логово пиратов', discovered: false },
];

/** Процедурная генерация архипелага: детерминированно по сиду —
 *  кольцом вокруг порта, с минимальными проливами между островами
 *  (УВЕЛИЧЕННАЯ карта Task 36: дистанции 17–42 км, радиусы
 *  1.2–3.3 км, проливы не уже 6 км).
 *  Базовые острова не трогаем (животные/порт привязаны к индексам). */
function generateIslands(): IslandDef[] {
  const rng = new RNG(WORLD_SEED + 9173);
  const names = [
    'Остров Черепа', 'Мыс Багровой Луны', 'Скалы Трёх Братьев', 'Лагуна Сирен',
    'Кайманов ключ', 'Затерянный риф', 'Бухта Повешенного', 'Остров Гвоздей',
    'Перьевой атолл', 'Голый риф', 'Отмель Мёртвого Якоря', 'Тихая банка',
    'Зубы Кракена', 'Сиреневый пролив', 'Костяной мыс', 'Залив Скелетов',
    'Пальмовый рукав', 'Медный берег', 'Дырявый котёл', 'Слепая бухта',
    'Остров Трёх Ветров',
  ];
  const pool = [...names];
  const out: IslandDef[] = [];
  let guard = 0;
  while (out.length < 21 && guard++ < 2400) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(17000, 42000);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d * 0.82; // мир чуть шире по X — под карту 90×72 км
    if (Math.abs(cx) > 45000 || Math.abs(cz) > 36000) continue;
    const roll = rng.next();
    const type: IslandDef['type'] = roll < 0.5 ? 'jungle' : roll < 0.78 ? 'rock' : 'atoll';
    const r = rng.range(1200, 3300);
    // проливы не уже 6 км между берегами (×10 от прежних 800 м)
    let ok = true;
    for (const isl of [...BASE_ISLANDS, ...out]) {
      if (Math.hypot(cx - isl.cx, cz - isl.cz) < isl.r + r + 6000) { ok = false; break; }
    }
    if (!ok) continue;
    const maxH = type === 'rock' ? rng.range(200, 340) : type === 'jungle' ? rng.range(120, 260) : rng.range(60, 95);
    const name = pool.length ? pool.splice(Math.floor(rng.next() * pool.length), 1)[0] : `Безымянный риф ${out.length + 1}`;
    out.push({ cx: Math.round(cx), cz: Math.round(cz), r: Math.round(r), maxH: Math.round(maxH), type, name, discovered: false });
  }
  return out;
}

export const ISLANDS: IslandDef[] = [...BASE_ISLANDS, ...generateIslands()];

// ---------- НЕПРАВИЛЬНАЯ ФОРМА БЕРЕГОВОЙ ЛИНИИ ----------
// Остров — НЕ круг: радиус берега зависит от НАПРАВЛЕНИЯ от центра.
// Форму задаают 3–4 угловые гармоники R(θ)=r·(1+Σaᵢ·cos(kᵢθ+φᵢ)):
// k=2 — вытянутость (соотношение осей до ~2:1), k=3 — крупные лопасти
// и бухты, k=4..5 — изрезанные мысы. Коэффициенты детерминированы по
// сиду — архипелаг воспроизводим от запуска к запуску, а берега при
// этом получаются «неправильными»: вытянутые, с заливами и косами.
interface CoastHarm { k: number; a: number; ph: number }
const COAST_HARMONICS: CoastHarm[][] = ISLANDS.map((isl, i) => {
  const rng = new RNG(WORLD_SEED * 17 + i * 613 + 71);
  // вытянутость зависит от ТИПА острова: атоллы — длинные подковы,
  // скалы — коренастые с крупными лопастями, джунгли/порты — средние
  const elong = isl.type === 'atoll' ? [0.26, 0.40]
    : isl.type === 'rock' ? [0.13, 0.22] : [0.16, 0.33];
  const lobe = isl.type === 'rock' ? [0.12, 0.2] : [0.08, 0.17];
  const h: CoastHarm[] = [
    { k: 2, a: rng.range(elong[0], elong[1]), ph: rng.range(0, Math.PI * 2) }, // вытянутость
    { k: 3, a: rng.range(lobe[0], lobe[1]), ph: rng.range(0, Math.PI * 2) },   // лопасти/бухты
  ];
  if (rng.next() < 0.75) h.push({ k: 4, a: rng.range(0.04, 0.12), ph: rng.range(0, Math.PI * 2) });
  if (rng.next() < 0.5) h.push({ k: 5, a: rng.range(0.03, 0.08), ph: rng.range(0, Math.PI * 2) });
  return h;
});
/** Форма берега в направлении θ (доля от r): безразмерный множитель 0.58..1.42 */
function coastShape(islandIdx: number, th: number): number {
  let s = 1;
  for (const h of COAST_HARMONICS[islandIdx]) s += h.a * Math.cos(h.k * th + h.ph);
  return Math.min(1.42, Math.max(0.58, s));
}

// ---------- РАЗНООБРАЗНЫЕ БЕРЕГА (Task 36): пляж / каменистый / обрыв ----------
// У КАЖДОГО острова берег разный по направлениям: 3–6 угловых
// «полос» со своим типом. Пляж — пологий песок с мелководной
// полосой (шлюпка подходит к самому берегу); каменистый — крутой
// подъём с валунами, вода глубокая почти сразу; обрыв — отвесная
// стена прямо из глубины (прибой — узкая полоса у подножия).
export type CoastKind = 'beach' | 'rock' | 'cliff';
interface CoastBand { kind: CoastKind; a: number; w: number; }
const COAST_BANDS: CoastBand[][] = ISLANDS.map((isl, i) => {
  const rng = new RNG(WORLD_SEED * 31 + i * 977 + 13);
  const bands: CoastBand[] = [];
  // остров 0 (порт): ГАВАНЬ — ГАРАНТИРОВАННЫЙ широкий пляж в
  // сторону пирса (высадка на берег у родной гавани); случайные
  // полосы в этой дуге подавлены, чтобы обрыв не «съел» пляж
  const portAng = Math.atan2(1, -1);
  const suppressNear = (a: number) => i === 0
    && Math.abs(Math.atan2(Math.sin(a - portAng), Math.cos(a - portAng))) < 1.7;
  const n = 3 + Math.floor(rng.next() * 4);
  for (let k = 0; k < n; k++) {
    const roll = rng.next();
    const kind: CoastKind = roll < 0.45 ? 'beach' : roll < 0.75 ? 'rock' : 'cliff';
    const a = rng.range(0, Math.PI * 2);
    if (suppressNear(a)) continue;   // у порта — только пляж
    bands.push({ kind, a, w: rng.range(0.4, 1.1) });
  }
  if (i === 0) bands.push({ kind: 'beach', a: portAng, w: 2.0 });
  // логово пиратов: скалистые подходы
  if (isl.name === 'Логово пиратов') bands.push({ kind: 'rock', a: Math.PI, w: 1.2 });
  return bands;
});

/** Смешивание типов берега в направлении θ: веса {beach, rock, cliff} */
export function coastBlend(islandIdx: number, th: number): { beach: number; rock: number; cliff: number } {
  const isl = ISLANDS[islandIdx];
  const defB = isl.type === 'atoll' ? 0.75 : isl.type === 'rock' ? 0.2 : 0.5;
  const defC = isl.type === 'rock' ? 0.45 : isl.type === 'atoll' ? 0.05 : 0.2;
  const defR = Math.max(0.15, 1 - defB - defC);
  let wB = defB, wR = defR, wC = defC;
  for (const b of COAST_BANDS[islandIdx]) {
    if (b.w < 0.01) continue;
    let d = Math.abs(Math.atan2(Math.sin(th - b.a), Math.cos(th - b.a)));
    const w = Math.max(0, Math.cos(Math.min(Math.PI / 2, d / b.w * (Math.PI / 2))));
    const k = w * w;
    if (b.kind === 'beach') wB += k * 2.2; else if (b.kind === 'rock') wR += k * 2.2; else wC += k * 2.2;
  }
  const s = wB + wR + wC;
  return { beach: wB / s, rock: wR / s, cliff: wC / s };
}

/** Тип берега острова в направлении θ (преобладающий) */
export function coastKindAt(islandIdx: number, th: number): CoastKind {
  const b = coastBlend(islandIdx, th);
  return b.beach >= b.rock && b.beach >= b.cliff ? 'beach' : b.rock >= b.cliff ? 'rock' : 'cliff';
}

/** Глубина открытого моря (дно), м. −14 как в прежнем мире:
 *  высота волн калибровалась под гашение shoreFade (14/30 ≈ 45%
 *  амплитуды в открытом море) — углублять нельзя, шторм удвоится */
export const SEA_FLOOR = -14;

/** Высота суши в мировой точке. Открытое море = SEA_FLOOR, суша > 0.
 *  Task 36: берега ТРЁХ типов по направлениям (пляж — пологий,
 *  камень — крутой, обрыв — стена из глубины) + настоящие ГОРНЫЕ
 *  ХРЕБТЫ (ridged-шум, острые гребни у высоких островов). */
export function heightAt(x: number, z: number): number {
  let h = SEA_FLOOR; // дно открытого моря
  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    const dx = x - isl.cx; if (dx > isl.r * 2.1 || dx < -isl.r * 2.1) continue;
    const dz = z - isl.cz; if (dz > isl.r * 2.1 || dz < -isl.r * 2.1) continue;
    const d = Math.hypot(dx, dz);
    if (d > isl.r * 2.1) continue;
    const th = Math.atan2(dz, dx);
    // радиус берега в ЭТОМ направлении: форма × рваный шум кромки
    const shape = coastShape(i, th);
    const coastNoise = fbm2(x * 0.0016, z * 0.0016, 3, WORLD_SEED + isl.r);
    const rEff = isl.r * shape * (0.80 + 0.42 * coastNoise);
    if (d > rEff * 1.35) continue;
    const q = d / rEff;
    // профиль подъёма суши — по ТИПУ берега (смешивание весов).
    // Пляж ПОЛОГИЙ у кромки (посадка шлюпки: 0→−3 м тянется ~40 м)
    const cb = coastBlend(i, th);
    const fB = smoothstep(1.18, 0.60, q);   // пляж: полого, широко
    const fR = smoothstep(1.03, 0.55, q);   // камень: круто
    const fC = smoothstep(0.985, 0.955, q); // обрыв: отвесная стена
    const fall = cb.beach * fB + cb.rock * fR + cb.cliff * fC;
    // рельеф: детали + ГОРНЫЕ ХРЕБТЫ (острые гребни ridged-шума)
    const detail = 0.55 + 0.45 * fbm2(x * 0.004, z * 0.004, 4, WORLD_SEED + isl.cx);
    const crest = 1 - Math.abs(2 * fbm2(x * 0.0011, z * 0.0011, 3, WORLD_SEED + isl.cz) - 1);
    const relief = 0.55 * detail + 0.45 * Math.pow(crest, isl.maxH > 150 ? 2.0 : 1.0);
    let hi = isl.maxH * fall * (0.38 + 0.72 * relief) - 3.0;
    // мелководье → дно: пляж плавно (широкая полоса посадки),
    // камень быстро, обрыв — сразу
    const sB = smoothstep(1.05, 1.32, q);
    const sR = smoothstep(1.01, 1.10, q);
    const sC = smoothstep(1.006, 1.045, q);
    const shelf = cb.beach * sB + cb.rock * sR + cb.cliff * sC;
    hi = THREE.MathUtils.lerp(hi, SEA_FLOOR, shelf);
    if (hi > h) h = hi;
  }
  return h;
}

/** Радиус до береговой линии (h ≈ hLevel) в направлении th от центра
 *  острова — двоичный поиск по лучу. Для карт (полигоны берега),
 *  привязки животных и телеметрии формы. */
export function coastRadiusAt(islandIdx: number, th: number, hLevel = 0.3): number {
  const isl = ISLANDS[islandIdx];
  if (!isl) return 0;
  const ux = Math.cos(th), uz = Math.sin(th);
  let lo = 0, hi = isl.r * 2.05;
  for (let it = 0; it < 18; it++) {
    const mid = (lo + hi) / 2;
    if (heightAt(isl.cx + ux * mid, isl.cz + uz * mid) > hLevel) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Полигон береговой линии острова (для карт и E2E-проверки формы) */
export function islandOutline(islandIdx: number, steps = 72): { x: number; z: number }[] {
  const isl = ISLANDS[islandIdx];
  if (!isl) return [];
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const rr = coastRadiusAt(islandIdx, th);
    pts.push({ x: Math.round(isl.cx + Math.cos(th) * rr), z: Math.round(isl.cz + Math.sin(th) * rr) });
  }
  return pts;
}

function slopeAt(x: number, z: number): number {
  const e = 1.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}
// ---------- ДЕРЕВНИ И ТРОПЫ (Task 36) ----------
// На каждом крупном острове — несколько НЕБОЛЬШИХ деревень
// (4–9 хижин, костёр) у берега и на склонах; от порта к деревням
// ведут ТРОПЫ (грязевые полосы на рельефе, по ним ходят жители).
export interface VillageDef {
  islandIdx: number;
  x: number; z: number;      // центр деревни (мировые)
  h: number;                 // высота земли
  huts: number;              // число хижин
  /** полилиния тропы от порта до деревни (мировые точки) */
  trail: { x: number; z: number }[];
  /** Task 41: деревня АКТИВНА (строится и красит тропу на рельефе);
  *  управляется настройкой islands.villagesMul (×2-×3 — берутся
  *  ДОПОЛНИТЕЛЬНЫЕ деревни из расширенного пула генерации) */
  active?: boolean;
  /** Task 41: БАЗОВАЯ деревня первого прохода генерации — их набор
  *  в точности прежний (до Task 41); множитель villagesMul
  *  считается от ФАКТИЧЕСКОГО числа базовых на острову */
  base?: boolean;
}
/** базовое число деревень на острове (при villagesMul=1 — как
 *  было до Task 41; первые деревни пула ДЕТЕРМИНИРОВАНЫ —
 *  прежний мир сохраняется) */
function baseVillageCount(isl: IslandDef): number {
  return Math.max(2, Math.min(6, Math.round(isl.r / 650)));
}
export const VILLAGES: VillageDef[] = (function buildVillages() {
  const out: VillageDef[] = [];
  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    if (isl.r < 1200) continue;               // мелкие острова — без деревень
    const rng = new RNG(WORLD_SEED * 13 + i * 331 + 7);
    // Task 41: генерируем РАСШИРЕННЫЙ ПУЛ (до 3× базового числа,
    // максимум 12) — настройка «деревни ×2/×3» активирует
    // дополнительные; первые baseN совпадают с прежним миром
    const baseN = baseVillageCount(isl);
    const n = Math.min(12, Math.max(baseN, baseN * 3));
    const dirA = i === 0 ? Math.atan2(1, -1) : Math.atan2(isl.cz, isl.cx);
    const ux = Math.cos(dirA), uz = Math.sin(dirA);
    let shore = { x: isl.cx, z: isl.cz };
    for (let d = 0; d < isl.r * 1.5; d += 24) {
      if (heightAt(isl.cx + ux * d, isl.cz + uz * d) < 0.4) break;
      shore = { x: isl.cx + ux * d, z: isl.cz + uz * d };
    }
    let made = 0, tries = 0;
    // ПЕРВЫЙ проход — БАЗОВЫЕ деревни: в точности прежняя логика
    // (детерминизм: прежний мир сохраняется 1:1)
    while (made < baseN && tries++ < 220) {
      const a = rng.range(0, Math.PI * 2);
      const rr = isl.r * rng.range(0.42, 0.72);
      const x = isl.cx + Math.cos(a) * rr;
      const z = isl.cz + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 2.5 || h > isl.maxH * 0.5) continue;
      if (slopeAt(x, z) > 0.34) continue;
      if (out.some(v => v.islandIdx === i && Math.hypot(v.x - x, v.z - z) < isl.r * 0.35)) continue;
      const trail: { x: number; z: number }[] = [shore];
      const bends = 2 + Math.floor(rng.next() * 2);
      for (let b = 1; b <= bends; b++) {
        const t = b / (bends + 1);
        const bx = shore.x + (x - shore.x) * t + (rng.next() - 0.5) * isl.r * 0.24;
        const bz = shore.z + (z - shore.z) * t + (rng.next() - 0.5) * isl.r * 0.24;
        if (heightAt(bx, bz) > 0.6) trail.push({ x: bx, z: bz });
      }
      trail.push({ x, z });
      out.push({ islandIdx: i, x: Math.round(x), z: Math.round(z), h, huts: 4 + Math.floor(rng.next() * 6), trail, active: true, base: true });
      made++;
    }
    // ВТОРОЙ проход — ДОПОЛНИТЕЛЬНЫЕ (Task 41: пул для «деревни ×2/×3»):
    // мягкие условия (ближе друг к другу, склоны помягче) — базовые
    // деревни и их тропы НЕ затрагиваются (тот же RNG-поток дальше)
    while (made < n && tries++ < 600) {
      const a = rng.range(0, Math.PI * 2);
      const rr = isl.r * rng.range(0.3, 0.8);
      const x = isl.cx + Math.cos(a) * rr;
      const z = isl.cz + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 2 || h > isl.maxH * 0.6) continue;
      if (slopeAt(x, z) > 0.44) continue;
      if (out.some(v => v.islandIdx === i && Math.hypot(v.x - x, v.z - z) < isl.r * 0.16)) continue;
      const trail: { x: number; z: number }[] = [shore];
      const bends = 2 + Math.floor(rng.next() * 2);
      for (let b = 1; b <= bends; b++) {
        const t = b / (bends + 1);
        const bx = shore.x + (x - shore.x) * t + (rng.next() - 0.5) * isl.r * 0.24;
        const bz = shore.z + (z - shore.z) * t + (rng.next() - 0.5) * isl.r * 0.24;
        if (heightAt(bx, bz) > 0.6) trail.push({ x: bx, z: bz });
      }
      trail.push({ x, z });
      out.push({ islandIdx: i, x: Math.round(x), z: Math.round(z), h, huts: 3 + Math.floor(rng.next() * 5), trail, active: false, base: false });
      made++;
    }
  }
  return out;
})();

/** Маска зарослей 0..1 (Task 36): градиент растительности —
 *  открытые луга → кустарник → ГУСТЫЕ НЕПРОХОДИМЫЕ ДЖУНГЛИ */
export function jungleMaskAt(islandIdx: number, x: number, z: number): number {
  const isl = ISLANDS[islandIdx];
  const base = isl.type === 'jungle' ? 0.56 : isl.type === 'rock' ? 0.16
    : isl.type === 'atoll' ? 0.3 : 0.44;
  const n = fbm2(x * 0.0013, z * 0.0013, 3, WORLD_SEED + islandIdx * 517 + 3);
  return Math.max(0, Math.min(1, base + (n - 0.5) * 1.25));
}

// ---------- ЦВЕТ РЕЛЬЕФА (общий для тайлов terrain.ts) ----------
const C_UNDER = new THREE.Color(0x9a8a66);
const C_SAND = new THREE.Color(0xd9c28f);
const C_WET_SAND = new THREE.Color(0xb59f72);
const C_GRASS = new THREE.Color(0x5f863d);
const C_JUNGLE = new THREE.Color(0x2c5a28);
const C_ROCK = new THREE.Color(0x8a8378);
const C_ROCK_DARK = new THREE.Color(0x6e675c);
const C_DIRT = new THREE.Color(0x9c7f52);
const _tc = new THREE.Color();

/** Расстояние до ближайшей тропы/деревни острова
 *  (Task 41: неактивные деревни троп НЕ красят) */
function trailDist(islandIdx: number, x: number, z: number): number {
  let best = Infinity;
  for (const v of VILLAGES) {
    if (v.islandIdx !== islandIdx || v.active === false) continue;
    const t = v.trail;
    for (let k = 0; k + 1 < t.length; k++) {
      const ax = t[k].x, az = t[k].z, bx = t[k + 1].x, bz = t[k + 1].z;
      const abx = bx - ax, abz = bz - az;
      const len2 = abx * abx + abz * abz || 1;
      let s = ((x - ax) * abx + (z - az) * abz) / len2;
      s = Math.max(0, Math.min(1, s));
      const d = Math.hypot(x - (ax + abx * s), z - (az + abz * s));
      if (d < best) best = d;
    }
    const dc = Math.hypot(x - v.x, z - v.z);
    if (dc < best) best = dc;
  }
  return best;
}

/** Цвет поверхности острова в точке: песок/трава/джунгли/скалы,
 *  мокрая полоса у кромки воды, грязь троп и деревень */
export function terrainColorAt(islandIdx: number, x: number, z: number, h: number, slope: number, out?: THREE.Color): THREE.Color {
  const c = out ?? _tc;
  const isl = ISLANDS[islandIdx];
  const th = Math.atan2(z - isl.cz, x - isl.cx);
  const cb = coastBlend(islandIdx, th);
  if (h < -0.4) {
    const tint = clamp((h + 2.2) / 2.6, 0, 1);
    c.copy(C_UNDER).lerp(cb.rock + cb.cliff > 0.5 ? C_ROCK_DARK : C_SAND, tint);
    return c;
  }
  if (h < 0.55) { c.copy(C_WET_SAND); return c; } // мокрый песок у кромки
  const beachTop = 1.4 + cb.beach * 2.6;
  const dith = (fbm2(x * 0.02, z * 0.02, 2, WORLD_SEED + 77) - 0.5) * 0.5;
  if (h < beachTop + dith) { c.copy(C_SAND); return c; }
  const td = trailDist(islandIdx, x, z);
  if (td < 9 && slope < 0.5) {
    const k = 1 - smoothstep(3.5, 9, td);
    c.copy(C_DIRT).lerp(C_GRASS, 1 - k);
    return c;
  }
  const mask = jungleMaskAt(islandIdx, x, z);
  c.copy(C_GRASS).lerp(C_JUNGLE, clamp(mask * 1.25, 0, 1));
  const rockFrom = isl.type === 'rock' ? 0.10 : 0.55;
  const rd = (fbm2(x * 0.008, z * 0.008, 2, WORLD_SEED + 9) - 0.5) * 0.18;
  if (h > isl.maxH * (rockFrom + rd) || slope > 0.62) {
    c.copy(C_ROCK).lerp(C_ROCK_DARK, clamp(slope - 0.5, 0, 0.6));
  }
  return c;
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
/** Сухой пень: обломанный ствол с корневым раструбом (мертвое дерево) */
function stumpGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(tf(new THREE.CylinderGeometry(0.32, 0.5, 1.5, 7), 0, 0.75, 0), 0x6a4c2e, 0.12));
  // рваная наклонная верхушка — облом, не спил
  parts.push(paint(tf(new THREE.CylinderGeometry(0.26, 0.32, 0.55, 7), 0.1, 1.65, 0.06, 0.24, 0, 0.2), 0x8a6a44, 0.15));
  // корневые лапы у основания
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(paint(tf(new THREE.CylinderGeometry(0.06, 0.12, 0.85, 5),
      Math.cos(a) * 0.42, 0.22, Math.sin(a) * 0.42, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5), 0x5c4226, 0.12));
  }
  return mergeGeometries(parts)!;
}
/** Валун: сплюснутый многогранник с соседом поменьше (камни побережья) */
function boulderGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    paint(tf(new THREE.IcosahedronGeometry(1.5, 0), 0, 0.72, 0).scale(1.3, 0.78, 1.02) as THREE.BufferGeometry, 0x8d857a, 0.09),
    paint(tf(new THREE.IcosahedronGeometry(0.72, 0), 1.6, 0.38, 0.55), 0x7c756a, 0.1),
    paint(tf(new THREE.IcosahedronGeometry(0.45, 0), -1.35, 0.24, -0.7), 0x776f65, 0.1),
  ];
  return mergeGeometries(parts)!;
}

// ---------- Task 42: LOD-геометрии растительности ----------
// ДАЛЬНИЕ острова (за порогом от берега) рисуют деревья УПРОЩЕННЫМИ
// моделями: тот же силуэт в ~5-8 раз меньше треугольников. Камни
// (rock/stump/boulder) и так дешёвые — LOD = полная модель.
// Подмена по-островно: один InstancedMesh на вид — геометрия
// меняется одной ссылкой (мгновенно, без пересборки инстансов).
function palmLodGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    paint(tf(new THREE.CylinderGeometry(0.14, 0.24, 8.5, 3), 0, 4.25, 0), 0x7a5a38),
    paint(tf(new THREE.SphereGeometry(1.6, 5, 3), 0, 8.6, 0).scale(1, 0.42, 1) as THREE.BufferGeometry, 0x3f7d33),
  ];
  return mergeGeometries(parts)!;
}
function ficusLodGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    paint(tf(new THREE.CylinderGeometry(0.44, 0.66, 4.2, 3), 0, 2.1, 0), 0x6b4e2f),
    paint(tf(new THREE.SphereGeometry(2.6, 5, 3), 0, 5.6, 0).scale(1, 0.72, 1) as THREE.BufferGeometry, 0x2f5e2b),
  ];
  return mergeGeometries(parts)!;
}
function jungleLodGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    paint(tf(new THREE.CylinderGeometry(0.2, 0.38, 5.4, 3), 0, 2.7, 0), 0x6e5230),
    paint(tf(new THREE.SphereGeometry(1.9, 5, 3), 0, 6.0, 0).scale(1, 1.25, 1) as THREE.BufferGeometry, 0x477a34),
  ];
  return mergeGeometries(parts)!;
}
function bushLodGeo(): THREE.BufferGeometry {
  return paint(tf(new THREE.SphereGeometry(0.8, 4, 3), 0, 0.55, 0), 0x4a7032);
}
function bambooLodGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    paint(tf(new THREE.CylinderGeometry(0.05, 0.07, 5.2, 3), 0, 2.6, 0), 0x8a9a3a),
    paint(tf(new THREE.CylinderGeometry(0.05, 0.07, 4.4, 3), 0.4, 2.2, 0.15), 0x7e9038),
  ];
  return mergeGeometries(parts)!;
}
/** Каталог LOD-моделей по виду (null → полная и так дешёвая) */
const VEG_LOD: Record<string, (() => THREE.BufferGeometry) | null> = {
  palm: palmLodGeo, ficus: ficusLodGeo, jungle: jungleLodGeo,
  bush: bushLodGeo, bamboo: bambooLodGeo,
  rock: null, stump: null, boulder: null,
};
/** кэш LOD-геометрий (одна на вид на всю сессию — при ×1000
 *  деревьев и перестройках не пересоздавать) */
const VEG_LOD_CACHE: Record<string, THREE.BufferGeometry> = {};

// ---------- животные ----------
interface AnimalInst { mesh: THREE.InstancedMesh; count: number; }
interface Wanderer {
  x: number; z: number; dirA: number; speed: number;
  timer: number; phase: number; island: IslandDef;
}
interface Hopper { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; island: IslandDef; }
interface Circler { island: IslandDef; a: number; r: number; speed: number; h: number; phase: number; }

/** Чайка в ПОЛЁТЕ: своя скорость/курс, крен в повороте, высотная
 *  «качка» и режим — кружит над островом ИЛИ ходит за кораблём
 *  игрока (классические кормящиеся чайки за судном). */
interface GullFlight {
  mode: 'island' | 'ship';
  island: IslandDef;       // якорь для mode=island (центр кружения)
  x: number; z: number; y: number;
  hdg: number;             // курс, рад (0 = +X)
  spd: number;             // скорость полёта, м/с
  turn: number;            // текущая скорость поворота, рад/с
  bank: number;            // сглаженный крен, рад
  retarget: number;        // сек до смены манёвра
  orbit: 1 | -1;           // направление круга
  orbitR: number;          // радиус кружения, м
  baseY: number;           // крейсерская высота
  phase: number;           // фаза вертикальной качки
}

export class World {
  group = new THREE.Group();
  fishing: FishingVillage[] = []; // рыбацкий декор каждой гавани
  islands: IslandDef[] = ISLANDS;
  /** все гавани архипелага — по одной на каждом острове */
  ports: PortDef[] = [];
  /** главная гавань (остров 0) — прежнее имя поля для совместимости */
  get port(): PortDef { return this.ports[0]; }
  discovered = new Set<string>();
  /** рельеф островов: СТРИМЕР ТАЙЛОВ с LOD (Task 36) */
  terrain: TerrainStreamer;
  /** рыбацкие лодки вокруг всех островов (дрейфуют у кромки) */
  coastFleet!: CoastFleet;
  /** Task 41: упёрся ли лес в общий бюджет инстансов (×1000) */
  private vegBudgetHit = false;
  /** жители деревень (по деревне на остров) — ходят по тропам */
  villageFolk: LandFolk[] = [];
  /** группы деревень (видимость по дистанции) */
  private villageGroups: THREE.Group[] = [];
  /** дальность видимости статики мира (настройка графики, м) */
  visDistance = 5600;

  // животные
  private gullMesh!: THREE.InstancedMesh;
  private gullMat!: THREE.ShaderMaterial;
  private gulls: GullFlight[] = [];
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
  /** переиспользуемый вектор (breakTrees → gibTreePieces) */
  private _vTmp = new THREE.Vector3();

  // ломающаяся растительность: инстансы по видам (Task 41: позиции и
  // масштабы читаются ПРЯМО из instanceMatrix — без дублирующих
  // массивов: при ×1000 это 1,5 млн инстансов, дубль убил бы память)
  private vegSlots: {
    inst: THREE.InstancedMesh;
    broken: boolean[];
    breakable: boolean;
    kind: string;         // вид: palm/ficus/jungle/bamboo/bush/stump/boulder — рецепт разлома
    procGeo: THREE.BufferGeometry; // исходная процедурная геометрия (фолбэк GLB)
    // Task 42: LOD ДАЛЬНИХ ОСТРОВОВ — упрощённая геометрия + остров
    islIdx: number;               // остров слота (LOD по-островно)
    lodGeo: THREE.BufferGeometry; // упрощённая модель (дальние острова)
    glbGeo: THREE.BufferGeometry | null; // GLB-замена (если включена)
    lod: boolean;                 // сейчас на LOD-геометрии
  }[] = [];
  /** Task 42: флаги LOD по островам (гистерезис в update) */
  private islLod: boolean[] = [];
  /** Task 42: порог LOD от БЕРЕГА острова (м) — свой остров у
   *  берега остаётся детальным, дальние рисуются упрощённо */
  static readonly TREE_LOD_DIST = 700;
  static readonly TREE_LOD_NEAR = 600;   // гистерезис возврата
  /** счётчик поваленных деревьев (телеметрия) */
  treesBroken = 0;

  /** полигоны береговой линии всех островов (для карт и телеметрии) */
  outlines: { x: number; z: number }[][] = [];

  // группы островов: растительность/постройки/деревни острова — в
  // своей группе (видимость по дистанции до игрока)
  private islGroups: THREE.Group[] = [];
  // Task 40/41: группы РАСТИТЕЛЬНОСТИ (подмножество islGroups) —
  // плотность леса меняется в настройках на лету: старые инстансы
  // снимаются, новые собираются тем же детерминированным RNG
  private vegGroups: THREE.Group[] = [];
  /** Task 41: ЭФФЕКТИВНЫЕ множители ПО ОСТРОВУ (глобальные ×
   *  переопределения): деревья / деревни / жители / лодки */
  private effTrees: number[] = [];
  private effVillages: number[] = [];
  private effFolk: number[] = [];
  private effBoats: number[] = [];
  /** Task 41: суммарный БЮДЖЕТ деревьев на весь архипелаг:
   *  ×1000 без бюджета = ~30 млн инстансов — убивает GPU и память;
   *  при превышении — пропорциональное сжатие по островам */
  static readonly VEG_BUDGET = 1_500_000;
  /** Task 41: деревьев по островам (телеметрия/E2E) */
  private vegPerIsland: number[] = [];

  // коллайдеры растительности для ПЕШЕХОДА (Task 36): сетка 48 м
  private vegGrid = new Map<number, { x: number; z: number; r: number }[]>();
  private static VEG_CELL = 48;

  constructor(opts?: { visDistance?: number; textures?: AssetsSettings; islands?: IslandsSettings }) {
    if (opts?.visDistance) this.visDistance = opts.visDistance;
    // РЕЛЬЕФ: тайлы вокруг игрока (детальные вблизи, грубые вдали);
    // режим текстур/шейдера — из раздела assets (Task 37)
    this.terrain = new TerrainStreamer({ textures: opts?.textures });
    this.group.add(this.terrain.group);
    // группы островов: сюда складываются растительность, постройки
    // портов/деревень, рыбацкие лодки (Task 40: создаются ЗДЕСЬ,
    // чтобы перестройка растительности не трогала разметку)
    for (let i = 0; i < this.islands.length; i++) {
      const g = new THREE.Group();
      this.islGroups.push(g);
      this.group.add(g);
    }
    // Task 41: МИР ПО НАСТРОЙКАМ ОСТРОВОВ — деревья (до ×1000 с
    // бюджетом), деревни (+ пул), жители, рыбацкие лодки; при
    // первом вызове всё строится с нуля
    this.applyIslandConfig(opts?.islands ?? {
      treesMul: 1, villagesMul: 1, folkMul: 1, boatsMul: 1, perIsland: {},
    });
    this.buildPorts();
    this.buildAnimals();
    // полигоны берега: крупным островам — чаще шаг
    for (let i = 0; i < this.islands.length; i++) {
      this.outlines.push(islandOutline(i, this.islands[i].r > 1500 ? 128 : 72));
    }
    // КАРКАС «треугольники без текстур» (Task 33): категория
    // каждого объекта для настройки. Растительность помечена при
    // сборке ('veg'); всё прочее в мире (рельеф, постройки,
    // причалы, животные) — «острова»
    this.group.traverse((o) => {
      if (!o.userData.wire) o.userData.wire = 'island';
    });
  }

  /** применить настройки текстур/шейдера рельефа (вкладка «Ресурсы») */
  setTerrainAssets(cfg: AssetsSettings) { this.terrain.setTextureConfig(cfg); }

  /** каркас рельефа переносится на ЛЮБОЙ текущий материал рельефа */
  setTerrainWireframe(on: boolean) { this.terrain.setWireframe(on); }

  // ---------- растительность ----------
  // ДЕРЕВЬЯ ПО ОСТРОВУ: раньше все деревья всех островов сидели в
  // ОДНОМ InstancedMesh с frustumCulled=false (мелкий мир — ок);
  // с увеличенными островами это стало ~2× треугольников В КАЖДОМ
  // кадре (даже за спиной). Теперь инстансы ГО на остров — и
  // отсекаются по фрустуму: за бортом рисуются только близкие острова
  private buildVegetation() {
    interface Slot { geo: () => THREE.BufferGeometry; sway: number; }
    const types: Record<string, Slot> = {
      palm: { geo: palmGeo, sway: 0.05 },
      ficus: { geo: ficusGeo, sway: 0.028 },
      jungle: { geo: jungleGeo, sway: 0.035 },
      bush: { geo: bushGeo, sway: 0.05 },
      bamboo: { geo: bambooGeo, sway: 0.06 },
      rock: { geo: rockGeo, sway: 0 },
      stump: { geo: stumpGeo, sway: 0 },
      boulder: { geo: boulderGeo, sway: 0 },
    };
    // радиус ствола для ПЕШЕХОДА (коллайдер): кусты проходимы
    const trunkR: Record<string, number> = {
      palm: 0.4, ficus: 0.6, jungle: 0.5, bamboo: 0.55,
      bush: 0, rock: 1.0, stump: 0.45, boulder: 1.5,
    };
    // Task 41: ПЛОТНОСТЬ ПО ОСТРОВАМ (настройки) + ОБЩИЙ БЮДЖЕТ:
    // желаемое по каждому острову пропорционально площади × множ.
    // острова; если сумма выше бюджета (×1000 просит ~30 млн) —
    // пропорциональное сжатие. Так «×1000» честно даёт максимум,
    // который выдерживает GPU (~1,5 млн инстансов на архипелаг)
    const raws: number[] = [];
    let rawSum = 0;
    for (let i = 0; i < this.islands.length; i++) {
      const isl = this.islands[i];
      const density = isl.type === 'rock' ? 0.35 : isl.type === 'atoll' ? 0.8 : 1.2;
      const area = Math.PI * isl.r * isl.r;
      const raw = Math.max(12, area / 16000 * density * (this.effTrees[i] ?? 1));
      raws.push(raw);
      rawSum += raw;
    }
    const budgetScale = rawSum > World.VEG_BUDGET ? World.VEG_BUDGET / rawSum : 1;
    this.vegBudgetHit = rawSum > World.VEG_BUDGET;
    this.vegPerIsland = new Array(this.islands.length).fill(0);
    // Task 41: ПАМЯТЬ — при ×1000 это ~1,5 млн инстансов. Никаких
    // промежуточных объектов: матрицы пишутся в ОДИН плоский
    // Float32Array на остров (перевыделяется на остров, не на мир),
    // вид — байтовым тегом; временные Vector3/Quaternion/
    // Euler/Matrix4 — переиспользуются (без GC-прессинга)
    const kindNames = Object.keys(types);
    const kindId: Record<string, number> = {};
    kindNames.forEach((k, i) => { kindId[k] = i; });
    const vTmp = new THREE.Vector3();
    const qTmp = new THREE.Quaternion();
    const eTmp = new THREE.Euler();
    const sTmp = new THREE.Vector3();
    const mTmp = new THREE.Matrix4();
    for (let islIdx = 0; islIdx < this.islands.length; islIdx++) {
      const isl = this.islands[islIdx];
      const vegGroup = new THREE.Group();
      this.vegGroups.push(vegGroup);
      this.islGroups[islIdx].add(vegGroup);
      // Task 36: ГРАДИЕНТ РАСТИТЕЛЬНОСТИ — от редких кустов до
      // НЕПРОХОДИМЫХ ДЖУНГЛЕЙ по маске jungleMaskAt; лимит — бюджет
      const target = Math.floor(raws[islIdx] * budgetScale);
      const rng = new RNG(WORLD_SEED + isl.cx * 31 + isl.cz);
      const buf = new Float32Array((target + 8) * 16);  // матрицы 4×4
      const kindOf = new Uint8Array(target + 8);
      const counts = new Uint32Array(kindNames.length);
      let tries = 0;
      let placed = 0;
      while (placed < target && tries < target * 8 + 40) {
        tries++;
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(rng.next()) * isl.r * 1.2;
        const x = isl.cx + Math.cos(a) * rr;
        const z = isl.cz + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 0.75 || h > isl.maxH * 0.92) continue;
        const sl = slopeAt(x, z);
        if (sl > 0.65) continue;
        const mask = jungleMaskAt(islIdx, x, z);
        let kind: string;
        const roll = rng.next();
        if (h < 3.5) {
          kind = isl.type === 'rock'
            ? (roll < 0.4 ? 'rock' : roll < 0.7 ? 'boulder' : 'bush')
            : (roll < 0.58 ? 'palm' : roll < 0.74 ? 'bush' : roll < 0.88 ? 'boulder' : 'rock');
        } else if (mask < 0.35) {
          kind = roll < 0.4 ? 'bush' : roll < 0.62 ? 'palm' : roll < 0.78 ? 'stump' : roll < 0.9 ? 'boulder' : 'ficus';
        } else if (mask < 0.6) {
          kind = roll < 0.34 ? 'bush' : roll < 0.54 ? 'palm' : roll < 0.72 ? 'jungle' : roll < 0.84 ? 'bamboo' : 'ficus';
        } else if (mask < 0.78) {
          kind = roll < 0.42 ? 'jungle' : roll < 0.6 ? 'ficus' : roll < 0.74 ? 'bamboo' : roll < 0.86 ? 'palm' : 'bush';
        } else {
          kind = roll < 0.58 ? 'jungle' : roll < 0.8 ? 'bamboo' : 'ficus';
        }
        const s = rng.range(0.8, 1.55);
        vTmp.set(x, h - 0.15, z);
        eTmp.set(rng.range(-0.06, 0.06), rng.range(0, Math.PI * 2), rng.range(-0.06, 0.06));
        qTmp.setFromEuler(eTmp);
        sTmp.set(s, s * rng.range(0.85, 1.25), s);
        mTmp.compose(vTmp, qTmp, sTmp);
        mTmp.toArray(buf, placed * 16);
        kindOf[placed] = kindId[kind];
        counts[kindId[kind]]++;
        placed++;
        const tr = trunkR[kind] ?? 0.4;
        if (tr > 0) this.addVegCollider(x, z, mask > 0.78 ? tr * 2.6 : tr);
      }
      this.vegPerIsland[islIdx] = placed;
      // разложить по видам в InstancedMesh (копирование из буфера)
      for (let ki = 0; ki < kindNames.length; ki++) {
        const c = counts[ki];
        if (!c) continue;
        const kind = kindNames[ki];
        const geo = types[kind].geo();
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        if (types[kind].sway > 0) applySway(mat, types[kind].sway);
        const inst = new THREE.InstancedMesh(geo, mat, c);
        inst.userData.wire = 'veg';
        const dst = inst.instanceMatrix.array as Float32Array;
        let w = 0;
        for (let i = 0; i < placed; i++) {
          if (kindOf[i] !== ki) continue;
          dst.set(buf.subarray(i * 16, i * 16 + 16), w * 16);
          w++;
        }
        inst.castShadow = true;
        inst.receiveShadow = false;
        inst.frustumCulled = true;
        inst.computeBoundingSphere();
        vegGroup.add(inst);
        // Task 42: LOD-геометрия вида (null → камни: полная дешёвая);
        // кэш один на вид — считается при первом создании
        this.vegSlots.push({
          inst,
          broken: new Array(c).fill(false),
          breakable: kind !== 'rock' && kind !== 'boulder',
          kind,
          procGeo: geo,
          islIdx,
          lodGeo: VEG_LOD_CACHE[kind] ??= VEG_LOD[kind]?.() ?? geo,
          glbGeo: null,
          lod: false,
        });
      }
    }
  }

  /** зарегистрировать коллайдер растительности (сетка 48 м) */
  private addVegCollider(x: number, z: number, r: number) {
    const key = Math.floor(x / World.VEG_CELL) * 100003 + Math.floor(z / World.VEG_CELL);
    let arr = this.vegGrid.get(key);
    if (!arr) { arr = []; this.vegGrid.set(key, arr); }
    arr.push({ x, z, r });
  }

  /** Task 40/41: перестроить растительность (снять старые инстансы,
   *  собрать новые с текущими множителями по островам). Постройки/
   *  деревни/животные не трогаются. GLB-модели и каркас применяются
   *  вызывающим (game.ts) через glbParts.enableAll/applyWireframe. */
  private rebuildVegetation() {
    // снять старые инстансы (геометрию GLB-кэша не трогаем)
    for (const g of this.vegGroups) {
      for (const child of [...g.children]) {
        const inst = child as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          const slot = this.vegSlots.find(s => s.inst === inst);
          if (slot && slot.inst.geometry !== slot.procGeo) slot.procGeo.dispose();
          else inst.geometry.dispose();
          (inst.material as THREE.Material).dispose();
        }
      }
      g.parent?.remove(g);
    }
    this.vegGroups = [];
    this.vegSlots = [];
    this.islLod = new Array(this.islands.length).fill(false);
    this.vegGrid.clear();
    this.treesBroken = 0;
    this.buildVegetation();
    // категория каркаса для новых мешей
    this.group.traverse((o) => {
      if (!o.userData.wire && o.parent && this.vegGroups.some(g => g === o.parent || g === o)) o.userData.wire = 'veg';
    });
  }

  /** Task 41: ПЕРЕСБОРИТЬ деревни и жителей (настройки островов):
   *  активность деревень из пула VILLAGES по villagesMul, число
   *  жителей — folkMul; тропы красят рельеф только активных —
   *  тайлы рельефа пересобираются */
  private rebuildVillages() {
    for (const g of this.villageGroups) g.parent?.remove(g);
    this.villageGroups = [];
    this.villageFolk = [];
    // ФАКТИЧЕСКОЕ число базовых деревень на остров (первый проход
    // генерации мог поставить меньше baseN — плотные условия);
    // множитель считается от него: при ×1 мир = прежний 1:1
    const baseCount: Record<number, number> = {};
    for (const v of VILLAGES) {
      if (v.base) baseCount[v.islandIdx] = (baseCount[v.islandIdx] ?? 0) + 1;
    }
    // активация: первые k деревень острова (базовые идут первыми)
    const activated: Record<number, number> = {};
    for (const v of VILLAGES) {
      const mul = this.effVillages[v.islandIdx] ?? 1;
      const k = Math.max(0, Math.round((baseCount[v.islandIdx] ?? 0) * mul));
      const cur = activated[v.islandIdx] ?? 0;
      v.active = cur < k;
      if (v.active) activated[v.islandIdx] = cur + 1;
    }
    // тропы изменились → перезапечь цвет вершин рельефа
    this.terrain.clear();
    this.buildVillages();
  }

  /** Task 41: ПЕРЕСБОИТЬ рыбацкий флот (boatsMul по островам) */
  private rebuildCoastFleet() {
    if (this.coastFleet) this.group.remove(this.coastFleet.group);
    this.coastFleet = buildCoastFleet(ISLANDS, heightAt, WORLD_SEED + 36,
      { mulAt: (i) => this.effBoats[i] ?? 1 });
    this.group.add(this.coastFleet.group);
  }

  /** Task 41: ПРИМЕНИТЬ НАСТРОЙКИ ОСТРОВОВ — глобальные множители +
   *  переопределения по островам. Перестраивает только изменившееся.
   *  Возвращает сводку для сообщения игроку. */
  applyIslandConfig(cfg: IslandsSettings): { trees: boolean; villages: boolean; boats: boolean } {
    const n = this.islands.length;
    const trees: number[] = [], villages: number[] = [], folk: number[] = [], boats: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = cfg.perIsland[String(i)];
      trees.push(Math.max(0.25, o?.treesMul ?? cfg.treesMul));
      villages.push(Math.max(0, o?.villagesMul ?? cfg.villagesMul));
      folk.push(Math.max(0, o?.folkMul ?? cfg.folkMul));
      boats.push(Math.max(0, o?.boatsMul ?? cfg.boatsMul));
    }
    const changed = (next: number[], cur: number[]) =>
      !cur.length || next.some((v, i) => Math.abs(v - (cur[i] ?? 1)) > 1e-9);
    const treesCh = changed(trees, this.effTrees);
    const villagesCh = changed(villages, this.effVillages);
    const folkCh = changed(folk, this.effFolk);
    const boatsCh = changed(boats, this.effBoats);
    if (treesCh) {
      this.effTrees = trees;
      this.rebuildVegetation();
    }
    if (villagesCh || folkCh) {
      this.effVillages = villages;
      this.effFolk = folk;
      this.rebuildVillages();
    }
    if (boatsCh) {
      this.effBoats = boats;
      this.rebuildCoastFleet();
    }
    return { trees: treesCh, villages: villagesCh || folkCh, boats: boatsCh };
  }

  /** Task 41: сводка мира по настройкам островов (телеметрия/E2E) */
  islandsInfo() {
    let instances = 0;
    for (const s of this.vegSlots) instances += s.inst.count;
    let villagesActive = 0;
    const villagesByIsland: Record<string, number> = {};
    for (const v of VILLAGES) {
      if (v.active === false) continue;
      villagesActive++;
      villagesByIsland[String(v.islandIdx)] = (villagesByIsland[String(v.islandIdx)] ?? 0) + 1;
    }
    let folkTotal = 0;
    for (const f of this.villageFolk) folkTotal += f.total;
    return {
      trees: {
        instances,
        budget: World.VEG_BUDGET,
        budgetHit: this.vegBudgetHit,
        globalMul: this.effTrees.length && this.effTrees.every(v => Math.abs(v - this.effTrees[0]) < 1e-9)
          ? this.effTrees[0] : null,
        perIsland: this.effTrees.map(v => +v.toFixed(2)),
        vegPerIsland: this.vegPerIsland,
      },
      villages: {
        total: VILLAGES.length,
        base: VILLAGES.filter(v => v.base).length,
        active: villagesActive,
        byIsland: villagesByIsland,
        perIsland: this.effVillages.map(v => +v.toFixed(2)),
      },
      folk: {
        total: folkTotal,
        perIsland: this.effFolk.map(v => +v.toFixed(2)),
      },
      boats: {
        n: this.coastFleet ? this.coastFleet.boats.length : 0,
        fishermen: this.coastFleet ? this.coastFleet.fishermen : 0,
        perIsland: this.effBoats.map(v => +v.toFixed(2)),
      },
    };
  }

  /** Выталкивание пешехода из стволов/валунов (Task 36): густые
   *  джунгли (mask>0.78) — сплошная стена. null = чисто */
  collideLand(x: number, z: number, radius: number): { dx: number; dz: number } | null {
    const cx = Math.floor(x / World.VEG_CELL), cz = Math.floor(z / World.VEG_CELL);
    let res: { dx: number; dz: number } | null = null;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const arr = this.vegGrid.get(gx * 100003 + gz);
        if (!arr) continue;
        for (const c of arr) {
          const ddx = x - c.x, ddz = z - c.z;
          const d = Math.hypot(ddx, ddz);
          const min = c.r + radius;
          if (d < min && d > 1e-4) {
            const push = (min - d);
            const ux = ddx / d, uz = ddz / d;
            if (!res) res = { dx: 0, dz: 0 };
            res.dx += ux * push; res.dz += uz * push;
          }
        }
      }
    }
    return res;
  }

  /** Ближайшее НЕсломанное ломаемое растение к точке (E2E).
   *  Task 41: позиция инстанса читается из instanceMatrix */
  nearestCuttable(x: number, z: number, maxR = 60, withCollider = false): { x: number; z: number; kind: string } | null {
    const solidKinds = new Set(['palm', 'ficus', 'jungle', 'bamboo', 'stump']);
    let best: { x: number; z: number; kind: string } | null = null;
    let bestD = maxR;
    for (const slot of this.vegSlots) {
      if (!slot.breakable) continue;
      if (withCollider && !solidKinds.has(slot.kind)) continue;
      const arr = slot.inst.instanceMatrix.array as Float32Array;
      const n = slot.inst.count;
      for (let i = 0; i < n; i++) {
        if (slot.broken[i]) continue;
        const o = i * 16;
        const px = arr[o + 12], pz = arr[o + 14];
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD) { bestD = d; best = { x: px, z: pz, kind: slot.kind }; }
      }
    }
    return best;
  }

  /** Группа острова (постройки деревень/портов складываются сюда) */
  islandGroup(islIdx: number): THREE.Group { return this.islGroups[islIdx]; }


  /** GLB-замена модели: подменить геометрию ВСЕХ инстансов вида
   *  (например пальмы на загруженную .glb). null → вернуть процедурную.
   *  Возвращает число затронутых инстансов.
   *  Task 42: GLB применяется только к БЛИЗКИМ островам — дальние
   *  остаются на упрощённой LOD-модели (экономия и с GLB) */
  swapVegetationModel(kind: string, geo: THREE.BufferGeometry | null): number {
    let n = 0;
    for (const slot of this.vegSlots) {
      if (slot.kind !== kind) continue;
      slot.glbGeo = geo;
      const next = slot.lod ? slot.lodGeo : (geo ?? slot.procGeo);
      if (!next || next === slot.inst.geometry) continue;
      slot.inst.geometry = next;
      slot.inst.geometry.computeBoundingSphere();
      slot.inst.computeBoundingSphere();
      n += slot.inst.count;
    }
    return n;
  }

  /** Task 42: ДЕРЕВЬЯ ДАЛЬНИХ ОСТРОВОВ — УПРОЩЁННЫЕ (LOD).
   *  Порог — от БЕРЕГА острова (свой остров у берега остаётся
   *  детальным); гистерезис против дёрганья на границе */
  private applyIslandLod(islIdx: number, far: boolean) {
    for (const slot of this.vegSlots) {
      if (slot.islIdx !== islIdx) continue;
      slot.lod = far;
      const next = far ? slot.lodGeo : (slot.glbGeo ?? slot.procGeo);
      if (next && next !== slot.inst.geometry) {
        slot.inst.geometry = next;
      }
    }
  }

  /** Телеметрия LOD растительности (E2E): сколько островов на
   *  упрощённых моделях + экономия треугольников на инстанс */
  treeLodInfo(): {
    farIslands: number; nearIslands: number; lodSlots: number; fullSlots: number;
    trisFull: number; trisLod: number; kinds: Record<string, { full: number; lod: number; far: boolean }>;
  } {
    const kinds: Record<string, { full: number; lod: number; far: boolean }> = {};
    const tris = (g: THREE.BufferGeometry) =>
      Math.round((g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3);
    for (const slot of this.vegSlots) {
      const e = kinds[slot.kind] ?? { full: tris(slot.procGeo), lod: tris(slot.lodGeo), far: slot.lod };
      e.far = slot.lod;
      kinds[slot.kind] = e;
    }
    let lodSlots = 0, fullSlots = 0, trisFull = 0, trisLod = 0;
    for (const slot of this.vegSlots) {
      if (slot.lod) { lodSlots++; trisLod += tris(slot.lodGeo) * slot.inst.count; trisFull += tris(slot.procGeo) * slot.inst.count; }
      else fullSlots++;
    }
    return {
      farIslands: this.islLod.filter(Boolean).length,
      nearIslands: this.islLod.length - this.islLod.filter(Boolean).length,
      lodSlots, fullSlots, trisFull, trisLod, kinds,
    };
  }

  /** Телеметрия растительности: вид → {инстансов, вершин, источник} */
  vegStats(): Record<string, { n: number; verts: number; src: 'proc' | 'glb' | 'lod' }> {
    const out: Record<string, { n: number; verts: number; src: 'proc' | 'glb' | 'lod' }> = {};
    for (const slot of this.vegSlots) {
      const v = slot.inst.geometry.getAttribute('position')?.count ?? 0;
      const src = slot.inst.geometry === slot.procGeo ? 'proc'
        : slot.inst.geometry === slot.lodGeo ? 'lod' : 'glb';
      const e = out[slot.kind] ?? { n: 0, verts: v, src };
      e.n += slot.inst.count;
      e.verts = v;
      e.src = src;
      out[slot.kind] = e;
    }
    return out;
  }

  /** Чайки в полёте — телеметрия (E2E: режимы/крены/позиции) */
  gullsPublic(): GullFlight[] { return this.gulls; }

  /** Ядро/книппель валят деревья: ломает экземпляры в радиусе
   *  (дерево разлетается на ТРИ части: пень + ствол + крона —
   *  гибы с гравитацией), возвращает количество поваленных */
  breakTrees(x: number, y: number, z: number, radius: number,
    fx?: { debris: (x: number, y: number, z: number, n?: number, power?: number) => void },
    gibs?: { spawnPart: (pos: THREE.Vector3, vel: THREE.Vector3, sx: number, sy: number, sz: number, hex: number, life?: number) => void }): number {
    let broke = 0;
    const r2 = radius * radius;
    for (const slot of this.vegSlots) {
      if (!slot.breakable) continue;
      const arr = slot.inst.instanceMatrix.array as Float32Array;
      const n = slot.inst.count;
      for (let i = 0; i < n; i++) {
        if (slot.broken[i]) continue;
        // Task 41: позиция/масштаб — прямо из instanceMatrix
        const o = i * 16;
        const px = arr[o + 12], py = arr[o + 13], pz = arr[o + 14];
        const dx = px - x, dz = pz - z, dy = py - y;
        if (dx * dx + dz * dz > r2 || dy < -3 || dy > 9) continue;
        slot.broken[i] = true;
        // масштаб: длина первой колонки матрицы
        const scale = Math.hypot(arr[o], arr[o + 1], arr[o + 2]);
        // спрятать экземпляр: сдвинуть под дно + сжать в точку
        this.dummy.position.set(px, -40, pz);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        slot.inst.setMatrixAt(i, this.dummy.matrix);
        slot.inst.instanceMatrix.needsUpdate = true;
        // щепа и листва из точки удара
        fx?.debris(px, py + 1.6, pz, 12, 1.2);
        // разлом на ТРИ части — куски летят от точки попадания
        if (gibs) this.gibTreePieces(gibs, slot.kind, this._vTmp.set(px, py, pz), Math.max(0.5, scale), { x, y, z });
        broke++;
      }
    }
    this.treesBroken += broke;
    return broke;
  }

  /** рецепты разлома по видам: цвет ствола/кроны, ширина кроны, базовая высота */
  private static readonly TREE_PIECES: Record<string, {
    trunkHex: number; crownHex: number; crownW: number; baseH: number;
  }> = {
    palm: { trunkHex: 0x7a5a38, crownHex: 0x3f7d33, crownW: 2.4, baseH: 8.5 },
    ficus: { trunkHex: 0x6b4e2f, crownHex: 0x2f5e2b, crownW: 3.6, baseH: 7.0 },
    jungle: { trunkHex: 0x6e5230, crownHex: 0x477a34, crownW: 2.8, baseH: 6.8 },
    bamboo: { trunkHex: 0x8a9a3a, crownHex: 0x5c7a3a, crownW: 1.0, baseH: 5.2 },
    bush: { trunkHex: 0x4a7032, crownHex: 0x567b36, crownW: 1.1, baseH: 1.3 },
    rock: { trunkHex: 0x7d7668, crownHex: 0x7d7668, crownW: 1, baseH: 1 },
    stump: { trunkHex: 0x6a4c2e, crownHex: 0x8a6a44, crownW: 0.9, baseH: 1.9 },
    boulder: { trunkHex: 0x8d857a, crownHex: 0x7c756a, crownW: 2.2, baseH: 1.2 },
  };

  /** Три куска вместо дерева: пень у корня, ствол по полёту,
   *  крона вверх; куст целиком — три кома листвы */
  private gibTreePieces(
    gibs: { spawnPart: (pos: THREE.Vector3, vel: THREE.Vector3, sx: number, sy: number, sz: number, hex: number, life?: number) => void },
    kind: string, p: THREE.Vector3, s: number,
    hit: { x: number; y: number; z: number }): void {
    const spec = World.TREE_PIECES[kind] ?? World.TREE_PIECES.jungle;
    const H = Math.max(0.8, spec.baseH * s);      // визуальная высота дерева
    // направление разлёта: от точки попадания к дереву
    const dir = new THREE.Vector3(p.x - hit.x, 0, p.z - hit.z);
    if (dir.lengthSq() < 0.04) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    if (kind === 'bush') {
      // куст без ствола — три кома листвы разного размера
      for (let k = 0; k < 3; k++) {
        const w = (0.5 + k * 0.16) * s;
        gibs.spawnPart(
          new THREE.Vector3(p.x + (Math.random() - 0.5), p.y + 0.35 + k * 0.2, p.z + (Math.random() - 0.5)),
          new THREE.Vector3(dir.x * (2.2 + k * 0.7) + (Math.random() - 0.5) * 1.6,
            1.5 + Math.random() * 1.4, dir.z * (2.2 + k * 0.7) + (Math.random() - 0.5) * 1.6),
          w, w * 0.8, w, k === 1 ? spec.crownHex : spec.trunkHex, 2.4 + Math.random() * 0.8);
      }
      return;
    }
    // 1) ПЕНЬ: нижняя часть ствола оседает у корня
    gibs.spawnPart(
      new THREE.Vector3(p.x, p.y + H * 0.12, p.z),
      new THREE.Vector3(dir.x * 1.5, 0.5, dir.z * 1.5),
      Math.max(0.16, 0.24 * s), Math.max(0.5, H * 0.2), Math.max(0.16, 0.24 * s),
      spec.trunkHex, 3.2);
    // 2) СТВОЛ: средняя часть — по траектории снаряда
    gibs.spawnPart(
      new THREE.Vector3(p.x, p.y + H * 0.55, p.z),
      new THREE.Vector3(dir.x * 4.2 + (Math.random() - 0.5) * 1.6, 2.0 + Math.random(),
        dir.z * 4.2 + (Math.random() - 0.5) * 1.6),
      Math.max(0.13, 0.19 * s), Math.max(1.2, H * 0.33), Math.max(0.13, 0.19 * s),
      spec.trunkHex, 2.8);
    // 3) КРОНА: зелёная шапка вылетает вверх
    const cw = Math.max(0.5, spec.crownW * s);
    gibs.spawnPart(
      new THREE.Vector3(p.x, p.y + H * 0.92, p.z),
      new THREE.Vector3(dir.x * 3.0 + (Math.random() - 0.5) * 2, 3.1 + Math.random() * 1.2,
        dir.z * 3.0 + (Math.random() - 0.5) * 2),
      cw, Math.max(0.4, cw * 0.45), cw, spec.crownHex, 2.3);
  }

  // ---------- порты: по одному на каждом острове, размер по острову ----------
  private buildPorts() {
    const rng = new RNG(WORLD_SEED + 4242);
    this.islands.forEach((isl, idx) => {
      const tier = tierForIsland(isl);
      const dir = idx === 0
        ? new THREE.Vector3(-1, 0, 1).normalize()
        : new THREE.Vector3(isl.cx, 0, isl.cz).normalize();
      let shore = new THREE.Vector3(isl.cx, 0, isl.cz);
      // Task 36: форма+шум вытягивают сушу до ~1.73r — ищем воду до 2.1r
      for (let d = isl.r * 0.4; d < isl.r * 2.1; d += 24) {
        const p = new THREE.Vector3(isl.cx, 0, isl.cz).addScaledVector(dir, d);
        if (heightAt(p.x, p.z) < 0.4) { shore = p; break; }
      }
      // пирсы длиннее (×2.4): конец пирса в судоходной воде
      const dockLen = [62, 86, 110, 124][tier];
      const dockEnd = shore.clone().addScaledVector(dir, dockLen - 8);
      dockEnd.y = 0;
      const hash = Array.from(isl.name).reduce((a, ch) => a + ch.charCodeAt(0) * 7, 3);
      const priceMul = +(0.78 + ((hash * 2654435761) % 1000) / 1000 * 0.54).toFixed(2);
      const population = [
        8 + Math.floor(rng.range(0, 18)),
        40 + Math.floor(rng.range(0, 120)),
        250 + Math.floor(rng.range(0, 450)),
        900 + Math.floor(rng.range(0, 1700)),
      ][tier];
      this.ports.push({
        island: isl, name: isl.name, tier, tierName: TIER_NAMES[tier],
        population, dockEnd, dir, priceMul,
      });
      this.buildPortStructs(this.ports[idx], rng, this.islGroups[idx]);
      this.fishing.push(buildFishingVillage(this.ports[idx], rng, heightAt));
      this.islGroups[idx].add(this.fishing[idx].group);
    });
  }

  /** Геометрия гавани (Task 36: все размеры ×2.2..2.6 — острова ×10):
   *  пирс 62–124 м, хижины 7–8 м, форт 68 м с 8 пушками */
  private buildPortStructs(port: PortDef, rng: RNG, g: THREE.Group) {
    const isl = port.island;
    const tier = port.tier;
    const dir = port.dir;
    const dockLen = [62, 86, 110, 124][tier];
    const shore = port.dockEnd.clone().addScaledVector(dir, -(dockLen - 8));
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x8d867a, roughness: 0.95 });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x6e6759, roughness: 0.95 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.5, metalness: 0.7 });
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const dirA = Math.atan2(dir.x, dir.z);
    // --- пирс ---
    const dock = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.3, dockLen), wood);
    const mid = shore.clone().addScaledVector(dir, dockLen / 2 - 4);
    dock.position.set(mid.x, 1.15, mid.z);
    dock.rotation.y = dirA;
    dock.castShadow = true;
    g.add(dock);
    const nPiles = 12;
    for (let i = 0; i <= nPiles; i++) {
      const p = shore.clone().addScaledVector(dir, i * (dockLen / nPiles));
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 4.4, 6), dark);
        post.position.set(p.x + perp.x * side * 3.4, -0.8, p.z + perp.z * side * 3.4);
        g.add(post);
      }
    }
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6), dark);
      const p = port.dockEnd.clone().add(new THREE.Vector3(perp.x * side * 3.1, 0, perp.z * side * 3.1));
      pole.position.set(p.x, 3.0, p.z);
      g.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb648, emissiveIntensity: 2.2 }));
      lamp.position.set(p.x, 5.2, p.z);
      g.add(lamp);
    }
    // --- хижины ---
    const mkHut = (hp: THREE.Vector3, w: number, dpt: number, wallC: number, roofC: number) => {
      const hut = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(w, 4.2, dpt),
        new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.9 }));
      walls.position.y = 2.1;
      hut.add(walls);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, dpt) * 0.82, 3.4, 4),
        new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.95 }));
      roof.position.y = 5.8;
      roof.rotation.y = Math.PI / 4;
      hut.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 0.18), dark);
      door.position.set(0, 1.3, dpt / 2 + 0.06);
      hut.add(door);
      hut.position.set(hp.x, Math.max(heightAt(hp.x, hp.z), 0.8), hp.z);
      hut.rotation.y = dirA + (rng.next() - 0.5) * 0.5;
      hut.castShadow = true;
      g.add(hut);
    };
    const hutBase = shore.clone().addScaledVector(dir, -38);
    const nHuts = [2, 4, 6, 8][tier];
    const wallColors = [0xbfa27a, 0xc9ad84, 0xa8906a];
    const roofColors = [0xb09055, 0x8a5c38, 0x74553a];
    for (let i = 0; i < nHuts; i++) {
      const row = tier >= 2 ? i % 2 : 0;
      const off = nHuts === 1 ? 0 : (i - (nHuts - 1) / 2) * (tier >= 2 ? 24 : 28);
      const hp = hutBase.clone().addScaledVector(perp, off).addScaledVector(dir, -row * 26);
      mkHut(hp, tier >= 2 ? 8.4 : 7.6, tier >= 2 ? 7 : 6.4, wallColors[i % 3], roofColors[i % 3]);
    }
    // --- городок: рынок и амбар ---
    if (tier >= 2) {
      const market = hutBase.clone().addScaledVector(dir, -58).addScaledVector(perp, 30);
      for (let i = 0; i < 4; i++) {
        const st = new THREE.Group();
        const table = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 2.1), wood);
        table.position.y = 1.0;
        st.add(table);
        for (const sx of [-1.8, 1.8]) for (const sz of [0.8, -0.8]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), dark);
          leg.position.set(sx, 0.5, sz);
          st.add(leg);
        }
        const awn = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 2.8),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0xa3362c : 0x3c6b8a, roughness: 0.9 }));
        awn.position.set(0, 2.5, 0);
        awn.rotation.x = 0.16;
        st.add(awn);
        for (const px of [-2.0, 2.0]) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.5, 0.1), dark);
          pole.position.set(px, 1.25, 1.1);
          st.add(pole);
        }
        const mp = market.clone().addScaledVector(perp, i * 8 - 12);
        st.position.set(mp.x, Math.max(heightAt(mp.x, mp.z), 0.8), mp.z);
        st.rotation.y = dirA + Math.PI / 2;
        g.add(st);
      }
      const wh = hutBase.clone().addScaledVector(dir, -54).addScaledVector(perp, -34);
      const warehouse = new THREE.Group();
      const whWalls = new THREE.Mesh(new THREE.BoxGeometry(13, 6.4, 9),
        new THREE.MeshStandardMaterial({ color: 0x8f7550, roughness: 0.92 }));
      whWalls.position.y = 3.2;
      warehouse.add(whWalls);
      const whRoof = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 13.6, 3, 1),
        new THREE.MeshStandardMaterial({ color: 0x5c4128, roughness: 0.95 }));
      whRoof.rotation.z = Math.PI / 2;
      whRoof.scale.set(1, 1, 0.42);
      whRoof.position.y = 7.4;
      warehouse.add(whRoof);
      warehouse.position.set(wh.x, Math.max(heightAt(wh.x, wh.z), 0.8), wh.z);
      warehouse.rotation.y = dirA;
      warehouse.castShadow = true;
      g.add(warehouse);
    }
    // --- город-крепость: церковь + ФОРТ ---
    if (tier >= 3) {
      const ch = hutBase.clone().addScaledVector(dir, -80).addScaledVector(perp, 52);
      const church = new THREE.Group();
      const nave = new THREE.Mesh(new THREE.BoxGeometry(7, 5.6, 12.6),
        new THREE.MeshStandardMaterial({ color: 0xd8cfbd, roughness: 0.9 }));
      nave.position.y = 2.8;
      church.add(nave);
      const nroof = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 13.4, 3, 1),
        new THREE.MeshStandardMaterial({ color: 0x4a5a6b, roughness: 0.9 }));
      nroof.rotation.z = Math.PI / 2;
      nroof.scale.set(1, 1, 0.46);
      nroof.position.y = 6.4;
      church.add(nroof);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(4.4, 13, 4.4),
        new THREE.MeshStandardMaterial({ color: 0xd8cfbd, roughness: 0.9 }));
      tower.position.set(0, 6.5, 6.4);
      church.add(tower);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(3.3, 4.7, 4),
        new THREE.MeshStandardMaterial({ color: 0x4a5a6b, roughness: 0.85 }));
      spire.position.set(0, 15.4, 6.4);
      spire.rotation.y = Math.PI / 4;
      church.add(spire);
      church.position.set(ch.x, Math.max(heightAt(ch.x, ch.z), 0.8), ch.z);
      church.rotation.y = dirA;
      church.castShadow = true;
      g.add(church);
      const fb = hutBase.clone().addScaledVector(dir, -118);
      const fy = Math.max(heightAt(fb.x, fb.z), 1.0);
      const S = 34;
      const wallH = 9.5, wallT = 2.4;
      const fort = new THREE.Group();
      const wallsSpec: [number, number, number, number][] = [
        [0, S, S * 2, wallT], [0, -S, S * 2, wallT],
        [S, 0, wallT, S * 2], [-S, 0, wallT, S * 2],
      ];
      for (const [wx, wz, ww, wd] of wallsSpec) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, wallH, wd), stone);
        wall.position.set(wx, wallH / 2, wz);
        wall.castShadow = true;
        fort.add(wall);
        for (let k = -S + 2.5; k < S; k += 5.5) {
          const merlon = new THREE.Mesh(new THREE.BoxGeometry(
            ww > wallT ? 2.6 : wallT + 0.4, 2.0, wd > wallT ? 2.6 : wallT + 0.4), stoneDark);
          merlon.position.set(ww > wallT ? k : wx, wallH + 1.0, wd > wallT ? k : wz);
          fort.add(merlon);
        }
      }
      for (const [tx, tz] of [[S, S], [S, -S], [-S, S], [-S, -S]] as [number, number][]) {
        const ftower = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 6.2, wallH + 6.5, 8), stone);
        ftower.position.set(tx, (wallH + 6.5) / 2, tz);
        ftower.castShadow = true;
        fort.add(ftower);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(6.2, 4.4, 8), stoneDark);
        cap.position.set(tx, wallH + 6.5 + 2.2, tz);
        fort.add(cap);
      }
      const mkCannon = (cx: number, cz: number, ry: number) => {
        const cg = new THREE.Group();
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 3.2, 8), iron);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(0, 0.95, 1.4);
        cg.add(barrel);
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 2.1), dark);
        carriage.position.y = 0.4;
        cg.add(carriage);
        for (const wx of [-0.55, 0.55]) {
          const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 5, 10), dark);
          wheel.rotation.y = Math.PI / 2;
          wheel.position.set(wx, 0.42, 0);
          cg.add(wheel);
        }
        cg.position.set(cx, wallH + 0.4, cz);
        cg.rotation.y = ry;
        fort.add(cg);
      };
      for (let i = 0; i < 8; i++) {
        const side = i % 4;
        const k = i < 4 ? -13 : 13;
        if (side === 0) mkCannon(k, S - wallT / 2, dirA);
        else if (side === 1) mkCannon(k, -S + wallT / 2, dirA + Math.PI);
        else if (side === 2) mkCannon(S - wallT / 2, k, dirA + Math.PI / 2);
        else mkCannon(-S + wallT / 2, k, dirA - Math.PI / 2);
      }
      fort.position.set(fb.x, fy, fb.z);
      fort.rotation.y = dirA;
      g.add(fort);
    }
    // --- пиратское логово: чёрный флаг на пирсе ---
    if (isl.name === 'Логово пиратов') {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 40;
      const x2 = c.getContext('2d')!;
      x2.fillStyle = '#0d0a08'; x2.fillRect(0, 0, 64, 40);
      x2.fillStyle = '#e8e4d8';
      x2.beginPath(); x2.arc(32, 16, 8, 0, Math.PI * 2); x2.fill();
      x2.save(); x2.translate(32, 27); x2.rotate(0.5); x2.fillRect(-16, -1.5, 32, 3); x2.restore();
      x2.save(); x2.translate(32, 27); x2.rotate(-0.5); x2.fillRect(-16, -1.5, 32, 3); x2.restore();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 13, 6), dark);
      const fp = port.dockEnd.clone().addScaledVector(dir, -5).add(new THREE.Vector3(perp.x * 4.6, 0, perp.z * 4.6));
      pole.position.set(fp.x, 7.4, fp.z);
      g.add(pole);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 3.3),
        new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
      banner.position.set(fp.x + 2.7, 12.2, fp.z);
      banner.rotation.y = dirA + Math.PI / 2;
      g.add(banner);
    }
    // --- пальмы у гавани ---
    const nPalms = [8, 22, 36, 48][tier];
    for (let i = 0; i < nPalms; i++) {
      const a = rng.range(0, Math.PI * 2), rr = rng.range(30, 120);
      const x = hutBase.x + Math.cos(a) * rr, z = hutBase.z + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 1.0 || h > 14) continue;
      const palm = new THREE.Mesh(palmGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      const s = rng.range(0.9, 1.5);
      palm.scale.setScalar(s);
      palm.position.set(x, h - 0.1, z);
      palm.rotation.y = rng.range(0, 7);
      palm.castShadow = true;
      g.add(palm);
    }
  }


  // ---------- ДЕРЕВНИ (Task 36): небольшие посёлки в глубине
  // островов — хижины вокруг центра, костёр, сушила сетей;
  // жители ходят по тропам к порту (islandFolk.buildVillageFolk) ----------
  private buildVillages() {
    const rng = new RNG(WORLD_SEED + 8181);
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    for (const v of VILLAGES) {
      // Task 41: неактивные деревни (настройки острова) не строятся
      if (v.active === false) continue;
      const isl = this.islands[v.islandIdx];
      const g = new THREE.Group();
      this.villageGroups.push(g);
      this.islGroups[v.islandIdx].add(g);
      const dirA = Math.atan2(v.x - isl.cx, v.z - isl.cz);
      const wallColors = [0xbfa27a, 0xc9ad84, 0xa8906a];
      const roofColors = [0xb09055, 0x8a5c38, 0x74553a];
      for (let i = 0; i < v.huts; i++) {
        const ring = i % 2;
        const a = (i / v.huts) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const rad = ring ? 9 : 17;
        const hx = v.x + Math.cos(a) * rad;
        const hz = v.z + Math.sin(a) * rad;
        const h = heightAt(hx, hz);
        if (h < 0.8) continue;
        const hut = new THREE.Group();
        const w = 5.6 + rng.range(0, 1.6), dpt = 4.8 + rng.range(0, 1.2);
        const walls = new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, dpt),
          new THREE.MeshStandardMaterial({ color: wallColors[i % 3], roughness: 0.9 }));
        walls.position.y = 1.7;
        hut.add(walls);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, dpt) * 0.85, 2.8, 4),
          new THREE.MeshStandardMaterial({ color: roofColors[i % 3], roughness: 0.95 }));
        roof.position.y = 4.8;
        roof.rotation.y = Math.PI / 4;
        hut.add(roof);
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.16), dark);
        door.position.set(0, 1.15, dpt / 2 + 0.06);
        hut.add(door);
        hut.position.set(hx, h, hz);
        hut.rotation.y = dirA + rng.range(-0.6, 0.6);
        hut.castShadow = true;
        g.add(hut);
      }
      const fire = new THREE.Group();
      const stones = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.18, 5, 9),
        new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 1 }));
      stones.rotation.x = Math.PI / 2;
      fire.add(stones);
      const logs = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.5, 5),
        new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95 }));
      logs.position.y = 0.75;
      fire.add(logs);
      fire.position.set(v.x, v.h, v.z);
      g.add(fire);
      const rack = new THREE.Group();
      for (const sx of [-2.2, 2.2]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.0, 0.16), dark);
        pole.position.set(sx, 1.5, 0);
        rack.add(pole);
      }
      const net = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x8a8272, roughness: 1 }));
      net.position.y = 2.1;
      rack.add(net);
      const rx = v.x + Math.cos(dirA) * 13, rz = v.z + Math.sin(dirA) * 13;
      rack.position.set(rx, heightAt(rx, rz), rz);
      rack.rotation.y = dirA + Math.PI / 2;
      g.add(rack);
      const folk = buildVillageFolk(v, {
        heightAt, seed: WORLD_SEED + v.x * 7 + v.z,
        folkMul: this.effFolk[v.islandIdx] ?? 1,   // Task 41: жители — настройка острова
      });
      this.villageFolk.push(folk);
      g.add(folk.group);
      g.add(folk.props);
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
    // СТАИ: 30 чаек кружат над тремя островами, 12 — ХОДЯТ ЗА КОРАБЛЁМ
    // игрока (кружат вокруг судна, снижаясь к корме — живая деталь)
    const flockIslands = [this.islands[0], this.islands[0], this.islands[4]];
    for (let i = 0; i < 42; i++) {
      const shipFollower = i >= 30;
      const isl = shipFollower ? this.islands[0] : flockIslands[Math.floor(i / 10)];
      const ang = rng.range(0, Math.PI * 2);
      const orbitR = shipFollower ? rng.range(16, 40) : rng.range(isl.r * 0.45, isl.r * 1.0);
      this.gulls.push({
        mode: shipFollower ? 'ship' : 'island',
        island: isl,
        x: isl.cx + Math.cos(ang) * orbitR,
        z: isl.cz + Math.sin(ang) * orbitR,
        y: rng.range(16, 44),
        hdg: ang + (rng.next() < 0.5 ? 1 : -1) * Math.PI / 2, // сразу по касательной
        spd: rng.range(6.5, 11.5),
        turn: 0, bank: 0,
        retarget: rng.range(0.5, 6),
        orbit: rng.next() < 0.5 ? 1 : -1,
        orbitR,
        baseY: rng.range(16, 42),
        phase: rng.range(0, Math.PI * 2),
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
      // крабы живут на ПЛЯЖЕ (h 0.15..1.8): с неправильной формой
      // берега ищем подходящую точку блужданием от береговой линии
      const islIdx = this.islands.indexOf(isl);
      let x = isl.cx, z = isl.cz, ok = false;
      for (let t = 0; t < 24 && !ok; t++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = coastRadiusAt(islIdx, a) + rng.range(-6, 5); // чуть вглубь от кромки
        x = isl.cx + Math.cos(a) * rr;
        z = isl.cz + Math.sin(a) * rr;
        ok = heightAt(x, z) > 0.15 && heightAt(x, z) < 1.8;
      }
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
      const islIdx = this.islands.indexOf(isl);
      // радиус круга — ЗА береговой линией в его направлении
      // (острова неправильной формы: фиксированный r выходил бы на сушу)
      const a0 = rng.range(0, Math.PI * 2);
      this.turtles.push({ island: isl, a: a0, r: coastRadiusAt(islIdx, a0) + rng.range(12, 42), speed: rng.range(0.015, 0.05), h: 0, phase: rng.range(0, 7) });
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

    // РЕЛЬЕФ-СТРИМЕР (Task 36): тайлы вокруг игрока
    this.terrain.update(playerPos, dt);

    // видимость ОСТРОВОВ: группа острова (растительность+порт+
    // деревни) рисуется только в пределах дальности прорисовки;
    // Task 42: LOD ДЕРЕВЬЕВ — видимому, но ДАЛЬНЕМУ острову (за
    // порогом от БЕРЕГА) растительность рисуется УПРОЩЁННО
    for (let i = 0; i < this.islands.length; i++) {
      const isl = this.islands[i];
      const d = Math.hypot(playerPos.x - isl.cx, playerPos.z - isl.cz);
      const vis = d < this.visDistance + isl.r * 1.35;
      const g = this.islGroups[i];
      if (g && g.visible !== vis) g.visible = vis;
      if (vis && this.islLod.length === this.islands.length) {
        const off = d - isl.r;   // дистанция до БЕРЕГА
        const far = this.islLod[i] ? off > World.TREE_LOD_NEAR : off > World.TREE_LOD_DIST;
        if (far !== this.islLod[i]) {
          this.islLod[i] = far;
          this.applyIslandLod(i, far);
        }
      }
    }

    // рыбацкие деревни: лодки качаются на волнах / тонут, поплавки,
    // рыбаки покачиваются. Далёкие гавани (за туманом) — скрываем:
    // не тратим ни апдейт, ни draw calls
    for (const fv of this.fishing) {
      const anchor = fv.boats[0];
      const d = anchor
        ? Math.hypot(anchor.x - playerPos.x, anchor.z - playerPos.z)
        : 0;
      const vis = d < 4800;
      if (fv.group.visible !== vis) fv.group.visible = vis;
      if (vis) fv.update(time, dt, waterHeight);
    }

    // РЫБАЦКИЕ ЛОДКИ вокруг островов (Task 36)
    this.coastFleet.update(time, dt, waterHeight, { x: playerPos.x, z: playerPos.z });

    // ЖИТЕЛИ ДЕРЕВЕНЬ: ходят по тропам к порту
    for (let i = 0; i < this.villageFolk.length; i++) {
      const folk = this.villageFolk[i];
      const v = VILLAGES[i];
      const near = Math.hypot(v.x - playerPos.x, v.z - playerPos.z) < 2600;
      if (near) folk.update(dt, time, { x: playerPos.x, z: playerPos.z });
    }

    // чайки — НАСТОЯЩИЙ ПОЛЁТ: курс/скорость/крен, кружение над
    // островом или за кораблём игрока, высотная качка, обход вершин
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i];
      // якорь кружения: центр острова или позиция судна игрока
      const ax = g.mode === 'ship' ? playerPos.x : g.island.cx;
      const az = g.mode === 'ship' ? playerPos.z : g.island.cz;
      // смена манёвра раз в несколько секунд (разворот/смена высоты)
      g.retarget -= dt;
      if (g.retarget < 0) {
        g.retarget = 3 + Math.random() * 5;
        if (Math.random() < 0.3) g.orbit = (g.orbit === 1 ? -1 : 1);
        g.baseY = THREE.MathUtils.clamp(g.baseY + (Math.random() - 0.5) * 22, 12, 46);
        if (g.mode === 'ship' && Math.random() < 0.4) g.orbitR = 14 + Math.random() * 26;
      }
      // руление: касательная к орбите + коррекция радиуса (ПО ЗНАКУ
      // направления круга — иначе контр-орбита уходит от якоря).
      // Далеко (dist > orbitR+35): снос −1.4 рад — курс почти ПРЯМО
      // на якорь (стая доходит до судна за минуту); в кольце орбиты —
      // чистая касательная (кружение); слишком близко — мягко наружу
      const toAx = ax - g.x, toAz = az - g.z;
      const dist = Math.max(1, Math.hypot(toAx, toAz));
      const ang = Math.atan2(toAz, toAx);
      const radial = THREE.MathUtils.clamp((g.orbitR - dist) / 25, -1.4, 0.3);
      const want = ang + g.orbit * (Math.PI / 2 + radial);
      let dH = want - g.hdg;
      dH = Math.atan2(Math.sin(dH), Math.cos(dH));
      // плавный поворот с ограничением (не «телепорт» курса)
      const turnTarget = THREE.MathUtils.clamp(dH * 1.6, -1.05, 1.05);
      g.turn += (turnTarget - g.turn) * Math.min(1, dt * 2.5);
      g.hdg += g.turn * dt;
      g.x += Math.cos(g.hdg) * g.spd * dt;
      g.z += Math.sin(g.hdg) * g.spd * dt;
      // высота: крейсерская ± медленная качка; за кораблём — ниже
      const targetY = (g.mode === 'ship' ? Math.min(g.baseY, 26) : g.baseY)
        + Math.sin(time * 0.6 + g.phase) * 3.2;
      g.y += (targetY - g.y) * Math.min(1, dt * 0.9);
      // не врезаться в склон: держим запас над рельефом
      const th = heightAt(g.x, g.z);
      if (g.y < th + 9) g.y = th + 9;
      // крен в поворот (в сторону дуги)
      const bankT = THREE.MathUtils.clamp(-g.turn * 0.85, -0.8, 0.8);
      g.bank += (bankT - g.bank) * Math.min(1, dt * 3);
      this.dummy.position.set(g.x, g.y, g.z);
      // геометрия смотрит носом в +Z: курс (cos,sin) → yaw = π/2 − hdg
      this.dummy.quaternion.copy(this.tmpQ.setFromEuler(this.tmpE.set(0, Math.PI / 2 - g.hdg, g.bank, 'YXZ')));
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

  /** Разрыв снаряда в точке (x,z): топит рыбацкие шлюпки всех гаваней
   *  в радиусе r. Возвращает поражённые лодки (для щепы/сообщений). */
  hitBoats(x: number, z: number, r: number): WorldBoat[] {
    const out: WorldBoat[] = [];
    for (const fv of this.fishing) out.push(...fv.hitBoats(x, z, r));
    return out;
  }

  /** Сколько шлюпок на плаву (телеметрия/E2E) */
  boatsFloating(): number {
    let n = 0;
    for (const fv of this.fishing) for (const b of fv.boats) if (!b.sinking) n++;
    return n;
  }

  /** Всего шлюпок в архипелаге (телеметрия/E2E) */
  boatsTotal(): number {
    let n = 0;
    for (const fv of this.fishing) n += fv.boats.length;
    return n;
  }
}
