// Регрессия обычного режима после clipmap-воды: старт, ход под парусами,
// fps, ошибки, скриншот открытого моря.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (r) => {
  try { const v = JSON.parse(r); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return null; }
};
const sea = () => jparse(ev('JSON.stringify(window.__sea)'));
const key = (code, ms = 120) => {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))"`);
  return sleep(ms).then(() =>
    run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))"`));
};

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');
run('find text "Поднять флаг" click');
await sleep(6000);
// полный вперёд секунд 20 (headless время растянуто)
await key('KeyW', 200);
for (let i = 0; i < 10; i++) { await sleep(2000); }
let s = sea();
console.log('телеметрия:', JSON.stringify({
  fps: s.fps, speed: s.speed, y: s.y, waterY: s.waterY,
  chunk: s.water.chunk, rings: s.water.rings.length, farEff: s.water.farEff,
}));
// изометрия подальше — общий план моря
ev('window.__game.rig.dist.iso = 300');
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/v24_open_sea.png');
await sleep(500);
const errs = run('errors'); const cons = run('console');
console.log('ERRORS:', errs || '(пусто)');
console.log('CONSOLE:', cons || '(пусто)');
run('close');
const ok = s.fps > 8 && !errs;
console.log(ok ? 'REGRESSION OK' : 'REGRESSION FAIL');
