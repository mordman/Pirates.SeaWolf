// E2E Task 23 — по замечаниям игрока:
//  (A) ШЛЮПКА ПРИКРЕПЛЕНА СЗАДИ: за транцем на шлюпбалках, длина
//      ВДОЛЬ корабля, нос к носу; шлюпбалки-девицы построены; на всех
//      типах судов (квартердек/замки/открытая корма)
//  (B) ПЕРИЛА ПОД УГЛОМ: поручень трапа наклонён вдоль ступеней
//      (ненулевой уклон, знак — подъём к квартердеку)
//  (C) КВАРТЕРДЕК В ЦВЕТ КОРПУСА И ГЛАДКИЙ: боковинка — единая
//      гладкая лента (нет «лесенки»: скачки верхней кромки < 6 см),
//      обшивка/стойки/поручни — тон корпуса (без кремовых/золотых
//      секций в зоне перил)
//  (D) ПОЛИГОН: при смене корабля меняется и КОМАНДА (под штат нового
//      судна), фигурки на палубе соответствуют
//  (E) ЯДРА: по сильно повреждённому корпусу (прочность < 50%) пробивают
//      НАСКВОЗЬ (вход+выход, до 0.5 с внутри, ядро гаснет в воде, не
//      «застревает»); НАД палубой (выше планширя) фантомной стены нет —
//      снаряд пролетает свободно; свежий борт принимает ядро в себя
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

