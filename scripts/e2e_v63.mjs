// E2E Task 45: РАЗРУШЕНИЕ ПО ЗАМЫСЛУ ИГРОКА.
//  (A) ДАЛЬНИЕ ДЕРЕВЬЯ — ПРОСТАЯ ПЛОСКАЯ модель (пара скрещенных
//      квадов, 4-12 треугольников на дерево вместо 100-400)
//  (B) КОРПУС ИЗ ДОСОК: текстура борта — пояса досок с конопачеными
//      швами, стыками в разбежку и гвоздями (шов темнее середины доски)
//  (C) РАЗРУШЕНИЕ ОТ НЕСКОЛЬКИХ ПОПАДАНИЙ: вмятина → глубокая
//      вмятина → ПРОБОИНА (только с 3-го попадания в зону!) →
//      расширение; 3 пробоины в полосе 4.5 м — ВЫЛОМ СЕКЦИИ
//  (D) МУШКЕТЫ НЕ ЛОМАЮТ КОРАБЛЬ: перестрелка на 35 м — корпус
//      ОБЕИХ кораблей не страдает (0 урона/пробоин/течи), гибнут
//      ТОЛЬКО матросы; погибшие у борта ПОДМЕНЯЮТСЯ живыми из
//      трюма (поднимаются из люка на пост); при исчерпании экипажа
//      строй редеет. Матросы при атаке ВЫСТРАИВАЮТСЯ ВДОЛЬ БОРТА
//      (на колене за фальшбортом) и стреляют ОТТУДА
//  (E) ПРОБОИНА → ЗАТОПЛЕНИЕ: вода приходит «потихоньку», крен
//      НА пробитый борт, дифферент на затопленный конец, потом
//      потопление с креном и прыжки матросов за борт
//  (F) геометрия кораблей не нарушена + 0 ошибок JS + скриншоты
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
// Task 46: легаси-тест стадийных ПРОБОИН — на ОБЫЧНОЙ модели
// (по умолчанию теперь дощатая: урон идёт ДОСКАМ, holes пуст)
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'smooth' } })`);
await sleep(1500);
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

// ============ A: ДАЛЬНИЕ ДЕРЕВЬЯ — ПЛОСКИЕ ============
log('\n===== A: далёкие деревья — простая плоская модель =====');
// телепорт в открытое море ЗА 900+ м от БЕРЕГА острова гавани (но
// в пределах видимости): острова становятся ДАЛЬНИМИ и переводятся
// на плоские модели (LOD-порог 700 м от берега, гистерезис 600)
const trees = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const isl0 = g.world.islands[0];
  // ищем точку в глубокой воде (глубже -8 м) не ближе 900 м к БЕРЕГУ
  let target = null;
  for (let ai = 0; ai < 20 && !target; ai++) {
    const a = (ai / 20) * Math.PI * 2;
    let rr = isl0.r + 900;
    for (let t = 0; t < 40; t++) {
      const x = isl0.cx + Math.cos(a) * rr;
      const z = isl0.cz + Math.sin(a) * rr;
      if (p.terrainHeight(x, z) < -8) { target = { x, z }; break; }
      rr += 150;
    }
  }
  if (!target) return JSON.stringify({ err: 'no sea point' });
  p.position.set(target.x, 0, target.z);
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(2);
  const t = g.world.treeLodInfo();
  return JSON.stringify({
    farIslands: t.farIslands, nearIslands: t.nearIslands,
    lodSlots: t.lodSlots, trisFull: t.trisFull, trisLod: t.trisLod,
    kinds: t.kinds,
  });
})()`));
log(JSON.stringify(trees));
check('A1: остров гавани переведён на плоские модели (far ≥ 1, слотов ≥ 5)',
  !trees.err && trees.farIslands >= 1 && trees.lodSlots >= 5,
  `far=${trees?.farIslands}, слотов=${trees?.lodSlots}, плоских треугольников=${trees?.trisLod}`);
check('A2: пальма на дальнем острове — ПЛОСКАЯ (≤ 16 треугольников)',
  (trees.kinds?.palm?.lod ?? 999) <= 16, `palm lod=${trees?.kinds?.palm?.lod} трис`);
