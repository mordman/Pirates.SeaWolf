// E2E Task 89 — АБОРДАЖ: КАПИТАН НА ПАЛУБЕ + ЗУМ + ПОТЕРИ ОБЕИХ СТОРОН.
// Три заказа игрока:
//  (1) V во время абордажа — капитан сходит на палубу, ПЕРЕХОДИТ ПО
//      МОСТКАМ на чужой борт и РУБИТ чужих бойцов саблей (участвует
//      в исходе: убитые обходятся противнику в матросов);
//  (2) зум КОЛЕСИКОМ работает и при абордаже (корабельная камера:
//      ранний endFrame ветки абордажа стирал wheelDelta до rig.update)
//      и на палубе (камера капитана);
//  (3) МОИ МАТРОСЫ ГИБНУТ: обмен ударами теперь стоит крови обеим
//      командам (сильнейшая — с шансом 0.08..0.32), каждый убитый
//      виден и как боец партии, и как фигура на СВОЕЙ палубе.
// Полигон: штиль + равные экипажи (24/24) — обе стороны точно
// истекут кровью; replacement экипажа выключен (трупы остаются).
// (A) старт полигона, равные экипажи, warp
// (B) G — абордаж, ждём фазу fight (мостки легли)
// (C) ЗУМ корабельной камерой во время абордажа: колесо на канвасе
//     меняет дистанцию рига (rig.debugDist) — БЕЗ выхода с руления
// (D) V — капитан на палубе (mode=deck, captain='own'), 1 — сабля
// (E) ЗУМ камерой капитана: колесо меняет land.deck.camDist
// (F) ПОТЕРИ ОБОИХ СТОРОН: crewA < 24 И crewD < 24; на палубе
//     игрока видны погибшие фигуры (__crewModelInfo().player.dead>0)
// (G) ПЕРЕХОД ПО МОСТКАМ: капитана ставим к планширю у мостка —
//     он перебирается на чужую палубу (captain='enemy')
// (H) КАПИТАН РУБИТ: саблей (ЛКМ) у бойца обороны — captainKills ≥ 1,
//     экипаж цели тает быстрее
// (I) финал: бой окончен, капитан ВОЗВРАЩЁН на свою палубу
// (J) VLM: капитан с саблей на чужой палубе среди бойцов
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });
mkdirSync('/home/z/my-project/download/task89', { recursive: true });

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
const waitBoard = async (cond, timeoutMs, label = '') => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const raw = await evR(`(() => { const b = window.__game && window.__game.boardingInfo(); return JSON.stringify(b || null); })()`);
    last = jparse(raw);
    if (last && cond(last)) return { ok: true, info: last };
    await sleep(4000);
  }
  return { ok: false, info: last };
};
const pressKey = (code) => ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}' })); return 1; })()`);
const wheel = (dy) => ev(`(() => { const c = document.querySelector('canvas'); if (c) c.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, cancelable: true })); return 1; })()`);
const lmb = () => ev(`(() => { window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); return 1; })()`);
const snap = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

// ============ A: полигон, равные экипажи ============
runRaw('close');
execSync('pkill -9 -f chrome || true', { shell: '/bin/bash' });
await sleep(2500);
run('open http://localhost:3000');
await sleep(12000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);
// равные экипажи 60/60 — просторный бой (~80 с, все секции успеют);
// replacement OFF — трупы остаются на палубе (детерминизм F)
ev(`(() => { const g = window.__game;
  g.settings.gameplay.provingDistance = 40;
  g.startProving('fluyt');
  g.testWarp = 240;
  g.player.crew = 60;
  g.pgTarget.ship.crew = 60;
  g.settings.gameplay.crewReplacement = false;
  return 1; })()`);
