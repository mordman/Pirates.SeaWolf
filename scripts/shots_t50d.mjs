// Task 50 (финал): ГИГАНТСКИЕ объекты для VLM — фигура в соломенной
// шляпе (×3) и книппель (×3), оба между камерой и игроком.
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

// === A: гигантская фигура в соломенной шляпе (×3) ===
const figRes = await ev(`(() => {
  const g = window.__game;
  const BF = window.__buildFigure;
  if (!BF) return 'NO_BF';
  const fig = BF('watch', {
    skin: 0xd9a184, shirt: 0x35526b, pants: 0x4a3a2a,
    beard: 1, hook: 0, pegLeg: 0, eyePatch: false,
    headwear: 'straw', torso: 'shirt', pantsKind: 'long',
    height: 1, parrot: false, bald: false,
  }, 777, false);
  fig.group.scale.setScalar(3);           // ~4.8 м гигант
  const p = g.player;
  const T = window.__THREE.Vector3;
  // фигура в 16 м от игрока, между камерой и игроком
  const u = { x: 0.8, z: 0.6 };
  const fx = p.position.x + u.x * 16, fz = p.position.z + u.z * 16;
  fig.group.position.set(fx, 0, fz);
  fig.group.rotation.y = Math.atan2(u.x, u.z) + Math.PI / 2; // боком к камере
  g.worldGroup.add(fig.group);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.22);
  g.rig.freeAzimSet(Math.atan2(-u.z, -u.x));
  g.rig.distSet(26); g.rig.snap();
  g.paused = true;
  const cam = g.rig.camera;
  const v = new T(fx, 2.2, fz).project(cam);
  return JSON.stringify({ ok: true, screen: [Math.round((v.x*0.5+0.5)*innerWidth), Math.round((-v.y*0.5+0.5)*innerHeight)] });
})()`);
log('fig:', figRes);
await sleep(2200);
run(`screenshot scripts/shots/t50_hat_giant.png`);
writeFileSync('/tmp/t50_giant.json', figRes);

// === B: гигантский книппель (×3), заморожен паузой ===
const chRes = await ev(`(() => {
  const g = window.__game;
  g.paused = false;
  const old = g.worldGroup.children[g.worldGroup.children.length - 1];
  if (old && old.type === 'Group') g.worldGroup.remove(old);   // убрать гиганта
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
  let chainObj = null;
  g.scene.traverse(o => {
    if (chainObj || !o.visible || o.type !== 'Group') return;
    let links = 0;
    for (const c of o.children) {
      if (c.type === 'Mesh' && c.geometry && c.geometry.type === 'TorusGeometry') links++;
    }
    if (links >= 4) chainObj = o;
  });
  if (!chainObj) return 'NO_CHAIN';
  chainObj.scale.multiplyScalar(3);      // ~4 м гигантский книппель
  chainObj.updateMatrixWorld(true);
  const w = new T();
  chainObj.getWorldPosition(w);
  const u = { x: 0.8, z: 0.6 };
  p.position.set(w.x + u.x * 26, 0, w.z + u.z * 26);
  p.velocity.set(0, 0, 0);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.15);
  g.rig.freeAzimSet(Math.atan2(-u.z, -u.x));
  g.rig.distSet(34); g.rig.snap();
  const cam = g.rig.camera;
  const v = w.clone().project(cam);
  return JSON.stringify({ ok: true, screen: [Math.round((v.x*0.5+0.5)*innerWidth), Math.round((-v.y*0.5+0.5)*innerHeight)], z: +v.z.toFixed(3) });
})()`);
log('chain:', chRes);
await sleep(2200);
run(`screenshot scripts/shots/t50_chain_giant.png`);
writeFileSync('/tmp/t50_gchain.json', chRes);
log('done');
