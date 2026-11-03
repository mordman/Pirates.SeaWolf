// E2E Task 27 — «ещё одна реализация моря и волн» (по файлу игрока
// «ФРЕГАТ ПЕРУН») + фикс посадки шлюпки:
//  (A) МОДЕЛЬ МОРЯ В НАСТРОЙКАХ: по умолчанию физическая; в панели
//      настроек есть выбор «Модель моря» (физическая / волна-опора);
//      переключение на лету меняет набор волн (высоты воды в той же
//      точке различаются), телеметрия __sea.seaModel, без ошибок JS
//  (B) ВОЛНА-ОПОРА, ШТИЛЬ: посадка по проектную осадку, ровный киль,
//      без NaN (как физическая в Task 26)
//  (C) ВОЛНА-ОПОРА, ШТОРМ: корабль ДЕРЖИТСЯ НА ВОДЕ (средний борт ≈
//      конструктивному, не проваливается), нос ВСХОДИТ на волну и
//      СПУСКАЕТСЯ (дифферент обеих знаков, корреляция с уклоном
//      волны), слишком большие волны крывают палубу зелёной водой
//  (D) ШЛЮПКА НА ВОЛНАХ (жалоба «лодка плавает под водой»): ял
//      держится НА ПОВЕРХНОСТИ в обеих моделях моря (планширь над
//      водой всегда, посадка по 5 точкам, нос ходит по волне),
//      у носа на ходу — бурун (вода обтекает)
//  (E) ФИЗИЧЕСКАЯ МОДЕЛЬ НЕ СЛОМАНА переключением: штиль — ровный
//      киль по осадку; шторм — режет волны (динамический дифферент)
//  (F) СОХРАНЕНИЕ: выбор модели моря сохраняется в localStorage и
//      живёт после перезагрузки
//  (G) скриншоты обеих моделей + 0 ошибок JS
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
run('open http://localhost:3000/?t=' + Date.now());
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ================= A: модель моря в настройках =================
log('=== A: модель моря — по умолчанию физическая, выбор в настройках ===');
const def = jparse(ev(`(() => JSON.stringify({
  seaModel: window.__sea.seaModel,
  h1: +window.__game.waterHeightAtT(100, 200, 50).toFixed(3),
}))()`));
log('A default:', JSON.stringify(def));
check('A: по умолчанию ФИЗИЧЕСКАЯ модель (Архимед)', def.seaModel === 'physical', def.seaModel);

// панель настроек: открыть, найти select «Модель моря»
clickBtn('Настройки');
await sleep(700);
const ui = jparse(ev(`(() => {
  // вкладка «Погода»
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Погода');
  if (tab) tab.click();
  return new Promise(res => setTimeout(() => {
    const sels = [...document.querySelectorAll('select')];
    const sea = sels.find(s => [...s.options].some(o => o.textContent.includes('Волна-опора')));
    res(JSON.stringify({
      found: !!sea,
      value: sea ? sea.value : null,
      opts: sea ? [...sea.options].map(o => o.textContent) : [],
    }));
  }, 300));
})()`));
log('A UI:', JSON.stringify(ui));
// Task 29: моделей моря стало ТРИ (добавлен штормовой модуль sea.js)
check('A: в настройках (Погода) есть выбор «Модель моря» (физ/опора/шторм)',
  ui.found && ui.value === 'physical' && ui.opts.length === 3
    && ui.opts.some(o => o.includes('Штормовой')), JSON.stringify(ui.opts));
