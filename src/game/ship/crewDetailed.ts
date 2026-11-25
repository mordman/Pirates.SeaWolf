import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CrewFigure, CrewRole, mulberry32, Traits, BUILD_FAC } from './crew';

// ============================================================
// Task 76: ДЕТАЛЬНЫЕ ПЕРСОНАЖИ XVII ВЕКА — ПОЛНАЯ ПЕРЕРАБОТКА
// (вместо модели Task 52; «на основе простых моделей, в том же
// стиле»: та же система координат y=0 палуба / +Z нос / +X порт,
// рост ~1.5-1.6 м, тот же интерфейс CrewFigure — ноги/руки как
// Object3D с пивотами в суставах, работает существующая анимация
// ходьбы/махов/постов Task 39-48).
//
// ПЯТЬ ПРОФЕССИЙ (DetailProfession): моряк / солдат / торговец /
// пират / капитан — каждая со своим гардеробом XVII века:
//  - МОРЯК: тельняшка или рубаха, бриджи/чулки, бандана либо
//    соломенная шляпа, кортик, подвязка у колена
//  - СОЛДАТ: мундир с лацканами и фалдами, ТРЕУГОЛКА, ботфорты
//    с отворотами, кожаный БАНДОЛЬЕР с «ДВЕНАДЦАТЬЮ АПОСТОЛАМИ»
//  - ТОРГОВЕЦ: богатый кафтан с пуговицами, широкополая шляпа
//    с ПЕРОМ, кошель на поясе
//  - ПИРАТ: тёмный кафтан/жилет, КУШАК, бандана с хвостом или
//    шляпа с пером, наглазник, ДВА пистолета за поясом
//  - КАПИТАН: синий кафтан с ЗОЛОТЫМИ пуговицами и расклешёнными
//    полами, кружевной КРАВАТ, cavalier-шляпа с пером, подзорная
//    труба на перевязи
//
// ПО ТЗ ИГРОКА:
//  1. СКЕЛЕТ: THREE.Group на КАЖДОМ суставе — таз → позвоночник
//     → грудная клетка → шея → голова; плечо → локоть → кисть;
//     бедро → колено → ступня (плавная процедурная анимация)
//  2. СЛОЖНАЯ ГЕОМЕТРИЯ: LatheGeometry по гладким кривым
//     CatmullRomCurve3 — анатомический торс (талия/рёбра/плечи),
//     кафтан с РАСКЛЕШЁННЫМИ ПОЛАМИ (coatSkirt), БОТФОРТЫ с
//     отворотами, широкополая cavalier-шляпа с ЗАГНУТЫМ полем
//  3. СНАРЯЖЕНИЕ: кожаная перевязь-бандольер с деревянными
//     зарядами («двенадцать апостолов»), медная пряжка, кремнёвый
//     пистолет за поясом, усы и борода, пуговицы вдоль кафтана
//  4. PBR: процедурные Canvas-карты diffuse + bumpMap +
//     roughnessMap — грубая шерсть, потёртая кожа, древесина,
//     кованая латунь, кожа лица (поры/щетина/шрам)
//  5. КИСТИ С ПАЛЬЦАМИ: большой палец + 4 пальца по 3 фаланги
//     (суставы-Group, сгибаются), правая ОБХВАТЫВАЕТ эфес сабли
//  6. САБЛЯ (cutlass): изогнутый клинок ExtrudeGeometry по кривым
//     Безье, латунная ГАРДА-ЧАШКА, ореховая рукоять с проволокой;
//     НОЖНЫ на перевязи у левого бедра
//  7. ПЕРО на шляпе: изогнутая плоскость с альфа-текстурой
//     волокон, колышется на ветру
//  8. ВЕТЕР (Vertex Animation): полы кафтана coatSkirt, шейный
//     платок cravat и перо деформируются по вершинам в реальном
//     времени, имитируя порывы морского ветра
//  9. АНИМАЦИИ: дыхание (расширение грудной клетки + плечи),
//     удержание равновесия при качке (компенсация наклона
//     корпусом и ногами), повороты головы и осмотр горизонта;
//     ИНТЕРАКТИВНЫЕ РЕЖИМЫ (превью /crew): Дозор на палубе
//     (idle), Боевая стойка (combat), Выстрел из пистолета
//     (pistol: выхватывание ЛЕВОЙ рукой → прицеливание →
//     вспышка → отдача → облако порохового дыма)
// 10. МЕРТВЕЦ (undead, «Чёрная жемчужина»): трупная кожа с
//     пятнами тлена, рваные полы кафтана, светящиеся глазницы;
//     капитан-мертвец — ПРОКЛЯТЫЙ ЗЕЛЁНЫЙ КЛИНОК (emissive
//     0x1e8f3e) с мерцающей дымкой (совместимо с e2e v75 B6)
// ============================================================

export type DetailProfession = 'sailor' | 'soldier' | 'merchant' | 'pirate' | 'captain';

/** Профессия детальной фигуры по роли/типу судна (crew.ts) */
export function professionFor(role: CrewRole, kind: string, rnd: () => number): DetailProfession {
  if (role === 'captain') return 'captain';
  if (kind === 'navy') return rnd() < 0.8 ? 'soldier' : 'sailor';
  if (kind === 'merchant') return rnd() < 0.32 ? 'merchant' : 'sailor';
  return rnd() < 0.45 ? 'pirate' : 'sailor';   // пиратский корабль: смесь пиратов и простых матросов
}

// ------------------------------------------------------------
// ПРОЦЕДУРНЫЕ PBR-ТЕКСТУРЫ (HTML5 Canvas; кэш модуля).
// Каждый генератор рисует ТРИ карты: diffuse (SRGB), bump
// (рельеф) и roughness — имитация фактуры материала.
// ------------------------------------------------------------
const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, size: number, srgb: boolean, draw: (x: CanvasRenderingContext2D, s: number) => void,
  repeat = 1): THREE.Texture {
  const k = `${key}|${repeat}`;
  let t = texCache.get(k);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  texCache.set(k, t);
  return t;
}
/** детерминированный шум (текстуры воспроизводимы по ключу) */
function texHash(a: number, b: number, c: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** ГРУБАЯ ШЕРСТЬ (сукно): саржевое плетение нити в три цвета
 *  карты — diffuse почти однотонный (материал красит color'ом),
 *  bump — рельеф переплетения, roughness — матовая с лоском */
function woolMaps(hex: number, key: string): { map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture } {
  return {
    map: canvasTex(`woolD${key}`, 96, true, (x, s) => {
      x.fillStyle = '#d8d4cc';
      x.fillRect(0, 0, s, s);
      for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
        const twill = (px + py * 2) % 6 < 3 ? 232 : 208;      // саржа 2/2 — диагональный рубчик
        const n = texHash(px, py, 1) * 26 - 13;               // ворс
        const v = Math.max(150, Math.min(255, twill + n));
        x.fillStyle = `rgb(${v | 0},${(v - 2) | 0},${(v - 6) | 0})`;
        x.fillRect(px, py, 1, 1);
      }
    }),
    bump: canvasTex(`woolB${key}`, 96, false, (x, s) => {
      for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
        const twill = (px + py * 2) % 6 < 3 ? 165 : 90;       // гребни/впадины рубчика
        const v = twill + texHash(px, py, 2) * 40 - 20;
        x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        x.fillRect(px, py, 1, 1);
      }
    }),
    rough: canvasTex(`woolR${key}`, 96, false, (x, s) => {
      for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
        const v = 215 + texHash(px, py, 3) * 36 - 18;         // шерсть матовая, местами залоснилась
        x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        x.fillRect(px, py, 1, 1);
      }
    }),
  };
}

/** ПОТЁРТАЯ КОЖА: мелкозернистая фактура + сеть морщин-складок */
function leatherMaps(key: string): { map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture } {
  return {
    map: canvasTex(`lthD${key}`, 128, true, (x, s) => {
      x.fillStyle = '#d0c8bc';
      x.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {                          // зерно кожи
        const v = texHash(i, 5, 7) * 40 - 20;
        x.fillStyle = `rgba(${128 + v | 0},${120 + v | 0},${110 + v | 0},0.25)`;
        x.fillRect(texHash(i, 1, 1) * s, texHash(i, 2, 2) * s, 1.5, 1.5);
      }
      x.strokeStyle = 'rgba(70,60,50,0.30)';                   // морщины
      for (let i = 0; i < 14; i++) {
        x.lineWidth = 0.6 + texHash(i, 3, 3) * 1.1;
        x.beginPath();
        const y0 = texHash(i, 4, 4) * s;
        x.moveTo(0, y0);
        for (let px = 0; px <= s; px += 16)
          x.lineTo(px, y0 + Math.sin(px * 0.12 + i * 2.4) * 3.5);
        x.stroke();
      }
    }),
    bump: canvasTex(`lthB${key}`, 128, false, (x, s) => {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const v = 128 + texHash(i, 6, 8) * 56 - 28;
        x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        x.fillRect(texHash(i, 7, 1) * s, texHash(i, 8, 2) * s, 1.6, 1.6);
      }
      x.strokeStyle = 'rgba(52,52,52,0.8)';
      for (let i = 0; i < 14; i++) {
        x.lineWidth = 1.4;
        x.beginPath();
        const y0 = texHash(i, 4, 4) * s;
        x.moveTo(0, y0);
        for (let px = 0; px <= s; px += 16)
          x.lineTo(px, y0 + Math.sin(px * 0.12 + i * 2.4) * 3.5);
        x.stroke();
      }
    }),
    rough: canvasTex(`lthR${key}`, 96, false, (x, s) => {
      for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
        const v = 165 + texHash(px, py, 9) * 40 - 20;          // кожа чище шерсти
        x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        x.fillRect(px, py, 1, 1);
      }
    }),
  };
}

/** ДРЕВЕСИНА: волокна вдоль доски + сучки (заряды бандольера,
 *  рукояти, палуба превью) */
