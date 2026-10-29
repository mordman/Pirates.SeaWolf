// E2E v25b: повторная визуальная проверка после правок дыма
// (светлые полупрозрачные клубы, разброс) + камеры крупного плана.
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
const num = (js) => parseFloat(ev(js));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const key = (code, ms = 120) => {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))"`);
  return sleep(ms).then(() =>
    run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))"`));
};
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');
console.log('=== Полигон, мишень — галеон ===');
run('find text "Полигон разрушений" click');
await sleep(8000);
ev(`window.__game.pgSetModel('galleon')`);
await sleep(2500);
let s = sea();
check('полигон: галеон', !!s && s.proving === 1);

console.log('=== Залп: вспышка и дым ===');
ev(`(() => { const a = window.__game.combat.aim; a.active = true; a.side = 1; a.azimuth = 0; a.elevation = 0.05; return 'ok'; })()`);
for (let i = 0; i < 50; i++) {
  const r = num('window.__game.combat.readiness()');
  if (r >= 0.999) break;
  await sleep(1500);
}
await key('Space', 60);
await sleep(250);   // вспышка (в headless время растянуто — вспышка ещё жива)
shot('v25_volley_flash');
await sleep(1600);  // развитый дым
shot('v25_volley_smoke');
await sleep(3000);
s = sea();
check('залп попал', s.tgtHull < 0.999, `hull=${(s.tgtHull * 100).toFixed(1)}%`);

console.log('=== Крупный план мишени (камера с воды) ===');
ev(`(() => { const g = window.__game, t = g.pgTarget.ship;
  g.player.position.set(t.position.x, 0, t.position.z - 30);
  g.player.quaternion.set(0, 0, 0, 1); g.player.velocity.set(0, 0, 0);
  g.combat.aim.active = false;
  g.setCameraMode('water'); return 'ok'; })()`);
await sleep(1500);
shot('v25_galleon_closeup');
// та же точка, но далеко (LOD off для сравнения не делаем — просто общий план)
ev(`(() => { const g = window.__game, t = g.pgTarget.ship;
  g.player.position.set(t.position.x, 0, t.position.z - 130);
  g.player.quaternion.set(0, 0, 0, 1); g.player.velocity.set(0, 0, 0); return 'ok'; })()`);
await sleep(1200);
shot('v25_galleon_far');
const vis = ev(`(() => { const d = window.__game.pgTarget.ship.visual.detail; return d ? d.visible : null; })()`);
console.log('детали мишени на 130 м (detailLod 270):', vis);

console.log('=== Ошибки ===');
const errs = run('errors');
console.log(errs ? errs : '(ошибок страницы нет)');
check('ошибок страницы нет', !errs || errs.length < 10);
console.log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
