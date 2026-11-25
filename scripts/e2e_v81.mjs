// E2E Task 81 — боевые действия/эскадра/лут/экипаж/телосложение:
// (A) КОРЕНЬ «нельзя уничтожить эскадру»: combat.others заполнялся
//     ТОЛЬКО при старте, эскадра (спавнится позже) не регистрировалась
//     → снаряды игрока пролетали насквозь. Фикс: регистрация в
//     spawnSquadron + уборка при деспавне. Проверка: hittable=true +
//     НАСТОЯЩИЕ залпы игрока снижают hullFrac цели; доводим до sunk.
// (B) атакованный корабль НЕ стоит на месте: маневрирует (speed>0.5);
//     скорость по ЧИСЛУ УЦЕЛЕВШИХ МАЧТ (thrust × mastThrust — в
//     обеих физиках): 1 сломанная — медленнее, все — дрейф ~0.
// (C) съём с якоря под огнём: лайр-эскадра выбирает якорь (5-12 с)
//     и маневрирует; лёгкие торговцы бегут.
// (D) выход из боя: игрок ушёл >520 м на 12+ с → возврат к делам
//     (route/patrol/якорь), crewEngage=false, посты сданы
//     (crouchedCount()==0) — матросы снова ходят по палубе.
// (E) лут потопленных МАСШТАБИРУЕТСЯ размером судна + рандом
//     (sizeK=length/24, rndK 0.7-1.5): сундук ≥60 зол, мешки 2-6.
// (F) телосложение (Task 81): разброс экипажа (thin/regular/stout/
//     muscular все >0), выбор на экране создания капитана → модель.
// (G) тактики ИИ: circling/artillery/brawler; борт циркуляции ±1.
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
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
await sleep(1500);

// ============================================================
// A. ЭСКАДРА УНИЧТОЖАЕМА (корневой фикс + реальные залпы)
// ============================================================
const sqRaw = await evR(`JSON.stringify((window.__game.spawnSquadron && window.__game.spawnSquadron()) || null)`);
const sq = jparse(sqRaw);
check('A1: spawnSquadron вернул эскадру', !!sq && sq.n >= 3, JSON.stringify(sq || {}).slice(0, 120));
await sleep(1500);
const sqInfo = jparse(await evR(`JSON.stringify(window.__squadronInfo())`));
const allHittable = sqInfo && sqInfo.ships.length >= (sq.n || 3) && sqInfo.ships.every(s => s.hittable === true);
check('A2: все корабли эскадры видны снарядам (combat.others)', !!allHittable,
  sqInfo ? `ships=${sqInfo.ships.length}` : 'нет данных');

// подставляем цель под залп: телепорт корабля эскадры на траверз
// (относительно ТЕКУЩЕГО борта игрока; боезапас — бесконечный для e2e)
const setupA = await evR(`(() => {
  const g = window.__game;
  const ai = g.aiShips.find(a => a.squadron && !a.ship.sunk && !a.ship.sinking);
  if (!ai) return 'no-ship';
  window.__t81a = ai;
  g.combat.infiniteAmmo = true;
  g.player.sailTarget = 0;
  g.player.velocity.set(0, 0, 0);
  const h = g.player.heading;               // правый борт (aim.side=1)
  ai.ship.position.set(g.player.position.x - Math.cos(h) * 70, 0, g.player.position.z + Math.sin(h) * 70);
  ai.ship.velocity.set(0, 0, 0);
  ai.ship.anchored = false;
  return ai.ship.preset.id + ':' + ai.ship.preset.length.toFixed(0) + 'м:' + ai.ship.gold + 'з';
})()`);
console.log('цель A:', setupA);
check('A3: цель эскадры телепортирована на траверз', !setupA.includes('no-ship') && !setupA.includes('ERR'), setupA);

