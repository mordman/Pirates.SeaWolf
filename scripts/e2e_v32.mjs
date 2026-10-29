// E2E Task 32 — проверки доработок Task 15 (после интеграции параллельной сессии):
//  (A) реалистичный стартовый боезапас 40/12/20/8 + «недостача» 1–10% (джиттер)
//  (B) высота волн ТОЛЬКО от силы ветра (настройки waveHeight больше нет)
//  (C) шторм 22 м/с: корабль идёт ПОВЕРХ гребней — палуба не ныряет под волну
//  (D) полигон: мишень — любое из 29 судов; смена корабля игрока + пушки/перезарядка
//  (E) экипаж гибнет ТОЛЬКО от точного прострела фигуры (капсульный тест)
//  (F) фазовое затопление: крен → гидротормоз → спираль; обломки всплывают
//  (G) ответный огонь мишени на полигоне
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 90000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
/** eval с журналированием ошибок: возвращает распарсенный JSON или {err} */
const evj = async (label, js) => {
  const raw = ev(js);
  if (typeof raw === 'string' && raw.startsWith('ERR')) {
    log(`EV-ERR [${label}]:`, raw.slice(0, 260));
    return { err: raw };
  }
  return jparse(raw);
};
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

// ============ A: боезапас 40/12/20/8 + джиттер ============
log('=== A: реалистичный боезапас + недостача 1-10% ===');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
const c0 = clickBtn('Поднять флаг');
await sleep(2500);
log('A: старт:', c0);
const ammoA = await evj('ammo', `(() => { const g = window.__game; return JSON.stringify({ p: g.player.ammo, s: g.settings.gameplay.startingAmmo, j: g.settings.gameplay.ammoJitter, wave: g.settings.graphics.waveHeight ?? null }); })()`);
log('A: игрок/настройки:', JSON.stringify(ammoA));
check('A: настройки по умолчанию 40/12/20/8',
  ammoA.s && ammoA.s.ball === 40 && ammoA.s.chain === 12 && ammoA.s.grape === 20 && ammoA.s.fire === 8,
  JSON.stringify(ammoA.s));
check('A: джиттер включён по умолчанию', ammoA.j === true);
check('A: боезапас игрока <= старта (недостача 1-10%)',
  ammoA.p && ammoA.p.ball <= 40 && ammoA.p.ball >= 35 && ammoA.p.chain <= 12 && ammoA.p.fire <= 8,
  JSON.stringify(ammoA.p));
check('A: настройки waveHeight удалены (волны от ветра)', ammoA.wave === null);
const errsA = pageErrors();
check('A: нет ошибок страницы', errsA === '', errsA.slice(0, 200));

// джиттер выкл → ровно стартовый набор на возрождении
await evj('jitterOff', `(() => { const g = window.__game; g.settings.gameplay.ammoJitter = false; g.respawn(); return 1; })()`);
await sleep(800);
const ammoB = await evj('ammoExact', `JSON.stringify(window.__game.player.ammo)`);
check('A: без джиттера — ровно 40/12/20/8',
  ammoB.ball === 40 && ammoB.chain === 12 && ammoB.grape === 20 && ammoB.fire === 8, JSON.stringify(ammoB));

// ============ B: волны от силы ветра ============
log('=== B: волны только от ветра ===');
await evj('wind8', `window.__game.debugSetWind(8)`);
await sleep(22000);
const ampB = await evj('amp', `(() => { const s = window.__sea; return JSON.stringify({ amp: +s.seaAmp.toFixed(2), wind: +s.wind.toFixed(1) }); })()`);
log('B: море при ветре:', JSON.stringify(ampB));
// ветер в игре «дышит» (порывы) — сверяем амплитуду с формулой от ФАКТИЧЕСКОГО ветра:
// ampTarget = clamp(0.22 + wind*0.072, 0.3, 2.0)
const ampPred = Math.max(0.3, Math.min(2.0, 0.22 + ampB.wind * 0.072));
check('B: амплитуда соответствует формуле 0.22+0.072·ветер', Math.abs(ampB.amp - ampPred) < 0.18, `amp=${ampB.amp} pred=${ampPred.toFixed(2)} wind=${ampB.wind}`);

