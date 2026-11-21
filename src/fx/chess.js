import * as THREE from 'three';
import { Fx } from './fire.js';
import { GLOSS } from './glossy.js';
import { groundH } from '../world/terrain.js';

// THE MANIPULATOR's chess: procedural glossy chess pieces (lathed bodies, a carved knight head),
// the ability effects built from them, and the Checkmate world (the whole field becomes a board).
// Piece units: 1 = the piece's height. White = his pieces, black = theirs.

const R = Math.random;
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ geometry
const V2 = (r, y) => new THREE.Vector2(r, y);
function lathe(pts, seg = 28) { return new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg); }
const BASE = [[0, 0], [0.3, 0], [0.3, 0.045], [0.27, 0.07], [0.25, 0.085], [0.255, 0.11], [0.2, 0.13], [0.17, 0.15]];
function merge(geos) {
  // flatten to non-indexed and concatenate (positions + normals)
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}
const GEO = {};
function pieceGeo(kind) {
  if (GEO[kind]) return GEO[kind];
  let g;
  if (kind === 'pawn') {
    g = merge([lathe([...BASE, [0.11, 0.3], [0.09, 0.4], [0.17, 0.43], [0.17, 0.46], [0.09, 0.48], [0.12, 0.52]]), new THREE.SphereGeometry(0.135, 20, 14).translate(0, 0.6, 0)]);
  } else if (kind === 'rook') {
    const body = lathe([...BASE, [0.15, 0.25], [0.15, 0.62], [0.21, 0.66], [0.21, 0.8], [0.17, 0.8], [0.17, 0.74], [0, 0.74]]);
    const merlons = [];
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; merlons.push(new THREE.BoxGeometry(0.1, 0.1, 0.07).rotateY(-a).translate(Math.cos(a) * 0.17, 0.85, Math.sin(a) * 0.17)); }
    g = merge([body, ...merlons]);
  } else if (kind === 'bishop') {
    g = merge([lathe([...BASE, [0.12, 0.3], [0.1, 0.48], [0.18, 0.5], [0.18, 0.53], [0.1, 0.55], [0.13, 0.6], [0.16, 0.68], [0.15, 0.76], [0.1, 0.84], [0.04, 0.88], [0, 0.89]]), new THREE.SphereGeometry(0.045, 12, 8).translate(0, 0.92, 0)]);
  } else if (kind === 'queen') {
    const body = lathe([...BASE, [0.13, 0.32], [0.1, 0.6], [0.19, 0.63], [0.19, 0.66], [0.11, 0.68], [0.14, 0.74], [0.2, 0.86], [0.12, 0.85], [0.08, 0.9], [0, 0.92]]);
    const balls = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; balls.push(new THREE.SphereGeometry(0.035, 10, 8).translate(Math.cos(a) * 0.19, 0.88, Math.sin(a) * 0.19)); }
    g = merge([body, ...balls, new THREE.SphereGeometry(0.05, 12, 8).translate(0, 0.95, 0)]);
  } else if (kind === 'king') {
    const body = lathe([...BASE, [0.14, 0.32], [0.11, 0.62], [0.2, 0.65], [0.2, 0.68], [0.12, 0.7], [0.15, 0.78], [0.19, 0.86], [0.1, 0.9], [0, 0.9]]);
    g = merge([body, new THREE.BoxGeometry(0.05, 0.2, 0.05).translate(0, 0.99, 0), new THREE.BoxGeometry(0.15, 0.05, 0.05).translate(0, 1.01, 0)]);
  } else { // knight: a lathed foot and a carved horse head (extruded profile, facing +z)
    const foot = lathe([...BASE, [0.15, 0.22], [0, 0.22]]);
    const s = new THREE.Shape();
    const P = [[-0.16, 0.2], [0.16, 0.2], [0.14, 0.34], [0.2, 0.5], [0.24, 0.6], [0.22, 0.66], [0.12, 0.66], [0.05, 0.62], [0.02, 0.68], [0.08, 0.8], [0.04, 0.9], [-0.02, 0.86], [-0.1, 0.88], [-0.16, 0.8], [-0.2, 0.66], [-0.2, 0.46], [-0.18, 0.32]];
    s.moveTo(P[0][0], P[0][1]); for (const [x, y] of P.slice(1)) s.lineTo(x, y);
    const head = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3, curveSegments: 4 });
    head.translate(0, 0, -0.09).rotateY(-Math.PI / 2);
    g = merge([foot, head]);
  }
  return (GEO[kind] = g);
}

