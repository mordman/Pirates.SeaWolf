// E2E v2: уровни парусов (через rAF-анимацию) + шторм v2 + руль повторно
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (s) => s.replace(/"/g, '\\"');

console.log('=== Перезагрузка с новыми зондами ===');
run('reload'); run('wait 6000');
run(`find text "Поднять флаг" click`); run('wait 2500');

// ускорим разгон вручную (физика), паруса поставим на 3
run(`eval "${q(`(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  p.anchored = false; p.sailTarget = 3;
  let t = 0;
  for (let i = 0; i < 1500; i++) p.fixedStep(1/60, t += 1/60);
  g.paused = false;
  return 'ok';
})()`)}"`);

console.log('--- уровень 3: ждём анимацию рифления ---');
await sleep(9000);
console.log(run(`eval "${q(`JSON.stringify({lvl: window.__sea.sailLevel, set: window.__sea.sailSet, min: +window.__sea.furlMin.toFixed(2), avg: +window.__sea.furlAvg.toFixed(2)})`)}"`));

run(`eval "${q(`(() => { const p = window.__game.player; p.sailTarget = 1; return 'ok'; })()`)}"`);
console.log('--- уровень 1 ---');
await sleep(9000);
console.log(run(`eval "${q(`JSON.stringify({lvl: window.__sea.sailLevel, set: window.__sea.sailSet, min: +window.__sea.furlMin.toFixed(2), max: +window.__sea.furlMax.toFixed(2)})`)}"`));

run(`eval "${q(`(() => { const p = window.__game.player; p.sailTarget = 0; return 'ok'; })()`)}"`);
console.log('--- уровень 0 ---');
await sleep(9000);
console.log(run(`eval "${q(`JSON.stringify({lvl: window.__sea.sailLevel, set: window.__sea.sailSet, max: +window.__sea.furlMax.toFixed(2)})`)}"`));

// снова уровень 3 для скриншотов
run(`eval "${q(`(() => { const p = window.__game.player; p.sailTarget = 3; return 'ok'; })()`)}"`);
await sleep(9000);

console.log('=== Шторм v2 (запас плавучести усилен) ===');
const storm = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true; g.debugSetWind(15);
  p.anchored = false; p.sailTarget = 2; p.rudderTarget = 0;
  const WV = [[1.0,0.25,0.075,110],[0.8,0.6,0.062,55],[0.95,-0.32,0.05,28],[0.5,0.86,0.04,15],[0.88,0.48,0.03,8]];
  const amp = 1.5;
  const wh = (x, z, t) => {
    let px = x, pz = z;
    for (let it = 0; it < 2; it++) {
      let dx = 0, dz = 0;
      for (const [dX, dZ, st, wl] of WV) {
        const k = 2 * Math.PI / wl, c = Math.sqrt(9.81 / k), a = st * amp / k;
        const f = k * (dX * px + dZ * pz - c * t);
        dx += dX * a * Math.cos(f); dz += dZ * a * Math.cos(f);
      }
      px = x - dx; pz = z - dz;
    }
    let y = 0;
    for (const [dX, dZ, st, wl] of WV) {
      const k = 2 * Math.PI / wl, c = Math.sqrt(9.81 / k), a = st * amp / k;
      y += a * Math.sin(k * (dX * px + dZ * pz - c * t));
    }
    return y;
  };
  const rotV = (q, v) => {
    const { x, y, z, w } = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const deckY = p.preset.freeboard * 0.82 - 1.0;
  const L = p.preset.length;
  let t = 0, minFb = 99, maxRoll = 0, maxPitch = 0;
  // курс поперёк волн (главная волна идёт вдоль (1, 0.25)) — повернём корабль
  p.quaternion.setFromEuler({ x: 0, y: 1.2, z: 0, order: 'YXZ' });
  for (let i = 0; i < 9000; i++) {
    p.fixedStep(1/60, t += 1/60);
    if (i % 6 === 0) {
      for (const lz of [-L * 0.38, -L * 0.19, 0, L * 0.19, L * 0.38]) {
        const w = rotV(p.quaternion, [0, deckY, lz]);
        const wy = wh(p.position.x + w[0], p.position.z + w[2], t);
        const fb = p.position.y + w[1] - wy;
        if (fb < minFb) minFb = fb;
      }
      maxRoll = Math.max(maxRoll, Math.abs(p.euler.z));
      maxPitch = Math.max(maxPitch, Math.abs(p.euler.x));
    }
  }
  const res = { minFreeboard: minFb.toFixed(2), maxRollDeg: (maxRoll * 57.3).toFixed(1),
    maxPitchDeg: (maxPitch * 57.3).toFixed(1), speed: p.speedKnots().toFixed(1),
    ok: minFb > -0.3 };
  g.debugSetWind(7); g.paused = false;
  return JSON.stringify(res);
})()`;
console.log(run(`eval "${q(storm)}"`));

console.log('=== Ошибки консоли ===');
console.log(run('errors'));
console.log('DONE');