// ============ C: шторм 22 м/с — плывём ПОВЕРХ волн ============
log('=== C: шторм 22 м/с, посадка на гребень ===');
await evj('wind22', `(() => { const g = window.__game; g.debugSetWind(22); const p = g.player; p.sailTarget = 1; p.anchored = false; return 1; })()`);
// ждём разгона ветра до штормового (поллинг, кап 60с)
let windOk = false;
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  const w = await evj('windPoll', `(() => { const s = window.__sea; return s ? +s.wind.toFixed(1) : -1; })()`);
  if (typeof w === 'number' && w >= 20) { windOk = true; break; }
}
log(`C: ветер разогнался до штормового: ${windOk}`);
if (!windOk) {
  // подталкиваем ещё раз (порывы могут сбивать рост)
  await evj('wind22again', `(() => { const g = window.__game; g.debugSetWind(22); return 1; })()`);
  await sleep(12000);
}
if (windOk) {
  let minFb = Infinity, maxDip = -Infinity;
  for (let i = 0; i < 30; i++) {
    const s = await evj('storm', `(() => { const s = window.__sea; return JSON.stringify({ fb: +s.freeboard.toFixed(2), y: +s.y.toFixed(2), wy: +s.waterY.toFixed(2), sinking: s.sinking ? 1 : 0 }); })()`);
    if (s && typeof s.fb === 'number') {
      minFb = Math.min(minFb, s.fb);
      maxDip = Math.max(maxDip, s.wy - s.y);
    }
    if (s && s.sinking) break;
    await sleep(400);
  }
  log(`C: мин. надводный борт ${minFb.toFixed(2)} м, макс. погружение центра ${maxDip.toFixed(2)} м`);
  check('C: палуба не ныряет под волну (freeboard > -0.55 м)', minFb > -0.55, `min=${minFb.toFixed(2)}`);
  check('C: корпус не уходит под воду целиком (центр выше -1.2 м)', maxDip < 1.2, `dip=${maxDip.toFixed(2)}`);
  shot('t32_storm');
} else check('C: штормовой ветер достигнут', false, 'wind stuck');
const errsC = pageErrors();
check('C: нет ошибок страницы в шторме', errsC === '', errsC.slice(0, 200));

// ============ D: полигон — все суда + смена корабля игрока ============
log('=== D: полигон, все 29 судов + выбор корабля игрока ===');
const d0 = await evj('startProving', `(() => { try { const g = window.__game; g.debugSetWind(7.5); g.startProving('victory'); return JSON.stringify({ pg: !!g.pgTarget, proving: g.proving }); } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); } })()`);
log('D: старт полигона:', JSON.stringify(d0));
check('D: startProving(victory) без ошибок', !d0.err && d0.pg === true, JSON.stringify(d0));
await sleep(3000);
const d1 = await evj('target', `(() => { const g = window.__game; if (!g.pgTarget) return JSON.stringify({ err: 'pgTarget null' }); return JSON.stringify({ id: g.pgTarget.ship.preset.id, guns: g.pgTarget.ship.visual.gunsPort.length + g.pgTarget.ship.visual.gunsStarboard.length, proving: g.proving }); })()`);
check('D: мишень — HMS Victory (29 судов доступны)', d1.id === 'victory', JSON.stringify(d1));
check('D: пушек у мишени 28 (14 на борт, 3 деки)', d1.guns === 28, `guns=${d1.guns}`);
const d2 = await evj('changeShip', `(() => { try { const g = window.__game; const err = g.changeShip('brig'); return JSON.stringify({ err, ship: g.player.preset.id, reloads: g.combat.reloads.length, proving: g.proving, gunsV: g.player.visual.gunsPort.length + g.player.visual.gunsStarboard.length }); } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); } })()`);
check('D: игрок сменил корабль на бриг', d2.ship === 'brig', JSON.stringify(d2));
check('D: перезарядка перестроена под 14 стволов', d2.reloads === 14, `reloads=${d2.reloads}`);
check('D: пушки на модели = gunsPerSide×2 (7×2)', d2.gunsV === 14, `guns=${d2.gunsV}`);
check('D: полигон не сброшен после смены корабля', d2.proving === true, `proving=${d2.proving}`);
shot('t32_polygon_victory');

