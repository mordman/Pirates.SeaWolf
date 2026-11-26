// Task 84: точная последовательность v80 D1→D2→D4 одним вызовом —
// ловим падение страницы с полной цепочкой (пробоины + ядро + перелом).
(() => {
  window.__errs = [];
  window.onerror = (m, s, l) => { window.__errs.push(String(m).slice(0, 200) + ' @' + (s || '').split('/').pop() + ':' + l); return false; };
  window.addEventListener('unhandledrejection', (e) => { window.__errs.push('REJ: ' + String(e.reason).slice(0, 200)); });
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
  // D1: три пробоины
  const hw = Math.max(1.5, t.halfWidthAt(2));
  const lp = new T.Vector3(hw * 0.95, 2.0, 2);
  for (let i = 0; i < 3; i++) t.hitHull(lp.clone(), 46, true);
  const d1open = t.plankSideOpen(lp.clone());
  // D2: реальное ядро насквозь
  const Lz = t.preset.length;
  const zh = Math.min(Lz * 0.32, t.visual.masts[0].position.z - 3);
  const lp2 = new T.Vector3(Math.max(1.5, t.halfWidthAt(zh)) * 0.95, 2.0, zh);
  const hole = lp2.clone().applyQuaternion(t.quaternion).add(t.position);
  const from = new T.Vector3(lp2.x + 55, lp2.y + 1.4, lp2.z).applyQuaternion(t.quaternion).add(t.position);
  const dir = hole.clone().sub(from); dir.y += 0.75;
  g.combat.debugSpawnBall(from, dir, 175);
  g.stepDebugNR(2.5);
  const keelAfterBall = +t.keelHP.toFixed(1);
  const exitOpen = +t.plankSideOpen(new T.Vector3(-1, 2.0, zh)).toFixed(2);
  // D4: перелом
  const s3b = t.plankHull.byState().s3;
  for (let i = 0; i < 8 && !t.hullBroke; i++) t.damageStructure(new T.Vector3(0, -0.5, 2 + (i % 3) - 1), 26);
  const s3a = t.plankHull.byState().s3;
  return JSON.stringify({
    target: t.preset.id, d1open: +d1open.toFixed(2), keelAfterBall, exitOpen,
    hullBroke: t.hullBroke, sinking: t.sinking, torn: [s3b, s3a],
    errs: window.__errs.slice(0, 3), alive: !!window.__game,
  });
})()
