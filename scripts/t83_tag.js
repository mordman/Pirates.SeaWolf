// Task 83: пометить меши-кандидаты (планширь/перила квартердека) зелёным
// emissive — в обход освещения — и снять кадр. Если зелёное出现在 перилах,
// значит меши найдены верно и ничто их не перекрашивает (вопрос — свет).
(() => {
  const g = window.__game;
  const grp = g.player.visual.group;
  grp.updateWorldMatrix(true, true);
  const L = g.player.preset.length;
  const tagged = [];
  grp.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    let minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9, minX = 1e9, maxX = -1e9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
    }
    const zspan = maxZ - minZ, yspan = maxY - minY, xspan = maxX - minX;
    const tris = o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3;
    // планширь: длинный (zspan > 0.5L), тонкий по x, у верхней кромки (maxY > 3)
    const isCap = zspan > 0.5 * L && maxY > 3.0 && tris > 200 && tris < 4000;
    // квартердек печёный: кормовая половина, y до ~6, ширина корпуса
    const isQD = maxZ < 0.2 * L && minZ < -0.3 * L && maxY > 4.0 && maxY < 7.0 && xspan > 3 && tris > 500;
    if (isCap || isQD) {
      window.__t83tag = window.__t83tag || [];
      window.__t83tag.push({ o, prev: o.material.emissive ? o.material.emissive.getHex() : 0 });
      o.material.emissive = o.material.emissive || new THREE.Color();
      o.material.emissive.setHex(0x00ff00);
      o.material.emissiveIntensity = 1;
      o.material.needsUpdate = true;
      tagged.push({ cap: isCap, qd: isQD, tris, y: minY.toFixed(1) + '..' + maxY.toFixed(1), z: minZ.toFixed(0) + '..' + maxZ.toFixed(0), x: xspan.toFixed(1) });
    }
  });
  return JSON.stringify({ n: tagged.length, tagged: tagged.slice(0, 10) });
})()
