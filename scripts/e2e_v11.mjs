// E2E v11: шторм с закреплённым ветром (amp на пределе) + прогрессия парусов по секундам
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);

console.log('=== Шторм с закреплённым ветром ===');
const storm = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(16);
  p.anchored = false; p.sailTarget = 2;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  const V = (x,y,z) => new p.position.constructor(x,y,z);
  let t = 0, pins = 0;
  const step = (i) => {
    if (i % 45 === 0) { g.debugSetWind(16); pins++; } // прибиваем ветер: таймер погоды его сбрасывает
    t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t);
  };
  for (let i = 0; i < 1800; i++) step(i);
  const deckY = p.preset.freeboard * 0.82 - 1.0;
  let fbMin = 999, subT = 0, N = 0, rollMax = 0, pitchMax = 0, ampMax = 0;
  const zs = [-0.42, -0.21, 0, 0.21, 0.42].map(f => f * p.preset.length);
  for (let i = 0; i < 5400; i++) { // 90 c замера
    step(i);
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
    ampMax = Math.max(ampMax, window.__sea ? window.__sea.seaAmp : 0);
  }
  const res = { fbMinEdge: +fbMin.toFixed(2), subFrac: +(subT/N).toFixed(3),
    rollMax: +rollMax.toFixed(2), pitchMax: +pitchMax.toFixed(2), ampMax: +ampMax.toFixed(2),
    speed: +p.speedKnots().toFixed(1), pins };
  g.debugSetWind(7); g.paused = false;
  return JSON.stringify(res);
})()`;
console.log('waveHeight=1.15:', ev(storm));
const storm13 = storm.replace('g.settings', 'g.settings') // no-op
  .replace('p.position.set(0, 0, 1500);', 'p.position.set(0, 0, 1500); g.settings.graphics.waveHeight = 1.3;');
console.log('waveHeight=1.30:', ev(storm13));

console.log('=== Прогрессия парусов по секундам (уровень 3 с нуля) ===');
const sails = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(9);
  p.anchored = false; p.sailTarget = 3;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.quaternion.setFromEuler(new p.euler.constructor(0, 0.9, 0, 'YXZ'));
  // сброс визуала парусов в «убрано»
  for (const s of p.visual.sails.sails) s.furl = 1;
  let t = 0;
  const snap = (tag) => {
    let set = 0, furlAvg = 0;
    for (const s of p.visual.sails.sails) { if (s.furl < 0.5) set++; furlAvg += s.furl; }
    return tag + ': ' + p.speedKnots().toFixed(1) + 'kn set=' + set + ' furl=' + (furlAvg / p.visual.sails.sails.length).toFixed(2);
  };
  const out = [];
  out.push(snap('t0'));
  for (let s = 1; s <= 14; s++) {
    for (let i = 0; i < 60; i++) {
      t += 1/60;
      if (i % 30 === 0) g.debugSetWind(9);
      g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    }
    out.push(snap('t' + s + 's'));
  }
  g.paused = false;
  return out.join(' | ');
})()`;
console.log(ev(sails));
run('errors');
