// E2E Task 34: (1) ПЕНА НА ВОЛНАХ УДАЛЕНА — открытое море чистое,
// прибой у островов остаётся; (2) корабль ПЛЫВЁТ ПО ВОНЛЕ (вертикаль
// следует поверхности — не режет и не проваливается внутрь вала),
// нос всходит на гребень; (3) крен от ветра ослаблен вдвое — нет
// постоянного крена на борт; (4) смыв матросов работает (порог
// заливания 0.15 м, станции нос+мидель); (5) настройка «Качество
// пены» удалена (схема v7); (6) 0 ошибок JS + скриншоты.
import { execSync } from 'node:child_process';
const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// Task 36: тяжёлые сцены занимают демон — повторяем с паузой
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
const py = (script) => {
  try { return execSync(`python3 ${script}`, { encoding: 'utf8', timeout: 60000 }).trim(); }
  catch (e) { return `ERR ${e.stdout || ''}`.trim(); }
};
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 6; i++) {
    if (typeof v !== 'string') return v;
    let p;
    try { p = JSON.parse(v); } catch {
      const m = v.match(/\{[\s\S]*\}/) || v.match(/\[[\s\S]*\]/);
      if (!m) return v;
      v = m[0];
      continue;
    }
    if (typeof p === 'string') { v = p; continue; }
    return p;
  }
  return v;
};
const isT = (v) => v === true || v === 'true';
const log = (...a) => console.log(...a);

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(300);
ev(`window.__game.start()`);
await sleep(400);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// ================= A: ПЕНА УДАЛЕНА =================
log('\n===== A: ПЕНА НА ВОЛНАХ УДАЛЕНА (море чистое) =====');
const foamCfg = jparse(ev(`(() => {
  const g = window.__game, s = g.settings;
  return JSON.stringify({
    foamUniforms: ('uFoamTex' in g.water.material.uniforms) || ('uFoamQ' in g.water.material.uniforms),
    foamQualityInSettings: 'foamQuality' in s.graphics,
    terrainTex: !!g.water.material.uniforms.uTerrain.value,
    wind01: +g.water.material.uniforms.uWind01.value.toFixed(2),
  });
})()`));
log(JSON.stringify(foamCfg));
check('A1: пеновых uniform/настроек НЕТ, рельеф для прибоя есть',
  foamCfg.foamUniforms === false && foamCfg.foamQualityInSettings === false && foamCfg.terrainTex === true);

// скриншот открытого моря (камера над кораблем, вид сверху) — пиксельный анализ
ev(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera, p = g.player;
  const wg = g.worldGroup.position;
  const px = p.position.x + wg.x, pz = p.position.z + wg.z;
  const pose = { pos: [px, p.position.y + 130, pz + 30], look: [px, p.position.y, pz] };
  window.__origUpdate = rig.update.bind(rig);
  rig.update = () => {
    cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    cam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
  };
  return 'pose';
})()`);
await sleep(1200);
run('screenshot /home/z/my-project/scripts/shots/t34_e2e_sea.png');
await sleep(300);
ev(`(() => { const g = window.__game; g.rig.update = window.__origUpdate; return 'ok'; })()`);
const foamPct = parseFloat(py('/home/z/my-project/scripts/e2e_foam_px.py /home/z/my-project/scripts/shots/t34_e2e_sea.png'));
check('A2: открытое море ЧИСТОЕ (белёсых пикселей < 5%; у игрока было 87.7%; блики/след не в счёт)',
  isFinite(foamPct) && foamPct < 5.0, `${foamPct}%`);

// прибой: волны гаснут у кромки острова (как v51 A6)
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
  return JSON.stringify({ coast: Math.round(coast), at0: at(0), at12: at(12), at250: at(250) });
})()`));
log(JSON.stringify(shore));
check('A3: волны РАЗБИВАЮТСЯ об остров (у кромки ≈ 0, в море полные) — прибой сохранён',
  shore.at0 < 0.12 && shore.at12 < shore.at250 * 0.6, `кромка ${shore.at0} / +12м ${shore.at12} / море ${shore.at250}`);

