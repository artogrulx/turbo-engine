/* Open Meadow — engine/water.js
 * Real water simulation on the voxel grid plus a continuous animated surface.
 *
 * Simulation (cellular, runs ~5.5 times per second on "active" cells only):
 *   - every cell stores a level 1..8 plus SOURCE / FALLING flags
 *   - water falls first; when resting on ground it spreads sideways, losing
 *     one level per block, preferring the direction of the nearest drop
 *     within 4 blocks (so it runs downhill and through channels)
 *   - flowing water that loses its supply drains away level by level
 *   - a cell next to two sources (on solid ground) becomes a source, so
 *     lakes fill excavations permanently and dug channels stay full
 * Rendering: one mesh per chunk. Surface corner heights are averaged across
 * neighbouring cells so adjacent water forms one smooth sheet; per-vertex
 * depth drives the shallow-to-deep colour and transparency, a flow vector
 * animates currents, and side faces render waterfalls. */
(function () {
  'use strict';
  const OM = window.OM;
  const { CY } = OM.CONST;
  const SOLID = OM.Blocks.SOLID, OPAQUE = OM.Blocks.OPAQUE;
  const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const LEVEL = 15, SOURCE = 16, FALLING = 32, FULL = 8;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const OPP = [1, 0, 3, 2];
  const OFF = 1048576, ZS = 2097152;
  const pack = (x, y, z) => ((x + OFF) * ZS + (z + OFF)) * 128 + y;

  const strength = (w) => (w & (SOURCE | FALLING) ? FULL : w & LEVEL);
  const cellHeight = (w, above) => (above ? 1 : w & (SOURCE | FALLING) ? 0.88 : ((w & LEVEL) / 8) * 0.88);

  // ---- side face templates (corner order verified against outward normal) ----
  const SIDES = DIRS.map(([dx, dz]) => {
    let a, b;
    if (dx === 1) { a = [1, 0]; b = [1, 1]; }
    else if (dx === -1) { a = [0, 0]; b = [0, 1]; }
    else if (dz === 1) { a = [0, 1]; b = [1, 1]; }
    else { a = [0, 0]; b = [1, 0]; }
    // quad: a-bottom, b-bottom, b-top, a-top must be CCW seen from outside
    const e1 = [b[0] - a[0], 0, b[1] - a[1]], e2 = [b[0] - a[0], 1, b[1] - a[1]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * dx + cz * dz < 0) { const t = a; a = b; b = t; }
    return { dx, dz, a, b };
  });

  class WaterBuilder {
    constructor() { this.cap = 4096; this.pos = new Float32Array(this.cap * 3); this.info = new Float32Array(this.cap * 4); this.idx = new Uint32Array(this.cap * 1.5); this.v = 0; this.i = 0; }
    ensure(n) {
      if (this.v + n <= this.cap) return;
      while (this.v + n > this.cap) this.cap *= 2;
      const p = new Float32Array(this.cap * 3), f = new Float32Array(this.cap * 4), x = new Uint32Array(this.cap * 1.5);
      p.set(this.pos); f.set(this.info); x.set(this.idx);
      this.pos = p; this.info = f; this.idx = x;
    }
    vert(x, y, z, d, fx, fz, side) {
      const v = this.v++;
      this.pos[v * 3] = x; this.pos[v * 3 + 1] = y; this.pos[v * 3 + 2] = z;
      this.info[v * 4] = d; this.info[v * 4 + 1] = fx; this.info[v * 4 + 2] = fz; this.info[v * 4 + 3] = side;
    }
    quad(b) { const I = this.idx; I[this.i++] = b; I[this.i++] = b + 1; I[this.i++] = b + 2; I[this.i++] = b; I[this.i++] = b + 2; I[this.i++] = b + 3; }
    result() {
      if (!this.v) return null;
      return { pos: this.pos.slice(0, this.v * 3), info: this.info.slice(0, this.v * 4), idx: this.v < 65536 ? Uint16Array.from(this.idx.subarray(0, this.i)) : this.idx.slice(0, this.i) };
    }
  }
  const builder = new WaterBuilder();
  // per-layer scratch (18x18 with border): height (-1 solid, -2 air), depth, flags
  const LH = new Float32Array(324), LD = new Float32Array(324), LA = new Uint8Array(324), LS = new Uint8Array(324);
  const CFX = new Float32Array(324), CFZ = new Float32Array(324);

  class Water {
    constructor(world) {
      this.world = world;
      this.pending = new Set();
      this.timer = 0;
      this.TICK = 0.18;
      this.MAX = 3500;
      this.lastUpdates = 0;
      this.material = null;
      this.rf = [0, 0];
    }

    // ---------------------------------------------------------------- queue
    schedule(x, y, z) { if (y >= 0 && y < CY) this.pending.add(pack(x, y, z)); }
    scheduleAround(x, y, z) {
      this.schedule(x, y, z); this.schedule(x + 1, y, z); this.schedule(x - 1, y, z);
      this.schedule(x, y + 1, z); this.schedule(x, y - 1, z); this.schedule(x, y, z + 1); this.schedule(x, y, z - 1);
    }
    onChunkLoaded(c, edits, waterEdits) {
      for (const i of c.springs) this.schedule(c.x0 + (i & 15), i >> 8, c.z0 + ((i >> 4) & 15));
      const touch = (m) => { if (m) for (const i of m.keys()) this.scheduleAround(c.x0 + (i & 15), i >> 8, c.z0 + ((i >> 4) & 15)); };
      touch(edits); touch(waterEdits);
      // border water on both sides of each seam may now be able to flow across it
      const W = this.world;
      for (const [dx, dz] of DIRS) {
        const n = W.getChunk(c.cx + dx, c.cz + dz);
        if (!n || !n.generated) continue;
        for (const [ch, side] of [[c, [dx, dz]], [n, [-dx, -dz]]]) {
          if (ch.waterMax < 0) continue;
          const fixedX = side[0] === 1 ? 15 : side[0] === -1 ? 0 : -1;
          const fixedZ = side[1] === 1 ? 15 : side[1] === -1 ? 0 : -1;
          for (let k = 0; k < 16; k++) {
            const lx = fixedX >= 0 ? fixedX : k, lz = fixedZ >= 0 ? fixedZ : k;
            for (let y = ch.waterMin; y <= ch.waterMax; y++) {
              const w = ch.water[lx + (lz << 4) + (y << 8)];
              if (w && !(w & SOURCE)) this.schedule(ch.x0 + lx, y, ch.z0 + lz);
            }
          }
        }
      }
    }
    update(dt) {
      this.timer += dt;
      if (this.timer < this.TICK) return;
      this.timer = 0;
      this.tick();
    }
    tick() {
      const cur = this.pending;
      if (!cur.size) { this.lastUpdates = 0; return; }
      this.pending = new Set();
      let n = 0;
      for (const k of cur) {
        if (n >= this.MAX) { this.pending.add(k); continue; }
        n++;
        const y = k % 128, r = (k - y) / 128, zz = r % ZS;
        this.updateCell((r - zz) / ZS - OFF, y, zz - OFF);
      }
      this.lastUpdates = n;
    }

    // ----------------------------------------------------------- cell rules
    isResting(x, y, z) {
      if (y <= 0) return true;
      const b = this.world.getBlock(x, y - 1, z);
      if (b < 0 || SOLID[b]) return true;
      return (this.world.getWater(x, y - 1, z) & SOURCE) !== 0;
    }
    /** Water this cell is entitled to. Only strictly stronger ("upstream") neighbours
     *  count, so two draining cells cannot keep each other alive and a cut-off
     *  stream empties in a few ticks instead of counting down level by level. */
    support(x, y, z, cur) {
      const W = this.world;
      if (y + 1 < CY && W.getWater(x, y + 1, z) > 0) return FALLING | FULL;
      const own = cur > 0 ? strength(cur) : 0;
      let best = 0, sources = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        const w = W.getWater(nx, y, nz);
        if (w <= 0 || !this.isResting(nx, y, nz)) continue;
        if (w & SOURCE) sources++;
        const sn = strength(w);
        if (sn <= own) continue;
        if (sn - 1 > best) best = sn - 1;
      }
      if (sources >= 2 && this.isResting(x, y, z)) return SOURCE | FULL;
      return best;
    }
    updateCell(x, y, z) {
      const W = this.world;
      const b = W.getBlock(x, y, z);
      if (b < 0) return;
      const cur = W.getWater(x, y, z);
      if (SOLID[b]) { if (cur > 0) W.setWaterRaw(x, y, z, 0); return; }
      let next = cur;
      if (!(cur & SOURCE)) {
        const sup = this.support(x, y, z, cur);
        if (sup & SOURCE) next = sup;
        else if (cur > 0) {
          if (strength(sup) < strength(cur)) next = sup;
          else if ((sup & FALLING) !== (cur & FALLING)) next = sup;
        }
      }
      if (next !== cur) {
        W.setWaterRaw(x, y, z, next);
        this.scheduleAround(x, y, z);
        // a draining cell must not push water back into cells that just emptied:
        // it spreads again on its next update, once its level is stable
        if (!(next & SOURCE) && strength(next) < strength(cur)) return;
      }
      if (next > 0) { this.quench(x, y, z); this.spread(x, y, z, next); }
    }
    /** Lava that water touches cools into obsidian (a river reaching a lava lake, a poured bucket...). */
    quench(x, y, z) {
      const W = this.world;
      for (let d = 0; d < 6; d++) {
        const nx = x + NEIGHBOURS[d][0], ny = y + NEIGHBOURS[d][1], nz = z + NEIGHBOURS[d][2];
        if (W.getBlock(nx, ny, nz) === OM.B.LAVA) W.setBlock(nx, ny, nz, OM.B.OBSIDIAN);
      }
    }
    canReceive(x, y, z, lvl) {
      const b = this.world.getBlock(x, y, z);
      if (b < 0 || SOLID[b]) return false;
      const w = this.world.getWater(x, y, z);
      if (w & (SOURCE | FALLING)) return false;
      return (w & LEVEL) < lvl;
    }
    passable(x, y, z) {
      const b = this.world.getBlock(x, y, z);
      if (b < 0 || SOLID[b]) return false;
      return !(this.world.getWater(x, y, z) & SOURCE);
    }
    hasDrop(x, y, z) {
      if (y <= 0) return false;
      const b = this.world.getBlock(x, y - 1, z);
      if (b < 0 || SOLID[b]) return false;
      return !(this.world.getWater(x, y - 1, z) & SOURCE);
    }
    searchDrop(x, y, z, depth, from) {
      if (depth > 4) return 1000;
      let best = 1000;
      for (let d = 0; d < 4; d++) {
        if (d === OPP[from]) continue;
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        if (!this.passable(nx, y, nz)) continue;
        if (this.hasDrop(nx, y, nz)) return depth;
        const r = this.searchDrop(nx, y, nz, depth + 1, d);
        if (r < best) best = r;
      }
      return best;
    }
    flowMask(x, y, z) {
      let best = 1001, mask = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        if (!this.passable(nx, y, nz)) continue;
        const dist = this.hasDrop(nx, y, nz) ? 0 : this.searchDrop(nx, y, nz, 1, d);
        if (dist < best) { best = dist; mask = 1 << d; }
        else if (dist === best) mask |= 1 << d;
      }
      return mask;
    }
    spread(x, y, z, w) {
      const W = this.world;
      if (y > 0) {
        const bb = W.getBlock(x, y - 1, z);
        if (bb >= 0 && !SOLID[bb]) {
          const wb = W.getWater(x, y - 1, z);
          if (!(wb & SOURCE)) {
            if (wb !== (FALLING | FULL)) {
              W.setWaterRaw(x, y - 1, z, FALLING | FULL);
              W.removePlant(x, y - 1, z, 'flooded');
              this.scheduleAround(x, y - 1, z);
            }
            return;
          }
        }
      }
      const lvl = strength(w) - 1;
      if (lvl <= 0) return;
      let any = false;
      for (let d = 0; d < 4 && !any; d++) any = this.canReceive(x + DIRS[d][0], y, z + DIRS[d][1], lvl);
      if (!any) return;
      const mask = this.flowMask(x, y, z);
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        if (!this.canReceive(nx, y, nz, lvl)) continue;
        W.setWaterRaw(nx, y, nz, lvl);
        W.removePlant(nx, y, nz, 'flooded');
        this.scheduleAround(nx, y, nz);
      }
    }

    // ------------------------------------------------------- queries
    /** Absolute surface height of the water in this cell, or -1. */
    surfaceAt(x, y, z) {
      const w = this.world.getWater(x, y, z);
      if (w <= 0) return -1;
      return y + cellHeight(w, this.world.getWater(x, y + 1, z) > 0);
    }
    /** Fraction (0..1) of a vertical body [y, y+h] that is under water. */
    submersion(px, py, pz, h) {
      const ix = Math.floor(px), iz = Math.floor(pz);
      let top = -1, any = false;
      for (let yy = Math.floor(py); yy <= Math.floor(py + h); yy++) {
        const s = this.surfaceAt(ix, yy, iz);
        if (s >= 0) { any = true; top = s; } else if (any) break;
      }
      if (!any) return 0;
      return Math.max(0, Math.min(1, (top - py) / h));
    }
    /** Current at a cell: out = [x, z, down]. */
    flowAt(x, y, z, out) {
      const W = this.world;
      out[0] = 0; out[1] = 0; out[2] = 0;
      const w = W.getWater(x, y, z);
      if (w <= 0) return out;
      if (w & FALLING) out[2] = 1;
      if (w & SOURCE) return out;
      const s0 = strength(w);
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        const b = W.getBlock(nx, y, nz);
        if (b < 0 || SOLID[b]) continue;
        const nw = W.getWater(nx, y, nz);
        let dh = nw > 0 ? s0 - strength(nw) : s0;
        if (nw <= 0 && this.hasDrop(nx, y, nz)) dh += 4;
        if (dh > 0) { out[0] += DIRS[d][0] * dh; out[1] += DIRS[d][1] * dh; }
      }
      const l = Math.hypot(out[0], out[1]);
      if (l > 1) { out[0] /= l; out[1] /= l; }
      return out;
    }

    // ---------------------------------------------------------- rendering
    buildMesh(c) {
      if (c.waterMax < 0) return null;
      const W = this.world, gen = W.gen, g = builder;
      g.v = 0; g.i = 0;
      for (let y = c.waterMin; y <= c.waterMax; y++) {
        let has = false;
        const lb = y << 8;
        for (let i = 0; i < 256; i++) if (c.water[lb + i]) { has = true; break; }
        if (!has) continue;
        // fill the 18x18 layer description
        for (let pz = 0; pz < 18; pz++) for (let px = 0; px < 18; px++) {
          const q = px + pz * 18, wx = c.x0 + px - 1, wz = c.z0 + pz - 1;
          const w = W.getWater(wx, y, wz);
          CFX[q] = 0; CFZ[q] = 0;
          if (w > 0) {
            const above = y + 1 < CY && W.getWater(wx, y + 1, wz) > 0;
            const h = cellHeight(w, above);
            LH[q] = h; LA[q] = above ? 1 : 0; LS[q] = w & (SOURCE | FALLING) ? 1 : 0;
            let d = h, yy = y - 1;
            while (yy >= 0 && d < 12 && W.getWater(wx, yy, wz) > 0) { d += 1; yy--; }
            LD[q] = d;
          } else {
            const b = W.getBlock(wx, y, wz);
            LH[q] = b < 0 || SOLID[b] ? -1 : -2; LA[q] = 0; LS[q] = 0; LD[q] = 0;
          }
        }
        // per-cell flow direction for the inner cells
        for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
          const q = (lx + 1) + (lz + 1) * 18, h = LH[q];
          if (h < 0) continue;
          if (LS[q]) {
            const rv = c.river[lx + (lz << 4)];
            if (rv > 0.25 && !LA[q]) { gen.riverFlow(c.x0 + lx, c.z0 + lz, this.rf); CFX[q] = this.rf[0] * 0.45 * rv; CFZ[q] = this.rf[1] * 0.45 * rv; }
            continue;
          }
          let fx = 0, fz = 0;
          for (let d = 0; d < 4; d++) {
            const n = q + DIRS[d][0] + DIRS[d][1] * 18, hn = LH[n];
            if (hn === -1) continue;
            const diff = h - (hn === -2 ? -0.3 : hn);
            if (diff > 0) { fx += DIRS[d][0] * diff; fz += DIRS[d][1] * diff; }
          }
          const l = Math.hypot(fx, fz);
          if (l > 0.001) { const s = Math.min(1, l * 2.5) / l; CFX[q] = fx * s; CFZ[q] = fz * s; }
        }
        // emit geometry
        for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
          const q = (lx + 1) + (lz + 1) * 18;
          if (LH[q] < 0) continue;
          const i = lx + (lz << 4) + lb;
          const aboveB = y + 1 < CY ? c.blocks[i + 256] : 0;
          const full = LA[q] === 1;
          // corner heights / depths / flow (corner k at local (lx+cx, lz+cz))
          const ch = [0, 0, 0, 0], cd = [0, 0, 0, 0], cfx = [0, 0, 0, 0], cfz = [0, 0, 0, 0];
          const corners = [[0, 0], [0, 1], [1, 1], [1, 0]];
          for (let k = 0; k < 4; k++) {
            const cx = lx + corners[k][0], cz = lz + corners[k][1];
            let sum = 0, wsum = 0, dsum = 0, top = false, fxs = 0, fzs = 0, fn = 0;
            for (let m = 0; m < 4; m++) {
              const cq = (cx + (m & 1)) + (cz + (m >> 1)) * 18;
              const h = LH[cq];
              if (h >= 0) {
                if (LA[cq]) top = true;
                const wt = LS[cq] ? 6 : 1;
                sum += h * wt; wsum += wt; dsum += LD[cq];
                fxs += CFX[cq]; fzs += CFZ[cq]; fn++;
              } else if (h === -2) wsum += 1;
            }
            ch[k] = top ? 1 : wsum ? sum / wsum : 0.88;
            cd[k] = dsum / 4;
            if (fn) { cfx[k] = fxs / fn; cfz[k] = fzs / fn; }
          }
          if (!full && !OPAQUE[aboveB]) {
            g.ensure(4);
            const b0 = g.v;
            for (let k = 0; k < 4; k++) g.vert(lx + corners[k][0], y + ch[k], lz + corners[k][1], cd[k], cfx[k], cfz[k], 0);
            g.quad(b0);
          }
          for (let s = 0; s < 4; s++) {
            const S = SIDES[s];
            const nq = q + S.dx + S.dz * 18;
            if (LH[nq] !== -2) continue; // only toward open air
            const ka = corners.findIndex((cc) => cc[0] === S.a[0] && cc[1] === S.a[1]);
            const kb = corners.findIndex((cc) => cc[0] === S.b[0] && cc[1] === S.b[1]);
            const ha = full ? 1 : ch[ka], hb = full ? 1 : ch[kb];
            g.ensure(4);
            const b0 = g.v;
            g.vert(lx + S.a[0], y, lz + S.a[1], 1, 0, -1, 1);
            g.vert(lx + S.b[0], y, lz + S.b[1], 1, 0, -1, 1);
            g.vert(lx + S.b[0], y + hb, lz + S.b[1], 1, 0, -1, 1);
            g.vert(lx + S.a[0], y + ha, lz + S.a[1], 1, 0, -1, 1);
            g.quad(b0);
          }
        }
      }
      return g.result();
    }

    createMaterial(textures) {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
          uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
          uZenith: { value: new THREE.Color(0.3, 0.5, 0.85) },
          uHorizon: { value: new THREE.Color(0.7, 0.82, 0.95) },
          uFogColor: { value: new THREE.Color(0.7, 0.82, 0.95) },
          uFogNear: { value: 50 },
          uFogFar: { value: 100 },
          uDaylight: { value: 1 },
          uNormalMap: { value: textures.waterNormals }
        },
        vertexShader: WATER_VS,
        fragmentShader: WATER_FS,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        extensions: { derivatives: true }
      });
      return this.material;
    }
    updateUniforms(time, sky, fogNear, fogFar, fogColor) {
      if (!this.material) return;
      const u = this.material.uniforms;
      u.uTime.value = time;
      u.uSunDir.value.copy(sky.sunDir);
      u.uSunColor.value.copy(sky.sunColor);
      u.uZenith.value.copy(sky.zenith);
      u.uHorizon.value.copy(sky.horizon);
      u.uFogColor.value.copy(fogColor);
      u.uFogNear.value = fogNear;
      u.uFogFar.value = fogFar;
      u.uDaylight.value = sky.daylight;
    }
  }

  const WATER_VS = /* glsl */`
    attribute vec4 aInfo;
    uniform float uTime;
    varying vec3 vWorld;
    varying vec4 vInfo;
    varying float vViewDepth;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      if (aInfo.w < 0.5) {
        float amp = 0.05 * clamp(aInfo.x * 0.6, 0.0, 1.0);
        float w = sin(wp.x * 0.55 + uTime * 1.25) * cos(wp.z * 0.47 + uTime * 0.95)
                + 0.55 * sin((wp.x - wp.z) * 0.9 + uTime * 1.9)
                + 0.3 * sin((wp.x * 0.3 + wp.z) * 1.7 - uTime * 2.6);
        wp.y += w * amp - 0.03;
      }
      vWorld = wp.xyz;
      vInfo = aInfo;
      vec4 mv = viewMatrix * wp;
      vViewDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;

  const WATER_FS = /* glsl */`
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uDaylight;
    uniform sampler2D uNormalMap;
    varying vec3 vWorld;
    varying vec4 vInfo;
    varying float vViewDepth;
    vec3 nrm(vec2 uv) { return texture2D(uNormalMap, uv).xyz * 2.0 - 1.0; }
    void main() {
      float depth = max(vInfo.x, 0.0);
      vec2 flow = vInfo.yz;
      vec3 V = normalize(cameraPosition - vWorld);
      float light = 0.16 + 0.84 * uDaylight * uDaylight;
      vec3 col; float alpha;
      if (vInfo.w > 0.5) {
        vec2 suv = vec2((vWorld.x + vWorld.z) * 0.35, vWorld.y * 0.18 + uTime * 0.9);
        float s1 = texture2D(uNormalMap, suv).a;
        float s2 = texture2D(uNormalMap, suv * vec2(2.0, 1.3) + vec2(0.3, uTime * 0.5)).a;
        float streak = smoothstep(0.5, 0.88, s1 * 0.6 + s2 * 0.4);
        col = mix(vec3(0.16, 0.42, 0.52), vec3(0.72, 0.86, 0.92), streak * 0.8) * light;
        alpha = 0.5 + streak * 0.3;
      } else {
        vec2 p = vWorld.xz;
        vec3 n1 = nrm(p * 0.11 + vec2(uTime * 0.018, uTime * 0.011));
        vec3 n2 = nrm(p * 0.23 + vec2(-uTime * 0.014, uTime * 0.021));
        float ph = fract(uTime * 0.3);
        float wA = 1.0 - abs(1.0 - 2.0 * ph);
        vec2 f = flow * 1.4;
        vec3 fA = nrm(p * 0.3 - f * ph);
        vec3 fB = nrm(p * 0.3 - f * fract(ph + 0.5) + vec2(0.37, 0.61));
        vec3 nf = fA * wA + fB * (1.0 - wA);
        float flowAmt = clamp(length(flow), 0.0, 1.0);
        vec2 nxy = (n1.xy + n2.xy) * 0.5 * (1.0 - flowAmt * 0.6) + nf.xy * (0.25 + flowAmt);
        vec3 N = normalize(vec3(nxy.x * 0.32, 1.0, nxy.y * 0.32));
        if (!gl_FrontFacing) N = -N;
        float NdV = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, R.y));
        float sd = max(dot(R, uSunDir), 0.0);
        float spec = pow(sd, 240.0) * 3.0 + pow(sd, 24.0) * 0.12;
        float path = depth / max(abs(V.y), 0.12);
        vec3 shallow = vec3(0.24, 0.66, 0.62), deep = vec3(0.02, 0.14, 0.22);
        vec3 body = mix(shallow, deep, 1.0 - exp(-depth * 0.42)) * light;
        alpha = clamp(1.0 - exp(-path * 0.85), 0.16, 0.93);
        if (gl_FrontFacing) {
          col = mix(body, sky * (0.25 + 0.65 * uDaylight), fres * 0.85);
          alpha = mix(alpha, 1.0, fres * 0.65);
          float fn = texture2D(uNormalMap, p * 0.45 + vec2(uTime * 0.03, -uTime * 0.02)).a;
          float foam = smoothstep(0.32, 0.02, depth) * smoothstep(0.35, 0.75, fn + 0.25 * sin(uTime * 1.6 + p.x * 2.1 + p.y * 1.7));
          foam += flowAmt * smoothstep(0.62, 0.9, nf.z * 0.5 + fn * 0.6) * 0.55;
          foam = clamp(foam, 0.0, 0.8);
          col = mix(col, vec3(0.92, 0.96, 0.98) * light, foam);
          alpha = max(alpha, foam * 0.85);
          col += uSunColor * spec * uDaylight;
        } else {
          float window = smoothstep(0.55, 0.8, abs(V.y));
          col = mix(vec3(0.04, 0.2, 0.26) * light, (uZenith * 1.15 + uSunColor * spec * 0.4) * light, window);
          alpha = 0.82;
        }
      }
      float fogF = smoothstep(uFogNear, uFogFar, vViewDepth);
      col = mix(col, uFogColor, fogF);
      gl_FragColor = vec4(col, alpha);
    }`;

  OM.Water = Water;
  OM.Water.SOURCE = SOURCE;
  OM.Water.FALLING = FALLING;
  OM.Water.FULL = FULL;
})();
