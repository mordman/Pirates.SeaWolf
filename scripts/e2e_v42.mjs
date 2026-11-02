// E2E Task 25 — по замечаниям игрока:
//  (A) ШЛЮПКА: «палочка сзади» (руль с румпелем) УБРАНА; лодка
//      развёрнута НОСОМ ВДОЛЬ КОРПУСА (к носу корабля) у всех
//      типов судов; шлюпбалки/фалы целы
//  (B) ПОДЪЁМ БЕЗ ПЕРЕВОРОТА: худший случай — шлюпка подошла к
//      корме КОРМОЙ (курс на 180° от стоянки): доворот по
//      кратчайшей дуге, качка гаснет, точно на шлюпбалки; цикл цел
//  (C) ФИЗИКА (Gerstner + rigid body + Архимед по точкам корпуса):
//      штиль — корабль сидит по проектную осадку, киль в воде,
//      без NaN; качка живая (дифферент/крен), но ограничена;
//      шторм — корабль РЕЖЕТ волны (дифферент > 0.09), не тонет
//  (D) ЗЕЛЁНАЯ ВОДА: слишком большая волна накрывает палубу
//      (greenWater > 0 у шлюпа в шторм), после накрытия корабль
//      всплывает (freeboard восстанавливается)
//  (E) скриншоты + 0 ошибок JS
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
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
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ================= A: шлюпка — без руля, носом вдоль =================
log('=== A: шлюпка — «палочка» убрана, нос вдоль корпуса ===');
for (const model of ['frigate', 'cog', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    const bv = p.visual.boat;
    if (!bv) return JSON.stringify({ ok: false });
    const b = bv.group;
    // мировой разворот: нос шлюпки vs нос корабля
    b.updateWorldMatrix(true, false);
    const bm = b.matrixWorld.elements;
    const bow = [bm[8], bm[9], bm[10]];
    const sm = p.visual.group.matrixWorld.elements;
    const fwd = [sm[8], sm[9], sm[10]];
    const dot = bow[0]*fwd[0] + bow[1]*fwd[1] + bow[2]*fwd[2];
    // задняя кромка корпуса шлюпки: не дальше транца + 15 см
    // (перо руля торчало на 16% длины за транец)
    let minZ = 1e9;
    const pos = b.children[0].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < minZ) minZ = z;
    }
    return JSON.stringify({
      ok: true, model: '${model}',
      rotY: +(((b.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(2),
      dot: +dot.toFixed(3),
      children: b.children.length,
      tillerVis: !!bv.tiller, tillerUd: !!b.userData.tiller,
      minZ: +minZ.toFixed(2), len: +bv.len.toFixed(2),
      x: +b.position.x.toFixed(2), z: +b.position.z.toFixed(2), y: +b.position.y.toFixed(2),
      stowX: +bv.stowPos.x.toFixed(2),
      hullW: +p.halfWidthAt(b.position.z).toFixed(2),
      beam: +bv.beam.toFixed(2),
      L: p.preset.length, freeboard: p.preset.freeboard,
      fallsPts: bv.falls.geometry.getAttribute('position').count,
      davitHeads: bv.davitHeads.length,
    });
  })()`));
  log(`A[${model}]:`, JSON.stringify(r));
  check(`A: ${model} — БЕЗ руля-«палочки» (румпеля нет, сзади не торчит)`,
    r.ok && !r.tillerVis && !r.tillerUd && r.children <= 5
      && r.minZ > -r.len / 2 - 0.15,
    `tiller=${r.tillerVis}/${r.tillerUd} children=${r.children} (корпус+2 вёсла+2 гребца) minZ=${r.minZ} (транец ${(-r.len / 2).toFixed(1)})`);
  check(`A: ${model} — НОСОМ ВДОЛЬ КОРПУСА (нос к носу корабля)`,
    r.ok && (r.rotY < 0.1 || r.rotY > Math.PI * 2 - 0.1) && r.dot > 0.9,
    `rotY=${r.rotY} dot=${r.dot}`);
  check(`A: ${model} — БОРТОМ К БОРТУ на шлюпбалках (зазор < 1.2 м), фалы целы`,
    r.ok && Math.abs(r.x - r.stowX) < 0.05
      && r.x > r.hullW && r.x - r.beam / 2 - r.hullW < 1.2
      && r.z > -r.L * 0.55 && r.z < -r.L * 0.1 && r.y > r.freeboard * 0.95
      && r.fallsPts === 8 && r.davitHeads === 2,
    `x=${r.x} (борт ${r.hullW}) зазор=${+(r.x - r.beam / 2 - r.hullW).toFixed(2)} y=${r.y} фалы=${r.fallsPts}`);
}

// ================= B: подъём без опрокидывания =================
log('=== B: подъём — худший случай (кормой к кораблю) ===');
const prep = ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  return 'ok';
})()`);
log('B: подготовка:', prep);

