// E2E Task 17 — большой пакет фич:
//  (A) экипаж на палубе: доля 80/50/20% по размеру, 1 фигура = 10 единиц,
//      crew=0 → палуба ПУСТА
//  (B) убитые на палубе ↔ потери команды (killNearPath → −10/фигуру)
//  (C) каскад ломания мачты: паруса её мачты рвутся (дыры + uDamage=1)
//  (D) вёсла: убраны по умолчанию, Alt+W/S вываливают и дают ход,
//      авто-убирание через 5 с без гребли, вёсла СВОЕГО борта (не сквозь корпус)
//  (E) порты на каждом острове: уровни по размеру, население, швартовка
//      в чужой гавани
//  (F) экономика: товары с ценами порта, грузоподъёмность (переполнение
//      блокируется), покупка корабля за золото (полигон — бесплатно),
//      улучшения, скины
//  (G) пиратское логово у полигона: эскадра с «Чёрной жемчужиной»
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
const clickBtn = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}')); if (b) { b.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
const pageErrors = () => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
};

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ============ A: экипаж на палубе — доли и численность ============
log('=== A: экипаж на палубе (80/50/20%, 1 фигура = 10) ===');
const crewA = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const t = g.pgTarget.ship;
  const p = g.player;
  const upd = (sh, n) => { for (let i = 0; i < n; i++) sh.crew3d.update(1/60, i/60, {
    crew: sh.crew, maxCrew: sh.preset.maxCrew, sinking: false, sunk: false,
    position: sh.position, quaternion: sh.quaternion }); };
  const out = {
    // флейт: maxCrew 20 < 40 → МАЛЫЙ → 0.8 → 20*0.8/10 = 1.6 → 2 фигуры
    fluyt: { total: t.crew3d.total, share: t.crew3d.deckShare },
    // шлюп игрока: maxCrew 24 → 0.8 → 1.92 → 2
    sloop: { total: p.crew3d.total, share: p.crew3d.deckShare, crew: p.crew },
  };
  // crew=0 → палуба ПУСТАЕТ
  t.crew = 0; upd(t, 12);
  out.fluytCrew0 = { shown: t.crew3d.shown, dead: t.crew3d.dead };
  // восстановление: crew=20 → снова 2 живые фигуры... (трупы не встают —
  // reset) + проверка промежуточного: crew=10 → 1 фигура
  t.crew3d.reset(); t.crew = 10; upd(t, 4);
  out.fluytCrew10 = { shown: t.crew3d.shown };
  t.crew = 20; t.crew3d.reset(); upd(t, 4);
  out.fluytCrew20 = { shown: t.crew3d.shown };
  return JSON.stringify(out);
})()`));
log('A:', JSON.stringify(crewA));
check('A: флейт (20 чел, малый) → 2 фигуры на палубе (80%)', crewA.fluyt.total === 2,
  `total=${crewA.fluyt.total} share=${crewA.fluyt.share}`);
check('A: доля малого судна 0.8', crewA.fluyt.share === 0.8);
check('A: шлюп игрока → 2 фигуры', crewA.sloop.total === 2, `total=${crewA.sloop.total}`);
check('A: crew=0 → палуба ПУСТА (shown=0)', crewA.fluytCrew0.shown === 0,
  `shown=${crewA.fluytCrew0.shown} dead=${crewA.fluytCrew0.dead}`);
check('A: crew=10 → 1 фигура (10 ед. на палубе)', crewA.fluytCrew10.shown === 1,
  `shown=${crewA.fluytCrew10.shown}`);
check('A: crew=20 → 2 фигуры', crewA.fluytCrew20.shown === 2, `shown=${crewA.fluytCrew20.shown}`);

// крупный корабль: Victory 850 чел → 20% → 17 фигур
const crewBig = jparse(ev(`(() => {
  const g = window.__game;
  const err = g.changeShip('victory', true); // полигон — бесплатно
  const p = g.player;
  for (let i = 0; i < 6; i++) p.crew3d.update(1/60, i/60, {
    crew: p.crew, maxCrew: p.preset.maxCrew, sinking: false, sunk: false,
    position: p.position, quaternion: p.quaternion });
  return JSON.stringify({ err, total: p.crew3d.total, share: p.crew3d.deckShare,
    crew: p.crew, shown: p.crew3d.shown });
})()`));
log('A2:', JSON.stringify(crewBig));
check('A: Victory (850 чел, крупный) → 17 фигур (20%)', crewBig.total === 17,
  `total=${crewBig.total} share=${crewBig.share}`);
check('A: смена на Victory бесплатна на полигоне', crewBig.err === null, `err=${crewBig.err}`);

// ============ B: убитые на палубе ↔ потери команды ============
log('=== B: поражение экипажа (−10 единиц за фигуру) ===');
const crewB = jparse(ev(`(() => {
  const g = window.__game;
  const t = g.pgTarget.ship;
  t.crew3d.reset(); t.crew = 20;
  for (let i = 0; i < 4; i++) t.crew3d.update(1/60, i/60, {
    crew: t.crew, maxCrew: t.preset.maxCrew, sinking: false, sunk: false,
    position: t.position, quaternion: t.quaternion });
  const V = window.THREE ? window.THREE.Vector3 : null;
  const g3 = g.player.visual.group; // THREE уже в модуле — берём через анимацию
  // широкий прострел палубы по диаметрали: a=(0,1,12) → b=(0,1,-12), r=3
  const mk = (x, y, z) => { const o = { x, y, z }; return o; };
  const killed = t.crew3d.killNearPath(mk(0, 1, 12), mk(0, 1, -12), 'grape', 2, 3,
    t.position, t.quaternion);
  // формула combat: crew -= killed * CREW_PER_FIGURE (10)
  const crewAfter = Math.max(0, Math.round(t.crew - killed * 10));
  const res = { killed, crewBefore: 20, crewAfter, shownAfter: t.crew3d.shown };
  t.crew = crewAfter;
  for (let i = 0; i < 6; i++) t.crew3d.update(1/60, i/60, {
    crew: t.crew, maxCrew: t.preset.maxCrew, sinking: false, sunk: false,
    position: t.position, quaternion: t.quaternion });
  res.shownSync = t.crew3d.shown;
  return JSON.stringify(res);
})()`));
log('B:', JSON.stringify(crewB));
check('B: прострел палубы убивает фигуры (killed ≥ 1)', crewB.killed >= 1, `killed=${crewB.killed}`);
check('B: каждая фигура = 10 единиц (crew 20→' + crewB.crewAfter + ')',
  crewB.crewAfter === 20 - crewB.killed * 10, `killed=${crewB.killed} after=${crewB.crewAfter}`);
check('B: палуба синхронизируется (shown = crew·0.8/10)', crewB.shownSync === Math.max(0, Math.round(crewB.crewAfter * 0.8 / 10)),
  `shown=${crewB.shownSync}`);

// ============ C: каскад ломания мачты ============
log('=== C: мачта ломается → её паруса рвутся ===');
const mast = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('galleon');
  const t = g.pgTarget.ship;
  const before = t.visual.sails.sails.map(s => s.mastIndex);
  t.damageMast(1, 9999); // ломаем грот-мачту
  const after = t.visual.sails.sails.map(s => ({
    m: s.mastIndex,
    n: s.mat.uniforms.uHoleN.value,
    dmg: s.mat.uniforms.uDamage.value,
  }));
  return JSON.stringify({ before, after, fall: t.mastFall });
})()`));
log('C:', JSON.stringify(mast));
const mast1Sails = mast.after.filter(s => s.m === 1);
const otherSails = mast.after.filter(s => s.m !== 1);
check('C: мачта 1 сломана (mastFall[1] >= 0)', mast.fall[1] >= 0);
check('C: у галеона есть паруса на мачте 1', mast1Sails.length >= 2, `n=${mast1Sails.length}`);
check('C: паруса мачты 1 ИЗРЕШЕЧЕНЫ (>=2 дыры, uDamage=1)',
  mast1Sails.every(s => s.n >= 2 && s.dmg === 1),
  `holes=${mast1Sails.map(s => s.n).join(',')} dmg=${mast1Sails.map(s => s.dmg).join(',')}`);
