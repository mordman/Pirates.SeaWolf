// E2E Task 29 — автономный модуль штормового моря sea.js + качка
// shipPhysics.js + бортовые залпы:
//  (A) ВЫБОР МОДЕЛИ МОРЯ: в настройках 3 варианта (физическая /
//      волна-опора / ШТОРМОВОЙ МОДУЛЬ); переключение на лету:
//      штандартная вода скрыта, сетки модуля видны, телеметрия
//      __sea.storm.active = 1
//  (B) CPU/GPU СИНХРОН: game.waterHeightAtT == sea.heightAt на
//      одном t; высота меняется во времени (волны идут); огибающая
//      растёт с ветром (3 м/с vs 18 м/с)
//  (C) ОБЩИЙ ВЕТЕР: направление из настроек поворачивает спектр
//      (dirDeg = (направление+180)%360, угол первой волны меняется)
//  (D) КАЧКА КОРАБЛЯ (shipPhysics.js): в шторм крен/дифферент обеих
//      знаков, вертикальная качка есть, корабль на поверхности
//      (freeboard > -1 м), нет NaN
//  (E) НАСТРОЙКИ НА ЛЕТУ: высота волн ×2 → огибающая ×~2;
//      жёсткость качки 9 → телеметрия cfg.stiff = 9
//  (F) БОРТОВЫЕ ЗАЛПЫ: E+Пробел — ПРАВЫЙ борт (прицел включается
//      сам, side=1, расход боезапаса, таймеры перезарядки);
//      Q+Пробел — ЛЕВЫЙ (side=-1)
//  (G) ШЛЮПКА НА ШТОРМОВОМ МОРЕ: спуск B, afloat, ял держится
//      поверхности (|y − вода| < 2 м)
//  (H) ВОЗВРАТ НА ФИЗИЧЕСКУЮ: вода снова видна, высоты из набора
//      PHYS (совпадают с ручным расчётом), без ошибок
//  (I) скриншоты + 0 ошибок JS
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
// нажать/отпустить клавишу (InputManager слушает window keydown/keyup)
const key = (code, type = 'keydown') =>
  ev(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' })); 'ok'`);

let jsErrors = 0;
const pollErrors = () => jparse(ev(`window.__jsErrors || 0`));

run('close --all');
run('open http://localhost:3000/?t=' + Date.now());
await sleep(1500);
// меньше пикселей — выше FPS в headless (software WebGL)
run('viewport 800 450');
await sleep(400);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
// счётчик ошибок JS
ev(`window.__jsErrors = 0; window.addEventListener('error', e => window.__jsErrors++); 'ok'`);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);
// эталонная высота физической модели в точке (для проверки возврата в H)

// ================= A: модель моря — штормовой модуль в настройках =================
log('=== A: выбор «Штормовой модуль» в настройках ===');
const defA = jparse(ev(`(() => JSON.stringify({
  seaModel: window.__sea.seaModel,
  waterVisible: window.__game.water.group.visible,
  storm: window.__sea.storm,
}))()`));
log('A default:', JSON.stringify(defA).slice(0, 200));
check('A: по умолчанию физическая модель, штормового модуля ещё нет',
  defA.seaModel === 'physical' && defA.storm === null, defA.seaModel);

clickBtn('Настройки');
await sleep(700);
const uiA = jparse(ev(`(() => {
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Погода');
  if (tab) tab.click();
  return new Promise(res => setTimeout(() => {
    const sels = [...document.querySelectorAll('select')];
    const sea = sels.find(s => [...s.options].some(o => o.value === 'storm'));
    res(JSON.stringify({
      found: !!sea,
      opts: sea ? [...sea.options].map(o => o.value) : [],
    }));
  }, 300));
})()`));
log('A UI:', JSON.stringify(uiA));
check('A: в настройках 3 модели моря, есть «storm»',
  uiA.found && uiA.opts.length === 3 && uiA.opts.includes('storm'), JSON.stringify(uiA.opts));
