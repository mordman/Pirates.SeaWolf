// E2E v22c: быстрая съёмка — трупы сразу после залпа картечи (сбоку-ближе),
// гибы в воздухе сразу после попадания ядра
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (r) => {
  try { const v = JSON.parse(r); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return null; }
};
const sea = () => jparse(ev('JSON.stringify(window.__sea)'));
const num = (js) => parseFloat(ev(js));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const key = (code, ms = 120) => {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))"`);
  return sleep(ms).then(() =>
    run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))"`));
};
const faceEast = 'window.__game.player.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2)';
const teleportNorth = (dx) => `(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x, 0, t.position.z - ${dx}); ${faceEast}; g.player.velocity.set(0,0,0); return 'ok'; })()`;
const aim = (az, el) => ev(`(() => { const a = window.__game.combat.aim; a.azimuth = ${az}; a.elevation = ${el}; return 'ok'; })()`);
const volley = async () => {
  for (let i = 0; i < 60; i++) {
    const r = num('window.__game.combat.readiness()');
    if (r >= 0.999) break;
    await sleep(1500);
  }
  await key('Space');
  await sleep(1200);
};

console.log('=== Вход в полигон ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear');
run('find text "Полигон разрушений" click');
await sleep(8000);

console.log('=== Трупы: картечь с 42 м, скриншот сразу ===');
ev(teleportNorth(42));
await sleep(2200);
await key('KeyE'); await sleep(600);
await key('Digit3'); await sleep(300);
aim(0, 0.045);
ev('(() => { const g = window.__game; g.rig.dist.iso = 34; return "ok"; })()');
await sleep(1500);
await volley();
await sleep(3500); // попадание + падение трупов (0.5 игровых с)
await shot('v22c_corpses_fresh');
let s = sea();
console.log('трупы:', JSON.stringify({ dead: s.tgtCrewDead, shown: s.tgtShown, hull: s.tgtHull }));
// ещё ближе, вид сбоку на палубу
ev(teleportNorth(17));
ev('(() => { const g = window.__game; g.rig.dist.iso = 21; return "ok"; })()');
await sleep(2800);
await shot('v22c_corpses_close');
s = sea();
console.log('после сближения:', JSON.stringify({ dead: s.tgtCrewDead, shown: s.tgtShown }));

console.log('=== Гибы: сброс, ядро с 55 м по палубе ===');
run('find text "⟳ Восстановить" click');
await sleep(2500);
ev(teleportNorth(55));
await sleep(2000);
await key('KeyE'); await sleep(600);
await key('Digit1'); await sleep(300);
aim(0.08, 0.04);
ev('(() => { const g = window.__game; g.rig.dist.iso = 36; return "ok"; })()');
await sleep(1200);
await volley();
await sleep(2600); // попадание + гибы в полёте
await shot('v22c_gibs_fresh');
s = sea();
console.log('гиб-момент:', JSON.stringify({ dead: s.tgtCrewDead, shown: s.tgtShown, gibs: s.gibsAlive }));
await sleep(1500);
await shot('v22c_gibs_late');
s = sea();
console.log('позже:', JSON.stringify({ gibs: s.gibsAlive, dead: s.tgtCrewDead }));

const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
