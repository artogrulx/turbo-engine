/* Open Meadow — engine/mpui.js
 * The multiplayer interface: the Join dialog (server, room, name, colour, download links),
 * the chat box, the online badge and the Tab player list. Purely DOM; main.js owns the game
 * state and passes in the callbacks:
 *   onJoin(cfg)  onLeave()  onBack()  onChatSend(text)  onChatClose()                      */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});
  const $ = (id) => document.getElementById(id);
  const MAX_LINES = 60;
  let api = null, selColor = '', probeSeq = 0, probeTimer = 0;

  function setStatus(text, kind) {
    const el = $('mp-status');
    el.textContent = text;
    el.className = 'muted mp-status' + (kind ? ' ' + kind : '');
  }
  function selectColor(c) {
    selColor = c;
    for (const b of $('mp-colors').children) b.classList.toggle('selected', b.dataset.color === c);
  }
  function setLinks(base, dl) {
    for (const [id, key, fallback] of [['mp-dl-html', 'html', '/download/open-meadow.html'], ['mp-dl-zip', 'zip', '/download/open-meadow.zip']]) {
      const a = $(id);
      a.classList.toggle('disabled', !base);
      a.setAttribute('aria-disabled', base ? 'false' : 'true');
      if (base) a.href = base + ((dl && dl[key]) || fallback); else a.removeAttribute('href');
    }
  }
  function fillRooms(list) {
    const dl = $('mp-rooms');
    dl.textContent = '';
    for (const r of list || []) { const o = document.createElement('option'); o.value = r.name; o.label = r.players + ' online'; dl.appendChild(o); }
  }

  /** Checks the address in the Server field and shows whether an Open Meadow server answers there. */
  function probe() {
    clearTimeout(probeTimer);
    const raw = $('mp-server').value.trim();
    const srv = OM.Net.normalizeServer(raw);
    const seq = ++probeSeq;
    setLinks(null);
    if (!srv) { setStatus(raw ? 'That does not look like a server address.' : 'Enter the address of an Open Meadow server, for example my-game.onrender.com', ''); return; }
    setStatus('Checking ' + srv.host + '…', '');
    OM.Net.probe(srv.http, 7000).then((info) => {
      if (seq !== probeSeq) return;
      if (!info) { setStatus('No Open Meadow server answered at ' + srv.host + '. Servers on Render\'s free plan need about a minute to wake up — try again.', 'bad'); return; }
      const nRooms = typeof info.roomCount === 'number' ? info.roomCount : info.rooms.length;
      setStatus('● Online — ' + info.players + ' player' + (info.players === 1 ? '' : 's') + ' in ' + nRooms + ' room' + (nRooms === 1 ? '' : 's') + ' (up to ' + info.maxPlayers + ' per room)', 'ok');
      fillRooms(info.rooms);
      setLinks(srv.http, info.downloads);
    });
  }

  function doJoin() {
    const raw = $('mp-server').value.trim();
    const srv = OM.Net.normalizeServer(raw);
    if (!srv) { setStatus('Enter the server address first.', 'bad'); $('mp-server').focus(); return; }
    if (window.location.protocol === 'https:' && !srv.secure && !OM.Net.isLocalHost(srv.host)) {
      setStatus('This page uses https, so it can only join secure servers (https:// or wss://).', 'bad'); return;
    }
    api.onJoin({
      server: raw, room: OM.Net.cleanRoom($('mp-room').value),
      name: OM.Net.cleanName($('mp-name').value) || OM.Net.randomName(), color: selColor || OM.Net.COLORS[0]
    });
  }

  // ------------------------------------------------------------------ chat
  function chatAdd(m) {
    const log = $('chat-log');
    const line = document.createElement('div');
    line.className = 'chat-line' + (m.sys ? ' sys' : '');
    if (!m.sys) {
      const who = document.createElement('span');
      who.className = 'chat-who';
      who.style.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#fff';
      who.textContent = m.name + ' ';
      line.appendChild(who);
    }
    const txt = document.createElement('span');
    txt.textContent = m.text;     // textContent only: chat can never inject HTML
    line.appendChild(txt);
    log.appendChild(line);
    while (log.children.length > MAX_LINES) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function chatOpen() {
    $('chat').classList.add('open');
    $('chat-form').classList.remove('hidden');
    const i = $('chat-input');
    i.value = '';
    i.focus();
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  }
  function chatClose() {
    $('chat').classList.remove('open');
    $('chat-form').classList.add('hidden');
    $('chat-input').blur();
  }

  OM.MpUI = {
    setup(a) {
      api = a;
      const box = $('mp-colors');
      for (const c of OM.Net.COLORS) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'swatch'; b.dataset.color = c; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
        b.addEventListener('click', () => selectColor(c));
        box.appendChild(b);
      }
      $('mp-join').addEventListener('click', (e) => { e.preventDefault(); doJoin(); });
      $('mp-back').addEventListener('click', (e) => { e.preventDefault(); api.onBack(); });
      $('mp-leave').addEventListener('click', (e) => { e.preventDefault(); api.onLeave(); });
      for (const id of ['mp-server', 'mp-room', 'mp-name']) {
        $(id).addEventListener('keydown', (e) => { if (e.code === 'Enter') { e.preventDefault(); doJoin(); } else if (e.code === 'Escape') { e.preventDefault(); api.onBack(); } });
      }
      $('mp-server').addEventListener('input', () => { clearTimeout(probeTimer); probeTimer = setTimeout(probe, 700); });
      $('mp-server').addEventListener('change', probe);
      for (const id of ['mp-dl-html', 'mp-dl-zip']) $(id).addEventListener('click', (e) => { if ($(id).classList.contains('disabled')) e.preventDefault(); });
      $('chat-form').addEventListener('submit', (e) => e.preventDefault());
      $('chat-input').addEventListener('keydown', (e) => {
        if (e.code === 'Enter') { e.preventDefault(); const t = $('chat-input').value.trim(); if (t) api.onChatSend(t); api.onChatClose(false); }
        else if (e.code === 'Escape') { e.preventDefault(); api.onChatClose(true); }
        e.stopPropagation();
      });
    },

    /** Fills the dialog. `conn` = { host, room } while connected. */
    fill(cfg, conn) {
      $('mp-server').value = cfg.server || '';
      $('mp-room').value = cfg.room || 'meadow';
      $('mp-name').value = cfg.name || '';
      selectColor(cfg.color);
      $('mp-connected').classList.toggle('hidden', !conn);
      if (conn) $('mp-connected-text').textContent = 'You are connected to ' + conn.host + ' — room "' + conn.room + '".';
      $('mp-join').textContent = conn ? 'Switch room / server' : 'Join';
      if (!cfg.server && /^https?:$/.test(window.location.protocol)) {
        // opened from a web server? if it is an Open Meadow server (e.g. on Render) offer it as the default
        OM.Net.probe(window.location.origin, 2500).then((info) => {
          if (info && !$('mp-server').value.trim()) { $('mp-server').value = window.location.origin; probe(); }
        });
      }
      probe();
    },

    chatAdd, chatOpen, chatClose,
    setEnabled(on) { $('chat').classList.toggle('hidden', !on); },
    setBadge(kind, text) {
      const el = $('net-badge');
      el.classList.toggle('hidden', !kind);
      el.classList.toggle('bad', kind === 'bad');
      $('net-badge-text').textContent = text || '';
    },
    setPlayers(list, selfId) {
      const el = $('players-list');
      el.textContent = '';
      const title = document.createElement('div');
      title.className = 'pl-title';
      title.textContent = 'Players online (' + list.length + ')';
      el.appendChild(title);
      for (const p of list) {
        const row = document.createElement('div');
        row.className = 'pl-row';
        const dot = document.createElement('i');
        dot.style.background = p.color;
        const name = document.createElement('span');
        name.textContent = p.name + (p.id === selfId ? ' (you)' : '');
        row.append(dot, name);
        el.appendChild(row);
      }
    },
    showPlayers(on) { $('players-list').classList.toggle('hidden', !on); }
  };
})();
