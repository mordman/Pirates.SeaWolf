// ДИАГНОСТИКА 2: телепорт к острову, снимаем остров + читаем пиксели canvas.
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
  } catch {
    try {
      const m = String(s).match(/\{.*\}|\[.*\]/s);
      if (m) { let v = JSON.parse(m[0]); if (typeof v === 'string') v = JSON.parse(v); return v; }
    } catch { }
    return null;
  }
};
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

// Телепорт: остров-гавань 0 (cx=6750, cz=5250, r=3300) — встанем у берега с моря
// looking at island. Просто поставим корабль в 3.7 км от центра.
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  const ux = 1, uz = 0.3;
  const L = Math.hypot(ux, uz);
  g.player.position.set(isl.cx + ux / L * (isl.r + 600), 0, isl.cz + uz / L * (isl.r + 600));
  g.player.velocity?.set?.(0, 0, 0);
  return 'teleported to ' + Math.round(g.player.position.x) + ',' + Math.round(g.player.position.z);
})()`);
await sleep(500);
// стример построит тайлы вокруг новой позиции
ev(`window.__game.stepDebugNR(4)`);
await sleep(1000);
ev(`window.__game.stepDebugNR(4)`);
await sleep(1000);
const tinfo = jparse(ev(`JSON.stringify(window.__sea.terrain)`));
log('TERRAIN:', JSON.stringify(tinfo));

// повернём камеру на остров? — камерой управляет rig. Попробуем напрямую:
// пусть рендерится обычный кадр несколько секунд (RAF живой после stepDebugNR?)
// делаем 2 кадра через stepDebug (с рендером в конце)
ev(`window.__game.stepDebug(1)`);
await sleep(300);

run(`screenshot /home/z/my-project/scripts/shots/dbg_island_far.png`);
log('shot far done');

// Ближе к берегу
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  const ux = 1, uz = 0.3;
  const L = Math.hypot(ux, uz);
  g.player.position.set(isl.cx + ux / L * (isl.r + 120), 0, isl.cz + uz / L * (isl.r + 120));
  return 'near coast';
})()`);
await sleep(500);
ev(`window.__game.stepDebugNR(6)`);
await sleep(500);
ev(`window.__game.stepDebug(1)`);
await sleep(300);
run(`screenshot /home/z/my-project/scripts/shots/dbg_island_near.png`);
log('shot near done');

// читаем пиксели центра canvas (WebGL)
const px = jparse(ev(`(() => {
  const g = window.__game;
  const r = g.renderer;
  const cnv = r.domElement;
  const w = cnv.width, h = cnv.height;
  // берём pixels через readRenderTarget? проще: toDataURL малой области нельзя.
  // читаем весь буфер через gl.readPixels (после render он в front buffer? — нет,
  // но preserveDrawingBuffer включим временно нельзя). Вместо этого —
  // статистика вершинных цветов ДАЛЬНЕГО тайла (FAR, 24 м) у берега:
  const t = g.world.terrain;
  let far = null, near = null;
  for (const c of t.group.children) {
    if (!c.geometry?.attributes?.color) continue;
    if (c.userData && c.userData.near === undefined) {}
    // near-флаг хранится в TerrainStreamer.tiles — недоступен напрямую;
    // различаем по плотности: сегменты = sqrt(index.count / skirt)
    // проще: посчитаем среднюю яркость
    const col = c.geometry.attributes.color.array;
    let s = 0; for (let i = 0; i < col.length; i++) s += col[i];
    const avg = s / col.length;
    if (avg < 0.5) far = Math.min(far ?? 9, avg); else near = Math.max(near ?? 0, avg);
  }
  return JSON.stringify({ minAvg: far, maxAvg: near, tiles: window.__sea.terrain.tiles, nearTiles: window.__sea.terrain.nearTiles });
})()`));
log('TILE BRIGHTNESS:', JSON.stringify(px));

const errs = jparse(ev(`JSON.stringify(window.__jsErrors || [])`));
log('JS ERRORS:', JSON.stringify(errs).slice(0, 300));