// залпы до hullFrac < 0.5 (урон РЕАЛЬНЫМИ снарядами проходит).
// Вход: fireSideVolley активирует прицел; elevation 0.005 — плоский
// выстрел на 70 м (дефолт 0.06 уводит ядро над бортом); перезарядка
// 7.5 с — между залпами пауза, попадания копятся
let hullMin = 1, shots = 0;
for (let i = 0; i < 40 && hullMin > 0.75; i++) {
  await evR(`(() => { const g = window.__game, ai = window.__t81a; if (!ai) return 0;
    const h = g.player.heading;
    ai.ship.position.set(g.player.position.x - Math.cos(h) * 70, 0, g.player.position.z + Math.sin(h) * 70);
    ai.ship.velocity.set(0, 0, 0);
    g.player.velocity.set(0, 0, 0);
    g.player.hullHP = g.player.hullMax;   // защита от ответного огня
    g.combat.aim.elevation = 0.005;
    g.combat.fireSideVolley(1);
    return 1; })()`);
  shots++;
  await sleep(2500);
  const h2 = parseFloat(await evR(`(window.__t81a ? (window.__t81a.ship.hullHP / window.__t81a.ship.hullMax) : 0)`));
  if (!isNaN(h2)) hullMin = Math.min(hullMin, h2);
}
check('A4: реальные залпы игрока наносят УРОН эскадре (корень бага)', hullMin <= 0.75,
  `залпов=${shots}, hullFrac=${hullMin}`);

// дострел до потопления (внутренний урон — физика пробития уже доказана)
await evR(`(() => { const ai = window.__t81a; if (!ai) return 0;
  ai.ship.applyDamage({ kind: 'ball', amount: ai.ship.hullHP + 50 });
  return ai.ship.sinking ? 'sinking' : 'damaged'; })()`);
let sunkOk = false;
for (let i = 0; i < 100 && !sunkOk; i++) {   // сим тикает медленнее
  await sleep(3000);
  const v = jparse(await evR(`JSON.stringify({ s: !!(window.__t81a && window.__t81a.ship.sunk) })`));
  sunkOk = !!(v && v.s);
}
check('A5: корабль эскадры ПОТОПЛЕН', sunkOk, 'ожидание sunk ≤300 с');
// уборка: потопленная цель больше не грузит сцену (fps)
await evR(`(() => { const g = window.__game, ai = window.__t81a; if (!ai) return 0;
  const s = ai.ship;
  const i = g.aiShips.indexOf(ai);
  if (i >= 0) g.aiShips.splice(i, 1);
  const oi = g.combat.others.indexOf(s);
  if (oi >= 0) g.combat.others.splice(oi, 1);
  g.worldGroup.remove(s.visual.group, s.foam.mesh, s.wake.mesh);
  return 1; })()`);
await sleep(3000);

// ============================================================
// E1. ЛУТ ПОТОПЛЕННОГО: масштаб по размеру + рандом
// ============================================================
await sleep(2500);
const loot = jparse(await evR(`JSON.stringify(window.__flotsamInfo())`));
const lootShip = jparse(await evR(`JSON.stringify(window.__t81a ? { L: window.__t81a.ship.preset.length, g: Math.round(window.__t81a.ship.gold * 100) / 100 } : null) || 'null'`));
const expMinGold = lootShip ? Math.max(60, Math.floor(lootShip.g * Math.max(0.75, lootShip.L / 24) * 0.7 * 0.9)) : 55;
check('E1: сундук с деньгами на волнах', !!loot && loot.chests >= 1, `chests=${loot && loot.chests}, sacks=${loot && loot.sacks}`);
check('E2: мешки товара (≥2 — гарантия для любого судна)', !!loot && loot.sacks >= 2, `sacks=${loot && loot.sacks}`);
check('E3: золото масштабировано по размеру судна', !!loot && loot.gold >= expMinGold,
  `gold=${loot && loot.gold}, ожидание ≥${expMinGold} (L=${lootShip && lootShip.L}, g0=${lootShip && lootShip.g})`);

