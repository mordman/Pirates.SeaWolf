#!/usr/bin/env python3
# Task 36 — ПОЛНОЕ ВОССТАНОВЛЕНИЕ после отката песочницы.
# Применяет все правки Task 36 к исходникам (повторно).
import sys

def patch(path, edits, must=True):
    src = open(path).read()
    for old, new in edits:
        if old not in src:
            if must:
                print(f'FAIL {path}: not found:\n{old[:120]}')
                sys.exit(1)
            else:
                print(f'  skip (already applied?): {old[:60]}')
                continue
        src = src.replace(old, new, 1)
    open(path, 'w').write(src)
    print(f'OK {path}')

# ============ 1. world.ts ============
w = []
# 1.1 пороги tier ×10 + WORLD_SCALE
w.append(("""function tierForIsland(isl: IslandDef): 0 | 1 | 2 | 3 {
  if (isl.r >= 270) return 3;
  if (isl.r >= 200) return 2;
  if (isl.r >= 135) return 1;
  return 0;
}""", """function tierForIsland(isl: IslandDef): 0 | 1 | 2 | 3 {
  // пороги ×10: острова выросли вдесятеро (Task 36)
  if (isl.r >= 2700) return 3;
  if (isl.r >= 2000) return 2;
  if (isl.r >= 1350) return 1;
  return 0;
}

/** множитель масштаба мира (Task 36): карта и острова в 100 раз
 *  больше по ПЛОЩАДИ — радиусы и дистанции ×10 */
export const WORLD_SCALE = 10;"""))
# 1.2 BASE_ISLANDS ×10
w.append(("""const BASE_ISLANDS: IslandDef[] = [
  { cx: 675, cz: 525, r: 330, maxH: 30, type: 'port', name: 'Пальмовая гавань', discovered: false },
  { cx: -975, cz: 750, r: 235, maxH: 16, type: 'jungle', name: 'Зелёный атолл', discovered: false },
  { cx: -780, cz: -1050, r: 120, maxH: 34, type: 'rock', name: 'Скала Морского Дьявола', discovered: false },
  { cx: 1350, cz: -930, r: 145, maxH: 11, type: 'atoll', name: 'Черепаший риф', discovered: false },
  { cx: 2100, cz: 1350, r: 290, maxH: 23, type: 'jungle', name: 'Остров Бакунов', discovered: false },
  { cx: -2250, cz: -330, r: 205, maxH: 18, type: 'jungle', name: 'Дальний ключ', discovered: false },
  { cx: -1575, cz: 1725, r: 105, maxH: 27, type: 'rock', name: 'Клык', discovered: false },
  { cx: 375, cz: -2100, r: 255, maxH: 13, type: 'atoll', name: 'Плёс', discovered: false },
  { cx: 4400, cz: 3050, r: 205, maxH: 20, type: 'jungle', name: 'Логово пиратов', discovered: false },
];""", """const BASE_ISLANDS: IslandDef[] = [
  { cx: 6750, cz: 5250, r: 3300, maxH: 300, type: 'port', name: 'Пальмовая гавань', discovered: false },
  { cx: -9750, cz: 7500, r: 2350, maxH: 210, type: 'jungle', name: 'Зелёный атолл', discovered: false },
  { cx: -7800, cz: -10500, r: 1200, maxH: 320, type: 'rock', name: 'Скала Морского Дьявола', discovered: false },
  { cx: 13500, cz: -9300, r: 1450, maxH: 80, type: 'atoll', name: 'Черепаший риф', discovered: false },
  { cx: 21000, cz: 13500, r: 2900, maxH: 260, type: 'jungle', name: 'Остров Бакунов', discovered: false },
  { cx: -22500, cz: -3300, r: 2050, maxH: 190, type: 'jungle', name: 'Дальний ключ', discovered: false },
  { cx: -15750, cz: 17250, r: 1050, maxH: 250, type: 'rock', name: 'Клык', discovered: false },
  { cx: 3750, cz: -21000, r: 2550, maxH: 85, type: 'atoll', name: 'Плёс', discovered: false },
  { cx: 44000, cz: 30500, r: 2050, maxH: 230, type: 'jungle', name: 'Логово пиратов', discovered: false },
];"""))
# 1.3 generateIslands ×10 + 21 остров
w.append(("""  while (out.length < 11 && guard++ < 900) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1700, 4200);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d * 0.82; // мир чуть шире по X — под карту 640×520
    if (Math.abs(cx) > 4500 || Math.abs(cz) > 3600) continue;
    const roll = rng.next();
    const type: IslandDef['type'] = roll < 0.5 ? 'jungle' : roll < 0.78 ? 'rock' : 'atoll';
    const r = rng.range(120, 330);
    // проливы не уже 800 м между берегами
    let ok = true;
    for (const isl of [...BASE_ISLANDS, ...out]) {
      if (Math.hypot(cx - isl.cx, cz - isl.cz) < isl.r + r + 800) { ok = false; break; }
    }
    if (!ok) continue;
    const maxH = type === 'rock' ? rng.range(22, 40) : type === 'jungle' ? rng.range(12, 30) : rng.range(7, 13);""", """  while (out.length < 21 && guard++ < 2400) {
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
    const maxH = type === 'rock' ? rng.range(200, 340) : type === 'jungle' ? rng.range(120, 260) : rng.range(60, 95);"""))
