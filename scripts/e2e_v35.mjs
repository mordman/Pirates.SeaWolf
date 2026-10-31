// E2E Task 18 — пакет фич по фидбеку игрока:
//  (A) экипаж на палубе: 1 фигура = 1 человек; формула deckCrewFor
//      (500→50, 50→10, минимум 10, при N≤10 — все)
//  (B) остров логова ГУСТО заполнен пиратами-человечками:
//      ходоки/дворовые/часовые, картечь по берегу выкашивает их
//  (C) деревья ломаются НА ТРИ ЧАСТИ (пень+ствол+крона — гибы)
//  (D) обвязка мачт (ванты/штаги) рвётся вместе с мачтой
//      и восстанавливается при clearDamage
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) { b.click(); return 'clicked'; } return 'NOT FOUND'; })()`));
await sleep(2500);

// ============ A: формула экипажа на палубе ============
log('=== A: формула палубы (1 фигура = 1 человек) ===');
const deckA = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('victory'); // 850 экипажа → 73 фигуры на палубе
  const t = g.pgTarget.ship;
  const f = (n) => {
    n = Math.max(0, Math.round(n));
    if (n <= 0) return 0;
    if (n <= 10) return n;
    const s = Math.round(10 * Math.pow(n / 50, 0.7));
    return Math.min(n, Math.max(10, s));
  };
  const sync = (crew) => {
    t.crew = crew; t.crew3d.reset();
    for (let i = 0; i < 90; i++) t.crew3d.update(1/60, i/60, {
      crew: t.crew, maxCrew: t.preset.maxCrew, sinking: false, sunk: false,
      position: t.position, quaternion: t.quaternion });
    return t.crew3d.shown;
  };
  return JSON.stringify({
    n500: sync(500), n50: sync(50), n10: sync(10), n9: sync(9), n0: sync(0),
    n120: sync(120), n850: sync(850), built: t.crew3d.total,
  });
})()`));
log('A:', JSON.stringify(deckA));
check('A: 500 → 50 на палубе', deckA.n500 === 50, `shown=${deckA.n500}`);
check('A: 50 → 10 на палубе', deckA.n50 === 10, `shown=${deckA.n50}`);
check('A: 10 → показываем всех 10', deckA.n10 === 10, `shown=${deckA.n10}`);
check('A: 9 → показываем всех 9', deckA.n9 === 9, `shown=${deckA.n9}`);
check('A: 0 → палуба пуста', deckA.n0 === 0, `shown=${deckA.n0}`);
check('A: 120 → 10·(120/50)^0.7 = 18', deckA.n120 === 18, `shown=${deckA.n120}`);
check('A: 850 → 73', deckA.n850 === 73, `shown=${deckA.n850} built=${deckA.built}`);

// большая толпа: трупы падают естественно при списании команды
const crowdA = jparse(ev(`(() => {
  const g = window.__game;
  const t = g.pgTarget.ship;
  t.crew3d.reset(); t.crew = 200;
  for (let i = 0; i < 4; i++) t.crew3d.update(1/60, i/60, {
    crew: t.crew, maxCrew: t.preset.maxCrew, sinking: false, sunk: false,
    position: t.position, quaternion: t.quaternion });
  const before = { shown: t.crew3d.shown, total: t.crew3d.total };
  t.crew = 40; // пожар выкосил — избыток умирает по одному за кадр
  for (let i = 0; i < 120; i++) t.crew3d.update(1/60, i/60, {
    crew: t.crew, maxCrew: t.preset.maxCrew, sinking: false, sunk: false,
    position: t.position, quaternion: t.quaternion });
  const after = { shown: t.crew3d.shown, dead: t.crew3d.dead,
    corpses: t.crew3d.group.children.filter(c => c.visible && Math.abs(c.rotation.x) > 0.4).length };
  return JSON.stringify({ before, after });
})()`));
log('A2:', JSON.stringify(crowdA));
check('A: толпа по формуле (200 → 26 фигур)', crowdA.before.shown === 26,
  `shown=${crowdA.before.shown} total=${crowdA.before.total}`);