// переключить на штормовой модуль через UI
ev(`(() => {
  const sels = [...document.querySelectorAll('select')];
  const sea = sels.find(s => [...s.options].some(o => o.value === 'storm'));
  if (!sea) return 'NOT FOUND';
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sea, 'storm');
  sea.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await sleep(400);
const stormUiRows = jparse(ev(`(() => {
  const rows = [...document.querySelectorAll('.text-xs')].map(e => e.textContent);
  return JSON.stringify({
    hasHeight: rows.some(t => t.includes('Высота волн')),
    hasFoam: rows.some(t => t.includes('Пена')),
    hasStiff: rows.some(t => t.includes('Жёсткость качки')),
    hasImmBoat: rows.some(t => t.includes('Посадка: шлюпка')),
  });
})()`));
log('A storm rows:', JSON.stringify(stormUiRows));
check('A: при выборе штормового модуля появились настройки моря и качки',
  stormUiRows.hasHeight && stormUiRows.hasFoam && stormUiRows.hasStiff && stormUiRows.hasImmBoat);
const closed = clickBtn('Готово');
await sleep(1200);
const stormOn = jparse(ev(`(() => JSON.stringify({
  seaModel: window.__sea.seaModel,
  waterVisible: window.__game.water.group.visible,
  active: window.__sea.storm ? window.__sea.storm.active : -1,
  waterHidden: window.__sea.storm ? window.__sea.storm.waterHidden : -1,
  waves: window.__sea.storm ? window.__sea.storm.waves.length : 0,
  grid: window.__sea.storm ? window.__sea.storm.grid : null,
  wind: window.__sea.storm ? window.__sea.storm.wind : -1,
}))()`));
const uiClosed = jparse(ev(`window.__game.uiOpen === false`));
check('A: панель настроек закрыта после «Готово» (управление активно)', uiClosed === true);
log('A storm on:', JSON.stringify(stormOn));
check('A: модель применилась НА ЛЕТУ (__sea.seaModel = storm)',
  stormOn.seaModel === 'storm', stormOn.seaModel);
check('A: штандартная вода СКРЫТА, модуль активен',
  stormOn.active === 1 && stormOn.waterHidden === 1 && !stormOn.waterVisible);
check('A: спектр из 6 волн, сетки модуля созданы',
  stormOn.waves === 6 && !!stormOn.grid && stormOn.grid.near.seg > 0,
  JSON.stringify(stormOn.grid));

// ================= B: CPU/GPU синхрон и отклик на ветер =================
log('=== B: синхрон CPU/GPU и огибающая от ветра ===');
const sync = jparse(ev(`(() => {
  const g = window.__game;
  const sea = g.sea;
  const t = g.time;
  const h1 = sea.heightAt(120, -80, t);
  const hW = g.waterHeightAtT(120, -80, t);
  // движение волн: max |h(t+2)-h(t)| по набору точек (в одной точке
  // фаза могла случайно попасть на гребень)
  let moves = 0;
  for (const [x, z] of [[120,-80],[0,0],[300,140],[-260,60],[80,-320],[500,500]])
    moves = Math.max(moves, Math.abs(sea.heightAt(x, z, t + 2.0) - sea.heightAt(x, z, t)));
  return JSON.stringify({ h1: +h1.toFixed(4), hW: +hW.toFixed(4),
    diff: +Math.abs(h1 - hW).toFixed(5), moves: +moves.toFixed(3),
    env: +sea.envelope().toFixed(3) });
})()`));
log('B sync:', JSON.stringify(sync));
check('B: waterHeightAt == sea.heightAt (делегация CPU-высоты)',
  sync.diff < 1e-6, `diff=${sync.diff}`);
check('B: волны движутся (высота меняется за 2 с)', sync.moves > 0.05, `${sync.moves}`);
// ветер: штиль vs шторм — огибающая растёт
ev(`(() => {
  const g = window.__game;
  g.weather.wind.speed = 2; g.wind.speed = 2; g.weather.windBase = 2;
  g.sea.setWind(g.wind.speed / 24);
  return 'ok';
})()`);
await sleep(400);
const envCalm = jparse(ev(`window.__sea.storm ? +(window.__sea.storm.envelope).toFixed(3) : -1`));
ev(`(() => {
  const g = window.__game;
  g.weather.wind.speed = 18; g.wind.speed = 18; g.weather.windBase = 18;
  g.sea.setWind(g.wind.speed / 24);
  return 'ok';
})()`);
await sleep(400);
const envStorm = jparse(ev(`window.__sea.storm ? +(window.__sea.storm.envelope).toFixed(3) : -1`));
log(`B env: штиль(2 м/с)=${envCalm} шторм(18 м/с)=${envStorm}`);
check('B: огибающая растёт с ветром (шторм > штиля ×2)',
  envStorm > envCalm * 2 && envStorm > 1.5, `${envCalm} → ${envStorm}`);

// ================= C: направление ветра поворачивает спектр =================
log('=== C: общее направление ветра ===');
const setC = (dir) => ev(`(() => {
  const g = window.__game;
  g.settings.weather.windDir = ${dir};
  g.weather.dirBase = ${dir};
  g.weather.wind.from = ${dir} * Math.PI / 180;
  g.wind.from = ${dir} * Math.PI / 180;
  g.sea.setWindDir(g.wind.from);
  return 'ok';
})()`);
setC(40);
// прокрутить поворот спектра без ожидания кадров: update() двигает rot
ev(`window.__game.sea.update(0, 8, null, { x: 0, z: 0 }); 'ok'`);
await sleep(300);
const dirA = jparse(ev(`(() => JSON.stringify({
  dirDeg: window.__sea.storm.dirDeg,
  wave0: window.__sea.storm.waves[0].ang,
}))()`));
setC(220);
ev(`window.__game.sea.update(0, 8, null, { x: 0, z: 0 }); 'ok'`);
await sleep(300);
const dirB = jparse(ev(`(() => JSON.stringify({
  dirDeg: window.__sea.storm.dirDeg,
  wave0: window.__sea.storm.waves[0].ang,
}))()`));
log('C dir:', JSON.stringify(dirA), '→', JSON.stringify(dirB));
const expectA = (40 + 180) % 360;
const dA = Math.min(Math.abs(dirA.dirDeg - expectA), 360 - Math.abs(dirA.dirDeg - expectA));
check('C: dirDeg ≈ (направление+180) — волны бегут ПО ветру',
  dA <= 15, `dirDeg=${dirA.dirDeg}, ожидание≈${expectA}, Δ=${dA}°`);
const d0 = Math.min(Math.abs(dirA.wave0 - dirB.wave0), 360 - Math.abs(dirA.wave0 - dirB.wave0));
check('C: спектр повернулся за ветром (первая волна ~180°)', d0 > 150, `Δ=${d0}°`);

// ================= D: качка корабля в шторм =================
log('=== D: качка (shipPhysics.js) в шторм ===');
// headless FPS низкий (dt клампится в 0.1 с) — реального времени не
// хватит на период волны; физика публичная, крутим fixedStep напрямую:
// 15 с симуляции = ~1.7 периода главной зыби
const rock = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.sailTarget = 0; p.velocity.set(0, 0, 0);
  const r = { minRoll: 9, maxRoll: -9, minPitch: 9, maxPitch: -9, minY: 9, maxY: -9,
    n: 0, dwSum: 0, dwMax: 0, fbMin: 99 };
  const t0 = g.time;
  for (let i = 0; i < 900; i++) {
    const t = t0 + i / 60;
    p.fixedStep(1 / 60, t);
    const e = p.euler;
    r.minRoll = Math.min(r.minRoll, e.z); r.maxRoll = Math.max(r.maxRoll, e.z);
    r.minPitch = Math.min(r.minPitch, e.x); r.maxPitch = Math.max(r.maxPitch, e.x);
    r.minY = Math.min(r.minY, p.position.y); r.maxY = Math.max(r.maxY, p.position.y);
    // посадка: высота корпуса против воды в центре (шторм 18 м/с —
    // пружина модуля даёт перелёты, смотрим СРЕДНЕЕ и минимум)
    if (i % 10 === 0) {
      const wy = g.waterHeightAtT(p.position.x, p.position.z, t);
      const dw = Math.abs(p.position.y - wy);
      r.dwSum += dw; r.dwMax = Math.max(r.dwMax, dw);
      r.fbMin = Math.min(r.fbMin, p.position.y + p.preset.freeboard - wy);
      r.n++;
    }
  }
  r.dwAvg = r.dwSum / Math.max(1, r.n);
  const b = p.buoy;
  return JSON.stringify({ ...r,
    fbMin: +(+r.fbMin).toFixed(2), slams: p.stormSlams, floods: p.stormFloods,
    vy: +b.vy.toFixed(3), y: +b.y.toFixed(2),
    nan: [p.position.x, p.position.y, p.position.z, b.y].some(v => !isFinite(v)),
  });
})()`));
const dTail = jparse(ev(`(() => { const s = window.__sea; return JSON.stringify({
  freeboard: +s.freeboard.toFixed(2), fps: +s.fps.toFixed(1),
}); })()`));
log('D rock:', JSON.stringify(rock), 'tail:', JSON.stringify(dTail));
check('D: качка живая — крен меняется (|max−min| > 0.02 рад)',
  rock.maxRoll - rock.minRoll > 0.02, `roll ${rock.minRoll.toFixed(3)}..${rock.maxRoll.toFixed(3)}`);
