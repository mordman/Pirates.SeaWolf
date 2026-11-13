// Диагностика Task 47: как сейчас выглядят палуба/транец/квартердэк
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 4) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || !out.trim() || out.includes('Resource temporarily')); i++) {
    await sleep(4000);
    out = ev(js);
  }
  return out;
};

// свежий контекст
runRaw('close');
runRaw('open http://localhost:3000');
await sleep(9000);

// старт игры
await evR(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Поднять флаг')); if (b) b.click(); return 'ok'; })()`);
await sleep(5000);
// закрыть окно капитана, если выскочило
await evR(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 'ok'; })()`);
await sleep(3000);

// данные корабля
const info = await evR(`(() => { const s = window.__sea; const g = window.__game; const p = g.player; return JSON.stringify({ model: s.model, planks: s.plankInfo, heading: +p.heading.toFixed(2), pos: [Math.round(p.position.x), Math.round(p.position.z)], kind: p.kind }); })()`);
console.log('SHIP:', info);

// ВИД СВЕРХУ на палубу: free-камера над кораблём
await evR(`(() => { const g = window.__game; const p = g.player; g.rig.mode = 'free'; g.rig.freeElevSet(1.45); g.rig.freeAzimSet(-p.heading - Math.PI / 2); g.rig.distSet(30); g.rig.snap(); return 'cam top'; })()`);
await sleep(2500);
runRaw('screenshot scripts/shots/t47_diag_deck_top.png');

// ВИД СЗАДИ на корму (транец)
await evR(`(() => { const g = window.__game; const p = g.player; g.rig.mode = 'free'; g.rig.freeElevSet(0.35); g.rig.freeAzimSet(-p.heading + Math.PI); g.rig.distSet(26); g.rig.snap(); return 'cam rear'; })()`);
await sleep(2500);
runRaw('screenshot scripts/shots/t47_diag_stern.png');

// ВИД СБОКУ вплотную к борту (щели между досками)
await evR(`(() => { const g = window.__game; const p = g.player; g.rig.mode = 'free'; g.rig.freeElevSet(0.22); g.rig.freeAzimSet(-p.heading - Math.PI / 2 + 0.5); g.rig.distSet(18); g.rig.snap(); return 'cam side'; })()`);
await sleep(2500);
runRaw('screenshot scripts/shots/t47_diag_side.png');

console.log('DONE');
