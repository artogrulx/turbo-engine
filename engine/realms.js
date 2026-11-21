/* Open Meadow — engine/realms.js
 * The other worlds and the doors between them.
 *   EmberGen  – the Ashlands: a roofed cavern of ashstone with a lava sea, glowing emberstone and cinder-brick citadels
 *   EndGen    – the Void Isle: one floating island of voidstone ringed by obsidian pillars
 *   Portals   – finding / lighting / collapsing an obsidian portal frame, building arrival shrines, standing places
 * Generators implement the same small interface as TerrainGen (generate, tintAt, riverFlow, sample, heightAt,
 * biomeAt, findSpawn), so World can swap them in without knowing which realm it is drawing.               */
(function () {
  'use strict';
  const OM = window.OM, B = OM.B, N = OM.Noise;
  const { CY } = OM.CONST;
  const FORCE = 256;
  const LAVA_LEVEL = 36, CITADEL_CELL = 112, ISLE_TOP = 60;

  function fbm(n, x, z, oct) {
    let s = 0, a = 1, f = 1, t = 0;
    for (let i = 0; i < oct; i++) { s += n.noise2D(x * f, z * f) * a; t += a; a *= 0.5; f *= 2; }
    return s / t;
  }

  /** Shared stand-ins for the parts of the generator interface that only the meadow cares about. */
  class RealmGen {
    constructor() { this.col = { h: 0, river: 0, forest: 0, hill: 0 }; }
    tintAt(x, z, out) { out[0] = out[1] = out[2] = 1; }
    riverFlow(x, z, out) { out[0] = out[1] = 0; }
    sample(x, z) { this.col.h = this.heightAt(x, z); return this.col; }
  }

  // =============================================================== the Ashlands
  class EmberGen extends RealmGen {
    constructor(seed) {
      super();
      this.seed = seed | 0;
      const S = N.Simplex, s = this.seed ^ 0x7e57;
      this.nFloor = new S(s ^ 0x111); this.nDetail = new S(s ^ 0x222); this.nRoof = new S(s ^ 0x333); this.nPillar = new S(s ^ 0x444);
      this.citadels = new Map();
      this.realm = 'ember';
      this.minLight = 0.72;
    }
    floorAt(x, z) { return Math.floor(36 + fbm(this.nFloor, x / 70, z / 70, 3) * 17 + this.nDetail.noise2D(x / 14, z / 14) * 2.2); }
    roofAt(x, z) {
      let r = 112 + fbm(this.nRoof, x / 50, z / 50, 2) * 8;
      const p = this.nPillar.noise2D(x / 9, z / 9);
      if (p > 0.6) r -= (p - 0.6) * 75;                          // stalactites
      return Math.floor(r);
    }
    heightAt(x, z) { return this.floorAt(x, z); }
    biomeAt() { return 'Ashlands'; }

    generate(ch) {
      const s = this.seed, blocks = ch.blocks;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const wx = ch.x0 + lx, wz = ch.z0 + lz, base = lx + lz * 16;
        const f = Math.max(3, Math.min(100, this.floorAt(wx, wz))), r = Math.max(f + 8, Math.min(CY - 6, this.roofAt(wx, wz)));
        blocks[base] = B.BEDROCK;
        if (N.hash3(wx, 1, wz, s) < 0.5) blocks[base + 256] = B.BEDROCK;
        for (let y = 1; y <= f; y++) {
          const i = base + y * 256;
          if (blocks[i]) continue;
          blocks[i] = y < f - 1 && y > 2 && N.hash3(wx >> 1, y >> 1, wz >> 1, s + 11) < 0.014 && N.hash3(wx, y, wz, s + 12) < 0.6 ? B.ASH_ORE : B.ASHSTONE;   // ember ore, buried in the ash
        }
        for (let y = f + 1; y <= LAVA_LEVEL; y++) blocks[base + y * 256] = B.LAVA;
        for (let y = r; y < CY - 1; y++) blocks[base + y * 256] = B.ASHSTONE;
        blocks[base + (CY - 1) * 256] = B.BEDROCK;
        // glowing patches: on the ceiling's underside and as nodes on the floor
        if (N.hash2(wx >> 1, wz >> 1, s + 5) < 0.07) { blocks[base + r * 256] = B.EMBERSTONE; if (N.hash2(wx, wz, s + 6) < 0.5) blocks[base + (r - 1) * 256] = B.EMBERSTONE; }
        if (f > LAVA_LEVEL && N.hash2(wx >> 2, wz >> 2, s + 7) < 0.035 && N.hash2(wx, wz, s + 8) < 0.5) blocks[base + f * 256] = B.EMBERSTONE;
      }
      this.placeCitadels(ch);
    }

    // ----- cinder-brick citadels: crossing bridges and a central hall (shared by neighbouring chunks, so cached) -----
    citadel(gx, gz) {
      const key = (gx + 100000) * 200003 + gz + 100000;
      if (this.citadels.has(key)) return this.citadels.get(key);
      if (this.citadels.size > 400) this.citadels.clear();
      let res = null;
      const s = this.seed;
      if (N.hash2(gx, gz, s + 801) < 0.6) {
        const cx = gx * CITADEL_CELL + 32 + Math.floor(N.hash2(gx, gz, s + 802) * (CITADEL_CELL - 64));
        const cz = gz * CITADEL_CELL + 32 + Math.floor(N.hash2(gx, gz, s + 803) * (CITADEL_CELL - 64));
        const by = 46, out = [];
        const put = (x, y, z, id) => out.push(x, y, z, id | FORCE);
        const wall = (x, y, z) => put(x, y, z, B.CINDERBRICK);
        // corridors along X and along Z: floor, walls with windows, roof, clear interior
        for (const axis of [0, 1]) {
          for (let u = -24; u <= 24; u++) for (let v = -2; v <= 2; v++) {
            const x = axis === 0 ? cx + u : cx + v, z = axis === 0 ? cz + v : cz + u;
            put(x, by, z, (u + v) % 7 === 0 ? B.ASHSTONE : B.CINDERBRICK);
            put(x, by + 5, z, B.CINDERBRICK);
            for (let y = by + 1; y <= by + 4; y++) {
              if (Math.abs(v) === 2) { if ((y === by + 2 || y === by + 3) && ((u % 6) + 6) % 6 === 3) put(x, y, z, 0); else wall(x, y, z); }
              else put(x, y, z, 0);
            }
            if (Math.abs(v) === 0 && u % 8 === 0) put(x, by + 5, z, B.EMBERSTONE);          // ceiling lamps
          }
          for (let u = -24; u <= 24; u += 8) for (const v of [-2, 2]) {                        // piers down to the ground
            const x = axis === 0 ? cx + u : cx + v, z = axis === 0 ? cz + v : cz + u;
            const f = Math.min(this.floorAt(x, z), LAVA_LEVEL);
            for (let y = Math.max(1, f); y < by; y++) wall(x, y, z);
          }
        }
        // the central hall
        for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
          const x = cx + dx, z = cz + dz, edge = Math.abs(dx) === 6 || Math.abs(dz) === 6;
          put(x, by, z, (dx + dz) % 2 === 0 ? B.CINDERBRICK : B.ASHSTONE);
          put(x, by + 8, z, B.CINDERBRICK);
          for (let y = by + 1; y <= by + 7; y++) {
            const door = ((Math.abs(dx) === 6 && Math.abs(dz) <= 2) || (Math.abs(dz) === 6 && Math.abs(dx) <= 2)) && y <= by + 4;
            if (edge && !door) wall(x, y, z); else put(x, y, z, 0);
          }
          if (Math.abs(dx) === 3 && Math.abs(dz) === 3) put(x, by + 8, z, B.EMBERSTONE);
        }
        for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) for (let y = 1; y < by; y += 1) { const f = Math.min(this.floorAt(cx + dx, cz + dz), LAVA_LEVEL); if (y >= f) wall(cx + dx, y, cz + dz); }
        res = { x: cx, z: cz, y: by, blocks: out };
      }
      this.citadels.set(key, res);
      return res;
    }
    placeCitadels(ch) {
      const g0 = Math.floor((ch.x0 - 28) / CITADEL_CELL), g1 = Math.floor((ch.x0 + 15 + 28) / CITADEL_CELL);
      const h0 = Math.floor((ch.z0 - 28) / CITADEL_CELL), h1 = Math.floor((ch.z0 + 15 + 28) / CITADEL_CELL);
      for (let gz = h0; gz <= h1; gz++) for (let gx = g0; gx <= g1; gx++) {
        const c = this.citadel(gx, gz);
        if (!c) continue;
        const l = c.blocks;
        for (let i = 0; i < l.length; i += 4) {
          const lx = l[i] - ch.x0, lz = l[i + 2] - ch.z0, y = l[i + 1];
          if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= CY - 1) continue;
          ch.blocks[lx + lz * 16 + y * 256] = l[i + 3] & 255;
        }
      }
    }
    citadelNear(x, z, r) {
      for (let gz = Math.floor((z - r - 30) / CITADEL_CELL); gz <= Math.floor((z + r + 30) / CITADEL_CELL); gz++)
        for (let gx = Math.floor((x - r - 30) / CITADEL_CELL); gx <= Math.floor((x + r + 30) / CITADEL_CELL); gx++) {
          const c = this.citadel(gx, gz);
          if (c && Math.hypot(c.x - x, c.z - z) < r + 24) return c;
        }
      return null;
    }
    findSpawn() { return { x: 0.5, y: Math.max(this.floorAt(0, 0), LAVA_LEVEL) + 2, z: 0.5 }; }
  }

  // =============================================================== the Void Isle
  class EndGen extends RealmGen {
    constructor(seed) {
      super();
      this.seed = seed | 0;
      this.nIsle = new N.Simplex(this.seed ^ 0x3e3e);
      this.realm = 'end';
      this.minLight = 0.5;
      this.pillars = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.pillars.push({ x: Math.round(Math.cos(a) * 25), z: Math.round(Math.sin(a) * 25), h: 14 + (i % 3) * 5 });
      }
    }
    radius(x, z) { return 40 + this.nIsle.noise2D(x / 18, z / 18) * 5; }
    heightAt(x, z) { return Math.hypot(x, z) < this.radius(x, z) ? ISLE_TOP : 2; }
    biomeAt() { return 'Void Isle'; }
    generate(ch) {
      const blocks = ch.blocks, s = this.seed;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const wx = ch.x0 + lx, wz = ch.z0 + lz, base = lx + lz * 16, d = Math.hypot(wx, wz), R = this.radius(wx, wz);
        if (d >= R) continue;
        const depth = Math.floor((1 - d / R) * 17 + 2 + N.hash2(wx, wz, s + 3) * 1.6);
        for (let y = ISLE_TOP - depth; y <= ISLE_TOP; y++) blocks[base + y * 256] = B.VOIDSTONE;
      }
      for (const p of this.pillars) {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dz * dz > 5) continue;
          const lx = p.x + dx - ch.x0, lz = p.z + dz - ch.z0;
          if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
          for (let y = ISLE_TOP + 1; y <= ISLE_TOP + p.h; y++) blocks[lx + lz * 16 + y * 256] = B.OBSIDIAN;
          if (dx === 0 && dz === 0) blocks[lx + lz * 16 + (ISLE_TOP + p.h + 1) * 256] = B.EMBERSTONE;
        }
      }
    }
    findSpawn() { return { x: 0.5, y: ISLE_TOP + 2, z: -30.5 }; }
  }

  // =============================================================== portals
  const AIR_OR_PORTAL = (id) => id === 0 || id === B.PORTAL;

  /** The 2-4 wide, 3-5 tall rectangle of empty cells ringed by obsidian that contains (x, y, z), or null. */
  function findFrame(world, x, y, z) {
    for (const axis of [0, 1]) {
      const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
      if (!AIR_OR_PORTAL(world.getBlock(x, y, z))) continue;
      const seen = new Map(), queue = [[0, 0]];
      seen.set('0,0', true);
      let ok = true;
      while (queue.length && ok) {
        const [u, v] = queue.pop();
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nu = u + du, nv = v + dv, k = nu + ',' + nv;
          if (seen.has(k)) continue;
          const id = world.getBlock(x + nu * ax, y + nv, z + nu * az);
          if (AIR_OR_PORTAL(id)) {
            if (Math.abs(nu) > 5 || Math.abs(nv) > 6 || seen.size > 24) { ok = false; break; }
            seen.set(k, true); queue.push([nu, nv]);
          } else if (id !== B.OBSIDIAN) { ok = false; break; }
        }
      }
      if (!ok) continue;
      let u0 = 99, u1 = -99, v0 = 99, v1 = -99;
      for (const k of seen.keys()) { const [u, v] = k.split(',').map(Number); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const w = u1 - u0 + 1, h = v1 - v0 + 1;
      if (w < 2 || w > 4 || h < 3 || h > 5 || w * h !== seen.size) continue;
      const cells = [];
      for (const k of seen.keys()) { const [u, v] = k.split(',').map(Number); cells.push([x + u * ax, y + v, z + u * az]); }
      return { axis, cells };
    }
    return null;
  }
  /** Lights the frame around (x, y, z) with portal membrane. Returns the number of cells filled (0 = no frame). */
  function light(world, x, y, z, net) {
    const f = findFrame(world, x, y, z);
    if (!f) return 0;
    let n = 0;
    for (const [cx, cy, cz] of f.cells) {
      if (world.getBlock(cx, cy, cz) === B.PORTAL) continue;
      if (world.setBlock(cx, cy, cz, B.PORTAL)) { if (net) net.sendBlock(cx, cy, cz, B.PORTAL); n++; }
    }
    return n;
  }
  /** After a frame block is broken: every portal cell touching (x, y, z), and all that connect to them, vanish. */
  function collapse(world, x, y, z, net) {
    const todo = [], seen = new Set();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
      if (world.getBlock(x + dx, y + dy, z + dz) === B.PORTAL) todo.push([x + dx, y + dy, z + dz]);
    let n = 0;
    while (todo.length) {
      const [cx, cy, cz] = todo.pop(), k = cx + ',' + cy + ',' + cz;
      if (seen.has(k) || world.getBlock(cx, cy, cz) !== B.PORTAL) continue;
      seen.add(k);
      if (world.setBlock(cx, cy, cz, 0)) { if (net) net.sendBlock(cx, cy, cz, 0); n++; }
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) todo.push([cx + dx, cy + dy, cz + dz]);
    }
    return n;
  }

  /** After a frame took its eye: if the eight frames around an empty cell are all sealed, that cell becomes the Void Gate. */
  function checkGate(world, x, y, z, net) {
    for (let cx = x - 1; cx <= x + 1; cx++) for (let cz = z - 1; cz <= z + 1; cz++) {
      if ((cx === x && cz === z) || world.getBlock(cx, y, cz) !== 0) continue;
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        if (world.getBlock(cx + dx, y, cz + dz) !== B.GATE_EYE) { ok = false; break; }
      }
      if (ok && world.setBlock(cx, y, cz, B.VOID_GATE)) { if (net) net.sendBlock(cx, y, cz, B.VOID_GATE); return true; }
    }
    return false;
  }

  /** The lowest cell of the portal nearest (x, z) within r blocks, with the axis its frame runs along. */
  function findPortalNear(world, x, y, z, r) {
    let best = null, bd = 1e9;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      for (let yy = Math.max(2, Math.floor(y) - 40); yy < Math.min(CY - 2, Math.floor(y) + 40); yy++) {
        if (world.getBlock(x0 + dx, yy, z0 + dz) !== B.PORTAL) continue;
        const d = dx * dx + dz * dz + (yy - y) * (yy - y) * 0.2;
        if (d < bd) { bd = d; best = [x0 + dx, yy, z0 + dz]; }
      }
    }
    if (!best) return null;
    let [bx, by, bz] = best;
    while (world.getBlock(bx, by - 1, bz) === B.PORTAL) by--;
    const axis = world.getBlock(bx + 1, by, bz) === B.PORTAL || world.getBlock(bx - 1, by, bz) === B.PORTAL ? 0 : 1;
    return { x: bx, y: by, z: bz, axis };
  }

  /** Builds a portal shrine whose interior bottom-left cell is (x, y, z): obsidian frame (2x3 opening), platform and clear air. */
  function buildShrine(world, x, y, z, net) {
    const put = (px, py, pz, id) => { if (world.getBlock(px, py, pz) !== id && world.setBlock(px, py, pz, id) && net) net.sendBlock(px, py, pz, id); };
    for (let px = x - 2; px <= x + 3; px++) for (let pz = z - 2; pz <= z + 3; pz++) {
      put(px, y - 1, pz, B.OBSIDIAN);
      for (let py = y; py <= y + 4; py++) put(px, py, pz, 0);
    }
    for (let px = x - 1; px <= x + 2; px++) for (let py = y - 1; py <= y + 3; py++) {
      const edge = px === x - 1 || px === x + 2 || py === y - 1 || py === y + 3;
      if (edge) put(px, py, z, B.OBSIDIAN);
    }
    for (let px = x; px <= x + 1; px++) for (let py = y; py <= y + 2; py++) put(px, py, z, B.PORTAL);
    return { x, y, z, axis: 0 };
  }

  /** Where to put the player so they stand beside a portal, looking out of it. */
  function standBeside(world, p) {
    const nx = p.axis === 0 ? 0 : 1, nz = p.axis === 0 ? 1 : 0;
    for (const sign of [1, -1]) {
      const sx = p.x + 0.5 + nx * sign * 1.6 + (p.axis === 0 ? 0.5 : 0), sz = p.z + 0.5 + nz * sign * 1.6 + (p.axis === 1 ? 0.5 : 0);
      const bx = Math.floor(sx), bz = Math.floor(sz);
      if (world.getBlock(bx, p.y, bz) === 0 && world.getBlock(bx, p.y + 1, bz) === 0 && world.isSolid(bx, p.y - 1, bz))
        return { x: sx, y: p.y, z: sz, yaw: Math.atan2(-nx * sign, -nz * sign) };
    }
    return { x: p.x + 0.5, y: p.y, z: p.z + 0.5, yaw: 0 };
  }
  /** Ground height for a new shrine at (x, z) in a realm (the top solid block's y + 1), or null while the chunk is missing. */
  function groundFor(world, realm, x, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    if (world.getBlock(bx, 10, bz) < 0) return null;
    if (realm === 'ember') {
      for (let y = 100; y > 2; y--) if (world.isSolid(bx, y, bz) && !world.isSolid(bx, y + 1, bz)) return Math.max(y + 1, LAVA_LEVEL + 1);
      return LAVA_LEVEL + 1;
    }
    const CUT = OM.Blocks.CUTOUT;
    for (let y = CY - 3; y > 1; y--) {
      const id = world.getBlock(bx, y, bz);
      if (id > 0 && world.isSolid(bx, y, bz) && !CUT[id]) return Math.max(y + 1, OM.CONST.SEA + 2);
    }
    return OM.CONST.SEA + 3;
  }
  /** Arrival for meadow / ember travel: reuse a portal within 20 blocks of (tx, tz) or raise a new shrine there. */
  function arrive(world, realm, tx, tz, net) {
    let p = findPortalNear(world, tx, realm === 'ember' ? 46 : 60, tz, 20);
    if (!p) {
      const gy = groundFor(world, realm, tx, tz);
      p = buildShrine(world, Math.floor(tx), gy, Math.floor(tz), net);
    }
    return standBeside(world, p);
  }
  /** The platform the player lands on in the Void Isle. */
  function arriveEnd(world, net) {
    for (let px = -3; px <= 3; px++) for (let pz = -34; pz <= -28; pz++) {
      if (world.setBlock(px, ISLE_TOP, pz, B.OBSIDIAN) && net) net.sendBlock(px, ISLE_TOP, pz, B.OBSIDIAN);
      for (let py = ISLE_TOP + 1; py <= ISLE_TOP + 4; py++) world.setBlock(px, py, pz, 0);
    }
    return { x: 0.5, y: ISLE_TOP + 1, z: -30.5, yaw: Math.PI };
  }
  /** After the final fight: a gate home appears in the middle of the island. */
  function openExit(world, net) {
    for (let px = -2; px <= 2; px++) for (let pz = -2; pz <= 2; pz++) {
      const edge = Math.abs(px) === 2 || Math.abs(pz) === 2;
      const id = edge ? B.OBSIDIAN : B.VOID_GATE;
      world.setBlock(px, ISLE_TOP, pz, B.OBSIDIAN); world.setBlock(px, ISLE_TOP + 1, pz, id);
      if (net) { net.sendBlock(px, ISLE_TOP + 1, pz, id); }
    }
  }

  OM.Realms = { EmberGen, EndGen, LAVA_LEVEL, ISLE_TOP, findFrame, light, collapse, findPortalNear, checkGate, buildShrine, standBeside, arrive, arriveEnd, openExit };
})();