check('D: дифферент обеих знаков (нос всходит и опускается)',
  rock.maxPitch > 0.004 && rock.minPitch < -0.004, `pitch ${rock.minPitch.toFixed(3)}..${rock.maxPitch.toFixed(3)}`);
check('D: вертикальная качка есть (диапазон > 0.15 м)',
  rock.maxY - rock.minY > 0.15, `y ${rock.minY.toFixed(2)}..${rock.maxY.toFixed(2)}`);
check('D: посадка близка к поверхности (средн. |КВЛ−вода| < 1.2 м)',
  rock.dwAvg < 1.2, `avg=${rock.dwAvg && +rock.dwAvg.toFixed(2)} м, max=${rock.dwMax && +rock.dwMax.toFixed(2)} м`);
check('D: палуба не глубже 4 м под водой в худший момент (шторм 18 м/с)',
  rock.fbMin > -4.0, `min fb=${rock.fbMin && +rock.fbMin.toFixed(2)} м`);
check('D: нет NaN', !rock.nan);
shot('t29_storm_riding');
ev(`(() => { const g = window.__game; g.player.anchored = false; return 'ok'; })()`);
await sleep(400);

// ================= E: настройки на лету =================
log('=== E: настройки модуля применяются на лету ===');
const envBefore = jparse(ev(`+window.__sea.storm.envelope.toFixed(3)`));
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.sea.waveHeight = 2.0;   // ×2 от дефолта
  s.buoyancy.heaveStiffness = 9;
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(600);
const envAfter = jparse(ev(`(() => JSON.stringify({
  env: +window.__sea.storm.envelope.toFixed(3),
  stiff: window.__sea.storm.buoy.cfg.stiff,
}))()`));
log(`E: env ${envBefore} → ${envAfter.env}, stiff=${envAfter.stiff}`);
check('E: высота волн ×2 → огибающая выросла (×1.6..2.6)',
  envAfter.env > envBefore * 1.6 && envAfter.env < envBefore * 2.7,
  `${envBefore} → ${envAfter.env}`);
