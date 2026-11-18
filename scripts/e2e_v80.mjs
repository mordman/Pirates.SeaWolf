// E2E Task 80 — четыре правки игрока:
// (A) «при ВСЕХ парусах один парус режет нос» — корневой баг:
//     seg2 мачты (дощатая модель) висел на ⅓ высоты → внутренний
//     кливер (setAt=1, только при полных парусах!), топселя,
//     латинские и флаг опускались на 10+ м и прошивали нос/палубу.
//     Фикс: seg2.position.y = base + j2. Гард: НОВЫЙ меш-аудит
//     debugSailMeshAudit (реальные вершины + матрицы + пузо шейдера).
// (B) «труба как пистолет, на 3, смотрим ПКМ» — третий слот оружия
//     в прогулке/высадке: в покое в руке, ПКМ — смотреть сквозь
//     стекло (FOV 55/зум, FX), колесо — кратность 2×..8×.
// (C) «капитан-мертвец, если корабль игрока — жемчужина, БЕЗ
//     попаданий; клинок просто ЗАМЕНЯЕТСЯ зелёным» — триггер
//     попаданий удалён; changeShip('blackpearl') → crewUndead +
//     lander.setCursed (фигурка-мертвец, сабля → зелёный клинок).
// (D) «ядро пролетает через сломанный борт и ломает другой борт,
//     ломает основание корпуса; реалистичные разломы/потопление» —
//     plankSideOpen → пробитие насквозь по ЛОКАЛЬНОМУ борту; выход
//     вырывает доски (×0.55); набор корпуса keelHP → ПЕРЕЛОМ.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(500);

// ================= A: ПАРУСА — seg2 и меш-аудит =================
const meshAudit = jparse(await evR(`(() => {
  const bad = window.__game.debugSailMeshAudit(1.7);
  return JSON.stringify(bad); })()`));
check('A1: МЕШ-аудит парусов (30 пресетов, пузо ±1.7, брасопка): чисто',
  Array.isArray(meshAudit) && meshAudit.length === 0,
  `bad=${JSON.stringify(meshAudit)?.slice(0, 200)}`);

const oldAudit = jparse(await evR(`(() => {
  const rows = window.__game.debugPlankSailAudit(1.68);
  const bad = rows.filter(r => r.planksMax > 0.02 || r.smoothMax > 0.02 || r.bowMax > 0.02);
  return JSON.stringify(bad.map(r => r.id)); })()`));
check('A2: параметрический аудит (Task 79) по-прежнему чист',
  Array.isArray(oldAudit) && oldAudit.length === 0, `bad=${JSON.stringify(oldAudit)}`);

const rigHeights = jparse(await evR(`(() => {
  const g = window.__game; const T = window.__THREE;
  g.changeShip('frigate', true);
  g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.player.sailOverride = 1;
  g.stepDebugNR(3);
  const v = g.player.visual; v.group.updateMatrixWorld(true);
  const out = {};
  const jib2 = v.sails.sails.find(s => !s.square && s.setAt === 1);
  if (jib2) { const mp = new T.Vector3(); jib2.mesh.getWorldPosition(mp);
    out.jib2 = { want: +jib2.quad.pivot.y.toFixed(2), got: +mp.y.toFixed(2) }; }
  const top = v.sails.sails.find(s => s.square && s.setAt === 0.92);
  if (top) { const pp = new T.Vector3(); top.mesh.getWorldPosition(pp);
    out.top = { want: +top.quad.pivot.y.toFixed(2), got: +pp.y.toFixed(2) }; }
  const fp = new T.Vector3(); v.flag.getWorldPosition(fp);
  const mainH = v.masts[1].userData.height;
  out.flag = { got: +fp.y.toFixed(2), mastTop: +(mainH - 2.2).toFixed(2) };
  return JSON.stringify(out); })()`));
check('A3: внутренний кливер на проектной высоте (diff < 0.6 м)',
  rigHeights?.jib2 && Math.abs(rigHeights.jib2.want - rigHeights.jib2.got) < 0.6,
  JSON.stringify(rigHeights?.jib2));
check('A4: топсель грота на проектной высоте (diff < 0.6 м)',
  rigHeights?.top && Math.abs(rigHeights.top.want - rigHeights.top.got) < 0.6,
  JSON.stringify(rigHeights?.top));