// glossy lacquer: phong with a strong rim (fresnel) so the pieces read against anything
function pieceMat(white) {
  const m = new THREE.MeshPhongMaterial({ color: white ? 0xe9e9ec : 0x16171c, specular: white ? 0x9a9aa0 : 0x7d8796, shininess: white ? 70 : 110, transparent: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: new THREE.Color(white ? 0xffffff : 0x7f9cff) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <output_fragment>', '#include <output_fragment>\n{ float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0); gl_FragColor.rgb += uRim * fr * 0.55; }')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n{ float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0); gl_FragColor.rgb += uRim * fr * 0.55; }');
  };
  m.customProgramCacheKey = () => 'chesspiece' + (white ? 'w' : 'b');
  return m;
}

const ease = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
const easeOut = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const easeIn = (k) => Math.pow(Math.min(1, Math.max(0, k)), 3);
const MONO = { rim: [1.35, 1.35, 1.4], core: [0.9, 0.92, 0.98], deep: [0.08, 0.08, 0.1], star: [1.2, 1.25, 1.5] };
const INK = { rim: [0.7, 0.75, 0.9], core: [0.12, 0.12, 0.15], deep: [0.02, 0.02, 0.03], star: [0.55, 0.65, 1.2] };
export { MONO, INK };

Object.assign(Fx.prototype, {
  // a chess piece placed in the world. o: { white, h (height m), yaw, mode: 'rise'|'drop'|'appear',
  // t (entrance time), hold (s, then it sinks away; Infinity = until dispose) }
  // returns { obj, slideTo(p, dur), topple(dir, dur), sink(dur), dispose() }
  chessPiece(kind, pos, o = {}) {
    const h = o.h || 3, white = !!o.white;
    const mat = pieceMat(white);
    const mesh = new THREE.Mesh(pieceGeo(kind), mat);
    mesh.castShadow = true;
    const g = new THREE.Group(); g.add(mesh);
    g.scale.setScalar(h); g.rotation.y = o.yaw ?? R() * 6.283;
    const base = pos.clone(); base.y = o.y ?? groundH(pos.x, pos.z);
    g.position.copy(base);
    this.scene.add(g);
    const st = { t: 0, ent: o.t ?? (o.mode === 'drop' ? 0.28 : 0.45), mode: o.mode || 'rise', hold: o.hold ?? 1.2, slide: null, topple: null, sink: null, gone: false };
    const H = {
      obj: g, pos: g.position,
      slideTo: (p, dur) => { st.slide = { a: g.position.clone(), b: new THREE.Vector3(p.x, groundH(p.x, p.z), p.z), t: 0, dur }; },
      topple: (dir, dur = 0.6) => { st.topple = { ax: new THREE.Vector3(dir.z, 0, -dir.x).normalize(), t: 0, dur }; },
      sink: (dur = 0.5) => { if (!st.sink) st.sink = { t: 0, dur, y0: g.position.y }; },
      dispose: () => { if (!st.gone) { st.gone = true; this.scene.remove(g); mat.dispose(); } },
    };
    let landed = false;
    this.effects.push({ update: (dt) => {
      if (st.gone) return false;
      st.t += dt;
      const k = st.t / st.ent;
      if (st.mode === 'rise') { g.position.y = base.y - h * (1 - easeOut(k)); mat.opacity = Math.min(1, k * 2); }
      else if (st.mode === 'drop') {
        g.position.y = base.y + 14 * (1 - easeIn(k));
        mat.opacity = Math.min(1, k * 4);
        if (k >= 1 && !landed) { landed = true; if (o.onLand) o.onLand(H); }
      } else { mat.opacity = Math.min(1, k); g.scale.setScalar(h * (0.6 + 0.4 * easeOut(k))); }
      if (k >= 1 && st.mode !== 'drop' && !landed) { landed = true; if (o.onLand) o.onLand(H); }
      if (st.slide) {
        const s = st.slide; s.t += dt;
        const u = ease(s.t / s.dur);
        g.position.x = s.a.x + (s.b.x - s.a.x) * u; g.position.z = s.a.z + (s.b.z - s.a.z) * u;
        g.position.y = groundH(g.position.x, g.position.z);
        if (s.t >= s.dur) st.slide = null;
      }
      if (st.topple) {
        const s = st.topple; s.t += dt;
        const u = easeIn(s.t / s.dur);
        g.quaternion.setFromAxisAngle(s.ax, u * Math.PI * 0.5).multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.yaw ?? 0));
        if (s.t >= s.dur && !s.done) { s.done = true; if (o.onTopple) o.onTopple(H); }
      }
      if (!st.sink && st.t > st.ent + st.hold) H.sink(0.55);
      if (st.sink) {
        const s = st.sink; s.t += dt;
        const u = ease(s.t / s.dur);
        g.position.y = s.y0 - h * 1.05 * u; mat.opacity = 1 - u;
        if (s.t >= s.dur) { H.dispose(); return false; }
      }
      return true;
    } });
    return H;
  },

  // monochrome impact: shock crack, white ring slash, dark stars, dust
  chessImpact(p, size = 1, white = true) {
    const pal = white ? MONO : INK;
    this.groundCrack(new THREE.Vector3(p.x, groundH(p.x, p.z) + 0.3, p.z), 3 * size, MONO, 1.6);
    this.liquidSlash(new THREE.Vector3(p.x, groundH(p.x, p.z) + 0.4, p.z), new THREE.Vector3(1, 0, 0), 1.6 * size, GLOSS.white, 0.02);
    this.starBurst(new THREE.Vector3(p.x, groundH(p.x, p.z) + 1.2 * size, p.z), 3, 0.5 * size, pal, 1.4 * size);
    for (let i = 0; i < 18 * size; i++) {
      const a = R() * 6.283, sp = 3 + R() * 6;
      this.smoke.emit(p.x, groundH(p.x, p.z) + 0.2, p.z, Math.cos(a) * sp, 0.6 + R(), Math.sin(a) * sp, 0.7 + R() * 0.4, 0.4, 1.6, [0.6, 0.6, 0.62, 0.5], [0.75, 0.75, 0.78, 0], 2.2, 0);
    }
    this.light(new THREE.Vector3(p.x, groundH(p.x, p.z) + 2, p.z), 30 * size, 10 * size, 0.25, 0xeef0ff);
    this.shake(0.25 * size);
  },

  // E — Knight's Fork: an L of light on the ground (two squares forward, one across) and the white
  // knight dropping onto the landing square
  knightFork(a, corner, b) {
    const y = (p) => groundH(p.x, p.z) + 0.06;
    for (const [p, q] of [[a, corner], [corner, b]]) this.slashLine(new THREE.Vector3(p.x, y(p), p.z), new THREE.Vector3(q.x, y(q), q.z), 0.22, 0.55, [1.6, 1.6, 1.7]);
    this.chessPiece('knight', b, { white: true, h: 3.2, mode: 'drop', t: 0.3, hold: 0.7, yaw: Math.atan2(b.x - corner.x, b.z - corner.z), onLand: () => this.chessImpact(b, 1, true) });
  },

  // C — Rook's File: a black rook slams down, then charges straight down the file
  rookFile(c, dir, len, dur) {
    const end = c.clone().addScaledVector(dir, len);
    const H = this.chessPiece('rook', c, { white: false, h: 4.2, mode: 'drop', t: 0.26, hold: dur + 0.5, yaw: Math.atan2(dir.x, dir.z),
      onLand: (h) => { this.chessImpact(c, 1.2, false); h.slideTo(end, dur); } });
    // the scar it ploughs along the ground, and dust off both sides
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      if (t > 0.26 && t < 0.26 + dur) {
        const p = H.pos;
        for (let s = -1; s <= 1; s += 2) this.smoke.emit(p.x + dir.z * s * 1.2, groundH(p.x, p.z) + 0.2, p.z - dir.x * s * 1.2, dir.z * s * 5 + dir.x * 2, 1 + R() * 2, -dir.x * s * 5 + dir.z * 2, 0.8, 0.5, 1.8, [0.55, 0.55, 0.57, 0.55], [0.7, 0.7, 0.72, 0], 2, -2);
        if (R() < 0.35) this.scorch(p.x, p.z, 1.6, 6);
      }
      return t < 0.3 + dur;
    } });
  },

  // V — Queen's Gambit: the white queen rises, then light races out along all eight of her lines
  queenGambit(c, yaw, len, delay) {
    this.chessPiece('queen', c, { white: true, h: 4.6, mode: 'rise', t: 0.35, hold: delay + 0.9, yaw });
    setTimeout(() => {
      for (let i = 0; i < 8; i++) {
        const a = yaw + (i / 8) * Math.PI * 2, d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const s = c.clone().addScaledVector(d, 1.2), e = c.clone().addScaledVector(d, len);
        s.y = groundH(s.x, s.z) + 0.25; e.y = groundH(e.x, e.z) + 0.25;
        this.slashLine(s, e, 0.42, 0.5, i % 2 ? [1.5, 1.5, 1.6] : [1.7, 1.7, 1.8]);
        this.ribbon(new THREE.Vector3(c.x, c.y + 1.4, c.z), d.clone().addScaledVector(UP, 0.2), new THREE.Vector3(-d.z, 0, d.x), 2.2, 1.4, { pal: GLOSS.white, w: 0.7, sweep: 0.08, life: 0.35, delay: i * 0.012 });
      }
      this.chessImpact(c, 1.3, true);
      this.vortex(new THREE.Vector3(c.x, c.y + 2.2, c.z), { size: 1.2, pal: MONO, dur: 0.5, ribbons: 8, debris: false, crack: false });
    }, delay * 1000);
  },
});

