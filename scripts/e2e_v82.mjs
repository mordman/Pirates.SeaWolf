// E2E Task 82 — «анализ проекта + детализация всех 3D-моделей»:
// (A) КОРПУС: пояса сведены к штевням (clamp 0.06), стена транца на
//     ЕДИНОЙ линии transomZ(y) (низ на срезе, верх за корму), планширь
//     и таффрел по той же линии, руль за транцем, форштевень-брус,
//     стена плоского носа (пинасс), плавный вход пинасса в плоский нос.
//     Гварды: лучи борта/стены/носа (как t82_hullaudit, компактно),
//     выступ кромки настила = 0 (клин центральной колонки), верхний
//     пояс под планширем по шпациям.
// (B) ПАРУСА: процедурная ткань — вертикальные полотнища uSeamsN,
//     риф-банты, кромка, погода, ПРОСВЕТ против солнца; нормаль
//     пуза в МИРОВЫХ координатах (mat3(modelMatrix)); плотнее сетка.
// (C) ТАКЕЛАЖ: объёмные тросы стоячего такелажа (меш на мачту,
//     userData.mast) — обрыв вместе с мачтой (snapRigging), возврат
//     clearDamage; материал пенькового троса с бликом.
// (D) ШЕЙДЕР ДЕРЕВА: вельс/пояс планширя по СЕДЛОВАТОСТИ (GLSL
//     bulwark(t)), applyWoodShader на рангоут; контраст паза в краске.
// (E) Рендер: без ошибок страницы, разумные draw calls/треугольники.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('/home/z/my-project/scripts/shots', { recursive: true });

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
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(500);

// ============ компактный корпусной аудит (как t82_hullaudit) ============
// guard-функция на борту страницы: лучи бортов/стены транца/носа,
// выступ кромки настила, перекрытие верхнего пояса планширём
const hullAudit = jparse(await evR(`(() => {
  const g = window.__game, T = window.__THREE;
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
  const yCut = -P.draft * 0.62;
  const y0s = yCut - 0.01 + 0.24;
  const yTopT = prof(0.03).bulwark - 0.015 - 0.24;
  const tz = (y) => { const f = Math.min(1, Math.max(0, (y - y0s) / (yTopT - y0s)));
    return -L / 2 - 0.01 - f * (L * (P.quarter ? 0.012 : 0.02) - 0.01); };
  const out = { preset: P.id, gaps: 0, nA: 0, wallGaps: 0, nD: 0, bowGaps: 0, nE: 0, poke: 0, rail: [] };
  for (let z = -L * 0.499; z <= L * 0.49; z += 0.9) {
    const t = (z + L / 2) / L; const pr = prof(t);
    for (let y = yCut + 0.14; y < pr.bulwark - 0.05; y += 0.32) {
      if (z < tz(y) + 0.08) continue;
      for (const s of [1, -1]) {
        const hw = hwAt(t, y);
        const o = new T.Vector3(s * (hw + 5), y, z); grp.localToWorld(o);
        const d = new T.Vector3(-s, 0, 0).applyQuaternion(q);
        rc.set(o, d); rc.far = 12;
        const hits = rc.intersectObjects(targets, false);
        out.nA++;
        if (!hits.length) { out.gaps++; continue; }
        const lp = grp.worldToLocal(hits[0].point.clone());
        if (hw - Math.abs(lp.x) > 0.10) out.gaps++;
      }
    }
  }
  for (let y = y0s + 0.15; y < yTopT - 0.10; y += 0.32) {
    const hwT = hwAt(0.02, y);
    for (let x = 0.16; x <= Math.max(0.61, 0.75 * hwT); x += 0.9) {
      for (const s of [1, -1]) {
        const o = new T.Vector3(s * x, y, tz(y) - 1.2); grp.localToWorld(o);
        const d = new T.Vector3(0, 0, 1).applyQuaternion(q);
        rc.set(o, d); rc.far = 3;
        const hits = rc.intersectObjects(targets, false);
        out.nD++;
        if (!hits.length) { out.wallGaps++; continue; }
        const lp = grp.worldToLocal(hits[0].point.clone());
        if (Math.abs(lp.z - tz(y)) > 0.12) out.wallGaps++;
      }
    }
  }
  const yTopB = prof(0.99).bulwark - 0.015 - 0.24;
  for (let y = y0s + 0.15; y < yTopB - 0.10; y += 0.32) {
    for (let x = 0.02; x <= 0.13; x += 0.11) {
      for (const s of [1, -1]) {
        const o = new T.Vector3(s * x, y, L / 2 + 1.2); grp.localToWorld(o);
        const d = new T.Vector3(0, 0, -1).applyQuaternion(q);
        rc.set(o, d); rc.far = 4;
        const hits = rc.intersectObjects(targets, false);
        out.nE++;
        if (!hits.length) { out.bowGaps++; continue; }
        const lp = grp.worldToLocal(hits[0].point.clone());
        if (lp.z < 0.465 * L) out.bowGaps++;
      }
    }
  }
  const deck = grp.getObjectByName('Planks_Deck');
  if (deck) { const a = deck.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { const x = Math.abs(a.getX(i)), y = a.getY(i), z = a.getZ(i);
      if (y < yCut) continue;
      out.poke = Math.max(out.poke, x - hwAt((z + L / 2) / L, y)); } }
  for (const zz of [-0.42, 0, 0.42, 0.46]) {
    const z = zz * L; const t = (z + L / 2) / L; const pr = prof(t);
    let top = -1e9;
    for (const r of ps.records) { if (r.cls !== 0 || r.side !== 1) continue;
      if (Math.abs(r.z - z) > r.len / 2 + 0.05) continue;
      const m = new T.Matrix4().compose(r.center, r.quat, new T.Vector3(r.thick, r.w, r.len));
      const v = new T.Vector3();
      for (let sy = -0.5; sy <= 0.5; sy += 1) for (let sz = -0.5; sz <= 0.5; sz += 0.5) { v.set(0.5, sy, sz).applyMatrix4(m); if (Math.abs(v.z - z) < 0.6 && v.y > top) top = v.y; } }
    out.rail.push(+((top - (pr.bulwark - 0.07))).toFixed(3));
  }
  out.records = ps.records.length;
  return JSON.stringify(out);
})()`));

