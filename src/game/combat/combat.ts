import * as THREE from 'three';
import { Ship } from '../ship/Ship';
import type { Particles } from '../fx/particles';
import { clamp } from '../core/rng';
import { GameEvents } from '../core/events';

// ============================================================
// Артиллерия: орудия по бортам, сектора наведения, боеприпасы
// (ядро/книппель/картечь/зажигательное), одиночный огонь и
// залп бортом, баллистическая траектория, упреждение цели.
// ============================================================

export type AmmoType = 'ball' | 'chain' | 'grape' | 'fire';

export const AMMO_INFO: Record<AmmoType, { name: string; short: string; muzzle: number; dmgHull: number; dmgSail: number; dmgCrew: number; pellets: number; drag: number; fireChance: number }> = {
  ball:  { name: 'Ядро',            short: 'ЯДР',  muzzle: 175, dmgHull: 15, dmgSail: 2,  dmgCrew: 0.6, pellets: 1, drag: 0.02, fireChance: 0.02 },
  chain: { name: 'Книппель',        short: 'КНП',  muzzle: 150, dmgHull: 3,  dmgSail: 24, dmgCrew: 0.4, pellets: 1, drag: 0.05, fireChance: 0 },
  grape: { name: 'Картечь',         short: 'КРТ',  muzzle: 130, dmgHull: 2,  dmgSail: 1,  dmgCrew: 2.2, pellets: 6, drag: 0.35, fireChance: 0 },
  fire:  { name: 'Зажигательное',   short: 'ЗЖГ',  muzzle: 160, dmgHull: 7,  dmgSail: 4,  dmgCrew: 0.5, pellets: 1, drag: 0.03, fireChance: 0.38 },
};

interface Projectile {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  type: AmmoType;
  shooter: Ship;
  age: number;
}

export interface AimPublicState {
  active: boolean;
  side: -1 | 1;
  azimuth: number;  // рад от направления борта
  elevation: number;// рад
  range: number;    // м до точки падения
  target: Ship | null;
  targetLead: THREE.Vector3 | null;
}

export class CombatSystem {
  player: Ship;
  others: Ship[] = [];
  particles: Particles;
  emit: (type: string, payload?: unknown) => void;

  aim: AimPublicState = {
    active: false, side: 1, azimuth: 0, elevation: 0.06, range: 0, target: null, targetLead: null,
  };
  ammo: AmmoType = 'ball';

  private projectiles: Projectile[] = [];
  private projMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private trajLine: THREE.Points;
  private impactRing: THREE.Mesh;
  private leadMarker: THREE.Mesh;
  private reloads: number[] = []; // по орудиям обеих бортов
  private muzzleWorld = new THREE.Vector3();
  private aimDir = new THREE.Vector3();

