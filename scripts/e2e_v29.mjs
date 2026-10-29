// E2E v29: Task 12 — (A) корма мишени сплошная, (B) корабль едет ПО волне
// в шторм, (C) картечь: рой мелких пуль, потери экипажа, лёгкий урон
// корпусу, дыры в парусах (+книппель рвёт паруса), (D) мир без ошибок.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
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
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};
const freshPage = async () => {
  run('open http://localhost:3000/');
  run('reload');
  await sleep(1500);
  ev(`(() => { localStorage.removeItem('seawolves.settings.v1'); return 'clean'; })()`);
  run('reload');
  await sleep(9000);
  run('errors --clear'); run('console --clear');
  run('find text "Поднять флаг" click');
  await sleep(7000);
};

// ============ ФАЗА A: корма мишени (флейт) ============
console.log('=== A. Корма мишени ===');
await freshPage();
ev(`(() => { const g = window.__game; g.startProving('fluyt'); return 'pg'; })()`);
await sleep(2500);
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - 16, 0, t.position.z + 2); g.player.velocity.set(0,0,0); while (g.rig.mode !== 'free') g.rig.cycleMode(); g.rig.freeAzimSet(Math.PI); g.rig.freeElevSet(0.22); g.rig.distSet(16); return 'A cam'; })()`);
await sleep(1500);
shot('v29_stern_fluyt1');
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - 24, 0, t.position.z + 22); g.rig.freeAzimSet(Math.PI * 0.85); g.rig.freeElevSet(0.3); g.rig.distSet(20); return 'A cam2'; })()`);
await sleep(1200);
shot('v29_stern_fluyt2');
check('A: мишень жива', num('window.__game.pgTarget ? 1 : 0') === 1);
run('errors') === '' || check('A: ошибок страницы нет', !/error/i.test(run('errors')), run('errors').slice(0, 100));

