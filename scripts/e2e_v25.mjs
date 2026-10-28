// E2E v25 (Task 9): (1) дым/огонь выстрелов — меньше, полупрозрачные клубы
// (не круги), огонь аддитивный; (2) новые типы кораблей XVI–XVIII вв.
// (каравелла с латинскими, пинасс, когг с замками, галеон, фрегат) —
// в мире и как мишени полигона; (3) мелкие детали при приближении (LOD):
// выбленки, якоря, крышки портов, шлюпка + настройка detailLod.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (r) => {
  try { const v = JSON.parse(r); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return null; }
};
const sea = () => jparse(ev('JSON.stringify(window.__sea)'));
const num = (js) => parseFloat(ev(js));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const key = (code, ms = 120) => {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))"`);
  return sleep(ms).then(() =>
    run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))"`));
};
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

console.log('=== 1. Загрузка и мир: новые корабли ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');
let s = sea();
check('игра загрузилась', !!s && typeof s.fps === 'number');
const kinds = jparse(ev('JSON.stringify(window.__game.aiShips.map(a => a.ship.preset.id))')) || [];
console.log('корабли ИИ:', JSON.stringify(kinds));
check('в мире 5 ИИ-кораблей', kinds.length === 5, kinds.join(','));
check('пинасс-торговец есть', kinds.includes('pinnace'));
check('каравелла-торговец есть', kinds.includes('caravel'));
check('галеон на якоре в гавани', kinds.includes('galleon'));
const galleonState = jparse(ev(`(() => {
  const a = window.__game.aiShips.find(x => x.ship.preset.id === 'galleon');
  if (!a) return null;
  return { state: a.state, anchored: a.ship.anchored, grounded: a.ship.grounded,
    y: +a.ship.position.y.toFixed(2),
    detail: !!a.ship.visual.detail,
    detailVisible: a.ship.visual.detail ? a.ship.visual.detail.visible : null };
})()`));
console.log('галеон:', JSON.stringify(galleonState));
check('галеон на якоре', galleonState && galleonState.anchored);
check('галеон НЕ на мели', galleonState && !galleonState.grounded);
check('у галеона есть LOD-детали', galleonState && galleonState.detail);

console.log('=== 2. Полигон: все 8 моделей мишени ===');
run('find text "Полигон разрушений" click');
await sleep(8000);
s = sea();
check('полигон активен (флейт по умолчанию)', !!s && s.proving === 1);
const models = ['caravel', 'pinnace', 'cog', 'galleon', 'frigate'];
for (const m of models) {
  ev(`window.__game.pgSetModel('${m}')`);
  await sleep(2500);
  const info = jparse(ev(`(() => {
    const g = window.__game, t = g.pgTarget.ship;
    return { id: t.preset.id, name: t.preset.name, masts: t.visual.masts.length,
      sails: t.visual.sails.sails.length, crewShown: t.crew3d.shown,
      detail: !!t.visual.detail };
  })()`));
  console.log(`${m}:`, JSON.stringify(info));
  check(`мишень «${m}» поставлена`, info && info.id === m);
  check(`«${m}»: мачты ${info ? info.masts : '?'}, парусов ${info ? info.sails : '?'}, экипаж ${info ? info.crewShown : '?'}`,
    info && info.masts >= 2 && info.sails >= 2 && info.crewShown >= 8);
}
// каравелла: латинские паруса = 3 всего (1 прямой + 2 латинских, БЕЗ кливеров)
ev(`window.__game.pgSetModel('caravel')`);
await sleep(2000);
const carSails = num('window.__game.pgTarget.ship.visual.sails.sails.length');
check('каравелла: 3 паруса (прямой фок + 2 латинских, без кливеров)', carSails === 3, `sails=${carSails}`);
const cogSails = (ev(`window.__game.pgSetModel('cog')`), await sleep(2000),
  num('window.__game.pgTarget.ship.visual.sails.sails.length'));
check('когг: 2 паруса (по одному на мачту)', cogSails === 2, `sails=${cogSails}`);

