// E2E Task 47: ОБШИВКА ВНАКРОЙ + ПАЛУБА ВДОЛЬ + ТРАНЕЦ + КВАРТЕРДЕК
//  + НАСТРОЙКИ «КОРАБЛИ» (прочность досок, урон ядер, живучесть)
//  (A) палуба: доски ПЛАШМЯ и ВДОЛЬ корабля, БЕЗ щелей (нахлёсты
//      колонок и стыков), кромка под обшивкой борта
//  (B) борта: пояса ВНАКРОЙ — шаг поясов < высоты доски (нахлёст),
//      наклон поясья (нижняя кромка наружу), стыки без щелей
//  (C) ТРАНЕЦ: 4-й меш Planks_Transom, пояса закрывают корму от
//      среза до планширя на всю ширину; попадание в корму ломает
//      ДОСКИ ТРАНЦА (не борта); ниже ВЛ — течь
//  (D) КВАРТЕРДЕК: у судов с надстройкой настил из досок на своём
//      уровне (флейт), доски ВДОЛЬ
//  (E) НАСТРОЙКИ «⛵ Корабли»: вкладка в панели; прочность досок
//      (×2 — 1 попадание не оставляет вмятины), урон ядер (×2 —
//      пролом с 1-2), живучесть по кораблям (sloop ×0.5 — корпус
//      игрока половинится; brig ×2 — у AI брига двойной)
//  (F) регрессии: постепенное разрушение 3 попаданиями, каскад,
//      палуба сверху без течи, holes=0 (нет кругов), 0 ошибок JS
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

// свежий контекст (HTTP-кэш dev-чанков отдаёт старые сборки!)
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
let loaded = false;
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) { loaded = true; break; }
  await sleep(2500);
}
check('0: игра загрузилась', loaded);
if (!loaded) { log('ИГРА НЕ ЗАГРУЗИЛАСЬ — СТОП'); process.exit(1); }
ev(`window.__game.start()`);
await sleep(2500);
// закрыть окно капитана, если открылось
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// ============ A: ПАЛУБА — ПЛАШМЯ, ВДОЛЬ, БЕЗ ЩЕЛЕЙ ============
log('\n===== A: палуба плашмя и ВДОЛЬ, без щелей =====');
const deckGeo = jparse(await evR(`(() => {
  const g = window.__game;
  const ps = g.player.plankHull;
  const T = window.__THREE;
  const recs = ps.records.filter(r => r.cls === 1);
  const box = (r) => {
    const m = new T.Matrix4().compose(r.center, r.quat, new T.Vector3(r.thick, r.w, r.len));
    const v = new T.Vector3();
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (let sx=-0.5; sx<=0.5; sx+=1) for (let sy=-0.5; sy<=0.5; sy+=1) for (let sz=-0.5; sz<=0.5; sz+=1) {
      v.set(sx,sy,sz).applyMatrix4(m);
      for (let i=0;i<3;i++){ mn[i]=Math.min(mn[i], v.getComponent(i)); mx[i]=Math.max(mx[i], v.getComponent(i)); }
    }
    return { dx: mx[0]-mn[0], dy: mx[1]-mn[1], dz: mx[2]-mn[2] };
  };
  const b0 = recs.slice(0, 5).map(box);
  // щели ПОПЕРЁК: соседние колонки — |x1-x2| <= ширины доски
  const cols = [...new Set(recs.map(r => +r.x.toFixed(3)))].sort((a,b)=>a-b);
  const colGaps = [];
  for (let i = 1; i < cols.length; i++) colGaps.push(+(cols[i]-cols[i-1]).toFixed(3));
  // щели ВДОЛЬ: соседние доски колонки — стык с нахлёстом (не разрыв)
  const byCol = {};
  for (const r of recs) (byCol[+r.x.toFixed(3)] ??= []).push(r);
  let worstEnd = 0;
  for (const [x, list] of Object.entries(byCol)) {
    list.sort((a,b)=>a.z-b.z);
    for (let i = 1; i < list.length; i++) {
      const gap = (list[i].z - list[i].len/2) - (list[i-1].z + list[i-1].len/2);
      worstEnd = Math.max(worstEnd, +gap.toFixed(3));
    }
  }
  return JSON.stringify({
    n: recs.length, boxes: b0,
    flat: b0.every(b => b.dy < b.dx - 0.1 && b.dz > 1.0),
    along: b0.every(b => b.dz >= b.dx * 2),
    colMax: Math.max(...colGaps), colMin: Math.min(...colGaps),
    worstEndGap: worstEnd,
  });
})()`));
log(JSON.stringify(deckGeo));
check('A1: доски палубы лежат ПЛАШМЯ (толщина по вертикали dy < ширины dx)',
  deckGeo.flat === true, JSON.stringify(deckGeo?.boxes?.[0]));
