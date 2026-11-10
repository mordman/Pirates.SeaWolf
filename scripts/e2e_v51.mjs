// E2E Task 33: ЕДИНОЕ МОРЕ (Герстнер + FBM), НОВАЯ физика/плавучесть,
// настройки шлюпок/упрощённого управления/каркаса, фикс компаса.
//  (A) ЕДИНОЕ МОРЕ: нет моделей моря/шторм-модуля; высота волн от
//      ветра (монотонно); волны движутся; ГАСНУТ у берега острова
//  (B) ФИЗИКА: реалистичная по умолчанию; простая — корабль ПЛЫВЁТ
//      ПО поверхности (не проваливается внутрь волн); реалистичная
//      в шторм держит палубу над водой; переключение без NaN
//  (C) КОМПАС/КРЕН (фикс «сильно кренит по правому борту»):
//      HUD windRelDeg = фактическому углу (раньше 90° ошибка);
//      крен СИММЕТРИЧЕН (порт↔штирборт), растёт с ветром, в штиле 0
//  (D) СМЫВ МАТРОСОВ: вероятность по умолчанию 30%; 100% — каждое
//      глубокое заливание палубы смывает; 0% — никогда; в спокойную
//      погоду не срабатывает вовсе
//  (E) ШЛЮПКИ: настройка «количество» 2→1→0: ялы на шлюпбалках,
//      спуск работает/отказ
//  (F) УПРОЩЁННОЕ УПРАВЛЕНИЕ: руль на нулевой скорости работает,
//      паруса тянут в левентик
//  (G) КАРКАС: вода/корабли/острова/растительность — по категории
//  (H) ПАНЕЛЬ+СОХРАНЕНИЕ: вкладка «Физика», «Количество шлюпок»,
//      «Упрощённое управление», каркас в «Графике»; схема v6
//  (I) 0 ошибок JS + скриншоты
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
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
run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(500);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// ================= A: ЕДИНОЕ МОРЕ =================
log('\n===== A: ЕДИНОЕ МОРЕ (Герстнер + FBM, без моделей) =====');
const seaA = jparse(ev(`(() => {
  const g = window.__game, s = g.settings;
  return JSON.stringify({
    hasSeaModule: 'sea' in g,
    seaModelInSettings: 'seaModel' in s.weather || 'sea' in s,
    buoyancyOldSection: 'buoyancy' in s,
    physicsSection: !!s.physics && !!s.physics.buoyancy,
    amp0: +g.water.material.uniforms.uAmpLo.value.toFixed(3),
    terrainTex: !!g.water.material.uniforms.uTerrain.value,
    wind01: +g.water.material.uniforms.uWind01.value.toFixed(2),
  });
})()`));
log(JSON.stringify(seaA));
check('A1: штормового модуля и моделей моря НЕТ (sea/seaModel удалены)',
  seaA.hasSeaModule === false && seaA.seaModelInSettings === false && seaA.buoyancyOldSection === false);
check('A2: настройки physics + рельеф в шейдере воды (прибой)',
  seaA.physicsSection === true && seaA.terrainTex === true);

const windCurve = jparse(ev(`(() => {
  const g = window.__game, out = {};
  for (const w of [2, 7.5, 12, 18, 24]) {
    g.debugSetWind(w);
    g.stepDebug(14);
    out['w' + w] = { env: +window.__sea.envelope.toFixed(2), amp: +window.__sea.seaAmp.toFixed(3) };
  }
  g.debugSetWind(7.5);
  g.stepDebug(6);
  return JSON.stringify(out);
})()`));
log(JSON.stringify(windCurve));
check('A3: высота волн растёт с ветром монотонно (2 < 7.5 < 12 < 18 < 24 м/с)',
  windCurve.w2.env < windCurve['w7.5'].env && windCurve['w7.5'].env < windCurve.w12.env
  && windCurve.w12.env < windCurve.w18.env && windCurve.w18.env < windCurve.w24.env,
  `env: ${[2, 7.5, 12, 18, 24].map(w => windCurve['w' + w].env).join(' → ')}`);
