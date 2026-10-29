// E2E Task 31: три жалобы пользователя:
//  (A) начальный боезапас — новые дефолты 90/30/60/20 + миграция старых
//      сохранений (без v → сброс на дефолты, прочие настройки сохраняются);
//  (B) корабль идёт ПОВЕРХНОСТЬЮ волн в шторм: палуба (включая форштевень
//      ±0.46L) не ныряет под гребень, киль не глубже 0.55·осадки в волне,
//      дифферент живой (нос всходит на передний склон);
//  (C) вооружённый ИИ при нападении ОТСТРЕЛИВАЕТСЯ (route → combat + залпы).
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 90000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const clickBtn = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}')); if (b) { b.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
const pageErrors = () => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
};
const freshGame = async (label) => {
  run('open http://localhost:3000/');
  await sleep(1500);
  ev(`localStorage.removeItem('seawolves.settings.v1')`);
  run('reload');
  await sleep(8000);
  const c = clickBtn('Поднять флаг');
  await sleep(2500);
  log(`${label}: старт:`, c);
};

// ============ Фаза A: начальный боезапас + миграция ============
log('=== A: начальный боезапас ===');
await freshGame('A1');
const ammoDef = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ammo: g.player.ammo, sets: g.settings.gameplay.startingAmmo}); })()`));
log('A: дефолт:', JSON.stringify(ammoDef));
check('A: дефолтный боезапас игрока 90/30/60/20',
  ammoDef.ammo && ammoDef.ammo.ball === 90 && ammoDef.ammo.chain === 30 && ammoDef.ammo.grape === 60 && ammoDef.ammo.fire === 20,
  JSON.stringify(ammoDef.ammo));
check('A: настройки содержат те же значения', ammoDef.sets && ammoDef.sets.ball === 90, JSON.stringify(ammoDef.sets));
const errsA = pageErrors();
check('A: нет ошибок страницы', errsA === '', errsA.slice(0, 200));

// миграция: старое сохранение без версии схемы → боезапас сбросится на новые
// дефолты, а ДРУГИЕ настройки (ветер) сохранятся
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.setItem('seawolves.settings.v1', JSON.stringify({weather:{windDir:123}, gameplay:{startingAmmo:{ball:40,chain:12,grape:20,fire:8}}}))`);
run('reload'); await sleep(8000);
clickBtn('Поднять флаг');
await sleep(2500);
const mig = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({sets: g.settings.gameplay.startingAmmo, windDir: g.settings.weather.windDir, raw: localStorage.getItem('seawolves.settings.v1')}); })()`));
log('A: миграция:', JSON.stringify({ sets: mig.sets, windDir: mig.windDir, hasV: typeof mig.raw === 'string' && mig.raw.includes('"v":2') }));
check('A: старое сохранение мигрировано на 90/30/60/20',
  mig.sets && mig.sets.ball === 90 && mig.sets.grape === 60, JSON.stringify(mig.sets));
check('A: прочие настройки сохранены (windDir 123)', mig.windDir === 123, `windDir=${mig.windDir}`);
check('A: localStorage перезаписан с v:2', typeof mig.raw === 'string' && mig.raw.includes('"v":2'));
const errsA2 = pageErrors();
check('A2: нет ошибок страницы', errsA2 === '', errsA2.slice(0, 200));

// ============ Фаза B: шторм — корабль идёт ПОВЕРХНОСТЬЮ волн ============
log('=== B: шторм, корабль на гребнях ===');
await freshGame('B');
// телепорт в глубокую воду, курс ПРОТИВ хода волн (волны идут вдоль (1,0.25),
// нос — навстречу: направление (-0.97,-0.24))
const tpRes = ev(`(() => {
  const g = window.__game, p = g.player;
  // ищем глубокую воду (дно ниже -10 м — вдали от отмелей) в открытом море
  let spot = null;
  outer: for (const z of [-2200, -1400, 700, 1500, 2400]) {
    for (const x of [-1800, -900, 0, 900, 1800]) {
      if (p.terrainHeight(x, z) < -10) { spot = [x, z]; break outer; }
    }
  }
  if (!spot) return 'NO DEEP WATER';
  p.position.set(spot[0], 0.5, spot[1]);
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
  const yaw = Math.atan2(-0.9701, -0.2425);
  p.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  p.sailTarget = 3;
  g.rig.snap();
  g.debugSetWeather('storm', 22, 40);
  // рекордер: палуба (из __sea, теперь ±0.46L) + заглубление киля на 3 станциях
  window.__rec = { minFb: 99, maxRoll: 0, maxPitch: 0, maxDig: -99, digAt: 0, n: 0, spot };
  window.__recIv = setInterval(() => {
    const g2 = window.__game, s = window.__sea;
    if (!g2 || !s) return;
    const p2 = g2.player, q = p2.quaternion;
    const L = p2.preset.length, D = p2.preset.draft;
    const rot = (x, y, z) => {
      const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
      const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
      return { x: x + qw * tx + (qy * tz - qz * ty), y: y + qw * ty + (qz * tx - qx * tz), z: z + qw * tz + (qx * ty - qy * tx) };
    };
    for (const fr of [-0.46, 0, 0.46]) {
      const k = rot(0, -0.9 * D, fr * L);
      const wh = g2.waterHeight(p2.position.x + k.x, p2.position.z + k.z);
      const dig = wh - (p2.position.y + k.y);
      if (dig > window.__rec.maxDig) { window.__rec.maxDig = dig; window.__rec.digAt = fr; }
    }
    window.__rec.minFb = Math.min(window.__rec.minFb, s.freeboard);
    window.__rec.maxRoll = Math.max(window.__rec.maxRoll, Math.abs(s.roll));
    window.__rec.maxPitch = Math.max(window.__rec.maxPitch, Math.abs(s.pitch));
    window.__rec.n++;
  }, 90);
  return 'OK ' + JSON.stringify(spot);
})()`);
log('B: телепорт:', String(tpRes).slice(0, 120));
check('B: глубокая вода найдена, телепорт выполнен', String(tpRes).includes('OK '), String(tpRes).slice(0, 80));
run('press w');
await sleep(32000);
const rec = jparse(ev(`JSON.stringify(window.__rec)`));
const seaB = jparse(ev(`(() => { const s = window.__sea; return JSON.stringify({amp: +s.seaAmp.toFixed(2), fb: +s.freeboard.toFixed(2), spd: +s.speed.toFixed(1), pitch: +s.pitch.toFixed(3)}); })()`));
ev(`clearInterval(window.__recIv)`);
const DRAFT = 2.2; // шлюп «Бриз»
log('B: рекорд:', JSON.stringify(rec));
log('B: море:', JSON.stringify(seaB));
check('B: палуба (вкл. форштевень) не ныряет под гребень (fb >= 0.05)', rec && rec.minFb >= 0.05, `minFb=${rec && rec.minFb && rec.minFb.toFixed(2)}`);
check('B: киль в воде до нормальной осадки (не парит над водой)', rec && rec.maxDig >= 1.4, `maxDig=${rec && rec.maxDig && rec.maxDig.toFixed(2)} м (норма ~1.76)`);
check('B: киль не глубже 1.3·осадки в гребне (сквозь корпус не проходит)', rec && rec.maxDig <= 0.8 * DRAFT + 0.5 * DRAFT, `maxDig=${rec && rec.maxDig && rec.maxDig.toFixed(2)} м (лимит ${(0.8 * DRAFT + 0.5 * DRAFT).toFixed(2)})`);
check('B: дифферент живой — нос всходит на склоны (pitch >= 0.05)', rec && rec.maxPitch >= 0.05, `maxPitch=${rec && rec.maxPitch && rec.maxPitch.toFixed(3)}`);
check('B: крен в норме (< 0.45 рад)', rec && rec.maxRoll < 0.45, `maxRoll=${rec && rec.maxRoll && rec.maxRoll.toFixed(2)}`);
check('B: море реально штормовое (amp >= 0.9)', seaB.amp >= 0.9, `amp=${seaB.amp}`);
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); g.rig.freeAzimSet(Math.PI * 0.7); g.rig.freeElevSet(0.18); g.rig.distSet(46); return 'cam'; })()`);
await sleep(1500);
shot('v31_storm_headsea');
const errsB = pageErrors();
check('B: нет ошибок страницы', errsB === '', errsB.slice(0, 200));

