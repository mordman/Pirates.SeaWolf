// E2E v5: скриншоты (паруса/шторм/пена/настройки/дальность) + проверка ИИ
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const q = (s) => s.replace(/"/g, '\\"');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = (name) => { run(`screenshot scripts/shots/${name}`); console.log('shot:', name); };
const key = (code) => run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))"`);
const wheel = (n) => run(`eval "for(let i=0;i<${n};i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true}))"`);

console.log('=== Перезагрузка и старт ===');
run('reload'); run('wait 6000');
run(`find text "Поднять флаг" click`); run('wait 2000');

// Разгон под парусами (уровень 3) + кормовая камера
run(`eval "${q(`(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  p.anchored = false; p.sailTarget = 3;
  let t = 0;
  for (let i = 0; i < 1500; i++) p.fixedStep(1/60, t += 1/60);
  g.paused = false; return 'ok';
})()`)}"`);
key('KeyC'); await sleep(2500); // iso -> rear
wheel(-14); await sleep(1500);  // приблизить (zoom in)
await sleep(4000);
shot('sails_full_rear.png');

// Уровень 1 — парусов должно быть мало
run(`eval "window.__game.player.sailTarget = 1"`);
await sleep(12000);
shot('sails_lvl1_rear.png');

// Уровень 0 — все убраны
run(`eval "window.__game.player.sailTarget = 0"`);
await sleep(12000);
shot('sails_lvl0_rear.png');

// Шторм: уровень 2, ветер 16, вид сбоку для волн и пены
run(`eval "window.__game.debugSetWind(16); window.__game.player.sailTarget = 2"`);
key('KeyC'); await sleep(1500); // rear -> side
await sleep(16000);
shot('storm_side_foam.png');

// Шторм с кормы — корабль на волнах
key('KeyC'); await sleep(1200); key('KeyC'); await sleep(1200); key('KeyC'); await sleep(2500); // side -> free -> iso
shot('storm_iso.png');
run(`eval "window.__game.debugSetWind(7)"`);

// Настройки: открыть, скриншот, пресет Ультра, закрыть
run(`find text "Настройки" click`);
await sleep(1200);
shot('settings_panel.png');
run(`find text "Ультра" click`);
await sleep(2500);
console.log('localStorage:', run(`eval "localStorage.getItem('seawolves.settings.v1') ? 'SAVED' : 'MISSING'"`));
run(`find text "Готово" click`);
await sleep(1500);
wheel(16); await sleep(2500); // отдалить (zoom out)
shot('drawdistance_iso.png');
console.log('errors:', run('errors'));

// ---- Проверка ИИ: сходятся ли к вейпоинтам с новым знаком руля ----
console.log('=== ИИ: сходимость к вейпоинтам (60 сим-сек) ===');
const aiTest = `(() => {
  const g = window.__game;
  g.paused = true;
  const dist = (ai) => { const w = ai.waypoints[ai.wpIndex]; return Math.hypot(ai.ship.position.x - w.x, ai.ship.position.z - w.z); };
  const d0 = g.aiShips.map(dist);
  let t = 0;
  for (let i = 0; i < 3600; i++) {
    t += 1/60;
    for (const ai of g.aiShips) ai.ship.fixedStep(1/60, t);
    for (const ai of g.aiShips) ai.update(1/60, t, g.player, g.combat, () => {});
  }
  const d1 = g.aiShips.map(dist);
  g.paused = false;
  return JSON.stringify({
    states: g.aiShips.map(ai => ai.state),
    d0: d0.map(d => Math.round(d)), d1: d1.map(d => Math.round(d)),
    speeds: g.aiShips.map(ai => +ai.ship.speedKnots().toFixed(1)),
    converged: d1.map((d, i) => d < d0[i]).every(Boolean),
  });
})()`;
console.log(run(`eval "${q(aiTest)}"`));
console.log('errors:', run('errors'));
console.log('DONE');
