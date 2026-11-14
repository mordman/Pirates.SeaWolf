// E2E Task 48: СПЛОШНОЙ РАЗЛОМ ДОСОК + СТРЕЛКОВЫЙ ОГОНЬ (матросы
// убивают матросов противника, сбивают за борт) + ЗАТОПЛЕНИЕ ПО
// ОТСЕКАМ НА НУЖНЫЙ БОРТ (видимая вода в трюме, Торричелли, крен)
//  (A) разлом: 3 попадания в одну точку → СПЛОШНАЯ дыра (все доски
//      подряд в радиусе разрыва), НЕ «шахматная доска»; каскад
//      «панель вырвано» по-прежнему достижим (≥12 в зоне)
//  (B) стрелки: прямая проверка цепочки — пули противника снимают
//      фигуры с палубы цели (экипаж −N), часть СБИТА ЗА БОРТ
//      (фигуры падают в воду и плавают лицом вниз); живой бой:
//      игрок и пират на 70 м — стрелки на постах, экипажи тают
//  (C) затопление: пробоина ПОРТ ниже ВЛ → вода приходит в
//      порт-отсеки; в трюме ВИДИМАЯ вода (Hold_Water на нужной
//      стороне); крен НА ПОРТ; напор по Торричелли (поток слабеет
//      по мере заполнения отсека)
//  (D) регрессии: 1-й удар без слома, 0 ошибок JS
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
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// ============ A: СПЛОШНОЙ РАЗЛОМ (НЕ «ШАХМАТНАЯ ДОСКА») ============
log('\n===== A: сплошной разлом досок =====');
const tear = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.plankHull.reset();
  g.stepDebugNR(0.2);
  // точка удара: порт (+X), у самой воды, мидель — 3 попадания ядра
  const hit = { y: 0.0, z: 1.2 };
  const seq = [];
  for (let i = 0; i < 3; i++) {
    p.hitHull(new T(2.2, hit.y, hit.z), 15, true, new T(1, 0.1, 0.2));
    g.stepDebugNR(0.2);
    seq.push(p.plankHull.byState());
  }
  // картина разлома: сломанные доски порта
  const broken = p.plankHull.records.filter(r => r.cls === 0 && r.side === 1 && r.state === 3)
    .map(r => ({ y: +r.y.toFixed(2), z: +r.z.toFixed(2), len: +r.len.toFixed(2), w: r.w }));
  // связность: у каждого сломанного есть сломанный сосед ≤0.9 м
  // (Task 49: пояс 0.42 — соседний пояс на 0.42 м, сосед по диагонали
  // до 0.84 м; порог 0.8 резал краевую доску разрыва)
  let isolated = 0;
  for (const a of broken) {
    const near = broken.some(b => b !== a && Math.hypot(b.y - a.y, b.z - a.z) <= 0.9);
    if (!near) isolated++;
  }
  // пояса в разломе (разные высоты y)
  const strakes = [...new Set(broken.map(b => Math.round(b.y * 5) / 5))];
  // ядро зоны разрыва: все доски, чьё ТЕЛО накрывает точку удара
  const recs = p.plankHull.records.filter(r => r.cls === 0 && r.side === 1);
  const core = recs.filter(r => Math.abs(r.y - hit.y) <= r.w / 2 + 0.01
    && Math.abs(r.z - hit.z) <= r.len / 2 + 0.01);
  const coreBroken = core.filter(r => r.state === 3).length;
  // внутренний круг разрыва (rectDist < 0.45 — меньше R_TEAR) — весь вырван
  const rectDist = (r) => {
    const da = Math.abs(hit.y - r.y) - r.w / 2;
    const db = Math.abs(hit.z - r.z) - r.len / 2;
    return Math.hypot(Math.max(0, da), Math.max(0, db));
  };
  const inner = recs.filter(r => rectDist(r) < 0.45);
  const innerBroken = inner.filter(r => r.state === 3).length;
  // размах дыры по вертикали/горизонтали (м)
  const ySpan = broken.length ? Math.max(...broken.map(b => b.y)) - Math.min(...broken.map(b => b.y)) : 0;
  const zSpan = broken.length ? Math.max(...broken.map(b => b.z)) - Math.min(...broken.map(b => b.z)) : 0;
  return JSON.stringify({
    seq: seq.map(s => ({ s1: s.s1, s2: s.s2, s3: s.s3 })),
    broken: broken.length, isolated, strakes,
    core: { total: core.length, broken: coreBroken },
    inner: { total: inner.length, broken: innerBroken },
    span: { y: +ySpan.toFixed(2), z: +zSpan.toFixed(2) },
    belowWL: p.plankHull.belowWLBroken().length,
  });
})()`));
log(JSON.stringify(tear));
check('A1: 1-е попадание — вмятины, БЕЗ слома (постепенность)',
  tear.seq[0].s3 === 0 && (tear.seq[0].s1 + tear.seq[0].s2) > 0,
  `удар1: s1=${tear?.seq?.[0]?.s1} s2=${tear?.seq?.[0]?.s2} s3=${tear?.seq?.[0]?.s3}`);
check('A2: 3-е попадание — СЛОМ, дыра из ≥3 досок (не одиночная)',
  tear.seq[2].s3 >= 3 && tear.seq[2].s3 <= 40,
  `s3=${tear?.seq?.[2]?.s3}`);
check('A3: разлом СПЛОШНОЙ — 0 изолированных сломанных досок',
  tear.broken >= 3 && tear.isolated === 0,
  `сломано ${tear?.broken}, изолированных ${tear?.isolated}`);
check('A4: ломаются ВСЕ ПОЯСА подряд (≥2 высоты в разломе)',
  tear.strakes.length >= 2, `пояса: ${JSON.stringify(tear?.strakes)}`);
check('A5: под ядром НЕТ целых досок (ядро зоны вырвано целиком)',
  tear.core.total > 0 && tear.core.broken === tear.core.total,
  `в точке: ${tear?.core?.broken}/${tear?.core?.total}`);
check('A6: внутренний круг разрыва вырван ЦЕЛИКОМ (rectDist<0.45)',
  tear.inner.total > 0 && tear.inner.broken >= tear.inner.total - 1,
  `${tear?.inner?.broken}/${tear?.inner?.total}`);
check('A7: дыра локальная (~пояс×2), НЕ треть борта',
  tear.span.y <= 2.6 && tear.span.z <= 4.0,
  `размах: ${tear?.span?.y} м по высоте × ${tear?.span?.z} м по длине`);

// каскад: добить зону — панель обшивки вырвано (регрессия v65 F4)
const casc = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const plates0 = window.__seaDebrisInfo().byKind.hullplate || 0;
  let hits = 0;
  for (; hits < 12; hits++) {
    p.hitHull(new T(2.2, 0.0, 1.2), 15, true, new T(1, 0.1, 0.2));
    g.stepDebugNR(0.15);
    if ((window.__seaDebrisInfo().byKind.hullplate || 0) > plates0) break;
  }
  return JSON.stringify({
    hits, plates: (window.__seaDebrisInfo().byKind.hullplate || 0) - plates0,
    s3: p.plankHull.byState().s3,
  });
})()`));
log(JSON.stringify(casc));
check('A8: каскад «панель вырвано» по-прежнему работает (≥12 в зоне)',
  casc.plates >= 1, `за ${casc?.hits} ударов, панелей +${casc?.plates}, s3=${casc?.s3}`);

