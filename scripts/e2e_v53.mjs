// E2E Task 35: КОТЫ НА БОРТУ.
// A: настройка «Экипаж из котов» — есть в панели, переключается
//    КЛИКОМ по чекбоксу, фигуры экипажа игрока становятся котами,
//    NPC остаются матросами, сохранение (схема v8) переживает
//    перезагрузку;
// B: кнопка «Купить кота» в меню порта (вкладка Гавань) — покупка
//    за 50 зол., максимум 5, шестой отказ с сообщением;
// C: коты на палубе — активны, двигаются, в границах палубы;
// D: ЛОВЛЯ МЫШЕЙ — мышь выпускается на палубу, кот гонится и ловит;
// E: 0 ошибок JS + скриншоты для VLM.
import { execSync } from 'node:child_process';
const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// Task 36: тяжёлые сцены занимают демон — повторяем с паузой
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
  let v = s;
  for (let i = 0; i < 6; i++) {
    if (typeof v !== 'string') return v;
    let p;
    try { p = JSON.parse(v); } catch {
      const m = v.match(/\{[\s\S]*\}/) || v.match(/\[[\s\S]*\]/);
      if (!m) return v;
      v = m[0];
      continue;
    }
    if (typeof p === 'string') { v = p; continue; }
    return p;
  }
  return v;
};
const isT = (v) => v === true || v === 'true';
const log = (...a) => console.log(...a);

run(`open http://localhost:3000/?t=${Date.now()}`);
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);
await sleep(300);
ev(`window.__game.start()`);
await sleep(400);

let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// ================= A: НАСТРОЙКА «ЭКИПАЖ ИЗ КОТОВ» =================
log('\n===== A: НАСТРОЙКА «Заменить всех матросов на котов» =====');

// открыть настройки → вкладка «Игра» (как игрок)
run(`eval "(() => { const b = [...document.querySelectorAll('button')].find(b => /Настройки/i.test(b.textContent)); if (b) b.click(); return 'opened'; })()"`);
let gameTab = false;
for (let i = 0; i < 15 && !gameTab; i++) {
  await sleep(1000);
  gameTab = ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Игра'); if (b) { b.click(); return true; } return false; })()`).includes('true');
}
let hasLabel = false;
for (let i = 0; i < 12 && !hasLabel; i++) {
  await sleep(1000);
  hasLabel = String(ev(`document.body.innerText.includes('Экипаж из котов')`)).includes('true');
}
check('A1: настройка «🐱 Экипаж из котов» есть в панели (вкладка Игра)',
  gameTab && hasLabel);

// клик по настоящему чекбоксу (React → applySettings → localStorage)
const clickCatCk = async () => {
  for (let i = 0; i < 12; i++) {
    const r = ev(`(() => {
      const row = [...document.querySelectorAll('div')].find(d =>
        d.className.includes('flex items-center justify-between') && d.textContent.includes('Экипаж из котов'));
      const cb = row ? row.querySelector('input[type=checkbox]') : null;
      if (cb) { cb.click(); return 'clicked'; }
      return 'NOT FOUND';
    })()`);
    if (String(r).includes('clicked')) return r;
    await sleep(1000);
  }
  return 'NOT FOUND';
};

