import * as THREE from 'three';
import type { WeatherSettings, WeatherMode } from '../core/settings';

// ============================================================
// Погода: дождь (штрихи со сдвигом от ветра), гроза (молнии:
// вспышка неба + зигзаг-разряд + ветвление + гром с задержкой
// по дистанции), туман, ветер. От силы ветра зависит волнение.
// Всё плавно перетекает: дождь набирает силу, фронт уходит.
// ============================================================

export interface WeatherVisuals {
  cloudiness: number; // 0..1 — облачность для неба
  sunDim: number;     // 0..1 — ослабление солнца
  fogMul: number;     // × базовый туман сцены
  rainI: number;      // 0..1 — интенсивность дождя
}

interface ModeParams { cloud: number; dim: number; fog: number; rain: number; }

const MODE_VISUALS: Record<WeatherMode, ModeParams> = {
  clear: { cloud: 0.35, dim: 1.0, fog: 1.0, rain: 0 },
  rain: { cloud: 0.8, dim: 0.72, fog: 1.35, rain: 0.55 },
  storm: { cloud: 0.97, dim: 0.5, fog: 1.8, rain: 1.0 },
  fog: { cloud: 0.55, dim: 0.8, fog: 7.0, rain: 0 },
};

const RAIN_MAX = 1100;      // капель максимум
const RAIN_BOX = 62;        // половина стороны бокса вокруг камеры, м
const RAIN_TOP = 34;        // высота спавна над камерой
const RAIN_FALL = 62;       // вертикальный размер бокса

export class WeatherSystem {
  mode: WeatherMode = 'clear';
  /** актуальный ветер: from — радианы (откуда), speed — м/с */
  wind = { from: 0.7, speed: 7.5 };
  /** текущая вспышка молнии 0..1 (для неба/воды/света) */
  flash = 0;
  /** счётчик разрядов (телеметрия) */
  flashes = 0;
  /** гром: обратный вызов (дистанция до разряда, м) */
  onThunder: ((dist: number) => void) | null = null;

  group = new THREE.Group();

  // --- дождь ---
  private rainLines: THREE.LineSegments;
  private rainPos: Float32Array;      // 2 вершины на каплю
  private rainDrop: Float32Array;     // позиция капли (N×3)
  private rainFall = new Float32Array(RAIN_MAX);
  private rainMat: THREE.LineBasicMaterial;
  private rainI = 0;                  // сглаженная интенсивность

  // --- молния ---
  private boltGroup = new THREE.Group();
  private boltCoreMat: THREE.MeshBasicMaterial;
  private boltGlowMat: THREE.MeshBasicMaterial;
  private boltLife = 0;
  private strikeT = 5;
  private doubleT = -1;               // второй удар (мерцание)
  private boltLight: THREE.PointLight;

