// E2E Task 43: РАЗРУШАЕМОСТЬ КОРАБЛЕЙ.
//  (A) СТАДИЙНЫЕ ПРОБОИНЫ: вмятина → глубокая вмятина с трещинами →
//      ПРОБОИНА с видимыми внутренностями (бимсы/шпангоут/груз) и
//      разлётом щепы; повторные попадания расширяют пробоину
//  (B) РАЗЛОМ СЕКЦИИ: 3 пробоины одного борта в полосе 4.5 м —
//      вылом панели обшивки, дыры сливаются (масштаб ×1.8)
//  (C) ЗАТОПЛЕНИЕ ПО ОТСЕКАМ (4×2): вода прибывает в отсек места
//      попадания, перетекает к соседям, крен НА затопленный борт,
//      дифферент НА затопленный конец, осадка растёт, при 62% —
//      потопление с креном на борт воды и носом/кормой по отсекам
//  (D) ЭКИПАЖ: ружья 70% (50 м) / пистолеты 30% (20 м); под
//      обстрелом стрелки ПРИЖИМАЮТСЯ К БОРТУ НА ОДНО КОЛЕНО;
//      стреляют по противнику (урон экипажу/корпу цели). При
//      потоплении — ПРЫГАЮТ В ВОДУ, плывут, потом ТОНУТ
//  (E) ГЕОМЕТРИЯ НЕ НАРУШЕНА: вершинные счётчики корпуса до/после
//      залпов совпадают, кватернионы нормированы, координаты finite
//  (F) живой бой: залпы игрока по цели полигона → пробоины у цели,
//      щепы (debris), 0 ошибок JS + скриншоты
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
// ВНИМАНИЕ: //-комментарии вырезаются — они «съедали» код при склейке строк
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

// вершинные счётчики корпуса ДО
const geo0 = jparse(await evR(`(() => {
  const g = window.__game.player;
  const hullCounts = [];
  g.visual.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position
      && o.geometry.attributes.position.count > 500) {
      hullCounts.push(o.geometry.attributes.position.count);
    }
  });
  return JSON.stringify({ counts: hullCounts.sort((a,b)=>b-a).slice(0,3), n: hullCounts.length });
})()`));
log('корпус (мешей >500 верш.):', JSON.stringify(geo0));

