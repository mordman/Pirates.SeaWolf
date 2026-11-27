// E2E Task 90 — ТРИ ЗАКАЗА ИГРОКА:
//  (A-D) СПРАЙТЫ-ИМОСТЕРЫ ДЕРЕВЬЕВ: «фотография» 3D-модели (снимок в
//        RenderTarget 256²) → инстансные билборды; дальние острова
//        (LOD tier 2) рисуются спрайтами, при приближении — снова
//        3D; настройка в панели графики вкл/выкл; в кадре МИКС
//        (близкий остров 3D + дальние спрайты — «в перемешку»);
//  (E)   ПРОСТЫЕ МАТРОСЫ: при crewDetail='classic' абордажные
//        партии — КЛАССИЧЕСКИЕ фигуры (детальные прежде пробивали
//        настройку); при 'detailed' — детальные;
//  (F)   КАМЕРА-СЛЕДОВАНИЕ «вид сзади» (классика): камера держится
//        за спиной капитана (camYaw → yaw+π), МЫШЬ её не крутит,
//        зум — колесом;
//  (G)   VLM: далёкий остров с растительностью (спрайты) в кадре.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });
mkdirSync('/home/z/my-project/download/task90', { recursive: true });

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
const pressKey = (code) => ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}' })); return 1; })()`);
const wheel = (dy) => ev(`(() => { const c = document.querySelector('canvas'); if (c) c.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, cancelable: true })); return 1; })()`);
const treeInfo = async () => jparse(await evR(`(() => { const t = window.__treeLodInfo ? window.__treeLodInfo() : null; return JSON.stringify(t); })()`));
// опрос до условия (мс)
const waitTree = async (cond, timeoutMs, label = '') => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await treeInfo();
    if (last && cond(last)) return { ok: true, info: last };
    await sleep(4000);
  }
  return { ok: false, info: last };
};
const snap = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
// страница иногда ПЕРЕЗАГРУЖАЕТСЯ среди прогона (HMR/сбой) —
// поднять игру заново, если window.__game пропал
const ensureGame = async () => {
  const s = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify(g ? { started: !!g.started } : null); })()`));
  if (s && s.started) return true;
  for (let i = 0; i < 20; i++) {
    if (ev(`!!window.__game`).includes('true')) break;
    await sleep(2500);
  }
  ev(`window.__game.start()`);
  await sleep(2000);
  ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
  await sleep(1500);
  return true;
};
// снимок с повторами: SwiftShader иногда заикается и отдаёт БЕЛЫЙ
// кадр (3 КБ) — снимаем до непустого (> 60 КБ)
const snapGood = async (name, tries = 4) => {
  const fs = await import('node:fs');
  for (let i = 0; i < tries; i++) {
    snap(name);
    await sleep(3500);
    try {
      const st = fs.statSync(`/home/z/my-project/scripts/shots/${name}.png`);
      if (st.size > 60000) return true;
    } catch { /* файла нет — повтор */ }
  }
  return false;
};

// ============ A: старт, снимки видов построены ============
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
{
  const t = await treeInfo();
  check('A: спрайты включены, снимки видов деревьев построены',
    !!t && t.spriteEnabled === true && t.spriteKinds >= 5,
    t ? `видов со спрайтами: ${t.spriteKinds}, vis=${t.vis}` : 'нет телеметрии');
}

// ============ B: МИКС 3D + спрайты в одном кадре ============
{
  // острова редки (зазор берегов ≥ 6 км): микс = близкий остров на
  // 3D + дальний (за treeVis, tier 3) спрайтами — пока его группа
  // видна. Порог видимости островов для теста расширяем
  ev(`(() => { const g = window.__game; g.world.visDistance = 15000; return 1; })()`);
  // ближайшая ПАРА островов; игрок в 350 м от берега БЛИЗНЕГО
  ev(`(() => { const g = window.__game; const is = g.world.islands;
    let best = null, min = 1e9;
    for (let a = 0; a < is.length; a++) for (let b = 0; b < is.length; b++) {
      if (a === b) continue;
      const A = is[a], B = is[b];
      const D = Math.hypot(B.cx - A.cx, B.cz - A.cz);
      const gap = D - A.r - B.r;
      if (gap < min) { min = gap; best = { a, b, D }; }
    }
    const A = is[best.a], B = is[best.b];
    const p = A.r + 350;
    const ux = (B.cx - A.cx) / best.D, uz = (B.cz - A.cz) / best.D;
    g.player.position.set(A.cx + ux * p, 0, A.cz + uz * p);
    g.player.velocity.set(0, 0, 0);
    window.__mixPair = best;
    return JSON.stringify({ a: best.a, b: best.b, gap: Math.round(min) }); })()`);
  const r = await waitTree((t) => t.spriteSlots > 0, 60000, 'mix');
  const pair = jparse(await evR(`JSON.stringify(window.__mixPair)`));
  const mixOk = r.ok && pair && r.info.tiers[String(pair.a)] < 2;
  check('B: «в перемешку» — близкий остров 3D, дальние острова спрайтами',
    !!mixOk, r.ok
      ? `пара [${pair.a}]+[${pair.b}]: близкий tier=${r.info.tiers[String(pair.a)]} (3D), спрайт-слотов ${r.info.spriteSlots}`
      : `last=${JSON.stringify(r.info)}`);
}

// ============ C: ЗАМЕНА спрайт↔3D по приближению ============
{
  // остров[0]: r≈3.3 км. ДАЛЕКО: r+1800 (tier 2, спрайты); БЛИЗКО: r+350
  ev(`(() => { const g = window.__game; const i = g.world.islands[0];
    g.player.position.set(i.cx + i.r + 1800, 0, i.cz); g.player.velocity.set(0, 0, 0); return 1; })()`);
  const far = await waitTree((t) => t.tiers['0'] === 2, 60000, 'far');
  const farInfo = far.info;
  ev(`(() => { const g = window.__game; const i = g.world.islands[0];
    g.player.position.set(i.cx + i.r + 350, 0, i.cz); g.player.velocity.set(0, 0, 0); return 1; })()`);
  const near = await waitTree((t) => t.tiers['0'] < 2, 60000, 'near');
  check('C: далеко → спрайты, приблизились → снова 3D',
    far.ok && near.ok,
    `1800 м от берега: tier=${far.ok ? farInfo.tiers['0'] : '?'} (спрайт-слотов ${far.ok ? farInfo.spriteSlots : '?'}); 350 м: tier=${near.ok ? near.info.tiers['0'] : '?'} (3D)`);
}

// ============ D: настройка вкл/выкл ============
{
  ev(`(() => { const g = window.__game; const i = g.world.islands[0];
    g.player.position.set(i.cx + i.r + 1800, 0, i.cz); g.player.velocity.set(0, 0, 0); return 1; })()`);
  await waitTree((t) => t.tiers['0'] === 2, 60000, 'far2');
  ev(`(() => { const g = window.__game; g.settings.graphics.treeSprites = false; g.world.setTreeSprites(false); return 1; })()`);
  await sleep(3000);
  const off = await treeInfo();
  ev(`(() => { const g = window.__game; g.settings.graphics.treeSprites = true; g.world.setTreeSprites(true); return 1; })()`);
  await sleep(3000);
  const on = await treeInfo();
  check('D: настройка «Спрайты дальних деревьев»: выкл → силуэты, вкл → спрайты',
    !!off && !!on && off.spriteSlots === 0 && on.spriteSlots > 0 && on.spriteEnabled === true,
    `выкл: слотов ${off ? off.spriteSlots : '?'}; вкл: слотов ${on ? on.spriteSlots : '?'}`);
}

// ============ E: ПРОСТЫЕ МАТРОСЫ в абордаже ============
{
  ev(`(() => { const g = window.__game;
    g.settings.gameplay.provingDistance = 40;
    g.startProving('fluyt'); g.testWarp = 240;
    g.player.crew = 60; g.pgTarget.ship.crew = 60;
    // КЛАССИКА: флаги кораблей false (как после zone-LOD при 'classic')
    g.player.crewDetailedOpt = false; g.pgTarget.ship.crewDetailedOpt = false;
    g.startBoarding(g.pgTarget, true); return 1; })()`);
  const classic = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const b = jparse(await evR(`JSON.stringify(window.__game.boardingInfo())`));
      if (b && b.phase === 'fight') return b;
      await sleep(4000);
    }
    return null;
  })();
  const okClassic = !!classic && classic.detailedFighters === 0;
  // закончить первый бой (сдача цели) и повторить ДЕТАЛЬНЫМИ
  ev(`(() => { const g = window.__game; if (g.boarding) g.pgTarget.ship.surrendered = true; return 1; })()`);
  await sleep(6000);
  ev(`(() => { const g = window.__game; g.resetProvingTarget(); g.player.crew = 60; g.pgTarget.ship.crew = 60;
    g.player.crewDetailedOpt = true; g.pgTarget.ship.crewDetailedOpt = true;
    g.startBoarding(g.pgTarget, true); return 1; })()`);
  const detailed = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const b = jparse(await evR(`JSON.stringify(window.__game.boardingInfo())`));
      if (b && b.phase === 'fight') return b;
      await sleep(4000);
    }
    return null;
  })();
  check('E: простые матросы — абордажные партии классика/деталь по настройке',
    okClassic && !!detailed && detailed.detailedFighters > 0,
    `classic: детальных бойцов ${classic ? classic.detailedFighters : '?'} (бойцов ${classic ? classic.fightersA + classic.fightersD : '?'}); detailed: ${detailed ? detailed.detailedFighters : '?'}`);
}

// ============ F: КАМЕРА-СЛЕДОВАНИЕ «вид сзади» ============
{
  // бой из E мог закончиться — камеру проверяем на СВОЕМ корабле (V)
  await ensureGame();
  ev(`(() => { const g = window.__game; if (g.boarding) { g.pgTarget.ship.crew = 1; } g.lander.exitDeck(); g.lander.restoreCamera(); return 1; })()`);
  await sleep(2500);
  ev(`(() => { const g = window.__game; if (g.boarding) g.pgTarget.ship.surrendered = true; return 1; })()`);
  await sleep(5000);
  pressKey('KeyV');
  await sleep(1500);
  const onDeck = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify({ mode: g.lander.mode, camYaw: +g.lander.camYaw.toFixed(3), yaw: +g.lander.yaw.toFixed(3) }); })()`));
  // пройти вперёд (W) 2.5 с — фигурка повернётся по ходу, камера — за спину
  ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`);
  await sleep(2500);
  ev(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))`);
  await sleep(1200);
  const after = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify({ camYaw: +g.lander.camYaw.toFixed(3), yaw: +g.lander.yaw.toFixed(3), d0: +g.lander.hud().camDist.toFixed(2) }); })()`));
  // МЫШЬ: два pointermove (dx=400) — camYaw НЕ меняется (раньше крутилась)
  const beforeMouse = after ? after.camYaw : 0;
  ev(`(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 600, clientY: 200 })); return 1; })()`);
  await sleep(1500);
  const afterMouse = jparse(await evR(`(() => +window.__game.lander.camYaw.toFixed(3))()`));
  // ЗУМ колесом
  wheel(-240);
  await sleep(1500);
  const zoom = jparse(await evR(`+window.__game.lander.hud().camDist.toFixed(2)`));
  let followErr = 9;
  if (after) {
    let d = (after.yaw + Math.PI) - after.camYaw;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    followErr = Math.abs(d);
  }
  check('F: камера-следование за спиной: не крутится мышью, зум колесом',
    !!onDeck && onDeck.mode === 'deck' && followErr < 0.15
      && Math.abs((afterMouse ?? 1) - beforeMouse) < 0.01
      && !!zoom && !!after && zoom < after.d0,
    `режим=${onDeck ? onDeck.mode : '?'}; ошибка следования ${followErr.toFixed(3)} рад; camYaw при мыши ${beforeMouse}→${afterMouse}; зум ${after ? after.d0 : '?'}→${zoom}`);
}

// ============ G: VLM — далёкий остров со спрайт-деревьями ============
{
  await ensureGame();
  ev(`(() => { const g = window.__game; const i = g.world.islands[0];
    g.lander.exitDeck(); g.lander.restoreCamera();
    g.world.visDistance = 15000;
    g.player.position.set(i.cx + i.r + 1650, 0, i.cz); g.player.velocity.set(0, 0, 0);
    const ry = Math.atan2(-(i.r + 1650), 0);          // носом к острову (по -X)
    g.player.quaternion.set(0, Math.sin(ry / 2), 0, Math.cos(ry / 2));
    // изометрия смотрит на корабль сверху — остров в кадр не попадал;
    // «вид сзади» смотрит по курсу (носом к острову)
    g.rig.mode = 'rear'; g.rig.snap();
    return 1; })()`);
  await sleep(10000);
  await snapGood('v90_far_island');
  let vlm = '';
  try {
    vlm = execSync(`z-ai vision -p "Скриншот морской игры: вид с корабля. Ответь строго: 1) Виден ли вдали остров? ДА/НЕТ. 2) Есть ли на нём деревья/растительность? ДА/НЕТ." -i /home/z/my-project/scripts/shots/v90_far_island.png`, { encoding: 'utf8', timeout: 180000 }).trim();
  } catch (e) { vlm = `VLM ERR: ${e.message}`; }
  const ok = /1[).]?\s*ДА/i.test(vlm) && /2[).]?\s*ДА/i.test(vlm);
  check('G: VLM — дальний остров виден, деревья (спрайты) на нём', ok, vlm.slice(0, 140));
  execSync(`cp /home/z/my-project/scripts/shots/v90_far_island.png /home/z/my-project/download/task90/v90_far_island.png 2>/dev/null || true`, { shell: '/bin/bash' });
}

// ============ итог ============
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} ALL ${passed === results.length ? 'OK' : 'FAIL'}`);
process.exit(passed === results.length ? 0 : 1);
