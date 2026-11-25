// Task 82: «пипетка» — какие меши видны в заданных пикселях кадра
// planks_detail (тот же ракурс, что в t82_shots). Использует
// __game.debugPick (game.ts). Запуск (после t82_check — страница
// открыта, корабль заморожен):
//   node scripts/t82_pick.mjs 1030,457 718,462 470,466 300,500 800,520
import { execSync } from 'node:child_process';
const run = (args) => { try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); } catch (e) { return `ERR ${e.stdout || ''} ${e.stderr || ''}`; } };
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
// «x,y»-пары через пробел (не запятыми): 1030,457 718,462
const picks = process.argv[2] || '800,450';

ev(`(() => { const g = window.__game; g.paused = true; g.rig.update = () => {}; return 1; })()`);
const res = ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  const sp = g.player.position.clone().add(g.shift);
  const f = grp.getWorldDirection(sp.clone()); const p = sp.clone().set(f.z, 0, -f.x);
  const sd = (g.sky.sunDir.x * p.x + g.sky.sunDir.z * p.z) >= 0 ? 1 : -1;
  c.position.copy(sp).addScaledVector(f, 2).addScaledVector(p, 6.5 * sd); c.position.y += 1.5;
  const lk = sp.clone().addScaledVector(f, 1); lk.y += 1.3; c.lookAt(lk); c.updateMatrixWorld();
  grp.updateWorldMatrix(true, true);
  const out = { sd, cam: [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(1)), picks: {} };
  for (const tok of '${picks}'.split(' ')) { const [px, py] = tok.split(',').map(Number);
    if (!isFinite(px) || !isFinite(py)) continue;
    out.picks[px + ',' + py] = g.debugPick(px, py, 3); }
  return JSON.stringify(out); })()`);
const txt = String(res).replace(/^"|"$/g, '').replace(/\\"/g, '"');
try {
  const o = JSON.parse(txt);
  console.log('sd', o.sd, 'cam', o.cam);
  for (const [k, hits] of Object.entries(o.picks)) {
    console.log('pick', k);
    for (const h of hits) console.log('   ', h.name, h.cls, 'd=' + h.dist, 'local=' + JSON.stringify(h.local), h.plank ? 'plank=' + JSON.stringify(h.plank) : '');
  }
} catch (e) {
  console.log(txt.slice(0, 1500));
}