# 1.3b пул имён длиннее
w.append(("""    'Перьевой атолл', 'Голый риф', 'Отмель Мёртвого Якоря', 'Тихая банка',
  ];""", """    'Перьевой атолл', 'Голый риф', 'Отмель Мёртвого Якоря', 'Тихая банка',
    'Зубы Кракена', 'Сиреневый пролив', 'Костяной мыс', 'Залив Скелетов',
    'Пальмовый рукав', 'Медный берег', 'Дырявый котёл', 'Слепая бухта',
    'Остров Трёх Ветров',
  ];"""))
# 1.4 заголовок generateIslands
w.append(("""/** Процедурная генерация архипелага: детерминированно по сиду —
 *  кольцом вокруг порта, с минимальными проливами между островами
 *  (увеличенная карта: дистанции 1700–4200 м, радиусы 120–330 м,
 *  проливы не уже 800 м).
 *  Базовые острова не трогаем (животные/порт привязаны к индексам). */""", """/** Процедурная генерация архипелага: детерминированно по сиду —
 *  кольцом вокруг порта, с минимальными проливами между островами
 *  (УВЕЛИЧЕННАЯ карта Task 36: дистанции 17–42 км, радиусы
 *  1.2–3.3 км, проливы не уже 6 км).
 *  Базовые острова не трогаем (животные/порт привязаны к индексам). */"""))
# 1.5 heightAt — берега/горы
w.append(("""/** Высота суши в мировой точке. Открытое море = -14 (глубина), суша > 0.
 *  Берег «неправильный» (гармоники по направлению) и БЕЗ широких
 *  отмелей: от кромки воды до глубины ~10% радиуса — судно подходит
 *  к самому берегу, не цепляя мель за сотни метров. */
export function heightAt(x: number, z: number): number {
  let h = -14; // дно открытого моря
  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    const dx = x - isl.cx, dz = z - isl.cz;
    const d = Math.hypot(dx, dz);
    if (d > isl.r * 2.1) continue; // дальше — уже только дно (1.42·1.22·1.18 ≈ 2.05r)
    // радиус берега в ЭТОМ направлении: форма × мелкий рваный шум кромки
    const shape = coastShape(i, Math.atan2(dz, dx));
    const coastNoise = fbm2(x * 0.008, z * 0.008, 3, WORLD_SEED + isl.r);
    const rEff = isl.r * shape * (0.80 + 0.42 * coastNoise);
    if (d > rEff * 1.35) continue;
    const fall = smoothstep(1.10, 0.30, d / rEff);
    const detail = 0.55 + 0.45 * fbm2(x * 0.02, z * 0.02, 4, WORLD_SEED + isl.cx);
    const ridge = isl.type === 'rock' ? Math.pow(fall, 1.6) : fall;
    let hi = isl.maxH * ridge * detail - 2.6;
    // обрыв к дну сразу за кромкой (узкая полоса мелководья)
    hi = THREE.MathUtils.lerp(hi, -14, smoothstep(1.00, 1.18, d / rEff));
    if (hi > h) h = hi;
  }
  return h;
}""", """// ---------- РАЗНООБРАЗНЫЕ БЕРЕГА (Task 36): пляж / каменистый / обрыв ----------
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
}"""))
# 1.6 коммент к BASE_ISLANDS
w.append(("""// 8 «рукописных» островов (порт + ориентиры) — их индексы используют животные.
// Мир УВЕЛИЧЕН по ТЗ: острова крупнее (×1.3–1.5) и дальше друг от
// друга, база архипелага растянута до ±2.2 км, генерация — до ±4.5 км.""",
"""// 9 «рукописных» островов (порт + ориентиры) — их индексы используют животные.
// Task 36: КАРТА И ОСТРОВА ×10 (площадь ×100): острова 1–3.3 км радиусом
// с настоящими горами (до 340 м), карта растянута до ±45 км."""))
patch('src/game/world/world.ts', w)
