// Task 82: числовой аудит корпуса — сквозные щели и выступающие доски.
//  A) «просвет»: на сетке (z, y) от среза обшивки до планширя пускаем
//     горизонтальный луч снаружи к ДП; первое пересечение должно быть
//     НА обшивке (не глубже обвода на 10 см) — иначе щель.
//  B) палуба: вершины меша Planks_Deck не выходят за обвод корпуса
//     на своей высоте (торчавшие концы досок = «плашки» на борту).
//  C) пояса: сколько поясов, где верхняя кромка верхнего пояса
//     относительно низа планширя (перекрытие > 0 — щели нет).
// Запуск (dev-сервер поднят): node scripts/t82_hullaudit.mjs [presetId]
import { execSync } from 'node:child_process';

const presetId = process.argv[2] || '';
const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let outp = runRaw(args);
  for (let i = 0; i < tries && (!outp.trim() || outp.includes('Resource temporarily unavailable') || outp.includes('Cdp command timed out') || outp.includes('Failed to read')); i++) {
    execSync('sleep 12');
    outp = runRaw(args);
  }
  return outp;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

runRaw('close');
run('open http://localhost:3000');
try { run('set viewport 1600 900'); } catch { /* старые версии CLI */ }
await sleep(9000);
for (let i = 0; i < 24; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
const res = await ev(`(() => {
  const g = window.__game, T = window.__THREE;
  if ('${presetId}') { try { g.changeShip('${presetId}', true, true); } catch (e) { return JSON.stringify({ error: String(e) }); } }
  g.paused = true; g.rig.update = () => {};
  const p = g.player, P = p.preset, L = P.length;
  const grp = p.visual.group; grp.updateWorldMatrix(true, true);
  const ps = p.visual.planks;
  const sm = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const prof = t => { const B = P.beam / 2; let w; if (t < 0.45) w = 0.58 + 0.42 * sm(t / 0.45); else w = 1 - Math.pow(sm((t - 0.45) / 0.55), 0.75);
    if (P.flatBow && t > 0.74) { const flat = 0.74 - 0.32 * sm((t - 0.82) / 0.18); const blend = sm((t - 0.74) / 0.08); w = w + (Math.max(w, flat) - w) * blend; }
    const draft = P.draft * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    let bul; if (P.beakhead) bul = P.freeboard * (0.85 + 0.36 * Math.pow(1 - t, 2.4) + 0.08 * Math.pow(Math.max(0, t - 0.7) / 0.3, 2)); else bul = P.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.4) + 0.5 * Math.pow(1 - t, 2.2) * 0.6);
    return { w: w * B, draft, bulwark: bul }; };
  const hwAt = (t, y) => { const q = prof(t); const u = Math.min(1, Math.max(0, (y + q.draft) / (q.draft + q.bulwark))); return q.w * (0.16 + 0.84 * Math.pow(u, 0.6)); };
  const targets = [...ps.group.children];
  grp.getObjectByName('Skeleton').traverse(o => { if (o.isMesh && o.name !== 'Keel_Bottom') targets.push(o); });
  const q = new T.Quaternion(); grp.getWorldQuaternion(q);
  const rc = new T.Raycaster();
  const out = { preset: P.id, L, quarter: !!P.quarter, nRec: ps.records.length, gaps: [], nSamples: 0, deepest: 0 };
  const yCut = -P.draft * 0.62;
  // Task 82: линия стены транца transomZ(y) — с ней сверяем лучи бортов
  const y0s = yCut - 0.01 + 0.24;
  const yTopT = prof(0.03).bulwark - 0.015 - 0.24;
  const tz = (y) => { const f = Math.min(1, Math.max(0, (y - y0s) / (yTopT - y0s)));
    return -L / 2 - 0.01 - f * (L * (P.quarter ? 0.012 : 0.02) - 0.01); };
  const zFrom = -L * 0.499, zTo = L * 0.49;
  for (let z = zFrom; z <= zTo; z += 0.45) {
    const t = (z + L / 2) / L; const pr = prof(t);
    for (let y = yCut + 0.14; y < pr.bulwark - 0.05; y += 0.16) {
      // за линией стены транца борта нет (стена/руль) — там проверка D
      if (z < tz(y) + 0.08) continue;
      for (const s of [1, -1]) {
        const hw = hwAt(t, y);
        const o = new T.Vector3(s * (hw + 5), y, z); grp.localToWorld(o);
        const d = new T.Vector3(-s, 0, 0).applyQuaternion(q);
        rc.set(o, d); rc.far = 12;
        const hits = rc.intersectObjects(targets, false);
        out.nSamples++;
        if (!hits.length) { out.gaps.push([+z.toFixed(2), +y.toFixed(2), s, 'нет пересечения']); continue; }
        const lp = grp.worldToLocal(hits[0].point.clone());
        const depth = hw - Math.abs(lp.x);
        if (depth > out.deepest) out.deepest = +depth.toFixed(3);
        if (depth > 0.10) out.gaps.push([+z.toFixed(2), +y.toFixed(2), s, 'глубина ' + depth.toFixed(2) + ' ' + (hits[0].object.name || hits[0].object.parent.name)]);
      }
    }
  }
  // D) стена транца: лучи из-за кормы вдоль +Z на сетке (y, x) должны
  //    попадать в стену у линии transomZ(y) (руль/штевень — |x|<0.16,
  //    их не проверяем). Прежде стена стояла на 45–84 см впереди среза
  //    и лучи уходили в открытый карман.
  {
    const gaps = []; let n = 0;
    for (let y = y0s + 0.15; y < yTopT - 0.10; y += 0.16) {
      const hwT = hwAt(0.02, y);
      for (let x = 0.16; x <= Math.max(0.61, 0.75 * hwT); x += 0.45) {
        for (const s of [1, -1]) {
          const o = new T.Vector3(s * x, y, tz(y) - 1.2); grp.localToWorld(o);
          const d = new T.Vector3(0, 0, 1).applyQuaternion(q);
          rc.set(o, d); rc.far = 3;
          const hits = rc.intersectObjects(targets, false);
          n++;
          if (!hits.length) { gaps.push([+y.toFixed(2), +(s * x).toFixed(2), 'нет пересечения']); continue; }
          const lp = grp.worldToLocal(hits[0].point.clone());
          if (Math.abs(lp.z - tz(y)) > 0.12) gaps.push([+y.toFixed(2), +(s * x).toFixed(2), 'z=' + lp.z.toFixed(2) + ' (стена ' + tz(y).toFixed(2) + ') ' + (hits[0].object.name || hits[0].object.parent.name)]);
        }
      }
    }
    out.wall = { rays: n, gaps };
  }
  // E) нос: лучи из-за носа вдоль -Z — только зона штевня/торцов
  //    поясов (|x| ≤ 0.13, ожидаем поверхность у 0.465L): дальше борт
  //    сужается к штевню и «промах» был бы ложным (корпуса там нет)
  {
    const gaps = []; let n = 0;
    const yTopB = prof(0.99).bulwark - 0.015 - 0.24;
    for (let y = y0s + 0.15; y < yTopB - 0.10; y += 0.16) {
      for (let x = 0.02; x <= 0.13; x += 0.055) {
        for (const s of [1, -1]) {
          const o = new T.Vector3(s * x, y, L / 2 + 1.2); grp.localToWorld(o);
          const d = new T.Vector3(0, 0, -1).applyQuaternion(q);
          rc.set(o, d); rc.far = 4;
          const hits = rc.intersectObjects(targets, false);
          n++;
          if (!hits.length) { gaps.push([+y.toFixed(2), +(s * x).toFixed(2), 'нет пересечения']); continue; }
          const lp = grp.worldToLocal(hits[0].point.clone());
          if (lp.z < 0.465 * L) gaps.push([+y.toFixed(2), +(s * x).toFixed(2), 'z=' + (lp.z / L).toFixed(3) + 'L ' + (hits[0].object.name || hits[0].object.parent.name)]);
        }
      }
    }
    out.bow = { rays: n, gaps };
  }
  // B: палуба против обвода
  const deck = grp.getObjectByName('Planks_Deck'); let poke = 0, pokeAt = null, nV = 0;
  if (deck) { const a = deck.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { const x = Math.abs(a.getX(i)), y = a.getY(i), z = a.getZ(i);
      if (y < yCut) continue; nV++;
      const lim = hwAt((z + L / 2) / L, y);
      if (x - lim > poke) { poke = x - lim; pokeAt = [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +lim.toFixed(2)]; } } }
  out.deck = { vertices: nV, maxPoke: +poke.toFixed(3), at: pokeAt };
  // C: верхняя кромка верхнего пояса против низа планширя по шпациям
  const rail = [];
  for (const zz of [-0.46, -0.40, -0.25, -0.10, 0, 0.15, 0.30, 0.42, 0.46]) {
    const z = zz * L; const t = (z + L / 2) / L; const pr = prof(t);
    let top = -1e9;
    for (const r of ps.records) { if (r.cls !== 0 || r.side !== 1) continue;
      if (Math.abs(r.z - z) > r.len / 2 + 0.05) continue;
      const half = r.w / 2 * Math.cos(0.09);
      const yc = r.center.y + (z - r.z) * ((r.center.y - r.y) * 0 + 0);
      const m = new T.Matrix4().compose(r.center, r.quat, new T.Vector3(r.thick, r.w, r.len));
      const v = new T.Vector3();
      for (let sy = -0.5; sy <= 0.5; sy += 1) for (let sz = -0.5; sz <= 0.5; sz += 0.5) { v.set(0.5, sy, sz).applyMatrix4(m); if (Math.abs(v.z - z) < 0.6 && v.y > top) top = v.y; }
    }
    rail.push([zz, +(top - (pr.bulwark - 0.07)).toFixed(3)]);
  }
  out.rail = rail;
  out.strakes = [...new Set(ps.records.filter(r => r.cls === 0 && r.side === 1).map(r => r.y.toFixed(2)))].length;
  out.waterways = ps.records.filter(r => r.id.includes('_W')).length;
  return JSON.stringify(out);
})()`);
const txt = String(res).replace(/^"|"$/g, '').replace(/\\"/g, '"');
try {
  const o = JSON.parse(txt);
  if (o.error) { console.log('ОШИБКА:', o.error); process.exit(1); }
  console.log(`пресет ${o.preset}: L=${o.L}, квартердэк=${o.quarter}, записей ${o.nRec}, поясов ${o.strakes}, ватервейсов ${o.waterways}`);
  console.log(`A) лучей ${o.nSamples}: щелей ${o.gaps.length}, макс. заглубление ${o.deepest} м`);
  for (const gp of o.gaps.slice(0, 40)) console.log('    z=' + gp[0], 'y=' + gp[1], gp[2] > 0 ? 'порт' : 'штирборт', gp[3]);
  if (o.gaps.length > 40) console.log('    … ещё', o.gaps.length - 40);
  if (o.wall) {
    console.log(`D) стена транца: лучей ${o.wall.rays}, промахов ${o.wall.gaps.length}`);
    for (const gp of o.wall.gaps.slice(0, 20)) console.log('    y=' + gp[0], 'x=' + gp[1], gp[2]);
    if (o.wall.gaps.length > 20) console.log('    … ещё', o.wall.gaps.length - 20);
  }
  if (o.bow) {
    console.log(`E) нос: лучей ${o.bow.rays}, промахов ${o.bow.gaps.length}`);
    for (const gp of o.bow.gaps.slice(0, 20)) console.log('    y=' + gp[0], 'x=' + gp[1], gp[2]);
    if (o.bow.gaps.length > 20) console.log('    … ещё', o.bow.gaps.length - 20);
  }
  console.log(`B) палуба: вершин ${o.deck.vertices}, макс. выступ за обвод ${o.deck.maxPoke} м`, o.deck.at ? `в (x=${o.deck.at[0]}, y=${o.deck.at[1]}, z=${o.deck.at[2]}; обвод ${o.deck.at[3]})` : '');
  console.log('C) перекрытие верхнего пояса с планширём по шпациям (м, > 0 — щели нет):');
  console.log('   ', o.rail.map(r => `${r[0]}L: ${r[1]}`).join('  '));
} catch (e) {
  console.log(txt.slice(0, 2500));
}