await sleep(3000);
{
  const s = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify({
    proving: g.proving, warp: g.testWarp, crew: g.player.crew,
    tgt: g.pgTarget ? g.pgTarget.ship.crew : -1 }); })()`));
  check('A: полигон, экипажи 60/60 (равные силы — кровопролитный бой)',
    !!s && s.proving === true && s.warp === 240 && s.crew === 60 && s.tgt === 60,
    JSON.stringify(s));
}

// ============ B: G — абордаж до фазы fight ============
{
  // телепорт к мишени (как в v85) и запуск РЕАЛЬНОЙ клавишей G
  ev(`(() => { const g = window.__game; const t = g.pgTarget.ship;
    const q = t.quaternion; const L = Math.hypot(2*(q.x*q.z + q.w*q.y), 1 - 2*(q.x*q.x + q.y*q.y)) || 1;
    const ux = 2*(q.x*q.z + q.w*q.y)/L, uz = (1 - 2*(q.x*q.x + q.y*q.y))/L;
    const cd = (g.player.preset.beam + t.preset.beam)/2 + 2.6;
    g.player.position.set(t.position.x - ux*cd*2.6, t.position.y, t.position.z - uz*cd*2.6);
    g.player.quaternion.copy(t.quaternion); g.player.velocity.set(0, 0, 0);
    g.player.sailTarget = 0; g.player.anchored = false; return 1; })()`);
  await sleep(1200);
  pressKey('KeyG');
  await sleep(1500);
  const r = await waitBoard((b) => b.phase === 'fight' && b.planksDown >= 3, 90000, 'fight');
  check('B: G — абордаж идёт, мостки легли (фаза fight)',
    r.ok && r.info.attackerIsPlayer === true,
    r.ok ? `phase=${r.info.phase}, бойцов ${r.info.fightersA}+${r.info.fightersD}` : `last=${JSON.stringify(r.info)}`);
}

// ============ C: зум колесом — КОРАБЕЛЬНАЯ камера при абордаже ============
{
  // игрок ещё ЗА ШТУРВАЛОМ (lander не активен): колесо должно менять
  // дистанцию рига. Корень фикса: ранний endFrame ветки абордажа
  // стирал wheelDelta до rig.update — зум не работал
  const d0 = jparse(await evR(`window.__game.rig.debugDist()`));
  wheel(-240);
  await sleep(1200);
  const d1 = jparse(await evR(`window.__game.rig.debugDist()`));
  check('C: колесо мыши при абордаже зумит корабельную камеру',
    typeof d0 === 'number' && typeof d1 === 'number' && d1 < d0,
    `дистанция ${d0} → ${d1}`);
}

// ============ D: V — капитан на палубу ============
{
  pressKey('KeyV');
  await sleep(1500);
  const s = jparse(await evR(`(() => { const g = window.__game; const lh = g.hud.land; return JSON.stringify({
    active: lh.active, mode: lh.mode, cap: g.boardingInfo() ? g.boardingInfo().captain : null }); })()`));
  check('D: V во время абордажа — капитан на своей палубе (mode=deck)',
    !!s && s.active === true && s.mode === 'deck' && s.cap === 'own', JSON.stringify(s));
  // 1 — сабля наголо (для Н)
  pressKey('Digit1');
  await sleep(800);
}

// ============ E: зум колесом — камера КАПИТАНА на палубе ============
{
  // camDist — из hud() самого Lander (компактный g.hud.land поля
  // deck не имеет)
  const e0 = jparse(await evR(`(() => { const L = window.__game.lander; return L && L.active ? L.hud().camDist : null; })()`));
  wheel(-240);
  await sleep(1200);
  const e1 = jparse(await evR(`(() => { const L = window.__game.lander; return L && L.active ? L.hud().camDist : null; })()`));
  check('E: колесо мыши на палубе зумит камеру капитана',
    typeof e0 === 'number' && typeof e1 === 'number' && e1 < e0,
    `дистанция ${e0} → ${e1}`);
}

// ============ F: потери ОБЕИХ сторон + видимые трупы ============
{
  // бой уже идёт: ждём, пока И игрок, И цель потеряют матросов
  const r = await waitBoard((b) => b.crewA < 60 && b.crewD < 60, 120000, 'blood');
  const cm = jparse(await evR(`JSON.stringify(window.__crewModelInfo ? window.__crewModelInfo().player : null)`));
  const dead = cm && typeof cm.dead === 'number' ? cm.dead : -1;
  check('F: матросы гибнут У ОБОИХ команд + трупы на палубе игрока',
    r.ok && dead > 0,
    r.ok ? `наши ${r.info.crewA}/60, их ${r.info.crewD}/60, трупов на палубе ${dead}` : `last=${JSON.stringify(r.info)}`);
}

// перезапуск абордажа: если боя нет ИЛИ бой СТАРЫЙ (fightT>50 — до
// лимита 95 с рукой подать, секция может не успеть) — свежий бой
const ensureBoardingFight = async () => {
  const cur = jparse(await evR(`(() => { const b = window.__game.boardingInfo(); return JSON.stringify(b ? { p: b.phase, ft: b.fightT } : null); })()`));
  if (cur && (cur.p === 'lash' || cur.p === 'hooks')) return true;
  if (cur && cur.p === 'fight' && typeof cur.ft === 'number' && cur.ft < 50) return true;
  ev(`(() => { const g = window.__game; g.resetProvingTarget(); g.player.crew = 60;
    g.pgTarget.ship.crew = 60; g.lander.exitDeck(); g.lander.restoreCamera(); return 1; })()`);
  await sleep(1500);
  ev(`(() => { const g = window.__game; g.startBoarding(g.pgTarget, true); return 1; })()`);
  const r = await waitBoard((b) => b.phase === 'fight', 90000, 'restart');
  pressKey('KeyV');
  await sleep(1500);
  return r.ok;
};

// ============ G: капитан ПЕРЕХОДИТ ПО МОСТКАМ на чужую палубу ============
{
  // гонка с концом боя: до двух попыток (перезапуск + телепорт +
  // ожидание перехода); механика подтверждена вручную и в H
  let r = { ok: false, info: null };
  let lastTeleport = '';
  for (let attempt = 0; attempt < 2 && !r.ok; attempt++) {
    await ensureBoardingFight();
    lastTeleport = ev(`(() => { const g = window.__game; const B = g.boarding; const L = g.lander;
      if (!B || !L || L.mode !== 'deck') return JSON.stringify({ err: 'no-boarding-or-deck' });
      const rp = B.debugRailAt(1); if (!rp) return JSON.stringify({ err: 'no-rail' });
      const y = L.deckPlan ? L.deckPlan.surfaceY(rp.x, rp.z) : 0;
      L.group.position.set(rp.x, y, rp.z);
      return JSON.stringify({ x: +rp.x.toFixed(2), z: +rp.z.toFixed(2) }); })()`);
    r = await waitBoard((b) => b.captain === 'enemy', 30000, 'cross');
  }
  check('G: у планширя с мостком капитан переходит на ЧУЖУЮ палубу',
    r.ok, r.ok ? `captain=${r.info.captain}, наши ${r.info.crewA}, их ${r.info.crewD}` : `last=${JSON.stringify(r.info)}, телепорт=${lastTeleport}`);
  snap('v89_enemy_deck');
}

// ============ H: капитан РУБИТ чужих бойцов саблей ============
{
  await ensureBoardingFight();
  // капитан должен быть на ЧУЖОЙ палубе (переход из G мог сброситься
  // перезапуском) — телепортируем напрямую через мосток; одна
  // повторная попытка на случай гонки с концом боя
  let crossed = false;
  for (let attempt = 0; attempt < 2 && !crossed; attempt++) {
    if (attempt > 0) await ensureBoardingFight();
    ev(`(() => { const g = window.__game; const L = g.lander; const B = g.boarding;
      if (!B || !L || L.mode !== 'deck') return 'NO-DECK';
      if (L.deckHost !== g.player.visual.group) return 'ALREADY-ENEMY';
      const rp = B.debugRailAt(1); if (!rp) return 'NO-RAIL';
      const y = L.deckPlan ? L.deckPlan.surfaceY(rp.x, rp.z) : 0;
      L.group.position.set(rp.x, y, rp.z); return 1; })()`);
    const w = await waitBoard((b) => b.captain === 'enemy', 30000, 'cross-h');
    crossed = w.ok;
  }
  pressKey('Digit1');           // сабля наголо (перезапуск сбросил оружие)
  await sleep(800);
  const before = jparse(await evR(`(() => { const b = window.__game.boardingInfo(); return b ? b.captainKills : null; })()`));
  // в headless кадры длятся ~1 с, боец-мишень уходит от записанной
  // точки — позиционирование и удар ОДНИМ eval'ом (свежий боец),
  // до 8 попыток; у сабли радиус дуги 2.6
  let r = { ok: false, info: null };
  for (let attempt = 0; attempt < 8 && !r.ok; attempt++) {
    ev(`(() => { const g = window.__game; const B = g.boarding; const L = g.lander;
      if (!B || !L || L.mode !== 'deck' || L.hud().weapon !== 'saber') return 'SKIP';
      const f = B.debugFighterLocal('def', 0); if (!f) return 'NO-FIGHTER';
      const toMid = f.x >= 0 ? -0.85 : 0.85;
      const lx = f.x + toMid, lz = f.z;
      const y = L.deckPlan ? L.deckPlan.surfaceY(lx, lz) : 0;
      L.group.position.set(lx, y, lz);
      L.debugSetYaw(Math.atan2(f.x - lx, f.z - lz));
      window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      return 1; })()`);
    r = await waitBoard((b) => b.captainKills >= 1, 7000, `kill-${attempt}`);
  }
  check('H: сабля капитана (ЛКМ) срубает чужого бойца — капитан влияет на исход',
    r.ok && (before === null || r.info.captainKills > before),
    r.ok ? `капитан сразил ${r.info.captainKills} (было ${before}), экипаж цели ${r.info.crewD}` : `last=${JSON.stringify(r.info)}`);
}

// ============ I: финал — капитан возвращается на свою палубу ============
{
  // конец: boardingInfo() становится null — опрашиваем до конца
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < 180000) {
    s = jparse(await evR(`(() => { const g = window.__game; const L = g.lander;
      return JSON.stringify({ done: !g.boarding, res: g.lastBoardingResult,
        landMode: L ? L.mode : null, home: L && L.deckHost ? L.deckHost === g.player.visual.group : null }); })()`));
    if (s && s.done) break;
    await sleep(4000);
  }
  check('I: бой окончен — капитан ВОЗВРАЩЁН на свою палубу',
    !!s && s.done === true && s.landMode === 'deck' && s.home === true,
    `res=${s ? s.res : '?'}, mode=${s ? s.landMode : '?'}, своя палуба=${s ? s.home : '?'}`);
}

// ============ J: кадр боя — капитан на чужой палубе ============
{
  // свежий абордаж для кадра: капитан из I ещё НА ПАЛУБЕ — V сейчас
  // ВЫШЕЛ бы с неё (переключатель!): сначала за штурвал, потом V
  ev(`(() => { const g = window.__game; g.lander.exitDeck(); g.lander.restoreCamera(); return 1; })()`);
  ev(`(() => { const g = window.__game; g.resetProvingTarget(); g.player.crew = 24;
    g.pgTarget.ship.crew = 24; return 1; })()`);
  await sleep(2000);
  ev(`(() => { const g = window.__game; g.startBoarding(g.pgTarget, true); return 1; })()`);
  const fw = await waitBoard((b) => b.phase === 'fight', 90000, 'fight2');
  if (fw.ok) {
    pressKey('KeyV');
    await sleep(1500);
    // переход по мосткам (до двух попыток) + сабля + камера ближе
    for (let attempt = 0; attempt < 2; attempt++) {
      ev(`(() => { const g = window.__game; const B = g.boarding; const L = g.lander;
        if (!B || !L || L.mode !== 'deck') return 0;
        if (L.deckHost !== g.player.visual.group) return 'ENEMY';
        const rp = B.debugRailAt(1); if (!rp) return 0;
        const y = L.deckPlan ? L.deckPlan.surfaceY(rp.x, rp.z) : 0;
        L.group.position.set(rp.x, y, rp.z); return 1; })()`);
      const w = await waitBoard((b) => b.captain === 'enemy', 30000, 'cross2');
      if (w.ok) break;
    }
    pressKey('Digit1');
    await sleep(800);
    wheel(-240);        // камера капитана ближе — фигура крупнее в кадре
    await sleep(600);
  }
  snap('v89_captain_fight');
  // детерминированная часть: капитан на ЧУЖОЙ палубе, сабля в руке
  const st = jparse(await evR(`(() => { const g = window.__game; const L = g.lander;
    return JSON.stringify({ cap: g.boardingInfo() ? g.boardingInfo().captain : null,
      weapon: L ? L.hud().weapon : null, mode: L ? L.mode : null }); })()`));
  let vlm = '';
  try {
    vlm = execSync(`z-ai vision -p "Скриншот морской игры: абордаж, два парусника сцеплены бортами. Ответь строго: 1) Есть ли на палубах мелкие фигурки людей? ДА/НЕТ. 2) Видна ли камера от третьего лица над палубой корабля (палуба крупным планом, а не вид моря издалека)? ДА/НЕТ." -i /home/z/my-project/scripts/shots/v89_captain_fight.png`, { encoding: 'utf8', timeout: 180000 }).trim();
  } catch (e) { vlm = `VLM ERR: ${e.message}`; }
  const vlmOk = /1[).]?\s*ДА/i.test(vlm) && /2[).]?\s*ДА/i.test(vlm);
  check('J: капитан на чужой палубе с саблей (телеметрия) + сцена боя (VLM)',
    !!st && st.cap === 'enemy' && st.weapon === 'saber' && vlmOk,
    `cap=${st ? st.cap : '?'}, оружие=${st ? st.weapon : '?'}; VLM: ${vlm.slice(0, 100)}`);
}

// ============ итог ============
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} ALL ${passed === results.length ? 'OK' : 'FAIL'}`);
execSync(`cp /home/z/my-project/scripts/shots/v89_enemy_deck.png /home/z/my-project/download/task89/v89_enemy_deck.png 2>/dev/null || true`, { shell: '/bin/bash' });
execSync(`cp /home/z/my-project/scripts/shots/v89_captain_fight.png /home/z/my-project/download/task89/v89_captain_fight.png 2>/dev/null || true`, { shell: '/bin/bash' });
process.exit(passed === results.length ? 0 : 1);
