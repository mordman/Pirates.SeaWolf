import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 300000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
runRaw('close'); runRaw('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`); await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(500);
const out = ev(`(() => {
  const g = window.__game; const T = window.__THREE;
  g.player.wind.speed = 3; g.stepDebugNR(3);
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  t.clearDamage();
  t.anchored = true; t.sailTarget = 0; t.sailOverride = null;
  t.velocity.set(0, 0, 0); t.angular.set(0, 0, 0);
  const Lz = t.preset.length;
  const mastsZ = t.visual.masts.map(m => +m.position.z.toFixed(1));
  const zh = Math.min(Lz * 0.32, mastsZ[0] - 3);
  const hw = Math.max(1.5, t.halfWidthAt(zh));
  const lp = new T.Vector3(hw * 0.95, 2.0, zh);
  for (let i = 0; i < 3; i++) t.hitHull(lp.clone(), 46, false);
  const ph = t.plankHull;
  const pts = [
    { n: 'center', y: 2.0, z: zh },
    { n: 'entry_x4.2', y: 2.2, z: zh },
    { n: 'entry_x4.2_y2.0', y: 2.0, z: zh },
    { n: 'y2.4', y: 2.4, z: zh },
    { n: 'y1.8', y: 1.8, z: zh },
    { n: 'z+1', y: 2.0, z: zh + 1 },
    { n: 'z-1', y: 2.0, z: zh - 1 },
  ].map(p => ({ n: p.n, open: +ph.sideOpen(1, p.y, p.z).toFixed(2),
    r25: +ph.sideOpen(1, p.y, p.z, 2.5).toFixed(2), r12: +ph.sideOpen(1, p.y, p.z, 1.2).toFixed(2) }));
  // какие доски вообще есть в зоне
  const near = ph.records.filter(r => r.cls === 0 && r.side === 1 && Math.abs(r.center.z - zh) < 2.2 && Math.abs(r.center.y - 2.2) < 1.6);
  const states = {};
  for (const r of near) { const k = 'y' + r.center.y.toFixed(1) + 'z' + r.center.z.toFixed(1) + 's' + r.state; states[k] = (states[k] || 0) + 1; }
  return JSON.stringify({ zh, hw, pts, nearN: near.length,
    sample: Object.keys(states).slice(0, 14) }); })()`);
console.log(out);
runRaw('close');