// ------------------------------------------------------------------ the Checkmate world
// The field becomes an endless chessboard under a white sky, the props and grass vanish, giant
// pieces rise round every enemy (their king behind them), a small board floats in front of him.
const BOARD_VS = /* glsl */`
  varying vec3 vW; varying vec3 vN;
  #include <fog_pars_vertex>
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const BOARD_FS = /* glsl */`
  uniform float uSq, uK; uniform vec3 uC;
  varying vec3 vW; varying vec3 vN;
  #include <fog_pars_fragment>
  void main(){
    vec2 q = (vW.xz - uC.xz) / uSq + 0.5;
    vec2 f = fract(q); vec2 i = floor(q);
    float chk = mod(i.x + i.y, 2.0);
    vec3 white = vec3(0.86, 0.87, 0.9), black = vec3(0.07, 0.075, 0.09);
    vec3 col = mix(white, black, chk);
    // thin bevel lines between squares, a soft sheen
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    col = mix(col * 0.55, col, smoothstep(0.0, 0.025, edge));
    float sh = 0.72 + 0.28 * clamp(dot(normalize(vN), normalize(vec3(0.4, 1.0, 0.3))), 0.0, 1.0);
    col *= sh;
    // the board spreads out from his feet
    float d = length(vW.xz - uC.xz);
    if (d > uK) discard;
    col = mix(col, vec3(1.0), smoothstep(uK - 3.0, uK, d) * 0.9);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

export class ChessWorld {
  constructor(match) {
    this.m = match;
    this.on = false;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BOARD_VS, fragmentShader: BOARD_FS, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSq: { value: 6 }, uK: { value: 0 }, uC: { value: new THREE.Vector3() } }]),
    });
    // a white sky with a faint grey horizon
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.78,0.79,0.82), vec3(0.97,0.97,0.98), smoothstep(-0.05, 0.5, h)); gl_FragColor = vec4(c,1.0); }',
    }));
    sky.visible = false; sky.renderOrder = -10; sky.frustumCulled = false;
    this.sky = sky;
    match.scene.add(sky);
    this.pieces = [];
  }

  start(c) {
    if (this.on) return;
    const m = this.m, map = m.map;
    this.on = true; this.c = c.clone(); this.k = 0;
    this.mat.uniforms.uC.value.copy(c);
    this.saved = { fog: [m.scene.fog.color.clone(), m.scene.fog.near, m.scene.fog.far], hemi: map.hemi.intensity, sun: map.sun.intensity, terrain: map.terrain.material, vis: [] };
    for (const o of [map.sky, map.mountains, map.vista, map.ambient, map.waterfalls, map.grass, map.flowers, map.bushes, map.water, map.landmarks, map.props]) if (o) { this.saved.vis.push([o, o.visible]); o.visible = false; }
    map.terrain.material = this.mat;
    m.scene.fog.color.setRGB(0.9, 0.9, 0.92); m.scene.fog.near = 40; m.scene.fog.far = 420;
    map.hemi.intensity *= 1.15;
    this.sky.visible = true; this.sky.position.copy(c);
  }

  update(dt) {
    if (!this.on) return;
    this.k = Math.min(600, this.k + dt * 160);           // the board races out from his feet
    this.mat.uniforms.uK.value = this.k;
  }

  end() {
    if (!this.on) return;
    const m = this.m, map = m.map, s = this.saved;
    this.on = false;
    map.terrain.material = s.terrain;
    for (const [o, v] of s.vis) o.visible = v;
    m.scene.fog.color.copy(s.fog[0]); m.scene.fog.near = s.fog[1]; m.scene.fog.far = s.fog[2];
    map.hemi.intensity = s.hemi; map.sun.intensity = s.sun;
    this.sky.visible = false;
    for (const p of this.pieces) p.dispose();
    this.pieces.length = 0;
  }

  dispose() { this.end(); this.m.scene.remove(this.sky); this.sky.geometry.dispose(); this.sky.material.dispose(); this.mat.dispose(); }
}

