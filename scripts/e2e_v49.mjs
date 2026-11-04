// E2E Task 31 («Для всех видов морей вынеси настройки плавания лодки,
// глубину погружения, углы наклона и т.п. Для лодки тоже. Добавь еще одну»):
//  (A) ПАНЕЛЬ: раздел «Плавание и посадка (все модели моря)» виден при
//      ЛЮБОЙ модели (проверяем на физической); storm-блок «Посадка»
//      только на штормовой; слайдеры новые присутствуют
//  (B) ФИЗИЧЕСКАЯ модель, ОСАДКА ±: перекалибровка колонн — корабль
//      сидит на заданную величину глубже/мельче, РОВНЫЙ КИЛЬ сохраняется,
//      возврат к 0 = проектная осадка
//  (C) «ВОЛНА-ОПОРА», ОСАДКА ±: сдвиг посадки пружины
//  (D) «ШТОРМОВОЙ МОДУЛЬ», ОСАДКА ±: сдвиг посадки поверх immersion
//  (E) УГЛЫ НАКЛОНА: крен ОТ ВЕТРА (изолированная составляющая rideHeel)
//      в «волне-опоре» ограничен настройкой «Макс. крен»
//  (F) ШЛЮПКА ×2: ялы на ОБЕИХ шлюпбалках (штирборт + порт, зеркально),
//      B спускает штирборт; подъём; «разбитая» шлюпка — B спускает
//      ПОРТОВУЮ запасную; разбитие на воде → подбор на борт
//  (G) ОСАДКА ШЛЮПКИ ×: state().draft следует множителю (физ/волновая)
//  (H) НАСТРОЙКИ ПЛОВАНИЯ сохраняются в localStorage и живут после
//      перезагрузки (схема v5)
//  (I) ОСТРОВА НЕПРАВИЛЬНОЙ ФОРМЫ (ограничение от игрока, Task 30):
//      все ratio ≥ 1.5 — не «круги»
//  (J) 0 ошибок JS
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
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
const key = (code, type = 'keydown') =>
  ev(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' })); 'ok'`);
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);
const shot = (name) => run(`screenshot scripts/shots/${name} --full`);

run('close --all');
run('open http://localhost:3000/?t=' + Date.now());
await sleep(1500);
run('viewport 800 450');
await sleep(400);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = 0; window.addEventListener('error', e => window.__jsErrors++); 'ok'`);
log('старт:', clickBtn('Поднять флаг'));
await sleep(2500);

// штиль + якорь: детерминированная посадка для замеров осадки
ev(`(() => { const g = window.__game; g.debugSetWind(0); g.player.anchored = true; g.player.sailTarget = 0; return 'ok'; })()`);
await sleep(400);

// замер посадки: прогрев 30 с + среднее 60 с (в штиле у физ. модели
// есть слабодемпфированный медленный режим ~8 с — усредняем много периодов)
const settleMeasure = () => jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  let t = g.time;
  for (let i = 0; i < 1800; i++) { t += 1 / 60; p.fixedStep(1 / 60, t); }
  let sumY = 0, sumT = 0, n = 0, maxAbsTrim = 0, maxAbsRoll = 0;
  for (let i = 0; i < 3600; i++) {
    t += 1 / 60; p.fixedStep(1 / 60, t);
    sumY += p.position.y; sumT += p.euler.x; n++;
    maxAbsTrim = Math.max(maxAbsTrim, Math.abs(p.euler.x));
    maxAbsRoll = Math.max(maxAbsRoll, Math.abs(p.euler.z));
  }
  return JSON.stringify({ avgY: +(sumY / n).toFixed(3), avgTrim: +(sumT / n).toFixed(4), maxAbsTrim: +maxAbsTrim.toFixed(3), maxAbsRoll: +maxAbsRoll.toFixed(3) });
})()`));
const setFloat = (patch) => ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  Object.assign(s.buoyancy, ${JSON.stringify(patch)});
  g.applySettings(s);
  return 'ok';
})()`);
const setSeaModel = (m) => ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.weather.seaModel = '${m}';
  g.applySettings(s);
  return 'ok';
})()`);

