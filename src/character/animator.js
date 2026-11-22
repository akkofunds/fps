import * as THREE from 'three';
import { B, NB, UPPER_MASK } from './rig.js';
import { Pose, setE, setS, addE, blend, sampleClip, legIK, getQ, putQ, bakeWorldClip } from './pose.js';
import * as C from './clips.js';
const C_SPRINT = C.SPRINT;

// Character animation: a small layered state machine on top of a canonical rig.
//
//  1. ground locomotion — fully procedural and phase-synced: each foot follows a stance/swing
//     path whose stance segment slides back at exactly the body speed, so feet never skate at
//     any speed or in any of the 360° directions; two-bone IK places the ankles (and plants
//     them on the terrain). Standing still, feet are world-locked and re-step when you turn.
//  2. air — rise/apex/fall poses blended by vertical speed
//  3. full-body actions — dash, rolls, Firewall slam, Flame Leap, death (keyframed clips)
//  4. upper-body casts — alternating fire punches, Blaze Orb push, Meteor call (masked layer)
//  5. additive — aim pitch spread over the spine, landing dip spring, hit flinch, breathing

export const RUN_SPEED = 6.4;

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const R2D = 180 / Math.PI;
// weight of a [start, end] time window with short ramps (true / undefined = always / never)
const windowW = (win, t) => (win === true ? 1 : !win ? 0 : Math.min(sstep(win[0] - 0.15, win[0] + 0.1, t), 1 - sstep(win[1] - 0.1, win[1] + 0.15, t)));

const ACTIONS = {
  dash: { clip: C.DASH, in: 0.05, out: 0.12, turn: true, staffBody: true },
  dashBack: { clip: C.DASH_BACK, in: 0.05, out: 0.12, turn: true, back: true, staffBody: true },
  roll: { clip: C.ROLL, in: 0.04, out: 0.08, turn: true, aimOff: true, airBlendOut: true, staffBody: true, staffAcross: true },
  rollBack: { clip: C.ROLL_BACK, in: 0.05, out: 0.1, turn: true, back: true, aimOff: true, staffBody: true, staffAcross: true },
  slam: { clip: C.SLAM, in: 0.06, out: 0.18 },
  leap: { clip: C.LEAP, in: 0.04, out: 0.25, airBlendOut: true },
  death: { clip: C.DEATH, in: 0.06, out: 0, hold: true, aimOff: true, staffBody: true },
  plant: { clip: C.M_PLANT, in: 0.06, out: 0.18 },
  nova: { clip: C.M_NOVA, in: 0.08, out: 0.2, upright: [0.2, 1.8], twoHand: [0.15, 99] },
  inkAscend: { clip: C.INK_ASCEND, in: 0.1, out: 0.3, aimOff: true },
  exhausted: { clip: C.M_EXHAUSTED, in: 0.05, out: 0.25, aimOff: true },
  respawn: { clip: C.RESPAWN, in: 0.02, out: 0.2, aimOff: true, freeProp: true },
  kick: { clip: C.KICK_CLIP, in: 0.03, out: 0.14, aimOff: true },
  stomp: { clip: C.STOMP_CLIP, in: 0.04, out: 0.16 },
  adolla: { clip: C.ADOLLA_CLIP, in: 0.06, out: 0.2 },
  ray: { clip: C.M_RAY, in: 0.06, out: 0.2, twoHand: [0.12, 1.9] },
  skate: { clip: C.SKATE_CLIP, in: 0.05, out: 0.1, aimOff: true },
  uppercut: { clip: C.UPPERCUT_CLIP, in: 0.04, out: 0.16 },
  zeroburn: { clip: C.ZEROBURN_CLIP, in: 0.06, out: 0.2 },
  freeze: { clip: C.FREEZE_STOMP, in: 0.05, out: 0.2 },
  purple: { clip: C.G_PURPLE, in: 0.08, out: 0.2 },
  // M1 combo: jab, cross, hook, then the flying kick finisher
  m1a: { clip: C.M1_A, in: 0.025, out: 0.12, aimOff: true },
  m1b: { clip: C.M1_B, in: 0.025, out: 0.12, aimOff: true },
  m1c: { clip: C.M1_C, in: 0.025, out: 0.12, aimOff: true },
  m1d: { clip: C.M1_D, in: 0.03, out: 0.18, aimOff: true },
  // Kine Slayer
  ksA: { clip: C.KS_A, in: 0.025, out: 0.12, aimOff: true },
  ksB: { clip: C.KS_B, in: 0.025, out: 0.12, aimOff: true },
  ksC: { clip: C.KS_C, in: 0.025, out: 0.12, aimOff: true },
  ksD: { clip: C.KS_D, in: 0.03, out: 0.16, aimOff: true },
  ksThrust: { clip: C.KS_THRUST, in: 0.04, out: 0.16, aimOff: true },
  ksFlash: { clip: C.KS_FLASH, in: 0.03, out: 0.12, aimOff: true },
  ksLeap: { clip: C.KS_LEAP, in: 0.04, out: 0.15, aimOff: true },
  ksDive: { clip: C.KS_DIVE, in: 0.08, out: 0.1, aimOff: true },
  ksLand: { clip: C.KS_LAND, in: 0.02, out: 0.18, aimOff: true },
  ksWhirl: { clip: C.KS_WHIRL, in: 0.05, out: 0.15, aimOff: true },
  ksSever: { clip: C.KS_SEVER, in: 0.06, out: 0.2, aimOff: true },
  // the Manipulator
  mnA: { clip: C.MN_A, in: 0.02, out: 0.12, aimOff: true },
  mnB: { clip: C.MN_B, in: 0.02, out: 0.12, aimOff: true },
  mnC: { clip: C.MN_C, in: 0.03, out: 0.14, aimOff: true },
  mnD: { clip: C.MN_D, in: 0.03, out: 0.18, aimOff: true },
  mnChin: { clip: C.MN_CHIN, in: 0.1, out: 0.3, aimOff: true },
  mnPlace: { clip: C.MN_PLACE, in: 0.08, out: 0.25, aimOff: true },
  // getting comboed: alternating staggers, and the finisher's launch
  staggerA: { clip: C.STAGGER_A, in: 0.02, out: 0.14, aimOff: true },
  staggerB: { clip: C.STAGGER_B, in: 0.02, out: 0.14, aimOff: true },
  launched: { clip: C.LAUNCHED, in: 0.03, out: 0.3, aimOff: true },
  domain: { clip: C.G_DOMAIN, in: 0.08, out: 0.25 },
  doubleJump: { clip: C.DOUBLE_JUMP, in: 0.03, out: 0.15, aimOff: true, airBlendOut: false, turn: true, staffBody: true },
};
const CASTS = {
  boltR: { clip: C.BOLT_R, in: 0.035, out: 0.12 },
  boltL: { clip: C.BOLT_L, in: 0.035, out: 0.12 },
  orb: { clip: C.ORB, in: 0.05, out: 0.16 },
  ult: { clip: C.ULT, in: 0.08, out: 0.2 },
  mBolt: { clip: C.M_BOLT, in: 0.04, out: 0.16 },
  mRaise: { clip: C.M_RAISE, in: 0.06, out: 0.2, twoHand: [0.08, 0.62] },
  mBlink: { clip: C.M_BLINK, in: 0.04, out: 0.15 },
  mBolt2: { clip: C.M_BOLT2, in: 0.04, out: 0.16 },
  mBoltBig: { clip: C.M_BOLT, in: 0.03, out: 0.22 },
  jabR: { clip: C.JAB_R, in: 0.02, out: 0.08 },
  freezeCast: { clip: C.FREEZE_CAST, in: 0.04, out: 0.16 },
  lance: { clip: C.LANCE_CLIP, in: 0.04, out: 0.14 },
  jabL: { clip: C.JAB_L, in: 0.02, out: 0.08 },
  gBlue: { clip: C.G_BLUE, in: 0.04, out: 0.14 },
  gRed: { clip: C.G_RED, in: 0.04, out: 0.16 },
  ksThrow: { clip: C.KS_THROW, in: 0.04, out: 0.18 },
  ksCatch: { clip: C.KS_CATCH, in: 0.03, out: 0.15 },
  mnCmd: { clip: C.MN_CMD, in: 0.04, out: 0.16 },
  mnRaise: { clip: C.MN_RAISE, in: 0.05, out: 0.18 },
  fidgetP: { clip: C.FIDGET_P, in: 0.3, out: 0.4, fidget: true },
  fidgetM: { clip: C.FIDGET_M, in: 0.3, out: 0.4, fidget: true },
};

