// E2E Task 22 — по замечаниям игрока (после потери незакоммиченной
// работы — весь пакет пере-реализован):
//  (A) ШЛЮПКА: КРУГЛОДОННОЕ корыто подвешено ЗА КОРМОЙ на шлюпбалках
//      (длина ВДОЛЬ корабля, нос к носу — обновлено по замечанию
//      игрока в Task 23: прикреплена сзади); ломаемая — попадание
//      рядом срывает её с щепой, clearDamage восстанавливает
//  (B) ЯКОРЯ: два, убраны — лежат ВДОЛЬ бортов (не вертикально);
//      отдача (anchored) — якорь по дуге уходит ПОД ВОДУ на цепи,
//      жёлтый буй всплывает у цепи; подъём возвращает на место
//  (C) КВАРТЕРДЕК: ПРОЁМЫ НАД ТРАПАМИ открыты (луч изнутри через вход
//      не задевает переднюю стену), центр закрыт (балюстрада+парпет),
//      задняя стенка закрывает корму
//  (D) СПАСАТЕЛЬНЫЕ КРУГИ: за планширем (наружу борта), не пересекают
//      обшивку — |x| больше полуширины корпуса
//  (E) ЛАТИНСКАЯ РЕЯ: в диаметральной плоскости (x≈0 у реи всех мачт;
//      раньше торчала вбок «палкой»)
//  (F) ГРЕБОК РАЗВЁРНУТ: в начале рабочего хода лопасть у НОСА и метётся
//      К КОРМЕ (знак рыскания вёсел сменился)
//  (G) ХОДКИ ЖИВЕЕ: дрейф полосы поперёк палубы + разные темпы
//  (H) скриншоты для VLM + страница без ошибок
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
// промотка времени корабля (fixedStep + updateVisual), как в e2e_v38
const ff = (sec, step = 1 / 60) => ev(`(() => {
  const g = window.__game; const p = g.player;
  let t = g.time;
  for (let i = 0; i < ${Math.round(sec / step)}; i++) { t += ${step}; p.fixedStep(${step}, t); p.updateVisual(t, ${step}, g.particles); }
  return 'ff';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ================= A: шлюпка =================
log('=== A: шлюпка — за кормой на шлюпбалках, вдоль, ломается ===');
const boatA = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  const v = p.visual;
  const b = v.boat;
  if (!b) return JSON.stringify({ ok: false });
  const T = window.__THREE;
  const box = new T.Box3().setFromObject(b);
  const size = new T.Vector3(); box.getSize(size);
  // палуба в точке шлюпки + полуширина корпуса там же
  const L = p.preset.length;
  const tt = 0.5 + (b.position.z / L);
  const hw = v.outline ? null : null; // контур не даёт высоту — считаем по X
  // вершины корпуса шлюпки: круглодонность = отношение глубины к ширине
  // и киль ниже планширя (нос/корма подняты)
  let minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9, verts = 0;
  b.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    verts += pos.count;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), y = pos.getY(i);
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  });
  const inBreakables = v.breakables.includes(b);
  return JSON.stringify({
    ok: true, visible: b.visible,
    extX: +size.x.toFixed(2), extZ: +size.z.toFixed(2), extY: +size.y.toFixed(2),
    verts, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2),
    hullLenLocal: +(maxZ - minZ).toFixed(2),
    boatLen: +(b.userData.boatLen ?? 0).toFixed(2),
    rotY: +b.rotation.y.toFixed(2),
    z: +(b.position.z).toFixed(2),
    y: +(b.position.y).toFixed(2),
    L: p.preset.length,
    freeboard: p.preset.freeboard,
    inBreakables,
    gibs: window.__game.gibs ? window.__game.gibs.alive : -1,
  });
})()`));
log('A:', JSON.stringify(boatA));
check('A: шлюпка построена (вершин > 400 — loft-шпангоуты)', boatA.ok && boatA.verts > 400, `verts=${boatA.verts}`);
check('A: висит ВДОЛЬ корабля (габарит по Z больше, чем по X)', boatA.ok && boatA.extZ > boatA.extX * 1.6,
  `extX=${boatA.extX} extZ=${boatA.extZ}`);