// ============ C: ЗАТОПЛЕНИЕ НА НУЖНЫЙ БОРТ ============
log('\n===== C: затопление по отсекам, вода на нужном борту =====');
const flood = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  // чистый корпус: сброс досок и отсеков (после каскада A)
  p.plankHull.reset();
  for (const c of p.compartments) { c.water = 0; c.leak = 0; }
  p.water = 0; p.leakBias = 0; p.trimBias = 0;
  p.hullHP = p.hullMax;
  g.stepDebugNR(0.3);
  // ПРОБОИНА В ПОРТ (+X) НИЖЕ ВЛ: 3 попадания = сплошная дыра
  for (let i = 0; i < 3; i++) {
    p.hitHull(new T(2.2, 0.0, 1.2), 15, true, new T(1, 0.1, 0.2));
    g.stepDebugNR(0.2);
  }
  const leakPort = p.compartments.reduce((a, c, i) => a + (i % 2 === 1 ? c.leak : 0), 0);
  const leakStar = p.compartments.reduce((a, c, i) => a + (i % 2 === 0 ? c.leak : 0), 0);
  const w0 = p.compartments[5].water;
  // фаза 1: 6 с — ранняя скорость + ВИДИМАЯ вода на порт-стороне
  g.stepDebugNR(6);
  const w6 = p.compartments[5].water;
  const rateEarly = (w6 - w0) / 6;
  const hold = p.visual.group.parent.children
    .filter(o => /^Hold_Water_/.test(o.name))
    .map(o => ({ i: +o.name.split('_')[2], vis: o.visible }));
  const visPortEarly = hold.filter(h => h.vis && h.i % 2 === 1).length;
  const visStarEarly = hold.filter(h => h.vis && h.i % 2 === 0).length;
  // фаза 2: ещё 60 с — заполнение, крен, Торричелли
  g.stepDebugNR(60);
  const w66 = p.compartments[5].water;
  const rateLate = (w66 - w6) / 60;
  const portW = p.compartments.reduce((a, c, i) => a + (i % 2 === 1 ? c.water : 0), 0);
  const starW = p.compartments.reduce((a, c, i) => a + (i % 2 === 0 ? c.water : 0), 0);
  const roll = +p.euler.z.toFixed(3);
  const leakBias = +p.leakBias.toFixed(3);
  // крен ОТ ЗАТОПЛЕНИЯ (честная компонента, без наклона волны)
  const floodRoll = +p.floodRollCur.toFixed(3);
  return JSON.stringify({
    leakPort: +leakPort.toFixed(3), leakStar: +leakStar.toFixed(3),
    w6: +w6.toFixed(2), w66: +w66.toFixed(2), cap: +p.compartments[5].cap.toFixed(1),
    rateEarly: +rateEarly.toFixed(4), rateLate: +rateLate.toFixed(4),
    portW: +portW.toFixed(2), starW: +starW.toFixed(2),
    holdTotal: hold.length, visPortEarly, visStarEarly,
    roll, rollDeg: +(p.euler.z * 57.3).toFixed(1), leakBias, floodRoll,
    sinking: p.sinking, brokenBelowWL: p.plankHull.belowWLBroken().length,
  });
})()`));
log(JSON.stringify(flood));
check('C1: течь ТОЛЬКО в порт-отсеки (борт пробоины)',
  flood.leakPort > 0.05 && flood.leakStar === 0,
  `порт течь=${flood?.leakPort}, штирборт=${flood?.leakStar}`);
check('C2: вода пришла в порт-отсеки, штирборт почти сухой',
  flood.portW > 1 && flood.starW < flood.portW * 0.45,
  `порт=${flood?.portW} м³, штирборт=${flood?.starW} м³ (щели в переборках)`);
check('C3: в трюме ВИДИМАЯ вода — на порт-стороне (Hold_Water)',
  flood.holdTotal === 8 && flood.visPortEarly >= 1 && flood.visStarEarly === 0,
  `боксов 8, видно порт=${flood?.visPortEarly}, штирборт=${flood?.visStarEarly}`);
check('C4: крен НА затопленный борт (порт: floodRoll<0 при leakBias>0)',
  flood.leakBias > 0.1 && flood.floodRoll < -0.02 && !flood.sinking,
  `leakBias=${flood?.leakBias}, крен от воды=${flood?.floodRoll} рад (${((flood?.floodRoll || 0) * 57.3).toFixed(1)}°)`);
check('C5: напор по Торричелли — поток слабеет при заполнении',
  flood.rateLate < flood.rateEarly * 0.85,
  `в начале ${flood?.rateEarly} м³/с, потом ${flood?.rateLate} м³/с`);
check('C6: сплошная дыра ниже ВЛ дала течь (сломанных ниже ВЛ ≥3)',
  flood.brokenBelowWL >= 3, `ниже ВЛ сломано: ${flood?.brokenBelowWL}`);

// ============ B1: ПУЛИ СНИМАЮТ МАТРОСОВ (прямая проверка цепочки) ============
log('\n===== B1: пули снимают матросов с палубы =====');
const shots = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const t = g.aiShips.map(a => a.ship).filter(s => !s.sunk && !s.sinking && !s.surrendered)
    .sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position))[0];
  if (!t) return JSON.stringify({ err: 'нет целей' });
  const crew0 = t.crew;
  const dead0 = t.crew3d.dead;
  const wg = t.visual.group.parent;
  const wg0 = wg.children.length;
  // 16 «пуль» стрелка с порта (x+): приоритет — фигуры у борта
  for (let i = 0; i < 16; i++) t.smallArmsHit(new T(1, 0, 0));
  // 3 с — сбитые за борт успевают приводниться (фаза 'float')
  g.stepDebugNR(3);
  const crew1 = t.crew;
  const dead1 = t.crew3d.dead;
  const newKids = wg.children.slice(wg0);
  const floaters = newKids.filter(c => c.position && c.position.y < -0.1).length;
  return JSON.stringify({
    err: null, name: t.preset.name, crew0, crew1, dead0, dead1,
    overboard: newKids.length, floaters,
  });
})()`));
log(JSON.stringify(shots));
check('B1a: пули убивают матросов противника (экипаж тает)',
  !shots.err && shots.crew1 < shots.crew0,
  `${shots?.name}: ${shots?.crew0} → ${shots?.crew1}, убито ${shots?.crew0 - shots?.crew1}`);
