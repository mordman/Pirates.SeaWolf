// E2E Task 24 — по замечаниям игрока (ОБНОВЛЕНО Task 25):
//  (A) ШЛЮПКА РАЗВЁРНУТА НОСОМ ВДОЛЬ КОРПУСА (к носу корабля) и
//      геометрия — настоящий гребной ял: L/B≈3.6, острый нос/транец,
//      планширь-лента, ≥3 банки, 2 вёсла на планширях лопастями
//      к носу, БЕЗ руля («палочка сзади» — убрана по замечанию),
//      динамические фалы (4 линии к планширю)
//  (B) ЭКИПАЖ НЕ СТОИТ: капитан расхаживает, боцман вращает шпиль,
//      канониры таскают ядра (челнок + наклон), вахтенные патрулируют
//      вдоль борта; неподвижен только рулевой (его работа — штурвал)
//  (C) СПУСК/УПРАВЛЕНИЕ/ПОДЪЁМ: B — шлюпка на талях опускается (фалы
//      удлиняются), splash на воде; на воде — гребцы, вёсла на воде,
//      W/S гребут (лодка уходит от корабля, ход ≤ ~3.7 уз), A/D — руль;
//      подъём: подтяжка под шлюпбалки → выборка талов → точно на место
//  (D) ГЕЙТЫ: не спустить на ходу/у причала/без команды; не поднять
//      вдали от кормы
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

