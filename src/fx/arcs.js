import * as THREE from 'three';
import { Fx } from './fire.js';

// Swept crescent arcs: the core of the melee VFX. A curved ribbon whose leading edge sweeps round
// the arc (like the blade or fist that made it) while the tail chases it, so what you see is a
// crescent of motion that opens, travels and thins away. Brightest at the head, tapered at both
// ends, streaked lengthwise like motion blur, with an optional dark ink edge for the anime look.
// Used for slashes (crescents in the plane of the cut) and punch impacts (bursts of air-pressure
// arcs flaring out from the hit), never as flat rings.

const SEG = 48, ACROSS = 4;
let GEO = null;
function arcGeo() {
  if (GEO) return GEO;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= SEG; i++) for (let j = 0; j <= ACROSS; j++) { pos.push(0, 0, 0); uv.push(i / SEG, j / ACROSS); }
  for (let i = 0; i < SEG; i++) for (let j = 0; j < ACROSS; j++) {
    const a = i * (ACROSS + 1) + j, b = a + ACROSS + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  GEO = new THREE.BufferGeometry();
  GEO.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  GEO.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  GEO.setIndex(idx);
  GEO.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  return GEO;
}

const VERT = /* glsl */`
  uniform float uAngle, uR, uW, uSpiral, uHead, uTail, uTwist;
  varying vec2 vUv; varying float vS;
  void main() {
    vUv = uv;
    float u = uv.x;
    // only the visible stretch between tail and head is drawn; s = position within it
    float s = clamp((u - uTail) / max(uHead - uTail, 1e-3), 0.0, 1.0);
    vS = s;
    // crescent profile: pointed at the tail, full just behind the head, rounded at the head
    float prof = pow(s, 0.55) * pow(1.0 - s * 0.82, 0.6);
    float th = u * uAngle;
    float r = uR * mix(1.0, uSpiral, u);
    float off = (uv.y - 0.5) * uW * prof;
    vec3 p = vec3(cos(th) * (r + off), sin(th) * (r + off), off * uTwist);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uCore, uEdge, uInk;
  uniform float uInkAmt, uAlpha, uHead, uTail, uSeed;
  varying vec2 vUv; varying float vS;
  float h(float x) { return fract(sin(x * 91.17 + uSeed) * 43758.5453); }
  void main() {
    float u = vUv.x;
    if (u > uHead || u < uTail) discard;
    float d = abs(vUv.y - 0.5) * 2.0;            // 0 = centre line, 1 = edge
    // lengthwise motion streaks: thin lines of varying brightness across the ribbon
    float lane = floor(vUv.y * 22.0);
    float streak = 0.55 + 0.45 * h(lane) * (0.6 + 0.4 * sin(u * 40.0 + h(lane + 3.0) * 6.28));
    float core = exp(-d * d * 4.0) * (0.35 + 0.65 * vS);
    vec3 col = mix(uEdge, uCore, clamp(core * 1.4, 0.0, 1.0));
    float a = smoothstep(1.0, 0.72, d) * (0.18 + 0.82 * pow(vS, 0.7)) * streak;
    // ink: a dark line just inside the outer edge (and a fainter one inside), comic-style
    float ink = (smoothstep(0.62, 0.78, d) - smoothstep(0.86, 0.98, d)) * uInkAmt * (0.4 + 0.6 * h(lane + 7.0));
    col = mix(col, uInk, clamp(ink * 1.6, 0.0, 1.0));
    a = max(a, ink * 0.85 * smoothstep(1.0, 0.8, d));
    a *= uAlpha * smoothstep(0.0, 0.08, vS);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }`;

const _m = new THREE.Matrix4(), _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const R = Math.random;

