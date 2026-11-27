import * as THREE from 'three';
import { waterHeightAt } from '../water/waves';

/**
 * Task 91: РЕЖИМ ЧАЙКИ — «вселение» в птицу над своим кораблём.
 * Камера — за спиной чайки, «как в играх»: мышь вращает камеру,
 * чайка до-доворачивается за её взглядом; WASD — полёт (W/S — темп),
 * колесо — зум. ПОВОДОК: не дальше 100 м от корабля игрока —
 * при удалении чайку ЗАВОРАЧИВАЕТ на корабль (плавный доворот курса
 * к вектору на судно), жёсткий предел 118 м не даёт улететь.
 */
export interface GullDeps {
  worldGroup: THREE.Group;
  camera: THREE.PerspectiveCamera;
  /** корабль игрока (позиция «дом» поводка) */
  ship: { position: THREE.Vector3 };
  msg: (t: string) => void;
}

export class GullMode {
  active = false;
  /** азимут камеры (позиция камеры = pos + (sin,cos)·dist) */
  camYaw = 0;
  camPitch = 0.16;
  private camDist = 5.2;
  private camDistSm = 5.2;
  /** скорость полёта, м/с (круиз 10.5; W/S — 5.5..19) */
  speed = 10.5;
  /** текущий курс чайки (радианы; летит «лицом» за камерой) */
  heading = 0;
  /** фаза взмаха крыльев */
  private phase = 0;
  /** 0..1 — насколько «тянет домой» (поводок) */
  leash = 0;
  private warnCd = 0;
  pos = new THREE.Vector3();
  private group = new THREE.Group();
  private wingL!: THREE.Mesh;
  private wingR!: THREE.Mesh;
  private deps: GullDeps;
  private _v1 = new THREE.Vector3();

  constructor(deps: GullDeps) {
    this.deps = deps;
    this.buildMesh();
  }

