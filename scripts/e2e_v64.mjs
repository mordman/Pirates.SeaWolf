// E2E Task 46: ДОЩАТАЯ МОДЕЛЬ КОРПУСА + ПИРАТЫ ОТВЕЧАЮТ + ПОДМЕНА
//  (A) иерархия Ship_Root/Skeleton/Hull_Planks/Masts_And_Spars/
//      Sails_And_Rigging/Props; мачты из 3 сегментов; доски-записи
//  (B) РАЗРУШЕНИЕ ДОСОК ПОСТЕПЕННО — от нескольких попаданий:
//      1 яд. = вмятина (s1), 2 = прогиб (s2), 3 = СЛОМ (s3) + ТЕЧЬ
//      ниже ВЛ; ≥6 сломанных = ПАНЕЛЬ ВЫРВАНО (каскад); палубные
//      доски ломаются сверху (без течи); НЕТ декалей-«кругов»
//      (holes пуст, damageInfo().plankHull вместо них)
//  (C) ПИРАТЫ ОТВЕЧАЮТ ОГНЁМ в бою (регрессия «перестали стрелять»):
//      якорная эскадра логова — returnFire + crewEngage + залпы
//      дошли (playerHitCount растёт); соседи по стоянке просыпаются;
//      патрули → combat
//  (D) ПОДМЕНА ПОГИБШИХ ИЗ ТРЮМА — теперь ЛЮБЫХ (в т.ч. безоружных
//      капитана/рулевого, убитых «картечью»): строй восстанавливается;
//      правила в настройках: replacement off — палуба редеет,
//      marksmen off — ружья молчат (поза у борта остаётся)
//  (E) МАЧТЫ: 3 сегмента, при переломе верхние отстыковываются
//      и падают обломками 'spar' (физика падения)
//  (F) НАСТРОЙКИ live: дощатая ↔ обычная пересобирает все корабли;
//      обычная возвращает декали-пробоины (legacy); схема v16
//  (G) геометрия, 0 ошибок JS, скриншоты
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

