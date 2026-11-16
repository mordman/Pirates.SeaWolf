// E2E Task 57: (A) паруса полного раскрытия не в воде/не режут корабль;
// (B) мертвецы: логово — только «Чёрная жемчужина», выбор Жемчужины
// игроком (полигон/верфь) — проклятая команда, зелёный клинок капитана;
// (C) настройка выхода матросов; (D) редкая эскадра кильватером;
// (E) пистолет смотрит и стреляет в одну сторону; (F) три замаха сабли.
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

// ============ A: ПАРУСА ПОЛНОГО РАСКРЫТИЯ ============
log('\n===== A: паруса полного раскрытия =====');
const sailsA = jparse(await evR(`(() => {
  const g = window.__game;
  const audit = g.debugSailAudit().filter(p => p.issues.length);
  let fl = null;
  for (const a of g.aiShips) { if (a.ship.preset.id === 'fluyt' && !a.ship.sunk) fl = a.ship; }
  const lowest = (sh) => { let lo = 999; for (const s of sh.visual.sails.sails) { for (const c of s.quad.corners) lo = Math.min(lo, s.quad.pivot.y + c.y); } return +lo.toFixed(1); };
  // топсель грота — рея ВЫШЕ реи курс-паруса (фикс «паруса резались»)
  const sq = (sh) => sh.visual.sails.sails.filter(s => s.square && s.mastIndex === 1).map(s => +s.quad.pivot.y.toFixed(1)).sort((a, b) => a - b);
  return JSON.stringify({ auditN: audit.length, sloop: lowest(g.player), fluyt: fl ? lowest(fl) : -1, sloopMainYards: sq(g.player) });
})()`));
log(JSON.stringify(sailsA));
check('A1: аудит ВСЕХ пресетов — 0 нарушений', sailsA.auditN === 0, `пресетов с нарушениями: ${sailsA?.auditN}`);
check('A2: шлюп — нижний угол паруса ≥ 4.2 м (выше гребней)',
  sailsA.sloop >= 4.2, `${sailsA?.sloop} м`);
check('A3: флейт — нижний угол паруса ≥ 4.5 м',
  sailsA.fluyt >= 4.5, `${sailsA?.fluyt} м`);
check('A4: топсель грота — рея ВЫШЕ реи курс-паруса (не режутся)',
  sailsA.sloopMainYards && sailsA.sloopMainYards.length >= 2
  && sailsA.sloopMainYards[1] > sailsA.sloopMainYards[0] + 2,
  JSON.stringify(sailsA?.sloopMainYards));

// море 12 м/с: полный сет — кливера стоят; шторм — убраны
const seaState = jparse(await evR(`(() => {
  const g = window.__game;
  g.player.position.set(30000, 0, 30000); g.player.velocity.set(0, 0, 0);
  g.player.heading = 0.4; g.player.sailTarget = 3;
  let fl = null;
  for (const a of g.aiShips) { if (a.ship.preset.id === 'fluyt' && !a.ship.sunk) fl = a.ship; }
  fl.position.set(g.player.position.x + 130, 0, g.player.position.z);
  fl.velocity.set(0, 0, 0); fl.heading = 0.4; fl.sailTarget = 3;
  const jib = (sh) => { let setF = 0; for (const s of sh.visual.sails.sails) { if (!s.square) setF = Math.max(setF, 1 - s.furl); } return +setF.toFixed(2); };
  g.debugSetWeather('clear', 12, 1.2);
  g.stepDebugNR(20);
  const fresh = { sloop: jib(g.player), fluyt: jib(fl) };
  g.debugSetWeather('storm', 24, 1.2);
  g.stepDebugNR(20);
  const storm = { sloop: jib(g.player), fluyt: jib(fl) };
  g.debugSetWeather('clear', 8, 1.0);
  g.stepDebugNR(6);
  return JSON.stringify({ fresh, storm });
})()`));
log(JSON.stringify(seaState));
check('A5: полное раскрытие 12 м/с — кливера СТОЯТ у обоих',
  seaState.fresh.sloop > 0.85 && seaState.fresh.fluyt > 0.85,
  `шлюп: ${seaState?.fresh?.sloop}, флейт: ${seaState?.fresh?.fluyt}`);
check('A6: в ШТОРМ кливера УБРАНЫ у обоих',
  seaState.storm.sloop < 0.15 && seaState.storm.fluyt < 0.15,
  `шлюп: ${seaState?.storm?.sloop}, флейт: ${seaState?.storm?.fluyt}`);

