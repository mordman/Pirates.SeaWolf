import * as THREE from 'three';
import { waterHeightAt, waterNormalAt } from '../water/waves';
import { updateBoatFalls, type BoatVis } from './buildShip';
import type { Ship } from './Ship';
import { buildFigure, rollTraits, mulberry32 } from './crew';
import type { Particles } from '../fx/particles';
import { WakeTrail } from '../water/wake';

// ============================================================
// СПУСК ШЛЮПКИ НА ВОДУ (по замечанию игрока: «можно спустить
// шлюпку на воду и управлять ей, пока не вернёшься обратно на
// борт корабля; добавь анимацию спуска и подъёма»).
//
// Фазы:
//   stowed  — ял висит на БОРТОВЫХ шлюпбалках ВДОЛЬ борта —
//             БОРТОМ К БОРТУ с корпусом, носом к носу корабля (Task 26)
//   lowering— ФАЛЫ ТРАВЯТСЯ: шлюпка опускается за борт к воде
//             (лёгкое покачивание на талях, дрейф от обшивки)
//   afloat  — на воде: отдельная сущность в мире; W/S — вёсла
//             (гребки синхронные, импульс в рабочей фазе),
//             A/D — поворот вёслами (руля нет); качка на волнах
//             Gerstner, вёсла развёрнуты на воду, гребцы качаются
//             в такт; за транцем — пенный след
//   raising — подъём: подтяжка под шлюпбалки (мир) → репарент →
//             выборка талов до исходного положения. Доворот курса —
//             ВСЕГДА по кратчайшей дуге с гашением крена/дифферента:
//             старый slerp на ~180° ПЕРЕВОРАЧИВАЛ шлюпку через борт
//             (замечание игрока Task 25).
//
// Управление шлюпкой — ПОКА игрок не вернётся на борт (B у борта
// у шлюпбалок). Условие спуска: малый ход/якорь, шлюпка цела, есть
// экипаж.
// ============================================================

export type BoatPhase = 'stowed' | 'lowering' | 'afloat' | 'raising';

const LOWER_DUR = 7.0;     // спуск/подъём, с
const PULL_DUR = 2.8;      // подтяжка к шлюпбалкам, с
const MAX_FWD = 1.9;       // м/с под вёслами (~3.7 уз)
const MAX_REV = 0.85;
const SWEEP = 0.5;         // размах гребка, рад
const DIP = 0.34;          // погружение лопасти, рад
const DIP0 = 0.12;         // статичный наклон к воде

const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
/** приведение угла к [−π, π] — повороты ТОЛЬКО по кратчайшей дуге */
const wrapPi = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

export interface LaunchDeps {
  ship: Ship;
  worldGroup: THREE.Group;   // контейнер кораблей (лодка на воде — здесь)
  particles: Particles;
  islands: () => { cx: number; cz: number; r: number }[];
  msg?: (text: string) => void;
  onSplash?: () => void;
}

export class BoatLaunch {
  phase: BoatPhase = 'stowed';
  t = 0;                    // прогресс фазы 0..1
  raiseStage = 0;           // raising: 0 — подтяжка, 1 — выборка талов
  row = 0;                  // команда гребли: +1 вперёд, −1 назад
  steer = 0;                // румпель −1..1

  private ship: Ship;
  private worldGroup: THREE.Group;
  private particles: Particles;
  private islands: () => { cx: number; cz: number; r: number }[];
  private msg?: (text: string) => void;
  private onSplash?: () => void;
  private vis: BoatVis | null;

  // --- состояние на воде (мировые координаты контейнера) ---
  pos = new THREE.Vector3();
  heading = 0;              // куда смотрит НОС шлюпки
  vel = 0;                  // продольная скорость, м/с (может быть < 0)
  yawRate = 0;
  strokePhase = 0;
  oarDeploy = 0;
  roll = 0; pitch = 0;