// Movement personality per character (all multipliers on the shared procedural gait).
//  brawler (Pyro): heavier, forward-driving run, big fist pump, more bounce
//  caster (Meteora): lighter, graceful, hip sway, the staff arm stays steady, softer landings
const STYLES = {
  // grounded, athletic: real running mechanics, a touch more arm drive
  brawler: { swing: 1.05, swingR: 1, lean: 1, bounce: 1, sway: 0.8, settle: 0.55, roll: 1, twist: 1, elbow: 1, kick: 1, stride: 1, fidget: 'fidgetP' },
  // lighter on her feet; the staff arm stays steadier, the free arm swings naturally
  caster: { swing: 0.95, swingR: 0.45, lean: 0.9, bounce: 0.95, sway: 1, settle: 0.5, roll: 1.1, twist: 0.95, elbow: 0.95, kick: 0.95, stride: 1, fidget: 'fidgetM' },
  // anime action-game heroine (Inkweaver): a clean, controlled, confident run. Clear but natural hip
  // sway and weight transfer, a slight forward lean with the chest up, a weighted up-and-down, steps
  // a little inside the hip line, and arms close to the body swinging cleanly opposite the legs
  femme: { swing: 1.0, swingR: 1, lean: 1.15, bounce: 0.92, sway: 1.8, runSway: 1.9, settle: 0.45, roll: 1.7, twist: 1.4, elbow: 1.05, kick: 1.05, stride: 0.95,
    width: 0.72, armIn: 14, cross: 8, arch: -2, wrist: 6, fidget: 'fidgetP' },
};

const BAKED = new Map(); // retargeted clips, shared by every instance of the same model
const FIST_ACTIONS = new Set([ACTIONS.m1a, ACTIONS.m1b, ACTIONS.m1c, ACTIONS.m1d]);

// critically/under-damped spring (semi-implicit Euler); s = { x, v }
function spring(st, target, k, zeta, dt) {
  const c = 2 * Math.sqrt(k) * zeta;
  st.v += (k * (target - st.x) - c * st.v) * dt;
  st.x += st.v * dt;
  return st.x;
}

