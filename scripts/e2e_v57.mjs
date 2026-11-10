// E2E Task 39: ТЕКСТУРЫ ПО ССЫЛКЕ (ВСЕ ПОВЕРХНОСТИ) + ЧЕЛОВЕЧКИ
// (ЛОКТИ/КОЛЕНИ/ПОПУГАЙ 10%) + ВЫСАДКА (1 ГРЕБЕЦ) + ЭКРАН КАПИТАНА.
//  (A) ЦЕНТРАЛЬНЫЙ КАТАЛОГ: __sea.tex — все 5 слотов
//      (terrain/hull/deck/sail/water) с состояниями
//  (B) ФИГУРКИ: probe(120) — попугаи ~10% (5..16%), вершин больше
//      (локти/колени/кисти/ремень/шея = детализация)
//  (C) ЭКРАН СОЗДАНИЯ КАПИТАНА: открывается В НАЧАЛЕ, тумблеры
//      (попугай/повязка/нога/крюк), «В море!» закрывает, uiOpen
//      отпускает ввод, выбор сохраняется (схема v12, раздел player)
//  (D) ВЫСАДКА: после схода на берег в шлюпке ОДИН гребец
//      (место игрока пусто), у игрока — выбранный попугай;
//      возврат в шлюпку — гребцов снова двое
//  (E) URL-ТЕКСТУРЫ: борт/палуба (map подменён), парус/вода
//      (uniform uTexOn), очистка — возврат процедурных (origMap),
//      битая ссылка — error + процедурная
//  (F) 0 ошибок JS + скриншоты (капитан, высадка с 1 гребцом)
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

// ============ C: ЭКРАН СОЗДАНИЯ КАПИТАНА (В НАЧАЛЕ) ============
log('\n===== C: экран создания капитана =====');
await sleep(2500);
const charUi = jparse(await evR(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (!scr) return JSON.stringify({ open: false });
  const txt = scr.innerText;
  const btns = [...scr.querySelectorAll('button')].map(b => b.textContent.trim());
  return JSON.stringify({
    open: true,
    uiOpen: window.__game.uiOpen,
    inSea: btns.includes('В море! ⚓'),
    random: btns.some(t => t.includes('Наугад')),
    parrot: txt.includes('Попугай на плече'),
    patch: txt.includes('Повязка на глаз'),
    peg: txt.includes('Деревянная нога'),
    hook: txt.includes('Крюк'),
    swatches: scr.querySelectorAll('button.rounded-full').length,
    canvas: !!scr.querySelector('canvas'),
  });
})()`));
log(JSON.stringify(charUi));
check('C1: экран капитана ОТКРЫТ В НАЧАЛЕ, ввод игры заблокирован',
  charUi && charUi.open === true && charUi.uiOpen === true, JSON.stringify(charUi));
check('C2: на экране есть превью-канвас, палитры и все приметы',
  charUi && charUi.canvas === true && charUi.swatches >= 15
    && charUi.parrot && charUi.patch && charUi.peg && charUi.hook
    && charUi.inSea && charUi.random, `палитр=${charUi?.swatches}`);
await sleep(1200);
run('screenshot /home/z/my-project/scripts/shots/t39_char_screen.png');

// включаем попугая и повязку (дефолт: попугай уже есть) и «В море!»
ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  const btns = [...scr.querySelectorAll('button')];
  const parrot = btns.find(b => b.textContent.includes('Попугай на плече'));
  if (parrot && !parrot.className.includes('border-amber-400')) parrot.click();
  return 'parrot-on';
})()`);
await sleep(400);
const applied = ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  const btn = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('В море!'));
  if (btn) { btn.click(); return 'clicked'; }
  return 'no-btn';
})()`);
await sleep(1200);
const afterApply = jparse(await evR(`(() => {
  const d = JSON.parse(localStorage.getItem('seawolves.settings.v1') || '{}');
  return JSON.stringify({
    closed: !document.querySelector('[data-char-screen]'),
    uiOpen: window.__game.uiOpen,
    v: d.v,
    parrot: d.player ? d.player.parrot : null,
    fig: window.__sea.playerFig,
  });
})()`));
log(JSON.stringify(afterApply));
check('C3: «В море!» закрывает экран, ввод отпущен, выбор сохранён (v12)',
  applied.includes('clicked') && afterApply && afterApply.closed === true
    && afterApply.uiOpen === false && afterApply.v === 12
    && afterApply.parrot === true, JSON.stringify(afterApply));
check('C4: фигурка капитана — с попугаем (выбор с экрана)',
  afterApply && afterApply.fig && afterApply.fig.parrot === true,
  JSON.stringify(afterApply?.fig));

ev(`window.__game.start()`);

// ============ A: ЦЕНТРАЛЬНЫЙ КАТАЛОГ ТЕКСТУР ============
log('\n===== A: центральный каталог текстур =====');
const slots = jparse(await evR(`JSON.stringify(window.__sea.tex)`));
log(JSON.stringify(slots));
const slotIds = ['terrain', 'hull', 'deck', 'sail', 'water'];
check('A1: каталог __sea.tex — все 5 слотов (земля/борт/палуба/парус/вода)',
  slots && slotIds.every(id => slots[id] && typeof slots[id].state === 'string'),
  JSON.stringify(slots));

// ============ B: ЧЕЛОВЕЧКИ — ДЕТАЛИ + ПОПУГАИ 10% ============
log('\n===== B: фигурки (локти/колени/попугай) =====');
const probe = jparse(await evR(`window.__game.debugFigureProbe(120)`));
log(JSON.stringify(probe));
check('B1: попугай встречается у ~10% фигур (5–16%)',
  probe && probe.parrotPct >= 5 && probe.parrotPct <= 16, `${probe?.parrotPct}% (${probe?.parrots}/${probe?.n})`);
check('B2: детализация выросла — локти/колени/кисти/ремень (нога ≥ 90 вершин: бедро+колено+голень+ботинок)',
  probe && probe.avgLegVerts >= 90 && probe.avgVerts >= 1200, `нога=${probe?.avgLegVerts}, тело=${probe?.avgVerts}, max=${probe?.maxVerts}`);
check('B3: деревянные ноги и крюки в толпе остались',
  probe && probe.pegs > 0 && probe.hooks > 0, `ног=${probe?.pegs}, крюков=${probe?.hooks}`);

// ============ D: ВЫСАДКА — В ЛОДКЕ ОСТАЁТСЯ ОДИН ГРЕБЕЦ ============
log('\n===== D: высадка (гребец в лодке) =====');
ev(`(() => { const g = window.__game; g.player.anchored = true; g.player.position.x -= 900; return 'ok'; })()`);
key('KeyB');
ev(`window.__game.stepDebugNR(8)`);
const boatA = jparse(await evR(`(() => { const bl = window.__game.boatLaunch; return JSON.stringify({ phase: window.__sea.boats.phase, rowers: bl.state().rowersVisibleCount }); })()`));
log(JSON.stringify(boatA));
check('D1: шлюпка спущена, гребцов ДВОЕ (до высадки)',
  boatA && boatA.phase === 'afloat' && boatA.rowers === 2, JSON.stringify(boatA));

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
  return 'rowed h=' + window.__heightAt(bl.pos.x, bl.pos.z).toFixed(2);
})()`);
const atShore = jparse(await evR(`(() => { const g = window.__game; return JSON.stringify({ near: g.boatLaunch.nearShore(), rowers: g.boatLaunch.state().rowersVisibleCount }); })()`));
log(JSON.stringify(atShore));
check('D2: подошли к берегу (можно высадиться)', atShore && atShore.near === true, JSON.stringify(atShore));

