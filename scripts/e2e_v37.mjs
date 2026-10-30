// E2E Task 20 — по фидбеку игрока:
//  (A) PBR-текстуры: карты нормалей + шероховатости на дереве
//      (палуба/корпус/рангоут) и металле (орудия) — материалы
//      проверяются напрямую + шарятся между кораблями, UV есть
//  (B) ядра ПРОБИВАЮТ изрешечённый корпус насквозь: выходная
//      пробоина с другой стороны, ядро летит дальше и исчезает
//      в воде; свежий борт — ядро застревает (без пробития)
//  (C) задний ход гребных: ПРОСТОЕ S (как у парусных) гребёт
//      назад вёслами; Alt+S работает; при поднятых парусах S
//      сначала убирает паруса
//  (D) скриншоты для VLM (рельеф обшивки/палубы/металл орудий)
//  (E) страница жива: без ошибок, FPS
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

run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// ============ A: PBR-текстуры на материалах ============
log('=== A: PBR-материалы корабля ===');
const pbrA = jparse(ev(`(() => {
  const g = window.__game;
  const p = g.player;
  const v = p.visual;
  // корпус: первый меш с DoubleSide + vertexColors; палуба: diffuse map
  let hull = null, deck = null;
  v.group.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.normalMap) return;
    if (o.material.map && !deck) deck = o;
    else if (o.material.side === 2 && !hull) hull = o; // THREE.DoubleSide === 2
  });
  const pole = v.masts[0] ? v.masts[0].children[0] : null;
  const gun = v.gunsPort[0] ? v.gunsPort[0].children[0] : null;
  // мишень полигона: её материалы должны ШАРИТЬ те же текстуры
  g.startProving('frigate');
  const t = g.pgTarget.ship;
  let tHull = null;
  t.visual.group.traverse(o => {
    if (!tHull && o.isMesh && o.material && o.material.side === 2 && o.material.normalMap) tHull = o;
  });
  const uvInfo = (geo) => {
    if (!geo || !geo.attributes.uv) return null;
    const a = geo.attributes.uv.array;
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < a.length; i++) { mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); }
    return { n: geo.attributes.uv.count, span: +(mx - mn).toFixed(2) };
  };
  return JSON.stringify({
    hull: hull ? {
      n: !!hull.material.normalMap, r: !!hull.material.roughnessMap,
      w: hull.material.normalMap.image.width,
      scale: hull.material.normalScale.x,
      uv: uvInfo(hull.geometry),
    } : null,
    deck: deck ? {
      n: !!deck.material.normalMap, r: !!deck.material.roughnessMap,
      diffuse: !!deck.material.map,
      w: deck.material.normalMap.image.width,
    } : null,
    spar: pole ? { n: !!pole.material.normalMap, r: !!pole.material.roughnessMap } : null,
    gun: gun ? { n: !!gun.material.normalMap, r: !!gun.material.roughnessMap, metal: gun.material.metalness } : null,
    sharedHull: !!(hull && tHull && hull.material.normalMap === tHull.material.normalMap),
    sharedGun: !!(gun && t.visual.gunsPort[0] && gun.material.normalMap === t.visual.gunsPort[0].children[0].material.normalMap),
    turretHullUv: tHull ? uvInfo(tHull.geometry) : null,
  });
})()`));
log('A:', JSON.stringify(pbrA));
if (!pbrA || !pbrA.hull) {
  check('A: материалы найдены', false, JSON.stringify(pbrA).slice(0, 200));
} else {
  check('A: корпус — normalMap + roughnessMap', pbrA.hull.n && pbrA.hull.r);
  check('A: корпус — карта нормалей 512×512', pbrA.hull.w === 512, `w=${pbrA.hull.w}`);
  check('A: корпус — UV есть и распределены (span>3)', pbrA.hull.uv && pbrA.hull.uv.span > 3,
    JSON.stringify(pbrA.hull.uv));
  check('A: палуба — диффуз + нормали + шероховатость',
    pbrA.deck && pbrA.deck.n && pbrA.deck.r && pbrA.deck.diffuse);
  check('A: рангоут (мачта) — нормали + шероховатость', pbrA.spar && pbrA.spar.n && pbrA.spar.r);
  check('A: орудие — металлические нормали + шероховатость',
    pbrA.gun && pbrA.gun.n && pbrA.gun.r && pbrA.gun.metal >= 0.75,
    pbrA.gun ? `metal=${pbrA.gun.metal}` : 'нет');
  check('A: текстуры ШАРЯТСЯ между кораблями (кэш)', pbrA.sharedHull === true);
  check('A: у мишени тоже UV на корпусе', pbrA.turretHullUv && pbrA.turretHullUv.span > 3,
    JSON.stringify(pbrA.turretHullUv));
}