// ============ A: панель — «Плавание и посадка» при ЛЮБОЙ модели ============
log('=== A: раздел «Плавание и посадка (все модели моря)» в панели ===');
clickBtn('Настройки');
await sleep(700);
const uiA = jparse(ev(`(() => {
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Погода');
  if (tab) tab.click();
  return new Promise(res => setTimeout(() => {
    const rows = [...document.querySelectorAll('label, span, div')].map(e => e.textContent).join('\\n');
    const hdr = (t) => [...document.querySelectorAll('div')].some(d => d.textContent.trim() === t);
    res(JSON.stringify({
      hasFloatSection: hdr('Плавание и посадка (все модели моря)'),
      hasDraft: rows.includes('Осадка: глубже / мельче'),
      hasBoatDraft: rows.includes('Осадка шлюпки'),
      hasHeel: rows.includes('Макс. крен'),
      hasPitch: rows.includes('Макс. дифферент'),
      hasBoatSmooth: rows.includes('Плавность посадки шлюпки'),
      hasStormDraft: hdr('Штормовой модуль: посадка (shipPhysics.js)'),
    }));
  }, 400));
})()`));
log('A UI (physical):', JSON.stringify(uiA));
check('A: раздел «Плавание и посадка» есть при ФИЗИЧЕСКОЙ модели',
  uiA.hasFloatSection === true);
check('A: слайдеры осадки/углов/шлюпки в разделе',
  uiA.hasDraft && uiA.hasBoatDraft && uiA.hasHeel && uiA.hasPitch && uiA.hasBoatSmooth,
  JSON.stringify(uiA));
check('A: storm-блок «Посадка» СКРЫТ на физической модели',
  uiA.hasStormDraft === false);
// ЗАКРЫТЬ панель («Готово») — иначе uiOpen блокирует управление (урок v47)
clickBtn('Готово');
await sleep(600);
check('A: панель закрыта, управление активно',
  jparse(ev(`window.__game.uiOpen === false`)) === true);

// ============ B: физическая модель — осадка ± (перекалибровка) ============
log('=== B: ФИЗИЧЕСКАЯ модель — «осадка ±» перекалибровкой колонн ===');
const b0 = settleMeasure();
log('B базовая посадка (draftOffset=0, штиль):', JSON.stringify(b0));
check('B: при 0 — посадка у проектной (|avgY| ≤ 0.12), ровный киль (|ср. дифферент| ≤ 0.7°)',
  Math.abs(b0.avgY) <= 0.12 && Math.abs(b0.avgTrim) < 0.012,
  `avgY=${b0.avgY}, avgTrim=${(b0.avgTrim * 180 / Math.PI).toFixed(2)}° (размах ±${(b0.maxAbsTrim * 180 / Math.PI).toFixed(1)}°)`);

setFloat({ draftOffset: 0.5 });
await sleep(300);
const bDeep = settleMeasure();
log('B +0.5 м глубже:', JSON.stringify(bDeep));
check('B: +0.5 — корабль сидит на 0.5 м глубже (Δ ≈ −0.5 ± 0.15)',
  b0.avgY - bDeep.avgY > 0.35 && b0.avgY - bDeep.avgY < 0.65,
  `Δ=${(b0.avgY - bDeep.avgY).toFixed(3)}`);
check('B: +0.5 — киль НЕ хуже базового (ср. дифферент ±0.7°)',
  Math.abs(bDeep.avgTrim) < 0.012, `avgTrim=${(bDeep.avgTrim * 180 / Math.PI).toFixed(2)}°`);

setFloat({ draftOffset: -0.5 });
await sleep(300);
const bShallow = settleMeasure();
log('B −0.5 м мельче:', JSON.stringify(bShallow));
check('B: −0.5 — корабль сидит на 0.5 м выше (Δ ≈ +0.5 ± 0.15)',
  bShallow.avgY - b0.avgY > 0.35 && bShallow.avgY - b0.avgY < 0.65,
  `Δ=${(bShallow.avgY - b0.avgY).toFixed(3)}`);

