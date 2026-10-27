import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);

run('reload'); run('wait 7000');
run("find text \"Поднять флаг\" click");
run('wait 2500');

ev(`(() => {
  const g = window.__game, p = g.player;
  g.paused = true;
  g.debugSetWind(9); p.anchored = false; p.sailTarget = 3;
  p.position.set(0, 0, 1500); p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.quaternion.setFromEuler(new p.euler.constructor(0, 2.37, 0, 'YXZ'));
  let t = 0;
  for (let i = 0; i < 3600; i++) {
    t += 1/60;
    if (i % 45 === 0) g.debugSetWind(9);
    g.updateWeather(1/60); p.fixedStep(1/60, t); p.updateVisual(t, 1/60, g.particles);
    if (i % 10 === 0) p.angular.y *= 0.3;
  }
  const info = p.visual.sails.sails.map(s => ({
    sq: !!s.square, furl: +s.furl.toFixed(2),
    uBelly: +s.mat.uniforms.uBelly.value.toFixed(2),
    uFlutter: +s.mat.uniforms.uFlutter.value.toFixed(3),
    uSun: s.mat.uniforms.uSunDir.value.toArray().map(v => +v.toFixed(2)),
    brace: s.brace ? +s.braceAngle.toFixed(2) : null,
  }));
  g.__pin = setInterval(() => g.debugSetWind(9), 700);
  g.paused = false;
  return JSON.stringify(info);
})()`);
await sleep(4000);
run("eval \"for(let i=0;i<8;i++) document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))\"");
await sleep(2000);
run(`screenshot scripts/shots/v15_sails_zoom.png`);
console.log('shot: v15_sails_zoom.png');
ev(`clearInterval(window.__game.__pin); window.__game.debugSetWind(7);`);
run('errors');
