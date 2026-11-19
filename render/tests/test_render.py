"""Tests for the Open Meadow Render service. Run from the repository root:

    python3 -m unittest discover -s render/tests -v

Standard library only; the integration tests start the real server on a free local port.
"""
import asyncio
import base64
import gzip
import io
import json
import os
import re
import sys
import tempfile
import time
import unittest
import warnings
import zipfile
from pathlib import Path

warnings.simplefilter('ignore', ResourceWarning)   # the tests deliberately leave some client sockets to the garbage collector
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import packager  # noqa: E402
import rooms  # noqa: E402
import server  # noqa: E402
import ws  # noqa: E402


# ---------------------------------------------------------------- WebSocket
class WebSocketFraming(unittest.IsolatedAsyncioTestCase):
    async def _feed(self, data):
        r = asyncio.StreamReader()
        r.feed_data(data)
        r.feed_eof()
        return r

    async def test_roundtrip_all_length_classes(self):
        for n in (0, 1, 5, 125, 126, 300, 65535, 65536, 70000):
            payload = os.urandom(n)
            for mask in (False, True):
                frame = ws.build_frame(ws.OP_BINARY, payload, mask=mask)
                fin, op, got = await ws.read_frame(await self._feed(frame), 1 << 20, require_mask=mask)
                self.assertEqual((fin, op, got), (True, ws.OP_BINARY, payload), (n, mask))

    async def test_unmasked_client_frame_is_rejected(self):
        with self.assertRaises(ws.ProtocolError):
            await ws.read_frame(await self._feed(ws.build_frame(ws.OP_TEXT, b'hi', mask=False)), 1000, require_mask=True)

    async def test_oversized_frame_is_rejected(self):
        with self.assertRaises(ws.ProtocolError) as cm:
            await ws.read_frame(await self._feed(ws.build_frame(ws.OP_TEXT, b'x' * 500, mask=True)), 100, require_mask=True)
        self.assertEqual(cm.exception.code, 1009)

    def test_accept_key_matches_rfc_example(self):
        self.assertEqual(ws.accept_key('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')

    async def test_fragmented_message_and_ping_are_handled(self):
        data = (ws.build_frame(ws.OP_TEXT, b'hel', mask=True, fin=False) + ws.build_frame(ws.OP_PING, b'p', mask=True)
                + ws.build_frame(ws.OP_CONT, b'lo \xc3\xa9', mask=True, fin=True))
        reader = await self._feed(data)
        out = []

        class W:   # captures what the socket writes back (the pong)
            class transport:
                is_closing = staticmethod(lambda: False)
                get_write_buffer_size = staticmethod(lambda: 0)
            def write(self, b): out.append(b)
            def close(self): pass
            async def wait_closed(self): pass
        sock = ws.WebSocket(reader, W())
        self.assertEqual(await sock.recv(), 'hello é')
        self.assertEqual(out[0][0] & 0x0F, ws.OP_PONG)


# ------------------------------------------------------------- room rules
def make_client(hub, name='Ann', room='meadow', pos=(0, 60, 0)):
    box = []
    c = rooms.Client(lambda s: box.append(json.loads(s)) or True)
    err = hub.join(c, room, name, '#3d7be0')
    assert err is None, err
    c.box = box
    if pos:
        hub.handle(c, {'t': 'pos', 'x': pos[0], 'y': pos[1], 'z': pos[2], 'yaw': 0, 'pitch': 0, 'f': 0})
    return c


class RoomRules(unittest.TestCase):
    def setUp(self):
        self.hub = rooms.Hub(max_players=3)

    def test_welcome_sequence_and_room_seed_is_stable(self):
        a = make_client(self.hub)
        kinds = [m['t'] for m in a.box]
        self.assertEqual(kinds[0], 'welcome')
        self.assertEqual(kinds[-1], 'ready')
        self.assertEqual(a.box[0]['seed'], rooms.Hub().default_seed('meadow'))
        self.assertNotEqual(self.hub.default_seed('meadow'), self.hub.default_seed('friends'))

    def test_edits_are_validated_echoed_and_replayed_to_newcomers(self):
        a, b = make_client(self.hub, 'Ann'), make_client(self.hub, 'Bob')
        a.box.clear(); b.box.clear()
        self.hub.handle(a, {'t': 'block', 'x': 3, 'y': 50, 'z': -2, 'v': 13})
        echo = {'t': 'block', 'x': 3, 'y': 50, 'z': -2, 'v': 13}
        self.assertIn(echo, a.box)          # the sender gets its own edit back, so everyone converges
        self.assertIn(echo, b.box)
        for bad in ({'t': 'block', 'x': 3, 'y': 50, 'z': -2, 'v': 20},        # bedrock
                    {'t': 'block', 'x': 3, 'y': 200, 'z': 0, 'v': 1},         # outside the world
                    {'t': 'block', 'x': 3, 'y': 50, 'z': 0, 'v': 99},         # unknown block
                    {'t': 'block', 'x': 'a', 'y': 50, 'z': 0, 'v': 1},
                    {'t': 'water', 'x': 3, 'y': 50, 'z': 0, 'v': 5},
                    {'t': 'plant', 'x': 3, 'y': 50, 'z': 0, 'v': 200},
                    {'t': 'block', 'x': 400, 'y': 50, 'z': 0, 'v': 1}):       # too far from the sender
            n = len(a.box)
            self.hub.handle(a, bad)
            self.assertEqual(len(a.box), n, bad)
        self.hub.handle(a, {'t': 'water', 'x': 3, 'y': 51, 'z': -2, 'v': 24})
        self.hub.handle(a, {'t': 'plant', 'x': 4, 'y': 50, 'z': -2, 'v': (77 << 8) | 4})
        c = make_client(self.hub, 'Cy')
        replay = {m['k']: m['a'] for m in c.box if m['t'] == 'edits'}
        self.assertEqual(replay['b'], [3, 50, -2, 13])
        self.assertEqual(replay['w'], [3, 51, -2, 24])
        self.assertEqual(replay['p'], [4, 50, -2, (77 << 8) | 4])

    def test_last_write_wins_for_everyone(self):
        a, b = make_client(self.hub, pos=(0, 41, 0)), make_client(self.hub, 'Bob', pos=(0, 41, 0))
        self.hub.handle(a, {'t': 'block', 'x': 1, 'y': 40, 'z': 1, 'v': 5})
        self.hub.handle(b, {'t': 'block', 'x': 1, 'y': 40, 'z': 1, 'v': 7})
        for c in (a, b):
            last = [m for m in c.box if m['t'] == 'block'][-1]
            self.assertEqual(last['v'], 7)
        self.assertEqual(list(self.hub.rooms['meadow'].blocks.values()), [7])

    def test_positions_are_batched_and_not_echoed(self):
        a, b = make_client(self.hub, 'Ann'), make_client(self.hub, 'Bob')
        self.hub.tick()                      # flush the initial positions both clients just reported
        a.box.clear(); b.box.clear()
        self.hub.handle(a, {'t': 'pos', 'x': 5.123456, 'y': 61, 'z': 7, 'yaw': 1.5, 'pitch': 0.2, 'f': 3})
        self.hub.tick()
        self.assertEqual(a.box, [])
        row = b.box[0]['p'][0]
        self.assertEqual(row, [a.id, 5.12, 61.0, 7.0, 1.5, 0.2, 3])
        b.box.clear(); self.hub.tick()
        self.assertEqual(b.box, [])           # nothing new -> nothing sent

    def test_chat_is_sanitised_and_rate_limited(self):
        a, b = make_client(self.hub, 'Ann'), make_client(self.hub, 'Bob')
        b.box.clear()
        self.hub.handle(a, {'t': 'chat', 'text': '  hello\x00 \n world  '})
        self.assertEqual(b.box[0]['text'], 'hello world')
        self.hub.handle(a, {'t': 'chat', 'text': 'x' * 1000})
        self.assertEqual(len(b.box[1]['text']), 200)
        for _ in range(12):
            self.hub.handle(a, {'t': 'chat', 'text': 'spam'})
        self.assertLess(len([m for m in b.box if m['t'] == 'chat']), 9)

    def test_names_colours_and_room_names_are_cleaned(self):
        c = rooms.Client(lambda s: True)
        self.assertIsNone(self.hub.join(c, 'MeadoW', '<b>Evil</b> ‮ name' * 3, 'red'))
        self.assertTrue(c.name and len(c.name) <= 16 and '<' not in c.name and '‮' not in c.name)
        self.assertRegex(c.color, r'^#[0-9a-f]{6}$')
        self.assertIn('meadow', self.hub.rooms)          # room names are case-insensitive
        for bad in ('../etc', 'a b', '', 'x' * 40):
            self.assertIsNotNone(self.hub.join(rooms.Client(lambda s: True), bad, 'n', None) if bad else self.hub.join(rooms.Client(lambda s: True), 'a/b', 'n', None))

    def test_room_capacity_and_cleanup(self):
        cs = [make_client(self.hub, 'P%d' % i) for i in range(3)]
        self.assertIn('full', self.hub.join(rooms.Client(lambda s: True), 'meadow', 'late', None))
        for c in cs:
            self.hub.leave(c)
        self.assertNotIn('meadow', self.hub.rooms)       # empty and never edited: nothing to keep
        c = make_client(self.hub, pos=(0, 41, 0))
        self.hub.handle(c, {'t': 'block', 'x': 0, 'y': 40, 'z': 0, 'v': 1})
        self.hub.leave(c)
        self.assertIn('meadow', self.hub.rooms)          # edited rooms stay

    def test_leave_and_join_are_announced(self):
        a, b = make_client(self.hub, 'Ann'), make_client(self.hub, 'Bob')
        a.box.clear()
        self.hub.leave(b)
        self.assertEqual([m['t'] for m in a.box], ['leave', 'sys'])

    def test_edit_limit_and_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, 'sub', 'worlds.json')
            hub = rooms.Hub(f, max_edits=3)
            a = make_client(hub, pos=(0, 41, 0))
            for i in range(5):
                hub.handle(a, {'t': 'block', 'x': i, 'y': 40, 'z': 0, 'v': 1})
            self.assertEqual(hub.rooms['meadow'].edit_count(), 3)
            hub.handle(a, {'t': 'block', 'x': 0, 'y': 40, 'z': 0, 'v': 2})   # changing an existing cell is still allowed
            self.assertTrue(hub.save())
            hub2 = rooms.Hub(f)
            self.assertEqual(hub2.load(), 1)
            r = hub2.rooms['meadow']
            self.assertEqual(r.seed, hub.rooms['meadow'].seed)
            self.assertEqual(r.day_t0, hub.rooms['meadow'].day_t0)
            self.assertEqual(sorted(r.blocks.values()), [1, 1, 2])
            with open(f, 'w') as bad:
                bad.write('{ not json')
            self.assertEqual(rooms.Hub(f).load(), 0)         # corrupt save: ignored, no crash

    def test_pack_unpack_roundtrip(self):
        for x, y, z in ((0, 1, 0), (-5, 127, 9), (499999, 64, -499999), (-499999, 3, 499999)):
            self.assertEqual(rooms.unpack(rooms.pack(x, y, z)), (x, y, z))