// ============ E: экипаж — только точное поражение ============
log('=== E: капсульное поражение экипажа ===');
const e0 = await evj('killNearPath', `(() => {
  const g = window.__game; const t = g.pgTarget && g.pgTarget.ship;
  if (!t) return JSON.stringify({ err: 'pgTarget null' });
  const fig = t.crew3d.group.children.find(ch => ch.visible);
  const p = fig ? fig.position : null;
  if (!p) return JSON.stringify({ err: 'no figure' });
  const shipPos = t.position, q = t.quaternion;
  const L = (x, y, z) => new (Object.getPrototypeOf(shipPos).constructor)(x, y, z);
  const a1 = L(p.x - 8, p.y + 0.95, p.z), b1 = L(p.x + 8, p.y + 0.95, p.z);
  const k1 = t.crew3d.killNearPath(a1, b1, 'ball', 2, 0.5, shipPos, q);
  const a2 = L(p.x - 8, p.y + 0.95, p.z + 3.0), b2 = L(p.x + 8, p.y + 0.95, p.z + 3.0);
  const k2 = t.crew3d.killNearPath(a2, b2, 'ball', 2, 0.5, shipPos, q);
  return JSON.stringify({ crew0: t.crew3d.total, through: k1, offset3m: k2 });
})()`);
log('E:', JSON.stringify(e0));
if (e0.err) check('E: тест выполнен', false, String(e0.err).slice(0, 120));
else {
  check('E: снаряд сквозь фигуру убивает', e0.through >= 1, `killed=${e0.through}`);
  check('E: снаряд в 3 м от фигуры — 0 потерь', e0.offset3m === 0, `killed=${e0.offset3m}`);
}

// ============ F: фазовое затопление + обломки ============
log('=== F: фазовое затопление ===');
// ВАЖНО: небольшая мишень (флейт). Линкор в headless-рендере роняет FPS
// до 1-2 и симуляция замирает — это ограничение тестовой среды, не игры.
const f0 = await evj('sinkStart', `(() => { try { const g = window.__game; if (g.pgTarget) g.exitProving(); g.startProving('fluyt'); g.pgTarget.ship.applyDamage({ kind: 'ball', amount: 99999 }); return JSON.stringify({ sinking: g.pgTarget.ship.sinking ? 1 : 0, model: g.pgTarget.ship.preset.id }); } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); } })()`);
check('F: мишень начала тонуть от пробоины', f0.sinking === 1, JSON.stringify(f0));
await sleep(2000);
const f1 = await evj('sinkPhase1', `(() => { const g = window.__game; const t = g.pgTarget.ship; return JSON.stringify({ sinking: t.sinking ? 1 : 0, phase: t.sinkPhase, t: +t.sinkT.toFixed(1) }); })()`);
check('F: мишень тонет (фаза 1)', f1.sinking === 1, JSON.stringify(f1));
await sleep(20000);
// если страница перезагрузилась — стартуем тонущую мишень заново (один раз)
const fAlive = await evj('sinkAlive', `(() => { const g = window.__game; return JSON.stringify({ pg: !!g.pgTarget, proving: g.proving, started: g.started }); })()`);
log('F: состояние:', JSON.stringify(fAlive));
if (!fAlive.pg) {
  log('F: сессия сброшена — повторный запуск затопления');
  await evj('sinkRestart', `(() => { try { const g = window.__game; if (!g.started) g.start(); g.startProving('fluyt'); g.pgTarget.ship.applyDamage({ kind: 'ball', amount: 99999 }); return 1; } catch (e) { return String(e); } })()`);
  await sleep(6000);
}
// headless-рендер даёт ~15-25 FPS → симуляция идёт в 2-3 раза медленнее:
// поллим фазу 2 до 60с реального времени
let f2 = null;
for (let i = 0; i < 20; i++) {
  await sleep(3000);
  f2 = await evj('sinkPhase2', `(() => { const g = window.__game; if (!g.pgTarget) return JSON.stringify({ err: 'pgTarget null' }); const t = g.pgTarget.ship; const s = window.__sea; return JSON.stringify({ phase: t.sinkPhase, debris: s.debrisAlive, mastsDown: t.mastFall.filter(f => f >= 0).length, roll: +t.euler.z.toFixed(2), sinking: t.sinking ? 1 : 0, t: +t.sinkT.toFixed(1) }); })()`);
  if (f2.err) { log('F: poll err:', String(f2.err).slice(0, 80)); f2 = null; continue; }
  if (f2.phase >= 2) break;
}
log('F: фаза 2:', JSON.stringify(f2));
if (!f2 || f2.err) check('F: фаза 2 достигнута', false, 'poll failed');
else {
  check('F: фаза 2 достигнута (палуба уходит под воду)', f2.sinking === 1 && (f2.phase >= 2 || f2.mastsDown > 0), `phase=${f2.phase} masts=${f2.mastsDown} t=${f2.t}`);
  check('F: обломки всплыли (доски/бочки/реи)', f2.debris > 0, `alive=${f2.debris}`);
  check('F: крен на борт (заваливается)', Math.abs(f2.roll) > 0.25 || f2.phase >= 3, `roll=${f2.roll}`);
}
// финал: детерминированный fast-forward до sunk (не зависит от FPS
// тестовой среды — 30 игровых секунд максимум)
const f3 = await evj('sinkEnd', `(() => {
  const g = window.__game; if (!g.pgTarget) return JSON.stringify({ err: 'pgTarget null' });
  const t = g.pgTarget.ship;
  const phases = [];
  let time = g.time;
  for (let i = 0; i < 1800 && !t.sunk; i++) {
    time += 1 / 60; t.fixedStep(1 / 60, time);
    if (i % 60 === 0) phases.push(t.sinkPhase);
  }
  return JSON.stringify({ sunk: t.sunk ? 1 : 0, visible: t.visual.group.visible ? 1 : 0, y: +t.position.y.toFixed(1), phase: t.sinkPhase, phases, sinkT: +t.sinkT.toFixed(1) });
})()`);
if (!f3 || f3.err) check('F: корабль ушёл на дно', false, String(f3 && f3.err || 'poll failed'));
else {
  check('F: корабль ушёл на дно (sunk)', f3.sunk === 1, JSON.stringify(f3));
  // фаза 1 подтверждена отдельной проверкой выше (f1) — здесь цикл 2→3
  check('F: полный цикл фаз (1 ранее, 2→3 в ускорении)', f3.phases && f3.phases.includes(2) && f3.phases.includes(3), JSON.stringify(f3.phases));
}

