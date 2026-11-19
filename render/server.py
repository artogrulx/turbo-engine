#!/usr/bin/env python3
"""Open Meadow web service for Render (standard library only: no pip install needed).

  GET  /                                the game (uses the bundled Three.js, so no CDN is needed)
  GET  /download                        download page
  GET  /download/open-meadow.html       the single-file standalone game  (attachment)
  GET  /download/open-meadow.zip        the project as a ZIP             (attachment)
  GET  /open-meadow.html                the standalone game, opened in the browser
  GET  /api/info                        server status and rooms (JSON, CORS-enabled)
  GET  /health                          health check for Render
  WS   /ws                              multiplayer (see render/README.md for the protocol)

Run it:   python3 render/server.py           (PORT, HOST, DATA_DIR, MAX_PLAYERS ... are read from the environment)
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import html
import json
import os
import re
import signal
import sys
import threading
import time
import urllib.parse
from email.utils import formatdate
from http import HTTPStatus
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:      # also works under `python -I`, which leaves the script's folder off the import path
    sys.path.insert(0, str(HERE))

import packager  # noqa: E402
import rooms  # noqa: E402
import ws  # noqa: E402

VERSION = '1.0.0'
STATIC = {'/index.html': 'index.html', '/style.css': 'style.css', '/main.js': 'main.js', '/inventory.js': 'inventory.js'}
ENGINE_RE = re.compile(r'^/engine/([A-Za-z0-9_]+\.js)$')
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.zip': 'application/zip', '.json': 'application/json; charset=utf-8'}
HOST_RE = re.compile(r'^[A-Za-z0-9.\-]+(:\d{1,5})?$')


class Config:
    def __init__(self, env=None):
        e = os.environ if env is None else env
        self.host = e.get('HOST', '0.0.0.0')
        self.port = int(e.get('PORT', '8080'))
        self.data_dir = Path(e.get('DATA_DIR') or HERE / 'data')
        self.max_players = int(e.get('MAX_PLAYERS', '16'))
        self.max_rooms = int(e.get('MAX_ROOMS', '24'))
        self.max_edits = int(e.get('MAX_EDITS', '200000'))
        self.max_connections = int(e.get('MAX_CONNECTIONS', '300'))
        self.list_rooms = e.get('LIST_ROOMS', '1').strip().lower() not in ('0', 'false', 'no', 'off')
        self.seed_salt = int(e.get('SEED_SALT', '0'))
        self.motd = e.get('MOTD', '')
        self.allowed_origins = [o.strip().rstrip('/') for o in e.get('ALLOWED_ORIGINS', '').split(',') if o.strip()]
        self.public_url = (e.get('PUBLIC_URL') or e.get('RENDER_EXTERNAL_URL') or '').rstrip('/')
        self.autosave = float(e.get('AUTOSAVE_SECONDS', '20'))


class Blob:
    __slots__ = ('data', 'etag')

    def __init__(self, data):
        self.data = data
        self.etag = '"%s"' % hashlib.sha1(data).hexdigest()[:20]


class Artifacts:
    """The generated downloads, rebuilt automatically when a source file changes."""

    def __init__(self, root):
        self.root = root
        self._sig, self._checked = None, 0.0
        self._html, self._zip, self._index = {}, {}, None   # standalone and zip are cached per public address (it is baked into them)
        self._lock = threading.Lock()                       # the downloads are built in worker threads

    def _watched(self):
        r = self.root
        yield from (r / n for n in ('index.html', 'style.css', 'main.js', 'inventory.js', 'README.md', 'render.yaml', '.gitignore'))
        yield from sorted((r / 'engine').glob('*.js'))
        yield from (p for p in sorted(HERE.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and 'data' not in p.parts)

    def refresh(self):
        now = time.monotonic()
        if now - self._checked < 1.0:
            return
        self._checked = now
        sig = []
        for p in self._watched():
            try:
                st = p.stat()
                sig.append((str(p), st.st_mtime_ns, st.st_size))
            except OSError:
                pass
        sig = tuple(sig)
        with self._lock:
            if sig != self._sig:
                self._sig = sig
                self._html.clear()
                self._zip.clear()
                self._index = None

    def _per_base(self, cache, base, build):
        """At most 8 cached variants, one per public address (the address is baked into the files)."""
        with self._lock:
            blob = cache.get(base)
            if blob is None:
                try:
                    data = build(base)
                except ValueError as e:   # e.g. an index.html without the config line: serve it unconfigured rather than fail
                    print('[artifacts] could not bake in %r: %s' % (base, e), flush=True)
                    data = build(None)
                if len(cache) >= 8:
                    cache.pop(next(iter(cache)))
                blob = cache[base] = Blob(data)
            return blob

    def standalone(self, base=None):
        """The single-file game with `base` (this service's address) as its default multiplayer server."""
        self.refresh()
        return self._per_base(self._html, base, lambda b: packager.build_standalone(self.root, b).encode('utf-8'))

    def zip(self, base=None):
        self.refresh()
        return self._per_base(self._zip, base, lambda b: packager.build_zip(self.root, b))

    def index(self):
        self.refresh()
        with self._lock:
            if self._index is None:
                self._index = Blob(packager.build_offline_index(self.root).encode('utf-8'))
            return self._index


class Context:
    def __init__(self, cfg):
        self.cfg = cfg
        self.root = packager.find_root()
        self.hub = rooms.Hub(str(cfg.data_dir / 'worlds.json'), cfg.max_players, cfg.max_rooms, cfg.max_edits, cfg.seed_salt, cfg.motd)
        self.artifacts = Artifacts(self.root)
        self.sockets = set()
        self.started = time.time()
        self.gzip_cache = {}
        self.tasks = []
        self.port = cfg.port


class Request:
    __slots__ = ('method', 'path', 'query', 'headers', 'version')


# ------------------------------------------------------------------- HTTP
async def read_request(reader, first):
    try:
        raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), timeout=15 if first else 75)
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, asyncio.LimitOverrunError, ConnectionError, OSError):
        return None
    lines = raw.decode('latin-1').split('\r\n')
    parts = lines[0].split(' ')
    if len(parts) != 3 or not parts[2].startswith('HTTP/'):
        return None
    req = Request()
    req.method, target, req.version = parts
    split = urllib.parse.urlsplit(target)
    req.path = urllib.parse.unquote(split.path)
    req.query = urllib.parse.parse_qs(split.query)
    req.headers = {}
    for line in lines[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            k = k.strip().lower()
            req.headers[k] = (req.headers[k] + ', ' + v.strip()) if k in req.headers else v.strip()
    return req


def response_bytes(status, headers, body, head_only):
    phrase = HTTPStatus(status).phrase
    h = {'Server': 'open-meadow/' + VERSION, 'Date': formatdate(usegmt=True), 'X-Content-Type-Options': 'nosniff'}
    h.update(headers)
    if status not in (204, 304):
        h['Content-Length'] = str(len(body))
    head = 'HTTP/1.1 %d %s\r\n%s\r\n\r\n' % (status, phrase, '\r\n'.join('%s: %s' % kv for kv in h.items()))
    return head.encode('latin-1') + (b'' if head_only or status in (204, 304) else body)


async def send(ctx, req, writer, status=200, body=b'', ctype='text/plain; charset=utf-8', extra=None, keep=True, cache='no-cache', cors=False, etag=None):
    headers = {'Content-Type': ctype, 'Cache-Control': cache, 'Connection': 'keep-alive' if keep else 'close'}
    if cors:
        headers['Access-Control-Allow-Origin'] = '*'
    headers.update(extra or {})
    if status == 200 and body:
        etag = etag or '"%s"' % hashlib.sha1(body).hexdigest()[:20]
        headers['ETag'] = etag
        if req.headers.get('if-none-match') == etag:
            status, body = 304, b''
        elif len(body) > 1024 and 'gzip' in req.headers.get('accept-encoding', '') and (ctype.startswith('text/') or 'json' in ctype):
            gz = ctx.gzip_cache.get(etag)
            if gz is None:
                if len(ctx.gzip_cache) > 24:
                    ctx.gzip_cache.clear()
                gz = ctx.gzip_cache[etag] = gzip.compress(body, 6, mtime=0)
            body = gz
            headers['Content-Encoding'] = 'gzip'
            headers['Vary'] = 'Accept-Encoding'
    writer.write(response_bytes(status, headers, body, req.method == 'HEAD'))
    await writer.drain()
    return keep


def json_body(obj):
    return json.dumps(obj, separators=(',', ':')).encode('utf-8')


def public_base(ctx, req):
    if ctx.cfg.public_url:
        return ctx.cfg.public_url
    host = req.headers.get('host', '')
    if not HOST_RE.match(host):
        host = 'localhost:%d' % ctx.port
    proto = req.headers.get('x-forwarded-proto', 'http').split(',')[0].strip()
    return '%s://%s' % (proto if proto in ('http', 'https') else 'http', host)


def baked_base(ctx, req):
    """This service's address if it is safe to bake into the downloads, else None."""
    base = public_base(ctx, req)
    return base if packager.valid_server(base) else None


def landing_page(ctx, req):
    base = public_base(ctx, req)
    wsurl = ('wss' if base.startswith('https') else 'ws') + '://' + base.split('://', 1)[1] + '/ws'
    art = ctx.artifacts
    baked = baked_base(ctx, req)
    h_kb, z_kb = len(art.standalone(baked).data) / 1024, len(art.zip(baked).data) / 1024
    st = ctx.hub.stats()
    rooms_html = ''.join('<li><b>%s</b> &middot; %d online</li>' % (html.escape(r['name']), r['players']) for r in st['rooms'][:8]) or '<li>No active rooms yet &mdash; join one to create it.</li>'
    page = ('''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Meadow - download &amp; multiplayer</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font:16px/1.55 "Segoe UI",Ubuntu,system-ui,sans-serif;color:#f3f7ee;
background:radial-gradient(ellipse at 50% 120%,rgba(143,209,107,.35),transparent 60%),linear-gradient(180deg,#2f5f9e,#7fb0d8 48%,#a9c98e 72%,#3f7a30)}
main{width:min(640px,100%);padding:28px 30px;border-radius:22px;background:rgba(14,28,18,.82);border:1px solid rgba(214,240,196,.2);box-shadow:0 18px 50px rgba(0,0,0,.45)}
h1{margin:0 0 4px;font-size:40px;letter-spacing:-.02em}h1 span{color:#8fd16b}h2{margin:26px 0 8px;font-size:18px;color:#d9f7a6}
p{margin:6px 0;color:rgba(236,244,228,.8)}a.btn{display:inline-block;margin:6px 10px 6px 0;padding:12px 18px;border-radius:12px;font-weight:600;text-decoration:none;color:#0f2410;
background:linear-gradient(180deg,#b7ec8a,#8fd16b 45%,#4f9a3c)}a.btn.alt{color:#f3f7ee;background:rgba(255,255,255,.1);border:1px solid rgba(214,240,196,.4)}
a.btn small{font-weight:400;opacity:.75}code{padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.1);font:14px ui-monospace,Menlo,Consolas,monospace;word-break:break-all}
ul{margin:6px 0;padding-left:20px;color:rgba(236,244,228,.8)}
</style></head><body><main>
<h1>Open <span>Meadow</span></h1>
<p>A living voxel meadow with rivers, wildflowers, bees &mdash; and now friends.</p>
<p><a class="btn" href="/">Play now</a><a class="btn alt" href="/open-meadow.html">Play the standalone page</a></p>
<h2>Downloads</h2>
<p><a class="btn" href="/download/open-meadow.html" download>Standalone HTML <small>@H_KB@ KB</small></a>
<a class="btn" href="/download/open-meadow.zip" download>Project ZIP <small>@Z_KB@ KB</small></a></p>
<p>The HTML file is the whole game in one file &mdash; no install, works offline. The ZIP holds every source file, a local copy of Three.js and this multiplayer server.</p>
<h2>Multiplayer</h2>
<p>In the game choose <b>Multiplayer</b>, enter this server and a room name, and share the room name with friends. Everyone in a room shares one world.</p>
<p>Server address: <code>@BASE@</code> &nbsp; WebSocket: <code>@WSURL@</code></p>
<ul>@ROOMS@</ul>
<p style="font-size:13px;opacity:.7">v@VERSION@ &middot; up to @MAXP@ players per room &middot; worlds are saved on this server@NOTE@</p>
</main></body></html>''')
    note = '' if os.environ.get('DATA_DIR') else ' (free Render instances lose saved worlds when they restart &mdash; add a persistent disk and set DATA_DIR to keep them)'
    for token, value in (('@H_KB@', '%.0f' % h_kb), ('@Z_KB@', '%.0f' % z_kb), ('@BASE@', html.escape(base)), ('@WSURL@', html.escape(wsurl)),
                         ('@ROOMS@', rooms_html), ('@VERSION@', VERSION), ('@MAXP@', str(ctx.cfg.max_players)), ('@NOTE@', note)):
        page = page.replace(token, value)   # plain replace: the page's CSS is full of % signs that str-formatting would choke on
    return page


async def dispatch(ctx, req, reader, writer):
    """Handles one HTTP request. Returns True to keep the connection open."""
    keep = req.version == 'HTTP/1.1' and req.headers.get('connection', '').lower() != 'close'
    path = req.path
    if '\\' in path or '\x00' in path:
        return await send(ctx, req, writer, 400, b'Bad request', keep=False)
    if path in ('/ws', '/ws/') and 'upgrade' in req.headers.get('connection', '').lower():
        await websocket_session(ctx, req, reader, writer)
        return False
    if req.method == 'OPTIONS':
        return await send(ctx, req, writer, 204, b'', extra={'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*',
                                                             'Access-Control-Max-Age': '86400', 'Access-Control-Allow-Origin': '*'}, keep=keep)
    if req.method not in ('GET', 'HEAD'):
        return await send(ctx, req, writer, 405, b'Method not allowed', extra={'Allow': 'GET, HEAD, OPTIONS'}, keep=False)
    art = ctx.artifacts
    loop = asyncio.get_running_loop()
    try:
        if path == '/health':
            return await send(ctx, req, writer, 200, json_body({'status': 'ok'}), 'application/json; charset=utf-8', keep=keep, cache='no-store', cors=True)
        if path == '/api/info':
            info = {'name': 'Open Meadow', 'version': VERSION, 'protocol': rooms.PROTOCOL, 'uptime': int(time.time() - ctx.started),
                    'maxPlayers': ctx.cfg.max_players, 'downloads': {'html': '/download/open-meadow.html', 'zip': '/download/open-meadow.zip'}}
            info.update(ctx.hub.stats())
            info['roomCount'] = len(info['rooms'])
            if not ctx.cfg.list_rooms:      # LIST_ROOMS=0: keep room names private, only the totals are public
                info['rooms'] = []
            return await send(ctx, req, writer, 200, json_body(info), 'application/json; charset=utf-8', keep=keep, cache='no-store', cors=True)
        if path in ('/download', '/download/'):
            body = await loop.run_in_executor(None, lambda: landing_page(ctx, req).encode('utf-8'))
            return await send(ctx, req, writer, 200, body, MIME['.html'], keep=keep)
        if path == '/download/open-meadow.html':
            blob = await loop.run_in_executor(None, art.standalone, baked_base(ctx, req))
            return await send(ctx, req, writer, 200, blob.data, MIME['.html'], {'Content-Disposition': 'attachment; filename="open-meadow.html"'}, keep, 'no-cache', True, blob.etag)
        if path == '/download/open-meadow.zip':
            blob = await loop.run_in_executor(None, art.zip, baked_base(ctx, req))
            return await send(ctx, req, writer, 200, blob.data, MIME['.zip'], {'Content-Disposition': 'attachment; filename="open-meadow.zip"'}, keep, 'no-cache', True, blob.etag)
        if path == '/open-meadow.html':
            blob = await loop.run_in_executor(None, art.standalone, baked_base(ctx, req))
            return await send(ctx, req, writer, 200, blob.data, MIME['.html'], keep=keep, etag=blob.etag)
        if path in ('/', '/index.html'):
            blob = await loop.run_in_executor(None, art.index)
            return await send(ctx, req, writer, 200, blob.data, MIME['.html'], keep=keep, etag=blob.etag)
        if path == '/vendor/three.min.js':
            return await send(ctx, req, writer, 200, packager.vendor_three(), MIME['.js'], keep=keep, cache='public, max-age=86400')
        rel = STATIC.get(path)
        m = ENGINE_RE.match(path)
        if m:
            rel = 'engine/' + m.group(1)
        if rel:
            p = (ctx.root / rel)
            if p.is_file():
                return await send(ctx, req, writer, 200, p.read_bytes(), MIME.get(p.suffix, 'application/octet-stream'), keep=keep)
        return await send(ctx, req, writer, 404, b'Not found', keep=keep)
    except Exception as e:   # a bug here must never take the whole server down
        print('[http] error on %s: %r' % (path, e), flush=True)
        return await send(ctx, req, writer, 500, b'Internal server error', keep=False)


async def handle_connection(ctx, reader, writer):
    first = True
    try:
        while True:
            req = await read_request(reader, first)
            if req is None:
                break
            first = False
            if not await dispatch(ctx, req, reader, writer):
                break
    except (ConnectionError, OSError, asyncio.CancelledError):
        pass
    except Exception as e:
        print('[http] connection error: %r' % (e,), flush=True)
    finally:
        try:
            writer.close()
        except Exception:
            pass


# -------------------------------------------------------------- WebSocket
async def heartbeat(sock):
    while not sock.closed:
        await asyncio.sleep(20)
        if time.monotonic() - sock.last_rx > 70:
            await sock.close(1001, 'idle timeout')
            return
        sock.send_ping()


async def websocket_session(ctx, req, reader, writer):
    origin = req.headers.get('origin', '').rstrip('/')
    if ctx.cfg.allowed_origins and origin not in ctx.cfg.allowed_origins:
        writer.write(response_bytes(403, {'Content-Type': 'text/plain', 'Connection': 'close'}, b'Origin not allowed', False))
        return
    resp = ws.handshake_response(req.headers)
    if resp is None:
        writer.write(response_bytes(400, {'Content-Type': 'text/plain', 'Connection': 'close'}, b'Bad WebSocket handshake', False))
        return
    if len(ctx.sockets) >= ctx.cfg.max_connections:
        writer.write(response_bytes(503, {'Content-Type': 'text/plain', 'Connection': 'close', 'Retry-After': '30'}, b'Server is full', False))
        return
    writer.write(resp)
    sock = ws.WebSocket(reader, writer, max_size=16384)
    ctx.sockets.add(sock)
    client = beat = None
    try:
        first = await asyncio.wait_for(sock.recv(), timeout=10)
        try:
            msg = json.loads(first) if first else None
        except (ValueError, RecursionError):
            msg = None
        if not isinstance(msg, dict) or msg.get('t') != 'join':
            await sock.close(1008, 'the first message must be a join')
            return
        client = rooms.Client(sock.send_text)
        err = ctx.hub.join(client, msg.get('room'), msg.get('name'), msg.get('color'))
        if err:
            sock.send_text(rooms.dumps({'t': 'error', 'msg': err}))
            await sock.close(1008, 'join refused')
            return
        room = client.room
        print('[ws] %s joined "%s" (%d online)' % (client.name, room.name, len(room.clients)), flush=True)
        beat = asyncio.ensure_future(heartbeat(sock))
        while True:
            data = await sock.recv()
            if data is None:
                break
            if not isinstance(data, str):
                continue
            try:
                m = json.loads(data)
            except (ValueError, RecursionError):
                continue
            ctx.hub.handle(client, m)
    except asyncio.TimeoutError:
        await sock.close(1008, 'no join message')
    except (ConnectionError, OSError, asyncio.CancelledError):
        pass
    finally:
        if beat:
            beat.cancel()
        if client and client.room:
            name, room = client.name, client.room
            ctx.hub.leave(client)
            print('[ws] %s left "%s" (%d online)' % (name, room.name, len(room.clients)), flush=True)
        ctx.sockets.discard(sock)
        await sock.close()


# ----------------------------------------------------------- app lifecycle
async def ticker(ctx):
    while True:
        await asyncio.sleep(0.1)
        try:
            ctx.hub.tick()
        except Exception as e:
            print('[tick] error: %r' % (e,), flush=True)


async def autosaver(ctx):
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(ctx.cfg.autosave)
        if ctx.hub.dirty:
            ctx.hub.dirty = False
            snap = ctx.hub.snapshot()
            if not await loop.run_in_executor(None, ctx.hub.save, snap):
                ctx.hub.dirty = True


async def start(cfg):
    """Starts the service; returns (asyncio server, context). Port 0 picks a free port (used by the tests)."""
    ctx = Context(cfg)
    n = ctx.hub.load()
    server = await asyncio.start_server(lambda r, w: handle_connection(ctx, r, w), cfg.host, cfg.port, limit=65536, reuse_address=True)
    ctx.port = server.sockets[0].getsockname()[1]
    ctx.tasks = [asyncio.ensure_future(ticker(ctx)), asyncio.ensure_future(autosaver(ctx))]
    print('[server] Open Meadow %s listening on %s:%d (game files: %s, %d saved room(s))' % (VERSION, cfg.host, ctx.port, ctx.root, n), flush=True)
    return server, ctx


async def shutdown(server, ctx):
    for t in ctx.tasks:
        t.cancel()
    server.close()
    for sock in list(ctx.sockets):
        await sock.close(1001, 'server restarting')
    ctx.hub.save()
    print('[server] stopped; worlds saved', flush=True)


async def amain():
    server, ctx = await start(Config())
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass
    await stop.wait()
    await shutdown(server, ctx)


def main():
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
