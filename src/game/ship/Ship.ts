import * as THREE from 'three';
import { PRESETS, ShipPreset, buildShip, ShipVisual, enableLantern, sailAddHole, hullProfile } from './buildShip';
import { buildCrew, CrewVisual, CREW_MAT } from './crew';
import { waterHeightAt } from '../water/waves';
import { BUOYANCY_CONFIG, PHYSICS, CONTROLS } from '../water/buoyancy';
import { WaterlineFoam, WakeTrail } from '../water/wake';
import { Particles } from '../fx/particles';
import type { GibPool } from '../fx/gibs';
import { spawnDebrisAt, spawnShipDebris } from '../fx/debris';
import { clamp, mod2pi, smoothstep } from '../core/rng';

// ============================================================
// Корабль как сущность: 6DOF-физика (surge/sway/heave/roll/
// pitch/yaw), ГИДРОСТАТИКА ПО ТОЧКАМ КОРПУСА (Архимед — Task 25:
// Gerstner-волны + rigid body + buoyancy), ветер на парусах,
// руль, якорь, повреждения, течь, пожар, затопление.
// ============================================================

export interface WindState { from: number; speed: number; } // from: радианы ОТКУДА дует

export type DamageKind = 'ball' | 'chain' | 'grape' | 'fire' | 'ram' | 'ground';

export interface DamageInput {
  kind: DamageKind;
  amount: number;
  hitPoint?: THREE.Vector3; // мировая точка
}

interface BuoyCol {
  x: number; z: number;   // точка колонны на ватерлинии (локально)
  keelY: number;          // низ — киль (локально, < 0); сдвигается «осадкой ±»
  topY: number;           // верх — планширь: запас плавучести борта
  A: number;              // площадь ватерлинии колонны, м²
  c: number;              // вертикальный демпфер качки, кг/с
  // Task 31 «осадка ±» для физ. модели — БАЗА калибровки (проектная
  // посадка, off=0): сдвиг ССЫЛКИ киля/планширя на off м заставляет
  // корабль сидеть ровно на off глубже/мельче — распределение
  // объёма под водой НЕ меняется, ЦВ/ЦМ на месте: ровный киль сохраняется
  keel0: number;          // киль при проектной осадке (до сдвига)
  top0: number;           // планширь при проектной осадке
  A0: number;             // площадь при проектной осадке (до компенсации развала)
}

/** Опции создания корабля (настройки игры) */
export interface ShipOpts {
  durabilityMul?: number;              // множитель прочности корпуса/парусов/мачт
  ammo?: Record<string, number>;       // стартовый боезапас (игрок)
  boatCount?: number;                  // СКОЛЬКО шлюпок на шлюпбалках (0..2)
}

const G = 9.81;
const RHO = 1025;   // плотность морской воды, кг/м³

export class Ship {
  /** общие куски дерева/тел (заполняет game.ts) — для повреждений */
  static gibs: GibPool | null = null;

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
  private cols: BuoyCol[] = [];   // гидростатические колонны корпуса
  private zCom = 0;               // продольный ЦМ = ЦВ проектной ватерлинии
  /** применённая осадка ± (Task 31; физ. модель — перекалибровкой
   *  колонн; телеметрия/отладка) */
  draftOff = 0;
  /** счётчик накрытий палубы волной («зелёная вода», Task 25) — HUD/E2E */
  greenWater = 0;
  /** время последнего накрытия палубы (для затухающих сообщений) */
  greenWaterT = 0;
  /** сколько матросов смыло за борт зелёной водой (телеметрия/сообщение) */
  washedCrew = 0;
  private lastWashT = -99;
  private cutT = 0;                // кулдаун эмиссии брызг резания/зелёной воды
  private force = new THREE.Vector3();
  private torque = new THREE.Vector3();
  private _f = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _t1 = new THREE.Vector3();
  private _t2 = new THREE.Vector3();
  private _t3 = new THREE.Vector3();
  /** локальный кренящий/дифферентующий момент (ось Z корпуса — крен,
   *  X — дифферент): прикладывается к миру кватернионом — моменты
   *  ветра/поворота/зарывания должны крутить КОРАБЛЬ вокруг ЕГО осей,
   *  а не вокруг мировых (баг «на курсе 90° крен превращается в
   *  дифферент и корабль зарывается носом при повороте») */
  private _lt = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private _oarQ = new THREE.Quaternion(); // развёрнутое положение весла
  private _oarYaw = new THREE.Quaternion(); // гребок (вокруг вертикали)
  private _oarDip = new THREE.Quaternion(); // погружение (вокруг ДП)
  private _yAxis = new THREE.Vector3(0, 1, 0);
  private _zAxis = new THREE.Vector3(0, 0, 1);
  private wq = new THREE.Quaternion();
  private dq = new THREE.Quaternion();
  private _e2 = new THREE.Euler();   // разбор кватерниона (качка/подъём шлюпки)

  // --- управление ---
  sailTarget = 0;          // 0..3
  /** Принудительная доля постановки парусов (0..1) — мишень полигона
   *  стоит на якоре с поставленным рангоутом; null = обычная логика */
  sailOverride: number | null = null;
  sailFrac = 0;            // плавное 0..1
  rudder = 0;              // -1..1 (реальный угол)
  rudderTarget = 0;
  anchored = false;
  /** анимация якоря: 0 — убран (лежит вдоль борта), 1 — отдан (под водой на цепи) */
  anchorT = 0;
  reverseThrust = false;
  helmActive = false;
  // --- вёсла (гребные суда: шебека, галера) ---
  /** вёсла вывалены на воду (команда игрока или Alt+W/S) */
  oarsOut = false;
  /** 0..1 — плавное вываливание/убирание (анимация) */
  oarsDeployT = 0;
  /** команда гребли: +1 вперёд, −1 назад, 0 нет (Alt+W/S) */
  rowing = 0;
  /** сек без гребли при вываленных вёслах — потом автоубирание */
  oarsIdleT = 0;
  /** фаза гребка (рад): ОДНА на все вёсла — синхронная гребля;
   *  передаётся экипажу (гребцы отклоняются в такт) */
  strokePhase = 0;

  // --- пушечные порты (закрытые батареи) ---
  /** порты открыты (команда игрока / ИИ в бою) — крышки подняты,
   *  орудия выехали; при закрытых батареи НЕ СТРЕЛЯЮТ */
  portsOpen = false;
  /** 0..1 — плавное открытие/закрытие портов (анимация) */
  portsT = 0;

  // --- состояние ---
  hullHP: number; hullMax: number;
  sailHP: number;
  /** максимум парусов с учётом множителя прочности (clearDamage) */
  sailMax: number;
  crew: number;
  water = 0;               // м³ в трюме
  holdCap: number;
  leakRate = 0;            // м³/с суммарная течь
  onFire = false;
  fireT = 0;
  /** сила пожара 0..1: 0.3 — очаг, 1.0 — палуба в огне.
   *  Растёт (сухое дерево + ветер), урон корпусу/парусам/экипажу
   *  масштабируется от интенсивности; перекидывается на соседей */
  fireIntensity = 0;
  /** дождь 0..1 (задаёт game.ts) — тушит пожар */
  rainRate = 0;
  mastsBroken = 0;         // число сломанных (для тяги)
  mastAnim = -1;           // (легаси) для совместимости
  mastHP: number[] = [];   // HP каждой мачты
  mastFall: number[] = []; // прогресс падения: -1 стоит, 0..1 валится/лежит
  /** всплеск уже сыгран для падающей мачты (индекс = мачте) */
  private mastSplashed: boolean[] = [];
  mastMaxHP = 32;
  /** оборванных снастей обвязки (ванты/штаги сломанных мачт) */
  private rigSnapped = 0;
  hullHoles: { side: number; belowWL: boolean; mesh: THREE.Mesh }[] = [];
  leakBias = 0;            // суммарный кренящий момент пробоин (−1..1 порт/штирборт)
  noSurrender = false;     // мишень полигона не сдаётся
  crew3d: CrewVisual;      // фигуры на палубе
  sinking = false;
  sinkT = 0;
  sunk = false;
  // --- поэтапное затопление (физика сцены по описанию игрока) ---
  /** 0 — не тонем; 1 — потеря остойчивости (крен/дифферент);
   *  2 — палуба под водой, гидроторможение мачт; 3 — финальный уход
   *  по спирали с разрушением надстроек */
  sinkPhase = 0;
  private sinkSide = 1;     // куда валится борт (±1)
  private sinkTrim = 1;     // куда зарывается (+1 нос, −1 корма)
  private sinkSpin = 1;     // направление спирали на дно
  private sinkRollT = 0;    // целевой крен, рад
  private sinkPitchT = 0;   // целевой дифферент, рад
  private wetness = 0;      // 0..1 — намокание дерева (темнее, шершавее)
  private wetMats: { mat: THREE.MeshStandardMaterial; base: THREE.Color; rough: number; metal: number }[] | null = null;
  private sinkDebrisDone = false;
  private sinkFxT = 0;      // аккумулятор эмиссии пены/пузырей
  surrendered = false;
  grounded = false;
  gold = 0;
  cargo: Record<string, number> = {};
  ammo: Record<string, number> = { ball: 90, chain: 30, grape: 60, fire: 20 };
  planks = 12;
  pumpAction = false;

  // --- мир ---
  wind: WindState;
  terrainHeight: (x: number, z: number) => number;
  particles: Particles;

  // --- вода/след ---
  foam: WaterlineFoam;
  wake = new WakeTrail();
  private rollSmooth = 0;

  // ===== КАЧКА (Task 33): единственное море — Герстнер + FBM; =====
  // режим физики (реалистичная/простая) — глобальный PHYSICS.mode
  // из настроек. Прежние три модели моря и ShipBuoyancy удалены.

  // --- события колбэки ---
  onSurrender?: (s: Ship) => void;
  onSunk?: (s: Ship) => void;