// ============ G: ответный огонь мишени ============
log('=== G: ответный огонь ===');
const g0 = await evj('retaliation', `(() => {
  try {
    const g = window.__game;
    if (g.pgTarget) g.exitProving();
    g.startProving('fluyt');
    g.setPgReturnFire(true);
    const c = g.combat; c.aim.active = true; c.aim.side = 1; c.aim.azimuth = 0; c.aim.elevation = 0.05;
    for (let i = 0; i < c.reloads.length; i++) c.reloads[i] = 0;
    c.ammo = 'ball'; c.fireBroadside();
    // не ждём 6с внутреннего таймера — мишень готовит ответ сразу
    g.pgTarget.gunTimer = 0.5;
    return JSON.stringify({ target: g.pgTarget.ship.preset.id, returnFire: g.pgTarget.returnFire });
  } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); }
})()`);
check('G: provoke выполнен', !g0.err, JSON.stringify(g0));
// детерминированно: fast-forward ИИ и снарядов до ответного залпа
// (не зависит от FPS тестовой среды)
const gShot = await evj('aiShot', `(() => {
  const g = window.__game; if (!g.pgTarget) return JSON.stringify({ err: 'pgTarget null' });
  let shot = false;
  for (let i = 0; i < 900; i++) {
    g.time += 1 / 60;
    g.pgTarget.update(1 / 60, g.time, g.player, g.combat, () => {});
    g.combat.update(1 / 60, g.time, (x, z) => g.waterHeight(x, z), null, null);
    if (g.combat.projectiles.some(p => p.active && p.shooter === g.pgTarget.ship)) { shot = true; break; }
  }
  return JSON.stringify({ shot });
})()`);
check('G: мишень ответила залпом', gShot.shot === true, JSON.stringify(gShot));
shot('t32_final');

const errsZ = pageErrors();
check('Z: нет ошибок страницы в конце', errsZ === '', errsZ.slice(0, 200));

log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
