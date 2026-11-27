// DIAG Task 86: телеметрия фазы ПОДХОДА абордажа на полигоне —
// почему автопилот не сходится (e2e C1: abort за 60 сим-с).
// Печатает построчно: время, фазу, approachT, snapping, скорость,
// дистанции, руль/паруса. По завершении — result.
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

runRaw('close');
execSync('pkill -9 -f chrome || true', { shell: '/bin/bash' });
await sleep(2000);
runRaw('open http://localhost:3000');
await sleep(10000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
ev(`(() => { const g = window.__game;
  g.settings.gameplay.provingDistance = 40;
  g.startProving('fluyt');
  g.testWarp = 240;
  g.player.crew = 60;
  return 1; })()`);
await sleep(2000);
ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })); return 1; })()`);
await sleep(1000);

const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 110000 && !done) {
  const v = jparse(ev(`(() => { const g = window.__game; const b = g.boardingInfo();
  if (!b) return JSON.stringify({ done: true, res: g.lastBoardingResult,
    d: Math.round(g.player.position.distanceTo(g.pgTarget.ship.position)),
    spd: +g.player.speed().toFixed(2) });
  return JSON.stringify({ t: +((Date.now() - ${t0}) / 1000).toFixed(1),
    phase: b.phase, appT: b.approachT, snap: b.snapping, spd: b.attSpd,
    d: b.lashDist, crewD: b.crewD, planks: b.planksDown, pl: b.planks,
    rud: +g.player.rudderTarget.toFixed(2), sail: g.player.sailTarget }); })()`));
  if (v && v.done) {
    console.log(`END res=${v.res} d=${v.d} spd=${v.spd} (реального ${((Date.now() - t0) / 1000).toFixed(0)} с)`);
    done = true;
    break;
  }
  if (v && typeof v.t === 'number') {
    console.log(`t=${String(v.t).padStart(5)} ${v.phase} appT=${v.appT} snap=${v.snap ? 1 : 0} spd=${v.spd} d=${v.d} rud=${v.rud} sail=${v.sail} planks=${v.planks}/${v.pl}`);
  } else {
    console.log('poll-error:', String(v).slice(0, 120));
  }
  await sleep(2000);
}
if (!done) console.log('TIMEOUT 110 с: подход не закончился (и не сорвался)');