check('A4: штиль — рябь (огибающая < 1.2 м), ураган — валы (> 4 м)',
  windCurve.w2.env < 1.2 && windCurve.w24.env > 4.0, `штиль ${windCurve.w2.env} / шторм ${windCurve.w24.env}`);

const waveMove = jparse(ev(`(() => {
  const g = window.__game, x = 0, z = -2600;
  const h1 = g.waterHeightAtT(x, z, g.time);
  const h2 = g.waterHeightAtT(x, z, g.time + 3.5);
  return JSON.stringify({ h1: +h1.toFixed(3), h2: +h2.toFixed(3) });
})()`));
check('A5: волны ДВИЖУТСЯ (высота в точке меняется со временем)',
  Math.abs(waveMove.h1 - waveMove.h2) > 0.05, JSON.stringify(waveMove));

const shore = jparse(ev(`(() => {
  const g = window.__game, isl = g.world.islands[2], ang = 0.7;
  let coast = isl.r * 2;
  for (let rr = isl.r * 0.3; rr < isl.r * 2; rr += 4) {
    if (window.__heightAt(isl.cx + Math.cos(ang) * rr, isl.cz + Math.sin(ang) * rr) < 0) { coast = rr; break; }
  }
  const at = (off) => {
    const x = isl.cx + Math.cos(ang) * (coast + off), z = isl.cz + Math.sin(ang) * (coast + off);
    let s = 0; for (let k = 0; k < 8; k++) s += Math.abs(g.waterHeightAtT(x, z, g.time + k * 0.7));
    return +(s / 8).toFixed(3);
  };
  return JSON.stringify({ coast: Math.round(coast), at0: at(0), at12: at(12), at90: at(90), at250: at(250) });
})()`));
log(JSON.stringify(shore));
check('A6: волны РАЗБИВАЮТСЯ об остров: у кромки воды ≈ 0, в море — полные',
  shore.at0 < 0.12 && shore.at12 < shore.at250 * 0.6 && shore.at90 < shore.at250 + 0.8,
  `кромка ${shore.at0} / +12м ${shore.at12} / +90м ${shore.at90} / море ${shore.at250}`);

// ================= B: ФИЗИКА realistic/simple =================
log('\n===== B: ФИЗИКА (реалистичная / простая) =====');
const physDef = jparse(ev(`window.__sea.physics.mode`));
check('B1: по умолчанию РЕАЛИСТИЧНАЯ (Архимед по точкам корпуса)', physDef === 'realistic', physDef);

