// Финальный кадр: вешало с рыбой крупно
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) b.click(); return 'start'; })()`);
await sleep(2500);

ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const home = g.world.fishing[0];
  const p = g.player;
  const rack = home.racks[0];
  // игрок в 11 м от вешала (вешало между камерой и игроком)
  let vx = p.position.x - rack.x, vz = p.position.z - rack.z;
  let L = Math.hypot(vx, vz) || 1;
  p.position.set(rack.x + vx / L * 11, 0, rack.z + vz / L * 11);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  g.setCameraMode('free');
  vx = rack.x - p.position.x; vz = rack.z - p.position.z; L = Math.hypot(vx, vz) || 1;
  g.rig.freeAzimSet(Math.atan2(vz / L, vx / L));
  g.rig.freeElevSet(0.15);
  g.rig.distSet(15);
  return 'rack ' + rack.x.toFixed(0) + ',' + rack.z.toFixed(0);
})()`);
await sleep(3000);
shot('t19_fish_rack');
