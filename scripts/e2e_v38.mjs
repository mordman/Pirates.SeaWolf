// E2E Task 21 — по большому запросу пользователя:
//  (A) пушечные порты: закрыты — батареи молчат, стреляют только
//      палубные; P — крышки открываются, орудия выезжают, залп
//      всеми стволами; ядра летят ИЗ ДУЛ (позиция снаряда = дуло)
//  (B) синхронная гребля: одна фаза на все вёсла (кватернионы
//      совпадают на одном борту), гребок вперёд/назад даёт ход
//  (C) квартердек: подъём над палубой, штурвал НЕ в мачте,
//      нактоуз/стрелка/люки/балюстрада/переборка на месте,
//      окна галереи подняты к уровню палуб
//  (D) ванты с выбленками рвутся вместе со своей мачтой
//      (detailRigs скрыт), целые мачты держат свои
//  (E) острова крупнее и дальше (проливы ≥ 800 м), карта больше,
//      быстрое перемещение на «Плёс» живо
//  (F) гальюнные фигуры: покупка, применение, перенос при смене
//  (G) украшения бортов: золото на map + ТЁМНОЕ на roughnessMap
//      + СВЕТЛОЕ на metalnessMap (блестит как металл)
//  (H) ИИ открывает порты в бою
//  (I) скриншоты для VLM + страница без ошибок
import { execSync } from 'node:child_process';
const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// Task 36: тяжёлые сцены занимают демон — повторяем с паузой
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
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
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ================= A: пушечные порты =================
log('=== A: порты — закрыты молчат, открываются, ядра из дул ===');
const portsA = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('victory', true); // 14 орудий/борт, 3 ряда портов
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  const v = p.visual;
  const closed = v.gunPorts.filter(gp => gp.gun.userData.tier > 0 || true);
  const tier0 = v.gunsPort.filter(gn => (gn.userData.tier ?? 0) === 0).length;
  const tiers = v.gunsPort.filter(gn => (gn.userData.tier ?? 0) > 0).length;
  // исходное состояние: закрыты, крышки висят, орудия убраны
  const st0 = {
    portsT: p.portsT, portsOpen: p.portsOpen,
    lidsClosed: v.gunPorts.every(gp => Math.abs(gp.lid.rotation.z) < 0.01),
    gunsIn: v.gunPorts.every(gp => Math.abs(gp.gun.position.x - gp.gun.userData.baseX) < 0.01),
    tier0, tiers, ports: v.gunPorts.length,
  };
  // залп при закрытых портах: стреляют ТОЛЬКО палубные
  g.combat.aim.active = true; g.combat.aim.side = 1;
  g.combat.aim.azimuth = 0; g.combat.aim.elevation = 0.1;
  g.combat.reloads.fill(0);
  p.ammo.ball = 50;
  const before = g.combat.projectiles.filter(q => q.active).length;
  g.combat.fireBroadside();
  const firedClosed = g.combat.reloads.filter(r => r > 0).length;
  // выстрел одним: снаряд рождается ИЗ ДУЛА палубного орудия
  g.combat.reloads.fill(0);
  g.combat.projectiles.forEach(q => q.active = false);
  g.combat.fireOne();
  const pr = g.combat.projectiles.find(q => q.active);
  let muzzleErr = -1;
  if (pr) {
    // найти орудие, чьё дуло ближе всех к снаряду
    let best = 1e9;
    for (const gn of v.gunsStarboard) {
      const mw = gn.position.clone();
      mw.x += gn.userData.muzzleX ?? (gn.userData.side > 0 ? 1 : -1) * 1.2;
      mw.y += 0.08;
      mw.applyQuaternion(p.quaternion).add(p.position);
      best = Math.min(best, mw.distanceTo(pr.pos));
    }
    muzzleErr = +best.toFixed(2);
  }
  // P: открыть порты (клавиша)
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
  g.handleInput(1 / 60);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP' }));
  g.input.endFrame();
  const afterKey = { portsOpen: p.portsOpen };
  // анимация: 3 секунды
  let time = g.time;
  for (let i = 0; i < 200; i++) {
    time += 1 / 60;
    p.updateVisual(time, 1 / 60, g.particles);
  }
  const stOpen = {
    portsT: +p.portsT.toFixed(2),
    lidsOpen: v.gunPorts.every(gp => Math.abs(Math.abs(gp.lid.rotation.z) - 2.6) < 0.1),
    gunsOut: v.gunPorts.every(gp => Math.abs(gp.gun.position.x - (gp.gun.userData.baseX + gp.gun.userData.slideX)) < 0.05),
  };
  // залп при открытых: ВСЕ орудия
  g.combat.reloads.fill(0);
  g.combat.projectiles.forEach(q => q.active = false);
  g.combat.fireBroadside();
  const firedOpen = g.combat.reloads.filter(r => r > 0).length;
  // закрыть обратно: орудия заезжают
  p.portsOpen = false;
  for (let i = 0; i < 200; i++) { time += 1 / 60; p.updateVisual(time, 1 / 60, g.particles); }
  const stClose = {
    portsT: +p.portsT.toFixed(2),
    gunsIn: v.gunPorts.every(gp => Math.abs(gp.gun.position.x - gp.gun.userData.baseX) < 0.05),
  };
  g.combat.aim.active = false;
  return JSON.stringify({ st0, firedClosed, muzzleErr, afterKey, stOpen, firedOpen, stClose,
    gunsPerSide: v.gunsPort.length });
})()`));
log('A:', JSON.stringify(portsA));
if (!portsA || !portsA.st0) {
  check('A: данные получены', false, JSON.stringify(portsA).slice(0, 200));
} else {
  check('A: порты есть (9 закрытых батарей/борт), крышки закрыты, орудия убраны',
    portsA.st0.ports === 18 && portsA.st0.portsT === 0 && portsA.st0.lidsClosed && portsA.st0.gunsIn,
    `ports=${portsA.st0.ports} tier0=${portsA.st0.tier0} tiers=${portsA.st0.tiers}`);
  check('A: при закрытых портах залп — только палубные орудия',
    portsA.firedClosed === portsA.st0.tier0,
    `fired=${portsA.firedClosed} палубных=${portsA.st0.tier0}`);
  check('A: снаряд рождается ИЗ ДУЛА орудия (≤0.5 м от среза)',
    portsA.muzzleErr >= 0 && portsA.muzzleErr <= 0.5, `err=${portsA.muzzleErr} м`);
  check('A: P открывает порты', portsA.afterKey.portsOpen === true);
  check('A: крышки откинуты (2.6 рад) и орудия выехали',
    portsA.stOpen.portsT > 0.9 && portsA.stOpen.lidsOpen && portsA.stOpen.gunsOut,
    JSON.stringify(portsA.stOpen));
  check('A: при открытых портах залп — ВСЕ орудия борта',
    portsA.firedOpen === portsA.gunsPerSide, `fired=${portsA.firedOpen} из ${portsA.gunsPerSide}`);
  check('A: закрытие — орудия заехали обратно',
    portsA.stClose.portsT < 0.1 && portsA.stClose.gunsIn, JSON.stringify(portsA.stClose));
}

// ================= B: синхронная гребля =================
log('=== B: гребля — синхронно, вперёд/назад ===');
const rowB = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('galley', true);
  const p = g.player;
  const v = p.visual;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0);
  p.crew = p.preset.maxCrew;
  p.oarsOut = false; p.rowing = 0; p.oarsIdleT = 0; p.oarsDeployT = 0;
  // Alt+W: вывалили и гребём вперёд
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'AltLeft' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  g.handleInput(1 / 60);
  const cmd = { rowing: p.rowing, oarsOut: p.oarsOut };
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'AltLeft' }));
  g.input.endFrame();
  // разогнать анимацию 5 с
  let time = g.time;
  for (let i = 0; i < 300; i++) {
    time += 1 / 60;
    p.fixedStep(1 / 60, time);
    p.updateVisual(time, 1 / 60, g.particles);
  }
  const oars = v.oars;
  // синхронность: на одном борту все вёсла в ОДИНАКОВОМ положении
  const portOars = oars.filter(o => o.userData.side < 0);
  const starOars = oars.filter(o => o.userData.side > 0);
  const q = portOars[0].quaternion;
  const syncPort = portOars.every(o => o.quaternion.dot(q) > 0.999);
  const qs = starOars[0].quaternion;
  const syncStar = starOars.every(o => o.quaternion.dot(qs) > 0.999);
  // гребок живёт: фаза меняется, вёсла движутся
  const y0 = portOars[0].rotation.y;
  let moved = false;
  for (let i = 0; i < 40; i++) {
    time += 1 / 60;
    p.updateVisual(time, 1 / 60, g.particles);
    if (Math.abs(portOars[0].rotation.y - y0) > 0.1) moved = true;
  }
  const deployMid = +p.oarsDeployT.toFixed(2);
  const fwd = p.forward;
  const vFwd0 = p.velocity.dot(fwd);
  // 15 с гребли вперёд — заметный ход
  for (let i = 0; i < 900; i++) {
    time += 1 / 60;
    p.fixedStep(1 / 60, time);
    p.updateVisual(time, 1 / 60, g.particles);
  }
  const knotsFwd = p.speedKnots();
  // назад: Alt+S
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'AltLeft' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  g.handleInput(1 / 60);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'AltLeft' }));
  g.input.endFrame();
  const cmdBack = { rowing: p.rowing };
  p.velocity.set(0, 0, 0);
  for (let i = 0; i < 900; i++) {
    time += 1 / 60;
    p.fixedStep(1 / 60, time);
    p.updateVisual(time, 1 / 60, g.particles);
  }
  const vBack = p.velocity.dot(p.forward);
  const knotsBack = p.speedKnots();
  // убрать вёсла: убранное положение — вдоль борта (не «палки вниз»)
  p.rowing = 0; p.oarsOut = false;
  for (let i = 0; i < 200; i++) { time += 1 / 60; p.updateVisual(time, 1 / 60, g.particles); }
  const T = window.__THREE;
  const stowed = portOars.map(o => {
    const e = new T.Euler().setFromQuaternion(o.quaternion, 'YZX');
    return { yaw: +e.y.toFixed(2), roll: +e.z.toFixed(2) };
  });
  return JSON.stringify({
    oarsN: oars.length, cmd, syncPort, syncStar, moved, deployMid,
    phase: +p.strokePhase.toFixed(2), deploy: +p.oarsDeployT.toFixed(2),
    knotsFwd: +knotsFwd.toFixed(2), cmdBack, vBack: +vBack.toFixed(2), knotsBack: +knotsBack.toFixed(2),
    stowed: stowed[0],
    rowers: p.crew3d ? [...p.crew3d.group.children].length : 0,
  });
})()`));
log('B:', JSON.stringify(rowB));
if (!rowB) {
  check('B: данные получены', false);
} else {
  check('B: вёсла есть (12×2) и вываливаются по Alt+W',
    rowB.oarsN === 24 && rowB.cmd.rowing === 1 && rowB.cmd.oarsOut === true,
    `n=${rowB.oarsN} rowing=${rowB.cmd.rowing}`);
  check('B: гребля СИНХРОННАЯ (все вёсла борта в одной фазе)',
    rowB.syncPort && rowB.syncStar, `port=${rowB.syncPort} star=${rowB.syncStar}`);
  check('B: гребок анимирован (вёсла движутся, вывалены)', rowB.moved && rowB.deployMid > 0.95,
    `moved=${rowB.moved} deploy=${rowB.deployMid}`);
  check('B: гребля вперёд даёт ход (≥1 уз)', rowB.knotsFwd >= 1, `${rowB.knotsFwd} уз`);
  check('B: Alt+S — гребля назад (ход ≤ −0.3 м/с вдоль корпуса)',
    rowB.cmdBack.rowing === -1 && rowB.vBack <= -0.3,
    `rowing=${rowB.cmdBack.rowing} v=${rowB.vBack} м/с`);
  check('B: убранное весло лежит вдоль борта (yaw≈±1.5, не вниз)',
    Math.abs(Math.abs(rowB.stowed.yaw) - 1.52) < 0.25, JSON.stringify(rowB.stowed));
}