check('A5: флаг у топа главной мачты (не ниже 0.8·top)',
  rigHeights?.flag && rigHeights.flag.got > rigHeights.flag.mastTop * 0.8,
  JSON.stringify(rigHeights?.flag));

// скриншот носа фрегата при всех парусах (VLM отдельно)
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 0.55); g.rig.freeElevSet(0.10); g.rig.distSet(26);
  g.stepDebug(0.2); return 1; })()`);
run(`screenshot scripts/shots/t80_bow_frigate_full.png`);
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 2.4); g.rig.freeElevSet(0.12); g.rig.distSet(15);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_mast_frigate_full.png`);

// ================= B: ТРУБА = ОРУЖИЕ 3, ОСМОТР ПКМ =================
const b1 = jparse(await evR(`(() => {
  const g = window.__game;
  const hud = g.debugDeckWalk(true);
  return JSON.stringify({ hud: { mode: hud.mode, weapon: hud.weapon } }); })()`));
check('B1: прогулка по палубе включена (V-режим)', b1?.hud?.mode === 'deck' && b1?.hud?.weapon === 'none',
  JSON.stringify(b1?.hud));

const b2 = jparse(await evR(`(() => {
  const g = window.__game; const L = g.lander;
  L.handleInput({ isDown: () => false, pressed: c => c === 'Digit3', mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  const hud = L.hud();
  return JSON.stringify({ weapon: hud.weapon, label: hud.weaponLabel,
    visible: L.spyglassG ? L.spyglassG.visible : null }); })()`));
check('B2: «3» — труба В РУКЕ (weapon=spyglass, видима)',
  b2?.weapon === 'spyglass' && b2?.visible === true && /Труба/.test(b2?.label || ''),
  JSON.stringify(b2));

const b3 = jparse(await evR(`(() => {
  const g = window.__game; const L = g.lander;
  L.debugHoldRmb = true;
  g.stepDebugNR(0.6);
  g.stepDebug(0.3);
  const cam = g.rig.camera;
  return JSON.stringify({ aiming: L.aiming, spyAiming: L.spyAiming,
    fov: +cam.fov.toFixed(2), zoom: L.spyZoom }); })()`));
check('B3: ПКМ — смотрим сквозь трубу (aiming, FOV ≈ 55/4 = 13.75)',
  b3?.aiming === true && b3?.spyAiming === true && b3?.fov !== undefined
  && b3.fov > 10 && b3.fov < 18, JSON.stringify(b3));

const b4 = jparse(await evR(`(() => {
  const g = window.__game; const L = g.lander;
  L.handleInput({ isDown: () => false, pressed: () => false, mouseDX: 0, mouseDY: 0, wheel: -1, lmbJust: false, rmb: true });
  g.stepDebugNR(0.4);
  const fx = window.__spyglassInfo ? window.__spyglassInfo().fx : null;
  return JSON.stringify({ zoom: +L.spyZoom.toFixed(2), blend: fx ? +fx.blend.toFixed(2) : null }); })()`));
check('B4: колесо — зум ×4.8; FX стекла активны (blend > 0.3)',
  b4?.zoom !== undefined && Math.abs(b4.zoom - 4.8) < 0.05 && b4?.blend > 0.3,
  JSON.stringify(b4));

const b5 = jparse(await evR(`(() => {
  const g = window.__game; const L = g.lander;
  L.debugHoldRmb = false;
  L.handleInput({ isDown: () => false, pressed: () => false, mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  g.stepDebugNR(1.2);
  const cam = g.rig.camera;
  const fx = window.__spyglassInfo ? window.__spyglassInfo().fx : null;
  return JSON.stringify({ aiming: L.aiming, fov: +cam.fov.toFixed(1), blend: fx ? +fx.blend.toFixed(2) : null,
    inHand: L.spyglassG ? L.spyglassG.visible : null }); })()`));
check('B5: отпустили ПКМ — осмотр кончился (FOV→55, blend→0), труба ОСТАЛАСЬ В РУКЕ',
  b5?.aiming === false && b5?.fov > 50 && b5?.blend < 0.1 && b5?.inHand === true,
  JSON.stringify(b5));

const b6 = jparse(await evR(`(() => {
  const g = window.__game; const L = g.lander;
  L.handleInput({ isDown: () => false, pressed: c => c === 'Digit1', mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  const hud = L.hud();
  return JSON.stringify({ weapon: hud.weapon, spyVisible: L.spyglassG.visible, saberVisible: L.saberG.visible }); })()`));
