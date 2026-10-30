// E2E Task 16 — система пожаров (fast-forward, детерминированно):
//  (A) разгорание: очаг 0.35 → >0.5 за 60 с; урон корпусу/парусам/экипажу
//  (B) перекидывание ПО ВЕТРУ: горящая мишень в 30 м поджигает игрока
//  (C) тушение командой: crewAction гасит пожар, сообщение «Пожар потушен!»
//  (D) дождь тушит: rainRate=1 → пожар гаснет за ~40 с
//  (E) прогорание: после 40 с горения интенсивность падает, пожар гаснет
//  (F) затопление гасит: phase 2 (палуба под водой) → onFire=false
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
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

// ============ A: разгорание + урон ============
log('=== A: разгорание пожара ===');
const burn = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  p.clearDamage();
  p.ignite(0.35);
  const out = { i0: p.fireIntensity, samples: [] };
  const hull0 = p.hullHP, sail0 = p.sailHP, crew0 = p.crew;
  let time = g.time;
  for (let i = 0; i < 3600; i++) { // 60 игровых секунд
    time += 1 / 60; p.fixedStep(1 / 60, time);
    if (i % 900 === 899) out.samples.push(+p.fireIntensity.toFixed(2));
    if (p.sinking) break;
  }
  out.iMax = +p.fireIntensity.toFixed(2);
  out.hullDmg = +(hull0 - p.hullHP).toFixed(0);
  out.sailDmg = +(sail0 - p.sailHP).toFixed(0);
  out.crewDmg = +(crew0 - p.crew).toFixed(1);
  out.onFire = p.onFire ? 1 : 0;
  out.telemetryFire = window.__sea ? undefined : 0;
  p.clearDamage();
  return JSON.stringify(out);
})()`));
log('A:', JSON.stringify(burn));
check('A: очаг зажжён (0.35)', burn.i0 === 0.35);
check('A: пожар разгорается (I > 0.5 за 60 с)', burn.samples.some(v => v > 0.5) || burn.iMax > 0.5,
  `samples=${JSON.stringify(burn.samples)}`);
check('A: корпус горит (hullDmg > 20)', burn.hullDmg > 20, `hullDmg=${burn.hullDmg}`);
check('A: паруса обгорают при I>0.4 (sailDmg > 5)', burn.sailDmg > 5, `sailDmg=${burn.sailDmg}`);

// ============ B: перекидывание по ветру ============
log('=== B: перекидывание огня на соседний корабль ===');
const spread = jparse(ev(`(() => {
  const g = window.__game;
  g.settings.gameplay.provingDistance = 30;
  g.startProving('fluyt');
  // ветер С ВОСТОКА (90°): дует на −Z — с мишени (она на +Z от игрока) НА игрока
  g.debugSetWeather('clear', 6, 90);
  const t = g.pgTarget.ship;
  t.ignite(1.0);
  const out = { srcI: t.fireIntensity, dist: Math.round(t.position.distanceTo(g.player.position)) };
  let ignitedAt = -1;
  let time = g.time;
  for (let i = 0; i < 18000; i++) { // до 300 игровых секунд
    time += 1 / 60;
    g.time = time;
    g.updateFires(1 / 60);
    if (g.player.onFire) { ignitedAt = Math.round(i / 60); break; }
  }
  out.ignitedAt = ignitedAt;
  out.playerI = +g.player.fireIntensity.toFixed(2);
  out.playerFire = g.player.onFire ? 1 : 0;
  return JSON.stringify(out);
})()`));
log('B:', JSON.stringify(spread));
check('B: источник горит с полной силой', spread.srcI === 1);
check('B: пламя перекинулось на игрока (по ветру, 30 м)', spread.playerFire === 1,
  `t=${spread.ignitedAt}с I=${spread.playerI}`);

// ============ C: тушение командой (R) ============
log('=== C: тушение командой ===');
const ext = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  // игрок уже горит после B; докачаем силу и тушим как с R
  if (!p.onFire) p.ignite(0.5);
  p.fireIntensity = Math.max(p.fireIntensity, 0.5);
  const out = { i0: +p.fireIntensity.toFixed(2) };
  let msg = null;
  let time = g.time;
  for (let i = 0; i < 3600; i++) { // до 60 с
    time += 1 / 60; p.fixedStep(1 / 60, time); // огонь растёт и жжёт
    msg = p.crewAction(1 / 60);                 // команда льют вёдра
    if (!p.onFire) break;
  }
  out.msg = msg;
  out.onFire = p.onFire ? 1 : 0;
  out.i1 = +p.fireIntensity.toFixed(2);
  return JSON.stringify(out);
})()`));
log('C:', JSON.stringify(ext));
check('C: команда потушила пожар', ext.onFire === 0 && /потушен/i.test(String(ext.msg)),
  `msg=${ext.msg} I=${ext.i0}→${ext.i1}`);

// ============ D: дождь тушит ============
log('=== D: дождь тушит ===');
const rain = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  p.clearDamage();
  p.ignite(1.0);
  p.rainRate = 1; // ливень
  let time = g.time;
  let secs = 0;
  for (let i = 0; i < 6000 && p.onFire; i++) { // до 100 с
    time += 1 / 60; p.fixedStep(1 / 60, time); secs = i / 60;
  }
  const out = { onFire: p.onFire ? 1 : 0, secs: Math.round(secs) };
  p.rainRate = 0;
  p.clearDamage();
  return JSON.stringify(out);
})()`));
log('D:', JSON.stringify(rain));
check('D: ливень погасил пожар', rain.onFire === 0, `за ${rain.secs}с`);

// ============ E: прогорание (кончилось топливо) ============
log('=== E: догорание без дождя ===');
const fuel = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  p.clearDamage();
  p.ignite(0.8);
  let time = g.time;
  for (let i = 0; i < 9000 && p.onFire; i++) { // до 150 с
    time += 1 / 60; p.fixedStep(1 / 60, time);
  }
  const out = { onFire: p.onFire ? 1 : 0, hullLeft: +(p.hullHP / p.hullMax).toFixed(2) };
  p.clearDamage();
  return JSON.stringify(out);
})()`));
log('E:', JSON.stringify(fuel));
check('E: пожар прогорел и погас сам (палуба выгорела)', fuel.onFire === 0, `hull=${fuel.hullLeft}`);

// ============ F: затопление гасит огонь ============
log('=== F: тонущий корабль — огонь погашен водой ===');
const sinkFire = jparse(ev(`(() => {
  const g = window.__game;
  if (g.pgTarget) g.exitProving();
  g.startProving('fluyt');
  const t = g.pgTarget.ship;
  t.ignite(1.0);
  t.hullHP = 1;
  t.applyDamage({ kind: 'ball', amount: 50 }); // топим
  const out = { burning: t.onFire ? 1 : 0, sinking: t.sinking ? 1 : 0 };
  let time = g.time;
  for (let i = 0; i < 1800 && t.sinkPhase < 2; i++) { // до фазы 2
    time += 1 / 60; t.fixedStep(1 / 60, time);
  }
  out.phase = t.sinkPhase;
  out.fireAfter = t.onFire ? 1 : 0;
  return JSON.stringify(out);
})()`));
log('F:', JSON.stringify(sinkFire));
check('F: палуба под водой — пожар погашен (фаза 2, fire=0)',
  sinkFire.phase >= 2 && sinkFire.fireAfter === 0, JSON.stringify(sinkFire));

const errs = pageErrors();
check('нет ошибок страницы', errs === '', errs.slice(0, 200));

log(fails === 0 ? '\nALL OK' : `\nFAILED: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