  // гребцы в шлюпке (видны только на воде)
  rowers: THREE.Group[] = [];
  // СЛЕД ОТ ШЛЮПКИ (Task 26: «сделай след от лодки»): узкая пенная
  // дорожка за транцем яла на ходу под вёслами — та же лента, что и
  // кильватер корабля, но в масштабе шлюпки; пена Заметная (широкая
  // полоса с турбулентным клином — как след от вёсел на воде)
  readonly wake = new WakeTrail({
    spacing: 0.8, lifetime: 14, maxPts: 140,
    width0: 0.34, widthSpd: 0.5, alpha0: 0.36, alphaSpd: 0.6,
    yOff: 0.12, widen: 3.6,
  });
  // подтяжка: откуда стартует шлюпка (мир)
  private pullFrom = new THREE.Vector3();
  private pullQuat = new THREE.Quaternion();
  private pullY = 0;          // локальная высота начала выборки талов
  private pullPos = new THREE.Vector3();   // старт выборки талов (локалы корабля)
  private splashed = false;
  private groundCd = 0;       // кулдаун сообщения об отмели

  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _qi = new THREE.Quaternion();
  private _e = new THREE.Euler();
  private _n: [number, number, number] = [0, 1, 0];

  constructor(d: LaunchDeps) {
    this.ship = d.ship;
    this.worldGroup = d.worldGroup;
    this.particles = d.particles;
    this.islands = d.islands;
    this.msg = d.msg;
    this.onSplash = d.onSplash;
    this.vis = d.ship.visual.boat ?? null;
    // след пены за шлюпкой — в контейнер мира (координаты те же, что pos)
    this.wake.setWaterHeight(waterHeightAt);
    this.worldGroup.add(this.wake.mesh);
    if (this.vis) {
      // два гребца на банке (появляются при спуске): сидят лицом
      // к корме, качаются в такт гребков
      const rnd = mulberry32(20240);
      for (const side of [-1, 1] as const) {
        const f = buildFigure('rower', rollTraits(rnd, 'rower'), Math.floor(rnd() * 99999));
        const thY = this.vis.gunY - 0.235;
        f.group.position.set(side * this.vis.beam * 0.17, thY - 0.26, this.vis.rowZ + 0.3);
        f.group.rotation.y = Math.PI;      // лицом к корме
        f.group.scale.y = 0.78;
        f.group.visible = false;
        f.group.userData.isBoatRower = true;
        this.vis.group.add(f.group);
        this.rowers.push(f.group);
      }
    }
  }

  /** игрок в шлюпке (управление кораблём отключено)? */
  inBoat(): boolean { return this.phase !== 'stowed'; }

  /** убрать за собой: след пены снимается со сцены (смена корабля) */
  dispose() {
    this.wake.clear();
    this.wake.mesh.parent?.remove(this.wake.mesh);
  }

  /** расстояние от шлюпки до шлюпбалок борта (для HUD/подъёма) */
  distToHoist(): number {
    if (!this.vis) return Infinity;
    if (this.phase === 'afloat') {
      this._v.copy(this.vis.stowPos)
        .applyQuaternion(this.ship.quaternion).add(this.ship.position);
      return Math.hypot(this.pos.x - this._v.x, this.pos.z - this._v.z);
    }
    return 0;
  }

  /** ПОПЫТКА СПУСКА. Возвращает текст ошибки или null (успех) */
  tryLaunch(docked: boolean): string | null {
    if (!this.vis) return 'На этом судне нет шлюпки';
    if (this.phase !== 'stowed') return null;
    if (!this.vis.group.visible) return 'Шлюпка разбита — в море не починить';
    if (this.ship.sinking || this.ship.sunk) return 'Корабль тонет — не до шлюпки!';
    if (docked) return 'В порту шлюпка не нужна — причал рядом';
    if (this.ship.crew < 1) return 'Некому грести — нужен хоть один человек команды';
    if (!this.ship.anchored && this.ship.speedKnots() > 2.6) {
      return 'Слишком большой ход — уберите паруса или отдайте якорь (F)';
    }
    this.phase = 'lowering';
    this.t = 0;
    this.splashed = false;
    this.setRowersVisible(true);   // команда заняла места на банках
    return null;
  }

