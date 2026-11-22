import * as THREE from 'three';
import { MODES, MAX_HP, NET_HZ, INTERP_DELAY } from '../config.js';
import { Audio } from '../core/audio.js';
import { addRecent } from '../core/storage.js';
import { groundH } from '../world/terrain.js';
import { Fx } from '../fx/arcane.js';
import '../fx/inferno.js';
import '../fx/novaStage.js';
import '../fx/frost.js';
import '../fx/limitless.js';
import '../fx/melee.js';
import '../fx/heavenly.js';
import { ChessWorld, miniBoard, MONO as MONO_PAL } from '../fx/chess.js';
import { PLATE, WING_ROOT } from '../fx/ink.js';
import { CHECKMATE, ROOK, QUEEN } from './manipulator.js';
import { ORB as INK_ORB, ERUPT as INK_ERUPT, TALISMAN, WING_SHOT } from './inkweaver.js';
const PLATE_D = 16;        // metres from the camera to the wing shot's backdrop plate
const CINE_BAND = 0.78;    // the part of the screen height between the cutscene bars (11vh each)
import { UnlimitedVoid } from '../world/void.js';
import { BLUE, RED, PURPLE, VOID } from './sorcerer.js';
import { FREEZE, BLITZ, ZERO } from './shoto.js';
import { KICK, STEP, ADOLLA, IGNITE } from './pyro.js';
import { loadMageModel, MageInstance } from '../character/characterModel.js';
import { Body, stepMovement } from './movement.js';
import { ShoulderCamera } from './camera.js';
import { Projectiles, hitCharacter } from './projectiles.js';
import { mageOf, MAGE_LIST } from './mages.js';
import { NOVA, STARFALL } from './meteora.js';
import { BAL, applyBalance } from './balance.js';
import { Rules } from './rules.js';
import { toast } from '../ui/dom.js';

// One match: world, entities, local control, network sync, abilities and rendering.
//
// Network (star around the host, JSON over WebRTC):
//   client → host   s (own state 20 Hz) · ev (ability / animation events) · hit (shooter-side hits) · chat
//   host → all      S (all states) · ev (relayed) · hp · kill · spawn · kb · board · phase · end · chat
// The host runs Rules (HP, kills, respawns, burning, scoring) and also plays as a normal client.

// small deterministic RNG (mulberry32) so every client derives the same random layout
function seeded(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), rayHit = { t: 0 };
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

class Ent {
  constructor(p, isLocal) {
    this.n = p.n; this.id = p.id; this.name = p.name; this.tag = p.tag || '';
    this.isLocal = isLocal; this.dummy = !!p.dummy;
    this.mage = p.mage && !p.dummy ? p.mage : 'pyro';
    this.alive = false; this.hp = BAL.hp;
    this.kills = 0; this.deaths = 0; this.dmg = 0;
    this.pos = new THREE.Vector3(0, -50, 0); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.grounded = true;
    this.snaps = [];
    this.view = null;
    this.burnT = 0; this.flash = 0;
    this.prevGrounded = true; this.prevVy = 0;
    this.lastHurt = 0;
  }
}

export class Match {
  static async create(app, opts) {
    const m = new Match(app, opts);
    await m.init();
    return m;
  }

  constructor(app, { cfg, net, isHost, localId, players }) {
    // admin balance only applies to Custom/Practice lobbies (the host's numbers)
    applyBalance(cfg.mode === 'custom' || cfg.mode === 'practice' ? cfg.balance : null);
    this.app = app; this.cfg = cfg; this.net = net; this.isHost = isHost; this.localId = localId;
    this.players = players;
    this.mode = MODES[cfg.mode] || MODES.ffa;
    this.ents = new Map();
    this.byId = new Map();
    this.time = 0;
    this.controlsActive = true;
    this.ended = false;
    this.phase = 'warmup'; this.timeLeft = 0; this.phaseEnd = 0;
    this.areas = []; // firewalls, burning ground
    this.sendT = 0;
    this.aimPoint = new THREE.Vector3();
    this.aimEnt = null;
    this.killsToWin = cfg.killsToWin || this.mode.killsToWin;
    // subscribe immediately and buffer: the host starts sending spawns while we still load
    this._ready = false; this._queue = [];
    if (isHost) {
      this._offs = [
        net.on('msg', (pid, msg) => {
          if (!this._ready) { this._queue.push(['h', pid, msg]); return; }
          let e = this.byId.get(pid);
          // a player the host lost track of asks to be spawned: add them from the session roster
          if (!e && msg && msg.t === 'needSpawn' && this.cfg.queue) {
            const h = (this.app.session.humans || []).find((x) => x.id === pid);
            if (h) { this.hostAddPlayer({ ...h }); e = this.byId.get(pid); }
            return;
          }
          if (e) this.hostHandle(e, msg);
        }),
        net.on('leave', (pid) => { if (this._ready) this.onLeave(pid); else this._queue.push(['l', pid]); }),
      ];
    } else {
      this._offs = [
        net.on('msg', (msg) => { if (this._ready) this.clientHandle(msg); else this._queue.push(['c', msg]); }),
        net.on('close', () => { if (!this.ended && this.app.match === this) { if (this.phase === 'queue' || this.mode.quickplay) this.app.leaveMatch('Lost the lobby host — searching again…', { requeue: true }); else this.app.leaveMatch('Disconnected from the match host.'); } }),
      ];
    }
  }

  async init() {
    const app = this.app;
    this.map = app.map;
    this.scene = this.map.scene; this.world = this.map.world;
    this.camera = new THREE.PerspectiveCamera(app.settings.fov, app.aspect, 0.08, 3000);
    const Q = this.map.Q;
    this.fx = new Fx(this.scene, this.world, Q.lights, Q.particles);
    // without bloom, additive HDR fire saturates to white; tone it down
    if (!app.composer || app.noPost) this.fx.fire.mat.uniforms.uGain.value = 0.55;
    this.proj = new Projectiles(this);
    this.templates = {};
    // every mage's model (players can drop in mid-match with any of them)
    // (a model that can't be loaded never stops the match: that mage borrows a model that did load)
    const loaded = await Promise.allSettled(MAGE_LIST.map((md) => loadMageModel(md.model)));
    loaded.forEach((r, i) => { if (r.status === 'fulfilled') this.templates[MAGE_LIST[i].id] = r.value; else console.error('model', MAGE_LIST[i].model, r.reason); });
    const anyT = this.templates.pyro || Object.values(this.templates)[0];
    if (!anyT) throw new Error('no character models could be loaded');
    for (const md of MAGE_LIST) if (!this.templates[md.id]) this.templates[md.id] = anyT;
    this.voidFx = new UnlimitedVoid(this.map);
    this.chessWorld = new ChessWorld(this);
    this.domain = null;
    this._warmupShaders();
    const list = [...this.players];
    if (this.cfg.mode === 'practice') {
      for (let i = 0; i < 5; i++) list.push({ n: 100 + i, id: `dummy-${i}`, name: 'Training Dummy', tag: '', dummy: true });
    }
    for (const p of list) this._makeEnt(p);
    this.local = this.byId.get(this.localId);
    this.view = this.local.view;
    this.body = new Body();
    this.cam = new ShoulderCamera(this.camera, this.world);
    this.cam.side = app.settings.shoulder || 1;
    this.cam.baseFov = app.settings.fov;
    this.mageDef = mageOf(this.local.mage);
    this.kit = new this.mageDef.Kit(this);
    this.body.setPerk(this.mageDef.perk);
    this.sigils = new Map(); // owner n → [handles]

    if (this.isHost) this.rules = new Rules(this);
    addRecent(this.players.filter((p) => p.id !== this.localId && !p.dummy));
    app.hud.enterMatch(this);
    if (this.rules) this.rules.start();
    this._ready = true;
    for (const q of this._queue) {
      if (q[0] === 'c') this.clientHandle(q[1]);
      else if (q[0] === 'h') { const e = this.byId.get(q[1]); if (e) this.hostHandle(e, q[2]); }
      else this.onLeave(q[1]);
    }
    this._queue.length = 0;
    // camera starts behind the local spawn
    this._placeCamera();
  }