key('KeyE');
ev(`window.__game.stepDebugNR(0.4)`);
const landed = jparse(await evR(`(() => {
  const s = window.__sea;
  return JSON.stringify({
    active: s.land.active, h: s.land.h, frozen: s.land.frozenBoat,
    rowers: s.land.boatRowers, fig: s.playerFig,
  });
})()`));
log(JSON.stringify(landed));
check('D3: моряк ВЫСАДИЛСЯ — в шлюпке остался ОДИН гребец (место игрока пусто)',
  landed && landed.active === true && landed.frozen === true && landed.rowers === 1,
  `гребцов=${landed?.rowers} (было 2)`);
check('D4: на берегу — выбранный КАПИТАН (попугай с экрана создания)',
  landed && landed.fig && landed.fig.parrot === true, JSON.stringify(landed?.fig));
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t39_landing_1rower.png');

// возврат в шлюпку — гребцов снова двое
const back = jparse(await evR(`(() => {
  const g = window.__game, l = g.lander, bl = g.boatLaunch;
  l.debugTeleport(bl.pos.x, bl.pos.z);
  g.stepDebugNR(0.3);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyE'}));
  g.stepDebugNR(0.3);
  return { active: window.__sea.land.active, rowers: bl.state().rowersVisibleCount };
})()`));
log(JSON.stringify(back));
check('D5: возврат в шлюпку (E) — игрок на банке, гребцов СНОВА ДВОЕ',
  back && back.active === false && back.rowers === 2, JSON.stringify(back));

// поднять шлюпку, вернуться к кораблю
ev(`(() => {
  const g = window.__game, bl = g.boatLaunch;
  bl.pos.set(g.player.position.x, 0, g.player.position.z);
  bl.heading = g.player.heading; bl.vel = 0;
  g.stepDebugNR(0.2);
  window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyB'}));
  window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyB'}));
  g.stepDebugNR(30);
  return 'hoisted ' + window.__sea.boats.phase;
})()`);