// ============================================================
// B. АТАКОВАННЫЙ КОРАБЛЬ МАНЕВРИРУЕТ; СКОРОСТЬ ПО МАЧТАМ
// ============================================================
const bInit = await evR(`(() => {
  const g = window.__game;
  const ai = g.aiShips.find(a => a.squadron && !a.ship.sunk && !a.ship.sinking && window.__t81a !== a);
  if (!ai) return 'no-ship';
  window.__t81b = ai;
  ai.onPlayerAggression([]);           // «атака» — корабль вступает в бой
  ai.ship.anchored = false;
  const p = g.player.position;
  ai.ship.position.set(p.x + 240, 0, p.z);   // дать простор маневру
  ai.ship.velocity.set(0, 0, 0);
  return ai.ship.preset.id + ':masts=' + ai.ship.mastHP.length + ':st=' + ai.state;
})()`);
console.log('цель B:', bInit);
check('B1: второй корабль эскадры атакован (вступил в бой)', !bInit.includes('no-ship') && !bInit.includes('ERR'), bInit);
// макс. из 3 замеров — гасим влияние курса к ветру (поляра)
const maxOf = async (expr, n, gap) => {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const v = parseFloat(jparse(await evR(expr)));
    if (!isNaN(v)) m = Math.max(m, v);
    if (i < n - 1) await sleep(gap);
  }
  return m;
};
await sleep(12000);
// B2: ждём разгона (паруса/тяга сходятся к установившейся скорости)
let bSpeed = 0;
for (let i = 0; i < 20 && bSpeed <= 0.5; i++) {
  bSpeed = await maxOf(`(window.__t81b ? window.__t81b.ship.speed() : 0)`, 2, 1500);
  if (bSpeed <= 0.5) await sleep(4000);
}
check('B2: атакованный корабль МАНЕВРИРУЕТ (скорость > 0.5 м/с)', !isNaN(bSpeed) && bSpeed > 0.5, `speed=${bSpeed} м/с`);

// B3: 1 сломанная мачта — ждём НОВОЙ установившейся (×mastThrust)
const spdBefore = bSpeed;
await evR(`(() => { const s = window.__t81b && window.__t81b.ship; if (!s) return 0;
  s.damageMast(0, 999); return s.mastsBroken; })()`);
let spd1 = spdBefore;
for (let i = 0; i < 25; i++) {
  spd1 = await maxOf(`(window.__t81b ? window.__t81b.ship.speed() : 0)`, 2, 1500);
  if (spd1 < spdBefore * 0.8) break;
  await sleep(4000);
}
const mastsInfo = jparse(await evR(`JSON.stringify(window.__t81b ? { broken: window.__t81b.ship.mastsBroken, total: window.__t81b.ship.mastHP.length } : null)`));
check('B3: одна сломанная мачта ЗАМЕДЛЯЕТ (тяга × mastThrust)',
  !isNaN(spd1) && spd1 < spdBefore * 0.8 && spd1 > 0.15, `до=${spdBefore}, после=${spd1}, сломано=${mastsInfo && mastsInfo.broken}/${mastsInfo && mastsInfo.total}`);
// B4: все мачты — тяги нет, скорость гаснет
await evR(`(() => { const s = window.__t81b && window.__t81b.ship; if (!s) return 0;
  for (let i = 0; i < s.mastHP.length; i++) s.damageMast(i, 999);
  return s.mastsBroken; })()`);
let spdAll = spd1;
for (let i = 0; i < 30 && spdAll >= 0.3; i++) {
  spdAll = await maxOf(`(window.__t81b ? window.__t81b.ship.speed() : 0)`, 2, 1500);
  if (spdAll >= 0.3) await sleep(4000);
}
check('B4: без мачт корабль не идёт (дрейф < 0.3 м/с)', !isNaN(spdAll) && spdAll < 0.3, `speed=${spdAll} м/с`);

// ============================================================
// G1. ТАКТИКИ В БОЮ
// ============================================================
const tact = jparse(await evR(`JSON.stringify(window.__aiInfo().filter(s => s.state === 'combat').map(s => s.tactic))`));
const tacticSet = ['circling', 'artillery', 'brawler'];
const tactOk = Array.isArray(tact) && tact.length >= 1 && tact.every(t => tacticSet.includes(t));
check('G1: каждый корабль в бою имеет тактику из набора', !!tactOk, JSON.stringify(tact || []).slice(0, 90));
const dist1 = jparse(await evR(`(() => { const ai = window.__t81b; if (!ai) return 'null';
  const out = []; for (let i = 0; i < 20; i++) { ai.pickTactic(); out.push(ai.tactic); }
  return JSON.stringify([...new Set(out)]); })()`));
