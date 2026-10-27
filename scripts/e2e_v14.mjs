// E2E v14: паруса на оптимальном курсе (галфвинд) — проверка пуза
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => { run(`screenshot scripts/shots/${name}`); console.log('shot:', name); };
const sea = () => ev(`JSON.stringify({kn:+window.__sea.speed.toFixed(1), set:window.__sea.sailSet, furlAvg:+window.__sea.furlAvg.toFixed(2), setTot:+window.__sea.setTot.toFixed(2)})`);

run('reload'); run('wait 7000');
run("find text \"Поднять флаг\" click");
run('wait 2500');

// курс галфвинд: ветер с кормовых углов траверза, polar ~1
ev(`(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(9); p.anchored = false; p.sailTarget = 3;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  // ветер ОТКУДА ~0.8: чтобы дул в траверз, курс = 0.8 + PI/2
  p.quaternion.setFromEuler(new p.euler.constructor(0, 2.37, 0, 'YXZ'));
  let t = 0;
  for (let i = 0; i < 3600; i++) {
    t += 1/60;
    if (i % 45 === 0) g.debugSetWind(9);
    g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    // удерживаем курс точно (рулевой на стенде): гасим рыскание
    if (i % 10 === 0) { p.angular.y *= 0.3; }
  }
  g.__pin = setInterval(() => g.debugSetWind(9), 700);
  g.paused = false; return 'ok';
})()`);
await sleep(4500);
run("eval \"for(let i=0;i<6;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(2500);
shot('v14_sails_full.png');
console.log('паруса:', sea());
ev(`clearInterval(window.__game.__pin); window.__game.debugSetWind(7);`);
run('errors');
