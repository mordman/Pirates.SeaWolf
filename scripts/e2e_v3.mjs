// E2E v3: точные цели рифления по уровням + шторм с разбивкой по точкам палубы
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const q = (s) => s.replace(/"/g, '\\"');

console.log('=== Перезагрузка ===');
run('reload'); run('wait 6000');
run(`find text "Поднять флаг" click`); run('wait 2000');

// Точные цели рифления: считаем smoothstep-цели по setAt напрямую
const sailTargets = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  p.anchored = false;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const settle = (sec, t) => { for (let i = 0; i < sec * 60; i++) p.fixedStep(1/60, t += 1/60); return t; };
  let t = 0;
  const res = {};
  for (const lvl of [0, 1, 2, 3]) {
    p.sailTarget = lvl;
    t = settle(20, t); // тяга выходит на уровень
    const furled = p.visual.sails.sails.map(s => +(1 - sm(s.setAt - 0.38, s.setAt, p.sailFrac)).toFixed(2));
    res['lvl' + lvl] = { sailFrac: +p.sailFrac.toFixed(2), furled, setCount: furled.filter(f => f < 0.5).length };
  }
  p.sailTarget = 3;
  g.paused = false;
  return JSON.stringify(res);
})()`;
console.log(run(`eval "${q(sailTargets)}"`));

// Шторм с точками: борт vs нос vs корма, амплитуда 1.3 (новый потолок)
const storm = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true; g.debugSetWind(16);
  p.anchored = false; p.sailTarget = 2; p.rudderTarget = 0;
  const WV = [[1.0,0.25,0.075,110],[0.8,0.6,0.062,55],[0.95,-0.32,0.05,28],[0.5,0.86,0.04,15],[0.88,0.48,0.03,8]];
  const amp = 1.3;
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
  const rotV = (qq, v) => {
    const { x, y, z, w } = qq;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const deckY = p.preset.freeboard * 0.82 - 1.0;
  const L = p.preset.length;
  const NAMES = ['корма', 'кварт', 'мидель', 'нос-кварт', 'нос'];
  const mins = [99, 99, 99, 99, 99];
  let t = 0, maxRoll = 0, maxPitch = 0, sumSub = 0, nSub = 0;
  // 3 курса: вдоль волн, поперёк, навстречу
  const courses = [0.25, 1.45, -1.3];
  for (const crs of courses) {
    p.quaternion.setFromEuler({ x: 0, y: crs, z: 0, order: 'YXZ' });
    for (let i = 0; i < 4200; i++) { // 70 c на курс
      p.fixedStep(1/60, t += 1/60);
      if (i % 6 === 0) {
        let j = 0;
        for (const lz of [-L * 0.38, -L * 0.19, 0, L * 0.19, L * 0.38]) {
          const w = rotV(p.quaternion, [0, deckY, lz]);
          const wy = wh(p.position.x + w[0], p.position.z + w[2], t);
          const fb = p.position.y + w[1] - wy;
          if (fb < mins[j]) mins[j] = fb;
          if (fb < 0) { sumSub += fb; nSub++; }
          j++;
        }
        maxRoll = Math.max(maxRoll, Math.abs(p.euler.z));
        maxPitch = Math.max(maxPitch, Math.abs(p.euler.x));
      }
    }
  }
  const res = { mins: mins.map(v => +v.toFixed(2)), avgSubWhenSub: nSub ? (sumSub / nSub).toFixed(2) : '0',
    maxRollDeg: (maxRoll * 57.3).toFixed(1), maxPitchDeg: (maxPitch * 57.3).toFixed(1),
    names: NAMES, sideOk: mins[1] > -0.35 && mins[2] > -0.35 && mins[3] > -0.35 };
  g.debugSetWind(7); g.paused = false;
  return JSON.stringify(res);
})()`;
console.log(run(`eval "${q(storm)}"`));

console.log('=== Ошибки консоли ===');
console.log(run('errors'));
console.log('DONE');
