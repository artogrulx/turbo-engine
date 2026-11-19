/* Open Meadow — engine/audio.js
 * Small synthesised sound layer (Web Audio, no sound files): footsteps and
 * block sounds per material, splashes, a breeze bed, birdsong by day and a
 * bee buzz that swells when bees fly near you. Started from a user gesture,
 * as browsers require. Every call is a safe no-op if audio is unavailable. */
(function () {
  'use strict';
  const OM = window.OM;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const MATERIAL = {
    grass: { type: 'lowpass', f: 900, q: 0.7, dur: 0.09, gain: 0.32 },
    gravel: { type: 'bandpass', f: 1300, q: 0.8, dur: 0.1, gain: 0.4 },
    sand: { type: 'highpass', f: 1800, q: 0.5, dur: 0.11, gain: 0.22 },
    stone: { type: 'bandpass', f: 2100, q: 1.4, dur: 0.06, gain: 0.42 },
    wood: { type: 'bandpass', f: 520, q: 1.6, dur: 0.08, gain: 0.5, tone: 170 },
    leaves: { type: 'highpass', f: 2600, q: 0.6, dur: 0.1, gain: 0.25 },
    glass: { type: 'highpass', f: 3200, q: 2, dur: 0.07, gain: 0.3, tone: 1900 },
    small: { type: 'lowpass', f: 1200, q: 0.6, dur: 0.35, gain: 0.35 }
  };

  class AudioFX {
    constructor() {
      this.ctx = null; this.master = null; this.noise = null;
      this.volume = 0.6; this.started = false; this.birdTimer = 3; this.muffle = null;
    }
    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.muffle = this.ctx.createBiquadFilter();
          this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
          this.master = this.ctx.createGain();
          this.master.gain.value = this.volume;
          this.muffle.connect(this.master);
          this.master.connect(this.ctx.destination);
          const len = this.ctx.sampleRate * 2;
          this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const d = this.noise.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (!this.started) this.startAmbient();
      } catch (e) { console.warn('[OpenMeadow] audio unavailable:', e); this.ctx = null; }
    }
    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
    out() { return this.muffle; }
    burst(m, scale) {
      const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = rnd(0.85, 1.15);
      const f = c.createBiquadFilter();
      f.type = m.type; f.frequency.value = m.f * rnd(0.85, 1.15); f.Q.value = m.q;
      const g = c.createGain();
      const dur = m.dur * scale, peak = m.gain * (scale > 1 ? 1.2 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.out());
      src.start(t, Math.random() * 1.5, dur + 0.05);
      if (m.tone) this.tone(m.tone * rnd(0.9, 1.1), dur * 0.8, 'triangle', m.gain * 0.35);
    }
    tone(freq, dur, type, gain, slide) {
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out());
      o.start(t); o.stop(t + dur + 0.05);
    }
    play(kind, material) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const m = MATERIAL[material] || MATERIAL.stone;
      try {
        if (kind === 'step') this.burst(m, 1);
        else if (kind === 'hit') this.burst(m, 0.6);
        else if (kind === 'break') { this.burst(m, 2.2); this.burst(m, 1.2); }
        else if (kind === 'place') { this.burst(MATERIAL.gravel, 0.8); this.burst(m, 1); }
        else if (kind === 'splash') { this.burst(MATERIAL.small, material === 'big' ? 2 : 1); this.burst({ type: 'highpass', f: 2500, q: 0.4, dur: 0.25, gain: 0.15 }, 1); }
        else if (kind === 'hurt') this.tone(240, 0.18, 'square', 0.12, 150);
        else if (kind === 'pop') this.tone(rnd(700, 900), 0.07, 'sine', 0.12, 1400);
      } catch (e) { /* ignore audio glitches */ }
    }
    startAmbient() {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      this.windGain = c.createGain(); this.windGain.gain.value = 0.045;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
      const lg = c.createGain(); lg.gain.value = 0.025;
      lfo.connect(lg); lg.connect(this.windGain.gain);
      src.connect(f); f.connect(this.windGain); this.windGain.connect(this.out());
      src.start(); lfo.start();
      const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 620; bf.Q.value = 1.3;
      this.buzzGain = c.createGain(); this.buzzGain.gain.value = 0;
      for (const fr of [188, 196]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
        const vib = c.createOscillator(); vib.frequency.value = rnd(5, 8);
        const vg = c.createGain(); vg.gain.value = 6;
        vib.connect(vg); vg.connect(o.frequency);
        o.connect(bf); o.start(); vib.start();
      }
      bf.connect(this.buzzGain); this.buzzGain.connect(this.out());
      this.started = true;
    }
    chirp() {
      const base = rnd(2300, 4200), notes = 2 + Math.floor(Math.random() * 4);
      const c = this.ctx;
      for (let i = 0; i < notes; i++) {
        const t = c.currentTime + i * rnd(0.09, 0.16);
        const o = c.createOscillator(), g = c.createGain();
        const f0 = base * rnd(0.85, 1.2);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * rnd(1.15, 1.6), t + 0.07);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.035, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g); g.connect(this.out());
        o.start(t); o.stop(t + 0.12);
      }
    }
    /** env: { daylight, underwater (0..1), beeDist, paused } */
    update(dt, env) {
      if (!this.ctx || !this.started || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(env.paused ? this.volume * 0.25 : this.volume, t, 0.2);
      this.muffle.frequency.setTargetAtTime(env.underwater > 0.5 ? 650 : 20000, t, 0.15);
      this.windGain.gain.setTargetAtTime(env.underwater > 0.5 ? 0.012 : 0.045, t, 0.3);
      const bd = env.beeDist;
      const buzz = bd < 6 ? Math.pow(1 - bd / 6, 2) * 0.05 : 0;
      this.buzzGain.gain.setTargetAtTime(env.paused ? 0 : buzz, t, 0.1);
      if (!env.paused && env.daylight > 0.3 && env.underwater < 0.5) {
        this.birdTimer -= dt;
        if (this.birdTimer <= 0) { this.birdTimer = rnd(2.5, 8); this.chirp(); }
      }
    }
  }

  OM.AudioFX = AudioFX;
})();
