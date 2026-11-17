// Воспроизведение Task 78: «ПАРУС РЕЖЕТ КОРАБЛЬ только у
// разрушаемых (дощатых) моделей» — численный аудит
// __game.debugPlankSailAudit() (паруса ↔ боксы досок vs гладкий
// обвод) + скриншот носа игрока с дощатым корпусом при полных
// парусах (VLM-подтверждение).
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

execSync('mkdir -p scripts/shots');
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
ev(`localStorage.removeItem('seawolves.settings.v1'); localStorage.removeItem('piratesHUDFold_v1'); 1`);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// ============ 1. ЧИСЛЕННЫЙ АУДИТ ============
const audit = jparse(await evR(`(() => {
  const rows = window.__game.debugPlankSailAudit();
  const bad = rows.filter(r => r.planksMax > 0.02);
  return JSON.stringify({
    total: rows.length,
    badCount: bad.length,
    bad,
    smoothBad: rows.filter(r => r.smoothMax > 0.02).map(r => r.id + ':' + r.smoothMax),
  });
})()`));
console.log('AUDIT: ' + JSON.stringify(audit));

// ============ 2. СКРИНШОТ: дощатый корпус, полные паруса, нос ============
// включаем дощатую модель + полные паруса, камера на нос
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`(() => { const g = window.__game; g.player.sailTarget = 3; g.stepDebugNR(1.2); return 1; })()`);
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(2.6); g.rig.freeElevSet(0.22); g.rig.distSet(46);
  g.stepDebug(0.2); return 1; })()`);
run(`screenshot scripts/shots/t78_planks_bow.png`);

// для сравнения: тот же ракурс, гладкий корпус
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'smooth' } })`);
ev(`window.__game.stepDebug(0.2)`);
run(`screenshot scripts/shots/t78_smooth_bow.png`);
console.log('DONE');
runRaw('close');