// ================= A: геометрия шлюпки =================
log('=== A: ял за кормой — разворот и настоящая геометрия ===');
for (const model of ['frigate', 'cog', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    const bv = p.visual.boat;
    if (!bv) return JSON.stringify({ ok: false });
    const b = bv.group;
    const T = window.__THREE;
    const box = new T.Box3().setFromObject(b);
    const size = new T.Vector3(); box.getSize(size);
    // длина корпуса ПО ОСИ (локальные вершины меша корпуса — без руля)
    let minZ = 1e9, maxZ = -1e9, verts = 0;
    b.children[0].geometry && b.children[0].geometry.getAttribute('position')
      && (() => {
        const pos = b.children[0].geometry.getAttribute('position');
        verts = pos.count;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i);
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      })();
    const L = p.preset.length;
    return JSON.stringify({
      ok: true, model: '${model}',
      rotY: +(((b.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(2),
      len: +bv.len.toFixed(2), beam: +bv.beam.toFixed(2),
      ratio: +(bv.len / bv.beam).toFixed(2),
      hullSpanZ: +(maxZ - minZ).toFixed(2), verts,
      thwarts: (b.userData.thwarts || []).length,
      oars: (b.userData.oars || []).length,
      oarStowed: (b.userData.oars || []).filter(o => {
        const sq = o.userData.stowQ;
        return sq && Math.abs(o.quaternion.angleTo(sq)) < 0.05;
      }).length,
      tiller: !!b.userData.tiller,
      fallsPts: bv.falls.geometry.getAttribute('position').count,
      davitHeads: bv.davitHeads.length,
      rowersHidden: g.boatLaunch ? g.boatLaunch.rowers.filter(r => !r.visible).length : -1,
      z: +b.position.z.toFixed(2), y: +b.position.y.toFixed(2),
      L, freeboard: p.preset.freeboard, visible: b.visible,
      extX: +size.x.toFixed(2), extZ: +size.z.toFixed(2),
      phase: g.boatLaunch ? g.boatLaunch.phase : 'none',
    });
  })()`));
  log(`A[${model}]:`, JSON.stringify(r));
  check(`A: ${model} — НОСОМ ВДОЛЬ КОРПУСА (rotY ≈ 0, к носу корабля)`,
    r.ok && (r.rotY < 0.1 || r.rotY > Math.PI * 2 - 0.1), `rotY=${r.rotY}`);
  check(`A: ${model} — пропорции яла (L/B 3.3..4.0)`,
    r.ok && r.ratio > 3.3 && r.ratio < 4.0, `L/B=${r.ratio}`);
  check(`A: ${model} — за транцем, киль над кормой`,
    r.ok && r.z < -r.L * 0.5 && r.z > -r.L * 0.9 && r.y > r.freeboard * 0.95,
    `z=${r.z} y=${r.y}`);
  check(`A: ${model} — корпус подробный (вершин > 900, шпангоуты+планширь)`,
    r.ok && r.verts > 900, `verts=${r.verts}`);
  check(`A: ${model} — банки ≥ 3, вёсла 2 (лежат, лопастью к носу), БЕЗ руля`,
    r.ok && r.thwarts >= 3 && r.oars === 2 && r.oarStowed === 2 && !r.tiller,
    `банки=${r.thwarts} вёсла=${r.oars}/${r.oarStowed} руль=${r.tiller}`);
  check(`A: ${model} — фалы динамические (8 точек) + 2 шлюпбалки + гребцы скрыты`,
    r.ok && r.fallsPts === 8 && r.davitHeads === 2 && r.rowersHidden === 2,
    `фалы=${r.fallsPts} девицы=${r.davitHeads} гребцы=${r.rowersHidden}`);
}

// ================= B: экипаж занят делом =================
log('=== B: экипаж постоянно ходит и работает ===');
const crewB = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('victory', true);       // 71 фигура
  const p = g.player;
  p.crew = p.preset.maxCrew;
  const crew = p.crew3d.group;
  const snap = () => crew.children.map(c =>
    [+(c.position.x).toFixed(3), +(c.position.z).toFixed(3)]);
  const rotSnap = () => crew.children.map(c => +(c.rotation.x).toFixed(3));
  const s0 = snap(), r0 = rotSnap();
  let t = g.time;
  // 6 секунд жизни: все циклы работы успевают провернуться
  for (let i = 0; i < 360; i++) { t += 1 / 60; p.updateVisual(t, 1 / 60, g.particles); }
  const s1 = snap(), r1 = rotSnap();
  let moved = 0, still = [], leaned = 0;
  for (let i = 0; i < s0.length; i++) {
    const d = Math.hypot(s1[i][0] - s0[i][0], s1[i][1] - s0[i][1]);
    if (d > 0.06) moved++;
    else still.push(i);
    if (Math.abs(r1[i]) > 0.06) leaned++;   // наклоны канониров/вахтенных
  }
  // порядок фигур: [0]=капитан, [1]=рулевой, [2]=боцман
  const capD = Math.hypot(s1[0][0] - s0[0][0], s1[0][1] - s0[0][1]);
  const helmD = Math.hypot(s1[1][0] - s0[1][0], s1[1][1] - s0[1][1]);
  const bosD = Math.hypot(s1[2][0] - s0[2][0], s1[2][1] - s0[2][1]);
  // боцман по кругу: обе координаты меняются заметно
  const bosDX = Math.abs(s1[2][0] - s0[2][0]), bosDZ = Math.abs(s1[2][1] - s0[1][1]);
  return JSON.stringify({
    figures: s0.length, moved, still: still.slice(0, 6), leaned,
    capD: +capD.toFixed(2), helmD: +helmD.toFixed(2),
    bosD: +bosD.toFixed(2), bosDX: +bosDX.toFixed(2), bosDZ: +bosDZ.toFixed(2),
  });
})()`));
log('B:', JSON.stringify(crewB));
check('B: капитан РАСХАЖИВАЕТ у штурвала (переместился > 0.5 м)',
  crewB.capD > 0.5, `Δ=${crewB.capD} м`);
check('B: рулевой ОСТАЁТСЯ у штурвала (это его работа)',
  crewB.helmD < 0.02, `Δ=${crewB.helmD} м`);
check('B: боцман ВРАЩАЕТ шпиль (круг: меняются и x, и z)',
  crewB.bosD > 0.5 && crewB.bosDX > 0.1 && crewB.bosDZ > 0.1,
  `Δ=${crewB.bosD} (dx=${crewB.bosDX}, dz=${crewB.bosDZ})`);
check('B: наклоны в работе есть (канониры заряжают/берут ядра)',
  crewB.leaned > 0, `наклоняются=${crewB.leaned}`);
check('B: ходят ≥ 90% фигур (кроме рулевого)',
  crewB.moved >= Math.floor(crewB.figures * 0.9),
  `ходят=${crewB.moved}/${crewB.figures}, стоят=${JSON.stringify(crewB.still)}`);

