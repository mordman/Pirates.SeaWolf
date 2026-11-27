// ============================================================
// Task 82: ПРОЦЕДУРНАЯ ДРЕВЕСИНА (шейдер поверх MeshStandardMaterial).
//
// До Task 82 дощатый корпус (режим «planks» — режим по умолчанию)
// рисовался только ВЕРШИННЫМИ ЦВЕТАМИ: плоские доски без волокон,
// без конопаченых пазов, без окраски вельсов и ватерлинии (роспись
// была только в «гладком» корпусе, спрятанном за настройкой).
//
// Здесь материалу стандарта (PBR-свет, тени, туман, карта окружения
// сохраняются) через onBeforeCompile добавляется процедурная
// древесина по ЛОКАЛЬНЫМ координатам корабля:
//   • волокна и годичные кольца вдоль доски, посерение от солнца;
//   • пазы (конопачение) у кромок, «фаска» нахлёста, нагели;
//   • окраска по высоте: вельс, пояс у планширя, полосы пресета;
//   • ПОРТЫ закрытых батарей: тёмный проём с рамкой (в дощатой
//     модели за крышкой не было отверстия — «квадрат на стене»);
//   • мокрая полоса и ватерлиния: рваная кромка, чёрный пояс,
//     соляной налёт, глянец мокрого дерева.
//
// Варианты: T82_PLANKS — доски PlankSystem (атрибуты aPlank/aPlankN
// пишутся в plankHull.rebuild), T82_WOOD — любая деревянная деталь
// (реквизит, рангоут, планширь): волокна по локальным координатам.
// uWoodOn = 0 выключает эффект без пересборки программы (настройка).
// ============================================================
import * as THREE from 'three';
import { ShipPreset, gunLayout } from './buildShip';