export class Animator {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.groundAt = opts.groundAt || null; // (x, z) → terrain height, for foot placement
    this.pose = new Pose();
    this.loco = new Pose(); this.air = new Pose(); this.act = new Pose(); this.cast = new Pose(); this.tmp = new Pose(); this.ikp = new Pose();
    this.phase = 0;
    this.speed = 0; this.vx = 0; this.vz = 0; // smoothed local velocity
    this.ax = 0; this.az = 0; // smoothed local accel
    this.airW = 0; this.airT = 0; this.vy = 0;
    this.dip = 0; this.dipV = 0;
    this.flinch = 0; this.flinchSide = 1;
    this.t = Math.random() * 10;
    this.hipYaw = 0;
    this.action = null; // { def, t, w, yaw }
    this.castA = null;
    this.yawOffset = 0; this.yawOffsetTarget = 0;
    this.lobby = !!opts.lobby;
    // world-locked idle feet
    this.plant = { L: { p: new THREE.Vector3(), yaw: 0, step: -1, from: new THREE.Vector3(), to: new THREE.Vector3(), toYaw: 0, fromYaw: 0 }, R: { p: new THREE.Vector3(), yaw: 0, step: -1, from: new THREE.Vector3(), to: new THREE.Vector3(), toYaw: 0, fromYaw: 0 } };
    this.planted = false;
    this.lastStep = 'R';
    this.dead = false;
    this.style = (opts.gait && STYLES[opts.gait]) || (rig.hasProp ? STYLES.caster : STYLES.brawler);
    // a model can ship its own retargeted animations (the Sorcerer's Hollow Purple): they replace
    // the hand-keyed action of the same name for this character
    let data = null;
    rig.root.traverse((o) => { if (o.userData && o.userData.purple) data = o.userData.purple; });
    if (data) {
      const key = data.q.length + ':' + data.q[7] + ':' + data.q[101];
      if (!BAKED.has(key)) BAKED.set(key, bakeWorldClip(data, rig));
      this.baked = { purple: { clip: BAKED.get(key), in: 0.15, out: 0.35, aimOff: true } };
      // the model's own finger bones play the source finger animation with it
      if (data.fingers && data.fq) {
        const by = {};
        rig.root.traverse((o) => { if (o.isBone) by[o.name] = o; });
        this.fingers = data.fingers.map((n) => by[n] || null);
        this.fingerQ = data.fq instanceof Float32Array ? data.fq : Float32Array.from(data.fq);
        this.fistQ = data.fist ? Float32Array.from(data.fist) : null;
      }
    }
    // follow-through springs (torso lean/bank overshoot, arm drag in turns, head settle)
    this.sLean = { x: 0, v: 0 }; this.sBank = { x: 0, v: 0 }; this.sArm = { x: 0, v: 0 }; this.sHead = { x: 0, v: 0 };
    this.hitDir = 0; this.hitAmt = 1;
    this.idleT = 0; this.nextFidget = 7 + Math.random() * 5;
    this.lastBolt = -9; this.boltAlt = false;
  }

  // ---------------------------------------------------------------- events
  play(kind, data = {}) {
    if (kind === 'die') { this.dead = true; this._startAction('death', 0); this.castA = null; return; }
    if (kind === 'respawn') {
      this.dead = false; this.action = null; this.castA = null; this.planted = false; this.dip = 0; this.dipV = 0; this.airW = 0; this.yawOffset = this.yawOffsetTarget = 0;
      this.action = { def: ACTIONS.respawn, t: 0, w: 1, yaw: 0 };
      return;
    }
    if (this.dead) return;
    if (kind === 'land') {
      const impact = Math.max(0, -(data.vy || 0));
      this.dipV -= Math.min(2.4, impact * 0.16);
      return;
    }
    if (kind === 'hit') {
      // data.dir = local angle toward the attacker (0 = in front, + = on the left); unknown → random side
      this.flinch = 1;
      this.hitDir = data.dir !== undefined ? data.dir : (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random());
      this.hitAmt = clamp((data.dmg || 20) / 28, 0.6, 1.5);
      this.flinchSide = Math.sin(this.hitDir) >= 0 ? 1 : -1;
      return;
    }
    if (kind === 'stagger') { this.stagAlt = !this.stagAlt; this._startAction(this.stagAlt ? 'staggerA' : 'staggerB', 0); this.castA = null; return; }
    if (kind === 'launched') { this._startAction('launched', 0); this.castA = null; return; }
    if (kind === 'jumpStart') { this.dipV -= 0.9; this.jumpKick = 1; return; }
    if (kind === 'dash' || kind === 'roll') {
      // data.dir = local angle (rad, 0 = forward, + = toward the character's left)
      const a = data.dir || 0;
      const back = Math.abs(a) > 1.95;
      const name = kind + (back ? 'Back' : '');
      this._startAction(name, back ? wrapPi(a + Math.PI) : a);
      return;
    }
    if (kind === 'doubleJump') { const a = data.dir || 0; this._startAction('doubleJump', Math.abs(a) > 1.95 ? wrapPi(a + Math.PI) * 0 : a * 0.6); return; }
    if (ACTIONS[kind] && !ACTIONS[kind].turn) { this._startAction(kind, 0); return; }
    if (kind === 'cast') {
      let anim = data.anim;
      // Meteora's staff shots alternate thrust / backhand sweep while you keep firing
      if (anim === 'mBolt') {
        this.boltAlt = this.t - this.lastBolt < 0.9 ? !this.boltAlt : false;
        this.lastBolt = this.t;
        if (this.boltAlt) anim = 'mBolt2';
      }
      this.idleT = 0;
      const def = CASTS[anim];
      if (!def) return;
      const keep = this.castA && this.castA.def === def && this.castA.t < 0.05;
      if (!keep) this.castA = { def, t: 0, w: this.castA ? this.castA.w : 0 };
    }
  }
  _startAction(name, yaw) {
    const def = (this.baked && this.baked[name]) || ACTIONS[name];
    this.action = { def, t: 0, w: this.action ? this.action.w : 0, yaw };
    this.yawOffsetTarget = def.turn ? yaw : 0;
  }
  // hit-stop: on a connecting blow attacker and victim freeze for a few frames (the "crunch" of a
  // fighting-game hit), then snap back to full speed
  hitStop(t) { this.stopT = Math.max(this.stopT || 0, t); }
  // end the current full-body action now (it blends out over its own fade); optional name filter
  stopAction(names) { const a = this.action; if (!a) return; if (names && !names.some((n) => a.def === ((this.baked && this.baked[n]) || ACTIONS[n]))) return; a.t = Math.max(a.t, a.def.clip.duration); }
  get busy() { return !!(this.action && this.action.t < this.action.def.clip.duration); }

  // ---------------------------------------------------------------- per-frame
  // s: { pos: Vector3 (feet, world), yaw, pitch (rad, + up), vel: Vector3 world, grounded }
  update(dt, s) {
    dt = Math.min(dt, 0.05);
    if (this.stopT > 0) { this.stopT -= dt; dt *= 0.05; }
    this.t += dt;
    const rig = this.rig;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    // local velocity (x = character left, z = forward)
    const lx = s.vel.x * cy - s.vel.z * sy, lz = s.vel.x * sy + s.vel.z * cy;
    const pvx = this.vx, pvz = this.vz;
    this.vx = damp(this.vx, s.grounded ? lx : this.vx, 14, dt);
    this.vz = damp(this.vz, s.grounded ? lz : this.vz, 14, dt);
    this.ax = damp(this.ax, (this.vx - pvx) / Math.max(dt, 1e-3), 6, dt);
    this.az = damp(this.az, (this.vz - pvz) / Math.max(dt, 1e-3), 6, dt);
    const speed = Math.hypot(this.vx, this.vz);
    this.speed = speed;
    this.vy = s.vel.y;

    // air weight (small grace so slopes and steps don't flicker into the fall pose)
    if (s.grounded) this.airT = 0; else this.airT += dt;
    const airTarget = this.airT > 0.07 ? 1 : 0;
    this.airW = damp(this.airW, airTarget, airTarget ? 10 : 22, dt);

    // landing dip spring
    const k = 170, c = 2 * Math.sqrt(k) * 0.72;
    this.dipV += (-k * this.dip - c * this.dipV) * dt;
    this.dip += this.dipV * dt;
    if (this.dip < -0.32) { this.dip = -0.32; this.dipV = Math.max(0, this.dipV); }
    this.flinch = Math.max(0, this.flinch - dt * 4.5);

    // yaw offset (body turns into a dash/roll, then back to the aim)
    if (this.action && !this.busy) this.yawOffsetTarget = 0;
    this.yawOffset = damp(this.yawOffset, this.yawOffsetTarget, 18, dt);
    // turn rate → banking into turns / head leading the turn
    if (this.lastYaw === undefined) this.lastYaw = s.yaw;
    let dy = s.yaw - this.lastYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    this.lastYaw = s.yaw;
    this.yawRate = damp(this.yawRate || 0, clamp(dy / Math.max(dt, 1e-3), -6, 6), 8, dt);
    this.jumpKick = Math.max(0, (this.jumpKick || 0) - dt * 3);

    // ---- 1. locomotion
    this._locomotion(dt, s);
    // signature idle: the arms settle into the model's own pose when she stands still
    if (rig.hasProp && rig.bindQ) {
      const w = (1 - (this.wRunNow || 0)) * (1 - this.airW) * (this.lobby ? 1 : 0.92);
      if (w > 0.001) {
        const qa = this._iq1 || (this._iq1 = new THREE.Quaternion());
        for (const i of [B.shoulderL, B.upperArmL, B.foreArmL, B.handL, B.shoulderR, B.upperArmR, B.foreArmR, B.handR]) {
          getQ(this.loco, i, qa); qa.slerp(rig.bindQ[i], w); putQ(this.loco, i, qa);
        }
      }
    }
    const out = this.pose.copy(this.loco);
    // ---- 2. air
    if (this.airW > 0.001) { this._airPose(s); blend(out, out, this.air, this.airW); }
    // ---- 3. full-body action
    const a = this.action;
    if (a) {
      a.t += dt;
      const def = a.def, dur = def.clip.duration;
      const ending = !def.hold && a.t > dur;
      a.w = ending ? Math.max(0, a.w - dt / Math.max(def.out, 1e-3)) : Math.min(1, a.w + dt / def.in);
      if (def.airBlendOut && s.grounded === false) { const t0 = def.clip === C.ROLL ? 0.05 : 0.3, d0 = def.clip === C.ROLL ? 0.12 : 0.3; if (a.t > t0) a.w = Math.min(a.w, Math.max(0, 1 - (a.t - t0) / d0)); }
      if (a.w <= 0 && ending) this.action = null;
      else {
        sampleClip(def.clip, Math.min(a.t, dur), this.act);
        if (this.act.ikW > 0.001) this._clipIK(s);
        if (def.staffBody && rig.hasProp && rig.bindQ) {
          // rolls / dashes / jumps: the staff arm keeps the modelled carry (staff tucked against her)
          for (const i of [B.shoulderR, B.upperArmR, B.foreArmR, B.handR]) putQ(this.act, i, rig.bindQ[i]);
        }
        blend(out, out, this.act, a.w);
      }
    }
    // ---- idle fidgets (every ~7-12 s standing still, also in the lobby)
    const still = speed < 0.25 && s.grounded && !this.action && !this.dead && (!this.castA || this.castA.def.fidget);
    this.idleT = still ? this.idleT + dt : 0;
    if (still && !this.castA && this.idleT > this.nextFidget) {
      this.castA = { def: CASTS[this.style.fidget], t: 0, w: 0 };
      this.idleT = 0; this.nextFidget = 8 + Math.random() * 6;
    }
    if (this.castA && this.castA.def.fidget && !still) { this.castA.t = Math.max(this.castA.t, this.castA.def.clip.duration - this.castA.def.out); }
    // ---- staff: stays upright in world space unless a clip drives it
    if (rig.hasProp) {
      // actions drive the staff from their clip, except inside an `upright` window where it is
      // held perfectly vertical in world space (planted / raised for a long incantation)
      const up = a ? windowW(a.def.upright, a.t) : 0;
      this._carryW = a && a.def.staffBody && !a.def.staffAcross ? a.w : 0;
      // rolls: the staff is held ACROSS her body (side to side), so it stays level as she goes over
      this._stabilizeStaff(out, a && !a.def.freeProp && !a.def.staffBody ? a.w * (1 - up) : 0, a && a.def.staffAcross ? a.w : 0);
    }
    // ---- 4. upper-body cast
    const ca = this.castA;
    if (ca && !this.dead) {
      ca.t += dt;
      const dur = ca.def.clip.duration;
      const ending = ca.t > dur - ca.def.out;
      ca.w = ending ? Math.max(0, ca.w - dt / ca.def.out) : Math.min(1, ca.w + dt / ca.def.in);
      if (ca.t > dur && ca.w <= 0) this.castA = null;
      else {
        sampleClip(ca.def.clip, Math.min(ca.t, dur), this.cast);
        const rollW = this.action && this.action.def.aimOff ? this.action.w : 0;
        blend(out, out, this.cast, ca.w * (1 - rollW), UPPER_MASK);
      }
    }
    if (this.lobby) {
      // showcase pose, yielding to whatever the character is playing (fidgets, admin viewer)
      const busyW = Math.max(this.castA ? this.castA.w : 0, this.action ? this.action.w : 0);
      sampleClip(rig.hasProp ? C.M_SHOWCASE : C.SHOWCASE, 0, this.cast);
      blend(out, out, this.cast, 1 - busyW, UPPER_MASK);
    }
    // ---- landing recovery: arms flare and the torso folds with the dip spring
    if (this.dip < -0.01 && !this.dead) {
      const d = Math.min(1, -this.dip / 0.2);
      addE(out, B.upperArmL, -6 * d, 0, 8 * d); addE(out, B.upperArmR, -6 * d, 0, -8 * d);
      addE(out, B.spine, 8 * d, 0, 0); addE(out, B.head, -6 * d, 0, 0);
    }
    // ---- 5. additive
    const aimW = this.dead ? 0 : 1 - (this.action && this.action.def.aimOff ? this.action.w : 0);
    const p = clamp(s.pitch || 0, -1.3, 1.3) * R2D * aimW;
    if (p) {
      addE(out, B.spine, -p * 0.22, 0, 0); addE(out, B.chest, -p * 0.24, 0, 0); addE(out, B.upperChest, -p * 0.18, 0, 0);
      addE(out, B.neck, -p * 0.14, 0, 0); addE(out, B.head, -p * 0.22, 0, 0);
    }
    if (this.flinch > 0) {
      // snap away from the attacker, then settle (ease-out from the impact frame)
      const f = this.flinch * this.flinch * this.hitAmt;
      const fb = Math.cos(this.hitDir), lr = Math.sin(this.hitDir);
      addE(out, B.hips, -4 * fb * f, 0, 0);
      addE(out, B.spine, -12 * fb * f, -9 * lr * f, 8 * lr * f);
      addE(out, B.chest, -6 * fb * f, -6 * lr * f, 4 * lr * f);
      addE(out, B.neck, -8 * fb * f, -6 * lr * f, 6 * lr * f);
      addE(out, B.head, -12 * fb * f, -10 * lr * f, 8 * lr * f);
      addE(out, B.upperArmL, -14 * f, 0, 18 * f); addE(out, B.upperArmR, -14 * f, 0, -18 * f);
      out.hip[1] -= 0.04 * f;
    }
    // head settle: the head lags a touch behind fast pitch/turn changes, then catches up
    const hs = spring(this.sHead, this.yawRate * 2.2, 120, 0.55, dt) - this.yawRate * 2.2;
    addE(out, B.head, 0, -hs * 0.8, 0);
    const br = Math.sin(this.t * 1.9) * (1 - Math.min(1, speed / 3)) * aimW;
    addE(out, B.chest, br * 1.2, 0, 0); addE(out, B.upperChest, br * 0.8, 0, 0);
    addE(out, B.shoulderL, 0, 0, br * 1.2); addE(out, B.shoulderR, 0, 0, -br * 1.2);
    // ---- 6. right hand: keep the staff in the fist exactly as modelled; the wrist and forearm turn
    // to point it where the pose wants it (instead of the staff turning inside the hand)
    if (rig.hasProp) this._gripRight(out);
    // ---- 7. two-handed staff grip: the left hand takes hold of the shaft below the right
    if (rig.hasProp && !this.dead) {
      const gw = Math.max(a && a.def.twoHand ? a.w * windowW(a.def.twoHand, a.t) : 0, ca && ca.def.twoHand ? ca.w * windowW(ca.def.twoHand, ca.t) : 0);
      if (gw > 0.001) this._gripLeft(out, gw);
    }
    rig.apply(out);
    if (this.fingers) this._applyFingers();
    if (rig.hasProp && rig.ends && rig.ends.prop && !this.lobbyStill) this._resolveStaff();
  }

  // The staff must never pass through her: after the pose is applied, check the staff (both sides
  // of the grip) against the torso and thigh capsules and, where it would go through, pivot it round
  // the gripping hand just far enough to clear the body. The hand itself never moves.
  _resolveStaff() {
    const rig = this.rig, V = THREE.Vector3;
    const S = this._rs || (this._rs = { a: new V(), b: new V(), h: new V(), tip: new V(), d: new V(), p: new V(), c: new V(), n: new V(), ax: new V(), q: new THREE.Quaternion(), wq: new THREE.Quaternion(), pq: new THREE.Quaternion(), caps: [] });
    rig.root.updateMatrixWorld(true);
    const bone = rig.bones[B.propR];
    if (!bone) return;
    const wp = (i, out) => rig.bones[i].getWorldPosition(out);
    const caps = S.caps;
    const capsDef = [[B.hips, B.neck, 0.15], [B.upperLegL, B.lowerLegL, 0.095], [B.upperLegR, B.lowerLegR, 0.095]];
    while (caps.length < capsDef.length) caps.push({ a: new V(), b: new V(), r: 0 });
    capsDef.forEach(([i, j, r], k) => { wp(i, caps[k].a); wp(j, caps[k].b); caps[k].r = r; });
    for (let iter = 0; iter < 3; iter++) {
      wp(B.handR, S.h); rig.ends.prop.getWorldPosition(S.tip);
      const len = S.tip.distanceTo(S.h);
      if (len < 1e-3) return;
      S.d.subVectors(S.tip, S.h).divideScalar(len);
      let worst = 0, wPoint = null, wN = null, wArm = 0;
      for (const cap of caps) {
        // sample along the staff (tip side and butt side), skipping the grip itself
        for (let k = -6; k <= 14; k++) {
          const s = k < 0 ? (k / 6) * len * 0.55 : (k / 14) * len;
          if (Math.abs(s) < 0.09) continue;
          S.p.copy(S.h).addScaledVector(S.d, s);
          S.ax.subVectors(cap.b, cap.a);
          const t = Math.max(0, Math.min(1, S.c.subVectors(S.p, cap.a).dot(S.ax) / Math.max(1e-6, S.ax.lengthSq())));
          S.c.copy(cap.a).addScaledVector(S.ax, t);
          const dist = S.p.distanceTo(S.c), pen = cap.r - dist;
          if (pen > worst) { worst = pen; wPoint = S.p.clone(); wN = S.n.subVectors(S.p, S.c).normalize().clone(); wArm = s; }
        }
      }
      if (worst <= 0.002 || !wPoint) return;
      // rotate the staff round the hand so that point moves out along the push direction
      if (wN.lengthSq() < 1e-6) wN.set(0, 0, 1);
      const arm = S.p.subVectors(wPoint, S.h);
      const axis = S.ax.crossVectors(arm, wN);
      if (axis.lengthSq() < 1e-8) return;
      axis.normalize();
      const ang = Math.min(0.9, Math.asin(Math.min(1, (worst + 0.01) / Math.max(0.05, Math.abs(wArm)))));
      S.q.setFromAxisAngle(axis, ang);
      bone.getWorldQuaternion(S.wq);
      S.wq.premultiply(S.q);
      bone.parent.getWorldQuaternion(S.pq);
      bone.quaternion.copy(S.pq.invert().multiply(S.wq));
      bone.updateMatrixWorld(true);
    }
  }

  // finger bones: the source finger animation while the retargeted clip plays, else at rest (curl)
  _applyFingers() {
    const a = this.action, pd = this.baked.purple, nf = this.fingers.length;
    // punching: close the hands into fists
    const fw = this.fistQ && a && FIST_ACTIONS.has(a.def) ? a.w : 0;
    if (fw > 0.001) {
      this._fingOn = true;
      const q = this._fqa || (this._fqa = new THREE.Quaternion()), id = this._fqi || (this._fqi = new THREE.Quaternion());
      for (let i = 0; i < nf; i++) {
        const bn = this.fingers[i]; if (!bn) continue;
        const o = i * 4; q.set(this.fistQ[o], this.fistQ[o + 1], this.fistQ[o + 2], this.fistQ[o + 3]);
        bn.quaternion.copy(id).slerp(q, fw);
      }
      return;
    }
    const w = a && a.def === pd ? a.w : 0;
    if (w <= 0.001) {
      if (this._fingOn) { for (const bn of this.fingers) if (bn) bn.quaternion.identity(); this._fingOn = false; }
      return;
    }
    this._fingOn = true;
    const cl = pd.clip, F = this.fingerQ;
    const x = Math.max(0, Math.min(cl.n - 1, Math.min(a.t, cl.duration) * cl.fps));
    const k = Math.min(cl.n - 2, Math.floor(x)), u = x - k;
    const qa = this._fqa || (this._fqa = new THREE.Quaternion()), qb = this._fqb || (this._fqb = new THREE.Quaternion()), id = this._fqi || (this._fqi = new THREE.Quaternion());
    for (let i = 0; i < nf; i++) {
      const bn = this.fingers[i];
      if (!bn) continue;
      const oa = (k * nf + i) * 4, ob = ((k + 1) * nf + i) * 4;
      qa.set(F[oa], F[oa + 1], F[oa + 2], F[oa + 3]); qb.set(F[ob], F[ob + 1], F[ob + 2], F[ob + 3]);
      qa.slerp(qb, u);
      bn.quaternion.copy(id).slerp(qa, w);
    }
  }

  // ---------------------------------------------------------------- locomotion (procedural)
  _locomotion(dt, s) {
    const P = this.loco.reset();
    const rig = this.rig;
    const speed = this.speed;
    const wRun = sstep(0.15, 1.8, speed);
    this.wRunNow = wRun;
    // walk → run transition (people switch gaits around 2-2.5 m/s)
    const wFast = sstep(1.7, 3.3, speed);
    const st = this.style;
    // ---- gait timing from real locomotion data, scaled to the character's leg length:
    //  walk ~1.05 s per stride, foot down 60% of it (double support);
    //  run ~170-185 steps/min, foot down ~25-30% of the stride (a flight phase between steps),
    //  ground contact length ~1.3 leg lengths
    const Lg = rig.legLen || 0.85, legK = Math.sqrt(Lg / 0.88);
    const Twalk = lerp(1.18, 0.98, clamp((speed - 0.4) / 1.6, 0, 1));
    const Trun = lerp(0.76, 0.64, clamp((speed - 3) / (RUN_SPEED - 3), 0, 1));
    // sideways: shorter, quicker steps (a side-shuffle rhythm) instead of the legs splitting wide
    const sideK = this.speed > 0.3 ? Math.abs(this.vx) / this.speed : 0;
    const T = lerp(Twalk, Trun, wFast) * legK * (st.stride || 1) * (this.lobby ? 1.05 : 1) * (1 - 0.28 * sideK * wFast);
    const betaRun = clamp(1.3 * Lg * (1 - 0.35 * sideK) / Math.max(speed * T, 1e-3), 0.24, 0.45);
    const beta = lerp(0.6, betaRun, wFast);
    const Ls = speed * beta * T;
    // running: the foot lands a little ahead of the hips and pushes off well behind them
    const touch = lerp(0.5, 0.42, wFast);
    if (speed > 0.05) this.phase = (this.phase + dt / T) % 1;
    else this.phase = damp(this.phase, Math.round(this.phase * 2) / 2, 3, dt) % 1;

    // direction (local)
    const mx = speed > 1e-3 ? this.vx / speed : 0, mz = speed > 1e-3 ? this.vz / speed : 1;
    const theta = Math.atan2(mx, mz); // 0 fwd, + left
    let hy;
    if (Math.abs(theta) <= 1.85) hy = clamp(theta * 0.5, -0.75, 0.75);
    else hy = clamp(wrapPi(theta - Math.PI) * 0.35, -0.6, 0.6);
    this.hipYaw = damp(this.hipYaw, hy * wRun, 10, dt);
    const fwdness = mz; // 1 forward, -1 back

    // ---- pelvis height: walking vaults over a straight leg (highest at mid-stance); running
    // compresses into the stance leg (lowest at mid-stance, highest in flight), ~6 cm travel
    const walkBob = 0.016 * Math.cos(4 * Math.PI * (this.phase - beta * 0.5)) * (1 - wFast);
    const runBob = -0.03 * legK * st.bounce * Math.cos(4 * Math.PI * (this.phase - beta * 0.5)) * wFast;
    const idleSink = this.lobby ? -0.012 : -0.03;
    P.hip[1] = lerp(idleSink, lerp(-0.008, -0.03, wFast), wRun) + (walkBob + runBob) * wRun + this.dip;
    // the pelvis shifts over the stance foot: clearly when walking, barely when running
    P.hip[0] += Math.sin(2 * Math.PI * (this.phase - 0.1)) * lerp(0.022, 0.008 * (st.runSway || 1), wFast) * st.sway * wRun;
    const hipYawD = this.hipYaw * R2D;
    // ---- feet paths
    const feet = {};
    const ankleH = rig.ankleHeight;
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      const u = (this.phase + (side === 'R' ? 0.5 : 0)) % 1;
      let along, lift = 0, pitch = 0;
      if (u < beta) {
        // stance: heel strike (walk) / midfoot (run) → flat → heel rises → toe-off
        const k2 = u / beta;
        along = Ls * (touch - k2);
        const hr = sstep(lerp(0.55, 0.45, wFast), 1, k2);
        pitch = lerp(28, 32, wFast) * hr * wRun;
        lift = 0.1 * Math.sin(pitch / R2D);
        pitch -= lerp(14, 5, wFast) * (1 - sstep(0, 0.25, k2)) * wRun;
      } else {
        // swing: the heel folds up behind (to about knee height at a fast run, a few cm when
        // walking), the knee drives through, the shin unfolds and the foot reaches for the ground
        const k2 = (u - beta) / (1 - beta);
        const e = k2 * k2 * k2 * (k2 * (k2 * 6 - 15) + 10);
        const kick = st.kick || 1;
        along = Ls * (touch - 1 + e) - 0.12 * Lg * wFast * kick * Math.sin(Math.PI * k2) * (1 - k2) * 2;
        const H = lerp(0.075, 0.34 * Lg / 0.88 * kick, wFast);
        const pk = lerp(0.5, 0.36, wFast); // the run's heel peak comes early in the swing
        const kk = k2 < pk ? 0.5 * k2 / pk : 0.5 + 0.5 * (k2 - pk) / (1 - pk);
        lift = H * Math.pow(Math.sin(Math.PI * kk), 1.15) * wRun;
        pitch = lerp(lerp(30, 45, wFast), lerp(-14, -4, wFast), sstep(0.1, 0.92, k2)) * wRun;
      }
      feet[side] = { along, lift, pitch, sg };
      const inStance = u < beta;
      const key = 'st' + side;
      if (inStance && !this[key] && speed > 3 && this.onFootPlant) this.onFootPlant(side, speed);
      this[key] = inStance;
    }
    // pelvis/torso motion from the stride
    const stride = Ls > 1e-3 ? (feet.L.along - feet.R.along) / Ls : 0; // + when L foot ahead
    // trunk: ~3° forward walking, ~7° running, a little more while accelerating
    const leanT = ((2.5 + 4.5 * wFast) * Math.max(0, fwdness) - 3 * wFast * Math.max(0, -fwdness)) * st.lean + clamp(this.az * 0.9, -5, 7) * wRun;
    const bankT = clamp(-this.ax * 0.8 + this.yawRate * 2.2 * Math.min(1, speed / 3), -8, 8) * wRun;
    // under-damped springs: the torso overshoots a little when you stop or cut, then settles
    const lean = spring(this.sLean, leanT, 70, st.settle, dt);
    const bank = spring(this.sBank, bankT, 60, st.settle + 0.1, dt);
    // idle: slow weight shift between the feet, occasional glance around
    const idleW = 1 - wRun;
    const shift = Math.sin(this.t * 0.55) * idleW;
    P.hip[0] += shift * 0.018;
    const glance = (Math.sin(this.t * 0.31) * 0.6 + Math.sin(this.t * 0.83 + 1) * 0.4) * idleW;
    // pelvis: turns with the swinging leg (±4° walk, ±6° run) and drops on the swing side (±4°)
    const pelvisYaw = lerp(4, 6, wFast) * st.twist * stride * wRun * Math.max(0.3, Math.abs(fwdness));
    const pelvisRoll = lerp(4, 4.5, wFast) * st.roll * Math.sin(2 * Math.PI * this.phase) * wRun;
    setE(P, B.hips, lean * 0.25, hipYawD - pelvisYaw, bank * 0.5 + pelvisRoll - shift * 2.5);
    // the thorax counter-rotates against the pelvis so the shoulders swing opposite the hips
    const counter = -hipYawD + pelvisYaw;
    const thorax = lerp(3, 7, wFast) * st.twist * stride * wRun;
    // the spine undoes the pelvis roll so the shoulders stay level
    setE(P, B.spine, 1.5 + lean * 0.45 + (st.arch || 0) * wRun, counter * 0.4, bank * 0.3 - pelvisRoll * 0.85);
    setE(P, B.chest, lean * 0.25, counter * 0.35 + thorax, -pelvisRoll * 0.15);
    setE(P, B.upperChest, 0, counter * 0.2 + thorax * 0.3, 0);
    // the head stays level and looking ahead (the eyes lead the run)
    setE(P, B.neck, -lean * 0.45, -thorax * 0.4 + counter * 0.05, -bank * 0.3);
    setE(P, B.head, -lean * 0.4, -thorax * 0.45 + counter * 0.04 + glance * 14 + this.yawRate * 3 * wRun, -bank * 0.4 + shift * 2);

    // arms: counter-swing to the legs from the shoulder. Walking: relaxed, ±12°, elbows soft.
    // Running: elbows ~80-90°, ±30° swing, carried a touch forward, hands crossing toward the
    // midline on the forward swing
    const swingAmt = lerp(24, 62, wFast) * wRun * (0.35 + 0.65 * Math.abs(fwdness)) * st.swing;
    // arms drag behind sharp turns / strafes, then swing back through
    const drag = spring(this.sArm, this.yawRate * 3.5 - this.ax * 0.6, 45, 0.45, dt);
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      const sw = (Ls > 1e-3 ? (feet[side].along - Ls * (touch - 0.5)) / (Ls * 0.5) : 0) * swingAmt * 0.5 * (side === 'R' ? st.swingR : 1);
      const fwdSw = Math.max(0, -sw) / Math.max(1, swingAmt * 0.5); // 0..1 while the arm swings forward
      // relaxed ready stance: arms close to the body, casting hand slightly raised
      const idleX = side === 'R' ? -12 : -6, idleZ = side === 'R' ? 8 : 6, idleE = side === 'R' ? -58 : -30;
      const ax = lerp(idleX, sw - 5 * wFast, wRun);
      // (the forward swing of an A-posed arm drifts outward along a cone: st.cross pulls it in toward
      // the centre line instead, so the hand travels across the body)
      const az = lerp(idleZ, lerp(6, 9, wFast) - 4 * fwdSw * wFast - (st.armIn || 0) - (st.cross || 0) * fwdSw, wRun);
      const ex = lerp(idleE, lerp(-24, -(78 + 10 * sstep(4.5, RUN_SPEED, speed)), wFast) * st.elbow - Math.max(0, -sw) * lerp(0.2, 0.35, wFast), wRun);
      setS(P, B['upperArm' + side], sg, ax, 8 * fwdSw * wFast, az);
      setS(P, B['foreArm' + side], sg, ex, -lerp(6, 14, wFast) * wRun, 0);
      // a loose wrist that flicks back as the arm swings forward (style)
      setS(P, B['hand' + side], sg, -6 + (st.wrist || 0) * fwdSw * wRun, 0, -4 - (st.wrist || 0) * 0.4 * wRun);
      setS(P, B['shoulder' + side], sg, -2 * sw / Math.max(1, swingAmt * 0.5) * wFast, 0, -1.5 * wFast);
      addE(P, B['upperArm' + side], 0, 0, -clamp(drag, -10, 10));
    }

    // ---- feet targets (root space)
    const cyaw = Math.cos(this.hipYaw), syaw = Math.sin(this.hipYaw);
    const tgt = {};
    for (const side of ['L', 'R']) {
      const f = feet[side];
      const hw = Math.max(0.085, Math.abs(rig.legs.L.hipOff.x) + 0.008);
      const width = lerp(hw, hw * 0.9, wFast) * lerp(1, st.width || 1, wRun);
      // base under the hip, turned with the pelvis
      const bx = f.sg * width * cyaw, bz = -f.sg * width * syaw;
      tgt[side] = (this._tg || (this._tg = { L: new THREE.Vector3(), R: new THREE.Vector3() }))[side].set(bx + mx * f.along, ankleH + f.lift, bz + mz * f.along);
      tgt[side].pitch = f.pitch;
      tgt[side].yaw = (hipYawD * 0.7 + f.sg * 7);
    }
    // idle: world-locked feet that re-step when the body turns or drifts away
    const idleTgt = this._plantedFeet(dt, s, wRun, tgt);
    for (const side of ['L', 'R']) {
      const g = tgt[side], it = idleTgt[side];
      const w = wRun;
      const x = lerp(it.x, g.x, w), y = lerp(it.y, g.y, w), z = lerp(it.z, g.z, w);
      let gy = 0;
      if (this.groundAt && s.grounded) {
        // root → world for terrain query
        const wx = s.pos.x + x * Math.cos(s.yaw) + z * Math.sin(s.yaw);
        const wz = s.pos.z - x * Math.sin(s.yaw) + z * Math.cos(s.yaw);
        gy = clamp(this.groundAt(wx, wz) - s.pos.y, -0.25, 0.25);
      }
      g.set(x, y + gy, z); g.pitch = lerp(it.pitch, g.pitch, w); g.yaw = lerp(it.yaw, g.yaw, w); g.gy = gy;
    }
    // lower the pelvis if a foot needs to reach down a slope
    const drop = Math.min(0, Math.min(tgt.L.gy, tgt.R.gy));
    P.hip[1] += drop;
    legIK(P, rig, 'L', tgt.L, tgt.L.pitch, tgt.L.yaw);
    legIK(P, rig, 'R', tgt.R, tgt.R.pitch, tgt.R.yaw);
    for (const side of ['L', 'R']) setE(P, B['toes' + side], -Math.max(0, tgt[side].pitch) * 0.7, 0, 0);
  }

  _plantedFeet(dt, s, wRun, gait) {
    const res = { L: null, R: null };
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const toWorld = (x, z, out) => out.set(s.pos.x + x * cy + z * sy, s.pos.y, s.pos.z - x * sy + z * cy);
    const toLocal = (w, out) => { const dx = w.x - s.pos.x, dz = w.z - s.pos.z; return out.set(dx * cy - dz * sy, 0, dx * sy + dz * cy); };
    // rest stance (combat: left foot a touch forward)
    const hw = Math.max(0.09, Math.abs(this.rig.legs.L.hipOff.x) + 0.025);
    const rest = { L: [hw, 0.07, 9], R: [-hw, -0.07, -12] };
    if (this.lobby) { rest.L = [0.13, 0.03, 8]; rest.R = [-0.13, -0.02, -8]; }
    const ankleH = this.rig.ankleHeight;
    for (const side of ['L', 'R']) {
      const pl = this.plant[side];
      if (!this.planted || wRun > 0.6 || !s.grounded) {
        // follow the gait so the hand-off back to idle starts where the feet actually are
        toWorld(gait[side].x, gait[side].z, pl.p); pl.yaw = s.yaw + (gait[side].yaw || 0) / R2D; pl.step = -1;
      }
    }
    this.planted = s.grounded && wRun <= 0.6;
    // stepping logic
    const stepDur = 0.2;
    const err = {};
    for (const side of ['L', 'R']) {
      const pl = this.plant[side];
      const r = rest[side];
      const want = toWorld(r[0], r[1], (this._want || (this._want = { L: new THREE.Vector3(), R: new THREE.Vector3() }))[side]);
      const wantYaw = s.yaw + r[2] / R2D;
      err[side] = { want, wantYaw, d: Math.hypot(want.x - pl.p.x, want.z - pl.p.z) + Math.abs(wrapPi(wantYaw - pl.yaw)) * 0.22 };
      if (pl.step >= 0) {
        pl.step += dt / stepDur;
        if (pl.step >= 1) { pl.step = -1; pl.p.copy(pl.to); pl.yaw = pl.toYaw; }
      }
    }
    const anyStep = this.plant.L.step >= 0 || this.plant.R.step >= 0;
    if (this.planted && !anyStep && !this.dead) {
      const worst = err.L.d > err.R.d ? 'L' : 'R';
      if (err[worst].d > 0.17) {
        const side = err.L.d > 0.17 && err.R.d > 0.17 ? (this.lastStep === 'L' ? 'R' : 'L') : worst;
        const pl = this.plant[side];
        pl.step = 0; pl.from.copy(pl.p); pl.to.copy(err[side].want); pl.fromYaw = pl.yaw; pl.toYaw = err[side].wantYaw;
        this.lastStep = side;
      }
    }
    for (const side of ['L', 'R']) {
      const pl = this.plant[side];
      let lift = 0, pitch = 0;
      const wpos = tmpV2;
      let yaw = pl.yaw;
      if (pl.step >= 0) {
        const u = pl.step, e = u * u * (3 - 2 * u);
        wpos.lerpVectors(pl.from, pl.to, e);
        yaw = pl.fromYaw + wrapPi(pl.toYaw - pl.fromYaw) * e;
        lift = Math.sin(Math.PI * u) * 0.07; pitch = Math.sin(Math.PI * u) * 12;
      } else wpos.copy(pl.p);
      const loc = toLocal(wpos, (this._loc || (this._loc = { L: new THREE.Vector3(), R: new THREE.Vector3() }))[side]);
      loc.y = ankleH + lift;
      loc.pitch = pitch; loc.yaw = wrapPi(yaw - s.yaw) * R2D;
      res[side] = loc;
    }
    return res;
  }

  // ---------------------------------------------------------------- air
  _airPose(s) {
    const P = this.air.reset();
    const vy = s.vel.y;
    const fall = sstep(2.5, -5, vy);
    const fwd = clamp(this.vz / RUN_SPEED, -1, 1);
    // rising: a natural take-off — the lead knee drives up, the push-off leg trails, the arms
    // swing in opposition (no tuck, no flail)
    const R = { spine: [4, 0, 0], chest: [2, 0, 0], upperLegL: [-52, 0, 4], lowerLegL: [72, 0, 0], footL: [16, 0, 0], upperLegR: [10, 0, 4], lowerLegR: [50, 0, 0], footR: [30, 0, 0], upperArmL: [16, 0, 12], foreArmL: [-40, 0, 0], upperArmR: [-34, 0, 14], foreArmR: [-70, 0, 0], head: [-4, 0, 0] };
    // falling: both legs reach down for the landing with soft knees, the arms open a little for balance
    const F = { spine: [3, 0, 0], chest: [1, 0, 0], upperLegL: [-24, 0, 5], lowerLegL: [34, 0, 0], footL: [-4, 0, 0], upperLegR: [-10, 0, 5], lowerLegR: [24, 0, 0], footR: [0, 0, 0], upperArmL: [-12, 0, 20], foreArmL: [-30, 0, 0], upperArmR: [-10, 0, 22], foreArmR: [-34, 0, 0], head: [3, 0, 0] };
    for (const key of Object.keys(R)) {
      const a = R[key], b = F[key];
      const side = /[a-z]R$/.test(key) ? -1 : 1;
      setE(P, B[key], lerp(a[0], b[0], fall), lerp(a[1], b[1], fall) * side, lerp(a[2], b[2], fall) * side);
    }
    setE(P, B.hips, 5 * fwd, this.hipYaw * R2D * 0.5, 0);
    P.hip[1] = 0.01;
    // the arms drive up with the jump, then settle
    const kk = this.jumpKick || 0;
    if (kk > 0) { addE(P, B.upperArmL, -22 * kk, 0, 6 * kk); addE(P, B.upperArmR, -22 * kk, 0, -6 * kk); addE(P, B.spine, -3 * kk, 0, 0); }
    // a slight gather of the legs at the top of the arc
    const apex = Math.max(0, 1 - Math.abs(vy) / 3);
    addE(P, B.upperLegL, -8 * apex, 0, 0); addE(P, B.lowerLegL, 12 * apex, 0, 0); addE(P, B.upperLegR, -8 * apex, 0, 0); addE(P, B.lowerLegR, 14 * apex, 0, 0);
  }

  // canonical forward kinematics of the whole pose (root space): rotations + joint positions
  _fk(P) {
    const rig = this.rig, n = rig.bones.length;
    const R = this._fkR || (this._fkR = Array.from({ length: n }, () => new THREE.Quaternion()));
    const X = this._fkX || (this._fkX = Array.from({ length: n }, () => new THREE.Vector3()));
    const q = this._fkq || (this._fkq = new THREE.Quaternion());
    for (let i = 0; i < n; i++) {
      const pi = rig.parent[i];
      getQ(P, i, q);
      if (pi < 0) { R[i].copy(q); X[i].copy(rig.canon[i]); X[i].x += P.hip[0]; X[i].y += P.hip[1]; X[i].z += P.hip[2]; }
      else { R[i].copy(R[pi]).multiply(q); X[i].copy(rig.canon[i]).sub(rig.canon[pi]).applyQuaternion(R[pi]).add(X[pi]); }
    }
    return { R, X };
  }

  _gripRight(P) {
    const rig = this.rig;
    const { R } = this._fk(P);
    const V = this._rv || (this._rv = [new THREE.Vector3(), new THREE.Vector3()]);
    const Q = this._rq || (this._rq = Array.from({ length: 5 }, () => new THREE.Quaternion()));
    const want = V[0].copy(rig.propDir).applyQuaternion(R[B.propR]);                 // where the pose points the staff
    const have = V[1].copy(rig.propDir).applyQuaternion(Q[0].copy(R[B.handR]).multiply(rig.propGrip)); // where the grip points it
    const turn = Q[1].setFromUnitVectors(have, want);
    if (this._carryW > 0.001) turn.slerp(Q[2].identity(), this._carryW); // carrying: exactly as modelled
    // forearm takes ~40% of the turn (the elbow/forearm rolls), the wrist the rest
    const part = Q[2].identity().slerp(turn, 0.4);
    const pInv = Q[3].copy(R[B.upperArmR]).invert();
    const fore = Q[4].copy(pInv).multiply(part).multiply(R[B.foreArmR]);
    putQ(P, B.foreArmR, fore);
    // new forearm world = part * R[fore]; hand world must become turn * R[hand]
    const foreW = Q[0].copy(part).multiply(R[B.foreArmR]).invert();
    putQ(P, B.handR, foreW.multiply(Q[3].copy(turn).multiply(R[B.handR])));
    putQ(P, B.propR, rig.propGrip);
  }

  // left-arm two-bone IK onto the staff shaft, a hand-width below the right hand
  _gripLeft(P, w) {
    const rig = this.rig;
    const { R, X } = this._fk(P);
    const V = this._gv || (this._gv = Array.from({ length: 8 }, () => new THREE.Vector3()));
    const Q = this._gq || (this._gq = Array.from({ length: 6 }, () => new THREE.Quaternion()));
    const [axis, tgt, sh, d, n, pole, c1, c2] = V;
    axis.set(0, 1, 0.12).normalize().applyQuaternion(R[B.propR]);
    const grip = X[B.propR];
    const toBody = sh.copy(X[B.upperArmL]).sub(grip);
    tgt.copy(grip).addScaledVector(axis, -0.17);
    // wrist sits a palm's width off the shaft, toward her
    toBody.addScaledVector(axis, -toBody.dot(axis)).normalize();
    tgt.addScaledVector(toBody, 0.075);
    const S = X[B.upperArmL];
    c1.copy(rig.canon[B.foreArmL]).sub(rig.canon[B.upperArmL]);
    c2.copy(rig.canon[B.handL]).sub(rig.canon[B.foreArmL]);
    const l1 = c1.length(), l2 = c2.length();
    c1.normalize(); c2.normalize();
    const Rp = R[B.shoulderL], Rpi = Q[0].copy(Rp).invert();
    d.copy(tgt).sub(S).applyQuaternion(Rpi);
    let dist = d.length();
    const maxD = (l1 + l2) * 0.995;
    if (dist > maxD) { d.multiplyScalar(maxD / dist); dist = maxD; }
    if (dist < 0.05) return;
    const vn = d.divideScalar(dist);
    const a1 = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
    // elbow hangs down and out to her left, a little back
    pole.set(0.55, -1, -0.25).applyQuaternion(Rpi);
    n.copy(pole).addScaledVector(vn, -pole.dot(vn));
    if (n.lengthSq() < 1e-6) n.set(0, -1, 0); n.normalize();
    const upper = pole.copy(vn).multiplyScalar(Math.cos(a1)).addScaledVector(n, Math.sin(a1));
    const q1 = Q[1].setFromUnitVectors(c1, upper);
    // forearm direction in world → local of (shoulder * upperArm)
    const elbow = sh.copy(upper).multiplyScalar(l1).applyQuaternion(Rp).add(S);
    const fw = d.copy(tgt).sub(elbow).normalize();
    const R1 = Q[2].copy(Rp).multiply(q1), R1i = Q[3].copy(R1).invert();
    const q2 = Q[4].setFromUnitVectors(c2, fw.clone().applyQuaternion(R1i));
    // hand: fingers wrap toward the shaft
    const R2i = Q[5].copy(R1).multiply(q2).invert();
    const hd = n.copy(grip).addScaledVector(axis, -0.17).sub(tgt).normalize().applyQuaternion(R2i);
    const q3 = new THREE.Quaternion().setFromUnitVectors(c2, hd);
    const cur = this._gc || (this._gc = new THREE.Quaternion());
    for (const [bi, qq] of [[B.upperArmL, q1], [B.foreArmL, q2], [B.handL, q3]]) {
      getQ(P, bi, cur); cur.slerp(qq, w); putQ(P, bi, cur);
    }
  }

  _stabilizeStaff(out, actionW, bodyW = 0) {
    // canonical world rotation of the right hand = product down the chain
    const chain = [B.hips, B.spine, B.chest, B.upperChest, B.shoulderR, B.upperArmR, B.foreArmR, B.handR];
    const w = this._sq || (this._sq = new THREE.Quaternion());
    const t = this._sq2 || (this._sq2 = new THREE.Quaternion());
    w.identity();
    for (const i of chain) w.multiply(getQ(out, i, t));
    // desired: upright, leaning a little with speed
    const lean = Math.min(1, this.speed / RUN_SPEED);
    const d = this._sq3 || (this._sq3 = new THREE.Quaternion());
    d.setFromEuler(this._se || (this._se = new THREE.Euler(lean * 0.35 + Math.sin(this.t * 1.3) * 0.03, 0, -0.08)));
    if (bodyW > 0.001) {
      // rolling / dashing / double-jumping: the staff is tucked along her body (parallel to the spine)
      const tb = this._sq4 || (this._sq4 = new THREE.Quaternion());
      const u = this._sq5 || (this._sq5 = new THREE.Quaternion());
      tb.identity();
      for (const i of [B.hips, B.spine, B.chest, B.upperChest]) tb.multiply(getQ(out, i, u));
      tb.multiply(u.setFromEuler(this._se2 || (this._se2 = new THREE.Euler(0, 0.35, Math.PI / 2))));
      d.slerp(tb, bodyW);
    }
    w.invert().multiply(d);
    getQ(out, B.propR, t);
    w.slerp(t, actionW);
    putQ(out, B.propR, w);
  }

  _cape(dt, out, s) {
    // damped spring: swings back with forward speed and upward motion, flutters a little
    const fwd = Math.max(0, this.vz);
    const wind = this.windBoost || 0; // cutscene gale
    const target = Math.min(70, fwd * 5.5 + Math.max(0, -this.vy) * 2.2 + (this.airW > 0.5 ? 8 : 0) + wind * 42);
    const v0 = Number.isFinite(this.capeV) ? this.capeV : 0, a0 = Number.isFinite(this.capeA) ? this.capeA : 0;
    this.capeV = v0 + ((target - a0) * 60 - v0 * 9) * Math.min(dt, 0.05);
    this.capeA = Math.max(-25, Math.min(80, a0 + this.capeV * Math.min(dt, 0.05)));
    const flutter = (Math.sin(this.t * 7.3) * (2 + fwd * 0.6) + Math.sin(this.t * 2.1) * 2) * (1 + wind * 3) + Math.sin(this.t * 13.7) * wind * 4;
    addE(out, B.cape, this.capeA + flutter, Math.sin(this.t * 1.7) * 3, -this.vx * 1.5);
  }

  // clip IK (legs planted during slams / crouches)
  _clipIK(s) {
    const A = this.act;
    const ik = this.ikp.copy(A);
    const ankleH = this.rig.ankleHeight;
    for (const side of ['L', 'R']) {
      const t = A.ik[side];
      tmpV.set(t[0], ankleH + t[1], t[2]);
      legIK(ik, this.rig, side, tmpV, t[3], side === 'L' ? 8 : -8);
    }
    const w = A.ikW;
    for (const side of ['L', 'R']) for (const b of ['upperLeg', 'lowerLeg', 'foot']) {
      const i = B[b + side];
      getQ(A, i, tmpQ); const qb = this._qb || (this._qb = new THREE.Quaternion()); getQ(ik, i, qb);
      tmpQ.slerp(qb, w); putQ(A, i, tmpQ);
    }
  }
}
