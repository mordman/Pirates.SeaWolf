// Task 79, шаг 2: КРУПНЫЕ планы носа галеры и фрегата (траверз +
// вид сверху) — точная локализация прорезания парусиной досок.
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

ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`(() => { const g = window.__game; g.player.wind.speed = 12.5; g.player.sailTarget = 3; return 1; })()`);

for (const id of ['galley', 'frigate']) {
  ev(`window.__game.changeShip('${id}', true)`);
  await sleep(1200);
  ev(`(() => { const g = window.__game; g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(4); return 1; })()`);
  await sleep(400);
  // траверз (сбоку, уровень палубы) — парусина ВНУТРИ корпуса скрыта досками
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + Math.PI / 2); g.rig.freeElevSet(0.06); g.rig.distSet(38);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t79b_${id}_side.png`);
  // сверху-спереди на нос
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + 0.5); g.rig.freeElevSet(1.1); g.rig.distSet(34);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t79b_${id}_top.png`);
  // мёртвая точка СПЕРЕДИ (по курсу) — центральные паруса видны с ребра
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading); g.rig.freeElevSet(0.10); g.rig.distSet(30);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t79b_${id}_front.png`);
}
console.log('DONE');
runRaw('close');
