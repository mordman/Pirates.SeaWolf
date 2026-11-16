'use client';

// ============================================================
// Task 76: PREVIEW-ВЕРФЬ ДЕТАЛЬНЫХ ПЕРСОНАЖЕЙ XVII ВЕКА (/crew)
// По ТЗ игрока:
//  - ПЯТЬ ПРОФЕССИЙ: моряк / солдат / торговец / пират / капитан
//    (кнопки + 🎲 «следующий», ☠ — облик мертвеца «Жемчужины»)
//  - ТРЁХТОЧЕЧНОЕ ОСВЕЩЕНИЕ Key+Fill+Rim, тени PCFSoftShadowMap
//  - ИНТЕРАКТИВНЫЕ РЕЖИМЫ АНИМАЦИИ (UI-панель): «Дозор на
//    палубе» (баланс при качке, дыхание, осмотр горизонта),
//    «Боевая стойка» (сабля наизготовку, выпады), «Выстрел из
//    пистолета» (фазы: выхват ЛЕВОЙ рукой → прицел → вспышка →
//    отдача → облако порохового дыма)
//  - ОКРУЖЕНИЕ ПАРУСНИКА: процедурная деревянная палуба,
//    фальшборт с ЮФЕРСАМИ, натянутые ВАНТЫ к мачте, деревянный
//    БОЧОНОК и БУХТЫ КАНАТОВ, мягкое покачивание корабля
//  - ОКЕАН: процедурные волны вокруг судна (вершинная анимация)
//  - ВЕТЕР: ползунок силы — полы кафтана, платок и перо шляпы
//    деформируются по вершинам (coatSkirt/cravat/feather)
// ============================================================

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  buildDetailedFigure, animateCrewDetail, detailTris, setDetailPoseMode,
  woolMat, leatherMat, woodMat, brassMat,
  type CrewDetailState, type DetailProfession,
} from '@/game/ship/crewDetailed';
import { rollTraits, buildFigure, type CrewKind, type CrewRole } from '@/game/ship/crew';

const PROFESSIONS: { id: DetailProfession; label: string; icon: string;
  kind: CrewKind; role: CrewRole }[] = [
  { id: 'sailor', label: 'Моряк', icon: '⚓', kind: 'merchant', role: 'watch' },
  { id: 'soldier', label: 'Солдат', icon: '⚔️', kind: 'navy', role: 'watch' },
  { id: 'merchant', label: 'Торговец', icon: '📦', kind: 'merchant', role: 'watch' },
  { id: 'pirate', label: 'Пират', icon: '🏴‍☠️', kind: 'pirate', role: 'watch' },
  { id: 'captain', label: 'Капитан', icon: '🎓', kind: 'pirate', role: 'captain' },
];

const MODES: { id: 'idle' | 'combat' | 'pistol' | 'spyglass'; label: string }[] = [
  { id: 'idle', label: 'Дозор на палубе' },
  { id: 'combat', label: 'Боевая стойка' },
  { id: 'pistol', label: 'Выстрел из пистолета' },
  { id: 'spyglass', label: '🔭 Труба' },
];

interface CrewViewInfo {
  tris: number;
  parts: number;
  lights: number;
  animated: boolean;
  kind: string;
  seed: number;
  hair: string;
  glasses: boolean;
  bald: boolean;
  profession: DetailProfession;
  undead: boolean;
}

