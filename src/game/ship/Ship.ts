import * as THREE from 'three';
import { PRESETS, ShipPreset, buildShip, ShipVisual, enableLantern } from './buildShip';
import { buildCrew, CrewVisual } from './crew';
import { waterHeightAt, waterNormalAt } from '../water/waves';
import { WaterlineFoam, WakeTrail } from '../water/wake';
import { Particles } from '../fx/particles';
import { clamp, mod2pi, smoothstep } from '../core/rng';

// ============================================================
// Корабль как сущность: 6DOF-физика (surge/sway/heave/roll/
// pitch/yaw), buoyancy probes по секциям, ветер на парусах,
// руль, якорь, повреждения, течь, пожар, затопление.
// ============================================================

export interface WindState { from: number; speed: number; } // from: радианы ОТКУДА дует

export type DamageKind = 'ball' | 'chain' | 'grape' | 'fire' | 'ram' | 'ground';

export interface DamageInput {
  kind: DamageKind;
  amount: number;
  hitPoint?: THREE.Vector3; // мировая точка
}

interface Probe { off: THREE.Vector3; k: number; c: number; }

const G = 9.81;

export class Ship {
  preset: ShipPreset;
  visual: ShipVisual;
  isPlayer: boolean;

  // --- физика ---
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  velocity = new THREE.Vector3();
  angular = new THREE.Vector3(); // мировая угловая скорость
  mass: number;
  inertia = new THREE.Vector3(); // диагональ в связных осях (x=right, y=up, z=forward)
  private probes: Probe[] = [];
  private reserve: Probe[] = [];   // запас плавучести надводного борта
  private force = new THREE.Vector3();
  private torque = new THREE.Vector3();
  private _f = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _t1 = new THREE.Vector3();
  private _t2 = new THREE.Vector3();
  private _t3 = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private wq = new THREE.Quaternion();
  private dq = new THREE.Quaternion();

  // --- управление ---
  sailTarget = 0;          // 0..3
  sailFrac = 0;            // плавное 0..1
  rudder = 0;              // -1..1 (реальный угол)
  rudderTarget = 0;
  anchored = false;
  reverseThrust = false;
  helmActive = false;

  // --- состояние ---
  hullHP: number; hullMax: number;
  sailHP: number;
  crew: number;
  water = 0;               // м³ в трюме
  holdCap: number;
  leakRate = 0;            // м³/с суммарная течь
  onFire = false;
  fireT = 0;
  mastsBroken = 0;         // число сломанных (для тяги)
  mastAnim = -1;           // (легаси) для совместимости
  mastHP: number[] = [];   // HP каждой мачты
  mastFall: number[] = []; // прогресс падения: -1 стоит, 0..1 валится/лежит
  mastMaxHP = 32;
  hullHoles: { side: number; belowWL: boolean; mesh: THREE.Mesh }[] = [];
  leakBias = 0;            // суммарный кренящий момент пробоин (−1..1 порт/штирборт)
  noSurrender = false;     // мишень полигона не сдаётся
  crew3d: CrewVisual;      // фигуры на палубе
  sinking = false;
  sinkT = 0;
  sunk = false;
  surrendered = false;
  grounded = false;
  gold = 0;
  cargo: Record<string, number> = {};
  ammo: Record<string, number> = { ball: 40, chain: 12, grape: 20, fire: 8 };
  planks = 12;
  pumpAction = false;

  // --- мир ---
  wind: WindState;
  terrainHeight: (x: number, z: number) => number;
  particles: Particles;

  // --- вода/след ---
  foam: WaterlineFoam;
  wake = new WakeTrail();
  private lastStern = new THREE.Vector3();
  private rollSmooth = 0;

  // --- события колбэки ---
  onSurrender?: (s: Ship) => void;
  onSunk?: (s: Ship) => void;