function woodMaps(key: string): { map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture } {
  return {
    map: canvasTex(`woodD${key}`, 128, true, (x, s) => {
      x.fillStyle = '#c8a878';
      x.fillRect(0, 0, s, s);
      for (let i = 0; i < 30; i++) {                           // волокна
        x.strokeStyle = `rgba(${90 + texHash(i, 1, 1) * 60 | 0},${60 + texHash(i, 2, 2) * 40 | 0},30,0.30)`;
        x.lineWidth = 0.7 + texHash(i, 3, 3) * 1.6;
        x.beginPath();
        const x0 = texHash(i, 4, 4) * s;
        x.moveTo(x0, 0);
        for (let py = 0; py <= s; py += 14)
          x.lineTo(x0 + Math.sin(py * 0.09 + i) * 4, py);
        x.stroke();
      }
      for (let i = 0; i < 3; i++) {                            // сучки
        const kx = texHash(i, 5, 5) * s, ky = texHash(i, 6, 6) * s;
        const g = x.createRadialGradient(kx, ky, 1, kx, ky, 9);
        g.addColorStop(0, 'rgba(70,45,20,0.75)');
        g.addColorStop(1, 'rgba(70,45,20,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(kx, ky, 9, 0, 6.29); x.fill();
      }
    }),
    bump: canvasTex(`woodB${key}`, 128, false, (x, s) => {
      x.fillStyle = '#8a8a8a';
      x.fillRect(0, 0, s, s);
      for (let i = 0; i < 30; i++) {
        x.strokeStyle = `rgba(50,50,50,${0.25 + texHash(i, 7, 7) * 0.3})`;
        x.lineWidth = 1.2;
        x.beginPath();
        const x0 = texHash(i, 4, 4) * s;
        x.moveTo(x0, 0);
        for (let py = 0; py <= s; py += 14)
          x.lineTo(x0 + Math.sin(py * 0.09 + i) * 4, py);
        x.stroke();
      }
    }),
    rough: canvasTex(`woodR${key}`, 96, false, (x, s) => {
      x.fillStyle = '#b4b4b4';
      x.fillRect(0, 0, s, s);
    }),
  };
}

/** КОВАНАЯ ЛАТУНЬ: пятна патины + царапины-блики (пряжки,
 *  гарда, пуговицы, оковки) */
function brassMaps(): { map: THREE.Texture; rough: THREE.Texture } {
  return {
    map: canvasTex('brassD', 96, true, (x, s) => {
      x.fillStyle = '#e8d9a8';
      x.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {                           // патина
        const kx = texHash(i, 1, 2) * s, ky = texHash(i, 2, 3) * s;
        const g = x.createRadialGradient(kx, ky, 1, kx, ky, 6 + texHash(i, 3, 4) * 14);
        g.addColorStop(0, 'rgba(110,130,80,0.30)');
        g.addColorStop(1, 'rgba(110,130,80,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(kx, ky, 20, 0, 6.29); x.fill();
      }
      x.strokeStyle = 'rgba(255,250,225,0.5)';                 // царапины
      for (let i = 0; i < 46; i++) {
        x.lineWidth = 0.6;
        x.beginPath();
        const kx = texHash(i, 4, 5) * s, ky = texHash(i, 5, 6) * s;
        x.moveTo(kx, ky);
        x.lineTo(kx + texHash(i, 6, 7) * 22 - 11, ky + texHash(i, 7, 8) * 6 - 3);
        x.stroke();
      }
    }),
    rough: canvasTex('brassR', 96, false, (x, s) => {
      x.fillStyle = '#6f6f6f';
      x.fillRect(0, 0, s, s);
      x.strokeStyle = 'rgba(200,200,200,0.6)';
      for (let i = 0; i < 46; i++) {
        x.lineWidth = 0.8;
        x.beginPath();
        const kx = texHash(i, 4, 5) * s, ky = texHash(i, 5, 6) * s;
        x.moveTo(kx, ky);
        x.lineTo(kx + texHash(i, 6, 7) * 22 - 11, ky + texHash(i, 7, 8) * 6 - 3);
        x.stroke();
      }
    }),
  };
}

/** КОЖА ЛИЦА: тон кожи + ПОРЫ + румянец + лёгкая НЕБРИТОСТЬ
 *  (нижняя треть UV — зона подбородка/щёк) + ШРАМ (у traits.scar
 *  профессий) + у мертвеца — ПЯТНА ТЛЕНА и проступающие вены.
 *  Той же картой — bump (поры/щетина рельефом) */
function faceMaps(skin: number, opts: { stubble: number; scar: boolean; undead: boolean }): {
  map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture;
} {
  const k = `${skin}-${opts.stubble | 0}-${opts.scar ? 1 : 0}-${opts.undead ? 1 : 0}`;
  const col = new THREE.Color(skin);
  const base = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
  return {
    map: canvasTex(`faceD${k}`, 128, true, (x, s) => {
      x.fillStyle = base;
      x.fillRect(0, 0, s, s);
      for (const cx of [s * 0.24, s * 0.76]) {                 // румянец на щеках
        const g = x.createRadialGradient(cx, s * 0.60, 2, cx, s * 0.60, s * 0.19);
        g.addColorStop(0, opts.undead ? 'rgba(96,116,88,0.34)' : 'rgba(214,110,86,0.36)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, s, s);
      }
      for (let i = 0; i < 620; i++) {                          // ПОРЫ
        const v = texHash(i, 1, 1) * 34 - 17;
        x.fillStyle = `rgba(${128 + v | 0},${96 + v | 0},${82 + v | 0},0.35)`;
        x.fillRect(texHash(i, 2, 2) * s, texHash(i, 3, 3) * s, 1, 1);
      }
      if (opts.stubble > 0) {                                  // лёгкая небритость
        x.fillStyle = `rgba(34,26,22,${0.10 + opts.stubble * 0.14})`;
        x.fillRect(0, s * 0.66, s, s * 0.34);
        for (let i = 0; i < 420; i++) {
          x.fillStyle = `rgba(24,18,16,${0.22 + opts.stubble * 0.2})`;
          x.fillRect(texHash(i, 4, 4) * s, s * 0.64 + texHash(i, 5, 5) * s * 0.36, 1, 1.6);
        }
      }
      if (opts.scar) {                                         // ШРАМ через бровь/щеку
        x.strokeStyle = 'rgba(255,236,222,0.75)';
        x.lineWidth = 2.6;
        x.beginPath();
        x.moveTo(s * 0.66, s * 0.14);
        x.lineTo(s * 0.54, s * 0.52);
        x.stroke();
        x.lineWidth = 1;
        for (let i = 0; i < 6; i++) {                          // стежки
          const t0 = i / 6;
          const sx = s * (0.66 - t0 * 0.12), sy = s * (0.14 + t0 * 0.38);
          x.beginPath(); x.moveTo(sx - 4, sy); x.lineTo(sx + 4, sy); x.stroke();
        }
      }
      if (opts.undead) {                                       // тлен: пятна + вены
        for (let i = 0; i < 22; i++) {
          const kx = texHash(i, 6, 6) * s, ky = texHash(i, 7, 7) * s;
          const g = x.createRadialGradient(kx, ky, 1, kx, ky, 7 + texHash(i, 8, 8) * 15);
          g.addColorStop(0, 'rgba(38,52,34,0.4)');
          g.addColorStop(1, 'rgba(38,52,34,0)');
          x.fillStyle = g;
          x.beginPath(); x.arc(kx, ky, 22, 0, 6.29); x.fill();
        }
        x.strokeStyle = 'rgba(72,110,82,0.3)';
        x.lineWidth = 0.8;
        for (let i = 0; i < 12; i++) {
          x.beginPath();
          const kx = texHash(i, 9, 9) * s, ky = texHash(i, 10, 10) * s;
          x.moveTo(kx, ky);
          x.quadraticCurveTo(kx + 12, ky + texHash(i, 11, 1) * 16 - 8, kx + 24, ky + texHash(i, 12, 2) * 20 - 10);
          x.stroke();
        }
      }
    }),
    bump: canvasTex(`faceB${k}`, 128, false, (x, s) => {
      x.fillStyle = '#848484';
      x.fillRect(0, 0, s, s);
      for (let i = 0; i < 700; i++) {                          // поры рельефом
        const v = 128 + texHash(i, 1, 1) * 46 - 23;
        x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        x.fillRect(texHash(i, 2, 2) * s, texHash(i, 3, 3) * s, 1.2, 1.2);
      }
      if (opts.stubble > 0)
        for (let i = 0; i < 460; i++) {
          const v = 128 - texHash(i, 4, 4) * 44;
          x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
          x.fillRect(texHash(i, 5, 5) * s, s * 0.64 + texHash(i, 6, 6) * s * 0.36, 1, 1.6);
        }
    }),
    rough: canvasTex(`faceR${k}`, 64, false, (x, s) => {
      x.fillStyle = opts.undead ? '#c2c2c2' : '#a8a8a8';       // кожа с жирным блеском
      x.fillRect(0, 0, s, s);
      const g = x.createLinearGradient(0, 0, 0, s);            // Т-зона блестит сильнее
      g.addColorStop(0, 'rgba(120,120,120,0.5)');
      g.addColorStop(0.5, 'rgba(160,160,160,0.2)');
      g.addColorStop(1, 'rgba(140,140,140,0.3)');
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
    }),
  };
}

/** ПЕРО: альфа-текстура волокон — стержень + бородки веером */
function featherTex(hex: number): THREE.Texture {
  const col = new THREE.Color(hex);
  const c = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
  const light = `rgb(${Math.min(255, col.r * 255 + 46) | 0},${Math.min(255, col.g * 255 + 44) | 0},${Math.min(255, col.b * 255 + 38) | 0})`;
  return canvasTex(`feather${hex}`, 64, true, (x, s) => {
    x.clearRect(0, 0, s, s);
    x.fillStyle = '#6a5a42';                                   // стержень
    x.fillRect(s / 2 - 1.4, 0, 2.8, s);
    for (let py = 3; py < s - 4; py += 2) {                    // бородки-волокна
      const t0 = py / s;
      const len = s * 0.30 * (0.35 + Math.sin(t0 * Math.PI) * 0.65);
      x.strokeStyle = texHash(py, 1, 1) < 0.5 ? c : light;
      x.lineWidth = 1.1;
      x.beginPath();                                           // левая бородка
      x.moveTo(s / 2 - 1, py);
      x.lineTo(s / 2 - 1 - len * 0.8, py + 4 + t0 * 5);
      x.stroke();
      x.beginPath();                                           // правая бородка
      x.moveTo(s / 2 + 1, py);
      x.lineTo(s / 2 + 1 + len, py + 4 + t0 * 5);
      x.stroke();
    }
  });
}

// ------------------------------------------------------------
// КЭШ МАТЕРИАЛОВ (общие для всех фигур; красятся color'ом)
// ------------------------------------------------------------
const matCache = new Map<string, THREE.Material>();
function getMat(key: string, build: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) { m = build(); matCache.set(key, m); }
  return m;
}
/** СУКНО (шерсть): sheen по ворсу + карты плетения */
export function woolMat(hex: number): THREE.MeshPhysicalMaterial {
  return getMat(`wool:${hex}`, () => {
    const t = woolMaps(hex, '');
    return new THREE.MeshPhysicalMaterial({
      color: hex, map: t.map, bumpMap: t.bump, bumpScale: 0.35,
      roughnessMap: t.rough, roughness: 1,
      sheen: 0.45, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff),
    });
  }) as THREE.MeshPhysicalMaterial;
}
/** КОЖА (пояса/бандольер/сапоги/ножны) */
export function leatherMat(hex: number): THREE.MeshStandardMaterial {
  return getMat(`leather:${hex}`, () => {
    const t = leatherMaps('');
    return new THREE.MeshStandardMaterial({
      color: hex, map: t.map, bumpMap: t.bump, bumpScale: 0.3,
      roughnessMap: t.rough, roughness: 1,
    });
  }) as THREE.MeshStandardMaterial;
}
/** ДЕРЕВО (заряды, рукояти) */
export function woodMat(hex: number): THREE.MeshStandardMaterial {
  return getMat(`wood:${hex}`, () => {
    const t = woodMaps('');
    return new THREE.MeshStandardMaterial({
      color: hex, map: t.map, bumpMap: t.bump, bumpScale: 0.25,
      roughnessMap: t.rough, roughness: 1,
    });
  }) as THREE.MeshStandardMaterial;
}
/** КОВАНАЯ ЛАТУНЬ (пряжки/гарда/пуговицы/оковки) */
export function brassMat(): THREE.MeshStandardMaterial {
  return getMat('brass', () => {
    const t = brassMaps();
    return new THREE.MeshStandardMaterial({
      color: 0xc9a24a, map: t.map, roughnessMap: t.rough,
      roughness: 0.5, metalness: 0.82,
    });
  }) as THREE.MeshStandardMaterial;
}
/** СТАЛЬ (клинок/ствол) */
function steelMat(): THREE.MeshStandardMaterial {
  return getMat('steel', () => new THREE.MeshStandardMaterial({
    color: 0xb9c2c8, metalness: 0.9, roughness: 0.32,
  })) as THREE.MeshStandardMaterial;
}
/** КОЖА (тело/лицо): map + bump пор/щетины + roughness */
function skinMat(skin: number, face: boolean, opts: { stubble: number; scar: boolean; undead: boolean }): THREE.MeshStandardMaterial {
  return getMat(`skin:${skin}:${face ? 'f' : 'b'}:${opts.stubble | 0}:${opts.scar ? 1 : 0}:${opts.undead ? 1 : 0}`, () => {
    const t = faceMaps(skin, opts);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, map: face ? t.map : null,
      bumpMap: face ? t.bump : null, bumpScale: 0.18,
      roughnessMap: face ? t.rough : null,
      roughness: face ? 1 : 0.66,
    });
  }) as THREE.MeshStandardMaterial;
}
/** ПЕРО (альфа-волокна) */
function featherMat(hex: number): THREE.MeshStandardMaterial {
  return getMat(`featherM:${hex}`, () => new THREE.MeshStandardMaterial({
    color: 0xffffff, map: featherTex(hex), alphaTest: 0.3,
    side: THREE.DoubleSide, roughness: 0.85,
  })) as THREE.MeshStandardMaterial;
}

// ------------------------------------------------------------
// ХЕЛПЕРЫ ГЕОМЕТРИИ
// ------------------------------------------------------------
/** Lathe по ГЛАДКОЙ кривой: контрольные [r, y] → CatmullRomCurve3
 *  → сэмплы профиля. Профиль СНИЗУ-ВВЕРХ (нормали наружу — фикс
 *  Task 52 VLM: «сверху-вниз» выворачивал торс наизнанку). */
