// Task 80: финальные скриншоты — крупный план зелёной сабли проклятого
// капитана + ПЕРЕЛОМ корпуса с правильным кадрированием (камера на цель).
import { execSync } from 'node:child_process';

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

// ==== 1. Проклятый капитан с ЗЕЛЁНОЙ САБЛЕЙ в руке (крупно) ====
ev(`(() => {
  const g = window.__game; const T = window.__THREE;
  g.changeShip('blackpearl', true);
  g.stepDebugNR(1.2);
  g.debugDeckWalk(true);
  const L = g.lander;
  L.handleInput({ isDown: () => false, pressed: c => c === 'Digit1', mouseDX: 0, mouseDY: 0, wheel: 0, lmbJust: false, rmb: false });
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 3.05); g.rig.freeElevSet(0.06); g.rig.distSet(16);
  g.stepDebug(0.4); return 1; })()`);
run(`screenshot scripts/shots/t80_final_cursed_saber.png`);
ev(`(() => { const g = window.__game; g.debugDeckWalk(false); return 1; })()`);

// ==== 2. ПЕРЕЛОМ: цель рядом, камера на неё ====
ev(`(() => {
  const g = window.__game; const T = window.__THREE;
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  g.player.wind.speed = 3;
  g.player.position.set(0, 0, 0); g.player.velocity.set(0, 0, 0);
  g.player.quaternion.set(0, 0, 0, 1);
  t.clearDamage();
  t.anchored = true; t.sailTarget = 0; t.sailOverride = null;
  t.velocity.set(0, 0, 0); t.angular.set(0, 0, 0);
  // цель в 55 м по курсу игрока (нос +Z игрока)
  t.position.set(g.player.position.x, 0, g.player.position.z + 55);
  t.quaternion.set(0, 0, 0, 1);
  g.stepDebugNR(2);
  t.position.set(g.player.position.x, 0, g.player.position.z + 55);
  t.quaternion.set(0, 0, 0, 1);
  g.stepDebugNR(0.5);
  // доломать набор у миделя → ПЕРЕЛОМ
  for (let i = 0; i < 8 && !t.hullBroke; i++) t.damageStructure(new T.Vector3(0, -0.4, 2 + (i % 3) - 1), 26);
  window.__t80target = t;
  return JSON.stringify({ broke: t.hullBroke, sinking: t.sinking, id: t.preset.id }); })()`);

// кадр 1: сразу после перелома (разрыв обшивки + щепа)
ev(`(() => { const g = window.__game;
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading); g.rig.freeElevSet(0.10); g.rig.distSet(55);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_final_break_1.png`);

// кадр 2: +7 с — зарытый конец, палуба у воды
ev(`(() => { const g = window.__game; const t = window.__t80target;
  g.stepDebugNR(7);
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 0.5); g.rig.freeElevSet(0.14); g.rig.distSet(55);
  g.stepDebug(0.3); return JSON.stringify({ phase: t.sinkPhase, y: +t.position.y.toFixed(1) }); })()`);
run(`screenshot scripts/shots/t80_final_break_2.png`);

// кадр 3: +14 с — уход под воду
ev(`(() => { const g = window.__game; const t = window.__t80target;
  g.stepDebugNR(8);
  g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 0.9); g.rig.freeElevSet(0.18); g.rig.distSet(50);
  g.stepDebug(0.3); return JSON.stringify({ phase: t.sinkPhase, y: +t.position.y.toFixed(1), sunk: t.sunk }); })()`);
run(`screenshot scripts/shots/t80_final_break_3.png`);

console.log('SHOTS DONE');
runRaw('close');
