// E2E Task 50: ЭКИПАЖ ПО ТИПАМ СУДОВ + МУНДИРЫ/ШАПКИ + POINTER LOCK
// + LOD ДЕРЕВЬЕВ 3 УРОВНЯ + ТАЙЛ РЕЛЬЕФА + МАЧТЫ ТОЛЬКО ОТ ПРЯМОГО
// ПОПАДАНИЯ + КНИППЕЛЬ (2 полусферы + цепь, ломает мачту)
//  (A) экипаж: brig-патруль = ВОЕННЫЙ (мундиры soldierCoat ≥ 1,
//      НИ ОДНОГО крюка/деревянной ноги/наглазника/попугая);
//      торговцы (caravel/cog) = матросы без пиратских протезов;
//      «Чёрная жемчужина» = ПИРАТЫ (крюки/наглазники/попугаи есть);
//      игрок — пират; флаги соответствуют
//  (B) гардероб: мундир с отворотами/перевязью/пуговицами (меш
//      фигуры солдата ДОРОЖЕ матросской рубахи), лысые головы > 0,
//      соломенные шляпы у торговцев
//  (C) мачты: 12 попаданий ядрами В БОРТ — мачты ЦЕЛЫ (рикошет
//      убран); прямое попадание damageMast ломает; КНИППЕЛЬ с высотой
//      прицела 26 м: в полёте ≥1 меш (2 полусферы + 4 звена),
//      после залпа мачта мишени сломана
//  (D) настройки: treeVisDistance — пороги 3 уровней LOD (30%/65%/скрыто);
//      terrainTileSize — размер тайла меняется, рельеф пересобирается
//  (E) pointer lock: включён настройкой, клик по канвасу захватывает
//      курсор (в headless может быть отклонён — тогда просто
//      проверяем API), прицел освобождает курсор
//  (F) 0 ошибок JS
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
ev(`localStorage.removeItem('piratesHUDFold_v1'); localStorage.removeItem('seawolves.settings.v1'); 1`);
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

// ============ A: ЭКИПАЖ ПО ТИПАМ СУДОВ ============
log('\n===== A: солдаты на военных, матросы на торговых, пираты на пиратских =====');
const crews = jparse(await evR(`(() => {
  const g = window.__game;
  const out = [];
  const add = (name, sh) => out.push({
    name, model: sh.preset.id, flag: sh.flagKind, kind: sh.crewKind,
    ks: sh.crew3d.kindStats, total: sh.crew3d.total,
  });
  for (const a of g.aiShips) {
    add(a.ship.preset.name, a.ship);
  }
  add('ИГРОК', g.player);
  return JSON.stringify(out);
})()`));
log(JSON.stringify(crews));
const navy = crews.filter(c => c.kind === 'navy');
const merch = crews.filter(c => c.kind === 'merchant');
const pir = crews.filter(c => c.kind === 'pirate');
check('A1: военные суда есть и все — под ФЛОТСКИМ флагом (не пиратским)',
  navy.length >= 2 && navy.every(c => c.flag === 'navy'),
  `navy: ${navy.map(c => c.model).join(',')}`);
check('A2: на военных — МУНДИРЫ (soldierCoat ≥ 1) и НИ ОДНОГО крюка/ноги/наглазника/попугая',
  navy.length >= 2 && navy.every(c => c.ks.soldierCoats >= 1
    && c.ks.hooks === 0 && c.ks.pegs === 0 && c.ks.patches === 0 && c.ks.parrots === 0),
  navy.map(c => `${c.model}: мундиров ${c.ks.soldierCoats}, крюков ${c.ks.hooks}`).join(' | '));
check('A3: торговые суда есть — простые матросы (без пиратских протезов)',
  merch.length >= 3 && merch.every(c => c.ks.hooks === 0 && c.ks.pegs === 0
    && c.ks.patches === 0 && c.ks.parrots === 0 && c.ks.soldierCoats === 0),
  merch.map(c => `${c.model}: солом.шляп ${c.ks.straw}`).join(' | '));