// ================= C: квартердек =================
log('=== C: квартердек — геометрия и предметы ===');
const qdC = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  const v = p.visual;
  const q = v.quarter;
  const L = p.preset.length;
  // штурвал против мачты
  const wheelZ = v.wheel.parent.position.z;
  const mastZs = v.masts.map(m => m.position.z);
  const nearest = Math.min(...mastZs.map(mz => Math.abs(mz - wheelZ)));
  // подъём квартердека над главной палубой
  const midZ = (q.frontZ + q.sternZ) / 2;
  const floorY = q.floorY(midZ);
  const deckY = floorY - q.height;
  // содержимое: нактоуз(стрелка), люки, балюстрада, переборка
  let binnacle = !!v.binnacleNeedle;
  let needleRot = v.binnacleNeedle ? +v.binnacleNeedle.rotation.y.toFixed(2) : null;
  // стрелка держит СЕВЕР: при повороте корпуса её локальный поворот
  // меняется РОВНО на противоположный повороту (мир-фикс)
  const h0 = p.heading;
  let needleOk = true;
  let time = g.time;
  // прокрутить один кадр: у ТОЛЬКО ЧТО построенного корабля стрелка
  // ещё не обновлялась (rotation 0) — сначала синхронизируем
  p.updateVisual(time, 1 / 60, g.particles);
  const rot0 = v.binnacleNeedle.rotation.y;
  const T = window.__THREE;
  const eu = new T.Euler().setFromQuaternion(p.quaternion, 'YXZ');
  p.quaternion.setFromEuler(new T.Euler(eu.x, eu.y + 0.6, eu.z, 'YXZ'));
  p.updateVisual(time + 0.1, 1 / 60, g.particles);
  let dRot = v.binnacleNeedle.rotation.y - rot0;
  dRot = ((dRot + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (Math.abs(Math.abs(dRot) - 0.6) > 0.12) needleOk = false;
  // дрожь картушки есть, но мала
  let resid = v.binnacleNeedle.rotation.y - (-p.heading + Math.PI);
  resid = ((resid + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (Math.abs(resid) > 0.1) needleOk = false;
  const childrenQ = v.group.children.filter(o => o.userData && o.userData.quarterDeck).length;
  // палубные орудия — ПЕРЕД квартердеком
  const gunsFore = v.gunsPort.filter(gn => (gn.userData.tier ?? 0) === 0).every(gn => gn.position.z > q.frontZ + 0.5);
  return JSON.stringify({
    hasQuarter: !!q, quarterH: q ? +q.height.toFixed(2) : 0,
    frontZ: q ? +q.frontZ.toFixed(2) : 0, sternZ: q ? +q.sternZ.toFixed(2) : 0,
    wheelZ: +wheelZ.toFixed(2), nearestMast: +nearest.toFixed(2),
    floorRise: +(floorY - deckY).toFixed(2),
    binnacle, needleOk, gunsFore,
    wheelOnQuarter: q ? +(v.wheel.parent.position.y - q.floorY(wheelZ)).toFixed(2) : null,
    quarterChildren: v.group.children.length,
  });
})()`));
log('C:', JSON.stringify(qdC));
if (!qdC || !qdC.hasQuarter) {
  check('C: квартердек построен', false, JSON.stringify(qdC).slice(0, 200));
} else {
  check('C: квартердек есть, подъём 1.9 м (не прижат к палубе)',
    qdC.quarterH >= 1.5 && qdC.floorRise >= 1.5,
    `h=${qdC.quarterH} подъём=${qdC.floorRise}`);
  check('C: штурвал НЕ в мачте (≥0.8 м) и стоит на квартердеке',
    qdC.nearestMast >= 0.8 && Math.abs(qdC.wheelOnQuarter) < 0.15,
    `до мачты=${qdC.nearestMast} м, y-ошибка=${qdC.wheelOnQuarter}`);
  check('C: нактоуз с магнитной стрелкой есть', qdC.binnacle === true);
  check('C: стрелка компаса держит север при повороте корпуса', qdC.needleOk === true);
  check('C: палубные орудия перед квартердеком', qdC.gunsFore === true,
    `frontZ=${qdC.frontZ}`);
}
// отдельная проверка предметов квартердека (люки/балюстрада/трапы)
const qdItems = jparse(ev(`(() => {
  const g = window.__game;
  const v = g.player.visual;
  const q = v.quarter;
  if (!q) return JSON.stringify(null);
  // состав: ищем по материалам (лампа/медь/стекло)
  let skylightGlass = 0, copper = 0, binnacleBox = 0, lamp = 0;
  v.group.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const m = o.material;
    if (m.emissive && m.emissiveIntensity >= 1.5 && m.color && m.color.getHex() === 0xffd88a) lamp++;
    if (m.metalness >= 0.7 && m.vertexColors) copper++;
    if (m.transparent === true) skylightGlass++;
  });
  return JSON.stringify({ lamp, copper: copper > 0, skylightGlass,
    quarterGeoms: v.group.children.length });
})()`));
log('C-предметы:', JSON.stringify(qdItems));
check('C: лампа нактоуза горит (emissive)', qdItems && qdItems.lamp >= 1, `ламп=${qdItems?.lamp}`);
check('C: медная оправа (люки/нактоуз) есть', qdItems && qdItems.copper === true);
check('C: стекло (нактоуз/люки) просвечивает', qdItems && qdItems.skylightGlass >= 2,
  `стёкол=${qdItems?.skylightGlass}`);

// ================= D: ванты рвутся с мачтой =================
log('=== D: обвязка и ванты падают вместе с мачтой ===');
const rigD = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player; // фрегат
  const v = p.visual;
  const mastsN = v.masts.length;
  const before = v.detailRigs.map(d => d.lines.visible);
  const rig0 = p.riggingSnapped();
  p.breakMast(2); // бизань (стоит на квартердеке)
  const after = v.detailRigs.map(d => d.lines.visible);
  const rig2 = p.riggingSnapped();
  const meta2 = v.rigging.meta.filter(l => l.mast === 2).length;
  const pinRope2 = meta2 > 8; // штаги+ванты+бакштаги+нагельные концы
  p.breakMast(0);
  const after2 = v.detailRigs.map(d => d.lines.visible);
  p.clearDamage();
  const restored = v.detailRigs.map(d => d.lines.visible);
  return JSON.stringify({
    mastsN, before, after, rig0, rig2, pinRope2, meta2, after2, restored,
    detailN: v.detailRigs.length,
  });
})()`));
log('D:', JSON.stringify(rigD));
if (!rigD) {
  check('D: данные получены', false);
} else {
  check('D: ванты с выбленками построены ПО-МАЧТНО (3 пары)',
    rigD.detailN === rigD.mastsN && rigD.before.every(x => x === true),
    `пар=${rigD.detailN}`);
  check('D: сломана бизань — её ванты оборваны, чужие стоят',
    rigD.after[2] === false && rigD.after[0] === true && rigD.after[1] === true,
    JSON.stringify(rigD.after));
  check('D: обвязка мачты оборвана (снасти > 8, включая нагельные концы)',
    rigD.rig2 > rigD.rig0 && rigD.rig2 >= 8 && rigD.pinRope2,
    `оборвано=${rigD.rig2} из мачты-2=${rigD.meta2}`);
  check('D: вторая мачта — и её ванты тоже',
    rigD.after2[0] === false && rigD.after2[2] === false && rigD.after2[1] === true,
    JSON.stringify(rigD.after2));
  check('D: clearDamage восстанавливает всё', rigD.restored.every(x => x === true),
    JSON.stringify(rigD.restored));
}

