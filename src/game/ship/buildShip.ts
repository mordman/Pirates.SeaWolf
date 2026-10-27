import * as THREE from 'three';

// ============================================================
// Процедурная постройка кораблей (исторические силуэты):
// шлюп (игрок), флейт (торговец), бриг (патруль).
// Корпус — по шпангоутам, паруса — шейдер с «пузом»,
// такелаж — линиями. Все размеры в метрах, 1u = 1м.
// ============================================================

export interface ShipPreset {
  id: string;
  name: string;
  length: number; beam: number; draft: number; freeboard: number;
  masts: 2 | 3;
  gunsPerSide: number;
  mass: number;          // кг
  maxSpeed: number;      // м/с
  hullHP: number; sailHP: number; maxCrew: number;
  cargo: number;         // грузоподъёмность, т
  colors: { hull: number; deck: number; trim: number; sail: number };
  flagKind: 'pirate' | 'merchant' | 'navy';
}

export const PRESETS: Record<string, ShipPreset> = {
  sloop: {
    id: 'sloop', name: 'Шлюп «Бриз»',
    length: 28, beam: 7.4, draft: 2.2, freeboard: 2.7,
    masts: 2, gunsPerSide: 5,
    mass: 150_000, maxSpeed: 8.8,
    hullHP: 100, sailHP: 100, maxCrew: 24, cargo: 60,
    colors: { hull: 0x5c4326, deck: 0xa8895f, trim: 0x2e2013, sail: 0xe9dcc2 },
    flagKind: 'pirate',
  },
  fluyt: {
    id: 'fluyt', name: 'Флейт «Морская корова»',
    length: 36, beam: 8.8, draft: 3.1, freeboard: 3.0,
    masts: 3, gunsPerSide: 3,
    mass: 360_000, maxSpeed: 5.6,
    hullHP: 150, sailHP: 110, maxCrew: 20, cargo: 220,
    colors: { hull: 0x4a3a2a, deck: 0x9d8158, trim: 0x241a10, sail: 0xd8cbae },
    flagKind: 'merchant',
  },
  brig: {
    id: 'brig', name: 'Бриг «Ревнитель»',
    length: 31, beam: 8.4, draft: 2.8, freeboard: 2.9,
    masts: 2, gunsPerSide: 7,
    mass: 280_000, maxSpeed: 7.6,
    hullHP: 180, sailHP: 120, maxCrew: 60, cargo: 90,
    colors: { hull: 0x3d3d46, deck: 0x8f7752, trim: 0x1c1c22, sail: 0xdfd6bd },
    flagKind: 'navy',
  },
};

export interface ShipVisual {
  group: THREE.Group;
  sails: SailRig;
  gunsPort: THREE.Object3D[];
  gunsStarboard: THREE.Object3D[];
  flag: THREE.Mesh;
  flagMat: THREE.ShaderMaterial;
  dims: { length: number; beam: number; draft: number };
  outline: THREE.Vector2[];       // контур ватерлинии (для пены)
  masts: THREE.Object3D[];        // для ломания мачт
  lantern?: THREE.PointLight;
  wheel: THREE.Object3D;
}

export interface SailRig {
  sails: SailInfo[];
}
interface SailInfo {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;      // свой материал на парус (своё рифление uFurl)
  brace?: THREE.Group;            // поворотная группа (рея+парус) — брасопка
  setAt: number;                  // доля тяги (sailFrac), при которой парус ПОЛНОСТЬЮ поставлен
  furl: number;                   // текущее рифление 0..1 (анимируется, 1 = убран)
  square: boolean;                // квадратный парус (рея брасопится)
  braceAngle: number;             // текущий угол брасопки (рад)
}

