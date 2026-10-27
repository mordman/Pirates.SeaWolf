// E2E v9: куда смещается мир на экране при D (панорама мира) + где камера
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);

run('reload'); run('wait 6000');
run("find text \"Поднять флаг\" click");
run("wait 2500");

const test = `
(() => {
  const g = window.__game, p = g.player, rig = g.rig, cam = rig.camera;
  const V = (x,y,z) => new p.position.constructor(x,y,z);
  // стабилизируем: скорость по курсу, глубокая вода
  g.paused = true;
  p.anchored = false; p.sailTarget = 3;
  p.position.set(315, 0, 620); // спавн, глубокая вода
  p.velocity.set(0,0,0); p.angular.set(0,0,0);
  p.quaternion.setFromEuler(new p.euler.constructor(0, 2.0, 0, 'YXZ'));
  let t = 0;
  for (let i = 0; i < 1200; i++) { t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); }
  const upd = () => rig.update(1/60, {active:false,side:1,dir:p.forward},
    { scenePos: p.position, heading: p.heading, roll: p.euler.z, pitch: p.euler.x, speedFrac: 0.5 },
    { mouseDX:0, mouseDY:0, wheel:0, rmb:false });
  for (let i = 0; i < 600; i++) upd();
  // камера позади корабля?
  const camOff = V(cam.position.x - p.position.x, 0, cam.position.z - p.position.z).normalize();
  const f = p.forward;
  const behindDot = camOff.x * f.x + camOff.z * f.z; // <0 = камера позади
  // ориентир: далёкий остров — проекция в NDC
  const isl = g.world.islands[0];
  const land = V(isl.cx, 8, isl.cz);
  const proj = () => {
    const v = land.clone().project(cam);
    return { x: +v.x.toFixed(3), y: +v.y.toFixed(3) };
  };
  const before = proj();
  const cmp0 = ((-p.heading*180/Math.PI)%360+360)%360;
  // D 8 секунд
  p.rudderTarget = 1;
  let sxMin = 9, sxMax = -9;
  for (let i = 0; i < 480; i++) {
    t += 1/60; g.updateWeather(1/60); p.fixedStep(1/60, t); upd();
    const v = land.clone().project(cam);
    sxMin = Math.min(sxMin, v.x); sxMax = Math.max(sxMax, v.x);
  }
  p.rudderTarget = 0;
  const after = proj();
  const cmp1 = ((-p.heading*180/Math.PI)%360+360)%360;
  // нос на экране: проекция точки перед носом
  const bow = p.position.clone().addScaledVector(f, 20); const bv = bow.clone().project(cam);
  g.paused = false;
  return JSON.stringify({
    behindDot: +behindDot.toFixed(2),
    islandX: { before: before.x, after: after.x, min: +sxMin.toFixed(2), max: +sxMax.toFixed(2) },
    compass: { before: Math.round(cmp0), after: Math.round(cmp1) },
    bowScreenX: +bv.x.toFixed(2),
    speed: +p.speedKnots().toFixed(1),
  });
})()`;
console.log(ev(test));
run('errors');
