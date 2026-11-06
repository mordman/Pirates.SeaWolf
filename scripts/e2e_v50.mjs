// E2E Task 32 («Не работает поворот... корабль слишком сильно уходит в
// воду по борт. Проверь что расчеты идут от палубы а не от борта. Проверь
// что корабль не плавает под водой. Смыло матросов, хотя корабль был
// высоко над водой»):
//  A: ПОВОРОТ — руль вправо на 4 курсах (0/90/180/270°): курс
//     разворачивается ОДИНАКОВО (раньше на 90° крен превращался в
//     дифферент — моменты были в МИРОВЫХ осях), крен умеренный,
//     крен не перетекает в дифферент
//  B: КРЕН ОТ ВЕТРА — растёт с ветром, одинаков на всех курсах,
//     ограничен ФИЗИЧЕСКИМ пределом (кромка палубы не ныряет от
//     статического крена), ветер не дифферентует
//  C: ПАЛУБА НАД ВОДОЙ — 3 модели моря в шторм 24 м/с под ход:
//     без NaN, средний борт палубы > 0 (не плавает под водой),
//     глубоких нырков нет
//  D: СМЫВ МАТРОСОВ — в спокойную погоду НЕ смывает; в урагане
//     редкий (кулдаун 25 с), экипаж уменьшается ровно на смытых
//  E: РАСЧЁТЫ ОТ ПАЛУБЫ — шторм-модуль меряет заливание от
//     ПАЛУБЫ (bulwark−1), а не от борта
//  F: ПЕРЕКЛЮЧЕНИЕ МОДЕЛИ МОРЕЯ без транзиента (seedVertical:
//     физическая — ватерлиния y=0, волна-опора/шторм — поверхность)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const log = (...a) => console.log(...a);
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

run('close --all');
run('open http://localhost:3000/?t=' + Date.now());
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = 0; window.addEventListener('error', e => window.__jsErrors++); 'ok'`);
run(`eval "const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Поднять флаг')); if(b){b.click();} 'ok'"`);
await sleep(2500);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// ============ A: ПОВОРОТ — ОДИНАКОВ НА ВСЕХ КУРСАХ, БОРТ НЕ ТОПИТ ============
log('\n===== A: ПОВОРОТ (физ. модель, штиль, руль вправо 12 с @5.8 м/с) =====');
const turn = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  g.debugSetWind(0);
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  const res = {};
  for (const hdgDeg of [0, 90, 180, 270]) {
    const hdg = hdgDeg * Math.PI / 180;
    let t = g.time;
    p.position.set(0, 0, 600);
    p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0); p.rudder = 0; p.rudderTarget = 0;
    p.quaternion.set(0, Math.sin(hdg/2), 0, Math.cos(hdg/2));
    for (let k = 0; k < 120; k++) { t += 1/60; p.fixedStep(1/60, t); }
    p.velocity.copy(p.forward).multiplyScalar(6.0);
    p.rudderTarget = 1; p.rudder = 1;
    let maxRoll = 0, maxPitch = 0;
    for (let i = 0; i < 720; i++) {
      t += 1/60; p.fixedStep(1/60, t);
      const sp = p.speed(); if (sp > 0.01 && sp < 5.5) { const kk = 5.8 / sp; p.velocity.x *= kk; p.velocity.z *= kk; }
      maxRoll = Math.max(maxRoll, Math.abs(p.euler.z)); maxPitch = Math.max(maxPitch, Math.abs(p.euler.x));
    }
    let dy = p.euler.y - hdg;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    res['hdg' + hdgDeg] = { maxRollDeg: +(maxRoll*180/Math.PI).toFixed(1),
      maxPitchDeg: +(maxPitch*180/Math.PI).toFixed(1), yawDeg: +(dy*180/Math.PI).toFixed(0) };
    p.rudderTarget = 0; p.rudder = 0;
  }
  return JSON.stringify(res);
})()`));
log(JSON.stringify(turn));
const yaws = Object.values(turn).map(v => v.yawDeg);
const rolls = Object.values(turn).map(v => v.maxRollDeg);
check('A1: поворот работает на ВСЕХ курсах (|yaw| 40..100°, разброс < 15°)',
  yaws.every(y => Math.abs(y) > 40 && Math.abs(y) < 100)
  && Math.max(...yaws) - Math.min(...yaws) < 15, `yaw=${yaws}`);
check('A2: крен на повороте умеренный (< 12° на любом курсе)',
  Math.max(...rolls) < 12, `roll=${rolls}`);
