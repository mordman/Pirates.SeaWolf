// E2E Task 79 — три жалобы игрока:
// (1) «Парус у моделей из досок режет переднюю часть пополам» —
//     кливер висел ЗА штевнем (нижняя кромка за носовой стойкой/
//     фигурой = «рассекает» нос); латинская рейка при сломе мачты
//     прошивала нос (Task 78 не покрывал латинские); реи на полной
//     брасопке цепляли пояса у кормы (soleil/bounty).
// (2) «Труба должна быть как пистолет у капитана в руках» — труба
//     теперь ВСЕГДА в руке (покой: ствол вперёд-вниз), T — к глазу.
// (3) «Капитан — игрок; при попадании по жемчужине капитан-игрок
//     меняется на мёртвого капитана со светящимся клинком».
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
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);

// ============ A: АУДИТ «ПАРУС vs НОС/ДОСКИ/ПУЗО» ============
log('\n===== A: аудит парусов (плоские + пузо + мёртвый рангоут) =====');
const aFlat = jparse(await evR(`(() => {
  const rows = window.__game.debugPlankSailAudit(0);
  const bad = r => r.planksMax > 0.02 || r.smoothMax > 0.02 || r.bowMax > 0.02;
  return JSON.stringify({ total: rows.length, bad: rows.filter(bad).map(r => r.id) }); })()`));
log(JSON.stringify(aFlat));
check('A1: плоские паруса НЕ режут доски/нос (30 пресетов)',
  aFlat?.total === 30 && aFlat?.bad?.length === 0, `bad=${JSON.stringify(aFlat?.bad)}`);

const aBelly = jparse(await evR(`(() => {
  const rows = window.__game.debugPlankSailAudit(1.68);
  const bad = r => r.planksMax > 0.02 || r.smoothMax > 0.02 || r.bowMax > 0.02;
  return JSON.stringify({ bad: rows.filter(bad).map(r => r.id + ':' + r.worst) }); })()`));
log(JSON.stringify(aBelly));
check('A2: паруса с ПУЗОМ (шторм 1.68 м) не режут доски/нос',
  aBelly?.bad?.length === 0, `bad=${JSON.stringify(aBelly?.bad)}`);

const aDead = jparse(await evR(`(() => {
  const rows = window.__game.debugDeadRigAudit();
  return JSON.stringify({ rows, bad: rows.filter(r => r.planksMax > 0.02 || r.smoothMax > 0.02) }); })()`));
log(JSON.stringify(aDead));
check('A3: МЁРТВЫЙ рангоут: латинская рейка у пня не режет корпус',
  (aDead?.rows?.length ?? 0) >= 2 && aDead?.bad?.length === 0,
  `пресетов с латинскими: ${aDead?.rows?.length}, bad=${JSON.stringify(aDead?.bad)}`);

// ============ B: КЛИВЕРА — ШКОТЫ ВПЕРЕДИ ШТЕВНЯ ============
log('\n===== B: кливера не «рассекают» нос =====');
const jibs = jparse(await evR(`(() => {
  const g = window.__game; g.changeShip('frigate', true);
  g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(3);
  const P = g.player.preset, L = P.length;
  const v = g.player.visual;
  const js = v.sails.sails.filter(s => !s.square).map(s => ({
    clewZ: +(s.quad.pivot.z + s.quad.corners[2].z).toFixed(2),
    mast: s.mastIndex,
  }));
  return JSON.stringify({ L, stem: L / 2, jibs: js }); })()`));
log(JSON.stringify(jibs));
check('B1: шкоты кливеров ВПЕРЕДИ штевня (z ≥ L/2+1.0)',
  (jibs?.jibs?.length ?? 0) === 2 && jibs.jibs.every(j => j.clewZ >= jibs.L / 2 + 1.0),
  `L=${jibs?.L}, clew=${JSON.stringify(jibs?.jibs)}`);

// скриншоты носа фрегата (траверз + нос-траверз)
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + Math.PI / 2); g.rig.freeElevSet(0.07); g.rig.distSet(34);
  g.stepDebug(0.2); return 1; })()`);
run(`screenshot scripts/shots/t79_bow_side.png`);
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 0.65); g.rig.freeElevSet(0.10); g.rig.distSet(30);
  g.stepDebug(0.2); return 1; })()`);
run(`screenshot scripts/shots/t79_bow_front.png`);

