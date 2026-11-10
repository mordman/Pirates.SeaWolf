// E2E Task 40: КАПИТАН НА ПАЛУБЕ + ПРЯМАЯ САБЛЯ + ПУЛЯ/ДЫМ ПИСТОЛЕТА
// + ПЛОТНОСТЬ ЛЕСА + ТЕКСТУРЫ ЗОН ОСТРОВОВ.
//  (W) ОРУЖИЕ: сабля ПРЯМАЯ (все части клинка без смещений/наклонов);
//      пистолет — выстрел ТОЛЬКО на прицеле (без ПКМ — отказ с
//      подсказкой), на прицеле — FOV ≤ 45, ПУЛЯ ВИДИМА в полёте
//      (bullets ≥ 1 сразу после выстрела), попадание убивает жителя
//  (K) КАПИТАН РАЗДАЁТ УКАЗАНИЯ: фигурка машет рукой, реплика
//      в журнале (orders растёт)
//  (D) ПРОГУЛКА ПО ПАЛУБЕ: V — сходить с мостика (фрегат с
//      квартердеком), WASD ходит по палубе, ЛЕСЕНКА поднимает на
//      квартердек (y растёт по профилю трапа, onQuarter), выход —
//      V/E у штурвала; у шлюпа (без квартердека) — палуба + мачты
//  (V) ЛЕС (Task 41: islands.treesMul): ×4 — деревьев в ~4 раза
//      больше, возврат ×1
//  (Z) ЗОНЫ ОСТРОВОВ: режим «зоны» + свои песок/трава — uniforms
//      включены (uSandOn=1, uGrassOn=1), грязь/скалы без ссылки —
//      выключены; очистка — все 0; каталог __sea.tex — 9 слотов
//  (S) СХЕМА v14: islands.treesMul/deckWalk/texUrls.sand живут перезагрузку
//  (F) 0 ошибок JS + скриншоты
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
const jparse = (s) => {
  try {
    let v = JSON.parse(String(s));
    if (typeof v === 'string') v = JSON.parse(v);
    return v;
  } catch {
    try {
      const m = String(s).match(/\{.*\}|\[.*\]/s);
      if (m) { let v = JSON.parse(m[0]); if (typeof v === 'string') v = JSON.parse(v); return v; }
    } catch { }
    return null;
  }
};
const key = (code, type = 'keydown') => ev(`window.dispatchEvent(new KeyboardEvent('${type}', {code: '${code}'})); 'ok'`);
const log = (...a) => console.log(...a);

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

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// закрыть экран капитана (Task 39), начать игру
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

// ============ W: САБЛЯ ПРЯМАЯ ============
log('\n===== W: оружие (прямая сабля) =====');
const saber = jparse(await evR(`JSON.stringify(window.__game.lander.saberInfo())`));
log(JSON.stringify(saber));
check('W1: САБЛЯ ПРЯМАЯ — все части клинка без смещений и наклонов',
  Array.isArray(saber) && saber.length >= 5
    && saber.every(p => Math.abs(p.x) < 0.001 && Math.abs(p.rx) < 0.001 && Math.abs(p.rz) < 0.001),
  `частей=${saber?.length}`);

// ============ D1: ФРЕГАТ + ПРОГУЛКА ПО ПАЛУБЕ ============
log('\n===== D: прогулка капитана по палубе =====');
// бесплатная смена на фрегат (у него есть квартердек с лесенками)
const changed = ev(`window.__game.changeShip('frigate', true) || 'ok'`);
log('changeShip:', changed);
await sleep(600);
const plan = jparse(await evR(`JSON.stringify(window.__game.debugDeckPlan())`));
log(JSON.stringify(plan));
check('D1: ФРЕГАТ с квартердеком: план палубы (трапы/мачты/шпиль)',
  plan && plan.hasQuarter === true && plan.qHeight >= 1.2 && plan.obstacles >= 4,
  `q=+${plan?.qHeight} м, препятствий=${plan?.obstacles}`);
