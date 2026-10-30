// Досъёмка Task 19: правильное кадрирование (камера свободного режима
// всегда смотрит на корабль ИГРОКА — значит игрок должен стоять рядом
// с пирсом/тонущей шлюпкой, а мачту ломаем на самом игроке)
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

// === 1. Рыбацкая гавань: игрок ВСТАЛ У ПИРСА, камера смотрит вдоль причала ===
log('1: гавань с лодками и краболовками');
ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const port = g.world.ports[0];
  const dir = port.dir.clone();
  const perp = { x: -dir.z, z: dir.x };
  const p = g.player;
  // шлюп игрока — в 18 м от конца пирса, чуть в стороне
  p.position.set(port.dockEnd.x + dir.x * 18 + perp.x * 10, 0,
                 port.dockEnd.z + dir.z * 18 + perp.z * 10);
  p.velocity.set(0, 0, 0);
  const up = p.position.clone().set(0, 1, 0);
  p.quaternion.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
  p.wake.clear();
  g.rig.snap();
  g.setCameraMode('free');
  // камера со стороны моря-бока: виден и пирс вдоль кадра, и лодки
  g.rig.freeAzimSet(Math.atan2(dir.x, dir.z) + 2.55);
  g.rig.freeElevSet(0.42);
  g.rig.distSet(52);
  return 'set ' + p.position.x.toFixed(0) + ',' + p.position.z.toFixed(0);
})()`);
await sleep(3200);
shot('t19_port_fishing');
await sleep(400);

// === 2. Тонущая шлюпка: игрок в 20 м, камера направлена на неё ===
log('2: тонущая шлюпка');
const sinkInfo = ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const p = g.player;
  // ближайшая плавающая шлюпка к пирсу
  let fl = null, bd = 1e9;
  for (const b of home.boats) {
    if (!b.floating || b.sinking) continue;
    const d = Math.hypot(b.x - p.position.x, b.z - p.position.z);
    if (d < bd) { bd = d; fl = b; }
  }
  if (!fl) return 'NO BOAT';
  // игрока ставим в 22 м от шлюпки в сторону открытой воды
  const vx = fl.x - p.position.x, vz = fl.z - p.position.z;
  const L = Math.hypot(vx, vz) || 1;
  const px = fl.x - vx / L * 22, pz = fl.z - vz / L * 22;
  p.position.set(px, 0, pz);
  p.velocity.set(0, 0, 0);
  p.wake.clear();
  g.rig.snap();
  // камера ЗА игроком, смотрит сквозь него на шлюпку (лодка в кадре)
  g.rig.freeAzimSet(Math.atan2(vx / L, vz / L));
  g.rig.freeElevSet(0.22);
  g.rig.distSet(26);
  g.sinkBoatsAt(fl.x, fl.z, 3.0);
  return 'SUNK ' + fl.x.toFixed(0) + ',' + fl.z.toFixed(0);
})()`);
log('2:', sinkInfo);
await sleep(1500);
shot('t19_boat_sinking');
await sleep(400);

// === 3. Мачта игрока: ломаем на СВОЁМ галеоне — камера всегда на игроке ===
log('3: падение мачты с обвязкой');
ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.changeShip('galleon', true);
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0);
  p.clearDamage();
  p.breakMast(0);
  let time = g.time;
  for (let i = 0; i < 500; i++) { time += 1/60; p.updateVisual(time, 1/60, g.particles); }
  g.setCameraMode('free');
  // мачта валится к носу (+Z локально); курс полигона — на восток.
  // Камера сбоку-спереди, чтобы упавшая мачта с парусом была в кадре
  g.rig.freeAzimSet(0.35);
  g.rig.freeElevSet(0.2);
  g.rig.distSet(64);
  return 'mast broken, fall=' + p.mastFall[0] + ' snapped=' + p.riggingSnapped();
})()`);
await sleep(3200);
shot('t19_mast_rigging');
await sleep(400);
log('done');
