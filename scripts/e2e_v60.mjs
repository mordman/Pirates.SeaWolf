// E2E Task 42: LOD ДАЛЬНИХ ДЕРЕВЬЕВ + ОРУЖИЕ В РУКЕ (нет «третьей
// руки») + ГАРДЕРОБ (шляпы/футболки/свитера/костюмы/узоры/голый
// торс/шорты/рваные шорты).
//  (A) LOD: телепорт между островами — ближний full (GLB у пальм),
//      дальний (off>700 от берега) на УПРОЩЁННОЙ геометрии,
//      экономия треугольников ≥ 50%, при приближении — возврат
//      полной (гистерезис 700/600)
//  (B) ОРУЖИЕ В РУКЕ: сабля/пистолет — дети МАУНТА У КИСТИ;
//      при ходьбе с оружием рука НЕ МАШЕТ (амплитуда 0), без
//      оружия — машет (амплитуда > 0.5); прицел — пистолет в
//      руке, FOV ≤ 45, выстрел работает
//  (C) ГАРДЕРОБ: probe(240) — все 8 видов торса, 3 кроя штанов,
//      7 головных уборов; маунт у кисти 100%; попугаи 5–16%
//  (D) ЭКРАН КАПИТАНА: селекторы «Одежда» (8) и «Штаны» (3),
//      головной убор 7 видов; выбор «Голый торс»+«Шорты»+
//      «Цилиндр» → применяется к фигурке, схема v15 живёт
//      перезагрузку
//  (E) 0 ошибок JS + скриншоты
import { execSync } from 'node:child_process';

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
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
// agent-browser печатает примитивы как JSON-строки («true») —
// разворачиваем двойное кодирование
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
let loaded = false;
await sleep(12000);
for (let i = 0; i < 30; i++) {
  if (ev(`!!window.__game`).includes('true')) { loaded = true; break; }
  await sleep(3000);
}
log('GAME LOADED:', loaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(300);

// закрыть экран капитана, начать игру
ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (scr) {
    const btn = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже'));
    if (btn) btn.click();
  }
  return 'ok';
})()`);
await sleep(800);
ev(`window.__game.start()`);
await sleep(600);

// ============ A: LOD ДАЛЬНИХ ДЕРЕВЬЕВ ============
log('\n===== A: LOD — дальние острова на упрощённых моделях =====');
// телепорт корабля у берега «Пальмовой гавани» (islands[0]) В СТОРОНУ
// «Кайманова ключа» — тот виден, но его берег далеко (off ~6000)
const lodFar = jparse(await evR(`(() => {
  const g = window.__game;
  const is = g.world.islands;
  const A = is[0];
  const B = is.find(i => i.name === 'Кайманов ключ') ?? is[20];
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  const len = Math.hypot(dx, dz);
  const px = A.cx + dx / len * (A.r + 300), pz = A.cz + dz / len * (A.r + 300);
  g.player.position.set(px, 0, pz);
  g.player.velocity.set(0, 0, 0);
  g.player.angular.set(0, 0, 0);
  g.rig.snap();
  g.stepDebugNR(0.5);
  const info = g.world.treeLodInfo();
  return JSON.stringify({
    offB: Math.round(Math.hypot(px - B.cx, pz - B.cz) - B.r),
    farIslands: info.farIslands, lodSlots: info.lodSlots,
    trisFull: info.trisFull, trisLod: info.trisLod,
    palm: info.kinds.palm, bamboo: info.kinds.bamboo,
  });
})()`));
log(JSON.stringify(lodFar));
check('A1: дальний видимый остров (off>700 от берега) ПЕРЕКЛЮЧИЛСЯ на LOD',
  lodFar && lodFar.farIslands >= 1 && lodFar.lodSlots >= 5,
  `off=${lodFar?.offB} м, островов far=${lodFar?.farIslands}, слотов=${lodFar?.lodSlots}`);
check('A2: LOD-модель ДЕШЕВЛЕ полной минимум вдвое (palm/bamboo)',
  lodFar && lodFar.palm && lodFar.bamboo
    && lodFar.palm.lod * 2 < lodFar.palm.full
    && lodFar.bamboo.lod * 2 < lodFar.bamboo.full,
  `palm ${lodFar?.palm?.full}→${lodFar?.palm?.lod} трис, bamboo ${lodFar?.bamboo?.full}→${lodFar?.bamboo?.lod}`);
check('A3: экономия треугольников на LOD-острове ≥ 50%',
  lodFar && lodFar.trisFull > 0 && lodFar.trisLod * 2 < lodFar.trisFull,
  `${lodFar?.trisFull} → ${lodFar?.trisLod} (${lodFar?.trisFull ? Math.round((1 - lodFar.trisLod / lodFar.trisFull) * 100) : 0}%)`);

// подплыть вплотную к «Кайманову ключу» — он вернётся к полной модели
const lodNear = jparse(await evR(`(() => {
  const g = window.__game;
  const is = g.world.islands;
  const A = is[0];
  const B = is.find(i => i.name === 'Кайманов ключ') ?? is[20];
  const dx = A.cx - B.cx, dz = A.cz - B.cz;
  const len = Math.hypot(dx, dz);
  g.player.position.set(B.cx + dx / len * (B.r + 300), 0, B.cz + dz / len * (B.r + 300));
  g.player.velocity.set(0, 0, 0);
  g.rig.snap();
  g.stepDebugNR(0.5);
  const info = g.world.treeLodInfo();
  const veg = g.world.vegStats();
  return JSON.stringify({
    farIslands: info.farIslands, fullSlots: info.fullSlots,
    palmSrc: veg.palm.src, ficusSrc: veg.ficus.src,
  });
})()`));
log(JSON.stringify(lodNear));
check('A4: у берега остров вернул ПОЛНУЮ модель (пальмы GLB/proc, не lod)',
  lodNear && lodNear.palmSrc !== 'lod' && lodNear.ficusSrc !== 'lod',
  `palm=${lodNear?.palmSrc}, ficus=${lodNear?.ficusSrc}, far-островов=${lodNear?.farIslands}`);
check('A5: сосед (дальний) остался на LOD — переключение по-островно',
  lodNear && lodNear.farIslands >= 1,
  `far-островов=${lodNear?.farIslands}`);

// ============ B: ОРУЖИЕ В РУКЕ (нет «третьей руки») ============
log('\n===== B: оружие в руке =====');
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  g.lander.spawn(isl.cx, isl.cz);
  g.stepDebugNR(0.3);
  return 'высадка';
})()`);
await sleep(400);
// сабля: экипировать и замерить амплитуду руки при ходьбе
const saberWalk = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit1'}));
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit1'}));
  g.stepDebugNR(0.5);
  const wi = l.weaponInfo();
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
  const poses = [];
  for (let i = 0; i < 30; i++) { g.stepDebugNR(0.08); poses.push(wi === null ? 0 : l.weaponInfo().wristPose); }
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
  const amp = Math.max(...poses) - Math.min(...poses);
  return JSON.stringify({ weapon: wi.weapon, mounted: wi.saberMounted, amp: +amp.toFixed(3) });
})()`));
log(JSON.stringify(saberWalk));
check('B1: САБЛЯ В РУКЕ — родитель = маунт у кисти (не корень фигурки)',
  saberWalk && saberWalk.weapon === 'saber' && saberWalk.mounted === true,
  `weapon=${saberWalk?.weapon}, mounted=${saberWalk?.mounted}`);
check('B2: при ходьбе с саблей рука НЕ МАШЕТ (амплитуда ~0)',
  saberWalk && saberWalk.amp < 0.05,
  `амплитуда=${saberWalk?.amp}`);

// убрать оружие: рука снова машет
const freeWalk = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyX'}));
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyX'}));
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
  const poses = [];
  for (let i = 0; i < 30; i++) { g.stepDebugNR(0.08); poses.push(l.weaponInfo().wristPose); }
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
  const amp = Math.max(...poses) - Math.min(...poses);
  return JSON.stringify({ weapon: l.weaponInfo().weapon, amp: +amp.toFixed(3) });
})()`));
log(JSON.stringify(freeWalk));
check('B3: без оружия рука при ходьбе МАШЕТ (амплитуда > 0.5)',
  freeWalk && freeWalk.weapon === 'none' && freeWalk.amp > 0.5,
  `weapon=${freeWalk?.weapon}, амплитуда=${freeWalk?.amp}`);

