// E2E Task 51: ОТКАЧКА ВОДЫ + ЛУТ ПОТОПЛЕННЫХ (сундук/мешки) +
// КОЛЛИЗИИ (причал/лодки) + ДЕТАЛИЗАЦИЯ ПОРТОВ (окна/трубы/дым,
// форт: амбразуры/ворота/флаг) + ПОДЗОРНАЯ ТРУБА + ОЧКИ/ПРИЧЁСКИ
//  (A) откачка: пробоина → вода в ОТСЕКАХ растёт → команда качает
//      ИЗ ОТСЕКОВ (раньше качали «сумму», которую пересчитывали —
//      откачка не работала) → трюм осушается
//  (B) лут: потопление AI-судна → на воде СУНДУК с золотом + МЕШКИ
//      с товарами → подход на 5 м → всё поднято
//  (C) коллизии: корабль выталкивает из полосы ПРИЧАЛА; рыбацкую
//      ШЛЮПКУ сносит от корпуса (лодка не проскакивает насквозь)
//  (D) порта/деревни: ТРУБЫ (chimneys, дым спавнится у ближних),
//      ФОРТ: найден, деталей ≥ 50, амбразур ≥ 12
//  (E) подзорная труба: T — FOV 55→13 (×4), повторно — обратно;
//      прицел опускает трубу; виньетка data-spyglass
//  (F) внешность: очки и ХВОСТИКИ встречаются во флоте
//  (G) 0 ошибок JS
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

