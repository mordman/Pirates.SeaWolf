#!/usr/bin/env python3
# Task 36 восстановление — world.ts часть E: buildVillages + update
import sys

src = open('src/game/world/world.ts').read()
lines = src.split('\n')

# ---- buildVillages: вставить ПЕРЕД '// ---------- животные ----------' (внутри класса) ----
VILLAGES_M = '''  // ---------- ДЕРЕВНИ (Task 36): небольшие посёлки в глубине
  // островов — хижины вокруг центра, костёр, сушила сетей;
  // жители ходят по тропам к порту (islandFolk.buildVillageFolk) ----------
  private buildVillages() {
    const rng = new RNG(WORLD_SEED + 8181);
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    for (const v of VILLAGES) {
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
      const folk = buildVillageFolk(v, { heightAt, seed: WORLD_SEED + v.x * 7 + v.z });
      this.villageFolk.push(folk);
      g.add(folk.group);
      g.add(folk.props);
    }
  }

'''
cls = None
for i, l in enumerate(lines):
    if l.startswith('export class World'):
        cls = i
        break
assert cls
target = None
for i in range(cls, len(lines)):
    if lines[i].strip().startswith('// ---------- животные ----------'):
        target = i
        break
assert target
lines[target:target] = VILLAGES_M.split('\n')
open('src/game/world/world.ts', 'w').write('\n'.join(lines))
print('OK buildVillages inserted')

# ---- update(): terrain + видимость островов + флот + жители ----
src = open('src/game/world/world.ts').read()
old = """  update(time: number, dt: number, playerPos: THREE.Vector3, waterHeight: (x: number, z: number, t: number) => number) {
    windTimeUniform.value = time;
    this.gullMat.uniforms.uTime.value = time;

    // рыбацкие деревни: лодки качаются на волнах / тонут, поплавки,
    // рыбаки покачиваются. Далёкие гавани (за туманом) — скрываем:
    // не тратим ни апдейт, ни draw calls
    for (const fv of this.fishing) {
      const anchor = fv.boats[0];
      const d = anchor
        ? Math.hypot(anchor.x - playerPos.x, anchor.z - playerPos.z)
        : 0;
      const vis = d < 4000;
      if (fv.group.visible !== vis) fv.group.visible = vis;
      if (vis) fv.update(time, dt, waterHeight);
    }
"""
new = """  update(time: number, dt: number, playerPos: THREE.Vector3, waterHeight: (x: number, z: number, t: number) => number) {
    windTimeUniform.value = time;
    this.gullMat.uniforms.uTime.value = time;

    // РЕЛЬЕФ-СТРИМЕР (Task 36): тайлы вокруг игрока
    this.terrain.update(playerPos, dt);

    // видимость ОСТРОВОВ: группа острова (растительность+порт+
    // деревни) рисуется только в пределах дальности прорисовки
    for (let i = 0; i < this.islands.length; i++) {
      const isl = this.islands[i];
      const d = Math.hypot(playerPos.x - isl.cx, playerPos.z - isl.cz);
      const vis = d < this.visDistance + isl.r * 1.35;
      const g = this.islGroups[i];
      if (g && g.visible !== vis) g.visible = vis;
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
"""
assert old in src, 'update'
src = src.replace(old, new)

# setTerrainTextures helper
old2 = """  /** включить/выключить процедурную текстуру рельефа (настройка) */
  setTerrainTextures(on: boolean) { this.terrain.setTextures(on); }"""
if old2 not in src:
    # добавить после конструктора-закрытия (перед "// ---------- растительность")
    marker = '  // ---------- растительность ----------'
    assert marker in src
    src = src.replace(marker, """  /** включить/выключить процедурную текстуру рельефа (настройка) */
  setTerrainTextures(on: boolean) { this.terrain.setTextures(on); }

""" + marker, 1)

open('src/game/world/world.ts', 'w').write(src)
print('OK update()')
