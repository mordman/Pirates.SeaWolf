// E2E v27b: дым (фикс + настройки) и погода (дождь/гроза/туман, ветер→волны).
// Фазы A/B/C/D/E — запускать по одной: node e2e_v27b.mjs A (SwiftShader fps
// деградирует со временем, каждая фаза — свежая страница).
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
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

/** Задать погоду/дым в localStorage ДО старта игры (patchSrc — JS над объектом s) */
async function bootWith(patchSrc, waitMs = 9000, menuBtn = 'Поднять флаг') {
  run('open http://localhost:3000/');
  await sleep(1500);
  ev(`(() => {
    const raw = localStorage.getItem('seawolves.settings.v1');
    let s = raw ? JSON.parse(raw) : {};
    ${patchSrc}
    localStorage.setItem('seawolves.settings.v1', JSON.stringify(s));
    return 'ls ok';
  })()`);
  run('reload');
  await sleep(8000);
  run(`find text "${menuBtn}" click`);
  await sleep(waitMs);
  run('errors --clear'); run('console --clear');
  return sea();
}

const setFx = (fxSrc) => ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  ${fxSrc}
  g.applySettings(s);
  return 'fx ok';
})()`);

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    const r = num('window.__game.combat.readiness()');
    if (r >= 0.999) return true;
    await sleep(1500);
  }
  return false;
}
async function volley() {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))"`);
  await sleep(250);
  run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))"`);
}

async function phaseA() {
  console.log('=== ФАЗА A: дым по умолчанию + настройки ===');
  let s = await bootWith(`
    s.weather = { mode: 'clear', windSpeed: 7.5, windDir: 40 };
    s.fx = { smokeVisible: true, smokeSize: 1, smokeDensity: 1, smokeTransparency: 0.45 };`, 7000);
  check('A: игра запущена, ясно', s.weather.mode === 'clear');
  ev(`(() => { const a = window.__game.combat.aim; a.active = true; a.side = 1; a.azimuth = 0; a.elevation = 0.04; return 'aim'; })()`);
  await waitReady();
  await volley();
  await sleep(600);
  shot('v27_volley_flash');
  await sleep(2200);
  shot('v27_volley_smoke');
  await sleep(4000);
  shot('v27_volley_late');

  setFx(`s.fx.smokeDensity = 0;`);
  await waitReady();
  await volley();
  await sleep(1000);
  shot('v27_volley_nodensity');

  setFx(`s.fx.smokeDensity = 1.6; s.fx.smokeTransparency = 0.9; s.fx.smokeSize = 0.4;`);
  await waitReady();
  await volley();
  await sleep(1200);
  shot('v27_volley_transparent');

  setFx(`s.fx.smokeDensity = 1.6; s.fx.smokeTransparency = 0.1; s.fx.smokeSize = 2.0;`);
  await waitReady();
  await volley();
  await sleep(1200);
  shot('v27_volley_dense');
}

async function phaseB() {
  console.log('=== ФАЗА B: гроза ===');
  let s = await bootWith(`s.weather = { mode: 'storm', windSpeed: 19, windDir: 220 };`, 10000);
  check('B: режим storm', s.weather.mode === 'storm');
  check('B: дождь льёт', s.weather.rain > 450, `rain=${s.weather?.rain}`);
  check('B: ветер ~19+', s.wind > 15, `wind=${s.wind?.toFixed(1)}`);
  check('B: облака плотные', s.weather.cloud > 0.6, `cloud=${s.weather?.cloud}`);
  check('B: солнце приглушено', s.weather.sunDim < 0.8, `sunDim=${s.weather?.sunDim}`);
  shot('v27_storm_rain');
  let gotFlash = false;
  const fl0 = s.weather.flashes;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const w = sea().weather;
    if (w.flash > 0.05 || w.flashes > fl0) {
      gotFlash = true;
      shot('v27_storm_flash');
      break;
    }
  }
  check('B: молнии бьют', gotFlash || sea().weather.flashes > fl0, `flashes=${sea().weather.flashes}`);
  s = sea();
  check('B: волны от ветра поднялись', s.seaAmp > 1.05, `seaAmp=${s.seaAmp?.toFixed(2)}`);
  shot('v27_storm_sea');
}

