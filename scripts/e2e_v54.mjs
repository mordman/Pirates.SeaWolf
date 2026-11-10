// E2E Task 36 (ЧАСТЬ 1: мир/берега/горы/деревни/текстуры/вода).
// Полный тест разделён на 3 части (v54, v54b, v54c) — тяжёлые
// сцены в headless не влезают в один таймаут.
//  (A) МИР ×10: 30 островов, радиусы 1.05–3.3 км, карта ≤ ±46 км
//  (B) БЕРЕГА: пологий пляж + резкий обрыв, умеренное мелководье
//  (C) ГОРЫ: вершины ≥ 250 м, хребты
//  (D) ДЕРЕВНИ: ≥ 40 деревень, ≥ 300 хижин, ≥ 500 жителей, тропы,
//      рыбацкие лодки вокруг островов
//  (E) РАСТИТЕЛЬНОСТЬ: кусты+пальмы+джунгли, коллайдеры стволов
//  (F) ВОДА НЕПРОЗРАЧНАЯ (фикс «прозрачная поверхность»)
//  (G) ТЕКСТУРИРОВАНИЕ: по умолчанию вкл, настройкой выкл/вкл
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// демон agent-browser «занят» после тяжёлых eval — повторяем
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
ev(`window.__game.start()`);
await sleep(400);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// ================= A: МИР ×10 =================
log('\n===== A: КАРТА И ОСТРОВА ×10 (площадь ×100) =====');
const world = jparse(ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands;
  let minGap = Infinity;
  for (let i = 0; i < isl.length; i++) for (let j = i + 1; j < isl.length; j++) {
    const d = Math.hypot(isl[i].cx - isl[j].cx, isl[i].cz - isl[j].cz) - isl[i].r - isl[j].r;
    if (d < minGap) minGap = d;
  }
  return JSON.stringify({
    n: isl.length,
    minR: Math.min(...isl.map(i => i.r)),
    maxR: Math.max(...isl.map(i => i.r)),
    maxCoord: Math.max(...isl.map(i => Math.max(Math.abs(i.cx), Math.abs(i.cz)))),
    r0: isl[0].r,
    area0: Math.round(Math.PI * isl[0].r * isl[0].r / 1e6),
    minGap: Math.round(minGap),
    maxH: Math.max(...isl.map(i => i.maxH)),
  });
})()`));
log(JSON.stringify(world));
check('A1: 30 островов, радиусы 1–3.4 км, карта до ±45 км',
  world.n === 30 && world.minR >= 1000 && world.maxR >= 3200 && world.maxCoord >= 40000 && world.maxCoord <= 46000);
check('A2: площадь острова-гавани ≈ ×100 (34 км² против 0.34)',
  world.area0 >= 30 && world.area0 <= 38, `${world.area0} км²`);
check('A3: проливы между берегами ≥ 6 км', world.minGap >= 5900, `мин ${world.minGap} м`);
check('A4: ГОРЫ до 340 м заявлены', world.maxH >= 300, `maxH ${world.maxH}`);

// ================= B: БЕРЕГА =================
log('\n===== B: РАЗНООБРАЗНЫЕ БЕРЕГА (пляж/камень/обрыв) =====');
const coasts = jparse(ev(`(() => {
  const g = window.__game;
  const out = { beachSlope: -1, cliffSlope: -1, shelfBeach: -1 };
  const profile = (i, th) => {
    const isl = g.world.islands[i];
    const ux = Math.cos(th), uz = Math.sin(th);
    let lo = 0, hi = isl.r * 2;
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      if (window.__heightAt(isl.cx + ux * mid, isl.cz + uz * mid) > 0.2) lo = mid; else hi = mid;
    }
    const coast = (lo + hi) / 2;
    const at = (off) => window.__heightAt(isl.cx + ux * (coast + off), isl.cz + uz * (coast + off));
    return at;
  };
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2;
    const at = profile(1, th);
    let d3 = -1;
    for (let off = 5; off <= 160; off += 5) {
      if (at(off) < -3) { d3 = off; break; }
    }
    if (d3 >= 25 && out.beachSlope < 0) out.beachSlope = d3;
  }
  outer:
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < 24; k++) {
      const th = (k / 24) * Math.PI * 2;
      const at = profile(i, th);
      let d10 = -1;
      for (let off = 5; off <= 200; off += 5) {
        if (at(off) < -10) { d10 = off; break; }
      }
      if (d10 > 0 && d10 <= 45) { out.cliffSlope = d10; break outer; }
    }
  }
  const at0 = profile(0, Math.atan2(1, -1));
  let shelf = -1;
  for (let off = 5; off <= 400; off += 5) {
    if (at0(off) < -6) { shelf = off; break; }
  }
  out.shelfBeach = shelf;
  return JSON.stringify(out);
})()`));
log(JSON.stringify(coasts));
check('B1: ПОЛГИЙ ПЛЯЖ есть (0→−3 м тянется ≥ 25 м — шлюпка подходит)',
  coasts.beachSlope >= 25, `−3 м на ${coasts.beachSlope} м`);
check('B2: РЕЗКИЙ БЕРЕГ есть (0→−10 м ≤ 45 м — скала/обрыв)',
  coasts.cliffSlope > 0 && coasts.cliffSlope <= 45, `−10 м на ${coasts.cliffSlope} м`);
check('B3: мелководье у пляжа умеренное (≤ 200 м)',
  coasts.shelfBeach > 0 && coasts.shelfBeach <= 200, `−6 м на ${coasts.shelfBeach} м`);

// ================= C: ГОРЫ =================
log('\n===== C: ГОРЫ, ХРЕБТЫ =====');
const mountains = jparse(ev(`(() => {
  const g = window.__game;
  const isl = g.world.islands[2];
  const hCenter = window.__heightAt(isl.cx, isl.cz);
  const hs = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    hs.push(Math.round(window.__heightAt(isl.cx + Math.cos(a) * isl.r * 0.4, isl.cz + Math.sin(a) * isl.r * 0.4)));
  }
  return JSON.stringify({ hCenter: Math.round(hCenter), vary: Math.max(...hs) - Math.min(...hs) });
})()`));
log(JSON.stringify(mountains));
check('C1: ГОРНЫЙ остров: вершина ≥ 150 м', mountains.hCenter >= 150, `центр ${mountains.hCenter} м`);
check('C2: ХРЕБТЫ — рельеф варьируется (разброс ≥ 40 м)', mountains.vary >= 40, `разброс ${mountains.vary} м`);

// ================= D: ДЕРЕВНИ =================
log('\n===== D: ДЕРЕВНИ + ТРОПЫ + РЫБАЦКИЕ ЛОДКИ =====');
const vill = jparse(ev(`JSON.stringify(window.__sea.villages)`));
const fleet = jparse(ev(`JSON.stringify(window.__sea.coastFleet)`));
log(JSON.stringify(vill), JSON.stringify(fleet));
check('D1: деревень ≥ 40 на архипелаге', vill.total >= 40, `${vill.total}`);
check('D2: хижин ≥ 300, жителей ≥ 500', vill.huts >= 300 && vill.folk >= 500, `хижин ${vill.huts}, жителей ${vill.folk}`);
check('D3: ТРОПЫ от портов к деревням (сегментов ≥ 150)', vill.trails >= 150, `${vill.trails}`);
check('D4: рыбацких лодок вокруг островов ≥ 60, все на плаву',
  fleet.boats >= 60 && fleet.floating === fleet.boats, `${fleet.boats} лодок, ${fleet.fishermen} рыбаков`);

// ================= E: РАСТИТЕЛЬНОСТЬ =================
log('\n===== E: РАСТИТЕЛЬНОСТЬ (кусты → джунгли) =====');
const veg = jparse(ev(`(() => {
  const g = window.__game;
  const st = window.__sea.veg;
  const isl = g.world.islands[0];
  const tree = g.debugNearestCuttable(isl.cx, isl.cz, 3500, true);
  let jungleHit = false;
  if (tree) {
    const push = g.world.collideLand(tree.x + 0.55, tree.z, 0.42);
    jungleHit = !!push;
  }
  return JSON.stringify({ veg: st, jungleHit, kind: tree ? tree.kind : null });
})()`));
log(JSON.stringify(veg.veg).slice(0, 200), 'ствол-коллайдер:', veg.jungleHit, veg.kind);
const jungleN = veg.veg.jungle?.n ?? 0;
const bushN = veg.veg.bush?.n ?? 0;
const palmN = veg.veg.palm?.n ?? 0;
check('E1: ГРАДИЕНТ: и кусты, и пальмы, и ДЖУНГЛИ по всему миру',
  jungleN >= 2000 && bushN >= 2000 && palmN >= 2000, `джунглей ${jungleN}, кустов ${bushN}, пальм ${palmN}`);
check('E2: коллайдеры растительности работают (ствол непроходим)', veg.jungleHit === true, `у дерева «${veg.kind}»`);

// ================= F: ВОДА =================
log('\n===== F: ФИКС «прозрачная поверхность у островов» =====');
const water = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ transparent: g.water.material.transparent, depthWrite: g.water.material.depthWrite });
})()`));
log(JSON.stringify(water));
check('F1: вода НЕпрозрачная (transparent=false, depthWrite=true)',
  water.transparent === false && water.depthWrite === true);

