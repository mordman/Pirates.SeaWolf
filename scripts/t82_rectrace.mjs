// Task 82: записи досок рядом с точкой (y, z) борта — разобраться,
// почему концы палубных досок видны снаружи. Запуск:
//   node scripts/t82_rectrace.mjs [y=1.338] [z=0.46]
import { execSync } from 'node:child_process';
const Y = Number(process.argv[2] || 1.338), Z = Number(process.argv[3] || 0.46);
const run = (args) => { try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 240000 }).trim(); } catch (e) { return `ERR ${e.stdout || ''} ${e.stderr || ''}`; } };
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
const res = ev(`(() => { const g = window.__game; const ps = g.player.visual.planks; const grp = g.player.visual.group;
  const P = g.player.preset; const L = P.length; const out = { rows: [] };
  // иерархия от группы до меша досок: есть ли смещение/поворот
  const chain = []; let e = ps.group; while (e && e !== grp.parent) { chain.push(e.name + '@' + [e.position.x, e.position.y, e.position.z].map(v => +v.toFixed(2)).join('/') + ' r=' + [e.rotation.x, e.rotation.y, e.rotation.z].map(v => +v.toFixed(3)).join('/')); e = e.parent; }
  out.chain = chain;
  const rel = grp.matrixWorld.clone().invert().multiply(ps.group.matrixWorld);
  out.rel = rel.elements.map(v => +v.toFixed(3));
  for (const r of ps.records) {
    if (r.cls === 0 && r.side === 1 && Math.abs(r.z - ${Z}) < 1.3 && r.y > 0.2 && r.y < 2.2) {
      const n = new g.player.position.constructor(1, 0, 0).applyQuaternion(r.quat);
      out.rows.push([r.id, 'y=' + r.y.toFixed(2), 'z=' + r.z.toFixed(2), 'c=' + [r.center.x, r.center.y, r.center.z].map(v => +v.toFixed(2)).join('/'), 'len=' + r.len.toFixed(2), 'n=' + n.toArray().map(v => +v.toFixed(2)).join('/'), 'state=' + r.state].join(' '));
    }
    if (r.cls === 1 && Math.abs(r.z - ${Z}) < 1.3 && r.x > 2.0) {
      out.rows.push([r.id, 'x=' + r.x.toFixed(2), 'y=' + r.y.toFixed(2), 'z=' + r.z.toFixed(2), 'c=' + [r.center.x, r.center.y, r.center.z].map(v => +v.toFixed(2)).join('/'), 'len=' + r.len.toFixed(2)].join(' '));
    }
  }
  out.nRec = ps.records.length;
  out.recsByMesh = [0, 1, 2, 3].map(i => (ps.recsByMesh && ps.recsByMesh[i] ? ps.recsByMesh[i].length : -1));
  return JSON.stringify(out); })()`);
const txt = String(res).replace(/^"|"$/g, '').replace(/\\"/g, '"');
try { const o = JSON.parse(txt); console.log('chain:', o.chain.join('  →  ')); console.log('rel:', o.rel.join(',')); console.log('recs', o.nRec, 'byMesh', o.recsByMesh.join('/')); for (const r of o.rows) console.log('  ', r); } catch (e) { console.log(txt.slice(0, 3000)); }
