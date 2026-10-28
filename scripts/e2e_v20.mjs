// E2E v20: крупные планы — упавшая мачта (детерминированно) и экипаж вблизи
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

console.log('=== Детерминированный слом двух мачт (фок и мизzen) ===');
ev('window.__game.pgTarget.ship.damageMast(0, 100)');
ev('window.__game.pgTarget.ship.damageMast(2, 100)');
await sleep(16000); // анимация падения ~2.4 игровых сек (в headless растянуто)
ev('JSON.stringify(window.__game.pgTarget.ship.mastFall)');
// игрок в 22 м от мишени курсом на запад (мишень по правому борту)
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x + 22, 0, t.position.z + 8); g.player.quaternion.set(0, -Math.SQRT1_2, 0, Math.SQRT1_2); g.player.velocity.set(0,0,0); return 'ok'; })()`);
// изометрия поближе
ev('(() => { const g = window.__game; g.rig.dist.iso = 34; return "iso " + g.rig.mode; })()');
await sleep(4500);
await shot('v20_mast_fall');

console.log('=== Экипаж мишени крупно (12 м, изометрия 20 м) ===');
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x + 14, 0, t.position.z + 14); g.player.quaternion.set(0, -Math.SQRT1_2, 0, Math.SQRT1_2); g.rig.dist.iso = 22; return "ok"; })()`);
await sleep(4000);
await shot('v20_crew_zoom');
console.log('фигур экипажа мишени:', ev('window.__game.pgTarget.ship.crew3d.shown'), 'из', ev('window.__game.pgTarget.ship.crew3d.total'));

const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
