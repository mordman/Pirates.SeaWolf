import * as THREE from 'three';
import { clamp } from '../core/rng';

// ============================================================
// Камера: изометрия (по умолчанию) -> вид сзади -> сбоку ->
// свободная орбита (вращение мышью). Зум колесом. Плавные
// переходы, стабилизация от укачивания, тряска при залпе.
// ============================================================

export type CameraMode = 'iso' | 'rear' | 'side' | 'free';
export const CAMERA_ORDER: CameraMode[] = ['iso', 'rear', 'side', 'free'];
export const CAMERA_LABEL: Record<CameraMode, string> = {
  iso: 'Изометрия',
  rear: 'Вид сзади',
  side: 'Вид сбоку',
  free: 'Свободная камера',
};

export interface AimCameraState {
  active: boolean;
  side: -1 | 1;        // -1 порт (левый), 1 штирборт
  dir: THREE.Vector3;  // направление прицела (мировое)
}

export interface CameraContext {
  shipScenePos: THREE.Vector3;
  heading: number;
  roll: number;
  pitch: number;
  speedFrac: number;
  aim: AimCameraState;
  mouseDX: number;
  mouseDY: number;
  wheel: number;
  rmb: boolean;
}

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'iso';
  // параметры по режимам
  private dist: Record<CameraMode, number> = { iso: 95, rear: 42, side: 38, free: 55 };
  private freeAzim = Math.PI * 0.75;
  private freeElev = 0.45;
  private isoAzim = Math.PI * 0.25;

  // сглаживание
  private pos = new THREE.Vector3(0, 60, 120);
  private look = new THREE.Vector3();
  private shake = 0;

  // стабилизация (против укачивания): 1 = полная стабилизация
  stabilization = 0.75;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 12000);
  }

  cycleMode(): CameraMode {
    const i = CAMERA_ORDER.indexOf(this.mode);
    this.mode = CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length];
    return this.mode;
  }

  addShake(v: number) { this.shake = Math.min(1.2, this.shake + v); }

  update(dt: number, ctx: AimCameraState, ship: { scenePos: THREE.Vector3; heading: number; roll: number; pitch: number; speedFrac: number }, input: { mouseDX: number; mouseDY: number; wheel: number; rmb: boolean }) {
    // зум
    const wheel = input.wheel;
    if (ctx.active) {
      this.dist.free = clamp(this.dist.free + wheel * 0.03, 14, 70);
    } else {
      this.dist[this.mode] = clamp(this.dist[this.mode] + wheel * 0.08,
        this.mode === 'iso' ? 35 : 16, this.mode === 'iso' ? 420 : 220);
    }

    // свободная камера — вращение мышью при зажатой ПКМ
    if (this.mode === 'free' && !ctx.active) {
      if (input.rmb) {
        this.freeAzim -= input.mouseDX * 0.005;
        this.freeElev = clamp(this.freeElev + input.mouseDY * 0.004, 0.08, 1.45);
      }
    }

    const t = 1 - Math.exp(-5.0 * dt);
    let target = this._t1;
    let lookTarget = this._t2;

    if (ctx.active) {
      // режим прицеливания: камера за орудиями наводящего борта, ниже к воде
      const side = ctx.side;
      const dir = ctx.dir;
      const d = this.dist.free;
      target.copy(ship.scenePos)
        .addScaledVector(dir, -d * 0.8)
        .addScaledVector(this._sideOf(dir), -side * 4)
        .addScaledVector(this._up, d * 0.24 + 3.5);
      lookTarget.copy(ship.scenePos).addScaledVector(dir, 240);
    } else {
      switch (this.mode) {
        case 'iso': {
          const d = this.dist.iso;
          const az = this.isoAzim;
          const el = 0.62; // ~35°
          target.set(
            ship.scenePos.x + Math.cos(az) * Math.cos(el) * d,
            ship.scenePos.y + Math.sin(el) * d,
            ship.scenePos.z + Math.sin(az) * Math.cos(el) * d
          );
          lookTarget.copy(ship.scenePos).add(this._up2.set(0, -2, 0));
          break;
        }
        case 'rear': {
          const d = this.dist.rear;
          const az = ship.heading + Math.PI; // сзади
          const el = 0.30 + 0.1 * ship.speedFrac;
          target.set(
            ship.scenePos.x + Math.sin(az) * Math.cos(el) * d,
            ship.scenePos.y + Math.sin(el) * d + 3,
            ship.scenePos.z + Math.cos(az) * Math.cos(el) * d
          );
          lookTarget.copy(ship.scenePos).addScaledVector(this._fwd.set(Math.sin(ship.heading), 0, Math.cos(ship.heading)), 22);
          break;
        }
        case 'side': {
          const d = this.dist.side;
          const az = ship.heading + Math.PI / 2; // сбоку (правый борт)
          const el = 0.18;
          target.set(
            ship.scenePos.x + Math.sin(az) * Math.cos(el) * d,
            ship.scenePos.y + Math.sin(el) * d + 2,
            ship.scenePos.z + Math.cos(az) * Math.cos(el) * d
          );
          lookTarget.copy(ship.scenePos);
          break;
        }
        case 'free': {
          const d = this.dist.free;
          target.set(
            ship.scenePos.x + Math.cos(this.freeAzim) * Math.cos(this.freeElev) * d,
            ship.scenePos.y + Math.sin(this.freeElev) * d,
            ship.scenePos.z + Math.sin(this.freeAzim) * Math.cos(this.freeElev) * d
          );
          lookTarget.copy(ship.scenePos);
          break;
        }
      }
    }

    // не нырять под воду
    if (target.y < 3) target.y = 3;

    this.pos.lerp(target, t);
    this.look.lerp(lookTarget, t);

    // тряска (залпы, попадания)
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    const shx = (Math.random() - 0.5) * sh * 2.2;
    const shy = (Math.random() - 0.5) * sh * 2.2;

    this.camera.position.set(this.pos.x + shx, this.pos.y + shy, this.pos.z);
    this.camera.lookAt(this.look.x, this.look.y, this.look.z);
    // лёгкий крен камеры от качки (снижается стабилизацией)
    const stabRoll = ship.roll * (1 - this.stabilization) * 0.6;
    this.camera.rotateZ(stabRoll);
  }

  private _t1 = new THREE.Vector3();
  private _t2 = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private _up2 = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private _sideOf(dir: THREE.Vector3): THREE.Vector3 {
    return this._up2.set(dir.z, 0, -dir.x).normalize();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