// СВЕЖИЙ контекст (HTTP-кэш чанков dev-сервера отдаёт старые сборки)
run('close');
await sleep(1200);
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
check('0: игра загрузилась', loaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(300);
ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (scr) {
    const btn = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже'));
    if (btn) btn.click();
  }
  return 'ok';
})()`);
await sleep(800);
ev(`window.__game.start()`);
await sleep(600);

// вершинные счётчики крупных мешей ДО
const geo0 = jparse(await evR(`(() => {
  const g = window.__game.player;
  const counts = [];
  g.visual.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position
      && o.geometry.attributes.position.count > 500) {
      counts.push(o.geometry.attributes.position.count);
    }
  });
  return JSON.stringify({ counts: counts.sort((a,b)=>b-a).slice(0,4), n: counts.length });
})()`));
log('крупные меши ДО:', JSON.stringify(geo0));

// ============ A: ИЕРАРХИЯ ДОЩАТОЙ МОДЕЛИ ============
log('\n===== A: иерархия Ship_Root + сегменты мачт =====');
const hier = jparse(await evR(`(() => {
  const s = window.__sea;
  return JSON.stringify({
    model: s.model, root: s.hullHier.root,
    groups: s.hullHier.groups,
    plankMeshes: s.hullHier.plankMeshes,
    skeletonTris: s.hullHier.skeletonTris,
    planks: s.plankInfo,
    masts: s.mastSegments,
    fps: +s.fps.toFixed(1),
  });
})()`));
log(JSON.stringify(hier));
check('A1: модель по умолчанию — ДОЩАТАЯ (planks)', hier.model === 'planks', `model=${hier?.model}`);
check('A2: иерархия Ship_Root → Skeleton/Hull_Planks/Masts_And_Spars/Sails_And_Rigging/Props',
  hier.root === 'Ship_Root'
  && ['Skeleton', 'Hull_Planks', 'Masts_And_Spars', 'Sails_And_Rigging', 'Props']
    .every(n => hier.groups.includes(n)),
  JSON.stringify(hier?.groups));
check('A3: доски — 3 именованных меша (порт/штирборт/палуба), записи > 300',
  hier.plankMeshes.length === 3 && hier.planks.total > 300
  && hier.plankMeshes.every(m => m.startsWith('Planks_')),
  `${hier?.planks.total} досок: ${JSON.stringify(hier?.plankMeshes)}`);
check('A4: каркас смоделирован (скелет > 1500 треугольников — виден в проломах)',
  hier.skeletonTris > 1500, `skeleton=${hier?.skeletonTris} трис`);
check('A5: мачты из 3 СЕГМЕНТОВ (по всем мачтам)',
  hier.masts && hier.masts.length >= 2 && hier.masts.every(m => m === 3),
  JSON.stringify(hier?.masts));
check('A6: все доски целы (s0 = total, s1/s2/s3 = 0)',
  hier.planks.s0 === hier.planks.total && hier.planks.s3 === 0,
  JSON.stringify(hier?.planks));

// доступ по userData/имени записи (программный доступ доcки)
const byId = jparse(await evR(`(() => {
  const g = window.__game.player;
  const grp = g.visual.group.getObjectByName('Hull_Planks');
  const first = grp.userData.planks[0];
  const viaId = grp.userData.plankById(first.id);
  return JSON.stringify({
    found: !!grp, n: grp.userData.planks.length,
    firstId: first.id, viaId: viaId === first, state0: first.state, hp: first.hp,
  });
})()`));
log(JSON.stringify(byId));
check('A7: программный доступ: Hull_Planks.userData.planks / plankById(id)',
  byId.found && byId.n > 300 && byId.viaId === true && byId.state0 === 0,
  `id=${byId?.firstId} state=${byId?.state0}`);

// ============ B: РАЗРУШЕНИЕ ДОСОК — ПОСТЕПЕННОЕ ============
log('\n===== B: доски: вмятина → прогиб → СЛОМ + течь =====');
// попадание ниже ВЛ в порт (x>0): ядро 15 (реальный урон боя ×0.75-1.25)
const stages = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const hit = new T(2.4, -0.4, 2.0);
  const r1 = p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(0.3);
  const d1 = p.damageInfo();
  const r2 = p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(0.3);
  const d2 = p.damageInfo();
  const deb0 = window.__sea.debris.byKind;
  const r3 = p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(0.5);
  const d3 = p.damageInfo();
  const deb1 = window.__sea.debris.byKind;
  return JSON.stringify({
    d1: { s1: d1.plankHull.s1, s2: d1.plankHull.s2, s3: d1.plankHull.s3,
      holes: d1.holes.length, water: d1.water, leak: d1.leakRate },
    d2: { s2: d2.plankHull.s2, s3: d2.plankHull.s3, leak: d2.leakRate },
    d3: { s3: d3.plankHull.s3, holes: d3.holes.length,
      leak: d3.leakRate, water: +d3.water.toFixed(2) },
    debris: { shards: deb1.shard - deb0.shard, planksDeb: deb1.plank - deb0.plank },
  });
})()`));
log(JSON.stringify(stages));
check('B1: 1-е попадание — ВМЯТИНА (s1>0), сломанных НЕТ, течи НЕТ',
  stages.d1.s1 >= 2 && stages.d1.s3 === 0 && stages.d1.leak === 0,
  `s1=${stages?.d1?.s1}, s3=${stages?.d1?.s3}, течь=${stages?.d1?.leak}`);
check('B2: 2-е попадание — ПРОГИБ/сколы (s2>0), сломанных всё ещё НЕТ',
  stages.d2.s2 >= 2 && stages.d2.s3 === 0 && stages.d2.leak === 0,
  `s2=${stages?.d2?.s2}, s3=${stages?.d2?.s3}`);
check('B3: 3-е попадание — СЛОМ (s3>0): разрушение НЕ сразу, а с 3-го раза',
  stages.d3.s3 >= 1, `s3=${stages?.d3?.s3}`);
check('B4: слом ниже ВЛ = ТЕЧЬ в отсек (не раньше)',
  stages.d3.leak > 0.03 && stages.d2.leak === 0,
  `течь=${stages?.d3?.leak} м³/с (после 2-го: ${stages?.d2?.leak})`);