# --------------------------------------------------------------- packager
class Packager(unittest.TestCase):
    def test_standalone_is_self_contained(self):
        html = packager.build_standalone()
        self.assertGreater(len(html), 700_000)
        self.assertEqual(re.findall(r'<script[^>]+src=', html), [])
        self.assertNotIn('<link rel="stylesheet"', html)
        self.assertNotIn('cdn.jsdelivr.net', html.replace(packager.vendor_three().decode(), ''))
        self.assertIn('<title>Open Meadow</title>', html)
        self.assertEqual(html.count('</script>'), html.count('<script'))   # no script text broke out of its element

    def test_offline_index_points_at_the_bundled_three(self):
        idx = packager.build_offline_index()
        self.assertIn('<script src="vendor/three.min.js"></script>', idx)
        self.assertNotIn('jsdelivr', idx)
        self.assertIn('<!-- three:begin -->', idx)       # markers survive, so the output can be processed again
    def test_an_unzipped_copy_can_rebuild_itself(self):
        with tempfile.TemporaryDirectory() as d:
            zipfile.ZipFile(io.BytesIO(packager.build_zip())).extractall(d)
            root = Path(d) / 'open-meadow'
            self.assertEqual(packager.build_standalone(root), packager.build_standalone())   # same single-file game, built from the unzipped files
            self.assertIn('vendor/three.min.js', packager.build_offline_index(root))
            again = zipfile.ZipFile(io.BytesIO(packager.build_zip(root)))   # zipping the unzipped copy gives the same file list
            self.assertEqual(sorted(again.namelist()), sorted(zipfile.ZipFile(io.BytesIO(packager.build_zip())).namelist()))

    def test_zip_contents(self):
        z = zipfile.ZipFile(io.BytesIO(packager.build_zip()))
        self.assertIsNone(z.testzip())
        names = set(z.namelist())
        for need in ('open-meadow/index.html', 'open-meadow/open-meadow.html', 'open-meadow/main.js', 'open-meadow/engine/world.js',
                     'open-meadow/vendor/three.min.js', 'open-meadow/render/server.py', 'open-meadow/render/rooms.py'):
            self.assertIn(need, names)
        self.assertFalse([n for n in names if '__pycache__' in n or '/data/' in n or n.endswith('.pyc')])
        self.assertIn(b'vendor/three.min.js', z.read('open-meadow/index.html'))

    def test_committed_standalone_is_up_to_date(self):
        path = packager.find_root() / 'open-meadow.html'
        if path.is_file():
            self.assertEqual(path.read_bytes(), packager.build_standalone().encode('utf-8'),
                             'open-meadow.html is stale: run python3 render/packager.py')