// ============ C: ЛАТИНСКАЯ РЕЙКА СЛОМАННОЙ МАЧТЫ ============
log('\n===== C: слом мачт у латинского судна (гладкий режим) =====');
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'smooth' } })`);
ev(`window.__game.changeShip('galley', true)`);
await sleep(800);
const wreck = jparse(await evR(`(() => {
  const g = window.__game; g.player.wind.speed = 9; g.player.sailTarget = 3; g.stepDebugNR(3);
  let folded = 0, pivots = [];
  for (let i = 0; i < g.player.visual.masts.length; i++) g.player.breakMast(i);
  g.stepDebugNR(5);
  for (const s of g.player.visual.sails.sails) {
    if (!s.lateenYard) continue;
    folded++;
    pivots.push({
      rotX: +s.lateenYard.rotation.x.toFixed(2),
      pivY: +s.lateenPivot.position.y.toFixed(2),
      len: +((s.lateenYard.geometry.parameters || {}).height || 0).toFixed(1),
    });
  }
  return JSON.stringify({ folded, pivots }); })()`));
log(JSON.stringify(wreck));
check('C1: латинские рейки СЛОЖИЛИСЬ вдоль мачт (rotX≈0, пивот у пня)',
  (wreck?.folded ?? 0) >= 2 && wreck.pivots.every(p => Math.abs(p.rotX) < 0.1 && p.pivY < 2.0),
  JSON.stringify(wreck?.pivots));
// скриншот обломка: рейки лежат вдоль упавших мачт, нос чист
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + Math.PI / 2); g.rig.freeElevSet(0.16); g.rig.distSet(40);
  g.stepDebug(0.2); return 1; })()`);
run(`screenshot scripts/shots/t79_galley_wreck.png`);

// ============ D: ТРУБА «КАК ПИСТОЛЕТ» В РУКЕ ============
log('\n===== D: труба в руке капитана (классика + детальная) =====');
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`window.__game.changeShip('sloop', true)`);
await sleep(800);
ev(`window.__seaPatchSettings({ player: { hook: false } })`);
ev(`window.__seaPatchSettings({ graphics: { crewDetail: 'classic' } })`);
ev(`window.__game.stepDebugNR(0.5)`);
const dCls = jparse(await evR(`(() => {
  const g = window.__game;
  const c0 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.toggleSpyglass(); g.stepDebugNR(1.4);
  const c1 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.toggleSpyglass(); g.stepDebugNR(1.2);
  const c2 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  return JSON.stringify({ c0, c1, c2 }); })()`));
log(JSON.stringify(dCls));
check('D1: классика — труба В РУКЕ в покое (hold, inHand)',
  dCls?.c0?.captain?.phase === 'hold' && dCls?.c0?.captain?.inHand === true, '');
check('D2: классика — T поднимает к глазу (observe, стекло, FOV)',
  dCls?.c1?.captain?.phase === 'observe' && dCls?.c1?.fx?.blend > 0.9 && dCls?.c1?.fov < 15, '');
check('D3: классика — T опускает, труба ОСТАЁТСЯ В РУКЕ',
  dCls?.c2?.captain?.phase === 'hold' && dCls?.c2?.captain?.inHand === true, '');
// скриншот классического капитана с трубой в руке (покой, deck-камера)
ev(`window.__game.setCameraMode('rear'); window.__game.rig.distSet(16); window.__game.stepDebug(0.1)`);
run(`screenshot scripts/shots/t79_spy_classic_rest.png`);
ev(`window.__game.player.crew3d.captainSpyglass(true); window.__game.stepDebug(0.8)`);
run(`screenshot scripts/shots/t79_spy_classic_eye.png`);
ev(`window.__game.player.crew3d.captainSpyglass(false); window.__game.stepDebug(0.8)`);

// детальная модель
ev(`window.__seaPatchSettings({ graphics: { crewDetail: 'detailed' } })`);
await sleep(1500);
ev(`window.__game.stepDebugNR(0.5)`);
const dDet = jparse(await evR(`(() => {
  const g = window.__game;
  const c0 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.toggleSpyglass(); g.stepDebugNR(2.2);
  const c1 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  g.toggleSpyglass(); g.stepDebugNR(1.2);
  const c2 = JSON.parse(JSON.stringify(window.__spyglassInfo()));
  return JSON.stringify({ c0, c1, c2 }); })()`));
log(JSON.stringify(dDet));
check('D4: детальная — труба В РУКЕ в покое (hold, inHand, 2 колена)',
  dDet?.c0?.captain?.phase === 'hold' && dDet?.c0?.captain?.inHand === true
  && dDet?.c0?.captain?.ext === 0, '');
check('D5: детальная — T: observe у глаза, колена выдвинуты',
  dDet?.c1?.captain?.phase === 'observe' && dDet?.c1?.captain?.ext > 0.9, '');
check('D6: детальная — после T труба СНОВА В РУКЕ (не за поясом)',
  dDet?.c2?.captain?.phase === 'hold' && dDet?.c2?.captain?.inHand === true, '');
ev(`window.__game.setCameraMode('rear'); window.__game.rig.distSet(16); window.__game.stepDebug(0.1)`);
run(`screenshot scripts/shots/t79_spy_detailed_rest.png`);