// ---------- шейдер паруса ----------
function sailMaterial(baseColor: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBelly: { value: 0.5 },
      uFlutter: { value: 0.3 },
      uTime: { value: 0 },
      uDamage: { value: 0 },
      uColor: { value: new THREE.Color(baseColor) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uFurl: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uBelly, uTime, uFurl, uFlutter;
      varying vec2 vUv;
      varying vec3 vN;
      varying float vDmgU;
      uniform float uDamage;
      void main() {
        vUv = uv;
        vDmgU = uDamage;
        vec3 p = position;
        // «пузо» паруса: синус по ширине и высоте, кромки закреплены.
        // uBelly задан на CPU с учётом ветра и степени постановки
        float belly = uBelly * sin(uv.x * 3.14159) * sin(uv.y * 3.14159);
        // трепет свободной кромки: две волны, сильнее при слабом пузе (флюктер)
        float flut = uFlutter * (
          sin(uv.x * 9.0 + uTime * 7.3) * 0.6 +
          sin(uv.x * 17.0 - uTime * 11.7) * 0.4
        ) * sin(uv.y * 3.14159) * (1.0 - uv.y * 0.75);
        float dz = belly + flut;
        p.z += dz;
        // нормаль аналитически (по пуза)
        float dzu = uBelly * cos(uv.x * 3.14159) * 3.14159 * sin(uv.y * 3.14159);
        float dzv = uBelly * sin(uv.x * 3.14159) * 3.14159 * cos(uv.y * 3.14159);
        vN = normalize(vec3(-dzu * 0.35, -dzv * 0.35, 1.0));
        // рифление: при uFurl парус собирается к рее/штагу
        p.y *= mix(1.0, 0.10, uFurl);
        p.x *= mix(1.0, 0.55, uFurl);
        p.z *= mix(1.0, 0.08, uFurl);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      varying float vDmgU;
      uniform vec3 uColor;
      uniform vec3 uSunDir;
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
      void main() {
        vec3 col = uColor;
        // швы (горизонтальные полотнища)
        float seams = smoothstep(0.035, 0.0, abs(fract(vUv.y * 5.0) - 0.5) - 0.46);
        col *= 1.0 - seams * 0.16;
        // заплатки и рваные края от повреждений
        float dmg = vDmgU;
        float patches = step(0.55, vnoise(vUv * 4.7 + 7.3)) * dmg;
        col = mix(col, col * 0.55, patches);
        float holes = step(0.82 - dmg * 0.15, vnoise(vUv * 7.1 + 2.9)) * dmg * 1.4;
        // простое освещение
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0) * 0.5 + 0.55;
        col *= ndl;
        float a = 1.0 - clamp(holes, 0.0, 0.9);
        if (a < 0.55) discard; // дыры — без полупрозрачности (нет проблем сортировки)
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// ---------- флаг ----------
function makeFlagTexture(kind: 'pirate' | 'merchant' | 'navy'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const x = c.getContext('2d')!;
  if (kind === 'pirate') {
    x.fillStyle = '#14100c'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#e8e4d8';
    x.beginPath(); x.arc(64, 34, 13, 0, Math.PI * 2); x.fill(); // череп
    x.fillStyle = '#14100c';
    x.beginPath(); x.arc(59, 32, 3, 0, Math.PI * 2); x.arc(69, 32, 3, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8e4d8';
    x.save(); x.translate(64, 52); x.rotate(0.5); x.fillRect(-26, -2.5, 52, 5); x.restore();
    x.save(); x.translate(64, 52); x.rotate(-0.5); x.fillRect(-26, -2.5, 52, 5); x.restore();
  } else if (kind === 'merchant') {
    x.fillStyle = '#efe7d2'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#a3362c'; x.fillRect(0, 32, 128, 16);
  } else {
    x.fillStyle = '#efe7d2'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#a3362c';
    x.fillRect(56, 0, 16, 80); x.fillRect(0, 32, 128, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flagMesh(kind: 'pirate' | 'merchant' | 'navy'): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const g = new THREE.PlaneGeometry(2.0, 1.2, 12, 5);
  g.translate(1.0, 0, 0); // крепление у древка (x=0)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTex: { value: makeFlagTexture(kind) } },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 3.0 - uTime * 7.0) * 0.12 * p.x + sin(p.x * 6.0 - uTime * 11.0) * 0.05 * p.x;
        p.z += w; p.y += sin(p.x * 2.0 - uTime * 5.0) * 0.04 * p.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    `,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ---------- корпус по шпангоутам ----------
function hullProfile(t: number, P: ShipPreset) {
  // t: 0 корма -> 1 нос. Полуширина, осадка, высота фальшборта
  const B = P.beam / 2;
  let w: number;
  if (t < 0.45) w = THREE.MathUtils.lerp(0.58, 1.0, smooth01(t / 0.45));
  else w = THREE.MathUtils.lerp(1.0, 0.0, Math.pow(smooth01((t - 0.45) / 0.55), 0.75));
  const draft = P.draft * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
  const bulwark = P.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.4) + 0.5 * Math.pow(1 - t, 2.2) * 0.6);
  return { w: w * B, draft, bulwark };
}
function smooth01(x: number) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }

function buildHull(P: ShipPreset): { geometry: THREE.BufferGeometry; outline: THREE.Vector2[] } {
  const S = 26, R = 8;
  const L = P.length;
  const pos: number[] = [];
  const col: number[] = [];
  const cHull = new THREE.Color(P.colors.hull);
  const cBelow = new THREE.Color(0x33402a); // подводная часть — обрастание
  const cBoot = new THREE.Color(0xd8d2c2); // пояс ватерлинии
  const cWale = new THREE.Color(P.colors.trim);
  const tmp = new THREE.Color();

  const stations: { z: number; w: number; draft: number; bulwark: number }[] = [];
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const p = hullProfile(t, P);
    stations.push({ z: THREE.MathUtils.lerp(-L / 2, L / 2, t), w: p.w, draft: p.draft, bulwark: p.bulwark });
  }

  const pushPoint = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    // раскраска по высоте
    if (y < -0.15) tmp.copy(cHull).lerp(cBelow, Math.min(1, (-y + 0.15) / P.draft));
    else if (y < 0.42) tmp.copy(cBoot);
    else if (y > 0.9 && y < 1.35) tmp.copy(cWale);
    else tmp.copy(cHull);
    // лёгкая полосатость обшивки
    const stripe = 1.0 - 0.06 * (Math.sin(y * 9.0) * 0.5 + 0.5);
    col.push(tmp.r * stripe, tmp.g * stripe, tmp.b * stripe);
  };

  for (const st of stations) {
    for (let r = 0; r <= R; r++) {
      const u = r / R;
      const y = THREE.MathUtils.lerp(-st.draft, st.bulwark, u);
      const flare = Math.pow(u, 0.6);
      const halfW = st.w * (0.16 + 0.84 * flare);
      pushPoint(halfW, y, st.z);
      pushPoint(-halfW, y, st.z);
    }
  }
  const idx: number[] = [];
  const rowLen = (R + 1) * 2;
  for (let s = 0; s < S; s++) {
    for (let r = 0; r < R; r++) {
      const a = s * rowLen + r * 2, b = a + 1, c = a + 2, d = a + 3;
      const e = a + rowLen, f = e + 1, g = e + 2, h = e + 3;
      idx.push(a, c, e, c, g, e);
      idx.push(b, e + 1, d, b, f, d); // зеркальная сторона (обратный порядок)
    }
  }
  // транцевая корма: веер
  const st0 = stations[0];
  const centerIdx = pos.length / 3;
  pushPoint(0, -st0.draft * 0.55, st0.z - 0.01);
  for (let r = 0; r <= R; r++) {
    const i0 = r * 2;
    if (r < R) {
      idx.push(centerIdx, i0 + 1, i0); // ориентация наружу (-Z)
    }
  }
  // днище: замыкаем корпус снизу (r=0 — нижняя кромка шпангоутов),
  // нормали вниз — при крене/под водой не «просвечивает»
  for (let s = 0; s < S; s++) {
    const a = s * rowLen + 1;        // левый борт, низ
    const b = s * rowLen;            // правый борт, низ
    const c = (s + 1) * rowLen + 1;
    const d = (s + 1) * rowLen;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // контур ватерлинии
  const outline: THREE.Vector2[] = [];
  for (let s = 0; s <= S; s += 2) {
    const st = stations[s];
    const u = (st.draft) / (st.draft + st.bulwark); // u при y=0
    const flare = Math.pow(u, 0.6);
    const halfW = Math.max(0.25, st.w * (0.16 + 0.84 * flare));
    outline.push(new THREE.Vector2(halfW, st.z));
  }
  for (let s = S; s >= 0; s -= 2) {
    const st = stations[s];
    const u = st.draft / (st.draft + st.bulwark);
    const flare = Math.pow(u, 0.6);
    const halfW = Math.max(0.25, st.w * (0.16 + 0.84 * flare));
    outline.push(new THREE.Vector2(-halfW, st.z));
  }
  return { geometry: g, outline };
}

function buildDeck(P: ShipPreset): THREE.BufferGeometry {
  // палуба: полоса по длине чуть ниже фальшборта, вплотную к обшивке.
  // ВАЖНО: порядок вершин (a,b,c)(b,d,c) даёт нормали ВВЕРХ —
  // иначе палуба отсекается backface-куллингом и «просвечивает».
  // UV: u — поперёк (0..1 = полная ширина), v — вдоль (тайл = ширина),
  // доски идут вдоль корпуса, у краёв — тёмный водосток (в текстуре).
  const S = 20, L = P.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const p = hullProfile(t, P);
    const z = THREE.MathUtils.lerp(-L / 2, L / 2, t);
    const deckY = p.bulwark - 1.0;
    // полуширина корпуса на высоте палубы — та же формула, что в buildHull,
    // чтобы палуба доходила до борта без щели
    const u = Math.min(1, Math.max(0, (deckY + p.draft) / (p.draft + p.bulwark)));
    const flare = Math.pow(u, 0.6);
    const w = Math.max(0.15, p.w * (0.16 + 0.84 * flare) - 0.05);
    pos.push(w, deckY, z, -w, deckY, z);
    const vv = z / P.beam;
    uv.push(0.5 + w / P.beam, vv, 0.5 - w / P.beam, vv);
  }
  for (let s = 0; s < S; s++) {
    const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Текстура палубных досок: конопаченые швы, разбежка стыков, гвозди,
 *  волокна, потёртости; тёмные водосточные планки по краям (u≈0 и u≈1) */
function makeDeckTexture(baseColor: number, seed: number): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d')!;
  const base = new THREE.Color(baseColor);
  let rs = seed * 2654435761 % 2147483647;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const N = 30, pw = S / N;
  for (let i = 0; i < N; i++) {
    const v = 0.84 + rnd() * 0.26;
    x.fillStyle = `rgb(${Math.round(base.r * 255 * v)},${Math.round(base.g * 255 * v)},${Math.round(base.b * 255 * v)})`;
    x.fillRect(i * pw, 0, pw + 1, S);
    // волокна дерева
    x.strokeStyle = 'rgba(30,18,8,0.10)';
    x.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const gx = i * pw + pw * (0.2 + 0.6 * rnd());
      x.beginPath();
      x.moveTo(gx, 0);
      for (let y = 0; y <= S; y += 32) x.lineTo(gx + Math.sin(y * 0.045 + i * 7 + k * 3) * 2.2, y);
      x.stroke();
    }
    // стыки досок с разбежкой + гвозди
    const b1 = (i * 137 + 61) % S, b2 = (b1 + Math.round(S * 0.55)) % S;
    for (const by of [b1, b2]) {
      x.fillStyle = 'rgba(22,14,7,0.6)';
      x.fillRect(i * pw, by, pw + 1, 2);
      x.fillStyle = 'rgba(32,32,36,0.85)';
      x.beginPath(); x.arc(i * pw + pw * 0.3, by + 5, 1.4, 0, 7); x.fill();
      x.beginPath(); x.arc(i * pw + pw * 0.7, by - 3, 1.4, 0, 7); x.fill();
    }
    // конопаченый шов между досками
    x.fillStyle = 'rgba(20,13,7,0.72)';
    x.fillRect(i * pw, 0, 1.6, S);
  }
  // водосточный жёлоб по краям палубы (тёмные продольные планки)
  for (const [x0, wW] of [[0, S * 0.075], [S * 0.925, S * 0.075]] as [number, number][]) {
    const gr = x.createLinearGradient(x0, 0, x0 + wW, 0);
    gr.addColorStop(0, 'rgba(24,15,7,0.5)');
    gr.addColorStop(1, 'rgba(24,15,7,0.12)');
    x.fillStyle = gr;
    x.fillRect(x0, 0, wW, S);
  }
  // потёртости и разводы
  for (let k = 0; k < 26; k++) {
    const rx = rnd() * S, ry = rnd() * S, rr = 18 + rnd() * 55;
    const rg = x.createRadialGradient(rx, ry, 0, rx, ry, rr);
    rg.addColorStop(0, 'rgba(28,18,8,0.09)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg;
    x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Планширь: планка, закрывающая верхнюю кромку фальшборта */
function buildCapRail(P: ShipPreset): THREE.BufferGeometry {
  const S = 26, L = P.length;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cRail = new THREE.Color(P.colors.trim).multiplyScalar(1.25);
  const cRail2 = new THREE.Color(P.colors.trim);
  const push = (px: number, py: number, z: number, c: THREE.Color) => {
    pos.push(px, py, z); col.push(c.r, c.g, c.b);
  };
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const p = hullProfile(t, P);
    const z = THREE.MathUtils.lerp(-L / 2, L / 2, t);
    const y = p.bulwark;
    // внутренняя и внешняя кромки планки (лёгкий свес наружу)
    push(p.w - 0.26, y + 0.07, z, cRail);
    push(p.w + 0.13, y + 0.015, z, cRail2);
    push(-p.w + 0.26, y + 0.07, z, cRail);
    push(-p.w - 0.13, y + 0.015, z, cRail2);
  }
  for (let s = 0; s < S; s++) {
    const a = s * 4;
    // правый борт
    idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    // левый борт
    idx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Запечь геометрию в общие массивы (для слияния реквизита в один меш) */
function bakeInto(target: { pos: number[]; col: number[] }, geo: THREE.BufferGeometry,
  color: THREE.Color, x: number, y: number, z: number, euler?: THREE.Euler) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (euler) v.applyEuler(euler);
    target.pos.push(v.x + x, v.y + y, v.z + z);
    target.col.push(color.r, color.g, color.b);
  }
}

/** Палубный реквизит: решётчатый люк, бочки, канаты, кнехты, колокол,
 *  ядра, сундук, ведро — всё сливается в ОДИН меш с vertex colors */
function buildDeckProps(P: ShipPreset): THREE.BufferGeometry {
  const L = P.length;
  const t: { pos: number[]; col: number[] } = { pos: [], col: [] };
  const deckYAt = (tt: number) => hullProfile(tt, P).bulwark - 1.0;
  const cWood = new THREE.Color(0x7a5c38);
  const cWoodD = new THREE.Color(0x4a3420);
  const cDark = new THREE.Color(P.colors.trim);
  const cIron = new THREE.Color(0x24262b);
  const cBrass = new THREE.Color(0xb8912f);
  const cRope = new THREE.Color(0xa08656);
  const cBarrel = new THREE.Color(0x8a6a42);

  // --- решётчатый люк (гратинг) с коомингом ---
  const hx = L * 0.08, hz = L * 0.05; // пол-размера (между мачтами)
  const hy = deckYAt(0.48);
  // кооминг (рамка)
  bakeInto(t, new THREE.BoxGeometry(hx * 2 + 0.24, 0.22, 0.12), cWoodD, 0, hy + 0.11, hz);
  bakeInto(t, new THREE.BoxGeometry(hx * 2 + 0.24, 0.22, 0.12), cWoodD, 0, hy + 0.11, -hz);
  bakeInto(t, new THREE.BoxGeometry(0.12, 0.22, hz * 2), cWoodD, hx, hy + 0.11, 0);
  bakeInto(t, new THREE.BoxGeometry(0.12, 0.22, hz * 2), cWoodD, -hx, hy + 0.11, 0);
  // продольные планки
  const nL = 9;
  for (let i = 0; i < nL; i++) {
    const px = -hx + 0.12 + (i / (nL - 1)) * (hx * 2 - 0.24);
    bakeInto(t, new THREE.BoxGeometry(0.09, 0.07, hz * 2 - 0.1), cWood, px, hy + 0.24, 0);
  }
  // поперечные планки
  const nT = 5;
  for (let i = 0; i < nT; i++) {
    const pz = -hz + 0.1 + (i / (nT - 1)) * (hz * 2 - 0.2);
    bakeInto(t, new THREE.BoxGeometry(hx * 2 - 0.16, 0.07, 0.09), cWood, 0, hy + 0.30, pz);
  }

  // --- бочки (2 стоя, 1 лёжа) ---
  const barrelG = new THREE.CylinderGeometry(0.34, 0.34, 0.8, 10);
  const hoopG = new THREE.TorusGeometry(0.345, 0.022, 5, 12);
  const hoopE = new THREE.Euler(Math.PI / 2, 0, 0);
  const mkBarrel = (x: number, z: number, lying = false) => {
    const y = deckYAt(0.5 + z / L) + (lying ? 0.34 : 0.4);
    const e = lying ? new THREE.Euler(0, lying ? 0.7 : 0, Math.PI / 2) : undefined;
    bakeInto(t, barrelG, cBarrel, x, y, z, e);
    if (lying) {
      bakeInto(t, hoopG, cIron, x, y - 0.25, z, e);
      bakeInto(t, hoopG, cIron, x, y + 0.25, z, e);
    } else {
      bakeInto(t, hoopG, cIron, x, y - 0.28, z, hoopE);
      bakeInto(t, hoopG, cIron, x, y + 0.28, z, hoopE);
    }
  };
  mkBarrel(P.beam * 0.24, L * 0.10);
  mkBarrel(-P.beam * 0.26, L * 0.04);
  mkBarrel(P.beam * 0.22, -L * 0.12, true);
  // --- бухты канатов ---
  const coilG = new THREE.TorusGeometry(0.30, 0.10, 6, 14);
  const coilE = new THREE.Euler(Math.PI / 2, 0, 0);
  bakeInto(t, coilG, cRope, P.beam * 0.20, deckYAt(0.75) + 0.10, L * 0.30, coilE);
  bakeInto(t, coilG, cRope, -P.beam * 0.18, deckYAt(0.62) + 0.10, L * 0.18, coilE);
  bakeInto(t, coilG, cRope, P.beam * 0.34, deckYAt(0.36) + 0.10, -L * 0.15, coilE);

  // --- кнехты (битенги) с поперечиной у носа ---
  const bittG = new THREE.BoxGeometry(0.15, 0.6, 0.15);
  for (const side of [-1, 1]) {
    bakeInto(t, bittG, cWoodD, side * 0.42, deckYAt(0.85) + 0.3, L * 0.36);
    bakeInto(t, bittG, cWoodD, side * 0.42, deckYAt(0.85) + 0.3, L * 0.36 - 0.5);
    bakeInto(t, new THREE.BoxGeometry(0.13, 0.13, 0.75), cWoodD, side * 0.42, deckYAt(0.85) + 0.55, L * 0.36 - 0.25);
  }

  // --- корабельный колокол у штурвала ---
  const bellZ = THREE.MathUtils.lerp(-L / 2, L / 2, 0.2) + 1.6;
  bakeInto(t, new THREE.BoxGeometry(0.12, 0.8, 0.12), cWoodD, 0.8, deckYAt(0.22) + 0.4, bellZ);
  bakeInto(t, new THREE.CylinderGeometry(0.05, 0.13, 0.2, 8), cBrass, 0.8, deckYAt(0.22) + 0.85, bellZ);

  // --- пирамиды ядер у мачты ---
  const ballG = new THREE.SphereGeometry(0.105, 7, 6);
  const pile = (x: number, z: number) => {
    const y0 = deckYAt(0.5 + z / L);
    for (const [dx, dz] of [[-0.115, 0], [0, 0], [0.115, 0], [-0.058, 0.1], [0.058, 0.1], [0, 0.05]]) {
      bakeInto(t, ballG, cIron, x + dx, y0 + 0.105, z + dz);
    }
  };
  pile(0.85, -L * 0.16);
  pile(-P.beam * 0.20, L * 0.09);

  // --- сундук с инструментом ---
  bakeInto(t, new THREE.BoxGeometry(0.72, 0.42, 0.5), cWoodD, -P.beam * 0.26, deckYAt(0.42) + 0.21, -L * 0.2);
  bakeInto(t, new THREE.BoxGeometry(0.78, 0.1, 0.56), cDark, -P.beam * 0.26, deckYAt(0.42) + 0.46, -L * 0.2);

  // --- ведро ---
  bakeInto(t, new THREE.CylinderGeometry(0.17, 0.13, 0.3, 8, 1, true), cWood, -P.beam * 0.2, deckYAt(0.72) + 0.15, L * 0.24);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- такелаж (линии) ----------
function buildRigging(P: ShipPreset, masts: { z: number; h: number }[], bowspritTip: THREE.Vector3): THREE.LineSegments {
  const pts: number[] = [];
  const L = P.length;
  const addLine = (a: THREE.Vector3, b: THREE.Vector3) => { pts.push(a.x, a.y, a.z, b.x, b.y, b.z); };
  for (const m of masts) {
    const top = new THREE.Vector3(0, m.h, m.z);
    // штаги к носу и корме
    addLine(top, bowspritTip);
    addLine(top, new THREE.Vector3(0, 1.2, -L / 2 + 0.4));
    // ванты к бортам
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const zz = m.z - 1.5 + k * 1.5;
        addLine(new THREE.Vector3(side * 2.6, 1.6, zz), new THREE.Vector3(0, m.h * (0.55 + k * 0.15), m.z));
      }
    }
  }
  // бакштаги к корме от грот-мачты
  if (masts.length >= 2) {
    const main = masts[masts.length - 1 > 1 ? masts.length - 2 : 0];
    addLine(new THREE.Vector3(0, main.h * 0.8, main.z), new THREE.Vector3(2.4, 1.4, -L / 2 + 0.3));
    addLine(new THREE.Vector3(0, main.h * 0.8, main.z), new THREE.Vector3(-2.4, 1.4, -L / 2 + 0.3));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x241c12, transparent: true, opacity: 0.85 });
  return new THREE.LineSegments(g, mat);
}

// ---------- полная сборка ----------
export function buildShip(P: ShipPreset): ShipVisual {
  const group = new THREE.Group();
  const L = P.length;

  // корпус
  const { geometry: hullGeo, outline } = buildHull(P);
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = true;
  group.add(hull);

  // палуба: текстура досок с конопачением (DoubleSide — страховка от куллинга)
  const deckMat = new THREE.MeshStandardMaterial({
    map: makeDeckTexture(P.colors.deck, P.colors.deck + P.length),
    roughness: 0.93, side: THREE.DoubleSide,
  });
  const deck = new THREE.Mesh(buildDeck(P), deckMat);
  group.add(deck);

  // планширь по верхней кромке фальшборта
  const capRail = new THREE.Mesh(buildCapRail(P),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }));
  group.add(capRail);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e5433, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: P.colors.trim, roughness: 0.75 });

  // бушприт
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, L * 0.32, 6), woodMat);
  bowsprit.rotation.x = Math.PI / 2 - 0.18;
  bowsprit.position.set(0, P.freeboard * 0.75, L / 2 + L * 0.12);
  group.add(bowsprit);
  const bowspritTip = new THREE.Vector3(0, P.freeboard * 0.75 + L * 0.32 * 0.18, L / 2 + L * 0.12 + L * 0.32 * Math.cos(0.18) * 0.98);

  // мачты
  const mastDefs: { z: number; h: number }[] = [];
  const H = P.freeboard + L * 0.78;
  if (P.masts === 2) {
    mastDefs.push({ z: L * 0.16, h: H * 0.88 });
    mastDefs.push({ z: -L * 0.10, h: H });
  } else {
    mastDefs.push({ z: L * 0.18, h: H * 0.8 });
    mastDefs.push({ z: -L * 0.05, h: H });
    mastDefs.push({ z: -L * 0.28, h: H * 0.62 });
  }
  const masts: THREE.Object3D[] = [];
  for (const md of mastDefs) {
    const mast = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.24, md.h, 7), woodMat);
    pole.position.y = md.h / 2 - P.draft * 0.3;
    pole.castShadow = true;
    mast.add(pole);
    // марс (платформа)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 0.28, 8), darkMat);
    top.position.y = md.h * 0.72 - P.draft * 0.3;
    mast.add(top);
    mast.position.set(0, -P.draft * 0.3 > 0 ? 0 : 0, md.z);
    mast.userData.height = md.h;
    masts.push(mast);
    group.add(mast);
  }

  // паруса: каждый со своим материалом (своё рифление), квадратные —
  // на поворотной группе «рея+парус» для брасопки по ветру
  const sails: SailInfo[] = [];
  const addSquareSail = (mastIndex: number, level: number, width: number, height: number, setAt: number) => {
    const md = mastDefs[mastIndex];
    const g = new THREE.PlaneGeometry(width, height, 10, 7);
    g.translate(0, -height / 2, 0); // верхняя кромка у реи
    const mat = sailMaterial(P.colors.sail);
    const mesh = new THREE.Mesh(g, mat);
    const y = md.h * level - P.draft * 0.3;
    // поворотная группа: ось вращения — мачта (брасопка рея по ветру)
    const pivot = new THREE.Group();
    pivot.position.set(0, y + 0.05, md.z);
    // рея
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, width * 1.04, 5), woodMat);
    yard.rotation.z = Math.PI / 2;
    pivot.add(yard);
    mesh.position.set(0, 0, -0.25);
    pivot.add(mesh);
    group.add(pivot);
    sails.push({ mesh, mat, brace: pivot, setAt, furl: 1, square: true, braceAngle: 0 });
  };
  if (P.masts === 2) {
    addSquareSail(0, 0.66, L * 0.3, L * 0.16, 0.62);   // фок
    addSquareSail(1, 0.72, L * 0.36, L * 0.2, 0.45);   // грот нижний — ставится первым
    addSquareSail(1, 0.45, L * 0.26, L * 0.14, 0.92);  // грот верхний (брамсель)
  } else {
    addSquareSail(0, 0.62, L * 0.24, L * 0.13, 0.60);
    addSquareSail(1, 0.7, L * 0.34, L * 0.18, 0.45);
    addSquareSail(1, 0.44, L * 0.24, L * 0.13, 0.92);
    addSquareSail(2, 0.5, L * 0.18, L * 0.11, 0.78);
  }

  // кливера (треугольные) от бушприта к фок-мачте: сетка с uv —
  // есть «пузо» и трепет; при рифлении собираются к голове
  const addJib = (tip: THREE.Vector3, foot: THREE.Vector3, headY: number, mastZ: number, setAt: number) => {
    const head = new THREE.Vector3(0, headY, mastZ - 0.3);
    // локальная система: X = −мирZ (продольная), Y = мирY, Z = мирX (пузо вбок)
    const a = { x: -(tip.z - head.z), y: tip.y - head.y };
    const b = { x: -(foot.z - head.z), y: foot.y - head.y };
    const NU = 8, NV = 5;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      // точка на штаге (к галсовому углу) и на шкаторине
      const lx = a.x * u, ly = a.y * u;
      const rx = b.x * u, ry = b.y * u;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        pos.push(THREE.MathUtils.lerp(lx, rx, v), THREE.MathUtils.lerp(ly, ry, v), 0);
        uvs.push(u, v);
      }
    }
    const row = NV + 1;
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = sailMaterial(P.colors.sail);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.copy(head);
    mesh.rotation.y = Math.PI / 2; // локальный Z (пузо) -> мир X (борт)
    mesh.frustumCulled = false;
    group.add(mesh);
    sails.push({ mesh, mat, setAt, furl: 1, square: false, braceAngle: 0 });
  };
  const foreTop = mastDefs[0];
  addJib(bowspritTip, new THREE.Vector3(0, P.freeboard * 0.72, L / 2 - 1.0), foreTop.h * 0.62 - P.draft * 0.3, foreTop.z, 0.72);
  addJib(new THREE.Vector3(bowspritTip.x * 0.55, bowspritTip.y - (bowspritTip.y - P.freeboard * 0.72) * 0.45, bowspritTip.z - L * 0.1),
    new THREE.Vector3(0, P.freeboard * 0.72, L / 2 - 2.0), foreTop.h * 0.78 - P.draft * 0.3, foreTop.z, 1.0);

  // флаг на топе грот-мачты
  const mainMast = mastDefs[P.masts === 2 ? 1 : 1];
  const { mesh: flag, mat: flagMat } = flagMesh(P.flagKind);
  flag.position.set(0.05, mainMast.h - P.draft * 0.3 - 0.4, mainMast.z);
  group.add(flag);

  // пушки по бортам
  const gunsPort: THREE.Object3D[] = [];
  const gunsStarboard: THREE.Object3D[] = [];
  const gunZ0 = -L * 0.22, gunZ1 = L * 0.24;
  for (let i = 0; i < P.gunsPerSide; i++) {
    const z = THREE.MathUtils.lerp(gunZ0, gunZ1, P.gunsPerSide === 1 ? 0.5 : i / (P.gunsPerSide - 1));
    const p = hullProfile((z + L / 2) / L, P);
    const deckY = p.bulwark - 0.72;
    for (const side of [-1, 1]) {
      const gun = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.15, 8),
        new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.5, metalness: 0.75 }));
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(side * 0.62, 0.08, 0);
      gun.add(barrel);
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.55), darkMat);
      carriage.position.set(0, 0.0, 0);
      gun.add(carriage);
      gun.position.set(side * (p.w * 0.9 - 0.15), deckY, z);
      gun.userData.side = side;
      group.add(gun);
      // локальный −X = штирборт (правый борт), локальный +X = порт (левый)
      (side < 0 ? gunsStarboard : gunsPort).push(gun);
    }
  }

  // штурвал: пьедестал (не вращается) + колесо, начало координат
  // вращающейся группы — в ступице, чтобы крутился вокруг СВОЕЙ оси
  const wheelAsm = new THREE.Group();
  const wheel = new THREE.Group();
  const wheelR = 0.55;
  const hubY = 0.98; // высота оси над палубой
  const wheelTorus = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.045, 6, 18), darkMat);
  wheel.add(wheelTorus);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, wheelR * 2.3, 4), darkMat);
    spoke.rotation.z = ang;
    wheel.add(spoke);
    // рукоятки наружу, к рулевому (в сторону кормы, -Z)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 5), woodMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(-Math.sin(ang) * (wheelR + 0.02), Math.cos(ang) * (wheelR + 0.02), -0.14);
    wheel.add(handle);
  }
  const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 8), woodMat);
  wheelHub.rotation.x = Math.PI / 2;
  wheel.add(wheelHub);
  wheel.position.set(0, hubY, 0);
  wheelAsm.add(wheel);
  // стойка, подкосы и ось — вне вращающейся группы
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, hubY, 0.12), darkMat);
  post.position.set(0, hubY / 2, 0);
  wheelAsm.add(post);
  for (const sgn of [-1, 1]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, hubY * 1.2, 0.08), darkMat);
    brace.position.set(sgn * 0.24, hubY * 0.5, 0);
    brace.rotation.z = sgn * 0.55;
    wheelAsm.add(brace);
  }
  const wheelAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), darkMat);
  wheelAxle.rotation.x = Math.PI / 2;
  wheelAxle.position.set(0, hubY, 0.12);
  wheelAsm.add(wheelAxle);
  const wheelT = 0.2;
  wheelAsm.position.set(0, hullProfile(wheelT, P).bulwark - 1.0, THREE.MathUtils.lerp(-L / 2, L / 2, wheelT));
  group.add(wheelAsm);

  // палубный реквизит: гратинг-люк, бочки, канаты, кнехты, колокол, ядра,
  // сундук, ведро — одним мешом
  const props = new THREE.Mesh(buildDeckProps(P),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  props.castShadow = true;
  group.add(props);

  // шпиль, фонарь, якоря — строго на палубе
  const deckYAt = (t: number) => hullProfile(t, P).bulwark - 1.0;
  const capstan = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.7, 8), woodMat);
  capstan.position.set(0, deckYAt(0.36) + 0.35, -L * 0.16);
  group.add(capstan);
  const sternLantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd88a, emissive: 0xffaa33, emissiveIntensity: 1.6 }));
  sternLantern.position.set(0, P.freeboard * 1.15, -L / 2 - 0.15);
  group.add(sternLantern);
  let lantern: THREE.PointLight | undefined;
  // фигура на носу
  const figure = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6),
    new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.4, metalness: 0.6 }));
  figure.position.set(0, P.freeboard * 1.12, L / 2 - 0.2);
  figure.rotation.x = -0.5;
  group.add(figure);
  // якоря
  for (const side of [-1, 1]) {
    const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.3), darkMat);
    anchor.position.set(side * P.beam * 0.42, P.freeboard * 0.3, L / 2 - L * 0.06);
    anchor.rotation.z = side * 0.35;
    group.add(anchor);
  }

  // такелаж
  group.add(buildRigging(P, mastDefs, bowspritTip));

  const rig: SailRig = { sails };

  return {
    group, sails: rig, gunsPort, gunsStarboard, flag, flagMat,
    dims: { length: L, beam: P.beam, draft: P.draft }, outline,
    masts, lantern, wheel,
  };
}

/** Включить фонарь (ночь) — только для игрока, ради перфа */
export function enableLantern(vis: ShipVisual) {
  if (vis.lantern) return;
  vis.lantern = new THREE.PointLight(0xffa644, 6, 26, 1.6);
  vis.lantern.position.set(0, vis.dims.length * 0.06, -vis.dims.length / 2 - 0.4);
  vis.group.add(vis.lantern);
}
