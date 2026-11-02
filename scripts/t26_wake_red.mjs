// Диагностика: красная лента следа — рисуется ли вообще
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2500);

const st = ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1/60; bl.update(1/60, t); }
  bl.row = 1; bl.steer = 0;
  for (let i = 0; i < 1260; i++) { t += 1/60; bl.update(1/60, t); }
  // ПОДМЕНА материала на ярко-красный opaque
  const T = window.__THREE;
  bl.wake.mesh.material = new T.MeshBasicMaterial({ color: 0xff2020, side: T.DoubleSide });
  bl.wake.mesh.renderOrder = 10;
  g.setCameraMode('free');
  g.rig.freeAzimSet(0);
  g.rig.freeElevSet(1.25);
  g.rig.distSet(30);
  g.rig.snap();
  const attr = bl.wake.mesh.geometry.getAttribute('position');
  let ys = [];
  for (let i = 0; i < 6; i++) ys.push(+attr.getY(i*2).toFixed(2));
  const boatY = bl.vis.group.position.y;
  return JSON.stringify({
    wake: bl.wake.count(), ys, boatY: +boatY.toFixed(2),
    waterAtBoat: +g.waterHeight(bl.pos.x, bl.pos.z).toFixed(2),
  });
})()`);
console.log('state:', st);
await sleep(800);
shot('t26_wake_red');
run('close --all');
