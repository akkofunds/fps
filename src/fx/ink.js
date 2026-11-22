import * as THREE from 'three';
import { Fx } from './fire.js';
import { GLOSS } from './glossy.js';
import { groundH } from '../world/terrain.js';

// INKWEAVER's golden ink: black ink-wash strokes edged with gold light. Wings of brushed feathers,
// a Tai Chi array, a vortex of condensed ink, talismans that come down as pillars of light.
// Every texture is painted in code (canvas); every effect cleans itself up.

const R = Math.random;
const UP = new THREE.Vector3(0, 1, 0);
const GOLD = [2.4, 1.7, 0.55, 1], GOLD0 = [0.9, 0.45, 0.05, 0], INKC = [0.03, 0.025, 0.02, 0.85], INK0 = [0.05, 0.04, 0.03, 0];
const _v = new THREE.Vector3();

// ------------------------------------------------------------------ painted textures
const TEX = {};
function canvasTex(key, w, h, paint) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (TEX[key] = t);
}
// The wings themselves are cut straight from the reference art (public/fx/wing_l.png / wing_r.png,
// tools/fx/cut_wings.py): w × h in metres at her scale, and where the wing meets her spine (ru, rv:
// 0..1 across / down the image). Both images have the root on their left edge.
export const WING = {"L": {"w": 3.375, "h": 2.28, "ru": 0.0, "rv": 0.7149}, "R": {"w": 3.035, "h": 2.165, "ru": 0.0, "rv": 0.612}};
// the backdrop for the front-on shot: the same art with the wings and her taken out (fx/wing_plate.jpg),
// its size in pixels, the art pixel where both wings meet her back, and her height in art pixels
export const PLATE = {"w": 1282, "h": 622, "root": [607, 360], "body_px": 332.0};
// where the wings meet her back, in the wing group's frame
export const WING_ROOT = new THREE.Vector3(0, -0.07, -0.16);
const WTEX = {};
let PLATE_TEX = null;
function plateImg() {
  if (!PLATE_TEX) { PLATE_TEX = new THREE.TextureLoader().load('fx/wing_plate.jpg'); PLATE_TEX.colorSpace = THREE.SRGBColorSpace; }
  return PLATE_TEX;
}
function wingImg(side) {
  if (!WTEX[side]) { WTEX[side] = new THREE.TextureLoader().load(side === 'L' ? 'fx/wing_l.png' : 'fx/wing_r.png'); WTEX[side].colorSpace = THREE.SRGBColorSpace; WTEX[side].anisotropy = 4; }
  return WTEX[side];
}
// soft radial glow (halo light behind her)
function glowTex() {
  return canvasTex('glow', 256, 256, (g, W) => {
    const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    grd.addColorStop(0, 'rgba(255,240,200,1)'); grd.addColorStop(0.25, 'rgba(255,190,90,0.55)'); grd.addColorStop(0.6, 'rgba(255,140,40,0.15)'); grd.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
  });
}
// the Tai Chi array: yin-yang, eight trigrams, rings of script
function taichiTex() {
  return canvasTex('taichi', 1024, 1024, (g, W) => {
    const C = W / 2, r = mulberry(11);
    g.strokeStyle = 'rgba(255,200,90,1)'; g.fillStyle = 'rgba(255,200,90,1)';
    const ring = (rad, w) => { g.lineWidth = w; g.beginPath(); g.arc(C, C, rad, 0, 7); g.stroke(); };
    ring(500, 6); ring(470, 2); ring(330, 5); ring(300, 2); ring(180, 6);
    // script band
    g.font = 'bold 34px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const glyphs = '乾坤震巽坎離艮兌雲墨符天道玄青明';
    for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2; g.save(); g.translate(C + Math.cos(a) * 485, C + Math.sin(a) * 485); g.rotate(a + Math.PI / 2); g.font = 'bold 22px serif'; g.fillText(glyphs[k % glyphs.length], 0, 0); g.restore(); }
    // eight trigrams
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2; g.save(); g.translate(C + Math.cos(a) * 400, C + Math.sin(a) * 400); g.rotate(a + Math.PI / 2);
      for (let l = 0; l < 3; l++) { const broken = (k >> l) & 1; if (broken) { g.fillRect(-46, -26 + l * 22, 38, 12); g.fillRect(8, -26 + l * 22, 38, 12); } else g.fillRect(-46, -26 + l * 22, 92, 12); }
      g.restore();
    }
    // radiating strokes between the rings
    g.lineWidth = 2;
    for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2; g.beginPath(); g.moveTo(C + Math.cos(a) * 190, C + Math.sin(a) * 190); g.lineTo(C + Math.cos(a) * (290 - (k % 2) * 40), C + Math.sin(a) * (290 - (k % 2) * 40)); g.stroke(); }
    // the yin-yang
    const R0 = 165;
    g.fillStyle = 'rgba(255,214,120,1)'; g.beginPath(); g.arc(C, C, R0, -Math.PI / 2, Math.PI / 2); g.arc(C, C + R0 / 2, R0 / 2, Math.PI / 2, -Math.PI / 2, true); g.arc(C, C - R0 / 2, R0 / 2, Math.PI / 2, -Math.PI / 2); g.fill();
    g.fillStyle = 'rgba(20,14,8,0.85)'; g.beginPath(); g.arc(C, C, R0, Math.PI / 2, -Math.PI / 2); g.arc(C, C - R0 / 2, R0 / 2, -Math.PI / 2, Math.PI / 2); g.arc(C, C + R0 / 2, R0 / 2, -Math.PI / 2, Math.PI / 2, true); g.fill();
    g.fillStyle = 'rgba(20,14,8,0.9)'; g.beginPath(); g.arc(C, C - R0 / 2, R0 / 7, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,214,120,1)'; g.beginPath(); g.arc(C, C + R0 / 2, R0 / 7, 0, 7); g.fill();
    void r;
  });
}
// a paper talisman: gold paper, red border, black ink script, glowing seal
function taliTex() {
  return canvasTex('tali', 128, 320, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#ffe08a'); grd.addColorStop(1, '#f3b23a');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c1281c'; g.lineWidth = 7; g.strokeRect(6, 6, W - 12, H - 12);
    g.strokeStyle = '#c1281c'; g.lineWidth = 2; g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = '#1a0f08'; g.font = 'bold 40px serif'; g.textAlign = 'center';
    ['敕', '令', '墨', '符'].forEach((ch, i) => g.fillText(ch, W / 2, 62 + i * 58));
    g.strokeStyle = '#1a0f08'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2, 270); g.quadraticCurveTo(W / 2 + 20, 290, W / 2 - 6, 306); g.stroke();
    g.fillStyle = 'rgba(200,30,20,0.85)'; g.beginPath(); g.arc(W / 2, 250, 14, 0, 7); g.fill();
  });
}
// a shaft of light: soft across, brightest at the foot, fading out toward the top
function beamTex() {
  return canvasTex('beam', 64, 256, (g, W, H) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5, v = (y + 0.5) / H;
      const a = (Math.exp(-((u / 0.17) ** 2)) * 0.7 + Math.exp(-((u / 0.05) ** 2)) * 0.6) * v ** 1.4 * Math.min(1, (1 - v) * 30);
      const i = (y * W + x) * 4, hot = Math.exp(-((u / 0.06) ** 2));
      img.data[i] = 255; img.data[i + 1] = 200 + 55 * hot; img.data[i + 2] = 110 + 145 * hot; img.data[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
  });
}
// a splash of black ink on the ground: a ragged blot with flung droplets and a few brush streaks
function splatTex() {
  return canvasTex('splat2', 256, 256, (g, W) => {
    const C = W / 2, r = mulberry(7);
    // a soft wet blot built from overlapping rounded dabs, darker in the middle
    for (let k = 0; k < 60; k++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * 58, rad = 16 + r() * 26;
      const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(12,9,7,0.5)'); grd.addColorStop(0.7, 'rgba(12,9,7,0.32)'); grd.addColorStop(1, 'rgba(12,9,7,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
    // a few flung drops round the edge
    g.fillStyle = 'rgba(12,9,7,0.75)';
    for (let k = 0; k < 18; k++) { const a = r() * 6.283, d = 84 + r() * 34; g.beginPath(); g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, 1.5 + r() * 3.5, 0, 7); g.fill(); }
  });
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R2 = (r) => r();

// shared geometry
let PLANE = null; const plane = () => PLANE || (PLANE = new THREE.PlaneGeometry(1, 1));
let SPHERE = null; const sphere = () => SPHERE || (SPHERE = new THREE.SphereGeometry(1, 40, 24));
let DOME = null; const dome = () => DOME || (DOME = new THREE.SphereGeometry(1, 48, 24));
let FLAT = null; const flat = () => FLAT || (FLAT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
let BEAM = null; const beamGeo = () => BEAM || (BEAM = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
let PILLAR = null; const pillar = () => PILLAR || (PILLAR = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0));

// the ink sphere: dark swirling ink with gold veins and a hot gold rim
function inkSphereMat() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uT: { value: 0 }, uA: { value: 1 } },
    vertexShader: 'varying vec3 vN, vV, vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */`
      uniform float uT, uA; varying vec3 vN, vV, vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y), mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        float a = atan(vP.z, vP.x) + uT * 3.0 + vP.y * 2.5;
        vec3 q = vec3(cos(a), vP.y * 1.6, sin(a)) * 2.2;
        float s = n(q + uT * 0.6) * 0.6 + n(q * 2.3 - uT) * 0.4;
        float vein = smoothstep(0.62, 0.7, s) - smoothstep(0.7, 0.8, s);
        float fr = pow(1.0 - abs(dot(vN, vV)), 2.5);
        vec3 col = vec3(0.02, 0.015, 0.012) + vec3(2.0, 1.4, 0.45) * (vein * 0.9 + fr * 1.1);
        gl_FragColor = vec4(col, (0.92 + fr * 0.08) * uA);
      }`,
  });
}

Object.assign(Fx.prototype, {
  // ---------------------------------------------------------------- wings
  // two brushed-ink wings spreading from a point on the back (anchor() → world point; yaw → facing)
  // The wings are real surfaces, not cards: each is a dense grid in metres (root on the spine at the
  // origin, span along +x) carrying the painted wing, re-shaped every frame. The span sweeps back and
  // the feathers cup, the wing beats with a wave that runs out from the root to the tips, and a dark
  // under-layer just behind gives it body from the side and below. o.face() (the reference shot)
  // eases all of that flat so the painting lines up with the art.
  inkWings(anchor, yawOf, size = 3, life = 1.2, o = {}) {
    const NX = 26, NY = 10;
    const build = (M) => {
      const geo = new THREE.PlaneGeometry(1, 1, NX, NY);
      const p = geo.attributes.position, base = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { base[i * 3] = (p.getX(i) + 0.5 - M.ru) * M.w; base[i * 3 + 1] = (p.getY(i) - (0.5 - M.rv)) * M.h; base[i * 3 + 2] = 0; }
      geo.userData.base = base; geo.userData.M = M;
      return geo;
    };
    const gL = build(WING.L), gR = build(WING.R);
    const mat = (side, c) => new THREE.MeshBasicMaterial({ map: wingImg(side), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: c });
    const L = new THREE.Mesh(gL, mat('L', new THREE.Color(1.12, 1.08, 1.04))), Rw = new THREE.Mesh(gR, mat('R', new THREE.Color(1.12, 1.08, 1.04)));
    const Lb = new THREE.Mesh(gL, mat('L', new THREE.Color(0.32, 0.26, 0.22))), Rb = new THREE.Mesh(gR, mat('R', new THREE.Color(0.32, 0.26, 0.22)));
    L.frustumCulled = Rw.frustumCulled = Lb.frustumCulled = Rb.frustumCulled = false;
    Lb.renderOrder = Rb.renderOrder = -1;
    plateImg();
    const g = new THREE.Group(); g.add(Lb, Rb, L, Rw); this.scene.add(g);
    // a warm glow behind her back and a thin halo ring (the reference's backlight)
    const glow = o.halo ? new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1.6, 1.25, 0.8) })) : null;
    const ring = o.halo ? new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })) : null;
    // and the thin vertical shaft of light running through her (reference)
    const shaft = o.halo ? new THREE.Mesh(plane(), new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2.0, 1.6, 1.0) })) : null;
    if (glow) { g.add(glow); g.add(ring); g.add(shaft); }
    let t = 0, flat = 0;
    const spread = o.spread ?? 0.22, flap = o.flap ?? 0.08, beats = o.beats ?? 0;
    // bend the grid: sweep (span curving back), cup (top and bottom edges curling forward), and the
    // beat (a wave of lift running from root to tip)
    const shape = (geo, sweep, cup, beat, ph) => {
      const p = geo.attributes.position, b = geo.userData.base, M = geo.userData.M;
      for (let i = 0; i < p.count; i++) {
        const X = b[i * 3], Y = b[i * 3 + 1], u = Math.max(0, X / M.w), v = Y / M.h;
        const lift = beat * Math.sin(ph - u * 1.6) * u * u * M.w;           // the wave out along the span
        const ang = beat * Math.sin(ph - u * 1.6) * u;                      // and the wing tilting with it
        const z = -sweep * u * u * M.w - cup * v * v * M.h * (0.4 + u) - Math.abs(lift) * 0.35;
        p.setXYZ(i, X * (1 - Math.abs(ang) * 0.12), Y + lift, z);
      }
      p.needsUpdate = true;
    };
    this.effects.push({ update: (dt, cam) => {
      t += dt;
      const k = Math.min(1, t / spread), e = 1 - (1 - k) ** 3;
      const fade = life === Infinity ? 1 : Math.min(1, Math.max(0, (life - t) / 0.3));
      anchor(_v); g.position.copy(_v);
      // o.face(): the wings are flat paintings: in the reference shot they turn square to the lens
      const facing = !!(o.face && o.face() && cam);
      flat = facing ? 1 : Math.max(0, flat - dt * 3);
      if (facing) g.quaternion.copy(cam.quaternion); else g.rotation.set(0, yawOf(), 0);
      // size: 1 = the reference's proportions to her body
      const s = size * (0.35 + 0.65 * e), f = Math.sin(t * 2.4) * flap * (1 - flat);
      const open = 0.15 + 0.85 * e;
      // big beats while she takes off (o.beats seconds), then a slow hovering pulse
      const strong = beats > 0 ? Math.max(0, 1 - t / beats) : 0;
      const beat = (strong * 0.55 + 0.1) * (1 - flat) * e;
      const ph = t * (5.2 * strong + 2.3 * (1 - strong));
      const sweep = (0.32 + 0.1 * Math.sin(t * 1.3)) * (1 - flat), cup = 0.28 * (1 - flat);
      shape(gL, sweep, cup, beat, ph); shape(gR, sweep, cup, beat, ph);
      for (const [w, wb, sd] of [[L, Lb, 1], [Rw, Rb, -1]]) {
        // her left wing extends to her left (+x); the right one is the mirrored image
        const a = sd * ((1 - open) * 1.3 + 0.03 + f);                     // swing about the root (folded → open)
        w.scale.set(sd * s, s, s); w.rotation.set(0, a, 0); w.position.copy(WING_ROOT);
        w.material.opacity = fade;
        // the under-layer: a hair smaller, just behind, only when the wing is not flat
        wb.scale.set(sd * s * 0.985, s * 0.985, s); wb.rotation.set(0, a, 0); wb.position.set(WING_ROOT.x, WING_ROOT.y - 0.01, WING_ROOT.z - 0.07 * s);
        wb.visible = flat < 0.99; wb.material.opacity = fade * 0.85 * (1 - flat);
      }
      if (glow) {
        const bare = !!(o.bare && o.bare());   // the backdrop plate carries its own ring, shaft and glow
        glow.visible = ring.visible = shaft.visible = !bare;
        const pulse = 1 + Math.sin(t * 2) * 0.05;
        glow.position.set(0, 0.2, -0.4); glow.scale.setScalar(s * 1.9 * e * pulse); glow.material.opacity = fade * 0.9;
        ring.position.set(0, 0.0, -0.35); ring.scale.setScalar(s * 0.68 * e); ring.material.opacity = fade * 0.8;
        shaft.position.set(0, 0.1, -0.45); shaft.scale.set(0.14, s * 5 * e, 1); shaft.material.opacity = fade * 0.75;
      }
      if (R() < 0.7) { const sd = R() < 0.5 ? 1 : -1, u = R(); this.fire.emit(_v.x + Math.cos(g.rotation.y) * sd * s * 1.8 * u, _v.y + s * (0.15 - u * 0.25) + R() * 0.6, _v.z - Math.sin(g.rotation.y) * sd * s * 1.8 * u, (R() - 0.5), 0.6 + R(), (R() - 0.5), 0.9, 0.07, 0.0, GOLD, GOLD0, 1, -0.4); }
      if (t >= life || (o.until && o.until())) {
        this.scene.remove(g); L.material.dispose(); Rw.material.dispose(); Lb.material.dispose(); Rb.material.dispose(); gL.dispose(); gR.dispose();
        if (glow) { glow.material.dispose(); ring.geometry.dispose(); ring.material.dispose(); shaft.material.dispose(); }
        return false;
      }
      return true;
    } });
    return g;
  },

  // the backdrop plate of the front-on wing shot (a plane the caller keeps in front of the camera)
  inkPlate() {
    const m = new THREE.Mesh(plane(), new THREE.MeshBasicMaterial({ map: plateImg(), fog: false, toneMapped: false }));
    m.frustumCulled = false; this.scene.add(m);      // opaque, writes depth: the world behind it is gone
    return m;
  },

  // ---------------------------------------------------------------- Ink Manifestation
  inkRushTrail(o, F) {
    // the dash: a smear of ink and gold along the ground
    for (let k = 0; k < 18; k++) {
      const d = R() * 6;
      this.smoke.emit(o.x + F.x * d + (R() - 0.5) * 0.6, o.y + 0.2 + R() * 1.4, o.z + F.z * d + (R() - 0.5) * 0.6, F.x * 2, 0.4, F.z * 2, 0.45, 0.25, 0.7, INKC, INK0, 2, 0);
      this.fire.emit(o.x + F.x * d, o.y + 0.4 + R() * 1.2, o.z + F.z * d, F.x * 6 + (R() - 0.5) * 2, R(), F.z * 6 + (R() - 0.5) * 2, 0.35, 0.08, 0.0, GOLD, GOLD0, 2, 0);
    }
  },
  inkBeat(o, F, i, view) {
    const Rt = new THREE.Vector3(-F.z, 0, F.x);
    const at = (x, y, z) => new THREE.Vector3(o.x, o.y, o.z).addScaledVector(Rt, x).addScaledVector(UP, y).addScaledVector(F, z);
    if (i === 0) {        // palm strike: a ring of gold ink bursting off the palm
      this.ribbon(at(0, 1.35, 1.0), Rt, UP, 0.5, Math.PI * 1.96, { pal: GLOSS.ink, w: 0.12, sweep: 0.04, life: 0.22, grow: 1.6, flare: 0 });
      this.impactStar(at(0, 1.35, 1.2), 0.8, [2.0, 1.5, 0.5], 0.12);
      this.light(at(0, 1.35, 1.0), 10, 6, 0.12, 0xffc45a);
    } else {             // wing slashes: a giant feathered crescent of black ink edged in gold
      const down = i === 2;
      const e1 = down ? UP.clone().addScaledVector(F, -0.3) : Rt.clone().multiplyScalar(-1).addScaledVector(UP, 0.4);
      const e2 = down ? F.clone().addScaledVector(UP, -0.6) : Rt.clone().addScaledVector(F, 0.6);
      const c = at(0, down ? 1.6 : 1.4, 0.6);
      this.ribbon(c, e1, e2, down ? 2.3 : 2.0, down ? 2.6 : 2.9, { pal: GLOSS.inkDark, w: 0.9, sweep: 0.08, life: 0.38, grow: 0.15, flare: 0.5 });
      this.ribbon(c, e1, e2, down ? 2.45 : 2.15, down ? 2.5 : 2.8, { pal: GLOSS.ink, w: 0.22, sweep: 0.08, life: 0.34, grow: 0.15, delay: 0.02 });
      if (view) this.inkWings((out) => view.rig.bones[3].getWorldPosition(out), () => Math.atan2(F.x, F.z), down ? 0.9 : 0.8, 0.45, { spread: 0.12, flap: 0.18 });
      for (let k = 0; k < 16; k++) {
        const a = R() * Math.PI, rr = 1.6 + R() * 0.9, p = c.clone().addScaledVector(e1.clone().normalize(), Math.cos(a) * rr).addScaledVector(e2.clone().normalize(), Math.sin(a) * rr);
        this.fire.emit(p.x, p.y, p.z, F.x * 6 + (R() - 0.5) * 3, (R() - 0.3) * 3, F.z * 6 + (R() - 0.5) * 3, 0.4, 0.07, 0.0, GOLD, GOLD0, 2, 2);
      }
      if (down) {
        const g = at(0, 0.05, 1.6); g.y = groundH(g.x, g.z) + 0.05;
        this.groundCrack(g.clone().setY(g.y + 0.35), 2.4, GLOSS.ink, 1.6);
        this.groundShock(g, 2.6, { core: [1.8, 1.3, 0.45], edge: [0.08, 0.06, 0.04] });
        for (let k = 0; k < 20; k++) { const a = R() * 6.283, v = 3 + R() * 4; this.smoke.emit(g.x, g.y + 0.2, g.z, Math.cos(a) * v, 1 + R() * 2, Math.sin(a) * v, 0.7, 0.3, 0.9, INKC, INK0, 2, 0.5); }
        this.light(g, 18, 10, 0.2, 0xffc45a);
      }
    }
  },

  // ---------------------------------------------------------------- Cloud-Shaper (vortex orb)
  inkOrb(c, o, delay, life, burstR) {
    const mat = inkSphereMat(), m = new THREE.Mesh(sphere(), mat);
    m.position.copy(c); m.scale.setScalar(0.01); m.renderOrder = 4;
    const rings = [0, 1, 2].map((k) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03 + k * 0.01, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      t.position.copy(c); t.rotation.set(R() * 3, R() * 3, R() * 3); this.scene.add(t); return t;
    });
    this.scene.add(m);
    // a streak of gold from her palm to the point it forms
    if (o) for (let k = 0; k < 14; k++) { _v.copy(o).lerp(c, k / 14); this.fire.emit(_v.x, _v.y, _v.z, 0, 0, 0, 0.25, 0.12, 0.02, GOLD, GOLD0, 0, 0); }
    let t = -delay, bladeT = 0, done = false;
    this.effects.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      mat.uniforms.uT.value = t;
      const grow = Math.min(1, t / 0.25), s = (t < life ? 1.25 * (1 - (1 - grow) ** 3) * (1 + Math.sin(t * 18) * 0.04) : 0);
      m.scale.setScalar(Math.max(0.01, s));
      rings.forEach((r, k) => { r.rotation.x += dt * (2 + k); r.rotation.y += dt * (3 - k); r.scale.setScalar(s * (1.6 + k * 0.45)); });
      // ink drawn into the centre in a spiral
      for (let k = 0; k < 6; k++) {
        const a = R() * 6.283, rr = 5 + R() * 4, y = (R() - 0.5) * 3, px = c.x + Math.cos(a) * rr, pz = c.z + Math.sin(a) * rr;
        const vx = (c.x - px) * 2.2 - Math.sin(a) * 6, vz = (c.z - pz) * 2.2 + Math.cos(a) * 6;
        if (k % 2) this.fire.emit(px, c.y + y, pz, vx, -y * 2, vz, 0.45, 0.07, 0.01, GOLD, GOLD0, 0, 0);
        else this.smoke.emit(px, c.y + y, pz, vx, -y * 2, vz, 0.45, 0.35, 0.1, INKC, INK0, 0, 0);
      }
      // ink blades shredding round the core
      bladeT -= dt;
      if (bladeT <= 0 && t < life) {
        bladeT = 0.07;
        const e1 = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), e2 = new THREE.Vector3().crossVectors(e1, new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5)).normalize();
        this.ribbon(c, e1, e2, 1.6 + R() * 1.2, 2.2, { pal: R() < 0.5 ? GLOSS.ink : GLOSS.inkDark, w: 0.18, sweep: 0.05, life: 0.16, grow: -0.2, flare: 0 });
      }
      if (t >= life && !done) {
        done = true;
        // the outward burst
        this.vortex(c.clone(), { size: 1.6, pal: GLOSS.ink, dur: 0.9, ribbons: 12, crack: false });
        this.liquidSlash(c.clone(), new THREE.Vector3(1, 0, 0), 2.2, GLOSS.ink, 0.0);
        const gpos = new THREE.Vector3(c.x, groundH(c.x, c.z) + 0.05, c.z);
        this.groundShock(gpos, burstR, { core: [1.8, 1.3, 0.45], edge: [0.06, 0.05, 0.04] });
        for (let k = 0; k < 40; k++) { const a = R() * 6.283, u = R() * 2 - 1, sq = Math.sqrt(1 - u * u), v = 10 + R() * 12; this.fire.emit(c.x, c.y, c.z, Math.cos(a) * sq * v, u * v, Math.sin(a) * sq * v, 0.5, 0.1, 0.01, GOLD, GOLD0, 3, 2); }
        for (let k = 0; k < 24; k++) { const a = R() * 6.283, v = 5 + R() * 6; this.smoke.emit(c.x, c.y, c.z, Math.cos(a) * v, (R() - 0.3) * 4, Math.sin(a) * v, 0.8, 0.5, 1.4, INKC, INK0, 3, 0); }
        this.light(c, 30, 16, 0.3, 0xffc45a);
        this.shake(0.3);
      }
      if (t >= life + 0.05) { this.scene.remove(m); mat.dispose(); for (const r of rings) { this.scene.remove(r); r.geometry.dispose(); r.material.dispose(); } return false; }
      return true;
    } });
  },

  // ---------------------------------------------------------------- Qingming Eruption
  taiChiArray(c, r, life, o = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: taichiTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1.6, 1.2, 0.6), side: THREE.DoubleSide });
    const m = new THREE.Mesh(plane(), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(c.x, groundH(c.x, c.z) + 0.08, c.z); m.renderOrder = 3;
    if (o.vertical) { m.rotation.set(0, o.yaw || 0, 0); m.position.copy(o.vertical); }
    this.scene.add(m);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / 0.3), s = r * 2 * (0.3 + 0.7 * (1 - (1 - k) ** 3));
      m.scale.set(s, s, 1);
      m.rotation.z += dt * (o.spin ?? 0.8);
      mat.opacity = Math.min(1, t / 0.15) * Math.min(1, (life - t) / 0.35);
      if (R() < 0.8) { const a = R() * 6.283, rr = R() * r; this.fire.emit(c.x + Math.cos(a) * rr, m.position.y + 0.1, c.z + Math.sin(a) * rr, 0, 2 + R() * 3, 0, 0.7, 0.07, 0.0, GOLD, GOLD0, 0, 0); }
      if (t >= life) { this.scene.remove(m); mat.dispose(); return false; }
      return true;
    } });
  },
  inkErupt(o, F, len, width) {
    const Rt = new THREE.Vector3(-F.z, 0, F.x);
    // the wave: walls of gold-edged ink crescents racing forward and widening
    const n = 9;
    for (let k = 0; k < n; k++) {
      const d = 1 + (k / (n - 1)) * (len - 1), w = width + d * 0.12;
      const c = new THREE.Vector3(o.x, o.y, o.z).addScaledVector(F, d); c.y = groundH(c.x, c.z) + 0.2;
      this.ribbon(c, Rt.clone().negate(), UP, w, Math.PI, { pal: GLOSS.inkDark, w: w * 0.5, sweep: 0.06, life: 0.42, grow: 0.25, delay: k * 0.035, flare: 0.4 });
      this.ribbon(c, Rt.clone().negate(), UP, w * 1.05, Math.PI, { pal: GLOSS.ink, w: w * 0.12, sweep: 0.06, life: 0.38, grow: 0.25, delay: k * 0.035 + 0.015 });
      if (k % 2 === 0) setTimeout(() => this.groundCrack(c.clone().setY(c.y + 0.3), 1.8 + d * 0.08, GLOSS.ink, 1.4), k * 35);
    }
    // a torrent of gold light and ink straight down the line
    for (let k = 0; k < 90; k++) {
      const sp = 22 + R() * 18, a = (R() - 0.5) * 0.5, b = (R() - 0.2) * 0.35;
      const d = F.clone().addScaledVector(Rt, a).addScaledVector(UP, b).normalize();
      const p = new THREE.Vector3(o.x, o.y + 1.2, o.z).addScaledVector(Rt, (R() - 0.5) * 2);
      if (k % 3) this.fire.emit(p.x, p.y, p.z, d.x * sp, d.y * sp, d.z * sp, 0.6, 0.14, 0.02, GOLD, GOLD0, 1.6, 0);
      else this.smoke.emit(p.x, p.y, p.z, d.x * sp * 0.6, d.y * sp * 0.6, d.z * sp * 0.6, 0.8, 0.5, 1.6, INKC, INK0, 1.8, 0);
    }
    const mid = new THREE.Vector3(o.x, o.y + 1.5, o.z).addScaledVector(F, len * 0.4);
    this.light(mid, 40, len * 1.2, 0.35, 0xffc45a);
    this.liquidSlash(new THREE.Vector3(o.x, o.y + 1.3, o.z).addScaledVector(F, 2), F, 2.4, GLOSS.ink, 0.1);
    this.shake(0.5);
  },

  // ---------------------------------------------------------------- Endless Talisman Suppression
  // a talisman falls out of the sky and comes down as a pillar of golden light
  // A talisman falls (each its own way: height, speed, drift, flutter, spin, a trail of gold sparks)
  // and detonates where it lands: a shaft of light, a burst of ink and gold, and two marks left on
  // the ground for a few seconds: a glowing seal and a splash of black ink. o.marks collects the
  // landing points (the finale sets every one of them off again).
  talismanStrike(p, delay = 0, size = 1, from = null, o = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: taliTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.5, 1.3, 1.0) });
    const card = new THREE.Mesh(plane(), mat);
    card.scale.set(0.9 * size, 2.2 * size, 1);
    const gy = groundH(p.x, p.z);
    const start = from ? from.clone() : new THREE.Vector3(p.x + (R() - 0.5) * 8, gy + 18 + R() * 22, p.z + (R() - 0.5) * 8);
    const fall = 0.35 + R() * 0.85, spin = (R() - 0.5) * 12, wob = 4 + R() * 8, ph = R() * 6.28, sway = 0.4 + R() * 1.4;
    let t = -delay, hit = false;
    let beam = null, boom = null, stamp = null, splat = null;
    const spinS = (R() - 0.5) * 1.2;
    this.effects.push({ update: (dt, cam) => {
      t += dt;
      if (t < 0) return true;
      if (!card.parent && !hit) this.scene.add(card);
      if (!hit) {
        const u = Math.min(1, t / fall), e = u * u * (1.6 - 0.6 * u);
        card.position.set(start.x + (p.x - start.x) * e + Math.sin(t * wob + ph) * sway * (1 - u), start.y + (gy + 1.0 - start.y) * e, start.z + (p.z - start.z) * e + Math.cos(t * wob * 0.8 + ph) * sway * (1 - u));
        card.rotation.set(0.3 * Math.sin(t * wob + ph), t * spin, Math.sin(t * 9 + ph) * 0.35);
        if (R() < 0.6) this.fire.emit(card.position.x, card.position.y, card.position.z, (R() - 0.5) * 0.4, 0.4 + R() * 0.6, (R() - 0.5) * 0.4, 0.35, 0.09 * size, 0.01, GOLD, GOLD0, 0.5, 0);
        if (u >= 1) {
          hit = true; this.scene.remove(card);
          if (o.marks) o.marks.push(new THREE.Vector3(p.x, gy, p.z));
          beam = new THREE.Mesh(beamGeo(), new THREE.MeshBasicMaterial({ map: beamTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2.2, 1.7, 1.1), side: THREE.DoubleSide }));
          beam.position.set(p.x, gy, p.z); beam.scale.set(1.3 * size, 16 * size, 1); this.scene.add(beam);
          boom = new THREE.Mesh(sphere(), inkSphereMat()); boom.position.set(p.x, gy + 0.5 * size, p.z); boom.renderOrder = 4; this.scene.add(boom);
          stamp = new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: taichiTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2.0, 1.45, 0.6), polygonOffset: true, polygonOffsetFactor: -2 }));
          stamp.position.set(p.x, gy + 0.06, p.z); stamp.scale.setScalar(3.2 * size); this.scene.add(stamp);
          splat = new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: splatTex(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 }));
          splat.position.set(p.x, gy + 0.04, p.z); splat.rotation.y = R() * 6.283; splat.scale.setScalar(3.6 * size * (0.8 + R() * 0.4)); this.scene.add(splat);
          this.groundShock(new THREE.Vector3(p.x, gy + 0.05, p.z), 2.2 * size, { core: [2.0, 1.4, 0.45], edge: [0.06, 0.05, 0.04] });
          for (let k = 0; k < 14; k++) { const a = R() * 6.283, v = 5 + R() * 7; this.fire.emit(p.x, gy + 0.4, p.z, Math.cos(a) * v, 2 + R() * 6, Math.sin(a) * v, 0.6, 0.1, 0.01, GOLD, GOLD0, 2, 4); }
          for (let k = 0; k < 7; k++) { const a = R() * 6.283, v = 3 + R() * 4; this.smoke.emit(p.x, gy + 0.4, p.z, Math.cos(a) * v, 2 + R() * 3, Math.sin(a) * v, 0.6, 0.25, 0.7, INKC, INK0, 2, 6); }
          if (R() < 0.35) this.light(new THREE.Vector3(p.x, gy + 1, p.z), 10 * size, 8, 0.15, 0xffc45a);
          t = 0;
        }
        return true;
      }
      // the shaft turns to face the camera (a soft billboard about its own axis)
      if (cam) beam.rotation.y = Math.atan2(cam.position.x - beam.position.x, cam.position.z - beam.position.z);
      const k = t / 0.5;
      if (beam.parent) {
        beam.material.opacity = Math.max(0, 1 - k);
        beam.scale.x = 1.3 * size * (1 + k * 0.8);
        boom.scale.setScalar(Math.max(0.01, 0.95 * size * (1 - (1 - Math.min(1, k * 3)) ** 3)));
        boom.material.uniforms.uT.value = t; boom.material.uniforms.uA.value = Math.max(0, 1 - k * 2.2);
        if (k >= 1) { this.scene.remove(beam); this.scene.remove(boom); beam.material.dispose(); boom.material.dispose(); mat.dispose(); }
      }
      // the marks: the seal flashes and settles to an ember glow, the ink stays wet, then both fade
      const hold = o.hold ?? 3.2;
      stamp.rotation.y += dt * spinS;
      stamp.material.opacity = t < 0.08 ? 1 : Math.max(0, (0.25 + 0.75 * Math.exp(-(t - 0.08) * 4)) * Math.min(1, (hold + 0.8 - t) / 0.8));
      stamp.scale.setScalar(3.2 * size * (1 + 0.25 * Math.min(1, t * 3)));
      splat.material.opacity = Math.min(1, t * 8) * Math.min(1, Math.max(0, (hold + 1 - t) / 1)) * 0.8;
      if (t > hold + 1) { this.scene.remove(stamp); this.scene.remove(splat); stamp.material.dispose(); splat.material.dispose(); return false; }
      return true;
    } });
  },
  // A talisman slapped onto someone: one plastered on their chest, five more circling them, a seal
  // turning under their feet. Lasts until until() is true.
  talismanBind(getPos, until) {
    const g = new THREE.Group(); this.scene.add(g);
    const mat = new THREE.MeshBasicMaterial({ map: taliTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.7, 1.45, 1.05) });
    const chest = new THREE.Mesh(plane(), mat); chest.scale.set(0.42, 1.0, 1); g.add(chest);
    const orbit = Array.from({ length: 5 }, () => { const m = new THREE.Mesh(plane(), mat); m.scale.set(0.36, 0.86, 1); g.add(m); return m; });
    const seal = new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: taichiTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2.2, 1.6, 0.6) }));
    g.add(seal);
    let t = 0;
    this.effects.push({ update: (dt, cam) => {
      t += dt;
      const p = getPos(_v); if (!p) return true;
      g.position.set(p.x, p.y, p.z);
      const k = Math.min(1, t / 0.25);
      if (cam) chest.rotation.y = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
      chest.position.set(Math.sin(chest.rotation.y) * 0.32, 1.25, Math.cos(chest.rotation.y) * 0.32);
      chest.rotation.z = Math.sin(t * 7) * 0.06;
      orbit.forEach((m, i) => { const a = t * 1.6 + i * 1.2566; m.position.set(Math.cos(a) * 1.15, 0.9 + Math.sin(t * 2 + i) * 0.25, Math.sin(a) * 1.15); m.rotation.set(0, -a + Math.PI / 2, 0.15); m.scale.set(0.36 * k, 0.86 * k, 1); });
      seal.position.set(0, groundH(p.x, p.z) - p.y + 0.07, 0); seal.rotation.y = t * 0.8; seal.scale.setScalar(2.6 * k); seal.material.opacity = 0.75 + 0.25 * Math.sin(t * 6);
      if (R() < 0.3) this.fire.emit(p.x + (R() - 0.5) * 1.6, p.y + 0.2, p.z + (R() - 0.5) * 1.6, 0, 1 + R(), 0, 0.6, 0.06, 0.01, GOLD, GOLD0, 0.5, -0.4);
      if (until()) { this.scene.remove(g); mat.dispose(); seal.material.dispose(); return false; }
      return true;
    } });
  },
  // The sky turns to ink: a dome of slow, swirling black-and-amber cloud over the whole field with a
  // hole of gold light straight above her. k() → 0..1 is how far the sky has turned.
  inkSky(c, k, until) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false, uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uT, uA; varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1,0)), f.x), mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ return n(p) * 0.55 + n(p * 2.1 + 3.1) * 0.3 + n(p * 4.3 + 7.7) * 0.15; }
        void main(){
          vec3 d = normalize(vD);
          float r = acos(clamp(d.y, -1.0, 1.0));                 // 0 straight up
          float a = atan(d.z, d.x);
          float sw = a + uT * 0.06 + 1.6 / (r + 0.35);            // the clouds wind in toward the hole above her
          float c = fbm(vec2(cos(sw), sin(sw)) * 2.2 + vec2(r * 3.5 - uT * 0.05, 0.0));
          float c2 = fbm(vec2(sw * 1.3, r * 7.0 + uT * 0.04));
          vec3 ink = vec3(0.03, 0.024, 0.022), amber = vec3(0.6, 0.34, 0.13), gold = vec3(2.2, 1.55, 0.6);
          float horizon = smoothstep(0.7, 1.62, r);               // warm haze low in the sky
          vec3 col = mix(ink, amber * 0.45, horizon * 0.75);
          col *= 0.45 + 1.1 * c;                                  // billowing ink cloud
          col = mix(col, ink * 0.5, smoothstep(0.5, 0.75, c2) * (1.0 - horizon) * 0.85);
          float hole = smoothstep(0.42, 0.0, r);                  // the gold light pouring down above her
          col += gold * (hole * hole * 0.9 + smoothstep(0.62, 0.3, r) * smoothstep(0.5, 0.75, c) * 0.35);
          col += gold * 0.25 * smoothstep(0.6, 0.85, c) * smoothstep(1.4, 0.6, r);   // gold-lit cloud edges
          gl_FragColor = vec4(col, uA);
        }`,
    });
    const m = new THREE.Mesh(dome(), mat);
    m.position.set(c.x, c.y, c.z); m.scale.setScalar(250); m.renderOrder = -2; m.frustumCulled = false;
    this.scene.add(m);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt; mat.uniforms.uT.value = t; mat.uniforms.uA.value = k();
      if (until()) { this.scene.remove(m); mat.dispose(); return false; }
      return true;
    } });
    return m;
  },
  // The great seal: a Tai Chi array the size of the battlefield turning in the sky, a second ring
  // of script counter-turning outside it. ctl: { y, s (0..1 open), a (alpha), flash, done }.
  skySeal(c, r, ctl) {
    const mk = (col) => new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: taichiTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: col, side: THREE.DoubleSide, fog: false }));
    const a = mk(new THREE.Color(1.7, 1.15, 0.42)), b = mk(new THREE.Color(1.0, 0.62, 0.24));
    const glow = new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1.6, 1.1, 0.5), side: THREE.DoubleSide, fog: false }));
    const g = new THREE.Group(); g.add(glow, b, a); this.scene.add(g);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      g.position.set(c.x, ctl.y, c.z);
      const s = Math.max(0.001, ctl.s), fl = ctl.flash || 0;
      a.scale.setScalar(2 * r * s); a.rotation.y = t * 0.35;
      b.scale.setScalar(2.5 * r * s); b.rotation.y = -t * 0.22; b.position.y = 0.4;
      glow.scale.setScalar(3.2 * r * s);
      a.material.opacity = ctl.a * (0.5 + 0.1 * Math.sin(t * 3)) + fl;
      b.material.opacity = ctl.a * 0.32 + fl * 0.5;
      glow.material.opacity = ctl.a * 0.3 + fl * 0.6;
      if (ctl.done) { this.scene.remove(g); a.material.dispose(); b.material.dispose(); glow.material.dispose(); return false; }
      return true;
    } });
  },
  // A single giant character written in gold across the sky (鎮, "suppress"): it flashes in with a
  // spray of gold, hangs there, and drops with the seal. ctl: { y, a, s, done }.
  skyGlyph(c, ch, size, ctl) {
    const tex = canvasTex('glyph_' + ch, 512, 512, (g, W) => {
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 380px serif';
      g.shadowColor = 'rgba(255,170,60,1)'; g.shadowBlur = 40; g.fillStyle = 'rgba(255,214,130,1)';
      g.fillText(ch, W / 2, W / 2 + 14);
      g.shadowBlur = 0; g.fillStyle = 'rgba(255,250,220,1)'; g.font = 'bold 372px serif'; g.fillText(ch, W / 2, W / 2 + 14);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2.2, 1.6, 0.8), fog: false }));
    this.scene.add(sp);
    for (let k = 0; k < 40; k++) { const a = R() * 6.283, v = 4 + R() * 8; this.fire.emit(c.x, ctl.y, c.z, Math.cos(a) * v, Math.sin(a) * v, (R() - 0.5) * v, 1.0, 0.3, 0.02, GOLD, GOLD0, 0.5, 0); }
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      sp.position.set(c.x, ctl.y, c.z);
      const k = Math.min(1, t / 0.25);
      sp.scale.setScalar(size * (1.25 - 0.25 * k) * (ctl.s ?? 1));
      sp.material.opacity = ctl.a * (0.85 + 0.15 * Math.sin(t * 5));
      if (ctl.done) { this.scene.remove(sp); sp.material.dispose(); return false; }
      return true;
    } });
  },
  // The finale's chain: every mark on the ground goes off again, in a wave racing outward from c.
  talismanChain(c, marks, speed = 40) {
    const list = marks.map((m) => ({ m, at: Math.hypot(m.x - c.x, m.z - c.z) / speed + R() * 0.08 })).sort((x, y) => x.at - y.at);
    let t = 0, i = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      while (i < list.length && list[i].at <= t) {
        const { m } = list[i++];
        const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2.4, 1.7, 0.7) }));
        fl.position.set(m.x, m.y + 0.8, m.z); fl.scale.setScalar(5); this.scene.add(fl);
        let ft = 0;
        this.effects.push({ update: (dt) => { ft += dt; fl.material.opacity = Math.max(0, 1 - ft / 0.35); fl.scale.setScalar(5 + ft * 14); if (ft > 0.35) { this.scene.remove(fl); fl.material.dispose(); return false; } return true; } });
        for (let k = 0; k < 8; k++) { const a = R() * 6.283, v = 4 + R() * 8; this.fire.emit(m.x, m.y + 0.3, m.z, Math.cos(a) * v, 4 + R() * 8, Math.sin(a) * v, 0.7, 0.14, 0.02, GOLD, GOLD0, 2, 5); }
        for (let k = 0; k < 3; k++) { const a = R() * 6.283, v = 2 + R() * 3; this.smoke.emit(m.x, m.y + 0.5, m.z, Math.cos(a) * v, 3 + R() * 3, Math.sin(a) * v, 1.0, 0.8, 2.2, INKC, INK0, 1.4, 0); }
      }
      return i < list.length;
    } });
  },
  // a ring of talismans hanging in the sky round the caster, slowly turning (until() → true ends it)
  talismanHalo(c, n, r, h, until, hide = null) {
    const mat = new THREE.MeshBasicMaterial({ map: taliTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.6, 1.35, 1.0) });
    const im = new THREE.InstancedMesh(plane(), mat, n);
    im.frustumCulled = false; this.scene.add(im);
    const seeds = Array.from({ length: n }, () => [R() * 6.283, r * (0.35 + R() * 0.65), h * (0.7 + R() * 0.6), R() * 6.283]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1.1, 2.6, 1);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / 1.2);
      seeds.forEach(([a, rr, hh, ph], i) => {
        const aa = a + t * 0.25 * (rr < r * 0.6 ? 1 : -0.7);
        e.set(0.25 * Math.sin(t + ph), -aa, 0.15 * Math.sin(t * 1.3 + ph));
        m4.compose(_v.set(c.x + Math.cos(aa) * rr, c.y + hh * k + Math.sin(t * 1.5 + ph) * 0.4, c.z + Math.sin(aa) * rr), q.setFromEuler(e), s);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.visible = !(hide && hide());
      mat.opacity = Math.min(1, t / 0.5);
      if (until()) { this.scene.remove(im); im.dispose(); mat.dispose(); return false; }
      return true;
    } });
  },
  // the finale: a colossal explosion of black ink and gold light
  inkNova(c, r) {
    const mat = inkSphereMat(), m = new THREE.Mesh(sphere(), mat);
    m.position.copy(c); m.renderOrder = 4; this.scene.add(m);
    const shell = new THREE.Mesh(sphere(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.BackSide }));
    shell.position.copy(c); this.scene.add(shell);
    let t = 0;
    this.groundShock(new THREE.Vector3(c.x, groundH(c.x, c.z) + 0.1, c.z), r, { core: [2.2, 1.6, 0.5], edge: [0.05, 0.04, 0.03] });
    this.light(c, 80, r * 2, 0.6, 0xffc45a);
    this.shake(1.0);
    for (let k = 0; k < 120; k++) { const a = R() * 6.283, u = R(), sq = Math.sqrt(1 - u * u), v = 18 + R() * 26; this.fire.emit(c.x, c.y + 1, c.z, Math.cos(a) * sq * v, u * v, Math.sin(a) * sq * v, 1.0, 0.3, 0.05, GOLD, GOLD0, 1.5, 2); }
    for (let k = 0; k < 60; k++) { const a = R() * 6.283, v = 10 + R() * 14; this.smoke.emit(c.x, c.y + 1, c.z, Math.cos(a) * v, 2 + R() * 6, Math.sin(a) * v, 1.6, 2, 5, INKC, INK0, 1.6, 0); }
    this.effects.push({ update: (dt) => {
      t += dt;
      mat.uniforms.uT.value = t;
      const k = Math.min(1, t / 0.9), e = 1 - (1 - k) ** 3;
      m.scale.setScalar(r * 0.4 * e); shell.scale.setScalar(r * 0.46 * e);
      mat.uniforms.uA.value = Math.max(0, 1 - Math.max(0, t - 0.9) / 0.8);
      shell.material.opacity = Math.max(0, 0.8 - t * 0.6);
      if (t > 1.7) { this.scene.remove(m); this.scene.remove(shell); mat.dispose(); shell.material.dispose(); return false; }
      return true;
    } });
  },
});
