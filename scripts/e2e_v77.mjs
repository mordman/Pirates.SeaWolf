// E2E Task 77: ПОДЗОРНАЯ ТРУБА В РУКУ КАПИТАНА («как пистолет») +
// ШУМ СТЕКЛА при взгляде сквозь трубу.
// (A) игра, детальный капитан: T → фазы draw→observe (труба за
//     поясом → в кисть → колена выдвигаются), FOV сужается,
//     пост-процесс «сквозь стекло» включается (blend/uTime/RT),
//     повторное T → lower→holster, труба за пояс;
// (B) /crew превью: поза «Труба», фазы, выдвижение, смена режима
//     докручивает lower; моряку труба не положена;
// (C) классический капитан: труба перекочёвывает за поясом↔в руку,
//     рука поднята к глазу;
// (D) скриншоты: взгляд сквозь стекло (зерно/виньетка/зум) и
//     капитан с трубой у лица.
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

// ============ A: ДЕТАЛЬНЫЙ КАПИТАН — ТРУБА «КАК ПИСТОЛЕТ» ============
log('\n===== A: детальный капитан: T → труба в руке → к глазу =====');
// детерминизм: БЕЗ крюка (рука с трубой — правая) + детальный экипаж
ev(`window.__seaPatchSettings({ player: { hook: false } })`);
ev(`window.__seaPatchSettings({ graphics: { crewDetail: 'detailed' } })`);
ev(`window.__game.stepDebugNR(0.5)`);

const a0 = jparse(await evR(`(() => JSON.stringify(window.__spyglassInfo()))()`));
log(JSON.stringify(a0));
check('A1: до подъёма — труба В РУКЕ (hold, Task 79), эффект выключен',
  a0?.on === false && a0?.captain?.phase === 'hold' && a0?.captain?.inHand === true
  && a0?.fx?.blend === 0 && a0?.fov > 50,
  `phase=${a0?.captain?.phase}, inHand=${a0?.captain?.inHand}, blend=${a0?.fx?.blend}, fov=${a0?.fov}`);
check('A2: капитан детальный, труба при нём (profession=captain)',
  jparse(await evR(`(() => JSON.stringify(window.__crewModelInfo().captain))()`))?.profession === 'captain',
  '');

const up = jparse(await evR(`(() => {
  const g = window.__game;
  const r = g.toggleSpyglass();
  g.stepDebugNR(0.25);                    // фаза draw, труба ещё за поясом
  const d1 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.stepDebugNR(0.35);                    // 0.6 c: перекочёвка в кисть
  const d2 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.stepDebugNR(0.6);                     // 1.2 c: observe
  const d3 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.stepDebugNR(1.4);                     // колена полностью + blend
  const d4 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  return JSON.stringify({ r, d1, d2, d3, d4 });
})()`));
log(JSON.stringify(up));
check('A3: T поднимает трубу (возврат true, фаза draw)',
  up?.r === true && up?.d1?.on === true && up?.d1?.captain?.phase === 'draw',
  `phase=${up?.d1?.captain?.phase}`);
check('A4: ВЫХВАТ — труба ПЕРЕКОЧЁВЫВАЕТ в кисть (inHand, draw)',
  up?.d2?.captain?.phase === 'draw' && up?.d2?.captain?.inHand === true,
  `phase=${up?.d2?.captain?.phase}, inHand=${up?.d2?.captain?.inHand}`);
check('A5: у ГЛАЗА — фаза observe, рука с трубой правая',
  up?.d3?.captain?.phase === 'observe' && up?.d3?.captain?.hand === 'R',
  `phase=${up?.d3?.captain?.phase}, hand=${up?.d3?.captain?.hand}`);
check('A6: КОЛЕНА выдвинуты (ext → 1)',
  up?.d4?.captain?.ext > 0.9, `ext=${up?.d4?.captain?.ext}`);
check('A7: FOV сузился (×4 ≈ 13.75°)',
  up?.d4?.fov < 15 && up?.d4?.fov > 10, `fov=${up?.d4?.fov}°`);
check('A8: СТЕКЛО — пост-процесс включён (blend≈1, RT живой)',
  up?.d4?.fx?.blend > 0.93 && up?.d4?.fx?.rt === true
  && up?.d4?.fx?.w > 100 && up?.d4?.fx?.uBlend > 0.93,
  `blend=${up?.d4?.fx?.blend}, rt ${up?.d4?.fx?.w}×${up?.d4?.fx?.h}`);
check('A9: HUD: труба поднята', up?.d4?.hud === true, '');

