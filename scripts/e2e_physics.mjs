// E2E-проверка физики: направление руля, паруса по уровню, погружение в шторм
// Запуск: node scripts/e2e_physics.mjs
// Требует запущенного dev-сервера (localhost:3000) и agent-browser.

import { execSync } from 'node:child_process';

const AB = 'agent-browser';
const run = (args) => {
  try {
    return execSync(`${AB} ${args}`, { encoding: 'utf8', timeout: 120000 }).trim();
  } catch (e) {
    return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim();
  }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('=== 1. Открытие страницы ===');
console.log(run('open http://localhost:3000'));
run('wait 4000');

// очистить localStorage чтобы настройки были дефолтными
run(`eval "localStorage.clear()"`);
run('reload');
run('wait 5000');

console.log('\n=== 2. Старт игры ===');
console.log(run(`find text "Поднять флаг" click`));
run('wait 2500');

// проверка консоли
console.log('\n=== 3. Ошибки консоли ===');
console.log(run('errors'));

// ---- Тест A: руль D = вправо (курс убывает), A = влево ----
console.log('\n=== 4. Тест руля (ускоренная симуляция в странице) ===');
const turnTest = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  p.anchored = false; p.sailTarget = 3; p.rudderTarget = 0;
  let t = 0;
  for (let i = 0; i < 1500; i++) p.fixedStep(1/60, t += 1/60);
  const spd1 = p.speedKnots();
  const h0 = p.heading;
  p.rudderTarget = 1; // D
  let rudderD = 0;
  for (let i = 0; i < 600; i++) { p.fixedStep(1/60, t += 1/60); rudderD = p.rudder; }
  const hD = p.heading - h0;
  p.rudderTarget = -1; // A
  for (let i = 0; i < 1400; i++) p.fixedStep(1/60, t += 1/60);
  const hA = p.heading - h0;
  p.rudderTarget = 0;
  for (let i = 0; i < 300; i++) p.fixedStep(1/60, t += 1/60);
  g.paused = false;
  return JSON.stringify({
    speed: spd1.toFixed(1),
    rudderD: rudderD.toFixed(2),
    dHeading_D: hD.toFixed(4),
    dHeading_A: hA.toFixed(4),
    ok: hD < -0.05 && hA > 0.05,
  });
})()`;
console.log(run(`eval "${turnTest.replace(/"/g, '\\"')}"`));

// ---- Тест B: паруса по уровням ----
console.log('\n=== 5. Тест парусов: уровни 3 -> 1 -> 0 ===');
const sailTest = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  let t = 0;
  const settle = (n) => { for (let i = 0; i < n; i++) p.fixedStep(1/60, t += 1/60); };
  const furls = () => p.visual.sails.sails.map(s => +s.furl.toFixed(2));
  p.sailTarget = 3; settle(900); // 15 c: тяга к 1
  const lvl3 = furls();
  p.sailTarget = 1; settle(900);
  const lvl1 = furls();
  p.sailTarget = 0; settle(900);
  const lvl0 = furls();
  g.paused = false;
  return JSON.stringify({ lvl3, lvl1, lvl0 });
})()`;
console.log(run(`eval "${sailTest.replace(/"/g, '\\"')}"`));

// furl-анимация крутится в updateVisual (rAF): подождём реального времени
console.log('(ожидание анимации рифления в рендер-кадрах...)');
await sleep(20000);
console.log(run(`eval "JSON.stringify(window.__sea)"`));

// ---- Тест C: шторм и погружение ----
console.log('\n=== 6. Тест шторма: запас плавучести бортов ===');
const stormTest = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(15);
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
      const f = k * (dX * px + dZ * pz - c * t);
      y += a * Math.sin(f);
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
  let t = 0, minFb = 99, maxSub = 0, trackErr = 0;
  for (let i = 0; i < 9000; i++) { // 150 сим-секунд шторма
    p.fixedStep(1/60, t += 1/60);
    if (i % 6 === 0) {
      for (const lz of [-L * 0.38, -L * 0.19, 0, L * 0.19, L * 0.38]) {
        const w = rotV(p.quaternion, [0, deckY, lz]);
        const wy = wh(p.position.x + w[0], p.position.z + w[2], t);
        const fb = p.position.y + w[1] - wy;
        if (fb < minFb) { minFb = fb; maxSub = -fb; }
      }
      const werr = Math.abs(p.position.y - wh(p.position.x, p.position.z, t));
      if (werr > trackErr) trackErr = werr;
    }
  }
  const res = { minFreeboard: minFb.toFixed(2), maxSubmersion: maxSub.toFixed(2),
    maxTrackErr: trackErr.toFixed(2), speed: p.speedKnots().toFixed(1),
    ok: minFb > -0.25 && trackErr < 0.8 };
  g.debugSetWind(7);
  g.paused = false;
  return JSON.stringify(res);
})()`;
console.log(run(`eval "${stormTest.replace(/"/g, '\\"')}"`));

console.log('\n=== 7. Финальные ошибки консоли ===');
console.log(run('errors'));
console.log('\nDONE');