check('B5: НЕТ «странных кругов»: holes ПУСТ в дощатом режиме',
  stages.d1.holes === 0 && stages.d3.holes === 0,
  `holes=${stages?.d3?.holes} (декали-круги убраны)`);
check('B6: при СЛОМЕ летят ЩЕПЫ (shard) и доски',
  stages.debris.shards >= 6 && stages.debris.planksDeb >= 1,
  `+${stages?.debris?.shards} щепы, +${stages?.debris?.planksDeb} доски`);

// каскад: добиваем зону до ≥6 сломанных — ПАНЕЛЬ ОБШИВКИ ВЫРВАНО
const cascade = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const hit = new T(2.4, -0.4, 2.0);
  const before = p.damageInfo().plankHull.s3;
  const plates0 = window.__seaDebrisInfo().byKind.hullplate;
  let hits = 0;
  // бьём, пока КАСКАД не вырвет панель (единственный признак —
  // обломок-панель hullplate; s3 растёт с каждым попаданием)
  for (; hits < 30; hits++) {
    p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
    const di = window.__seaDebrisInfo();
    if (di.byKind.hullplate > plates0) break;
  }
  g.stepDebugNR(0.5);
  const d = p.damageInfo();
  const plates1 = window.__seaDebrisInfo().byKind.hullplate;
  return JSON.stringify({
    hits, before, after: d.plankHull.s3,
    plates: plates1 - plates0,
    leak: d.leakRate, water: +d.water.toFixed(2),
  });
})()`));
log(JSON.stringify(cascade));
check('B7: ≥6 в зоне — КАСКАД: панель обшивки вырвано (s3 скачком, секция-обломок)',
  cascade.after >= 7 && cascade.after > cascade.before + 2 && cascade.plates >= 1,
  `s3 ${cascade?.before} → ${cascade?.after} за ${cascade?.hits} попаданий, панелей +${cascade?.plates}`);

// палубные доски: попадание СВЕРХУ ломает настил (без течи — выше ВЛ)
const deckHit = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const d0 = p.damageInfo();
  const leak0 = d0.leakRate;
  // точка НАД палубой в средней части (y выше кромки палубы)
  const hw = p.halfWidthAt(0.5);
  const lp = new T(hw * 0.3, 2.1, 0.6);
  for (let i = 0; i < 4; i++) p.hitHull(lp.clone(), 15, false, new T(0.2, 1, 0.1));
  g.stepDebugNR(0.3);
  const d1 = p.damageInfo();
  return JSON.stringify({
    deck0: d0.plankHull.deckBroken, deck1: d1.plankHull.deckBroken,
    leak0, leak1: d1.leakRate,
  });
})()`));
log(JSON.stringify(deckHit));
check('B8: попадание СВЕРХУ ломает ПАЛУБНЫЕ доски (без течи — выше ВЛ)',
  deckHit.deck1 > deckHit.deck0 && deckHit.leak1 <= deckHit.leak0 + 0.001,
  `палуба сломана ${deckHit?.deck0} → ${deckHit?.deck1}, течь ${deckHit?.leak0} → ${deckHit?.leak1}`);

run(`screenshot scripts/shots/t46_planks_damage.png`);
await sleep(1200);