const crewBefore = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    shown: g.player.crew3d.shown, total: g.player.crew3d.total,
    isCats: g.player.crew3d.isCats === true,
  });
})()`));
log(JSON.stringify(crewBefore));
const ck1 = await clickCatCk();
await sleep(1500);
const crewCats = jparse(ev(`(() => {
  const g = window.__game;
  const npcs = g.aiShips.filter(a => !a.ship.sunk).slice(0, 4)
    .map(a => a.ship.crew3d.isCats === true);
  return JSON.stringify({
    isCats: g.player.crew3d.isCats === true,
    shown: g.player.crew3d.shown, total: g.player.crew3d.total,
    npcsHuman: npcs.every(v => v === false),
  });
})()`));
log(ck1, JSON.stringify(crewCats));
check('A2: экипаж игрока ПЕРЕСОБРАН в котов (клик по чекбоксу, isCats, фигуры живы)',
  crewCats.isCats === true && crewCats.shown > 0 && crewCats.total === crewBefore.total);
check('A3: NPC-корабли остались с МАТРОСАМИ (коты только у игрока)',
  crewCats.npcsHuman === true);

// A4: выключить кликом обратно
await clickCatCk();
await sleep(1500);
const crewBack = jparse(ev(`window.__game.player.crew3d.isCats === true`));
check('A4: выключение возвращает матросов', crewBack === false);

// A5: включить снова (сохранится в localStorage) и перезагрузить
await sleep(600);
await clickCatCk();
await sleep(1500);
run('reload');
await sleep(9000);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'rearmed'`);
// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);
await sleep(300);
ev(`window.__game.start()`);
await sleep(600);
const afterReload = jparse(ev(`(() => {
  const g = window.__game;
  const raw = JSON.parse(localStorage.getItem('seawolves.settings.v1'));
  return JSON.stringify({
    v: raw.v,
    flag: g.settings.gameplay.catsInsteadOfCrew === true,
    isCats: g.player.crew3d.isCats === true,
  });
})()`));
log(JSON.stringify(afterReload));
check('A5: флаг сохранён, после перезагрузки экипаж — коты (схема v15)',
  afterReload.v === 15 && afterReload.flag === true && afterReload.isCats === true);
// вернуть матросов (чистый стенд для B/C/D)
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.gameplay.catsInsteadOfCrew = false;
  g.applySettings(s);
  localStorage.setItem('seawolves.settings.v1', JSON.stringify({ ...s, v: 8 }));
  return 'back to sailors';
})()`);
await sleep(400);

// ================= B: КНОПКА «КУПИТЬ КОТА» В МЕНЮ ПОРТА =================
log('\n===== B: покупка котов в порту =====');
ev(`(() => {
  const g = window.__game, p = g.world.ports[0];
  g.player.position.set(p.dockEnd.x + p.dir.x * 10, 0, p.dockEnd.z + p.dir.z * 10);
  g.player.velocity.set(0, 0, 0);
  g.canDock();
  g.dock();
  return g.dockedPort.name;
})()`);
await sleep(800);   // HUD-опрос 110 мс → меню порта открылось
const btnState = jparse(ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Купить кота'));
  return JSON.stringify({ found: !!b, txt: b ? b.textContent.trim().replace(/\\s+/g, ' ') : null });
})()`));
log(JSON.stringify(btnState));
check('B1: кнопка «🐱 Купить кота» есть в меню порта (вкладка Гавань)',
  btnState.found === true && String(btnState.txt).includes('на борту: 0/5'));

const gold0 = jparse(ev(`Math.floor(window.__game.player.gold)`));
// B2: купить 5 котов кликами по настоящей кнопке
for (let i = 0; i < 5; i++) {
  ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Купить кота'));
    if (b) b.click();
    return 'buy';
  })()`);
  await sleep(400);
}
await sleep(900);   // дождаться свежего HUD-снимка React (опрос 110 мс)
// B4: HUD/кнопка догоняют (опрос 110 мс, под нагрузкой дольше — ждём до 5 с)
let btnTxt5 = '';
for (let t = 0; t < 10; t++) {
  btnTxt5 = String(jparse(ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Купить кота'));
    return b ? b.textContent.trim().replace(/\\s+/g, ' ') : '';
  })()`)));
  if (btnTxt5.includes('на борту: 5/5')) break;
  await sleep(500);
}
const after5 = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({
    cats: g.catCount, gold: Math.floor(g.player.gold),
    hud: g.hud.cats,
    names: g.catNames.slice(0, g.catCount),
  });
})()`));
log(JSON.stringify(after5), btnTxt5);
check('B2: куплено РОВНО 5 котов (кликами), золото −250',
  after5.cats === 5 && after5.gold === gold0 - 250, `gold ${gold0} → ${after5.gold}`);
check('B3: клички назначены (уникальные)', Array.isArray(after5.names)
  && after5.names.length === 5 && new Set(after5.names).size === 5, JSON.stringify(after5.names));
check('B4: HUD показывает 5/5 и на кнопке «на борту: 5/5»',
  after5.hud === 5 && btnTxt5.includes('на борту: 5/5'));

// B5: шестой отказ
ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Купить кота'));
  if (b) b.click();
  return 'try 6th';
})()`);
await sleep(400);
const sixth = jparse(ev(`(() => {
  const g = window.__game;
  const msg = [...document.querySelectorAll('div')].map(d => d.textContent).find(t => t && t.includes('пять котов'));
  return JSON.stringify({ cats: g.catCount, gold: Math.floor(g.player.gold), refused: !!msg });
})()`));
log(JSON.stringify(sixth));
check('B5: шестой кот ОТКАЗ (сообщение, котов 5, золото не списано)',
  sixth.cats === 5 && sixth.gold === after5.gold && sixth.refused === true);

