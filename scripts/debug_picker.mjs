// Отладка: почему пикер верфи не открылся во второй раз в e2e_v30 фазе C
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 90000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const shot = (n) => run(`screenshot /home/z/my-project/scripts/shots/${n}.png`);
const clickBtn = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}')); if (b) { b.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
const log = console.log;

run('open http://localhost:3000/'); await sleep(2000);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload'); await sleep(8000);
log('start:', clickBtn('Поднять флаг'));
await sleep(2500);
log('dock:', ev(`(() => { const g = window.__game; g.player.velocity.set(0,0,0); g.docked = true; g.player.anchored = true; return 'docked'; })()`));
await sleep(600);
log('picker1:', clickBtn('Сменить корабль'));
await sleep(600);
log('merchant tab:', clickBtn('Торговые'));
await sleep(500);
log('amsterdam:', clickBtn('Amsterdam'));
await sleep(1500);
log('state:', ev(`(() => { const g = window.__game; return JSON.stringify({id: g.player.preset.id, docked: g.docked, anchored: g.player.anchored, sail: g.player.sailTarget}); })()`));
// паруса + карта + телепорт (как в e2e)
run('press w'); await sleep(300); run('press w'); await sleep(300); run('press w');
await sleep(4000);
log('map:', run('press Tab'));
await sleep(900);
log('mapclick:', ev(`(() => { const canvases = document.querySelectorAll('canvas'); let map = null; for (const c of canvases) { if (c.width === 640 && c.height === 520) map = c; } if (!map) return 'no map canvas'; const r = map.getBoundingClientRect(); const mx = r.left + (320 + 250 * 0.055) * (r.width / 640); const my = r.top + (260 - 1400 * 0.055) * (r.height / 520); map.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: mx, clientY: my})); return 'clicked'; })()`));
await sleep(1800);
log('pos:', ev(`(() => { const s = window.__sea; return JSON.stringify({x: +s.x.toFixed(0), z: +s.z.toFixed(0), spd: +s.speed.toFixed(1)}); })()`));
log('mapOpen-check:', ev(`(() => { const canvases = document.querySelectorAll('canvas'); let map = null; for (const c of canvases) { if (c.width === 640 && c.height === 520) map = c; } return map ? 'MAP STILL OPEN' : 'map closed'; })()`));
// вторая попытка пикера
log('dock2:', ev(`(() => { const g = window.__game; g.docked = true; return 'docked2'; })()`));
await sleep(600);
log('visible modal:', ev(`(() => { const t = document.body.textContent; return JSON.stringify({port: t.includes('Пальмовая гавань'), smenit: t.includes('Сменить корабль'), shvartovy: t.includes('Отдать швартовы')}); })()`));
log('picker2:', clickBtn('Сменить корабль'));
await sleep(600);
log('war tab:', clickBtn('Военные'));
await sleep(400);
log('galley:', clickBtn('Капудана'));
await sleep(1600);
log('final:', ev(`(() => { const g = window.__game; return JSON.stringify({id: g.player.preset.id, oars: g.player.preset.oars}); })()`));
shot('v30_debug_galley');
log('errors:', run('errors').slice(0, 300));
