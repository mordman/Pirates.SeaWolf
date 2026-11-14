// Task 50 (продолжение): прицельный кадр КНИППЕЛЯ — камера смотрит
// НА игрока СКВОЗЬ точку снаряда (снаряд между камерой и игроком).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

const res = await ev(`(() => {
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
  g.combat.aiBallVolley(p, t, 'chain', 10);
  g.stepDebugNR(0.2);
  g.paused = true;
  let chainPos = null;
  g.scene.traverse(o => {
    if (chainPos || !o.visible || o.type !== 'Group') return;
    let links = 0;
    for (const c of o.children) {
      if (c.type === 'Mesh' && c.geometry && c.geometry.type === 'TorusGeometry') links++;
    }
    if (links >= 4) {
      const w = new window.__THREE.Vector3();
      o.getWorldPosition(w);
      chainPos = w.clone();
    }
  });
  if (!chainPos) return 'NO_CHAIN';
  // игрок в 30 м ЗА снарядом (по линии камера→снаряд→игрок);
  // камера на 40 м за игроком → снаряд в ~10 м от камеры, в кадре
  const u = new T(0.8, 0, 0.6).normalize();
  p.position.set(chainPos.x + u.x * 30, 0, chainPos.z + u.z * 30);
  p.velocity.set(0, 0, 0);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.3);
  // камера должна смотреть ИЗ-ЗА игрока НА игрока: направление
  // камера→игрок = u → азимут = atan2(-u.z, -u.x)
  g.rig.freeAzimSet(Math.atan2(-u.z, -u.x));
  g.rig.distSet(40); g.rig.snap();
  // экранная позиция снаряда после snap (проверка, что в кадре)
  const cam = g.rig.camera;
  const v = chainPos.clone().project(cam);
  return JSON.stringify({
    chain: [chainPos.x, chainPos.y, chainPos.z],
    screen: [Math.round((v.x*0.5+0.5)*innerWidth), Math.round((-v.y*0.5+0.5)*innerHeight)],
    z: +v.z.toFixed(3),
  });
})()`);
log('chain:', res);
writeFileSync('/tmp/t50_chain2.json', res);
await sleep(2500);
run(`screenshot scripts/shots/t50_chain_mid.png`);
log('done');