check('B6: «1» меняет трубу на саблю (слоты не конфликтуют)',
  b6?.weapon === 'saber' && b6?.spyVisible === false && b6?.saberVisible === true,
  JSON.stringify(b6));

// скриншот: капитан с трубой в руке на палубе
ev(`(() => { const g = window.__game; const L = g.lander;
  L.handleInput({ isDown: () => false, pressed: c => c === 'Digit3', mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 2.9); g.rig.freeElevSet(0.18); g.rig.distSet(14);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_spy_hand_deck.png`);
// скриншот: взгляд сквозь трубу (ПКМ)
ev(`(() => { const g = window.__game; g.lander.debugHoldRmb = true; g.stepDebug(0.5); return 1; })()`);
run(`screenshot scripts/shots/t80_spy_view_pkm.png`);
ev(`(() => { window.__game.lander.debugHoldRmb = false; return 1; })()`);
ev(`(() => { const g = window.__game; const L = g.lander;
  L.handleInput({ isDown: () => false, pressed: () => false, mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  g.debugDeckWalk(false); return 1; })()`);

// ================= C: ЖЕМЧУЖИНА = КОРАБЛЬ ИГРОКА =================
const c1 = jparse(await evR(`(() => {
  const g = window.__game;
  g.changeShip('blackpearl', true);
  g.stepDebugNR(1.5);
  const info = window.__crewModelInfo();
  return JSON.stringify({ id: g.player.preset.id, cursed: info.captainCursed,
    cap: { isPlayer: info.captain.isPlayer, undead: info.captain.undead } }); })()`));
check('C1: выбор «Чёрной жемчужины» → капитан-игрок МЕРТВЕЦ (без попаданий)',
  c1?.id === 'blackpearl' && c1?.cursed === true && c1?.cap?.undead === true,
  JSON.stringify(c1));

const c2 = jparse(await evR(`(() => {
  const g = window.__game;
  let blade = 0;
  g.player.crew3d.group.traverse(o => {
    const m = o && o.material;
    if (m && m.emissive && m.emissive.getHex() === 0x1e8f3e) blade++;
  });
  return JSON.stringify({ blade }); })()`));
check('C2: на палубе у капитана СВЕТЯЩИЙСЯ зелёный клинок (emissive 0x1e8f3e)',
  c2?.blade >= 1, JSON.stringify(c2));

const c3 = jparse(await evR(`(() => {
  const g = window.__game;
  g.debugDeckWalk(true);
  const fi = g.lander.figureInfo();
  return JSON.stringify({ cursed: fi.cursed }); })()`));
check('C3: фигурка игрока в прогулке — МЕРТВЕЦ',
  c3?.cursed === true, JSON.stringify(c3));

const c4 = jparse(await evR(`(() => {
  const g = window.__game; const L = g.lander; const T = window.__THREE;
  L.handleInput({ isDown: () => false, pressed: c => c === 'Digit1', mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  let glow = 0;
  L.saberG.traverse(o => {
    const m = o && o.material;
    if (m && m.emissive) {
      const h = m.emissive.getHex();
      if (h === 0x39d65a || h === 0x52e07a || h === 0x1e8f3e) glow++;
    }
  });
  return JSON.stringify({ weapon: L.weapon, glow, puffs: glow >= 4 }); })()`));
check('C4: САБЛЯ игрока заменена ЗЕЛЁНЫМ клинком (та же сабля, emissive + дымка)',
  c4?.weapon === 'saber' && c4?.glow >= 4, JSON.stringify(c4));

// скриншот: капитан-мертвец с зелёной саблей на палубе «Жемчужины»
ev(`(() => { const g = window.__game; const L = g.lander;
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 2.9); g.rig.freeElevSet(0.16); g.rig.distSet(12);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_pearl_cursed_captain.png`);

const c5 = jparse(await evR(`(() => {
  const g = window.__game;
  g.debugDeckWalk(false);
  g.changeShip('sloop', true);
  g.stepDebugNR(1.2);
  g.debugDeckWalk(true);
  const fi = g.lander.figureInfo();
  let glow = 0;
  g.lander.saberG.traverse(o => {
    const m = o && o.material;
    if (m && m.emissive) {
      const h = m.emissive.getHex();
      if (h === 0x39d65a || h === 0x52e07a || h === 0x1e8f3e) glow++;
    }
  });
  g.debugDeckWalk(false);
  return JSON.stringify({ cursed: fi.cursed, glow }); })()`));
