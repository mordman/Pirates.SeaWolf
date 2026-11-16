import * as THREE from 'three';
import { CrewFigure, CrewRole, mulberry32, Traits } from './crew';

// ============================================================
// Task 52: ДЕТАЛЬНЫЕ МАТРОСЫ (по описанию игрока). Альтернатива
// классическим low-poly фигуркам — та же система координат
// (y=0 палуба, +Z нос, +X порт, рост ~1.6 м) и тот же интерфейс
// CrewFigure (ноги/руки — Object3D с пивотами в суставах), но:
//  - СКЕЛЕТ: root → pelvis → spine → chest → neck → head;
//    shoulder → upperArm → forearm(elbow) → hand;
//    thigh(hip) → shin(knee) → foot(ankle) — пивоты в суставах
//  - ОРГАНИКА: CapsuleGeometry, LatheGeometry, деформированные
//    сферы (бицепсы, икры, торс с талией), без резких кубов
//  - ЛИЦО: череп с подбородком и надбровными дугами, глаза
//    (яблоко+радужка+зрачок+блик), брови с наклоном, нос, уши,
//    причёска ИЗ ПРЯДЕЙ (traits.hair), борода у части моряков
//  - КИСТИ: ладонь + большой палец + сегменты пальцев
//  - ОБУВЬ: подошва, носок, шнурки
//  - ОДЕЖДА: гардероб Task 42 поверх тела (куртка с воротником и
//    карманами, брюки со складками, ремень с пряжкой, рюкзак)
//  - ТЕКСТУРЫ: CanvasTexture — ткань (плетение+швы, она же
//    bumpMap/roughnessMap), лицо (веснушки/румянец)
//  - PBR: MeshPhysicalMaterial — sheen на ткани, clearcoat на
//    глазах и обуви
//  - ОЖИВЛЕНИЕ: animateCrewDetail — дыхание грудной клетки,
//    моргание век, покачивание предплечий (вызывается из
//    CrewVisual.update); preview-страница /crew — то же
// ============================================================

// ------------------------------------------------------------
// ПРОЦЕДУРНЫЕ ТЕКСТУРЫ (HTML5 Canvas, кэш модуля)
// ------------------------------------------------------------
let clothTex: THREE.CanvasTexture | null = null;
let clothBump: THREE.CanvasTexture | null = null;
const clothMatCache = new Map<number, THREE.MeshPhysicalMaterial>();
const skinMatCache = new Map<string, THREE.MeshStandardMaterial>();
const faceTexCache = new Map<number, THREE.CanvasTexture>();
let eyeMat: THREE.MeshPhysicalMaterial | null = null;
let shoeMat: THREE.MeshPhysicalMaterial | null = null;

/** Ткань: саржевое плетение + швы (grayscale — умножается на цвет
 *  материала; тот же canvas — bump/roughness карта) */
function getClothTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (clothTex && clothBump) return { map: clothTex, bump: clothBump };
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c9c9c9';
  x.fillRect(0, 0, 128, 128);
  for (let py = 0; py < 128; py++) {
    for (let px = 0; px < 128; px++) {
      const d = (px + py) % 4;
      if (d === 0) x.fillStyle = 'rgba(255,255,255,0.16)';
      else if (d === 2) x.fillStyle = 'rgba(0,0,0,0.14)';
      else continue;
      x.fillRect(px, py, 1, 1);
    }
  }
  // швы: парные тёмные линии со стежками
  x.strokeStyle = 'rgba(30,24,18,0.55)';
  x.lineWidth = 1.5;
  x.setLineDash([5, 3]);
  for (const lx of [30, 96]) {
    x.beginPath(); x.moveTo(lx, 0); x.lineTo(lx, 128); x.stroke();
  }
  clothTex = new THREE.CanvasTexture(c);
  clothTex.colorSpace = THREE.SRGBColorSpace;
  clothTex.wrapS = clothTex.wrapT = THREE.RepeatWrapping;
  clothTex.repeat.set(2.2, 2.2);
  clothBump = new THREE.CanvasTexture(c);
  clothBump.wrapS = clothBump.wrapT = THREE.RepeatWrapping;
  clothBump.repeat.set(2.2, 2.2);
  return { map: clothTex, bump: clothBump };
}

/** Ткань-материал (кэш по цвету): плетение + sheen по ТЗ */
export function clothMat(color: number): THREE.MeshPhysicalMaterial {
  let m = clothMatCache.get(color);
  if (!m) {
    const { map, bump } = getClothTextures();
    m = new THREE.MeshPhysicalMaterial({
      color, map, bumpMap: bump, bumpScale: 0.22,
      roughnessMap: bump, roughness: 0.85,
      sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff),
    });
    clothMatCache.set(color, m);
  }
  return m;
}