// ================= A: шлюпка за кормой =================
log('=== A: шлюпка сзади на шлюпбалках (3 типа судов) ===');
for (const model of ['frigate', 'cog', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    const v = p.visual;
    const bvis = v.boat;
    if (!bvis) return JSON.stringify({ ok: false });
    const b = bvis.group;
    const T = window.__THREE;
    const box = new T.Box3().setFromObject(b);
    const size = new T.Vector3(); box.getSize(size);
    const L = p.preset.length;
    // шлюпбалки: вершины ДЕРЕВЯННОГО меша деталей у транца ВЫШЕ планширя
    // (наклонные девицы + поперечина между головами)
    const q = p.preset.quarter ?? 0;
    const sternZb = -L / 2 + Math.max(0.35, L * 0.012);
    let davitVerts = 0;
    v.detail.traverse(o => {
      if (!o.isMesh || !o.material?.vertexColors) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (z < sternZb + 0.7 && z > sternZb - 1.2 && Math.abs(x) < L * 0.3
          && y > b.position.y - 1.2) davitVerts++;
      }
    });
    return JSON.stringify({
      ok: true, model: '${model}',
      extX: +size.x.toFixed(2), extZ: +size.z.toFixed(2),
      rotY: +b.rotation.y.toFixed(2),
      z: +b.position.z.toFixed(2), y: +b.position.y.toFixed(2),
      L, freeboard: p.preset.freeboard,
      quarter: q, castle: p.preset.castleH ?? 0,
      davitVerts, visible: b.visible,
    });
  })()`));
  log(`A[${model}]:`, JSON.stringify(r));
  check(`A: ${model} — вдоль (extZ > extX·1.6)`, r.ok && r.extZ > r.extX * 1.6, `extX=${r.extX} extZ=${r.extZ}`);
  check(`A: ${model} — за транцем (-0.9L < z < -0.5L)`, r.ok && r.z < -r.L * 0.5 && r.z > -r.L * 0.9, `z=${r.z}`);
  check(`A: ${model} — киль над кормой (y > 0.95·freeboard)`, r.ok && r.y > r.freeboard * 0.95, `y=${r.y}`);
  check(`A: ${model} — шлюпбалки построены (вершин > 60)`, r.ok && r.davitVerts > 60, `verts=${r.davitVerts}`);
}

// ================= B+C: квартердек — перила/гладкость/цвет =================
log('=== B/C: квартердек — поручень трапа наклонён, боковинка гладкая и в цвет ===');
ev(`(() => { window.__game.changeShip('frigate', true); return 'ok'; })()`);
await sleep(600);
const qd = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  const q = v.quarter;
  if (!q) return JSON.stringify({ ok: false });
  const qdGroup = v.binnacleNeedle?.parent;
  let walls = null, bestN = 0;
  qdGroup.children.forEach(o => {
    if (o.isMesh && o.material?.vertexColors) {
      const n = o.geometry.attributes.position.count;
      if (n > bestN) { bestN = n; walls = o; }
    }
  });
  const pos = walls.geometry.attributes.position;
  const col = walls.geometry.attributes.color;
  const fS = q.floorY(q.sternZ + 1);
  // B: поручень трапа — точки в зоне поручня (|x - ±(stairX-0.42)| < 0.3)
  const deckY = q.floorY(q.frontZ) - p.preset.quarter;
  const railPts = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    for (const side of [-1, 1]) {
      const xr = side * (q.stairX - 0.42);
      if (Math.abs(x - xr) < 0.3 && z > q.frontZ - 0.1 && z < q.frontZ + 3.2
        && y > deckY + 1.3 && y < q.floorY(q.frontZ) + 1.3) railPts.push({ z, y });
    }
  }
  let slope = 0;
  if (railPts.length > 4) {
    let n = railPts.length, sz = 0, sy = 0, szz = 0, szy = 0;
    railPts.forEach(pt => { sz += pt.z; sy += pt.y; szz += pt.z * pt.z; szy += pt.z * pt.y; });
    slope = (n * szy - sz * sy) / (n * szz - sz * sz);
  }
  // C1: боковинка — лента: треугольники высотой ~q+0.14 у борта
  const wallSamples = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const xs = [pos.getX(i), pos.getX(i+1), pos.getX(i+2)];
    const ys = [pos.getY(i), pos.getY(i+1), pos.getY(i+2)];
    const zs = [pos.getZ(i), pos.getZ(i+1), pos.getZ(i+2)];
    const yMax = Math.max(...ys), yMin = Math.min(...ys);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const zSpread = Math.max(...zs) - Math.min(...zs);
    if (Math.min(...xs.map(Math.abs)) > 1.4 && xSpread < 0.5 && zSpread < 0.6
      && (yMax - yMin) > 1.7 && (yMax - yMin) < 2.3
      && zs.every(z => z > q.sternZ - 0.6 && z < q.frontZ + 0.6)) {
      const r = (col.getX(i)+col.getX(i+1)+col.getX(i+2))/3;
      const gg = (col.getY(i)+col.getY(i+1)+col.getY(i+2))/3;
      const b = (col.getZ(i)+col.getZ(i+1)+col.getZ(i+2))/3;
      wallSamples.push({ z: (zs[0]+zs[1]+zs[2])/3, yMax, xAbs: Math.min(...xs.map(Math.abs)), r, g: gg, b });
    }
  }
  wallSamples.sort((a, b2) => a.z - b2.z);
  let jumps = 0, maxJump = 0;
  for (let k = 1; k < wallSamples.length; k++) {
    const dz = wallSamples[k].z - wallSamples[k-1].z;
    if (dz < 0.35) {
      const j = Math.abs(wallSamples[k].yMax - wallSamples[k-1].yMax);
      if (j > maxJump) maxJump = j;
      if (j > 0.06) jumps++;
    }
  }
  // C2: цвет обшивки — линейный тёмный тон корпуса (frigate 0x2a2d33):
  // все сэмплы близки к линейному цвету корпуса (допуск 0.012)
  const hc = new (window.__THREE.Color)(p.preset.colors.hull);
  const offColor = wallSamples.filter(s =>
    Math.abs(s.r - hc.r) > 0.012 || Math.abs(s.g - hc.g) > 0.012 || Math.abs(s.b - hc.b) > 0.012).length;
  // C3: ПОРУЧЕНЬ (лента у верхней кромке перил) и СТОЙКИ у стены —
  // тёмные, в тон корпуса; мелкая фурнитура (колышки, подушки балясин
  // у передней стены) — не считается
  const railH0 = Math.max(0.62, Math.min(1.05, p.preset.quarter * 0.55));
  const wallXAt = (z) => {
    let best = wallSamples[0], bd = 1e9;
    for (const w of wallSamples) { const d = Math.abs(w.z - z); if (d < bd) { bd = d; best = w; } }
    return best ? best.xAbs : 99;
  };
  let lightHandrail = 0, lightPosts = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const xs = [pos.getX(i), pos.getX(i+1), pos.getX(i+2)];
    const ys = [pos.getY(i), pos.getY(i+1), pos.getY(i+2)];
    const zs = [pos.getZ(i), pos.getZ(i+1), pos.getZ(i+2)];
    const zSpread = Math.max(...zs) - Math.min(...zs);
    const yMid = (ys[0]+ys[1]+ys[2])/3;
    const zMid = (zs[0]+zs[1]+zs[2])/3;
    const xAbs = Math.min(...xs.map(Math.abs));
    if (xAbs <= 1.4) continue;
    const r = (col.getX(i)+col.getX(i+1)+col.getX(i+2))/3;
    if (r <= 0.15) continue;
    // поручень — лента в верхнем поясе перил
    if (yMid > fS + railH0 - 0.02 && yMid < fS + railH0 + 0.16 && zSpread < 0.6) lightHandrail++;
    // стойки у бортовой стены (передняя стена с балюстрадой — не в счёт)
    if (zSpread < 0.25 && zMid < q.frontZ - 0.35
      && yMid > fS + 0.16 && yMid < fS + railH0 - 0.1
      && xAbs > wallXAt(zMid) + 0.03) lightPosts++;
  }
  return JSON.stringify({
    ok: true, slopeYperZ: +slope.toFixed(3), nRailPts: railPts.length,
    wallTris: wallSamples.length, jumpsOver6cm: jumps, maxJumpCm: +(maxJump * 100).toFixed(1),
    offColor, lightHandrail, lightPosts,
    hullLinear: [+hc.r.toFixed(3), +hc.g.toFixed(3), +hc.b.toFixed(3)],
  });
})()`));
log('B/C:', JSON.stringify(qd));
check('B: поручень трапа НАКЛОНЁН (|уклон| > 0.25 м/м)', qd.ok && Math.abs(qd.slopeYperZ) > 0.25,
  `slope=${qd.slopeYperZ} точек=${qd.nRailPts}`);
