// E2E v8: визуальное направление поворота D vs A (скриншоты)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);

run('reload'); run('wait 6000');
run(`find text "Поднять флаг" click`); run('wait 2500');

// Разгон без поворота, камера iso
ev(`(() => { const g = window.__game, p = g.player; g.paused = true; p.anchored=false; p.sailTarget=3;
  let t=0; for(let i=0;i<900;i++){t+=1/60;p.fixedStep(1/60,t);} g.paused=false; return 'ok'; })()`);
await sleep(3500); // камера доворачивается за курсом
run(`screenshot scripts/shots/turn_before.png`);
console.log('shot: turn_before.png');

// Удерживаем D 7 секунд реального времени через setInterval внутри страницы
ev(`(() => { window.__holdD = true; const g = window.__game;
  g.__rudderHold = setInterval(() => { if (window.__holdD) g.player.rudderTarget = 1; }, 100); return 'ok'; })()`);
await sleep(7000);
ev(`window.__holdD = false; clearInterval(window.__game.__rudderHold); window.__game.player.rudderTarget = 0;`);
await sleep(1500);
run(`screenshot scripts/shots/turn_after_D.png`);
console.log('shot: turn_after_D.png');
const t1 = ev(`JSON.stringify({hdg: window.__game.player.heading.toFixed(3), cmp: Math.round(((-window.__game.player.heading*180/Math.PI)%360+360)%360), ru: window.__game.player.rudder.toFixed(2)})`);
console.log('после D:', t1);

// Теперь A — вернём курс обратно и продолжим влево
ev(`(() => { window.__holdA = true; const g = window.__game;
  g.__rudderHold = setInterval(() => { if (window.__holdA) g.player.rudderTarget = -1; }, 100); return 'ok'; })()`);
await sleep(7000);
ev(`window.__holdA = false; clearInterval(window.__game.__rudderHold); window.__game.player.rudderTarget = 0;`);
await sleep(1500);
run(`screenshot scripts/shots/turn_after_A.png`);
console.log('shot: turn_after_A.png');
const t2 = ev(`JSON.stringify({hdg: window.__game.player.heading.toFixed(3), cmp: Math.round(((-window.__game.player.heading*180/Math.PI)%360+360)%360)})`);
console.log('после A:', t2);
run('errors');