/** Лицо: тон кожи + румянец на щеках + веснушки (кэш по цвету) */
function faceTexture(skin: number): THREE.CanvasTexture {
  let t = faceTexCache.get(skin);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const col = new THREE.Color(skin);
  x.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
  x.fillRect(0, 0, 128, 128);
  for (const cx of [30, 98]) {
    const rg = x.createRadialGradient(cx, 74, 2, cx, 74, 24);
    rg.addColorStop(0, 'rgba(216,110,86,0.42)');
    rg.addColorStop(1, 'rgba(216,110,86,0)');
    x.fillStyle = rg;
    x.fillRect(0, 0, 128, 128);
  }
  const rnd = mulberry32(skin);
  for (let i = 0; i < 54; i++) {
    const px = 10 + rnd() * 108, py = 52 + rnd() * 38;
    x.fillStyle = `rgba(118,66,42,${0.20 + rnd() * 0.20})`;
    x.beginPath(); x.arc(px, py, 1.0 + rnd() * 1.2, 0, 6.29); x.fill();
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  faceTexCache.set(skin, t);
  return t;
}

/** Кожа: тело — plain, голова — с face-map (кэш по цвету) */
function skinMat(skin: number, withFace: boolean): THREE.MeshStandardMaterial {
  const key = (withFace ? 'f' : 's') + skin;
  let m = skinMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: skin, map: withFace ? faceTexture(skin) : null,
      roughness: 0.62,
    });
    skinMatCache.set(key, m);
  }
  return m;
}

/** Глаза: склера с clearcoat (по ТЗ) */
function getEyeMat(): THREE.MeshPhysicalMaterial {
  if (!eyeMat) {
    eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xf2efe6, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
    });
  }
  return eyeMat;
}
/** Обувь: матовая кожа (лёгкий clearcoat; VLM-фикс: 0.5 давал
 *  белый блик «светлая подошва» под ключевым светом) */
function getShoeMat(): THREE.MeshPhysicalMaterial {
  if (!shoeMat) {
    shoeMat = new THREE.MeshPhysicalMaterial({
      color: 0x2e241a, roughness: 0.62, clearcoat: 0.18, clearcoatRoughness: 0.5,
    });
  }
  return shoeMat;
}

// ------------------------------------------------------------
// ОЖИВЛЕНИЕ (дыхание/моргание/покачивание) — по ТЗ
// ------------------------------------------------------------
export interface CrewDetailState {
  chest: THREE.Object3D;        // грудная клетка — дыхание (scale)
  head: THREE.Object3D;         // медленные повороты «осматривается»
  forearmL: THREE.Object3D;     // покачивание предплечий
  forearmR: THREE.Object3D;
  lidL: THREE.Object3D;         // веки: scaleY 0.12 открыто / 1 миг
  lidR: THREE.Object3D;
  breathePh: number;
  nextBlink: number;            // сек до следующего моргания
  blinkT: number;               // >0 — веко опущено (0.13 с)
}

/** Дыхание грудной клетки, моргание, покачивание рук и головы.
 *  Веки/предплечья/голова/грудь больше никем не анимируются —
 *  конфликтов с ходьбой/боевыми позами нет. dt — шаг кадра */
export function animateCrewDetail(d: CrewDetailState, t: number, dt: number) {
  const b = Math.sin(t * 1.4 + d.breathePh);
  const k = 1 + b * 0.022;
  d.chest.scale.set(k, 1 + b * 0.008, k * 1.02);
  d.forearmL.rotation.x = -0.28 - Math.sin(t * 1.1 + d.breathePh) * 0.045;
  d.forearmR.rotation.x = -0.28 - Math.sin(t * 1.1 + d.breathePh + 2.1) * 0.045;
  d.head.rotation.y = Math.sin(t * 0.45 + d.breathePh * 2.3) * 0.14;
  if (d.blinkT > 0) {
    d.blinkT -= dt;
    if (d.blinkT <= 0) { d.blinkT = -1; d.nextBlink = 2.2 + Math.random() * 2.8; }
  } else if (d.nextBlink > 0) {
    d.nextBlink -= dt;
  } else {
    d.blinkT = 0.13;
  }
  const closed = d.blinkT > 0;
  d.lidL.scale.y = d.lidR.scale.y = closed ? 1 : 0.12;
}

// ------------------------------------------------------------
// ХЕЛПЕРЫ ГЕОМЕТРИИ
// ------------------------------------------------------------
const HAIR_COLORS = [0x2a1c10, 0x4a3320, 0x6b4a2a, 0x8a6a3a, 0x1c1410, 0x9a7a4a];
const METAL_C = 0x8f8f96;
const WOOD_C = 0x6a4e2e;

/** Lathe с КОРРЕКТНЫМИ наружными нормалями: three строит их по
 *  направлению контура (снизу-вверх). Task 52 VLM-фикс: профили
 *  «сверху-вниз» выворачивали торс наизнанку — тело было невидимо
 *  снаружи (backface culling читался как дыра в груди) */
function lathe(points: [number, number][], seg = 12): THREE.LatheGeometry {
  const pts = points.map(p => new THREE.Vector2(p[0], p[1]));
  if (pts.length > 1 && pts[0].y > pts[pts.length - 1].y) pts.reverse();
  return new THREE.LatheGeometry(pts, seg);
}
function sph(r: number, mat: THREE.Material, w = 10, hseg = 8): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, w, hseg), mat);
}
function cap(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat);
}
function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
}
function felt(c: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 });
}
/** Пуговицы в ряд (деталь одежды) */
function buttons(chest: THREE.Object3D, n: number, color: number, step: number) {
  const bm = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.65 });
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.010, 8), bm);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.16 - i * step, 0.170);
    chest.add(b);
  }
}

/** Треугольники группы (телеметрия детализации) */
export function detailTris(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if ((m as unknown as { isMesh?: boolean }).isMesh && m.geometry) {
      n += Math.round((m.geometry.index ? m.geometry.index.count
        : m.geometry.getAttribute('position')?.count ?? 0) / 3);
    }
  });
  return n;
}