  constructor(presetId: string, isPlayer: boolean, wind: WindState,
    terrainHeight: (x: number, z: number) => number, particles: Particles) {
    this.preset = PRESETS[presetId];
    this.isPlayer = isPlayer;
    this.wind = wind;
    this.terrainHeight = terrainHeight;
    this.particles = particles;
    this.visual = buildShip(this.preset);
    this.hullHP = this.preset.hullHP;
    this.hullMax = this.preset.hullHP;
    this.sailHP = this.preset.sailHP;
    this.crew = Math.round(this.preset.maxCrew * 0.8);
    this.holdCap = this.preset.cargo * 0.8;
    this.mass = this.preset.mass;

    const { length: L, beam: B, draft: D, freeboard: F } = this.preset;
    // моменты инерции (связные оси: x — крен? нет: x=право, y=верх, z=нос)
    // крен — вокруг z, дифферент — вокруг x, рыскание — вокруг y
    this.inertia.set(
      this.mass * (B * B + F * F) / 12 * 1.5,   // pitch (x)
      this.mass * (L * L + B * B) / 12 * 1.2,   // yaw (y)
      this.mass * (B * B + F * F) / 12 * 1.5,   // roll (z)
    );

    // зонды плавучести: 7 шпангоутов × 3 точки (ниже ватерлинии).
    // Жёстче прежнего (нейтральная глубина 0.38 осадки) — корабль
    // быстрее следует за гребнем волны, не проваливается в него.
    const NZ = 7;
    let n = 0;
    for (let i = 0; i < NZ; i++) {
      const t = i / (NZ - 1);
      const z = THREE.MathUtils.lerp(-L * 0.44, L * 0.44, t);
      const prof = this.halfWidthAt(z);
      const offs = [0, -prof * 0.75, prof * 0.75];
      for (const x of offs) {
        this.probes.push({ off: new THREE.Vector3(x, -D * 0.38, z), k: 0, c: 0 });
        n++;
      }
    }
    const neutral = D * 0.38;
    const kTotal = this.mass * G / neutral;
    for (const p of this.probes) {
      p.k = kTotal / n;
      p.c = 2 * Math.sqrt(p.k * (this.mass / n)) * 0.5; // демпфер качки
    }
    // Резервные зонды по скулам борта чуть выше спокойной ватерлинии:
    // моделируют запас плавучести корпуса до планширя — гребень, накрывший
    // палубу, встречает сильное сопротивление и кренящий момент вправку,
    // «полностью по борт» корабль больше не погружается.
    let rn = 0;
    for (let i = 0; i < NZ; i++) {
      const t = i / (NZ - 1);
      const z = THREE.MathUtils.lerp(-L * 0.44, L * 0.44, t);
      const prof = this.halfWidthAt(z) * 0.85;
      for (const x of [-prof, prof]) {
        this.reserve.push({ off: new THREE.Vector3(x, F * 0.34, z), k: 0, c: 0 });
        rn++;
      }
    }
    // жёстче прежнего: полный вес запаса уже на 15 см погружения борта —
    // волна не может накрыть палубу, корпус «всплывает» на гребень
    const rkTotal = this.mass * G / 0.15;
    for (const p of this.reserve) {
      p.k = rkTotal / rn;
      p.c = 2 * Math.sqrt(p.k * (this.mass / rn)) * 1.3;
    }

    this.foam = new WaterlineFoam(this.visual.outline);
    this.wake.setWaterHeight(waterHeightAt);
    if (isPlayer) enableLantern(this.visual);

    // экипаж на палубе: процедурные типажи, сид фиксирован по модели
    const seed = Array.from(presetId).reduce((a, ch) => a + ch.charCodeAt(0) * 31, 11)
      + Math.round(this.preset.length * 7);
    this.crew3d = buildCrew(this.preset, seed);
    this.visual.group.add(this.crew3d.group);
    for (let i = 0; i < this.visual.masts.length; i++) {
      this.mastHP.push(this.mastMaxHP);
      this.mastFall.push(-1);
    }
  }

  halfWidthAt(z: number): number {
    const t = clamp((z + this.preset.length / 2) / this.preset.length, 0, 1);
    let w: number;
    if (t < 0.45) w = THREE.MathUtils.lerp(0.58, 1.0, t / 0.45);
    else w = THREE.MathUtils.lerp(1.0, 0.0, Math.pow(clamp((t - 0.45) / 0.55, 0, 1), 0.75));
    return Math.max(0.3, w * this.preset.beam * 0.5);
  }

  // ---------- геометрия ориентации ----------
  get forward(): THREE.Vector3 {
    const e = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    return new THREE.Vector3(Math.sin(e.y), 0, Math.cos(e.y)).normalize();
  }
  get heading(): number {
    const e = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    return e.y;
  }
  get euler(): THREE.Euler { return new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ'); }
  speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }
  speedKnots(): number { return this.speed() * 1.9438; }