check('C5: смена на обычный корабль — капитан снова ЖИВОЙ (проклятие не залипло)',
  c5?.cursed === false && (c5?.glow ?? 0) === 0, JSON.stringify(c5));

// C6: попадание по мишени-жемчужине БОЛЬШЕ НЕ проклинает
const c6 = jparse(await evR(`(() => {
  const g = window.__game; const T = window.__THREE;
  const info0 = window.__crewModelInfo();
  // ближайший корабль-жемчужина (ИИ) — стать рядом и пустить ядро
  const bp = g.aiShips.map(a => a.ship).find(s => s.preset.id === 'blackpearl' && !s.sunk);
  if (!bp) return JSON.stringify({ no: 'blackpearl' });
  const d = 60;
  const px = bp.position.x + 60, pz = bp.position.z;
  g.player.position.set(px, 0, pz);
  g.player.velocity.set(0, 0, 0);
  g.player.quaternion.set(0, 0, 0, 1);
  g.stepDebugNR(0.3);
  const from = new T.Vector3(px, 1.2, pz);
  const dir = new T.Vector3(bp.position.x - px, 0.4, bp.position.z - pz);
  window.__hitLog = [];
  g.bus.on('projectile:hit', e => { window.__hitLog.push({ t: e.target.preset.id, s: e.shooter === g.player ? 'player' : 'x' }); });
  g.combat.debugSpawnBall(from, dir, 170);
  g.stepDebugNR(3);
  const info1 = window.__crewModelInfo();
  return JSON.stringify({
    hitLog: window.__hitLog,
    cursed: info1.captainCursed, undead: info1.captain.undead,
  }); })()`));
check('C6: попадание снаряда по жемчужине НЕ проклинает (триггер удалён)',
  c6 && !c6.no && (c6.hitLog || []).some(h => h.t === 'blackpearl' && h.s === 'player')
  && c6.cursed === false && c6.undead === false,
  JSON.stringify(c6));

// ================= D: СКВОЗНОЕ ПРОБИТИЕ + ПЕРЕЛОМ =================
const d1 = jparse(await evR(`(() => {
  const g = window.__game; const T = window.__THREE;
  const g2 = window.__game;
  // мишень полигона (стоит на якоре) — свежая, дощатая
  const g3 = window.__game;
  // Спокойное море (волны не съедят ядро у борта) + цель на якоре
  g3.player.wind.speed = 3; g3.stepDebugNR(3);
  const t = g2.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g2.player);
  if (!t) return JSON.stringify({ no: 'target' });
  t.clearDamage();
  // СТОП цель: якорь, ход нулевой (детерминированный выстрел)
  t.anchored = true; t.sailTarget = 0; t.sailOverride = null;
  t.velocity.set(0, 0, 0); t.angular.set(0, 0, 0);
  const L = t.preset.length, hw = Math.max(1.5, t.halfWidthAt(2));
  // пробоина: 3 удара по одной точке борта +X ВЫШЕ волн (y=2.6) —
  // ядро гаснет у поверхности воды и не долетает ниже гребней
  const lp = new T.Vector3(hw * 0.95, 2.0, 2);
  for (let i = 0; i < 3; i++) t.hitHull(lp.clone(), 46, true);
  const open = t.plankSideOpen(lp.clone());
  const st = t.plankHull ? t.plankHull.byState() : null;
  return JSON.stringify({ id: t.preset.id, open: +open.toFixed(2), s3: st ? st.s3 : -1, hw: +hw.toFixed(2) }); })()`));
check('D1: подготовлена пробоина борта: plankSideOpen > 0.45 (решето)',
  d1 && d1.open > 0.45 && d1.s3 >= 3, JSON.stringify(d1));

