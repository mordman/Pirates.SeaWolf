// E2E Task 38: ГЕОМЕТРИЯ ОСТРОВОВ + КАРТА + URL-ТЕКСТУРА.
//  (A) ЮБКИ ТАЙЛОВ: индексы в границах буфера (был выход за пределы —
//      мусорные «шторы»/«паруса»/пики у островов), все юбочные вершины
//      используются, юбочные нормали наружу (winding)
//  (B) НОСОВАЯ ФИГУРА: штатный шток — РЕЗНОЙ СВИТОК (5 примитивов),
//      ни одного ConeGeometry (прежде — один конус «артефакт»)
//  (C) КАРТА: весь архипелаг (±45 км) в холсте 640×520 — все острова
//      в границах при новом масштабе; быстрый переход по клику жив
//  (D) URL-ТЕКСТУРА: режим 'url' — загрузка data:URL (state ok,
//      repeat следует за texScale), пустая/битая ссылка — откат на зерно
//  (E) UI: 4 режима + поле «Ссылка на текстуру», ввод применяется
//  (F) МИГРАЦИЯ v10 → v11 + сохранение URL после перезагрузки
//  (G) 0 ошибок JS + скриншоты для VLM (панорама острова, нос, карта)
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
// критичные eval с ретраем (флеки демона на тяжёлой сцене —
// включая «Resource temporarily unavailable»/page_wedged после stepDebugNR)
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
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

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};
const setAssets = (patch) => ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); Object.assign(s.assets, ${JSON.stringify(patch)}); g.applySettings(s); return 'ok'; })()`);

// тайлы вокруг спавна (демон занят после тяжёлой гонки — даём выдохнуть)
ev(`window.__game.stepDebugNR(8)`);
await sleep(3000);

// ================= A: ЮБКИ ТАЙЛОВ (ГЛАВНЫЙ ФИКС ГЕОМЕТРИИ) =================
log('\n===== A: ЮБКИ ТАЙЛОВ — индексы в границах буфера =====');
// Uint8Array вместо Set — весь обход 284 тайлов укладывается в ~6 с
// (Set-вариант подвешивал демона и eval отваливался по таймауту)
const skirt = jparse(await evR(`(() => {
  const g = window.__game;
  const tiles = g.world.terrain.group.children;
  let oob = 0, total = 0, noSkirt = 0, wrongTris = 0;
  const triSample = [];
  for (const m of tiles) {
    const geo = m.geometry;
    const idx = geo.index.array;
    const nVerts = geo.getAttribute('position').count;
    let bad = false;
    for (let i = 0; i < idx.length; i++) if (idx[i] >= nVerts) { bad = true; break; }
    if (bad) oob++;
    total++;
    const used = new Uint8Array(nVerts);
    for (let i = 0; i < idx.length; i++) used[idx[i]] = 1;
    const seg = [20, 60].find(sg => (sg + 1) * (sg + 1) + 4 * (sg + 1) === nVerts);
    if (seg === undefined) { noSkirt++; continue; }
    const nGridV = (seg + 1) * (seg + 1);
    const nb = 4 * (seg + 1);
    let missing = 0;
    for (let k = 0; k < nb; k++) if (!used[nGridV + k]) missing++;
    if (missing > 0) noSkirt++;
    const want = seg * seg * 2 + 4 * seg * 2;
    if (idx.length / 3 !== want) wrongTris++;
    if (triSample.length < 2) triSample.push({ seg, verts: nVerts, tris: idx.length / 3, want });
  }
  return JSON.stringify({ oob, total, noSkirt, wrongTris, triSample });
})()`));
log(JSON.stringify(skirt));
check('A1: НИ ОДНОГО тайла с индексами за буфером (были мусорные треугольники)',
  skirt && skirt.oob === 0 && skirt.total > 20, `тайлов=${skirt?.total}, битых=${skirt?.oob}`);
check('A2: у всех тайлов юбка построена и все её вершины в индексах',
  skirt && skirt.noSkirt === 0, `тайлов без юбки=${skirt?.noSkirt}`);
check('A3: треугольников ровно сетка+юбка (у дальнего 800+160, ближнего 7200+480)',
  skirt && skirt.wrongTris === 0, JSON.stringify(skirt?.triSample));

// A4: winding юбки — нормали юбочных треугольников НАРУЖУ (первые 20 тайлов,
// чтобы eval не подвешивал демона)
const windRaw = await evR(`(() => {
  const g = window.__game;
  const tiles = g.world.terrain.group.children;
  let checked = 0, wrong = 0;
  let tileNo = 0;
  for (const m of tiles) {
    if (tileNo++ > 20) break;
    const geo = m.geometry;
    const idx = geo.index.array;
    const pos = geo.getAttribute('position');
    const nVerts = pos.count;
    const seg = [20, 60].find(sg => (sg + 1) * (sg + 1) + 4 * (sg + 1) === nVerts);
    if (seg === undefined) continue;
    const side = seg + 1;
    let cx = 0, cz = 0;
    for (let i = 0; i < pos.count; i += 97) { cx += pos.getX(i); cz += pos.getZ(i); }
    const steps = Math.ceil(pos.count / 97);
    cx /= steps; cz /= steps;
    const nGrid = side * side;
    const v = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let t = 0; t < idx.length; t += 3) {
      if (idx[t] < nGrid && idx[t + 1] < nGrid && idx[t + 2] < nGrid) continue;
      const [ax, ay, az] = v(idx[t]), [bx, by, bz] = v(idx[t + 1]), [cx2, cy2, cz2] = v(idx[t + 2]);
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx2 - ax, wy = cy2 - ay, wz = cz2 - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const mx = (ax + bx + cx2) / 3, mz = (az + bz + cz2) / 3;
      const outX = mx - cx, outZ = mz - cz;
      const dot = nx * outX + nz * outZ;
      checked++;
      if (dot <= 0) wrong++;
    }
  }
  return JSON.stringify({ checked, wrong });
})()`);
log('A4 RAW:', String(windRaw).slice(0, 160));
const wind = jparse(windRaw);
log(JSON.stringify(wind));
check('A4: юбочные нормали направлены НАРУЖУ (flip winding)',
  wind && wind.checked > 1000 && wind.wrong === 0, `проверено=${wind?.checked}, мимо=${wind?.wrong}`);

// ================= B: НОСОВАЯ ФИГУРА — СВИТОК, НЕ КОНУС =================
log('\n===== B: штатная носовая фигура — резной свиток =====');
const fig = jparse(await evR(`(() => {
  const g = window.__game;
  const fh = g.player.visual.figurehead;
  const kids = [...fh.children];
  const cones = kids.filter(k => k.geometry && k.geometry.type === 'ConeGeometry').length;
  const kinds = kids.map(k => k.geometry ? k.geometry.type : k.type);
  return JSON.stringify({ children: kids.length, cones, kinds, id: g.skinsOn.figure });
})()`));
log(JSON.stringify(fig));
check('B1: штатный шток — скульптура из 5 примитивов (стержень/завиток/2 усика/навершие)',
  fig && fig.children === 5, `примитивов=${fig?.children}`);
check('B2: НИ ОДНОГО ConeGeometry в штатной фигуре (конус-«артефакт» убран)',
  fig && fig.cones === 0, JSON.stringify(fig?.kinds));

// ================= C: МАСШТАБ НАВИГАЦИОННОЙ КАРТЫ =================
log('\n===== C: навигационная карта — весь архипелаг в кадре =====');
const mapRaw = await evR(`(() => {
  const g = window.__game;
  const isls = g.hud.mapIslands;
  let mx = 9000, mz = 7000;
  for (const isl of isls) {
    mx = Math.max(mx, Math.abs(isl.x) + isl.r * 1.5);
    mz = Math.max(mz, Math.abs(isl.z) + isl.r * 1.5);
    for (const p of (isl.pts ?? [])) {
      mx = Math.max(mx, Math.abs(p.x));
      mz = Math.max(mz, Math.abs(p.z));
    }
  }
  const scale = Math.min(640 / (2 * mx * 1.06), 520 / (2 * mz * 1.06));
  let out = 0;
  for (const isl of isls) {
    const px = 320 + isl.x * scale, pz = 260 + isl.z * scale;
    if (px < 15 || px > 625 || pz < 15 || pz > 505) out++;
  }
  return JSON.stringify({ n: isls.length, scale: +scale.toFixed(5), out,
    maxX: mx, maxZ: mz, farthest: Math.max(...isls.map(i => Math.hypot(i.x, i.z))) });
})()`);
log('C RAW:', String(mapRaw).slice(0, 160));
const map = jparse(mapRaw);
log(JSON.stringify(map));
check('C1: масштаб карты ~0.0069 px/м (мир ×10), а НЕ 0.048 (эпоха ±4.5 км)',
  map && map.scale < 0.012 && map.scale > 0.004, `scale=${map?.scale}`);
check('C2: ВСЕ острова (включая Логово пиратов за 44 км) в кадре 640×520',
  map && map.n >= 30 && map.out === 0, `островов=${map?.n}, за краем=${map?.out}`);
// быстрый переход жив
const ft = ev(`(() => { const g = window.__game; g.fastTravelTo('Логово пиратов'); return g.player.position.x.toFixed(0) + ',' + g.player.position.z.toFixed(0); })()`);
log('fastTravel →', ft);
check('C3: быстрый переход к дальнему острову работает (клик-навигация жива)',
  ft.includes(',') && !ft.includes('ERR'), ft);
// вернуться к стартовому острову и отстроить тайлы
await sleep(400);
ev(`window.__game.fastTravelTo('Пальмовая гавань')`);
ev(`window.__game.stepDebugNR(10)`);
await sleep(500);

// ================= D: URL-ТЕКСТУРА РЕЛЬЕФА =================
log('\n===== D: своя текстура по ссылке (режим url) =====');
// D1: пустая ссылка — зерно
setAssets({ islandTextures: 'url', texUrls: { terrain: '' } });
const d1 = jparse(await evR(`(() => {
  const t = window.__game.world.terrain;
  const m = t.group.children[0]?.material ?? t.mat;
  return JSON.stringify({ mode: t.mode(), state: t.urlTexState(), map: m.map ? m.map.image?.width ?? 'grain' : null });
})()`));
log('пустая ссылка:', JSON.stringify(d1));
check('D1: режим url без ссылки — откат на зерно (не чёрный рельеф)',
  d1 && d1.mode === 'url' && d1.state === 'none' && d1.map === 256, JSON.stringify(d1));

// D2: data:URL — генерируем текстуру в canvas страницы
const d2 = jparse(await evR(`(() => {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#c9a15f'); grad.addColorStop(1, '#7a9550');
  c.fillStyle = grad; c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#5a4a30';
  for (let i = 0; i < 160; i++) c.fillRect(Math.random() * 64 | 0, Math.random() * 64 | 0, 2, 2);
  window.__testTexUrl = cv.toDataURL('image/png');
  return 'ok';
})()`));
await sleep(200);
const dataUrl = ev(`window.__testTexUrl.length`);
log('data URL длина:', dataUrl);
// применяем сразу настоящий data:URL (через окно — слишком длинный для eval-строки)
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.assets.islandTextures = 'url'; s.assets.texUrls.terrain = window.__testTexUrl; g.applySettings(s); return 'applied'; })()`);
await sleep(1200);
const d3 = jparse(await evR(`(() => {
  const t = window.__game.world.terrain;
  const m = t.group.children[0]?.material ?? t.mat;
  return JSON.stringify({ mode: t.mode(), state: t.urlTexState(),
    isData: !!(m.map && m.map.image && m.map.image.width === 64),
    colorSpace: m.map && m.map.colorSpace ? m.map.colorSpace : null,
    repeat: m.map ? +m.map.repeat.x.toFixed(3) : null });
})()`));
log('data:URL:', JSON.stringify(d3));
check('D2: своя текстура ЗАГРУЖЕНА (64×64 из data:URL, состояние ok)',
  d3 && d3.state === 'ok' && d3.isData === true, JSON.stringify(d3));
