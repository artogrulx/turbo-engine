/* Open Meadow — engine/remote.js
 * Other players in a multiplayer room: small blocky avatars with a face, hair, name tag and
 * walk / crouch / swim animation. The server sends each player's state ~10 times a second;
 * avatars glide toward it so movement looks smooth. A handful of boxes per player: cheap.  */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});
  const SKINS = [0xe2b58a, 0xc68a5c, 0x8d5a3a, 0xf1c9a5];
  const HAIRS = [0x3b2a1a, 0x141414, 0xc9a24a, 0x7a3b1c, 0xa8a8a8];
  const PANTS = 0x35457d;
  // state flag bits (must match Net.update): 1 sneaking, 2 sprinting, 4 in water, 8 on ground, 16 head under water
  const F_SNEAK = 1, F_WATER = 4, F_GROUND = 8;

  let shared = null;
  function geometries() {
    if (!shared) {
      shared = {
        head: new THREE.BoxGeometry(0.45, 0.45, 0.45), body: new THREE.BoxGeometry(0.5, 0.7, 0.25),
        arm: new THREE.BoxGeometry(0.2, 0.65, 0.2), leg: new THREE.BoxGeometry(0.24, 0.65, 0.24),
        hairTop: new THREE.BoxGeometry(0.49, 0.1, 0.49), hairBack: new THREE.BoxGeometry(0.49, 0.3, 0.1)
      };
    }
    return shared;
  }
  const faceCache = {};
  function faceTexture(skin) {
    if (faceCache[skin]) return faceCache[skin];
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = '#' + skin.toString(16).padStart(6, '0');
    x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#ffffff'; x.fillRect(2, 6, 4, 3); x.fillRect(10, 6, 4, 3);
    x.fillStyle = '#2b3a67'; x.fillRect(4, 6, 2, 3); x.fillRect(10, 6, 2, 3);
    x.fillStyle = '#7a3b2c'; x.fillRect(6, 11, 4, 1);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return (faceCache[skin] = t);
  }

  function makeTag(name, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const x = c.getContext('2d');
    x.font = '600 26px "Segoe UI", Ubuntu, system-ui, sans-serif';
    const w = Math.min(244, Math.ceil(x.measureText(name).width) + 28);
    const left = (256 - w) / 2;
    x.fillStyle = 'rgba(8, 16, 10, 0.62)';
    x.beginPath();
    if (x.roundRect) x.roundRect(left, 4, w, 40, 12); else x.rect(left, 4, w, 40);
    x.fill();
    x.fillStyle = color; x.fillRect(left + 8, 36, w - 16, 3);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, 128, 23, 232);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(1.6, 0.3, 1);
    sprite.renderOrder = 6;
    return sprite;
  }

  const angleDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  class Avatar {
    constructor(p) {
      const G = geometries();
      this.id = p.id; this.name = p.name; this.color = p.color;
      const skin = SKINS[p.id % SKINS.length];
      const m = this.mats = {
        skin: new THREE.MeshLambertMaterial({ color: skin }),
        shirt: new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color) }),
        pants: new THREE.MeshLambertMaterial({ color: PANTS }),
        hair: new THREE.MeshLambertMaterial({ color: HAIRS[(p.id * 3) % HAIRS.length] }),
        face: new THREE.MeshLambertMaterial({ map: faceTexture(skin) })
      };
      const mesh = (geom, mat, x, y, z) => { const o = new THREE.Mesh(geom, mat); o.position.set(x, y, z); o.castShadow = true; return o; };
      this.root = new THREE.Group();                        // feet position + yaw
      this.tilt = new THREE.Group(); this.root.add(this.tilt);   // leans the whole body (swimming)
      this.upper = new THREE.Group(); this.upper.position.set(0, 0.65, 0); this.tilt.add(this.upper); // pivot at the hips (crouching)
      this.upper.add(mesh(G.body, m.shirt, 0, 0.35, 0));
      this.head = new THREE.Group(); this.head.position.set(0, 0.7, 0); this.upper.add(this.head);
      const skull = new THREE.Mesh(G.head, [m.skin, m.skin, m.skin, m.skin, m.skin, m.face]); // index 5 = the -Z face = "front"
      skull.position.y = 0.225; skull.castShadow = true;
      this.head.add(skull, mesh(G.hairTop, m.hair, 0, 0.45, 0), mesh(G.hairBack, m.hair, 0, 0.27, 0.17));
      this.armL = new THREE.Group(); this.armL.position.set(0.35, 0.65, 0); this.armL.add(mesh(G.arm, m.shirt, 0, -0.3, 0));
      this.armR = new THREE.Group(); this.armR.position.set(-0.35, 0.65, 0); this.armR.add(mesh(G.arm, m.shirt, 0, -0.3, 0));
      this.upper.add(this.armL, this.armR);
      this.legL = new THREE.Group(); this.legL.position.set(0.125, 0.65, 0); this.legL.add(mesh(G.leg, m.pants, 0, -0.325, 0));
      this.legR = new THREE.Group(); this.legR.position.set(-0.125, 0.65, 0); this.legR.add(mesh(G.leg, m.pants, 0, -0.325, 0));
      this.tilt.add(this.legL, this.legR);
      this.tag = makeTag(p.name, p.color);
      this.tag.position.set(0, 2.15, 0);
      this.root.add(this.tag);
      const s = p.s || [0, 0, 0, 0, 0, 0];
      this.px = this.tx = s[0]; this.py = this.ty = s[1]; this.pz = this.tz = s[2];
      this.yaw = this.tyaw = s[3]; this.pitch = this.tpitch = s[4]; this.flags = s[5] | 0;
      this.ox = this.px; this.oz = this.pz; this.speed = 0; this.phase = Math.random() * 6; this.lean = 0; this.crouch = 0;
      this.hasState = !!p.s && (s[0] !== 0 || s[1] !== 0 || s[2] !== 0);
      this.root.visible = this.hasState;   // hidden until the first position arrives, so nobody appears at (0,0,0)
      this.apply();
    }

    set(x, y, z, yaw, pitch, flags) {
      if (!this.hasState) { this.px = x; this.py = y; this.pz = z; this.yaw = yaw; this.hasState = true; this.root.visible = true; }
      this.tx = x; this.ty = y; this.tz = z; this.tyaw = yaw; this.tpitch = pitch; this.flags = flags | 0;
    }

    apply() {
      this.root.position.set(this.px, this.py, this.pz);
      this.root.rotation.y = this.yaw;
    }

    update(dt, camPos) {
      const k = 1 - Math.exp(-14 * dt);
      const dx = this.tx - this.px, dz = this.tz - this.pz;
      if (dx * dx + dz * dz > 100 || Math.abs(this.ty - this.py) > 10) { this.px = this.tx; this.py = this.ty; this.pz = this.tz; }   // teleport
      else { this.px += dx * k; this.py += (this.ty - this.py) * k; this.pz += dz * k; }
      this.yaw += angleDiff(this.tyaw, this.yaw) * k;
      this.pitch += (this.tpitch - this.pitch) * k;
      const inst = dt > 0 ? Math.hypot(this.px - this.ox, this.pz - this.oz) / dt : 0;
      this.ox = this.px; this.oz = this.pz;
      this.speed += (inst - this.speed) * (1 - Math.exp(-10 * dt));
      const swimming = (this.flags & F_WATER) && !(this.flags & F_GROUND);
      this.phase += dt * (swimming ? 5 : 2.2 + this.speed * 1.5);
      const amp = Math.min(1, this.speed / 2.5) * (swimming ? 0.5 : 0.85);
      const swing = Math.sin(this.phase) * amp;
      this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing; this.armR.rotation.x = swing;
      if (swimming) { this.legL.rotation.x = Math.sin(this.phase) * 0.45; this.legR.rotation.x = -Math.sin(this.phase) * 0.45; }
      this.lean += ((swimming ? -1.15 : 0) - this.lean) * k;
      this.tilt.rotation.x = this.lean;
      this.tilt.position.y = -this.lean * 0.45;
      this.crouch += (((this.flags & F_SNEAK) ? -0.4 : 0) - this.crouch) * k;
      this.upper.rotation.x = this.crouch;
      this.head.rotation.x = Math.max(-1.2, Math.min(1.2, this.pitch)) - this.crouch * 0.6;
      this.apply();
      const d = camPos ? Math.hypot(camPos.x - this.px, camPos.y - this.py, camPos.z - this.pz) : 0;
      this.tag.material.opacity = Math.max(0, Math.min(1, (64 - d) / 20));
      this.tag.visible = this.tag.material.opacity > 0.02;
    }

    dispose() {
      this.tag.material.map.dispose(); this.tag.material.dispose();
      for (const k in this.mats) this.mats[k].dispose();
    }
  }

  class RemotePlayers {
    constructor(scene) {
      this.scene = scene;
      this.map = new Map();
    }
    add(p) {
      this.remove(p.id);
      const a = new Avatar(p);
      this.map.set(p.id, a);
      this.scene.add(a.root);
    }
    remove(id) {
      const a = this.map.get(id);
      if (!a) return;
      this.scene.remove(a.root);
      a.dispose();
      this.map.delete(id);
    }
    setState(id, x, y, z, yaw, pitch, flags) {
      const a = this.map.get(id);
      if (a) a.set(x, y, z, yaw, pitch, flags);
    }
    update(dt, camPos) { for (const a of this.map.values()) a.update(dt, camPos); }
    get size() { return this.map.size; }
    /** True if the unit block at (bx, by, bz) would overlap a remote player's body. */
    intersectsBlock(bx, by, bz) {
      for (const a of this.map.values()) {
        if (!a.hasState) continue;
        if (bx < a.px + 0.32 && bx + 1 > a.px - 0.32 && by < a.py + 1.8 && by + 1 > a.py && bz < a.pz + 0.32 && bz + 1 > a.pz - 0.32) return true;
      }
      return false;
    }
    clear() { for (const id of Array.from(this.map.keys())) this.remove(id); }
  }

  OM.RemotePlayers = RemotePlayers;
})();