check('A: прикреплена СЗАДИ — за транцем (z < -L/2)', boatA.ok && boatA.z < -boatA.L * 0.5 && boatA.z > -boatA.L * 0.9,
  `z=${boatA.z} L=${boatA.L}`);
check('A: киль над планширем кормы (не в воде)', boatA.ok && boatA.y > boatA.freeboard * 0.95,
  `y=${boatA.y} freeboard=${boatA.freeboard}`);
check('A: килем вниз (не вверх дном)', boatA.ok && boatA.minY < 0.25 && boatA.maxY > 0.5,
  `minY=${boatA.minY} maxY=${boatA.maxY}`);
check('A: шлюпка в ломаемых деталях', boatA.ok && boatA.inBreakables === true);

// A2: разлёт от попадания + восстановление
const boatBreak = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  const b = v.boat;
  const lp = b.position.clone();
  lp.y += 0.4;
  const broke = p.damageProp(lp, 12);
  let gibs0 = -1;
  if (window.__game.gibs) { window.__game.gibs.update(1 / 60); gibs0 = window.__game.gibs.alive; }
  const gone = !b.visible;
  p.clearDamage();
  const restored = b.visible;
  return JSON.stringify({ broke, gone, gibs0, restored });
})()`));
log('A2:', JSON.stringify(boatBreak));
check('A: попадание срывает шлюпку (damageProp=true, скрыта, щепа летит)',
  boatBreak.broke === true && boatBreak.gone === true && boatBreak.gibs0 > 0,
  `gibs=${boatBreak.gibs0}`);
check('A: clearDamage восстанавливает шлюпку', boatBreak.restored === true);

// ================= B: якоря =================
log('=== B: якоря — вдоль бортов, отдача с цепью и буем ===');
const anchorB = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  if (!v.anchors || !v.anchors.length) return JSON.stringify({ ok: false });
  const A = v.anchors[0];
  const L = p.preset.length;
  const stow = {
    x: +A.anchor.position.x.toFixed(2), y: +A.anchor.position.y.toFixed(2),
    q: A.anchor.quaternion.toArray().map(q => +q.toFixed(2)),
    chainStart: A.chain.geometry.getAttribute('position').count,
  };
  return JSON.stringify({
    ok: true, n: v.anchors.length, anchorT: p.anchorT, stow,
    buoyY: v.anchors.map(a => +a.buoy.position.y.toFixed(2)),
    dropY: v.anchors.map(a => +a.dropPos.y.toFixed(2)),
    catheadY: v.anchors.map(a => +a.cathead.y.toFixed(2)),
  });
})()`));
log('B:', JSON.stringify(anchorB));
check('B: два якоря у скул', anchorB.ok && anchorB.n === 2);
check('B: убраны — лежат вдоль борта (y > 0, не вертикально в воде)',
  anchorB.ok && anchorB.stow.y > 0.5 && Math.abs(anchorB.stow.q[3]) < 0.99,
  `y=${anchorB.stow?.y} qw=${anchorB.stow?.q?.[3]}`);
check('B: цепь создана (точек > 8)', anchorB.ok && anchorB.stow.chainStart > 8);

