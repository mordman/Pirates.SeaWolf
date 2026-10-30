// Досъёмка-3: светлый gunmetal стволов + якорь крупно
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
await sleep(4000);

// 1) пушки шлюпа
log(ev(`(() => {
  const g = window.__game;
  g.changeShip('sloop', true);
  const p = g.player;
  p.anchored = true; p.sailTarget = 0; p.velocity.set(0, 0, 0);
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2 + 0.25);
  g.rig.freeElevSet(0.22);
  g.rig.distSet(14);
  g.rig.snap();
  return 'sloop';
})()`));
await sleep(3000);
shot('v37_gun_metal4');
await sleep(400);

// 2) якорь у скулы носа (детали видны с 100-420 м — detailLod, камера близко)
log(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  g.setCameraMode('free');
  // якорь у носа справа: камера к носу (+X, курс восток) со стороны борта
  g.rig.freeAzimSet(Math.PI / 2 + 0.9); // между бортом и носом
  g.rig.freeElevSet(0.13);
  g.rig.distSet(14);
  g.rig.snap();
  return 'anchor cam';
})()`));
await sleep(3000);
shot('v37_anchor_metal');
log('done');
