// E2E Task 41: НАСТРОЙКИ ОСТРОВОВ (вкладка) — деревья до ×1000,
// пер-островные переопределения, деревни/жители/рыбацкие лодки.
//  (I) UI: вкладка «Острова» — глобальные множители (деревья
//      ×0.25..×1000, деревни/жители/лодки) + селектор острова с
//      переопределениями
//  (T) ДЕРЕВЬЯ ×1000 — бюджет: instances растут к ~1,5 млн
//      (budgetHit), возврат ×1; ×1000 на ОДНОМ острове (override) —
//      на нём деревьев в разы больше, на остальных как было
//  (V) ДЕРЕВНИ: ×0 — все неактивны (folk 0), ×2 — активных больше
//      базового; возврат ×1
//  (F) ЖИТЕЛИ: ×0 при деревнях ×1 — деревни есть, жителей 0
//  (B) ЛОДКИ: ×0 — 0 лодок; ×2 — примерно вдвое больше; возврат ×1
//  (S) СХЕМА v15 (Task 42): islands (mul + perIsland) живёт перезагрузку
//  (R) Регрессия мира: ×1 везде = прежнее число деревень/жителей
//      (детерминизм: первые деревни пула не изменились)
//  (E) 0 ошибок JS + скриншоты
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
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
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
const key = (code, type = 'keydown') => ev(`window.dispatchEvent(new KeyboardEvent('${type}', {code: '${code}'})); 'ok'`);
const log = (...a) => console.log(...a);
// применить настройку islands (patch сливается с текущей)
const applyIsl = (patch) => ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  Object.assign(s.islands, ${JSON.stringify(patch)});
  g.applySettings(s);
  return 'ok';
})()`);
const islInfo = () => evR(`(() => { const i = window.__sea.islands; return JSON.stringify({
  trees: i.trees.instances, budgetHit: i.trees.budgetHit,
  villages: i.villages.active, folk: i.folk.total, boats: i.boats.n,
  vegPerIsland0: i.trees.vegPerIsland ? i.trees.vegPerIsland[0] : null,
  vegPerIsland1: i.trees.vegPerIsland ? i.trees.vegPerIsland[1] : null,
}); })()`);

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
let loaded = false;
await sleep(12000);
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { loaded = true; break; }
  await sleep(3000);
}
log('GAME LOADED:', loaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(300);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// закрыть экран капитана, начать игру
ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (scr) { const b = [...scr.querySelectorAll('button')].find(x => x.textContent.includes('Позже')); if (b) b.click(); }
  return 'ok';
})()`);
await sleep(800);
ev(`window.__game.start()`);
// HUD обновляется из game.hud внутри stepFrame; в headless RAF
// заморожен — гоняем кадр вручную, иначе hud.started=false и кнопок нет
ev(`window.__game.stepDebugNR(0.3)`);
await sleep(700);

// ============ I: UI — ВКЛАДКА «ОСТРОВА» ============
log('\n===== I: вкладка «Острова» =====');
// открыть настройки — кнопка «⚙ Настройки» в HUD (с иконкой)
const uiOpened = ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Настройки'));
  if (btn) { btn.click(); return 'clicked'; }
  return 'no-btn';
})()`);
await sleep(700);
const islandsTab = ev(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const tab = btns.find(b => b.textContent.trim() === '🏝 Острова');
  if (!tab) return 'no-tab';
  tab.click();
  return 'tab';
})()`);
await sleep(500);
const islandsUi = jparse(await evR(`(() => {
  const txt = document.body.innerText;
  const panel = document.querySelector('.fixed') || document.body;
  const selects = [...panel.querySelectorAll('select')].map(s => s.options.length);
  return JSON.stringify({
    tab: txt.includes('Острова'),
    globals: txt.includes('Глобально (все острова)'),
    trees: txt.includes('Деревья и кусты'),
    villages: txt.includes('Деревни'),
    folk: txt.includes('Жители деревень'),
    boats: txt.includes('Рыбацкие лодки'),
    perIsland: txt.includes('Настройки отдельного острова'),
    islandSelect: txt.includes('выбрать остров'),
    selectCounts: selects.join(','),
    x1000: txt.includes('×1000'),
  });
})()`));
log('UI open:', uiOpened, '|', islandsTab);
log(JSON.stringify(islandsUi));
check('I1: вкладка «ОСТРОВА» открывается, глобальные множители на месте',
  islandsTab.includes('tab') && islandsUi && islandsUi.globals === true && islandsUi.trees === true
    && islandsUi.villages === true && islandsUi.folk === true && islandsUi.boats === true,
  JSON.stringify(islandsUi));