// ============ E: URL-ТЕКСТУРЫ ВСЕХ ПОВЕРХНОСТЕЙ ============
log('\n===== E: свои текстуры по ссылке (борт/палуба/парус/вода) =====');
// E1: сгенерировать data:URL в странице (64×64 «доски»)
ev(`(() => {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#7a5230'; c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#5c3a20';
  for (let y = 0; y < 64; y += 8) c.fillRect(0, y, 64, 2);
  c.fillStyle = '#9a7248';
  for (let i = 0; i < 120; i++) c.fillRect(Math.random() * 64 | 0, Math.random() * 64 | 0, 2, 1);
  window.__testTexUrl = cv.toDataURL('image/png');
  return 'ok';
})()`);
await sleep(200);
const setTexUrls = (patch) => ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); Object.assign(s.assets.texUrls, ${JSON.stringify(patch)}); g.applySettings(s); return 'ok'; })()`);

// data:URL слишком длинный для eval-строки — присваиваем через окно
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.assets.texUrls.hull = window.__testTexUrl; s.assets.texUrls.deck = window.__testTexUrl; s.assets.texUrls.sail = window.__testTexUrl; s.assets.texUrls.water = window.__testTexUrl; g.applySettings(s); return 'applied-4'; })()`);
await sleep(2000);
const texOn = jparse(await evR(`(() => {
  const g = window.__game;
  const hull = g.player.visual.hullMat;
  const deck = g.player.visual.deckMat;
  const sail = g.player.visual.sails.sails[0];
  const water = g.water.material.uniforms;
  return JSON.stringify({
    tex: window.__sea.tex,
    hullMap: hull.map && hull.map.image ? hull.map.image.width : null,
    hullIsCustom: !!(hull.map && hull.map.image && hull.map.image.width === 64),
    hullOrig: !!hull.userData.origMap,
    deckMap: deck.map && deck.map.image ? deck.map.image.width : null,
    sailTexOn: sail ? sail.mat.uniforms.uTexOn.value : null,
    waterTexOn: water.uTexOn.value,
  });
})()`));
log(JSON.stringify(texOn));
check('E1: БОРТ — своя текстура загружена (map 64×64, исходная сохранена)',
  texOn && texOn.tex.hull.state === 'ok' && texOn.hullIsCustom === true && texOn.hullOrig === true,
  `state=${texOn?.tex?.hull?.state}, map=${texOn?.hullMap}`);
check('E2: ПАЛУБА — своя текстура загружена (map 64×64)',
  texOn && texOn.tex.deck.state === 'ok' && texOn.deckMap === 64, `state=${texOn?.tex?.deck?.state}`);
check('E3: ПАРУС — своя ткань включена (uniform uTexOn=1)',
  texOn && texOn.tex.sail.state === 'ok' && texOn.sailTexOn === 1, `state=${texOn?.tex?.sail?.state}`);
check('E4: ВОДА — своя текстура подмешана (uniform uTexOn=1)',
  texOn && texOn.tex.water.state === 'ok' && texOn.waterTexOn === 1, `state=${texOn?.tex?.water?.state}`);
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t39_url_textures.png');

// E5: очистка — процедурные возвращаются
setTexUrls({ hull: '', deck: '', sail: '', water: '' });
await sleep(1200);
const texOff = jparse(await evR(`(() => {
  const g = window.__game;
  const hull = g.player.visual.hullMat;
  const sail = g.player.visual.sails.sails[0];
  return JSON.stringify({
    tex: window.__sea.tex,
    hullRestored: hull.map === hull.userData.origMap,
    sailTexOn: sail ? sail.mat.uniforms.uTexOn.value : null,
    waterTexOn: g.water.material.uniforms.uTexOn.value,
  });
})()`));
log(JSON.stringify(texOff));
check('E5: очистка ссылок — процедурные текстуры ВЕРНУЛИСЬ (map=orig, uTexOn=0)',
  texOff && texOff.tex.hull.state === 'none' && texOff.hullRestored === true
    && texOff.sailTexOn === 0 && texOff.waterTexOn === 0, JSON.stringify(texOff?.tex));

// E6: битая ссылка борта — error, процедурная остаётся
setTexUrls({ hull: 'http://localhost:1/nope.png' });
await sleep(1500);
const texErr = jparse(await evR(`(() => {
  const g = window.__game;
  const hull = g.player.visual.hullMat;
  return JSON.stringify({
    state: window.__sea.tex.hull.state,
    hullRestored: hull.map === hull.userData.origMap,
  });
})()`));
log(JSON.stringify(texErr));
check('E6: битая ссылка борта — error, корпус с ПРОЦЕДУРНОЙ текстурой',
  texErr && texErr.state === 'error' && texErr.hullRestored === true, JSON.stringify(texErr));
setTexUrls({ hull: '' });

// ============ F: СХЕМА + ОШИБКИ JS ============
log('\n===== F: схема и ошибки =====');
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('F1: 0 ошибок JS', Array.isArray(errs) && errs.length === 0);

if (fails > 0) process.exit(1);
log(`\n===== ИТОГ e2e_v57: ${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} =====`);