// ============ A: СТАДИЙНЫЕ ПРОБОИНЫ ============
log('\n===== A: вмятина → трещины → пробоина =====');
const stages = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE;
  const hit = new T.Vector3(2.6, 0.15, 2.0);
  p.hitHull(hit.clone(), 10, true, new T.Vector3(1, 0.1, 0.2));
  const s1 = p.damageInfo();
  p.hitHull(hit.clone(), 12, true, new T.Vector3(1, 0.1, 0.2));
  const s2 = p.damageInfo();
  let visBefore = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) visBefore++; }); });
  p.hitHull(hit.clone(), 12, true, new T.Vector3(1, 0.1, 0.2));
  g.stepDebugNR(0.5);
  const s3 = p.damageInfo();
  let visAfter = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) visAfter++; }); });
  let innerMeshes = 0;
  if (p.hullHoles[0] && p.hullHoles[0].mesh) {
    p.hullHoles[0].mesh.traverse(o => { if (o.isMesh) innerMeshes++; });
  }
  const sc0 = p.hullHoles[0].mesh.scale.x;
  p.hitHull(hit.clone(), 14, true, new T.Vector3(1, 0.1, 0.2));
  const sc1 = p.hullHoles[0].mesh.scale.x;
  return JSON.stringify({
    s1: { stage: s1.holes[0]?.stage, n: s1.holes.length },
    s2: { stage: s2.holes[0]?.stage },
    s3: { stage: s3.holes[0]?.stage, breached: s3.holes[0]?.breached, innerMeshes,
      debrisJump: visAfter - visBefore, leak: s3.leakRate },
    widen: { sc0: +sc0.toFixed(3), sc1: +sc1.toFixed(3) },
  });
})()`));
log(JSON.stringify(stages));
check('A1: первый удар (урон 10) — ВМЯТИНА, стадия 1',
  stages.s1.stage === 1 && stages.s1.n === 1, `stage=${stages.s1?.stage}`);
check('A2: второй удар (накоплено 22) — глубокая вмятина, стадия 2',
  stages.s2.stage === 2, `stage=${stages.s2?.stage}`);
check('A3: третий удар (накоплено 34) — ПРОБОИНА, стадия 3',
  stages.s3.stage === 3 && stages.s3.breached === true, `stage=${stages.s3?.stage}`);
check('A4: в пробоине ВИДНЫ ВНУТРЕННОСТИ (задник+бимсы+шпангоут+груз+доски ≥ 9 мешей)',
  stages.s3.innerMeshes >= 9, `мешей в дыре: ${stages.s3?.innerMeshes}`);
check('A5: при пробитии — РАЗЛЁТ ЩЕПЫ (debris +8 и больше)',
  stages.s3.debrisJump >= 8, `+${stages.s3?.debrisJump} обломков`);
check('A6: пробоина ниже ватерлинии ДАЁТ ТЕЧЬ в трюм',
  stages.s3.leak > 0.05, `leak=${stages.s3?.leak} м³/с`);
check('A7: повторное попадание В дыру РАСШИРЯЕТ её',
  stages.widen.sc1 > stages.widen.sc0,
  `scale ${stages.widen?.sc0} → ${stages.widen?.sc1}`);

// ============ B: РАЗЛОМ СЕКЦИИ ============
log('\n===== B: разлом секции обшивки (3 пробоины в ряд) =====');
const split = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const spots = [[2.5, 0.1, 4.2], [2.5, 0.2, 5.2], [2.5, 0.0, 6.2]];
  for (const s of spots) p.hitHull(new T(s[0], s[1], s[2]), 30, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(1);
  const d = p.damageInfo();
  let wide = 0;
  for (const h of p.hullHoles) {
    if (h.mesh && h.mesh.scale) wide = Math.max(wide, h.mesh.scale.x);
  }
  let debrisN = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) debrisN++; }); });
  return JSON.stringify({
    breaches: d.holes.filter(h => h.breached).length,
    wide: +wide.toFixed(2),
    debris: debrisN,
  });
})()`));
log(JSON.stringify(split));
check('B1: 3 пробоины в одном ряду борта — ВЫЛОМ СЕКЦИИ (дыра ×1.8)',
  split.wide >= 1.7, `макс. масштаб дыры: ${split?.wide}`);
check('B2: щепы от разлетающейся секции (обломки в воде)',
  split.debris >= 20, `обломков: ${split?.debris}`);

// ============ C: ЗАТОПЛЕНИЕ ПО ОТСЕКАМ ============
log('\n===== C: вода в трюме по отсекам, крен и дифферент =====');
const flood1 = jparse(await evR(`(() => {
  const g = window.__game;
  g.stepDebugNR(12);
  const d = g.player.damageInfo();
  return JSON.stringify({
    comps: d.compartments,
    leakBias: d.leakBias, trimBias: d.trimBias,
    water: d.water, frac: +(d.water / d.holdCap).toFixed(3),
    floodRoll: +(g.player.floodRollCur * 57.3).toFixed(2),
    floodPitch: +(g.player.floodPitchCur * 57.3).toFixed(2),
    draft: +g.player.draftOff.toFixed(2),
  });
})()`));
log(JSON.stringify(flood1));
const portWater = (flood1.comps[3] || 0) + (flood1.comps[5] || 0) + (flood1.comps[7] || 0);
const starWater = (flood1.comps[2] || 0) + (flood1.comps[4] || 0) + (flood1.comps[6] || 0);
check('C1: вода пришла в ОТСЕКИ ПО МЕСТУ ПОПАДАНИЯ (порт-ряды 1-2 заполняются)',
  portWater > 0.5, `порт: ${portWater.toFixed(1)} м³, штирборт: ${starWater.toFixed(1)} м³`);
check('C2: вода у борта порта даёт КРЕНЯЩИЙ момент на порт (leakBias > 0)',
  flood1.leakBias > 0.02, `leakBias=${flood1?.leakBias}`);
check('C3: вода в носу даёт ДИФФЕРЕНТ на нос (trimBias > 0)',
  flood1.trimBias > 0.02, `trimBias=${flood1?.trimBias}`);
