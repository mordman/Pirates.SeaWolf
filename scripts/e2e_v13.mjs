// E2E v13: финальные скриншоты — паруса (ракурс 3/4 + телеметрия), воротник у носа, шторм
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => { run(`screenshot scripts/shots/${name}`); console.log('shot:', name); };
const sea = () => ev(`JSON.stringify({kn:+window.__sea.speed.toFixed(1), set:window.__sea.sailSet, furlAvg:+window.__sea.furlAvg.toFixed(2), setTot:+window.__sea.setTot.toFixed(2), fb:+window.__sea.freeboard.toFixed(2)})`);

run('reload'); run('wait 7000');
run("find text \"Поднять флаг\" click");
run('wait 2500');

// --- 1. Паруса: разгон 60 c физики, изометрия (ракурс 3/4), зум ближе ---
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
  g.__pin = setInterval(() => g.debugSetWind(9), 700);
  g.paused = false; return 'ok';
})()`);
await sleep(4500); // камера доворачивается
run("eval \"for(let i=0;i<7;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(2500);
shot('v13_sails_quarter.png');
console.log('паруса:', sea());

// --- 2. Близко к носу: пенный воротник с бортовым буруном ---
run("eval \"for(let i=0;i<6;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(2000);
shot('v13_bow_collar.png');
console.log('воротник:', sea());

// --- 3. Шторм сбоку: борт над водой + воротник пятнистый ---
ev(`(() => {
  const g = window.__game, p = g.player;
  clearInterval(g.__pin);
  g.paused = true;
  g.debugSetWind(16); p.anchored = false; p.sailTarget = 2;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  let t = 0;
  for (let i = 0; i < 5400; i++) {
    t += 1/60;
    if (i % 45 === 0) g.debugSetWind(16);
    g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
  }
  g.__pin = setInterval(() => g.debugSetWind(16), 700);
  g.paused = false; return 'ok';
})()`);
run("eval \"window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}))\"");
await sleep(3500);
run("eval \"for(let i=0;i<6;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(2000);
shot('v13_storm_side.png');
console.log('шторм:', sea());
ev(`clearInterval(window.__game.__pin); window.__game.debugSetWind(7);`);
run('errors');
