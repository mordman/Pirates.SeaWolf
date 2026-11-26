// E2E Task 85/86 — АБОРДАЖ. Проверка НА ПОЛИГОНЕ (Task 86):
// чистая вода + мишень на якоре = детерминированный стенд конвейера
// подход → сцепка → мостки (борта ×2 + квартердэк) → бой → исход.
// По ТЗ игрока: «корабль подплывет, вкидываются доски и матросы
// начинают воевать; по разным частям корабля — борта, квартердэк».
// (A) старт: полигон активен, мишень на якоре, абордажа нет, warp
// (B) подсказка «E — АБОРДАЖ» у мишени; запуск РЕАЛЬНОЙ клавишей E
//     (путь handleInput → startBoarding)
// (C) конвейер фаз: approach → lash; МОСТКИ 3/3 (два бортовых +
//     квартердэк), сцепка борт-в-борт (дистанция ≈ cd)
// (D) бой: абордажные партии ≥ 8 бойцов, схватки (engaged ≥ 1),
//     потери экипажей растут; панель полигона получает boarding
// (E) исход: победа — result='won', мишень жива (noSurrender),
//     ИИ разморожен, полигон не выключился
// (F) «⟳ Восстановить»: экипаж мишени вернулся (проверка повторяема)
// (G) VLM: на скриншоте середины боя — два корабля борт-в-борт,
//     мостки между бортами, бойцы на палубах
// (H) brawler-ИИ сам лезет на абордаж игрока (attackerIsPlayer=false)
// (I) оборона выиграна: ИИ-атакующий сдался, блокировки сняты
// (J) проигрыш: экипаж игрока перебит — экран смерти
//     «Корабль захвачен» (deadReason = 'captured')
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });
mkdirSync('/home/z/my-project/download/task85', { recursive: true });

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
// опрос телеметрии до выполнения условия (мс)
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

// ============ A: полигон запущен, старт чист ============
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
// Task 86: ПРОВЕРКА АБОРДАЖА НА ПОЛИГОНЕ — мишень ближе обычного
// (40 м), чтобы сближающийся проход был коротким; штиль + якорь
// дают полный детерминизм. Warp: SwiftShader душит fps до ~1
ev(`(() => { const g = window.__game;
  g.settings.gameplay.provingDistance = 40;
  g.startProving('fluyt');
  g.testWarp = 240;                    // догонять реальное время
  g.player.crew = 60;                  // сильная партия — исход однозначен
  return 1; })()`);
await sleep(3000);
{
  const s = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify({
    proving: g.proving, warp: g.testWarp, boarding: g.boardingInfo(),
    tgt: g.pgTarget ? { crew: g.pgTarget.ship.crew, max: g.pgTarget.ship.preset.maxCrew,
      sunk: g.pgTarget.ship.sunk, state: g.pgTarget.state, dist: Math.round(g.pgTarget.ship.position.distanceTo(g.player.position)) } : null }); })()`));
  check('A: полигон активен, мишень на якоре, абордажа нет',
    !!s && s.proving === true && s.warp === 240 && s.boarding === null
    && !!s.tgt && !s.tgt.sunk && s.tgt.crew > 0,
    s ? `proving=${s.proving}, warp=${s.warp}, мишень ${s.tgt.crew}/${s.tgt.max} чел., ${s.tgt.dist} м, state=${s.tgt.state}` : 'нет телеметрии');
}

// ============ B: подсказка E-АБОРДАЖ + запуск клавишей E ============
{
  // игрок с КОРМЫ мишени, носом на неё (как реальный игрок перед
  // нажатием E: сближающийся проход по курсу — без разворота на 90°
  // в левентике; ветер бейдевинд-галфвинд — паруса работают)
  ev(`(() => { const g = window.__game; const t = g.pgTarget.ship;
    const q = t.quaternion; const L = Math.hypot(2*(q.x*q.z + q.w*q.y), 1 - 2*(q.x*q.x + q.y*q.y)) || 1;
    const ux = 2*(q.x*q.z + q.w*q.y)/L, uz = (1 - 2*(q.x*q.x + q.y*q.y))/L;
    const cd = (g.player.preset.beam + t.preset.beam)/2 + 2.6;
    g.player.position.set(t.position.x - ux*cd*2.6, t.position.y, t.position.z - uz*cd*2.6);
    g.player.quaternion.copy(t.quaternion);
    g.player.velocity.set(0, 0, 0); g.player.sailTarget = 0; g.player.anchored = false;
    return 1; })()`);
  await sleep(1200);
  const h = jparse(await evR(`(() => { const g = window.__game; const c = g.canBoard(); return JSON.stringify({
    can: !!c, kind: c && c.kind, name: c && c.ai.ship.preset.name,
    hudCan: g.hud.canBoard, hudKind: g.hud.boardKind, hudName: g.hud.boardedName }); })()`));
  check('B1: подсказка «E — АБОРДАЖ» у мишени полигона',
    !!h && h.can === true && h.kind === 'assault' && /флейт|мишен|fluyt/i.test(h.name || ''),
    JSON.stringify(h));
  // РЕАЛЬНАЯ клавиша E → startBoarding через handleInput
  ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })); return 1; })()`);
  await sleep(1500);
  const b = jparse(await evR(`JSON.stringify(window.__game.boardingInfo())`));
  check('B2: клавиша E запускает абордаж', !!b && (b.phase === 'approach' || b.phase === 'lash' || b.phase === 'fight') && b.attackerIsPlayer === true,
    b ? `phase=${b.phase}` : 'null');
}

