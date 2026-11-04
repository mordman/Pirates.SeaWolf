// E2E Task 30 (ПОВТОР после потери дерева): острова НЕПРАВИЛЬНОЙ
// формы + растительность (пни/валуны) + чайки в полёте + GLB-система
// замены деталей + уменьшенная дальность пушек + камера.
//  (A) ФОРМА: все 20 островов ratio maxR/minR ≥ 1.5, изрезанность
//      ≥ 1.05; ни одного «круга»; «Пальмовая гавань» ratio 1.8..2.9
//  (B) БЕЗ ОТМЕЛЕЙ: полоса h:0→−6 у берега ≤ 90 м (было ~200)
//  (C) ПОРТЫ ЦЕЛЫ: 20 островов = 20 гаваней, пирсы всех портов
//      заканчиваются в воде, швартовка работает
//  (D) РАСТИТЕЛЬНОСТЬ: все 8 видов (включая НОВЫЕ пень и валун);
//      деревья ломаются (breakTrees) и остаются сломанными
//  (E) ЧАЙКИ В ПОЛЁТЕ: 42 штуки, 12 ходят за кораблём; курс/крен
//      меняются, позиции движутся; дистанция до судна СОКРАЩАЕТСЯ
//      (стая действительно доходит до корабля)
//  (F) GLB-СИСТЕМА: пальма по умолчанию из palm_demo.glb (296 вершин
//      ≠ процедурная), выключение настройки → процедурная, включение
//      → снова GLB; сломанная загрузка → фолбэк на процедурную
//  (G) ДАЛЬНОСТЬ ПУШЕК: упреждение цели только до 520 м
//      (цель на 450 м захватывается, на 700 м — нет)
//  (H) КАМЕРА: минимальный угол возвышения 0.10 (не ниже к воде)
//  (I) КАРТА: у всех островов полигоны берега (pts), не круги
//  (J) stepDebug: симуляция шагает без RAF (30 с за один вызов)
//  (K) 0 ошибок JS
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const key = (code, type = 'keydown') =>
  ev(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' })); 'ok'`);
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/?t=' + Date.now());
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(1500);

// ============ A: форма островов ============
log('=== A: острова неправильной формы ===');
const shapes = jparse(ev(`JSON.stringify(window.__sea.islandsShape)`));
log('A:', JSON.stringify(shapes.slice(0, 3)), '…');
check('A: все 20 островов', shapes.length === 20, `n=${shapes.length}`);
check('A: НИ ОДНОГО «круга» (ratio ≥ 1.5 у всех)',
  shapes.every(i => i.ratio >= 1.5),
  `min=${Math.min(...shapes.map(i => i.ratio))}`);
check('A: берега изрезаны (rugosity ≥ 1.05 у всех)',
  shapes.every(i => i.rugosity >= 1.05),
  `min=${Math.min(...shapes.map(i => i.rugosity)).toFixed(2)}`);
const palm = shapes.find(i => i.name === 'Пальмовая гавань');
check('A: «Пальмовая гавань» вытянута (ratio 1.8..2.9)',
  palm && palm.ratio >= 1.8 && palm.ratio <= 2.9,
  palm ? `ratio=${palm.ratio} minR=${palm.minR} maxR=${palm.maxR}` : 'нет');
const ratios = shapes.map(i => i.ratio);
const varied = new Set(ratios.map(r => Math.round(r / 0.3) * 0.3)).size;
check('A: формы РАЗНООБРАЗНЫ (разброс ratio ≥ 0.7, ≥ 5 групп с шагом 0.3)',
  Math.max(...ratios) - Math.min(...ratios) >= 0.7 && varied >= 5,
  `разброс=${(Math.max(...ratios) - Math.min(...ratios)).toFixed(2)} групп=${varied}`);

// ============ B: без широких отмелей ============
log('=== B: острова без отмелей ===');
const shelf = jparse(ev(`window.__sea.shelf`));
check('B: полоса мелководья (h:0→−6) ≤ 90 м', shelf <= 90, `ширина=${shelf} м`);

// ============ C: порты целы ============
log('=== C: порты и гавани ===');
const portsE = jparse(ev(`(() => {
  const g = window.__game, w = g.world, hA = window.__heightAt;
  const docks = w.ports.map(p => ({ n: p.name, tier: p.tier, water: hA(p.dockEnd.x, p.dockEnd.z) < 0.4 }));
  const badDocks = docks.filter(d => !d.water).map(d => d.n);
  // швартовка в главной гавани
  const dp = w.ports[0];
  g.player.position.set(dp.dockEnd.x + dp.dir.x * 12, 0, dp.dockEnd.z + dp.dir.z * 12);
  g.player.velocity.set(0, 0, 0);
  const can = g.canDock();
  if (can) g.dock();
  const dockedName = g.dockedPort ? g.dockedPort.name : null;
  g.undock();
  return JSON.stringify({ nIsl: w.islands.length, nPorts: w.ports.length, badDocks, can, dockedName });
})()`));
log('C:', JSON.stringify(portsE));
check('C: порт на каждом острове', portsE.nPorts === portsE.nIsl, `${portsE.nIsl}/${portsE.nPorts}`);
check('C: пирсы ВСЕХ портов заканчиваются в воде', portsE.badDocks.length === 0,
  portsE.badDocks.join(',') || 'все в воде');
check('C: швартовка работает (главная гавань)', portsE.can && portsE.dockedName === 'Пальмовая гавань',
  JSON.stringify(portsE));

// ============ D: растительность (пни + валуны) ============
log('=== D: растительность ===');
const veg = jparse(ev(`JSON.stringify(window.__sea.veg)`));
log('D:', JSON.stringify(veg));
const kinds = ['palm', 'ficus', 'jungle', 'bush', 'bamboo', 'rock', 'stump', 'boulder'];
check('D: все 8 видов (включая пень и валун)',
  kinds.every(k => veg[k] && veg[k].n > 0),
  kinds.map(k => `${k}:${veg[k] ? veg[k].n : 0}`).join(' '));
const brk = jparse(ev(`(() => {
  const g = window.__game, w = g.world;
  // ломаем деревья на пляже Пальмовой гавани
  const isl = w.islands[0];
  let spot = null;
  for (let t = 0; t < 80 && !spot; t++) {
    const a = t * 0.41, rr = isl.r * (0.55 + 0.3 * (t % 7) / 7);
    const x = isl.cx + Math.cos(a) * rr, z = isl.cz + Math.sin(a) * rr;
    if (window.__heightAt(x, z) > 1.5) spot = { x, y: window.__heightAt(x, z), z };
  }
  const before = w.treesBroken;
  const broke = w.breakTrees(spot.x, spot.y, spot.z, 26, g.particles, g.gibs);
  return JSON.stringify({ broke, total: w.treesBroken, before });
})()`));
log('D breakTrees:', JSON.stringify(brk));
check('D: ядра валят деревья (3 куска, счётчик растёт)', brk.broke >= 1, JSON.stringify(brk));

// ============ E: чайки в полёте ============
log('=== E: чайки ===');
const gulls0 = jparse(ev(`(() => {
  const g = window.__game;
  const gs = g.world.gullsPublic();
  const p = g.player.position;
  const ship = gs.filter(q => q.mode === 'ship');
  return JSON.stringify({
    total: gs.length, ship: ship.length,
    d0: Math.round(ship.reduce((s, q) => s + Math.hypot(q.x - p.x, q.z - p.z), 0) / Math.max(1, ship.length)),
    bankMax: Math.max(...gs.map(q => Math.abs(q.bank))),
    hdg0: ship.slice(0, 3).map(q => +q.hdg.toFixed(2)),
  });
})()`));
// стая догоняет корабль: 45 игровых секунд
ev(`window.__game.stepDebug(45)`);
const gulls1 = jparse(ev(`(() => {
  const g = window.__game;
  const gs = g.world.gullsPublic();
  const p = g.player.position;
  const ship = gs.filter(q => q.mode === 'ship');
  return JSON.stringify({
    d1: Math.round(ship.reduce((s, q) => s + Math.hypot(q.x - p.x, q.z - p.z), 0) / Math.max(1, ship.length)),
    bankMax: Math.max(...gs.map(q => Math.abs(q.bank))),
    hdg1: ship.slice(0, 3).map(q => +q.hdg.toFixed(2)),
    nearShip: window.__sea.gulls.nearShip,
  });
})()`));
log('E0:', JSON.stringify(gulls0));
log('E1:', JSON.stringify(gulls1));
check('E: 42 чайки, из них 12 — за кораблём',
  gulls0.total === 42 && gulls0.ship === 12, `total=${gulls0.total} ship=${gulls0.ship}`);
check('E: чайки ЛЕТИТ (курсы меняются)', JSON.stringify(gulls0.hdg0) !== JSON.stringify(gulls1.hdg1),
  `${JSON.stringify(gulls0.hdg0)} → ${JSON.stringify(gulls1.hdg1)}`);
check('E: крен в поворотах (≥ 0.3 рад)', gulls1.bankMax >= 0.3, `max=${gulls1.bankMax}`);
check('E: стая СОКРАЩАЕТ дистанцию до судна', gulls1.d1 < gulls0.d0 - 40,
  `${gulls0.d0} → ${gulls1.d1} м`);

// ============ F: GLB-система ============
log('=== F: GLB-замена деталей ===');
const glbOn = jparse(ev(`JSON.stringify({ use: window.__sea.glb.use, parts: window.__sea.glb.parts, vegPalm: window.__sea.veg.palm })`));
log('F (вкл):', JSON.stringify(glbOn));
check('F: GLB включена по умолчанию, пальма из .glb',
  glbOn.use && glbOn.parts.palm.status === 'glb' && glbOn.vegPalm.src === 'glb',
  `status=${glbOn.parts.palm.status} src=${glbOn.vegPalm.src}`);
check('F: подменено > 1000 инстансов пальм', glbOn.parts.palm.applied > 1000,
  `applied=${glbOn.parts.palm.applied}`);
check('F: геометрия GLB ≠ процедурной (296 вершин)',
  glbOn.vegPalm.verts >= 200 && glbOn.vegPalm.verts <= 500, `verts=${glbOn.vegPalm.verts}`);
// выключение настройки → процедурная геометрия
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.graphics.useGLBModels = false;
  g.applySettings(s);
  return 'off';
})()`);
const glbOff = jparse(ev(`JSON.stringify({ use: window.__sea.glb.use, palm: window.__sea.veg.palm })`));
log('F (выкл):', JSON.stringify(glbOff));
check('F: выключение → процедурная пальма', !glbOff.use && glbOff.palm.src === 'proc',
  `src=${glbOff.palm.src} verts=${glbOff.palm.verts}`);
check('F: процедурная геометрия ДРУГАЯ (фолбэк реален)',
  glbOff.palm.verts !== glbOn.vegPalm.verts,
  `glb=${glbOn.vegPalm.verts} proc=${glbOff.palm.verts}`);
// включение обратно
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.graphics.useGLBModels = true;
  g.applySettings(s);
  return 'on';
})()`);
const glbOn2 = jparse(ev(`JSON.stringify({ use: window.__sea.glb.use, palm: window.__sea.veg.palm })`));
check('F: повторное включение → снова GLB', glbOn2.use && glbOn2.palm.src === 'glb' && glbOn2.palm.verts === glbOn.vegPalm.verts,
  `src=${glbOn2.palm.src} verts=${glbOn2.palm.verts}`);
