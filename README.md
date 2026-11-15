# MAGEBREAK — elemental arena brawler

A third-person, shift-lock arena brawler that runs in the browser: Three.js rendering, PeerJS (WebRTC)
peer-to-peer multiplayer, a Valorant-style lobby, and a golden-hour meadow map. The first mage is **Pyro**.

## Modes
- **Free-For-All queue**: real players only (no bots). The match starts when 8 players are in, or about
  20 seconds after a second player joins. The first to 20 eliminations wins (8 minute limit).
- **Custom**: the party leader picks the kill limit and time limit, and the whole party joins.
- **Practice**: a solo range with static training dummies that regenerate their health.

## Pyro — Flamecaller
| Key | Ability | What it does |
| --- | --- | --- |
| `LMB` | Ember Bolt | Alternating fire punches that launch bolts (18 damage, 27 on a headshot) |
| `Q` | Flare Step | Dash with 2 charges. If you dash in the air, you **roll when you land** |
| `E` | Blaze Orb | A fireball that arcs, then explodes and burns (7 s cooldown) |
| `C` | Firewall | Slams the ground and raises a 7 m wall of fire where you aim (15 s cooldown) |
| `V` | Flame Leap | A blast under your feet launches you up and knocks enemies back (10 s cooldown) |
| `X` | Meteor (ultimate) | A telegraphed meteor strike that leaves the ground burning. It costs 100 points, which you earn from damage, kills and time |

Other controls: `WASD` to move, `Space` to jump, `RMB` to focus aim, `Tab` for the scoreboard, `Enter` for chat
and `Esc` for the menu. To invite friends, type their `Name#1234` tag in the sidebar.

## Meteora — Crimson Archmage
| Key | Ability | What it does |
| --- | --- | --- |
| `LMB` | Crimson Spark | Staff bolt that bursts on impact (16 damage + 10 splash) |
| `Q` | Flare Step | Same dash as everyone (2 charges, air dash → landing roll) |
| `E` | Starfall | A small star falls on the targeted spot after a short delay (8 s cooldown) |
| `C` | Blast Sigil | Explosive rune trap on the ground, up to 2 at a time (11 s cooldown) |
| `V` | Blink | Teleport up to 10 m, leaving an explosion behind you (9 s cooldown) |
| `X` | Crimson Nova (ultimate) | A 2.35 s chant stacks five magic circles over the target, then a colossal blast deals 400 → 160 damage across 18 m, ignoring cover. Afterwards she collapses for 3.3 s and can't act |

## Mobile
Touch devices get a floating joystick (left side), drag-to-aim (right side; dragging from the fire button
also aims), buttons for every ability, and a compact lobby with a party/friends drawer. Play in landscape.

## Admin (`/admin`)
The admin panel is built into the normal client: open `yoursite/admin`, then enter the admin code and
answer the security question. It has a balance editor (HP, speed, gravity, damage, cooldowns, ult charge,
respawn, no-cooldowns/infinite-ult/god-mode cheats) that applies only to Custom and Practice lobbies you
host, an animation viewer, an FPS/draw-call meter, a custom PeerJS server setting, and data tools.
**This check runs in the browser, so it is not real security.** Anyone who reads the JavaScript can find the
code and the answer. It only keeps casual visitors out.

## Graphics
Presets: Low, Medium, High and **Ultra** (2× supersampling, so 4K on a 1080p screen, 8× MSAA, ambient
occlusion, 4096 px shadows). The Render resolution setting goes up to 200%. Medium and higher add bloom,
MSAA and colour grading.

## Animation
Both models came as static meshes. `tools/characters/rig_pyro.py` auto-rigs Pyro (22 bones, per-part
weights, fire aura removed, outfit slimmed). `tools/characters/rig_meteora.py` rigs Meteora from a mid-air pose
using geodesic (surface-distance) skin weights, a staff bone and a cape bone. At runtime:
- **Locomotion is procedural and phase-synced.** Each foot follows a stance/swing path whose stance slides
  back at exactly the body's speed, so feet never skate, in any direction. Two-bone IK plants the feet on
  the terrain. When you stand still, the feet stay locked in place and step when you turn.
- **Layers** (`src/character/animator.js`): air poses blended by vertical speed, keyframed full-body clips
  (dash, forward and back rolls, Firewall slam, Flame Leap, death), masked upper-body casts (alternating
  punches, the orb push, the meteor call), a landing-dip spring, hit flinches, breathing, and aim pitch spread
  over the spine.
- `dev/anim.html` previews any state: `/dev/anim.html?states=run,roll,slam&t=0.3&views=0,90`.

## Map: Sunvale
A procedural meadow with rolling hills, about 60k wind-swept grass tufts that bend around players,
wildflowers, swaying low-poly trees, a shallow lake you can wade through, a ruined stone plaza with a fire
altar, a watchtower on a hill, arches, walls and logs for cover, a cloud dome, distant mountains and pollen.
You can preview it with `dev/map.html`.

## Development
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```
**Deploy on Vercel:** import the repo. Vite is detected automatically (`vercel.json` sets the build to `dist/`).

Multiplayer uses the free public PeerJS broker (`0.peerjs.com`) for signaling only. Gameplay traffic goes
directly between browsers. To use your own broker, add `?peerhost=host&peerport=443&peerpath=/` to the URL.

Graphics presets (Low, Medium, High) are chosen from your GPU on the first run and can be changed in
Settings. Medium and High add soft shadows and bloom.

## Layout
```
src/character/   rig (canonical retargeting), pose math + IK, clips, animator, model loader
src/world/       terrain heightfield, sky, water, grass/flowers, props/ruins, collision world, map
src/fx/          particle pools + fire effects (bolts, orb, explosions, walls, meteor, burning)
src/game/        movement physics, shoulder camera, Pyro kit, projectiles, match runtime, host rules, matchmaking
src/network/     PeerJS identity/party + host/client sessions
src/ui/          lobby, lobby 3D scene, HUD, chat, icons, styles
tools/characters rigging pipeline (Python: numpy + Pillow)
```
