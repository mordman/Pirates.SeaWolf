// Вид СВЕРХИ на шлюпку с фактическим следом — проверка рендера ленты
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
  for (let i = 0; i < 1260; i++) { t += 1/60; bl.update(1/60, t); }  // 21 с хода
  g.setCameraMode('free');
  g.rig.freeAzimSet(0);
  g.rig.freeElevSet(1.25);   // почти вертикально сверху
  g.rig.distSet(30);
  g.rig.snap();
  // где шлюпка и где точки следа (мировые)
  const pts = [];
  const mesh = bl.wake.mesh;
  const attr = mesh.geometry.getAttribute('position');
  const drawRange = mesh.geometry.drawRange;
  for (let i = 0; i < Math.min(drawRange.count, attr.count); i += 4) {
    pts.push([+attr.getX(i).toFixed(1), +attr.getZ(i).toFixed(1)]);
  }
  return JSON.stringify({
    wake: bl.wake.count(), draw: drawRange.count, pos: [ +bl.pos.x.toFixed(1), +bl.pos.z.toFixed(1) ],
    pts: pts.slice(0, 4), renderOrder: mesh.renderOrder, visible: mesh.visible,
    parent: mesh.parent ? mesh.parent.type : 'none',
  });
})()`);
console.log('state:', st);
await sleep(800);
shot('t26_wake_top');
run('close --all');