// ЗЕРНО живёт: uTime растёт между шагами
const grain = jparse(await evR(`(() => {
  const g = window.__game;
  const t1 = window.__spyglassInfo().fx.uTime;
  g.stepDebugNR(0.5);
  const t2 = window.__spyglassInfo().fx.uTime;
  return JSON.stringify({ t1, t2 });
})()`));
log(JSON.stringify(grain));
check('A10: ЗЕРНО стекла живое (uTime растёт)',
  grain?.t2 > grain?.t1, `uTime ${grain?.t1} → ${grain?.t2}`);

// СКРИНШОТ: взгляд сквозь стекло (виньетка-круг + зерно + зум)
run(`screenshot scripts/shots/t77_glass.png`);

// ОПУСКАНИЕ: повторное T → lower → holster, труба за пояс, FOV 55
const down = jparse(await evR(`(() => {
  const g = window.__game;
  g.toggleSpyglass();
  g.stepDebugNR(0.3);                     // lower идёт
  const d1 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.stepDebugNR(0.6);                     // holster
  const d2 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.stepDebugNR(1.2);                     // blend гаснет, FOV обратно
  const d3 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  return JSON.stringify({ d1, d2, d3 });
})()`));
log(JSON.stringify(down));
check('A11: повторное T — фаза lower (складывает)',
  ['lower'].includes(down?.d1?.captain?.phase) || down?.d1?.captain?.phase === 'observe',
  `phase=${down?.d1?.captain?.phase}`);
check('A12: ТРУБА ВОЗВРАЩАЕТСЯ В РУКУ (hold, Task 79: как пистолет)',
  down?.d2?.captain?.phase === 'hold' && down?.d2?.captain?.inHand === true
  && down?.d2?.captain?.ext === 0,
  `phase=${down?.d2?.captain?.phase}, inHand=${down?.d2?.captain?.inHand}, ext=${down?.d2?.captain?.ext}`);
check('A13: СТЕКЛО выключено, FOV вернулся (55°)',
  down?.d3?.on === false && down?.d3?.fx?.blend < 0.05 && down?.d3?.fov > 50,
  `blend=${down?.d3?.fx?.blend}, fov=${down?.d3?.fov}`);

// повторный подъём работает (re-raise)
const re = jparse(await evR(`(() => {
  const g = window.__game;
  g.toggleSpyglass();
  g.stepDebugNR(2.2);
  return JSON.stringify(window.__spyglassInfo());
})()`));
check('A14: ПОВТОРНЫЙ подъём работает (observe)',
  re?.on === true && re?.captain?.phase === 'observe' && re?.captain?.inHand === true,
  `phase=${re?.captain?.phase}`);
ev(`window.__game.toggleSpyglass(); window.__game.stepDebugNR(1.5)`);

// ============ B: /crew ПРЕВЬЮ — ПОЗА «ТРУБА» ============
log('\n===== B: /crew — поза «Труба», фазы, колена =====');
runRaw('close');
run('open http://localhost:3000/crew');
await sleep(7000);
let pose = jparse(await evR(`(() => JSON.stringify(window.__crewPose()))()`));
log(JSON.stringify(pose));
check('B1: капитан с ТРУБОЙ (spy в телеметрии, 2 колена; Task 79: в руке)',
  pose?.profession === 'captain' && pose?.spyPhase === 'hold'
  && pose?.spySections === 2 && pose?.spyInHand === true,
  `prof=${pose?.profession}, sections=${pose?.spySections}`);

const bp = jparse(await evR(`(() => {
  const ok = window.__crewSetPose('spyglass');
  window.__crewStep(0.2);
  const p1 = JSON.parse(JSON.stringify(window.__crewPose()));
  window.__crewStep(0.3);
  const p2 = JSON.parse(JSON.stringify(window.__crewPose()));
  window.__crewStep(0.8);
  const p3 = JSON.parse(JSON.stringify(window.__crewPose()));
  window.__crewStep(1.6);
  const p4 = JSON.parse(JSON.stringify(window.__crewPose()));
  return JSON.stringify({ ok, p1, p2, p3, p4 });
})()`));
log(JSON.stringify(bp));
check('B2: поза spyglass включается (кнопка «🔭 Труба»)',
  bp?.ok === true && bp?.p1?.pose === 'spyglass' && bp?.p1?.spyPhase === 'draw',
  `pose=${bp?.p1?.pose}, phase=${bp?.p1?.spyPhase}`);
check('B3: ВЫХВАТ в кисть (draw, inHand)',
  bp?.p2?.spyPhase === 'draw' && bp?.p2?.spyInHand === true,
  `phase=${bp?.p2?.spyPhase}, inHand=${bp?.p2?.spyInHand}`);
check('B4: OBSERVE — у глаза',
  bp?.p3?.spyPhase === 'observe' && bp?.p3?.pose === 'spyglass',
  `phase=${bp?.p3?.spyPhase}`);
