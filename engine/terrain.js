/* Open Meadow — engine/terrain.js
 * Deterministic world generator: rolling meadows, hills with ridges, river
 * valleys, lakes, beaches, forests, voxel trees with branches, bushes,
 * boulders, ore veins, hillside springs and procedural plant scattering.
 * A chunk can be regenerated at any time and comes out identical; player
 * edits are re-applied on top by world.js. */
(function () {
  'use strict';
  const OM = window.OM;
  const N = OM.Noise, B = OM.B, P = OM.P;
  const { CY, SEA } = OM.CONST;
  const fbm = N.fbm2, smooth = N.smoothstep;

  const WATER_SOURCE = 16 | 8;
  const FORCE = 256; // stamp flag: may replace terrain (used by boulders)
  const TREE_CELL = 5, BUSH_CELL = 7, ROCK_CELL = 11, SPRING_CELL = 48;
  const isLeaves = (id) => id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES;

  const PALETTES = [
    [P.POPPY, P.POPPY, P.DAISY],
    [P.DANDELION, P.BUTTERCUP, P.DAISY],
    [P.CORNFLOWER, P.DAISY, P.POPPY],
    [P.ALLIUM, P.LAVENDER, P.DAISY],
    [P.TULIP_ORANGE, P.TULIP_PINK, P.DAISY],
    [P.LAVENDER, P.LAVENDER, P.CORNFLOWER],
    [P.BUTTERCUP, P.CORNFLOWER, P.DANDELION],
    [P.DAISY, P.DAISY, P.POPPY, P.CORNFLOWER]
  ];
  const MEADOW_FLOWERS = [P.POPPY, P.DANDELION, P.CORNFLOWER, P.DAISY, P.ALLIUM, P.TULIP_ORANGE, P.TULIP_PINK, P.LAVENDER, P.BUTTERCUP];

  // ---------------------------------------------------------------------------
  // Tree / structure builders. Output: flat array [x, y, z, id, ...]
  // ---------------------------------------------------------------------------
  function leafBlob(out, cx, cy, cz, rx, ry, rz, id, rng, holes) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
          const d = dx * dx + dy * dy + dz * dz;
          if (d <= 1 && !(d > 0.55 && rng() < holes)) out.push(x, y, z, id);
        }
  }
  function oak(x, y, z, rng, out) {
    const th = 4 + Math.floor(rng() * 3), top = y + th;
    leafBlob(out, x, top - 0.5, z, 2.6, 2.1, 2.6, B.OAK_LEAVES, rng, 0.35);
    leafBlob(out, x, top + 1.2, z, 1.6, 1.0, 1.6, B.OAK_LEAVES, rng, 0.3);
    const nb = 1 + Math.floor(rng() * 2);
    for (let b = 0; b < nb; b++) {
      const a = rng() * Math.PI * 2, dx = Math.round(Math.cos(a)), dz = Math.round(Math.sin(a));
      if (!dx && !dz) continue;
      const by = top - 2 + Math.floor(rng() * 2);
      out.push(x + dx, by, z + dz, B.OAK_LOG, x + dx * 2, by + 1, z + dz * 2, B.OAK_LOG);
      leafBlob(out, x + dx * 2, by + 1.6, z + dz * 2, 1.7, 1.3, 1.7, B.OAK_LEAVES, rng, 0.3);
    }
    for (let i = 0; i < th; i++) out.push(x, y + i, z, B.OAK_LOG);
  }
  function birch(x, y, z, rng, out) {
    const th = 6 + Math.floor(rng() * 3), top = y + th;
    leafBlob(out, x, top - 1.5, z, 2.1, 2.6, 2.1, B.BIRCH_LEAVES, rng, 0.3);
    leafBlob(out, x, top + 0.5, z, 1.2, 1.0, 1.2, B.BIRCH_LEAVES, rng, 0.2);
    if (rng() < 0.6) { const s = rng() < 0.5 ? 1 : -1; out.push(x + s, y + th - 3, z, B.BIRCH_LOG); }
    for (let i = 0; i < th; i++) out.push(x, y + i, z, B.BIRCH_LOG);
  }
  function bigOak(x, y, z, rng, out) {
    const th = 7 + Math.floor(rng() * 4), top = y + th;
    leafBlob(out, x, top, z, 3.3, 2.4, 3.3, B.OAK_LEAVES, rng, 0.4);
    const nb = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rng() * 0.8;
      const by = y + Math.floor(th * (0.45 + rng() * 0.35));
      const len = 3 + Math.floor(rng() * 2);
      let px = x, pz = z, py = by;
      for (let s = 1; s <= len; s++) {
        px = Math.round(x + Math.cos(a) * s); pz = Math.round(z + Math.sin(a) * s); py = by + Math.floor(s * 0.6);
        out.push(px, py, pz, B.OAK_LOG);
      }
      leafBlob(out, px, py + 1, pz, 2.4, 1.6, 2.4, B.OAK_LEAVES, rng, 0.35);
    }
    for (let i = 0; i < th; i++) out.push(x, y + i, z, B.OAK_LOG);
    const roots = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of roots) if (rng() < 0.6) out.push(x + dx, y, z + dz, B.OAK_LOG);
  }
  function spruce(x, y, z, rng, out) {
    const th = 8 + Math.floor(rng() * 4), top = y + th;
    out.push(x, top, z, B.SPRUCE_LEAVES, x, top + 1, z, B.SPRUCE_LEAVES);
    for (let yy = top - 1; yy >= y + 2; yy--) {
      const layer = top - yy;
      const r = layer % 2 === 0 ? Math.min(3, 1 + Math.floor(layer / 3)) : Math.max(1, Math.min(3, Math.floor(layer / 3)));
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if ((dx === 0 && dz === 0) || dx * dx + dz * dz > r * r + 0.5 || rng() < 0.08) continue;
        out.push(x + dx, yy, z + dz, B.SPRUCE_LEAVES);
      }
    }
    for (let i = 0; i < th; i++) out.push(x, y + i, z, B.SPRUCE_LOG);
  }
  function bush(x, y, z, rng, out, leaves) {
    out.push(x, y, z, leaves);
    leafBlob(out, x, y + 0.2, z, 1.4, 0.9, 1.4, leaves, rng, 0.45);
    if (rng() < 0.5) out.push(x, y + 1, z, leaves);
  }
  function boulder(x, h, z, rng, out, big) {
    const mats = [B.STONE, B.COBBLE, B.MOSSY_COBBLE, B.STONE];
    const pick = () => mats[Math.floor(rng() * mats.length)];
    out.push(x, h, z, pick() | FORCE, x, h + 1, z, pick());
    const n = big ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const dx = Math.floor(rng() * 3) - 1, dz = Math.floor(rng() * 3) - 1, dy = rng() < 0.4 ? 1 : 0;
      out.push(x + dx, h + dy, z + dz, pick() | (dy === 0 ? FORCE : 0));
    }
    if (big) out.push(x, h + 2, z, pick());
  }

  // ---------------------------------------------------------------------------
  class TerrainGen {
    constructor(seed) {
      this.seed = seed | 0;
      const S = N.Simplex, s = this.seed;
      this.nWarp = new S(s ^ 0x6006); this.nCont = new S(s ^ 0x1001); this.nHill = new S(s ^ 0x2002);
      this.nMask = new S(s ^ 0x3003); this.nRoll = new S(s ^ 0x4004); this.nRiver = new S(s ^ 0x5005);
      this.nForest = new S(s ^ 0x7007); this.nFlower = new S(s ^ 0x8008); this.nDetail = new S(s ^ 0x9009);
      this.nLake = new S(s ^ 0xa00a); this.nSoil = new S(s ^ 0xb00b); this.nTint = new S(s ^ 0xc00c);
      this.nPalette = new S(s ^ 0xd00d);
      this.col = { h: 0, river: 0, forest: 0, hill: 0 };
      this.cache = new Map();
      this.hm = new Int16Array(18 * 18);
      this.riv = new Float32Array(18 * 18);
      this.fr = new Float32Array(18 * 18);
      this.hl = new Float32Array(18 * 18);
    }

    riverValue(x, z) {
      const wx = x + this.nWarp.noise2D(x * 0.0042, z * 0.0042) * 26;
      const wz = z + this.nWarp.noise2D(z * 0.0042 + 31.7, x * 0.0042 - 17.3) * 26;
      return fbm(this.nRiver, wx / 620, wz / 620, 3);
    }

    /** Continuous column description. Returns a shared object: copy what you need. */
    sample(x, z) {
      const c = this.col;
      const wx = x + this.nWarp.noise2D(x * 0.0042, z * 0.0042) * 26;
      const wz = z + this.nWarp.noise2D(z * 0.0042 + 31.7, x * 0.0042 - 17.3) * 26;
      const cont = fbm(this.nCont, wx / 900, wz / 900, 3);
      let h = SEA + 7 + cont * 8;
      const hill = smooth(-0.08, 0.5, fbm(this.nMask, wx / 420, wz / 420, 2));
      const hn = fbm(this.nHill, wx / 140, wz / 140, 4) * 0.5 + 0.5;
      const ridge = 1 - Math.abs(this.nHill.noise2D(wx / 310 + 100, wz / 310 - 100));
      h += (Math.pow(hn, 1.55) * 36 + ridge * ridge * ridge * 12) * hill;
      h += fbm(this.nRoll, wx / 52, wz / 52, 3) * (2.0 + hill * 2.6);
      h += this.nDetail.noise2D(x / 13, z / 13) * 0.55;
      const lk = fbm(this.nLake, x / 230, z / 230, 2);
      if (lk > 0.38) h -= (lk - 0.38) * 48 * (1 - hill * 0.5);
      let river = 0;
      const rv = Math.abs(fbm(this.nRiver, wx / 620, wz / 620, 3));
      const RW = 0.06;
      if (rv < RW) {
        const t = rv / RW;
        if (t < 0.36) {
          const q = t / 0.36;
          h = Math.min(h, SEA - 3.2 + q * q * 3.7);
        } else {
          const floor = SEA + 0.5 + (t - 0.36) * 7;
          const lo = Math.min(h, floor);
          h = lo + (h - lo) * smooth(0.36, 1, t);
        }
        river = 1 - t;
      }
      c.h = h; c.river = river; c.hill = hill;
      c.forest = river > 0.45 ? 0 : smooth(0.1, 0.36, fbm(this.nForest, x / 250, z / 250, 3));
      return c;
    }
    heightAt(x, z) { return Math.max(2, Math.min(CY - 24, Math.floor(this.sample(x, z).h))); }

    /** Subtle grass colour variation (multipliers around 1.0). */
    tintAt(x, z, out) {
      const n = this.nTint.noise2D(x / 160, z / 160), m = this.nTint.noise2D(x / 37 + 50, z / 37);
      const dry = N.clamp(n * 0.6 + m * 0.25, -1, 1);
      out[0] = 1 + dry * 0.09; out[1] = 1 + m * 0.035; out[2] = 1 - dry * 0.12;
      return out;
    }

    riverFlow(x, z, out) {
      const e = 2;
      const gx = this.riverValue(x + e, z) - this.riverValue(x - e, z);
      const gz = this.riverValue(x, z + e) - this.riverValue(x, z - e);
      let fx = -gz, fz = gx;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len; fz /= len;
      if (fx * 0.83 + fz * 0.55 < 0) { fx = -fx; fz = -fz; }
      out[0] = fx; out[1] = fz;
      return out;
    }

    biomeAt(x, z) {
      const c = this.sample(x, z);
      if (c.h < SEA) return c.river > 0.3 ? 'River' : 'Lake';
      if (c.river > 0.5) return 'Riverbank';
      if (c.forest > 0.5) return 'Forest';
      if (c.hill > 0.55) return 'Highlands';
      return fbm(this.nFlower, x / 30, z / 30, 2) > 0.2 ? 'Flower Meadow' : 'Open Meadow';
    }

    ore(x, y, z) {
      const s = this.seed;
      if (y < 64 && N.hash3(x >> 1, y >> 1, z >> 1, s + 301) < 0.018 && N.hash3(x, y, z, s + 302) < 0.65) return B.COAL_ORE;
      if (y < 22 && N.hash3(x >> 1, y >> 1, z >> 1, s + 305) < 0.0045 && N.hash3(x, y, z, s + 306) < 0.6) return B.DIAMOND_ORE;   // rare, deep
      if (y < 44 && N.hash3(x >> 1, y >> 1, z >> 1, s + 303) < 0.009 && N.hash3(x, y, z, s + 304) < 0.6) return B.IRON_ORE;
      return B.STONE;
    }

    // ----- structures (cached because neighbouring chunks share them) -----
    structure(kind, gx, gz) {
      const key = (kind * 4000003 + gx + 2000000) * 4000003 + gz + 2000000;
      if (this.cache.has(key)) return this.cache.get(key);
      if (this.cache.size > 6000) this.cache.clear();
      let res = null;
      const s = this.seed;
      const cell = kind === 0 ? TREE_CELL : kind === 1 ? BUSH_CELL : ROCK_CELL;
      const r = N.hash2(gx, gz, s + 101 + kind * 17);
      const x = gx * cell + Math.floor(N.hash2(gx, gz, s + 102 + kind * 17) * cell);
      const z = gz * cell + Math.floor(N.hash2(gx, gz, s + 103 + kind * 17) * cell);
      const c = this.sample(x, z);
      const h = Math.floor(c.h), forest = c.forest, hill = c.hill, river = c.river;
      let density;
      const highland = hill > 0.55 && h > SEA + 22;
      if (kind === 0) density = highland ? Math.max(0.2, 0.03 + forest * 0.58) : 0.03 + forest * 0.58;
      else if (kind === 1) density = 0.06 + forest * 0.22;
      else density = 0.03 + hill * 0.24;
      if (r < density && h > SEA + 1 && river < 0.3 && h < 92) {
        const hx = Math.floor(this.sample(x + 1, z).h), hz = Math.floor(this.sample(x, z + 1).h);
        const hx2 = Math.floor(this.sample(x - 1, z).h), hz2 = Math.floor(this.sample(x, z - 1).h);
        const slope = Math.max(Math.abs(hx - h), Math.abs(hz - h), Math.abs(hx2 - h), Math.abs(hz2 - h));
        if (slope <= 1) {
          const rng = N.mulberry32(N.hashInt(gx, 7 + kind, gz, s + 104));
          const out = [];
          let type = kind;
          if (kind === 0) {
            const q = rng();
            if (highland) { if (q < 0.8) spruce(x, h + 1, z, rng, out); else birch(x, h + 1, z, rng, out); type = 'tree'; }
            else if (forest > 0.5) { if (q < 0.52) oak(x, h + 1, z, rng, out); else if (q < 0.88) birch(x, h + 1, z, rng, out); else bigOak(x, h + 1, z, rng, out); }
            else if (q < 0.58) oak(x, h + 1, z, rng, out); else if (q < 0.8) birch(x, h + 1, z, rng, out); else bigOak(x, h + 1, z, rng, out);
          } else if (kind === 1) {
            bush(x, h + 1, z, rng, out, rng() < 0.75 ? B.OAK_LEAVES : B.BIRCH_LEAVES);
          } else {
            boulder(x, h, z, rng, out, hill > 0.5 && rng() < 0.6);
          }
          res = { x, z, h, type, blocks: out };
        }
      }
      this.cache.set(key, res);
      return res;
    }

    stamp(ch, list) {
      const x0 = ch.x0, z0 = ch.z0, blocks = ch.blocks, water = ch.water;
      for (let i = 0; i < list.length; i += 4) {
        const lx = list[i] - x0, y = list[i + 1], lz = list[i + 2] - z0;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= CY) continue;
        const idx = lx + lz * 16 + y * 256, raw = list[i + 3], id = raw & 255, cur = blocks[idx];
        if (raw & FORCE) { if (cur !== B.BEDROCK) { blocks[idx] = id; water[idx] = 0; } }
        else if (isLeaves(id)) { if (cur === 0 && !water[idx]) blocks[idx] = id; }
        else if (cur === 0 || isLeaves(cur)) { blocks[idx] = id; water[idx] = 0; }
      }
    }

    placeStructures(ch) {
      const kinds = [[0, TREE_CELL, 6], [1, BUSH_CELL, 2], [2, ROCK_CELL, 2]];
      for (const [kind, cell, margin] of kinds) {
        const gx0 = Math.floor((ch.x0 - margin) / cell), gx1 = Math.floor((ch.x0 + 15 + margin) / cell);
        const gz0 = Math.floor((ch.z0 - margin) / cell), gz1 = Math.floor((ch.z0 + 15 + margin) / cell);
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
          const st = this.structure(kind, gx, gz);
          if (st) this.stamp(ch, st.blocks);
        }
      }
    }

    meadowFlower(wx, wz) {
      const s = this.seed, q = N.hash2(wx, wz, s + 600);
      if (q < 0.1) return MEADOW_FLOWERS[Math.floor((q / 0.1) * MEADOW_FLOWERS.length)];
      const pn = this.nPalette.noise2D(wx / 70, wz / 70) * 0.5 + 0.5;
      const pal = PALETTES[Math.floor(((pn * 2.3) % 1) * PALETTES.length)];
      return pal[Math.floor(N.hash2(wx, wz, s + 601) * pal.length)];
    }

    placePlants(ch) {
      const s = this.seed, hm = this.hm, fr = this.fr, riv = this.riv, blocks = ch.blocks, water = ch.water;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const base = lx + lz * 16;
        // the real top may differ from the heightmap (trees, boulders): find it
        let h = hm[(lx + 1) + (lz + 1) * 18];
        while (h + 1 < CY && blocks[base + (h + 1) * 256] !== 0) h++;
        if (h + 1 >= CY) continue;
        const above = base + (h + 1) * 256;
        if (water[above]) continue;
        const top = blocks[base + h * 256];
        const wx = ch.x0 + lx, wz = ch.z0 + lz, k = (lx + 1) + (lz + 1) * 18;
        const r = N.hash3(wx, h, wz, s + 500);
        const forest = fr[k], meadow = 1 - forest;
        let type = 0;
        if (top === B.GRASS) {
          const fp = fbm(this.nFlower, wx / 30, wz / 30, 2) + this.nFlower.noise2D(wx / 9, wz / 9) * 0.18;
          const flowerP = Math.min(0.62, 0.03 + Math.max(0, fp - 0.12) * 1.35) * (0.25 + 0.75 * meadow);
          const nearWater = h <= SEA + 2 && riv[k] > 0.15;
          if (nearWater && r < 0.2) type = P.REED;
          else if (r < flowerP) {
            if (forest > 0.5) type = N.hash2(wx, wz, s + 602) < 0.62 ? P.BLUEBELL : [P.DAISY, P.POPPY, P.ALLIUM][Math.floor(N.hash2(wx, wz, s + 603) * 3)];
            else type = this.meadowFlower(wx, wz);
          } else {
            const r2 = (r - flowerP) / (1 - flowerP);
            if (forest > 0.4) {
              if (r2 < 0.2) type = P.FERN;
              else if (r2 < 0.225) type = N.hash2(wx, wz, s + 604) < 0.5 ? P.MUSHROOM_RED : P.MUSHROOM_BROWN;
              else if (r2 < 0.6) type = P.GRASS;
            } else {
              const tallP = 0.08 + 0.24 * Math.max(0, this.nFlower.noise2D(wx / 17 + 40, wz / 17));
              if (r2 < tallP) type = P.TALL_GRASS;
              else if (r2 < tallP + 0.62) type = P.GRASS;
            }
          }
        } else if (top === B.SAND && h >= SEA && h <= SEA + 1 && r < 0.12) {
          type = P.REED;
        } else if (top === B.SNOW && r < 0.15) {
          type = P.GRASS;
        }
        if (type) ch.plants.set(above, type | ((N.hashInt(wx, h, wz, s + 501) & 255) << 8));
      }
    }

    placeSprings(ch) {
      const s = this.seed, hm = this.hm, hl = this.hl;
      const gx0 = Math.floor(ch.x0 / SPRING_CELL), gx1 = Math.floor((ch.x0 + 15) / SPRING_CELL);
      const gz0 = Math.floor(ch.z0 / SPRING_CELL), gz1 = Math.floor((ch.z0 + 15) / SPRING_CELL);
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        if (N.hash2(gx, gz, s + 700) > 0.45) continue;
        const sx = gx * SPRING_CELL + Math.floor(N.hash2(gx, gz, s + 701) * SPRING_CELL);
        const sz = gz * SPRING_CELL + Math.floor(N.hash2(gx, gz, s + 702) * SPRING_CELL);
        const lx = sx - ch.x0, lz = sz - ch.z0;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
        const k = (lx + 1) + (lz + 1) * 18, h = hm[k];
        if (h < SEA + 9 || hl[k] < 0.2) continue;
        const nbr = [hm[k + 1], hm[k - 1], hm[k + 18], hm[k - 18]];
        const lower = nbr.some((v) => v < h), cliff = nbr.some((v) => Math.abs(v - h) > 3);
        if (!lower || cliff) continue;
        const idx = lx + lz * 16 + h * 256;
        if (ch.blocks[idx] !== B.GRASS || ch.blocks[idx + 256] !== 0) continue;
        ch.blocks[idx] = 0;
        ch.water[idx] = WATER_SOURCE;
        ch.plants.delete(idx + 256);
        ch.springs.push(idx);
      }
    }

    /** Fills a freshly created chunk. */
    generate(ch) {
      const x0 = ch.x0, z0 = ch.z0, s = this.seed;
      const hm = this.hm, riv = this.riv, fr = this.fr, hl = this.hl;
      for (let dz = -1; dz <= 16; dz++) for (let dx = -1; dx <= 16; dx++) {
        const c = this.sample(x0 + dx, z0 + dz), k = (dx + 1) + (dz + 1) * 18;
        hm[k] = Math.max(2, Math.min(CY - 24, Math.floor(c.h)));
        riv[k] = c.river; fr[k] = c.forest; hl[k] = c.hill;
      }
      const blocks = ch.blocks, water = ch.water;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const k = (lx + 1) + (lz + 1) * 18, h = hm[k];
        const wx = x0 + lx, wz = z0 + lz, base = lx + lz * 16;
        ch.river[base] = riv[k];
        const slope = Math.max(Math.abs(hm[k + 1] - hm[k - 1]), Math.abs(hm[k + 18] - hm[k - 18]));
        const soil = 3 + ((N.hash2(wx, wz, s + 11) * 2.4) | 0);
        const sn = this.nSoil.noise2D(wx / 24, wz / 24);
        let top, sub;
        if (h < SEA - 1) { top = sn > 0.35 ? B.GRAVEL : sn < -0.45 ? B.CLAY : B.SAND; sub = top === B.CLAY ? B.CLAY : B.SAND; }
        else if (h <= SEA + 1) { top = sn > 0.55 && riv[k] > 0.2 ? B.GRAVEL : B.SAND; sub = B.SAND; }
        else if (slope >= 4 && hl[k] > 0.25) { top = sn > 0.4 ? B.GRAVEL : B.STONE; sub = B.STONE; }
        else if (h > 90 + sn * 4) { top = B.SNOW; sub = B.DIRT; }
        else { top = B.GRASS; sub = B.DIRT; }
        blocks[base] = B.BEDROCK;
        if (N.hash3(wx, 1, wz, s) < 0.5) blocks[base + 256] = B.BEDROCK;
        for (let y = 1; y <= h; y++) {
          const i = base + y * 256;
          if (blocks[i]) continue;
          let id = y === h ? top : y > h - soil ? sub : B.STONE;
          if (id === B.STONE) id = this.ore(wx, y, wz);
          blocks[i] = id;
        }
        for (let y = h + 1; y <= SEA; y++) water[base + y * 256] = WATER_SOURCE;
      }
      this.placeStructures(ch);
      this.placePlants(ch);
      this.placeSprings(ch);
    }

    // ----- spawn search -----
    spawnScore(x, z) {
      const c = this.sample(x, z);
      const h = Math.floor(c.h), forest = c.forest, river = c.river, hill = c.hill;
      if (h <= SEA + 2 || h > SEA + 30 || forest > 0.12 || river > 0) return -100;
      let maxd = 0;
      const probes = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [2, -2], [-2, 2]];
      for (const [dx, dz] of probes) maxd = Math.max(maxd, Math.abs(Math.floor(this.sample(x + dx, z + dz).h) - h));
      if (maxd > 2) return -50;
      for (let kind = 0; kind < 3; kind++) {
        const cell = kind === 0 ? TREE_CELL : kind === 1 ? BUSH_CELL : ROCK_CELL;
        const R = kind === 0 ? 6 : 3;
        for (let gz = Math.floor((z - R) / cell); gz <= Math.floor((z + R) / cell); gz++)
          for (let gx = Math.floor((x - R) / cell); gx <= Math.floor((x + R) / cell); gx++) {
            const st = this.structure(kind, gx, gz);
            if (st && Math.hypot(st.x - x, st.z - z) < R) return -40;
          }
      }
      const flowers = fbm(this.nFlower, x / 30, z / 30, 2);
      return 3 - maxd + flowers * 2.2 - hill * 2;
    }

    findSpawn() {
      let best = { x: 0, z: 0 }, bestScore = -1e9;
      for (let ring = 0; ring <= 120; ring++) {
        const steps = ring === 0 ? 1 : ring * 6;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = Math.round(Math.cos(a) * ring * 9), z = Math.round(Math.sin(a) * ring * 9);
          const sc = this.spawnScore(x, z);
          if (sc > bestScore) { bestScore = sc; best = { x, z }; }
        }
        if (bestScore > 2.6 && ring >= 2) break;
      }
      return { x: best.x + 0.5, y: this.heightAt(best.x, best.z) + 1, z: best.z + 0.5 };
    }
  }

  OM.TerrainGen = TerrainGen;
  OM.TerrainGen.WATER_SOURCE = WATER_SOURCE;
})();