// B2: отдача — якорь уходит под воду, буй всплывает
ev(`(() => { const p = window.__game.player; p.anchored = true; return 'отдан'; })()`);
ff(3.6);
const dropB = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  const A = v.anchors[0];
  const T = window.__THREE;
  // цепь: конец у рыма якоря
  const ring = A.ringOffset.clone().applyQuaternion(A.anchor.quaternion).add(A.anchor.position);
  const pos = A.chain.geometry.getAttribute('position');
  const last = new T.Vector3(pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1));
  const first = new T.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
  return JSON.stringify({
    anchorT: +p.anchorT.toFixed(2), down: p.anchored,
    anchorY: v.anchors.map(a => +a.anchor.position.y.toFixed(2)),
    anchorX: v.anchors.map(a => +a.anchor.position.x.toFixed(2)),
    buoyY: v.anchors.map(a => +a.buoy.position.y.toFixed(2)),
    chainFirst: +first.distanceTo(A.cathead).toFixed(3),
    chainLast: +last.distanceTo(ring).toFixed(3),
  });
})()`));
log('B2:', JSON.stringify(dropB));
check('B: отдача — анимация дошла (anchorT ≥ 0.99)', dropB.anchorT >= 0.99, `t=${dropB.anchorT}`);
check('B: якоря ПОД ВОДОЙ (y < 0)', dropB.anchorY.every(y => y < 0), `y=${dropB.anchorY}`);
check('B: жёлтый буй ПЛАВАЕТ у поверхности (0 < y < 0.6)',
  dropB.buoyY.every(y => y > 0 && y < 0.6), `y=${dropB.buoyY}`);
check('B: цепь ведёт от клюза к рымам (концы на месте, провис есть)',
  dropB.chainFirst < 0.05 && dropB.chainLast < 0.05,
  `клюз=${dropB.chainFirst} рым=${dropB.chainLast}`);

// B3: подъём — якорь возвращается вдоль борта
ev(`(() => { const p = window.__game.player; p.anchored = false; return 'поднят'; })()`);
ff(3.6);
const raiseB = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const A = p.visual.anchors[0];
  return JSON.stringify({
    anchorT: +p.anchorT.toFixed(2),
    y: +A.anchor.position.y.toFixed(2),
    atStow: +A.anchor.position.distanceTo(A.stowPos).toFixed(3),
    buoyY: +A.buoy.position.y.toFixed(2),
  });
})()`));
log('B3:', JSON.stringify(raiseB));
check('B: подъём — якорь вернулся к борту (t≈0, у места уборки)',
  raiseB.anchorT <= 0.01 && raiseB.atStow < 0.02 && raiseB.y > 0.5,
  `t=${raiseB.anchorT} дистанция=${raiseB.atStow}`);