// ================= C: КОТЫ НА ПАЛУБЕ =================
log('\n===== C: коты бродят по палубе =====');
ev(`(() => { window.__game.undock(); return 'undocked'; })()`);
await sleep(600);
const pos1 = jparse(ev(`JSON.stringify(window.__game.cats3d.catState())`));
ev(`window.__game.stepDebugNR(8)`);
const pos2 = jparse(ev(`JSON.stringify(window.__game.cats3d.catState())`));
const movedN = Array.isArray(pos1) && Array.isArray(pos2)
  ? pos1.filter((c, i) => Math.hypot(pos2[i].x - c.x, pos2[i].z - c.z) > 0.05).length : 0;
const states = (Array.isArray(pos2) ? pos2.map(c => c.st) : []).join(',');
log('t=0:', JSON.stringify(pos1));
log('t=6с:', JSON.stringify(pos2));
check('C1: коты ДВИГАЮТСЯ (минимум 4 из 5 сменили позицию за 8 с симуляции; коты любят посидеть)',
  movedN >= 4, `сдвинулись ${movedN}/5, состояния: ${states}`);

// C2: в границах палубы (замер halfWidthAt + длина корпуса)
const bounds = jparse(ev(`(() => {
  const g = window.__game, s = g.cats3d.catState(), sh = g.player;
  const L = sh.preset.length;
  return JSON.stringify(s.map(c => {
    const hw = sh.halfWidthAt(c.z);
    return { in: Math.abs(c.x) < hw * 0.95 && Math.abs(c.z) < L * 0.55, x: c.x, z: c.z, hw: +hw.toFixed(2) };
  }));
})()`));
const allIn = Array.isArray(bounds) && bounds.length === 5 && bounds.every(b => b.in);
log(JSON.stringify(bounds));
check('C2: коты в границах палубы (не за бортом)', allIn === true);

// ================= D: ЛОВЛЯ МЫШЕЙ =================
log('\n===== D: коты ловят мышей =====');
ev(`(() => { window.__game.debugSpawnMouse(); return 'mouse 1'; })()`);
await sleep(400);
ev(`(() => { window.__game.debugSpawnMouse(); return 'mouse 2'; })()`);
await sleep(500);
const mice0 = jparse(ev(`(() => {
  const g = window.__game;
  return JSON.stringify({ mice: g.cats3d.mice, caught: g.cats3d.caught, cats: g.cats3d.catState() });
})()`));
log(JSON.stringify(mice0));
check('D1: мыши выпущены на палубу', mice0.mice >= 1);

