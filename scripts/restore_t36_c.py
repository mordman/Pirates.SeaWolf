#!/usr/bin/env python3
# Task 36 восстановление — world.ts часть C: класс World (terrain/fleet/folk,
# растительность-градиент+коллайдеры, порты ×10, деревни, update)
import sys

src = open('src/game/world/world.ts').read()

# 1) импорты
old = """import { buildFishingVillage, type FishingVillage, type WorldBoat } from './fishing';"""
new = """import { buildFishingVillage, type FishingVillage, type WorldBoat, buildCoastFleet, type CoastFleet } from './fishing';
import { TerrainStreamer } from './terrain';
import { buildVillageFolk, type LandFolk } from './islandFolk';"""
assert old in src, 'imports'
src = src.replace(old, new)

# 2) поля класса + конструктор
old = """export class World {
  group = new THREE.Group();
  fishing: FishingVillage[] = []; // рыбацкий декор каждой гавани
  islands: IslandDef[] = ISLANDS;
  /** все гавани архипелага — по одной на каждом острове */
  ports: PortDef[] = [];
  /** главная гавань (остров 0) — прежнее имя поля для совместимости */
  get port(): PortDef { return this.ports[0]; }
  discovered = new Set<string>();"""
new = """export class World {
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
  coastFleet: CoastFleet;
  /** жители деревень (по деревне на остров) — ходят по тропам */
  villageFolk: LandFolk[] = [];
  /** группы деревень (видимость по дистанции) */
  private villageGroups: THREE.Group[] = [];
  /** дальность видимости статики мира (настройка графики, м) */
  visDistance = 5600;"""
assert old in src, 'class fields'
src = src.replace(old, new)

old = """  /** полигоны береговой линии всех островов (для карт и телеметрии) */
  outlines: { x: number; z: number }[][] = [];

  constructor() {
    this.buildIslands();
    this.buildVegetation();
    this.buildPorts();
    this.buildAnimals();
    // полигоны берега (неправильная форма) — для карт: считаем раз
    for (let i = 0; i < this.islands.length; i++) this.outlines.push(islandOutline(i, 56));"""
new = """  /** полигоны береговой линии всех островов (для карт и телеметрии) */
  outlines: { x: number; z: number }[][] = [];

  // группы островов: растительность/постройки/деревни острова — в
  // своей группе (видимость по дистанции до игрока)
  private islGroups: THREE.Group[] = [];

  // коллайдеры растительности для ПЕШЕХОДА (Task 36): сетка 48 м
  private vegGrid = new Map<number, { x: number; z: number; r: number }[]>();
  private static VEG_CELL = 48;

  constructor(opts?: { visDistance?: number; textures?: boolean }) {
    if (opts?.visDistance) this.visDistance = opts.visDistance;
    // РЕЛЬЕФ: тайлы вокруг игрока (детальные вблизи, грубые вдали)
    this.terrain = new TerrainStreamer({ textures: opts?.textures ?? true });
    this.group.add(this.terrain.group);
    this.buildVegetation();
    this.buildPorts();
    this.buildVillages();
    this.coastFleet = buildCoastFleet(ISLANDS, heightAt, WORLD_SEED + 36);
    this.group.add(this.coastFleet.group);
    this.buildAnimals();
    // полигоны берега: крупным островам — чаще шаг
    for (let i = 0; i < this.islands.length; i++) {
      this.outlines.push(islandOutline(i, this.islands[i].r > 1500 ? 128 : 72));
    }"""
assert old in src, 'constructor'
src = src.replace(old, new)

# 3) удалить buildIslands (замена — terrain streamer)
lines = src.split('\n')
start = end = None
for i, l in enumerate(lines):
    if l.strip().startswith('// ---------- острова ----------') and start is None and i > 600:
        start = i
    if start is not None and l.strip().startswith('// ---------- растительность ----------'):
        end = i
        break
assert start is not None and end is not None, f'buildIslands block {start}..{end}'
del lines[start:end]
src = '\n'.join(lines)

# 4) buildVegetation — градиент + коллайдеры (заменить метод целиком)
lines = src.split('\n')
vs = ve = None
for i, l in enumerate(lines):
    if l.strip().startswith('private buildVegetation() {'):
        vs = i
    if vs is not None and l.strip().startswith('/** GLB-замена модели:'):
        ve = i
        break