setFloat({ draftOffset: 0 });
await sleep(300);
const bBack = settleMeasure();
check('B: возврат к 0 — посадка снова проектная',
  Math.abs(bBack.avgY - b0.avgY) < 0.08, `Δ=${(bBack.avgY - b0.avgY).toFixed(3)}`);

setFloat({ draftOffset: 0.5 });
const bOff = jparse(ev(`window.__sea.float.draftOffApplied`));
setFloat({ draftOffset: 0 });
check('B: телеметрия draftOff следует настройке', bOff === 0.5, `applied=${bOff}`);

// ============ C: «волна-опора» — осадка ± ============
log('=== C: ВОЛНА-ОПОРА — осадка ± (сдвиг цели пружины) ===');
setSeaModel('riding');
await sleep(600);
const c0 = settleMeasure();
log('C базовая (riding):', JSON.stringify(c0));
setFloat({ draftOffset: 0.6 });
await sleep(300);
const cDeep = settleMeasure();
log('C +0.6 м глубже (riding):', JSON.stringify(cDeep));
check('C: +0.6 в «волне-опоре» — сидит глубже (Δ ≈ −0.6 ± 0.18)',
  c0.avgY - cDeep.avgY > 0.42 && c0.avgY - cDeep.avgY < 0.78,
  `Δ=${(c0.avgY - cDeep.avgY).toFixed(3)}`);
setFloat({ draftOffset: 0 });
await sleep(200);

// ============ D: штормовой модуль — осадка ± ============
log('=== D: ШТОРМОВОЙ МОДУЛЬ — осадка ± (поверх immersion) ===');
setSeaModel('storm');
await sleep(2500);
const d0 = settleMeasure();
log('D базовая (storm):', JSON.stringify(d0));
setFloat({ draftOffset: 0.6 });
await sleep(300);
const dDeep = settleMeasure();
log('D +0.6 м глубже (storm):', JSON.stringify(dDeep));
check('D: +0.6 в шторме — сидит глубже (Δ ≈ −0.6 ± 0.18)',
  d0.avgY - dDeep.avgY > 0.42 && d0.avgY - dDeep.avgY < 0.78,
  `Δ=${(d0.avgY - dDeep.avgY).toFixed(3)}`);
setFloat({ draftOffset: 0 });
await sleep(200);

// ============ E: углы наклона — крен ОТ ВЕТРА (изолированный) ============
log('=== E: «Макс. крен» — кромка крена от ветра (волна-опора) ===');
setSeaModel('riding');
await sleep(500);
// ветер ПРИМЕРНО ПОД БОРТ: боковая составляющая ветра максимальна,
// когда «откуда» = −курс (или курс+180°) — cos(from+heading)=±1
// (выкладка: star=(cos h,0,−sin h); lateral=−V·cos(from+h))
ev(`(() => {
  const g = window.__game, p = g.player;
  const h = p.heading;
  const from1 = Math.round(((-h) * 180 / Math.PI) % 360 + 360) % 360;
  g.debugSetWeather('clear', 24, from1);
  // погода разгоняет ветер в СВОЁМ темпе (порывы) — для замера ставим
  // силу сразу: боковая составляющая нужна НА месте (выкладка:
  // star=(cos h,0,−sin h); lateral=−V·cos(from+heading) → max при from=−h)
  g.wind.speed = 24;
  p.anchored = true; p.sailTarget = 3;
  const w = p.wind;
  const star = [Math.cos(h), 0, -Math.sin(h)];
  const travel = [-w.speed * Math.cos(w.from), 0, -w.speed * Math.sin(w.from)];
  const lat = travel[0] * star[0] + travel[2] * star[2];
  return JSON.stringify({ from1, headingDeg: +(h * 180 / Math.PI).toFixed(0), lateral: +lat.toFixed(1) });
})()`);
log('E ветер:', await (async () => jparse(ev(`JSON.stringify({ws:+window.__game.wind.speed.toFixed(1), fromDeg:+(window.__game.wind.from*180/Math.PI).toFixed(0), h:+(window.__game.player.heading*180/Math.PI).toFixed(0)})`)))());
// креновая составляющая (p.rideHeel) отдельно от наклона по склону волны
const heelStat = () => jparse(ev(`(() => {
  const g = window.__game, p = g.player;
  let t = g.time;
  // ветер на месте: fixedStep не гонит погоду — поддерживаем силу
  g.wind.speed = 24;
  for (let i = 0; i < 240; i++) { t += 1 / 60; p.fixedStep(1 / 60, t); }
  let maxHeel = 0;
  for (let i = 0; i < 480; i++) {
    t += 1 / 60; p.fixedStep(1 / 60, t);
    maxHeel = Math.max(maxHeel, Math.abs(p.rideHeel));
  }
  return JSON.stringify({ maxHeelDeg: +(maxHeel * 180 / Math.PI).toFixed(1) });
})()`));
const eDef = heelStat();
log('E дефолт (крен 20.6°):', JSON.stringify(eDef));
check('E: при дефолте 20.6° крен от ветра 24 м/с под бортом заметен (> 9°)',
  eDef.maxHeelDeg > 9, `max=${eDef.maxHeelDeg}°`);
