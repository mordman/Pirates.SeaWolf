'use client';

// ============================================================
// Task 52: PREVIEW-СТРАНИЦА ДЕТАЛЬНОГО МАТРОСА (/crew) — по ТЗ
// игрока на модель: OrbitControls (вращение камеры вокруг
// персонажа), трёхточечное освещение (Key + Fill + Rim) с
// мягкими тенями (PCFSoftShadowMap), процедурное «оживление» в
// animate() — дыхание грудной клетки, покачивание рук, моргание
// глаз. Модель — та же, что в игре (crewDetailed.ts), можно
// листать типы судов и внешность
// ============================================================

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildDetailedFigure, animateCrewDetail, detailTris, CrewDetailState } from '@/game/ship/crewDetailed';
// (buildDetailedFigure для диагностического хука ниже)
import { rollTraits, buildFigure } from '@/game/ship/crew';
import type { CrewKind } from '@/game/ship/crew';

const KINDS: CrewKind[] = ['pirate', 'navy', 'merchant'];

interface CrewViewInfo {
  tris: number;
  parts: number;
  lights: number;
  animated: boolean;
  kind: CrewKind;
  seed: number;
  hair: string;
  glasses: boolean;
  bald: boolean;
}

export default function CrewViewPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<CrewKind>('pirate');
  const [seed, setSeed] = useState(1234);
  const [info, setInfo] = useState<CrewViewInfo | null>(null);
  const rebuildRef = useRef<((k: CrewKind, s: number) => void) | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    // --- рендерер: мягкие тени PCFSoftShadowMap (по ТЗ) ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x23262e);
    scene.fog = new THREE.Fog(0x23262e, 16, 34);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.05, 100);
    camera.position.set(0.42, 1.30, 2.30);

    // --- ОРБИТА камеры вокруг персонажа (по ТЗ) ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.45;
    controls.maxDistance = 7;
    controls.update();

    // --- ТРЁХТОЧЕЧНОЕ ОСВЕЩЕНИЕ (по ТЗ): Key + Fill + Rim ---
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6);   // ключевой, тёплый
    key.position.set(2.4, 5.2, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0016;
    key.shadow.radius = 6;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0e8, 1.6);  // заполняющий, холодный
    fill.position.set(-1.8, 2.6, 3.4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xdbe6ff, 1.6);   // контровой
    rim.position.set(-1.2, 2.6, -3.6);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x4a4f5a, 0.85));       // мягкая подсветка теней

    // подиум: палубные доски — круг под ногами, ловит тень
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.12, 0.09, 40),
      new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.85 }));
    podium.position.y = -0.045;
    podium.receiveShadow = true;
    scene.add(podium);
    for (let i = 0; i < 7; i++) {   // стыки досок
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.012, 0.012),
        new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 }));
      seam.position.set(0, 0.001, -0.9 + i * 0.3);
      seam.rotation.y = 0.18;
      scene.add(seam);
    }

    // --- фигура (та же, что в игре) ---
    let figure: THREE.Group | null = null;
    let detail: CrewDetailState | null = null;
    let curTris = 0;
    let curTraits: ReturnType<typeof rollTraits> | null = null;
    const build = (k: CrewKind, s: number) => {
      if (figure) {
        scene.remove(figure);
        figure.traverse(o => {
          const m = o as THREE.Mesh;
          if ((m as unknown as { isMesh?: boolean }).isMesh) m.geometry.dispose();
        });
      }
      const traits = rollTraits(mul(s), 'walker', k);
      curTraits = traits;
      const f = buildDetailedFigure('walker', traits, s, true);
      figure = f.group;
      detail = f.detail ?? null;
      figure.traverse(o => {
        const m = o as THREE.Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      scene.add(figure);   // лицом к +Z — как на палубе (носовая
                          // камера превью смотрит со стороны +Z)
      curTris = detailTris(figure);
      const parts = (() => { let n = 0; figure!.traverse(() => { n++; }); return n; })();
      setInfo({
        tris: curTris, parts, lights: 3, animated: true,
        kind: k, seed: s,
        hair: traits.hair, glasses: traits.glasses, bald: traits.bald,
      });
    };
    // детерминированный RNG для rollTraits (seed → фигура воспроизводима)
    function mul(seedValue: number) {
      let a = seedValue >>> 0;
      return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    build(kind, seed);
    rebuildRef.current = build;

    // --- animate(): оживление по ТЗ (дыхание/руки/моргание) ---
    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      if (detail) animateCrewDetail(detail, t, dt);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // хук для e2e: состояние страницы
    const info2 = () => ({
      tris: curTris,
      shadows: renderer.shadowMap.enabled,
      shadowType: 'PCFSoft',
      lights: 3,
      orbit: true,
      animated: !!detail,
      kind, seed,
      headwear: curTraits?.headwear ?? '',
      hair: curTraits?.hair ?? '',
      bald: !!curTraits?.bald,
      glasses: !!curTraits?.glasses,
      torso: curTraits?.torso ?? '',
    });
    (window as unknown as Record<string, unknown>).__crewView = info2;
    // Task 52: диагностический доступ к сцене (ориентация и пробы)
    (window as unknown as Record<string, unknown>).__crewScene = () => scene;
    (window as unknown as Record<string, unknown>).__crewCamera = () => camera;
    (window as unknown as Record<string, unknown>).__crewTHREE = THREE;
    (window as unknown as Record<string, unknown>).__crewImports = { buildFigure, rollTraits, buildDetailed: buildDetailedFigure };
    // Task 52: ракурсы для e2e/VLM — камера к лицу/кисти/обуви/общий
    (window as unknown as Record<string, unknown>).__crewCam = (view: string) => {
      const V: Record<string, [number, number, number, number, number, number]> = {
        full: [0.42, 1.30, 2.30, 0, 0.92, 0],
        face: [0.06, 1.46, 0.80, 0, 1.40, 0],
        hand: [0.30, 1.02, 0.66, 0.16, 0.76, 0.10],
        feet: [0.22, 0.32, 0.80, 0, 0.14, 0.04],
        back: [0, 1.35, -0.6, 0, 1.35, 0],
      };
      const v = V[view] ?? V.full;
      camera.position.set(v[0], v[1], v[2]);
      controls.target.set(v[3], v[4], v[5]);
      controls.update();
      return view;
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      rebuildRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextSailor = () => {
    const s = (Math.random() * 100000) | 0;
    setSeed(s);
    rebuildRef.current?.(kind, s);
  };
  const changeKind = (k: CrewKind) => {
    setKind(k);
    rebuildRef.current?.(k, (Math.random() * 100000) | 0);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#16181d]">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-amber-900/40 bg-stone-950/80 px-4 py-3 text-stone-200 shadow-lg backdrop-blur">
        <div className="text-sm font-semibold tracking-wide text-amber-200">🔭 Верфь: детальный матрос</div>
        {info && (
          <div className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
            Тип: <span className="text-stone-200">{info.kind === 'pirate' ? 'пират' : info.kind === 'navy' ? 'солдат' : 'торговец'}</span> · сид #{info.seed}
            <br />
            Причёска: <span className="text-stone-200">{{ short: 'короткая', long: 'длинная', ponytail: 'хвостик', wild: 'патлы' }[info.hair] ?? info.hair}</span>
            {info.bald && ' · лысина'}{info.glasses && ' · очки'}
            <br />
            Треугольников: <span className="text-stone-200">{info.tris.toLocaleString('ru-RU')}</span> · объектов: {info.parts}
            <br />
            Свет: Key+Fill+Rim · тени PCFSoft · дыхание/моргание
          </div>
        )}
      </div>
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
        {KINDS.map(k => (
          <button key={k}
            onClick={() => changeKind(k)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              kind === k
                ? 'border-amber-600 bg-amber-900/40 text-amber-200'
                : 'border-stone-700 bg-stone-900/70 text-stone-300 hover:border-stone-500'
            }`}>
            {k === 'pirate' ? '🏴‍☠️ Пираты' : k === 'navy' ? '⚓ Солдаты' : '📦 Торговцы'}
          </button>
        ))}
        <button onClick={nextSailor}
          className="rounded-md border border-amber-700 bg-amber-900/50 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-800/60">
          🎲 Следующий матрос
        </button>
      </div>
      <a href="/" className="absolute right-4 top-4 z-10 rounded-md border border-stone-700 bg-stone-900/80 px-3 py-1.5 text-xs text-stone-300 hover:border-stone-500">
        ← В игру
      </a>
      <div className="pointer-events-none absolute bottom-4 right-4 z-10 text-[10px] text-stone-500">
        мышь — вращение · колесо — зум · ПКМ — панорама
      </div>
    </div>
  );
}