async function phaseC() {
  console.log('=== ФАЗА C: туман ===');
  const s = await bootWith(`s.weather = { mode: 'fog', windSpeed: 3, windDir: 90 };`, 10000);
  check('C: режим fog', s.weather.mode === 'fog');
  check('C: туман плотный', s.weather.fogMul > 2.2, `fogMul=${s.weather?.fogMul}`);
  check('C: дождя нет', s.weather.rain < 50, `rain=${s.weather?.rain}`);
  check('C: ветер слаб', s.wind < 6, `wind=${s.wind?.toFixed(1)}`);
  shot('v27_fog');
  shot('v27_fog_far');
}

/** Ждать выполнения условия (поллинг телеметрии — headless время растянуто) */
async function waitFor(js, cond, timeoutMs = 60000) {
  const t0 = Date.now();
  let v = num(js);
  while (Date.now() - t0 < timeoutMs && !cond(v)) {
    await sleep(2000);
    v = num(js);
  }
  return v;
}

async function phaseD() {
  console.log('=== ФАЗА D: ветер → волны ===');
  // лёгкий пресет — держать fps в headless
  let s = await bootWith(`
    s.weather = { mode: 'clear', windSpeed: 22, windDir: 40 };
    s.graphics = { preset: 'low', drawDistance: 2600, waterDetail: 96, waterChunkSize: 800, waterLodStep: 2, shadows: false, shadowRes: 1024, pixelRatio: 1, foamQuality: 0, waveHeight: 1.3, detailLod: 150 };`, 8000);
  const w1 = await waitFor('window.__sea.wind', v => v > 18, 60000);
  check('D: ветер ~22', w1 > 18, `wind=${w1?.toFixed(1)} fps=${sea().fps?.toFixed(1)}`);
  const ampFresh = await waitFor('window.__sea.seaAmp', v => v > 1.15, 90000);
  check('D: волны при 22 м/с высокие', ampFresh > 1.15, `seaAmp=${ampFresh?.toFixed(2)}`);
  shot('v27_fresh_sea');
  ev(`window.__game.debugSetWeather('clear', 1, 40)`);
  const w2 = await waitFor('window.__sea.wind', v => v < 5, 120000);
  check('D: ветер упал до ~1', w2 < 5, `wind=${w2?.toFixed(1)}`);
  const ampCalm = await waitFor('window.__sea.seaAmp', v => v < 0.6, 120000);
  check('D: волны спали', ampCalm < 0.65, `seaAmp=${ampCalm?.toFixed(2)} (было ${ampFresh?.toFixed(2)})`);
  shot('v27_calm_sea');
}

async function phaseE() {
  console.log('=== ФАЗА E: полигон — чистое море даже при грозе ===');
  await bootWith(`s.weather = { mode: 'storm', windSpeed: 19, windDir: 220 };`, 9000, 'Полигон разрушений');
  await sleep(8000);
  const s = sea();
  check('E: полигон активен', s.proving === 1);
  check('E: дождь на полигоне стихает', s.weather.rain < 600, `rain=${s.weather?.rain}`);
  check('E: море спокойное', s.seaAmp < 0.55, `seaAmp=${s.seaAmp?.toFixed(2)}`);
  check('E: ветер штиль', s.wind < 6, `wind=${s.wind?.toFixed(1)}`);
  shot('v27_proving_calm');
  const errs = run('errors');
  check('E: ошибок страницы нет', !errs || errs.length < 5, errs.slice(0, 120));
}

run('set viewport 1280 800');
const PHASES = (process.argv[2] || 'ABCDE').toUpperCase().split('');
if (PHASES.includes('A')) await phaseA();
if (PHASES.includes('B')) await phaseB();
if (PHASES.includes('C')) await phaseC();
if (PHASES.includes('D')) await phaseD();
if (PHASES.includes('E')) await phaseE();
console.log(fails === 0 ? 'ALL OK' : `FAILS: ${fails}`);
