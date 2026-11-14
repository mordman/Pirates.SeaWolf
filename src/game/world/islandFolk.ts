import * as THREE from 'three';
import {
  buildFigure, rollTraits, mulberry32, segSegDist3D, crewFx,
  type CrewFigure, type KillMode,
} from '../ship/crew';
import type { VillageDef } from './world';

// ============================================================
// Островные пираты «Логова» (по ТЗ: остров у полигона, ГУСТО
// заполненный человечками). Те же процедурные фигурки, что и
// экипаж на палубе, но живут в МИРОВЫХ координатах острова:
//  - «ходоки» патрулируют тропу по склону (высота — heightAt),
//  - «дворовые» толпятся у костра/пальмы (idle-покачивание),
//  - «часовые» у кромки воды смотрят в море.
// ПОРАЖЕНИЕ: залп картечи по берегу (combat.onGroundHit →
// killNear) выкашивает фигуры радиусом разлёта пуль: картечь
// валит трупом, ядро разрывает на куски (гибы + кровь).
// ============================================================

export type FolkMode = 'walk' | 'idle' | 'sentry';

interface Folk {
  fig: CrewFigure;
  mode: FolkMode;
  // тропа ходока: от A к B по острову
  ax: number; az: number; bx: number; bz: number;
  t: number;              // 0..1 по тропе
  dir: 1 | -1;
  speed: number;          // м/с
  phase: number;
  face: number;           // yaw для часовых
  // смерть
  dead: boolean;
  deadT: number;
  deathMode: 'fall' | 'gib';
  corpseLife: number;
  fallDir: number;
  fallRoll: number;
}

export interface LandFolk {
  group: THREE.Group;   // ТОЛЬКО фигурки (E2E считает детей)
  props: THREE.Group;    // костры лагеря (отдельная группа)
  total: number;
  shown: number;
  dead: number;
  update(dt: number, time: number, near?: { x: number; z: number }): void;
  /** Поражение в точке (мировые координаты): капсула каждой живой
   *  фигуры (ноги→голова) против сферы радиуса hitR. Возвращает
   *  число убитых (1 фигура = 1 пират). */
  killNear(x: number, y: number, z: number, hitR: number,
    mode: KillMode, dirX?: number, dirZ?: number): number;
  reset(): void;
  setVisible(v: boolean): void;
}

export interface LandFolkOpts {
  cx: number; cz: number; r: number;   // центр и радиус острова
  maxH: number;                        // высота острова
  heightAt: (x: number, z: number) => number;
  seed?: number;
}

/** Численность береговой ватаги для острова радиуса r (ГУСТО:
 *  латера — пиратский лагерь, не пустой берег) */
export function folkCountFor(r: number): number {
  return Math.max(64, Math.min(200, Math.round(r * 1.2)));
}

/** Гибель одного пирата (мир): grape — валит трупом, ball — разрывает */
function killFolk(f: Folk, mode: KillMode, dx: number, dz: number) {
  f.dead = true;
  f.deadT = 0;
  f.deathMode = mode === 'grape' ? 'fall' : 'gib';
  const fx = crewFx();
  const p = f.fig.group.position;
  const wpos = new THREE.Vector3(p.x, p.y + 0.75, p.z);
  let wdir = new THREE.Vector3(dx, 0.12, dz);
  if (wdir.lengthSq() < 1e-6) wdir.set(0, 0, 1);
  wdir.normalize();
  if (mode === 'grape') {
    f.corpseLife = 30 + Math.random() * 30;
    f.fallDir = Math.random() < 0.5 ? 1 : -1;
    f.fallRoll = (Math.random() - 0.5) * 0.8;
    fx?.particles?.blood(wpos.x, wpos.y - 0.35, wpos.z, wdir.x * 1.5, 0.4, wdir.z * 1.5, 7, 0.7);
  } else {
    f.fig.group.visible = false;
    f.corpseLife = 0;
    const gibs = fx?.gibs;
    if (gibs) {
      const fig = f.fig;
      const mk = (sx: number, sy: number, sz: number, hex: number, extra = 1) => {
        const push = (2.6 + Math.random() * 3.6) * extra;
        gibs.spawnPart(
          new THREE.Vector3(
            wpos.x + (Math.random() - 0.5) * 0.35,
            wpos.y + (Math.random() - 0.5) * 0.7,
            wpos.z + (Math.random() - 0.5) * 0.35),
          new THREE.Vector3(
            wdir.x * push + (Math.random() - 0.5) * 3.4,
            1.5 + Math.random() * 3.0,
            wdir.z * push + (Math.random() - 0.5) * 3.4),
          sx, sy, sz, hex, 1.5 + Math.random() * 1.1);
      };
      mk(0.14, 0.14, 0.14, fig.skin);        // голова
      mk(0.24, 0.2, 0.16, fig.shirt, 1.15);  // торс
      mk(0.09, 0.3, 0.09, fig.shirt, 0.9);   // рука
      mk(0.09, 0.28, 0.09, fig.skin, 0.85);  // рука
      mk(0.11, 0.44, 0.12, fig.pants, 0.8);  // нога
      if (fig.hasPeg) mk(0.09, 0.48, 0.09, 0x8a6a42, 0.75); // деревянная нога
      if (fig.hasHook) mk(0.09, 0.09, 0.09, 0x3a3f46, 1.3); // крюк
    }
    fx?.particles?.blood(wpos.x, wpos.y, wpos.z, wdir.x * 4, 1.1, wdir.z * 4, 16, 1.4);
  }
}