// ============ C: ПИРАТЫ ОТВЕЧАЮТ ОГНЁМ ============
log('\n===== C: пираты логова отвечают (регрессия) =====');
const pirate = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  // якорная эскадра логова: залп накрывает несколько судов —
  // PROJECTILE_HIT срабатывает на каждом (тот же код, что и
  // обработчик события)
  const fleet = g.aiShips.filter(a => a.ship.flagKind === 'pirate' && a.state === 'anchored' && !a.ship.sunk);
  if (!fleet.length) return JSON.stringify({ err: 'no anchored pirates' });
  // 3 ближайших к нам якорных пирата (залп в гавань)
  const byDist = fleet.slice().sort((a, b) =>
    a.ship.position.distanceTo(p.position) - b.ship.position.distanceTo(p.position));
  const targets = byDist.slice(0, 3);
  const called = targets.length;
  for (const t of targets) t.onPlayerAggression(g.aiShips);
  // встать на траверзе ближайшего в 120 м: залпы пойдут по нам
  const target = targets[0];
  p.position.copy(target.ship.position).add(new T(120, 0, 0));
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  p.quaternion.setFromEuler(new window.__THREE.Euler(0, Math.PI / 2, 0));
  g.stepDebugNR(0.5);
  const rf0 = g.aiShips.filter(a => a.returnFire).length;
  const engaged0 = g.aiShips.filter(a => a.ship.crewEngage).length;
  const patrolCombat = g.aiShips.filter(a => a.state === 'combat').length;
  const ph0 = g.playerHitCount;
  g.stepDebugNR(40);
  const piratesRf = g.aiShips.filter(a => a.ship.flagKind === 'pirate' && a.returnFire)
    .slice(0, 6).map(a => a.ship.preset.id + '@' + Math.round(a.ship.position.distanceTo(p.position)) + 'м');
  return JSON.stringify({
    err: null,
    called, engaged0, rf0, patrolCombat,
    ph0, ph1: g.playerHitCount,
    piratesRf,
    patrolCombat1: g.aiShips.filter(a => a.state === 'combat').length,
    ourHull: +p.hullHP.toFixed(1), ourHullMax: p.hullMax,
    ourCrew: p.crew,
  });
})()`));
log(JSON.stringify(pirate));
check('C1: пираты после агрессии — returnFire (≥2 из залпа)',
  !pirate.err && pirate.rf0 >= 2, `returnFire у ${pirate?.rf0}/${pirate?.called} судов: ${JSON.stringify(pirate?.piratesRf)}`);
check('C2: экипаж пиратов ВЕДЁТ ОГОНЬ (crewEngage; ружья проснутся в 60 м)',
  !pirate.err && pirate.engaged0 >= 2, `crewEngage у ${pirate?.engaged0}`);
check('C3: залпы ДОШЛИ: попадания ПО игроку растут (playerHitCount)',
  !pirate.err && pirate.ph1 > pirate.ph0,
  `попаданий по нам ${pirate?.ph0} → ${pirate?.ph1}, корпус ${pirate?.ourHull}/${pirate?.ourHullMax}`);
check('C4: соседи по стоянке просыпаются (returnFire ≥ вызванного)',
  !pirate.err && pirate.rf0 >= pirate.called,
  `returnFire ${pirate?.rf0} ≥ вызвано ${pirate?.called}`);
check('C5: патрули переводятся в бой (state=combat)',
  !pirate.err && pirate.patrolCombat1 >= 1,
  `combat-судов ${pirate?.patrolCombat} → ${pirate?.patrolCombat1}`);
run(`screenshot scripts/shots/t46_pirates_battle.png`);
await sleep(1200);

// ============ D: ПОДМЕНА ПОГИБШИХ (КАРТЕЧЬ, ВКЛ. БЕЗОРУЖНЫХ) ============
log('\n===== D: подмена из трюма + правила в настройках =====');
// полигон: мишень fluyt; убиваем ВДОЛЬ диаметра картечью — гибнут
// и БЕЗОРУЖНЫЕ (капитан у штурвала, рулевой) — раньше не подменялись
const subst = jparse(await evR(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const p = g.player;
  const tgt = g.pgTarget.ship;
  const T = window.__THREE.Vector3;
  p.position.copy(tgt.position).add(new T(-35, 0, 0));
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  tgt.velocity.set(0, 0, 0);
  // высота ПАЛУБЫ — по видимым фигурам (минимум: главная палуба)
  const ys = tgt.crew3d.group.children.filter(c => c.visible).map(c => c.position.y);
  const deckY = ys.length ? Math.min(...ys) : 1.5;
  const shown0 = tgt.crew3d.shown;
  const res0 = tgt.crew3d.reservesInfo();
  const crew0 = tgt.crew;
  let killed = 0;
  // «картечь» вдоль ДП по всей палубе (как залп в упор с борта):
  // убывает экипаж — как в бою это делает CombatSystem
  for (let i = 0; i < 6; i++) {
    killed += tgt.crew3d.killNearPath(
      { x: 0, y: deckY + 1.0, z: 6 }, { x: 0, y: deckY + 0.9, z: -6 }, 'grape', 3, 2.6,
      tgt.position, tgt.quaternion);
  }
  tgt.crew = Math.max(0, tgt.crew - killed);
  g.stepDebugNR(16);
  const res1 = tgt.crew3d.reservesInfo();
  return JSON.stringify({
    deckY: +deckY.toFixed(2),
    killed, crew0, crew1: tgt.crew,
    shown0, shown1: tgt.crew3d.shown, res0, res1,
  });
})()`));
log(JSON.stringify(subst));
check('D1: «картечь» убила ≥6 (в т.ч. безоружных капитана/рулевого)',
  subst.killed >= 6, `убито ${subst?.killed} (экипаж ${subst?.crew0} → ${subst?.crew1})`);
