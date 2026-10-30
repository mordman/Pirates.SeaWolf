// E2E Task 19 — по фидбеку игрока:
//  (A) настройка количества денег: стартовое золото в настройках «Игра»,
//      применяется сразу, сохраняется в localStorage
//  (B) вёсла убраны — лежат ВДОЛЬ борта (не «палки вверх»); при гребле
//      вываливаются наружу и дают ход; после — снова вдоль борта
//  (C) мачта сломана → всё, что её держало, падает вместе с ней:
//      обвязка рвётся, мачта заваливается до воды со всплеском
//  (D) рыбацкие детали гаваней: шлюпки у пирса (качаются), краболовки,
//      вешала, поплавки, рыбаки; шлюпки ТОПЯТСЯ от разрывов снарядов
//  (E) скриншоты для VLM-верификации
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
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

// ============ A: настройка денег ============
log('=== A: настройка количества денег ===');
const moneyA = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ gold0: g.player.gold, set0: g.settings.gameplay.startMoney });
})()`));
log('A:', JSON.stringify(moneyA));
check('A: стартовое золото по умолчанию 350', moneyA.gold0 === 350 && moneyA.set0 === 350,
  `gold=${moneyA.gold0} set=${moneyA.set0}`);
// живое применение: 5000
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.gameplay.startMoney = 5000; g.applySettings(s); return 'rich'; })()`);
await sleep(400);
const moneyA2 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ gold: g.player.gold }); })()`));
check('A: смена настройки сразу выдаёт 5000 зол.', moneyA2.gold === 5000, `gold=${moneyA2.gold}`);
// сохранение + перезагрузка
ev(`(() => { const g = window.__game; localStorage.setItem('seawolves.settings.v1', JSON.stringify(Object.assign({}, g.settings, { v: 3 }))); return 'saved'; })()`);
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2500);
const moneyA3 = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ gold: g.player.gold, set: g.settings.gameplay.startMoney,
    ls: JSON.parse(localStorage.getItem('seawolves.settings.v1')).gameplay.startMoney });
})()`));
log('A3:', JSON.stringify(moneyA3));
check('A: после перезагрузки — 5000 сохранено (localStorage + кошелёк)',
  moneyA3.gold === 5000 && moneyA3.set === 5000 && moneyA3.ls === 5000,
  `gold=${moneyA3.gold} set=${moneyA3.set} ls=${moneyA3.ls}`);
// UI: вкладка «Игра» — поле золота
clickBtn('Настройки');
await sleep(700);
clickBtn('Игра');
await sleep(600);
const uiA = jparse(ev(`(() => {
  const els = [...document.querySelectorAll('input[type=number]')];
  return JSON.stringify({
    n: els.length,
    hasMoney: document.body.textContent.includes('Стартовое золото'),
    vals: els.map(e => Number(e.value)),
  });
})()`));
log('A: UI:', JSON.stringify(uiA));
check('A: в настройках есть «Стартовое золото»', uiA.hasMoney === true);
check('A: 5 числовых полей (4 боезапаса + золото)', uiA.n === 5, `n=${uiA.n}`);
check('A: в поле золота — 5000', uiA.vals.includes(5000), JSON.stringify(uiA.vals));
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Готово')); if (b) b.click(); return 'closed'; })()`);
await sleep(500);
// вернуть дефолт, чтобы не мешать следующим фазам
ev(`localStorage.removeItem('seawolves.settings.v1')`);