// B1: спуск — шлюпка на воде носом вдоль (курс = курс корабля)
const launch = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  // 700 шагов = спуск 7 с + 4.7 с на воде: вёсла успевают разложиться
  for (let i = 0; i < 700; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  let dHdg = Math.abs(((bl.heading - p.heading) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  return JSON.stringify({ phase: bl.phase, hdg: +bl.heading.toFixed(2),
    shipHdg: +p.heading.toFixed(2), dHdg: +dHdg.toFixed(2), oars: +bl.oarDeploy.toFixed(2) });
})()`));
log('B1:', JSON.stringify(launch));
check('B1: спуск — шлюпка НА ВОДЕ, курс = курсу корабля (нос вдоль)',
  launch.phase === 'afloat' && launch.dHdg < 0.15 && launch.oars > 0.9,
  `phase=${launch.phase} Δhdg=${launch.dHdg} вёсла=${launch.oars}`);

// B2: ХУДШИЙ СЛУЧАЙ — развернуть на 180° (кормой к кораблю) и поднимать
const hoist180 = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const bl = g.boatLaunch;
  bl.heading = p.heading + Math.PI;   // подошли кормой
  const sp = bl.vis.stowPos.clone().applyQuaternion(p.quaternion).add(p.position);
  bl.pos.set(sp.x + Math.sign(bl.vis.stowPos.x || 1) * 3, 0, sp.z);   // у борта, у шлюпбалок
  const err = bl.tryHoist();
  if (err) return JSON.stringify({ err });
  let t = g.time;
  let maxRoll = 0, maxPitch = 0, flipped = false;
  for (let i = 0; i < 900; i++) {
    t += 1 / 60; bl.update(1 / 60, t);
    const q = bl.vis.group.quaternion;
    const sinp = 2 * (q.w * q.x + q.y * q.z), cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
    const pitch = Math.atan2(sinp, cosp);
    const sinr = 2 * (q.w * q.z - q.x * q.y);
    const roll = Math.atan2(sinr, Math.sqrt(Math.max(1e-9, 1 - sinr * sinr)));
    maxRoll = Math.max(maxRoll, Math.abs(roll));
    maxPitch = Math.max(maxPitch, Math.abs(pitch));
    if (Math.abs(roll) > 1.2) { flipped = true; break; }
    if (bl.phase === 'stowed') break;
  }
  const b = bl.vis.group;
  const oarStowed = bl.vis.oars.filter(o =>
    o.userData.stowQ && Math.abs(o.quaternion.angleTo(o.userData.stowQ)) < 0.05).length;
  return JSON.stringify({
    phase: bl.phase, maxRoll: +maxRoll.toFixed(3), maxPitch: +maxPitch.toFixed(3),
    flipped, y: +b.position.y.toFixed(2), z: +b.position.z.toFixed(2),
    stowY: +bl.vis.stowPos.y.toFixed(2), stowZ: +bl.vis.stowPos.z.toFixed(2),
    rotY: +(((b.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(2),
    oarStowed, rowersHidden: bl.rowers.filter(r => !r.visible).length,
  });
})()`));
log('B2:', JSON.stringify(hoist180));
check('B2: подъём кормой вперёд — НЕ ПЕРЕВОРАЧИВАЕТСЯ (крен < 0.35 рад)',
  hoist180.phase === 'stowed' && !hoist180.flipped && hoist180.maxRoll < 0.35,
  `maxRoll=${hoist180.maxRoll} maxPitch=${hoist180.maxPitch}`);