check('D2: ПОДМЕНА: строй палубы восстановлен (живых + поднятие ≥ spares+остаток)',
  subst.shown1 >= Math.min(subst.shown0, 8) && subst.shown1 >= 5,
  `на палубе ${subst?.shown0} → ${subst?.shown1}`);
check('D3: замены подняты ИЗ ТРЮМА (spares убывают, заявок нет)',
  subst.res1.spares < subst.res0.spares && subst.res1.pending === 0,
  `${JSON.stringify(subst?.res0)} → ${JSON.stringify(subst?.res1)}`);

// правило «подмена» ВЫКЛ: палуба НЕ восстанавливается
const noSub = jparse(await evR(`(() => {
  const g = window.__game;
  window.__seaPatchSettings({ gameplay: { crewReplacement: false } });
  const tgt = g.pgTarget.ship;
  const ys = tgt.crew3d.group.children.filter(c => c.visible).map(c => c.position.y);
  const deckY = ys.length ? Math.min(...ys) : 1.5;
  const shown0 = tgt.crew3d.shown;
  const res0 = tgt.crew3d.reservesInfo();
  let killed = 0;
  for (let i = 0; i < 3; i++) {
    killed += tgt.crew3d.killNearPath(
      { x: 0, y: deckY + 1.0, z: 6 }, { x: 0, y: deckY + 0.9, z: -6 }, 'grape', 3, 2.6,
      tgt.position, tgt.quaternion);
  }
  tgt.crew = Math.max(0, tgt.crew - killed);
  g.stepDebugNR(12);
  const res1 = tgt.crew3d.reservesInfo();
  const shown1 = tgt.crew3d.shown;
  window.__seaPatchSettings({ gameplay: { crewReplacement: true } });
  return JSON.stringify({ killed, shown0, shown1, res0, res1 });
})()`));
log(JSON.stringify(noSub));
check('D4: подмена ВЫКЛ — новых НЕ поднимают (spares не тратится)',
  noSub.res1.spares === noSub.res0.spares && noSub.res1.pending === 0
  && noSub.shown1 < noSub.shown0,
  `палуба ${noSub?.shown0} → ${noSub?.shown1}, spares ${noSub?.res1?.spares}=${noSub?.res0?.spares}`);