// ================= E: острова и карта =================
log('=== E: острова крупнее/дальше, карта больше ===');
const islE = jparse(ev(`(() => {
  const g = window.__game;
  const s = window.__sea;
  const isles = s.islandsBig;
  const base = isles[0];
  // минимальный пролив между берегами всех островов
  let minGap = 1e9;
  for (let i = 0; i < isles.length; i++) {
    for (let j = i + 1; j < isles.length; j++) {
      const d = Math.hypot(isles[i].x - isles[j].x, isles[i].z - isles[j].z);
      minGap = Math.min(minGap, d - isles[i].r - isles[j].r);
    }
  }
  const far = Math.max(...isles.map(i => Math.max(Math.abs(i.x), Math.abs(i.z))));
  return JSON.stringify({ n: isles.length, baseR: base.r, minGap: Math.round(minGap),
    far, ples: isles.find(i => i.name === 'Плёс'), lair: isles.find(i => i.name === 'Логово пиратов') });
})()`));
log('E:', JSON.stringify(islE));
if (!islE) {
  check('E: данные получены', false);
} else {
  check('E: главный остров вырос (r≥330)', islE.baseR >= 330, `r=${islE.baseR}`);
  check('E: проливы между берегами ≥ 750 м', islE.minGap >= 750, `мин=${islE.minGap}`);
  check('E: карта растянута (острова дальше 3.5 км)', islE.far > 3500, `макс=${islE.far}`);
  check('E: «Плёс» на новом месте (375,−2100)',
    islE.ples && Math.abs(islE.ples.x - 375) < 5 && Math.abs(islE.ples.z + 2100) < 5,
    JSON.stringify(islE.ples));
}
const travE = jparse(ev(`(() => {
  const g = window.__game;
  const err = g.fastTravelTo('Плёс');
  return JSON.stringify({ err, x: +g.player.position.x.toFixed(0), z: +g.player.position.z.toFixed(0) });
})()`));
log('E-телепорт:', JSON.stringify(travE));
check('E: быстрое перемещение на «Плёс» живо',
  travE && travE.err === null && Math.hypot(travE.x - 375, travE.z + 2100) < 900,
  JSON.stringify(travE));

