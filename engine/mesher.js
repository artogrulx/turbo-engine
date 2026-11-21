/* Open Meadow — engine/mesher.js
 * Turns a chunk's voxel data into two compact BufferGeometry payloads:
 *   opaque  – normal blocks
 *   cutout  – alpha-tested blocks (leaves, glass)
 * Hidden faces are culled, every vertex gets smooth ambient occlusion and a
 * cheap sky-light term (darker inside holes, caves and under overhangs), and
 * faces touching water are flagged "wet" so the shader can add caustics.
 * The chunk is copied with a 1-voxel border from its 8 neighbours first, so
 * the inner loop never has to branch on chunk boundaries. */
(function () {
  'use strict';
  const OM = window.OM;
  const { CY } = OM.CONST;
  const BL = OM.Blocks, B = OM.B;
  const OPAQUE = BL.OPAQUE, CUTOUT = BL.CUTOUT, AO_OCC = BL.AO_OCC, TINT = BL.TINT, TILE = BL.TILE, GLOW = BL.GLOW;

  const PW = 18, PA = PW * PW, PH = CY + 2;
  const pad = new Uint8Array(PA * PH);
  const padW = new Uint8Array(PA * PH);
  const padTop = new Int16Array(PA);
  const AO_CURVE = [0.5, 0.66, 0.83, 1.0];

  // ---- face tables -----------------------------------------------------------
  const RAW_FACES = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
  ];
  const D = (x, y, z) => x + z * PW + y * PA;
  const FACES = RAW_FACES.map((f, fi) => {
    let c = f.c.map((p) => p.slice());
    // make sure corners wind counter-clockwise when seen from outside
    const e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]];
    const e2 = [c[2][0] - c[0][0], c[2][1] - c[0][1], c[2][2] - c[0][2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * f.n[0] + cr[1] * f.n[1] + cr[2] * f.n[2] < 0) c = c.reverse();
    const axis = f.n[0] ? 0 : f.n[1] ? 1 : 2;
    const tang = [0, 1, 2].filter((a) => a !== axis);
    const o1 = [], o2 = [], o3 = [], uvs = [];
    for (const p of c) {
      const s = [0, 0, 0];
      s[tang[0]] = p[tang[0]] * 2 - 1;
      const t = [0, 0, 0];
      t[tang[1]] = p[tang[1]] * 2 - 1;
      o1.push(D(s[0], s[1], s[2]));
      o2.push(D(t[0], t[1], t[2]));
      o3.push(D(s[0] + t[0], s[1] + t[1], s[2] + t[2]));
      let u, v;
      if (fi === 0) { u = 1 - p[2]; v = 1 - p[1]; }
      else if (fi === 1) { u = p[2]; v = 1 - p[1]; }
      else if (fi === 4) { u = p[0]; v = 1 - p[1]; }
      else if (fi === 5) { u = 1 - p[0]; v = 1 - p[1]; }
      else if (fi === 2) { u = p[0]; v = p[2]; }
      else { u = p[0]; v = 1 - p[2]; }
      uvs.push([u, v]);
    }
    return { n: f.n, nd: D(f.n[0], f.n[1], f.n[2]), c, o1, o2, o3, uvs };
  });

  // ---- growable geometry builder ---------------------------------------------
  class GeoBuilder {
    constructor() { this.cap = 8192; this.alloc(); this.v = 0; this.i = 0; }
    alloc(old) {
      const c = this.cap;
      const pos = new Float32Array(c * 3), nor = new Int8Array(c * 3), uv = new Float32Array(c * 2);
      const col = new Uint8Array(c * 3), wet = new Uint8Array(c), idx = new Uint32Array(c * 1.5);
      if (old) {
        pos.set(old.pos); nor.set(old.nor); uv.set(old.uv); col.set(old.col); wet.set(old.wet); idx.set(old.idx);
      }
      Object.assign(this, { pos, nor, uv, col, wet, idx });
    }
    ensure(nv) {
      if (this.v + nv <= this.cap) return;
      const old = { pos: this.pos, nor: this.nor, uv: this.uv, col: this.col, wet: this.wet, idx: this.idx };
      while (this.v + nv > this.cap) this.cap *= 2;
      this.alloc(old);
    }
    reset() { this.v = 0; this.i = 0; }
    result() {
      if (!this.v) return null;
      const v = this.v, i = this.i;
      return {
        pos: this.pos.slice(0, v * 3), nor: this.nor.slice(0, v * 3), uv: this.uv.slice(0, v * 2),
        col: this.col.slice(0, v * 3), wet: this.wet.slice(0, v),
        idx: v < 65536 ? Uint16Array.from(this.idx.subarray(0, i)) : this.idx.slice(0, i)
      };
    }
  }
  const gOpaque = new GeoBuilder(), gCutout = new GeoBuilder();

  function fillPad(world, ch) {
    pad.fill(0); padW.fill(0); padTop.fill(-1);
    let ymax = 0;
    const around = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = world.getChunk(ch.cx + dx, ch.cz + dz);
      around.push(c);
      if (c && c.maxY > ymax) ymax = c.maxY;
    }
    ymax = Math.min(CY - 1, ymax + 1);
    for (let pz = 0; pz < PW; pz++) {
      const dz = pz - 1, cz = dz < 0 ? 0 : dz > 15 ? 2 : 1, sz = (dz + 16) & 15;
      for (let px = 0; px < PW; px++) {
        const dx = px - 1, cx = dx < 0 ? 0 : dx > 15 ? 2 : 1, sx = (dx + 16) & 15;
        const c = around[cx + cz * 3];
        const col = px + pz * PW;
        pad[col] = B.BEDROCK; // y = -1
        if (!c) { // missing neighbour: pretend solid so no faces are emitted toward it
          for (let y = 0; y <= ymax; y++) pad[col + (y + 1) * PA] = B.STONE;
          padTop[col] = ymax;
          continue;
        }
        const src = sx + sz * 16;
        padTop[col] = c.height[src];
        const blocks = c.blocks, water = c.water;
        for (let y = 0; y <= ymax; y++) {
          const si = src + y * 256, di = col + (y + 1) * PA;
          pad[di] = blocks[si];
          padW[di] = water[si] ? 1 : 0;
        }
      }
    }
  }

  function sky(q) {
    const col = q % PA;
    const y = (q - col) / PA - 1;
    const top = padTop[col];
    if (y > top) return 1;
    const v = 1 - (top - y + 1) * 0.13;
    return v < 0.24 ? 0.24 : v;
  }

  const ao = [0, 0, 0, 0], li = [0, 0, 0, 0], tint = [1, 1, 1];

  function build(world, ch, uvTable, fancyLeaves) {
    fillPad(world, ch);
    gOpaque.reset(); gCutout.reset();
    const gen = world.gen;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      gen.tintAt(ch.x0 + lx, ch.z0 + lz, tint);
      const tr = tint[0], tg = tint[1], tb = tint[2];
      for (let y = 0; y <= ch.maxY; y++) {
        const p = (lx + 1) + (lz + 1) * PW + (y + 1) * PA;
        const id = pad[p];
        if (!id) continue;
        const cut = CUTOUT[id];
        const g = cut ? gCutout : gOpaque;
        const tmode = TINT[id];
        const jit = 0.955 + (((lx * 73 + y * 151 + lz * 37 + ch.x0 * 11 + ch.z0 * 7) & 255) / 255) * 0.09;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const np = p + F.nd;
          const nb = pad[np];
          if (nb) {
            if (OPAQUE[nb]) continue;
            if (cut && nb === id && (id === B.GLASS || !fancyLeaves)) continue;
          }
          if (f === 3 && y === 0) continue;
          // ---- per-vertex AO + sky light ----
          for (let k = 0; k < 4; k++) {
            const q1 = np + F.o1[k], q2 = np + F.o2[k], q3 = np + F.o3[k];
            const s1 = pad[q1], s2 = pad[q2], s3 = pad[q3];
            const a1 = AO_OCC[s1], a2 = AO_OCC[s2], a3 = AO_OCC[s3];
            const lvl = a1 && a2 ? 0 : 3 - (a1 + a2 + a3);
            let sum = sky(np), n = 1;
            if (!OPAQUE[s1]) { sum += sky(q1); n++; }
            if (!OPAQUE[s2]) { sum += sky(q2); n++; }
            if (!OPAQUE[s3] && (!OPAQUE[s1] || !OPAQUE[s2])) { sum += sky(q3); n++; }
            ao[k] = lvl;
            li[k] = AO_CURVE[lvl] * (sum / n) * jit;
          }
          let r = 1, gg = 1, b = 1;
          if ((tmode === 1 && f === 2) || tmode === 2) { r = tr; gg = tg; b = tb; }
          const tile = TILE[id * 6 + f];
          const u0 = uvTable[tile * 4], v0 = uvTable[tile * 4 + 1], u1 = uvTable[tile * 4 + 2], v1 = uvTable[tile * 4 + 3];
          // 255 = underwater face (caustics), 128 = foliage (wind sway), 64 = glowing (lava), 0 = plain
          const glow = GLOW[id] === 1;
          const wet = glow ? 64 : padW[np] ? 255 : tmode === 2 ? 128 : 0;
          g.ensure(4);
          const base = g.v;
          for (let k = 0; k < 4; k++) {
            const c = F.c[k], vi = g.v++;
            g.pos[vi * 3] = lx + c[0]; g.pos[vi * 3 + 1] = y + c[1]; g.pos[vi * 3 + 2] = lz + c[2];
            g.nor[vi * 3] = F.n[0] * 127; g.nor[vi * 3 + 1] = F.n[1] * 127; g.nor[vi * 3 + 2] = F.n[2] * 127;
            g.uv[vi * 2] = u0 + (u1 - u0) * F.uvs[k][0];
            g.uv[vi * 2 + 1] = v0 + (v1 - v0) * F.uvs[k][1];
            const L = glow ? 255 : li[k] * 255;
            g.col[vi * 3] = Math.min(255, L * r); g.col[vi * 3 + 1] = Math.min(255, L * gg); g.col[vi * 3 + 2] = Math.min(255, L * b);
            g.wet[vi] = wet;
          }
          const I = g.idx;
          if (ao[0] + ao[2] >= ao[1] + ao[3]) {
            I[g.i++] = base; I[g.i++] = base + 1; I[g.i++] = base + 2;
            I[g.i++] = base; I[g.i++] = base + 2; I[g.i++] = base + 3;
          } else {
            I[g.i++] = base + 1; I[g.i++] = base + 2; I[g.i++] = base + 3;
            I[g.i++] = base + 1; I[g.i++] = base + 3; I[g.i++] = base;
          }
        }
      }
    }
    return { opaque: gOpaque.result(), cutout: gCutout.result() };
  }

  OM.Mesher = { build, FACES };
})();