  // --- цели визуала (сглаживаются) ---
  private vis: WeatherVisuals = { cloudiness: 0.35, sunDim: 1, fogMul: 1, rainI: 0 };
  private visTarget: ModeParams = MODE_VISUALS.clear;
  private gustT = 0;
  private windBase = 7.5;
  private dirBase = 40;               // градусы, откуда
  /** позиция камеры (сцена) — разряды бьют ОТНОСИТЕЛЬНО неё */
  private camPos = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // ---- дождь: штрихи, вытянутые по скорости падения + ветру ----
    this.rainPos = new Float32Array(RAIN_MAX * 2 * 3);
    this.rainDrop = new Float32Array(RAIN_MAX * 3);
    for (let i = 0; i < RAIN_MAX; i++) {
      this.rainDrop[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX;
      this.rainDrop[i * 3 + 1] = Math.random() * RAIN_FALL - 6;
      this.rainDrop[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX;
      this.rainFall[i] = 9.5 + Math.random() * 5; // м/с
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    rg.setDrawRange(0, 0);
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0xa9c2d6, transparent: true, opacity: 0, depthWrite: false,
    });
    this.rainLines = new THREE.LineSegments(rg, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 5;
    this.group.add(this.rainLines);

    // ---- молния: зигзаг-разряд ТРУБАМИ (линии в WebGL всегда 1px —
    // на дистанции не видны): яркое ядро + широкий ореол + ветви ----
    this.boltCoreMat = new THREE.MeshBasicMaterial({
      color: 0xe8f0ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.boltGlowMat = new THREE.MeshBasicMaterial({
      color: 0x8fb2ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.boltGroup.renderOrder = 30;
    this.group.add(this.boltGroup);

    // свет от разряда (всегда в сцене, чтобы не перекомпилировать материалы)
    this.boltLight = new THREE.PointLight(0xbfd4ff, 0, 1600, 1.2);
    this.group.add(this.boltLight);

    scene.add(this.group);
  }

  /** Применить настройки погоды (режим + ветер) */
  applySettings(w: WeatherSettings) {
    this.mode = w.mode;
    this.visTarget = MODE_VISUALS[w.mode];
    this.windBase = w.windSpeed;
    this.dirBase = w.windDir;
  }

  /** Форсировать режим (телеметрия/тесты) */
  setMode(m: WeatherMode) {
    this.mode = m;
    this.visTarget = MODE_VISUALS[m];
  }

  /** Шаг погоды: ветер (порывы/дрейф), дождь, молнии. Возвращает визуал */
  update(dt: number, camPos: THREE.Vector3, calm: boolean): WeatherVisuals {
    this.camPos.copy(camPos);
    // ---- ветер: цель = база из настроек, гроза усиливает (полигон — штиль) ----
    let target = this.windBase;
    if (this.mode === 'storm' && !calm) target = Math.max(this.windBase, 15) * 1.12;
    this.gustT += dt;
    const gust = 1 + Math.sin(this.gustT * 0.5) * 0.14 + Math.sin(this.gustT * 1.7 + 2) * 0.08;
    const spdTarget = calm ? 4.2 : target * gust;
    this.wind.speed += (spdTarget - this.wind.speed) * Math.min(1, dt * 0.55);
    // направление: база + медленный дрейф
    const drift = Math.sin(this.gustT * 0.037 + 1.3) * 0.07;
    const fromRad = (this.dirBase * Math.PI) / 180 + drift;
    this.wind.from += (fromRad - this.wind.from) * Math.min(1, dt * 0.25);

    // ---- визуал: плавный переход фронта (полигон — всегда ясно) ----
    const tgt = calm ? MODE_VISUALS.clear : this.visTarget;
    const k = Math.min(1, dt * 0.6);
    const t = tgt;
    this.vis.cloudiness += (t.cloud - this.vis.cloudiness) * k;
    this.vis.sunDim += (t.dim - this.vis.sunDim) * k;
    this.vis.fogMul += (t.fog - this.vis.fogMul) * k;
    this.vis.rainI += (t.rain - this.vis.rainI) * k;
    this.rainI = this.vis.rainI;

    // ---- вспышка молнии: затухание ----
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4.2);
    if (this.boltLife > 0) {
      this.boltLife -= dt;
      const op = Math.max(0, Math.min(1, this.boltLife * 7));
      this.boltCoreMat.opacity = op;
      this.boltGlowMat.opacity = op * 0.35;
      this.boltLight.intensity = this.flash * 90000;
      if (this.boltLife <= 0) {
        this.clearBolt();
        this.boltLight.intensity = 0;
      }
    }

    // ---- новые разряды (только гроза и не полигон-штиль) ----
    if (this.mode === 'storm' && !calm) {
      this.strikeT -= dt;
      if (this.doubleT > 0) {
        this.doubleT -= dt;
        if (this.doubleT <= 0) { this.strike(); this.doubleT = -1; }
      }
      if (this.strikeT <= 0) {
        this.strike();
        this.strikeT = 3.5 + Math.random() * 8;
        this.doubleT = Math.random() < 0.55 ? 0.06 + Math.random() * 0.1 : -1;
      }
    }

    // ---- дождь: позиции капель вокруг камеры ----
    this.updateRain(dt, camPos);
    return this.vis;
  }

  /** Стереть разряд (освободить геометрию) */
  private clearBolt() {
    for (const child of [...this.boltGroup.children]) {
      this.boltGroup.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    this.boltCoreMat.opacity = 0;
    this.boltGlowMat.opacity = 0;
  }

  /** Труба по ломаной (ядро/ореол/ветвь) */
  private tube(pts: THREE.Vector3[], radius: number, mat: THREE.Material) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
    const geo = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), radius, 5, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.boltGroup.add(mesh);
  }

  /** Разряд молнии: зигзаг-трубы + ветви + вспышка + гром.
   *  az/dist (рад/м) — направление и дистанция ОТ КАМЕРЫ */
  strike(az = Math.random() * Math.PI * 2, dist = 130 + Math.random() * 260) {
    this.clearBolt();
    // разряд бьёт на расстоянии dist от КАМЕРЫ (floating origin!)
    const cx = this.camPos.x + Math.cos(az) * dist;
    const cz = this.camPos.z + Math.sin(az) * dist;
    const topY = 230 + Math.random() * 120;
    // главный канал: ломаная сверху вниз с боковым дрожанием
    const main: THREE.Vector3[] = [];
    let px = cx + (Math.random() - 0.5) * 40, pz = cz + (Math.random() - 0.5) * 40;
    const segs = 14;
    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      const y = topY * (1 - f);
      const j = 14 * (1 - f * 0.55);
      main.push(new THREE.Vector3(px + (Math.random() - 0.5) * j * 2, y, pz + (Math.random() - 0.5) * j * 2));
    }
    // низ точно у воды
    main[main.length - 1].set(main[main.length - 1].x, 0, main[main.length - 1].z);
    this.tube(main, 0.9, this.boltCoreMat);   // яркое ядро
    this.tube(main, 3.6, this.boltGlowMat);   // широкий ореол
    // 1-2 ветви из верхней половины
    const nb = 1 + Math.floor(Math.random() * 2);
    for (let b = 0; b < nb; b++) {
      const start = 2 + Math.floor(Math.random() * 5);
      const from = main[start];
      const bAz = Math.random() * Math.PI * 2;
      const branch: THREE.Vector3[] = [from.clone()];
      let bx = from.x, by = from.y, bz = from.z;
      for (let i = 0; i < 5; i++) {
        bx += Math.cos(bAz) * (7 + Math.random() * 10) + (Math.random() - 0.5) * 7;
        bz += Math.sin(bAz) * (7 + Math.random() * 10) + (Math.random() - 0.5) * 7;
        by -= (from.y / 6) * (0.5 + Math.random() * 0.4);
        branch.push(new THREE.Vector3(bx, by, bz));
      }
      this.tube(branch, 0.4, this.boltCoreMat);
    }
    this.boltLife = 0.13 + Math.random() * 0.08;
    this.boltCoreMat.opacity = 1;
    this.boltGlowMat.opacity = 0.35;
    this.flash = 1;
    this.flashes++;
    this.boltLight.position.set(cx, topY * 0.55, cz);
    this.boltLight.intensity = 90000;
    if (this.onThunder) this.onThunder(dist);
  }

  /** Дождь: капли в боксе вокруг камеры, штрих = скорость·время */
  private updateRain(dt: number, camPos: THREE.Vector3) {
    const intensity = this.rainI;
    const count = Math.floor(RAIN_MAX * intensity);
    this.rainMat.opacity = 0.12 + 0.26 * intensity;
    this.rainLines.geometry.setDrawRange(0, count * 2);
    if (count <= 0) return;
    // снос ветром (капля падает под углом)
    const wx = -Math.cos(this.wind.from) * this.wind.speed * 0.5;
    const wz = -Math.sin(this.wind.from) * this.wind.speed * 0.5;
    const dtc = Math.min(dt, 0.1);
    const streak = 0.05; // длина штриха, с
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      let x = this.rainDrop[i3], y = this.rainDrop[i3 + 1], z = this.rainDrop[i3 + 2];
      const vy = -this.rainFall[i];
      x += wx * dtc; y += vy * dtc; z += wz * dtc;
      // бокс вокруг камеры (относительные координаты)
      if (y < -RAIN_TOP * 0.75) y += RAIN_FALL;
      if (x > RAIN_BOX) x -= RAIN_BOX * 2; else if (x < -RAIN_BOX) x += RAIN_BOX * 2;
      if (z > RAIN_BOX) z -= RAIN_BOX * 2; else if (z < -RAIN_BOX) z += RAIN_BOX * 2;
      this.rainDrop[i3] = x; this.rainDrop[i3 + 1] = y; this.rainDrop[i3 + 2] = z;
      const a = i * 6;
      this.rainPos[a] = camPos.x + x; this.rainPos[a + 1] = camPos.y + y; this.rainPos[a + 2] = camPos.z + z;
      this.rainPos[a + 3] = camPos.x + x - wx * streak;
      this.rainPos[a + 4] = camPos.y + y - vy * streak;
      this.rainPos[a + 5] = camPos.z + z - wz * streak;
    }
    (this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Дождь виден? (для телеметрии) */
  get rainCount(): number { return Math.floor(RAIN_MAX * this.rainI); }
}
