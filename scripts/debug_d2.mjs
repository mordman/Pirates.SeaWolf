// Дебаг D2: спавн ядра в подготовленную пробоину — трассировка полёта.
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

runRaw('close'); runRaw('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`); await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(500);

// подготовка: цель = первый ИИ-корабль, якорь, пробоина
const prep = ev(`(() => {
  const g = window.__game; const T = window.__THREE;
  g.player.wind.speed = 3; g.stepDebugNR(3);
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  t.clearDamage();
  t.anchored = true; t.sailTarget = 0; t.sailOverride = null;
  t.velocity.set(0, 0, 0); t.angular.set(0, 0, 0);
  const Lz = t.preset.length;
  const mastsZ = t.visual.masts.map(m => +m.position.z.toFixed(1));
  const zh = Math.min(Lz * 0.32, mastsZ[0] - 3);
  const hw = Math.max(1.5, t.halfWidthAt(zh));
  const lp = new T.Vector3(hw * 0.95, 2.0, zh);
  for (let i = 0; i < 3; i++) t.hitHull(lp.clone(), 46, false);
  window.__t = t; window.__lp = lp;
  window.__hitLog2 = [];
  g.bus.on('projectile:hit', e => window.__hitLog2.push({ t: e.target.preset.id, y: +e.pos.y.toFixed(1) }));
  g.combat.punchLog.length = 0;
  // цель в combat.others?
  const inOthers = g.combat.others.includes(t);
  // расстояние от игрока до цели
  const dist = t.position.distanceTo(g.player.position);
  const hole = lp.clone().applyQuaternion(t.quaternion).add(t.position);
  window.__hole = hole;
  const fromLp = new T.Vector3(lp.x + 55, lp.y + 1.4, lp.z);
  const from = fromLp.applyQuaternion(t.quaternion).add(t.position);
  const dir = hole.clone().sub(from); dir.y += 0.75;
  window.__from = from; window.__dir = dir;
  const ok = g.combat.debugSpawnBall(from, dir, 175);
  window.__trace = [];
  return JSON.stringify({ id: t.preset.id, L: Lz, mastsZ, zh: +zh.toFixed(1), inOthers, dist: +dist.toFixed(1),
    open: +t.plankSideOpen(lp.clone()).toFixed(2), spawned: ok,
    from: [ +from.x.toFixed(1), +from.y.toFixed(1), +from.z.toFixed(1) ],
    hole: [ +hole.x.toFixed(1), +hole.y.toFixed(1), +hole.z.toFixed(1) ] }); })()`);
console.log('PREP: ' + prep);

// трассировка: 12 шагов по 0.1 с — позиции ядра и статус
for (let k = 0; k < 12; k++) {
  const out = ev(`(() => {
    const g = window.__game;
    const pr = g.combat.projectiles.find(q => q.active);
    g.stepDebugNR(0.05);
    const t = window.__t; const T = window.__THREE;
    const pr2 = g.combat.projectiles.find(q => q.active);
    const wy = g.player.world ? null : null;
    return JSON.stringify({
      k: ${k},
      pos: pr2 ? [+pr2.pos.x.toFixed(1), +pr2.pos.y.toFixed(1), +pr2.pos.z.toFixed(1)] : null,
      was: pr ? [+pr.pos.x.toFixed(1), +pr.pos.y.toFixed(1), +pr.pos.z.toFixed(1)] : null,
      vel: pr2 ? +pr2.vel.length().toFixed(0) : null,
      tp: [+t.position.x.toFixed(1), +t.position.y.toFixed(1), +t.position.z.toFixed(1)],
      keel: +t.keelHP.toFixed(0), s3: t.plankHull.byState().s3,
      sinking: t.sinking, hullBroke: t.hullBroke,
      hits: window.__hitLog2, punchLog: g.combat.punchLog.slice(),
      exitOpen: +t.plankSideOpen(new T.Vector3(-1, 2.0, window.__lp.z)).toFixed(2),
    }); })()`);
  console.log(out);
}
runRaw('close');