// ============ B: пробитие корпуса насквозь ============
log('=== B: ядра пробивают изрешечённый корпус ===');
const shotB = jparse(ev(`(() => {
  const g = window.__game;
  const t = g.pgTarget.ship;
  g.combat.aim.active = false;
  const shoot = (hullFrac) => {
    t.clearDamage();
    t.hullHP = t.hullMax * hullFrac;
    const holes0 = t.hullHoles.length;
    const hp0 = t.hullHP;
    // снаряд вручную: 24 м до мишени, горизонтально в борт (мишень
    // broadside, направление = от игрока к мишени)
    const pr = g.combat.projectiles.find(q => !q.active);
    pr.active = true;
    pr.type = 'ball';
    pr.shooter = g.player;
    pr.age = 0; pr.trailT = 0; pr.spin = 0;
    pr.pierced = new Map(); pr.hullPierce = null;
    const dir = t.position.clone().sub(g.player.position);
    dir.y = 0; dir.normalize();
    pr.pos.copy(t.position).addScaledVector(dir, -24);
    pr.pos.y = t.position.y + 1.4;
    pr.prev.copy(pr.pos);
    pr.vel.copy(dir).multiplyScalar(175);
    // трассировка: 600 шагов по 1/60 (10 с максимум)
    let hitFrame = -1, activeAtHit = null, beyond = false, exited = false;
    let endActive = null, endWhy = '';
    const zBeyond = t.position.clone().addScaledVector(dir, t.preset.beam + 2);
    const t0 = g.time;
    for (let i = 0; i < 600; i++) {
      const time = t0 + i / 60;
      g.combat.update(1 / 60, time, () => 0, null, null, null);
      if (hitFrame < 0 && t.hullHP < hp0 - 1) { hitFrame = i; activeAtHit = pr.active; }
      if (hitFrame >= 0 && pr.active) {
        if (pr.pos.distanceTo(zBeyond) < 60 && pr.pos.dot(dir) > zBeyond.dot(dir)) beyond = true;
      }
      if (!pr.active) { endActive = false; endWhy = pr.pos.y < 0.5 ? 'water' : 'stop'; break; }
      if (i === 599) { endActive = true; endWhy = 'timeout'; }
    }
    return {
      hullFrac, hitFrame, activeAtHit, beyond, endActive, endWhy,
      holes: t.hullHoles.length - holes0,
      dmg: +(hp0 - t.hullHP).toFixed(1),
      hpFrac: +(t.hullHP / t.hullMax).toFixed(3),
      posAfter: endActive ? null : +pr.pos.y.toFixed(2),
    };
  };
  const fresh = shoot(1.0);    // свежий борт: ядро застревает
  const wrecked = shoot(0.4);  // изрешечённый: пробитие насквозь
  g.combat.aim.active = false;
  return JSON.stringify({ fresh, wrecked, maxHP: t.hullMax });
})()`));
log('B:', JSON.stringify(shotB));
if (!shotB || !shotB.fresh) {
  check('B: трассировка получена', false, JSON.stringify(shotB).slice(0, 200));
} else {
  const f = shotB.fresh, w = shotB.wrecked;
  check('B: свежий борт — попадание зафиксировано', f.hitFrame >= 0, `frame=${f.hitFrame}`);
  check('B: свежий борт — ядро ЗАСТРЯЛО (исчезло в корпусе)', f.activeAtHit === false && f.endActive === false,
    `activeAtHit=${f.activeAtHit} end=${f.endWhy}`);
  check('B: свежий борт — 1 пробоина (вход)', f.holes === 1, `holes=${f.holes}`);
  check('B: изрешечённый — ядро ПРОБИЛО насквозь (живо после входа)',
    w.activeAtHit === true, `activeAtHit=${w.activeAtHit}`);
  check('B: изрешечённый — пролетело СКВОЗЬ (за бортом мишени)', w.beyond === true);
  check('B: изрешечённый — 2 пробоины (вход + выход)', w.holes === 2, `holes=${w.holes}`);
  check('B: изрешечённый — урон и входа, и выхода (больше одиночного)',
    w.dmg > 15 && w.dmg < 45, `dmg=${w.dmg}`);
  check('B: после пробития ядро ИСЧЕЗЛО (не висит вечно)', w.endActive === false,
    `end=${w.endWhy}`);
}