check('A3: куст плоский (≤ 8), фикус/джунгли/бамбук ≤ 16',
  (trees.kinds?.bush?.lod ?? 999) <= 8
  && (trees.kinds?.ficus?.lod ?? 999) <= 16
  && (trees.kinds?.jungle?.lod ?? 999) <= 16
  && (trees.kinds?.bamboo?.lod ?? 999) <= 16,
  JSON.stringify(trees?.kinds));
check('A4: плоские модели дешевле полных (trisLod < 25% trisFull)',
  !trees.err && trees.trisFull > 0 && trees.trisLod < trees.trisFull * 0.25,
  `полная ${trees?.trisFull} → плоская ${trees?.trisLod} трис`);
run(`screenshot scripts/shots/t45_flat_trees.png`);
await sleep(1200);

// ============ B: КОРПУС ИЗ ДОСОК ============
log('\n===== B: обшивка досками — текстура борта =====');
const planks = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  let hullMesh = null;
  p.visual.group.traverse(o => {
    // меш КОЖУХА борта: единственный с metalnessMap (золото) + карта цвета
    if (!hullMesh && o.isMesh && o.material && o.material.map
      && o.material.map.image && o.material.metalnessMap) hullMesh = o;
  });
  if (!hullMesh) return JSON.stringify({ err: 'no hull mesh' });
  const cv = hullMesh.material.map.image;
  const x = cv.getContext('2d');
  const P = p.preset;
  const B = P.beam;
  const vMin = (-P.draft - 0.4) / B, vMax = (P.freeboard * 1.18) / B;
  const H = cv.height, W = cv.width;
  const py = (y) => Math.round((1 - ((y / B) - vMin) / (vMax - vMin)) * H);
  // пояс досок: [1.36 .. 1.70] м; шов — верх пояса (1.70), середина доски 1.53
  const seamY = py(1.70);
  const midY = py(1.53);
  const at = (yy, xx) => {
    const d = x.getImageData(Math.max(0, Math.min(W - 1, xx)), Math.max(0, Math.min(H - 1, yy)), 1, 1).data;
    return (d[0] + d[1] + d[2]) / 3;
  };
  const xs = [Math.round(W * 0.34), Math.round(W * 0.5), Math.round(W * 0.68)];
  const midBr = Math.max(...xs.map(xx => at(midY, xx)));
  const seamDr = Math.min(...xs.map(xx => at(seamY, xx)));
  return JSON.stringify({
    W, H, seamY, midY, midBr: +midBr.toFixed(1), seamDr: +seamDr.toFixed(1),
    diff: +(midBr - seamDr).toFixed(1),
  });
})()`));
log(JSON.stringify(planks));
check('B1: на карте борта есть пояс досок (меш корпуса с картой найден)',
  !planks.err, JSON.stringify(planks));
check('B2: ШВЫ ТЕМНЕЕ СЕРДИВИНЫ ДОСКИ (шов − середина > 12 ярк.)',
  !planks.err && planks.diff > 12,
  `шов ${planks?.seamDr} против доски ${planks?.midBr} (Δ${planks?.diff})`);

// ============ D: МУШКЕТЫ НЕ ЛОМАЮТ КОРАБЛЬ + ПОДМЕНА ============
log('\n===== D: перестрелка матросов: корпус цел, гибнут люди =====');
// полигон: мишень на якоре, ответный огонь ВКЛ, пушки мишени
// заглушены (gunTimer=9999) — стреляют ТОЛЬКО мушкеты
const prep = jparse(await evR(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.setPgReturnFire(true);
  if (g.pgTarget) g.pgTarget.gunTimer = 9999;
  const p = g.player;
  const tgt = g.pgTarget.ship;
  const T = window.__THREE.Vector3;
  p.position.copy(tgt.position).add(new T(-35, 0, 0));
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  tgt.velocity.set(0, 0, 0);
  return JSON.stringify({
    dist: +p.position.distanceTo(tgt.position).toFixed(1),
    pCrew: p.crew, tCrew: tgt.crew,
    pHull: +p.hullHP.toFixed(2), tHull: +tgt.hullHP.toFixed(2),
    pShown: p.crew3d.shown, tShown: tgt.crew3d.shown,
    pRes: p.crew3d.reservesInfo(), tRes: tgt.crew3d.reservesInfo(),
  });
})()`));
log(JSON.stringify(prep));
check('D0: мишень готова (35 м, у обоих есть экипаж)',
  prep.dist > 20 && prep.dist < 50 && prep.pCrew > 5 && prep.tCrew > 5,
  `dist=${prep?.dist} м, экипаж ${prep?.pCrew}/${prep?.tCrew}`);

