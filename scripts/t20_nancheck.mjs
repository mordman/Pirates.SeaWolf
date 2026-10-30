// Локализация NaN: где галера и что под килем
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
console.log(JSON.stringify(jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0); p.crew = p.preset.maxCrew;
  p.oarsOut = true; p.rowing = -1; p.oarsIdleT = 0;
  const log = [];
  let time = g.time;
  for (let i = 0; i < 1500; i++) {
    time += 1/60;
    p.fixedStep(1/60, time);
    p.updateVisual(time, 1/60, g.particles);
    if (i % 150 === 0 || !isFinite(p.position.x)) {
      log.push({ i, x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1),
        y: +p.position.y.toFixed(2), kn: +p.speedKnots().toFixed(2),
        gr: p.grounded, h: +g.waterHeight(p.position.x, p.position.z).toFixed(2) });
      if (!isFinite(p.position.x)) { log.push({ NaN_AT: i }); break; }
    }
  }
  const w = g.world.islands.map(is => ({ n: is.name, x: Math.round(is.cx), z: Math.round(is.cz), r: is.r }));
  return JSON.stringify({ log, w: w.filter(is => Math.hypot(is.x-2300, is.z-2300) < 600) });
})()`))));