check('A3: крен НЕ превращается в дифферент (pitch < roll+4 на любом курсе)',
  Object.values(turn).every(v => v.maxPitchDeg < v.maxRollDeg + 4), JSON.stringify(turn));

// ============ B: КРЕН ОТ ВЕТРА — ОДИНАКОВО НА ВСЕХ КУРСАХ, КАП ============
log('\n===== B: КРЕН ОТ ВЕТРА (физ. модель, ветер в борт, паруса full) =====');
const heel = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  p.anchored = true; p.sailTarget = 3;
  const res = {};
  for (const w of [12, 18, 24]) {
    g.debugSetWind(w);
    const row = {};
    for (const hdgDeg of [0, 90]) {
      const hdg = hdgDeg * Math.PI / 180;
      p.position.set(0, 0, 600);
      p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
      p.quaternion.set(0, Math.sin(hdg/2), 0, Math.cos(hdg/2));
      p.wind.from = hdg;
      let rollSum = 0, pitchSum = 0, n = 0, t = g.time;
      for (let i = 0; i < 1500; i++) { t += 1/60; p.fixedStep(1/60, t); }
      for (let i = 0; i < 1500; i++) { t += 1/60; p.fixedStep(1/60, t);
        rollSum += p.euler.z; pitchSum += p.euler.x; n++; }
      row['hdg' + hdgDeg] = { roll: +((rollSum/n)*180/Math.PI).toFixed(1),
        pitch: +((pitchSum/n)*180/Math.PI).toFixed(1) };
    }
    res['w' + w] = row;
  }
  g.debugSetWind(0);
  return JSON.stringify(res);
})()`));
log(JSON.stringify(heel));
check('B1: крен растёт с ветром (12 < 18 < 24 м/с)',
  Math.abs(heel.w12.hdg0.roll) < Math.abs(heel.w18.hdg0.roll)
  && Math.abs(heel.w18.hdg0.roll) < Math.abs(heel.w24.hdg0.roll), JSON.stringify(heel));
const capDeg = jparse(ev(`window.__game.player.deckRollLim() * 180 / Math.PI`));
check('B2: крен на 90° = крену на 0° (рамка моментов — оси корпуса, ±20%)',
  Math.abs(Math.abs(heel.w18.hdg0.roll) - Math.abs(heel.w18.hdg90.roll))
    < 0.2 * Math.abs(heel.w18.hdg0.roll),
  `hdg0=${heel.w18.hdg0.roll} hdg90=${heel.w18.hdg90.roll}`);
check('B3: крен в урагане не выше физического предела кромки палубы + 3°',
  Math.abs(heel.w24.hdg0.roll) < capDeg + 3, `roll=${Math.abs(heel.w24.hdg0.roll)} cap=${capDeg.toFixed(1)}`);
check('B4: ветер НЕ дифферентует (|pitch| < 1°)',
  Object.values(heel).every(r => Math.abs(r.hdg0.pitch) < 1 && Math.abs(r.hdg90.pitch) < 1),
  `pitch=${heel.w24.hdg0.pitch}/${heel.w24.hdg90.pitch}`);
log(`физический предел крена (кромка палубы): ${capDeg.toFixed(1)}°`);

// ============ C: ПАЛУБА НАД ВОДОЙ — 3 МОДЕЛИ, ШТОРМ 24 м/с, ХОД ============
log('\n===== C: ПАЛУБА НАД ВОДОЙ (шторм 24 м/с, паруса 1/3, ход) =====');
const stormRun = async (model) => {
  ev(`(() => {
    const g = window.__game, p = g.player;
    g.applySeaModel('${model}', false);
    g.debugSetWind(24);
    if (g.sea) { g.sea.setWind(1); g.sea.setWindDir(g.wind.from); }
    return 'ok';
  })()`);
  await sleep(1500);
  return jparse(ev(`(() => {
    const g = window.__game, p = g.player;
    p.anchored = false; p.sailTarget = 1;
    let t = g.time;
    p.position.set(0, 0, 600);
    p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
    p.quaternion.set(0, Math.sin(Math.PI/2), 0, Math.cos(Math.PI/2));
    p.seedVertical(g.time);
    p.greenWater = 0; p.washedCrew = 0;
    const crew0 = p.crew;
    const q = p.quaternion;
    const aq = (vx, vy, vz) => { const tx=2*(q.y*vz-q.z*vy),ty=2*(q.z*vx-q.x*vz),tz=2*(q.x*vy-q.y*vx); return [vx+q.w*tx+(q.y*tz-q.z*ty), vy+q.w*ty+(q.z*tx-q.x*tz), vz+q.w*tz+(q.x*ty-q.y*tx)]; };
    const L = p.preset.length;
    let deckFbMin = 1e9, deckFbSum = 0, deckFbN = 0, nan = false;
    for (let i = 0; i < 1200; i++) { t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
    for (let i = 0; i < 3600; i++) {
      t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
      if (!isFinite(p.position.y)) { nan = true; break; }
      let fbMin = 1e9;
      for (const lz of [-0.44, -0.22, 0, 0.22, 0.44]) {
        const z = lz * L;
        const tt = Math.min(1, Math.max(0, (z + L/2) / L));
        const bulwark = p.preset.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, tt - 0.75) / 0.25, 1.4) + 0.3 * Math.pow(1 - tt, 2.2));
        const wF = tt < 0.45 ? 0.58 + 0.42 * tt / 0.45 : 1 - Math.pow((tt - 0.45) / 0.55, 0.75);
        const w = wF * p.preset.beam / 2;
        for (const side of [1, -1]) {
          const w0 = aq(side * w * 0.85, bulwark - 1.0, z);
          const wy = g.waterHeightAtT(w0[0] + p.position.x, w0[2] + p.position.z, t);
          fbMin = Math.min(fbMin, w0[1] + p.position.y - wy);
        }
      }
      deckFbMin = Math.min(deckFbMin, fbMin);
      deckFbSum += fbMin; deckFbN++;
    }
    return JSON.stringify({ model: '${model}', nan, deckFbMin: +deckFbMin.toFixed(2),
      deckFbAvg: +(deckFbSum / Math.max(1, deckFbN)).toFixed(2),
      greenWater: p.greenWater, washed: p.washedCrew, crew: p.crew, crew0,
      yEnd: +p.position.y.toFixed(1) });
  })()`));
};
const stormRes = {};
for (const m of ['physical', 'riding', 'storm']) {
  stormRes[m] = await stormRun(m);
  log(' ', JSON.stringify(stormRes[m]));
}
check('C1: НЕТ NaN ни в одной модели',
  !stormRes.physical.nan && !stormRes.riding.nan && !stormRes.storm.nan);
check('C2: СРЕДНИЙ борт палубы > 0 (корабль не плавает под водой)',
  stormRes.physical.deckFbAvg > 0 && stormRes.riding.deckFbAvg > 0 && stormRes.storm.deckFbAvg > 0,
  `avg=${stormRes.physical.deckFbAvg}/${stormRes.riding.deckFbAvg}/${stormRes.storm.deckFbAvg}`);
check('C3: МИНИМАЛЬНЫЙ борт палубы > −1.2 м (краткие окунания кромки в урагане допустимы, глубоко не ныряет)',
  stormRes.physical.deckFbMin > -1.2 && stormRes.riding.deckFbMin > -1.2 && stormRes.storm.deckFbMin > -1.2,
  `min=${stormRes.physical.deckFbMin}/${stormRes.riding.deckFbMin}/${stormRes.storm.deckFbMin}`);

// ============ D: СМЫВ — ТОЛЬКО ПРИ РЕАЛЬНОМ ЗАЛИВАНИИ ============
log('\n===== D: СМЫВ МАТРОСОВ =====');
// D1: штиль на якоре + прямой ход — НИКОГО не смывает
// (море должно ОПАСТЬ после штормовых секций: seaAmpSmooth ~0.22 1/с)
ev(`(() => { const g = window.__game; g.applySeaModel('physical', false); g.debugSetWind(3); return 'ok'; })()`);
await sleep(12000);
const calmWash = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  g.debugSetWind(3);
  p.anchored = false; p.sailTarget = 2;
  let t = g.time;
  p.position.set(0, 0, 600);
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
  p.quaternion.set(0, 0, 0, 1);
  p.seedVertical(g.time);
  p.greenWater = 0; p.washedCrew = 0;
  const by10 = [];
  let lastGW = 0;
  for (let i = 0; i < 5400; i++) {
    t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    const sp = p.speed(); if (sp > 0.01 && sp < 4.5) { const kk = 5.0 / sp; p.velocity.x *= kk; p.velocity.z *= kk; }
    if ((i + 1) % 600 === 0) {
      by10.push({ s: (i + 1) / 60, gw: p.greenWater - lastGW, z: +p.position.z.toFixed(0),
        y: +p.position.y.toFixed(1), amp: +(window.__sea.seaAmp).toFixed(2) });
      lastGW = p.greenWater;
    }
  }
  return JSON.stringify({ greenWater: p.greenWater, washed: p.washedCrew, crew: p.crew, by10 });
})()`));
log('  D1 штиль:', JSON.stringify(calmWash));
check('D1: в штиле/свежем ветре НЕ смывает (greenWater ~0, washed 0)',
  calmWash.greenWater === 0 && calmWash.washed === 0, JSON.stringify(calmWash));
