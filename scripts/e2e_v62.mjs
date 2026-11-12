// E2E Task 44: СТРЕЛКИ ТОЛЬКО ПРИ НАПАДЕНИИ + МЕНЮ + ПЛАТО ПОД
// ПОСТРОЙКАМИ + ГОРОД У ФОРТА.
//  (A) стрелки мишени: режим «не стрелять» — ружья молчат (даже
//      когда по ним стреляют — только прячутся на колено); режим
//      «отвечать огнём» — открывают огонь (урон игроку); мирные
//      торговцы в route — НЕ стреляют
//  (B) настройки: все 8 вкладок ВИДНЫ и кликабельны («Управление»
//      раньше не влезала), список клавиш присутствует
//  (C) земля под домами: плато под фортом (8 точек ≤ 1.2 м),
//      церковь/таверна/колодец/дома ≤ 4.5 м, среднее ≤ 0.5 м
//  (D) город у форта: в каждом порту tier-3 есть церковь (с
//      крестом), таверна (с вывеской/бочками), колодец, ≥4 дома,
//      форт + каменный двор
//  (E) 0 ошибок JS + скриншоты
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
const log = (...a) => console.log(...a);
let fails = 0;
const check = (name, cond, extra = '') => {
  log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

// СВЕЖИЙ контекст браузера
run('close');
await sleep(1200);
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
check('0: игра загрузилась', loaded);
ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);
await sleep(300);

ev(`(() => {
  const scr = document.querySelector('[data-char-screen]');
  if (scr) {
    const btn = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже'));
    if (btn) btn.click();
  }
  return 'ok';
})()`);
await sleep(800);
ev(`window.__game.start()`);
await sleep(600);

// ============ A: СТРЕЛКИ ТОЛЬКО ПРИ НАПАДЕНИИ ============
log('\n===== A: стрелки: огонь только при нападении =====');
const noFire = jparse(await evR(`(() => {
  const g = window.__game;
  g.startProving('fluyt');
  g.stepDebugNR(1);
  const p = g.player;
  const tgt = g.pgTarget.ship;
  const T = window.__THREE.Vector3;
  tgt.position.copy(p.position).add(new T(0, 0, 35));
  tgt.velocity.set(0, 0, 0);
  g.setPgReturnFire(false);
  // ПО МИШЕНИ ПОПАДАНИЕ — стрелки всё равно молчат, но прячутся
  tgt.applyDamage({ kind: 'ball', amount: 5, hitPoint: tgt.position.clone() });
  g.stepDebugNR(6);
  return JSON.stringify({
    crewEngage: tgt.crewEngage,
    threat: tgt.threatTarget === null,
    pCrew: p.crew, pDead: p.crew3d.dead,
    tgtCrouched: tgt.crew3d.crouchedCount(),
    armed: tgt.crew3d.armedInfo(),
  });
})()`));
log(JSON.stringify(noFire));
check('A1: мишень в режиме «НЕ СТРЕЛАТЬ»: crewEngage=false',
  noFire.crewEngage === false);
check('A2: threatTarget мишени null (ружья не наводятся)',
  noFire.threat === true);
check('A3: экипаж игрока НЕ несёт потерь от стрелков (первые 6 с)',
  noFire.pDead === 0 && noFire.pCrew > 0, `убито: ${noFire?.pDead}`);
check('A4: под обстрелом матросы мишени ПРЯЧУТСЯ на колено (укрытие без агрессии)',
  noFire.tgtCrouched >= 1, `на колене: ${noFire?.tgtCrouched}`);
check('A5: у мишени ЕСТЬ вооружённые матросы (проверка не пустая)',
  noFire.armed && (noFire.armed.musket + noFire.armed.pistol) >= 3,
  JSON.stringify(noFire?.armed));