check('B2: точно на шлюпбалках (stowPos, rotY ≈ 0, вёсла/гребцы убраны)',
  hoist180.phase === 'stowed' && Math.abs(hoist180.y - hoist180.stowY) < 0.05
    && Math.abs(hoist180.z - hoist180.stowZ) < 0.05
    && (hoist180.rotY < 0.1 || hoist180.rotY > Math.PI * 2 - 0.1)
    && hoist180.oarStowed === 2 && hoist180.rowersHidden === 2,
  `y=${hoist180.y}/${hoist180.stowY} z=${hoist180.z}/${hoist180.stowZ} rotY=${hoist180.rotY}`);

// B3: нормальный случай — носом к кораблю (курс = курс корабля + π)
const launch2 = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  if (err) return JSON.stringify({ err });
  let t = g.time;
  for (let i = 0; i < 460; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  bl.heading = p.heading;   // подошли носом (как после обычной гребли к борту)
  const sp2 = bl.vis.stowPos.clone().applyQuaternion(p.quaternion).add(p.position);
  bl.pos.set(sp2.x + Math.sign(bl.vis.stowPos.x || 1) * 3, 0, sp2.z);
  const e2 = bl.tryHoist();
  if (e2) return JSON.stringify({ errHoist: e2 });
  let maxRoll = 0;
  for (let i = 0; i < 900; i++) {
    t += 1 / 60; bl.update(1 / 60, t);
    const q = bl.vis.group.quaternion;
    const sinr = 2 * (q.w * q.z - q.x * q.y);
    const roll = Math.atan2(sinr, Math.sqrt(Math.max(1e-9, 1 - sinr * sinr)));
    maxRoll = Math.max(maxRoll, Math.abs(roll));
    if (bl.phase === 'stowed') break;
  }
  return JSON.stringify({ phase: bl.phase, maxRoll: +maxRoll.toFixed(3) });
})()`));
log('B3:', JSON.stringify(launch2));
check('B3: подъём носом вперёд — без переворота, на шлюпбалках',
  launch2.phase === 'stowed' && launch2.maxRoll < 0.35, `maxRoll=${launch2.maxRoll}`);

// ================= C: физика — Архимед по точкам корпуса =================
log('=== C: физика (Gerstner + rigid body + Архимед) ===');
// C1: штиль — посадка по проектную осадку, устойчивость, без NaN
ev(`(() => {
  const g = window.__game;
  g.debugSetWeather('clear', 3);
  g.seaAmpSmooth = 0.42;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  return 'ok';
})()`);
await sleep(2000);   // кадры применят SEA.amplitude = 0.42
const calm = jparse(ev(`(() => {
  const g = window.__game;
  const T = window.__THREE;
  const p = g.player;
  let t = g.time;
  let nan = false, sumY = 0, n = 0, minY = 1e9, maxY = -1e9;
  let maxRoll = 0, maxPitch = 0;
  for (let i = 0; i < 900; i++) {   // 15 с
    t += 1 / 60;
    p.fixedStep(1 / 60, t);
    if (!isFinite(p.position.y) || !isFinite(p.quaternion.x)) { nan = true; break; }
    sumY += p.position.y; n++;
    minY = Math.min(minY, p.position.y); maxY = Math.max(maxY, p.position.y);
    const e = p.euler;
    maxRoll = Math.max(maxRoll, Math.abs(e.z)); maxPitch = Math.max(maxPitch, Math.abs(e.x));
  }
  // киль на миделе: заглубление под воду (мировые координаты — кватернионом,
  // НЕ matrixWorld — тот в координатах сцены со сдвигом floating origin)
  const D = p.preset.draft;
  const keel = new T.Vector3(0, -D, 0).applyQuaternion(p.quaternion).add(p.position);
  const digMid = g.waterHeight(keel.x, keel.z) - keel.y;
  return JSON.stringify({
    nan, meanY: +(sumY / n).toFixed(2), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2),
    maxRoll: +maxRoll.toFixed(3), maxPitch: +maxPitch.toFixed(3),
    digMid: +digMid.toFixed(2), D,
  });
})()`));
log('C1:', JSON.stringify(calm));
check('C1: штиль — устойчивость (без NaN, y в пределах ±1.5 м)',
  calm && !calm.nan && Math.abs(calm.meanY) < 1.5 && calm.minY > -4,
  `meanY=${calm.meanY} y∈[${calm.minY}, ${calm.maxY}]`);
check('C1: киль в воде по проектную осадку (0.45D..1.7D)',
  calm && calm.digMid > calm.D * 0.45 && calm.digMid < calm.D * 1.7,
  `dig=${calm.digMid} D=${calm.D}`);
check('C1: качка живая, но крен ограничен (< 0.45 рад)',
  calm && calm.maxPitch > 0.005 && calm.maxRoll < 0.45,
  `pitch=${calm.maxPitch} roll=${calm.maxRoll}`);

// C2: шторм — корабль РЕЖЕТ волны (дифферент), не тонет
// Погода применяется КАДРАМИ игры (SEA.amplitude = seaAmpSmooth в
// updateWeather) — ручной цикл fixedStep внутри eval кадров не даёт:
// сначала ставим погоду и ЖДЁМ реальных кадров, потом шагаем
log('C2: включаем шторм кадрами…');
ev(`(() => {
  const g = window.__game;
  g.debugSetWeather('storm', 22);
  g.seaAmpSmooth = 1.8;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  p.greenWater = 0;
  return 'ok';
})()`);
await sleep(2000);   // кадры игры поднимут SEA.amplitude до 1.8
const storm = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  let t = g.time;
  let nan = false, maxPitch = 0, maxRoll = 0, minY = 1e9;
  let fbSum = 0, fbN = 0, fbMin = 1e9;
  const T = window.__THREE;
  const F = p.preset.freeboard, L = p.preset.length;
  const deck = new T.Vector3();
  for (let i = 0; i < 2400; i++) {   // 40 с
    t += 1 / 60;
    p.fixedStep(1 / 60, t);
    p.updateVisual(t, 1 / 60, g.particles);
    if (!isFinite(p.position.y) || !isFinite(p.quaternion.x)) { nan = true; break; }
    const e = p.euler;
    maxPitch = Math.max(maxPitch, Math.abs(e.x)); maxRoll = Math.max(maxRoll, Math.abs(e.z));
    minY = Math.min(minY, p.position.y);
    // надводный борт на носу (кромка палубы, мировые координаты)
    deck.set(0, F * 0.82, 0.44 * L).applyQuaternion(p.quaternion).add(p.position);
    const fb = deck.y - g.waterHeight(deck.x, deck.z);
    fbSum += fb; fbN++; fbMin = Math.min(fbMin, fb);
  }
  return JSON.stringify({
    nan, maxPitch: +maxPitch.toFixed(3), maxRoll: +maxRoll.toFixed(3),
    minY: +minY.toFixed(2), fbMean: +(fbSum / fbN).toFixed(2), fbMin: +fbMin.toFixed(2),
    greenWater: p.greenWater, freeboard: F,
  });
})()`));
log('C2:', JSON.stringify(storm));
check('C2: шторм — корабль РЕЖЕТ волны (дифферент ≥ 0.09 рад)',
  storm && !storm.nan && storm.maxPitch >= 0.09,
  `maxPitch=${storm.maxPitch} (лимит 0.42)`);
