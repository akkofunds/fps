import * as THREE from 'three';
import { loadMageModel, MageInstance } from '../src/character/characterModel.js';
import { compileClip } from '../src/character/pose.js';

// Dev: render several full-body pose variants side by side.
// ?model=manipulator&poses=[{...bones},{...}]  (JSON, URL-encoded) &yaw=0 &zy=1.25 &d=3
const q = new URLSearchParams(location.search);
const W = innerWidth, H = innerHeight;
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(W, H); document.body.appendChild(r.domElement);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8899aa);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 6, 4); scene.add(sun);
const tmpl = await loadMageModel('/models/' + (q.get('model') || 'manipulator') + '.glb');
const poses = JSON.parse(q.get('poses') || '[{}]');
const yaws = (q.get('yaws') || '0').split(',').map(Number);
const n = poses.length;
const vw = W / n, vh = H / yaws.length;
r.setScissorTest(true);
const insts = poses.map((b) => {
  const m = new MageInstance(tmpl); scene.add(m.root);
  const s = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), grounded: true };
  for (let k = 0; k < 30; k++) m.anim.update(1 / 60, s);
  m.anim.play('mnChin');
  m.anim.action.def = { ...m.anim.action.def, clip: compileClip([{ t: 0, b }, { t: 5, b }]) };
  for (let k = 0; k < 60; k++) m.anim.update(1 / 60, s);
  m.root.visible = false;
  m.root.updateMatrixWorld(true);
  const pw = m.palmWorld('R', new THREE.Vector3()), tip = m.rig.ends.handR.getWorldPosition(new THREE.Vector3());
  (window.__palms = window.__palms || []).push([pw.toArray().map((v) => +v.toFixed(3)), tip.toArray().map((v) => +v.toFixed(3))]);
  return m;
});
const zy = +(q.get('zy') || 1.25), d = +(q.get('d') || 2.6);
insts.forEach((m, i) => {
  m.root.visible = true;
  yaws.forEach((yd, j) => {
    const cam = new THREE.PerspectiveCamera(30, vw / vh, 0.05, 100);
    const a = yd * Math.PI / 180;
    cam.position.set(Math.sin(a) * d, zy + 0.2, Math.cos(a) * d); cam.lookAt(0, zy, 0);
    r.setViewport(i * vw, (yaws.length - 1 - j) * vh, vw, vh); r.setScissor(i * vw, (yaws.length - 1 - j) * vh, vw, vh); r.render(scene, cam);
  });
  m.root.visible = false;
});
document.getElementById('ui').textContent = poses.map((p, i) => i + ': ' + JSON.stringify(p)).join(' | ').slice(0, 400);
window.done = true;
