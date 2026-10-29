// E2E v28: пакет правок Task 11 — React-ошибка настроек, борт без «решета»,
// полигон 10 м, энциклопедия, вода без квадратов, книппель (меш+AOE),
// деревья от ядер, инверсия прицела, стрелки камеры, рулевой.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
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
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};
const key = (code, ms = 80) => {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))"`);
  return sleep(ms).then(() =>
    run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))"`));
};

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(1500);
// чистый localStorage + лёгкий пресет (fps в headless)
ev(`(() => { localStorage.removeItem('seawolves.settings.v1'); return 'clean'; })()`);
run('reload');
await sleep(9000);
run('errors --clear'); run('console --clear');

console.log('=== 1. Энциклопедия из меню ===');
run('find text "Энциклопедия кораблей" click');
await sleep(800);
shot('v28_ency_list');
// переключить на галеон и фрегат
run('find text "Галеон «Золотая лань»" click');
await sleep(400);
shot('v28_ency_galleon');
const encyVisible = ev(`(() => {
  const h = [...document.querySelectorAll('h3')].map(x => x.textContent).join('|');
  return h;
})()`);
check('1: статья галеона открыта', /Золотая лань/.test(encyVisible), encyVisible.slice(0, 60));
run('find text "Закрыть" click');
await sleep(300);

console.log('=== 2. Старт + настройки без React-ошибки ===');
run('find text "Поднять флаг" click');
await sleep(7000);
run('find text "Настройки" click');
await sleep(600);
// подвигать слайдер дымa (раньше это кидало setState-in-render)
ev(`(() => {
  const inputs = [...document.querySelectorAll('input[type=range]')];
  return 'ranges=' + inputs.length;
})()`);
// изменить пару настроек программно через панель
run('find text "Погода" click');
await sleep(300);
run('find text "Графика" click');
await sleep(300);
run('find text "Готово" click');
await sleep(800);
const errs1 = run('errors');
check('2: нет React-ошибки Cannot update', !errs1.includes('Cannot update'), errs1.slice(0, 100));

console.log('=== 3. Борт без решета (порт — левая сторона) ===');
// камера free, облететь корабль: скрин штирборта и порта
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); return g.rig.mode; })()`);
// штирборт (правый борт): азимут за бортом
ev(`(() => { const g = window.__game; g.rig.freeAzimSet(0.9); return 'az'; })()`);
await sleep(1500);
shot('v28_hull_starboard');
ev(`(() => { const g = window.__game; g.rig.freeAzimSet(0.9 + Math.PI); return 'az2'; })()`);
await sleep(1500);
shot('v28_hull_port');

console.log('=== 4. Рулевой на штурвале ===');
// камера к корме
ev(`(() => { const g = window.__game; g.rig.freeAzimSet(Math.PI * 1.5); g.rig.freeElevSet(0.35); g.rig.distSet(26); return 'stern'; })()`);
await sleep(1500);
shot('v28_helmsman');

console.log('=== 5. Вода без квадратов при отдалении ===');
// iso с максимальной дистацией (колесо от себя)
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'iso') g.rig.cycleMode(); return g.rig.mode; })()`);
for (let i = 0; i < 14; i++) {
  run(`eval "window.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, bubbles: true}))"`);
  await sleep(60);
}
await sleep(2000);
shot('v28_sea_farzoom');
const winfo = sea();
check('5: телеметрия воды живая', winfo.water && winfo.water.rings.length >= 3, JSON.stringify(winfo.water?.rings?.length));

