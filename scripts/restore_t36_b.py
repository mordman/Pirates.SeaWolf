#!/usr/bin/env python3
# Task 36 восстановление — world.ts часть B: деревни/тропы/маска/цвет + класс World
import sys

def patch(path, edits):
    src = open(path).read()
    for old, new in edits:
        if old not in src:
            print(f'FAIL {path}: not found:\n{old[:150]}')
            sys.exit(1)
        src = src.replace(old, new, 1)
    open(path, 'w').write(src)
    print(f'OK {path}')

src = open('src/game/world/world.ts').read()
lines = src.split('\n')

def find_block(start_pat, end_pat):
    s = e = None
    for i, l in enumerate(lines):
        if s is None and l.strip().startswith(start_pat): s = i
        if s is not None and l.strip().startswith(end_pat):
            e = i
            return s, e
    return None, None

# ---------- вставка данных деревень/троп/маски/цвета после slopeAt ----------
VILLAGE_DATA = '''// ---------- ДЕРЕВНИ И ТРОПЫ (Task 36) ----------
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
}
export const VILLAGES: VillageDef[] = (function buildVillages() {
  const out: VillageDef[] = [];
  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    if (isl.r < 1200) continue;               // мелкие острова — без деревень
    const rng = new RNG(WORLD_SEED * 13 + i * 331 + 7);
    const n = Math.max(2, Math.min(6, Math.round(isl.r / 650)));
    const dirA = i === 0 ? Math.atan2(1, -1) : Math.atan2(isl.cz, isl.cx);
    const ux = Math.cos(dirA), uz = Math.sin(dirA);
    let shore = { x: isl.cx, z: isl.cz };
    for (let d = 0; d < isl.r * 1.5; d += 24) {
      if (heightAt(isl.cx + ux * d, isl.cz + uz * d) < 0.4) break;
      shore = { x: isl.cx + ux * d, z: isl.cz + uz * d };
    }
    let made = 0, tries = 0;
    while (made < n && tries++ < 220) {
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
      out.push({ islandIdx: i, x: Math.round(x), z: Math.round(z), h, huts: 4 + Math.floor(rng.next() * 6), trail });
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

/** Расстояние до ближайшей тропы/деревни острова */
function trailDist(islandIdx: number, x: number, z: number): number {
  let best = Infinity;
  for (const v of VILLAGES) {
    if (v.islandIdx !== islandIdx) continue;
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
'''
# найти конец slopeAt и вставить после
slope_end = None
for i, l in enumerate(lines):
    if l.strip() == '}' and i > 0 and 'return Math.hypot(hx, hz) / (2 * e);' in lines[i-1]:
        slope_end = i
        break
assert slope_end, 'slopeAt not found'
lines[slope_end + 1:slope_end + 1] = VILLAGE_DATA.split('\n')
open('src/game/world/world.ts', 'w').write('\n'.join(lines))
print('OK village data inserted after line', slope_end)