// ================= F: гальюнные фигуры =================
log('=== F: покупка и перенос носовых фигур ===');
const figF = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.gold += 20000;
  const v0 = p.visual;
  const stockChildren = v0.figurehead.children.length;
  const r1 = g.buySkin('figure.mermaid');
  const mermaidChildren = p.visual.figurehead.children.length;
  const onFrig = g.skinsOn.figure;
  // переносится при смене корабля
  g.changeShip('sloop', true);
  const onSloop = g.player.visual.figurehead.children.length;
  const sloopOn = g.skinsOn.figure;
  // вернуться к штатной
  g.equipSkin('figure.stock');
  const stockBack = g.player.visual.figurehead.children.length;
  return JSON.stringify({ r1, stockChildren, mermaidChildren, onFrig, onSloop, sloopOn, stockBack,
    goldLeft: Math.floor(g.player.gold) });
})()`));
log('F:', JSON.stringify(figF));
if (!figF) {
  check('F: данные получены', false);
} else {
  check('F: «Золотая русалка» куплена и поставлена',
    figF.r1 === null && figF.onFrig === 'figure.mermaid',
    `r1=${figF.r1}`);
  check('F: фигура — скульптура (больше 5 примитивов, не конус)',
    figF.mermaidChildren > 5 && figF.mermaidChildren !== figF.stockChildren,
    `примитивов=${figF.mermaidChildren}`);
  check('F: фигура переносится на новый корабль',
    figF.sloopOn === 'figure.mermaid' && figF.onSloop > 5,
    `sloop=${figF.onSloop}`);
  check('F: штатный шток возвращается', figF.stockBack <= 2, `примитивов=${figF.stockBack}`);
}

// ================= G: украшения бортов (золото блестит) =================
log('=== G: украшения — золото на шероховатости ТЁМНОЕ (глянец) ===');
const decG = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.gold += 5000;
  const r1 = g.buySkin('deco.skull');
  const mat = p.visual.hullMat;
  const isTex = (t) => !!t && !!t.image && t.image.width > 512;
  // карта шероховатости: холст — сэмплируем строку по центру батареи
  let rough = null, metal = null;
  if (isTex(mat.roughnessMap)) {
    const cv = mat.roughnessMap.image;
    const ctx = cv.getContext('2d');
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let mn = 255, mx = 0, sum = 0, n = 0, dark = 0;
    for (let i = 0; i < data.length; i += 16) {
      const v = data[i];
      mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; n++;
      if (v < 120) dark++;
    }
    rough = { w: cv.width, mn, mx, avg: Math.round(sum / n), darkPct: +((100 * dark / n).toFixed(1)) };
  }
  if (isTex(mat.metalnessMap)) {
    const cv = mat.metalnessMap.image;
    const ctx = cv.getContext('2d');
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let mx = 0;
    for (let i = 0; i < data.length; i += 16) mx = Math.max(mx, data[i]);
    metal = { w: cv.width, mx };
  }
  const mapOk = isTex(mat.map);
  // смена украшения
  const r2 = g.buySkin('deco.gold');
  const goldOn = g.skinsOn.deco;
  return JSON.stringify({ r1, r2, mapOk, rough, metal, goldOn,
    sameMap: mat.map === mat.roughnessMap });
})()`));
log('G:', JSON.stringify(decG));
if (!decG) {
  check('G: данные получены', false);
} else {
  check('G: «Череп и кости» куплено и применено', decG.r1 === null && decG.goldOn === 'deco.gold',
    `r1=${decG.r1} gold=${decG.goldOn}`);
  check('G: у корпуса карта цвета (текстура бортов)', decG.mapOk === true);
  check('G: roughnessMap — холст 2048, дерево матовое (avg 140..205)',
    decG.rough && decG.rough.w === 2048 && decG.rough.avg >= 140 && decG.rough.avg <= 205,
    JSON.stringify(decG.rough));
  check('G: ЗОЛОТО на шероховатости ТЕМНЕЕ дерева (≤120) — блестит',
    decG.rough && decG.rough.mn <= 120 && decG.rough.darkPct > 0.05,
    JSON.stringify(decG.rough));
  check('G: ЗОЛОТО на металличности СВЕТЛОЕ (≥200) — металл',
    decG.metal && decG.metal.mx >= 200, JSON.stringify(decG.metal));
  check('G: map и roughnessMap — РАЗНЫЕ холсты', decG.sameMap === false);
}

