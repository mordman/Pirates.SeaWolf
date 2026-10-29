// E2E v29c: фаза C — картечь/книппель по мишени с ПОСТАВЛЕННЫМИ парусами
// (sailOverride), дыры в парусах (uHoles), потери экипажа, лёгкий урон корпусу.
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
const num = (js) => parseFloat(ev(js));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

run('open http://localhost:3000/');
run('reload');
await sleep(1500);
ev(`(() => { localStorage.removeItem('seawolves.settings.v1'); return 'clean'; })()`);
run('reload');
await sleep(9000);
run('errors --clear'); run('console --clear');
run('find text "Поднять флаг" click');
await sleep(7000);
ev(`(() => { const g = window.__game; g.startProving('fluyt'); return 'pg'; })()`);
await sleep(2000);
// ждём постановки парусов мишенью (sailOverride=0.85)
let furlMax = 1;
for (let i = 0; i < 16 && furlMax > 0.5; i++) {
  await sleep(1000);
  furlMax = num(`(() => { const ss = window.__game.pgTarget.ship.visual.sails.sails; return Math.max.apply(null, ss.map(s => s.furl)); })()`);
}
check('C: паруса мишени поставлены (furl<=0.5)', furlMax <= 0.5, 'furlMax=' + furlMax.toFixed(2));
shot('v29c_sails_set');

// игрок в 35 м к западу от мишени, курс восток → штирборт (+Z) на мишень
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x, 0, t.position.z - 35); g.player.velocity.set(0,0,0); g.combat.ammo = 'grape'; g.combat.aim.active = true; g.combat.aim.side = 1; g.combat.aim.azimuth = 0; g.combat.aim.elevation = 0.05; return 'lined'; })()`);
const before = jparse(ev(`JSON.stringify({ crew: window.__game.pgTarget.ship.crew, hull: window.__game.pgTarget.ship.hullHP, sail: window.__game.pgTarget.ship.sailHP })`)) || {};
const holesBefore = num(`(() => { const ss = window.__game.pgTarget.ship.visual.sails.sails; return ss.reduce((a, s) => a + s.mat.uniforms.uHoleN.value, 0); })()`);
ev(`window.__game.combat.fireBroadside()`);
const pellets = num('window.__game.combat.grapeMesh.count');
shot('v29c_grape_flight');
await sleep(2500);
const mid1 = jparse(ev(`JSON.stringify({ crew: window.__game.pgTarget.ship.crew, hull: window.__game.pgTarget.ship.hullHP, sail: window.__game.pgTarget.ship.sailHP })`)) || {};
check('C: рой пуль картечи в полёте (grapeMesh.count>0)', pellets > 0, 'count=' + pellets);
// залпы по парусам (высокая наводка)
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
shot('v29c_sail_holes');
ev(`(() => { const g = window.__game; g.rig.freeElevSet(0.8); g.rig.distSet(13); return 'close cam 2'; })()`);
await sleep(1000);
shot('v29c_sail_holes2');
const errsC = run('errors');
check('C: ошибок страницы нет', !/error/i.test(errsC), errsC.slice(0, 120));
console.log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