check('C: боковинка — ГЛАДКАЯ лента (скачки > 6 см: 0)', qd.ok && qd.jumpsOver6cm === 0,
  `трисов=${qd.wallTris} макс.скачок=${qd.maxJumpCm} см`);
check('C: обшивка ТОЧНО в цвет корпуса (чужих цветов: 0)', qd.ok && qd.offColor === 0, `чужих=${qd.offColor}`);
check('C: поручень ленты — тёмный, в тон корпуса', qd.ok && qd.lightHandrail === 0, `светлых=${qd.lightHandrail}`);
check('C: стойки перил у борта — тёмные', qd.ok && qd.lightPosts === 0, `светлых=${qd.lightPosts}`);

// ================= D: команда на полигоне =================
log('=== D: смена корабля на полигоне — команда под новое судно ===');
const crewD = jparse(ev(`(() => {
  const g = window.__game;
  g.startProving('frigate');
  const p = g.player;
  const before = { model: p.preset.id, crew: p.crew, max: p.preset.maxCrew };
  // крупный корабль
  g.changeShip('victory', true);
  let t = g.time;
  for (let i = 0; i < 20; i++) { t += 1/60; g.player.fixedStep(1/60, t); g.player.updateVisual(t, 1/60, g.particles); }
  const big = { model: g.player.preset.id, crew: g.player.crew, max: g.player.preset.maxCrew,
    figures: g.player.crew3d.group.children.filter(c => c.visible).length };
  // маленький корабль
  g.changeShip('sloop', true);
  t = g.time;
  for (let i = 0; i < 20; i++) { t += 1/60; g.player.fixedStep(1/60, t); g.player.updateVisual(t, 1/60, g.particles); }
  const small = { model: g.player.preset.id, crew: g.player.crew, max: g.player.preset.maxCrew,
    figures: g.player.crew3d.group.children.filter(c => c.visible).length };
  return JSON.stringify({ before, big, small,
    expectBig: Math.round(850 * 0.8), expectSmall: Math.round(24 * 0.8) });
})()`));
log('D:', JSON.stringify(crewD));
check('D: большой корабль — команда по штату (680/850)', crewD.big.crew === crewD.expectBig,
  `crew=${crewD.big?.crew} ожид.${crewD.expectBig}`);
check('D: маленький корабль — команда ПОМЕНЯЛАСЬ (19/24)',
  crewD.small.crew === crewD.expectSmall && crewD.small.crew !== crewD.big.crew,
  `crew=${crewD.small?.crew} ожид.${crewD.expectSmall}`);
check('D: фигурок на палубе меньше на малом судне', crewD.small.figures < crewD.big.figures,
  `big=${crewD.big?.figures} small=${crewD.small?.figures}`);