// ================= H: ИИ открывает порты в бою =================
log('=== H: ИИ открывает порты в бою ===');
const aiH0 = jparse(ev(`(() => {
  const g = window.__game;
  // патрульный фрегат surprise (ряд портов) — не якорная мишень
  const T = window.__THREE;
  const target = g.aiShips.find(a => a.ship.preset.gunportRows && a.ship.visual.gunPorts.length
    && a.state !== 'anchored');
  if (!target) return JSON.stringify({ err: 'нет ИИ с портами' });
  // игрок рядом — иначе бой мгновенно завершится
  g.player.position.copy(target.ship.position).add(new T.Vector3(120, 0, 40));
  g.player.velocity.set(0, 0, 0);
  const before = target.ship.portsOpen;
  target.onPlayerAggression(g.aiShips);
  return JSON.stringify({ before, state: target.state, n: target.ship.visual.gunPorts.length });
})()`));
log('H-агрессия:', JSON.stringify(aiH0));
// RAF-цикл игры сам прокрутит анимацию крышек (порты открываются)
await sleep(4200);
const aiH = jparse(ev(`(() => {
  const g = window.__game;
  const target = g.aiShips.find(a => a.ship.preset.gunportRows && a.ship.visual.gunPorts.length
    && a.state !== 'anchored');
  if (!target) return JSON.stringify({ err: 'нет' });
  // RAF уже включил порты (portsOpen=true); докрутить анимацию крышек
  // (headless SwiftShader даёт ~2 fps — реальный темп выше)
  const p = target.ship;
  const animByRaf = +p.portsT.toFixed(2);
  let time = g.time;
  for (let i = 0; i < 240; i++) {
    time += 1 / 60;
    p.updateVisual(time, 1 / 60, g.particles);
  }
  return JSON.stringify({
    state: target.state,
    after: target.ship.portsOpen,
    animByRaf,
    anim: +p.portsT.toFixed(2),
    lids: p.visual.gunPorts.every(gp => Math.abs(Math.abs(gp.lid.rotation.z) - 2.6) < 0.15),
  });
})()`));
log('H:', JSON.stringify(aiH));
if (!aiH || aiH.err) {
  check('H: ИИ с портами найден', false, JSON.stringify(aiH));
} else {
  check('H: агрессия → ИИ в бою, порты ОТКРЫТЫ, крышки подняты',
    aiH.state === 'combat' && aiH.after === true && aiH.animByRaf > 0 && aiH.anim > 0.95 && aiH.lids,
    JSON.stringify(aiH));
}

