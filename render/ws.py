"""Minimal RFC 6455 WebSocket support for asyncio streams (standard library only).

Used by server.py for the multiplayer endpoint; the helpers are symmetric
(`mask=True` / `is_client=True`) so the tests can drive the server with the
same code. Only what the game needs: text messages, ping/pong, close, and
fragmented messages are handled; extensions and sub-protocols are not.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import struct
import time

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA
MAX_WRITE_BUFFER = 4 * 1024 * 1024  # a client that falls this far behind is dropped


class ProtocolError(Exception):
    def __init__(self, code, reason):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def accept_key(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode('ascii')).digest()).decode('ascii')


def apply_mask(data, key):
    """XOR `data` with the 4-byte masking key (done as one big-integer XOR: fast in pure Python)."""
    n = len(data)
    if not n:
        return data
    full = (key * (n // 4 + 1))[:n]
    return (int.from_bytes(data, 'big') ^ int.from_bytes(full, 'big')).to_bytes(n, 'big')


def build_frame(opcode, payload=b'', mask=False, fin=True):
    n = len(payload)
    first = (0x80 if fin else 0) | opcode
    mbit = 0x80 if mask else 0
    if n < 126:
        head = struct.pack('!BB', first, mbit | n)
    elif n < 65536:
        head = struct.pack('!BBH', first, mbit | 126, n)
    else:
        head = struct.pack('!BBQ', first, mbit | 127, n)
    if mask:
        key = os.urandom(4)
        return head + key + apply_mask(payload, key)
    return head + payload


async def read_frame(reader, max_size, require_mask):
    """Reads one frame -> (fin, opcode, payload). Raises ProtocolError / IncompleteReadError."""
    b0, b1 = await reader.readexactly(2)
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    if b0 & 0x70:
        raise ProtocolError(1002, 'reserved bits set')
    masked = bool(b1 & 0x80)
    n = b1 & 0x7F
    if n == 126:
        n = struct.unpack('!H', await reader.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack('!Q', await reader.readexactly(8))[0]
    if opcode >= 8 and (not fin or n > 125):
        raise ProtocolError(1002, 'invalid control frame')
    if n > max_size:
        raise ProtocolError(1009, 'message too big')
    if require_mask and not masked:
        raise ProtocolError(1002, 'client frames must be masked')
    key = await reader.readexactly(4) if masked else None
    payload = await reader.readexactly(n) if n else b''
    if masked:
        payload = apply_mask(payload, key)
    return fin, opcode, payload


def handshake_response(headers):
    """Server handshake: returns the 101 response bytes, or None if the request is not a valid upgrade."""
    if 'websocket' not in headers.get('upgrade', '').lower():
        return None
    if 'upgrade' not in headers.get('connection', '').lower():
        return None
    if headers.get('sec-websocket-version', '').strip() != '13':
        return None
    key = headers.get('sec-websocket-key', '').strip()
    try:
        if len(base64.b64decode(key, validate=True)) != 16:
            return None
    except Exception:
        return None
    return ('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
            'Sec-WebSocket-Accept: %s\r\n\r\n' % accept_key(key)).encode('ascii')


class WebSocket:
    """One WebSocket connection on top of an asyncio (reader, writer) pair."""

    def __init__(self, reader, writer, max_size=65536, is_client=False):
        self.reader = reader
        self.writer = writer
        self.max_size = max_size
        self.is_client = is_client
        self.closed = False
        self.last_rx = time.monotonic()

    # ------------------------------------------------------------ receiving
    async def recv(self):
        """Next complete data message (str for text, bytes for binary), or None once the connection is closed.

        Pings are answered and pongs swallowed here, so callers only ever see data."""
        parts, kind, total = [], None, 0
        while True:
            try:
                fin, op, payload = await read_frame(self.reader, self.max_size, not self.is_client)
            except (asyncio.IncompleteReadError, ConnectionError, OSError):
                self.closed = True
                return None
            except ProtocolError as e:
                await self.close(e.code, e.reason)
                return None
            self.last_rx = time.monotonic()
            if op == OP_PING:
                self._write(build_frame(OP_PONG, payload, mask=self.is_client))
                continue
            if op == OP_PONG:
                continue
            if op == OP_CLOSE:
                code = struct.unpack('!H', payload[:2])[0] if len(payload) >= 2 else 1000
                await self.close(code)
                return None
            if op in (OP_TEXT, OP_BINARY):
                if parts:
                    await self.close(1002, 'new message inside a fragmented one')
                    return None
                kind, parts, total = op, [payload], len(payload)
            elif op == OP_CONT:
                if not parts:
                    await self.close(1002, 'unexpected continuation frame')
                    return None
                parts.append(payload)
                total += len(payload)
                if total > self.max_size:
                    await self.close(1009, 'message too big')
                    return None
            else:
                await self.close(1002, 'unknown opcode')
                return None
            if fin:
                data = b''.join(parts)
                if kind == OP_TEXT:
                    try:
                        return data.decode('utf-8')
                    except UnicodeDecodeError:
                        await self.close(1007, 'invalid utf-8')
                        return None
                return data

    # -------------------------------------------------------------- sending
    def _write(self, frame):
        if self.closed:
            return False
        try:
            tr = self.writer.transport
            if tr.is_closing():
                self.closed = True
                return False
            if tr.get_write_buffer_size() > MAX_WRITE_BUFFER:  # slow consumer: cut it loose
                self.closed = True
                tr.abort()
                return False
            self.writer.write(frame)
            return True
        except Exception:
            self.closed = True
            return False

    def send_text(self, text):
        """Queues a text message. Never blocks; returns False if the connection is gone or too slow."""
        return self._write(build_frame(OP_TEXT, text.encode('utf-8'), mask=self.is_client))

    def send_ping(self):
        return self._write(build_frame(OP_PING, b'', mask=self.is_client))

    async def close(self, code=1000, reason=''):
        if not self.closed:
            self.closed = True
            try:
                self.writer.write(build_frame(OP_CLOSE, struct.pack('!H', code) + reason.encode('utf-8')[:100], mask=self.is_client))
            except Exception:
                pass
        try:
            self.writer.close()
            await asyncio.wait_for(self.writer.wait_closed(), timeout=2)
        except Exception:
            pass
