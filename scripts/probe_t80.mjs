// Task 80 ПРОБА: (A) все паруса на дощатых пресетах — скриншоты носа,
// состояние парусов (uFurl/brace/belly); (C) «Чёрная жемчужина» как
// корабль игрока — капитан/lander.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });

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

// ================= (A) ВСЕ ПАРУСА — НОС =================
const presets = ['frigate', 'galleon', 'victory', 'soleil', 'blackpearl'];
for (const id of presets) {
  const st = jparse(await evR(`(() => {
    const g = window.__game; g.changeShip('${id}', true);
    g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(4);
    const v = g.player.visual;
    const sails = v.sails.sails.map(s => ({
      sq: s.square, furl: +s.mat.uniforms.uFurl.value.toFixed(3),
      brace: s.brace ? +s.braceAngle.toFixed(2) : null,
      belly: +s.mat.uniforms.uBelly.value.toFixed(2),
      mast: s.mastIndex, setAt: s.setAt,
      pv: [+(s.quad.pivot.y).toFixed(1), +(s.quad.pivot.z).toFixed(1)],
      c2z: +(s.quad.pivot.z + s.quad.corners[2].z).toFixed(1),
    }));
    return JSON.stringify({ id, L: g.player.preset.length, heading: +g.player.heading.toFixed(2), sails }); })()`));
  console.log(`${id}: ` + JSON.stringify(st));
  // боковой ракурс носа
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + Math.PI / 2); g.rig.freeElevSet(0.06); g.rig.distSet(30);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t80_${id}_side.png`);
  // нос-траверз, ближе
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + 0.55); g.rig.freeElevSet(0.10); g.rig.distSet(26);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t80_${id}_front.png`);
  // вид строго сверху-спереди на нос (где кливера над штевнем)
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(g.player.heading + 0.9); g.rig.freeElevSet(0.35); g.rig.distSet(22);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t80_${id}_top.png`);
}

// ================= (C) «ЧЁРНАЯ ЖЕМЧУЖИНА» = КАПИТАН-ИГРОК =================
const capInfo = jparse(await evR(`(() => {
  const g = window.__game; g.changeShip('blackpearl', true);
  g.stepDebugNR(2);
  const cap = g.player.crew3d ? g.player.crew3d.captainInfo() : null;
  // зелёные emissive-меши в группе капитана
  let glow = 0; const capFig = g.player.crew3d?.group;
  if (capFig) capFig.traverse(o => { const m = o.material; if (m && m.emissive && m.emissive.getHex() === 0x1e8f3e) glow++; });
  return JSON.stringify({ cap, glow, detailed: g.settings.graphics.crewDetail }); })()`));
console.log('BLACKPEARL captain: ' + JSON.stringify(capInfo));

// скриншот капитана-игрока на «Жемчужине»
ev(`(() => { const g = window.__game; g.setCameraMode('free');
  g.rig.freeAzimSet(g.player.heading + 2.4); g.rig.freeElevSet(0.12); g.rig.distSet(14);
  g.stepDebug(0.3); return 1; })()`);
run(`screenshot scripts/shots/t80_blackpearl_captain.png`);

// прогулка по палубе (V) — фигурка игрока: оружие, клинок
const walk = jparse(await evR(`(() => {
  const g = window.__game;
  // V — прогулка по палубе
  g.lander.beginDeck ? g.lander.beginDeck() : null;
  g.stepDebugNR(1);
  const hud = g.lander ? g.lander.hud() : null;
  return JSON.stringify({ hud }); })()`));
console.log('DECK WALK: ' + JSON.stringify(walk));
run(`screenshot scripts/shots/t80_blackpearl_walk.png`);

console.log('DONE');
runRaw('close');
