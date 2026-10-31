import * as THREE from 'three';
import type { ShipPreset } from './buildShip';

// ============================================================
// Текстуры борта + покупные украшения (порт). Три процедурных
// холста на корабль:
//   map          — зерно дерева (бесплатная текстура three.js
//                  examples/textures, CC) + швы досок + потёки
//                  + ЗОЛОТЫЕ узоры (узор/вензель/череп)
//   roughnessMap — светло-серая база (матовое крашеное дерево),
//                  в тех же координатах узоры ТЁМНЫМ (глянцевый
//                  металл — золото «блестит», дерево остаётся
//                  матовым) — по подсказке пользователя
//   metalnessMap — почти чёрная база (дерево — диэлектрик),
//                  золото светлым (настоящий металл под бликами)
// UV борта: u = z/B (вдоль корпуса), v = y/B (по высоте) —
// оба борта делят одни координаты, узор симметричен.
// ============================================================

export interface DecoDef {
  id: string;
  name: string;
  price: number;
  desc: string;
}

/** Украшения бортов (порт → «Убранство»): рисуются золотом
 *  по холстам map/roughness/metalness */
export const DECOS: DecoDef[] = [
  { id: 'deco.none', name: 'Штатный борт', price: 0, desc: 'Чистые доски без украшений' },
  { id: 'deco.gold', name: 'Золотая резьба', price: 900, desc: 'Позолоченные завитки вдоль вельса и рамки пушечных портов' },
  { id: 'deco.acanthus', name: 'Листья аканта', price: 850, desc: 'Гирлянда резных листьев по вельсу — мода верфей XVIII века' },
  { id: 'deco.monogram', name: 'Вензель капитана', price: 700, desc: 'Королевская литера с короной на шкафуте и у форштевня' },
  { id: 'deco.skull', name: 'Череп и кости', price: 800, desc: 'Костяная эмблема на шкафуте — чтобы добыча сдавалась без боя' },
  { id: 'deco.stern', name: 'Гнев морей', price: 1000, desc: 'Злые глаза на носу и боевые полосы — как на кораблях корсаров' },
];

/** Загруженные бесплатные текстуры дерева (three.js examples, CC) */
let grainImg: HTMLImageElement | null = null;
let roughImg: HTMLImageElement | null = null;
let grainLoaded = false;
const pendingRedraw: (() => void)[] = [];

function loadImage(url: string, cb: () => void): HTMLImageElement {
  const img = new Image();
  img.onload = cb;
  img.src = url;
  return img;
}

/** Единожды грузим зерно; когда готово — перерисовываем все холсты */
function ensureImages(): void {
  if (grainImg) return;
  let pending = 2;
  const done = () => {
    if (--pending === 0) {
      grainLoaded = true;
      for (const fn of pendingRedraw) fn();
      pendingRedraw.length = 0;
    }
  };
  grainImg = loadImage('/textures/hardwood2_diffuse.jpg', done);
  roughImg = loadImage('/textures/hardwood2_roughness.jpg', done);
}

interface PortRef { z: number; y: number; }

interface Geo {
  W: number; H: number;
  uMin: number; uSpan: number; vMin: number; vSpan: number;
  px(z: number): number;      // мировое z -> пиксель x
  py(y: number): number;      // мировое y -> пиксель y
  P: ShipPreset;
  ports: PortRef[];           // закрытые батареи (рамки портов)
}

export interface DecoTexSet {
  map: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
  metal: THREE.CanvasTexture;
  decoId: string;
  /** пиксель холста шероховатости (для E2E: золото темнее дерева) */
  roughAt(x: number, y: number): number;
}

const texCache = new Map<string, DecoTexSet>();

/** Собрать тройку холстов борта (кэш по модели+украшению —
 *  все корабли одной модели делят текстуры) */
