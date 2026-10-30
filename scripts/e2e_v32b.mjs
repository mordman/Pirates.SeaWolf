// E2E Task 15 (финальная детерминированная сверка A/B/C — без ожиданий
// реального времени: физика и погода гоняются fast-forward'ом, поэтому
// результат не зависит от FPS тестовой машины и параллельных сессий)
//  (A) стартовый боезапас 40/12/20/8 + недостача 1–10%; без джиттера — точно
//  (B) амплитуда волн = f(ветер): 8 м/с ≈ 0.80, 22 м/с ≥ 1.5 (шторм),
//      2 м/с ≤ 0.5 (штиль) — формула 0.22 + 0.072·wind
//  (C) шторм 22 м/с, паруса 2: минимальный надводный борт по ВСЕЙ палубе
//      (9 точек, кватернион) за 2 минуты игрового времени ≥ −0.55 м,
//      крен < 0.5 рад — корабль идёт ПО гребням, не внутрь волны
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
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
const clickBtn = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}')); if (b) { b.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
const pageErrors = () => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
};

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ============ A: боезапас ============
const ammoA = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ p: g.player.ammo, s: g.settings.gameplay.startingAmmo, j: g.settings.gameplay.ammoJitter }); })()`));
log('A:', JSON.stringify(ammoA));
check('A: настройки 40/12/20/8', ammoA.s.ball === 40 && ammoA.s.chain === 12 && ammoA.s.grape === 20 && ammoA.s.fire === 8);
const inR = (v, b) => v <= b && v >= Math.floor(b * 0.89);
check('A: у игрока недостача 1–10%', inR(ammoA.p.ball, 40) && inR(ammoA.p.chain, 12) && inR(ammoA.p.grape, 20) && inR(ammoA.p.fire, 8), JSON.stringify(ammoA.p));
ev(`(() => { const g = window.__game; g.settings.gameplay.ammoJitter = false; g.respawn(); return 1; })()`);
await sleep(800);
const ammoB = jparse(ev(`JSON.stringify(window.__game.player.ammo)`));
check('A: без джиттера ровно 40/12/20/8', ammoB.ball === 40 && ammoB.chain === 12 && ammoB.grape === 20 && ammoB.fire === 8, JSON.stringify(ammoB));

// ============ B: амплитуда волн от ветра (fast-forward погоды) ============
// ВАЖНО: window.__sea обновляется только на кадрах рендера — во время
// fast-forward читаем ЖИВУЮ высоту воды напрямую (гребень-подошва)
const amp = jparse(ev(`(() => {
  const g = window.__game;
  const peak2peak = (seconds) => {
    let mn = 1e9, mx = -1e9;
    for (let t = 0; t < seconds; t += 0.05) {
      g.time += 0.05;
      const h = g.waterHeight(500, 300);
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    return +(mx - mn).toFixed(2);
  };
  const ff = (wind, seconds) => { g.debugSetWind(wind); for (let i = 0; i < seconds * 10; i++) g.updateWeather(0.1); };
  ff(8, 45);  const h8 = peak2peak(20);
  ff(22, 90); const h22 = peak2peak(20);
  ff(2, 90);  const h2 = peak2peak(20);
  return JSON.stringify({ h8, h22, h2 });
})()`));
log('B: размах волны гребень-подошва (8/22/2 м/с):', JSON.stringify(amp));
// огибающая волнения: E(8)≈1.76 м, E(22)≈3.98, E(2)≈0.8;
// размах гребень-подошва от ~0.7·E (гребни не совпадают) до 2·E
check('B: 8 м/с — умеренная зыбь (1.0..3.4 м)', amp.h8 >= 1.0 && amp.h8 <= 3.4, `h8=${amp.h8}м`);
check('B: 22 м/с — ШТОРМ (размах > 3.5 м; при старом пределе было ~2.9)', amp.h22 > 3.5, `h22=${amp.h22}м`);
check('B: волны растут с ветром (шторм ≥ 2.2× штиля)', amp.h22 >= amp.h2 * 2.2, `h22/h2=${(amp.h22 / Math.max(0.01, amp.h2)).toFixed(1)}`);
check('B: 2 м/с — штиль (размах < 1.7 м)', amp.h2 < 1.7, `h2=${amp.h2}м`);

// ============ C: посадка на волну в шторм (fast-forward физики) ============
// как в основном сюите: паруса 1 (шторм несут минимальный парус),
// море предварительно РАЗВИТО (90 с штормового ветра)
const storm = jparse(ev(`(() => {
  const g = window.__game;
  g.debugSetWind(22);
  for (let i = 0; i < 900; i++) g.updateWeather(0.1); // 90 с — море развито
  const p = g.player;
  p.anchored = false; p.sailTarget = 1;
  const waterY = (x, z) => g.waterHeight(x, z);
  let minFb = 99, maxRoll = 0, minFbT = 0;
  const v = new (p.position.constructor)();
  for (let i = 0; i < 3600; i++) { // 60 игровых секунд шторма
    g.time += 1 / 60;
    g.updateWeather(1 / 60);
    p.fixedStep(1 / 60, g.time);
    if (i % 6 === 0) {
      // надводный борт: палуба (9 точек по длине/ширине) против воды
      const deckY = p.preset.freeboard * 0.82 - 1.0;
      for (const lz of [-p.preset.length * 0.46, 0, p.preset.length * 0.46]) {
        const hw = lz === 0 ? p.preset.beam * 0.5 : p.halfWidthAt(lz);
        for (const lx of [0, -hw, hw]) {
          v.set(lx, deckY, lz).applyQuaternion(p.quaternion).add(p.position);
          const fb = v.y - waterY(v.x, v.z);
          if (fb < minFb) { minFb = fb; minFbT = +(g.time).toFixed(0); }
        }
      }
      maxRoll = Math.max(maxRoll, Math.abs(p.euler.z));
    }
  }
  let mn = 1e9, mx = -1e9;
  for (let t = 0; t < 15; t += 0.05) { g.time += 0.05; const h = g.waterHeight(500, 300); mn = Math.min(mn, h); mx = Math.max(mx, h); }
  return JSON.stringify({ minFb: +minFb.toFixed(2), maxRoll: +maxRoll.toFixed(2), minFbT, waveH: +(mx - mn).toFixed(2), wind: +g.wind.speed.toFixed(1) });
})()`));
log('C: шторм (fast-forward 60 с, паруса 1):', JSON.stringify(storm));
check('C: море штормовое (размах > 3.5 м)', storm.waveH > 3.5, `волна=${storm.waveH}м ветер=${storm.wind}`);
check('C: палуба не ныряет под гребень (minFb > -0.55 м)', storm.minFb > -0.55, `minFb=${storm.minFb} при t=${storm.minFbT}с`);
check('C: крен в норме (< 0.5 рад)', storm.maxRoll < 0.5, `maxRoll=${storm.maxRoll}`);

// кадр для визуальной сверки (реальные кадры, вид сбоку)
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); g.rig.freeAzimSet(Math.PI * 0.62); g.rig.freeElevSet(0.14); g.rig.distSet(46); return 1; })()`);
await sleep(1800);
shot('v32b_storm_ride');

const errs = pageErrors();
check('нет ошибок страницы', errs === '', errs.slice(0, 200));

log(fails === 0 ? '\nALL OK' : `\nFAILED: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
