// Пересъёмка следа шлюпки КАМЕРОЙ СЛЕЖЕНИЯ (free-режим целился в корабль)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2500);

// спуск + гребля по прямой, камера ПО УМОЛЧАНИЮ следует за шлюпкой
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  const bl = g.boatLaunch;
  bl.tryLaunch(false);
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1/60; bl.update(1/60, t); }
  bl.row = 1; bl.steer = 0;
  for (let i = 0; i < 960; i++) { t += 1/60; bl.update(1/60, t); }  // 16 с хода
  bl.row = 0;
  return JSON.stringify({ phase: bl.phase, wake: bl.wake.count(), vel: +bl.vel.toFixed(2) });
})()`);
await sleep(1200);   // камера доворачивается за шлюпкой
shot('t26_boat_wake2');
await sleep(300);
// второй кадр чуть позже — след длиннее
ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  bl.row = 1;
  let t = g.time;
  for (let i = 0; i < 480; i++) { t += 1/60; bl.update(1/60, t); }
  bl.row = 0;
  return JSON.stringify({ wake: bl.wake.count() });
})()`);
await sleep(1200);
shot('t26_boat_wake3');
run('close --all');