// штормовое море для обеих моделей
ev(`(() => { const g = window.__game; g.debugSetWeather('storm', 24, 40); g.stepDebug(20); return 'storm built'; })()`);
const freeb = (mode) => jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  const T = window.__THREE;
  g.applyPhysicsMode('${mode}', false);
  p.anchored = false; p.sailTarget = 1; p.sailFrac = 1;
  p.position.set(0, 0, -2600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.seedVertical(g.time);
  const prof = p.preset;
  const deckY = Math.tan(p.deckRollLim() / 0.85) * p.halfWidthAt(0);
  let t = g.time, sum = 0, min = 1e9, n = 0, bad = 0;
  const v = new T.Vector3();
  for (let i = 0; i < 30 * 60; i++) {
    t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    if (i > 10 * 60) {
      let fb = 1e9;
      for (const lz of [-prof.length * 0.46, 0, prof.length * 0.46]) {
        for (const lx of [0, -p.halfWidthAt(lz), p.halfWidthAt(lz)]) {
          v.set(lx, deckY, lz).applyQuaternion(p.quaternion).add(p.position);
          fb = Math.min(fb, v.y - g.waterHeightAtT(v.x, v.z, t));
        }
      }
      sum += fb; min = Math.min(min, fb); n++;
      if (!isFinite(fb)) bad++;
    }
  }
  g.applyPhysicsMode('realistic', false);
  return JSON.stringify({ mode: '${mode}', mean: +(sum/n).toFixed(2), min: +min.toFixed(2), bad });
})()`));
const fbReal = freeb('realistic');
const fbSimple = freeb('simple');
log(JSON.stringify(fbReal), JSON.stringify(fbSimple));
check('B2: РЕАЛИСТИЧНАЯ в шторм: палуба в среднем НАД водой, глубоких нырков НЕТ (кромка > −1.3 м)',
  fbReal.mean > 0.15 && fbReal.min > -1.3 && fbReal.bad === 0, JSON.stringify(fbReal));
check('B3: ПРОСТАЯ: корабль ПЛЫВЁТ ПО волнах (не проваливается внутрь)',
  fbSimple.mean > 0.45 && fbSimple.min > -0.75 && fbSimple.bad === 0, JSON.stringify(fbSimple));
check('B4: простая держит палубу не хуже реалистичной (mean выше или близко)',
  fbSimple.mean > fbReal.mean - 0.35, `simple ${fbSimple.mean} vs real ${fbReal.mean}`);

const sw = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  const ok = { nan: 0 };
  for (const m of ['simple', 'realistic']) {
    g.applyPhysicsMode(m, false);
    p.position.set(100, 5, -2600); p.seedVertical(g.time);
    g.stepDebug(2);
    if (!isFinite(p.position.x) || !isFinite(p.position.y) || !isFinite(p.quaternion.x)) ok.nan++;
  }
  g.debugSetWeather('clear', 7.5, 40);
  return JSON.stringify(ok);
})()`));
check('B5: переключение физики на лету БЕЗ NaN', sw.nan === 0, JSON.stringify(sw));

