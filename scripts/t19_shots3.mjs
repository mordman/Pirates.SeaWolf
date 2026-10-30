// Досъёмка-3: ИСПРАВЛЕН azim — камера свободного режима ставится в
// player + (cos(azim), sin(azim))·d (математическая конвенция, НЕ yaw!).
// Чтобы объект О был между камерой и игроком: azim = atan2(Oz-Pz, Ox-Px)
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

// === 1. Широкий план гавани: камера С МОРЯ на пирс (позади игрока) ===
log('1: гавань, вид с моря');
ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const port = g.world.ports[0];
  const dir = port.dir.clone(); // от берега в море
  const p = g.player;
  p.position.set(port.dockEnd.x + dir.x * 16, 0, port.dockEnd.z + dir.z * 16);
  p.velocity.set(0, 0, 0); p.wake.clear();
  const up = p.position.clone().set(0, 1, 0);
  p.quaternion.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
  g.rig.snap();
  g.setCameraMode('free');
  // камера дальше в море, azim по НАПРАВЛЕНИЮ СМЕЩЕНИЯ (dx,dz): atan2(dz,dx)
  g.rig.freeAzimSet(Math.atan2(dir.z, dir.x));
  g.rig.freeElevSet(0.5);
  g.rig.distSet(58);
  return 'wide set';
})()`);
await sleep(3200);
shot('t19_port_fishing');
await sleep(400);

// === 2. Крупно: шлюпка у пирса ЗАНИМАЕТ передний план ===
log('2: шлюпка крупно');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const p = g.player;
  const fl = home.boats.find(b => b.floating);
  let vx = fl.x - p.position.x, vz = fl.z - p.position.z;
  let L = Math.hypot(vx, vz) || 1;
  // игрок в 14 м от шлюпки; камера ЗА шлюпкой (шлюпка в 6 м от объектива)
  p.position.set(fl.x - vx / L * 14, 0, fl.z - vz / L * 14);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  vx = fl.x - p.position.x; vz = fl.z - p.position.z; L = Math.hypot(vx, vz) || 1;
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(vz / L, vx / L));
  g.rig.freeElevSet(0.28);
  g.rig.distSet(20);
  return 'boat close';
})()`);
await sleep(3000);
shot('t19_boats_close');
await sleep(400);

// === 3. Тонущая шлюпка: тот же ракурс, топим ПЕРЕДНЮЮ шлюпку ===
log('3: тонущая шлюпка');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const fl = home.boats.find(b => b.floating && !b.sinking);
  g.sinkBoatsAt(fl.x, fl.z, 3.0);
  return 'sunk ' + fl.x.toFixed(0) + ',' + fl.z.toFixed(0);
})()`);
await sleep(1250);
shot('t19_boat_sinking');
await sleep(400);

// === 4. Берег: вытащенная шлюпка + краболовки + вешало ===
log('4: берег с краболовками');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const p = g.player;
  const beach = home.boats.find(b => !b.floating);
  let vx = beach.x - p.position.x, vz = beach.z - p.position.z;
  let L = Math.hypot(vx, vz) || 1;
  p.position.set(beach.x - vx / L * 13, 0, beach.z - vz / L * 13);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  vx = beach.x - p.position.x; vz = beach.z - p.position.z; L = Math.hypot(vx, vz) || 1;
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(vz / L, vx / L) - 0.5);
  g.rig.freeElevSet(0.2);
  g.rig.distSet(17);
  return 'beach set';
})()`);
await sleep(3000);
shot('t19_beach_traps');
await sleep(400);
log('done');
