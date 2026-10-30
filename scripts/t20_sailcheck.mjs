import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (s) => { let v = s; for (let i = 0; i < 4; i++) { if (typeof v !== 'string') break; try { v = JSON.parse(v); } catch { break; } } return v; };
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Поднять флаг')); if (b) b.click(); return 'start'; })()`);
await sleep(2000);
console.log('start:', JSON.stringify(jparse(ev(`(() => { const g = window.__game; return JSON.stringify({ anchored: g.player.anchored, docked: g.docked, wind: g.wind.speed, windDir: g.wind.from, heading: +g.player.heading.toFixed(2), sailTarget: g.player.sailTarget }); })()`))));
ev(`(() => { const g = window.__game; g.player.sailTarget = 3; return 'sail'; })()`);
await sleep(9500);
console.log('after 9s:', JSON.stringify(jparse(ev(`(() => { const s = window.__sea; const p = window.__game.player; return JSON.stringify({ speed: s.speed, setTot: s.setTot, sailFrac: p.sailFrac, wind: window.__game.wind.speed, anch: p.anchored }); })()`))));