// ============ B: МЕРТВЕЦЫ ============
log('\n===== B: мертвецы =====');
const undead = jparse(await evR(`(() => {
  const g = window.__game;
  const ships = g.aiShips.filter(a => !a.ship.sunk && a.ship.crewUndeadOpt).map(a => a.ship.preset.id);
  const bp = g.aiShips.find(a => a.ship.preset.id === 'blackpearl' && !a.ship.sunk).ship;
  const my = g.aiShips.find(a => a.ship.preset.id === 'mystique' && !a.ship.sunk);
  const sl = g.aiShips.find(a => a.ship.preset.id === 'sloop' && !a.ship.sunk);
  let blade = null;
  bp.crew3d.group.traverse(o => { if (o.material && o.material.emissive && o.material.emissive.getHex && o.material.emissive.getHex() === 0x1e8f3e) blade = o; });
  return JSON.stringify({
    ships, bpUndead: bp.crew3d.undeadFigures, bpTotal: bp.crew3d.total,
    myUndead: my ? my.ship.crew3d.undeadFigures : -1,
    slUndead: sl ? sl.ship.crew3d.undeadFigures : -1,
    hasGreenBlade: !!blade,
  });
})()`));
log(JSON.stringify(undead));
check('B1: в логове мертвецы — ТОЛЬКО на «Чёрной жемчужине»',
  undead.ships.length === 1 && undead.ships[0] === 'blackpearl',
  JSON.stringify(undead?.ships));
check('B2: команда «Жемчужины» — мертвецы (все фигуры)',
  undead.bpUndead >= 15 && undead.bpUndead === undead.bpTotal,
  `${undead?.bpUndead}/${undead?.bpTotal}`);
check('B3: Mystique и шлюп логова — ЖИВЫЕ команды',
  undead.myUndead === 0 && undead.slUndead === 0,
  `Mystique: ${undead?.myUndead}, шлюп: ${undead?.slUndead}`);
check('B4: у капитана «Жемчужины» — ЗЕЛЁНЫЙ ПРОЗРАЧНЫЙ клинок',
  undead.hasGreenBlade === true, `клинок: ${undead?.hasGreenBlade}`);

// выбор Жемчужины игроком (полигон — смена бесплатная)
const ply = jparse(await evR(`(() => {
  const g = window.__game;
  const r = g.changeShip('blackpearl', true);
  g.stepDebugNR(2);
  let blade = null;
  g.player.crew3d.group.traverse(o => { if (o.material && o.material.emissive && o.material.emissive.getHex && o.material.emissive.getHex() === 0x1e8f3e) blade = o; });
  return JSON.stringify({ res: r, player: g.player.crewUndeadOpt, figs: g.player.crew3d.undeadFigures, total: g.player.crew3d.total, blade: !!blade });
})()`));
log(JSON.stringify(ply));
check('B5: ВЫБОР «Чёрной жемчужины» — команда становится мертвецами',
  ply.player === true && ply.figs >= 15 && ply.figs === ply.total,
  `мертвецов: ${ply?.figs}/${ply?.total}`);
check('B6: у капитана игрока — зелёный клинок', ply.blade === true, `клинок: ${ply?.blade}`);
// вернуть шлюп (не ломать последующие проверки)
ev(`window.__game.changeShip('sloop', true)`);

// ============ C: настройка выхода матросов ============
log('\n===== C: скорость выхода на палубу =====');
const emerge = jparse(await evR(`(() => {
  const g = window.__game;
  const before = window.__crewRules().emergenceDelay;
  window.__seaPatchSettings({ gameplay: { crewEmergenceDelay: 6 } });
  g.stepDebugNR(0.3);
  const after = window.__crewRules().emergenceDelay;
  window.__seaPatchSettings({ gameplay: { crewEmergenceDelay: 1 } });
  g.stepDebugNR(0.3);
  const fast = window.__crewRules().emergenceDelay;
  return JSON.stringify({ before, after, fast });
})()`));
log(JSON.stringify(emerge));
check('C1: настройка меняет задержку выхода (2 → 6 с → 1 с)',
  emerge.before === 2 && emerge.after === 6 && emerge.fast === 1,
  `${emerge?.before} → ${emerge?.after} → ${emerge?.fast}`);

// ============ D: РЕДКАЯ ЭСКАДРА ============
log('\n===== D: эскадра кильватером =====');
const spawn = jparse(await evR(`(() => {
  const g = window.__game;
  const r = g.spawnSquadron();
  return r ? JSON.stringify({ n: r.n, theme: r.theme }) : 'null';
})()`));
log(JSON.stringify(spawn));
check('D1: эскадра заспавнилась (3-4 судна)',
  spawn && spawn.n >= 3 && spawn.n <= 4, JSON.stringify(spawn));