/** хэш/шум/фбм — общий блок для процедурных материалов Task 82 */
export const NOISE_GLSL = /* glsl */`
float t82hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float t82vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(t82hash(i), t82hash(i + vec2(1.0, 0.0)), f.x),
             mix(t82hash(i + vec2(0.0, 1.0)), t82hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float t82fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * t82vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

/** окраска дощатого корпуса (те же пояса, что и в росписи гладкого корпуса) */
export interface PlankPaint {
  L: number; fb: number; beak: boolean;   // седловатость: длина/надводный борт/бакштевень
  waleCol: number;                                   // цвет вельса/пояса планширя
  stripes: { y0: number; y1: number; color: number }[];
  ports: { z: number; y: number }[];
  portSize: THREE.Vector2;                         // полуширина/полувысота порта
  portFrameCol: number;
  hullCol: number; deckCol: number; draft: number;
}

const MAX_PORTS = 32; // Task 84: жемчужина — 26 закрытых орудий (2 дека), прежний лимит 16 резал второй ряд портов
const MAX_STRIPES = 4;

/** схему окраски из пресета (по высотам hullDeco.makeHullTextures) */
export function plankPaint(P: ShipPreset): PlankPaint {
  const F = P.freeboard;
  const trim = new THREE.Color(P.colors.trim);
  const trimDark = trim.r + trim.g + trim.b < 0.2;
  const lidH = Math.min(0.52, Math.max(0.40, F * 0.095));
  return {
    // Task 82: вельс и пояс планширя следуют СЕДЛОВАТОСТИ борта (в GLSL —
    // аппроксимация bulwark(t)): прежние ФИКСИРОВАННЫЕ полосы y 1.67–3.3
    // заливали весь верх одним цветом — «монотонная тёмная масса» (VLM)
    L: P.length, fb: F, beak: !!P.beakhead,
    waleCol: P.colors.trim,
    stripes: (P.stripes ?? []).slice(0, MAX_STRIPES).map(st => ({ y0: st.y0 * F, y1: st.y1 * F, color: st.color })),
    ports: gunLayout(P).filter(s => s.tier > 0).slice(0, MAX_PORTS).map(s => ({ z: s.z, y: s.y })),
    // крышки портов: BoxGeometry(0.06, lidH, 0.66) — рамка на 7 см шире
    portSize: new THREE.Vector2(0.33, lidH / 2),
    // рамка порта: тёмная отделка → тёплая охристая (читается на тёмном
    // борту); светлая (золото/белила) — затемнённая, чтобы не «горела»
    portFrameCol: trimDark ? 0x7a4a26 : trim.clone().multiplyScalar(0.55).getHex(),
    hullCol: P.colors.hull, deckCol: P.colors.deck, draft: P.draft,
  };
}

const VERT_DECL = /* glsl */`
varying vec2 vWuv;
varying vec3 vLocalPos;
varying vec3 vObjN;
#ifdef T82_PLANKS
attribute vec4 aPlank;      // (ширина, длина, seed доски, класс 0 борт/1 палуба/2 транец)
attribute vec4 aPlankN;     // xyz — нормаль ЛИЦЕВОЙ грани доски (координаты корабля), w — тон доски
varying vec4 vPlank;
varying vec4 vPlankN;
#endif
`;

const VERT_BODY = /* glsl */`
vWuv = uv; vLocalPos = position; vObjN = normal;
#ifdef T82_PLANKS
vPlank = aPlank; vPlankN = aPlankN;
#endif
`;

const FRAG_DECL = /* glsl */`
uniform float uWoodOn;
varying vec2 vWuv;
varying vec3 vLocalPos;
varying vec3 vObjN;
#ifdef T82_PLANKS
uniform float uLen, uFb, uBeak, uWaterY, uPortN, uStripeN, uDraft;
uniform vec3 uWaleCol, uPortFrameCol, uPortInCol, uHullCol, uDeckCol, uWlCol;
uniform vec2 uPortSize;
uniform vec2 uStripeY[${MAX_STRIPES}];
uniform vec3 uStripeCol[${MAX_STRIPES}];
uniform vec2 uPorts[${MAX_PORTS}];
varying vec4 vPlank;
varying vec4 vPlankN;
#endif
${NOISE_GLSL}
`;

/** тело: пишет diffuseColor.rgb и t82rough (множитель шероховатости) */
const FRAG_BODY = /* glsl */`
float t82rough = 1.0;
if (uWoodOn > 0.5) {
  vec3 t82n = normalize(vObjN);
#ifdef T82_PLANKS
  vec4 pk = vPlank;
  float w = max(pk.x, 0.05), ln = max(pk.y, 0.1), sd = pk.z;
  float cls = pk.w;
  float isDeck = step(0.5, cls) * (1.0 - step(1.5, cls));
  float isTransom = step(1.5, cls);
  // лицевая грань доски (наружная / верх палубной доски)
  float show = smoothstep(0.45, 0.75, dot(normalize(vPlankN.xyz + vec3(1e-5, 0.0, 0.0)), t82n));
  float e = min(vWuv.y, w - vWuv.y);
  float b = min(vWuv.x, ln - vWuv.x);
  float edge = min(e, b);
  // базовый цвет доски (та же формула, что в plankHull) → множитель
  // состояния (скол/трещина), чтобы окраска не скрывала разрушение
  float wlMix = clamp((0.05 - vLocalPos.y) / max(0.8, uDraft * 0.45), 0.0, 1.0) * 0.82;
  vec3 base = isDeck > 0.5 ? uDeckCol : mix(uHullCol, uWlCol, wlMix);
  vec3 tint = diffuseColor.rgb / max(base * vPlankN.w, vec3(1e-4));
  // волокна вдоль доски + годичные кольца + выгорание
  vec2 gA = vec2(vWuv.x * 0.45 + sd * 37.0, vWuv.y * 11.0 + sd * 91.0);
  vec2 gB = vec2(vLocalPos.z * 0.45 + sd * 37.0, (vLocalPos.x + vLocalPos.y) * 11.0 + sd * 91.0);
  float fibers = mix(0.6 * t82fbm(gB) + 0.4 * t82fbm(gB.yx), t82fbm(gA), show);
  float fine = t82vnoise(vec2(vWuv.x * 0.9 + sd * 11.0, vWuv.y * 60.0));
  float ring = smoothstep(0.60, 0.78, t82vnoise(vec2(vWuv.y * 5.0 + sd * 5.0, vWuv.x * 0.22 + sd * 3.0)));
  float grain = (0.80 + 0.30 * fibers + 0.10 * fine) * (1.0 - 0.12 * ring);
  float wpn = t82fbm(vLocalPos.xz * 0.55 + vLocalPos.y * 0.8);
  vec3 col = diffuseColor.rgb * grain * (0.92 + 0.16 * wpn);
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(lum) * vec3(1.06, 1.02, 0.94), 0.22 * isDeck);
  // паз (конопачение) и «фаска» нахлёста — только на лицевой грани;
  // Task 82: фаска усилена — линия нахлёста поясов читается и в краске
  float seam = mix(smoothstep(0.0, 0.016, edge), 1.0, 1.0 - show);
  float bevel = mix(smoothstep(0.0, 0.05, edge), 1.0, 1.0 - show);
  col *= mix(isDeck > 0.5 ? 0.09 : 0.22, 1.0, seam) * mix(0.72, 1.0, bevel);
  // нагели (деревянные гвозди) у торцов и середины длинных досок
  vec2 tq = vec2(min(vWuv.x, ln - vWuv.x), vWuv.y);
  float tn = 1.0 - smoothstep(0.013, 0.021, length(tq - vec2(0.17, w * 0.30)));
  tn = max(tn, 1.0 - smoothstep(0.013, 0.021, length(tq - vec2(0.17, w * 0.70))));
  tn = max(tn, 1.0 - smoothstep(0.013, 0.021, length(tq - vec2(0.5 * ln, w * 0.30))));
  tn = max(tn, 1.0 - smoothstep(0.013, 0.021, length(tq - vec2(0.5 * ln, w * 0.70))));
  col *= 1.0 - 0.40 * tn * show;
  float y = vLocalPos.y;
  float lx = isTransom > 0.5 ? vLocalPos.x : vLocalPos.z;
  float paint = 0.0;
  if (isDeck < 0.5) {
    // Task 82: СЕДЛОВАТОСТЬ борта — аппроксимация bulwark(t) в GLSL
    // (та же формула, что в buildShip.hullProfile): вельс и пояс под
    // планширем поднимаются к носу и корме ВМЕСТЕ с бортом. Прежде
    // полосы шли на ФИКСИРОВАННОЙ высоте: у носа пояс планширя
    // опускался на середину борта, у миделя заливал весь верх —
    // «монотонная тёмная масса» без читаемых поясов (VLM)
    float t = clamp((vLocalPos.z + 0.5 * uLen) / uLen, 0.0, 1.0);
    float sheer = uFb * (uBeak > 0.5
      ? (0.85 + 0.36 * pow(1.0 - t, 2.4) + 0.08 * pow(max(0.0, t - 0.7) / 0.3, 2.0))
      : (0.82 + 0.35 * pow(max(0.0, t - 0.75) / 0.25, 1.4) + 0.5 * pow(1.0 - t, 2.2) * 0.6));
    float aaY = fwidth(y) + 1e-4;
    // вельс — у кромки настила (sheer − 1.0); пояс планширя — верхний
    float waleA = sheer - 1.35, waleB = sheer - 0.90;
    float railA = sheer - 0.42, railB = sheer - 0.04;
    float bw = smoothstep(waleA - aaY, waleA + aaY, y) * (1.0 - smoothstep(waleB - aaY, waleB + aaY, y));
    float br = smoothstep(railA - aaY, railA + aaY, y) * (1.0 - smoothstep(railB - aaY, railB + aaY, y));
    vec3 pc = uWaleCol;
    paint = max(bw, br * 0.85);
    for (int i = 0; i < ${MAX_STRIPES}; i++) {
      if (float(i) >= uStripeN) break;
      float bs = smoothstep(uStripeY[i].x - aaY, uStripeY[i].x + aaY, y)
               * (1.0 - smoothstep(uStripeY[i].y - aaY, uStripeY[i].y + aaY, y));
      pc = mix(pc, uStripeCol[i], step(0.5, bs));
      paint = max(paint, bs);
    }
    // крашеная доска: волокна просвечивают, ПАЗЫ читаются и в краске
    // (Task 82: контраст паза в краске усилен с 12% до 45% — пояса
    // читались только на некрашеном дереве)
    vec3 painted = pc * (0.78 + 0.30 * grain) * (0.92 + 0.14 * wpn) * mix(0.55, 1.0, seam) * tint;
    col = mix(col, painted, paint * mix(0.55, 1.0, seam));
    // Task 84: ПОТЁКИ — дождевые ручьи под планширем/вельсом: узкая
    // зона под верхней кромкой, внутри — вертикальные тёмные колонки
    // (шум закреплён по горизонтали, тянется вниз): живая «убитая
    // погодой» обшивка вместо стерильной краски
    float dripZone = smoothstep(sheer - 1.85, sheer - 1.25, y)
                   * (1.0 - smoothstep(sheer - 0.45, sheer - 0.15, y));
    float dripCol = t82vnoise(vec2(lx * 2.1, 1.7));
    float drip = dripZone * smoothstep(0.45, 0.8, dripCol) * 0.13;
    col *= 1.0 - drip;
    // ПОРТЫ закрытых батарей: проём + рамка
    if (uPortN > 0.5) {
      vec2 lp = vec2(lx, y);
      float aaP = fwidth(lp.x) + fwidth(lp.y) + 1e-4;
      float inn = 0.0, frm = 0.0;
      for (int i = 0; i < ${MAX_PORTS}; i++) {
        if (float(i) >= uPortN) break;
        vec2 d = abs(lp - uPorts[i]);
        float a1 = 1.0 - smoothstep(uPortSize.x - aaP, uPortSize.x + aaP, d.x);
        float a2 = 1.0 - smoothstep(uPortSize.y - aaP, uPortSize.y + aaP, d.y);
        inn = max(inn, a1 * a2);
        float f1 = 1.0 - smoothstep(uPortSize.x + 0.07 - aaP, uPortSize.x + 0.07 + aaP, d.x);
        float f2 = 1.0 - smoothstep(uPortSize.y + 0.07 - aaP, uPortSize.y + 0.07 + aaP, d.y);
        frm = max(frm, f1 * f2);
      }
      col = mix(col, uPortFrameCol * (0.85 + 0.2 * grain) * (0.92 + 0.14 * wpn) * tint, frm * show);
      col = mix(col, uPortInCol, inn);
    }
    // ватерлиния: рваная кромка мокрой полосы, чёрный пояс, налёт соли
    float wl = uWaterY + (t82vnoise(vec2(lx * 1.3, isTransom * 50.0 + 3.0)) - 0.5) * 0.08;
    float wet = 1.0 - smoothstep(0.0, 0.55, y - wl);
    float boot = smoothstep(wl - 0.10, wl - 0.06, y) * (1.0 - smoothstep(wl + 0.06, wl + 0.10, y));
    float salt = smoothstep(wl + 0.20, wl + 0.50, y) * (1.0 - smoothstep(wl + 0.50, wl + 1.0, y)) * (1.0 - paint);
    col *= mix(1.0, 0.66, wet);
    col = mix(col, vec3(0.03, 0.03, 0.035), boot);
    col = mix(col, col * vec3(1.12, 1.10, 1.04), salt * 0.5 * show);
    t82rough = mix(1.0, 0.42, wet);
  }
  diffuseColor.rgb = clamp(col, vec3(0.0), vec3(4.0));