  /** простая процедурная чайка (~1.5 м размах): тельце + два крыла,
   *  крылья машут поворотом вокруг оси Z (локально) каждый кадр */
  private buildMesh() {
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ec, side: THREE.DoubleSide });
    const gray = new THREE.MeshLambertMaterial({ color: 0x8a8f96, side: THREE.DoubleSide });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), white);
    body.rotation.x = Math.PI / 2;           // нос в +Z (как корабли)
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6),
      new THREE.MeshLambertMaterial({ color: 0xd8963a }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.01, 0.36);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.18), gray);
    tail.position.set(0, 0.02, -0.28);
    const wingGeo = new THREE.BoxGeometry(0.62, 0.025, 0.24);
    this.wingL = new THREE.Mesh(wingGeo, gray);
    this.wingR = new THREE.Mesh(wingGeo, gray);
    this.wingL.position.set(-0.33, 0.05, 0.02);
    this.wingR.position.set(0.33, 0.05, 0.02);
    const g = this.group;
    g.add(body, beak, tail, this.wingL, this.wingR);
    g.visible = false;
    g.userData.wire = 'ship';
    this.deps.worldGroup.add(g);
  }

  /** вселение: чайка стартует над палубой (20 м) за кормой */
  start() {
    const ship = this.deps.ship;
    this.pos.set(ship.position.x, ship.position.y + 20, ship.position.z);
    // камеру — за кормой корабля (курс чайки = курс судна)
    this.camYaw = Math.atan2(ship.position.x - this.pos.x, ship.position.z - this.pos.z);
    this.camDist = 5.2;
    this.camDistSm = 5.2;
    this.speed = 10.5;
    this.heading = this.camYaw + Math.PI;
    this.leash = 0;
    this.phase = 0;
    this.group.visible = true;
    this.active = true;
    this.deps.msg('🕊 Вы — чайка! WASD — полёт, мышь — курс, B/X — вернуться на корабль');
  }

  end() {
    this.active = false;
    this.group.visible = false;
  }

  handleInput(inp: {
    isDown: (c: string) => boolean; wheel: number;
    mouseDX: number; mouseDY: number;
  }) {
    if (!this.active) return;
    // мышь вращает камеру (та же схема, что у капитана на палубе)
    const sens = 0.0028;
    this.camYaw -= inp.mouseDX * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.mouseDY * sens, -0.55, 1.05);
    // W/S — темп (круиз 10.5, минимум 5.5, максимум 19)
    if (inp.isDown('KeyW')) this.speed += 4.5 * 0.016;
    if (inp.isDown('KeyS')) this.speed -= 4.5 * 0.016;
    this.speed = THREE.MathUtils.clamp(this.speed, 5.5, 19);
    // колесо — зум камеры
    this.camDist = THREE.MathUtils.clamp(this.camDist + inp.wheel * 0.008, 2.4, 11);
  }

  /** дистанция до «дома» (для HUD/телеметрии) */
  distToShip(): number {
    return this.pos.distanceTo(this.deps.ship.position);
  }

  update(dt: number, t: number) {
    if (!this.active) return;
    const ship = this.deps.ship;
    // ---- ПОВОДОК: дальше 100 м — чайку ЗАВОРАЧИВАЕТ на корабль.
    // Плавно: сила натяжения растёт с 75 м; курс доворачивается к
    // вектору на судно, скорость подбавляется. ЖЁСТКИЙ предел —
    // ровно 100 м из заказа («не далее чем 100 метров от корабля»)
    const dHome = this.distToShip();
    this.leash = THREE.MathUtils.clamp((dHome - 75) / 12, 0, 1);
    const wantYaw = this.camYaw + Math.PI;
    let target = wantYaw;
    if (this.leash > 0) {
      this._v1.copy(ship.position).sub(this.pos);
      target = Math.atan2(this._v1.x, this._v1.z);
      // камеру тоже разворачиваем за курсом «домой» — обзор следует
      let dc = target - (this.camYaw + Math.PI);
      dc = Math.atan2(Math.sin(dc), Math.cos(dc));
      this.camYaw += dc * Math.min(1, dt * 1.6 * this.leash);
      this.speed += this.leash * dt * 3;
      this.warnCd -= dt;
      if (this.warnCd <= 0 && this.leash >= 1) {
        this.warnCd = 6;
        this.deps.msg('🕊 Чайку уносит от корабля — разворот домой!');
      }
    }
    // курс чайки доворачивается к цели (за камерой или «домой»)
    let dh = target - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turnRate = 1.4 + this.leash * 1.6;
    this.heading += dh * Math.min(1, dt * turnRate);
    // ---- полёт: горизонт по курсу + набор/снижение по наклону
    //  камеры (смотрим вниз — пикируем, вверх — набираем)
    const dive = -THREE.MathUtils.clamp(this.camPitch, -0.6, 0.6) * 0.9;
    const vy = Math.sin(dive) * this.speed;
    const hk = Math.max(0.35, Math.cos(dive));
    this.pos.x += Math.sin(this.heading) * this.speed * hk * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * hk * dt;
    this.pos.y += vy * dt;
    // жёсткий предел: НЕ ДАЛЬШЕ 100 М (заказ) — даже если кадры
    // редкие (слабый GPU) или игрок телепортировал судно
    if (dHome > 100) {
      this._v1.copy(this.pos).sub(ship.position);
      this._v1.y = 0;
      this._v1.normalize().multiplyScalar(100);
      this.pos.copy(ship.position).add(this._v1);
    }
    // над волнами (не макаться) и не выше 130 м
    const wl = waterHeightAt(this.pos.x, this.pos.z, t) + 1.3;
    if (this.pos.y < wl) { this.pos.y = wl; }
    if (this.pos.y > 130) this.pos.y = 130;
    // ---- визуал: позиция/курс/крен/взмахи
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.heading, 0);
    // крен от скорости доворота
    this.group.rotateZ(THREE.MathUtils.clamp(dh * 2.2, -0.7, 0.7));
    // взмахи: быстрее при наборе, замирают в пикировании (скользит)
    const flapAmp = dive < -0.12 ? 0.25 : 0.55 + Math.min(0.25, Math.abs(dive));
    this.phase += dt * (dive < -0.12 ? 4 : 8.5);
    const w = Math.sin(this.phase) * flapAmp;
    this.wingL.rotation.z = -w - 0.08;
    this.wingR.rotation.z = w + 0.08;
    // ---- камера за спиной чайки (как у капитана)
    const cam = this.deps.camera;
    this.camDistSm += (this.camDist - this.camDistSm) * Math.min(1, dt * 8);
    const d = this.camDistSm;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    let cx = this.pos.x + Math.sin(this.camYaw) * cp * d;
    let cz = this.pos.z + Math.cos(this.camYaw) * cp * d;
    let cy = this.pos.y + 0.5 + sp * d;
    const wl2 = waterHeightAt(cx, cz, t) + 0.8;
    if (cy < wl2) cy = wl2;
    cam.position.set(cx, cy, cz);
    cam.lookAt(
      this.pos.x - Math.sin(this.camYaw) * 8,
      this.pos.y + 0.3,
      this.pos.z - Math.cos(this.camYaw) * 8);
  }

  /** вернуть камеру ригу (после выхода) — rig.snap() зовёт вызывающий */
  dispose() {
    this.group.parent?.remove(this.group);
  }
}
