import * as THREE from 'three';
import { Ship } from '../ship/Ship';
import { World, heightAt } from '../world/world';
import { CombatSystem } from '../combat/combat';
import { clamp, mod2pi } from '../core/rng';

// ============================================================
// ИИ кораблей:
//  - Торговец: маршрут -> бегство при атаке -> сдача в плен
//  - Военный бриг: патруль; атакует игрока-агрессора
//  - Мишень полигона: стоит на якоре, опционально отвечает огнём
// Состояния: route / flee / surrender / derelict / patrol / combat / anchored
// ============================================================

export type AIState = 'route' | 'flee' | 'surrender' | 'derelict' | 'patrol' | 'combat' | 'anchored';
/** Task 81: боевые тактики ИИ — манера ведения боя выбирается при
 *  входе в бой (по типу судна + случай) и меняет рисунок движения */
export type AITactic = 'circling' | 'artillery' | 'brawler';

export class AIShip {
  /** Task 56: ЭСКАДРА — ведомый следует за этим кораблём (кильватер) */
  leader?: AIShip;
  /** Task 56: корабль редкой эскадры (деспавн за горизонтом) */
  squadron = false;
  ship: Ship;
  state: AIState;
  /** Task 81: текущая тактика боя + борт циркуляции (±1 — раньше
   *  все корабли крутились в одну и ту же сторону) */
  tactic: AITactic = 'circling';
  circleDir = 1;
  /** чем занимался до боя (route/patrol/anchored) — куда вернуться */
  private prevState: AIState | null = null;
  /** Task 81: таймер СЪЁМА С ЯКОРЯ под атакой (0 — не снят) */
  private anchorBreakT = 0;
  /** Task 81: сколько секунд игрок вне угрозы (тонет/далеко) */
  private calmT = 0;
  waypoints: THREE.Vector3[] = [];
  wpIndex = 0;
  private avoidTimer = 0;
  private avoidDir = 0;
  // ответный огонь
  private gunTimer = 6;
  private derelictTimer = 0;
  whiteFlag?: THREE.Mesh;
  /** мишень полигона: отвечать ли огнём (иначе просто стоит на якоре) */
  returnFire = false;
  /** Task 46: мишень полигона — НЕ вступает в бой сама (её режим
   *  задаёт игрок тумблером); пиратская эскадра на якоре — отвечает */
  isProvingTarget = false;
  /** Task 85: АБОРДАЖ — решения ИИ отключены (корабль в сцепке,
   *  позу ведёт модуль Boarding; физика fixedStep продолжается) */
  frozen = false;
  /** Task 85: кулдаун повторного абордажа игрока (после отбоя) */
  boardCd = 0;

  constructor(ship: Ship, waypoints: THREE.Vector3[], state: AIState = 'route') {
    this.ship = ship;
    this.waypoints = waypoints;
    this.state = state;
    ship.onSurrender = (s) => this.onSurrender(s);
    if (state === 'anchored') {
      ship.anchored = true;
      ship.sailTarget = 0;
      ship.noSurrender = true;
    }
  }

  /** Task 87: БЕЗОПАСНАЯ точка маршрута. Маршруты бывают ПУСТЫМИ
   *  (спавн на якоре: галеон-«логово», мишень полигона), а wpIndex
   *  мог быть отравлен NaN («% 0» на пустом массиве). Прямое
   *  waypoints[wpIndex] давало undefined → distanceTo(undefined)
   *  ронял КАЖДЫЙ кадр — и замораживал весь код ПОСЛЕ физики,
   *  включая абордаж (нашёл по зависшей тяге тросов в e2e W) */
  private waypoint(s: Ship): THREE.Vector3 {
    const n = this.waypoints.length;
    if (!n) return s.position;
    const i = Number.isInteger(this.wpIndex) && this.wpIndex >= 0 && this.wpIndex < n
      ? this.wpIndex : 0;
    return this.waypoints[i] ?? s.position;
  }

  /** следующая путевая точка (безопасна на пустом маршруте) */
  private nextWaypoint() {
    const n = this.waypoints.length;
    if (n > 0) this.wpIndex = (this.wpIndex + 1) % n;
  }