/** Собрать ватагу пиратов на острове */
export function buildLandFolk(n: number, o: LandFolkOpts): LandFolk {
  const group = new THREE.Group();
  const props = new THREE.Group(); // костры (не фигуры — E2E не считает)
  const flames: THREE.Mesh[] = [];  // языки огня — пульсируют в update
  const rng = mulberry32((o.seed ?? 4242) * 7717 + 11);
  let s = (o.seed ?? 4242) * 2654435761 % 2147483647;
  const nextSeed = () => { s = (s * 16807) % 2147483647; return s % 100000; };
  const heightAt = o.heightAt;
  // костры и ватага — только у кромки воды (пляж/подножье склона):
  // с моря лагерь виден ГУСТО по всей дуге берега
  const hMax = Math.min(3.6, o.maxH * 0.3 + 0.5);
  const slopeAt = (x: number, z: number) => {
    const h = heightAt(x, z);
    const e = 1.6;
    return (Math.abs(heightAt(x + e, z) - h) + Math.abs(heightAt(x, z + e) - h)) / e;
  };
  const ok = (x: number, z: number): number => {
    const h = heightAt(x, z);
    if (h < 0.7 || h > hMax) return -1;
    if (slopeAt(x, z) > 0.55) return -1;
    return h;
  };
  const folks: Folk[] = [];
  // костры: таймеры дымовых столбов (видны с моря как признак лагеря)
  const campfires: { x: number; z: number; y: number; t: number }[] = [];
  // === 1. ЛАГЕРНЫЕ КОСТРОВЫЕ КЛАСТЕРЫ: плотные кольца пиратов ===
  // (так берег читается «густо заполненным человечками»)
  const camps: { x: number; z: number }[] = [];
  let campTries = 0;
  const addCampfire = (x: number, z: number, h: number) => {
    const g = new THREE.Group();
    // кольцо камней (большой сигнальный костёр лагеря — виден с моря)
    const stones = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.22, 5, 10),
      new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 1 }));
    stones.rotation.x = Math.PI / 2;
    g.add(stones);
    // брёвна teepee над огнём
    const logs = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 1.8, 5),
      new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.95 }));
    logs.position.y = 0.9;
    logs.rotation.x = 0.18;
    g.add(logs);
    // язык пламени (пульсирует в update)
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 1.7, 6),
      new THREE.MeshStandardMaterial({
        color: 0xffb04a, emissive: 0xff7710,
        emissiveIntensity: 4, roughness: 0.5,
      }));
    flame.position.y = 1.35;
    g.add(flame);
    flames.push(flame);
    g.position.set(x, h - 0.12, z);
    g.traverse(ob => { ob.castShadow = false; ob.receiveShadow = false; });
    props.add(g);
    campfires.push({ x, z, y: h, t: rng() * 0.5 });
  };
  while (camps.length < 14 && campTries < 900) {
    campTries++;
    const a = rng() * Math.PI * 2;
    const rr = 0.25 + rng() * 0.55;   // костры ближе к берегу
    const x = o.cx + Math.cos(a) * o.r * rr;
    const z = o.cz + Math.sin(a) * o.r * rr;
    const h = ok(x, z);
    if (h < 0) continue;
    addCampfire(x, z, h);
    // вокруг костра 8-10 дворовых «у костра», лицом к центру
    const nRing = 8 + Math.floor(rng() * 3);
    for (let k = 0; k < nRing; k++) {
      const aa = (k / nRing) * Math.PI * 2 + rng() * 0.5;
      const rad = 2.6 + rng() * 1.4;
      const fx = x + Math.cos(aa) * rad;
      const fz = z + Math.sin(aa) * rad;
      const fh = ok(fx, fz);
      if (fh < 0) continue;
      const role = rng() < 0.5 ? 'watch' : 'gunner';
      const fig = buildFigure(role, rollTraits(rng, role), nextSeed());
      fig.group.position.set(fx, fh - 0.06, fz);
      fig.group.rotation.y = Math.atan2(x - fx, z - fz); // лицом к костру
      group.add(fig.group);
      folks.push({
        fig, mode: 'idle', ax: fx, az: fz, bx: fx, bz: fz,
        t: 0, dir: 1, speed: 0, phase: rng() * 6.28,
        face: Math.atan2(x - fx, z - fz),
        dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0,
        fallDir: 1, fallRoll: 0,
      });
    }
    camps.push({ x, z });
  }
  // === 2. ЗАПОЛНЕНИЕ: ходоки по тропам + часовые у кромки воды ===
  let tries = 0;
  while (folks.length < n && tries < n * 40) {
    tries++;
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * o.r * 0.9;
    const x = o.cx + Math.cos(a) * rr;
    const z = o.cz + Math.sin(a) * rr;
    const h = ok(x, z);
    if (h < 0) continue;
    const roll = rng();
    const mode: FolkMode = roll < 0.55 ? 'walk' : 'sentry';
    // роль фигуры: у ходока — подвижные ноги, остальные статичны
    const role = mode === 'walk' ? 'walker' : rng() < 0.5 ? 'watch' : 'gunner';
    const fig = buildFigure(role, rollTraits(rng, role), nextSeed());
    fig.group.position.set(x, h - 0.06, z);
    let f: Folk | null = null;
    if (mode === 'walk') {
      // ищем пару точек тропы на склоне; не нашли — пират в часовые
      let ax = x, az = z, bx = x, bz = z, found = false;
      for (let k = 0; k < 10; k++) {
        const a2 = rng() * Math.PI * 2, d2 = 4 + rng() * 10;
        const tx = x + Math.cos(a2) * d2, tz = z + Math.sin(a2) * d2;
        const hx = ok(tx, tz);
        if (hx < 0) continue;
        const b2 = rng() * Math.PI * 2, d3 = 4 + rng() * 10;
        const ux = x + Math.cos(b2) * d3, uz = z + Math.sin(b2) * d3;
        const hu = ok(ux, uz);
        if (hu < 0) continue;
        // тропа не пересекает воду по прямой (грубая проверка)
        let dry = true;
        for (let q = 0.15; q < 1; q += 0.2) {
          if (heightAt(
            tx + (ux - tx) * q, tz + (uz - tz) * q) < 0.45) { dry = false; break; }
        }
        if (!dry) continue;
        ax = tx; az = tz; bx = ux; bz = uz; found = true;
        break;
      }
      if (found) {
        fig.group.position.set(ax, heightAt(ax, az) - 0.06, az);
        f = {
          fig, mode, ax, az, bx, bz,
          t: rng(), dir: rng() < 0.5 ? 1 : -1,
          speed: 0.5 + rng() * 0.55, phase: rng() * 6.28, face: 0,
          dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0,
          fallDir: 1, fallRoll: 0,
        };
      }
    }
    if (!f) {
      const im = 'sentry';
      // часовой смотрит в море (от центра острова)
      const face = Math.atan2(x - o.cx, z - o.cz);
      fig.group.rotation.y = face;
      f = {
        fig, mode: im,
        ax: x, az: z, bx: x, bz: z, t: 0, dir: 1 as const,
        speed: 0, phase: rng() * 6.28, face,
        dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0,
        fallDir: 1, fallRoll: 0,
      };
    }
    group.add(fig.group);
    folks.push(f);
  }
  group.traverse(ob => { ob.castShadow = false; ob.receiveShadow = false; });

  const recount = () => {
    let alive = 0, dead = 0;
    for (const f of folks) {
      if (f.dead) dead++;
      else if (f.fig.group.visible) alive++;
    }
    return { alive, dead };
  };

  const vis: LandFolk = {
    group, props, total: folks.length, shown: folks.length, dead: 0,
    setVisible(v: boolean) { group.visible = v; },
    killNear(x, y, z, hitR, mode, dirX = 0, dirZ = 1) {
      const P = new THREE.Vector3(x, y, z);
      let killed = 0;
      for (const f of folks) {
        if (f.dead || !f.fig.group.visible) continue;
        const p = f.fig.group.position;
        const lo = new THREE.Vector3(p.x, p.y + 0.12, p.z);
        const hi = new THREE.Vector3(p.x, p.y + 1.62, p.z);
        // точка попадания против капсулы фигуры (ноги→голова)
        if (segSegDist3D(P, P, lo, hi) > hitR) continue;
        killFolk(f, mode, dirX, dirZ);
        killed++;
      }
      const rc = recount();
      vis.dead = rc.dead;
      vis.shown = rc.alive;
      return killed;
    },
    reset() {
      for (const f of folks) {
        f.dead = false;
        f.deadT = 0;
        f.corpseLife = 0;
        f.fig.group.visible = true;
        f.fig.group.rotation.x = 0;
        f.fig.group.rotation.z = 0;
        f.fig.group.scale.setScalar(1);
      }
      vis.dead = 0;
      vis.shown = folks.length;
    },
    update(dt, time, near) {
      // костры: языки пламени пульсируют + дымовые столбы.
      // Дым — только у берега РЯДОМ С ИГРОКОМ (LOD: 95 крупных
      // клубов дыма валят FPS в software-рендере — а с моря за
      // 260 м они всё равно не читаются)
      for (let i = 0; i < flames.length; i++) {
        const fl = flames[i];
        const pulse = 0.86 + 0.18 * Math.sin(time * 7 + i * 1.7)
          + 0.06 * Math.sin(time * 13 + i);
        fl.scale.set(pulse, 0.9 + 0.25 * Math.sin(time * 5.3 + i * 2.2), pulse);
      }
      const fxc = crewFx();
      if (fxc?.particles) {
        for (const cf of campfires) {
          cf.t -= dt;
          if (cf.t > 0) continue;
          cf.t = 0.5 + Math.random() * 0.25;
          if (near && Math.hypot(cf.x - near.x, cf.z - near.z) > 260) continue;
          // широкий клуб дыма: столб читается с моря как признак лагеря
          fxc.particles.smoke(cf.x, cf.y + 2.2, cf.z,
            (Math.random() - 0.5) * 0.5, 1.45, (Math.random() - 0.5) * 0.5,
            2.6, 3.4);
        }
      }
      for (const f of folks) {
        if (!f.fig.group.visible) continue;
        if (f.dead) {
          if (f.deathMode !== 'fall') continue;
          f.deadT += dt;
          const k = Math.min(1, f.deadT / 0.5);
          const e = 1 - (1 - k) * (1 - k);
          f.fig.group.rotation.x = f.fallDir * (Math.PI / 2 - 0.07) * e;
          f.fig.group.rotation.z = f.fallRoll * e;
          if (f.deadT > f.corpseLife) {
            const fade = Math.max(0.01, 1 - (f.deadT - f.corpseLife) / 1.2);
            f.fig.group.scale.setScalar(fade);
            if (fade <= 0.01) f.fig.group.visible = false;
          }
          continue;
        }
        if (f.mode === 'walk') {
          const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
          if (len > 1) {
            f.t += (f.dir * f.speed * dt) / len;
            if (f.t > 1) { f.t = 1; f.dir = -1; }
            if (f.t < 0) { f.t = 0; f.dir = 1; }
            const x = f.ax + (f.bx - f.ax) * f.t;
            const z = f.az + (f.bz - f.az) * f.t;
            f.fig.group.position.set(x, heightAt(x, z) - 0.06, z);
            f.fig.group.rotation.y = f.dir > 0
              ? Math.atan2(f.bx - f.ax, f.bz - f.az)
              : Math.atan2(f.ax - f.bx, f.az - f.bz);
            const step = time * f.speed * 7;
            if (f.fig.legL && f.fig.legR) {
              f.fig.legL.rotation.x = Math.sin(step) * 0.55;
              f.fig.legR.rotation.x = -Math.sin(step) * 0.55;
            }
            // Task 40: руки МАШУТ при ходьбе (противофаза ногам)
            if (f.fig.armL && f.fig.armR) {
              f.fig.armL.rotation.x = -Math.sin(step) * 0.5;
              f.fig.armR.rotation.x = Math.sin(step) * 0.5;
              f.fig.armL.rotation.z = 0.05;
              f.fig.armR.rotation.z = -0.05;
            }
            f.fig.group.position.y += Math.abs(Math.sin(step)) * 0.03;
          } else {
            // стоячего — лёгкое покачивание
            f.fig.group.rotation.z = Math.sin(time * 1.3 + f.phase) * 0.035;
          }
        } else if (f.mode === 'sentry') {
          // часовой: стойка + бодрое покачивание, лицом в море
          f.fig.group.rotation.z = Math.sin(time * 1.6 + f.phase) * 0.02;
        } else {
          // дворовый: idle-покачивание, изредка поворачивается
          f.fig.group.rotation.z = Math.sin(time * 1.3 + f.phase) * 0.035;
          f.fig.group.rotation.y = f.face + Math.sin(time * 0.3 + f.phase) * 0.7;
        }
      }
      const rc = recount();
      vis.dead = rc.dead;
      vis.shown = rc.alive;
    },
  };
  return vis;
}

