// E2E Task 37: ФИКС ЧЁРНЫХ ОСТРОВОВ + ВКЛАДКА «РЕСУРСЫ».
//  (A) ФИКС: текстура рельефа RGBA (format=1023, 256*256*4 байт) —
//      прежде RGBFormat грузился битым и острова были ЧЁРНЫМИ
//  (B) РЕЖИМЫ ТЕКСТУР: off (map=null) / grain / pbr (нормали+шероховатость)
//  (C) ШЕЙДЕРЫ рельефа: Standard / Physical / Lambert / Phong
//  (D) МАСШТАБ + PBR-ПАРАМЕТРЫ: texScale→repeat, roughness/metalness/normalStrength
//  (E) ВКЛАДКА «РЕСУРСЫ» В UI: секции текстур + каталог моделей с габаритами
//  (F) КАТАЛОГ GLB: 23 объекта, у всех размер Ш×В×Г > 0, пальма .glb
//  (G) МИГРАЦИЯ v9 → v10: boolean islandTextures → режим 'off'/'grain'
//  (H) ВИЗУАЛЬНО: скриншот острова с текстурами (не чёрный — для VLM)
//  (I) 0 ошибок JS
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// демон agent-browser «занят» после тяжёлых eval — повторяем
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
// критичные eval с ретраем (флеки демона на тяжёлой сцене)
const evR = async (js, tries = 4) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')); i++) {
    await sleep(4000);
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
const terrainMat = () => jparse(ev(`(() => {
  const t = window.__game.world.terrain;
  const m = t.group.children[0]?.material ?? null;
  if (!m) return JSON.stringify({ err: 'no tile' });
  return JSON.stringify({
    ctor: m.constructor.name,
    mode: t.mode(), shader: t.shaderKind(),
    hasMap: !!m.map, mapFormat: m.map?.format ?? null, mapData: m.map?.image?.data?.length ?? 0,
    hasNormal: !!m.normalMap, hasRoughMap: !!m.roughnessMap,
    normalScale: m.normalScale ? +m.normalScale.x.toFixed(2) : null,
    repeat: m.map ? +m.map.repeat.x.toFixed(3) : null,
    roughness: m.roughness ?? null, metalness: m.metalness ?? null,
  });
})()`));

// ================= A: ФИКС ЧЁРНЫХ ОСТРОВОВ =================
log('\n===== A: ФИКС ЧЁРНЫХ ОСТРОВОВ (RGBA вместо битого RGBFormat) =====');
ev(`window.__game.stepDebugNR(6)`);
await sleep(300);
const a = terrainMat();
log(JSON.stringify(a));
check('A1: дефолт — режим ЗЕРНО, шейдер Standard, map на месте',
  a.mode === 'grain' && a.shader === 'standard' && a.ctor === 'MeshStandardMaterial' && a.hasMap === true);
check('A2: текстура RGBA (format=1023) и ровно 256×256×4 байт данных — не чёрная',
  a.mapFormat === 1023 && a.mapData === 256 * 256 * 4, `format ${a.mapFormat}, данных ${a.mapData}`);
check('A3: масштаб по умолчанию: повтор = 7/7 = 1.0', a.repeat === 1, `repeat ${a.repeat}`);

// ================= B: РЕЖИМЫ ТЕКСТУР =================
log('\n===== B: ТРИ РЕЖИМА ТЕКСТУР (off / grain / pbr) =====');
setAssets({ islandTextures: 'off' });
const b1 = terrainMat();
log('off:', JSON.stringify(b1));
check('B1: ВЫКЛ — map отсутствует, texturesOn()=false',
  b1.hasMap === false && b1.mode === 'off');
setAssets({ islandTextures: 'pbr' });
const b2 = terrainMat();
log('pbr:', JSON.stringify(b2));
check('B2: PBR — альбедо + карта НОРМАЛЕЙ + карта ШЕРОХОВАТОСТИ',
  b2.mode === 'pbr' && b2.hasMap === true && b2.hasNormal === true && b2.hasRoughMap === true);
check('B3: сила нормалей = 1.0 по умолчанию', b2.normalScale === 1, `normalScale ${b2.normalScale}`);
setAssets({ islandTextures: 'grain' });
const b3 = terrainMat();
check('B4: обратно ЗЕРНО — нормалей нет (режим не PBR)',
  b3.mode === 'grain' && b3.hasMap === true && b3.hasNormal === false);

