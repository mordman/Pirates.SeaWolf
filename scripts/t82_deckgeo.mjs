// Task 82: числовая проверка геометрии настила: выступают ли концы
// палубных досок за наружную грань бортовых поясов (по записям
// PlankSystem и hullHalfWidthAt). Запуск: node scripts/t82_deckgeo.mjs
// (после t82_check — страница открыта)
import { execSync } from 'node:child_process';
const run = (args) => { try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); } catch (e) { return `ERR ${e.stdout || ''} ${e.stderr || ''}`; } };
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const res = ev(`(() => { const g = window.__game; const ps = g.player.visual.planks; const P = g.player.preset;
  const V = g.player.position.constructor;
  const out = { quarter: !!P.quarter, tags: {} };
  const hwAt = (t, y) => { const m = g.player.visual.group.getObjectByName('Planks_Port'); return null; };
  for (const r of ps.records) {
    if (r.cls !== 1) continue;
    const tag = r.id.split('_')[1][0];
    const o = out.tags[tag] || (out.tags[tag] = { n: 0, xmin: 1e9, xmax: -1e9, ymin: 1e9, ymax: -1e9, zmin: 1e9, zmax: -1e9 });
    o.n++; o.xmin = Math.min(o.xmin, r.x - r.w / 2); o.xmax = Math.max(o.xmax, r.x + r.w / 2);
    o.ymin = Math.min(o.ymin, r.y); o.ymax = Math.max(o.ymax, r.y); o.zmin = Math.min(o.zmin, r.z - r.len / 2); o.zmax = Math.max(o.zmax, r.z + r.len / 2);
  }
  // вершины настила: максимум |x| среди вершин Planks_Deck (реальная геометрия)
  const deck = g.player.visual.group.getObjectByName('Planks_Deck').geometry.attributes.position;
  let dx = 0, dy0 = 1e9, dy1 = -1e9; const byZ = {};
  for (let i = 0; i < deck.count; i++) { const x = Math.abs(deck.getX(i)), y = deck.getY(i), z = deck.getZ(i);
    if (x > dx) dx = x; if (y < dy0) dy0 = y; if (y > dy1) dy1 = y;
    const k = Math.round(z / 2) * 2; const b = byZ[k] || (byZ[k] = { x: 0, y0: 1e9, y1: -1e9 }); if (x > b.x) b.x = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
  out.deckX = +dx.toFixed(3); out.deckY = [+dy0.toFixed(3), +dy1.toFixed(3)];
  out.byZ = Object.fromEntries(Object.entries(byZ).sort((a, b) => a[0] - b[0]).map(([k, b]) => [k, [+b.x.toFixed(2), +b.y0.toFixed(2), +b.y1.toFixed(2)]]));
  // вершины бортовых поясов: наружная грань (max x) по диапазонам z/y
  const side = g.player.visual.group.getObjectByName('Planks_Port').geometry.attributes.position;
  const cell = {};
  for (let i = 0; i < side.count; i++) { const x = side.getX(i), y = side.getY(i), z = side.getZ(i);
    const k = Math.round(z / 2) * 2 + '/' + Math.round(y * 2) / 2; const c = cell[k] || (cell[k] = -1e9); if (x > c) cell[k] = x; }
  out.sideX = Object.fromEntries(Object.entries(cell).sort().map(([k, v]) => [k, +v.toFixed(2)]));
  out.P = { length: P.length, beam: P.beam, freeboard: P.freeboard, draft: P.draft };
  return JSON.stringify(out); })()`);
console.log(String(res).replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/,/g, ', ').slice(0, 6000));