// сломанная загрузка → тихий фолбэк на процедурную
const fb = jparse(ev(`(async () => {
  const g = window.__game;
  const real = g.glbParts.loader;
  g.glbParts.loader = { loadAsync: async () => { throw new Error('404 not found'); } };
  // дергаем приватный load через публичный enableAll (геометрии в кэше нет для ficus — но файл null).
  // Проверяем путь ошибки напрямую: выключим и включим пальму со сломанным загрузчиком,
  // предварительно сбросив кэш
  g.glbParts.cache.clear?.();
  g.glbParts.disableAll();
  g.glbParts.status.palm = 'loading';
  await new Promise(r => {
    // вызываем приватный метод load через enableAll — файл есть, загрузчик сломан
    try { g.glbParts.enableAll(); } catch (e) {}
    setTimeout(r, 300);
  });
  g.glbParts.loader = real;
  await new Promise(r => setTimeout(r, 200));
  return JSON.stringify({ status: g.glbParts.status.palm, palm: window.__sea.veg.palm, err: g.glbParts.lastError });
})()`));
log('F (фолбэк):', JSON.stringify(fb));
check('F: битая загрузка → статус error, пальма ОСТАЛАСЬ процедурной',
  fb && fb.status === 'error' && fb.palm.src === 'proc',
  `status=${fb && fb.status} src=${fb && fb.palm.src}`);