// ================= I: FPS и скриншоты для VLM =================
log('=== I: FPS (ДО скриншотов — captureScreenshot душит RAF headless) ===');
// ВАЖНО: каждый screenshot в headless Chrome кумулятивно урежает
// RAF (замер: 45 → 33 → 23 → 1.4 fps после двух кадров) — проверку
// живости рендера делаем ДО снимков, в стандартной сцене
ev(`(() => {
  const g = window.__game;
  g.player.position.set(3200, 0, 2300);
  g.player.velocity.set(0, 0, 0);
  g.player.anchored = true;
  g.setCameraMode('iso');
  g.rig.distSet(200);
  g.rig.snap();
  return 'fps scene ready';
})()`);
let fpsMax = 0, infoMax = null;
for (let k = 0; k < 3; k++) {
  await sleep(2300);
  const f = jparse(ev(`(() => {
    const g = window.__game;
    return JSON.stringify({ fps: +g.fpsSmooth.toFixed(1), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles });
  })()`));
  if (f && f.fps) fpsMax = Math.max(fpsMax, f.fps);
  if (f) infoMax = f;
}
check('I: FPS живой в стандартной сцене (> 4, SwiftShader)', fpsMax > 4, `fpsMax=${fpsMax}`);
check('I: рендер-цикл рисует сцену (вызовы > 50, треугольники > 100k)',
  infoMax && infoMax.calls > 50 && infoMax.tris > 100000,
  infoMax ? `calls=${infoMax.calls} tris=${infoMax.tris}` : 'нет данных');

