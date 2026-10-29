// E2E v18: Полигон разрушений — стрельба, повреждения, экипаж
// ВАЖНО: в headless игровое время растянуто (низкий rAF) — перед каждым
// залпом ждём ГОТОВНОСТЬ ОРУДИЙ через combat.readiness(), а не фиксированные паузы.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
// agent-browser печатает результат eval в JSON-виде — парсим дважды с фолбэком
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
/** залп: ждать перезарядку всех орудий (готовность 100%), затем Space */
const volley = async () => {
  for (let i = 0; i < 60; i++) {
    const r = num('window.__game.combat.readiness()');
    if (r >= 0.999) break;
    await sleep(1500);
  }
  await key('Space');
  await sleep(1200);
};

console.log('=== 1. Загрузка и вход в Полигон ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');
run('find text "Полигон разрушений" click');
await sleep(8000);
let s = sea();
console.log('полигон:', s ? JSON.stringify({ proving: s.proving, dist: s.tgtDist, hull: s.tgtHull, sea: s.seaAmp, crewShown: s.crewShown, tgtShown: s.tgtShown }) : 'НЕТ ТЕЛЕМЕТРИИ');
if (!s || s.proving !== 1) { console.log('FAIL: полигон не активен'); }

// экипаж игрока крупно: камера кормы
run(`eval "(() => { const g = window.__game; while (g.rig.mode !== 'rear') g.rig.cycleMode(); return g.rig.mode; })()"`);
await sleep(3500);
await shot('v18_crew_player_rear');

// экипаж мишени: подплыть ближе телепортом (мишень на якоре)
ev(teleportNear(60));
await sleep(3000);
await shot('v18_crew_target_close');

// вернуть игрока на позицию стрельбы
ev(teleportBase);
await sleep(2500);

console.log('=== 2. Прицел правого борта + ядра, 2 залпа ===');
await key('KeyE'); // прицел правый борт (мишень там)
await sleep(800);
await key('Digit1'); // ядра
await sleep(300);
await volley(); // залп в полёте — скриншот
await sleep(400);
await shot('v18_volley_inflight');
await volley();
s = sea();
console.log('после 2 залпов ядрами:', JSON.stringify({ hull: s.tgtHull, holes: s.tgtHoles, water: s.tgtWater, masts: s.tgtMastsBroken, crew: s.tgtCrew }));

console.log('=== 3. Книппели по мачтам (азимут на фок-мачту) ===');
aim(0.04, 0.10); // цель: фок-мачта мишени (z_local ≈ +6.5)
await key('Digit2');
for (let i = 0; i < 3; i++) {
  await volley();
  s = sea();
  console.log(`залп книппелями ${i + 1}: мачт сломано ${s.tgtMastsBroken}, паруса ${s.tgtWater === undefined ? '' : ''}`);
  if (s.tgtMastsBroken >= 1) break;
}
// крупный план мишени с упавшей мачтой
ev(teleportNear(55));
await sleep(3000);
await shot('v18_mast_broken');
ev(teleportBase);
await sleep(2000);

console.log('=== 4. Ядра по ватерлинии: затопление ===');
aim(0, 0.018); // пологая траектория — удары у самой воды
await key('Digit1');
let volleys = 0;
while (volleys < 8) {
  await volley();
  volleys++;
  s = sea();
  console.log(`залп ${volleys}: корпус ${(s.tgtHull * 100).toFixed(0)}%, вода ${(s.tgtWater * 100).toFixed(0)}%, пробоин ${s.tgtHoles}, тонет ${s.tgtSinking}`);
  if (s.tgtSinking === 1 || s.tgtSunk === 1) break;
}
// тонущая мишень крупно
ev(teleportNear(60));
await sleep(4000);
await shot('v18_sinking');
for (let i = 0; i < 20; i++) {
  s = sea();
  if (s.tgtSunk === 1) break;
  await sleep(2000);
}
s = sea();
console.log('финал мишени:', JSON.stringify({ sunk: s.tgtSunk, sinking: s.tgtSinking, hull: s.tgtHull }));

console.log('=== 5. Восстановление и ответный огонь ===');
run('find text "⟳ Восстановить" click');
await sleep(2500);
s = sea();
console.log('после сброса:', JSON.stringify({ hull: s.tgtHull, masts: s.tgtMastsBroken, holes: s.tgtHoles, crew: s.tgtCrew, shown: s.tgtShown }));
run('find text "Мишень не стреляет" click'); // включить ответный огонь
await sleep(1000);
console.log('ответный огонь включён:', ev('window.__game.pgTarget.returnFire'));
// мишень стреляет раз в ~13-19 игровых секунд: ждём до попадания (до 90с)
const pH0 = num('window.__game.player.hullHP');
let hitPlayer = false;
for (let i = 0; i < 45; i++) {
  await sleep(2000);
  const h = num('window.__game.player.hullHP');
  if (h < pH0 - 0.5) { hitPlayer = true; break; }
}
console.log(`корпус игрока: ${pH0} → ${num('window.__game.player.hullHP')} (ответный огонь ${hitPlayer ? 'ПОПАДАЕТ' : 'не попал за 90с'})`);

console.log('=== 6. Смена модели мишени и выход ===');
run('find text "Бриг" click');
await sleep(2500);
console.log('модель мишени теперь:', ev('window.__game.pgTarget.ship.preset.id'));
run('find text "✕ Выйти" click');
await sleep(3000);
s = sea();
console.log('после выхода: proving =', s.proving, '| игрок у гавани? x =', s.x.toFixed(0), 'z =', s.z.toFixed(0));

console.log('=== 7. Ошибки ===');
const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'ОШИБОК НЕТ' : errs);