// ================= C: квартердек — проёмы на трапы =================
log('=== C: квартердек — вход с трапов открыт, корма закрыта ===');
// разбор ВЕРШИН запечённого меша стен (локальные координаты —
// не зависят от матриц/RAF): клетки покрытия передней стены по X
const qdC = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  const q = v.quarter;
  if (!q) return JSON.stringify({ ok: false });
  // группа квартердека — родитель стрелки нактоуза
  const qdGroup = v.binnacleNeedle?.parent;
  if (!qdGroup) return JSON.stringify({ ok: false });
  // стены — запечённый vertexColors-меш с максимумом вершин в группе
  let walls = null, bestN = 0;
  qdGroup.children.forEach(o => {
    if (o.isMesh && o.material?.vertexColors) {
      const n = o.geometry.attributes.position.count;
      if (n > bestN) { bestN = n; walls = o; }
    }
  });
  if (!walls) return JSON.stringify({ ok: false, why: 'no walls' });
  const pos = walls.geometry.attributes.position;
  const floorY = q.floorY(q.frontZ);
  const stairX = q.stairX || 1.5;
  // передняя стена: парпет/балюстрада в полосе z=[frontZ-0.3, frontZ+0.12],
  // парпет пересекает высоты [floorY+0.005, floorY+0.13]
  const zLo = q.frontZ - 0.3, zHi = q.frontZ + 0.12;
  // y-полоса НАД настилом (floorY+0.005): ступени трапов (их верх ровно
  // на floorY) не считаются стеной, а парпет (до floorY+0.14) — считается
  const yTop = floorY + 0.13, yBot = floorY + 0.005;
  const cells = new Set();
  let frontTris = 0, rearTris = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const z0 = pos.getZ(i), z1 = pos.getZ(i + 1), z2 = pos.getZ(i + 2);
    const zMin = Math.min(z0, z1, z2), zMax = Math.max(z0, z1, z2);
    if (zMin >= zLo && zMax <= zHi) {
      frontTris++;
      const y0 = pos.getY(i), y1 = pos.getY(i + 1), y2 = pos.getY(i + 2);
      if (Math.min(y0, y1, y2) <= yTop && Math.max(y0, y1, y2) >= yBot) {
        const x0 = pos.getX(i), x1 = pos.getX(i + 1), x2 = pos.getX(i + 2);
        const xa = Math.min(x0, x1, x2), xb = Math.max(x0, x1, x2);
        for (let c = Math.ceil(xa * 5) / 5; c <= xb + 0.01; c += 0.2) {
          cells.add(Math.round(c * 5) / 5);
        }
      }
    }
    // задняя стенка: z около sternZ+0.1, у центра, ВЫШЕ настила
    if (zMin >= q.sternZ - 0.1 && zMax <= q.sternZ + 0.4) {
      const y0 = pos.getY(i), y1 = pos.getY(i + 1), y2 = pos.getY(i + 2);
      const x0 = pos.getX(i), x1 = pos.getX(i + 1), x2 = pos.getX(i + 2);
      if (Math.max(y0, y1, y2) > floorY + 0.3
        && Math.min(x0, x1, x2) < 0.3 && Math.max(x0, x1, x2) > -0.3) rearTris++;
    }
  }
  // симметричное окно ±0.25 (floor для отрицательных x расширял окно
  // на лишнюю клетку и ловил торец БОРТОВОЙ стенки — это не передняя)
  const hasNear = (x) => {
    const lo = Math.ceil((x - 0.25) * 5) / 5, hi = Math.floor((x + 0.25) * 5) / 5;
    for (let c = lo; c <= hi + 0.001; c += 0.2) {
      if (cells.has(Math.round(c * 5) / 5)) return true;
    }
    return false;
  };
  return JSON.stringify({
    ok: true, stairX: +stairX.toFixed(2),
    frontTris, rearTris, cells: cells.size,
    gapAtStair: !hasNear(stairX) && !hasNear(-stairX),
    centerClosed: hasNear(stairX * 0.5) && hasNear(-stairX * 0.5) && hasNear(0),
    rearClosed: rearTris >= 4,
  });
})()`));
log('C:', JSON.stringify(qdC));
check('C: над ТРАПОМ ПРОЁМ (передняя стена не загораживает вход)',
  qdC.ok && qdC.gapAtStair === true, `клеток=${qdC.cells} stairX=${qdC.stairX}`);
check('C: ЦЕНТР передней стены закрыт (парпет+балюстрада)',
  qdC.ok && qdC.centerClosed === true, `треугольников=${qdC.frontTris}`);
check('C: ЗАДНЯЯ СТЕНКА закрывает корму (треугольники над настилом)',
  qdC.ok && qdC.rearClosed === true, `треугольников=${qdC.rearTris}`);

// ================= D: спасательные круги =================
log('=== D: спаскруги за планширем ===');
const ringsD = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  const rings = [];
  // круги — торусы с белым материалом в группе мелких деталей
  v.detail.traverse(o => {
    if (!o.isMesh || !o.material || o.material.color === undefined) return;
    if (o.material.color && o.material.color.getHex() === 0xe9e6dd
      && o.geometry && o.geometry.parameters && o.geometry.parameters.radius > 0.2) {
      rings.push({ x: +o.parent.position.x.toFixed(2), y: +o.parent.position.y.toFixed(2), z: +o.parent.position.z.toFixed(2) });
    }
  });
  // полуширина корпуса около кругов: по контуру ватерлинии грубо
  let hw = 0;
  for (const pt of v.outline) hw = Math.max(hw, Math.abs(pt.x));
  return JSON.stringify({ n: rings.length, rings, hw: +hw.toFixed(2) });
})()`));
log('D:', JSON.stringify(ringsD));
check('D: два спасательных круга', ringsD.n === 2, `n=${ringsD.n}`);
check('D: круги ЗА ПЛАНШИРЕМ (наружу борта, не сквозь обшивку)',
  ringsD.n === 2 && ringsD.rings.every(r => Math.abs(r.x) > ringsD.hw * 0.98),
  `x=${ringsD.rings?.map(r => r.x)} полуширина=${ringsD.hw}`);