check('A: потери обращаются в трупы на палубе (dead > 0)', crowdA.after.dead > 0,
  `dead=${crowdA.after.dead}`);
check('A: трупы ЛЕЖАТ (rotation.x ~ π/2)', crowdA.after.corpses >= 3,
  `lying=${crowdA.after.corpses}`);

// ============ B: пираты-человечки на острове логова ============
log('=== B: остров логова густо заполнен пиратами ===');
const folkB = jparse(ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const lf = g.lairFolk;
  if (!lf) return { err: 'no lairFolk' };
  const isl = g.world.islands.find(i => i.name === 'Логово пиратов');
  const kids = lf.group.children;
  const onIsland = kids.filter(c => Math.hypot(c.position.x - isl.cx, c.position.z - isl.cz) < isl.r * 1.15).length;
  // на рельефе: ноги на земле = высота точки суши 0.6..9 (лaир maxH 17)
  const inBand = kids.filter(c => c.position.y > 0.3 && c.position.y < 12).length;
  return JSON.stringify({
    err: null, island: { x: isl.cx, z: isl.cz, r: isl.r },
    total: lf.total, shown: lf.shown, dead: lf.dead,
    onIsland, inHeightBand: inBand,
  });
})()`));
log('B:', JSON.stringify(folkB));
check('B: ватага создана (total ≥ 55)', folkB.err === null && folkB.total >= 55,
  `total=${folkB?.total}`);
check('B: все на острове (в радиусе берега)', folkB.err === null && folkB.onIsland === folkB.total,
  `onIsland=${folkB?.onIsland}/${folkB?.total}`);
check('B: стоят на рельефе (высота 0.3..12)', folkB.err === null && folkB.inHeightBand === folkB.total,
  `band=${folkB?.inHeightBand}`);

// движение + поражение картечью по берегу
const folkKill = jparse(ev(`(() => {
  const g = window.__game;
  const lf = g.lairFolk;
  // движение: меряем ВСЕ фигуры (лагерь — костровые дворовые В
  // НАЧАЛЕ списка, ходоки — в конце; срез первых 90 их не видел)
  const alive0 = lf.group.children.slice();
  const p0 = alive0.map(c => ({ x: c.position.x, z: c.position.z }));
  for (let i = 0; i < 72; i++) lf.update(1/60, i/60);
  const moved = Math.max(...alive0.map((c, k) =>
    Math.hypot(c.position.x - p0[k].x, c.position.z - p0[k].z)));
  // картечь по берегу: накрываем точкой живую фигуру
  const alive = lf.group.children.filter(c => c.visible);
  const t0 = alive[0];
  const killedGrape = lf.killNear(t0.position.x, t0.position.y, t0.position.z, 2.2, 'grape');
  const deadGrape = lf.dead, shownGrape = lf.shown;
  // ядро разрывает: выбираем заведомо живого ПОСЛЕ картечи
  const alive2 = lf.group.children.filter(c => c.visible);
  const tB = alive2[1];
  const gib0 = g.gibs.alive;
  const killedBall = lf.killNear(tB.position.x, tB.position.y, tB.position.z, 2.2, 'ball');
  g.gibs.update(1/60); // счётчик alive обновляется в кадре — тикаем вручную
  const gibDelta = g.gibs.alive - gib0;
  // трупы падают: анимация 0.6 с
  for (let i = 0; i < 36; i++) lf.update(1/60, i/60);
  const lying = lf.group.children.filter(c => c.visible && Math.abs(c.rotation.x) > 0.4).length;
  const reset1 = (lf.reset(), lf.shown);
  return JSON.stringify({
    moved, killedGrape, deadGrape, shownGrape,
    killedBall, gibDelta, lying, afterReset: reset1,
    total: lf.total,
  });
})()`));
log('B2:', JSON.stringify(folkKill));
check('B: ходоки двигаются по острову (>0.3 м)', folkKill.moved > 0.3, `moved=${folkKill.moved?.toFixed(2)} м`);
check('B: картечь по берегу валит пиратов (killed ≥ 1)', folkKill.killedGrape >= 1,
  `killed=${folkKill.killedGrape} dead=${folkKill.deadGrape} shown=${folkKill.shownGrape}`);
check('B: потери = трупы (dead растёт, shown падает)',
  folkKill.deadGrape === folkKill.killedGrape
  && folkKill.shownGrape === folkKill.total - folkKill.deadGrape,
  `total=${folkKill.total} dead=${folkKill.deadGrape} shown=${folkKill.shownGrape}`);
check('B: ядро РАЗРЫВАЕТ фигуру (гибы летят)', folkKill.killedBall >= 1 && folkKill.gibDelta >= 4,
  `killed=${folkKill.killedBall} gibs+${folkKill.gibDelta}`);
check('B: трупы лежат на берегу (lying = killedGrape)', folkKill.lying === folkKill.killedGrape,
  `lying=${folkKill.lying}`);
check('B: reset оживляет ватагу', folkKill.afterReset === folkKill.total, `shown=${folkKill.afterReset}/${folkKill.total}`);

// ============ C: деревья ломаются на три части ============
log('=== C: дерево разлетается на 3 части ===');
const treeC = jparse(ev(`(() => {
  const g = window.__game;
  const w = g.world;
  const firstLive = (kind) => {
    const slot = w.vegSlots.find(s => s.kind === kind);
    if (!slot) return null;
    const idx = slot.broken.findIndex(b => !b);
    if (idx < 0) return null;
    return { pos: slot.positions[idx], slot, idx };
  };
  const palm = firstLive('palm');
  if (!palm) return { err: 'no palm' };
  const gib0 = g.gibs.alive;
  const tb0 = w.treesBroken;
  const broke = w.breakTrees(palm.pos.x, palm.pos.y, palm.pos.z, 3, g.particles, g.gibs);
  g.gibs.update(1/60); // куски видны в счётчике после тика
  const palmPieces = g.gibs.alive - gib0; // РОВНО 3 куска на каждое сломанное
  // куст: три кома листвы
  const bush = firstLive('bush');
  let bushPieces = -1, bushBroke = 0;
  if (bush) {
    const g1 = g.gibs.alive;
    bushBroke = w.breakTrees(bush.pos.x, bush.pos.y, bush.pos.z, 3, g.particles, g.gibs);
    g.gibs.update(1/60);
    bushPieces = g.gibs.alive - g1;
  }
  // инстанс дерева скрыт
  const slotHidden = palm.slot.broken[palm.idx];
  return JSON.stringify({
    err: null, broke, palmPieces, tb0, tb1: w.treesBroken,
    bushBroke, bushPieces, slotHidden,
  });
})()`));
log('C:', JSON.stringify(treeC));
check('C: пальмы сломаны (≥1)', treeC.err === null && treeC.broke >= 1, `broke=${treeC?.broke}`);
check('C: РОВНО ТРИ куска на каждое дерево', treeC.err === null && treeC.palmPieces === treeC.broke * 3,
  `pieces=${treeC?.palmPieces} broke=${treeC?.broke}`);
check('C: деревья: телеметрия растёт', treeC.err === null && treeC.tb1 === treeC.tb0 + treeC.broke + (treeC?.bushBroke ?? 0),
  `treesBroken ${treeC?.tb0}→${treeC?.tb1}`);
check('C: куст тоже крошится (3 кома)', treeC.bushBroke >= 1 && treeC.bushPieces === treeC.bushBroke * 3,
  `bushPieces=${treeC?.bushPieces}`);
check('C: инстанс дерева скрыт', treeC.slotHidden === true);

// ============ D: обвязка мачт рвётся вместе с мачтой ============
log('=== D: обвязка (ванты/штаги) ломается с мачтой ===');
const rigD = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const p = g.player;
  const rig = p.visual.rigging;
  const total = rig.meta.length;
  // сколько вырожденных (оборванных) отрезков сейчас
  const degenerate = () => {
    const pos = rig.lines.geometry.attributes.position;
    let n = 0;
    for (let i = 0; i < total; i++) {
      const ax = pos.getX(i*2), ay = pos.getY(i*2), az = pos.getZ(i*2);
      const bx = pos.getX(i*2+1), by = pos.getY(i*2+1), bz = pos.getZ(i*2+1);
      if (Math.abs(ax-bx) < 1e-6 && Math.abs(ay-by) < 1e-6 && Math.abs(az-bz) < 1e-6) n++;
    }
    return n;
  };
  const before = { total, snapped: p.riggingSnapped(), deg: degenerate() };
  const gib0 = g.gibs.alive;
  p.breakMast(0); // передняя мачта
  g.gibs.update(1/60); // обрывки такелажа — в счётчике после тика
  const after0 = { snapped: p.riggingSnapped(), deg: degenerate(), gibs: g.gibs.alive - gib0 };
  // линии ДРУГОЙ мачты целы
  const m0 = rig.meta.filter(l => l.mast === 0).length;
  const m1 = rig.meta.filter(l => l.mast === 1).length;
  p.breakMast(1);
  const after1 = { snapped: p.riggingSnapped(), deg: degenerate() };
  // восстановление (сброс полигона)
  p.clearDamage();
  const restored = { snapped: p.riggingSnapped(), deg: degenerate() };
  return JSON.stringify({ before, after0, after1, restored, m0, m1 });
})()`));
log('D:', JSON.stringify(rigD));
check('D: у шлюпа 18 снастей обвязки', rigD.before.total === 18, `total=${rigD.before.total}`);
check('D: исходно все целы (0 оборвано)', rigD.before.snapped === 0 && rigD.before.deg === 0,
  `snapped=${rigD.before.snapped}`);
