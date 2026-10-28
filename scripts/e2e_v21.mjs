// E2E v21: визуальная проверка пробоин (декали) и типажей матросов вблизи
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${(e.stdout || '') + (e.stderr || '')}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

console.log('=== Вход в полигон ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear');
run('find text "Полигон разрушений" click');
await sleep(7000);

console.log('=== Пробоины декалитами (обе стороны борта) ===');
ev(`(() => {
  const t = window.__game.pgTarget.ship;
  const V = THREE_NOOP; // THREE недоступен — добавляем через интерфейс игры
  return 'через combat';
})()`);
// addHole ждёт THREE.Vector3 — вызовем через applyDamage с hitPoint нельзя (нужен мир),
// поэтому пробоии добавим прямым выстрелом: приблизим игрока на 60 м и дам 2 залпа
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - 60, 0, t.position.z); g.player.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2); g.rig.dist.iso = 40; return 'ok'; })()`);
ev('window.__game.combat.toggleAim(1)');
ev('(() => { const a = window.__game.combat.aim; a.azimuth = 0; a.elevation = 0.05; return "aim"; })()');
await sleep(500);
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1'}))"`);
await sleep(150);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit1'}))"`);
await sleep(300);
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
await sleep(150);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
await sleep(12000); // перезарядка+полёт в headless
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
await sleep(150);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
await sleep(10000);
console.log('пробоин:', ev('window.__game.pgTarget.ship.hullHoles.length'));
// вид с носа мишени, чтобы видеть борт с дырами
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - 26, 0, t.position.z + 20); g.player.quaternion.set(0, -Math.SQRT1_2, 0, Math.SQRT1_2); g.rig.dist.iso = 30; return 'ok'; })()`);
await sleep(4000);
await shot('v21_holes');

console.log('=== Типаж вблизи (камера 9 м от палубы мишени) ===');
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - 7, 0, t.position.z + 3); g.rig.dist.iso = 9; return 'ok'; })()`);
await sleep(4000);
await shot('v21_figures_close');
console.log('фигур:', ev('window.__game.pgTarget.ship.crew3d.shown'));

const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