// ============ E: ПРОКЛЯТИЕ «ЧЁРНОЙ ЖЕМЧУЖИНЫ» ============
log('\n===== E: попадание по «Чёрной жемчужине» → капитан-мертвец =====');
const curse = jparse(await evR(`(() => {
  const g = window.__game;
  const cap0 = window.__crewModelInfo().captain;
  const bp = g.aiShips.map(a => a.ship).find(s => s.preset.id === 'blackpearl' && !s.sunk);
  if (!bp) return JSON.stringify({ error: 'нет жемчужины' });
  // подойти к жемчужине с 4 сторон (45 м), прицелиться бортом
  // (combat.aim — публичное состояние: side/azimuth/elevation),
  // дать залп — пока проклятие не сработает. Кватернион ставим
  // напрямую (рамка волн перезапишет лишь наклон, не курс).
  let cursed = false;
  window.__hitLog = [];
  g.bus.on('projectile:hit', e => {
    window.__hitLog.push({
      t: e && e.target && e.target.preset ? e.target.preset.id : '?',
      s: e && e.shooter === g.player ? 'player' : 'other',
    });
  });
  for (let k = 0; k < 4 && !cursed; k++) {
    const ang = k * Math.PI / 2 + 0.4;
    const px = bp.position.x + Math.cos(ang) * 45;
    const pz = bp.position.z + Math.sin(ang) * 45;
    g.player.position.set(px, 0, pz);
    g.player.velocity.set(0, 0, 0);
    g.player.angular.set(0, 0, 0);
    // бортом к цели: курс = на цель + 90°; кватернион — вручную
    const h = Math.atan2(bp.position.x - px, bp.position.z - pz) + Math.PI / 2;
    g.player.heading = h;
    g.player.quaternion.set(0, Math.sin(h / 2), 0, Math.cos(h / 2));
    g.stepDebugNR(0.6);
    g.player.heading = h;
    g.player.quaternion.set(0, Math.sin(h / 2), 0, Math.cos(h / 2));
    // какой борт смотрит на жемчужину (starboard = −X при курсе 0)
    const dSt = { x: -Math.cos(h), z: Math.sin(h) };
    const side = ((bp.position.x - px) * dSt.x + (bp.position.z - pz) * dSt.z) > 0 ? 1 : -1;
    g.combat.aim.active = true;
    g.combat.aim.side = side;
    g.combat.aim.azimuth = 0;
    g.combat.aim.elevation = 0.04;
    const fired = g.combat.fireBroadside();
    g.stepDebugNR(4);
    cursed = window.__crewModelInfo().captainCursed;
    window.__hitLog.push({ fired, side, k });
  }
  const info = window.__crewModelInfo();
  // светящийся клинок: зелёный emissive-материал в группе капитана
  let glow = 0;
  g.player.crew3d.group.traverse(o => {
    const m = o && o.material;
    if (m && m.emissive) {
      const h = m.emissive.getHex();
      if (h === 0x39d65a || h === 0x52e07a || h === 0x1e8f3e) glow++;
    }
  });
  return JSON.stringify({
    cap0: { isPlayer: cap0.isPlayer, undead: cap0.undead },
    found: true,
    cursed: info.captainCursed,
    cap1: info.captain,
    glow,
    hitLog: window.__hitLog,
  }); })()`));
log(JSON.stringify(curse));
check('E1: капитан на корабле — ИГРОК (внешность со старта)',
  curse?.cap0?.isPlayer === true && curse?.cap0?.undead === false,
  `isPlayer=${curse?.cap0?.isPlayer}`);
check('E2: «Чёрная жемчужина» найдена, залп дан',
  curse?.found === true && curse?.error === undefined, '');
check('E3: ПРОКЛЯТИЕ сработало (captainCursed, капитан-мертвец)',
  curse?.cursed === true && curse?.cap1?.undead === true,
  `cursed=${curse?.cursed}, undead=${curse?.cap1?.undead}`);
check('E4: СВЕТЯЩИЙСЯ клинок в руке капитана (зелёный emissive)',
  (curse?.glow ?? 0) >= 1, `glow=${curse?.glow}`);
check('E5: проклятому труба — ЗА ПОЯСОМ (клинок занял руку)',
  curse?.cap1?.spy?.phase === 'holster' || curse?.cap1?.spy?.inHand === false,
  `spy=${JSON.stringify(curse?.cap1?.spy)}`);
// скриншот проклятого капитана (задняя камера, крупно)
ev(`window.__game.setCameraMode('rear'); window.__game.rig.distSet(16); window.__game.stepDebug(0.3)`);
run(`screenshot scripts/shots/t79_cursed_captain.png`);
// повторное попадание не дублирует проклятие (раз за игру)
const again = jparse(await evR(`(() => {
  const g = window.__game;
  const before = window.__crewModelInfo().captainCursed;
  g.combat.fireBroadside(); g.stepDebugNR(4);
  return JSON.stringify({ before, after: window.__crewModelInfo().captainCursed }); })()`));
check('E6: проклятие РАЗ за игру (флаг не меняется)',
  again?.before === true && again?.after === true, '');

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (проверок: ${checks})`);
