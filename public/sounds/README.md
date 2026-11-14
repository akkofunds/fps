Drop real gunshot recordings here to replace the synthesized ones, then list them in `manifest.json`:

```json
{ "ak": "ak.mp3", "ak_far": "ak_far.mp3", "glock": "glock.mp3", "glock_far": "glock_far.mp3", "sniper": "sniper.mp3", "sniper_far": "sniper_far.mp3" }
```

Any name in `src/core/audio.js` can be overridden (`reload`, `bolt`, `step`, `hit`, `head`, …).
Only use files you have the rights to (CC0 or your own recordings).
