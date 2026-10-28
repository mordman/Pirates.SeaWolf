import * as THREE from 'three';

// ============================================================
// Частицы: брызги, дым, всплески, огонь, кровь — пул на Points
// ============================================================
export type PKind = 0 | 1 | 2 | 3; // 0=брызги, 1=дым, 2=огонь, 3=кровь

export class Particles {
  points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;    // осталось, сек
  private life0: Float32Array;
  private size: Float32Array;
  private size0: Float32Array;
  private kind: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private aPos: THREE.BufferAttribute;
  private aLife: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aKind: THREE.BufferAttribute;
  private cursor = 0;
  private alive = 0;

  constructor(max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aLife = new THREE.BufferAttribute(this.life, 1);
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aKind = new THREE.BufferAttribute(this.kind, 1);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aLifeFrac', this.aLife);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aKind', this.aKind);
    g.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeSpriteTexture() } },
      vertexShader: /* glsl */`
        attribute float aLifeFrac;
        attribute float aSize;
        attribute float aKind;
        varying float vLife;
        varying float vKind;
        void main() {
          vLife = aLifeFrac;
          vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // дым растёт со временем, брызги/кровь сжимаются
          float grow = aKind < 0.5 ? mix(1.6, 0.6, aLifeFrac)
                    : aKind < 2.5 ? mix(0.5, 2.2, aLifeFrac)
                    : mix(1.5, 0.45, aLifeFrac);
          gl_PointSize = aSize * grow * 320.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex;
        varying float vLife;
        varying float vKind;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          float a = t.a * vLife;
          vec3 col = vec3(1.0);
          if (vKind < 0.5) col = vec3(0.95, 0.98, 1.0);          // брызги
          else if (vKind < 1.5) col = mix(vec3(0.25, 0.25, 0.27), vec3(0.75), t.r * 0.5); // дым
          else if (vKind < 2.5) col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.95, 0.6), t.r); // огонь
          else col = mix(vec3(0.34, 0.015, 0.01), vec3(0.62, 0.07, 0.03), t.r); // кровь
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    lifetime: number, size: number, kind: PKind, drag = 0.5, gravity = 9.81) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = lifetime; this.life0[i] = lifetime;
    this.size[i] = size; this.size0[i] = size;
    this.kind[i] = kind;
    this.drag[i] = drag; this.grav[i] = gravity;
    this.alive = Math.min(this.alive + 1, this.max);
  }

  /** Всплеск воды: корона + брызги */
  splash(x: number, y: number, z: number, power = 1) {
    const n = Math.floor(6 + power * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.2 * power;
      this.spawn(x, y + 0.2, z,
        Math.cos(a) * r, 3 + Math.random() * 5 * power, Math.sin(a) * r,
        0.6 + Math.random() * 0.5, 0.35 + Math.random() * 0.4, 0, 0.4, 12);
    }
  }

  /** Дым (выстрел/пожар) */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size = 2.2, lifetime = 2.6) {
    this.spawn(x, y, z, vx, vy, vz, lifetime, size, 1, 1.6, -0.6);
  }

  fire(x: number, y: number, z: number) {
    this.spawn(x, y, z, (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6,
      0.5 + Math.random() * 0.4, 0.8 + Math.random() * 1.2, 2, 0.8, -2.0);
  }

  /** Кровь: веер тёмно-красных капель (n — количество, power — разлёт) */
  blood(x: number, y: number, z: number, vx: number, vy: number, vz: number, n = 10, power = 1) {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y + 0.5 + Math.random() * 0.9, z,
        vx + (Math.random() - 0.5) * 5 * power,
        vy + 0.5 + Math.random() * 3.5 * power,
        vz + (Math.random() - 0.5) * 5 * power,
        0.5 + Math.random() * 0.45, 0.28 + Math.random() * 0.3, 3, 0.7, 11);
    }
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.alive; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.aLife.array[i] = 0; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.kind[i] === 0 && this.pos[i3 + 1] < 0.05) { // брызги падают в воду
        this.pos[i3 + 1] = 0.02;
        this.vel[i3] *= 0.3; this.vel[i3 + 1] = 0; this.vel[i3 + 2] *= 0.3;
        this.life[i] = Math.min(this.life[i], 0.25);
      }
      this.aLife.array[i] = this.life[i] / this.life0[i];
    }
    if (any) {
      this.aPos.needsUpdate = true;
      this.aLife.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aKind.needsUpdate = true;
      this.points.geometry.setDrawRange(0, this.alive);
    }
  }
}

function makeSpriteTexture(): THREE.Texture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