check('C2: шторм — остаётся на плаву (средний борт > −0.5, не проваливается)',
  storm && !storm.nan && storm.fbMean > -0.5 && storm.minY > -7 && storm.maxRoll < 0.5,
  `fbMean=${storm.fbMean} fbMin=${storm.fbMin} minY=${storm.minY} roll=${storm.maxRoll}`);

// C3: зелёная вода — только АНОМАЛЬНЫЙ вал (Task 28: в игровом
//     шторме до 2.0 корабль ДЕРЖИТСЯ НА ВОДЕ — развал бортов +
//     запас плавучести над палубой; форс-мажор 2.6 — самый большой
//     вал всё же накрывает палубу шлюпа, после — всплытие)
ev(`(() => {
  const g = window.__game;
  g.changeShip('sloop', true);
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  g.debugSetWeather('storm', 24);
  g.seaAmpSmooth = 2.6;
  p.greenWater = 0;
  return 'ok';
})()`);
await sleep(2000);   // кадры поднимут SEA.amplitude до 2.6
const gw = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  let t = g.time;
  let fbLast = 99, fbMin = 99;
  const T = window.__THREE;
  const F = p.preset.freeboard, L = p.preset.length;
  const deck = new T.Vector3();
  for (let i = 0; i < 3600; i++) {   // 60 с
    t += 1 / 60;
    p.fixedStep(1 / 60, t);
    p.updateVisual(t, 1 / 60, g.particles);
    deck.set(0, F * 0.82, 0.44 * L).applyQuaternion(p.quaternion).add(p.position);
    const fb = deck.y - g.waterHeight(deck.x, deck.z);
    fbLast = fb; fbMin = Math.min(fbMin, fb);
  }
  return JSON.stringify({
    greenWater: p.greenWater, fbMin: +fbMin.toFixed(2), fbEnd: +fbLast.toFixed(2),
    freeboard: F, nan: !isFinite(p.position.y),
  });
})()`));
log('C3:', JSON.stringify(gw));
check('C3: зелёная вода — аномальный вал НАКРЫВАЕТ палубу шлюпа (greenWater > 0)',
  gw && !gw.nan && gw.greenWater > 0, `events=${gw.greenWater} fbMin=${gw.fbMin}`);
check('C3: после накрытия корабль ВСПЛЫВАЕТ (борт в конце > −0.4)',
  gw && gw.fbEnd > -0.4, `fbEnd=${gw.fbEnd}`);

// ================= D: скриншоты =================
log('=== D: скриншоты ===');
ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  g.debugSetWeather('clear', 4);
  g.seaAmpSmooth = 0.42;
  g.setCameraMode('free');
  return 'ok';
})()`);
await sleep(1200);
const setCam = (azim, elev, dist) => ev(`(() => {
  window.__game.rig.freeAzimSet(${azim}); window.__game.rig.freeElevSet(${elev});
  window.__game.rig.distSet(${dist}); window.__game.rig.snap();
  return 'ok';
})()`);
// корма с борта: шлюпка носом вдоль, без палочки
setCam('Math.PI / 2', 0.14, 24);
await sleep(1800);
shot('t25_boat_along');
await sleep(300);
// шторм: корабль режет волну (вид с борта на нос)
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  g.debugSetWeather('storm', 24);
  g.seaAmpSmooth = 1.9;
  p.anchored = false; p.sailTarget = 3;
  return 'ok';
})()`);
await sleep(2500);
setCam('0.5', 0.22, 42);
await sleep(2200);
shot('t25_storm_cut1');
await sleep(1200);
shot('t25_storm_cut2');
await sleep(1200);
shot('t25_storm_cut3');

const pageErrs = jparse(ev(`(() => JSON.stringify(window.__pageErrors || []))()`));
log('E: ошибки страницы:', JSON.stringify(pageErrs).slice(0, 200));
check('E: ошибок JS нет', Array.isArray(pageErrs) && pageErrs.length === 0,
  JSON.stringify(pageErrs).slice(0, 120));

log('');
log(fails === 0 ? 'ALL OK' : `FAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