check('A2: доски палубы идут ВДОЛЬ корабля (dz — длина, вдоль нос-корма)',
  deckGeo.along === true, `dz=${deckGeo?.boxes?.[0]?.dz?.toFixed(2)}`);
check('A3: НЕТ щелей ПОПЕРЁК: шаг колонок ≤ ширины доски (нахлёст)',
  deckGeo.colMax <= 0.385 + 0.001, `шаг колонок ${deckGeo?.colMin}..${deckGeo?.colMax} м (доска 0.385)`);
check('A4: НЕТ щелей ВДОЛЬ: стыки с нахлёстом (разрыв ≤ 0)',
  deckGeo.worstEndGap <= 0.001, `макс. разрыв стыка ${deckGeo?.worstEndGap} м`);

// ============ B: БОРТА — ПОЯСА ВНАКРОЙ ============
log('\n===== B: обшивка внакрой — нахлёст поясов =====');
const sideGeo = jparse(await evR(`(() => {
  const g = window.__game;
  const ps = g.player.plankHull;
  const T = window.__THREE;
  const recs = ps.records.filter(r => r.cls === 0 && r.side === 1);
  // пояса: группы по y-центру; шаг vs высота доски
  const ys = [...new Set(recs.map(r => +r.y.toFixed(2)))].sort((a,b)=>a-b);
  const pitches = [];
  for (let i = 1; i < ys.length; i++) pitches.push(+(ys[i]-ys[i-1]).toFixed(3));
  const w = recs[0].w;
  // наклон поясья: кватернион ≠ чистый базис поверхности
  const r0 = recs[0];
  const m = new T.Matrix4().compose(r0.center, r0.quat, new T.Vector3(1,1,1));
  const nOut = new T.Vector3(1,0,0).applyMatrix4(m).sub(r0.center).normalize();
  const tilt = +(Math.atan2(nOut.y, Math.abs(nOut.x)).toFixed(3));
  // стыки досок по длине — без разрывов
  const byStrake = {};
  for (const r of recs) (byStrake[+r.y.toFixed(2)] ??= []).push(r);
  let worstEnd = 0;
  for (const list of Object.values(byStrake)) {
    list.sort((a,b)=>a.z-b.z);
    for (let i = 1; i < list.length; i++) {
      const gap = (list[i].z - list[i].len/2) - (list[i-1].z + list[i-1].len/2);
      worstEnd = Math.max(worstEnd, +gap.toFixed(3));
    }
  }
  // покрытие высоты борта: от среза до верха зазоров между поясами нет
  const span = +(ys[ys.length-1] - ys[0]).toFixed(2);
  return JSON.stringify({
    nStrakes: ys.length, w, pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches),
    overlap: +(w - Math.max(...pitches)).toFixed(3),
    tiltRad: tilt, worstEndGap: worstEnd, span,
    zCover: [+(Math.min(...recs.map(r=>r.z-r.len/2))).toFixed(2), +(Math.max(...recs.map(r=>r.z+r.len/2))).toFixed(2)],
    L: g.player.preset.length,
  });
})()`));
log(JSON.stringify(sideGeo));
check('B1: пояса ВНАКРОЙ: шаг поясов МЕНЬШЕ высоты доски (нахлёст ≥ 5 см)',
  sideGeo.overlap >= 0.05, `доска ${sideGeo?.w} м, шаг ${sideGeo?.pitchMin}..${sideGeo?.pitchMax}, нахлёст ${sideGeo?.overlap} м`);
check('B2: пояс наклонён (нижняя кромка наружу — линия нахлёста читается)',
  Math.abs(sideGeo.tiltRad) > 0.06 && Math.abs(sideGeo.tiltRad) < 0.4,
  `наклон ${sideGeo?.tiltRad} рад (~${Math.round((sideGeo?.tiltRad||0)*57.3)}°)`);
check('B3: НЕТ щелей по длине: стыки с микронахлёстом',
  sideGeo.worstEndGap <= 0.001, `макс. разрыв ${sideGeo?.worstEndGap} м`);
