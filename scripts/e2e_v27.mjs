// E2E v27: дым (фикс чёрных пятен + настройки), погода (дождь/гроза/туман),
// ветер → волны. Проверки телеметрии + скриншоты для VLM.
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (r) => {
  try { const v = JSON.parse(r); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return null; }
};
const sea = () => jparse(ev('JSON.stringify(window.__sea)'));
const num = (js) => parseFloat(ev(js));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');

console.log('=== 1. Старт: ясно, дым по умолчанию ===');
run('find text "Поднять флаг" click');
await sleep(7000);
let s = sea();
check('игра запущена', !!s && s.fps > 0);
check('погода: ясно по умолчанию', s.weather.mode === 'clear', `mode=${s.weather?.mode}`);
check('дождя нет', s.weather.rain === 0);
check('туман базовый', s.weather.fogMul <= 1.05, `fogMul=${s.weather?.fogMul}`);

console.log('=== 2. Калибровочный клуб: светлый, исчезает ===');
ev(`(() => {
  const g = window.__game;
  const cam = g.rig.camera.position;
  const e = g.rig.camera.matrixWorld.elements;
  const dx=-e[8], dy=-e[9], dz=-e[10];
  const sh = g.worldGroup.position;
  g.particles.smoke(cam.x+dx*16-sh.x, cam.y+dy*16-sh.y+1, cam.z+dz*16-sh.z, 0,0.3,0, 1.6, 3.0);
  return 'ok';
})()`);
await sleep(500);
shot('v27_puff_alive');
await sleep(7000);  // клуб (3 с жизни) давно умер
shot('v27_puff_gone');
const blobCheck = jparse(ev(`(() => {
  const g = window.__game;
  // все частицы пула должны быть мертвы: drawRange покрывает, но life<=0
  let alive = 0;
  // проверить напрямую нельзя (приватно), вернём телеметрию
  return JSON.stringify({ ok: true });
})()`));

console.log('=== 3. Залп: дым светлый/компактный ===');
ev(`(() => { const a = window.__game.combat.aim; a.active = true; a.side = 1; a.azimuth = 0; a.elevation = 0.04; return 'aim'; })()`);
let ready = 0;
for (let i = 0; i < 40; i++) {
  ready = num('window.__game.combat.readiness()');
  if (ready >= 0.999) break;
  await sleep(1500);
}
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
await sleep(250);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
await sleep(600);
shot('v27_volley_flash');
await sleep(2200);
shot('v27_volley_smoke');
await sleep(4000);
shot('v27_volley_late');

console.log('=== 4. Настройки дыма: плотность 0 ===');
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.fx.smokeDensity = 0;
  g.applySettings(s);
  return 'density=0';
})()`);
for (let i = 0; i < 40; i++) {
  ready = num('window.__game.combat.readiness()');
  if (ready >= 0.999) break;
  await sleep(1500);
}
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
await sleep(250);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
await sleep(1000);
shot('v27_volley_nodensity');

console.log('=== 5. Настройки: прозрачность 90%, размер 0.4 ===');
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.fx.smokeDensity = 1.5;
  s.fx.smokeTransparency = 0.9;
  s.fx.smokeSize = 0.4;
  g.applySettings(s);
  return 'transparent';
})()`);
for (let i = 0; i < 40; i++) {
  ready = num('window.__game.combat.readiness()');
  if (ready >= 0.999) break;
  await sleep(1500);
}
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
await sleep(250);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
await sleep(1200);
shot('v27_volley_transparent');

// вернуть дефолт
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.fx.smokeDensity = 1; s.fx.smokeTransparency = 0.45; s.fx.smokeSize = 1;
  g.applySettings(s);
  return 'default';
})()`);

console.log('=== 6. Гроза: дождь, молнии, ветер, волны ===');
ev(`window.__game.debugSetWeather('storm', 19)`);
await sleep(6000);   // фронт набирает
s = sea();
check('гроза: режим', s.weather.mode === 'storm');
check('гроза: дождь набирает', s.weather.rain > 300, `rain=${s.weather?.rain}`);
check('гроза: ветер растёт', s.weather.windDir !== undefined && s.wind > 12, `wind=${s.wind?.toFixed(1)}`);
shot('v27_storm_rain');
// ждать молний
let flashes0 = s.weather.flashes;
let gotFlash = false;
for (let i = 0; i < 24; i++) {
  await sleep(1500);
  const w = sea().weather;
  if (w.flash > 0.05) { gotFlash = true; shot('v27_storm_flash'); break; }
  if (w.flashes > flashes0) { gotFlash = true; shot('v27_storm_flash'); break; }
}
check('гроза: молнии бьют', gotFlash, `flashes=${sea().weather.flashes}`);
s = sea();
check('гроза: волны от ветра', s.seaAmp > 1.0, `seaAmp=${s.seaAmp?.toFixed(2)} wind=${s.wind?.toFixed(1)}`);
shot('v27_storm_sea');
await sleep(1500);
shot('v27_storm_sea2');

console.log('=== 7. Туман ===');
ev(`window.__game.debugSetWeather('fog', 3)`);
await sleep(8000);
s = sea();
check('туман: режим', s.weather.mode === 'fog');
check('туман: плотность выросла', s.weather.fogMul > 2.5, `fogMul=${s.weather?.fogMul}`);
check('туман: дождь ушёл', s.weather.rain < 100, `rain=${s.weather?.rain}`);
shot('v27_fog');

console.log('=== 8. Ветер → волны: штиль vs свежий ===');
ev(`window.__game.debugSetWeather('clear', 1)`);
await sleep(9000);
s = sea();
const ampCalm = s.seaAmp;
check('штиль: волны малы', ampCalm < 0.55, `seaAmp=${ampCalm?.toFixed(2)} wind=${s.wind?.toFixed(1)}`);
shot('v27_calm_sea');
ev(`window.__game.debugSetWeather('clear', 22)`);
await sleep(12000);
s = sea();
check('свежий ветер: волны выросли', s.seaAmp > ampCalm + 0.35, `seaAmp=${s.seaAmp?.toFixed(2)} wind=${s.wind?.toFixed(1)}`);
check('свежий ветер: ветер ~22', s.wind > 18, `wind=${s.wind?.toFixed(1)}`);
shot('v27_fresh_sea');

console.log('=== 9. Ясно: всё чисто ===');
ev(`window.__game.debugSetWeather('clear', 7)`);
await sleep(6000);
s = sea();
check('ясно: дождя нет', s.weather.rain === 0, `rain=${s.weather?.rain}`);
check('ясно: туман базовый', s.weather.fogMul < 1.2, `fogMul=${s.weather?.fogMul}`);

console.log('=== 10. Ошибки консоли ===');
const errs = run('errors');
check('ошибок страницы нет', !errs || errs.length < 5, errs.slice(0, 120));

console.log(fails === 0 ? 'ALL OK' : `FAILS: ${fails}`);
