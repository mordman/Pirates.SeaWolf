// Проба: дифферент корабля на СТОЯНКЕ в штиле (жалоба «нос в воде»)
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 120000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (s) => {
  let v = s;
  for (let i = 0; i < 4; i++) {
    if (typeof v !== 'string') break;
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (b) { b.click(); return 'ok'; } return 'NOT FOUND';
})()`);

run('close --all');
run('open http://localhost:3000/');
await sleep(1500);
ev(`localStorage.removeItem('seawolves.settings.v1')`);
run('reload');
await sleep(9000);
clickBtn('Поднять флаг');
await sleep(2000);

// для каждой модели: штиль, якорь, 60 с покоя — меряем дифферент
for (const model of ['frigate', 'cog', 'sloop']) {
  const r = jparse(ev(`(() => {
    const g = window.__game;
    g.changeShip('${model}', true);
    const p = g.player;
    p.anchored = true; p.velocity.set(0,0,0); p.sailTarget = 0;
    p.quaternion.identity();
    const sea = window.__sea;
    // почти штиль
    g.setSeaAmpForTest ? g.setSeaAmpForTest(0.12) : null;
    // 60 с покоя мелкими шагами
    let t = g.time;
    for (let i = 0; i < 3600; i++) { t += 1/60; p.fixedStep(1/60, t); }
    const e = p.euler;
    // нос/корма: высота кромки палубы над водой
    const wh = (x, z, tt) => { return 0; }; // заглушка
    const bow = new (Object.getPrototypeOf(p.position).constructor)().set(0, p.preset.freeboard*0.82, p.preset.length*0.46)
      .applyQuaternion(p.quaternion).add(p.position);
    const stern = new (Object.getPrototypeOf(p.position).constructor)().set(0, p.preset.freeboard*0.82, -p.preset.length*0.46)
      .applyQuaternion(p.quaternion).add(p.position);
    const mid = new (Object.getPrototypeOf(p.position).constructor)().set(0, 0, 0)
      .applyQuaternion(p.quaternion).add(p.position);
    return JSON.stringify({
      model: '${model}',
      pitch: +e.x.toFixed(3), roll: +e.z.toFixed(3),
      pitchDeg: +(e.x * 57.3).toFixed(1),
      y: +p.position.y.toFixed(2),
      // нос/корма в мире
      bow: [ +bow.x.toFixed(1), +bow.y.toFixed(2), +bow.z.toFixed(1) ],
      stern: [ +stern.x.toFixed(1), +stern.y.toFixed(2), +stern.z.toFixed(1) ],
      L: p.preset.length, D: p.preset.draft, F: p.preset.freeboard,
    });
  })()`));
  console.log(model, JSON.stringify(r));
}
run('close --all');
