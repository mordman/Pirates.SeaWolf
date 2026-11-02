// Проба Task 26: шлюпка бортом к борту + след + спуск/подъём
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
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

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2500);

for (const model of ['frigate', 'cog', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    const bv = p.visual.boat;
    if (!bv) return JSON.stringify({ ok: false });
    const b = bv.group;
    b.updateWorldMatrix(true, false);
    const bm = b.matrixWorld.elements;
    const bow = [bm[8], bm[9], bm[10]];
    const sm = p.visual.group.matrixWorld.elements;
    const fwd = [sm[8], sm[9], sm[10]];
    const dot = bow[0]*fwd[0] + bow[1]*fwd[1] + bow[2]*fwd[2];
    // зазор: внутренний борт шлюпки до обшивки
    const innerX = Math.abs(b.position.x) - bv.beam / 2;
    const hullW = p.halfWidthAt(b.position.z);
    return JSON.stringify({
      ok: true, model: '${model}',
      x: +b.position.x.toFixed(2), y: +b.position.y.toFixed(2), z: +b.position.z.toFixed(2),
      stow: [ +bv.stowPos.x.toFixed(2), +bv.stowPos.y.toFixed(2), +bv.stowPos.z.toFixed(2) ],
      rotY: +b.rotation.y.toFixed(2), dot: +dot.toFixed(3),
      gap: +(innerX - hullW).toFixed(2),
      beam: +bv.beam.toFixed(2), len: +bv.len.toFixed(2),
      L: p.preset.length, B: p.preset.beam,
      falls: bv.falls.geometry.getAttribute('position').count,
      heads: bv.davitHeads.map(h => [ +h.x.toFixed(1), +h.y.toFixed(1), +h.z.toFixed(1) ]),
    });
  })()`));
  console.log('STOW', JSON.stringify(r));
}

// спуск → гребля (след) → подъём
const cyc = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const bl = g.boatLaunch;
  p.anchored = true; p.velocity.set(0,0,0); p.sailTarget = 0;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  for (let i = 0; i < 500; i++) { t += 1/60; bl.update(1/60, t); }
  // гребля 12 с
  bl.row = 1;
  let wakeMax = 0, velMax = 0;
  for (let i = 0; i < 720; i++) {
    t += 1/60; bl.update(1/60, t);
    wakeMax = Math.max(wakeMax, bl.wake.count());
    velMax = Math.max(velMax, Math.abs(bl.vel));
  }
  const st1 = bl.state();
  bl.row = 0;
  for (let i = 0; i < 240; i++) { t += 1/60; bl.update(1/60, t); }
  // подойти к борту у шлюпбалок (мир): точка стоянки в мире + 3 м наружу
  const sp = bl.vis.stowPos.clone().applyQuaternion(p.quaternion).add(p.position);
  bl.pos.set(sp.x + 2.5, 0, sp.z);
  bl.heading = p.heading;
  bl.vel = 0;
  const e2 = bl.tryHoist();
  if (e2) return JSON.stringify({ errHoist: e2, st1, wakeMax, velMax });
  let maxRoll = 0;
  for (let i = 0; i < 1000; i++) {
    t += 1/60; bl.update(1/60, t);
    const q = bl.vis.group.quaternion;
    const sinr = 2 * (q.w * q.z - q.x * q.y);
    maxRoll = Math.max(maxRoll, Math.abs(Math.atan2(sinr, Math.sqrt(Math.max(1e-9, 1 - sinr*sinr)))));
    if (bl.phase === 'stowed') break;
  }
  const b = bl.vis.group;
  return JSON.stringify({
    phase: bl.phase, maxRoll: +maxRoll.toFixed(3),
    end: [ +b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2) ],
    stow: [ +bl.vis.stowPos.x.toFixed(2), +bl.vis.stowPos.y.toFixed(2), +bl.vis.stowPos.z.toFixed(2) ],
    rotY: +(((b.rotation.y % (Math.PI*2)) + Math.PI*2) % (Math.PI*2)).toFixed(2),
    wakeAfter: bl.wake.count(),
    st1, wakeMax, velMax: +velMax.toFixed(2),
  });
})()`));
console.log('CYCLE', JSON.stringify(cyc));

// ошибки страницы
const errs = ev(`window.__jsErrors ? JSON.stringify(window.__jsErrors) : '[]'`);
console.log('JS ERRORS:', errs);
run('close --all');