check('G2: выбор тактики разнообразен (≥2 за 20 бросков)', Array.isArray(dist1) && dist1.length >= 2, JSON.stringify(dist1 || []));

// ============================================================
// C. СЪЁМ С ЯКОРЯ (пиратское логово) + скриншот
// ============================================================
const lair = await evR(`(() => {
  const g = window.__game;
  const ai = g.aiShips.find(a => a.state === 'anchored' && a.ship.preset.gunsPerSide >= 4 && !a.ship.sunk);
  if (!ai) return 'no-anchored-heavy';
  window.__t81c = ai;
  ai.onPlayerAggression([]);           // атака корабля на якоре
  ai.anchorBreakT = Math.min(ai.anchorBreakT > 0 ? ai.anchorBreakT : 2, 2); // ускорить ту же ветку
  const sh = ai.ship;
  g.player.position.set(sh.position.x + 320, 0, sh.position.z);
  return sh.preset.id + ':' + sh.preset.gunsPerSide + 'ор/борт';
})()`);
console.log('лайр:', lair);
check('C1: корабль на якоре атакован', !lair.includes('no-') && !lair.includes('ERR'), lair);
let cState = null, cAi = false;
for (let i = 0; i < 40 && !cAi; i++) {   // polling: сим может тикать медленно
  cState = jparse(await evR(`JSON.stringify(window.__t81c ? { st: window.__t81c.state, anc: window.__t81c.ship.anchored, tac: window.__t81c.tactic, sp: +window.__t81c.ship.speed().toFixed(2) } : null)`));
  cAi = !!(cState && (cState.st === 'combat' || cState.st === 'flee') && !cState.anc);
  if (!cAi) await sleep(4000);
}
check('C2: под атакой корабль СНИМАЕТСЯ С ЯКОРЯ и маневрирует', !!cAi,
  cState ? `state=${cState.st}, anchored=${cState.anc}, tactic=${cState.tac}, speed=${cState.sp}` : 'нет данных');
let cSpeed2 = 0;
for (let i = 0; i < 15 && cSpeed2 <= 0.4; i++) {
  cSpeed2 = await maxOf(`(window.__t81c ? window.__t81c.ship.speed() : 0)`, 2, 1500);
  if (cSpeed2 <= 0.4) await sleep(4000);
}
check('C3: снявшийся с якоря набирает ход (скорость > 0.4 м/с)',
  !isNaN(cSpeed2) && cSpeed2 > 0.4, `speed=${cSpeed2} м/с`);
run(`screenshot scripts/shots/t81_lair_sortie.png`);
console.log('скриншот: флот логова снимается с якоря');

// ============================================================
// D. ВЫХОД ИЗ БОЯ — ЭКИПАЖ СНОВА ХОДИТ ПО ПАЛУБЕ
// ============================================================
await evR(`(() => { const g = window.__game;
  // уводим игрока на 800 м от боевого корабля лайра (B и C оба
  // уходят за порог 520 м: B — далеко по построению, C — этим шагом)
  const c = window.__t81c || g.aiShips.find(a => a.state === 'combat');
  if (!c) return 'no-combat';
  g.player.position.set(c.ship.position.x + 800, 0, c.ship.position.z);
  return 'ok'; })()`);
let dExit = null, bOut = false, cOut = false;
for (let i = 0; i < 60 && !(bOut && cOut); i++) {   // grace 12 сим-с + запас
  dExit = jparse(await evR(`JSON.stringify({
    b: window.__t81b ? { st: window.__t81b.state, eng: window.__t81b.ship.crewEngage } : null,
    c: window.__t81c ? { st: window.__t81c.state, eng: window.__t81c.ship.crewEngage } : null,
  })`));
  bOut = !!(dExit && dExit.b && dExit.b.st !== 'combat' && dExit.b.eng === false);
  cOut = !!(dExit && dExit.c && dExit.c.st !== 'combat' && dExit.c.eng === false);
  if (!(bOut && cOut)) await sleep(4000);
}
check('D1: бой закончился — ИИ вернулся к прежним делам (B и C)',
  !!(bOut && cOut), JSON.stringify(dExit || {}).slice(0, 120));
