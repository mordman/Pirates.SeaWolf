// Прицельные скриншоты Task 26: борт к борту (с траверзы) + след (с борта, на ходу)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2500);

// === 1) БОРТОМ К БОРТУ: камера «side» (с траверзы корабля, нос ВВЕРХ кадра) ===
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  g.setCameraMode('side');
  g.rig.dist.side = 19;    // ближе — шлюпка у борта читается крупно
  g.rig.snap();
  return 'ok';
})()`);
await sleep(900);
shot('t26_boat_side');
await sleep(300);

// === 2) СЛЕД: шлюпка на ходу, свободная камера с ТРАВЕРЗЫ яла ===
const st = ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1/60; bl.update(1/60, t); }
  bl.row = 1; bl.steer = 0;
  for (let i = 0; i < 900; i++) { t += 1/60; bl.update(1/60, t); }  // 15 с хода
  g.setCameraMode('free');
  g.rig.freeAzimSet(bl.heading + Math.PI / 2);   // траверза: лодка бортом, след уходит вбок-назад
  g.rig.freeElevSet(0.45);
  g.rig.distSet(14);
  g.rig.snap();
  return JSON.stringify({ wake: bl.wake.count(), phase: bl.phase, hdg: +bl.heading.toFixed(2) });
})()`);
console.log('wake state:', st);
await sleep(800);
shot('t26_boat_wake');
await sleep(300);
run('close --all');