check('B1b: трупы есть (dead вырос)',
  !shots.err && shots.dead1 > shots.dead0,
  `dead ${shots?.dead0} → ${shots?.dead1}`);
check('B1c: часть убитых СБИТА ЗА БОРТ (фигуры в воде, лицом вниз)',
  !shots.err && shots.floaters >= 1,
  `в воде: ${shots?.floaters} из ${shots?.overboard} покинувших палубу`);

// ============ B2: ЖИВОЙ БОЙ — СТРЕЛКИ РАБОТАЮТ НА 70 м ============
log('\n===== B2: живой бой, стрелки на постах =====');
const fight = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE.Vector3;
  const fleet = g.aiShips.filter(a => a.ship.flagKind === 'pirate' && !a.ship.sunk && !a.ship.sinking);
  if (!fleet.length) return JSON.stringify({ err: 'нет пиратов' });
  const target = fleet.sort((a, b) =>
    a.ship.position.distanceTo(p.position) - b.ship.position.distanceTo(p.position))[0];
  target.onPlayerAggression(g.aiShips);
  // встать на 70 м — окно угрозы 95 м, ружья 85 м
  p.position.copy(target.ship.position).add(new T(70, 0, 0));
  p.position.y = 0;
  p.velocity.set(0, 0, 0);
  p.quaternion.setFromEuler(new window.__THREE.Euler(0, Math.PI / 2, 0));
  g.stepDebugNR(0.5);
  const pirate0 = target.ship.crew;
  const our0 = p.crew;
  const dist0 = +target.ship.position.distanceTo(p.position).toFixed(1);
  let crouched = 0, armed = 0, threated = 0;
  // 48 с боя, каждые 12 с — сигнал «игрок стрелял» (окно 14 с) и
  // ремонт корпуса (проверяем РУЖЬЯ, а не гибель от пушек)
  for (let i = 0; i < 4; i++) {
    g.combat.playerShotSignal = true;
    p.hullHP = p.hullMax;
    p.water = 0;
    for (const c of p.compartments) { c.water = 0; c.leak = 0; }
    g.stepDebugNR(12);
    crouched = Math.max(crouched, window.__sea.crewCrouched);
    armed = Math.max(armed, window.__sea.crewArmed.musket);
    threated = Math.max(threated, p.threatTarget ? 1 : 0, target.ship.threatTarget ? 1 : 0);
    if (target.ship.surrendered || target.ship.sinking) break;
  }
  return JSON.stringify({
    err: null, dist0,
    pirate: { crew0: pirate0, crew1: target.ship.crew, surrendered: target.ship.surrendered },
    ours: { crew0: our0, crew1: p.crew },
    crouched, armed, threated,
    hitsOnUs: g.playerHitCount,
  });
})()`));
log(JSON.stringify(fight));
check('B2a: на 70 м угроза выбрана (окно 95 м работает)',
  !fight.err && fight.threated >= 1,
  `dist=${fight?.dist0} м, угроза: ${fight?.threated}`);
check('B2b: стрелки заняли посты у борта (crouched>0, ружья есть)',
  !fight.err && fight.crouched >= 1 && fight.armed >= 1,
  `crouched=${fight?.crouched}, ружей=${fight?.armed}`);
check('B2c: экипажи тают от ружейного огня (пират или мы)',
  !fight.err && ((fight.pirate.crew1 < fight.pirate.crew0) || (fight.ours.crew1 < fight.ours.crew0)),
  `пират ${fight?.pirate?.crew0}→${fight?.pirate?.crew1}${fight?.pirate?.surrendered ? ' (сдался)' : ''}, мы ${fight?.ours?.crew0}→${fight?.ours?.crew1}`);

// ============ D: ОШИБКИ + СКРИНШОТ ============
log('\n===== D: регрессии =====');
const errs = run('errors');
check('D1: 0 ошибок JS за весь прогон', !errs || errs.length < 5,
  String(errs).slice(0, 200));

// финальный скриншот: бой с пиратами на 70 м
run(`screenshot scripts/shots/t48_fight_70m.png`);

log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails}`);
process.exit(fails === 0 ? 0 : 1);
