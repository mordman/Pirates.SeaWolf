// Пересъёмка чаек: ждём, пока стая за судном дотянет до корабля
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);

// корабль уже у Пальмовой гавани (с прошлого прогона) — проверим
log('поз:', ev('JSON.stringify({x: Math.round(window.__game.player.position.x), z: Math.round(window.__game.player.position.z), gulls: window.__sea.gulls})'));

// камера: издалека-снизу, небо в кадре (чайки на его фоне)
ev(`(() => {
  const g = window.__game;
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.12);
  g.rig.distSet(64);
  g.rig.freeAzimSet(Math.PI); // камера к западу (море), смотрит на восток
  g.rig.snap();
  return 'ok';
})()`);
log('ждём стаю (75 с)…');
for (let t = 0; t < 5; t++) {
  await sleep(15000);
  log(`t=${(t + 1) * 15}s:`, ev('JSON.stringify(window.__sea.gulls)'));
}
shot('t30_gulls_flight');
log('снято: чайки');
log('ошибки JS:', ev('window.__jsErrors || 0'));