// ================= C: ШЕЙДЕРЫ РЕЛЬЕФА =================
log('\n===== C: ВЫБОР ШЕЙДЕРА (Standard/Physical/Lambert/Phong) =====');
setAssets({ terrainShader: 'physical' });
const c1 = terrainMat();
setAssets({ terrainShader: 'lambert' });
const c2 = terrainMat();
setAssets({ terrainShader: 'phong' });
const c3 = terrainMat();
setAssets({ terrainShader: 'standard' });
const c4 = terrainMat();
log(JSON.stringify({ physical: c1.ctor, lambert: c2.ctor, phong: c3.ctor, standard: c4.ctor }));
check('C1: Physical → MeshPhysicalMaterial', c1.ctor === 'MeshPhysicalMaterial');
check('C2: Lambert → MeshLambertMaterial (без PBR-карт, map зерно остаётся)',
  c2.ctor === 'MeshLambertMaterial' && c2.hasNormal === false);
check('C3: Phong → MeshPhongMaterial', c3.ctor === 'MeshPhongMaterial');
check('C4: Standard → MeshStandardMaterial (возврат)', c4.ctor === 'MeshStandardMaterial');

// ================= D: МАСШТАБ + PBR-ПАРАМЕТРЫ =================
log('\n===== D: МАСШТАБ ТЕКСТУРЫ И PBR-ПАРАМЕТРЫ =====');
setAssets({ texScale: 14, roughness: 0.55, metalness: 0.25, islandTextures: 'pbr', normalStrength: 1.5 });
const d1 = terrainMat();
log(JSON.stringify(d1));
check('D1: масштаб 14 м → повтор 7/14 = 0.5', Math.abs(d1.repeat - 0.5) < 0.01, `repeat ${d1.repeat}`);
check('D2: шероховатость 0.55 применена к материалу', Math.abs(d1.roughness - 0.55) < 0.01, `roughness ${d1.roughness}`);
check('D3: металличность 0.25 применена', Math.abs(d1.metalness - 0.25) < 0.01, `metalness ${d1.metalness}`);
check('D4: сила нормалей 1.5 применена', Math.abs(d1.normalScale - 1.5) < 0.01, `normalScale ${d1.normalScale}`);
// вернуть дефолты
setAssets({ texScale: 7, roughness: 0.96, metalness: 0, normalStrength: 1, islandTextures: 'grain' });

// ================= E: ВКЛАДКА «РЕСУРСЫ» В UI =================
log('\n===== E: ВКЛАДКА «РЕСУРСЫ» В ПАНЕЛИ НАСТРОЕК =====');
run(`eval "(() => { const b = [...document.querySelectorAll('button')].find(b => /Настройки/i.test(b.textContent)); if (b) b.click(); return 'opened'; })()"`);
let assetsTab = false;
for (let i = 0; i < 15 && !assetsTab; i++) {
  await sleep(1000);
  assetsTab = ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ресурсы'); if (b) { b.click(); return true; } return false; })()`).includes('true');
}
await sleep(1500);
const ui = jparse(await evR(`(() => {
  const txt = document.body.innerText.toLowerCase();
  const details = document.querySelectorAll('details').length;
  return JSON.stringify({
    hasTab: !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ресурсы'),
    texSection: txt.includes('текстуры рельефа островов'),
    shaderRow: txt.includes('шейдер рельефа'),
    modePbr: txt.includes('pbr (текстуры + нормали + шероховатость)'),
    scaleRow: txt.includes('масштаб текстуры'),
    glbSection: txt.includes('3d-модели: подмена процедурных объектов на glb'),
    glbToggle: txt.includes('использовать glb-модели'),
    palmSize: txt.includes('3.4×8.9×3.4'),
    cannonSize: txt.includes('1.2×0.45×0.6'),
    pirateSize: txt.includes('0.5×1.72×0.35'),
    barrelSize: txt.includes('0.68×0.8×0.68'),
    details,
  });
})()`));
log(JSON.stringify(ui));
check('E1: вкладка «Ресурсы» есть и открывается', ui.hasTab === true && assetsTab === true);
check('E2: секция текстур рельефа (режимы/шейдер/масштаб)',
  ui.texSection === true && ui.shaderRow === true && ui.modePbr === true && ui.scaleRow === true);
check('E3: секция 3D-моделей с габаритами: пальма 3.4×8.9×3.4, пушка 1.2×0.45×0.6, пират 0.5×1.72×0.35, бочка 0.68×0.8×0.68',
  ui.glbSection === true && ui.palmSize === true && ui.cannonSize === true && ui.pirateSize === true && ui.barrelSize === true);