// ============ B: вёсла — вдоль борта, не вверх ============
log('=== B: убранные вёсла лежат вдоль борта ===');
const oarsB = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const err = g.changeShip('galley', true); // 12 вёсел на борт
  const p = g.player;
  const v = p.position.clone(); // Vector3 без window.THREE
  const probe = () => {
    let maxY = 0, along = true, out = true;
    for (const o of p.visual.oars) {
      const side = o.userData.side;
      v.set(side, 0, 0).applyQuaternion(o.quaternion);
      maxY = Math.max(maxY, Math.abs(v.y));
      if (Math.abs(v.z) <= Math.abs(v.x)) along = false;
      if (Math.abs(v.x) <= Math.abs(v.z)) out = false;
    }
    return { maxY: +maxY.toFixed(3), along, out };
  };
  const stow = probe(); // убраны: вдоль борта, без вертикальных палок
  // вываливаем и гребём (полная команда — как у экипажа 850 в v34)
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0);
  p.crew = p.preset.maxCrew;
  p.oarsOut = true; p.rowing = 1; p.oarsIdleT = 0;
  let time = g.time;
  for (let i = 0; i < 600; i++) { time += 1/60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  const deployMid = +p.oarsDeployT.toFixed(2);
  const deployed = probe();
  const speed = +p.speedKnots().toFixed(2);
  // убираем — вёсла возвращаются вдоль борта
  p.rowing = 0; p.oarsOut = false;
  for (let i = 0; i < 300; i++) { time += 1/60; p.fixedStep(1/60, time); p.updateVisual(time, 1/60, g.particles); }
  const restowed = probe();
  return JSON.stringify({ err: err === null ? null : String(err), n: p.visual.oars.length, stow, deploy: deployMid,
    deployed, speed, restowed });
})()`));
log('B:', JSON.stringify(oarsB));
if (!oarsB || !oarsB.stow) {
  check('B: данные по вёслам получены', false, JSON.stringify(oarsB).slice(0, 200));
  Object.assign(oarsB, { err: 'eval', n: -1, deploy: 0, speed: 0,
    stow: { maxY: 9, along: false }, deployed: { out: false }, restowed: { maxY: 9, along: false } });
}
check('B: смена на галеру прошла', oarsB.err === null, `err=${oarsB.err}`);
check('B: 24 весла (12×2)', oarsB.n === 24, `n=${oarsB.n}`);
check('B: УБРАННЫЕ вёсла не торчат вверх (|Y|<0.35)', oarsB.stow.maxY < 0.35,
  `maxY=${oarsB.stow.maxY}`);
check('B: убранные вёсла лежат ВДОЛЬ борта (корма)', oarsB.stow.along === true);
check('B: Alt+W вываливает вёсла (deploy→1)', oarsB.deploy > 0.93, `deploy=${oarsB.deploy}`);
check('B: вываленные вёсла торчат НАРУЖУ борта', oarsB.deployed.out === true);
check('B: гребля даёт ход (штиль, паруса убраны)', oarsB.speed > 0.8, `speed=${oarsB.speed} уз`);
check('B: после гребли вёсла снова вдоль борта', oarsB.restowed.along === true && oarsB.restowed.maxY < 0.35,
  `along=${oarsB.restowed.along} maxY=${oarsB.restowed.maxY}`);

// ============ C: мачта + всё, что её держит ============
log('=== C: сломанная мачта тянет за собой обвязку ===');
const rigC = jparse(ev(`(() => {
  const g = window.__game;
  const t = g.pgTarget.ship;
  t.clearDamage();
  const lines0 = t.visual.rigging ? t.visual.rigging.meta.length : 0;
  t.breakMast(0);
  const snapped1 = t.riggingSnapped();
  let time = g.time;
  for (let i = 0; i < 400; i++) { time += 1/60; t.updateVisual(time, 1/60, g.particles); }
  const c1 = {
    fall: +t.mastFall[0].toFixed(2),
    rotX: +t.visual.masts[0].rotation.x.toFixed(2),
    posY: +t.visual.masts[0].position.y.toFixed(2),
    rotZ: +t.visual.masts[0].rotation.z.toFixed(2),
    othersIntact: t.mastFall.slice(1).every(f => f === -1),
  };
  // ломаем вторую — обвязка рвётся дальше
  t.breakMast(1);
  const snapped2 = t.riggingSnapped();
  t.clearDamage();
  const restored = t.riggingSnapped();
  return JSON.stringify({ lines0, snapped1, snapped2, c1, restored,
    fallFinal: t.mastFall[0] === -1 });
})()`));
log('C:', JSON.stringify(rigC));
if (!rigC || !rigC.c1) {
  check('C: данные по мачтам получены', false, JSON.stringify(rigC).slice(0, 200));
  Object.assign(rigC, { lines0: 0, snapped1: 0, snapped2: 0, restored: 0,
    c1: { fall: -1, rotX: 0, posY: 0, rotZ: 0, othersIntact: false }, fallFinal: false });
}
check('C: у мишени есть обвязка (снастей > 0)', rigC.lines0 > 0, `lines=${rigC.lines0}`);
check('C: breakMast(0) рвёт обвязку мачты', rigC.snapped1 > 0, `snapped=${rigC.snapped1}`);
check('C: мачта падает до конца (fall→1)', rigC.c1.fall === 1, `fall=${rigC.c1.fall}`);
check('C: мачта завалилась (rotX≈1.38, упала за борт)', rigC.c1.rotX > 1.2, `rotX=${rigC.c1.rotX}`);
check('C: мачта осела вниз (posY≈−2.1)', rigC.c1.posY < -1.5, `posY=${rigC.c1.posY}`);
check('C: остальные мачты стоят', rigC.c1.othersIntact === true);
check('C: вторая мачта рвёт свою обвязку (снап растёт)', rigC.snapped2 > rigC.snapped1,
  `${rigC.snapped1}→${rigC.snapped2}`);
check('C: clearDamage восстанавливает всё', rigC.restored === 0 && rigC.fallFinal === true);

// ============ D: рыбацкие гавани + топимые шлюпки ============
log('=== D: причалы с лодками, краболовки; лодки топятся ===');
const fishD = jparse(ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const w = g.world;
  const home = w.fishing[0];
  const fl = home.boats.find(b => b.floating);
  // качка: синтетическая волна ±1.5 м (по времени, не по месту)
  const wave = (x, z, t) => Math.sin(t) * 1.5;
  home.update(0, 1/60, wave);
  const y1 = fl.mesh.position.y;
  home.update(1.5708, 1/60, wave);
  const y2 = fl.mesh.position.y;
  // топим шлюпку разрывом (как от снаряда)
  const before = w.boatsFloating();
  const sunk = g.sinkBoatsAt(fl.x, fl.z, 3.6);
  const b = fl;
  const vis0 = b.mesh.visible;
  // тик анимации затопления (~4 с)
  for (let i = 0; i < 260; i++) home.update(i / 60, 1/60, () => 0);
  g.gibs.update(1/60);
  return JSON.stringify({
    villages: w.fishing.length,
    islands: w.islands.length,
    boatsTotal: w.boatsTotal(),
    home: { boats: home.boats.length, floating: home.boats.filter(x => x.floating).length,
      buoys: home.buoys.length, men: home.fishermen.length },
    bob: +(y2 - y1).toFixed(3),
    before, sunk, vis0,
    sunkT: +b.sunkT.toFixed(2), visible: b.mesh.visible, y: +b.mesh.position.y.toFixed(2),
    after: w.boatsFloating(),
    gibs: g.gibs.alive,
  });
})()`));
log('D:', JSON.stringify(fishD));
if (!fishD || !fishD.home) {
  check('D: данные по деревням получены', false, JSON.stringify(fishD).slice(0, 200));
  Object.assign(fishD, { villages: 0, islands: 1, boatsTotal: 0,
    home: { boats: 0, floating: 0, buoys: 0, men: 0 }, bob: 0, before: 1, sunk: 0,
    sunkT: 0, visible: true, y: 0, after: 1, gibs: 0 });
}
check('D: рыбацкий декор у КАЖДОГО острова', fishD.villages === fishD.islands,
  `villages=${fishD.villages} islands=${fishD.islands}`);
