import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadMageModel, MageInstance } from '../src/character/characterModel.js';

// Dev: Inkweaver jumping on a loop, with the chest spring-damper running, so the secondary motion
// can be judged in isolation (/dev/jiggle.html). Jump = take-off squat, a real ballistic arc (same
// gravity as the game), landing impact; the game's own jump / land animations drive the body.
const W = innerWidth, H = innerHeight;
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(W, H); r.setPixelRatio(Math.min(2, devicePixelRatio)); document.body.appendChild(r.domElement);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a3040);
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x334455, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 5, 4); scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshLambertMaterial({ color: 0x3a4257 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 100); cam.position.set(1.4, 1.5, 2.6);
const ctl = new OrbitControls(cam, r.domElement); ctl.target.set(0, 1.25, 0); ctl.update();

const tmpl = await loadMageModel('/models/inkweaver.glb');
const m = new MageInstance(tmpl); scene.add(m.root);
const s = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), grounded: true };
const G = -24, VJ = 8.2;          // game-like gravity and jump speed
let vy = 0, airJumps = 0, auto = true, nextAuto = 0.8, t = 0;
const $ = (id) => document.getElementById(id);
const jump = () => {
  if (s.grounded) { vy = VJ; s.grounded = false; airJumps = 1; m.anim.play('jumpStart'); }
  else if (airJumps > 0) { vy = VJ * 0.9; airJumps--; m.anim.play('doubleJump', { dir: 0 }); }
};
$('jump').onclick = jump;
$('dbl').onclick = () => { jump(); setTimeout(jump, 330); };
$('loop').onclick = () => { auto = !auto; $('loop').textContent = 'Auto-jump: ' + (auto ? 'on' : 'off'); };
$('on').onchange = () => { if (!$('on').checked) { m.jiggle.reset(); for (const sp of m.jiggle.springs) sp._apply(); } };
$('str').oninput = () => { m.jiggle.strength = +$('str').value; $('sv').textContent = (+$('str').value).toFixed(2); };
$('slow').oninput = () => { $('slv').textContent = (+$('slow').value).toFixed(2); };
addEventListener('keydown', (e) => { if (e.code === 'Space') jump(); });

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) * +$('slow').value; last = now; t += dt;
  // the body: a ballistic jump with a landing
  if (!s.grounded) {
    vy += G * dt; s.pos.y += vy * dt;
    if (s.pos.y <= 0) { m.anim.play('land', { vy }); s.pos.y = 0; vy = 0; s.grounded = true; nextAuto = t + 1.3; }
  } else if (auto && t > nextAuto) jump();
  s.vel.set(0, vy, 0);
  m.root.position.copy(s.pos);
  m.anim.update(dt, s);
  if ($('on').checked) m.stepCape(dt); else m.root.updateMatrixWorld(true);
  const sp = m.jiggle.springs.find((x) => x.bone.name === 'breast_L');
  $('read').textContent = `y ${s.pos.y.toFixed(2)} m · vy ${vy.toFixed(1)} · chest offset ${(sp.p.y * 100).toFixed(1)} cm`;
  r.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__jiggle = m.jiggle;
