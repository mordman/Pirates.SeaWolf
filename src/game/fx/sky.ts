import * as THREE from 'three';
import { clamp, smoothstep } from '../core/rng';

// ============================================================
// Небо: купол с градиентом/облаками/звёздами, солнце и луна,
// день/ночь, туман. Управляет направленным светом сцены.
// ============================================================

export class SkySystem {
  dome: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  moon: THREE.DirectionalLight;

  timeOfDay = 0.34;   // 0..1: 0=полночь, 0.5=полдень
  dayLength = 480;    // сек на полные сутки

  sunDir = new THREE.Vector3(0.4, 0.7, 0.35);
  private uniforms;

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uTime: { value: 0 },
      uCloud: { value: 0.4 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform vec3 uSunDir;
        uniform float uTime, uCloud;
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.13; a*=0.5; } return s; }

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          float sunH = uSunDir.y;

          // палитры по высоте солнца
          vec3 dayZen = vec3(0.22, 0.45, 0.72);
          vec3 dayHor = vec3(0.72, 0.83, 0.88);
          vec3 setZen = vec3(0.16, 0.16, 0.34);
          vec3 setHor = vec3(0.98, 0.55, 0.26);
          vec3 nightZen = vec3(0.012, 0.02, 0.05);
          vec3 nightHor = vec3(0.04, 0.06, 0.12);

          vec3 zen = dayZen, hor = dayHor;
          float dayF = smoothstep(0.02, 0.32, sunH);
          float setF = smoothstep(0.28, 0.0, abs(sunH)) * smoothstep(-0.18, 0.05, sunH);
          zen = mix(nightZen, zen, dayF); hor = mix(nightHor, hor, dayF);
          zen = mix(zen, setZen, setF * 0.8); hor = mix(hor, setHor, setF * 0.9);

          vec3 col = mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.62));

          // звёзды ночью
          float night = smoothstep(0.05, -0.12, sunH);
          if (night > 0.01) {
            vec2 sp = d.xz / max(d.y, 0.08) * 24.0;
            float star = step(0.9975, hash12(floor(sp)));
            float tw = 0.6 + 0.4 * sin(uTime * 3.0 + hash12(floor(sp) + 7.7) * 20.0);
            col += vec3(0.9, 0.95, 1.0) * star * tw * night * smoothstep(0.02, 0.25, d.y);
          }

          // облака (проекция на купол)
          vec2 cuv = d.xz / max(d.y, 0.09);
          float cl = fbm(cuv * 1.35 + vec2(uTime * 0.008, uTime * 0.004));
          float clM = smoothstep(0.52 - uCloud * 0.2, 0.78, cl) * smoothstep(0.0, 0.16, d.y);
          vec3 cloudCol = mix(hor * 1.06, vec3(1.02, 0.99, 0.96), dayF * 0.85);
          cloudCol = mix(cloudCol * 0.55, cloudCol, dayF);
          // подсветка облаков закатом
          cloudCol = mix(cloudCol, vec3(1.0, 0.62, 0.38), setF * 0.65);
          col = mix(col, cloudCol, clM * 0.88);

          // солнце
          float sd = dot(d, normalize(uSunDir));
          float disc = smoothstep(0.9993, 0.9997, sd);
          float glow = pow(max(sd, 0.0), 90.0) * 0.35 + pow(max(sd, 0.0), 8.0) * 0.12;
          col += vec3(1.0, 0.9, 0.72) * (disc * 2.4 + glow) * smoothstep(-0.06, 0.12, sunH);

          // луна (противоположно солнцу)
          vec3 md = -normalize(uSunDir);
          float mdot = dot(d, md);
          float mdisc = smoothstep(0.9994, 0.9998, mdot);
          col += vec3(0.82, 0.87, 0.95) * (mdisc * 1.4 + pow(max(mdot, 0.0), 120.0) * 0.2) * night;

          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(6500, 32, 20), mat);
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -120; cam.right = 120; cam.top = 120; cam.bottom = -120;
    cam.near = 10; cam.far = 900;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8e8, 0x3d4a3a, 0.9);
    scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x9db4d6, 0.0);
    scene.add(this.moon);
  }

  update(dt: number, time: number, camPos: THREE.Vector3, playerPos: THREE.Vector3, cloudiness: number) {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const th = (this.timeOfDay - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(th), Math.sin(th) * 0.92 + 0.03, 0.35).normalize();
    this.uniforms.uTime.value = time;
    this.uniforms.uCloud.value = cloudiness;

    this.dome.position.copy(camPos);

    // свет
    const dayF = smoothstep(-0.05, 0.25, this.sunDir.y);
    const duskF = smoothstep(0.30, 0.0, Math.abs(this.sunDir.y)) * smoothstep(-0.15, 0.1, this.sunDir.y);
    this.sun.intensity = 2.8 * dayF;
    this.sun.color.setRGB(1, 0.94 - duskF * 0.25, 0.85 - duskF * 0.45);
    this.sun.position.copy(playerPos).addScaledVector(this.sunDir, 400);
    this.sun.target.position.copy(playerPos);

    this.moon.intensity = 0.35 * (1 - dayF);
    this.moon.position.copy(playerPos).addScaledVector(this.sunDir, -400);

    this.hemi.intensity = 0.25 + 0.75 * dayF;
    this.hemi.color.setRGB(0.62 + 0.15 * dayF, 0.72 + 0.12 * dayF, 0.82);
    return { dayF, duskF };
  }

  /** Цвета для воды/тумана */
  environmentColors(dayF: number, duskF: number) {
    const c = new THREE.Color();
    const sky = c.setRGB(
      0.30 + 0.2 * dayF - duskF * 0.1,
      0.48 + 0.16 * dayF - duskF * 0.08,
      0.65 + 0.12 * dayF,
    ).clone();
    const horizon = new THREE.Color().setRGB(
      0.72 - duskF * 0.0 + (1 - dayF) * -0.35 + duskF * 0.25,
      0.80 - (1 - dayF) * 0.35 - duskF * 0.22,
      0.86 - (1 - dayF) * 0.35 - duskF * 0.42,
    );
    const fog = horizon.clone().lerp(sky, 0.35);
    const sun = new THREE.Color(1.0, 0.92 - duskF * 0.2, 0.78 - duskF * 0.35).multiplyScalar(clamp(dayF + duskF * 0.6, 0.15, 1));
    return { sky, horizon, fog, sun };
  }
}