// ============ C: сцепка и мостки (полигон: цель стоит) ============
{
  const r = await waitBoard((b) => b.planks >= 3 && b.planksDown >= 3, 150000, 'lash');
  check('C1: вкинуты 3 мостка (борта ×2 + квартердэк)', r.ok,
    r.ok ? `planks=${r.info.planksDown}/${r.info.planks}, d=${r.info.lashDist} м, approach=${r.info.approachT} с` : `last=${JSON.stringify(r.info)}`);
  const dOK = r.ok && r.info.lashDist < 16;
  check('C2: корабли сцеплены борт-в-борт', dOK, `d=${r.info ? r.info.lashDist : '?'} м`);
}
// скриншот середины боя (для G): зум + азимут камеры НА СТОРОНУ
// СЦЕПКИ (при старте с кормы сторона сцепки = +Z мира: мостки
// смотрят на север), бойцы в этот момент перебегают по доскам
{
  ev(`(() => { const g = window.__game; g.rig.userAzim = Math.PI/2 - g.rig.isoAzim; g.rig.distSet(40); return 1; })()`);
  const r = await waitBoard((b) => b.engaged >= 4, 60000, 'fight');
  if (r.ok) {
    run(`screenshot /home/z/my-project/scripts/shots/v85_fight.png`);
    copyFileSync('/home/z/my-project/scripts/shots/v85_fight.png', '/home/z/my-project/download/task85/v85_fight.png');
  }
  // вернуть обзор
  ev(`(() => { const g = window.__game; g.rig.distSet(95); return 1; })()`);
}

// ============ D: бой на палубах (быстрый комбинированный опрос:
// бой короткий — ~20 с, опрос раз в 2.5 с, живое ИЛИ терминальное
// состояние считаетcя доказательством) ============
{
  const t0 = Date.now();
  let d1 = false, d2 = false, d3 = false;
  let live = null, fin = null;
  while (Date.now() - t0 < 90000 && !(d1 && d2 && d3)) {
    const raw = await evR(`(() => { const g = window.__game; const b = g.boardingInfo();
      if (b) return JSON.stringify({ live: true, fA: b.fightersA, fD: b.fightersD, eng: b.engaged, crewD: b.crewD,
        hud: !!g.hud.boarding });
      return JSON.stringify({ live: false, res: g.lastBoardingResult, crew: g.pgTarget ? g.pgTarget.ship.crew : -1,
        hudRes: g.hud.lastBoardingResult }); })()`);
    const v = jparse(raw);
    if (v && v.live) {
      live = v;
      if (!d1 && v.fA + v.fD >= 8 && v.eng >= 1) d1 = true;
      if (!d2 && v.crewD < 16) d2 = true;
      if (!d3 && v.hud) d3 = true;
    } else if (v && !v.live) {
      fin = v;
    }
    await sleep(2500);
  }
  // терминальные доказательства: attrition = экипаж мишени упал
  // (won при 16→≤5); панель = hud.lastBoardingResult (итог в панели)
  if (fin && fin.res === 'won' && fin.crew >= 0 && fin.crew < 16) {
    if (!d2) d2 = true;
    if (!d3 && fin.hudRes === 'won') d3 = true;
  }
  check('D1: абордажные партии на палубах (≥8 бойцов, схватки)', d1,
    live ? `A=${live.fA} D=${live.fD} engaged=${live.eng}` : 'нет бойцов');
  check('D2: экипаж мишени тает (бой идёт)', d2,
    live ? `crewD=${live.crewD} (было 16), финал=${fin ? fin.crew : '?'}` : `финал=${fin ? fin.crew : '?'}`);
  check('D3: панель полигона видит абордаж (hud.boarding/итог)', d3,
    live ? `hud=${live.hud ? 'бой' : '—'}, итог=${fin ? fin.hudRes : '—'}` : `итог=${fin ? fin.hudRes : '—'}`);
}

