// E2E Task 78: «ПАРУС РЕЖЕТ КОРАБЛЬ только у разрушаемых моделей».
// Диагноз: у целых кораблей паруса корпус не режут (численный аудит
// planksMax=0); режет РАНГОУТ ПРИ РАЗРУШЕНИИ — упавшая мачта тащит
// реи с полотном сквозь корпус/палубу (видно на разрушаемых).
// Фикс: (1) реи сломанной мачты съезжают к пню (голая мачта),
// (2) покой падения ниже — мачта заваливается за борт,
// (3) clearDamage возвращает реи на высоту.
// (A) статический аудит-гард: паруса всех пресетов НЕ режут
//     дощатый корпус (боксы досок) — ни в нейтрали, ни при брасопке;
// (B) слом мачт: полотно мгновенно зарифлено, реи у пня,
//     покой −2.6, обломки-стеньги улетели;
// (C) clearDamage: реи на месте, мачта стоит.
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

execSync('mkdir -p scripts/shots');
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
// дощатая (разрушаемая) модель — по умолчанию, но явно
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`window.__game.stepDebugNR(0.4)`);

// ============ A: СТАТИЧЕСКИЙ АУДИТ-ГАРД ============
log('\n===== A: паруса не режут дощатый корпус (статика) =====');
const audit = jparse(await evR(`(() => {
  const rows = window.__game.debugPlankSailAudit();
  return JSON.stringify({
    total: rows.length,
    planksBad: rows.filter(r => r.planksMax > 0.02).map(r => r.id + ':' + r.planksMax + ':' + r.worst),
    smoothBad: rows.filter(r => r.smoothMax > 0.02).map(r => r.id + ':' + r.smoothMax),
  });
})()`));
log(JSON.stringify(audit));
check('A1: аудит по всем пресетам', audit?.total >= 30, `пресетов: ${audit?.total}`);
check('A2: НИ ОДИН парус не режет ДОЩАТЫЙ корпус (нейтраль + брасопка)',
  Array.isArray(audit?.planksBad) && audit.planksBad.length === 0,
  JSON.stringify(audit?.planksBad));
check('A3: и ГЛАДКИЙ корпус чист (ниже палубы)',
  Array.isArray(audit?.smoothBad) && audit.smoothBad.length === 0,
  JSON.stringify(audit?.smoothBad));

// ============ B: СЛОМ МАЧТ — РАНГОУТ НЕ РЕЖЕТ КОРАБЛЬ ============
log('\n===== B: слом мачт — реи к пню, мачта за борт =====');
ev(`(() => { const g = window.__game; g.player.sailTarget = 3; g.stepDebugNR(5); return 1; })()`);
ev(`(() => { const g = window.__game; g.setCameraMode('free'); g.rig.freeAzimSet(1.9); g.rig.freeElevSet(0.30); g.rig.distSet(52); return 1; })()`);
const brk = jparse(await evR(`(() => {
  const g = window.__game;
  const v = g.player.visual;
  // высоты реёв ДО слома
  const before = v.sails.sails.filter(s => s.brace && (s.mastIndex === 0 || s.mastIndex === 1))
    .map(s => +s.brace.position.y.toFixed(2));
  g.player.breakMast(0);
  g.player.breakMast(1);
  g.stepDebugNR(0.15);
  const mid = v.sails.sails.filter(s => s.brace && (s.mastIndex === 0 || s.mastIndex === 1))
    .map(s => ({ furl: +s.furl.toFixed(2), y: +s.brace.position.y.toFixed(2) }));
  g.stepDebugNR(3.0);
  const rest = v.sails.sails.filter(s => s.brace && (s.mastIndex === 0 || s.mastIndex === 1))
    .map(s => +s.brace.position.y.toFixed(2));
  const m0 = v.masts[0], m1 = v.masts[1];
  return JSON.stringify({
    before, mid, rest,
    fall: [g.player.mastFall[0], g.player.mastFall[1]],
    rotX: [+m0.rotation.x.toFixed(2), +m1.rotation.x.toFixed(2)],
    posY: [+m0.position.y.toFixed(2), +m1.position.y.toFixed(2)],
  });
})()`));
log(JSON.stringify(brk));
check('B1: ПОЛОТНО сломанных мачт зарифлено мгновенно (furl=1)',
  Array.isArray(brk?.mid) && brk.mid.length > 0 && brk.mid.every(s => s.furl >= 0.99),
  `furl: ${JSON.stringify((brk?.mid ?? []).map(s => s.furl))}`);
check('B2: РЕИ съехали К ПНЮ после падения (y < 1.4, было ' +
  `${Math.min(...(brk?.before ?? [0])).toFixed(1)}+)`,
  Array.isArray(brk?.rest) && brk.rest.length > 0 && brk.rest.every(y => y < 1.4),
  `реи покой: ${JSON.stringify(brk?.rest)}`);
check('B3: мачты УПАЛИ (fall=1, крен 1.38)',
  brk?.fall?.[0] === 1 && brk?.fall?.[1] === 1 && brk?.rotX?.[0] > 1.2,
  `fall=${JSON.stringify(brk?.fall)}, rotX=${JSON.stringify(brk?.rotX)}`);
check('B4: покой НИЖЕ прежнего (−2.6: завалилась за борт)',
  brk?.posY?.[0] < -2.3 && brk?.posY?.[0] > -2.9,
  `posY=${JSON.stringify(brk?.posY)}`);

// СКРИНШОТ: разрушенный корабль — рангоут не режет корпус
ev(`window.__game.stepDebug(0.001)`);
run(`screenshot scripts/shots/t78_wreck_rest.png`);

// ============ C: CLEAR DAMAGE — РЕИ НА МЕСТЕ ============
log('\n===== C: сброс повреждений (полигон/возрождение) =====');
const rst = jparse(await evR(`(() => {
  const g = window.__game;
  const v = g.player.visual;
  g.player.clearDamage();
  g.stepDebugNR(0.2);
  const yards = v.sails.sails.filter(s => s.brace).map(s => +s.brace.position.y.toFixed(2));
  const m0 = v.masts[0];
  return JSON.stringify({
    fall: g.player.mastFall[0],
    rotX: +m0.rotation.x.toFixed(2), posY: +m0.position.y.toFixed(2),
    yardsRestored: yards.length ? yards.every(y => y > 1.5) : true,
    minHomeY: Math.min(...(yards.length ? yards : [9])),
  });
})()`));
log(JSON.stringify(rst));
check('C1: мачты стоят (fall=-1, rot 0)',
  rst?.fall === -1 && rst?.rotX === 0, `fall=${rst?.fall}, rotX=${rst?.rotX}`);
check('C2: РЕИ вернулись на высоту (после сброса)',
  rst?.yardsRestored === true, `minY=${rst?.minHomeY}`);

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