  // ---------------------------------------------------------------- dash afterimages
  // Glowing copies of the character frozen in its current pose, left behind along the dash.
  _ghost(e) {
    this.ghosts = this.ghosts || [];
    let g = this.ghosts.find((x) => x.t <= 0 && x.mage === e.mage);
    if (!g) {
      if (this.ghosts.length >= 10) return;
      const inst = new MageInstance(this.templates[mageOf(e.mage).id] || this.templates.pyro, { lowPoly: true, outlines: false });
      const mat = new THREE.MeshBasicMaterial({ color: e.mage === 'meteora' ? new THREE.Color(2.2, 0.35, 0.6) : e.mage === 'sorcerer' ? new THREE.Color(0.6, 1.4, 3.0) : (e.mage === 'kineslayer' || e.mage === 'manipulator') ? new THREE.Color(0.9, 0.95, 1.1) : new THREE.Color(2.4, 0.9, 0.25), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      for (const m of inst.meshes) { m.material = mat; if (m.userData.outline) m.visible = false; }
      inst.setLod(true);
      this.scene.add(inst.root);
      g = { inst, mat, t: 0, mage: e.mage };
      this.ghosts.push(g);
    }
    const src = e.view, dst = g.inst;
    for (let i = 0; i < src.rig.bones.length; i++) {
      const a = src.rig.bones[i], b = dst.rig.bones[i];
      if (a && b) { b.quaternion.copy(a.quaternion); b.position.copy(a.position); }
    }
    dst.root.position.copy(src.root.position); dst.root.rotation.copy(src.root.rotation);
    dst.root.visible = true;
    g.t = 0.32; g.mat.opacity = 0.55;
  }

  _updateGhosts(dt) {
    if (!this.ghosts) return;
    for (const g of this.ghosts) {
      if (g.t <= 0) continue;
      g.t -= dt;
      g.mat.opacity = Math.max(0, g.t / 0.32) * 0.55;
      if (g.t <= 0) g.inst.root.visible = false;
    }
  }

  _makeEnt(p) {
    if (this.byId.has(p.id)) return this.byId.get(p.id);
    const Q = this.map.Q;
    const groundAt = (x, z) => this.world.groundAt(x, z, 1e9);
    const e = new Ent(p, p.id === this.localId);
    e.view = new MageInstance(this.templates[mageOf(e.mage).id] || this.templates.pyro, { groundAt, outlines: Q.outlines, lowPoly: !Q.outlines }).uniqueMaterials();
    if (e.dummy) for (const mesh of e.view.meshes) if (!mesh.userData.outline) { mesh.material.color.setRGB(0.55, 0.5, 0.42); mesh.material.emissive.multiplyScalar(0.45); }
    e.view.setVisible(false);
    this.scene.add(e.view.root);
    // footfall dust puffs (close to the camera only)
    e.view.anim.onFootPlant = (side, speed) => {
      const f = e.view.rig.bones[side === 'L' ? 16 : 20].getWorldPosition(tmpV2);
      if (f.distanceToSquared(this.camera.position) < 900 && this.world.inWater(f.x, f.z) <= 0) this.fx.dust(f, Math.min(1, speed / 6));
    };
    if (!e.isLocal) e.view.setEnemy(true); // everyone else is an enemy in FFA
    this.ents.set(e.n, e); this.byId.set(e.id, e);
    return e;
  }

  // ---------------------------------------------------------------- queue lobby (FFA)
  // While matchmaking, the queue host runs this match in a 'queue' phase: everyone who joins
  // spawns in immediately and can roam/fight. When the lobby fills, goLive() starts the match.
  hostAddPlayer(p) {
    if (!this.isHost || this.byId.has(p.id)) return;
    const e = this._makeEnt(p);
    this.players.push(p);
    this.net.broadcast({ t: 'join', p }, p.id);
    this._catchUp(p.id, e);
    this.rules.spawn(e);
    this.rules.sendBoard();
    this.app.chat.system(`${p.name} joined the ${this.mode.quickplay ? 'match' : 'lobby'}.`);
  }

  // Never leave a client standing in an empty world: if the host's spawn hasn't arrived a few
  // seconds after loading in, ask for it (again and again); if the host stops talking entirely, or
  // we still aren't in after a long while, go back to the queue instead of hanging.
  _joinWatchdog(dt) {
    if (this.ended) return;
    this._hostQuiet = (this._hostQuiet || 0) + dt;
    if (this._hostQuiet > 12) { this.app.leaveMatch('Lost contact with the match host — searching again…', { requeue: !!this.cfg.queue }); return; }
    if (this._spawned) return;
    this._askT = (this._askT || 0) - dt;
    if (this.time > 3 && this._askT <= 0) {
      this._askT = 2.5;
      const me = this.local;
      this.net.send({ t: 'needSpawn', p: { id: me.id, name: me.name, tag: me.tag, mage: me.mage } });
    }
    if (this.time > 20) this.app.leaveMatch('Could not join the match — searching again…', { requeue: !!this.cfg.queue });
  }

  // catch a (re)joining player up: where everyone else is, the phase
  _catchUp(pid, e) {
    for (const o of this.ents.values()) {
      if (o === e || !o.alive) continue;
      const pos = o.isLocal ? this.body.pos : o.pos;
      this.net.send(pid, { t: 'spawn', n: o.n, x: pos.x, y: pos.y, z: pos.z, yaw: o.isLocal ? this.body.yaw : o.yaw, quiet: 1 });
    }
    this.net.send(pid, { t: 'phase', p: this.rules.phase, tl: Math.max(0, this.rules.phaseEnd - this.rules.now) });
    this.rules.sendBoard();
  }

  _placeCamera() {
    this.cam.update(0.016, this.body.pos, false);
  }

  // ---------------------------------------------------------------- outgoing
  sendToHost(msg) {
    if (this.isHost) this.hostHandle(this.local, msg);
    else this.net.send(msg);
  }

  playAnim(kind, data = {}) {
    this.view.anim.play(kind, data);
    this.sendToHost({ t: 'ev', k: 'anim', a: kind, d: data });
  }

  // owner casts an ability: spawn locally (with damage authority) and tell everyone
  toggleShiftLock(on = !this.cam.free) {
    this.cam.free = on;
    this.app.hud.banner(on ? 'SHIFT-LOCK OFF' : 'SHIFT-LOCK ON', on ? 'Camera orbits freely · Shift to lock' : 'Character faces the camera · Shift to unlock', 1.1);
  }

  castAbility(data) {
    this.faceLockT = 0.8; // free camera: turn to the crosshair to cast
    this.spawnAbility(this.local, data, true);
    this.sendToHost({ t: 'ev', k: 'ab', ...data });
  }

  reportHit(target, dmg, ab, extra = {}) {
    if (!target || !target.alive) return;
    const msg = { t: 'hit', v: target.n, dmg, ab, head: extra.head ? 1 : 0 };
    if (extra.burn) msg.burn = extra.burn;
    if (extra.kb) msg.kb = extra.kb;
    if (extra.slow) msg.slow = extra.slow;
    if (extra.stun) msg.stun = extra.stun;
    if (extra.nul) msg.nul = 1;
    this.sendToHost(msg);
    // instant feedback (host confirms HP)
    this.app.hud.hitMarker(extra.head, dmg);
    this.app.hud.damageNumber(extra.at || target.pos, dmg, extra.head);
    Audio.play(extra.head ? 'head' : 'hit', 0.6);
    if (!/^(nova|meteor|adolla|zero|sever|checkmate)/.test(ab)) this.kit.addUlt(Math.min(dmg, 40) * (target.dummy ? 0.12 : 0.22) * BAL.ult);
  }

  // owner-side area damage with linear falloff; opts: { burn:[dps, secs], kb: speed, up }
  areaDamage(c, radius, maxD, minD, ab, opts = {}) {
    for (const e of this.ents.values()) {
      if (e === this.local || !e.alive || e === opts.skip) continue;
      const d = tmpV.set(e.pos.x - c.x, e.pos.y + 0.9 - c.y, e.pos.z - c.z).length();
      if (d > radius + 0.4) continue;
      // line of sight from the blast to the body (walls/rocks shelter) — the nova ignores cover
      if (!opts.noCover) {
        const dir = tmpV2.copy(tmpV).normalize();
        const block = this.world.raycast(c.x, c.y + 0.3, c.z, dir.x, dir.y, dir.z, Math.max(0, d - 0.5), 0, null, true);
        if (block < d - 0.6) continue;
      }
      const k = Math.min(1, Math.max(0, d / radius));
      const dmg = Math.round(maxD + (minD - maxD) * k);
      const extra = { at: new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z) };
      if (opts.burn) extra.burn = opts.burn;
      if (opts.slow) extra.slow = opts.slow;
      if (opts.kb) {
        const hx = e.pos.x - c.x, hz = e.pos.z - c.z, hl = Math.hypot(hx, hz) || 1;
        const s = opts.kb * (1 - k * 0.5);
        extra.kb = [hx / hl * s, opts.up != null ? opts.up : 4.5, hz / hl * s];
      }
      this.reportHit(e, dmg, ab, extra);
    }
  }

  onUltReady() { Audio.play('ultReady', 0.7); this.app.hud.flashUlt(); }

  // ---------------------------------------------------------------- ability effects (all clients)
  spawnAbility(e, d, local) {
    if (!e) return;
    switch (d.ab) {
      case 'bolt': this.proj.spawn(e.n, 'bolt', d.o, d.d, local); if (!local) this.sound('bolt', tmpV.fromArray(d.o), 0.5, 30); break;
      case 'orb': this.proj.spawn(e.n, 'orb', d.o, d.d, local); if (!local) this.sound('orb', tmpV.fromArray(d.o), 0.7, 35); break;
      case 'wall': this._wall(e, d, local); break;
      // ---------------- M1 combo (Shoto / Sorcerer)
      case 'm1': {
        const i = Number(d.i) || 0, fin = i === 3, dir = tmpV2.set(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        if (d.s === 'spear') {
          this.fx.slashSwing((k, out) => e.view.weaponTip(out, k), dir.clone(), i, Array.isArray(d.o) ? new THREE.Vector3().fromArray(d.o) : e.pos.clone());
          if (!local) this.sound('slash', e.pos, 0.5, 22);
          break;
        }
        const o = Array.isArray(d.o) ? new THREE.Vector3().fromArray(d.o) : e.pos.clone();
        if (d.s === 'chess') { // the Manipulator: right straight, elbow, low kick, palm
          const getC = i === 2 ? (out) => e.view.rig.bones[20].getWorldPosition(out) : i === 1 ? (out) => e.view.rig.bones[12].getWorldPosition(out) : (out) => e.view.palmWorld('R', out);
          this.fx.chessSwing(o, new THREE.Vector3(dir.x, 0, dir.z).normalize(), i, getC);
          if (!local) this.sound(fin ? 'kick' : 'swing', e.pos, 0.5, 22);
          break;
        }
        const getP = fin ? (out) => e.view.rig.bones[20].getWorldPosition(out) : (out) => e.view.palmWorld(i === 1 ? 'R' : 'L', out);
        this.fx.punchSwing(getP, dir.clone(), d.s, i, o);
        if (!local) this.sound(fin ? 'kick' : 'swing', e.pos, 0.5, 22);
        break;
      }
      case 'm1hit': {
        const p = new THREE.Vector3().fromArray(d.p), i = Number(d.i) || 0;
        if (d.s === 'spear') {
          this.fx.slashImpact(p, tmpV2.set(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).clone(), i === 3);
          this.sound(i === 3 ? 'slashHeavy' : 'slashHit', p, i === 3 ? 1 : 0.7, 30);
        } else if (d.s === 'chess') {
          this.fx.chessHit(p, tmpV2.set(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).clone(), i === 3);
          this.sound(i === 3 ? 'punchHeavy' : 'punchHit', p, i === 3 ? 1 : 0.7, 30);
          if (i === 3 && (e === this.local || d.v === this.local.n)) this.app.hud.impactFrames();
        } else {
          this.fx.punchImpact(p, tmpV2.set(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1), d.s, i === 3);
          this.sound(i === 3 ? 'punchHeavy' : 'punchHit', p, i === 3 ? 1 : 0.7, 30);
        }
        // hit-stop on both fighters, and the victim reels (alternating sides) or is launched
        const fin = i === 3;
        if (e.view) e.view.anim.hitStop(fin ? 0.1 : 0.055);
        const v = this.ents.get(d.v);
        if (v && v.alive && v.view && v !== e) {
          v.view.anim.play(fin ? 'launched' : 'stagger');
          v.view.anim.hitStop(fin ? 0.12 : 0.07);
          // impact frame: the victim flat-filled in the striker's colour for a few frames
          const sil = d.s === 'cursed' ? [0.03, 0.22, 1.0] : d.s === 'spear' ? [0.95, 0.05, 0.05] : d.s === 'chess' ? [0.02, 0.02, 0.025] : (i === 1 || (fin && Math.random() < 0.5)) ? [1.0, 0.45, 0.05] : [0.3, 0.85, 1.0];
          this.fx.hitSilhouette(v.view, sil, fin ? 0.11 : 0.07);
          if (v === this.local) this.fx.shake(fin ? 0.35 : 0.12);
        }
        break;
      }
      // ---------------- Kine Slayer
      case 'flash': {
        const o = new THREE.Vector3().fromArray(d.o), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        this.fx.flashStep(o, dir, Math.min(30, Number(d.l) || 0), !!d.big);
        e.dashFx = 0.22;
        if (!local) this.sound('blink', o, 0.9, 30);
        break;
      }
      case 'ksHit': case 'nullHit': {
        const p = new THREE.Vector3().fromArray(d.p), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        const nul = d.ab === 'nullHit';
        if (nul) { this.fx.nullHit(p, dir); this.sound('nullify', p, 1, 40); }
        else { this.fx.slashImpact(p, dir, !!d.h); this.sound(d.h ? 'slashHeavy' : 'slashHit', p, 0.8, 30); }
        if (e.view) e.view.anim.hitStop(nul ? 0.1 : 0.05);
        const v = this.ents.get(d.v);
        if (v && v.alive && v.view && v !== e) { v.view.anim.play(nul || d.h ? 'launched' : 'stagger'); v.view.anim.hitStop(0.07); this.fx.hitSilhouette(v.view, nul ? [0.75, 0.85, 1.0] : [0.95, 0.05, 0.05], d.h ? 0.11 : 0.07); if (v === this.local) this.fx.shake(nul ? 0.4 : 0.15); }
        break;
      }
      case 'flashMark': {
        const p = new THREE.Vector3().fromArray(d.p), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        this.fx.flashMark(p, dir);
        break;
      }
      case 'flashReveal': {
        const p = new THREE.Vector3().fromArray(d.p), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        this.fx.flashReveal(p, dir); this.sound('slashHeavy', p, 1, 40);
        const v = this.ents.get(d.v);
        if (v && v.alive && v.view && v !== e) { v.view.anim.play('stagger'); v.view.anim.hitStop(0.09); if (v === this.local) this.fx.shake(0.3); }
        break;
      }
      case 'severHold': {
        const p = new THREE.Vector3().fromArray(d.p), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        this.fx.severHold(p, dir); this.sound('sever', p, 0.6, 50);
        if (!local && e.view) e.view.anim.play('ksD');
        if (e.view) e.view.anim.hitStop(0.3);
        const v = this.ents.get(d.v);
        if (v && v.view) v.view.anim.hitStop(0.34);
        break;
      }
      case 'severEnd': {
        const f = new THREE.Vector3().fromArray(d.f), o = new THREE.Vector3().fromArray(d.o);
        this.fx.severEnd(f, o); this.sound('blink', o, 0.8, 30);
        break;
      }
      case 'skyLeap': { const o = new THREE.Vector3().fromArray(d.o); this.fx.skyLeap(o); this.sound('leapUp', o, 1, 40); e.dashFx = 0.3; break; }
      case 'skyDive': {
        const o = new THREE.Vector3().fromArray(d.o), c = new THREE.Vector3().fromArray(d.c);
        this.fx.skyDive(o, c); this.sound('dive', o, 0.9, 40); e.dashFx = 0.5;
        break;
      }
      case 'skySlam': { const c = new THREE.Vector3().fromArray(d.c); this.fx.skySlam(c); this.sound('slam', c, 1, 60); if (!local) this.fx.shake(Math.max(0, 0.4 - this.local.pos.distanceTo(c) * 0.02)); break; }
      case 'nullCast': { this.fx.nullCast((k, out) => e.view.weaponTip(out, k)); this.sound('slash', e.pos, 0.6, 25); break; }
      // ---- Kine Slayer v2: thrown spear, whirlwind, world-cutting ultimate
      case 'spearThrow': {
        const o = new THREE.Vector3().fromArray(d.o), dir = new THREE.Vector3().fromArray(d.d).normalize();
        if (e.view) e.view.setWeaponVisible(false);
        if (e.spearFx) e.spearFx.dispose();
        e.spearFx = this.fx.flyingSpear(o, dir, 48);
        if (!local) this.sound('slash', o, 0.9, 30);
        break;
      }
      case 'spearStick': { if (e.spearFx) e.spearFx.stick(new THREE.Vector3().fromArray(d.p)); this.sound('slashHit', tmpV.fromArray(d.p), 0.7, 30); break; }
      case 'spearRecall': { if (e.spearFx) e.spearFx.recall(() => (e.view ? e.view.handWorld('R', new THREE.Vector3()) : e.pos.clone()), 58); this.sound('blink', tmpV.fromArray(d.p), 0.8, 30); break; }
      case 'spearCatch': { if (e.spearFx) { e.spearFx.dispose(); e.spearFx = null; } if (e.view) e.view.setWeaponVisible(true); this.sound('slash', e.pos, 0.6, 20); break; }
      case 'whirl': {
        const n = Number(d.n) || 5, g = Number(d.g) || 0.2;
        this.fx.whirlwind(() => e.pos, n, g);
        this.sound('sever', e.pos, 0.7, 40);
        break;
      }
      case 'severWind': {
        const o = new THREE.Vector3().fromArray(d.o);
        this.fx.severWind(o, 0.65);
        this.sound('sever', o, 1, 70);
        if (!local && e.view) e.view.anim.play('ksSever');
        break;
      }
      // ---------------- the Manipulator
      case 'knight': {
        const a = new THREE.Vector3().fromArray(d.a), c = new THREE.Vector3().fromArray(d.c), b = new THREE.Vector3().fromArray(d.b);
        this.fx.knightFork(a, c, b);
        if (!local) { if (e.view) e.view.anim.play('leap', { dir: 0 }); this.sound('blink', a, 0.8, 30); }
        setTimeout(() => this.sound('slam', b, 1, 45), 330);
        break;
      }
      case 'rook': {
        const c = new THREE.Vector3().fromArray(d.c), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).normalize();
        this.fx.rookFile(c, dir, ROOK.len, ROOK.dur);
        setTimeout(() => this.sound('slam', c, 1.1, 55), ROOK.drop * 1000);
        break;
      }
      case 'queen': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.fx.queenGambit(c, Number(d.yaw) || 0, QUEEN.len, QUEEN.delay);
        setTimeout(() => this.sound('slashHeavy', c, 1, 55), QUEEN.delay * 1000);
        break;
      }
      case 'checkmate': this._openCheckmate(e, d, local); break;
      // ---------------- Inkweaver
      case 'inkRush': {
        const o = new THREE.Vector3().fromArray(d.o), F = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).normalize();
        this.fx.inkRushTrail(o, F);
        if (!local && e.view) e.view.anim.play('dash', { dir: 0 });
        break;
      }
      case 'inkBeat': {
        const o = new THREE.Vector3().fromArray(d.o), F = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).normalize(), i = Number(d.i) || 0;
        this.fx.inkBeat(o, F, i, e.view);
        if (!local && e.view) e.view.anim.play(['m1a', 'm1c', 'slam'][i] || 'm1a');
        if (!local) this.sound(i === 2 ? 'slashHeavy' : 'slash', o, i === 2 ? 0.9 : 0.6, 25);
        break;
      }
      case 'inkOrb': {
        const c = new THREE.Vector3().fromArray(d.c), o = Array.isArray(d.o) ? new THREE.Vector3().fromArray(d.o) : null;
        this.fx.inkOrb(c, o, INK_ORB.delay, INK_ORB.life, INK_ORB.burstR);
        this.sound('blueOn', c, 0.9, 50); this.sound('vortex', c, 0.7, 50);
        setTimeout(() => this.sound('slam', c, 1, 60), (INK_ORB.delay + INK_ORB.life) * 1000);
        if (!local && e.view) e.view.anim.play('cast', { anim: 'gBlue' });
        break;
      }
      case 'inkArray': {
        const o = new THREE.Vector3().fromArray(d.o), F = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).normalize();
        this.fx.taiChiArray(o, 4.2, INK_ERUPT.charge + 0.6, { spin: 2.2 });
        if (e.view) this.fx.inkWings((out) => e.view.rig.bones[3].getWorldPosition(out), () => Math.atan2(F.x, F.z), 0.9, INK_ERUPT.charge + 0.5, { spread: 0.35, flap: 0.06 });
        this.sound('domainCast', o, 0.6, 50);
        if (!local && e.view) e.view.anim.play('cast', { anim: 'gRed' });
        break;
      }
      case 'inkErupt': {
        const o = new THREE.Vector3().fromArray(d.o), F = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1).normalize();
        this.fx.inkErupt(o, F, INK_ERUPT.len, INK_ERUPT.width);
        this.sound('slam', o, 1.3, 80); this.sound('slashHeavy', o, 1, 80);
        break;
      }
      case 'talisman': this._openTalisman(e, d, local); break;
      case 'severWave': {
        const o = new THREE.Vector3().fromArray(d.o), dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        this.fx.severWave(o, dir, !!d.v, 40, 60, 10);
        this.sound('slashHeavy', o, 1.3, 90);
        if (o.distanceTo(this.local.pos) < 30 && e !== this.local) { this.fx.shake(0.4); this.app.hud.dashImpact(); }
        break;
      }
      case 'severStart': { const o = new THREE.Vector3().fromArray(d.o); this.fx.severStart(o); this.sound('sever', o, 1, 60); e.dashFx = 1.0; break; }
      case 'severCut': {
        const from = new THREE.Vector3().fromArray(d.f), to = new THREE.Vector3().fromArray(d.o), p = new THREE.Vector3().fromArray(d.p);
        const dir = new THREE.Vector3(Number(d.d[0]) || 0, 0, Number(d.d[1]) || 1);
        this.fx.severCut(from, to, p, dir, !!d.fin);
        this.sound(d.fin ? 'slashHeavy' : 'slashHit', p, 1, 45);
        this.sound('blink', to, 0.5, 30);
        e.dashFx = Math.max(e.dashFx || 0, 0.12);
        if (!local && e.view) { e.view.anim.play(d.fin ? 'ksD' : ['ksA', 'ksB', 'ksC'][(Number(d.i) || 0) % 3]); }
        if (e.view) e.view.anim.hitStop(d.fin ? 0.12 : 0.05);
        const v = this.ents.get(d.v);
        if (v && v.alive && v.view) { v.view.anim.play(d.fin ? 'launched' : 'stagger'); v.view.anim.hitStop(d.fin ? 0.14 : 0.06); if (v === this.local) { this.fx.shake(d.fin ? 0.5 : 0.18); if (d.fin) this.app.hud.dashImpact(); } }
        break;
      }
      // ---------------- Sorcerer
      case 'flick': this.proj.spawn(e.n, 'flick', d.o, d.d, local); if (!local) this.sound('flick', tmpV.fromArray(d.o), 0.5, 30); break;
      case 'blue': {
        const c = new THREE.Vector3().fromArray(d.c), from = Array.isArray(d.o) ? new THREE.Vector3().fromArray(d.o) : null;
        this.sound('blueOn', c, 1, 45);
        const ar = { kind: 'blue', c, t: -BLUE.delay, life: BLUE.life, owner: e.n, local, tick: 0 };
        setTimeout(() => {
          if (this.app.match !== this) return;
          this.fx.blueOrb(c, from, BLUE.life, BLUE.pullR, () => {
            this.sound('blueImplode', c, 1, 40);
            if (local) this.areaDamage(c, BLUE.crushR, BLUE.implode, BLUE.implode * 0.6, 'blue', { kb: 3, up: 3 });
          });
        }, BLUE.delay * 1000);
        this.areas.push(ar);
        break;
      }
      case 'redCharge': this.fx.redCharge((out) => e.view.palmWorld('R', out), RED.charge); this.sound('redCharge', e.pos, 0.8, 30); break;
      case 'red': this.proj.spawn(e.n, 'red', d.o, d.d, local); this.sound('redFire', tmpV.fromArray(d.o), 0.9, 40); break;
      case 'purpleCharge':
        // Blue is summoned on his left, Red on his right, either side of the point where they mix
        const at = (side) => (out) => {
          const yw = e === this.local ? this.body.yaw : e.yaw, p = e === this.local ? this.body.pos : e.pos;
          const fx = Math.sin(yw), fz = Math.cos(yw);
          return out.set(p.x + fx * PURPLE.front + fz * side, p.y + PURPLE.height, p.z + fz * PURPLE.front - fx * side);
        };
        // …but first they appear behind him, Red over his right shoulder, Blue over his left
        const behind = (side) => (out) => {
          const yw = e === this.local ? this.body.yaw : e.yaw, p = e === this.local ? this.body.pos : e.pos;
          const fx = Math.sin(yw), fz = Math.cos(yw);
          return out.set(p.x - fx * PURPLE.back + fz * side, p.y + PURPLE.backH, p.z - fz * PURPLE.back - fx * side);
        };
        this.fx.purpleCharge(at(PURPLE.spread), at(-PURPLE.spread), at(0), PURPLE.charge, PURPLE.orbsAt, PURPLE.formR, behind(PURPLE.backSpread), behind(-PURPLE.backSpread));
        this.sound('purpleCharge', e.pos, 1, 50);
        break;
      case 'purple': {
        const o = new THREE.Vector3().fromArray(d.o), dir = new THREE.Vector3().fromArray(d.d).normalize();
        this.fx.hollowPurple(o, dir, PURPLE.len, PURPLE.speed, PURPLE.radius, PURPLE.formR);
        this.sound('purpleFire', o, 1.3, 90);
        this.areas.push({ kind: 'purple', o, dir, t: 0, owner: e.n, local, hit: new Set() });
        break;
      }
      case 'domainCast':
        this.sound('domainCast', e.pos, 1, 60);
        if (e !== this.local && e.alive && Math.hypot(this.body.pos.x - e.pos.x, this.body.pos.z - e.pos.z) < VOID.radius + 6) this.app.hud.banner('DOMAIN EXPANSION', 'GET AWAY FROM HIM!', 1.2, 'kill');
        break;
      case 'domain': this._openDomain(e, d, local); break;
      case 'spark': {
        const big = !!d.big;
        this.proj.spawn(e.n, big ? 'sparkBig' : 'spark', d.o, d.d, local);
        this.fx.tipSeal(tmpV.fromArray(d.o), tmpV2.fromArray(d.d).normalize(), big ? 1.25 : 0.75, big ? 0.55 : 0.4, big ? 2 : 1);
        if (big) this.fx.arcaneBurst(tmpV.fromArray(d.o), tmpV2.fromArray(d.d).normalize(), 1.4);
        if (!local) this.sound('spark', tmpV.fromArray(d.o), big ? 0.8 : 0.5, 30);
        break;
      }
      // ---- Pyro: Fire Force kit
      case 'kick': {
        const o = new THREE.Vector3().fromArray(d.o);
        const dx = d.d[0], dz = d.d[1], L = Math.min(KICK.speed * KICK.time, Number(d.l) || 0);
        const a = new THREE.Vector3(o.x, o.y, o.z), b = new THREE.Vector3(o.x + dx * L, 0, o.z + dz * L);
        b.y = this.world.groundAt(b.x, b.z, o.y + 3);
        e.kickT = KICK.time + 0.05;
        this.fx.fireTrail(a, b, 3.5, KICK.time, 0.55);
        this.areas.push({ kind: 'trail', a, b, w: 1.0, t: 0, life: 3.5, tick: 0.3, owner: e.n, local, dmg: 6, ab: 'trail', burn: [3, 1.5] });
        this.sound('kick', o, 1, 35);
        break;
      }
      case 'kickHit': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.fx.kickImpact(c, d.d[0], d.d[1]);
        this.sound('kickHit', c, 1, 40);
        break;
      }
      // ---- Shoto: frost & flame
      case 'shard': this.proj.spawn(e.n, 'shard', d.o, d.d, local); if (!local) this.sound('iceShot', tmpV.fromArray(d.o), 0.45, 30); break;
      case 'freeze': {
        const o = new THREE.Vector3().fromArray(d.o), c = new THREE.Vector3().fromArray(d.c);
        this.fx.iceSurge(o, c, FREEZE.radius, FREEZE.root);
        this.sound('freeze', c, 1, 45);
        if (local) {
          for (const t of this.ents.values()) {
            if (t === this.local || !t.alive) continue;
            if (Math.hypot(t.pos.x - c.x, t.pos.z - c.z) < FREEZE.radius + 0.4 && Math.abs(t.pos.y - c.y) < 2.5) {
              this.kit.frozen && this.kit.frozen.set(t.n, this.time);
              this.reportHit(t, FREEZE.dmg, 'freeze', { slow: [0.02, FREEZE.root], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.2, t.pos.z) });
            }
          }
        }
        break;
      }
      case 'heatwave': {
        const o = new THREE.Vector3().fromArray(d.o), ux = d.d[0], uz = d.d[1];
        this.fx.heatWave(o, ux, uz, FREEZE.waveLen, FREEZE.waveHalf);
        this.sound('stomp', o, 0.9, 45);
        if (local) {
          for (const t of this.ents.values()) {
            if (t === this.local || !t.alive) continue;
            const dx = t.pos.x - o.x, dz = t.pos.z - o.z, dl = Math.hypot(dx, dz);
            if (dl > FREEZE.waveLen + 0.5 || dl < 0.01 || Math.abs(t.pos.y - o.y) > 3) continue;
            if ((dx * ux + dz * uz) / dl < Math.cos(FREEZE.waveHalf + 0.15)) continue;
            const ft = this.kit.frozen ? this.kit.frozen.get(t.n) : undefined;
            const shattered = ft !== undefined && this.time - ft < FREEZE.root + 0.6;
            const at = new THREE.Vector3(t.pos.x, t.pos.y + 1.2, t.pos.z);
            if (shattered) { this.kit.frozen.delete(t.n); this.castAbility({ ab: 'shatter', c: [at.x, at.y, at.z] }); }
            this.reportHit(t, FREEZE.waveDmg + (shattered ? FREEZE.shatter : 0), 'heatwave', { burn: [5, 2.5], at, kb: shattered ? [dx / dl * 11, 7, dz / dl * 11] : [dx / dl * 4, 2, dz / dl * 4] });
          }
        }
        break;
      }
      case 'shatter': { const c = new THREE.Vector3().fromArray(d.c); this.fx.shatter(c); this.sound('iceShatter', c, 1, 40); break; }
      case 'lanceCharge': { this.fx.lanceCharge(new THREE.Vector3().fromArray(d.o)); this.sound('adollaCharge', tmpV.fromArray(d.o), 0.6, 40, 1.8); break; }
      case 'lance': {
        const o = new THREE.Vector3().fromArray(d.o), t = new THREE.Vector3().fromArray(d.t);
        this.fx.lanceBeam(o, t);
        this.sound('lance', o, 1, 80);
        break;
      }
      case 'blitz': {
        const o = new THREE.Vector3().fromArray(d.o), L = Math.min(BLITZ.speed * BLITZ.time, Number(d.l) || 0);
        const b = new THREE.Vector3(o.x + d.d[0] * L, 0, o.z + d.d[1] * L); b.y = this.world.groundAt(b.x, b.z, o.y + 3);
        this.fx.frostPath(o, b, 2.5);
        e.blitzT = BLITZ.time + 0.05;
        this.sound('blitz', o, 1, 40);
        break;
      }
      case 'uppercut': {
        const c = new THREE.Vector3().fromArray(d.c);
        e.blitzT = 0;
        this.fx.uppercutBurst(c);
        this.sound('kickHit', c, 1, 40);
        if (local) this.areaDamage(c, 2.4, BLITZ.dmg, 28, 'uppercut', { kb: 3, up: 15, burn: [4, 2], slow: [0.6, 1.5] });
        break;
      }
      case 'zero': {
        const o = new THREE.Vector3().fromArray(d.o);
        this.sound('freeze', o, 1.2, 120);
        setTimeout(() => this.sound('adollaCharge', o, 1.2, 140), 700);
        this.fx.zeroBurn(o, ZERO.radius, ZERO.freezeAt, ZERO.boomAt,
          () => {
            this.sound('iceShatter', o, 1, 120);
            if (local) for (const t of this.ents.values()) {
              if (t === this.local || !t.alive) continue;
              if (Math.hypot(t.pos.x - o.x, t.pos.z - o.z) < ZERO.radius && Math.abs(t.pos.y - o.y) < 8) this.reportHit(t, ZERO.freezeDmg, 'zero', { slow: [0.02, ZERO.root], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.2, t.pos.z) });
            }
          },
          () => {
            this.app.hud.flash(0.8);
            Audio.play('novaBoom', 1.1);
            if (local) this.areaDamage(new THREE.Vector3(o.x, o.y + 1, o.z), ZERO.radius, ZERO.dmg, ZERO.minDmg, 'zeroBoom', { kb: 12, up: 10, noCover: true, burn: [6, 3] });
          });
        break;
      }
      case 'blast': this.proj.spawn(e.n, 'blast', d.o, d.d, local); if (!local) this.sound('ember', tmpV.fromArray(d.o), 0.7, 30); break;
      case 'ember': this.proj.spawn(e.n, 'ember', d.o, d.d, local); if (!local && Math.random() < 0.5) this.sound('ember', tmpV.fromArray(d.o), 0.4, 25); break;
      case 'igniteBoom': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.fx.igniteBoom(c, IGNITE.boomR);
        this.sound('explode', c, 0.8, 35);
        if (local) this.areaDamage(c, IGNITE.boomR, IGNITE.boomDmg, 18, 'igniteBoom', { kb: 5, up: 5 });
        break;
      }
      case 'step': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.fx.infernalStep(c, STEP.radius);
        e.boostT = STEP.boost;
        this.sound('stomp', c, 1, 45);
        if (local) this.areaDamage(c, STEP.radius, STEP.maxDmg, STEP.minDmg, 'step', { kb: 13, up: 6, slow: [STEP.slow, STEP.slowT], burn: [3, 2] });
        break;
      }
      case 'adolla': {
        const o = new THREE.Vector3().fromArray(d.o), dir = new THREE.Vector3().fromArray(d.d).normalize();
        const L = Math.min(ADOLLA.range, Number(d.l) || ADOLLA.range);
        this.sound('adollaCharge', o, 1.1, 80);
        this.fx.adolla(o, dir, L, {
          charge: ADOLLA.charge, beam: ADOLLA.beam,
          onFire: () => {
            this.sound('adollaBeam', o, 1.4, 160);
            // burning scar on the ground under the beam
            const a = new THREE.Vector3(o.x, 0, o.z), b = new THREE.Vector3(o.x + dir.x * L, 0, o.z + dir.z * L);
            a.y = this.world.groundAt(a.x, a.z, o.y + 2); b.y = this.world.groundAt(b.x, b.z, o.y + dir.y * L + 4);
            this.fx.fireTrail(a, b, ADOLLA.path, 0.12, 1.1);
            this.areas.push({ kind: 'trail', a, b, w: 1.6, t: 0, life: ADOLLA.path, tick: 0.2, owner: e.n, local, dmg: 8, ab: 'adollaPath', burn: [5, 2] });
            if (local) {
              // pierces: everyone along the beam, once
              const end = tmpV2.copy(o).addScaledVector(dir, L);
              for (const t of this.ents.values()) {
                if (t === this.local || !t.alive) continue;
                if (distToSeg3(t.pos, o, end) < ADOLLA.width) this.reportHit(t, ADOLLA.dmg, 'adolla', { kb: [dir.x * 11, 5, dir.z * 11], burn: [7, 3], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z) });
              }
              // recoil
              this.body.vel.x -= dir.x * 3; this.body.vel.z -= dir.z * 3;
            }
          },
        });
        break;
      }
      case 'starfall': {
        const c = new THREE.Vector3().fromArray(d.c);
        const raw = Array.isArray(d.p) ? d.p.slice(0, STARFALL.count * 3) : [c.x, c.y, c.z];
        const pts = [];
        for (let i = 0; i + 2 < raw.length; i += 3) pts.push(new THREE.Vector3(+raw[i], +raw[i + 1], +raw[i + 2]));
        this.sound('starCall', c, 0.9, 60);
        // the call goes up through a seal at the staff tip, and a big seal opens in the sky over the target
        if (e.view.root.visible) { const tip = e.view.staffTip(new THREE.Vector3()); this.fx.tipSeal(tip, tmpV2.set(c.x - tip.x, 40, c.z - tip.z), 1.0, 0.7, 2); }
        this.fx.tipSeal(new THREE.Vector3(c.x, c.y + 24, c.z), tmpV2.set(0, -1, 0), STARFALL.spread * 1.15, 2.2, 2);
        this.fx.starfallBarrage(pts, { first: STARFALL.first, gap: STARFALL.gap, radius: STARFALL.radius, onImpact: (p) => {
          this.sound('starHit', p, 0.8, 45);
          if (local) this.areaDamage(p, STARFALL.radius, STARFALL.dmg, STARFALL.minDmg, 'starfall', { kb: 4, up: 4 });
        } });
        break;
      }
      case 'rayCharge': {
        const RAYC = 1.3;
        this.fx.rayCharge(() => e.view.staffTip(new THREE.Vector3()), () => new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw)), RAYC);
        this.sound('novaChant', e.pos, 0.6, 50, 1.6);
        break;
      }
      case 'ray': {
        const o = new THREE.Vector3().fromArray(d.o), t = new THREE.Vector3().fromArray(d.t);
        this.fx.rayBeam(o, t);
        this.sound('adollaBeam', o, 1.1, 90, 1.25);
        break;
      }
      case 'sigilPull': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.fx.sigilVortex(c, 1.9, 0.4);
        this.sound('vortex', c, 0.9, 35);
        if (local) {
          for (const t of this.ents.values()) {
            if (t === this.local || !t.alive) continue;
            const dx = c.x - t.pos.x, dz = c.z - t.pos.z, dl = Math.hypot(dx, dz);
            if (dl > 5.5 || Math.abs(t.pos.y - c.y) > 2.5) continue;
            const k = Math.min(12, dl * 3.4) / (dl || 1);
            this.reportHit(t, 5, 'sigil', { kb: [dx * k, 3, dz * k], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.2, t.pos.z) });
          }
        }
        break;
      }
      case 'sigil': {
        const c = new THREE.Vector3().fromArray(d.c);
        const h = this.fx.sigil(c, 1.9, 0.7);
        h.id = d.id; h.owner = e.n; h.local = local;
        const list = this.sigils.get(e.n) || [];
        list.push(h);
        while (list.length > 2) { const old = list.shift(); old.remove(); }
        this.sigils.set(e.n, list);
        this.sound('sigil', c, 0.7, 25);
        break;
      }
      case 'sigilBoom': {
        const list = this.sigils.get(e.n) || [];
        const i = list.findIndex((h) => h.id === d.id);
        const h = i >= 0 ? list.splice(i, 1)[0] : null;
        const c = h ? h.pos : new THREE.Vector3().fromArray(d.c);
        if (h) h.remove();
        this.fx.explosion(c, 3.4, 1.3);
        this.fx.sparkBurst(c, 3.4);
        this.sound('explode', c, 1, 40);
        if (local) this.areaDamage(c, 3.4, 65, 25, 'sigil', { kb: 4, up: 9 });
        break;
      }
      case 'blink': {
        const a = new THREE.Vector3().fromArray(d.o), b = new THREE.Vector3().fromArray(d.t);
        this.fx.blinkFx(a, b);
        this.fx.ring(b, 2.4, 0.3, new THREE.Color(3, 0.6, 0.4));
        this.sound('blink', b, 0.8, 30);
        this.fx.blinkEcho(a, 0.65, (c) => {
          this.sound('explode', c, 0.8, 35);
          if (local) this.areaDamage(c, 3.2, 30, 12, 'blink', { kb: 6, up: 5 });
        });
        if (!local) e.snaps.length = 0;
        break;
      }
      case 'nova': {
        const c = new THREE.Vector3().fromArray(d.c), o = new THREE.Vector3().fromArray(d.o);
        // real time (no cutscene): seals stack over the target, the beam drives down, boom at 2.35 s
        this.app.hud.novaWarning(c, NOVA.radius, local);
        const near = () => local || this.camera.position.distanceTo(c) < NOVA.radius * 3;
        this.fx.nova(c, o, {
          radius: NOVA.radius, channel: NOVA.channel, beam: 0.4,
          stagger: [0.15, 0.36, 0.57, 0.78, 0.99, 1.2, 1.41],
          onLayer: (i) => Audio.play('circleOn', 0.45 + i * 0.06, 0, 0.9 + i * 0.05),
          onFlash: () => {
            // anime impact frames, then the light
            if (near()) this.app.hud.flash(0.85);
            this.fx.shake(near() ? 0.9 : 0.3);
            Audio.play('novaBoom', near() ? 1.4 : 0.8);
            setTimeout(() => Audio.play('rumble', 1), 400);
            this.fx.shockwave(c, NOVA.radius * 3.2, 1.6);
            this.fx.debris(c, 110, 34);
          },
          onImpact: () => {
            if (local) this.areaDamage(c, NOVA.radius, NOVA.maxDmg, NOVA.minDmg, 'nova', { kb: 16, up: 12, noCover: true, burn: [8, 3] });
            // …and it keeps going: aftershocks reach past the kill radius, the crater burns, and
            // burning fragments of the sky rain down across the area (same spots on every client)
            const rnd = seeded(Math.floor(c.x * 131 + c.z * 977 + c.y * 31));
            const frags = [];
            for (let i = 0; i < NOVA.frags; i++) {
              const a = rnd() * Math.PI * 2, r = NOVA.radius * (0.35 + rnd() * 1.25);
              frags.push([c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0.5 + i * (4.2 / NOVA.frags) + rnd() * 0.3]);
            }
            this.fx.novaAftermath(c, NOVA.radius, frags, (p) => {
              this.sound('explode', p, 0.9, 60);
              if (local) this.areaDamage(p, 3.2, NOVA.fragDmg, 25, 'novaFrag', { kb: 8, up: 7, burn: [5, 2] });
            });
            if (local) {
              setTimeout(() => { if (this.local) this.areaDamage(c, NOVA.radius * 1.8, NOVA.shockDmg, 30, 'novaShock', { kb: 12, up: 6, noCover: true }); }, 900);
              this.areas.push({ kind: 'crater', c: c.clone(), r: NOVA.radius * 0.5, t: 0, life: 7, tick: 0.4, owner: e.n, local, dmg: 5, ab: 'novaBurn', burn: [4, 2] });
            }
            setTimeout(() => Audio.play('rumble', 0.8), 1500);
            // the shockwave shoves the local player even outside the kill radius
            const me = this.local;
            if (me.alive && e !== me) {
              const dx = me.pos.x - c.x, dz = me.pos.z - c.z, dl = Math.hypot(dx, dz);
              if (dl < NOVA.radius * 2.2 && dl > 0.1) { const k = (1 - dl / (NOVA.radius * 2.2)) * 14; this.body.vel.x += dx / dl * k; this.body.vel.z += dz / dl * k; this.body.vel.y = Math.max(this.body.vel.y, k * 0.5); this.body.grounded = false; }
            }
          },
        });
        // "EXPLOSION!": as she levels the staff, three seals stack open at its tip, aimed at the target
        setTimeout(() => {
          if (!e.view.root.visible) return;
          const tip = e.view.staffTip(new THREE.Vector3());
          this.fx.tipSeal(tip, new THREE.Vector3().subVectors(c, tip), 1.25, 1.1, 3);
        }, 1700);
        break;
      }
      case 'leap': {
        const o = new THREE.Vector3().fromArray(d.o);
        this.fx.leapBlast(o);
        this.sound('leap', o, 1, 40);
        e.leapT = 0.9;
        if (local) this.areaDamage(o, 3.8, 25, 15, 'leap', { kb: 11, up: 6 });
        break;
      }
      case 'meteor': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.sound('meteorFall', c, 1, 80);
        this.app.hud.meteorWarning(c);
        this.fx.meteor(c, 5.5, 1.35, () => {
          this.sound('meteorHit', c, 1.2, 90);
          this.fx.fireField(c, 4.2, 3.5);
          if (local) {
            this.areaDamage(c, 5.5, 95, 35, 'meteor', { kb: 13, up: 7, burn: [6, 3] });
            this.areas.push({ kind: 'field', c, r: 4.2, t: 0, life: 3.5, tick: 0, owner: e.n, local });
          }
        });
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- scripted camera (cine)
  // Crimson Nova no longer plays a cutscene (it runs in real time); these helpers drive the
  // camera only when something sets this.cine.
  _cineSetStage(on) {
    const C = this.cine;
    if (C.stageOn === on) return;
    C.stageOn = on;
    C.stage.setOn(on);
    if (C.novaFx) C.novaFx.visible = !on;
    for (const o of C.world) o.visible = !on;
    for (const e of this.ents.values()) if (e !== C.caster && e.alive) e.view.root.visible = !on;
    this.scene.fog.far = on ? 1e5 : 1300;
  }

  _cineUpdate(dt) {
    const C = this.cine;
    C.t += dt;
    const t = C.t;
    const subs = [
      [0.3, 'Crimson stars that sleep beneath the world…'],
      [2.0, 'Seven seals of ruin, open at my word.'],
      [3.7, 'Let the sky remember fire… and the earth remember fear.'],
      [5.4, ''],
      [5.95, 'EXPLOSION!', true],
      [6.6, ''],
    ];
    if (t >= 6.6 && !C.beamSnd) { C.beamSnd = true; Audio.play('adollaBeam', 1.2, 0, 0.7); }
    while (C.subs < subs.length && t >= subs[C.subs][0]) { const [, text, big] = subs[C.subs]; this.app.hud.cineSub(text, !!big); C.subs++; }
    // motion-design cues: title card, slash-wipe cuts, colour grades, the screen-space glyph
    const hud = this.app.hud;
    const cues = [
      [0.15, () => { hud.cineCard('CRIMSON NOVA', '爆 裂 魔 法'); hud.cineGrade('warm'); }],
      [2.2, () => hud.cineWipe(true)],
      [3.0, () => hud.cineWipe(false)],
      [3.6, () => { hud.cineWipe(true); hud.cineGrade(''); }],
      [5.4, () => { hud.cineWipe(true); hud.cineGrade('burn'); }],
      [6.55, () => { hud.flash(0.9); hud.cineGrade('cold'); }],
      [7.15, () => hud.cineGrade('')],
      [7.6, () => hud.cineGrade('burn')],
      [9.6, () => hud.cineGrade('')],
    ];
    C.cue = C.cue || 0;
    while (C.cue < cues.length && t >= cues[C.cue][0]) cues[C.cue++][1]();
    hud.cineGlyph(t < 3.6 ? Math.min(1, t / 0.8) * (t > 3.3 ? (3.6 - t) / 0.3 : 1) : t >= 5.4 && t < 6.5 ? 1 : 0);
    const onStage = t < 3.6 || (t >= 5.4 && t < 6.6);
    this._cineSetStage(onStage);
    if (C.novaFx) C.novaFx.visible = !onStage;
    const I = t < 3.6 ? Math.min(1, t / 3.2) : Math.min(1, 0.7 + (t - 5.4) / 1.2);
    C.stage.update(dt, I);
    this.app.hud.cineDark(onStage ? 0 : t < 7.2 ? 0.3 : Math.max(0, 0.45 - (t - 7.2) / 2));
    if (t >= C.dur) this._endCine();
  }

  _endCine() {
    const C = this.cine;
    if (!C) return;
    this.camera.up.set(0, 1, 0);
    if (C.end) { this.cine = null; C.end.call(this, C); this.app.hud.cineEnd(); this.cam.pivotY = null; return; }
    this._cineSetStage(false);
    C.stage.dispose();
    C.caster.view.anim.windBoost = 0;
    for (const e of this.ents.values()) if (e.alive) e.view.root.visible = true;
    this.cine = null;
    this.app.hud.cineEnd();
    this.cam.pivotY = null;
  }

  _cineCamera() {
    const C = this.cine, t = C.t, o = C.caster.pos, c = C.c, f = C.f, sd = C.side, cam = this.camera;
    const P = tmpV, L = tmpV2;
    const face = Math.atan2(f.x, f.z);
    const ease = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
    const expo = (k) => { k = Math.min(1, Math.max(0, k)); return 1 - Math.pow(2, -10 * k); };
    const view = C.caster.view;
    let fov = 50, roll = 0, hand = 0.012;
    if (t < 2.2) { // stage: crane up from low behind her shoulder and round to her front as the circle ignites
      const k = ease(t / 2.2);
      const a = face + Math.PI * 0.85 - k * Math.PI * 0.75, r = 3.9 - k * 0.9;
      P.set(o.x + Math.sin(a) * r, o.y + 0.35 + k * 0.9, o.z + Math.cos(a) * r);
      L.set(o.x, o.y + 1.0 + k * 0.25, o.z); fov = 44 - k * 6;
    } else if (t < 3.0) { // extreme close-up: her eye, the seal's light flickering across it
      const k = ease((t - 2.2) / 0.8);
      const hp = view.head.getWorldPosition(this._cv1 || (this._cv1 = new THREE.Vector3()));
      P.set(hp.x + f.x * (0.62 - k * 0.12) - sd.x * 0.1, hp.y + 0.05, hp.z + f.z * (0.62 - k * 0.12) - sd.z * 0.1);
      L.set(hp.x, hp.y + 0.07, hp.z); fov = 24; roll = -0.08; hand = 0.004;
    } else if (t < 3.6) { // tracking up the staff to the orb as it ignites
      const k = expo((t - 3.0) / 0.6);
      const tip = view.staffTip(this._cv2 || (this._cv2 = new THREE.Vector3()));
      const grip = view.handWorld('R', this._cv3 || (this._cv3 = new THREE.Vector3()));
      L.lerpVectors(grip, tip, 0.3 + k * 0.7);
      P.set(L.x + f.x * 1.15 + sd.x * 0.55, L.y - 0.25 + k * 0.1, L.z + f.z * 1.15 + sd.z * 0.55); fov = 30; roll = 0.06;
    } else if (t < 5.4) { // the battlefield: low behind her, craning up as the seals stack over the target
      const k = ease((t - 3.6) / 1.8);
      const back = NOVA.radius * 1.9;
      P.set(c.x - f.x * back + sd.x * 8, c.y + 4 + k * 5, c.z - f.z * back + sd.z * 8);
      L.set(c.x, c.y + 14 + k * 11, c.z); fov = 62 + k * 4; roll = -0.05 * k;
    } else if (t < 6.6) { // stage: accelerating spin, then a whip zoom and a hard dutch on the final word
      const k = (t - 5.4) / 1.2;
      const a = face + Math.PI * 0.2 + Math.pow(k, 1.6) * Math.PI * 1.8, r = 4.6 - ease(k) * 2.0;
      P.set(o.x + Math.sin(a) * r, o.y + 0.9 + k * 0.5, o.z + Math.cos(a) * r);
      L.set(o.x, o.y + 1.35, o.z);
      fov = t < 5.95 ? 58 : Math.max(26, 58 - expo((t - 5.95) / 0.5) * 32);
      roll = t < 5.95 ? 0.04 * k : -0.22 * expo((t - 5.95) / 0.3);
      hand = 0.02;
    } else if (t < 7.2) { // the beam: looking up from the battlefield as it drives down into the target
      const k = expo((t - 6.6) / 0.6);
      P.set(c.x - f.x * NOVA.radius * 1.7 + sd.x * 7, c.y + 3, c.z - f.z * NOVA.radius * 1.7 + sd.z * 7);
      L.set(c.x, c.y + 22 - k * 13, c.z); fov = 70 - k * 6; roll = 0.12;
    } else { // the catastrophe, from far away, slowly pushing in while the frame shakes and rolls
      const k = t - 7.2;
      const back = NOVA.radius * (3.0 - k * 0.15);
      P.set(c.x - f.x * back + sd.x * NOVA.radius * 1.1, c.y + 30 + k * 2.5, c.z - f.z * back + sd.z * NOVA.radius * 1.1);
      L.set(c.x, c.y + 12 + k * 4, c.z); fov = 66 - Math.min(6, k * 2);
      const sh = this.fx.shakeAmt * 0.7;
      P.x += Math.sin(t * 47) * sh; P.y += Math.sin(t * 59 + 1) * sh;
      roll = Math.sin(t * 31) * this.fx.shakeAmt * 0.04 - 0.03;
    }
    if (t >= 3.6 && (t < 5.4 || t >= 6.6)) P.y = Math.max(P.y, this.world.groundAt(P.x, P.z, P.y + 50) + 1.2);
    // a little handheld drift so nothing feels like a rail camera
    P.x += Math.sin(t * 1.7) * hand * 3; P.y += Math.sin(t * 2.3 + 1) * hand * 2; P.z += Math.cos(t * 1.3) * hand * 3;
    cam.position.copy(P); cam.lookAt(L);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return L;
  }

  _wall(e, d, local) {
    const c = new THREE.Vector3().fromArray(d.c);
    const ca = Math.cos(d.r), sa = Math.sin(d.r);
    // runs perpendicular to the cast direction (sin r, cos r)
    const half = 3.5;
    const a = new THREE.Vector3(c.x + ca * half, 0, c.z - sa * half), b = new THREE.Vector3(c.x - ca * half, 0, c.z + sa * half);
    a.y = this.world.groundAt(a.x, a.z, c.y + 3); b.y = this.world.groundAt(b.x, b.z, c.y + 3);
    const area = { kind: 'wall', a, b, c, t: 0, life: 5, tick: 0, owner: e.n, local, id: Math.random() };
    this.areas.push(area);
    // scorch line
    for (let i = 0; i <= 3; i++) { const t = i / 3; this.fx.scorch(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 1.4, 6); }
    this.fx.light(new THREE.Vector3(c.x, c.y + 1.4, c.z), 30, 10, 0.4);
    this.sound('wall', c, 1, 40);
  }

  _updateAreas(dt) {
    const L = this.listener();
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const ar = this.areas[i];
      ar.t += dt;
      if (ar.kind === 'wall') {
        const k = ar.t < 0.2 ? ar.t / 0.2 : ar.t > ar.life - 0.5 ? (ar.life - ar.t) / 0.5 : 1;
        this.fx.wallTick(ar.a, ar.b, Math.max(0.2, k), 2.6 * k + 0.3);
        if (Math.random() < dt * 6) this.fx.light(tmpV.set(ar.c.x, ar.c.y + 1.3, ar.c.z), 14, 9, 0.25);
        const dl = Math.hypot(ar.c.x - L.x, ar.c.z - L.z);
        Audio.loop('wall' + ar.id, 'fireLoop', 0.55 / (1 + (dl / 14) ** 2) * k);
        if (ar.local) {
          ar.tick -= dt;
          if (ar.tick <= 0) {
            ar.tick = 0.25;
            for (const e of this.ents.values()) {
              if (e === this.local || !e.alive) continue;
              const d = distToSegXZ(e.pos, ar.a, ar.b);
              const gy = ar.a.y + (ar.b.y - ar.a.y) * 0.5;
              if (d < 0.95 && e.pos.y < gy + 3.2 && e.pos.y > gy - 1.5) this.reportHit(e, 7, 'wall', { burn: [5, 2], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
            }
          }
        }
        if (ar.t >= ar.life) { Audio.stopLoop('wall' + ar.id); this.areas.splice(i, 1); }
      } else if (ar.kind === 'trail') {
        // burning ground along a segment (Devil's Foot trail, Adolla scar)
        if (ar.local) {
          ar.tick -= dt;
          if (ar.tick <= 0) {
            ar.tick = 0.5;
            for (const e of this.ents.values()) {
              if (e === this.local || !e.alive) continue;
              const gy = ar.a.y + (ar.b.y - ar.a.y) * 0.5;
              if (distToSegXZ(e.pos, ar.a, ar.b) < ar.w && e.pos.y < Math.max(ar.a.y, ar.b.y) + 2.2 && e.pos.y > Math.min(ar.a.y, ar.b.y) - 1.5) this.reportHit(e, ar.dmg, ar.ab, { burn: ar.burn, at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
              void gy;
            }
          }
        }
        if (ar.t >= ar.life) this.areas.splice(i, 1);
      } else if (ar.kind === 'blue') {
        // Lapse: Blue — drags everyone around it into the point, grinding those at the centre
        if (ar.t >= 0 && ar.t < ar.life) {
          const b = this.body, me = this.local;
          if (me.alive && me.n !== ar.owner) {
            const dx = ar.c.x - b.pos.x, dy = ar.c.y - (b.pos.y + 0.9), dz = ar.c.z - b.pos.z, dl = Math.hypot(dx, dy, dz);
            if (dl < BLUE.pullR && dl > 0.3) {
              const k = BLUE.pull * (1 - 0.55 * dl / BLUE.pullR) * dt;
              b.vel.x += dx / dl * k; b.vel.z += dz / dl * k; b.vel.y += Math.max(0, dy / dl) * k * 0.6;
              // in the crush zone you are held in place
              if (dl < BLUE.crushR) { b.vel.x *= 1 - Math.min(1, 6 * dt); b.vel.z *= 1 - Math.min(1, 6 * dt); }
            }
          }
          if (ar.local) {
            ar.tick -= dt;
            if (ar.tick <= 0) {
              ar.tick = BLUE.tick;
              for (const e of this.ents.values()) {
                if (e === this.local || !e.alive) continue;
                if (Math.hypot(e.pos.x - ar.c.x, e.pos.y + 0.9 - ar.c.y, e.pos.z - ar.c.z) < BLUE.crushR) this.reportHit(e, BLUE.tickDmg, 'blue', { at: new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z) });
              }
            }
          }
        }
        if (ar.t >= ar.life + 0.3) this.areas.splice(i, 1);
      } else if (ar.kind === 'purple') {
        // Hollow Purple — everything the sphere passes through takes the hit once
        const d = Math.min(PURPLE.len, ar.t * PURPLE.speed);
        const cx = ar.o.x + ar.dir.x * d, cy = ar.o.y + ar.dir.y * d, cz = ar.o.z + ar.dir.z * d;
        if (ar.local) {
          for (const e of this.ents.values()) {
            if (e === this.local || !e.alive || ar.hit.has(e.n)) continue;
            if (Math.hypot(e.pos.x - cx, e.pos.y + 0.9 - cy, e.pos.z - cz) < PURPLE.radius + 0.55) {
              ar.hit.add(e.n);
              this.reportHit(e, PURPLE.dmg, 'purple', { kb: [ar.dir.x * 12, 6, ar.dir.z * 12], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z) });
            }
          }
        }
        // the shockwave of its passing shoves the local player even when it misses
        const me = this.local;
        if (me.alive && me.n !== ar.owner) {
          const b = this.body, dx = b.pos.x - cx, dz = b.pos.z - cz, dl = Math.hypot(dx, dz);
          if (dl < PURPLE.radius * 2.6 && dl > 0.1) { const k = (1 - dl / (PURPLE.radius * 2.6)) * 30 * dt; b.vel.x += dx / dl * k; b.vel.z += dz / dl * k; }
        }
        if (d >= PURPLE.len) this.areas.splice(i, 1);
      } else if (ar.kind === 'crater') {
        // the Nova's crater keeps burning anyone who walks in
        ar.tick -= dt;
        if (ar.local && ar.tick <= 0) {
          ar.tick = 0.5;
          for (const e of this.ents.values()) {
            if (e === this.local || !e.alive) continue;
            if (Math.hypot(e.pos.x - ar.c.x, e.pos.z - ar.c.z) < ar.r && Math.abs(e.pos.y - ar.c.y) < 4) this.reportHit(e, ar.dmg, ar.ab, { burn: ar.burn, at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
          }
        }
        if (ar.t >= ar.life) this.areas.splice(i, 1);
      } else if (ar.kind === 'field') {
        ar.tick -= dt;
        if (ar.local && ar.tick <= 0) {
          ar.tick = 0.5;
          for (const e of this.ents.values()) {
            if (e === this.local || !e.alive) continue;
            if (Math.hypot(e.pos.x - ar.c.x, e.pos.z - ar.c.z) < ar.r && Math.abs(e.pos.y - ar.c.y) < 2) this.reportHit(e, 7, 'meteor', { at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
          }
        }
        if (ar.t >= ar.life) this.areas.splice(i, 1);
      }
    }
  }

  _inView(p) {
    if (this._frustumFrame !== this.time) {
      this._frustumFrame = this.time;
      this._frustum = this._frustum || new THREE.Frustum();
      this._pm = this._pm || new THREE.Matrix4();
      this.camera.updateMatrixWorld();
      this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pm);
      this._sph = this._sph || new THREE.Sphere(new THREE.Vector3(), 1.4);
    }
    this._sph.center.set(p.x, p.y + 0.9, p.z);
    return this._frustum.intersectsSphere(this._sph);
  }

  _checkSigils() {
    const mine = this.sigils.get(this.local.n);
    if (!mine || !this.local.alive) return;
    for (const h of mine) {
      if (!h.armed || h.fired) continue;
      for (const e of this.ents.values()) {
        if (e === this.local || !e.alive) continue;
        if (Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) < 2.0 && Math.abs(e.pos.y - h.pos.y) < 2) {
          h.fired = true;
          this.castAbility({ ab: 'sigilPull', id: h.id, c: [h.pos.x, h.pos.y, h.pos.z] });
          this.kit.pending.push({ t: 0.42, fn: () => this.castAbility({ ab: 'sigilBoom', id: h.id, c: [h.pos.x, h.pos.y, h.pos.z] }) });
          break;
        }
      }
    }
  }

  // positional sound relative to the camera
  listener() { return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, yaw: this.cam.yaw }; }
  sound(name, pos, gain = 1, falloff = 30, rate = 1) { Audio.at(name, pos, this.listener(), gain, falloff, rate); }

  // ---------------------------------------------------------------- host side
  hostHandle(e, msg) {
    if (!msg || typeof msg !== 'object' || !e) return;
    switch (msg.t) {
      case 's': if (e !== this.local) this._pushSnap(e, msg); break;
      case 'ev': {
        const out = { ...msg, n: e.n };
        this.net.broadcast(out, e === this.local ? null : e.id);
        if (e !== this.local) this.clientHandle(out);
        break;
      }
      case 'hit': if (this.rules) this.rules.onHit(e, msg); break;
      case 'needSpawn': {
        // a client loaded in but never got (or lost) its spawn: catch it up and spawn it now
        if (!this.rules || e === this.local || this.ended) break;
        this._catchUp(e.id, e);
        if (!e.alive && !this.rules.respawnAt.has(e.n)) this.rules.spawn(e);
        else if (e.alive) this.net.send(e.id, { t: 'spawn', n: e.n, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, quiet: 1 });
        break;
      }
      case 'chat': {
        const text = String(msg.msg || '').slice(0, 120);
        if (!text) return;
        this.rules.bcast({ t: 'chat', n: e.n, msg: text });
        break;
      }
      default: break;
    }
  }

  onLeave(pid) {
    const e = this.byId.get(pid);
    if (!e) return;
    if (this.rules) {
      this.rules.bcast({ t: 'left', n: e.n });
      e.left = true;
      // duel: your opponent quit — you win
      if (this.mode.lives && this.rules.phase === 'live' && ![...this.ents.values()].some((o) => o !== this.local && !o.dummy && !o.left)) this.rules.end();
    }
  }

  // ---------------------------------------------------------------- client side (also runs on host)
  clientHandle(msg) {
    this._hostQuiet = 0;
    if (!msg || typeof msg !== 'object') return;
    const hud = this.app.hud;
    switch (msg.t) {
      case 'S': {
        for (const s of msg.l) {
          const e = this.ents.get(s[0]);
          if (!e || e === this.local) continue;
          this._pushSnap(e, { p: [s[1], s[2], s[3]], v: [s[4], s[5], s[6]], y: s[7], pi: s[8], g: s[9] });
        }
        break;
      }
      case 'ev': {
        const e = this.ents.get(msg.n);
        if (!e || e === this.local) return;
        if (msg.k === 'anim') {
          e.view.anim.play(msg.a, msg.d || {});
          if (msg.a === 'dash') { e.dashFx = 0.24; this.fx.dashBurst(e.pos, tmpV.set(e.vel.x, 0, e.vel.z).normalize(), e.mage); this.sound('dash', e.pos, 0.7, 25); }
          if (msg.a === 'doubleJump') { this.fx.doubleJumpFx(e.pos, e.mage); this.sound('doubleJump', e.pos, 0.6, 25); }
        }
        else if (msg.k === 'ab') this.spawnAbility(e, msg, false);
        break;
      }
      case 'hp': {
        const e = this.ents.get(msg.n);
        if (!e) return;
        const prev = e.hp;
        e.hp = msg.hp;
        if (msg.hp < prev) {
          e.flash = 1; e.lastHurt = this.time;
          if (msg.burn) e.burnT = Math.max(e.burnT, msg.burn);
          if (prev - msg.hp >= 5) {
            // react away from whoever hit us (local angle: 0 = attacker in front, + = on our left)
            const src = this.ents.get(msg.by);
            let dir;
            if (src && src !== e) {
              const dx = src.pos.x - e.pos.x, dz = src.pos.z - e.pos.z, cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
              dir = Math.atan2(dx * cy - dz * sy, dx * sy + dz * cy);
            }
            e.view.anim.play('hit', { dir, dmg: prev - msg.hp });
          }
          if (e === this.local) {
            hud.hurt(prev - msg.hp, this.ents.get(msg.by));
            Audio.play('hurt', Math.min(1, 0.4 + (prev - msg.hp) / 60));
          }
        }
        break;
      }
      case 'burn': { const e = this.ents.get(msg.n); if (e) e.burnT = msg.s; break; }
      case 'stun': {
        // battlegrounds hitstun: the victim can't move or attack until it wears off
        const e = this.ents.get(msg.n);
        if (!e) return;
        const s = Math.max(0, Math.min(2.2, Number(msg.s) || 0));
        e.stunT = Math.max(e.stunT || 0, s);
        if (e === this.local) {
          this.stunT = Math.max(this.stunT || 0, s); this.body.locked = Math.max(this.body.locked, s); this.body.dashT = 0;
          // the Inverted Spear of Heaven: whatever technique you were winding up is cancelled
          if (msg.nul && this.kit) {
            this.kit.pending.length = 0; this.kit.busy = 0;
            this.body.slow = 1; this.body.lungeT = 0;
            if (this.kit.sweep) this.kit.sweep = null;
            if (this.kit.sky) this.kit.sky = null;
            toast('TECHNIQUE NULLIFIED', 1600);
          }
        }
        break;
      }
      case 'stunImm': {
        // stun budget spent: they can't be stunned again for a moment (white glints, and a cue for them)
        const e = this.ents.get(msg.n);
        if (!e) return;
        e.immT = Math.max(e.immT || 0, Math.min(4, Number(msg.s) || 0));
        if (e === this.local) this.app.hud.banner('STUN BREAK', 'GET OUT!', 1.0);
        break;
      }
      case 'slow': {
        const e = this.ents.get(msg.n);
        if (!e) return;
        e.slowT = msg.s;
        if (msg.k < 0.2 && !this.inEnemyDomain(e)) { e.iceT = msg.s; this.fx.iceBlock(e.pos.clone(), msg.s); this.sound('freeze', e.pos, 0.6, 25); }
        if (e === this.local) { this.body.slowT = msg.s; this.body.slowK = msg.k; hud.status && hud.status('SLOWED', msg.s); }
        break;
      }
      case 'kill': {
        const v = this.ents.get(msg.v), k = this.ents.get(msg.k);
        if (v) {
          v.alive = false; v.hp = 0; v.deaths = msg.vd ?? v.deaths + 1; v.burnT = 0;
          v.view.anim.play('die');
          this.fx.deathBurst(v.pos);
          this.sound('death', v.pos, 0.8, 30);
          v.hideAt = this.time + 2.4;
        }
        if (k && k !== v) k.kills = msg.kk ?? k.kills + 1;
        hud.killFeed(k, v, msg.ab, this.local);
        if (k === this.local && v !== this.local) { Audio.play('kill', 0.8); hud.killBanner(v, k.kills); this.kit.addUlt(v.dummy ? 3 : 15); }
        if (v === this.local) { hud.deathScreen(k, msg.ab, msg.out ? 0 : msg.rt, this.mode.lives && this.phase === 'live' ? this.mode.lives - v.deaths : -1); this.kit.pending.length = 0; }
        break;
      }
      case 'spawn': {
        const e = this.ents.get(msg.n);
        if (!e) return;
        e.alive = true; e.hp = BAL.hp; e.burnT = 0; e.hideAt = 0;
        e.pos.set(msg.x, msg.y, msg.z); e.vel.set(0, 0, 0); e.yaw = msg.yaw; e.snaps.length = 0;
        if (!msg.quiet) { e.view.anim.play('respawn'); this.fx.spawnPillar(e.pos); e.spawnProt = this.time + 1.5; }
        e.view.setVisible(true);
        if (e === this.local) {
          this._spawned = true;
          this.body.teleport(msg.x, msg.y, msg.z, msg.yaw);
          this.cam.yaw = msg.yaw; this.cam.pitch = -0.08; this.cam.pivotY = null;
          this.kit.reset();
          hud.respawned();
        }
        break;
      }
      case 'kb': {
        if (msg.n === this.local.n && this.local.alive) {
          this.body.vel.x += msg.v[0]; this.body.vel.z += msg.v[2];
          this.body.vel.y = Math.max(this.body.vel.y, msg.v[1]);
          this.body.grounded = false;
        }
        break;
      }
      case 'board': {
        for (const r of msg.l) { const e = this.ents.get(r[0]); if (e) { e.kills = r[1]; e.deaths = r[2]; e.dmg = r[3]; } }
        this.timeLeft = msg.tl; this.phase = msg.ph;
        break;
      }
      case 'phase': this.phase = msg.p; this.timeLeft = msg.tl; this.phaseEnd = this.time + msg.tl; hud.phase(msg.p, msg.tl); break;
      case 'end': this.ended = true; this.controlsActive = false; hud.endScreen(msg, this); setTimeout(() => { if (this.app.match === this) this.app.leaveMatch(); }, 11000); break;
      case 'chat': { const e = this.ents.get(msg.n); if (e) this.app.chat.add('all', e.name, msg.msg, e === this.local); break; }
      case 'left': {
        const e = this.ents.get(msg.n);
        if (!e) return;
        this.app.chat.system(`${e.name} left the match.`);
        e.alive = false; e.left = true; e.view.setVisible(false);
        break;
      }
      case 'join': {
        if (!msg.p || this.byId.has(msg.p.id)) break;
        this._makeEnt(msg.p); this.players.push(msg.p);
        this.app.chat.system(`${msg.p.name} joined the lobby.`);
        break;
      }
      case 'qlive': this.app.hud.queueState(null); break;
      case 'hostLeft': if (this.phase === 'queue' || this.mode.quickplay) this.app.leaveMatch('Lobby host left — searching again…', { requeue: true }); else this.app.leaveMatch('The match host left.'); break;
      default: break;
    }
  }

  _pushSnap(e, s) {
    const t = this.time;
    const snap = { t, x: s.p[0], y: s.p[1], z: s.p[2], vx: s.v[0], vy: s.v[1], vz: s.v[2], yaw: s.y, pitch: s.pi, g: !!s.g };
    e.snaps.push(snap);
    if (e.snaps.length > 30) e.snaps.shift();
    if (this.isHost) { e.pos.set(snap.x, snap.y, snap.z); }
  }

  // ---------------------------------------------------------------- per frame
  // compile the shaders of effects that are created at runtime, while the match is loading, so the
  // first cast of each never hitches; the objects stay (hidden) so their programs stay cached
  _warmupShaders() {
    const g = new THREE.Group(); g.name = 'shaderWarmup';
    const objs = [...(this.fx.limitlessWarmup ? this.fx.limitlessWarmup() : []), ...this.voidFx.warmupObjects()];
    for (const o of objs) { o.position.set(0, -500, 0); o.frustumCulled = false; g.add(o); }
    this.scene.add(g);
    const V = this.voidFx, vis = [V.sky.visible, V.dome.visible];
    V.sky.visible = V.dome.visible = true;
    try { this.app.renderer.compile(this.scene, this.camera); } catch (e) { console.warn('shader warm-up', e); }
    V.sky.visible = vis[0]; V.dome.visible = vis[1];
    g.visible = false;
    this._warm = g;
  }

  // ---------------------------------------------------------------- Checkmate (the Manipulator)
  // A 15 s cutscene every player watches, told in plain steps (captioned top-left):
  //   I time stops · II the field becomes his chessboard · III every enemy turns into a black king and
  //   his white pieces fall round each one · IV every square a king could flee to lights up red ·
  //   V he makes the final move on his little board · VI "Checkmate." — the kings topple and shatter,
  //   and the enemies inside them die. He turns away: "…Next."
  _openCheckmate(e, d, local) {
    const c = new THREE.Vector3().fromArray(d.c), yaw = Number(d.yaw) || 0;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), side = new THREE.Vector3(-f.z, 0, f.x);
    if (this.cine) this._endCine(); // checkmate overrides anything else on screen
    if (this._mate) this._mateCleanup();
    const victims = [...this.ents.values()].filter((t) => t !== e && t.alive).sort((a, b) => a.pos.distanceToSquared(c) - b.pos.distanceToSquared(c));
    const board = e.view ? miniBoard(this.fx, e.view.root) : null;
    this._mate = { c, f, side, yaw, caster: e, victims, pieces: [], kings: [], board, local, killed: false };
    if (e.view) e.view.anim.play('mnChin');
    this.cine = { t: 0, dur: CHECKMATE.dur, caster: e, c: c.clone(), o: c.clone(), f, side, cue: 0, local,
      update: this._mateCineUpdate, camera: this._mateCineCamera, end: this._mateCineEnd };
    this.app.hud.cineStart('CHECKMATE', 'mono');
    this.sound('domainCast', c, 1, 120);
  }
  // the enemy becomes a black king standing on their square; his white pieces fall onto the squares
  // around it (the king's escape squares are marked later)
  _sqKey(x, z) { const M = this._mate, SQ = 6; return Math.round((x - M.c.x) / SQ) + ',' + Math.round((z - M.c.z) / SQ); }
  // every enemy's square (two enemies on one square share a king); his own square is taken too
  _mateSquares() {
    const M = this._mate, SQ = 6;
    M.taken = new Set([this._sqKey(M.c.x, M.c.z)]);
    M.kingSq = new Map();
    for (const v of M.victims) {
      const cx = Math.round((v.pos.x - M.c.x) / SQ) * SQ + M.c.x, cz = Math.round((v.pos.z - M.c.z) / SQ) * SQ + M.c.z, key = this._sqKey(cx, cz);
      if (!M.kingSq.has(key)) M.kingSq.set(key, { cx, cz, first: v });
      M.taken.add(key);
    }
  }
  _mateSurround(v, k) {
    const M = this._mate, SQ = 6, vp = v.pos;
    const cx = Math.floor((vp.x - M.c.x) / SQ + 0.5) * SQ + M.c.x, cz = Math.floor((vp.z - M.c.z) / SQ + 0.5) * SQ + M.c.z;
    M.squares = M.squares || [];
    M.squares.push([cx, cz]);
    const kinds = ['rook', 'bishop', 'knight', 'queen'];
    const offs = [[2, 0], [0, 2], [-2, 0], [0, -2]];
    offs.forEach(([ox, oz], i) => {
      const p = new THREE.Vector3(cx + ox * SQ, 0, cz + oz * SQ);
      const key = this._sqKey(p.x, p.z);
      if (M.taken && M.taken.has(key)) return;           // never on a king, on him, or on another piece
      if (M.taken) M.taken.add(key);
      const toV = Math.atan2(vp.x - p.x, vp.z - p.z);
      setTimeout(() => {
        if (this._mate !== M) return;
        const H = this.fx.chessPiece(kinds[i], p, { white: true, h: 4.4 + (kinds[i] === 'queen' ? 0.8 : 0), mode: 'drop', t: 0.32, hold: Infinity, yaw: toV,
          onLand: () => { this.fx.dust(new THREE.Vector3(p.x, this.world.groundAt(p.x, p.z, 50), p.z), 1.6); if (i % 2 === 0) this.sound('clack', p, 1.2, 120); this.fx.shake(0.1); } });
        H.home = p; H.vp = new THREE.Vector3(cx, vp.y, cz);
        M.pieces.push(H);
      }, (1.0 + k * 0.15 + i * 0.16) * 1000);
    });
    // the transformation: a flash of black, the enemy is gone, a black king rises where they stood
    if (v.view) this.fx.hitSilhouette(v.view, [0.02, 0.02, 0.025], 0.45);
    const ks = M.kingSq && M.kingSq.get(this._sqKey(cx, cz));
    if (ks && ks.first !== v) { setTimeout(() => { if (this._mate === M && v.view) v.view.root.visible = false; }, (0.3 + k * 0.15) * 1000); return; } // shares that king
    setTimeout(() => {
      if (this._mate !== M) return;
      const away = new THREE.Vector3(vp.x - M.c.x, 0, vp.z - M.c.z).normalize();
      const sqc = new THREE.Vector3(cx, 0, cz);              // on the centre of their square, like every other piece
      const king = this.fx.chessPiece('king', sqc, { white: false, h: 4.2, mode: 'rise', t: 0.45, hold: Infinity, yaw: Math.atan2(-away.x, -away.z) });
      king.away = away; king.at = sqc; king.v = v; M.kings.push(king);
      if (v.view) v.view.root.visible = false;
      this.sound('clack', vp, 1, 150);
    }, (0.3 + k * 0.15) * 1000);
  }
  // escape squares: every square round each king lights up red (all of them covered by his pieces)
  _mateMarks() {
    const M = this._mate;
    if (!M || M.marks || !M.squares) return;
    M.marks = [];
    const SQ = 6, seen = new Set();
    M.markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.06, 0.05), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const g = new THREE.PlaneGeometry(SQ * 0.92, SQ * 0.92); g.rotateX(-Math.PI / 2);
    for (const [cx, cz] of M.squares) for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      if (!ox && !oz) continue;
      const x = cx + ox * SQ, z = cz + oz * SQ, key = Math.round(x) + ',' + Math.round(z);
      if (seen.has(key)) continue; seen.add(key);
      const m = new THREE.Mesh(g, M.markMat);
      m.position.set(x, this.world.groundAt(x, z, 50) + 0.12, z); m.renderOrder = 3; m.frustumCulled = false;
      this.scene.add(m); M.marks.push(m);
    }
  }
  // lines of attack: a red thread from each of his pieces to the king it is hunting
  _mateLines() {
    const M = this._mate;
    if (!M || M.lines) return;
    M.lines = [];
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.16, 0.12), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    M.pieces.forEach((H, i) => {
      const a = H.home.clone(), b = H.vp.clone();
      a.y = this.world.groundAt(a.x, a.z, 50) + 0.35; b.y = this.world.groundAt(b.x, b.z, 50) + 0.35;
      const len = a.distanceTo(b);
      if (len < 0.5) return;
      const g = new THREE.BoxGeometry(0.09, 0.09, 1); g.translate(0, 0, 0.5);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(a); m.lookAt(b); m.scale.set(1, 1, 0.001); m.frustumCulled = false;
      m.userData = { len, t0: i * 0.05 };
      this.scene.add(m); M.lines.push(m);
    });
    M.lineMat = mat;
  }
  _mateCineUpdate(dt) {
    const C = this.cine, M = this._mate, hud = this.app.hud;
    C.t += dt;
    const t = C.t, T = CHECKMATE.move;
    this.chessWorld.update(dt);
    const mono = (s, big) => hud.cineMono(s, 'mono', big);
    const step = (n, s, sub) => hud.cineStep(s, n, sub);
    const cues = [
      // I. time stops: every enemy freezes mid-motion; a heartbeat, a chess clock
      [0.02, () => { for (const v of M.victims) if (v.view) v.view.anim.hitStop(CHECKMATE.kill); this.sound('heartbeat', M.c, 1, 400); step('I', 'TIME STOPS', 'Nobody can move. Only he can.'); }],
      [0.4, () => mono('Stop. Look around you.')],
      [0.9, () => this.sound('tick', M.c, 0.9, 400)], [1.5, () => this.sound('heartbeat', M.c, 1, 400)], [2.1, () => this.sound('tick', M.c, 0.9, 400)],
      [2.6, () => mono('')],
      // II. the field becomes his board
      [2.8, () => { hud.flash(1); hud.cineGrade('mono'); this.chessWorld.start(M.c); this.fx.shake(0.4); this.sound('domain', M.c, 1.3, 160); step('II', 'THE FIELD BECOMES A CHESSBOARD', 'He is playing this fight as a game of chess.');
        this.fx.groundShock(new THREE.Vector3(M.c.x, M.c.y + 0.2, M.c.z), 26, { core: [1.4, 1.42, 1.5], edge: [0.2, 0.2, 0.24] }); this.fx.riseTiles(M.c, 60, 70, 8.5); }],
      [3.2, () => mono('This field has always been my board.')],
      [5.6, () => mono('')],
      // III. every enemy becomes a black king; his white pieces surround each one
      [5.8, () => { this._mateSquares(); M.victims.forEach((v, k) => this._mateSurround(v, k)); step('III', 'EVERY ENEMY BECOMES A KING', 'The king is the piece that loses the game when it is trapped.'); }],
      [6.2, () => mono('Every one of you is a king now — and kings can be trapped.')],
      [9.2, () => mono('')],
      // IV. no escape: every square round every king is covered
      [9.4, () => { this._mateMarks(); this._mateLines(); this.sound('clack', M.c, 1, 400); step('IV', 'NO ESCAPE SQUARES', 'Red squares are attacked by his pieces. The king cannot step onto any of them.'); }],
      [9.8, () => mono('Every square you could run to is already mine.')],
      [10.6, () => this.sound('tick', M.c, 1, 400)], [11.4, () => this.sound('tick', M.c, 1, 400)], [12.0, () => this.sound('tick', M.c, 1, 400)], [12.5, () => this.sound('tick', M.c, 1, 400)],
      // his eyes: nothing in them
      [13.0, () => { mono('I don’t hate you. I finished this game before you knew it had started.'); this.sound('heartbeat', M.c, 1, 400); }],
      // V. the final move
      [T, () => { mono(''); step('V', 'THE FINAL MOVE', 'He moves one piece on his little board. On the field, his pieces close in.'); if (M.caster.view) M.caster.view.anim.play('mnPlace');
        for (const H of M.pieces) { const to = H.vp.clone().add(H.home.clone().sub(H.vp).setY(0).setLength(6)); if (!M.taken.has(this._sqKey(to.x, to.z))) { M.taken.add(this._sqKey(to.x, to.z)); H.slideTo(to, 0.8); } } }],
      // VI. checkmate
      [T + 1.25, () => { hud.impactFrames(() => mono('Checkmate.', true)); step('VI', 'CHECKMATE', 'A king with no escape loses. Every enemy is eliminated.'); this.sound('slashHeavy', M.c, 1, 200); this.sound('tick', M.c, 1, 400); if (M.lines) for (const l of M.lines) l.visible = false; }],
      // the kings topple in slow motion…
      [T + 1.9, () => { for (const K of M.kings) K.topple(K.away, 0.95); this.sound('heartbeat', M.c, 1.1, 400); }],
      [T + 2.6, () => mono('')],
      // …and shatter: the enemies they were fall with them
      [CHECKMATE.kill, () => { for (const K of M.kings) { const p = K.at; this.fx.tileShards(new THREE.Vector3(p.x, this.world.groundAt(p.x, p.z, 50) + 1.2, p.z), K.away, 30, 3.2); K.dispose(); } M.kings.length = 0;
        this._mateKill(); }],
      [T + 4.0, () => { for (const H of M.pieces) H.sink(0.9); if (M.marks) for (const m of M.marks) m.visible = false; }],
      [T + 4.1, () => mono('Winning is all that matters. How I got there… doesn’t.')],
      [T + 6.9, () => { mono(''); step('', ''); hud.flash(0.9); this.chessWorld.end(); hud.cineGrade(''); for (const H of M.pieces) H.dispose(); M.pieces.length = 0; }],
      [T + 7.2, () => mono('…Next.')],
      [CHECKMATE.dur - 0.25, () => mono('')],
    ];
    while (C.cue < cues.length && t >= cues[C.cue][0]) cues[C.cue++][1]();
    // the threads draw themselves out from each piece, pulsing
    if (M.markMat) M.markMat.opacity = t < T + 4.0 ? Math.min(0.7, Math.max(0, (t - 9.4) * 1.8)) * (0.78 + 0.22 * Math.sin(t * 8)) : 0;
    if (M.lines) for (const l of M.lines) { const k = Math.min(1, Math.max(0, (t - 9.5 - l.userData.t0) / 0.35)); l.scale.z = Math.max(0.001, l.userData.len * k * k * (3 - 2 * k)); }
    if (M.lineMat) M.lineMat.opacity = 0.65 + 0.3 * Math.sin(t * 12);
    // on the little board, his white queen glides across to stand over their king
    // Qh4–e7#: his fingers close on the queen (0.4 s into his move), lift her, carry her along the
    // diagonal and set her down (0.8 s); she is in his hand the whole way (MN_PLACE / miniBoard)
    if (M.board && M.caster.view) {
      const q = M.board.pcs.wq, u = t - T;
      if (u > 0.42 && u < 0.8) M.board.holdAt(M.caster.view.rig.ends.handR.getWorldPosition(this._cv3 || (this._cv3 = new THREE.Vector3())));
      else if (u >= 0.8 && !M.placed) { q.position.lerp(M.board.pcs.to, Math.min(1, (u - 0.8) / 0.06)); if (u > 0.86) { q.position.copy(M.board.pcs.to); M.placed = true; this.sound('clack', M.c, 1, 30); } }
    }
    if (M.board && t > T + 1.2) M.board.pcs.glow.material.opacity = Math.min(0.85, (t - T - 1.2) * 3) * (0.75 + 0.25 * Math.sin(t * 10));
    if (M.board && t > T + 1.9 && t < T + 2.9) { const k = Math.min(1, (t - T - 1.9) / 0.9); M.board.pcs.bk.rotation.z = k * k * Math.PI * 0.5; }
    hud.cineDark(t < 2.8 ? 0.3 : t < 13.0 ? 0.12 : t < T ? 0.45 : t < T + 1.25 ? 0.15 : 0.3);
    if (t >= C.dur) this._endCine();
  }
  // the end of the game: every victim is struck down where they stand (the caster resolves it)
  _mateKill() {
    const M = this._mate;
    if (!M || M.killed) return;
    M.killed = true;
    this.app.hud.flash(1);
    this.fx.shake(0.9);
    for (const v of M.victims) {
      if (!v.alive) continue;
      if (v.view) v.view.root.visible = true; // they stood inside the king: now they fall
      const p = new THREE.Vector3(v.pos.x, v.pos.y + 1.2, v.pos.z);
      this.fx.chessImpact(v.pos, 1.4, false);
      this.fx.tileShards(p, new THREE.Vector3(v.pos.x - M.c.x, 0, v.pos.z - M.c.z).normalize(), 24, 2);
      this.fx.vortex(p, { size: 1.3, pal: { rim: [1.3, 1.3, 1.35], core: [0.85, 0.86, 0.9], deep: [0.04, 0.04, 0.05], star: [1.1, 1.15, 1.4] }, dur: 0.8, ribbons: 10, crack: false });
      if (v.view) this.fx.hitSilhouette(v.view, [0.02, 0.02, 0.025], 0.6);
      if (M.local) this.reportHit(v, 99999, 'checkmate', { at: p });
    }
    this.sound('slam', M.c, 1.4, 300);
  }
  _mateCineEnd() {
    const M = this._mate;
    if (M && M.caster.view) M.caster.view.anim.stopAction(['mnChin', 'mnPlace']); // free to move straight away
    if (M && !M.killed) this._mateKill(); // cut short: the game still ends
    this._mateCleanup();
    this.app.hud.cineGrade('');
    for (const e of this.ents.values()) if (e.alive) e.view.root.visible = true;
  }
  _mateCleanup() {
    const M = this._mate;
    if (!M) return;
    this.chessWorld.end();
    for (const H of [...M.pieces, ...M.kings]) H.dispose();
    if (M.rings) for (const r of M.rings) r.dispose();
    if (M.lines) for (const l of M.lines) { this.scene.remove(l); l.geometry.dispose(); }
    if (M.marks) { for (const m of M.marks) this.scene.remove(m); if (M.marks[0]) M.marks[0].geometry.dispose(); }
    if (M.markMat) M.markMat.dispose();
    if (M.lineMat) M.lineMat.dispose();
    if (M.board) M.board.dispose();
    this._mate = null;
  }
  _mateCineCamera() {
    const C = this.cine, M = this._mate, t = C.t, o = M.c, f = M.f, sd = M.side, cam = this.camera, T = CHECKMATE.move;
    const P = tmpV, L = tmpV2;
    const ease = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
    const view = M.caster.view;
    const head = view ? view.head.getWorldPosition(this._cv1 || (this._cv1 = new THREE.Vector3())) : this._cv1 || (this._cv1 = new THREE.Vector3(o.x, o.y + 1.6, o.z));
    let fov = 40, roll = 0;
    const vics = M.victims.filter((v) => v.view);
    const centre = () => {
      const cen = new THREE.Vector3(o.x, o.y, o.z);
      for (const v of vics) cen.add(v.pos);
      cen.divideScalar(vics.length + 1);
      return [cen, Math.max(16, ...vics.map((v) => Math.hypot(v.pos.x - cen.x, v.pos.z - cen.z) * 1.6))];
    };
    if (t < 2.8) { // across the little board, low, his chin on his fist: a dolly zoom (he stays the
      // same size while the world behind him stretches away)
      const k = ease(t / 2.8), r = 1.7 + k * 1.1;
      P.set(o.x + f.x * r + sd.x * 0.42 * (r / 1.7), o.y + 1.3, o.z + f.z * r + sd.z * 0.42 * (r / 1.7));
      L.set(head.x, head.y - 0.18, head.z); fov = 2 * Math.atan(Math.tan(19 * Math.PI / 180) * 1.7 / r) * 180 / Math.PI;
    } else if (t < 5.8) { // the board spreads to the horizon: rising wide behind him
      const k = ease((t - 2.8) / 3.0);
      P.set(o.x - f.x * (4 + 6 * k) + sd.x * (2 + k), o.y + 2 + 9 * k, o.z - f.z * (4 + 6 * k) + sd.z * (2 + k));
      L.set(o.x + f.x * 22, o.y + 1, o.z + f.z * 22); fov = 52; roll = -0.02;
    } else if (t < 9.4 && vics.length) { // each enemy: turned into a black king, his pieces falling round it
      const n = Math.min(3, vics.length), seg = (9.4 - 5.8) / n, i = Math.min(Math.floor((t - 5.8) / seg), n - 1);
      const v = vics[i], vp = v.pos, k = ease(((t - 5.8) - i * seg) / seg);
      const to = new THREE.Vector3(o.x - vp.x, 0, o.z - vp.z).normalize();
      const a = Math.atan2(to.x, to.z) + 0.75 - k * 0.5, r = 10 - k * 2.5;
      P.set(vp.x + Math.sin(a) * r, vp.y + 3.2 - k * 1.2, vp.z + Math.cos(a) * r);
      L.set(vp.x, vp.y + 2.2, vp.z); fov = 50; roll = 0.02;
    } else if (t < 9.4) { // nobody to fight: a slow orbit over the empty board
      const a = Math.atan2(f.x, f.z) + (t - 5.8) * 0.4;
      P.set(o.x + Math.sin(a) * 14, o.y + 7, o.z + Math.cos(a) * 14); L.set(o.x, o.y + 1, o.z); fov = 48;
    } else if (t < 13.0) { // no escape: straight down over the board, turning slowly; red escape squares, threads drawn
      const [cen, spread] = centre(), k = (t - 9.4) / 3.6;
      const a = Math.atan2(f.x, f.z) + k * 0.35;
      P.set(cen.x + Math.sin(a) * 0.01, cen.y + spread * 2.0 - k * 4, cen.z + Math.cos(a) * 0.01);
      L.set(cen.x, cen.y, cen.z); fov = 52;
      cam.up.set(Math.sin(a), 0, Math.cos(a));
    } else if (t < T) { // his eyes: an extreme close-up, pushing in; nothing in them
      const k = ease((t - 13.0) / (T - 13.0)), r = 0.62 - k * 0.14;
      P.set(head.x + f.x * r + sd.x * 0.05, head.y + 0.06, head.z + f.z * r + sd.z * 0.05);
      L.set(head.x, head.y + 0.06, head.z); fov = 22;
    } else if (t < T + 1.25) { // close on the little board from Black's side: his hand brings the queen
      const b = M.board.g.position, k = ease((t - T) / 1.25);
      P.set(b.x + f.x * (1.25 - k * 0.12) + sd.x * 0.16, b.y + 0.4, b.z + f.z * (1.25 - k * 0.12) + sd.z * 0.16);
      L.set(b.x - f.x * 0.1, b.y + 0.3, b.z - f.z * 0.1); fov = 44;
    } else if (t < T + 1.9) { // CHECKMATE: snap to a low hero angle under him
      const k = ease((t - T - 1.25) / 0.65);
      P.set(o.x + f.x * 2.2 - sd.x * 1.0, o.y + 0.35, o.z + f.z * 2.2 - sd.z * 1.0);
      L.set(head.x, head.y + 0.1 + k * 0.1, head.z); fov = 34 + k * 4; roll = -0.06;
    } else if (t < T + 4.1) { // high above the field: every king falls in slow motion, every enemy with it
      const [cen, spread] = centre(), k = ease((t - T - 1.9) / 2.2);
      P.set(cen.x - f.x * spread * 0.35, cen.y + spread * (1.05 - 0.2 * k), cen.z - f.z * spread * 0.35);
      L.set(cen.x, cen.y, cen.z); fov = 50;
    } else { // he turns away from the board as if nothing happened
      const k = ease((t - T - 4.1) / (CHECKMATE.dur - T - 4.1));
      const a = Math.atan2(f.x, f.z) + 1.2 + k * 0.6;
      P.set(o.x + Math.sin(a) * (2.4 + k * 1.2), o.y + 1.5, o.z + Math.cos(a) * (2.4 + k * 1.2));
      L.set(head.x, head.y - 0.1, head.z); fov = 36;
    }
    if (!(t >= 9.4 && t < 13.0)) cam.up.set(0, 1, 0);
    P.y = Math.max(P.y, this.world.groundAt(P.x, P.z, P.y + 20) + 0.3);
    cam.position.copy(P); cam.lookAt(L);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return L;
  }

  // ---------------------------------------------------------------- Endless Talisman Suppression (Inkweaver)
  // A 9 s cutscene everyone watches: a golden Tai Chi array opens under her, ink wings unfurl and
  // she rises into the sky inside a ring of hanging talismans; then the talismans come down across
  // the whole field as pillars of light, and it all ends in one colossal explosion of ink and gold.
  _openTalisman(e, d, local) {
    const c = new THREE.Vector3().fromArray(d.c), yaw = Number(d.yaw) || 0;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), side = new THREE.Vector3(-f.z, 0, f.x);
    if (this.cine) this._endCine();
    const victims = [...this.ents.values()].filter((t) => t !== e && t.alive && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) < TALISMAN.radius);
    this._tali = { c, f, side, caster: e, victims, done: false, rainT: 0 };
    if (e.view) e.view.anim.play('inkAscend');
    this.cine = { t: 0, dur: TALISMAN.cine, caster: e, c: c.clone(), o: c.clone(), f, side, cue: 0, local,
      update: this._taliCineUpdate, camera: this._taliCineCamera, end: this._taliCineEnd };
    this.app.hud.cineStart('ENDLESS TALISMAN SUPPRESSION', '');
    this.sound('domainCast', c, 1, 120);
  }
  _taliCineUpdate(dt) {
    const C = this.cine, T = this._tali, hud = this.app.hud, e = T.caster;
    C.t += dt;
    const t = C.t, [r0, r1] = TALISMAN.rain;
    const mono = (s, big) => hud.cineMono(s, 'gold', big);
    const until = () => !this._tali || this._tali.done;
    const cues = [
      [0.05, () => { this.fx.taiChiArray(T.c, 6.5, TALISMAN.cine - 0.3, { spin: 0.5 }); mono('Ink becomes wings. Wings become heaven.'); }],
      [0.9, () => { if (e.view) T.wings = this.fx.inkWings((out) => e.view.rig.bones[3].getWorldPosition(out), () => Math.atan2(T.f.x, T.f.z), 1.0, Infinity, { spread: 0.8, flap: 0.025, until, halo: true, bare: () => !!(this._tali && this._tali.plate) }); this.sound('domain', T.c, 1.1, 150); this.fx.shake(0.3); }],
      [1.9, () => { T.halo = this.fx.talismanHalo(T.c, this.map.Q.particles <= 2000 ? 36 : 80, 24, 15, () => !this._tali || this._tali.done || this._tali.haloDown, () => !!(this._tali && this._tali.plate)); mono(''); }],
      // the reference shot: front-on, level, her wings filling the frame against the light behind her
      [WING_SHOT[0], () => { hud.flash(0.45); T.plate = this.fx.inkPlate(); }],
      [WING_SHOT[1], () => { this._taliPlateOff(); hud.flash(0.35); hud.cineCard('ENDLESS TALISMAN SUPPRESSION', '無 窮 符 鎮', ''); }],
      [WING_SHOT[1] + 0.5, () => mono('Heaven and earth, hear my command.')],
      [WING_SHOT[1] + 2.1, () => mono('Every talisman a seal. Every seal a sentence.')],
      [WING_SHOT[1] + 3.4, () => mono('Be still.')],
      [TALISMAN.boom - 0.12, () => { mono(''); hud.impactFrames(() => hud.flash(1)); }],
      // the finale: every talisman in the sky comes down at once, each one detonating where it lands
      [TALISMAN.boom - 0.75, () => {
        T.haloDown = true;
        const n = this.map.Q.particles <= 2000 ? 28 : 60;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * TALISMAN.radius;
          const from = new THREE.Vector3(T.c.x + Math.cos(a) * 18, T.c.y + 14 + Math.random() * 6, T.c.z + Math.sin(a) * 18);
          this.fx.talismanStrike(new THREE.Vector3(T.c.x + Math.cos(a + (Math.random() - 0.5)) * rr, 0, T.c.z + Math.sin(a + (Math.random() - 0.5)) * rr), Math.random() * 0.35, 1.6, from);
        }
        for (const v of T.victims) if (v.alive) this.fx.talismanStrike(v.pos.clone(), 0.25, 2.0);
      }],
      [TALISMAN.boom, () => { this.fx.shake(0.9); this.sound('slam', T.c, 1.6, 300); this.sound('novaBoom', T.c, 1.2, 300); this.fx.groundShock(new THREE.Vector3(T.c.x, T.c.y + 0.1, T.c.z), TALISMAN.boomR, { core: [2.2, 1.6, 0.5], edge: [0.05, 0.04, 0.03] }); }],
      [TALISMAN.cine - 0.3, () => mono('')],
    ];
    while (C.cue < cues.length && t >= cues[C.cue][0]) cues[C.cue++][1]();
    // she rises on her wings, and comes back down at the end
    e.liftY = t < 0.9 ? 0 : t < WING_SHOT[0] ? 6 * (1 - Math.cos((t - 0.9) / 1.5 * Math.PI)) / 2 : t < TALISMAN.cine - 1.1 ? 6 + Math.sin(t * 1.6) * 0.25 : 6 * Math.max(0, (TALISMAN.cine - 0.1 - t) / 1.0);
    // the rain: talismans across the whole field, more and more of them, and on every victim
    if (t > r0 && t < r1) {
      T.rainT -= dt;
      while (T.rainT <= 0) {
        T.rainT += 0.045 * (1.4 - (t - r0) / (r1 - r0));
        const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * TALISMAN.radius;
        this.fx.talismanStrike(new THREE.Vector3(T.c.x + Math.cos(a) * rr, 0, T.c.z + Math.sin(a) * rr), 0, 1);
        if (Math.random() < 0.15) this.sound('slam', T.c, 0.5, 200);
      }
      for (let k = 0; k < TALISMAN.strikes; k++) {
        const tk = r0 + (r1 - r0) * (k + 0.5) / TALISMAN.strikes;
        if (t - dt < tk - 0.35 && t >= tk - 0.35) for (const v of T.victims) if (v.alive) this.fx.talismanStrike(v.pos.clone(), 0, 1.3);
      }
    }
    hud.cineDark(T.plate ? 0 : t < 0.9 ? 0.35 : t < TALISMAN.boom ? 0.2 : 0.1);
    if (t >= C.dur) this._endCine();
  }
  _taliPlateOff() {
    const T = this._tali;
    if (T && T.plate) { this.scene.remove(T.plate); T.plate.material.dispose(); T.plate = null; }
  }
  _taliCineEnd() {
    this._taliPlateOff();
    const T = this._tali;
    if (T) { T.done = true; T.caster.liftY = 0; if (T.caster.view) T.caster.view.anim.stopAction(['inkAscend']); }
    this._tali = null;
    for (const e of this.ents.values()) if (e.alive) e.view.root.visible = true;
  }
  _taliCineCamera() {
    const C = this.cine, T = this._tali, t = C.t, o = T.c, f = T.f, sd = T.side, cam = this.camera;
    const P = tmpV, L = tmpV2;
    const ease = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
    const view = T.caster.view;
    const head = view ? view.head.getWorldPosition(this._cv1 || (this._cv1 = new THREE.Vector3())) : this._cv1 || (this._cv1 = new THREE.Vector3(o.x, o.y + 1.6, o.z));
    let fov = 45, roll = 0;
    const lift = T.caster.liftY || 0;
    if (t < 0.9) { // low in front: the array blooms under her feet
      const k = ease(t / 0.9);
      P.set(o.x + f.x * (3.2 - k * 0.6) + sd.x * 0.8, o.y + 0.5, o.z + f.z * (3.2 - k * 0.6) + sd.z * 0.8);
      L.set(head.x, head.y - 0.4, head.z); fov = 44;
    } else if (t < 2.4) { // from behind and below: the wings unfurl and she rises
      const k = ease((t - 0.9) / 1.5);
      P.set(o.x - f.x * (4 + k * 2) + sd.x * 1.4, o.y + 0.6, o.z - f.z * (4 + k * 2) + sd.z * 1.4);
      L.set(head.x, head.y + 0.6, head.z); fov = 52; roll = -0.03;
    } else if (t < WING_SHOT[1] && T.plate) { // the reference shot (see _wingShot)
      fov = this._wingShot(T, t - WING_SHOT[0], P, L);
    } else if (t < WING_SHOT[1] + 1.8) { // high over her shoulder: the talismans come down across the whole field
      const k = ease((t - WING_SHOT[1]) / 1.8), a = Math.atan2(f.x, f.z) + Math.PI + k * 0.5;
      P.set(o.x + Math.sin(a) * 6, o.y + lift + 4 + k * 3, o.z + Math.cos(a) * 6);
      L.set(o.x + f.x * 18, o.y, o.z + f.z * 18); fov = 60;
    } else if (t < WING_SHOT[1] + 3.1) { // on the ground among the pillars, looking up at her
      const v = T.victims.find((x) => x.view) || null, g = v ? v.pos : new THREE.Vector3(o.x + f.x * 12, o.y, o.z + f.z * 12);
      const k = ease((t - WING_SHOT[1] - 1.8) / 1.3);
      P.set(g.x + sd.x * (2 - k), g.y + 0.8, g.z + sd.z * (2 - k));
      L.set(head.x, head.y + 0.5, head.z); fov = 50; roll = 0.04;
    } else if (t < TALISMAN.boom) { // her face, close: calm, eyes half closed
      const k = ease((t - WING_SHOT[1] - 3.1) / (TALISMAN.boom - WING_SHOT[1] - 3.1));
      P.set(head.x + f.x * (0.9 - k * 0.25) + sd.x * 0.15, head.y + 0.02, head.z + f.z * (0.9 - k * 0.25) + sd.z * 0.15);
      L.set(head.x, head.y, head.z); fov = 28;
    } else { // high and wide: the explosion swallows the field
      const k = ease((t - TALISMAN.boom) / (TALISMAN.cine - TALISMAN.boom));
      P.set(o.x - f.x * 42 + sd.x * 16, o.y + 26 - k * 4, o.z - f.z * 42 + sd.z * 16);
      L.set(o.x, o.y + 3, o.z); fov = 58;
    }
    P.y = Math.max(P.y, this.world.groundAt(P.x, P.z, P.y + 20) + 0.3);
    cam.position.copy(P); cam.lookAt(L);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (T.plate) this._placePlate(T);
    return L;
  }
  // The front-on wing shot frames her exactly as the reference art does. The backdrop plate (the art
  // with her and the wings taken out) sits PLATE_D metres in front of the camera, sized to cover the
  // letterboxed frame; the camera then stands at the distance where her real 1.66 m matches her
  // height in the art at that plate scale, shifted so the point where her wings meet her back lands
  // on the same art pixel. Wings (cut from the same art, metre-sized at her scale) line up with it.
  _wingShot(T, t, P, L) {
    const f = T.f;
    const fov = 35 - Math.min(1, t / (WING_SHOT[1] - WING_SHOT[0])) * 2.2;      // a slow push in
    const { ph } = this._plateSize(fov);
    const k = 1.66 / PLATE.body_px, mp = ph / PLATE.h;
    const d = k * PLATE_D / mp;
    const xr = (PLATE.root[0] - PLATE.w / 2) * k, yr = -(PLATE.root[1] - PLATE.h / 2) * k;
    const root = this._wingRoot || (this._wingRoot = new THREE.Vector3());
    if (T.wings) T.wings.localToWorld(root.copy(WING_ROOT)); else root.set(T.c.x, T.c.y + 7.3, T.c.z);
    const rx = f.z, rz = -f.x;                                                     // camera right (her left)
    P.set(root.x - rx * xr + f.x * d, root.y - yr, root.z - rz * xr + f.z * d);
    L.set(P.x - f.x, P.y, P.z - f.z);
    return fov;
  }
  _plateSize(fov) {
    const cam = this.camera, th = Math.tan(fov * Math.PI / 360);
    const Hf = 2 * PLATE_D * th, Wf = Hf * cam.aspect, Hb = Hf * CINE_BAND, ra = PLATE.w / PLATE.h;
    return Wf / Hb > ra ? { pw: Wf, ph: Wf / ra } : { pw: Hb * ra, ph: Hb };
  }
  _placePlate(T) {
    const cam = this.camera, m = T.plate, { pw, ph } = this._plateSize(cam.fov);
    m.quaternion.copy(cam.quaternion);
    m.position.set(0, 0, -PLATE_D).applyQuaternion(cam.quaternion).add(cam.position);
    m.scale.set(pw, ph, 1);
  }

  // ---------------------------------------------------------------- Domain Expansion: Unlimited Void
  _openDomain(e, d, local) {
    const c = new THREE.Vector3().fromArray(d.c);
    const yaw = Number(d.yaw) || e.yaw || 0;
    const me = this.local, b = this.body;
    const inside = Math.hypot(b.pos.x - c.x, b.pos.z - c.z) < VOID.radius;
    // the domain lasts VOID.dur once the cutscene is over
    this.domain = { owner: e.n, c, r: VOID.radius, until: this.time + VOID.cine + VOID.dur, yaw, trapped: !local && inside && me.alive, open: false };
    this.sound('domainCast', c, 1, 80);
    if (this.cine) { this._domainOpen(); this._domainStrike(local); return; } // another cutscene is running: no second camera
    // the universal cutscene: every player watches it, nobody can act until it ends
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let victim = null, bestD = 1e9;
    for (const t of this.ents.values()) {
      if (t === e || !t.alive) continue;
      const dd = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
      if (dd < VOID.radius && dd < bestD) { bestD = dd; victim = t; }
    }
    this.cine = { t: 0, dur: VOID.cine, caster: e, c: c.clone(), o: c.clone(), f, side: new THREE.Vector3(-f.z, 0, f.x), cue: 0, victim, local,
      update: this._domainCineUpdate, camera: this._domainCineCamera, end: this._domainCineEnd };
    this.app.hud.cineStart('DOMAIN EXPANSION', 'void');
  }
  _domainOpen() {
    const D = this.domain;
    if (!D || D.open) return;
    D.open = true;
    this.voidFx.start(D.c, VOID.radius, D.yaw);
    this.sound('domain', D.c, 1.4, 140);
    this.fx.shake(0.6);
  }
  // the void floods every mind inside it: a moment of total paralysis (sent by the caster)
  _domainStrike(local) {
    const D = this.domain;
    if (!D) return;
    const me = this.local;
    if (local) {
      for (const t of this.ents.values()) {
        if (t === me || !t.alive) continue;
        if (Math.hypot(t.pos.x - D.c.x, t.pos.z - D.c.z) < VOID.radius) this.reportHit(t, VOID.dmg, 'void', { slow: [0.05, VOID.stun], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.6, t.pos.z) });
      }
    } else if (D.trapped) {
      this.app.hud.banner('UNLIMITED VOID', 'YOU ARE TRAPPED', 1.6, 'kill');
      let k = 0.9;
      const fade = () => { this.app.hud.overload(k); k -= 0.08; if (k > 0) setTimeout(fade, 70); else this.app.hud.overload(0); };
      fade();
    }
  }
  _domainCineUpdate(dt) {
    const C = this.cine, hud = this.app.hud, V = this.voidFx;
    C.t += dt;
    const t = C.t, vic = !!C.victim;
    const mono = (s, big) => hud.cineMono(s, 'void', big);
    const cues = [
      [0.3, () => mono('Domain Expansion…')],
      [0.9, () => hud.cineGrade('cold')],
      // the world goes out like a light; a pinprick of black hole opens on the horizon
      [1.4, () => { hud.flash(1); hud.cineWipe(false); this._domainOpen(); V.setGrow(0.04); mono(''); hud.cineGrade('void'); }],
      [1.7, () => hud.cineCard('UNLIMITED VOID', '無 量 空 処', 'void')],
      [2.1, () => { this.sound('domain', C.c, 1.2, 200); this.fx.shake(0.35); }],
      [3.6, () => mono('In here, nothing is ever hidden from you.')],
      [4.9, () => mono('Every sight. Every sound. Every thought there is — all at once, forever.')],
      [5.35, () => { if (vic) { this.sound('domainCast', C.c, 0.8, 200); } }],
      [5.75, () => mono(vic ? 'You’ll understand everything…' : 'Being given everything…')],
      [6.65, () => { mono('…and be able to do absolutely nothing.'); if (vic) hud.overload(0.9); }],
      [7.55, () => { hud.overload(0); hud.cineWipe(false); mono('Throughout heaven and earth, I alone stand here.'); }],
      [C.dur - 0.2, () => mono('')],
    ];
    while (C.cue < cues.length && t >= cues[C.cue][0]) cues[C.cue++][1]();
    // the black hole swells from a pinprick to fill the horizon
    if (t >= 1.4) V.setGrow(0.04 + 0.96 * Math.pow(Math.min(1, (t - 1.4) / 2.2), 1.6));
    // the flood of information: a trickle, then a torrent pouring into the victim
    V.setFlood(t < 3.4 ? 0 : t < 5.35 ? (t - 3.4) * 0.12 : t < 7.55 ? Math.min(1, 0.25 + (t - 5.35) * 0.6) : 0.5);
    if (t >= 6.65 && t < 7.55 && vic && Math.random() < dt * 16) hud.flash(0.22);
    hud.cineDark(t < 1.4 ? Math.min(1, t / 0.6) * 0.8 : t < 6.65 ? 0.3 : 0.55);
    if (t >= C.dur) this._endCine();
  }
  _domainCineEnd(C) {
    this.app.hud.overload(0);
    this._domainOpen();
    this.voidFx.setGrow(1); this.voidFx.setFlood(0.3);
    for (const e of this.ents.values()) if (e.alive) e.view.root.visible = true;
    this._domainStrike(C.local);
  }
  _domainCineCamera() {
    const C = this.cine, t = C.t, o = C.caster.pos, f = C.f, sd = C.side, cam = this.camera;
    const P = tmpV, L = tmpV2;
    const ease = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
    const view = C.caster.view;
    const head = view.head.getWorldPosition(this._cv1 || (this._cv1 = new THREE.Vector3()));
    let fov = 45, roll = 0;
    const v = C.victim;
    if (t < 0.8) { // low, in front: he raises the sign
      const k = ease(t / 0.8), r = 2.4 - k * 0.6;
      P.set(o.x + f.x * r - sd.x * 0.5, o.y + 1.05, o.z + f.z * r - sd.z * 0.5);
      L.set(head.x, head.y - 0.05, head.z); fov = 42;
    } else if (t < 1.4) { // extreme close-up: the Six Eyes behind the raised hand
      const k = ease((t - 0.8) / 0.6);
      const hand = view.palmWorld('R', this._cv2 || (this._cv2 = new THREE.Vector3()));
      P.set(head.x + f.x * (0.85 - k * 0.25) + sd.x * 0.12, head.y + 0.02, head.z + f.z * (0.85 - k * 0.25) + sd.z * 0.12);
      L.lerpVectors(head, hand, 0.35); fov = 24; roll = 0.05;
    } else if (t < 3.6) { // the void: tiny against the black hole as it swells, the camera rising behind him
      const k = ease((t - 1.4) / 2.2);
      const back = 5 + k * 6;
      P.set(o.x - f.x * back + sd.x * (1.4 + k), o.y + 0.7 + k * 3, o.z - f.z * back + sd.z * (1.4 + k));
      L.set(o.x + f.x * 30, o.y + 4 + k * 4, o.z + f.z * 30); fov = 60 - k * 10; roll = -0.03;
    } else if (t < 5.35 || !v) { // a slow orbit round him; he does not move at all
      const k = (t - 3.6) / 1.75;
      const a = Math.atan2(f.x, f.z) + 0.5 + k * 1.6, r = 3.0;
      P.set(o.x + Math.sin(a) * r, o.y + 1.2, o.z + Math.cos(a) * r);
      L.set(head.x, head.y - 0.15, head.z); fov = 40;
    } else if (t < 6.65) { // over the victim's shoulder: the torrent of light pouring out of the hole into them
      const vp = v.pos, hole = this.voidFx.U.uHole.value, k = ease((t - 5.35) / 1.3);
      P.set(vp.x - hole.x * (3.2 - k) + sd.x * 1.2, vp.y + 1.9, vp.z - hole.z * (3.2 - k) + sd.z * 1.2);
      L.set(vp.x + hole.x * 20, vp.y + 5, vp.z + hole.z * 20); fov = 52; roll = 0.02;
    } else if (t < 7.55) { // the victim: frozen, eyes wide, the void pouring into them
      const vp = v.pos, vy = v.yaw || 0, k = ease((t - 6.65) / 0.9);
      P.set(vp.x + Math.sin(vy) * (1.3 - k * 0.45), vp.y + 1.55, vp.z + Math.cos(vy) * (1.3 - k * 0.45));
      L.set(vp.x, vp.y + 1.45, vp.z); fov = 32; roll = Math.sin(t * 40) * 0.012;
    } else { // him again from low behind: a silhouette against the black hole and its blazing ring
      const k = ease((t - 7.55) / (C.dur - 7.55));
      P.set(o.x - f.x * (2.4 + k * 0.8) + sd.x * 0.7, o.y + 0.45, o.z - f.z * (2.4 + k * 0.8) + sd.z * 0.7);
      L.set(head.x + f.x * 6, head.y + 1.6, head.z + f.z * 6); fov = 44;
    }
    P.y = Math.max(P.y, this.world.groundAt(P.x, P.z, P.y + 20) + 0.3);
    cam.position.copy(P); cam.lookAt(L);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return L;
  }
  // is `ent` (the caster) standing in his own open domain? (cooldowns run twice as fast)
  domainBoost(ent) {
    const D = this.domain;
    if (!D || ent.n !== D.owner) return false;
    const p = ent === this.local ? this.body.pos : ent.pos;
    return Math.hypot(p.x - D.c.x, p.z - D.c.z) < D.r;
  }
  // is `ent` an enemy caught inside an open domain? (deals less damage)
  inEnemyDomain(ent) {
    const D = this.domain;
    if (!D || !ent || ent.n === D.owner) return false;
    const p = ent === this.local ? this.body.pos : ent.pos;
    return Math.hypot(p.x - D.c.x, p.z - D.c.z) < D.r;
  }
  _updateDomain(dt) {
    const D = this.domain;
    if (D) {
      const owner = this.ents.get(D.owner);
      if (this.time > D.until || !owner || !owner.alive || owner.left) { this.domain = null; this.voidFx.end(); }
      else {
        const me = this.local, b = this.body;
        if (D.open && me.alive && me.n !== D.owner) {
          const dx = b.pos.x - D.c.x, dz = b.pos.z - D.c.z, dl = Math.hypot(dx, dz);
          // trapped: the barrier holds you in
          if (D.trapped && dl > D.r - 0.8) { const k = (D.r - 0.8) / dl; b.pos.x = D.c.x + dx * k; b.pos.z = D.c.z + dz * k; const vr = (b.vel.x * dx + b.vel.z * dz) / dl; if (vr > 0) { b.vel.x -= dx / dl * vr; b.vel.z -= dz / dl * vr; } }
          // slowed for as long as you are inside
          if (dl < D.r && b.slowT <= 0.15) { b.slowK = VOID.enemySlow; b.slowT = 0.15; }
        }
      }
    }
    this.voidFx.update(dt, this.camera);
  }

  update(dt) {
    const app = this.app, input = app.input;
    this.time += dt;
    if (!this.isHost) this._joinWatchdog(dt);
    if (this.phaseEnd) this.timeLeft = Math.max(0, this.phaseEnd - this.time);
    const st = input.poll();
    const [dx, dy] = input.consumeLook();
    const me = this.local;
    if (!app.paused && !app.chat.isOpen && !this.cine) this.cam.look(dx, dy, app.settings.sens, app.settings.invertY);
    if (this.cine) (this.cine.update || this._cineUpdate).call(this, dt);
    if (this.stunT > 0) this.stunT -= dt;
    const canMove = me.alive && this.controlsActive && this.phase !== 'warmup' && !this.cine && !(this.stunT > 0);

    // ---- local player
    if (me.alive) {
      const b = this.body;
      b.yaw = this.cam.yaw; b.pitch = this.cam.pitch;
      const cmd = canMove ? { fwd: st.fwd, side: st.side, jumpPressed: input.pressed.jump, dashPressed: input.pressed.dash, aim: st.aim } : { fwd: 0, side: 0 };
      const steps = Math.min(4, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        stepMovement(b, i === 0 ? cmd : { ...cmd, jumpPressed: false, dashPressed: false }, dt / steps, this.world, (k, d) => this._localEvent(k, d));
      }
      me.pos.copy(b.pos); me.vel.copy(b.vel); me.pitch = b.pitch; me.grounded = b.grounded;
      // shift-lock OFF: the camera orbits freely and the character turns to face where it runs
      // (so you can swing the camera round and see her front); it snaps to the camera to cast
      if (this.cam.free && !st.aim) {
        if (this.faceYaw === undefined) this.faceYaw = b.yaw;
        const sp = Math.hypot(b.vel.x, b.vel.z);
        if (this.faceLockT > 0) { this.faceLockT -= dt; this.faceYaw = b.yaw; }
        else if (sp > 0.6 && canMove) this.faceYaw += wrapPi(Math.atan2(b.vel.x, b.vel.z) - this.faceYaw) * (1 - Math.exp(-12 * dt));
        me.yaw = this.faceYaw;
      } else { me.yaw = b.yaw; this.faceYaw = b.yaw; }
    }
    if (canMove) this.kit.update(dt, input); else this.kit.update(dt, { pressed: {}, state: {} });
    input.clearPressed();

    // ---- remote interpolation
    const rt = this.time - INTERP_DELAY;
    for (const e of this.ents.values()) {
      if (e === this.local || e.dummy) continue;
      this._interp(e, rt);
    }
    if (this.rules) this.rules.update(dt);

    // ---- animation + visuals
    const pushers = [];
    const Q = this.map.Q;
    for (const e of this.ents.values()) {
      const v = e.view;
      if (e.hideAt && this.time > e.hideAt && !e.alive) { v.setVisible(false); e.hideAt = 0; }
      if (!v.root.visible) continue;
      v.root.position.copy(e.pos);
      if (e.liftY) v.root.position.y += e.liftY;
      // animation LOD: full rate up close, every 2nd/4th frame far away or off-screen
      e.animAcc = (e.animAcc || 0) + dt;
      const d2 = e.isLocal ? 0 : e.pos.distanceToSquared(this.camera.position);
      let every = d2 < 625 ? 1 : d2 < 2500 ? 2 : 4;
      if (!e.isLocal && !this._inView(e.pos)) every = 6;
      e.animTick = ((e.animTick || 0) + 1) % every;
      // character LOD: low-poly meshes from 14 m, no ink outline beyond 32 m (a 1-2 px line there)
      if (Q.outlines) { v.setLod(d2 > 196); v.setOutlines(d2 < 1024); }
      if (e.animTick === 0) {
        v.anim.update(e.animAcc, { pos: e.pos, yaw: e.yaw, pitch: e.pitch, vel: e.vel, grounded: e.grounded });
        v.root.rotation.y = e.yaw + v.anim.yawOffset;
        v.stepCape(e.animAcc);
        e.animAcc = 0;
      }
      v.root.rotation.y = e.yaw + v.anim.yawOffset;
      // remote land/jump inferred from state
      if (!e.isLocal) {
        if (e.grounded && !e.prevGrounded) v.anim.play('land', { vy: e.prevVy });
        if (!e.grounded && e.prevGrounded && e.vel.y > 3) v.anim.play('jumpStart');
        e.prevGrounded = e.grounded; e.prevVy = e.vel.y;
      }
      e.flash = Math.max(0, e.flash - dt * 6);
      v.setFlash(e.flash * 0.6);
      if (e.burnT > 0) { e.burnT -= dt; this.fx.burn(e.pos); }
      if (e.alive && pushers.length < 8) pushers.push(e.pos);
      // idle palm flame (+ leap jets)
      if (e.alive) {
        if (e.leapT > 0) { e.leapT -= dt; if (e.vel.y > 0 || e.leapT > 0.5) { this.fx.jet(v.handWorld('R', tmpV)); this.fx.jet(v.handWorld('L', tmpV)); } }
        if (e.mage === 'meteora') { if (Math.random() < 0.35) this.fx.staffGlow(v.staffTip(tmpV)); }
        else if (e.mage === 'sorcerer') { if (v.root.visible) this.fx.sixEyes(v.head.getWorldPosition(tmpV).add(tmpV2.set(Math.sin(e.yaw) * 0.09, 0.08, Math.cos(e.yaw) * 0.09))); }
        else if (e.mage === 'kineslayer') { /* no cursed energy: nothing glows on him */ }
        else {
          // Shoto: fire from the left hand, frost from the right
          if (Math.random() < 0.5) this.fx.palmFlame(v.palmWorld('L', tmpV), 0.7);
          if (Math.random() < 0.45) this.fx.frostMist(v.palmWorld('R', tmpV));
        }
        if (e.dashFx > 0) {
          e.dashFx -= dt; this.fx.dashStreak(e.pos, e.vel, e.mage);
          e.ghostT = (e.ghostT || 0) - dt;
          if (e.ghostT <= 0) { e.ghostT = 0.045; this._ghost(e); }
        }
        if (e.blitzT > 0) { e.blitzT -= dt; this.fx.blitzJets(e.pos, e.vel); }
        if (e.kickT > 0) { e.kickT -= dt; this.fx.kickTrail(v.rig.bones[20].getWorldPosition(tmpV), e.vel); }
        if (e.boostT > 0) { e.boostT -= dt; this.fx.boostFlames(v.rig.bones[16].getWorldPosition(tmpV)); this.fx.boostFlames(v.rig.bones[20].getWorldPosition(tmpV)); }
        if (e.stunT > 0) { e.stunT -= dt; if (v.root.visible) this.fx.stunStars(v.head.getWorldPosition(tmpV).add(tmpV2.set(0, 0.32, 0)), this.time); }
        else if (e.immT > 0 && v.root.visible) this.fx.immuneGlint(e.pos, this.time);
        if (e.immT > 0) e.immT -= dt;
        if (e.slowT > 0) { e.slowT -= dt; if (!(e.iceT > 0) && !this.inEnemyDomain(e)) this.fx.slowFx(e.pos); }
        if (e.iceT > 0) e.iceT -= dt;
      }
    }
    // local view fades when the camera is jammed against it
    this.view.root.visible = me.alive || (me.hideAt && this.time < me.hideAt) ? (this.cine ? true : !this.cam.tooClose) : this.view.root.visible;

    this.proj.update(dt);
    this._updateGhosts(dt);
    this._updateAreas(dt);
    this._updateDomain(dt);
    this._checkSigils();
    // altar brazier
    if (this.map.altar) {
      this.fx.brazier(this.map.altar);
      const dA = this.camera.position.distanceTo(this.map.altar);
      Audio.loop('brazier', 'fireLoop', 0.35 / (1 + (dA / 10) ** 2));
    }

    // ---- camera + aim
    let focus = me.alive ? me.pos : (me.hideAt ? me.pos : this.body.pos);
    if (this.cine) focus = (this.cine.camera || this._cineCamera).call(this);
    else this.cam.update(dt, focus, st.aim && me.alive, this.fx.shakeAmt);
    this._computeAim();
    this.fx.update(dt, this.camera, app.height);
    this.map.update(dt, this.camera, focus, pushers);

    // ---- net send
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / NET_HZ;
      if (this.isHost) this.rules.broadcastStates();
      else if (me.alive) {
        const b = this.body;
        this.net.send({ t: 's', p: [r3(b.pos.x), r3(b.pos.y), r3(b.pos.z)], v: [r2(b.vel.x), r2(b.vel.y), r2(b.vel.z)], y: r3(b.yaw), pi: r3(b.pitch), g: b.grounded ? 1 : 0 });
      }
    }
    app.hud.update(dt, this);
  }

  _localEvent(k, d) {
    const me = this.local, b = this.body;
    switch (k) {
      case 'jump': this.view.anim.play('jumpStart'); this.sound('jump', b.pos, 0.5, 20); break;
      case 'doubleJump': this.playAnim('doubleJump', d); this.sound('doubleJump', b.pos, 0.7, 25); this.fx.doubleJumpFx(b.pos, this.local.mage); break;
      case 'land': this.view.anim.play('land', d); if (d.vy < -6) this.sound('land', b.pos, Math.min(1, -d.vy / 14), 20); break;
      case 'dash': this.playAnim('dash', d); this.sound('dash', b.pos, 0.8, 25); me.dashFx = 0.24; this.fx.dashBurst(b.pos, b.dashDir, me.mage); this.cam.dashKick = 1; this.app.hud.dashImpact(); this.fx.shake(0.12); break;
      case 'roll': this.playAnim('roll', d); this.sound('roll', b.pos, 0.8, 20); break;
      case 'step': this.sound(d.water > 0.1 ? 'splash' : 'step', b.pos, d.water > 0.1 ? 0.4 : 0.25, 15); break;
      default: break;
    }
    void me;
  }

  _interp(e, rt) {
    const s = e.snaps;
    if (!s.length) return;
    let a = s[0], b = s[0];
    for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= rt) { a = s[i]; b = s[Math.min(i + 1, s.length - 1)]; break; } }
    if (rt < s[0].t) { a = b = s[0]; }
    let u = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 0;
    if (a === b && rt > a.t) {
      // extrapolate a little (max 150 ms)
      const ex = Math.min(0.15, rt - a.t);
      e.pos.set(a.x + a.vx * ex, a.y + (a.g ? 0 : a.vy * ex), a.z + a.vz * ex);
    } else {
      u = Math.min(1, Math.max(0, u));
      e.pos.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
    }
    e.vel.set(a.vx + (b.vx - a.vx) * u, a.vy + (b.vy - a.vy) * u, a.vz + (b.vz - a.vz) * u);
    e.yaw = a.yaw + wrapPi(b.yaw - a.yaw) * u;
    e.pitch = a.pitch + (b.pitch - a.pitch) * u;
    e.grounded = u < 0.5 ? a.g : b.g;
  }

  _computeAim() {
    const c = this.camera.position, f = this.cam.fwd;
    const maxD = 160;
    let best = this.world.raycast(c.x, c.y, c.z, f.x, f.y, f.z, maxD, 0, rayHit);
    this.aimEnt = null;
    const end = tmpV.copy(c).addScaledVector(f, Math.min(best, maxD));
    for (const e of this.ents.values()) {
      if (e === this.local || !e.alive) continue;
      const h = hitCharacter(e, c, end, 0);
      if (h) { const d = h.s * Math.min(best, maxD); if (d < best) { best = d; this.aimEnt = e; } }
    }
    // never aim at points between the camera and the character
    const minD = this.cam.curDist + 1;
    this.aimPoint.copy(c).addScaledVector(f, Math.max(minD, Math.min(best, maxD)));
  }

  render() { this.app.renderScene(this.scene, this.camera); }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  sendChat(text) { this.sendToHost({ t: 'chat', msg: text }); }

  dispose() {
    for (const e of this.ents.values()) if (e.spearFx) { e.spearFx.dispose(); e.spearFx = null; }
    if (this.cine) this._endCine();
    for (const off of this._offs || []) off();
    for (const ar of this.areas) if (ar.kind === 'wall') Audio.stopLoop('wall' + ar.id);
    Audio.stopLoop('brazier');
    for (const list of this.sigils.values()) for (const h of list) h.remove();
    applyBalance(null);
    this.fx.dispose();
    if (this.voidFx) this.voidFx.dispose();
    if (this.chessWorld) this.chessWorld.dispose();
    if (this._mate) this._mateCleanup();
    this.proj.clear();
    // the map is shared with the lobby: only remove what the match added
    for (const e of this.ents.values()) {
      this.scene.remove(e.view.root);
      if (e.view.silhouette) e.view.silhouette(null);
      for (const mesh of e.view.meshes) mesh.material.dispose();
    }
    for (const g of this.ghosts || []) { this.scene.remove(g.inst.root); g.mat.dispose(); }
  }
}

function distToSeg3(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const py = p.y + 0.9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (py - a.y) * dy + (p.z - a.z) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * t), py - (a.y + dy * t), p.z - (a.z + dz * t));
}
function distToSegXZ(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
void groundH;