// пистолет: в маунте + прицел (рука вытянута, FOV ≤ 45) + выстрел
// (KeyX сначала — гарантировать «без оружия», Digit2 — экипировать)
ev(`(() => {
  const g = window.__game;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyX'}));
  g.stepDebugNR(0.2);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyX'}));
  g.stepDebugNR(0.2);
  return 'оружие снято';
})()`);
const pistolAim = jparse(await evR(`(() => { const g = window.__game, l = g.lander; window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit2'})); g.stepDebugNR(0.3); window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit2'})); g.stepDebugNR(0.4); const wi = l.weaponInfo(); document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 2, clientX: 640, clientY: 300, bubbles: true})); g.stepDebugNR(0.5); const aiming = window.__sea.land.aiming; const fov = Math.round(g.rig.camera.fov); const wiAim = l.weaponInfo(); window.dispatchEvent(new MouseEvent('mousedown', {button: 0, clientX: 640, clientY: 300, bubbles: true})); window.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true})); g.stepDebugNR(0.06); const bullets = l.bulletsInFlight(); g.stepDebugNR(1.2); document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', {button: 2, bubbles: true})); g.stepDebugNR(0.3); return JSON.stringify({ weapon: wi.weapon, mounted: wi.pistolMounted, aiming, fov, wristAim: wiAim.wristPose, bullets }); })()`));
log(JSON.stringify(pistolAim));
check('B4: ПИСТОЛЕТ В РУКЕ — маунт у кисти',
  pistolAim && pistolAim.weapon === 'pistol' && pistolAim.mounted === true,
  `mounted=${pistolAim?.mounted}`);
