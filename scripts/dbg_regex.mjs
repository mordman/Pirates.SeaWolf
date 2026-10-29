// отладка: как execSync+agent-browser обрабатывает регэксп в eval
import { execSync } from 'node:child_process';
const ev = (js) => {
  try { return execSync(`agent-browser eval "${js.replace(/"/g, '\\"')}"`, { encoding: 'utf8', timeout: 60000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
// точь-в-точь как в e2e_v30
const js = `(() => { const btns = [...document.querySelectorAll('button')].filter(b => /\\d+ зол\\./.test(b.textContent)); return JSON.stringify(btns.length); })()`.replace(/\\\\/g, '\\');
console.log('JS  :', js);
console.log('RAW :', ev(js));
console.log('noRx:', ev(`(() => { return JSON.stringify(document.querySelectorAll('button').length); })()`));
console.log('sample:', ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('зол')); return b ? b.textContent.trim().slice(-24) : 'none'; })()`));