const profile = plan?.profile ?? [];
const rise = profile.length ? profile[profile.length - 1] - profile[0] : 0;
check('D2: ПРОФИЛЬ ТРАПА: от главной палубы до настила — монотонный подъём',
  profile.length === 7 && rise >= 1.0
    && profile.every((y, i) => i === 0 || y >= profile[i - 1] - 0.02),
  `подъём ${rise.toFixed(2)} м: [${profile.join(' → ')}]`);

// V — сойти с мостика
key('KeyV');
ev(`window.__game.stepDebugNR(0.4)`);
const onDeck = jparse(await evR(`(() => {
  const g = window.__game;
  return JSON.stringify({
    mode: window.__sea.land.mode,
    onHost: g.lander.deckHost === g.player.visual.group,
    x: +g.lander.pos.x.toFixed(2), z: +g.lander.pos.z.toFixed(2), y: +g.lander.pos.y.toFixed(2),
    onQuarter: window.__sea.land.deck ? window.__sea.land.deck.onQuarter : null,
    uiOpen: g.uiOpen,
  });
})()`));
log(JSON.stringify(onDeck));
check('D3: V — КАПИТАН НА ПАЛУБЕ (фигурка на корабле, старт у штурвала)',
  onDeck && onDeck.mode === 'deck' && onDeck.onHost === true
    && (onDeck.onQuarter === true || onDeck.z < 0),
  `z=${onDeck?.z}, y=${onDeck?.y}`);
await sleep(1200);
run('screenshot /home/z/my-project/scripts/shots/t40_deck_wheel.png');

// WASD — ходьба по палубе (выровнять корабль, телепорт на мидель, W — к носу)
const walkFrom = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander, p = l.deckPlan;
  g.player.quaternion.set(0, 0, 0, 1);
  g.player.velocity.set(0, 0, 0);
  g.stepDebugNR(0.1);
  l.group.position.set(0.3, p.surfaceY(0.3, 0), 0);
  l.debugSetCam(Math.PI, 0.3);
  g.stepDebugNR(0.2);
  return JSON.stringify({x: +l.pos.x.toFixed(2), z: +l.pos.z.toFixed(2), y: +l.pos.y.toFixed(2)});
})()`));
ev(`(() => {
  const g = window.__game;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
  g.stepDebugNR(1.5);
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
  return 'walked';
})()`);
const walkTo = jparse(await evR(`JSON.stringify({x: +window.__game.lander.pos.x.toFixed(2), z: +window.__game.lander.pos.z.toFixed(2), y: +window.__game.lander.pos.y.toFixed(2)})`));
log(JSON.stringify(walkFrom), '→', JSON.stringify(walkTo));
check('D4: WASD ХОДИТ по палубе (к носу ≥ 2 м)',
  walkTo && walkTo.z - walkFrom.z >= 2,
  `Δz=+${(walkTo?.z - walkFrom?.z).toFixed(1)} м`);

// ЛЕСЕНКА: выровнять корабль (heading=0), телепорт к подножию трапа,
// подъём кормой (S при камере с кормы → к корме); onStair — напрямую
// из плана палубы (надёжнее, чем телеметрия)
const stairClimb = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander, p = l.deckPlan;
  g.player.quaternion.set(0, 0, 0, 1);
  g.player.velocity.set(0, 0, 0);
  g.stepDebugNR(0.1);
  l.group.position.set(p.stairX, p.surfaceY(p.stairX, p.stairZ0 + 0.6), p.stairZ0 + 0.6);
  const y0 = l.pos.y;
  l.debugSetCam(Math.PI, 0.25);
  g.stepDebugNR(0.2);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS'}));
  let onStair = false, yMid = 0;
  for (let i = 0; i < 30; i++) {
    g.stepDebugNR(0.2);
    if (!onStair && p.onStair(l.pos.x, l.pos.z)) onStair = true;
    if (i === 12) yMid = l.pos.y;
  }
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS'}));
  g.stepDebugNR(0.6);
  return JSON.stringify({ y0: +y0.toFixed(2), yMid: +yMid.toFixed(2), y1: +l.pos.y.toFixed(2),
    z: +l.pos.z.toFixed(2), x: +l.pos.x.toFixed(2), onStair, onQuarter: l.pos.z < p.qFrontZ });
})()`));
log(JSON.stringify(stairClimb));
check('D5: ЛЕСЕНКА на квартердек — подъём по ступеням (y растёт плавно)',
  stairClimb && stairClimb.onStair === true && stairClimb.y1 >= stairClimb.y0 + 1.0
    && stairClimb.yMid >= stairClimb.y0 + 0.1,
  `y: ${stairClimb?.y0} → ${stairClimb?.yMid} → ${stairClimb?.y1}`);