#else
  // произвольная деревянная деталь: проекция по доминирующей нормали,
  // волокна — вдоль «длинной» оси грани (T82_AXIS_Y — вдоль местной Y:
  // мачты/реи — ствол отдельной деталью)
  vec3 an = abs(t82n);
  vec2 pp = (an.y > max(an.x, an.z)) ? vec2(vLocalPos.x, vLocalPos.z)
          : (an.x > an.z) ? vec2(vLocalPos.z, vLocalPos.y) : vec2(vLocalPos.x, vLocalPos.y);
#ifdef T82_AXIS_Y
  pp = vec2(vLocalPos.x + vLocalPos.z, vLocalPos.y);
#endif
  float fibers = t82fbm(vec2(pp.y * 0.45, pp.x * 12.0));
  float fine = t82vnoise(vec2(pp.y * 1.1, pp.x * 55.0));
  float wpn = t82fbm(vLocalPos.xz * 0.5 + vLocalPos.y * 0.7);
  diffuseColor.rgb *= (0.82 + 0.28 * fibers + 0.10 * fine) * (0.92 + 0.16 * wpn);
#endif
}
`;

const ROUGH_TAIL = /* glsl */`
roughnessFactor = clamp(roughnessFactor * t82rough, 0.05, 1.0);
`;

function inject(mat: THREE.MeshStandardMaterial, define: string, uni: Record<string, THREE.IUniform>, key: string) {
  mat.defines = { ...(mat.defines ?? {}), [define]: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uni);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <roughnessmap_fragment>', `${FRAG_BODY}\n#include <roughnessmap_fragment>\n${ROUGH_TAIL}`);
  };
  mat.customProgramCacheKey = () => key;
  mat.userData.t82 = uni;
  mat.needsUpdate = true;
  return uni;
}