// 30 с перестрелки с повторной «пришвартовкой» каждые 5 с
const duel = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const tgt = g.pgTarget.ship;
  const T = window.__THREE.Vector3;
  const pHull0 = p.hullHP, tHull0 = tgt.hullHP;
  const pCrew0 = p.crew, tCrew0 = tgt.crew;
  let minCrouched = 99, minTCrouched = 99;
  let maxShown = 0, maxTShown = 0;
  for (let k = 0; k < 6; k++) {
    p.position.copy(tgt.position).add(new T(-35, 0, 0));
    p.position.y = 0;
    p.velocity.set(0, 0, 0);
    tgt.velocity.set(0, 0, 0);
    p.lastHitT = p.simT;
    g.stepDebugNR(5);
    minCrouched = Math.min(minCrouched, p.crew3d.crouchedCount());
    minTCrouched = Math.min(minTCrouched, tgt.crew3d.crouchedCount());
    maxShown = Math.max(maxShown, p.crew3d.shown);
    maxTShown = Math.max(maxTShown, tgt.crew3d.shown);
  }
  const d = p.damageInfo();
  const td = tgt.damageInfo();
  return JSON.stringify({
    dHull: +(pHull0 - p.hullHP).toFixed(3), dTHull: +(tHull0 - tgt.hullHP).toFixed(3),
    dCrew: pCrew0 - p.crew, dTCrew: tCrew0 - tgt.crew,
    pHoles: d.holes.length, tHoles: td.holes.length,
    pWater: d.water, tWater: td.water,
    minCrouched, minTCrouched, maxShown, maxTShown,
    pRes: p.crew3d.reservesInfo(), tRes: tgt.crew3d.reservesInfo(),
    pShown: p.crew3d.shown, tShown: tgt.crew3d.shown,
  });
})()`));
log(JSON.stringify(duel));
check('D1: КОРПУС ИГРОКА НЕ РАЗРУШЕН от мушкетов (ΔHP = 0)',
  duel.dHull === 0, `Δ=${duel?.dHull}`);
check('D2: КОРПУС ЦЕЛИ НЕ РАЗРУШЕН от мушкетов (ΔHP = 0)',
  duel.dTHull === 0, `Δ=${duel?.dTHull}`);
check('D3: НЕТ пробоин и воды у обоих (holes=0, water=0)',
  duel.pHoles === 0 && duel.tHoles === 0 && duel.pWater === 0 && duel.tWater === 0,
  `игрок: дыр ${duel?.pHoles}, вода ${duel?.pWater}; цель: дыр ${duel?.tHoles}, вода ${duel?.tWater}`);
check('D4: МАТРОСЫ ГИБНУТ (экипаж обоих убыл)',
  duel.dCrew >= 1 && duel.dTCrew >= 1,
  `игрок −${duel?.dCrew}, цель −${duel?.dTCrew}`);
check('D5: СТРОЙ ВДОЛЬ БОРТА: на колене у борта (у обоих кораблей)',
  duel.minCrouched >= 1 && duel.minTCrouched >= 2,
  `игрок на колене ${duel?.minCrouched}, цель ${duel?.minTCrouched}`);

// детерминированная ПОДМЕНА: 5 погибших со стороны противника
// (в приоритете — стрелки в линии у борта) → замены из трюма.
// СНАЧАЛА выключаем ответный огонь мишени — перестрелка окончена
const subst = jparse(await evR(`(() => {
  const g = window.__game;
  g.setPgReturnFire(false);
  const p = g.player;
  const T = window.__THREE.Vector3;
  const shown0 = p.crew3d.shown;
  const res0 = p.crew3d.reservesInfo();
  const crew0 = p.crew;
  const hull0 = p.hullHP;
  // направление с борта мишени: пули снимают стрелков в линии у борта
  const dir = new T().copy(g.pgTarget.ship.position).sub(p.position).normalize();
  let killed = 0;
  for (let i = 0; i < 5; i++) killed += p.smallArmsHit(dir);
  g.stepDebugNR(10);
  const res1 = p.crew3d.reservesInfo();
  const shown1 = p.crew3d.shown;
  return JSON.stringify({
    killed, crew0, crew1: p.crew,
    shown0, shown1, res0, res1,
    dHull: +(hull0 - p.hullHP).toFixed(3),
    crouched: p.crew3d.crouchedCount(),
  });
})()`));
log(JSON.stringify(subst));
check('D6: ПОДМЕНА: 5 погибших заменены (на палубе снова полный строй)',
  subst.killed >= 5 && subst.shown1 >= Math.min(subst.shown0, 9),
  `было ${subst?.shown0} → стало ${subst?.shown1}`);
check('D7: замены подняты ИЗ ТРЮМА (запас уменьшился, заявки закрыты)',
  subst.res1.spares < subst.res0.spares && subst.res1.pending === 0,
  `запасы: ${JSON.stringify(subst?.res0)} → ${JSON.stringify(subst?.res1)}`);
check('D8: при подмене корпус по-прежнему ЦЕЛ (ΔHP = 0)',
  subst.dHull === 0, `Δ=${subst?.dHull}`);

// исчерпание экипажа: залпы в упор, пока есть кого снимать
const exhaust = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  let total = 0;
  for (let i = 0; i < 80; i++) {
    const k = p.smallArmsHit();
    if (k <= 0) break;
    total += k;
  }
  g.stepDebugNR(8);
  const res = p.crew3d.reservesInfo();
  return JSON.stringify({
    total, crew: p.crew,
    shown: p.crew3d.shown, crouched: p.crew3d.crouchedCount(),
    res,
    holes: p.damageInfo().holes.length,
    water: p.damageInfo().water,
  });
})()`));
log(JSON.stringify(exhaust));
check('D9: исчерпание экипажа — палуба РЕДЕЕТ (shown ≤ 4)',
  exhaust.shown <= 4, `на палубе ${exhaust?.shown}, всего убито ${exhaust?.total}`);
