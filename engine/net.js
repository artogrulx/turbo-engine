/* Open Meadow — engine/net.js
 * Multiplayer client: saved connection settings, server-address handling, the WebSocket
 * protocol (see render/README.md) and the shared day clock.
 *
 * Joining a room is a page-level decision: the server owns the world seed and the list of
 * edits, so main.js connects BEFORE it builds the world (see connectThenStart there) and a
 * multiplayer session never touches the single-player save.                              */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});
  const CONFIG_KEY = 'openmeadow.mp.v1';
  const PROTOCOL = 1;
  const COLORS = ['#e0443c', '#f08a24', '#f2cf2e', '#6cc24a', '#2ea7a0', '#3d7be0', '#8b5cd6', '#e0669f'];
  const ADJ = ['Brave', 'Calm', 'Clever', 'Gentle', 'Happy', 'Jolly', 'Lucky', 'Merry', 'Quiet', 'Sunny', 'Swift', 'Wild'];
  const NOUN = ['Bee', 'Fox', 'Otter', 'Heron', 'Finch', 'Willow', 'Poppy', 'Badger', 'Hare', 'Wren', 'Moth', 'Newt'];
  const rnd = (n) => Math.floor(Math.random() * n);
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };

  const randomName = () => ADJ[rnd(ADJ.length)] + NOUN[rnd(NOUN.length)];
  const cleanRoom = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 24) || 'meadow';
  // eslint-disable-next-line no-control-regex
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);

  function loadConfig() {
    let c = {};
    try { c = JSON.parse(store.get(CONFIG_KEY) || '{}') || {}; } catch (e) { c = {}; }
    const cfg = {
      server: typeof c.server === 'string' ? c.server : '',
      room: cleanRoom(c.room),
      name: cleanName(c.name) || randomName(),
      color: COLORS.includes(c.color) ? c.color : COLORS[rnd(COLORS.length)],
      auto: !!c.auto
    };
    try { // ?server=...&room=... in the address bar pre-fills the dialog (it never joins by itself)
      const q = new URLSearchParams(window.location.search);
      if (q.get('server')) { cfg.server = q.get('server'); cfg.fromUrl = true; }
      if (q.get('room')) { cfg.room = cleanRoom(q.get('room')); cfg.fromUrl = true; }
    } catch (e) { /* old browser: ignore */ }
    return cfg;
  }
  function saveConfig(cfg) {
    store.set(CONFIG_KEY, JSON.stringify({ server: cfg.server, room: cfg.room, name: cfg.name, color: cfg.color, auto: !!cfg.auto }));
  }

  function isLocalHost(s) {
    const h = String(s).replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].replace(/:\d+$/, '').toLowerCase();
    return h === 'localhost' || h === '[::1]' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
  }
  /** "my-game.onrender.com", "https://my-game.onrender.com/", "wss://host/ws", "localhost:8080" -> { http, ws, host, secure } */
  function normalizeServer(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (isLocalHost(s) ? 'http://' : 'https://') + s;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) || !u.hostname) return null;
    const secure = u.protocol === 'https:' || u.protocol === 'wss:';
    return { http: (secure ? 'https://' : 'http://') + u.host, ws: (secure ? 'wss://' : 'ws://') + u.host + '/ws', host: u.host, secure };
  }
  /** Asks a server for /api/info. Resolves to the info object, or null if nothing (or something else) answers. */
  async function probe(httpBase, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, timeoutMs || 4000);
    try {
      const r = await fetch(httpBase + '/api/info', { signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
      if (!r.ok) return null;
      const info = await r.json();
      return info && info.name === 'Open Meadow' && Array.isArray(info.rooms) ? info : null;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

  class Net {
    constructor(cfg) {
      this.cfg = cfg;
      this.server = normalizeServer(cfg.server);
      this.ws = null; this.connected = false;
      this.id = 0; this.room = ''; this.seed = 0; this.maxPlayers = 0; this.motd = '';
      this.players = new Map();            // id -> { id, name, color }
      this.dayT0 = 0; this.dayLength = 1440; this.clockOffset = 0;
      this.rtt = 0; this.pingTimer = 0; this.sendT = 0; this.last = null;
      // callbacks (assigned by main.js)
      this.onJoin = this.onLeave = this.onState = this.onBlock = this.onWater = this.onPlant = this.onChat = this.onSys = this.onClose = null;
    }

    /** Opens the socket, joins the room and downloads the world's edits. Resolves with the welcome message
     *  (plus `edits: { b, w, p }`) once the server says it is ready. */
    connect(timeoutMs) {
      return new Promise((resolve, reject) => {
        if (!this.server) { reject(new Error('Enter a server address first.')); return; }
        if (window.location.protocol === 'https:' && !this.server.secure && !isLocalHost(this.server.host)) {
          reject(new Error('This page uses https, so browsers only allow secure servers (https:// / wss://).')); return;
        }
        let ws;
        try { ws = new WebSocket(this.server.ws); } catch (e) { reject(new Error('Invalid server address.')); return; }
        this.ws = ws;
        const edits = { b: [], w: [], p: [] };
        let welcome = null, settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          try { ws.close(); } catch (e) { /* already closed */ }
          reject(err);
        };
        const timer = setTimeout(() => fail(new Error('The server did not answer in time. Servers on Render\'s free plan can take about a minute to wake up — try again shortly.')), timeoutMs || 20000);
        ws.onopen = () => ws.send(JSON.stringify({ t: 'join', v: PROTOCOL, room: this.cfg.room, name: this.cfg.name, color: this.cfg.color }));
        ws.onerror = () => fail(new Error('Could not reach ' + this.server.host + '. Check the address and that the server is running.'));
        ws.onclose = (e) => {
          if (!settled) fail(new Error('The server closed the connection' + (e && e.reason ? ': ' + e.reason : '.')));
          else this._closed(e);
        };
        ws.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (settled) { this._message(m); return; }
          if (m.t === 'welcome') welcome = m;
          else if (m.t === 'edits' && edits[m.k]) { for (let i = 0; i < m.a.length; i++) edits[m.k].push(m.a[i]); }
          else if (m.t === 'error') fail(new Error(m.msg || 'The server refused the connection.'));
          else if (m.t === 'ready' && welcome) {
            settled = true; clearTimeout(timer);
            this._adopt(welcome);
            resolve(Object.assign({}, welcome, { edits }));
          }
        };
      });
    }

    _adopt(w) {
      this.connected = true;
      this.id = w.id; this.room = w.room; this.seed = w.seed; this.maxPlayers = w.maxPlayers || 0; this.motd = w.motd || '';
      this.dayT0 = w.dayT0; this.dayLength = w.dayLength || 1440;
      this.clockOffset = (w.now || Date.now()) - Date.now();
      for (const p of w.players || []) this.players.set(p.id, p);
      this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now(), rtt: this.rtt }), 3000);
    }

    _message(m) {
      switch (m.t) {
        case 's': if (this.onState) for (const r of m.p) this.onState(r[0], r[1], r[2], r[3], r[4], r[5], r[6]); break;
        case 'block': if (this.onBlock) this.onBlock(m.x, m.y, m.z, m.v); break;
        case 'water': if (this.onWater) this.onWater(m.x, m.y, m.z, m.v); break;
        case 'plant': if (this.onPlant) this.onPlant(m.x, m.y, m.z, m.v); break;
        case 'join': this.players.set(m.p.id, m.p); if (this.onJoin) this.onJoin(m.p); break;
        case 'leave': this.players.delete(m.id); if (this.onLeave) this.onLeave(m.id); break;
        case 'chat': if (this.onChat) this.onChat(m); break;
        case 'sys': if (this.onSys) this.onSys(m.text); break;
        case 'pong': this.rtt = Math.max(0, Date.now() - m.ts); break;
        default: break;
      }
    }

    _closed(e) {
      const was = this.connected;
      this.connected = false;
      clearInterval(this.pingTimer);
      if (was && this.onClose) this.onClose(e);
    }

    send(obj) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    sendBlock(x, y, z, v) { return this.send({ t: 'block', x, y, z, v }); }
    sendWater(x, y, z, v) { return this.send({ t: 'water', x, y, z, v }); }
    sendPlant(x, y, z, v) { return this.send({ t: 'plant', x, y, z, v }); }
    sendChat(text) { return this.send({ t: 'chat', text }); }

    /** Shared time of day (0..1), identical for everyone in the room. */
    dayTime() {
      const t = ((Date.now() + this.clockOffset - this.dayT0) / 1000 / this.dayLength) % 1;
      return t < 0 ? t + 1 : t;
    }

    /** Called every frame: sends this player's state at most 10 times a second, and only when it changed. */
    update(dt, P) {
      if (!this.connected) return;
      this.sendT -= dt;
      if (this.sendT > 0) return;
      const f = (P.sneaking ? 1 : 0) | (P.sprinting ? 2 : 0) | (P.inWater ? 4 : 0) | (P.onGround ? 8 : 0) | (P.headUnder ? 16 : 0);
      const s = { x: r2(P.pos.x), y: r2(P.pos.y), z: r2(P.pos.z), yaw: r3(wrapAngle(P.yaw)), pitch: r3(P.pitch), f };
      const L = this.last;
      if (L && L.x === s.x && L.y === s.y && L.z === s.z && L.yaw === s.yaw && L.pitch === s.pitch && L.f === s.f) { this.sendT = 0.25; return; }
      this.sendT = 0.1;
      this.last = s;
      this.send({ t: 'pos', x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, f });
    }

    close() {
      clearInterval(this.pingTimer);
      this.connected = false;
      if (this.ws) { this.ws.onclose = null; try { this.ws.close(1000); } catch (e) { /* ignore */ } }
    }
  }

  Net.COLORS = COLORS;
  Net.loadConfig = loadConfig;
  Net.saveConfig = saveConfig;
  Net.normalizeServer = normalizeServer;
  Net.isLocalHost = isLocalHost;
  Net.probe = probe;
  Net.cleanRoom = cleanRoom;
  Net.cleanName = cleanName;
  Net.randomName = randomName;
  OM.Net = Net;
})();
