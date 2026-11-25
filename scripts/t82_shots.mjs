// Task 82: съёмка корабля игрока с фиксированных ракурсов (для
// сравнения «до/после» и отчёта). Камера ставится вручную поверх
// камерного рига (rig.update подменяется на no-op), HUD прячется.
// Запуск: node scripts/t82_shots.mjs <tag> [presetId]
//   кадры: scripts/shots/t82_<tag>/<ракурс>.png
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const tag = process.argv[2] || 'before';
const presetId = process.argv[3] || '';
const out = `/home/z/my-project/scripts/shots/t82_${tag}`;
mkdirSync(out, { recursive: true });

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let outp = runRaw(args);
  for (let i = 0; i < tries && (!outp.trim() || outp.includes('Resource temporarily unavailable') || outp.includes('Cdp command timed out') || outp.includes('Failed to read')); i++) {
    execSync('sleep 12');
    outp = runRaw(args);
  }
  return outp;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

runRaw('close');
run('open http://localhost:3000');
try { run('set viewport 1600 900'); } catch { /* старые версии CLI без set viewport */ }
await sleep(9000);
for (let i = 0; i < 24; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

const info = await ev(`(() => {
  const g = window.__game;
  if ('${presetId}') { try { g.changeShip('${presetId}', true, true); } catch (e) {} }
  g.player.wind.speed = 11; g.player.wind.from = 1.2;
  g.player.sailTarget = 3; g.player.sailOverride = 1;
  g.player.velocity.set(0, 0, 0);
  window.__t82rig = g.rig.update;
  g.rig.update = () => {};
  // физика заморожена (рендер идёт): корабль не уходит из кадра,
  // пока переставляется камера (иначе за 1–2 с он смещался на метры)
  g.paused = true;
  const cv = document.querySelector('canvas');
  const anc = new Set(); let e = cv; while (e) { anc.add(e); e = e.parentElement; }
  for (const el of document.body.querySelectorAll('*')) if (!anc.has(el)) el.style.display = 'none';
  const c = g.rig.camera;
  const grp = g.player.visual.group;
  const f = grp.getWorldDirection(g.player.position.clone()); const pp = g.player.position.clone().set(f.z, 0, -f.x);
  return g.player.preset.id + ':L=' + g.player.preset.length.toFixed(1) + ':F=' + g.player.preset.freeboard.toFixed(2)
    + ':H=' + ((g.player.visual.masts[0] && g.player.visual.masts[0].userData.height) || 0).toFixed(1)
    + ':FOV=' + c.fov.toFixed(1) + ':ZOOM=' + c.zoom.toFixed(2) + ':ASPECT=' + c.aspect.toFixed(2)
    + ':SUN=' + (g.sky.sunDir.x * pp.x + g.sky.sunDir.z * pp.z).toFixed(3)
    + ':SUNY=' + g.sky.sunDir.y.toFixed(3);
})()`);
console.log('корабль:', info);

// ракурсы: [имя, вдоль носа a (доли L), в сторону СОЛНЕЧНОГО борта b (доли L),
//           высота камеры, точка взгляда (a, высота)]
// значение с суффиксом 'm' — в метрах. Знак b подбирается по солнцу
// (SUN): снимаем освещённый борт — в тени корпус не разобрать.
const L = parseFloat((String(info).match(/L=([\d.]+)/) || [])[1] || '24');
const F = parseFloat((String(info).match(/F=([\d.]+)/) || [])[1] || '3');
const H = parseFloat((String(info).match(/H=([\d.]+)/) || [])[1] || '20');
const views = [
  ['side',      [0, 0.74, 0.10 + 'L'],           [0, 0.27 + 'L']],
  ['bow34',     [0.60, 0.40, 0.15 + 'L'],        [0, 0.25 + 'L']],
  ['stern34',   [-0.56, 0.38, 0.20 + 'L'],       [0, 0.26 + 'L']],
  ['hull_close', [5 + 'm', 14 + 'm', 2.6 + 'm'], [2 + 'm', 1.7 + 'm']],
  ['planks_detail', [2 + 'm', 6.5 + 'm', 1.5 + 'm'], [1 + 'm', 1.3 + 'm']],
  ['deck',      [-0.40, 0.0, (F + 2.6) + 'm'],   [0.30, (F + 1.0) + 'm']],
  ['rig',       [0.05, 0.46, 0.40 + 'H'],        [0, 0.60 + 'H']],
  ['top',       [0.12, 0.05, 1.30 + 'H'],        [0, 0 + 'm']],
  // Task 82: крупные планы оконечностей и фальшборта изнутри
  ['bow_close', [0.30 + 'L', 7 + 'm', 1.6 + 'm'], [0.45 + 'L', 1.8 + 'm']],
  ['stern_close', [-0.60 + 'L', 4 + 'm', 2.4 + 'm'], [-0.44 + 'L', 2.0 + 'm']],
  ['rail_in',   [-0.16 + 'L', 0.4 + 'm', (F + 0.9) + 'm'], [0.20 + 'L', (F + 0.2) + 'm']],
];
const num = (x) => typeof x === 'number' ? x * L
  : parseFloat(x) * (x.endsWith('L') ? L : x.endsWith('H') ? H : 1);
// солнечный борт: +1 — порт (сторона p), −1 — штирборт
const sd = (parseFloat((String(info).match(/SUN=(-?[\d.]+)/) || [])[1] || '1') >= 0) ? 1 : -1;
for (const [name, cam, look] of views) {
  const ca = num(cam[0]), cb = num(cam[1]) * sd, ch = num(cam[2]);
  const la = num(look[0]), lh = num(look[1]);
  const r = await ev(`(() => {
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
  if (String(r).includes('ERR') || String(r).includes('rror')) console.log(name, '→', String(r).slice(0, 200));
  await sleep(900);
  run(`screenshot ${out}/${name}.png`);
  console.log('кадр', name);
}
// игровой вид (изометрия по умолчанию) — с родным ригом
ev(`(() => { const g = window.__game; g.rig.update = window.__t82rig; g.rig.snap(); return 1; })()`);
await sleep(2600);
run(`screenshot ${out}/iso.png`);
console.log('кадр iso — готово:', out);