check('B5: ПРИЦЕЛ — рука с пистолетом вытянута (pose ≈ −π/2), FOV ≤ 45',
  pistolAim && pistolAim.aiming === true && pistolAim.fov <= 45
    && pistolAim.wristAim < -1.0,
  `aiming=${pistolAim?.aiming}, FOV=${pistolAim?.fov}, pose=${pistolAim?.wristAim}`);
check('B6: ВЫСТРЕЛ с прицела работает (пуля в полёте)',
  pistolAim && pistolAim.bullets >= 1,
  `пуль: ${pistolAim?.bullets}`);

// ============ C: ГАРДЕРОБ (процедурные фигурки) ============
log('\n===== C: гардероб — все виды встречаются =====');
const probe = jparse(await evR(`JSON.stringify(window.__game.debugFigureProbe(240))`));
log(JSON.stringify(probe));
const torsos = probe ? Object.keys(probe.torsoKinds) : [];
const pants = probe ? Object.keys(probe.pantsKinds) : [];
const hats = probe ? Object.keys(probe.hatKinds) : [];
check('C1: ВСЕ 8 видов торса встречаются (вкл. ГОЛЫЙ ТОРС и ПОЛОСЫ)',
  torsos.length >= 8 && torsos.includes('bare') && torsos.includes('striped') && torsos.includes('stripedV')
    && torsos.includes('tshirt') && torsos.includes('sweater') && torsos.includes('vest') && torsos.includes('coat'),
  `виды: ${torsos.join(',')}`);
check('C2: ВСЕ 3 кроя штанов (длинные/шорты/РВАНЫЕ)',
  pants.length >= 3 && pants.includes('long') && pants.includes('shorts') && pants.includes('torn'),
  `виды: ${pants.join(',')}`);
check('C3: ВСЕ 7 головных уборов (вкл. широкополая/соломенная/вязаная/цилиндр)',
  hats.length >= 7 && ['wide', 'straw', 'cap', 'top', 'bandana', 'hat', 'none'].every(h => hats.includes(h)),
  `виды: ${hats.join(',')}`);
check('C4: МАУНТ у кисти у всех фигурок (оружие следует за рукой)',
  probe && probe.wristMounts === probe.n,
  `${probe?.wristMounts}/${probe?.n}`);
check('C5: попугаи по-прежнему ~10% (5–16%)',
  probe && probe.parrotPct >= 5 && probe.parrotPct <= 16,
  `${probe?.parrotPct}%`);

// ============ D: ЭКРАН КАПИТАНА + СХЕМА v15 ============
log('\n===== D: экран капитана — гардероб и схема v15 =====');
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(6000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!document.querySelector('[data-char-screen]')`).includes('true')) break;
  await sleep(2000);
}
const scrInfo = jparse(await evR(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (!scr) return { screen: false };
  const pills = [...scr.querySelectorAll('button')].map(b => b.textContent.trim());
  return {
    screen: true,
    одежды: ['Рубаха','Тельняшка','Полосы (вертик.)','Футболка','Свитер','Жилет','Камзол','Голый торс'].filter(t => pills.includes(t)).length,
    штаны: ['Длинные','Шорты','Рваные шорты'].filter(t => pills.includes(t)).length,
    уборы: ['Без убора','Бандана','Треуголка','Широкополая','Соломенная','Вязаная шапка','Цилиндр'].filter(t => pills.includes(t)).length,
  };
})()`));
log(JSON.stringify(scrInfo));
check('D1: на экране капитана все 8 видов ОДЕЖДЫ',
  scrInfo && scrInfo.screen === true && scrInfo['одежды'] === 8,
  `одежд=${scrInfo && scrInfo['одежды']}`);
check('D2: все 3 вида ШТАНОВ (вкл. рваные шорты)',
  scrInfo && scrInfo['штаны'] === 3,
  `штанов=${scrInfo && scrInfo['штаны']}`);
