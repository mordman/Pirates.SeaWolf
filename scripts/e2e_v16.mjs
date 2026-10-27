// E2E v16: финальная регрессия — реальные клавиши, применение настроек, инверсия руля
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const key = (code, ms = 300) => {
  run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))"`);
  return sleep(ms);
};

console.log('=== Старт и разгон реальными клавишами ===');
run('reload'); run('wait 7000');
run("find text \"Поднять флаг\" click");
run('wait 2000');
await key('KeyW'); await key('KeyW'); await key('KeyW'); // уровень 3
// разгон через паузу не нужен: подождём реального времени
await sleep(15000);
const s1 = ev(`JSON.stringify({kn:+window.__sea.speed.toFixed(1), lvl:window.__sea.sailLevel, set:window.__sea.sailSet, furl:+window.__sea.furlAvg.toFixed(2)})`);
console.log('после W×3 (15 c):', s1);

console.log('=== Руль реальной клавишей D (удержание) ===');
const h0 = JSON.parse(ev(`JSON.stringify({h:+window.__sea.heading.toFixed(3)})`)).h;
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}))"`);
await sleep(8000);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'}))"`);
const seaD = ev(`JSON.stringify({h:+window.__sea.heading.toFixed(3), rud:+window.__sea.rudder.toFixed(2)})`);
const h1 = JSON.parse(seaD).h;
const cmpDelta = Math.round((( (-(h1-h0)*180/Math.PI) %360 +360)%360 +180)%360 -180);
console.log('после D:', seaD, '| компас изменился на', cmpDelta, 'град (плюс = вправо)');

console.log('=== Настройки на лету: инверсия руля ===');
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.controls.invertRudder = true; g.applySettings(s); return 'ok'; })()`);
const h2 = JSON.parse(ev(`JSON.stringify({h:+window.__sea.heading.toFixed(3)})`)).h;
run(`eval "window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}))"`);
await sleep(6000);
run(`eval "window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'}))"`);
const h3 = JSON.parse(ev(`JSON.stringify({h:+window.__sea.heading.toFixed(3)})`)).h;
const cmpDeltaInv = Math.round((( (-(h3-h2)*180/Math.PI) %360 +360)%360 +180)%360 -180);
console.log('после D с инверсией: компас', cmpDeltaInv, 'град (минус = влево ✓)');
// вернуть настройки
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.controls.invertRudder = false; g.applySettings(s); localStorage.removeItem('seawolves.settings.v1'); return 'ok'; })()`);

console.log('=== Настройки на лету: дальность прорисовки ===');
const farBefore = ev(`window.__game.rig.camera.far`);
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.graphics.drawDistance = 7800; g.applySettings(s); return 'ok'; })()`);
const farAfter = ev(`window.__game.rig.camera.far`);
console.log('camera.far:', farBefore, '->', farAfter);

console.log('=== Паруса: уровень 1 (реальная клавиша S) ===');
await key('KeyS'); await key('KeyS'); // 3 -> 1
await sleep(9000);
console.log('после S×2:', ev(`JSON.stringify({kn:+window.__sea.speed.toFixed(1), lvl:window.__sea.sailLevel, set:window.__sea.sailSet, furl:+window.__sea.furlAvg.toFixed(2)})`));

console.log('=== Ошибки консоли ===');
const errs = run('errors');
console.log(errs === '' || errs === '[]' ? 'НЕТ ОШИБОК' : errs);