check('D6: после трапа капитан НА КВАРТЕРДЕКЕ (onQuarter)',
  stairClimb && stairClimb.onQuarter === true, JSON.stringify(stairClimb));

// выход: телепорт к штурвалу → E
const exitDeck = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander, p = l.deckPlan;
  l.group.position.set(0.4, p.surfaceY(0.4, p.wheelZ - 1.1), p.wheelZ - 1.1);
  g.stepDebugNR(0.3);
  const near = l.nearWheel;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyE'}));
  g.stepDebugNR(0.3);
  return JSON.stringify({ near, mode: window.__sea.land ? window.__sea.land.mode : l.mode });
})()`));
log(JSON.stringify(exitDeck));
check('D7: E у штурвала — КАПИТАН ВЕРНУЛСЯ К РУЛЕНИЮ',
  exitDeck && exitDeck.near === true && exitDeck.mode === 'off', JSON.stringify(exitDeck));


ev(`(() => { const g = window.__game; g.changeShip('sloop', true); g.stepDebugNR(0.3); return 'sloop'; })()`);
await sleep(400);
const sloopPlan = jparse(await evR(`JSON.stringify(window.__game.debugDeckPlan())`));
check('D8: ШЛЮП без квартердека — палуба ровная, мачты/шпиль на месте',
  sloopPlan && sloopPlan.hasQuarter === false && sloopPlan.obstacles >= 3,
  `препятствий=${sloopPlan?.obstacles}`);

// ============ P: ПИСТОЛЕТ — ТОЛЬКО НА ПРИЦЕЛЕ, ПУЛЯ ВИДИМА ============
log('\n===== P: пистолет (прицел + пуля) =====');
// высадка на остров (как v57): шлюпка → берег
ev(`(() => {
  const g = window.__game;
  g.player.anchored = true;
  g.player.position.x -= 900;
  return 'ok';
})()`);
key('KeyB');
ev(`window.__game.stepDebugNR(8)`);
ev(`(() => {
  const g = window.__game, bl = g.boatLaunch;
  const isl = g.world.islands[0];
  const ang = Math.atan2(1, -1);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let lo = 0, hi = isl.r * 2;
  for (let it = 0; it < 18; it++) { const mid = (lo + hi) / 2; if (window.__heightAt(isl.cx + ux * mid, isl.cz + uz * mid) > 0.2) lo = mid; else hi = mid; }
  const coast = (lo + hi) / 2;
  bl.pos.set(isl.cx + ux * (coast + 35), 0, isl.cz + uz * (coast + 35));
  bl.heading = ang; bl.vel = 0;
  g.stepDebugNR(0.2);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
  for (let i = 0; i < 26; i++) {
    g.stepDebugNR(6);
    const h = window.__heightAt(bl.pos.x, bl.pos.z);
    if (h > -0.75 || Math.abs(bl.vel) < 0.03) break;
  }
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
  return 'rowed';
})()`);
key('KeyE');
ev(`window.__game.stepDebugNR(0.4)`);
const landedInfo = jparse(await evR(`JSON.stringify({ mode: window.__sea.land.mode, active: window.__sea.land.active })`));
log(JSON.stringify(landedInfo));
check('P1: высадка на берег для пробы пистолета',
  landedInfo && landedInfo.active === true && landedInfo.mode === 'island', JSON.stringify(landedInfo));


const noAim = jparse(await evR(`(() => {
  const g = window.__game;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit2'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit2'}));
  g.stepDebugNR(0.2);
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 0, clientX: 640, clientY: 300, bubbles: true}));
  window.dispatchEvent(new PointerEvent('pointerup', {button: 0, bubbles: true}));
  g.stepDebugNR(0.2);
  return JSON.stringify({
    weapon: window.__sea.land.weapon,
    aiming: window.__sea.land.aiming,
    bullets: g.lander.bulletsInFlight(),
    hint: window.__game.messages.some(m => m.text.includes('прицелитесь')),
  });
})()`));
log(JSON.stringify(noAim));
check('P2: выстрел БЕЗ прицела ОТКЛОНЁН (пуль нет, подсказка «прицелитесь»)',
  noAim && noAim.weapon === 'pistol' && noAim.aiming === false
    && noAim.bullets === 0 && noAim.hint === true, JSON.stringify(noAim));


const shot = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander;
  let folk = g.debugNearestFolk(l.pos.x, l.pos.z);
  if (!folk) { const isl = g.world.islands[0]; folk = g.debugNearestFolk(isl.cx, isl.cz); }
  if (!folk) return { folk: null };
  const dx = folk.x - l.pos.x, dz = folk.z - l.pos.z;
  const yawTo = Math.atan2(dx, dz);
  l.debugTeleport(folk.x - Math.sin(yawTo) * 14, folk.z - Math.cos(yawTo) * 14);
  const chY = l.pos.y, fhY = window.__heightAt(folk.x, folk.z);
  const pitch = Math.asin(Math.max(-0.4, Math.min(0.4, (chY + 0.8 - fhY) / 9.0)));
  l.debugSetCam(yawTo + Math.PI, pitch);
  g.stepDebugNR(0.5);
  const folkBefore = window.__sea.villages.folkDead;

  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 2, clientX: 640, clientY: 300, bubbles: true}));
  g.stepDebugNR(0.5);
  const aiming = window.__sea.land.aiming;
  const fov = Math.round(g.rig.camera.fov);

  window.dispatchEvent(new MouseEvent('mousedown', {button: 0, clientX: 640, clientY: 300, bubbles: true}));
  window.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
  g.stepDebugNR(0.04);
  const bulletsInFlight = g.lander.bulletsInFlight();
  g.stepDebugNR(1.6);
  const killed = window.__sea.villages.folkDead - folkBefore;
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', {button: 2, bubbles: true}));
  g.stepDebugNR(0.3);
  return { folk: true, aiming, fov, bulletsInFlight, killed };
})()`));
log(JSON.stringify(shot));
check('P3: ПКМ — ПРИЦЕЛ (вид от прицела, FOV ≤ 45)',
  shot && shot.aiming === true && shot.fov <= 45, `FOV=${shot?.fov}`);