check('B4: обшивка доходит до кормы и носа (пояса продлены до транца/штевня)',
  sideGeo.zCover[0] < -sideGeo.L * 0.45 && sideGeo.zCover[1] > sideGeo.L * 0.45,
  `пояса ${sideGeo?.zCover} при L=${sideGeo?.L}`);

// ============ C: ТРАНЕЦ (задник) ============
log('\n===== C: транец — корма закрыта досками =====');
const transom = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const ps = p.plankHull;
  const T = window.__THREE;
  const mesh = ps.group.children.find(m => m.name === 'Planks_Transom');
  const recs = ps.records.filter(r => r.cls === 2);
  const L = p.preset.length;
  // покрытие: ширина на каждом поясе против полуширины корпуса
  const cov = recs.map(r => ({
    y: +r.y.toFixed(2), half: +(Math.abs(r.x) + r.len / 2).toFixed(2),
    hw: +(Math.max(0.34, T === undefined ? 0 : 0)).toFixed(2), z: +r.z.toFixed(2),
  }));
  const yMin = Math.min(...recs.map(r => r.y - r.w / 2));
  const yMax = Math.max(...recs.map(r => r.y + r.w / 2));
  const zSpan = [Math.min(...recs.map(r => r.z)), Math.max(...recs.map(r => r.z))];
  return JSON.stringify({
    mesh: !!mesh, meshTris: mesh ? Math.round((mesh.geometry.attributes.position.count)/3) : 0,
    n: recs.length, yMin: +yMin.toFixed(2), yMax: +yMax.toFixed(2),
    zSpan: zSpan.map(v=>+v.toFixed(2)), L,
    cut: +(-p.preset.draft * 0.62).toFixed(2),
    bulwarkStern: +(g.player.visual.group && 0).toFixed(2),
    maxHalf: Math.max(...cov.map(c => c.half)),
  });
})()`));
log(JSON.stringify(transom));
check('C1: 4-й меш Planks_Transom с досками (корма закрыта)',
  transom.mesh === true && transom.n >= 8 && transom.meshTris > 200,
  `${transom?.n} досок, ${transom?.meshTris} трис`);
check('C2: пояса транца закрывают корму от среза до верха',
  transom.yMin <= transom.cut + 0.15 && transom.yMax > 1.2,
  `y ${transom?.yMin}..${transom?.yMax} (срез ${transom?.cut})`);
check('C3: транец на всю ширину кормы (полуширина ≥ 1 м у слупа)',
  transom.maxHalf >= 0.9, `полуширина стены ${transom?.maxHalf} м`);

// попадание в КОРАМУ: стена транца (без течи — выше ВЛ) + ниже ВЛ → течь
const sternHit = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const L = p.preset.length;
  // 1) удар в стену транца НАД ватерлинией: только повреждение
  const hitHi = new T(0, 1.2, -L * 0.462);
  const leak0 = p.damageInfo().leakRate;
  p.hitHull(hitHi.clone(), 15, false, new T(0, 0, -1));
  g.stepDebugNR(0.3);
  const byClassHi = {};
  for (const r of p.plankHull.records) {
    if (r.state > 0) byClassHi[r.cls] = (byClassHi[r.cls] || 0) + 1;
  }
  const leakHi = p.damageInfo().leakRate;
  // 2) пять ударов ниже ВЛ в транец — СЛОМ + ТЕЧЬ (попадание в стык
  // досок транца распределяет урон на обе — пробитие дольше борта)
  const hitLo = new T(0, -0.5, -L * 0.462);
  for (let i = 0; i < 5; i++) p.hitHull(hitLo.clone(), 15, true, new T(0, 0, -1));
  g.stepDebugNR(0.4);
  const byClassLo = {};
  let transomS3 = 0;
  for (const r of p.plankHull.records) {
    if (r.state > 0) byClassLo[r.cls] = (byClassLo[r.cls] || 0) + 1;
    if (r.cls === 2 && r.state === 3) transomS3++;
  }
  const leakLo = p.damageInfo().leakRate;
  return JSON.stringify({ byClassHi, leakHi, leak0, byClassLo, transomS3, leakLo });
})()`));
log(JSON.stringify(sternHit));
check('C4: попадание в корму ломает ДОСКИ ТРАНЦА (cls=2), борта целы',
  (sternHit.byClassHi?.['2'] ?? 0) >= 1 && (sternHit.byClassHi?.['0'] ?? 0) === 0,
  `повреждены по классам: ${JSON.stringify(sternHit?.byClassHi)}`);
