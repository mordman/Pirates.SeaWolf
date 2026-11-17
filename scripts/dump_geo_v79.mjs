// Task 79: дамп ТОЧНОГО геометрического состояния скриншотов —
// реальные uBelly в момент полного ветра, углы парусов, высоты
// дощатых поясов у носа, обвод у штевня.
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 420000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('Failed to read') || out.includes('page_wedged')); i++) {
    execSync('sleep 15');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const evR = async (js, tries = 5) => {
  let out = ev(js);
  for (let i = 0; i < tries && (out.includes('Evaluation error') || out.includes('Failed to read')
    || out.includes('Resource temporarily unavailable') || out.includes('page_wedged') || !out.trim()); i++) {
    await sleep(5000);
    out = ev(js);
  }
  return out;
};
const jparse = (raw) => {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};

runRaw('close');
run('open http://localhost:3000');
await sleep(9000);
for (let i = 0; i < 20; i++) {
  if (ev(`!!window.__game`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__game.start()`);
await sleep(2000);
ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()`);
ev(`window.__seaPatchSettings({ gameplay: { hullModel: 'planks' } })`);

for (const id of ['frigate', 'galley']) {
  ev(`window.__game.changeShip('${id}', true)`);
  await sleep(1000);
  ev(`(() => { const g = window.__game; g.player.wind.speed = 12.5; g.player.sailTarget = 3; g.stepDebugNR(4); return 1; })()`);
  await sleep(300);
  const res = jparse(await evR(`(() => {
    const g = window.__game, sh = g.player, P = sh.preset, v = sh.visual;
    const prof1 = (t) => { const pr = P && v; return null; };
    const sails = v.sails.sails.map(s => ({
      square: s.square, mast: s.mastIndex,
      furl: +s.furl.toFixed(2),
      belly: +s.mat.uniforms.uBelly.value.toFixed(2),
      flutter: +s.mat.uniforms.uFlutter.value.toFixed(3),
      brace: s.braceAngle !== undefined ? +s.braceAngle.toFixed(2) : null,
      pivot: s.quad.pivot.toArray().map(x => +x.toFixed(2)),
      corners: s.quad.corners.map(cn => cn.toArray().map(x => +x.toFixed(2))),
    }));
    // дощатые пояса у носа: максимальная ВЫСОТА боксов при z > 0.30L
    const recs = v.planks.records.filter(r => r.center.z > P.length * 0.30);
    let beltTopBow = 0, beltTopMaxZ = -99;
    for (const r of recs) {
      const top = r.center.y + r.w / 2;
      if (top > beltTopBow) { beltTopBow = top; beltTopMaxZ = r.center.z; }
    }
    return JSON.stringify({
      id, L: P.length, fb: P.freeboard, draft: P.draft,
      bulwarkBow: +hullProfile(1, P).bulwark.toFixed(2),
      bulwarkMid: +hullProfile(0.5, P).bulwark.toFixed(2),
      beltTopBowZ: +beltTopBow.toFixed(2), atZ: +beltTopMaxZ.toFixed(1),
      hwAtBowDeck: +hullHalfWidthAt(P, 0.95, bulwarkMidProbe()).toFixed(2),
      heading: +sh.heading.toFixed(2), windFrom: +sh.wind.from.toFixed(2), windSpd: sh.wind.speed,
      awa: +sh.apparentWindAngle().toFixed(2),
      masts: v.masts.map(m => ({ z: m.position.z, h: m.userData.height })),
      sails,
    }); })()`.replace('hullProfile(1, P)', 'g.__hullProfile(1, P)').replace('hullHalfWidthAt(P, 0.95, bulwarkMidProbe())', '0').replace('g.__hullProfile(0.5, P)', 'g.__hullProfile(0.5, P)')));
  // hullProfile недоступна снаружи — достанем через debug-хелпер, если есть
  console.log(id + ': ' + JSON.stringify(res).slice(0, 1400));
}
console.log('DONE');
runRaw('close');
