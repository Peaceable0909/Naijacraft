# Naijacraft

Build your own Lagos. A free, in-browser, block-building game: you get a protected plot of land in a
flat, finite Lagos, and you build on it. No install, no server, no cost.

This is **Phase 1 - the playable prototype**: one player, local saves. Phase 2 adds accounts, cloud saves
and a shared multiplayer city (see the roadmap below).

## Run it

It is a static site (no build step). ES modules need an HTTP server, so don't open `index.html` directly:

```sh
python3 -m http.server 8000     # or: npx serve
# then open http://localhost:8000
```

Babylon.js is loaded from the jsDelivr CDN, so you need an internet connection the first time.

## Deploy for free (Cloudflare Pages)

Create a Pages project from this repo with **no build command** and output directory `/` (the repo root).

## Controls

| Input | Action |
| --- | --- |
| W A S D | move |
| Mouse | look |
| Space / Space x2 | jump / toggle flight (Space up, Shift down) |
| Shift | sprint |
| Left click (hold) | break block |
| Right click (hold) | place block |
| Middle click | pick the block you are looking at |
| 1-9 / mouse wheel | select hotbar slot |
| E | open the block palette; click a block to put it in the selected slot |
| Esc | pause: view distance, resolution, mouse sensitivity, clear my plot |

## What's in the prototype

- A 168 x 168 flat city: 16 plots of 32 x 32 blocks, 8-wide roads, pavements, street lights, a central
  plaza and four named districts (Ikeja, Yaba, Lagos Island, Lekki).
- You own **Plot 06** (yellow border). Everywhere else is protected: other plots, roads and public spaces
  cannot be edited. The selection outline turns red where you can't build.
- Sample content so it feels lived-in: houses, a shop, a tower, Yaba Market, Freedom Park and danfo buses.
- 18 building blocks (concrete, brick, wood, glass, roof tile, lamps, paints and more), creative mode only.
- Your plot, hotbar and position save automatically to `localStorage`.
- Original, procedurally generated textures. No third-party or Minecraft assets.

## Code map

| File | Purpose |
| --- | --- |
| `js/blocks.js` | block ids, texture atlas painter. Ids are saved, so only ever append new blocks. |
| `js/world.js` | world grid, plots/districts, raycast, plot (de)serialisation |
| `js/city.js` | procedural Lagos: roads, plaza, buildings, market, park, buses |
| `js/mesher.js` | chunk meshing with face culling and ambient occlusion |
| `js/player.js` | first-person movement and voxel collision |
| `js/storage.js` | local persistence (swap for cloud saves in Phase 2) |
| `js/ui.js`, `css/style.css`, `index.html` | menus, hotbar, inventory |
| `js/main.js` | Babylon scene, input, building rules, game loop |

## Roadmap

1. **Phase 1 (this):** playable prototype.
2. **Phase 2 - Online Naijacraft:** Supabase auth (Google/email) and cloud saves, automatic plot
   assignment, Cloudflare Durable Objects for live multiplayer, server-side permission checks, chat,
   mute/block/report, mobile controls.
3. **Phase 3 - Growing city:** more districts, co-building, shops, events, vehicles.

Permissions in `canEdit()` (`js/main.js`) are client-side today. In Phase 2 the server must be the
authority on every block edit.