// ================= B: ПЛЫВЁТ ПО ВОНЛЕ =================
log('\n===== B: КОРАБЛЬ ПЛЫВЁТ ПО ВОНЛЕ (не внутри) =====');
const fb = (mode, rel) => jparse(ev(`(() => {
  const g = window.__game, p = g.player, T = window.__THREE;
  g.applyPhysicsMode('${mode}', false);
  g.debugSetWeather('storm', 24, 40);
  g.stepDebug(30);
  const windCompass = (Math.atan2(Math.cos(g.wind.from), -Math.sin(g.wind.from)) * 180/Math.PI + 360) % 360;
  const hdg = (windCompass - ${rel} + 360) % 360;
  const e = new T.Euler(0, Math.PI - hdg * Math.PI/180, 0, 'YXZ');
  p.quaternion.setFromEuler(e);
  p.anchored = false; p.sailTarget = 2; p.sailFrac = 1;
  p.position.set(0, 0, -2600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.seedVertical(g.time);
  const P = p.preset, v = new T.Vector3();
  const sm01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t*t*(3-2*t); };
  const prof = (t) => {
    const B = P.beam / 2;
    let w = t < 0.45 ? 0.58 + 0.42 * sm01(t / 0.45) : 1 - Math.pow(sm01((t - 0.45) / 0.55), 0.75);
    const bulwark = P.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.4) + 0.5 * Math.pow(1 - t, 2.2) * 0.6);
    return { w: w * B, deck: bulwark - 1.0 };
  };
  let t = g.time, sum = 0, mn = 9, n = 0, inside = 0, corr = 0, gw0 = p.greenWater;
  for (let i = 0; i < 45 * 60; i++) {
    t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    if (i > 6*60) {
      let f = 9;
      for (const fr of [0.44, 0.10, -0.10, -0.44]) {
        const lz = fr * P.length;
        const tt = Math.max(0, Math.min(1, (lz + P.length/2)/P.length));
        const pr = prof(tt);
        for (const side of [1, -1]) {
          v.set(side * pr.w * 0.85, pr.deck, lz).applyQuaternion(p.quaternion).add(p.position);
          f = Math.min(f, v.y - g.waterHeightAtT(v.x, v.z, t));
        }
      }
      sum += f; mn = Math.min(mn, f); n++;
      if (f < -0.5) inside++;
      const wm = g.waterHeightAtT(p.position.x, p.position.z, t);
      corr += Math.abs(p.position.y - wm);
    }
  }
  return JSON.stringify({ mode: '${mode}', rel: ${rel}, mean: +(sum/n).toFixed(2), min: +mn.toFixed(2),
    insidePct: +(100*inside/n).toFixed(2), corrY: +(corr/n).toFixed(2), gw: p.greenWater - gw0 });
})()`));
const fbRealBeam = fb('realistic', 90);
const fbRealBow = fb('realistic', 0);
const fbSimple = fb('simple', 90);
log(JSON.stringify(fbRealBeam), JSON.stringify(fbRealBow), JSON.stringify(fbSimple));
check('B1: РЕАЛИСТИЧНАЯ лагом к штормовому валу: палуба в среднем НАД водой, глубоких провалов < 1%',
  fbRealBeam.mean > 0.25 && fbRealBeam.min > -0.8 && fbRealBeam.insidePct < 1, JSON.stringify(fbRealBeam));
check('B2: вертикаль СЛЕДУЕТ поверхности (|y − вода| < 0.6 м — плывёт ПО волне)',
  fbRealBeam.corrY < 0.6, `отклонение ${fbRealBeam.corrY} м`);
check('B3: носом на волну: НОС ВСХОДИТ на гребни (заливаний почти нет, < 6 за 45 с)',
  fbRealBow.gw < 6, `заливаний ${fbRealBow.gw}`);
check('B4: ПРОСТАЯ физика не хуже (плывёт по поверхности)',
  fbSimple.mean > 0.4 && fbSimple.min > -0.5, JSON.stringify(fbSimple));