// ================= C: КОМПАС + СИММЕТРИЯ КРЕНА =================
log('\n===== C: КОМПАС (фикс 90°) + СИММЕТРИЯ КРЕНА =====');
const compassCheck = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  const out = [];
  for (const hdgDeg of [0, 70, 180, 300]) {
    const h = hdgDeg * Math.PI / 180;
    p.quaternion.set(0, Math.sin(h/2), 0, Math.cos(h/2));
    p.position.set(0, 0, 600);
    for (const wfDeg of [0, 90, 200, 315]) {
      const a = wfDeg * Math.PI / 180;
      p.wind.from = a; g.weather.wind.from = a; g.wind.from = a;
      g.stepFrame(1/30);
      const f = p.forward, wf = { x: Math.cos(a), z: Math.sin(a) };
      const dot = f.x * wf.x + f.z * wf.z;
      const cross = f.x * wf.z - f.z * wf.x;
      const trueRel = Math.atan2(cross, dot) * 180 / Math.PI;
      const trueCompass = ((trueRel % 360) + 360) % 360;
      const hud = g.hud.windRelDeg;
      out.push({ hdgDeg, wfDeg, hud, true: +trueCompass.toFixed(0), diff: Math.min(Math.abs(hud - trueCompass), 360 - Math.abs(hud - trueCompass)) });
    }
  }
  return JSON.stringify(out);
})()`));
const maxDiff = Math.max(...compassCheck.map(r => r.diff));
check('C1: HUD-компас ветра = фактическому углу на ВСЕХ курсах (макс Δ < 4°)',
  maxDiff < 4, `макс Δ=${maxDiff}° (пример: ${JSON.stringify(compassCheck[1])})`);

const heelSym = jparse(ev(`(() => {
  const g = window.__game, p = g.player, out = {};
  for (const hdgDeg of [0, 90]) {
    const h = hdgDeg * Math.PI / 180;
    for (const [name, wf] of [['port', -h], ['stb', -h + Math.PI]]) {
      p.anchored = true; p.sailTarget = 3; p.sailFrac = 1;
      p.quaternion.set(0, Math.sin(h/2), 0, Math.cos(h/2));
      p.position.set(0, 0, 600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
      p.wind.from = wf; p.wind.speed = 12;
      let t = g.time, sum = 0, n = 0;
      for (let i = 0; i < 20 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); }
      for (let i = 0; i < 30 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); sum += p.euler.z; n++; }
      out[name + hdgDeg] = +(sum / n * 57.3).toFixed(2);
    }
  }
  p.sailTarget = 0; p.anchored = false;
  return JSON.stringify(out);
})()`));
log(JSON.stringify(heelSym));
check('C2: крен СИММЕТРИЧЕН: ветер с порта → +крен, с штирборта → −крен (|Δ| < 1.5°)',
  heelSym.port0 > 2 && heelSym.stb0 < -2 && Math.abs(heelSym.port0 + heelSym.stb0) < 1.5
  && heelSym.port90 > 2 && heelSym.stb90 < -2 && Math.abs(heelSym.port90 + heelSym.stb90) < 1.5,
  `hdg0: ${heelSym.port0}/${heelSym.stb0} hdg90: ${heelSym.port90}/${heelSym.stb90}`);

const heelWind = jparse(ev(`(() => {
  const g = window.__game, p = g.player, out = {};
  for (const w of [12, 24]) {
    p.anchored = true; p.sailTarget = 3; p.sailFrac = 1;
    p.quaternion.identity(); p.position.set(0, 0, 600);
    p.velocity.set(0,0,0); p.angular.set(0,0,0);
    p.wind.from = 0; p.wind.speed = w;
    let t = g.time, sum = 0, n = 0;
    for (let i = 0; i < 20 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); }
    for (let i = 0; i < 25 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); sum += p.euler.z; n++; }
    out['w' + w] = +(sum / n * 57.3).toFixed(2);
  }
  p.sailTarget = 0;
  p.wind.speed = 0; p.anchored = true; p.sailFrac = 0; p.sailTarget = 0;
  let t2 = g.time, sum2 = 0, n2 = 0;
  for (let i = 0; i < 25 * 60; i++) { t2 += 1/60; p.fixedStep(1/60, t2); sum2 += p.euler.z; n2++; }
  out.calm = +(sum2 / n2 * 57.3).toFixed(2);
  p.anchored = false;
  return JSON.stringify(out);
})()`));
log(JSON.stringify(heelWind));
check('C3: крен растёт с ветром (12 < 24 м/с), в штиле ≈ 0',
  Math.abs(heelWind.w12) < Math.abs(heelWind.w24) && Math.abs(heelWind.calm) < 1.5,
  `12м/с ${heelWind.w12}° / 24м/с ${heelWind.w24}° / штиль ${heelWind.calm}°`);
const deckLimDeg = jparse(ev(`window.__sea.deckRollLimDeg`));
check('C4: крен урагана в пределах кромки палубы + 3°',
  Math.abs(heelWind.w24) < deckLimDeg + 3, `${heelWind.w24}° vs лимит ${deckLimDeg}°`);

// ================= D: СМЫВ МАТРОСОВ (30%) =================
log('\n===== D: ЗАЛИТИЕ ПАЛУБЫ → СМЫВ МАТРОСОВ (30% → настройки) =====');
const washDef = jparse(ev(`window.__sea.physics.washProbability`));
check('D1: вероятность смыва по умолчанию 30%', Math.abs(washDef - 0.3) < 0.001, String(washDef));

const washRun = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  const res = {};
  const setProb = (pct) => {
    const s = structuredClone(g.settings);
    s.physics.buoyancy.washProbabilityPct = pct;
    g.applySettings(s);
  };
  g.debugSetWeather('storm', 24, 40);
  g.stepDebug(16);
  const run = (label, seconds) => {
    p.anchored = false; p.sailTarget = 3; p.sailFrac = 1;
    p.position.set(0, 0, -2600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
    p.seedVertical(g.time);
    const w0 = p.washedCrew, gw0 = p.greenWater, crew0 = p.crew;
    let t = g.time;
    for (let i = 0; i < seconds * 60; i++) {
      t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    }
    res[label] = { washed: p.washedCrew - w0, floods: p.greenWater - gw0, crewLost: crew0 - p.crew };
  };
  setProb(100); run('p100', 70);
  setProb(0); run('p0', 70);
  setProb(30);
  g.debugSetWeather('clear', 6, 40);
  g.stepDebug(10);
  run('calm', 40);
  return JSON.stringify(res);
})()`));
log(JSON.stringify(washRun));
check('D2: 100% — каждое глубокое заливание смывает (в шторм люди уходят за борт)',
  washRun.p100.floods >= 5 && washRun.p100.washed >= 2, JSON.stringify(washRun.p100));