  /** Угол между направлением ОТКУДА дует (кажущийся) ветер и курсом, 0..PI */
  apparentWindAngle(): number {
    const wf = this.tmpV.set(Math.cos(this.wind.from), 0, Math.sin(this.wind.from));
    // кажущийся ветер = истинный - скорость корабля
    const av = this.tmpV2.set(-wf.x * this.wind.speed - this.velocity.x, 0, -wf.z * this.wind.speed - this.velocity.z);
    // вектор ОТКУДА дует кажущийся ветер:
    const aFromX = -av.x, aFromZ = -av.z;
    const len = Math.hypot(aFromX, aFromZ) || 1;
    const f = this.forward;
    const dot = (aFromX / len) * f.x + (aFromZ / len) * f.z;
    return Math.acos(clamp(dot, -1, 1));
  }

  /** Полярная эффективность парусов по углу (рад): лавировка/бейдевинд/галфвинд/фордевинд */
  static polar(awa: number): number {
    const d = awa * 180 / Math.PI;
    if (d < 25) return 0.02;                       // левентик — почти нет хода
    if (d < 60) return THREE.MathUtils.lerp(0.08, 0.7, (d - 25) / 35);
    if (d < 110) return THREE.MathUtils.lerp(0.7, 1.0, (d - 60) / 50);  // бейдевинд-галфвинд
    if (d < 150) return THREE.MathUtils.lerp(1.0, 0.82, (d - 110) / 40);
    return THREE.MathUtils.lerp(0.82, 0.68, (d - 150) / 30);            // фордевинд
  }

  // ---------- фиксированный шаг физики ----------
  fixedStep(dt: number, time: number) {
    if (this.sunk) return;
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);

    const f = this._f.copy(this.forward);
    // штирборт (правый борт): forward × up = (−f.z, 0, f.x)
    const right = this._r.set(-f.z, 0, f.x).normalize();
    const e = this.euler;
    const spd = this.speed();

    const m = this.mass + this.water * 1000; // вода в трюме утяжеляет

    // --- гравитация ---
    this.force.y -= m * G;

    // --- плавучесть по зондам (τ = r × F, F = (0, fl, 0)) ---
    for (const p of this.probes) {
      const wp = this._t1.copy(p.off).applyQuaternion(this.quaternion).add(this.position);
      const wy = waterHeightAt(wp.x, wp.z, time);
      const depth = wy - wp.y;
      if (depth > 0) {
        const rx = wp.x - this.position.x, rz = wp.z - this.position.z;
        // вертикальная скорость точки: v = ω × r → vy = ωz*rx − ωx*rz
        const vy = this.velocity.y + (this.angular.z * rx - this.angular.x * rz);
        let fl = p.k * Math.min(depth, 6) - p.c * vy;
        if (fl < 0) fl = 0;
        this.force.y += fl;
        this.torque.x += -rz * fl;
        this.torque.z += rx * fl;
      }
    }
    // --- запас плавучести бортов (пока не тонем) ---
    if (!this.sinking) {
      for (const p of this.reserve) {
        const wp = this._t1.copy(p.off).applyQuaternion(this.quaternion).add(this.position);
        const wy = waterHeightAt(wp.x, wp.z, time);
        const depth = wy - wp.y;
        if (depth > 0) {
          const rx = wp.x - this.position.x, rz = wp.z - this.position.z;
          const vy = this.velocity.y + (this.angular.z * rx - this.angular.x * rz);
          let fl = p.k * Math.min(depth, 2.5) - p.c * vy;
          if (fl < 0) fl = 0;
          this.force.y += fl;
          this.torque.x += -rz * fl;
          this.torque.z += rx * fl;
        }
      }
    }

    // --- ветер на парусах ---
    this.sailFrac += (this.sailTarget / 3 - this.sailFrac) * Math.min(1, dt * 0.7);
    const awa = this.apparentWindAngle();
    const polar = Ship.polar(awa);
    const sailEffMul = this.sailHP / this.preset.sailHP;
    const damaged = sailEffMul < 0.5 ? 0.45 : sailEffMul < 0.85 ? 0.8 : 1.0;
    const windPower = Math.pow(this.wind.speed / 8.0, 1.6);
    let thrust = 0;
    if (!this.anchored && !this.sinking && this.mastsBroken < 2) {
      thrust = this.sailFrac * polar * windPower * this.preset.maxSpeed * 7.0 * damaged * (this.sailHP > 0 ? 1 : 0);
    }
    if (this.reverseThrust && !this.anchored) thrust = -this.preset.maxSpeed * 0.45; // задний ход на вёслах
    // сила тяги вдоль forward
    this.force.x += f.x * thrust * m * 0.06;
    this.force.z += f.z * thrust * m * 0.06;
    // крен от ветра: боковая составляющая ветра на парусах
    const wf = new THREE.Vector3(Math.cos(this.wind.from), 0, Math.sin(this.wind.from));
    const windTravel = wf.clone().multiplyScalar(-this.wind.speed);
    const lateral = windTravel.dot(right);
    const heelF = lateral * this.sailFrac * windPower * m * 0.05;
    this.torque.z += heelF;
    // ... и небольшое боковое сносовое усилие
    this.force.x += right.x * lateral * this.sailFrac * m * 0.004;
    this.force.z += right.z * lateral * this.sailFrac * m * 0.004;