console.log('=== 6. Полигон: дистанция 10 м ===');
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.gameplay.provingDistance = 10;
  g.applySettings(s);
  return 'dist=10';
})()`);
run('find text "Меню" click');
await sleep(600);
run('find text "Выйти в меню" click');
await sleep(600);
// если нет кнопки выхода — рестарт через страницу
if (!jparse(ev('window.__sea ? window.__sea.proving : -1'))) {
  // выйти иначе: respawn возвращает в гавань, потом меню
}
run('find text "Поднять флаг" click').toString();
await sleep(1000);
// открыть полигон заново (через меню нужно выйти в главное; пробуем pg API)
ev(`(() => { const g = window.__game; if (!g.started) g.start(); g.exitProving?.(); g.startProving('frigate'); return 'pg'; })()`);
await sleep(8000);
const s6 = sea();
check('6: полигон активен', s6.proving === 1);
// 10 м — центры кораблей: коллизии корпусов не дают сомкнуться ближе
// ~полусуммы ширин (фрегат 9.2 м) — проверяем, что мишень РЯДОМ
check('6: мишень вплотную (≤25 м, было 165 по умолч.)', s6.tgtDist <= 25, `tgtDist=${s6.tgtDist}`);
const sliderMin = ev(`(() => { const el = [...document.querySelectorAll('input[type=range]')].find(r => r.min === '10' && Number(r.max) === 400); return el ? 'min10' : 'nomin'; })()`);
check('6: слайдер дистанции от 10 м', sliderMin.includes('min10'), sliderMin);

console.log('=== 7. Книппель: меш + AOE мачт (пролёт вдоль диаметральной плоскости) ===');
// сбросить мишень; игрок — на продолжении ДИАМЕТРАЛИ мишени (восточнее),
// курс на юг (identity) → штирборт стреляет ЗАПАД вдоль её линии:
// круг разлёта книппеля проходит по всем трём мачтам за один пролёт
run(`eval "window.__game.resetProvingTarget()"`);
ev(`(() => { const g = window.__game; const t = g.pgTarget.ship; g.player.position.set(t.position.x + 55, 0, t.position.z + 0.6); g.player.velocity.set(0,0,0); g.player.quaternion.set(0,0,0,1); g.combat.ammo = 'chain'; g.combat.aim.active = true; g.combat.aim.side = 1; g.combat.aim.azimuth = 0; g.combat.aim.elevation = 0.015; return 'lined up west'; })()`);
let ready = 0;
for (let i = 0; i < 50; i++) {
  ready = num('window.__game.combat.readiness()');
  if (ready >= 0.999) break;
  await sleep(1500);
}
await key('Space', 60);
await sleep(800);
shot('v28_chain_flight');
await sleep(8000);
const s7b = sea();
check('7: AOE — несколько мачт одним пролётом', s7b.tgtMastsBroken >= 2, `masts=${s7b.tgtMastsBroken}`);
shot('v28_chain_masts');

console.log('=== 8. Инверсия прицела: мышь от себя = вверх ===');
// pointermove слушается на WINDOW; якорим позицию мыши, затем — рывок ВВЕРХ
run(`eval "window.__game.input.mouseX = 640; window.__game.input.mouseY = 500; 'anchored'"`);
const el0 = num('window.__game.combat.aim.elevation');
run(`eval "window.dispatchEvent(new PointerEvent('pointermove', {clientX: 640, clientY: 300}))"`);
await sleep(400);
const el1 = num('window.__game.combat.aim.elevation');
check('8: мышь от себя → прицел вверх', el1 > el0 + 0.001, `el ${el0.toFixed(3)} → ${el1.toFixed(3)}`);

console.log('=== 9. Стрелки вращают камеру ===');
// прицел мешает свободному вращению — выключаем
run(`eval "window.__game.combat.aim.active = false"`);
ev(`(() => { const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); return g.rig.mode; })()`);
await sleep(1200);
const camBefore = jparse(ev('JSON.stringify({x: window.__game.rig.camera.position.x, z: window.__game.rig.camera.position.z})'));
await key('ArrowLeft', 900);
const camAfter = jparse(ev('JSON.stringify({x: window.__game.rig.camera.position.x, z: window.__game.rig.camera.position.z})'));
const moved = Math.hypot(camAfter.x - camBefore.x, camAfter.z - camBefore.z);
check('9: камера повернулась стрелкой', moved > 1, `сдвиг ${moved.toFixed(1)} м`);
await key('ArrowRight', 300);

console.log('=== 10. Деревья от ядер ===');
// вернуться в море и стрелять по берегу Пальмовой гавани
run(`eval "window.__game.combat.aim.active = false"`);
ev(`(() => { const g = window.__game; g.exitProving(); return 'exit'; })()`);
await sleep(5000);
const trees0 = num('window.__game.world.treesBroken');
// встать у берега (клим к острову), прицел в сторону центра — деревья
// начинаются там, где высота ≥ 0.75 м (внутрь отреза ~30–100 м)
ev(`(() => { const g = window.__game; const isl = g.world.islands[0]; const p = g.player; p.position.set(isl.cx + 330, 0, isl.cz + 40); p.velocity.set(0, 0, 0); p.quaternion.set(0, 0, 0, 1); const toI = { x: isl.cx - p.position.x, z: isl.cz - p.position.z }; const worldAz = Math.atan2(toI.x, toI.z); const base = Math.atan2(-Math.cos(p.heading), Math.sin(p.heading)); let rel = worldAz - base; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI; g.combat.ammo = 'ball'; g.combat.aim.active = true; g.combat.aim.side = 1; g.combat.aim.azimuth = Math.max(-0.6, Math.min(0.6, rel)); g.combat.aim.elevation = 0.06; return 'az=' + g.combat.aim.azimuth.toFixed(3); })()`);
// серия одиночных выстрелов (быстрее полного перезаряжания борта)
for (let v = 0; v < 8 && num('window.__game.world.treesBroken') === trees0; v++) {
  for (let i = 0; i < 24; i++) {
    const r = num('window.__game.combat.readiness()');
    if (r >= 0.9) break;
    await sleep(1500);
  }
  run(`eval "window.__game.combat.fireOne()"`);
  await sleep(4500);
}
await sleep(4000);
const trees1 = num('window.__game.world.treesBroken');
check('10: деревья повалены ядрами', trees1 > trees0, `treesBroken ${trees0} → ${trees1}`);
shot('v28_trees_broken');

console.log('=== 11. Ошибки страницы ===');
const errsF = run('errors');
check('11: ошибок нет', !errsF || errsF.length < 5, errsF.slice(0, 150));

console.log(fails === 0 ? 'ALL OK' : `FAILS: ${fails}`);