check('D3: 0% — НИКОГО не смывает при тех же залитиях',
  washRun.p0.floods >= 5 && washRun.p0.washed === 0, JSON.stringify(washRun.p0));
check('D4: в спокойную погоду смыва/залитий нет',
  washRun.calm.floods === 0 && washRun.calm.washed === 0, JSON.stringify(washRun.calm));

// ================= E: ШЛЮПКИ (количество — настройка) =================
log('\n===== E: КОЛИЧЕСТВО ШЛЮПОК (настройка) =====');
const boats = jparse(ev(`(() => {
  const g = window.__game, out = {};
  const setCount = (n) => {
    const s = structuredClone(g.settings);
    s.gameplay.boatCount = n;
    g.applySettings(s);
  };
  out.def = { count: g.boatLaunch.boatCount(), stb: !!g.player.visual.boat, port: !!g.player.visual.boat2 };
  setCount(1); g.stepDebug(1);
  out.n1 = { count: g.boatLaunch.boatCount(), stb: !!g.player.visual.boat, port: !!g.player.visual.boat2 };
  out.launch1 = g.boatLaunch.tryLaunch(false);
  g.stepDebug(9);
  out.afloat1 = g.boatLaunch.phase;
  g.boatLaunch.abort(); g.stepDebug(1);
  setCount(0); g.stepDebug(1);
  out.n0 = { count: g.boatLaunch.boatCount(), stb: !!g.player.visual.boat, port: !!g.player.visual.boat2 };
  out.launch0 = g.boatLaunch.tryLaunch(false);
  setCount(2); g.stepDebug(1);
  out.n2 = { count: g.boatLaunch.boatCount(), stb: !!g.player.visual.boat, port: !!g.player.visual.boat2 };
  return JSON.stringify(out);
})()`));
log(JSON.stringify(boats));
check('E1: по умолчанию 2 шлюпки (штирборт + порт)',
  boats.def.count === 2 && boats.def.stb === true && boats.def.port === true, JSON.stringify(boats.def));
check('E2: настройка «1» — только штирбортная, спуск работает',
  boats.n1.count === 1 && boats.n1.stb === true && boats.n1.port === false && boats.launch1 === null,
  JSON.stringify({ n1: boats.n1, launch: boats.launch1, phase: boats.afloat1 }));
check('E3: настройка «0» — шлюпок НЕТ, спуск отказывает',
  boats.n0.count === 0 && boats.n0.stb === false && boats.n0.port === false && boats.launch0 !== null,
  JSON.stringify({ n0: boats.n0, отказ: boats.launch0 }));
check('E4: возврат к «2» — обе на шлюпбалках',
  boats.n2.count === 2 && boats.n2.stb === true && boats.n2.port === true, JSON.stringify(boats.n2));

