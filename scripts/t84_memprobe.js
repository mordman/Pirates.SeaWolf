// Task 84: мониторинг памяти при 35 сменах корабля (как в аудите v80 A1)
// — ищем утечку, валившую вкладку Chrome.
(async () => {
  const g = window.__game;
  const T = window.__THREE;
  if (!g) return 'НЕТ __game';
  const presets = ['sloop', 'fluyt', 'galleon', 'brigantine', 'pinnace', 'frigate',
    'blackpearl', 'cog', 'caravel', 'amsterdam'];
  const out = [];
  const mem = () => {
    const m = performance.memory;
    return m ? +(m.usedJSHeapSize / 1048576).toFixed(0) : -1;
  };
  for (let i = 0; i < 35; i++) {
    const id = presets[i % presets.length];
    try {
      g.changeShip(id, false);
    } catch (e) {
      return JSON.stringify({ step: i, err: String(e).slice(0, 150), mem: mem() });
    }
    // pequeño шаг времени, чтобы реакт отработал
    await new Promise(r => setTimeout(r, 250));
    if (i % 5 === 0 || i === 34) {
      const r = g.renderer;
      out.push({ i, id, memMB: mem(), geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: r.info.programs.length, calls: r.info.render.calls });
    }
  }
  return JSON.stringify({ alive: !!window.__game, samples: out });
})()