check('A1: борта: сквозных щелей нет (лучи к ДП)',
  hullAudit && hullAudit.gaps === 0,
  `${hullAudit.preset}: ${hullAudit.nA} лучей, щелей ${hullAudit.gaps}`);
check('A2: стена транца на линии transomZ (лучи из-за кормы)',
  hullAudit && hullAudit.wallGaps === 0,
  `${hullAudit.nD} лучей, промахов ${hullAudit.wallGaps}`);
check('A3: нос закрыт до штевня (лучи из-за носа)',
  hullAudit && hullAudit.bowGaps === 0,
  `${hullAudit.nE} лучей, промахов ${hullAudit.bowGaps}`);
check('A4: кромка настила не пробивает борт',
  hullAudit && hullAudit.poke <= 0.02,
  `макс. выступ ${hullAudit.poke?.toFixed(3)} м`);
check('A5: верхний пояс под планширем по шпациям',
  hullAudit && hullAudit.rail.length === 4 && hullAudit.rail.every(v => v > 0),
  `перекрытия: ${hullAudit.rail?.join(' ')}`);

// ============ B: ПАРУСА — процедурная ткань ============
const sailsInfo = jparse(await evR(`(() => {
  const g = window.__game;
  const sails = g.player.visual.sails.sails;
  return JSON.stringify({
    n: sails.length,
    seams: sails.map(s => s.mat.uniforms.uSeamsN ? s.mat.uniforms.uSeamsN.value : null),
    holesArr: sails.every(s => s.mat.uniforms.uHoles && s.mat.uniforms.uHoles.value.length === 8),
  });
})()`));
check('B1: у всех парусов — полотнища uSeamsN (ткань Task 82)',
  sailsInfo && sailsInfo.n > 0 && sailsInfo.seams.every(v => typeof v === 'number' && v >= 4),
  `парусов ${sailsInfo?.n}, полотнищ: ${sailsInfo?.seams?.join(',')}`);
check('B2: механизм пробоин паруса (uHoles×8) не задет',
  sailsInfo && sailsInfo.holesArr === true, '');

// сетка плотнее: у грота > 150 вершин (было 8×6=... 10×7 сетка ~88)
const sailGeo = jparse(await evR(`(() => {
  const s = window.__game.player.visual.sails.sails[0];
  return JSON.stringify({ verts: s.mesh.geometry.attributes.position.count });
})()`));
check('B3: сетка грота плотнее (пузо/трепет глаже)',
  sailGeo && sailGeo.verts >= 150, `вершин ${sailGeo?.verts}`);

