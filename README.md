# Naijacraft

Build your own Lagos. A free, in-browser block-building game: you get a protected plot of land in a
flat, living Lagos and you build on it. No install, no server, no cost.

This is **Phase 1 - the playable prototype** (single player, saves in the browser). Phase 2 adds
accounts, cloud saves and a shared multiplayer city (see the roadmap below).

## Run it

It is a static site (no build step). ES modules need an HTTP server, so don't open `index.html` directly:

```sh
python3 -m http.server 8000     # or: npx serve
# then open http://localhost:8000
```

Babylon.js is loaded from the jsDelivr CDN, so you need an internet connection the first time.

## Deploy for free (Cloudflare Pages)

Create a Pages project from this repo with **no build command** and output directory `/` (the repo root).

## What's in it

**The city**
- A 168 x 192 block Lagos: 16 plots of 32 x 32 in four districts (Ikeja, Yaba, Lagos Island, Lekki),
  roads with lane markings and zebra crossings, street lights, a central plaza and monument.
- Yaba Market (Ankara awnings), Freedom Park with a fountain, sample homes, a shop and a tower.
- **Bar Beach** along the south: sand, palms, umbrellas, a beach bar, canoes, giant LAGOS letters and
  an animated Atlantic Ocean.
- **Day and night**: a 20-minute Lagos day with sunrise around 6:45 and sunset around 18:45, sun, moon,
  stars and drifting clouds. Real lighting: interiors get dark and lamps, street lights and neon glow at night.
- **Weather**: the odd Lagos shower (or always sunny / rainy season in settings).
- **Residents** walk the pavements and greet you in Pidgin, Yoruba, Igbo and Hausa.
- **Danfo buses and a keke napep** drive the ring roads (right-hand traffic), stop and honk if you
  stand in the road, and the conductors shout their stops.

**Building**
- You own **Plot 06** (yellow border). Other plots, roads, parks and the beach are protected.
- 50+ blocks: concrete, brick, zinc roofing, thatch, mud brick, marble, floor tiles, paints, Ankara and
  Adire fabrics, the Naija flag, lamps and neon, bookshelves, solar panels, the GeePee water tank and the
  generator (right-click it).
- Shapes: slabs, stairs (auto-facing), doors that open and close, flowers and plants, swimmable water.
- **Blueprints**: Bungalow, Mama Put, Duplex, Palm and Mango trees, Generator House, Swimming Pool,
  Flower Garden, Traditional Hut, Kiosk, Water Tank Stand, Danfo Bus, Street Light, Football Goals.
- Tools: undo/redo, area select with fill/clear, copy & paste with rotation.

**You**
- Character creator: skin tone, outfits (Ankara, Adire, Agbada, Super Eagles jersey, Yaba tech hoodie)
  and hats (fila, gele, cap, hard hat). First- or third-person camera.
- 21 achievements and a weekly building challenge.
- Name your plot (shown on its sign), share your build as a code friends can load, take photos.
- Minimap, full map with click-to-teleport, synthesised sound effects and ambience (waves, rain, crickets).
- Touch controls for phones and tablets.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrows | move |
| Mouse | look |
| Space / Space x2 | jump & swim / toggle flight (Space up, Shift down) |
| Shift | sprint |
| Left click (hold) | break block |
| Right click (hold) | place block, open doors, start generators |
| Middle click | pick the block you are looking at |
| 1-9 / mouse wheel | select hotbar slot |
| E | blocks and blueprints |
| Ctrl+Z / Ctrl+Y | undo / redo |
| F, F | select an area (two corners) |
| G / X | fill area with the selected block / clear area |
| C / V / R | copy area / paste / rotate a paste or blueprint |
| T | switch camera |
| M | map and teleport |
| P | take a photo |
| H | controls |
| Esc | pause: settings, character, plot name, share codes, achievements |

## Code map

| File | Purpose |
| --- | --- |
| `js/blocks.js` | block registry, shapes, procedural texture atlas. Ids are saved, so only append new blocks. |
| `js/world.js` | world grid, plots and districts, lighting (sun + lamps), raycast, plot save format |
| `js/city.js` | procedural Lagos: roads, plaza, buildings, market, park, beach |
| `js/mesher.js` | chunk meshing with face culling, ambient occlusion and smooth lighting |
| `js/render.js` | shaders (voxels, sky, ocean, characters) and the day/night maths |
| `js/player.js` | movement, collision against shapes, step-up, swimming, flight |
| `js/characters.js` | blocky avatar and resident models, character creator preview |
| `js/npcs.js`, `js/vehicles.js` | residents and traffic |
| `js/prefabs.js` | blueprints, structure rotation, isometric previews and icons |
| `js/audio.js` | WebAudio sound effects and ambience (no audio files) |
| `js/minimap.js`, `js/touch.js`, `js/ui.js` | HUD, map, touch controls, menus |
| `js/achievements.js`, `js/storage.js` | achievements, weekly challenge, local saves |
| `js/main.js` | scene setup, input, building rules, edits and undo, game loop |

`window.__naija` exposes internals for automated testing.

## Roadmap

1. **Phase 1 (this):** playable prototype.
2. **Phase 2 - Online Naijacraft:** Supabase auth (Google/email) and cloud saves, automatic plot
   assignment, Cloudflare Durable Objects for live multiplayer, server-side permission checks, chat,
   mute/block/report.
3. **Phase 3 - Growing city:** more districts, co-building, player shops, community voting on the weekly
   challenge, events.

Permissions in `canEdit()` (`js/main.js`) are client-side today. In Phase 2 the server must be the
authority on every block edit.
