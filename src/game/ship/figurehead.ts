import * as THREE from 'three';
import { metalNormalTex, metalRoughTex, woodNormalTex, woodRoughTex } from './pbr';
import type { ShipPreset } from './buildShip';

// ============================================================
// Гальюнные фигуры (носовые украшения) — покупаются в порту.
// Процедурные скульптуры из примитивов: золоченое дерево,
// кость, полихромия. Все фигуры «растут» из форштевня
// (локально: +Z — нос, +Y — вверх).
// ============================================================

export interface FigureDef {
  id: string;
  name: string;
  price: number;
  desc: string;
  swatch: string;
}

export const FIGUREHEADS: FigureDef[] = [
  { id: 'figure.stock', name: 'Резной шток', price: 0, desc: 'Штатный позолоченный конус верфи', swatch: '#c9a24a' },
  { id: 'figure.mermaid', name: 'Золотая русалка', price: 900, desc: 'Русалка с зеркалом и гребнем — гребцам силу, штурману — верный путь', swatch: '#e8c56a' },
  { id: 'figure.lion', name: 'Лев Бискайи', price: 800, desc: 'Оскаленный лев — герб бискайских мореходов, пугает вражеских вахтенных', swatch: '#d9a441' },
  { id: 'figure.skull', name: 'Костяной жнец', price: 1000, desc: 'Череп на скрещённых костях: «сдавайся, пока живой»', swatch: '#e5ddc8' },
  { id: 'figure.neptune', name: 'Нептун с трезубцем', price: 1300, desc: 'Владыка морей дарует попутный ветер и топит нечестивцев', swatch: '#b9d4e0' },
  { id: 'figure.dragon', name: 'Дракон бури', price: 1500, desc: 'Алый дракон из легенд Молуккского моря — гарпун судьбы на форштевне', swatch: '#a83226' },
  { id: 'figure.maiden', name: 'Дева форштевня', price: 950, desc: 'Резная красавица с розой ветров — покровительница первопроходцев', swatch: '#e0c9a6' },
  { id: 'figure.eagle', name: 'Орёл шторма', price: 1100, desc: 'Двуглавый орёл с расправленными крыльями — царский подарок', swatch: '#caa43c' },
];

function goldMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xd8ab3e, metalness: 0.82, roughness: 0.34,
    normalMap: metalNormalTex(), roughnessMap: metalRoughTex(),
    normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.5,
  });
}
function boneMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xe8e0cc, metalness: 0.05, roughness: 0.5,
    normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
    normalScale: new THREE.Vector2(0.3, 0.3),
  });
}
function paintedMat(hex: number, rough = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex, metalness: 0.1, roughness: rough,
    normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
    normalScale: new THREE.Vector2(0.3, 0.3),
  });
}

const cyl = (r1: number, r2: number, h: number, m: THREE.Material) =>
  new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 7), m);
const sph = (r: number, m: THREE.Material) =>
  new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), m);
const cone = (r: number, h: number, m: THREE.Material) =>
  new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), m);
const box = (w: number, h: number, d: number, m: THREE.Material) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

