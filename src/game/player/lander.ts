import * as THREE from 'three';
import { buildFigure, type CrewFigure } from '../ship/crew';
import type { Particles } from '../fx/particles';
import { heightAt, type World } from '../world/world';
import type { PlayerAppearance } from '../core/settings';
import { DEFAULT_APPEARANCE } from '../core/settings';
import { appearanceToTraits } from './appearance';
import type { DeckPlan } from '../ship/buildShip';

// ============================================================
// КАПИТАН ПЕШКОМ (Task 36/40). ДВА мира:
//  • 'island' — ВЫСАДКА НА БЕРЕГ: третье лицо, камера за спиной,
//    WASD относительно камеры, Shift — бег, сабля/пистолет;
//    персонаж идёт по рельефу (heightAt), огибает стволы.
//  • 'deck' — ПРОГУЛКА ПО ПАЛУБЕ СВОЕГО КОРАБЛЯ (Task 40): те же
//    органы управления, но координаты ЛОКАЛЬНЫЕ корабля (фигурка
//    прикреплена к визуалу судна и качается вместе с ним);
//    высоту даёт DeckPlan: главная палуба → ТРАПЫ-лесенки →
//    настил КВАРТЕРДЕКА, у мачт/шпиля/нактоуза — коллайдеры,
//    у бортов — фальшборт; сквозь переднюю стену квартердека
//    можно пройти ТОЛЬКО по трапам (в них проёмы).
// ОРУЖИЕ: 1 — САБЛЯ (Task 40: ПРЯМАЯ, ровный сужающийся клинок),
// 2 — ПИСТОЛЕТ — стреляет ТОЛЬКО НА ПРИЦЕЛЕ (ПКМ): вид от прицела,
// узкий FOV, перекрестие; выстрел — ВИДИМАЯ ПУЛЯ в полёте (свинцовый
// шарик по лучу камеры + дымный след) и ОБЛАКО ДЫМА у дула.
// X — убрать оружие. Руки фигурки МАШАТ при ходьбе; в покое
// капитан периодически поднимает руку — «раздаёт указания».
// ============================================================

export type LanderWeapon = 'none' | 'saber' | 'pistol';
export type LanderMode = 'off' | 'island' | 'deck';

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
  mode: LanderMode;
  weapon: LanderWeapon;
  weaponLabel: string;
  aiming: boolean;
  nearBoat: boolean;
  nearWheel: boolean;
  moving: boolean;
  camYaw: number;
  bullets: number;
}

const WALK = 3.6;
const RUN = 6.4;
const WALK_DECK = 2.7;
const RUN_DECK = 5.0;
const WADE_MUL = 0.45;
const MAX_DEPTH = -0.55;
const SLOPE_MAX = 1.9;
const CAM_DIST = 5.4;
const CAM_AIM_DIST = 1.85;
const AIM_FOV = 40;
const BULLET_SPEED = 95;    // м/с — свинцовый шарик из кремнёвого пистолета
const BULLET_LIFE = 1.1;    // сек (~100 м полёта)

interface Bullet {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  trailT: number;
}

export class Lander {
  group = new THREE.Group();
  mode: LanderMode = 'off';
  weapon: LanderWeapon = 'none';
  aiming = false;
  nearBoat = false;
  nearWheel = false;

  /** Task 40: план палубы + носитель (визуал корабля) для режима deck */
  deckPlan: DeckPlan | null = null;
  deckHost: THREE.Group | null = null;
  /** геометрия оружия — открыта для E2E-проб (прямая сабля) */
  saberG: THREE.Group | null = null;
  pistolG: THREE.Group | null = null;

  get active(): boolean { return this.mode !== 'off'; }
  get pos(): THREE.Vector3 { return this.group.position; }
  yaw = 0;
  camYaw = Math.PI;
  camPitch = 0.34;
  private camDist = CAM_DIST;
  private camDistSm = CAM_DIST;
  private fovSm = 55;

  private fig: CrewFigure | null = null;
  private walkPhase = 0;
  private moving = false;
  private swingT = -1;
  /** Task 57: вариант замаха сабли — 0 косой / 1 сверху / 2 укол */
  private swingKind = 0;
  private shotCd = 0;
  private recoil = 0;
  private stepDustCd = 0;
  /** в покое: таймер до следующего «указания» рукой */
  private idleWaveCd = 3;
  private waveT = 0;
  /** текущая внешность (для E2E/проб); ставится в buildCharacter */
  appearance!: PlayerAppearance;

