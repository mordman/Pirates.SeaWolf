// Task 29: скриншоты штормового модуля с полднём и выдержкой камеры
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/?t=' + Date.now());
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
log('старт:', clickBtn('Поднять флаг'));
await sleep(1500);

// включить штормовой модуль + крепкий ветер (18 м/с) + полдень
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.weather.seaModel = 'storm';
  s.weather.windSpeed = 18;
  g.applySettings(s);
  g.weather.wind.speed = 18; g.weather.windBase = 18;
  g.wind.speed = 18;
  g.sea.setWind(g.wind.speed / 24);
  g.sky.timeOfDay = 0.5;    // полдень (0=полночь, 0.5=полдень)
  return 'ok';
})()`);
log('ждём волн и качку (реальные кадры)...');
await sleep(14000);
shot('t29_v2_storm_day');
log('снят t29_v2_storm_day');
await sleep(800);

// шлюпка: спуск прокруткой, затем реальное время — камера догоняет
ev(`(() => {
  const g = window.__game;
  const bl = g.boatLaunch;
  const err = bl.tryLaunch(false);
  if (err) return err;
  const dt = 1 / 60;
  for (let i = 0; i < 560; i++) bl.update(dt, g.time + i * dt);
  return bl.phase;
})()`);
log('шлюпка afloat, ждём камеру...');
await sleep(9000);
shot('t29_v2_boat');
log('снят t29_v2_boat');

// крупный план волн у корабля (шторм, день) для контроля пены
await sleep(6000);
shot('t29_v2_waves');
log('снят t29_v2_waves');

const errs = ev(`window.__jsErrors || 0`);
log('ошибки JS:', errs);
run('close --all');
process.exit(0);