check('P4: ЛКМ на прицеле — ВЫСТРЕЛ (фикс бага), ПУЛЯ ВИДИМА в полёте',
  shot && shot.bulletsInFlight >= 1, `пуль в полёте: ${shot?.bulletsInFlight}`);
check('P5: пуля ДОЛЕТЕЛА — житель поражён',
  shot && shot.killed >= 1, `убито: ${shot?.killed}`);

// ============ K: КАПИТАН РАЗДАЁТ УКАЗАНИЯ ============
log('\n===== K: капитан раздаёт указания =====');
const orders = jparse(await evR(`(() => {
  const g = window.__game;
  const ok = g.debugCaptainOrder();
  g.stepDebugNR(0.4);
  const ok2 = g.debugCaptainOrder();
  g.stepDebugNR(0.4);
  return JSON.stringify({
    ok: ok && ok2,
    orders: window.__sea.captain.orders,
    last: window.__sea.captain.last,
    inLog: g.messages.some(m => m.text.startsWith('Капитан: «')),
  });
})()`));
log(JSON.stringify(orders));
check('K1: капитан на мостике МАШЕТ РУКОЙ и отдаёт приказ (реплика в журнале)',
  orders && orders.ok === true && orders.orders >= 2 && orders.last.length > 3 && orders.inLog === true,
  JSON.stringify(orders));