// ================= C: спуск → управление → подъём =================
log('=== C: спуск на воду, гребля, возврат ===');
const prep = ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0);
  p.sailTarget = 0; p.anchored = true; p.crew = p.preset.maxCrew;
  return 'ok';
})()`);
await sleep(800);
// C1: условия спуска
const gate1 = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const p = g.player;
  // на ходу — нельзя
  p.anchored = false;
  const v = p.velocity; v.set(4, 0, 0);
  const errFast = bl.tryLaunch(false);
  v.set(0, 0, 0);
  // у причала — нельзя
  const errDock = bl.tryLaunch(true);
  // без команды — нельзя
  const crew0 = p.crew; p.crew = 0;
  const errCrew = bl.tryLaunch(false);
  p.crew = crew0; p.anchored = true;
  return JSON.stringify({ errFast, errDock, errCrew });
})()`));
log('C1 (гейты):', JSON.stringify(gate1));
check('C1: на ходу не спускается (сообщение про ход)', /ход/i.test(gate1.errFast || ''), gate1.errFast);
check('C1: у причала не спускается', /порт/i.test(gate1.errDock || ''), gate1.errDock);
check('C1: без команды не спускается', /грест|команд/i.test(gate1.errCrew || ''), gate1.errCrew);

// C2: спуск — фалы удлиняются, лодка опускается
const lower = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const bv = g.player.visual.boat;
  const fallLen = () => {
    const a = bv.falls.geometry.getAttribute('position');
    let s = 0;
    for (let i = 0; i < a.count; i += 2) {
      s += Math.hypot(a.getX(i + 1) - a.getX(i), a.getY(i + 1) - a.getY(i),
        a.getZ(i + 1) - a.getZ(i));
    }
    return s;
  };
  const start = bl.tryLaunch(false);
  const y0 = bv.group.position.y, f0 = fallLen();
  let t = g.time;
  for (let i = 0; i < 90; i++) { t += 1 / 60; bl.update(1 / 60, t); }  // 1.5 с
  const y1 = bv.group.position.y, f1 = fallLen(), ph1 = bl.phase;
  for (let i = 0; i < 330; i++) { t += 1 / 60; bl.update(1 / 60, t); }  // +5.5 с
  for (let i = 0; i < 180; i++) { t += 1 / 60; bl.update(1 / 60, t); }  // +3 с (запас до afloat)
  const ph2 = bl.phase;
  const parent = bv.group.parent;
  const inWorld = parent === g.worldGroup;
  const wy = g.waterHeight(bv.group.position.x, bv.group.position.z);
  const dy = bv.group.position.y - wy;
  return JSON.stringify({
    start, y0: +y0.toFixed(2), y1: +y1.toFixed(2), f0: +f0.toFixed(2), f1: +f1.toFixed(2),
    ph1, ph2, inWorld, dy: +dy.toFixed(2),
    rowersVisible: bl.rowers.filter(r => r.visible).length,
    rowers: bl.rowers.length,
  });
})()`));
log('C2 (спуск):', JSON.stringify(lower));
check('C2: спуск начался (ошибки нет, фаза lowering)', lower.start === null && lower.ph1 === 'lowering');
check('C2: шлюпка ОПУСКАЕТСЯ (y уменьшился)', lower.y1 < lower.y0 - 0.5, `${lower.y0} → ${lower.y1}`);
check('C2: ФАЛЫ УДЛИНИЛИСЬ (тали травятся)', lower.f1 > lower.f0 + 0.4, `${lower.f0} → ${lower.f1}`);
check('C2: на воде (фаза afloat, в мире)', lower.ph2 === 'afloat' && lower.inWorld === true);
check('C2: сидит на воде (|y − вода| < 0.7)', Math.abs(lower.dy) < 0.7, `Δy=${lower.dy}`);
check('C2: гребцы на банках (видны 2)', lower.rowersVisible === 2, `${lower.rowersVisible}/${lower.rowers}`);

// C3: вёсла разворачиваются + гребля уводит от корабля
const rowC = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const bv = g.player.visual.boat;
  let t = g.time;
  for (let i = 0; i < 120; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  const dep1 = bl.oarDeploy;
  // гребём вперёд 8 секунд
  bl.row = 1; bl.steer = 0;
  const x0 = bl.pos.x, z0 = bl.pos.z, h0 = bl.heading;
  for (let i = 0; i < 480; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  const dist0 = Math.hypot(bl.pos.x - x0, bl.pos.z - z0);
  const velFwd = bl.vel;
  // руль: поворот 5 секунд
  bl.steer = 1;
  for (let i = 0; i < 300; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  const dHdg = Math.abs(bl.heading - h0);
  bl.steer = 0; bl.row = 0;
  const st = bl.state();
  // подъём издалека — отклонён (лодку уводим подальше от кормы)
  const T2 = window.__THREE;
  const p2 = g.player;
  const far = new T2.Vector3(90, 0, 0)
    .applyQuaternion(p2.quaternion).add(p2.position);
  bl.pos.set(far.x, 0, far.z); bl.vel = 0;
  g.player.visual.boat.group.position.set(far.x, 0, far.z);
  const farErr = bl.tryHoist();
  return JSON.stringify({
    dep1: +dep1.toFixed(2), dist0: +dist0.toFixed(1), velFwd: +velFwd.toFixed(2),
    dHdg: +dHdg.toFixed(2), farErr, dist: st.dist, phase: st.phase,
    splash: g.particles ? g.particles.alive >= 0 : -1,
  });
})()`));
log('C3 (гребля):', JSON.stringify(rowC));
check('C3: вёсла развёрнуты на воду (deploy > 0.9)', rowC.dep1 > 0.9, `deploy=${rowC.dep1}`);
check('C3: гребля УВОДИТ от корабля (прошла > 5 м)', rowC.dist0 > 5, `путь=${rowC.dist0} м`);
check('C3: ход под вёслами ≤ 2 м/с (реалистично ~3.7 уз)', rowC.velFwd > 0.3 && rowC.velFwd <= 2.0, `vel=${rowC.velFwd}`);
check('C3: руль ПОВОРАЧИВАЕТ (курс изменился > 0.3 рад)', rowC.dHdg > 0.3, `Δ=${rowC.dHdg}`);
check('C3: подъём ИЗДАЛЕКА отклонён', /подойд|Далеко/i.test(rowC.farErr || ''), rowC.farErr);

