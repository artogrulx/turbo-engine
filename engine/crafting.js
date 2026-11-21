/* Open Meadow — engine/crafting.js
 * Materials, tool tiers, crafting recipes, tool-aware mining rules and the furnace.
 * Pure rules and data (no DOM, no Three.js): the screens live in inventory.js and the
 * world hooks in interaction.js, which makes everything here easy to test on its own.
 *
 * Item ids: blocks 1-63 (the block id), plants 101-116, buckets 200-201,
 *           materials 210-215, tools 300-315 (tier * 4 + kind).                        */
(function () {
  'use strict';
  const OM = window.OM;
  const B = OM.B, I = OM.I, Items = OM.Items, BL = OM.Blocks;

  // ----------------------------------------------------------------- materials
  const MATERIALS = [['STICK', 210, 'Stick'], ['COAL', 211, 'Coal'], ['RAW_IRON', 212, 'Raw Iron'],
    ['IRON_INGOT', 213, 'Iron Ingot'], ['DIAMOND', 214, 'Diamond'], ['FLINT', 215, 'Flint']];
  for (const [key, id, name] of MATERIALS) {
    I[key] = id;
    Items.defs[id] = { id, name, kind: 'material', max: 64, icon: null, material: key.toLowerCase() };
  }

  // --------------------------------------------------------------------- tools
  const KINDS = ['pickaxe', 'axe', 'shovel', 'sword'];
  const KIND_NAME = { pickaxe: 'Pickaxe', axe: 'Axe', shovel: 'Shovel', sword: 'Sword' };
  const TOOL_CODE = { pickaxe: 1, axe: 2, shovel: 3 };           // matches BL.TOOL
  // level = what the tier can harvest (BL.LEVEL); speed multiplies mining speed; dur = blocks before it breaks
  const TIERS = [
    { key: 'wood', name: 'Wooden', level: 1, speed: 2.0, dur: 48, color: [172, 134, 80] },
    { key: 'stone', name: 'Stone', level: 2, speed: 3.2, dur: 110, color: [132, 132, 138] },
    { key: 'iron', name: 'Iron', level: 3, speed: 4.5, dur: 240, color: [218, 220, 226] },
    { key: 'diamond', name: 'Diamond', level: 4, speed: 6.5, dur: 1100, color: [86, 226, 230] }
  ];
  const toolId = (tier, kind) => 300 + tier * 4 + kind;
  TIERS.forEach((t, ti) => KINDS.forEach((k, ki) => {
    const id = toolId(ti, ki);
    Items.defs[id] = { id, name: t.name + ' ' + KIND_NAME[k], kind: 'tool', tool: k, tier: t.level, tierIdx: ti, speed: t.speed, dur: t.dur, max: 1, icon: null };
  }));

  // Which tool a block prefers and which tier it needs before it drops anything.
  function setTool(ids, kind, level) { for (const id of ids) { BL.TOOL[id] = TOOL_CODE[kind]; BL.LEVEL[id] = level; } }
  setTool([B.STONE, B.COBBLE, B.MOSSY_COBBLE, B.BRICKS, B.STONE_BRICKS, B.COAL_ORE, B.FURNACE], 'pickaxe', 1);
  setTool([B.IRON_ORE], 'pickaxe', 2);
  setTool([B.DIAMOND_ORE], 'pickaxe', 3);
  setTool([B.OBSIDIAN], 'pickaxe', 4);                          // only a diamond pickaxe can harvest obsidian
  setTool([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.PLANKS, B.BIRCH_PLANKS, B.CRAFTING_TABLE], 'axe', 0);
  setTool([B.DIRT, B.GRASS, B.SAND, B.GRAVEL, B.CLAY, B.SNOW], 'shovel', 0);

  // Ores drop raw materials; gravel sometimes yields flint.
  BL.defs[B.COAL_ORE].drop = I.COAL;
  BL.defs[B.IRON_ORE].drop = I.RAW_IRON;
  BL.defs[B.DIAMOND_ORE].drop = I.DIAMOND;
  function dropFor(block, rand) {
    if (block === B.GRAVEL && (rand === undefined ? Math.random() : rand) < 0.25) return I.FLINT;
    return BL.defs[block].drop;
  }

  /** How a held item (0 = bare hand) deals with a block: seconds to break it, and whether it drops anything. */
  function mining(block, itemId) {
    const need = BL.LEVEL[block], want = BL.TOOL[block];
    const it = itemId ? Items.get(itemId) : null;
    const tool = it && it.kind === 'tool' ? it : null;
    const matches = !!tool && want !== 0 && TOOL_CODE[tool.tool] === want;
    const ok = need === 0 || (matches && tool.tier >= need);
    let speed = matches ? tool.speed : 1;
    if (!ok) speed *= 0.3;                      // the wrong tool is slow, and yields nothing
    return { time: BL.HARD[block] / speed, drops: ok, matches };
  }

  // ------------------------------------------------------------------ recipes
  // A recipe is shaped (pattern rows + key) or shapeless (list); every ingredient is an item id or a list of
  // acceptable ids. The 2x2 hand grid and the 3x3 crafting-table grid share one matcher.
  const G = { planks: [B.PLANKS, B.BIRCH_PLANKS], logs: [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG], cobble: [B.COBBLE, B.MOSSY_COBBLE] };
  const recipes = [];
  const shaped = (rows, key, out, count) => recipes.push({ rows, key, out, count: count || 1, w: Math.max.apply(null, rows.map((r) => r.length)), h: rows.length });
  const shapeless = (list, out, count) => recipes.push({ list, out, count: count || 1 });
  const matches = (spec, id) => (Array.isArray(spec) ? spec.indexOf(id) >= 0 : spec === id);

  shapeless([B.OAK_LOG], B.PLANKS, 4);
  shapeless([B.BIRCH_LOG], B.BIRCH_PLANKS, 4);
  shapeless([B.SPRUCE_LOG], B.PLANKS, 4);
  shaped(['P', 'P'], { P: G.planks }, I.STICK, 4);
  shaped(['PP', 'PP'], { P: G.planks }, B.CRAFTING_TABLE, 1);
  shaped(['CCC', 'C C', 'CCC'], { C: G.cobble }, B.FURNACE, 1);
  shaped(['SS', 'SS'], { S: B.STONE }, B.STONE_BRICKS, 4);
  shaped(['I I', ' I '], { I: I.IRON_INGOT }, I.BUCKET, 1);
  const HEADS = [G.planks, G.cobble, I.IRON_INGOT, I.DIAMOND];
  const PATTERN = { pickaxe: ['MMM', ' S ', ' S '], axe: ['MM', 'MS', ' S'], shovel: ['M', 'S', 'S'], sword: ['M', 'M', 'S'] };
  TIERS.forEach((t, ti) => KINDS.forEach((k, ki) => shaped(PATTERN[k], { M: HEADS[ti], S: I.STICK }, toolId(ti, ki), 1)));

  function shapedMatches(r, cells, x0, y0, w, h, mirror) {
    for (let y = 0; y < h; y++) {
      const row = r.rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row.charAt(mirror ? w - 1 - x : x) || ' ';
        const cell = cells[(y0 + y) * 3 + (x0 + x)];
        if (ch === ' ') { if (cell) return false; } else if (!cell || !matches(r.key[ch], cell.id)) return false;
      }
    }
    return true;
  }
  /** `cells` = 9 stacks (3x3, row-major, null = empty). Returns the result { id, count } or null. */
  function find(cells) {
    const ids = [];
    let minX = 3, minY = 3, maxX = -1, maxY = -1;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const s = cells[y * 3 + x];
      if (!s) continue;
      ids.push(s.id);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!ids.length) return null;
    const w = maxX - minX + 1, h = maxY - minY + 1;
    for (const r of recipes) {
      if (r.list) {
        if (r.list.length !== ids.length) continue;
        const pool = ids.slice();
        let ok = true;
        for (const spec of r.list) {
          const k = pool.findIndex((id) => matches(spec, id));
          if (k < 0) { ok = false; break; }
          pool.splice(k, 1);
        }
        if (ok) return { id: r.out, count: r.count };
      } else if (r.w === w && r.h === h) {
        if (shapedMatches(r, cells, minX, minY, w, h, false) || shapedMatches(r, cells, minX, minY, w, h, true)) return { id: r.out, count: r.count };
      }
    }
    return null;
  }

  // ----------------------------------------------------------------- smelting
  const SMELT = new Map([[I.RAW_IRON, I.IRON_INGOT], [B.COBBLE, B.STONE], [B.MOSSY_COBBLE, B.STONE], [B.SAND, B.GLASS], [B.CLAY, B.BRICKS]]);
  const FUEL = new Map([[I.COAL, 80], [B.OAK_LOG, 15], [B.BIRCH_LOG, 15], [B.SPRUCE_LOG, 15], [B.PLANKS, 15], [B.BIRCH_PLANKS, 15], [B.CRAFTING_TABLE, 15], [I.STICK, 5]]);
  const SMELT_SECONDS = 8;

  /** One furnace: slots[0] input, slots[1] fuel, slots[2] output. burn = seconds of fire left. */
  class Furnace {
    constructor() { this.slots = [null, null, null]; this.burn = 0; this.burnMax = 0; this.prog = 0; }
    result() { const s = this.slots[0]; return s ? SMELT.get(s.id) : undefined; }
    canSmelt() {
      const r = this.result();
      if (r === undefined) return false;
      const o = this.slots[2];
      return !o || (o.id === r && o.count < Items.get(r).max);
    }
    update(dt) {
      const can = this.canSmelt();
      if (this.burn <= 0 && can) {
        const f = this.slots[1];
        if (f && FUEL.has(f.id)) { this.burn = this.burnMax = FUEL.get(f.id); if (--f.count <= 0) this.slots[1] = null; }
      }
      if (this.burn > 0) {
        this.burn = Math.max(0, this.burn - dt);
        if (can) {
          this.prog += dt;
          if (this.prog >= SMELT_SECONDS) {
            this.prog -= SMELT_SECONDS;
            const r = this.result(), inp = this.slots[0], out = this.slots[2];
            if (--inp.count <= 0) this.slots[0] = null;
            if (out) out.count++; else this.slots[2] = { id: r, count: 1 };
          }
        } else this.prog = Math.max(0, this.prog - dt * 2);
      } else this.prog = Math.max(0, this.prog - dt * 2);
    }
    serialize() { return { s: this.slots.map((s) => (s ? [s.id, s.count] : 0)), b: this.burn, m: this.burnMax, p: this.prog }; }
    static from(d) {
      const f = new Furnace();
      if (d && Array.isArray(d.s)) d.s.slice(0, 3).forEach((s, i) => { if (s && Items.get(s[0])) f.slots[i] = { id: s[0], count: Math.max(1, s[1] | 0) }; });
      f.burn = Math.max(0, +d.b || 0); f.burnMax = Math.max(0, +d.m || 0); f.prog = Math.max(0, +d.p || 0);
      return f;
    }
  }

  /** Every furnace placed in the world, keyed by block position. */
  const Furnaces = {
    map: new Map(),
    key(x, y, z) { return x + ',' + y + ',' + z; },
    at(x, y, z) { const k = this.key(x, y, z); let f = this.map.get(k); if (!f) this.map.set(k, (f = new Furnace())); return f; },
    /** Removes a furnace and returns what was inside it. */
    take(x, y, z) { const k = this.key(x, y, z), f = this.map.get(k); this.map.delete(k); return f ? f.slots.filter(Boolean) : []; },
    update(dt) { for (const f of this.map.values()) f.update(dt); },
    clear() { this.map.clear(); },
    serialize() { return Array.from(this.map.entries()).map(([k, f]) => [k, f.serialize()]); },
    deserialize(list) {
      this.map.clear();
      if (Array.isArray(list)) for (const e of list) if (Array.isArray(e) && typeof e[0] === 'string' && e[1]) this.map.set(e[0], Furnace.from(e[1]));
    }
  };

  OM.Crafting = { recipes, find, mining, dropFor, TIERS, KINDS, toolId, GROUP: G, SMELT, FUEL, SMELT_SECONDS, Furnace };
  OM.Furnaces = Furnaces;
})();