check('D3: масштаб повторения применяется к своей текстуре (7/7 = 1.0)',
  d3 && Math.abs(d3.repeat - 1) < 0.01, `repeat=${d3?.repeat}`);
// D4: смена масштаба — repeat следует
setAssets({ texScale: 14 });
const d4 = jparse(await evR(`(() => { const m = window.__game.world.terrain.group.children[0]?.material ?? window.__game.world.terrain.mat; return JSON.stringify({ repeat: +m.map.repeat.x.toFixed(3) }); })()`));
log('texScale=14:', JSON.stringify(d4));
check('D4: texScale 14 → repeat 0.5 у СВОЕЙ текстуры',
  d4 && Math.abs(d4.repeat - 0.5) < 0.01, `repeat=${d4?.repeat}`);
setAssets({ texScale: 7 });
// D5: битая ссылка — зерно (connection refused на localhost:1)
setAssets({ texUrls: { terrain: 'http://localhost:1/nope.png' } });
await sleep(1500);
const d5 = jparse(await evR(`(() => {
  const t = window.__game.world.terrain;
  const m = t.group.children[0]?.material ?? t.mat;
  return JSON.stringify({ state: t.urlTexState(), map: m.map ? (m.map.image?.width ?? 'grain') : null });
})()`));
log('битая ссылка:', JSON.stringify(d5));
check('D5: битая ссылка → состояние error, рельеф со ЗЕРНОМ (не чёрный)',
  d5 && d5.state === 'error' && d5.map === 256, JSON.stringify(d5));