check('D10: резервы пусты (below = 0, заявок нет)',
  exhaust.res.below === 0 && exhaust.res.pending === 0,
  JSON.stringify(exhaust?.res));
check('D11: даже расстрел экипажа НЕ трогает корпус (holes = 0)',
  exhaust.holes === 0 && exhaust.water === 0,
  `дыр ${exhaust?.holes}, воды ${exhaust?.water}`);

// экипаж к затоплению: вернуть (для прыжков за борт в секции E)
evR(`(() => {
  const g = window.__game;
  const p = g.player;
  p.crew = Math.round(p.preset.maxCrew * 0.8);
  p.crew3d.reset();
  return 'reset';
})()`);

// ============ C: РАЗРУШЕНИЕ ОТ НЕСКОЛЬКИХ ПОПАДАНИЙ ============
log('\n===== C: зоны обшивки: вмятина → глубокая → пробоина =====');
const stages = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const hit = new T(2.6, 0.15, 2.0);
  // 1-е попадание ядром (урон 15): вмятина
  p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
  const s1 = p.damageInfo();
  // 2-е попадание (накоплено 30): глубокая вмятина
  p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
  const s2 = p.damageInfo();
  // 3-е попадание (накоплено 45): ПРОБОИНА
  let visBefore = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) visBefore++; }); });
  p.hitHull(hit.clone(), 15, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(0.5);
  const s3 = p.damageInfo();
  let visAfter = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) visAfter++; }); });
  let innerMeshes = 0;
  if (p.hullHoles[0] && p.hullHoles[0].mesh) {
    p.hullHoles[0].mesh.traverse(o => { if (o.isMesh) innerMeshes++; });
  }
  const sc0 = p.hullHoles[0].mesh.scale.x;
  const dmg0 = p.hullHoles[0].dmg;
  // 4-е и 5-е попадания В пробоину (по 30): расширение + вырыв панели (≥60)
  p.hitHull(hit.clone(), 30, true, new T(1, 0.1, 0.2));
  p.hitHull(hit.clone(), 30, true, new T(1, 0.1, 0.2));
  const s5 = p.damageInfo();
  const sc1 = p.hullHoles[0].mesh.scale.x;
  return JSON.stringify({
    s1: { stage: s1.holes[0]?.stage, n: s1.holes.length, water: s1.water, leak: s1.leakRate },
    s2: { stage: s2.holes[0]?.stage, water: s2.water, leak: s2.leakRate },
    s3: { stage: s3.holes[0]?.stage, breached: s3.holes[0]?.breached,
      innerMeshes, debrisJump: visAfter - visBefore, leak: s3.leakRate },
    widen: { sc0: +sc0.toFixed(3), sc1: +sc1.toFixed(3),
      wide: s5.holes[0]?.wide, dmg: s5.holes[0]?.dmg },
  });
})()`));
log(JSON.stringify(stages));
check('C1: 1-е попадание — ВМЯТИНА (стадия 1), воды НЕТ',
  stages.s1.stage === 1 && stages.s1.water === 0 && stages.s1.leak === 0,
  `stage=${stages.s1?.stage}, вода=${stages.s1?.water}, течь=${stages.s1?.leak}`);
check('C2: 2-е попадание — ГЛУБОКАЯ ВМЯТИНА (стадия 2), воды всё ещё нет',
  stages.s2.stage === 2 && stages.s2.water === 0 && stages.s2.leak === 0,
  `stage=${stages.s2?.stage}`);
check('C3: 3-е попадание — ПРОБОИНА (стадия 3, breached)',
  stages.s3.stage === 3 && stages.s3.breached === true,
  `stage=${stages.s3?.stage}`);
check('C4: в пробоине видны ВНУТРЕННОСТИ (≥ 9 мешей) + разлёт щепы',
  stages.s3.innerMeshes >= 9 && stages.s3.debrisJump >= 8,
  `мешей ${stages.s3?.innerMeshes}, +${stages.s3?.debrisJump} обломков`);
check('C5: пробоина ниже ватерлинии ДАЁТ ТЕЧЬ (с 3-го попадания, не раньше)',
  stages.s3.leak > 0.05 && stages.s2.leak === 0,
  `течь=${stages.s3?.leak} м³/с`);
check('C6: повторные попадания В дыру РАСШИРЯЮТ её (панель ≥ 60 вырвана)',
  stages.widen.sc1 > stages.widen.sc0 * 1.1 && stages.widen.wide === true,
  `scale ${stages.widen?.sc0} → ${stages.widen?.sc1}, wide=${stages.widen?.wide}, dmg=${stages.widen?.dmg}`);

// разлом секции: ещё 2 пробоины в полосе 4.5 м того же борта
const split = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const before = p.damageInfo().holes.length;
  p.hitHull(new T(2.6, 0.10, 4.0), 45, true, new T(1, 0.1, 0));
  p.hitHull(new T(2.6, 0.08, 6.0), 45, true, new T(1, 0.1, 0));
  g.stepDebugNR(1);
  let wide = 0;
  for (const h of p.hullHoles) {
    if (h.mesh && h.mesh.scale) wide = Math.max(wide, h.mesh.scale.x);
  }
  let debrisN = 0;
  g.scene.traverse(o => { if (o.name === 'debris') o.children.forEach(c => { if (c.visible) debrisN++; }); });
  return JSON.stringify({
    before, after: p.damageInfo().holes.length,
    breaches: p.damageInfo().holes.filter(h => h.breached).length,
    wide: +wide.toFixed(2), debris: debrisN,
  });
})()`));
log(JSON.stringify(split));
check('C7: 3 пробоины в полосе 4.5 м — ВЫЛОМ СЕКЦИИ (дыра ×1.8)',
  split.wide >= 1.7, `макс. масштаб ${split?.wide}`);
