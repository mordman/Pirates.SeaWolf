// E2E v22b: картечь с近距离 45 м — экипаж должен валиться трупами
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
// игрок СЕВЕРНЕЕ мишени на dx: мишень на +Z = правый траверз (курс восток)
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
let s = sea();
console.log('старт:', JSON.stringify({ proving: s.proving, shown: s.tgtShown, dead: s.tgtCrewDead }));

console.log('=== Картечь с 45 м, elevation 0.045 ===');
ev(teleportNorth(45));
await sleep(2500);
await key('KeyE');
await sleep(700);
await key('Digit3');
await sleep(300);
aim(0, 0.045);
await volley();
await sleep(5000);
s = sea();
console.log('после 1 залпа:', JSON.stringify({ dead: s.tgtCrewDead, shown: s.tgtShown, crew: s.tgtCrew, hull: s.tgtHull, dist: s.tgtDist }));
if (s.tgtCrewDead === 0) {
  // вторая попытка: чуть выше
  aim(0, 0.06);
  await volley();
  await sleep(5000);
  s = sea();
  console.log('после 2 залпа (elev 0.06):', JSON.stringify({ dead: s.tgtCrewDead, shown: s.tgtShown, hull: s.tgtHull }));
}
console.log(s.tgtCrewDead > 0 ? 'КАРТЕЧЬ КОСИТ ЭКИПАЖ ✓' : 'КАРТЕЧЬ НЕ ПОРАЗИЛА ✗');

// ещё залп для массы трупов + крупный план палубы
await volley();
await sleep(6000);
ev(teleportNorth(22));
ev('(() => { const g = window.__game; g.rig.dist.iso = 28; return "ok"; })()');
await sleep(3500);
await shot('v22_corpses_deck');
s = sea();
console.log('трупы на палубе: dead =', s.tgtCrewDead, ', живых =', s.tgtShown);

const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