// ============ C: ТАКЕЛАЖ — объёмные тросы ============
const ropesInfo = jparse(await evR(`(() => {
  const g = window.__game;
  const rig = g.player.visual.rigging;
  const masts = g.player.visual.masts.length;
  if (!rig || !rig.ropes) return { err: 'нет ropes' };
  return JSON.stringify({
    masts,
    ropes: rig.ropes.length,
    perMast: rig.ropes.map(r => r.userData.mast),
    tris: rig.ropes.reduce((a, r) => a + (r.geometry.index ? r.geometry.index.count / 3 : r.geometry.attributes.position.count / 3), 0),
  });
})()`));
check('C1: объёмные тросы: меш на каждую мачту',
  ropesInfo && !ropesInfo.err && ropesInfo.ropes >= ropesInfo.masts && ropesInfo.tris > 0,
  ropesInfo?.err ? ropesInfo.err : `мачт ${ropesInfo.masts}, мешей ${ropesInfo.ropes}, трис ${ropesInfo.tris}`);

const snapInfo = jparse(await evR(`(() => {
  const g = window.__game, p = g.player;
  const rig = p.visual.rigging;
  const n = p.snapRigging(0);
  const hidden = rig.ropes.filter(r => r.userData.mast === 0 && !r.visible).length;
  const snapped = p.riggingSnapped();
  p.clearDamage();
  const restored = rig.ropes.every(r => r.visible);
  return JSON.stringify({ n, hidden, snapped, restored });
})()`));
check('C2: обрыв мачты → тросы упали (snapRigging)',
  snapInfo && snapInfo.n > 0 && snapInfo.hidden > 0 && snapInfo.snapped > 0,
  `оборвано ${snapInfo?.n}, тросов спрятано ${snapInfo?.hidden}`);
check('C3: clearDamage → тросы восстановлены',
  snapInfo && snapInfo.restored === true, '');

// ============ D: пресеты с квартердеком/плоским носом ============
const fluytAudit = jparse(await evR(`(() => {
  const g = window.__game, T = window.__THREE;
  g.changeShip('fluyt', true, true);
  g.paused = true;
  const p = g.player, P = p.preset, L = P.length;
  const grp = p.visual.group; grp.updateWorldMatrix(true, true);
  const ps = p.visual.planks;
  const targets = [...ps.group.children];
  grp.getObjectByName('Skeleton').traverse(o => { if (o.isMesh && o.name !== 'Keel_Bottom') targets.push(o); });
  const q = new T.Quaternion(); grp.getWorldQuaternion(q);
  const rc = new T.Raycaster();
  let gaps = 0, n = 0;
  const yCut = -P.draft * 0.62;
  const sm = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const prof = t => { const B = P.beam / 2; let w; if (t < 0.45) w = 0.58 + 0.42 * sm(t / 0.45); else w = 1 - Math.pow(sm((t - 0.45) / 0.55), 0.75);
    const draft = P.draft * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    const bul = P.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.4) + 0.5 * Math.pow(1 - t, 2.2) * 0.6);
    return { w: w * B, draft, bulwark: bul }; };
  const hwAt = (t, y) => { const q2 = prof(t); const u = Math.min(1, Math.max(0, (y + q2.draft) / (q2.draft + q2.bulwark))); return q2.w * (0.16 + 0.84 * Math.pow(u, 0.6)); };
  for (let z = -L * 0.499; z <= L * 0.49; z += 1.1) {
    const t = (z + L / 2) / L; const pr = prof(t);
    for (let y = yCut + 0.14; y < pr.bulwark - 0.05; y += 0.4) {
      for (const s of [1, -1]) {
        const hw = hwAt(t, y);
        const o = new T.Vector3(s * (hw + 5), y, z); grp.localToWorld(o);
        const d = new T.Vector3(-s, 0, 0).applyQuaternion(q);
        rc.set(o, d); rc.far = 12;
        const hits = rc.intersectObjects(targets, false);
        n++;
        if (!hits.length) { gaps++; continue; }
        const lp = grp.worldToLocal(hits[0].point.clone());
        if (hw - Math.abs(lp.x) > 0.10) gaps++;
      }
    }
  }
  return JSON.stringify({ preset: P.id, gaps, n });
})()`));
check('D1: флейт (квартердек): борта без щелей',
  fluytAudit && fluytAudit.gaps === 0,
  `${fluytAudit?.preset}: ${fluytAudit?.n} лучей, щелей ${fluytAudit?.gaps}`);

