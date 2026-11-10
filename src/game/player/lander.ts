import * as THREE from 'three';
import { buildFigure, rollTraits, mulberry32, type CrewFigure } from '../ship/crew';
import type { Particles } from '../fx/particles';
import { heightAt, type World } from '../world/world';
import type { PlayerAppearance } from '../core/settings';
import { DEFAULT_APPEARANCE } from '../core/settings';
import { appearanceToTraits } from './appearance';

// ============================================================
// ВЫСАДКА НА ОСТРОВ (Task 36): моряк сходит с шлюпки на берег.
// ВИД СЗАДИ (третье лицо): камера за спиной, вращение мышью,
// зум колесом; WASD — движение ОТНОСИТЕЛЬНО КАМЕРЫ (как в
// шутерах), Shift — бег. Персонаж идёт по рельефу (heightAt),
// не заходит глубже полуметра воды, огибает стволы (коллайдеры
// world.collideLand — густые джунгли НЕПРОХОДИМЫ).
// ОРУЖИЕ: 1 — САБЛЯ (рубит кусты и жителей), 2 — ПИСТОЛЕТ
// (ЛКМ выстрел, ПКМ — ПРИЦЕЛ С ВИДОМ ОТ ПРИЦЕЛА: камера к плечу,
// узкий FOV, перекрестие на HUD), X — убрать оружие.
// ============================================================

export type LanderWeapon = 'none' | 'saber' | 'pistol';

export interface LanderAudio {
  shot: () => void;
  saber: () => void;
}

export interface LanderDeps {
  worldGroup: THREE.Group;
  particles: Particles;
  world: World;
  camera: THREE.PerspectiveCamera;
  msg: (t: string) => void;
  audio: LanderAudio;
  folkKill: (x: number, y: number, z: number, r: number, mode: 'grape' | 'ball', dx?: number, dz?: number) => number;
  chop: (x: number, y: number, z: number, r: number) => number;
  /** Task 39: внешность капитана (экран создания персонажа) */
  appearance?: PlayerAppearance;
}

export interface LanderHud {
  active: boolean;
  weapon: LanderWeapon;
  weaponLabel: string;
  aiming: boolean;
  nearBoat: boolean;
  moving: boolean;
  camYaw: number;
}

const WALK = 3.6;
const RUN = 6.4;
const WADE_MUL = 0.45;
const MAX_DEPTH = -0.55;
const SLOPE_MAX = 1.9;
const CAM_DIST = 5.4;
const CAM_AIM_DIST = 1.85;
const AIM_FOV = 40;

export class Lander {
  group = new THREE.Group();
  active = false;
  weapon: LanderWeapon = 'none';
  aiming = false;
  nearBoat = false;

  get pos(): THREE.Vector3 { return this.group.position; }
  yaw = 0;
  camYaw = Math.PI;
  camPitch = 0.34;
  private camDist = CAM_DIST;
  private camDistSm = CAM_DIST;
  private fovSm = 55;

  private fig: CrewFigure | null = null;
  private saberG: THREE.Group | null = null;
  private pistolG: THREE.Group | null = null;
  private walkPhase = 0;
  private moving = false;
  private swingT = -1;
  private shotCd = 0;
  private recoil = 0;
  private stepDustCd = 0;
  /** текущая внешность (для E2E/проб); ставится в buildCharacter */
  appearance!: PlayerAppearance;

  private deps: LanderDeps;
  private shift = new THREE.Vector3();
  private _v = new THREE.Vector3();

  constructor(deps: LanderDeps) {
    this.deps = deps;
    this.buildCharacter();
    this.group.visible = false;
    this.deps.worldGroup.add(this.group);
  }