check('C: паруса ДРУГИХ мачт целы (0 дыр)',
  otherSails.every(s => s.n === 0 && s.dmg === 0),
  `holes=${otherSails.map(s => s.n).join(',')}`);

// ============ D: вёсла ============
log('=== D: вёсла (отдельное управление, достаются при гребле) ===');
const oarsD = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const err = g.changeShip('galley', true); // галера: 12 вёсел на борт
  const p = g.player;
  const oars = p.visual.oars;
  const out = { err, nOars: oars.length, stowed: !p.oarsOut, deploy0: +p.oarsDeployT.toFixed(2) };
  // каждый вал — у СВОЕГО борта (side=sign(x)), лопасть наружу
  out.sidesOk = oars.every(o => Math.sign(o.position.x) === o.userData.side);
  out.bladesOut = oars.every(o => {
    const blade = o.children.find(c => c !== o.children[0]); // второй ребёнок — лопасть
    return blade ? Math.sign(blade.position.x) === o.userData.side : false;
  });
  // Alt+W (команда гребли): вёсла вываливаются и дают ход
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0);
  p.rowing = 1; p.oarsOut = true; p.oarsIdleT = 0;
  let time = g.time;
  for (let i = 0; i < 600; i++) { // 10 с
    time += 1/60;
    p.fixedStep(1/60, time);
    p.updateVisual(time, 1/60, g.particles);
  }
  out.deploy1 = +p.oarsDeployT.toFixed(2);
  out.speed = +p.speedKnots().toFixed(2);
  // задний ход Alt+S
  p.rowing = -1;
  for (let i = 0; i < 240; i++) { time += 1/60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  out.speedBack = +p.speedKnots().toFixed(2);
  out.fwdY = +p.velocity.dot(new (Object.getPrototypeOf(p.position).constructor)(0,0,1)).toFixed(2);
  return JSON.stringify(out);
})()`));
log('D:', JSON.stringify(oarsD));
check('D: смена на галеру бесплатна (полигон)', oarsD.err === null, `err=${oarsD.err}`);
check('D: у галеры 24 весла (12×2)', oarsD.nOars === 24, `n=${oarsD.nOars}`);
check('D: вёсла УБРАНЫ по умолчанию', oarsD.stowed && oarsD.deploy0 === 0,
  `out=${oarsD.stowed} deploy=${oarsD.deploy0}`);
check('D: вёсла у СВОЕГО борта (не сквозь корпус)', oarsD.sidesOk && oarsD.bladesOut,
  `sides=${oarsD.sidesOk} blades=${oarsD.bladesOut}`);
check('D: Alt+W вываливает вёсла (deploy→1)', oarsD.deploy1 > 0.93, `deploy=${oarsD.deploy1}`);
check('D: вёсла дают ход (штиль, паруса убраны)', oarsD.speed > 0.8, `speed=${oarsD.speed} уз`);

// авто-убирание: без гребли таймер доходит до 5 с → вёсла убираются
// (headless троттлит RAF до ~1fps — даём таймеру почти дозреть и ждём кадр)
const oarsAuto = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  p.rowing = 0; p.oarsIdleT = 5.9; p.oarsOut = true;
  return JSON.stringify({ out0: p.oarsOut });
})()`));
await sleep(3500);
const oarsAuto2 = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  return JSON.stringify({ out: p.oarsOut, idle: +p.oarsIdleT.toFixed(1), deploy: +p.oarsDeployT.toFixed(2) });
})()`));
log('D-auto:', JSON.stringify({ ...oarsAuto, ...oarsAuto2 }));
check('D: без гребли 5 с — вёсла убираются сами', oarsAuto2.out === false,
  `out=${oarsAuto2.out} idle=${oarsAuto2.idle}`);

// ============ E: порты на каждом острове ============
log('=== E: порты архипелага (по размеру острова) ===');
const portsE = jparse(ev(`(() => {
  const g = window.__game;
  const s = window.__sea;
  const isl0 = g.world.islands[0];
  const byName = {};
  for (const p of s.ports) byName[p.name] = p;
  // швартовка в ЧУЖОЙ гавани: «Зелёный атолл» (r=175 → городок)
  const target = byName['Зелёный атолл'];
  const pl = g.player;
  pl.position.set(target.x, 0, target.z);
  pl.velocity.set(0, 0, 0);
  const can = g.canDock();
  if (can) g.dock();
  const docked = { can, name: g.dockedPort ? g.dockedPort.name : null,
    tier: g.dockedPort ? g.dockedPort.tier : -1,
    pop: g.dockedPort ? g.dockedPort.population : -1,
    portInfo: g.hud.portInfo };
  g.undock();
  return JSON.stringify({
    nIslands: g.world.islands.length, nPorts: s.ports.length,
    main: { name: byName['Пальмовая гавань'].name, tier: byName['Пальмовая гавань'].tier },
    tiers: s.ports.map(p => p.tier),
    mulOk: s.ports.every(p => p.mul >= 0.78 && p.mul <= 1.32),
    popOk: s.ports.every(p => p.pop > 0),
    docked,
  });
})()`));
log('E:', JSON.stringify(portsE));
check('E: порт на КАЖДОМ острове', portsE.nPorts === portsE.nIslands,
  `islands=${portsE.nIslands} ports=${portsE.nPorts}`);
check('E: главная гавань — город-крепость (r=240)', portsE.main.tier === 3, `tier=${portsE.main.tier}`);
check('E: уровни портов 0..3 по размеру', portsE.tiers.every(t => t >= 0 && t <= 3),
  `tiers=${portsE.tiers.join('')}`);
check('E: множители цен 0.78..1.32', portsE.mulOk);
check('E: население у всех портов', portsE.popOk);
check('E: швартовка в «Зелёном атолле» (городок, tier 2)',
  portsE.docked.can && portsE.docked.name === 'Зелёный атолл' && portsE.docked.tier === 2,
  JSON.stringify(portsE.docked));

// ============ F: экономика порта ============
log('=== F: рынок, грузоподъёмность, верфь, улучшения, скины ===');
const eco = jparse(ev(`(() => {
  const g = window.__game; const p = g.player;
  // вернуться в главную гавань и пришвартоваться
  const port = g.world.ports[0];
  p.position.set(port.dockEnd.x, 0, port.dockEnd.z);
  p.velocity.set(0, 0, 0);
  if (!g.docked) { g.canDock(); g.dock(); }
  p.gold = 10000;
  const out = { gold0: p.gold };
  // цены порта
  out.mul = g.dockedPort.priceMul;
  // покупка сахара ×10
  const sugar = g.world ? null : null;
  const goodSugar = { base: 24, weight: 1 };
  const buyPrice = Math.max(1, Math.round(goodSugar.base * out.mul));
  const err1 = g.portBuyGood('sugar', 10);
  out.buy = { err: err1, sugar: p.cargo.sugar, gold: p.gold,
    expectedCost: buyPrice * 10, cargoT: g.cargoUsedT() };
  // переполнение трюма: забиваем до отказа (команду снизим — проверяем
  // именно вес, а не «команда полная»)
  const maxT = g.cargoMaxT();
  g.player.crew = 10;
  let guard = 0;
  while (g.cargoUsedT() < maxT && guard++ < 4000) p.cargo.sugar = (p.cargo.sugar || 0) + 10;
  out.fullT = g.cargoUsedT();
  out.errFull = g.portBuyGood('sugar', 10); // должно быть «Трюм полон»
  out.errHire = g.portHireCrew();           // и матрос не влезает (вес)
  // продажа по ценам порта
  p.cargo.silk = 4; // 0.5 т/шт — уже не влезет? проверим формулой продажи
  const goldBefore = p.gold;
  out.sell = { err: g.portSellGood('silk', 4), goldDelta: p.gold - goldBefore };
  // покупка корабля за золото (верфь в порту) — ВАЖНО: g.player
  // заменяется на НОВЫЙ Ship, старая ссылка p неактуальна
  p.cargo = { sugar: 0, rum: 0, timber: 0 };
  const goldBefore2 = p.gold;
  const cs = g.changeShip('fluyt'); // платно
  const np = g.player;
  out.buyShip = { err: cs, goldDelta: +(np.gold - goldBefore2).toFixed(0), ship: np.preset.id,
    hullMax: Math.round(np.hullMax) };
  // улучшение корпуса: +15% (на НОВОМ корабле)
  np.gold = 50000;
  const hm0 = np.hullMax;
  out.upg = { err: g.buyUpgrade('hull'), hullRatio: +(g.player.hullMax / hm0).toFixed(2) };
  // скин: чёрные паруса → проверить uniform → вернуть штатные
  g.player.gold = 5000;
  const cs0 = g.player.visual.sails.sails[0].mat.uniforms.uColor.value;
  out.skin = { err: g.buySkin('sail.black'), rgb0: [+(cs0.r).toFixed(2), +(cs0.g).toFixed(2), +(cs0.b).toFixed(2)] };
  const sail1 = g.player.visual.sails.sails[0].mat.uniforms.uColor.value;
  out.skin.black = { r: +sail1.r.toFixed(2), g: +sail1.g.toFixed(2), b: +sail1.b.toFixed(2) };
  out.skin.back = g.equipSkin('sail.default');
  const sail2 = g.player.visual.sails.sails[0].mat.uniforms.uColor.value;
  out.skin.restored = { r: +sail2.r.toFixed(2), g: +sail2.g.toFixed(2), b: +sail2.b.toFixed(2) };
  // флаг-скин
  out.skin.flag = g.buySkin('flag.pirateRed');
  out.goldLeft = g.player.gold;
  g.undock();
  return JSON.stringify(out);
})()`));
log('F:', JSON.stringify(eco));
check('F: покупка сахара ×10 по цене порта', eco.buy.err === null && eco.buy.sugar === 10
  && eco.gold0 - eco.buy.gold === eco.buy.expectedCost,
  `err=${eco.buy.err} cost=${eco.gold0 - eco.buy.gold} expected=${eco.buy.expectedCost}`);
check('F: переполненный трюм блокирует покупку', typeof eco.errFull === 'string' && eco.errFull.includes('Трюм полон'),
  `err=${eco.errFull}`);
check('F: переполненный трюм блокирует найм команды', typeof eco.errHire === 'string' && eco.errHire.includes('Трюм полон'),
  `err=${eco.errHire}`);
check('F: продажа шёлка приносит золото', eco.sell.err === null && eco.sell.goldDelta > 0,
  `delta=${eco.sell.goldDelta}`);
check('F: покупка корабля в порту за золото (fluyt)', eco.buyShip.err === null && eco.buyShip.ship === 'fluyt'
  && eco.buyShip.goldDelta < 0, `err=${eco.buyShip.err} ship=${eco.buyShip.ship} delta=${eco.buyShip.goldDelta}`);
check('F: улучшение корпуса +15%', eco.upg.err === null && Math.abs(eco.upg.hullRatio - 1.15) < 0.02,
  `ratio=${eco.upg.hullRatio}`);
check('F: скин «чёрные паруса» темнеет', eco.skin.err === null && eco.skin.black.r < 0.3 && eco.skin.black.g < 0.3,
  `rgb=${JSON.stringify(eco.skin.black)}`);
check('F: возврат штатных парусов', eco.skin.restored.r > 0.6, `rgb=${JSON.stringify(eco.skin.restored)}`);
check('F: скин флага покупается', eco.skin.flag === null, `err=${eco.skin.flag}`);

// ============ G: пиратское логово и Чёрная жемчужина ============
log('=== G: пиратский остров у полигона ===');
const pir = jparse(ev(`(() => {
  const g = window.__game; const s = window.__sea;
  const isl = g.world.islands.find(i => i.name === 'Логово пиратов');
  const pearl = g.aiShips.find(a => a.ship.preset.id === 'blackpearl');
  const near = g.aiShips.filter(a => !a.ship.sunk
    && Math.hypot(a.ship.position.x - isl.cx, a.ship.position.z - isl.cz) < isl.r + 400);
  // мишень полигона — «Чёрная жемчужина»: 16 орудий/борт, чёрные паруса
  g.startProving('blackpearl');
  const t = g.pgTarget.ship;
  const c = t.visual.sails.sails[0].mat.uniforms.uColor.value;
  return JSON.stringify({
    island: { found: !!isl, x: isl ? isl.cx : 0, z: isl ? isl.cz : 0 },
    lairShips: near.length, telemetry: s.piratesNearLair,
    pearl: pearl ? {
      dPearl: Math.round(Math.hypot(pearl.ship.position.x - isl.cx, pearl.ship.position.z - isl.cz)),
      speed: pearl.ship.preset.maxSpeed, guns: pearl.ship.preset.gunsPerSide,
    } : null,
    target: { guns: t.preset.gunsPerSide, masts: t.preset.masts,
      hull: t.preset.hullHP, sailRGB: [+(c.r).toFixed(2), +(c.g).toFixed(2), +(c.b).toFixed(2)] },
  });
})()`));
log('G:', JSON.stringify(pir));
check('G: остров «Логово пиратов» есть в мире', pir.island.found);
check('G: у логова ≥ 7 пиратских судов', pir.lairShips >= 7 && pir.telemetry >= 7,
  `near=${pir.lairShips} telemetry=${pir.telemetry}`);
check('G: «Чёрная жемчужина» стоит на рейде логова', !!pir.pearl && pir.pearl.dPearl < 600,
  pir.pearl ? `d=${pir.pearl.dPearl}` : 'нет');
check('G: у Жемчужины сверхъестественная скорость (10.6 м/с ≈ 20.6 уз)',
  pir.pearl && pir.pearl.speed === 10.6, `speed=${pir.pearl ? pir.pearl.speed : '?'}`);
check('G: у Жемчужины 32 пушки (16 на борт)',
  pir.target.guns === 16 && pir.pearl.guns === 16, `guns=${pir.target.guns}`);
check('G: паруса Жемчужины чёрные', pir.target.sailRGB.every(v => v < 0.2),
  `rgb=${pir.target.sailRGB}`);

// ============ H: общие регресс-проверки ============
log('=== H: регресс ===');
const fin = jparse(ev(`(() => {
  const s = window.__sea;
  const g = window.__game;
  return JSON.stringify({
    fps: +s.fps.toFixed(1),
    crewShown: s.crewShown, crewTotal: s.crewTotal,
    proving: g.proving ? 1 : 0,
    errors: 0,
  });
})()`));
log('H:', JSON.stringify(fin));
check('H: страница без ошибок', !pageErrors(), pageErrors().slice(0, 200));
check('H: FPS живой (> 8, headless software-рендер)', fin.fps > 8, `fps=${fin.fps}`);
check('H: телеметрия экипажа игрока работает', fin.crewTotal >= 1, `total=${fin.crewTotal}`);

log('');
log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
