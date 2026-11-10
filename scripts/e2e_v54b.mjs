// E2E Task 36 — ЧАСТЬ 2: ВЫСАДКА (полный цикл: шлюпка → берег →
// третье лицо → WASD → сабля → пистолет с прицелом → шлюпка).
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
// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);
await sleep(300);
ev(`window.__game.start()`);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

log('\n===== H: ВЫСАДКА НА ОСТРОВ (третье лицо, WASD, оружие) =====');
ev(`(() => { const g = window.__game; g.player.anchored = true; g.player.position.x -= 900; return 'ok'; })()`);
key('KeyB');
ev(`window.__game.stepDebugNR(8)`);
const boatPhase = ev(`window.__sea.boats ? window.__sea.boats.phase : 'none'`);
check('H1: шлюпка спущена', String(boatPhase).includes('afloat'), String(boatPhase));

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
  return 'rowed to h=' + window.__heightAt(bl.pos.x, bl.pos.z).toFixed(2);
})()`);
const atShore = jparse(ev(`(() => { const bl = window.__game.boatLaunch; return JSON.stringify({ h: +window.__heightAt(bl.pos.x, bl.pos.z).toFixed(2), near: bl.nearShore(), hud: window.__game.hud.land.canLand }); })()`));
log(JSON.stringify(atShore));
check('H2: шлюпка подошла к берегу (мель ~−0.6 м, подсказка высадки)',
  atShore.near === true && atShore.hud === true && atShore.h > -1.5 && atShore.h < 0.2, `h=${atShore.h}`);

key('KeyE');
ev(`window.__game.stepDebugNR(0.4)`);
const land1 = jparse(ev(`JSON.stringify(window.__sea.land)`));
log(JSON.stringify(land1));
check('H3: моряк ВЫСАДИЛСЯ (на суше, шлюпка заморожена)',
  land1.active === true && land1.h > 0.5 && land1.frozenBoat === true, `h=${land1.h} м`);

const cam1 = jparse(ev(`(() => {
  const g = window.__game, l = g.lander, cam = g.rig.camera;
  const d = Math.hypot(cam.position.x - (l.pos.x + g.worldGroup.position.x), cam.position.z - (l.pos.z + g.worldGroup.position.z));
  return JSON.stringify({ dist: +d.toFixed(1), fov: cam.fov });
})()`));
log(JSON.stringify(cam1));
check('H4: камера ЗА СПИНОЙ (третье лицо, 3–9 м)', cam1.dist >= 3 && cam1.dist <= 9, `${cam1.dist} м`);
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t36_e2e_rear.png');

const before = jparse(ev(`JSON.stringify({x: +window.__game.lander.pos.x.toFixed(1), z: +window.__game.lander.pos.z.toFixed(1)})`));
key('KeyW');
ev(`window.__game.stepDebugNR(2.5)`);
key('KeyW', 'keyup');
const after = jparse(ev(`(() => { const l = window.__game.lander; return JSON.stringify({ x: +l.pos.x.toFixed(1), z: +l.pos.z.toFixed(1), h: +l.pos.y.toFixed(2) }); })()`));
const walked = Math.hypot(after.x - before.x, after.z - before.z);
log(`${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
check('H5: WASD ходит (≥ 6 м за 2.5 с; вброд можно)',
  walked >= 6 && after.h > -0.6, `${walked.toFixed(1)} м, h=${after.h}`);

const saber = jparse(ev(`(() => {
  const g = window.__game, l = g.lander;
  const isl = g.world.islands[0];
  let bush = g.debugNearestCuttable(l.pos.x, l.pos.z, 600);
  if (!bush) bush = g.debugNearestCuttable(isl.cx, isl.cz, 3500);
  if (!bush) return { bush: null };
  l.debugTeleport(bush.x - Math.sin(l.yaw) * 1.4, bush.z - Math.cos(l.yaw) * 1.4);
  const before = g.world.treesBroken;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit1'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit1'}));
  g.stepDebugNR(0.25);
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 0, clientX: 640, clientY: 300, bubbles: true}));
  window.dispatchEvent(new PointerEvent('pointerup', {button: 0, bubbles: true}));
  g.stepDebugNR(0.9);
  return { bush: bush.kind, before, after: g.world.treesBroken, weapon: window.__sea.land.weapon };
})()`));
log(JSON.stringify(saber));
check('H6: САБЛЯ достаётся (1) и РУБИТ куст (treesBroken вырос)',
  saber.weapon === 'saber' && saber.after > saber.before && saber.bush !== null,
  `${saber.bush}, сломано ${saber.before}→${saber.after}`);
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t36_e2e_saber.png');

const pistol = jparse(ev(`(() => {
  const g = window.__game, l = g.lander;
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit2'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Digit2'}));
  let folk = g.debugNearestFolk(l.pos.x, l.pos.z);
  if (!folk) {
    const isl = g.world.islands[0];
    folk = g.debugNearestFolk(isl.cx, isl.cz);
  }
  if (!folk) return { folk: null, weapon: window.__sea.land.weapon };
  const dx = folk.x - l.pos.x, dz = folk.z - l.pos.z;
  const yawTo = Math.atan2(dx, dz);
  l.debugTeleport(folk.x - Math.sin(yawTo) * 10, folk.z - Math.cos(yawTo) * 10);
  const chY = l.pos.y;
  const fhY = window.__heightAt(folk.x, folk.z);
  const pitch = Math.asin(Math.max(-0.4, Math.min(0.4, (chY + 0.6 - fhY) / 6.0)));
  l.debugSetCam(yawTo + Math.PI, pitch);
  g.stepDebugNR(0.6);
  const folkBefore = window.__sea.villages.folkDead;
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 2, clientX: 640, clientY: 300, bubbles: true}));
  g.stepDebugNR(0.6);
  const aiming = window.__sea.land.aiming;
  const fov = g.rig.camera.fov;
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', {button: 0, clientX: 640, clientY: 300, bubbles: true}));
  window.dispatchEvent(new PointerEvent('pointerup', {button: 0, bubbles: true}));
  g.stepDebugNR(1.4);
  const killed = window.__sea.villages.folkDead - folkBefore;
  window.dispatchEvent(new PointerEvent('pointerup', {button: 2, bubbles: true}));
  g.stepDebugNR(0.3);
  return { folk: true, aiming, fov: +fov.toFixed(0), killed, weapon: window.__sea.land.weapon };
})()`));
log(JSON.stringify(pistol));
check('H7: ПИСТОЛЕТ (2) + ПРИЦЕЛ ПКМ (вид от прицела, FOV ≤ 45)',
  pistol.weapon === 'pistol' && pistol.aiming === true && pistol.fov <= 45, `FOV ${pistol.fov}`);
check('H8: ВЫСТРЕЛ поражает жителя (killed ≥ 1)', pistol.killed >= 1, `убито ${pistol.killed}`);

const back = jparse(ev(`(() => {
  const g = window.__game, l = g.lander, bl = g.boatLaunch;
  l.debugTeleport(bl.pos.x, bl.pos.z);
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyE'}));
  g.stepDebugNR(0.3);
  return { active: window.__sea.land.active, frozen: window.__sea.land.frozenBoat, phase: window.__sea.boats.phase };
})()`));
log(JSON.stringify(back));
check('H9: E у шлюпки — ОБРАТНО НА ВОДУ', back.active === false && back.frozen === false && back.phase === 'afloat');

const errsH = jparse(ev(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errsH));
check('I1: 0 ошибок JS (высадка/оружие)', Array.isArray(errsH) && errsH.length === 0);

log(`\n===== ИТОГ e2e_v54 (часть 2: высадка): ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
if (fails > 0) process.exit(1);
