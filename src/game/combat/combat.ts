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

interface HitInfo {
  mast: number;      // -1 = корпус, иначе индекс мачты
  lp: THREE.Vector3; // точка попадания в СВЯЗНЫХ координатах цели
  dir: THREE.Vector3;// направление полёта в связных координатах цели
}

/** Расстояние от точки (px,pz) до отрезка (ax,az)-(bx,bz) в плоскости XZ */
function distPointSeg2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

export const AMMO_INFO: Record<AmmoType, { name: string; short: string; muzzle: number; dmgHull: number; dmgSail: number; dmgCrew: number; pellets: number; drag: number; fireChance: number }> = {
  ball:  { name: 'Ядро',            short: 'ЯДР',  muzzle: 175, dmgHull: 15, dmgSail: 2,  dmgCrew: 0.6, pellets: 1, drag: 0.02, fireChance: 0.02 },
  chain: { name: 'Книппель',        short: 'КНП',  muzzle: 150, dmgHull: 3,  dmgSail: 24, dmgCrew: 0.4, pellets: 1, drag: 0.05, fireChance: 0 },
  grape: { name: 'Картечь',         short: 'КРТ',  muzzle: 130, dmgHull: 2,  dmgSail: 1,  dmgCrew: 2.2, pellets: 6, drag: 0.35, fireChance: 0 },
  fire:  { name: 'Зажигательное',   short: 'ЗЖГ',  muzzle: 160, dmgHull: 7,  dmgSail: 4,  dmgCrew: 0.5, pellets: 1, drag: 0.03, fireChance: 0.38 },
};

interface Projectile {
  active: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;   // позиция в прошлый кадр — swept-коллизии с мачтами
  vel: THREE.Vector3;
  type: AmmoType;
  shooter: Ship;
  age: number;
  trailT: number;        // накопитель дымного следа (ядро видно в полёте)
  spin: number;          // вращение книппеля вокруг оси полёта, рад
  /** мачты, уже разорванные этим книппелем, по кораблям (сквозной полёт) */
  pierced: Map<Ship, number[]>;
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
  /** книппели: отдельный пул мешей (два полушара на цепи, кувыркаются) */
  private chainMeshes: THREE.Group[] = [];
  private chainGeoCache: THREE.Group | null = null;
  private dummy = new THREE.Object3D();
  private chainDummy = new THREE.Object3D();
  private xAxis = new THREE.Vector3(1, 0, 0);
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