  /** ПОПЫТКА ПОДЪЁМА (когда шлюпка на воде). Ошибка или null */
  tryHoist(): string | null {
    if (this.phase !== 'afloat' || !this.vis) return null;
    if (this.ship.sunk) return 'Корабль ушёл под воду — подниматься некуда…';
    const d = this.distToHoist();
    if (d > 15) return `Далеко от шлюпбалок (${Math.round(d)} м) — подойдите к борту`;
    if (Math.abs(this.vel) > 1.25) return 'Замрите ход перед подъёмом';
    // старт подтяжки
    this.pullFrom.copy(this.vis.group.position);
    this.pullQuat.copy(this.vis.group.quaternion);
    this.phase = 'raising';
    this.raiseStage = 0;
    this.t = 0;
    return null;
  }

  /** Немедленно вернуть шлюпку на шлюпбалки (смена корабля/смерть) */
  abort() {
    if (!this.vis || this.phase === 'stowed') return;
    const b = this.vis.group;
    if (b.parent !== this.vis.falls.parent) {
      // шлюпка была в мире — вернуть в группу мелких деталей
      this.vis.falls.parent?.add(b);
    }
    b.position.copy(this.vis.stowPos);
    b.rotation.set(0, this.vis.stowRotY, 0);
    b.quaternion.setFromEuler(new THREE.Euler(0, this.vis.stowRotY, 0));
    this.setRowersVisible(false);
    this.oarDeploy = 0;
    this.stowOars();
    this.phase = 'stowed';
    this.t = 0;
    this.vel = 0;
    this.yawRate = 0;
    this.row = 0;
    this.steer = 0;
    updateBoatFalls(this.vis);
  }

  private setRowersVisible(v: boolean) {
    for (const r of this.rowers) r.visible = v;
  }

  private stowOars() {
    if (!this.vis) return;
    for (const o of this.vis.oars) {
      const sq = o.userData.stowQ as THREE.Quaternion;
      if (sq) o.quaternion.copy(sq);
    }
  }