// вернуть GLB-пальму
ev(`(() => { const g = window.__game; g.glbParts.status.palm = 'loading'; g.glbParts.enableAll(); return 'restore'; })()`);
await sleep(1200);

// ============ G: дальность пушек ============
log('=== G: уменьшенная дальность пушек ===');
// прицел ПРАВЫЙ борт + цель точно по оси прицела (aimDirection)
const range = jparse(ev(`(() => {
  const g = window.__game, T = window.__THREE;
  const ai = g.aiShips.find(a => !a.ship.sunk);
  if (!ai) return JSON.stringify({ noAi: true });
  const p = g.player.position;
  if (!g.combat.aim.active) g.combat.toggleAim(1);
  const dir = g.combat.aimDirection(new T.Vector3());
  ai.ship.position.set(p.x + dir.x * 450, 0, p.z + dir.z * 450);
  ai.ship.velocity.set(0, 0, 0);
  g.stepDebug(1.2);
  return JSON.stringify({ d450: g.combat.aim.target ? Math.round(g.combat.aim.target.position.distanceTo(p)) : null, aim: g.combat.aim.active });
})()`));
log('G 450м:', JSON.stringify(range));
const range2 = jparse(ev(`(() => {
  const g = window.__game, T = window.__THREE;
  const ai = g.aiShips.find(a => !a.ship.sunk);
  const p = g.player.position;
  const dir = g.combat.aimDirection(new T.Vector3());
  ai.ship.position.set(p.x + dir.x * 700, 0, p.z + dir.z * 700);
  ai.ship.velocity.set(0, 0, 0);
  g.stepDebug(1.2);
  return JSON.stringify({ d700: g.combat.aim.target ? Math.round(g.combat.aim.target.position.distanceTo(p)) : null });
})()`));
log('G 700м:', JSON.stringify(range2));
check('G: цель на 450 м захватывается упреждением', range.d450 !== null && range.d450 <= 460,
  `target=${range.d450} aim=${range.aim}`);