// ============ A: ОТКАЧКА ВОДЫ ============
log('\n===== A: откачка качает ИЗ ОТСЕКОВ =====');
const pump = jparse(await evR(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.stepDebugNR(0.3);
  const t = g.pgTarget.ship;
  const T = window.__THREE.Vector3;
  // пробоина ниже ватерлинии (у дощатой мишени hitHull идёт в
  // ДОСКИ — течь даёт addLeakAt, как пожар/разлом в бою)
  t.addLeakAt(0.05, new T(2.0, -0.2, 1.0));
  g.stepDebugNR(2.0);
  const before = t.damageInfo();
  // 14 секунд откачки (как удержание R): crewAction качает ОТСЕКИ
  t.pumpAction = true;
  for (let i = 0; i < 140; i++) t.crewAction(0.1);
  t.pumpAction = false;
  g.stepDebugNR(0.2);
  const after = t.damageInfo();
  return JSON.stringify({
    before: before.water, after: after.water,
    compsBefore: before.compartments, compsAfter: after.compartments,
    leakAfter: after.leakRate,
    crew: t.crew,
  });
})()`));
log(JSON.stringify(pump));
check('A1: пробоина — вода в отсеках НАБЕЖАЛА (water > 0.05)',
  pump.before > 0.05, `water=${pump?.before} т, отсеки=${JSON.stringify(pump?.compsBefore)}`);
check('A2: откачка РЕАЛЬНО осушает отсеки (вода упала минимум вдвое)',
  pump.after < pump.before * 0.5 && pump.after < pump.before - 0.05,
  `${pump?.before} → ${pump?.after} т`);
check('A3: пробоина ЗАТЫКАЕТСЯ при откачке (leak гаснет)',
  pump.leakAfter < 0.02, `leak=${pump?.leakAfter}`);

// ============ B: ЛУТ ПОТОПЛЕННЫХ ============
log('\n===== B: сундук и мешки на месте гибели =====');
const loot = jparse(await evR(`(() => {
  const g = window.__game;
  g.exitProving();
  g.stepDebugNR(0.3);
  // ближайшее AI-судно с золотом и грузом
  const a = g.aiShips.find(x => x.ship.gold > 100 && !x.ship.sunk && !x.ship.sinking);
  const t = a.ship;
  const goldBefore = t.gold;
  const cargoBefore = { ...t.cargo };
  const playerGold0 = g.player.gold;
  // потопить: корпус в минус — уйдёт под воду за ~26 с
  t.hullHP = -1;
  t.position.copy(g.player.position).add(new window.__THREE.Vector3(40, 0, 0));
  t.velocity.set(0, 0, 0);
  g.stepDebugNR(28);
  const fl = window.__flotsamInfo();
  // собрать всё: сундук — у точки гибели, мешки разбросаны —
  // подходим к каждому (радиус подбора 7 м)
  for (let iter = 0; iter < 8; iter++) {
    const f = window.__flotsamInfo();
    if (f.alive === 0) break;
    g.player.position.set(f.items[0].x, 0, f.items[0].z);
    g.player.velocity.set(0, 0, 0);
    g.stepDebugNR(0.3);
  }
  const flAfter = window.__flotsamInfo();
  return JSON.stringify({
    sunk: t.sunk, goldBefore, cargoBefore,
    playerGold0, playerGold1: g.player.gold,
    playerCargo: g.player.cargo,
    fl, flAfter,
  });
})()`));
log(JSON.stringify(loot));
check('B1: судно утонуло (sunk)', loot.sunk === true, '');
check('B2: на воде — СУНДУК и МЕШКИ (chests ≥ 1, sacks ≥ 1)',
  loot.fl.chests >= 1 && loot.fl.sacks >= 1,
  `сундуков=${loot?.fl?.chests}, мешков=${loot?.fl?.sacks}, золота в сундуках=${loot?.fl?.gold}`);
check('B3: золото сундука ПОДОБРАНО игроком при подходе',
  loot.playerGold1 > loot.playerGold0 + (loot.goldBefore - 1),
  `${loot?.playerGold0} → ${loot?.playerGold1} (в сундуке было ${loot?.goldBefore})`);
check('B4: товары из мешков в трюме игрока',
  Object.keys(loot.cargoBefore).some(k => (loot.playerCargo[k] ?? 0) > 0),
  `трюм: ${JSON.stringify(loot?.playerCargo)}`);
check('B5: вода ЧИСТА после подбора (flotsam пуст)',
  loot.flAfter.alive === 0, `осталось=${loot?.flAfter?.alive}`);

// ============ C: КОЛЛИЗИИ ============
log('\n===== C: причал и лодки — не пройти насквозь =====');
const col = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  // --- ПРИЧАЛ: поставить корабль СЕРЕДИНОЙ на пирс порта ---
  const port = g.world.ports[0];
  const dockLen = [62, 86, 110, 124][port.tier];
  const shore = port.dockEnd.clone().addScaledVector(port.dir, -(dockLen - 8));
  const mid = shore.clone().addScaledVector(port.dir, dockLen * 0.45);
  p.position.set(mid.x, 0, mid.z);
  p.quaternion.identity();
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.1);
  const distToDock = (pos) => {
    const a = shore, b = port.dockEnd;
    const abx = b.x - a.x, abz = b.z - a.z;
    let u = ((pos.x - a.x) * abx + (pos.z - a.z) * abz) / (abx * abx + abz * abz);
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(pos.x - (a.x + abx * u), pos.z - (a.z + abz * u));
  };
  const d0 = distToDock(p.position);
  g.stepDebugNR(1.2);   // кадры: выталкивание из полосы пирса
  const d1 = distToDock(p.position);
  const halfW = 3.6 + p.preset.beam * 0.55;
  // --- ЛОДКА: телепорт на ближнюю шлюпку прибрежного флота ---
  let boat = null, bd = 1e9;
  for (const b of g.world.coastFleet.boats) {
    const d = Math.hypot(b.x - p.position.x, b.z - p.position.z);
    if (d < bd && !b.sinking) { bd = d; boat = b; }
  }
  let boatPushed = null;
  if (boat) {
    const bx0 = boat.x, bz0 = boat.z;
    p.position.set(bx0, 0, bz0);
    p.velocity.set(0, 0, 0);
    g.stepDebugNR(0.8);
    boatPushed = { moved: Math.hypot(boat.x - bx0, boat.z - bz0), d: Math.hypot(boat.x - p.position.x, boat.z - p.position.z) };
  }
  return JSON.stringify({ d0: +d0.toFixed(2), d1: +d1.toFixed(2), halfW: +halfW.toFixed(2), boatPushed });
})()`));
log(JSON.stringify(col));
check('C1: корабль поставлен НА пирс (в полосе)',
  col.d0 < col.halfW, `дистанция до оси ${col?.d0} < полуширины ${col?.halfW}`);
check('C2: ПРИЧАЛ ВЫТАЛКИВАЕТ корабль из своей полосы',
  col.d1 > col.halfW || col.d1 > col.d0 + 0.5,
  `${col?.d0} → ${col?.d1} м от оси пирса`);
check('C3: ЛОДКУ СНОСИТ от корпуса (не проскакивает насквозь)',
  col.boatPushed && col.boatPushed.moved > 2,
  `сдвиг ${col?.boatPushed?.moved?.toFixed(1)} м, теперь ${col?.boatPushed?.d?.toFixed(1)} м от корабля`);

