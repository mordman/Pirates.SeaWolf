// Task 80 ПРОБА v2: ВСЕ ПАРУСА ПРИНУДИТЕЛЬНО (sailOverride=1) — телеметрия
// uFurl/brace/belly + скриншоты носа дощатых пресетов.
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);

const presets = ['frigate', 'galleon', 'victory', 'soleil', 'blackpearl'];
for (const pid of presets) {
  const st = jparse(await evR(`(() => {
    const g = window.__game; g.changeShip('${pid}', true);
    g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.player.sailOverride = 1;
    g.stepDebugNR(3.5);
    const v = g.player.visual;
    const sails = v.sails.sails.map(s => ({
      sq: s.square, furl: +s.mat.uniforms.uFurl.value.toFixed(3),
      brace: s.brace ? +s.braceAngle.toFixed(2) : null,
      belly: +s.mat.uniforms.uBelly.value.toFixed(2),
      setAt: s.setAt,
      pv: [+(s.quad.pivot.y).toFixed(1), +(s.quad.pivot.z).toFixed(1)],
      c1z: +(s.quad.pivot.z - s.quad.corners[1].z).toFixed(1),
      c2z: +(s.quad.pivot.z + s.quad.corners[2].z).toFixed(1),
      c2y: +(s.quad.pivot.y + s.quad.corners[2].y).toFixed(1),
    }));
    return JSON.stringify({ name: '${pid}', L: g.player.preset.length, hdg: +g.player.heading.toFixed(2), sails }); })()`));
  console.log(`${pid}: ` + JSON.stringify(st));
  // ракурсы носа
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + Math.PI / 2); g.rig.freeElevSet(0.06); g.rig.distSet(30);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t80v2_${pid}_side.png`);
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + 0.55); g.rig.freeElevSet(0.10); g.rig.distSet(26);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t80v2_${pid}_front.png`);
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + 0.9); g.rig.freeElevSet(0.38); g.rig.distSet(20);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t80v2_${pid}_top.png`);
}
console.log('DONE');
runRaw('close');