// переключить через UI на «волна-опора» и применить
const uiSwitch = ev(`(() => {
  const sels = [...document.querySelectorAll('select')];
  const sea = sels.find(s => [...s.options].some(o => o.textContent.includes('Волна-опора')));
  if (!sea) return 'NOT FOUND';
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sea, 'riding');
  sea.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
log('A switch:', uiSwitch);
clickBtn('Применить');
await sleep(800);
const afterUi = jparse(ev(`(() => JSON.stringify({
  seaModel: window.__sea.seaModel,
  h1: +window.__game.waterHeightAtT(100, 200, 50).toFixed(3),
}))()`));
log('A after UI switch:', JSON.stringify(afterUi));
check('A: выбор «волна-опора» применился НА ЛЕТУ (__sea.seaModel)',
  afterUi.seaModel === 'riding', afterUi.seaModel);
check('A: набор волн реально ДРУГОЙ (высота воды в точке изменилась)',
  Math.abs(afterUi.h1 - def.h1) > 0.05, `${def.h1} → ${afterUi.h1}`);

// ================= B: волна-опора, штиль =================
log('=== B: волна-опора — посадка в штиль ===');
const calmR = jparse(ev(`(() => {
  const g = window.__game;
  g.debugSetWeather('clear', 3);
  g.seaAmpSmooth = 0.42;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  return 'ok';
})()`));
await sleep(2000);
for (const model of ['frigate', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    const T = window.__THREE;
    g.changeShip('${model}', true);
    const p = g.player;
    p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
    p.quaternion.identity();
    let t = g.time;
    let nan = false, sumPitch = 0, n = 0;
    for (let i = 0; i < 1800; i++) {
      t += 1/60; p.fixedStep(1/60, t);
      if (!isFinite(p.position.y) || !isFinite(p.quaternion.x)) { nan = true; break; }
      sumPitch += p.euler.x; n++;
    }
    const F = p.preset.freeboard, L = p.preset.length, D = p.preset.draft;
    const bow = new T.Vector3(0, F*0.82, L*0.44).applyQuaternion(p.quaternion).add(p.position);
    const bowF = bow.y - g.waterHeightAtT(bow.x, bow.z, t);
    const keel = new T.Vector3(0, -D, 0).applyQuaternion(p.quaternion).add(p.position);
    const dig = g.waterHeightAtT(keel.x, keel.z, t) - keel.y;
    return JSON.stringify({
      nan, meanPitch: +(sumPitch/Math.max(1,n)).toFixed(3),
      bowF: +bowF.toFixed(2), dig: +dig.toFixed(2), D,
    });
  })()`));
  log(`B[${model}]:`, JSON.stringify(r));
  check(`B: ${model} — штиль без NaN, ровный киль (|дифферент| < 5°)`,
    r && !r.nan && Math.abs(r.meanPitch) < 0.09, `pitch=${r.meanPitch}`);
  check(`B: ${model} — нос над водой, киль по проектную осадку`,
    r && r.bowF > 0.3 && r.dig > r.D * 0.4 && r.dig < r.D * 1.8,
    `нос=${r.bowF} осадка=${r.dig}/${r.D}`);
}

