# Naijacraft architecture

How the pieces fit, why they are built this way, and the rules you must keep when you change them.

## 1. Overview

```
browser                                         Cloudflare (free plan)
┌─────────────────────────────┐   HTTPS         ┌────────────────────────────────────────┐
│ index.html + js/ + shared/  │ ──────────────► │ Worker  src/index.js  (router, CORS)    │
│  Babylon.js renderer        │   /auth/*       │   │                                    │
│  accounts client (auth.js)  │                 │   ├─► Accounts Durable Object (SQLite)  │
│  world client (net.js)      │   WebSocket     │   └─► World Durable Object   (SQLite)   │
│                             │ ◄─────────────► │        one instance for the whole game │
└─────────────────────────────┘   /ws           └────────────────────────────────────────┘
```

- **One shared world.** There is a single `World` Durable Object (`idFromName('main')`), so every player is in the
  same Lagos and the code needs no sharding. Its capacity is capped at 120 players (`LIMITS.maxPlayers`).
- **Static files are served by the same Worker** from `worker/public` (a copy of the browser game made by
  `npm run build:client`). Static asset requests are free and unlimited.
- **Pure cores, thin shells.** `worker/src/accounts-core.js` and `world-core.js` contain all the logic and know nothing
  about the Workers runtime. `accounts.js` and `world.js` are small Durable Object wrappers. That is why the unit tests
  run in plain Node with an in-memory SQLite (`node:sqlite`) and fake sockets, and why the integration test only has to
  prove the wrappers work on the real runtime.
- **Code shared by browser and server** lives in `shared/`: the city layout, the wire protocol, the name and chat
  rules, base64url. The server therefore agrees with the client about plot numbers, the block id range and so on.

## 2. The city

- `shared/layout.js` defines the grid: 8 x 8 plots of 32 x 32 blocks, 8-block roads (`PITCH` = 40), a 328 x 328 city,
  a 28-block beach strip to the south, world height 64. Plot rows hold y = 1..63 (`PLOT_ROWS`); y = 0 is the ground.
- 17 plots are landmarks and show homes (not claimable); 47 are free land. `OFFLINE_PLOT` (28) is the plot offline
  players use.
- `js/city.js` generates the whole city **deterministically** from one seeded random stream, so every browser builds
  the identical city and the server never stores it. Only what players build is stored.
- **Orientation.** The 3D view is left-handed (Babylon): looking north (-z), +x is on your *left*. So that maps match
  what you see, plots are numbered from the high-x side and every 2D map draws x mirrored (`mapX(x) = SX - x`).
  Plot 1 is the top-left of each map; district names read Ikeja, Yaba, Surulere, Apapa from left to right.
  If you add any 2D map or compass, use `mapX`, and a heading of `180 + yaw` degrees.

## 3. Wire protocol (`shared/protocol.js`, version 1)

One WebSocket per player at `/ws`. Low-frequency messages are JSON text frames `{ "t": "type", ... }`; high-frequency data is
binary with an opcode in the first byte. The client sends `"ping"` every 20 s; the runtime answers `"pong"` without waking
the server.

| Direction | Frame | Contents |
| --- | --- | --- |
| client → server | text `hello` | `{ v, token, look? }` must be first; authenticates the socket |
| | text `claim` | `{ plot: number \| "auto" }` |
| | text `profile` | `{ look?, plotName?, achv? }` |
| | text `chat`, `emote`, `report`, `release` | |
| | binary `POS` (11 B) | position, yaw, pitch, flags, emote; coordinates quantised to 1/64 block |
| | binary `EDIT` | `[op][plot u8][count u16][u32 x count]`, each edit packs x5 z5 y6 id8 meta8 |
| | binary `REPLACE` | `[op][plot][deflate-raw(ids ‖ metas)]` (whole plot: share codes, blueprints, clear) |
| server → client | text `welcome` | identity, clock (`time.now/epoch/dayMs`), claimed plots, players, recent chat, limits |
| | text `join` `leave` `prof` `plot` `claimed` `released` `saved` `chat` `emote` `reject` `error` `notice` | |
| | binary `SNAPSHOT` | nearby players, 12 B each, five times a second |
| | binary `EDITS` | edits by other players, with the plot version |
| | binary `PLOTDATA` | a whole plot, compressed; sent for every built plot after `welcome`, and to resync after a `reject` |

Close codes: 4001 replaced (signed in elsewhere), 4002 removed/banned, 4003 protocol error, 4004 full, 4005 idle,
4006 outdated client, 4007 bad or expired token. The client reconnects with backoff after anything else and treats the
listed ones as final.

A plot's flat layout is `cellIndex(px, y, pz) = ((y - 1) * 32 + pz) * 32 + px` over `PLOT_CELLS` = 64,512 cells; a stored
plot is `ids (64,512 B) ‖ metas (64,512 B)` compressed with raw deflate.

## 4. What the server enforces

The browser is never trusted. In `world-core.js`:

- **Land:** one plot per account; only `claimable` plots; `claim` fails if the plot is taken; `release` frees it.
- **Edits:** only the plot's owner; y in 1..63; only placeable block ids (`isPlaceableId`; asphalt, road lines and wet
  sand are never placeable); a token bucket per connection (70,000 burst, 1,500 per second); bad input gets a `reject`
  plus a fresh `PLOTDATA` so the client snaps back to the truth. Large operations travel as `REPLACE`.
- **Ordering:** each socket's messages are processed strictly in order. A newcomer is registered only after all plot data
  is ready, in one synchronous step, so no edit can fall between "plot data sent" and "edits start arriving".
