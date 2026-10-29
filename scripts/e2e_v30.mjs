// E2E Task 30 (v2): (A) энциклопедия с 3D-просмотром; (B) настройки боезапаса/
// прочности + расход боеприпасов; (C) верфь (смена корабля) + быстрое
// перемещение по карте; (D) регресс: посадка на волну в шторм.
// Уроки v1: agent-browser eval возвращает ДВАЖДЫ JSON-закодированный результат;
// клавиши — только `keypress <Code>`; кнопки со вложенной разметкой ищем через
// eval + native .click() (find text не находит частичный текст).
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 90000 }).trim(); }
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
/** eval возвращает результат, обёрнутый в JSON-строку (иногда дважды) */
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
/** клик по кнопке по частичному textContent (native click — React ловит) */
const clickBtn = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}')); if (b) { b.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
/** клик с ожиданием рендера React (headless рендерит медленно — модалка
 *  может появиться через несколько сотен мс после смены состояния) */
const clickRetry = async (text, tries = 8) => {
  let last = 'NOT FOUND';
  for (let i = 0; i < tries; i++) {
    last = clickBtn(text);
    if (last.includes('clicked')) return last;
    await sleep(750);
  }
  return last;
};
const pageErrors = () => {
  const e = run('errors');
  return /Uncaught|TypeError|ReferenceError|Error:|Hydration/i.test(e) ? e : '';
};

// ============ Фаза A: энциклопедия с 3D-просмотром ============
log('=== A: энциклопедия 3D ===');
run('open http://localhost:3000/');
await sleep(2000);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload'); await sleep(8000);
const ency3d0 = clickBtn('Энциклопедия кораблей');
log('A: кнопка энциклопедии:', ency3d0);
await sleep(1200);
shot('v30_ency_list');
clickBtn('HMS Victory');
await sleep(2600);
shot('v30_ency_3d_victory');
clickBtn('Капудана');
await sleep(2600);
shot('v30_ency_3d_galley');
const ency3d = jparse(ev(`(() => { const cv = document.querySelector('canvas.cursor-grab'); return cv ? JSON.stringify({w: cv.clientWidth, h: cv.clientHeight}) : 'none'; })()`));
log('A: 3D-канвас:', JSON.stringify(ency3d));
check('A: 3D-канвас в статье существует', ency3d && ency3d.w > 100, JSON.stringify(ency3d));
const errsA = pageErrors();
check('A: нет ошибок страницы', errsA === '', errsA.slice(0, 200));

// ============ Фаза B: настройки боезапаса и прочности ============
log('=== B: боезапас/прочность ===');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.setItem('seawolves.settings.v1', JSON.stringify({gameplay:{startingAmmo:{ball:7,chain:3,grape:5,fire:2}, hullDurability:2, infiniteAmmo:false}}))`);
run('reload'); await sleep(8000);
clickBtn('Поднять флаг');
await sleep(2500);
const st1 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ammo: g.player.ammo, hullMax: g.player.hullMax}); })()`));
log('B: старт:', JSON.stringify(st1));
check('B: стартовый боезапас из настроек (7/3/5/2)',
  st1.ammo && st1.ammo.ball === 7 && st1.ammo.chain === 3 && st1.ammo.grape === 5 && st1.ammo.fire === 2, JSON.stringify(st1));