// ============ E: исход — победа на полигоне ============
{
  const t0 = Date.now();
  let fin = null;
  while (Date.now() - t0 < 150000) {
    const raw = await evR(`(() => { const g = window.__game; const b = g.boardingInfo(); if (b) return JSON.stringify(b); return JSON.stringify({ done: true, res: g.lastBoardingResult, proving: g.proving, frozen: g.pgTarget && g.pgTarget.frozen, sunk: g.pgTarget && g.pgTarget.ship.sunk, crew: g.pgTarget && g.pgTarget.ship.crew }); })()`);
    const v = jparse(raw);
    if (v && v.done) { fin = v; break; }
    await sleep(4000);
  }
  check('E1: победа — проверка абордажа пройдена (won)', !!fin && fin.res === 'won',
    fin ? `res=${fin.res}, crew=${fin.crew}` : 'бой не закончился');
  check('E2: полигон жив: мишень не утонула, ИИ разморожен, режим включён',
    !!fin && fin.sunk === false && fin.frozen === false && fin.proving === true,
    fin ? `sunk=${fin.sunk}, frozen=${fin.frozen}, proving=${fin.proving}` : '?');
}

// ============ F: восстановление мишени — проверка повторяема ============
{
  const before = jparse(await evR(`window.__game.pgTarget.ship.crew`));
  ev(`(() => { window.__game.resetProvingTarget(); return 1; })()`);
  await sleep(1000);
  const after = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify({ crew: g.pgTarget.ship.crew, res: g.lastBoardingResult, boarding: !!g.boardingInfo() }); })()`));
  check('F: «⟳ Восстановить» вернул экипаж мишени (повтор проверки)',
    !!after && after.crew === 16 && after.boarding === false,
    `crew ${before} → ${after ? after.crew : '?'}, res=${after ? after.res : '?'}`);
  // Task 86: полигона проверен — мишень УБРАТЬ от игрока: её колли-
  // зионная сфера ((L1+L2)·0.30 ≈ 20 м) стоит у самого борта и гасит
  // скорость подходящих атакующих (×0.85 каждый шаг физики — бриг
  // «не догонял» стоячего игрока). Дальше H/J — чистая вода
  ev(`(() => { const g = window.__game; if (g.pgTarget) g.pgTarget.ship.position.set(g.player.position.x + 250, 0, g.player.position.z + 80); return 1; })()`);
}

// ============ G: VLM по скриншоту боя ============
{
  const out = (() => {
    try {
      return execSync(`z-ai vision -p "Game screenshot: sailing ships during a boarding action. Answer strictly: 1) Is there a SECOND ship locked side-by-side with the central ship? YES/NO. 2) Are wooden planks/boards bridging the two hulls? YES/NO. 3) Are there small crew figures on the decks near the rails? YES/NO." -i /home/z/my-project/download/task85/v85_fight.png`, { encoding: 'utf8', timeout: 180000 }).trim();
    } catch (e) { return String(e.stdout || e.stderr || e); }
  })();
  const txt = (out.match(/"content":\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
  const yes = (txt.match(/yes/gi) || []).length;
  check('G: VLM — сцепка/мостки/бойцы видны', yes >= 2, `yes×${yes}: ${txt.slice(0, 160)}`);
}

// ============ H: brawler-ИИ сам лезет на абордаж ============
{
  // боевой brawler с КОРМЫ игрока, носом на него (сближающийся
  // проход — см. B; не разворот на 90° в левентике)
  ev(`(() => { const g = window.__game, ai = g.aiShips[2];
    // броня: боевой ИИ может дать залп до сцепки — корпус не течёт
    g.player.hullHP = 1e6; g.player.hullMax = 1e6;
    ai.state = 'combat'; ai.tactic = 'brawler'; ai.boardCd = 0; ai.frozen = false;
    ai.ship.crew = 5; ai.ship.surrendered = false; ai.ship.anchored = false;
    const p = g.player.position; const q = g.player.quaternion;
    const L = Math.hypot(2*(q.x*q.z + q.w*q.y), 1 - 2*(q.x*q.x + q.y*q.y)) || 1;
    const ux = 2*(q.x*q.z + q.w*q.y)/L, uz = (1 - 2*(q.x*q.x + q.y*q.y))/L;
    const cd = (g.player.preset.beam + ai.ship.preset.beam)/2 + 2.6;
    ai.ship.position.set(p.x - ux*cd*2.4, p.y, p.z - uz*cd*2.4);
    ai.ship.velocity.set(0, 0, 0);
    ai.ship.sailTarget = 0;
    ai.ship.quaternion.copy(g.player.quaternion);
    return 1; })()`);
  const r = await waitBoard((b) => b.attackerIsPlayer === false && (b.phase === 'fight' || b.phase === 'lash' || b.phase === 'approach'), 60000, 'brawler');
  // бой короткий (ИИ-экипаж 5 ≤ порога — мгновенная сдача): если
  // живой снимок не пойман, но ИИ сдался — абордаж был, атаковал ИИ
  const sur = jparse(await evR(`window.__game.aiShips[2].ship.surrendered`));
  check('H: brawler-ИИ начал абордаж игрока', !!(r.ok || sur === true),
    r.ok ? `attacker=${r.info.attacker}, phase=${r.info.phase}` : (sur === true ? 'бой прошёл между опросами — ИИ сдался' : 'не начался'));
  // игрок сильнее (crew 60): оборона выигрывается — ИИ сдаётся
  const t0 = Date.now();
  let fin = null;
  while (Date.now() - t0 < 90000) {
    const raw = await evR(`(() => { const g = window.__game; const b = g.boardingInfo(); if (!b) return JSON.stringify({ done: true, res: g.lastBoardingResult, sur: g.aiShips[2].ship.surrendered, frozen: g.aiShips[2].frozen }); return JSON.stringify(b); })()`);
    const v = jparse(raw);
    if (v && v.done) { fin = v; break; }
    await sleep(4000);
  }
  check('I: оборона выиграна — ИИ-атакующий сдался, разморожен', !!fin && fin.sur === true && fin.frozen === false,
    fin ? `res=${fin.res}, sur=${fin.sur}, frozen=${fin.frozen}` : 'бой не закончился');
}

// ============ J: проигрыш — корабль захвачен ============
{
  ev(`(() => { const g = window.__game;
    g.player.crew = 2;   // перебитый экипаж
    // броня на время проверки: боевой ИИ успевает дать залп картечи
    // ДО сцепки (экипаж падает в 0 — ок; но корпус не должен дать
    // течь → «Корабль тонет — абордаж сорван», как в первом прогоне)
    g.player.hullHP = 1e6; g.player.hullMax = 1e6;
    // чистая акватория: сдавшийся галеон из H не должен висеть у
    // борта игрока (коллизионная сфера гасит ход атакующего)
    const pg = g.player.position;
    g.aiShips[2].ship.position.set(pg.x - 300, 0, pg.z);
    const ai = g.aiShips[3];
    ai.state = 'combat'; ai.tactic = 'brawler'; ai.boardCd = 0; ai.frozen = false;
    ai.ship.surrendered = false; ai.ship.crew = 30; ai.ship.anchored = false;
    const p = g.player.position; const q = g.player.quaternion;
    const L = Math.hypot(2*(q.x*q.z + q.w*q.y), 1 - 2*(q.x*q.x + q.y*q.y)) || 1;
    const ux = 2*(q.x*q.z + q.w*q.y)/L, uz = (1 - 2*(q.x*q.x + q.y*q.y))/L;
    const cd = (g.player.preset.beam + ai.ship.preset.beam)/2 + 2.6;
    ai.ship.position.set(p.x - ux*cd*2.4, p.y, p.z - uz*cd*2.4);
    ai.ship.velocity.set(0, 0, 0);
    ai.ship.quaternion.copy(g.player.quaternion);
    return 1; })()`);
  const t0 = Date.now();
  let dead = false, reason = null;
  while (Date.now() - t0 < 90000) {
    const raw = await evR(`JSON.stringify({dead: window.__game.dead, reason: window.__game.deadReason})`);
    const v = jparse(raw);
    if (v && v.dead) { dead = true; reason = v.reason; break; }
    await sleep(4000);
  }
  check('J: проигрыш абордажа — экран смерти «захвачен»', dead && reason === 'captured', `dead=${dead}, reason=${reason}`);
}

// финал
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} ${passed === results.length ? 'ALL OK' : 'HAS FAILURES'}`);
process.exit(passed === results.length ? 0 : 1);
