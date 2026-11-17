// Task 79: проекционная диагностика «кливер vs нос» — экранное
// положение нижней кромки кливера относительно штевня/фигуры
// при ТОЙ же камере, что на скриншоте t79_bow_front.
import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 420000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
runRaw('close'); runRaw('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`); await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`window.__game.changeShip('frigate', true)`);
await sleep(1000);
ev(`(() => { const g = window.__game; g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(3); return 1; })()`);
await sleep(400);
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 0.65); g.rig.freeElevSet(0.10); g.rig.distSet(30);
  g.stepDebug(0.2); return 1; })()`);
let out = ev(`(() => {
  const g = window.__game, sh = g.player, P = sh.preset, L = P.length;
  const cam = g.rig.camera;
  const W = window.innerWidth, H = window.innerHeight;
  const tmp = sh.position.clone();           // экземпляр Vector3
  const scr = (x, y, z) => {
    // в мир: позиция корабля + поворот
    tmp.set(x, y, z).applyQuaternion(sh.quaternion).add(sh.position);
    tmp.project(cam);
    return [Math.round((tmp.x * 0.5 + 0.5) * W), Math.round((-tmp.y * 0.5 + 0.5) * H), +tmp.z.toFixed(2)];
  };
  const jibs = sh.visual.sails.sails.filter(s => !s.square);
  const jib = jibs[1] || jibs[0];            // внутренний кливер
  const pv = jib.quad.pivot, c = jib.quad.corners;
  // кромка полотна: u=1 (от такелажа к шкоту) — точки v=0..1
  const foot = [];
  for (let k = 0; k <= 4; k++) {
    const v = k / 4;
    const x = pv.x + c[1].x * (1 - v) + (c[2].x - c[1].x) * 0 + 0; // упростим ниже
    foot.push(null);
  }
  // честно: локальная точка полотна = lerp(a*u, b*u, v), u=1
  const a = { x: -c[1].z, y: c[1].y };       // такелаж (к бушприту)
  const b = { x: -c[2].z, y: c[2].y };       // шкот
  const res = { size: [W, H], foot: [], stem: [], fig: [], bulwark: [] };
  for (let k = 0; k <= 4; k++) {
    const v = k / 4;
    const lx = a.x * (1 - v) + b.x * v, ly = a.y * (1 - v) + b.y * v;
    // мир: pivot + (0, ly, -lx)  (меш rotY=+90: мирZ = -локX)
    res.foot.push(scr(pv.x, pv.y + ly, pv.z - lx));
  }
  // топ штевня (каркас), топ фигуры, топ фальшборта у носа (оба борта)
  res.stem.push(scr(0, P.freeboard * 1.17 * 0.9, L * 0.52));
  res.fig.push(scr(0, P.freeboard * 1.02 + 1.9, L / 2 - 0.15));
  res.bulwark.push(scr(1.5, 3.0, L * 0.46), scr(-1.5, 3.0, L * 0.46));
  // верх бушприта у основания и конца
  res.spr = [scr(0, P.freeboard * 0.75, L / 2 + L * 0.12),
             scr(0, P.freeboard * 0.75 + 3.4, L / 2 + L * 0.12 + 11.5)];
  return JSON.stringify(res); })()`);
console.log(out.slice(0, 1500));
runRaw('close');