// правило «стрелки» ВЫКЛ: ружья молчат (поза у борта остаётся)
const noGun = jparse(await evR(`(() => {
  const g = window.__game;
  window.__seaPatchSettings({ gameplay: { crewMarksmen: false } });
  const p = g.player;
  const tgt = g.pgTarget.ship;
  g.setPgReturnFire(true);
  if (g.pgTarget) g.pgTarget.gunTimer = 9999;   // пушки мишени заглушены
  p.lastHitT = p.simT;                          // мы «под обстрелом»
  tgt.lastHitT = tgt.simT;
  const pc0 = p.crew, tc0 = tgt.crew;
  const armed0 = tgt.crew3d.armedInfo();
  let minTCrouch = 99, minPCrouch = 99;
  for (let k = 0; k < 4; k++) {
    p.lastHitT = p.simT; tgt.lastHitT = tgt.simT;
    g.stepDebugNR(5);
    minTCrouch = Math.min(minTCrouch, tgt.crew3d.crouchedCount());
    minPCrouch = Math.min(minPCrouch, p.crew3d.crouchedCount());
  }
  const silence = { dOur: pc0 - p.crew, dTgt: tc0 - tgt.crew };
  // включаем обратно — перестрелка должна возобновиться (окно
  // «под обстрелом» обновляем каждые 5 с: иначе истекает за 14 с)
  window.__seaPatchSettings({ gameplay: { crewMarksmen: true } });
  for (let k = 0; k < 5; k++) {
    p.lastHitT = p.simT; tgt.lastHitT = tgt.simT;
    g.stepDebugNR(5);
  }
  const resume = { dOur: pc0 - p.crew, dTgt: tc0 - tgt.crew };
  g.setPgReturnFire(false);
  return JSON.stringify({ silence, resume, armed0, minTCrouch, minPCrouch });
})()`));
log(JSON.stringify(noGun));
check('D5: стрелки ВЫКЛ — ружья МОЛЧАТ (никто не погиб от пуль)',
  noGun.silence.dOur === 0 && noGun.silence.dTgt === 0,
  `наши −${noGun?.silence?.dOur}, цель −${noGun?.silence?.dTgt}`);
check('D6: поза у борта ОСТАЁТСЯ (укрытие, не агрессия)',
  noGun.minTCrouch >= 1 && noGun.minPCrouch >= 1,
  `на колене: цель ${noGun?.minTCrouch}, наши ${noGun?.minPCrouch}`);
check('D7: стрелки ВКЛ — перестрелка возобновилась (экипаж убыл)',
  noGun.resume.dOur >= 1 && noGun.resume.dTgt >= 1,
  `наши −${noGun?.resume?.dOur}, цель −${noGun?.resume?.dTgt}`);

// ============ E: МАЧТЫ — СЕГМЕНТЫ И ПАДЕНИЕ ВЕРХНИХ ============
log('\n===== E: мачты: отстык верхних сегментов =====');
// мутация — отдельным вызовом (телеметрия __sea обновляется на
// рендер-кадрах; данные читаем напрямую из объектов)
await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  // перелом грот-мачты (как от ядра/книппеля)
  p.breakMast(1);
  g.stepDebugNR(2);
  return 'ok';
})()`);
await sleep(400);
const mast = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  // прямые данные (не снапшот __sea): присоединённые сегменты
  const seg = p.visual.masts.map(m =>
    (m.userData.segments || []).filter(s => s.parent).length);
  const m1 = p.visual.masts[1];
  const segDetail = (m1.userData.segments || []).map(s => !!s.parent);
  const di = window.__seaDebrisInfo();
  return JSON.stringify({
    seg, segDetail, spar: di.byKind.spar, alive: di.alive,
    fall: p.mastFall,
  });
})()`));
log(JSON.stringify(mast));
check('E1: у сломанной мачты остались ТОЛЬКО нижние сегменты',
  mast.segDetail[0] === true && mast.segDetail[1] === false && mast.segDetail[2] === false,
  `грот-мачта: ${JSON.stringify(mast?.segDetail)} (все: ${JSON.stringify(mast?.seg)})`);
check('E2: верхние сегменты падают обломками SPAR (≥2 живых)',
  mast.spar >= 2 && mast.alive >= 2, `spar=${mast?.spar}, живых обломков=${mast?.alive}`);

