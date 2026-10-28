// Скриншот полигона: оба корабля в кадре (проверка сближения)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('find text "Полигон разрушений" click');
await sleep(8000);
// свободная камера не обязательна: изометрия подальше видит оба корабля
ev('window.__game.rig.dist.iso = 240');
await sleep(1800);
run('screenshot /home/z/my-project/scripts/shots/v24_ships_closer.png');
// и вид пониже, с уровня моря — кромка чанка у горизонта
ev('window.__game.rig.cycleMode()'); // side
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/v24_sea_side2.png');
const s = run('eval "JSON.stringify(window.__sea.tgtDist)"');
console.log('tgtDist:', s);
run('close');