  update(dt: number, time: number) {
    if (!this.vis) return;
    const b = this.vis.group;
    // шлюпку разбило прямо во время спуска/на воде — подобрать игрока
    if (!b.visible && this.phase !== 'stowed') {
      this.abort();
      this.msg?.('Шлюпку разнесло щепой! Вас подобрали на борт');
      return;
    }
    switch (this.phase) {
      case 'stowed': {
        // фалы слегка тянутся от качки корабля
        if (Math.random() < dt * 4) updateBoatFalls(this.vis);
        break;
      }
      case 'lowering': {
        this.t += dt / LOWER_DUR;
        const k = sm(this.t);
        // цель: планширь шлюпки на уровень воды (в локалах корабля)
        this._v.copy(b.position).applyQuaternion(this.ship.quaternion).add(this.ship.position);
        const wy = waterHeightAt(this._v.x, this._v.z, time);
        const targetY = this.vis.stowPos.y + (wy + 0.12 - this._v.y);
        b.position.y = THREE.MathUtils.lerp(this.vis.stowPos.y, targetY, k);
        // лёгкий дрейф ОТ обшивки — чистый спуск за борт
        b.position.x = THREE.MathUtils.lerp(this.vis.stowPos.x, this.vis.stowPos.x + Math.sign(this.vis.stowPos.x || 1) * 0.35, k);
        b.rotation.z = Math.sin(k * Math.PI) * 0.05;   // покачивание на талях
        updateBoatFalls(this.vis);
        if (this.t >= 1) this.detachToWater(time);
        break;
      }
      case 'afloat': {
        this.floatUpdate(dt, time);
        break;
      }
      case 'raising': {
        if (this.raiseStage === 0) {
          // подтяжка: шлюпка в МИРЕ подтягивается под шлюпбалки борта
          this.t += dt / PULL_DUR;
          const k = sm(this.t);
          this._v.set(this.vis.stowPos.x * 0.8, this.vis.stowPos.y * 0.55, this.vis.stowPos.z)
            .applyQuaternion(this.ship.quaternion).add(this.ship.position);
          this._v.y = Math.max(this._v.y, waterHeightAt(this._v.x, this._v.z, time) + 0.9);
          b.position.lerpVectors(this.pullFrom, this._v, k);
          // доворот к курсу корабля — по кратчайшей дуге, крен/дифферент
          // гаснут (никаких переворотов через борт на ~180°)
          this._e.setFromQuaternion(b.quaternion, 'YXZ');
          const dy = wrapPi(this.ship.heading - this._e.y);
          this._e.set(this._e.x * (1 - k), this._e.y + dy * k, this._e.z * (1 - k), 'YXZ');
          b.quaternion.setFromEuler(this._e);
          // фалы тянутся к поднимаемой шлюпке (мировые → локальные корабля)
          this.fallsToBoat();
          if (this.t >= 1) {
            // репарент в группу мелких деталей (мировая поза сохранится)
            this.vis.falls.parent?.attach(b);
            this.raiseStage = 1;
            this.t = 0;
            this.pullY = b.position.y;
            this.pullPos.copy(b.position);
            this.setRowersVisible(false);
          }
        } else {
          // выборка талов: подъём от борта до шлюпбалок
          this.t += dt / LOWER_DUR;
          const k = sm(this.t);
          b.position.lerpVectors(this.pullPos, this.vis.stowPos, k);
          b.rotation.z = Math.sin(k * Math.PI) * 0.05;
          // курс — к stowRotY по кратчайшей дуге, качка гаснет
          this._e.setFromQuaternion(b.quaternion, 'YXZ');
          const k2 = Math.min(1, dt * 2.5);
          const dy = wrapPi(this.vis.stowRotY - this._e.y);
          this._e.set(this._e.x * (1 - k2), this._e.y + dy * k2, this._e.z * (1 - k2), 'YXZ');
          b.quaternion.setFromEuler(this._e);
          // вёсла убираются на планширь по мере подъёма
          this.oarDeploy = Math.max(0, 1 - k * 1.6);
          this.animateOars(0, false);
          updateBoatFalls(this.vis);
          if (this.t >= 1) {
            b.position.copy(this.vis.stowPos);
            this._q.setFromEuler(this._e.set(0, this.vis.stowRotY, 0));
            b.quaternion.copy(this._q);
            b.rotation.set(0, this.vis.stowRotY, 0);
            this.stowOars();
            this.phase = 'stowed';
            this.oarDeploy = 0;
            updateBoatFalls(this.vis);
          }
        }
        break;
      }
    }
    // лента следа живёт всегда: точки стареют и тают и после подъёма
    this.wake.update(time);
  }

  /** фалы к шлюпке в МИРЕ (подтяжка): концы — позиция шлюпки,
   *  пересчитанная в локальные координаты корабля. Носовая балка —
   *  к планширю НОСА, кормовая — к планширю кормы (±gunX) */
  private fallsToBoat() {
    if (!this.vis) return;
    const b = this.vis.group;
    const attr = this.vis.falls.geometry.getAttribute('position') as THREE.BufferAttribute;
    this._qi.copy(this.ship.quaternion).invert();
    // центр шлюпки в локалах корабля
    const c = this._v2.copy(b.position).sub(this.ship.position).applyQuaternion(this._qi);
    const rotY = this.vis.stowRotY;   // шлюпка выровнена вдоль борта
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    let i = 0;
    for (let hi = 0; hi < this.vis.davitHeads.length; hi++) {
      const head = this.vis.davitHeads[hi];
      const zo = (hi === 0 ? 1 : -1) * this.vis.hangZ;
      for (const xs of [this.vis.gunX, -this.vis.gunX]) {
        // точка планширя шлюпки (xs, gunY, zo), поворот на rotY
        const px = xs * cos + zo * sin;
        const pz = -xs * sin + zo * cos;
        attr.setXYZ(i, head.x, head.y, head.z);
        attr.setXYZ(i + 1, c.x + px, c.y + this.vis.gunY, c.z + pz);
        i += 2;
      }
    }
    attr.needsUpdate = true;
  }

