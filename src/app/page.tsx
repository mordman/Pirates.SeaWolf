'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Game, HudState } from '@/game/game';
import type { AmmoType } from '@/game/combat/combat';
import SettingsPanel from './SettingsPanel';
import { ENCYCLOPEDIA, type ShipEntry } from '@/game/ship/encyclopedia';
import { loadSettings, saveSettings, keyLabel, DEFAULT_SETTINGS, type GameSettings } from '@/game/core/settings';

// ============================================================
// Страница игры: canvas + HUD (панели, компас, карта, порт)
// ============================================================

const COMPASS = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
const AMMO_ORDER: { key: AmmoType; label: string; hotkey: string }[] = [
  { key: 'ball', label: 'Ядро', hotkey: '1' },
  { key: 'chain', label: 'Книппель', hotkey: '2' },
  { key: 'grape', label: 'Картечь', hotkey: '3' },
  { key: 'fire', label: 'Зажигат.', hotkey: '4' },
];

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`pointer-events-auto rounded-lg border border-amber-900/60 bg-[#160f08]/80 backdrop-blur-sm shadow-lg shadow-black/40 ${className}`}>
      {children}
    </div>
  );
}

function Bar({ pct, color, bg = 'bg-stone-800' }: { pct: number; color: string; bg?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-sm ${bg}`}>
      <div className={`h-full transition-all duration-300 ${color}`} style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%` }} />
    </div>
  );
}

function WindCompass({ hud }: { hud: HudState }) {
  const rel = hud.windRelDeg;
  return (
    <div className="flex items-center gap-3 p-3">
      <svg width="84" height="84" viewBox="0 0 100 100" className="shrink-0">
        <circle cx="50" cy="50" r="46" fill="#0d0906" stroke="#7c5a2a" strokeWidth="2" />
        <circle cx="50" cy="50" r="35" fill="none" stroke="#3d2e18" strokeWidth="1" />
        {['С', 'В', 'Ю', 'З'].map((d, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          return (
            <text key={d} x={50 + Math.cos(a) * 40} y={50 + Math.sin(a) * 40 + 4} textAnchor="middle"
              fill={d === 'С' ? '#e8c87a' : '#8a734d'} fontSize="11" fontWeight="bold">{d}</text>
          );
        })}
        {/* корабль (всегда носом вверх) */}
        <polygon points="50,26 56,62 50,55 44,62" fill="#d8c9a8" />
        {/* стрелка ветра: откуда дует относительно курса */}
        <g transform={`rotate(${rel} 50 50)`}>
          <line x1="50" y1="18" x2="50" y2="34" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" />
          <polygon points="50,10 45,22 55,22" fill="#7dd3fc" />
        </g>
      </svg>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
        <span className="text-stone-400">Ветер</span>
        <span className="text-sky-200 font-semibold">{hud.windSpeed.toFixed(1)} м/с</span>
        <span className="text-stone-400">Курс</span>
        <span className="text-amber-100 font-semibold">{COMPASS[Math.round(hud.headingDeg / 22.5) % 16]} {hud.headingDeg}°</span>
        <span className="text-stone-400">Ход</span>
        <span className="text-amber-100 font-semibold">{hud.speed.toFixed(1)} уз</span>
        <span className="text-stone-400">Время</span>
        <span className="text-amber-100 font-semibold">{hud.clock}</span>
      </div>
    </div>
  );
}