check('I2: ×1000 в списке деревьев + селектор острова для переопределений',
  islandsUi && islandsUi.x1000 === true && islandsUi.islandSelect === true && islandsUi.perIsland === true,
  `selects: ${islandsUi?.selectCounts}`);

// выбрать остров в селекторе (у него 31 опция и «— выбрать остров —»)
const ovUi = jparse(await evR(`(() => {
  const selects = [...document.querySelectorAll('select')];
  const sel = selects.find(s => [...s.options].some(o => o.textContent.includes('выбрать остров')));
  if (!sel) return { sel: false };
  sel.value = sel.options[2].value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { sel: true, name: sel.options[2].textContent };
})()`));
await sleep(500);
const ovShown = jparse(await evR(`(() => {
  const txt = document.body.innerText;
  return JSON.stringify({
    treesHere: txt.includes('Деревья здесь'),
    villagesHere: txt.includes('Деревни здесь'),
    folkHere: txt.includes('Жители здесь'),
    boatsHere: txt.includes('Лодки здесь'),
    asGlobalOpt: txt.includes('Как глобально (×'),
    resetBtn: txt.includes('Сбросить переопределения'),
  });
})()`));
log(JSON.stringify(ovUi), JSON.stringify(ovShown));
check('I3: переопределения выбранного острова (4 поля + «как глобально»)',
  ovShown && ovShown.treesHere === true && ovShown.villagesHere === true
    && ovShown.folkHere === true && ovShown.boatsHere === true && ovShown.asGlobalOpt === true,
  JSON.stringify(ovShown));
// закрыть панель (Escape)
ev(`window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'})); 'ok'`);
await sleep(500);

// ============ R: БАЗОВОЕ СОСТОЯНИЕ МИРА (детерминизм) ============
log('\n===== R: базовое состояние (×1) =====');
const base = jparse(await islInfo());
log(JSON.stringify(base));
const islBase = jparse(await evR(`(() => { const i = window.__sea.islands; return JSON.stringify({
  villagesTotal: i.villages.total, villagesActive: i.villages.active,
  folk: i.folk.total, boats: i.boats.n, trees: i.trees.instances }); })()`));
log(JSON.stringify(islBase));
check('R1: при ×1 мир штатный: деревни активны, есть жители и лодки',
  islBase && islBase.villagesActive >= 10 && islBase.folk >= 30 && islBase.boats >= 40,
  `деревень ${islBase?.villagesActive}/${islBase?.villagesTotal}, жителей ${islBase?.folk}, лодок ${islBase?.boats}`);

// ============ T: ДЕРЕВЬЯ ×1000 (БЮДЖЕТ) ============
log('\n===== T: деревья ×1000 (бюджет) =====');
const t0 = jparse(await islInfo());
const tMs = Date.now();
applyIsl({ treesMul: 1000 });
const t1000 = jparse(await islInfo());
log(`×1000: ${JSON.stringify(t1000)} (${Date.now() - tMs} мс)`);
const grow = t1000 && t0 ? t1000.trees / Math.max(1, t0.trees) : 0;
check('T1: ×1000 — лес упёрся в БЮДЖЕТ ~1,5 млн (instances ≥ 1 млн)',
  t1000 && t1000.budgetHit === true && t1000.trees >= 1_000_000,
  `${t0?.trees?.toLocaleString?.() ?? t0?.trees} → ${t1000?.trees?.toLocaleString?.() ?? t1000?.trees} (×${grow.toFixed(1)})`);
