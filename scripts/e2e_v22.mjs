// E2E v22: (1) дым выстрела существенно меньше; (2) экипаж противника
// поражается: ядра РАЗРЫВАЮТ (гибы + кровь), картечь ВАЛИТ (трупы).
// В headless игровое время растянуто — ждём readiness() перед залпами.
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
const teleportNear = (dx) => `(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x - ${dx}, 0, t.position.z); ${faceEast}; g.player.velocity.set(0,0,0); return 'ok'; })()`;
const teleportBase = `(() => { const g = window.__game; g.player.position.set(2300, 0, 2300); ${faceEast}; g.player.velocity.set(0,0,0); return 'ok'; })()`;
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
const waitCrewDead = async (secs, step = 2000) => {
  for (let i = 0; i < secs / 2; i++) {
    await sleep(step);
    const s = sea();
    if (s && s.tgtCrewDead > 0) return s;
  }
  return sea();
};

console.log('=== 1. Загрузка и вход в Полигон ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');
run('find text "Полигон разрушений" click');
await sleep(8000);
let s = sea();
console.log('полигон:', s ? JSON.stringify({ proving: s.proving, dist: s.tgtDist, tgtShown: s.tgtShown, tgtCrewDead: s.tgtCrewDead, gibs: s.gibsAlive }) : 'НЕТ ТЕЛЕМЕТРИИ');
if (!s || s.proving !== 1) { console.log('FAIL: полигон не активен'); }

console.log('=== 2. Дым выстрела (должен быть небольшим) ===');
await key('KeyE');
await sleep(800);
await key('Digit1');
await sleep(300);
aim(0, 0.03);
await volley();
await sleep(1000); // поймать вспышку и лёгкий дым
await shot('v22_smoke_small');
await sleep(5000); // снаряды долетают
s = sea();
console.log('после залпа:', JSON.stringify({ crewDead: s.tgtCrewDead, shown: s.tgtShown, gibs: s.gibsAlive, hull: s.tgtHull }));

console.log('=== 3. Ядра по палубе: разрыв экипажа (гибы + кровь) ===');
let gibbed = false;
for (const el of [0.034, 0.04, 0.046, 0.052]) {
  aim(0.08, el);
  await volley();
  await sleep(4500);
  s = sea();
  console.log(`elev ${el}: убито ${s.tgtCrewDead}, живых ${s.tgtShown}, гибов ${s.gibsAlive}, корпус ${(s.tgtHull * 100).toFixed(0)}%`);
  if (s.tgtCrewDead > 0) { gibbed = true; break; }
}
if (gibbed) {
  // поймать гибы в воздухе: подлететь ближе, скриншот
  ev(teleportNear(45));
  ev('(() => { const g = window.__game; g.rig.dist.iso = 42; return "ok"; })()');
  await sleep(2500);
  await shot('v22_gibs_flying');
  console.log('гибов в кадре:', sea().gibsAlive);
}

console.log('=== 4. Сброс: экипаж должен ожить ===');
run('find text "⟳ Восстановить" click');
await sleep(3000);
s = sea();
console.log('после сброса:', JSON.stringify({ crewDead: s.tgtCrewDead, shown: s.tgtShown, hull: s.tgtHull, masts: s.tgtMastsBroken }));
console.log(s.tgtCrewDead === 0 && s.tgtShown > 0 ? 'RESET OK ✓' : 'RESET FAIL ✗');

console.log('=== 5. Картечь с 85 м: экипаж валится трупами ===');
ev(teleportNear(85));
await sleep(2500);
await key('Digit3');
await sleep(300);
aim(0, 0.03);
await volley();
s = await waitCrewDead(40);
console.log('после картечи:', JSON.stringify({ crewDead: s.tgtCrewDead, shown: s.tgtShown, crew: s.tgtCrew, dist: s.tgtDist }));
console.log(s.tgtCrewDead > 0 ? 'КАРТЕЧЬ КОСИТ ЭКИПАЖ ✓' : 'КАРТЕЧЬ НЕ ПОРАЗИЛА ✗');
// трупы крупно
await volley(); // ещё залп для верности
await sleep(6000);
ev(teleportNear(26));
ev('(() => { const g = window.__game; g.rig.dist.iso = 30; return "ok"; })()');
await sleep(3000);
await shot('v22_corpses_deck');
s = sea();
console.log('трупы на палубе: dead =', s.tgtCrewDead, ', живых =', s.tgtShown);

console.log('=== 6. Регресс: обычный режим, экипаж цел ===');
run('find text "✕ Выйти" click');
await sleep(3500);
s = sea();
console.log('после выхода:', JSON.stringify({ proving: s.proving, crewShown: s.crewShown, crewDead: s.crewDead, gibs: s.gibsAlive }));

console.log('=== 7. Ошибки ===');
const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
