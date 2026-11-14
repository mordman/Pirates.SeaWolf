// E2E Task 49: МЯГКИЙ НАХЛЁСТ ПОЯСОВ + ОБЛОМКИ ПОД ЦВЕТ КОРПУСА +
// СВОРАЧИВАЕМЫЙ HUD
//  (A) пояса: STRAKE_PITCH 0.42 (нахлёст 6 см вместо 8), LAP_TILT 0.09
//      (вместо 0.20), тон ±7% (вместо ±14%) — константы geomInfo() +
//      независимая проверка по реальным записям records (шаг поясов,
//      разброс тона)
//  (B) обломки: per-piece материалы, tint под цвет КОРПУСА корабля-
//      родителя (мишень santisima — красный корпус 0x7a2a22), у игрока
//      (шлюп) — свой оттенок; бочки — натуральное дерево (не тонируются)
//  (C) HUD fold: 5 панелей (статус/ветер/управление/трюм/полигон),
//      клик ▾ сворачивает (data-folded=1, контент исчезает), состояние
//      в localStorage ПЕРЕЖИВАЕТ перезагрузку, клик ▸ разворачивает
//  (D) 0 ошибок JS + скриншоты
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
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// свежий контекст (HTTP-кэш dev-чанков отдаёт старые сборки!)
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
// чистый localStorage: свёрнутость HUD не должна протекать между прогонами
ev(`localStorage.removeItem('piratesHUDFold_v1'); 1`);
let loaded = false;
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) { loaded = true; break; }
  await sleep(2500);
}
check('0: игра загрузилась', loaded);
if (!loaded) { log('ИГРА НЕ ЗАГРУЗИЛАСЬ — СТОП'); process.exit(1); }
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// ============ A: МЯГКИЙ НАХЛЁСТ ПОЯСОВ ============
log('\n===== A: нахлёст/наклон поясов и тон досок =====');
const geom = jparse(await evR(`(() => {
  const p = window.__game.player;
  const gi = p.plankHull.geomInfo();
  // независимая проверка по реальным записям: уникальные высоты
  // поясов борта (+X) — шаг между уровнями = STRAKE_PITCH
  const ys = [...new Set(p.plankHull.records
    .filter(r => r.cls === 0 && r.side === 1)
    .map(r => +r.y.toFixed(3)))].sort((a, b) => a - b);
  const diffs = ys.slice(1).map((y, i) => +(y - ys[i]).toFixed(3));
  const med = diffs.length
    ? diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)] : 0;
  // тон досок: разброс по ВСЕМ записям (борт/палуба/транец)
  const tones = p.plankHull.records.map(r => r.tone);
  const tmin = Math.min(...tones), tmax = Math.max(...tones);
  return JSON.stringify({
    gi, strakeLevels: ys.length, medPitch: med,
    tmin: +tmin.toFixed(3), tmax: +tmax.toFixed(3), spread: +(tmax - tmin).toFixed(3),
  });
})()`));
log(JSON.stringify(geom));
check('A1: шаг поясов 0.42, нахлёст ослаблен до 6 см (было 8)',
  geom.gi.strakePitch === 0.42 && geom.gi.overlap === 0.06,
  `pitch=${geom?.gi?.strakePitch}, overlap=${geom?.gi?.overlap} м`);
check('A2: наклон нахлёста 0.09 (было 0.20 — «чешуя» мягче)',
  geom.gi.lapTilt === 0.09, `lapTilt=${geom?.gi?.lapTilt}`);
check('A3: реальный шаг уровней поясов в records = 0.42',
  geom.strakeLevels >= 3 && Math.abs(geom.medPitch - 0.42) < 0.02,
  `уровней ${geom?.strakeLevels}, шаг ${geom?.medPitch}`);
check('A4: тон досок в ±7% (0.93–1.07), разброс ≤ 0.16 (было 0.28)',
  geom.tmin >= 0.92 && geom.tmax <= 1.08 && geom.spread <= 0.16,
  `тон ${geom?.tmin}–${geom?.tmax} (разброс ${geom?.spread})`);

