/* Open Meadow — engine/textures.js
 * Every texture in the game is painted procedurally at start-up, so the
 * project needs no image files. Produces:
 *   - block atlas (32px tiles with 16px wrap padding so mipmaps don't bleed)
 *   - plant atlas (64px grass / flower / fern sprites)
 *   - mining crack strip, water normal map, butterfly wing texture
 *   - inventory icons (isometric block renders, plant sprites, buckets)    */
(function () {
  'use strict';
  const OM = window.OM;
  const N = OM.Noise;

  const TS = 32, PAD = 16, CELL = 64, COLS = 8;

  // ---------------------------------------------------------------------------
  // Pixel tile helper
  // ---------------------------------------------------------------------------
  class Tile {
    constructor(seed, size) {
      this.s = size || TS;
      this.d = new Uint8ClampedArray(this.s * this.s * 4);
      this.rng = N.mulberry32(seed * 7919 + 13);
    }
    r() { return this.rng(); }
    idx(x, y) { const s = this.s; x = ((x % s) + s) % s; y = ((y % s) + s) % s; return (y * s + x) * 4; }
    set(x, y, c, a) {
      const i = this.idx(Math.round(x), Math.round(y)), d = this.d;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a === undefined ? 255 : a;
    }
    get(x, y) { const i = this.idx(x, y), d = this.d; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
    alpha(x, y, a) { this.d[this.idx(x, y) + 3] = a; }
    each(fn) { for (let y = 0; y < this.s; y++) for (let x = 0; x < this.s; x++) this.set(x, y, fn(x, y)); }
    /** Tileable smooth value noise with `period` lattice cells across the tile. */
    lattice(period) {
      const L = new Float32Array(period * period);
      for (let i = 0; i < L.length; i++) L[i] = this.r();
      const s = this.s;
      return (px, py) => {
        const x = (px / s) * period, y = (py / s) * period;
        const xi = Math.floor(x), yi = Math.floor(y);
        let fx = x - xi, fy = y - yi;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
        const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
        const a = L[y0 * period + x0], b = L[y0 * period + x1], c = L[y1 * period + x0], e = L[y1 * period + x1];
        return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
      };
    }
    disc(cx, cy, rad, c, a) {
      for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
        for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++)
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) this.set(x, y, c, a);
    }
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const jit = (t, c, amt) => { const k = 1 + (t.r() - 0.5) * amt; return mul(c, k); };

  // ---------------------------------------------------------------------------
  // Block tile painters
  // ---------------------------------------------------------------------------
  function pDirt(t) {
    const n = t.lattice(8), m = t.lattice(16);
    t.each((x, y) => {
      const v = n(x, y) * 0.65 + m(x, y) * 0.35, r = t.r();
      if (r < 0.06) return [86, 60, 40];
      if (r < 0.1) return [148, 110, 78];
      return jit(t, mix([98, 68, 45], [140, 102, 70], v), 0.1);
    });
  }
  function pGrassTop(t) {
    const n = t.lattice(8), m = t.lattice(16);
    t.each((x, y) => {
      const v = n(x, y) * 0.6 + m(x, y) * 0.4, r = t.r();
      let c = mix([62, 118, 38], [112, 172, 62], v);
      if (r < 0.1) c = mul(c, 1.16); else if (r < 0.17) c = mul(c, 0.8);
      return jit(t, c, 0.08);
    });
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(t.r() * 32), y = Math.floor(t.r() * 32);
      const c = mul(t.get(x, y), 1.18);
      t.set(x, y, c); t.set(x, y + 1, mul(c, 0.94));
    }
  }
  function pCapOverlay(t, top, len) {
    for (let x = 0; x < 32; x++) {
      const L = len[0] + Math.floor(t.r() * len[1]) + (t.r() < 0.25 ? 2 : 0);
      for (let y = 0; y < L; y++) t.set(x, y, mul(top(x, y), 1 - (y / L) * 0.22));
      if (t.r() < 0.5) t.set(x, L, mul(top(x, L), 0.7));
    }
  }
  function pGrassSide(t) {
    pDirt(t);
    const g = new Tile(991); pGrassTop(g);
    pCapOverlay(t, (x, y) => g.get(x, y), [4, 5]);
  }
  function pStone(t) {
    const n = t.lattice(8), m = t.lattice(16);
    t.each((x, y) => { const v = 104 + (n(x, y) * 0.6 + m(x, y) * 0.4) * 44 + (t.r() - 0.5) * 10; return [v, v, v + 2]; });
    for (let s = 0; s < 7; s++) {
      let x = t.r() * 32, y = t.r() * 32;
      for (let k = 0; k < 9; k++) {
        const c = t.get(x | 0, y | 0); t.set(x, y, mul(c, 0.8));
        x += t.r() * 2 - 0.5; y += t.r() - 0.5;
      }
    }
  }
  function pSand(t) {
    const n = t.lattice(8);
    t.each((x, y) => {
      const r = t.r();
      if (r < 0.09) return [196, 182, 138];
      if (r < 0.14) return [238, 226, 186];
      return jit(t, mix([210, 196, 150], [228, 214, 170], n(x, y)), 0.05);
    });
  }
  function pGravel(t) {
    t.each(() => jit(t, [104, 100, 96], 0.12));
    for (let i = 0; i < 30; i++) {
      const cx = t.r() * 32, cy = t.r() * 32, rad = 1.4 + t.r() * 2.4, g = 84 + t.r() * 96;
      const c = [g + t.r() * 12, g, g - t.r() * 10];
      t.disc(cx, cy, rad, c);
      t.set(cx - rad * 0.4, cy - rad * 0.4, mul(c, 1.2));
      t.set(cx + rad * 0.5, cy + rad * 0.5, mul(c, 0.75));
    }
  }
  function pClay(t) {
    const n = t.lattice(4);
    t.each((x, y) => jit(t, mix([150, 156, 170], [170, 176, 188], n(x, y) * 0.7 + Math.sin(y * 0.7) * 0.15 + 0.15), 0.04));
  }
  function pBark(t, dark, light, grooveEvery) {
    const n = t.lattice(8);
    t.each((x, y) => {
      const v = n(x, y * 0.25);
      let c = mix(dark, light, v);
      if (x % grooveEvery === 0 || t.r() < 0.04) c = mul(c, 0.7);
      return jit(t, c, 0.12);
    });
  }
  function pRings(t, a, b, rim) {
    const n = t.lattice(4);
    t.each((x, y) => {
      const dx = x - 15.5, dy = y - 15.5;
      const d = (Math.max(Math.abs(dx), Math.abs(dy)) + Math.hypot(dx, dy)) / 2;
      if (d > 13.6) return jit(t, rim, 0.12);
      const ring = (Math.sin(d * 1.4 + n(x, y) * 2.5) + 1) / 2;
      return jit(t, mix(a, b, ring), 0.05);
    });
  }
  function pLeaves(t, dark, light, holes) {
    const n = t.lattice(8), m = t.lattice(4);
    t.each((x, y) => {
      let c = mix(dark, light, n(x, y) * 0.7 + t.r() * 0.3);
      if (m(x, y) < 0.35) c = mul(c, 0.82);
      return jit(t, c, 0.1);
    });
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (t.r() < holes) t.alpha(x, y, 0);
  }
  function pPlanks(t, base) {
    const n = t.lattice(16);
    const shades = [0, 1, 2, 3].map(() => 0.9 + t.r() * 0.18);
    t.each((x, y) => {
      const board = Math.floor(y / 8);
      if (y % 8 === 7) return mul(base, 0.68);
      if (x === (board * 11 + 5) % 32) return mul(base, 0.76);
      const grain = n((x * 0.5 + board * 9) % 32, y * 3 % 32);
      return jit(t, mul(base, shades[board] * (0.88 + grain * 0.22)), 0.05);
    });
  }
  function pCobble(t, moss) {
    const pts = [];
    for (let i = 0; i < 14; i++) pts.push([t.r() * 32, t.r() * 32, 0.72 + t.r() * 0.42]);
    const mn = t.lattice(8);
    t.each((x, y) => {
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let i = 0; i < pts.length; i++) {
        let dx = Math.abs(x - pts[i][0]), dy = Math.abs(y - pts[i][1]);
        if (dx > 16) dx = 32 - dx; if (dy > 16) dy = 32 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
      let c;
      if (d2 - d1 < 1.3) c = jit(t, [82, 82, 82], 0.12);
      else {
        c = mul([128, 128, 128], pts[id][2]);
        if (d1 < 2.2) c = mul(c, 1.1);
        c = jit(t, c, 0.1);
      }
      if (moss) {
        const m = mn(x, y) + (d2 - d1 < 1.3 ? 0.2 : 0);
        if (m > 0.55) c = mix(c, jit(t, [70, 112, 46], 0.15), N.smoothstep(0.55, 0.75, m));
      }
      return c;
    });
  }
  function pGlass(t) {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const edge = x === 0 || y === 0 || x === 31 || y === 31;
      const streak = (x - y === 6 || x - y === 7) && x > 3 && x < 14 || (x - y === 14 && x > 18 && x < 25);
      t.set(x, y, edge ? [206, 226, 234] : [236, 246, 250], edge || streak ? 255 : 0);
    }
  }
  function pBricks(t) {
    const n = t.lattice(8);
    t.each((x, y) => {
      const row = Math.floor(y / 8), off = (row % 2) * 8, bx = Math.floor((x + off) / 16);
      if (y % 8 === 7 || (x + off) % 16 === 15) return jit(t, [176, 170, 160], 0.06);
      const h = N.hash2(row, bx & 1, 77);
      return jit(t, mul([150, 72, 54], 0.84 + h * 0.3 + (n(x, y) - 0.5) * 0.12), 0.06);
    });
  }
  function pOre(t, colors) {
    pStone(t);
    for (let i = 0; i < 6; i++) {
      const cx = t.r() * 32, cy = t.r() * 32;
      for (let k = 0; k < 5; k++) t.disc(cx + t.r() * 3 - 1.5, cy + t.r() * 3 - 1.5, 0.9 + t.r() * 0.8, colors[k % colors.length]);
    }
  }
  function pBedrock(t) {
    const n = t.lattice(8);
    t.each((x, y) => { const v = 26 + n(x, y) * 50 + t.r() * 34; return [v, v, v]; });
  }
  function pSnow(t) {
    const n = t.lattice(8);
    t.each((x, y) => jit(t, mix([226, 234, 244], [246, 250, 254], n(x, y)), 0.025));
  }
  function pSnowSide(t) {
    pDirt(t);
    const s = new Tile(555); pSnow(s);
    pCapOverlay(t, (x, y) => s.get(x, y), [5, 4]);
  }
  function pStoneBricks(t) {
    const n = t.lattice(8);
    t.each((x, y) => {
      const row = Math.floor(y / 16), off = (row % 2) * 8, lx = (x + off) % 16, ly = y % 16;
      if (ly === 15 || lx === 15) return jit(t, [88, 88, 88], 0.08);
      let v = 116 + n(x, y) * 26;
      if (ly === 0 || lx === 0) v += 14; else if (ly === 14 || lx === 14) v -= 16;
      return jit(t, [v, v, v + 1], 0.06);
    });
  }

  function pCraftTop(t) {
    pPlanks(t, [174, 140, 86]);
    const rim = [96, 70, 42], line = [112, 82, 50];
    for (let i = 0; i < 32; i++) for (const k of [0, 1, 30, 31]) { t.set(i, k, rim); t.set(k, i, rim); }
    for (let i = 2; i < 30; i++) for (const k of [10, 21]) { t.set(i, k, line); t.set(k, i, line); }
    // a few inlaid squares so the grid reads as a work surface
    for (const [cx, cy, c] of [[5, 5, [196, 70, 58]], [26, 26, [70, 112, 196]], [26, 5, [92, 154, 84]]]) {
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) t.set(cx + x, cy + y, mul(c, 1 - (Math.abs(x) + Math.abs(y)) * 0.04));
    }
  }
  function pCraftSide(t) {
    pPlanks(t, [166, 132, 82]);
    const rim = [96, 70, 42];
    for (let i = 0; i < 32; i++) { t.set(i, 0, rim); t.set(i, 1, rim); t.set(i, 31, mul(rim, 0.85)); t.set(0, i, rim); t.set(31, i, rim); }
    for (let y = 2; y < 6; y++) for (let x = 1; x < 31; x++) t.set(x, y, mul([150, 116, 70], 0.9 + (y - 2) * 0.03));
    // a saw (left) and a hammer (right) hanging below the top rail
    for (let y = 8; y < 25; y++) for (let x = 6; x < 15; x++) t.set(x, y, x === 6 || x === 14 ? [120, 124, 132] : mul([198, 202, 210], 0.92 + ((x + y) % 3) * 0.04));
    for (let x = 6; x < 15; x += 2) t.set(x, 25, [120, 124, 132]);
    for (let y = 8; y < 14; y++) for (let x = 7; x < 14; x++) t.set(x, y, [112, 82, 50]);
    for (let y = 9; y < 27; y++) { t.set(22, y, [120, 88, 52]); t.set(23, y, [146, 110, 68]); }
    for (let y = 8; y < 14; y++) for (let x = 17; x < 29; x++) t.set(x, y, mul(x > 25 ? [96, 100, 108] : [176, 180, 190], y === 8 ? 1.12 : 1));
  }
  function pFurnaceTop(t) {
    pStone(t);
    t.each((x, y) => { const c = t.get(x, y); return mix([c[0], c[1], c[2]], [150, 150, 156], 0.35); });
    for (let i = 0; i < 32; i++) for (const k of [0, 1, 2]) { const c = mul([84, 84, 90], 1 - k * 0.1); t.set(i, k, c); t.set(i, 31 - k, c); t.set(k, i, c); t.set(31 - k, i, c); }
    for (let y = 9; y < 23; y++) for (let x = 9; x < 23; x++) t.set(x, y, mul([30, 30, 34], 1 + ((x + y) % 4) * 0.05));
    for (let y = 9; y < 23; y++) { t.set(9, y, [62, 62, 68]); t.set(22, y, [62, 62, 68]); }
    for (let x = 9; x < 23; x++) { t.set(x, 9, [62, 62, 68]); t.set(x, 22, [62, 62, 68]); }
  }
  function pFurnaceSide(t) {
    pCobble(t, false);
    t.each((x, y) => { const c = t.get(x, y); return mix([c[0], c[1], c[2]], [138, 138, 144], 0.3); });
    for (let i = 0; i < 32; i++) { t.set(i, 0, [84, 84, 90]); t.set(i, 1, [100, 100, 106]); t.set(0, i, [96, 96, 102]); t.set(31, i, [96, 96, 102]); }
    for (let y = 14; y < 27; y++) for (let x = 8; x < 24; x++) t.set(x, y, mul([22, 20, 22], 1 + ((x * 3 + y) % 5) * 0.03));
    for (let x = 6; x < 26; x++) { t.set(x, 12, [66, 66, 72]); t.set(x, 13, [54, 54, 60]); }
    for (let y = 12; y < 27; y++) { t.set(6, y, [66, 66, 72]); t.set(7, y, [54, 54, 60]); t.set(24, y, [54, 54, 60]); t.set(25, y, [66, 66, 72]); }
    for (let x = 9; x < 23; x++) {                                                 // embers glowing at the bottom of the mouth
      const h = 1 + Math.floor((Math.sin(x * 1.7) + 1.3) * 1.6);
      for (let k = 0; k < h; k++) t.set(x, 26 - k, k === 0 ? [236, 130, 36] : mix([236, 130, 36], [250, 214, 90], k / h));
    }
  }
  function pDiamondOre(t) {
    pStone(t);
    const gem = [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3]];
    for (let i = 0; i < 6; i++) {
      const cx = 2 + Math.floor(t.r() * 26), cy = 2 + Math.floor(t.r() * 26);
      for (const [dx, dy] of gem) {
        const c = dx === 1 && dy === 1 ? [214, 252, 250] : (dx >= 2 && dy >= 2) || dy === 3 ? [36, 158, 172] : [88, 224, 228];
        t.set(cx + dx, cy + dy, c);
      }
    }
  }

  function pLava(t) {
    const a = t.lattice(4), b = t.lattice(8), c = t.lattice(16);
    t.each((x, y) => {
      const v = a(x, y) * 0.5 + b(x, y) * 0.32 + c(x, y) * 0.18;
      let col = v < 0.38 ? mix([96, 26, 10], [196, 58, 12], v / 0.38) : mix([226, 92, 14], [255, 214, 70], Math.min(1, (v - 0.38) / 0.4));
      if (t.r() < 0.04) col = mul(col, 1.18);
      return jit(t, col, 0.05);
    });
  }
  function pObsidian(t) {
    const n = t.lattice(8), m = t.lattice(16);
    t.each((x, y) => {
      const v = n(x, y) * 0.6 + m(x, y) * 0.4;
      return jit(t, mix([16, 10, 30], [52, 34, 84], v), 0.1);
    });
    for (let i = 0; i < 9; i++) {                      // glassy streaks
      let x = t.r() * 32, y = t.r() * 32;
      const dx = t.r() < 0.5 ? 1 : -1;
      for (let k = 0; k < 6 + t.r() * 8; k++) { t.set(x, y, [112, 82, 172]); t.set(x + 1, y, [64, 44, 108]); x += dx; y += 0.7; }
    }
  }

  const PAINTERS = {
    grass_top: pGrassTop, grass_side: pGrassSide, dirt: pDirt, stone: pStone, sand: pSand, gravel: pGravel, clay: pClay,
    oak_log: (t) => pBark(t, [82, 62, 38], [120, 94, 60], 5),
    oak_log_top: (t) => pRings(t, [150, 116, 70], [186, 150, 96], [92, 70, 44]),
    oak_leaves: (t) => pLeaves(t, [42, 90, 28], [88, 142, 52], 0.1),
    birch_log: (t) => {
      const n = t.lattice(8);
      t.each((x, y) => jit(t, mix([206, 202, 192], [228, 224, 216], n(x, y)), 0.04));
      for (let i = 0; i < 16; i++) {
        const y = Math.floor(t.r() * 32), x0 = Math.floor(t.r() * 32), len = 2 + Math.floor(t.r() * 5);
        for (let k = 0; k < len; k++) { t.set(x0 + k, y, [40, 38, 36]); if (t.r() < 0.4) t.set(x0 + k, y + 1, [70, 66, 62]); }
      }
    },
    birch_log_top: (t) => pRings(t, [206, 188, 146], [228, 212, 174], [214, 210, 200]),
    birch_leaves: (t) => pLeaves(t, [84, 128, 46], [138, 176, 72], 0.1),
    spruce_log: (t) => pBark(t, [56, 40, 26], [88, 64, 40], 4),
    spruce_log_top: (t) => pRings(t, [118, 88, 54], [148, 114, 72], [60, 44, 28]),
    spruce_leaves: (t) => pLeaves(t, [26, 58, 38], [58, 98, 64], 0.08),
    planks: (t) => pPlanks(t, [166, 134, 82]),
    cobble: (t) => pCobble(t, false),
    mossy_cobble: (t) => pCobble(t, true),
    glass: pGlass, bricks: pBricks,
    coal_ore: (t) => pOre(t, [[34, 34, 36], [52, 52, 54], [24, 24, 26]]),
    iron_ore: (t) => pOre(t, [[214, 172, 130], [188, 140, 102], [230, 196, 160]]),
    bedrock: pBedrock, snow: pSnow, snow_side: pSnowSide, stone_bricks: pStoneBricks,
    birch_planks: (t) => pPlanks(t, [206, 186, 134]),
    crafting_table_top: pCraftTop, crafting_table_side: pCraftSide,
    furnace_top: pFurnaceTop, furnace_side: pFurnaceSide, diamond_ore: pDiamondOre,
    lava: pLava, obsidian: pObsidian
  };

  function buildBlockAtlas() {
    const names = OM.TILES, rows = Math.ceil(names.length / COLS);
    const W = COLS * CELL, H = rows * CELL;
    const data = new Uint8ClampedArray(W * H * 4);
    const uv = new Float32Array(names.length * 4);
    const avg = [];
    names.forEach((name, i) => {
      const t = new Tile(i + 1);
      PAINTERS[name](t);
      const col = i % COLS, row = Math.floor(i / COLS);
      for (let py = -PAD; py < TS + PAD; py++) {
        for (let px = -PAD; px < TS + PAD; px++) {
          const s = t.idx(px, py);
          const d = ((row * CELL + PAD + py) * W + (col * CELL + PAD + px)) * 4;
          data[d] = t.d[s]; data[d + 1] = t.d[s + 1]; data[d + 2] = t.d[s + 2]; data[d + 3] = t.d[s + 3];
        }
      }
      uv[i * 4] = (col * CELL + PAD) / W; uv[i * 4 + 1] = (row * CELL + PAD) / H;
      uv[i * 4 + 2] = (col * CELL + PAD + TS) / W; uv[i * 4 + 3] = (row * CELL + PAD + TS) / H;
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < t.d.length; k += 4) if (t.d[k + 3] > 128) { r += t.d[k]; g += t.d[k + 1]; b += t.d[k + 2]; n++; }
      avg[i] = n ? [r / n, g / n, b / n] : [200, 200, 200];
    });
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    const tex = new THREE.DataTexture(new Uint8Array(data.buffer), W, H, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return { texture: tex, canvas, uv, avg, cell: CELL, pad: PAD, size: TS, cols: COLS };
  }

  // ---------------------------------------------------------------------------
  // Plant sprites (canvas vector drawing, then colour dilation for clean mips)
  // ---------------------------------------------------------------------------
  const PS = 64;
  const css = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a === undefined ? 1 : a})`;

  function blade(ctx, x, yb, tx, ty, w, c) {
    ctx.fillStyle = css(c);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, yb);
    ctx.quadraticCurveTo(x - w * 0.2 + (tx - x) * 0.25, (yb + ty) / 2, tx, ty);
    ctx.quadraticCurveTo(x + w * 0.2 + (tx - x) * 0.25, (yb + ty) / 2, x + w / 2, yb);
    ctx.closePath(); ctx.fill();
  }
  function stem(ctx, x0, y0, x1, y1, bend, w, c) {
    ctx.strokeStyle = css(c); ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1); ctx.stroke();
  }
  function ellipseAt(ctx, x, y, rx, ry, rot, c) {
    ctx.fillStyle = css(c); ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rot, 0, Math.PI * 2); ctx.fill();
  }
  function petals(ctx, cx, cy, n, len, wid, c, rot) {
    for (let i = 0; i < n; i++) {
      const a = (rot || 0) + (i / n) * Math.PI * 2;
      ellipseAt(ctx, cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5 * 0.8, len * 0.5, wid * 0.5, a, c);
    }
  }
  function leafPair(ctx, x, y, len, c, rng) {
    ellipseAt(ctx, x - len * 0.45, y, len * 0.5, len * 0.16, -0.5 - rng() * 0.3, c);
    ellipseAt(ctx, x + len * 0.45, y + 4, len * 0.5, len * 0.16, 0.5 + rng() * 0.3, mul(c, 0.9));
  }
  function flowerBase(ctx, rng, headY, leafColor) {
    const lc = leafColor || [64, 128, 44];
    stem(ctx, 32, 63, 32 + (rng() - 0.5) * 6, headY, (rng() - 0.5) * 8, 2.4, [70, 128, 48]);
    leafPair(ctx, 32, 48 + rng() * 6, 16 + rng() * 6, lc, rng);
  }

  const PLANT_PAINTERS = {
    p_grass(ctx, rng) {
      for (let i = 0; i < 16; i++) {
        const x = 8 + rng() * 48, h = 18 + rng() * 34, lean = (rng() - 0.5) * 18;
        blade(ctx, x, 64, x + lean, 64 - h, 2.6 + rng() * 2.2, mix([52, 104, 34], [120, 178, 66], rng()));
      }
    },
    p_tallgrass(ctx, rng) {
      for (let i = 0; i < 20; i++) {
        const x = 6 + rng() * 52, h = 30 + rng() * 32, lean = (rng() - 0.5) * 22;
        blade(ctx, x, 64, x + lean, 64 - h, 2.4 + rng() * 2.4, mix([50, 100, 32], [128, 180, 70], rng()));
      }
      for (let i = 0; i < 2; i++) {
        const x = 18 + rng() * 28, top = 3 + rng() * 8, tx = x + (rng() - 0.5) * 6;
        stem(ctx, x, 64, tx, top, (rng() - 0.5) * 8, 1.2, [128, 150, 78]);
        for (let k = 0; k < 5; k++) ellipseAt(ctx, tx + (k % 2 ? 1.6 : -1.6), top + 1.5 + k * 2.4, 1.3, 2.2, k % 2 ? 0.5 : -0.5, mix([150, 146, 92], [186, 172, 110], rng()));
      }
    },
    p_fern(ctx, rng) {
      for (let f = 0; f < 6; f++) {
        const ang = -Math.PI / 2 + (f - 2.5) * 0.36 + (rng() - 0.5) * 0.2;
        const len = 34 + rng() * 22;
        const ex = 32 + Math.cos(ang) * len, ey = 64 + Math.sin(ang) * len;
        stem(ctx, 32, 64, ex, ey, (ex - 32) * 0.2, 1.6, [60, 110, 40]);
        for (let k = 2; k < 12; k++) {
          const t = k / 12, px = 32 + (ex - 32) * t, py = 64 + (ey - 64) * t;
          const l = (1 - t) * 9 + 2;
          const c = mix([46, 98, 34], [96, 156, 60], rng());
          ellipseAt(ctx, px - l * 0.5, py, l * 0.55, 1.6, ang + 1.2, c);
          ellipseAt(ctx, px + l * 0.5, py, l * 0.55, 1.6, ang - 1.2, c);
        }
      }
    },
    p_poppy(ctx, rng) {
      flowerBase(ctx, rng, 16);
      petals(ctx, 32, 15, 5, 15, 13, [206, 30, 28], rng());
      petals(ctx, 32, 15, 5, 9, 9, [232, 54, 40], rng());
      ellipseAt(ctx, 32, 15, 3, 3, 0, [36, 24, 20]);
    },
    p_dandelion(ctx, rng) {
      flowerBase(ctx, rng, 18, [72, 132, 40]);
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        stem(ctx, 32, 17, 32 + Math.cos(a) * 9, 17 + Math.sin(a) * 7.5, 0, 2.2, mix([246, 196, 30], [255, 224, 70], rng()));
      }
      ellipseAt(ctx, 32, 17, 4, 3.4, 0, [232, 168, 22]);
    },
    p_cornflower(ctx, rng) {
      flowerBase(ctx, rng, 16);
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + rng() * 0.2;
        blade(ctx, 32, 15, 32 + Math.cos(a) * 12, 15 + Math.sin(a) * 9, 5, mix([60, 90, 214], [98, 132, 240], rng()));
      }
      ellipseAt(ctx, 32, 15, 3, 2.6, 0, [44, 40, 120]);
    },
    p_daisy(ctx, rng) {
      flowerBase(ctx, rng, 17);
      petals(ctx, 32, 16, 14, 13, 4.2, [250, 250, 244], rng());
      ellipseAt(ctx, 32, 16, 4, 3.6, 0, [242, 186, 36]);
    },
    p_allium(ctx, rng) {
      stem(ctx, 32, 63, 32 + (rng() - 0.5) * 4, 18, (rng() - 0.5) * 6, 2.2, [80, 132, 60]);
      leafPair(ctx, 32, 56, 18, [70, 124, 52], rng);
      for (let i = 0; i < 60; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 10.5;
        ellipseAt(ctx, 32 + Math.cos(a) * r, 15 + Math.sin(a) * r * 0.9, 1.7, 1.7, 0, mix([150, 70, 196], [206, 126, 236], rng()));
      }
    },
    p_tulip_orange(ctx, rng) { tulip(ctx, rng, [236, 112, 26], [250, 160, 60]); },
    p_tulip_pink(ctx, rng) { tulip(ctx, rng, [232, 110, 160], [250, 170, 206]); },
    p_lavender(ctx, rng) {
      for (let s = 0; s < 3; s++) {
        const x = 22 + s * 10 + (rng() - 0.5) * 4, top = 3 + rng() * 8;
        stem(ctx, 32, 63, x, top, (rng() - 0.5) * 4, 1.7, [96, 128, 84]);
        for (let k = 0; k < 13; k++) {
          const py = top + k * 2.1, px = x + (32 - x) * (k / 40);
          ellipseAt(ctx, px - 1.5, py, 1.9, 1.5, 0, mix([128, 92, 200], [176, 136, 230], rng()));
          ellipseAt(ctx, px + 1.5, py + 1, 1.9, 1.5, 0, mix([118, 84, 190], [166, 126, 226], rng()));
        }
      }
      leafPair(ctx, 32, 56, 14, [96, 132, 86], rng);
    },
    p_buttercup(ctx, rng) {
      const heads = [[20, 30], [34, 20], [46, 32]];
      for (const [hx, hy] of heads) {
        stem(ctx, 32, 63, hx, hy, (rng() - 0.5) * 10, 1.6, [80, 136, 50]);
        petals(ctx, hx, hy, 5, 8, 7, [255, 218, 30], rng());
        ellipseAt(ctx, hx - 1, hy - 1, 1.2, 1.2, 0, [255, 250, 200]);
      }
      leafPair(ctx, 32, 52, 14, [70, 130, 44], rng);
    },
    p_bluebell(ctx, rng) {
      ctx.strokeStyle = css([76, 130, 56]); ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(30, 63); ctx.quadraticCurveTo(28, 14, 44, 14); ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const t = 0.35 + k * 0.15, bx = 30 + (44 - 30) * t * t + 2, by = 63 - (63 - 14) * Math.min(1, t * 1.3) + 9;
        ellipseAt(ctx, bx, by, 3.6, 5, 0.2, mix([80, 80, 200], [124, 116, 230], rng()));
      }
      for (let i = 0; i < 4; i++) blade(ctx, 24 + i * 6, 64, 20 + i * 8, 34 + rng() * 10, 4, [60, 120, 46]);
    },
    p_reed(ctx, rng) {
      for (let i = 0; i < 8; i++) {
        const x = 16 + rng() * 32, h = 34 + rng() * 26;
        blade(ctx, x, 64, x + (rng() - 0.5) * 18, 64 - h, 3.4, mix([70, 116, 46], [118, 160, 72], rng()));
      }
      for (let s = 0; s < 2; s++) {
        const x = 26 + s * 12;
        stem(ctx, x, 64, x + (rng() - 0.5) * 4, 4, 0, 1.6, [110, 130, 70]);
        ellipseAt(ctx, x, 16 + s * 5, 3.6, 9, 0, [112, 70, 40]);
      }
    },
    p_mushroom_red(ctx) {
      ellipseAt(ctx, 32, 50, 5, 14, 0, [234, 224, 206]);
      ctx.fillStyle = css([200, 36, 32]); ctx.beginPath(); ctx.ellipse(32, 40, 20, 14, 0, Math.PI, 0); ctx.fill();
      for (const [x, y] of [[24, 33], [34, 30], [42, 36], [30, 37]]) ellipseAt(ctx, x, y, 2.6, 2, 0, [246, 240, 230]);
    },
    p_mushroom_brown(ctx) {
      ellipseAt(ctx, 32, 50, 4.6, 14, 0, [226, 214, 194]);
      ctx.fillStyle = css([146, 106, 72]); ctx.beginPath(); ctx.ellipse(32, 41, 18, 10, 0, Math.PI, 0); ctx.fill();
      ellipseAt(ctx, 32, 41, 18, 2.5, 0, [120, 86, 58]);
    }
  };
  function tulip(ctx, rng, a, b) {
    flowerBase(ctx, rng, 20, [76, 136, 56]);
    ellipseAt(ctx, 27, 16, 6, 10, -0.25, a);
    ellipseAt(ctx, 37, 16, 6, 10, 0.25, a);
    ellipseAt(ctx, 32, 15, 6, 11, 0, b);
  }

  /** Copies colour into fully transparent pixels next to opaque ones so that
   *  mipmapped alpha-tested sprites do not get dark halos. */
  function dilate(data, W, H, iterations) {
    for (let it = 0; it < iterations; it++) {
      const src = data.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (src[i + 3] > 8) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = (ny * W + nx) * 4;
          if (src[j + 3] > 8 || (src[j] | src[j + 1] | src[j + 2])) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
        }
        if (n) { data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; }
      }
    }
  }

  function buildPlantAtlas() {
    const names = OM.PLANT_TILES, rows = Math.ceil(names.length / COLS);
    const W = COLS * PS, H = rows * PS;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const uv = new Float32Array(names.length * 4);
    names.forEach((name, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      ctx.save();
      ctx.beginPath(); ctx.rect(col * PS + 1, row * PS, PS - 2, PS); ctx.clip();
      ctx.translate(col * PS, row * PS);
      PLANT_PAINTERS[name](ctx, N.mulberry32(i * 131 + 7));
      ctx.restore();
      uv[i * 4] = (col * PS + 0.5) / W; uv[i * 4 + 1] = (row * PS + 0.5) / H;
      uv[i * 4 + 2] = (col * PS + PS - 0.5) / W; uv[i * 4 + 3] = (row * PS + PS - 0.5) / H;
    });
    const img = ctx.getImageData(0, 0, W, H);
    for (let k = 3; k < img.data.length; k += 4) img.data[k] = img.data[k] > 110 ? 255 : 0;
    dilate(img.data, W, H, 4);
    const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer.slice(0)), W, H, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return { texture: tex, canvas, uv, size: PS, cols: COLS };
  }

  // ---------------------------------------------------------------------------
  // Mining cracks, water normals, butterfly wings
  // ---------------------------------------------------------------------------
  function buildCracks() {
    const c = document.createElement('canvas');
    c.width = 32 * 10; c.height = 32;
    const ctx = c.getContext('2d');
    const rng = N.mulberry32(4242);
    const lines = [];
    for (let s = 0; s < 10; s++) {
      for (let k = 0; k < 3; k++) {
        let x = 16 + (rng() - 0.5) * 10, y = 16 + (rng() - 0.5) * 10;
        const pts = [[x, y]];
        const a0 = rng() * Math.PI * 2;
        for (let j = 0; j < 4 + s; j++) { const a = a0 + (rng() - 0.5) * 1.6; x += Math.cos(a) * 2.6; y += Math.sin(a) * 2.6; pts.push([x, y]); }
        lines.push({ s, pts });
      }
    }
    for (let f = 0; f < 10; f++) {
      ctx.save(); ctx.beginPath(); ctx.rect(f * 32, 0, 32, 32); ctx.clip();
      ctx.strokeStyle = 'rgba(10,10,10,0.85)'; ctx.lineWidth = 1.2; ctx.lineCap = 'square';
      for (const l of lines) {
        if (l.s > f) continue;
        ctx.beginPath(); ctx.moveTo(f * 32 + l.pts[0][0], l.pts[0][1]);
        for (const p of l.pts) ctx.lineTo(f * 32 + p[0], p[1]);
        ctx.stroke();
      }
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.repeat.set(0.1, 1);
    return tex;
  }

  function buildWaterNormals() {
    const S = 256, rng = N.mulberry32(9001);
    const waves = [];
    for (let i = 0; i < 14; i++) {
      let kx = Math.round((rng() - 0.5) * 14), ky = Math.round((rng() - 0.5) * 14);
      if (kx === 0 && ky === 0) kx = 1;
      waves.push([kx, ky, rng() * Math.PI * 2, 1 / Math.sqrt(kx * kx + ky * ky)]);
    }
    const hgt = new Float32Array(S * S);
    let mn = 1e9, mx = -1e9;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let h = 0;
      for (const [kx, ky, ph, a] of waves) h += Math.sin(((kx * x + ky * y) / S) * Math.PI * 2 + ph) * a;
      hgt[y * S + x] = h; if (h < mn) mn = h; if (h > mx) mx = h;
    }
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      let nx = -hx * 2.2, ny = -hy * 2.2, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = ((hgt[y * S + x] - mn) / (mx - mn)) * 255;
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /** Right butterfly wing, body at x = 0. R = wing, G = pattern, B = veins. */
  function buildWingTexture() {
    const S = 64, data = new Uint8Array(S * S * 4);
    const inEllipse = (x, y, cx, cy, rx, ry, rot) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      const dx = x - cx, dy = y - cy, u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
      return u * u + v * v;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const e1 = inEllipse(x, y, 30, 22, 31, 19, -0.45);
      const e2 = inEllipse(x, y, 22, 45, 22, 15, 0.35);
      const e = Math.min(e1, e2);
      const i = (y * S + x) * 4;
      if (e > 1 || x < 2) { data[i + 3] = 0; continue; }
      const edge = e > 0.62 ? 255 : 0;
      const spot = (inEllipse(x, y, 44, 14, 4, 3, 0) < 1 || inEllipse(x, y, 36, 26, 3.5, 3, 0) < 1 || inEllipse(x, y, 28, 48, 4, 3.4, 0) < 1) ? 255 : 0;
      const ang = Math.atan2(y - 32, x);
      const vein = Math.abs(Math.sin(ang * 7.5)) > 0.94 && x > 6 ? 200 : 0;
      data[i] = 255; data[i + 1] = Math.max(edge, spot); data[i + 2] = vein; data[i + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  // ---------------------------------------------------------------------------
  // Inventory icons
  // ---------------------------------------------------------------------------
  function buildIcons(block, plant) {
    const B = OM.Blocks.defs;
    const S = 64;
    const tileSrc = (tile) => {
      const col = tile % block.cols, row = Math.floor(tile / block.cols);
      return [col * block.cell + block.pad, row * block.cell + block.pad];
    };
    const face = (ctx, tile, m, shade) => {
      const [sx, sy] = tileSrc(tile);
      ctx.save();
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(block.canvas, sx, sy, 32, 32, 0, 0, 32, 32);
      if (shade > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(0, 0, 32, 32);
      }
      ctx.restore();
    };
    for (const item of OM.Items.defs) {
      if (!item) continue;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      if (item.kind === 'block') {
        const d = B[item.block];
        // Each face is drawn on its own layer so 'source-atop' shading only darkens that face.
        const layer = (tile, m, shade) => {
          const lc = document.createElement('canvas'); lc.width = S; lc.height = S;
          const lctx = lc.getContext('2d'); lctx.imageSmoothingEnabled = false;
          face(lctx, tile, m, shade);
          ctx.drawImage(lc, 0, 0);
        };
        layer(d.tiles[2], [0.875, 0.4375, 0, 0.875, 4, 18], 0.2);
        layer(d.tiles[2], [0.875, -0.4375, 0, 0.875, 32, 32], 0.36);
        layer(d.tiles[0], [0.875, -0.4375, 0.875, 0.4375, 4, 18], 0);
      } else if (item.kind === 'plant') {
        const t = OM.Plants.defs[item.plant].tile;
        const col = t % plant.cols, row = Math.floor(t / plant.cols);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(plant.canvas, col * plant.size, row * plant.size, plant.size, plant.size, 2, 2, S - 4, S - 4);
      } else if (item.kind === 'tool') {
        const tier = OM.Crafting ? OM.Crafting.TIERS[item.tierIdx] : null;
        drawSprite(ctx, toolSprite(item.tool, tier ? tier.color : [180, 180, 180]));
      } else if (item.kind === 'material') {
        drawSprite(ctx, materialSprite(item.material));
      } else {
        drawBucket(ctx, item.kind === 'water_bucket');
      }
      item.icon = c.toDataURL();
    }
  }

  // ---- 16x16 pixel-art sprites for tools and materials (drawn at 4x with an automatic outline)
  const OUTLINE = [28, 22, 20];
  class Sprite {
    constructor() { this.g = new Array(256).fill(null); }
    p(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < 16 && y >= 0 && y < 16) this.g[y * 16 + x] = c; }
    at(x, y) { return x >= 0 && x < 16 && y >= 0 && y < 16 ? this.g[y * 16 + x] : null; }
    line(x0, y0, x1, y1, c, c2) {                       // c = main colour, c2 = shadow pixel to the right
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * (n ? i / n : 0), y = y0 + (y1 - y0) * (n ? i / n : 0);
        if (c2) this.p(x + 1, y, c2);
        this.p(x, y, c);
      }
    }
    poly(pts, c) {                                       // fill by pixel-centre point-in-polygon
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const px = x + 0.5, py = y + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.p(x, y, c);
      }
    }
    outline() {
      const out = this.g.slice();
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (this.g[y * 16 + x]) continue;
        if (this.at(x - 1, y) || this.at(x + 1, y) || this.at(x, y - 1) || this.at(x, y + 1)) out[y * 16 + x] = OUTLINE;
      }
      this.g = out;
    }
  }
  function drawSprite(ctx, sp) {
    sp.outline();
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = sp.g[y * 16 + x];
      if (!c) continue;
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  }
  const HANDLE = [[172, 128, 72], [118, 82, 46]];
  function toolSprite(kind, col) {
    const s = new Sprite();
    const hi = mix(col, [255, 255, 255], 0.35), lo = mul(col, 0.66);
    if (kind === 'sword') {
      s.line(3, 12, 6, 9, HANDLE[0], HANDLE[1]);                           // grip
      s.line(2, 13, 2, 13, [210, 180, 90]);                                // pommel
      s.line(4, 8, 8, 12, [150, 120, 70], [104, 82, 50]);                  // cross-guard
      for (let i = 0; i < 8; i++) { s.p(7 + i, 8 - i, hi); s.p(8 + i, 8 - i, col); s.p(9 + i, 8 - i, lo); }
      s.p(14, 0, hi); s.p(15, 0, col);
      return s;
    }
    s.line(2, 14, 11, 5, HANDLE[0], HANDLE[1]);                            // shaft
    if (kind === 'pickaxe') {
      for (let a = -96; a <= 6; a += 3) {                                  // arc around the shaft's upper end
        const r = a * Math.PI / 180;
        for (let d = 6.4; d <= 8.7; d += 0.5) {
          const x = 5 + Math.cos(r) * d, y = 11 + Math.sin(r) * d;
          s.p(x, y, d < 7.2 ? lo : d > 8.1 ? hi : col);
        }
      }
    } else if (kind === 'axe') {
      s.poly([[5.2, 2.4], [10.5, 1.4], [12.5, 4.2], [11.8, 8.6], [9.6, 8.8], [9.2, 6.0], [6.4, 5.2]], col);
      s.line(5, 3, 10, 2, hi);
      s.line(6, 6, 9, 6, lo);
      s.line(10, 8, 12, 5, lo);
      s.line(11, 5, 11, 5, HANDLE[0]);
    } else {                                                                // shovel
      s.poly([[9.2, 1.2], [14.4, 3.6], [14.0, 7.4], [10.6, 8.4], [8.0, 5.0]], col);
      s.line(10, 2, 13, 4, hi);
      s.line(13, 5, 12, 7, lo);
      s.line(9, 6, 11, 7, lo);
    }
    return s;
  }
  function materialSprite(key) {
    const s = new Sprite();
    if (key === 'stick') {
      s.line(3, 13, 12, 4, HANDLE[0], HANDLE[1]);
      s.p(12, 3, [196, 156, 96]);
    } else if (key === 'coal' || key === 'raw_iron') {
      const base = key === 'coal' ? [48, 48, 54] : [176, 134, 108];
      const hi = key === 'coal' ? [112, 112, 124] : [222, 184, 148], lo = key === 'coal' ? [22, 22, 26] : [122, 88, 70];
      s.poly([[3, 7], [5, 3.2], [10, 2.6], [13.2, 6], [12.6, 11.4], [8, 13.4], [4, 11.6]], base);
      s.poly([[4, 7], [5.6, 4.2], [8.4, 3.8], [6.6, 7.2]], hi);
      s.poly([[8, 13], [12, 11], [12.4, 8], [9, 9.6]], lo);
      if (key === 'raw_iron') { s.p(9, 5, [236, 206, 166]); s.p(6, 9, [140, 100, 78]); s.p(10, 8, [226, 190, 150]); s.p(5, 6, [128, 92, 72]); }
      else { s.p(6, 5, [180, 180, 196]); s.p(9, 7, [78, 78, 90]); }
    } else if (key === 'iron_ingot') {
      s.poly([[2, 8], [6, 4.6], [14, 4.6], [10, 8]], [238, 240, 244]);
      s.poly([[2, 8], [10, 8], [10, 12.4], [2, 12.4]], [196, 200, 210]);
      s.poly([[10, 8], [14, 4.6], [14, 9], [10, 12.4]], [146, 150, 162]);
      s.line(3, 9, 9, 9, [226, 230, 238]);
    } else if (key === 'diamond') {
      s.poly([[3, 6], [5, 3], [8, 3], [8, 6]], [170, 252, 252]);
      s.poly([[8, 3], [11, 3], [13, 6], [8, 6]], [100, 228, 236]);
      s.poly([[3, 6], [8, 6], [8, 13.4]], [54, 194, 210]);
      s.poly([[8, 6], [13, 6], [8, 13.4]], [32, 148, 176]);
      s.p(6, 4, [255, 255, 255]); s.p(5, 5, [220, 255, 255]);
    } else {                                                                // flint
      s.poly([[4, 10.4], [6.6, 4], [10.4, 5.4], [12.6, 10.6], [8.6, 13.2]], [74, 78, 90]);
      s.poly([[6.6, 4.4], [9.8, 5.8], [8, 9], [5.6, 9.6]], [124, 130, 146]);
      s.poly([[8.6, 13], [12.4, 10.6], [10.4, 8], [8, 9.6]], [44, 46, 56]);
    }
    return s;
  }
  function drawBucket(ctx, water) {
    ctx.imageSmoothingEnabled = true;
    ctx.lineWidth = 3; ctx.strokeStyle = '#5c6670';
    ctx.beginPath(); ctx.arc(32, 26, 17, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    const g = ctx.createLinearGradient(14, 0, 50, 0);
    g.addColorStop(0, '#8d98a3'); g.addColorStop(0.45, '#dfe6ec'); g.addColorStop(1, '#78838e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(13, 24); ctx.lineTo(51, 24); ctx.lineTo(46, 56); ctx.lineTo(18, 56); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#4c555e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = water ? '#2f7fd0' : '#3b434b';
    ctx.beginPath(); ctx.ellipse(32, 24, 19, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (water) { ctx.fillStyle = 'rgba(190,230,255,0.85)'; ctx.beginPath(); ctx.ellipse(26, 23, 6, 1.6, 0, 0, Math.PI * 2); ctx.fill(); }
  }

  OM.Textures = {
    build(renderer) {
      const maxAniso = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
      const block = buildBlockAtlas();
      block.texture.anisotropy = Math.min(4, maxAniso);
      const plant = buildPlantAtlas();
      const cracks = buildCracks();
      const waterNormals = buildWaterNormals();
      const wing = buildWingTexture();
      buildIcons(block, plant);
      return { block, plant, cracks, waterNormals, wing };
    }
  };
})();
