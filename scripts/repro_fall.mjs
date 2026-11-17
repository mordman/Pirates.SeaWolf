import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 420000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const run = (a, t = 6) => { let o = runRaw(a); for (let i = 0; i < t && (!o.trim() || o.includes('temporarily unavailable') || o.includes('timed out') || o.includes('Failed to read') || o.includes('page_wedged')); i++) { execSync('sleep 15'); o = runRaw(a); } return o; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\*.*?\*\//g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
execSync('mkdir -p scripts/shots');
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
ev(`localStorage.removeItem('seawolves.settings.v1'); 1`);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
// полные паруса + выждать раскрытие, камера сбоку-сверху
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`(() => { const g = window.__game; g.player.sailTarget = 3; g.stepDebugNR(6); return 1; })()`);
ev(`(() => { const g = window.__game; g.setCameraMode('free'); g.rig.freeAzimSet(1.9); g.rig.freeElevSet(0.30); g.rig.distSet(52); return 1; })()`);
// ЛОМАЕМ фок-мачту (её паруса: кливера + фор-марс + курс)
ev(`window.__game.player.breakMast(0)`);
ev(`window.__game.stepDebugNR(0.9)`);
ev(`window.__game.stepDebug(0.001)`);
run(`screenshot scripts/shots/t78_fall_mid.png`);
ev(`window.__game.stepDebugNR(3.2)`);
ev(`window.__game.stepDebug(0.001)`);
run(`screenshot scripts/shots/t78_fall_rest.png`);
// состояние парусов упавшей мачты
const st = ev(`(() => { const g = window.__game; const v = g.player.visual;
  return JSON.stringify(v.sails.sails.map(s => ({ sq: s.square, mast: s.mastIndex, furl: +s.furl.toFixed(2), dead: s.mastIndex !== undefined ? g.player.mastFall[s.mastIndex] : null }))); })()`);
console.log('SAILS: ' + st);
runRaw('close');