check('C5: транец НАД ВЛ — без течи; ниже ВЛ — серия ударов = СЛОМ + ТЕЧЬ',
  sternHit.leakHi <= sternHit.leak0 + 0.001 && sternHit.transomS3 >= 1 && sternHit.leakLo > sternHit.leakHi + 0.01,
  `над ВЛ: ${sternHit?.leakHi?.toFixed(3)} (было ${sternHit?.leak0?.toFixed(3)}); ниже ВЛ: s3=${sternHit?.transomS3}, течь ${sternHit?.leakLo?.toFixed(3)}`);

// ============ D: КВАРТЕРДЕК ИЗ ДОСОК ============
log('\n===== D: квартердэк из досок =====');
const qd = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const L = p.preset.length;
  const deckY = (z) => { const t = Math.max(0, Math.min(1, (z + L/2)/L)); return g.__deckYAt ? g.__deckYAt(z) : null; };
  const ps = p.plankHull;
  const main = ps.records.filter(r => r.id.includes('_D'));
  // пересадка на ФЛЕЙТ (квартердэк 1.2 м) — бесплатная смена
  const pos = { x: p.position.x, z: p.position.z };
  const res = g.changeShip('fluyt', true, true);
  g.stepDebugNR(0.3);
  const p2 = g.player;
  const q = p2.preset.quarter;
  const qRecs = p2.plankHull.records.filter(r => r.id.includes('_Q'));
  const mainRecs = p2.plankHull.records.filter(r => r.id.includes('_D'));
  const deckY2 = (z) => { const t = Math.max(0, Math.min(1, (z + L/2)/L)); const pr = window.__game.player.preset; const bul = pr && 0; return 0; };
  // высота настила квартердека: y записей > высоты главной палубы
  const qY = qRecs.length ? qRecs[0].y : null;
  const mainY = mainRecs.length ? mainRecs[0].y : null;
  const T = window.__THREE;
  const qBox = qRecs.length ? (() => {
    const r = qRecs[0];
    const m = new T.Matrix4().compose(r.center, r.quat, new T.Vector3(r.thick, r.w, r.len));
    const v = new T.Vector3(); const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for (let sx=-0.5;sx<=0.5;sx+=1) for (let sy=-0.5;sy<=0.5;sy+=1) for (let sz=-0.5;sz<=0.5;sz+=1) {
      v.set(sx,sy,sz).applyMatrix4(m);
      for (let i=0;i<3;i++){ mn[i]=Math.min(mn[i],v.getComponent(i)); mx[i]=Math.max(mx[i],v.getComponent(i)); }
    }
    return { dx: +(mx[0]-mn[0]).toFixed(3), dy: +(mx[1]-mn[1]).toFixed(3), dz: +(mx[2]-mn[2]).toFixed(3) };
  })() : null;
  return JSON.stringify({
    changed: p2.preset.id === 'fluyt', kind: p2.preset.id, quarter: q,
    qN: qRecs.length, mainN: mainRecs.length,
    qY, mainY, dY: qY !== null && mainY !== null ? +(qY - mainY).toFixed(2) : null,
    qBox, qAlong: qBox ? qBox.dz > qBox.dx * 2 && qBox.dy < qBox.dx - 0.1 : false,
  });
})()`));
log(JSON.stringify(qd));
check('D1: смена на флейт — у судна есть квартердэк', qd.changed && qd.quarter > 0.5,
  `${qd?.kind}, квартердэк ${qd?.quarter} м`);
check('D2: настил квартердека ИЗ ДОСОК (записи Plank_Q*)',
  qd.qN >= 20, `${qd?.qN} досок квартердека`);
check('D3: доски квартердека ПЛАШМЯ и ВДОЛЬ (как главная палуба)',
  qd.qAlong === true, JSON.stringify(qd?.qBox));
check('D4: настил квартердека ПОВЫШЕ главной палубы (свой уровень)',
  qd.dY !== null && qd.dY > qd.quarter * 0.5,
  `главная ${qd?.mainY?.toFixed(2)} → квартердэк ${qd?.qY?.toFixed(2)} (+${qd?.dY})`);

// вид сверху + корма для визуальной проверки
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.mode = 'free'; g.rig.freeElevSet(1.45);
  g.rig.freeAzimSet(-p.heading - Math.PI / 2); g.rig.distSet(34); g.rig.snap();
  return 1;
})()`);
await sleep(2000);
run(`screenshot scripts/shots/t47_fluyt_deck_top.png`);
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.freeElevSet(0.32); g.rig.freeAzimSet(-p.heading + Math.PI);
  g.rig.distSet(30); g.rig.snap(); return 1;
})()`);
await sleep(2000);
run(`screenshot scripts/shots/t47_fluyt_stern.png`);
await evR(`(() => {
  const g = window.__game; const p = g.player;
  g.rig.freeElevSet(0.2); g.rig.freeAzimSet(-p.heading - Math.PI / 2 + 0.4);
  g.rig.distSet(15); g.rig.snap(); return 1;
})()`);
await sleep(2000);
run(`screenshot scripts/shots/t47_fluyt_side.png`);

// вернуться на шлюп (для тестов настроек)
await evR(`(() => { window.__game.changeShip('sloop', true, true); window.__game.stepDebugNR(0.3); return 1; })()`);
await sleep(1500);

// ============ E: НАСТРОЙКИ «КОРАБЛИ» ============
log('\n===== E: настройки: доски/ядра/живучесть =====');
// вкладка в панели настроек
const tabOk = jparse(await evR(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Настройки'));
  if (btn) btn.click();
  return 'opened';
})()`));
await sleep(800);
const tabUI = jparse(await evR(`(() => {
  const tabs = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('Корабли'));
  if (!tabs.length) return JSON.stringify({ found: false });
  tabs[0].click();
  return JSON.stringify({ found: true, clicked: true });
})()`));
await sleep(600);
const tabContent = jparse(await evR(`(() => {
  const t = (document.body.innerText || '');
  return JSON.stringify({
    hasTab: t.includes('Прочность досок обшивки'),
    hasBall: t.includes('Урон ядер'),
    hasDur: t.includes('Живучесть кораблей'),
    hasFluyt: t.includes('Флейт'),
    hasReset: t.includes('Сбросить все'),
    sliders: document.querySelectorAll('input[type=range]').length,
  });
})()`));
log(JSON.stringify(tabContent));
check('E1: в панели появилась вкладка «⛵ Корабли» с разделами',
  tabContent.hasTab && tabContent.hasBall && tabContent.hasDur,
  JSON.stringify(tabContent));