// ============ C: задний ход гребных кораблей ============
log('=== C: задний ход на вёслах (просто S) ===');
const revC = jparse(ev(`(() => {
  const g = window.__game;
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0); p.oarsOut = false; p.rowing = 0; p.oarsIdleT = 0;
  p.crew = p.preset.maxCrew;
  const start = p.position.clone();
  const fwd = p.forward.clone();
  // 1) ПРОСТОЕ S без Alt: input-путь
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  g.handleInput(1 / 60);
  const plainS = { rowing: p.rowing, oarsOut: p.oarsOut };
  // 2) при ПОДНЯТЫХ парусах S сначала убирает паруса, не гребёт
  p.sailTarget = 2;
  g.handleInput(1 / 60);
  const sailsUp = { rowing: p.rowing, sailTarget: p.sailTarget };
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
  g.input.endFrame();
  // 3) Alt+S — прежний путь тоже жив
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'AltLeft' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  g.handleInput(1 / 60);
  const altS = { rowing: p.rowing };
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'AltLeft' }));
  g.input.endFrame();
  g.handleInput(1 / 60); // клавиши отпущены — но rowing гасится только на след. тике
  // 4) физика заднего хода: гребём назад 25 с — УСТОЙЧИВО (раньше
  //    попятное движение разгонялось «сопротивлением» до 20+ уз и NaN)
  p.sailTarget = 0; p.rowing = -1; p.oarsOut = true; p.oarsIdleT = 0;
  p.velocity.set(0, 0, 0);
  let time = g.time;
  let maxKn = 0, nan = false;
  for (let i = 0; i < 1500; i++) {
    time += 1 / 60;
    p.fixedStep(1 / 60, time);
    p.updateVisual(time, 1 / 60, g.particles);
    if (!isFinite(p.position.x) || !isFinite(p.speedKnots())) { nan = true; break; }
    maxKn = Math.max(maxKn, p.speedKnots());
  }
  const disp = p.position.clone().sub(start);
  const along = +(disp.dot(fwd)).toFixed(2);
  return JSON.stringify({
    plainS, sailsUp, altS,
    back: { along, knots: +p.speedKnots().toFixed(2), deploy: +p.oarsDeployT.toFixed(2), maxKn: +maxKn.toFixed(2), nan },
  });
})()`));
log('C:', JSON.stringify(revC));
if (!revC || !revC.plainS) {
  check('C: данные получены', false, JSON.stringify(revC).slice(0, 200));
} else {
  check('C: ПРОСТОЕ S гребёт назад (rowing=-1)', revC.plainS.rowing === -1, `rowing=${revC.plainS.rowing}`);
  check('C: вёсла вываливаются сами', revC.plainS.oarsOut === true);
  check('C: при поднятых парусах S их убирает (не гребёт)',
    revC.sailsUp.rowing === 0 && revC.sailsUp.sailTarget < 2,
    `rowing=${revC.sailsUp.rowing} sails=${revC.sailsUp.sailTarget}`);
  check('C: Alt+S по-прежнему гребёт назад', revC.altS.rowing === -1, `rowing=${revC.altS.rowing}`);
  check('C: галера ФИЗИЧЕСКИ идёт назад (> 3 м за 25 с)', revC.back.along < -3,
    `along=${revC.back.along} м`);
  check('C: скорость заднего хода заметная (> 0.5 уз)', revC.back.knots > 0.5, `v=${revC.back.knots} уз`);
  check('C: задний ход УСТОЙЧИВ (без разгона и NaN: max < 6 уз)',
    !revC.back.nan && revC.back.maxKn < 6, `max=${revC.back.maxKn} уз nan=${revC.back.nan}`);
  check('C: вёсла вывалены (deploy>0.9)', revC.back.deploy > 0.9, `deploy=${revC.back.deploy}`);
}