const fire = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  const tgt = g.pgTarget.ship;
  g.setPgReturnFire(true);
  g.stepDebugNR(10);
  const r = {
    crewEngage: tgt.crewEngage,
    threat: tgt.threatTarget !== null,
    pDead: p.crew3d.dead,
    pHull: +p.hullHP.toFixed(1),
  };
  g.setPgReturnFire(false);
  g.stepDebugNR(2);
  r.offEngage = tgt.crewEngage;
  r.offThreatNull = tgt.threatTarget === null;
  return JSON.stringify(r);
})()`));
log(JSON.stringify(fire));
check('A6: режим «ОТВЕЧАТЬ ОГНЁМ»: crewEngage=true, цель наведена',
  fire.crewEngage === true && fire.threat === true);
check('A7: стрелки мишени ОТКРЫВАЮТ ОГОНЬ (потери у игрока за 10 с)',
  fire.pDead >= 1, `убито: ${fire?.pDead}, hull: ${fire?.pHull}`);
check('A8: ВЫКЛЮЧИЛИ ответный огонь — ружья замолчали',
  fire.offEngage === false && fire.offThreatNull === true);

const peaceful = jparse(await evR(`(() => {
  const g = window.__game;
  const p = g.player;
  let m = null;
  for (const ai of g.aiShips) {
    if (ai.state === 'route' && !ai.ship.surrendered) { m = ai; break; }
  }
  if (!m) return JSON.stringify({found: false});
  m.ship.position.copy(p.position).add(new window.__THREE.Vector3(0, 0, 30));
  m.ship.velocity.set(0, 0, 0);
  const deadBefore = p.crew3d.dead;
  g.stepDebugNR(4);
  return JSON.stringify({
    found: true, state: m.state,
    engage: m.ship.crewEngage,
    threatNull: m.ship.threatTarget === null,
    pDeadDelta: p.crew3d.dead - deadBefore,
  });
})()`));
log(JSON.stringify(peaceful));
check('A9: мирный торговец (route) рядом: ружья МОЛЧАТ',
  peaceful.found === true && peaceful.engage === false
  && peaceful.threatNull === true && peaceful.pDeadDelta === 0,
  `state=${peaceful?.state}, engage=${peaceful?.engage}, убито: ${peaceful?.pDeadDelta}`);

// ============ B: НАСТРОЙКИ — ВСЕ ВКЛАДКИ ВЛЕЗАЮТ ============
log('\n===== B: настройки: все 8 вкладок влезают =====');
ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('⚙ Настройки'));
  if (btn) btn.click();
  return btn ? 'clicked' : 'нет кнопки';
})()`);
await sleep(1200);   // React: панель рендерится асинхронно
const menu = jparse(await evR(`(() => {
  const names = ['Графика','Ресурсы','Погода','Физика','Игра','🏝 Острова','Управление','Звук'];
  const tabs = names.map(n => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === n);
    if (!b) return {n, found: false};
    const r = b.getBoundingClientRect();
    return {n, found: true, w: Math.round(r.width), x: Math.round(r.x), visible: r.width > 0 && r.height > 0,
      inPanel: r.x >= 0 && r.x + r.width <= window.innerWidth};
  });
  const ctl = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Управление');
  ctl && ctl.click();
  return JSON.stringify({tabs});
})()`));
await sleep(900);   // React: вкладка рендерится асинхронно
const binds = jparse(await evR(`(() => {
  const bindBtns = [...document.querySelectorAll('button')].filter(b => b.className.includes('min-w-[72px]'));
  return JSON.stringify({bindRows: bindBtns.length});
})()`));
menu.bindRows = binds.bindRows;
log(JSON.stringify(menu));
check('B1: все 8 вкладок найдены и видимы',
  menu.tabs && menu.tabs.length === 8 && menu.tabs.every(t => t.found && t.visible && t.inPanel),
  menu.tabs ? menu.tabs.map(t => `${t.n}:${t.w}px`).join(' ') : '');
check('B2: вкладка «Управление» открывается — список клавиш присутствует',
  menu.bindRows >= 5, `строк клавиш: ${menu?.bindRows}`);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Готово')); if (b) b.click(); return 'closed'; })()`);
await sleep(500);

