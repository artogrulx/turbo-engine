/* Open Meadow — engine/player.js
 * First-person player: swept AABB collision against the voxel grid (resolved
 * one axis at a time, so you can never end up inside a block), walking,
 * sprinting, crouching with edge protection, optional auto-jump, swimming
 * with buoyancy / drag / currents, fall damage, breath and health.
 * Physics runs at a fixed 120 Hz; the camera is interpolated between steps. */
(function () {
  'use strict';
  const OM = window.OM;
  const G = 32, JUMP_V = 8.9, EPS = 1e-4;

  class Player {
    constructor(world) {
      this.world = world;
      this.pos = new THREE.Vector3();
      this.prev = new THREE.Vector3();
      this.vel = new THREE.Vector3();
      this.yaw = 0; this.pitch = 0;
      this.width = 0.6; this.height = 1.8; this.eye = 1.62;
      this.onGround = false; this.wasOnGround = false;
      this.submerged = 0; this.inWater = false; this.headUnder = false;
      this.sneaking = false; this.sprinting = false; this.collidedH = false; this.hitAxis = false;
      this.health = 20; this.maxHealth = 20; this.air = 15; this.maxAir = 15;
      this.fallStart = null; this.lastDamage = -100; this.regenTimer = 0; this.drownTimer = 0;
      this.bobPhase = 0; this.bobAmount = 0;
      this.autoJump = true; this.dead = false;
      this.onDamage = null; this.onDeath = null; this.onSplash = null; this.onStep = null; this.onLand = null;
      this.flow = [0, 0, 0];
      this.stepDist = 0; this.jumpCooldown = 0; this.time = 0;
    }

    spawnAt(x, y, z) {
      this.pos.set(x, y, z); this.prev.copy(this.pos); this.vel.set(0, 0, 0);
      this.fallStart = null; this.onGround = false; this.dead = false;
    }
    resetVitals() { this.health = this.maxHealth; this.air = this.maxAir; this.drownTimer = 0; this.regenTimer = 0; }

    look(dx, dy, sens, invert) {
      this.yaw -= dx * sens;
      this.pitch -= dy * sens * (invert ? -1 : 1);
      const lim = Math.PI / 2 - 0.01;
      if (this.pitch > lim) this.pitch = lim;
      if (this.pitch < -lim) this.pitch = -lim;
    }

    // ------------------------------------------------------------ collision
    sweep(axis, d) {
      this.hitAxis = false;
      if (d === 0) return 0;
      const W = this.world, p = this.pos, hw = this.width / 2;
      const min0 = p.x - hw, min1 = p.y, min2 = p.z - hw, max0 = p.x + hw, max1 = p.y + this.height, max2 = p.z + hw;
      const mins = [min0, min1, min2], maxs = [max0, max1, max2];
      const lo = mins[axis], hi = maxs[axis];
      if (d < 0) mins[axis] += d; else maxs[axis] += d;
      const x0 = Math.floor(mins[0] + EPS), x1 = Math.floor(maxs[0] - EPS);
      const y0 = Math.floor(mins[1] + EPS), y1 = Math.floor(maxs[1] - EPS);
      const z0 = Math.floor(mins[2] + EPS), z1 = Math.floor(maxs[2] - EPS);
      let res = d;
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (!W.isSolid(x, y, z)) continue;
        const b = axis === 0 ? x : axis === 1 ? y : z;
        if (d > 0) {
          const gap = b - hi;
          if (gap > -EPS && gap < res) res = Math.max(0, gap);
        } else {
          const gap = b + 1 - lo;
          if (gap < EPS && gap > res) res = Math.min(0, gap);
        }
      }
      if (res !== d) this.hitAxis = true;
      return res;
    }
    boxFree(x, y, z, h) {
      const W = this.world, hw = this.width / 2;
      for (let by = Math.floor(y + EPS); by <= Math.floor(y + h - EPS); by++)
        for (let bz = Math.floor(z - hw + EPS); bz <= Math.floor(z + hw - EPS); bz++)
          for (let bx = Math.floor(x - hw + EPS); bx <= Math.floor(x + hw - EPS); bx++)
            if (W.isSolid(bx, by, bz)) return false;
      return true;
    }
    groundBelow() {
      const p = this.pos, hw = this.width / 2, y = Math.floor(p.y - 0.06);
      for (let bz = Math.floor(p.z - hw + EPS); bz <= Math.floor(p.z + hw - EPS); bz++)
        for (let bx = Math.floor(p.x - hw + EPS); bx <= Math.floor(p.x + hw - EPS); bx++)
          if (this.world.isSolid(bx, y, bz)) return true;
      return false;
    }
    canStepUp(dx, dz) {
      const p = this.pos;
      return this.boxFree(p.x, p.y + 1.05, p.z, this.height) && this.boxFree(p.x + dx * 0.4, p.y + 1.05, p.z + dz * 0.4, this.height);
    }
    /** True if the unit block at (bx,by,bz) would overlap the player's body. */
    intersectsBlock(bx, by, bz) {
      const p = this.pos, hw = this.width / 2 - 0.001;
      return bx < p.x + hw && bx + 1 > p.x - hw && by < p.y + this.height - 0.001 && by + 1 > p.y + 0.001 && bz < p.z + hw && bz + 1 > p.z - hw;
    }
    blockBelow() {
      const b = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z));
      return b > 0 ? b : 0;
    }

    damage(amount, cause) {
      if (this.dead || amount <= 0) return;
      this.health -= amount;
      this.lastDamage = this.time;
      if (this.onDamage) this.onDamage(amount, cause);
      if (this.health <= 0) {
        this.health = 0; this.dead = true;
        if (this.onDeath) this.onDeath(cause);
      }
    }

    // --------------------------------------------------------------- physics
    step(dt, inp) {
      if (this.dead) return;
      this.time += dt;
      this.prev.copy(this.pos);
      const W = this.world, water = W.water, p = this.pos;

      // environment
      this.submerged = water ? water.submersion(p.x, p.y, p.z, this.height) : 0;
      const eyeY = p.y + this.eye;
      this.headUnder = water ? water.surfaceAt(Math.floor(p.x), Math.floor(eyeY), Math.floor(p.z)) > eyeY : false;
      const wasInWater = this.inWater;
      this.inWater = this.submerged > 0.02;
      if (this.inWater && !wasInWater && this.vel.y < -4 && this.onSplash) this.onSplash(-this.vel.y);

      // stance
      const wantSneak = inp.sneak && !this.inWater;
      if (wantSneak) { this.sneaking = true; this.height = 1.5; this.eye = 1.27; }
      else if (this.sneaking) {
        if (this.boxFree(p.x, p.y, p.z, 1.8)) { this.sneaking = false; this.height = 1.8; this.eye = 1.62; }
      }
      if (!inp.forward || inp.back || this.sneaking) this.sprinting = false;
      else if (inp.sprint) this.sprinting = true;

      // wish direction (yaw 0 looks toward -Z)
      let fx = 0, fz = 0;
      if (inp.forward) fz += 1;
      if (inp.back) fz -= 1;
      if (inp.right) fx += 1;
      if (inp.left) fx -= 1;
      const len = Math.hypot(fx, fz);
      if (len > 0) { fx /= len; fz /= len; }
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const wx = -s * fz + c * fx, wz = -c * fz - s * fx;

      if (this.inWater) {
        const speed = this.sprinting ? 3.9 : 2.5;
        const k = 1 - Math.exp(-4 * dt);
        this.vel.x += (wx * speed - this.vel.x) * k;
        this.vel.z += (wz * speed - this.vel.z) * k;
        let ay = -G + G * 1.06 * Math.min(1, this.submerged / 0.88);
        if (inp.jump) ay += 16;
        if (inp.sneak) ay -= 16;
        if (this.headUnder && fz > 0 && !inp.jump && !inp.sneak) ay += Math.sin(this.pitch) * 20;
        this.vel.y += ay * dt;
        this.vel.y *= Math.exp(-3.2 * dt);
        water.flowAt(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z), this.flow);
        this.vel.x += this.flow[0] * 5 * dt;
        this.vel.z += this.flow[1] * 5 * dt;
        if (this.flow[2]) this.vel.y -= 6 * dt;
        if (inp.jump && this.collidedH && this.submerged < 0.85) this.vel.y = Math.max(this.vel.y, 5.4);
        this.fallStart = null;
      } else {
        const speed = this.sneaking ? 1.35 : this.sprinting ? 5.7 : 4.3;
        const k = 1 - Math.exp(-(this.onGround ? 18 : 3.2) * dt);
        this.vel.x += (wx * speed - this.vel.x) * k;
        this.vel.z += (wz * speed - this.vel.z) * k;
        this.vel.y -= G * dt;
        if (this.vel.y < -56) this.vel.y = -56;
        this.jumpCooldown -= dt;
        if (inp.jump && this.onGround && this.jumpCooldown <= 0) {
          this.vel.y = JUMP_V; this.onGround = false; this.jumpCooldown = 0.12;
          if (this.sprinting) { this.vel.x += wx * 1.1; this.vel.z += wz * 1.1; }
        }
      }

      // ---- move: Y first, then X, then Z ----
      this.wasOnGround = this.onGround;
      const dy = this.vel.y * dt;
      const my = this.sweep(1, dy);
      p.y += my;
      if (this.hitAxis) { if (dy < 0) this.onGround = true; this.vel.y = 0; }
      else if (dy !== 0) this.onGround = false;

      this.collidedH = false;
      const ox = p.x, oz = p.z;
      const mx = this.sweep(0, this.vel.x * dt);
      if (this.hitAxis) { this.collidedH = true; this.vel.x = 0; }
      p.x += mx;
      if (this.sneaking && this.onGround && !this.groundBelow()) { p.x -= mx; this.vel.x = 0; }
      const mz = this.sweep(2, this.vel.z * dt);
      if (this.hitAxis) { this.collidedH = true; this.vel.z = 0; }
      p.z += mz;
      if (this.sneaking && this.onGround && !this.groundBelow()) { p.z -= mz; this.vel.z = 0; }

      if (this.autoJump && this.collidedH && this.onGround && !this.inWater && len > 0 && this.canStepUp(wx, wz)) {
        this.vel.y = JUMP_V; this.onGround = false;
      }

      // ---- falling & landing ----
      if (!this.onGround && !this.inWater) {
        if (this.vel.y > 0) this.fallStart = null;
        else if (this.fallStart === null) this.fallStart = p.y;
      }
      if (this.onGround && !this.wasOnGround) {
        let dist = 0;
        if (this.fallStart !== null) {
          dist = this.fallStart - p.y;
          if (dist > 3.4) this.damage(Math.floor(dist - 3), 'fall');
        }
        if (this.onLand) this.onLand(dist, this.blockBelow());
        this.fallStart = null;
      }

      // ---- breath, regeneration, void ----
      if (this.headUnder) {
        this.air -= dt;
        if (this.air <= 0) {
          this.air = 0; this.drownTimer += dt;
          if (this.drownTimer >= 1) { this.drownTimer = 0; this.damage(2, 'drown'); }
        }
      } else { this.air = Math.min(this.maxAir, this.air + dt * 4); this.drownTimer = 0; }
      if (this.health < this.maxHealth && this.time - this.lastDamage > 5) {
        this.regenTimer += dt;
        if (this.regenTimer > 2.5) { this.regenTimer = 0; this.health = Math.min(this.maxHealth, this.health + 1); }
      }
      if (p.y < -24) this.damage(1000, 'void');

      if (this.onGround && !this.inWater) {
        this.stepDist += Math.hypot(p.x - ox, p.z - oz);
        if (this.stepDist > 2.2) { this.stepDist = 0; if (this.onStep) this.onStep(this.blockBelow()); }
      }
    }

    /** Places the camera at the interpolated eye position with view bobbing. */
    updateCamera(camera, dt, alpha, opts) {
      const ix = this.prev.x + (this.pos.x - this.prev.x) * alpha;
      const iy = this.prev.y + (this.pos.y - this.prev.y) * alpha;
      const iz = this.prev.z + (this.pos.z - this.prev.z) * alpha;
      this.eyeSmooth = this.eyeSmooth === undefined ? this.eye : this.eyeSmooth + (this.eye - this.eyeSmooth) * Math.min(1, dt * 12);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const moving = this.onGround && hs > 0.5 && !this.inWater;
      this.bobAmount += ((moving && opts.bob ? Math.min(1, hs / 4.3) : 0) - this.bobAmount) * Math.min(1, dt * 8);
      this.bobPhase += hs * dt * 1.9;
      const by = Math.abs(Math.sin(this.bobPhase)) * 0.06 * this.bobAmount;
      const bx = Math.cos(this.bobPhase) * 0.035 * this.bobAmount;
      const swim = this.inWater && !this.headUnder ? Math.sin(this.time * 2.2) * 0.04 : 0;
      camera.position.set(ix + Math.cos(this.yaw) * bx, iy + this.eyeSmooth + by + swim, iz - Math.sin(this.yaw) * bx);
      camera.rotation.set(this.pitch, this.yaw, Math.cos(this.bobPhase) * 0.004 * this.bobAmount, 'YXZ');
      const target = opts.fov + (this.sprinting && hs > 3 ? 8 : 0) - (this.headUnder ? 6 : 0);
      if (Math.abs(camera.fov - target) > 0.05) {
        camera.fov += (target - camera.fov) * Math.min(1, dt * 8);
        camera.updateProjectionMatrix();
      }
    }
  }

  OM.Player = Player;
})();
