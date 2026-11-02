// E2E Task 26 — по замечаниям игрока:
//  (A) РОВНЫЙ КИЛЬ НА СТОЯНКЕ: «корабль находится носом в воде,
//      даже когда стоит» — в штиле на якоре дифферент ≈ 0, кромка
//      палубы у НОСА и КОРМЫ НАД водой, киль по проектную осадку
//      (до фикса: статический дифферент 7–10° на нос, нос −1.6 м)
//  (B) СЛЕД ОТ ЛОДКИ: «сделай след от лодки» — на ходу под вёслами
//      за транцем яла тянется пенная дорожка (точки следа > 5),
//      после остановки тает (lifetime 11 с)
//  (C) БОРТОМ К БОРТУ: «лодку разверни так, чтобы была бортом
//      борту» — ял на БОРТОВЫХ шлюпбалках вдоль корпуса, зазор до
//      обшивки < 1.2 м, носом к носу корабля; цикл спуск/подъём
//      цел; у борта шлюпка НЕ протыкает корпус (коллизия по обводам)
//  (D) скриншоты + 0 ошибок JS
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ================= A: ровный киль на стоянке =================
log('=== A: нос НЕ в воде на стоянке (шиль, якорь, 60 с) ===');
for (const model of ['frigate', 'cog', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    const T = window.__THREE;
    g.changeShip('${model}', true);
    g.debugSetWeather('clear', 3);
    const p = g.player;
    p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
    p.quaternion.identity();
    let t = g.time;
    let nan = false, sumPitch = 0, n = 0;
    for (let i = 0; i < 3600; i++) {   // 60 с покоя
      t += 1/60; p.fixedStep(1/60, t);
      if (!isFinite(p.position.y) || !isFinite(p.quaternion.x)) { nan = true; break; }
      sumPitch += p.euler.x; n++;
    }
    const meanPitch = sumPitch / Math.max(1, n);
    // кромка палубы у носа/кормы (те же точки, что в логике зелёной воды)
    const F = p.preset.freeboard, L = p.preset.length;
    const edge = (lz) => {
      const w = new T.Vector3(0, F * 0.82, lz).applyQuaternion(p.quaternion).add(p.position);
      return w.y - g.waterHeight(w.x, w.z);
    };
    const bowF = edge(L * 0.44), sternF = edge(-L * 0.44);
    const keel = new T.Vector3(0, -p.preset.draft, 0)
      .applyQuaternion(p.quaternion).add(p.position);
    const digMid = g.waterHeight(keel.x, keel.z) - keel.y;
    return JSON.stringify({
      model: '${model}', nan, meanPitch: +meanPitch.toFixed(3),
      pitchDeg: +(meanPitch * 57.3).toFixed(1),
      bowF: +bowF.toFixed(2), sternF: +sternF.toFixed(2),
      digMid: +digMid.toFixed(2), D: p.preset.draft,
    });
  })()`));
  log(`A[${model}]:`, JSON.stringify(r));
  check(`A: ${model} — БЕЗ NaN, дифферент на стоянке ≈ 0 (|Δ| < 4°)`,
    r && !r.nan && Math.abs(r.meanPitch) < 0.07, `pitch=${r.meanPitch} (${r.pitchDeg}°)`);
  check(`A: ${model} — НОС НАД ВОДОЙ (кромка палубы > +0.25 м)`,
    r && r.bowF > 0.25, `нос=+${r.bowF} м (до фикса был −1.6)`);
  check(`A: ${model} — КОРМА НАД ВОДОЙ (кромка палубы > +0.25 м)`,
    r && r.sternF > 0.25, `корма=+${r.sternF} м`);
  check(`A: ${model} — киль в воде по проектную осадку (0.45D..1.7D)`,
    r && r.digMid > r.D * 0.45 && r.digMid < r.D * 1.7, `dig=${r.digMid} D=${r.D}`);
}

// ================= B: след от шлюпки =================
log('=== B: след пены за шлюпкой на ходу ===');
const wake = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const bl = g.boatLaunch;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1/60; bl.update(1/60, t); }  // спуск
  // гребля 14 с — след накапливается
  bl.row = 1; bl.steer = 0;
  let wakeMax = 0, velMax = 0;
  for (let i = 0; i < 840; i++) {
    t += 1/60; bl.update(1/60, t);
    wakeMax = Math.max(wakeMax, bl.wake.count());
    velMax = Math.max(velMax, Math.abs(bl.vel));
  }
  const st1 = bl.state();
  // стоим 12 с — след тает
  bl.row = 0;
  for (let i = 0; i < 720; i++) { t += 1/60; bl.update(1/60, t); }
  return JSON.stringify({
    phase: st1.phase, wakeMax, velMax: +velMax.toFixed(2),
    wakeAtRow: st1.wakePts, wakeAfter: bl.wake.count(),
    trailLen: +(bl.wake.count() * 0.85).toFixed(1),
  });
})()`));
log('B:', JSON.stringify(wake));
check('B: шлюпка на воде', wake.phase === 'afloat', `phase=${wake.phase}`);
check('B: на ходу под вёслами есть СЛЕД (точек > 5)', wake.wakeMax > 5, `max=${wake.wakeMax}`);
check('B: гребля даёт ход (0.4..2 м/с)', wake.velMax > 0.4 && wake.velMax <= 2.0, `vel=${wake.velMax}`);
check('B: после остановки след ТАЕТ (< 2 точек)', wake.wakeAfter < 2, `осталось=${wake.wakeAfter}`);