assert vs is not None and ve is not None
NEW_VEG = '''  private buildVegetation() {
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
    const perIsland: { islIdx: number; byKind: Record<string, { m: THREE.Matrix4; islandType: string; h: number; mask: number }[]> }[] = [];
    for (let islIdx = 0; islIdx < this.islands.length; islIdx++) {
      const isl = this.islands[islIdx];
      const islGroup = new THREE.Group();
      this.islGroups.push(islGroup);
      this.group.add(islGroup);
      // Task 36: ГРАДИЕНТ РАСТИТЕЛЬНОСТИ — от редких кустов до
      // НЕПРОХОДИМЫХ ДЖУНГЛЕЙ по маске jungleMaskAt; лимит инстансов
      const density = isl.type === 'rock' ? 0.35 : isl.type === 'atoll' ? 0.8 : 1.2;
      const area = Math.PI * isl.r * isl.r;
      const target = Math.floor(Math.min(2600, Math.max(60, area / 16000 * density)));
      const rng = new RNG(WORLD_SEED + isl.cx * 31 + isl.cz);
      const byKind: Record<string, { m: THREE.Matrix4; islandType: string; h: number; mask: number }[]> = {};
      for (const k of Object.keys(types)) byKind[k] = [];
      let tries = 0;
      let placed = 0;
      while (placed < target && tries < target * 12) {
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
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, h - 0.15, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.06, 0.06), rng.range(0, Math.PI * 2), rng.range(-0.06, 0.06))),
          new THREE.Vector3(s, s * rng.range(0.85, 1.25), s));
        byKind[kind].push({ m, islandType: isl.type, h, mask });
        placed++;
        const tr = trunkR[kind] ?? 0.4;
        if (tr > 0) this.addVegCollider(x, z, mask > 0.78 ? tr * 2.6 : tr);
      }
      perIsland.push({ islIdx, isl, byKind });
    }
    for (const { islIdx, byKind } of perIsland) {
      const islGroup = this.islGroups[islIdx];
      for (const [kind, list] of Object.entries(byKind)) {
        if (!list.length) continue;
        const geo = types[kind].geo();
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        if (types[kind].sway > 0) applySway(mat, types[kind].sway);
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        inst.userData.wire = 'veg';
        list.forEach((p, i) => inst.setMatrixAt(i, p.m));
        inst.castShadow = true;
        inst.receiveShadow = false;
        inst.frustumCulled = true;
        inst.computeBoundingSphere();
        islGroup.add(inst);
        const positions = list.map((p) => new THREE.Vector3().setFromMatrixPosition(p.m));
        this.vegSlots.push({
          inst, positions,
          broken: new Array(list.length).fill(false),
          breakable: kind !== 'rock' && kind !== 'boulder',
          kind,
          scales: list.map((p) => Math.max(0.5, new THREE.Vector3().setFromMatrixScale(p.m).y)),
          procGeo: geo,
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

  /** Ближайшее НЕсломанное ломаемое растение к точке (E2E) */
  nearestCuttable(x: number, z: number, maxR = 60, withCollider = false): { x: number; z: number; kind: string } | null {
    const solidKinds = new Set(['palm', 'ficus', 'jungle', 'bamboo', 'stump']);
    let best: { x: number; z: number; kind: string } | null = null;
    let bestD = maxR;
    for (const slot of this.vegSlots) {
      if (!slot.breakable) continue;
      if (withCollider && !solidKinds.has(slot.kind)) continue;
      for (let i = 0; i < slot.positions.length; i++) {
        if (slot.broken[i]) continue;
        const p = slot.positions[i];
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) { bestD = d; best = { x: p.x, z: p.z, kind: slot.kind }; }
      }
    }
    return best;
  }

  /** Группа острова (постройки деревень/портов складываются сюда) */
  islandGroup(islIdx: number): THREE.Group { return this.islGroups[islIdx]; }

'''
lines[vs:ve] = NEW_VEG.split('\n')
src = '\n'.join(lines)
open('src/game/world/world.ts', 'w').write(src)
print('OK world.ts class part C')