  constructor(presetId: string, isPlayer: boolean, wind: WindState,
    terrainHeight: (x: number, z: number) => number, particles: Particles,
    opts?: ShipOpts) {
    this.preset = PRESETS[presetId];
    this.isPlayer = isPlayer;
    this.wind = wind;
    this.terrainHeight = terrainHeight;
    this.particles = particles;
    this.visual = buildShip(this.preset, { boatCount: opts?.boatCount });
    // прочность по настройке игры (по умолчанию 1× — исторические ТТХ)
    const mul = opts?.durabilityMul ?? 1;
    this.hullHP = this.preset.hullHP * mul;
    this.hullMax = this.hullHP;
    this.sailHP = this.preset.sailHP * mul;
    this.sailMax = this.sailHP;
    this.mastMaxHP = 32 * mul;
    if (opts?.ammo) this.ammo = { ...opts.ammo };
    this.crew = Math.round(this.preset.maxCrew * 0.8);
    this.holdCap = this.preset.cargo * 0.8;
    this.mass = this.preset.mass;

    const { length: L, beam: B, draft: D, freeboard: F } = this.preset;
    // моменты инерции (связные оси: x=право, y=верх, z=нос).
    // Радиусы инерции реальные (Task 25 — чистая гидростатика):
    // дифферент k≈0.27·L (масса сосредоточена в середине корпуса),
    // крен k≈0.37·B; рыскание — БЕЗ изменений (не ломаем настройку
    // руления, на которой сидит вся игра)
    this.inertia.set(
      this.mass * Math.pow(0.27 * L, 2),          // pitch (x)
      this.mass * (L * L + B * B) / 12 * 1.2,     // yaw (y)
      this.mass * Math.pow(0.37 * B, 2),          // roll (z)
    );

    // ============================================================
    // ГИДРОСТАТИКА ПО ТОЧКАМ КОРПУСА (замечание игрока Task 25:
    // «Gerstner-волны + rigid body + buoyancy — Архимед по точкам
    // корпуса»): 13 шпангоутов × 5 колонн по ширине. Каждая колонна —
    // вертикальный «столб» корпуса от киля до планширя со своей
    // площадью ватерлинии: погруженная часть выталкивается силой
    // ρ·g·A·d (вес вытесненной воды), моменты от плеч r×F дают
    // ЕСТЕСТВЕННОЕ восстановление по крену и дифференту. Корпус
    // РЕЖЕТ волны (никакой кинематической «посадки на гребень»),
    // и только слишком большая волна накрывает палубу — запас
    // плавучести надводного борта (колонны до планширя) возвращает
    // корабль вверх. Заменила пружинные зонды + кинематический
    // подъём из Task 12–21: те «приклеивали» корпус к поверхности.
    // ============================================================
    {
      const NZ = 13;
      const XF = [-0.78, -0.39, 0, 0.39, 0.78];   // доли полуширины станции
      const z0 = -L * 0.48, z1 = L * 0.48;
      const dz = (z1 - z0) / (NZ - 1);
      for (let i = 0; i < NZ; i++) {
        const z = z0 + dz * i;
        const t = clamp((z + L / 2) / L, 0, 1);
        const prof = hullProfile(t, this.preset);
        const w = Math.max(0.3, prof.w);
        for (const xf of XF) {
          this.cols.push({
            x: xf * w, z,
            keelY: -prof.draft, topY: prof.bulwark,
            A: (2 * w * dz) / XF.length, c: 0,
            keel0: -prof.draft, top0: prof.bulwark, A0: 0,   // база — заполнится при калибровке
          });
        }
      }
      // КАЛИБРОВКА: объём под проектной ватерлинией (y=0) = массе/ρ —
      // в штиле корабль сидит ровно по проектную осадку D.
      // ЦМ = ЦВ проектной ватерлинии (жалоба Task 26 «нос в воде
      // даже на стоянке»): корпус несимметричен — корма полная
      // (58% ширины), нос сходит к нулю, ЦВ смещён в корму от
      // миделя; гравитация же была приложена точно в миделе —
      // статический дифферентующий момент заваливал НОС в воду
      // на 7–10°. Теперь вес действует в ЦМ с плечом zCom —
      // момент веса компенсирует момент плавучести, на штильной
      // стоянке корабль стоит РОВНО по проектную осадку.
      let v0 = 0, mz0 = 0;
      for (const c of this.cols) {
        const d0 = Math.min(Math.max(-c.keelY, 0), c.topY - c.keelY);
        v0 += c.A * d0;
        mz0 += c.A * d0 * c.z;
      }
      const scale = (this.mass / RHO) / Math.max(1e-6, v0);
      let aSum = 0;
      for (const c of this.cols) { c.A *= scale; aSum += c.A; }
      this.zCom = mz0 / Math.max(1e-6, v0);   // плечо ЦМ от миделя (< 0 — в корму)
      // база калибровки для «осадки ±» (Task 31): keel0/top0/A0 —
      // проектная посадка; applyDraftOffset сдвигает ССЫЛКУ киля/планширя
      for (const c of this.cols) {
        c.keel0 = c.keelY; c.top0 = c.topY; c.A0 = c.A;
      }
      // демпферы качки: ζ≈0.50 на собственной частоте вертикальной
      // качки ω=√(ρg·A_wl/m) — корпус гасит качку, но живо всходит
      // на гребень (волновое демпфирование обнулять нельзя —
      // раскачает до опрокидывания; с развалом бортов (Task 28)
      // жёсткость на гребне выше — ζ держим с запасом)
      const omega = Math.sqrt(RHO * G * aSum / this.mass);
      const cTot = 2 * 0.50 * this.mass * omega;
      for (const c of this.cols) c.c = cTot * (c.A / aSum);
    }

    this.foam = new WaterlineFoam(this.visual.outline);
    this.wake.setWaterHeight(waterHeightAt);
    if (isPlayer) enableLantern(this.visual);
    // применить ТЕКУЩУЮ осадку ± (Task 31): настройка могла быть
    // выставлена до создания этого корабля
    this.applyDraftOffset(BUOYANCY_CONFIG.draftOffset);

    // экипаж на палубе: процедурные типажи, сид фиксирован по модели
    const seed = Array.from(presetId).reduce((a, ch) => a + ch.charCodeAt(0) * 31, 11)
      + Math.round(this.preset.length * 7);
    this.crew3d = buildCrew(this.preset, seed);
    this.visual.group.add(this.crew3d.group);
    // ИИ-гребцы ходят на вёслах постоянно (у игрока вёсла вываливаются
    // клавишей или командой гребли Alt+W/S)
    if (!isPlayer && this.preset.oars) {
      this.oarsOut = true;
      this.rowing = 1;
    }
    for (let i = 0; i < this.visual.masts.length; i++) {
      this.mastHP.push(this.mastMaxHP);
      this.mastFall.push(-1);
      this.mastSplashed.push(false);
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
    // затопление — ОТДЕЛЬНАЯ кинематика (фазы крена/погружения/спирали):
    // пружины плавучести уже не нужны, корпус ведёт себя как тело,
    // теряющее остойчивость
    if (this.sinking) { this.stepSinking(dt, time); return; }
    // ПРОСТАЯ ФИЗИКА (настройка «Физика корабля»): корабль СКОЛЬЗИТ
    // ПО поверхности волн — рамка из 5 точек замера, крен — целевой
    // угол; нос всходит на волну и спускается, глубоких нырков нет
    if (PHYSICS.mode === 'simple') { this.stepSimpleWaves(dt, time); return; }
    // РЕАЛИСТИЧНАЯ ФИЗИКА (по умолчанию): корабль ПЛЫВЁТ ПО волне —
    // вертикаль СЛЕДУЕТ поверхности (корабль не проваливается внутрь
    // вала и не режет его), а крен/дифферент — ЧЕСТНАЯ ДИНАМИКА
    // моментов (ветер на парусах ∝ v², поворот, затопление,
    // выравнивание по склону волны от плавучести колонн корпуса)
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
    this._lt.set(0, 0, 0);   // крен/дифферент — по осям КОРПУСА

    const f = this._f.copy(this.forward);
    // штирборт (правый борт): forward × up = (−f.z, 0, f.x)
    const right = this._r.set(-f.z, 0, f.x).normalize();
    const e = this.euler;
    const spd = this.speed();

    const m = this.mass + this.water * 1000; // вода в трюме утяжеляет

    // --- ВЕС: только МОМЕНТ (плечо ЦМ от миделя, вращается вместе с
    //  корпусом — гасит дифферентующий момент кормового ЦВ, Task 26).
    //  Вертикальной силы НЕТ: высоту корабля ведёт ПОВЕРХНОСТЬ ВОЛНЫ
    //  (кинематика ниже) — корабль плывёт ПО волне, не проваливаясь
    //  внутрь вала (жалоба: «плывёт внутри волн, не по волне»)
    {
      const zf = this._t2.set(0, 0, this.zCom).applyQuaternion(this.quaternion);
      this.torque.x += zf.z * m * G;
      this.torque.z -= zf.x * m * G;
    }

    // --- ПЛАВАНИЕ ПО ПОВЕРХНОСТИ (Task 34): колонны корпуса ЗАМЕРЯЮТ
    //  волны (высота воды над кромкой каждой колонны) — из них
    //  берётся СРЕДНЕВЗВЕШЕННЫЙ УРОВЕНЬ поверхности под корпусом и
    //  моменты выравнивания по склону волны (нос всходит на гребень,
    //  борт притапливается ложбиной — корпус ЛЕЖИТ НА воде).
    //  Развал бортов (flare) над КВЛ усиливает восстановление у
    //  палубы; kRes — доля запаса плавучести открытых судов
    const FFree = this.preset.freeboard;
    const kRes = FFree >= 3.0 ? 1.0 : Math.max(0.32, 0.32 + 0.12 * (FFree - 2.5));
    let wSum = 0, aSum = 0;   // средневзвешенный уровень воды под корпусом
    for (const p of this.cols) {
      const wp = this._t1.set(p.x, 0, p.z).applyQuaternion(this.quaternion).add(this.position);
      const wy = waterHeightAt(wp.x, wp.z, time);
      wSum += wy * p.A; aSum += p.A;
      // вода над началом колонны (проектная ватерлиния), локальная вертикаль
      const s = wy - wp.y;
      const d = Math.min(Math.max(s - p.keelY, 0), p.topY - p.keelY);
      if (d <= 0) continue;
      // развал бортов: жёсткость запаса плавучести (1× на КВЛ → (1+kRes)× у палубы)
      const flare = s > 0 ? 1 + kRes * 1.1 * Math.min(s / FFree, 1) : 1;
      const rx = wp.x - this.position.x, rz = wp.z - this.position.z;
      // вертикальная скорость точки: v = ω × r → vy = ωz·rx − ωx·rz
      const vy = this.velocity.y + (this.angular.z * rx - this.angular.x * rz);
      let fl = RHO * G * p.A * d * flare - p.c * vy;
      if (fl < 0) fl = 0;                     // вода не притягивает
      // только МОМЕНТЫ (крен/дифферент): вертикальную силу заменила
      // кинематика следования поверхности — ватерлиния ВСЕГДА на волне
      this.torque.x += -rz * fl;
      this.torque.z += rx * fl;
    }

    // --- ветер на парусах ---
    this.sailFrac += (this.sailTarget / 3 - this.sailFrac) * Math.min(1, dt * 0.7);
    const awa = this.apparentWindAngle();
    // УПРОЩЁННОЕ УПРАВЛЕНИЕ (настройка): паруса тянут одинаково при
    // любом курсе к ветру — без «мёртвых зон» в левентик
    const polar = CONTROLS.simple ? 0.82 : Ship.polar(awa);
    const sailEffMul = this.sailHP / this.preset.sailHP;
    const damaged = sailEffMul < 0.5 ? 0.45 : sailEffMul < 0.85 ? 0.8 : 1.0;
    const windPower = Math.pow(this.wind.speed / 8.0, 1.6);
    let thrust = 0;
    if (!this.anchored && !this.sinking && this.mastsBroken < 2) {
      thrust = this.sailFrac * polar * windPower * this.preset.maxSpeed * 7.0 * damaged * (this.sailHP > 0 ? 1 : 0);
    }
    if (this.reverseThrust && !this.anchored) thrust = -this.preset.maxSpeed * 0.45; // задний ход на вёслах
    // ГРЕБЛЯ (Alt+W/S): вёсла дают ход даже в полный штиль — но только
    // ВЫВАЛЕННЫЕ (oarsDeployT); под парусами экипаж занят парусами —
    // вёсла помогают меньше
    if (this.preset.oars && !this.anchored && !this.sinking) {
      const crewFrac = clamp(this.crew / this.preset.maxCrew, 0.2, 1);
      const power = this.oarsDeployT * (1 - 0.55 * this.sailFrac) * crewFrac;
      if (this.rowing > 0) thrust += this.preset.maxSpeed * 0.40 * power;
      else if (this.rowing < 0) thrust -= this.preset.maxSpeed * 0.28 * power;
    }
    // сила тяги вдоль forward
    this.force.x += f.x * thrust * m * 0.06;
    this.force.z += f.z * thrust * m * 0.06;
    // крен от ветра: боковая составляющая ветра на парусах.
    // Момент — по ОСИ КОРПУСА (locT.z), квадрат скорости ветра
    // (аэродинамика: сила ∝ v²), ОСЛАБЛЕН ВДВОЕ (Task 34: игрок
    // жаловался на постоянный крен на борт — теперь заметный крен
    // только в свежий ветер/шторм: 12 м/с ≈ 2.5°, 18 ≈ 8°, 24 — до
    // предела из настроек)
    const wf = this._t1.set(Math.cos(this.wind.from), 0, Math.sin(this.wind.from));
    const windTravel = this._t2.copy(wf).multiplyScalar(-this.wind.speed);
    const lateral = windTravel.dot(right);
    const heelWind = Math.pow(this.wind.speed / 8.0, 2.0);
    this._lt.z += lateral * this.sailFrac * heelWind * m * 0.025;
    // ... и небольшое боковое сносовое усилие
    this.force.x += right.x * lateral * this.sailFrac * m * 0.004;
    this.force.z += right.z * lateral * this.sailFrac * m * 0.004;

    // --- руль ---
    this.rudder += (this.rudderTarget - this.rudder) * Math.min(1, dt * 1.8);
    const rudderAngle = this.rudder * 0.6; // рад, макс ~34°
    // УПРОЩЁННОЕ УПРАВЛЕНИЕ: руль работает на ЛЮБОЙ скорости
    // (реалистично — авторитет руля растёт с ходом)
    const yawAuth = CONTROLS.simple ? 1.0 : clamp(spd / 4.0, 0, 1.15);
    // положительный руль (D) = поворот ВПРАВО (штирборт):
    // вращение вокруг −Y, т.к. +Y = поворот влево (к порту)
    this.torque.y -= rudderAngle * yawAuth * m * 12.0; // ~6°/с на полном ходу
    // крен на повороте (отцентробежный) — умеренный: борт не
    // зарывается в воду от самого факта поворота
    this._lt.z += this.angular.y * spd * m * 0.14;
    // лёгкое зарывание носа на скорости (слабое: сильное топило борт
    // в волну на 3+ метра — см. жалобы «корабль погружается по борт»)
    this._lt.x += spd * spd * m * 0.0012;

    // --- сопротивление (по связным осям) ---
    const vLocal = this.velocity.clone();
    const fwdSpd = vLocal.dot(f);
    const latSpd = vLocal.dot(right);
    // КВАДРАТИЧНОЕ сопротивление: полином (18v + 55v|v|) сам нечётен по v,
    // умножение на −sign(v) ИНВЕРТИРОВАЛО его при заднем ходе — попятное
    // движение разгонялось сопротивлением до 20+ уз и NaN (задний ход
    // вёслами/парусами). Теперь сопротивление всегда ПРОТИВ скорости.
    const fwdDrag = -(18 * fwdSpd + 55 * fwdSpd * Math.abs(fwdSpd)) * m * 0.001;
    const latDrag = -latSpd * (3.2) * m * 0.1;
    this.force.x += f.x * fwdDrag + right.x * latDrag;
    this.force.z += f.z * fwdDrag + right.z * latDrag;
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

    // --- ограничение крена/дифферента (мягкие СТОПЫ-ПРЕДОХРАНИТЕЛИ) ---
    // Крен/дифферент — динамика моментов; на волне корпус ЛЕЖИТ НА
    // склоне (см. колонны), пределы — защита от статического крена.
    // КРЕН — ДВУХСТУПЕНЧАТЫЙ ПРЕДЕЛ, оба по оси корпуса (locT):
    //  1) ФИЗИЧЕСКИЙ: кромка ПАЛУБЫ не уходит под воду от статического
    //     крена (ветер/поворот/затопление) — deckRollLim; волна может
    //     кратко накрыть палубу — это «зелёная вода», отдельная механика
    //  2) НАСТРОЙКА heelMax — поверх физического
    const roll = e.z, pitch = e.x;
    const pitchLim = BUOYANCY_CONFIG.pitchMax;
    const deckRollLim = this.deckRollLim();
    const rollLim = Math.min(BUOYANCY_CONFIG.heelMax, deckRollLim);
    if (Math.abs(roll) > rollLim) {
      // жёсткий стоп с квадратичным «упором»: у физического предела
      // (кромка палубы у воды) крен должен ОСТАНОВИТЬСЯ, а не висеть
      // в равновесии на +10° выше предела (мягкий стоп m·9 давал
      // перебег до 27° при пределе 18° — «борт уходит в воду»)
      const excess = Math.abs(roll) - rollLim;
      const k = 200.0 + excess * 800.0;
      this._lt.z -= Math.sign(roll) * excess * k * m;
    }
    if (Math.abs(pitch) > pitchLim) this._lt.x -= (pitch - Math.sign(pitch) * pitchLim) * m * 12.0;
    // затопление кренит корабль в сторону пробоин (ось корпуса)
    this.floodRoll(m);
    // локальные моменты (крен/дифферент) → в мир: оси вращения
    // вращаются вместе с кораблём
    this.torque.add(this._lt.applyQuaternion(this.quaternion));

    // --- интеграция ---
    this.velocity.addScaledVector(this.force, dt / m);
    // ВЕРТИКАЛЬ — СЛЕДОВАНИЕ ПОВЕРХНОСТИ (Task 34): корабль ПЛЫВЁТ
    // ПО волне — ватерлиния на средневзвешенном уровне воды под
    // корпусом (нос/корма/борта замерены колоннами выше). Никакого
    // «резания» вала носом и проваливания внутрь волны: осадка
    // постоянна, палуба идёт над водой. Скорость по Y — честная
    // (для демпферов колонн/кильватера), ход интеграции проходит
    // через position += velocity·dt ниже
    {
      const targetY = wSum / Math.max(1e-6, aSum) - this.draftOff;
      const kY = Math.min(1, dt * 7.0);
      const dy = (targetY - this.position.y) * kY;
      this.velocity.y = dy / Math.max(1e-6, dt);
    }
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

    // КИНЕМАТИЧЕСКАЯ ПОСАДКА НА ВОЛНУ (Task 25) ЗАМЕНЕНА НА
    // КИНЕМАТИКУ ВЕРТИКАЛИ (Task 34): ватерлиния ВСЕГДА на поверхности
    // (см. интеграцию выше) — корабль плывёт ПО волнам, нос всходит
    // на гребень и спускается за ним; крен/дифферент задают моменты
    // (ветер/поворот/затопление + выравнивание по склону волны).
    // Зелёная вода (волна накрывает палубу) — в updateVisual.

    this.stepHousekeeping(dt);
  }

  /** Смена режима физики (Game): посадить вертикальную динамику
   *  на равновесие БЕЗ транзиента. Обе модели плывут ПО ПОВЕРХНОСТИ:
   *  вертикаль сажается на текущий уровень воды у миделя. */
  seedVertical(time: number) {
    const h = waterHeightAt(this.position.x, this.position.z, time);
    this.velocity.y = 0;
    this.position.y = h - (PHYSICS.mode === 'realistic' ? this.draftOff : BUOYANCY_CONFIG.draftOffset);
  }

  /** Применить настройку «осадка глубже/мельче» (Task 31) — ДЛЯ
   *  ФИЗИЧЕСКОЙ модели: СДВИГ ССЫЛКИ киля/планширя колонн на off м.
   *  Модель корпуса становится «мельче» на off → Архимед сажает корабль
   *  ровно на off глубже (off<0 — глубже в модели, корабль выше водой);
   *  в равновесии каждая колонна погружена на d0_i (как на проектной
   *  осадке): подводный объём и ЦВ/ЦМ не тронуты — РОВНЫЙ КИЛЬ
   *  сохраняется на любой осадке. Развал бортов над КВЛ (flare>0 на
   *  глубокой посадке) компенсирован делением площади. off=0 —
   *  точно проектная осадка (ссылки = база, площади = база). */
  applyDraftOffset(off: number) {
    if (!isFinite(off)) off = 0;
    const o = clamp(off, -0.8, 0.8);
    this.draftOff = o;
    // «Развал бортов» над проектной ватерлинией (как в fixedStep) на
    // глубокой посадке усиливает выталкивание (flare > 1) — делим
    // площадь на flare(o), чтобы равновесие попало РОВНО на o
    // (для мельче o<0 равновесие выше КВЛ: flare=1 — без компенсации)
    const FFree = this.preset.freeboard;
    const kRes = FFree >= 3.0 ? 1.0 : Math.max(0.32, 0.32 + 0.12 * (FFree - 2.5));
    const flare = o > 0 ? 1 + kRes * 1.1 * Math.min(o / FFree, 1) : 1;
    for (const c of this.cols) {
      // сдвиг ССЫЛКИ киля/планширя на o: модель считает корпус
      // мельче/глубже — Архимед сажает корабль ровно на o; подводный
      // объём в равновесии = проектному (d_i = d0_i у каждой колонны),
      // ЦВ/ЦМ не тронуты — ровный киль сохраняется на любой осадке
      c.keelY = c.keel0 + o;
      c.topY = c.top0 + o;
      c.A = c.A0 / flare;
    }
  }

  /** Хвост шага физики, ОБЩИЙ для обеих моделей моря: посадка на
   *  мель, течь, пожар, порог затопления, сдача в плен (Task 27) */
  private stepHousekeeping(dt: number) {
    // --- посадка на мель / столкновение с землёй ---
    this.checkGrounding(dt);

    // --- течение воды в трюме ---
    if (this.leakRate > 0) {
      this.water = Math.min(this.holdCap, this.water + this.leakRate * dt);
    }
    if (this.onFire) {
      this.fireT += dt;
      const I = this.fireIntensity;
      // рост: сухая палуба разгорается, сильный ветер раздувает;
      // после 40 с горения топливо прогорает — интенсивность падает
      let dI: number;
      if (this.fireT > 40) dI = -0.05;                             // догорело
      else dI = 0.008 + 0.022 * I + Math.min(0.012, this.wind.speed * 0.0009);
      // дождь тушит
      dI -= this.rainRate * 0.03;
      this.fireIntensity = clamp(this.fireIntensity + dI * dt, 0, 1);
      if (this.fireIntensity <= 0.01) {
        this.onFire = false; this.fireT = 0;
      } else {
        // урон: корпус горит всегда, паруса — от 0.4, команда — от 0.6,
        // такелаж вспыхивает на полном огне
        this.hullHP -= dt * (0.5 + 2.8 * I);
        if (I > 0.4) this.sailHP = Math.max(0, this.sailHP - dt * I * 2.2);
        if (I > 0.6) this.crew = Math.max(0, this.crew - dt * 0.22 * I);
        if (I > 0.9 && Math.random() < dt * 0.05) this.breakMast();
        // визуал: частота и размер пламени от интенсивности
        if (Math.random() < dt * (0.8 + 3.2 * I)) {
          const p = this.particles;
          const wp = this.position;
          const spread = 3 + I * 6;
          p.fire(wp.x + (Math.random() - 0.5) * spread, this.waterlineY() + 0.8 + Math.random() * 2.5,
            wp.z + (Math.random() - 0.5) * spread * 2.2);
          p.smoke(wp.x + (Math.random() - 0.5) * spread, this.waterlineY() + 3,
            wp.z + (Math.random() - 0.5) * spread * 2.2,
            this.wind ? Math.cos(this.wind.from + Math.PI) * 2 : 0, 2.2,
            this.wind ? Math.sin(this.wind.from + Math.PI) * 2 : 0,
            2.2 + I * 1.6, 2.6 + I);
        }
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
  }

  // ============================================================
  // ПРОСТАЯ ФИЗИКА (настройка «Физика корабля → Простая»):
  // корабль СКОЛЬЗИТ ПО ПОВЕРХНОСТИ единого моря. 5 точек замера
  // (нос/корма/борта/мидель) на волнах Герстнера задают рамку
  // ориентации — нос всходит на передний склон гребня и спускается
  // за ним; вертикаль — БЫСТРОЕ экспоненциальное следование
  // средневзвешенной поверхности (пружина попадала в резонанс и
  // гоняла корабль в противофазе — теперь глубоких нырков НЕТ
  // ВООБЩЕ, корабль не проваливается внутрь волн). Крен от ветра
  // на парусах и затопления — целевой угол рамки с пределом.
  // ============================================================
  /** сглаженный крен от ветра/затопления — публичен для телеметрии */
  rideHeel = 0;
  private _rf = new THREE.Vector3();
  private _ru = new THREE.Vector3();
  private _rr = new THREE.Vector3();
  private _rv1 = new THREE.Vector3();
  private _rv2 = new THREE.Vector3();
  private _rm = new THREE.Matrix4();
  private _re = new THREE.Euler();   // разбор кватерниона (подъём шлюпки)
  private _rq = new THREE.Quaternion();
  private _rHeelQ = new THREE.Quaternion();

  /** Горизонтальная физика простой модели: паруса / вёсла / руль /
   *  сопротивление + интеграция горизонтали и курса. Гравитации и
   *  кренящих моментов нет — наклон корпуса задаёт волна (рамка).
   *  Обновляет this._f/_r до курса ПОСЛЕ поворота. Возвращает
   *  боковую составляющую ветра В СТОРОНУ ПОРТА (для крена). */
  private simpleHorizontalStep(dt: number): number {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);

    const f = this._f.copy(this.forward);
    // ПОРТ (левый борт) = локальная +X: (f.z, 0, −f.x)
    const port = this._r.set(f.z, 0, -f.x).normalize();
    const spd = this.speed();
    const m = this.mass + this.water * 1000;

    // --- горизонтальные силы: паруса / вёсла / руль / сопротивление ---
    this.sailFrac += (this.sailTarget / 3 - this.sailFrac) * Math.min(1, dt * 0.7);
    const awa = this.apparentWindAngle();
    // УПРОЩЁННОЕ УПРАВЛЕНИЕ: паруса тянут одинаково при любом курсе
    const polar = CONTROLS.simple ? 0.82 : Ship.polar(awa);
    const sailEffMul = this.sailHP / this.preset.sailHP;
    const damaged = sailEffMul < 0.5 ? 0.45 : sailEffMul < 0.85 ? 0.8 : 1.0;
    const windPower = Math.pow(this.wind.speed / 8.0, 1.6);
    let thrust = 0;
    if (!this.anchored && this.mastsBroken < 2) {
      thrust = this.sailFrac * polar * windPower * this.preset.maxSpeed * 7.0 * damaged * (this.sailHP > 0 ? 1 : 0);
    }
    if (this.reverseThrust && !this.anchored) thrust = -this.preset.maxSpeed * 0.45;
    if (this.preset.oars && !this.anchored) {
      const crewFrac = clamp(this.crew / this.preset.maxCrew, 0.2, 1);
      const power = this.oarsDeployT * (1 - 0.55 * this.sailFrac) * crewFrac;
      if (this.rowing > 0) thrust += this.preset.maxSpeed * 0.40 * power;
      else if (this.rowing < 0) thrust -= this.preset.maxSpeed * 0.28 * power;
    }
    this.force.x += f.x * thrust * m * 0.06;
    this.force.z += f.z * thrust * m * 0.06;
    // боковой снос от ветра
    const wf = this._t1.set(Math.cos(this.wind.from), 0, Math.sin(this.wind.from));
    const windTravel = this._t2.copy(wf).multiplyScalar(-this.wind.speed);
    const lateralPort = windTravel.dot(port);
    this.force.x += port.x * lateralPort * this.sailFrac * m * 0.004;
    this.force.z += port.z * lateralPort * this.sailFrac * m * 0.004;

    // руль (только рыскание); УПРОЩЁННОЕ УПРАВЛЕНИЕ — авторитет всегда 1
    this.rudder += (this.rudderTarget - this.rudder) * Math.min(1, dt * 1.8);
    const rudderAngle = this.rudder * 0.6;
    const yawAuth = CONTROLS.simple ? 1.0 : clamp(spd / 4.0, 0, 1.15);
    this.torque.y -= rudderAngle * yawAuth * m * 12.0;

    // сопротивление (по связным осям)
    const fwdSpd = this.velocity.dot(f);
    const latSpd = this.velocity.dot(port);
    const fwdDrag = -(18 * fwdSpd + 55 * fwdSpd * Math.abs(fwdSpd)) * m * 0.001;
    const latDrag = -latSpd * 3.2 * m * 0.1;
    this.force.x += f.x * fwdDrag + port.x * latDrag;
    this.force.z += f.z * fwdDrag + port.z * latDrag;
    if (this.anchored) {
      this.force.x -= this.velocity.x * m * 1.2;
      this.force.z -= this.velocity.z * m * 1.2;
    }
    if (this.grounded) {
      this.force.x -= this.velocity.x * m * 2.5;
      this.force.z -= this.velocity.z * m * 2.5;
    }

    // --- интеграция горизонтали и курса ---
    this.velocity.addScaledVector(this.force, dt / m);
    this.velocity.y = 0;
    this.position.addScaledVector(this.velocity, dt);
    this.angular.y += (this.torque.y / this.inertia.y) * dt;
    this.angular.y *= Math.exp(-0.9 * dt);
    this.angular.x = 0;
    this.angular.z = 0;
    // целевой курс — рамка строится ПО НЕМУ, а кватернион плавно
    // доворачивается к рамке (БЕЗ сброса в вертикаль: иначе slerp
    // каждый шаг начинался бы заново и наклон не набирался)
    const heading = this.heading + this.angular.y * dt;
    // нос после поворота курса
    f.set(Math.sin(heading), 0, Math.cos(heading));
    port.set(f.z, 0, -f.x);
    return lateralPort;
  }

  private stepSimpleWaves(dt: number, time: number) {
    const L = this.preset.length, B = this.preset.beam;
    const lateralPort = this.simpleHorizontalStep(dt);
    const f = this._f, port = this._r;
    const aF = L * 0.42, aS = B * 0.78;   // точки замера: нос/корма, борта

    // --- 5 ТОЧЕК ЗАМЕРА на волнах единого моря ---
    const hBow = waterHeightAt(this.position.x + f.x * aF, this.position.z + f.z * aF, time);
    const hStern = waterHeightAt(this.position.x - f.x * aF, this.position.z - f.z * aF, time);
    const hPort = waterHeightAt(this.position.x + port.x * aS, this.position.z + port.z * aS, time);
    const hStar = waterHeightAt(this.position.x - port.x * aS, this.position.z - port.z * aS, time);
    const hMid = waterHeightAt(this.position.x, this.position.z, time);

    // рамка: forward с уклоном нос-корма, up из векторного произведения
    const slopeZ = (hBow - hStern) / (L * 0.84);
    this._rv1.set(f.x * L * 0.84, hBow - hStern, f.z * L * 0.84);
    this._rv2.set(port.x * B * 1.56, hPort - hStar, port.z * B * 1.56);
    const u = this._ru.copy(this._rv1).cross(this._rv2).normalize();
    const ff = this._rf.set(f.x, slopeZ, f.z).normalize();
    const rr = this._rr.copy(u).cross(ff).normalize();
    this._rm.makeBasis(rr, u, ff);
    this._rq.setFromRotationMatrix(this._rm);

    // крен от ветра на парусах + затопления — целевой УГОЛ рамки
    // (в реалистичной модели это момент по оси корпуса; здесь —
    // доворот вокруг ДП). Ветер В СТОРОНУ порта кренит к порту
    // (подветренный борт вниз). ОСЛАБЛЕН ВДВОЕ от прежнего (Task 34 —
    // как в реалистичной модели: заметный крен только в свежий ветер).
    // Предел: настройка «Макс. крен» и ФИЗИЧЕСКИЙ — кромка палубы
    // не ныряет от статического крена
    const heelMax = Math.min(BUOYANCY_CONFIG.heelMax, this.deckRollLim());
    const heelTarget = clamp(
      -lateralPort * this.sailFrac * 0.006
      + this.leakBias * clamp(this.water / this.holdCap, 0, 1) * 0.3,
      -heelMax, heelMax);
    this.rideHeel += (heelTarget - this.rideHeel) * Math.min(1, dt * 1.2);
    this._rHeelQ.setFromAxisAngle(this._t1.set(0, 0, 1), this.rideHeel);
    this._rq.multiply(this._rHeelQ);
    // плавный доворот к рамке волны (тяжёлый корпус не «прилипает»)
    this.quaternion.slerp(this._rq, 1 - Math.exp(-3.0 * dt));

    // --- вертикаль: ПРЯМОЕ следование средневзвешенной поверхности ---
    // (быстрая экспонента: гасит дрожь замеров, но не отстаёт от
    // волны; пружина попадала в резонанс и топила корпус — теперь
    // корабль ПЛЫВЁТ ПО волнам, осадка постоянна). «Осадка ±» —
    // сдвиг посадки; лёгкое притопление от наклона и хода
    const sink = -(1 - u.y) * 0.6
      - Math.min(Math.abs(this.speed()) * 0.02, 0.2)
      - BUOYANCY_CONFIG.draftOffset;
    const targetY = hMid * 0.45 + (hBow + hStern + hPort + hStar) * 0.1375 + sink;
    this.position.y += (targetY - this.position.y) * Math.min(1, dt * 7.0);

    // мел / течь / пожар / сдача — общий хвост обеих физик
    this.stepHousekeeping(dt);
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
        // ЭКИПАЖ гибнет ТОЛЬКО от прямого прострела палубы (CombatSystem
        // → crew3d.killNearPath). Залп в борт ниже палубы людей не косит:
        // доска и переборки принимают удар на себя
        // случайный «рикошет в рангоут» — редкий, основную работу делают
        // прицельные попадания из CombatSystem (mast hits)
        if (rng() < 0.10) this.breakMast();
        break;
      }
      case 'chain': {
        this.sailHP = Math.max(0, this.sailHP - d.amount);
        // книппель рвёт такелаж над головами — люди гибнут только от
        // обрывов рангоута (breakMast) и прямых прострелов
        break;
      }
      case 'grape': {
        // экипаж гибнет ТОЛЬКО фигурами на палубе (combat вычитает
        // 1 за каждую убитую) — абстрактного списания
        // нет: залп в борт людей не косит
        this.hullHP -= d.amount * 0.4;
        break;
      }
      case 'fire': {
        this.hullHP -= d.amount;
        if (rng() < 0.35) this.ignite(0.3 + rng() * 0.25); // очаг на палубе
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

  /** Зажечь палубу: strength — начальная сила очага 0..1.
   *  Существующий пожар не ослабляет — новое пламя добавляет силы */
  ignite(strength: number): boolean {
    if (this.sinking || this.sunk) return false;
    this.onFire = true;
    this.fireIntensity = clamp(Math.max(this.fireIntensity, strength), 0, 1);
    return true;
  }

  /** Урон ПАРУСАМ: пробоины картечи/книппеля снижают тягу (sailHP).
   *  Дыры рисуются отдельно — см. combat.applySailHit + sailAddHole. */
  damageSails(n: number) {
    this.sailHP = Math.max(0, this.sailHP - n);
  }

  /** Пробоина в борту: тёмная рваная дыра + торчащие щепки-доски
   *  вокруг + течь (ниже ватерлинии) + кренящий момент */
  addHole(localPos: THREE.Vector3, belowWL: boolean) {
    const side = localPos.x >= 0 ? 1 : -1;
    const w = Math.max(0.3, this.halfWidthAt(localPos.z) * 0.985);
    // группа: дыра + щепки (одна запись в hullHoles)
    const hole = new THREE.Group();
    const R = 0.36 + Math.random() * 0.18;
    const mat = new THREE.MeshStandardMaterial({ color: 0x120d08, roughness: 1 });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(R, 9), mat);
    mesh.rotation.y = side * Math.PI / 2;
    mesh.rotation.x = (Math.random() - 0.5) * 0.5;
    hole.add(mesh);
    // рваные доски по краям — вывернуло обшивку
    const nSp = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nSp; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = R * (0.75 + Math.random() * 0.5);
      const sp = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.07, 0.35 + Math.random() * 0.5),
        new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95 }));
      sp.position.set(side * 0.06, Math.sin(a) * r, Math.cos(a) * r);
      sp.rotation.set((Math.random() - 0.5) * 0.9, side * Math.PI / 2 + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.9);
      hole.add(sp);
    }
    hole.position.set(side * w, localPos.y, localPos.z);
    this.visual.group.add(hole);
    this.hullHoles.push({ side, belowWL, mesh: hole as unknown as THREE.Mesh });
    if (belowWL) {
      this.addLeak(0.16 + Math.random() * 0.10);
      this.leakBias = clamp(this.leakBias + side * 0.35, -1, 1);
    }
  }

  /** Сорвать ломаемую деталь палубы (штурвал/шпиль/фонарь/фигура/руль)
   *  прямым попаданием: деталь исчезает, щепа летит. Возвращает true,
   *  если что-то сорвали */
  damageProp(localHit: THREE.Vector3, power: number): boolean {
    if (power < 6) return false; // лёгкие снаряды детали не срывают
    let best: THREE.Object3D | null = null;
    let bestD = 4.2; // радиус срыва
    for (const obj of this.visual.breakables) {
      if (!obj.visible) continue;
      const d = Math.hypot(obj.position.x - localHit.x, (obj.position.y - localHit.y) * 0.7,
        obj.position.z - localHit.z);
      if (d < bestD) { bestD = d; best = obj; }
    }
    if (!best) return false;
    best.visible = false;
    const wp = this.tmpV.copy(best.position).applyQuaternion(this.quaternion).add(this.position);
    const gibs = Ship.gibs;
    // шлюпка разлетается ЩЕПОЙ ПОКРУПНЕЕ (доски вразлёт)
    const isBoat = !!(best.userData as { deckBoat?: boolean }).deckBoat;
    if (gibs) {
      const n = isBoat ? 14 : 6;
      for (let i = 0; i < n; i++) {
        gibs.spawnPart(
          new THREE.Vector3(wp.x + (Math.random() - 0.5) * (isBoat ? 1.8 : 0.6), wp.y + Math.random() * (isBoat ? 1.0 : 0.8), wp.z + (Math.random() - 0.5) * (isBoat ? 1.8 : 0.6)),
          new THREE.Vector3((Math.random() - 0.5) * (isBoat ? 10 : 7), 2.5 + Math.random() * (isBoat ? 5 : 4), (Math.random() - 0.5) * (isBoat ? 10 : 7)),
          isBoat ? 0.24 : 0.16, 0.1, 0.55, isBoat && Math.random() < 0.55 ? 0x8a6a44 : 0x5c4430, 1.8 + Math.random());
      }
    }
    this.particles.smoke(wp.x, wp.y, wp.z, 0, isBoat ? 1.1 : 0.6, 0, 1.0, isBoat ? 1.6 : 1.1);
    return true;
  }

  /** Затопление: крен в сторону пробоин + вода в трюме утяжеляет.
   *  Момент — по оси КОРПУСА (_lt.z) */
  private floodRoll(m: number) {
    if (this.water <= 0 || this.sinking) return;
    const frac = this.water / this.holdCap;
    this._lt.z += this.leakBias * frac * m * 0.06;
  }

  /** ФИЗИЧЕСКИЙ предел крена: угол, при котором кромка ПАЛУБЫ
   *  (у миделя, самая широкая точка) касается воды. Статический крен
   *  (ветер/поворот/затопление) выше этого угла топит палубу —
   *  ограничиваем с запасом 15%. Зелёная вода от волны — отдельная
   *  механика (updateVisual), её не трогаем */
  deckRollLim(): number {
    const prof = hullProfile(0.5, this.preset);
    return Math.atan2(prof.bulwark - 1.0, Math.max(0.3, prof.w)) * 0.85;
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
    // === КАСКАД: вместе с мачтой гибнут ВСЕ её элементы ===
    // паруса этой мачты РВЁТСЯ: полотно изрешечено (uDamage=1 + дыры),
    // обвисает и больше не даёт тягу; обрывки парусины летят вниз
    let tornSails = 0;
    for (const s of this.visual.sails.sails) {
      if (s.mastIndex !== i) continue;
      tornSails++;
      s.mat.uniforms.uDamage.value = 1;
      sailAddHole(s, 0.3 + Math.random() * 0.4, 0.25 + Math.random() * 0.5, 0.22);
      sailAddHole(s, 0.15 + Math.random() * 0.7, 0.5 + Math.random() * 0.4, 0.18);
      sailAddHole(s, 0.4 + Math.random() * 0.3, 0.1 + Math.random() * 0.3, 0.15);
      s.furl = 1;
    }
    // снасть рушится с высоты — обрывки парусины и щепа рея
    const mast = this.visual.masts[i];
    const mid = this.tmpV.set(0, ((mast.userData.height as number) || 20) * 0.55, mast.position.z)
      .applyQuaternion(this.quaternion).add(this.position);
    if (tornSails > 0 && this.particles) {
      for (let k = 0; k < 5; k++) {
        this.particles.spawn(mid.x + (Math.random() - 0.5) * 6, mid.y - Math.random() * 4,
          mid.z + (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 3, -0.5, (Math.random() - 0.5) * 3,
          0.9, 0.4, 0, 0.8, 14);
      }
      this.particles.smoke(mid.x, mid.y, mid.z, 0, 0.4, 0, 0.8, 1.4);
    }
    // === ОБВЯЗКА МАЧТЫ ЛОПАЕТСЯ ВМЕСТЕ С НЕЙ: все её ванты/
    // штаги/бакштаги схлопываются + обрывки троса летят гибами ===
    this.snapRigging(i);
  }

  /** Обрыв обвязки мачты idx: её снасти (ванты/штаги) вырождаются
   *  в точку (линия исчезает), обрывки троса летят из середины
   *  снасти. Возвращает число оборванных снастей */
  private snapRigging(idx: number): number {
    const rig = this.visual.rigging;
    if (!rig || !rig.meta.length) return 0;
    const posAttr = rig.lines.geometry.attributes.position as THREE.BufferAttribute;
    const mast = this.visual.masts[idx];
    const bx = 0, by = 0.4, bz = mast ? mast.position.z : 0;
    let n = 0;
    const snappedAt: THREE.Vector3[] = [];
    for (let li = 0; li < rig.meta.length; li++) {
      const l = rig.meta[li];
      if (l.mast !== idx) continue;
      // вырожденный отрезок (ноль длины) — линия не рисуется
      posAttr.setXYZ(li * 2, bx, by, bz);
      posAttr.setXYZ(li * 2 + 1, bx, by, bz);
      n++;
      if (snappedAt.length < 6) snappedAt.push(l.a.clone().lerp(l.b, 0.45));
    }
    if (n > 0) {
      posAttr.needsUpdate = true;
      this.rigSnapped = Math.min(this.rigSnapped + n, rig.meta.length);
    }
    // ДЕРЖАЩИЕ ЭЛЕМЕНТЫ падают вместе с мачтой: ванты с выбленками
    // из группы мелких деталей — своя пара линий на мачту — исчезает
    // (жалоба «тросы не упали вместе с мачтой»: обрывалась только
    // обвязка, а веер вант с выбленками висел в воздухе)
    if (this.visual.detailRigs?.length) {
      for (const dr of this.visual.detailRigs) {
        if (dr.mast !== idx || !dr.lines.visible) continue;
        dr.lines.visible = false;
        n++;
        // обрывки троса из середины вант
        const g = Ship.gibs;
        for (let k = 0; k < 3 && g; k++) {
          const sp = this.tmpV.set((Math.random() - 0.5) * 4, 2 + Math.random() * 3,
            this.visual.masts[idx].position.z + (Math.random() - 0.5) * 4)
            .applyQuaternion(this.quaternion).add(this.position);
          g.spawnPart(
            new THREE.Vector3(sp.x, sp.y, sp.z),
            new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3),
            0.05, 0.05, 0.7 + Math.random() * 0.5, 0x241c12, 1.5 + Math.random());
        }
      }
    }
    // обрывки троса + пыль от лопнувших вант
    const gibs = Ship.gibs;
    for (const sp of snappedAt) {
      const wp = this.tmpV.copy(sp).applyQuaternion(this.quaternion).add(this.position);
      if (gibs) {
        for (let k = 0; k < 2; k++) {
          gibs.spawnPart(
            new THREE.Vector3(wp.x, wp.y, wp.z),
            new THREE.Vector3((Math.random() - 0.5) * 3.5, 1.2 + Math.random() * 2.2,
              (Math.random() - 0.5) * 3.5),
            0.05, 0.05, 0.7 + Math.random() * 0.5, 0x241c12, 1.6 + Math.random());
        }
      }
      this.particles?.smoke(wp.x, wp.y, wp.z, 0, 0.3, 0, 0.5, 0.8);
    }
    return n;
  }

  /** Сколько снастей обвязки оборвано — телеметрия/E2E */
  riggingSnapped(): number { return this.rigSnapped; }

  /** Сброс ВСЕХ повреждений (полигон/возрождение): корпус, мачты,
   *  паруса, пробоины, течь, пожар, экипаж, ломаемые детали, намокание */
  clearDamage() {
    this.hullHP = this.hullMax;
    this.sailHP = this.sailMax;
    this.water = 0;
    this.leakRate = 0;
    this.leakBias = 0;
    this.onFire = false;
    this.fireT = 0;
    this.fireIntensity = 0;
    this.sinking = false;
    this.sinkT = 0;
    this.sinkPhase = 0;
    this.sunk = false;
    this.surrendered = false;
    this.mastsBroken = 0;
    this.mastAnim = -1;
    // сухое дерево: вернуть материалы исходные цвета/шероховатость
    this.resetWetness();
    // ломаемые детали на место
    for (const obj of this.visual.breakables) obj.visible = true;
    // обвязка мачт — все снасти целы (вырожденные точки → концы)
    if (this.visual.rigging?.meta.length) {
      const posAttr = this.visual.rigging.lines.geometry.attributes.position as THREE.BufferAttribute;
      this.visual.rigging.meta.forEach((l, li) => {
        posAttr.setXYZ(li * 2, l.a.x, l.a.y, l.a.z);
        posAttr.setXYZ(li * 2 + 1, l.b.x, l.b.y, l.b.z);
      });
      posAttr.needsUpdate = true;
    }
    this.rigSnapped = 0;
    // ванты с выбленками — на место (вместе с обвязкой)
    if (this.visual.detailRigs) {
      for (const dr of this.visual.detailRigs) dr.lines.visible = true;
    }
    for (let i = 0; i < this.visual.masts.length; i++) {
      this.mastHP[i] = this.mastMaxHP;
      this.mastFall[i] = -1;
      this.mastSplashed[i] = false;
      const m = this.visual.masts[i];
      m.rotation.set(0, 0, 0);
      m.position.y = 0;
    }
    // паруса порванных мачт — целы (КАСКАД ломания отменяется)
    for (const s of this.visual.sails.sails) {
      s.mat.uniforms.uDamage.value = 0;
      s.mat.uniforms.uHoleN.value = 0;
      s.furl = 1;
    }
    for (const h of this.hullHoles) {
      this.visual.group.remove(h.mesh);
      h.mesh.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mm = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach(x => x.dispose()); else mm?.dispose();
      });
    }
    this.hullHoles = [];
    this.crew = Math.round(this.preset.maxCrew * 0.8);
    this.crew3d.reset();
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
    this.sinkPhase = 1;
    // ВНИМАНИЕ: пожар НЕ гасим — горящий корабль, уходящий носом в воду,
    // дотягивает пламя до фазы 2 (палуба под водой — там вода его гасит)
    this.sailTarget = 0;
    this.rudderTarget = 0;
    // сценарий гибели: валиться в сторону пробоин (или наугад),
    // зарываться носом/кормой, закручиваться в свою сторону
    this.sinkSide = Math.abs(this.leakBias) > 0.15 ? Math.sign(this.leakBias) : (Math.random() < 0.5 ? -1 : 1);
    this.sinkTrim = Math.random() < 0.62 ? 1 : -1; // чаще — носом
    this.sinkSpin = Math.random() < 0.5 ? -1 : 1;
    this.sinkRollT = this.sinkSide * (0.85 + Math.random() * 0.45);   // 49..74°
    this.sinkPitchT = this.sinkTrim * (0.24 + Math.random() * 0.20);  // 14..25°
    this.sinkDebrisDone = false;
  }

  // ============================================================
  // ПОЭТАПНОЕ ЗАТОПЛЕНИЕ (по сценарию гибели парусника):
  //  фаза 1 — потеря остойчивости: крен на борт, дифферент носом/
  //    кормой, медленное погружение; вода в трюме добирается
  //  фаза 2 — палуба уходит под воду: паруса и мачты работают
  //    ГИДРОТОРМОЗОМ (вращение замедляется), дерево намокает
  //    (темнеет, roughness → 1), с палубы срываются обломки
  //    (доски/бочки всплывают рядом), надстройки рушатся
  //  фаза 3 — финальный уход: заполненные отсеки тянут вниз
  //    быстрее, корпус ЗАКРУЧИВАЕТСЯ по спирали (yaw), пузыри
  //    воздуха рвутся из люков и пушечных портов
  // ============================================================
  private stepSinking(dt: number, time: number) {
    this.sinkT += dt;
    const P = this.preset;
    const L = P.length, B = P.beam, F = P.freeboard;
    const e2 = this._e2.setFromQuaternion(this.quaternion, 'YXZ');

    // вода в трюме прибывает неотвратимо (пробоины + открытые люки)
    this.water = Math.min(this.holdCap, this.water + Math.max(this.leakRate, 0.5) * dt);

    // палуба низкого борта: высота над ТЕКУЩЕЙ водой у корпуса
    const wy = waterHeightAt(this.position.x, this.position.z, time);
    const lowDeck = this.position.y + F * 0.82 * Math.cos(e2.z) - (B * 0.5) * Math.abs(Math.sin(e2.z));
    const subFrac = clamp((wy - lowDeck) / Math.max(1, F), 0, 1); // 0 сухая .. 1 над палубой

    // --- переходы фаз ---
    if (this.sinkPhase === 1 && (subFrac > 0.22 || this.sinkT > 9)) this.enterSinkPhase2();
    if (this.sinkPhase === 2 && (subFrac > 0.88 || this.sinkT > 17)) this.sinkPhase = 3;

    // --- пожар фазы 1: надводная часть ещё горит (картина гибели
    //     брандера — пламя + дым, пока палуба не ушла под воду) ---
    if (this.onFire && this.sinkPhase === 1) {
      const I = this.fireIntensity;
      if (Math.random() < dt * (1.2 + 2.2 * I)) {
        this.particles.fire(
          this.position.x + (Math.random() - 0.5) * B * 0.6,
          this.position.y + F * 0.5 + Math.random() * 2,
          this.position.z + (Math.random() - 0.5) * L * 0.5);
        this.particles.smoke(
          this.position.x + (Math.random() - 0.5) * B,
          this.position.y + F + 2,
          this.position.z + (Math.random() - 0.5) * L * 0.6,
          (Math.random() - 0.5) * 1.5, 2.6, (Math.random() - 0.5) * 1.5,
          2.8 + I * 1.4, 3.6);
      }
    }

    // --- вертикаль: погружение ускоряется по мере заполнения отсеков ---
    const vSink = this.sinkPhase === 1 ? 0.20
      : this.sinkPhase === 2 ? 0.42
        : 0.85 + Math.min(0.9, (this.sinkT - 17) * 0.05);
    this.position.y -= vSink * dt;
    this.velocity.set(this.velocity.x * 0.9, -vSink, this.velocity.z * 0.9);

    // --- вращение: гидротормоз мачт/парусов в воде ---
    // чем глубже села палуба, тем сильнее вода давит на рангоут —
    // корпус «не может» докрутиться (как настоящие паруса-гидротормоз)
    const mastBrake = 1 / (1 + subFrac * 4.5 + (this.mastsBroken > 0 ? 0.7 : 0));
    const rollRate = 0.34 * mastBrake;
    const pitchRate = 0.13 * mastBrake;
    e2.z += clamp(this.sinkRollT - e2.z, -rollRate * dt, rollRate * dt);
    e2.x += clamp(this.sinkPitchT - e2.x, -pitchRate * dt, pitchRate * dt);
    // спираль: едва заметное рыскание с начала, бодрое — в финале
    const spinRate = this.sinkPhase === 3 ? 0.16 + Math.min(0.22, this.sinkT * 0.008) : 0.02;
    e2.y += this.sinkSpin * spinRate * dt;
    this.quaternion.setFromEuler(e2);
    this.angular.set(0, this.sinkSpin * spinRate, 0);

    // --- намокание дерева: темнее и матовее с каждой секундой ---
    if (this.sinkPhase >= 2) this.applyWetness(dt);

    // --- эффекты: пена у борта, пузыри из портов, водоворот ---
    this.sinkFx(dt, time, subFrac);

    // --- конец: надстройки глубоко под водой — корабль ушёл ---
    if (this.position.y < -(F + L * 0.30) || this.sinkT > 26) {
      this.sunk = true;
      this.sinkPhase = 3;
      this.visual.group.visible = false;
      this.onSunk?.(this);
    }
  }

  /** Фаза 2: мачты валятся за борт, обломки и бочки срываются
   *  с палубы и всплывают рядом, надстройки рушатся давлением */
  private enterSinkPhase2() {
    this.sinkPhase = 2;
    // палуба под водой — пожар погас, но догорающий пар дымит столбом
    if (this.onFire) {
      this.onFire = false;
      this.fireIntensity = 0;
      for (let i = 0; i < 6; i++) {
        this.particles.smoke(
          this.position.x + (Math.random() - 0.5) * this.preset.beam,
          this.waterlineY() + 2 + Math.random() * 3,
          this.position.z + (Math.random() - 0.5) * this.preset.length * 0.6,
          (Math.random() - 0.5) * 1.5, 2.4, (Math.random() - 0.5) * 1.5,
          3.4, 4.5);
      }
      this.particles.splash(this.position.x, waterHeightAt(this.position.x, this.position.z, 0), this.position.z, 1.2);
    }
    // рангоут: оставшиеся мачты ломаются и валятся (паруса в воде)
    for (let i = 0; i < this.mastFall.length; i++) {
      if (this.mastFall[i] < 0) this.breakMast(i);
    }
    this.sinkDebrisDone = true;
    // россыпь досок/реек с палубы и бортов (модуль debris)
    spawnShipDebris({
      position: this.position, quaternion: this.quaternion,
      length: this.preset.length, beam: this.preset.beam,
      freeboard: this.preset.freeboard,
    });
    // бочки выкатываются из трюма — всплывают рядом
    const nB = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nB; i++) {
      const lp = this.tmpV.set(
        (Math.random() - 0.5) * this.preset.beam * 0.6,
        this.preset.freeboard * 0.4,
        (Math.random() - 0.5) * this.preset.length * 0.6,
      ).applyQuaternion(this.quaternion).add(this.position);
      spawnDebrisAt(lp.x, Math.max(lp.y, 0.4), lp.z, 'barrel', new THREE.Vector3(
        (Math.random() - 0.5) * 1.4, 0.8 + Math.random(), (Math.random() - 0.5) * 1.4));
    }
    // обломок каждой мачты — длинный рангоут
    for (let i = 0; i < this.mastFall.length; i++) {
      const lp = this.tmpV.set(
        (Math.random() - 0.5) * this.preset.beam,
        this.preset.freeboard * 1.2,
        this.visual.masts[i].position.z,
      ).applyQuaternion(this.quaternion).add(this.position);
      spawnDebrisAt(lp.x, Math.max(lp.y, 0.4), lp.z, 'spar', new THREE.Vector3(
        (Math.random() - 0.5) * 1.2, 0.5, (Math.random() - 0.5) * 1.2), 60 + Math.random() * 30);
    }
    // щепа от рушащихся надстроек
    const gibs = Ship.gibs;
    if (gibs) {
      for (let i = 0; i < 10; i++) {
        const lp = this.tmpV.set(
          (Math.random() - 0.5) * this.preset.beam,
          this.preset.freeboard * (0.6 + Math.random() * 0.8),
          (Math.random() - 0.5) * this.preset.length * 0.8,
        ).applyQuaternion(this.quaternion).add(this.position);
        gibs.spawnPart(lp, new THREE.Vector3(
          (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4),
        0.2, 0.14, 0.7, 0x6e5433, 2.2);
      }
    }
  }

  /** Собрать материалы корпуса (один раз) и плавно «мочить» их */
  private applyWetness(dt: number) {
    if (!this.wetMats) {
      this.wetMats = [];
      this.visual.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        // только СТАНДАРТНЫЕ материалы ЭТОГО корабля (общий CREW_MAT
        // экипажа и шейдеры парусов/флага не трогаем)
        if (mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial
          && mat !== CREW_MAT && !(mat as unknown as THREE.ShaderMaterial).uniforms) {
          this.wetMats!.push({
            mat: mat as THREE.MeshStandardMaterial,
            base: (mat as THREE.MeshStandardMaterial).color.clone(),
            rough: (mat as THREE.MeshStandardMaterial).roughness,
            metal: (mat as THREE.MeshStandardMaterial).metalness,
          });
        }
      });
    }
    this.wetness = Math.min(1, this.wetness + dt * 0.22);
    const dark = 0.62 - 0.38 * this.wetness; // 1 → 0.62 → 0.24 яркости
    for (const w of this.wetMats) {
      w.mat.color.copy(w.base).multiplyScalar(dark);
      w.mat.roughness = clamp(w.rough + (1 - w.rough) * this.wetness, 0, 1);
      w.mat.metalness = w.metal * (1 - this.wetness * 0.8);
    }
  }

  /** Восстановить сухие материалы (после утопления/сброса полигона) */
  private resetWetness() {
    if (this.wetMats) {
      for (const w of this.wetMats) {
        w.mat.color.copy(w.base);
        w.mat.roughness = w.rough;
        w.mat.metalness = w.metal;
      }
    }
    this.wetMats = null;
    this.wetness = 0;
  }

  /** Эффекты гибели: пена вдоль борта (вортекс), пузыри из люков,
   *  брызги при погружении палубы */
  private sinkFx(dt: number, time: number, subFrac: number) {
    this.sinkFxT += dt;
    const P = this.preset;
    const per = this.sinkFxT > 0.10; // 10 Гц — не заливаем пул частиц
    if (!per) return;
    this.sinkFxT = 0;
    const p = this.particles;
    // 1) пенный воротник кромки воды вдоль корпуса (зона водоворота)
    const nFoam = this.sinkPhase >= 2 ? 3 : 2;
    for (let i = 0; i < nFoam; i++) {
      const zz = (Math.random() - 0.5) * P.length * 0.9;
      const side = Math.random() < 0.5 ? -1 : 1;
      const lp = this.tmpV.set(side * P.beam * 0.55, 0, zz)
        .applyQuaternion(this.quaternion).add(this.position);
      const wy = waterHeightAt(lp.x, lp.z, time);
      if (Math.abs(lp.y - wy) < P.freeboard) {
        p.spawn(lp.x, wy + 0.15, lp.z,
          (Math.random() - 0.5) * 2.5, 0.6 + Math.random() * 1.6, (Math.random() - 0.5) * 2.5,
          0.5 + Math.random() * 0.5, 0.45 + Math.random() * 0.4, 0, 0.6, 10);
      }
    }
    // 2) пузыри воздуха: из пушечных портов и люков — рвутся вверх
    if (subFrac > 0.1) {
      const nBub = this.sinkPhase === 3 ? 3 : 1;
      for (let i = 0; i < nBub; i++) {
        const zz = (Math.random() - 0.5) * P.length * 0.7;
        const side = Math.random() < 0.5 ? -1 : 1;
        const lp = this.tmpV.set(side * P.beam * 0.42, P.freeboard * 0.5, zz)
          .applyQuaternion(this.quaternion).add(this.position);
        const wy = waterHeightAt(lp.x, lp.z, time);
        if (lp.y < wy - 0.4) {
          // время жизни = дойти до поверхности при всплытии ~1.6 м/с
          const life = clamp((wy - lp.y) / 1.6, 0.25, 2.2);
          p.spawn(lp.x, lp.y, lp.z,
            (Math.random() - 0.5) * 0.5, 1.3 + Math.random() * 0.9, (Math.random() - 0.5) * 0.5,
            life, 0.1 + Math.random() * 0.12, 0, 0.15, -1.5);
        }
      }
    }
    // 3) мощный всплеск-водоворот, когда палуба захлёбывается
    if (this.sinkPhase === 2 && subFrac > 0.3 && Math.random() < 0.5) {
      p.splash(this.position.x, waterHeightAt(this.position.x, this.position.z, time), this.position.z, 1.4);
    }
  }

  /** Действие команды (R): пожар -> течь -> ремонт.
   *  Тушение — БОРЬБА с огнём: интенсивность падает тем быстрее,
   *  чем больше живых людей; наверху огонь всё равно разгорается */
  crewAction(dt: number): string | null {
    if (this.onFire) {
      const crewFrac = clamp(this.crew / Math.max(1, this.preset.maxCrew), 0.05, 1);
      const pump = 0.07 + 0.17 * crewFrac;               // ведёрные цепи
      const grow = 0.008 + 0.022 * this.fireIntensity;   // огонь не ждёт
      this.fireIntensity = clamp(this.fireIntensity - (pump - grow) * dt, 0, 1);
      if (this.fireIntensity <= 0.01) {
        this.onFire = false; this.fireT = 0;
        return 'Пожар потушен!';
      }
      return `Тушение пожара... ${Math.round(this.fireIntensity * 100)}%`;
    }
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
  updateVisual(time: number, dt: number, particles: Particles, negShift?: THREE.Vector3) {
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
    const setTotal = this.sailOverride ?? Math.min(this.sailFrac, spdSetFrac);
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

    // руль за кормой следует за рулём
    if (v.rudderMesh) v.rudderMesh.rotation.y = this.rudder * 0.45;

    // вёсла: УБРАНЫ по умолчанию — вал вдоль борта к корме
    // (кватернион stowQ из buildShip). ГРЕБКА — синхронная модель:
    //   yaw  вокруг вертикали — лопасть МЕТЁТ от носа к корме
    //         (задний ход — зеркально, к носу);
    //   dip   вокруг диаметрали — лопасть ПОГРУЖАЕТСЯ в рабочей
    //         фазе (sin φ > 0) и выходит на переносе.
    // Фаза ОДНА на все вёсла и оба борта — «гребут в ногу»;
    // темп растёт со скоростью хода.
    if (v.oars && v.oars.length) {
      this.oarsDeployT += ((this.oarsOut ? 1 : 0) - this.oarsDeployT) * Math.min(1, dt * 1.5);
      const rowing = this.rowing !== 0 && this.oarsDeployT > 0.25;
      const rowDir = this.rowing < 0 ? -1 : 1;
      if (rowing) {
        const spdFrac = clamp(this.speed() / Math.max(1, this.preset.maxSpeed), 0, 1);
        const rate = 0.55 + spdFrac * 0.5;                 // гребков/с
        this.strokePhase += dt * rate * Math.PI * 2;
      }
      const SWEEP = 0.42;                                  // размах гребка, рад
      const DIP = 0.30;                                    // погружение лопасти, рад
      const DIP0 = 0.14;                                   // статичный наклон к воде
      // знак гребка РАЗВЁРНУТ (замечание игрока): в подводной фазе
      // (sin φ > 0) лопасть теперь метётся К КОРМЕ — как на настоящей
      // галере; раньше выходил «задом наперёд»
      const sweep = rowing ? -Math.cos(this.strokePhase) * SWEEP * rowDir : 0;
      const dip = rowing ? Math.max(0, Math.sin(this.strokePhase)) * DIP : 0;
      for (const o of v.oars) {
        const side = o.userData.side as number;
        const stowQ = o.userData.stowQ as THREE.Quaternion;
        // развёрнутое: гребок (yaw) в осях корабля, затем наклон (dip)
        this._oarYaw.setFromAxisAngle(this._yAxis, side * sweep);
        this._oarDip.setFromAxisAngle(this._zAxis, -side * (DIP0 + dip));
        this._oarQ.copy(this._oarDip).multiply(this._oarYaw);
        o.quaternion.copy(stowQ).slerp(this._oarQ, this.oarsDeployT);
      }
    }

    // пушечные порты: крышка откидывается вверх-наружу (петля вверху),
    // орудие ВЫЕЗЖАЕТ наружу; закрыты — не стреляют (гейт в combat.ts)
    if (v.gunPorts.length) {
      this.portsT += ((this.portsOpen ? 1 : 0) - this.portsT) * Math.min(1, dt * 1.6);
      const lidA = smoothstep(0, 1, this.portsT);
      const slide = clamp((this.portsT - 0.25) / 0.75, 0, 1);
      for (const gp of v.gunPorts) {
        gp.open = this.portsT;
        gp.lid.rotation.z = gp.side * 2.6 * lidA;
        const baseX = gp.gun.userData.baseX as number;
        const slideX = gp.gun.userData.slideX as number;
        gp.gun.position.x = baseX + slideX * slide;
      }
    }

    // магнитная стрелка нактоуза: плывёт в картушке и всегда смотрит
    // на СЕВЕР (мир −Z) — рулевому виден истинный курс; лёгкая
    // дрожь картушки от хода
    if (v.binnacleNeedle) {
      v.binnacleNeedle.rotation.y = -this.heading + Math.PI +
        Math.sin(time * 3.1) * 0.03 + Math.sin(time * 7.7) * 0.015;
    }

    // ЯКОРЯ (отдача/подъём, клавиша F): якорь вываливается за борт
    // по дуге и опускается под воду на цепи; жёлтый буй-кольцо
    // всплывает у цепи и покачивается на волне. Убран — лежит
    // вдоль борта у скулы (просьба игрока: с анимацией отдачи).
    if (v.anchors?.length) {
      const target = this.anchored ? 1 : 0;
      const prev = this.anchorT;
      if (this.anchorT !== target) {
        this.anchorT += Math.sign(target - this.anchorT) * Math.min(Math.abs(target - this.anchorT), dt * 0.4);
        // якоря входят в воду — всплеск под обоими
        if (prev < 0.42 && this.anchorT >= 0.42 && target === 1) {
          for (const A of v.anchors) {
            this.tmpV.copy(A.ctrlPos).lerp(A.dropPos, 0.3)
              .applyQuaternion(this.quaternion).add(this.position);
            this.particles?.splash(this.tmpV.x, this.position.y + 0.1, this.tmpV.z, 1.0);
          }
        }
      }
      const sa = smoothstep(0, 1, this.anchorT);
      const p1 = this.tmpV, p2 = this.tmpV2;
      for (const A of v.anchors) {
        // позиция по квадратичной дуге «вывалился — упал»
        p1.lerpVectors(A.stowPos, A.ctrlPos, sa);
        p2.lerpVectors(A.ctrlPos, A.dropPos, sa);
        A.anchor.position.lerpVectors(p1, p2, sa);
        A.anchor.quaternion.slerpQuaternions(A.stowQuat, A.dropQuat, sa);
        // цепь: клюз -> рым якоря, с провисом наружу
        p1.copy(A.ringOffset).applyQuaternion(A.anchor.quaternion).add(A.anchor.position);
        const pos = A.chain.geometry.getAttribute('position') as THREE.BufferAttribute;
        const n = pos.count;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const sag = Math.sin(Math.PI * u) * (0.12 + sa * 0.5);
          p2.lerpVectors(A.cathead, p1, u);
          pos.setXYZ(i, p2.x + A.side * sag, p2.y - sag * 0.45, p2.z);
        }
        pos.needsUpdate = true;
        // буй: у планширя -> плавает у цепи
        A.buoy.position.lerpVectors(A.buoyStow, A.buoyFloat, sa);
        A.buoy.position.y += Math.sin(time * 1.6 + A.side * 2.1) * 0.045 * sa;
        A.buoy.rotation.z = Math.sin(time * 1.2 + A.side) * 0.14 * sa;
      }
    }

    // падение мачт: валится с нарастающим ускорением (ease-in),
    // заваливаясь за борт; реи и паруса едут вместе с мачтой (они
    // её потомки), обвязка уже оборвана (breakMast → snapRigging).
    // Когда топ мачты достаёт воду — фонтан брызг
    for (let i = 0; i < v.masts.length; i++) {
      const f = this.mastFall[i];
      if (f >= 0 && f < 1) {
        // ускорение падения: 0.30 → 0.62 (мачта «набирает ход»)
        this.mastFall[i] = Math.min(1, f + dt * (0.30 + f * 0.32));
        const k = this.mastFall[i];
        const ke = k * k; // ease-in: поворот отстаёт от прогресса
        const lean = (i % 2 === 0 ? 1 : -1) * 0.52;
        v.masts[i].rotation.x = ke * 1.38;
        v.masts[i].rotation.z = ke * lean;
        v.masts[i].position.y = -ke * 2.1;
        // топ мачты доходит до воды — всплеск
        if (k > 0.62 && !this.mastSplashed[i]) {
          this.mastSplashed[i] = true;
          const h = ((v.masts[i].userData.height as number) || 20);
          this.tmpV.set(0, 0, h * 0.88 * Math.sin(Math.min(ke * 1.38, 1.2)))
            .applyQuaternion(this.quaternion).add(this.position);
          this.particles?.splash(this.tmpV.x, this.position.y + 0.1, this.tmpV.z, 1.25);
        }
      }
    }

    // пенный воротник по ватерлинии: высоту волн добавляет ВЕРШИННЫЙ
    // шейдер (тот же Gerstner, что у океана) — кольцо лежит на гребнях;
    // на CPU остаётся только горизонтальная привязка к кораблю
    if (!this.sunk) {
      this.foam.mesh.position.set(this.position.x, 0.30, this.position.z);
      this.foam.mesh.rotation.y = this.heading;
      const spdFrac = clamp(this.speed() / this.preset.maxSpeed, 0, 1);
      this.foam.update(time, spdFrac, this.euler.z, negShift);
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

    // === Task 34: КОРАБЛЬ ПЛЫВЁТ ПО ВОЛНЕ ===
    // Ватерлиния всегда на поверхности (кинематика вертикали в
    // fixedStep) — нос всходит на гребень и спускается за ним.
    // Гребень ВЫШЕ ПАЛУБЫ (волна слишком большая) → ЗЕЛЁНАЯ ВОДА:
    // вал накрывает палубу, поток рушится с носа и стелется в корму.
    // ССЫЛКА РАСЧЁТА — ПАЛУБА (bulwark − 1.0 по шпангоуту), а НЕ борт/
    // планширь (жалоба игрока: «проверь что расчёты идут от палубы,
    // а не от борта»): вода на палубе = заливание, фальшборт снаружи
    // не в счёт. Замер — у КРОМКИ палубы ОБЕИХ бортов (крен топит
    // кромку — кватернион поворачивает точку честно).
    if (!this.sunk) {
      this.cutT = Math.max(0, this.cutT - dt);
      const f2 = this.forward;
      const perpX = -f2.z, perpZ = f2.x;       // перпендикуляр к ДП (вправо)
      const spd = this.speed();
      const L = this.preset.length;
      // самое глубокое залитие кромки палубы + его точка. СТОЯНКИ:
      // форштевень/нос (0.44/0.32 — вал с носа на попутном встречном
      // волнении) + МИДЕЛЬ (±0.10 — САМАЯ НИЗКАЯ палуба, её заливает
      // первой при крене/лагом к валу: Task 34 — корабль плывёт ПО
      // волне, нос всходит на гребень, и зелёная вода приходит на
      // низкую середину корпуса и с подветренного борта)
      let overMax = -Infinity, overX = 0, overY = 0, overZ = L * 0.32;
      for (const fr of [0.44, 0.32, 0.10, -0.10]) {
        const lz = fr * L;
        const tt = clamp((lz + L / 2) / L, 0, 1);
        const prof = hullProfile(tt, this.preset);
        const deckY = prof.bulwark - 1.0;       // ПАЛУБА (не планширь!)
        const lx = prof.w * 0.85;               // у кромки палубы
        for (const side of [1, -1]) {
          this.tmpV2.set(side * lx, deckY, lz)
            .applyQuaternion(this.quaternion).add(this.position);
          const wy = waterHeightAt(this.tmpV2.x, this.tmpV2.z, time);
          const over = wy - this.tmpV2.y;       // вода над кромкой ПАЛУБЫ
          if (over > overMax) {
            overMax = over; overX = this.tmpV2.x; overY = this.tmpV2.y;
            overZ = this.tmpV2.z;
          }
        }
      }
      const lx0 = this.halfWidthAt(overZ) * 0.85;
      if (overMax > 0.06) {
        // ---- ЗЕЛЁНАЯ ВОДА: волна падает на корабль ----
        this.greenWater++;
        this.greenWaterT = time;
        const amt = Math.min(2.6, 0.8 + overMax * 1.7);
        particles.splash(overX, overY, overZ, amt);
        if (this.cutT <= 0) {
          this.cutT = 0.55;                     // поток: не спамим каждые кадр
          // вал с носа: стена воды рушится на палубу и стелется к корме
          for (let i = 0; i < 14; i++) {
            const side = i % 2 === 0 ? 1 : -1;
            const off = Math.random();
            particles.spawn(
              overX + perpX * side * lx0 * off,
              overY + 0.25 + Math.random() * 0.7,
              overZ + perpZ * side * lx0 * off,
              -perpX * side * (1.2 + Math.random() * 2.4) - f2.x * (2.5 + Math.random() * 3.5),
              -1.2 - Math.random() * 2.2,
              -perpZ * side * (1.2 + Math.random() * 2.4) - f2.z * (2.5 + Math.random() * 3.5),
              1.1 + Math.random() * 0.8, 0.24 + Math.random() * 0.22, 1, 0.9, 6.5);
          }
          // принятая вода чуть гасит ход
          this.velocity.x *= 0.988; this.velocity.z *= 0.988;
        }
        // ---- СМЫВ МАТРОСА: палуба ДЕЙСТВИТЕЛЬНО под водой (> 0.15 м
        // воды над кромкой — настоящая волна по палубе; при плавании
        // ПО волне палуба держится выше воды, заливает только в
        // шторм при крене + большом гребне) — волна уносит человека
        // за борт С НАСТРАИВАЕМОЙ ВЕРОЯТНОСТЬЮ (по умолчанию 30%,
        // настройка «Вероятность смыва»; 0% — никого никогда, 100% —
        // каждое глубокое заливание). Пока палуба над водой — никого
        // не смывает; в спокойную погоду не срабатывает никогда
        if (overMax > 0.15 && time - this.lastWashT > BUOYANCY_CONFIG.washCooldown
          && this.crew > 0 && !this.sinking
          && Math.random() < BUOYANCY_CONFIG.washProbability) {
          this.lastWashT = time;
          const washed = this.crew3d.washAway(1, this.position, this.quaternion);
          if (washed > 0) {
            this.crew = Math.max(0, this.crew - washed);
            this.washedCrew += washed;
          }
        }
      } else if (overMax > -0.45 && spd > 2.2 && this.cutT <= 0) {
        // ---- ЛЁГКИЙ НОСОВОЙ БУРУН (только когда форштевень совсем у
        //      воды — при плавании ПО волне это редкость; никакого
        //      «резания» и обтекания валов на ровном месте) ----
        const plunge = clamp((overMax + 0.45) / 0.45, 0, 1); // 0..1 — насколько нос у воды
        const p2 = 0.25 + spdFrac * 0.5 + plunge * 0.5;
        this.cutT = 0.14;
        for (let i = 0; i < 4; i++) {
          const side = i % 2 === 0 ? 1 : -1;
          // брызги от форштевня: вверх и НАРУЖУ по борту
          particles.spawn(
            overX + perpX * side * lx0 * 0.7,
            overY + Math.max(overMax, -0.5) - 0.1,
            overZ + perpZ * side * lx0 * 0.7,
            perpX * side * (1.6 + Math.random() * 2.2) + f2.x * spd * 0.2,
            1.0 + Math.random() * 2.2 * p2,
            perpZ * side * (1.6 + Math.random() * 2.2) + f2.z * spd * 0.2,
            0.5, 0.3 + Math.random() * 0.3, 0, 0.5, 10);
        }
        particles.splash(overX, overY + Math.max(overMax, -0.5), overZ, 0.3 + p2 * 0.3);
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
      // пробоины ниже ватерлинии: пузыри воздуха + пенная кромка
      for (const h of this.hullHoles) {
        if (!h.belowWL || Math.random() > dt * 1.6) continue;
        const wp = this.tmpV2.set(h.mesh.position.x, h.mesh.position.y, h.mesh.position.z)
          .applyQuaternion(this.quaternion).add(this.position);
        const wy = waterHeightAt(wp.x, wp.z, time);
        if (wp.y < wy - 0.15) {
          // пузырь идёт вверх от дыры и умирает у поверхности
          particles.spawn(wp.x, wp.y, wp.z, 0, 0.8 + Math.random() * 0.7, 0,
            clamp((wy - wp.y) / 1.1, 0.3, 1.6), 0.07 + Math.random() * 0.08, 0, 0.1, -1.2);
          particles.spawn(wp.x, wy, wp.z, (Math.random() - 0.5) * 0.8, 0.5 + Math.random(),
            (Math.random() - 0.5) * 0.8, 0.5, 0.18, 0, 0.5, 9);
        }
      }
    }

    // экипаж: анимация, потери (трупы/разрывы), эвакуация при потоплении;
    // гребным судам передаём фазу гребка — гребцы отклоняются в такт
    this.crew3d.update(dt, time, {
      crew: this.crew, maxCrew: this.preset.maxCrew,
      sinking: this.sinking, sunk: this.sunk,
      position: this.position, quaternion: this.quaternion,
      stroke: {
        phase: this.strokePhase,
        active: (this.rowing !== 0 && this.oarsDeployT > 0.5 && !this.sinking) ? 1 : 0,
        dir: this.rowing < 0 ? -1 : 1,
      },
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
