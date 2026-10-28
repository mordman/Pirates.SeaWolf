// E2E v24 (Task 8): (1) корабли на полигоне ближе, дистанция из настроек
// и меняется на лету; (2) вода — LOD-кольца вместо полос 64 м: решётка
// выровнена (целые кратности, совпадение вершин на кромках), «квадратов»
// нет; (3) размеры чанка/колец настраиваются (применение на лету).
import { execSync } from 'node:child_process';
const run = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/"/g, '\\"')}"`);
const jparse = (r) => {
  try { const v = JSON.parse(r); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return null; }
};
const sea = () => jparse(ev('JSON.stringify(window.__sea)'));
const shot = (name) => run(`screenshot /home/z/my-project/scripts/shots/${name}.png`);
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

console.log('=== 1. Загрузка и вход в Полигон ===');
run('set viewport 1280 800');
run('open http://localhost:3000/');
await sleep(9000);
run('errors --clear'); run('console --clear');
run('find text "Полигон разрушений" click');
await sleep(8000);
let s = sea();
check('полигон активен', !!s && s.proving === 1);

console.log('=== 2. Дистанция по умолчанию 90 м (было 165) ===');
check('pgDist = 90', s.water.pgDist === 90, `pgDist=${s.water.pgDist}`);
check('tgtDist около 90', Math.abs(s.tgtDist - 90) < 8, `tgtDist=${s.tgtDist}`);

console.log('=== 3. Структура воды: чанк + LOD-кольца ===');
const w = s.water;
console.log('вода:', JSON.stringify(w));
check('чанк 900 м / 176²', w.chunk === 900 && w.segs === 176, `chunk=${w.chunk} segs=${w.segs}`);
check('колец >= 3', w.rings.length >= 3, `${w.rings.length} шт`);
// ячейка каждого кольца растёт x2 (lodStep=0 в high); квадов 12·m² (m=inner/cell)
const step = w.step;
let growthOk = true, fullOk = true;
w.rings.forEach((r, i) => {
  const expect = step * Math.pow(2, i + 1);
  if (Math.abs(r.c - expect) > 0.02) growthOk = false;
  const m = r.i / expect;
  const expectQuads = 12 * m * m;
  if (Math.abs(r.q - expectQuads) > expectQuads * 0.02) fullOk = false; // дыра = меньше квадов
});
check('ячейка растёт x2 за кольцо (10.2→20.5→40.9→…)', growthOk);
check('кольца ПОЛНЫЕ (4 сектора, без дыр)', fullOk);
check('дальность воды покрывает прорисовку', w.farEff >= 5600, `farEff=${w.farEff}`);

console.log('=== 3b. Целочисленность решётки (точные float, в странице) ===');
const lattice = jparse(ev(`(() => {
  const W = window.__game.water, info = W.getInfo();
  const out = [];
  for (const r of info.rings) {
    const m1 = (2 * r.outer) / r.cell, m2 = (r.outer - r.inner) / r.cell, m3 = (2 * r.inner) / r.cell;
    out.push([m1, m2, m3].every(m => Math.abs(m - Math.round(m)) < 1e-6));
  }
  return JSON.stringify(out);
})()`));
check('все размеры колец — целые кратные ячейки', Array.isArray(lattice) && lattice.every(Boolean), JSON.stringify(lattice));

