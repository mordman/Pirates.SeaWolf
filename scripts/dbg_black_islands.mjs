// ДИАГНОСТИКА: чёрные острова + чёрные артефакты.
// Открываем игру, стартуем, ждём стример рельефа, снимаем пиксели
// с WebGL-канваса (gl.readPixels через renderer) + скриншоты.
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
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(300);
ev(`window.__game.start()`);
await sleep(400);
// телепорт к острову-гавани + несколько шагов стримера
ev(`window.__game.stepDebugNR(10)`);
await sleep(2000);
ev(`window.__game.stepDebugNR(10)`);
await sleep(2000);

// --- 1. Материал и текстура ---
const mat = jparse(ev(`(() => {
  const g = window.__game;
  const t = g.world.terrain;
  const m = t.mat || (t.group.children[0] && t.group.children[0].material);
  const tex = m && m.map;
  return JSON.stringify({
    hasMat: !!m, vertexColors: m ? m.vertexColors : null,
    map: tex ? { format: tex.format, type: tex.type, w: tex.image?.width, h: tex.image?.height, colorSpace: tex.colorSpace, wrapS: tex.wrapS, genMip: tex.generateMipmaps, minF: tex.minFilter, imgCtor: tex.image?.constructor?.name, dataLen: tex.image?.data?.length } : null,
    tiles: window.__sea?.terrain?.tiles,
  });
})()`));
log('MATERIAL:', JSON.stringify(mat));

// --- 2. Пиксели канваса: скриншот всего + зум на остров ---
run(`screenshot /home/z/my-project/scripts/shots/dbg_black_1.png`);
log('shot 1 done');

// --- 3. Что в вершинных цветах тайла? ---
const vc = jparse(ev(`(() => {
  const g = window.__game;
  const t = g.world.terrain;
  let mesh = null;
  for (const c of t.group.children) { if (c.geometry && c.geometry.attributes.color) { mesh = c; break; } }
  if (!mesh) return JSON.stringify({ err: 'no tile' });
  const col = mesh.geometry.attributes.color.array;
  const pos = mesh.geometry.attributes.position.array;
  let dark = 0, n = col.length / 3;
  let minV = 9, maxV = -9;
  for (let i = 0; i < col.length; i++) { if (col[i] < minV) minV = col[i]; if (col[i] > maxV) maxV = col[i]; if (col[i] < 0.06) dark++; }
  return JSON.stringify({ n, darkFrac: +(dark / col.length * 3).toFixed(3), minV: +minV.toFixed(3), maxV: +maxV.toFixed(3),
    sample: Array.from(col.slice(0, 12)).map(v => +v.toFixed(3)),
    posSample: Array.from(pos.slice(0, 6)).map(v => +v.toFixed(1)) });
})()`));
log('VERTEX COLORS:', JSON.stringify(vc));

// --- 4. Ошибки JS ---
const errs = jparse(ev(`JSON.stringify(window.__jsErrors)`));
log('JS ERRORS:', JSON.stringify(errs).slice(0, 500));

// --- 5. Освещение/рендерер ---
const light = jparse(ev(`(() => {
  const g = window.__game;
  const r = g.renderer;
  return JSON.stringify({
    tone: r.toneMapping, exposure: r.toneMappingExposure,
    output: r.outputColorSpace,
    shadows: r.shadowMap.enabled, shadowType: r.shadowMap.type,
  });
})()`));
log('RENDERER:', JSON.stringify(light));