// ============ B: ОБЛОМКИ ПОД ЦВЕТ КОРПУСА ============
log('\n===== B: обломки тонированы под цвет корпуса =====');
const deb = jparse(await evR(`(() => {
  const g = window.__game;
  g.startProving('santisima');   // мишень с КРАСНЫМ корпусом 0x7a2a22
  g.stepDebugNR(0.3);
  const t = g.pgTarget.ship;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const tintT = t.hullTint;
  for (let i = 0; i < 8; i++) {
    t.hitHull(new T(2.2, 0.0, 1.2), 15, true, new T(1, 0.1, 0.2));
    g.stepDebugNR(0.15);
  }
  const afterT = window.__seaDebrisInfo();
  // старим обломки мишени (35 с симуляции): щепа истекает по TTL —
  // иначе пул 112 шт забит и удары по игроку ничего не заспавнят
  g.stepDebugNR(35);
  // 3 попадания по игроку (шлюп, коричневый корпус) — свой оттенок
  const tintP = p.hullTint;
  for (let i = 0; i < 3; i++) {
    p.hitHull(new T(-2.2, 0.4, -1.0), 15, false, new T(-1, 0.1, 0.2));
    g.stepDebugNR(0.15);
  }
  const afterP = window.__seaDebrisInfo();
  // ожидаемые цвета: ровно та же математика, что в debris.applyTint
  const C = window.__THREE.Color;
  const expFor = (tint) => ({
    plank: '#' + new C(0x7a5c38).lerp(new C(tint), 0.72).getHexString(),
    spar: '#' + new C(0x7a5c38).lerp(new C(tint), 0.72).getHexString(),
    shard: '#' + new C(0x4a3420).lerp(new C(tint), 0.72).getHexString(),
    hullplate: '#' + new C(0x6a4c2c).lerp(new C(tint), 0.72).getHexString(),
  });
  const expT = expFor(tintT), expP = expFor(tintP);
  const setT = new Set(Object.values(expT)), setP = new Set(Object.values(expP));
  const keysT = Object.keys(afterT.tints), keysP = Object.keys(afterP.tints);
  return JSON.stringify({
    tintT, tintP,
    target: { tinted: afterT.tinted, keys: keysT, allExp: keysT.length > 0 && keysT.every(k => setT.has(k)) },
    player: { tinted: afterP.tinted, keys: keysP, own: keysP.some(k => setP.has(k)), allExp: keysP.every(k => setT.has(k) || setP.has(k)) },
    byKind: afterP.byKind,
  });
})()`));
log(JSON.stringify(deb));
check('B1: у мишени santisima красный корпус (hullTint 0x7a2a22)',
  deb.tintT === 0x7a2a22, `hullTint=0x${(deb?.tintT ?? 0).toString(16)}`);
check('B2: после попаданий есть ТОНЕРОВАННЫЕ обломки мишени',
  deb.target.tinted > 0, `tinted=${deb?.target?.tinted}`);
check('B3: все оттенки обломков мишени = лерп к цвету её корпуса',
  deb.target.allExp === true, `оттенки: ${JSON.stringify(deb?.target?.keys)}`);
check('B4: обломки игрока — под цвет ЕГО корпуса (шлюп, другой тон)',
  deb.player.tinted > 0 && deb.player.own === true,
  `tinted=${deb?.player?.tinted}, свои оттенки: ${deb?.player?.own}`);
check('B5: НЕТ посторонних оттенков (только 2 корпуса)',
  deb.player.allExp === true, `все ключи: ${JSON.stringify(deb?.player?.keys)}`);

// скриншот: мишень + обломки в цвет корпуса
await evR(`(() => {
  const g = window.__game; const p = g.player; const t = g.pgTarget.ship;
  p.position.copy(t.position).add(new window.__THREE.Vector3(-26, 0, 16));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.4);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.28);
  g.rig.freeAzimSet(Math.atan2(p.position.z - t.position.z, p.position.x - t.position.x));
  g.rig.distSet(40); g.rig.snap(); return 1;
})()`);
await sleep(2200);
run(`screenshot scripts/shots/t49_debris_tint.png`);

// ============ C: СВОРАЧИВАЕМЫЙ HUD ============
log('\n===== C: сворачиваемые панели HUD =====');
const IDS = ['status', 'wind', 'bottom', 'hold', 'polygon'];
const panelState = async () => jparse(await evR(`(() => JSON.stringify(${JSON.stringify(IDS)}.map(id => {
  const el = document.querySelector('[data-hud="' + id + '"]');
  if (!el) return { id, found: false, folded: null };
  const markers = {
    status: el.textContent.includes('FPS'),
    wind: !!el.querySelector('svg'),
    bottom: el.textContent.includes('Боеприпасы'),
    hold: el.textContent.includes('🪙') || el.textContent.includes('Трюм:'),
    polygon: !!el.querySelector('select'),
  };
  return { id, found: true, folded: el.dataset.folded, open: !!markers[id] };
})))()`));