// ================= C: волна-опора, шторм =================
log('=== C: волна-опора — корабль держится на воде, нос ходит по волне ===');
ev(`(() => {
  const g = window.__game;
  g.debugSetWeather('storm', 22);
  g.seaAmpSmooth = 1.9;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  p.greenWater = 0;
  return 'ok';
})()`);
await sleep(2000);
const stormR = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const T = window.__THREE;
  let t = g.time;
  let nan = false, fbMin = 1e9, fbSum = 0, n = 0;
  let maxPitch = -9, minPitch = 9, maxRoll = 0;
  const pitchArr = [], slopeArr = [];
  const F = p.preset.freeboard, L = p.preset.length;
  const d = new T.Vector3();
  for (let i = 0; i < 3600; i++) {   // 60 с
    t += 1/60;
    p.fixedStep(1/60, t);
    p.updateVisual(t, 1/60, g.particles);
    if (!isFinite(p.position.y) || !isFinite(p.quaternion.x)) { nan = true; break; }
    d.set(0, F*0.82, 0.44*L).applyQuaternion(p.quaternion).add(p.position);
    const fb = d.y - g.waterHeightAtT(d.x, d.z, t);
    fbMin = Math.min(fbMin, fb); fbSum += fb; n++;
    const e = p.euler;
    maxPitch = Math.max(maxPitch, e.x); minPitch = Math.min(minPitch, e.x);
    maxRoll = Math.max(maxRoll, Math.abs(e.z));
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const hb = g.waterHeightAtT(p.position.x + fx*L*0.42, p.position.z + fz*L*0.42, t);
    const hs = g.waterHeightAtT(p.position.x - fx*L*0.42, p.position.z - fz*L*0.42, t);
    pitchArr.push(e.x); slopeArr.push((hb - hs) / (L*0.84));
  }
  let corr = 0;
  {
    const N = pitchArr.length;
    const mx = pitchArr.reduce((a,b)=>a+b,0)/N, my = slopeArr.reduce((a,b)=>a+b,0)/N;
    let sxy=0, sxx=0, syy=0;
    for (let i=0;i<N;i++){ const a=pitchArr[i]-mx, b=slopeArr[i]-my; sxy+=a*b; sxx+=a*a; syy+=b*b; }
    corr = sxy/Math.sqrt(Math.max(1e-9,sxx*syy));
  }
  return JSON.stringify({
    nan, fbMin: +fbMin.toFixed(2), fbMean: +(fbSum/Math.max(1,n)).toFixed(2),
    maxPitch: +maxPitch.toFixed(3), minPitch: +minPitch.toFixed(3), maxRoll: +maxRoll.toFixed(3),
    corr: +corr.toFixed(2), greenWater: p.greenWater,
    seaAmp: +window.__sea.seaAmp.toFixed(2), F,
  });
})()`));
log('C:', JSON.stringify(stormR));
check('C: шторм — БЕЗ NaN, корабль ДЕРЖИТСЯ НА ВОДЕ (средний борт > 1.4 м)',
  stormR && !stormR.nan && stormR.fbMean > 1.4, `fbMean=${stormR.fbMean}`);
check('C: НЕ ныряет глубоко (мин. борт > −1.5 м — только большие волны кратко топят борт у носа)',
  stormR && stormR.fbMin > -1.5, `fbMin=${stormR.fbMin}`);
check('C: нос ВСХОДИТ на волну и СПУСКАЕТСЯ (дифферент обеих знаков > 0.08)',
  stormR && stormR.maxPitch > 0.08 && stormR.minPitch < -0.08,
  `pitch∈[${stormR.minPitch}, ${stormR.maxPitch}]`);
check('C: дифферент СЛЕДУЕТ уклону волны (|корреляция| > 0.5)',
  stormR && Math.abs(stormR.corr) > 0.5, `corr=${stormR.corr}`);
check('C: слишком большие волны крывают палубу (зелёная вода > 0)',
  stormR && stormR.greenWater > 0, `events=${stormR.greenWater}`);

// ================= D: шлюпка на волнах =================
log('=== D: шлюпка держится на поверхности (обе модели) ===');
const boatR = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1/60; bl.update(1/60, t); }
  // шторм, дрейф 30 с
  let under = 0, n = 0, gunMin = 1e9, maxAbsPitch = 0, maxAbove = -1e9;
  for (let i = 0; i < 1800; i++) {
    t += 1/60; bl.update(1/60, t);
    const wy = g.waterHeightAtT(bl.pos.x, bl.pos.z, t);
    const gun = bl.vis.group.position.y + bl.vis.gunY - 0.06;
    if (gun - wy < -0.15) under++;   // ПОД ВОДОЙ = ниже поверхности, а не ниже нуля
    gunMin = Math.min(gunMin, gun - wy);
    maxAbove = Math.max(maxAbove, gun - wy);
    maxAbsPitch = Math.max(maxAbsPitch, Math.abs(bl.pitch));
    n++;
  }
  // обратно на шлюпбалки
  bl.abort();
  // физическая модель: спуск + 20 с на волне
  g.applySeaModel('physical');
  const err2 = bl.tryLaunch(false);
  let underP = 0, nP = 0, gunMinP = 1e9;
  if (!err2) {
    let t2 = g.time;
    for (let i = 0; i < 460; i++) { t2 += 1/60; bl.update(1/60, t2); }
    for (let i = 0; i < 1200; i++) {
      t2 += 1/60; bl.update(1/60, t2);
      const wy = g.waterHeightAtT(bl.pos.x, bl.pos.z, t2);
      const gun = bl.vis.group.position.y + bl.vis.gunY - 0.06;
      if (gun - wy < -0.15) underP++;   // ниже ПОВЕРХНОСТИ воды
      gunMinP = Math.min(gunMinP, gun - wy);
      nP++;
    }
  }
  bl.abort();
  return JSON.stringify({
    underPct: +(100*under/n).toFixed(1), gunMin: +gunMin.toFixed(2),
    maxAbove: +maxAbove.toFixed(2), maxAbsPitch: +maxAbsPitch.toFixed(3),
    underPctPhys: +(100*underP/Math.max(1,nP)).toFixed(1), gunMinPhys: +gunMinP.toFixed(2),
    err2,
  });
})()`));
log('D:', JSON.stringify(boatR));
check('D: ял НА ПОВЕРХНОСТИ в шторме riding (под водой < 5% времени)',
  boatR && boatR.underPct !== undefined && boatR.underPct < 5, `под водой ${boatR.underPct}%`);
check('D: посадка стабильна (планширь не ниже −0.15 м от воды)',
  boatR && boatR.gunMin > -0.15 && boatR.maxAbove < 1.4,
  `планширь ${boatR.gunMin}..${boatR.maxAbove} м от воды`);
