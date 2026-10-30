// Визуальная верификация Task 17: скриншоты новых фич для VLM
// (вёсла на воде у галеры, пиратское логово с «Чёрной жемчужиной»,
//  город-крепость с фортом, экипаж на палубе Victory)
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

// === 1. Галера с ВЫВАЛЕННЫМИ вёслами (Alt+W) ===
log('1: галера с вёслами');
ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.changeShip('galley', true);
  const p = g.player;
  p.oarsOut = true; p.rowing = 1; p.oarsIdleT = 0;
  // свободная камера сбоку-сверху
  g.setCameraMode('free');
  g.rig.freeAzimSet ? g.rig.freeAzimSet(1.2) : null;
  g.rig.freeElevSet ? g.rig.freeElevSet(0.22) : null;
  g.rig.distSet ? g.rig.distSet(70) : null;
  return 'galley oars out';
})()`);
await sleep(3500);
shot('t17_galley_oars_out');
await sleep(400);

// === 2. Пиратское логово: остров + эскадра + Чёрная жемчужина ===
log('2: пиратское логово');
ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const isl = g.world.islands.find(i => i.name === 'Логово пиратов');
  const p = g.player;
  // встать поодаль от острова, носом на него
  const dx = isl.cx - 500, dz = isl.cz + 350;
  p.position.set(dx, 0, dz);
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
  p.wake.clear();
  p.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(isl.cx - dx, isl.cz - dz), 0));
  g.rig.snap();
  g.setCameraMode('iso');
  return 'at lair ' + isl.cx + ',' + isl.cz;
})()`);
await sleep(2500);
shot('t17_pirate_lair');
await sleep(400);

// === 3. Город-крепость: главная гавань с фортом и пушками ===
log('3: город-крепость');
ev(`(() => {
  const g = window.__game;
  const port = g.world.ports[0];
  const p = g.player;
  // встать НАД гаванью, глядя на берег (город+форт за хижинами)
  const dir = port.dir;
  p.position.set(port.dockEnd.x + dir.x * 160, 0, port.dockEnd.z + dir.z * 160);
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
  p.wake.clear();
  p.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(-dir.x, -dir.z), 0));
  g.rig.snap();
  g.setCameraMode('iso');
  return 'at main port';
})()`);
await sleep(2500);
shot('t17_fort_city');
await sleep(400);

// === 4. Экипаж на палубе Victory (17 фигур) ===
log('4: экипаж Victory');
ev(`(() => {
  const g = window.__game;
  g.changeShip('victory', true);
  const p = g.player;
  p.crew = 700;
  p.oarsOut = false; p.rowing = 0;
  g.setCameraMode('rear');
  g.rig.distSet ? g.rig.distSet(95) : null;
  return 'victory crew';
})()`);
await sleep(3000);
shot('t17_victory_crew');

log('done');
