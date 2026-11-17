import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 420000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
runRaw('close'); runRaw('open http://localhost:3000') === 'ERR' && 0;
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`); await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
let out = ev(`(() => JSON.stringify(window.__game.debugDeadRigAudit()))()`);
for (let i = 0; i < 4 && out.includes('Evaluation error'); i++) { await sleep(4000); out = ev(`(() => JSON.stringify(window.__game.debugDeadRigAudit()))()`); }
console.log(out.slice(0, 1200));
runRaw('close');
