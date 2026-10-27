// E2E v7: экранное направление поворота (D) + погружение БОРТА (кромки палубы)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);

console.log('=== Старт ===');
run('reload'); run('wait 6000');
run(`find text "Поднять флаг" click`); run('wait 2500');

// ---- 1. Экранное направление носа при D (iso-камера следует за курсом) ----
console.log('=== Экранный тест D ===');
const screenTest = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  p.anchored = false; p.sailTarget = 3;
  let t = 0;
  for (let i = 0; i < 900; i++) { t += 1/60; p.fixedStep(1/60, t); }
  // камеру ставим в равновесие с текущим курсом (iso следит за курсом)
  for (let i = 0; i < 240; i++) { t += 1/60; g.rig.update(1/60, {active:false,side:1,dir:p.forward},
    { scenePos: p.position, heading: p.heading, roll: p.euler.z, pitch: p.euler.x, speedFrac: 0.5 },
    { mouseDX:0, mouseDY:0, wheel:0, rmb:false }); }
  const dotBefore = (() => {
    const e = g.rig.camera.matrixWorld.elements;
    const f = p.forward;
    return f.x * e[0] + f.z * e[2];
  })();
  // держим D 6 секунд физики + камера следит
  p.rudderTarget = 1;
  let dotMin = 1, dotAt3s = 0;
  for (let i = 0; i < 360; i++) {
    t += 1/60; p.fixedStep(1/60, t);
    g.rig.update(1/60, {active:false,side:1,dir:p.forward},
      { scenePos: p.position, heading: p.heading, roll: p.euler.z, pitch: p.euler.x, speedFrac: 0.5 },
      { mouseDX:0, mouseDY:0, wheel:0, rmb:false });
    const d = (() => { const e = g.rig.camera.matrixWorld.elements; const f = p.forward; return f.x*e[0]+f.z*e[2]; })();
    dotMin = Math.min(dotMin, d);
    if (i === 180) dotAt3s = d;
  }
  p.rudderTarget = 0;
  const dotAfter = (() => { const e = g.rig.camera.matrixWorld.elements; const f = p.forward; return f.x*e[0]+f.z*e[2]; })();
  g.paused = false;
  return JSON.stringify({ dotBefore:+dotBefore.toFixed(3), dotAt3s:+dotAt3s.toFixed(3),
    dotMin:+dotMin.toFixed(3), dotAfter:+dotAfter.toFixed(3),
    note:'dot>0 = нос RIGHT of screen center' });
})()`;
console.log(ev(screenTest));

// ---- 2. Погружение борта: кромки палубы (обе стороны, 5 шпаций) ----
console.log('=== Шторм: кромки палубы ===');
const stormTest = `
(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(16);
  p.anchored = false; p.sailTarget = 2;
  // сначала 20 c разгона в шторме (волны уже большие)
  let t = 0;
  for (let i = 0; i < 1200; i++) { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); }
  const L = p.preset.length;
  const sample = () => {
    // точки кромки палубы: обе стороны × 5 сечений
    let worst = 999, worstInfo = '';
    const zs = [-0.42, -0.21, 0, 0.21, 0.42].map(f => f * L);
    for (const z of zs) {
      const half = p.halfWidthAt(z);
      for (const x of [-half, half]) {
        const wx = p.position.x + x * Math.cos(p.heading) + z * Math.sin(p.heading);
        const wz = p.position.z - x * Math.sin(p.heading) + z * Math.cos(p.heading);
        // высота кромки: палуба ~ freeboard*0.82-1.0 в локале, повёрнута кватернионом
        const dy = p.preset.freeboard * 0.82 - 1.0;
        // грубая высота с учётом крена/дифферента: вращаем (x, dy, z)
        const q = p.quaternion;
        const vy = dy * (1 - 2*(q.x*q.x + q.z*q.z)) + 2*(x*(q.w*q.x + q.y*q.z) + z*(q.z*q.w - q.x*q.y));
        const py = p.position.y + vy;
        const wy = g.water.heightAt(wx, wz, t);
        const fb = py - wy;
        if (fb < worst) { worst = fb; worstInfo = 'z=' + z.toFixed(1) + ' x=' + x.toFixed(1); }
      }
    }
    return { worst, worstInfo };
  };
  let fbMin = 999, info = '', subT = 0, N = 0, rollMax = 0, amp = 0;
  for (let i = 0; i < 3600; i++) { // 60 c
    t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t);
    const s = sample();
    if (s.worst < fbMin) { fbMin = s.worst; info = s.worstInfo; }
    if (s.worst < -0.1) subT++;
    N++;
    rollMax = Math.max(rollMax, Math.abs(p.euler.z));
    amp = g.hud ? 0 : amp;
  }
  const seaAmp = 0.45 + (g.wind.speed - 3) * 0.085;
  g.debugSetWind(7);
  g.paused = false;
  return JSON.stringify({ fbMinEdge: +fbMin.toFixed(2), where: info,
    subFrac: +(subT / N).toFixed(2), rollMax: +rollMax.toFixed(2),
    wind: +g.wind.speed.toFixed(1), seaAmpClamped: 1.3 });
})()`;
console.log(ev(stormTest));
run('errors');
