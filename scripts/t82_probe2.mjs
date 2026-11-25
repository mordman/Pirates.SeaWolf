// Task 82: где в кадре корпуса лежат пояса? Проецирует точки борта
// (ватерлиния y=0, вельс, палуба, планширь) в пиксели и печатает
// вертикальный профиль цвета по центру корабля для кадров
// on / off / paint (чтение пикселей — в t82_probe2.py).
// Запуск: node scripts/t82_probe2.mjs  (после t82_probe1 — страница открыта)
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const out = '/home/z/my-project/scripts/shots/t82_probe';
const run = (args) => { try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); } catch (e) { return `ERR ${e.stdout || ''} ${e.stderr || ''}`; } };
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const info = ev(`(() => { const g = window.__game; return g.player.preset.id + ':' + g.player.preset.length; })()`);
const L = parseFloat((String(info).match(/:([\d.]+)$/) || [])[1] || '28');
ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  const sp = g.player.position.clone().add(g.shift);
  const f = grp.getWorldDirection(sp.clone()); const p = sp.clone().set(f.z, 0, -f.x);
  c.position.copy(sp).addScaledVector(p, ${-0.74 * L}); c.position.y += ${0.10 * L};
  const lk = sp.clone(); lk.y += ${0.27 * L}; c.lookAt(lk); c.updateMatrixWorld(); return 'ok'; })()`);
const proj = ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  grp.updateWorldMatrix(true, false); g.rig.camera.updateMatrixWorld();
  const V = g.player.visual.group.position.constructor; const out = {};
  const w = c.userData && c.userData.w; const W = innerWidth, H = innerHeight;
  const P = (name, x, y, z) => { const v = new V(x, y, z).applyMatrix4(grp.matrixWorld).project(c);
    out[name] = [Math.round((v.x + 1) / 2 * W), Math.round((1 - v.y) / 2 * H)]; };
  const hp = g.player.visual.planks.group.getObjectByName('Planks_Port').geometry.attributes.position;
  let ymin = 1e9, ymax = -1e9; for (let i = 0; i < hp.count; i++) { ymin = Math.min(ymin, hp.getY(i)); ymax = Math.max(ymax, hp.getY(i)); }
  P('wl', 0, 0, 0); P('wlBow', 0, 0, ${0.3 * L}); P('wlStern', 0, 0, ${-0.3 * L});
  P('wale0', 0, 0.9, 0); P('wale1', 0, 1.35, 0); P('rail0', 0, 1.67, 0); P('y2', 0, 2, 0);
  P('y3', 0, 3, 0); P('y4', 0, 4, 0); P('y5', 0, 5, 0); P('y6', 0, 6, 0);
  const hull = g.player.visual.group.getObjectByName('Keel_Bottom');
  out.hull = hull ? hull.name : 'none';
  return JSON.stringify({ pts: out, plankY: [ymin.toFixed(2), ymax.toFixed(2)], shipY: g.player.position.y.toFixed(3),
    draft: g.player.preset.draft, sun: g.sky.sunDir ? [g.sky.sunDir.x.toFixed(2), g.sky.sunDir.y.toFixed(2), g.sky.sunDir.z.toFixed(2)] : null,
    cam: [c.position.x.toFixed(1), c.position.y.toFixed(1), c.position.z.toFixed(1)], vp: [W, H], waterY: (g.water && g.water.heightAt) ? 'has' : 'no' }); })()`);
console.log(info, proj);
writeFileSync(`${out}/proj.json`, String(proj).replace(/^"|"$/g, '').replace(/\\"/g, '"'));
await sleep(600);
run(`screenshot ${out}/side2.png`);
