// DEBUG Task 22: что бьют лучи квартердека + почему ходоки стоят
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const log = (...a) => console.log(...a);
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) { if (typeof v !== 'string') break; try { v = JSON.parse(v); } catch { break; } }
  return v;
};

// ================= ЧАСТЬ 1: лучи — ЧТО они бьют =================
const dbg1 = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.crew = p.preset.maxCrew;
  const v = p.visual;
  const q = v.quarter;
  const T = window.__THREE;
  const rc = new T.Raycaster();
  rc.params.Line = { threshold: 0 };
  const floorY = q.floorY(q.frontZ);
  const rayDbg = (x, y, z) => {
    const o = new T.Vector3(x, y, z).applyQuaternion(p.quaternion).add(p.position);
    const d = new T.Vector3(0, 0, 1).applyQuaternion(p.quaternion).normalize();
    rc.set(o, d);
    const hits = rc.intersectObjects(v.group.children, true).filter(h => h.object.isMesh);
    return hits.slice(0, 4).map(h => ({
      dist: +h.distance.toFixed(2),
      // позиция пересечения в ЛОКАЛЯХ корабля
      local: (() => {
        const lp = h.point.clone().sub(p.position).applyQuaternion(p.quaternion.clone().invert());
        return [ +lp.x.toFixed(2), +lp.y.toFixed(2), +lp.z.toFixed(2) ];
      })(),
      vc: !!h.object.material?.vertexColors,
      parts: h.object.geometry?.attributes?.position ? h.object.geometry.attributes.position.count : 0,
      visible: h.object.visible,
      parentVis: h.object.parent?.visible,
    }));
  };
  return JSON.stringify({
    stairX: q.stairX, floorY: +floorY.toFixed(2),
    sternZ: +q.sternZ.toFixed(2), frontZ: +q.frontZ.toFixed(2),
    stairHits: rayDbg(q.stairX, floorY + 0.1, q.sternZ + 1.5),
    centerHits: rayDbg(q.stairX * 0.5, floorY + 0.1, q.sternZ + 1.5),
    rearHits: (() => {
      const o = new T.Vector3(0, floorY + 0.4, q.sternZ + 1.2).applyQuaternion(p.quaternion).add(p.position);
      const d = new T.Vector3(0, 0, -1).applyQuaternion(p.quaternion).normalize();
      rc.set(o, d);
      const hits = rc.intersectObjects(v.group.children, true).filter(h => h.object.isMesh);
      return hits.slice(0, 3).map(h => ({ dist: +h.distance.toFixed(2), vc: !!h.object.material?.vertexColors }));
    })(),
  });
})()`));
log('ЛУЧИ:', JSON.stringify(dbg1, null, 1));

// ================= ЧАСТЬ 2: ходоки =================
const snap1 = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const arr = [];
  p.crew3d.group.children.forEach((c, i) => arr.push([i, +c.position.x.toFixed(2), +c.position.z.toFixed(2), c.visible]));
  return JSON.stringify({ n: arr.length, arr: arr.slice(-6), t: +g.time.toFixed(2) });
})()`));
log('ХОДОКИ снап1:', JSON.stringify(snap1));
await sleep(1500);
const snap2 = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const arr = [];
  p.crew3d.group.children.forEach((c, i) => arr.push([i, +c.position.x.toFixed(2), +c.position.z.toFixed(2), c.visible]));
  return JSON.stringify({ arr: arr.slice(-6), t: +g.time.toFixed(2), fps: +g.fpsSmooth.toFixed(1) });
})()`));
log('ХОДОКИ снап2 (живой цикл, 1.5 c):', JSON.stringify(snap2));
const snap3 = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  let t = g.time;
  for (let i = 0; i < 120; i++) { t += 1/60; p.updateVisual(t, 1/60, g.particles); }
  const arr = [];
  p.crew3d.group.children.forEach((c, i) => arr.push([i, +c.position.x.toFixed(2), +c.position.z.toFixed(2)]));
  return JSON.stringify({ arr: arr.slice(-6) });
})()`));
log('ХОДОКИ снап3 (ff 2 c):', JSON.stringify(snap3));