// ================= F: УПРОЩЁННОЕ УПРАВЛЕНИЕ =================
log('\n===== F: УПРОЩЁННОЕ УПРАВЛЕНИЕ =====');
const simpleCtl = jparse(ev(`(() => {
  const g = window.__game, p = g.player, out = {};
  const setCtl = (v) => {
    const s = structuredClone(g.settings);
    s.gameplay.simpleControls = v;
    g.applySettings(s);
  };
  g.debugSetWeather('clear', 8, 40);
  const steerTest = () => {
    p.position.set(0, 0, 600); p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
    p.quaternion.identity(); p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
    p.rudderTarget = 1; p.rudder = 1;
    let t = g.time, hdg0 = p.heading;
    for (let i = 0; i < 5 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); }
    p.rudderTarget = 0; p.rudder = 0;
    let d = p.heading - hdg0; d = Math.atan2(Math.sin(d), Math.cos(d));
    return +(d * 57.3).toFixed(1);
  };
  setCtl(false); out.steeringNormal = steerTest();
  setCtl(true); out.steeringSimple = steerTest();
  const noseTest = (v) => {
    setCtl(v);
    p.position.set(0, 0, 600); p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
    p.quaternion.identity(); p.anchored = false; p.sailTarget = 3; p.sailFrac = 1;
    p.wind.from = Math.PI / 2; p.wind.speed = 10;
    let t = g.time;
    for (let i = 0; i < 30 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); }
    const kn = +(p.speed() * 1.944).toFixed(2);
    return kn;
  };
  out.sailNormal = noseTest(false);
  out.sailSimple = noseTest(true);
  setCtl(false);
  p.sailTarget = 0; p.sailFrac = 0;
  return JSON.stringify(out);
})()`));
log(JSON.stringify(simpleCtl));
check('F1: обычное управление — на нулевой скорости руль почти не крутит (< 2°)',
  Math.abs(simpleCtl.steeringNormal) < 2, simpleCtl.steeringNormal + '°');
check('F2: упрощённое — руль работает СТОЯ (> 8° за 5 с)',
  Math.abs(simpleCtl.steeringSimple) > 8, simpleCtl.steeringSimple + '°');
check('F3: упрощённое — паруса тянут при ветре В НОС (левентик) заметно сильнее',
  simpleCtl.sailSimple > simpleCtl.sailNormal * 2 + 0.3,
  `обычные ${simpleCtl.sailNormal} уз / упрощённые ${simpleCtl.sailSimple} уз`);

// ================= G: КАРКАС =================
log('\n===== G: КАРКАС (треугольники без текстур, по категориям) =====');
const wire = jparse(ev(`(() => {
  const g = window.__game, out = {};
  const probe = () => {
    let ship = false, veg = false, isl = false;
    g.player.visual.group.traverse(o => { if (o.material && o.material.wireframe) ship = true; });
    g.world.group.traverse(o => {
      if (o.userData.wire === 'veg' && o.material && o.material.wireframe) veg = true;
      if (o.userData.wire === 'island' && o.material && o.material.wireframe) isl = true;
    });
    return { water: g.water.material.wireframe, ship, veg, isl };
  };
  g.applyWireframe({ water: true, ships: false, islands: false, vegetation: false });
  out.waterOnly = probe();
  g.applyWireframe({ water: false, ships: true, islands: true, vegetation: true });
  out.allButWater = probe();
  g.applyWireframe({ water: false, ships: false, islands: false, vegetation: false });
  out.none = probe();
  return JSON.stringify(out);
})()`));
log(JSON.stringify(wire));
check('G1: вода отдельно (каркас воды включается, остальное нет)',
  wire.waterOnly.water === true && wire.waterOnly.ship === false && wire.waterOnly.isl === false && wire.waterOnly.veg === false,
  JSON.stringify(wire.waterOnly));
check('G2: корабли/острова/растительность — каждая категория включается',
  wire.allButWater.water === false && wire.allButWater.ship === true && wire.allButWater.isl === true && wire.allButWater.veg === true,
  JSON.stringify(wire.allButWater));
check('G3: сброс — все текстуры возвращаются',
  wire.none.water === false && wire.none.ship === false && wire.none.isl === false && wire.none.veg === false);

