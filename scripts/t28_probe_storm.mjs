// Task 28 probe: насколько глубоко физическая модель топит корабль в шторме.
// Замер для frigate/galleon/sloop/victory: 50 с шторма (амплитуда 1.8):
//  - fbBow/fbStern/fbSide min/mean — надводный борт у кромок палубы
//  - dig: position.y − waterHeight(center) min — заглубление корпуса
//  - greenWater — счётчик накрытий
//  - deckUnder% — доля времени, когда хоть одна кромка палубы под водой
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
await sleep(2500);

for (const model of ['sloop', 'frigate', 'galleon']) {
  ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
    g.debugSetWeather('storm', 24);
    g.seaAmpSmooth = 1.9;
    p.greenWater = 0;
    return 'ok';
  })()`);
  await sleep(2000);
  const r = jparse(ev(`(() => {
    const g = window.__game;
    const p = g.player;
    let t = g.time;
    const T = window.__THREE;
    const F = p.preset.freeboard, L = p.preset.length, B = p.preset.beam;
    const v = new T.Vector3();
    let fbBowMin = 99, fbBowSum = 0, fbSternMin = 99, fbSideMin = 99;
    let digMin = 99, under = 0, n = 0, nan = false, maxPitch = 0;
    for (let i = 0; i < 3000; i++) {
      t += 1 / 60;
      p.fixedStep(1 / 60, t);
      p.updateVisual(t, 1 / 60, g.particles);
      if (!isFinite(p.position.y)) { nan = true; break; }
      const q = p.quaternion, pos = p.position;
      const wh = (x, z, t) => g.waterHeightAtT(x, z, t);
      // нос/корма/борт — кромки палубы
      v.set(0, F * 0.82, 0.44 * L).applyQuaternion(q).add(pos);
      const fb = v.y - wh(v.x, v.z, t);
      fbBowMin = Math.min(fbBowMin, fb); fbBowSum += fb;
      v.set(0, F * 0.82, -0.44 * L).applyQuaternion(q).add(pos);
      fbSternMin = Math.min(fbSternMin, v.y - wh(v.x, v.z, t));
      v.set(0.46 * B, F * 0.82, 0).applyQuaternion(q).add(pos);
      fbSideMin = Math.min(fbSideMin, v.y - wh(v.x, v.z, t));
      // заглубление миделя относительно поверхности
      digMin = Math.min(digMin, pos.y - wh(pos.x, pos.z, t));
      if (fb < 0) under++;
      n++;
      maxPitch = Math.max(maxPitch, Math.abs(p.euler.x));
    }
    return JSON.stringify({
      model: '${model}', F, nan,
      fbBowMin: +fbBowMin.toFixed(2), fbBowMean: +(fbBowSum / n).toFixed(2),
      fbSternMin: +fbSternMin.toFixed(2), fbSideMin: +fbSideMin.toFixed(2),
      digMin: +digMin.toFixed(2), underPct: Math.round(under / n * 100),
      greenWater: p.greenWater, maxPitch: +maxPitch.toFixed(3),
    });
  })()`));
  log(model, '=>', JSON.stringify(r));
}
run('close --all');
