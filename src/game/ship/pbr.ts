// ============================================================
// Процедурные PBR-текстуры: карты нормалей и шероховатости
// для ДЕРЕВА (палуба / обшивка корпуса / рангоут) и МЕТАЛЛА
// (орудия, якоря, фурнитура, фонарь, фигура).
//
// Всё генерируется на канвасах ОДИН раз и шарится между всеми
// кораблями (кэш в модуле) — GPU хранит ровно один экземпляр
// каждой текстуры. Тайлинг бесшовный (value-noise по тору,
// канавки и стыки — по тем же формулам, что в диффузе палубы,
// поэтому рельеф СОВПАДАЕТ с нарисованными досками).
// ============================================================
import * as THREE from 'three';

// ---------- детерминированный ГПСЧ ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Бесшовный value-noise: сетка size×size, координаты в ЯЧЕЙКАХ
 *  (x может расти сколь угодно — сетка тайлится по модулю size) */
function tileNoise(rand: () => number, size: number): (x: number, y: number) => number {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = sm(x - xi), fy = sm(y - yi);
    const x0 = ((xi % size) + size) % size, y0 = ((yi % size) + size) % size;
    const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
    const a = g[y0 * size + x0], b = g[y0 * size + x1];
    const c = g[y1 * size + x0], d = g[y1 * size + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function finish(t: THREE.CanvasTexture): THREE.CanvasTexture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Поле высот → карта нормалей (Sobel с завёрнутыми соседями).
 *  Канавонка должна держаться в масштабе ~1 единицы высоты на
 *  пару пикселей; итоговая сила дополнительно управляется
 *  material.normalScale. */
function normalTexFromHeight(h: Float32Array, S: number, strength: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const img = x.createImageData(S, S);
  const H = (px: number, py: number) =>
    h[(((py % S) + S) % S) * S + (((px % S) + S) % S)];
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      // canvas: py ВНИЗ; UV v ВВЕРХ (flipY) → N.y = +dH/dpy
      const dx = (H(px + 1, py) - H(px - 1, py)) * strength;
      const dy = (H(px, py + 1) - H(px, py - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      nx *= il; ny *= il; nz *= il;
      const o = (py * S + px) * 4;
      img.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(c));
}

/** Поле шероховатости (0..1) → grayscale-текстура.
 *  three.js читает шероховатость из ЗЕЛЁНОГО канала — grayscale
 *  подходит (r=g=b). */
function roughTexFromField(f: Float32Array, S: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const img = x.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = Math.round(Math.min(1, Math.max(0, f[i])) * 255);
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(c));
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, build: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = build(); cache.set(key, t); }
  return t;
}

// ============================================================
// ДЕРЕВО
// ============================================================
export type WoodKind = 'deck' | 'hull' | 'spar';

/** Карта нормалей дерева.
 *  deck — рельеф СОВПАДАЕТ с диффузом палубы (N=30 досок,
 *         стыки (i*137+61)%S, гвозди на тех же местах);
 *  hull — пояса обшивки горизонтальными канавками + волокна
 *         вдоль корпуса (планки идут по длине корабля);
 *  spar — чистые волокна (мачты/реи/вёсла — без досок). */
export function woodNormalTex(kind: WoodKind): THREE.Texture {
  return cached(`n-${kind}`, () => {
    if (kind === 'deck') {
      const S = 512, N = 30, pw = S / N;
      const rand = mulberry32(20260101);
      const g1 = tileNoise(rand, 16), g2 = tileNoise(rand, 32);
      const tilt = Array.from({ length: N }, () => (rand() - 0.5) * 0.45);
      const h = new Float32Array(S * S);
      for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
          const i = Math.min(N - 1, Math.floor(px / pw));
          const dm = px - i * pw;
          const edge = Math.min(dm, pw - dm);
          let v = tilt[i];
          // конопаченый шов между досками
          if (edge < 1.5) v -= (1.5 - edge) / 1.5;
          // поперечные стыки досок с разбежкой (формула диффуза!)
          const b1 = (i * 137 + 61) % S;
          const b2 = (b1 + Math.round(S * 0.55)) % S;
          for (const b of [b1, b2]) {
            let db = Math.abs(py - b);
            db = Math.min(db, S - db);
            if (db < 1.4) v -= (1.4 - db) / 1.4 * 1.1;
          }
          // гвозди — маленькие вмятины (позиции диффуза)
          const nails: [number, number][] = [
            [i * pw + pw * 0.3, b1 + 5], [i * pw + pw * 0.7, b2 - 3]];
          for (const [nx, ny] of nails) {
            const dd = Math.hypot(px - nx, py - ny);
            if (dd < 2.4) v -= (2.4 - dd) / 2.4 * 0.8;
          }
          // волокна — вытянуты ВДОЛЬ доски (вдоль py канваса)
          v += (g1(px / S * 14, py / S * 1.6) - 0.5) * 0.5
            + (g2(px / S * 44, py / S * 5) - 0.5) * 0.3;
          h[py * S + px] = v;
        }
      }
      return normalTexFromHeight(h, S, 2.2);
    }
    if (kind === 'hull') {
      const S = 512, NB = 24, band = S / NB;
      const rand = mulberry32(20260202);
      const g1 = tileNoise(rand, 16), g2 = tileNoise(rand, 32);
      const tilt = Array.from({ length: NB }, () => (rand() - 0.5) * 0.4);
      const h = new Float32Array(S * S);
      for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
          // лёгкая волнистость швов (обшивка «дышит»)
          const wob = Math.sin(px / S * Math.PI * 2 * 3) * 1.6
            + (g2(px / S * 26, 3.7) - 0.5) * 3.0;
          const qy = py + wob;
          const i = Math.min(NB - 1, Math.max(0, Math.floor(qy / band)));
          const dm = qy - i * band;
          const edge = Math.min(dm, band - dm);
          let v = tilt[i];
          if (edge < 2.4) v -= (2.4 - edge) / 2.4 * 1.15; // шов между поясами
          // волокна вдоль корпуса (вдоль px канваса)
          v += (g1(px / S * 1.7, py / S * 15) - 0.5) * 0.55
            + (g2(px / S * 4.5, py / S * 46) - 0.5) * 0.3;
          h[py * S + px] = v;
        }
      }
      return normalTexFromHeight(h, S, 2.0);
    }
    // spar — мачты/реи/вёсла: вертикальные волокна, годовые
    // валики, без досок и швов
    {
      const S = 256;
      const rand = mulberry32(20260303);
      const g1 = tileNoise(rand, 16), g2 = tileNoise(rand, 32);
      const h = new Float32Array(S * S);
      for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
          let v = (g1(px / S * 18, py / S * 1.8) - 0.5) * 0.9
            + (g2(px / S * 52, py / S * 6) - 0.5) * 0.45;
          // редкие длинные глубокие борозды
          const s = g1(px / S * 9, py / S * 0.9);
          if (s > 0.72) v -= (s - 0.72) * 2.2;
          h[py * S + px] = v;
        }
      }
      return normalTexFromHeight(h, S, 2.4);
    }
  });
}