// ================= H: ПАНЕЛЬ + СОХРАНЕНИЕ =================
log('\n===== H: ПАНЕЛЬ НАСТРОЕК + СОХРАНЕНИЕ (схема v6) =====');
// запустить игру (панель настроек доступна после старта) и открыть настройки
ev(`(() => { const g = window.__game; if (!g.started) g.start(); return 'started ' + g.started; })()`);
await sleep(400);
run(`eval "(() => { const b = [...document.querySelectorAll('button')].find(b => /Настройки/i.test(b.textContent)); if (b) b.click(); return 'opened'; })()"`.replace(/\n/g, ' '));
await sleep(600);
const tabs = jparse(ev(`(() => {
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  return JSON.stringify({
    physicsTab: btns.includes('Физика'),
    weatherTab: btns.includes('Погода'),
    seaModelSelect: [...document.querySelectorAll('option')].some(o => /Архимед, режет|штормовой модуль \\(sea/i.test(o.textContent)),
  });
})()`));
// перейти на вкладку Физика
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Физика'); if (b) b.click(); return 'ok'; })()`);
await sleep(400);
const physPanel = jparse(ev(`(() => {
  const txt = document.body.innerText;
  return JSON.stringify({
    modeSelect: [...document.querySelectorAll('option')].some(o => /Простая \\(по поверхности/.test(o.textContent)),
    washSlider: txt.includes('Вероятность смыва матроса'),
    washDefault: txt.includes('30%'),
    draftSlider: txt.includes('глубже / мельче'),
    heelSlider: txt.includes('Макс. крен'),
  });
})()`));
// вкладка Игра
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Игра'); if (b) b.click(); return 'ok'; })()`);
await sleep(400);
const gamePanel = jparse(ev(`(() => {
  const txt = document.body.innerText;
  return JSON.stringify({
    boatCount: txt.includes('Количество шлюпок'),
    simpleCtl: txt.includes('Упрощённое управление'),
  });
})()`));
// вкладка Графика
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Графика'); if (b) b.click(); return 'ok'; })()`);
await sleep(400);
const gfxPanel = jparse(ev(`(() => {
  const txt = document.body.innerText;
  return JSON.stringify({
    wire: txt.includes('КАРКАС') && txt.includes('ТРЕУГОЛЬНИКИ'),
    waterChk: txt.includes('Вода'),
    shipsChk: txt.includes('Корабли'),
    islandsChk: txt.includes('Острова'),
    vegChk: txt.includes('Растительность'),
  });
})()`));
// закрыть панель
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Готово'); if (b) b.click(); return 'closed'; })()`);
log(JSON.stringify({ tabs, physPanel, gamePanel, gfxPanel }));
check('H1: вкладка «Физика» в панели; селекта «Модель моря» больше НЕТ',
  tabs.physicsTab === true && tabs.seaModelSelect === false);
check('H2: на «Физике»: режим (Простая…), «Вероятность смыва» = 30%, осадка',
  physPanel.modeSelect && physPanel.washSlider && physPanel.washDefault && physPanel.draftSlider,
  JSON.stringify(physPanel));
check('H3: на «Игра»: «Количество шлюпок» + «Упрощённое управление»',
  gamePanel.boatCount && gamePanel.simpleCtl, JSON.stringify(gamePanel));
check('H4: на «Графике»: каркас по категориям (вода/корабли/острова/растительность)',
  gfxPanel.wire && gfxPanel.waterChk && gfxPanel.shipsChk && gfxPanel.islandsChk && gfxPanel.vegChk,
  JSON.stringify(gfxPanel));

