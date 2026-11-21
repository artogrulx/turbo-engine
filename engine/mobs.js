/* Open Meadow — engine/mobs.js
 * Creatures: original designs built from coloured boxes, with simple physics (gravity, water, lava, step-ups),
 * a small behaviour set (wander, melee, flying shooter, fused exploder, teleporting stalker), player combat,
 * projectiles, explosions, loot and spawning. Creatures live only on this machine (they are not synced in
 * multiplayer), and loot goes straight into the player's bag.
 *
 * Model space: the creature's feet are the origin, +Y is up and +Z is the way it faces.                  */
(function () {
  'use strict';
  const OM = window.OM, B = OM.B;
  const EPS = 1e-4, MAX_HOSTILE = 9, MAX_PASSIVE = 7, FIREBALLS = 10;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const PROTECTED = new Set([B.BEDROCK, B.OBSIDIAN, B.LAVA, B.PORTAL, B.VOID_GATE, B.GATE_FRAME, B.GATE_EYE]);   // blasts never touch these
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------------ model building
  const box = (cx, cy, cz, w, h, d, c) => ({ cx, cy, cz, w, h, d, c });
  const shade = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

  /** Merges a part's boxes into one geometry with a colour per vertex. */
  function partGeometry(boxes) {
    const pos = [], nor = [], col = [], idx = [];
    for (const b of boxes) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      g.translate(b.cx, b.cy, b.cz);
      const p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        const k = 0.94 + ((i * 7 + boxes.indexOf(b) * 13) % 5) * 0.025;
        const c = shade(b.c, k);
        col.push(c[0] / 255, c[1] / 255, c[2] / 255);
      }
      for (const i of g.index.array) idx.push(base + i);
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return geo;
  }

  // part = { name, pivot:[x,y,z], boxes:[...], glow? }   names: head, legA/legB/legC/legD, armA/armB, wingA/wingB, spin
  const part = (name, pivot, boxes, glow) => ({ name, pivot, boxes, glow: !!glow });
  const SKIN = [120, 142, 96], DARK = [40, 48, 44], EYE = [255, 200, 60];

  function bipedModel(skin, cloth, pants, eye) {
    return [
      part('legA', [-0.15, 0.72, 0], [box(0, -0.36, 0, 0.28, 0.72, 0.3, pants)]),
      part('legB', [0.15, 0.72, 0], [box(0, -0.36, 0, 0.28, 0.72, 0.3, pants)]),
      part('body', [0, 0.72, 0], [box(0, 0.36, 0, 0.6, 0.72, 0.32, cloth)]),
      part('armA', [-0.4, 1.38, 0], [box(0, -0.3, 0, 0.24, 0.72, 0.26, skin)]),
      part('armB', [0.4, 1.38, 0], [box(0, -0.3, 0, 0.24, 0.72, 0.26, skin)]),
      part('head', [0, 1.44, 0], [box(0, 0.22, 0, 0.5, 0.5, 0.5, skin)]),
      part('eyes', [0, 1.44, 0], [box(-0.12, 0.26, 0.26, 0.1, 0.07, 0.03, eye), box(0.12, 0.26, 0.26, 0.1, 0.07, 0.03, eye)], true)
    ];
  }
  function quadModel(body, head, legs, extra, eye) {
    const L = (x, z) => [x, 0.5, z];
    return [
      part('legA', L(-0.28, 0.42), [box(0, -0.25, 0, 0.24, 0.5, 0.24, legs)]),
      part('legB', L(0.28, 0.42), [box(0, -0.25, 0, 0.24, 0.5, 0.24, legs)]),
      part('legC', L(-0.28, -0.42), [box(0, -0.25, 0, 0.24, 0.5, 0.24, legs)]),
      part('legD', L(0.28, -0.42), [box(0, -0.25, 0, 0.24, 0.5, 0.24, legs)]),
      part('body', [0, 0.5, 0], [box(0, 0.3, 0, 0.78, 0.62, 1.15, body)].concat(extra || [])),
      part('head', [0, 0.78, 0.55], [box(0, 0.12, 0.2, 0.5, 0.46, 0.46, head)]),
      part('eyes', [0, 0.78, 0.55], [box(-0.14, 0.2, 0.44, 0.1, 0.08, 0.03, eye || DARK), box(0.14, 0.2, 0.44, 0.1, 0.08, 0.03, eye || DARK)], true)
    ];
  }

  // ------------------------------------------------------------------ the creatures
  // ai: 'wander' | 'melee' | 'blast' | 'flyer' | 'stalker'.  drops: [item, min, max, chance]
  const I = () => OM.I;
  const TYPES = {
    villager: {
      name: 'Villager', ai: 'wander', hostile: false, health: 20, w: 0.6, h: 1.8, speed: 1.0, leash: true, talk: true,
      model: () => bipedModel([226, 186, 152], [118, 88, 62], [74, 58, 46], [40, 28, 22]).concat([
        part('hat', [0, 1.44, 0], [box(0, 0.5, 0, 0.78, 0.07, 0.78, [120, 78, 44]), box(0, 0.62, 0, 0.5, 0.18, 0.5, [140, 92, 52])]),
        part('nose', [0, 1.44, 0], [box(0, 0.16, 0.3, 0.1, 0.22, 0.12, [206, 160, 128])])
      ]),
      drops: []
    },
    mossback: {
      name: 'Mossback', ai: 'wander', hostile: false, health: 10, w: 0.9, h: 1.1, speed: 1.2,
      model: () => quadModel([122, 92, 62], [138, 106, 72], [96, 70, 48], [box(0, 0.66, -0.05, 0.62, 0.14, 0.9, [72, 128, 52]), box(0.1, 0.76, 0.1, 0.3, 0.1, 0.3, [96, 156, 64])]),
      drops: []
    },
    puffwing: {
      name: 'Puffwing', ai: 'wander', hostile: false, health: 4, w: 0.45, h: 0.7, speed: 1.5, hop: true,
      model: () => [
        part('legA', [-0.1, 0.22, 0], [box(0, -0.11, 0, 0.07, 0.22, 0.07, [226, 160, 60])]),
        part('legB', [0.1, 0.22, 0], [box(0, -0.11, 0, 0.07, 0.22, 0.07, [226, 160, 60])]),
        part('body', [0, 0.22, 0], [box(0, 0.2, 0, 0.42, 0.4, 0.5, [244, 240, 228]), box(0, 0.22, -0.28, 0.2, 0.26, 0.14, [206, 200, 188])]),
        part('wingA', [-0.22, 0.38, 0], [box(-0.04, 0, 0, 0.06, 0.24, 0.34, [226, 222, 210])]),
        part('wingB', [0.22, 0.38, 0], [box(0.04, 0, 0, 0.06, 0.24, 0.34, [226, 222, 210])]),
        part('head', [0, 0.52, 0.2], [box(0, 0.1, 0.06, 0.26, 0.26, 0.26, [250, 246, 236]), box(0, 0.06, 0.24, 0.1, 0.07, 0.1, [236, 150, 50]), box(0, 0.2, 0.04, 0.08, 0.1, 0.16, [220, 60, 50])])
      ],
      drops: []
    },
    gloomwalker: {
      name: 'Gloomwalker', ai: 'melee', hostile: true, health: 20, w: 0.6, h: 1.9, speed: 2.1, sight: 20, reach: 1.5, damage: 3, night: true, armsOut: true,
      model: () => bipedModel([150, 160, 172], [38, 52, 56], [30, 34, 46], [90, 240, 255]).concat([
        part('hood', [0, 1.44, 0], [box(0, 0.26, -0.04, 0.6, 0.6, 0.58, [28, 38, 44]), box(0, 0.62, -0.02, 0.4, 0.14, 0.4, [24, 32, 38])])
      ]),
      drops: [['COAL', 0, 2, 0.8], ['FLINT', 1, 1, 0.12], ['IRON_INGOT', 1, 1, 0.08]]
    },
    hissbloom: {
      name: 'Hissbloom', ai: 'blast', hostile: true, health: 14, w: 0.8, h: 1.5, speed: 2.5, sight: 18, reach: 2.6, damage: 0, night: true,
      model: () => [
        part('legA', [-0.2, 0.34, 0.2], [box(0, -0.17, 0, 0.16, 0.34, 0.16, [86, 100, 44])]),
        part('legB', [0.2, 0.34, 0.2], [box(0, -0.17, 0, 0.16, 0.34, 0.16, [86, 100, 44])]),
        part('legC', [-0.2, 0.34, -0.2], [box(0, -0.17, 0, 0.16, 0.34, 0.16, [86, 100, 44])]),
        part('legD', [0.2, 0.34, -0.2], [box(0, -0.17, 0, 0.16, 0.34, 0.16, [86, 100, 44])]),
        part('body', [0, 0.34, 0], [box(0, 0.3, 0, 0.3, 0.6, 0.3, [104, 132, 54]), box(-0.28, 0.4, 0, 0.3, 0.1, 0.18, [70, 120, 48]), box(0.28, 0.4, 0, 0.3, 0.1, 0.18, [70, 120, 48])]),
        part('head', [0, 0.94, 0], [box(0, 0.22, 0, 0.62, 0.5, 0.62, [214, 74, 132]), box(0, 0.5, 0, 0.82, 0.12, 0.82, [236, 110, 168]),
          box(0, 0.18, 0.4, 0.5, 0.3, 0.18, [236, 110, 168]), box(0, 0.18, -0.4, 0.5, 0.3, 0.18, [236, 110, 168]), box(0.4, 0.18, 0, 0.18, 0.3, 0.5, [236, 110, 168]), box(-0.4, 0.18, 0, 0.18, 0.3, 0.5, [236, 110, 168])]),
        part('eyes', [0, 0.94, 0], [box(0, 0.62, 0, 0.3, 0.1, 0.3, [255, 222, 90])], true)
      ],
      drops: [['STICK', 0, 2, 0.7], ['COAL', 0, 1, 0.5]]
    },
    ashhound: {
      name: 'Ash Hound', ai: 'melee', hostile: true, health: 16, w: 0.8, h: 1.0, speed: 3.4, sight: 22, reach: 1.4, damage: 3, fireproof: true,
      model: () => quadModel([62, 58, 60], [74, 68, 70], [48, 44, 46], [box(0, 0.62, 0, 0.5, 0.1, 0.8, [226, 110, 40])], [255, 190, 60]),
      drops: [['FLINT', 0, 2, 0.6], ['COAL', 0, 1, 0.4]]
    },
    cinderling: {
      name: 'Cinderling', ai: 'flyer', hostile: true, health: 18, w: 0.8, h: 1.3, speed: 2.6, sight: 30, reach: 12, damage: 5, fireproof: true, flies: true,
      model: () => [
        part('core', [0, 0.8, 0], [box(0, 0, 0, 0.62, 0.62, 0.62, [255, 140, 36]), box(0, 0, 0, 0.36, 0.36, 0.36, [255, 236, 130])], true),
        part('head', [0, 0.8, 0], [box(0, 0.5, 0, 0.1, 0.24, 0.1, [150, 70, 28]), box(-0.2, 0.46, 0, 0.1, 0.2, 0.1, [150, 70, 28]), box(0.2, 0.46, 0, 0.1, 0.2, 0.1, [150, 70, 28])]),
        part('eyes', [0, 0.8, 0], [box(-0.13, 0.05, 0.32, 0.12, 0.1, 0.03, [60, 20, 10]), box(0.13, 0.05, 0.32, 0.12, 0.1, 0.03, [60, 20, 10])], true),
        part('spin', [0, 0.8, 0], [0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2; return box(Math.cos(a) * 0.2, -0.55 - (i % 2) * 0.1, Math.sin(a) * 0.2, 0.1, 0.55, 0.1, [236, 96, 24]); }), true)
      ],
      drops: [['EMBER_ROD', 1, 2, 0.75]]
    },
    void_stalker: {
      name: 'Void Stalker', ai: 'stalker', hostile: true, health: 32, w: 0.7, h: 2.6, speed: 3.0, sight: 24, reach: 1.7, damage: 6, teleports: true,
      model: () => [
        part('body', [0, 0.0, 0], [box(0, 0.5, 0, 0.9, 1.0, 0.5, [34, 24, 66]), box(0, 1.3, 0, 0.62, 0.7, 0.4, [44, 30, 82]), box(0, 1.9, 0, 0.74, 0.5, 0.42, [30, 20, 58])]),
        part('legA', [-0.2, 0.2, 0], [box(0, -0.1, 0, 0.3, 0.2, 0.34, [20, 14, 40])]),
        part('legB', [0.2, 0.2, 0], [box(0, -0.1, 0, 0.3, 0.2, 0.34, [20, 14, 40])]),
        part('armA', [-0.5, 2.0, 0], [box(-0.06, -0.8, 0, 0.14, 1.7, 0.16, [210, 206, 220])]),
        part('armB', [0.5, 2.0, 0], [box(0.06, -0.8, 0, 0.14, 1.7, 0.16, [210, 206, 220])]),
        part('head', [0, 2.1, 0], [box(0, 0.22, 0.02, 0.5, 0.56, 0.42, [226, 222, 232]), box(0, 0.5, -0.02, 0.56, 0.12, 0.46, [34, 24, 66])]),
        part('eyes', [0, 2.1, 0], [box(0, 0.24, 0.24, 0.07, 0.34, 0.03, [200, 100, 255])], true)
      ],
      drops: [['VOID_PEARL', 1, 1, 0.55]]
    },
    starwyrm: {
      name: 'The Starwyrm', ai: 'boss', hostile: true, health: 120, w: 3.2, h: 2.2, speed: 8, sight: 120, reach: 4.5, damage: 8, flies: true, fireproof: true, boss: true, big: true,
      model: () => {
        const parts = [
          part('body', [0, 1.1, 0], [box(0, 0, 0, 1.6, 1.3, 3.4, [30, 22, 52]), box(0, 0.5, -0.4, 1.0, 0.4, 2.2, [70, 40, 120])]),
          part('head', [0, 1.2, 2.0], [box(0, 0.1, 0.5, 1.2, 1.0, 1.4, [38, 26, 62]), box(0, -0.2, 1.1, 1.0, 0.3, 0.8, [24, 16, 40])]),
          part('eyes', [0, 1.2, 2.0], [box(-0.42, 0.4, 1.2, 0.26, 0.18, 0.05, [230, 120, 255]), box(0.42, 0.4, 1.2, 0.26, 0.18, 0.05, [230, 120, 255])], true),
          part('wingA', [-0.8, 1.7, 0.4], [box(-2.0, 0, 0, 4.0, 0.14, 2.4, [48, 34, 82])]),
          part('wingB', [0.8, 1.7, 0.4], [box(2.0, 0, 0, 4.0, 0.14, 2.4, [48, 34, 82])]),
          part('tail', [0, 1.1, -1.7], [box(0, 0, -1.6, 0.9, 0.8, 3.2, [26, 18, 44]), box(0, 0, -3.8, 0.5, 0.5, 1.6, [22, 14, 36])])
        ];
        return parts;
      },
      drops: [['DIAMOND', 4, 6, 1]]
    }
  };

  // ------------------------------------------------------------------ physics
  function sweepAxis(W, p, hw, h, axis, d) {
    if (d === 0) return 0;
    const mins = [p.x - hw, p.y, p.z - hw], maxs = [p.x + hw, p.y + h, p.z + hw];
    const lo = mins[axis], hi = maxs[axis];
    if (d < 0) mins[axis] += d; else maxs[axis] += d;
    const x0 = Math.floor(mins[0] + EPS), x1 = Math.floor(maxs[0] - EPS);
    const y0 = Math.floor(mins[1] + EPS), y1 = Math.floor(maxs[1] - EPS);
    const z0 = Math.floor(mins[2] + EPS), z1 = Math.floor(maxs[2] - EPS);
    let res = d;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (!W.isSolid(x, y, z)) continue;
      const b = axis === 0 ? x : axis === 1 ? y : z;
      if (d > 0) { const gap = b - hi; if (gap > -EPS && gap < res) res = Math.max(0, gap); }
      else { const gap = b + 1 - lo; if (gap < EPS && gap > res) res = Math.min(0, gap); }
    }
    return res;
  }

  let uid = 1;
  class Mob {
    constructor(key, x, y, z, scene) {
      const T = (this.type = TYPES[key]);
      this.key = key; this.id = uid++;
      this.x = x; this.y = y; this.z = z;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.health = T.health; this.maxHealth = T.health;
      this.yaw = Math.random() * Math.PI * 2; this.heading = this.yaw;
      this.age = Math.random() * 10; this.t = 0; this.moving = false; this.dir = 0;
      this.attackCd = 1; this.hurtT = 0; this.flee = 0; this.fuse = -1; this.shootCd = rnd(1.5, 3); this.tpCd = rnd(1.5, 3.5); this.stuckT = 0; this.side = 0;
      this.onGround = false; this.collided = false; this.deadT = -1; this.limb = 0; this.burnT = 0; this.shot = 0;
      this.group = new THREE.Group();
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.parts = {};
      for (const p of T.model()) {
        const m = new THREE.Mesh(partGeometry(p.boxes), p.glow ? Mob.glowMat : this.mat);
        m.position.set(p.pivot[0], p.pivot[1], p.pivot[2]);
        if (p.name === 'eyes') { /* eyes follow the head */ }
        this.group.add(m);
        (this.parts[p.name] = this.parts[p.name] || []).push(m);
      }
      this.group.position.set(x, y, z);
      scene.add(this.group);
    }
    dispose(scene) {
      scene.remove(this.group);
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.mat.dispose();
    }
    get alive() { return this.deadT < 0; }
  }
  Mob.glowMat = null;

  // ------------------------------------------------------------------ the manager
  class Mobs {
    constructor(world, scene, o) {
      this.world = world; this.scene = scene; this.player = o.player; this.audio = o.audio || null;
      this.toast = o.toast || (() => {}); this.give = o.give || (() => {});
      this.net = null;                 // set while in a multiplayer room (explosions then spare the blocks)
      this.list = []; this.balls = [];
      this.target = null; this.spawnT = 2; this.realm = 'meadow'; this.daylight = 1; this.enabled = true;
      this.onKill = null; this.onBossDeath = null; this.onHurtPlayer = null;
      Mob.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      const ballGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
      for (let i = 0; i < FIREBALLS; i++) {
        const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
        m.visible = false; scene.add(m);
        this.balls.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, dmg: 5, kind: 'fire' });
      }
    }

    count(hostile) { let n = 0; for (const m of this.list) if (m.alive && !!m.type.hostile === hostile) n++; return n; }
    alive() { return this.list.filter((m) => m.alive); }
    clear() { for (const m of this.list) m.dispose(this.scene); this.list.length = 0; for (const b of this.balls) { b.life = 0; b.mesh.visible = false; } this.target = null; }

    spawn(key, x, y, z) {
      if (!TYPES[key]) return null;
      const m = new Mob(key, x, y, z, this.scene);
      this.list.push(m);
      return m;
    }

    // ------------------------------------------------------------ targeting / combat
    /** Nearest creature along a ray, within reach: { mob, t } or null. */
    raycast(o, d, reach) {
      let best = null;
      for (const m of this.list) {
        if (!m.alive) continue;
        const hw = m.type.w / 2;
        const min = [m.x - hw, m.y, m.z - hw], max = [m.x + hw, m.y + m.type.h, m.z + hw];
        const org = [o.x, o.y, o.z], dir = [d.x, d.y, d.z];
        let t0 = 0, t1 = reach, ok = true;
        for (let a = 0; a < 3 && ok; a++) {
          if (Math.abs(dir[a]) < 1e-9) { if (org[a] < min[a] || org[a] > max[a]) ok = false; }
          else {
            let ta = (min[a] - org[a]) / dir[a], tb = (max[a] - org[a]) / dir[a];
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > t0) t0 = ta;
            if (tb < t1) t1 = tb;
            if (t0 > t1) ok = false;
          }
        }
        if (ok && (!best || t0 < best.t)) best = { mob: m, t: t0 };
      }
      return best;
    }
    setTarget(m) { this.target = m && m.alive ? m : null; }

    hurt(m, amount, kx, kz) {
      if (!m.alive || m.hurtT > 0.12) return false;
      m.health -= amount;
      m.hurtT = 0.28;
      m.flee = m.type.hostile ? 0 : 4;
      const len = Math.hypot(kx, kz) || 1;
      m.vx += (kx / len) * (m.type.big ? 2 : 6); m.vz += (kz / len) * (m.type.big ? 2 : 6); if (!m.type.flies) m.vy = Math.max(m.vy, 5);
      if (this.audio) this.audio.play('hurt');
      if (m.type.teleports && Math.random() < 0.45) this.teleportNear(m, 6, 12);
      if (m.health <= 0) this.kill(m);
      return true;
    }
    kill(m) {
      m.deadT = 0;
      for (const d of m.type.drops) {
        if (Math.random() > d[3]) continue;
        const n = d[1] + Math.floor(Math.random() * (d[2] - d[1] + 1));
        const id = OM.I[d[0]];
        if (n > 0 && id) { this.give(id, n); this.toast('+' + n + ' ' + OM.Items.get(id).name, 1100); }
      }
      if (this.onKill) this.onKill(m);
      if (m.type.boss && this.onBossDeath) this.onBossDeath(m);
    }

    // ------------------------------------------------------------ projectiles and blasts
    fireball(x, y, z, tx, ty, tz, dmg, speed) {
      const b = this.balls.find((q) => q.life <= 0);
      if (!b) return;
      const dx = tx - x, dy = ty - y, dz = tz - z, len = Math.hypot(dx, dy, dz) || 1;
      b.life = 5; b.dmg = dmg || 5;
      b.vx = (dx / len) * (speed || 13); b.vy = (dy / len) * (speed || 13); b.vz = (dz / len) * (speed || 13);
      b.mesh.position.set(x, y, z); b.mesh.visible = true;
    }
    explode(x, y, z, radius, power) {
      const W = this.world, P = this.player;
      const r = Math.ceil(radius);
      if (!this.net) {                                   // single player: blocks go too (never bedrock, obsidian or lava)
        for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
          const id = W.getBlock(bx, by, bz);
          if (id > 0 && !PROTECTED.has(id) && by > 1) {
            if (id === B.FURNACE) OM.Furnaces.take(bx, by, bz);
            W.setBlock(bx, by, bz, 0);
          }
        }
      }
      const d = Math.hypot(P.pos.x - x, P.pos.y + 0.9 - y, P.pos.z - z);
      if (d < radius * 2) {
        const amount = Math.round(power * (1 - d / (radius * 2)));
        if (amount > 0) P.damage(amount, 'blast');
        const k = 9 * (1 - d / (radius * 2)) / (d || 1);
        P.vel.x += (P.pos.x - x) * k; P.vel.z += (P.pos.z - z) * k; P.vel.y = Math.max(P.vel.y, 6 * (1 - d / (radius * 2)));
      }
      if (this.onExplode) this.onExplode(x, y, z, radius);
      if (this.audio) this.audio.play('break', 'stone');
    }

    teleportNear(m, rMin, rMax) {
      const W = this.world, P = this.player.pos;
      for (let tries = 0; tries < 14; tries++) {
        const a = Math.random() * Math.PI * 2, r = rnd(rMin, rMax);
        const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
        const y = this.groundY(x, z, P.y + 8);
        if (y !== null && this.fits(m.type, x, y, z)) { m.x = x; m.y = y; m.z = z; m.vx = m.vy = m.vz = 0; return true; }
      }
      return false;
    }
    /** Top of the ground at (x, z) seen from `fromY`, or null when it is unloaded, flooded or on fire. */
    groundY(x, z, fromY) {
      const W = this.world, bx = Math.floor(x), bz = Math.floor(z);
      for (let y = Math.min(OM.CONST.CY - 3, Math.floor(fromY)); y > 2; y--) {
        const id = W.getBlock(bx, y, bz);
        if (id < 0) return null;
        if (id > 0 && W.isSolid(bx, y, bz)) {
          if (id === B.LAVA || W.getWater(bx, y + 1, bz) > 0) return null;
          return y + 1;
        }
        if (id === B.LAVA) return null;
      }
      return null;
    }
    fits(T, x, y, z) {
      const hw = T.w / 2, W = this.world;
      for (let by = Math.floor(y + 0.01); by <= Math.floor(y + T.h - 0.01); by++)
        for (let bz = Math.floor(z - hw); bz <= Math.floor(z + hw); bz++)
          for (let bx = Math.floor(x - hw); bx <= Math.floor(x + hw); bx++)
            if (W.getBlock(bx, by, bz) !== 0) return false;
      return true;
    }

    // ------------------------------------------------------------ spawning
    spawnTable() {
      if (this.realm === 'ember') return { hostile: ['ashhound', 'ashhound', 'cinderling', 'cinderling', 'gloomwalker', 'void_stalker'], passive: [] };
      if (this.realm === 'end') return { hostile: ['void_stalker', 'void_stalker', 'void_stalker'], passive: [] };
      return { hostile: ['gloomwalker', 'gloomwalker', 'hissbloom'], passive: ['mossback', 'mossback', 'puffwing', 'puffwing', 'puffwing'] };
    }
    trySpawn() {
      const P = this.player.pos, table = this.spawnTable();
      const dark = this.realm !== 'meadow' || this.daylight < 0.32;
      const cap = this.realm === 'meadow' ? MAX_HOSTILE : this.realm === 'end' ? 3 : MAX_HOSTILE + 3;
      const wantHostile = dark && this.count(true) < cap && table.hostile.length;
      const wantPassive = !dark && this.realm === 'meadow' && this.count(false) < MAX_PASSIVE && table.passive.length;
      if (!wantHostile && !wantPassive) return;
      const a = Math.random() * Math.PI * 2, r = rnd(this.realm === 'meadow' ? 20 : 14, 40);
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      if (!this.world.isAreaReady(x, z)) return;
      let key = wantHostile ? table.hostile[Math.floor(Math.random() * table.hostile.length)] : table.passive[Math.floor(Math.random() * table.passive.length)];
      if (key === 'cinderling') { const g = this.realmGen; if (!(g && g.citadelNear && g.citadelNear(x, z, 56))) key = 'ashhound'; }   // cinderlings keep to the citadels
      const T = TYPES[key];
      let y;
      if (T.flies) { const g = this.groundY(x, z, P.y + 20); y = g === null ? null : g + rnd(3, 7); }
      else y = this.groundY(x, z, P.y + 10);
      if (y === null || Math.abs(y - P.y) > 24) return;
      if (this.realm === 'meadow' && !wantHostile) { const g = this.world.getBlock(Math.floor(x), Math.floor(y) - 1, Math.floor(z)); if (g !== B.GRASS) return; }
      if (!this.fits(T, x, y, z)) return;
      this.spawn(key, x, y, z);
    }

    /** Keeps a few villagers walking about whenever the player is near a village. */
    trySpawnVillager() {
      const g = this.world.gen, P = this.player.pos;
      const v = g.villageNear && g.villageNear(P.x, P.z, 60);
      if (!v || this.list.filter((m) => m.alive && m.key === 'villager').length >= 4) return;
      const a = Math.random() * Math.PI * 2, r = rnd(2, 9), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (!this.world.isAreaReady(x, z)) return;
      const y = this.groundY(x, z, v.h + 10);
      if (y === null || Math.abs(y - v.h - 1) > 3 || !this.fits(TYPES.villager, x, y, z)) return;
      const m = this.spawn('villager', x, y, z);
      m.home = { x: v.x, z: v.z }; m.line = Math.floor(Math.random() * 6);
    }

    // ------------------------------------------------------------ update
    update(dt, ctx) {
      this.daylight = ctx.daylight; this.realm = ctx.realm || this.realm;
      const P = this.player;
      if (this.enabled && !P.dead) {
        this.spawnT -= dt;
        if (this.spawnT <= 0) { this.spawnT = rnd(1.6, 3.2); if (this.list.length < 28) this.trySpawn(); }
      }
      this.villagerT = (this.villagerT || 0) - dt;
      if (this.enabled && this.realm === 'meadow' && !P.dead && this.villagerT <= 0) { this.villagerT = rnd(1.5, 3); this.trySpawnVillager(); }
      for (let i = this.list.length - 1; i >= 0; i--) {
        const m = this.list[i];
        const far = Math.hypot(m.x - P.pos.x, m.z - P.pos.z);
        if (m.alive && !m.type.boss && (far > 80 || (this.realm === 'meadow' && m.type.hostile && !m.type.fireproof && this.daylight > 0.75 && far > 24 && Math.random() < dt * 0.15))) {
          m.dispose(this.scene); this.list.splice(i, 1); continue;
        }
        if (m.deadT >= 0) {
          m.deadT += dt;
          m.group.scale.setScalar(Math.max(0.01, 1 - m.deadT * 1.6));
          m.group.rotation.z = Math.min(1.4, m.deadT * 4);
          if (m.deadT > 0.7) { m.dispose(this.scene); this.list.splice(i, 1); if (this.target === m) this.target = null; }
          continue;
        }
        if (!this.world.isAreaReady(m.x, m.z)) continue;
        this.think(m, dt);
        this.physics(m, dt);
        this.pose(m, dt);
      }
      this.updateBalls(dt);
    }

    think(m, dt) {
      const T = m.type, P = this.player, p = P.pos;
      m.age += dt; m.hurtT = Math.max(0, m.hurtT - dt); m.attackCd -= dt; m.flee = Math.max(0, m.flee - dt);
      const dx = p.x - m.x, dz = p.z - m.z, dy = p.y + 0.9 - (m.y + T.h * 0.5), dist = Math.hypot(dx, dz);
      let wx = 0, wz = 0, speed = T.speed, jump = false;
      m.wantY = null;
      const seen = T.hostile && !P.dead && dist < (T.sight || 0);
      if (T.ai === 'wander' || !seen) {
        m.t -= dt;
        if (m.t <= 0) { m.t = rnd(2, 6); m.moving = Math.random() < (T.hostile ? 0.35 : 0.6); m.dir = Math.random() * Math.PI * 2; }
        if (m.flee > 0) { m.dir = Math.atan2(-dz, -dx); m.moving = true; speed *= 1.7; }
        else if (T.leash && m.home && Math.hypot(m.x - m.home.x, m.z - m.home.z) > 15) { m.dir = Math.atan2(m.home.z - m.z, m.home.x - m.x); m.moving = true; }
        if (T.talk && dist < 3.2 && !T.hostile) { m.moving = false; m.heading = Math.atan2(dx, dz); }                                  // stops to look at you
        if (m.moving) { wx = Math.cos(m.dir); wz = Math.sin(m.dir); if (T.hostile) speed *= 0.5; }
        if (T.flies && !seen) m.wantY = m.y;
      } else if (T.ai === 'melee' || T.ai === 'stalker') {
        wx = dx / (dist || 1); wz = dz / (dist || 1);
        if (m.stuckT > 0.7) { const a = (m.side || (m.side = Math.random() < 0.5 ? 1 : -1)) * 1.25, c = Math.cos(a), s = Math.sin(a); const rx = wx * c - wz * s; wz = wx * s + wz * c; wx = rx; if (m.stuckT > 1.8) { m.stuckT = 0.3; m.side = -m.side; } }   // walled in: go round
        if (dist < T.reach * 0.8) { wx *= 0.2; wz *= 0.2; }
        if (dist < T.reach && Math.abs(dy) < 1.9 && m.attackCd <= 0) {
          m.attackCd = 1.05;
          P.damage(T.damage, 'mob');
          P.vel.x += wx * 4; P.vel.z += wz * 4;
          if (this.onHurtPlayer) this.onHurtPlayer(m);
        }
        if (T.teleports) {
          m.tpCd -= dt;
          if (m.tpCd <= 0 && dist > 5) { m.tpCd = rnd(3, 6); this.teleportNear(m, 2.5, 5); }
        }
      } else if (T.ai === 'blast') {
        wx = dx / (dist || 1); wz = dz / (dist || 1);
        if (m.fuse < 0 && dist < T.reach) m.fuse = 1.4;
        if (m.fuse >= 0) {
          m.fuse -= dt; speed *= 0.2;
          if (dist > T.reach * 2.2) m.fuse = -1;                     // you got away
          else if (m.fuse <= 0) { this.explode(m.x, m.y + 0.6, m.z, 3.2, 16); m.health = 0; m.deadT = 0; m.fuse = -1; return; }
        }
      } else if (T.ai === 'flyer') {
        const want = Math.atan2(dz, dx) + Math.sin(m.age * 0.6) * 0.8;          // circle the player at a distance
        const ring = dist > 9 ? 1 : dist < 5 ? -1 : 0;
        wx = Math.cos(want + Math.PI / 2) * 0.7 + (dx / (dist || 1)) * ring * 0.9; wz = Math.sin(want + Math.PI / 2) * 0.7 + (dz / (dist || 1)) * ring * 0.9;
        m.wantY = p.y + 3.2 + Math.sin(m.age * 1.3) * 1.2;
        m.shootCd -= dt;
        if (m.shootCd <= 0 && dist < T.reach + 6 && dist > 3) {
          m.shootCd = rnd(2.1, 3.4); m.shot = 0.25;
          this.fireball(m.x, m.y + 0.7, m.z, p.x, p.y + 1.0, p.z, T.damage, 12);
        }
      } else if (T.ai === 'boss') {
        this.thinkBoss(m, dt, dx, dy, dz, dist);
        return;
      }
      m.wishX = wx; m.wishZ = wz; m.speed = speed; m.jump = jump;
      if (wx || wz) m.heading = Math.atan2(wx, wz);
    }

    thinkBoss(m, dt, dx, dy, dz, dist) {
      const T = m.type, p = this.player.pos;
      m.phase = (m.phase || 0) + dt;
      // sweeping circles over the arena, with dives at the player
      const orbit = 16 + Math.sin(m.age * 0.4) * 5;
      m.diving = m.diving || 0;
      let tx, ty, tz;
      if (m.diving > 0) { m.diving -= dt; tx = p.x; ty = p.y + 1; tz = p.z; }
      else {
        const a = m.age * 0.35;
        tx = (m.cx || 0) + Math.cos(a) * orbit; tz = (m.cz || 0) + Math.sin(a) * orbit; ty = (m.cy || 60) + 8 + Math.sin(m.age * 0.9) * 3;
        m.diveCd = (m.diveCd === undefined ? 6 : m.diveCd) - dt;
        if (m.diveCd <= 0) { m.diveCd = rnd(7, 11); m.diving = 3.2; }
        m.shootCd -= dt;
        if (m.shootCd <= 0 && dist < 40) { m.shootCd = rnd(2.6, 4); this.fireball(m.x, m.y + 1, m.z, p.x, p.y + 1, p.z, 6, 14); }
      }
      const ddx = tx - m.x, ddy = ty - m.y, ddz = tz - m.z, dl = Math.hypot(ddx, ddy, ddz) || 1;
      const sp = m.diving > 0 ? 11 : T.speed * 0.7;
      m.vx += ((ddx / dl) * sp - m.vx) * (1 - Math.exp(-1.6 * dt));
      m.vy += ((ddy / dl) * sp - m.vy) * (1 - Math.exp(-1.6 * dt));
      m.vz += ((ddz / dl) * sp - m.vz) * (1 - Math.exp(-1.6 * dt));
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      if (Math.abs(m.vx) + Math.abs(m.vz) > 0.1) m.heading = Math.atan2(m.vx, m.vz);
      if (dist < T.reach + 1.2 && Math.abs(dy) < 3 && m.attackCd <= 0) {
        m.attackCd = 1.4; this.player.damage(T.damage, 'mob');
        this.player.vel.x += (dx / (dist || 1)) * 8; this.player.vel.z += (dz / (dist || 1)) * 8; this.player.vel.y = Math.max(this.player.vel.y, 5);
      }
      m.wishX = m.wishZ = 0; m.boss = true;
    }

    physics(m, dt) {
      const T = m.type, W = this.world, hw = T.w / 2;
      if (m.boss) return;                                        // the boss flies freely
      const inWater = W.getWater(Math.floor(m.x), Math.floor(m.y + 0.3), Math.floor(m.z)) > 0;
      const inLava = W.getBlock(Math.floor(m.x), Math.floor(m.y + 0.2), Math.floor(m.z)) === B.LAVA;
      const wx = m.wishX || 0, wz = m.wishZ || 0;
      let speed = (m.speed || 0) * (inWater ? 0.55 : 1) * (m.fuse >= 0 ? 0.25 : 1);
      // do not walk into lava, deep water or (when peaceful) off a tall ledge
      if ((wx || wz) && !T.flies) {
        const ax = Math.floor(m.x + wx * 0.9), az = Math.floor(m.z + wz * 0.9);
        let gy = Math.floor(m.y), drop = 0;
        while (gy > 1 && W.getBlock(ax, gy - 1, az) === 0 && drop < 6) { gy--; drop++; }
        const ground = W.getBlock(ax, gy - 1, az);
        if (ground === B.LAVA || W.getBlock(ax, Math.floor(m.y), az) === B.LAVA || (drop > (T.hostile && m.attackCd < 5 ? 3 : 1) && !m.flee)) { speed = 0; m.moving = false; m.t = 0; }
      }
      if (T.flies) {
        const want = m.wantY === null || m.wantY === undefined ? m.y : m.wantY;
        m.vy += clamp((want - m.y) * 2.2 - m.vy, -6, 6) * (1 - Math.exp(-3 * dt));
        const k = 1 - Math.exp(-2.4 * dt);
        m.vx += (wx * speed - m.vx) * k; m.vz += (wz * speed - m.vz) * k;
      } else {
        const k = 1 - Math.exp(-(m.onGround ? 14 : 3) * dt);
        m.vx += (wx * speed - m.vx) * k; m.vz += (wz * speed - m.vz) * k;
        m.vy -= 30 * dt;
        if (inWater) m.vy += 44 * dt * (m.vy < 1.5 ? 1 : 0.2) - m.vy * 3 * dt;
        if (inLava) m.vy += 30 * dt;
        if (m.vy < -50) m.vy = -50;
        if ((wx || wz) && m.collided && m.onGround && speed > 0) m.vy = T.hop ? 7.5 : 8.6;
        else if (T.hop && m.onGround && (wx || wz) && Math.random() < dt * 2.5) m.vy = 6.5;
      }
      const p = { x: m.x, y: m.y, z: m.z };
      const dy = sweepAxis(W, p, hw, T.h, 1, m.vy * dt);
      m.onGround = false;
      if (dy !== m.vy * dt) { if (m.vy < 0) m.onGround = true; m.vy = 0; }
      m.y += dy; p.y = m.y;
      m.collided = false;
      const wasStuck = m.stuckT;
      const mx = sweepAxis(W, p, hw, T.h, 0, m.vx * dt);
      if (mx !== m.vx * dt) { m.collided = true; m.vx = 0; }
      m.x += mx; p.x = m.x;
      const mz = sweepAxis(W, p, hw, T.h, 2, m.vz * dt);
      if (mz !== m.vz * dt) { m.collided = true; m.vz = 0; }
      m.z += mz;
      m.stuckT = m.collided && (wx || wz) ? m.stuckT + dt : Math.max(0, wasStuck - dt * 2);
      if (m.y < 1) { m.y = 1; m.vy = 0; }
      if (inLava && !T.fireproof) { m.burnT += dt; if (m.burnT >= 0.5) { m.burnT = 0; this.hurt(m, 3, 0, 0); m.hurtT = 0; } }
    }

    pose(m, dt) {
      const T = m.type;
      // turn smoothly toward where it is heading
      let d = m.heading - m.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      m.yaw += d * Math.min(1, dt * 9);
      const g = m.group;
      g.position.set(m.x, m.y, m.z);
      g.rotation.set(0, m.yaw, 0);
      g.scale.setScalar(1);
      const sp = Math.hypot(m.vx, m.vz);
      m.limb += dt * (3 + sp * 3.2);
      const sw = Math.sin(m.limb) * Math.min(1, sp / 1.6) * 0.9;
      const set = (name, rx) => { const a = m.parts[name]; if (a) for (const mesh of a) mesh.rotation.x = rx; };
      set('legA', sw); set('legB', -sw); set('legC', -sw); set('legD', sw);
      if (T.armsOut) { set('armA', -1.35 + sw * 0.15); set('armB', -1.35 - sw * 0.15); } else { set('armA', -sw * 0.8); set('armB', sw * 0.8); }
      const flap = Math.sin(m.age * (T.flies ? 14 : 20));
      if (m.parts.wingA) for (const w of m.parts.wingA) w.rotation.z = T.big ? flap * 0.5 : (sp > 0.3 || !m.onGround ? flap * 0.5 : 0);
      if (m.parts.wingB) for (const w of m.parts.wingB) w.rotation.z = T.big ? -flap * 0.5 : (sp > 0.3 || !m.onGround ? -flap * 0.5 : 0);
      if (m.parts.spin) for (const s of m.parts.spin) s.rotation.y = m.age * 2.4;
      if (m.parts.core) for (const c of m.parts.core) c.scale.setScalar(1 + Math.sin(m.age * 6) * 0.08);
      // flash red when hurt; flash white while a fuse burns
      const flash = m.hurtT > 0 ? m.hurtT / 0.28 : 0, fuse = m.fuse >= 0 ? (Math.sin(m.age * 26) > 0 ? 0.9 : 0) : 0;
      m.mat.emissive.setRGB(flash * 0.8 + fuse, flash * 0.1 + fuse, flash * 0.1 + fuse);
      if (m.fuse >= 0) g.scale.setScalar(1 + (1.4 - m.fuse) * 0.18);
      m.shot = Math.max(0, m.shot - dt);
    }

    updateBalls(dt) {
      const W = this.world, P = this.player, p = P.pos;
      for (const b of this.balls) {
        if (b.life <= 0) continue;
        b.life -= dt;
        const m = b.mesh.position;
        m.x += b.vx * dt; m.y += b.vy * dt; m.z += b.vz * dt;
        b.mesh.rotation.x += dt * 8; b.mesh.rotation.y += dt * 6;
        const hitBlock = W.isSolid(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z));
        const hitPlayer = !P.dead && Math.abs(m.x - p.x) < 0.5 && Math.abs(m.z - p.z) < 0.5 && m.y > p.y - 0.2 && m.y < p.y + P.height + 0.2;
        if (hitPlayer) { P.damage(b.dmg, 'fire'); P.burning = Math.max(P.burning, 4); }
        if (hitBlock || hitPlayer || b.life <= 0) { b.life = 0; b.mesh.visible = false; }
      }
    }
  }

  OM.Mobs = Mobs;
  OM.MobTypes = TYPES;
})();