  /** отдача талов: шлюпка — самостоятельная сущность на воде */
  private detachToWater(time: number) {
    if (!this.vis) return;
    const b = this.vis.group;
    this.worldGroup.attach(b);
    // шлюпка висела носом вдоль корпуса (к носу корабля) —
    // курс на воде = курсу корабля
    this.pos.set(b.position.x, b.position.y, b.position.z);
    this.heading = this.ship.heading;
    this.vel = 0;
    this.yawRate = 0;
    this.strokePhase = 0;
    this.phase = 'afloat';
    this.splashed = false;
    this.setRowersVisible(true);
    updateBoatFalls(this.vis, true);   // хвосты талов у шлюпбалок
    this.msg?.('Шлюпка на воде! W/S — вёсла, A/D — поворот вёслами. B у борта — подняться на борт');
  }

  /** жизнь на воде: гребля, руль, качка, коллизии */
  private floatUpdate(dt: number, time: number) {
    if (!this.vis) return;
    const b = this.vis.group;
    // --- гребля: импульс только в рабочей фазе (sin φ > 0) ---
    const rowing = this.row !== 0;
    if (rowing) {
      this.strokePhase += dt * (2.0 + Math.min(1, Math.abs(this.vel) / 1.4)) * Math.PI;
    }
    const power = rowing ? Math.max(0, Math.sin(this.strokePhase)) : 0;
    this.vel += this.row * power * dt * 1.5;
    this.vel -= this.vel * Math.abs(this.vel) * 0.34 * dt + this.vel * 0.14 * dt;
    this.vel = THREE.MathUtils.clamp(this.vel, -MAX_REV, MAX_FWD);
    // --- поворот дифференциальной греблёй (руля нет: на заднем
    //     ходу руление зеркально) ---
    const turn = this.steer * (0.3 + Math.min(1.0, Math.abs(this.vel)) * 0.34);
    this.yawRate += (turn - this.yawRate) * Math.min(1, dt * 3.2);
    this.heading += this.yawRate * dt * (this.vel < -0.05 ? -1 : 1);
    this.pos.x += Math.sin(this.heading) * this.vel * dt;
    this.pos.z += Math.cos(this.heading) * this.vel * dt;

    // --- острова: не заплыть внутрь ---
    this.groundCd = Math.max(0, this.groundCd - dt);
    for (const isl of this.islands()) {
      const dx = this.pos.x - isl.cx, dz = this.pos.z - isl.cz;
      const d = Math.hypot(dx, dz);
      const r = isl.r * 0.72 + 2;
      if (d < r && d > 1e-3) {
        this.pos.x = isl.cx + dx / d * r;
        this.pos.z = isl.cz + dz / d * r;
        this.vel *= 0.35;
        if (this.groundCd <= 0) {
          this.msg?.('Шлюпка ткнулась в отмель');
          this.groundCd = 4;
        }
      }
    }
    // --- корабль: отталкивание от корпуса (по ОБВОДАМ — борт
    //     следует кривизне корпуса: шлюпка скользит вдоль обшивки
    //     «бортом к борту», не отскакивая коробкой) ---
    {
      this._qi.copy(this.ship.quaternion).invert();
      this._v.copy(this.pos).sub(this.ship.position).applyQuaternion(this._qi);
      const L = this.ship.preset.length;
      if (Math.abs(this._v.z) < L * 0.55) {
        const hw = this.ship.halfWidthAt(this._v.z) + 0.75;  // борт + полуширина яла + зазор
        if (Math.abs(this._v.x) < hw) {
          // вытолкнуть поперёк к ближайшему борту
          const push = hw - Math.abs(this._v.x) + 0.05;
          this._v.x += Math.sign(this._v.x || 1) * push;
          this._v.applyQuaternion(this.ship.quaternion).add(this.ship.position);
          this.pos.x = this._v.x; this.pos.z = this._v.z;
          this.vel *= 0.4;
        }
      }
    }

    // --- плавучесть: посадка на волну Gerstner ---
    const wy = waterHeightAt(this.pos.x, this.pos.z, time);
    if (!this.splashed) {
      this.particles.splash(this.pos.x, wy, this.pos.z, 1.5);
      this.onSplash?.();
      this.splashed = true;
    }
    const draft = this.vis.len * 0.155 * 0.24; // осадка гружёного яла
    b.position.set(this.pos.x, wy - draft + Math.sin(time * 1.7) * 0.015, this.pos.z);
    waterNormalAt(this.pos.x, this.pos.z, time, this._n);
    // наклон по нормали воды в осях шлюпки + лёгкая бортовая качка от гребков
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.pitch = THREE.MathUtils.clamp(
      -(this._n[0] * fx + this._n[2] * fz) * 1.15, -0.2, 0.2);
    this.roll = THREE.MathUtils.clamp(
      (this._n[0] * fz - this._n[2] * fx) * 1.05, -0.28, 0.28)
      + (rowing ? Math.sin(this.strokePhase) * 0.035 : 0);
    b.quaternion.setFromEuler(this._e.set(this.pitch, this.heading, this.roll, 'YXZ'));

    // --- вёсла: разворот на воду + гребок; гребцы в такт ---
    this.oarDeploy += ((this.phase === 'afloat' ? 1 : 0) - this.oarDeploy) * Math.min(1, dt * 1.4);
    this.animateOars(0, true);
    for (let i = 0; i < this.rowers.length; i++) {
      const r = this.rowers[i];
      r.rotation.x = -0.22 * (rowing ? Math.sin(this.strokePhase) * Math.sign(this.row || 1) : 0)
        + Math.sin(time * 1.2 + i * 2.1) * 0.02;
      r.rotation.z = Math.sin(time * 1.6 + i) * 0.025;
    }
    // --- СЛЕД ОТ ШЛЮПКИ: пена за транцем при ходе (Task 26) ---
    if (Math.abs(this.vel) > 0.12) {
      const spdFrac = Math.min(1, Math.abs(this.vel) / MAX_FWD);
      this._v2.set(
        this.pos.x - Math.sin(this.heading) * this.vis.len * 0.48,
        0,
        this.pos.z - Math.cos(this.heading) * this.vis.len * 0.48);
      this.wake.push(this._v2, spdFrac, dt, time);
    }
    // --- румпеля нет: курс держат вёсла ---
  }

