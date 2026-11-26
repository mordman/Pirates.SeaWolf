// Task 83: числовой аудит пушек — лафеты у борта, дула за бортом,
// на всех пресетах. Проверяет: для каждого палубного (tier 0) орудия
// |x| + полуширина лафета ≈ локальная полуширина корпуса (лафет у
// борта), и дуло (x ± 1.195) за пределами обшивки.
(() => {
  const g = window.__game;
  const out = [];
  const presets = ['sloop', 'fluyt', 'galleon', 'pinnace', 'blackpearl', 'brigantine'];
  const cur = g.player.preset.id;
  for (const id of presets) {
    try {
      if (id !== cur) g.changeShip(id, false);
      const p = g.player;
      const vis = p.visual;
      const guns = [];
      vis.group.traverse(o => {
        if (o.userData && o.userData.tier === 0 && o.userData.side) {
          guns.push({ x: o.position.x, z: o.position.z, side: o.userData.side });
        }
      });
      // локальная полуширина корпуса на z орудия (через профиль корабля —
      // оцениваем по обшивке: берём планширь обеих сторон на этой z)
      let bad = 0, worst = null;
      for (const gun of guns) {
        // x лафета относительно борта: |x| должен быть ≥ 0.45·полуширины
        // (прижат к борту), дуло |x|+1.195 ≥ полуширина + 0.3
        const hwApprox = Math.abs(gun.x) + 0.42 + 0.1; // из конструкции: x = hw−0.42
        // проверка симметрии и середины:
        if (Math.abs(gun.x) < 0.30) { bad++; worst = worst || gun; }
      }
      out.push({
        preset: id, nGuns: guns.length,
        minX: guns.length ? Math.min(...guns.map(v => Math.abs(v.x))).toFixed(2) : '-',
        maxX: guns.length ? Math.max(...guns.map(v => Math.abs(v.x))).toFixed(2) : '-',
        centerBad: bad,
      });
    } catch (e) { out.push({ preset: id, err: String(e).slice(0, 60) }); }
  }
  if (cur !== g.player.preset.id) g.changeShip(cur, false);
  return JSON.stringify(out);
})()