ev(`(() => {
  const g = window.__game, l = g.lander, bl = g.boatLaunch;
  l.debugTeleport(bl.pos.x, bl.pos.z);
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyE'}));
  g.stepDebugNR(0.3);
  bl.pos.set(g.player.position.x, 0, g.player.position.z);
  bl.heading = g.player.heading; bl.vel = 0;
  g.stepDebugNR(0.2);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyB'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyB'}));
  g.stepDebugNR(30);
  return 'aboard ' + window.__sea.boats.phase;
})()`);

// ============ V: ПЛОТНОСТЬ ЛЕСА ============
log('\n===== V: плотность леса =====');
const vegBefore = jparse(await evR(`(() => { const t = window.__sea.islands.trees; return JSON.stringify({ mul: t.globalMul, instances: t.instances }); })()`));
log(JSON.stringify(vegBefore));
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.islands.treesMul = 4; g.applySettings(s); return 'ok'; })()`);
await sleep(2500);
const veg4 = jparse(await evR(`(() => { const t = window.__sea.islands.trees; return JSON.stringify({ mul: t.globalMul, instances: t.instances }); })()`));
log(JSON.stringify(veg4));
const ratio = vegBefore && veg4 ? veg4.instances / Math.max(1, vegBefore.instances) : 0;
check('V1: ×4 — деревьев стало в ~4 раза больше (перестройка на лету)',
  veg4 && veg4.mul === 4 && ratio >= 2.4,
  `${vegBefore?.instances} → ${veg4?.instances} (×${ratio.toFixed(2)})`);
// вернуть ×1
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.islands.treesMul = 1; g.applySettings(s); return 'ok'; })()`);
await sleep(2000);
const veg1 = jparse(await evR(`(() => { const t = window.__sea.islands.trees; return JSON.stringify({ mul: t.globalMul, instances: t.instances }); })()`));
check('V2: возврат ×1 — плотность вернулась',
  veg1 && veg1.mul === 1 && Math.abs(veg1.instances - vegBefore.instances) < vegBefore.instances * 0.05,
  `инстансов: ${veg1?.instances}`);

// ============ Z: ТЕКСТУРЫ ЗОН ОСТРОВОВ ============
log('\n===== Z: зоны островов (песок/трава/грязь/скалы) =====');
const slotCount = jparse(await evR(`(() => { const t = window.__sea.tex; return JSON.stringify({ n: Object.keys(t).length, ids: Object.keys(t).sort().join(',') }); })()`));
log(JSON.stringify(slotCount));
check('Z1: каталог __sea.tex — все 9 слотов (+песок/трава/грязь/скалы)',
  slotCount && slotCount.n === 9
    && ['sand', 'grass', 'dirt', 'rock'].every(id => slotCount.ids.includes(id)),
  `слотов=${slotCount?.n}: ${slotCount?.ids}`);

