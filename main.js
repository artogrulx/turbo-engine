/* Open Meadow — main.js
 * Boot sequence, the single game state machine, input routing, pointer lock,
 * HUD, settings, saving and the main loop.
 *
 * Start-up / pointer-lock design (the cause of the old "Start Game does
 * nothing" bug was competing start handlers and pointer-lock listeners):
 *   - exactly ONE state variable (G.state): loading → menu → playing ⇄ paused,
 *     playing ⇄ inventory, playing → dead
 *   - exactly ONE pointerlockchange listener; it only ever moves
 *     playing → paused (when the browser releases the mouse)
 *   - Start / Resume switch to "playing" immediately and THEN request the lock
 *     inside the same click handler (the browser requires a user gesture).
 *     If the browser refuses (Chrome's re-lock cooldown after Esc, iframes,
 *     unsupported Linux options...), the game keeps running and asks for one
 *     more click on the view, instead of silently staying on the menu.
 *   - hidden screens use display:none so they can neither swallow clicks
 *     nor be re-triggered by Space/Enter through keyboard focus.          */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});
  const $ = (id) => document.getElementById(id);
  const STEP = 1 / 120;
  const SAVE_KEY = 'openmeadow.save.v1', SETTINGS_KEY = 'openmeadow.settings.v1', SEED_KEY = 'openmeadow.newseed';
  const DEFAULTS = {
    renderDistance: 6, shadows: 'high', vegetation: 'high', sensitivity: 1, fov: 75,
    invertY: false, autoJump: true, viewBob: true, dayCycle: true, volume: 0.6, resolution: 1, fancyLeaves: true
  };
  const NO_INPUT = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
  const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyE', 'Slash', 'Quote', 'Backquote', 'Enter']);

  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  const G = {
    state: 'boot', settings: null, renderer: null, scene: null, camera: null, textures: null, materials: null,
    world: null, water: null, sky: null, nature: null, wildlife: null, player: null, inventory: null, interaction: null, audio: null,
    seed: 0, save: null, spawn: null, startPos: null, started: false, ready: false,
    time: 0, acc: 0, lastT: 0, underwater: 0, lockFailures: 0, lastUnlock: 0, lockHintTimer: 0,
    debug: false, frames: 0, fpsTime: 0, fps: 0, hudTimer: 0, saveTimer: 0, confirmNew: false, pixelScale: 1,
    fog: { near: 50, far: 100, color: null },
    input: { keys: new Set(), mouseLeft: false, mouseRight: false, leftPressed: false, rightPressed: false, middlePressed: false, sprintTap: 0, sprintLatch: false }
  };
  OM.game = G; // handy for debugging from the console

  // ---------------------------------------------------------------- helpers
  function show(id, on) { const el = $(id); if (el) el.classList.toggle('hidden', !on); }
  function toast(msg, ms) {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, ms || 2200);
  }
  function setLoading(p, text) {
    const bar = $('loading-bar');
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    if (text) { const t = $('loading-text'); if (t) t.textContent = text; }
  }
  function fatal(title, err) {
    console.error('[OpenMeadow]', title, err);
    show('loading-screen', false);
    show('menu-screen', false);
    const box = $('error-screen');
    if (box) {
      $('error-title').textContent = title;
      $('error-text').textContent = err ? String(err && err.stack ? err.stack : err) : '';
      box.classList.remove('hidden');
    }
  }
  let lastErrorToast = 0;
  function reportError(err) {
    console.error('[OpenMeadow] runtime error:', err);
    const now = performance.now();
    if (now - lastErrorToast > 4000) { lastErrorToast = now; toast(`Error: ${err && err.message ? err.message : err}`, 4000); }
  }

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(store.get(SETTINGS_KEY) || '{}') || {}; } catch (e) { s = {}; }
    return Object.assign({}, DEFAULTS, s);
  }
  function saveSettings() { store.set(SETTINGS_KEY, JSON.stringify(G.settings)); }
  function loadSave() {
    try {
      const raw = store.get(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && d.version === 1 && typeof d.seed === 'number' ? d : null;
    } catch (e) { console.warn('[OpenMeadow] save could not be read, starting fresh', e); return null; }
  }
  const plantDistanceFor = (s) => Math.min(s.renderDistance, { low: 2, medium: 3, high: 4 }[s.vegetation] || 4);

  // ------------------------------------------------------------------ boot
  function boot() {
    window.addEventListener('error', (e) => { if (G.state !== 'boot') reportError(e.error || e.message); });
    window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
    if (!window.THREE) {
      fatal('Three.js could not be loaded', 'The 3D library is fetched from a CDN (jsDelivr / unpkg). Check your internet connection and reload the page.');
      return;
    }
    const missing = ['Noise', 'Blocks', 'Textures', 'TerrainGen', 'Mesher', 'World', 'Water', 'Sky', 'Nature', 'Wildlife', 'Player', 'Interaction', 'AudioFX', 'Inventory']
      .filter((k) => !OM[k]);
    if (missing.length) { fatal('Some game files did not load', `Missing modules: ${missing.join(', ')}. Make sure the engine/ folder sits next to index.html.`); return; }
    G.settings = loadSettings();
    try { initRenderer(); } catch (e) { fatal('WebGL is not available', e); return; }
    setLoading(0.03, 'Painting textures…');
    setTimeout(() => {
      try { initGame(); } catch (e) { fatal('The game failed to start', e); }
    }, 30);
  }

  function initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.autoClear = false;
    renderer.info.autoReset = false; // count both render passes (world + held item) in the F3 stats
    renderer.shadowMap.enabled = G.settings.shadows !== 'off';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.id = 'game-canvas';
    $('canvas-host').appendChild(renderer.domElement);
    G.renderer = renderer;
    G.scene = new THREE.Scene();
    G.camera = new THREE.PerspectiveCamera(G.settings.fov, window.innerWidth / window.innerHeight, 0.05, 1500);
    G.camera.rotation.order = 'YXZ';
    applyResolution();
  }

  function createMaterials() {
    const common = { uTime: { value: 0 }, uCaustics: { value: 1 } };
    const make = (cutout) => {
      const m = new THREE.MeshLambertMaterial({ map: G.textures.block.texture, vertexColors: true, alphaTest: cutout ? 0.5 : 0 });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = common.uTime;
        shader.uniforms.uCaustics = common.uCaustics;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aWet;\nuniform float uTime;\nvarying float vWet;\nvarying vec3 vOmWorld;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec4 omWp = modelMatrix * vec4(transformed, 1.0);
            float omSway = step(0.4, aWet) * (1.0 - step(0.75, aWet));
            transformed.x += sin(uTime * 1.7 + omWp.x * 0.6 + omWp.y * 0.4) * 0.035 * omSway;
            transformed.z += cos(uTime * 1.3 + omWp.z * 0.5 + omWp.y * 0.3) * 0.03 * omSway;
            vWet = step(0.75, aWet);
            vOmWorld = omWp.xyz;`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCaustics;\nvarying float vWet;\nvarying vec3 vOmWorld;')
          .replace('#include <fog_fragment>', `if (vWet > 0.5) {
              vec2 cp = vOmWorld.xz * 0.9 + vOmWorld.y * 0.3;
              float c1 = sin(cp.x * 2.1 + uTime * 1.3) * sin(cp.y * 2.3 - uTime * 1.1);
              float c2 = sin((cp.x + cp.y) * 1.7 - uTime * 1.6) * sin((cp.x - cp.y) * 1.9 + uTime * 0.9);
              float caust = pow(clamp(abs(c1 + c2) * 0.6, 0.0, 1.0), 3.0);
              gl_FragColor.rgb = gl_FragColor.rgb * vec3(0.8, 0.93, 0.96) + caust * 0.2 * uCaustics;
            }
            #include <fog_fragment>`);
      };
      m.customProgramCacheKey = () => (cutout ? 'om-terrain-cutout-v1' : 'om-terrain-v1');
      return m;
    };
    return { opaque: make(false), cutout: make(true), water: null, common };
  }

  function initGame() {
    G.textures = OM.Textures.build(G.renderer);
    setLoading(0.08, 'Shaping the land…');
    const save = loadSave();
    let seed;
    if (save) seed = save.seed;
    else {
      const pending = Number(store.get(SEED_KEY));
      seed = Number.isFinite(pending) && pending ? pending : (Math.random() * 2147483646 + 1) | 0;
      store.remove(SEED_KEY);
    }
    G.save = save; G.seed = seed;
    G.fog.color = new THREE.Color();

    G.materials = createMaterials();
    G.world = new OM.World({
      seed, scene: G.scene, textures: G.textures, materials: G.materials,
      renderDistance: G.settings.renderDistance, plantDistance: plantDistanceFor(G.settings)
    });
    G.water = new OM.Water(G.world);
    G.world.water = G.water;
    G.materials.water = G.water.createMaterial(G.textures);
    G.sky = new OM.Sky(G.scene, { time: save && typeof save.time === 'number' ? save.time : 0.29 });
    G.nature = new OM.Nature(G.world, G.scene, G.textures);
    G.world.nature = G.nature;
    G.wildlife = new OM.Wildlife(G.world, G.scene, G.textures);
    G.player = new OM.Player(G.world);
    G.inventory = new OM.Inventory({
      hotbar: $('hotbar'), itemName: $('item-name'), screen: $('inventory-screen'), main: $('inv-main'), bar: $('inv-hotbar'),
      trash: $('inv-trash'), sortBtn: $('inv-sort'), tooltip: $('inv-tooltip'), cursor: $('cursor-stack')
    });
    G.audio = new OM.AudioFX();
    G.interaction = new OM.Interaction({
      world: G.world, player: G.player, inventory: G.inventory, scene: G.scene, camera: G.camera,
      textures: G.textures, audio: G.audio, toast
    });
    hookPlayer();

    if (save) {
      try { G.world.deserialize(save.world || {}); } catch (e) { console.warn('[OpenMeadow] world edits could not be restored', e); }
      if (!G.inventory.deserialize(save.inventory)) G.inventory.starterKit();
    } else G.inventory.starterKit();

    G.spawn = G.world.gen.findSpawn();
    const sp = save && save.player;
    G.startPos = sp && isFinite(sp.x) && isFinite(sp.y) && isFinite(sp.z) ? { x: sp.x, y: sp.y, z: sp.z, exact: true } : { x: G.spawn.x, y: G.spawn.y, z: G.spawn.z };
    G.player.yaw = sp && isFinite(sp.yaw) ? sp.yaw : Math.random() * Math.PI * 2;
    G.player.pitch = sp && isFinite(sp.pitch) ? sp.pitch : -0.12;
    if (sp && isFinite(sp.health)) G.player.health = Math.max(1, Math.min(20, sp.health));

    setupInput();
    setupUI();
    applySettings(true);
    window.addEventListener('resize', onResize);
    onResize();
    setState('loading');
    setLoading(0.12, 'Growing the meadow…');
    requestAnimationFrame(loop);
  }

  function hookPlayer() {
    const P = G.player;
    P.onDamage = (amount, cause) => {
      const o = $('damage-overlay');
      o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash');
      G.audio.play('hurt');
      if (cause === 'drown') toast('You are running out of air!', 1200);
    };
    P.onDeath = (cause) => {
      const msg = { fall: 'You fell from a great height.', drown: 'You ran out of air.', void: 'You fell out of the world.' }[cause] || 'You blacked out.';
      $('death-reason').textContent = msg;
      if (cause === 'void') { respawn(); toast('You fell out of the world — back to the meadow.'); return; }
      setState('dead');
      if (isLocked()) document.exitPointerLock();
    };
    P.onSplash = (v) => G.audio.play('splash', v > 12 ? 'big' : 'small');
    P.onStep = (b) => { if (b) G.audio.play('step', OM.Blocks.defs[b].sound); };
    P.onLand = (dist, b) => { if (dist > 1.2 && b) G.audio.play('step', OM.Blocks.defs[b].sound); };
  }

  // ------------------------------------------------------- player placement
  function safeY(x, y, z) {
    const W = G.world, bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.max(1, Math.floor(y)); yy < OM.CONST.CY - 2; yy++) {
      if (W.isSolid(bx, yy, bz) || W.isSolid(bx, yy + 1, bz)) continue;
      const below = W.getBlock(bx, yy - 1, bz);
      if (below > 0 && OM.Blocks.SOLID[below] && W.getWater(bx, yy, bz) <= 0) return yy;
    }
    return W.topY(bx, bz) + 1;
  }
  function placePlayer(pos) {
    const P = G.player;
    if (pos.exact) {
      P.spawnAt(pos.x, pos.y, pos.z);
      if (!P.boxFree(pos.x, pos.y, pos.z, P.height)) P.spawnAt(pos.x, safeY(pos.x, pos.y, pos.z), pos.z);
    } else P.spawnAt(pos.x, safeY(pos.x, pos.y, pos.z), pos.z);
  }
  function respawn() {
    G.player.resetVitals();
    G.interaction.resetMining();
    placePlayer({ x: G.spawn.x, y: G.spawn.y, z: G.spawn.z });
    G.player.yaw = Math.random() * Math.PI * 2;
    G.player.pitch = -0.1;
  }

  // -------------------------------------------------------- state machine
  function setState(s) {
    G.state = s;
    show('loading-screen', s === 'loading');
    show('menu-screen', s === 'menu');
    show('pause-screen', s === 'paused');
    show('death-screen', s === 'dead');
    show('hud', s === 'playing' || s === 'inventory');
    if (s !== 'menu' && s !== 'paused') { show('settings-screen', false); show('controls-screen', false); }
    document.body.classList.toggle('in-game', s === 'playing');
    if (s !== 'playing') { clearInput(); setLockHint(false); }
    if (s !== 'inventory' && G.inventory && G.inventory.isOpen) G.inventory.close();
    if (G.interaction && s !== 'playing') G.interaction.resetMining();
    if (s === 'menu') $('btn-start').textContent = G.started || G.save ? 'Continue' : 'Start Game';
    if (s === 'paused' && G.started) saveGame(true);
  }
  function clearInput() {
    const i = G.input;
    i.keys.clear(); i.mouseLeft = i.mouseRight = false; i.leftPressed = i.rightPressed = i.middlePressed = false; i.sprintLatch = false;
  }

  // --------------------------------------------------------- pointer lock
  function canvas() { return G.renderer.domElement; }
  function isLocked() { return document.pointerLockElement === canvas(); }
  function lockSupported() { return typeof canvas().requestPointerLock === 'function'; }
  function fallbackMode() { return !lockSupported() || G.lockFailures >= 3; }
  /** Must be called from inside a click/keydown handler. */
  function requestLock() {
    if (isLocked()) return;
    if (!lockSupported()) { setLockHint(true); return; }
    G.lockAttempt = (G.lockAttempt || 0) + 1;
    try {
      const p = canvas().requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(lockFailed);
    } catch (err) { lockFailed(err); }
    clearTimeout(G.lockHintTimer);
    G.lockHintTimer = setTimeout(() => { if (G.state === 'playing' && !isLocked()) setLockHint(true); }, 1200);
  }
  function lockFailed(err) {
    // Chrome reports one refusal twice (rejected promise + pointerlockerror): count it once
    if (G.failedAttempt === G.lockAttempt) return;
    G.failedAttempt = G.lockAttempt;
    G.lockFailures++;
    console.warn(`[OpenMeadow] The browser refused mouse capture (${(err && (err.name || err.message)) || 'unknown reason'}).`);
    if (G.state === 'playing') setLockHint(true);
  }
  function setLockHint(on) {
    const el = $('lock-hint');
    if (!el) return;
    if (on) {
      $('lock-hint-text').textContent = fallbackMode()
        ? 'Mouse capture is blocked here. Look around with the arrow keys — mining and building still work. Press Enter to try capturing again.'
        : 'Click the view to capture the mouse';
      el.classList.toggle('fallback', fallbackMode());
    }
    el.classList.toggle('hidden', !on);
  }
  function onLockChange() {
    const locked = isLocked();
    if (locked) { G.lockFailures = 0; setLockHint(false); return; }
    if (G.state === 'playing') { G.lastUnlock = performance.now(); setState('paused'); }
  }

  function startOrContinue() {
    if (!G.ready) return;
    G.audio.unlock();
    if (!G.started) { G.started = true; placePlayer(G.startPos); showHint(); }
    setState('playing');
    requestLock();
  }
  function resume() { G.audio.unlock(); setState('playing'); requestLock(); }
  function openInventory() {
    setState('inventory');
    G.inventory.open();
    if (isLocked()) document.exitPointerLock();
  }
  function closeInventory(backToGame) {
    G.inventory.close();
    if (backToGame) { setState('playing'); requestLock(); } else setState('paused');
  }
  function showHint() {
    const h = $('hint');
    if (!h) return;
    h.classList.add('show');
    setTimeout(() => h.classList.remove('show'), 9000);
  }

  // ---------------------------------------------------------------- input
  function moveInput() {
    const k = G.input.keys;
    return {
      forward: k.has('KeyW'), back: k.has('KeyS'), left: k.has('KeyA'), right: k.has('KeyD'),
      jump: k.has('Space'), sneak: k.has('KeyC'),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || G.input.sprintLatch
    };
  }
  function setupInput() {
    const cv = canvas();
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', () => lockFailed(new Error('pointerlockerror')));

    cv.addEventListener('mousedown', (e) => {
      if (G.state !== 'playing') return;
      e.preventDefault();
      if (!isLocked() && !fallbackMode()) { requestLock(); return; }
      const i = G.input;
      if (e.button === 0) { i.mouseLeft = true; i.leftPressed = true; }
      else if (e.button === 2) { i.mouseRight = true; i.rightPressed = true; }
      else if (e.button === 1) i.middlePressed = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) G.input.mouseLeft = false;
      else if (e.button === 2) G.input.mouseRight = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (G.state !== 'playing' || !isLocked()) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (Math.abs(dx) > 500 || Math.abs(dy) > 500) return; // ignore the jump some browsers report right after locking
      G.player.look(dx, dy, 0.0022 * G.settings.sensitivity, G.settings.invertY);
    });
    window.addEventListener('wheel', (e) => {
      if (G.state !== 'playing') return;
      e.preventDefault();
      if (e.deltaY) G.inventory.scroll(e.deltaY);
    }, { passive: false });
    window.addEventListener('contextmenu', (e) => { if (G.state === 'playing' || G.state === 'inventory') e.preventDefault(); });

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'F3') { e.preventDefault(); G.debug = !G.debug; show('debug', G.debug); return; }
      const st = G.state;
      if (st === 'playing') {
        if (GAME_KEYS.has(e.code) || e.code.startsWith('Digit')) e.preventDefault();
        if (e.code === 'KeyW' && !e.repeat) {
          const now = performance.now();
          if (now - G.input.sprintTap < 280) G.input.sprintLatch = true;
          G.input.sprintTap = now;
        }
        G.input.keys.add(e.code);
        if (e.code.startsWith('Digit')) {
          const n = Number(e.code.slice(5)) - 1;
          if (n >= 0 && n < 9) G.inventory.select(n);
        } else if (e.code === 'KeyE' && !e.repeat) openInventory();
        else if (e.code === 'Enter' && !isLocked()) { G.lockFailures = 0; requestLock(); }
        else if (e.code === 'Escape' && !isLocked() && performance.now() - G.lastUnlock > 400) setState('paused');
      } else if (st === 'inventory') {
        if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); closeInventory(true); }
        else if (e.code === 'Escape') { e.preventDefault(); closeInventory(false); }
        else if (e.code.startsWith('Digit')) G.inventory.swapWithHotbar(Number(e.code.slice(5)) - 1);
      }
    });
    window.addEventListener('keyup', (e) => {
      G.input.keys.delete(e.code);
      if (e.code === 'KeyW') G.input.sprintLatch = false;
    });
    window.addEventListener('blur', () => { clearInput(); if (G.state === 'playing') setState('paused'); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (G.state === 'playing') setState('paused'); if (G.started) saveGame(true); }
    });
    window.addEventListener('beforeunload', () => { if (G.started) saveGame(true); });
  }

  // ------------------------------------------------------------------ UI
  function bindClick(id, fn) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); el.blur(); fn(e); });
  }
  function openSub(id, from) {
    G.subFrom = from;
    show(from, false);
    show(id, true);
  }
  function closeSub(id) {
    show(id, false);
    show(G.subFrom || 'menu-screen', true);
  }
  function setupUI() {
    bindClick('btn-start', startOrContinue);
    bindClick('btn-new', () => {
      if ((G.save || G.started) && !G.confirmNew) {
        G.confirmNew = true;
        $('btn-new').textContent = 'Click again to replace your world';
        setTimeout(() => { G.confirmNew = false; $('btn-new').textContent = 'New World'; }, 3500);
        return;
      }
      store.remove(SAVE_KEY);
      store.set(SEED_KEY, String((Math.random() * 2147483646 + 1) | 0));
      G.started = false; // stops the unload handler from re-saving the old world
      window.location.reload();
    });
    bindClick('btn-settings', () => openSub('settings-screen', 'menu-screen'));
    bindClick('btn-controls', () => openSub('controls-screen', 'menu-screen'));
    bindClick('btn-resume', resume);
    bindClick('btn-pause-settings', () => openSub('settings-screen', 'pause-screen'));
    bindClick('btn-pause-controls', () => openSub('controls-screen', 'pause-screen'));
    bindClick('btn-save', () => saveGame(false));
    bindClick('btn-quit', () => { saveGame(true); setState('menu'); });
    bindClick('btn-settings-back', () => closeSub('settings-screen'));
    bindClick('btn-controls-back', () => closeSub('controls-screen'));
    bindClick('btn-respawn', () => { respawn(); resume(); });
    bindClick('inv-close', () => closeInventory(false));
    bindClick('lock-hint-btn', () => { G.lockFailures = 0; requestLock(); });

    // settings form
    const s = G.settings;
    const bindRange = (id, key, fmt, cast) => {
      const el = $(id), out = $(`${id}-val`);
      el.value = s[key];
      if (out) out.textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        s[key] = cast ? cast(el.value) : Number(el.value);
        if (out) out.textContent = fmt(s[key]);
        applySettings(false); saveSettings();
      });
    };
    const bindSelect = (id, key, cast) => {
      const el = $(id);
      el.value = String(s[key]);
      el.addEventListener('change', () => { s[key] = cast ? cast(el.value) : el.value; applySettings(false); saveSettings(); });
    };
    const bindCheck = (id, key) => {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => { s[key] = el.checked; applySettings(false); saveSettings(); });
    };
    bindRange('set-render', 'renderDistance', (v) => `${v} chunks`);
    bindRange('set-sensitivity', 'sensitivity', (v) => `${Number(v).toFixed(2)}×`);
    bindRange('set-fov', 'fov', (v) => `${v}°`);
    bindRange('set-volume', 'volume', (v) => `${Math.round(v * 100)}%`);
    bindSelect('set-shadows', 'shadows');
    bindSelect('set-vegetation', 'vegetation');
    bindSelect('set-resolution', 'resolution', Number);
    bindCheck('set-invert', 'invertY');
    bindCheck('set-autojump', 'autoJump');
    bindCheck('set-bob', 'viewBob');
    bindCheck('set-daycycle', 'dayCycle');
    bindCheck('set-leaves', 'fancyLeaves');
    $('seed-label').textContent = String(G.seed);
  }

  function applySettings(initial) {
    const s = G.settings;
    const pd = plantDistanceFor(s);
    G.world.setRenderDistance(s.renderDistance, pd);
    G.nature.setDistance(pd);
    const dens = { low: 0.35, medium: 0.65, high: 1 }[s.vegetation] || 1;
    if (G.nature.density !== dens) G.nature.setDensity(dens);
    const shadowsOn = s.shadows !== 'off';
    if (initial || G.sky.shadowQuality !== s.shadows) {
      G.sky.setShadowQuality(s.shadows);
      if (G.renderer.shadowMap.enabled !== shadowsOn) {
        G.renderer.shadowMap.enabled = shadowsOn;
        G.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      }
    }
    if (G.world.fancyLeaves !== s.fancyLeaves) {
      G.world.fancyLeaves = s.fancyLeaves;
      for (const c of G.world.chunks.values()) if (c.meshed) G.world.urgent.add(c);
    }
    G.player.autoJump = s.autoJump;
    G.sky.cycle = s.dayCycle;
    G.audio.setVolume(s.volume);
    if (!initial) applyResolution();
  }
  function applyResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    G.renderer.setPixelRatio(dpr * (G.settings.resolution || 1));
    onResize();
  }
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    G.renderer.setSize(w, h);
    G.camera.aspect = w / h;
    G.camera.updateProjectionMatrix();
    if (G.interaction) G.interaction.setAspect(w / h);
    G.pixelScale = (h / 900) * G.renderer.getPixelRatio();
  }

  // ---------------------------------------------------------------- saving
  function saveGame(silent) {
    if (!G.started) return false;
    const P = G.player;
    const data = {
      version: 1, seed: G.seed, time: G.sky.time, savedAt: Date.now(),
      player: { x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, pitch: P.pitch, health: P.health },
      inventory: G.inventory.serialize(), world: G.world.serialize()
    };
    const ok = store.set(SAVE_KEY, JSON.stringify(data));
    if (ok) G.save = data;
    if (!silent) toast(ok ? 'World saved' : 'Could not save — browser storage is unavailable or full');
    return ok;
  }

  // ------------------------------------------------------------------ HUD
  function updateHUD() {
    const P = G.player;
    const hearts = $('hearts').children;
    for (let i = 0; i < hearts.length; i++) {
      const v = P.health - i * 2;
      hearts[i].className = v >= 2 ? 'heart full' : v === 1 ? 'heart half' : 'heart empty';
    }
    const bubbles = $('bubbles');
    const showAir = P.headUnder || P.air < P.maxAir - 0.05;
    bubbles.classList.toggle('hidden', !showAir);
    if (showAir) {
      const n = Math.ceil((P.air / P.maxAir) * 10);
      const b = bubbles.children;
      for (let i = 0; i < b.length; i++) b[i].className = i < n ? 'bubble' : 'bubble empty';
    }
    if (G.debug) {
      const W = G.world, c = G.camera.position;
      const wl = G.wildlife.activeCount();
      const info = G.renderer.info.render;
      let visible = 0;
      for (const ch of W.chunks.values()) if (ch.meshed && ch.visible) visible++;
      $('debug').textContent =
        `Open Meadow  ·  ${G.fps} fps\n` +
        `XYZ ${P.pos.x.toFixed(1)} / ${P.pos.y.toFixed(1)} / ${P.pos.z.toFixed(1)}   chunk ${Math.floor(P.pos.x) >> 4}, ${Math.floor(P.pos.z) >> 4}\n` +
        `Biome ${W.gen.biomeAt(Math.floor(c.x), Math.floor(c.z))}   time ${G.sky.timeString()}\n` +
        `Chunks ${W.chunks.size} loaded, ${visible} visible   water ${G.water.lastUpdates}/tick (${G.water.pending.size} queued)\n` +
        `Wildlife ${wl.butterflies} butterflies, ${wl.bees} bees   flowers nearby ${G.wildlife.flowers.length}\n` +
        `Draw calls ${info.calls}   triangles ${(info.triangles / 1000).toFixed(0)}k\n` +
        `${P.onGround ? 'on ground' : 'airborne'}${P.inWater ? '  in water ' + (P.submerged * 100).toFixed(0) + '%' : ''}${P.headUnder ? '  submerged' : ''}\n` +
        `Seed ${G.seed}`;
    }
  }

  // ------------------------------------------------------------- main loop
  function loop(nowMs) {
    requestAnimationFrame(loop);
    const t = nowMs / 1000;
    let dt = G.lastT ? t - G.lastT : 1 / 60;
    G.lastT = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    try { frame(dt); } catch (err) { reportError(err); }
    const i = G.input;
    i.leftPressed = i.rightPressed = i.middlePressed = false;
  }

  function loadingStep() {
    const p = G.startPos;
    G.world.update(p.x, p.z, 30);
    const r = G.world.readiness(p.x, p.z, 3);
    setLoading(0.12 + 0.88 * (r.ready / r.total), r.ready < r.total ? `Growing the meadow… ${r.ready}/${r.total}` : 'Ready');
    if (r.ready >= r.total) {
      G.ready = true;
      setState('menu');
      $('menu-status').textContent = G.save ? 'Your meadow is waiting where you left it.' : 'A fresh meadow has been generated for you.';
    }
  }

  let UNDERWATER_FOG = null, tmpColor = null; // created lazily: THREE may be missing at load time
  function applyFog() {
    if (!UNDERWATER_FOG) { UNDERWATER_FOG = new THREE.Color(0.06, 0.26, 0.32); tmpColor = new THREE.Color(); }
    const far = Math.max(40, G.world.renderDistance * 16 - 6), near = far * 0.5;
    const u = G.underwater;
    const fog = G.scene.fog;
    fog.near = near + (0.5 - near) * u;
    fog.far = far + (22 - far) * u;
    tmpColor.copy(UNDERWATER_FOG).multiplyScalar(0.35 + 0.65 * G.sky.daylight);
    fog.color.copy(G.sky.fogColor).lerp(tmpColor, u);
    G.renderer.setClearColor(fog.color);
    G.sky.material.uniforms.uFogColor.value.copy(fog.color);
    G.fog.near = fog.near; G.fog.far = fog.far; G.fog.color.copy(fog.color);
  }

  function nearestBeeDistance() {
    let best = 99;
    const p = G.camera.position;
    for (const b of G.wildlife.bees.list) if (b.active) { const d = b.pos.distanceTo(p); if (d < best) best = d; }
    return best;
  }

  function frame(dt) {
    const st = G.state;
    if (st === 'loading') { loadingStep(); return; }
    if (st === 'boot') return;
    const P = G.player, cam = G.camera;
    const simulate = st === 'playing' || st === 'inventory';
    G.time += dt;

    if (simulate) {
      const k = G.input.keys, turn = 2.2 * dt;
      if (st === 'playing') {
        if (k.has('ArrowLeft')) P.yaw += turn;
        if (k.has('ArrowRight')) P.yaw -= turn;
        if (k.has('ArrowUp')) P.look(0, -turn / 0.0022, 0.0022, false);
        if (k.has('ArrowDown')) P.look(0, turn / 0.0022, 0.0022, false);
      }
      if (G.world.isAreaReady(P.pos.x, P.pos.z)) {
        G.acc += dt;
        const inp = st === 'playing' ? moveInput() : NO_INPUT;
        let n = 0;
        while (G.acc >= STEP && n < 12) { P.step(STEP, inp); G.acc -= STEP; n++; }
        if (n >= 12) G.acc = 0;
      } else { G.acc = 0; P.prev.copy(P.pos); }
      P.updateCamera(cam, dt, G.acc / STEP, { fov: G.settings.fov, bob: G.settings.viewBob });
    } else if (st === 'menu' && !G.started) {
      // title screen: slow orbit around the place the player will appear
      const a = G.time * 0.045, s = G.startPos;
      const cx = s.x + Math.cos(a) * 18, cz = s.z + Math.sin(a) * 18;
      const ground = G.world.topY(Math.floor(cx), Math.floor(cz));
      const cy = Math.max(s.y + 8.5, ground + 4);
      G.menuCamY = G.menuCamY === undefined ? cy : G.menuCamY + (cy - G.menuCamY) * Math.min(1, dt * 2);
      cam.position.set(cx, G.menuCamY, cz);
      cam.lookAt(s.x, s.y + 1.5, s.z);
    }

    const center = st === 'menu' && !G.started ? G.startPos : P.pos;
    if (!G.centerVec) G.centerVec = new THREE.Vector3();
    G.centerVec.set(center.x, center.y, center.z);
    G.world.update(center.x, center.z, st === 'menu' ? 10 : 6);
    if (simulate || st === 'menu') {
      G.water.update(dt);
      if (simulate) G.world.randomTick(P.pos.x, P.pos.z, dt);
    }

    const s = G.water.surfaceAt(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z));
    const under = s > cam.position.y + 0.02 ? 1 : 0;
    G.underwater += (under - G.underwater) * Math.min(1, dt * 7);
    if (Math.abs(G.underwater - under) < 0.01) G.underwater = under;

    const live = simulate || st === 'menu';
    G.sky.update(live ? dt : 0, cam.position, G.underwater);
    applyFog();
    G.materials.common.uTime.value = G.time;
    G.nature.update(G.time, cam.position, G.sky.daylight, G.underwater, G.pixelScale);
    if (live) G.wildlife.update(dt, G.centerVec, G.sky.daylight, G.fog.color, G.fog.near, G.fog.far);
    G.water.updateUniforms(G.time, G.sky, G.fog.near, G.fog.far, G.fog.color);
    G.interaction.setHandLight(G.sky.daylight, G.sky.sun.color);
    if (simulate) G.interaction.update(dt, G.input, st === 'playing');
    G.audio.update(dt, { daylight: G.sky.daylight, underwater: G.underwater, beeDist: nearestBeeDistance(), paused: !live });

    $('underwater-overlay').style.opacity = (G.underwater * 0.85).toFixed(3);

    G.frames++; G.fpsTime += dt;
    if (G.fpsTime >= 0.5) { G.fps = Math.round(G.frames / G.fpsTime); G.frames = 0; G.fpsTime = 0; }
    G.hudTimer -= dt;
    if (simulate && G.hudTimer <= 0) { G.hudTimer = 0.1; updateHUD(); }
    if (st === 'playing') {
      G.saveTimer += dt;
      if (G.saveTimer > 60) { G.saveTimer = 0; saveGame(true); }
    }

    const r = G.renderer;
    r.info.reset();
    r.clear();
    r.render(G.scene, cam);
    if (simulate && G.interaction.handMesh) {
      r.clearDepth();
      r.render(G.interaction.handScene, G.interaction.handCamera);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