  private buildCharacter() {
    // Task 39: фигурка капитана — по ВЫБРАННОЙ внешности (экран
    // создания персонажа); по умолчанию — «случайный моряк»
    this.appearance = this.deps.appearance ?? DEFAULT_APPEARANCE;
    const fig = buildFigure('walker', appearanceToTraits(this.appearance), 777);
    this.fig = fig;
    this.group.add(fig.group);
    // --- САБЛЯ ---
    const saber = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.4, metalness: 0.6 });
    const gripM = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.9 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.92, 0.012), steel);
    blade.position.y = 0.56;
    saber.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.01), steel);
    tip.position.set(0.05, 1.06, 0);
    tip.rotation.z = -0.5;
    saber.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.05), brass);
    guard.position.y = 0.1;
    saber.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 6), gripM);
    grip.position.y = -0.02;
    saber.add(grip);
    saber.position.set(0.3, 0.92, 0.16);
    saber.rotation.set(0.2, 0, -0.35);
    saber.visible = false;
    this.saberG = saber;
    this.group.add(saber);
    // --- ПИСТОЛЕТ ---
    const pistol = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.35, metalness: 0.75 });
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.3), wood);
    stock.position.set(0, 0, -0.06);
    stock.rotation.x = 0.28;
    pistol.add(stock);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.34, 8), iron);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.035, 0.16);
    pistol.add(barrel);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.08), iron);
    lock.position.set(0.05, 0.02, 0.02);
    pistol.add(lock);
    pistol.position.set(0.28, 0.98, 0.18);
    pistol.visible = false;
    this.pistolG = pistol;
    this.group.add(pistol);
  }

  /** Сменить внешность капитана (экран создания/настройки) —
   *  фигурка пересобирается на месте, оружие сохраняется */
  setAppearance(a: PlayerAppearance) {
    this.appearance = { ...a };
    if (this.fig) {
      const old = this.fig.group;
      this.group.remove(old);
      old.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    const fig = buildFigure('walker', appearanceToTraits(this.appearance), 777);
    this.fig = fig;
    this.group.add(fig.group);
    this.deps.msg('Внешность капитана обновлена');
  }

  /** Поза фигурки для E2E/телеметрии (попугай/повязка/детали) */
  figureInfo() {
    return {
      parrot: this.fig?.hasParrot ?? false,
      eyePatch: this.appearance.eyePatch,
      headwear: this.appearance.headwear,
      hook: this.appearance.hook,
      pegLeg: this.appearance.pegLeg,
      verts: this.fig?.verts ?? 0,
    };
  }

  /** Высадиться в точке (мир); faceX/faceZ — направление взгляда
   *  (с моря к суше): камера за спиной, видно остров */
  spawn(x: number, z: number, faceX = 0, faceZ = 1) {
    const h = heightAt(x, z);
    this.group.position.set(x, Math.max(h, 0), z);
    this.group.visible = true;
    this.active = true;
    this.weapon = 'none';
    this.aiming = false;
    this.swingT = -1;
    this.shotCd = 0;
    this.saberG!.visible = false;
    this.pistolG!.visible = false;
    this.yaw = Math.atan2(faceX, faceZ);
    this.camYaw = Math.atan2(-faceX, -faceZ);
    this.camPitch = 0.3;
    this.deps.msg('Высадка на берег! WASD — идти, мышь — камера, 1 — сабля, 2 — пистолет, E — в шлюпку');
  }

  despawn() {
    this.active = false;
    this.group.visible = false;
    this.aiming = false;
  }

  hud(): LanderHud {
    return {
      active: this.active, weapon: this.weapon,
      weaponLabel: this.weapon === 'saber' ? 'Сабля' : this.weapon === 'pistol' ? 'Пистолет' : 'Без оружия',
      aiming: this.aiming, nearBoat: this.nearBoat,
      moving: this.moving, camYaw: this.camYaw,
    };
  }

  handleInput(inp: {
    isDown: (c: string) => boolean; pressed: (c: string) => boolean;
    mouseDX: number; mouseDY: number; wheel: number;
    lmbJust: boolean; rmb: boolean;
  }) {
    if (!this.active) return;
    const sens = this.aiming ? 0.0016 : 0.0032;
    this.camYaw -= inp.mouseDX * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.mouseDY * sens, -0.5, 1.15);
    this.camDist = THREE.MathUtils.clamp(this.camDist + inp.wheel * 0.008, 2.6, 12);
    if (inp.pressed('Digit1')) {
      this.weapon = this.weapon === 'saber' ? 'none' : 'saber';
      this.aiming = false;
      this.saberG!.visible = this.weapon === 'saber';
      this.pistolG!.visible = false;
      this.deps.msg(this.weapon === 'saber' ? 'Сабля наголо! ЛКМ — рубить' : 'Сабля в ножны');
    }
    if (inp.pressed('Digit2')) {
      this.weapon = this.weapon === 'pistol' ? 'none' : 'pistol';
      this.aiming = false;
      this.pistolG!.visible = this.weapon === 'pistol';
      this.saberG!.visible = false;
      this.deps.msg(this.weapon === 'pistol' ? 'Пистолет заряжен! ЛКМ — выстрел, ПКМ — прицел' : 'Пистолет за пояс');
    }
    if (inp.pressed('KeyX') && this.weapon !== 'none') {
      this.weapon = 'none';
      this.aiming = false;
      this.saberG!.visible = false;
      this.pistolG!.visible = false;
      this.deps.msg('Оружие убрано');
    }
    if (this.weapon === 'pistol') {
      if (inp.rmb && !this.aiming) this.aiming = true;
      else if (!inp.rmb && this.aiming) this.aiming = false;
    } else this.aiming = false;
    if (inp.lmbJust) {
      if (this.weapon === 'saber' && this.swingT < 0) {
        this.swingT = 0;
        this.deps.audio.saber();
      } else if (this.weapon === 'pistol' && this.shotCd <= 0) {
        this.fire();
      }
    }
  }

  private fire() {
    this.shotCd = 1.15;
    this.recoil = 1;
    this.deps.audio.shot();
    const mp = this._v.set(this.pos.x + Math.sin(this.yaw) * 0.6, this.pos.y + 1.25, this.pos.z + Math.cos(this.yaw) * 0.6);
    this.deps.particles.smoke(mp.x, mp.y, mp.z, 0, 0.4, 0, 0.7, 1.1);
    const cam = this.deps.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = cam.position.clone().sub(this.shift);
    let killed = 0, chopped = 0;
    for (let d = 2; d <= 70; d += 2) {
      const x = origin.x + dir.x * d;
      const y = origin.y + dir.y * d;
      const z = origin.z + dir.z * d;
      const th = heightAt(x, z);
      if (y < th) {
        this.deps.particles.debris(x, th + 0.3, z, 5, 0.7);
        break;
      }
      if (y < 0 && th < -10) break;
      killed += this.deps.folkKill(x, y, z, 1.5, 'grape', dir.x, dir.z);
      chopped += this.deps.chop(x, y, z, 1.0);
      if (killed > 0) break;
    }
    if (killed > 0) this.deps.msg(`Меткий выстрел! Поражено: ${killed}`);
    else if (chopped > 0) this.deps.msg('Ветку срезало пулей');
  }

  update(dt: number, time: number, shift: THREE.Vector3, keysDown: (c: string) => boolean) {
    if (!this.active) return;
    this.shift.copy(shift);
    const p = this.pos;
    let mx = 0, mz = 0;
    if (keysDown('KeyW')) mz += 1;
    if (keysDown('KeyS')) mz -= 1;
    if (keysDown('KeyA')) mx -= 1;
    if (keysDown('KeyD')) mx += 1;
    const running = keysDown('ShiftLeft') || keysDown('ShiftRight');
    this.moving = mx !== 0 || mz !== 0;
    if (this.moving) {
      const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
      const rx = -fz, rz = fx;
      let dx = fx * mz + rx * mx;
      let dz = fz * mz + rz * mx;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const h0 = heightAt(p.x, p.z);
      let spd = (running ? RUN : WALK) * (h0 < 0 ? WADE_MUL : 1) * (this.aiming ? 0.55 : 1);
      let nx = p.x + dx * spd * dt;
      let nz = p.z + dz * spd * dt;
      const hn = heightAt(nx, nz);
      const dist = Math.hypot(nx - p.x, nz - p.z) || 1e-6;
      const blocked = hn < MAX_DEPTH || (hn - h0) / dist > SLOPE_MAX;
      if (blocked) {
        const nx2 = p.x + dx * spd * dt, nz2 = p.z;
        const d2 = Math.max(1e-6, Math.abs(dx * spd * dt));
        if (heightAt(nx2, nz2) >= MAX_DEPTH && (heightAt(nx2, nz2) - h0) / d2 <= SLOPE_MAX) { nx = nx2; nz = nz2; }
        else {
          const nx3 = p.x, nz3 = p.z + dz * spd * dt;
          const d3 = Math.max(1e-6, Math.abs(dz * spd * dt));
          if (heightAt(nx3, nz3) >= MAX_DEPTH && (heightAt(nx3, nz3) - h0) / d3 <= SLOPE_MAX) { nx = nx3; nz = nz3; }
          else { nx = p.x; nz = p.z; }
        }
      }
      p.x = nx; p.z = nz;
      const push = this.deps.world.collideLand(p.x, p.z, 0.42);
      if (push) { p.x += push.dx; p.z += push.dz; }
      const wantYaw = this.aiming
        ? Math.atan2(-Math.sin(this.camYaw), -Math.cos(this.camYaw))
        : Math.atan2(dx, dz);
      let dY = wantYaw - this.yaw;
      dY = Math.atan2(Math.sin(dY), Math.cos(dY));
      this.yaw += dY * Math.min(1, dt * 12);
      this.walkPhase += dt * (running ? 11 : 7.2);
      this.stepDustCd -= dt;
      const hNow = heightAt(p.x, p.z);
      if (this.stepDustCd <= 0 && hNow > 0.3 && hNow < 4) {
        this.stepDustCd = 0.22;
        this.deps.particles.smoke(p.x, hNow + 0.12, p.z, 0, 0.12, 0, 0.32, 0.5);
      }
    } else {
      this.walkPhase += dt * 1.6;
    }
    p.y = heightAt(p.x, p.z);
    this.group.rotation.y = this.yaw;
    if (this.fig) {
      const amp = this.moving ? 0.55 : 0.0;
      const s = Math.sin(this.walkPhase);
      if (this.fig.legL && this.fig.legR) {
        this.fig.legL.rotation.x = s * amp;
        this.fig.legR.rotation.x = -s * amp;
      }
      this.fig.group.position.y = this.moving ? Math.abs(s) * 0.05 : 0;
      this.fig.group.rotation.z = this.moving ? 0 : Math.sin(time * 1.4) * 0.02;
    }
    if (this.swingT >= 0) {
      this.swingT += dt / 0.55;
      const t = this.swingT;
      if (this.saberG) {
        const swing = t < 0.35 ? -t / 0.35 * 1.5
          : t < 0.65 ? -1.5 + (t - 0.35) / 0.3 * 2.6
          : 1.1 - (t - 0.65) / 0.35 * 1.1;
        this.saberG.rotation.z = -0.35 + swing * 0.9;
        this.saberG.rotation.x = 0.2 - swing * 0.5;
      }
      if (t >= 0.45 && t - dt / 0.55 < 0.45) {
        const ax = p.x + Math.sin(this.yaw) * 1.1;
        const az = p.z + Math.cos(this.yaw) * 1.1;
        const chopped = this.deps.chop(ax, p.y + 0.8, az, 2.6);
        const killed = this.deps.folkKill(ax, p.y + 1.0, az, 2.3, 'grape', Math.sin(this.yaw), Math.cos(this.yaw));
        if (chopped > 0) this.deps.msg(`Срублено: ${chopped}`);
        if (killed > 0) this.deps.msg(`Сабля нашла цель: ${killed}`);
      }
      if (t >= 1) this.swingT = -1;
    }
    this.recoil = Math.max(0, this.recoil - dt * 5);
    if (this.pistolG) {
      this.pistolG.position.z = 0.18 - this.recoil * 0.07;
      this.pistolG.rotation.x = this.aiming ? 0 : 0.25 * this.recoil;
      this.pistolG.position.x = this.aiming ? 0.22 : 0.28;
    }
    if (this.saberG) this.saberG.visible = this.weapon === 'saber';
    if (this.pistolG) this.pistolG.visible = this.weapon === 'pistol';
    this.shotCd = Math.max(0, this.shotCd - dt);
    this.updateCamera(dt);
  }

  private updateCamera(dt: number) {
    const cam = this.deps.camera;
    const wantDist = this.aiming ? CAM_AIM_DIST : this.camDist;
    this.camDistSm += (wantDist - this.camDistSm) * Math.min(1, dt * 8);
    const wantFov = this.aiming ? AIM_FOV : 55;
    this.fovSm += (wantFov - this.fovSm) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovSm) > 0.05) { cam.fov = this.fovSm; cam.updateProjectionMatrix(); }
    const px = this.pos.x + this.shift.x;
    const py = this.pos.y + this.shift.y;
    const pz = this.pos.z + this.shift.z;
    const head = this.aiming ? 1.5 : 1.7;
    const d = this.camDistSm;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    let cx = px + Math.sin(this.camYaw) * cp * d;
    let cz = pz + Math.cos(this.camYaw) * cp * d;
    let cy = py + head + sp * d;
    if (this.aiming) {
      const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
      cx += rx * 0.55; cz += rz * 0.55;
    }
    const gh = heightAt(cx - this.shift.x, cz - this.shift.z);
    const minY = Math.max(gh, 0) + 0.5;
    if (cy < minY) cy = minY;
    cy += this.recoil * 0.05;
    cam.position.set(cx, cy, cz);
    const lookDist = this.aiming ? 30 : 6;
    cam.lookAt(
      px - Math.sin(this.camYaw) * lookDist,
      py + head - Math.sin(this.camPitch) * lookDist * 0.6,
      pz - Math.cos(this.camYaw) * lookDist);
    cam.rotateZ(this.recoil * 0.02);
  }

  restoreCamera() {
    const cam = this.deps.camera;
    cam.fov = 55;
    cam.updateProjectionMatrix();
  }

  debugSetCam(yaw: number, pitch: number) {
    this.camYaw = yaw;
    this.camPitch = THREE.MathUtils.clamp(pitch, -0.5, 1.15);
  }
  debugTeleport(x: number, z: number) {
    this.group.position.set(x, Math.max(heightAt(x, z), 0), z);
  }
}
