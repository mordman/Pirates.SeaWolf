// Task 48: финальные кадры — дыра сразу после пробоины (до крена),
// крен затопленного борта, пловцы-трупы крупно
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// камера по мировым координатам дыры (учитывает курс корабля)
const aimAtHole = (dist, elev) => evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const broken = p.plankHull.records.filter(r => r.state === 3);
  if (!broken.length) return 'no broken';
  const avg = new T();
  for (const r of broken) avg.add(r.center);
  avg.divideScalar(broken.length).applyQuaternion(p.visual.group.quaternion).add(p.position);
  const dir = new T().subVectors(avg, p.position); dir.y = 0; dir.normalize();
  g.rig.mode = 'free';
  g.rig.freeElevSet(${elev});
  g.rig.freeAzimSet(Math.atan2(dir.z, dir.x));
  g.rig.distSet(${dist});
  g.rig.snap();
  return 1;
})()`);

// 1) свежая пробоина — снимаем СРАЗУ (крен ещё не развился)
await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.plankHull.reset();
  for (const c of p.compartments) { c.water = 0; c.leak = 0; }
  p.water = 0;
  for (let i = 0; i < 4; i++) p.hitHull(new T(2.2, 0.4, 1.0), 15, true, new T(1, 0.1, 0.2));
  for (let i = 0; i < 3; i++) p.hitHull(new T(2.2, 1.4, 1.2), 15, false, new T(1, 0.1, 0.2));
  g.stepDebugNR(2);
  return JSON.stringify(p.plankHull.byState());
})()`).then(r => console.log('HITS:', r));
await aimAtHole(7, 0.16);
await sleep(1200);
run('screenshot scripts/shots/t48_hole_fresh.png');

// 2) вода внутри через дыру (низкая камера)
await aimAtHole(6, 0.10);
await sleep(1200);
run('screenshot scripts/shots/t48_water_inside.png');

// 3) затопление 75 с — крен на пробитый борт (общий план)
await evR(`(() => { window.__game.stepDebugNR(75); return 1; })()`);
await aimAtHole(24, 0.13);
await sleep(1200);
run('screenshot scripts/shots/t48_list_wide.png');

// 4) пловцы-трупы крупно: обстрел ближнего судна
await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const t = g.aiShips.map(a => a.ship).filter(s => !s.sunk && !s.sinking && !s.surrendered)
    .sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position))[0];
  for (let i = 0; i < 12; i++) t.smallArmsHit(new T(1, 0, 0));
  g.stepDebugNR(3.5);
  return 1;
})()`);
const over = await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const wg = p.visual.group.parent;
  const floaters = wg.children.filter(c => c.type === 'Group'
    && c.name === '' && c.position.y < -0.05 && c.children.length > 3);
  if (!floaters.length) return 'no floaters';
  const c0 = new T();
  for (const f of floaters) c0.add(f.position);
  c0.divideScalar(floaters.length);
  // игрок в 10 м от скопления, камера 7 м в сторону скопления:
  // пловцы — в БЛИЖНЕМ плане перед камерой, корабль дальше
  const dir = new T().subVectors(c0, p.position); dir.y = 0;
  dir.normalize();
  p.position.copy(c0).addScaledVector(dir, -10);
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.30);
  g.rig.freeAzimSet(Math.atan2(dir.z, dir.x));
  g.rig.distSet(7);
  g.rig.snap();
  g.stepDebugNR(0.2);
  return 'floaters:' + floaters.length;
})()`);
console.log('OVERBOARD:', over);
await sleep(1200);
run('screenshot scripts/shots/t48_overboard.png');
console.log('ERRORS:', String(run('errors')).slice(0, 200));
