/* ============================================================
   shipPhysics.js — движение корпуса по волнам Герстнера
   4 замера высоты → нормаль поверхности → крен/дифферент,
   пружинный гейв (масса + плавучесть), тяжёлый slerp ориентации.
   Не зависит от рендера: ему нужна только функция heightAt(x,z,t).

   Модуль игрока (Task 29), интегрирован как физика качки для
   модели моря «Штормовой модуль» (sea.ts). Все константы
   BUOYANCY_CONFIG вынесены в настройки (Настройки → Погода →
   «Качка корпуса») и применяются на лету через applySettings().
============================================================ */
import * as THREE from 'three';

/* ---------------- НАСТРОЙКИ (все тюнинги здесь) ---------------- */
export interface BuoyancyConfig {
  /* Пружина вертикальной качки (масса / подъёмная сила).
     Больше stiffness — резче подскакивает на волне;
     больше damping — быстрее гасит вертикальную скорость. */
  heaveStiffness: number;
  heaveDamping: number;

  /* «Вязкость» ориентации: скорость доворота кватерниона к склону волны (1/с).
     Меньше — корабль лениво переваливается, больше — липнет к волне. */
  orientResponse: number;

  /* Дополнительное заглубление корпуса */
  sinkHeel: number;      // от крена (отклонение нормали от вертикали)
  sinkSpeed: number;     // от хода (динамическое погружение)
  sinkSpeedMax: number;  // потолок скоростного заглубления

  /* Расположение точек замера воды (доли габаритов) */
  sampleForeAft: number; // нос/корма: доля длины от центра
  sampleSide: number;    // борта: доля полуширины от центра

  /* ПОГРУЖЕНИЕ: доля глубины корпуса, на которую центр корпуса
     поднят над средней водой. 0.45 — ватерлиния у миделя;
     0.65 — лёгкая шлюпка сидит выше. Ключи = тип судна. */
  immersion: { frigate: number; boat: number; default: number };

  /* Заливание палубы */
  floodCooldown: number;    // пауза между событиями заливания, с
  floodPulseDecay: number;  // скорость затухания импульса (для пены/тряски)

  /* Удар носом о волну (для брызг) */
  slamImmersion: number;  // насколько нос погрузился ниже воды
  slamSpeedMin: number;   // минимальный ход для удара
}

export const BUOYANCY_CONFIG: BuoyancyConfig = {
  heaveStiffness: 5.0,
  heaveDamping: 2.4,

  orientResponse: 2.6,

  sinkHeel: 1.2,
  sinkSpeed: 0.02,
  sinkSpeedMax: 0.2,

  sampleForeAft: 0.42,
  sampleSide: 0.78,

  immersion: { frigate: 0.45, boat: 0.65, default: 0.5 },

  floodCooldown: 1.4,
  floodPulseDecay: 1.4,

  slamImmersion: 0.35,
  slamSpeedMin: 2.0,
};

/** Применить настройки (Настройки → Качка корпуса) к глобальному
 *  конфигу: НОВЫЕ экземпляры берут его при создании; живые
 *  экземпляры обновляются через buoy.applySettings() из Game */
