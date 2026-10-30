// Финальный скриншот: галера гребёт назад — дольше разгон, снимок сразу
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) b.click(); return 'start'; })()`);
await sleep(3000);
log(ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0); p.crew = p.preset.maxCrew;
  p.oarsOut = true; p.rowing = -1; p.oarsIdleT = 0;
  let time = g.time;
  for (let i = 0; i < 1500; i++) { time += 1/60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2);
  g.rig.freeElevSet(0.18);
  g.rig.distSet(26);
  g.rig.snap();
  return 'knots=' + p.speedKnots().toFixed(2) + ' x=' + p.position.x.toFixed(1);
})()`));
await sleep(3400);
shot('v37_galley_reverse');
log('final HUD:', ev(`(() => { const g = window.__game; const p = g.player;
  return 'knots=' + p.speedKnots().toFixed(2) + ' rowing=' + p.rowing + ' x=' + p.position.x.toFixed(1); })()`));
