// E2E v12: скриншоты для VLM — паруса (пузо), шторм (борт над водой), пена, настройки
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => { run(`screenshot scripts/shots/${name}`); console.log('shot:', name); };

run('reload'); run('wait 7000');
run("find text \"Поднять флаг\" click");
run('wait 2500');

// --- 1. Разгон (60 c физики), камера с кормы, зум ближе: паруса с пузом ---
ev(`(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(9); p.anchored = false; p.sailTarget = 3;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.quaternion.setFromEuler(new p.euler.constructor(0, 0.9, 0, 'YXZ'));
  let t = 0;
  for (let i = 0; i < 3600; i++) {
    t += 1/60;
    if (i % 45 === 0) g.debugSetWind(9);
    g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
  }
  g.paused = false; return 'ok';
})()`);
// камера: iso -> rear
run("eval \"window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))\"");
await sleep(4000);
// зум ближе
run("eval \"for(let i=0;i<10;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(3000);
shot('v12_sails_rear.png');

// --- 2. Шторм: 90 c физики при ветре 16, вид сбоку: борт над водой ---
ev(`(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(16); p.anchored = false; p.sailTarget = 2;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  let t = 0;
  for (let i = 0; i < 5400; i++) {
    t += 1/60;
    if (i % 45 === 0) g.debugSetWind(16);
    g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
  }
  // прибить ветер и после снятия паузы
  g.__pin = setInterval(() => g.debugSetWind(16), 800);
  g.paused = false; return 'ok';
})()`);
run("eval \"window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))\"");
await sleep(3000);
run("eval \"for(let i=0;i<6;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(2500);
shot('v12_storm_side.png');
console.log('телеметрия:', ev(`JSON.stringify({fb: +window.__sea.freeboard.toFixed(2), roll: +window.__sea.roll.toFixed(2), amp: +window.__sea.seaAmp.toFixed(2), spd: +window.__sea.speed.toFixed(1)})`));

// --- 3. Шторм изометрия: пена на просторе ---
run("eval \"window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))\"");
run("eval \"window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))\"");
await sleep(3500);
run("eval \"for(let i=0;i<8;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true}))\"");
await sleep(2500);
shot('v12_storm_iso_foam.png');

// убрать шторм
ev(`clearInterval(window.__game.__pin); window.__game.debugSetWind(7)`);

// --- 4. Настройки: графика (высота волн) + управление (инверсия руля) ---
run('find text "Настройки" click');
await sleep(1200);
shot('v12_settings_gfx.png');
run('find text "Управление" click');
await sleep(800);
shot('v12_settings_controls.png');
run('find text "Готово" click');
await sleep(800);
run('errors');
