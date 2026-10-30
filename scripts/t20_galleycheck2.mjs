// Диагностика D4 точно: полигон + прогрев + KeyS + замер скорости/времени
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (s) => { let v = s; for (let i = 0; i < 4; i++) { if (typeof v !== 'string') break; try { v = JSON.parse(v); } catch { break; } } return v; };
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) b.click(); return 'start'; })()`);
await sleep(3000);
console.log('proving+setup:', ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0); p.crew = p.preset.maxCrew;
  p.oarsOut = true; p.rowing = -1; p.oarsIdleT = 0;
  let time = g.time;
  for (let i = 0; i < 420; i++) { time += 1/60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  window.__t0 = performance.now(); window.__g0 = g.time;
  return 'warm knots=' + p.speedKnots().toFixed(2);
})()`));
const probe = (label) => console.log(label, JSON.stringify(jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  const wall = (performance.now() - window.__t0) / 1000;
  const gameT = g.time - window.__g0;
  return JSON.stringify({ wall: +wall.toFixed(1), gameT: +gameT.toFixed(1),
    rowing: p.rowing, knots: +p.speedKnots().toFixed(2),
    x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1), deploy: +p.oarsDeployT.toFixed(2) });
})()`))));
await sleep(1300); probe('t+1.3s:');
await sleep(1300); probe('t+2.6s:');