  /** вёсла: стowed → на воде, гребок/погружение */
  private animateOars(_dt: number, rowing: boolean) {
    if (!this.vis) return;
    const rowDir = this.row < 0 ? -1 : 1;
    const sweep = rowing && this.row !== 0
      ? -Math.cos(this.strokePhase) * SWEEP * rowDir : 0.1;
    const dip = rowing && this.row !== 0
      ? Math.max(0, Math.sin(this.strokePhase)) * DIP : 0;
    for (const o of this.vis.oars) {
      const side = o.userData.side as number;
      const stowQ = o.userData.stowQ as THREE.Quaternion;
      const yaw = new THREE.Quaternion().setFromAxisAngle(UP, side * sweep);
      const d = new THREE.Quaternion().setFromAxisAngle(FWD, -side * (DIP0 + dip));
      const rowQ = d.multiply(yaw);
      o.quaternion.copy(stowQ).slerp(rowQ, this.oarDeploy);
    }
  }

  /** для HUD/E2E */
  state() {
    return {
      phase: this.phase, t: +this.t.toFixed(2),
      x: +this.pos.x.toFixed(1), y: +this.pos.y.toFixed(1), z: +this.pos.z.toFixed(1),
      heading: +this.heading.toFixed(2), vel: +this.vel.toFixed(2),
      row: this.row, steer: this.steer,
      dist: +this.distToHoist().toFixed(1),
      oarDeploy: +this.oarDeploy.toFixed(2),
      rowersVisible: this.rowers.length > 0 && this.rowers[0].visible,
      wakePts: this.wake.count(),
    };
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
