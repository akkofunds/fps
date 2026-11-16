# Credits

## Pyro character model
`public/models/pyro.glb` is built from the character GLB provided by the project owner
(`tools/characters/src/fire_original.glb`). Changes: the fire aura mesh and emissive map were removed,
the outfit was slimmed, the model was converted to Y-up meters, and it was auto-rigged with a 22-bone
skeleton and skin weights (`tools/characters/rig_pyro.py`).

Check that the original model's license allows your use before you publish the game commercially.

## Meteora character model
`public/models/meteora.glb` is built from a GLB provided by the project owner (`tools/characters/src/meteora_original.glb`,
a fan model of Megumin from *KonoSuba*). Changes: the model was baked to Y-up meters, auto-rigged (22 bones plus staff
and cape bones), the staff was shortened by 25% and the windblown cape folded in. The character is someone else's
intellectual property and the model's license is unknown, so don't use it commercially without permission.

## Everything else
The terrain, vegetation, ruins, sky, water, VFX, animations and all audio are generated procedurally in code.

## Shoto model
`public/models/shoto.glb` is auto-rigged by `tools/characters/rig_shoto.py` from a user-supplied model
(`tools/characters/src/shoto_original.glb`) that appears to be a fan-made model of an existing anime
character. As with Meteora: fine for a private/hobby build, but replace it with an original or properly
licensed model before any public or commercial release.
