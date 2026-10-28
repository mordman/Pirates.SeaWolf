// Диагностика Task 13: посадка на волны + корма
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 90000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

run('open http://localhost:3000/');
await sleep(2000);
ev(`(() => { localStorage.removeItem('seawolves.settings.v1'); return 'clean'; })()`);
run('reload'); await sleep(8000);
run('errors --clear');
run(`find text "Поднять флаг" click`);
await sleep(2500);
// рекордер минимума надводного борта (внутри страницы)
ev(`(() => { window.__rec = { minFb: 99, minSub: 99, maxRoll: 0, maxPitch: 0, n: 0 }; window.__recIv = setInterval(() => { const s = window.__sea; if (s && s.n !== undefined) {} if (s) { window.__rec.minFb = Math.min(window.__rec.minFb, s.freeboard); window.__rec.minSub = Math.min(window.__rec.minSub, s.y - s.waterY); window.__rec.maxRoll = Math.max(window.__rec.maxRoll, Math.abs(s.roll)); window.__rec.maxPitch = Math.max(window.__rec.maxPitch, Math.abs(s.pitch)); window.__rec.n++; } }, 90); return 'rec'; })()`);
// шторм
ev(`(() => { const g = window.__game; g.debugSetWeather('storm', 22, 40); return 'storm'; })()`);
// паруса
run('keypress KeyW');
// ждём набора волнения + хода (реальное время)
await sleep(30000);
const rec = ev(`JSON.stringify(window.__rec)`);
console.log('REC(storm):', rec);
const sea1 = ev(`JSON.stringify({amp: window.__sea.seaAmp, fb: window.__sea.freeboard, spd: window.__sea.speed, y: window.__sea.y, wy: window.__sea.waterY})`);
console.log('SEA:', sea1);
// камера сбоку-сзади на корпус
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); g.rig.freeAzimSet(Math.PI * 0.7); g.rig.freeElevSet(0.16); g.rig.distSet(36); return 'cam'; })()`);
await sleep(1200);
shot('t13_storm_a');
await sleep(2000);
shot('t13_storm_b');
await sleep(2000);
shot('t13_storm_c');
// вид с кормы (сзади)
ev(`(() => { const g = window.__game; g.rig.freeAzimSet(0); g.rig.freeElevSet(0.2); g.rig.distSet(26); return 'cam2'; })()`);
await sleep(1200);
shot('t13_stern_view');
console.log('errors:', run('errors').slice(0, 400));
ev(`(() => { clearInterval(window.__recIv); return 'ok'; })()`);