for (let k = 0; k < 6; k++) { ev(`window.__game.stepDebugNR(15)`); await sleep(250); }
const form = jparse(await evR(`(() => {
  const sh = window.__squadronInfo().ships;
  const gaps = [];
  for (let i = 1; i < sh.length; i++) gaps.push(+Math.hypot(sh[i].pos[0] - sh[i-1].pos[0], sh[i].pos[1] - sh[i-1].pos[1]).toFixed(0));
  const follow = sh.filter(x => x.leader).length;
  const headings = sh.map(x => x.heading);
  const hSpread = Math.max(...headings) - Math.min(...headings);
  return JSON.stringify({ n: sh.length, follow, speeds: sh.map(x => x.speed), gaps, hSpread: +hSpread.toFixed(2) });
})()`));
log(JSON.stringify(form));
check('D2: все идут кильватером (у ведомых есть ведущий)',
  form.n >= 3 && form.follow === form.n - 1, `${form?.follow}/${(form?.n ?? 0) - 1}`);
check('D3: колонна ПОД ХОДОМ (скорости > 1.5 м/с)',
  form.speeds.every(v => v > 1.5), JSON.stringify(form?.speeds));
check('D4: строй держится (интервалы 60-420 м)',
  form.gaps.every(gp => gp >= 60 && gp <= 420), JSON.stringify(form?.gaps));
check('D5: курс общий (колонна, не толпа)', form.hSpread < 0.25, `разброс: ${form?.hSpread}`);
const des = jparse(await evR(`(() => {
  const g = window.__game;
  const n0 = window.__squadronInfo().ships.length;
  const p = g.player.position.clone();
  g.player.position.set(p.x + 9000, 0, p.z + 9000);
  g.stepDebugNR(12);
  const n1 = window.__squadronInfo().ships.length;
  g.player.position.copy(p);
  return JSON.stringify({ n0, n1 });
})()`));
log(JSON.stringify(des));
check('D6: ушли за горизонт — убраны с карты',
  des.n0 >= 3 && des.n1 === 0, `${des?.n0} → ${des?.n1}`);

// ============ E: ПИСТОЛЕТ — направление ============
log('\n===== E: пистолет =====');
const pis = jparse(await evR(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  g.lander.spawn(isl.cx, isl.cz);
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit2'}));
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit2'}));
  g.stepDebugNR(0.4);
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 2, clientX: 640, clientY: 300, bubbles: true}));
  g.stepDebugNR(0.5);
  const pre = g.lander.weaponInfo();
  window.dispatchEvent(new MouseEvent('mousedown', {button: 0, clientX: 640, clientY: 300, bubbles: true}));
  window.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
  g.stepDebugNR(0.05);
  const post = g.lander.weaponInfo();
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', {button: 2, clientX: 640, clientY: 300, bubbles: true}));
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const ang = pre.barrelDir && post.bulletDir ? Math.acos(Math.min(1, Math.max(-1, dot(pre.barrelDir, post.bulletDir)))) * 57.3 : null;
  return JSON.stringify({ weapon: pre.weapon, aiming: true, pose: pre.wristPose, angleDeg: ang === null ? null : +ang.toFixed(1) });
})()`));
log(JSON.stringify(pis));
check('E1: пистолет в руке, прицел — рука по камере',
  pis.weapon === 'pistol' && pis.pose < -1.0, `pose: ${pis?.pose}`);
check('E2: ствол СМОТРИТ и СТРЕЛЯЕТ в одну сторону (< 20°)',
  pis.angleDeg !== null && pis.angleDeg < 20, `угол: ${pis?.angleDeg}°`);

// ============ F: ТРИ ЗАМАХА САБЛИ ============
log('\n===== F: замахи сабли =====');
const sab = jparse(await evR(`(() => {
  const g = window.__game;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit1'}));
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit1'}));
  g.stepDebugNR(0.4);
  const kinds = []; const poses = [];
  for (let k = 0; k < 9; k++) {
    window.dispatchEvent(new MouseEvent('mousedown', {button: 0, clientX: 640, clientY: 300, bubbles: true}));
    window.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
    g.stepDebugNR(0.3);
    const wi = g.lander.weaponInfo();
    kinds.push(wi.swingKind); poses.push(wi.wristPose);
    g.stepDebugNR(0.6);
  }
  const uniq = [...new Set(kinds)];
  const byKind = {}; for (let i = 0; i < kinds.length; i++) { byKind[kinds[i]] = poses[i]; }
  const poseVals = Object.values(byKind);
  const distinct = new Set(poseVals.map(v => Math.round(v * 2) / 2)).size;
  return JSON.stringify({ uniqN: uniq.length, kinds, byKind, distinct });
})()`));
log(JSON.stringify(sab));
check('F1: НЕСКОЛЬКО анимаций замаха (все 3 варианта)',
  sab.uniqN === 3, `вариантов: ${sab?.uniqN}`);
check('F2: у каждого варианта — своя поза руки',
  sab.distinct >= 3, JSON.stringify(sab?.byKind));

// ============ G: ошибки ============
log('\n===== G: ошибки =====');
ev(`window.__game.stepDebugNR(3)`);
await sleep(500);
const errs = run('errors');
check('G1: 0 ошибок JS за прогон', !errs || errs.length < 5, String(errs).slice(0, 200));
runRaw('close');

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