// ============ Фаза C: ИИ отстреливается при нападении ============
log('=== C: ответный огонь ИИ ===');
await freshGame('C');
const mer = jparse(ev(`(() => {
  const g = window.__game;
  const i = g.aiShips.findIndex(a => a.state === 'route' && a.ship.preset.category === 'merchant');
  if (i < 0) return JSON.stringify({ err: 'нет торговцев' });
  const a = g.aiShips[i];
  const s = a.ship;
  // игрок рядом (140 м), парус убран — торговцу проще выйти на траверз
  const off = { x: s.position.x - s.forward.x * 60 + s.forward.z * 120, z: s.position.z - s.forward.z * 60 - s.forward.x * 120 };
  g.player.position.set(off.x, 0, off.z);
  g.player.velocity.set(0, 0, 0); g.player.angular.set(0, 0, 0);
  const yaw = Math.atan2(s.position.x - off.x, s.position.z - off.z);
  g.player.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  g.player.sailTarget = 0;
  g.rig.snap();
  window.__shots = [];
  g.bus.on('cannon:fired', (e) => window.__shots.push({ x: e.pos.x, z: e.pos.z }));
  // нападение (эквивалент попадания — связку PROJECTILE_HIT проверяли ранее)
  a.onPlayerAggression(g.aiShips);
  return JSON.stringify({ idx: i, id: s.preset.id, guns: s.preset.gunsPerSide, state: a.state, dist: Math.round(g.player.position.distanceTo(s.position)) });
})()`));
log('C: торговец:', JSON.stringify(mer));
check('C: торговец найден и вооружён', !mer.err && mer.guns > 0, JSON.stringify(mer));
await sleep(3000);
const stC = jparse(ev(`(() => { const g = window.__game; const a = g.aiShips[${typeof mer.idx === 'number' ? mer.idx : 0}]; return JSON.stringify({ state: a.state, dist: Math.round(g.player.position.distanceTo(a.ship.position)) }); })()`));
log('C: состояние через 3 с:', JSON.stringify(stC));
check('C: после нападения перешёл в бой (combat)', stC.state === 'combat', `state=${stC.state}`);
// ждём ответный залп (ИИ выходит на траверз и стреляет)
let fired = null;
for (let t = 0; t < 30; t++) {
  await sleep(2000);
  const r = jparse(ev(`(() => { const g = window.__game; const a = g.aiShips[${typeof mer.idx === 'number' ? mer.idx : 0}]; const sh = window.__shots || []; const near = sh.filter(s => { const d = Math.hypot(s.x - a.ship.position.x, s.z - a.ship.position.z); return d < 90; }); return JSON.stringify({ n: near.length, total: sh.length, state: a.state, dist: Math.round(g.player.position.distanceTo(a.ship.position)), hp: Math.round(g.player.hullHP) }); })()`));
  if (r.n > 0) { fired = r; break; }
  if (t % 5 === 4) log('C: ждём залп…', JSON.stringify(r));
}
log('C: залп:', JSON.stringify(fired));
check('C: торговец ОТСТРЕЛЯЛСЯ (залп из его района)', fired && fired.n > 0, fired ? `выстрелов рядом: ${fired.n}` : 'нет выстрелов за 60 с');
const errsC = pageErrors();
check('C: нет ошибок страницы', errsC === '', errsC.slice(0, 200));

log(fails === 0 ? '\nALL OK' : `\nFAILED: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
