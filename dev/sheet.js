import * as THREE from 'three';
import { loadMageModel, MageInstance } from '../src/character/characterModel.js';

// Dev: a contact sheet of a mage's animations. ?model=sorcerer&states=m1a@0.12,run@0.4,cast:gRed@0.3&cols=6&yaw=30
// state: an action name, 'run', 'air' or 'cast:<name>'; @t = seconds into it
const q = new URLSearchParams(location.search);
const W = innerWidth, H = innerHeight;
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(W, H); document.body.appendChild(r.domElement);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8899aa);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 6, 4); scene.add(sun);
scene.add(new THREE.GridHelper(6, 12, 0x334433, 0x445544));
const tmpl = await loadMageModel('/models/' + (q.get('model') || 'pyro') + '.glb');
const list = (q.get('states') || 'idle@0.3').split(',');
const cols = +(q.get('cols') || 6), rows = Math.ceil(list.length / cols);
const cw = W / cols, ch = H / rows, yaw = +(q.get('yaw') || 25) * Math.PI / 180;
r.setScissorTest(true);
const lab = document.getElementById('lab');
list.forEach((st, i) => {
  const [name, ts] = st.split('@'), t = +(ts || 0.3);
  const m = new MageInstance(tmpl); scene.add(m.root);
  const a = m.anim, s = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), grounded: true };
  for (let k = 0; k < 60; k++) a.update(1 / 60, s);
  const [kind, arg] = name.split(':');
  if (kind === 'cast') a.play('cast', { anim: arg });
  else if (kind === 'run') s.vel.set(0, 0, 6.4);
  else if (kind === 'air') { s.grounded = false; s.vel.set(0, 4, 3); }
  else if (kind !== 'idle') a.play(kind, { dir: 0 });
  for (let k = 0; k < Math.round(t * 60); k++) { if (kind === 'run') s.pos.addScaledVector(s.vel, 1 / 60); a.update(1 / 60, s); }
  m.root.position.set(0, 0, 0);
  const cam = new THREE.PerspectiveCamera(30, cw / ch, 0.05, 100);
  cam.position.set(Math.sin(yaw) * 4.6, 1.5, Math.cos(yaw) * 4.6); cam.lookAt(0, 0.95, 0);
  const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
  r.setViewport(x, y, cw, ch); r.setScissor(x, y, cw, ch); r.render(scene, cam);
  scene.remove(m.root);
  const d = document.createElement('div'); d.style.left = (x + 4) + 'px'; d.style.top = (H - y - ch + 2) + 'px'; d.textContent = st; lab.appendChild(d);
});
window.done = true;