export default function CrewViewPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [profession, setProfession] = useState<DetailProfession>('captain');
  const [seed, setSeed] = useState(1234);
  const [undead, setUndead] = useState(false);
  const [info, setInfo] = useState<CrewViewInfo | null>(null);
  const rebuildRef = useRef<((p: DetailProfession, s: number, u: boolean) => void) | null>(null);
  const poseRef = useRef<((m: 'idle' | 'combat' | 'pistol' | 'spyglass') => void) | null>(null);
  const windRef = useRef<((w: number) => void) | null>(null);

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
    scene.fog = new THREE.Fog(0x23262e, 18, 42);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.05, 120);
    camera.position.set(0.55, 1.15, 2.6);

    // --- ОРБИТА камеры вокруг персонажа (по ТЗ) ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.85, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.45;
    controls.maxDistance = 8;
    controls.update();

    // --- ТРЁХТОЧЕЧНОЕ ОСВЕЩЕНИЕ (по ТЗ): Key + Fill + Rim ---
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6);   // ключевой, тёплый
    key.position.set(2.4, 5.2, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0016;
    key.shadow.radius = 6;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0e8, 1.5);  // заполняющий, холодный
    fill.position.set(-1.8, 2.6, 3.4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xdbe6ff, 1.6);   // контровой
    rim.position.set(-1.2, 2.6, -3.6);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x4a4f5a, 0.85));

    // ================== ОКЕАН (процедурные волны вокруг судна) ==================
    const oceanGeo = new THREE.PlaneGeometry(52, 52, 40, 40);
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanBase = Float32Array.from(oceanGeo.attributes.position.array);
    const ocean = new THREE.Mesh(oceanGeo, new THREE.MeshStandardMaterial({
      color: 0x1d5a6e, roughness: 0.32, metalness: 0.12,
    }));
    ocean.position.y = -0.62;
    scene.add(ocean);

    // ================== ФРАГМЕНТ ПАЛУБЫ ПАРУСНИКА ==================
    const shipRoot = new THREE.Group();
    scene.add(shipRoot);
    const mDeck = [woodMat(0x8a6a45), woodMat(0x7a5c3a), woodMat(0x93745c)];
    // настил из ДОСОК (со швами-конопаткой и разбросом тона)
    for (let i = 0; i < 11; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(3.55, 0.045, 0.30),
        mDeck[i % 3]);
      plank.position.set((i % 2) * 0.02 - 0.01, 0.022, -1.62 + i * 0.325);
      plank.rotation.y = (i % 3) * 0.004;
      plank.receiveShadow = true;
      shipRoot.add(plank);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.1, 3.7), woodMat(0x332418));
    base.position.y = -0.05;
    base.receiveShadow = true;
    shipRoot.add(base);
    // ФАЛЬШБОРТ (задний + борта; носовая сторона открыта к камере)
    const mBulwark = woodMat(0x5a4028);
    const mkWall = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mBulwark);
      wall.position.set(x, y, z);
      wall.rotation.y = ry;
      wall.castShadow = wall.receiveShadow = true;
      shipRoot.add(wall);
      return wall;
    };
    mkWall(3.7, 0.52, 0.07, 0, 0.30, -1.80);
    mkWall(0.07, 0.52, 3.6, -1.80, 0.30, 0.05);
    mkWall(0.07, 0.52, 3.6, 1.80, 0.30, 0.05);
    // планширь (верхний пояс)
    const mkRail = (w: number, d: number, x: number, z: number) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), woodMat(0x6a4e2e));
      rail.position.set(x, 0.58, z);
      rail.castShadow = rail.receiveShadow = true;
      shipRoot.add(rail);
    };
    mkRail(3.8, 0.13, 0, -1.80);
    mkRail(0.13, 3.65, -1.80, 0.05);
    mkRail(0.13, 3.65, 1.80, 0.05);
    // ВАНТЫ: мачта-стуб у левого кормового угла + натянутые тросы
    const mRope = new THREE.MeshStandardMaterial({ color: 0x7d6845, roughness: 1 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 3.3, 9), woodMat(0x4a3020));
    mast.position.set(-1.35, 1.65, -1.35);
    mast.castShadow = true;
    shipRoot.add(mast);
    const ropeBetween = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5), mRope);
      seg.position.copy(a).addScaledVector(dir, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      seg.castShadow = true;
      shipRoot.add(seg);
    };
    // ЮФЕРСЫ вдоль планширя + ванты к топу мачты (по ТЗ)
    for (let i = 0; i < 4; i++) {
      const dx = -1.45 + i * 0.95;
      // юферс: деревянный диск с тремя проточками
      const deadeye = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 12), woodMat(0x6a4a28));
      deadeye.rotation.x = Math.PI / 2;
      deadeye.position.set(dx, 0.46, -1.74);
      deadeye.castShadow = true;
      shipRoot.add(deadeye);
      for (let k = -1; k <= 1; k++) {
        const groove = new THREE.Mesh(new THREE.TorusGeometry(0.038 - k * 0.004, 0.004, 4, 10), mRope);
        groove.position.set(dx + k * 0.013, 0.46, -1.735);
        shipRoot.add(groove);
      }
      // лопарь (кончик троса) сквозь юферс вниз к палубе
      ropeBetween(new THREE.Vector3(dx, 0.44, -1.74), new THREE.Vector3(dx, 0.16, -1.76), 0.005);
      // ВАНТА к топу мачты
      ropeBetween(new THREE.Vector3(dx, 0.5, -1.74),
        new THREE.Vector3(-1.35 + (i - 1.5) * 0.055, 3.05, -1.35 + (i - 1.5) * 0.05), 0.008);
    }
    // БОЧОНОК (клёпки + латунные обручи, по ТЗ)
    {
      const barrel = new THREE.Group();
      barrel.position.set(1.15, 0.24, -1.05);
      shipRoot.add(barrel);
      const staves = new THREE.Mesh(
        new THREE.LatheGeometry([
          new THREE.Vector2(0.02, -0.22), new THREE.Vector2(0.15, -0.2),
          new THREE.Vector2(0.185, -0.08), new THREE.Vector2(0.19, 0),
          new THREE.Vector2(0.185, 0.08), new THREE.Vector2(0.15, 0.2),
          new THREE.Vector2(0.02, 0.22),
        ], 14), mDeck[1]);
      staves.castShadow = staves.receiveShadow = true;
      barrel.add(staves);
      for (const hy of [-0.14, 0.02, 0.16]) {
        const hoop = new THREE.Mesh(
          new THREE.TorusGeometry(0.19 - Math.abs(hy) * 0.2, 0.011, 5, 18), brassMat());
        hoop.rotation.x = Math.PI / 2;
        hoop.position.y = hy;
        barrel.add(hoop);
      }
      const bung = new THREE.Mesh(new THREE.CircleGeometry(0.03, 8), woodMat(0x332418));
      bung.position.set(0.19, 0.03, 0);
      bung.rotation.y = Math.PI / 2;
      barrel.add(bung);
    }
    // БУХТЫ КАНАТОВ на палубе (по ТЗ)
    for (const [cx, cz] of [[0.95, 1.05], [-0.95, 0.55]] as [number, number][]) {
      for (let i = 0; i < 3; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24 - i * 0.014, 0.038, 7, 20), mRope);
        coil.rotation.x = Math.PI / 2;
        coil.position.set(cx, 0.045 + i * 0.052, cz);
        coil.rotation.z = i * 0.5;
        coil.castShadow = coil.receiveShadow = true;
        shipRoot.add(coil);
      }
    }

    // ================== ФИГУРА (та же, что в игре) ==================
    let figure: THREE.Group | null = null;
    let detail: CrewDetailState | null = null;
    let curTris = 0;
    let curTraits: ReturnType<typeof rollTraits> | null = null;
    let curProfession: DetailProfession = 'captain';
    let curUndead = false;
    let windPower = 0.7;
    const build = (p: DetailProfession, s: number, u: boolean) => {
      if (figure) {
        scene.remove(figure);
        figure.traverse(o => {
          const m = o as THREE.Mesh;
          if ((m as unknown as { isMesh?: boolean }).isMesh) m.geometry.dispose();
        });
      }
      const def = PROFESSIONS.find(pp => pp.id === p)!;
      const traits = rollTraits(mul(s), def.role, def.kind);
      curTraits = traits;
      curProfession = p;
      curUndead = u;
      const f = buildDetailedFigure(def.role, traits, s, false, u, p);
      figure = f.group;
      detail = f.detail ?? null;
      figure.traverse(o => {
        const m = o as THREE.Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      figure.position.set(0, 0.045, 0.25);
      scene.add(figure);   // лицом к +Z — к камере превью
      curTris = detailTris(figure);
      const parts = (() => { let n = 0; figure!.traverse(() => { n++; }); return n; })();
      setInfo({
        tris: curTris, parts, lights: 3, animated: true,
        kind: p, seed: s, hair: traits.hair, glasses: traits.glasses, bald: traits.bald,
        profession: p, undead: u,
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
    build('captain', 1234, false);
    rebuildRef.current = build;
    poseRef.current = (m) => { if (detail) setDetailPoseMode(detail, m); };
    windRef.current = (w) => { windPower = w; };

    // --- animate(): качка корабля + океан + оживление по ТЗ ---
    // (шаг вынесен в stepFrame: rAF гоняет петля, а e2e может
    //  детерминированно проталкивать время через __crewStep)
    const clock = new THREE.Clock();
    let vt = 0;                       // виртуальное время сцены
    let raf = 0;
    const stepFrame = (dt: number) => {
      vt += dt;
      const t = vt;
      // мягкое ПОКАЧИВАНИЕ КОРАБЛЯ (по ТЗ)
      const roll = Math.sin(t * 0.55) * 0.05 + Math.sin(t * 0.23 + 1.7) * 0.016;
      const pitch = Math.sin(t * 0.4 + 0.6) * 0.022;
      shipRoot.rotation.z = roll;
      shipRoot.rotation.x = pitch;
      shipRoot.position.y = Math.sin(t * 0.5 + 0.9) * 0.05;
      // ОКЕАН: процедурные волны (вершинная анимация)
      {
        const p = oceanGeo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = oceanBase[i * 3], z = oceanBase[i * 3 + 2];
          p.setY(i, -0.62
            + Math.sin(x * 0.30 + t * 1.1) * 0.055
            + Math.sin(z * 0.24 - t * 0.9 + 2.1) * 0.045
            + Math.sin((x + z) * 0.16 + t * 0.6) * 0.03);
        }
        p.needsUpdate = true;
        oceanGeo.computeVertexNormals();
      }
      // оживление фигуры: дыхание/равновесие/осмотр/моргание/ветер/позы
      if (detail) animateCrewDetail(detail, t, dt, { roll, pitch, wind: windPower });
      controls.update();
      renderer.render(scene, camera);
    };
    const animate = () => {
      raf = requestAnimationFrame(animate);
      stepFrame(Math.min(0.05, clock.getDelta()));
    };
    animate();

    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // хук для e2e: состояние страницы (совместимо с v70 F2/F3)
    const info2 = () => ({
      tris: curTris,
      shadows: renderer.shadowMap.enabled,
      shadowType: 'PCFSoft',
      lights: 3,
      orbit: true,
      animated: !!detail,
      kind: curProfession,
      seed,
      headwear: curTraits?.headwear ?? '',
      hair: curTraits?.hair ?? '',
      bald: !!curTraits?.bald,
      glasses: !!curTraits?.glasses,
      torso: curTraits?.torso ?? '',
      profession: curProfession,
      undead: curUndead,
    });
    (window as unknown as Record<string, unknown>).__crewView = info2;
    // Task 76: позы/выстрел/ветер/снаряжение — телеметрия e2e
    (window as unknown as Record<string, unknown>).__crewPose = () => {
      if (!detail) return null;
      // максимальное отклонение вершин ПЕРА (вершинный ветер живой)
      let featherDx = 0;
      const fw = detail.wind.find(w => w.kind === 'feather');
      if (fw) {
        const p = fw.mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const d = Math.abs(p.getX(i) - fw.base[i * 3]) + Math.abs(p.getZ(i) - fw.base[i * 3 + 2]);
          if (d > featherDx) featherDx = d;
        }
      }
      let skirtDx = 0;
      const sw = detail.wind.find(w => w.kind === 'skirt');
      if (sw) {
        const p = sw.mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const d = Math.abs(p.getX(i) - sw.base[i * 3]);
          if (d > skirtDx) skirtDx = d;
        }
      }
      // Task 77: ГЕОМЕТРИЯ трубы (калибровка/e2e): где окуляр,
      // куда смотрит ось, расстояние до головы, скрыта ли сабля
      let spyGeo: null | {
        eye: number[]; axis: number[]; head: number[];
        distEyeHead: number; cutlassVisible: boolean | null;
      } = null;
      if (detail.spyglass && detail.spyglass.inHand) {
        const obj = detail.spyglass.obj;
        const wp = obj.getWorldPosition(new THREE.Vector3());
        const wq = obj.getWorldQuaternion(new THREE.Quaternion());
        const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
        const eye = wp.clone().addScaledVector(axis, -0.088);
        const head = detail.head.getWorldPosition(new THREE.Vector3());
        spyGeo = {
          eye: eye.toArray().map(v => +v.toFixed(3)),
          axis: axis.toArray().map(v => +v.toFixed(3)),
          head: head.toArray().map(v => +v.toFixed(3)),
          distEyeHead: +eye.distanceTo(head).toFixed(3),
          cutlassVisible: detail.cutlassObj ? detail.cutlassObj.visible : null,
        };
      }
      return {
        profession: detail.profession,
        pose: detail.pose,
        pistolPhase: detail.pistol ? detail.pistol.phase : null,
        pistolInHand: detail.pistol ? detail.pistol.inHand : false,
        // Task 77: подзорная труба — фазы/кисть/выдвижение колен
        spyPhase: detail.spyglass ? detail.spyglass.phase : null,
        spyInHand: detail.spyglass ? detail.spyglass.inHand : false,
        spyExt: detail.spyglass ? +detail.spyglass.ext.toFixed(3) : 0,
        spySections: detail.spyglass ? detail.spyglass.sections.length : 0,
        spyArm: detail.spyglass ? detail.spyglass.arm : null,
        spyGeo,
        windItems: detail.wind.map(w => w.kind),
        featherDx: +featherDx.toFixed(4),
        skirtDx: +skirtDx.toFixed(4),
        charges: detail.charges,
        hasCutlass: detail.hasCutlass,
        hasFeather: detail.hasFeather,
        breathing: true,
      };
    };
    (window as unknown as Record<string, unknown>).__crewSetPose =
      (m: 'idle' | 'combat' | 'pistol' | 'spyglass') => { if (detail) return setDetailPoseMode(detail, m); return false; };
    // Task 76: детерминированный шаг времени для e2e (rAF в headless
    // не гарантирован): проталкивает кадр и возвращает виртуальное время
    (window as unknown as Record<string, unknown>).__crewStep =
      (dt = 0.05) => { stepFrame(dt); return +vt.toFixed(3); };
    (window as unknown as Record<string, unknown>).__crewScene = () => scene;
    (window as unknown as Record<string, unknown>).__crewCamera = () => camera;
    (window as unknown as Record<string, unknown>).__crewTHREE = THREE;
    (window as unknown as Record<string, unknown>).__crewImports = { buildFigure, rollTraits, buildDetailed: buildDetailedFigure };
    // ракурсы для e2e/VLM — камера к лицу/кисти/обуви/общий
    (window as unknown as Record<string, unknown>).__crewCam = (view: string) => {
      const V: Record<string, [number, number, number, number, number, number]> = {
        full: [0.55, 1.15, 2.60, 0, 0.85, 0],
        face: [0.06, 1.42, 0.85, 0, 1.32, 0],
        hand: [0.34, 0.98, 0.72, 0.15, 0.66, 0.14],
        feet: [0.25, 0.34, 0.90, 0, 0.13, 0.06],
        back: [0, 1.35, -0.7, 0, 1.2, 0],
        // Task 77: труба у лица — ПРОФИЛЬ сбоку (перпендикулярно
        // оси трубы: ось +Z, камера с +X — труба читается в длину)
        tube: [1.35, 1.44, 0.52, 0, 1.33, 0.16],
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
      poseRef.current = null;
      windRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextFigure = () => {
    const s = (Math.random() * 100000) | 0;
    setSeed(s);
    rebuildRef.current?.(profession, s, undead);
  };
  const changeProfession = (p: DetailProfession) => {
    setProfession(p);
    rebuildRef.current?.(p, (Math.random() * 100000) | 0, undead);
  };
  const toggleUndead = () => {
    const u = !undead;
    setUndead(u);
    rebuildRef.current?.(profession, seed, u);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#16181d]">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-amber-900/40 bg-stone-950/80 px-4 py-3 text-stone-200 shadow-lg backdrop-blur">
        <div className="text-sm font-semibold tracking-wide text-amber-200">🔭 Верфь: персонажи XVII века</div>
        {info && (
          <div className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
            Профессия: <span className="text-stone-200">{info.profession}</span> · сид #{info.seed}
            {info.undead && <span className="text-emerald-400"> · ☠ мертвец</span>}
            <br />
            Причёска: <span className="text-stone-200">{{ short: 'короткая', long: 'длинная', ponytail: 'хвостик', wild: 'патлы' }[info.hair] ?? info.hair}</span>
            {info.bald && ' · лысина'}{info.glasses && ' · очки'}
            <br />
            Треугольников: <span className="text-stone-200">{info.tris.toLocaleString('ru-RU')}</span> · объектов: {info.parts}
            <br />
            Свет: Key+Fill+Rim · тени PCFSoft · качка/дыхание/осмотр
          </div>
        )}
      </div>
      {/* профессии + случайная фигура + мертвец */}
      <div className="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 gap-2">
        {PROFESSIONS.map(p => (
          <button key={p.id}
            onClick={() => changeProfession(p.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              profession === p.id
                ? 'border-amber-600 bg-amber-900/40 text-amber-200'
                : 'border-stone-700 bg-stone-900/70 text-stone-300 hover:border-stone-500'
            }`}>
            {p.icon} {p.label}
          </button>
        ))}
        <button onClick={nextFigure}
          className="rounded-md border border-amber-700 bg-amber-900/50 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-800/60">
          🎲 Следующий
        </button>
        <button onClick={toggleUndead}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            undead
              ? 'border-emerald-700 bg-emerald-900/50 text-emerald-200'
              : 'border-stone-700 bg-stone-900/70 text-stone-300 hover:border-stone-500'
          }`}>
          ☠ Мертвец
        </button>
      </div>
      {/* режимы анимации + ветер (по ТЗ: UI-панель) */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-stone-700 bg-stone-950/80 px-3 py-2 backdrop-blur">
        {MODES.map(m => (
          <button key={m.id}
            onClick={() => poseRef.current?.(m.id)}
            className="rounded-md border border-stone-700 bg-stone-900/80 px-3 py-1.5 text-xs font-medium text-stone-200 transition-colors hover:border-amber-600 hover:text-amber-200">
            {m.label}
          </button>
        ))}
        <div className="ml-2 flex items-center gap-2 text-xs text-stone-400">
          🌬️ Ветер
          <input
            type="range" min="0" max="1.6" step="0.05" defaultValue="0.7"
            className="w-24 accent-amber-500"
            onChange={e => windRef.current?.(parseFloat(e.target.value))} />
        </div>
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