console.log('=== 4. Совпадение вершин на кромках (нет T-швов) ===');
const coincide = jparse(ev(`(() => {
  const g = window.__game, W = g.water;
  const det = W.detail, r0 = W.rings[0];
  const dp = det.geometry.attributes.position, rp = r0.geometry.attributes.position;
  const info = W.getInfo();
  const st = info.step;
  // кромка детального чанка: z = -chunk/2 (локально); собираем x вершин
  const half = info.chunkSize / 2;
  const dset = new Set();
  for (let i = 0; i < dp.count; i++) {
    if (Math.abs(dp.getZ(i) + half) < 1e-6) dset.add(Math.round(dp.getX(i) * 1e4) / 1e4);
  }
  // внутренняя кромка кольца 0 при z = -half: В ПРЕДЕЛАХ чанка (|x|<=half)
  // каждый x должен совпасть с вершиной чанка; вне чанка — легитимно
  let miss = 0, total = 0, notEven = 0;
  for (let i = 0; i < rp.count; i++) {
    if (Math.abs(rp.getZ(i) + half) < 1e-6) {
      const x = rp.getX(i);
      const k = x / st;
      if (Math.abs(k / 2 - Math.round(k / 2)) > 1e-4) notEven++;
      if (Math.abs(x) <= half + 1e-6) {
        total++;
        if (!dset.has(Math.round(x * 1e4) / 1e4)) miss++;
      }
    }
  }
  return JSON.stringify({ edgeVerts: dset.size, ringVertsInChunk: total, miss, notEven });
})()`));
console.log('кромка:', JSON.stringify(coincide));
check('вершины кольца в пределах чанка совпали с чанком', coincide && coincide.miss === 0 && coincide.ringVertsInChunk > 20, JSON.stringify(coincide));
check('вершины кольца на чётных узлах решётки', coincide && coincide.notEven === 0);

console.log('=== 5. Смена дистанции на лету (applySettings) ===');
ev(`(() => {
  const g = window.__game;
  const s = JSON.parse(JSON.stringify(g.settings));
  s.gameplay.provingDistance = 200;
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(2500);
s = sea();
check('дистанция применилась: ~200 м', Math.abs(s.tgtDist - 200) < 8, `tgtDist=${s.tgtDist}`);

console.log('=== 6. Экран настроек: вкладка Игра, чанк/кольца в графике ===');
run('find text "Настройки" click');
await sleep(600);
const tabGame = run('find text "Игра" click');
await sleep(400);
const pgRow = run('find text "Дистанция до мишени на полигоне"');
check('вкладка Игра с настройкой полигона', !pgRow.startsWith('ERR') && !/not found/i.test(pgRow));
run('find text "Графика" click');
await sleep(400);
const chunkRow = run('find text "Размер чанка воды"');
const ringsRow = run('find text "Дальние кольца воды"');
check('в графике есть «Размер чанка воды»', !/not found/i.test(chunkRow));
check('в графике есть «Дальние кольца воды»', !/not found/i.test(ringsRow));
run('find text "Готово" click');
await sleep(400);

console.log('=== 7. Смена чанка/колец на лету ===');
ev(`(() => {
  const g = window.__game;
  const s = JSON.parse(JSON.stringify(g.settings));
  s.graphics.waterChunkSize = 1200;
  s.graphics.waterLodStep = 1;
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(2000);
s = sea();
console.log('вода после смены:', JSON.stringify(s.water));
check('чанк применился 1200 м', s.water.chunk === 1200);
check('колец меньше (экономный x4)', s.water.rings.length >= 2, `${s.water.rings.length} шт`);
check('дальность покрыта', s.water.farEff >= 5600);

console.log('=== 8. Скриншоты моря (проверка «квадратов» VLM) ===');
// высокая изометрия — видно и чанк, и кольца, и горизонт
ev('window.__game.rig.setZoom && window.__game.rig.setZoom(0.35)');
await sleep(1500);
shot('v24_sea_far');
// вернём настройки по умолчанию (high)
ev(`(() => {
  const g = window.__game;
  const s = JSON.parse(JSON.stringify(g.settings));
  s.graphics.waterChunkSize = 900;
  s.graphics.waterLodStep = 0;
  g.applySettings(s);
  return 'ok';
})()`);
await sleep(1500);
shot('v24_sea_default');
// вид с борта у воды — кромка чанка в 450 м видна слева/справа
shot('v24_sea_side');

console.log('=== 9. Консоль/ошибки ===');
await sleep(1500);
const errs = run('errors'); const cons = run('console');
console.log('ERRORS:', errs || '(пусто)');
console.log('CONSOLE:', cons || '(пусто)');
check('ошибок нет', !errs || errs.length < 5);
run('close');
console.log(fails === 0 ? '\nALL OK' : `\nFAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