    // --- руль ---
    this.rudder += (this.rudderTarget - this.rudder) * Math.min(1, dt * 1.8);
    const rudderAngle = this.rudder * 0.6; // рад, макс ~34°
    const yawAuth = clamp(spd / 4.0, 0, 1.15); // авторитеты руля от скорости
    // положительный руль (D) = поворот ВПРАВО (штирборт):
    // вращение вокруг −Y, т.к. +Y = поворот влево (к порту)
    this.torque.y -= rudderAngle * yawAuth * m * 12.0; // ~6°/с на полном ходу
    // крен на повороте (отцентробежный)
    this.torque.z += this.angular.y * spd * m * 0.35;
    // лёгкое зарывание носа на скорости (слабое: сильное топило борт
    // в волну на 3+ метра — см. жалобы «корабль погружается по борт»)
    this.torque.x += spd * spd * m * 0.0012;

    // --- сопротивление (по связным осям) ---
    const vLocal = this.velocity.clone();
    const fwdSpd = vLocal.dot(f);
    const latSpd = vLocal.dot(right);
    const fwdDrag = -Math.sign(fwdSpd) * (18 * fwdSpd + 55 * fwdSpd * Math.abs(fwdSpd)) * m * 0.001;
    const latDrag = -latSpd * (3.2) * m * 0.1;
    this.force.x += f.x * fwdDrag + right.x * latDrag;
    this.force.z += f.z * fwdDrag + right.z * latDrag;
    this.force.y -= this.velocity.y * m * 0.12; // вертикальное демпфирование
    if (this.anchored) {
      this.force.x -= this.velocity.x * m * 1.2;
      this.force.z -= this.velocity.z * m * 1.2;
    }
    if (this.grounded) {
      this.force.x -= this.velocity.x * m * 2.5;
      this.force.z -= this.velocity.z * m * 2.5;
    }

    // --- угловое демпфирование по связным осям ---
    const invQ = this.tmpQ.copy(this.quaternion).invert();
    const ab = this._t3.copy(this.angular).applyQuaternion(invQ); // связные
    ab.x *= Math.exp(-1.6 * dt);  // дифферент
    ab.y *= Math.exp(-0.9 * dt);  // рыскание
    ab.z *= Math.exp(-1.1 * dt);  // крен
    this.angular.copy(ab.applyQuaternion(this.quaternion));

    // --- ограничение крена/дифферента (мягкие стопы) ---
    // дифферент жёстко: 0.14 рад (8°) — нос не может нырнуть под гребень;
    // крен 0.36 рад (20°) — подветренный борт остаётся над водой
    const roll = e.z, pitch = e.x;
    const rollLim = 0.36, pitchLim = 0.14;
    if (Math.abs(roll) > rollLim) this.torque.z -= (roll - Math.sign(roll) * rollLim) * m * 9.0;
    if (Math.abs(pitch) > pitchLim) this.torque.x -= (pitch - Math.sign(pitch) * pitchLim) * m * 12.0;
    // затопление кренит корабль в сторону пробоин
    this.floodRoll(m);
    if (this.sinking) {
      this.sinkT += dt;
      this.force.y -= m * G * Math.min(0.9, this.sinkT / 9); // неотвратимое погружение
      this.torque.x += m * 0.25 * Math.sign(roll || 1);
      this.torque.z += m * 0.4 * Math.sign(roll || 1);
    }

    // --- интеграция ---
    this.velocity.addScaledVector(this.force, dt / m);
    this.position.addScaledVector(this.velocity, dt);
    // α = I⁻¹ τ в связных осях
    const tb = this._t3.copy(this.torque).applyQuaternion(invQ);
    tb.x /= this.inertia.x; tb.y /= this.inertia.y; tb.z /= this.inertia.z;
    this.angular.addScaledVector(tb.applyQuaternion(this.quaternion), dt);
    // ограничим угловые скорости
    const wLen = this.angular.length();
    if (wLen > 1.1) this.angular.multiplyScalar(1.1 / wLen);
    // q̇ = 0.5 · ω⊗q → q_new = q + 0.5·dt·(ωx,ωy,ωz,0)⊗q, потом нормализация
    this.wq.set(this.angular.x, this.angular.y, this.angular.z, 0);
    this.dq.copy(this.wq).multiply(this.quaternion); // dq = ω ⊗ q
    const qs = 0.5 * dt;
    this.quaternion.set(
      this.quaternion.x + this.dq.x * qs,
      this.quaternion.y + this.dq.y * qs,
      this.quaternion.z + this.dq.z * qs,
      this.quaternion.w + this.dq.w * qs
    ).normalize();