// ============ ФАЗА B: посадка на волну в шторм ============
console.log('=== B. Шторм: корабль едет ПО волне ===');
await freshPage();
ev(`(() => { const g = window.__game; g.debugSetWeather('storm', 19); return 'storm'; })()`);
// ждём набора волнения (seaAmp > 1.0)
let amp = 0;
for (let i = 0; i < 40 && amp < 1.0; i++) {
  await sleep(2000);
  amp = (sea() || {}).seaAmp || 0;
}
check('B: волнение поднялось (seaAmp>=1.0)', amp >= 1.0, 'seaAmp=' + amp.toFixed(2));
// боковая камера на корпус
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); const azSide = Math.PI * 1.5 - g.player.heading; g.rig.freeAzimSet(azSide); g.rig.freeElevSet(0.24); g.rig.distSet(34); return 'B cam'; })()`);
// сэмплируем посадку ~15 с
const DRAFT = 2.2;
let fbMin = Infinity, offSum = 0, offMax = 0, n = 0, rollMax = 0;
for (let i = 0; i < 12; i++) {
  const s = sea() || {};
  if (typeof s.freeboard === 'number' && isFinite(s.freeboard)) {
    fbMin = Math.min(fbMin, s.freeboard);
    const off = Math.abs(s.y - (s.waterY + DRAFT * 0.10));
    offSum += off; offMax = Math.max(offMax, off);
    rollMax = Math.max(rollMax, Math.abs(s.roll || 0));
    n++;
  }
  if (i === 3 || i === 8) shot('v29_storm_burst' + i);
  await sleep(1300);
}
const offAvg = n ? offSum / n : Infinity;
check('B: корпус на поверхности (средн. |Y-цель| < 0.55 м)', offAvg < 0.55, `avg=${offAvg.toFixed(2)} max=${offMax.toFixed(2)} n=${n}`);
check('B: палуба не тонет в волне (freeboard > -0.9 м)', fbMin > -0.9, `min=${fbMin.toFixed(2)}`);
console.log(`      rollMax=${rollMax.toFixed(2)} рад, seaAmp=${amp.toFixed(2)}`);
shot('v29_storm_final');
const errsB = run('errors');
check('B: ошибок страницы нет', !/error/i.test(errsB), errsB.slice(0, 120));

// ============ ФАЗА C: картечь и книппель по парусам мишени ============
console.log('=== C. Картечь: пули/экипаж/паруса ===');
await freshPage();
ev(`(() => { const g = window.__game; g.startProving('fluyt'); return 'pg'; })()`);
await sleep(2000);
// мишень «в левентик» с поставленными парусами: ветер вдоль её курса
ev(`(() => { const g = window.__game; g.wind.from = 0; g.wind.speed = 4.2; g.pgTarget.ship.sailTarget = 3; g.pgTarget.ship.crew = g.pgTarget.ship.preset.maxCrew; return 'sails up'; })()`);
// ждём постановки парусов (furl < 0.5)
let furlMax = 1;
for (let i = 0; i < 16 && furlMax > 0.5; i++) {
  await sleep(1000);
  furlMax = num(`(() => { const ss = window.__game.pgTarget.ship.visual.sails.sails; return Math.max.apply(null, ss.map(s => s.furl)); })()`);
}
check('C: паруса мишени поставлены (furl<=0.5)', furlMax <= 0.5, 'furlMax=' + furlMax.toFixed(2));
// игрок в 35 м к западу от мишени, курс восток → штирборт (+Z) на мишень
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x, 0, t.position.z - 35); g.player.velocity.set(0,0,0); g.combat.ammo = 'grape'; g.combat.aim.active = true; g.combat.aim.side = 1; g.combat.aim.azimuth = 0; g.combat.aim.elevation = 0.05; return 'lined'; })()`);
const before = jparse(ev(`JSON.stringify({ crew: window.__game.pgTarget.ship.crew, hull: window.__game.pgTarget.ship.hullHP, sail: window.__game.pgTarget.ship.sailHP })`)) || {};
const holesBefore = num(`(() => { const ss = window.__game.pgTarget.ship.visual.sails.sails; return ss.reduce((a, s) => a + s.mat.uniforms.uHoleN.value, 0); })()`);
// залп по корпусу/палубе (экипаж)
ev(`window.__game.combat.fireBroadside()`);
const pellets = num('window.__game.combat.grapeMesh.count');
shot('v29_grape_flight');
await sleep(2500);
const mid1 = jparse(ev(`JSON.stringify({ crew: window.__game.pgTarget.ship.crew, hull: window.__game.pgTarget.ship.hullHP, sail: window.__game.pgTarget.ship.sailHP })`)) || {};
check('C: рой пуль картечи в полёте (grapeMesh.count>0)', pellets > 0, 'count=' + pellets);
// залп по парусам (высокая наводка)
ev(`(() => { const g = window.__game; g.combat.reloads.fill(0); g.combat.aim.elevation = 0.30; g.combat.fireBroadside(); return 'rig volley'; })()`);
await sleep(2500);
ev(`(() => { const g = window.__game; g.combat.reloads.fill(0); g.combat.aim.elevation = 0.42; g.combat.fireBroadside(); return 'rig volley 2'; })()`);
await sleep(2500);
const after = jparse(ev(`JSON.stringify({ crew: window.__game.pgTarget.ship.crew, hull: window.__game.pgTarget.ship.hullHP, sail: window.__game.pgTarget.ship.sailHP })`)) || {};
const holesAfterGrape = num(`(() => { const ss = window.__game.pgTarget.ship.visual.sails.sails; return ss.reduce((a, s) => a + s.mat.uniforms.uHoleN.value, 0); })()`);
// книппель — широкие прорехи
ev(`(() => { const g = window.__game; g.combat.reloads.fill(0); g.combat.ammo = 'chain'; g.combat.aim.elevation = 0.34; g.combat.fireOne(); return 'chain'; })()`);
await sleep(3000);
ev(`(() => { const g = window.__game; g.combat.reloads.fill(0); g.combat.aim.elevation = 0.38; g.combat.fireOne(); return 'chain 2'; })()`);
await sleep(3000);
const holesAfterChain = num(`(() => { const ss = window.__game.pgTarget.ship.visual.sails.sails; return ss.reduce((a, s) => a + s.mat.uniforms.uHoleN.value, 0); })()`);
const sailAfterChain = num('window.__game.pgTarget.ship.sailHP');
console.log(`      экипаж ${before.crew} → ${mid1.crew} → ${after.crew}; корпус ${before.hull.toFixed(0)} → ${after.hull.toFixed(0)}; паруса ${before.sail.toFixed(0)} → ${after.sail.toFixed(0)} → ${sailAfterChain.toFixed(0)}`);
console.log(`      дыры: ${holesBefore} → ${holesAfterGrape} (картечь) → ${holesAfterChain} (книппель)`);
check('C: картечь косит экипаж (crew < start)', mid1.crew < before.crew, `${before.crew} → ${mid1.crew}`);
check('C: картечь ломает корпус СЛАБО (hull > 60%)', after.hull > before.hull * 0.6 && after.hull < before.hull, `${before.hull.toFixed(0)} → ${after.hull.toFixed(0)}`);
check('C: картечь/книппель рвут паруса (sailHP < start)', sailAfterChain < before.sail, `${before.sail} → ${sailAfterChain}`);
check('C: пробоины в парусах нарисованы (uHoleN > 2)', holesAfterGrape > 2, 'holes=' + holesAfterGrape);
check('C: книппель добавляет прорехи', holesAfterChain >= holesAfterGrape, 'holes=' + holesAfterChain);
// крупный план парусов с дырами
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x + 6, 0, t.position.z - 14); g.rig.freeAzimSet(Math.PI * 1.35); g.rig.freeElevSet(0.55); g.rig.distSet(15); return 'close cam'; })()`);
await sleep(1200);
shot('v29_sail_holes');
ev(`(() => { const g = window.__game; g.rig.freeElevSet(0.8); g.rig.distSet(13); return 'close cam 2'; })()`);
await sleep(1000);
shot('v29_sail_holes2');
const errsC = run('errors');
check('C: ошибок страницы нет', !/error/i.test(errsC), errsC.slice(0, 120));

// ============ ФАЗА D: обычный мир ============
console.log('=== D. Мир ===');
await freshPage();
ev(`(() => { const g = window.__game; g.player.sailTarget = 3; return 'sail'; })()`);
await sleep(9000);
const sD = sea() || {};
const others = num('window.__game.combat.others.length');
check('D: корабль идёт под парусами (speed > 1 уз)', (sD.speed || 0) > 1, 'speed=' + (sD.speed || 0).toFixed(1));
check('D: ИИ-корабли в мире (>=4)', others >= 4, 'others=' + others);
check('D: fps живой (> 1.0)', (sD.fps || 0) > 1.0, 'fps=' + (sD.fps || 0).toFixed(1));
shot('v29_world');
const errsD = run('errors');
check('D: ошибок страницы нет', !/error/i.test(errsD), errsD.slice(0, 120));

console.log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