// ждать ловли до 30 с (кот чует мышь в 8.5 м, догоняет 3.4 vs 2.1 м/с)
let caughtNow = 0;
let chaseSeen = false;
for (let t = 0; t < 45; t += 5) {
  ev(`window.__game.stepDebugNR(5)`);
  const st = jparse(ev(`(() => {
    const g = window.__game;
    return JSON.stringify({ caught: g.cats3d.caught, mice: g.cats3d.mice,
      chase: g.cats3d.catState().some(c => c.st === 'chase' || c.st === 'eat') });
  })()`));
  if (st.chase) chaseSeen = true;
  caughtNow = st.caught ?? 0;
  if (caughtNow >= 1) break;
}
check('D2: кот ПОЙМАЛ мышь (caught ≥ 1 за 45 с симуляции)', caughtNow >= 1, `caught=${caughtNow}, погоня=${chaseSeen}`);
check('D3: погоня/поедание наблюдались (chase/eat или поимка)', chaseSeen === true || caughtNow >= 1);

// ================= E: СКРИНШОТЫ + ОШИБКИ =================
log('\n===== E: скриншоты и ошибки JS =====');
// E1: коты на палубе — низкая камера вдоль палубы от носа (коты крупно)
ev(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera, p = g.player;
  const wg = g.worldGroup.position;
  const px = p.position.x + wg.x, pz = p.position.z + wg.z;
  const f = p.forward;
  const L = p.preset.length;
  const pose = {
    pos: [px + f.x * (L * 0.55), p.position.y + 3.0, pz + f.z * (L * 0.55)],
    look: [px - f.x * (L * 0.1), p.position.y + 1.2, pz - f.z * (L * 0.1)],
  };
  window.__origUpdate = rig.update.bind(rig);
  rig.update = () => {
    cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    cam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
  };
  return 'pose';
})()`);
await sleep(1500);
run('screenshot /home/z/my-project/scripts/shots/t35_cats_deck.png');
await sleep(300);
// второй ракурс: сверху над палубой — все 5 котов в кадре
ev(`(() => {
  const g = window.__game, rig = g.rig, cam = rig.camera, p = g.player;
  const wg = g.worldGroup.position;
  const px = p.position.x + wg.x, pz = p.position.z + wg.z;
  const pose = {
    pos: [px + p.forward.x * 2, p.position.y + 6.5, pz + p.forward.z * 2],
    look: [px, p.position.y + 0.8, pz],
  };
  rig.update = () => {
    cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    cam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
  };
  return 'pose2';
})()`);
await sleep(1200);
run('screenshot /home/z/my-project/scripts/shots/t35_cats_top.png');
await sleep(300);

// E2: экипаж из котов (включить и снять крупный план палубы)
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.gameplay.catsInsteadOfCrew = true;
  g.applySettings(s);
  return 'crew cats';
})()`);
await sleep(1000);
run('screenshot /home/z/my-project/scripts/shots/t35_crew_cats.png');
await sleep(300);
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.gameplay.catsInsteadOfCrew = false;
  g.applySettings(s);
  g.rig.update = window.__origUpdate;
  return 'restore';
})()`);
await sleep(400);

// E3: меню порта с кнопкой покупки
ev(`(() => {
  const g = window.__game, p = g.world.ports[0];
  g.player.position.set(p.dockEnd.x + p.dir.x * 10, 0, p.dockEnd.z + p.dir.z * 10);
  g.player.velocity.set(0, 0, 0);
  g.canDock();
  g.dock();
  return 'docked';
})()`);
await sleep(900);
run('screenshot /home/z/my-project/scripts/shots/t35_port_button.png');
await sleep(300);
ev(`window.__game.undock(); 'undocked'`);

const errs = jparse(ev(`JSON.stringify(window.__jsErrors || [])`));
log('JS errors:', JSON.stringify(errs));
check('E4: ошибок JS нет', Array.isArray(errs) && errs.length === 0,
  Array.isArray(errs) ? JSON.stringify(errs).slice(0, 200) : String(errs).slice(0, 200));

log(`\n===== ИТОГ e2e_v53: ${fails === 0 ? 'ALL OK' : `ОШИБОК: ${fails}`} =====`);
if (fails > 0) process.exit(1);
