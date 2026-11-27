// Task 83: аудит СВЕТЛЫХ материалов на корабле игрока — найти, что
// реально рендерится белым (перила/квартердек) вопреки коду.
// Запускается в консоли страницы через agent-browser eval.
(() => {
  const g = window.__game;
  const ship = g.player && g.player.visual ? g.player.visual.group : null;
  const root = ship || (g.scene ? g.scene : null);
  if (!root) return 'нет рута';
  const out = [];
  const seen = new Set();
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.isMeshStandardMaterial) continue;
      const c = m.color || { r: 1, g: 1, b: 1 };
      const lum = 0.3 * c.r + 0.5 * c.g + 0.2 * c.b;
      const key = m.uuid;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: o.name || '(без имени)',
        colorHex: '#' + c.getHexString(),
        lum: +lum.toFixed(2),
        vcol: !!m.vertexColors,
        map: m.map ? (m.map.uuid.slice(0, 6)) : null,
        user: m.userData && m.userData.t82wood ? 'T82WOOD' : '',
        tris: o.geometry ? (o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0)) : 0,
      });
    }
  });
  // светлые вперёд, потом тёмные
  out.sort((a, b) => b.lum - a.lum);
  return JSON.stringify(out.slice(0, 14), null, 0);
})()