// ------------------------------------------------------------
// СБОРКА ФИГУРЫ
// ------------------------------------------------------------
/** Детальная фигура — CrewFigure-совместимая. movable — ноги/руки
 *  отдельными группами с пивотами в суставах (шаги/махи как у
 *  простой модели); рулевой — руки к штурвалу, гребцы сидят */
export function buildDetailedFigure(role: CrewRole, traits: Traits, seed: number,
  movable = role === 'walker'): CrewFigure {
  const rnd = mulberry32(seed);
  const h = traits.height;
  const group = new THREE.Group();               // root
  const skin = skinMat(traits.skin, false);
  const faceM = skinMat(traits.skin, true);
  const shirtM = clothMat(traits.shirt);
  const pantsM = clothMat(traits.pants);
  // Task 52 (VLM-фикс): цвет волос — КОНТРАСТНЫЙ к тону кожи (у
  // загорелых моряков коричневые волосы сливались с кожей — голова
  // читалась лысой). Тёмная кожа → почти чёрные волосы
  const skinLum = (() => {
    const c = new THREE.Color(traits.skin);
    return (c.r + c.g + c.b) / 3;
  })();
  // тёмная палитра для ВСЕХ (VLM: даже 0x5c3f22 сливалось с загаром);
  // русый — только у очень светлой кожи, и то редко
  const hairPal = skinLum > 0.66 && rnd() < 0.22
    ? [0x8a6a3a, 0x6a4a2a]
    : [0x2a1c10, 0x382514, 0x452e18, 0x523722];
  const hairColor = hairPal[Math.floor(rnd() * hairPal.length)];
  const hairM = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.55 });
  const bare = traits.torso === 'bare';

  // КИНЕМАТИКА НОГИ (м): бедро 0.27h + голень 0.24h + стопа 0.075h
  const legH = 0.585 * h;                        // тазобедренный → палуба
  const hipY = legH;
  const headR = 0.128 * h;
  const shoulderHalf = 0.165 * h;

  // ===== ТАЗ (pelvis) =====
  const pelvis = new THREE.Group();
  pelvis.position.y = hipY;
  group.add(pelvis);
  pelvis.add(new THREE.Mesh(lathe([
    [0.118, 0.10], [0.152, 0.02], [0.155, -0.07], [0.115, -0.13], [0.06, -0.15],
  ]), bare ? skin : pantsM));
  // РЕМЕНЬ с пряжкой (по ТЗ)
  pelvis.add(box(0.315 * h, 0.052, 0.185 * h, felt(0x4a3320)));
  const buckle = box(0.055, 0.042, 0.016, new THREE.MeshStandardMaterial({ color: 0xb8912f, roughness: 0.35, metalness: 0.7 }));
  buckle.position.set(0, 0.09, 0.095 * h);
  pelvis.add(buckle);

  // ===== ПОЗВОНОЧНИК → ГРУДНАЯ КЛЕТКА =====
  const spine = new THREE.Group();
  spine.position.y = 0.09;
  pelvis.add(spine);
  const chest = new THREE.Group();
  chest.position.y = 0.10;
  spine.add(chest);
  // торс — органический профиль: талия → грудная клетка → плечи
  chest.add(new THREE.Mesh(lathe([
    [0.055, 0.42], [0.108, 0.36], [0.128, 0.20], [0.148, 0.06],
    [0.150, -0.02], [0.128, -0.14], [0.112, -0.22], [0.055, -0.26],
  ], 14), bare ? skin : shirtM));
  const belly = sph(0.105 * h, bare ? skin : shirtM);
  belly.scale.set(1.05, 0.9, 0.92);
  belly.position.set(0, -0.16, 0.015);
  chest.add(belly);
  // Task 52 (VLM): ПЛЕЧЕВОЙ СВОД — открытый верх латhe-торса читался
  // как «дыра между плечами»: закрываем грудную клетку сверху
  const chestTop = sph(0.135 * h, bare ? skin : shirtM, 12, 8);
  chestTop.scale.set(1.16, 0.55, 0.85);
  chestTop.position.y = 0.335 * h / 0.9;
  chest.add(chestTop);
  // и стык торс↔таз (при наклонах тела не «разъезжается»)
  const loin = sph(0.105 * h, bare ? skin : pantsM);
  loin.scale.set(1.0, 0.7, 0.9);
  loin.position.y = -0.245;
  chest.add(loin);

  // ===== ОДЕЖДА поверх тела (гардероб Task 42) =====
  const jacket = (color: number, long = true) => {
    const jm = clothMat(color);
    chest.add(new THREE.Mesh(lathe([
      [0.06, long ? 0.44 : 0.30], [0.125, long ? 0.36 : 0.24],
      [0.148, 0.14], [0.163, 0.02], [0.165, -0.06],
      [0.150, -0.16], [0.135, -0.24], [0.07, -0.28],
    ], 14), jm));
    // ВОРОТНИК-стойка
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.075, 10, 1, true), jm);
    collar.position.y = 0.40;
    chest.add(collar);
    // КАРМАНЫ с клапанами (по ТЗ)
    for (const px of [-0.095, 0.095]) {
      const p = box(0.062, 0.075, 0.014, jm);
      p.position.set(px, -0.10, 0.148);
      p.rotation.z = px < 0 ? 0.06 : -0.06;
      chest.add(p);
      const flap = box(0.064, 0.02, 0.016, jm);
      flap.position.set(px, -0.058, 0.150);
      chest.add(flap);
    }
  };
  switch (traits.torso) {
    case 'coat':
      jacket(0x5a3b28, true);
      buttons(chest, 3, 0xb8912f, 0.10);
      break;
    case 'soldierCoat': {
      jacket(traits.shirt, true);
      const facing = felt(0xe8e2d4);
      for (const fx of [-0.075, 0.075]) {
        const lap = box(0.052, 0.16, 0.012, facing);
        lap.position.set(fx, 0.20, 0.158);
        lap.rotation.z = fx < 0 ? 0.14 : -0.14;
        chest.add(lap);
      }
      const strap = box(0.045, 0.52, 0.012, felt(0xe8e2d4));
      strap.position.set(-0.07, 0.06, 0.160);
      strap.rotation.z = 0.5;
      chest.add(strap);
      buttons(chest, 4, 0xb8912f, 0.05);
      break;
    }
    case 'sweater':
      jacket(traits.shirt, false);
      break;
    case 'vest': {
      const vc = clothMat([0x4a3320, 0x2e2a26, 0x5a2e24][Math.floor(rnd() * 3)]);
      chest.add(new THREE.Mesh(lathe([
        [0.06, 0.40], [0.135, 0.30], [0.152, 0.10], [0.158, -0.04],
        [0.140, -0.14], [0.07, -0.19],
      ], 12), vc));
      buttons(chest, 3, 0xd8d2c4, 0.12);
      break;
    }
    case 'apron': {
      const ac = clothMat(0x8a7a5c);
      const apr = box(0.20, 0.46, 0.012, ac);
      apr.position.set(0, -0.05, 0.163);
      chest.add(apr);
      const bib = box(0.13, 0.09, 0.012, ac);
      bib.position.set(0, 0.22, 0.158);
      chest.add(bib);
      const s1 = box(0.028, 0.14, 0.010, felt(0x3a2c1e));
      s1.position.set(0.05, 0.33, 0.150);
      s1.rotation.z = 0.35;
      chest.add(s1);
      break;
    }
    case 'striped': {
      // тельняшка: кольца-полосы по торсу
      const wm = clothMat(0xe8e2d4);
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(0.152 - i * 0.004, 0.150 - i * 0.004, 0.052, 14, 1, true),
          i % 2 ? wm : shirtM);
        ring.position.y = 0.16 - i * 0.115;
        chest.add(ring);
      }
      break;
    }
    default: break;   // shirt/tshirt/bare — тело уже в нужном материале
  }
  // РЮКЗАК (по ТЗ) — у части бродяг за спиной
  if (rnd() < 0.16 && role !== 'captain') {
    const pack = sph(0.105 * h, clothMat(0x4a3a28));
    pack.scale.set(1, 1.25, 0.7);
    pack.position.set(0, 0.02, -0.165);
    chest.add(pack);
    const roll = cyl(0.045, 0.045, 0.20, clothMat(0x5c4128));
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.16, -0.165);
    chest.add(roll);
  }

  // ===== ШЕЯ → ГОЛОВА =====
  const neck = new THREE.Group();
  neck.position.y = 0.42;
  chest.add(neck);
  const neckM = cyl(0.052, 0.062, 0.10, skin);
  neckM.position.y = 0.035;
  neck.add(neckM);
  const head = new THREE.Group();
  head.position.y = 0.075;
  neck.add(head);
  // череп + ЧЕЛЮСТЬ/ПОДБОРОДОК (по ТЗ)
  const skull = sph(headR, faceM, 14, 12);
  skull.scale.set(0.90, 1.04, 0.96);
  head.add(skull);
  const jaw = sph(headR * 0.74, faceM);
  jaw.scale.set(0.84, 0.70, 0.90);
  jaw.position.set(0, -headR * 0.40, headR * 0.24);
  head.add(jaw);
  const chin = sph(headR * 0.34, faceM);
  chin.scale.set(1.05, 0.85, 0.95);
  chin.position.set(0, -headR * 0.62, headR * 0.54);
  head.add(chin);
  // НАДБРОВНЫЕ ДУГИ (по ТЗ): валики-дуги над глазницами
  for (const bx of [-1, 1]) {
    const browArc = new THREE.Mesh(
      new THREE.TorusGeometry(headR * 0.36, headR * 0.085, 4, 8, Math.PI * 0.6), faceM);
    browArc.rotation.set(Math.PI / 2 + 0.30, 0, bx > 0 ? -1.25 : 1.25);
    browArc.position.set(bx * headR * 0.36, headR * 0.14, headR * 0.60);
    head.add(browArc);
  }
  // БРОВИ с наклоном (rnd: суровый/спокойный взгляд)
  const browM = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
  const browTilt = (rnd() < 0.5 ? 1 : -1) * (0.10 + rnd() * 0.18);
  for (const bx of [-1, 1]) {
    const br = box(0.038, 0.008, 0.008, browM);
    br.position.set(bx * headR * 0.40, headR * 0.30, headR * 0.86);
    br.rotation.z = -browTilt * bx;
    head.add(br);
  }
  // ГЛАЗА (по ТЗ: яблоко + радужка + зрачок + блик) + ВЕКИ
  const irisM = new THREE.MeshStandardMaterial({
    color: [0x4a6a3a, 0x3a4a6a, 0x5a3a2a, 0x2a2a2a][Math.floor(rnd() * 4)], roughness: 0.25,
  });
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.2 });
  const glintM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glassM = new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.3, metalness: 0.6 });
  let lidL: THREE.Object3D | null = null;
  let lidR: THREE.Object3D | null = null;
  for (const ex of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(ex * headR * 0.40, headR * 0.05, headR * 0.72);
    eye.userData.faceMark = true;   // диагностика ориентации (e2e)
    head.add(eye);
    eye.add(sph(headR * 0.185, getEyeMat(), 10, 8));
    const iris = new THREE.Mesh(new THREE.CircleGeometry(headR * 0.095, 10), irisM);
    iris.position.z = headR * 0.172;
    eye.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(headR * 0.045, 8), pupilM);
    pupil.position.z = headR * 0.176;
    eye.add(pupil);
    const glint = sph(headR * 0.022, glintM, 6, 4);
    glint.position.set(headR * 0.04, headR * 0.045, headR * 0.180);
    eye.add(glint);
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), skin);
    lid.position.y = headR * 0.015;
    lid.scale.y = 0.12;
    eye.add(lid);
    if (ex < 0) lidL = lid; else lidR = lid;
    // ОЧКИ (Task 51): кольцо + линза у каждого глаза
    if (traits.glasses) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.19, headR * 0.022, 5, 12), glassM);
      ring.position.z = headR * 0.17;
      eye.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(headR * 0.165, 12),
        new THREE.MeshPhysicalMaterial({ color: 0xbcd4de, roughness: 0.05, transparent: true, opacity: 0.35 }));
      lens.position.z = headR * 0.165;
      eye.add(lens);
    }
  }
  if (traits.glasses) {
    const bridge = box(headR * 0.9, headR * 0.045, headR * 0.03, glassM);
    bridge.position.set(0, headR * 0.16, headR * 0.86);
    head.add(bridge);
  }
  // НОС
  const nose = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.13, headR * 0.42, 6), faceM);
  nose.rotation.x = Math.PI / 2 - 0.25;
  nose.position.set(0, -headR * 0.05, headR * 0.88);
  head.add(nose);
  // УШИ (VLM-фикс: компактные, прижаты к бокам черепа, чуть назад)
  for (const exx of [-1, 1]) {
    const ear = sph(headR * 0.155, faceM);
    ear.scale.set(0.42, 1, 0.72);
    ear.position.set(exx * headR * 0.80, -headR * 0.02, -headR * 0.10);
    head.add(ear);
  }
  // ПРИЧЁСКА ИЗ ПРЯДЕЙ (по ТЗ; traits.hair Task 51)
  if (!traits.bald) {
    // шапка волос: заметный объём над черепом (VLM-фикс: раньше
    // скорлупа 1.02·R сливалась с головой — «лысый»)
    const cap1 = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 1.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM);
    cap1.position.y = headR * 0.085;
    head.add(cap1);
    // чёлка надлобная (закрывает линию шапки надо лбом)
    const fringe = sph(headR * 0.42, hairM);
    fringe.scale.set(1.5, 0.5, 0.55);
    fringe.position.set(0, headR * 0.42, headR * 0.72);
    head.add(fringe);
    // пряди по контуру — у ВСЕХ причёсок (short — короче, wild — торчком)
    const nStr = traits.hair === 'wild' ? 9 : traits.hair === 'short' ? 7 : 6;
    for (let i = 0; i < nStr; i++) {
      const a = (i / nStr) * Math.PI * 2 + rnd() * 0.4;
      const wild = traits.hair === 'wild';
      const short_ = traits.hair === 'short';
      const strand = sph(headR * 0.20, hairM);
      strand.scale.set(0.62, short_ ? 1.15 : 1.45, 0.58);
      strand.position.set(Math.cos(a) * headR * 0.74, headR * (short_ ? 0.55 : 0.62), Math.sin(a) * headR * 0.74);
      strand.rotation.set(Math.sin(a) * (wild ? 0.8 : 0.25), 0, -Math.cos(a) * (wild ? 0.8 : 0.25));
      head.add(strand);
    }
    if (traits.hair === 'long') {
      for (const lx of [-1, 0, 1]) {
        const lock = sph(headR * 0.18, hairM);
        lock.scale.set(0.6, 2.1, 0.6);
        lock.position.set(lx * headR * 0.5, -headR * 0.15, -headR * 0.78);
        head.add(lock);
      }
    } else if (traits.hair === 'ponytail') {
      const bun = sph(headR * 0.30, hairM);
      bun.position.set(0, headR * 0.28, -headR * 1.0);
      head.add(bun);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.14, headR * 0.75, 6), hairM);
      tail.rotation.x = Math.PI - 0.4;
      tail.position.set(0, -headR * 0.12, -headR * 1.12);
      head.add(tail);
    }
    // БОРОДА из прядей (у части моряков)
    if (rnd() < 0.30) {
      const beard = new THREE.Mesh(
        new THREE.SphereGeometry(headR * 0.78, 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), hairM);
      beard.scale.set(0.92, 0.7, 0.86);
      beard.position.set(0, -headR * 0.34, headR * 0.12);
      head.add(beard);
      const mus = sph(headR * 0.14, hairM);
      mus.scale.set(1, 0.7, 0.5);
      mus.position.set(0, -headR * 0.44, headR * 0.92);
      head.add(mus);
    }
  }
  buildHeadwear(head, traits, rnd, headR, hairM);

  // ===== РУКИ: shoulder → upperArm → elbow(forearm) → hand =====
  let armL: THREE.Object3D | undefined;
  let armR: THREE.Object3D | undefined;
  let wristMount: THREE.Object3D | null = null;
  let forearmLObj: THREE.Object3D | null = null;
  let forearmRObj: THREE.Object3D | null = null;
  const mkArm = (side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group } => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderHalf, 0.34, 0.01);
    chest.add(shoulder);
    const sleeveUp = bare || traits.torso === 'tshirt' ? skin
      : (role === 'captain' ? clothMat(0x3a2a1a) : shirtM);
    const sleeveFo = bare ? skin : sleeveUp;
    // дельта + плечо-бицепс (капсулы, толще кверху — органично)
    shoulder.add(sph(0.058 * h, sleeveUp));
    const upper = cap(0.045 * h, 0.115 * h, sleeveUp);
    upper.position.y = -0.095 * h;
    shoulder.add(upper);
    const bicep = sph(0.052 * h, sleeveUp);
    bicep.scale.set(1, 1.25, 1);
    bicep.position.set(0, -0.10 * h, 0.012 * h);
    shoulder.add(bicep);
    // ЛОКОТЬ → ПРЕДПЛЕЧЬЕ (сужается к запястью)
    const elbow = new THREE.Group();
    elbow.position.y = -0.185 * h;
    shoulder.add(elbow);
    elbow.add(sph(0.040 * h, sleeveFo));
    const fore = cyl(0.026 * h, 0.038 * h, 0.135 * h, sleeveFo);
    fore.position.y = -0.083 * h;
    elbow.add(fore);
    const foreMuscle = sph(0.040 * h, sleeveFo);
    foreMuscle.scale.set(0.9, 1.3, 0.9);
    foreMuscle.position.set(0, -0.045 * h, -0.008 * h);
    elbow.add(foreMuscle);
    // КИСТЬ: ладонь + большой палец + СЕГМЕНТЫ ПАЛЬЦЕВ (по ТЗ)
    const hand = new THREE.Group();
    hand.position.y = -0.162 * h;
    elbow.add(hand);
    if (traits.hook === side) {
      // деревянная культа + крюк (пиратский протез)
      const stump = cyl(0.030 * h, 0.034 * h, 0.07, felt(WOOD_C));
      stump.position.y = -0.03;
      hand.add(stump);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.013, 5, 10, Math.PI * 1.25),
        new THREE.MeshStandardMaterial({ color: METAL_C, roughness: 0.3, metalness: 0.8 }));
      hook.position.y = -0.10;
      hook.rotation.z = side * 1.57;
      hand.add(hook);
    } else {
      // ЛАДОНЬ: плоская варежка с запястьем — пальцы растут из
      // её нижнего края, суставы-сферы между фалангами (VLM-фикс)
      const palm = sph(0.037 * h, skin);
      palm.scale.set(0.98, 1.30, 0.55);
      palm.position.y = -0.028 * h;
      hand.add(palm);
      const wristJ = sph(0.030 * h, skin);
      wristJ.scale.set(0.9, 1.0, 0.8);
      wristJ.position.y = 0.010 * h;
      hand.add(wristJ);
      // большой палец — двумя фалангами от НИЖНЕ-БОКОВОГО края
      const th1 = cap(0.011 * h, 0.022 * h, skin);
      th1.position.set(-side * 0.024 * h, -0.034 * h, 0.020 * h);
      th1.rotation.z = -side * 0.75;
      th1.rotation.x = 0.35;
      hand.add(th1);
      const th2 = cap(0.0095 * h, 0.018 * h, skin);
      th2.position.set(-side * 0.040 * h, -0.052 * h, 0.038 * h);
      th2.rotation.z = -side * 1.05;
      th2.rotation.x = 0.5;
      hand.add(th2);
      // ПАЛЬЦЫ: единый скруглённый БЛОК-«варежка» с БОРЗДАМИ
      // между пальцами (сегментация читается с дистанции палубы,
      // не рассыпаясь на «виноград» отдельных капсул) + суставная
      // складка посередине
      const fingers = sph(0.033 * h, skin);
      fingers.scale.set(1.30, 1.05, 0.62);
      fingers.position.set(0, -0.072 * h, 0.016 * h);
      fingers.rotation.x = 0.38;
      hand.add(fingers);
      const crease = sph(0.030 * h, skin);
      crease.scale.set(1.32, 0.28, 0.64);
      crease.position.set(0, -0.070 * h, 0.017 * h);
      hand.add(crease);
      // борозды между пальцами — тёмные клинья в блок
      const grooveM = new THREE.MeshStandardMaterial({ color: 0x8a5f4a, roughness: 0.8 });
      for (let gi = 0; gi < 3; gi++) {
        const gx = (gi - 1) * 0.018 * h;
        const groove = box(0.006 * h, 0.040 * h, 0.012 * h, grooveM);
        groove.position.set(gx, -0.076 * h, 0.034 * h);
        groove.rotation.x = 0.38;
        hand.add(groove);
      }
      // маунт у кисти (оружие следует за рукой — Task 42)
      const mount = new THREE.Object3D();
      mount.position.set(0, -0.06 * h, 0.02 * h);
      mount.userData.wristMount = true;
      hand.add(mount);
      wristMount = mount;
    }
    return { shoulder, elbow };
  };
  for (const side of [-1, 1] as const) {
    const { shoulder, elbow } = mkArm(side);
    if (side < 0) { armL = shoulder; forearmLObj = elbow; }
    else { armR = shoulder; forearmRObj = elbow; }
    if (role === 'helmsman') {
      // рулевой: руки ВПЕРЁД к штурвалу
      shoulder.rotation.x = -1.15;
      shoulder.rotation.z = -side * 0.12;
      elbow.rotation.x = -0.45;
    } else if (!movable) {
      shoulder.rotation.z = -side * 0.06;
      elbow.rotation.x = -0.30;
    }
  }

  // ===== НОГИ: thigh(hip) → shin(knee) → foot(обувь) =====
  let legL: THREE.Object3D | undefined;
  let legR: THREE.Object3D | undefined;
  const mkLeg = (side: -1 | 1): THREE.Group => {
    const thigh = new THREE.Group();               // пивот — тазобедренный
    thigh.position.set(side * 0.088 * h, 0, 0);
    pelvis.add(thigh);
    if (traits.pegLeg === side) {
      // ДЕРЕВЯННАЯ НОГА (протез пирата)
      thigh.add(sph(0.055 * h, pantsM));
      const peg = cyl(0.040 * h, 0.052 * h, legH - 0.02, felt(WOOD_C));
      peg.position.y = -legH / 2;
      thigh.add(peg);
      const pegFoot = cyl(0.055 * h, 0.058 * h, 0.03, felt(WOOD_C));
      pegFoot.position.y = -legH + 0.015;
      thigh.add(pegFoot);
      return thigh;
    }
    const shortsOnly = traits.pantsKind === 'shorts' || traits.pantsKind === 'torn';
    // бедро + квадрицепс
    const th = cap(0.055 * h, 0.14 * h, pantsM);
    th.position.y = -0.14 * h;
    thigh.add(th);
    const quad = sph(0.060 * h, pantsM);
    quad.scale.set(0.95, 1.35, 1);
    quad.position.set(0, -0.12 * h, 0.012 * h);
    thigh.add(quad);
    // КОЛЕНО → ГОЛЕНЬ с икрой
    const knee = new THREE.Group();
    knee.position.y = -0.27 * h;
    thigh.add(knee);
    knee.add(sph(0.046 * h, shortsOnly ? skin : pantsM));
    const shinMat = shortsOnly ? skin : pantsM;
    const shin = cyl(0.030 * h, 0.042 * h, 0.17 * h, shinMat);
    shin.position.y = -0.115 * h;
    knee.add(shin);
    const calf = sph(0.045 * h, shinMat);
    calf.scale.set(0.9, 1.5, 1.05);
    calf.position.set(0, -0.06 * h, -0.014 * h);
    knee.add(calf);
    // СКЛАДКИ БРЮК у щиколотки (по ТЗ)
    if (!shortsOnly) {
      for (const fy of [-0.19, -0.215]) {
        const wrinkle = new THREE.Mesh(new THREE.TorusGeometry(0.040 * h, 0.007 * h, 4, 10), pantsM);
        wrinkle.rotation.x = Math.PI / 2;
        wrinkle.position.y = fy * h;
        wrinkle.scale.set(1, 1, 0.85);
        knee.add(wrinkle);
      }
    }
    if (traits.pantsKind === 'torn') {
      for (let k = -1; k <= 1; k++) {
        const fl = box(0.038, 0.06 + rnd() * 0.07, 0.012, clothMat(traits.pants));
        fl.position.set(k * 0.04, -0.26 * h, 0.03 - k * 0.015);
        fl.rotation.set(0.15, 0, k * 0.2);
        knee.add(fl);
      }
    }
    // СТОПА → ОБУВЬ: подошва + верх + носок + ШНУРКИ (по ТЗ)
    const foot = new THREE.Group();                // пивот — лодыжка
    foot.position.y = -0.24 * h;
    knee.add(foot);
    const sole = box(0.100 * h, 0.026, 0.235, getShoeMat());
    sole.position.set(0, -0.062 * h, 0.032);
    foot.add(sole);
    // каблук: задний выступ подошвы
    const heel = box(0.092 * h, 0.034, 0.05, getShoeMat());
    heel.position.set(0, -0.062 * h, -0.070);
    foot.add(heel);
    const upperShoe = sph(0.052 * h, getShoeMat());
    upperShoe.scale.set(0.85, 0.58, 1.42);
    upperShoe.position.set(0, -0.016 * h, 0.012);
    foot.add(upperShoe);
    const toe = sph(0.041 * h, getShoeMat());
    toe.scale.set(0.92, 0.62, 1.15);
    toe.position.set(0, -0.032 * h, 0.088 * h);
    foot.add(toe);
    // ГОЛЕНИЩЕ: короткий раструб ботинка над стопой
    const shaft = cyl(0.052 * h, 0.058 * h, 0.07, getShoeMat(), 9);
    shaft.position.y = 0.030 * h;
    foot.add(shaft);
    const laceM = new THREE.MeshStandardMaterial({ color: 0xcabfa8, roughness: 0.9 });
    for (let li = 0; li < 3; li++) {
      const lace = box(0.075 * h, 0.007, 0.012, laceM);
      lace.position.set(0, (-0.006 + li * 0.02) * h, 0.035 - li * 0.028);
      lace.rotation.y = li % 2 ? 0.28 : -0.28;
      foot.add(lace);
    }
    foot.rotation.y = side * 0.07;                 // стойка чуть разворотно
    return thigh;
  };
  for (const side of [-1, 1] as const) {
    const leg = mkLeg(side);
    if (side < 0) legL = leg; else legR = leg;
  }
  // ГРЕБЦЫ «сидят» — как и в простой модели
  const baseScaleY = role === 'rower' ? 0.78 : 1;
  if (role === 'rower') group.scale.y = 0.78;

  const detail: CrewDetailState = {
    chest, head,
    forearmL: forearmLObj ?? new THREE.Object3D(),
    forearmR: forearmRObj ?? new THREE.Object3D(),
    lidL: lidL ?? new THREE.Object3D(),
    lidR: lidR ?? new THREE.Object3D(),
    breathePh: rnd() * 6.28,
    nextBlink: 1 + rnd() * 3, blinkT: -1,
  };

  return {
    group, role, legL, legR, armL, armR, wristMount, seed,
    walkT: rnd(), walkDir: rnd() < 0.5 ? 1 : -1, baseScaleY,
    walkSpeed: 0.55 + rnd() * 0.5, phase: rnd() * 6.28,
    dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
    skin: traits.skin, shirt: traits.shirt, pants: traits.pants,
    hasHook: traits.hook !== 0, hasPeg: traits.pegLeg !== 0, hasParrot: traits.parrot,
    verts: 0,                                      // заполнит buildCrew
    detail,
  };
}