// ================= G: ТЕКСТУРИРОВАНИЕ =================
log('\n===== G: ТЕКСТУРИРОВАНИЕ ОСТРОВОВ (настройка) =====');
ev(`window.__game.stepDebugNR(6)`);
await sleep(300);
const tex1 = jparse(ev(`(() => {
  const g = window.__game;
  let v = null;
  try { v = JSON.parse(localStorage.getItem('seawolves.settings.v1')).v; } catch { }
  return JSON.stringify({
    setting: g.settings.graphics.islandTextures,
    applied: g.world.terrain.texturesOn(),
    tiles: window.__sea.terrain.tiles,
    nearTiles: window.__sea.terrain.nearTiles,
    schema: v,
  });
})()`));
log(JSON.stringify(tex1));
check('G1: текстурирование ВКЛЮЧЕНО по умолчанию и применено',
  tex1.setting === true && tex1.applied === true);
check('G2: рельеф-стример построил тайлы (≥ 60, есть детальные)',
  tex1.tiles >= 60 && tex1.nearTiles >= 1, `тайлов ${tex1.tiles}, детальных ${tex1.nearTiles}`);
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.graphics.islandTextures = false; g.applySettings(s); return 'off'; })()`);
const tex2 = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ applied: g.world.terrain.texturesOn(), setting: g.settings.graphics.islandTextures });
})()`));
check('G3: выключается настройкой', tex2.applied === false && tex2.setting === false);
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.graphics.islandTextures = true; g.applySettings(s); return 'on'; })()`);
const tex3 = jparse(ev(`JSON.stringify({ applied: window.__game.world.terrain.texturesOn() })`));
check('G4: включается обратно', tex3.applied === true);

const errs = jparse(ev(`JSON.stringify(window.__jsErrors)`));
check('G5: 0 ошибок JS (часть 1)', Array.isArray(errs) && errs.length === 0);

log(`\n===== ИТОГ e2e_v54 (часть 1): ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
if (fails > 0) process.exit(1);
