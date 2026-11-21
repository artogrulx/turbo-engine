/* Open Meadow — engine/sky.js
 * Day/night cycle, atmospheric sky dome with sun, moon, stars and drifting
 * clouds, sun/moon directional light with a stabilised shadow camera that
 * follows the player, hemisphere ambient light and distance fog. */
(function () {
  'use strict';
  const OM = window.OM;
  const N = OM.Noise;

  const C = (r, g, b) => new THREE.Color(r, g, b);
  const DAY_Z = C(0.22, 0.47, 0.86), DAY_H = C(0.7, 0.83, 0.96);
  const DUSK_Z = C(0.2, 0.26, 0.5), DUSK_H = C(0.98, 0.6, 0.36);
  const NIGHT_Z = C(0.012, 0.02, 0.06), NIGHT_H = C(0.05, 0.08, 0.15);
  const SUN_LOW = C(1.0, 0.56, 0.3), SUN_HIGH = C(1.0, 0.96, 0.88), MOON = C(0.55, 0.65, 0.9);
  const WATER_TINT = C(0.16, 0.42, 0.5);

  class Sky {
    constructor(scene, opts) {
      opts = opts || {};
      this.scene = scene;
      this.time = opts.time !== undefined ? opts.time : 0.3;
      this.dayLength = 1440; // seconds for a full day
      this.cycle = true;
      this.sunDir = new THREE.Vector3(0, 1, 0);
      this.moonDir = new THREE.Vector3(0, -1, 0);
      this.lightDir = new THREE.Vector3(0, 1, 0);
      this.zenith = new THREE.Color(); this.horizon = new THREE.Color();
      this.fogColor = new THREE.Color(); this.sunColor = new THREE.Color();
      this.daylight = 1; this.golden = 0;
      this.realm = 'meadow';
      this.cloudOffset = new THREE.Vector2(Math.random() * 100, Math.random() * 100);

      this.material = new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
          uFogColor: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
          uDusk: { value: DUSK_H.clone() },
          uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
          uTime: { value: 0 }, uStars: { value: 0 }, uDay: { value: 1 }, uGolden: { value: 0 },
          uUnderwater: { value: 0 }, uCloudCover: { value: 0.5 }, uCloudOffset: { value: new THREE.Vector2() }
        },
        vertexShader: SKY_VS, fragmentShader: SKY_FS,
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
      });
      this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
      this.dome.scale.setScalar(900);
      this.dome.frustumCulled = false;
      this.dome.renderOrder = -100;
      scene.add(this.dome);

      this.sun = new THREE.DirectionalLight(0xffffff, 1);
      this.sun.castShadow = true;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.05;
      const sc = this.sun.shadow.camera;
      sc.near = 1; sc.far = 420;
      scene.add(this.sun);
      scene.add(this.sun.target);
      this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5030, 0.55);
      scene.add(this.hemi);
      scene.fog = new THREE.Fog(0xbfd8ff, 60, 100);
      this.setShadowQuality('high');
      this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._t = new THREE.Vector3();
      this.update(0, new THREE.Vector3(), 0);
    }

    setShadowQuality(q) {
      this.shadowQuality = q;
      const res = q === 'high' ? 2048 : 1024, ext = q === 'high' ? 72 : 46;
      this.sun.castShadow = q !== 'off' && this.realm === 'meadow';
      this.shadowRes = res; this.shadowExtent = ext;
      const s = this.sun.shadow;
      s.mapSize.set(res, res);
      s.camera.left = -ext; s.camera.right = ext; s.camera.top = ext; s.camera.bottom = -ext;
      s.camera.updateProjectionMatrix();
      if (s.map) { s.map.dispose(); s.map = null; }
    }

    /** 'meadow' follows the day cycle; 'ember' and 'end' have fixed skies with no sun, moon or clouds. */
    setRealm(name) {
      this.realm = name || 'meadow';
      this.sun.castShadow = this.realm === 'meadow' && this.shadowQuality !== 'off';
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    realmLook(dt, cam) {
      const R = REALM_LOOK[this.realm];
      this.daylight = R.daylight; this.golden = 0;
      this.zenith.setRGB(R.zenith[0], R.zenith[1], R.zenith[2]); this.horizon.setRGB(R.horizon[0], R.horizon[1], R.horizon[2]);
      this.fogColor.setRGB(R.fog[0], R.fog[1], R.fog[2]); this.sunColor.setRGB(R.light[0], R.light[1], R.light[2]);
      this.sunDir.set(0.2, -1, 0.1).normalize(); this.moonDir.copy(this.sunDir);
      this.lightDir.set(0.35, 1, 0.25).normalize();
      this.sun.color.copy(this.sunColor); this.sun.intensity = R.sun;
      this.hemi.color.setRGB(R.hemi[0], R.hemi[1], R.hemi[2]); this.hemi.groundColor.setRGB(R.ground[0], R.ground[1], R.ground[2]); this.hemi.intensity = R.hemiI;
      this.positionShadow(cam, this.lightDir);
      this.dome.position.copy(cam);
      const u = this.material.uniforms;
      u.uZenith.value.copy(this.zenith); u.uHorizon.value.copy(this.horizon); u.uFogColor.value.copy(this.fogColor); u.uSunColor.value.copy(this.sunColor);
      u.uSunDir.value.copy(this.sunDir); u.uMoonDir.value.copy(this.moonDir);
      u.uTime.value += dt; u.uStars.value = R.stars; u.uDay.value = 0.3; u.uGolden.value = 0; u.uUnderwater.value = 0; u.uCloudCover.value = 3;
    }

    timeString() {
      const h = Math.floor(this.time * 24), m = Math.floor((this.time * 24 - h) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    update(dt, cam, underwater) {
      if (this.cycle) this.time = (this.time + dt / this.dayLength) % 1;
      if (this.realm !== 'meadow') { this.realmLook(dt, cam); return; }
      const ang = (this.time - 0.25) * Math.PI * 2;
      this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.32).normalize();
      this.moonDir.copy(this.sunDir).negate();
      const e = this.sunDir.y;
      const day = N.smoothstep(-0.12, 0.25, e);
      const golden = (1 - N.smoothstep(0.0, 0.3, Math.abs(e + 0.03))) * N.smoothstep(-0.25, -0.02, e) * 0.7 + (1 - N.smoothstep(0.0, 0.3, Math.abs(e))) * 0.3;
      this.daylight = day; this.golden = golden;

      this.zenith.copy(NIGHT_Z).lerp(DAY_Z, day).lerp(DUSK_Z, golden * 0.45);
      this.horizon.copy(NIGHT_H).lerp(DAY_H, day).lerp(DUSK_H, golden * 0.55);
      this.fogColor.copy(this.horizon).lerp(this.zenith, 0.14);
      this.sunColor.copy(SUN_LOW).lerp(SUN_HIGH, N.smoothstep(0.0, 0.35, e));

      const sunUp = e > -0.05;
      this.lightDir.copy(sunUp ? this.sunDir : this.moonDir);
      let si = sunUp ? 1.1 * N.smoothstep(-0.05, 0.2, e) : 0.2 * N.smoothstep(0.0, 0.25, -e);
      this.sun.color.copy(sunUp ? this.sunColor : MOON);
      this.hemi.color.copy(this.zenith).lerp(DAY_H, 0.35).multiplyScalar(0.7 + 0.3 * day);
      this.hemi.groundColor.setRGB(0.34, 0.3, 0.22).multiplyScalar(0.35 + 0.65 * day);
      let hi = 0.34 + 0.28 * day;
      if (underwater > 0) {
        si *= 1 - 0.5 * underwater;
        hi *= 1 - 0.2 * underwater;
        this.hemi.color.lerp(WATER_TINT, underwater * 0.6);
      }
      this.sun.intensity = si;
      this.hemi.intensity = hi;
      this.positionShadow(cam, this.lightDir);

      this.dome.position.copy(cam);
      this.cloudOffset.x += dt * 0.006; this.cloudOffset.y += dt * 0.0025;
      const u = this.material.uniforms;
      u.uZenith.value.copy(this.zenith); u.uHorizon.value.copy(this.horizon);
      u.uFogColor.value.copy(this.fogColor); u.uSunColor.value.copy(this.sunColor);
      u.uSunDir.value.copy(this.sunDir); u.uMoonDir.value.copy(this.moonDir);
      u.uTime.value += dt; u.uStars.value = 1 - N.smoothstep(-0.25, 0.02, e);
      u.uDay.value = day; u.uGolden.value = golden; u.uUnderwater.value = underwater;
      u.uCloudOffset.value.copy(this.cloudOffset);
    }

    /** Keeps the shadow frustum centred on the camera, snapped to shadow-map
     *  texels so shadows do not shimmer while walking. */
    positionShadow(cam, dir) {
      const texel = (2 * this.shadowExtent) / this.shadowRes;
      const up = Math.abs(dir.y) > 0.995 ? this._u.set(1, 0, 0) : this._u.set(0, 1, 0);
      const right = this._r.crossVectors(up, dir).normalize();
      const upv = this._u.crossVectors(dir, right).normalize();
      const px = cam.dot(right), py = cam.dot(upv), pz = cam.dot(dir);
      const t = this._t.copy(right).multiplyScalar(Math.round(px / texel) * texel)
        .addScaledVector(upv, Math.round(py / texel) * texel).addScaledVector(dir, pz);
      this.sun.target.position.copy(t);
      this.sun.position.copy(t).addScaledVector(dir, 200);
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();
    }
  }

  const REALM_LOOK = {
    ember: { zenith: [0.22, 0.05, 0.03], horizon: [0.5, 0.13, 0.05], fog: [0.32, 0.08, 0.04], light: [1.0, 0.58, 0.32], sun: 0.55, hemi: [1.0, 0.56, 0.36], ground: [0.5, 0.18, 0.08], hemiI: 0.9, stars: 0, daylight: 0.5 },
    end: { zenith: [0.02, 0.0, 0.07], horizon: [0.1, 0.03, 0.18], fog: [0.05, 0.02, 0.1], light: [0.72, 0.62, 1.0], sun: 0.5, hemi: [0.6, 0.52, 0.98], ground: [0.22, 0.16, 0.36], hemiI: 0.75, stars: 1, daylight: 0.45 }
  };

  const SKY_VS = /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

  const SKY_FS = /* glsl */`
    uniform vec3 uZenith, uHorizon, uFogColor, uSunColor, uDusk, uSunDir, uMoonDir;
    uniform float uTime, uStars, uDay, uGolden, uUnderwater, uCloudCover;
    uniform vec2 uCloudOffset;
    varying vec3 vDir;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(13.1, 7.7); a *= 0.5; } return s; }
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y, hz = clamp(h, 0.0, 1.0);
      vec3 col = mix(uHorizon, uZenith, pow(hz, 0.5));
      vec2 sxz = normalize(uSunDir.xz + 1e-5);
      float toward = pow(max(dot(normalize(d.xz + 1e-5), sxz), 0.0), 3.0);
      col = mix(col, uDusk, uGolden * toward * (1.0 - hz) * 0.8);
      col = mix(col, uFogColor * 0.85, smoothstep(0.0, -0.2, h));
      float sd = max(dot(d, uSunDir), 0.0);
      float sunVis = smoothstep(-0.08, 0.02, uSunDir.y);
      col += uSunColor * (pow(sd, 8.0) * 0.2 + pow(sd, 90.0) * 0.45) * sunVis;
      col += uSunColor * smoothstep(0.99935, 0.99965, sd) * 5.0 * sunVis * step(-0.02, h);
      float md = max(dot(d, uMoonDir), 0.0);
      float moonVis = smoothstep(-0.05, 0.1, uMoonDir.y);
      col += vec3(0.82, 0.88, 1.0) * smoothstep(0.99955, 0.9998, md) * 1.6 * moonVis + vec3(0.16, 0.2, 0.3) * pow(md, 40.0) * moonVis;
      if (uStars > 0.01 && h > 0.0) {
        vec2 sp = d.xz / (d.y + 1.0) * 160.0;
        vec2 cell = floor(sp);
        float r = hash(cell);
        if (r > 0.982) {
          vec2 c = fract(sp) - 0.5;
          float tw = 0.6 + 0.4 * sin(uTime * 2.5 + r * 400.0);
          col += vec3(smoothstep(0.12, 0.0, length(c)) * tw * uStars * smoothstep(0.0, 0.25, h));
        }
      }
      if (h > 0.0) {
        vec2 cp = d.xz / (h + 0.08) * 1.25 + uCloudOffset;
        float n = fbm(cp * 0.75);
        float cov = smoothstep(uCloudCover, uCloudCover + 0.22, n);
        float n2 = fbm(cp * 0.75 + uSunDir.xz * 0.07);
        float lit = clamp(0.65 - (n2 - n) * 5.0, 0.0, 1.0);
        vec3 bright = mix(vec3(1.0), vec3(1.0, 0.7, 0.52), uGolden) * (0.12 + 0.88 * uDay);
        vec3 cloud = mix(bright * vec3(0.62, 0.66, 0.74), bright, lit);
        col = mix(col, cloud, cov * smoothstep(0.0, 0.16, h) * 0.9);
      }
      col = mix(col, uFogColor, (1.0 - smoothstep(0.0, 0.14, abs(h))) * 0.5);
      col = mix(col, uFogColor, uUnderwater);
      gl_FragColor = vec4(col, 1.0);
    }`;

  OM.Sky = Sky;
})();
