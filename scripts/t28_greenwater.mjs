// Quick check: green water achievable at extreme amplitude (2.6) for sloop?
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const log = (...a) => console.log(...a);
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) b.click(); return 'ok'; })()`);
await sleep(2000);
for (const [model, amp] of [['sloop', 2.4], ['sloop', 2.6], ['frigate', 2.6]]) {
  ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
    g.debugSetWeather('storm', 24);
    g.seaAmpSmooth = ${amp};
    p.greenWater = 0;
    return 'ok';
  })()`);
  await sleep(1500);
  const r = jparse(ev(`(() => {
    const g = window.__game;
    const p = g.player;
    let t = g.time;
    const T = window.__THREE;
    const F = p.preset.freeboard, L = p.preset.length;
    const v = new T.Vector3();
    let fbMin = 99, fbEnd = 99, under = 0, n = 0;
    for (let i = 0; i < 2400; i++) {
      t += 1 / 60;
      p.fixedStep(1 / 60, t);
      p.updateVisual(t, 1 / 60, g.particles);
      v.set(0, F * 0.82, 0.44 * L).applyQuaternion(p.quaternion).add(p.position);
      const fb = v.y - g.waterHeightAtT(v.x, v.z, t);
      fbMin = Math.min(fbMin, fb); fbEnd = fb; if (fb < 0) under++;
      n++;
    }
    return JSON.stringify({ model: '${model}', amp: ${amp}, greenWater: p.greenWater,
      fbMin: +fbMin.toFixed(2), fbEnd: +fbEnd.toFixed(2), underPct: Math.round(under / n * 100),
      nan: !isFinite(p.position.y) });
  })()`));
  log(JSON.stringify(r));
}
run('close --all');
