#!/usr/bin/env python3
# Task 36 восстановление — world.ts часть D: порты ×10, деревни, update
import sys

src = open('src/game/world/world.ts').read()
lines = src.split('\n')

# ---- 1) buildPorts + buildPortStructs: заменить блок ----
start = end = None
for i, l in enumerate(lines):
    if l.strip().startswith('// ---------- порты: по одному на каждом острове'):
        start = i
    if start is not None and l.strip().startswith('// ---------- животные ----------'):
        end = i
        break
assert start is not None and end is not None, (start, end)

PORTS = '''  // ---------- порты: по одному на каждом острове, размер по острову ----------
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

'''
lines[start:end] = PORTS.split('\n')
open('src/game/world/world.ts', 'w').write('\n'.join(lines))
print('OK ports block')