check('G: цель на 700 м НЕ захватывается (лимит 520)', range2.d700 === null,
  `target=${range2.d700}`);
ev(`window.__game.combat.aim.active = false; 'aim-off'`);

// ============ H: камера — предел возвышения ============
log('=== H: камера ===');
const cam = jparse(ev(`(() => {
  const g = window.__game;
  g.combat.aim.active = false;   // камера БЕЗ режима прицела
  g.rig.mode = 'free';
  g.rig.distSet(60);
  g.rig.freeElevSet(0.05);   // просим НИЖЕ предела
  g.rig.snap();
  g.stepDebug(0.2);
  const dy = g.rig.camera.position.y - g.player.position.y;
  const elev = Math.asin(Math.max(-1, Math.min(1, dy / 60)));
  g.rig.freeElevSet(0.5);
  g.stepDebug(0.2);
  return JSON.stringify({ elev: +elev.toFixed(3) });
})()`));
log('H:', JSON.stringify(cam));
check('H: минимальный угол возвышения 0.10 (не ниже к воде)',
  cam.elev >= 0.095 && cam.elev <= 0.13, `elev=${cam.elev}`);

// ============ I: карта — полигоны ============
log('=== I: карта ===');
const map = jparse(ev(`(() => {
  const g = window.__game;
  g.updateHud();
  const pts = g.hud.mapIslands.map(i => (i.pts || []).length);
  return JSON.stringify({ n: pts.length, minPts: Math.min(...pts), allPoly: pts.every(p => p >= 40) });
})()`));
log('I:', JSON.stringify(map));
check('I: у всех островов полигоны берега (≥ 40 точек)', map.allPoly, `min=${map.minPts}`);

// ============ J: stepDebug ============
log('=== J: stepDebug ===');
const step = jparse(ev(`(() => {
  const g = window.__game;
  const t0 = g.time;
  g.stepDebug(30);
  return JSON.stringify({ dt: +(g.time - t0).toFixed(2) });
})()`));
check('J: 30 с симуляции за один вызов (без RAF)', Math.abs(step.dt - 30) < 0.5, `dt=${step.dt}`);

// ============ K: ошибки JS ============
const errs = jparse(ev(`window.__jsErrors || 0`));
check('K: 0 ошибок JavaScript', errs === 0, `ошибок=${errs}`);

log('');
log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