// ============================================================
// МИНИ-КАРТА: круглый радар вокруг корабля (острова, суда, ветер)
// ============================================================
function MiniMap({ hud }: { hud: HudState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const S = cv.width;
    const c = S / 2;
    const RANGE = 900;                       // метров от центра до края
    const scale = c / RANGE;
    ctx.clearRect(0, 0, S, S);
    // морской фон + картушка
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#0c242e';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let r = RANGE / 3; r <= RANGE; r += RANGE / 3) {
      ctx.beginPath(); ctx.arc(c, c, r * scale, 0, Math.PI * 2); ctx.stroke();
    }
    const px = (x: number) => c + (x - hud.mapPlayer.x) * scale;
    const pz = (z: number) => c + (z - hud.mapPlayer.z) * scale;
    // острова: открытые — в цвете, неизвестные — пунктиром
    for (const isl of hud.mapIslands) {
      const ix = px(isl.x), iz = pz(isl.z);
      const r = Math.max(3, isl.r * scale);
      if (ix < -r || ix > S + r || iz < -r || iz > S + r) continue;
      if (!isl.discovered) {
        ctx.strokeStyle = 'rgba(220,200,150,0.28)';
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(ix, iz, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const grad = ctx.createRadialGradient(ix, iz, r * 0.2, ix, iz, r);
      grad.addColorStop(0, '#4a7a3a');
      grad.addColorStop(0.75, '#c9b26a');
      grad.addColorStop(1, '#1d5d6e');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(ix, iz, r, 0, Math.PI * 2); ctx.fill();
    }
    // корабли ИИ: военные — красные, торговцы — янтарные, сдавшиеся — белые
    for (const s of hud.mapShips) {
      const sx = px(s.x), sz = pz(s.z);
      if (Math.hypot(sx - c, sz - c) > c - 5) continue;
      ctx.fillStyle = s.surrendered ? '#e8e4d8' : s.cat === 'war' ? '#c23b3b' : '#d8a03c';
      ctx.beginPath(); ctx.arc(sx, sz, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // игрок — носом по курсу (курс 0 = +Z = вниз карты)
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(Math.PI - hud.mapPlayer.h);
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // ветер: стрелка по ободу (куда ДУЕТ)
    const wa = ((hud.windFromDeg + 180) % 360) * Math.PI / 180;
    const wx = c + Math.sin(wa) * (c - 13), wy = c - Math.cos(wa) * (c - 13);
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(wa);
    ctx.fillStyle = 'rgba(125,211,252,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 3); ctx.lineTo(-4, 3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // север
    ctx.fillStyle = '#e8c87a';
    ctx.font = 'bold 10px serif';
    ctx.textAlign = 'center';
    ctx.fillText('С', c, 12);
  }, [hud]);
  return (
    <canvas ref={ref} width={168} height={168}
      className="rounded-full border-2 border-amber-900/60 bg-[#0c242e] shadow-lg shadow-black/50" />
  );
}

// ============================================================
// 3D-ПРОСМОТР МОДЕЛИ КОРАБЛЯ (энциклопедия): автоповорот + драг
// ============================================================
function ShipViewer3D({ presetId }: { presetId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let renderer: import('three').WebGLRenderer | null = null;
    let visual: import('@/game/ship/buildShip').ShipVisual | null = null;
    let three: typeof import('three') | null = null;
    (async () => {
      three = await import('three');
      const bs = await import('@/game/ship/buildShip');
      if (disposed || !ref.current || !three) return;
      const T = three;
      const P = bs.PRESETS[presetId];
      if (!P) return;
      renderer = new T.WebGLRenderer({ canvas: ref.current, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.toneMapping = T.ACESFilmicToneMapping;
      const scene = new T.Scene();
      const cam = new T.PerspectiveCamera(36, 1.5, 0.5, 800);
      // свет: небо + солнце + подсветка
      scene.add(new T.HemisphereLight(0xcfe4f2, 0x40331f, 1.05));
      const sun = new T.DirectionalLight(0xfff0d8, 1.9);
      sun.position.set(0.6, 1, 0.5);
      scene.add(sun);
      const rim = new T.DirectionalLight(0x9db8d8, 0.6);
      rim.position.set(-0.8, 0.4, -0.6);
      scene.add(rim);
      // модель
      visual = bs.buildShip(P);
      scene.add(visual.group);
      const L = P.length;
      const H = P.freeboard + L * 0.78; // высота рангоута
      let az = 0.85, elev = 0.30, dist = Math.max(L * 1.5, H * 1.32);
      let targetDist = dist;
      // паруса частично поставлены, реи чуть брасоплены — «живой» силуэт
      for (const s of visual.sails.sails) {
        s.mat.uniforms.uFurl.value = 0.16;
        s.mat.uniforms.uBelly.value = 0.55;
        if (s.brace) s.brace.rotation.y = 0.22;
      }
      const resize = () => {
        if (!renderer || !ref.current) return;
        const w = ref.current.clientWidth || 300;
        const h = ref.current.clientHeight || 210;
        renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      };
      resize();
      // drag-вращение и зум колесом
      let dragging = false, lastX = 0, lastY = 0;
      const el = ref.current;
      const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        az -= (e.clientX - lastX) * 0.008;
        elev = Math.min(1.35, Math.max(0.06, elev + (e.clientY - lastY) * 0.005));
        lastX = e.clientX; lastY = e.clientY;
      };
      const onUp = () => { dragging = false; };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        targetDist = Math.min(Math.max(L * 0.6, targetDist * (1 + Math.sign(e.deltaY) * 0.12)), L * 3.2);
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('wheel', onWheel, { passive: false });
      const t0 = performance.now();
      const loop = () => {
        if (disposed) return;
        raf = requestAnimationFrame(loop);
        const t = (performance.now() - t0) / 1000;
        if (!dragging) az += 0.0028;
        dist += (targetDist - dist) * 0.15;
        const ty = H * 0.42;
        cam.position.set(
          Math.sin(az) * Math.cos(elev) * dist,
          ty + Math.sin(elev) * dist,
          Math.cos(az) * Math.cos(elev) * dist);
        cam.lookAt(0, ty * 0.8, 0);
        // анимация парусов/флага
        if (visual) {
          for (const s of visual.sails.sails) s.mat.uniforms.uTime.value = t;
          visual.flagMat.uniforms.uTime.value = t;
        }
        renderer?.render(scene, cam);
      };
      loop();
      // cleanup-обработчики вынесены в return замыкания
      (el as unknown as { __cleanup3d?: () => void }).__cleanup3d = () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('wheel', onWheel);
      };
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      const el = ref.current;
      (el as unknown as { __cleanup3d?: () => void })?.__cleanup3d?.();
      // освободить GPU-ресурсы модели
      if (visual && three) {
        visual.group.traverse(o => {
          const mesh = o as import('three').Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const m of mats) {
            const mat = m as import('three').MeshStandardMaterial & { map?: { dispose(): void } };
            mat.map?.dispose();
            mat.dispose();
          }
        });
      }
      renderer?.dispose();
    };
  }, [presetId]);
  return (
    <canvas ref={ref}
      className="h-full w-full cursor-grab rounded-lg bg-gradient-to-b from-[#1c2f3d] to-[#0d1a22] active:cursor-grabbing" />
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [encyOpen, setEncyOpen] = useState(false);
  const [encyId, setEncyId] = useState(ENCYCLOPEDIA[0].id);
  const [shipPicker, setShipPicker] = useState(false);
  const [pickerCat, setPickerCat] = useState<'war' | 'merchant'>('war');
  const [settings, setSettings] = useState<GameSettings>(() =>
    typeof window === 'undefined' ? structuredClone(DEFAULT_SETTINGS) : loadSettings());
  const [portMsg, setPortMsg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let game: Game | null = null;
    (async () => {
      const { Game: GameClass } = await import('@/game/game');
      if (disposed || !canvasRef.current) return;
      game = new GameClass(canvasRef.current);
      gameRef.current = game;
      game.run();
      setReady(true);
      const iv = setInterval(() => setHud({ ...game!.hud }), 110);
      return () => clearInterval(iv);
    })();
    return () => {
      disposed = true;
      game?.dispose();
      gameRef.current = null;
    };
  }, []);

  // Tab / H / Esc — клавиши из настроек; при открытом экране настроек — пауза
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = settings.controls;
      if (e.code === 'Escape') {
        setSettingsOpen(false); setMapOpen(false); setHelpOpen(false);
        const gg = gameRef.current; if (gg) { gg.uiOpen = false; gg.input.keys.clear(); }
        return;
      }
      if (settingsOpen) return;
      if (e.code === c.map) { e.preventDefault(); setMapOpen(v => !v); }
      if (e.code === c.help) setHelpOpen(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings, settingsOpen]);

  const openSettings = useCallback(() => {
    const gg = gameRef.current;
    if (gg) gg.uiOpen = true;
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    const gg = gameRef.current;
    if (gg) { gg.uiOpen = false; gg.input.keys.clear(); }
    setSettingsOpen(false);
  }, []);

  const applySettings = useCallback((s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    gameRef.current?.applySettings(s);
  }, []);

  // отрисовка карты
  useEffect(() => {
    if (!mapOpen || !hud || !mapCanvasRef.current) return;
    const cv = mapCanvasRef.current;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e2a33';
    ctx.fillRect(0, 0, W, H);
    // сетка
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const scale = 0.055; // мир -> пиксели
    const cx = W / 2, cy = H / 2;
    const px = (x: number) => cx + x * scale;
    const pz = (z: number) => cy + z * scale;
    // острова: все подписаны (навигационная карта); неоткрытые — пунктиром
    for (const isl of hud.mapIslands) {
      const r = Math.max(4, isl.r * scale);
      if (!isl.discovered) {
        ctx.strokeStyle = 'rgba(220,200,150,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(px(isl.x), pz(isl.z), r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(232,198,122,0.55)';
        ctx.font = '10px serif';
        ctx.textAlign = 'center';
        ctx.fillText(isl.name, px(isl.x), pz(isl.z) + r + 13);
        continue;
      }
      const grad = ctx.createRadialGradient(px(isl.x), pz(isl.z), r * 0.2, px(isl.x), pz(isl.z), r);
      grad.addColorStop(0, '#4a7a3a');
      grad.addColorStop(0.75, '#c9b26a');
      grad.addColorStop(1, '#1d5d6e');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(px(isl.x), pz(isl.z), r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0e2c0';
      ctx.font = 'bold 11px serif';
      ctx.textAlign = 'center';
      ctx.fillText(isl.name, px(isl.x), pz(isl.z) + r + 14);
    }
    // корабли ИИ
    for (const s of hud.mapShips) {
      ctx.fillStyle = s.surrendered ? '#e8e4d8' : ['brig', 'galleon', 'frigate'].includes(s.kind) ? '#c23b3b' : '#d8a03c';
      ctx.beginPath(); ctx.arc(px(s.x), pz(s.z), 4, 0, Math.PI * 2); ctx.fill();
    }
    // игрок
    const p = hud.mapPlayer;
    ctx.save();
    ctx.translate(px(p.x), pz(p.z));
    ctx.rotate(-p.h);
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // роза ветров
    ctx.fillStyle = '#e8c87a';
    ctx.font = 'bold 12px serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Ветер: ${hud.windFromDeg}°, ${hud.windSpeed.toFixed(1)} м/с`, 12, H - 14);
  }, [mapOpen, hud]);

  const act = useCallback((fn: (g: Game) => string | null | void) => {
    const g = gameRef.current;
    if (!g) return;
    const res = fn(g);
    setPortMsg(typeof res === 'string' ? res : null);
  }, []);

  // быстрое перемещение: клик по острову на навигационной карте
  const onMapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!hud) return;
    const cv = mapCanvasRef.current;
    if (!cv) return;
    e.stopPropagation(); // клик по карте не закрывает её (только кнопка/затемнение)
    const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (cv.width / rect.width);
    const my = (e.clientY - rect.top) * (cv.height / rect.height);
    const scale = 0.055;
    const wx = (mx - cv.width / 2) / scale;
    const wz = (my - cv.height / 2) / scale;
    let bestName: string | null = null;
    let bestD = Infinity;
    for (const isl of hud.mapIslands) {
      const d = Math.hypot(isl.x - wx, isl.z - wz);
      if (d < isl.r + 240 && d < bestD) { bestD = d; bestName = isl.name; }
    }
    if (bestName) {
      const nm = bestName;
      act(g => g.fastTravelTo(nm));
      setMapOpen(false);
    }
  };

  const g = gameRef.current;

  return (
    <main className="fixed inset-0 overflow-hidden bg-black select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0704]">
          <div className="text-center">
            <div className="mb-3 text-3xl font-serif text-amber-300">Морские волки</div>
            <div className="text-stone-400">Грузим пушки, канаты и ром...</div>
          </div>
        </div>
      )}

      {hud && !hud.started && ready && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="max-w-lg rounded-xl border-2 border-amber-800/70 bg-[#1a120a] p-8 text-center shadow-2xl">
            <h1 className="mb-1 font-serif text-4xl font-bold text-amber-300">Морские волки</h1>
            <p className="mb-5 text-sm italic text-stone-400">Пиратская песочница на бесконечном море</p>
            <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1.5 text-left text-xs text-stone-300">
              <span><b className="text-amber-200">{keyLabel(settings.controls.sailsUp)} / {keyLabel(settings.controls.sailsDown)}</b> — паруса 0–3</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.steerLeft)} / {keyLabel(settings.controls.steerRight)}</b> — руль</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.aimPort)} / {keyLabel(settings.controls.aimStarboard)}</b> — прицел борта</span>
              <span><b className="text-amber-200">ЛКМ / {keyLabel(settings.controls.fire)}</b> — выстрел / залп</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.ammo[0])}–{keyLabel(settings.controls.ammo[3])}</b> — боеприпасы</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.camera)}</b> — камера (изометрия и др.)</span>
              <span><b className="text-amber-200">Колесо</b> — зум</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.anchor)}</b> — якорь</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.repair)}</b> — ремонт / откачка</span>
              <span><b className="text-amber-200">{keyLabel(settings.controls.map)}</b> — карта · <b className="text-amber-200">{keyLabel(settings.controls.help)}</b> — помощь</span>
            </div>
            <button
              onClick={() => { gameRef.current?.start(); }}
              className="pointer-events-auto rounded-lg border border-amber-600 bg-gradient-to-b from-amber-600 to-amber-800 px-8 py-3 font-serif text-lg font-bold text-amber-50 shadow-lg transition hover:from-amber-500 hover:to-amber-700 active:scale-95"
            >
              ⚓ Поднять флаг
            </button>
            <button
              onClick={() => { gameRef.current?.startProving('fluyt'); }}
              className="pointer-events-auto mt-2 rounded-lg border border-stone-500 bg-gradient-to-b from-stone-600 to-stone-800 px-8 py-2 font-serif text-sm font-bold text-stone-100 shadow-lg transition hover:from-stone-500 hover:to-stone-700 active:scale-95"
            >
              🎯 Полигон разрушений
            </button>
            <button
              onClick={() => setEncyOpen(true)}
              className="pointer-events-auto mt-2 rounded-lg border border-stone-500 bg-gradient-to-b from-stone-600 to-stone-800 px-8 py-2 font-serif text-sm font-bold text-stone-100 shadow-lg transition hover:from-stone-500 hover:to-stone-700 active:scale-95"
            >
              📖 Энциклопедия кораблей
            </button>
            <p className="mt-2 text-[11px] text-stone-500">Чистое море · мишень на якоре · проверка урона</p>
          </div>
        </div>
      )}

      {hud && hud.started && !hud.dead && (
        <div className="pointer-events-none absolute inset-0 z-10 font-sans text-stone-200">
          {/* ---- статус корабля (лево-верх) ---- */}
          <div className="absolute left-3 top-3 w-60">
            <Panel className="p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-serif text-sm font-bold text-amber-200">Шлюп «Бриз»</span>
                <span className="text-[10px] text-stone-500">{hud.fps} FPS</span>
              </div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-stone-400">Корпус</span>
                  <span className={hud.hullPct < 0.35 ? 'text-red-400 font-bold' : ''}>{Math.round(hud.hullPct * 100)}%</span></div>
                <Bar pct={hud.hullPct} color={hud.hullPct < 0.35 ? 'bg-red-500' : hud.hullPct < 0.7 ? 'bg-amber-500' : 'bg-emerald-600'} />
                <div className="flex justify-between"><span className="text-stone-400">Паруса</span>
                  <span className={hud.sailPct < 0.35 ? 'text-red-400 font-bold' : ''}>{Math.round(hud.sailPct * 100)}%</span></div>
                <Bar pct={hud.sailPct} color="bg-sky-400" />
                <div className="flex justify-between"><span className="text-stone-400">Команда</span><span>{hud.crew} / {hud.maxCrew}</span></div>
                <Bar pct={hud.crew / hud.maxCrew} color="bg-amber-400" />
                {hud.waterPct > 0.01 && (
                  <>
                    <div className="flex justify-between"><span className="text-stone-400">Вода в трюме</span>
                      <span className={hud.waterPct > 0.4 ? 'text-red-400 font-bold' : 'text-sky-300'}>{Math.round(hud.waterPct * 100)}%</span></div>
                    <Bar pct={hud.waterPct} color="bg-sky-500" />
                  </>
                )}
                {hud.onFire && <div className="text-center text-[11px] font-bold text-orange-400">🔥 ПОЖАР! Держите R</div>}
                {hud.sinking && <div className="text-center text-[11px] font-bold text-red-400">МЫ ТОНЕМ!</div>}
              </div>
            </Panel>
          </div>

          {/* ---- ветер/курс (право-верх) + настройки ---- */}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
            <Panel><WindCompass hud={hud} /></Panel>
            <button onClick={openSettings}
              className="pointer-events-auto rounded-lg border border-amber-900/60 bg-[#160f08]/80 px-3 py-1.5 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-sm transition hover:border-amber-500 hover:text-amber-100">
              ⚙ Настройки
            </button>
          </div>

          {/* ---- сообщения ---- */}
          <div className="absolute left-1/2 top-3 w-96 -translate-x-1/2 space-y-1">
            {hud.messages.map(m => (
              <div key={m.id} className="rounded border border-amber-900/50 bg-[#160f08]/85 px-3 py-1.5 text-center text-xs text-amber-100 shadow">
                {m.text}
              </div>
            ))}
          </div>

          {/* ---- нижняя центральная панель ---- */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <Panel className="flex items-end gap-4 p-3">
              {/* паруса */}
              <div className="text-center">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">
                  Паруса ({keyLabel(settings.controls.sailsUp)}/{keyLabel(settings.controls.sailsDown)})
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3].map(i => (
                    <div key={i} className={`h-7 w-6 rounded-sm border ${i <= hud.sailLevel ? 'border-amber-400 bg-amber-500/70' : 'border-stone-700 bg-stone-900'}`} />
                  ))}
                </div>
              </div>
              {/* руль */}
              <div className="text-center">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">
                  Руль ({keyLabel(settings.controls.steerLeft)}/{keyLabel(settings.controls.steerRight)})
                </div>
                <div className="relative h-7 w-24 rounded-sm border border-stone-700 bg-stone-900">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-stone-600" />
                  <div className="absolute top-1 h-5 w-2.5 rounded-sm bg-amber-400 transition-all duration-150"
                    style={{ left: `calc(${50 + hud.rudder * 42}% - 5px)` }} />
                </div>
              </div>
              {/* боеприпасы */}
              <div>
                <div className="mb-1 text-center text-[10px] uppercase tracking-wide text-stone-400">Боеприпасы (1–4)</div>
                <div className="flex gap-1.5">
                  {AMMO_ORDER.map((a, i) => (
                    <div key={a.key}
                      className={`w-16 rounded-sm border px-1 py-1 text-center ${hud.ammoType === a.key ? 'border-amber-400 bg-amber-900/50' : 'border-stone-700 bg-stone-900/70'}`}>
                      <div className="text-[9px] leading-tight text-stone-300">{a.label}</div>
                      <div className={`text-xs font-bold ${hud.ammoCounts[a.key] > 0 ? 'text-amber-200' : 'text-red-400'}`}>{hud.ammoCounts[a.key] ?? 0}</div>
                      <div className="text-[8px] text-stone-500">{keyLabel(settings.controls.ammo[i])}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          {/* ---- золото и груз (право-низ) ---- */}
          <div className="absolute bottom-3 right-3">
            <Panel className="p-3 text-right text-xs">
              <div className="font-serif text-lg font-bold text-amber-300">🪙 {hud.gold}</div>
              <div className="mt-1 text-stone-400">Доски: {hud.planks}</div>
              {(hud.cargo.sugar > 0 || hud.cargo.rum > 0 || hud.cargo.timber > 0) && (
                <div className="mt-1 text-[11px] text-stone-300">
                  {hud.cargo.sugar > 0 && <div>Сахар ×{hud.cargo.sugar}</div>}
                  {hud.cargo.rum > 0 && <div>Ром ×{hud.cargo.rum}</div>}
                  {hud.cargo.timber > 0 && <div>Древесина ×{hud.cargo.timber}</div>}
                </div>
              )}
              <div className="mt-1 text-[10px] text-stone-500">Камера: {hud.cameraLabel} (C)</div>
            </Panel>
          </div>

          {/* ---- панель полигона (право, под компасом) ---- */}
          {hud.proving && hud.target && (
            <div className="absolute right-3 top-40 w-64">
              <Panel className="p-3">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="font-serif text-sm font-bold text-amber-200">🎯 Полигон</span>
                  <span className="text-[10px] text-stone-500">{hud.target.dist} м</span>
                </div>
                <div className="mb-1.5 grid grid-cols-4 gap-1">
                  {([['sloop', 'Шлюп'], ['fluyt', 'Флейт'], ['brig', 'Бриг'], ['caravel', 'Каравелла'],
                     ['pinnace', 'Пинасс'], ['cog', 'Когг'], ['galleon', 'Галеон'], ['frigate', 'Фрегат']] as const).map(([id, label]) => (
                    <button key={id}
                      onClick={() => act(gg => gg.pgSetModel(id))}
                      className={`pointer-events-auto flex-1 rounded border px-1 py-1 text-[10px] transition ${
                        hud.target!.modelId === id
                          ? 'border-amber-400 bg-amber-900/60 text-amber-100'
                          : 'border-stone-700 bg-stone-900/70 text-stone-300 hover:border-stone-500'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mb-1.5">
                  <div className="mb-0.5 flex items-center justify-between text-[10px]">
                    <span className="text-stone-400">Дистанция</span>
                    <span className="font-semibold text-amber-200">{settings.gameplay.provingDistance} м</span>
                  </div>
                  <input
                    type="range" min={10} max={400} step={5}
                    value={settings.gameplay.provingDistance}
                    onChange={e => {
                      const v = Number(e.target.value);
                      applySettings({ ...structuredClone(settings), gameplay: { ...settings.gameplay, provingDistance: v } });
                    }}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-stone-700 accent-amber-500" />
                </div>
                <div className="mb-1.5">
                  <button
                    onClick={() => act(gg => gg.setPgReturnFire(!hud.target!.returnFire))}
                    className={`pointer-events-auto w-full rounded border px-2 py-1 text-[10px] transition ${
                      hud.target.returnFire
                        ? 'border-red-500 bg-red-950/60 text-red-200'
                        : 'border-stone-700 bg-stone-900/70 text-stone-300 hover:border-stone-500'}`}>
                    {hud.target.returnFire ? '🔥 Мишень отвечает огнём' : 'Мишень не стреляет'}
                  </button>
                </div>
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between"><span className="text-stone-400">Корпус</span>
                    <span className={hud.target.hullPct < 0.35 ? 'text-red-400 font-bold' : ''}>{Math.round(hud.target.hullPct * 100)}%</span></div>
                  <Bar pct={hud.target.hullPct} color={hud.target.hullPct < 0.35 ? 'bg-red-500' : 'bg-emerald-600'} />
                  <div className="flex justify-between"><span className="text-stone-400">Трюм (вода)</span>
                    <span className={hud.target.waterPct > 0.4 ? 'text-red-400 font-bold' : 'text-sky-300'}>{Math.round(hud.target.waterPct * 100)}%</span></div>
                  <Bar pct={hud.target.waterPct} color="bg-sky-500" />
                  <div className="flex justify-between"><span className="text-stone-400">Течь</span>
                    <span>{hud.target.leakRate.toFixed(2)} м³/с</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">Мачты</span>
                    <span className="flex gap-1">
                      {hud.target.masts.map((m, i) => (
                        <span key={i} className={m.broken ? 'text-red-400 font-bold' : m.hpPct < 0.7 ? 'text-amber-300' : 'text-emerald-400'}>
                          {m.broken ? '✕' : '▮'}
                        </span>
                      ))}
                    </span>
                  </div>
                  <div className="flex justify-between"><span className="text-stone-400">Пробоины</span>
                    <span>{hud.target.holesBelow} под ВЛ / {hud.target.holesAbove} над</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">Экипаж</span>
                    <span>{hud.target.crew} / {hud.target.maxCrew}</span></div>
                  {hud.target.sinking && <div className="text-center font-bold text-red-400">МИШЕНЬ ТОНЕТ!</div>}
                  {hud.target.sunk && <div className="text-center font-bold text-stone-400">Затонула</div>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <button onClick={() => act(gg => gg.resetProvingTarget())}
                    className="pointer-events-auto rounded border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-[10px] text-emerald-200 transition hover:bg-emerald-900/60">
                    ⟳ Восстановить
                  </button>
                  <button onClick={() => act(gg => gg.exitProving())}
                    className="pointer-events-auto rounded border border-stone-600 bg-stone-900/60 px-2 py-1 text-[10px] text-stone-200 transition hover:bg-stone-800">
                    ✕ Выйти
                  </button>
                </div>
              </Panel>
            </div>
          )}

          {/* ---- прицел ---- */}
          {hud.aiming && (
            <>
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <svg width="46" height="46" viewBox="0 0 46 46">
                  <circle cx="23" cy="23" r="14" fill="none" stroke="#ffd27a" strokeWidth="1.5" opacity="0.85" />
                  <circle cx="23" cy="23" r="2" fill="#ffd27a" />
                  <line x1="23" y1="0" x2="23" y2="12" stroke="#ffd27a" strokeWidth="1.5" />
                  <line x1="23" y1="34" x2="23" y2="46" stroke="#ffd27a" strokeWidth="1.5" />
                  <line x1="0" y1="23" x2="12" y2="23" stroke="#ffd27a" strokeWidth="1.5" />
                  <line x1="34" y1="23" x2="46" y2="23" stroke="#ffd27a" strokeWidth="1.5" />
                </svg>
              </div>
              <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
                <Panel className="px-4 py-2 text-center text-xs">
                  <span className="text-amber-200 font-bold">{hud.aimSide}</span>
                  <span className="mx-2 text-stone-500">|</span>
                  <span>Дистанция <b className="text-amber-200">{hud.aimRange} м</b></span>
                  <span className="mx-2 text-stone-500">|</span>
                  <span>Орудия <b className={hud.gunsReadyPct > 0.99 ? 'text-emerald-400' : 'text-amber-200'}>{Math.round(hud.gunsReadyPct * 100)}%</b></span>
                  {hud.targetName && <div className="mt-0.5 text-[11px] text-red-300">Цель: {hud.targetName}</div>}
                </Panel>
              </div>
            </>
          )}

          {/* ---- подсказки взаимодействия ---- */}
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 space-y-1 text-center">
            {hud.canBoard && hud.boardedName && (
              <div className="pointer-events-none rounded-lg border border-emerald-700 bg-[#0a1f12]/90 px-5 py-2 text-sm text-emerald-200 shadow-lg animate-pulse">
                <b>E</b> — взять приз: {hud.boardedName} (сдался)
              </div>
            )}
            {hud.canDock && !hud.aiming && (
              <div className="rounded-lg border border-amber-600 bg-[#1f1608]/90 px-5 py-2 text-sm text-amber-200 shadow-lg animate-pulse">
                <b>E</b> — пришвартоваться в Пальмовой гавани
              </div>
            )}
            {hud.anchored && <div className="text-xs text-stone-300">⚓ Якорь отдан (F — поднять)</div>}
            {hud.grounded && <div className="text-xs font-bold text-orange-400">Мель! Разворачивайтесь (S — задний ход)</div>}
            {hud.repairAction && <div className="text-xs text-emerald-300">🔧 {hud.repairAction}</div>}
          </div>
        </div>
      )}

      {/* ---- экран смерти ---- */}
      {hud?.dead && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80">
          <div className="rounded-xl border-2 border-red-900 bg-[#150a08] p-8 text-center">
            <h2 className="mb-2 font-serif text-3xl font-bold text-red-400">Корабль затонул</h2>
            <p className="mb-6 text-sm text-stone-400">Море забрало судно и половину золота...</p>
            <button
              onClick={() => gameRef.current?.respawn()}
              className="pointer-events-auto rounded-lg border border-amber-600 bg-gradient-to-b from-amber-700 to-amber-900 px-6 py-2.5 font-serif font-bold text-amber-50 transition hover:from-amber-600 active:scale-95">
              Новый корабль
            </button>
          </div>
        </div>
      )}

      {/* ---- меню порта ---- */}
      {hud?.docked && g && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className={`rounded-xl border-2 border-amber-800 bg-[#1a120a] p-6 shadow-2xl ${shipPicker ? 'w-[620px]' : 'w-[480px]'}`}>
            {shipPicker ? (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="font-serif text-2xl font-bold text-amber-300">⚓ Верфь</h2>
                  <button onClick={() => setShipPicker(false)}
                    className="rounded border border-stone-600 bg-stone-900 px-3 py-1 text-xs text-stone-300 transition hover:border-amber-600 hover:text-amber-200">
                    ← Назад в гавань
                  </button>
                </div>
                <p className="mb-3 text-xs text-stone-400">
                  Смена корабля — бесплатно (песочница). Золото, груз и команда сохраняются.
                </p>
                {/* вкладки: военные / торговые */}
                <div className="mb-3 flex gap-1.5">
                  {([['war', '⚓ Военные'], ['merchant', '📦 Торговые']] as ['war' | 'merchant', string][]).map(([cat, label]) => (
                    <button key={cat} onClick={() => setPickerCat(cat)}
                      className={`pointer-events-auto rounded-lg border px-4 py-1.5 text-sm font-semibold transition ${
                        pickerCat === cat
                          ? 'border-amber-500 bg-amber-800/60 text-amber-100'
                          : 'border-stone-700 bg-stone-900/60 text-stone-400 hover:text-amber-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* список судов по классам */}
                <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                  {(() => {
                    const ships = ENCYCLOPEDIA.filter(s => s.category === pickerCat);
                    const groups: { cls: string; ships: typeof ships }[] = [];
                    for (const s of ships) {
                      let grp = groups.find(g => g.cls === s.shipClass);
                      if (!grp) { grp = { cls: s.shipClass, ships: [] }; groups.push(grp); }
                      grp.ships.push(s);
                    }
                    return groups.map(grp => (
                      <div key={grp.cls}>
                        <div className="sticky top-0 z-10 bg-[#1a120a] py-1 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">
                          {grp.cls}
                        </div>
                        {grp.ships.map(sh => {
                          const current = sh.id === hud.shipId;
                          return (
                            <button key={sh.id} disabled={current}
                              onClick={() => { act(gg => gg.changeShip(sh.id)); setShipPicker(false); }}
                              className={`mb-1 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                                current
                                  ? 'border-amber-500/80 bg-amber-900/40'
                                  : 'border-stone-700 bg-stone-900/60 hover:border-amber-700 hover:bg-stone-800/70'}`}>
                              <span className="min-w-0">
                                <span className={`block truncate text-sm font-semibold ${current ? 'text-amber-200' : 'text-stone-200'}`}>{sh.name}</span>
                                <span className="text-[10px] text-stone-500">
                                  {sh.year ? `${sh.year} · ${sh.country}` : sh.era}{sh.oars ? ' · 🚣 гребной' : ''}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-3 text-[11px] text-stone-400">
                                <span title="орудий на борт">💥{sh.stats.guns}</span>
                                <span title="экипаж">🧑‍⚖{sh.stats.crew}</span>
                                <span title="скорость, уз">💨{sh.stats.speed}</span>
                                <span title="прочность корпуса">🛡{sh.stats.hullHP}</span>
                                <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${
                                  current ? 'border-amber-600 bg-amber-800/50 text-amber-200' : 'border-stone-600 bg-stone-800 text-stone-300'}`}>
                                  {current ? 'Текущий' : 'Взять'}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-1 font-serif text-2xl font-bold text-amber-300">⚓ Пальмовая гавань</h2>
                <p className="mb-4 text-xs text-stone-400">Верфь · Таверна · Рынок — всё в одном месте</p>
                <div className="mb-3 rounded-lg border border-amber-900/50 bg-black/30 p-3 text-sm">
                  <div className="mb-2 flex justify-between">
                    <span className="text-stone-400">Золото</span>
                    <span className="font-bold text-amber-300">🪙 {hud.gold}</span>
                  </div>
                  <div className="flex justify-between text-xs text-stone-400">
                    <span>Корабль</span>
                    <span className="text-amber-200">{hud.shipName || '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs text-stone-400">
                    <span>Корпус</span>
                    <span>{Math.round(hud.hullPct * 100)}% · ремонт {g.repairCost} зол.</span>
                  </div>
                  <div className="flex justify-between text-xs text-stone-400">
                    <span>Команда</span>
                    <span>{hud.crew} / {hud.maxCrew} · найм 30 зол.</span>
                  </div>
                </div>
                {portMsg && <div className="mb-3 rounded border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{portMsg}</div>}
                <button onClick={() => { setShipPicker(true); setPortMsg(null); }}
                  className="pointer-events-auto mb-2 w-full rounded-lg border border-amber-700 bg-gradient-to-b from-amber-700/40 to-amber-900/40 px-3 py-2 text-left text-sm transition hover:border-amber-500 hover:from-amber-700/60">
                  ⚓ Сменить корабль на верфи<div className="text-[11px] text-stone-400">29 судов: военные и торговые, от шлюпа до линейного корабля</div>
                </button>
                <div className="grid grid-cols-2 gap-2 text-sm">
              <button onClick={() => act(gg => gg.portRepair())}
                className="pointer-events-auto rounded-lg border border-amber-800 bg-amber-900/40 px-3 py-2 text-left transition hover:bg-amber-800/50">
                🔨 Полный ремонт<div className="text-[11px] text-stone-400">корпус + паруса, {g.repairCost} зол.</div>
              </button>
              <button onClick={() => act(gg => gg.portSellCargo())}
                className="pointer-events-auto rounded-lg border border-amber-800 bg-amber-900/40 px-3 py-2 text-left transition hover:bg-amber-800/50">
                📦 Продать груз<div className="text-[11px] text-stone-400">сахар 24 · ром 46 · дерево 9</div>
              </button>
              <button onClick={() => act(gg => gg.portBuyAmmo('ball'))}
                className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-left transition hover:bg-stone-800">
                ⚫ Ядра ×10<div className="text-[11px] text-stone-400">4 зол.</div>
              </button>
              <button onClick={() => act(gg => gg.portBuyAmmo('grape'))}
                className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-left transition hover:bg-stone-800">
                🧨 Картечь ×10<div className="text-[11px] text-stone-400">5 зол.</div>
              </button>
              <button onClick={() => act(gg => gg.portBuyAmmo('chain'))}
                className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-left transition hover:bg-stone-800">
                ⛓ Книппели ×5<div className="text-[11px] text-stone-400">9 зол. · рвут паруса</div>
              </button>
              <button onClick={() => act(gg => gg.portBuyAmmo('fire'))}
                className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-left transition hover:bg-stone-800">
                🔥 Зажигательные ×10<div className="text-[11px] text-stone-400">12 зол. · поджигают</div>
              </button>
              <button onClick={() => act(gg => gg.portBuyPlanks())}
                className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-left transition hover:bg-stone-800">
                🪵 Доски ×5<div className="text-[11px] text-stone-400">15 зол. · ремонт в море</div>
              </button>
              <button onClick={() => act(gg => gg.portHireCrew())}
                className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-2 text-left transition hover:bg-stone-800">
                🧑‍⚓ Нанять матроса<div className="text-[11px] text-stone-400">30 зол. · быстрее перезарядка</div>
              </button>
            </div>
            <button onClick={() => { act(gg => gg.undock()); setPortMsg(null); setShipPicker(false); }}
              className="pointer-events-auto mt-4 w-full rounded-lg border border-amber-600 bg-gradient-to-b from-amber-600 to-amber-800 px-4 py-2.5 font-serif font-bold text-amber-50 transition hover:from-amber-500 active:scale-[0.98]">
              Отдать швартовы!
            </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- карта ---- */}
      {mapOpen && hud && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60" onClick={() => setMapOpen(false)}>
          <div className="rounded-xl border-2 border-amber-800 bg-[#12222a] p-3 shadow-2xl">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <span className="font-serif text-lg font-bold text-amber-200">Навигационная карта</span>
              <span className="text-xs text-stone-400">Tab / клик — закрыть · 🖱 клик по острову — быстрое перемещение</span>
            </div>
            <canvas ref={mapCanvasRef} width={640} height={520}
              onClick={onMapClick}
              className="cursor-pointer rounded-lg" />
            <div className="mt-2 flex justify-center gap-4 text-[11px] text-stone-400">
              <span><span className="text-sky-300">▲</span> — ваш корабль</span>
              <span><span className="text-amber-400">●</span> — торговец</span>
              <span><span className="text-red-400">●</span> — военный</span>
              <span><span className="text-stone-200">●</span> — сдался</span>
            </div>
          </div>
        </div>
      )}

      {/* ---- помощь ---- */}
      {helpOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60" onClick={() => setHelpOpen(false)}>
          <div className="w-[520px] rounded-xl border-2 border-amber-800 bg-[#1a120a] p-6 font-serif shadow-2xl">
            <h2 className="mb-4 text-center text-xl font-bold text-amber-300">⚓ Судовой журнал</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs text-stone-300">
              <div><b className="text-amber-200">{keyLabel(settings.controls.sailsUp)} / {keyLabel(settings.controls.sailsDown)}</b> — поднять/убрать паруса (0–3)</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.steerLeft)} / {keyLabel(settings.controls.steerRight)}</b> — руль (инерция!)</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.sailsDown)} (держать)</b> — задний ход на вёслах</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.anchor)}</b> — якорь</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.aimPort)}</b> — прицел левый борт</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.aimStarboard)}</b> — прицел правый борт / действие</div>
              <div><b className="text-amber-200">Мышь</b> — наведение в прицеле</div>
              <div><b className="text-amber-200">Колесо</b> — зум</div>
              <div><b className="text-amber-200">ЛКМ</b> — выстрел орудия</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.fire)}</b> — залп всем бортом</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.ammo[0])}–{keyLabel(settings.controls.ammo[3])}</b> — ядро/книппель/картечь/зажигат.</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.repair)} (держать)</b> — тушить/откачивать/чинить</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.camera)}</b> — камера: изометрия → корма → борт → свободная</div>
              <div><b className="text-amber-200">ПКМ (в свободной)</b> — вращение камеры</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.map)}</b> — карта</div>
              <div><b className="text-amber-200">{keyLabel(settings.controls.help)}</b> — эта справка</div>
            </div>
            <div className="mt-4 border-t border-amber-900/50 pt-3 text-[11px] leading-relaxed text-stone-400">
              <p><b className="text-amber-200">Мореходство:</b> против ветра (левентик) корабль почти не идёт — лавируйте галсами.
              Лучший ход — галфвинд (ветер в борт). В шторм рифите паруса.</p>
              <p className="mt-1.5"><b className="text-amber-200">Добыча:</b> дырявьте торговцам паруса книппелями, корпус — ядрами,
              команду — картечью. Сдавшийся корабль — это приз: подойдите и нажмите E.</p>
            </div>
          </div>
        </div>
      )}
      {/* ---- настройки ---- */}
      {settingsOpen && (
        <SettingsPanel initial={settings} onApply={applySettings} onClose={closeSettings} />
      )}
      {/* ---- энциклопедия кораблей ---- */}
      {encyOpen && (() => {
        const e = ENCYCLOPEDIA.find(s => s.id === encyId) ?? ENCYCLOPEDIA[0];
        return (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setEncyOpen(false)}>
            <div className="w-[780px] max-h-[88vh] overflow-hidden rounded-xl border-2 border-amber-800 bg-[#1a120a] shadow-2xl"
              onClick={ev => ev.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-amber-900/60 px-5 py-3">
                <h2 className="font-serif text-xl font-bold text-amber-300">📖 Энциклопедия кораблей</h2>
                <span className="text-[10px] text-stone-500">3D-модель: вращайте мышью, масштаб — колесом</span>
                <button onClick={() => setEncyOpen(false)}
                  className="rounded border border-stone-600 bg-stone-900 px-3 py-1 text-xs text-stone-300 hover:border-amber-600 hover:text-amber-200">
                  Закрыть
                </button>
              </div>
              <div className="flex max-h-[74vh]">
                {/* список судов: военные / торговые */}
                <div className="w-52 shrink-0 overflow-y-auto border-r border-amber-900/40 py-2">
                  {(['war', 'merchant'] as const).map(cat => (
                    <div key={cat}>
                      <div className="sticky top-0 z-10 bg-[#1a120a] px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">
                        {cat === 'war' ? '⚓ Военные' : '📦 Торговые'}
                      </div>
                      {ENCYCLOPEDIA.filter(s => s.category === cat).map(s => (
                        <button key={s.id} onClick={() => setEncyId(s.id)}
                          className={`block w-full px-4 py-1.5 text-left text-xs leading-tight transition ${
                            s.id === encyId
                              ? 'bg-amber-700/50 text-amber-100'
                              : 'text-stone-400 hover:bg-stone-800/60 hover:text-amber-200'}`}>
                          <span className="block font-semibold">{s.name}</span>
                          <span className="text-[10px] text-stone-500">{s.shipClass}{s.oars ? ' · 🚣' : ''}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                {/* статья */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-serif text-lg font-bold text-amber-200">{e.name}</h3>
                    <span className="rounded border border-amber-800/60 bg-stone-900/70 px-2 py-0.5 text-[10px] text-amber-300/90">{e.role}</span>
                  </div>
                  {/* бейджи: тип · класс · страна · год · гребной */}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className={`rounded border px-1.5 py-0.5 font-semibold ${
                      e.category === 'war' ? 'border-red-800/70 bg-red-950/40 text-red-300' : 'border-amber-800/70 bg-amber-950/40 text-amber-300'}`}>
                      {e.category === 'war' ? '⚓ Военный' : '📦 Торговый'}
                    </span>
                    <span className="rounded border border-stone-700 bg-stone-900/60 px-1.5 py-0.5 text-stone-300">{e.shipClass}</span>
                    {e.country && <span className="rounded border border-stone-700 bg-stone-900/60 px-1.5 py-0.5 text-stone-300">{e.country}</span>}
                    {e.year && <span className="rounded border border-stone-700 bg-stone-900/60 px-1.5 py-0.5 text-stone-300">{e.year} г.</span>}
                    {e.oars ? <span className="rounded border border-sky-800/70 bg-sky-950/40 px-1.5 py-0.5 text-sky-300">🚣 гребной · {e.oars} вёсел/борт</span> : null}
                  </div>
                  {/* 3D-модель корабля */}
                  <div className="mt-3 h-[230px] shrink-0 overflow-hidden rounded-lg border border-stone-700/60">
                    <ShipViewer3D presetId={e.id} />
                  </div>
                  {/* ТТХ */}
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {([
                      ['Длина', `${e.stats.length} м`],
                      ['Ширина', `${e.stats.beam} м`],
                      ['Мачты', `${e.stats.masts}`],
                      ['Орудий/борт', `${e.stats.guns}`],
                      ['Экипаж', `${e.stats.crew}`],
                      ['Ход', `${e.stats.speed.toFixed(1)} уз`],
                      ['Корпус', `${e.stats.hullHP}`],
                      ['Трюм', `${e.stats.cargo}`],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="rounded border border-stone-700/70 bg-stone-900/50 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wide text-stone-500">{k}</div>
                        <div className="text-xs font-bold text-amber-200">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded border border-stone-700/60 bg-stone-900/40 px-3 py-2 text-[11px] leading-relaxed text-stone-300">
                    <span className="text-amber-300/80">Парусное вооружение: </span>{e.rigging}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-stone-300">{e.desc}</p>
                  <p className="mt-2 text-xs leading-relaxed text-stone-400">
                    <span className="font-semibold text-amber-300/90">⚓ Тактика: </span>{e.tactics}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}