setFloat({ heelMaxDeg: 8 });
await sleep(300);
const e8 = heelStat();
log('E крен с лимитом 8°:', JSON.stringify(e8));
check('E: лимит 8° держит креновую составляющую (≤ 9°)',
  e8.maxHeelDeg <= 9, `max=${e8.maxHeelDeg}°`);
check('E: лимит УМЕНЬШИЛ крен против дефолта', e8.maxHeelDeg < eDef.maxHeelDeg,
  `${e8.maxHeelDeg}° < ${eDef.maxHeelDeg}°`);
setFloat({ heelMaxDeg: 20.6 });
ev(`(() => { const g = window.__game; g.debugSetWind(0); g.player.sailTarget = 0; return 'ok'; })()`);
await sleep(300);

// ============ F: ДВЕ шлюпки — штирборт + порт ============
log('=== F: «Добавь еще одну» — ялы на обоих бортах ===');
// физическая модель (по умолчанию), лёгкий ветер для жизни воды
setSeaModel('physical');
ev(`(() => { const g = window.__game; g.debugSetWind(3); return 'ok'; })()`);
await sleep(600);
// быстрый прогон фаз шлюпки: публичный boatLaunch.update(dt, t)
const ffBoat = (sec) => ev(`(() => {
  const g = window.__game, bl = g.boatLaunch;
  let t = g.time;
  const n = Math.ceil(${sec} / 0.033);
  for (let i = 0; i < n; i++) { t += 0.033; bl.update(0.033, t); }
  return 'ok';
})()`);

const f0 = jparse(ev(`JSON.stringify(window.__sea.boats)`));
log('F старт:', JSON.stringify(f0));
check('F: на судне ДВЕ шлюпки', f0.ok && f0.count === 2, `count=${f0.count}`);
check('F: штирборт x>0, порт x<0 (зеркальные шлюпбалки)',
  f0.stb && f0.port && f0.stb.x > 0 && f0.port.x < 0,
  `stb.x=${f0.stb && f0.stb.x}, port.x=${f0.port && f0.port.x}`);
check('F: обе целы и убраны (stowed)', f0.stb.visible && f0.port.visible && f0.phase === 'stowed');
shot('t31_two_boats_stowed');

// B: спуск штирбортной
key('KeyB');
await sleep(600);   // хотя бы один кадр игры на нажатие
ffBoat(9);          // спуск 7 с + запас
const fFloat = jparse(ev(`JSON.stringify(window.__sea.boats)`));
const fState = jparse(ev(`JSON.stringify(window.__game.boatLaunch.state())`));
log('F на воде:', JSON.stringify(fFloat), fState && `draft=${fState.draft}`);
check('F: B запускает ПЕРВУЮ целую — штирборт (active=stb)',
  fFloat.active === 'stb' && fFloat.phase === 'afloat',
  `active=${fFloat.active}, phase=${fFloat.phase}`);