// ============================================================
// ЖИТЕЛИ ДЕРЕВЕНЬ (Task 36): мирные островитяне — ходоки бредут
// по ТРОПЕ от деревни к порту (полилиния), дворовые толпятся у
// костра. Те же процедурные фигурки; саблей/пистолетом игрока
// можно атаковать и их (killNear общий).
// ============================================================
export interface VillageFolkOpts {
  heightAt: (x: number, z: number) => number;
  seed?: number;
  /** Task 41: множитель числа жителей (настройки острова, 1 — штатно) */
  folkMul?: number;
}

export function buildVillageFolk(v: VillageDef, o: VillageFolkOpts): LandFolk {
  const group = new THREE.Group();
  const props = new THREE.Group();
  const rng = mulberry32((o.seed ?? 4242) * 7717 + 11);
  let s = (o.seed ?? 4242) * 2654435761 % 2147483647;
  const nextSeed = () => { s = (s * 16807) % 2147483647; return s % 100000; };
  const heightAt = o.heightAt;
  const trail = v.trail;
  let trailLen = 0;
  for (let k = 0; k + 1 < trail.length; k++) {
    trailLen += Math.hypot(trail[k + 1].x - trail[k].x, trail[k + 1].z - trail[k].z);
  }
  const pointAt = (t: number) => {
    let want = t * trailLen;
    for (let k = 0; k + 1 < trail.length; k++) {
      const seg = Math.hypot(trail[k + 1].x - trail[k].x, trail[k + 1].z - trail[k].z);
      if (want <= seg) {
        const u = want / Math.max(1e-6, seg);
        return { x: trail[k].x + (trail[k + 1].x - trail[k].x) * u, z: trail[k].z + (trail[k + 1].z - trail[k].z) * u };
      }
      want -= seg;
    }
    const last = trail[trail.length - 1];
    return { x: last.x, z: last.z };
  };
  const folks: Folk[] = [];
  const mkFolk = (x: number, z: number, mode: 'walk' | 'idle', face: number) => {
    const role = mode === 'walk' ? 'walker' : rng() < 0.5 ? 'watch' : 'gunner';
    const fig = buildFigure(role, rollTraits(rng, role, 'merchant'), nextSeed());
    fig.group.position.set(x, heightAt(x, z) - 0.06, z);
    fig.group.rotation.y = face;
    group.add(fig.group);
    folks.push({
      fig, mode, ax: x, az: z, bx: x, bz: z,
      t: rng(), dir: rng() < 0.5 ? 1 : -1,
      speed: 0.85 + rng() * 0.5, phase: rng() * 6.28, face,
      dead: false, deadT: 0, deathMode: 'fall', corpseLife: 0,
      fallDir: 1, fallRoll: 0,
    });
  };
  // Task 41: ЖИТЕЛИ — сколько на деревню, управляется настройкой
  // острова (folkMul: 0 — пустая деревня, 5 — толпа)
  const fMul = Math.max(0, o.folkMul ?? 1);
  const nWalk = Math.round(Math.max(3, Math.round(v.huts * 1.2)) * fMul);
  for (let i = 0; i < nWalk; i++) {
    const t = rng();
    const p = pointAt(t);
    mkFolk(p.x, p.z, 'walk', 0);
  }
  const nIdle = Math.round(Math.max(3, Math.round(v.huts * 0.8)) * fMul);
  for (let i = 0; i < nIdle; i++) {
    const a = (i / nIdle) * Math.PI * 2 + rng() * 0.5;
    const rad = 3.2 + rng() * 2.2;
    mkFolk(v.x + Math.cos(a) * rad, v.z + Math.sin(a) * rad, 'idle', Math.atan2(v.x - (v.x + Math.cos(a) * rad), v.z - (v.z + Math.sin(a) * rad)));
  }
  group.traverse(ob => { ob.castShadow = false; ob.receiveShadow = false; });

  const recount = () => {
    let alive = 0, dead = 0;
    for (const f of folks) {
      if (f.dead) dead++;
      else if (f.fig.group.visible) alive++;
    }
    return { alive, dead };
  };

  const vis: LandFolk = {
    group, props, total: folks.length, shown: folks.length, dead: 0,
    setVisible(v: boolean) { group.visible = v; },
    killNear(x, y, z, hitR, mode, dirX = 0, dirZ = 1) {
      const P = new THREE.Vector3(x, y, z);
      let killed = 0;
      for (const f of folks) {
        if (f.dead || !f.fig.group.visible) continue;
        const p = f.fig.group.position;
        const lo = new THREE.Vector3(p.x, p.y + 0.12, p.z);
        const hi = new THREE.Vector3(p.x, p.y + 1.62, p.z);
        if (segSegDist3D(P, P, lo, hi) > hitR) continue;
        killFolk(f, mode, dirX, dirZ);
        killed++;
      }
      const rc = recount();
      vis.dead = rc.dead;
      vis.shown = rc.alive;
      return killed;
    },
    reset() {
      for (const f of folks) {
        f.dead = false; f.deadT = 0; f.corpseLife = 0;
        f.fig.group.visible = true;
        f.fig.group.rotation.x = 0; f.fig.group.rotation.z = 0;
        f.fig.group.scale.setScalar(1);
      }
      vis.dead = 0;
      vis.shown = folks.length;
    },
    update(dt, time) {
      for (const f of folks) {
        if (!f.fig.group.visible) continue;
        if (f.dead) {
          if (f.deathMode !== 'fall') continue;
          f.deadT += dt;
          const k = Math.min(1, f.deadT / 0.5);
          const e = 1 - (1 - k) * (1 - k);
          f.fig.group.rotation.x = f.fallDir * (Math.PI / 2 - 0.07) * e;
          f.fig.group.rotation.z = f.fallRoll * e;
          if (f.deadT > f.corpseLife) {
            const fade = Math.max(0.01, 1 - (f.deadT - f.corpseLife) / 1.2);
            f.fig.group.scale.setScalar(fade);
            if (fade <= 0.01) f.fig.group.visible = false;
          }
          continue;
        }
        if (f.mode === 'walk') {
          f.t += (f.dir * f.speed * dt) / Math.max(1, trailLen);
          if (f.t > 1) { f.t = 1; f.dir = -1; }
          if (f.t < 0) { f.t = 0; f.dir = 1; }
          const p = pointAt(f.t);
          const p2 = pointAt(Math.max(0, Math.min(1, f.t + f.dir * 0.01)));
          f.fig.group.position.set(p.x, heightAt(p.x, p.z) - 0.06, p.z);
          f.fig.group.rotation.y = Math.atan2(p2.x - p.x, p2.z - p.z);
          const step = time * f.speed * 7;
          if (f.fig.legL && f.fig.legR) {
            f.fig.legL.rotation.x = Math.sin(step) * 0.55;
            f.fig.legR.rotation.x = -Math.sin(step) * 0.55;
          }
          // Task 40: руки МАШУТ при ходьбе
          if (f.fig.armL && f.fig.armR) {
            f.fig.armL.rotation.x = -Math.sin(step) * 0.5;
            f.fig.armR.rotation.x = Math.sin(step) * 0.5;
            f.fig.armL.rotation.z = 0.05;
            f.fig.armR.rotation.z = -0.05;
          }
          f.fig.group.position.y += Math.abs(Math.sin(step)) * 0.03;
        } else {
          f.fig.group.rotation.z = Math.sin(time * 1.3 + f.phase) * 0.035;
          f.fig.group.rotation.y = f.face + Math.sin(time * 0.3 + f.phase) * 0.7;
        }
      }
      const rc = recount();
      vis.dead = rc.dead;
      vis.shown = rc.alive;
    },
  };
  return vis;
}
