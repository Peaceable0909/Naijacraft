# Naijacraft

**Build your own Lagos, together.** Naijacraft is a free building game that runs in the browser: every player
claims a plot of land in one shared, living Lagos, builds anything on it, and can walk over to visit everyone
else's. No install, no app store, and it costs nothing to run.

- **Online or offline.** Play instantly as a guest, make an account (username + password, or Google), or play
  offline on a single device with no server at all.
- **Free to host.** The game and the server live on Cloudflare's free plan (Workers + Durable Objects). One
  `npm run deploy` publishes both.
- **Looks like a game.** Real sun and moon with shadows, glowing lamps, swaying plants, an animated ocean,
  weather and a Lagos day that lasts twenty minutes.

## Try it locally

You only need Node 20 or newer.

```sh
# the whole game, online, on your own computer (game + server on one address)
cd worker
npm install
npm run dev            # open http://localhost:8787
```

Just want to look around without a server? The browser game is a plain static site (no build step):

```sh
python3 -m http.server 8000     # then open http://localhost:8000  -> offline mode
```

Babylon.js (the 3D engine) is loaded from a CDN, so the first load needs an internet connection.

## Put it online for free

Everything is explained step by step, for people who have never used Cloudflare, in
**[docs/DEPLOY.md](docs/DEPLOY.md)**. The short version:

```sh
cd worker
npm install
npx wrangler login
npm run deploy         # prints https://naijacraft-world.<you>.workers.dev  - that address is the game
```

## What's in the game

**One shared city**
- An 8 x 8 grid of 32 x 32 plots (47 of them free for players to claim) in eight districts: Ikeja, Yaba,
  Surulere, Apapa, Lagos Island, Ikoyi, Victoria Island and Lekki. Roads, zebra crossings, street lights, a central
  plaza, and **Bar Beach** with palms, a beach bar and the Atlantic.
- Landmarks to visit: Computer Village, Balogun Market, Freedom Park, the National Theatre, Teslim Balogun
  Stadium, Apapa Port, the Yaba Tech Hub, Eko Atlantic and the Lekki Conservation Centre, plus show homes.
- Residents who greet you in Pidgin, Yoruba, Igbo and Hausa, and danfo buses and keke napeps on the ring roads.
  Everyone sees them in the same place, because they follow a shared clock. The day, the night and the rain are shared too.

**Your plot**
- Choose your land on a map (or press *Surprise me*). It is yours alone: nobody else can build on it, and the
  server checks every block edit.
- 63 blocks, including Ankara and Adire fabrics, lamps, neon, doors, slabs, stairs, fences, glass panes, carpets,
  water and plants; 14 blueprints; undo / redo, area fill, copy and paste; share your build as a code.
- Name your plot, give it a sign, take photos, collect 21 achievements.

**Together**
- See other builders walk around (with name tags), chat, wave, dance and cheer (`B`), open the players list
  (`Tab`) to visit someone's plot, mute them, or report them.
- Guests can upgrade to a real account any time. Forgot your password? Your recovery code gets you back in.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrows | move |
| Mouse | look |
| Space / Space x2 | jump and swim / toggle flight (Space up, Shift down) |
| Shift | sprint |
| Left / right click | break / place a block (right-click also opens doors) |
| Middle click | pick the block you are looking at |
| 1-9, mouse wheel | choose a hotbar slot |
| E | blocks and blueprints |
| Ctrl+Z / Ctrl+Y | undo / redo |
| F, F | select an area (two corners); G fills it, X clears it, C copies, V pastes, R rotates |
| Enter or `/` | chat |
| Tab | who is online |
| B | emotes |
| T | third-person camera |
| M | map and teleport |
| P | photo |
| H | all controls |
| Esc | pause: settings, character, plot, account |

On phones and tablets there is an on-screen stick and buttons.

## How it works

```
 browser (static files)                       Cloudflare Worker (free plan)
 ┌───────────────────────────┐   HTTPS        ┌──────────────────────────────┐
 │ js/  Babylon.js game      │ ─────────────► │ /auth/*   Accounts (Durable   │
 │ shared/ layout, protocol  │                │           Object, SQLite)     │
 │                           │   WebSocket    │ /ws       World  (Durable     │
 │                           │ ◄────────────► │           Object, SQLite)     │
 └───────────────────────────┘                └──────────────────────────────┘
```

- The browser generates the city locally (it is deterministic) and only receives what players have built.
- The **World** Durable Object is the authority: who owns which plot, every block edit, chat. Positions go through
  it in small binary messages five times a second.
- **Accounts** never send your password anywhere. The browser stretches it (PBKDF2, 300,000 rounds) and the server
  stores only an HMAC of the result, which keeps the Worker well inside the free CPU limit.
- Details, the wire protocol and the design decisions: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Project layout

| Path | What is in it |
| --- | --- |
| `index.html`, `css/`, `assets/` | the page, the interface styles, self-hosted fonts and icon |
| `js/` | the browser game (see the table below) |
| `shared/` | code used by both the browser and the server: city layout, network protocol, name rules |
| `worker/` | the Cloudflare Worker: accounts, world server, tests, deploy config |
| `test/` | unit tests for the shared code and the city generator |
| `docs/` | deploy guide and architecture notes |

| In `js/` | Purpose |
| --- | --- |
| `main.js` | boot, game loop, input, screens |
| `building.js` | placing and breaking, undo, area tools, blueprints, share codes |
| `online.js`, `net.js`, `auth.js`, `config.js` | online session, WebSocket client, accounts API, server address |
| `remote.js`, `chat.js`, `menu.js`, `claim.js`, `account.js`, `dialog.js` | other players, chat, start screen, land chooser, account tab |
| `world.js`, `city.js`, `blocks.js`, `mesher.js` | world data and lighting, the generated city, blocks and textures, chunk meshes |
| `render.js`, `fx.js` | shaders and day/night; shadows, glow and quality presets |
| `player.js`, `characters.js`, `npcs.js`, `vehicles.js` | movement, avatars, residents, traffic |
| `minimap.js`, `ui.js`, `touch.js`, `audio.js`, `storage.js`, `achievements.js`, `prefabs.js` | maps, interface helpers, touch controls, sound, local saves, goals, blueprints |

## Tests

```sh
npm test                                  # unit tests: layout, protocol, accounts, world server, city generator
cd worker && npm run test:integration     # starts the real Workers runtime and drives it with WebSocket players
cd worker && npm run test:integration:long   # also proves a Durable Object survives hibernation (about 2 minutes)
```

`window.__naija` exposes the game's internals for automated browser tests.

## Credits

Fonts: [Lilita One](https://fonts.google.com/specimen/Lilita+One) and
[Nunito](https://fonts.google.com/specimen/Nunito), both under the SIL Open Font License (see `assets/fonts`).
All textures, sounds and models are generated in code. 3D engine: [Babylon.js](https://www.babylonjs.com/).

## Roadmap

1. **Phase 1:** playable single-player prototype. *(done)*
2. **Phase 2:** accounts, one shared Lagos, multiplayer building, chat, a better look. *(this release)*
3. **Phase 3:** more districts, co-building on shared plots, player shops, events and community challenges.