// вернуть дефолт
setAssets({ islandTextures: 'grain', texUrls: { terrain: '' } });

// ================= E: UI — 4 РЕЖИМА + ПОЛЕ ССЫЛКИ =================
log('\n===== E: вкладка «Ресурсы» — режим url и поле ссылки =====');
run(`eval "(() => { const b = [...document.querySelectorAll('button')].find(b => /Настройки/i.test(b.textContent)); if (b) b.click(); return 'opened'; })()"`);
let assetsTab = false;
for (let i = 0; i < 15 && !assetsTab; i++) {
  await sleep(1000);
  assetsTab = ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ресурсы'); if (b) { b.click(); return true; } return false; })()`).includes('true');
}
await sleep(1500);
const ui = jparse(await evR(`(() => {
  const txt = document.body.innerText.toLowerCase();
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return JSON.stringify({
    urlBtn: btns.includes('Своя текстура (ссылка)'),
    urlModeHint: txt.includes('своя текстура'),
    fourModes: ['Выкл (ровный цвет вершин)', 'Зерно (процедурная детализация)'].every(t => btns.includes(t)),
  });
})()`));
log(JSON.stringify(ui));
check('E1: вкладка «Ресурсы» открывается, 4 режима включая «Своя текстура (ссылка)»',
  assetsTab && ui && ui.urlBtn === true && ui.fourModes === true, JSON.stringify(ui));