function latheSmooth(ctrl: [number, number][], seg = 14, radial = 12,
  phiStart?: number, phiLength?: number): THREE.LatheGeometry {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(p => new THREE.Vector3(p[0], p[1], 0)));
  const pts = curve.getPoints(seg).map(p => new THREE.Vector2(Math.max(0.0015, p.x), p.y));
  if (pts.length > 1 && pts[0].y > pts[pts.length - 1].y) pts.reverse();
  return new THREE.LatheGeometry(pts, radial, phiStart ?? 0, phiLength ?? Math.PI * 2);
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D,
  x = 0, y = 0, z = 0): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function sph(r: number, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, w = 10, h = 8): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return mesh(new THREE.SphereGeometry(r, w, h), mat, parent, x, y, z);
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, parent: THREE.Object3D,
  x = 0, y = 0, z = 0, seg = 10): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, parent, x, y, z);
}
function box(w: number, h: number, d: number, mat: THREE.Material, parent: THREE.Object3D,
  x = 0, y = 0, z = 0): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, parent, x, y, z);
}
function joint(parent: THREE.Object3D, x: number, y: number, z = 0, name?: string): THREE.Group {
  const g = new THREE.Group();
  if (name) g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** СЛИЯНИЕ статичных деталей одного материала в ОДИН меш (перф:
 *  детальная фигура = ~85 объектов вместо ~160 — на палубе до 80
 *  фигур). Суставы и анимируемые части ме́рджить нельзя. */
class GeoBatch {
  private geos: THREE.BufferGeometry[] = [];
  constructor(private mat: THREE.Material, private parent: THREE.Object3D) {}
  add(geo: THREE.BufferGeometry, pos?: [number, number, number], rot?: [number, number, number]): this {
    if (rot) {
      if (rot[0]) geo.rotateX(rot[0]);
      if (rot[1]) geo.rotateY(rot[1]);
      if (rot[2]) geo.rotateZ(rot[2]);
    }
    if (pos) geo.translate(pos[0], pos[1], pos[2]);
    this.geos.push(geo);
    return this;
  }
  build(): THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null {
    if (!this.geos.length) return null;
    const merged = this.geos.length === 1
      ? this.geos[0]
      : mergeGeometries(this.geos, false) ?? this.geos[0];
    const m = new THREE.Mesh(merged, this.mat);
    this.parent.add(m);
    return m;
  }
}

/** ПАЛЕЦ (4 пальца кисти) — запечённая цепочка из 3 фаланг со
 *  сгибом curl (суставы не анимируются — слияние безопасно).
 *  Возвращает геометрию относительно СУСТАВА КИСТИ. */
function fingerGeo(fx: number, lens: [number, number, number], curl: [number, number, number]): THREE.BufferGeometry {
  const [l1, l2, l3] = lens;
  const [c1, c2, c3] = curl;
  const seg = (r1: number, r2: number, len: number) => {
    const g = new THREE.CylinderGeometry(r1, r2, len, 7);
    g.translate(0, -len / 2, 0);
    return g;
  };
  const M = new THREE.Matrix4();
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const RX = (a: number) => new THREE.Matrix4().makeRotationX(a);
  const root = T(fx, -0.082, 0.004).multiply(RX(c1));
  const g1 = seg(0.0105, 0.0095, l1);
  g1.applyMatrix4(root);
  const j2 = root.clone().multiply(T(0, -l1, 0)).multiply(RX(c2));
  const g2 = seg(0.0092, 0.0082, l2);
  g2.applyMatrix4(j2);
  const j3 = j2.clone().multiply(T(0, -l2, 0)).multiply(RX(c3));
  const g3 = seg(0.0078, 0.0068, l3);
  g3.applyMatrix4(j3);
  const tip = new THREE.SphereGeometry(0.0072, 6, 5);
  tip.applyMatrix4(j3.clone().multiply(T(0, -l3, 0)));
  return mergeGeometries([g1, g2, g3, tip], false)!;
}

/** БОЛЬШОЙ ПАЛЕЦ — 2 фаланги от нижне-бокового края ладони */
function thumbGeo(side: -1 | 1): THREE.BufferGeometry {
  const seg = (r1: number, r2: number, len: number) => {
    const g = new THREE.CylinderGeometry(r1, r2, len, 7);
    g.translate(0, -len / 2, 0);
    return g;
  };
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const RX = (a: number) => new THREE.Matrix4().makeRotationX(a);
  const RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
  const root = T(side * 0.034, -0.03, 0.012).multiply(RX(0.5)).multiply(RZ(-side * 0.85));
  const g1 = seg(0.012, 0.011, 0.034);
  g1.applyMatrix4(root);
  const j2 = root.clone().multiply(T(0, -0.034, 0)).multiply(RX(0.45));
  const g2 = seg(0.010, 0.009, 0.028);
  g2.applyMatrix4(j2);
  const tip = new THREE.SphereGeometry(0.009, 6, 5);
  tip.applyMatrix4(j2.clone().multiply(T(0, -0.028, 0)));
  return mergeGeometries([g1, g2, tip], false)!;
}

/** Ветровой предмет (вершинная анимация):
 *  kind 'skirt' — вес по расстоянию ниже линии талии;
 *  kind 'hang'  — висящий хвост (вес по длине вниз);
 *  kind 'feather' — вес вдоль длины пера */
interface WindItem {
  mesh: THREE.Mesh;
  base: Float32Array;
  kind: 'skirt' | 'hang' | 'feather';
  amp: number; freq: number; phase: number;
  top: number; len: number; span: number;
}

/** Окружение для animateCrewDetail (качка корабля/ветер) */
export interface DetailEnv {
  /** крен корабля, рад (вращение вокруг продольной оси) */
  roll?: number;
  /** дифферент, рад */
  pitch?: number;
  /** сила ветра 0..~1.5 (SEA.windSpeed/12) */
  wind?: number;
}

/** Состояние «оживления» детальной фигуры (эволюция Task 52;
 *  crew.ts зовёт animateCrewDetail каждую кадр для живых видимых) */
export interface CrewDetailState {
  root: THREE.Group;            // корень фигуры (масштаб гребца и пр.)
  chest: THREE.Object3D;        // грудная клетка — ДЫХАНИЕ scale (e2e v70 D3)
  chestCoat: THREE.Object3D | null; // кафтан на груди — дышит вместе с клеткой
  head: THREE.Object3D;         // повороты/осмотр горизонта
  neck: THREE.Object3D | null;
  spine: THREE.Object3D | null;
  shoulderL: THREE.Object3D | null;  // плечи — подъём на вдохе
  shoulderR: THREE.Object3D | null;
  kneeL: THREE.Object3D | null;      // КОЛЕНИ — компенсация качки
  kneeR: THREE.Object3D | null;
  ankleL: THREE.Object3D | null;     // щиколотки — стойка на наклонной палубе
  ankleR: THREE.Object3D | null;
  hipL: THREE.Object3D | null;
  hipR: THREE.Object3D | null;
  lidL: THREE.Object3D;         // веки: scaleY 0.14 открыто / 1 миг
  lidR: THREE.Object3D;
  breathePh: number;
  nextBlink: number;
  blinkT: number;
  wind: WindItem[];             // полы кафтана / платок / перо
  windT: number;
  /** базовая Y плеч (дыхание поднимает плечи от неё) */
  shoulderBaseY: number;
  /** базовая Y таза (присед боевой стойки — от неё) */
  pelvisBaseY: number;
  /** режим позы: 'deck' — фигурой управляет crew.ts (только
   *  дыхание/баланс/осмотр); иначе — интерактивные позы превью */
  pose: 'deck' | 'idle' | 'combat' | 'pistol' | 'spyglass';
  poseT: number;
  /** выстрел из пистолета: фазы и объекты перекочёвки за пояс↔рука */
  pistol: {
    phase: 'holster' | 'draw' | 'aim' | 'fire' | 'lower';
    t: number;
    obj: THREE.Group;               // сам пистолет
    beltHome: THREE.Object3D;       // гнездо за поясом
    handMount: THREE.Object3D;      // маунт в ЛЕВОЙ кисти
    inHand: boolean;
    recoil: number;
  } | null;
  /** Task 77: ПОДЗОРНАЯ ТРУБА — «как пистолет». Task 79: ЖИВОЙ
   *  капитан держит её В РУКЕ ПОСТОЯННО (home='hand': фаза покоя
   *  'hold' — сложенная в кулаке стволом вперёд-вниз; при T — к
   *  глазу, колена выдвигаются); за поясом (home='belt', фаза
   *  'holster') — только МЕРТВЕЦ-капитан: проклятие «Чёрной
   *  жемчужины» занимает кисть СВЕТЯЩИМСЯ КЛИНКОМ.
   *  ext — выдвижение колен 0..1; arm — кисть с трубой; backTo —
   *  поза после складывания */
  spyglass: {
    phase: 'holster' | 'hold' | 'draw' | 'observe' | 'lower';
    t: number;
    obj: THREE.Group;               // сама труба (ось объектива +Z)
    beltHome: THREE.Object3D;       // гнездо за поясом (бедро руки с трубой)
    handMount: THREE.Object3D;      // маунт в кисти с трубой
    inHand: boolean;
    ext: number;                    // выдвижение колен 0..1
    sections: THREE.Object3D[];     // выдвижные колена (скользят по Z)
    arm: 'R' | 'L';                 // рука с трубой (правая занята крюком → левая)
    home: 'belt' | 'hand';          // где труба в ПОКОЕ (мертвец: пояс)
    restX: number;                  // покой: наклон трубы в кисти (ствол вниз)
    backTo: 'idle' | 'combat' | 'deck' | null;
  } | null;
  undead: boolean;
  profession: DetailProfession;
  /** Task 77: САБЛЯ в кисти — прячется, пока в руке ТРУБА */
  cutlassObj: THREE.Object3D | null;
  /** телеметрия снаряжения (e2e): заряды бандольера («двенадцать
   *  апостолов»), сабля в руке, перо на шляпе */
  charges: number;
  hasCutlass: boolean;
  hasFeather: boolean;
  /** страховка:_joint'ы поз (руки/ноги), чтобы режимы не воевали
   *  с ходьбой — заполняется только для поз != deck */
  poseJoints: null | {
    shL: THREE.Object3D; shR: THREE.Object3D; elL: THREE.Object3D; elR: THREE.Object3D;
    hipL: THREE.Object3D; hipR: THREE.Object3D;
    kneeL: THREE.Object3D; kneeR: THREE.Object3D;
    ankL: THREE.Object3D; ankR: THREE.Object3D;
    pelvis: THREE.Object3D; spine: THREE.Object3D; chest: THREE.Object3D;
  };
}

// ------------------------------------------------------------
// ПАЛИТРЫ ПРОФЕССИЙ (цвет сукна кафтанов; мертвецу — гниль)
// ------------------------------------------------------------
const UNDEAD_SKIN = [0x9fae9a, 0xa8b39b, 0x93a08e, 0xa9b4a4];
const COAT_CAPTAIN = [0x24304a, 0x2c3550, 0x1f2b44];       // синее сукно капитана
const COAT_SOLDIER = [0x8a2222, 0x24365c, 0x2e4432, 0xd8d5cc]; // мундирные цвета полков
const FACING = [0xe8e2d4, 0xb8912f, 0x8a2222, 0x24365c];   // отвороты/ланксуты
const COAT_MERCHANT = [0x4a2530, 0x3a2c1e, 0x453122];      // бордо/коричневое
const COAT_PIRATE = [0x2c2620, 0x33291f, 0x26221c];        // потёртое тёмное
const COAT_UNDEAD = [0x232028, 0x1e2522, 0x28222a];        // гнилой кафтан (Task 57)
const HAIR = [0x2a1c10, 0x382514, 0x452e18, 0x523722];     // тёмная гамма (VLM Task 52)
const FEATHERS = [0xe9e4d4, 0xa33a2a, 0x2e2a26, 0x8a6a3a];

// ------------------------------------------------------------
// СБОРКА ФИГУРЫ
// ------------------------------------------------------------
/** Детальная фигура XVII века — CrewFigure-совместимая: ноги/руки
 *  Object3D с пивотами в суставах (шаги/махи/посты crew.ts).
 *  movable — ноги/руки отдельными группами (ходоки/работяги);
 *  рулевой — руки к штурвалу; гребцы «сидят» (масштаб crew.ts).
 *  profession — гардероб (не задана → по traits.torso/role). */
export function buildDetailedFigure(role: CrewRole, traits: Traits, seed: number,
  movable = role === 'walker', undead = false,
  profession?: DetailProfession): CrewFigure {
  const rnd = mulberry32(seed);
  const h = traits.height;
  // Task 81: ТЕЛОСЛОЖЕНИЕ — торс/таз шире-уже, плечи разведены,
  // конечности толще/тоньше; длина конечностей (вдоль Y) не меняется
  const BK = BUILD_FAC[traits.build ?? 'regular'];
  const group = new THREE.Group();
  if (undead) group.userData.undead = true;

  // профессия по умолчанию — из роли/одежды
  const prof: DetailProfession = profession ?? (
    role === 'captain' ? 'captain'
      : traits.torso === 'soldierCoat' ? 'soldier'
        : traits.torso === 'coat' || traits.torso === 'apron' ? 'merchant'
          : 'sailor');

  // ---- цвета (мертвецу — трупная гамма поверх выбранных цветов) ----
  const skinC = undead
    ? UNDEAD_SKIN[Math.floor(rnd() * UNDEAD_SKIN.length)]
    : traits.skin;
  const shirtC = undead ? 0x2a2d2a : traits.shirt;
  const pantsC = undead ? 0x1e211f : traits.pants;
  const coatC = undead
    ? COAT_UNDEAD[Math.floor(rnd() * COAT_UNDEAD.length)]
    : prof === 'captain' ? COAT_CAPTAIN[Math.floor(rnd() * COAT_CAPTAIN.length)]
      : prof === 'soldier' ? traits.shirt           // мундир = цвет полка
        : prof === 'merchant' ? COAT_MERCHANT[Math.floor(rnd() * COAT_MERCHANT.length)]
          : COAT_PIRATE[Math.floor(rnd() * COAT_PIRATE.length)];

  const stubble = traits.beard === 0 ? 0.55 : 0.2;   // выбритый — с щетиной
  const faceOpts = { stubble, scar: prof === 'pirate' || prof === 'soldier', undead };
  const mFace = skinMat(skinC, true, faceOpts);
  const mSkin = skinMat(skinC, false, faceOpts);
  const mShirt = woolMat(shirtC);
  const mPants = woolMat(pantsC);
  const mCoat = woolMat(coatC);
  const mHair = new THREE.MeshStandardMaterial({
    color: undead ? 0x2f3a30 : HAIR[Math.floor(rnd() * HAIR.length)], roughness: 0.85,
  });

  // ===== КИНЕМАТИКА (м): бедро+голень+стопа ≈ 0.51, торс 0.53 =====
  const hipY = 0.60 * h;
  const thighL = 0.285 * h, shinL = 0.225 * h;
  const headR = 0.128 * h;

  // ================== СКЕЛЕТ (THREE.Group-суставы) ==================
  const pelvis = joint(group, 0, hipY, 0, 'pelvis');
  const spine = joint(pelvis, 0, 0.09 * h, 0, 'spine');
  const chest = joint(spine, 0, 0.13 * h, 0, 'chest');
  const neck = joint(chest, 0, 0.335 * h, 0, 'neck');
  const head = joint(neck, 0, 0.065 * h, 0, 'head');
  const shL = joint(chest, 0.163 * h * BK.shoulder, 0.29 * h, 0.008, 'shL');
  const shR = joint(chest, -0.163 * h * BK.shoulder, 0.29 * h, 0.008, 'shR');
  const elL = joint(shL, 0, -0.185 * h, 0, 'elL');     // ЛОКОТЬ (предплечье)
  const elR = joint(shR, 0, -0.185 * h, 0, 'elR');
  const handL = joint(elL, 0, -0.155 * h, 0, 'handL'); // КИСТЬ (запястье)
  const handR = joint(elR, 0, -0.155 * h, 0, 'handR');
  const hipL = joint(pelvis, 0.088 * h, -0.015 * h, 0, 'hipL');   // БЕДРО
  const hipR = joint(pelvis, -0.088 * h, -0.015 * h, 0, 'hipR');
  const kneeL = joint(hipL, 0, -thighL, 0.012, 'kneeL');          // КОЛЕНО
  const kneeR = joint(hipR, 0, -thighL, 0.012, 'kneeR');
  const ankL = joint(kneeL, 0, -shinL, 0, 'ankL');                // СТУПНЯ (щиколотка)
  const ankR = joint(kneeR, 0, -shinL, 0, 'ankR');
  // Task 81: конечности по телосложению — толще/тоньше в сечении,
  // длина (вдоль Y) не меняется: масштаб на КОРНЕВОМ суставе руки/ноги
  hipL.scale.set(BK.limb, 1, BK.limb);
  hipR.scale.set(BK.limb, 1, BK.limb);
  shL.scale.set(BK.limb, 1, BK.limb);
  shR.scale.set(BK.limb, 1, BK.limb);

  // ================== ТАЗ И ПОЯС ==================
  mesh(latheSmooth([
    [0.001, -0.115], [0.108, -0.095], [0.145, -0.012], [0.138, 0.075], [0.001, 0.098],
  ], 12, 12), mPants, pelvis).scale.set(BK.w * 0.95, 1, BK.d * 0.95);
  const mBelt = leatherMat(undead ? 0x1e1a14 : 0x3a2a1c);
  const belt = mesh(new THREE.TorusGeometry(0.143, 0.016, 7, 18), mBelt, pelvis, 0, 0.055 * h, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(BK.w, 1, 0.84);
  // МЕДНАЯ ПРЯЖКА пояса
  box(0.052, 0.036, 0.014, brassMat(), pelvis, 0, 0.055 * h, 0.132 * BK.d);
  box(0.008, 0.030, 0.008, brassMat(), pelvis, 0, 0.055 * h, 0.138 * BK.d);

  // ================== ТОРС — анатомический Lathe-профиль ==================
  // (талия → рёбра → грудная клетка → плечевой свод; на chest-суставе,
  //  scale грудной клетки = ДЫХАНИЕ)
  mesh(latheSmooth([
    [0.001, -0.315], [0.115, -0.29], [0.142, -0.185], [0.132, -0.06],
    [0.148, 0.045], [0.149, 0.15], [0.126, 0.25], [0.072, 0.31], [0.001, 0.325],
  ], 18, 14), mShirt, chest).scale.set(BK.w, 1, BK.d);
  sph(0.132 * h, mShirt, chest, 0, 0.30 * h, 0, 12, 8).scale.set(1.14 * BK.shoulder, 0.5, 0.86); // плечевой свод
  sph(0.112 * h, mPants, chest, 0, -0.29, 0, 10, 8).scale.set(1.02 * BK.w, 0.62, 0.92);   // стык с тазом
  // Task 81: ЖИВОТ полного телосложения — выпирает вперёд поверх
  // лат-профиля (цвет одежды; чуть ниже поясного уровня)
  if (BK.belly > 0) {
    sph(0.1 * h, mShirt, chest, 0, -0.12, 0.03, 10, 8).scale.set(1.3, 0.78, 1.45);
  }

  // шея
  cyl(0.046 * h, 0.055 * h, 0.09 * h, mSkin, neck, 0, 0.02 * h, 0, 8);

  // ================== НОГИ: бедро → колено → голень → БОТФОРТЫ ==================
  const boots = prof !== 'sailor';                       // матрос — чулки/ботинки короткие
  const mBoot = leatherMat(undead ? 0x1e1a16 : (prof === 'captain' ? 0x241d16 : 0x3d2c1c));
  const mkLeg = (side: -1 | 1, hip: THREE.Group, knee: THREE.Group, ank: THREE.Group) => {
    if (traits.pegLeg === side) {
      // ДЕРЕВЯННАЯ НОГА (протез пирата)
      sph(0.058 * h, mPants, hip);
      const peg = cyl(0.038 * h, 0.05 * h, hipY - 0.03, woodMat(0x7a5a34), hip, 0, -(hipY - 0.03) / 2, 0, 8);
      peg.receiveShadow = false;
      cyl(0.052 * h, 0.056 * h, 0.028, woodMat(0x6a4a28), hip, 0, -(hipY - 0.05), 0, 8);
      return;
    }
    const shorts = traits.pantsKind !== 'long';
    // бедро (брюки) — лат по кривой: шире у бедра, колено округлое
    mesh(latheSmooth([
      [0.001, -thighL - 0.012], [0.055, -thighL - 0.004], [0.072, -thighL * 0.55],
      [0.066, -thighL * 0.16], [0.052, -0.012], [0.001, -0.006],
    ], 10, 10), mPants, hip);
    sph(0.052 * h, shorts ? mSkin : mPants, knee);                    // колено
    // голень: чулок (матрос) или ГОЛЕНИЩЕ БОТФОРТА
    mesh(latheSmooth([
      [0.001, -shinL - 0.01], [0.043, -shinL - 0.002], [0.05, -shinL * 0.45],
      [0.047, -shinL * 0.12], [0.04, -0.01], [0.001, -0.006],
    ], 10, 10), boots ? mBoot : (shorts ? mSkin : mPants), knee);
    if (boots) {
      // ОТВОРОТ БОТФОРТА — раструб-стакан над коленом (по ТЗ)
      mesh(latheSmooth([
        [0.048, 0.0], [0.056, 0.03], [0.068, 0.062], [0.07, 0.075], [0.06, 0.078], [0.05, 0.055],
      ], 10, 12), mBoot, knee, 0, -shinL + 0.062, 0);
      sph(0.045 * h, mBoot, knee, 0, -shinL * 0.3, -0.012 * h, 8, 6).scale.set(0.9, 1.6, 1.05); // икра
    } else {
      sph(0.042 * h, shorts ? mSkin : mPants, knee, 0, -shinL * 0.3, -0.01 * h, 8, 6).scale.set(0.9, 1.55, 1.0);
      if (shorts) {
        // подвязка под коленом (матросские чулки)
        const g = mesh(new THREE.TorusGeometry(0.048, 0.007, 5, 12), mBelt, knee, 0, -shinL + 0.028, 0);
        g.rotation.x = Math.PI / 2;
      }
    }
    // СТУПНЯ: подошва + каблук + носок + голенище короткого ботинка
    const mF = boots ? mBoot : leatherMat(0x2e241a);
    box(0.086 * h, 0.02, 0.225, mF, ank, 0, -0.068 * h, 0.045);      // подошва
    box(0.082 * h, 0.032, 0.05, mF, ank, 0, -0.052 * h, -0.062);     // каблук
    const toe = sph(0.042 * h, mF, ank, 0, -0.04 * h, 0.115 * h, 8, 6);
    toe.scale.set(0.95, 0.62, 1.25);
    const up = sph(0.05 * h, mF, ank, 0, -0.012 * h, 0.01, 8, 6);
    up.scale.set(0.86, 0.55, 1.5);
    if (!boots) {
      cyl(0.048 * h, 0.054 * h, 0.075, mF, ank, 0, 0.028 * h, 0, 9); // голенище ботинка
      for (let li = 0; li < 2; li++) {                               // шнурки
        const lace = box(0.062 * h, 0.005, 0.008, woolMat(0xcabfa8), ank,
          0, (0.005 + li * 0.02) * h, 0.05 - li * 0.02);
        lace.rotation.y = li % 2 ? 0.3 : -0.3;
      }
    }
  };
  mkLeg(-1, hipL, kneeL, ankL);
  mkLeg(1, hipR, kneeR, ankR);

  // ================== РУКИ: плечо → локоть → КИСТЬ С ПАЛЬЦАМИ ==================
  // меч в руке БЕЗ крюка (по умолчанию правая), крюк — на свою сторону
  const swordSide: -1 | 1 = traits.hook === 1 ? -1 : 1;
  let wristMount: THREE.Object3D | null = null;

  const sleeveUp = (side: -1 | 1) => {
    if (traits.torso === 'bare') return mSkin;
    if (prof === 'captain' || prof === 'soldier' || prof === 'merchant' || prof === 'pirate')
      return side === swordSide ? mCoat : mCoat;      // кафтан — оба рукава
    return traits.torso === 'tshirt' ? mSkin : mShirt;
  };
  const mkArm = (side: -1 | 1, sh: THREE.Group, el: THREE.Group, hand: THREE.Group) => {
    sph(0.056 * h, sleeveUp(side), sh, 0, 0.012 * h, 0);              // дельта
    // плечо-бицепс — лат с утолщением к бицепсу
    mesh(latheSmooth([
      [0.001, -0.20 * h], [0.044, -0.185 * h], [0.05, -0.11 * h],
      [0.046, -0.05 * h], [0.038, -0.008], [0.001, -0.006],
    ], 10, 10), sleeveUp(side), sh);
    sph(0.046 * h, sleeveUp(side), sh, 0, -0.10 * h, 0.008 * h, 8, 6).scale.set(0.95, 1.3, 1);
    sph(0.04 * h, sleeveUp(side), el);                                // локоть
    // предплечье — сужается к запястью
    mesh(latheSmooth([
      [0.001, -0.163 * h], [0.032, -0.158 * h], [0.04, -0.09 * h],
      [0.032, -0.03 * h], [0.026, -0.008], [0.001, -0.006],
    ], 10, 10), sleeveUp(side), el);
    sph(0.036 * h, sleeveUp(side), el, 0, -0.05 * h, -0.006 * h, 8, 6).scale.set(0.92, 1.4, 1);
    if (traits.hook === side) {
      // ДЕРЕВЯННАЯ КУЛЬТА + КРЮК (протез пирата)
      cyl(0.028 * h, 0.032 * h, 0.07, woodMat(0x7a5a34), hand, 0, -0.03, 0, 8);
      const hook = mesh(new THREE.TorusGeometry(0.042, 0.012, 5, 10, Math.PI * 1.25),
        new THREE.MeshStandardMaterial({ color: 0x8f8f96, metalness: 0.8, roughness: 0.3 }),
        hand, 0, -0.095, 0);
      hook.rotation.z = side * 1.57;
      return;
    }
    // ---- КИСТЬ: ЛАДОНЬ + БОЛЬШОЙ ПАЛЕЦ + 4 ПАЛЬЦА ПО 3 ФАЛАНГИ ----
    // (пальцы — ЗАПЕЧЁННЫЕ цепочки со СГИБОМ: кисть с саблей
    //  ОБХВАТЫВАЕТ эфес (curl 0.85/0.95/0.7), свободная — слегка
    //  согнута; все 4 пальца + большой слиты в ОДИН меш — перф)
    box(0.072, 0.088, 0.032, mSkin, hand, 0, -0.042, 0);
    sph(0.036, mSkin, hand, 0, -0.084, 0, 8, 6).scale.set(1, 0.55, 0.85); // костяшки
    sph(0.033, mSkin, hand, 0, -0.004, 0, 8, 6).scale.set(0.95, 0.6, 0.8); // запястье
    const curl: [number, number, number] = side === swordSide
      ? [0.85, 0.95, 0.7] : [0.32, 0.38, 0.3];
    const fb = new GeoBatch(mSkin, hand);
    for (let fi = 0; fi < 4; fi++) {
      const fx = (fi - 1.5) * 0.019 * (side === 1 ? -1 : 1);
      const short = [0, -0.004, -0.008, -0.015][fi];
      fb.add(fingerGeo(fx, [0.032 + short, 0.026 + short, 0.02 + short], curl));
    }
    fb.add(thumbGeo(side));
    fb.build();
    // маунт у кисти для оружия crew.ts (Task 43) — на ПРЕДПЛЕЧЬЕ,
    // чтобы подъём руки поднимал и оружие (ружьё вдоль руки)
    if (side !== swordSide) {
      const mount = new THREE.Object3D();
      mount.position.set(0, -0.135 * h, 0.02);
      mount.userData.wristMount = true;
      el.add(mount);
      wristMount = mount;
    }
  };
  mkArm(-1, shL, elL, handL);
  mkArm(1, shR, elR, handR);

  // ================== ГОЛОВА: ЧЕРЕП, ЛИЦО, ВОЛОСЫ ==================
  // череп — анатомический лат-профиль (затылок → темя → лоб → лицо)
  mesh(latheSmooth([
    [0.001, -0.112], [0.05, -0.104], [0.088, -0.072], [0.107, -0.014],
    [0.112, 0.044], [0.096, 0.092], [0.058, 0.124], [0.001, 0.134],
  ], 16, 12), mFace, head);
  // челюсть + подбородок
  const jaw = sph(headR * 0.72, mFace, head, 0, -headR * 0.42, headR * 0.2, 10, 8);
  jaw.scale.set(0.82, 0.68, 0.9);
  sph(headR * 0.3, mFace, head, 0, -headR * 0.62, headR * 0.52).scale.set(1.05, 0.85, 0.95);
  // надбровные дуги-валики
  for (const bx of [-1, 1]) {
    const arc = mesh(new THREE.TorusGeometry(headR * 0.34, headR * 0.075, 4, 8, Math.PI * 0.62), mFace,
      head, bx * headR * 0.35, headR * 0.16, headR * 0.58);
    arc.rotation.set(Math.PI / 2 + 0.28, 0, bx > 0 ? -1.22 : 1.22);
  }
  // ГЛАЗА (яблоко + радужка + зрачок + блик) + ВЕКИ (моргание)
  const eyeMatSclera = undead
    ? new THREE.MeshStandardMaterial({ color: 0x0c120c, emissive: 0x39d65a, emissiveIntensity: 1.6, roughness: 0.4 })
    : new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
  const irisMat = undead
    ? new THREE.MeshStandardMaterial({ color: 0x123320, emissive: 0x52e07a, emissiveIntensity: 2.2, roughness: 0.3 })
    : new THREE.MeshStandardMaterial({ color: [0x4a6a3a, 0x3a4a6a, 0x5a3a2a, 0x2a2a2a][Math.floor(rnd() * 4)], roughness: 0.25 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.2 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  let lidL: THREE.Object3D;                       // веки: ОДИН слитый меш
  let lidR: THREE.Object3D;                       // (ссылки совпадают)
  // маркеры ориентации лица — глазные группы (e2e v70 D2)
  for (const ex of [-1, 1]) {
    joint(head, ex * headR * 0.4, headR * 0.05, headR * 0.68, 'eye')
      .userData.faceMark = true;
  }
  {
    // парные части глаз слиты в 5 мешей (перф); веки — ОДИН меш:
    // моргание анимирует его scale.y (обе веки синхронны)
    irisMat.side = THREE.DoubleSide;
    const eyeAt = (ex: number) => [ex * headR * 0.4, headR * 0.05, headR * 0.68] as [number, number, number];
    const bSclera = new GeoBatch(eyeMatSclera, head);
    const bIris = new GeoBatch(irisMat, head);
    const bPupil = new GeoBatch(pupilMat, head);
    const bGlint = new GeoBatch(glintMat, head);
    const bLid = new GeoBatch(mSkin, head);
    for (const ex of [-1, 1]) {
      const c = eyeAt(ex);
      bSclera.add(new THREE.SphereGeometry(headR * 0.185, 10, 8), c);
      bIris.add(new THREE.CircleGeometry(headR * 0.095, 10), [c[0], c[1], c[2] + headR * 0.172]);
      bPupil.add(new THREE.CircleGeometry(headR * 0.045, 8), [c[0], c[1], c[2] + headR * 0.176]);
      bGlint.add(new THREE.SphereGeometry(headR * 0.022, 6, 4),
        [c[0] + headR * 0.04, c[1] + headR * 0.045, c[2] + headR * 0.18]);
      bLid.add(new THREE.SphereGeometry(headR * 0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
        [c[0], c[1] + headR * 0.015, c[2]]);
    }
    bSclera.build(); bIris.build(); bPupil.build(); bGlint.build();
    const lidMerged = bLid.build();
    if (lidMerged) lidMerged.scale.y = 0.14;          // открыто (0.14) / миг (1)
    lidL = lidMerged ?? new THREE.Object3D();
    lidR = lidL;
  }
  // ВОЛОСЫ/БРОВИ/УСЫ/БОРОДА — всё одного материала (mHair):
  // накапливаем в GeoBatch и сливаем в ОДИН меш (перф)
  const hairB = new GeoBatch(mHair, head);
  // брови с наклоном (характер: суровый/спокойный)
  const browTilt = (rnd() < 0.5 ? 1 : -1) * (0.1 + rnd() * 0.16);
  for (const bx of [-1, 1]) {
    hairB.add(new THREE.BoxGeometry(headR * 0.42, headR * 0.07, headR * 0.09),
      [bx * headR * 0.4, headR * 0.3, headR * 0.82], [0, 0, -browTilt * bx]);
  }
  // нос
  const nose = mesh(latheSmooth([
    [0.001, 0.032], [0.013, 0.02], [0.015, 0.004], [0.009, -0.012], [0.001, -0.017],
  ], 8, 8), mFace, head, 0, headR * 0.02, headR * 0.86);
  nose.rotation.x = Math.PI / 2 - 0.22;
  // уши (прижаты к бокам)
  for (const ex of [-1, 1]) {
    const ear = sph(headR * 0.16, mFace, head, ex * headR * 0.78, -headR * 0.02, -headR * 0.08, 8, 6);
    ear.scale.set(0.42, 1, 0.72);
  }
  // рот + УСЫ (по ТЗ — почти у всех профессий, кроме матросов)
  box(headR * 0.34, headR * 0.03, headR * 0.06,
    new THREE.MeshStandardMaterial({ color: undead ? 0x1c2a1c : 0x7a4a3a, roughness: 0.8 }),
    head, 0, -headR * 0.42, headR * 0.8);
  const hasMustache = prof !== 'sailor' ? true : rnd() < 0.35;
  if (hasMustache) {
    for (const mx of [-1, 1]) {
      const mo = new THREE.BoxGeometry(headR * 0.36, headR * 0.09 * 1.4, headR * 0.07);
      hairB.add(mo, [mx * headR * 0.19, -headR * 0.3, headR * 0.8], [0, -mx * 0.25, mx * 0.4]);
    }
  }
  // БОРОДА (traits.beard: 0/1/2) — нижняя полусфера + пряди
  if (traits.beard > 0 || (undead && rnd() < 0.6)) {
    const bl = traits.beard === 2 ? 0.5 : 0.3;
    const bd = new THREE.SphereGeometry(headR * (traits.beard === 2 ? 0.86 : 0.8), 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
    bd.scale(0.92, 0.72 + bl * 0.4, 0.88);
    hairB.add(bd, [0, -headR * 0.3, headR * 0.08]);
    if (traits.beard === 2) {                            // длинная — свисает
      hairB.add(new THREE.BoxGeometry(headR * 0.5, headR * 0.55, headR * 0.3),
        [0, -headR * 0.85, headR * 0.32], [0.2, 0, 0]);
    }
  }
  // ПРИЧЁСКА из прядей (traits.hair: short/long/ponytail/wild; лысина)
  if (!traits.bald) {
    hairB.add(new THREE.SphereGeometry(headR * 1.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
      [0, headR * 0.08, -headR * 0.02]);
    const fr = new THREE.SphereGeometry(headR * 0.42, 8, 6);
    fr.scale(1.5, 0.5, 0.55);
    hairB.add(fr, [0, headR * 0.4, headR * 0.68]);
    const nStr = traits.hair === 'wild' ? 9 : 7;
    for (let i = 0; i < nStr; i++) {
      const a = (i / nStr) * Math.PI * 2 + rnd() * 0.4;
      const st = new THREE.SphereGeometry(headR * 0.2, 7, 6);
      st.scale(0.62, traits.hair === 'short' ? 1.15 : 1.45, 0.58);
      hairB.add(st,
        [Math.cos(a) * headR * 0.72, headR * (traits.hair === 'short' ? 0.55 : 0.62), Math.sin(a) * headR * 0.72],
        [Math.sin(a) * (traits.hair === 'wild' ? 0.8 : 0.25), 0, -Math.cos(a) * (traits.hair === 'wild' ? 0.8 : 0.25)]);
    }
    if (traits.hair === 'long') {
      hairB.add(new THREE.BoxGeometry(headR * 1.4, headR * 1.1, headR * 0.36),
        [0, -headR * 0.35, -headR * 0.78], [-0.12, 0, 0]);
    } else if (traits.hair === 'ponytail') {
      hairB.add(new THREE.SphereGeometry(headR * 0.3, 8, 6), [0, headR * 0.28, -headR * 0.95]);
      hairB.add(new THREE.CylinderGeometry(headR * 0.13, headR * 0.2, headR * 0.7, 6),
        [0, -headR * 0.15, -headR * 1.1], [0.3, 0, 0]);
    }
  }
  hairB.build();                                          // один меш волос/бороды
  // очки (мастовые с Traits.glasses)
  if (traits.glasses) {
    const gm = new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.35, metalness: 0.6 });
    for (const gx of [-1, 1]) {
      mesh(new THREE.TorusGeometry(headR * 0.17, headR * 0.018, 5, 12), gm, head, gx * headR * 0.4, headR * 0.05, headR * 0.72);
      mesh(new THREE.CircleGeometry(headR * 0.15, 10),
        new THREE.MeshPhysicalMaterial({ color: 0xbcd4de, roughness: 0.05, transparent: true, opacity: 0.35 }),
        head, gx * headR * 0.4, headR * 0.05, headR * 0.71);
    }
    box(headR * 0.9, headR * 0.04, headR * 0.03, gm, head, 0, headR * 0.1, headR * 0.8);
  }
  // наглазник (пират/игрок)
  if (traits.eyePatch) {
    const strapM = leatherMat(0x14100c);
    const patchEye = rnd() < 0.5 ? -1 : 1;
    box(headR * 0.42, headR * 0.36, headR * 0.07, strapM, head, patchEye * headR * 0.4, headR * 0.05, headR * 0.78);
    const strap = mesh(new THREE.TorusGeometry(headR * 1.02, headR * 0.045, 5, 18, Math.PI * 1.15), strapM,
      head, 0, headR * 0.02, 0);
    strap.rotation.set(Math.PI / 2 - 0.3, -Math.PI / 2, 0);
  }

  // ---- предметы для ветра (полы/платок/перо) собираются по ходу ----
  const wind: WindItem[] = [];
  const addWind = (m: THREE.Mesh, kind: WindItem['kind'], amp: number, freq: number,
    top: number, len: number, span = 0) => {
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    wind.push({ mesh: m, base: pos.array.slice() as Float32Array, kind, amp, freq,
      phase: rnd() * 7, top, len, span });
  };

  // ================== ГОЛОВНОЙ УБОР ПО ПРОФЕССИИ ==================
  let featherMesh: THREE.Mesh | null = null;
  const mFelt = woolMat(undead ? 0x17181a : (prof === 'captain' ? 0x1d2126 : prof === 'soldier' ? 0x2a2a2e : 0x3a3028));
  const addFeather = (pos: [number, number, number], rot: [number, number, number], scale = 1, hex?: number) => {
    // ПЕРО: изогнутая плоскость с альфа-текстурой волокон (по ТЗ)
    const len = (prof === 'captain' ? 0.3 : 0.24) * scale;
    const geo = new THREE.PlaneGeometry(0.05 * scale, len, 3, 10);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t0 = (p.getY(i) / len) + 0.5;
      p.setX(i, p.getX(i) * (1 - t0 * 0.55));                    // сузить к кончику
      p.setZ(i, Math.sin(t0 * Math.PI) * 0.024 - t0 * t0 * 0.05); // изгиб пера
      p.setY(i, p.getY(i) + t0 * t0 * 0.06);                      // дугообразный наклон
    }
    geo.computeVertexNormals();
    const col = hex ?? FEATHERS[Math.floor(rnd() * FEATHERS.length)];
    const f = mesh(geo, featherMat(undead ? 0x5a544a : col), head, pos[0], pos[1], pos[2]);
    f.rotation.set(rot[0], rot[1], rot[2]);
    f.material.side = THREE.DoubleSide;
    featherMesh = f;
    addWind(f, 'feather', 0.05, 3.1, 0, len, len);
    return f;
  };
  const headwear = prof === 'sailor' && traits.headwear !== 'bandana' && traits.headwear !== 'straw'
    ? (rnd() < 0.55 ? 'bandana' : 'straw')
    : traits.headwear;
  switch (prof === 'sailor' ? headwear : (prof === 'soldier' ? 'hat' : 'cavalier')) {
    case 'cavalier': {
      // CAVALIER-ШЛЯПА (XVII век): тулья + ШИРОКОЕ ПОЛЕ С ЗАГНУТЫМ
      // КРАЕМ — весь убор из LatheGeometry по CatmullRom-профилю
      const hatY = headR * 0.62;
      // поле: от тульи — лёгкий прогиб — к приподнятому краю-загибу
      const brim = mesh(latheSmooth([
        [0.098, 0.0], [0.155, -0.018], [0.205, -0.014], [0.243, 0.004], [0.262, 0.03], [0.265, 0.048],
      ], 16, 18), mFelt, head, 0, hatY, 0);
      brim.material.side = THREE.DoubleSide;
      // тулья
      mesh(latheSmooth([
        [0.095, 0.0], [0.104, 0.05], [0.098, 0.088], [0.066, 0.116], [0.012, 0.128],
      ], 12, 12), mFelt, head, 0, hatY + 0.002, 0);
      // лента + МЕДНАЯ ПРЯЖКА (капитану — золотая)
      const bandM = prof === 'captain' ? woolMat(0xc9a24a) : woolMat(undead ? 0x1e2020 : 0x5a1e1e);
      const band = mesh(new THREE.CylinderGeometry(0.104, 0.104, 0.032, 14, 1, true), bandM, head, 0, hatY + 0.026, 0);
      band.material.side = THREE.DoubleSide;
      box(0.026, 0.022, 0.01, brassMat(), head, 0, hatY + 0.026, 0.103);
      // ПЕРО за лентой (капитану — большое, торговцу/пирату — среднее)
      addFeather([0.082, hatY + 0.075, -0.035], [-0.55, 0.5, 0.45], prof === 'captain' ? 1.15 : 0.95);
      // лёгкий лихой наклон шляпы
      head.children.slice(-1)[0].rotation.z = 0.05;
      break;
    }
    case 'hat': {
      // ТРЕУГОЛКА солдата: тулья-лат + три ПОДНЯТЫХ КРАЯ поля
      const hatY = headR * 0.58;
      mesh(latheSmooth([
        [0.001, 0.0], [0.088, 0.008], [0.098, 0.052], [0.078, 0.096], [0.02, 0.118],
      ], 12, 12), mFelt, head, 0, hatY, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const loop = mesh(new THREE.TorusGeometry(headR * 0.98, headR * 0.06, 5, 10, Math.PI * 0.72), mFelt,
          head, Math.cos(a) * headR * 0.42, hatY + 0.012, Math.sin(a) * headR * 0.42);
        loop.rotation.set(0.5, -a + Math.PI / 2, 0);
        loop.scale.set(1, 0.55, 1);
        loop.material.side = THREE.DoubleSide;
      }
      // кокарда полка
      cyl(0.026, 0.026, 0.008, woolMat(FACING[Math.floor(rnd() * FACING.length)]), head, 0, hatY + 0.052, 0.09, 10).rotation.x = Math.PI / 2 - 0.25;
      break;
    }
    case 'straw': {
      // СОЛОМЕННАЯ (матрос): плоское поле-кольцо + конус-тулья
      const hatY = headR * 0.6;
      const mStraw = woolMat(undead ? 0x6a5c40 : 0xc9a860);
      const brimS = mesh(latheSmooth([
        [0.1, 0.008], [0.17, 0.002], [0.235, 0.008], [0.24, 0.022],
      ], 10, 16), mStraw, head, 0, hatY, 0);
      brimS.material.side = THREE.DoubleSide;
      mesh(new THREE.ConeGeometry(0.105, 0.12, 12), mStraw, head, 0, hatY + 0.07, 0);
      cyl(0.108, 0.108, 0.03, leatherMat(0x6a4e2e), head, 0, hatY + 0.016, 0, 12);
      break;
    }
    case 'bandana':
    default: {
      // БАНДАНА с ХВОСТОМ на ветру (матрос/пират)
      const bc = undead ? 0x2a2226 : (prof === 'pirate'
        ? [0x7a2323, 0x2e2a26, 0x243038][Math.floor(rnd() * 3)]
        : [0xc04030, 0x3a6a9a, 0x4a7a44][Math.floor(rnd() * 3)]);
      const mBand = woolMat(bc);
      mesh(new THREE.SphereGeometry(headR * 1.06, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), mBand, head, 0, headR * 0.06, 0);
      const knot = sph(headR * 0.16, mBand, head, headR * 0.5, headR * 0.32, -headR * 0.72);
      knot.scale.set(0.8, 0.8, 1.2);
      // хвост — изогнутая плоскость, колышется ветром
      const tail = mesh(new THREE.PlaneGeometry(0.05, 0.2, 3, 8), mBand, head, headR * 0.55, headR * 0.12, -headR * 0.86);
      tail.rotation.set(0.35, -0.2, 0.15);
      tail.material.side = THREE.DoubleSide;
      addWind(tail, 'hang', 0.06, 3.0, 0.1, 0.2);
      if (prof === 'pirate' && rnd() < 0.3) addFeather([headR * 0.4, headR * 0.5, -headR * 0.4], [-0.7, 0.4, 0.5], 0.8, 0x2e2a26);
      break;
    }
  }

  // ================== ШЕЙНЫЙ ПЛАТОК / КРАВАТ ==================
  if (prof === 'captain' || prof === 'merchant') {
    // кружевной КРАВАТ: стойка + свисающие концы (ветер)
    const mCravat = woolMat(undead ? 0x4a4438 : 0xe8e2d4);
    mesh(latheSmooth([
      [0.052, 0.0], [0.068, 0.028], [0.075, 0.06], [0.066, 0.08],
    ], 8, 10), mCravat, chest, 0, 0.30 * h, 0.004);
    const tailC = mesh(new THREE.PlaneGeometry(0.075, 0.17, 3, 8), mCravat, chest, 0.018, 0.26 * h, 0.078);
    tailC.rotation.x = 0.35;
    tailC.material.side = THREE.DoubleSide;
    addWind(tailC, 'hang', 0.07, 2.8, 0.09, 0.17);
  } else if (prof === 'sailor' || prof === 'pirate') {
    // морской ПЛАТОК-косынка
    const mc = woolMat(undead ? 0x3a3a30 : (prof === 'pirate' ? 0x7a2323 : 0xc04030));
    const tri = mesh(new THREE.ConeGeometry(0.07, 0.1, 3), mc, chest, 0, 0.29 * h, 0.06);
    tri.rotation.set(1.9, Math.PI / 6, 0);
    tri.scale.set(1, 1, 0.4);
  } else {
    // солдатский СТОК (белая полоса под мундиром)
    mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.05, 10, 1, true), woolMat(undead ? 0x4a4438 : 0xe8e2d4),
      chest, 0, 0.305 * h, 0).material.side = THREE.DoubleSide;
  }

  // ================== ВЕРХНЯЯ ОДЕЖДА ПО ПРОФЕССИИ ==================
  /** радиус профиля на высоте y (для пуговиц/лацканов) */
  const profRadius = (y: number) => {
    if (y >= -0.02) return 0.15 + Math.max(0, 0.149 - Math.max(0, y - 0.05)) * 0.9;
    return 0.148 - Math.min(0.03, -y * 0.08);
  };
  let chestCoat: THREE.Object3D | null = null;
  const addButtons = (rows: number, mBtn: THREE.Material, y0: number, y1: number, coatR: number) => {
    const bb = new GeoBatch(mBtn, chest);            // все пуговицы — один меш
    for (let r = 0; r < rows; r++) {
      const y = y0 - (r / Math.max(1, rows - 1)) * (y0 - y1);
      for (const s of [-1, 1]) {
        const phi = s * 0.36;
        const g = new THREE.CylinderGeometry(0.0085, 0.0085, 0.007, 8);
        g.rotateX(Math.PI / 2);
        g.rotateZ(phi);
        bb.add(g, [Math.sin(phi) * (coatR + 0.004), y, Math.cos(phi) * (coatR + 0.004)]);
      }
    }
    bb.build();
  };
  if (prof !== 'sailor') {
    // ---- КАФТАН/МУНДИР: грудь на chest-суставе (дышит) + РАСКЛЕШЁННЫЕ
    // ПОЛЫ (coatSkirt) на pelvis — до середины бедра, с РАЗРЁЗОМ спереди
    const skirtLen = prof === 'captain' ? 0.40 : prof === 'merchant' ? 0.34 : 0.30;
    // грудь кафтана — лат по кривой, чуть шире рубахи
    chestCoat = mesh(latheSmooth([
      [0.001, -0.26], [0.118, -0.24], [0.15, -0.1], [0.162, 0.06],
      [0.155, 0.18], [0.12, 0.28], [0.06, 0.315], [0.001, 0.32],
    ], 16, 14), mCoat, chest);
    // воротник-стойка
    const collar = mesh(new THREE.CylinderGeometry(0.062, 0.078, 0.055, 10, 1, true), mCoat, chest, 0, 0.315 * h, 0.004);
    collar.material.side = THREE.DoubleSide;
    // ПОЛЫ: расклешённый лат от пояса ВНИЗ, разрез спереди (щель φ±0.2)
    const skirt = mesh(latheSmooth([
      [0.15, 0.075], [0.152, -0.02], [0.175, -skirtLen * 0.45], [0.205, -skirtLen * 0.8], [0.218, -skirtLen],
    ], 16, 20, 0.21, Math.PI * 2 - 0.42), mCoat, pelvis, 0, 0.03 * h, 0.004);
    skirt.material.side = THREE.DoubleSide;
    addWind(skirt, 'skirt', 0.05, 2.3, 0.075, skirtLen);
    if (undead) {
      // РВАНЫЕ ПОЛЫ мертвеца: зубчатая кромка — шум по нижнему ряду
      const p = skirt.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < -skirtLen * 0.75) {
          const k = 0.82 + texHash(i, 3, 3) * 0.3;
          p.setX(i, p.getX(i) * k);
          p.setZ(i, p.getZ(i) * k);
          p.setY(i, p.getY(i) + texHash(i, 7, 7) * 0.05 - 0.02);
        }
      }
      p.needsUpdate = true;
      skirt.geometry.computeVertexNormals();
      // свисающие лохмотья
      for (let i = 0; i < 3; i++) {
        const ragM = new THREE.MeshStandardMaterial({ color: coatC, roughness: 1, side: THREE.DoubleSide });
        const rag = mesh(new THREE.PlaneGeometry(0.05, 0.16 + rnd() * 0.1, 2, 6), ragM, pelvis,
          Math.sin(1.2 + i * 1.9) * 0.15, -0.18, Math.cos(1.2 + i * 1.9) * 0.15);
        rag.rotation.x = 0.2;
        addWind(rag, 'hang', 0.09, 3.2, 0.08, 0.2);
      }
    }
    // обшлага-манжеты на предплечьях (+канта у богатых)
    for (const el of [elL, elR]) {
      mesh(latheSmooth([[0.036, 0.0], [0.042, 0.02], [0.045, 0.045], [0.041, 0.05]], 6, 10),
        mCoat, el, 0, -0.135 * h, 0);
      if (prof === 'captain' || prof === 'merchant') {
        const ring = mesh(new THREE.TorusGeometry(0.041, 0.005, 5, 12), brassMat(), el, 0, -0.132 * h, 0);
        ring.rotation.x = Math.PI / 2;
      }
    }
    // ПУГОВИЦЫ ВДОЛЬ КАФТАНА (два ряда; капитану/торговцу — латунь)
    const btnM = prof === 'captain' || prof === 'merchant' ? brassMat()
      : new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.4, metalness: 0.5 });
    addButtons(prof === 'captain' ? 6 : 5, btnM, 0.24, -0.2, prof === 'captain' ? 0.163 : 0.16);
    if (prof === 'soldier') {
      // ЛАНКТУТЫ (отвороты) контрастного цвета + белая портупея
      const facing = FACING[Math.floor(rnd() * FACING.length)];
      const mFacing = woolMat(facing);
      for (const s of [-1, 1]) {
        const lap = box(0.052, 0.15, 0.012, mFacing, chest, s * 0.055, 0.13, 0.155);
        lap.rotation.z = s * 0.12;
      }
      const strap = box(0.042, 0.48, 0.012, woolMat(undead ? 0x3a3a34 : 0xe8e2d4), chest, -0.06, 0.05, 0.158);
      strap.rotation.z = 0.42;
    }
    if (prof === 'captain') {
      // золотой кант по борту + подзорная труба на перевязи
      box(0.012, 0.5, 0.008, brassMat(), chest, 0.052, 0.02, 0.162).rotation.z = 0.1;
      const sg = new THREE.Group();
      cyl(0.014, 0.017, 0.05, brassMat(), sg, 0, 0.025, 0, 8);
      cyl(0.011, 0.013, 0.045, brassMat(), sg, 0, 0.072, 0, 8);
      cyl(0.009, 0.011, 0.04, leatherMat(0x241a10), sg, 0, 0.114, 0, 8);
      sg.position.set(-0.145, 0.02 * h, -0.115);
      sg.rotation.set(1.25, 0, 0.45);
      pelvis.add(sg);
    }
    if (prof === 'pirate') {
      // КУШАК поверх пояса + кошель
      const mSash = woolMat(undead ? 0x3a2424 : 0x7a2323);
      const sash = mesh(new THREE.TorusGeometry(0.15, 0.026, 7, 18), mSash, pelvis, 0, 0.012 * h, 0);
      sash.rotation.x = Math.PI / 2;
      sash.scale.set(1, 1, 0.85);
      const sashTail = mesh(new THREE.PlaneGeometry(0.07, 0.2, 3, 8), mSash, pelvis, 0.1, -0.06, 0.145);
      sashTail.rotation.x = 0.3;
      sashTail.material.side = THREE.DoubleSide;
      addWind(sashTail, 'hang', 0.06, 2.6, 0.1, 0.2);
    }
    if (prof === 'merchant' && !undead) {
      // КОШЕЛЬ с золотом на поясе
      sph(0.055, leatherMat(0x4a3826), pelvis, -0.155, -0.01, 0.11).scale.set(1, 0.85, 0.8);
      mesh(new THREE.TorusGeometry(0.02, 0.005, 5, 10), brassMat(), pelvis, -0.155, 0.045, 0.11);
    }
  } else {
    // ---- МАТРОС: рубаха/тельняшка/жилет/фартук (гардероб Task 42) ----
    if (traits.torso === 'striped') {
      const wm = woolMat(undead ? 0x8a8a80 : 0xe8e2d4);
      for (let i = 0; i < 4; i++) {
        const ring = mesh(new THREE.CylinderGeometry(0.146 - i * 0.003, 0.144 - i * 0.003, 0.052, 12, 1, true),
          i % 2 ? wm : mShirt, chest, 0, 0.17 - i * 0.105, 0);
        ring.material.side = THREE.DoubleSide;
      }
    }
    if (traits.torso === 'vest') {
      const vc = [0x3a2c22, 0x26303a, 0x402a34][Math.floor(rnd() * 3)];
      const mVest = woolMat(undead ? 0x26242a : vc);
      for (const s of [-1, 1]) box(0.068, 0.3, 0.02, mVest, chest, s * 0.062, 0.02, 0.138);
      box(0.16, 0.3, 0.02, mVest, chest, 0, 0.02, -0.138);
      for (let i = 0; i < 3; i++) {
        const b = cyl(0.009, 0.009, 0.007, brassMat(), chest, 0.04, 0.14 - i * 0.1, 0.148, 8);
        b.rotation.x = Math.PI / 2;
      }
    }
    if (traits.torso === 'apron') {
      const mApron = woolMat(undead ? 0x4a4438 : 0x8a8272);
      box(0.2, 0.34, 0.012, mApron, chest, 0, -0.03, 0.148);
      box(0.12, 0.09, 0.012, mApron, chest, 0, 0.19, 0.146);
      const strapA = box(0.026, 0.12, 0.01, leatherMat(0x3a2c1e), chest, 0.05, 0.27, 0.14);
      strapA.rotation.z = 0.32;
    }
    if (traits.torso === 'sweater') {
      const collarS = mesh(new THREE.CylinderGeometry(0.062, 0.074, 0.06, 10, 1, true), mShirt, chest, 0, 0.3 * h, 0);
      collarS.material.side = THREE.DoubleSide;
    }
  }

  // ================== БАНДОЛЬЕР «ДВЕНАДЦАТЬ АПОСТОЛОВ» ==================
  // (солдатам и капитанам — всегда, части пиратов; латунная пряжка)
  let bandolierBuilt = false;
  if (prof === 'soldier' || prof === 'captain' || (prof === 'pirate' && rnd() < 0.7)) {
    bandolierBuilt = true;
    const mStrap = leatherMat(undead ? 0x1c1812 : 0x2c2015);
    // перевязь через ПРАВОЕ плечо к ЛЕВОМУ бедру (замкнутая кривая)
    const pts = [
      new THREE.Vector3(0.148, 0.30, 0.052),
      new THREE.Vector3(0.05, 0.16, 0.152),
      new THREE.Vector3(-0.09, -0.12, 0.148),
      new THREE.Vector3(-0.155, -0.28, 0.06),
      new THREE.Vector3(-0.14, -0.26, -0.06),
      new THREE.Vector3(-0.02, 0.05, -0.15),
      new THREE.Vector3(0.12, 0.26, -0.06),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const strap = mesh(new THREE.TubeGeometry(curve, 36, 0.014, 7, true), mStrap, chest);
    // ДВЕНАДЦАТЬ деревянных зарядов вдоль передней дуги (по ТЗ) —
    // заряды и латунные крышки слиты в 2 меша (перф)
    const mCharge = woodMat(undead ? 0x3a3028 : 0x5a4028);
    const bCharge = new GeoBatch(mCharge, chest);
    const bCap = new GeoBatch(brassMat(), chest);
    for (let i = 0; i < 12; i++) {
      const u = 0.06 + (i / 11) * 0.4;                 // передний участок кривой
      const pt = curve.getPointAt(u);
      const g = latheSmooth([
        [0.001, 0.0], [0.014, 0.0], [0.016, 0.05], [0.014, 0.062], [0.017, 0.068], [0.001, 0.07],
      ], 6, 8);
      g.rotateX(0.12);
      bCharge.add(g, [pt.x, pt.y - 0.034, pt.z + 0.012]);
      bCap.add(new THREE.CylinderGeometry(0.0165, 0.0165, 0.008, 8),
        [pt.x, pt.y + 0.036, pt.z + 0.014]);
    }
    bCharge.build();
    bCap.build();
    // МЕДНАЯ ПРЯЖКА на груди (по ТЗ)
    box(0.042, 0.032, 0.012, brassMat(), chest, -0.028, 0.115, 0.152);
  }

  // ================== КРЕМНЁВЫЙ ПИСТОЛЕТ ЗА ПОЯСОМ ==================
  // (пиратам — ДВА; солдату/капитану — один; выхватывается ЛЕВОЙ рукой)
  let pistol: CrewDetailState['pistol'] = null;
  let beltHome: THREE.Object3D | null = null;
  const wantsPistol = prof === 'pirate' || prof === 'captain' || prof === 'soldier';
  if (wantsPistol && traits.hook !== -1) {
    beltHome = joint(pelvis, -0.135, 0.02 * h, 0.105, 'pistolBelt');
    const mkPistol = (parent: THREE.Object3D) => {
      const g = new THREE.Group();
      const mWood = woodMat(undead ? 0x241c14 : 0x3e2a1c);
      // ложа с наклонной рукоятью
      box(0.026, 0.02, 0.2, mWood, g, 0, 0.01, 0.055);
      const grip = box(0.026, 0.075, 0.034, mWood, g, 0, -0.028, -0.03);
      grip.rotation.x = -0.35;
      // ствол + дульное кольцо
      const barrel = cyl(0.011, 0.0125, 0.2, steelMat(), g, 0, 0.022, 0.16, 8);
      barrel.rotation.x = Math.PI / 2;
      mesh(new THREE.TorusGeometry(0.013, 0.004, 5, 10), brassMat(), g, 0, 0.022, 0.258).rotation.x = Math.PI / 2;
      // замочная доска + курок + спусковой крючок со скобой
      box(0.006, 0.045, 0.085, steelMat(), g, 0.014, 0.008, 0.06);
      const hammer = box(0.008, 0.026, 0.013, steelMat(), g, 0.014, 0.033, 0.038);
      hammer.rotation.x = -0.55;
      box(0.005, 0.016, 0.006, steelMat(), g, 0.009, -0.004, 0.062);
      const guard = mesh(new THREE.TorusGeometry(0.02, 0.0032, 5, 12, Math.PI), brassMat(), g, 0.008, -0.007, 0.062);
      guard.rotation.set(0, Math.PI / 2, Math.PI);
      // маунт дула (вспышка/дым при выстреле)
      const muzzle = joint(g, 0, 0.022, 0.27, 'muzzle');
      g.userData.muzzle = muzzle;
      parent.add(g);
      return g;
    };
    const pistolObj = mkPistol(beltHome);
    pistolObj.rotation.set(0.28, 0.35, 0.22);          // за поясом: дуло вниз-вбок
    if (prof === 'pirate') {
      const p2 = mkPistol(joint(pelvis, 0.14, 0.02 * h, 0.1, 'pistolBelt2'));
      p2.rotation.set(0.28, -0.35, -0.22);
    }
    // маунт в ЛЕВОЙ кисти — куда перекочёвывает пистолет при выхвате
    const handMount = joint(handL, 0, -0.045, 0.02, 'pistolHand');
    pistol = { phase: 'holster', t: 0, obj: pistolObj, beltHome, handMount, inHand: false, recoil: 0 };
  }

  // ================== ПОДЗОРНАЯ ТРУБА КАПИТАНА (Task 77) ==================
  // «Как пистолет»: висит СЛОЖЕННОЙ за поясом у бедра; при активации
  // перекочёвывает в кисть, поднимается к глазу и РАСКРЫВАЕТСЯ —
  // два латунных колена выдвигаются из ствола. Ось трубы:
  // окуляр −Z → объектив +Z (окуляром к глазу).
  // Правая кисть занята КРЮКОМ → труба в левой (позы зеркалятся).
  let spyglass: CrewDetailState['spyglass'] = null;
  if (prof === 'captain') {
    const armR = traits.hook !== 1;            // правая рука свободна?
    const spyBelt = joint(pelvis, armR ? -0.148 : 0.148, 0.01 * h, -0.085, 'spyBelt');
    const spyHand = joint(armR ? handR : handL, 0, -0.042, 0.018, 'spyHand');
    const mkSpy = (): THREE.Group => {
      const g = new THREE.Group();
      const mBrass = brassMat();
      const mLeather = leatherMat(undead ? 0x241c12 : 0x3a2c1c);
      const mGlass = new THREE.MeshStandardMaterial({
        color: 0x16352c, roughness: 0.12, metalness: 0.35,
      });
      // ствол (НЕПОДВИЖЕН): латунь + кожаная обмотка хвата
      const body = latheSmooth([[0.0162, -0.062], [0.0174, -0.03], [0.0174, 0.03], [0.016, 0.05]], 8, 12);
      body.rotateX(Math.PI / 2);
      mesh(body, mBrass, g);
      const wrap = latheSmooth([[0.019, -0.026], [0.0195, 0], [0.019, 0.026]], 6, 12);
      wrap.rotateX(Math.PI / 2);
      mesh(wrap, mLeather, g);
      // окуляр: кожаный наглазник-раструб (длинный конус — прижимается
      // к глазнице, «прислонён» к лицу) + тёмная линзочка
      const cup = latheSmooth([[0.0122, -0.108], [0.0158, -0.088], [0.0172, -0.062]], 6, 12);
      cup.rotateX(Math.PI / 2);
      mesh(cup, mLeather, g);
      const eye = cyl(0.0098, 0.0098, 0.004, mGlass, g, 0, 0, -0.0855, 12);
      eye.rotation.x = Math.PI / 2;
      // КОЛЕНО 1 (выдвижное): латунная трубка + ферулы-кольца
      const sec1 = joint(g, 0, 0, 0, 'spySec1');
      const t1 = latheSmooth([[0.0134, 0.03], [0.0148, 0.05], [0.0148, 0.095]], 6, 12);
      t1.rotateX(Math.PI / 2);
      mesh(t1, mBrass, sec1);
      mesh(new THREE.TorusGeometry(0.0164, 0.0022, 6, 12), mBrass, sec1, 0, 0, 0.03);
      mesh(new THREE.TorusGeometry(0.0154, 0.002, 6, 12), mBrass, sec1, 0, 0, 0.093);
      // КОЛЕНО 2 (объективное): раструб с линзой
      const sec2 = joint(g, 0, 0, 0, 'spySec2');
      const t2 = latheSmooth([[0.013, 0.088], [0.0146, 0.11], [0.0172, 0.128], [0.0206, 0.142]], 8, 12);
      t2.rotateX(Math.PI / 2);
      mesh(t2, mBrass, sec2);
      mesh(new THREE.TorusGeometry(0.0216, 0.0024, 6, 14), mBrass, sec2, 0, 0, 0.139);
      const lens = cyl(0.0182, 0.0182, 0.005, mGlass, sec2, 0, 0, 0.137, 14);
      lens.rotation.x = Math.PI / 2;
      return g;
    };
    const spyObj = mkSpy();
    const mr0 = armR ? 1 : -1;
    // Task 79: ГДЕ труба в ПОКОЕ. ЖИВОЙ капитан держит её В РУКЕ
    // «как пистолет» — сложенная в кулаке, стволом вперёд-вниз
    // вдоль предплечья. МЕРТВЕЦ (проклятие «Чёрной жемчужины»)
    // держит СВЕТЯЩИЙСЯ КЛИНОК — труба остаётся за поясом (рука
    // одна), как в Task 77.
    const spyHome: 'belt' | 'hand' = undead ? 'belt' : 'hand';
    const spyRestX = 1.50;                    // покой в кисти: +Z стволом вниз-вперёд
    if (spyHome === 'belt') {
      // за поясом: лежит ВДОЛЬ ремня у бедра руки с трубой (окуляром вперёд)
      spyBelt.add(spyObj);
      spyObj.position.set(0, -0.018, 0.004);
      spyObj.rotation.set(0.10, -1.18 * mr0, 0.34 * mr0);
    } else {
      // В КУЛАКЕ у опущенной руки (как пистолет матроса, ствол вниз)
      spyHand.add(spyObj);
      spyObj.position.set(0, -0.03, 0.012);
      spyObj.rotation.set(spyRestX, 0, 0.366 * mr0);
    }
    spyglass = {
      phase: spyHome === 'belt' ? 'holster' : 'hold', t: 0,
      obj: spyObj, beltHome: spyBelt, handMount: spyHand,
      inHand: spyHome === 'hand', ext: 0,
      sections: spyObj.children.filter(c => c.name === 'spySec1' || c.name === 'spySec2'),
      arm: armR ? 'R' : 'L', home: spyHome, restX: spyRestX, backTo: null,
    };
  }

  // ================== АБОРДАЖНАЯ САБЛЯ (CUTLASS) ==================
  // Изогнутый клинок ExtrudeGeometry по кривым Безье, ЛАТУННАЯ
  // ГАРДА-ЧАШКА, ореховая рукоять с проволочной обмоткой — в руке
  // БЕЗ крюка; ножны — на перевязи у противоположного бедра.
  const swordHand = swordSide === 1 ? handR : handL;
  const mkCutlass = (cursed: boolean): THREE.Group => {
    const g = new THREE.Group();
    // клинок: профиль в XY (Y — длина лезвия), изгиб брюха к +X
    const sh = new THREE.Shape();
    sh.moveTo(-0.011, 0);
    sh.quadraticCurveTo(-0.026, 0.24, -0.014, 0.42);          // обух
    sh.quadraticCurveTo(-0.006, 0.5, 0.012, 0.55);            // скошенный кончик
    sh.quadraticCurveTo(0.024, 0.38, 0.034, 0.2);             // брюхо лезвия (изгиб)
    sh.quadraticCurveTo(0.026, 0.06, 0.011, 0);
    sh.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(sh, {
      depth: 0.008, bevelEnabled: true, bevelThickness: 0.0025,
      bevelSize: 0.003, bevelSegments: 2, curveSegments: 18,
    });
    bladeGeo.translate(0, 0, -0.004);
    let bladeMat: THREE.Material;
    if (cursed) {
      // ПРОКЛЯТЫЙ КЛИНОК капитана-мертвеца (Task 57: emissive 0x1e8f3e)
      bladeMat = new THREE.MeshPhysicalMaterial({
        color: 0x39d65a, transparent: true, opacity: 0.55,
        emissive: 0x1e8f3e, emissiveIntensity: 1.1,
        roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide, depthWrite: true,
      });
      // мерцающая ДЫМКА вдоль лезвия — 3 клуба, анимация onBeforeRender
      const puffs: THREE.Mesh[] = [];
      for (let mi = 0; mi < 3; mi++) {
        const puff = mesh(new THREE.SphereGeometry(0.045 + mi * 0.012, 6, 5),
          new THREE.MeshBasicMaterial({ color: 0x52e07a, transparent: true, opacity: 0.3, depthWrite: false }),
          g, 0, 0.16 + mi * 0.16, 0.01);
        puffs.push(puff);
      }
      const t0 = (seed % 100) * 0.37;
      (bladeMat as THREE.MeshPhysicalMaterial).onBeforeRender = () => {
        const t = performance.now() * 0.001 + t0;
        (bladeMat as THREE.MeshPhysicalMaterial).opacity = 0.48 + 0.14 * Math.sin(t * 2.3);
        (bladeMat as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.9 + 0.55 * Math.sin(t * 3.1 + 1.3);
        for (let mi = 0; mi < puffs.length; mi++) {
          const pm = puffs[mi].material as THREE.MeshBasicMaterial;
          const ph = t * (1.1 + mi * 0.35) + mi * 2.1;
          pm.opacity = 0.14 + 0.13 * (0.5 + 0.5 * Math.sin(ph));
          puffs[mi].position.x = Math.sin(ph * 0.7) * 0.03;
          puffs[mi].scale.setScalar(0.85 + 0.3 * (0.5 + 0.5 * Math.sin(ph * 0.5 + 1)));
        }
      };
    } else {
      bladeMat = steelMat();
    }
    const blade = mesh(bladeGeo, bladeMat, g);
    blade.position.y = 0.028;
    // ЛАТУННАЯ ГАРДА-ЧАШКА (полусфера) + дужка к пимпу
    const bowl = mesh(new THREE.SphereGeometry(0.05, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), brassMat(), g);
    bowl.rotation.x = Math.PI;
    bowl.scale.y = 0.62;
    bowl.position.y = 0.022;
    const bow = mesh(new THREE.TorusGeometry(0.044, 0.005, 6, 14, Math.PI * 1.05), brassMat(), g, 0.012, 0.05, 0);
    bow.rotation.set(0, 0, Math.PI * 0.5 + 0.22);
    // РУКОЯТЬ: орех + проволочная обмотка (5 колец) + пимп
    cyl(0.0135, 0.0155, 0.092, woodMat(0x4a3020), g, 0, -0.048, 0, 9);
    for (let i = 0; i < 5; i++) {
      const ring = mesh(new THREE.TorusGeometry(0.0145, 0.002, 5, 12), brassMat(), g, 0, -0.018 - i * 0.016, 0);
      ring.rotation.x = Math.PI / 2;
    }
    sph(0.019, brassMat(), g, 0, -0.104, 0);
    box(0.026, 0.018, 0.02, brassMat(), g, 0, 0.004, 0);
    return g;
  };
  // сабля в кисти: клинок вперёд-вниз от кулака (локально +Z кисти);
  // пальцы этой кисти УЖЕ запечены СГУБТОМ вокруг рукояти (см. mkArm)
  // Task 77: пока в руке ТРУБА — сабля скрыта (рука одна!)
  // Task 79: у ЖИВОГО капитана труба теперь В РУКЕ ПОСТОЯННО —
  // сабля в покое всегда скрыта (ножны на боку), появляется только
  // в бою (setDetailPoseMode). У МЕРТВЕЦА наоборот: в руке
  // СВЕТЯЩИЙСЯ КЛИНОК, труба за поясом.
  let cutlassObj: THREE.Object3D | null = null;
  {
    const cutlass = mkCutlass(undead && prof === 'captain');
    cutlass.position.set(0, -0.055, 0.03);
    cutlass.rotation.x = Math.PI / 2 + 0.18;
    swordHand.add(cutlass);
    cutlassObj = cutlass;
    if (prof === 'captain' && !undead && spyglass) cutlass.visible = false;
  }
  // НОЖНЫ на противоположном бедре (кожа + латунный наконечник)
  {
    const scabX = -swordSide * 0.155;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(scabX, 0.045, 0.075),
      new THREE.Vector3(scabX - swordSide * 0.03, -0.12, 0.05),
      new THREE.Vector3(scabX - swordSide * 0.045, -0.3, 0.0),
      new THREE.Vector3(scabX - swordSide * 0.04, -0.4, -0.01),
    ]);
    const scab = mesh(new THREE.TubeGeometry(c, 14, 0.021, 8),
      leatherMat(undead ? 0x1e1a14 : 0x3a2a1c), pelvis);
    mesh(new THREE.TorusGeometry(0.023, 0.006, 5, 12), brassMat(), pelvis, scabX, 0.05, 0.075).rotation.x = 0.85;
    const chape = mesh(new THREE.ConeGeometry(0.021, 0.05, 8), brassMat(),
      pelvis, scabX - swordSide * 0.04, -0.425, -0.012);
    chape.rotation.x = Math.PI - 0.2;
  }

  // ================== МЕРТВЕЦ: СВЕТ ГЛАЗ + ТЛЕН ==================
  if (undead) {
    const glow = new THREE.PointLight(0x49ff9a, 0.5, 1.4, 2);
    glow.position.set(0, headR * 0.05, headR * 0.8);
    head.add(glow);
    // рёбра проступают сквозь истлевшую рубаху (у простых)
    if (prof === 'sailor' && traits.torso !== 'vest') {
      for (let ri = 0; ri < 3; ri++) {
        box(0.19, 0.012, 0.012, new THREE.MeshStandardMaterial({ color: 0xc9cfc0, roughness: 0.8 }),
          chest, 0, 0.16 - ri * 0.065, 0.132);
      }
    }
  }

  // ================== ПОЗЫ СТАТИЧНЫХ РОЛЕЙ ==================
  if (role === 'helmsman') {
    // рулевой: руки ВПЕРЁД к штурвалу
    shL.rotation.x = -1.15; shL.rotation.z = 0.12;
    shR.rotation.x = -1.15; shR.rotation.z = -0.12;
    elL.rotation.x = -0.45;
    elR.rotation.x = -0.45;
  } else if (!movable) {
    shL.rotation.z = 0.06;
    shR.rotation.z = -0.06;
    elL.rotation.x = -0.3;
    elR.rotation.x = -0.3;
  }

  // ================== СОСТОЯНИЕ ОЖИВЛЕНИЯ ==================
  const detail: CrewDetailState = {
    root: group,
    chest, chestCoat,
    head, neck, spine,
    shoulderL: shL, shoulderR: shR,
    kneeL, kneeR, ankleL: ankL, ankleR: ankR, hipL, hipR,
    lidL, lidR,
    breathePh: rnd() * 6.28,
    nextBlink: 1 + rnd() * 3, blinkT: -1,
    wind, windT: rnd() * 10,
    shoulderBaseY: 0.29 * h,
    pelvisBaseY: pelvis.position.y,
    pose: 'deck', poseT: 0,
    pistol,
    spyglass,
    undead, profession: prof,
    cutlassObj,
    charges: bandolierBuilt ? 12 : 0,
    hasCutlass: true,
    hasFeather: !!featherMesh,
    poseJoints: {
      shL, shR, elL, elR, hipL, hipR, kneeL, kneeR, ankL: ankL, ankR: ankR,
      pelvis, spine, chest,
    },
  };
  // лёгкая асимметрия стойки (живость)
  shL.rotation.z += 0.03;
  shR.rotation.z -= 0.05;

  return {
    group, role, legL: hipL, legR: hipR, armL: shL, armR: shR, wristMount, seed,
    walkT: rnd(), walkDir: rnd() < 0.5 ? 1 : -1, baseScaleY: 1,
    walkSpeed: 0.55 + rnd() * 0.5, phase: rnd() * 6.28,
    dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0, fallDir: 1, fallRoll: 0,
    skin: skinC, shirt: shirtC, pants: pantsC,
    hasHook: traits.hook !== 0, hasPeg: traits.pegLeg !== 0, hasParrot: traits.parrot,
    verts: 0,                                      // заполнит buildCrew
    detail,
  };
}