check('C8: щепы и доски от разлома летят в воду',
  split.debris >= 15, `обломков: ${split?.debris}`);

// ============ E: ЗАТОПЛЕНИЕ С КРЕНОМ НА ПРОБИТЫЙ БОРТ ============
log('\n===== E: вода «потихоньку», крен на пробитую дыру =====');
const flood1 = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const w0 = p.water;
  g.stepDebugNR(5);
  const w1 = p.water;
  g.stepDebugNR(5);
  const w2 = p.water;
  g.stepDebugNR(5);
  const d = p.damageInfo();
  return JSON.stringify({
    w0: +w0.toFixed(2), w1: +w1.toFixed(2), w2: +w2.toFixed(2),
    comps: d.compartments,
    leakBias: d.leakBias, trimBias: d.trimBias,
    frac: +(d.water / d.holdCap).toFixed(3),
    floodRoll: +(p.floodRollCur * 57.3).toFixed(2),
    floodPitch: +(p.floodPitchCur * 57.3).toFixed(2),
    draft: +p.draftOff.toFixed(2),
  });
})()`));
log(JSON.stringify(flood1));
const portWater = (flood1.comps[3] || 0) + (flood1.comps[5] || 0) + (flood1.comps[7] || 0);
const starWater = (flood1.comps[2] || 0) + (flood1.comps[4] || 0) + (flood1.comps[6] || 0);
check('E1: вода прибывает ПОСТЕПЕННО (w0 < w1 < w2)',
  flood1.w0 < flood1.w1 && flood1.w1 < flood1.w2,
  `${flood1?.w0} → ${flood1?.w1} → ${flood1?.w2} м³`);
check('E2: вода в отсеках ПО МЕСТУ ПРОБОИН (порт-носовые ряды)',
  portWater > 0.5 && portWater > starWater,
  `порт ${portWater.toFixed(1)} / штирборт ${starWater.toFixed(1)} м³`);
check('E3: кренящий момент НА ПРОБИТЫЙ БОРТ (leakBias > 0 — порт)',
  flood1.leakBias > 0.02, `leakBias=${flood1?.leakBias}`);
check('E4: ДИФФЕРЕНТ на затопленный нос (trimBias > 0)',
  flood1.trimBias > 0.02, `trimBias=${flood1?.trimBias}`);
check('E5: КРЕН НА ПРОБИТУЮ ДЫРУ (floodRoll < −0.3°, валит на порт)',
  flood1.floodRoll < -0.3, `floodRoll=${flood1?.floodRoll}°`);
check('E6: ДИФФЕРЕНТ НОСОМ ВНИЗ (floodPitch > +0.15°)',
  flood1.floodPitch > 0.15, `floodPitch=${flood1?.floodPitch}°`);

// дотопление до гибели + прыжки за борт
const flood2 = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  let i = 0;
  while (!p.sinking && i++ < 24) g.stepDebugNR(5);
  const sinkingStarted = p.sinking;
  const fracAtSink = +(p.water / p.holdCap).toFixed(3);
  g.stepDebugNR(5);
  const swim1 = p.crew3d.swimmersAlive();
  g.stepDebugNR(40);
  const swim2 = p.crew3d.swimmersAlive();
  return JSON.stringify({
    fracAtSink, sinkingStarted, iters: i,
    roll: +(p.euler.z * 57.3).toFixed(1),
    pitch: +(p.euler.x * 57.3).toFixed(1),
    swim1, swim2,
  });
})()`));
log(JSON.stringify(flood2));
check('E7: трюм заполнился — корабль ТОНЕТ',
  flood2.sinkingStarted === true, `frac=${flood2?.fracAtSink}, итераций ${flood2?.iters}`);
