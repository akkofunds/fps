import * as THREE from 'three';
import { loadMageModel, MageInstance } from '../src/character/characterModel.js';
import { B } from '../src/character/rig.js';

// Clipping check: plays every animation of a mage and measures how close the held prop (staff /
// spear) and the hands come to the body. Reports the worst penetrations per animation.
const q = new URLSearchParams(location.search);
const model = q.get('model') || 'meteora';
const tmpl = await loadMageModel('/models/' + model + '.glb');
const m = new MageInstance(tmpl);
const a = m.anim;
const P = (i) => m.rig.bones[i].getWorldPosition(new THREE.Vector3());
const segDist = (p, a0, b0) => { const ab = b0.clone().sub(a0), t = Math.max(0, Math.min(1, p.clone().sub(a0).dot(ab) / ab.lengthSq())); return p.distanceTo(a0.clone().addScaledVector(ab, t)); };
const segSeg = (a0, a1, b0, b1, n = 24) => { let best = 9, at = 0; for (let i = 0; i <= n; i++) { const u = i / n, p = a0.clone().lerp(a1, u), d = segDist(p, b0, b1); if (d < best) { best = d; at = u; } } return [best, at]; };
// body capsules: [from, to, radius]
const CAPS = [['hips', 'chest', 0.13], ['chest', 'neck', 0.13], ['neck', 'head', 0.07], ['upperLegL', 'lowerLegL', 0.08], ['upperLegR', 'lowerLegR', 0.08], ['lowerLegL', 'footL', 0.06], ['lowerLegR', 'footR', 0.06]];
const states = (q.get('states') || '').split(',').filter(Boolean);
const out = [];
const s = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), grounded: true };
const prop = m.rig.ends && m.rig.ends.prop;
for (const st of states) {
  for (let k = 0; k < 60; k++) a.update(1 / 60, s);
  const [kind, arg] = st.split(':');
  if (kind === 'cast') a.play('cast', { anim: arg }); else if (kind === 'run') s.vel.set(0, 0, 6.4); else a.play(kind, { dir: 0 });
  let worst = { d: 9 };
  for (let f = 0; f < 150; f++) {
    a.update(1 / 60, s); m.root.updateMatrixWorld(true);
    // hands sinking into the torso (palm centre vs a slimmer torso capsule)
    for (const hn of ['handL', 'handR']) {
      const hp = P(B[hn]);
      const d = segDist(hp, P(B.hips), P(B.neck)) - 0.1;
      if (d < worst.d) worst = { d, t: (f / 60).toFixed(2), part: hn + ' in torso' };
    }
    if (!prop) continue;
    const s0 = P(B.handR), s1 = prop.getWorldPosition(new THREE.Vector3());
    // the staff extends both ways from the hand: tip side and butt side
    const butt = s0.clone().addScaledVector(s1.clone().sub(s0), -0.55);
    for (const [seg0, seg1] of [[s0, s1], [s0, butt]]) for (const [fa, fb, r] of CAPS) {
      const [d, u] = segSeg(seg0, seg1, P(B[fa]), P(B[fb]));
      if (u < 0.08) continue; // right at the gripping hand: allowed
      const pen = d - r;
      if (pen < worst.d) worst = { d: pen, t: (f / 60).toFixed(2), part: `${fa}-${fb}` };
    }
  }
  s.vel.set(0, 0, 0);
  out.push(`${st.padEnd(14)} ${worst.d < 0 ? 'CLIPS' : 'ok   '} ${worst.d.toFixed(3)} m ${worst.part || ''} @${worst.t || ''}s`);
}
document.getElementById('out').textContent = out.join('\n');
console.log('LOG\n' + out.join('\n'));
window.done = true;
