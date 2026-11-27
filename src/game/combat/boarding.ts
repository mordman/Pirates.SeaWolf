import * as THREE from 'three';
import type { Ship } from '../ship/Ship';
import { hullProfile, quarterFrontZ } from '../ship/buildShip';
import { rollTraits, mulberry32, buildFigure } from '../ship/crew';
import type { CrewFigure } from '../ship/crew';
import { buildDetailedFigure, setDetailPoseMode, animateCrewDetail, professionFor } from '../ship/crewDetailed';
import type { DetailEnv } from '../ship/crewDetailed';
import { waveEnvelope } from '../water/waves';

// ============================================================
// Task 85/87: АБОРДАЖ. По ТЗ игрока (Task 87 — упрощение):
// «не кружить и подплывать — матросы кидают верёвки с крючками,
// подтягивают корабль, потом выкидываются абордажные доски; при
// сильных волнах матрос может упасть с доски при переходе».
//
// Фазы:
//   hooks — КОШКИ НА БОРТ: матросы забрасывают тросы с крюками,
//           корабли стягиваются ТАЛАМИ борт-к-борту (без руления
//           и кружения — позу тяги выбирают тросы);
//   lash  — сцепка: крючья держат, вкидываются МОСТКИ: два
//           бортовых + квартердэк (по частям корабля);
//   fight — абордажная команда перебегает по мосткам и рубится
//           саблями; на сильном волнении переходящего может
//           СМЫТЬ ВОЛНОЙ с мостка (потеря экипажа); экипажи тают,
//           при экипаже ≤ 25% корабль спускает флаг;
//   ending — мостки втягиваются, корабли расходятся.
//
// Игрок может быть КАК атакующим (E у борта враждебного судна),
// так и обороняющимся (brawler-ИИ сам лезет на абордаж).
// ============================================================

export type BoardingPhase = 'hooks' | 'lash' | 'fight' | 'ending' | 'finished';
export type BoardingResult = 'won' | 'lost' | 'repelled' | 'aborted';

export interface BoardingDeps {
  pushMessage(text: string): void;
  audio: { woodHit(): void; saber(): void; bell(): void };
  /** брызги (падение матроса за борт) */
  splash(x: number, y: number, z: number, size: number): void;
  /** контейнер мира (worldGroup) — тросы/мостки в координатах мира */
  sceneRoot: THREE.Group;
  /** завершение: снимает блокировки в game.ts */
  onEnd(result: BoardingResult, boarding: Boarding): void;
}