// сгенерировать две текстуры зон (песок и трава)
ev(`(() => {
  const mk = (base, dots) => {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, 64, 64);
    c.fillStyle = dots;
    for (let i = 0; i < 200; i++) c.fillRect(Math.random() * 64 | 0, Math.random() * 64 | 0, 2, 1);
    return cv.toDataURL('image/png');
  };
  window.__sandUrl = mk('#d9c28f', '#b59f72');
  window.__grassUrl = mk('#5f863d', '#4a6e30');
  return 'ok';
})()`);
await sleep(200);
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.assets.islandTextures = 'zones';
  s.assets.texUrls.sand = window.__sandUrl;
  s.assets.texUrls.grass = window.__grassUrl;
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(2200);
const zonesOn = jparse(await evR(`JSON.stringify(window.__sea.zones)`));
log(JSON.stringify(zonesOn));
check('Z2: режим «ЗОНЫ»: песок и трава ЗАГРУЖЕНЫ (uniforms включены)',
  zonesOn && zonesOn.uniformsOn && zonesOn.uniformsOn.sand === 1 && zonesOn.uniformsOn.grass === 1
    && zonesOn.states.sand === 'ok' && zonesOn.states.grass === 'ok',
  JSON.stringify(zonesOn?.uniformsOn));
check('Z3: грязь/скалы без ссылок — ВЫКЛЮЧЕНЫ (цвет биома)',
  zonesOn && zonesOn.uniformsOn && zonesOn.uniformsOn.dirt === 0 && zonesOn.uniformsOn.rock === 0,
  JSON.stringify(zonesOn?.uniformsOn));
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t40_zones_textures.png');


ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.assets.texUrls.sand = ''; g.applySettings(s); return 'ok'; })()`);
await sleep(1500);
const zonesOff = jparse(await evR(`JSON.stringify(window.__sea.zones)`));
log(JSON.stringify(zonesOff));
check('Z4: очистка песка — uSandOn=0 (зона с цветом биома)',
  zonesOff && zonesOff.uniformsOn && zonesOff.uniformsOn.sand === 0 && zonesOff.uniformsOn.grass === 1,
  JSON.stringify(zonesOff?.uniformsOn));

ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.assets.islandTextures = 'grain'; s.assets.texUrls.grass = ''; g.applySettings(s); return 'ok'; })()`);
await sleep(1200);
const zonesBack = jparse(await evR(`JSON.stringify(window.__sea.zones)`));
check('Z5: возврат в «зерно» — зоны выключены',
  zonesBack && zonesBack.uniformsOn && zonesBack.uniformsOn.sand === 0 && zonesBack.uniformsOn.grass === 0,
  JSON.stringify(zonesBack?.uniformsOn));


log('\n===== S: схема v13 =====');
// сохранить настройки так же, как панель (React-стейт → localStorage);
// прямой applySettings в тесте идёт мимо панели
ev(`(() => {
  const s = JSON.parse(JSON.stringify(window.__game.settings));
  s.v = 13;
  localStorage.setItem('seawolves.settings.v1', JSON.stringify(s));
  return 'saved';
})()`);
run('reload');
await sleep(12000);
let reloaded = false;
for (let i = 0; i < 25; i++) {
  if (ev(`!!window.__game`).includes('true')) { reloaded = true; break; }
  await sleep(3000);
}
log('RELOADED:', reloaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(400);
const afterReload = jparse(await evR(`(() => {
  const d = JSON.parse(localStorage.getItem('seawolves.settings.v1') || '{}');
  return JSON.stringify({
    v: d.v,
    veg: d.islands ? d.islands.treesMul : null,
    deckWalk: d.controls ? d.controls.deckWalk : null,
    sand: d.assets && d.assets.texUrls ? d.assets.texUrls.sand : null,
  });
})()`));
log(JSON.stringify(afterReload));
check('S1: схема v14, деревья и клавиша V сохранены',
  afterReload && afterReload.v === 14 && afterReload.veg === 1 && afterReload.deckWalk === 'KeyV',
  JSON.stringify(afterReload));
check('S2: слот песка в настройках жив (пустая строка = процедурный)',
  afterReload && afterReload.sand === '', `sand="${afterReload?.sand}"`);

// ============ F: ОШИБКИ JS ============
log('\n===== F: ошибки =====');
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('F1: 0 ошибок JS', Array.isArray(errs) && errs.length === 0);

if (fails > 0) process.exit(1);
log(`\n===== ИТОГ e2e_v58: ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