// ------------------------------------------------------------
// ПОРОХОВОЙ ДЫМ + ВСПЫШКА (система частиц по ТЗ)
// ------------------------------------------------------------
let smokeTex: THREE.Texture | null = null;
function getSmokeTex(): THREE.Texture {
  if (smokeTex) return smokeTex;
  smokeTex = canvasTex('smoke', 64, true, (x, s) => {
    for (let i = 0; i < 5; i++) {                             // клуб из пятен
      const gx = s * (0.3 + texHash(i, 3, 3) * 0.4), gy = s * (0.3 + texHash(i, 5, 5) * 0.4);
      const gr = s * (0.16 + texHash(i, 7, 7) * 0.16);
      const g = x.createRadialGradient(gx, gy, 1, gx, gy, gr);
      g.addColorStop(0, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(gx, gy, gr, 0, 6.29); x.fill();
    }
  });
  return smokeTex;
}
let flashTex: THREE.Texture | null = null;
function getFlashTex(): THREE.Texture {
  if (flashTex) return flashTex;
  flashTex = canvasTex('flash', 64, true, (x, s) => {
    const g = x.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,235,1)');
    g.addColorStop(0.35, 'rgba(255,190,80,0.9)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    x.strokeStyle = 'rgba(255,240,200,0.9)';                   // лучи вспышки
    x.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      x.beginPath();
      x.moveTo(s / 2, s / 2);
      x.lineTo(s / 2 + Math.cos(a) * s * 0.46, s / 2 + Math.sin(a) * s * 0.46);
      x.stroke();
    }
  });
  return flashTex;
}