check('D: мачта 0 → её снасти порваны (10 шт)', rigD.after0.snapped === rigD.m0 && rigD.after0.deg === rigD.m0,
  `snapped=${rigD.after0.snapped} deg=${rigD.after0.deg} м0=${rigD.m0}`);
check('D: обрывки такелажа летят (гибы)', rigD.after0.gibs >= 2, `gibs+${rigD.after0.gibs}`);
check('D: обе мачты → ВСЯ обвязка порвана', rigD.after1.snapped === 18 && rigD.after1.deg === 18,
  `snapped=${rigD.after1.snapped}`);
check('D: clearDamage восстанавливает обвязку (0 порвано)',
  rigD.restored.snapped === 0 && rigD.restored.deg === 0,
  `snapped=${rigD.restored.snapped}`);

// телеметрия HUD (window.__sea)
const teleD = jparse(ev(`(() => {
  const s = window.__sea;
  return JSON.stringify({
    rig: s.rigSnapped, folk: s.lairFolk, trees: s.treesBroken,
    deckFor: s.deckFor, crewShown: s.crewShown, fps: +s.fps.toFixed(1),
  });
})()`));
log('D2:', JSON.stringify(teleD));
check('D: телеметрия: обвязка/пираты/деревья в HUD',
  teleD && teleD.rig === 0 && teleD.folk && teleD.folk.total >= 55 && teleD.trees >= 1,
  `rig=${teleD?.rig} folk=${teleD?.folk?.total} trees=${teleD?.trees}`);

// ============ E: финал — страница жива ============
await sleep(1200);
const errs = (() => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
})();
check('E: страница без ошибок', !errs, errs);
check('E: FPS живой (> 8, headless software-рендер)', teleD && teleD.fps > 8, `fps=${teleD?.fps}`);
log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
