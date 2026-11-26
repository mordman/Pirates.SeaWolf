// Task 83: аудит СВЕТЛЫХ ВЕРШИННЫХ цветов — какие меши реально белые.
(() => {
  const g = window.__game;
  const ship = g.player && g.player.visual ? g.player.visual.group : null;
  if (!ship) return 'нет рута';
  const out = [];
  ship.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.color) return;
    if (!o.material || !o.material.vertexColors) return;
    const c = o.geometry.attributes.color;
    const pos = o.geometry.attributes.position;
    let sum = 0, n = 0, maxL = 0;
    for (let i = 0; i < c.count; i++) {
      const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
      const l = 0.3 * r + 0.5 * gg + 0.2 * b;
      sum += l; n++;
      if (l > maxL) maxL = l;
    }
    // bbox в локальных координатах
    let minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9, minX = 1e9, maxX = -1e9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
    }
    out.push({
      name: o.name || '(noname)',
      meanL: +(sum / n).toFixed(2),
      maxL: +maxL.toFixed(2),
      tris: o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3,
      y: minY.toFixed(1) + '..' + maxY.toFixed(1),
      z: minZ.toFixed(1) + '..' + maxZ.toFixed(1),
      x: minX.toFixed(1) + '..' + maxX.toFixed(1),
    });
  });
  out.sort((a, b) => b.meanL - a.meanL); const big = out.filter(m => m.tris >= 100);
  return JSON.stringify(big.slice(0, 14));
})()
