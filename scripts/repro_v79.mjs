// Воспроизведение Task 79: «ПАРУС у моделей из досок РЕЖЕТ
// ПЕРЕДНЮЮ ЧАСТЬ ПОПОЛАМ». Кандидаты: (а) «пузо» парусов (шейдер
// uBelly — численный аудит Task 78 его не сэмплировал), (б) рангоут
// при разрушении на ЛАТИНСКИХ судах (фикс Task 78 двигал к пню
// только ПРЯМЫЕ реи, латинская рей не покрыта). Скриншоты носа
// до/после слома мачт по 4 пресетам + VLM-анализ.
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

execSync('mkdir -p scripts/shots');
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
ev(`localStorage.removeItem('seawolves.settings.v1'); localStorage.removeItem('piratesHUDFold_v1'); 1`);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2500);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1500);

// дощатая модель + ШТОРМОВОЙ ветер (максимальное «пузо») + полные паруса
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);
ev(`(() => { const g = window.__game; g.player.wind.speed = 12.5; g.player.sailTarget = 3; return 1; })()`);

const PRESETS = ['caravel', 'pinnace', 'galley', 'frigate'];
const info = {};
for (const id of PRESETS) {
  ev(`window.__game.changeShip('${id}', true)`);
  await sleep(1200);
  // ветер в БОРТ (макс пузо вбок у кливеров/латинских) + разгон
  ev(`(() => { const g = window.__game; g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(4); return 1; })()`);
  await sleep(400);
  // ракурс: нос-траверз, ближе
  ev(`(() => { const g = window.__game; g.setCameraMode('free');
    g.rig.freeAzimSet(2.45); g.rig.freeElevSet(0.14); g.rig.distSet(30);
    g.stepDebug(0.2); return 1; })()`);
  run(`screenshot scripts/shots/t79_${id}_intact.png`);
  // сломать ВСЕ мачты, дать упасть
  const nM = jparse(await evR(`(() => { const g = window.__game;
    for (let i = 0; i < g.player.visual.masts.length; i++) g.player.breakMast(i);
    g.stepDebugNR(5); return g.player.visual.masts.length; })()`));
  await sleep(400);
  run(`screenshot scripts/shots/t79_${id}_wreck.png`);
  // телеметрия: что осталось видно из парусов/рангоута
  info[id] = jparse(await evR(`(() => { const g = window.__game;
    const v = g.player.visual;
    const sails = v.sails.sails.map(s => ({
      square: s.square, mast: s.mastIndex,
      braceVisible: s.brace ? s.brace.visible && !!s.brace.parent : null,
      braceY: s.brace ? +s.brace.position.y.toFixed(2) : null,
      meshParent: s.mesh.parent ? s.mesh.parent.name || (s.mesh.parent.userData ? 'seg' : '?') : null,
      meshInScene: (() => { let o = s.mesh; while (o) { if (o === v.group) return true; o = o.parent; } return false; })(),
      furl: +s.furl.toFixed(2),
      belly: s.mat.uniforms.uBelly ? +s.mat.uniforms.uBelly.value.toFixed(2) : null,
    }));
    const masts = v.masts.map((m, i) => ({
      fall: g.player.mastFall[i],
      rotX: +m.rotation.x.toFixed(2), rotZ: +m.rotation.z.toFixed(2),
      segs: (m.userData.segments || []).map(s => !!s.parent),
    }));
    return JSON.stringify({ mastsN: v.masts.length, masts, sails }); })()`));
  console.log(`${id}: masts=${nM} ` + JSON.stringify(info[id]).slice(0, 600));
}
console.log('DONE');
runRaw('close');