  onSurrender(s: Ship) {
    this.state = 'surrender';
    s.sailTarget = 0;
    s.rudderTarget = 0;
    // белый флаг над мачтой
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 3, 4),
      new THREE.MeshStandardMaterial({ color: 0x554433 }));
    pole.position.set(0, s.preset.freeboard + s.preset.length * 0.5, 0);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.0),
      new THREE.MeshStandardMaterial({ color: 0xf2f0e6, side: THREE.DoubleSide }));
    flag.position.set(0.85, 1.2, 0);
    pole.add(flag);
    s.visual.group.add(pole);
    this.whiteFlag = flag;
  }

  makeDerelict() {
    this.state = 'derelict';
    this.derelictTimer = 90;
    this.ship.sailTarget = 0;
  }

  update(dt: number, time: number, player: Ship, combat: CombatSystem,
    onMessage: (text: string) => void) {
    const s = this.ship;
    if (s.sunk || s.sinking) { s.crewEngage = false; return; }
    // Task 85: АБОРДАЖ — корабль в сцепке: решения отключены, руль
    // и паруса ведёт модуль Boarding (физика идёт отдельным
    // fixedStep в game.ts). Стрелки продолжают отстреливаться.
    if (this.frozen) {
      if (this.boardCd > 0) this.boardCd -= dt;
      s.crewEngage = this.state === 'combat';
      return;
    }
    if (this.boardCd > 0) this.boardCd -= dt;
    // Task 44: матросы стреляют ТОЛЬКО когда корабль НАПАДАЕТ:
    // военный ИИ в бою / мишень полигона с ответным огнём.
    // Мирные (route/flee/patrol) и сдавшиеся — ружья молчат
    s.crewEngage = this.state === 'combat'
      || (this.state === 'anchored' && this.returnFire);

    // команда тушит пожар ведёрными цепями (медленнее, чем игрок с R:
    // у ИИ нет полного внимания — руление/орудия важнее)
    if (s.onFire) {
      const grow = 0.008 + 0.022 * s.fireIntensity;
      s.fireIntensity = Math.max(0, s.fireIntensity - Math.max(0, 0.05 - grow) * dt);
      if (s.fireIntensity <= 0.01) { s.onFire = false; s.fireT = 0; }
    }

    // уклонение от суши: смотреть вперёд
    this.avoidTimer -= dt;
    const look = new THREE.Vector3().copy(s.position).addScaledVector(s.forward, 90);
    if (heightAt(look.x, look.z) > -1.5) {
      if (this.avoidTimer < 0) {
        this.avoidTimer = 2.5;
        this.avoidDir = this.tangentToLand(s) * -1;
      }
    }

    if (this.state === 'surrender') {
      s.sailTarget = 0;
      s.rudderTarget = 0;
      return;
    }
    if (this.state === 'derelict') {
      this.derelictTimer -= dt;
      if (this.derelictTimer < 0) s.startSinking();
      return;
    }
    if (this.state === 'anchored') {
      // мишень полигона: стоит на якоре, экипаж на палубе;
      // опционально — редкий ответный залп с упреждением
      s.anchored = true;
      s.sailTarget = 0;
      s.rudderTarget = 0;
      // Task 81: СЪЁМ С ЯКОРЯ под огнём — вооружённый корабль (кроме
      // мишени полигона) снимается с якоря через случайную задержку
      // (команда выбирает якорь) и маневрирует по своей тактике:
      // под атакой никто не «стоит столбом»
      if (this.anchorBreakT > 0) {
        this.anchorBreakT -= dt;
        if (this.anchorBreakT <= 0) {
          this.state = 'combat';
          s.anchored = false;
          this.pickTactic();            // Task 81: своя манера боя
          this.gunTimer = 2 + Math.random() * 3;
        }
        if (this.returnFire && !s.sinking && !player.sinking) {
          // пока выбираются — всё же отстреливаются с якоря
          this.gunTimer -= dt;
          const dist = s.position.distanceTo(player.position);
          if (this.gunTimer < 0 && dist < 340) {
            this.gunTimer = 9 + Math.random() * 4;
            combat.aiBallVolley(s, player);
          }
        }
        return;
      }
      if (this.returnFire && !s.sinking && !player.sinking) {
        this.gunTimer -= dt;
        const dist = s.position.distanceTo(player.position);
        if (this.gunTimer < 0 && dist < 340) {
          this.gunTimer = 9 + Math.random() * 4;
          combat.aiBallVolley(s, player);
        }
      }
      return;
    }

    // цель движения
    let target: THREE.Vector3;
    let desiredSail = 2;
    if (this.state === 'route') {
      // Task 56: ЭСКАДРА — ведомые идут КИЛЬВАТЕРОМ за ведущим:
      // цель — точка за кормой впереди идущего; ход регулируется
      // дистанцией (ближе — паруса убрать, дальше — полный)
      const lead = this.leader;
      if (lead && lead !== this && !lead.ship.sunk && !lead.ship.sinking) {
        const gap = (lead.ship.preset.length + s.preset.length) * 0.5 + 55;
        target = lead.ship.position.clone().addScaledVector(lead.ship.forward, -gap);
        const d = s.position.distanceTo(target);
        // плавное регулирование хода: минимальный ход 1 держит
        // управляемость и станцию (стоп-режим раскачивает колонну);
        // полный стоп — только анти-столкновение
        desiredSail = d > gap * 1.5 ? 3 : d > gap * 0.95 ? 2 : 1;
        if (d < gap * 0.4) desiredSail = 0;
      } else {
        // ведущий погиб — маршрут остаётся своим (штурман не спит)
        // Task 87: БЕЗОПАСНЫЙ путь: маршруты бывают ПУСТЫМИ (спавн на
        // якоре), а wpIndex — отравлен NaN от «% 0»: waypoints[NaN] =
        // undefined → distanceTo(undefined) ронял КАЖДЫЙ кадр и замо-
        // раживал весь код ПОСЛЕ физики (включая абордаж!)
        target = this.waypoint(s);
        if (s.position.distanceTo(target) < 70) {
          this.nextWaypoint();
        }
      }
    } else if (this.state === 'flee') {
      // от игрока + по ветру (уходить выгоднее фордевиндом)
      const away = new THREE.Vector3().subVectors(s.position, player.position).setY(0).normalize();
      const downwind = new THREE.Vector3(-Math.cos(s.wind.from), 0, -Math.sin(s.wind.from));
      target = s.position.clone().addScaledVector(away, 400).addScaledVector(downwind, 200);
      desiredSail = 3;
    } else if (this.state === 'patrol') {
      target = this.waypoint(s);
      if (s.position.distanceTo(target) < 60) {
        this.nextWaypoint();
      }
    } else if (this.state === 'combat') {
      // ==========================================================
      // Task 81: ТАКТИКИ БОЯ — три манеры, выбор при входе в бой:
      //  - circling  — прежняя циркуляция на траверзе (120-260 м),
      //                борт теперь СЛУЧАЕН (раньше все шли в одну сторону)
      //  - artillery — артиллерийская дуэль: держит 200-330 м,
      //                доворачивает бортом и отходит при сближении
      //  - brawler   — таранно-абордажный псих: прёт в упор (<70 м),
      //                картечь/ядра с ближней дистанции
      // Уцелевшие мачты решают, чем это исполнимо: скорость по числу
      // мачт — в Ship.fixedStep (тяга × mastThrust)
      // ==========================================================
      const toP = new THREE.Vector3().subVectors(player.position, s.position).setY(0);
      const dist = toP.length();
      toP.normalize();
      const dir = this.circleDir;
      const side = new THREE.Vector3(toP.z * dir, 0, -toP.x * dir);
      if (this.tactic === 'artillery') {
        if (dist > 330) target = player.position.clone().addScaledVector(toP, -240);
        else if (dist < 200) target = s.position.clone().addScaledVector(toP, 160).addScaledVector(side, 140);
        else target = s.position.clone().addScaledVector(side, 260);
      } else if (this.tactic === 'brawler') {
        target = dist > 70 ? player.position.clone()
          : s.position.clone().addScaledVector(side, 90);
      } else {
        if (dist > 260) target = player.position.clone().addScaledVector(toP, -120);
        else if (dist < 120) target = s.position.clone().addScaledVector(toP, 200);
        else target = s.position.clone().addScaledVector(side, 300);
      }
      desiredSail = 3;
      // бортовой залп, когда игрок на траверзе (у brawler — и в упор)
      this.gunTimer -= dt;
      const dotSide = Math.abs(side.dot(s.forward));
      const fireArc = this.tactic === 'brawler' ? 0.45 : 0.7;
      if (this.gunTimer < 0 && dist < 320 && dotSide > fireArc) {
        this.gunTimer = 9 + Math.random() * 5;
        combat.aiBallVolley(s, player);
      }
      // Task 81: ВЫХОД ИЗ БОЯ — игрок утонул или ушёл (>520 м) и
      // угрозы нет 12+ с: возврат к прежним делам. Иначе корабль
      // воюет вечно — экипаж так и не сходит с боевых постов
      const gone = player.sunk || player.sinking || dist > 520;
      this.calmT = gone ? this.calmT + dt : 0;
      if (this.calmT > 12) {
        this.calmT = 0;
        if (this.prevState === 'anchored') {
          // стали на якорь там, где бой их оставил; посты сданы —
          // экипаж снова ходит по палубе (returnFire=false)
          this.state = 'anchored';
          s.anchored = true;
          this.returnFire = false;
          this.anchorBreakT = 0;
        } else if (this.prevState) {
          this.state = this.prevState;
        } else {
          // Task 87: прежнего состояния НЕТ (в бой вошли напрямую —
          // спавн на якоре/e2e-инъекция): «патруль» без маршрута
          // невозможен (галеон-«логово» с пустыми waypoints падал
          // КАЖДЫЙ кадр на distanceTo(undefined)) — лечь на якорь
          this.state = 'anchored';
          s.anchored = true;
          this.returnFire = false;
          this.anchorBreakT = 0;
        }
        this.gunTimer = 6;
      }
    } else {
      target = this.waypoint(s);
    }

    // руление к цели. ВНИМАНИЕ: положительный руль = поворот ВПРАВО
    // (штирборт), а err>0 — нужно довернуть ВЛЕВО (курс растёт) → минус
    const toT = new THREE.Vector3().subVectors(target, s.position).setY(0).normalize();
    const desiredHeading = Math.atan2(toT.x, toT.z);
    let err = mod2pi(desiredHeading - s.heading);
    if (this.avoidTimer > 0 && heightAt(look.x, look.z) > -1.5) {
      err = clamp(err + this.avoidDir * 1.1, -1.4, 1.4);
    }
    s.rudderTarget = clamp(-err * 1.8, -1, 1);
    // лавировка: если цель против ветра — идём галсами
    const windRel = Math.abs(mod2pi(Math.atan2(Math.cos(s.wind.from), Math.sin(s.wind.from)) - desiredHeading));
    if (windRel < 0.9) {
      const tack = Math.sin(time * 0.05 + s.position.x) > 0 ? 1 : -1;
      s.rudderTarget = clamp(s.rudderTarget - tack * 0.3, -1, 1);
    }
    s.sailTarget = desiredSail;
    void onMessage;
  }

  private tangentToLand(s: Ship): number {
    const f = s.forward;
    const l = new THREE.Vector3().copy(s.position).addScaledVector(f, 90).addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 60);
    const r = new THREE.Vector3().copy(s.position).addScaledVector(f, 90).addScaledVector(new THREE.Vector3(-f.z, 0, f.x), 60);
    const hl = heightAt(l.x, l.z), hr = heightAt(r.x, r.z);
    return hl > hr ? -1 : 1;
  }

  /** Игрок выстрелил рядом/попал — реакция: вооружённый корабль ОТСТРЕЛИВАЕТСЯ,
   *  безоружный спасается бегством; военный конвоир рядом вступает в бой.
   *  Task 46: РЕГРЕССИЯ «пираты перестали стрелять, когда идёт бой» —
   *  ранний выход для 'anchored' глушил ВСЮ эскадру логова (7 судов на
   *  якоре не отвечали вообще) и пропускал конвойный цикл. Теперь:
   *   - мишень полигона (isProvingTarget) не реагирует — только игрок;
   *   - вооружённый корабль НА ЯКОРЕ остаётся на якоре, но ОТВЕЧАЕТ
   *     ОГНЁМ (returnFire: залпы по готовности + ружья экипажа);
   *   - конвойный цикл (патрули → бой) выполняется всегда. */
  onPlayerAggression(nearShips: AIShip[]) {
    if (this.isProvingTarget) return;          // мишень полигона — без инициативы
    if (this.state === 'surrender' || this.state === 'derelict') return;
    const s = this.ship;
    if (!s.surrendered) {
      const armed = s.preset.gunsPerSide > 0 && s.crew > s.preset.maxCrew * 0.25;
      if (this.state === 'anchored') {
        // пиратская эскадра в бухте: отвечает огнём с якоря — и
        // Task 81: ВЫБИРАЕТ ЯКОРЬ (задержка на «выборку якоря»),
        // чтобы маневрировать по своей тактике; безоружные/лёгкие
        // торговцы вместо боя УХОДЯТ бегством
        if (armed) {
          if (!this.returnFire) {
            this.returnFire = true;
            this.gunTimer = 1.2 + Math.random() * 1.8;   // немедленный ответ
          }
          const heavy = s.preset.gunsPerSide >= 4;
          if (this.prevState === null) this.prevState = 'anchored';
          if (heavy) {
            if (this.anchorBreakT <= 0) this.anchorBreakT = 5 + Math.random() * 7;
          } else {
            // лёгкий торговец: встаёт и бежит
            this.state = 'flee';
            s.anchored = false;
            this.returnFire = false;
          }
        }
      } else if (armed) {
        // есть пушки и экипаж — даём отпор (залп по готовности, но быстро)
        const wasFlee = this.state === 'flee';
        if (this.state !== 'combat') {
          this.prevState = this.state;      // Task 81: куда вернуться после боя
          this.state = 'combat';
          this.pickTactic();
        }
        if (wasFlee || this.gunTimer > 4) this.gunTimer = 1.5 + Math.random() * 2;
      } else if (this.state === 'route' || this.state === 'flee') {
        this.state = 'flee';
      }
    }
    // военный конвоир реагирует на нападение поблизости — цикл
    // больше НЕ пропускается ранним выходом 'anchored'
    for (const ai of nearShips) {
      if (ai === this || ai.isProvingTarget) continue;
      if (ai.state === 'surrender' || ai.state === 'derelict') continue;
      const dist = ai.ship.position.distanceTo(s.position);
      if (dist > 500) continue;
      if (ai.state === 'patrol') {
        ai.prevState = 'patrol';
        ai.state = 'combat';
        ai.pickTactic();
      } else if (ai.state === 'anchored') {
        // сосед по стоянке просыпается: если есть пушки — отвечает
        // и Task 81: тоже выбирает якорь (лёгкие — бегут)
        const a = ai.ship;
        const aArmed = a.preset.gunsPerSide > 0 && a.crew > a.preset.maxCrew * 0.25;
        if (aArmed) {
          if (!ai.returnFire) {
            ai.returnFire = true;
            if (ai.gunTimer > 3.5) ai.gunTimer = 2.5 + Math.random() * 2.5;
          }
          if (ai.prevState === null) ai.prevState = 'anchored';
          if (a.preset.gunsPerSide >= 4) {
            if (ai.anchorBreakT <= 0) ai.anchorBreakT = 5 + Math.random() * 9;
          } else {
            ai.state = 'flee';
            a.anchored = false;
            ai.returnFire = false;
          }
        }
      }
    }
  }

  /** Task 81: выбор тактики боя — по типу судна (военные с тяжёлым
   *  залпом предпочитают дистанцию, лёгкие давят на сближение),
   *  30% — случайная манера для разнообразия; борт циркуляции ±1 */
  private pickTactic() {
    this.circleDir = Math.random() < 0.5 ? 1 : -1;
    const r = Math.random();
    const heavy = this.ship.preset.gunsPerSide >= 4;
    if (r < 0.3) {
      this.tactic = r < 0.1 ? 'artillery' : r < 0.2 ? 'brawler' : 'circling';
    } else if (heavy) {
      this.tactic = r < 0.65 ? 'artillery' : 'brawler';
    } else {
      this.tactic = r < 0.75 ? 'circling' : 'artillery';
    }
  }
}