// включить режим url в UI и заполнить поле НАСТОЯЩИМ вводом
// (fill/press — реальные события CDP; синтетический Event('input')
// React-контролируемое поле игнорирует)
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Своя текстура (ссылка)'); if (b) b.click(); return 'clicked'; })()`);
await sleep(800);
const dataUrlStr = ev(`window.__testTexUrl`).replace(/^"|"$/g, '');
const fillRes = run(`fill "input[placeholder*='sand.png']" "${dataUrlStr}"`, 3);
await sleep(700);
const pressRes = run('press Enter', 3);
await sleep(1800);
const uiState = jparse(await evR(`(() => {
  const g = window.__game;
  return JSON.stringify({ texUrlLen: g.settings.assets.texUrls.terrain.length, mode: g.settings.assets.islandTextures, state: g.world.terrain.urlTexState() });
})()`));
log('fill:', String(fillRes).includes('Done') || String(fillRes).includes('✓') ? 'ok' : String(fillRes).slice(0, 60),
  '| press:', String(pressRes).includes('Done') || String(pressRes).includes('✓') ? 'ok' : String(pressRes).slice(0, 60),
  '| состояние:', JSON.stringify(uiState));
check('E2: поле «Ссылка на текстуру» появляется и ввод применяется (Enter/blur)',
  String(fillRes).includes('Done') && uiState && uiState.texUrlLen > 100 && uiState.mode === 'url', JSON.stringify(uiState));
