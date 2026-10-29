// E2E v17: регрессия шейдера воды — фикс зарезервированного слова `patch`
// (THREE.WebGLProgram: ERROR 'patch' Illegal use of reserved word).
// Проверяем: (1) нет ошибок компиляции шейдеров в консоли, (2) вода рендерится
// (телеметрия + скриншоты с пеной качества 2 и штормовыми волнами).
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);

console.log('=== Загрузка игры (пресет high, foamQuality 2) ===');
run('set viewport 1280 800');
run('reload'); await sleep(9000);
run("find text \"Поднять флаг\" click"); await sleep(3000);
run('errors --clear'); run('console --clear');

// немного подождать рендера воды + поднять ветер/волны для видимой пены
console.log('=== Волны/ветер повыше — пена должна читаться пятнами ===');
ev(`(() => { const g = window.__game; const s = structuredClone(g.settings); s.graphics.foamQuality = 2; s.graphics.waveHeight = 1.3; g.applySettings(s); return 'ok'; })()`);
await sleep(12000);

const errs = run('errors');
const shaderErr = /WebGLProgram|Shader Error|not compiled|reserved word/i;
console.log('Ошибки страницы:', errs === '' || errs === '[]' ? 'НЕТ' : errs);
if (shaderErr.test(errs)) console.log('!!! НАЙДЕНЫ ОШИБКИ ШЕЙДЕРА');

// кадры идут? вода под кораблём?
const sea = ev(`JSON.stringify({fps:window.__sea.fps, y:+window.__sea.y.toFixed(2), waterY:+window.__sea.waterY.toFixed(2)})`);
console.log('телеметрия:', sea);

await shot('v17_foam_iso');
// вид с борта на воду — пена гребней пятнами
ev(`(() => { const g = window.__game; g.rig.setMode('water'); return 'ok'; })()`);
await sleep(4000);
await shot('v17_foam_water');

console.log('=== Итог: ошибки шейдера', /WebGLProgram|Shader Error/i.test(errs) ? 'ЕСТЬ (FAIL)' : 'отсутствуют (OK)', '===');
