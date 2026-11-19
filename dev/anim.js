import * as THREE from 'three';
import { loadMageModel, MageInstance } from '../src/character/characterModel.js';
import * as C from '../src/character/clips.js';

// Dev viewer: ?state=idle|run|strafe|back|air|fall|roll|dash|slam|leap|death|bolt|orb|ult&t=0.2&yaw=0
const q = new URLSearchParams(location.search);
const W = innerWidth, H = innerHeight;
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(W, H); document.body.appendChild(r.domElement);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8899aa);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 6, 4); scene.add(sun);
const grid = new THREE.GridHelper(10, 20, 0x334433, 0x445544); scene.add(grid);
const tmpl = await loadMageModel('/models/' + (q.get('model') || 'pyro') + '.glb');
const states = (q.get('states') || q.get('state') || 'idle').split(',');
const times = (q.get('t') || '0.3').split(',').map(Number);
const views = (q.get('views') || '0').split(',').map(Number);
const cols = states.length * times.length;
const insts = [];
let i = 0;
for (const st of states) for (const t of times) {
  const m = new MageInstance(tmpl); scene.add(m.root); if (q.get('lay') === 'z') m.root.position.z = (i - (cols - 1) / 2) * -1.5; else m.root.position.x = (i - (cols - 1) / 2) * 1.4; insts.push({ m, st, t }); i++;
}
function sim(inst) {
  const { m, st, t } = inst;
  const a = m.anim;
  const s = { pos: m.root.position.clone(), yaw: 0, pitch: +(q.get('pitch') || 0), vel: new THREE.Vector3(), grounded: true };
  const spd = +(q.get('speed') || 6.4);
  const vel = { run: [0, 0, spd], strafe: [spd, 0, 0], back: [0, 0, -spd], diag: [spd * 0.7, 0, spd * 0.7], jog: [0, 0, 3] }[st];
  if (vel) s.vel.set(...vel);
  if (st === 'air') { s.grounded = false; s.vel.set(0, 5, 3); }
  if (st === 'fall') { s.grounded = false; s.vel.set(0, -8, 3); }
  const dtt = 1 / 60;
  let tt = 0;
  // settle
  for (let k = 0; k < 60; k++) { a.update(dtt, s); }
  if (['roll', 'dash', 'slam', 'leap'].includes(st)) a.play(st, { dir: 0 });
  if (st === 'rollback') a.play('roll', { dir: Math.PI });
  if (st === 'death') a.play('die');
  if (st === 'bolt') a.play('cast', { anim: 'boltR' });
  if (st === 'orb') a.play('cast', { anim: 'orb' });
  if (st === 'ult') a.play('cast', { anim: 'ult' });
  if (st === 'mbolt') a.play('cast', { anim: 'mBolt' });
  if (st === 'mraise') a.play('cast', { anim: 'mRaise' });
  if (st === 'mblink') a.play('cast', { anim: 'mBlink' });
  if (['plant', 'nova', 'exhausted'].includes(st)) a.play(st);
  if (st === 'fidget') a.castA = { def: { clip: a.rig.hasProp ? C.FIDGET_M : C.FIDGET_P, in: 0.3, out: 0.4, fidget: true }, t: 0, w: 0 };
  if (st === 'respawn') a.play('respawn');
  if (st === 'djump') { s.grounded = false; s.vel.set(0, 6, 3); for (let k = 0; k < 10; k++) a.update(dtt, s); a.play('doubleJump', { dir: 0 }); }
  if (['kick', 'stomp', 'adolla', 'skate', 'uppercut', 'zeroburn', 'ray', 'freeze'].includes(st)) a.play(st);
  if (['lance', 'freezeCast', 'jabR', 'jabL'].includes(st)) a.play('cast', { anim: st });
  if (['gBlue', 'gRed', 'boltL'].includes(st)) a.play('cast', { anim: st });
  if (['purple', 'domain', 'm1a', 'm1b', 'm1c', 'm1d'].includes(st)) a.play(st);
  if (st === 'mbolt2') { a.play('cast', { anim: 'mBolt' }); for (let k = 0; k < 20; k++) a.update(dtt, s); a.play('cast', { anim: 'mBolt' }); }
  if (st === 'hitf') a.play('hit', { dir: 0, dmg: 30 });
  if (st === 'hitl') a.play('hit', { dir: 1.57, dmg: 30 });
  const n = Math.round(t / dtt);
  const walk = q.get('move') ? s.vel.clone() : new THREE.Vector3();
  const home = m.root.position.clone();
  for (let k = 0; k < n; k++) {
    a.update(dtt, s);
    if (st === 'air' || st === 'fall' || st === 'djump') { s.vel.y -= 18 * dtt; walk.y = s.vel.y; }
    m.root.position.addScaledVector(walk, dtt); s.pos.copy(m.root.position);
    m.root.rotation.y = a.yawOffset; m.root.updateMatrixWorld(true); m.stepCape(dtt);
  }
  m.root.position.copy(home);
  m.root.rotation.y = a.yawOffset;
}
if (q.get('wcol')) for (const { m } of insts) m.model.traverse((o) => {
  if (!o.isSkinnedMesh || o.userData.outline) { if (o.isSkinnedMesh) o.visible = false; return; }
  const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
  const pal = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800, 0x88ff00, 0x0088ff, 0xff0088, 0x8800ff, 0x00ff88, 0x884400, 0x448800, 0x004488, 0x880044, 0xffffff, 0x888888, 0x444444, 0xaa66ff, 0x66ffaa, 0xffaa66, 0x222288, 0x228822];
  const c = new Float32Array(si.count * 3), col = new THREE.Color();
  for (let i = 0; i < si.count; i++) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } } col.setHex(pal[bi % pal.length]); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  o.geometry.setAttribute('color', new THREE.BufferAttribute(c, 3));
  o.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
});
if (q.get('only')) { const keep = q.get('only').split(','); for (const { m } of insts) m.model.traverse((o) => { if (o.isMesh) o.visible = keep.some((k) => o.name.startsWith(k)); }); }
if (!q.get('bind')) insts.forEach(sim);
if (q.get('skel')) for (const { m } of insts) { const h = new THREE.SkeletonHelper(m.model); h.material.depthTest = false; h.material.linewidth = 2; scene.add(h); }
let vi = 0;
const vw = W / views.length;
r.setScissorTest(true);
for (const v of views) {
  const cam = new THREE.PerspectiveCamera(30, vw / H, 0.05, 100);
  const d = Math.max(4.5, cols * 1.6);
  const a = v * Math.PI / 180;
  const zy = +(q.get('zy') || 0.85), zd = +(q.get('zd') || 1);
  cam.position.set(Math.sin(a) * d * zd, zy + 0.55 * zd, Math.cos(a) * d * zd); cam.lookAt(0, zy, 0);
  r.setViewport(vi * vw, 0, vw, H); r.setScissor(vi * vw, 0, vw, H); r.render(scene, cam); vi++;
}
for (const { m, st } of insts) { m.root.updateMatrixWorld(true); const r = m.rig; if (r.ends.prop) { const a = r.bones[22].getWorldPosition(new THREE.Vector3()), b = r.ends.prop.getWorldPosition(new THREE.Vector3()); const h = r.bones[13].getWorldPosition(new THREE.Vector3()), f = r.bones[12].getWorldPosition(new THREE.Vector3()); console.log('LOG', st, 'staffdir', b.sub(a).normalize().toArray().map((x) => x.toFixed(2)).join(','), 'forearm', h.sub(f).normalize().toArray().map((x) => x.toFixed(2)).join(','), 'rooty', m.root.rotation.y.toFixed(2)); } }
document.getElementById('ui').textContent = states.join(',') + ' t=' + times.join(',');
if (q.get("dbgcape")) for (const { m } of insts) { const r = m.rig; const c = r.bones[23]; const s = new THREE.Vector3(), p = new THREE.Vector3(), qq = new THREE.Quaternion(); c.matrixWorld.decompose(p, qq, s); console.log("LOG cape", c.name, p.toArray().map((x) => x.toFixed(2)).join(","), "scale", s.toArray().map((x) => x.toFixed(3)).join(","), "q", qq.toArray().map((x) => x.toFixed(2)).join(","), "local", c.quaternion.toArray().map((x) => x.toFixed(2)).join(",")); m.model.traverse((o) => { if (o.isSkinnedMesh && o.name.startsWith("cape")) console.log("LOG capemesh", o.name, o.visible, o.material.visible, o.material.opacity); }); }
window.__insts = insts; window.__THREE = THREE;
window.done = true;