check('C4: статический КРЕН НА БОРТ ВОДЫ (floodRoll < −0.5°)',
  flood1.floodRoll < -0.5, `floodRoll=${flood1?.floodRoll}°`);
check('C5: ДИФФЕРЕНТ НОСОМ ВНИЗ (floodPitch > +0.2°)',
  flood1.floodPitch > 0.2, `floodPitch=${flood1?.floodPitch}°`);
check('C6: вода в трюме САЖАЕТ КОРАБЛЬ ГЛУБЖЕ (draft > 0.1 м)',
  flood1.draft > 0.1, `осадка +${flood1?.draft} м`);

// дотопление шагами по 5 с — остановиться ВСКОРЕ после начала гибели
const flood2 = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  let i = 0;
  while (!p.sinking && i++ < 18) g.stepDebugNR(5);
  const sinkingStarted = p.sinking;
  const fracAtSink = +(p.water / p.holdCap).toFixed(3);
  g.stepDebugNR(4);
  const d = p.damageInfo();
  return JSON.stringify({
    frac: fracAtSink, sinkingStarted,
    iters: i, sinkT: d.sinkT,
    roll: +(p.euler.z * 57.3).toFixed(1),
    pitch: +(p.euler.x * 57.3).toFixed(1),
    comps: d.compartments,
  });
})()`));
log(JSON.stringify(flood2));
check('C7: трюм заполнился до порога — корабль ТОНЕТ',
  flood2.sinkingStarted === true, `frac=${flood2?.frac}, итераций: ${flood2?.iters}`);
check('C8: тонет С КРЕНОМ (|roll| > 8° к моменту гибели)',
  Math.abs(flood2.roll) > 8, `roll=${flood2?.roll}°`);

// ============ D: ПЛОВЦЫ ============
log('\n===== D: матросы прыгают в воду и тонут =====');
const swim = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  g.stepDebugNR(6);
  const s1 = p.crew3d.swimmersAlive();
  g.stepDebugNR(40);
  const s2 = p.crew3d.swimmersAlive();
  return JSON.stringify({ swimNow: s1, swimLater: s2 });
})()`));
log(JSON.stringify(swim));
check('D1: при потоплении матросы ПРЫГНУЛИ ЗА БОРТ (пловцы ≥ 2)',
  swim.swimNow >= 2, `пловцов: ${swim?.swimNow}`);
check('D2: пловцы ТОНУТ (через 46 с в воде остались не все)',
  swim.swimLater < swim.swimNow, `было ${swim?.swimNow} → осталось ${swim?.swimLater}`);

