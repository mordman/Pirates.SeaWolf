'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlayerAppearance, HeadwearKind } from '@/game/core/settings';
import {
  APPEARANCE_SKIN, APPEARANCE_SHIRT, APPEARANCE_PANTS,
  HEADWEAR_LABELS, BEARD_LABELS,
} from '@/game/core/settings';
import { buildFigure } from '@/game/ship/crew';
import { appearanceToTraits, randomAppearance } from '@/game/player/appearance';

// ============================================================
// ЭКРАН СОЗДАНИЯ КАПИТАНА (Task 39): показывается в самом начале
// игры — выбор внешности фигурки игрока (высадка на остров):
// тон кожи, рубаха, штаны, головной убор, борода, повязка на
// глаз, ПОПУГАЙ на плече, деревянная нога, крюк.
// Слева — живое 3D-превью (та же процедурная фигурка, что и в
// игре, медленно вращается), справа — кнопки-палитры. Выбор
// применяется сразу и сохраняется в настройках (раздел player).
// ============================================================

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function Swatches({ colors, value, onPick, title }: {
  colors: readonly number[]; value: number; onPick: (c: number) => void; title: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={title}>
      {colors.map(c => (
        <button key={c} title={`${title}: ${hex(c)}`} onClick={() => onPick(c)}
          className={`h-7 w-7 rounded-full border-2 transition ${value === c
            ? 'border-amber-400 ring-2 ring-amber-400/40 scale-110'
            : 'border-stone-600 hover:border-stone-400'}`}
          style={{ backgroundColor: hex(c) }} />
      ))}
    </div>
  );
}

function PillGroup<T extends string | number>({ options, labels, value, onPick }: {
  options: readonly T[]; labels: Record<string, string>; value: T; onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={String(o)} onClick={() => onPick(o)}
          className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${value === o
            ? 'border-amber-400 bg-amber-700/50 text-amber-100'
            : 'border-stone-700 bg-stone-900/60 text-stone-300 hover:border-amber-700'}`}>
          {labels[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${on
        ? 'border-amber-400 bg-amber-700/40 text-amber-100'
        : 'border-stone-700 bg-stone-900/60 text-stone-400 hover:border-stone-500'}`}>
      <span>{label}</span>
      <span className={`h-3.5 w-6 rounded-full p-0.5 transition ${on ? 'bg-amber-500' : 'bg-stone-600'}`}>
        <span className={`block h-2.5 w-2.5 rounded-full bg-white transition ${on ? 'translate-x-2.5' : ''}`} />
      </span>
    </button>
  );
}

/** Живое 3D-превью фигурки (мини-сцена three.js, тот же buildFigure) */
function FigurePreview({ appearance }: { appearance: PlayerAppearance }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; figHolder: THREE.Group; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera } | null>(null);

  // сцена создаётся один раз
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(300, 400, false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 300 / 400, 0.1, 20);
    camera.position.set(0, 1.2, 3.6);
    camera.lookAt(0, 0.82, 0);
    // свет: тёплое солнце + рассеянный небо
    scene.add(new THREE.HemisphereLight(0xcfe4ec, 0x50412c, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(2.5, 4, 2.5);
    scene.add(sun);
    // «палуба» под ногами
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 0.07, 24),
      new THREE.MeshStandardMaterial({ color: 0x6e5433, roughness: 0.9 }));
    deck.position.y = -0.035;
    scene.add(deck);
    const figHolder = new THREE.Group();
    scene.add(figHolder);
    sceneRef.current = { scene, figHolder, renderer, camera };
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      figHolder.rotation.y = (performance.now() - t0) / 1000 * 0.55;
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      sceneRef.current = null;
    };
  }, []);

  // фигурка пересобирается при смене внешности
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    for (let i = ctx.figHolder.children.length - 1; i >= 0; i--) {
      const ch = ctx.figHolder.children[i];
      ch.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      ctx.figHolder.remove(ch);
    }
    const fig = buildFigure('walker', appearanceToTraits(appearance), 777, true);
    ctx.figHolder.add(fig.group);
  }, [appearance]);

  return <canvas ref={canvasRef} className="h-[400px] w-[300px]" aria-label="Превью капитана" />;
}

export default function CharacterCreate({ initial, onApply, onClose }: {
  initial: PlayerAppearance; onApply: (a: PlayerAppearance) => void; onClose: () => void;
}) {
  const [a, setA] = useState<PlayerAppearance>(() => ({ ...initial }));
  const set = <K extends keyof PlayerAppearance>(k: K, v: PlayerAppearance[K]) =>
    setA(prev => ({ ...prev, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-char-screen="1">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-800/50 bg-stone-950/95 shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-800 px-5 py-3">
          <div>
            <div className="text-lg font-black tracking-wide text-amber-200">⚓ Ваш капитан</div>
            <div className="text-[11px] text-stone-400">Выберите внешность моряка, который сойдёт на берег: одежда, головной убор, борода, попугай на плече…</div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-stone-700 px-2.5 py-1 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200">Позже</button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-[300px_1fr]">
          {/* превью */}
          <div className="flex items-center justify-center rounded-xl border border-stone-800 bg-gradient-to-b from-sky-950/60 to-stone-900/60">
            <FigurePreview appearance={a} />
          </div>

          {/* контролы */}
          <div className="space-y-3.5">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600/90">Кожа</div>
              <Swatches title="Кожа" colors={APPEARANCE_SKIN} value={a.skin} onPick={c => set('skin', c)} />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600/90">Рубаха</div>
              <Swatches title="Рубаха" colors={APPEARANCE_SHIRT} value={a.shirt} onPick={c => set('shirt', c)} />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600/90">Штаны</div>
              <Swatches title="Штаны" colors={APPEARANCE_PANTS} value={a.pants} onPick={c => set('pants', c)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600/90">Головной убор</div>
                <PillGroup<HeadwearKind>
                  options={['none', 'bandana', 'hat'] as HeadwearKind[]}
                  labels={HEADWEAR_LABELS as Record<string, string>}
                  value={a.headwear} onPick={v => set('headwear', v)} />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600/90">Борода</div>
                <PillGroup<0 | 1 | 2>
                  options={[0, 1, 2] as const}
                  labels={BEARD_LABELS as unknown as Record<string, string>}
                  value={a.beard} onPick={v => set('beard', v)} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600/90">Приметы</div>
              <div className="grid grid-cols-2 gap-1.5">
                <Toggle label="🦜 Попугай на плече" on={a.parrot} onToggle={() => set('parrot', !a.parrot)} />
                <Toggle label="🏴‍☠️ Повязка на глаз" on={a.eyePatch} onToggle={() => set('eyePatch', !a.eyePatch)} />
                <Toggle label="🦵 Деревянная нога" on={a.pegLeg} onToggle={() => set('pegLeg', !a.pegLeg)} />
                <Toggle label="🪝 Крюк вместо кисти" on={a.hook} onToggle={() => set('hook', !a.hook)} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-stone-800 px-5 py-3">
          <button onClick={() => setA(randomAppearance(() => Math.random()))}
            className="rounded-lg border border-stone-700 bg-stone-900/60 px-4 py-2 text-xs font-bold text-stone-300 transition hover:border-amber-700 hover:text-amber-200">
            🎲 Наугад
          </button>
          <button onClick={() => onApply(a)}
            className="rounded-xl border border-amber-400 bg-amber-600/80 px-8 py-2.5 text-sm font-black tracking-wide text-amber-50 shadow-lg transition hover:bg-amber-500 hover:text-white">
            В море! ⚓
          </button>
        </div>
      </div>
    </div>
  );
}