export function makeHullTextures(P: ShipPreset, decoId: string, ports: PortRef[]): DecoTexSet {
  const key = `${P.id}|${decoId}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  ensureImages();

  // --- геометрия UV ---
  const B = P.beam;
  const uMin = -(P.length / 2 + 1.5) / B, uMax = (P.length / 2 + 1.5) / B;
  const vMin = (-P.draft - 0.4) / B, vMax = (P.freeboard * 1.18) / B;
  const uSpan = uMax - uMin, vSpan = vMax - vMin;
  const W = 2048;
  const H = Math.max(160, Math.min(512, Math.round(W * vSpan / uSpan)));
  const geo: Geo = {
    W, H, uMin, uSpan, vMin, vSpan, P, ports,
    px: (z) => ((z / B) - uMin) / uSpan * W,
    py: (y) => (1 - ((y / B) - vMin) / vSpan) * H,
  };

  const cMap = document.createElement('canvas'); cMap.width = W; cMap.height = H;
  const cRough = document.createElement('canvas'); cRough.width = W; cRough.height = H;
  const cMetal = document.createElement('canvas'); cMetal.width = W; cMetal.height = H;

  const seed = Array.from(P.id).reduce((a, ch) => a + ch.charCodeAt(0) * 31, 7) + P.length;
  let rs = seed * 2654435761 % 2147483647;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };

  const redraw = () => {
    const m = cMap.getContext('2d')!;
    const r = cRough.getContext('2d')!;
    const mt = cMetal.getContext('2d')!;

    // ===== БАЗА: ОКРАСКА БОРТА ПИШЕТСЯ В КАРТУ ЦВЕТА =====
    // (та же схема, что была в вершинных цветах: подводная часть →
    // ватерлинионный пояс → полосы пресета → вельс → основной цвет,
    // лёгкая полосатость досок). КАРТА теперь НЕ умножается на
    // вершинные цвета — узоры рисуются ПОЛНЫМ цветом и видны
    // даже на тёмном корпусе (череп на чёрном борту — как надо).
    // Дерево остаётся матовым, золото — глянцевым металлом.
    const F = P.freeboard;
    const cHull = new THREE.Color(P.colors.hull);
    const cBelow = new THREE.Color(0x33402a); // обрастание под водой
    const cBoot = new THREE.Color(0xd8d2c2); // пояс ватерлинии
    const cWale = new THREE.Color(P.colors.trim);
    const stripesL = (P.stripes ?? []).map(st => ({
      y0: st.y0 * F, y1: st.y1 * F, c: new THREE.Color(st.color),
    }));
    const bootTop = Math.max(0.42, F * 0.13);
    const waleY0 = Math.max(0.9, F * 0.22);
    const waleY1 = waleY0 + Math.max(0.45, F * 0.09);
    const Bw = P.beam;
    const rowCol = new THREE.Color();
    for (let py = 0; py < H; py++) {
      const y = (vMin + (1 - py / H) * vSpan) * Bw; // мировая высота строки
      if (y < -0.15) rowCol.copy(cHull).lerp(cBelow, Math.min(1, (-y + 0.15) / P.draft));
      else if (y < bootTop) rowCol.copy(cBoot);
      else {
        let st = false;
        for (const s of stripesL) {
          if (y >= s.y0 && y <= s.y1) { rowCol.copy(s.c); st = true; break; }
        }
        if (!st) {
          if (y > waleY0 && y < waleY1) rowCol.copy(cWale);
          else rowCol.copy(cHull);
        }
      }
      // лёгкая полосатость обшивки (как было в вершинных цветах)
      const k = 1 - 0.06 * (Math.sin(y * 9.0) * 0.5 + 0.5);
      m.fillStyle = `rgb(${Math.round(rowCol.r * 255 * k)},${Math.round(rowCol.g * 255 * k)},${Math.round(rowCol.b * 255 * k)})`;
      m.fillRect(0, py, W, 1);
    }

    // шероховатость/металличность базы
    r.fillStyle = 'rgb(197,197,197)';   // ~0.77 — матовое крашеное дерево
    r.fillRect(0, 0, W, H);
    mt.fillStyle = 'rgb(13,13,13)';     // ~0.05 — дерево не металл
    mt.fillRect(0, 0, W, H);

    if (grainLoaded && grainImg && roughImg) {
      // зерно вдоль корпуса (доски тянутся по длине — вдоль u);
      // в карту цвета — мягким умножением (фактура без смены тона)
      m.save();
      m.globalAlpha = 0.22;
      m.globalCompositeOperation = 'multiply';
      const tileW = 512;
      for (let x = 0; x < W; x += tileW) m.drawImage(grainImg, x, 0, tileW, H);
      m.restore();
      r.globalAlpha = 0.22;
      for (let x = 0; x < W; x += 512) r.drawImage(roughImg, x, 0, 512, H);
      r.globalAlpha = 1;
    }

    // швы обшивки: горизонтальные линии (доски лежат вдоль корпуса)
    const B_ = P.beam;
    const yMinW = vMin * B_, yMaxW = vMax * B_;
    m.strokeStyle = 'rgba(46,30,14,0.20)';
    m.lineWidth = 1;
    r.strokeStyle = 'rgba(120,120,120,0.35)';
    for (let y = Math.ceil(yMinW / 0.34) * 0.34; y < yMaxW; y += 0.34) {
      const py = geo.py(y) + 0.5;
      m.beginPath(); m.moveTo(0, py); m.lineTo(W, py); m.stroke();
      r.beginPath(); r.moveTo(0, py); r.lineTo(W, py); r.stroke();
    }
    // стыки досок в разбежку + пригвоздь
    m.fillStyle = 'rgba(40,26,12,0.16)';
    for (let y = Math.ceil(yMinW / 0.34) * 0.34; y < yMaxW; y += 0.34) {
      let z = -P.length / 2 + rnd() * 2.2;
      while (z < P.length / 2) {
        const px = geo.px(z);
        m.fillRect(px, geo.py(y) - 1, 1.6, 2.6);
        m.fillRect(px - 4, geo.py(y), 1.5, 1.5);   // гвоздь слева
        m.fillRect(px + 3, geo.py(y), 1.5, 1.5);   // гвоздь справа
        z += 3.4 + rnd() * 2.4;
      }
    }
    // потёки/выцветание: вертикальные полупрозрачные полосы
    for (let k = 0; k < 30; k++) {
      const px = rnd() * W;
      const w = 2 + rnd() * 7;
      const grd = m.createLinearGradient(0, geo.py(yMaxW), 0, geo.py(yMinW));
      const a = 0.03 + rnd() * 0.06;
      grd.addColorStop(0, `rgba(28,18,8,${a})`);
      grd.addColorStop(1, 'rgba(28,18,8,0)');
      m.fillStyle = grd;
      m.fillRect(px, 0, w, H * (0.3 + rnd() * 0.7));
    }

    // ===== УКРАШЕНИЯ =====
    drawDeco(decoId, geo, m, r, mt, rnd);

    if (set.map) set.map.needsUpdate = true;
    if (set.rough) set.rough.needsUpdate = true;
    if (set.metal) set.metal.needsUpdate = true;
  };

  const set: DecoTexSet = {
    map: new THREE.CanvasTexture(cMap),
    rough: new THREE.CanvasTexture(cRough),
    metal: new THREE.CanvasTexture(cMetal),
    decoId,
    roughAt: (x, y) => {
      const d = cRough.getContext('2d')!.getImageData(
        Math.max(0, Math.min(W - 1, x | 0)), Math.max(0, Math.min(H - 1, y | 0)), 1, 1).data;
      return d[0];
    },
  };
  set.map.colorSpace = THREE.SRGBColorSpace;
  set.map.wrapS = set.map.wrapT = THREE.ClampToEdgeWrapping;
  set.rough.wrapS = set.rough.wrapT = THREE.ClampToEdgeWrapping;
  set.metal.wrapS = set.metal.wrapT = THREE.ClampToEdgeWrapping;

  redraw();
  if (!grainLoaded) pendingRedraw.push(redraw);
  texCache.set(key, set);
  return set;
}

// ---------- рисование золота на трёх холстах ----------
/** Обвести/залить одну и ту же фигуру на трёх холстах:
 *  map — золотым градиентом, rough — тёмным (глянец),
 *  metal — светлым (металл). path трассует фигуру на ctx */
function paint3(
  m: CanvasRenderingContext2D, r: CanvasRenderingContext2D, mt: CanvasRenderingContext2D,
  path: (c: CanvasRenderingContext2D) => void,
  opts: { stroke?: number; rough?: number; metal?: number; fill?: [string, string] | null },
): void {
  const { stroke = 3.2, rough = 40, metal = 228 } = opts;
  if (opts.fill) {
    // два слоя заливки: светлый тон + тёмный поверх = «объём» резьбы
    path(m);
    m.fillStyle = opts.fill[0];
    m.fill();
    m.fillStyle = opts.fill[1];
    m.fill();
  } else {
    path(m);
    m.lineWidth = stroke;
    m.strokeStyle = '#e8c56a';
    m.stroke();
    path(m);
    m.lineWidth = Math.max(1, stroke - 1.6);
    m.strokeStyle = '#f7e6ab';
    m.stroke();
  }
  // шероховатость: тёмное = глянцевый металл
  path(r);
  if (opts.fill) { r.fillStyle = `rgb(${rough},${rough},${rough})`; r.fill(); }
  else { r.lineWidth = stroke; r.strokeStyle = `rgb(${rough},${rough},${rough})`; r.stroke(); }
  // металличность: светлое = металл
  path(mt);
  if (opts.fill) { mt.fillStyle = `rgb(${metal},${metal},${metal})`; mt.fill(); }
  else { mt.lineWidth = stroke; mt.strokeStyle = `rgb(${metal},${metal},${metal})`; mt.stroke(); }
}

/** Позолоченная завивка-«завиток» с двумя усиками */
function scrollPath(cx: number, cy: number, s: number, dir: number): (c: CanvasRenderingContext2D) => void {
  return (c) => {
    c.beginPath();
    c.moveTo(cx - s * dir, cy);
    c.bezierCurveTo(cx - s * 0.2 * dir, cy - s * 0.9, cx + s * 0.9 * dir, cy - s * 0.8, cx + s * 0.9 * dir, cy);
    c.bezierCurveTo(cx + s * 0.9 * dir, cy + s * 0.55, cx + s * 0.1 * dir, cy + s * 0.55, cx + s * 0.1 * dir, cy);
    c.bezierCurveTo(cx - s * 0.4 * dir, cy + s * 0.02, cx - s * 0.5 * dir, cy + s * 0.7, cx - s * 0.95 * dir, cy + s * 0.75);
  };
}

/** Рамка пушечного порта (золотой наличник) */
function portFrame(geo: Geo, z: number, y: number): (c: CanvasRenderingContext2D) => void {
  const cx = geo.px(z), cy = geo.py(y);
  const w = Math.abs(geo.px(z + 0.42) - geo.px(z - 0.42));
  const h = Math.abs(geo.py(y - 0.30) - geo.py(y + 0.30));
  return (c) => {
    const r = Math.min(w, h) * 0.35;
    c.beginPath();
    c.moveTo(cx - w / 2 + r, cy - h / 2);
    c.arcTo(cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, r);
    c.arcTo(cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2, r);
    c.arcTo(cx - w / 2, cy + h / 2, cx - w / 2, cy - h / 2, r);
    c.arcTo(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, r);
    c.closePath();
  };
}

/** Череп с костями (костяная эмблема — не металл, полуглянец) */
function drawSkull(m: CanvasRenderingContext2D, r: CanvasRenderingContext2D, mt: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // кости за черепом
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    paint3(m, r, mt, (c) => {
      c.save();
      c.translate(cx, cy);
      c.rotate(a);
      c.beginPath();
      c.ellipse(0, 0, s * 1.15, s * 0.16, 0, 0, Math.PI * 2);
      c.ellipse(-s * 1.22, 0, s * 0.17, s * 0.22, 0, 0, Math.PI * 2);
      c.ellipse(s * 1.22, 0, s * 0.17, s * 0.22, 0, 0, Math.PI * 2);
      c.restore();
    }, { fill: ['#e5ddc8', '#cfc5ab'], rough: 95, metal: 26 });
  }
  // череп
  paint3(m, r, mt, (c) => {
    c.beginPath();
    c.ellipse(cx, cy - s * 0.15, s * 0.62, s * 0.7, 0, 0, Math.PI * 2);
    c.moveTo(cx - s * 0.34, cy + s * 0.4);
    c.lineTo(cx + s * 0.34, cy + s * 0.4);
    c.lineTo(cx + s * 0.26, cy + s * 0.82);
    c.lineTo(cx - s * 0.26, cy + s * 0.82);
    c.closePath();
  }, { fill: ['#efe8d6', '#d8cfb6'], rough: 95, metal: 26 });
  // глазницы + нос
  m.fillStyle = '#181008';
  m.beginPath();
  m.ellipse(cx - s * 0.26, cy - s * 0.18, s * 0.15, s * 0.19, 0, 0, Math.PI * 2);
  m.ellipse(cx + s * 0.26, cy - s * 0.18, s * 0.15, s * 0.19, 0, 0, Math.PI * 2);
  m.moveTo(cx, cy + s * 0.1);
  m.lineTo(cx - s * 0.09, cy + s * 0.34);
  m.lineTo(cx + s * 0.09, cy + s * 0.34);
  m.fill();
  // зубы
  m.strokeStyle = '#181008';
  m.lineWidth = 1.4;
  m.beginPath();
  for (let i = -2; i <= 2; i++) {
    m.moveTo(cx + i * s * 0.12, cy + s * 0.42);
    m.lineTo(cx + i * s * 0.12, cy + s * 0.8);
  }
  m.stroke();
}

/** Лист аканта */
function leafPath(cx: number, cy: number, s: number, dir: number): (c: CanvasRenderingContext2D) => void {
  return (c) => {
    c.beginPath();
    c.moveTo(cx, cy);
    c.bezierCurveTo(cx + s * 0.5 * dir, cy - s * 0.55, cx + s * 1.15 * dir, cy - s * 0.35, cx + s * 1.25 * dir, cy + s * 0.1);
    c.bezierCurveTo(cx + s * 0.8 * dir, cy + s * 0.28, cx + s * 0.35 * dir, cy + s * 0.16, cx, cy);
    c.closePath();
  };
}

/** Текст на трёх холстах (fillText рисует сразу — путь не строится) */
function text3(
  m: CanvasRenderingContext2D, r: CanvasRenderingContext2D, mt: CanvasRenderingContext2D,
  at: (c: CanvasRenderingContext2D) => void,
  mapColor: string, roughVal: number, metalVal: number,
): void {
  m.fillStyle = mapColor; at(m);
  r.fillStyle = `rgb(${roughVal},${roughVal},${roughVal})`; at(r);
  mt.fillStyle = `rgb(${metalVal},${metalVal},${metalVal})`; at(mt);
}

/** Главная отрисовка выбранного украшения */
function drawDeco(
  decoId: string, geo: Geo,
  m: CanvasRenderingContext2D, r: CanvasRenderingContext2D, mt: CanvasRenderingContext2D,
  rnd: () => number,
): void {
  const P = geo.P;
  const L = P.length;
  const waleY = Math.max(0.9, P.freeboard * 0.22) + Math.max(0.45, P.freeboard * 0.09) * 0.5;
  const bandY = geo.ports.length ? geo.ports.reduce((a, p) => Math.max(a, p.y), 0) + 0.42 : waleY;

  if (decoId === 'deco.none') return;

  if (decoId === 'deco.gold' || decoId === 'deco.acanthus') {
    // лента вдоль батареи: завитки (резьба) или листья (акант)
    const z0 = -L * 0.34, z1 = L * 0.36;
    const step = 1.35;
    for (let z = z0, i = 0; z < z1; z += step, i++) {
      const cx = geo.px(z), cy = geo.py(bandY);
      if (decoId === 'deco.gold') {
        paint3(m, r, mt, scrollPath(cx, cy, Math.abs(geo.px(z + 0.55) - geo.px(z)), i % 2 ? 1 : -1), {});
      } else {
        paint3(m, r, mt, leafPath(cx, cy, Math.abs(geo.px(z + 0.62) - geo.px(z)), i % 2 ? 1 : -1), { fill: ['#dcb452', '#b08a34'] });
        paint3(m, r, mt, leafPath(cx, cy + 5, Math.abs(geo.px(z + 0.4) - geo.px(z)) * 0.7, i % 2 ? -1 : 1), { fill: ['#c9a244', '#96742c'] });
      }
    }
    // рамки вокруг портов
    for (const p of geo.ports) paint3(m, r, mt, portFrame(geo, p.z, p.y), {});
    // завиток у форштевня
    paint3(m, r, mt, scrollPath(geo.px(L * 0.40), geo.py(P.freeboard * 0.55), Math.abs(geo.px(L * 0.06) - geo.px(0)), -1), {});
    paint3(m, r, mt, scrollPath(geo.px(L * 0.36), geo.py(P.freeboard * 0.36), Math.abs(geo.px(L * 0.05) - geo.px(0)), -1), {});
    return;
  }

  if (decoId === 'deco.skull') {
    const s = Math.abs(geo.px(L * 0.055) - geo.px(0));
    drawSkull(m, r, mt, geo.px(-L * 0.315), geo.py(P.freeboard * 0.45), s);
    drawSkull(m, r, mt, geo.px(L * 0.36), geo.py(P.freeboard * 0.5), s * 0.8);
    // тонкая кайма вельса
    paint3(m, r, mt, (c) => {
      c.beginPath();
      c.moveTo(geo.px(-L * 0.34), geo.py(bandY));
      c.lineTo(geo.px(L * 0.36), geo.py(bandY));
    }, { stroke: 2 });
    for (const p of geo.ports) paint3(m, r, mt, portFrame(geo, p.z, p.y), { stroke: 2.2 });
    return;
  }

  if (decoId === 'deco.monogram') {
    // вензель: литера под короной, с росчерками
    const cx = geo.px(-L * 0.30), cy = geo.py(P.freeboard * 0.46);
    const s = Math.abs(geo.px(L * 0.045) - geo.px(0));
    const letterAt = (x: number, y: number, size: number) => (c: CanvasRenderingContext2D) => {
      c.save();
      c.translate(x, y);
      c.font = `bold ${Math.round(size)}px Georgia, 'Times New Roman', serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('R', 0, 0);
      c.restore();
    };
    text3(m, r, mt, letterAt(cx, cy, s * 2.4), '#ecc96e', 42, 230);
    // лёгкая тень литеры на карте цвета
    m.save();
    m.globalAlpha = 0.45;
    m.fillStyle = '#8a6420';
    letterAt(cx + 1.5, cy + 1.5, s * 2.4)(m);
    m.restore();
    // корона
    paint3(m, r, mt, (c) => {
      c.beginPath();
      const y0 = cy - s * 1.75;
      c.moveTo(cx - s, y0 + s * 0.5);
      c.lineTo(cx - s, y0);
      c.lineTo(cx - s * 0.5, y0 + s * 0.35);
      c.lineTo(cx, y0 - s * 0.25);
      c.lineTo(cx + s * 0.5, y0 + s * 0.35);
      c.lineTo(cx + s, y0);
      c.lineTo(cx + s, y0 + s * 0.5);
      c.closePath();
    }, { fill: ['#ecc96e', '#b78c34'] });
    // росчерки в стороны
    paint3(m, r, mt, scrollPath(cx - s * 2.2, cy + s * 0.5, s * 1.4, 1), {});
    paint3(m, r, mt, scrollPath(cx + s * 2.2, cy + s * 0.5, s * 1.4, -1), {});
    // малый вензель у форштевня
    text3(m, r, mt, letterAt(geo.px(L * 0.375), geo.py(P.freeboard * 0.5), s * 1.4), '#ecc96e', 42, 230);
    return;
  }

  if (decoId === 'deco.stern') {
    // «гнев морей»: злые глаза у форштевня + боевые полосы по шкафуту
    const eyeY = geo.py(P.freeboard * 0.52);
    for (const dz of [-0.6, 0.6]) {
      paint3(m, r, mt, (c) => {
        c.beginPath();
        c.ellipse(geo.px(L * 0.335 + dz * 0), eyeY, Math.abs(geo.px(0.55) - geo.px(0)), Math.abs(geo.py(0) - geo.py(0.2)), -dz * 0.35, 0, Math.PI * 2);
      }, { fill: ['#e2b13c', '#8a6420'] });
      paint3(m, r, mt, (c) => {
        c.beginPath();
        c.ellipse(geo.px(L * 0.335), eyeY + dz * 1.5, Math.abs(geo.px(0.22) - geo.px(0)), Math.abs(geo.py(0) - geo.py(0.1)), -dz * 0.35, 0, Math.PI * 2);
      }, { fill: ['#1a0f06', '#1a0f06'], rough: 120, metal: 0 });
    }
    // боевые диагональные полосы
    const stripeW = Math.abs(geo.px(1.1) - geo.px(0));
    for (let i = 0; i < 9; i++) {
      const z = -L * 0.33 + i * (L * 0.7 / 9);
      paint3(m, r, mt, (c) => {
        c.beginPath();
        c.moveTo(geo.px(z), geo.py(-P.draft * 0.4));
        c.lineTo(geo.px(z + 1.6), geo.py(-P.draft * 0.4));
        c.lineTo(geo.px(z + 3.2), geo.py(P.freeboard * 0.62));
        c.lineTo(geo.px(z + 1.6), geo.py(P.freeboard * 0.62));
        c.closePath();
      }, { fill: ['#d9ab48', '#a17d2c'], rough: 60 });
    }
    for (const p of geo.ports) paint3(m, r, mt, portFrame(geo, p.z, p.y), { stroke: 2.4 });
    return;
  }
}

/** Кэш-доступ для E2E/диагностики: получить готовый набор холстов */
export function getDecoSet(P: ShipPreset, decoId: string): DecoTexSet | undefined {
  return texCache.get(`${P.id}|${decoId}`);
}