function put(o: THREE.Object3D, x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Object3D {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.set(sx, sy, sz);
  return o;
}

/** Построить гальюнную фигуру id для корабля P.
 *  Возвращает группу с началом координат у крепления к форштевню */
export function buildFigurehead(P: ShipPreset, id: string): THREE.Group {
  const g = new THREE.Group();
  const s = THREE.MathUtils.clamp(P.freeboard * 0.26, 0.55, 1.25); // масштаб фигуры
  const gold = goldMat();

  if (id === 'figure.mermaid') {
    // хвост, изогнутый вверх-вперёд
    const tail = cone(s * 0.34, s * 1.5, gold);
    put(tail, 0, s * 0.75, -s * 0.1, -0.9, 0, 0);
    g.add(tail);
    const fluke = cone(s * 0.3, s * 0.55, gold);
    put(fluke, 0, s * 1.5, -s * 0.52, -2.1, 0, 0, 1, 0.5, 1);
    g.add(fluke);
    // торс, наклонённый вперёд
    const torso = cyl(s * 0.24, s * 0.3, s * 0.75, gold);
    put(torso, 0, s * 1.35, s * 0.18, 0.35);
    g.add(torso);
    g.add(put(sph(s * 0.22, gold), 0, s * 1.8, s * 0.32));        // голова
    // волосы
    const hair = cyl(s * 0.24, s * 0.1, s * 0.6, gold);
    put(hair, 0, s * 1.68, s * 0.16, -0.5);
    g.add(hair);
    // руки: одна держит зеркало
    const armL = cyl(s * 0.07, s * 0.07, s * 0.62, gold);
    put(armL, -s * 0.28, s * 1.42, s * 0.34, 0, 0, 0.8);
    g.add(armL);
    const armR = cyl(s * 0.07, s * 0.07, s * 0.62, gold);
    put(armR, s * 0.3, s * 1.62, s * 0.42, 0, 0, -2.3);
    g.add(armR);
    const mirror = new THREE.Mesh(new THREE.TorusGeometry(s * 0.16, s * 0.03, 5, 10), gold);
    put(mirror, s * 0.42, s * 1.92, s * 0.5, 0.4);
    g.add(mirror);
    const glass = put(new THREE.Mesh(new THREE.CircleGeometry(s * 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x9fc4d8, metalness: 0.9, roughness: 0.15 })),
      s * 0.42, s * 1.92, s * 0.5, 0.4);
    g.add(glass);
  } else if (id === 'figure.lion') {
    const bodyMat = paintedMat(0xc79a33, 0.45);
    const body = cyl(s * 0.32, s * 0.38, s * 1.1, bodyMat);
    put(body, 0, s * 0.85, -s * 0.15, Math.PI / 2 - 0.15);
    g.add(body);
    // грива: воротник + лучи
    const mane = new THREE.Mesh(new THREE.TorusGeometry(s * 0.34, s * 0.12, 6, 11), bodyMat);
    put(mane, 0, s * 1.15, s * 0.38);
    g.add(mane);
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.2;
      const spike = cone(s * 0.07, s * 0.3, bodyMat);
      put(spike, Math.sin(a) * s * 0.42, s * 1.15 + Math.cos(a) * s * 0.08, s * 0.34,
        -1.2, 0, -a);
      g.add(spike);
    }
    g.add(put(sph(s * 0.26, bodyMat), 0, s * 1.2, s * 0.62));      // голова
    const jaw = box(s * 0.3, s * 0.12, s * 0.24, bodyMat);
    put(jaw, 0, s * 1.08, s * 0.82, 0.25);
    g.add(jaw);
    for (const dx of [-1, 1]) {                                    // лапы
      const leg = cyl(s * 0.09, s * 0.11, s * 0.6, bodyMat);
      put(leg, dx * s * 0.26, s * 0.32, s * 0.3, 0.2, 0, dx * 0.25);
      g.add(leg);
      const legB = cyl(s * 0.09, s * 0.11, s * 0.6, bodyMat);
      put(legB, dx * s * 0.26, s * 0.32, -s * 0.45, -0.15, 0, dx * 0.2);
      g.add(legB);
    }
  } else if (id === 'figure.skull') {
    const bone = boneMat();
    for (const a of [Math.PI / 4, -Math.PI / 4]) {                 // скрещённые кости
      const b = cyl(s * 0.06, s * 0.06, s * 1.7, bone);
      put(b, 0, s * 0.55, s * 0.1, Math.PI / 2, 0, a);
      g.add(b);
      for (const e of [-1, 1]) {
        const knob = sph(s * 0.1, bone);
        put(knob, e * Math.cos(a) * s * 0.85, s * 0.55 + Math.sin(a) * e * s * 0.85 * Math.sin(Math.PI / 2 - a) * 0, s * 0.1 + e * Math.sin(a) * s * 0.85);
        g.add(knob);
      }
    }
    const cranium = sph(s * 0.34, bone);
    put(cranium, 0, s * 0.85, s * 0.16, 1, 0.4);                   // чуть вытянут
    cranium.scale.set(1, 1, 1.25);
    g.add(cranium);
    const jaw = box(s * 0.36, s * 0.22, s * 0.3, bone);
    put(jaw, 0, s * 0.52, s * 0.3);
    g.add(jaw);
    const dark = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.9 });
    g.add(put(sph(s * 0.1, dark), -s * 0.14, s * 0.92, s * 0.4));
    g.add(put(sph(s * 0.1, dark), s * 0.14, s * 0.92, s * 0.4));
    // зубы
    for (let i = -1; i <= 1; i++) {
      const tooth = box(s * 0.05, s * 0.1, s * 0.04, bone);
      put(tooth, i * s * 0.11, s * 0.5, s * 0.42);
      g.add(tooth);
    }
  } else if (id === 'figure.neptune') {
    const robe = paintedMat(0x3a6a8a, 0.6);
    const skin = paintedMat(0xc9a07a, 0.6);
    const trunk = cone(s * 0.4, s * 1.0, robe);
    put(trunk, 0, s * 0.5, 0);
    g.add(trunk);
    const torso = cyl(s * 0.24, s * 0.33, s * 0.7, skin);
    put(torso, 0, s * 1.2, s * 0.1);
    g.add(torso);
    g.add(put(sph(s * 0.2, skin), 0, s * 1.68, s * 0.16));          // голова
    const beard = cone(s * 0.16, s * 0.5, paintedMat(0xd8d8e0, 0.7));
    put(beard, 0, s * 1.42, s * 0.32, 2.6);
    g.add(beard);
    // корона из шипов
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 2.4;
      const spike = cone(s * 0.045, s * 0.26, gold);
      put(spike, Math.sin(a) * s * 0.16, s * 1.86, s * 0.14 + Math.cos(a) * s * 0.05, -0.2, 0, -a);
      g.add(spike);
    }
    // рука с трезубцем
    const arm = cyl(s * 0.06, s * 0.06, s * 0.6, skin);
    put(arm, s * 0.28, s * 1.35, s * 0.2, 0, 0, -2.6);
    g.add(arm);
    const shaft = cyl(s * 0.035, s * 0.035, s * 1.9, gold);
    put(shaft, s * 0.5, s * 1.7, s * 0.24, -0.15);
    g.add(shaft);
    for (const dx of [-1, 0, 1]) {
      const prong = cone(s * 0.04, s * 0.3, gold);
      put(prong, s * 0.5 + dx * s * 0.11, s * 2.78, s * 0.24 + Math.abs(dx) * -s * 0.02);
      g.add(prong);
    }
  } else if (id === 'figure.dragon') {
    const scale = paintedMat(0xa83226, 0.5);
    const belly = paintedMat(0xd8b45a, 0.5);
    // изогнутая шея тремя сегментами
    let y = s * 0.4, z = -s * 0.3;
    for (let i = 0; i < 3; i++) {
      const seg = cyl(s * 0.2 - i * s * 0.03, s * 0.23 - i * s * 0.03, s * 0.55, scale);
      put(seg, 0, y + s * 0.22, z + i * s * 0.12, -0.55);
      g.add(seg);
      y += s * 0.4;
      z += s * 0.16;
    }
    const head = box(s * 0.3, s * 0.24, s * 0.5, scale);
    put(head, 0, s * 1.5, s * 0.35, -0.15);
    g.add(head);
    const jaw = box(s * 0.24, s * 0.1, s * 0.4, belly);
    put(jaw, 0, s * 1.38, s * 0.52, -0.1);
    g.add(jaw);
    const eye = sph(s * 0.05, gold);
    put(eye, -s * 0.14, s * 1.58, s * 0.5);
    g.add(eye);
    const eye2 = sph(s * 0.05, gold);
    put(eye2, s * 0.14, s * 1.58, s * 0.5);
    g.add(eye2);
    // рога назад
    for (const dx of [-1, 1]) {
      const horn = cone(s * 0.05, s * 0.3, boneMat());
      put(horn, dx * s * 0.1, s * 1.66, s * 0.18, -2.2, 0, dx * 0.3);
      g.add(horn);
    }
    // крылья
    for (const dx of [-1, 1]) {
      const wing = box(s * 0.9, s * 0.05, s * 0.45, paintedMat(0x7a2018, 0.55));
      put(wing, dx * s * 0.5, s * 1.05, -s * 0.25, 0.35, dx * 0.4, dx * 0.5);
      g.add(wing);
    }
    // грудь
    g.add(put(sph(s * 0.3, belly), 0, s * 0.55, s * 0.05));
  } else if (id === 'figure.maiden') {
    const gown = paintedMat(0xe0d8c4, 0.6);
    const skin = paintedMat(0xd8b28c, 0.6);
    const skirt = cone(s * 0.42, s * 1.05, gown);
    put(skirt, 0, s * 0.52, 0);
    g.add(skirt);
    const torso = cyl(s * 0.2, s * 0.3, s * 0.6, gown);
    put(torso, 0, s * 1.25, s * 0.08);
    g.add(torso);
    g.add(put(sph(s * 0.19, skin), 0, s * 1.68, s * 0.14));         // голова
    const hair = sph(s * 0.21, paintedMat(0x6b4522, 0.65));
    put(hair, 0, s * 1.72, s * 0.02);
    hair.scale.set(1, 0.9, 1);
    g.add(hair);
    // руки: одна прижата, другая держит розу ветров
    const armL = cyl(s * 0.055, s * 0.055, s * 0.5, skin);
    put(armL, -s * 0.26, s * 1.3, s * 0.12, 0, 0, 0.5);
    g.add(armL);
    const armR = cyl(s * 0.055, s * 0.055, s * 0.55, skin);
    put(armR, s * 0.27, s * 1.42, s * 0.3, 0, 0, -2.2);
    g.add(armR);
    const rose = new THREE.Mesh(new THREE.TorusGeometry(s * 0.14, s * 0.025, 5, 10), gold);
    put(rose, s * 0.4, s * 1.66, s * 0.42, 0.3);
    g.add(rose);
  } else if (id === 'figure.eagle') {
    const feather = paintedMat(0xcaa43c, 0.45);
    const body = cyl(s * 0.22, s * 0.3, s * 1.0, feather);
    put(body, 0, s * 0.75, 0, 0.25);
    g.add(body);
    // два орлиных головы (двуглавый)
    for (const dz of [-1, 1]) {
      const head = sph(s * 0.19, feather);
      put(head, 0, s * 1.5, dz * s * 0.1);
      g.add(head);
      const beak = cone(s * 0.07, s * 0.26, paintedMat(0x8a6a2a, 0.4));
      put(beak, 0, s * 1.48, dz * (s * 0.28), dz > 0 ? -Math.PI / 2 : Math.PI / 2);
      beak.rotation.x = dz > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(beak);
    }
    // расправленные крылья
    for (const dx of [-1, 1]) {
      const wing = box(s * 1.15, s * 0.05, s * 0.4, feather);
      put(wing, dx * s * 0.62, s * 1.05, -s * 0.1, 0.3, dx * 0.35, dx * 0.35);
      g.add(wing);
      const tip = box(s * 0.5, s * 0.04, s * 0.25, feather);
      put(tip, dx * s * 1.25, s * 1.38, -s * 0.28, 0.3, dx * 0.35, dx * 0.7);
      g.add(tip);
    }
    // хвост-веер
    const tail = box(s * 0.3, s * 0.04, s * 0.45, feather);
    put(tail, 0, s * 0.35, -s * 0.42, -0.4);
    g.add(tail);
  } else {
    // figure.stock — штатный золотой конус (как был до того)
    const spike = cone(s * 0.3, s * 1.1, gold);
    put(spike, 0, s * 0.5, s * 0.2, -0.5);
    g.add(spike);
  }

  for (const o of g.children) (o as THREE.Mesh).castShadow = true;
  return g;
}
