// Досъёмка-2: КРУПНЫЕ планы — камера вплотную к шлюпкам у пирса
// (в широком плане 3.6-метровые шлюпки слишком малы для VLM)
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

// телеметрия: видимы ли шлюпки вообще
log('vis:', ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const home = g.world.fishing[0];
  const p = g.player;
  const port = g.world.ports[0];
  p.position.set(port.dockEnd.x, 0, port.dockEnd.z);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  return JSON.stringify({
    groupVis: home.group.visible,
    boats: home.boats.map(b => ({ f: b.floating, v: b.mesh.visible, x: b.x.toFixed(0), z: b.z.toFixed(0) })),
    player: [p.position.x.toFixed(0), p.position.z.toFixed(0)],
  });
})()`));

// === 1. КРУПНО: шлюпки у пирса + краболовки + рыбак ===
log('1: крупный план шлюпок');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const p = g.player;
  const port = g.world.ports[0];
  const dir = port.dir.clone();
  // первая пришвартованная шлюпка
  const fl = home.boats.find(b => b.floating);
  const vx = fl.x - p.position.x, vz = fl.z - p.position.z;
  const L = Math.hypot(vx, vz) || 1;
  // игрок в 15 м от шлюпки, чтобы пирс был за кадром позади неё
  p.position.set(fl.x - vx / L * 15, 0, fl.z - vz / L * 15);
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(vx / L, vz / L));
  g.rig.freeElevSet(0.3);
  g.rig.distSet(24);
  return 'close ' + fl.x.toFixed(0) + ',' + fl.z.toFixed(0);
})()`);
await sleep(3000);
shot('t19_boats_close');
await sleep(400);

// === 2. Тонущая шлюпка КРУПНО (та же точка) ===
log('2: тонущая шлюпка крупно');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const fl = home.boats.find(b => b.floating && !b.sinking);
  g.sinkBoatsAt(fl.x, fl.z, 3.0);
  return 'sunk2 ' + fl.x.toFixed(0) + ',' + fl.z.toFixed(0);
})()`);
await sleep(1300);
shot('t19_boat_sinking');
await sleep(400);

// === 3. Пляж: краболовки + вешало с рыбой + вытащенные шлюпки ===
log('3: берег с краболовками');
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const p = g.player;
  const port = g.world.ports[0];
  const dir = port.dir.clone();
  const perp = { x: -dir.z, z: dir.x };
  const beach = home.boats.find(b => !b.floating);
  if (beach) {
    const vx = beach.x - p.position.x, vz = beach.z - p.position.z;
    const L = Math.hypot(vx, vz) || 1;
    p.position.set(beach.x - vx / L * 16, 0, beach.z - vz / L * 16);
  }
  p.velocity.set(0, 0, 0); p.wake.clear(); g.rig.snap();
  g.setCameraMode('free');
  const dx = beach ? beach.x - p.position.x : 1, dz = beach ? beach.z - p.position.z : 0;
  g.rig.freeAzimSet(Math.atan2(dx, dz) + 0.55);
  g.rig.freeElevSet(0.24);
  g.rig.distSet(20);
  return 'beach';
})()`);
await sleep(3000);
shot('t19_beach_traps');
await sleep(400);
log('done');