// D2: ураган riding — смывает, но не чаще 1/25 с и экипаж не уходит в минус
const stormWash = stormRes.riding;
check('D2: в урагане смыв РЕДКИЙ (≤ 1 за 25 с → ≤ 4 за 90 с)',
  stormWash.washed <= 4, `washed=${stormWash.washed}`);
check('D3: смытые учтены в экипаже (crew уменьшился ровно на washed)',
  stormWash.crew === stormWash.crew0 - stormWash.washed,
  `crew=${stormWash.crew} crew0=${stormWash.crew0} washed=${stormWash.washed}`);

// ============ E: РАСЧЁТЫ ОТ ПАЛУБЫ ============
log('\n===== E: ОТЧЁТ РАСЧЁТОВ ОТ ПАЛУБЫ =====');
const refs = jparse(ev(`(() => {
  const p = window.__game.player, P = p.preset;
  const midBulwark = P.freeboard * (0.82 + 0.3 * Math.pow(0.5, 2.2));
  return JSON.stringify({
    freeboardBort: P.freeboard,
    planhairMid: +midBulwark.toFixed(2),
    deckMid: +(midBulwark - 1.0).toFixed(2),
    stormDeckRef: +p.buoy.vessel.deck.toFixed(2),
    gwCheckUses: 'hullProfile(t).bulwark - 1.0 (кромки обоих бортов, кватернион)',
  });
})()`));
log(' ', JSON.stringify(refs));
check('E1: шторм-модуль меряет заливание от ПАЛУБЫ (deck = bulwark−1, не борт)',
  Math.abs(refs.stormDeckRef - refs.deckMid) < 0.05,
  `deck=${refs.stormDeckRef} (борт был бы ${refs.freeboardBort})`);