const sw = jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  let nan = 0;
  for (const m of ['simple', 'realistic', 'simple', 'realistic']) {
    g.applyPhysicsMode(m, false);
    p.position.set(100, 5, -2600); p.seedVertical(g.time);
    g.stepDebug(2);
    if (!isFinite(p.position.x) || !isFinite(p.position.y) || !isFinite(p.quaternion.x)) nan++;
  }
  return JSON.stringify({ nan });
})()`));
check('B5: переключение физики на лету БЕЗ NaN', sw.nan === 0, JSON.stringify(sw));

// ================= C: КРЕН =================
log('\n===== C: КРЕН (ослаблен вдвое, симметричен) =====');
const heels = jparse(ev(`(() => {
  const g = window.__game, p = g.player, T = window.__THREE;
  const out = {};
  const beamRun = (w, rel) => {
    g.applyPhysicsMode('realistic', false);
    g.debugSetWeather('clear', w, -1);
    g.stepDebug(16);
    const windCompass = (Math.atan2(Math.cos(g.wind.from), -Math.sin(g.wind.from)) * 180/Math.PI + 360) % 360;
    const hdg = (windCompass - rel + 360) % 360;
    const e = new T.Euler(0, Math.PI - hdg * Math.PI/180, 0, 'YXZ');
    p.quaternion.setFromEuler(e);
    p.anchored = false; p.sailTarget = 3; p.sailFrac = 1;
    p.position.set(0, 0, -2600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
    p.seedVertical(g.time);
    let t = g.time, sum = 0, n = 0;
    for (let i = 0; i < 30 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); if (i > 12*60) { sum += p.euler.z; n++; } }
    return +(sum/n*180/Math.PI).toFixed(2);
  };
  out.w12 = beamRun(12, 90);
  out.w18 = beamRun(18, 90);
  out.port12 = beamRun(12, 270);
  out.calm = (() => {
    g.debugSetWeather('fog', 2, -1); g.stepDebug(20);
    p.anchored = true; p.sailTarget = 0; p.sailFrac = 0;
    p.position.set(0, 0, -2600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
    p.seedVertical(g.time);
    let t = g.time, sum = 0, n = 0;
    for (let i = 0; i < 25 * 60; i++) { t += 1/60; p.fixedStep(1/60, t); if (i > 8*60) { sum += p.euler.z; n++; } }
    return +(sum/n*180/Math.PI).toFixed(2);
  })();
  return JSON.stringify(out);
})()`));
log(JSON.stringify(heels));
check('C1: боковой ветер 12 м/с → крен ≤ 4° (было 5.2°)', Math.abs(heels.w12) < 4, heels.w12 + '°');
check('C2: боковой ветер 18 м/с → крен 5..12° (было 17°)',
  Math.abs(heels.w18) >= 4 && Math.abs(heels.w18) <= 12, heels.w18 + '°');
check('C3: крен СИММЕТРИЧЕН (ветер с порта = минус ветер с штирборта, |Δ| < 1.5°)',
  Math.abs(heels.w12 + heels.port12) < 1.5, `${heels.w12}° / ${heels.port12}°`);
check('C4: в ШТИЛЕ корабль стоит РОВНО (< 1°)', Math.abs(heels.calm) < 1, heels.calm + '°');

// ================= D: СМЫВ МАТРОСОВ =================
log('\n===== D: СМЫВ МАТРОСОВ (залитие палубы) =====');
const washDef = jparse(ev(`window.__sea.physics.washProbability`));
check('D1: вероятность смыва по умолчанию 30%', Math.abs(washDef - 0.3) < 0.001, String(washDef));
const washRun = jparse(ev(`(() => {
  const g = window.__game, p = g.player, T = window.__THREE;
  const out = {};
  const setProb = (pct) => {
    const s = structuredClone(g.settings);
    s.physics.buoyancy.washProbabilityPct = pct;
    g.applySettings(s);
  };
  const run = (label, seconds, rel, storm) => {
    if (storm) {
      g.debugSetWeather('storm', 24, 40); g.stepDebug(30);
      let wait = 0;
      while (g.wind.speed < 27.5 && wait < 40) { g.stepDebug(1); wait++; }
    } else { g.debugSetWeather('clear', 6, 40); g.stepDebug(12); }
    const windCompass = (Math.atan2(Math.cos(g.wind.from), -Math.sin(g.wind.from)) * 180/Math.PI + 360) % 360;
    const hdg = (windCompass - rel + 360) % 360;
    const e = new T.Euler(0, Math.PI - hdg * Math.PI/180, 0, 'YXZ');
    p.quaternion.setFromEuler(e);
    p.anchored = false; p.sailTarget = 2; p.sailFrac = 1;
    p.position.set(0, 0, -2600); p.velocity.set(0,0,0); p.angular.set(0,0,0);
    p.seedVertical(g.time);
    out[label + '_state'] = { wind: +g.wind.speed.toFixed(1), env: +window.__sea.envelope.toFixed(2),
      amp01: +window.__sea.seaAmp.toFixed(3), crew: p.crew, sunk: p.sinking || p.sunk };
    const w0 = p.washedCrew, gw0 = p.greenWater, crew0 = p.crew;
    let t = g.time;
    for (let i = 0; i < seconds * 60; i++) { t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
    out[label] = { washed: p.washedCrew - w0, floods: p.greenWater - gw0, crewLost: crew0 - p.crew };
  };
  setProb(100); run('p100', 70, 90, true);
  setProb(0);   run('p0', 70, 90, true);
  setProb(30);  run('calm', 40, 90, false);
  setProb(30);
  return JSON.stringify(out);
})()`));
log(JSON.stringify(washRun));
check('D2: шторм 24 м/с лагом, вероятность 100% — смывает (≥ 2 за 70 с)',
  washRun.p100.floods >= 5 && washRun.p100.washed >= 2, JSON.stringify(washRun.p100_state) + ' ' + JSON.stringify(washRun.p100));
check('D3: вероятность 0% — заливания есть, смыва НЕТ',
  washRun.p0.floods >= 3 && washRun.p0.washed === 0, JSON.stringify(washRun.p0_state) + ' ' + JSON.stringify(washRun.p0));
check('D4: в спокойную погоду заливаний НЕТ вообще',
  washRun.calm.floods === 0 && washRun.calm.washed === 0, JSON.stringify(washRun.calm));

// ================= E: ПАНЕЛЬ/СХЕМА =================
log('\n===== E: ПАНЕЛЬ + СХЕМА v7 =====');
run(`eval "(() => { const b = [...document.querySelectorAll('button')].find(b => /Настройки/i.test(b.textContent)); if (b) b.click(); return 'opened'; })()"`);
await sleep(600);
const clickTabEv = (name) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '${name}');
  if (b) { b.click(); return true; }
  return false;
})()`);
const physOpened = clickTabEv('Физика');
await sleep(500);
const physTxt = jparse(ev(`document.body.innerText.includes('Вероятность смыва матроса') && document.body.innerText.includes('Реалистичная')`));
const gameOpened = clickTabEv('Игра');
await sleep(500);
const gameTxt = jparse(ev(`document.body.innerText.includes('Количество шлюпок') && document.body.innerText.includes('Упрощённое управление')`));
clickTabEv('Графика');
await sleep(400);
const foamGone = jparse(ev(`!document.body.innerText.includes('Качество пены')`));
log(JSON.stringify({ physOpened, physTxt, gameOpened, gameTxt, foamGone }));
check('E1: «Качество пены» УДАЛЕНО из панели (вкладка Графика)', isT(foamGone));
check('E2: вкладка «Физика»: смыв + режим физики; вкладка «Игра»: шлюпки + упрощённое управление',
  isT(physOpened) && isT(physTxt) && isT(gameOpened) && isT(gameTxt),
  `физика:${physOpened}/${physTxt} игра:${gameOpened}/${gameTxt}`);
// ================= F: ОШИБКИ JS =================
log('\n===== F: ОШИБКИ JS =====');
const errs = jparse(ev(`JSON.stringify(window.__jsErrors || [])`));
check('F1: ошибок JS нет', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs).slice(0, 200));

const saved = jparse(ev(`(() => {
  const g = window.__game;
  const blob = JSON.parse(JSON.stringify({ ...g.settings, v: 6 }));
  blob.graphics.foamQuality = 2;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(blob));
  return JSON.stringify({ blobV: 6, foamInjected: true });
})()`));
run('reload');
await sleep(9000);
ev(`window.__game.start()`);
await sleep(400);
const migr = jparse(ev(`(() => {
  const g = window.__game;
  const after = JSON.parse(localStorage.getItem('seawolves.settings.v1') || '{}');
  return JSON.stringify({ v: after.v, foamInGame: 'foamQuality' in g.settings.graphics,
    physicsOK: !!g.settings.physics });
})()`));
check('E3: миграция v6→v7+: foamQuality из старого сохранения игнорируется, схема перезаписана (v7 и новее)',
  migr.v >= 7 && migr.foamInGame === false && migr.physicsOK === true, JSON.stringify(migr));

log(`\n===== ИТОГ: ${fails === 0 ? 'ALL OK' : fails + ' FAIL'} =====`);
run('close');
process.exit(fails === 0 ? 0 : 1);
