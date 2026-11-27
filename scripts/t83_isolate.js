// Task 83: изоляция одного меша — спрятать весь корабль, показать только
// планширь (788 трис, y 3.0..4.4), снять его ИСТИННЫЙ рендер без emissive.
(() => {
  const g = window.__game;
  const grp = g.player.visual.group;
  // снять зелёный
  for (const t of (window.__t83tag || [])) { t.o.material.emissive.setHex(0); t.o.material.needsUpdate = true; }
  // найти планширь: zspan ~ вся длина, y 3..4.4, tris ~788
  let cap = null;
  const hidden = [];
  grp.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    let maxY = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < pos.count; i += 3) {
      const y = pos.getY(i), z = pos.getZ(i);
      if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const tris = o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3;
    if (!cap && maxZ - minZ > 35 && maxY > 2.9 && maxY < 4.5 && tris > 700 && tris < 850) cap = o;
  });
  if (!cap) return 'планширь не найден';
  window.__t83cap = cap;
  // спрятать всё, кроме планширя (в скоупе корабля)
  const all = [];
  grp.traverse(o => { if (o.isMesh && o !== cap && o.visible) { o.visible = false; all.push(o); } });
  window.__t83hidden = all;
  const mat = cap.material;
  return JSON.stringify({
    found: true, tris: cap.geometry.index.count / 3,
    vcol: mat.vertexColors, colorHex: '#' + mat.color.getHexString(),
    map: !!mat.map, emissive: mat.emissive ? '#' + mat.emissive.getHexString() : null,
    hiddenCount: all.length,
  });
})()
