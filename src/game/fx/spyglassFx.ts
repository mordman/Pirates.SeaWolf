import * as THREE from 'three';

// ============================================================
// Task 77: ВЗГЛЯД СКВОЗЬ СТЕКЛО — пост-процесс подзорной трубы.
// Сцена рендерится в WebGLRenderTarget, поверх — полноэкранный
// quad с шейдером «старой оптики XVII века»: ЖИВОЕ ЗЕРНО стекла,
// статичные пылинки и царапины на линзах, разводы выдувного
// стекла, хроматическая аберрация к краям, лёгкая бочка, тёплая
// патина латуни у кромки, круговая маска окуляра. uBlend 0..1 —
// плавный вход/выход (синхронен поднятию трубы капитаном).
// ============================================================

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);   // полноэкранный quad без матриц
  }
`;

const QUAD_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uScene;   // отрендеренная сцена (render target)
  uniform vec2  uRes;         // размер буфера, пиксели
  uniform float uTime;        // время, сек (зерно «живёт»)
  uniform float uBlend;       // 0 — эффекта нет, 1 — полный «взгляд в трубу»
  uniform float uSeed;        // случайный сдвиг пыли/царапин (на сессию)

  // --- хэш и value-noise ---
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float blend = clamp(uBlend, 0.0, 1.0);
    vec2 uv = vUv;

    // (1) радиус от центра с поправкой на аспект — поле зрения КРУГЛОЕ
    vec2 c = uv - 0.5;
    c.x *= uRes.x / uRes.y;
    float r = length(c) * 2.0;               // 0 — центр, 1 — кромка поля

    // (2) бочкообразная дисторсия выпуклой линзы объектива
    float k = 0.065 * blend;
    vec2 duv = 0.5 + (uv - 0.5) * (1.0 + k * r * r);

    // (3) хроматическая аберрация: RGB расходится радиально к краям
    vec2 dir = r > 1e-5 ? normalize(c) : vec2(0.0);
    float ca = 0.0032 * blend * r * r;
    vec3 col;
    col.r = texture2D(uScene, duv + dir * ca).r;
    col.g = texture2D(uScene, duv).g;
    col.b = texture2D(uScene, duv - dir * ca).b;

    // (4) мутность выдувного стекла: два слоя низкочастотного шума
    float mottle = noise2(uv * 3.5 + uSeed) * 0.5
                 + noise2(uv * 9.0 - uSeed * 1.7) * 0.5;
    col *= 1.0 - (mottle - 0.5) * 0.10 * blend;

    // (5) ПЫЛИНКИ на линзе: редкие статичные точки (сетка хэша)
    vec2 gp = uv * 22.0 + uSeed * 7.0;
    vec2 cell = floor(gp);
    float h = hash21(cell);
    if (h > 0.965) {                          // ~3.5% ячеек с пылинкой
      vec2 jitter = vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5;
      vec2 lp = fract(gp) - 0.5 - jitter * 0.6;
      float dust = smoothstep(0.16, 0.0, length(lp));
      col += dust * 0.10 * blend;             // светлый блик пылинки
      col -= dust * 0.04 * blend;             // и лёгкая тень вокруг
    }

    // (6) тонкие ЦАРАПИНЫ: анизотропный шум, читаются у края поля
    float scratch = noise2(vec2(uv.x * 140.0, uv.y * 4.0 + uSeed));
    col += (scratch - 0.5) * 0.016 * blend * smoothstep(0.15, 0.85, r);

    // (7) ЖИВОЕ ЗЕРНО — «шум стекла», анимирован временем
    float g = hash21(uv * uRes + fract(uTime) * vec2(147.0, 211.0)) - 0.5;
    col += g * 0.085 * blend;

    // (8) многолинзовая оптика чуть собирает свет в центре
    col *= 1.0 + 0.05 * blend * (1.0 - r * r * 0.5);

    // (9) зеленоватый отлив старого стекла к краям поля
    col = mix(col, col * vec3(0.82, 1.0, 0.90), r * 0.45 * blend);

    // (10) внутреннее отражение: тонкое светлое кольцо у кромки
    float ring = smoothstep(0.030, 0.0, abs(r - 0.86));
    col += ring * 0.05 * blend * vec3(0.7, 0.85, 0.8);

    // (11) круговая МАСКА окуляра: вне поля — тёмный корпус трубы
    float mask = smoothstep(0.985, 0.80, r);
    col *= mix(1.0, mask, blend);
    vec3 barrel = vec3(0.012, 0.014, 0.016) * (0.6 + 0.4 * noise2(uv * 40.0));
    col = mix(col, barrel, (1.0 - mask) * blend);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Пост-процесс трубы. blend двигает game (сглаживание к 0/1),
 *  render() делает два прохода вместо прямого renderer.render */
export class SpyglassFX {
  private rt: THREE.WebGLRenderTarget | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private uniforms: {
    uScene: { value: THREE.Texture | null };
    uRes: { value: THREE.Vector2 };
    uTime: { value: number };
    uBlend: { value: number };
    uSeed: { value: number };
  };
  /** 0..1 — сила эффекта (сглаживается снаружи) */
  blend = 0;

  constructor() {
    this.uniforms = {
      uScene: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uBlend: { value: 0 },
      uSeed: { value: Math.random() * 100 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** пересоздать/изменить target под размер буфера */
  resize(w: number, h: number, isWebGL2: boolean) {
    const W = Math.max(2, Math.round(w));
    const H = Math.max(2, Math.round(h));
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(W, H, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      // MSAA внутри target (WebGL2) — сглаживание как на прямом рендере
      if (isWebGL2) this.rt.samples = 4;
    } else {
      this.rt.setSize(W, H);
    }
    this.uniforms.uScene.value = this.rt.texture;
    this.uniforms.uRes.value.set(W, H);
  }

  /** телеметрия e2e: размер target и живое зерно (uTime растёт) */
  info() {
    return {
      rt: !!this.rt,
      w: this.rt?.width ?? 0,
      h: this.rt?.height ?? 0,
      uTime: +this.uniforms.uTime.value.toFixed(3),
      uBlend: +this.uniforms.uBlend.value.toFixed(3),
      blend: +this.blend.toFixed(3),
    };
  }

  get active() { return this.blend > 0.004; }

  /** шаг СИМУЛЯЦИИ: зерно живёт и без рендера (e2e/headless) —
   *  uniform-ы обновляются здесь, render() только рисует */
  tick(dt: number) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uBlend.value = this.blend;
  }

  /** два прохода: сцена → target, quad с эффектом → экран */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.rt) return;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.rt?.dispose();
    this.rt = null;
  }
}