// ============ D: ДЕТАЛИЗАЦИЯ ПОРТОВ ============
log('\n===== D: окна/трубы/дым + форт =====');
const det = jparse(await evR(`(() => {
  const g = window.__game;
  const chim = window.__chimneyInfo();
  const fort = window.__fortInfo();
  // телепорт к порту 1-го уровня (деревня) — окна хижин в кадре
  const p = g.player;
  const port = g.world.ports[0];
  p.position.copy(port.dockEnd).addScaledVector(port.dir, 30);
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.5);
  const chimNear = window.__chimneyInfo();
  return JSON.stringify({ chim, fort, chimNear });
})()`));
log(JSON.stringify(det));
check('D1: ТРУБЫ у домов построены (порты + деревни ≥ 20)',
  det.chim.pipes >= 20, `труб всего ${det?.chim?.pipes}`);
check('D2: у порта есть ближние трубы (дым будет виден)',
  det.chimNear.near >= 2, `ближних ${det?.chimNear?.near}`);
check('D3: ФОРТ найден и ДЕТАЛИЗИРОВАН (деталей ≥ 50, амбразур ≥ 12)',
  det.fort.found && det.fort.parts >= 50 && det.fort.embrasures >= 12,
  `деталей ${det?.fort?.parts}, амбразур ${det?.fort?.embrasures}`);

// ============ E: ПОДЗОРНАЯ ТРУБА ============
log('\n===== E: труба капитана =====');
const spy = jparse(await evR(`(() => {
  const g = window.__game;
  const fov0 = g.rig.camera.fov;
  g.toggleSpyglass();
  const on = g.spyglassOn;
  g.stepDebugNR(0.8);
  const fovIn = g.rig.camera.fov;
  const hudOn = g.hud.spyglass;
  g.toggleSpyglass();
  g.stepDebugNR(0.8);
  const fovOut = g.rig.camera.fov;
  // прицел опускает трубу
  g.toggleSpyglass();
  g.stepDebugNR(0.5);
  g.combat.aim.active = true;
  g.stepDebugNR(0.2);
  const aimOff = !g.spyglassOn;
  g.combat.aim.active = false;
  g.rig.spyglass = false;
  return JSON.stringify({ fov0: +fov0.toFixed(1), fovIn: +fovIn.toFixed(1), fovOut: +fovOut.toFixed(1), on, hudOn, aimOff });
})()`));
log(JSON.stringify(spy));
check('E1: труба ВКЛЮЧАЕТСЯ (T) и сужает FOV к ~13° (×4)',
  spy.on && spy.fovIn < 20, `${spy?.fov0}° → ${spy?.fovIn}°`);
check('E2: HUD видит трубу (виньетка data-spyglass)',
  spy.hudOn === true, '');
check('E3: повторное T — FOV возвращается к ~55°',
  spy.fovOut > 50, `${spy?.fovOut}°`);
check('E4: прицел ОПУСКАЕТ трубу',
  spy.aimOff === true, '');

// ============ F: ОЧКИ/ХВОСТИКИ ============
log('\n===== F: очки и причёски =====');
const looks = jparse(await evR(`(() => {
  const g = window.__game;
  let pony = 0, glasses = 0, bald = 0;
  for (const a of g.aiShips) {
    pony += a.ship.crew3d.kindStats.ponytails;
    glasses += a.ship.crew3d.kindStats.glasses;
    bald += a.ship.crew3d.kindStats.bald;
  }
  pony += g.player.crew3d.kindStats.ponytails;
  glasses += g.player.crew3d.kindStats.glasses;
  bald += g.player.crew3d.kindStats.bald;
  return JSON.stringify({ pony, glasses, bald });
})()`));
log(JSON.stringify(looks));
check('F1: ХВОСТИКИ встречаются во флоте (≥ 1)',
  looks.pony >= 1, `хвостиков ${looks?.pony}`);
check('F2: ОЧКИ встречаются (≥ 1)',
  looks.glasses >= 1, `очку ${looks?.glasses}`);
check('F3: лысины по-прежнему есть',
  looks.bald >= 1, `лысых ${looks?.bald}`);

// ============ G: ОШИБКИ ============
log('\n===== G: регрессии =====');
const errs = run('errors');
check('G1: 0 ошибок JS за весь прогон', !errs || errs.length < 5,
  String(errs).slice(0, 200));

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