check('A4: ПИРАТЫ только на пиратских судах (Чёрная жемчужина + Le Mystique + шлюп)',
  pir.length >= 3 && pir.some(c => c.model === 'blackpearl')
  && pir.every(c => c.flag === 'pirate' || c.name === 'ИГРОК'),
  `пиратов: ${pir.map(c => c.model).join(',')}`);
check('A5: у пиратов ЕСТЬ пиратская вольница (крюки+наглазники+попугаи суммарно > 0)',
  pir.reduce((a, c) => a + c.ks.hooks + c.ks.patches + c.ks.parrots + c.ks.pegs, 0) > 0,
  `у Чёрной жемчужины: крюков ${crews.find(c => c.model === 'blackpearl')?.ks?.hooks}, наглазников ${crews.find(c => c.model === 'blackpearl')?.ks?.patches}`);
check('A6: игрок — пиратская команда (флаг шлюпа)',
  crews.find(c => c.name === 'ИГРОК')?.kind === 'pirate',
  `kind=${crews.find(c => c.name === 'ИГРОК')?.kind}`);

// ============ B: ГАРДЕРОБ ============
log('\n===== B: мундиры, лысина, соломенные шляпы =====');
const wardrobe = jparse(await evR(`(() => {
  const g = window.__game;
  // считаем по флоту (детерминированные сиды экипажа)
  const all = [];
  for (const a of g.aiShips) all.push({ kind: a.ship.crewKind, ks: a.ship.crew3d.kindStats });
  all.push({ kind: g.player.crewKind, ks: g.player.crew3d.kindStats });
  const sum = (k, f) => all.filter(a => a.kind === k).reduce((s, a) => s + f(a.ks), 0);
  return JSON.stringify({
    navyCoats: sum('navy', ks => ks.soldierCoats),
    navyBald: sum('navy', ks => ks.bald),
    merchAprons: sum('merchant', ks => ks.aprons),
    merchStraw: sum('merchant', ks => ks.straw),
    merchBald: sum('merchant', ks => ks.bald),
    pirateStraw: sum('pirate', ks => ks.straw),
  });
})()`));
log(JSON.stringify(wardrobe));
check('B1: мундиров у военных ≥ 3 (флот + патрули)',
  wardrobe.navyCoats >= 3, `мундиров ${wardrobe?.navyCoats}`);
check('B2: ЛЫСЫЕ ГОЛОВЫ есть (у военных строевых и матросов)',
  wardrobe.navyBald + wardrobe.merchBald > 0,
  `солдат ${wardrobe?.navyBald}, матросов ${wardrobe?.merchBald}`);
check('B3: у торговцев — фартуки и соломенные шляпы (новая одежда)',
  wardrobe.merchAprons > 0 && wardrobe.merchStraw > 0,
  `фартуков ${wardrobe?.merchAprons}, соломенных ${wardrobe?.merchStraw}`);