// ============ F: НАСТРОЙКИ LIVE: дощатая ↔ обычная ============
log('\n===== F: модель корпуса в настройках (live) =====');
const swap = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  // → обычная
  window.__seaPatchSettings({ gameplay: { hullModel: 'smooth' } });
  g.stepDebugNR(0.3);
  const smooth = {
    model: window.__sea.model,
    planks: window.__sea.plankInfo,
    groups: window.__sea.hullHier.groups,
    // в обычном режиме возвращаются ДЕКАЛИ-ПРОБОИНЫ (legacy)
    holesAfter: (() => {
      p.hitHull(new T(2.4, 0.2, 2.0), 45, true, new T(1, 0.1, 0));
      return p.damageInfo().holes.length;
    })(),
  };
  // → дощатая обратно
  window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } });
  g.stepDebugNR(0.3);
  const planks = {
    model: window.__sea.model,
    fresh: window.__sea.plankInfo,
    holes: window.__sea.damage.holes.length,
  };
  // все корабли пересобраны: у пиратов доски тоже
  const piratePlanks = g.aiShips.filter(a => a.ship.flagKind === 'pirate')
    .slice(0, 3).map(a => a.ship.plankHull ? a.ship.plankHull.records.length : 0);
  return JSON.stringify({ smooth, planks, piratePlanks });
})()`));
log(JSON.stringify(swap));
check('F1: → обычная: модель smooth, досок нет (planks null)',
  swap.smooth.model === 'smooth' && swap.smooth.planks === null,
  JSON.stringify(swap?.smooth?.model));
check('F2: в обычном режиме вернулись ДЕКАЛИ-пробоины (legacy, holes>0)',
  swap.smooth.holesAfter > 0, `holes=${swap?.smooth?.holesAfter}`);
check('F3: → дощатая: свежие доски, круги снова убраны',
  swap.planks.model === 'planks' && swap.planks.fresh.s0 === swap.planks.fresh.total
  && swap.planks.holes === 0,
  `${swap?.planks?.fresh?.s0}/${swap?.planks?.fresh?.total}, holes=${swap?.planks?.holes}`);
check('F4: пересобраны ВСЕ корабли (у пиратов тоже доски)',
  swap.piratePlanks.length >= 3 && swap.piratePlanks.every(n => n > 100),
  JSON.stringify(swap?.piratePlanks));
const hierF = jparse(await evR(`(() => {
  const h = window.__sea.hullHier;
  return JSON.stringify({
    root: h.root, groups: h.groups,
    ok: h.root === 'Ship_Root' && ['Skeleton', 'Hull_Planks', 'Masts_And_Spars', 'Sails_And_Rigging', 'Props'].every(n => h.groups.includes(n)),
  });
})()`));
check('F5: иерархия сохраняется при пересборках (root Ship_Root + 5 групп)',
  hierF.ok === true, JSON.stringify(hierF?.groups));

// сохранение v16: перезагрузка — модель и правила из localStorage
const persist = jparse(await evR(`(() => {
  const raw = localStorage.getItem('seawolves.settings.v1');
  const s = raw ? JSON.parse(raw) : null;
  return JSON.stringify({
    v: s ? s.v : null,
    hullModel: s ? s.gameplay.hullModel : null,
    crewReplacement: s ? s.gameplay.crewReplacement : null,
    crewMarksmen: s ? s.gameplay.crewMarksmen : null,
  });
})()`));
log(JSON.stringify(persist));
check('F6: схема v16: hullModel/crewReplacement/crewMarksmen сохранены',
  persist.v === 16 && persist.hullModel === 'planks'
  && persist.crewReplacement === true && persist.crewMarksmen === true,
  JSON.stringify(persist));

run(`screenshot scripts/shots/t46_final.png`);
await sleep(1200);

// ============ G: ФИНАЛ ============
log('\n===== G: геометрия и ошибки =====');
const geo1 = jparse(await evR(`(() => {
  const g = window.__game.player;
  const counts = [];
  g.visual.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position
      && o.geometry.attributes.position.count > 500) {
      counts.push(o.geometry.attributes.position.count);
    }
  });
  const q = g.quaternion;
  const pos = g.position;
  return JSON.stringify({
    counts: counts.sort((a,b)=>b-a).slice(0,4),
    posFinite: isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z),
    qLen: +Math.sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w).toFixed(6),
  });
})()`));
log(JSON.stringify(geo1));
check('G1: позиция finite, кватернион нормирован',
  geo1.posFinite === true && Math.abs(geo1.qLen - 1) < 1e-5,
  `|q|=${geo1?.qLen}`);
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('G2: 0 ошибок JavaScript', Array.isArray(errs) && errs.length === 0);

log('\n========================================');
log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
log('========================================');
if (fails > 0) process.exit(1);
