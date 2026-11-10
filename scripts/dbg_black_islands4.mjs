// ДИАГНОСТИКА 4: смотрим НА остров (heading по направлению к центру), текстура ON/OFF.
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
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const log = (...a) => console.log(...a);

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(12000);
let loaded = false;
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { loaded = true; break; }
  await sleep(3000);
}
log('GAME LOADED:', loaded);
ev(`window.__game.start()`);
await sleep(400);

// телепорт + курс на центр острова
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  const px = isl.cx + 3900, pz = isl.cz + 1150;
  g.player.position.set(px, 0, pz);
  const h = Math.atan2(isl.cx - px, isl.cz - pz);
  g.player.quaternion.setFromEuler(new g.player.quaternion.constructor().set(0, h, 0));
  if (g.player.angular) g.player.angular.set(0, 0, 0);
  if (g.player.velocity) g.player.velocity.set(0, 0, 0);
  return 'tp h=' + h.toFixed(2);
})()`);
await sleep(400);
ev(`window.__game.stepDebugNR(6)`);
await sleep(800);
// повторно выставить курс (физика могла повернуть)
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  const px = g.player.position.x, pz = g.player.position.z;
  const h = Math.atan2(isl.cx - px, isl.cz - pz);
  g.player.quaternion.setFromEuler(new g.player.quaternion.constructor().set(0, h, 0));
  if (g.player.rudder) g.player.rudder = 0;
  return 're-aim';
})()`);
ev(`window.__game.stepDebug(0.5)`);
await sleep(500);
run(`screenshot /home/z/my-project/scripts/shots/dbg_tex_on.png`);
log('shot tex=ON done');

ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.graphics.islandTextures = false; g.applySettings(s); return 'off'; })()`);
await sleep(600);
ev(`window.__game.stepDebug(0.5)`);
await sleep(400);
run(`screenshot /home/z/my-project/scripts/shots/dbg_tex_off.png`);
log('shot tex=OFF done');

const st = ev(`(() => { const m = window.__game.world.terrain.mat; return 'map=' + (m.map ? 'ON' : 'OFF'); })()`);
log('STATE:', st);
