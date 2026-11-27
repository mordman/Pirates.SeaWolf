// Task 84: локализация падения страницы в v80 D3-D5 — повторяем
// последовательность обстрела с window.onerror-ловцом.
(() => {
  window.__errs = [];
  window.onerror = (msg, src, line, col) => {
    window.__errs.push(String(msg).slice(0, 200) + ' @' + (src || '').split('/').pop() + ':' + line);
    return false;
  };
  const g = window.__game;
  const T = window.__THREE;
  if (!g) return 'НЕТ __game';
  g.player.wind.speed = 3;
  g.stepDebugNR(3);
  const t = g.aiShips.map(a => a.ship).find(s => !s.sunk && s !== g.player);
  if (!t) return 'НЕТ цели';
  t.clearDamage();
  t.anchored = true; t.sailTarget = 0; t.sailOverride = null;
  t.velocity.set(0, 0, 0); t.angular.set(0, 0, 0);
  const L = t.preset.length, hw = Math.max(1.5, t.halfWidthAt(2));
  const lp = new T.Vector3(hw * 0.95, 2.0, 2);
  const steps = [];
  for (let i = 0; i < 3; i++) {
    try { t.hitHull(lp.clone(), 46, true); steps.push('hit' + i + ':ok'); }
    catch (e) { steps.push('hit' + i + ':ERR ' + String(e).slice(0, 120)); }
  }
  return JSON.stringify({
    target: t.preset.id, steps,
    errs: window.__errs.slice(0, 4),
    gameAlive: !!window.__game,
  });
})()