let st0 = await panelState();
log(JSON.stringify(st0));
check('C1: все 5 панелей на месте и развёрнуты (полигон — в режиме полигона)',
  st0.length === 5 && st0.every(s => s.found && s.folded === '0' && s.open),
  `folded: ${st0.map(s => s.id + '=' + s.folded).join(' ')}, открытых: ${st0.filter(s => s.open).length}`);

for (const id of IDS) {
  ev(`document.querySelector('[data-hud-fold="${id}"]').click(); 1`);
  await sleep(250);
}
let st1 = await panelState();
log(JSON.stringify(st1));
check('C2: клик ▾ — все 5 панелей свёрнуты (data-folded=1)',
  st1.every(s => s.found && s.folded === '1'),
  `folded: ${st1.map(s => s.id + '=' + s.folded).join(' ')}`);
check('C3: содержимое скрыто, остались только заголовки-полоски',
  st1.every(s => !s.open), `открытых: ${st1.filter(s => s.open).length}`);

const lsRaw = jparse(await evR(`localStorage.getItem('piratesHUDFold_v1')`));
const ls = typeof lsRaw === 'string' ? jparse(lsRaw) : lsRaw;
check('C4: состояние сохранено в localStorage',
  !!ls && IDS.every(id => ls[id] === true), `ls=${typeof lsRaw === 'string' ? lsRaw : JSON.stringify(ls)}`);

// перезагрузка: свёрнутость должна пережить рестарт страницы
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1800);
const IDS4 = ['status', 'wind', 'bottom', 'hold'];
let st2 = jparse(await evR(`(() => JSON.stringify(${JSON.stringify(IDS4)}.map(id => {
  const el = document.querySelector('[data-hud="' + id + '"]');
  return { id, found: !!el, folded: el ? el.dataset.folded : null, open: el ? el.textContent.includes('FPS') || !!el.querySelector('svg') || el.textContent.includes('Боеприпасы') || el.textContent.includes('Трюм:') : false };
}).concat([{ id: 'polygon', found: !!document.querySelector('[data-hud="polygon"]') }])))()`));
log(JSON.stringify(st2));
check('C5: свёрнутость ПЕРЕЖИВАЕТ перезагрузку (4 панели сложены)',
  st2.filter(s => IDS4.includes(s.id)).every(s => s.found && s.folded === '1' && !s.open),
  `folded: ${st2.map(s => s.id + '=' + s.folded).join(' ')}`);
check('C6: панели полигона вне режима полигона нет (не рендерится)',
  st2.find(s => s.id === 'polygon')?.found === false, '');

for (const id of IDS4) {
  ev(`document.querySelector('[data-hud-fold="${id}"]').click(); 1`);
  await sleep(250);
}
let st3 = jparse(await evR(`(() => JSON.stringify(${JSON.stringify(IDS4)}.map(id => {
  const el = document.querySelector('[data-hud="' + id + '"]');
  const markers = {
    status: el.textContent.includes('FPS'),
    wind: !!el.querySelector('svg'),
    bottom: el.textContent.includes('Боеприпасы'),
    hold: el.textContent.includes('🪙') || el.textContent.includes('Трюм:'),
  };
  return { id, folded: el.dataset.folded, open: !!markers[id] };
})))()`));
log(JSON.stringify(st3));
check('C7: клик ▸ разворачивает панели, контент возвращается',
  st3.every(s => s.folded === '0' && s.open),
  `folded: ${st3.map(s => s.id + '=' + s.folded).join(' ')}, открытых: ${st3.filter(s => s.open).length}`);
ev(`localStorage.removeItem('piratesHUDFold_v1'); 1`);

// ============ D: ОШИБКИ + СКРИНШОТ ============
log('\n===== D: регрессии =====');
const errs = run('errors');
check('D1: 0 ошибок JS за весь прогон', !errs || errs.length < 5,
  String(errs).slice(0, 200));

run(`screenshot scripts/shots/t49_hud_unfolded.png`);

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