// C4: возврат к корме и подъём
const hoist = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const p = g.player;
  const bv = p.visual.boat;
  // швартуемся к корме: телепорт под транец
  const T = window.__THREE;
  const stern = new T.Vector3(0, 0, -p.preset.length / 2 - 3)
    .applyQuaternion(p.quaternion).add(p.position);
  bl.pos.set(stern.x, 0, stern.z);
  bl.vel = 0; bl.row = 0; bl.steer = 0;
  bv.group.position.set(stern.x, 0, stern.z);
  const ok = bl.tryHoist();
  if (ok !== null) return JSON.stringify({ ok });
  const st0 = bl.state();
  let t = g.time;
  // подтяжка 2.8 с + выборка 7 с
  for (let i = 0; i < 170; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  const stage = bl.raiseStage;
  for (let i = 0; i < 460; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  const st = bl.state();
  const b = bv.group;
  const backInDetail = b.parent !== g.worldGroup;
  const rotY = +(((b.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(2);
  const posOk = Math.abs(b.position.y - bv.stowPos.y) < 0.05
    && Math.abs(b.position.z - bv.stowPos.z) < 0.05;
  const rowersHidden = bl.rowers.filter(r => !r.visible).length;
  const oarStowed = bv.oars.filter(o =>
    o.userData.stowQ && Math.abs(o.quaternion.angleTo(o.userData.stowQ)) < 0.05).length;
  const fallAttr = bv.falls.geometry.getAttribute('position');
  const fallLen = (() => {
    let s = 0;
    for (let i = 0; i < fallAttr.count; i += 2) {
      s += Math.hypot(fallAttr.getX(i + 1) - fallAttr.getX(i),
        fallAttr.getY(i + 1) - fallAttr.getY(i), fallAttr.getZ(i + 1) - fallAttr.getZ(i));
    }
    return s;
  })();
  return JSON.stringify({
    ok: null, stageMid: stage, phase: st.phase,
    backInDetail, rotY, posOk, rowersHidden, oarStowed,
    fallLen: +fallLen.toFixed(2), dist0: st0.dist,
  });
})()`));
log('C4 (подъём):', JSON.stringify(hoist));
check('C4: подъём принят (у кормы)', hoist.ok === null && hoist.dist0 < 15, `dist=${hoist.dist0}`);
check('C4: подтяжка прошла (stage 1 после 2.8 с)', hoist.stageMid === 1, `stage=${hoist.stageMid}`);
check('C4: фаза stowed — шлюпка НА ШЛЮПБАЛКАХ', hoist.phase === 'stowed');
check('C4: возвращена в группу деталей корабля', hoist.backInDetail === true);
check('C4: точно на месте (stowPos, rotY ≈ 0)', hoist.posOk && (hoist.rotY < 0.1 || hoist.rotY > Math.PI * 2 - 0.1),
  `pos=${hoist.posOk} rotY=${hoist.rotY}`);
check('C4: гребцы скрыты, вёсла уложены на планширь',
  hoist.rowersHidden === 2 && hoist.oarStowed === 2,
  `гребцы=${hoist.rowersHidden} вёсла=${hoist.oarStowed}`);

// C5: повторный спуск после подъёма работает (цикл цел)
const rearm = jparse(ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const again = bl.tryLaunch(false);
  const ph = bl.phase;
  bl.abort();
  return JSON.stringify({ again, ph, after: bl.phase });
})()`));
log('C5 (повтор):', JSON.stringify(rearm));
check('C5: шлюпку можно спустить снова (цикл цел)',
  rearm.again === null && rearm.ph === 'lowering' && rearm.after === 'stowed');

// ================= D: HUD =================
const hudD = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    hudBoat: g.hud.boat,
    keyB: g.settings.controls.boat,
  });
})()`));
log('D (HUD):', JSON.stringify(hudD));
check('D: HUD сообщает фазу шлюпки (stowed)', hudD.hudBoat && hudD.hudBoat.phase === 'stowed');
check('D: клавиша B назначена', hudD.keyB === 'KeyB', hudD.keyB);

// ================= E: скриншоты для VLM =================
log('=== E: скриншоты ===');
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true; p.velocity.set(0, 0, 0); p.sailTarget = 0;
  g.setCameraMode('free');
  return 'ok';
})()`);
await sleep(1200);
const setCam = (azim, elev, dist) => ev(`(() => {
  window.__game.rig.freeAzimSet(${azim}); window.__game.rig.freeElevSet(${elev});
  window.__game.rig.distSet(${dist}); window.__game.rig.snap();
  return 'ok';
})()`);
// корма со шлюпкой крупно
setCam('Math.PI * 1.5 + 0.3', 0.24, 16);
await sleep(1600);
shot('t24_boat_stern');
await sleep(300);
// палуба с занятым экипажем (Victory, вид сверху-сбоку)
ev(`(() => {
  const g = window.__game;
  g.changeShip('victory', true);
  const p = g.player;
  p.crew = p.preset.maxCrew; p.anchored = true;
  return 'ok';
})()`);
await sleep(1000);
setCam('0.6', 0.9, 34);
await sleep(1600);
shot('t24_crew_busy');
await sleep(300);
// шлюпка на воде с гребцами
ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.crew = p.preset.maxCrew; p.anchored = true; p.velocity.set(0, 0, 0);
  const bl = g.boatLaunch;
  bl.tryLaunch(false);
  let t = g.time;
  for (let i = 0; i < 480; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  bl.row = 1;
  for (let i = 0; i < 200; i++) { t += 1 / 60; bl.update(1 / 60, t); }
  bl.row = 0;
  return 'ok';
})()`);
await sleep(1400);
setCam('Math.PI * 0.85', 0.2, 12);
await sleep(1600);
shot('t24_boat_afloat');
await sleep(400);
ev(`(() => { window.__game.boatLaunch.abort(); return 'ok'; })()`);
await sleep(400);

const pageErrs = jparse(ev(`(() => JSON.stringify(window.__pageErrors || []))()`));
check('E: страница без ошибок JS', Array.isArray(pageErrs) && pageErrs.length === 0, JSON.stringify(pageErrs));

log(fails === 0 ? '\nALL OK' : `\nFAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