- **Chat:** length, control characters and bidi tricks stripped, blocked words masked (whole-word, so "Shittu" is fine),
  rate limit with a temporary mute for floods. Reports store the reported player's last messages for moderators.
- **Positions** are cosmetic: relayed, clamped, limited to a 150-block interest radius, never trusted for anything.
- **One session per account:** a new sign-in replaces the old one (close code 4001).
- **Persistence:** plots are flushed to SQLite at most 1.5 s after an edit and when a player leaves. The Durable Object
  sleeps (hibernates) when nobody is active; sessions survive hibernation through socket attachments.

## 5. Accounts

Three ways in: guest (instant), username + password, Google. Everything is in `worker/src/accounts-core.js`.

- **Passwords never leave the browser.** `js/kdf.js` computes `K = PBKDF2-HMAC-SHA256(password, per-account salt,
  300,000 rounds)` (Web Crypto, NFKC-normalised) and sends only `K`. The server stores `HMAC(pepper, K)`. A stolen
  database therefore cannot be cracked without the pepper, and the Worker never spends CPU hashing (the free plan allows
  10 ms per request, far too little for server-side PBKDF2).
- Salts are fetched with `/auth/prelogin`; unknown usernames get a stable fake salt, so it cannot be used to discover
  which names exist. Failed logins are rate limited per name and per IP in SQLite; comparisons are constant time.
- **Recovery code** (16 characters, shown once, stored as an HMAC) resets a forgotten password.
- **Google:** the browser gets an ID token from Google Identity Services; the Worker verifies the RS256 signature against
  Google's published keys, the audience and the expiry, and uses only the stable `sub` claim.
- **Session tokens:** `n1.<payload>.<HMAC-SHA256 signature>`, 60-day lifetime, refreshed when within a week of expiry.
  Signing out everywhere, changing a password or banning bumps the account's `epoch`, which invalidates all tokens.
- **Optional Turnstile** on guest and sign-up, set by the `TURNSTILE_SECRET` secret.
- Accounts live in the `Accounts` Durable Object (a separate instance from the world, so a busy world never slows
  logins). The World verifies a token by calling `Accounts.verify` over an RPC.

> Why not a hosted database? The design had to cost nothing and not depend on a third-party free tier that pauses idle
> projects. Durable Objects' built-in SQLite does the job on the same free plan, next to the game server.

## 6. The browser game

- `main.js` boots the engine, generates and meshes the city, creates the UI controllers, and runs the game loop.
  `game.js` holds the shared context (`G`) that `building.js`, `online.js` and friends read.
- **Online vs offline.** Offline, `G.online` is null: the player owns plot 28 and the plot is saved to `localStorage`.
  Online, the server owns the truth and nothing is saved locally except cosmetic settings. `building.js` applies every
  edit locally first (building feels instant) and then sends it; a rejected edit is corrected by the server's resync.
- **Shared clock.** After `welcome` the client knows `serverNow`. Day/night, the weather (8-minute slots hashed from the
  clock), residents and traffic are pure functions of that clock, so nothing about them needs to be sent.
- **Other players** (`remote.js`): the server sends snapshots at 5 Hz; avatars are drawn 220 ms in the past and
  interpolated, so movement is smooth. Names and chat bubbles are DOM elements positioned from the 3D view (and always
  set with `textContent`; chat is untrusted).
- **Rendering** (`render.js`, `fx.js`, `mesher.js`): chunk meshes carry per-vertex ambient occlusion, sunlight and lamp
  light; the shader lights faces from their normals. Sun shadows come from a depth map rendered from the sun (packed into
  RGB, refreshed about once a second or when blocks change), filtered over 4 or 9 taps. The texture atlas is padded and
  mipmapped. A Babylon `DefaultRenderingPipeline` adds bloom (only values above 1.0 glow: lamps, neon, the sun) and FXAA.
  Presets Fast / Balanced / Beautiful toggle these; Auto chooses from the GPU name and steps down if the frame rate
  stays low (never in automated browsers).
- **Safe by construction:** the player's own text is always inserted with `textContent`/`createTextNode`; the only
  `innerHTML` uses are static strings.

## 7. Rules for changing things

- **Block ids are saved forever.** Only append. When you add a block, raise `MAX_BLOCK_ID` in `shared/layout.js` (a test
  compares it with `js/blocks.js`) and list non-placeable ones in `NON_PLACEABLE`.
- **Never change the protocol silently.** Bump `PROTOCOL_VERSION` when a frame changes; older clients are told to
  refresh (close code 4006).
- **The city must stay deterministic.** `city.js` uses one seeded random stream in a fixed order; adding a random call in
  the middle changes everything after it. A test (`test/city.test.mjs`) checks determinism and that nothing leaks outside
  its plot.
- **Never rename the Durable Object classes** (`World`, `Accounts`) once deployed; use a new migration in
  `wrangler.toml`.
- Keep Worker CPU per request small. The free plan allows 10 ms.

## 8. Tests

| Command | Covers |
| --- | --- |
| `npm test` | shared code (layout, protocol, name rules, key derivation), the city generator, account logic, Google token checks, the world server with fake sockets and an in-memory SQLite |
| `cd worker && npm run test:integration` | the real Workers runtime (`wrangler dev`): HTTP, WebSocket, claiming, building, two players, persistence across a restart, admin, bans and account deletion |
| `cd worker && npm run test:integration:long` | the above plus a Durable Object hibernating and waking up with its players intact (about 2 minutes) |
| `npm run test:e2e` | the real browser game (headless Chromium) against the real server: accounts, claiming, building sync, chat, offline mode |