// the small board in front of him (the reference shot). It is laid out from where his own hand goes:
// MN_GRIP are his right fingertip positions (in his root frame, measured from the MN_PLACE clip) at
// the moment he closes his fingers on the queen (h4) and when he sets her down (e7). The square size
// and the board's turn follow from those two points, so the queen is always exactly in his fingers.
export const MN_GRIP = { pick: [-0.1948, 1.0932, 0.3795], drop: [0.0069, 1.083, 0.487] };
const S0 = 0.11; // board units: square size before scaling to his reach
export function miniBoard(fx, root) {
  const g = new THREE.Group();
  const S = S0;
  const w = new THREE.MeshPhongMaterial({ color: 0xdedfe3, shininess: 60, specular: 0x777777 }), b = new THREE.MeshPhongMaterial({ color: 0x1a1b20, shininess: 80, specular: 0x555a66 });
  const tile = new THREE.BoxGeometry(S, 0.02, S);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const t = new THREE.Mesh(tile, (i + j) % 2 ? w : b); t.position.set((3.5 - i) * S, 0, (j - 3.5) * S); g.add(t); }
  const rimG = new THREE.BoxGeometry(S * 8.5, 0.035, S * 8.5);
  const rim = new THREE.Mesh(rimG, b); rim.position.y = -0.014; g.add(rim);
  const pcs = {};
  const sq = (i, j) => new THREE.Vector3((3.5 - i) * S, 0.01, (j - 3.5) * S); // file i a-h from his left to his right; a1 dark
  const put = (kind, white, i, j, h = 0.16) => {
    const m = new THREE.Mesh(pieceGeo(kind), pieceMat(white));
    m.scale.setScalar(h); m.position.copy(sq(i, j)); m.rotation.y = white ? 0 : Math.PI;
    g.add(m); return m;
  };
  // a real position (verified with chess.js): White plays Qh4–e7# — the queen is guarded by the knight
  // on f5, covers d8, f8 and d7, f7 is blocked by Black's own pawn, nothing can take her or block.
  // Black: Ke8 Ra8 Nb8 Bc8, pawns a7 b7 f7 g7 h7 · White: Kg1 Rf1 Qh4 Nf5 Bc4, pawns a2 b2 f2 g2 h2
  pcs.bk = put('king', false, 4, 7, 0.19); put('rook', false, 0, 7); put('knight', false, 1, 7); put('bishop', false, 2, 7);
  for (const i of [0, 1, 5, 6, 7]) put('pawn', false, i, 6, 0.12);
  pcs.wq = put('queen', true, 7, 3, 0.18); put('king', true, 6, 0, 0.19); put('rook', true, 5, 0); put('knight', true, 5, 4); put('bishop', true, 2, 3);
  for (const i of [0, 1, 5, 6, 7]) put('pawn', true, i, 1, 0.12);
  pcs.from = sq(7, 3); pcs.to = sq(4, 6);
  pcs.qTop = 0.18 * 0.86; // where his fingers close on her (local units above the square)
  // the mated king's square glows red once it is over
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(S * 0.96, S * 0.96), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.copy(sq(4, 7)).setY(0.0125); g.add(glow);
  pcs.glow = glow;
  // ---- fit to his reach: h4 → e7 is 3 squares along the diagonal
  const P = new THREE.Vector3().fromArray(MN_GRIP.pick), Q = new THREE.Vector3().fromArray(MN_GRIP.drop);
  const dx = Q.x - P.x, dz = Q.z - P.z, len = Math.hypot(dx, dz);
  const k = len / (3 * Math.SQRT2 * S);                       // board scale
  const th = Math.PI / 4 - Math.atan2(dz, dx);                 // turn so the diagonal runs along his reach
  const rot = (v) => new THREE.Vector3(v.x * Math.cos(th) + v.z * Math.sin(th), v.y, -v.x * Math.sin(th) + v.z * Math.cos(th));
  const h4 = rot(pcs.from.clone().multiplyScalar(k));
  const local = new THREE.Vector3(P.x - h4.x, P.y - (0.01 + pcs.qTop) * k, P.z - h4.z);    // board origin in his frame
  root.updateMatrixWorld(true);
  g.position.copy(root.localToWorld(local.clone()));
  g.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), th));
  g.scale.setScalar(k);
  fx.scene.add(g);
  g.updateMatrixWorld(true);
  return {
    g, S: S * k, pcs,
    // the queen in his fingers: put her so the point where he holds her is at `tip` (world)
    holdAt: (tip) => { const p = g.worldToLocal(tip.clone()); pcs.wq.position.set(p.x, p.y - pcs.qTop, p.z); },
    dispose: () => { fx.scene.remove(g); tile.dispose(); rimG.dispose(); w.dispose(); b.dispose(); g.traverse((o) => { if (o.material && o.material !== w && o.material !== b) o.material.dispose(); }); },
  };
}

