// Визуальная верификация Task 18: скриншоты новых фич для VLM
//  (толпа экипажа на палубе Victory, пираты-человечки на острове логова,
//   трупы после картечи по берегу, разлом дерева на 3 куска,
//   мачта без обвязки до/после ломания)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) b.click(); return 'start'; })()`);
await sleep(2500);

// === 1. Толпа на палубе Victory (73 фигуры, 850 экипажа) ===
log('1: толпа на палубе Victory');
ev(`(() => {
  const g = window.__game;
  g.startProving('victory');
  g.changeShip('victory', true); // игрок сам на линкоре
  const p = g.player;
  p.crew = 850;          // полная команда
  p.crew3d.reset();      // поднять всех (не трупы)
  p.sailOverride = 0.5;
  g.setCameraMode('free');
  g.rig.freeAzimSet(0.9);   // с носа-борта
  g.rig.freeElevSet(0.34);  // сверху, палуба как план
  g.rig.distSet(46);
  return 'victory crowd';
})()`);
await sleep(3500);
shot('t18_victory_crowd');
await sleep(400);

// === 2. Пираты-человечки на острове логова (густо, лагерные кластеры) ===
log('2: пираты на острове логова');
const folkInfo = ev(`(() => {
  const g = window.__game;
  g.exitProving();
  g.changeShip('sloop', true); // маленький корабль — не загораживает берег
  const p = g.player;
  const lf = g.lairFolk;
  const isl = g.world.islands.find(i => i.name === 'Логово пиратов');
  // самый плотный кластер: фигура с максимумом соседей в 8 м
  const kids = lf.group.children.filter(c => c.visible);
  let best = kids[0], bestN = -1;
  for (const c of kids) {
    let n = 0;
    for (const q of kids) if (Math.hypot(q.position.x - c.position.x, q.position.z - c.position.z) < 8) n++;
    if (n > bestN) { bestN = n; best = c; }
  }
  const clusterAt = best.position;
  // направление от центра острова к кластеру = в море
  const dx = clusterAt.x - isl.cx, dz = clusterAt.z - isl.cz;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  // игрок в 12 м к морю от кластера; камера ближе — костёр в кадре
  p.position.set(clusterAt.x + ux * 12, 0, clusterAt.z + uz * 12);
  p.quaternion.setFromEuler({ x: 0, y: Math.atan2(ux, uz), z: 0, order: 'YXZ' });
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(ux, uz)); // камера со стороны моря
  g.rig.freeElevSet(0.26);
  g.rig.distSet(22);
  return JSON.stringify({ cluster: { x: +clusterAt.x.toFixed(0), z: +clusterAt.z.toFixed(0) }, near: bestN, total: lf.total });
})()`);
log('2:', folkInfo);
await sleep(3500);
shot('t18_lair_folk');
await sleep(400);
// широкий план: весь берег с лагерями
log('2b: широкий план логова');
ev(`(() => {
  const g = window.__game;
  g.rig.freeElevSet(0.42);
  g.rig.distSet(60);
  return 'wide';
})()`);
await sleep(2500);
shot('t18_lair_wide');
await sleep(400);

// === 3. После картечи по берегу: трупы лежат (убиваем В КАДРЕ) ===
log('3: картечь по берегу — трупы');
const corpseInfo = ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const lf = g.lairFolk;
  // «залп» картечи: накрываем живых в 30 м от игрока (они в кадре)
  const alive = lf.group.children.filter(c => c.visible);
  let killed = 0;
  for (const c of alive) {
    const d = Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z);
    if (d < 30) killed += lf.killNear(c.position.x, c.position.y, c.position.z, 2.8, 'grape');
  }
  for (let i = 0; i < 45; i++) lf.update(1/60, i/60); // трупы падают
  // обратно БЛИЖЕ: трупы в кадре крупно (широкий план 2b не наследуем)
  g.rig.freeElevSet(0.15);
  g.rig.distSet(19);
  return JSON.stringify({ killed, dead: lf.dead, shown: lf.shown, total: lf.total });
})()`);
log('3:', corpseInfo);
await sleep(600);
shot('t18_lair_corpses');
await sleep(400);

// === 4. Дерево ломается на 3 части (пальма у камеры) ===
log('4: пальма — 3 куска');
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const w = g.world;
  // живая пальма на острове «Пальмовая гавань» или любом
  const slot = w.vegSlots.find(s => s.kind === 'palm');
  const idx = slot.broken.findIndex(b => !b);
  const palm = slot.positions[idx];
  // корабль в 24 м от пальмы, камера ещё дальше — дерево в кадре
  const dx = palm.x - p.position.x, dz = palm.z - p.position.z;
  // ставим игрока со стороны моря относительно пальмы (от центра ближайшего острова)
  let best = null, bd = 1e9;
  for (const isl of w.islands) {
    const d = Math.hypot(palm.x - isl.cx, palm.z - isl.cz);
    if (d < bd) { bd = d; best = isl; }
  }
  const ux = (palm.x - best.cx) / (bd || 1), uz = (palm.z - best.cz) / (bd || 1);
  p.position.set(palm.x + ux * 22, 0, palm.z + uz * 22);
  p.quaternion.setFromEuler({ x: 0, y: Math.atan2(ux, uz), z: 0, order: 'YXZ' });
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(ux, uz));
  g.rig.freeElevSet(0.10);
  g.rig.distSet(30);
  return JSON.stringify({ palmAt: { x: +palm.x.toFixed(0), z: +palm.z.toFixed(0), y: +palm.y.toFixed(1) } });
})()`);
await sleep(2500);
shot('t18_palm_before');
// ломаем — куски летят: скрин сразу
ev(`(() => {
  const g = window.__game;
  const w = g.world;
  const p = g.player;
  // та же пальма: ближайшая к точке перед носом
  const slot = w.vegSlots.find(s => s.kind === 'palm');
  // ищем живую пальму в 40 м от игрока
  let best = null, bd = 1e9;
  for (let i = 0; i < slot.positions.length; i++) {
    if (slot.broken[i]) continue;
    const q = slot.positions[i];
    const d = Math.hypot(q.x - p.position.x, q.z - p.position.z);
    if (d < bd) { bd = d; best = q; }
  }
  const broke = w.breakTrees(best.x, best.y, best.z, 3.5, g.particles, g.gibs);
  return JSON.stringify({ broke, d: +bd.toFixed(1) });
})()`);
await sleep(350);
shot('t18_palm_pieces');
await sleep(1200);

// === 5. Мачта без обвязки (до/после) ===
log('5: мачта и обвязка');
ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const p = g.player;
  g.setCameraMode('free');
  g.rig.freeAzimSet(1.57);  // точно с борта
  g.rig.freeElevSet(0.12);
  g.rig.distSet(40);
  return 'rigging before';
})()`);
await sleep(3000);
shot('t18_rigging_before');
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.breakMast(0); // передняя мачта падает, её обвязка рвётся
  for (let i = 0; i < 90; i++) { p.updateVisual(1/60, i/60, g.particles); }
  return JSON.stringify({ snapped: p.riggingSnapped() });
})()`);
await sleep(2500);
shot('t18_rigging_after');
await sleep(400);
log('done');
