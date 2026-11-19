/* Open Meadow — engine/noise.js
 * Seeded random numbers, coordinate hashing and simplex noise.
 * Pure math, no Three.js dependency. Everything here is deterministic for a
 * given seed so the same world is produced every time a chunk is rebuilt. */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});

  /** Small, fast seeded PRNG. Returns a function producing floats in [0, 1). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 32-bit integer hash of integer coordinates. */
  function hashInt(x, y, z, seed) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^
            Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return h >>> 0;
  }
  const hash3 = (x, y, z, seed) => hashInt(x, y, z, seed) / 4294967296;
  const hash2 = (x, z, seed) => hashInt(x, 0x5bd1e995, z, seed) / 4294967296;

  // ---------------------------------------------------------------------------
  // Simplex noise (after Stefan Gustavson's public-domain reference version)
  // ---------------------------------------------------------------------------
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const F3 = 1 / 3;
  const G3 = 1 / 6;
  const GRAD3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);

  class Simplex {
    constructor(seed) {
      const rand = mulberry32(seed);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = p[i]; p[i] = p[j]; p[j] = t;
      }
      this.perm = new Uint8Array(512);
      this.pm12 = new Uint8Array(512);
      for (let i = 0; i < 512; i++) {
        this.perm[i] = p[i & 255];
        this.pm12[i] = this.perm[i] % 12;
      }
    }

    /** 2D simplex noise in roughly [-1, 1]. */
    noise2D(xin, yin) {
      const perm = this.perm, pm = this.pm12;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 > 0) {
        const g = pm[ii + perm[jj]] * 3; t0 *= t0;
        n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0);
      }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 > 0) {
        const g = pm[ii + i1 + perm[jj + j1]] * 3; t1 *= t1;
        n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1);
      }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 > 0) {
        const g = pm[ii + 1 + perm[jj + 1]] * 3; t2 *= t2;
        n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2);
      }
      return 70 * n;
    }

    /** 3D simplex noise in roughly [-1, 1]. */
    noise3D(xin, yin, zin) {
      const perm = this.perm, pm = this.pm12;
      const s = (xin + yin + zin) * F3;
      const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3;
      const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      let n = 0;
      let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 > 0) {
        const g = pm[ii + perm[jj + perm[kk]]] * 3; t0 *= t0;
        n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
      }
      let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 > 0) {
        const g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1;
        n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
      }
      let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 > 0) {
        const g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2;
        n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
      }
      let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 > 0) {
        const g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3;
        n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
      }
      return 32 * n;
    }
  }

  /** Fractal (fBm) 2D noise normalised to roughly [-1, 1]. */
  function fbm2(n, x, y, octaves, lacunarity, gain) {
    const lac = lacunarity || 2, g = gain || 0.5;
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += n.noise2D(x * f + o * 31.7, y * f - o * 17.3) * amp;
      norm += amp;
      amp *= g;
      f *= lac;
    }
    return sum / norm;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  OM.Noise = { mulberry32, hashInt, hash2, hash3, Simplex, fbm2, clamp, lerp, smoothstep };
})();