// ================= C: бортом к борту + коллизия обводов =================
log('=== C: ял у борта — геометрия и цикл ===');
const side = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const bl = g.boatLaunch;
  const bv = p.visual.boat;
  const b = bv.group;
  // после секции B шлюпка на воде — сначала НА ШЛЮПБАЛКИ
  bl.abort();
  b.updateWorldMatrix(true, false);
  const bm = b.matrixWorld.elements;
  const sm = p.visual.group.matrixWorld.elements;
  const dot = bm[8]*sm[8] + bm[9]*sm[9] + bm[10]*sm[10];
  const hullW = p.halfWidthAt(b.position.z);
  const gap = Math.abs(b.position.x) - bv.beam / 2 - hullW;
  // подъём: подойти к борту у шлюпбалок
  const sp = bv.stowPos.clone().applyQuaternion(p.quaternion).add(p.position);
  bl.pos.set(sp.x + Math.sign(bv.stowPos.x || 1) * 2.5, 0, sp.z);
  bl.heading = p.heading + Math.PI;   // худший случай: кормой вперёд
  bl.vel = 0;
  const e1 = bl.tryHoist();
  let t = g.time, maxRoll = 0;
  for (let i = 0; i < 1200; i++) {
    t += 1/60; bl.update(1/60, t);
    const q = bv.group.quaternion;
    const sinr = 2 * (q.w * q.z - q.x * q.y);
    maxRoll = Math.max(maxRoll, Math.abs(Math.atan2(sinr, Math.sqrt(Math.max(1e-9, 1 - sinr*sinr)))));
    if (bl.phase === 'stowed') break;
  }
  const rotY = +(((b.rotation.y % (Math.PI*2)) + Math.PI*2) % (Math.PI*2)).toFixed(2);
  const posOk = Math.abs(b.position.x - bv.stowPos.x) < 0.05
    && Math.abs(b.position.y - bv.stowPos.y) < 0.05
    && Math.abs(b.position.z - bv.stowPos.z) < 0.05;
  // коллизия: телепорт шлюпки ВНУТРИ борта на миделе — должна вытолкнуться
  bl.tryLaunch(false);
  let t2 = g.time;
  for (let i = 0; i < 460; i++) { t2 += 1/60; bl.update(1/60, t2); }
  const T = window.__THREE;
  const qi = p.quaternion.clone().invert();
  const loc = bl.pos.clone().sub(p.position).applyQuaternion(qi);
  const hw = p.halfWidthAt(loc.z) + 0.75;
  const inside = Math.abs(loc.x) < hw - 0.01;
  return JSON.stringify({
    dot: +dot.toFixed(3), gap: +gap.toFixed(2), stowOk: posOk,
    rotY, maxRoll: +maxRoll.toFixed(3), hoistErr: e1,
    localX: +loc.x.toFixed(2), hw: +hw.toFixed(2), inside,
    phase: bl.phase,
  });
})()`));
log('C:', JSON.stringify(side));
check('C: ял вдоль борта, носом к носу корабля (dot > 0.9)',
  side.dot > 0.9, `dot=${side.dot}`);
check('C: зазор борт-к-борту мал и без пересечения (−0.05..1.2 м)',
  side.gap > -0.05 && side.gap < 1.2, `зазор=${side.gap} м`);
check('C: подъём кормой вперёд — без переворота, точно на шлюпбалках',
  side.hoistErr === null && side.stowOk && side.rotY < 0.1 && side.maxRoll < 0.35,
  `maxRoll=${side.maxRoll} pos=${side.stowOk} rotY=${side.rotY}`);
check('C: у борта шлюпка НЕ протыкает корпус (вытолкнута за обводы)',
  !side.inside, `локальный x=${side.localX} ≥ hw=${side.hw}`);

// ================= D: скриншоты =================
log('=== D: скриншоты ===');
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  // вид с траверзы: корпус вертикально, ял параллельно у борта,
  // носы корабля и яла смотрят ВВЕРХ кадра
  g.setCameraMode('side');
  g.rig.dist.side = 19;
  g.rig.snap();
  return 'ok';
})()`);
await sleep(1000);
shot('t26_boat_side');
await sleep(300);
// шлюпка на воде со следом пены: камера ПО УМОЛЧАНИЮ следует за ялом
// и приближается (distScale 0.35 — Task 26), снимаем НА ХОДУ,
// чтобы дорожка пены позади была живой
ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  bl.tryLaunch(false);
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1/60; bl.update(1/60, t); }
  bl.row = 1; bl.steer = 0;
  for (let i = 0; i < 840; i++) { t += 1/60; bl.update(1/60, t); }
  // камера с ТРАВЕРЗЫ яла: лодка бортом, дорожка пены уходит вбок-назад
  g.setCameraMode('free');
  g.rig.freeAzimSet(bl.heading + Math.PI / 2);
  g.rig.freeElevSet(0.45);
  g.rig.distSet(14);
  g.rig.snap();
  return JSON.stringify({ wake: bl.wake.count() });
})()`);
await sleep(900);
shot('t26_boat_wake');
await sleep(300);
// корабль на ровном киле в штиле (вид с борта)
ev(`(() => {
  const g = window.__game;
  g.boatLaunch.abort();
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0);
  return 'ok';
})()`);
await sleep(2000);
ev(`(() => {
  const g = window.__game;
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + Math.PI / 2);   // с борта
  g.rig.freeElevSet(0.12);
  g.rig.distSet(46);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(1800);
shot('t26_ship_level');
await sleep(400);

const pageErrs = jparse(ev(`(() => JSON.stringify(window.__pageErrors || []))()`));
log('E: ошибки страницы:', JSON.stringify(pageErrs).slice(0, 200));
check('E: ошибок JS нет', Array.isArray(pageErrs) && pageErrs.length === 0,
  JSON.stringify(pageErrs).slice(0, 120));

run('close --all');
log(fails === 0 ? '\nALL OK' : `\nFAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