// ================= E: ядра =================
log('=== E: пробитие повреждённого корпуса / пролёт над палубой ===');
const ballsE = jparse(ev(`(() => {
  const g = window.__game;
  const T = window.__THREE;
  const c = g.combat;
  const tgt = g.pgTarget.ship;
  const p = g.player;
  const out = {};
  const shoot = (dist, y, speed, hullFrac) => {
    tgt.clearDamage && tgt.clearDamage();
    tgt.hullHP = tgt.hullMax * hullFrac;
    const dir = new T.Vector3().subVectors(tgt.position, p.position).setY(0).normalize();
    const start = tgt.position.clone().addScaledVector(dir, -dist);
    start.y = y;
    const pr = c.projectiles.find(q => !q.active);
    pr.active = true;
    pr.pos.copy(start); pr.prev.copy(start);
    pr.type = 'ball'; pr.shooter = p; pr.age = 0; pr.trailT = 0; pr.spin = 0;
    pr.pierced = new Map(); pr.hullPierce = null;
    pr.vel.copy(dir).multiplyScalar(speed);
    let t = g.time;
    let pierced = -1, exited = -1, frames = 0;
    for (let i = 0; i < 1200; i++) {
      t += 1 / 60;
      c.update(1 / 60, t, () => 0, null, null, null);
      frames = i;
      if (pr.hullPierce === tgt && pierced < 0) pierced = i;
      if (pierced >= 0 && pr.hullPierce !== tgt && exited < 0) exited = i;
      if (!pr.active) break;
    }
    return { pierced, exited, frames, insideMs: exited > pierced && pierced >= 0 ? +(((exited - pierced) / 60) * 1000).toFixed(0) : -1,
      finalActive: pr.active, hullFrac: +(tgt.hullHP / tgt.hullMax).toFixed(2) };
  };
  // E1: борт в борт, повреждён 30% — пробитие насквозь
  out.e1 = shoot(40, 2.2, 120, 0.3);
  // E2: НАД палубой (hullTop + 2.5 м) — фантомной стены нет
  const F = tgt.preset.freeboard;
  const hullTop = F * 1.17 + (tgt.preset.quarter ?? 0) + 0.85;
  out.e2 = shoot(70, hullTop + 2.5, 150, 0.3);
  out.e2.hullTop = +hullTop.toFixed(2);
  out.e2.oldCeil = +(F + tgt.preset.length * 0.35).toFixed(2);
  // E3: свежий борт — ядро принимает в себя (гаснет у борта)
  out.e3 = shoot(40, 2.2, 120, 1.0);
  return JSON.stringify(out);
})()`));
log('E:', JSON.stringify(ballsE));
check('E1: повреждённый борт — ПРОБИТИЕ (вход+выход)',
  ballsE.e1.pierced >= 0 && ballsE.e1.exited > ballsE.e1.pierced,
  `вход=${ballsE.e1?.pierced} выход=${ballsE.e1?.exited}`);
check('E1: внутри корпуса < 500 мс (не застревает)', ballsE.e1.insideMs >= 0 && ballsE.e1.insideMs < 500,
  `внутри=${ballsE.e1?.insideMs} мс`);
check('E1: ядро ушло с экрана (неактивно)', ballsE.e1.finalActive === false, `active=${ballsE.e1?.finalActive}`);
check('E2: НАД палубой фантомной стены НЕТ (пролёт без пробития)',
  ballsE.e2.pierced < 0, `пробитий=${ballsE.e2?.pierced} граница=${ballsE.e2?.hullTop} (старая=${ballsE.e2?.oldCeil})`);
check('E3: свежий борт принимает ядро (гаснет, не висит)',
  ballsE.e3.pierced < 0 && ballsE.e3.finalActive === false, `кадров=${ballsE.e3?.frames}`);

// ================= F: скриншоты для VLM =================
log('=== F: скриншоты ===');
ev(`(() => {
  const g = window.__game;
  const p = g.player;
  g.changeShip('frigate', true);
  p.quaternion.setFromEuler(new window.__THREE.Euler(0, 0, 0));
  p.velocity.set(0, 0, 0); p.angular.set(0, 0, 0); p.anchored = true;
  g.exitProving();
  g.setCameraMode('free');
  return 'ok';
})()`);
await sleep(1200);
const setCam = (azim, elev, dist) => ev(`(() => {
  window.__game.rig.freeAzimSet(${azim}); window.__game.rig.freeElevSet(${elev});
  window.__game.rig.distSet(${dist}); window.__game.rig.snap();
  return 'ok';
})()`);
// корма со шлюпбалками (азимут 3π/2 = за кормой)
setCam('Math.PI * 1.5 + 0.35', 0.26, 24);
await sleep(1500);
shot('t23_stern_davits');
await sleep(300);
// борт квартердека (азимут 0 = чистый борт)
setCam('0.15', 0.2, 21);
await sleep(1500);
shot('t23_qd_broadside');
await sleep(300);
// трап (борт-нос)
setCam('0.75', 0.3, 14);
await sleep(1500);
shot('t23_stair_rail');
await sleep(300);

// страница без ошибок
const pageErrs = jparse(ev(`(() => JSON.stringify(window.__pageErrors || []))()`));
check('F: страница без ошибок JS', Array.isArray(pageErrs) && pageErrs.length === 0, JSON.stringify(pageErrs));

log(fails === 0 ? '\nALL OK' : `\nFAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
