// Task 79: численный аудит «ПАРУС С ПУЗОМ vs ДОЩАТЫЙ КОРПУС» —
// belly=0 (регрессия Task 78), затем 1.0 и 1.68 (полный штормовой
// ветер, максимум uBelly по формуле Ship.updateVisual).
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);

for (const belly of [0, 1.0, 1.68]) {
  const res = jparse(await evR(`(() => {
    const rows = window.__game.debugPlankSailAudit(${belly});
    const bad = rows.filter(r => r.planksMax > 0.02 || r.smoothMax > 0.02);
    return JSON.stringify({
      belly: ${belly}, total: rows.length, badCount: bad.length,
      bad: bad.map(r => r.id + ' planks=' + r.planksMax + ' smooth=' + r.smoothMax
        + ' hits=' + r.hits + ' [' + r.worst + ']'),
    }); })()`));
  console.log(`BELLY=${belly}: ` + JSON.stringify(res));
}
console.log('DONE');
runRaw('close');