const pinAudit = jparse(await evR(`(() => {
  const g = window.__game, T = window.__THREE;
  g.changeShip('pinnace', true, true);
  g.paused = true;
  const p = g.player, P = p.preset, L = P.length;
  const grp = p.visual.group; grp.updateWorldMatrix(true, true);
  const ps = p.visual.planks;
  const targets = [...ps.group.children];
  grp.getObjectByName('Skeleton').traverse(o => { if (o.isMesh && o.name !== 'Keel_Bottom') targets.push(o); });
  const q = new T.Quaternion(); grp.getWorldQuaternion(q);
  const rc = new T.Raycaster();
  let gaps = 0, n = 0;
  const yCut = -P.draft * 0.62;
  const y0s = yCut - 0.01 + 0.24;
  const sm = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const prof = t => { const B = P.beam / 2; let w; if (t < 0.45) w = 0.58 + 0.42 * sm(t / 0.45); else w = 1 - Math.pow(sm((t - 0.45) / 0.55), 0.75);
    if (t > 0.74) { const flat = 0.74 - 0.32 * sm((t - 0.82) / 0.18); const blend = sm((t - 0.74) / 0.08); w = w + (Math.max(w, flat) - w) * blend; }
    const draft = P.draft * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    const bul = P.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.4) + 0.5 * Math.pow(1 - t, 2.2) * 0.6);
    return { w: w * B, draft, bulwark: bul }; };
  const hwAt = (t, y) => { const q2 = prof(t); const u = Math.min(1, Math.max(0, (y + q2.draft) / (q2.draft + q2.bulwark))); return q2.w * (0.16 + 0.84 * Math.pow(u, 0.6)); };
  // лучи ИЗ-ЗА НОСА: стена плоского носа закрывает срез
  const yTopB = prof(0.99).bulwark - 0.015 - 0.24;
  for (let y = y0s + 0.15; y < yTopB - 0.10; y += 0.35) {
    for (let x = 0.02; x <= 0.6; x += 0.29) {
      for (const s of [1, -1]) {
        const o = new T.Vector3(s * x, y, L / 2 + 1.2); grp.localToWorld(o);
        const d = new T.Vector3(0, 0, -1).applyQuaternion(q);
        rc.set(o, d); rc.far = 4;
        const hits = rc.intersectObjects(targets, false);
        n++;
        if (!hits.length) { gaps++; continue; }
        const lp = grp.worldToLocal(hits[0].point.clone());
        if (lp.z < 0.465 * L) gaps++;
      }
    }
  }
  return JSON.stringify({ preset: P.id, gaps, n });
})()`));
check('D2: пинасс (плоский нос): стена закрывает срез',
  pinAudit && pinAudit.gaps === 0,
  `${pinAudit?.preset}: ${pinAudit?.n} лучей, промахов ${pinAudit?.gaps}`);

// обратно на шлюп для статистики рендера
ev(`(() => { window.__game.changeShip('sloop', true, true); return 1; })()`);
await sleep(2500);

// ============ E: рендер и ошибки ============
const rend = jparse(await evR(`(() => {
  const g = window.__game, r = g.renderer.info.render;
  return JSON.stringify({ calls: r.calls, tris: r.triangles, progs: g.renderer.info.programs.length });
})()`));
check('E1: бюджет рендера (draw calls / треугольники)',
  rend && rend.calls < 650 && rend.tris < 1700000,
  `calls ${rend?.calls}, tris ${rend?.tris}, progs ${rend?.progs}`);

const errs = String(run('errors')).trim();
check('E2: ошибок страницы нет', !errs || errs === '[]' || !/error/i.test(errs),
  errs ? errs.slice(0, 120) : '');

const nOK = results.filter(r => r.ok).length;
console.log(`\nИТОГ: ${nOK}/${results.length} ${nOK === results.length ? 'ALL OK' : 'ЕСТЬ ПРОВАЛЫ'}`);
process.exit(nOK === results.length ? 0 : 1);