check('B5: КОЛЕНА полностью выдвинуты (ext > 0.9)',
  bp?.p4?.spyExt > 0.9, `ext=${bp?.p4?.spyExt}`);
check('B6: ТРЕМОР/дыхание не мешают (pose жива)',
  bp?.p4?.breathing === true, '');

// СКРИНШОТЫ: капитан с трубой у лица (крупно) и в полный рост
ev(`window.__crewCam('tube')`);
run(`screenshot scripts/shots/t77_tube_face.png`);
ev(`window.__crewCam('full')`);
run(`screenshot scripts/shots/t77_tube_full.png`);

// смена режима ДОКРУЧИВАЕТ lower: idle → lower → holster → idle
const bdown = jparse(await evR(`(() => {
  window.__crewSetPose('idle');
  window.__crewStep(0.3);
  const p1 = JSON.parse(JSON.stringify(window.__crewPose()));
  window.__crewStep(0.6);
  const p2 = JSON.parse(JSON.stringify(window.__crewPose()));
  return JSON.stringify({ p1, p2 });
})()`));
log(JSON.stringify(bdown));
check('B7: смена режима — фаза lower (труба складывается)',
  bdown?.p1?.spyPhase === 'lower' && bdown?.p1?.pose === 'spyglass',
  `phase=${bdown?.p1?.spyPhase}, pose=${bdown?.p1?.pose}`);
check('B8: ТРУБА ВЕРНУЛАСЬ В РУКУ (hold, Task 79), поза сменилась на idle',
  bdown?.p2?.spyPhase === 'hold' && bdown?.p2?.spyInHand === true
  && bdown?.p2?.pose === 'idle',
  `phase=${bdown?.p2?.spyPhase}, pose=${bdown?.p2?.pose}`);

// МОРЯКУ труба не положена (только капитан)
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('⚓ Моряк')); if (b) b.click(); return 1; })()`);
await sleep(1200);
const sailor = jparse(await evR(`(() => {
  const ok = window.__crewSetPose('spyglass');
  const p = JSON.parse(JSON.stringify(window.__crewPose()));
  return JSON.stringify({ ok, prof: p.profession, spy: p.spyPhase });
})()`));
log(JSON.stringify(sailor));
check('B9: МОРЯК — трубы нет (setPose false, spy null)',
  sailor?.ok === false && sailor?.prof === 'sailor' && sailor?.spy === null,
  `ok=${sailor?.ok}, prof=${sailor?.prof}`);

// ============ C: КЛАССИЧЕСКИЙ КАПИТАН ============
log('\n===== C: классический капитан — труба за поясом ↔ в руке =====');
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 15; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
ev(`window.__seaPatchSettings({ player: { hook: false } })`);
ev(`window.__seaPatchSettings({ graphics: { crewDetail: 'classic' } })`);
ev(`window.__game.stepDebugNR(0.5)`);
const cls = jparse(await evR(`(() => {
  const g = window.__game;
  const c0 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.toggleSpyglass();
  g.stepDebugNR(0.1);
  const c1 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.stepDebugNR(1.5);
  const c2 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.toggleSpyglass();
  g.stepDebugNR(0.2);
  const c3 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  return JSON.stringify({ c0, c1, c2, c3 });
})()`));
log(JSON.stringify(cls));
check('C1: классика — до подъёма труба В РУКЕ (hold, Task 79)',
  cls?.c0?.captain?.phase === 'hold' && cls?.c0?.captain?.inHand === true, '');
check('C2: классика — ТРУБА В РУКЕ сразу при T (observe, inHand)',
  cls?.c1?.captain?.phase === 'observe' && cls?.c1?.captain?.inHand === true
  && cls?.c1?.captain?.ext === 1,
  `phase=${cls?.c1?.captain?.phase}, hand=${cls?.c1?.captain?.hand}`);
check('C3: классика — СТЕКЛО и FOV работают и тут',
  cls?.c2?.fx?.blend > 0.9 && cls?.c2?.fov < 15 && cls?.c2?.on === true,
  `blend=${cls?.c2?.fx?.blend}, fov=${cls?.c2?.fov}`);
check('C4: классика — T опускает, труба ОСТАЁТСЯ В РУКЕ (hold, Task 79)',
  cls?.c3?.captain?.phase === 'hold' && cls?.c3?.captain?.inHand === true, '');

// СКРИНШОТ: классический капитан с трубой БЕЗ виньетки (T опущена,
// но капитану приказано держать трубу — captainSpyglass напрямую)
ev(`window.__game.setCameraMode('rear'); window.__game.rig.distSet(24); window.__game.stepDebug(0.1)`);
ev(`window.__game.player.crew3d.captainSpyglass(true); window.__game.stepDebug(0.6)`);
run(`screenshot scripts/shots/t77_classic_deck.png`);

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
