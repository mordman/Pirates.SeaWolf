// Task 83: крупные планы «Чёрной жемчужины» для замера цветов
// планширя/квартердека (адаптация камерной математики t82_shots.mjs).
import { execSync } from 'node:child_process';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const run = (cmd) => execSync(`agent-browser ${cmd}`, { encoding: 'utf8', timeout: 60000 });
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`).trim();

const out = '/home/z/my-project/scripts/shots';
const info = ev(`(() => {
  const g = window.__game;
  const cv = document.querySelector('canvas');
  const anc = new Set(); let e = cv; while (e) { anc.add(e); e = e.parentElement; }
  for (const el of document.body.querySelectorAll('*')) if (!anc.has(el)) el.style.display = 'none';
  window.__t82rig = g.rig.update; g.rig.update = () => {};
  g.paused = true;
  const c = g.rig.camera, grp = g.player.visual.group;
  const f = grp.getWorldDirection(g.player.position.clone()); const pp = g.player.position.clone().set(f.z, 0, -f.x);
  return g.player.preset.id + ':L=' + g.player.preset.length.toFixed(1) + ':F=' + g.player.preset.freeboard.toFixed(2)
    + ':Q=' + (g.player.preset.quarter || 0)
    + ':SUN=' + (g.sky.sunDir.x * pp.x + g.sky.sunDir.z * pp.z).toFixed(3)
    + ':SUNY=' + g.sky.sunDir.y.toFixed(3) + ':HOUR=' + (g.sky.hour ?? 0);
})()`);
console.log('корабль:', info);
const L = parseFloat((String(info).match(/L=([\d.]+)/) || [])[1] || '40');
const F = parseFloat((String(info).match(/F=([\d.]+)/) || [])[1] || '3.6');
const Q = parseFloat((String(info).match(/Q=([\d.]+)/) || [])[1] || '2');
const num = (x) => typeof x === 'number' ? x * L : parseFloat(x);
const sd = (parseFloat((String(info).match(/SUN=(-?[\d.]+)/) || [])[1] || '1') >= 0) ? 1 : -1;
// [имя, (вдоль, вбок, высота) в метрах, точка взгляда (вдоль, высота)]
const views = [
  ['qd_deck',  [-0.30 * L, 9, F + Q + 3.2], [-0.30 * L, F + Q]],
  ['qd_rail',  [-0.28 * L, 7, F + Q + 1.1], [-0.20 * L, F + Q + 0.9]],
  ['rail_cap', [0.10 * L, 8, F + 1.2],      [0.10 * L, F + 0.6]],
  ['hull_side',[0.05 * L, 13, F * 0.8],     [0.05 * L, F * 0.55]],
];
for (const [name, cam, look] of views) {
  const ca = num(cam[0]), cb = num(cam[1]) * sd, ch = num(cam[2]);
  const la = num(look[0]), lh = num(look[1]);
  ev(`(() => {
    const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
    const sp = g.player.position.clone().add(g.shift);
    const f = grp.getWorldDirection(sp.clone());
    const p = sp.clone().set(f.z, 0, -f.x);
    c.position.copy(sp).addScaledVector(f, ${ca}).addScaledVector(p, ${cb});
    c.position.y += ${ch};
    const lk = sp.clone().addScaledVector(f, ${la});
    lk.y += ${lh};
    c.lookAt(lk); c.updateMatrixWorld();
    return 'ok';
  })()`);
  await sleep(700);
  run(`screenshot ${out}/t83_${name}.png`);
  console.log(name, 'снят');
}
// вернуть UI
ev(`(() => { const g = window.__game; g.rig.update = window.__t82rig; g.paused = false;
  for (const el of document.body.querySelectorAll('*')) el.style.display = ''; return 'ui-back'; })()`);
console.log('DONE');