    // пул ядер (заметные тёмные шары — видно в полёте)
    const sph = new THREE.SphereGeometry(0.23, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x17171b, roughness: 0.5, metalness: 0.75 });
    this.projMesh = new THREE.InstancedMesh(sph, mat, 128);
    this.projMesh.frustumCulled = false;
    this.projMesh.count = 0;
    for (let i = 0; i < 128; i++) {
      this.projectiles.push({ active: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), type: 'ball', shooter: player, age: 0, trailT: 0, spin: 0, pierced: new Map() });
    }
    // пул мешей книппелей (строятся лениво в addTo, чтобы шарить геометрию)
    for (let i = 0; i < 24; i++) {
      const g = this.makeChainMesh();
      g.visible = false;
      this.chainMeshes.push(g);
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
    for (const c of this.chainMeshes) parent.add(c);
    parent.add(this.trajLine);
    parent.add(this.impactRing);
    parent.add(this.leadMarker);
  }

  /** Книппель: два полушара ядра на цепи — кувыркается в полёте */
  private makeChainMesh(): THREE.Group {
    if (!this.chainGeoCache) {
      // прототип: ось X — ось полёта, полушария по краям, цепь между ними
      const proto = new THREE.Group();
      const ballMat = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.5, metalness: 0.72 });
      const linkMat = new THREE.MeshStandardMaterial({ color: 0x454b54, roughness: 0.55, metalness: 0.85 });
      const R = 0.34;
      // полусфера (z≥0) + плоская крышка
      const hemi = new THREE.SphereGeometry(R, 12, 8, 0, Math.PI);
      const cap = new THREE.CircleGeometry(R, 12);
      for (const dir of [1, -1] as const) {
        const half = new THREE.Group();
        const dome = new THREE.Mesh(hemi, ballMat);
        dome.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2; // купол наружу по X
        half.add(dome);
        const c = new THREE.Mesh(cap, ballMat);
        c.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2; // крышка к центру
        half.add(c);
        half.position.x = dir * 0.62;
        proto.add(half);
      }
      // цепь: 4 звена-тора перпендикулярно друг другу
      for (let i = 0; i < 4; i++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 5, 12), linkMat);
        link.position.x = -0.23 + i * 0.155;
        link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
        proto.add(link);
      }
      this.chainGeoCache = proto;
    }
    // копируем прототип (меши шарят геометрию/материал)
    const g = new THREE.Group();
    for (const child of this.chainGeoCache.children) g.add(child.clone());
    return g;
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
      pr.prev.copy(this.muzzleWorld);
      pr.type = this.ammo;
      pr.shooter = ship;
      pr.age = 0;
      pr.trailT = 0;
      pr.spin = Math.random() * Math.PI * 2;
      pr.pierced = new Map();
      const spread = this.ammo === 'grape' ? 0.035 : 0.008;
      const dir = this.aimDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      pr.vel.copy(dir).multiplyScalar(info.muzzle * (0.94 + Math.random() * 0.12));
      pr.vel.add(ship.velocity);
    }
    // вспышка выстрела: короткая и компактная (аддитивное свечение)
    this.particles.spawn(this.muzzleWorld.x, this.muzzleWorld.y, this.muzzleWorld.z,
      this.aimDir.x * 7, 1.0, this.aimDir.z * 7, 0.11, 1.15, 2, 2.4, -1.5);
    // пороховой дым: два небольших полупрозрачных клубка у дула,
    // разнесённых по высоте и направлению — не сливаются в одно облако
    for (let s = 0; s < 2; s++) {
      const jx = (Math.random() - 0.5) * 1.1;
      this.particles.smoke(
        this.muzzleWorld.x + this.aimDir.x * (0.3 + s * 0.85) + jx,
        this.muzzleWorld.y + 0.1 + s * 0.3,
        this.muzzleWorld.z + this.aimDir.z * (0.3 + s * 0.85) + jx,
        this.aimDir.x * (1.5 - s * 0.5) + (Math.random() - 0.5) * 1.1 + ship.velocity.x * 0.25,
        0.3 + Math.random() * 0.35,
        this.aimDir.z * (1.5 - s * 0.5) + (Math.random() - 0.5) * 1.1 + ship.velocity.z * 0.25,
        0.95 + Math.random() * 0.3, 0.9 + Math.random() * 0.4);
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
    pr.prev.copy(pr.pos);
    pr.pos.y += 1.2;
    pr.type = 'grape';
    pr.shooter = shooter;
    pr.age = 0;
    pr.trailT = 0;
    pr.pierced = new Map();
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
    const n = 3; // бортовой залп из 3 ядер
    for (let i = 0; i < n; i++) {
      const pr = this.projectiles.find(q => !q.active);
      if (!pr) break;
      pr.active = true;
      pr.pos.copy(shooter.position).addScaledVector(aim, shooter.preset.beam * 0.55);
      pr.prev.copy(pr.pos);
      pr.pos.y += 1.0;
      pr.type = 'ball';
      pr.shooter = shooter;
      pr.age = 0;
      pr.trailT = 0;
      pr.pierced = new Map();
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
    for (let s = 0; s < 2; s++) {
      this.particles.smoke(muzzle.x, muzzle.y, muzzle.z,
        aim.x * 1.6 + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.25,
        aim.z * 1.6 + (Math.random() - 0.5) * 0.6, 1.05 + Math.random() * 0.25, 1.0 + Math.random() * 0.2);
    }
    this.emit(GameEvents.CANNON_FIRED, { pos: muzzle, power: 0.9 });
  }

  // ---------- обновление ----------
  update(dt: number, time: number, waterHeight: (x: number, z: number, t: number) => number,
    groundHeight: ((x: number, z: number) => number) | null = null,
    onGroundHit: ((x: number, y: number, z: number, radius: number) => number) | null = null) {
    // перезарядка
    for (let i = 0; i < this.reloads.length; i++) {
      if (this.reloads[i] > 0) this.reloads[i] -= dt;
    }

    // снаряды
    let count = 0;
    let chainIdx = 0;
    for (const pr of this.projectiles) {
      if (!pr.active) continue;
      pr.age += dt;
      const info = AMMO_INFO[pr.type];
      pr.prev.copy(pr.pos);
      // интеграция с сопротивлением
      const dragF = Math.exp(-info.drag * dt * 3);
      pr.vel.multiplyScalar(dragF);
      pr.vel.y -= 9.81 * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      // книппель кувыркается вокруг оси полёта
      if (pr.type === 'chain') pr.spin += dt * 22;

      // дымный след — ядро видно в полёте (кроме картечи — её дробин много)
      pr.trailT += dt;
      if (pr.trailT > 0.18 && pr.type !== 'grape') {
        pr.trailT = 0;
        this.particles.smoke(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0.08, 0, 0.42, 0.5);
      }

      // вода
      const wy = waterHeight(pr.pos.x, pr.pos.z, time);
      if (pr.pos.y < wy) {
        pr.active = false;
        this.particles.splash(pr.pos.x, wy, pr.pos.z, pr.type === 'ball' ? 1.0 : 0.5);
        this.emit(GameEvents.PROJECTILE_SPLASH, { pos: pr.pos.clone() });
        continue;
      }

      // земля (острова): фугасный удар + повал деревьев
      if (groundHeight && pr.pos.y < groundHeight(pr.pos.x, pr.pos.z)) {
        pr.active = false;
        const r = pr.type === 'ball' || pr.type === 'chain' ? 2.6 : pr.type === 'fire' ? 3.2 : 1.6;
        const trees = onGroundHit ? onGroundHit(pr.pos.x, pr.pos.y, pr.pos.z, r) : 0;
        // пыль/земля + щепа, если деревья сломаны
        this.particles.smoke(pr.pos.x, pr.pos.y + 0.4, pr.pos.z, 0, 0.6, 0, 1.6, 1.2);
        if (trees > 0) this.particles.debris(pr.pos.x, pr.pos.y + 1, pr.pos.z, 10, 1.1);
        this.emit(GameEvents.TERRAIN_HIT, { pos: pr.pos.clone(), trees });
        continue;
      }

      // цели: мачты проверяем ПЕРВЫМИ (рангоут перекрывает корпус),
      // корпус — сегментом от prev до pos (быстрое ядро не «проскакивает»);
      // КНИППЕЛЬ пробивает рангоут насквозь: круг его разлёта ШИРЕ корпуса
      // (3.2 м > полуширины) — летя вдоль борта, сносит ВСЕ мачты коридором
      let hit: HitInfo | null = null;
      let piercedMast = false;
      const targets: Ship[] = pr.shooter === this.player ? this.others : [this.player];
      for (const t of targets) {
        if (t.sunk) continue;
        const done = pr.type === 'chain' ? (pr.pierced.get(t) ?? []) : [];
        hit = this.hitTest(pr, t, done);
        if (hit) {
          this.applyHit(pr, t, info, hit);
          if (pr.type === 'chain' && hit.mast >= 0) {
            // сквозной пролёт: пометить разорванные мачты, летим дальше
            const masts = pr.pierced.get(t) ?? [];
            for (const mi of this.chainMasts) masts.push(mi);
            pr.pierced.set(t, masts);
            piercedMast = true;
          }
          break;
        }
      }
      if (hit && !piercedMast) { pr.active = false; continue; }
      if (!hit && pr.age > 12) { pr.active = false; continue; }

      // визуал
      if (pr.type === 'chain') {
        const mesh = this.chainMeshes[chainIdx];
        if (mesh) {
          mesh.visible = true;
          mesh.position.copy(pr.pos);
          // ось полёта → локальная X, затем кувырок вокруг неё
          const vlen = pr.vel.length();
          if (vlen > 0.01) {
            this.chainDummy.position.copy(pr.pos);
            this._vN.copy(pr.vel).divideScalar(vlen);
            this.chainDummy.quaternion.setFromUnitVectors(this.xAxis, this._vN);
            this.chainDummy.rotateX(pr.spin);
            mesh.quaternion.copy(this.chainDummy.quaternion);
          }
          chainIdx++;
        }
      } else {
        this.dummy.position.copy(pr.pos);
        this.dummy.updateMatrix();
        this.projMesh.setMatrixAt(count, this.dummy.matrix);
        count++;
      }
    }
    this.projMesh.count = count;
    this.projMesh.instanceMatrix.needsUpdate = true;
    for (let i = chainIdx; i < this.chainMeshes.length; i++) this.chainMeshes[i].visible = false;

    // прицеливание: траектория и упреждение
    if (this.aim.active) {
      this.updateAimAssist(time, waterHeight);
    } else {
      this.trajLine.visible = false;
      this.impactRing.visible = false;
      this.leadMarker.visible = false;
    }
  }

  private lprev = new THREE.Vector3();
  private lcur = new THREE.Vector3();
  private invQ = new THREE.Quaternion();
  private hitDir = new THREE.Vector3();
  private pathB = new THREE.Vector3();
  private _vN = new THREE.Vector3();
  /** мачты в круге разлёта книппеля (заполняет hitTest) */
  private chainMasts: number[] = [];

  /** Проверка попадания: мачты (стоячие, swept) → корпус.
   *  Книппель ловит мачты ВЕСЬ СВОЙ КРУГ (радиус 3.2 м — шире корпуса);
   *  skipMasts — уже разорванные этим снарядом (сквозной полёт). */
  private hitTest(pr: Projectile, t: Ship, skipMasts: number[] = []): HitInfo | null {
    this.invQ.copy(t.quaternion).invert();
    this.lprev.subVectors(pr.prev, t.position).applyQuaternion(this.invQ);
    this.lcur.subVectors(pr.pos, t.position).applyQuaternion(this.invQ);
    // направление полёта в связных координатах цели
    this.hitDir.subVectors(this.lcur, this.lprev);
    if (this.hitDir.lengthSq() < 1e-9) this.hitDir.set(0, 0, 1);
    else this.hitDir.normalize();

    // --- мачты: вертикальный цилиндр в XZ, путь ядра — отрезок prev→pos ---
    const masts = t.visual.masts;
    this.chainMasts.length = 0;
    const mastR = pr.type === 'chain' ? 3.2 : 0.8; // книппель бьёт кругом разлёта (шире корпуса!)
    let first = -1;
    for (let i = 0; i < masts.length; i++) {
      if (t.mastFall[i] >= 0 || skipMasts.includes(i)) continue;
      const mz = masts[i].position.z;
      const h = ((masts[i].userData.height as number) || 20) - t.preset.draft * 0.3;
      const d = distPointSeg2D(0, mz, this.lprev.x, this.lprev.z, this.lcur.x, this.lcur.z);
      if (d < mastR && Math.max(this.lprev.y, this.lcur.y) > 0.7
        && Math.min(this.lprev.y, this.lcur.y) < h + 0.4) {
        if (first < 0) first = i;
        if (pr.type === 'chain') this.chainMasts.push(i);
      }
    }
    if (first >= 0) {
      return { mast: first, lp: this.lcur.clone(), dir: this.hitDir.clone() };
    }

    // --- корпус (бокс в связных координатах) ---
    const L = t.preset.length, B = t.preset.beam;
    const c = this.lcur;
    if (Math.abs(c.z) < L * 0.52 && Math.abs(c.x) < B * 0.62
      && c.y > -t.preset.draft * 0.8 && c.y < t.preset.freeboard + L * 0.35) {
      return { mast: -1, lp: c.clone(), dir: this.hitDir.clone() };
    }
    return null;
  }

  private applyHit(pr: Projectile, t: Ship, info: typeof AMMO_INFO[AmmoType], hit: HitInfo) {
    const amount = 0.75 + Math.random() * 0.5;
    const P = this.particles;
    if (hit.mast >= 0) {
      // --- попадание в РАНГОУТ: мачта трещит и ломается ---
      // книппель — специализированный «обрыватель» такелажа: бьёт
      // ВСЕМ КРУГОМ разлёта (ломает несколько мачт за раз),
      // ядро — одну, за 2-3 попадания
      if (pr.type === 'chain') {
        const hitSet = this.chainMasts.length ? this.chainMasts : [hit.mast];
        for (const mi of hitSet) {
          const dmg = mi === hit.mast ? 30 + Math.random() * 12 : 22 + Math.random() * 10;
          const broke = t.damageMast(mi, dmg);
          t.applyDamage({ kind: 'chain', amount: info.dmgSail * amount * (mi === hit.mast ? 1 : 0.7) });
          if (broke) this.emit(GameEvents.MAST_BROKEN, { target: t, mast: mi, pos: pr.pos.clone() });
        }
      } else {
        const dmg = pr.type === 'ball' ? 11 + Math.random() * 8
          : pr.type === 'fire' ? 6 : 1.6;
        const broke = t.damageMast(hit.mast, dmg);
        if (pr.type === 'grape') t.applyDamage({ kind: 'grape', amount: info.dmgCrew * amount });
        if (broke) this.emit(GameEvents.MAST_BROKEN, { target: t, mast: hit.mast, pos: pr.pos.clone() });
      }
      // щепа летит вдоль мачты
      for (let i = 0; i < 9; i++) {
        P.spawn(pr.pos.x, pr.pos.y + i * 0.35, pr.pos.z,
          (Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7,
          0.8, 0.3, 0, 0.6, 10);
      }
      P.smoke(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0.8, 0, 1.0, 1.3);
    } else {
      // --- попадание в КОРПУС: пробоина, у ватерлинии/ниже — течь ---
      // (порог 0.6 м: при качке «у самой воды» дыры также дают течь)
      const belowWL = hit.lp.y < 0.6;
      // --- поражение ЭКИПАЖА вдоль пути снаряда через палубу ---
      // картечь косят палубу (радиус широкий), ядро/зажигательное
      // разрывает тех, кто на линии полёта
      this.pathB.copy(hit.lp).addScaledVector(hit.dir, t.preset.length * 1.25);
      let crewKilled = 0;
      if (pr.type === 'grape') {
        crewKilled = t.crew3d.killNearPath(hit.lp, this.pathB, 'grape', 2, 2.4,
          t.position, t.quaternion);
      } else if (pr.type === 'ball' || pr.type === 'fire') {
        crewKilled = t.crew3d.killNearPath(hit.lp, this.pathB, 'ball', 2, 1.35,
          t.position, t.quaternion);
      }
      if (pr.type === 'grape') {
        // потери команды согласованы с убитыми фигурами
        const per = Math.max(1, t.preset.maxCrew / Math.max(1, t.crew3d.total));
        t.applyDamage({ kind: 'grape', amount: Math.max(0.6, crewKilled * per * 0.9) });
      } else {
        t.applyDamage({
          kind: pr.type === 'fire' && Math.random() < info.fireChance ? 'fire' : pr.type,
          amount: info.dmgHull * amount,
          hitPoint: pr.pos.clone(),
        });
      }
      if (pr.type === 'chain') t.applyDamage({ kind: 'chain', amount: info.dmgSail * amount });
      // декаль пробоины (ядро и зажигательное)
      if (pr.type === 'ball' || pr.type === 'fire') t.addHole(hit.lp, belowWL);
      // щепки и дым
      for (let i = 0; i < 6; i++) {
        P.spawn(pr.pos.x, pr.pos.y, pr.pos.z,
          (Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6,
          0.7, 0.28, 0, 0.6, 10);
      }
      P.smoke(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0.7, 0, 0.95, 1.2);
    }
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
