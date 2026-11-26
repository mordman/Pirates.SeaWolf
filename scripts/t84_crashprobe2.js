// Task 84: стадия 2 — реальный залп (D2/D3) + перелом (D4) + погружение.
// Ловим падение игрового цикла.
(() => {
  if (!window.__errs) {
    window.__errs = [];
    window.onerror = (msg, src, line) => {
      window.__errs.push(String(msg).slice(0, 160) + ' @' + (src || '').split('/').pop() + ':' + line);
      return false;
    };
  }
  const g = window.__game;
  const T = window.__THREE;
  if (!g) return 'НЕТ __game';
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  if (!t) return 'НЕТ цели';
  // перелом: как D4
  const s3before = t.plankHull.byState().s3;
  for (let i = 0; i < 8 && !t.hullBroke; i++) {
    try { t.damageStructure(new T.Vector3(0, -0.5, 2 + (i % 3) - 1), 26); }
    catch (e) { window.__errs.push('damageStructure: ' + String(e).slice(0, 140)); break; }
  }
  return JSON.stringify({
    target: t.preset.id, hullBroke: t.hullBroke, sinking: t.sinking,
    torn: { was: s3before, now: t.plankHull.byState().s3 },
    errs: window.__errs.slice(0, 3), alive: !!window.__game,
  });
})()
