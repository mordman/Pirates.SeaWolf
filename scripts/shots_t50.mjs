// Task 50: СКРИНШОТЫ для VLM — солдаты на военном, матросы на
// торговом, соломенная шляпа крупно, книппель в полёте.
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
const log = (...a) => console.log(...a);

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// 1) СОЛДАТЫ: военный бриг эскадры — палуба с мундирами
await ev(`(() => {
  const g = window.__game;
  const navy = g.aiShips.map(a => a.ship).find(s => s.flagKind === 'navy' && !s.sunk);
  if (!navy) return 'NO_NAVY';
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.position.copy(navy.position).add(new T(18, 0, 10));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.4);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.55);
  g.rig.freeAzimSet(Math.atan2(p.position.z - navy.position.z, p.position.x - navy.position.x));
  g.rig.distSet(24); g.rig.snap();
  return 1;
})()`);
await sleep(2500);
run(`screenshot scripts/shots/t50_navy_soldiers.png`);

// 2) ТОРГОВЦЫ: каравелла — матросы в соломенных шляпах
await ev(`(() => {
  const g = window.__game;
  const mer = g.aiShips.map(a => a.ship).find(s => s.flagKind === 'merchant' && !s.sunk);
  if (!mer) return 'NO_MERCH';
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.position.copy(mer.position).add(new T(16, 0, -9));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.4);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.55);
  g.rig.freeAzimSet(Math.atan2(p.position.z - mer.position.z, p.position.x - mer.position.x));
  g.rig.distSet(22); g.rig.snap();
  return 1;
})()`);
await sleep(2500);
run(`screenshot scripts/shots/t50_merchant_sailors.png`);

// 3) СОЛОМЕННАЯ ШЛЯПА крупно: носовая палуба торговца, низкая камера
await ev(`(() => {
  const g = window.__game;
  const mer = g.aiShips.map(a => a.ship).find(s => s.flagKind === 'merchant' && !s.sunk);
  if (!mer) return 'NO_MERCH';
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.position.copy(mer.position).add(new T(8, 0, 6));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.4);
  g.rig.freeElevSet(0.35);
  g.rig.freeAzimSet(Math.atan2(p.position.z - mer.position.z, p.position.x - mer.position.x) + 0.3);
  g.rig.distSet(11); g.rig.snap();
  return 1;
})()`);
await sleep(2500);
run(`screenshot scripts/shots/t50_straw_hat.png`);

// 4) КНИППЕЛЬ В ПОЛЁТЕ: полигон, залп цепями с 60 м, пауза в полёте
await ev(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.stepDebugNR(0.3);
  const t = g.pgTarget.ship;
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.position.copy(t.position).add(new T(60, 0, 3));
  p.quaternion.setFromEuler(new window.__THREE.Euler(0, Math.PI / 2, 0));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.3);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.18);
  g.rig.freeAzimSet(Math.PI / 2 + 1.2);
  g.rig.distSet(28); g.rig.snap();
  // залп книппелями прицелом в борт и пауза СРАЗУ — в полёте
  g.combat.aiBallVolley(p, t, 'chain', 8);
  g.stepDebugNR(0.22);
  return 1;
})()`);
await sleep(1800);
run(`screenshot scripts/shots/t50_chain_shot.png`);
log('done');