  constructor(player: Ship, particles: Particles, emit: (t: string, p?: unknown) => void) {
    this.player = player;
    this.particles = particles;
    this.emit = emit;
    const nGuns = player.visual.gunsPort.length + player.visual.gunsStarboard.length;
    for (let i = 0; i < nGuns; i++) this.reloads.push(0);

    // пул ядер
    const sph = new THREE.SphereGeometry(0.16, 6, 5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.55, metalness: 0.7 });
    this.projMesh = new THREE.InstancedMesh(sph, mat, 96);
    this.projMesh.frustumCulled = false;
    this.projMesh.count = 0;
    for (let i = 0; i < 96; i++) {
      this.projectiles.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), type: 'ball', shooter: player, age: 0 });
    }

    // траектория: цепочка ярких точек-трассеров
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.trajLine = new THREE.Points(tg, new THREE.PointsMaterial({
      color: 0xffd27a, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0.9,
      depthTest: false,
    }));
    this.trajLine.frustumCulled = false;
    this.trajLine.renderOrder = 20;
    this.trajLine.visible = false;

    // кольцо в точке падения
    this.impactRing = new THREE.Mesh(
      new THREE.RingGeometry(3.0, 4.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false })
    );
    this.impactRing.rotation.x = -Math.PI / 2;
    this.impactRing.renderOrder = 21;
    this.impactRing.visible = false;

    // маркер упреждения
    this.leadMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.6),
      new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.9 })
    );
    this.leadMarker.visible = false;
  }

  addTo(parent: THREE.Object3D) {
    parent.add(this.projMesh);
    parent.add(this.trajLine);
    parent.add(this.impactRing);
    parent.add(this.leadMarker);
  }

  toggleAim(side: -1 | 1): boolean {
    if (this.aim.active && this.aim.side === side) {
      this.aim.active = false;
    } else {
      this.aim.active = true;
      this.aim.side = side;
    }
    this.trajLine.visible = this.aim.active;
    this.emit(GameEvents.AIM_TOGGLED, this.aim.active);
    return this.aim.active;
  }
  /** Мировое направление прицела */
  aimDirection(out: THREE.Vector3): THREE.Vector3 {
    const heading = this.player.heading;
    const side = this.aim.side; // 1 = правый борт (штирборт = мир −X при курсе 0)
    // штирборт: (−cos h, 0, sin h); порт: зеркально
    const baseAz = Math.atan2(-side * Math.cos(heading), side * Math.sin(heading));
    // baseAz: направление правого/левого борта
    const az = baseAz + this.aim.azimuth;
    const cosE = Math.cos(this.aim.elevation);
    out.set(Math.sin(az) * cosE, Math.sin(this.aim.elevation), Math.cos(az) * cosE);
    return out.normalize();
  }

  private gunIndex(side: -1 | 1, i: number): number {
    return side === 1 ? i : this.player.visual.gunsPort.length + i;
  }

  private reloadDuration(): number {
    const crewFrac = clamp(this.player.crew / this.player.preset.maxCrew, 0.25, 1);
    return 7.5 / (0.4 + 0.6 * crewFrac);
  }

  fireOne() {
    if (!this.aim.active) return;
    const guns = this.aim.side === 1 ? this.player.visual.gunsStarboard : this.player.visual.gunsPort;
    for (let i = 0; i < guns.length; i++) {
      const idx = this.gunIndex(this.aim.side, i);
      if (this.reloads[idx] <= 0) {
        this.fireGun(idx, guns[i]);
        return;
      }
    }
    this.emit(GameEvents.MESSAGE, { text: 'Орудия перезаряжаются!' });
  }

  fireBroadside() {
    if (!this.aim.active) return;
    const guns = this.aim.side === 1 ? this.player.visual.gunsStarboard : this.player.visual.gunsPort;
    let fired = 0;
    for (let i = 0; i < guns.length; i++) {
      const idx = this.gunIndex(this.aim.side, i);
      if (this.reloads[idx] <= 0) {
        // лёгкий разброс залпа
        const az0 = this.aim.azimuth, el0 = this.aim.elevation;
        this.aim.azimuth += (Math.random() - 0.5) * 0.06;
        this.fireGun(idx, guns[i], i * 0.05);
        this.aim.azimuth = az0; this.aim.elevation = el0;
        fired++;
      }
    }
    if (!fired) this.emit(GameEvents.MESSAGE, { text: 'Борт перезаряжается!' });
  }

  private fireGun(idx: number, gun: THREE.Object3D, delay = 0) {
    const ship = this.player;
    const info = AMMO_INFO[this.ammo];
    if (ship.ammo[this.ammo] <= 0) {
      this.emit(GameEvents.MESSAGE, { text: `${info.name}: нет боеприпасов!` });
      return;
    }
    ship.ammo[this.ammo]--;
    this.reloads[idx] = this.reloadDuration();
    if (delay > 0) {
      // отложенный выстрел для залпа
      setTimeout(() => this.doFire(gun, info), delay * 1000);
    } else {
      this.doFire(gun, info);
    }
  }

  private doFire(gun: THREE.Object3D, info: typeof AMMO_INFO[AmmoType]) {
    const ship = this.player;
    // позиция дула в МИРОВЫХ координатах (без matrixWorld — floating origin!)
    const sideDir = gun.userData.side > 0 ? 1 : -1;
    this.muzzleWorld.copy(gun.position);
    this.muzzleWorld.x += sideDir * 1.35;
    this.muzzleWorld.y += 0.12;
    this.muzzleWorld.applyQuaternion(ship.quaternion).add(ship.position);
    const h = ship.heading;

    this.aimDirection(this.aimDir);
    // отдача: крен от залпа (борт, из которого стреляем, поднимается)
    ship.angular.z += sideDir * 0.006 * info.muzzle / 175;

    for (let p = 0; p < info.pellets; p++) {
      const pr = this.projectiles.find(q => !q.active);
      if (!pr) break;
      pr.active = true;
      pr.pos.copy(this.muzzleWorld);
      pr.type = this.ammo;
      pr.shooter = ship;
      pr.age = 0;
      const spread = this.ammo === 'grape' ? 0.035 : 0.008;
      const dir = this.aimDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      pr.vel.copy(dir).multiplyScalar(info.muzzle * (0.94 + Math.random() * 0.12));
      pr.vel.add(ship.velocity);
    }
    // вспышка и дым
    this.particles.spawn(this.muzzleWorld.x, this.muzzleWorld.y, this.muzzleWorld.z, 0, 0.5, 0, 0.1, 0.7, 2, 0.8, -4);
    for (let s = 0; s < 7; s++) {
      this.particles.smoke(
        this.muzzleWorld.x + this.aimDir.x * s * 0.8,
        this.muzzleWorld.y + this.aimDir.y * s * 0.8 + 0.2,
        this.muzzleWorld.z + this.aimDir.z * s * 0.8,
        this.aimDir.x * (7 - s) * 1.1 + (Math.random() - 0.5) * 1.5 + ship.velocity.x * 0.5,
        0.8 + Math.random(),
        this.aimDir.z * (7 - s) * 1.1 + (Math.random() - 0.5) * 1.5 + ship.velocity.z * 0.5,
        1.6 + Math.random() * 1.6, 1.8 + Math.random());
    }
    this.emit(GameEvents.CANNON_FIRED, { pos: this.muzzleWorld.clone(), power: info.muzzle / 175 });
  }

  // ---------- ИИ ответный огонь (картечь торговца) ----------
  aiGrapeBurst(shooter: Ship) {
    const dirTo = new THREE.Vector3().subVectors(this.player.position, shooter.position).normalize();
    const pr = this.projectiles.find(q => !q.active);
    if (!pr) return;
    pr.active = true;
    pr.pos.copy(shooter.position).addScaledVector(dirTo, shooter.preset.beam * 0.6);
    pr.pos.y += 1.2;
    pr.type = 'grape';
    pr.shooter = shooter;
    pr.age = 0;
    pr.vel.copy(dirTo).multiplyScalar(110).add(shooter.velocity);
    this.emit(GameEvents.CANNON_FIRED, { pos: pr.pos.clone(), power: 0.6 });
  }

  /** Залп ИИ ядрами по игроку (с упреждением и разбросом) */
  aiBallVolley(shooter: Ship, target: Ship) {
    const to = new THREE.Vector3().subVectors(target.position, shooter.position);
    const dist = to.length();
    if (dist > 400) return;
    to.normalize();
    const flight = dist / 165;
    const aim = target.position.clone().addScaledVector(target.velocity, flight).sub(shooter.position).normalize();
    const guns = aim.x * 0 + 1; // залп всем бортом в сторону цели
    const n = Math.min(3, guns + 1);
    for (let i = 0; i < n; i++) {
      const pr = this.projectiles.find(q => !q.active);
      if (!pr) break;
      pr.active = true;
      pr.pos.copy(shooter.position).addScaledVector(aim, shooter.preset.beam * 0.55);
      pr.pos.y += 1.0;
      pr.type = 'ball';
      pr.shooter = shooter;
      pr.age = 0;
      const dir = aim.clone();
      dir.x += (Math.random() - 0.5) * 0.05;
      dir.y += 0.04 + (Math.random() - 0.5) * 0.03;
      dir.z += (Math.random() - 0.5) * 0.05;
      dir.normalize();
      pr.vel.copy(dir).multiplyScalar(170).add(shooter.velocity);
    }
    // дым и звук
    const muzzle = shooter.position.clone().addScaledVector(aim, shooter.preset.beam * 0.7);
    muzzle.y += 1.2;
    for (let s = 0; s < 5; s++) {
      this.particles.smoke(muzzle.x, muzzle.y, muzzle.z,
        aim.x * 3 + (Math.random() - 0.5), 1, aim.z * 3 + (Math.random() - 0.5), 1.8, 2);
    }
    this.emit(GameEvents.CANNON_FIRED, { pos: muzzle, power: 0.9 });
  }

  // ---------- обновление ----------
  update(dt: number, time: number, waterHeight: (x: number, z: number, t: number) => number) {
    // перезарядка
    for (let i = 0; i < this.reloads.length; i++) {
      if (this.reloads[i] > 0) this.reloads[i] -= dt;
    }

    // снаряды
    let count = 0;
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      pr.age += dt;
      const info = AMMO_INFO[pr.type];
      // интеграция с сопротивлением
      const dragF = Math.exp(-info.drag * dt * 3);
      pr.vel.multiplyScalar(dragF);
      pr.vel.y -= 9.81 * dt;
      pr.pos.addScaledVector(pr.vel, dt);

      // вода
      const wy = waterHeight(pr.pos.x, pr.pos.z, time);
      if (pr.pos.y < wy) {
        pr.active = false;
        this.particles.splash(pr.pos.x, wy, pr.pos.z, pr.type === 'ball' ? 1.0 : 0.5);
        this.emit(GameEvents.PROJECTILE_SPLASH, { pos: pr.pos.clone() });
        continue;
      }
      // цели
      let hit = false;
      const targets: Ship[] = pr.shooter === this.player ? this.others : [this.player];
      for (const t of targets) {
        if (t.sunk) continue;
        if (this.hitsShip(pr, t)) {
          this.applyHit(pr, t, info);
          hit = true;
          break;
        }
      }
      if (hit || pr.age > 12) { pr.active = false; continue; }

      // визуал
      this.dummy.position.copy(pr.pos);
      this.dummy.updateMatrix();
      this.projMesh.setMatrixAt(count, this.dummy.matrix);
      count++;
    }
    this.projMesh.count = count;
    this.projMesh.instanceMatrix.needsUpdate = true;

    // прицеливание: траектория и упреждение
    if (this.aim.active) {
      this.updateAimAssist(time, waterHeight);
    } else {
      this.trajLine.visible = false;
      this.impactRing.visible = false;
      this.leadMarker.visible = false;
    }
  }

  private hitsShip(pr: Projectile, t: Ship): boolean {
    // переход в связные координаты цели
    const inv = new THREE.Quaternion().copy(t.quaternion).invert();
    const lp = new THREE.Vector3().subVectors(pr.pos, t.position).applyQuaternion(inv);
    const L = t.preset.length, B = t.preset.beam;
    return Math.abs(lp.z) < L * 0.52 && Math.abs(lp.x) < B * 0.62 && lp.y > -t.preset.draft * 0.8 && lp.y < t.preset.freeboard + t.preset.length * 0.35;
  }

  private applyHit(pr: Projectile, t: Ship, info: typeof AMMO_INFO[AmmoType]) {
    const amount = 0.75 + Math.random() * 0.5;
    t.applyDamage({
      kind: pr.type === 'fire' && Math.random() < info.fireChance ? 'fire' : pr.type,
      amount: info.dmgHull * amount,
      hitPoint: pr.pos.clone(),
    });
    if (pr.type === 'chain') t.applyDamage({ kind: 'chain', amount: info.dmgSail * amount });
    if (pr.type === 'grape') t.applyDamage({ kind: 'grape', amount: info.dmgCrew * amount * 2 });
    if (pr.type === 'fire') t.applyDamage({ kind: 'fire', amount: info.dmgHull * 0.4 });
    // щепки и дым
    for (let i = 0; i < 5; i++) {
      this.particles.spawn(pr.pos.x, pr.pos.y, pr.pos.z,
        (Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6,
        0.7, 0.28, 0, 0.6, 10);
    }
    this.particles.smoke(pr.pos.x, pr.pos.y, pr.pos.z, 0, 1.2, 0, 1.4, 2.0);
    this.emit(GameEvents.PROJECTILE_HIT, { pos: pr.pos.clone(), target: t });
  }

  private updateAimAssist(time: number, waterHeight: (x: number, z: number, t: number) => number) {
    const ship = this.player;
    const info = AMMO_INFO[this.ammo];
    const start = new THREE.Vector3().copy(ship.position);
    start.y += ship.preset.freeboard * 0.55;
    const vel = this.aimDirection(new THREE.Vector3()).multiplyScalar(info.muzzle).add(ship.velocity);

    // симуляция траектории
    const attr = this.trajLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let px = start.x, py = start.y, pz = start.z;
    let vx = vel.x, vy = vel.y, vz = vel.z;
    const stp = 0.06;
    let range = 0;
    let i = 0;
    for (; i < 48; i++) {
      arr[i * 3] = px; arr[i * 3 + 1] = py; arr[i * 3 + 2] = pz;
      for (let s = 0; s < 4; s++) {
        const d = Math.exp(-info.drag * stp * 3);
        vx *= d; vy *= d; vz *= d;
        vy -= 9.81 * stp;
        px += vx * stp; py += vy * stp; pz += vz * stp;
        range += Math.hypot(vx, vy, vz) * stp;
        if (py < waterHeight(px, pz, time)) break;
      }
      if (py < waterHeight(px, pz, time)) { i++; if (i < 48) { arr[i * 3] = px; arr[i * 3 + 1] = Math.max(py, waterHeight(px, pz, time)); arr[i * 3 + 2] = pz; } break; }
    }
    attr.needsUpdate = true;
    this.trajLine.geometry.setDrawRange(0, Math.max(2, i));
    this.aim.range = range;

    // кольцо в точке падения
    if (i > 0 && py < waterHeight(px, pz, time)) {
      const wy = waterHeight(px, pz, time);
      this.impactRing.position.set(px, wy + 0.3, pz);
      this.impactRing.scale.setScalar(1 + Math.sin(time * 6) * 0.12);
      this.impactRing.visible = true;
    } else {
      this.impactRing.visible = false;
    }

    // упреждение: ближайшая цель в секторе
    const dir = this.aimDirection(new THREE.Vector3());
    this.aim.target = null;
    this.aim.targetLead = null;
    let best: Ship | null = null;
    let bestScore = Infinity;
    const toT = new THREE.Vector3();
    for (const t of this.others) {
      if (t.sunk || t.sinking) continue;
      toT.subVectors(t.position, ship.position);
      const dist = toT.length();
      if (dist > 900) continue;
      toT.normalize();
      const dot = toT.dot(dir);
      if (dot < 0.92) continue; // в пределах ~23° от прицела
      const score = dist * (2 - dot);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best) {
      const dist = best.position.distanceTo(ship.position);
      const flight = dist / info.muzzle;
      const lead = new THREE.Vector3().copy(best.position).addScaledVector(best.velocity, flight);
      lead.y += 1.5;
      this.aim.target = best;
      this.aim.targetLead = lead;
      this.leadMarker.position.copy(lead);
      this.leadMarker.rotation.y = time * 2;
      this.leadMarker.scale.setScalar(1 + Math.sin(time * 5) * 0.15);
      this.leadMarker.visible = true;
    } else {
      this.leadMarker.visible = false;
    }
  }

  /** Готовность орудий (0..1) для HUD */
  readiness(): number {
    let ready = 0;
    for (const r of this.reloads) if (r <= 0) ready++;
    return ready / this.reloads.length;
  }
}