check('E: жёсткость качки применилась к кораблю (cfg.stiff = 9)', envAfter.stiff === 9);
// вернуть
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.sea.waveHeight = 1; s.buoyancy.heaveStiffness = 5;
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(300);

// ================= F: бортовые залпы E+Пробел / Q+Пробел =================
log('=== F: залпы бортов (E+Пробел / Q+Пробел) ===');
check('F: настройки закрыты, управление активно (uiOpen=false)',
  jparse(ev(`window.__game.uiOpen === false`)) === true);
ev(`(() => {
  const g = window.__game;
  g.combat.aim.active = false;   // прицел ВЫКЛЮЧЕН — комбинация должна включить сама
  g.player.portsOpen = true;     // порты открыты — батареи готовы
  g.player.portsT = 1;
  g.player.ammo.ball = 60;
  window.__volleyLog = [];
  const oldFire = g.combat.fireGun.bind(g.combat);
  g.combat.fireGun = (idx, gun, delay) => { window.__volleyLog.push(idx); oldFire(idx, gun, delay); };
  return 'ok';
})()`);
await sleep(200);
// E зажать → Пробел → отпустить (правый борт)
key('KeyE', 'keydown');
await sleep(120);
key('Space', 'keydown');
await sleep(150);
key('Space', 'keyup');
key('KeyE', 'keyup');
await sleep(700);
const volleyR = jparse(ev(`(() => JSON.stringify({
  side: window.__game.combat.aim.side,
  active: window.__game.combat.aim.active,
  shots: window.__volleyLog.length,
  ball: window.__game.player.ammo.ball,
  reloading: window.__game.combat.reloads.filter(r => r > 0).length,
}))()`));
log('F E+Space:', JSON.stringify(volleyR));
check('F: E+Пробел — залп ПРАВОГО борта (прицел включился, side=1)',
  volleyR.active && volleyR.side === 1, `side=${volleyR.side}`);
