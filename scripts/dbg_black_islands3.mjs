// ДИАГНОСТИКА 3: остров с текстурой ON vs OFF — визуальная проверка вины map.
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

// телепорт к острову 0, вид с моря на берег
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  g.player.position.set(isl.cx + 3900, 0, isl.cz + 1150);
  return 'tp';
})()`);
await sleep(400);
ev(`window.__game.stepDebugNR(6)`);
await sleep(800);
ev(`window.__game.stepDebug(1)`);
await sleep(400);
run(`screenshot /home/z/my-project/scripts/shots/dbg_tex_on.png`);
log('shot tex=ON done');

// ВЫКЛЮЧАЕМ текстуры
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.graphics.islandTextures = false; g.applySettings(s); return 'off'; })()`);
await sleep(600);
ev(`window.__game.stepDebug(1)`);
await sleep(400);
run(`screenshot /home/z/my-project/scripts/shots/dbg_tex_off.png`);
log('shot tex=OFF done');

// контроль: читаем реальные цвета тайла под камерой
const px = ev(`(() => {
  const g = window.__game;
  // рендер в render target и readPixels
  const r = g.renderer;
  const t = g.world.terrain;
  const m = t.mat;
  return 'map=' + (m.map ? 'ON(format ' + m.map.format + ')' : 'OFF') + ' vcolors=' + m.vertexColors;
})()`);
log('STATE:', px);
