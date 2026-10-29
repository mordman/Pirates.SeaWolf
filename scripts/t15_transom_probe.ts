// Детерминированная проверка транца (кормы): лучи ИЗ-ЗА кормы вперёд —
// каждый луч внутрь контура кормового шпангоута должен ВСТРЕТИТЬ
// геометрию. Если луч проходит насквозь — дыра в транце.
// (buildShip рисует canvas-текстуру палубы — в Node подменяем document)
const handler = (): ProxyHandler<unknown> => ({
  get: (_t, prop) => {
    if (prop === 'addColorStop') return () => undefined;
    if (prop === 'width' || prop === 'height') return 512;
    return (..._a: unknown[]) => new Proxy({}, handler());
  },
  set: () => true,
});
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => new Proxy({}, handler()),
};

import * as THREE from 'three';
import { PRESETS, buildShip, hullProfile } from '../src/game/ship/buildShip';

let fails = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fails++;
};

/** полуширина корпуса на кормовом шпангоуте на высоте y (как в buildHull) */
const sternHalfWidth = (P: { draft: number }, id: string, y: number) => {
  const p = hullProfile(0, PRESETS[id]);
  const u = Math.min(1, Math.max(0, (y + p.draft) / (p.draft + p.bulwark)));
  const flare = Math.pow(u, 0.6);
  void P;
  return p.w * (0.16 + 0.84 * flare);
};

const biggestHull = (vis: { group: THREE.Group }) => {
  let hull: THREE.Mesh | null = null;
  let maxTri = 0;
  vis.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && m.geometry.index && m.geometry.attributes.color) {
      const tris = m.geometry.index.count / 3;
      if (tris > maxTri) { maxTri = tris; hull = m as THREE.Mesh; }
    }
  });
  return hull;
};

const ray = new THREE.Raycaster();
/** лучи сквозь плоскость транца/носа; dirZ=+1 — из-за кормы вперёд */
const probeEnd = (id: string, dirZ: number) => {
  const P = PRESETS[id];
  const hull = biggestHull(buildShip(P));
  if (!hull) return { through: -1, total: 0, ys: [] as number[] };
  const L = P.length, F = P.freeboard;
  let through = 0, total = 0;
  const ys: number[] = [];
  for (let yi = 0; yi <= 16; yi++) {
    const y = -P.draft * 0.55 + (F * 1.0 + P.draft * 0.55) * (yi / 16);
    const hw = sternHalfWidth(P, id, y);
    if (hw < 0.2) continue;
    for (let xi = 0; xi <= 8; xi++) {
      const x = -hw * 0.82 + (hw * 1.64) * (xi / 8);
      const z = dirZ > 0 ? -L * 0.75 : L * 0.75;
      ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, dirZ));
      ray.far = L * 1.6;
      total++;
      if (!ray.intersectObject(hull, false).length) { through++; ys.push(+y.toFixed(2)); }
    }
  }
  return { through, total, ys };
};

for (const id of ['sloop', 'fluyt', 'frigate', 'victory', 'galleon', 'cog', 'caravel', 'santisima']) {
  const r = probeEnd(id, 1);
  check(`${id}: транец сплошной (лучи из-за кормы)`, r.through === 0,
    `сквозных ${r.through}/${r.total}${r.through ? ' y=' + r.ys.slice(0, 10).join(',') : ''}`);
}
for (const id of ['sloop', 'victory']) {
  const r = probeEnd(id, -1);
  check(`${id}: нос сплошной (лучи со стороны носа)`, r.through === 0,
    `сквозных ${r.through}/${r.total}`);
}

console.log(fails === 0 ? '\nALL OK' : `\nFAILED: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
