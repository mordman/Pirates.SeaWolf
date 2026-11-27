// Task 82: проверка нового шейдера паруса — (1) список uniform'ов
// материала первого паруса (uSeamsN есть = новый код живёт), (2) кадры
// ПРОТИВ СВЕТА (солнце за полотном — просвет) и крупный план ткани.
// Камера — из антисолярной точки через грот (floating origin учтён).
// Запуск: node scripts/t82_sailshot.mjs <tag>
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const tag = process.argv[2] || 'sail';
const out = `/home/z/my-project/scripts/shots/t82_${tag}`;
mkdirSync(out, { recursive: true });

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let outp = runRaw(args);
  for (let i = 0; i < tries && (!outp.trim() || outp.includes('Resource temporarily unavailable') || outp.includes('Cdp command timed out') || outp.includes('Failed to read')); i++) {
    execSync('sleep 12');
    outp = runRaw(args);
  }
  return outp;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

runRaw('close');
run('open http://localhost:3000');
try { run('set viewport 1600 900'); } catch { /* старые версии CLI */ }
await sleep(9000);
for (let i = 0; i < 24; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// 1) uniform'ы первого паруса — жив ли новый шейдер (uSeamsN)
const info = await ev(`(() => {
  const g = window.__game;
  const sails = g.player.visual.sails.sails;
  const s0 = sails && sails[0];
  if (!s0) return 'НЕТ ПАРУСОВ';
  const u = s0.mat.uniforms;
  return JSON.stringify({
    n: sails.length,
    hasSeams: !!u.uSeamsN,
    seamsN: u.uSeamsN ? u.uSeamsN.value : null,
    sun: g.sky ? g.sky.sunDir.toArray().map(v => +v.toFixed(2)) : '?',
  });
})()`);
console.log('sails:', String(info).slice(0, 400));

// 2) кадры из антисолярной точки через грот: contrejour (общий) и
//    cloth_close (крупно) + вид сверху-сбоку на оба паруса
await ev(`(() => {
  const g = window.__game;
  g.player.wind.speed = 11; g.player.wind.from = 1.2;
  g.player.sailTarget = 3; g.player.sailOverride = 1;
  g.player.velocity.set(0, 0, 0);
  g.paused = true; g.rig.update = () => {};
  const cv = document.querySelector('canvas');
  const anc = new Set(); let e = cv; while (e) { anc.add(e); e = e.parentElement; }
  for (const el of document.body.querySelectorAll('*')) if (!anc.has(el)) el.style.display = 'none';
  return 1;
})()`);;
const shotFrom = async (name, dist, up, lookUp, lookFwd) => {
  await ev(`(() => {
  const g = window.__game, T = window.__THREE;
  const c = g.rig.camera;
  const s0 = g.player.visual.sails.sails[0];
  s0.mesh.updateWorldMatrix(true, false);
  const m = new T.Vector3(); s0.mesh.getWorldPosition(m);
  const s = g.sky.sunDir.clone(); s.y = 0;
  if (s.lengthSq() < 1e-4) s.set(1, 0, 0); s.normalize();
  c.position.copy(m).addScaledVector(s, -${dist});
  c.position.y += ${up};
  c.lookAt(m.x + s.x * ${lookFwd}, m.y + ${lookUp}, m.z + s.z * ${lookFwd});
  c.updateMatrixWorld();
  return 'ok';
})()`);
  await sleep(900);
  run(`screenshot ${out}/${name}.png`);
  console.log('кадр', name);
};
await shotFrom('contrejour', 11, 3.5, 1.0, 2.5);
await shotFrom('cloth_close', 4.6, 0.6, 0.4, 0.8);
await shotFrom('sail_hi', 14, 7, -1.0, 3.0);
console.log('готово:', out);