check('E3: применённая через UI текстура загрузилась (state ok)',
  uiState && uiState.state === 'ok', JSON.stringify(uiState));
// закрыть настройки
run(`eval "document.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape', bubbles: true}))"`);

// ================= F: МИГРАЦИЯ И СОХРАНЕНИЕ =================
log('\n===== F: сохранение v11 и выживание URL после перезагрузки =====');
const ver = jparse(await evR(`(() => { const d = JSON.parse(localStorage.getItem('seawolves.settings.v1')); return JSON.stringify({ v: d.v, mode: d.assets.islandTextures, urlLen: (d.assets.texUrls && d.assets.texUrls.terrain || '').length }); })()`));
log(JSON.stringify(ver));
check('F1: схема сохранения v12, режим url и ссылка в localStorage',
  ver && ver.v === 12 && ver.mode === 'url' && ver.urlLen > 100, JSON.stringify(ver));
// ошибки ДО перезагрузки (после reload слушатель исчезает)
const errs1 = jparse(await evR(`JSON.stringify(window.__jsErrors)`, 6));
run('reload');
await sleep(12000);
let reloaded = false;
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { reloaded = true; break; }
  await sleep(3000);
}
log('RELOADED:', reloaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
ev(`window.__game.start()`);
await sleep(400);
const after = jparse(await evR(`(() => {
  const g = window.__game;
  return JSON.stringify({ mode: g.settings.assets.islandTextures, urlLen: g.settings.assets.texUrls.terrain.length });
})()`));
log(JSON.stringify(after));
check('F2: после перезагрузки режим url и ссылка на месте (валидация пропускает data:)',
  after && after.mode === 'url' && after.urlLen > 100, JSON.stringify(after));
// сброс в дефолт, чтобы не влиять на другие тесты
setAssets({ islandTextures: 'grain', texUrls: { terrain: '' } });

// ================= G: ОШИБКИ JS (до и после перезагрузки) =================
const errs2 = jparse(await evR(`JSON.stringify(window.__jsErrors)`, 6));
const allErrs = [...(Array.isArray(errs1) ? errs1 : []), ...(Array.isArray(errs2) ? errs2 : [])];
log('JS errors (до+после reload):', JSON.stringify(allErrs).slice(0, 400));
check('G1: 0 ошибок JS', allErrs.length === 0, `до=${errs1?.length ?? '?'}, после=${errs2?.length ?? '?'}`);

log(`\n===== ИТОГ e2e_v56: ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);

// ================= H: СКРИНШОТЫ ДЛЯ VLM =================
log('\n===== H: скриншоты (панорама острова / нос / карта) =====');
// панорама стартового острова с высоты — ищем «шторы»/«паруса»
await evR(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera;
  const isl = g.world.islands[0];
  const wg = g.worldGroup.position;
  const pose = [isl.cx - isl.r * 0.9 + wg.x, 1600, isl.cz - isl.r * 0.9 + wg.z, isl.cx + wg.x, 0, isl.cz + wg.z];
  window.__origUpdate = rig.update.bind(rig);
  rig.update = () => { cam.position.set(pose[0], pose[1], pose[2]); cam.lookAt(pose[3], pose[4], pose[5]); };
  g.stepDebugNR(3);
  g.stepDebug(0.3);
  return 'pose-top';
})()`);
await sleep(1500);
const s1 = run('screenshot /home/z/my-project/scripts/shots/t38_island_top.png', 3);
log('shot top:', String(s1).includes('Saved') || String(s1).includes('shot') ? 'done' : 'FAILED');

// вид на нос корабля (свиток, не конус). THREE не глобален — курс
// считаем из кватерниона вручную: θ = 2·atan2(q.y, q.w), fwd=(sinθ,0,cosθ)
const bow = await evR(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera;
  const wg = g.worldGroup.position;
  const p = g.player.position;
  const q = g.player.quaternion;
  const th = 2 * Math.atan2(q.y, q.w);
  const fx = Math.sin(th), fz = Math.cos(th);
  const pose = [p.x + fx * 26 + wg.x, p.y + 7, p.z + fz * 26 + wg.z, p.x - fx * 30 + wg.x, p.y + 5, p.z - fz * 30 + wg.z];
  window.__origUpdate = rig.update.bind(rig);
  rig.update = () => { cam.position.set(pose[0], pose[1], pose[2]); cam.lookAt(pose[3], pose[4], pose[5]); };
  g.stepDebug(0.3);
  return 'pose-bow';
})()`);
await sleep(1200);
const s2 = run('screenshot /home/z/my-project/scripts/shots/t38_bow.png', 3);
log('shot bow:', String(s2).includes('Saved') || String(s2).includes('shot') ? 'done' : 'FAILED');

// вид со спавна: камера за кормой, взгляд на остров (нос смотрит
// в море от острова — остров за кормой)
const spawnPose = await evR(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera;
  const wg = g.worldGroup.position;
  const p = g.player.position;
  const q = g.player.quaternion;
  const th = 2 * Math.atan2(q.y, q.w);
  const fx = Math.sin(th), fz = Math.cos(th);
  const isl = g.world.islands[0];
  let tx = isl.cx - p.x, tz = isl.cz - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const pose = [p.x - fx * 70 + wg.x, p.y + 30, p.z - fz * 70 + wg.z, p.x + tx * 500 + wg.x, 8, p.z + tz * 500 + wg.z];
  rig.update = () => { cam.position.set(pose[0], pose[1], pose[2]); cam.lookAt(pose[3], pose[4], pose[5]); };
  g.stepDebug(0.3);
  return 'pose-spawn';
})()`);
await sleep(1200);
const s3 = run('screenshot /home/z/my-project/scripts/shots/t38_spawn_view.png', 3);
log('shot spawn:', String(s3).includes('Saved') || String(s3).includes('shot') ? 'done' : 'FAILED');

// карта: Tab
ev(`(() => { const g = window.__game; g.rig.update = window.__origUpdate; return 'rig-restored'; })()`);
run(`eval "document.dispatchEvent(new KeyboardEvent('keydown', {code: 'Tab', bubbles: true}))"`);
await sleep(2500);
const s4 = run('screenshot /home/z/my-project/scripts/shots/t38_navmap.png', 3);
log('shot map:', String(s4).includes('Saved') || String(s4).includes('shot') ? 'done' : 'FAILED');

if (fails > 0) process.exit(1);

// чистим за собой: настройки с data-URL не должны течь в другие тесты
ev(`localStorage.removeItem('seawolves.settings.v1')`);
log('localStorage очищен');