check('E4: каталог моделей ≥ 23 записей (details)', ui.details >= 23, `details ${ui.details}`);
// закрыть настройки
run(`eval "(() => { const btns = [...document.querySelectorAll('button')]; const x = btns.find(b => /✕|Закрыть/i.test(b.textContent)); if (x) x.click(); return 'closed'; })()"`);
await sleep(500);

// ================= F: КАТАЛОГ GLB =================
log('\n===== F: КАТАЛОГ ПРОЦЕДУРНЫХ ОБЪЕКТОВ (реестр) =====');
const reg = jparse(ev(`(() => {
  const g = window.__game;
  const info = g.glbParts.info();
  const ids = Object.keys(info);
  return JSON.stringify({
    n: ids.length,
    palmStatus: info.palm?.status ?? null,
    files: ids.filter(k => info[k].file).length,
    applied: ids.reduce((s, k) => s + (info[k].applied || 0), 0),
  });
})()`));
log(JSON.stringify(reg));
check('F1: реестр ≥ 23 объектов', reg.n >= 23, `объектов ${reg.n}`);
check('F2: пальма — .glb загружена (демо-конвейер подмены)', reg.palmStatus === 'glb', `status ${reg.palmStatus}`);
check('F3: подмена применена к инстансам (palm applied > 0)', reg.applied > 0, `applied ${reg.applied}`);

// ================= G: МИГРАЦИЯ v9 → v10 =================
log('\n===== G: МИГРАЦИЯ СОХРАНЕНИЯ v9 (boolean) → v10 (режим) =====');
await evR(`(() => {
  const g = window.__game;
  const data = structuredClone(g.settings);
  data.graphics.islandTextures = false;
  data.v = 9;
  delete data.assets;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(data));
  return 'v9 saved';
})()`);
run('reload');
let reloaded = false;
await sleep(12000);
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { reloaded = true; break; }
  await sleep(3000);
}
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
ev(`window.__game.start()`);
const mig = jparse(ev(`(() => {
  const g = window.__game;
  let v = null;
  try { v = JSON.parse(localStorage.getItem('seawolves.settings.v1')).v; } catch { }
  return JSON.stringify({
    v, mode: g.settings.assets.islandTextures,
    applied: g.world.terrain.texturesOn(), texScale: g.settings.assets.texScale,
  });
})()`));
log('after reload:', reloaded, JSON.stringify(mig));
check('G1: v9 с islandTextures=false читается как режим off, схема перезаписана в v10',
  reloaded && mig.v === 10 && mig.mode === 'off' && mig.applied === false);
// вернуть дефолт grain для скриншота
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.assets.islandTextures = 'grain'; g.applySettings(s); return 'grain'; })()`);

// ================= I: ОШИБКИ JS =================
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`, 6));
log('JS errors:', JSON.stringify(errs).slice(0, 400));
check('I1: 0 ошибок JS', Array.isArray(errs) && errs.length === 0);

log(`\n===== ИТОГ e2e_v55: ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);

// ================= H: СКРИНШОТЫ ДЛЯ VLM (после ИТОГА — демон может захлебнуться) =================
log('\n===== H: СКРИНШОТЫ ОСТРОВА (текстуры вкл — для VLM) =====');
await evR(`(() => {
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
const shot1 = run('screenshot /home/z/my-project/scripts/shots/t37_island_grain.png', 3);
log('shot grain:', String(shot1).includes('Saved') || String(shot1).includes('shot') ? 'done' : 'FAILED (не критично)');
// PBR-кадр — best effort: состояние материала уже проверено в B2/D
await sleep(25000);
const probe = runRaw(`eval "1+1"`);
if (!String(probe).includes('Failed to read') && !String(probe).includes('ERR')) {
  await evR(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.assets.islandTextures = 'pbr'; g.applySettings(s); return 'pbr'; })()`);
  await sleep(800);
  await evR(`window.__game.stepDebug(0.2)`);
  await sleep(500);
  const shot2 = run('screenshot /home/z/my-project/scripts/shots/t37_island_pbr.png', 3);
  log('shot pbr:', String(shot2).includes('Saved') || String(shot2).includes('shot') ? 'done' : 'FAILED (не критично)');
  await evR(`(() => { const g = window.__game; g.rig.update = window.__origUpdate; const s = structuredClone(g.settings); s.assets.islandTextures = 'grain'; g.applySettings(s); return 'ok'; })()`);
} else {
  log('PBR-кадр пропущен (демон занят) — состояние PBR проверено в B2/D');
}

if (fails > 0) process.exit(1);