// ------------------------------------------------------------------ the Manipulator's M1 (ink & tile)
// Monochrome, sharp, economical: ink trails off the striking limb, shock rings that push out
// around the line of a straight strike, glossy white/black arcs for the elbow and the kick, and on
// contact the air cracks into little black and white board tiles.
let TILE = null; const TILE_M = [];
function tileMat(k) { return TILE_M[k] || (TILE_M[k] = new THREE.MeshBasicMaterial({ color: k ? 0xf2f2f4 : 0x0c0c10, toneMapped: false })); }
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
Object.assign(Fx.prototype, {
  // a ring of air pushed out around the line of a strike (plane perpendicular to dir)
  shockRing(p, dir, r = 0.35, o = {}) {
    const D = dir.clone().normalize(), e1 = Math.abs(D.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const e2 = new THREE.Vector3().crossVectors(D, e1).normalize(); e1.crossVectors(e2, D).normalize();
    this.ribbon(p, e1, e2, r, Math.PI * 2 * 0.98, { pal: o.ink ? INK : MONO, w: o.w ?? r * 0.18, sweep: o.sweep ?? 0.05, life: o.life ?? 0.22, grow: o.grow ?? 1.4, flare: 0, delay: o.delay || 0 });
  },
  // black and white board tiles cracking off a hit
  tileShards(p, dir, n = 10, size = 1) {
    if (!TILE) TILE = new THREE.BoxGeometry(1, 0.18, 1);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(TILE, tileMat(k % 2));
      const s = (0.05 + R() * 0.07) * size;
      m.scale.setScalar(s);
      m.position.copy(p);
      const sp = 4 + R() * 7;
      const v = new THREE.Vector3(dir.x + (R() - 0.5) * 1.6, 0.35 + R() * 1.1, dir.z + (R() - 0.5) * 1.6).normalize().multiplyScalar(sp);
      _ax.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      const spin = 10 + R() * 20, life = 0.45 + R() * 0.35;
      m.quaternion.setFromAxisAngle(_ax, R() * 6);
      this.scene.add(m);
      let t = 0;
      const ax = _ax.clone();
      this.effects.push({ update: (dt) => {
        t += dt;
        v.y -= 14 * dt; v.multiplyScalar(1 - 2.2 * dt);
        m.position.addScaledVector(v, dt);
        m.quaternion.multiply(_q.setFromAxisAngle(ax, spin * dt));
        m.scale.setScalar(s * Math.max(0, 1 - Math.max(0, t - life * 0.5) / (life * 0.5)));
        if (t >= life) { this.scene.remove(m); return false; }
        return true;
      } });
    }
  },
  // the swing: o = his feet, F = flat strike direction, i = string index, getP(out) = striking limb
  chessSwing(o, F, i, getP) {
    const Rt = new THREE.Vector3(-F.z, 0, F.x), U = UP;
    const at = (x, y, z) => new THREE.Vector3(o.x, o.y, o.z).addScaledVector(Rt, x).addScaledVector(U, y).addScaledVector(F, z);
    // ink + light dragged off the limb (white core, black ink edge)
    const p = new THREE.Vector3(), prev = new THREE.Vector3();
    let t = 0, first = true;
    const dur = i === 3 ? 0.3 : 0.2;
    this.effects.push({ update: (dt) => {
      t += dt; getP(p);
      if (first) { prev.copy(p); first = false; }
      for (let k = 0; k < 4; k++) {
        const u = k / 4, x = prev.x + (p.x - prev.x) * u, y = prev.y + (p.y - prev.y) * u, z = prev.z + (p.z - prev.z) * u;
        this.fire.emit(x, y, z, 0, 0, 0, 0.12, 0.07, 0.01, [1.4, 1.42, 1.5, 1], [0.6, 0.62, 0.7, 0], 0, 0);
        if (k % 2) this.smoke.emit(x, y, z, 0, 0, 0, 0.18, 0.09, 0.02, [0.03, 0.03, 0.04, 0.9], [0.05, 0.05, 0.06, 0], 0, 0);
      }
      prev.copy(p);
      return t < dur;
    } });
    if (i === 0) {          // right straight: a line of light along the punch, two rings off the fist
      setTimeout(() => {
        this.slashLine(at(-0.15, 1.42, 0.1), at(-0.05, 1.42, 1.9), 0.06, 0.18, [1.6, 1.62, 1.7]);
        this.shockRing(at(-0.05, 1.42, 0.95), F, 0.22, { life: 0.2 });
        this.shockRing(at(-0.05, 1.42, 1.25), F, 0.16, { ink: true, life: 0.24, delay: 0.03 });
      }, 45);
    } else if (i === 1) {   // turning elbow: a short flat arc and its ink shadow
      const e1 = Rt.clone().negate().addScaledVector(F, -0.2), e2 = F.clone();
      this.ribbon(at(0, 1.45, 0.15), e1, e2, 0.85, 2.2, { pal: MONO, w: 0.3, sweep: 0.06, life: 0.26, grow: 0.2, delay: 0.035 });
      this.ribbon(at(0, 1.38, 0.1), e1, e2, 0.95, 2.0, { pal: INK, w: 0.12, sweep: 0.07, life: 0.3, grow: 0.25, delay: 0.06 });
    } else if (i === 2) {   // low roundhouse: a wide arc at thigh height, dust off the planted foot
      const e1 = Rt.clone().negate().addScaledVector(F, -0.35).addScaledVector(U, -0.1), e2 = F.clone().addScaledVector(U, 0.12);
      this.ribbon(at(0, 0.85, 0.2), e1, e2, 1.15, 2.6, { pal: MONO, w: 0.42, sweep: 0.08, life: 0.3, grow: 0.18, helix: 0.2, delay: 0.05 });
      this.ribbon(at(0, 0.8, 0.15), e1, e2, 1.3, 2.3, { pal: INK, w: 0.14, sweep: 0.09, life: 0.34, grow: 0.22, delay: 0.08 });
      this.dust(at(0, 0.05, 0), 0.6);
    } else {                // finisher: the palm drives through — a cone of rings and a long thrust line
      setTimeout(() => {
        this.slashLine(at(-0.1, 1.38, 0.2), at(0, 1.38, 3.2), 0.12, 0.26, [1.7, 1.72, 1.8]);
        this.slashLine(at(-0.1, 1.3, 0.2), at(0, 1.3, 2.6), 0.05, 0.3, [0.05, 0.05, 0.06]);
        for (let k = 0; k < 3; k++) this.shockRing(at(-0.05, 1.38, 1.0 + k * 0.45), F, 0.25 + k * 0.12, { ink: k === 1, life: 0.26 + k * 0.04, delay: k * 0.035, grow: 1.8 });
        this.airBurst(at(0, 1.38, 1.1), F, true, null);
      }, 150);
    }
  },
  // contact
  chessHit(p, dir, heavy) {
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.impactStar(p, heavy ? 1.0 : 0.55, [1.5, 1.52, 1.6]);
    this.starBurst(p, heavy ? 3 : 2, heavy ? 0.42 : 0.3, INK, heavy ? 1.0 : 0.7);
    this.tileShards(p, F, heavy ? 18 : 9, heavy ? 1.4 : 1);
    this.shockRing(p.clone().addScaledVector(F, 0.3), F, heavy ? 0.45 : 0.3, { life: 0.22 });
    for (let k = 0; k < (heavy ? 7 : 4); k++) {
      const a = Math.atan2(F.z, F.x) + (R() - 0.5) * 1.1, v = (heavy ? 26 : 16) + R() * 8;
      this.fire.emit(p.x, p.y + (R() - 0.5) * 0.4, p.z, Math.cos(a) * v, (R() - 0.5) * 3, Math.sin(a) * v, 0.09, 0.06, 0.02, [1.6, 1.6, 1.7, 1], [0.5, 0.5, 0.6, 0], 2, 0);
    }
    this.light(p, heavy ? 16 : 7, heavy ? 8 : 4, heavy ? 0.16 : 0.08, 0xeef0ff);
    if (heavy) { this.liquidSlash(p.clone().addScaledVector(UP, -0.2), F, 0.9, GLOSS.white, 0.35); this.groundCrack(new THREE.Vector3(p.x, groundH(p.x, p.z) + 0.4, p.z), 2.4, MONO, 1.4); }
  },
});