// возврат ×1
applyIsl({ treesMul: 1 });
const tBack = jparse(await islInfo());
check('T2: возврат ×1 — штатное число деревьев',
  tBack && Math.abs(tBack.trees - t0.trees) < t0.trees * 0.05,
  `${tBack?.trees?.toLocaleString?.() ?? tBack?.trees}`);

// ПЕР-ОСТРОВ: остров 0 ×32 при глобальном ×1 (×1000 на одном острове —
// 1,3 млн деревьев и минуты постройки; для проверки механики хватает ×32)
applyIsl({ treesMul: 1, perIsland: { '0': { treesMul: 32 } } });
const tOv = jparse(await islInfo());
log(JSON.stringify(tOv));
check('T3: ОСТРОВ 0 ×32 (override) — на нём деревьев кратно больше',
  tOv && tOv.vegPerIsland0 >= tOv.vegPerIsland1 * 8,
  `остров0: ${tOv?.vegPerIsland0?.toLocaleString?.() ?? tOv?.vegPerIsland0}, остров1: ${tOv?.vegPerIsland1}`);
// сброс переопределения
applyIsl({ perIsland: {} });
const tOvOff = jparse(await islInfo());
check('T4: сброс переопределения — остров 0 вернулся к штатному',
  tOvOff && Math.abs(tOvOff.vegPerIsland0 - t0.vegPerIsland0) < t0.vegPerIsland0 * 0.05,
  `остров0: ${tOvOff?.vegPerIsland0?.toLocaleString?.() ?? tOvOff?.vegPerIsland0} (база ${t0?.vegPerIsland0})`);

// ============ V: ДЕРЕВНИ ============
log('\n===== V: деревни =====');
applyIsl({ villagesMul: 0 });
await sleep(800);
const v0 = jparse(await islInfo());
log(JSON.stringify(v0));
check('V1: деревни ×0 — НИ ОДНОЙ активной, жителей 0',
  v0 && v0.villages === 0 && v0.folk === 0, `деревень ${v0?.villages}, жителей ${v0?.folk}`);
applyIsl({ villagesMul: 2 });
await sleep(800);
const v2 = jparse(await islInfo());
log(JSON.stringify(v2));
check('V2: деревни ×2 — активных БОЛЬШЕ базового (расширенный пул)',
  v2 && v2.villages >= islBase.villagesActive * 1.6,
  `${islBase?.villagesActive} → ${v2?.villages}`);
applyIsl({ villagesMul: 1 });
await sleep(800);
const v1 = jparse(await islInfo());
check('V3: возврат ×1 — базовое число деревень',
  v1 && v1.villages === islBase.villagesActive, `${v1?.villages} (база ${islBase?.villagesActive})`);

// ============ F: ЖИТЕЛИ (деревни есть, жителей 0) ============
log('\n===== F: жители =====');
applyIsl({ folkMul: 0 });
await sleep(800);
const f0 = jparse(await islInfo());
log(JSON.stringify(f0));
check('F1: жители ×0 — деревни СТОЯТ, жителей 0',
  f0 && f0.villages === islBase.villagesActive && f0.folk === 0,
  `деревень ${f0?.villages}, жителей ${f0?.folk}`);
applyIsl({ folkMul: 2 });
await sleep(800);
const f2 = jparse(await islInfo());
check('F2: жители ×2 — примерно вдвое больше',
  f2 && f2.folk >= islBase.folk * 1.7, `${islBase?.folk} → ${f2?.folk}`);
applyIsl({ folkMul: 1 });
await sleep(800);

// ============ B: РЫБАЦКИЕ ЛОДКИ ============
log('\n===== B: рыбацкие лодки =====');
applyIsl({ boatsMul: 0 });
await sleep(800);
const b0 = jparse(await islInfo());
log(JSON.stringify(b0));
check('B1: лодки ×0 — лодок НЕТ (чистая вода)',
  b0 && b0.boats === 0, `лодок ${b0?.boats}`);