// ================= скриншоты для VLM =================
log('=== I: скриншоты ===');
// I1: квартердек фрегата с кормы (нактоуз/балюстрада/трапы)
ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.anchored = true; p.sailTarget = 3;
  let time = g.time;
  for (let i = 0; i < 240; i++) { time += 1 / 60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI - 0.5);
  g.rig.freeElevSet(0.32);
  g.rig.distSet(24);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2800);
shot('v38_quarterdeck');
await sleep(300);
// I2: порты victory ОТКРЫТЫ — борт
ev(`(() => {
  const g = window.__game;
  g.changeShip('victory', true);
  const p = g.player;
  p.anchored = true;
  p.portsOpen = true;
  let time = g.time;
  for (let i = 0; i < 200; i++) { time += 1/60; p.updateVisual(time, 1/60, g.particles); }
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2 + 0.1);
  g.rig.freeElevSet(0.12);
  g.rig.distSet(58);
  g.rig.snap();
  return 'ports=' + p.portsT.toFixed(2);
})()`);
await sleep(2800);
shot('v38_ports_open');
await sleep(300);
// I3: порты ЗАКРЫТЫ (тот же ракурс)
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.portsOpen = false;
  let time = g.time;
  for (let i = 0; i < 200; i++) { time += 1/60; p.updateVisual(time, 1/60, g.particles); }
  return 'ports=' + p.portsT.toFixed(2);
})()`);
await sleep(2600);
shot('v38_ports_closed');
await sleep(300);
// I4: галера гребёт (синхронный гребок) — держим Alt+W зажатыми,
// чтобы RAF-цикл продолжал греблю на скриншоте
const i4 = ev(`(() => {
  const g = window.__game;
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.crew = p.preset.maxCrew;
  p.oarsOut = true; p.rowing = 1; p.oarsIdleT = 0;
  let time = g.time;
  for (let i = 0; i < 600; i++) { time += 1/60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'AltLeft' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2 - 0.35);
  g.rig.freeElevSet(0.16);
  g.rig.distSet(30);
  g.rig.snap();
  return 'knots=' + p.speedKnots().toFixed(1);
})()`);
log('I4:', i4);
await sleep(3000);
shot('v38_galley_rowing');
ev(`(() => {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'AltLeft' }));
  return 'released';
})()`);
await sleep(300);
// I5: русалка на носу
ev(`(() => {
  const g = window.__game;
  g.changeShip('sloop', true);
  const p = g.player;
  p.gold += 5000;
  g.skinsOwned.add('figure.mermaid');
  g.equipSkin('figure.mermaid');
  p.anchored = true;
  g.setCameraMode('free');
  g.rig.freeAzimSet(0.75);
  g.rig.freeElevSet(0.13);
  g.rig.distSet(6.5);
  g.rig.snap();
  return 'fig=' + g.skinsOn.figure + ' children=' + p.visual.figurehead.children.length;
})()`);
await sleep(2800);
shot('v38_figurehead_mermaid');
await sleep(300);
// I6: золотая резьба бортов (deco.gold) — борт крупно
ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.gold += 5000;
  g.skinsOwned.add('deco.gold');
  g.equipSkin('deco.gold');
  p.anchored = true;
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2 + 0.05);
  g.rig.freeElevSet(0.1);
  g.rig.distSet(34);
  g.rig.snap();
  return 'deco=' + g.skinsOn.deco;
})()`);
await sleep(3000);
shot('v38_deco_gold');
await sleep(300);
// I7: череп и кости (deco.skull)
ev(`(() => {
  const g = window.__game;
  g.skinsOwned.add('deco.skull');
  g.equipSkin('deco.skull');
  g.rig.distSet(30);
  g.rig.snap();
  return 'deco=' + g.skinsOn.deco;
})()`);
await sleep(2600);
shot('v38_deco_skull');
ev(`(() => { const g = window.__game; g.equipSkin('deco.none'); return 'reset'; })()`);

// ================= финал: страница жива =================
await sleep(1200);
const errs = (() => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
})();
check('I: страница без ошибок', !errs, errs.slice(0, 200));

log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
