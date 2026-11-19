/* Open Meadow — engine/interaction.js
 * Everything the player does to the world with the mouse:
 *   - targeting (voxel ray cast, plants included) with an outline box
 *   - hold-to-mine with hardness-based timing and a crack overlay
 *   - block / flower / water placement with occupancy and body checks
 *   - break particles and the first-person held-item view with swing     */
(function () {
  'use strict';
  const OM = window.OM;
  const BL = OM.Blocks, I = OM.I;
  const REACH = 5.5, MAX_PARTICLES = 140;
  const rnd = (a, b) => a + Math.random() * (b - a);

  class Interaction {
    constructor(o) {
      this.world = o.world; this.player = o.player; this.inventory = o.inventory;
      this.scene = o.scene; this.camera = o.camera; this.textures = o.textures;
      this.audio = o.audio || null; this.toast = o.toast || (() => {});
      this.dir = new THREE.Vector3();
      this.target = null;
      this.mining = false; this.progress = 0; this.mx = 0; this.my = 0; this.mz = 0;
      this.cooldown = 0; this.placeRepeat = 0;
      this.swingT = 1; this.swingLoop = false;
      this.heldId = -1;

      // outline
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.55, depthWrite: false }));
      this.outline.visible = false;
      this.outline.renderOrder = 3;
      this.scene.add(this.outline);

      // crack overlay
      this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), new THREE.MeshBasicMaterial({
        map: this.textures.cracks, transparent: true, depthWrite: false, opacity: 0.9,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      }));
      this.crack.visible = false;
      this.crack.renderOrder = 2;
      this.scene.add(this.crack);

      // particles
      this.particles = [];
      for (let i = 0; i < MAX_PARTICLES; i++) this.particles.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.1, color: new THREE.Color() });
      this.pIdx = 0;
      this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PARTICLES);
      this.pMesh.frustumCulled = false;
      this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < MAX_PARTICLES; i++) this.pMesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.scene.add(this.pMesh);
      this.dummy = new THREE.Object3D();
      this.updateParticles(0);

      // held item view
      this.handScene = new THREE.Scene();
      this.handCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
      this.handAmbient = new THREE.AmbientLight(0xffffff, 0.55);
      this.handSun = new THREE.DirectionalLight(0xffffff, 0.75);
      this.handSun.position.set(-0.6, 1, 0.8);
      this.handScene.add(this.handAmbient, this.handSun);
      this.handPivot = new THREE.Group();
      this.handScene.add(this.handPivot);
      this.handMesh = null;
      this.blockHandMat = new THREE.MeshLambertMaterial({ map: this.textures.block.texture, alphaTest: 0.5 });
      this.iconTex = {};

      this.world.onPlantRemoved = (code, x, y, z, cause) => {
        const d = OM.Plants.defs[code & 255];
        if (cause === 'player' || cause === 'support') {
          const item = OM.Items.plantItem(code & 255);
          if (item) this.give(item, 1);
          if (d) this.burst(x + 0.5, y + 0.3, z + 0.5, d.flower ? d.color : [80, 140, 50], 6, 0.6);
        }
      };
    }

    give(itemId, n) {
      const left = this.inventory.add(itemId, n);
      if (left > 0) this.toast('Inventory full — item lost');
    }

    swing(loop) { if (this.swingT >= 1 || !loop) this.swingT = 0; this.swingLoop = !!loop; }

    resetMining() { this.mining = false; this.progress = 0; this.crack.visible = false; }

    update(dt, input, active) {
      const W = this.world, cam = this.camera;
      cam.getWorldDirection(this.dir);
      const stack = this.inventory.selectedItem();
      const item = stack ? OM.Items.get(stack.id) : null;
      const hit = active ? W.raycast(cam.position.x, cam.position.y, cam.position.z, this.dir.x, this.dir.y, this.dir.z, REACH,
        { plants: true, water: !!(item && item.kind === 'bucket') }) : null;
      this.target = hit;

      if (hit && hit.kind !== 'water') {
        this.outline.visible = true;
        if (hit.kind === 'plant') {
          const b = hit.box;
          this.outline.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
          this.outline.scale.set(b[3] - b[0] + 0.01, b[4] - b[1] + 0.01, b[5] - b[2] + 0.01);
        } else {
          this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
          this.outline.scale.set(1.004, 1.004, 1.004);
        }
      } else this.outline.visible = false;

      this.cooldown -= dt;
      this.placeRepeat -= dt;
      if (active && input.mouseLeft && hit && hit.kind !== 'water') {
        if (hit.kind === 'plant') {
          if (this.cooldown <= 0) {
            W.removePlant(hit.x, hit.y, hit.z, 'player');
            this.cooldown = 0.2;
            this.swing(false);
            if (this.audio) this.audio.play('break', 'grass');
          }
          this.resetMining();
        } else if (this.cooldown <= 0) {
          const hard = BL.HARD[hit.block];
          if (this.mining && this.mx === hit.x && this.my === hit.y && this.mz === hit.z) this.progress += dt / hard;
          else { this.mining = true; this.mx = hit.x; this.my = hit.y; this.mz = hit.z; this.progress = dt / hard; }
          this.swing(true);
          if (this.audio && Math.random() < dt * 5) this.audio.play('hit', BL.defs[hit.block].sound);
          if (this.progress >= 1) {
            this.breakBlock(hit);
            this.resetMining();
            this.cooldown = 0.14;
          }
        }
      } else {
        this.mining = false; this.progress = 0; this.swingLoop = false;
      }

      if (this.mining && this.progress > 0 && isFinite(this.progress)) {
        this.crack.visible = true;
        this.crack.position.set(this.mx + 0.5, this.my + 0.5, this.mz + 0.5);
        this.textures.cracks.offset.x = Math.min(9, Math.floor(this.progress * 10)) / 10;
      } else this.crack.visible = false;

      if (active && (input.rightPressed || (input.mouseRight && this.placeRepeat <= 0))) {
        this.place(hit, item, stack);
        this.placeRepeat = input.rightPressed ? 0.3 : 0.2;
      }
      if (active && input.middlePressed && hit && hit.kind === 'block') this.inventory.pick(hit.block);

      this.updateParticles(dt);
      this.updateHeld(dt);
    }

    breakBlock(hit) {
      const def = BL.defs[hit.block];
      if (!this.world.setBlock(hit.x, hit.y, hit.z, 0)) return;
      if (def.drop) this.give(def.drop, 1);
      this.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, def.color, 16, 1);
      if (this.audio) this.audio.play('break', def.sound);
    }

    place(hit, item, stack) {
      if (!item) return;
      const W = this.world;
      if (item.kind === 'bucket') {
        if (hit && hit.kind === 'water' && W.setWater(hit.x, hit.y, hit.z, 0)) {
          if (stack.count > 1) { this.inventory.consumeSelected(1); this.give(I.WATER_BUCKET, 1); }
          else this.inventory.setSelected(I.WATER_BUCKET, 1);
          this.swing(false);
          if (this.audio) this.audio.play('splash', 'small');
        }
        return;
      }
      if (!hit || hit.kind === 'water') return;
      let tx, ty, tz;
      if (hit.kind === 'plant' && item.kind !== 'plant') { tx = hit.x; ty = hit.y; tz = hit.z; }
      else {
        if (!hit.nx && !hit.ny && !hit.nz) return;
        tx = hit.x + hit.nx; ty = hit.y + hit.ny; tz = hit.z + hit.nz;
      }
      if (ty < 1 || ty >= OM.CONST.CY - 1) return;
      if (W.getBlock(tx, ty, tz) !== 0) return; // occupied (or not loaded)
      if (item.kind === 'block') {
        if (this.player.intersectsBlock(tx, ty, tz)) return;
        if (W.setBlock(tx, ty, tz, item.block)) {
          this.inventory.consumeSelected(1);
          this.swing(false);
          if (this.audio) this.audio.play('place', BL.defs[item.block].sound);
        }
      } else if (item.kind === 'plant') {
        if (W.addPlant(tx, ty, tz, item.plant | (((Math.random() * 255) | 0) << 8))) {
          this.inventory.consumeSelected(1);
          this.swing(false);
          if (this.audio) this.audio.play('place', 'grass');
        }
      } else if (item.kind === 'water_bucket') {
        if (W.setWater(tx, ty, tz, OM.Water.SOURCE | OM.Water.FULL)) {
          this.inventory.setSelected(I.BUCKET, 1);
          this.swing(false);
          if (this.audio) this.audio.play('splash', 'small');
        }
      }
    }

    // ------------------------------------------------------------ particles
    burst(x, y, z, color, n, spread) {
      const s = spread || 1;
      for (let k = 0; k < n; k++) {
        const p = this.particles[this.pIdx++ % MAX_PARTICLES];
        p.life = rnd(0.55, 1.1);
        p.pos.set(x + rnd(-0.35, 0.35) * s, y + rnd(-0.35, 0.35) * s, z + rnd(-0.35, 0.35) * s);
        p.vel.set(rnd(-2.2, 2.2), rnd(1, 4.2), rnd(-2.2, 2.2));
        const t = rnd(0.75, 1.1) / 255;
        p.color.setRGB(color[0] * t, color[1] * t, color[2] * t);
        p.size = rnd(0.07, 0.14);
      }
    }
    updateParticles(dt) {
      const W = this.world, d = this.dummy;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = this.particles[i];
        if (p.life > 0) {
          p.life -= dt;
          p.vel.y -= 18 * dt;
          const nx = p.pos.x + p.vel.x * dt, ny = p.pos.y + p.vel.y * dt, nz = p.pos.z + p.vel.z * dt;
          if (W.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { p.vel.multiplyScalar(0.3); p.vel.y = 0; }
          else p.pos.set(nx, ny, nz);
          this.pMesh.setColorAt(i, p.color);
        }
        d.position.copy(p.pos);
        d.rotation.set(p.life * 3, p.life * 5, 0);
        d.scale.setScalar(p.life > 0 ? p.size * Math.min(1, p.life * 4) : 0);
        d.updateMatrix();
        this.pMesh.setMatrixAt(i, d.matrix);
      }
      this.pMesh.instanceMatrix.needsUpdate = true;
      if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
    }

    // ------------------------------------------------------------ held item
    rebuildHeld(id) {
      if (this.handMesh) { this.handPivot.remove(this.handMesh); this.handMesh.geometry.dispose(); this.handMesh = null; }
      const item = OM.Items.get(id);
      if (!item) return;
      if (item.kind === 'block') {
        const g = new THREE.BoxGeometry(1, 1, 1);
        const uv = g.attributes.uv, T = this.textures.block.uv;
        for (let f = 0; f < 6; f++) {
          const tile = BL.TILE[item.block * 6 + f];
          const u0 = T[tile * 4], v0 = T[tile * 4 + 1], u1 = T[tile * 4 + 2], v1 = T[tile * 4 + 3];
          for (let k = 0; k < 4; k++) {
            const i = f * 4 + k;
            uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v1 + (v0 - v1) * uv.getY(i));
          }
        }
        uv.needsUpdate = true;
        this.handMesh = new THREE.Mesh(g, this.blockHandMat);
        this.handMesh.scale.setScalar(0.4);
        this.handMesh.rotation.set(0.1, -0.75, 0);
      } else {
        let tex = this.iconTex[id];
        if (!tex) {
          tex = this.iconTex[id] = new THREE.TextureLoader().load(item.icon);
          tex.magFilter = THREE.NearestFilter;
        }
        const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
        this.handMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
        this.handMesh.scale.setScalar(0.62);
        this.handMesh.rotation.set(0, -0.45, 0.15);
      }
      this.handPivot.add(this.handMesh);
    }
    updateHeld(dt) {
      const stack = this.inventory.selectedItem();
      const id = stack ? stack.id : 0;
      if (id !== this.heldId) { this.heldId = id; this.rebuildHeld(id); this.swingT = 0.5; }
      if (this.swingT < 1) {
        this.swingT += dt * 3.6;
        if (this.swingT >= 1) this.swingT = this.swingLoop ? 0 : 1;
      }
      const s = Math.sin(Math.min(1, this.swingT) * Math.PI);
      const p = this.player;
      const bob = p.bobAmount || 0;
      this.handPivot.position.set(0.62 + Math.cos(p.bobPhase) * 0.03 * bob - s * 0.12, -0.6 - Math.abs(Math.sin(p.bobPhase)) * 0.04 * bob + s * 0.1, -1.05 - s * 0.18);
      this.handPivot.rotation.set(-s * 0.9, s * 0.3, 0);
    }
    setHandLight(daylight, color) {
      this.handAmbient.intensity = 0.25 + 0.4 * daylight;
      this.handSun.intensity = 0.2 + 0.65 * daylight;
      this.handSun.color.copy(color);
    }
    setAspect(a) { this.handCamera.aspect = a; this.handCamera.updateProjectionMatrix(); }
  }

  OM.Interaction = Interaction;
})();
