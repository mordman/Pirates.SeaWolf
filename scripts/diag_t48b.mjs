// Task 48: прицельные кадры — вода в трюме через пролом + пловцы
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

// пробоина в порту у ватерлинии + затопление
await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.plankHull.reset();
  for (const c of p.compartments) { c.water = 0; c.leak = 0; }
  p.water = 0;
  for (let i = 0; i < 5; i++) p.hitHull(new T(2.2, 0.0, 1.0), 15, true, new T(1, 0.1, 0.2));
  for (let i = 0; i < 3; i++) p.hitHull(new T(2.2, 1.1, 1.3), 15, false, new T(1, 0.1, 0.2));
  g.stepDebugNR(70);
  return 1;
})()`);
// кадр 1: пролом у ватерлинии, низкая камера точно с порта
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.10);
  g.rig.freeAzimSet(-p.heading + 0.06);
  g.rig.distSet(10);
  g.rig.snap();
  return 1;
})()`);
await sleep(1200);
run('screenshot scripts/shots/t48_water_inside.png');

// пловцы-трупы: обстрелять ближнее судно, камера СКВОЗЬ пловцов
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
  // центр скопления
  const c0 = new T();
  for (const f of floaters) c0.add(f.position);
  c0.divideScalar(floaters.length);
  // игрок в 7 м от скопления; камера НАД скоплением смотрит на игрока:
  // пловцы — в кадре между камерой и кораблём
  const dir = new T().subVectors(c0, p.position); dir.y = 0;
  const dist = Math.max(4, dir.length());
  dir.normalize();
  p.position.copy(c0).addScaledVector(dir, -7);
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.28);
  g.rig.freeAzimSet(Math.atan2(dir.z, dir.x));
  g.rig.distSet(9);
  g.rig.snap();
  g.stepDebugNR(0.2);
  return 'floaters:' + floaters.length;
})()`);
console.log('OVERBOARD:', over);
await sleep(1200);
run('screenshot scripts/shots/t48_overboard.png');

// кадр 3: пролом крупно снаружи (для отчёта)
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.15);
  g.rig.freeAzimSet(-p.heading);
  g.rig.distSet(12);
  g.rig.snap();
  return 1;
})()`);
await sleep(1200);
run('screenshot scripts/shots/t48_hole_close.png');
console.log('ERRORS:', String(run('errors')).slice(0, 200));