/** дощатый корпус/палуба (PlankSystem.mat) */
export function applyPlankShader(mat: THREE.MeshStandardMaterial, paint: PlankPaint) {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  return inject(mat, 'T82_PLANKS', {
    uWoodOn: { value: 1 },
    uLen: { value: paint.L }, uFb: { value: paint.fb },
    uBeak: { value: paint.beak ? 1 : 0 },
    uWaleCol: { value: new THREE.Color(paint.waleCol) },
    uWaterY: { value: 0.02 },
    uStripeY: { value: range(MAX_STRIPES).map(i => new THREE.Vector2(paint.stripes[i]?.y0 ?? 0, paint.stripes[i]?.y1 ?? 0)) },
    uStripeCol: { value: range(MAX_STRIPES).map(i => new THREE.Color(paint.stripes[i]?.color ?? 0x000000)) },
    uStripeN: { value: paint.stripes.length },
    uPorts: { value: range(MAX_PORTS).map(i => new THREE.Vector2(paint.ports[i]?.z ?? 0, paint.ports[i]?.y ?? 0)) },
    uPortN: { value: paint.ports.length },
    uPortSize: { value: paint.portSize },
    uPortFrameCol: { value: new THREE.Color(paint.portFrameCol) },
    uPortInCol: { value: new THREE.Color(0x1c0705) },
    uHullCol: { value: new THREE.Color(paint.hullCol) },
    uDeckCol: { value: new THREE.Color(paint.deckCol) },
    uWlCol: { value: new THREE.Color(0x33402a) },
    uDraft: { value: paint.draft },
  }, 't82planks');
}

/** деревянная деталь без атрибутов досок (реквизит, планширь, рангоут).
 *  axisY: волокна вдоль местной оси Y (цилиндры мачт/реев) */
export function applyWoodShader(mat: THREE.MeshStandardMaterial, axisY = false) {
  if (axisY) mat.defines = { ...(mat.defines ?? {}), T82_AXIS_Y: '' };
  return inject(mat, 'T82_WOOD', { uWoodOn: { value: 1 } }, axisY ? 't82woody' : 't82wood');
}