# ------------------------------------------------------------ integration
async def http_get(port, path, headers=None, method='GET'):
    r, w = await asyncio.open_connection('127.0.0.1', port)
    extra = ''.join('%s: %s\r\n' % kv for kv in (headers or {}).items())
    w.write(('%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n%s\r\n' % (method, path, port, extra)).encode())
    raw = await asyncio.wait_for(r.read(), 15)
    w.close()
    await w.wait_closed()
    head, _, body = raw.partition(b'\r\n\r\n')
    lines = head.decode('latin-1').split('\r\n')
    hdrs = {k.strip().lower(): v.strip() for k, v in (l.split(':', 1) for l in lines[1:])}
    return int(lines[0].split()[1]), hdrs, body


class Peer:
    """A WebSocket client for the tests."""

    live = []   # every peer a test opened, closed again in asyncTearDown

    def __init__(self, port):
        self.port = port
        Peer.live.append(self)

    async def connect(self, origin=None):
        self.r, self.w = await asyncio.open_connection('127.0.0.1', self.port)
        key = base64.b64encode(os.urandom(16)).decode()
        self.w.write(('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
                      'Sec-WebSocket-Version: 13\r\n%s\r\n' % (key, ('Origin: %s\r\n' % origin) if origin else '')).encode())
        head = await asyncio.wait_for(self.r.readuntil(b'\r\n\r\n'), 5)
        self.status = int(head.split(b' ')[1])
        if self.status == 101:
            assert ws.accept_key(key).encode() in head
            self.sock = ws.WebSocket(self.r, self.w, max_size=1 << 24, is_client=True)
        return self

    def send(self, obj):
        self.sock.send_text(json.dumps(obj))

    async def recv(self, timeout=3):
        data = await asyncio.wait_for(self.sock.recv(), timeout)
        return None if data is None else json.loads(data)

    async def until(self, kind, timeout=3):
        end = time.monotonic() + timeout
        while True:
            m = await self.recv(max(0.05, end - time.monotonic()))
            if m is None or m['t'] == kind:
                return m

    async def join(self, room='meadow', name='Tester'):
        await self.connect()
        self.send({'t': 'join', 'room': room, 'name': name, 'color': '#3d7be0'})
        out = {'edits': {}}
        while True:
            m = await self.recv()
            if m is None or m['t'] == 'error':
                return m
            if m['t'] == 'welcome':
                out.update(m)
            elif m['t'] == 'edits':
                out['edits'].setdefault(m['k'], []).extend(m['a'])
            elif m['t'] == 'ready':
                return out

    async def close(self):
        await self.sock.close()


class ServerIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        await self.boot()

    async def boot(self, **env):
        cfg = server.Config({'PORT': '0', 'HOST': '127.0.0.1', 'DATA_DIR': self.tmp.name, 'AUTOSAVE_SECONDS': '0.2', 'MAX_PLAYERS': '2', **env})
        self.server, self.ctx = await server.start(cfg)
        self.port = self.ctx.port

    async def asyncTearDown(self):
        for p in Peer.live:
            try:
                p.w.close()
                await p.w.wait_closed()
            except Exception:
                pass
        Peer.live.clear()
        await server.shutdown(self.server, self.ctx)
        self.tmp.cleanup()

    async def test_http_endpoints(self):
        st, h, body = await http_get(self.port, '/health')
        self.assertEqual((st, json.loads(body)), (200, {'status': 'ok'}))
        st, h, body = await http_get(self.port, '/')
        self.assertEqual(st, 200)
        self.assertIn(b'vendor/three.min.js', body)
        for path, kind in (('/style.css', 'text/css'), ('/main.js', 'javascript'), ('/inventory.js', 'javascript'),
                           ('/engine/world.js', 'javascript'), ('/vendor/three.min.js', 'javascript')):
            st, h, body = await http_get(self.port, path)
            self.assertEqual(st, 200, path)
            self.assertIn(kind, h['content-type'])
        for bad in ('/server.py', '/render/server.py', '/engine/../render/server.py', '/engine/%2e%2e/render/server.py', '/engine/nope.js',
                    '/%2e%2e/%2e%2e/etc/passwd', '/engine/world.js/../../main.py', '/data/worlds.json', '/engine/'):
            st, _, _ = await http_get(self.port, bad)
            self.assertEqual(st, 404, bad)
        st, _, _ = await http_get(self.port, '/', method='POST')
        self.assertEqual(st, 405)
        st, h, body = await http_get(self.port, '/', method='HEAD')
        self.assertEqual((st, body), (200, b''))
        self.assertGreater(int(h['content-length']), 1000)
        st, h, body = await http_get(self.port, '/download')
        self.assertIn(b'open-meadow.zip', body)

    async def test_html_download(self):
        st, h, body = await http_get(self.port, '/download/open-meadow.html')
        self.assertEqual(st, 200)
        self.assertIn('attachment', h['content-disposition'])
        self.assertIn('open-meadow.html', h['content-disposition'])
        self.assertEqual(body.decode(), packager.build_standalone())
        # compressed transfer + conditional request
        st, h2, gz = await http_get(self.port, '/download/open-meadow.html', {'Accept-Encoding': 'gzip'})
        self.assertEqual(h2['content-encoding'], 'gzip')
        self.assertLess(len(gz), len(body) / 2)
        self.assertEqual(gzip.decompress(gz), body)
        st, _, empty = await http_get(self.port, '/download/open-meadow.html', {'If-None-Match': h['etag']})
        self.assertEqual((st, empty), (304, b''))
        st, h3, _ = await http_get(self.port, '/open-meadow.html')
        self.assertNotIn('content-disposition', h3)      # the inline copy opens in the browser

    async def test_zip_download(self):
        st, h, body = await http_get(self.port, '/download/open-meadow.zip')
        self.assertEqual(st, 200)
        self.assertEqual(h['content-type'], 'application/zip')
        self.assertIn('attachment', h['content-disposition'])
        z = zipfile.ZipFile(io.BytesIO(body))
        self.assertIsNone(z.testzip())
        self.assertIn('open-meadow/open-meadow.html', z.namelist())

    async def test_multiplayer_flow(self):
        a, b = Peer(self.port), Peer(self.port)
        wa = await a.join('friends', 'Ann')
        self.assertEqual(wa['room'], 'friends')
        self.assertEqual((wa['you']['name'], wa['you']['id'], wa['you']['color']), ('Ann', wa['id'], '#3d7be0'))   # the server's cleaned-up view of the joiner
        self.assertEqual(wa['players'], [])
        wb = await b.join('Friends', 'Bob')                  # room names are case-insensitive
        self.assertEqual([p['name'] for p in wb['players']], ['Ann'])
        self.assertEqual(wa['seed'], wb['seed'])
        self.assertEqual((await a.until('join'))['p']['name'], 'Bob')
        a.send({'t': 'pos', 'x': 10, 'y': 60, 'z': 10, 'yaw': 1, 'pitch': 0, 'f': 0})
        a.send({'t': 'block', 'x': 10, 'y': 59, 'z': 11, 'v': 13})
        a.send({'t': 'chat', 'text': 'hi Bob'})
        got = {}
        while len(got) < 3:
            m = await b.recv()
            if m['t'] in ('s', 'block', 'chat'):
                got[m['t']] = m
        self.assertEqual(got['block'], {'t': 'block', 'x': 10, 'y': 59, 'z': 11, 'v': 13})
        self.assertEqual(got['chat']['text'], 'hi Bob')
        self.assertEqual(got['s']['p'][0][1:4], [10.0, 60.0, 10.0])
        # a third player is refused (MAX_PLAYERS=2)
        late = await Peer(self.port).join('friends', 'Late')
        self.assertEqual(late['t'], 'error')
        # latency ping
        b.send({'t': 'ping', 'ts': 123})
        self.assertEqual((await b.until('pong'))['ts'], 123)
        await a.close()
        self.assertEqual((await b.until('leave'))['id'], wa['id'])
        # edits survive everyone leaving: a newcomer receives them
        await b.close()
        await asyncio.sleep(0.1)
        again = await Peer(self.port).join('friends', 'Cy')
        self.assertEqual(again['edits']['b'], [10, 59, 11, 13])
        info = json.loads((await http_get(self.port, '/api/info'))[2])
        self.assertEqual(info['rooms'][0]['name'], 'friends')

    async def test_bad_clients_are_handled(self):
        p = await Peer(self.port).connect()
        p.send({'t': 'chat', 'text': 'no join first'})
        self.assertIsNone(await p.recv())                    # closed: the first message must be a join
        p = await Peer(self.port).connect()
        p.sock.writer.write(b'\x81\x05hello')                # unmasked frame from a client
        await asyncio.sleep(0.2)
        self.assertIsNone(await p.recv())
        r, w = await asyncio.open_connection('127.0.0.1', self.port)
        w.write(b'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')   # no key
        self.assertIn(b' 400 ', await r.readuntil(b'\r\n'))
        w.close()
        await w.wait_closed()
        ok = Peer(self.port)
        await ok.join('meadow', 'Fine')
        ok.sock.writer.write(ws.build_frame(ws.OP_TEXT, b'{ garbage', mask=True))                     # invalid JSON is ignored
        ok.send({'t': 'ping', 'ts': 1})
        self.assertEqual((await ok.until('pong'))['ts'], 1)

    async def test_worlds_survive_a_restart(self):
        a = Peer(self.port)
        await a.join('keep', 'Ann')
        a.send({'t': 'pos', 'x': 0, 'y': 46, 'z': 0, 'yaw': 0, 'pitch': 0, 'f': 0})
        a.send({'t': 'water', 'x': 1, 'y': 45, 'z': 1, 'v': 24})
        a.send({'t': 'plant', 'x': 2, 'y': 45, 'z': 2, 'v': 5})
        await asyncio.sleep(0.2)
        await a.close()
        await server.shutdown(self.server, self.ctx)
        await self.boot()
        again = await Peer(self.port).join('keep', 'Ann')
        self.assertEqual(again['edits'], {'w': [1, 45, 1, 24], 'p': [2, 45, 2, 5]})

    async def test_room_names_can_be_hidden_and_connections_are_capped(self):
        await server.shutdown(self.server, self.ctx)
        await self.boot(LIST_ROOMS='0', MAX_CONNECTIONS='1')
        first = Peer(self.port)
        await first.join('secret-room', 'Ann')
        info = json.loads((await http_get(self.port, '/api/info'))[2])
        self.assertEqual((info['rooms'], info['roomCount'], info['players']), ([], 1, 1))     # totals only: names stay private
        self.assertEqual((await Peer(self.port).connect()).status, 503)                          # the connection cap is enforced

    async def test_origin_allow_list(self):
        await server.shutdown(self.server, self.ctx)
        await self.boot(ALLOWED_ORIGINS='https://good.example')
        self.assertEqual((await Peer(self.port).connect(origin='https://evil.example')).status, 403)
        self.assertEqual((await Peer(self.port).connect(origin='https://good.example')).status, 101)


if __name__ == '__main__':
    unittest.main()
