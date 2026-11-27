// E2E Task 91:
//  (A) КАМЕРА «КАК В ИГРАХ»: мышь вращает камеру, капитан доворачи-
//      вается ЛИЦОМ за её взглядом (борода смотрит прямо), зум — колесо;
//  (B) ЧАЙКА: вселение (B), полёт над кораблём, ПОВОДОК 100 м —
//      при удалении разворот на корабль (dist падает), выход — B/X;
//  (C) ВНУТРЕННОСТИ дощатого корпуса: шпангоуты/бимсы/бочки/ящики
//      строятся; пролом обшивки ЛОМАЕТ и их (числа + пиксельный
//      диф кадра — рендер реагирует); reset восстанавливает.
import { execSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });
mkdirSync('/home/z/my-project/download/task91', { recursive: true });

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
const mouseMove = (dx) => ev(`(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200 })); window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${200 + dx}, clientY: 200 })); return 1; })()`);
const wheel = (dy) => ev(`(() => { const c = document.querySelector('canvas'); if (c) c.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, cancelable: true })); return 1; })()`);
const snap = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
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

// ============ старт ============
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

// ============ A: КАМЕРА «КАК В ИГРАХ» (на палубе, V) ============
{
  pressKey('KeyV');
  await sleep(2000);
  const before = jparse(await evR(`(() => { const L = window.__game.lander; return JSON.stringify({ mode: L.mode, camYaw: +L.camYaw.toFixed(3), yaw: +L.yaw.toFixed(3), dist0: +L.hud().camDist.toFixed(2) }); })()`));
  // МЫШЬ: dx=420 — камера должна ПОВЕРНУТЬСЯ (Task 90 не крутила!)
  mouseMove(420);
  await sleep(2500);
  const afterMouse = jparse(await evR(`(() => { const L = window.__game.lander; return JSON.stringify({ camYaw: +L.camYaw.toFixed(3), yaw: +L.yaw.toFixed(3) }); })()`));
  // дать капитану до-доворотиться за камерой (12/с — секунды хватает)
  await sleep(3000);
  const settled = jparse(await evR(`(() => { const L = window.__game.lander; return JSON.stringify({ camYaw: +L.camYaw.toFixed(3), yaw: +L.yaw.toFixed(3) }); })()`));
  // ЗУМ колесом
  wheel(-240);
  await sleep(1500);
  const zoomed = jparse(await evR(`+window.__game.lander.hud().camDist.toFixed(2)`));
  let followErr = 9;
  if (settled) {
    let d = (settled.yaw + Math.PI) - settled.camYaw;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    followErr = Math.abs(d);
  }
  const yawFollow = afterMouse && before
    ? Math.abs(((afterMouse.yaw + Math.PI) % 6.2832) - ((afterMouse.camYaw) % 6.2832)) < 2.2 : false;
  check('A: камера-классика: мышь вращает камеру, капитан лицом за ней, зум колесом',
    !!before && before.mode === 'deck'
      && !!afterMouse && Math.abs(afterMouse.camYaw - before.camYaw) > 0.25   // мышь КРУТИТ
      && followErr < 0.3                                                     // лицо за камерой
      && !!zoomed && !!before && zoomed < before.dist0,                      // зум
    `мышь: camYaw ${before ? before.camYaw : '?'}→${afterMouse ? afterMouse.camYaw : '?'}; ошибка лица ${followErr.toFixed(2)} рад; зум ${before ? before.dist0 : '?'}→${zoomed}`);
  // выйти с палубы
  pressKey('KeyV');
  await sleep(1500);
}

// ============ B: ЧАЙКА (вселение, поводок, выход) ============
{
  pressKey('KeyB');
  await sleep(2000);
  const st0 = jparse(await evR(`JSON.stringify(window.__gullInfo())`));
  // полёт: W — ускориться и лететь от камеры 3 с
  ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`);
  await sleep(3000);
  ev(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))`);
  await sleep(1500);
  const st1 = jparse(await evR(`JSON.stringify(window.__gullInfo())`));
  // утащить чайку ЗА поводок (150 м): первый же кадр — жёсткий
  // предел 100 м + доворот курса на корабль
  ev(`(() => { const g = window.__game; const s = g.player.position;
    g.gullMode.pos.set(s.x + 150, 25, s.z + 150); return 1; })()`);
  await sleep(2000);
  const far = jparse(await evR(`JSON.stringify(window.__gullInfo())`));
  // 12 с «домой»: разворот снижает дистанцию к кораблю
  await sleep(12000);
  const home = jparse(await evR(`JSON.stringify(window.__gullInfo())`));
  snap('v91_gull');
  // выход
  pressKey('KeyB');
  await sleep(2000);
  const off = jparse(await evR(`JSON.stringify(window.__gullInfo())`));
  check('B: чайка: вселение, поводок 100 м с разворотом на корабль, выход',
    !!st0 && st0.active === true && st0.dist < 40
      && !!far && far.dist <= 100.5 && far.leash >= 0.9
      && !!home && home.dist <= 100.5 && home.dist < far.dist + 5
      && !!off && off.active === false,
    `старт ${st0 ? st0.dist + ' м' : '?'}; утащена ${far ? far.dist + ' м (leash ' + far.leash + ')' : '?'}; вернулась к ${home ? home.dist + ' м' : '?'}; после B active=${off ? off.active : '?'}`);
}

