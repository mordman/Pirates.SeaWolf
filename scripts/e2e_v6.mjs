// E2E v6: диагностика РУЛЯ (D = вправо на экране?) и ПОГРУЖЕНИЯ БОРТА в шторм
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('=== Старт ===');
run('reload'); run('wait 6000');
run(`find text "Поднять флаг" click`); run('wait 2500');

// ---- 1. РУЛЬ: разгон, затем держим D и меряем курс + экранное направление носа ----
console.log('=== Тест руля (D) ===');
const rudderTest = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  p.anchored = false; p.sailTarget = 3;
  let t = 0;
  for (let i = 0; i < 900; i++) { t += 1/60; p.fixedStep(1/60, t); } // 15 c разгона
  const h0 = p.heading;
  // держим D (руль вправо) 10 секунд
  p.rudderTarget = 1;
  for (let i = 0; i < 600; i++) { t += 1/60; p.fixedStep(1/60, t); }
  const h1 = p.heading, angY = p.angular.y, rud = p.rudder;
  p.rudderTarget = 0;
  // экранный тест: проекция носа на screen-right камеры
  const cam = g.rig.camera;
  cam.updateMatrixWorld();
  const fwd = p.forward;
  const camRight = new THREE__x().setFromMatrixColumn(cam.matrixWorld, 0);
  const dot = fwd.x * camRight.x + fwd.z * camRight.z;
  const hdgScreenR = -Math.atan2(h1 - h0, 1); // >0 если курс уменьшился (штирборт)
  g.paused = false;
  return JSON.stringify({ h0: +h0.toFixed(3), h1: +h1.toFixed(3), dh: +(h1 - h0).toFixed(3),
    rudder: +rud.toFixed(2), angY: +angY.toFixed(4), speedKn: +p.speedKnots().toFixed(1) });
})()`.replace('THREE__x()', 'g.rig.camera.matrixWorld ? new (Object.getPrototypeOf(g.rig.camera).position).constructor() : null');
const r1 = run(`eval "${rudderTest.replace(/"/g, '\\"')}"`);
console.log('руль D:', r1);

// Проверка направления через компас HUD: курс в градусах должен РАСТИ при D (вправо по компасу)
const compassTest = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  let t = 0;
  const hdg = (sh) => ((-sh * 180 / Math.PI) % 360 + 360) % 360;
  const c0 = hdg(p.heading);
  p.rudderTarget = 1;
  for (let i = 0; i < 400; i++) { t += 1/60; p.fixedStep(1/60, t); }
  const c1 = hdg(p.heading);
  p.rudderTarget = 0;
  for (let i = 0; i < 200; i++) { t += 1/60; p.fixedStep(1/60, t); }
  g.paused = false;
  return JSON.stringify({ compass0: Math.round(c0), compass1: Math.round(c1),
    delta: Math.round(((c1 - c0 + 540) % 360) - 180) });
})()`;
const r2 = run(`eval "${compassTest.replace(/"/g, '\\"')}"`);
console.log('компас при D (должен расти = вправо):', r2);

// ---- 2. ПОГРУЖЕНИЕ БОРТА: шторм, меряем freeboard ----
console.log('=== Тест шторма (ветер 16) ===');
const stormTest = `(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(16);
  p.anchored = false; p.sailTarget = 2;
  let t = 0, fbMin = 999, fbMinT = 0, rollMax = 0, subCount = 0, samples = 0;
  for (let i = 0; i < 3600; i++) { // 60 секунд шторма
    t += 1/60;
    g.updateWeather(1/60);
    p.fixedStep(1/60, t);
    // телеметрия freeboard как в game.ts
    const deckLocal = p.preset.freeboard * 0.82 - 1.0;
    let fb = 999;
    for (const lz of [-p.preset.length * 0.38, 0, p.preset.length * 0.38]) {
      const v = new (Object.getPrototypeOf(p.position).constructor)(0, deckLocal, lz)
        .applyQuaternion(p.quaternion).add(p.position);
      const wy = g.water ? g.water.heightAt(v.x, v.z, t) : 0;
      fb = Math.min(fb, v.y - wy);
    }
    if (fb < fbMin) { fbMin = fb; fbMinT = t; }
    rollMax = Math.max(rollMax, Math.abs(p.euler.z));
    if (fb < -0.15) subCount++;
    samples++;
  }
  g.debugSetWind(7);
  g.paused = false;
  return JSON.stringify({ fbMin: +fbMin.toFixed(2), fbMinT: +fbMinT.toFixed(1),
    rollMax: +rollMax.toFixed(2), subFrac: +(subCount / samples).toFixed(2),
    preset: { freeboard: p.preset.freeboard, draft: p.preset.draft, beam: p.preset.beam, length: p.preset.length } });
})()`;
const r3 = run(`eval "${stormTest.replace(/"/g, '\\"')}"`);
console.log('шторм:', r3);
run('errors');
