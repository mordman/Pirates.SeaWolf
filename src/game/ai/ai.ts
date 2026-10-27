import * as THREE from 'three';
import { Ship } from '../ship/Ship';
import { World, heightAt } from '../world/world';
import { CombatSystem } from '../combat/combat';
import { clamp, mod2pi } from '../core/rng';

// ============================================================
// ИИ кораблей:
//  - Торговец: маршрут -> бегство при атаке -> сдача в плен
//  - Военный бриг: патруль; атакует игрока-агрессора
// Состояния: route / flee / surrender / derelict / patrol / combat
// ============================================================

export type AIState = 'route' | 'flee' | 'surrender' | 'derelict' | 'patrol' | 'combat';

export class AIShip {
  ship: Ship;
  state: AIState;
  waypoints: THREE.Vector3[] = [];
  wpIndex = 0;
  private avoidTimer = 0;
  private avoidDir = 0;
  // ответный огонь
  private gunTimer = 6;
  private derelictTimer = 0;
  whiteFlag?: THREE.Mesh;

  constructor(ship: Ship, waypoints: THREE.Vector3[], state: AIState = 'route') {
    this.ship = ship;
    this.waypoints = waypoints;
    this.state = state;
    ship.onSurrender = (s) => this.onSurrender(s);
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
    if (s.sunk || s.sinking) return;

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

    // цель движения
    let target: THREE.Vector3;
    let desiredSail = 2;
    if (this.state === 'route') {
      target = this.waypoints[this.wpIndex];
      if (s.position.distanceTo(target) < 70) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      }
    } else if (this.state === 'flee') {
      // от игрока + по ветру (уходить выгоднее фордевиндом)
      const away = new THREE.Vector3().subVectors(s.position, player.position).setY(0).normalize();
      const downwind = new THREE.Vector3(-Math.cos(s.wind.from), 0, -Math.sin(s.wind.from));
      target = s.position.clone().addScaledVector(away, 400).addScaledVector(downwind, 200);
      desiredSail = 3;
    } else if (this.state === 'patrol') {
      target = this.waypoints[this.wpIndex];
      if (s.position.distanceTo(target) < 60) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      }
    } else if (this.state === 'combat') {
      // держать игрока на траверзе, дистанция 120-260
      const toP = new THREE.Vector3().subVectors(player.position, s.position).setY(0);
      const dist = toP.length();
      toP.normalize();
      const side = new THREE.Vector3(toP.z, 0, -toP.x);
      if (dist > 260) target = player.position.clone().addScaledVector(toP, -120);
      else if (dist < 120) target = s.position.clone().addScaledVector(toP, 200);
      else target = s.position.clone().addScaledVector(side, 300);
      desiredSail = 3;
      // бортовой залп, когда игрок на траверзе
      this.gunTimer -= dt;
      const dotSide = Math.abs(side.dot(s.forward));
      if (this.gunTimer < 0 && dist < 320 && dotSide > 0.75) {
        this.gunTimer = 11 + Math.random() * 5;
        combat.aiBallVolley(s, player);
      }
    } else {
      target = this.waypoints[0];
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

  /** Игрок выстрелил рядом/попал — реакция */
  onPlayerAggression(nearShips: AIShip[]) {
    if (this.state === 'route' && !this.ship.surrendered) {
      this.state = 'flee';
    }
    // военный конвоир реагирует на нападение поблизости
    for (const ai of nearShips) {
      if (ai.state === 'patrol' && ai.ship.position.distanceTo(this.ship.position) < 500) {
        ai.state = 'combat';
      }
    }
  }
}
