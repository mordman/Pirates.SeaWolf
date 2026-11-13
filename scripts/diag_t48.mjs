// Task 48: визуальная проверка — сплошная дыра в досках, вода в
// трюме на пробитом борту, крен, сбитые за борт матросы.
// Камера (cameraRig): позиция = цель + (cos azim, sin azim)·d →
// чтобы видеть ПОРТ (+X корабля), камера должна стоять на азимуте
// -heading (порт в мире = (cos h, 0, -sin h))
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

// 1) свежая пробоина: 5 попаданий в порт у ватерлинии + 3 выше
const st1 = await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.plankHull.reset();
  for (const c of p.compartments) { c.water = 0; c.leak = 0; }
  p.water = 0;
  for (let i = 0; i < 5; i++) p.hitHull(new T(2.2, 0.0, 1.0), 15, true, new T(1, 0.1, 0.2));
  for (let i = 0; i < 3; i++) p.hitHull(new T(2.2, 1.1, 1.3), 15, false, new T(1, 0.1, 0.2));
  g.stepDebugNR(1);
  return JSON.stringify(p.plankHull.byState());
})()`);
console.log('AFTER HITS:', st1);

// скриншот 1: дыра в обшивке ПОРТА (камера на порту: azim = -heading)
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.14);
  g.rig.freeAzimSet(-p.heading);
  g.rig.distSet(13);
  g.rig.snap();
  return 1;
})()`);
await sleep(1200);
run('screenshot scripts/shots/t48_hole_close.png');

// 2) затопление 70 с — вода в трюме, крен на порт
const floodInfo = await evR(`(() => {
  const g = window.__game;
  g.stepDebugNR(70);
  const p = g.player;
  const wg = p.visual.group.parent;
  const boxes = wg.children.filter(o => /^Hold_Water_/.test(o.name));
  const vis = boxes.filter(o => o.visible).map(o => o.name + ':' + (+o.scale.y.toFixed(1)));
  return JSON.stringify({
    s3: p.plankHull.byState().s3,
    water: +p.water.toFixed(1),
    floodRollDeg: +(p.floodRollCur * 57.3).toFixed(1),
    holdVis: vis,
  });
})()`);
console.log('FLOOD:', floodInfo);

// скриншот 2: общий план с кормовой четверти — крен на порт
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.14);
  g.rig.freeAzimSet(-p.heading + Math.PI / 2 + 0.55);
  g.rig.distSet(26);
  g.rig.snap();
  return 1;
})()`);
await sleep(1200);
run('screenshot scripts/shots/t48_list_stern.png');

// скриншот 3: через дыру в борту — вода в трюме (порт, у самой воды)
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.10);
  g.rig.freeAzimSet(-p.heading - 0.18);
  g.rig.distSet(8.5);
  g.rig.snap();
  return 1;
})()`);
await sleep(1200);
run('screenshot scripts/shots/t48_water_inside.png');

// 3) сбитые за борт: обстрел ближайшего судна, пловцы-трупы
await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const t = g.aiShips.map(a => a.ship).filter(s => !s.sunk && !s.sinking && !s.surrendered)
    .sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position))[0];
  for (let i = 0; i < 10; i++) t.smallArmsHit(new T(1, 0, 0));
  g.stepDebugNR(3.5);
  return 1;
})()`);
// скриншот 4: подплыть к покинувшим борт — трупы в воде лицом вниз
const over = await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const wg = p.visual.group.parent;
  const floaters = wg.children.filter(c => c.name === '' && c.type === 'Group'
    && c.position.y < -0.05 && c.children.length > 3);
  if (!floaters.length) return 'no floaters';
  const c = floaters[0];
  // встать в 14 м от скопления, камера на игрока — пловцы в кадре
  const dir = new T().subVectors(c.position, p.position).normalize();
  p.position.copy(c.position).addScaledVector(dir, -14);
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.22);
  g.rig.freeAzimSet(-p.heading + Math.PI / 3);
  g.rig.distSet(11);
  g.rig.snap();
  g.stepDebugNR(0.2);
  return 'floaters:' + floaters.length + ' y=' + c.position.y.toFixed(2);
})()`);
console.log('OVERBOARD:', over);
await sleep(1200);
run('screenshot scripts/shots/t48_overboard.png');

const errs = run('errors');
console.log('ERRORS:', String(errs).slice(0, 300));
