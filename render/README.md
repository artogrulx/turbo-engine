# Open Meadow — Render service

A small web service (Python standard library only, no `pip install`) that hosts the game, runs the **multiplayer rooms** (WebSocket) and offers the **standalone HTML** and **ZIP** downloads.

| Endpoint | What it does |
| --- | --- |
| `GET /` | the game (uses the bundled Three.js, so no CDN is needed) |
| `GET /download` | download page with both links and the multiplayer address |
| `GET /download/open-meadow.html` | the whole game as **one self-contained HTML file** (attachment) |
| `GET /download/open-meadow.zip` | the project as a **ZIP**: game files, standalone HTML, Three.js and this server (attachment) |
| `GET /open-meadow.html` | the standalone game, opened in the browser |
| `GET /api/info` | status and rooms as JSON (CORS-enabled) |
| `GET /health` | health check for Render |
| `WS /ws` | multiplayer |

The downloads are generated from the files in the repository whenever one of them changes, so they never go stale.

## Deploy on Render

**Blueprint (easiest):** Render dashboard → *New* → *Blueprint* → choose this repository. It reads [`render.yaml`](../render.yaml).

**Manually:** *New* → *Web Service* → this repository, leave *Root Directory* empty, then set
*Runtime* `Python`, *Build Command* `echo ok`, *Start Command* `python render/server.py`, *Health Check Path* `/health`.

Open `https://<your-service>.onrender.com/download` to get the links. Friends join with **Multiplayer** in the game: enter the service address and a room name (or share `https://<your-service>.onrender.com/?room=friends`).
The standalone HTML and the GitHub Pages version can join too: type the service address into the Multiplayer dialog.

## Run it locally

```bash
python3 render/server.py          # http://localhost:8080
PORT=9000 python3 render/server.py
```

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | listen address (Render sets `PORT`) |
| `DATA_DIR` | `render/data` | where worlds are saved (`worlds.json`) |
| `MAX_PLAYERS` | `16` | players per room |
| `MAX_ROOMS` | `24` | rooms per server |
| `MAX_EDITS` | `200000` | stored block/water/flower edits per room |
| `MAX_CONNECTIONS` | `300` | simultaneous WebSockets |
| `LIST_ROOMS` | `1` | `0` hides room names from `/api/info` (only totals stay public) |
| `MOTD` | empty | message shown in chat when someone joins |
| `SEED_SALT` | `0` | changes every room's world (a room name always gives the same terrain) |
| `ALLOWED_ORIGINS` | any | comma-separated list of page origins allowed to open the WebSocket |
| `PUBLIC_URL` | `RENDER_EXTERNAL_URL` | address shown on the download page |
| `AUTOSAVE_SECONDS` | `20` | how often changed worlds are written to disk |
| `GAME_DIR` | repository root | folder holding `index.html` and `engine/` |

## How multiplayer works

A **room** is one shared world. Every client generates the terrain itself from the room's seed; the server only stores the *edits* players make (blocks, water sources, flowers) and the day clock, and relays them. A new player receives the seed and the full edit list, then live updates. Edits are last-write-wins in server order and are echoed to everyone, including the sender, so all clients converge. Players' positions are batched and sent about 10 times a second.

Messages are JSON text frames. Client → server: `join {room, name, color}`, `pos {x,y,z,yaw,pitch,f}`, `block|water|plant {x,y,z,v}`, `chat {text}`, `ping {ts, rtt}`. Server → client: `welcome`, `edits {k, a:[x,y,z,v,…]}`, `ready`, `join`, `leave`, `s` (batched positions), `block|water|plant`, `chat`, `sys`, `pong`, `error`. See `rooms.py` for the exact validation.

## Things to know

* **Free plan:** instances sleep after about 15 minutes without traffic (the next visit takes about a minute to wake) and have no persistent disk, so **saved worlds are lost when the instance restarts**. Use a paid plan with a disk and set `DATA_DIR` to keep them.
* **No accounts or passwords.** Anyone who knows the address can join any room. Use hard-to-guess room names and `LIST_ROOMS=0` for private games. The server is a trust-based relay: it validates and rate-limits every message and rejects edits far from the sender, but it does not simulate the world, so a modified client can cheat.
* Each client simulates flowing water on its own; water sources and bucket pours are shared. Grass growth is switched off in shared worlds. Players do not collide with each other.

## Tests and rebuilding

```bash
python3 -m unittest discover -s render/tests -v     # WebSocket framing, room rules, packager, the real server over sockets
python3 render/packager.py                           # rewrites open-meadow.html at the repository root
python3 render/packager.py --check                   # exits 1 if open-meadow.html is out of date
```

After changing any game file, run `python3 render/packager.py` so the committed `open-meadow.html` matches (a test fails if it does not).

## Files

`server.py` HTTP + WebSocket service · `rooms.py` room rules and persistence · `ws.py` WebSocket protocol · `packager.py` standalone HTML and ZIP builder · `vendor/three.min.js` Three.js r149 (MIT) bundled for the offline builds · `tests/` the test suite.
