import * as THREE from 'three';
import { gerstnerGLSL, SEA, waterHeightAt } from './waves';

const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

interface OceanUniforms {
  [k: string]: THREE.IUniform;
}

export class Water {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;
  private detail: THREE.Mesh;
  private far: THREE.Mesh;
  private cam = new THREE.Vector3();
  uniforms: OceanUniforms;

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uAmp: { value: SEA.amplitude },
      uShift: { value: new THREE.Vector3() },   // floating origin
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyColor: { value: new THREE.Color(0.45, 0.68, 0.78) },
      uHorizonColor: { value: new THREE.Color(0.75, 0.85, 0.88) },
      uDeepColor: { value: new THREE.Color(0.015, 0.12, 0.16) },
      uShallowColor: { value: new THREE.Color(0.06, 0.38, 0.42) },
      uFogColor: { value: new THREE.Color(0.72, 0.82, 0.86) },
      uFogDensity: { value: 0.00035 },
      uFoamTex: { value: null },
    };

    // Процедурная текстура пены
    this.uniforms.uFoamTex.value = makeFoamTexture();

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vWorldPos;
        varying vec3 vScenePos;
        varying vec3 vNormal;
        varying float vDist;
        varying float vFoamWave;
        varying vec2 vWorldXZ;
        ${gerstnerGLSL()}
        uniform vec3 uShift; // = -worldGroup.position (сцена -> мир)
        void main() {
          vec3 sceneP = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 worldXZ = sceneP.xz + uShift.xz; // мировые координаты вершины
          float d = length(sceneP.xz - cameraPosition.xz);
          float farFade = 1.0 - smoothstep(700.0, 2600.0, d);
          vec3 disp; vec3 nrm;
          gerstner(worldXZ, uAmp * farFade, disp, nrm);
          vec3 p = sceneP + disp;
          vNormal = nrm;
          vScenePos = p;
          vWorldPos = vec3(worldXZ.x + disp.x, disp.y, worldXZ.y + disp.z);
          vWorldXZ = worldXZ + disp.xz;
          vDist = d;
          vFoamWave = farFade;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vWorldPos;
        varying vec3 vScenePos;
        varying vec3 vNormal;
        varying float vDist;
        varying float vFoamWave;
        varying vec2 vWorldXZ;
        uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizonColor, uDeepColor, uShallowColor, uFogColor;
        uniform float uTime, uFogDensity;
        uniform sampler2D uFoamTex;
        ${NOISE_GLSL}

        void main() {
          vec3 N = normalize(vNormal);
          // мелкая деталь-нормаль (рябь)
          vec2 uv = vWorldXZ * 0.35 + vec2(uTime * 0.25, uTime * -0.18);
          float n1 = fbm(uv);
          float n2 = fbm(uv * 2.7 + 13.7 + vec2(uTime * 0.4, uTime * 0.31));
          N = normalize(N + vec3((n1 - 0.5) * 0.35, 0.0, (n2 - 0.5) * 0.35));

          vec3 V = normalize(cameraPosition - vScenePos);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

          // цвет воды: глубина -> мелководье (по нормали X/Z — у берега упрощённо по шуму)
          float depthMix = clamp(1.0 - fres * 1.2, 0.0, 1.0);
          vec3 waterCol = mix(uShallowColor, uDeepColor, depthMix);
          vec3 skyRef = mix(uSkyColor, uHorizonColor, 0.35);
          vec3 col = mix(waterCol, skyRef, fres * 0.75);

          // солнечный блик
          vec3 R = reflect(-V, N);
          float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0);
          float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 24.0) * 0.25;
          col += uSunColor * (spec * 1.4 + glint);

          // пена только на высоких гребнях
          float crest = smoothstep(0.94, 1.3, vWorldPos.y * 0.42 + 0.5) * vFoamWave;
          float foamNoise = fbm(vWorldXZ * 0.55 + uTime * 0.35);
          float crestFoam = smoothstep(0.72, 0.98, crest * 0.8 + foamNoise * 0.32);
          col = mix(col, vec3(0.92, 0.96, 0.97), crestFoam * 0.75);

          // мерцающая текстура пены поверх
          float ft = texture2D(uFoamTex, vWorldXZ * 0.09 + vec2(uTime * 0.02, uTime * -0.015)).r;
          float ft2 = texture2D(uFoamTex, vWorldXZ * 0.045 - vec2(uTime * 0.014, uTime * 0.02)).r;
          float fmix = smoothstep(0.62, 1.0, ft * 0.6 + ft2 * 0.6) * 0.16 * vFoamWave;
          col = mix(col, vec3(0.9, 0.95, 0.96), fmix);

          // туман
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
          col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

          gl_FragColor = vec4(col, 0.94);
        }
      `,
      transparent: true,
    });
    this.material = mat;

    // Детальный план: 700x700м, сетка следует за камерой с шагом сетки
    const dg = new THREE.PlaneGeometry(700, 700, 160, 160);
    dg.rotateX(-Math.PI / 2);
    this.detail = new THREE.Mesh(dg, mat);
    this.detail.frustumCulled = false;
    this.detail.renderOrder = 1;
    this.group.add(this.detail);

    // Дальняя вода: до горизонта
    const fg = new THREE.PlaneGeometry(9000, 9000, 90, 90);
    fg.rotateX(-Math.PI / 2);
    // приподнять середину нельзя — просто мелкая сетка, амплитуда гасится шейдером
    this.far = new THREE.Mesh(fg, mat);
    this.far.frustumCulled = false;
    this.far.renderOrder = 0;
    this.group.add(this.far);
  }

  setEnvironment(sunDir: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, horizon: THREE.Color, fogColor: THREE.Color, fogDensity: number) {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    (this.uniforms.uSkyColor.value as THREE.Color).copy(sky);
    (this.uniforms.uHorizonColor.value as THREE.Color).copy(horizon);
    (this.uniforms.uFogColor.value as THREE.Color).copy(fogColor);
    this.uniforms.uFogDensity.value = fogDensity;
  }

  /** worldShift = -worldGroup.position: перевод координат сцены в мировые */
  update(time: number, camScenePos: THREE.Vector3, worldShift: THREE.Vector3) {
    this.uniforms.uTime.value = time;
    this.uniforms.uAmp.value = SEA.amplitude;
    (this.uniforms.uShift.value as THREE.Vector3).copy(worldShift);
    this.cam.copy(camScenePos);
    // снапим к шагу сетки, чтобы вершины не «плыли»
    const step = 700 / 160;
    const sx = Math.round(camScenePos.x / step) * step;
    const sz = Math.round(camScenePos.z / step) * step;
    this.detail.position.set(sx, 0, sz);
    this.far.position.set(Math.round(camScenePos.x / 100) * 100, 0, Math.round(camScenePos.z / 100) * 100);
  }

  heightAt(x: number, z: number, t: number) {
    return waterHeightAt(x, z, t);
  }
}

/** Текстура пены: тайлящийся шум */
function makeFoamTexture(): THREE.Texture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const rnd = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const grid = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0, amp = 0.5, f = 4;
      for (let o = 0; o < 4; o++) {
        s += amp * grid((x / S) * f, (y / S) * f);
        amp *= 0.5; f *= 2;
      }
      const v = Math.floor(s * 255);
      const i = (y * S + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