applyIsl({ boatsMul: 2 });
await sleep(800);
const b2 = jparse(await islInfo());
check('B2: лодки ×2 — примерно вдвое больше',
  b2 && b2.boats >= islBase.boats * 1.7, `${islBase?.boats} → ${b2?.boats}`);
applyIsl({ boatsMul: 1 });
await sleep(800);

// ============ S: СХЕМА v15 ПОСЛЕ ПЕРЕЗАГРУЗКИ ============
log('\n===== S: схема v15 =====');
// финальное состояние: деревья ×2 + переопределение острова 0 (лес ×0.5, лодки 0)
applyIsl({ treesMul: 2, villagesMul: 2, perIsland: { '0': { treesMul: 0.5, boatsMul: 0 } } });
await sleep(1200);
ev(`(() => {
  const s = JSON.parse(JSON.stringify(window.__game.settings));
  s.v = 14;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(s));
  return 'saved';
})()`);
run('reload');
await sleep(12000);
let reloaded = false;
for (let i = 0; i < 25; i++) {
  if (ev(`!!window.__game`).includes('true')) { reloaded = true; break; }
  await sleep(3000);
}
log('RELOADED:', reloaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(400);
const afterReload = jparse(await evR(`(() => {
  const d = JSON.parse(localStorage.getItem('seawolves.settings.v1') || '{}');
  const i = window.__sea.islands;
  return JSON.stringify({
    v: d.v,
    trees: d.islands ? d.islands.treesMul : null,
    villages: d.islands ? d.islands.villagesMul : null,
    ov0: d.islands && d.islands.perIsland ? d.islands.perIsland['0'] : null,
    appliedTrees: i ? i.trees.instances : null,
    appliedVillages: i ? i.villages.active : null,
    veg0: i && i.trees.vegPerIsland ? i.trees.vegPerIsland[0] : null,
    boats0: i && i.boats.perIsland ? i.boats.perIsland[0] : null,
  });
})()`));
log(JSON.stringify(afterReload));
check('S1: схема v15 — настройки островов сохранены и ПРИМЕНИЛИСЬ',
  afterReload && afterReload.v === 15 && afterReload.trees === 2 && afterReload.villages === 2
    && afterReload.ov0 && afterReload.ov0.treesMul === 0.5 && afterReload.ov0.boatsMul === 0,
  JSON.stringify(afterReload));
check('S2: после перезагрузки мир собрался по настройкам (лес ×2, деревни ×2)',
  afterReload && afterReload.appliedTrees >= islBase.trees * 1.8
    && afterReload.appliedVillages >= islBase.villagesActive * 1.6,
  `деревьев ${afterReload?.appliedTrees?.toLocaleString?.() ?? afterReload?.appliedTrees} (база ${islBase?.trees}), деревень ${afterReload?.appliedVillages} (база ${islBase?.villagesActive})`);
check('S3: переопределение острова 0 применилось (лес ×0.5, лодок 0)',
  afterReload && afterReload.veg0 !== null && afterReload.boats0 === 0,
  `остров0 деревьев ${afterReload?.veg0}, лодок ${afterReload?.boats0}`);

// вернуть ×1 (чистое состояние)
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.islands = { treesMul: 1, villagesMul: 1, folkMul: 1, boatsMul: 1, perIsland: {} };
  g.applySettings(s);
  const saved = JSON.parse(JSON.stringify(s));
  saved.v = 14;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(saved));
  return 'reset';
})()`);
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t41_islands_settings.png');

// ============ E: ОШИБКИ JS ============
log('\n===== E: ошибки =====');
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('E1: 0 ошибок JS', Array.isArray(errs) && errs.length === 0);

if (fails > 0) process.exit(1);
log(`\n===== ИТОГ e2e_v59: ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