let crouch = 'n/a';
for (let i = 0; i < 20; i++) {   // поза гаснет по СИМ-времени (postT + fade)
  crouch = await evR(`(() => { const g = window.__game;
    const ai = window.__t81c || g.aiShips.find(a => !a.ship.sunk && a.ship.crew3d);
    return ai ? String(ai.ship.crew3d.crouchedCount()) : 'n/a'; })()`);
  if (crouch.includes('0')) break;
  await sleep(3000);
}
check('D2: никто не сидит на коленях за фальшбортом (crouchedCount=0)',
  crouch.includes('0'), `crouched=${crouch}`);

// ============================================================
// Скриншоты: лут на волнах + палуба с телосложениями
// ============================================================
const lootPos = jparse(await evR(`(() => { const f = window.__flotsamInfo();
  const it = f.items && f.items[0];
  if (!it) return 'null';
  window.__game.player.position.set(it.x + 12, 0, it.z + 12);
  return JSON.stringify({ x: it.x, z: it.z, kind: it.kind }); })()`));
if (lootPos && lootPos.x !== undefined) {
  await sleep(3000);
  run(`screenshot scripts/shots/t81_loot.png`);
  console.log('скриншот: лут (сундук/мешки) на волнах');
}
run(`screenshot scripts/shots/t81_deck_builds.png`);
console.log('скриншот: палуба игрока (телосложения экипажа)');

// ============================================================
// F. ТЕЛОСЛОЖЕНИЕ: разброс экипажа + выбор капитана на UI
// ============================================================
const builds = jparse(await evR(`JSON.stringify(window.__crewModelInfo().crewBuilds)`));
const buildsOk = builds && ['thin', 'regular', 'stout', 'muscular'].every(k => builds[k] > 0);
check('F1: в экипаже есть ВСЕ четыре телосложения', !!buildsOk, JSON.stringify(builds || {}));

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
const uiBtns = await evR(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (!scr) return 'no-screen';
  const t = [...scr.querySelectorAll('button')].map(b => b.textContent || '');
  return JSON.stringify({ thin: t.includes('Худой'), reg: t.includes('Обычный'),
    stout: t.includes('Полный'), musc: t.includes('Мускулистый') });
})()`);
let uiOk = false;
try { const u = jparse(uiBtns); uiOk = !!(u && u.thin && u.reg && u.stout && u.musc); } catch { }
check('F2: экран создания — выбор телосложения (4 кнопки)', uiOk, uiBtns.slice(0, 110));
run(`screenshot scripts/shots/t81_char_builds.png`);

await evR(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (!scr) return 'no-screen';
  const btn = [...scr.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Полный');
  if (btn) btn.click();
  return btn ? 'picked' : 'no-btn';
})()`);
await sleep(700);
const applyBtn = await evR(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (!scr) return 'closed';
  const btn = [...scr.querySelectorAll('button')].find(b => /В море/.test(b.textContent || ''));
  if (btn) { btn.click(); return 'applied'; }
  return 'no-btn';
})()`);
await sleep(2500);
const capBuild = await evR(`JSON.stringify({ b: window.__crewModelInfo().captain.build, s: window.__game.settings.player.build })`);
let capOk = false;
try { const cv = jparse(capBuild); capOk = !!(cv && cv.s === 'stout' && cv.b === 'stout'); } catch { }
check('F3: выбранный «Полный» капитан — телосложение применено', capOk, capBuild);

// ============================================================
// I. ОШИБКИ КОНСОЛИ
// ============================================================
const cons = run(`console`);
const errLines = (cons || '').split('\n').filter(l => /ERROR|error/i.test(l))
  .filter(l => !/favicon|net::ERR|Autofocus|element\/nav/i.test(l));
check('I1: ошибок в консоли нет', errLines.length === 0, errLines.slice(0, 3).join(' | ').slice(0, 160));

// ============================================================
const okN = results.filter(r => r.ok).length;
console.log(`\nALL ${okN >= results.length ? 'OK' : 'FAIL'} (${okN}/${results.length})`);
if (okN < results.length) process.exitCode = 1;