check('E2: список живучести — все корабли (слайдеры в табе)',
  tabContent.hasFluyt && tabContent.sliders >= 30,
  `слайдеров ${tabContent?.sliders}`);
// закрыть панель
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Закрыть|✕/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(600);

// прочность досок ×2: одно попадание НЕ оставляет вмятины
const strength = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  // свежий корабль после смены — все доски целы
  const zone = new T(2.4, -0.4, 2.0);
  window.__seaPatchSettings({ ships: { plankStrength: 2 } });
  g.stepDebugNR(0.2);
  p.hitHull(zone.clone(), 15, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(0.2);
  const at2 = p.damageInfo().plankHull;
  window.__seaPatchSettings({ ships: { plankStrength: 1 } });
  g.stepDebugNR(0.2);
  p.hitHull(zone.clone(), 15, true, new T(1, 0.1, 0.2));
  g.stepDebugNR(0.2);
  const at1 = p.damageInfo().plankHull;
  return JSON.stringify({ at2: { s1: at2.s1, s2: at2.s2, s3: at2.s3 }, at1: { s1: at1.s1, s2: at1.s2, s3: at1.s3 } });
})()`));
log(JSON.stringify(strength));
check('E3: прочность досок ×2 — доски держат удар (с 1 попадания НЕТ вмятины)',
  strength.at2.s1 + strength.at2.s2 + strength.at2.s3 === 0,
  `после 1 удара при ×2: s1=${strength?.at2?.s1}, s2=${strength?.at2?.s2}`);
check('E4: возврат к ×1 — урон снова тратит HP (вмятина появилась)',
  strength.at1.s1 + strength.at1.s2 > 0,
  `s1=${strength?.at1?.s1}, s2=${strength?.at1?.s2}`);

// урон ядер ×2: РЕАЛЬНЫЕ залпы по мишени полигона (боевой путь урона)
const ballMul = jparse(await evR(`(() => {
  const g = window.__game;
  // близкая мишень — залпы наверняка доходят
  window.__seaPatchSettings({ gameplay: { provingDistance: 45 } });
  g.startProving('fluyt');
  g.stepDebugNR(0.5);
  const p = g.player;
  let tgt = g.pgTarget.ship;
  const volley = (t) => {
    g.combat.aiBallVolley(p, t);
    g.stepDebugNR(2.2);
    const ph = t.damageInfo().plankHull;
    return { s1: ph.s1, s2: ph.s2, s3: ph.s3, hp: +t.hullHP.toFixed(1) };
  };
  // ×1: два залпа (мишень НЕ должна утонуть — без насыщения урона)
  let v1 = [];
  let hp1 = +tgt.hullHP.toFixed(1);
  for (let i = 0; i < 2; i++) v1.push(volley(tgt));
  const hpDrop1 = +(hp1 - v1[1].hp).toFixed(1);
  g.resetProvingTarget();
  g.stepDebugNR(0.3);
  // ×2: два залпа по свежей мишени
  window.__seaPatchSettings({ ships: { ballDamage: 2 } });
  g.stepDebugNR(0.2);
  tgt = g.pgTarget.ship;
  const hp2 = +tgt.hullHP.toFixed(1);
  let v2 = [];
  for (let i = 0; i < 2; i++) v2.push(volley(tgt));
  const hpDrop2 = +(hp2 - v2[1].hp).toFixed(1);
  window.__seaPatchSettings({ ships: { ballDamage: 1 }, gameplay: { provingDistance: 90 } });
  g.stepDebugNR(0.2);
  return JSON.stringify({
    v1last: v1[1], v2last: v2[1], hpDrop1, hpDrop2,
    dmg1: v1[1].s1 + v1[1].s2 * 2 + v1[1].s3 * 3,
    dmg2: v2[1].s1 + v2[1].s2 * 2 + v2[1].s3 * 3,
  });
})()`));
log(JSON.stringify(ballMul));
check('E5: урон ядер ×2 — мишень страдает сильнее (HP падает заметно быстрее)',
  ballMul.hpDrop1 > 3 && ballMul.hpDrop2 > ballMul.hpDrop1 * 1.5,
  `падение HP за 2 залпа: ×1 = ${ballMul?.hpDrop1}, ×2 = ${ballMul?.hpDrop2}`);
// выход из полигона: вернуться в обычный режим
await evR(`(() => { window.__game.exitProving(); window.__game.stepDebugNR(0.3); return 1; })()`);
await sleep(800);

// живучесть по кораблям: sloop ×0.5, brig ×2, сброс — явные ×1
// (патч-мердж не удаляет ключи — сброс = вернуть 1)
const durab = jparse(await evR(`(() => {
  const g = window.__game;
  const p0 = g.player.hullMax;
  const brig0 = g.aiShips.filter(a => a.ship.preset.id === 'brig')[0]?.ship.hullMax ?? null;
  window.__seaPatchSettings({ ships: { durability: { sloop: 0.5, brig: 2 } } });
  g.stepDebugNR(0.2);
  const p1 = g.player.hullMax;
  const brig1 = g.aiShips.filter(a => a.ship.preset.id === 'brig')[0]?.ship.hullMax ?? null;
  window.__seaPatchSettings({ ships: { durability: { sloop: 1, brig: 1 } } });
  g.stepDebugNR(0.2);
  const p2 = g.player.hullMax;
  const brig2 = g.aiShips.filter(a => a.ship.preset.id === 'brig')[0]?.ship.hullMax ?? null;
  return JSON.stringify({ p0, p1, kP: +(p1/p0).toFixed(3), brig0, brig1, kB: brig0 ? +(brig1/brig0).toFixed(3) : null, p2, kBack: +(p2/p1).toFixed(3), brig2, kBackB: brig0 ? +(brig2/brig1).toFixed(3) : null });
})()`));
log(JSON.stringify(durab));
check('E6: живучесть sloop ×0.5 — корпус игрока уменьшился вдвое',
  Math.abs(durab.kP - 0.5) < 0.02, `${durab?.p0} → ${durab?.p1} (×${durab?.kP})`);
check('E7: живучесть brig ×2 — корпус AI-брига удвоился',
  durab.kB !== null && Math.abs(durab.kB - 2) < 0.05,
  `${durab?.brig0} → ${durab?.brig1} (×${durab?.kB})`);
check('E8: сброс — прочность вернулась (sloop и brig)',
  Math.abs(durab.kBack - 2) < 0.02 && Math.abs(durab.kBackB - 0.5) < 0.02,
  `sloop ×${durab?.kBack}, brig ×${durab?.kBackB} после сброса`);

// сохранение v17
const persist = jparse(await evR(`(() => {
  const raw = localStorage.getItem('seawolves.settings.v1');
  const s = raw ? JSON.parse(raw) : null;
  return JSON.stringify({ v: s?.v, ships: s?.ships ?? null });
})()`));
log(JSON.stringify(persist));
check('E9: схема настроек v17 с разделом ships (localStorage)',
  persist.v === 17 && persist.ships && typeof persist.ships.plankStrength === 'number',
  `v=${persist?.v}, ships=${JSON.stringify(persist?.ships)}`);

// ============ F: РЕГРЕССИИ ============
log('\n===== F: регрессии разрушения =====');
const reg = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  // свежая зона: постепенное разрушение 3 попаданиями
  const zone = new T(2.4, -0.4, -2.5);
  const seq = [];
  for (let i = 0; i < 3; i++) {
    p.hitHull(zone.clone(), 15, true, new T(1, 0.1, 0.2));
    g.stepDebugNR(0.25);
    const d = p.damageInfo();
    seq.push({ s1: d.plankHull.s1, s2: d.plankHull.s2, s3: d.plankHull.s3 });
  }
  const d3 = p.damageInfo();
  // каскад: добить до ≥6 сломанных
  let hits = 0;
  const plates0 = window.__seaDebrisInfo().byKind.hullplate;
  for (; hits < 30; hits++) {
    p.hitHull(zone.clone(), 15, true, new T(1, 0.1, 0.2));
    if (window.__seaDebrisInfo().byKind.hullplate > plates0) break;
  }
  g.stepDebugNR(0.3);
  const dC = p.damageInfo();
  // палуба сверху — без течи
  const leakBefore = p.damageInfo().leakRate;
  const hw = p.halfWidthAt(0);
  const lp = new T(hw * 0.3, 2.1, 0.6);
  for (let i = 0; i < 4; i++) p.hitHull(lp.clone(), 15, false, new T(0.2, 1, 0.1));
  g.stepDebugNR(0.3);
  const dD = p.damageInfo();
  return JSON.stringify({
    seq, holes: d3.holes.length, leakAfter3: d3.leakRate,
    cascade: { hits, s3: dC.plankHull.s3, plates: window.__seaDebrisInfo().byKind.hullplate - plates0 },
    deck: { broken: dD.plankHull.deckBroken, leak: dD.leakRate, leakBefore },
  });
})()`));
log(JSON.stringify(reg));
check('F1: постепенное разрушение: 1-й удар — вмятина, НЕ слом',
  reg.seq[0].s1 > 0 && reg.seq[0].s3 === 0,
  `удар1: s1=${reg?.seq?.[0]?.s1}, s3=${reg?.seq?.[0]?.s3}`);