interface PuffCloud {
  points: THREE.Points;
  pos: Float32Array; vel: Float32Array;
  life: Float32Array; ttl: Float32Array;
  t: number;
}
const puffClouds: PuffCloud[] = [];

/** Облако порохового дыма у дула (локальные координаты root фигуры) */
function spawnSmokeCloud(root: THREE.Object3D, originLocal: THREE.Vector3, dirLocal: THREE.Vector3) {
  const N = 30;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N).fill(0.001);
  const ttl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = originLocal.x;
    pos[i * 3 + 1] = originLocal.y;
    pos[i * 3 + 2] = originLocal.z;
    const sp = 0.5 + Math.random() * 0.9;
    vel[i * 3] = dirLocal.x * sp + (Math.random() - 0.5) * 0.5;
    vel[i * 3 + 1] = dirLocal.y * sp * 0.6 + 0.25 + Math.random() * 0.4;
    vel[i * 3 + 2] = dirLocal.z * sp + (Math.random() - 0.5) * 0.5;
    ttl[i] = 1.0 + Math.random() * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N).fill(0.05), 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aTTL', new THREE.BufferAttribute(ttl, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: getSmokeTex() } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute float aSize; attribute float aLife; attribute float aTTL; varying float vA;
      void main(){
        vA = clamp(1.0 - aLife / aTTL, 0.0, 1.0) * 0.55;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (1.0 + aLife * 2.2) * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
      void main(){ vec4 c = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.84, 0.83, 0.80), c.a * vA); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  root.add(points);
  puffClouds.push({ points, pos, vel, life, ttl, t: 0 });
}