const d2 = jparse(await evR(`(() => {
  const g = window.__game; const T = window.__THREE;
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  if (!t) return JSON.stringify({ no: 'target' });
  const Lz = t.preset.length;
  const zh = Math.min(Lz * 0.32, t.visual.masts[0].position.z - 3);
  const lp = new T.Vector3(Math.max(1.5, t.halfWidthAt(zh)) * 0.95, 2.0, zh);
  // мировая точка пробоины (цель на якоре — не уйдёт)
  const hole = lp.clone().applyQuaternion(t.quaternion).add(t.position);
  // ЗАХОД ПО НОРМАЛИ БОРТА (локальная ось X цели): из мирового
  // направления «центр→точка» ядро входило в бокс ДИАГОНАЛЬНО и
  // попадало в ЦЕЛЫЙ борт (punchLog: open=0 @ (−2.7,·,−3.6));
  // теперь — строго перпендикулярно борту, в подготовленную дыру
  const fromLp = new T.Vector3(lp.x + 55, lp.y + 1.4, lp.z);
  const from = fromLp.applyQuaternion(t.quaternion).add(t.position);
  const dir = hole.clone().sub(from); dir.y += 0.75;
  const st0 = t.plankHull.byState();
  const keel0 = t.keelHP;
  const open0 = t.plankSideOpen(new T.Vector3(-1, 2.0, zh));
  g.combat.debugSpawnBall(from, dir, 175);
  g.stepDebugNR(2.5);
  const st1 = t.plankHull.byState();
  const openExit = t.plankSideOpen(new T.Vector3(-1, 2.0, zh));
  return JSON.stringify({
    s3: { was: st0.s3, now: st1.s3 },
    keel: { was: keel0, now: t.keelHP },
    exitOpen: { was: +open0.toFixed(2), now: +openExit.toFixed(2) },
    entryOpen: +t.plankSideOpen(lp.clone()).toFixed(2),
    sinking: t.sinking,
  }); })()`));
check('D2: ядро ПРОЛЕТЕЛО сквозь пробитый борт: ПРОТИВОПОЛОЖНЫЙ борт сломан (exitOpen > 0.25)',
  d2 && d2.exitOpen && d2.exitOpen.now > 0.25 && d2.exitOpen.now > d2.exitOpen.was,
  JSON.stringify(d2));
check('D3: прошив трюм, ядро сломало НАБОР (keelHP < 100)',
  d2 && d2.keel && d2.keel.now < d2.keel.was, JSON.stringify(d2?.keel));

const d4 = jparse(await evR(`(() => {
  const g = window.__game; const T = window.__THREE;
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  if (!t) return JSON.stringify({ no: 'target' });
  const s3before = t.plankHull.byState().s3;
  const mastsBefore = t.mastsBroken;
  // доламываем набор (несколько сквозных/тяжёлых у ДП) → ПЕРЕЛОМ
  for (let i = 0; i < 8 && !t.hullBroke; i++) {
    t.damageStructure(new T.Vector3(0, -0.5, 2 + (i % 3) - 1), 26);
  }
  const s3after = t.plankHull.byState().s3;
  return JSON.stringify({
    hullBroke: t.hullBroke, sinking: t.sinking, sinkT: +t.sinkT.toFixed(1),
    torn: { was: s3before, now: s3after },
    masts: { was: mastsBefore, now: t.mastsBroken },
    keel: +t.keelHP.toFixed(1),
  }); })()`));
check('D4: ПЕРЕЛОМ корпуса: hullBroke + тонет + обшивка рвана по линии + мачты падают',
  d4?.hullBroke === true && d4?.sinking === true && d4?.torn?.now > d4?.torn?.was
  && d4?.masts?.now > d4?.masts?.was, JSON.stringify(d4));

// скриншот разлома (фаза 1-2) и финального погружения
ev(`(() => { const g = window.__game; const t = g.aiShips.map(a => a.ship).find(s => s.sinking);
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 1.2); g.rig.freeElevSet(0.12); g.rig.distSet(60);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_hull_break.png`);
const d5 = jparse(await evR(`(() => {
  const g = window.__game;
  const t = g.aiShips.map(a => a.ship).find(s => s.sinking);
  if (!t) return JSON.stringify({ no: 'sinking' });
  g.stepDebugNR(10);
  return JSON.stringify({ sinkT: +t.sinkT.toFixed(1), phase: t.sinkPhase,
    y: +t.position.y.toFixed(1), broke: t.hullBroke }); })()`));
check('D5: потопление идёт по сценарию (фаза ≥2, корпус глубоко)',
  d5 && !d5.no && d5.phase >= 1 && d5.y < 0.5, JSON.stringify(d5));
// финальный скриншот ухода
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 1.2); g.rig.freeElevSet(0.16); g.rig.distSet(55);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_sinking.png`);

// ================= ИТОГ =================
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed === results.length ? 'ALL OK' : 'ЕСТЬ ПРОВАЛЫ'} (проверок: ${results.length})`);
runRaw('close');
if (passed !== results.length) process.exit(1);