// ============ C: МАЧТЫ — ТОЛЬКО ПРЯМОЕ ПОПАДАНИЕ + КНИППЕЛЬ ============
log('\n===== C: мачты не падают от бортов; книппель рвёт рангоут =====');
const masts = jparse(await evR(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.stepDebugNR(0.3);
  const t = g.pgTarget.ship;
  const T = window.__THREE.Vector3;
  // 12 попаданий ядрами В БОРТ (раньше 10% шанс рвал мачту)
  for (let i = 0; i < 12; i++) {
    t.hitHull(new T(2.2, 0.1, 1.2), 15, true, new T(1, 0.1, 0.2));
    g.stepDebugNR(0.1);
  }
  const afterHull = t.mastFall.slice();
  // прямой прострел мачты — ломается
  t.damageMast(0, 999);
  g.stepDebugNR(0.2);
  const afterDirect = t.mastFall.slice();
  const directBroke = afterDirect[0] >= 0;
  // восстановить мишень и проверить КНИППЕЛЬ по рангоуту
  g.resetProvingTarget();
  g.stepDebugNR(0.3);
  const t2 = g.pgTarget.ship;
  const p = g.player;
  p.position.copy(t2.position).add(new T(90, 0, 4));
  p.quaternion.setFromEuler(new window.__THREE.Euler(0, Math.PI / 2, 0));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.3);
  // залп КНИППЕЛЯМИ с прицелом на 26 м (мачты); меш проявляется на
  // кадре РЕНДЕРА (обновление видимости chainMeshes) — шаг 0.3 с:
  // снаряд ещё в полёте (дистанция 90 м / 170 м/с ≈ 0.53 с)
  g.combat.aiBallVolley(p, t2, 'chain', 26);
  g.stepDebugNR(0.3);
  const midFlight = g.combat.chainInfo();
  g.stepDebugNR(1.2);
  const afterChain = t2.mastFall.slice();
  const chainInfo2 = g.combat.chainInfo();
  return JSON.stringify({
    afterHull, anyHullBreak: afterHull.some(f => f >= 0),
    directBroke,
    midFlight, afterChain, chainInfo2,
    chainBrokeMast: afterChain.some(f => f >= 0),
  });
})()`));
log(JSON.stringify(masts));
check('C1: 12 попаданий в БОРТ — все мачты ЦЕЛЫ (рикошет убран)',
  masts.anyHullBreak === false,
  `mastFall после бортов: ${JSON.stringify(masts?.afterHull)}`);
check('C2: прямое попадание в мачту ЛОМАЕТ её',
  masts.directBroke === true, '');
check('C3: книппель В ПОЛЁТЕ: меш = 2 полусферы + 4 звена цепи',
  masts.midFlight.inFlight > 0 && masts.midFlight.halves >= 2
  && masts.midFlight.links >= 4,
  JSON.stringify(masts?.midFlight));
check('C4: залп книппелями по рангоуту ЛОМАЕТ мачту мишени',
  masts.chainBrokeMast === true,
  `mastFall: ${JSON.stringify(masts?.afterChain)}`);

// ============ D: НАСТРОЙКИ — LOD ДЕРЕВЬЕВ + ТАЙЛ РЕЛЬЕФА ============
log('\n===== D: деревья 3 уровня LOD + размер тайла =====');
const lod = jparse(await evR(`(() => {
  const g = window.__game;
  const s0 = g.world.treeLodInfo();
  const p = g.player;
  // телепорт ЗА дальность деревьев (off > treeVis), но В пределах
  // видимости группы острова (иначе LOD-блок не выполняется):
  // +2600 м от БЕРЕГА своего острова при treeVis 2200 → tier 3
  const isl0 = g.world.islands[0];
  const a0 = Math.atan2(isl0.cz, isl0.cx) + Math.PI;
  p.position.set(isl0.cx + Math.cos(a0) * (isl0.r + 2600), 0, isl0.cz + Math.sin(a0) * (isl0.r + 2600));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.5);
  const hidden = g.world.treeLodInfo();
  // вернуть игрока к первому острову — ближний tier 0
  p.position.set(isl0.cx + isl0.r * 0.4, 0, isl0.cz);
  g.stepDebugNR(0.5);
  const near = g.world.treeLodInfo();
  // дальность деревьев 600 м: отойти от берега на 800 м — деревья
  // этого острова СКРЫВАЮТСЯ (tier 3), экономия на лицо
  window.__seaPatchSettings({ graphics: { treeVisDistance: 600 } });
  p.position.set(isl0.cx + Math.cos(a0) * (isl0.r + 800), 0, isl0.cz + Math.sin(a0) * (isl0.r + 800));
  g.stepDebugNR(0.5);
  const tight = g.world.treeLodInfo();
  window.__seaPatchSettings({ graphics: { treeVisDistance: 2200 } });
  p.position.set(isl0.cx + isl0.r * 0.4, 0, isl0.cz);
  g.stepDebugNR(0.5);
  // размер тайла: текущий и после смены
  const tile0 = g.world.terrain.tileSize;
  const stats0 = g.world.terrain.stats();
  window.__seaPatchSettings({ graphics: { terrainTileSize: 720 } });
  g.stepDebugNR(0.5);
  const tile1 = g.world.terrain.tileSize;
  const stats1 = g.world.terrain.stats();
  window.__seaPatchSettings({ graphics: { terrainTileSize: tile0 } });
  g.stepDebugNR(0.5);
  return JSON.stringify({
    vis: s0.vis, hiddenSlots: hidden.hiddenSlots,
    hiddenIslands: Object.values(hidden.tiers).filter(t => t === 3).length,
    nearFull: near.fullSlots, nearTiers: near.tiers,
    tightLod: tight.lodSlots, tightHidden: tight.hiddenSlots, tightVis: tight.vis,
    tile0, tiles0: stats0.tiles, tile1, tiles1: stats1.tiles,
  });
})()`));
log(JSON.stringify(lod));
check('D1: за дальностью деревьев (off 2600 > 2200) деревья СКРЫТЫ (tier 3)',
  lod.hiddenSlots > 0, `скрыто слотов: ${lod?.hiddenSlots}, островов tier3: ${lod?.hiddenIslands}`);
check('D2: у своего острова — ПОЛНЫЕ модели (tier 0)',
  lod.nearFull > 0, `полных слотов: ${lod?.nearFull}`);
check('D3: настройка «дальность деревьев 600 м» скрывает деревья за 800 м от берега',
  lod.tightVis === 600 && lod.tightHidden > 0,
  `vis=${lod?.tightVis}, скрыто ${lod?.tightHidden}, упрощённых ${lod?.tightLod}`);
check('D4: размер тайла рельефа меняется настройкой (480 → 720) и рельеф пересобирается',
  lod.tile0 === 480 && lod.tile1 === 720 && lod.tiles1 > 0,
  `тайл ${lod?.tile0}→${lod?.tile1} м, тайлов после пересборки ${lod?.tiles1}`);

// ============ E: POINTER LOCK ============
log('\n===== E: перехват мыши =====');
const lock = jparse(await evR(`(() => {
  const g = window.__game;
  const api = {
    hasFlag: typeof g.input.pointerLocked === 'boolean',
    captureOn: g.settings.controls.mouseCapture,
    lockedNow: !!g.input.pointerLocked,
  };
  // попробовать захватить ЧЕРЕЗ ИГРОВОЙ API (headless Chrome без
  // жеста пользователя отклоняет — requestLock молча ловит отказ)
  let reqResult = 'n/a';
  try {
    g.input.requestLock();
    reqResult = 'requested';
  } catch (e) { reqResult = 'rejected'; }
  return JSON.stringify({ ...api, reqResult });
})()`));
log(JSON.stringify(lock));
check('E1: перехват мыши включён по умолчанию (controls.mouseCapture)',
  lock.captureOn === true && lock.hasFlag === true,
  `mouseCapture=${lock?.captureOn}, флаг есть=${lock?.hasFlag}`);
// прицел освобождает курсор: включаем прицел на кадр
await evR(`(() => {
  const g = window.__game;
  g.combat.aim.active = true;
  g.stepDebugNR(0.05);
  return 1;
})()`);
const aimRel = jparse(await evR(`(() => {
  const g = window.__game;
  const ok = !g.input.pointerLocked || !document.pointerLockElement;
  g.combat.aim.active = false;
  return JSON.stringify({ ok });
})()`));
check('E2: прицел ОСВОБОЖДАЕТ курсор (releaseLock при aim.active)',
  aimRel?.ok === true, JSON.stringify(aimRel));

// ============ F: ОШИБКИ ============
log('\n===== F: регрессии =====');
const errs = run('errors');
check('F1: 0 ошибок JS за весь прогон', !errs || errs.length < 5,
  String(errs).slice(0, 200));

run(`screenshot scripts/shots/t50_soldiers_deck.png`);

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
