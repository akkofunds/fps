import * as THREE from 'three';
import { MODES, MAX_HP, NET_HZ, INTERP_DELAY } from '../config.js';
import { Audio } from '../core/audio.js';
import { addRecent } from '../core/storage.js';
import { groundH } from '../world/terrain.js';
import { Fx } from '../fx/arcane.js';
import '../fx/inferno.js';
import '../fx/novaStage.js';
import '../fx/frost.js';
import { FREEZE, BLITZ, ZERO } from './shoto.js';
import { KICK, STEP, ADOLLA, IGNITE } from './pyro.js';
import { loadMageModel, MageInstance } from '../character/characterModel.js';
import { Body, stepMovement } from './movement.js';
import { ShoulderCamera } from './camera.js';
import { Projectiles, hitCharacter } from './projectiles.js';
import { mageOf } from './mages.js';
import { NOVA, STARFALL } from './meteora.js';
import { BAL, applyBalance } from './balance.js';
import { Rules } from './rules.js';

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
        net.on('msg', (pid, msg) => { if (this._ready) { const e = this.byId.get(pid); if (e) this.hostHandle(e, msg); } else this._queue.push(['h', pid, msg]); }),
        net.on('leave', (pid) => { if (this._ready) this.onLeave(pid); else this._queue.push(['l', pid]); }),
      ];
    } else {
      this._offs = [
        net.on('msg', (msg) => { if (this._ready) this.clientHandle(msg); else this._queue.push(['c', msg]); }),
        net.on('close', () => { if (!this.ended && this.app.match === this) { if (this.phase === 'queue') this.app.leaveMatch('Lost the lobby host — searching again…', { requeue: true }); else this.app.leaveMatch('Disconnected from the match host.'); } }),
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
    for (const md of [mageOf('pyro'), mageOf('meteora')]) this.templates[md.id] = await loadMageModel(md.model);
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
      const mat = new THREE.MeshBasicMaterial({ color: e.mage === 'meteora' ? new THREE.Color(2.2, 0.35, 0.6) : new THREE.Color(2.4, 0.9, 0.25), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
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
    // catch the newcomer up: where everyone is, the phase, the board
    for (const o of this.ents.values()) {
      if (o === e || !o.alive) continue;
      const pos = o.isLocal ? this.body.pos : o.pos;
      this.net.send(p.id, { t: 'spawn', n: o.n, x: pos.x, y: pos.y, z: pos.z, yaw: o.isLocal ? this.body.yaw : o.yaw, quiet: 1 });
    }
    this.net.send(p.id, { t: 'phase', p: this.rules.phase, tl: 0 });
    this.rules.spawn(e);
    this.rules.sendBoard();
    this.app.chat.system(`${p.name} joined the lobby.`);
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
    this.sendToHost(msg);
    // instant feedback (host confirms HP)
    this.app.hud.hitMarker(extra.head, dmg);
    this.app.hud.damageNumber(extra.at || target.pos, dmg, extra.head);
    Audio.play(extra.head ? 'head' : 'hit', 0.6);
    if (!/^(nova|meteor|adolla|zero)/.test(ab)) this.kit.addUlt(Math.min(dmg, 40) * (target.dummy ? 0.12 : 0.22) * BAL.ult);
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
      case 'spark': this.proj.spawn(e.n, 'spark', d.o, d.d, local); this.fx.tipSeal(tmpV.fromArray(d.o), tmpV2.fromArray(d.d), 0.75, 0.4); if (!local) this.sound('spark', tmpV.fromArray(d.o), 0.5, 30); break;
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
          if (local) this.areaDamage(c, 3.2, 42, 18, 'blink', { kb: 6, up: 5 });
        });
        if (!local) e.snaps.length = 0;
        break;
      }
      case 'nova': {
        const c = new THREE.Vector3().fromArray(d.c), o = new THREE.Vector3().fromArray(d.o);
        this._startCine(e, c, o);
        const novaFx = this.fx.nova(c, o, {
          radius: NOVA.radius, channel: NOVA.channel, beam: 0.6,
          stagger: [3.62, 3.84, 4.06, 4.28, 4.5, 4.72, 4.94],
          onLayer: (i) => Audio.play('circleOn', 0.45 + i * 0.06, 0, 0.9 + i * 0.05),
          onFlash: () => {
            // anime impact frames, then the light
            this.app.hud.impactFrames(() => this.app.hud.flash(1));
            Audio.play('novaBoom', 1.4);
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
              this.areas.push({ kind: 'crater', c: c.clone(), r: NOVA.radius * 0.5, t: 0, life: 7, tick: 0.4, owner: e.n, local, dmg: 9, ab: 'novaBurn', burn: [6, 2] });
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
        if (this.cine && this.cine.caster === e) this.cine.novaFx = novaFx;
        // "EXPLOSION!": as she levels the staff, three seals stack open at its tip, aimed at the target
        setTimeout(() => {
          if (!e.view.root.visible) return;
          const tip = e.view.staffTip(new THREE.Vector3());
          this.fx.tipSeal(tip, new THREE.Vector3().subVectors(c, tip), 1.25, 1.1, 3);
        }, 6250);
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

  // ---------------------------------------------------------------- Crimson Nova cutscene
  // Universal: every client plays the same shots and all controls are locked until it ends.
  //  0.0–3.6  casting stage (the world vanishes: violet cosmos, golden molten circle, light pillars)
  //  3.6–5.4  the battlefield: seven seals stack in the sky over the target
  //  5.4–6.6  back on stage: spinning shot, "EXPLOSION!" with a whip zoom
  //  6.6–7.2  the beam drives down from the seals into the target
  //  7.2      impact frames → the explosion; wide shot of the catastrophe until 10.6
  _startCine(caster, c, o) {
    if (this.cine) return; // a second nova during one keeps its own effect, not a second camera
    const f = new THREE.Vector3(c.x - o.x, 0, c.z - o.z);
    if (f.lengthSq() < 0.01) f.set(Math.sin(caster.yaw), 0, Math.cos(caster.yaw));
    f.normalize();
    const stage = this.fx.novaStage(o);
    stage.group.rotation.y = Math.atan2(f.x, f.z);
    const m = this.map;
    const world = [m.terrain, m.grass, m.flowers, m.bushes, m.props, m.water, m.village, m.landmarks, m.sky, m.mountains].filter(Boolean);
    this.cine = { t: 0, dur: NOVA.cine, caster, c, o: o.clone(), f, side: new THREE.Vector3(-f.z, 0, f.x), subs: 0, stage, world, stageOn: null };
    caster.view.anim.windBoost = 1;
    this.app.hud.cineStart();
    Audio.play('rumble', 0.5);
    Audio.play('novaChant', 0.9);
    setTimeout(() => { if (this.cine) Audio.play('novaChant', 1, 0, 1.2); }, 2500);
    setTimeout(() => { if (this.cine) Audio.play('rumble', 0.9); }, 3600);
    setTimeout(() => { if (this.cine) Audio.play('novaWord', 1); }, 5900);
  }

  _cineSetStage(on) {
    const C = this.cine;
    if (C.stageOn === on) return;
    C.stageOn = on;
    C.stage.setOn(on);
    if (C.novaFx) C.novaFx.visible = !on;
    for (const o of C.world) o.visible = !on;
    for (const e of this.ents.values()) if (e !== C.caster && e.alive) e.view.root.visible = !on;
    this.scene.fog.far = on ? 1e5 : 650;
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
    if (this.rules) this.rules.bcast({ t: 'left', n: e.n });
  }

  // ---------------------------------------------------------------- client side (also runs on host)
  clientHandle(msg) {
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
      case 'slow': {
        const e = this.ents.get(msg.n);
        if (!e) return;
        e.slowT = msg.s;
        if (msg.k < 0.2) { e.iceT = msg.s; this.fx.iceBlock(e.pos.clone(), msg.s); this.sound('freeze', e.pos, 0.6, 25); }
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
        if (v === this.local) { hud.deathScreen(k, msg.ab, msg.rt); this.kit.pending.length = 0; }
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
      case 'hostLeft': if (this.phase === 'queue') this.app.leaveMatch('Lobby host left — searching again…', { requeue: true }); else this.app.leaveMatch('The match host left.'); break;
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
  update(dt) {
    const app = this.app, input = app.input;
    this.time += dt;
    if (this.phaseEnd) this.timeLeft = Math.max(0, this.phaseEnd - this.time);
    const st = input.poll();
    const [dx, dy] = input.consumeLook();
    const me = this.local;
    if (!app.paused && !app.chat.isOpen && !this.cine) this.cam.look(dx, dy, app.settings.sens, app.settings.invertY);
    if (this.cine) this._cineUpdate(dt);
    const canMove = me.alive && this.controlsActive && this.phase !== 'warmup' && !this.cine;

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
      // animation LOD: full rate up close, every 2nd/4th frame far away or off-screen
      e.animAcc = (e.animAcc || 0) + dt;
      const d2 = e.isLocal ? 0 : e.pos.distanceToSquared(this.camera.position);
      let every = d2 < 625 ? 1 : d2 < 2500 ? 2 : 4;
      if (!e.isLocal && !this._inView(e.pos)) every = 6;
      e.animTick = ((e.animTick || 0) + 1) % every;
      if (Q.outlines) v.setLod(d2 > 900); // beyond 30 m use the low-poly meshes
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
        else if (Math.random() < 0.5) this.fx.palmFlame(v.palmWorld('R', tmpV), 0.7);
        if (e.dashFx > 0) {
          e.dashFx -= dt; this.fx.dashStreak(e.pos, e.vel, e.mage);
          e.ghostT = (e.ghostT || 0) - dt;
          if (e.ghostT <= 0) { e.ghostT = 0.045; this._ghost(e); }
        }
        if (e.blitzT > 0) { e.blitzT -= dt; this.fx.blitzJets(e.pos, e.vel); }
        if (e.kickT > 0) { e.kickT -= dt; this.fx.kickTrail(v.rig.bones[20].getWorldPosition(tmpV), e.vel); }
        if (e.boostT > 0) { e.boostT -= dt; this.fx.boostFlames(v.rig.bones[16].getWorldPosition(tmpV)); this.fx.boostFlames(v.rig.bones[20].getWorldPosition(tmpV)); }
        if (e.slowT > 0) { e.slowT -= dt; if (!(e.iceT > 0)) this.fx.slowFx(e.pos); }
        if (e.iceT > 0) e.iceT -= dt;
      }
    }
    // local view fades when the camera is jammed against it
    this.view.root.visible = me.alive || (me.hideAt && this.time < me.hideAt) ? (this.cine ? true : !this.cam.tooClose) : this.view.root.visible;

    this.proj.update(dt);
    this._updateGhosts(dt);
    this._updateAreas(dt);
    this._checkSigils();
    // altar brazier
    if (this.map.altar) {
      this.fx.brazier(this.map.altar);
      const dA = this.camera.position.distanceTo(this.map.altar);
      Audio.loop('brazier', 'fireLoop', 0.35 / (1 + (dA / 10) ** 2));
    }

    // ---- camera + aim
    let focus = me.alive ? me.pos : (me.hideAt ? me.pos : this.body.pos);
    if (this.cine) focus = this._cineCamera();
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
    if (this.cine) this._endCine();
    for (const off of this._offs || []) off();
    for (const ar of this.areas) if (ar.kind === 'wall') Audio.stopLoop('wall' + ar.id);
    Audio.stopLoop('brazier');
    for (const list of this.sigils.values()) for (const h of list) h.remove();
    applyBalance(null);
    this.fx.dispose();
    this.proj.clear();
    // the map is shared with the lobby: only remove what the match added
    for (const e of this.ents.values()) {
      this.scene.remove(e.view.root);
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