check('F2: 3-й удар — СЛОМ (пролом с 3 попаданий, как прежде)',
  reg.seq[2].s3 >= 1, `удар3: s3=${reg?.seq?.[2]?.s3}`);
check('F3: НЕТ декалей-«кругов» (holes = 0 в дощатом режиме)',
  reg.holes === 0, `holes=${reg?.holes}`);
check('F4: каскад ≥6 сломанных — панель вырвано',
  reg.cascade.s3 >= 6 && reg.cascade.plates >= 1,
  `s3=${reg?.cascade?.s3} за ${reg?.cascade?.hits} ударов, панелей +${reg?.cascade?.plates}`);
check('F5: палуба сверху ломается БЕЗ течи',
  reg.deck.broken > 0 && reg.deck.leak <= reg.deck.leakBefore + 0.001,
  `палубных сломано: ${reg?.deck?.broken}, течь ${reg?.deck?.leakBefore?.toFixed(3)} → ${reg?.deck?.leak?.toFixed(3)}`);

// ошибки JS
const errs = run('errors');
check('F6: 0 ошибок JS за весь прогон', !errs || errs.length < 5,
  String(errs).slice(0, 200));

// финальный скриншот шлюпа с повреждениями
run(`screenshot scripts/shots/t47_final.png`);

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
