// E2E Task 36 — ЧАСТЬ 3: миграция схемы v8 → v9 + скриншот острова
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
const jparse = (s) => {
  try {
    let v = JSON.parse(String(s));
    if (typeof v === 'string') v = JSON.parse(v);
    return v;
  } catch { return null; }
};
const log = (...a) => console.log(...a);

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
let loaded = false;
await sleep(12000);
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { loaded = true; break; }
  await sleep(3000);
}
log('GAME LOADED:', loaded);
ev(`window.__game.start()`);
// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

log('\n===== G-финал: миграция настроек v8 → v10 =====');
ev(`(() => {
  const g = window.__game;
  const data = { ...structuredClone(g.settings), v: 8 };
  delete data.graphics.islandTextures;
  delete data.assets;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(data));
  return 'v8 saved';
})()`);
run('reload');
let reloaded = false;
await sleep(12000);
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { reloaded = true; break; }
  await sleep(3000);
}
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);
ev(`window.__game.start()`);
// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);
ev(`window.__game.stepDebugNR(3)`);
const mig = jparse(ev(`(() => {
  const g = window.__game;
  let v = null;
  try { v = JSON.parse(localStorage.getItem('seawolves.settings.v1')).v; } catch { }
  return JSON.stringify({ v, tex: g.settings.assets.islandTextures, applied: g.world.terrain.texturesOn() });
})()`));
log('loaded after reload:', reloaded, JSON.stringify(mig));
check('G6: сохранение v8 читается, islandTextures=\'grain\' по умолчанию, схема v15',
  reloaded && mig.v >= 15 && mig.tex === 'grain' && mig.applied === true);

// скриншот: остров с моря (фикс прозрачности + текстуры)
ev(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera;
  const isl = g.world.islands[0];
  const wg = g.worldGroup.position;
  const ang = Math.atan2(g.player.position.z - isl.cz, g.player.position.x - isl.cx);
  const cx = isl.cx + Math.cos(ang) * isl.r * 0.9;
  const cz = isl.cz + Math.sin(ang) * isl.r * 0.9;
  const pose = { pos: [cx + Math.cos(ang) * 700 + wg.x, 90, cz + Math.sin(ang) * 700 + wg.z], look: [cx + wg.x, 10, cz + wg.z] };
  window.__origUpdate = rig.update.bind(rig);
  rig.update = () => { cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]); cam.lookAt(pose.look[0], pose.look[1], pose.look[2]); };
  g.stepDebugNR(0.2);
  return 'pose';
})()`);
await sleep(2000);
run('screenshot /home/z/my-project/scripts/shots/t36_e2e_coast.png');
ev(`(() => { const g = window.__game; g.rig.update = window.__origUpdate; return 'ok'; })()`);

const errs = jparse(ev(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('I2: 0 ошибок JS (после перезагрузки)', Array.isArray(errs) && errs.length === 0);

log(`\n===== ИТОГ e2e_v54 (часть 3): ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
if (fails > 0) process.exit(1);