/** Головной убор поверх причёски (гардероб Task 49-50) */
function buildHeadwear(head: THREE.Object3D, traits: Traits,
  rnd: () => number, headR: number, hairM: THREE.MeshStandardMaterial) {
  switch (traits.headwear) {
    case 'hat': {
      // ТРЕУГОЛКА: тулья + три петли полей
      const tricorne = new THREE.Group();
      tricorne.position.y = headR * 0.55;
      head.add(tricorne);
      tricorne.add(cyl(headR * 0.55, headR * 0.62, headR * 0.5, felt(0x2a2320)));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const loop = box(headR * 1.7, headR * 0.07, headR * 0.62, clothMat(0x2a2320));
        loop.position.set(Math.cos(a) * headR * 0.55, headR * 0.05, Math.sin(a) * headR * 0.55);
        loop.rotation.y = -a + Math.PI / 2;
        loop.rotation.z = 0.12;
        tricorne.add(loop);
      }
      break;
    }
    case 'bandana': {
      const c = [0xc04030, 0x3a6a9a, 0x4a7a44][Math.floor(rnd() * 3)];
      const bd = new THREE.Mesh(
        new THREE.SphereGeometry(headR * 1.03, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), clothMat(c));
      bd.position.y = headR * 0.08;
      head.add(bd);
      const knot = sph(headR * 0.16, hairM);
      knot.position.set(headR * 0.5, headR * 0.35, -headR * 0.75);
      head.add(knot);
      const tail = box(headR * 0.14, headR * 0.5, headR * 0.04, clothMat(c));
      tail.position.set(headR * 0.5, headR * 0.05, -headR * 0.85);
      tail.rotation.x = 0.35;
      head.add(tail);
      break;
    }
    case 'wide': {
      const brim = cyl(headR * 1.55, headR * 1.55, headR * 0.05, felt(0x4a3a28));
      brim.position.y = headR * 0.38;
      head.add(brim);
      const crown = cyl(headR * 0.6, headR * 0.66, headR * 0.45, felt(0x4a3a28));
      crown.position.y = headR * 0.60;
      head.add(crown);
      break;
    }
    case 'straw': {
      // СОЛОМЕННАЯ (Task 49): поля-кольцо на макушке, тулья НАД полями
      const ring = cyl(headR * 1.42, headR * 1.48, headR * 0.07, clothMat(0xc9a860));
      ring.position.y = headR * 0.42;
      head.add(ring);
      const crown2 = cyl(headR * 0.58, headR * 0.64, headR * 0.42, clothMat(0xc9a860));
      crown2.position.y = headR * 0.64;
      head.add(crown2);
      const band = cyl(headR * 0.65, headR * 0.65, headR * 0.09, felt(0x6a4e2e));
      band.position.y = headR * 0.50;
      head.add(band);
      break;
    }
    case 'cap': {
      const capM = new THREE.Mesh(
        new THREE.SphereGeometry(headR * 1.02, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        clothMat(0x33415a));
      capM.position.y = headR * 0.10;
      head.add(capM);
      const peak = box(headR * 0.9, headR * 0.05, headR * 0.55, felt(0x2a3038));
      peak.position.set(0, headR * 0.18, headR * 0.85);
      peak.rotation.x = -0.18;
      head.add(peak);
      break;
    }
    case 'top': {
      // ЦИЛИНДР капитана
      const brim2 = cyl(headR * 1.05, headR * 1.05, headR * 0.05, felt(0x1c1814));
      brim2.position.y = headR * 0.42;
      head.add(brim2);
      const tube = cyl(headR * 0.62, headR * 0.66, headR * 1.05, felt(0x1c1814));
      tube.position.y = headR * 0.95;
      head.add(tube);
      const silk = cyl(headR * 0.68, headR * 0.68, headR * 0.1, felt(0x5a1e1e));
      silk.position.y = headR * 0.55;
      head.add(silk);
      break;
    }
    default: break;      // 'none'
  }
}