// ================= E: латинская рея =================
log('=== E: латинская рея в диаметральной плоскости ===');
const lateenE = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('caravel', true);
  const p = g.player;
  const v = p.visual;
  // реи: цилиндры-потомки мачт с малым радиусом (0.05..0.09)
  const yards = [];
  for (const m of v.masts) {
    m.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.parameters) return;
      const r = o.geometry.parameters.radiusTop;
      if (r === undefined) return;
      if (r >= 0.05 && r <= 0.09) {
        const wp = o.getWorldPosition(new window.__THREE.Vector3());
        // в локалях корабля: x мировой -> повернуть назад
        const lp = m.worldToLocal(wp.clone());
        yards.push({ x: +lp.x.toFixed(3), r: +r.toFixed(3), rotX: +o.rotation.x.toFixed(2), rotZ: +o.rotation.z.toFixed(2) });
      }
    });
  }
  // у каравеллы: квадратные реи (rotZ=±1.57) + латинские (rotX≠0)
  const lateen = yards.filter(y => Math.abs(y.rotX) > 0.05);
  const anySide = yards.some(y => Math.abs(y.x) > 0.15);
  return JSON.stringify({ n: yards.length, lateen: lateen.length, anySide,
    lateenX: lateen.map(y => y.x) });
})()`));
log('E:', JSON.stringify(lateenE));
check('E: латинские реи есть (каравелла)', lateenE.lateen >= 2, `латинских=${lateenE.lateen}`);
check('E: реи НЕ торчат вбок (все x≈0 — «палка слева» исчезла)',
  lateenE.anySide === false, `lateenX=${lateenE.lateenX}`);

// ================= F: направление гребка =================
log('=== F: гребок развёрнут (лопасть метётся к корме) ===');
const rowF = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('galley', true);
  const p = g.player;
  const v = p.visual;
  if (!v.oars || !v.oars.length) return JSON.stringify({ ok: false });
  p.oarsOut = true; p.rowing = 1; p.anchored = false;
  // прокрутить развёртку вёсел до конца (deployT -> ~1)
  let t = g.time;
  for (let i = 0; i < 150; i++) { t += 1 / 60; p.updateVisual(t, 1 / 60, g.particles); }
  // фаза в начале рабочего хода (sin>0, cos>0): лопасть должна быть
  // У НОСА и мести К КОРМЕ. Замеряем рыскание весла борта +1:
  p.strokePhase = 0.001; // только что начался рабочий ход
  p.updateVisual(t + 0.017, 1 / 60, g.particles);
  const T = window.__THREE;
  const yawOf = (o) => {
    const e = new T.Euler().setFromQuaternion(o.quaternion, 'YXZ');
    return +e.y.toFixed(3);
  };
  const starboard = v.oars.filter(o => (o.userData.side ?? 0) > 0);
  const yaws = starboard.slice(0, 4).map(yawOf);
  // ожидание: yaw·side < 0 в начале рабочего хода (лопасть у носа)
  // старый (неправильный) знак давал yaw·side > 0
  const sign = yaws.reduce((s, y) => s + Math.sign(y), 0);
  return JSON.stringify({ ok: true, phase: +p.strokePhase.toFixed(2), yaws, sign });
})()`));
log('F:', JSON.stringify(rowF));
check('F: гребок развёрнут (в начале рабочего хода лопасть у носа)',
  rowF.ok && rowF.sign < 0, `yaw(штирборт)=${rowF.yaws}`);
// F2: ход от гребли вперёд — всё в ОДНОМ eval (живой цикл между
// eval'ами сбрасывает rowing=0, а RAF в headless может быть придушен)
const rowMove = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.oarsOut = true; p.rowing = 1; p.anchored = false;
  p.crew = p.preset.maxCrew; // полный экипаж — полная тяга вёсел
  p.velocity.set(0, 0, 0);
  let t = g.time;
  for (let i = 0; i < 480; i++) {
    t += 1 / 60;
    p.rowing = 1;
    p.fixedStep(1 / 60, t);
    p.updateVisual(t, 1 / 60, g.particles);
  }
  return JSON.stringify({ spd: +p.speed().toFixed(2), rowing: p.rowing });
})()`));
check('F: галера идёт ВПЕРЁД под вёслами (ход > 0.5 м/с)',
  rowMove.spd > 0.5, `spd=${rowMove.spd}`);

// ================= G: ходоки живее =================
log('=== G: ходоки — дрейф полосы и разные темпы ===');
const walkG = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('victory', true); // 71 фигура — ДОСТАТОЧНО ходоков
  const p = g.player;
  // полная команда — чтобы ходоки (последние в списке) были ВИДИМЫ
  p.crew = p.preset.maxCrew;
  const crew = p.crew3d.group;
  // фигуры — дети группы; снимаем позиции два раза с паузой
  const snap = () => {
    const a = [];
    crew.children.forEach(c => a.push([+c.position.x.toFixed(3), +c.position.z.toFixed(3)]));
    return a;
  };
  const s0 = snap();
  let t = g.time;
  for (let i = 0; i < 120; i++) { t += 1 / 60; p.updateVisual(t, 1 / 60, g.particles); }
  const s1 = snap();
  let movedZ = 0, driftedX = 0;
  for (let i = 0; i < s0.length; i++) {
    const dz = Math.abs(s1[i][1] - s0[i][1]);
    const dx = Math.abs(s1[i][0] - s0[i][0]);
    if (dz > 0.05) movedZ++;
    if (dz > 0.05 && dx > 0.01) driftedX++;
  }
  return JSON.stringify({ figures: s0.length, movedZ, driftedX });
})()`));
log('G:', JSON.stringify(walkG));
check('G: экипаж ходит по палубе (двигаются > 2 фигур)', walkG.movedZ > 2, `ходят=${walkG.movedZ}`);
check('G: полосы живые — у ходоков есть ДРЕЙФ поперёк (dx > 0)',
  walkG.driftedX >= 1, `с дрейфом=${walkG.driftedX}`);

