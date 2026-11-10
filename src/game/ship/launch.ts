import * as THREE from 'three';
import { waterHeightAt } from '../water/waves';
import { updateBoatFalls, type BoatVis } from './buildShip';
import type { Ship } from './Ship';
import { buildFigure, rollTraits, mulberry32 } from './crew';
import type { Particles } from '../fx/particles';
import { WakeTrail, WaterlineFoam } from '../water/wake';
import { BUOYANCY_CONFIG } from '../water/buoyancy';

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
const MAX_FWD = 2.8;       // м/с под вёслами (~5.4 уз; мир ×10 — грести долго, ход бодрее)
const MAX_REV = 1.1;
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
  /** рельеф (Task 36): мель по ГЛУБИНЕ (не радиусу) + подсказка высадки */
  heightAt?: (x: number, z: number) => number;
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
  private heightAt?: (x: number, z: number) => number;
  private msg?: (text: string) => void;
  private onSplash?: () => void;
  /** ВЫСАДКА (Task 36): игрок на берегу — шлюпка заморожена у кромки */
  frozen = false;
  // Task 31 «добавь еще одну»: ВСЕ ялы судна (штирборт + порт);
  // vis — АКТИВНЫЙ (спускается/на воде/поднимается), null = все
  // на шлюпбалках. Спуск берёт первую ЦЕЛУЮ (штирборт, потом порт),
  // разбитая пропускается
  private boats: BoatVis[] = [];
  private active: BoatVis | null = null;
  // гребцы — на банках СВОЕГО яла (Task 31: у каждого свой экипаж)
  private rowersByBoat = new Map<BoatVis, THREE.Group[]>();

  // --- состояние на воде (мировые координаты контейнера) ---
  pos = new THREE.Vector3();
  heading = 0;              // куда смотрит НОС шлюпки
  vel = 0;                  // продольная скорость, м/с (может быть < 0)
  yawRate = 0;
  strokePhase = 0;
  oarDeploy = 0;
  roll = 0; pitch = 0;
  private bowFoamCd = 0;       // кулдаун буруна у носа

  // гребцы в шлюпке (видны только на воде) — по списку на ял (Task 31)
  // (создаются в конструкторе для КАЖДОГО яла, см. rowersByBoat)
  // СЛЕД ОТ ШЛЮПКИ (Task 26: «сделай след от лодки»): узкая пенная
  // дорожка за транцем яла на ходу под вёслами — та же лента, что и
  // кильватер корабля, но в масштабе шлюпки; пена Заметная (широкая
  // полоса с турбулентным клином — как след от вёсел на воде)
  readonly wake = new WakeTrail({
    spacing: 0.8, lifetime: 14, maxPts: 140,
    width0: 0.34, widthSpd: 0.5, alpha0: 0.36, alphaSpd: 0.6,
    yOff: 0.12, widen: 3.6,
  });
  // ПЕННЫЙ ВОРОТНИК по ватерлинии яла (Task 28: «вода должна обтекать
  // лодку, а не резать её»): та же кромка, что у корабля, в масштабе
  // лодки — кольцо лежит на волнах (шейдерный Gerstner), у носа
  // бурун на ходу; без него плоскость воды прорезала корпус линией
  readonly foam: WaterlineFoam | null = null;
  // подтяжка: откуда стартует шлюпка (мир)
  private pullFrom = new THREE.Vector3();
  private pullQuat = new THREE.Quaternion();
  private pullY = 0;          // локальная высота начала выборки талов
  private pullPos = new THREE.Vector3();   // старт выборки талов (локалы корабля)
  private splashed = false;
  private groundCd = 0;       // кулдаун сообщения об отмели
  // floating origin: сцена → мир (для шейдера воротника)
  private _negShift?: THREE.Vector3;

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
    this.heightAt = d.heightAt;
    this.msg = d.msg;
    this.onSplash = d.onSplash;
    // Task 31: ялы обоих бортов (штирборт как раньше + порт — новая)
    this.boats = [d.ship.visual.boat, d.ship.visual.boat2]
      .filter((b): b is BoatVis => !!b);
    this.active = null;
    // след пены за шлюпкой — в контейнер мира (координаты те же, что pos)
    this.wake.setWaterHeight(waterHeightAt);
    this.worldGroup.add(this.wake.mesh);
    // пенный воротник по ватерлинии (масштаб лодки; ялы одинаковые)
    if (this.boats.length) {
      this.foam = new WaterlineFoam(this.boats[0].outline, {
        width: Math.max(0.4, this.boats[0].beam * 0.34),
        size: this.boats[0].len,
      });
      this.foam.mesh.visible = false;
      this.worldGroup.add(this.foam.mesh);
    }
    // два гребца на банке каждого яла (появляются при спуске):
    // сидят лицом к корме, качаются в такт гребков
    for (const bt of this.boats) {
      const rnd = mulberry32(20240 + bt.stowPos.x * 1000); // свой сид на борт
      const list: THREE.Group[] = [];
      for (const side of [-1, 1] as const) {
        const f = buildFigure('rower', rollTraits(rnd, 'rower'), Math.floor(rnd() * 99999));
        const thY = bt.gunY - 0.235;
        f.group.position.set(side * bt.beam * 0.17, thY - 0.26, bt.rowZ + 0.3);
        f.group.rotation.y = Math.PI;      // лицом к корме
        f.group.scale.y = 0.78;
        f.group.visible = false;
        f.group.userData.isBoatRower = true;
        bt.group.add(f.group);
        list.push(f.group);
      }
      this.rowersByBoat.set(bt, list);
    }
  }

  /** игрок в шлюпке (управление кораблём отключено)? */
  inBoat(): boolean { return this.phase !== 'stowed'; }

  /** гребцы АКТИВНОГО яла (нет активного — штирбортного: все убраны,
   *  фигуры скрыты). Обратная совместимость: HUD/E2E Task 22–30
   *  читали именно поле rowers */
  get rowers(): THREE.Group[] {
    const bt = this.vis;   // активный, при stowed — штирборт (скрыт)
    return bt ? (this.rowersByBoat.get(bt) ?? []) : [];
  }


  /** АКТИВНЫЙ ял, а когда все убраны — штирбортный (BoatVis никогда
   *  не null, если ялы есть). Обратная совместимость: HUD/E2E
   *  Task 22–30 читали именно bl.vis (внутренняя логика работает
   *  со СТРОГИМ this.active — null = «на шлюпбалках») */
  get vis(): BoatVis | null {
    return this.active ?? this.boats[0] ?? null;
  }

  /** сколько ялов на судне и какой сейчас активен (HUD/E2E, Task 31).
   *  side: 'stb' — штирборт (право), 'port' — порт (лево) */
  boatCount(): number { return this.boats.length; }
  activeSide(): 'stb' | 'port' | null {
    const bt = this.active;
    if (!bt) return null;
    return bt.stowPos.x >= 0 ? 'stb' : 'port';
  }

  /** убрать за собой: след пены и воротник снимаются со сцены (смена корабля) */
  dispose() {
    this.wake.clear();
    this.wake.mesh.parent?.remove(this.wake.mesh);
    if (this.foam) this.foam.mesh.parent?.remove(this.foam.mesh);
  }

  /** расстояние от шлюпки до шлюпбалок борта (для HUD/подъёма) */
  distToHoist(): number {
    if (!this.active) return Infinity;
    if (this.phase === 'afloat') {
      this._v.copy(this.active.stowPos)
        .applyQuaternion(this.ship.quaternion).add(this.ship.position);
      return Math.hypot(this.pos.x - this._v.x, this.pos.z - this._v.z);
    }
    return 0;
  }

  /** ПОПЫТКА СПУСКА. Возвращает текст ошибки или null (успех).
   *  Task 31: из двух ялов спускается первая ЦЕЛАЯ — штирборт,
   *  за ним порт (запасная); разбитая пропускается */
  tryLaunch(docked: boolean): string | null {
    if (!this.boats.length) return 'На этом судне нет шлюпки';
    if (this.phase !== 'stowed') return null;
    const pick = this.boats.find(b => b.group.visible);
    if (!pick) return 'Обе шлюпки разбиты — в море не починить';
    if (this.ship.sinking || this.ship.sunk) return 'Корабль тонет — не до шлюпки!';
    if (docked) return 'В порту шлюпка не нужна — причал рядом';
    if (this.ship.crew < 1) return 'Некому грести — нужен хоть один человек команды';
    if (!this.ship.anchored && this.ship.speedKnots() > 2.6) {
      return 'Слишком большой ход — уберите паруса или отдайте якорь (F)';
    }
    this.active = pick;
    this.phase = 'lowering';
    this.t = 0;
    this.splashed = false;
    this.setRowersVisible(true);   // команда заняла места на банках
    return null;
  }

  /** ПОПЫТКА ПОДЪЁМА (когда шлюпка на воде). Ошибка или null */
  tryHoist(): string | null {
    if (this.phase !== 'afloat' || !this.active) return null;
    if (this.ship.sunk) return 'Корабль ушёл под воду — подниматься некуда…';
    const d = this.distToHoist();
    if (d > 15) return `Далеко от шлюпбалок (${Math.round(d)} м) — подойдите к борту`;
    if (Math.abs(this.vel) > 1.25) return 'Замрите ход перед подъёмом';
    // старт подтяжки
    this.pullFrom.copy(this.active.group.position);
    this.pullQuat.copy(this.active.group.quaternion);
    this.phase = 'raising';
    this.raiseStage = 0;
    this.t = 0;
    return null;
  }

  /** ВЫСАДКА (Task 36): шлюпка на мелководье У БЕРЕГА — можно
   *  сойти на землю (глубина < 3.2 м и суша в 60 м по 8 направлениям) */
  nearShore(): boolean {
    if (this.phase !== 'afloat' || this.frozen) return this.frozen;
    if (!this.heightAt) return false;
    const h = this.heightAt(this.pos.x, this.pos.z);
    if (h < -3.2 || h > 0.2) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (this.heightAt(this.pos.x + Math.cos(a) * 60, this.pos.z + Math.sin(a) * 60) > 0.5) return true;
    }
    return false;
  }

  /** заморозить шлюпку у берега (игрок сошёл на землю).
   *  Task 39: в шлюпке остаётся ОДИН гребец — игрок СХОДИТ, его
   *  фигура (первая банка) прячется, напарник остаётся грести */
  freezeAtShore() {
    this.frozen = true;
    const list = this.active ? this.rowersByBoat.get(this.active) : null;
    if (list && list[0]) list[0].visible = false;   // место игрока пусто
  }

  /** игрок вернулся в шлюпку — отпустить с мели, сесть на банку */
  resumeFromShore() {
    this.frozen = false;
    const list = this.active ? this.rowersByBoat.get(this.active) : null;
    if (list && list[0]) list[0].visible = true;
  }

  /** точка ВЫСАДКИ: маршем от шлюпки к центру ближайшего острова
   *  до суши (h > 0.7). null — не нашли */
  landingPoint(): { x: number; z: number } | null {
    if (!this.heightAt) return null;
    let best: { cx: number; cz: number } = { cx: 0, cz: 0 };
    let bestD = Infinity;
    for (const isl of this.islands()) {
      const d = Math.hypot(this.pos.x - isl.cx, this.pos.z - isl.cz);
      if (d < bestD) { bestD = d; best = { cx: isl.cx, cz: isl.cz }; }
    }
    const dx = best.cx - this.pos.x, dz = best.cz - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    for (let d = 6; d <= 600; d += 6) {
      const x = this.pos.x + ux * d, z = this.pos.z + uz * d;
      if (this.heightAt(x, z) > 0.7) return { x, z };
    }
    return null;
  }

  /** Немедленно вернуть шлюпку на шлюпбалки (смена корабля/смерть) */
  abort() {
    if (!this.active || this.phase === 'stowed') return;
    const b = this.active.group;
    if (b.parent !== this.active.falls.parent) {
      // шлюпка была в мире — вернуть в группу мелких деталей
      this.active.falls.parent?.add(b);
    }
    b.position.copy(this.active.stowPos);
    b.rotation.set(0, this.active.stowRotY, 0);
    b.quaternion.setFromEuler(new THREE.Euler(0, this.active.stowRotY, 0));
    this.setRowersVisible(false);
    this.oarDeploy = 0;
    this.stowOars();
    this.phase = 'stowed';
    this.active = null;               // Task 31: активного больше нет
    this.t = 0;
    this.vel = 0;
    this.yawRate = 0;
    this.row = 0;
    this.steer = 0;
    const av = this.boats.find(x => x.group === b) ?? this.boats[0];
    updateBoatFalls(av);
  }

  private setRowersVisible(v: boolean) {
    // Task 31: гребцы — только АКТИВНОГО яла (у каждого свой экипаж)
    const list = this.active ? this.rowersByBoat.get(this.active) : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        // Task 39: пока игрок НА БЕРЕГУ (frozen) его банка пуста —
        // место игрока НЕ показываем, даже если показываем остальных
        list[i].visible = v && !(this.frozen && i === 0);
      }
    } else if (!this.active) {
      // убраны — спрятать всех (после подъёма/аварии)
      for (const l of this.rowersByBoat.values()) for (const r of l) r.visible = false;
    }
  }

  private stowOars() {
    if (!this.active) return;
    for (const o of this.active.oars) {
      const sq = o.userData.stowQ as THREE.Quaternion;
      if (sq) o.quaternion.copy(sq);
    }
  }

  update(dt: number, time: number, negShift?: THREE.Vector3) {
    this._negShift = negShift;
    if (!this.boats.length) return;
    // активный ял разбило прямо во время спуска/на воде — подобрать
    // игрока на борт; следующий спуск возьмёт целую запасную (port)
    if (this.active && !this.active.group.visible && this.phase !== 'stowed') {
      const done = this.active;
      this.abort();
      this.msg?.('Шлюпку разнесло щепой! Вас подобрали на борт'
        + (this.boats.some(b => b !== done && b.group.visible) ? ' (запасная на шлюпбалках)' : ''));
      return;
    }
    // воротник показывается ТОЛЬКО на воде (не на талях/шлюпбалках)
    if (this.foam && this.phase !== 'afloat') this.foam.mesh.visible = false;
    // Task 31: активный ял (в фазах спуска/воды/подъёма он всегда
    // есть — tryLaunch назначает, abort снимает вместе с фазой)
    const vis = this.active;
    if (vis && this.phase !== 'stowed') {
      const b = vis.group;
      switch (this.phase) {
        case 'lowering': {
          this.t += dt / LOWER_DUR;
          const k = sm(this.t);
          // цель: планширь шлюпки на уровень воды (в локалах корабля)
          this._v.copy(b.position).applyQuaternion(this.ship.quaternion).add(this.ship.position);
          const wy = waterHeightAt(this._v.x, this._v.z, time);
          const targetY = vis.stowPos.y + (wy + 0.12 - this._v.y);
          b.position.y = THREE.MathUtils.lerp(vis.stowPos.y, targetY, k);
          // лёгкий дрейф ОТ обшивки — чистый спуск за борт
          b.position.x = THREE.MathUtils.lerp(vis.stowPos.x, vis.stowPos.x + Math.sign(vis.stowPos.x || 1) * 0.35, k);
          b.rotation.z = Math.sin(k * Math.PI) * 0.05;   // покачивание на талях
          updateBoatFalls(vis);
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
            this._v.set(vis.stowPos.x * 0.8, vis.stowPos.y * 0.55, vis.stowPos.z)
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
              vis.falls.parent?.attach(b);
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
            b.position.lerpVectors(this.pullPos, vis.stowPos, k);
            b.rotation.z = Math.sin(k * Math.PI) * 0.05;
            // курс — к stowRotY по кратчайшей дуге, качка гаснет
            this._e.setFromQuaternion(b.quaternion, 'YXZ');
            const k2 = Math.min(1, dt * 2.5);
            const dy = wrapPi(vis.stowRotY - this._e.y);
            this._e.set(this._e.x * (1 - k2), this._e.y + dy * k2, this._e.z * (1 - k2), 'YXZ');
            b.quaternion.setFromEuler(this._e);
            // вёсла убираются на планширь по мере подъёма
            this.oarDeploy = Math.max(0, 1 - k * 1.6);
            this.animateOars(0, false);
            updateBoatFalls(vis);
            if (this.t >= 1) {
              b.position.copy(vis.stowPos);
              this._q.setFromEuler(this._e.set(0, vis.stowRotY, 0));
              b.quaternion.copy(this._q);
              b.rotation.set(0, vis.stowRotY, 0);
              this.stowOars();
              this.phase = 'stowed';
              this.active = null;           // Task 31: ял убран, активного нет
              this.oarDeploy = 0;
              updateBoatFalls(vis);
            }
          }
          break;
        }
      }
    } else {
      // убраны: фалы слегка тянутся от качки корабля (у КАЖДОГО яла)
      for (const bt of this.boats) {
        if (bt.group.visible && Math.random() < dt * 4) updateBoatFalls(bt);
      }
    }
    // лента следа живёт всегда: точки стареют и тают и после подъёма
    this.wake.update(time);
  }

  /** фалы к шлюпке в МИРЕ (подтяжка): концы — позиция шлюпки,
   *  пересчитанная в локальные координаты корабля. Носовая балка —
   *  к планширю НОСА, кормовая — к планширю кормы (±gunX) */
  private fallsToBoat() {
    if (!this.active) return;
    const b = this.active.group;
    const attr = this.active.falls.geometry.getAttribute('position') as THREE.BufferAttribute;
    this._qi.copy(this.ship.quaternion).invert();
    // центр шлюпки в локалах корабля
    const c = this._v2.copy(b.position).sub(this.ship.position).applyQuaternion(this._qi);
    const rotY = this.active.stowRotY;   // шлюпка выровнена вдоль борта
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    let i = 0;
    for (let hi = 0; hi < this.active.davitHeads.length; hi++) {
      const head = this.active.davitHeads[hi];
      const zo = (hi === 0 ? 1 : -1) * this.active.hangZ;
      for (const xs of [this.active.gunX, -this.active.gunX]) {
        // точка планширя шлюпки (xs, gunY, zo), поворот на rotY
        const px = xs * cos + zo * sin;
        const pz = -xs * sin + zo * cos;
        attr.setXYZ(i, head.x, head.y, head.z);
        attr.setXYZ(i + 1, c.x + px, c.y + this.active.gunY, c.z + pz);
        i += 2;
      }
    }
    attr.needsUpdate = true;
  }

  /** отдача талов: шлюпка — самостоятельная сущность на воде */
  private detachToWater(time: number) {
    if (!this.active) return;
    const b = this.active.group;
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
    updateBoatFalls(this.active, true);   // хвосты талов у шлюпбалок
    this.msg?.('Шлюпка на воде! W/S — вёсла, A/D — поворот вёслами. B у борта — подняться на борт');
  }

  /** жизнь на воде: гребля, руль, качка, коллизии */
  private floatUpdate(dt: number, time: number) {
    if (!this.active) return;
    const b = this.active.group;
    // ВЫСАДКА: шлюпка ждёт у кромки — гребля отключена
    if (this.frozen) {
      this.row = 0;
      this.steer = 0;
      this.vel = 0;
      this.yawRate = 0;
    }
    // --- гребля: импульс только в рабочей фазе (sin φ > 0) ---
    const rowing = this.row !== 0 && !this.frozen;
    if (rowing) {
      this.strokePhase += dt * (2.0 + Math.min(1, Math.abs(this.vel) / 1.4)) * Math.PI;
    }
    const power = rowing ? Math.max(0, Math.sin(this.strokePhase)) : 0;
    this.vel += this.row * power * dt * 2.4;
    this.vel -= this.vel * Math.abs(this.vel) * 0.30 * dt + this.vel * 0.12 * dt;
    this.vel = THREE.MathUtils.clamp(this.vel, -MAX_REV, MAX_FWD);
    // --- поворот дифференциальной греблёй (руля нет: на заднем
    //     ходу руление зеркально) ---
    const turn = this.steer * (0.3 + Math.min(1.0, Math.abs(this.vel)) * 0.34);
    this.yawRate += (turn - this.yawRate) * Math.min(1, dt * 3.2);
    this.heading += this.yawRate * dt * (this.vel < -0.05 ? -1 : 1);
    this.pos.x += Math.sin(this.heading) * this.vel * dt;
    this.pos.z += Math.cos(this.heading) * this.vel * dt;

    // --- БЕРЕГ ПО ГЛУБИНЕ (Task 36): мель = глубина < 0.6 м под
    //     килем — откат назад (шлюпка подходит к берегу НОСОМ,
    //     вплотную — и можно высадиться) ---
    if (this.heightAt && !this.frozen) {
      const hHere = this.heightAt(this.pos.x, this.pos.z);
      if (hHere > -0.6) {
        this.pos.x -= Math.sin(this.heading) * this.vel * dt * 2.2;
        this.pos.z -= Math.cos(this.heading) * this.vel * dt * 2.2;
        this.vel *= -0.12;
        if (this.groundCd <= 0) {
          this.msg?.('Шлюпка ткнулась в отмель — дальше на веслах не пройти');
          this.groundCd = 4;
        }
      }
    }

    // --- острова: запасной радиус (если рельеф не передан) ---
    this.groundCd = Math.max(0, this.groundCd - dt);
    if (!this.heightAt) {
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

    // 7 ТОЧЕК НА ВОЛНЕ единого моря (Герстнер + FBM): посадка/наклон —
    // из настроек плавучести; штормовая ветка удалена (Task 33)
    const L = this.active.len, B = this.active.beam;
    const draft = L * 0.155 * 0.15 * BUOYANCY_CONFIG.boatDraftMul;  // осадка яла (настройка ×)
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (!this.splashed) {
      this.particles.splash(this.pos.x, waterHeightAt(this.pos.x, this.pos.z, time), this.pos.z, 1.5);
      this.onSplash?.();
      this.splashed = true;
    }
    if (true) {  // единая ветка плавучести (Task 33)
      // 7 ТОЧЕК НА ВОЛНЕ (Task 27→28): нос/корма/борта/мидель +
      // ПОЛУНОС и ПОЛУКОРМА — между прежними 5 точками середина
      // корпуса проваливалась ПОД гребень на коротких волнах
      // («вода режет лодку»); посадка по средневзвешенной поверхности
      // + БЫСТРОЕ сглаживание — ял ДЕРЖИТСЯ ПОВЕРХНОСТИ (нос всходит
      // на гребень и скользит вниз), осадка мала — планширь всегда
      // над водой
      const sx = fz, sz = -fx;                    // штирборт яла
      const hBow = waterHeightAt(this.pos.x + fx * L * 0.42, this.pos.z + fz * L * 0.42, time);
      const hStern = waterHeightAt(this.pos.x - fx * L * 0.42, this.pos.z - fz * L * 0.42, time);
      const hStar = waterHeightAt(this.pos.x + sx * B * 0.5, this.pos.z + sz * B * 0.5, time);
      const hPort = waterHeightAt(this.pos.x - sx * B * 0.5, this.pos.z - sz * B * 0.5, time);
      const hMid = waterHeightAt(this.pos.x, this.pos.z, time);
      const hBowM = waterHeightAt(this.pos.x + fx * L * 0.21, this.pos.z + fz * L * 0.21, time);
      const hSternM = waterHeightAt(this.pos.x - fx * L * 0.21, this.pos.z - fz * L * 0.21, time);
      // посадка: прямое следование СРЕДНЕВЗВЕШЕННОЙ ПОВЕРХНОСТИ (пружина
      // попадала в резонанс с волной и гонила ял в противофазе ±2.5 м —
      // «лодка плавает под водой/над водой»); быстрое экспоненциальное
      // сглаживание гасит дрожь замеров, но не отстаёт от волны.
      // Осадка мала (0.15·полной высоты борта — Task 28: ял ПОВЫШЕ
      // на воде, привальный брус не подрезается водой)
      const targetY = hMid * 0.30
        + (hBow + hStern) * 0.11 + (hPort + hStar) * 0.095
        + (hBowM + hSternM) * 0.145 - draft;
      this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * BUOYANCY_CONFIG.boatSmooth);
      b.position.set(this.pos.x, this.pos.y + Math.sin(time * 1.7) * 0.015, this.pos.z);
      // наклон по УКЛОНАМ воды между точками (нос-корма, борт-борт) +
      // лёгкая бортовая качка от гребков; пределы — настройки
      // «углы наклона» (Task 31)
      const pitchSlope = (hBow - hStern) / (L * 0.84);
      const rollSlope = (hStar - hPort) / (B * 1.0);
      this.pitch = THREE.MathUtils.clamp(-pitchSlope, -BUOYANCY_CONFIG.pitchMax, BUOYANCY_CONFIG.pitchMax);
      this.roll = THREE.MathUtils.clamp(rollSlope, -BUOYANCY_CONFIG.heelMax, BUOYANCY_CONFIG.heelMax)
        + (rowing ? Math.sin(this.strokePhase) * 0.035 : 0);
      b.quaternion.setFromEuler(this._e.set(this.pitch, this.heading, this.roll, 'YXZ'));
    }

    // --- вода ОБТЕКАЕТ ял: бурун у носа на ходу (как у корабля) ---
    this.bowFoamCd = Math.max(0, this.bowFoamCd - dt);
    if (Math.abs(this.vel) > 0.35 && this.bowFoamCd <= 0) {
      const bx = this.pos.x + fx * L * 0.44, bz = this.pos.z + fz * L * 0.44;
      this.particles.splash(bx, waterHeightAt(bx, bz, time) + 0.05, bz,
        0.25 + Math.min(0.5, Math.abs(this.vel) * 0.3));
      this.bowFoamCd = 0.5;
    }

    // --- вёсла: разворот на воду + гребок; гребцы в такт ---
    // (Task 31: гребцы — АКТИВНОГО яла, список из rowersByBoat)
    this.oarDeploy += ((this.phase === 'afloat' ? 1 : 0) - this.oarDeploy) * Math.min(1, dt * 1.4);
    this.animateOars(0, true);
    const rowerList = this.rowersByBoat.get(this.active);
    if (rowerList) for (let i = 0; i < rowerList.length; i++) {
      const r = rowerList[i];
      r.rotation.x = -0.22 * (rowing ? Math.sin(this.strokePhase) * Math.sign(this.row || 1) : 0)
        + Math.sin(time * 1.2 + i * 2.1) * 0.02;
      r.rotation.z = Math.sin(time * 1.6 + i) * 0.025;
    }
    // --- СЛЕД ОТ ШЛЮПКИ: пена за транцем при ходе (Task 26) ---
    if (Math.abs(this.vel) > 0.12) {
      const spdFrac = Math.min(1, Math.abs(this.vel) / MAX_FWD);
      this._v2.set(
        this.pos.x - Math.sin(this.heading) * this.active.len * 0.48,
        0,
        this.pos.z - Math.cos(this.heading) * this.active.len * 0.48);
      this.wake.push(this._v2, spdFrac, dt, time);
    }

    // --- ПЕННЫЙ ВОРОТНИК ПО ВАТЕРЛИНИИ (Task 28): кольцо у самого
    //     борта — вода «омывает» корпус вместо линии разреза;
    //     высоту волны добавляет вершинный шейдер (как у корабля),
    //     на CPU — привязка к лодке: позиция/курс/скорость/крен ---
    if (this.foam) {
      this.foam.mesh.visible = true;
      this.foam.mesh.position.set(this.pos.x, this.pos.y + draft + 0.05, this.pos.z);
      this.foam.mesh.rotation.y = this.heading;
      const spdFrac = Math.min(1, Math.abs(this.vel) / MAX_FWD);
      this.foam.update(time, spdFrac, this.roll, this._negShift);
    }
    // --- румпеля нет: курс держат вёсла ---
  }

  /** вёсла: стowed → на воде, гребок/погружение */
  private animateOars(_dt: number, rowing: boolean) {
    if (!this.active) return;
    const rowDir = this.row < 0 ? -1 : 1;
    const sweep = rowing && this.row !== 0
      ? -Math.cos(this.strokePhase) * SWEEP * rowDir : 0.1;
    const dip = rowing && this.row !== 0
      ? Math.max(0, Math.sin(this.strokePhase)) * DIP : 0;
    for (const o of this.active.oars) {
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
    const rowerList = this.active ? this.rowersByBoat.get(this.active) : null;
    // Task 39: СКОЛЬКО гребцов видно (после высадки — 1: место игрока пусто)
    const rowersVisibleCount = rowerList ? rowerList.filter(r => r.visible).length : 0;
    return {
      phase: this.phase, t: +this.t.toFixed(2),
      x: +this.pos.x.toFixed(1), y: +this.pos.y.toFixed(1), z: +this.pos.z.toFixed(1),
      heading: +this.heading.toFixed(2), vel: +this.vel.toFixed(2),
      row: this.row, steer: this.steer,
      dist: +this.distToHoist().toFixed(1),
      oarDeploy: +this.oarDeploy.toFixed(2),
      rowersVisible: !!rowerList && rowerList.length > 0 && rowerList[0].visible,
      rowersVisibleCount,
      frozen: this.frozen,
      wakePts: this.wake.count(),
      foamCollar: !!this.foam && this.foam.mesh.visible,
      draft: this.active ? +(this.active.len * 0.155 * 0.15 * BUOYANCY_CONFIG.boatDraftMul).toFixed(3) : 0,
      // Task 31: два яла — какой на воде
      boats: this.boats.length,
      side: this.activeSide(),
    };
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