/** ВСПЫШКА выстрела: спрайт + короткий свет у дула */
let flashSprite: THREE.Sprite | null = null;
let flashT = 0;
function muzzleFlash(pistolG: THREE.Group, muzzle: THREE.Object3D) {
  if (!flashSprite) {
    flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getFlashTex(), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }));
    flashSprite.scale.set(0.34, 0.34, 1);
  }
  muzzle.add(flashSprite);
  flashSprite.material.rotation = Math.random() * 6.28;
  flashSprite.visible = true;
  flashT = 0.09;
}

function updateFx(dt: number) {
  // дым
  for (let ci = puffClouds.length - 1; ci >= 0; ci--) {
    const c = puffClouds[ci];
    c.t += dt;
    let alive = false;
    const drag = Math.exp(-1.1 * dt);
    for (let i = 0; i < c.life.length; i++) {
      if (c.life[i] >= c.ttl[i]) continue;
      alive = true;
      c.life[i] += dt;
      c.vel[i * 3] *= drag;
      c.vel[i * 3 + 1] = c.vel[i * 3 + 1] * drag + 0.34 * dt;   // дым всплывает
      c.vel[i * 3 + 2] *= drag;
      c.pos[i * 3] += c.vel[i * 3] * dt;
      c.pos[i * 3 + 1] += c.vel[i * 3 + 1] * dt;
      c.pos[i * 3 + 2] += c.vel[i * 3 + 2] * dt;
    }
    const g = c.points.geometry;
    g.attributes.position.needsUpdate = true;
    (g.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    if (!alive || c.t > 3.5) {
      c.points.parent?.remove(c.points);
      c.points.geometry.dispose();
      (c.points.material as THREE.Material).dispose();
      puffClouds.splice(ci, 1);
    }
  }
  // вспышка
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0 && flashSprite) {
      flashSprite.visible = false;
      flashSprite.parent?.remove(flashSprite);
    }
  }
}