  /** Task 40: ВИДИМЫЕ ПУЛИ в полёте (пул мешей) */
  private bullets: Bullet[] = [];
  private bulletPool: THREE.Mesh[] = [];

  private deps: LanderDeps;
  private shift = new THREE.Vector3();
  private _v = new THREE.Vector3();
  private _w1 = new THREE.Vector3();
  private _w2 = new THREE.Vector3();
  private _e = new THREE.Euler();

  constructor(deps: LanderDeps) {
    this.deps = deps;
    this.buildCharacter();
    this.group.visible = false;
    this.deps.worldGroup.add(this.group);
  }

  private buildCharacter() {
    // Task 39: фигурка капитана — по ВЫБРАННОЙ внешности (экран
    // создания персонажа); по умолчанию — «случайный моряк».
    // Task 40: walker → руки ОТДЕЛЬНЫМИ мешами (махи/прицел/привет)
    this.appearance = this.deps.appearance ?? DEFAULT_APPEARANCE;
    const fig = buildFigure('walker', appearanceToTraits(this.appearance), 777);
    this.fig = fig;
    this.group.add(fig.group);
    // --- САБЛЯ (Task 40: ПРЯМАЯ — ровный клинок, сужающийся к
    //     острию БЕЗ смещений и изломов; «сломанный верх» убран) ---
    const saber = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3c, roughness: 0.4, metalness: 0.6 });
    const gripM = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.9 });
    // клинок: три ровных сегнала с сужением 0.035 → 0.024 м
    let y0 = 0.1; // от гарды
    const segs: [number, number][] = [[0.035, 0.55], [0.03, 0.25], [0.024, 0.12]];
    for (const [w, len] of segs) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.012), steel);
      seg.position.y = y0 + len / 2;
      saber.add(seg);
      y0 += len;
    }
    // ровное остриё-клин (продолжение прямой линии клинка)
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.008), steel);
    tip.position.y = y0 + 0.045;
    saber.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.05), brass);
    guard.position.y = 0.1;
    saber.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 6), gripM);
    grip.position.y = -0.02;
    saber.add(grip);
    // Task 42: САБЛЯ — В РУКЕ: родитель — маунт у КИСТИ (не корень
    // фигурки): оружие следует за рукой во всех анимациях, рука с
    // оружией больше не «третья рука». База: клинок вверх, чуть
    // вперёд и наружу от бедра
    saber.position.set(0.01, 0.02, 0.02);
    saber.rotation.set(0.25, 0, -0.3);
    saber.visible = false;
    this.saberG = saber;
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
    // Task 42: пистолет — В РУКЕ, дуло ВДОЛЬ РУКИ (при висящей
    // руке — вниз у бедра, при прицеле — вперёд)
    pistol.position.set(0.01, -0.03, 0.03);
    pistol.rotation.set(Math.PI / 2, 0, 0);
    pistol.visible = false;
    this.pistolG = pistol;
    // ОРУЖИЕ → маунт у кисти (рука без крюка)
    this.attachWeaponToHand();
  }

  /** Task 42: прикрепить саблю/пистолет к МАУНТУ У КИСТИ фигурки
   *  (рука без крюка) — оружие следует за рукой во всех анимациях;
   *  вызывается после сборки и каждой пересборки фигурки */
  private attachWeaponToHand() {
    const mount = this.fig?.wristMount ?? null;
    if (this.saberG) {
      this.saberG.parent?.remove(this.saberG);
      (mount ?? this.group).add(this.saberG);
    }
    if (this.pistolG) {
      this.pistolG.parent?.remove(this.pistolG);
      (mount ?? this.group).add(this.pistolG);
    }
  }

  /** Сменить внешность капитана (экран создания/настройки) —
   *  фигурка пересобирается на месте, оружие сохраняется */
  setAppearance(a: PlayerAppearance) {
    this.appearance = { ...a };
    // Task 42: СНЯТЬ оружие со старой фигурки ДО dispose —
    // иначе traverse уничтожит геометрию сабли/пистолета
    if (this.saberG) this.saberG.parent?.remove(this.saberG);
    if (this.pistolG) this.pistolG.parent?.remove(this.pistolG);
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
    this.attachWeaponToHand();
    this.deps.msg('Внешность капитана обновлена');
  }

  /** Поза фигурки для E2E/телеметрии (попугай/повязка/детали) */
  figureInfo() {
    return {
      parrot: this.fig?.hasParrot ?? false,
      eyePatch: this.appearance.eyePatch,
      headwear: this.appearance.headwear,
      torso: this.appearance.torso,       // Task 42: вид одежды торса
      pantsKind: this.appearance.pantsKind, // Task 42: крой штанов
      hook: this.appearance.hook,
      pegLeg: this.appearance.pegLeg,
      verts: this.fig?.verts ?? 0,
      hasArms: !!(this.fig?.armL && this.fig?.armR),
    };
  }

  /** E2E: детали САБЛИ — все части клинка должны быть ПРЯМЫМИ
   *  (x=0, наклоны 0 — сабля ровная, изгиб только у группы) */
  saberInfo() {
    if (!this.saberG) return null;
    return this.saberG.children.map(m => ({
      x: +m.position.x.toFixed(3),
      y: +m.position.y.toFixed(3),
      rx: +m.rotation.x.toFixed(3),
      rz: +m.rotation.z.toFixed(3),
    }));
  }

  /** E2E: сколько пуль сейчас в полёте */
  bulletsInFlight(): number { return this.bullets.length; }

  /** E2E/телеметрия (Task 42): оружие В РУКЕ — родитель сабли/
   *  пистолета = маунт у кисти; рука с оружием не машет */
  weaponInfo() {
    const mount = this.fig?.wristMount ?? null;
    return {
      weapon: this.weapon,
      saberMounted: !!this.saberG && !!mount && this.saberG.parent === mount,
      pistolMounted: !!this.pistolG && !!mount && this.pistolG.parent === mount,
      wristPose: (this.fig && (this.fig.hasHook ? this.fig.armL : this.fig.armR))
        ? +(this.fig.hasHook ? this.fig.armL!.rotation.x : this.fig.armR!.rotation.x).toFixed(3)
        : null,
      holding: this.weapon !== 'none',
      // Task 57: куда СМОТРИТ ствол и куда ЛЕТИТ пуля (e2e:
      // «направлен и стреляет в одну и ту же сторону»)
      barrelDir: (() => {
        if (!this.pistolG || this.weapon !== 'pistol') return null;
        const q = new THREE.Quaternion();
        this.pistolG.getWorldQuaternion(q);
        return new THREE.Vector3(0, 0, 1).applyQuaternion(q).toArray().map(v => +v.toFixed(3));
      })(),
      bulletDir: this.bullets.length
        ? this.bullets[0].vel.clone().normalize().toArray().map(v => +v.toFixed(3))
        : null,
      swingKind: this.swingKind,
    };
  }

  /** Высадиться в точке (мир); faceX/faceZ — направление взгляда
   *  (с моря к суше): камера за спиной, видно остров */
  spawn(x: number, z: number, faceX = 0, faceZ = 1) {
    this.detachFromShip();
    const h = heightAt(x, z);
    this.group.position.set(x, Math.max(h, 0), z);
    this.group.visible = true;
    this.mode = 'island';
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

  /** Task 40: КАПИТАН СХОДИТ С МОСТИКА — прогулка по палубе.
   *  host — визуальная группа корабля (фигурка качается с судном) */
  enterDeck(plan: DeckPlan, host: THREE.Group) {
    this.detachFromShip();
    this.deckPlan = plan;
    this.deckHost = host;
    host.add(this.group);
    // старт — на квартердеке у штурвала (или у рулевого на палубе)
    const sx = plan.hasQuarter ? 0.62 : 0.5;
    const sz = plan.hasQuarter ? plan.wheelZ - 1.35 : plan.wheelZ - 1.1;
    this.group.position.set(sx, plan.surfaceY(sx, sz), sz);
    this.group.visible = true;
    this.mode = 'deck';
    this.weapon = 'none';
    this.aiming = false;
    this.swingT = -1;
    this.shotCd = 0;
    this.idleWaveCd = 1.2;
    this.waveT = 0;
    this.saberG!.visible = false;
    this.pistolG!.visible = false;
    this.yaw = Math.PI; // лицом к корме (к штурвалу)
    this.camYaw = 0;    // камера с носа, видит капитана и штурвал
    this.camPitch = 0.3;
    this.deps.msg('Капитан на палубе! WASD — идти, лесенки — на квартердек, V/E у штурвала — вернуться к рулению');
  }

  /** Task 40: вернуться к штурвалу (режим корабля) */
  exitDeck() {
    this.detachFromShip();
    this.mode = 'off';
    this.aiming = false;
    this.group.visible = false;
  }

  /** убрать фигурку с корабля, вернуть в мир (без смены mode) */
  private detachFromShip() {
    if (this.deckHost && this.group.parent === this.deckHost) {
      this.deckHost.remove(this.group);
      this.deps.worldGroup.add(this.group);
    }
    this.deckHost = null;
    this.deckPlan = null;
  }

  despawn() {
    this.detachFromShip();
    this.mode = 'off';
    this.group.visible = false;
    this.aiming = false;
  }

  hud(): LanderHud {
    return {
      active: this.active, mode: this.mode,
      weapon: this.weapon,
      weaponLabel: this.weapon === 'saber' ? 'Сабля' : this.weapon === 'pistol' ? 'Пистолет' : 'Без оружия',
      aiming: this.aiming, nearBoat: this.nearBoat, nearWheel: this.nearWheel,
      moving: this.moving, camYaw: this.camYaw, bullets: this.bullets.length,
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
      this.deps.msg(this.weapon === 'pistol' ? 'Пистолет заряжен! ПКМ — прицел, ЛКМ — выстрел (только прицелившись)' : 'Пистолет за пояс');
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
        // Task 57: КАЖДЫЙ удар — случайный из трёх замахов
        this.swingKind = Math.floor(Math.random() * 3);
        this.deps.audio.saber();
      } else if (this.weapon === 'pistol') {
        // Task 40: стрелять можно ТОЛЬКО ПРИЦЕЛИВШИСЬ (ПКМ)
        if (this.aiming && this.shotCd <= 0) this.fire();
        else if (!this.aiming && this.shotCd <= 0) {
          this.deps.msg('Сначала прицелитесь — удерживайте ПКМ');
        }
      }
    }
  }

  /** Выстрел: дым у дула + ВИДИМАЯ пуля по лучу камеры */
  private fire() {
    this.shotCd = 1.15;
    this.recoil = 1;
    this.deps.audio.shot();
    const cam = this.deps.camera;
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    // Task 57: дуло — КОНЕЦ СТВОЛА (не рукоять), пуля летит ОТ ДУЛА
    // к точке прицела (луч камеры, 40 м): ствол смотрит и стреляет
    // в одну и ту же сторону (скрин игрока «пистолет в сторону»)
    const tipLocal = new THREE.Vector3(0, 0.035, 0.33);
    this.pistolG!.localToWorld(tipLocal);
    const mp = tipLocal.sub(this.shift).clone();
    const aimPt = cam.position.clone().addScaledVector(camDir, 40).sub(this.shift);
    const dir = aimPt.sub(mp).normalize();
    // ДЫМ ВЫСТРЕЛА: облако из трёх клубов у дула + вспышка вперёд
    this.deps.particles.smoke(mp.x, mp.y, mp.z, dir.x * 1.6, 0.55, dir.z * 1.6, 0.55, 0.85);
    this.deps.particles.smoke(mp.x + dir.x * 0.25, mp.y + 0.05, mp.z + dir.z * 0.25, dir.x * 0.7, 0.9, dir.z * 0.7, 0.38, 1.15);
    this.deps.particles.smoke(mp.x, mp.y + 0.12, mp.z, 0, 0.45, 0, 0.3, 1.4);
    // ПУЛЯ: свинцовый шарик летит по лучу камеры (виден в полёте)
    this.spawnBullet(mp, dir);
  }

  private spawnBullet(pos: THREE.Vector3, dir: THREE.Vector3) {
    let mesh = this.bulletPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.052, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.35, metalness: 0.85 }));
      this.deps.worldGroup.add(mesh);
    }
    mesh.position.copy(pos);
    mesh.visible = true;
    this.bullets.push({
      mesh, pos: pos.clone(),
      vel: dir.clone().multiplyScalar(BULLET_SPEED),
      life: BULLET_LIFE, trailT: 0,
    });
  }

  /** Полёт пуль: движение + попадания (рельеф/жители/кусты/море) */
  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      let dead = b.life <= 0;
      const move = b.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(move / 1.4));
      for (let s = 0; s < steps && !dead; s++) {
        b.pos.addScaledVector(b.vel, dt / steps);
        const th = heightAt(b.pos.x, b.pos.z);
        if (b.pos.y < th) {
          this.deps.particles.debris(b.pos.x, th + 0.3, b.pos.z, 5, 0.7);
          dead = true;
          break;
        }
        if (b.pos.y < -0.5 && th < -10) { dead = true; break; } // ушла в море
        const killed = this.deps.folkKill(b.pos.x, b.pos.y, b.pos.z, 1.5, 'grape', b.vel.x, b.vel.z);
        if (killed > 0) {
          this.deps.msg(`Меткий выстрел! Поражено: ${killed}`);
          dead = true;
          break;
        }
        const chopped = this.deps.chop(b.pos.x, b.pos.y, b.pos.z, 1.0);
        if (chopped > 0) {
          this.deps.msg('Ветку срезало пулей');
          dead = true;
          break;
        }
      }
      b.mesh.position.copy(b.pos);
      // дымный след за пулей
      b.trailT -= dt;
      if (!dead && b.trailT <= 0) {
        b.trailT = 0.06;
        this.deps.particles.smoke(b.pos.x, b.pos.y, b.pos.z, 0, 0.03, 0, 0.15, 0.5);
      }
      if (dead) {
        b.mesh.visible = false;
        this.bulletPool.push(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }

  update(dt: number, time: number, shift: THREE.Vector3, keysDown: (c: string) => boolean) {
    if (!this.active) { this.updateBullets(dt); return; }
    this.shift.copy(shift);
    const p = this.pos;
    let mx = 0, mz = 0;
    if (keysDown('KeyW')) mz += 1;
    if (keysDown('KeyS')) mz -= 1;
    if (keysDown('KeyA')) mx -= 1;
    if (keysDown('KeyD')) mx += 1;
    const running = keysDown('ShiftLeft') || keysDown('ShiftRight');
    this.moving = mx !== 0 || mz !== 0;

    if (this.mode === 'deck') {
      this.updateDeckMove(dt, mx, mz, running);
    } else if (this.moving) {
      // === БЕРЕГ: движение в мировых координатах ===
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
    this.group.rotation.y = this.yaw;

    // --- фигурка: ноги + РУКИ (Task 40: махи при ходьбе, прицел,
    //     взмах саблей, в покое — «указания» поднятой рукой) ---
    if (this.fig) {
      const amp = this.moving ? 0.55 : 0.0;
      const s = Math.sin(this.walkPhase);
      if (this.fig.legL && this.fig.legR) {
        this.fig.legL.rotation.x = s * amp;
        this.fig.legR.rotation.x = -s * amp;
      }
      this.fig.group.position.y = this.moving ? Math.abs(s) * 0.05 : 0;
      this.fig.group.rotation.z = this.moving ? 0 : Math.sin(time * 1.4) * 0.02;
      const armL = this.fig.armL, armR = this.fig.armR;
      // Task 42: рука с оружием — КИСТЬ С МАУНТОМ (у игрока крюк
      // правый, оружие — в ЛЕВОЙ; обычно — правая). При оружии эта
      // рука ДЕРЖИТ его и НЕ МАШЕТ (фикс «третьей руки»), свободная
      // рука машет при ходьбе / покачивается в покое
      const hookSide = !!this.fig.hasHook;
      const wrist = hookSide ? armL : armR;
      const freeArm = hookSide ? armR : armL;
      if (wrist && freeArm) {
        const wz = hookSide ? 0.16 : -0.16;   // отвод от бедра
        if (this.aiming && this.weapon === 'pistol') {
          // прицел: рука с пистолетом вытянута вперёд, дуло вперёд
          // Task 57: ствол ТОЧНО по тангажу камеры (прежде отставал
          // на 40% и был наклонён вбок — пистолет «смотрел» мимо)
          wrist.rotation.set(-(Math.PI / 2 - this.camPitch), 0, 0);
          freeArm.rotation.set(0.25, 0, hookSide ? -0.18 : 0.18);
        } else if (this.weapon === 'saber' && this.swingT >= 0) {
          // Task 57: ТРИ ЗАМАХА — рука по варианту удара
          const t = this.swingT;
          const sw = t < 0.35 ? -t / 0.35 * 1.5
            : t < 0.65 ? -1.5 + (t - 0.35) / 0.3 * 2.6
            : 1.1 - (t - 0.65) / 0.35 * 1.1;
          if (this.swingKind === 1) {
            // «СВЕРХУ»: рука высоко над головой → рубящий удар вниз
            const raise = t < 0.35 ? t / 0.35 : t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
            wrist.rotation.set(-1.15 - raise * 1.25, 0, wz * (1 - raise * 0.6));
            freeArm.rotation.set(0.3 + raise * 0.3, 0, hookSide ? -0.35 : 0.35);
          } else if (this.swingKind === 2) {
            // «УКОЛ»: рука выбрасывается прямо вперёд
            const push = t < 0.45 ? t / 0.45 : Math.max(0, 1 - (t - 0.45) / 0.4);
            wrist.rotation.set(-(Math.PI / 2 - 0.06 - push * 0.1), 0, wz * 0.25);
            freeArm.rotation.set(0.25, 0, hookSide ? -0.25 : 0.25);
          } else {
            // «КОСОЙ» (классический): замах в сторону → взмах
            wrist.rotation.set(-1.15 - sw * 0.35, 0, wz);
            freeArm.rotation.set(0.3 + sw * 0.2, 0, hookSide ? -0.3 : 0.3);
          }
        } else if (this.weapon !== 'none') {
          // ОРУЖИЕ В РУКЕ: рука держит его у бедра — НЕ машет;
          // свободная рука живёт обычной жизнью
          wrist.rotation.set(-0.42, 0, wz);
          if (this.moving) {
            freeArm.rotation.set(-s * 0.5, 0, hookSide ? -0.05 : 0.05);
          } else {
            freeArm.rotation.set(Math.sin(time * 1.4) * 0.04, 0, hookSide ? -0.06 : 0.06);
          }
        } else if (this.moving) {
          // без оружия: обе руки машут в противофазе
          wrist.rotation.set(s * 0.5, 0, wz);
          freeArm.rotation.set(-s * 0.5, 0, -wz);
        } else {
          // покой: лёгкое покачивание + периодически ПОДНЯТАЯ РУКА
          this.idleWaveCd -= dt;
          if (this.idleWaveCd <= 0 && this.waveT <= 0) {
            this.waveT = 1.8;
            this.idleWaveCd = 5 + Math.sin(this.fig.seed) * 3;
          }
          if (this.waveT > 0) {
            this.waveT -= dt;
            // поднята СВОБОДНАЯ рука (правая поднимается +Z, левая −Z)
            const lift = (wz < 0 ? 1 : -1) * (2.55 + Math.sin(time * 9) * 0.3);
            freeArm.rotation.set(0, 0, lift);
            wrist.rotation.set(0, 0, wz);
          } else {
            wrist.rotation.set(Math.sin(time * 1.4) * 0.04, 0, wz);
            freeArm.rotation.set(Math.sin(time * 1.4 + 1) * 0.04, 0, -wz);
          }
        }
      }
    }

    // --- взмах сабли: анимация оружия + поражение ---
    if (this.swingT >= 0) {
      this.swingT += dt / 0.55;
      const t = this.swingT;
      if (this.saberG) {
        const swing = t < 0.35 ? -t / 0.35 * 1.5
          : t < 0.65 ? -1.5 + (t - 0.35) / 0.3 * 2.6
          : 1.1 - (t - 0.65) / 0.35 * 1.1;
        // Task 57: три анимации клинка — косой / сверху / укол
        if (this.swingKind === 1) {
          const raise = t < 0.35 ? t / 0.35 : t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
          this.saberG.rotation.z = -0.3;
          this.saberG.rotation.x = 0.25 + raise * 1.35 - (t < 0.65 ? 0 : (t - 0.65) / 0.35 * 2.1);
        } else if (this.swingKind === 2) {
          const push = t < 0.45 ? t / 0.45 : Math.max(0, 1 - (t - 0.45) / 0.4);
          this.saberG.rotation.set(0.25 + 1.28, 0, -0.3);
          this.saberG.position.set(0.01, 0.02, 0.02 + push * 0.3);
        } else {
          this.saberG.rotation.z = -0.3 + swing * 0.9;
          this.saberG.rotation.x = 0.25 - swing * 0.5;
        }
      }
      if (t >= 0.45 && t - dt / 0.55 < 0.45) {
        const ax = p.x + Math.sin(this.yaw) * 1.1;
        const az = p.z + Math.cos(this.yaw) * 1.1;
        // на палубе координаты локальные — попадания не ищем
        if (this.mode === 'island') {
          const chopped = this.deps.chop(ax, p.y + 0.8, az, 2.6);
          const killed = this.deps.folkKill(ax, p.y + 1.0, az, 2.3, 'grape', Math.sin(this.yaw), Math.cos(this.yaw));
          if (chopped > 0) this.deps.msg(`Срублено: ${chopped}`);
          if (killed > 0) this.deps.msg(`Сабля нашла цель: ${killed}`);
        }
      }
      if (t >= 1) {
        this.swingT = -1;
        // базовая поза сабли у бедра (после «укола» — вернуть и позицию)
        if (this.saberG) {
          this.saberG.rotation.set(0.25, 0, -0.3);
          this.saberG.position.set(0.01, 0.02, 0.02);
        }
      }
    }
    this.recoil = Math.max(0, this.recoil - dt * 5);
    if (this.pistolG) {
      // Task 42: отдача — ВДОЛЬ РУКИ (пистолет в кисти): рывок
      // назад + подброс дула; при прицеле рука вытянута — дуло вперёд
      this.pistolG.position.set(0.01, -0.03 + this.recoil * 0.05, 0.03);
      this.pistolG.rotation.set(Math.PI / 2 - this.recoil * 0.3, 0, 0);
    }
    if (this.saberG) this.saberG.visible = this.weapon === 'saber';
    if (this.pistolG) this.pistolG.visible = this.weapon === 'pistol';
    this.shotCd = Math.max(0, this.shotCd - dt);
    this.updateBullets(dt);
    if (this.mode === 'deck') this.updateCameraDeck(dt);
    else this.updateCamera(dt);
  }

  /** === ПАЛУБА: движение в ЛОКАЛЬНЫХ координатах корабля === */
  private updateDeckMove(dt: number, mx: number, mz: number, running: boolean) {
    const plan = this.deckPlan!;
    const p = this.pos;
    if (this.moving) {
      // желаемое направление в МИРЕ (от камеры)
      const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
      const rx = -fz, rz = fx;
      let dx = fx * mz + rx * mx;
      let dz = fz * mz + rz * mx;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // → в ЛОКАЛЬНЫЕ оси корабля (курс носителя)
      const h = this.hostYaw();
      const ch = Math.cos(h), sh = Math.sin(h);
      const lx = dx * ch - dz * sh;
      const lz = dx * sh + dz * ch;
      const spd = (running ? RUN_DECK : WALK_DECK) * (this.aiming ? 0.55 : 1);
      let nx = p.x + lx * spd * dt;
      let nz = p.z + lz * spd * dt;
      // границы: транец/бак и борта (фальшборт)
      nz = THREE.MathUtils.clamp(nz, plan.sternLimitZ, plan.bowLimitZ);
      let lim = Math.max(0.35, plan.halfWidthAt(nz) - 0.42);
      nx = THREE.MathUtils.clamp(nx, -lim, lim);
      // передняя стена квартердека: проход ТОЛЬКО через проёмы трапов
      const wasAft = p.z <= plan.qFrontZ;
      const nowAft = nz <= plan.qFrontZ;
      if (plan.hasQuarter && wasAft !== nowAft
        && !plan.onStair(nx, nz) && !plan.onStair(p.x, p.z)) {
        nz = p.z; // стена — скользим вдоль
      }
      // с трапа нельзя шагнуть вбок (перила): держим полосу
      if (plan.hasQuarter && nz > plan.qFrontZ && nz < plan.stairZ0
        && plan.onStair(p.x, p.z) && !plan.onStair(nx, nz)) {
        nx = p.x;
      }
      // коллайдеры: мачты, шпиль, нактоуз
      for (const o of plan.obstacles) {
        const ddx = nx - o.x, ddz = nz - o.z;
        const d = Math.hypot(ddx, ddz);
        const min = o.r + 0.34;
        if (d < min && d > 1e-4) {
          nx = o.x + (ddx / d) * min;
          nz = o.z + (ddz / d) * min;
        }
      }
      // повторный зажим после выталкивания
      nz = THREE.MathUtils.clamp(nz, plan.sternLimitZ, plan.bowLimitZ);
      lim = Math.max(0.35, plan.halfWidthAt(nz) - 0.42);
      nx = THREE.MathUtils.clamp(nx, -lim, lim);
      p.x = nx;
      p.z = nz;
      // разворот: лицом по движению; на прицеле — за камерой
      const awx = -Math.sin(this.camYaw), awz = -Math.cos(this.camYaw);
      const wantYaw = this.aiming
        ? Math.atan2(awx * ch - awz * sh, awx * sh + awz * ch)
        : Math.atan2(lx, lz);
      let dY = wantYaw - this.yaw;
      dY = Math.atan2(Math.sin(dY), Math.cos(dY));
      this.yaw += dY * Math.min(1, dt * 12);
      this.walkPhase += dt * (running ? 10 : 6.6);
    } else {
      this.walkPhase += dt * 1.6;
    }
    // высота: палуба/трап/квартердек (плавный подъём по ступеням)
    const ty = plan.surfaceY(p.x, p.z);
    p.y += (ty - p.y) * Math.min(1, dt * 14);
    // у штурвала? (выход к рулению)
    this.nearWheel = Math.hypot(p.x, p.z - plan.wheelZ) < 2.0;
  }

  /** курс корабля-носителя (рад, вокруг Y) */
  private hostYaw(): number {
    if (!this.deckHost) return 0;
    return this._e.setFromQuaternion(this.deckHost.quaternion, 'YXZ').y;
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

  /** камера режима палубы: цель — МИРОВАЯ позиция фигурки (корабль
   *  качается — берём позицию через трансформ носителя) */
  private updateCameraDeck(dt: number) {
    const cam = this.deps.camera;
    const wantDist = this.aiming ? CAM_AIM_DIST : this.camDist;
    this.camDistSm += (wantDist - this.camDistSm) * Math.min(1, dt * 8);
    const wantFov = this.aiming ? AIM_FOV : 55;
    this.fovSm += (wantFov - this.fovSm) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovSm) > 0.05) { cam.fov = this.fovSm; cam.updateProjectionMatrix(); }
    // свежие матрицы носителя (getWorldPosition обновляет цепочку)
    this.group.getWorldPosition(this._w1);
    const head = this.aiming ? 1.5 : 1.7;
    const d = this.camDistSm;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    let cx = this._w1.x + Math.sin(this.camYaw) * cp * d;
    let cz = this._w1.z + Math.cos(this.camYaw) * cp * d;
    let cy = this._w1.y + head + sp * d;
    if (this.aiming) {
      const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
      cx += rx * 0.55; cz += rz * 0.55;
    }
    // не дать камере нырнуть под палубу: локальная высота поверхности
    if (this.deckPlan && this.deckHost) {
      this._w2.set(cx, cy, cz);
      this.deckHost.worldToLocal(this._w2);
      const inside = Math.abs(this._w2.x) < this.deckPlan.halfWidthAt(this._w2.z) + 0.8
        && this._w2.z > this.deckPlan.qSternZ - 1.2
        && this._w2.z < this.deckPlan.bowLimitZ + 2.5;
      const minY = inside
        ? this.deckPlan.surfaceY(this._w2.x, this._w2.z) + 0.35
        : Math.max(this._w1.y - head + 0.4, 0.8);
      if (this._w2.y < minY) {
        this._w2.y = minY;
        this.deckHost.localToWorld(this._w2);
        cx = this._w2.x; cy = this._w2.y; cz = this._w2.z;
      }
    }
    cy += this.recoil * 0.05;
    cam.position.set(cx, cy, cz);
    const lookDist = this.aiming ? 30 : 6;
    cam.lookAt(
      this._w1.x - Math.sin(this.camYaw) * lookDist,
      this._w1.y + head - Math.sin(this.camPitch) * lookDist * 0.6,
      this._w1.z - Math.cos(this.camYaw) * lookDist);
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
    if (this.mode === 'deck') {
      const plan = this.deckPlan!;
      this.group.position.set(
        THREE.MathUtils.clamp(x, -2.4, 2.4),
        plan.surfaceY(THREE.MathUtils.clamp(x, -2.4, 2.4), z),
        THREE.MathUtils.clamp(z, plan.sternLimitZ, plan.bowLimitZ));
      return;
    }
    this.group.position.set(x, Math.max(heightAt(x, z), 0), z);
  }
}
