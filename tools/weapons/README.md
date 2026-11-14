# Weapon pipeline

Turns the source Sketchfab GLBs into the game-ready first-person rigs in `public/models/`.

```
source/{ak,glock,sniper}.glb   (not committed — put the original downloads here)
  └─ parts.mjs   bake transforms, normalize (barrel → -Z, +Y up, meters), split mesh islands
  └─ guns.mjs    per-gun orientation/scale + which source parts go to which group
  └─ rigs.mjs    pivots, hand placement, ADS sight marker, eye relief, and all animation keys
  └─ build.mjs   pivot nodes, generated gloved arms, markers, baked clips, 1024 px WebP, meshopt
```

Each output GLB has a `weapon` root, animatable nodes (`mag`, `charge`/`slide`, `bolt`/`boltback`,
`trigger`, `arm_L`, `arm_R`), markers (`muzzle`, `eject`, `sight`, `reddot`) and clips
(`draw`, `fire`, `reload`, `inspect`, plus `bolt` on the sniper). The game scrubs clips by gameplay
progress, so changing a reload time in `weaponDefs.js` and the clip duration in `rigs.mjs` keeps them in sync.

```bash
cd tools/weapons
npm install
npm run build
```
