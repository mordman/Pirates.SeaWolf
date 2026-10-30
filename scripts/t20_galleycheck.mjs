// Диагностика D4: галера, KeyS удерживается, что происходит в реальном времени
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
await sleep(3500);
console.log('setup:', ev(`(() => {
  const g = window.__game;
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0); p.crew = p.preset.maxCrew;
  p.oarsOut = true; p.rowing = -1; p.oarsIdleT = 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  return 'ok';
})()`));
await sleep(4000);
console.log('after 4s:', JSON.stringify(jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  return JSON.stringify({ rowing: p.rowing, oarsOut: p.oarsOut, deploy: +p.oarsDeployT.toFixed(2),
    knots: +p.speedKnots().toFixed(2), vy: +p.velocity.x.toFixed(2), vz: +p.velocity.z.toFixed(2),
    anchored: p.anchored, docked: g.docked, uiOpen: g.uiOpen, dead: g.dead,
    keyS: g.input.isDown('KeyS'), hud: g.hudState().speed });
})()`))));
await sleep(4000);
console.log('after 8s:', JSON.stringify(jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  return JSON.stringify({ rowing: p.rowing, deploy: +p.oarsDeployT.toFixed(2),
    knots: +p.speedKnots().toFixed(2), x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1),
    idle: +p.oarsIdleT.toFixed(1) });
})()`))));
