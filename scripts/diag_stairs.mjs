// Диагностика D5: подъём по трапу — почему onStair не ловится
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

// сервер живёт только внутри одного вызова — стартуем сами
try { execSync('pkill -f "next dev"'); } catch { }
execSync('sleep 1');
const srv = spawn('npm', ['run', 'dev'], { detached: true, stdio: 'ignore' });
srv.unref();
let code = '';
for (let i = 0; i < 40; i++) {
  code = execSync(`curl -s --max-time 3 -o /dev/null -w '%{http_code}' http://localhost:3000/ || true`, { shell: true, encoding: 'utf8' }).trim();
  if (code === '200') break;
  execSync('sleep 3');
}
console.log('SERVER:', code);

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 4) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('unavailable') || out.includes('timed out')); i++) {
    execSync('sleep 10');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(12000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(3000);
}
ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (scr) { const b = [...scr.querySelectorAll('button')].find(x => x.textContent.includes('Позже')); if (b) b.click(); }
  return 'ok';
})()`);
await sleep(600);
ev(`window.__game.start()`);
await sleep(400);
ev(`window.__game.changeShip('frigate', true)`);
await sleep(400);
ev(`window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyV'})); 'ok'`);
await sleep(300);
ev(`window.__game.stepDebugNR(0.4)`);
// диагностика: курс корабля + подъём с шагом 0.15с
const out = ev(`(() => {
  const g = window.__game, l = g.lander, p = l.deckPlan;
  const hostYaw = g.player.heading;
  l.group.position.set(p.stairX, p.surfaceY(p.stairX, p.stairZ0 + 0.6), p.stairZ0 + 0.6);
  l.debugSetCam(Math.PI, 0.25);
  g.stepDebugNR(0.2);
  const trace = [];
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS'}));
  for (let i = 0; i < 40; i++) {
    g.stepDebugNR(0.15);
    if (i % 2 === 0) trace.push([+l.pos.x.toFixed(2), +l.pos.z.toFixed(2), +l.pos.y.toFixed(2)]);
  }
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS'}));
  return JSON.stringify({ hostYaw: +hostYaw.toFixed(3), stairX: +p.stairX.toFixed(2), qFrontZ: +p.qFrontZ.toFixed(2), stairZ0: +p.stairZ0.toFixed(2), trace });
})()`);
console.log(out);
run('close');
process.exit(0);
