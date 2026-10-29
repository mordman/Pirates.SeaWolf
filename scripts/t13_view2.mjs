// Диагностика Task 13b: ДЕФОЛТНЫЙ опыт игрока (ясная погода, iso/rear камера)
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
// рекордер на КАЖДЫЙ кадр (rAF)
ev(`(() => { window.__rec = { minFb: 99, minSub: 99, maxRoll: 0, n: 0, worst: null }; const loop = () => { const s = window.__sea; if (s) { const fb = s.freeboard, sub = s.y - s.waterY; if (fb < window.__rec.minFb) { window.__rec.minFb = fb; window.__rec.worst = { fb: +fb.toFixed(2), sub: +sub.toFixed(2), amp: +s.seaAmp.toFixed(2), roll: +s.roll.toFixed(2), pitch: +s.pitch.toFixed(2), spd: +s.speed.toFixed(1) }; } window.__rec.minSub = Math.min(window.__rec.minSub, sub); window.__rec.maxRoll = Math.max(window.__rec.maxRoll, Math.abs(s.roll)); window.__rec.n++; } requestAnimationFrame(loop); }; requestAnimationFrame(loop); return 'rec'; })()`);
// паруса полные (3 × W)
run('type KeyW'); await sleep(300); run('type KeyW'); await sleep(300); run('type KeyW'); await sleep(300);
// ждём хода на ДЕФОЛТНОЙ погоде
await sleep(25000);
console.log('REC(clear):', ev(`JSON.stringify(window.__rec)`));
// дефолтная изо-камера
shot('t13_default_iso');
// камера сзади (rear) — что видит пользователь, глядя на корму
ev(`(() => { const g = window.__game; g.setCameraMode('rear'); return 'rear'; })()`);
await sleep(1500);
shot('t13_default_rear');
// близкая свободная камера на корму игрока
ev(`(() => { const g = window.__game; g.setCameraMode('free'); g.rig.freeAzimSet(Math.PI); g.rig.freeElevSet(0.12); g.rig.distSet(16); return 'cam'; })()`);
await sleep(1500);
shot('t13_default_stern_close');
console.log('errors:', run('errors').slice(0, 300));
