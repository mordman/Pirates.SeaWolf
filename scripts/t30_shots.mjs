// Task 30 (повтор), v3: скриншоты с принудительным рендером кадра
// (headless RAF душится — после установки камеры дергаем stepDebug,
// который в конце рендерит один свежий кадр)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 180000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
const log = (...a) => console.log(...a);
const key = (code, type = 'keydown') =>
  ev(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}' })); 'ok'`);
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

// полдень, лёгкий ветер
ev(`(() => {
  const g = window.__game;
  const s = structuredClone(g.settings);
  s.weather.windSpeed = 5;
  g.applySettings(s);
  g.sky.timeOfDay = 0.5;
  return 'ok';
})()`);

/** корабль у берега острова по азимуту th + камера с моря на остров */
const stageIsland = (islIdx, thDeg, offShore, elev, dist, extraStep = 1.5) => ev(`(() => {
  const g = window.__game;
  const w = g.world, isl = w.islands[${islIdx}];
  const th = ${thDeg} * Math.PI / 180;
  const ux = Math.cos(th), uz = Math.sin(th);
  let lo = 0, hi = isl.r * 2;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (window.__heightAt(isl.cx + ux * mid, isl.cz + uz * mid) > 0.3) lo = mid; else hi = mid;
  }
  const rCoast = (lo + hi) / 2;
  g.player.position.set(isl.cx + ux * (rCoast + ${offShore}), 0, isl.cz + uz * (rCoast + ${offShore}));
  g.player.velocity.set(0, 0, 0);
  g.player.heading = Math.atan2(-uz, -ux); // носом к острову
  g.rig.mode = 'free';
  g.rig.freeAzimSet(th);        // камера со стороны моря
  g.rig.freeElevSet(${elev});
  g.rig.distSet(${dist});
  g.rig.snap();
  g.stepDebug(${extraStep});     // прогнать немного И ДОЛЖНО ОТРЕНДЕРИТЬ кадр
  return 'staged';
})()`);

// 1) ПАЛЬМОВАЯ ГАВАНЬ: западный берег сверху-сбоку — форма
log('A:', stageIsland(0, 180, 95, 0.95, 70, 2.5));
shot('t30_coast_aerial');

// 2) ПЛЯЖ: пальмы GLB + пни/валуны
log('B:', stageIsland(0, 180, 30, 0.28, 26, 2.5));
shot('t30_beach_palms');

// 3) ЧАЙКИ: ждём сбора стаи (игровыми секундами), камера снизу-издалека
log('C:', stageIsland(0, 180, 110, 0.13, 62, 0.5));
for (let i = 0; i < 8; i++) {
  ev(`window.__game.stepDebug(30)`);
  const n = ev(`window.__sea.gulls.nearShip`);
  log(`t+${(i + 1) * 30}s чаек у судна:`, n);
  if (parseInt(n) >= 5) break;
}
ev(`(() => { const g = window.__game; g.rig.freeElevSet(0.13); g.rig.distSet(62); g.rig.freeAzimSet(Math.PI); g.rig.snap(); g.stepDebug(0.5); return 'ok'; })()`);
shot('t30_gulls_flight');

// 4) КАРТА: полигоны берегов
key('Tab');
await sleep(1300);
shot('t30_map_polygons');
key('Tab');

// 5) СКАЛА МОРЕНОГО ДЬЯВОЛА — коренастый скальный профиль
log('E:', stageIsland(2, 20, 120, 0.5, 66, 2.5));
shot('t30_rock_island');

log('ошибки JS:', ev('window.__jsErrors || 0'));
