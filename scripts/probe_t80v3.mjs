// Task 80 ПРОБА v3: МЕШ-УРОВЕНЬ аудит — реальные вершины парусов
// (matrixWorld + пузо шейдера) против штевня/фигуры/досок/обвода.
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);

// МЕШ-АУДИТ на живом корабле игрока: sails в координатах КОРАБЛЯ,
// пузо по шейдеру (обе стороны), брасопка реальная + разворот до ±0.94
const res = jparse(await evR(`(() => {
  const g = window.__game;
  const out = [];
  const ids = Object.keys(window.__PRESETS || g.PRESETS || {});
  // получить список пресетов из энциклопедии
  const list = (g.encyclopedia ? g.encyclopedia() : null) || ids;
  const names = Array.isArray(list) && list.length && typeof list[0] === 'object'
    ? list.map(e => e.id) : ids;
  for (const pid of names) {
    try {
      g.changeShip(pid, true);
      g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.player.sailOverride = 1;
      g.stepDebugNR(3.0);
      const ship = g.player;
      const P = ship.preset, L = P.length;
      const grp = ship.visual.group;
      grp.updateMatrixWorld(true);
      const invShip = new THREE.Matrix4().copy(grp.matrixWorld).invert();
      const recs = ship.visual.planks ? ship.visual.planks.records : [];
      // боксы носа (как в debugPlankSailAudit)
      const bowTop = P.length ? null : null;
      const prof = (t) => { const w = Math.max(1.2, P.beam * (0.32 + 0.68 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)) * 0.92))); return w; };
      const stemBox = { x: 0.20, z0: L * 0.47, z1: L * 0.52, y0: -P.draft * 0.5, y1: 2.2 * 0.9 + P.freeboard * 0.6 };
      const figS = THREE.MathUtils.clamp(P.freeboard * 0.26, 0.55, 1.25) * THREE.MathUtils.clamp(P.freeboard * 0.30, 0.8, 1.6);
      const figBox = { x: 0.45 + figS * 0.55, z0: L / 2 - 0.15 - figS * 0.55, z1: L / 2 - 0.15 + figS * 0.65 + 0.35, y0: P.freeboard * 1.02, y1: P.freeboard * 1.02 + figS * 2.1 };
      const v = new THREE.Vector3(), n = new THREE.Vector3();
      let worst = null;
      const testPt = (label, wp) => {
        const p = v.copy(wp).applyMatrix4(invShip);
        // штевень/фигура
        for (const b of [stemBox, figBox]) {
          if (Math.abs(p.x) < b.x && p.z > b.z0 && p.z < b.z1 && p.y > b.y0 && p.y < b.y1) {
            const depth = Math.min(b.x - Math.abs(p.x), b.z1 - p.z, p.z - b.z0, b.y1 - p.y);
            if (!worst || depth > worst.d) worst = { d: +depth.toFixed(3), at: [+(p.x).toFixed(1), +(p.y).toFixed(1), +(p.z).toFixed(1)], label };
          }
        }
        // доски
        for (const r of recs) {
          const ext = Math.max(r.len, r.w, r.thick) * 0.5 + 0.12;
          if (Math.abs(r.center.z - p.z) > ext || Math.abs(r.center.y - p.y) > ext || Math.abs(r.center.x - p.x) > ext) continue;
          const q = _tmpq.copy(r.quat).invert();
          const lp = _tmpv.copy(p).sub(r.center).applyQuaternion(q);
          if (Math.abs(lp.x) < r.thick / 2 && Math.abs(lp.y) < r.w / 2 && Math.abs(lp.z) < r.len / 2) {
            const depth = Math.min(r.thick / 2 - Math.abs(lp.x), r.w / 2 - Math.abs(lp.y), r.len / 2 - Math.abs(lp.z));
            if (!worst || depth > worst.d) worst = { d: +depth.toFixed(3), at: [+(p.x).toFixed(1), +(p.y).toFixed(1), +(p.z).toFixed(1)], label };
          }
        }
      };
      const _tmpq = new THREE.Quaternion(); const _tmpv = new THREE.Vector3();
      for (const s of ship.visual.sails.sails) {
        const mesh = s.mesh;
        const geo = mesh.geometry;
        const posA = geo.attributes.position;
        const bellyMax = 1.7;
        // локальная ось Z меша (пузо) в мире
        const zAxis = n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
        const braces = s.square ? [s.braceAngle, 0, 0.94, -0.94, 0.5, -0.5] : [0];
        for (const br of braces) {
          if (s.square && s.brace) { s.brace.rotation.y = br; grp.updateMatrixWorld(true); }
          for (const sgn of [1, -1]) {
            for (let i = 0; i < posA.count; i++) {
              const px = posA.getX(i), py = posA.getY(i), pz = posA.getZ(i);
              const uvx = geo.attributes.uv.getX(i), uvy = geo.attributes.uv.getY(i);
              const belly = bellyMax * sgn * Math.sin(uvx * Math.PI) * Math.sin(uvy * Math.PI) * (0.72 + 0.28 * (1 - uvy));
              v.set(px, py, pz + belly).applyMatrix4(mesh.matrixWorld);
              testPt((s.square ? 'square@br' + (+br).toFixed(2) : 'fore@b' + sgn) + '#' + s.setAt, v);
            }
          }
        }
        if (s.square && s.brace) { s.brace.rotation.y = s.braceAngle; grp.updateMatrixWorld(true); }
      }
      out.push({ id: pid, bad: worst });
    } catch (e) { out.push({ id: pid, err: String(e).slice(0, 80) }); }
  }
  return JSON.stringify(out.filter(r => r.bad || r.err)); })()`));
console.log('MESH AUDIT (bad only):');
for (const r of res || []) console.log(JSON.stringify(r));
console.log('DONE');
runRaw('close');
