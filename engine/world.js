/* Open Meadow — engine/world.js
 * Chunk storage and streaming, block / water / plant access, player edits
 * (kept separately so they survive chunk unloading and saving), voxel ray
 * casting and grass spreading. Rendering of chunk meshes is driven from here;
 * the actual geometry comes from mesher.js, water.js and nature.js. */
(function () {
  'use strict';
  const OM = window.OM;
  const { CY, VOL } = OM.CONST;
  const BL = OM.Blocks, B = OM.B;
  const SOLID = BL.SOLID, OPAQUE = BL.OPAQUE;

  const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

  class Chunk {
    constructor(cx, cz) {
      this.cx = cx; this.cz = cz; this.key = key(cx, cz);
      this.x0 = cx * 16; this.z0 = cz * 16;
      this.blocks = new Uint8Array(VOL);
      this.water = new Uint8Array(VOL);
      this.height = new Int16Array(256); // highest opaque block per column (-1 = none)
      this.river = new Float32Array(256);
      this.plants = new Map();
      this.flowers = [];
      this.springs = [];
      this.maxY = 0; this.waterMin = CY; this.waterMax = -1;
      this.meshOpaque = null; this.meshCutout = null; this.meshWater = null; this.meshPlants = null;
      this.generated = false; this.meshed = false; this.plantsBuilt = false;
      this.wetDirtyAt = 0; this.visible = true;
    }
    recomputeMeta() {
      let maxY = 0;
      const b = this.blocks, w = this.water;
      for (let c = 0; c < 256; c++) {
        let top = -1;
        for (let y = CY - 1; y >= 0; y--) {
          const id = b[c + (y << 8)];
          if (!id) continue;
          if (y > maxY) maxY = y;
          if (OPAQUE[id]) { top = y; break; }
        }
        this.height[c] = top;
      }
      this.maxY = maxY;
      let wmin = CY, wmax = -1;
      for (let i = 0; i < VOL; i++) if (w[i]) { const y = i >> 8; if (y < wmin) wmin = y; if (y > wmax) wmax = y; }
      this.waterMin = wmin; this.waterMax = wmax;
    }
  }

  class World {
    constructor(opts) {
      this.seed = opts.seed | 0;
      this.scene = opts.scene;
      this.textures = opts.textures;
      this.materials = opts.materials;
      this.gen = new OM.TerrainGen(this.seed);
      this.chunks = new Map();
      this.edits = new Map();
      this.waterEdits = new Map();
      this.plantEdits = new Map();
      this.renderDistance = opts.renderDistance || 6;
      this.plantDistance = opts.plantDistance || 4;
      this.fancyLeaves = true;
      this.center = { cx: 1e9, cz: 1e9 };
      this.wanted = [];
      this.wantedDirty = true;
      this.urgent = new Set();
      this.waterDirty = new Set();
      this.water = null;   // OM.Water, attached by main.js
      this.nature = null;  // OM.Nature, attached by main.js
      this.lastChunk = null;
      this.onPlantRemoved = null;
      this.tickTimer = 0;
      this.stats = { generated: 0, meshed: 0 };
      this.R2 = 0; this.P2 = 0;
    }

    // ------------------------------------------------------------------ access
    getChunk(cx, cz) { return this.chunks.get(key(cx, cz)); }
    chunkAt(x, z) {
      const cx = x >> 4, cz = z >> 4, lc = this.lastChunk;
      if (lc && lc.cx === cx && lc.cz === cz) return lc;
      const c = this.chunks.get(key(cx, cz));
      if (c && c.generated) this.lastChunk = c;
      return c;
    }
    /** Block id at integer coords, or -1 when that chunk is not loaded. */
    getBlock(x, y, z) {
      if (y < 0) return B.BEDROCK;
      if (y >= CY) return 0;
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return -1;
      return c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)];
    }
    /** Unloaded terrain counts as solid so nothing can fall into it. */
    isSolid(x, y, z) { const b = this.getBlock(x, y, z); return b < 0 ? true : SOLID[b] === 1; }
    getWater(x, y, z) {
      if (y < 0 || y >= CY) return 0;
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return -1;
      return c.water[(x & 15) + ((z & 15) << 4) + (y << 8)];
    }
    setWaterRaw(x, y, z, v) {
      if (y < 0 || y >= CY) return;
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return;
      const lx = x & 15, lz = z & 15;
      c.water[lx + (lz << 4) + (y << 8)] = v;
      if (v) { if (y < c.waterMin) c.waterMin = y; if (y > c.waterMax) c.waterMax = y; }
      this.waterDirty.add(c);
      c.wetDirtyAt = performance.now() + 1500;
      const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0, ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (ex || ez) {
        const mark = (dx, dz) => { const n = this.getChunk(c.cx + dx, c.cz + dz); if (n && n.generated) this.waterDirty.add(n); };
        if (ex) mark(ex, 0);
        if (ez) mark(0, ez);
        if (ex && ez) mark(ex, ez);
      }
    }
    /** Player-driven water change (bucket). Recorded so it survives reloads. */
    setWater(x, y, z, v) {
      const c = this.chunkAt(x, z);
      if (!c || !c.generated || y < 1 || y >= CY) return false;
      const i = (x & 15) + ((z & 15) << 4) + (y << 8);
      if (SOLID[c.blocks[i]]) return false;
      this.setWaterRaw(x, y, z, v);
      let m = this.waterEdits.get(c.key);
      if (!m) this.waterEdits.set(c.key, (m = new Map()));
      m.set(i, v);
      if (v) this.removePlant(x, y, z, 'flooded');
      if (this.water) this.water.scheduleAround(x, y, z);
      return true;
    }

    // ------------------------------------------------------------------ edits
    recordEdit(c, i, id) {
      let m = this.edits.get(c.key);
      if (!m) this.edits.set(c.key, (m = new Map()));
      m.set(i, id);
    }
    setBlock(x, y, z, id, opts) {
      if (y < 1 || y >= CY) return false;
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return false;
      const lx = x & 15, lz = z & 15, i = lx + (lz << 4) + (y << 8);
      const old = c.blocks[i];
      if (old === id || (old === B.BEDROCK && !(opts && opts.force))) return false;
      c.blocks[i] = id;
      if (SOLID[id] && c.water[i]) this.setWaterRaw(x, y, z, 0);
      if (!opts || opts.record !== false) this.recordEdit(c, i, id);
      if (id !== 0) this.removePlant(x, y, z, 'replaced');
      if (!BL.SUPPORTS_PLANT[id]) this.removePlant(x, y + 1, z, 'support');
      this.updateColumn(c, lx, lz, y, id);
      this.markDirtyAround(c, lx, lz);
      if (this.water) this.water.scheduleAround(x, y, z);
      return true;
    }
    updateColumn(c, lx, lz, y, id) {
      const col = lx + (lz << 4);
      if (id && y > c.maxY) c.maxY = y;
      const top = c.height[col];
      if (OPAQUE[id]) { if (y > top) c.height[col] = y; }
      else if (y === top) {
        let t = y - 1;
        while (t >= 0 && !OPAQUE[c.blocks[col + (t << 8)]]) t--;
        c.height[col] = t;
      }
    }
    markDirtyAround(c, lx, lz) {
      this.urgent.add(c);
      const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0, ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      const add = (dx, dz) => { const n = this.getChunk(c.cx + dx, c.cz + dz); if (n && n.meshed) this.urgent.add(n); };
      if (ex) add(ex, 0);
      if (ez) add(0, ez);
      if (ex && ez) add(ex, ez);
    }

    // ------------------------------------------------------------------ plants
    plantSupported(code, below) {
      const s = BL.SUPPORTS_PLANT[below];
      if (!s) return false;
      return s === 1 || OM.Plants.defs[code & 255].sand;
    }
    getPlant(x, y, z) {
      if (y < 1 || y >= CY) return 0;
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return 0;
      return c.plants.get((x & 15) + ((z & 15) << 4) + (y << 8)) || 0;
    }
    recordPlant(c, i, code) {
      let m = this.plantEdits.get(c.key);
      if (!m) this.plantEdits.set(c.key, (m = new Map()));
      m.set(i, code);
    }
    removePlant(x, y, z, cause) {
      if (y < 1 || y >= CY) return 0;
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return 0;
      const i = (x & 15) + ((z & 15) << 4) + (y << 8);
      const code = c.plants.get(i);
      if (!code) return 0;
      c.plants.delete(i);
      this.recordPlant(c, i, 0);
      this.plantsChanged(c);
      if (this.onPlantRemoved) this.onPlantRemoved(code, x, y, z, cause);
      return code;
    }
    addPlant(x, y, z, code) {
      const c = this.chunkAt(x, z);
      if (!c || !c.generated || y < 1 || y >= CY) return false;
      const i = (x & 15) + ((z & 15) << 4) + (y << 8);
      if (c.blocks[i] || c.water[i] || c.plants.has(i) || !this.plantSupported(code, c.blocks[i - 256])) return false;
      c.plants.set(i, code);
      this.recordPlant(c, i, code);
      this.plantsChanged(c);
      return true;
    }
    plantsChanged(c) {
      this.rebuildFlowers(c);
      if (c.plantsBuilt && this.nature) this.nature.build(c);
    }
    rebuildFlowers(c) {
      const list = [];
      const defs = OM.Plants.defs;
      for (const [i, code] of c.plants) {
        const d = defs[code & 255];
        if (!d || !d.flower) continue;
        const x = c.x0 + (i & 15), z = c.z0 + ((i >> 4) & 15), y = i >> 8;
        const L = OM.Plants.layout(code, x, y, z);
        list.push({ x: L.x, y: y + L.h * 0.92, z: L.z, type: d.id, color: d.color });
      }
      c.flowers = list;
    }

    // --------------------------------------------------------------- streaming
    neighborsReady(c) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (!n || !n.generated) return false;
      }
      return true;
    }
    applyEdits(c) {
      const m = this.edits.get(c.key);
      if (m) for (const [i, id] of m) { c.blocks[i] = id; if (SOLID[id]) c.water[i] = 0; }
      const wm = this.waterEdits.get(c.key);
      if (wm) for (const [i, v] of wm) if (!SOLID[c.blocks[i]]) c.water[i] = v;
      const pm = this.plantEdits.get(c.key);
      if (pm) for (const [i, code] of pm) { if (code) c.plants.set(i, code); else c.plants.delete(i); }
      if (m || pm || wm) {
        for (const [i, code] of c.plants) {
          if (i < 256 || c.blocks[i] !== 0 || c.water[i] || !this.plantSupported(code, c.blocks[i - 256])) c.plants.delete(i);
        }
      }
    }
    createChunk(cx, cz) {
      const c = new Chunk(cx, cz);
      this.gen.generate(c);
      this.applyEdits(c);
      c.recomputeMeta();
      c.generated = true;
      this.chunks.set(c.key, c);
      this.rebuildFlowers(c);
      if (this.water) this.water.onChunkLoaded(c, this.edits.get(c.key), this.waterEdits.get(c.key));
      this.stats.generated++;
      return c;
    }
    makeGeometry(data, water) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
      if (water) {
        g.setAttribute('aInfo', new THREE.BufferAttribute(data.info, 4));
      } else {
        g.setAttribute('normal', new THREE.BufferAttribute(data.nor, 3, true));
        g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
        g.setAttribute('color', new THREE.BufferAttribute(data.col, 3, true));
        if (data.wet) g.setAttribute('aWet', new THREE.BufferAttribute(data.wet, 1, true));
        if (data.wind) g.setAttribute('aWind', new THREE.BufferAttribute(data.wind, 1));
      }
      g.setIndex(new THREE.BufferAttribute(data.idx, 1));
      g.computeBoundingSphere();
      return g;
    }
    applyMesh(c, mesh, data, material, opts) {
      if (!data) {
        if (mesh) { this.scene.remove(mesh); mesh.geometry.dispose(); }
        return null;
      }
      const g = this.makeGeometry(data, opts.water);
      if (!mesh) {
        mesh = new THREE.Mesh(g, material);
        mesh.position.set(c.x0, 0, c.z0);
        mesh.castShadow = !!opts.cast;
        mesh.receiveShadow = !!opts.receive;
        if (opts.order) mesh.renderOrder = opts.order;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.visible = c.visible;
        this.scene.add(mesh);
      } else {
        mesh.geometry.dispose();
        mesh.geometry = g;
      }
      return mesh;
    }
    remesh(c) {
      if (!this.neighborsReady(c)) return false;
      const data = OM.Mesher.build(this, c, this.textures.block.uv, this.fancyLeaves);
      c.meshOpaque = this.applyMesh(c, c.meshOpaque, data.opaque, this.materials.opaque, { cast: true, receive: true });
      c.meshCutout = this.applyMesh(c, c.meshCutout, data.cutout, this.materials.cutout, { cast: true, receive: true });
      c.meshed = true;
      this.rebuildWater(c);
      this.stats.meshed++;
      return true;
    }
    rebuildWater(c) {
      if (!this.water) return;
      this.waterDirty.delete(c);
      if (!c.meshed) return;
      const data = this.water.buildMesh(c);
      c.meshWater = this.applyMesh(c, c.meshWater, data, this.materials.water, { water: true, order: 1 });
    }
    setChunkVisible(c, v) {
      if (c.visible === v) return;
      c.visible = v;
      for (const m of [c.meshOpaque, c.meshCutout, c.meshWater, c.meshPlants]) if (m) m.visible = v;
    }
    unload(c) {
      for (const m of [c.meshOpaque, c.meshCutout, c.meshWater, c.meshPlants]) {
        if (m) { this.scene.remove(m); m.geometry.dispose(); }
      }
      c.meshOpaque = c.meshCutout = c.meshWater = c.meshPlants = null;
      this.chunks.delete(c.key);
      this.urgent.delete(c);
      this.waterDirty.delete(c);
      if (this.lastChunk === c) this.lastChunk = null;
    }
    recenter(pcx, pcz) {
      this.center.cx = pcx; this.center.cz = pcz;
      this.wantedDirty = false;
      const R = this.renderDistance, G = R + 1;
      const list = [];
      for (let dz = -G; dz <= G; dz++) for (let dx = -G; dx <= G; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (G + 0.5) * (G + 0.5)) continue;
        list.push({ cx: pcx + dx, cz: pcz + dz, key: key(pcx + dx, pcz + dz), d2 });
      }
      list.sort((a, b) => a.d2 - b.d2);
      this.wanted = list;
      this.R2 = (R + 0.5) * (R + 0.5);
      this.P2 = (Math.min(this.plantDistance, R) + 0.5) ** 2;
      const U = (G + 1.5) * (G + 1.5);
      for (const c of this.chunks.values()) {
        const dx = c.cx - pcx, dz = c.cz - pcz, d2 = dx * dx + dz * dz;
        if (d2 > U) this.unload(c);
        else this.setChunkVisible(c, d2 <= this.R2);
      }
    }
    setRenderDistance(r, plants) {
      this.renderDistance = r;
      if (plants !== undefined) this.plantDistance = plants;
      this.wantedDirty = true;
    }
    /** Streams chunks around (x, z) within a time budget (ms). */
    update(x, z, budgetMs) {
      const t0 = performance.now();
      const pcx = Math.floor(x) >> 4, pcz = Math.floor(z) >> 4;
      if (this.wantedDirty || pcx !== this.center.cx || pcz !== this.center.cz) this.recenter(pcx, pcz);
      let n = 0;
      for (const c of this.urgent) {
        if (n >= 3 && performance.now() - t0 > budgetMs) break;
        this.urgent.delete(c);
        if (this.chunks.get(c.key) === c) this.remesh(c);
        n++;
      }
      for (const c of this.waterDirty) {
        if (performance.now() - t0 > budgetMs * 1.5) break;
        this.rebuildWater(c);
      }
      const now = performance.now();
      for (const w of this.wanted) {
        if (performance.now() - t0 > budgetMs) break;
        const c = this.chunks.get(w.key);
        if (!c) { this.createChunk(w.cx, w.cz); continue; }
        if (w.d2 <= this.R2 && !c.meshed) { if (this.remesh(c)) continue; }
        if (c.wetDirtyAt && now > c.wetDirtyAt) { c.wetDirtyAt = 0; this.urgent.add(c); }
        if (!this.nature) continue;
        if (w.d2 <= this.P2 && c.meshed && !c.plantsBuilt) this.nature.build(c);
        else if (w.d2 > this.P2 && c.plantsBuilt) this.nature.remove(c);
      }
    }
    /** How many of the chunks within `radius` of (x,z) are meshed. */
    readiness(x, z, radius) {
      const pcx = Math.floor(x) >> 4, pcz = Math.floor(z) >> 4;
      let total = 0, ready = 0;
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > (radius + 0.5) * (radius + 0.5)) continue;
        total++;
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (c && c.meshed) ready++;
      }
      return { total, ready };
    }
    isAreaReady(x, z) {
      for (const [dx, dz] of [[0, 0], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) {
        const c = this.chunkAt(Math.floor(x + dx), Math.floor(z + dz));
        if (!c || !c.generated) return false;
      }
      return true;
    }
    topY(x, z) {
      const c = this.chunkAt(x, z);
      if (!c || !c.generated) return -1;
      const col = (x & 15) + ((z & 15) << 4);
      for (let y = c.maxY; y >= 0; y--) if (c.blocks[col + (y << 8)]) return y;
      return -1;
    }

    // ------------------------------------------------------------- ray casting
    /** Voxel DDA. opts.plants: hit plant boxes, opts.water: stop at water sources. */
    raycast(ox, oy, oz, dx, dy, dz, maxDist, opts) {
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
      let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
      let tmy = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
      let tmz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
      let t = 0, nx = 0, ny = 0, nz = 0;
      for (let guard = 0; guard < 256 && t <= maxDist; guard++) {
        const b = this.getBlock(x, y, z);
        if (b < 0) return null;
        if (b > 0) return { kind: 'block', x, y, z, nx, ny, nz, block: b, t };
        if (opts && opts.plants) {
          const code = this.getPlant(x, y, z);
          if (code) {
            const L = OM.Plants.layout(code, x, y, z);
            const th = this.rayBox(ox, oy, oz, dx, dy, dz, L.x - 0.3, y, L.z - 0.3, L.x + 0.3, y + Math.min(1, L.h * 0.95), L.z + 0.3);
            if (th !== null && th <= maxDist) return { kind: 'plant', x, y, z, nx, ny, nz, code, t: th, box: [L.x - 0.3, y, L.z - 0.3, L.x + 0.3, y + Math.min(1, L.h * 0.95), L.z + 0.3] };
          }
        }
        if (opts && opts.water) {
          const w = this.getWater(x, y, z);
          if (w > 0 && (w & 16)) return { kind: 'water', x, y, z, nx, ny, nz, t };
        }
        if (tmx < tmy) {
          if (tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
          else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
        } else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
        else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
        if (y < 0 || y >= CY) return null;
      }
      return null;
    }
    rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
      let tmin = 0, tmax = Infinity;
      const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return null; continue; }
        let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
      return tmin;
    }

    // -------------------------------------------------------- living terrain
    /** Grass slowly spreads onto exposed dirt and dies under solid blocks. */
    randomTick(x, z, dt) {
      this.tickTimer += dt;
      if (this.tickTimer < 0.25) return;
      this.tickTimer = 0;
      const pcx = Math.floor(x) >> 4, pcz = Math.floor(z) >> 4;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (!c || !c.meshed) continue;
        for (let n = 0; n < 24; n++) {
          const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0, y = 1 + ((Math.random() * c.maxY) | 0);
          const i = lx + (lz << 4) + (y << 8), id = c.blocks[i];
          if (id !== B.GRASS && id !== B.DIRT) continue;
          const above = y + 1 < CY ? c.blocks[i + 256] : 0;
          const wx = c.x0 + lx, wz = c.z0 + lz;
          if (id === B.GRASS) {
            if (above && OPAQUE[above]) this.setBlock(wx, y, wz, B.DIRT);
          } else if ((!above || !OPAQUE[above]) && !c.water[i + 256] && c.height[lx + (lz << 4)] <= y) {
            const gx = wx + ((Math.random() * 3) | 0) - 1, gy = y + ((Math.random() * 3) | 0) - 1, gz = wz + ((Math.random() * 3) | 0) - 1;
            if (this.getBlock(gx, gy, gz) === B.GRASS) {
              const ga = this.getBlock(gx, gy + 1, gz);
              if (ga >= 0 && !OPAQUE[ga]) this.setBlock(wx, y, wz, B.GRASS);
            }
          }
        }
      }
    }

    // ----------------------------------------------------------- persistence
    serialize() {
      const ser = (m) => {
        const o = {};
        for (const [k, mm] of m) if (mm.size) o[k] = Array.from(mm.entries()).flat();
        return o;
      };
      return { blocks: ser(this.edits), water: ser(this.waterEdits), plants: ser(this.plantEdits) };
    }
    deserialize(d) {
      const de = (o, target) => {
        if (!o) return;
        for (const k of Object.keys(o)) {
          const arr = o[k], m = new Map();
          for (let i = 0; i + 1 < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
          target.set(Number(k), m);
        }
      };
      de(d.blocks, this.edits); de(d.water, this.waterEdits); de(d.plants, this.plantEdits);
    }
  }

  OM.Chunk = Chunk;
  OM.World = World;
  OM.chunkKey = key;
})();
