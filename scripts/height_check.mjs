import { execSync } from 'node:child_process';
const runRaw = (a) => { try { return execSync(`agent-browser ${a}`, { encoding: 'utf8', timeout: 420000 }).trim(); } catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => runRaw(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
runRaw('close'); runRaw('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) { if (ev(`!!window.__game`).includes('true')) break; await sleep(2500); }
ev(`window.__game.start()`); await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(1200);
let out = ev(`(() => {
  const g = window.__game;
  const res = [];
  for (const id of ['sloop', 'frigate', 'galleon', 'victory']) {
    g.changeShip(id, true);
    g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(2.5);
    const P = g.player.preset, L = P.length;
    const jibs = g.player.visual.sails.sails.filter(s => !s.square);
    const figTop = P.freeboard * 1.02
      + Math.min(1.25, Math.max(0.55, P.freeboard * 0.26)) * Math.min(1.6, Math.max(0.8, P.freeboard * 0.30)) * 2.1;
    const stemTop = P.freeboard * 1.17 * 0.9;
    const beltTop = P.freeboard * 0.885 - 0.10;   // пояс борта (мидель)
    const info = jibs.map(j => {
      const pv = j.quad.pivot, c = j.quad.corners;
      const a = { x: -c[1].z, y: c[1].y }, b = { x: -c[2].z, y: c[2].y };
      // нижняя кромка (u=1): от такелажа к шкоту; минимальная высота
      let minY = 1e9, minYBow = 1e9, minZ = 1e9, maxZ = -1e9;
      for (let k = 0; k <= 40; k++) {
        const v = k / 40;
        const ly = a.y * (1 - v) + b.y * v, lx = a.x * (1 - v) + b.x * v;
        const y = pv.y + ly, z = pv.z - lx;
        minY = Math.min(minY, y);
        if (z > L / 2 - 2 && z < L / 2 + 4) minYBow = Math.min(minYBow, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      return { footMinY: +minY.toFixed(2), footBowY: +minYBow.toFixed(2), footZ: [ +minZ.toFixed(1), +maxZ.toFixed(1) ], belly: +j.mat.uniforms.uBelly.value.toFixed(2) };
    });
    res.push({ id, L: L, stem: L / 2, figTop: +figTop.toFixed(2), stemTop: +stemTop.toFixed(2), beltTop: +beltTop.toFixed(2), jibs: info });
  }
  return JSON.stringify(res); })()`);
console.log(out.slice(0, 1600));
runRaw('close');
