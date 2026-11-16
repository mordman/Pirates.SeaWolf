// E2E Task 76: (A) КАПИТАН НА БОРТУ — ИГРОК (внешность с экрана
// создания персонажа; смена внешности пересобирает капитана);
// (B) «Чёрная жемчужина» → модель ИГРОКА-МЕРТВЕЦА (классика +
// детальный проклятый капитан с зелёным клинком); (C) детальный
// экипаж на палубе (лицевые метки + дыхание — совместимость v70);
// (D) превью /crew: 5 профессий, бандольер «12 апостолов», сабля,
// перо, вершинный ветер, фазы выстрела с дымом, режимы боя/дозора.
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
let checks = 0;
const check = (name, cond, extra = '') => {
  checks++;
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
ev(`localStorage.removeItem('seawolves.settings.v1'); localStorage.removeItem('piratesHUDFold_v1'); 1`);
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

// ============ A: КАПИТАН НА БОРТУ — ИГРОК ============
log('\n===== A: капитан = игрок (внешность с экрана создания) =====');
const capA = jparse(await evR(`(() => {
  const m = window.__crewModelInfo();
  return JSON.stringify({ cap: m.captain, appear: m.playerAppearance });
})()`));
log(JSON.stringify(capA));
check('A1: капитан на борту — ИГРОК (isPlayer)',
  capA?.cap?.isPlayer === true, JSON.stringify(capA?.cap));
check('A2: внешность капитана = выбранный образ (кожа/рубаха)',
  capA?.cap?.skin === capA?.appear?.skin && capA?.cap?.shirt === capA?.appear?.shirt,
  `skin ${capA?.cap?.skin} vs ${capA?.appear?.skin}`);

// смена внешности игрока → капитан на палубе пересобирается
const capB = jparse(await evR(`(() => {
  const g = window.__game;
  window.__seaPatchSettings({ player: { skin: 0xd9a184 } });
  g.stepDebugNR(0.3);
  const m = window.__crewModelInfo();
  return JSON.stringify({ skin: m.captain.skin, isPlayer: m.captain.isPlayer });
})()`));
log(JSON.stringify(capB));
check('A3: смена внешности → капитан пересобрался (skin 0xd9a184)',
  capB?.isPlayer === true && capB?.skin === 0xd9a184, `skin=${capB?.skin}`);

// ============ B: «ЧЁРНАЯ ЖЕМЧУЖИНА» → МОДЕЛЬ ИГРОКА-МЕРТВЕЦА ============
log('\n===== B: Жемчужина → игрок-мертвец =====');
const bp = jparse(await evR(`(() => {
  const g = window.__game;
  const r = g.changeShip('blackpearl', true);
  g.stepDebugNR(0.4);
  const m = window.__crewModelInfo();
  return JSON.stringify({ r, player: g.player.crewUndeadOpt, cap: m.captain,
    figs: g.player.crew3d.undeadFigures, total: g.player.crew3d.total });
})()`));
log(JSON.stringify(bp));
check('B1: Жемчужина выбрана — команда проклята', bp?.player === true, `res=${bp?.r}`);
check('B2: КАПИТАН-ИГРОК стал МЕРТВЕЦОМ (undead, isPlayer)',
  bp?.cap?.isPlayer === true && bp?.cap?.undead === true, JSON.stringify(bp?.cap));
check('B3: ВСЯ команда — мертвецы (figs === total)',
  bp?.figs >= 15 && bp?.figs === bp?.total, `${bp?.figs}/${bp?.total}`);

// детальный режим: проклятый КАПИТАН-игрок с ЗЕЛЁНЫМ КЛИНКОМ
const bpDet = jparse(await evR(`(() => {
  const g = window.__game;
  window.__seaPatchSettings({ graphics: { crewDetail: 'detailed' } });
  g.stepDebugNR(0.6);
  let blade = false;
  g.player.crew3d.group.traverse(o => {
    if (o.material && o.material.emissive && o.material.emissive.getHex
      && o.material.emissive.getHex() === 0x1e8f3e) blade = o;
  });
  const m = window.__crewModelInfo();
  return JSON.stringify({ detailed: g.player.crewDetailedOpt, cap: m.captain,
    blade: !!blade, figs: g.player.crew3d.undeadFigures, total: g.player.crew3d.total });
})()`));
log(JSON.stringify(bpDet));
check('B4: ДЕТАЛЬНЫЙ капитан-мертвец (профессия captain, undead)',
  bpDet?.detailed === true && bpDet?.cap?.isPlayer === true
  && bpDet?.cap?.undead === true && bpDet?.cap?.profession === 'captain',
  JSON.stringify(bpDet?.cap));
check('B5: зелёный ПРОКЛЯТЫЙ клинок у детального капитана (0x1e8f3e)',
  bpDet?.blade === true, '');
check('B6: детальный капитан тоже учтён мертвецом (figs === total)',
  bpDet?.figs === bpDet?.total, `${bpDet?.figs}/${bpDet?.total}`);

// ============ C: ДЕТАЛЬНЫЙ ЭКИПАЖ НА ПАЛУБЕ (совместимость v70) ============
log('\n===== C: детальные фигуры на палубе =====');
const detC = jparse(await evR(`(() => {
  const g = window.__game;
  let faceMark = false;
  g.player.crew3d.group.traverse(o => { if (!faceMark && o.userData && o.userData.faceMark) faceMark = true; });
  const s1 = (() => { let s = null; g.player.crew3d.group.traverse(o => {
    if (s === null && o.scale && Math.abs(o.scale.x - 1) > 0.002 && Math.abs(o.scale.x - 1) < 0.1
      && o.children && o.children.length > 2) s = +o.scale.x.toFixed(4); }); return s; })();
  g.stepDebugNR(0.6);
  const s2 = (() => { let s = null; g.player.crew3d.group.traverse(o => {
    if (s === null && o.scale && Math.abs(o.scale.x - 1) > 0.002 && Math.abs(o.scale.x - 1) < 0.1
      && o.children && o.children.length > 2) s = +o.scale.x.toFixed(4); }); return s; })();
  return JSON.stringify({ faceMark, s1, s2 });
})()`));
log(JSON.stringify(detC));
check('C1: лицевые метки глаз (faceMark)', detC?.faceMark === true, '');
check('C2: ДЫХАНИЕ живое (масштаб грудной клетки меняется)',
  detC?.s1 !== null && detC?.s2 !== null && detC?.s1 !== detC?.s2,
  `срезы: ${detC?.s1} → ${detC?.s2}`);

// вернуть шлюп и классику (не ломать последующие прогоны)
ev(`window.__game.changeShip('sloop', true)`);
ev(`window.__seaPatchSettings({ graphics: { crewDetail: 'classic' } })`);
await sleep(800);

// ============ D: PREVIEW-ВЕРФЬ /crew ============
log('\n===== D: /crew — профессии, снаряжение, ветер, выстрел =====');
const crewPage = jparse(await evR(`(async () => {
  const r = await fetch('/crew'); return JSON.stringify({ status: r.status });
})()`));
check('D1: /crew отвечает 200', crewPage?.status === 200, `HTTP ${crewPage?.status}`);
runRaw('close');
run('open http://localhost:3000/crew');
await sleep(7000);
const cv = jparse(await evR(`(() => { const v = window.__crewView && window.__crewView(); return v ? JSON.stringify(v) : 'null'; })()`));
log(JSON.stringify(cv));
check('D2: превью собрало детальную модель (tris > 2000)',
  cv && cv.tris > 2000, `tris=${cv?.tris}`);
check('D3: по ТЗ — тени PCFSoft, 3 света, орбита, анимация',
  cv && cv.shadows === true && cv.shadowType === 'PCFSoft' && cv.lights === 3
  && cv.orbit === true && cv.animated === true, '');
check('D4: стартовая профессия — КАПИТАН',
  cv?.profession === 'captain', `prof=${cv?.profession}`);

// капитан: бандольер 12 апостолов + сабля + перо + пистолет
let pose = jparse(await evR(`(() => { const p = window.__crewPose && window.__crewPose(); return p ? JSON.stringify(p) : 'null'; })()`));
log(JSON.stringify(pose));
check('D5: капитан — бандольер «12 апостолов» (charges=12)',
  pose?.charges === 12, `charges=${pose?.charges}`);
check('D6: капитан — сабля в руке и ПЕРО на шляпе (вершинный ветер)',
  pose?.hasCutlass === true && pose?.hasFeather === true
  && (pose?.windItems || []).includes('feather') && (pose?.windItems || []).includes('skirt'),
  JSON.stringify(pose?.windItems));

// вершинный ветер: перо/полы деформируются (прогоняем время сцены)
let featherMax = 0, skirtMax = 0;
for (let k = 0; k < 6; k++) {
  ev(`window.__crewStep(0.14)`);
  const p = jparse(await evR(`(() => { const p = window.__crewPose(); return JSON.stringify(p); })()`));
  featherMax = Math.max(featherMax, p?.featherDx ?? 0);
  skirtMax = Math.max(skirtMax, p?.skirtDx ?? 0);
}
check('D7: ВЕТЕР деформирует ПЕРО по вершинам (dx > 0.002)',
  featherMax > 0.002, `max dx=${featherMax}`);
check('D8: ВЕТЕР колышет ПОЛЫ КАФТАНА (dx > 0.002)',
  skirtMax > 0.002, `max dx=${skirtMax}`);

// БОЕВАЯ СТОЙКА
ev(`window.__crewSetPose('combat')`);
for (let k = 0; k < 8; k++) ev(`window.__crewStep(0.15)`);
const phC = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
check('D13: БОЕВАЯ СТОЙКА включается (pose=combat)',
  phC?.pose === 'combat', `pose=${phC?.pose}`);

// ПРОФЕССИИ: моряк/солдат/торговец/пират (кнопки UI)
const profCheck = async (label, expects) => {
  ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('${label}')); if (b) b.click(); return !!b; })()`);
  await sleep(1200);
  const p = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
  log(`${label}: ${JSON.stringify(p)}`);
  return p;
};
const sailor = await profCheck('⚓ Моряк');
check('D14: МОРЯК — без бандольера и пера, сабля при нём',
  sailor?.profession === 'sailor' && sailor?.charges === 0
  && sailor?.hasFeather === false && sailor?.hasCutlass === true,
  `prof=${sailor?.profession}, charges=${sailor?.charges}`);
const soldier = await profCheck('⚔️ Солдат');
check('D15: СОЛДАТ — бандольер «12 апостолов», без пера',
  soldier?.profession === 'soldier' && soldier?.charges === 12
  && soldier?.hasFeather === false, `charges=${soldier?.charges}`);

// ВЫСТРЕЛ ИЗ ПИСТОЛЕТА — на СОЛДАТЕ (детерминирован: у военных
// нет крюков, пистолет за поясом гарантирован); фазы по ТЗ:
// выхват ЛЕВОЙ рукой → прицел → вспышка+отдача+дым → за пояс
log('--- выстрел из пистолета (фазы, солдат) ---');
let ph0 = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
check('P1: у солдата пистолет за поясом (holster)',
  ph0?.pistolPhase === 'holster', `phase=${ph0?.pistolPhase}`);
ev(`window.__crewSetPose('pistol')`);
ev(`window.__crewStep(0.7)`);
let ph = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
log(JSON.stringify(ph));
check('P2: ВЫХВАТывание — пистолет в ЛЕВОЙ руке (draw/aim/fire, inHand)',
  ['draw', 'aim', 'fire'].includes(ph?.pistolPhase) && ph?.pistolInHand === true,
  `phase=${ph?.pistolPhase}`);
// докрутить до выстрела (draw 0.55 + aim 0.8 → fire)
for (let k = 0; k < 10; k++) ev(`window.__crewStep(0.15)`);
ph = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
log(JSON.stringify(ph));
check('P3: ВЫСТРЕЛ состоялся (фаза fire/lower/holster)',
  ['fire', 'lower', 'holster'].includes(ph?.pistolPhase), `phase=${ph?.pistolPhase}`);
const smoke = jparse(await evR(`(() => {
  let n = 0; const s = window.__crewScene();
  s.traverse(o => { if (o.isPoints) n++; });
  return JSON.stringify({ clouds: n });
})()`));
log(JSON.stringify(smoke));
check('P4: ОБЛАКО ПОРОХОВОГО ДЫМА (частицы-Points у дула)',
  (smoke?.clouds ?? 0) >= 1, `облаков=${smoke?.clouds}`);
// досмотреть до конца: за пояс, назад в «дозор»
for (let k = 0; k < 16; k++) ev(`window.__crewStep(0.2)`);
ph = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
log(JSON.stringify(ph));
check('P5: пистолет ВОЗВРАЩЁН за пояс, поза — «дозор»',
  ph?.pistolPhase === 'holster' && ph?.pistolInHand === false && ph?.pose === 'idle',
  `phase=${ph?.pistolPhase}, pose=${ph?.pose}`);
const merchant = await profCheck('📦 Торговец');
check('D16: ТОРГОВЕЦ — шляпа с ПЕРОМ, без бандольера',
  merchant?.profession === 'merchant' && merchant?.hasFeather === true
  && merchant?.charges === 0, `feather=${merchant?.hasFeather}`);
const pirate = await profCheck('🏴‍☠️ Пират');
check('D17: ПИРАТ — сабля в руке (профессия переключается)',
  pirate?.profession === 'pirate' && pirate?.hasCutlass === true,
  `prof=${pirate?.profession}`);

// МЕРТВЕЦ на превью (кнопка ☠)
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('☠ Мертвец')); if (b) b.click(); return !!b; })()`);
await sleep(1200);
const cvU = jparse(await evR(`(() => JSON.stringify(window.__crewView()))()`));
check('D18: ☠ МЕРТВЕЦ на превью (undead-модель)',
  cvU?.undead === true, `undead=${cvU?.undead}`);

// ============ ИТОГ ============
log('\n=========================================');
log(fails === 0 ? `ALL OK (${checks} проверок)` : `ЕСТЬ ПРОВАЛЫ: ${fails} из ${checks}`);
process.exit(fails === 0 ? 0 : 1);
