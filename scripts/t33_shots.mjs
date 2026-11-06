// Task 33: скриншоты v2 — полдень (яркий свет), прибой крупным планом,
// шторм с построенным морем (stepDebug).
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const log = (...a) => console.log(...a);

run('close --all');
run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
ev(`window.__game.start()`);
await sleep(600);

// ===== 1. ПРИБОЙ: ясная погода, свежий ветер 14 м/с, ПОЛДЕНЬ,
// корабль в 70 м от берега носом на остров =====
log('--- surf shot ---');
ev(`(() => {
  const g = window.__game;
  g.sky.timeOfDay = 0.5;
  g.debugSetWeather('clear', 14, 40);
  g.stepDebug(35);
  const isl = g.world.islands[2], ang = 0.7, coast = 100;
  const x = isl.cx + Math.cos(ang) * (coast + 75), z = isl.cz + Math.sin(ang) * (coast + 75);
  g.player.position.set(x, 0, z);
  g.player.velocity.set(0,0,0); g.player.angular.set(0,0,0);
  const toIsl = Math.atan2(isl.cx - x, isl.cz - z);
  g.player.quaternion.set(0, Math.sin(toIsl/2), 0, Math.cos(toIsl/2));
  g.player.anchored = true; g.player.sailTarget = 0;
  g.player.seedVertical(g.time);
  g.stepDebug(1);
  return 'surf ready env=' + window.__sea.envelope + ' dayF=' + g.sky.timeOfDay.toFixed(2);
})()`);
await sleep(5000);
run('screenshot scripts/shots/t33_surf --full');
log('surf done');

// ===== 2. ПРОСТАЯ ФИЗИКА В ШТОРМЕ: полдень, море построено =====
log('--- simple storm shot ---');
ev(`(() => {
  const g = window.__game;
  g.applyPhysicsMode('simple', false);
  g.sky.timeOfDay = 0.5;
  g.debugSetWeather('storm', 22, 40);
  g.stepDebug(40);
  g.player.position.set(0, 0, -2600);
  g.player.velocity.set(0,0,0); g.player.angular.set(0,0,0);
  g.player.quaternion.set(0, Math.sin(-2.2/2), 0, Math.cos(-2.2/2));
  g.player.seedVertical(g.time);
  g.player.sailTarget = 2; g.player.anchored = false;
  g.stepDebug(4);
  return 'storm ready env=' + window.__sea.envelope;
})()`);
await sleep(4000);
run('screenshot scripts/shots/t33_simple_storm --full');
log('storm done');

const errs = ev(`window.__jsErrors.length`);
log('JS errors:', errs);
run('close --all');