check('D: в архипелаге есть шлюпки (>= 20)', fishD.boatsTotal >= 20, `total=${fishD.boatsTotal}`);
check('D: домашняя гавань: лодки + поплавки + рыбаки',
  fishD.home.boats >= 3 && fishD.home.floating >= 1 && fishD.home.buoys >= 3 && fishD.home.men === 2,
  JSON.stringify(fishD.home));
check('D: шлюпка качается на волнах (y меняется)', Math.abs(fishD.bob) > 0.5,
  `bob=${fishD.bob}`);
check('D: разрыв топит шлюпку (sunk≥1)', fishD.sunk >= 1, `sunk=${fishD.sunk}`);
check('D: шлюпка ушла под воду (y < −1) и скрылась',
  fishD.sunkT === 1 && fishD.visible === false && fishD.y < -1,
  `sunkT=${fishD.sunkT} y=${fishD.y} vis=${fishD.visible}`);
check('D: на плаву стало меньше', fishD.after < fishD.before,
  `${fishD.before}→${fishD.after}`);
check('D: щепа от шлюпки летит гибами', fishD.gibs > 0, `gibs=${fishD.gibs}`);

// ============ E: скриншоты для VLM ============
log('=== E: скриншоты ===');
// E1: галера с убранными вёслами — вид сбоку, видно, что вёсла вдоль борта
ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.changeShip('galley', true);
  const p = g.player;
  p.oarsOut = false; p.rowing = 0; p.oarsIdleT = 0; p.anchored = true;
  p.velocity.set(0, 0, 0);
  g.setCameraMode('free');
  g.rig.freeAzimSet(1.25); g.rig.freeElevSet(0.16); g.rig.distSet(58);
  return 'E1 set';
})()`);
await sleep(3000);
shot('t19_oars_stowed');
await sleep(400);

// E2: домашняя гавань — пирс с лодками, краболовки, поплавки
ev(`(() => {
  const g = window.__game;
  g.exitProving();
  const port = g.world.ports[0];
  const dir = port.dir;
  const p = g.player;
  // встать за кормой пирса, глядя на причал
  p.position.set(port.dockEnd.x + dir.x * 60, 0, port.dockEnd.z + dir.z * 60);
  p.velocity.set(0, 0, 0);
  const up = p.position.clone().set(0, 1, 0); // ось Y без window.THREE
  p.quaternion.setFromAxisAngle(up, Math.atan2(-dir.x, -dir.z));
  p.wake.clear();
  g.rig.snap();
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.atan2(dir.x, dir.z) + Math.PI + 0.5);
  g.rig.freeElevSet(0.34);
  g.rig.distSet(85);
  return 'E2 set';
})()`);
await sleep(3000);
shot('t19_port_fishing');
await sleep(400);

// E3: топнём шлюпку у пирса — снимем середину анимации
ev(`(() => {
  const g = window.__game;
  const home = g.world.fishing[0];
  const fl = home.boats.find(b => b.floating && !b.sinking);
  g.sinkBoatsAt(fl.x, fl.z, 3.0);
  return 'E3 sunk ' + fl.x.toFixed(0) + ',' + fl.z.toFixed(0);
})()`);
await sleep(1600);
shot('t19_boat_sinking');
await sleep(400);

// E4: сломанная мачта — обвязка упала вместе с ней
ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  const t = g.pgTarget.ship;
  t.clearDamage();
  t.breakMast(0);
  let time = g.time;
  for (let i = 0; i < 400; i++) { time += 1/60; t.updateVisual(time, 1/60, g.particles); }
  const p = g.player;
  g.setCameraMode('free');
  const d = t.position.clone().sub(p.position);
  g.rig.freeAzimSet(Math.atan2(d.x, d.z) + 0.9);
  g.rig.freeElevSet(0.22);
  g.rig.distSet(120);
  return 'E4 set';
})()`);
await sleep(3000);
shot('t19_mast_rigging');
await sleep(400);

// ============ F: страница жива ============
await sleep(1200);
const errs = (() => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
})();
check('F: страница без ошибок', !errs, errs.slice(0, 200));
const fpsF = jparse(ev(`(() => { return window.__sea ? JSON.stringify({ fps: +window.__sea.fps.toFixed(1) }) : '{}'; })()`));
check('F: FPS живой (> 4, headless + галера с 24 вёслами)', fpsF.fps > 4, `fps=${fpsF.fps}`);
log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