// ============ C: ЗЕМЛЯ ПОД ДОМАМИ (ПЛАТО) ============
log('\n===== C: выровненная земля под постройками =====');
const plateau = jparse(await evR(`(() => {
  const g = window.__game;
  const H = window.__heightAt;
  const per = { fort: [], church: [], tavern: [], well: [], townhouse: [] };
  g.world.group.traverse(o => {
    if (per[o.name]) per[o.name].push(o);
  });
  const deltas = [];
  const measure = (o, name) => {
    const y = o.position.y;
    const r = name === 'fort' ? 34 : 6;
    const pts = [[0,0],[r,0],[0,r],[-r,0],[0,-r]];
    if (name === 'fort') pts.push([r,r],[-r,-r],[r,-r],[-r,r]);
    for (const [dx, dz] of pts) {
      deltas.push({name, d: Math.abs(H(o.position.x + dx, o.position.z + dz) - y)});
    }
  };
  for (const k in per) for (const o of per[k]) measure(o, k);
  const fortMax = Math.max(...deltas.filter(x => x.name === 'fort').map(x => x.d));
  const otherMax = Math.max(...deltas.filter(x => x.name !== 'fort').map(x => x.d));
  const avg = deltas.reduce((a, x) => a + x.d, 0) / deltas.length;
  return JSON.stringify({
    counts: Object.fromEntries(Object.keys(per).map(k => [k, per[k].length])),
    fortMax: +fortMax.toFixed(2), otherMax: +otherMax.toFixed(2),
    avg: +avg.toFixed(3), points: deltas.length,
  });
})()`));
log(JSON.stringify(plateau));
check('C1: плато под ФОРТОМ — все 8 точек (центр/стены/углы) ≤ 1.2 м',
  plateau.fortMax <= 1.2, `макс. отклонение: ${plateau?.fortMax} м`);
check('C2: плато под прочими постройками ≤ 4.5 м',
  plateau.otherMax <= 4.5, `макс.: ${plateau?.otherMax} м`);
check('C3: среднее отклонение земли от пола ≤ 0.5 м',
  plateau.avg <= 0.5, `среднее: ${plateau?.avg} м по ${plateau?.points} точкам`);

// ============ D: ГОРОД У ФОРТА ============
log('\n===== D: полноценный город вокруг форта =====');
const city = jparse(await evR(`(() => {
  const g = window.__game;
  const per = {};
  g.world.group.traverse(o => {
    if (o.name) per[o.name] = (per[o.name] || 0) + 1;
  });
  let churchKids = 0, tavernKids = 0;
  g.world.group.traverse(o => {
    if (o.name === 'church' && churchKids === 0) churchKids = o.children.length;
    if (o.name === 'tavern' && tavernKids === 0) tavernKids = o.children.length;
  });
  return JSON.stringify({
    church: per.church || 0, tavern: per.tavern || 0, well: per.well || 0,
    townhouse: per.townhouse || 0, fort: per.fort || 0, yard: (per['fort_yard'] || 0),
    churchKids, tavernKids,
  });
})()`));
log(JSON.stringify(city));
check('D1: в каждом порту tier-3: церковь ≥ 5 (портов 5-6)',
  city.church >= 5, `церквей: ${city?.church}`);
check('D2: таверна ≥ 5',
  city.tavern >= 5, `таверн: ${city?.tavern}`);
check('D3: колодец ≥ 5',
  city.well >= 5, `колодцев: ${city?.well}`);
check('D4: дома горожан ≥ 25 (по 5-6 на порт)',
  city.townhouse >= 25, `домов: ${city?.townhouse}`);
check('D5: форт ≥ 5 + каменный двор у каждого',
  city.fort >= 5 && city.yard >= 5, `фортов: ${city?.fort}, дворов: ${city?.yard}`);
check('D6: церковь БОГАТА деталями (неф+крыша+башня+шпиль+КРЕСТ+окна ≥ 12 мешей)',
  city.churchKids >= 12, `мешей: ${city?.churchKids}`);
check('D7: таверна с деталями (стены+пояс+крыша+вывеска+труба+БОЧКИ ≥ 12 мешей)',
  city.tavernKids >= 12, `мешей: ${city?.tavernKids}`);

// ============ E: ФИНАЛ ============
log('\n===== E: финал =====');
ev(`(() => {
  const g = window.__game;
  let fort = null;
  g.world.group.traverse(o => { if (o.name === 'fort' && !fort) fort = o; });
  g.player.position.set(fort.position.x, 0, fort.position.z + 200);
  g.player.velocity.set(0, 0, 0);
  g.rig.snap();
  const cam = g.rig.camera;
  cam.position.set(fort.position.x + 40, fort.position.y + 120, fort.position.z + 220);
  cam.lookAt(fort.position.x, fort.position.y, fort.position.z);
  return 'ok';
})()`);
await sleep(2500);
run('screenshot scripts/shots/t44_fort_town.png');
await sleep(1000);
const errs = jparse(await evR(`JSON.stringify(window.__jsErrors)`));
log('JS errors:', JSON.stringify(errs));
check('E1: 0 ошибок JavaScript', Array.isArray(errs) && errs.length === 0);

log('\n========================================');
log(fails === 0 ? 'ALL OK' : `FAILURES: ${fails}`);
log('========================================');
if (fails > 0) process.exit(1);
