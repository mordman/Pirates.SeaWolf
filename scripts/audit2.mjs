import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 420000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const run = (a, t = 6) => { let o = runRaw(a); for (let i = 0; i < t && (!o.trim() || o.includes('temporarily unavailable') || o.includes('timed out') || o.includes('Failed to read') || o.includes('page_wedged')); i++) { execSync('sleep 15'); o = runRaw(a); } return o; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\*.*?\*\//g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
const out = ev(`JSON.stringify(window.__game.debugPlankSailAudit().filter(r => r.planksMax > 0.02 || r.smoothMax > 0.02))`);
console.log('AUDIT2: ' + out);
runRaw('close');
