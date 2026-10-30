// Досъёмка-4: берег с вешалом/шлюпкой (камера ЦЕЛИТСЯ между ними),
// тонущая шлюпка раньше (0.7 с — ловим брызги)
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

// === 1. Пляж: камера смотрит на вешало, шлюпка рядом ===
log('1: берег — вешало + шлюпка');
ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const home = g.world.fishing[0];
  const p = g.player;
  // ближайшее к пляжной шлюпке вешало
  const beach = home.boats.find(b => !b.floating);
  const rack = home.racks[0];
  // точка между шлюпкой и вешалом
  const mx = (beach.x + rack.x) / 2, mz = (beach.z + rack.z) / 2;
  // игрок в 12 м от этой точки со стороны воды
  let vx = p.position.x - mx, vz = p.position.z - mz;
  const L = Math.hypot(vx, vz) || 1;
  p.position.set(mx + vx / L * 12, 0, mz + vz / L * 12);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  g.setCameraMode('free');
  // камера за игроком, цель (шлюпка+вешало) между камерой и игроком
  vx = mx - p.position.x; vz = mz - p.position.z;
  const L2 = Math.hypot(vx, vz) || 1;
  g.rig.freeAzimSet(Math.atan2(vz / L2, vx / L2));
  g.rig.freeElevSet(0.22);
  g.rig.distSet(19);
  return 'beach ' + mx.toFixed(0) + ',' + mz.toFixed(0);
})()`);
await sleep(3000);
shot('t19_beach_traps');
await sleep(400);

// === 2. Тонущая шлюпка + брызги (0.7 с после разрыва) ===
log('2: тонущая шлюпка с брызгами');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const p = g.player;
  const fl = home.boats.find(b => b.floating);
  let vx = fl.x - p.position.x, vz = fl.z - p.position.z;
  let L = Math.hypot(vx, vz) || 1;
  p.position.set(fl.x - vx / L * 13, 0, fl.z - vz / L * 13);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  vx = fl.x - p.position.x; vz = fl.z - p.position.z; L = Math.hypot(vx, vz) || 1;
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(vz / L, vx / L));
  g.rig.freeElevSet(0.26);
  g.rig.distSet(18);
  return 'ready';
})()`);
await sleep(2600);
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const fl = home.boats.find(b => b.floating && !b.sinking);
  g.sinkBoatsAt(fl.x, fl.z, 3.0);
  return 'boom';
})()`);
await sleep(700);
shot('t19_boat_sinking');
await sleep(400);
log('done');
