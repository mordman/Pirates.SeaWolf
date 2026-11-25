// Task 82: проверка, что ручная установка камеры не перезаписывается
// игровым циклом (тряска/риг), и где реально стоит корабль в сцене.
// Запуск: node scripts/t82_camdbg.mjs
import { execSync } from 'node:child_process';
const run = (args) => { try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); } catch (e) { return `ERR ${e.stdout || ''} ${e.stderr || ''}`; } };
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const st = () => JSON.parse(String(ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  const wp = grp.getWorldPosition(grp.position.clone()); const d = c.position.distanceTo(wp);
  return JSON.stringify({ cam: [c.position.x.toFixed(1), c.position.y.toFixed(1), c.position.z.toFixed(1)], ship: [wp.x.toFixed(1), wp.y.toFixed(1), wp.z.toFixed(1)],
    pos: [g.player.position.x.toFixed(1), g.player.position.y.toFixed(2), g.player.position.z.toFixed(1)], shift: [g.shift.x.toFixed(1), g.shift.y.toFixed(1), g.shift.z.toFixed(1)],
    dist: d.toFixed(1), paused: g.paused, rigMode: g.rig.mode, rigKeys: Object.keys(g.rig).slice(0, 30).join(','),
    grpPos: [grp.position.x.toFixed(1), grp.position.y.toFixed(2), grp.position.z.toFixed(1)], parent: grp.parent && grp.parent.name, up: [c.up.x, c.up.y, c.up.z] }); })()`)).replace(/^"|"$/g, '').replace(/\\"/g, '"'));
console.log('before', st());
ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  const sp = g.player.position.clone().add(g.shift);
  const f = grp.getWorldDirection(sp.clone()); const p = sp.clone().set(f.z, 0, -f.x);
  c.position.copy(sp).addScaledVector(p, -20.7); c.position.y += 2.8;
  const lk = sp.clone(); lk.y += 7.56; c.lookAt(lk); c.updateMatrixWorld(); return 'ok'; })()`);
console.log('set', st());
await sleep(1500);
console.log('after 1.5s', st());