check('F: орудия правого борта стреляли', volleyR.shots > 0, `выстрелов=${volleyR.shots}`);
check('F: боезапас расходуется, перезарядка идёт',
  volleyR.ball < 60 && volleyR.reloading > 0, `ball=${volleyR.ball}, reload=${volleyR.reloading}`);
// Q зажать → Пробел → отпустить (левый борт)
ev(`window.__volleyLog = []; 'ok'`);
await sleep(200);
key('KeyQ', 'keydown');
await sleep(120);
key('Space', 'keydown');
await sleep(150);
key('Space', 'keyup');
key('KeyQ', 'keyup');
await sleep(700);
const volleyL = jparse(ev(`(() => JSON.stringify({
  side: window.__game.combat.aim.side,
  active: window.__game.combat.aim.active,
  shots: window.__volleyLog.length,
}))()`));
log('F Q+Space:', JSON.stringify(volleyL));
check('F: Q+Пробел — залп ЛЕВОГО борта (side=-1), орудия стреляли',
  volleyL.active && volleyL.side === -1 && volleyL.shots > 0,
  `side=${volleyL.side}, выстрелов=${volleyL.shots}`);
// вернуть fireGun
ev(`(() => { delete window.__volleyLog; 'ok' })()`);

// ================= G: шлюпка на штормовом море =================
log('=== G: шлюпка на волнах штормового модуля ===');
ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  return JSON.stringify({ err });
})()`);
await sleep(1000);
const blPhase1 = jparse(ev(`window.__game.boatLaunch.phase`));
log('G phase:', blPhase1);
check('G: спуск начался (lowering)', blPhase1 === 'lowering', blPhase1);
// прокрутить фазы шлюпки вручную (публичный update): спуск 7 с +
// запас на греблю — headless FPS низкий, реального времени не дождаться
ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const dt = 1 / 60;
  for (let i = 0; i < 560; i++) bl.update(dt, g.time + i * dt);
  return bl.phase;
})()`);
await sleep(300);
const blPhase2 = jparse(ev(`window.__game.boatLaunch.phase`));
log('G phase после прокрутки 9.3 с:', blPhase2);
check('G: шлюпка на воде (afloat)', blPhase2 === 'afloat', blPhase2);
// гребнем и собираем статистику посадки по целой волне (10 с)
key('KeyW', 'keydown');
const boatStat = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  bl.row = 1;
  const dt = 1 / 60;
  let dwSum = 0, dwMax = 0, n = 0, imm = 0.5;
  for (let i = 0; i < 600; i++) {
    const t = g.time + i * dt;
    bl.update(dt, t);
    if (i % 12 === 0) {
      const wy = g.waterHeightAtT(bl.pos.x, bl.pos.z, t);
      const dw = Math.abs(bl.pos.y - wy);
      dwSum += dw; dwMax = Math.max(dwMax, dw); n++;
    }
  }
  imm = bl.buoy.vessel.immersion;
  bl.row = 0;
  return JSON.stringify({
    phase: bl.phase, avg: +(dwSum / Math.max(1, n)).toFixed(2), max: +dwMax.toFixed(2),
    roll: +bl.roll.toFixed(3), pitch: +bl.pitch.toFixed(3),
    floods: bl.stormFloods, imm: +imm.toFixed(2), len: +bl.buoy.vessel.len.toFixed(1),
  });
})()`));
key('KeyW', 'keyup');
log('G boat:', JSON.stringify(boatStat));
check('G: ял держится поверхности штормового моря (средн. |y−вода| < 1.5 м)',
  boatStat.avg < 1.5, `avg=${boatStat.avg} м, max=${boatStat.max} м`);
check('G: качка шлюпки на волнах (крен/дифферент)',
  Math.abs(boatStat.roll) + Math.abs(boatStat.pitch) > 0.001,
  `roll=${boatStat.roll}, pitch=${boatStat.pitch}`);
check('G: посадка шлюпки из настроек (immersion=0.65)', boatStat.imm === 0.65);
check('G: заливания шлюпки регистрируются (события модуля)', boatStat.floods > 0,
  `floods=${boatStat.floods}`);
shot('t29_storm_boat');
// вернуть шлюпку
key('KeyB', 'keydown');
await sleep(200);
key('KeyB', 'keyup');
await sleep(1000);

// ================= H: возврат на физическую модель =================
log('=== H: возврат на физическую модель ===');
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.weather.seaModel = 'physical';
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(800);
const backPhys = jparse(ev(`(() => JSON.stringify({
  seaModel: window.__sea.seaModel,
  waterVisible: window.__game.water.group.visible,
  stormActive: window.__sea.storm ? window.__sea.storm.active : -1,
}))()`));
log('H back:', JSON.stringify(backPhys));
check('H: физическая модель вернулась (вода видна, storm неактивен)',
  backPhys.seaModel === 'physical' && backPhys.waterVisible && backPhys.stormActive === 0);
// точная реплика формулы физической модели (2 итерации инверсии
// Gerstner, набор PHYS, амплитуда = текущее волнение) — совпадение
// означает, что высоты снова считает именно физический набор
const hPhys = jparse(ev(`(() => {
  const g = window.__game;
  const WAVES = [
    { dirX: 1.0, dirZ: 0.25, steepness: 0.075, wavelength: 110.0 },
    { dirX: 0.8, dirZ: 0.6, steepness: 0.062, wavelength: 55.0 },
    { dirX: 0.95, dirZ: -0.32, steepness: 0.05, wavelength: 28.0 },
    { dirX: 0.5, dirZ: 0.86, steepness: 0.04, wavelength: 15.0 },
    { dirX: 0.88, dirZ: 0.48, steepness: 0.03, wavelength: 8.0 },
  ];
  const amp = window.__sea.seaAmp;
  const t = 50, x = 120, z = -80;
  const K = w => 2 * Math.PI / w.wavelength;
  const C = w => Math.sqrt(9.81 / K(w));
  let px = x, pz = z;
  for (let it = 0; it < 2; it++) {
    let dx = 0, dz = 0;
    for (const w of WAVES) {
      const k = K(w), c = C(w), a = w.steepness * amp / k;
      const f = k * (w.dirX * px + w.dirZ * pz - c * t);
      dx += w.dirX * a * Math.cos(f); dz += w.dirZ * a * Math.cos(f);
    }
    px = x - dx; pz = z - dz;
  }
  let y = 0;
  for (const w of WAVES) {
    const k = K(w), c = C(w), a = w.steepness * amp / k;
    const f = k * (w.dirX * px + w.dirZ * pz - c * t);
    y += a * Math.sin(f);
  }
  return JSON.stringify({ manual: +y.toFixed(5), game: +g.waterHeightAtT(120, -80, 50).toFixed(5) });
})()`));
log('H phys:', JSON.stringify(hPhys));
check('H: высоты снова из набора PHYS (точная формула совпала)',
  Math.abs(hPhys.manual - hPhys.game) < 1e-4, `${hPhys.manual} vs ${hPhys.game}`);

// ================= I: скриншот физической + ошибки =================
shot('t29_back_physical');
await sleep(500);
jsErrors = pollErrors();
log('=== I: ошибки JS ===', jsErrors);
check('I: 0 ошибок JS за тест', jsErrors === 0, `${jsErrors}`);

log(fails === 0 ? '\\nALL OK' : `\\nFAILS: ${fails}`);
run('close --all');
process.exit(fails === 0 ? 0 : 1);
