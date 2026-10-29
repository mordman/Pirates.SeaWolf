// E2E v19: ответный огонь мишени + крупный план экипажа мишени
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${(e.stdout || '') + (e.stderr || '')}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const num = (js) => parseFloat(ev(js));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

console.log('=== Вход в полигон, включаем ответный огонь ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear');
run('find text "Полигон разрушений" click');
await sleep(7000);
run('find text "Мишень не стреляет" click'); // включить ответный огонь
await sleep(500);
console.log('returnFire:', ev('window.__game.pgTarget.returnFire'));

// мишень стреляет каждые 9-13 игровых секунд; ждём попадания до 200с
const h0 = num('window.__game.player.hullHP');
let hit = false;
for (let i = 0; i < 100; i++) {
  await sleep(2000);
  const h = num('window.__game.player.hullHP');
  if (h < h0 - 0.5) { hit = true; break; }
}
console.log(`корпус игрока: ${h0} → ${num('window.__game.player.hullHP')} — ответный огонь ${hit ? 'ПОПАДАЕТ ✓' : 'не попал ✗'}`);

console.log('=== Крупный план экипажа мишени (28 м) ===');
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - 28, 0, t.position.z + 10); g.player.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2); g.player.velocity.set(0,0,0); return 'ok'; })()`);
await sleep(3500);
await shot('v19_crew_target_zoom');
console.log('shown:', ev('window.__game.pgTarget.ship.crew3d.shown'), '/', ev('window.__game.pgTarget.ship.crew3d.total'));

const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