// ============ E: ГЕОМЕТРИЯ НЕ НАРУШЕНА ============
log('\n===== E: геометрия кораблей после разрушений =====');
const geo1 = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const hullCounts = [];
  p.visual.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position
      && o.geometry.attributes.position.count > 500) {
      hullCounts.push(o.geometry.attributes.position.count);
    }
  });
  const q = p.quaternion;
  const pos = p.position;
  return JSON.stringify({
    counts: hullCounts.sort((a,b)=>b-a).slice(0,3),
    posFinite: isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z),
    qLen: +Math.sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w).toFixed(6),
  });
})()`));
log(JSON.stringify(geo1));
check('E1: вершинные счётчики корпуса ИЗМЕНИЛИСЬ ТОЛЬКО деколями (крупные меши те же)',
  JSON.stringify(geo1.counts) === JSON.stringify(geo0.counts),
  `до: ${JSON.stringify(geo0?.counts)}, после: ${JSON.stringify(geo1?.counts)}`);
check('E2: позиция корабля finite (нет NaN)',
  geo1.posFinite === true);
check('E3: кватернион нормирован (|q| = 1 ± 1e-5)',
  Math.abs(geo1.qLen - 1) < 1e-5, `|q|=${geo1?.qLen}`);

// ============ F: ЖИВОЙ БОЙ ============
log('\n===== F: залпы по цели полигона + стрелки =====');
const battle = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  p.clearDamage();
  p.position.set(5000, 0, 7100);
  p.velocity.set(0, 0, 0);
  const tgt = g.combat.others.find(o => !o.sunk && !o.sinking && !o.surrendered);
  tgt.clearDamage();
  const T = window.__THREE.Vector3;
  tgt.position.copy(p.position).add(new T(0, 0, 130));
  tgt.velocity.set(0, 0, 0);
  tgt.noSurrender = true;
  tgt.surrendered = false;
  const c0 = [];
  tgt.visual.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position
      && o.geometry.attributes.position.count > 500) c0.push(o.geometry.attributes.position.count);
  });
  for (let i = 0; i < 6; i++) {
    g.combat.aiBallVolley(p, tgt);
    g.stepDebugNR(4.5);
  }
  const d = tgt.damageInfo();
  const geoAfterVolley = c0.slice().sort((a,b)=>b-a);
  tgt.clearDamage();
  tgt.position.copy(p.position).add(new T(0, 0, 38));
  tgt.noSurrender = true;
  p.applyDamage({ kind: 'ball', amount: 4, hitPoint: p.position.clone() });
  g.stepDebugNR(3);
  const crouched = p.crew3d.crouchedCount();
  const armed = p.crew3d.armedInfo();
  const tgtHull0 = tgt.hullHP, tgtCrew0 = tgt.crew;
  g.stepDebugNR(18);
  const c1 = [];
  tgt.visual.group.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position
      && o.geometry.attributes.position.count > 500) c1.push(o.geometry.attributes.position.count);
  });
  const c1s = c1.slice().sort((a,b)=>b-a);
  const topSame = JSON.stringify(geoAfterVolley.slice(0,3)) === JSON.stringify(c1s.slice(0,3))
    && c1s.length >= 3;
  let debrisN = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) debrisN++; }); });
  return JSON.stringify({
    volleys: { holes: d.holes.length, breached: d.holes.filter(h => h.breached).length,
      stages: d.holes.map(h => h.stage) },
    tgtWater: +d.water.toFixed(2),
    debris: debrisN,
    armed, crouched,
    smallArms: { dHull: +(tgtHull0 - tgt.hullHP).toFixed(1), dCrew: tgtCrew0 - tgt.crew },
    tgtGeo: { topSame, before: geoAfterVolley.slice(0,3), after: c1s.slice(0,3) },
  });
})()`));
log(JSON.stringify(battle));
check('F1: залпы игрока ПРОБИВАЮТ борт цели (пробоины есть)',
  battle.volleys.holes >= 1 && battle.volleys.breached >= 1,
  `дыр: ${battle?.volleys?.holes}, пробоин: ${battle?.volleys?.breached}, стадии: ${JSON.stringify(battle?.volleys?.stages)}`);
check('F2: щепы от пробоин летят в воду (debris > 15)',
  battle.debris > 15, `обломков: ${battle?.debris}`);
check('F3: экипаж вооружён: ружья ≈70% / пистолеты ≈30% (musket ≥ 2, всего ≥ 4)',
  battle.armed.musket >= 2 && (battle.armed.musket + battle.armed.pistol) >= 4,
  JSON.stringify(battle?.armed));
check('F4: под обстрелом стрелки НА КОЛЕНЕ У БОРТА (crouched ≥ 2)',
  battle.crouched >= 2, `на колене: ${battle?.crouched}`);
check('F5: стрелки ведут огонь по цели (урон корпусу от пуль > 0)',
  battle.smallArms.dHull > 0, `dHull=${battle?.smallArms?.dHull}, dCrew=${battle?.smallArms?.dCrew}`);
check('F6: ГЕОМЕТРИЯ ЦЕЛИ не нарушена (крупные меши корпуса целы)',
  battle.tgtGeo.topSame === true,
  `крупные: ${JSON.stringify(battle?.tgtGeo?.before)} → ${JSON.stringify(battle?.tgtGeo?.after)}`);

// ============ G: финал ============
log('\n===== G: финал =====');
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('G1: 0 ошибок JavaScript', Array.isArray(errs) && errs.length === 0);

run(`screenshot scripts/shots/t43_battle_holes.png`);
await sleep(1200);
run(`screenshot scripts/shots/t43_final.png`);
await sleep(800);

log('\n========================================');
log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
log('========================================');
if (fails > 0) process.exit(1);