check('B: прочность x2 применена при создании (шлюп 100 -> 200)', st1.hullMax === 200, JSON.stringify(st1));
// выстрел: боезапас тратится
ev(`(() => { const g = window.__game; g.combat.reloads.fill(0); g.combat.aim.active = true; g.combat.aim.side = 1; g.combat.aim.elevation = 0.1; g.combat.fireOne(); return 'fired'; })()`);
await sleep(700);
const st2 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ball: g.player.ammo.ball}); })()`));
log('B: после выстрела:', JSON.stringify(st2));
check('B: ядро израсходовано (7 -> 6)', st2.ball === 6, JSON.stringify(st2));
// бесконечные боеприпасы
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.gameplay.infiniteAmmo = true; g.applySettings(s); return 'inf'; })()`);
await sleep(400);
ev(`(() => { const g = window.__game; g.combat.reloads.fill(0); g.combat.fireOne(); g.combat.reloads.fill(0); g.combat.fireOne(); return 'fired2'; })()`);
await sleep(700);
const st3 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ball: g.player.ammo.ball, inf: g.combat.infiniteAmmo}); })()`));
log('B: с бесконечными:', JSON.stringify(st3));
check('B: бесконечные — боезапас не тратится (6)', st3.ball === 6 && st3.inf === true, JSON.stringify(st3));
// живое изменение настройки боезапаса
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.gameplay.startingAmmo.ball = 33; s.gameplay.infiniteAmmo = false; g.applySettings(s); return 'rearm'; })()`);
await sleep(400);
const st4 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ball: g.player.ammo.ball}); })()`));
check('B: изменение настройки сразу выдает боезапас (33)', st4.ball === 33, JSON.stringify(st4));
// живое перемасштабирование прочности (2 -> 1)
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.gameplay.hullDurability = 1; g.applySettings(s); return 'soft'; })()`);
await sleep(400);
const st5 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({hullMax: g.player.hullMax, aiHull: g.aiShips[0].ship.hullMax}); })()`));
log('B: прочность 2->1:', JSON.stringify(st5));
check('B: прочность перемасштабирована вживую (200 -> 100)', st5.hullMax === 100, JSON.stringify(st5));
// UI настроек: вкладка «Игра»
clickBtn('Настройки');
await sleep(600);
clickBtn('Игра');
await sleep(500);
shot('v30_settings_gameplay');
const uiAmmo = jparse(ev(`(() => { const els = [...document.querySelectorAll('input[type=number]')]; return JSON.stringify(els.map(e => Number(e.value))); })()`));
log('B: инпуты боезапаса:', JSON.stringify(uiAmmo));
check('B: 4 поля боезапаса в настройках', Array.isArray(uiAmmo) && uiAmmo.length === 4, JSON.stringify(uiAmmo));
const uiDur = jparse(ev(`(() => { return document.body.textContent.includes('Прочность кораблей') ? 'yes' : 'no'; })()`));
check('B: слайдер прочности в настройках', uiDur === 'yes', uiDur);
const errsB = pageErrors();
check('B: нет ошибок страницы', errsB === '', errsB.slice(0, 200));

// ============ Фаза C: верфь (смена корабля) + быстрые путешествия ============
log('=== C: верфь + быстрое перемещение ===');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload'); await sleep(8000);
clickBtn('Поднять флаг');
await sleep(2500);
// «швартуемся» — открыть порт
ev(`(() => { const g = window.__game; g.player.velocity.set(0,0,0); g.docked = true; g.player.anchored = true; return 'docked'; })()`);
await sleep(600);
shot('v30_port');
const r1 = await clickRetry('Сменить корабль');
await sleep(600);
shot('v30_yard_war');
const r2 = await clickRetry('Торговые');
await sleep(500);
shot('v30_yard_merchant');
const yardCount = jparse(ev(`(() => { const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('Взять')); return JSON.stringify(btns.length); })()`));
log('C: кнопок «Взять» (торговые):', yardCount);
check('C: торговые суда на верфи > 5', yardCount > 5, String(yardCount));
log('C: клики:', r1, r2);
const r3 = clickBtn('Amsterdam');
await sleep(1500);
const ship1 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({id: g.player.preset.id, name: g.player.preset.name, hull: g.player.hullMax, gold: g.player.gold}); })()`));
log('C: после смены:', JSON.stringify(ship1), 'клик:', r3);
check('C: игрок на Amsterdam', ship1.id === 'amsterdam', JSON.stringify(ship1));
check('C: золото сохранено (350)', ship1.gold === 350, JSON.stringify(ship1));
await sleep(800);
shot('v30_ship_amsterdam');
// отшвартоваться и поставить паруса (в порту ввод блокируется)
ev(`(() => { const g = window.__game; g.undock(); return 'undocked'; })()`);
await sleep(400);
run('press w'); await sleep(300); run('press w'); await sleep(300); run('press w');
await sleep(4500);
const sail1 = jparse(ev(`(() => { const s = window.__sea; return JSON.stringify({spd: +s.speed.toFixed(1), set: s.sailSet}); })()`));
log('C: ход Amsterdam:', JSON.stringify(sail1));
check('C: Amsterdam идёт под парусами', sail1.spd > 0.2, JSON.stringify(sail1));
// карта: быстрое перемещение кликом по острову «Плёс» (250, -1400)
run('press Tab');
await sleep(900);
shot('v30_map_open');
const clickRes = ev(`(() => { const canvases = document.querySelectorAll('canvas'); let map = null; for (const c of canvases) { if (c.width === 640 && c.height === 520) map = c; } if (!map) return 'no map canvas'; const r = map.getBoundingClientRect(); const mx = r.left + (320 + 250 * 0.055) * (r.width / 640); const my = r.top + (260 - 1400 * 0.055) * (r.height / 520); map.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: mx, clientY: my})); return 'clicked'; })()`);
log('C: клик по карте:', clickRes);
check('C: клик по карте доставлен', clickRes.includes('clicked'), clickRes);
await sleep(1800);
const pos1 = jparse(ev(`(() => { const s = window.__sea; return JSON.stringify({x: +s.x.toFixed(0), z: +s.z.toFixed(0)}); })()`));
log('C: позиция после телепорта:', JSON.stringify(pos1));
check('C: телепорт к острову Плёс (250,-1400)', Math.hypot(pos1.x - 250, pos1.z + 1400) < 500, JSON.stringify(pos1));
shot('v30_travel_arrived');
// вторая смена: галера (гребной, военные)
ev(`(() => { const g = window.__game; g.docked = true; return 'docked2'; })()`);
await sleep(500);
log('C: пикер2:', await clickRetry('Сменить корабль'));
await sleep(600);
log('C: таб военные:', await clickRetry('Военные'));
await sleep(400);
log('C: галера кнопка:', await clickRetry('Капудана'));
await sleep(1600);
const ship2 = jparse(ev(`(() => { const g = window.__game; return JSON.stringify({id: g.player.preset.id, oars: g.player.preset.oars}); })()`));
log('C: после смены на галеру:', JSON.stringify(ship2));
check('C: игрок на галере с вёслами', ship2.id === 'galley' && ship2.oars > 0, JSON.stringify(ship2));
await sleep(1200);
shot('v30_galley_sailing');
const errsC = pageErrors();
check('C: нет ошибок страницы', errsC === '', errsC.slice(0, 250));