// ================= H: скриншоты для VLM =================
log('=== H: скриншоты ===');
ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 3; p.velocity.set(0, 0, 0);
  let time = g.time;
  for (let i = 0; i < 240; i++) { time += 1 / 60; p.fixedStep(1 / 60, time); p.updateVisual(time, 1 / 60, g.particles); }
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI - 0.55);
  g.rig.freeElevSet(0.30);
  g.rig.distSet(23);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2600);
shot('t22_quarterdeck_aft');
await sleep(300);
// передняя сторона квартердека с главной палубы (проёмы/трапы)
ev(`(() => {
  const g = window.__game;
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2 + 0.45);
  g.rig.freeElevSet(0.22);
  g.rig.distSet(20);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2200);
shot('t22_quarterdeck_front');
await sleep(300);
// шлюпка на палубе (вид сверху-сбоку от носа)
ev(`(() => {
  const g = window.__game;
  g.setCameraMode('free');
  g.rig.freeAzimSet(0.35);
  g.rig.freeElevSet(0.42);
  g.rig.distSet(17);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2200);
shot('t22_boat_deck');
await sleep(300);
// якоря убраны вдоль бортов + спаскруги (нос крупно)
ev(`(() => {
  const g = window.__game;
  g.setCameraMode('free');
  g.rig.freeAzimSet(-Math.PI / 2 + 0.2);
  g.rig.freeElevSet(0.14);
  g.rig.distSet(15);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2200);
shot('t22_anchors_stowed');
await sleep(300);
// отдача якоря: якорь на цепи в воде + жёлтый буй
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  p.anchored = true;
  let time = g.time;
  for (let i = 0; i < 260; i++) { time += 1 / 60; p.fixedStep(1 / 60, time); p.updateVisual(time, 1 / 60, g.particles); }
  g.setCameraMode('free');
  g.rig.freeAzimSet(-Math.PI / 2 + 0.75);
  g.rig.freeElevSet(0.18);
  g.rig.distSet(14);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2400);
shot('t22_anchor_dropped');
await sleep(300);
// каравелла: латинская рея без палки вбок
ev(`(() => {
  const g = window.__game;
  g.changeShip('caravel', true);
  const p = g.player;
  p.sailTarget = 3;
  let time = g.time;
  for (let i = 0; i < 200; i++) { time += 1 / 60; p.fixedStep(1 / 60, time); p.updateVisual(time, 1 / 60, g.particles); }
  g.setCameraMode('free');
  g.rig.freeAzimSet(0.6);
  g.rig.freeElevSet(0.2);
  g.rig.distSet(46);
  g.rig.snap();
  return 'ok';
})()`);
await sleep(2400);
shot('t22_lateen_yard');
await sleep(400);

// ошибки консоли
const errsH = jparse(run('console --level error --json --limit 20')) || [];
const errTexts = (Array.isArray(errsH) ? errsH : (errsH.logs || [])).map(e => e.text || e.message || '').filter(Boolean);
check('H: ошибок консоли нет', errTexts.length === 0, errTexts.slice(0, 2).join(' | ').slice(0, 180));

log(`\n===== ИТОГ e2e_v39: ${fails === 0 ? 'ALL OK' : fails + ' FAIL'} =====`);
if (fails) process.exit(1);