export function applyBuoyancyConfig(
  src: Partial<BuoyancyConfig> & { immersion?: Partial<BuoyancyConfig['immersion']> },
) {
  if (typeof src.heaveStiffness === 'number') BUOYANCY_CONFIG.heaveStiffness = src.heaveStiffness;
  if (typeof src.heaveDamping === 'number') BUOYANCY_CONFIG.heaveDamping = src.heaveDamping;
  if (typeof src.orientResponse === 'number') BUOYANCY_CONFIG.orientResponse = src.orientResponse;
  if (typeof src.sinkHeel === 'number') BUOYANCY_CONFIG.sinkHeel = src.sinkHeel;
  if (typeof src.sinkSpeed === 'number') BUOYANCY_CONFIG.sinkSpeed = src.sinkSpeed;
  if (typeof src.sinkSpeedMax === 'number') BUOYANCY_CONFIG.sinkSpeedMax = src.sinkSpeedMax;
  if (typeof src.sampleForeAft === 'number') BUOYANCY_CONFIG.sampleForeAft = src.sampleForeAft;
  if (typeof src.sampleSide === 'number') BUOYANCY_CONFIG.sampleSide = src.sampleSide;
  if (typeof src.floodCooldown === 'number') BUOYANCY_CONFIG.floodCooldown = src.floodCooldown;
  if (typeof src.floodPulseDecay === 'number') BUOYANCY_CONFIG.floodPulseDecay = src.floodPulseDecay;
  if (typeof src.slamImmersion === 'number') BUOYANCY_CONFIG.slamImmersion = src.slamImmersion;
  if (typeof src.slamSpeedMin === 'number') BUOYANCY_CONFIG.slamSpeedMin = src.slamSpeedMin;
  if (src.immersion) {
    const { immersion } = BUOYANCY_CONFIG;
    if (typeof src.immersion.frigate === 'number') immersion.frigate = src.immersion.frigate;
    if (typeof src.immersion.boat === 'number') immersion.boat = src.immersion.boat;
    if (typeof src.immersion.default === 'number') immersion.default = src.immersion.default;
  }
}

/* ---------------- КЛАСС ФИЗИКИ ---------------- */
export interface VesselDef {
  type?: string;
  len?: number;
  beam?: number;
  depth?: number;
  deck?: number;
  immersion?: number;
}

/** состояние судна для шага физики */
export interface VesselMotionState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

export class ShipBuoyancy {
  cfg: BuoyancyConfig;
  vessel: Required<VesselDef> = { type: 'default', len: 10, beam: 3, depth: 2, deck: 1, immersion: 0.5 };

  /* состояние */
  y = 0;                        // высота центра корпуса над средней водой
  vy = 0;                       // вертикальная скорость
  q = new THREE.Quaternion();   // итоговая ориентация корпуса
  normal = new THREE.Vector3(0, 1, 0); // нормаль волны под судном

  /* высоты воды в точках замера (для брызг/пены/HUD) */
  hBow = 0; hStern = 0; hPort = 0; hStar = 0; hMid = 0;

  /* события кадра + импульс заливания */
  events = { slam: false, floodPort: false, floodStar: false };
  floodPulse = 0;

  private _floodCd = [0, 0];
  private _prevBowH = 0;
  private _v1 = new THREE.Vector3(); private _v2 = new THREE.Vector3();
  private _u = new THREE.Vector3(); private _f = new THREE.Vector3();
  private _r = new THREE.Vector3(); private _m = new THREE.Matrix4();
  private _qt = new THREE.Quaternion();

  constructor(cfg: Partial<BuoyancyConfig> = {}) {
    this.cfg = Object.assign({}, BUOYANCY_CONFIG, cfg);
    this.cfg.immersion = Object.assign({}, BUOYANCY_CONFIG.immersion, cfg.immersion);
  }

  /** обновить конфиг на лету (Настройки → Качка корпуса) */
  applySettings(src: Partial<BuoyancyConfig> & { immersion?: Partial<BuoyancyConfig['immersion']> }) {
    applyBuoyancyConfig(src);
    this.cfg = Object.assign({}, BUOYANCY_CONFIG);
    this.cfg.immersion = Object.assign({}, BUOYANCY_CONFIG.immersion);
    // погружение текущего судна — пересчитать по новому конфигу
    this.vessel.immersion = this.vessel.type === 'frigate' || this.vessel.type === 'boat'
      ? this.cfg.immersion[this.vessel.type as 'frigate' | 'boat']
      : this.cfg.immersion.default;
  }