// ============ D: скриншоты для VLM ============
log('=== D: скриншоты PBR + галера ===');
// D1: борт фрегата крупно — рельеф обшивки
ev(`(() => {
  const g = window.__game;
  g.changeShip('frigate', true);
  const p = g.player;
  p.anchored = true; p.sailTarget = 0; p.rowing = 0; p.velocity.set(0, 0, 0);
  g.setCameraMode('free');
  // курс восток → правый борт на +Z; камера стоит НА азимуте az от корабля
  // (x=cos az, z=sin az): az=π/2 → камера на +Z, смотрит на правый борт
  g.rig.freeAzimSet(Math.PI / 2);
  g.rig.freeElevSet(0.10);
  g.rig.distSet(16);
  g.rig.snap();
  return 'hull cam';
})()`);
await sleep(2600);
shot('v37_hull_pbr');
await sleep(400);
// D2: палуба сверху-сбоку — доски и стыки
ev(`(() => {
  const g = window.__game;
  g.rig.freeElevSet(0.75);
  g.rig.distSet(15);
  g.rig.snap();
  return 'deck cam';
})()`);
await sleep(2200);
shot('v37_deck_pbr');
await sleep(400);
// D3: орудия на палубе — металл стволов
ev(`(() => {
  const g = window.__game;
  g.rig.freeElevSet(0.35);
  g.rig.distSet(14);
  g.rig.snap();
  return 'gun cam';
})()`);
await sleep(2200);
shot('v37_gun_metal');
await sleep(400);
// D4: галера гребёт НАЗАД — вёсла на воде, кильватер от носа
ev(`(() => {
  const g = window.__game;
  g.changeShip('galley', true);
  const p = g.player;
  p.anchored = false; p.sailTarget = 0; p.sailFrac = 0;
  p.velocity.set(0, 0, 0);
  p.oarsOut = true; p.rowing = -1; p.oarsIdleT = 0;
  let time = g.time;
  for (let i = 0; i < 420; i++) {
    time += 1 / 60;
    p.fixedStep(1 / 60, time);
    p.updateVisual(time, 1 / 60, g.particles);
  }
  // держим S зажатой: RAF-цикл продолжает греблю назад на скриншоте
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
  g.setCameraMode('free');
  g.rig.freeAzimSet(Math.PI / 2);
  g.rig.freeElevSet(0.18);
  g.rig.distSet(26);
  g.rig.snap();
  return 'galley rev ' + p.speedKnots().toFixed(1) + ' уз';
})()`);
await sleep(2600);
shot('v37_galley_reverse');
ev(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }))`);

// ============ E: страница жива ============
await sleep(1200);
const errs = (() => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
})();
check('E: страница без ошибок', !errs, errs.slice(0, 200));
const fpsE = jparse(ev(`(() => { return window.__sea ? JSON.stringify({ fps: +window.__sea.fps.toFixed(1) }) : '{}'; })()`));
check('E: FPS живой (> 4, headless SwiftShader + PBR)', fpsE.fps > 4, `fps=${fpsE.fps}`);
log(fails === 0 ? '\nALL OK' : `\nFAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