Object.assign(Fx.prototype, {
  // o: { c, e1, e2 (unit, perpendicular: arc starts along e1, sweeps toward e2), r, w, angle (rad),
  //      spiral (radius multiplier at the end), dur, head (share of dur for the head to finish),
  //      core [r,g,b], edge [r,g,b], ink (0-1), inkCol, grow, twist, alpha, delay }
  arc(o) {
    if (o.delay) { const d = o.delay; o.delay = 0; setTimeout(() => this.arc(o), d * 1000); return; }
    this.arcPool = this.arcPool || [];
    let a = this.arcPool.find((x) => !x.visible);
    if (!a) {
      if (this.arcPool.length >= 48) a = this.arcPool.reduce((p, q) => (p.userData.t / p.userData.dur > q.userData.t / q.userData.dur ? p : q));
      else {
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { uAngle: { value: 1 }, uR: { value: 1 }, uW: { value: 0.2 }, uSpiral: { value: 1 }, uHead: { value: 0 }, uTail: { value: 0 }, uTwist: { value: 0 },
            uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uInk: { value: new THREE.Color(0.02, 0.02, 0.03) }, uInkAmt: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: 0 } },
        });
        a = new THREE.Mesh(arcGeo(), mat);
        a.frustumCulled = false; a.renderOrder = 3; a.matrixAutoUpdate = false;
        this.scene.add(a); this.arcPool.push(a);
      }
    }
    const U = a.material.uniforms;
    _e1.copy(o.e1).normalize(); _e2.copy(o.e2).addScaledVector(_e1, -_e1.dot(o.e2)).normalize(); _n.crossVectors(_e1, _e2);
    a.userData = { t: 0, dur: o.dur || 0.28, head: o.head || 0.35, grow: o.grow ?? 0.15, r: o.r || 1, alpha: o.alpha ?? 1, c: o.c.clone(), e1: _e1.clone(), e2: _e2.clone(), n: _n.clone() };
    U.uAngle.value = o.angle || 2; U.uR.value = o.r || 1; U.uW.value = o.w || 0.25; U.uSpiral.value = o.spiral || 1; U.uTwist.value = o.twist || 0;
    U.uCore.value.setRGB(...(o.core || [2.4, 2.4, 2.6])); U.uEdge.value.setRGB(...(o.edge || [0.7, 0.75, 0.85]));
    U.uInkAmt.value = o.ink || 0; if (o.inkCol) U.uInk.value.setRGB(...o.inkCol); else U.uInk.value.setRGB(0.02, 0.02, 0.03);
    U.uSeed.value = R() * 100; U.uHead.value = 0; U.uTail.value = 0; U.uAlpha.value = a.userData.alpha;
    a.visible = true;
    this._placeArc(a, 1);
    if (!this._arcTick) {
      this._arcTick = true;
      this.effects.push({ update: (dt) => {
        for (const x of this.arcPool) {
          if (!x.visible) continue;
          const D = x.userData, Uu = x.material.uniforms;
          D.t += dt;
          const k = D.t / D.dur;
          if (k >= 1) { x.visible = false; continue; }
          // the head sweeps round fast (ease-out), the tail chases it and catches up at the end
          const kh = Math.min(1, D.t / (D.dur * D.head));
          Uu.uHead.value = 1 - Math.pow(1 - kh, 3);
          Uu.uTail.value = Math.pow(Math.max(0, (k - D.head * 0.35) / (1 - D.head * 0.35)), 1.4);
          Uu.uAlpha.value = D.alpha * (k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25);
          this._placeArc(x, 1 + D.grow * (1 - Math.pow(1 - k, 2)));
        }
        return true;
      } });
    }
    return a;
  },
  _placeArc(a, scale) {
    const D = a.userData;
    _m.makeBasis(D.e1, D.e2, D.n).scale(_n.set(scale, scale, scale)).setPosition(D.c);
    a.matrix.copy(_m); a.matrixWorldNeedsUpdate = true;
  },

  // ---------------------------------------------------------------- building blocks
  // a crescent cut: centred `c`, from direction `from` sweeping toward `to` (both unit, the plane of
  // the cut), angle in radians
  crescent(c, from, to, r, angle, look = {}) {
    return this.arc({ c, e1: from, e2: to, r, angle, w: look.w || r * 0.32, dur: look.dur || 0.26, head: look.head || 0.32, spiral: look.spiral || 1.08, core: look.core, edge: look.edge, ink: look.ink ?? 0.35, grow: look.grow ?? 0.12, alpha: look.alpha, delay: look.delay });
  },

  // air-pressure burst (punch / kick impact): curved white arcs flaring out of the hit point in the
  // direction of the blow, a dome of displaced air with a few dark ink strokes through it
  airBurst(p, dir, heavy, tint) {
    const d = new THREE.Vector3(dir.x, dir.y || 0, dir.z).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize(), up = new THREE.Vector3().crossVectors(side, d).normalize();
    const n = heavy ? 9 : 5;
    for (let k = 0; k < n; k++) {
      // each arc lies in a plane containing the blow direction, rotated about it
      const a = (k / n) * Math.PI * 2 + R() * 0.6;
      const ax = new THREE.Vector3().addScaledVector(side, Math.cos(a)).addScaledVector(up, Math.sin(a));
      const span = (heavy ? 2.2 : 1.7) + R() * 0.6;
      const r = (heavy ? 0.95 : 0.6) + R() * (heavy ? 0.6 : 0.35);
      // the arc bows forward: it starts on one side, passes in front of the hit, ends on the other
      const from = ax.clone().multiplyScalar(Math.cos(span / 2)).addScaledVector(d, -Math.sin(span / 2) * 0.15).normalize();
      const start = new THREE.Vector3().copy(ax).multiplyScalar(-Math.cos(span / 2)).addScaledVector(d, Math.sin(span / 2)).normalize();
      const c = p.clone().addScaledVector(d, -r * 0.55);
      const ink = k % 3 === 0;
      const tinted = tint && k % 2 === 1;
      this.arc({
        c, e1: ax.clone().negate(), e2: d, r, angle: Math.PI, w: r * (ink ? 0.1 : 0.22), dur: (heavy ? 0.34 : 0.24) + R() * 0.08, head: 0.3,
        spiral: 1.15 + R() * 0.25, grow: heavy ? 0.6 : 0.45, twist: (R() - 0.5) * 0.6,
        core: ink ? [0.08, 0.08, 0.1] : tinted ? tint[0] : [2.3, 2.35, 2.5], edge: ink ? [0.02, 0.02, 0.03] : tinted ? tint[1] : [0.75, 0.8, 0.9],
        ink: ink ? 0 : 0.45, alpha: ink ? 0.75 : 0.95, delay: R() * 0.03,
      });
      void from; void start;
    }
  },
});
