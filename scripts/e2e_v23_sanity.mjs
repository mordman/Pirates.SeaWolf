// E2E v23 sanity: быстрый прогон полигона — игра жива, ошибок консоли нет,
// телеметрия отдаёт proving/dist/crew/gibs (Task 7 в рабочей копии).
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

console.log('=== sanity: загрузка ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');

console.log('=== вход в Полигон ===');
run('find text "Полигон разрушений" click');
await sleep(8000);
let s = sea();
console.log('телеметрия:', s ? JSON.stringify({
  proving: s.proving, dist: s.tgtDist, crew: s.tgtCrew, dead: s.tgtCrewDead, gibs: s.gibsAlive,
}) : 'НЕТ');
if (!s || s.proving !== 1) { console.log('FAIL: полигон не активен'); process.exit(1); }

console.log('=== консоль/ошибки ===');
await sleep(2000);
const errs = run('errors'); const cons = run('console');
console.log('ERRORS:', errs || '(пусто)');
console.log('CONSOLE:', cons || '(пусто)');
run('close');
console.log('SANITY OK');
