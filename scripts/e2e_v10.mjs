// E2E v10: верификация фиксов — (1) погружение борта в шторм,
// (2) паруса от скорости, (3) руль, (4) скриншоты для VLM
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => { run(`screenshot scripts/shots/${name}`); console.log('shot:', name); };

console.log('=== Перезагрузка с новым кодом ===');
run('reload'); run('wait 7000');
run("find text \"Поднять флаг\" click");
run('wait 2500');

// ---------- 1. ШТОРМ: погружение борта (waveHeight из настроек 1.15) ----------
console.log('=== Шторм 1.15: кромки палубы ===');
const storm = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(16);
  p.anchored = false; p.sailTarget = 2;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  const V = (x,y,z) => new p.position.constructor(x,y,z);
  let t = 0;
  const step = () => { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); };
  for (let i = 0; i < 1800; i++) step(); // 30 c разгона, море уже штормовое
  const deckY = p.preset.freeboard * 0.82 - 1.0;
  let fbMin = 999, subT = 0, N = 0, rollMax = 0, pitchMax = 0;
  const zs = [-0.42, -0.21, 0, 0.21, 0.42].map(f => f * p.preset.length);
  for (let i = 0; i < 3600; i++) { // 60 c замера
    step();
    p.updateVisual(t, 1/60, g.particles);
    p.visual.group.updateMatrixWorld();
    let worst = 999;
    for (const z of zs) {
      const half = p.halfWidthAt(z);
      for (const x of [-half, half]) {
        const v = p.visual.group.localToWorld(V(x, deckY, z));
        const fb = v.y - g.water.heightAt(v.x, v.z, t);
        if (fb < worst) worst = fb;
      }
    }
    if (worst < fbMin) fbMin = worst;
    if (worst < -0.25) subT++;
    N++;
    rollMax = Math.max(rollMax, Math.abs(p.euler.z));
    pitchMax = Math.max(pitchMax, Math.abs(p.euler.x));
  }
  const res = { fbMinEdge: +fbMin.toFixed(2), subFrac: +(subT/N).toFixed(3),
    rollMax: +rollMax.toFixed(2), pitchMax: +pitchMax.toFixed(2),
    seaAmp: +(0.45 + (g.wind.speed - 3) * 0.085).toFixed(2),
    speed: +p.speedKnots().toFixed(1) };
  g.debugSetWind(7); g.paused = false;
  return JSON.stringify(res);
})()`;
console.log(ev(storm));

// ---------- 2. ШТОРМ 1.3 (максимальная настройка) ----------
console.log('=== Шторм 1.3 (максимум настроек) ===');
const storm13 = storm
  .replace('p.position.set(0, 0, 1500)', 'p.position.set(0, 0, 1500)')
  .replace('g.debugSetWind(16);', 'g.debugSetWind(16); g.settings.graphics.waveHeight = 1.3;');
console.log(ev(storm13));

// ---------- 3. ПАРУСА ОТ СКОРОСТИ ----------
console.log('=== Паруса: постановка по мере разгона ===');
const sailsTest = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(9);
  p.anchored = false; p.sailTarget = 3;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.quaternion.setFromEuler(new p.euler.constructor(0, 0.9, 0, 'YXZ'));
  let t = 0;
  const snap = () => {
    let set = 0, furlAvg = 0;
    for (const s of p.visual.sails.sails) { if (s.furl < 0.5) set++; furlAvg += s.furl; }
    return { kn: +p.speedKnots().toFixed(1), set, furl: +(furlAvg / p.visual.sails.sails.length).toFixed(2) };
  };
  const out = { start: snap(), t10: null, t25: null, steady: null, anchored: null, irons: null };
  for (let i = 0; i < 600; i++) { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  out.t10 = snap();
  for (let i = 0; i < 900; i++) { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  out.t25 = snap();
  for (let i = 0; i < 2100; i++) { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  out.steady = snap();
  // якорь: паруса должны убраться по мере остановки
  p.anchored = true; p.sailTarget = 0;
  for (let i = 0; i < 1800; i++) { t += 1/60; p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  out.anchored = snap();
  // левентик: курс против ветра, ветра достаточно — паруса стоят и трепещут
  p.anchored = false; p.sailTarget = 3;
  p.quaternion.setFromEuler(new p.euler.constructor(0, 0.9 + Math.PI, 0, 'YXZ')); // точно против ветра
  p.velocity.set(0,0,0);
  for (let i = 0; i < 1200; i++) { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles); }
  out.irons = snap();
  g.paused = false;
  return JSON.stringify(out);
})()`;
console.log(ev(sailsTest));

// ---------- 4. РУЛЬ: D = вправо по компасу ----------
console.log('=== Руль: компас при D растёт ===');
const rud = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(9);
  p.anchored = false; p.sailTarget = 3;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.quaternion.setFromEuler(new p.euler.constructor(0, 0.9, 0, 'YXZ'));
  let t = 0;
  for (let i = 0; i < 2400; i++) { t += 1/60; p.fixedStep(1/60, t); }
  const cmp = () => Math.round(((-p.heading * 180 / Math.PI) % 360 + 360) % 360);
  const c0 = cmp();
  p.rudderTarget = 1;
  for (let i = 0; i < 600; i++) { t += 1/60; p.fixedStep(1/60, t); }
  p.rudderTarget = 0;
  const c1 = cmp();
  g.paused = false;
  return JSON.stringify({ cmp0: c0, cmp1: c1, delta: Math.round(((c1 - c0 + 540) % 360) - 180), speed: +p.speedKnots().toFixed(1) });
})()`;
console.log(ev(rud));
run('errors');
