// отладка: точный вызов v60 ev() для A1 — печатает команду и результат
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const src = readFileSync('scripts/e2e_v60.mjs', 'utf8');
const i0 = src.indexOf('const lodFar = jparse(await evR(`');
const i1 = src.indexOf('`))', i0);
const js = src.slice(i0 + 'const lodFar = jparse(await evR(`'.length, i1);

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// ТОЧНАЯ копия ev() из v60
const ev = (j) => runRaw(`eval "${j.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

const cmdJs = js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ');
console.log('=== COMMAND (first 400):');
console.log(`eval "${cmdJs.slice(0, 400)}`);
console.log('=== length:', cmdJs.length);
const out = ev(js);
console.log('=== RESULT:', out.slice(0, 400));
// есть ли опасные для sh символы
for (const ch of ['`', '$', '!', '\\']) {
  const n = cmdJs.split(ch).length - 1;
  if (n > 0) console.log(`символ ${JSON.stringify(ch)}: ${n} шт`);
}
