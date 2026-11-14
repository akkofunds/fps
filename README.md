# RIFTLINE — browser tactical FPS

A complete tactical shooter that runs in the browser: Three.js rendering, PeerJS (WebRTC) peer-to-peer
multiplayer, Source-style bunny hopping, and a performance budget aimed at 60 FPS on school Chromebooks and phones.

**Play:** once GitHub Pages is enabled (see below), the game is at `https://<owner>.github.io/<repo>/`.

## Features

- **Lobby & social:** dark tactical UI, live 3D rotating agent holding the AK, `Name#1234` tags saved in
  `localStorage` and registered as your PeerJS ID. Invite friends by tag, accept or decline invites, see
  party members next to you, pick the map together (anyone can pick; the leader starts games), and party chat.
- **PLAY (matchmaking):** 1v1 Duel, 2v2 Wingman and Free-For-All. A top-center queue timer pairs live players
  through well-known queue-slot IDs on the PeerJS broker. Empty seats fill with combat bots after 15 seconds.
- **CUSTOM GAME:** the party leader hosts any mode or map with toggles for *Bhop Speed Boost*, *Headshots Only*
  and *Bot Fill*. Party members are pulled in automatically.
- **Networking:** host-authoritative star topology. State syncs at 30 Hz with 100 ms snapshot interpolation.
  Hit detection runs on the shooter's side and the host validates it. Tracers, kill feed, scoreboard, round flow
  and in-game chat (`Enter` all, `Shift+Enter`/`U` team; lines fade after 6 s) are all synced.
- **Maps** (each static map is one merged, vertex-colored draw call):
  - *The Range:* concrete and wood practice facility with a physical training console (STATIC / STRAFE /
    50-BOT SPEED TEST plus START) that you shoot or press `E` on. It has a live timer, headshot % and
    accuracy, a best-time record, 10/20/30/50 m markers, a recoil spray wall and a movement course.
  - *Piazza:* a warm-plaster 2-site map with stone archways, a mid courtyard with a climbable box,
    destructible/penetrable wooden crates on A, and clean angles on B.
  - *Atrium:* a white-stone and teal open plaza with sloped ramps, colonnades, raised sniper terraces and
    sightlines over 45 m.
- **Weapons:**
  - AK-47: 160 HS / 40 body, with a deterministic spray (climbs vertically, then sways left and right) and
    first-shot accuracy when standing or counter-strafed.
  - Glock-17: fastest movement, 56 / 24 damage, right-click toggles a 3-round burst.
  - Sniper: 150 damage, inaccurate hip-fire, right-click cycles a 1.5x → 3.0x scope.
  - All three have viewmodel sway, recoil kick, muzzle flash, shell ejection and reload/bolt animations.
- **Movement:** Source air-acceleration with auto-bhop (hold `Space`: the jump fires on the exact landing tick,
  before friction runs), air-strafing past 250 UPS (450+ with practice, 500+ with Boost), crisp ground friction
  for counter-strafing, and a live UPS speedometer.
- **Input:** detected automatically. Mouse/keyboard uses Pointer Lock with raw input. Touch gets a floating
  joystick, drag-to-aim, an Auto-Fire toggle and thumb buttons. It switches live if you change device.

## Controls (keyboard & mouse)

| Key | Action |
| --- | --- |
| `WASD` | Move |
| `Space` (hold) | Jump / auto-bhop |
| `Shift` | Silent walk |
| `Ctrl` / `C` | Crouch |
| `1` `2` `3` / wheel / `Q` | AK-47 / Glock / Sniper |
| Left click | Fire |
| Right click | Aim down sights (hold; toggle in Settings). Sniper: scope 1.5x → 3.0x → hip |
| `X` | Glock semi / 3-round burst |
| `F` | Inspect weapon |
| `R` | Reload |
| `B` | Buy menu |
| `Tab` | Scoreboard |
| `Enter` | Chat (`Shift+Enter` team) |
| `E` | Press Range console buttons |
| `Esc` | Release mouse / pause |

## First-person weapons

Real textured GLB guns (`public/models`, ~2 MB total) with gloved arms and baked animations:
reload (mag out/in, charging handle / slide rack), draw, inspect (`F`), per-shot charging-handle/slide
cycling, Glock slide lock on empty, and a full sniper bolt cycle with the hand on the bolt.
**ADS** on all three: AK iron sights, Glock red dot with a live reticle, and a custom sniper ADS where
the scope rises to the eye before the blacked-out overlay fades in (1.5x → 3.0x). Aiming tightens spread
and slows movement. Rebuild the assets with `tools/weapons` — see [CREDITS.md](CREDITS.md) for model licenses.

## Performance architecture

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.0))`, `antialias: false`, no shadow maps, no post-processing.
  An optional render-scale setting (100/75/50 %) is there for very old devices.
- `MeshLambertMaterial` with flat shading, one `HemisphereLight` + one `DirectionalLight`, and baked vertex-color AO.
- All static geometry is merged with `BufferGeometryUtils.mergeGeometries()`. A typical frame is 12–13 draw calls:
  map, labels, crates, 3 instanced character meshes, tracers, decals, sparks and the viewmodel.
- Bullets, tracers, decals, sparks and shell casings are pre-allocated pools with no per-shot allocation.
- 60 FPS frame cap (frames are skipped on 90/120/144 Hz screens), a fixed 60 Hz physics tick with render
  interpolation, and HUD DOM writes that only happen when a value changes.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

Multiplayer uses the free public PeerJS broker (`0.peerjs.com`) for signaling only. Gameplay traffic goes directly
between browsers over WebRTC. If a network blocks the broker, the game still works offline against bots. To use
your own broker, add `?peerhost=your.host&peerport=443&peerpath=/` to the URL.

## Deploying

`.github/workflows/deploy.yml` builds with Vite (`base: './'`) and publishes `dist/` to GitHub Pages on every push
to `main`. You need to do this once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Project layout

```
index.html
src/main.js                 app shell, 60 FPS loop, lobby ⇄ match
src/config.js               tuning constants
src/core/                   input, audio (procedural WebAudio), storage, emitter
src/network/peerManager.js  PeerJS identity, tags, party + invites
src/network/matchNet.js     host/client match sessions
src/physics/                collision world + Source-style bhopController
src/weapons/                weapon defs, weaponSystem (spray/recoil/burst/scope), viewmodels
src/maps/                   map builder, The Range, Piazza, Atrium, auto nav-graph
src/entities/               instanced character renderer, bot AI
src/effects/pools.js        tracer / decal / spark pools
src/game/                   match runtime, host rules, Range drills, matchmaking sessions
src/ui/                     lobby, lobby 3D scene, HUD, chat, touch controls, styles
```
