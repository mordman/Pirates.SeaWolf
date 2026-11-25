// Task 82: числовая проверка, что шейдер древесины реально работает
// (в этой сессии картинки смотрит VLM, поэтому — «отладочная краска»):
//  1) снимок с обычным материалом;
//  2) uWoodOn = 0 (эффект выключен той же программой);
//  3) вельс = ярко-зелёный, пояс у планширя = чистый синий, ватерлиния
//     поднята на +1 м (проверка положения поясов).
// Дальше scripts/t82_probe1.py считает пиксели.
// Запуск: node scripts/t82_probe1.mjs   (после t82_shots — страница открыта)
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = '/home/z/my-project/scripts/shots/t82_probe';
mkdirSync(out, { recursive: true });
const run = (args) => { try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); } catch (e) { return `ERR ${e.stdout || ''} ${e.stderr || ''}`; } };
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// тот же вид «с борта», что в t82_shots (риг подменён — иначе игровой
// цикл возвращает камеру на изометрию после каждого eval)
ev(`(() => { const g = window.__game; g.paused = true; g.rig.update = () => {}; return 1; })()`);
const info = ev(`(() => { const g = window.__game; return g.player.preset.id + ':' + g.player.preset.length; })()`);
console.log('ship', info);
const L = parseFloat((String(info).match(/:([\d.]+)$/) || [])[1] || '28');
const look = (ch, lh) => ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  const sp = g.player.position.clone().add(g.shift);
  const f = grp.getWorldDirection(sp.clone()); const p = sp.clone().set(f.z, 0, -f.x);
  c.position.copy(sp).addScaledVector(p, ${-0.74 * L}); c.position.y += ${0.10 * L};
  const lk = sp.clone(); lk.y += ${lh}; c.lookAt(lk); c.updateMatrixWorld(); return 'ok'; })()`);

const st = ev(`(() => { const g = window.__game; const m = g.player.visual.planks.mat;
  const u = m.userData.t82; const pr = g.renderer.info.programs.map(p => p.name + '|' + p.cacheKey.slice(-24));
  return JSON.stringify({ hasT82: !!u, on: u && u.uWoodOn.value, wale0: u && u.uWale0.value, wale1: u && u.uWale1.value,
    rail0: u && u.uRail0.value, rail1: u && u.uRail1.value, ports: u && u.uPortN.value,
    defines: JSON.stringify(m.defines), ver: 'ok',
    prog: pr.filter(s => /t82/.test(s)), n: g.player.visual.planks.records.length,
    attrs: Object.keys(g.player.visual.group.getObjectByName('Planks_Port').geometry.attributes).join(','),
    hullCol: '#' + u.uHullCol.value.getHexString(), deckCol: '#' + u.uDeckCol.value.getHexString() }); })()`);
console.log('state', st);

look(0.27 * L);
await sleep(1200);
run(`screenshot ${out}/on.png`);
ev(`(() => { const u = window.__game.player.visual.planks.mat.userData.t82; u.uWoodOn.value = 0; return 1; })()`);
await sleep(1200);
run(`screenshot ${out}/off.png`);
ev(`(() => { const u = window.__game.player.visual.planks.mat.userData.t82; u.uWoodOn.value = 1;
  u.uWaleCol.value.setHex(0x00ff00); u.uRail0.value = u.uRail1.value - 0.05; u.uWaterY.value = 1.0;
  u.uHullCol.value.setRGB(0.2, 0.2, 0.2); u.uDeckCol.value.setRGB(0.2, 0.2, 0.2); return 1; })()`);
await sleep(1200);
run(`screenshot ${out}/paint.png`);
// вид «вплотную к борту» (6.7 м): один пояс ≈ 54 px
ev(`(() => { const g = window.__game, c = g.rig.camera, grp = g.player.visual.group;
  const sp = g.player.position.clone().add(g.shift);
  const f = grp.getWorldDirection(sp.clone()); const p = sp.clone().set(f.z, 0, -f.x);
  c.position.copy(sp).addScaledVector(f, 2).addScaledVector(p, -6.5); c.position.y += 1.5;
  const lk = sp.clone().addScaledVector(f, 1); lk.y += 1.3; c.lookAt(lk); c.updateMatrixWorld(); return 'ok'; })()`);
await sleep(1200);
run(`screenshot ${out}/close_on.png`);
ev(`(() => { const u = window.__game.player.visual.planks.mat.userData.t82; u.uWoodOn.value = 0; return 1; })()`);
await sleep(1200);
run(`screenshot ${out}/close_off.png`);
ev(`(() => { const u = window.__game.player.visual.planks.mat.userData.t82; u.uWoodOn.value = 1;
  u.uWaleCol.value.setHex(0x00ff00); u.uRail0.value = u.uRail1.value - 0.05; u.uWaterY.value = 1.0; return 1; })()`);
await sleep(1200);
run(`screenshot ${out}/close_paint.png`);
ev(`(() => { const u = window.__game.player.visual.planks.mat.userData.t82; u.uWaleCol.value.setHex(0x2e2013);
  u.uRail0.value = 1.63; u.uWaterY.value = 0.02; return 1; })()`);
console.log('done', out);