// ------------------------------------------------------------------ Checkmate extras
Object.assign(Fx.prototype, {
  // board tiles drifting up off the field into the white sky (slow, lazy spin)
  riseTiles(c, n, radius, life) {
    if (!TILE) TILE = new THREE.BoxGeometry(1, 0.18, 1);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(TILE, tileMat(k % 2));
      const a = R() * 6.283, r = 6 + Math.sqrt(R()) * radius, s = 0.8 + R() * 2.2;
      const p = new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
      p.y = groundH(p.x, p.z) - 0.2;
      m.position.copy(p); m.scale.set(s, s, s);
      const ax = new THREE.Vector3(R() - 0.5, R() * 0.3, R() - 0.5).normalize(), spin = (R() - 0.5) * 1.2, up = 1.5 + R() * 4, delay = R() * 1.2;
      this.scene.add(m);
      let t = -delay;
      this.effects.push({ update: (dt) => {
        t += dt;
        if (t > 0) { m.position.y += up * dt * Math.min(1, t * 2); m.quaternion.multiply(_q.setFromAxisAngle(ax, spin * dt)); }
        if (t > life - 0.8) m.scale.setScalar(s * Math.max(0, (life - t) / 0.8));
        if (t >= life) { this.scene.remove(m); return false; }
        return true;
      } });
    }
  },
  // a pulsing red "check" ring on the ground under a victim; returns { dispose }
  checkRing(getPos, r = 1.6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 48), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    let t = 0, gone = false;
    this.effects.push({ update: (dt) => {
      if (gone) return false;
      t += dt;
      const p = getPos();
      m.position.set(p.x, groundH(p.x, p.z) + 0.08, p.z);
      m.material.opacity = Math.min(0.9, t * 3) * (0.65 + 0.35 * Math.sin(t * 9));
      m.scale.setScalar(1 + 0.06 * Math.sin(t * 9));
      return true;
    } });
    return { dispose: () => { if (!gone) { gone = true; this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } } };
  },
});