// ============ Фаза D: регресс — посадка на волну в шторм ============
log('=== D: шторм, посадка на волну ===');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload'); await sleep(8000);
clickBtn('Поднять флаг');
await sleep(2500);
ev(`(() => { window.__rec = { minFb: 99, maxRoll: 0, maxPitch: 0, n: 0 }; window.__recIv = setInterval(() => { const s = window.__sea; if (s) { window.__rec.minFb = Math.min(window.__rec.minFb, s.freeboard); window.__rec.maxRoll = Math.max(window.__rec.maxRoll, Math.abs(s.roll)); window.__rec.maxPitch = Math.max(window.__rec.maxPitch, Math.abs(s.pitch)); window.__rec.n++; } }, 90); return 'rec'; })()`);
ev(`(() => { const g = window.__game; g.debugSetWeather('storm', 22, 40); return 'storm'; })()`);
run('press w');
await sleep(26000);
const rec = jparse(ev(`JSON.stringify(window.__rec)`));
const seaD = jparse(ev(`(() => { const s = window.__sea; return JSON.stringify({amp: +s.seaAmp.toFixed(2), fb: +s.freeboard.toFixed(2), spd: +s.speed.toFixed(1)}); })()`));
log('D: рекорд:', JSON.stringify(rec));
log('D: море:', JSON.stringify(seaD));
check('D: палуба не ныряет под гребень (freeboard >= 0.4)', rec.minFb >= 0.4, `minFb=${rec.minFb && rec.minFb.toFixed(2)}`);
check('D: крен в норме (< 0.45 рад)', rec.maxRoll < 0.45, `maxRoll=${rec.maxRoll && rec.maxRoll.toFixed(2)}`);
ev(`(() => { clearInterval(window.__recIv); const g = window.__game; while (g.rig.mode !== 'free') g.rig.cycleMode(); g.rig.freeAzimSet(Math.PI * 0.7); g.rig.freeElevSet(0.16); g.rig.distSet(40); return 'cam'; })()`);
await sleep(1400);
shot('v30_storm_side');
const errsD = pageErrors();
check('D: нет ошибок страницы', errsD === '', errsD.slice(0, 200));

log(fails === 0 ? '\nALL OK' : `\nFAILED: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
