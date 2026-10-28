// E2E v26a: диагностика «чёрного дыма» — калибровочный клуб перед камерой
// на фоне неба + залп с близкой дистанции. Скриншоты для VLM.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');

console.log('=== Старт обычного режима ===');
run('find text "Поднять флаг" click');
await sleep(7000);

// калибровка: 1 клуб дыма прямо перед камерой, на фоне неба
console.log('=== Калибровочный клуб перед камерой ===');
ev(`(() => {
  const g = window.__game;
  const cam = g.rig.camera.position;
  // направление камеры: берём матрицу камеры (THREE в контексте страницы нет)
  const e = g.rig.camera.matrixWorld.elements;
  const dx = -e[8], dy = -e[9], dz = -e[10]; // -Z ось камеры (взгляд)
  const p = { x: cam.x + dx * 14, y: cam.y + dy * 14 + 0.5, z: cam.z + dz * 14 };
  const s = g.worldGroup.position;
  const q = { x: p.x - s.x, y: p.y - s.y, z: p.z - s.z };
  g.particles.smoke(q.x, q.y, q.z, 0.3, 0.35, 0.3, 2.4, 2.6);
  g.particles.smoke(q.x + 1.4, q.y - 0.5, q.z - 1, 0.2, 0.3, 0.2, 3.2, 3.4);
  window.__cal = q;
  return 'spawned ' + JSON.stringify(q) + ' cam ' + JSON.stringify({x:cam.x,y:cam.y,z:cam.z});
})()`);
await sleep(400);
shot('v26_calib_early');
await sleep(1400);
shot('v26_calib_mid');
await sleep(1600);
shot('v26_calib_late');

// крупный план: подвести камеру боковую и дать залп
console.log('=== Залп крупным планом (side) ===');
ev(`(() => {
  const g = window.__game;
  g.rig.cycleMode();
  g.rig.cycleMode();
  return g.rig.mode;
})()`);
ev(`(() => { const a = window.__game.combat.aim; a.active = true; a.side = 1; a.azimuth = 0; a.elevation = 0.04; return 'aim'; })()`);
let ready = 0;
for (let i = 0; i < 40; i++) {
  ready = parseFloat(ev('window.__game.combat.readiness()'));
  if (ready >= 0.999) break;
  await sleep(1500);
}
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
await sleep(300);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
await sleep(500);
shot('v26_volley_flash');
await sleep(1800);
shot('v26_volley_smoke');
await sleep(2500);
shot('v26_volley_late');
console.log('done');