// ------------------------------------------------------------
// РЕЖИМЫ ПОЗЫ (превью /crew; на палубе pose='deck' — не трогает
// руки/ноги, ими управляет crew.ts: ходьба/посты/махи)
// ------------------------------------------------------------
/** Интерактивный режим фигуры (превью и палуба) */
export type DetailPoseMode = 'idle' | 'combat' | 'pistol' | 'spyglass';

/** Включить интерактивный режим (idle/combat/pistol/spyglass);
 *  'deck' — вернуть фигуру под управление crew.ts. 'pistol'
 *  запускает ФАЗОВУЮ последовательность выстрела (выхват левой
 *  рукой → прицел → вспышка+отдача+дым → опускание → за пояс);
 *  'spyglass' (Task 77) — цикл ТРУБЫ (выхват правой → к глазу →
 *  колена выдвигаются → при смене режима: сложить → за пояс).
 *  Труба и пистолет взаимоисключимы в цикле. */
export function setDetailPoseMode(d: CrewDetailState, mode: DetailPoseMode | 'deck'): boolean {
  if (mode === 'spyglass') {
    if (!d.spyglass) return false;
    const ph = d.spyglass.phase;
    if (ph !== 'holster' && ph !== 'hold' && ph !== 'lower') return false;
    if (d.pistol && d.pistol.phase !== 'holster') return false;
    d.spyglass.phase = 'draw';
    d.spyglass.t = 0;
    d.spyglass.backTo = null;
    // Task 79: в бою труба была спрятана — обратно в руку
    if (d.spyglass.home === 'hand') d.spyglass.obj.visible = true;
    d.pose = 'spyglass';
    d.poseT = 0;
    return true;
  }
  if (mode === 'pistol') {
    if (!d.pistol || d.pistol.phase !== 'holster') return false;
    // Task 77: пока ТРУБА в цикле — пистолет не выхватываем
    if (d.spyglass && d.spyglass.phase !== 'holster' && d.spyglass.phase !== 'hold') return false;
    d.pistol.phase = 'draw';
    d.pistol.t = 0;
    d.pose = 'pistol';
    d.poseT = 0;
    return true;
  }
  // Task 77: труба АКТИВНА (цикл draw/observe) — сначала фаза lower
  // (сложить колена, вернуть в покой), поза сменится на mode ПОСЛЕ
  // её завершения
  if (d.spyglass && d.spyglass.phase !== 'holster' && d.spyglass.phase !== 'hold') {
    if (d.spyglass.phase !== 'lower') { d.spyglass.phase = 'lower'; d.spyglass.t = 0; }
    d.spyglass.backTo = mode as 'idle' | 'combat' | 'deck';
    return true;   // поза ещё 'spyglass' — докручивает lower
  }
  // Task 79: рука ОДНА — на палубе/в дозоре ЖИВОЙ капитан держит
  // ТРУБУ (сабля в ножнах), в бою кисть занимает КЛИНОК (труба
  // спрятана). Мертвецу это не нужно: у него клинок всегда в руке.
  if (d.spyglass && d.spyglass.home === 'hand' && d.spyglass.phase === 'hold') {
    const fight = mode === 'combat';
    d.spyglass.obj.visible = !fight;
    if (d.cutlassObj) d.cutlassObj.visible = fight;
  }
  // пистолет вернуть за пояс (если не в цикле выстрела)
  if (d.pistol && d.pistol.phase !== 'holster') {
    if (d.pistol.inHand) {
      d.pistol.beltHome.add(d.pistol.obj);
      d.pistol.obj.position.set(0, 0, 0);
      d.pistol.obj.rotation.set(0.28, 0.35, 0.22);
      d.pistol.inHand = false;
    }
    d.pistol.phase = 'holster';
  }
  d.pose = mode;
  d.poseT = 0;
  return true;
}

/** фазы выстрела по времени, с */
const PISTOL_T = { draw: 0.55, aim: 0.8, fire: 1.0, lower: 0.6 };