    // --- посадка на мель / столкновение с землёй ---
    this.checkGrounding(dt);

    // --- течение воды в трюме ---
    if (this.leakRate > 0) {
      this.water = Math.min(this.holdCap, this.water + this.leakRate * dt);
    }
    if (this.onFire) {
      this.fireT += dt;
      this.hullHP -= dt * 1.6;
      if (this.fireT > 26) { this.onFire = false; this.fireT = 0; } // выгорит
      if (Math.random() < dt * 1.2) {
        const p = this.particles;
        const wp = this.position.clone();
        p.fire(wp.x + (Math.random() - 0.5) * 4, this.waterlineY() + 1 + Math.random() * 2, wp.z + (Math.random() - 0.5) * 10);
        p.smoke(wp.x + (Math.random() - 0.5) * 4, this.waterlineY() + 3, wp.z + (Math.random() - 0.5) * 10, this.wind ? Math.cos(this.wind.from + Math.PI) * 2 : 0, 2.2, this.wind ? Math.sin(this.wind.from + Math.PI) * 2 : 0, 3, 3.5);
      }
    }
    // порог затопления
    if (!this.sinking && this.water > this.holdCap * 0.62) this.startSinking();
    if (this.hullHP <= 0 && !this.sinking) this.startSinking();

    // --- сдался? ---
    if (!this.isPlayer && !this.surrendered && !this.sinking) {
      if (this.hullHP < this.hullMax * 0.34 || this.crew < this.preset.maxCrew * 0.25) {
        this.surrendered = true;
        this.sailTarget = 0;
        this.onSurrender?.(this);
      }
    }