// сохранение: пишем v6-настройки в localStorage, перезагружаемся —
// настройки должны примениться (loadSettings читает новую схему)
const persisted = jparse(ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.physics.mode = 'simple';
  s.gameplay.boatCount = 1;
  s.gameplay.simpleControls = true;
  s.graphics.wireframe.water = true;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify({ ...s, v: 6 }));
  return 'saved';
})()`));
run('reload');
await sleep(9000);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(500);
ev(`window.__game.start()`);
await sleep(400);
const afterReload = jparse(ev(`(() => {
  const g = window.__game;
  const raw = JSON.parse(localStorage.getItem('seawolves.settings.v1'));
  return JSON.stringify({
    v: raw.v, mode: g.settings.physics.mode, physApplied: window.__sea.physics.mode,
    boats: g.boatLaunch.boatCount(), ctl: g.settings.gameplay.simpleControls,
    wf: g.settings.graphics.wireframe.water,
  });
})()`));
log(JSON.stringify(afterReload));
check('H5: настройки v6 читаются после перезагрузки и ПРИМЕНЯЮТСЯ (режим/шлюпки/каркас; схема перезаписана в v11, Task 38)',
  afterReload.v === 11 && afterReload.mode === 'simple' && afterReload.physApplied === 'simple'
  && afterReload.boats === 1 && afterReload.ctl === true && afterReload.wf === true,
  JSON.stringify(afterReload));
// вернуть дефолты в localStorage
const defaultsBack = run(`eval "(() => { const g = window.__game; const s = structuredClone(g.settings); s.physics.mode = 'realistic'; s.gameplay.boatCount = 2; s.gameplay.simpleControls = false; s.graphics.wireframe = { water: false, ships: false, islands: false, vegetation: false }; g.applySettings(s); localStorage.setItem('seawolves.settings.v1', JSON.stringify({ ...s, v: 6 })); return 'defaults restored'; })()"`.replace(/\n/g, ' '));
log(defaultsBack);

// ================= I: СКРИНШОТЫ + ОШИБКИ =================
log('\n===== I: СКРИНШОТЫ + ОШИБКИ JS =====');
run('mkdir scripts/shots 2>/dev/null; true');
// прибой у скалистого острова (горы от берега): шторм, корабль у острова
ev(`(() => {
  const g = window.__game;
  g.debugSetWeather('storm', 22, 40);
  const isl = g.world.islands[2];
  const dx = Math.cos(0.7), dz = Math.sin(0.7);
  g.player.position.set(isl.cx + dx * (isl.r + 160), 0, isl.cz + dz * (isl.r + 160));
  g.player.seedVertical(g.time);
  g.player.sailTarget = 0; g.player.anchored = true;
  return 'near island';
})()`);
await sleep(5500);
run('screenshot scripts/shots/t33_surf --full');
// шторм + простая физика: корабль на поверхности
ev(`(() => {
  const g = window.__game;
  g.applyPhysicsMode('simple', false);
  g.player.position.set(0, 0, -2600); g.player.seedVertical(g.time);
  g.player.sailTarget = 2; g.player.anchored = false;
  return 'simple storm';
})()`);
await sleep(4500);
run('screenshot scripts/shots/t33_simple_storm --full');
// каркас: вода+корабль
ev(`(() => {
  const g = window.__game;
  g.applyPhysicsMode('realistic', false);
  g.debugSetWeather('clear', 8, 40);
  g.applyWireframe({ water: true, ships: true, islands: false, vegetation: false });
  return 'wireframe';
})()`);
await sleep(4500);
run('screenshot scripts/shots/t33_wireframe --full');
ev(`(() => { const g = window.__game; g.applyWireframe({ water: false, ships: false, islands: false, vegetation: false }); return 'wf off'; })()`);
await sleep(1500);

const errs = jparse(ev(`window.__jsErrors ? window.__jsErrors.length : -1`));
check('I1: 0 ошибок JS за весь прогон', errs === 0, `ошибок: ${errs}`);
if (errs > 0) log('errors:', JSON.stringify(jparse(ev(`window.__jsErrors`))));

log(`\n===== ИТОГ: ${fails === 0 ? 'ALL OK' : fails + ' FAIL'} =====`);
run('close --all');
process.exit(fails === 0 ? 0 : 1);
