/* Open Meadow — engine/nature.js
 * Grass, flowers, ferns, reeds and mushrooms. Each chunk's plants are merged
 * into a single static mesh (one draw call per chunk), animated by wind in the
 * vertex shader and shrunk smoothly toward the vegetation distance limit so
 * nothing pops. Also drives the drifting pollen particles. */
(function () {
  'use strict';
  const OM = window.OM;
  const PD = OM.Plants.defs, P = OM.P;

  class PlantBuilder {
    constructor() { this.cap = 8192; this.alloc(); this.v = 0; this.i = 0; }
    alloc(old) {
      const c = this.cap;
      const n = { pos: new Float32Array(c * 3), nor: new Int8Array(c * 3), uv: new Float32Array(c * 2), col: new Uint8Array(c * 3), wind: new Float32Array(c), idx: new Uint32Array(c * 3) };
      if (old) for (const k of Object.keys(n)) n[k].set(old[k]);
      Object.assign(this, n);
    }
    ensure(nv) {
      if (this.v + nv <= this.cap) return;
      const old = { pos: this.pos, nor: this.nor, uv: this.uv, col: this.col, wind: this.wind, idx: this.idx };
      while (this.v + nv > this.cap) this.cap *= 2;
      this.alloc(old);
    }
    vert(x, y, z, u, v, r, g, b, w) {
      const k = this.v++;
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      this.nor[k * 3] = 0; this.nor[k * 3 + 1] = 127; this.nor[k * 3 + 2] = 0;
      this.uv[k * 2] = u; this.uv[k * 2 + 1] = v;
      this.col[k * 3] = r; this.col[k * 3 + 1] = g; this.col[k * 3 + 2] = b;
      this.wind[k] = w;
    }
    quad(b) {
      const I = this.idx;
      // both windings: the sprite is visible from either side with an upward normal
      I[this.i++] = b; I[this.i++] = b + 1; I[this.i++] = b + 2; I[this.i++] = b; I[this.i++] = b + 2; I[this.i++] = b + 3;
      I[this.i++] = b; I[this.i++] = b + 2; I[this.i++] = b + 1; I[this.i++] = b; I[this.i++] = b + 3; I[this.i++] = b + 2;
    }
    result() {
      if (!this.v) return null;
      const v = this.v;
      return {
        pos: this.pos.slice(0, v * 3), nor: this.nor.slice(0, v * 3), uv: this.uv.slice(0, v * 2),
        col: this.col.slice(0, v * 3), wind: this.wind.slice(0, v),
        idx: v < 65536 ? Uint16Array.from(this.idx.subarray(0, this.i)) : this.idx.slice(0, this.i)
      };
    }
  }

  class Nature {
    constructor(world, scene, textures) {
      this.world = world;
      this.scene = scene;
      this.textures = textures;
      this.density = 1;
      this.builder = new PlantBuilder();
      this.tint = [1, 1, 1];
      this.uniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uFadeStart: { value: 40 }, uFadeEnd: { value: 60 } };
      this.material = this.createMaterial();
      this.pollen = this.createPollen();
    }

    createMaterial() {
      const m = new THREE.MeshLambertMaterial({ map: this.textures.plant.texture, alphaTest: 0.42, vertexColors: true });
      const u = this.uniforms;
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aWind;\nuniform float uTime;\nuniform float uWind;\nuniform float uFadeStart;\nuniform float uFadeEnd;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec4 omWp = modelMatrix * vec4(transformed, 1.0);
            float omW = aWind * aWind * uWind;
            float omGust = 0.6 + 0.4 * sin(uTime * 0.45 + omWp.x * 0.045 + omWp.z * 0.03);
            float omWave = sin(uTime * 1.9 + omWp.x * 0.32 + omWp.z * 0.21) + 0.45 * sin(uTime * 3.3 + omWp.x * 0.75 - omWp.z * 0.6);
            transformed.x += omWave * omW * 0.09 * omGust;
            transformed.z += cos(uTime * 1.5 + omWp.z * 0.28 + omWp.x * 0.17) * omW * 0.055 * omGust;
            transformed.y -= smoothstep(uFadeStart, uFadeEnd, distance(omWp.xz, cameraPosition.xz)) * aWind;`);
      };
      m.customProgramCacheKey = () => 'om-plants-v1';
      return m;
    }

    setDistance(chunks) {
      const end = chunks * 16 - 2;
      this.uniforms.uFadeEnd.value = end;
      this.uniforms.uFadeStart.value = Math.max(8, end - 18);
    }

    setDensity(d) {
      this.density = d;
      for (const c of this.world.chunks.values()) if (c.plantsBuilt) this.build(c);
    }

    buildData(c) {
      const g = this.builder;
      g.v = 0; g.i = 0;
      const uvT = this.textures.plant.uv, gen = this.world.gen;
      for (const [i, code] of c.plants) {
        const type = code & 255, d = PD[type];
        if (!d) continue;
        const variant = code >> 8;
        if ((type === P.GRASS || type === P.TALL_GRASS) && variant / 255 > this.density) continue;
        const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
        const wx = c.x0 + lx, wz = c.z0 + lz;
        const L = OM.Plants.layout(code, wx, y, wz);
        const px = L.x - c.x0, pz = L.z - c.z0, h = L.h;
        const w = d.w * (0.85 + ((variant & 15) / 15) * 0.3);
        let tr = 1, tg = 1, tb = 1;
        if (d.tint) { gen.tintAt(wx, wz, this.tint); tr = this.tint[0]; tg = this.tint[1]; tb = this.tint[2]; }
        const covered = c.height[lx + (lz << 4)] > y;
        const bright = (covered ? 0.62 : 1) * (0.9 + ((variant >> 4) / 15) * 0.2) * 255;
        const r = Math.min(255, bright * tr), gg = Math.min(255, bright * tg), b = Math.min(255, bright * tb);
        const t = d.tile, u0 = uvT[t * 4], v0 = uvT[t * 4 + 1], u1 = uvT[t * 4 + 2], v1 = uvT[t * 4 + 3];
        const leanX = (((variant * 37) & 31) / 31 - 0.5) * 0.16, leanZ = (((variant * 91) & 31) / 31 - 0.5) * 0.16;
        const windH = d.wind > 0 ? h * d.wind : 0;
        g.ensure(d.quads * 4);
        for (let q = 0; q < d.quads; q++) {
          const a = L.rot + (q * Math.PI) / d.quads;
          const ca = Math.cos(a) * w * 0.5, sa = Math.sin(a) * w * 0.5;
          const base = g.v;
          g.vert(px - ca, y, pz - sa, u0, v1, r * 0.6, gg * 0.6, b * 0.6, 0);
          g.vert(px + ca, y, pz + sa, u1, v1, r * 0.6, gg * 0.6, b * 0.6, 0);
          g.vert(px + ca + leanX, y + h, pz + sa + leanZ, u1, v0, r, gg, b, windH);
          g.vert(px - ca + leanX, y + h, pz - sa + leanZ, u0, v0, r, gg, b, windH);
          g.quad(base);
        }
      }
      return g.result();
    }

    build(c) {
      const data = this.buildData(c);
      c.meshPlants = this.world.applyMesh(c, c.meshPlants, data, this.material, { receive: true });
      c.plantsBuilt = true;
    }

    remove(c) {
      if (c.meshPlants) { this.scene.remove(c.meshPlants); c.meshPlants.geometry.dispose(); c.meshPlants = null; }
      c.plantsBuilt = false;
    }

    createPollen() {
      const COUNT = 700;
      const pos = new Float32Array(COUNT * 3), seed = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 44; pos[i * 3 + 1] = (Math.random() - 0.5) * 16; pos[i * 3 + 2] = (Math.random() - 0.5) * 44;
        seed[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uOpacity: { value: 1 }, uScale: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.86, 0.5) } },
        vertexShader: POLLEN_VS, fragmentShader: POLLEN_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      this.scene.add(pts);
      return pts;
    }

    update(time, camPos, daylight, underwater, pixelScale) {
      this.uniforms.uTime.value = time;
      const u = this.pollen.material.uniforms;
      u.uTime.value = time;
      u.uCam.value.copy(camPos);
      u.uOpacity.value = daylight * (1 - underwater) * 0.5;
      u.uScale.value = pixelScale;
      this.pollen.visible = u.uOpacity.value > 0.01;
    }
  }

  const POLLEN_VS = /* glsl */`
    attribute float aSeed;
    uniform float uTime;
    uniform vec3 uCam;
    uniform float uScale;
    varying float vAlpha;
    void main() {
      vec3 box = vec3(44.0, 16.0, 44.0);
      vec3 p = position;
      p.x += uTime * 0.45 + sin(uTime * 0.6 + aSeed * 40.0) * 0.8;
      p.y += sin(uTime * 0.7 + aSeed * 23.0) * 0.6 + uTime * 0.05;
      p.z += uTime * 0.18 + cos(uTime * 0.5 + aSeed * 17.0) * 0.8;
      p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      float d = length(p - uCam);
      vAlpha = smoothstep(21.0, 12.0, d) * smoothstep(0.6, 2.0, d) * (0.55 + 0.45 * sin(uTime * 2.0 + aSeed * 60.0));
      gl_PointSize = uScale * (0.7 + aSeed * 0.8) * 20.0 / max(-mv.z, 0.1);
      gl_Position = projectionMatrix * mv;
    }`;
  const POLLEN_FS = /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.08, d);
      gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
    }`;

  OM.Nature = Nature;
})();