/** Task 77: фазы трубы по времени, с (observe — до смены режима) */
const SPY_T = { draw: 0.7, lower: 0.6 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

function updatePistolPhase(d: CrewDetailState, dt: number) {
  const p = d.pistol!;
  p.t += dt;
  if (p.phase === 'draw') {
    // в середине фазы пистолет ПЕРЕКАЧЁВЫВАЕТСЯ из-за пояса в кисть
    if (!p.inHand && p.t > 0.3) {
      p.handMount.attach(p.obj);
      p.obj.position.set(0, -0.03, 0.035);
      p.obj.rotation.set(Math.PI / 2, 0, 0.1);
      p.inHand = true;
    }
    if (p.t >= PISTOL_T.draw) { p.phase = 'aim'; p.t = 0; }
  } else if (p.phase === 'aim') {
    if (p.t >= PISTOL_T.aim) {
      // ВЫСТРЕЛ: вспышка + отдача + ОБЛАКО ПОРОХОВОГО ДЫМА
      p.phase = 'fire';
      p.t = 0;
      p.recoil = 1;
      const muzzle = p.obj.userData.muzzle as THREE.Object3D;
      muzzleFlash(p.obj, muzzle);
      muzzle.getWorldPosition(_v1);
      d.root.worldToLocal(_v1);
      _v2.set(0, 0, 1).applyQuaternion(
        _q1.copy(p.obj.getWorldQuaternion(new THREE.Quaternion())).premultiply(
          d.root.getWorldQuaternion(new THREE.Quaternion()).invert()));
      spawnSmokeCloud(d.root, _v1, _v2.normalize());
    }
  } else if (p.phase === 'fire') {
    p.recoil = Math.max(0, p.recoil - dt * 3.2);
    if (p.t >= PISTOL_T.fire) { p.phase = 'lower'; p.t = 0; }
    } else if (p.phase === 'lower') {
    p.recoil = Math.max(0, p.recoil - dt * 3.2);
    if (p.t >= PISTOL_T.lower) {
      // за пояс; последовательность завершена — назад в «дозор»
      if (p.inHand) {
        p.beltHome.add(p.obj);
        p.obj.position.set(0, 0, 0);
        p.obj.rotation.set(0.28, 0.35, 0.22);
        p.inHand = false;
      }
      p.phase = 'holster';
      d.pose = 'idle';
      d.poseT = 0;
    }
  }
}

/** Task 77/79: ФАЗЫ ТРУБЫ (как пистолет). ЖИВОЙ капитан (home='hand')
 *  держит трубу В РУКЕ ПОСТОЯННО: draw — рука поднимает её от бедра
 *  к глазу (поворот в кисти от «ствол вниз» к «окуляр к глазу»),
 *  observe — у глаза (полное выдвижение), lower — сложить и ВЕРНУТЬ
 *  В РУКУ (ствол вниз). МЕРТВЕЦ (home='belt') — схема Task 77:
 *  выхват за поясом→кисть, к глазу, обратно за пояс. */
function updateSpyglassPhase(d: CrewDetailState, dt: number) {
  const p = d.spyglass!;
  const mr = p.arm === 'R' ? 1 : -1;      // зеркало (правая/левая рука)
  p.t += dt;
  if (p.phase === 'draw') {
    // в середине фазы труба ПЕРЕКАЧЁВЫВАЕТСЯ из-за пояса в кисть
    // (только МЕРТВЕЦ — у живого она уже в руке с постройки)
    if (!p.inHand && p.t > 0.32) {
      p.handMount.attach(p.obj);
      p.obj.position.set(0, -0.03, 0.012);
      // поворот в кисти — калибровка FK: ось трубы вперёд от глаза
      p.obj.rotation.set(-3.387, 0, 0.366 * mr);
      p.inHand = true;
      // Task 77: сабля в этой же кисти — убрать (не «три руки»)
      if (d.cutlassObj) d.cutlassObj.visible = false;
    }
    // Task 79: в кисти труба ПОВОРАЧИВАЕТСЯ от «ствол вниз» (покой)
    // к «окуляром к глазу» — по мере подъёма руки
    if (p.inHand) {
      const k = Math.min(1, p.t / SPY_T.draw);
      p.obj.rotation.x = THREE.MathUtils.lerp(p.restX, -3.387, k);
    }
    // колена трогаются ещё по пути к глазу (на треть выдвижения)
    const target = Math.max(0, (p.t - 0.3) / 0.55) * 0.35;
    p.ext += (target - p.ext) * Math.min(1, dt * 6);
    if (p.t >= SPY_T.draw) { p.phase = 'observe'; p.t = 0; }
  } else if (p.phase === 'observe') {
    // У ГЛАЗА: колена полностью выдвинуты — капитан вглядывается вдаль
    p.ext += (1 - p.ext) * Math.min(1, dt * 4);
  } else if (p.phase === 'lower') {
    // сложить колена и вернуть в ПОКОЙ (в руку — живому, за пояс — мертвецу)
    p.ext += (0 - p.ext) * Math.min(1, dt * 7);
    if (p.inHand) {
      const k = Math.max(0, 1 - p.t / SPY_T.lower);
      p.obj.rotation.x = THREE.MathUtils.lerp(-3.387, p.restX, k);
    }
    if (p.t >= SPY_T.lower) {
      if (p.inHand && p.home === 'belt') {
        p.beltHome.add(p.obj);
        p.obj.position.set(0, -0.018, 0.004);
        p.obj.rotation.set(0.10, -1.18 * mr, 0.34 * mr);
        p.inHand = false;
        // сабля возвращается в кисть (мертвецу — проклятый клинок)
        if (d.cutlassObj) d.cutlassObj.visible = true;
      }
      // живому: труба ОСТАЁТСЯ в кулаке стволом вниз (рука опущена)
      p.phase = p.home === 'belt' ? 'holster' : 'hold';
      p.ext = 0;                       // колена сложены до конца
      const back = p.backTo ?? 'idle';
      p.backTo = null;
      d.pose = back;
      d.poseT = 0;
    }
  }
  // выдвижные колена скользят по оптической оси (+Z)
  for (let i = 0; i < p.sections.length; i++) {
    p.sections[i].position.z = p.ext * (i === 0 ? 0.052 : 0.104);
  }
}

/** Позы конечностей для интерактивных режимов (цели для лерпа) */
function poseTargets(d: CrewDetailState): Record<string, [number, number, number]> {
  const t: Record<string, [number, number, number]> = {
    shL: [0.08, 0, 0.1], elL: [-0.3, 0, 0],
    shR: [0.1, 0, -0.12], elR: [-0.35, 0, 0],
    hipL: [-0.03, 0, 0.03], hipR: [-0.03, 0, -0.03],
    kneeL: [0.06, 0, 0], kneeR: [0.06, 0, 0],
    ankL: [-0.03, 0, 0], ankR: [-0.03, 0, 0],
    pelvis: [0, 0, 0], spine: [0.03, 0, 0], chest: [0.02, 0, 0],
  };
  if (d.pose === 'combat') {
    // НИЗКАЯ УСТОЙЧИВАЯ СТОЙКА, сабля наизготовку
    t.pelvis = [0.06, 0.25, 0];
    t.spine = [0.12, 0.1, 0];
    t.shR = [-0.85, -0.3, -0.35];
    t.elR = [-1.15, 0, 0];
    t.shL = [-0.35, 0, 0.55];
    t.elL = [-1.05, 0, 0];
    t.hipL = [-0.42, 0.12, 0.05];
    t.hipR = [-0.2, -0.1, -0.05];
    t.kneeL = [0.72, 0, 0];
    t.kneeR = [0.45, 0, 0];
    t.ankL = [0.12, 0, 0];
    t.ankR = [0.1, 0, 0];
    // периодический ВЫПАД саблей (каждые ~2.8 с)
    const c = d.poseT % 2.8;
    if (c > 2.2) {
      const e = Math.sin(Math.min((c - 2.2) / 0.6, 1) * Math.PI);
      t.shR = [-1.35 - e * 0.25, -0.15, -0.1];
      t.elR = [-0.3 + e * 0.05, 0, 0];
      t.spine = [0.16, 0.25 + e * 0.15, 0];
    }
  } else if (d.pose === 'pistol' && d.pistol) {
    const ph = d.pistol.phase;
    if (ph === 'draw') {
      // левая рука тянется К ПОЯСУ за пистолетом
      t.shL = [-0.42, 0.32, 0.5];
      t.elL = [-1.75, 0, 0];
      t.spine = [0.05, -0.2, 0];
    } else if (ph === 'aim' || ph === 'fire') {
      // ПРИЦЕЛИВАНИЕ: левая рука вытянута, лёгкая дрожь
      t.shL = [-1.38, 0.1, 0.12];
      t.elL = [-0.12, 0, 0];
      t.spine = [0.06, -0.16, 0];
      t.shR = [0.12, 0, -0.2];
      t.elR = [-0.7, 0, 0];
      // ОТДАЧА (гаснет после выстрела)
      const r = d.pistol.recoil;
      t.shL = [t.shL[0] + r * 0.32, t.shL[1], t.shL[2]];
      t.spine = [t.spine[0] + r * 0.1, t.spine[1] + r * 0.12, t.spine[2]];
      if (ph === 'aim') {                                   // дрожь рук
        t.shL[1] += Math.sin(d.poseT * 6.2) * 0.012;
        t.elL[0] += Math.sin(d.poseT * 5.1) * 0.014;
      }
    } else if (ph === 'lower') {
      t.shL = [0.05, 0.15, 0.3];
      t.elL = [-1.1, 0, 0];
      t.spine = [0.04, -0.08, 0];
    }
  } else if (d.pose === 'spyglass' && d.spyglass) {
    // Task 77: ТРУБА — рука с трубой несёт её к глазу, вторая
    // поддерживает ствол снизу (двуручный хват морского офицера).
    // Зеркалим по руке с трубой (правая занята крюком → левая)
    const ph = d.spyglass.phase;
    const mr = d.spyglass.arm === 'R' ? 1 : -1;
    const armSh = mr === 1 ? 'shR' : 'shL';      // рука с ТРУБОЙ
    const armEl = mr === 1 ? 'elR' : 'elL';
    const supSh = mr === 1 ? 'shL' : 'shR';      // рука-подпорка
    const supEl = mr === 1 ? 'elL' : 'elR';
    if (ph === 'draw') {
      // Task 79: ЖИВОЙ (home='hand') — рука ПОДНИМАЕТ трубу от бедра
      // к глазу (полпути к позе observe); МЕРТВЕЦ — выхват от пояса
      // (наклон корпуса к бедру, как в Task 77)
      if (d.spyglass.home === 'belt') {
        t[armSh] = [0.30, -0.32 * mr, -0.10 * mr];
        t[armEl] = [-0.55, 0, -0.10 * mr];
        t.spine = [0.15, 0.10 * mr, 0];
      } else {
        t[armSh] = [-0.45, 0.28 * mr, -0.26 * mr];
        t[armEl] = [-1.30, 0, -0.18 * mr];
        t.spine = [0.06, 0, 0];
      }
    } else if (ph === 'observe') {
      // ТРУБА У ГЛАЗА (углы — численная калибровка FK scripts/calib_spy.mjs:
      // окуляр в 3 см от правого глаза, ось трубы вперёд к горизонту,
      // локоть согнут — не «вытянутая рука»); вторая кисть НА СТВОЛЕ
      t[armSh] = [-1.00, 0.73 * mr, -0.40 * mr];
      t[armEl] = [-1.81, 0, -0.26 * mr];
      t[supSh] = [-2.61, -0.39 * mr, -0.95 * mr];
      t[supEl] = [0, 0, -0.05 * mr];
      t.spine = [0.02, -0.06 * mr, 0];
      t.chest = [0.02, -0.04 * mr, 0];
      t[armSh][1] += Math.sin(d.poseT * 0.5) * 0.06       // скан горизонта
                   + Math.sin(d.poseT * 5.3) * 0.010;      // тремор плеча
      t[armSh][0] += Math.sin(d.poseT * 6.1) * 0.012;
      t[armEl][0] += Math.sin(d.poseT * 5.7) * 0.014;
      t[supEl][0] += Math.sin(d.poseT * 4.9 + 1.1) * 0.05;
    } else if (ph === 'lower') {
      t[armSh] = [0.18, -0.12 * mr, -0.24 * mr];
      t[armEl] = [-0.98, 0, -0.10 * mr];
      t.spine = [0.04, 0.05 * mr, 0];
    }
  } else {
    // IDLE (дозор): перенос веса, руки свободно
    const sw = Math.sin(d.poseT * 0.5);
    t.pelvis = [0, 0, sw * 0.02];
    t.shL = [0.08 + Math.sin(d.poseT * 1.2) * 0.015, 0, 0.1];
    t.shR = [0.1 + Math.sin(d.poseT * 1.2 + 1) * 0.015, 0, -0.12];
  }
  return t;
}

// ------------------------------------------------------------
// ГЛАВНЫЙ АПДЕЙТ ОЖИВЛЕНИЯ (вызывается из CrewVisual.update для
// живых видимых фигур и из цикла превью /crew)
// ------------------------------------------------------------
/** Дыхание, равновесие при качке, осмотр горизонта, моргание,
 *  вершинный ветер (полы/платок/перо) и — в интерактивных позах —
 *  режимы idle/combat/pistol с фазовым выстрелом */
export function animateCrewDetail(d: CrewDetailState, t: number, dt: number, env?: DetailEnv) {
  updateFx(dt);
  // Task 77: ФАЗЫ ТРУБЫ идут во всех позах (на палубе — пока
  // складывается после переключения обратно в 'deck');
  // Task 79: 'hold' (труба покоится В РУКЕ) ничего не анимирует
  if (d.spyglass && d.spyglass.phase !== 'holster' && d.spyglass.phase !== 'hold') updateSpyglassPhase(d, dt);
  // ---------- ДЫХАНИЕ: расширение грудной клетки + плечи ----------
  const br = Math.sin(t * 1.45 + d.breathePh);
  const k = 1 + br * 0.022;
  d.chest.scale.set(k, 1 + br * 0.008, k * 1.03);
  if (d.shoulderL && d.shoulderR) {
    d.shoulderL.position.y = d.shoulderBaseY + br * 0.004;
    d.shoulderR.position.y = d.shoulderBaseY + br * 0.004;
  }
  // ---------- РАВНОВЕСИЕ ПРИ КАЧКЕ: компенсация наклона ----------
  // корпус отклоняется ПРОТИВ крена, колени пружинят, щиколотки
  // держат стопу на наклонной палубе (по ТЗ). На палубе (pose=deck)
  // — напрямую; в интерактивных позах — поверх целей позы (ниже)
  const roll = env?.roll ?? 0;
  const pitch = env?.pitch ?? 0;
  if (d.pose === 'deck' && d.spine) d.spine.rotation.z = -roll * 0.55;
  if (d.neck) d.neck.rotation.z = roll * 0.3;
  const flex = Math.abs(roll) * 0.9 + Math.abs(pitch) * 1.2;
  if (d.kneeL && d.kneeR && d.pose === 'deck') {
    // на палубе колени лишь слегка пружинят (не мешать ходьбе crew.ts)
    d.kneeL.rotation.x = flex * 0.35;
    d.kneeR.rotation.x = flex * 0.3;
  }
  // ---------- ОСМОТР ГОРИЗОНТА (повороты головы) ----------
  // Task 77: в режиме ТРУБЫ голова ведёт себя по фазе — смотрит на
  // пояс при выхвате, прижата к окуляру при наблюдении (скан)
  if (d.pose === 'spyglass' && d.spyglass) {
    const ph = d.spyglass.phase;
    const mr = d.spyglass.arm === 'R' ? 1 : -1;
    if (ph === 'draw') {
      d.head.rotation.x += (0.30 - d.head.rotation.x) * Math.min(1, dt * 6);
      d.head.rotation.y += (-0.34 * mr - d.head.rotation.y) * Math.min(1, dt * 6);
      d.head.rotation.z *= 0.9;
    } else if (ph === 'observe') {
      // глаз к окуляру: наклон головы К ТРУБЕ + взгляд чуть выше
      // горизонта (дальний рейд) + медленный скан
      d.head.rotation.x += (-0.06 - d.head.rotation.x) * Math.min(1, dt * 6);
      d.head.rotation.y += (Math.sin(d.poseT * 0.5) * 0.14 - 0.10 * mr - d.head.rotation.y)
        * Math.min(1, dt * 6);
      d.head.rotation.z += (0.16 * mr - d.head.rotation.z) * Math.min(1, dt * 4);
    } else {
      d.head.rotation.x += (0.12 - d.head.rotation.x) * Math.min(1, dt * 6);
      d.head.rotation.y *= 0.92;
      d.head.rotation.z *= 0.9;
    }
    if (d.neck) d.neck.rotation.y = d.head.rotation.y * 0.3;
  } else if (d.pose === 'deck' || d.pose === 'idle') {
    const sn = Math.sin(t * 0.38 + d.breathePh * 2.3);
    const scan = Math.sign(sn) * Math.pow(Math.abs(sn), 0.6) * 0.4;
    d.head.rotation.y = scan;
    d.head.rotation.x = Math.sin(t * 0.27 + d.breathePh) * 0.07 - 0.02;
    if (d.neck) d.neck.rotation.y = scan * 0.35;
  } else {
    d.head.rotation.y *= 0.9;
  }
  // ---------- МОРГАНИЕ ----------
  if (d.blinkT > 0) {
    d.blinkT -= dt;
    if (d.blinkT <= 0) { d.blinkT = -1; d.nextBlink = 2.2 + Math.random() * 2.8; }
  } else if (d.nextBlink > 0) {
    d.nextBlink -= dt;
  } else {
    d.blinkT = 0.13;
  }
  const closed = d.blinkT > 0;
  d.lidL.scale.y = d.lidR.scale.y = closed ? 1 : 0.14;
  // ---------- ВЕРШИННЫЙ ВЕТЕР: полы/платок/перо ----------
  d.windT += dt;
  const wind = env?.wind ?? 0.6;
  // порывы: медленное дыхание ветра + редкие шквалы
  const gust = wind * (0.55 + 0.45 * Math.sin(t * 0.43 + d.breathePh)
    + Math.pow(Math.max(0, Math.sin(t * 0.09 + 2.2)), 6) * 0.8);
  for (const w of d.wind) {
    const pos = w.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const b = w.base;
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      const x = b[i3], y = b[i3 + 1], z = b[i3 + 2];
      let wt: number;
      if (w.kind === 'skirt') wt = Math.pow(Math.max(0, (w.top - y) / w.len), 1.6);
      else if (w.kind === 'hang') wt = Math.max(0, Math.min(1, (w.top - y) / w.len));
      else wt = Math.max(0, Math.min(1, (y / w.span) + 0.5));
      const a = wt * gust;
      const g1 = Math.sin(t * w.freq + w.phase + y * 14 + x * 5) * 0.6
        + Math.sin(t * w.freq * 1.7 + w.phase + z * 9 + x * 3) * 0.4;
      pos.array[i3] = x + g1 * a * w.amp;                     // вдоль палубы (попутный)
      pos.array[i3 + 2] = z + g1 * a * w.amp * 0.55;          // и лёгкий увод за борт
    }
    pos.needsUpdate = true;
    w.mesh.geometry.computeVertexNormals();
  }
  // ---------- ИНТЕРАКТИВНЫЕ ПОЗЫ (превью) ----------
  if (d.pose !== 'deck') {
    d.poseT += dt;
    if (d.pistol && d.pose === 'pistol') updatePistolPhase(d, dt);
    const pj = d.poseJoints!;
    const targets = poseTargets(d);
    const kk = 1 - Math.exp(-9 * dt);
    const apply = (o: THREE.Object3D, key: string) => {
      const p = targets[key];
      if (!p) return;
      o.rotation.x += (p[0] - o.rotation.x) * kk;
      o.rotation.y += (p[1] - o.rotation.y) * kk;
      o.rotation.z += (p[2] - o.rotation.z) * kk;
    };
    apply(pj.shL, 'shL'); apply(pj.shR, 'shR');
    apply(pj.elL, 'elL'); apply(pj.elR, 'elR');
    apply(pj.hipL, 'hipL'); apply(pj.hipR, 'hipR');
    apply(pj.kneeL, 'kneeL'); apply(pj.kneeR, 'kneeR');
    apply(pj.ankL, 'ankL'); apply(pj.ankR, 'ankR');
    apply(pj.spine, 'spine'); apply(pj.chest, 'chest');
    // таз: присед боевой стойки (y) + баланс качкой
    let crouch = 0;
    if (d.pose === 'combat') crouch = 0.055 + (d.poseT % 2.8 > 2.2 ? 0.03 : 0);
    pj.pelvis.position.y = d.pelvisBaseY - crouch - flex * 0.05;
    apply(pj.pelvis, 'pelvis');
    // компенсация крена ПОВЕРХ позы (в интерактивных режимах)
    pj.spine.rotation.z += -roll * 0.5;
    pj.kneeL.rotation.x += flex * 0.3;
    pj.kneeR.rotation.x += flex * 0.25;
    pj.ankL.rotation.x += -flex * 0.12;
    pj.ankR.rotation.x += -flex * 0.1;
  }
}

/** Треугольники группы (телеметрия детализации, e2e) */
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
