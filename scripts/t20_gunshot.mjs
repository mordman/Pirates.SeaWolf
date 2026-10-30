// Досъёмка: палубные орудия шлюпа крупно (металл стволов с PBR)
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
await sleep(2500);

// шлюп: 2 палубных орудия на борт; камера над планширем смотрит на орудия
log(ev(`(() => {
  const g = window.__game;
  g.changeShip('sloop', true);
  const p = g.player;
  p.anchored = true; p.sailTarget = 0; p.velocity.set(0, 0, 0);
  g.setCameraMode('free');
  // курс восток, правый борт +Z: камера сбоку-сверху, заглядывает на палубу
  g.rig.freeAzimSet(Math.PI / 2 + 0.25);
  g.rig.freeElevSet(0.22);
  g.rig.distSet(14);
  g.rig.snap();
  const guns = p.visual.gunsPort.length;
  return 'sloop guns=' + guns;
})()`));
await sleep(2800);
shot('v37_gun_metal2');
log('shot taken');
