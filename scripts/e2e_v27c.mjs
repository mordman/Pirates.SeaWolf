// E2E v27c: крупный план молнии (разряд перед камерой) + усиленный туман.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (r) => {
  try { const v = JSON.parse(r); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return null; }
};
const sea = () => jparse(ev('JSON.stringify(window.__sea)'));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(1500);
ev(`(() => {
  const raw = localStorage.getItem('seawolves.settings.v1');
  let s = raw ? JSON.parse(raw) : {};
  s.weather = { mode: 'storm', windSpeed: 19, windDir: 220 };
  s.graphics = { preset: 'low', drawDistance: 2600, waterDetail: 96, waterChunkSize: 800, waterLodStep: 2, shadows: false, shadowRes: 1024, pixelRatio: 1, foamQuality: 0, waveHeight: 1.3, detailLod: 150 };
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(s));
  return 'ls';
})()`);
run('reload');
await sleep(8000);
run('find text "Поднять флаг" click');
await sleep(12000);
let s = sea();
console.log('storm:', JSON.stringify(s.weather), 'fps', s.fps?.toFixed(1));
shot('v27c_storm_base');

console.log('=== Молния перед камерой ===');
// разряд вдоль луча взгляда камеры (floating origin — от позиции камеры)
const az = parseFloat(ev(`(() => {
  const g = window.__game;
  const e = g.rig.camera.matrixWorld.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10];
  const t = g.rig.camera.position.y / (-fy);
  return Math.atan2(fz, fx);
})()`));
// разряд прямо по взгляду, два расстояния
ev(`(() => { const w = window.__game.weather; w.strike(${az.toFixed(4)}, 150); w.boltLife = 5; w.boltCoreMat.opacity = 1; w.boltGlowMat.opacity = 0.45; return 'held'; })()`);
await sleep(100);
shot('v27c_bolt_near');
await sleep(250);
ev(`(() => { const w = window.__game.weather; w.strike(${az.toFixed(4)}, 300); w.boltLife = 5; w.boltCoreMat.opacity = 1; w.boltGlowMat.opacity = 0.45; return 'held'; })()`);
await sleep(100);
shot('v27c_bolt_far');
await sleep(250);
// двойной удар с мерцанием
ev(`(() => { const w = window.__game.weather; w.strike(${az.toFixed(4)}, 200); w.boltLife = 5; w.boltCoreMat.opacity = 1; w.boltGlowMat.opacity = 0.45; w.flash = 1; return 'held'; })()`);
await sleep(60);
shot('v27c_bolt_flash');
console.log('flashes:', sea().weather.flashes);

console.log('=== Туман (усиленный) ===');
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.weather.mode = 'fog';
  g.applySettings(s);
  g.weather.setMode('fog');
  return 'fog';
})()`);
await sleep(25000);  // фронт тумана наползает
s = sea();
console.log('fog:', JSON.stringify(s.weather));
shot('v27c_fog');
await sleep(6000);
shot('v27c_fog_far');
const errs = run('errors');
console.log('errors:', errs.slice(0, 200));