// ============ F: ПЕРЕКЛЮЧЕНИЕ МОДЕЛИ БЕЗ ТРАНЗИЕНТА ============
log('\n===== F: переключение модели моря в шторме (без «плюханья») =====');
ev(`(() => { const g = window.__game; g.applySeaModel('physical', false); g.debugSetWind(20); for (let i = 0; i < 300; i++) g.updateWeather(0.1); return 'ok'; })()`);
const switchTest = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  p.anchored = true; p.sailTarget = 0;
  p.position.set(0, 0, 600);
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
  p.quaternion.set(0, 0, 0, 1);
  p.seedVertical(g.time);
  p.greenWater = 0;
  let t = g.time;
  for (let i = 0; i < 600; i++) { t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  const gwPhys = p.greenWater;
  g.applySeaModel('riding', false);
  p.seedVertical(g.time);
  p.greenWater = 0;
  for (let i = 0; i < 600; i++) { t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  const gwFirst10 = p.greenWater;
  for (let i = 0; i < 600; i++) { t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  const gwNext10 = p.greenWater - gwFirst10;
  g.applySeaModel('physical', false);
  return JSON.stringify({ gwPhysAnchored10s: gwPhys, gwFirst10AfterSwitch: gwFirst10, gwNext10Steady: gwNext10 });
})()`));
log(' ', JSON.stringify(switchTest));
check('F1: после переключения НЕТ всплеска зелёной воды (первые 10 с ≤ штатные следующие 10 с × 1.5)',
  switchTest.gwFirst10AfterSwitch <= Math.max(10, switchTest.gwNext10Steady * 1.5), JSON.stringify(switchTest));
check('F2: якорь в физической модели — зелёной воды нет (gwPhysAnchored10s мало)',
  switchTest.gwPhysAnchored10s < 20, `gwPhys=${switchTest.gwPhysAnchored10s}`);

log('\nJS errors:', jparse(ev(`window.__jsErrors`)));
log(fails === 0 ? '\n=== ALL OK ===' : `\n=== FAILS: ${fails} ===`);
run('close --all');