check('F: порт ждёт на шлюпбалках, пока штирбортная на воде',
  fFloat.port.visible === true);
check('F: state().boats/side для HUD', fState.boats === 2 && fState.side === 'stb',
  `boats=${fState.boats}, side=${fState.side}`);
shot('t31_boat_stb_afloat');

// подъём штирбортной (лодка у самого борта — dist<15, ход 0)
key('KeyB');
await sleep(600);
const fRaising = jparse(ev(`JSON.stringify(window.__sea.boats)`));
check('F: B у борта — начат подъём (raising)', fRaising.phase === 'raising', fRaising.phase);
ffBoat(11);   // подтяжка 2.8 с + выборка 7 с + запас
const fStowed = jparse(ev(`JSON.stringify(window.__sea.boats)`));
check('F: после подъёма активного нет (null), обе убраны',
  fStowed.active === null && fStowed.phase === 'stowed', `active=${fStowed.active}`);

// «разбить» штирбортную (на шлюпбалках) — B должен взять ПОРТОВУЮ
ev(`(() => { const g = window.__game; g.player.visual.boat.group.visible = false; return 'ok'; })()`);
key('KeyB');
await sleep(600);
ffBoat(9);
const fPort = jparse(ev(`JSON.stringify(window.__sea.boats)`));
log('F запасная:', JSON.stringify(fPort));
check('F: разбитая штирбортная пропущена — спущена ПОРТОВАЯ',
  fPort.active === 'port' && fPort.phase === 'afloat',
  `active=${fPort.active}, phase=${fPort.phase}`);
shot('t31_boat_port_afloat');

// разбить ПОРТОВУЮ прямо НА ВОДЕ → игрок подобран, фаза stowed
ev(`(() => { const g = window.__game; g.player.visual.boat2.group.visible = false; return 'ok'; })()`);
ffBoat(0.2);
const fAbort = jparse(ev(`JSON.stringify(window.__sea.boats)`));
check('F: разбитие на воде — шлюпка подобрана (stowed, active=null)',
  fAbort.phase === 'stowed' && fAbort.active === null, `phase=${fAbort.phase}`);
// обе «разбиты» → tryLaunch отказывает
const bothBroken = jparse(ev(`window.__game.boatLaunch.tryLaunch(false)`));
check('F: обе разбиты — вразумительный отказ',
  typeof bothBroken === 'string' && bothBroken.includes('разбиты'), String(bothBroken));
// восстановить и спустить снова (сначала штирборт — порядок выбора)
ev(`(() => { const g = window.__game;
  g.player.visual.boat.group.visible = true;
  g.player.visual.boat2.group.visible = true; return 'ok'; })()`);
key('KeyB');
await sleep(600);
ffBoat(9);
const fAgain = jparse(ev(`JSON.stringify(window.__sea.boats)`));
check('F: восстановление — снова спускается штирборт (первая целая)',
  fAgain.active === 'stb' && fAgain.phase === 'afloat', `active=${fAgain.active}`);
// поднять обратно
key('KeyB');
await sleep(600);
ffBoat(11);
const fDone = jparse(ev(`JSON.stringify(window.__sea.boats)`));
check('F: подъём — обе убраны, активного нет',
  fDone.phase === 'stowed' && fDone.active === null);

// ============ G: осадка шлюпки × (boatDraftMul) ============
log('=== G: «Осадка шлюпки» × — множитель посадки яла ===');
// спустить штирбортный ял (draft читается только на воде)
key('KeyB');
await sleep(600);
ffBoat(9);
const g1 = jparse(ev(`JSON.stringify(window.__game.boatLaunch.state())`));
log('G draft ×1:', g1 && g1.draft);
setFloat({ boatDraftMul: 2 });
await sleep(400);
const g2 = jparse(ev(`JSON.stringify(window.__game.boatLaunch.state())`));
log('G draft ×2:', g2 && g2.draft);
check('G: осадка шлюпки следует множителю (×2 → вдвое глубже)',
  g1.draft > 0.001 && g2.draft > g1.draft * 1.85 && g2.draft < g1.draft * 2.15,
  `${g1.draft} → ${g2.draft}`);