check('D3: все 7 ГОЛОВНЫХ УБОРОВ',
  scrInfo && scrInfo['уборы'] === 7,
  `уборов=${scrInfo && scrInfo['уборы']}`);

// выбрать «Голый торс» + «Шорты» + «Цилиндр» → «В море!»
// (клики с паузами: React ре-рендерится между ними — иначе кнопка
// «В море!» уйдёт со СТАРЫМ состоянием)
const applied = { ok: false };
for (const label of ['Голый торс', 'Шорты', 'Цилиндр']) {
  const r = jparse(await evR(`(() => {
    const scr = document.querySelector('[data-char-screen]');
    if (!scr) return false;
    const b = [...scr.querySelectorAll('button')].find(x => x.textContent.trim() === '${label}');
    if (b) b.click();
    return !!b;
  })()`));
  applied[label] = r;
  await sleep(400);
}
const goRes = jparse(await evR(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (!scr) return false;
  const go = [...scr.querySelectorAll('button')].find(x => x.textContent.includes('В море'));
  if (go) go.click();
  return !!go;
})()`));
applied.ok = !!(applied['Голый торс'] && applied['Шорты'] && applied['Цилиндр'] && goRes);
await sleep(1500);
ev(`window.__game.start()`);
await sleep(800);
const capInfo = jparse(await evR(`(() => {
  const g = window.__game;
  const fi = g.lander.figureInfo();
  const st = JSON.parse(localStorage.getItem('seawolves.settings.v1') ?? '{}');
  return JSON.stringify({
    torso: fi.torso, pantsKind: fi.pantsKind, headwear: fi.headwear,
    v: st.v, pTorso: st.player && st.player.torso, pPants: st.player && st.player.pantsKind,
    pHat: st.player && st.player.headwear,
  });
})()`));
log(JSON.stringify(applied), JSON.stringify(capInfo));
check('D4: выбранный ГАРДЕРОБ применился к капитану (голый торс/шорты/цилиндр)',
  capInfo && capInfo.torso === 'bare' && capInfo.pantsKind === 'shorts' && capInfo.headwear === 'top',
  `торс=${capInfo?.torso}, штаны=${capInfo?.pantsKind}, убор=${capInfo?.headwear}`);
check('D5: СХЕМА v15: гардероб сохранён в настройках',
  capInfo && capInfo.v >= 15 && capInfo.pTorso === 'bare' && capInfo.pPants === 'shorts' && capInfo.pHat === 'top',
  `v=${capInfo?.v}, player.torso=${capInfo?.pTorso}, pantsKind=${capInfo?.pPants}, headwear=${capInfo?.pHat}`);

// перезагрузка: настройки живут, фигурка капитана в выбранном виде
run('reload');
await sleep(6000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2000);
}
// переустановить хук ошибок (после reload старый пропал)
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (scr) {
    const btn = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже'));
    if (btn) btn.click();
  }
  window.__game.start();
  return 'ok';
})()`);
await sleep(1000);
const afterReload = jparse(await evR(`(() => {
  const g = window.__game;
  const st = JSON.parse(localStorage.getItem('seawolves.settings.v1') ?? '{}');
  const fi = g.lander.figureInfo();
  return JSON.stringify({ v: st.v, torso: fi.torso, pantsKind: fi.pantsKind, headwear: fi.headwear });
})()`));
log(JSON.stringify(afterReload));
check('D6: после перезагрузки схема v15 и ВНЕШНОСТЬ на месте',
  afterReload && afterReload.v >= 15 && afterReload.torso === 'bare'
    && afterReload.pantsKind === 'shorts' && afterReload.headwear === 'top',
  `v=${afterReload?.v}, торс=${afterReload?.torso}, штаны=${afterReload?.pantsKind}, убор=${afterReload?.headwear}`);

// ============ E: ошибки JS + скриншоты ============
log('\n===== E: финал =====');
const errs = jparse(await evR(`window.__jsErrors ? window.__jsErrors.length : -1`));
log('JS errors:', errs);
check('E1: 0 ошибок JS', errs === 0, `ошибок: ${errs}`);

run(`screenshot scripts/shots/t42_char_garden.png`);
ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[0];
  g.lander.spawn(isl.cx, isl.cz);
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit1'}));
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit1'}));
  g.stepDebugNR(1.2);
  return 'сабля';
})()`);
await sleep(400);
run(`screenshot scripts/shots/t42_saber_in_hand.png`);
run(`screenshot scripts/shots/t42_bare_torso.png`);

log(`\n===== ИТОГ e2e_v60: ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
process.exit(fails === 0 ? 0 : 1);