console.log('=== 3. LOD мелких деталей: переключение по дистанции ===');
ev(`window.__game.pgSetModel('galleon')`);
await sleep(2500);
// базовая дистанция полигона 90 м; detailLod по умолчанию 270 (high)
let vis = ev(`(() => { const d = window.__game.pgTarget.ship.visual.detail; return d ? d.visible : null; })()`);
console.log('детали мишени при detailLod=270, дист 90 м:', vis);
check('детали ВИДНЫ на 90 м (detailLod 270)', vis === 'true');
ev('window.__game.settings.graphics.detailLod = 100');
await sleep(700);
vis = ev(`(() => { const d = window.__game.pgTarget.ship.visual.detail; return d ? d.visible : null; })()`);
console.log('после detailLod=100:', vis);
check('детали СКРЫТЫ при detailLod=100 (камера дальше)', vis === 'false');
ev('window.__game.settings.graphics.detailLod = 420');
await sleep(700);
vis = ev(`(() => { const d = window.__game.pgTarget.ship.visual.detail; return d ? d.visible : null; })()`);
check('детали снова ВИДНЫ при detailLod=420', vis === 'true');

console.log('=== 4. Дым/огонь выстрела: компактные полупрозрачные клубы ===');
// стреляем по галеону правым бортом с 90 м
ev(`(() => { const a = window.__game.combat.aim; a.active = true; a.side = 1; a.azimuth = 0; a.elevation = 0.05; return 'ok'; })()`);
for (let i = 0; i < 50; i++) {
  const r = num('window.__game.combat.readiness()');
  if (r >= 0.999) break;
  await sleep(1500);
}
await key('Space');
await sleep(500);   // вспышка + первые клубы
shot('v25_volley_flash');
await sleep(1000);  // развитие дыма
shot('v25_volley_smoke');
await sleep(4000);
s = sea();
console.log('после залпа: корпус мишени', (s.tgtHull * 100).toFixed(1) + '%', 'пробоин', s.tgtHoles);
check('залп попал в галеон (корпус < 100%)', s.tgtHull < 0.999, `hull=${(s.tgtHull * 100).toFixed(1)}%`);

console.log('=== 5. Крупный план: детали при приближении ===');
// игрок в 28 м севернее мишени, курсом на неё (носовая камера с воды)
ev(`(() => { const g = window.__game, t = g.pgTarget.ship;
  g.player.position.set(t.position.x, 0, t.position.z - 28);
  g.player.quaternion.set(0, 0, 0, 1); g.player.velocity.set(0, 0, 0);
  g.combat.aim.active = false; return 'ok'; })()`);
await sleep(1000);
run('eval "window.__game.cycleMode()"'); await sleep(400);
run('eval "window.__game.cycleMode()"'); await sleep(800); // режим с воды
shot('v25_galleon_closeup');
// далеко (140 м) — для сравнения LOD
ev(`(() => { const g = window.__game, t = g.pgTarget.ship;
  g.player.position.set(t.position.x, 0, t.position.z - 140);
  g.player.quaternion.set(0, 0, 0, 1); g.player.velocity.set(0, 0, 0); return 'ok'; })()`);
await sleep(900);
shot('v25_galleon_far');

console.log('=== 6. Каравелла под парусами (латинские в мире) ===');
ev(`(() => { const g = window.__game;
  const c = g.aiShips.find(x => x.ship.preset.id === 'caravel');
  if (!c) return 'none';
  g.player.position.set(c.ship.position.x + 55, 0, c.ship.position.z - 35);
  g.player.quaternion.set(0, 0, 0, 1); g.player.velocity.set(0, 0, 0);
  return 'ok'; })()`);
await sleep(2500);
shot('v25_caravel_sailing');
const carInfo = jparse(ev(`(() => {
  const c = window.__game.aiShips.find(x => x.ship.preset.id === 'caravel');
  const furled = c.ship.visual.sails.sails.map(s => +s.furl.toFixed(2));
  return { speed: +c.ship.speed().toFixed(2), furled };
})()`));
console.log('каравелла:', JSON.stringify(carInfo));
check('каравелла идёт под парусами (паруса подняты)', carInfo && carInfo.furled.some(f => f < 0.5),
  `speed=${carInfo ? carInfo.speed : '?'} kn, furl=${carInfo ? JSON.stringify(carInfo.furled) : '?'}`);

console.log('=== 7. FPS и ошибки ===');
await sleep(3000);
s = sea();
check('fps живой (> 8 в headless)', s.fps > 8, `fps=${s.fps}`);
const errs = run('errors'); const cons = run('console');
console.log('--- page errors ---'); console.log(errs || '(пусто)');
console.log('--- console ---'); console.log(cons.split('\n').slice(0, 12).join('\n') || '(пусто)');
check('ошибок страницы нет', !errs || errs.length < 10);

console.log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
