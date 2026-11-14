// Task 50: ПРИЦЕЛЬНЫЕ кадры — соломенная шляпа (кроп по ЖЁЛТЫМ
// пикселям STRAW) и книппель в полёте (кроп по позиции меша).
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

// === A: торговец — фигуры с соломенными шляпами крупно ===
await ev(`(() => {
  const g = window.__game;
  const mer = g.aiShips.map(a => a.ship).find(s => s.flagKind === 'merchant' && !s.sunk);
  const p = g.player;
  const T = window.__THREE.Vector3;
  p.position.copy(mer.position).add(new T(9, 0, 5));
  p.velocity.set(0, 0, 0);
  g.stepDebugNR(0.4);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.42);
  g.rig.freeAzimSet(Math.atan2(p.position.z - mer.position.z, p.position.x - mer.position.x));
  g.rig.distSet(12); g.rig.snap();
  g.paused = true;
  return 1;
})()`);
await sleep(2500);
run(`screenshot scripts/shots/t50_hat_full.png`);

// экранные позиции фигур экипажа торговца (для кропа)
const figs = await ev(`(() => {
  const g = window.__game;
  const cam = g.rig.camera;
  const mer = g.aiShips.map(a => a.ship).find(s => s.flagKind === 'merchant' && !s.sunk);
  const v = new window.__THREE.Vector3();
  const out = [];
  mer.crew3d.group.traverse(o => {
    if (!o.visible || (o.type !== 'Mesh' && o.type !== 'Group')) return;
  });
  // фигуры — дети crew3d.group; их мировые позиции
  for (const ch of mer.crew3d.group.children) {
    ch.getWorldPosition(v);
    v.project(cam);
    if (v.z < 1) out.push([Math.round((v.x*0.5+0.5)*innerWidth), Math.round((-v.y*0.5+0.5)*innerHeight)]);
  }
  return JSON.stringify({ n: mer.crew3d.group.children.length, pts: out.slice(0, 40) });
})()`);
log('figs:', figs);
writeFileSync('/tmp/t50_figs.json', figs);

// === B: книппель в полёте, заморожен паузой; игрок рядом с мешем ===
const chain = await ev(`(() => {
  const g = window.__game;
  g.paused = false;
  g.exitProving();
  g.stepDebugNR(0.2);
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
  g.stepDebugNR(0.2);   // ~1/3 полёта
  g.paused = true;
  // найти видимый меш книппеля в сцене (группа с тор-звеньями)
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
      chainPos = [w.x, w.y, w.z];
    }
  });
  if (!chainPos) return 'NO_CHAIN';
  // игрок в 8 м от книппеля, камера смотрит на игрока — снаряд в кадре
  p.position.set(chainPos[0] + 6, 0, chainPos[2] + 5);
  p.velocity.set(0, 0, 0);
  g.rig.mode = 'free';
  g.rig.freeElevSet(0.5);
  g.rig.freeAzimSet(Math.atan2(p.position.z - chainPos[2], p.position.x - chainPos[0]));
  g.rig.distSet(16); g.rig.snap();
  return JSON.stringify({ chainPos });
})()`);
log('chain:', chain);
await sleep(2500);
run(`screenshot scripts/shots/t50_chain_close.png`);

// экранная позиция книппеля (после snap)
const cpos = await ev(`(() => {
  const g = window.__game;
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
      chainPos = w;
    }
  });
  if (!chainPos) return 'NO_CHAIN';
  const cam = g.rig.camera;
  const v = chainPos.clone().project(cam);
  return JSON.stringify({ xy: [Math.round((v.x*0.5+0.5)*innerWidth), Math.round((-v.y*0.5+0.5)*innerHeight)], z: +v.z.toFixed(3) });
})()`);
log('chainScreen:', cpos);
writeFileSync('/tmp/t50_chain.json', cpos);
log('done');