  /* габариты текущего судна; immersion берётся из конфига по типу */
  setVessel(d: VesselDef) {
    Object.assign(this.vessel, d);
    this.vessel.immersion = d.immersion
      ?? (d.type === 'frigate' || d.type === 'boat'
        ? this.cfg.immersion[d.type as 'frigate' | 'boat']
        : this.cfg.immersion.default);
  }

  /* сброс состояния (смена судна, телепорт) */
  reset(y = 0) {
    this.y = y; this.vy = 0; this.q.identity();
    this.floodPulse = 0; this._floodCd = [0, 0]; this._prevBowH = 0;
  }

  /* Покадровый шаг.
     dt, t    — шаг и время симуляции
     s        — {x, z, yaw, speed}
     heightAt — (x,z,t)=>высота воды (CPU-копия волн, только phys-зыби) */
  update(dt: number, t: number, s: VesselMotionState, heightAt: (x: number, z: number, t: number) => number) {
    const c = this.cfg, V = this.vessel, L = V.len, B = V.beam;
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    const e = this.events;
    e.slam = e.floodPort = e.floodStar = false;

    /* 1. Четыре замера + центр */
    const a = L * c.sampleForeAft, b = B * c.sampleSide;
    const hBow = heightAt(s.x + sy * a, s.z + cy * a, t);
    const hStern = heightAt(s.x - sy * a, s.z - cy * a, t);
    const hPort = heightAt(s.x - cy * b, s.z + sy * b, t);
    const hStar = heightAt(s.x + cy * b, s.z - sy * b, t);
    const hMid = heightAt(s.x, s.z, t);
    this.hBow = hBow; this.hStern = hStern; this.hPort = hPort; this.hStar = hStar; this.hMid = hMid;

    /* 2. Нормаль поверхности по двум касательным (корма→нос, бак→штир) */
    this._v1.set(sy * 2 * a, hBow - hStern, cy * 2 * a);
    this._v2.set(cy * 2 * b, hStar - hPort, -sy * 2 * b);
    this._u.copy(this._v1).cross(this._v2).normalize();
    this.normal.copy(this._u);
    this._f.set(sy, (hBow - hStern) / (2 * a), cy).normalize(); // курс по склону
    this._r.copy(this._u).cross(this._f).normalize();
    this._m.makeBasis(this._r, this._u, this._f);
    this._qt.setFromRotationMatrix(this._m);

    /* 3. Гейв: пружина с инерцией + заглубление */
    const sink = -(1 - this._u.y) * c.sinkHeel
      - Math.min(Math.abs(s.speed) * c.sinkSpeed, c.sinkSpeedMax);
    const targetY = hMid * 0.45 + (hBow + hStern + hPort + hStar) * 0.1375
      + sink + V.depth * V.immersion;
    this.vy += ((targetY - this.y) * c.heaveStiffness - this.vy * c.heaveDamping) * dt;
    this.y += this.vy * dt;

    /* 4. Ориентация: тяжёлый slerp (корабль не «прилипает» к волне) */
    this.q.slerp(this._qt, 1 - Math.exp(-c.orientResponse * dt));

    /* 5. События: удар носом, заливание бортов */
    const imm = hBow - (this.y - V.depth * 0.3);
    if (imm > c.slamImmersion && Math.abs(s.speed) > c.slamSpeedMin && this._prevBowH < hBow)
      e.slam = true;
    this._prevBowH = hBow;

    this._floodCd[0] -= dt; this._floodCd[1] -= dt;
    if (hPort > this.y + V.deck && this._floodCd[0] <= 0) {
      e.floodPort = true; this._floodCd[0] = c.floodCooldown;
    }
    if (hStar > this.y + V.deck && this._floodCd[1] <= 0) {
      e.floodStar = true; this._floodCd[1] = c.floodCooldown;
    }
    if (e.floodPort || e.floodStar) this.floodPulse = 1;
    this.floodPulse = Math.max(0, this.floodPulse - dt * c.floodPulseDecay);
  }
}

export default ShipBuoyancy;