/** Карта шероховатости дерева: палуба — матовое выветренное
 *  дерево с потёртостями, корпус — крашеное дерево чуть глянцевее,
 *  рангоут — смолёное/оструганное. */
export function woodRoughTex(kind: WoodKind): THREE.Texture {
  return cached(`r-${kind}`, () => {
    const S = 256;
    const rand = mulberry32(kind === 'deck' ? 20260404 : kind === 'hull' ? 20260505 : 20260606);
    const n1 = tileNoise(rand, 16), n2 = tileNoise(rand, 8);
    const f = new Float32Array(S * S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const blotch = n1(px / S * 5, py / S * 5) - 0.5;
        let v: number;
        if (kind === 'deck') {
          // вытертая дорожка вдоль палубы + сырые разводы
          const wear = (n2(px / S * 2.5, py / S * 12) - 0.5) * 0.12;
          v = 0.92 + blotch * 0.1 + wear;
        } else if (kind === 'hull') {
          // крашеный борт: местами блестит свежая краска
          const paint = n2(px / S * 3.5, py / S * 3.5);
          v = paint > 0.62 ? 0.7 : 0.84 + blotch * 0.08;
        } else {
          v = 0.74 + blotch * 0.14;
        }
        f[py * S + px] = Math.min(0.98, Math.max(0.55, v));
      }
    }
    return roughTexFromField(f, S);
  });
}

// ============================================================
// МЕТАЛЛ
// ============================================================

/** Карта нормалей металла: ковано-штампованная поверхность —
 *  сеть мягких вмятин от молота + шлифованные штрихи + раковины */
export function metalNormalTex(): THREE.Texture {
  return cached('n-metal', () => {
    const S = 256;
    const rand = mulberry32(20260707);
    const m1 = tileNoise(rand, 16), m2 = tileNoise(rand, 32), m3 = tileNoise(rand, 16);
    const h = new Float32Array(S * S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const n = m1(px / S * 9, py / S * 9);
        const ridge = 1 - Math.abs(2 * n - 1);      // сеть «складок» ковки
        let v = (ridge - 0.5) * 0.8;
        v += (m2(px / S * 3, py / S * 34) - 0.5) * 0.3; // шлифовка вдоль ствола
        const p = m3(px / S * 22, py / S * 22);
        if (p > 0.8) v -= (p - 0.8) * 3;                // раковины
        h[py * S + px] = v;
      }
    }
    return normalTexFromHeight(h, S, 2.6);
  });
}

/** Шероховатость металла: полированное железо/бронза с пятнами
 *  окалины и патины (грубые пятна по низкочастотному шуму) */
export function metalRoughTex(): THREE.Texture {
  return cached('r-metal', () => {
    const S = 256;
    const rand = mulberry32(20260808);
    const m1 = tileNoise(rand, 16), m2 = tileNoise(rand, 32);
    const f = new Float32Array(S * S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const patina = m1(px / S * 6, py / S * 6) * 0.75
          + m2(px / S * 18, py / S * 18) * 0.25;
        const v = patina > 0.6 ? 0.55 + (patina - 0.6) * 0.9 : 0.4 + patina * 0.15;
        f[py * S + px] = Math.min(0.85, Math.max(0.3, v));
      }
    }
    return roughTexFromField(f, S);
  });
}
