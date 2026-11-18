import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 300000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
runRaw('close'); runRaw('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`); await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
ev(`window.__game.changeShip('frigate', true)`);
await sleep(1000);
const out = ev(`(() => {
  const g = window.__game; const T = window.__THREE;
  const ship = g.player; const v = ship.visual;
  v.group.updateMatrixWorld(true);
  const masts = v.masts; const rows = [];
  masts.forEach((m, i) => {
    const segs = m.userData.segments;
    if (segs) rows.push({ mast: i, h: m.userData.height,
      seg1y: +segs[1].position.y.toFixed(2), seg2y: +segs[2].position.y.toFixed(2),
      j1: +(m.userData.j1).toFixed(2), j2: +(m.userData.j2).toFixed(2) });
  });
  const flag = v.flag; const wp = new T.Vector3(); flag.getWorldPosition(wp);
  rows.push({ flagY: +wp.y.toFixed(2) });
  const jib2 = v.sails.sails.find(s => !s.square && s.setAt === 1);
  const mp = new T.Vector3();
  if (jib2) { jib2.mesh.getWorldPosition(mp); rows.push({ jib2PivotY: +jib2.quad.pivot.y.toFixed(2), jib2MeshY: +mp.y.toFixed(2), diff: +(jib2.quad.pivot.y - mp.y).toFixed(2) }); }
  const top = v.sails.sails.find(s => s.square && s.setAt === 0.92);
  if (top) { const pp = new T.Vector3(); top.mesh.getWorldPosition(pp); rows.push({ topPivotY: +top.quad.pivot.y.toFixed(2), topMeshY: +pp.y.toFixed(2), diff: +(top.quad.pivot.y - pp.y).toFixed(2) }); }
  return JSON.stringify(rows); })()`);
console.log(out);
runRaw('close');