check('E8: тонет С КРЕНОМ НА ПРОБИТЫЙ БОРТ (|roll| > 8°)',
  Math.abs(flood2.roll) > 8, `roll=${flood2?.roll}°`);
check('E9: матросы ПРЫГАЮТ ЗА БОРТ и ТОНУТ',
  flood2.swim1 >= 2 && flood2.swim2 < flood2.swim1,
  `пловцов ${flood2?.swim1} → ${flood2?.swim2}`);
run(`screenshot scripts/shots/t45_sinking_list.png`);
await sleep(1200);

// ============ F: ФИНАЛ ============
log('\n===== F: геометрия и ошибки =====');
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
check('F1: крупные меши корпуса НЕ пересоздаются (декали поверх)',
  JSON.stringify(geo1.counts) === JSON.stringify(geo0.counts),
  `до: ${JSON.stringify(geo0?.counts)} / после: ${JSON.stringify(geo1?.counts)}`);
check('F2: позиция finite, кватернион нормирован',
  geo1.posFinite === true && Math.abs(geo1.qLen - 1) < 1e-5,
  `|q|=${geo1?.qLen}`);

const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('F3: 0 ошибок JavaScript', Array.isArray(errs) && errs.length === 0);

run(`screenshot scripts/shots/t45_battle_posts.png`);
await sleep(1200);
run(`screenshot scripts/shots/t45_planks.png`);
await sleep(800);

log('\n========================================');
log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
log('========================================');
if (fails > 0) process.exit(1);