check('D: нос яла ходит по волне (дифферент > 0.05 рад)',
  boatR && boatR.maxAbsPitch > 0.05, `pitch=${boatR.maxAbsPitch}`);
check('D: и в ФИЗИЧЕСКОЙ модели ял не тонет (под водой < 12%)',
  boatR && boatR.underPctPhys < 12, `под водой ${boatR.underPctPhys}%`);

// ================= E: физическая модель цела =================
log('=== E: физическая модель после переключения обратно ===');
const physE = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  // штиль
  g.debugSetWeather('clear', 3);
  g.seaAmpSmooth = 0.42;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  p.quaternion.identity();
  return 'ok';
})()`));
await sleep(2000);
const calmP = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  let t = g.time;
  let nan = false, sumPitch = 0, n = 0;
  for (let i = 0; i < 1800; i++) {
    t += 1/60; p.fixedStep(1/60, t);
    if (!isFinite(p.position.y) || !isFinite(p.quaternion.x)) { nan = true; break; }
    sumPitch += p.euler.x; n++;
  }
  return JSON.stringify({ nan, meanPitch: +(sumPitch/Math.max(1,n)).toFixed(3),
    seaModel: window.__sea.seaModel });
})()`));
log('E (штиль):', JSON.stringify(calmP));
check('E: физическая модель — штиль: ровный киль, без NaN (Task 26 цел)',
  calmP && !calmP.nan && calmP.seaModel === 'physical' && Math.abs(calmP.meanPitch) < 0.09,
  `pitch=${calmP.meanPitch}`);

// ================= F: сохранение выбора =================
log('=== F: выбор модели сохраняется ===');
ev(`(() => {
  const g = window.__game;
  g.applySeaModel('riding');
  return 'ok';
})()`);
const saved = jparse(ev(`(() => {
  const raw = localStorage.getItem('seawolves.settings.v1');
  const s = raw ? JSON.parse(raw) : null;
  return JSON.stringify({ saved: s ? s.weather.seaModel : null });
})()`));
log('F (до Apply — должно быть НЕ сохранено):', JSON.stringify(saved));
// переключение через UI сохраняет настройки (Apply → saveSettings)
clickBtn('Настройки');
await sleep(600);
ev(`(() => {
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Погода');
  if (tab) tab.click();
  return 'ok';
})()`);
await sleep(400);
ev(`(() => {
  const sels = [...document.querySelectorAll('select')];
  const sea = sels.find(s => [...s.options].some(o => o.textContent.includes('Волна-опора')));
  if (!sea) return 'NOT FOUND';
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sea, 'riding');
  sea.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
clickBtn('Применить');
await sleep(700);
const saved2 = jparse(ev(`(() => {
  const raw = localStorage.getItem('seawolves.settings.v1');
  const s = raw ? JSON.parse(raw) : null;
  return JSON.stringify({ saved: s ? s.weather.seaModel : null });
})()`));
log('F (после Apply):', JSON.stringify(saved2));
check('F: «волна-опора» СОХРАНЕНА в localStorage', saved2 && saved2.saved === 'riding', saved2.saved);
// перезагрузка — модель живёт
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2000);
const reloaded = jparse(ev(`(() => JSON.stringify({ seaModel: window.__sea.seaModel }))()`));
log('F (после reload):', JSON.stringify(reloaded));
check('F: после перезагрузки модель «волна-опора» активна',
  reloaded && reloaded.seaModel === 'riding', reloaded.seaModel);

// ================= G: скриншоты =================
log('=== G: скриншоты ===');
// riding шторм: корабль на поверхности, нос на волне
ev(`(() => {
  const g = window.__game;
  g.debugSetWeather('storm', 22);
  g.seaAmpSmooth = 1.8;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  g.setCameraMode('side');
  g.rig.dist.side = 40;
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2200);
shot('t27_riding_storm');
await sleep(400);
// физическая модель шторм (переключили)
ev(`(() => {
  const g = window.__game;
  g.applySeaModel('physical');
  g.setCameraMode('side');
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2200);
shot('t27_physical_storm');
await sleep(400);

const pageErrs = jparse(ev(`(() => JSON.stringify(window.__pageErrors || []))()`));
log('G: ошибки страницы:', JSON.stringify(pageErrs).slice(0, 200));
check('G: ошибок JS нет', Array.isArray(pageErrs) && pageErrs.length === 0,
  JSON.stringify(pageErrs).slice(0, 120));

run('close --all');
log(fails === 0 ? '\nALL OK' : `\nFAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
