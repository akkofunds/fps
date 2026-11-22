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
// a great soft wing of dark ink feathers (reference: smoky black-brown plumage, a glowing gold
// leading edge, ragged wisps at the tips). Texture 1024×512: the root is at the left edge, 36% down;
// the leading edge arcs up and out to the tip on the right, the feathers hang down from it.
function wingTex() {
  return canvasTex('wing2', 1024, 512, (g, W, H) => {
    const r = mulberry(7);
    const root = [0, H * 0.36];
    // leading edge: root → shoulder high point → tip
    const edge = (u) => {
      const x = u * W * 0.98;
      const y = H * 0.36 - Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * H * 0.26 + Math.max(0, u - 0.55) ** 1.6 * H * 0.75;
      return [x, y];
    };
    const feather = (x0, y0, ang, len, wid, a, blur) => {
      g.save(); g.translate(x0, y0); g.rotate(ang);
      g.filter = blur ? `blur(${blur}px)` : 'none';
      const grd = g.createLinearGradient(0, 0, len, 0);
      grd.addColorStop(0, `rgba(24,14,10,${a})`); grd.addColorStop(0.55, `rgba(36,20,12,${a * 0.9})`); grd.addColorStop(0.85, `rgba(60,34,18,${a * 0.5})`); grd.addColorStop(1, 'rgba(70,40,20,0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(0, -wid * 0.3); g.quadraticCurveTo(len * 0.45, -wid * 0.75, len, (R2(r) - 0.5) * wid * 0.4); g.quadraticCurveTo(len * 0.5, wid * 0.8, 0, wid * 0.3); g.closePath(); g.fill();
      // the rachis (a faint warm line down the feather)
      g.filter = 'none';
      g.strokeStyle = `rgba(150,90,40,${a * 0.25})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(4, 0); g.lineTo(len * 0.85, 0); g.stroke();
      g.restore();
    };
    // back layer: long soft primaries (outer half) and secondaries, blurred like smoke
    for (let k = 0; k < 46; k++) {
      const u = 0.04 + (k / 45) * 0.94, [x, y] = edge(u);
      const outer = Math.max(0, (u - 0.45) / 0.55);
      const len = H * (0.32 + 0.36 * Math.sin(u * Math.PI * 0.85) + 0.25 * outer) * (0.85 + R2(r) * 0.3);
      const ang = Math.PI * 0.5 - 0.25 - outer * 0.75 + (R2(r) - 0.5) * 0.16;   // hang down, sweeping outward at the tip
      feather(x, y + 6, ang, len, 30 + outer * 16, 0.82, 3);
    }
    // middle layer: coverts, shorter, sharper
    for (let k = 0; k < 40; k++) {
      const u = 0.02 + (k / 39) * 0.8, [x, y] = edge(u);
      const len = H * (0.16 + 0.16 * Math.sin(u * Math.PI)) * (0.8 + R2(r) * 0.4);
      feather(x, y + 3, Math.PI * 0.5 - 0.35 - u * 0.5 + (R2(r) - 0.5) * 0.2, len, 26, 0.9, 1);
    }
    // ragged wisps of ink trailing off the feather tips
    g.filter = 'blur(1.5px)';
    for (let k = 0; k < 90; k++) {
      const u = R2(r), [x, y] = edge(u), outer = Math.max(0, (u - 0.45) / 0.55);
      const L0 = H * (0.3 + 0.4 * Math.sin(u * Math.PI * 0.85) + 0.25 * outer) * (0.7 + R2(r) * 0.4), a = Math.PI * 0.5 - 0.25 - outer * 0.75;
      g.strokeStyle = `rgba(30,18,12,${0.25 + R2(r) * 0.4})`; g.lineWidth = 1 + R2(r) * 2.5;
      g.beginPath(); g.moveTo(x + Math.cos(a) * L0 * 0.8, y + Math.sin(a) * L0 * 0.8);
      g.quadraticCurveTo(x + Math.cos(a) * L0 * 1.05 + (R2(r) - 0.5) * 30, y + Math.sin(a) * L0 * 1.05, x + Math.cos(a + (R2(r) - 0.5) * 0.4) * L0 * (1.15 + R2(r) * 0.25), y + Math.sin(a) * L0 * (1.2 + R2(r) * 0.2));
      g.stroke();
    }
    g.filter = 'none';
    // the glowing gold leading edge, strongest near the body, and warm light bleeding into the top feathers
    g.globalCompositeOperation = 'lighter';
    for (const [w, a, blur] of [[22, 0.35, 10], [9, 0.7, 4], [3, 1, 0]]) {
      g.filter = blur ? `blur(${blur}px)` : 'none';
      g.lineWidth = w; g.lineCap = 'round';
      for (let k = 0; k < 60; k++) {
        const u0 = k / 60, u1 = (k + 1) / 60, [x0, y0] = edge(u0), [x1, y1] = edge(u1), fade = Math.max(0, 1 - u0 * 0.85);
        g.strokeStyle = `rgba(255,${170 + 50 * fade | 0},${70 + 40 * fade | 0},${a * fade})`;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    // gold veins along a few upper feathers + sparks
    g.filter = 'none';
    for (let k = 0; k < 26; k++) {
      const u = R2(r) * 0.85, [x, y] = edge(u), a = Math.PI * 0.5 - 0.3 - u * 0.6, L = H * (0.08 + R2(r) * 0.2);
      g.strokeStyle = `rgba(255,190,90,${0.25 + R2(r) * 0.4})`; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    for (let k = 0; k < 70; k++) { const u = R2(r), [x, y] = edge(u); g.fillStyle = `rgba(255,${180 + R2(r) * 60 | 0},90,${0.3 + R2(r) * 0.6})`; g.beginPath(); g.arc(x + (R2(r) - 0.5) * 40, y + R2(r) * H * 0.5, 0.8 + R2(r) * 2.2, 0, 7); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    void root;
  });
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
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R2 = (r) => r();

// shared geometry
let PLANE = null; const plane = () => PLANE || (PLANE = new THREE.PlaneGeometry(1, 1));
let SPHERE = null; const sphere = () => SPHERE || (SPHERE = new THREE.SphereGeometry(1, 40, 24));
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
  inkWings(anchor, yawOf, size = 3, life = 1.2, o = {}) {
    const tex = wingTex();
    const mk = () => new THREE.Mesh(plane(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.25, 1.15, 1.05) }));
    const L = mk(), Rw = mk();
    const g = new THREE.Group(); g.add(L, Rw); this.scene.add(g);
    // a warm glow behind her back and a thin halo ring (the reference's backlight)
    const glow = o.halo ? new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1.6, 1.25, 0.8) })) : null;
    const ring = o.halo ? new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })) : null;
    if (glow) { g.add(glow); g.add(ring); }
    let t = 0;
    const spread = o.spread ?? 0.22, flap = o.flap ?? 0.08;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / spread), e = 1 - (1 - k) ** 3;
      const fade = life === Infinity ? 1 : Math.min(1, Math.max(0, (life - t) / 0.3));
      anchor(_v); g.position.copy(_v);
      g.rotation.set(0, yawOf(), 0);
      const s = size * (0.2 + 0.8 * e), f = Math.sin(t * 3.2) * flap;
      // each wing: a 2:1 plane, its root (texture left edge, 36% down) on the spine, slightly behind
      // the back; the wings open from folded (pointing back) to spread wide
      const open = 0.15 + 0.85 * e;
      for (const [w, sd] of [[L, 1], [Rw, -1]]) {
        w.scale.set(sd * s * 2, s, 1);
        const a = sd * ((1 - open) * 1.3 + 0.12 + f);                     // swing about the root
        w.rotation.set(0, a, sd * (0.05 + f * 0.4));
        // put the texture's root on the anchor: rotate the root offset with the wing
        const ox = s, oy = -0.14 * s;
        w.position.set(sd * ox * Math.cos(a), oy + 0.12 * s, -0.18 - ox * Math.sin(Math.abs(a)));
        w.material.opacity = fade;
      }
      if (glow) {
        const pulse = 1 + Math.sin(t * 2) * 0.05;
        glow.position.set(0, 0.2, -0.4); glow.scale.setScalar(s * 1.9 * e * pulse); glow.material.opacity = fade * 0.9;
        ring.position.set(0, 0.25, -0.35); ring.scale.setScalar(s * 0.55 * e); ring.material.opacity = fade * 0.8;
      }
      if (R() < 0.7) { const sd = R() < 0.5 ? 1 : -1, u = R(); this.fire.emit(_v.x + Math.cos(g.rotation.y) * sd * s * 1.8 * u, _v.y + s * (0.15 - u * 0.25) + R() * 0.6, _v.z - Math.sin(g.rotation.y) * sd * s * 1.8 * u, (R() - 0.5), 0.6 + R(), (R() - 0.5), 0.9, 0.07, 0.0, GOLD, GOLD0, 1, -0.4); }
      if (t >= life || (o.until && o.until())) {
        this.scene.remove(g); L.material.dispose(); Rw.material.dispose();
        if (glow) { glow.material.dispose(); ring.geometry.dispose(); ring.material.dispose(); }
        return false;
      }
      return true;
    } });
    return g;
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
      if (view) this.inkWings((out) => view.rig.bones[3].getWorldPosition(out), () => Math.atan2(F.x, F.z), down ? 3.2 : 2.6, 0.45, { spread: 0.12, flap: 0.3 });
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
  talismanStrike(p, delay = 0, size = 1, from = null) {
    const mat = new THREE.MeshBasicMaterial({ map: taliTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.5, 1.3, 1.0) });
    const card = new THREE.Mesh(plane(), mat);
    card.scale.set(0.9 * size, 2.2 * size, 1);
    const gy = groundH(p.x, p.z);
    // every one falls its own way: its own height, speed, drift, flutter and spin
    const start = from ? from.clone() : new THREE.Vector3(p.x + (R() - 0.5) * 8, gy + 18 + R() * 22, p.z + (R() - 0.5) * 8);
    const fall = 0.35 + R() * 0.85, spin = (R() - 0.5) * 12, wob = 4 + R() * 8, ph = R() * 6.28, sway = 0.4 + R() * 1.4;
    let t = -delay, hit = false, beam = null, boom = null;
    this.effects.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      if (!card.parent && !hit) this.scene.add(card);
      if (!hit) {
        const u = Math.min(1, t / fall), e = u * u * (1.6 - 0.6 * u);
        card.position.set(start.x + (p.x - start.x) * e + Math.sin(t * wob + ph) * sway * (1 - u), start.y + (gy + 1.0 - start.y) * e, start.z + (p.z - start.z) * e + Math.cos(t * wob * 0.8 + ph) * sway * (1 - u));
        card.rotation.set(0.3 * Math.sin(t * wob + ph), t * spin, Math.sin(t * 9 + ph) * 0.35);
        if (u >= 1) {
          hit = true; this.scene.remove(card);
          // the talisman detonates: a pillar of light, a burst of ink and gold, a ring, sparks
          beam = new THREE.Mesh(pillar(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
          beam.position.set(p.x, gy, p.z); beam.scale.set(0.5 * size, 30, 0.5 * size); this.scene.add(beam);
          boom = new THREE.Mesh(sphere(), inkSphereMat()); boom.position.set(p.x, gy + 0.6 * size, p.z); boom.renderOrder = 4; this.scene.add(boom);
          this.groundShock(new THREE.Vector3(p.x, gy + 0.05, p.z), 2.4 * size, { core: [2.0, 1.4, 0.45], edge: [0.06, 0.05, 0.04] });
          for (let k = 0; k < 16; k++) { const a = R() * 6.283, v = 5 + R() * 7; this.fire.emit(p.x, gy + 0.4, p.z, Math.cos(a) * v, 2 + R() * 6, Math.sin(a) * v, 0.6, 0.1, 0.01, GOLD, GOLD0, 2, 4); }
          for (let k = 0; k < 6; k++) { const a = R() * 6.283, v = 2 + R() * 3; this.smoke.emit(p.x, gy + 0.5, p.z, Math.cos(a) * v, 1 + R() * 2, Math.sin(a) * v, 0.7, 0.4, 1.2, INKC, INK0, 2, 0); }
          if (R() < 0.35) this.light(new THREE.Vector3(p.x, gy + 1, p.z), 10 * size, 8, 0.15, 0xffc45a);
          t = 0;
        }
        return true;
      }
      const k = t / 0.5;
      beam.material.opacity = Math.max(0, 1 - k);
      beam.scale.x = beam.scale.z = 0.5 * size * (1 + k * 1.2);
      boom.scale.setScalar(Math.max(0.01, 2.2 * size * (1 - (1 - Math.min(1, k * 2.5)) ** 3)));
      boom.material.uniforms.uT.value = t; boom.material.uniforms.uA.value = Math.max(0, 1 - k * 1.4);
      if (k >= 1) { this.scene.remove(beam); this.scene.remove(boom); beam.material.dispose(); boom.material.dispose(); mat.dispose(); return false; }
      return true;
    } });
  },
  // a ring of talismans hanging in the sky round the caster, slowly turning (until() → true ends it)
  talismanHalo(c, n, r, h, until) {
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
