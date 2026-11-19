/* Open Meadow — engine/wildlife.js
 * Butterflies and bees, each species rendered as one InstancedMesh with
 * wing flapping done on the GPU. Every insect runs its own small state
 * machine: butterflies flutter erratically from flower to flower, settle and
 * slowly fan their wings, and scatter when you get close; bees dart quickly
 * between nearby blooms, hover with jitter while feeding, sometimes cross
 * to another patch and occasionally inspect the player. They prefer flowers
 * whose colour suits their species and go to rest at dusk. */
(function () {
  'use strict';
  const OM = window.OM;

  const SPECIES = [
    { name: 'Monarch', a: [0.95, 0.5, 0.08], b: [0.07, 0.05, 0.04], likes: [240, 120, 32] },
    { name: 'Cabbage White', a: [0.96, 0.96, 0.9], b: [0.25, 0.25, 0.25], likes: [248, 248, 240] },
    { name: 'Common Blue', a: [0.32, 0.56, 0.96], b: [0.08, 0.1, 0.22], likes: [72, 104, 222] },
    { name: 'Brimstone', a: [0.98, 0.9, 0.32], b: [0.72, 0.55, 0.16], likes: [250, 206, 40] },
    { name: 'Peacock', a: [0.66, 0.14, 0.12], b: [0.14, 0.24, 0.56], likes: [172, 94, 212] },
    { name: 'Swallowtail', a: [0.98, 0.88, 0.56], b: [0.08, 0.08, 0.08], likes: [214, 38, 34] }
  ];
  const MAX_BUTTERFLIES = 30, MAX_BEES = 36;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // --------------------------------------------------------------- geometry
  function butterflyGeometry() {
    const pos = [], uv = [], wing = [], idx = [];
    const quad = (pts, uvs, w) => {
      const b = pos.length / 3;
      for (let k = 0; k < 4; k++) { pos.push(...pts[k]); uv.push(...uvs[k]); wing.push(w); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    quad([[0, 0, 0.5], [1, 0, 0.5], [1, 0, -0.5], [0, 0, -0.5]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
    quad([[0, 0, -0.5], [-1, 0, -0.5], [-1, 0, 0.5], [0, 0, 0.5]], [[0, 1], [1, 1], [1, 0], [0, 0]], -1);
    quad([[-0.06, 0, -0.38], [0.06, 0, -0.38], [0.06, 0, 0.42], [-0.06, 0, 0.42]], [[-1, -1], [-1, -1], [-1, -1], [-1, -1]], 0);
    quad([[0, -0.06, -0.38], [0, 0.06, -0.38], [0, 0.06, 0.42], [0, -0.06, 0.42]], [[-1, -1], [-1, -1], [-1, -1], [-1, -1]], 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    g.setIndex(idx);
    return g;
  }
  function beeGeometry() {
    const pos = [], uv = [], wing = [], idx = [];
    const quad = (pts, uvs, w) => {
      const b = pos.length / 3;
      for (let k = 0; k < 4; k++) { pos.push(...pts[k]); uv.push(...uvs[k]); wing.push(w); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const X = 0.34, Y = 0.3, Z = 0.55, body = [[-1, -1], [-1, -1], [-1, -1], [-1, -1]];
    quad([[-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z]], body, 0);
    quad([[X, -Y, -Z], [-X, -Y, -Z], [-X, Y, -Z], [X, Y, -Z]], body, 0);
    quad([[X, -Y, Z], [X, -Y, -Z], [X, Y, -Z], [X, Y, Z]], body, 0);
    quad([[-X, -Y, -Z], [-X, -Y, Z], [-X, Y, Z], [-X, Y, -Z]], body, 0);
    quad([[-X, Y, Z], [X, Y, Z], [X, Y, -Z], [-X, Y, -Z]], body, 0);
    quad([[-X, -Y, -Z], [X, -Y, -Z], [X, -Y, Z], [-X, -Y, Z]], body, 0);
    quad([[0.1, Y, 0.35], [1.05, Y, 0.35], [1.05, Y, -0.35], [0.1, Y, -0.35]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
    quad([[-0.1, Y, -0.35], [-1.05, Y, -0.35], [-1.05, Y, 0.35], [-0.1, Y, 0.35]], [[0, 1], [1, 1], [1, 0], [0, 0]], -1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    g.setIndex(idx);
    return g;
  }

  function insectMaterial(wingTex, mode) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uWing: { value: wingTex }, uMode: { value: mode }, uLight: { value: 1 },
        uFogColor: { value: new THREE.Color() }, uFogNear: { value: 40 }, uFogFar: { value: 90 }
      },
      vertexShader: INSECT_VS, fragmentShader: INSECT_FS, side: THREE.DoubleSide
    });
  }

  class Wildlife {
    constructor(world, scene, textures) {
      this.world = world;
      this.flowers = [];
      this.flowerTimer = 0;
      this.time = 0;
      this.dummy = new THREE.Object3D();
      this.dummy.rotation.order = 'YXZ';
      this.player = new THREE.Vector3();
      this.matB = insectMaterial(textures.wing, 0);
      this.matE = insectMaterial(textures.wing, 1);
      this.butterflies = this.createGroup(scene, butterflyGeometry(), this.matB, MAX_BUTTERFLIES, true);
      this.bees = this.createGroup(scene, beeGeometry(), this.matE, MAX_BEES, false);
    }

    createGroup(scene, geo, mat, count, butterfly) {
      const phase = new Float32Array(count), amp = new Float32Array(count), colA = new Float32Array(count * 3), colB = new Float32Array(count * 3);
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      geo.setAttribute('aAmp', new THREE.InstancedBufferAttribute(amp, 1));
      geo.setAttribute('aColA', new THREE.InstancedBufferAttribute(colA, 3));
      geo.setAttribute('aColB', new THREE.InstancedBufferAttribute(colB, 3));
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      const list = [];
      for (let i = 0; i < count; i++) {
        const sp = SPECIES[i % SPECIES.length];
        const a = butterfly ? sp.a : [0.98, 0.78, 0.14], b = butterfly ? sp.b : [0.07, 0.05, 0.03];
        const tone = 0.88 + Math.random() * 0.2;
        colA.set([a[0] * tone, a[1] * tone, a[2] * tone], i * 3);
        colB.set(b, i * 3);
        list.push({
          active: false, vis: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null,
          tpos: new THREE.Vector3(), jitter: new THREE.Vector3(), jt: 0, state: 'fly', timer: 0,
          phase: Math.random() * 6.28, flap: 12, amp: 1, yaw: Math.random() * 6.28, pitch: 0, roll: 0,
          seed: Math.random() * 100, size: butterfly ? rnd(0.17, 0.26) : rnd(0.075, 0.095), species: sp, curious: 0
        });
      }
      return { mesh, list, phase, amp, butterfly };
    }

    // ------------------------------------------------------------ flowers
    refreshFlowers(px, pz) {
      const W = this.world, pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
      const out = [];
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const c = W.getChunk(pcx + dx, pcz + dz);
        if (c && c.generated) for (const f of c.flowers) out.push(f);
      }
      this.flowers = out;
    }
    pickFlower(ins, near, butterfly) {
      const list = this.flowers;
      if (!list.length) return null;
      let best = null, bestS = -1e9;
      const tries = Math.min(14, list.length);
      for (let k = 0; k < tries; k++) {
        const f = list[(Math.random() * list.length) | 0];
        const dx = f.x - ins.pos.x, dy = f.y - ins.pos.y, dz = f.z - ins.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 0.4 || f === ins.target) continue;
        let s = near ? -d : -Math.abs(d - 10);
        if (butterfly) {
          const l = ins.species.likes;
          const sim = 1 - (Math.abs(l[0] - f.color[0]) + Math.abs(l[1] - f.color[1]) + Math.abs(l[2] - f.color[2])) / 765;
          s += sim * 4;
        }
        if (f.busy && f.busy > this.time) s -= 3;
        s += Math.random() * 2;
        if (s > bestS) { bestS = s; best = f; }
      }
      return best;
    }
    spawn(ins, butterfly) {
      const list = this.flowers;
      if (!list.length) return false;
      for (let k = 0; k < 8; k++) {
        const f = list[(Math.random() * list.length) | 0];
        const d = Math.hypot(f.x - this.player.x, f.z - this.player.z);
        if (d > 26 || d < 4) continue;
        ins.active = true; ins.vis = 0; ins.target = f;
        ins.pos.set(f.x, f.y + (butterfly ? 0.05 : 0.2), f.z);
        ins.vel.set(0, 0, 0);
        ins.state = butterfly ? 'rest' : 'hover';
        ins.timer = rnd(0.5, 4);
        f.busy = this.time + ins.timer;
        return true;
      }
      return false;
    }

    avoidTerrain(ins, dt, minClear) {
      const W = this.world;
      const x = Math.floor(ins.pos.x), z = Math.floor(ins.pos.z);
      const top = W.topY(x, z);
      if (top >= 0) {
        const floor = top + 1 + minClear;
        if (ins.pos.y < floor && ins.state !== 'rest' && ins.state !== 'hover') {
          ins.vel.y += (floor - ins.pos.y) * 10 * dt;
        }
      }
      if (W.isSolid(x, Math.floor(ins.pos.y), z)) { ins.pos.y += 2.5 * dt; ins.vel.y = Math.abs(ins.vel.y) + 0.5; }
    }

    updateButterfly(b, dt) {
      const t = this.time;
      const dP = b.pos.distanceTo(this.player);
      if (b.state === 'rest') {
        b.timer -= dt;
        b.flap = 2.6; b.amp = 0.75;
        if (b.target) b.pos.set(b.target.x, b.target.y + 0.05, b.target.z);
        if (b.timer <= 0 || dP < 1.7) {
          b.state = 'fly';
          b.target = this.pickFlower(b, Math.random() < 0.7, true);
          b.vel.set(rnd(-0.5, 0.5), dP < 1.7 ? 2.2 : 1.1, rnd(-0.5, 0.5));
          b.timer = rnd(4, 9);
        }
      } else {
        b.flap = 13 + Math.sin(b.seed) * 3; b.amp = 1.05;
        b.timer -= dt;
        let tx, ty, tz;
        if (b.target) { tx = b.target.x; ty = b.target.y + 0.05; tz = b.target.z; }
        else { tx = b.tpos.x; ty = b.tpos.y; tz = b.tpos.z; }
        const dx = tx - b.pos.x, dy = ty - b.pos.y, dz = tz - b.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const speed = 1.6 + Math.sin(b.seed * 3) * 0.5;
        const arrive = Math.min(1, d / 1.5);
        const s = b.seed;
        const wx = Math.sin(t * 2.3 + s) * 1.1 + Math.sin(t * 5.1 + s * 2) * 0.5;
        const wy = Math.sin(t * 4.2 + s * 1.7) * 1.1 + (d > 3 ? 0.35 : 0);
        const wz = Math.cos(t * 2.0 + s * 3) * 1.1 + Math.cos(t * 4.6 + s) * 0.45;
        const k = Math.min(1, dt * 2.4);
        b.vel.x += ((dx / d) * speed * arrive + wx * arrive - b.vel.x) * k;
        b.vel.y += ((dy / d) * speed * arrive + wy * arrive - b.vel.y) * k;
        b.vel.z += ((dz / d) * speed * arrive + wz * arrive - b.vel.z) * k;
        this.avoidTerrain(b, dt, 0.5);
        if (b.target && d < 0.22) {
          b.state = 'rest'; b.timer = rnd(2, 7);
          b.target.busy = this.time + b.timer;
          b.vel.set(0, 0, 0);
        } else if (!b.target || b.timer <= 0) {
          b.timer = rnd(4, 9);
          b.target = this.pickFlower(b, Math.random() < 0.6, true);
          if (!b.target) b.tpos.set(b.pos.x + rnd(-5, 5), b.pos.y + rnd(-0.5, 1.5), b.pos.z + rnd(-5, 5));
        }
        b.pos.addScaledVector(b.vel, dt);
        const hs = Math.hypot(b.vel.x, b.vel.z);
        if (hs > 0.05) b.yaw = Math.atan2(b.vel.x, b.vel.z);
        b.pitch = -Math.atan2(b.vel.y, Math.max(hs, 0.3)) * 0.5;
        b.roll = Math.sin(t * 3 + s) * 0.25;
      }
    }

    updateBee(e, dt) {
      const t = this.time;
      if (e.curious > 0) e.curious -= dt;
      if (e.state === 'hover') {
        e.timer -= dt;
        e.jt -= dt;
        if (e.jt <= 0) { e.jitter.set(rnd(-0.14, 0.14), rnd(0.06, 0.24), rnd(-0.14, 0.14)); e.jt = rnd(0.1, 0.32); }
        let tx, ty, tz;
        if (e.curious > 0) { tx = this.player.x + Math.sin(t * 2 + e.seed) * 0.6; ty = this.player.y + 1.5; tz = this.player.z + Math.cos(t * 2 + e.seed) * 0.6; }
        else if (e.target) { tx = e.target.x; ty = e.target.y; tz = e.target.z; }
        else { tx = e.pos.x; ty = e.pos.y; tz = e.pos.z; }
        const k = Math.min(1, dt * 9);
        e.vel.x += ((tx + e.jitter.x - e.pos.x) * 7 - e.vel.x) * k;
        e.vel.y += ((ty + e.jitter.y - e.pos.y) * 7 - e.vel.y) * k;
        e.vel.z += ((tz + e.jitter.z - e.pos.z) * 7 - e.vel.z) * k;
        if (e.target && e.curious <= 0) e.yaw += (Math.atan2(e.target.x - e.pos.x, e.target.z - e.pos.z) - e.yaw) * Math.min(1, dt * 3);
        if (e.timer <= 0) {
          e.state = 'fly';
          const curious = Math.random() < 0.06 && e.pos.distanceTo(this.player) < 7;
          if (curious) { e.curious = rnd(1.2, 2.4); e.state = 'hover'; e.timer = e.curious; }
          else e.target = this.pickFlower(e, Math.random() < 0.78, false);
        }
      } else {
        let tx, ty, tz;
        if (e.target) { tx = e.target.x; ty = e.target.y + 0.18; tz = e.target.z; }
        else { tx = e.pos.x + rnd(-3, 3); ty = e.pos.y; tz = e.pos.z + rnd(-3, 3); e.target = this.pickFlower(e, true, false); }
        const dx = tx - e.pos.x, dy = ty - e.pos.y, dz = tz - e.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const speed = (3.6 + (e.seed % 1) * 2.6) * Math.min(1, d / 0.8 + 0.25);
        const zig = Math.sin(t * 9 + e.seed) * 1.3;
        const k = Math.min(1, dt * 6);
        e.vel.x += ((dx / d) * speed + (-dz / d) * zig - e.vel.x) * k;
        e.vel.y += ((dy / d) * speed + Math.sin(t * 7 + e.seed) * 0.6 - e.vel.y) * k;
        e.vel.z += ((dz / d) * speed + (dx / d) * zig - e.vel.z) * k;
        this.avoidTerrain(e, dt, 0.25);
        if (d < 0.3) {
          e.state = 'hover'; e.timer = rnd(0.6, 2.6);
          if (e.target) e.target.busy = this.time + e.timer;
        }
        const hs = Math.hypot(e.vel.x, e.vel.z);
        if (hs > 0.1) e.yaw = Math.atan2(e.vel.x, e.vel.z);
      }
      e.pos.addScaledVector(e.vel, dt);
      e.flap = 75; e.amp = 0.7;
      e.pitch = -Math.atan2(e.vel.y, Math.max(Math.hypot(e.vel.x, e.vel.z), 0.5)) * 0.4;
      e.roll = 0;
    }

    updateGroup(group, dt, wanted) {
      const { list, mesh, phase, amp, butterfly } = group;
      let active = 0;
      for (const ins of list) if (ins.active) active++;
      for (let i = 0; i < list.length; i++) {
        const ins = list[i];
        if (!ins.active && i < wanted && active < wanted && Math.random() < 0.08) { if (this.spawn(ins, butterfly)) active++; }
        if (ins.active) {
          const far = ins.pos.distanceTo(this.player) > 38;
          const retire = far || i >= wanted;
          ins.vis = Math.max(0, Math.min(1, ins.vis + (retire ? -dt * 1.5 : dt * 1.2)));
          if (retire && (ins.vis <= 0 || far)) { ins.active = false; ins.vis = 0; active--; }
          else if (butterfly) this.updateButterfly(ins, dt);
          else this.updateBee(ins, dt);
        }
        ins.phase += ins.flap * dt;
        phase[i] = ins.phase; amp[i] = ins.amp;
        const d = this.dummy;
        d.position.copy(ins.pos);
        d.rotation.set(ins.pitch, ins.yaw, ins.roll, 'YXZ');
        d.scale.setScalar(ins.active ? ins.size * ins.vis : 0);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.aPhase.needsUpdate = true;
      mesh.geometry.attributes.aAmp.needsUpdate = true;
    }

    update(dt, playerPos, daylight, fogColor, fogNear, fogFar) {
      this.time += dt;
      this.player.copy(playerPos);
      this.flowerTimer -= dt;
      if (this.flowerTimer <= 0) { this.flowerTimer = 1.2; this.refreshFlowers(playerPos.x, playerPos.z); }
      const n = this.flowers.length;
      const dayF = OM.Noise.smoothstep(0.15, 0.45, daylight);
      const wantB = Math.round(Math.min(MAX_BUTTERFLIES, n / 7) * dayF);
      const wantE = Math.round(Math.min(MAX_BEES, n / 6) * dayF);
      this.updateGroup(this.butterflies, dt, wantB);
      this.updateGroup(this.bees, dt, wantE);
      for (const m of [this.matB, this.matE]) {
        m.uniforms.uLight.value = 0.32 + 0.68 * daylight;
        m.uniforms.uFogColor.value.copy(fogColor);
        m.uniforms.uFogNear.value = fogNear;
        m.uniforms.uFogFar.value = fogFar;
      }
    }
    activeCount() {
      let b = 0, e = 0;
      for (const x of this.butterflies.list) if (x.active) b++;
      for (const x of this.bees.list) if (x.active) e++;
      return { butterflies: b, bees: e };
    }
  }

  const INSECT_VS = /* glsl */`
    attribute float aWing;
    attribute float aPhase;
    attribute float aAmp;
    attribute vec3 aColA;
    attribute vec3 aColB;
    uniform float uFogNear;
    uniform float uFogFar;
    varying vec2 vUv;
    varying vec3 vColA;
    varying vec3 vColB;
    varying vec3 vLocal;
    varying float vFog;
    varying float vShade;
    void main() {
      vec3 p = position;
      if (aWing != 0.0) {
        float ang = sin(aPhase) * aAmp + 0.3;
        float s = abs(p.x);
        float base = 0.0;
        p.y = p.y + s * sin(ang);
        p.x = sign(p.x) * s * cos(ang);
        vShade = 0.78 + 0.22 * cos(ang);
      } else {
        vShade = 1.0;
      }
      vLocal = position;
      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vec4 mv = viewMatrix * wp;
      vFog = smoothstep(uFogNear, uFogFar, -mv.z);
      vUv = uv; vColA = aColA; vColB = aColB;
      gl_Position = projectionMatrix * mv;
    }`;
  const INSECT_FS = /* glsl */`
    uniform sampler2D uWing;
    uniform float uMode;
    uniform float uLight;
    uniform vec3 uFogColor;
    varying vec2 vUv;
    varying vec3 vColA;
    varying vec3 vColB;
    varying vec3 vLocal;
    varying float vFog;
    varying float vShade;
    void main() {
      vec3 col;
      if (vUv.x < -0.5) {
        if (uMode < 0.5) col = vec3(0.16, 0.12, 0.09);
        else {
          float stripe = step(0.5, fract(vLocal.z * 2.1 + 0.3));
          col = mix(vColA, vColB, stripe);
          if (vLocal.z > 0.38) col = vColB * 1.4;
        }
      } else if (uMode < 0.5) {
        vec4 t = texture2D(uWing, vUv);
        if (t.a < 0.5) discard;
        col = mix(vColA, vColB, t.g) * (1.0 - t.b * 0.55);
      } else {
        vec2 q = (vUv - 0.5) * vec2(1.0, 1.5);
        if (length(q) > 0.5) discard;
        col = vec3(0.86, 0.92, 0.98) * (0.85 + 0.15 * vUv.x);
      }
      col *= uLight * vShade;
      gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.0);
    }`;

  OM.Wildlife = Wildlife;
})();