    if (this.sinking && this.sinkT > 14 && !this.sunk) {
      this.sunk = true;
      this.visual.group.visible = false;
      this.onSunk?.(this);
    }
  }

  private checkGrounding(dt: number) {
    if (this.sinking || this.sunk) return;
    const f = this.forward;
    const bow = this.tmpV.copy(this.position).addScaledVector(f, this.preset.length * 0.42);
    const stern = this.tmpV2.copy(this.position).addScaledVector(f, -this.preset.length * 0.42);
    let hit = false;
    for (const p of [bow, stern]) {
      const th = this.terrainHeight(p.x, p.z);
      if (th > this.position.y - this.preset.draft * 0.6) {
        hit = true;
        // нормаль склона
        const e = 2;
        const nx = this.terrainHeight(p.x - e, p.z) - this.terrainHeight(p.x + e, p.z);
        const nz = this.terrainHeight(p.x, p.z - e) - this.terrainHeight(p.x, p.z + e);
        const n = new THREE.Vector3(nx, 2 * e, nz).normalize();
        this.force.addScaledVector(n, this.mass * 22);
        this.velocity.multiplyScalar(0.94);
      }
    }
    if (hit) {
      if (!this.grounded && this.speed() > 3.5) {
        this.applyDamage({ kind: 'ground', amount: 5 + this.speed() });
      }
      this.grounded = true;
    } else this.grounded = false;
  }

  waterlineY(): number {
    return this.position.y;
  }

  // ---------- повреждения ----------
  applyDamage(d: DamageInput) {
    if (this.sunk || this.sinking) return;
    const rng = Math.random;
    switch (d.kind) {
      case 'ball': {
        this.hullHP -= d.amount;
        if (d.hitPoint && d.hitPoint.y < 0.45 + this.position.y) this.addLeak(0.06 + rng() * 0.05);
        if (rng() < 0.3) this.crew = Math.max(0, this.crew - 1);
        // случайный «рикошет в рангоут» — редкий, основную работу делают
        // прицельные попадания из CombatSystem (mast hits)
        if (rng() < 0.10) this.breakMast();
        break;
      }
      case 'chain': {
        this.sailHP = Math.max(0, this.sailHP - d.amount);
        if (rng() < 0.25) this.crew = Math.max(0, this.crew - 1);
        break;
      }
      case 'grape': {
        this.crew = Math.max(0, this.crew - Math.round(d.amount));
        this.hullHP -= d.amount * 0.4;
        break;
      }
      case 'fire': {
        this.hullHP -= d.amount;
        if (rng() < 0.35 && !this.onFire) { this.onFire = true; this.fireT = 0; }
        if (rng() < 0.08) { this.addLeak(0.03); }
        break;
      }
      case 'ram': {
        this.hullHP -= d.amount;
        if (rng() < 0.5) this.addLeak(0.04);
        break;
      }
      case 'ground': this.hullHP -= d.amount * 0.5; break;
    }
    if (this.hullHP <= 0 && !this.sinking) this.startSinking();
    if (!this.isPlayer && !this.noSurrender && !this.surrendered && this.hullHP < this.hullMax * 0.34) {
      this.surrendered = true; this.sailTarget = 0; this.onSurrender?.(this);
    }
  }

  /** Урон в КОНКРЕТНУЮ мачту (прицельное попадание ядром/книппелем) */
  damageMast(idx: number, amount: number): boolean {
    if (idx < 0 || idx >= this.mastHP.length) return false;
    if (this.mastFall[idx] >= 0) return false; // уже сломана
    this.mastHP[idx] -= amount;
    if (this.mastHP[idx] <= 0) { this.breakMast(idx); return true; }
    return false;
  }

  addLeak(rate: number) {
    this.leakRate = Math.min(1.8, this.leakRate + rate);
    if (this.leakRate < 0) this.leakRate = 0;
  }

  /** Пробоина в борту: декаль + течь (ниже ватерлинии) + кренящий момент */
  addHole(localPos: THREE.Vector3, belowWL: boolean) {
    const side = localPos.x >= 0 ? 1 : -1;
    // тёмная «рваная» дыра: круг + обломки досок вокруг
    const g = new THREE.CircleGeometry(0.34 + Math.random() * 0.14, 9);
    const mat = new THREE.MeshStandardMaterial({ color: 0x120d08, roughness: 1 });
    const mesh = new THREE.Mesh(g, mat);
    const w = Math.max(0.3, this.halfWidthAt(localPos.z) * 0.985);
    mesh.position.set(side * w, localPos.y, localPos.z);
    mesh.rotation.y = side * Math.PI / 2;
    mesh.rotation.x = (Math.random() - 0.5) * 0.5;
    this.visual.group.add(mesh);
    this.hullHoles.push({ side, belowWL, mesh });
    if (belowWL) {
      this.addLeak(0.16 + Math.random() * 0.10);
      this.leakBias = clamp(this.leakBias + side * 0.35, -1, 1);
    }
  }

  /** Затопление: крен в сторону пробоин + вода в трюме утяжеляет */
  private floodRoll(m: number) {
    if (this.water <= 0 || this.sinking) return;
    const frac = this.water / this.holdCap;
    this.torque.z += this.leakBias * frac * m * 0.06;
  }

  breakMast(idx?: number) {
    let i = idx;
    if (i === undefined || i < 0 || i >= this.visual.masts.length || this.mastFall[i] >= 0) {
      // без указания — случайная целая мачта
      const intact = this.mastFall.map((f, k) => f < 0 ? k : -1).filter(k => k >= 0);
      if (!intact.length) return;
      i = intact[Math.floor(Math.random() * intact.length)];
    }
    this.mastFall[i] = 0;
    this.mastsBroken = this.mastFall.filter(f => f >= 0).length;
    this.sailHP = Math.max(0, this.sailHP - 30);
    if (this.sailTarget > 0) this.sailTarget = Math.max(0, this.sailTarget - 1);
  }

  /** Сброс ВСЕХ повреждений (полигон/возрождение): корпус, мачты,
   *  паруса, пробоины, течь, пожар, экипаж */
  clearDamage() {
    this.hullHP = this.hullMax;
    this.sailHP = this.preset.sailHP;
    this.water = 0;
    this.leakRate = 0;
    this.leakBias = 0;
    this.onFire = false;
    this.fireT = 0;
    this.sinking = false;
    this.sinkT = 0;
    this.sunk = false;
    this.surrendered = false;
    this.mastsBroken = 0;
    this.mastAnim = -1;
    for (let i = 0; i < this.visual.masts.length; i++) {
      this.mastHP[i] = this.mastMaxHP;
      this.mastFall[i] = -1;
      const m = this.visual.masts[i];
      m.rotation.set(0, 0, 0);
      m.position.y = 0;
    }
    for (const h of this.hullHoles) {
      this.visual.group.remove(h.mesh);
      h.mesh.geometry.dispose();
      (h.mesh.material as THREE.Material).dispose();
    }
    this.hullHoles = [];
    this.crew = Math.round(this.preset.maxCrew * 0.8);
    this.visual.group.visible = true;
    this.velocity.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.sailTarget = 0;
    this.rudder = 0;
    this.rudderTarget = 0;
  }

  startSinking() {
    if (this.sinking) return;
    this.sinking = true;
    this.sinkT = 0;
    this.onFire = false;
  }

  /** Действие команды (R): пожар -> течь -> ремонт */
  crewAction(dt: number): string | null {
    if (this.onFire) { this.fireT += dt * 3; if (this.fireT > 4) { this.onFire = false; this.fireT = 0; return 'Пожар потушен'; } return 'Тушение пожара...'; }
    if (this.water > 0.01) {
      const pump = 0.05 + this.crew * 0.004;
      this.water = Math.max(0, this.water - pump * dt);
      this.leakRate = Math.max(0, this.leakRate - 0.004 * dt);
      return this.water > 0.05 ? 'Откачка воды...' : 'Трюм осушён';
    }
    if (this.hullHP < this.hullMax && this.planks > 0) {
      this.hullHP = Math.min(this.hullMax, this.hullHP + 0.9 * dt);
      this.planks -= dt * 0.15;
      return 'Ремонт корпуса...';
    }
    return null;
  }

  // ---------- визуал ----------
  updateVisual(time: number, dt: number, particles: Particles) {
    const v = this.visual;
    v.group.position.copy(this.position);
    v.group.quaternion.copy(this.quaternion);

    // паруса: количество поставленных парусов соответствует ФАКТИЧЕСКОЙ
    // СКОРОСТИ — экипаж ставит паруса по мере разгона и убирает по мере
    // остановки; уровень W/S задаёт максимум. Рея брасопится по ветру,
    // «пузо» — по кажущемуся ветру. Паруса СЛОМАННОЙ мачты обвисают.
    const awa = this.apparentWindAngle();
    const polar = Ship.polar(awa);
    const windClamp = clamp(this.wind.speed / 9, 0.3, 1.4);
    // скорость, достижимая под полным парусным вооружением в этот ветер
    // (корень из тяги — сопротивление квадратично): ~0.85·maxSpeed
    const windPow = Math.pow(clamp(this.wind.speed / 8.0, 0.05, 1.6), 1.6);
    const attainable = this.preset.maxSpeed * 0.85 * Math.sqrt(clamp(polar * windPow, 0, 1.5));
    // в левентик/штиль паруса остаются на мачтах и трепещут (не убираются
    // механически) — убираются только когда есть чем идти, но нет хода
    const spdSetFrac = attainable > 1.5 ? clamp(this.speed() / attainable, 0, 1) : 1;
    const setTotal = Math.min(this.sailFrac, spdSetFrac);
    // локальный вектор «откуда дует» (x — борт, z — нос): ψ = φ + курс
    const psi = this.wind.from + this.heading;
    const wlX = Math.cos(psi); // >0 — ветер с порта (левый борт)
    // цель брасопки: рея поперёк ветра (нормаль паруса по ветру), ±55°
    let bt = Math.atan2(wlX, Math.sin(psi)) - Math.PI;
    bt = Math.atan2(Math.sin(bt), Math.cos(bt)); // кратчайшая дуга
    const braceTarget = clamp(bt, -0.96, 0.96);
    const bellyBase = (0.35 + 0.95 * windClamp) * (0.15 + 0.85 * polar);
    const flutterBase = 0.012 * windClamp * (1 + (1 - polar) * 2.2);
    for (const s of v.sails.sails) {
      // мачта-носитель сломана → парус безжизненно обвисает
      const mastDead = s.mastIndex !== undefined && this.mastFall[s.mastIndex] >= 0;
      // доля постановки этого паруса при текущей скорости хода
      const setFrac = mastDead ? 0 : smoothstep(s.setAt - 0.38, s.setAt, setTotal);
      s.furl += ((1 - setFrac) - s.furl) * Math.min(1, dt * (mastDead ? 2.2 : 1.1));
      const sf = 1 - s.furl;
      s.mat.uniforms.uTime.value = time;
      s.mat.uniforms.uFurl.value = s.furl;
      s.mat.uniforms.uDamage.value = 1 - this.sailHP / this.preset.sailHP;
      s.mat.uniforms.uFlutter.value = flutterBase * (0.25 + 0.75 * sf);
      if (s.square && s.brace) {
        // реи разворачиваются медленно — как будто работают брашпили
        s.braceAngle += ((mastDead ? 0 : braceTarget) - s.braceAngle) * Math.min(1, dt * 0.5);
        s.brace.rotation.y = s.braceAngle;
        s.mat.uniforms.uBelly.value = mastDead ? 0 : bellyBase * sf;
      } else {
        // кливер: пузо в подветренную сторону (локальный Z → борт)
        s.mat.uniforms.uBelly.value = mastDead ? 0 : bellyBase * sf * (-wlX);
      }
    }

    // флаг — по ветру
    const wf = Math.atan2(-Math.cos(this.wind.from), -Math.sin(this.wind.from));
    v.flag.rotation.y = wf - this.heading + Math.PI;
    v.flagMat.uniforms.uTime.value = time;

    // штурвал крутится от руля: D (руль вправо) — по часовой от рулевого
    v.wheel.rotation.z = this.rudder * 2.2;

    // падение мачт: каждая валится вперёд-вбок со своим наклоном,
    // реи и паруса едут вместе с мачтой (они её потомки)
    for (let i = 0; i < v.masts.length; i++) {
      const f = this.mastFall[i];
      if (f >= 0 && f < 1) {
        this.mastFall[i] = Math.min(1, f + dt * 0.42);
        const k = this.mastFall[i];
        const lean = (i % 2 === 0 ? 1 : -1) * 0.3;
        v.masts[i].rotation.x = k * 1.25;
        v.masts[i].rotation.z = k * lean;
        v.masts[i].position.y = -k * 1.6;
      }
    }

    // пенный воротник по ватерлинии
    if (!this.sunk) {
      const wy = waterHeightAt(this.position.x, this.position.z, time);
      this.foam.mesh.position.set(this.position.x, wy + 0.28, this.position.z);
      this.foam.mesh.rotation.y = this.heading;
      const spdFrac = clamp(this.speed() / this.preset.maxSpeed, 0, 1);
      this.foam.update(time, spdFrac, this.euler.z);
    } else {
      this.foam.mesh.visible = false;
    }

    // кильватерный след
    const sternW = this.tmpV.set(0, 0, -this.preset.length * 0.48)
      .applyQuaternion(this.quaternion).add(this.position);
    const spdFrac = clamp(this.speed() / this.preset.maxSpeed, 0, 1);
    if (!this.sunk && !this.grounded) {
      this.wake.push(sternW, spdFrac, dt, time);
    }
    this.wake.update(time);

    // носовой бурун: брызги при ударе носа о волну
    if (!this.sunk) {
      const bowW = this.tmpV2.set(0, -this.preset.draft * 0.3, this.preset.length * 0.46)
        .applyQuaternion(this.quaternion).add(this.position);
      const waveY = waterHeightAt(bowW.x, bowW.z, time);
      const relV = this.velocity.y - (waveY - this.lastStern.y) * 0; // грубая оценка
      const impact = (waveY - bowW.y) * (0.3 + spdFrac);
      if (impact > 0.55 && Math.random() < 0.6) {
        particles.splash(bowW.x, waveY, bowW.z, 0.5 + spdFrac * 0.9);
      }
      if (spdFrac > 0.35 && Math.random() < spdFrac * 0.5) {
        particles.spawn(bowW.x + (Math.random() - 0.5) * 2, waveY + 0.1, bowW.z + (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5 * spdFrac, (Math.random() - 0.5) * 2,
          0.5, 0.3 + Math.random() * 0.35, 0, 0.4, 10);
      }
      // крен: всплески у борта
      const roll = this.euler.z;
      this.rollSmooth += (roll - this.rollSmooth) * Math.min(1, dt * 3);
      if (Math.abs(this.rollSmooth) > 0.28 && Math.random() < 0.3) {
        const side = Math.sign(this.rollSmooth) * this.preset.beam * 0.5;
        const px = this.position.x + Math.cos(this.heading) * side;
        const pz = this.position.z - Math.sin(this.heading) * side;
        particles.splash(px, waterHeightAt(px, pz, time), pz, 0.5);
      }
    }

    // экипаж: анимация, потери (фигуры скрываются), эвакуация при потоплении
    this.crew3d.update(dt, time, {
      crew: this.crew, maxCrew: this.preset.maxCrew,
      sinking: this.sinking, sunk: this.sunk,
    });
  }

  /** Сдвиг мира (floating origin) */
  shiftWorld(delta: THREE.Vector3) {
    this.position.add(delta);
    this.wake.shiftWorld(delta);
  }

  dispose() {
    this.visual.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
