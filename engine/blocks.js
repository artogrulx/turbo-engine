/* Open Meadow — engine/blocks.js
 * World constants, block definitions, plant definitions and item definitions.
 * Fast typed-array lookup tables are built here so the mesher, physics and
 * water simulation never have to touch the definition objects in hot loops. */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});

  OM.CONST = Object.freeze({ CX: 16, CZ: 16, CY: 128, SEA: 40, AREA: 256, VOL: 16 * 16 * 128 });

  // ---------------------------------------------------------------------------
  // Texture tiles (index = position in the block atlas)
  // ---------------------------------------------------------------------------
  const TILES = [
    'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'gravel', 'clay',
    'oak_log', 'oak_log_top', 'oak_leaves', 'birch_log', 'birch_log_top', 'birch_leaves',
    'spruce_log', 'spruce_log_top', 'spruce_leaves', 'planks', 'cobble', 'mossy_cobble',
    'glass', 'bricks', 'coal_ore', 'iron_ore', 'bedrock', 'snow', 'snow_side',
    'stone_bricks', 'birch_planks', 'crafting_table_top', 'crafting_table_side', 'furnace_top', 'furnace_side', 'diamond_ore', 'lava', 'obsidian',
    'ashstone', 'emberstone', 'cinderbrick', 'portal', 'gate_top', 'gate_side', 'gate_eye_top', 'void_gate', 'voidstone', 'ash_ore'
  ];
  const T = {};
  TILES.forEach((n, i) => { T[n] = i; });

  // ---------------------------------------------------------------------------
  // Blocks
  // ---------------------------------------------------------------------------
  const B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, GRAVEL: 5, CLAY: 6,
    OAK_LOG: 7, OAK_LEAVES: 8, BIRCH_LOG: 9, BIRCH_LEAVES: 10, SPRUCE_LOG: 11, SPRUCE_LEAVES: 12,
    PLANKS: 13, COBBLE: 14, MOSSY_COBBLE: 15, GLASS: 16, BRICKS: 17, COAL_ORE: 18, IRON_ORE: 19,
    BEDROCK: 20, SNOW: 21, STONE_BRICKS: 22, BIRCH_PLANKS: 23,
    CRAFTING_TABLE: 24, FURNACE: 25, DIAMOND_ORE: 26, LAVA: 27, OBSIDIAN: 28,
    ASHSTONE: 29, EMBERSTONE: 30, CINDERBRICK: 31, PORTAL: 32, GATE_FRAME: 33, GATE_EYE: 34, VOID_GATE: 35, VOIDSTONE: 36, ASH_ORE: 37   // block ids below 64 are reserved for blocks (the multiplayer server accepts them all)
  };

  const defs = [];
  function def(id, key, name, o) {
    defs[id] = Object.assign({
      id, key, name,
      solid: true, opaque: true, cutout: false,
      hardness: 1, tiles: null, drop: id, sound: 'stone',
      color: [128, 128, 128], tint: 0
    }, o);
  }
  // tiles: [top, bottom, side] ; tint: 1 = grass tint on top face, 2 = foliage tint on all faces
  def(B.AIR, 'air', 'Air', { solid: false, opaque: false, hardness: 0, drop: 0, tiles: [0, 0, 0] });
  def(B.GRASS, 'grass', 'Grass Block', { hardness: 0.45, tiles: [T.grass_top, T.dirt, T.grass_side], drop: B.DIRT, sound: 'grass', color: [92, 148, 56], tint: 1 });
  def(B.DIRT, 'dirt', 'Dirt', { hardness: 0.4, tiles: [T.dirt, T.dirt, T.dirt], sound: 'gravel', color: [122, 88, 60] });
  def(B.STONE, 'stone', 'Stone', { hardness: 1.25, tiles: [T.stone, T.stone, T.stone], drop: B.COBBLE, color: [126, 126, 126] });
  def(B.SAND, 'sand', 'Sand', { hardness: 0.35, tiles: [T.sand, T.sand, T.sand], sound: 'sand', color: [219, 205, 160] });
  def(B.GRAVEL, 'gravel', 'Gravel', { hardness: 0.45, tiles: [T.gravel, T.gravel, T.gravel], sound: 'gravel', color: [128, 124, 120] });
  def(B.CLAY, 'clay', 'Clay', { hardness: 0.45, tiles: [T.clay, T.clay, T.clay], sound: 'gravel', color: [160, 166, 178] });
  def(B.OAK_LOG, 'oak_log', 'Oak Log', { hardness: 0.9, tiles: [T.oak_log_top, T.oak_log_top, T.oak_log], sound: 'wood', color: [104, 80, 50] });
  def(B.OAK_LEAVES, 'oak_leaves', 'Oak Leaves', { opaque: false, cutout: true, hardness: 0.18, tiles: [T.oak_leaves, T.oak_leaves, T.oak_leaves], sound: 'leaves', color: [62, 112, 42], tint: 2 });
  def(B.BIRCH_LOG, 'birch_log', 'Birch Log', { hardness: 0.9, tiles: [T.birch_log_top, T.birch_log_top, T.birch_log], sound: 'wood', color: [214, 210, 200] });
  def(B.BIRCH_LEAVES, 'birch_leaves', 'Birch Leaves', { opaque: false, cutout: true, hardness: 0.18, tiles: [T.birch_leaves, T.birch_leaves, T.birch_leaves], sound: 'leaves', color: [104, 146, 60], tint: 2 });
  def(B.SPRUCE_LOG, 'spruce_log', 'Spruce Log', { hardness: 0.9, tiles: [T.spruce_log_top, T.spruce_log_top, T.spruce_log], sound: 'wood', color: [74, 54, 34] });
  def(B.SPRUCE_LEAVES, 'spruce_leaves', 'Spruce Needles', { opaque: false, cutout: true, hardness: 0.18, tiles: [T.spruce_leaves, T.spruce_leaves, T.spruce_leaves], sound: 'leaves', color: [42, 80, 54], tint: 2 });
  def(B.PLANKS, 'planks', 'Oak Planks', { hardness: 0.8, tiles: [T.planks, T.planks, T.planks], sound: 'wood', color: [164, 132, 80] });
  def(B.COBBLE, 'cobblestone', 'Cobblestone', { hardness: 1.4, tiles: [T.cobble, T.cobble, T.cobble], color: [118, 118, 118] });
  def(B.MOSSY_COBBLE, 'mossy_cobblestone', 'Mossy Cobblestone', { hardness: 1.4, tiles: [T.mossy_cobble, T.mossy_cobble, T.mossy_cobble], color: [100, 120, 90] });
  def(B.GLASS, 'glass', 'Glass', { opaque: false, cutout: true, hardness: 0.3, tiles: [T.glass, T.glass, T.glass], sound: 'glass', color: [200, 225, 235] });
  def(B.BRICKS, 'bricks', 'Bricks', { hardness: 1.5, tiles: [T.bricks, T.bricks, T.bricks], color: [150, 74, 56] });
  def(B.COAL_ORE, 'coal_ore', 'Coal Ore', { hardness: 1.8, tiles: [T.coal_ore, T.coal_ore, T.coal_ore], color: [90, 90, 90] });
  def(B.IRON_ORE, 'iron_ore', 'Iron Ore', { hardness: 2.2, tiles: [T.iron_ore, T.iron_ore, T.iron_ore], color: [150, 130, 115] });
  def(B.BEDROCK, 'bedrock', 'Bedrock', { hardness: Infinity, tiles: [T.bedrock, T.bedrock, T.bedrock], drop: 0, color: [60, 60, 60] });
  def(B.SNOW, 'snow', 'Snowy Grass', { hardness: 0.45, tiles: [T.snow, T.dirt, T.snow_side], sound: 'sand', color: [236, 242, 248] });
  def(B.STONE_BRICKS, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, tiles: [T.stone_bricks, T.stone_bricks, T.stone_bricks], color: [122, 122, 122] });
  def(B.BIRCH_PLANKS, 'birch_planks', 'Birch Planks', { hardness: 0.8, tiles: [T.birch_planks, T.birch_planks, T.birch_planks], sound: 'wood', color: [200, 182, 130] });
  def(B.CRAFTING_TABLE, 'crafting_table', 'Crafting Table', { hardness: 0.9, tiles: [T.crafting_table_top, T.planks, T.crafting_table_side], sound: 'wood', color: [150, 112, 66] });
  def(B.FURNACE, 'furnace', 'Furnace', { hardness: 1.6, tiles: [T.furnace_top, T.furnace_top, T.furnace_side], color: [110, 110, 112] });
  def(B.DIAMOND_ORE, 'diamond_ore', 'Diamond Ore', { hardness: 2.6, tiles: [T.diamond_ore, T.diamond_ore, T.diamond_ore], color: [90, 150, 160] });
  // Lava is a still, glowing liquid block: it blocks water like stone does, but the player sinks into it (liquid) and burns.
  def(B.LAVA, 'lava', 'Lava', { hardness: Infinity, tiles: [T.lava, T.lava, T.lava], drop: 0, liquid: true, glow: true, color: [236, 110, 30] });
  def(B.OBSIDIAN, 'obsidian', 'Obsidian', { hardness: 14, tiles: [T.obsidian, T.obsidian, T.obsidian], color: [34, 24, 54] });
  // The fire realm's stone, its light block and its fortress bricks
  def(B.ASHSTONE, 'ashstone', 'Ashstone', { hardness: 1.1, tiles: [T.ashstone, T.ashstone, T.ashstone], color: [96, 58, 54] });
  def(B.EMBERSTONE, 'emberstone', 'Emberstone', { hardness: 0.7, tiles: [T.emberstone, T.emberstone, T.emberstone], glow: true, color: [255, 170, 60] });
  def(B.CINDERBRICK, 'cinderbrick', 'Cinder Bricks', { hardness: 2.0, tiles: [T.cinderbrick, T.cinderbrick, T.cinderbrick], color: [96, 42, 42] });
  // Portals: thin glowing membranes you can walk into (they only exist inside a lit frame, and cannot be carried)
  def(B.PORTAL, 'portal', 'Portal', { solid: false, opaque: false, cutout: true, hardness: Infinity, tiles: [T.portal, T.portal, T.portal], drop: 0, glow: true, noItem: true, color: [150, 80, 220] });
  def(B.GATE_FRAME, 'gate_frame', 'Gate Frame', { hardness: Infinity, tiles: [T.gate_top, T.gate_side, T.gate_side], drop: 0, noItem: true, color: [100, 112, 104] });
  def(B.GATE_EYE, 'gate_eye', 'Sealed Gate Frame', { hardness: Infinity, tiles: [T.gate_eye_top, T.gate_side, T.gate_side], drop: 0, noItem: true, glow: true, color: [80, 200, 160] });
  def(B.VOID_GATE, 'void_gate', 'Void Gate', { solid: false, opaque: false, cutout: true, hardness: Infinity, tiles: [T.void_gate, T.void_gate, T.void_gate], drop: 0, glow: true, noItem: true, color: [60, 20, 110] });
  def(B.ASH_ORE, 'ash_ore', 'Ember Ore', { hardness: 3.2, tiles: [T.ash_ore, T.ash_ore, T.ash_ore], color: [190, 100, 60] });
  def(B.VOIDSTONE, 'voidstone', 'Voidstone', { hardness: 1.6, tiles: [T.voidstone, T.voidstone, T.voidstone], color: [226, 222, 160] });

  // Fast lookup tables. Face order everywhere: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
  const SOLID = new Uint8Array(256), OPAQUE = new Uint8Array(256), CUTOUT = new Uint8Array(256);
  const AO_OCC = new Uint8Array(256), TINT = new Uint8Array(256), SUPPORTS_PLANT = new Uint8Array(256);
  const HARD = new Float32Array(256), TILE = new Int16Array(256 * 6);
  const LIQUID = new Uint8Array(256), GLOW = new Uint8Array(256);   // liquids can be walked into; glowing faces ignore shade and stay lit at night
  const TOOL = new Uint8Array(256), LEVEL = new Uint8Array(256);   // preferred tool kind (1 pickaxe, 2 axe, 3 shovel) and the tool tier needed for a drop; filled in by crafting.js
  for (const d of defs) {
    if (!d) continue;
    SOLID[d.id] = d.solid ? 1 : 0;
    OPAQUE[d.id] = d.opaque ? 1 : 0;
    CUTOUT[d.id] = d.cutout ? 1 : 0;
    AO_OCC[d.id] = d.solid && !d.liquid && (d.opaque || d.tint === 2) ? 1 : 0; // leaves also shade
    LIQUID[d.id] = d.liquid ? 1 : 0;
    GLOW[d.id] = d.glow ? 1 : 0;
    TINT[d.id] = d.tint;
    HARD[d.id] = d.hardness;
    for (let f = 0; f < 6; f++) TILE[d.id * 6 + f] = f === 2 ? d.tiles[0] : f === 3 ? d.tiles[1] : d.tiles[2];
  }
  SUPPORTS_PLANT[B.GRASS] = 1; SUPPORTS_PLANT[B.DIRT] = 1; SUPPORTS_PLANT[B.SAND] = 2; SUPPORTS_PLANT[B.SNOW] = 1;

  OM.TILES = TILES;
  OM.T = T;
  OM.B = B;
  OM.Blocks = { defs, SOLID, OPAQUE, CUTOUT, AO_OCC, TINT, HARD, TILE, SUPPORTS_PLANT, TOOL, LEVEL, LIQUID, GLOW };

  // ---------------------------------------------------------------------------
  // Plants (decorations that live on top of soil blocks; no collision)
  // ---------------------------------------------------------------------------
  const P = {
    NONE: 0, GRASS: 1, TALL_GRASS: 2, FERN: 3, POPPY: 4, DANDELION: 5, CORNFLOWER: 6, DAISY: 7,
    ALLIUM: 8, TULIP_ORANGE: 9, TULIP_PINK: 10, LAVENDER: 11, BUTTERCUP: 12, BLUEBELL: 13,
    REED: 14, MUSHROOM_RED: 15, MUSHROOM_BROWN: 16
  };
  const PLANT_TILES = [
    'p_grass', 'p_tallgrass', 'p_fern', 'p_poppy', 'p_dandelion', 'p_cornflower', 'p_daisy', 'p_allium',
    'p_tulip_orange', 'p_tulip_pink', 'p_lavender', 'p_buttercup', 'p_bluebell', 'p_reed',
    'p_mushroom_red', 'p_mushroom_brown'
  ];
  const plantDefs = [];
  function plant(id, key, name, o) {
    plantDefs[id] = Object.assign({
      id, key, name, tile: id - 1, h: [0.5, 0.8], w: 0.62, quads: 2, wind: 1,
      flower: false, color: [255, 255, 255], item: false, tint: false, sand: false
    }, o);
  }
  plant(P.GRASS, 'grass', 'Grass', { h: [0.42, 0.78], w: 0.95, wind: 1.0, tint: true });
  plant(P.TALL_GRASS, 'tall_grass', 'Tall Grass', { h: [1.05, 1.65], w: 0.95, wind: 1.25, tint: true });
  plant(P.FERN, 'fern', 'Fern', { h: [0.6, 0.95], w: 0.95, quads: 3, wind: 0.6, item: true, tint: true });
  plant(P.POPPY, 'poppy', 'Poppy', { h: [0.55, 0.85], flower: true, color: [214, 38, 34], item: true });
  plant(P.DANDELION, 'dandelion', 'Dandelion', { h: [0.45, 0.7], flower: true, color: [250, 206, 40], item: true });
  plant(P.CORNFLOWER, 'cornflower', 'Cornflower', { h: [0.6, 0.9], flower: true, color: [72, 104, 222], item: true });
  plant(P.DAISY, 'daisy', 'Oxeye Daisy', { h: [0.5, 0.8], flower: true, color: [248, 248, 240], item: true });
  plant(P.ALLIUM, 'allium', 'Allium', { h: [0.75, 1.05], flower: true, color: [172, 94, 212], item: true });
  plant(P.TULIP_ORANGE, 'tulip_orange', 'Orange Tulip', { h: [0.55, 0.8], flower: true, color: [240, 122, 32], item: true });
  plant(P.TULIP_PINK, 'tulip_pink', 'Pink Tulip', { h: [0.55, 0.8], flower: true, color: [240, 128, 176], item: true });
  plant(P.LAVENDER, 'lavender', 'Lavender', { h: [0.8, 1.15], w: 0.75, flower: true, color: [150, 112, 212], item: true });
  plant(P.BUTTERCUP, 'buttercup', 'Buttercup', { h: [0.35, 0.58], w: 0.7, flower: true, color: [255, 222, 40], item: true });
  plant(P.BLUEBELL, 'bluebell', 'Bluebell', { h: [0.5, 0.75], flower: true, color: [100, 96, 214], item: true });
  plant(P.REED, 'reed', 'Cattail', { h: [1.35, 2.05], w: 0.85, wind: 0.9, item: true, sand: true });
  plant(P.MUSHROOM_RED, 'mushroom_red', 'Red Mushroom', { h: [0.32, 0.46], w: 0.5, wind: 0, item: true });
  plant(P.MUSHROOM_BROWN, 'mushroom_brown', 'Brown Mushroom', { h: [0.3, 0.44], w: 0.5, wind: 0, item: true });

  const FLOWER_TYPES = plantDefs.filter((d) => d && d.flower).map((d) => d.id);
  const layoutOut = { x: 0, y: 0, z: 0, h: 0, rot: 0 };
  /** Deterministic placement of a plant inside its cell (shared by renderer,
   *  ray picking and wildlife so they always agree). Returns a reused object. */
  function plantLayout(code, x, y, z) {
    const d = plantDefs[code & 255];
    const h1 = OM.Noise.hashInt(x, y, z, 0x51ed);
    layoutOut.x = x + 0.5 + (((h1 & 255) / 255) - 0.5) * 0.46;
    layoutOut.z = z + 0.5 + ((((h1 >>> 8) & 255) / 255) - 0.5) * 0.46;
    layoutOut.y = y;
    layoutOut.h = d ? d.h[0] + (d.h[1] - d.h[0]) * (((h1 >>> 16) & 255) / 255) : 0.5;
    layoutOut.rot = ((h1 >>> 24) / 255) * Math.PI;
    return layoutOut;
  }

  OM.P = P;
  OM.PLANT_TILES = PLANT_TILES;
  OM.Plants = { defs: plantDefs, FLOWER_TYPES, layout: plantLayout };

  // ---------------------------------------------------------------------------
  // Items (block items share their block id; plants are 100 + plant id)
  // ---------------------------------------------------------------------------
  const I = { BUCKET: 200, WATER_BUCKET: 201 };
  const itemDefs = [];
  for (const d of defs) {
    if (!d || d.id === B.AIR || d.liquid || d.noItem) continue;   // lava, portals and gates cannot be carried
    itemDefs[d.id] = { id: d.id, name: d.name, kind: 'block', block: d.id, max: 64, icon: null };
  }
  for (const d of plantDefs) {
    if (!d || !d.item) continue;
    itemDefs[100 + d.id] = { id: 100 + d.id, name: d.name, kind: 'plant', plant: d.id, max: 64, icon: null };
  }
  itemDefs[I.BUCKET] = { id: I.BUCKET, name: 'Bucket', kind: 'bucket', max: 16, icon: null };
  itemDefs[I.WATER_BUCKET] = { id: I.WATER_BUCKET, name: 'Water Bucket', kind: 'water_bucket', max: 1, icon: null };

  OM.I = I;
  OM.Items = {
    defs: itemDefs,
    get(id) { return itemDefs[id] || null; },
    plantItem(plantId) { return itemDefs[100 + plantId] ? 100 + plantId : 0; }
  };
})();