// ============ C: ВНУТРЕННОСТИ дощатого корпуса ============
{
  ev(`(() => { const g = window.__game; g.settings.gameplay.provingDistance = 40;
    g.startProving('fluyt'); g.testWarp = 240; return 1; })()`);
  await sleep(3000);
  const ps0 = jparse(await evR(`(() => { const ps = window.__game.pgTarget.ship.visual.planks;
    return JSON.stringify({ info: ps.interiorInfo(), meshVerts: ps.meshes[0].geometry.attributes.position.count, s3: ps.byState().s3 }); })()`));
  snap('v91_hull_before');
  // пролом: залп «ядра» по борту в трёх местах
  ev(`(() => { const ps = window.__game.pgTarget.ship.visual.planks;
    for (const z of [4, 7, 10]) ps.damageSide(1, 0.6, z, 420);
    return 1; })()`);
  await sleep(2500);
  const ps1 = jparse(await evR(`(() => { const ps = window.__game.pgTarget.ship.visual.planks;
    return JSON.stringify({ info: ps.interiorInfo(), meshVerts: ps.meshes[0].geometry.attributes.position.count, s3: ps.byState().s3, open: +ps.sideOpen(1, 0.6, 7).toFixed(2) }); })()`));
  snap('v91_hull_after');
  // пиксельный диф кадра: рендер реагирует на ломку
  let diff = -1;
  try {
    execSync(`python3 -c "
from PIL import Image
import numpy as np
a = np.asarray(Image.open('/home/z/my-project/scripts/shots/v91_hull_before.png').convert('L'), dtype=int)
b = np.asarray(Image.open('/home/z/my-project/scripts/shots/v91_hull_after.png').convert('L'), dtype=int)
d = np.abs(a - b)
print(round((d > 40).mean(), 4))"`, { encoding: 'utf8', timeout: 60000 });
  } catch { /* ниже через файл */ }
  try {
    const out = execSync(`python3 -c "
from PIL import Image
import numpy as np
a = np.asarray(Image.open('/home/z/my-project/scripts/shots/v91_hull_before.png').convert('L'), dtype=int)
b = np.asarray(Image.open('/home/z/my-project/scripts/shots/v91_hull_after.png').convert('L'), dtype=int)
d = np.abs(a - b)
print(round((d > 40).mean(), 4))"`, { encoding: 'utf8', timeout: 60000 }).trim();
    diff = parseFloat(out);
  } catch { diff = -1; }
  // сброс мишени: внутренности восстанавливаются
  ev(`(() => { const g = window.__game; g.resetProvingTarget(); return 1; })()`);
  await sleep(2000);
  const ps2 = jparse(await evR(`(() => { const ps = window.__game.pgTarget.ship.visual.planks;
    return JSON.stringify({ info: ps.interiorInfo(), s3: ps.byState().s3 }); })()`));
  check('C: внутренности: построены, ломаются с проломом, рендер реагирует, reset чинит',
    !!ps0 && ps0.info.pieces >= 60 && ps0.info.broken === 0
      && !!ps1 && ps1.info.broken > 0 && ps1.s3 > ps0.s3
      && ps1.meshVerts !== ps0.meshVerts
      && diff > 0.005
      && !!ps2 && ps2.info.broken === 0 && ps2.s3 === 0,
    `кусков ${ps0 ? ps0.info.pieces : '?'} (рёбер ${ps0 ? ps0.info.by.rib : '?'} бочек ${ps0 ? ps0.info.by.barrel : '?'}); после залпов: сломано внутр. ${ps1 ? ps1.info.broken : '?'}, досок s3 ${ps1 ? ps1.s3 : '?'}, sideOpen ${ps1 ? ps1.open : '?'}; пиксельный диф ${(diff * 100).toFixed(2)}%; после reset: ${ps2 ? ps2.info.broken + '/' + ps2.s3 : '?'}`);
  for (const f of ['v91_hull_after', 'v91_gull']) {
    try { execSync(`cp /home/z/my-project/scripts/shots/${f}.png /home/z/my-project/download/task91/${f}.png`, { shell: '/bin/bash' }); } catch { /* нет — не страшно */ }
  }
}

// ============ итог ============
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} ALL ${passed === results.length ? 'OK' : 'FAIL'}`);
process.exit(passed === results.length ? 0 : 1);
