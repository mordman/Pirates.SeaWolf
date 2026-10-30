import * as THREE from 'three';

// ============================================================
// Гибы: куски тел, разорванных ядрами. Пул на InstancedMesh —
// полёт с гравитацией, кувырок, затухание масштабом в конце.
// Живут в МИРОВЫХ координатах (в worldGroup, как частицы).
// ============================================================

interface Gib {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;   // рад/с кувыркания
  rot: THREE.Euler;
  size: THREE.Vector3;   // габариты куска, м
  life: number;
  life0: number;
}

const MAX_GIBS = 72;

export class GibPool {
  mesh: THREE.InstancedMesh;
  private pool: Gib[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  alive = 0;

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_GIBS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // цвет по умолчанию (перекрывается instanceColor)
    for (let i = 0; i < MAX_GIBS; i++) {
      this.pool.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        spin: new THREE.Vector3(), rot: new THREE.Euler(),
        size: new THREE.Vector3(1, 1, 1), life: 0, life0: 1,
      });
    }
  }

  addTo(parent: THREE.Object3D) { parent.add(this.mesh); }

  /** Один кусок: pos/vel мировые, size в метрах, hex — цвет */
  spawnPart(pos: THREE.Vector3, vel: THREE.Vector3, sx: number, sy: number, sz: number, hex: number, life = 1.8) {
    const g = this.pool.find(q => !q.active);
    if (!g) return;
    g.active = true;
    g.pos.copy(pos);
    g.vel.copy(vel);
    g.size.set(sx, sy, sz);
    g.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    g.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    g.life = life;
    g.life0 = life;
    const i = this.pool.indexOf(g);
    this.color.setHex(hex);
    this.mesh.setColorAt(i, this.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    let count = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const g = this.pool[i];
      if (!g.active) continue;
      g.life -= dt;
      if (g.life <= 0) { g.active = false; continue; }
      g.vel.y -= 9.81 * dt;
      g.vel.multiplyScalar(Math.max(0, 1 - 0.35 * dt)); // сопротивление воздуха
      g.pos.addScaledVector(g.vel, dt);
      g.rot.x += g.spin.x * dt;
      g.rot.y += g.spin.y * dt;
      g.rot.z += g.spin.z * dt;
      // затухание в последнюю четверть жизни
      const k = Math.min(1, g.life / (g.life0 * 0.25));
      this.dummy.position.copy(g.pos);
      this.dummy.rotation.copy(g.rot);
      this.dummy.scale.set(g.size.x * k, g.size.y * k, g.size.z * k);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = count;
  }
}