/** численность абордажной партии, видимой на палубах */
function partySize(s: Ship): number {
  return Math.max(3, Math.min(7, Math.round(s.crew * 0.22)));
}
/** «качество» команды: солдаты > пираты > торговцы; мертвецы злее */
function quality(s: Ship): number {
  let q = s.crewKind === 'navy' ? 1.25 : s.crewKind === 'merchant' ? 0.9 : 1.12;
  if (s.crewUndeadOpt) q *= 1.25;
  return q;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Plank {
  /** локальная точка на планшире АТАКУЮЩЕГО (его система координат) */
  aLocal: THREE.Vector3;
  /** мосток-меш (в sceneRoot, мировая ориентация каждый кадр) */
  mesh: THREE.Group;
  beam: THREE.Mesh;         // основная доска (масштаб по Z = длина)
  cleats: THREE.Mesh[];     // поперечные набивки (не масштабируются)
  dropT: number;            // анимация «вкидывания»: 1 = брошен
  thrown: boolean;
}

/** Task 87: ТРОС С КРЮКОМ (кошка) — держит пару весь абордаж */
interface Rope {
  /** локальный z на планшире атакующего (совпадает с мостками) */
  z: number;
  mesh: THREE.Group;        // трос + крюк (в sceneRoot)
  line: THREE.Mesh;         // цилиндр-трос (масштаб по Z = длина)
  hook: THREE.Mesh;         // крюк на конце обороняющегося
}

interface Fighter {
  fig: CrewFigure;
  home: 'att' | 'def';
  ship: Ship;               // корабль-родитель группы (меняется при переходе)
  plank: number;
  state: 'gather' | 'cross' | 'engage' | 'dead';
  deadT: number;
  phase: number;            // фазовый сдвиг анимаций
  posed: boolean;           // включена боевая поза
  gone: boolean;            // труп убран со сцены
  /** Task 87: смыт волной с мостка (падает в МИР, не на палубу) */
  washed: boolean;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);

export class Boarding {
  phase: BoardingPhase = 'hooks';
  result: BoardingResult | null = null;
  readonly attacker: Ship;   // кто абордирует
  readonly defender: Ship;   // кого абордируют
  private deps: BoardingDeps;
  private rnd = mulberry32((Math.random() * 1e9) | 0);
  private simTime = 0;

  /** сторона сцепа в системе АТАКУЮЩЕГО (x): там крючья и мостки */
  private side = 1;
  /** сцеп: подчинённый корабль = НЕ игрок; его поза жёстко следует
   *  за кораблём игрока (rel в системе мастера) */
  private slave: Ship;
  private master: Ship;
  private relPos = new THREE.Vector3();
  private relQuat = new THREE.Quaternion();

  private planks: Plank[] = [];
  private ropes: Rope[] = [];
  private fighters: Fighter[] = [];
  private group = new THREE.Group();   // тросы + мостки (в sceneRoot)
  private lashT = 0;                   // таймер фазы lash
  private fightT = 0;
  private tick = 0;                    // тик потерь
  private endT = 0;
  private saberCd = 0;
  private created = 0;                 // бюджет фигур на весь абордаж
  private crewA0 = 0;                  // экипажи на старте (телеметрия)
  private crewD0 = 0;
  // Task 87: тяга тал — сколько тянем (pullDur) и откуда (pull0*)
  private pullT = 0;
  private pullDur = 3;                 // с (≈ dist/12, зажато 2.2..6.5)
  private pull0Pos = new THREE.Vector3();
  private pull0Quat = new THREE.Quaternion();
  /** сколько матросов смыто волной с мостков (телеметрия) */
  private washed = 0;
  private washMsgCd = 0;
  // Task 89: капитан на палубе — переходы по мосткам и удары саблей
  private crossCd = 0;                 // кулдаун стыка (анти-пинг-понг)
  private captainKills = 0;            // чужих бойцов срубил капитан

  constructor(attacker: Ship, defender: Ship, deps: BoardingDeps) {
    this.attacker = attacker;
    this.defender = defender;
    this.deps = deps;
    this.master = attacker.isPlayer ? attacker : defender;
    this.slave = this.master === attacker ? defender : attacker;
    this.crewA0 = attacker.crew;
    this.crewD0 = defender.crew;
    deps.sceneRoot.add(this.group);
    // сторона крючьев: где цель относительно атакующего
    this.toLocal(attacker, defender.position, _v1);
    const relDx = _v1.x, relDz = _v1.z;
    this.side = Math.abs(relDx) > 3 ? Math.sign(relDx) : (relDz > 0 ? 1 : -1);
    // тяга: тросы тянут из позы «как застали» в сцеп борт-в-борт
    this.pull0Pos.copy(attacker.position);
    this.pull0Quat.copy(attacker.quaternion);
    const d0 = attacker.position.distanceTo(defender.position);
    this.pullDur = clamp(d0 / 12, 2.2, 6.5);
    // крючья легли на планширь — ход обоих корпусов сбит
    attacker.velocity.multiplyScalar(0.35);
    defender.velocity.multiplyScalar(0.35);
    this.throwRopes();
    deps.pushMessage(attacker.isPlayer
      ? `Кошки на борт «${defender.preset.name}» — тали тянут!`
      : `«${attacker.preset.name}» зацепил нас кошками — тали тянут!`);
  }

  // ---------- геометрия палуб/планширей ----------

  /** верх планширя (точка крепления мостков), ЛОКАЛЬНО */
  private railPoint(s: Ship, z: number, side: number, outward: number, out: THREE.Vector3): THREE.Vector3 {
    const L = s.preset.length;
    const t = clamp((z + L / 2) / L, 0.03, 0.97);
    const prof = hullProfile(t, s.preset);
    const q = s.preset.quarter ?? 0;
    const qF = quarterFrontZ(s.preset);
    const y = prof.bulwark + (q > 0 && z < qF ? q : 0);
    return out.set(side * (prof.w + outward), y, z);
  }

  /** точка палубы под ногами (та же формула, что у экипажа) */
  private deckPoint(s: Ship, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const L = s.preset.length;
    const t = clamp((z + L / 2) / L, 0.03, 0.97);
    const prof = hullProfile(t, s.preset);
    const q = s.preset.quarter ?? 0;
    const qF = quarterFrontZ(s.preset);
    return out.set(x, prof.bulwark - 1.0 + (q > 0 && z < qF ? q : 0), z);
  }

  /** полуширина корпуса на локальном z */
  private halfW(s: Ship, z: number): number {
    const L = s.preset.length;
    const t = clamp((z + L / 2) / L, 0.03, 0.97);
    return hullProfile(t, s.preset).w;
  }

  /** мировая точка локальной p корабля s (p может совпадать с out) */
  private toWorld(s: Ship, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p).applyQuaternion(s.quaternion).add(s.position);
  }

  /** локальные координаты корабля s для мировой точки w */
  private toLocal(s: Ship, w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _q1.copy(s.quaternion).invert();
    return out.copy(w).sub(s.position).applyQuaternion(_q1);
  }

  // ---------- фазы ----------

  update(dt: number, time: number) {
    this.simTime = time;
    // корабль пошёл ко дну — абордаж сорван (приз тонет = потерян)
    if ((this.attacker.sinking || this.attacker.sunk || this.defender.sinking || this.defender.sunk)
      && this.phase !== 'ending' && this.phase !== 'finished') {
      this.finish('aborted', 'Корабль тонет — абордаж сорван!');
      return;
    }
    switch (this.phase) {
      case 'hooks': this.updateHooks(dt); break;
      case 'lash': this.updateLash(dt); break;
      case 'fight': this.updateFight(dt); break;
      case 'ending': this.updateEnding(dt); break;
      case 'finished': break;
    }
  }

  /** расстояние между центрами при сцепе борт-в-борт */
  private centerDist(): number {
    return (this.attacker.preset.beam + this.defender.preset.beam) / 2 + 2.6;
  }

  /** Task 87: КРЮЧЬЯ И ТАЛЫ. Авто-подплывание УДАЛЕНО (жалоба
   *  игрока: «не кружить и подплывать — упростить»): матросы сразу
   *  забрасывают тросы с крюками, и корабли стягиваются тросами в
   *  сцеп борт-в-борт. Поза выставляется напрямую (как выберут
   *  тали), поэтому подводных камней подхода больше нет: ни знака
   *  руля, ни левентика, ни коллизионных сфер третьих судов */
  private updateHooks(dt: number) {
    const att = this.attacker, def = this.defender;
    // цель СПУСТИЛА ФЛАГ ещё на тяге (мушкетеры срезали команду):
    // это победа, приз берётся как обычно
    if (def.surrendered && !def.isPlayer) {
      this.finish('won', `«${def.preset.name}» спускает флаг! Экипаж сложил оружие.`);
      return;
    }
    this.pullT = Math.min(this.pullDur, this.pullT + dt);
    const k = this.pullT / this.pullDur;
    const e = k * k * (3 - 2 * k);            // smoothstep — разгон/торможение тяги
    // место атакующего: со стороны крючьев, курс параллельный цели
    this.toLocal(att, def.position, _v1);
    const relDz = _v1.z;
    const cd = this.centerDist();
    this.toWorld(def, _v2.set(-this.side * cd, 0, clamp(-relDz, -6, 6)), _v3);
    att.position.lerpVectors(this.pull0Pos, _v3, e);
    att.quaternion.slerpQuaternions(this.pull0Quat, def.quaternion, e);
    // тросы под нагрузкой: ход обоих корпусов гасится
    att.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.0));
    def.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.5));
    att.sailTarget = 0;
    def.sailTarget = 0;
    this.updateRopeMeshes();
    if (this.pullT >= this.pullDur) this.beginLash();
  }

  /** вкидываются КОШКИ: тросы с крюками ×3 (по местам будущих мостков) */
  private throwRopes() {
    const A = this.attacker;
    const LA = A.preset.length;
    const qF = quarterFrontZ(A.preset);
    const hasQ = (A.preset.quarter ?? 0) > 0;
    const zs = [
      LA * 0.20,                                   // борт, носовая половина
      LA * 0.04,                                   // борт, мидель (между мачт)
      hasQ ? Math.max(qF - LA * 0.14, -LA * 0.40)  // квартердэк
        : -LA * 0.30,                              // нет надстройки — корма
    ];
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0x6b5537, roughness: 0.95, metalness: 0.02,   // смолёный трос
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x2e2a26, roughness: 0.55, metalness: 0.7,    // кованный крюк
    });
    for (const z of zs) {
      const g = new THREE.Group();
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), ropeMat);
      line.rotation.x = Math.PI / 2;             // ось цилиндра Y → Z (вдоль троса)
      g.add(line);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.1), ironMat);
      g.add(hook);
      this.group.add(g);
      this.ropes.push({ z, mesh: g, line, hook });
    }
    this.deps.audio.woodHit();
  }

  /** тросы: планширь атакующего → планширь обороняющегося; концы
   *  следуют за корпусами каждый кадр (натягиваются при тяге) */
  private updateRopeMeshes() {
    const A = this.attacker, D = this.defender;
    const LD = D.preset.length;
    for (const r of this.ropes) {
      this.railPoint(A, r.z, this.side, 0.15, _v1);
      this.toWorld(A, _v1, _v1);
      this.toLocal(D, _v1, _v2);
      const zD = clamp(_v2.z, -LD * 0.44, LD * 0.44);
      this.railPoint(D, zD, -this.side, 0.15, _v3);
      this.toWorld(D, _v3, _v2);
      r.mesh.position.copy(_v1).add(_v2).multiplyScalar(0.5);
      const len = Math.max(1, _v1.copy(_v2).sub(r.mesh.position).length());
      r.mesh.quaternion.setFromUnitVectors(_Z, _v1.normalize());
      r.line.scale.set(1, len, 1);
      r.hook.position.z = len * 0.5 - 0.12;
    }
  }

  private beginLash() {
    // жёсткая пара: относительная поза подчинённого в системе мастера
    const inv = _q1.copy(this.master.quaternion).invert();
    this.relPos.copy(this.slave.position).sub(this.master.position).applyQuaternion(inv);
    // кватернион сцепа: ТОЛЬКО разница курса (без крена/дифферента)
    const yawM = Math.atan2(_v1.set(0, 0, 1).applyQuaternion(this.master.quaternion).x, _v1.z);
    const yawS = Math.atan2(_v2.set(0, 0, 1).applyQuaternion(this.slave.quaternion).x, _v2.z);
    let dYaw = yawS - yawM;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.relQuat.setFromAxisAngle(_v3.set(0, 1, 0), clamp(dYaw, -0.12, 0.12));
    const cd = this.centerDist();
    this.relPos.x = clamp(this.relPos.x, -cd * 1.15, cd * 1.15);
    this.relPos.z = clamp(this.relPos.z, -8, 8);

    this.phase = 'lash';
    this.lashT = 0;
    this.throwPlanks();
    this.deps.audio.bell();
    this.deps.pushMessage(this.attacker.isPlayer
      ? `Тали выбраны, борта сошлись! Мостки на борт «${this.defender.preset.name}»!`
      : 'Тали выбраны — доски на наш борт, держать палубу!');
  }

  /** вкидываются мостки: борт ×2 + квартердэк (по разным частям корабля) */
  private throwPlanks() {
    const A = this.attacker;
    const LA = A.preset.length;
    const qF = quarterFrontZ(A.preset);
    const hasQ = (A.preset.quarter ?? 0) > 0;
    // бортовые: носовой пояс и мидель; квартердэк — кормовая надстройка
    const zs = [
      LA * 0.20,                                   // борт, носовая половина
      LA * 0.04,                                   // борт, мидель (между мачт)
      hasQ ? Math.max(qF - LA * 0.14, -LA * 0.40)  // квартердэк
        : -LA * 0.30,                              // нет надстройки — корма
    ];
    const wood = new THREE.MeshStandardMaterial({
      color: this.lighten(A.hullTint, 1.25), roughness: 0.86, metalness: 0.02,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: this.lighten(A.hullTint, 0.7), roughness: 0.9, metalness: 0.02,
    });
    for (const z of zs) {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 1), wood);
      g.add(beam);
      const cleats: THREE.Mesh[] = [];
      for (let c = 0; c < 3; c++) {
        const cl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.035, 0.09), dark);
        g.add(cl);
        cleats.push(cl);
      }
      this.group.add(g);
      // Task 88: крепление ЗАГЛУБЛЕНО на корпус (outward −1.15, было
      // +0.28 НАРУЖУ): раньше мосток висел в воздухе в зазоре между
      // корпусами, не касаясь кораблей; теперь ложится ЧЕРЕЗ планшири
      // на палубы — длина выросла с ~3.2 до ~6 м
      this.railPoint(A, z, this.side, -1.15, _v1);
      this.planks.push({ aLocal: _v1.clone(), mesh: g, beam, cleats, dropT: 0, thrown: false });
    }
  }

  private lighten(hex: number, k: number): number {
    const r = clamp(((hex >> 16) & 255) * k, 0, 255) | 0;
    const gg = clamp(((hex >> 8) & 255) * k, 0, 255) | 0;
    const b = clamp((hex & 255) * k, 0, 255) | 0;
    return (r << 16) | (gg << 8) | b;
  }

  private updateLash(dt: number) {
    this.holdLash();
    this.updateRopeMeshes();
    this.lashT += dt;
    // сброс мостков с интервалом
    for (let i = 0; i < this.planks.length; i++) {
      const p = this.planks[i];
      if (!p.thrown && this.lashT > 0.3 + i * 0.3) {
        p.thrown = true;
        this.deps.audio.woodHit();
      }
      if (p.thrown) p.dropT = Math.min(1, p.dropT + dt / 0.35);
    }
    this.updatePlankMeshes();
    if (this.lashT > 1.7 && this.planks.every(p => p.dropT >= 1)) {
      this.phase = 'fight';
      this.spawnParties();
      this.tick = 0.9;   // первый обмен ударами — быстро
    }
  }

  /** жёсткая сцепка: подчинённый следует за мастером волна-в-волну */
  private holdLash() {
    const m = this.master, s = this.slave;
    s.position.copy(m.position)
      .add(_v1.copy(this.relPos).applyQuaternion(m.quaternion));
    s.quaternion.copy(m.quaternion).multiply(this.relQuat);
    s.velocity.copy(m.velocity);
    if (s.angular) s.angular.set(0, 0, 0);
    s.sailTarget = 0;
    s.rudderTarget = 0;
    m.sailTarget = 0;
    m.rudderTarget = 0;
  }

  /** ориентация мостков по фактическим точкам крепления обоих бортов */
  private updatePlankMeshes() {
    const A = this.attacker, D = this.defender;
    const LD = D.preset.length;
    for (const p of this.planks) {
      // начало: планшир атакующего
      this.toWorld(A, p.aLocal, _v1);
      // конец: та же мировая точка на планшире обороняющегося
      // (Task 88: заглублено НА корпус — outward −1.15)
      this.toLocal(D, _v1, _v2);
      const zD = clamp(_v2.z, -LD * 0.44, LD * 0.44);
      this.railPoint(D, zD, -this.side, -1.15, _v3);
      this.toWorld(D, _v3, _v2);
      // анимация сброса: мосток вылетает сверху и «клацает»
      const drop = 1 - Math.pow(1 - p.dropT, 2);
      const yOff = (1 - drop) * 0.75;
      _v1.y += yOff;
      _v2.y += yOff * 0.6;
      // мосток: серединой между точками, осью вдоль направления
      p.mesh.position.copy(_v1).add(_v2).multiplyScalar(0.5);
      const len = _v1.copy(_v2).sub(p.mesh.position).length();
      p.mesh.quaternion.setFromUnitVectors(_Z, _v1.normalize());
      p.beam.scale.set(1, 1, Math.max(0.5, len));
      for (let ci = 0; ci < p.cleats.length; ci++) {
        p.cleats[ci].position.set(0, 0.045, (ci - 1) * len * 0.3);
      }
      p.mesh.visible = p.thrown;
    }
  }

  // ---------- бой ----------

  private spawnParties() {
    const nA = partySize(this.attacker);
    const nD = partySize(this.defender);
    for (let i = 0; i < nA; i++) this.spawnFighter('att', i);
    for (let i = 0; i < nD; i++) this.spawnFighter('def', i);
  }

  private spawnFighter(home: 'att' | 'def', idx: number) {
    // Task 89: бюджет 40 (было 26) + ВОЗВРАТ слота при уборке трупа
    // (animDead): в длинном бою партия защиты выгорала — подкрепле-
    // ния исчерпали бюджет, палуба пустела и рубить становилось
    // некого (капитан не мог участвовать)
    if (this.created >= 40) return;
    const s = home === 'att' ? this.attacker : this.defender;
    const L = s.preset.length;
    const rot = mulberry32((this.rnd() * 1e9) | 0);
    const role: 'watch' | 'gunner' = this.rnd() < 0.5 ? 'watch' : 'gunner';
    const undead = !!s.crewUndeadOpt;
    const traits = rollTraits(rot, role, s.crewKind);
    // Task 90: настройка «простые матросы» (crewDetail='classic')
    // прежде ПРОБИВАЛАСЬ: абордажные партии строились всегда деталь-
    // ными. Теперь вид — по флагу КОРАБЛЯ (crewDetailedOpt, как у
    // экипажа на палубах); классика движется/падает модульной
    // анимацией (позы 'combat' — только у .detail, guard'ы уже есть)
    const fig = s.crewDetailedOpt
      ? buildDetailedFigure(role, traits, (this.rnd() * 1e6) | 0, true, undead,
        professionFor(role, s.crewKind, rot))
      : buildFigure(role, traits, (this.rnd() * 1e6) | 0, true, undead);
    const f: Fighter = {
      fig, home, ship: s, plank: idx % this.planks.length,
      state: 'gather', deadT: 0, phase: this.rnd() * 6.28, posed: false, gone: false,
      washed: false,
    };
    // старт: у мачты/люка (оттуда выходит партия)
    this.deckPoint(s, (this.rnd() - 0.5) * 1.2, L * (0.08 + this.rnd() * 0.1), _v1);
    fig.group.position.copy(_v1);
    fig.group.rotation.y = this.rnd() * 6.28;
    s.visual.group.add(fig.group);
    this.fighters.push(f);
    this.created++;
  }

  /** точка схватки на палубе обороняющегося для мостка i (ЛОКАЛЬНО
   *  относительно обороняющегося): атакующие встают у планширя,
   *  обороняющиеся — глубже, встречая их */
  private contactPoint(i: number, home: 'att' | 'def', out: THREE.Vector3): THREE.Vector3 {
    const D = this.defender;
    const p = this.planks[i];
    this.toLocal(D, this.toWorld(this.attacker, p.aLocal, _v1), _v2);
    const z = clamp(_v2.z, -D.preset.length * 0.4, D.preset.length * 0.4);
    const xIn = -this.side * (this.halfW(D, z) - (home === 'att' ? 1.25 : 2.15));
    return this.deckPoint(D, xIn, z + (home === 'att' ? 0.35 : 1.15), out);
  }

  private updateFight(dt: number) {
    this.holdLash();
    this.updateRopeMeshes();
    this.updatePlankMeshes();
    this.fightT += dt;
    this.crossCd = Math.max(0, this.crossCd - dt);

    // потери: тик раз в ~1.4 с
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 1.15 + this.rnd() * 0.6;
      this.exchangeBlow();
      if (this.checkOutcome()) return;
    }
    // лязг сабель вне тика
    this.saberCd -= dt;
    if (this.saberCd <= 0) {
      this.saberCd = 0.7 + this.rnd() * 2.2;
      if (this.fighters.some(f => f.state === 'engage' && !f.gone)) this.deps.audio.saber();
    }
    // подкрепления из трюма
    this.reinforce();

    // фигуры: сначала «оживление» тела, потом поведение
    const dEnv: DetailEnv = { roll: 0, pitch: 0, wind: 0.7 };
    for (const f of this.fighters) {
      if (f.gone) continue;
      if (f.fig.detail) animateCrewDetail(f.fig.detail, this.simTime + f.phase, dt, dEnv);
      if (f.state === 'dead') this.animDead(f, dt);
      else if (f.state === 'gather') this.animGather(f, dt);
      else if (f.state === 'cross') this.animCross(f, dt);
      else if (f.state === 'engage') this.animEngage(f, dt);
    }

    // затяжной бой без успеха — расходятся
    if (this.fightT > 95) this.finish('repelled', 'Абордаж захлебнулся — отход!');
  }

  /** один обмен ударами. Task 89: СЛАБЕЙШАЯ сторона теряет бойца
   *  КАЖДЫЙ обмен, СИЛЬНЕЙШАЯ — с вероятностью 0.08..0.32 (растёт
   *  с равенством сил): абордаж стоит крови ОБЕИМ командам (жалоба
   *  игрока «должны гибнуть и мои матросы»). Каждый убитый виден
   *  дважды: боец партии в гуще схватки + фигура на своей палубе */
  private exchangeBlow() {
    const rA = (0.55 + this.rnd()) * Math.max(1, this.attacker.crew) * quality(this.attacker);
    const rD = (0.55 + this.rnd()) * Math.max(1, this.defender.crew) * quality(this.defender);
    const strongHome: 'att' | 'def' = rA >= rD ? 'att' : 'def';
    const weakHome = strongHome === 'att' ? 'def' : 'att';
    this.loseSailor(weakHome);
    const ratio = Math.min(rA, rD) / Math.max(rA, rD);
    if (this.rnd() < 0.08 + 0.24 * ratio) this.loseSailor(strongHome);
    this.deps.audio.saber();
  }

  /** Task 89: команда теряет матроса: экипаж −1, гибнет боец
   *  партии (в гуще схватки) И фигура на палубе СВОЕГО корабля */
  private loseSailor(home: 'att' | 'def') {
    const s = home === 'att' ? this.attacker : this.defender;
    if (s.crew <= 0) return;
    s.crew = Math.max(0, s.crew - 1);
    const pool = this.fighters.filter(f => f.home === home && f.state !== 'dead' && !f.gone);
    if (pool.length) {
      const victim = pool[(this.rnd() * pool.length) | 0];
      victim.state = 'dead';
      victim.deadT = 0;
    }
    // видимая гибель на своей палубе (экипаж в целом редеет)
    s.crew3d.smallArmsKill(1, s.position, s.quaternion);
  }

  /** проверка исхода; true — бой окончен */
  private checkOutcome(): boolean {
    const thr = (s: Ship) => Math.max(2, Math.round(s.preset.maxCrew * 0.25));
    const defDown = this.defender.crew <= thr(this.defender);
    const attDown = this.attacker.crew <= thr(this.attacker);
    // ИИ-корабль без команды спускает флаг (форсируем систему сдачи)
    const aiShip = this.attacker.isPlayer ? this.defender : this.attacker;
    const aiDown = (this.attacker.isPlayer && defDown) || (!this.attacker.isPlayer && attDown);
    if (aiDown) {
      if (!aiShip.surrendered && !aiShip.noSurrender) {
        aiShip.surrendered = true;
        aiShip.sailTarget = 0;
        aiShip.onSurrender?.(aiShip);
      }
      this.finish('won', `«${aiShip.preset.name}» спускает флаг! Экипаж сложил оружие.`);
      return true;
    }
    // игрок потерял команду: нас абордировали — плен; мы абордировали — отбой
    const playerDown = (this.attacker.isPlayer && attDown) || (!this.attacker.isPlayer && defDown);
    if (playerDown) {
      if (this.attacker.isPlayer) this.finish('repelled', 'Наша партия смята — отступаем!');
      else this.finish('lost', 'Экипаж перебит — корабль захвачен...');
      return true;
    }
    return false;
  }

  /** подход подкреплений из трюма */
  private reinforce() {
    for (const home of ['att', 'def'] as const) {
      const s = home === 'att' ? this.attacker : this.defender;
      const alive = this.fighters.filter(f => f.home === home && f.state !== 'dead' && !f.gone).length;
      const want = Math.min(partySize(s), Math.max(0, s.crew));
      if (alive < want) this.spawnFighter(home, (this.rnd() * 3) | 0);
    }
  }

  // ---------- анимация фигур ----------

  /** шаг к локальной точке (в системе f.ship); true — пришли */
  private stepToward(f: Fighter, tx: number, tz: number, speed: number, dt: number): boolean {
    const g = f.fig.group;
    const dx = tx - g.position.x, dz = tz - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) return true;
    const step = Math.min(dist, speed * dt);
    g.position.x += (dx / dist) * step;
    g.position.z += (dz / dist) * step;
    g.position.y = this.deckPoint(f.ship, 0, g.position.z, _v1).y;
    g.rotation.y = Math.atan2(dx, dz);
    this.runAnim(f);
    return false;
  }

  /** бег: махи ног/рук (как у экипажа на посты) */
  private runAnim(f: Fighter) {
    const st = this.simTime * 12.5 + f.phase;
    if (f.fig.legL && f.fig.legR) {
      f.fig.legL.rotation.x = Math.sin(st) * 0.75;
      f.fig.legR.rotation.x = -Math.sin(st) * 0.75;
    }
    if (f.fig.armL && f.fig.armR) {
      f.fig.armL.rotation.x = -Math.sin(st) * 0.5;
      f.fig.armR.rotation.x = Math.sin(st) * 0.5;
    }
  }

  private animGather(f: Fighter, dt: number) {
    if (f.home === 'att') {
      // дойти до основания своего мостка (у планширя)
      const z = this.planks[f.plank].aLocal.z;
      const tx = this.side * Math.max(0.8, this.halfW(f.ship, z) - 0.9);
      if (this.stepToward(f, tx, z, 1.9, dt)) f.state = 'cross';
    } else {
      // обороняющийся: занять точку обороны у планширя
      const cp = this.contactPoint(f.plank, 'def', _v1);
      if (this.stepToward(f, cp.x, cp.z, 1.7, dt)) f.state = 'engage';
    }
  }

  private animCross(f: Fighter, dt: number) {
    // Task 87: СИЛЬНОЕ ВЛЕЧЕНИЕ — мосток качает на волне, и пере-
    // ходящего может СМЫТЬ ЗА БОРТ. Порог ≈3.3 м огибающей волн:
    // полигон/штиль ≈1.2 м — никто не падает; 5 м — часто, шторм
    // 6 м — каждый переход рулетка. Упавший = потеря экипажа
    // (утонул): абордаж в свежую погоду дорожает
    const env = waveEnvelope();
    if (env > 3.3 && this.rnd() < (env - 3.3) * 0.18 * dt) {
      this.washOff(f);
      return;
    }
    // перебежка по мостку: путь в системе АТАКУЮЩЕГО (фигура ещё
    // ребёнок его группы) — от внутреннего конца мостка на своей
    // палубе до внутреннего конца на палубе жертвы (Task 88: путь
    // продлён вместе с доской — до заглублённых концов)
    const p = this.planks[f.plank];
    const g = f.fig.group;
    const zA = p.aLocal.z;
    const start = _v1.set(
      this.side * Math.max(0.9, this.halfW(this.attacker, zA) - 1.15),
      p.aLocal.y - 0.06, zA);
    // конец мостка: планширь обороняющегося (в системе атакующего)
    this.toLocal(this.defender, this.toWorld(this.attacker, p.aLocal, _v2), _v3);
    const zD = clamp(_v3.z, -this.defender.preset.length * 0.44, this.defender.preset.length * 0.44);
    this.railPoint(this.defender, zD, -this.side, -1.15, _v2);
    const end = this.toLocal(this.attacker, this.toWorld(this.defender, _v2, _v2), _v2);
    const len = Math.max(1, start.distanceTo(end));
    const t = clamp((g.userData.crossT as number) ?? 0, 0, 1) + (1.8 * dt) / len;
    g.userData.crossT = t;
    g.position.lerpVectors(start, end, Math.min(t, 1));
    g.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
    this.runAnim(f);
    if (t >= 1) {
      // сошёл на палубу противника: фигура переродительна к жертве
      const cp = this.contactPoint(f.plank, 'att', _v3);
      this.defender.visual.group.add(g);
      f.ship = this.defender;
      g.position.copy(cp);
      g.userData.crossT = 0;
      f.state = 'engage';
    }
  }

  /** Task 87: волна качнула мосток — матрос летит за борт. Фигура
   *  снимается с корабля в МИР (падение мимо корпуса), команда
   *  теряет бойца: утонул, как утонул бы в настоящем деле */
  private washOff(f: Fighter) {
    const g = f.fig.group;
    this.toWorld(f.ship, g.position, _v1);
    this.deps.sceneRoot.add(g);
    g.position.copy(_v1);
    g.rotation.set(0, g.rotation.y, 0);
    f.state = 'dead';
    f.washed = true;
    f.deadT = 0;
    const s = f.home === 'att' ? this.attacker : this.defender;
    s.crew = Math.max(0, s.crew - 1);
    this.washed++;
    this.deps.splash(g.position.x, 0.4, g.position.z, 1.1);
    if (this.simTime - this.washMsgCd > 4) {
      this.washMsgCd = this.simTime;
      this.deps.pushMessage('Волна качнула мосток — матроса смыло за борт!');
    }
  }

  private animEngage(f: Fighter, dt: number) {
    const g = f.fig.group;
    // противник: ближайший чужой боец
    let ex = 0, ez = 0, found = false;
    let best = 1e9;
    for (const o of this.fighters) {
      if (o.home === f.home || o.state === 'dead' || o.gone) continue;
      const d = o.fig.group.position.distanceTo(g.position);
      if (d < best) {
        best = d;
        ex = o.fig.group.position.x - g.position.x;
        ez = o.fig.group.position.z - g.position.z;
        found = true;
      }
    }
    if (found) {
      if (!f.posed) {
        f.posed = true;
        if (f.fig.detail) setDetailPoseMode(f.fig.detail, 'combat');
      }
      // семенить к противнику/от него (выпад — отход)
      const yaw = Math.atan2(ex, ez);
      const dist = Math.hypot(ex, ez) || 1;
      const adv = Math.sin(this.simTime * 1.35 + f.phase) * 0.5;
      g.position.x += (ex / dist) * adv * dt;
      g.position.z += (ez / dist) * adv * dt;
      // не падать за борт: держаться в пределах палубы
      const lim = Math.max(0.6, this.halfW(f.ship, g.position.z) - 0.55);
      g.position.x = clamp(g.position.x, -lim, lim);
      g.rotation.y += (yaw - g.rotation.y) * Math.min(1, dt * 6);
    } else if (f.posed) {
      // противник погиб — опустить клинок
      f.posed = false;
      if (f.fig.detail) setDetailPoseMode(f.fig.detail, 'deck');
    }
  }

  private animDead(f: Fighter, dt: number) {
    f.deadT += dt;
    const g = f.fig.group;
    // Task 87: смытый волной с мостка — падает в МИР (мимо палубы),
    // кувыркается и уходит под воду; слот бюджета возвращается
    if (f.washed) {
      g.position.y -= dt * 2.8;
      g.rotation.z += dt * 2.2;
      g.rotation.x += dt * 1.4;
      if (g.position.y < -1.4 || f.deadT > 2.5) {
        this.deps.sceneRoot.remove(g);
        f.gone = true;
        this.created = Math.max(0, this.created - 1); // Task 89: вернуть слот
      }
      return;
    }
    // падение (0.55 с) лицом вперёд; затем труп «уходит под палубу»
    if (f.deadT < 0.55) {
      g.rotation.x = (f.deadT / 0.55) * Math.PI * 0.46;
    } else if (f.deadT > 5) {
      g.position.y -= dt * 0.16;
      if (f.deadT > 7.5) {
        f.ship.visual.group.remove(g);
        f.gone = true;
        this.created = Math.max(0, this.created - 1); // Task 89: вернуть слот
      }
    }
  }

  // ---------- Task 89: капитан в абордаже ----------

  /** СТЫК МОСТКА для капитана: если на корабле s (своём или чужом)
   *  он стоит у планширя рядом с ЛЕЖАЩИМ мостком — вернуть точку
   *  входа на ДРУГУЮ палубу (локальные координаты того корабля).
   *  null — не у мостка / мостки ещё не легли / кулдаун стыка */
  crossPointFor(s: Ship, localX: number, localZ: number): { to: Ship; x: number; z: number } | null {
    if (this.phase !== 'fight' || this.crossCd > 0) return null;
    const fromAtt = s === this.attacker;
    const other = fromAtt ? this.defender : this.attacker;
    for (const p of this.planks) {
      if (p.dropT < 1) continue;
      // z мостка в системе корабля s
      let z = p.aLocal.z;                    // локально атакующего
      if (!fromAtt) {
        this.toLocal(s, this.toWorld(this.attacker, p.aLocal, _v1), _v2);
        z = clamp(_v2.z, -s.preset.length * 0.44, s.preset.length * 0.44);
      }
      if (Math.abs(localZ - z) > 1.4) continue;
      // у планширя на стороне сцепа (вход на мосток)
      const sideS = fromAtt ? this.side : -this.side;
      const railX = sideS * (this.halfW(s, localZ) - 0.15);
      if (Math.abs(localX - railX) > 0.8) continue;
      // точка входа на ДРУГОЙ палубе — у планширя мостка
      if (fromAtt) {
        this.toLocal(other, this.toWorld(this.attacker, p.aLocal, _v1), _v2);
        const zD = clamp(_v2.z, -other.preset.length * 0.44, other.preset.length * 0.44);
        const xIn = -this.side * (this.halfW(other, zD) - 1.15);
        return { to: other, x: xIn, z: zD + 0.35 };
      }
      const zA = p.aLocal.z;
      return { to: other, x: this.side * (this.halfW(other, zA) - 1.15), z: zA - 0.35 };
    }
    return null;
  }

  /** УДАР КАПИТАНА саблей (мировая точка + радиус): гибнут только
   *  ЧУЖИЕ бойцы; каждый убитый обходится противнику в матроса —
   *  капитан реально влияет на исход. Возвращает число убитых */
  playerKill(x: number, z: number, r: number): number {
    if (this.phase !== 'fight') return 0;
    const myHome: 'att' | 'def' = this.attacker.isPlayer ? 'att' : 'def';
    let killed = 0;
    for (const f of this.fighters) {
      if (f.home === myHome || f.state === 'dead' || f.gone) continue;
      const g = f.fig.group;
      g.updateWorldMatrix(true, false);
      g.getWorldPosition(_v1);
      if (Math.hypot(_v1.x - x, _v1.z - z) <= r) {
        f.state = 'dead';
        f.deadT = 0;
        killed++;
      }
    }
    if (killed > 0) {
      const enemy = myHome === 'att' ? this.defender : this.attacker;
      enemy.crew = Math.max(0, enemy.crew - killed);
      this.captainKills += killed;
      this.deps.audio.saber();
    }
    return killed;
  }

  /** e2e/отладка: локальная позиция живого бойца стороны home
   * (для позиционирования капитана перед ударом); null — нет живых */
  debugFighterLocal(home: 'att' | 'def', idx: number): { ship: Ship; x: number; z: number } | null {
    const alive = this.fighters.filter(f => f.home === home && f.state !== 'dead' && !f.gone);
    if (idx < 0 || idx >= alive.length) return null;
    const f = alive[idx];
    return { ship: f.ship, x: f.fig.group.position.x, z: f.fig.group.position.z };
  }

  /** капитан перешёл по мостку — кулдаун стыка (анти-пинг-понг) */
  noteCross() { this.crossCd = 1.5; }

  /** e2e: точка у планширя АТАКУЮЩЕГО у мостка i (вход на мосток:
   *  поставить капитана, чтобы сработал переход) */
  debugRailAt(i: number): { x: number; z: number } | null {
    const p = this.planks[i];
    if (!p) return null;
    const z = p.aLocal.z;
    return { x: this.side * (this.halfW(this.attacker, z) - 0.5), z };
  }

  // ---------- завершение ----------

  private finish(result: BoardingResult, msg: string) {
    this.result = result;
    this.phase = 'ending';
    this.endT = 0;
    this.deps.pushMessage(msg);
    if (result === 'won') this.deps.audio.bell();
  }

  private updateEnding(dt: number) {
    this.holdLash();
    this.updateRopeMeshes();
    this.endT += dt;
    // мостки втягиваются к атакующему
    for (const p of this.planks) {
      p.dropT = Math.max(0, p.dropT - dt * 1.6);
      p.mesh.visible = true;
    }
    this.updatePlankMeshes();
    // фигуры уходят под палубу
    for (const f of this.fighters) {
      if (!f.gone) f.fig.group.position.y -= dt * 0.22;
    }
    if (this.endT > 1.6) {
      this.cleanup();
      this.phase = 'finished';
      this.deps.onEnd(this.result ?? 'aborted', this);
    }
  }

  private cleanup() {
    for (const f of this.fighters) {
      if (f.gone) continue;
      // смытые висят в МИРЕ, остальные — на палубах своих кораблей
      if (f.washed) this.deps.sceneRoot.remove(f.fig.group);
      else f.ship.visual.group.remove(f.fig.group);
    }
    this.fighters = [];
    for (const p of this.planks) {
      this.group.remove(p.mesh);
      p.beam.geometry.dispose();
      for (const c of p.cleats) c.geometry.dispose();
    }
    this.planks = [];
    for (const r of this.ropes) {
      this.group.remove(r.mesh);
      r.line.geometry.dispose();
      r.hook.geometry.dispose();
    }
    this.ropes = [];
    this.deps.sceneRoot.remove(this.group);
    // корабли расходятся: подчинённому толчок от мастера
    const away = _v1.copy(this.slave.position).sub(this.master.position).setY(0).normalize();
    this.slave.position.addScaledVector(away, 2.5);
    this.slave.velocity.copy(away).multiplyScalar(2.2);
    this.slave.sailTarget = 0;
  }

  // ---------- телеметрия (e2e/HUD) ----------

  snapshot() {
    return {
      phase: this.phase,
      result: this.result,
      side: this.side,
      attacker: this.attacker.preset.name,
      defender: this.defender.preset.name,
      attackerIsPlayer: this.attacker.isPlayer,
      crewA: this.attacker.crew, crewD: this.defender.crew,
      crewA0: this.crewA0, crewD0: this.crewD0,
      planks: this.planks.length,
      planksDown: this.planks.filter(p => p.dropT >= 1).length,
      fightersA: this.fighters.filter(f => f.home === 'att' && f.state !== 'dead' && !f.gone).length,
      fightersD: this.fighters.filter(f => f.home === 'def' && f.state !== 'dead' && !f.gone).length,
      // Task 90: сколько бойцов сейчас ДЕТАЛЬНЫЕ (настройка
      // crewDetail: 'classic' → всегда 0)
      detailedFighters: this.fighters.filter(f => f.fig.detail && f.state !== 'dead' && !f.gone).length,
      engaged: this.fighters.filter(f => f.state === 'engage' && !f.gone).length,
      fightT: Math.round(this.fightT * 10) / 10,
      // Task 87: телеметрия ТЯГИ КРЮЧЬЕВ (e2e-полигон): прогресс
      // тяги 0..1, число тросов, волнение (м) и сколько матросов
      // смыто волной с мостков (полигон/штиль: 0 всегда)
      pullP: Math.round((this.pullT / this.pullDur) * 100) / 100,
      ropes: this.ropes.length,
      washed: this.washed,
      sea: Math.round(waveEnvelope() * 10) / 10,
      lashDist: Math.round(this.attacker.position.distanceTo(this.defender.position) * 10) / 10,
      defenderSurrendered: this.defender.surrendered,
      attackerSurrendered: this.attacker.surrendered,
      // Task 89: капитан на палубе — z мостков (локально атакующего,
      // для переходов) и сколько чужих бойцов срубил капитан
      plankZ: this.planks.map(p => Math.round(p.aLocal.z * 10) / 10),
      captainKills: this.captainKills,
    };
  }
}