setFloat({ boatDraftMul: 1 });
await sleep(300);
// поднять шлюпку (не оставлять на воде)
key('KeyB');
await sleep(600);
ffBoat(11);

// ============ H: сохранение настроек (localStorage, схема v5) ============
log('=== H: настройки плавания сохраняются после перезагрузки ===');
clickBtn('Настройки');
await sleep(700);
const hSet = jparse(ev(`(() => {
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Погода');
  if (tab) tab.click();
  return new Promise(res => setTimeout(() => {
    const setVal = (el, v) => {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : null;
      if (!proto) return false;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const sec = [...document.querySelectorAll('.py-2')].find(s => s.textContent.includes('Плавание и посадка'));
    if (!sec) { res(JSON.stringify({ ok: false })); return; }
    const ranges = [...sec.querySelectorAll('input[type=range]')];
    const out = { ok: true, n: ranges.length };
    out.r0 = setVal(ranges[0], 0.55);                     // осадка +
    out.r1 = setVal(ranges[1], 2.4);                      // шлюпка ×2.4
    out.r2 = setVal(ranges[2], 31.5);                     // крен 31.5°
    out.r3 = setVal(ranges[3], 33);                       // дифферент 33°
    out.rLast = setVal(ranges[ranges.length - 1], 21);    // плавность 21
    res(JSON.stringify(out));
  }, 500));
})()`));
log('H UI set:', JSON.stringify(hSet));
clickBtn('Готово');
await sleep(800);
const hSaved = jparse(ev(`JSON.stringify(window.__game.settings.buoyancy)`));
log('H применено:', JSON.stringify(hSaved));
check('H: значения из панели дошли до игры',
  hSaved.draftOffset === 0.55 && hSaved.boatDraftMul === 2.4
  && hSaved.heelMaxDeg === 31.5 && hSaved.pitchMaxDeg === 33 && hSaved.boatSmooth === 21,
  JSON.stringify(hSaved));
const hLS = jparse(ev(`(() => { const raw = JSON.parse(localStorage.getItem('seawolves.settings.v1')); return JSON.stringify({ v: raw.v, b: raw.buoyancy }); })()`));
check('H: localStorage версия схемы 5', hLS.v === 5, `v=${hLS.v}`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = 0; window.addEventListener('error', e => window.__jsErrors++); 'ok'`);
clickBtn('Поднять флаг');
await sleep(2500);
const hAfter = jparse(ev(`JSON.stringify(window.__game.settings.buoyancy)`));
check('H: после перезагрузки настройки плавания живы',
  hAfter.draftOffset === 0.55 && hAfter.boatDraftMul === 2.4 && hAfter.heelMaxDeg === 31.5,
  JSON.stringify(hAfter));
// вернуть дефолты (не оставлять игроку кривую осадку)
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings);
  s.buoyancy.draftOffset = 0; s.buoyancy.boatDraftMul = 1;
  s.buoyancy.heelMaxDeg = 20.6; s.buoyancy.pitchMaxDeg = 24.1; s.buoyancy.boatSmooth = 13;
  g.applySettings(s);
  localStorage.setItem('seawolves.settings.v1', JSON.stringify({ ...s, v: 5 }));
  return 'ok'; })()`);
await sleep(300);

// ============ I: острова НЕПРАВИЛЬНОЙ формы (ограничение игрока) ============
log('=== I: острова неправильной формы (ratio ≥ 1.5, без «кругов») ===');
const shapes = jparse(ev(`JSON.stringify(window.__sea.islandsShape)`));
check('I: все острова ratio ≥ 1.5 — ни одного «круга»',
  shapes.length >= 15 && shapes.every(i => i.ratio >= 1.5),
  `n=${shapes.length}, min ratio=${Math.min(...shapes.map(i => i.ratio))}`);

// ============ J: ошибки JS ============
const errs = jparse(ev(`window.__jsErrors ?? 0`));
check('J: 0 ошибок JS', errs === 0, `errors=${errs}`);

log('');
log(fails === 0 ? 'ALL OK' : `FAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
