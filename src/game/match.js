import * as THREE from 'three';
import { MODES, MAX_HP, NET_HZ, INTERP_DELAY } from '../config.js';
import { Audio } from '../core/audio.js';
import { addRecent } from '../core/storage.js';
import { groundH } from '../world/terrain.js';
import { Fx } from '../fx/arcane.js';
import { loadMageModel, MageInstance } from '../character/characterModel.js';
import { Body, stepMovement } from './movement.js';
import { ShoulderCamera } from './camera.js';
import { Projectiles, hitCharacter } from './projectiles.js';
import { mageOf } from './mages.js';
import { NOVA } from './meteora.js';
import { Rules } from './rules.js';

// One match: world, entities, local control, network sync, abilities and rendering.
//
// Network (star around the host, JSON over WebRTC):
//   client → host   s (own state 20 Hz) · ev (ability / animation events) · hit (shooter-side hits) · chat
//   host → all      S (all states) · ev (relayed) · hp · kill · spawn · kb · board · phase · end · chat
// The host runs Rules (HP, kills, respawns, burning, scoring) and also plays as a normal client.

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), rayHit = { t: 0 };
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

class Ent {
  constructor(p, isLocal) {
    this.n = p.n; this.id = p.id; this.name = p.name; this.tag = p.tag || '';
    this.isLocal = isLocal; this.dummy = !!p.dummy;
    this.mage = p.mage && !p.dummy ? p.mage : 'pyro';
    this.alive = false; this.hp = MAX_HP;
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
        net.on('close', () => { if (!this.ended) this.app.leaveMatch('Disconnected from the match host.'); }),
      ];
    }
  }

  async init() {
    const app = this.app;
    this.map = app.map;
    this.scene = this.map.scene; this.world = this.map.world;
    this.camera = new THREE.PerspectiveCamera(app.settings.fov, app.aspect, 0.08, 3000);
    this.fx = new Fx(this.scene, this.world);
    // without bloom, additive HDR fire saturates to white; tone it down
    if (!app.composer) this.fx.fire.mat.uniforms.uGain.value = 0.55;
    this.proj = new Projectiles(this);
    const templates = {};
    for (const p of this.players) { const md = mageOf(p.mage); if (!templates[md.id]) templates[md.id] = await loadMageModel(md.model); }
    if (!templates.pyro) templates.pyro = await loadMageModel(mageOf('pyro').model);
    const groundAt = (x, z) => this.world.groundAt(x, z, 1e9);
    const list = [...this.players];
    if (this.cfg.mode === 'practice') {
      for (let i = 0; i < 5; i++) list.push({ n: 100 + i, id: `dummy-${i}`, name: 'Training Dummy', tag: '', dummy: true });
    }
    for (const p of list) {
      const e = new Ent(p, p.id === this.localId);
      e.view = new MageInstance(templates[mageOf(e.mage).id] || templates.pyro, { groundAt }).uniqueMaterials();
      if (e.dummy) for (const mesh of e.view.meshes) if (!mesh.userData.outline) { mesh.material.color.setRGB(0.55, 0.5, 0.42); mesh.material.emissive.multiplyScalar(0.45); }
      e.view.setVisible(false);
      this.scene.add(e.view.root);
      this.ents.set(e.n, e); this.byId.set(e.id, e);
    }
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
  castAbility(data) {
    this.spawnAbility(this.local, data, true);
    this.sendToHost({ t: 'ev', k: 'ab', ...data });
  }

  reportHit(target, dmg, ab, extra = {}) {
    if (!target || !target.alive) return;
    const msg = { t: 'hit', v: target.n, dmg, ab, head: extra.head ? 1 : 0 };
    if (extra.burn) msg.burn = extra.burn;
    if (extra.kb) msg.kb = extra.kb;
    this.sendToHost(msg);
    // instant feedback (host confirms HP)
    this.app.hud.hitMarker(extra.head, dmg);
    this.app.hud.damageNumber(extra.at || target.pos, dmg, extra.head);
    Audio.play(extra.head ? 'head' : 'hit', 0.6);
    this.kit.addUlt(dmg * (target.dummy ? 0.12 : 0.22));
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
      case 'spark': this.proj.spawn(e.n, 'spark', d.o, d.d, local); if (!local) this.sound('spark', tmpV.fromArray(d.o), 0.5, 30); break;
      case 'starfall': {
        const c = new THREE.Vector3().fromArray(d.c);
        this.sound('meteorFall', c, 0.5, 40);
        this.fx.starfall(c, 3.8, 0.75, () => {
          this.sound('explode', c, 0.9, 40);
          if (local) this.areaDamage(c, 3.8, 55, 20, 'starfall', { kb: 6 });
        });
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
        this.fx.sparkBurst(new THREE.Vector3(a.x, a.y + 0.6, a.z), 3);
        this.sound('blink', b, 0.8, 30);
        if (local) this.areaDamage(new THREE.Vector3(a.x, a.y + 0.6, a.z), 3, 30, 15, 'blink', {});
        if (!local) e.snaps.length = 0;
        break;
      }
      case 'nova': {
        const c = new THREE.Vector3().fromArray(d.c), o = new THREE.Vector3().fromArray(d.o);
        this.sound('novaChant', o, 1.2, 120);
        this.app.hud.novaWarning(c, NOVA.radius, e === this.local);
        this.fx.nova(c, o, {
          radius: NOVA.radius, channel: NOVA.channel,
          onFlash: () => {
            // everyone who can see it gets blinded for a moment
            const dist = this.camera.position.distanceTo(c);
            this.app.hud.flash(Math.max(0, Math.min(1, 1.3 - dist / 140)));
            this.sound('novaBoom', c, 1.5, 300);
          },
          onImpact: () => {
            if (local) this.areaDamage(c, NOVA.radius, NOVA.maxDmg, NOVA.minDmg, 'nova', { kb: 16, up: 12, noCover: true, burn: [8, 3] });
            // the shockwave shoves the local player even outside the kill radius
            const me = this.local;
            if (me.alive && e !== me) {
              const dx = me.pos.x - c.x, dz = me.pos.z - c.z, dl = Math.hypot(dx, dz);
              if (dl < NOVA.radius * 2.2 && dl > 0.1) { const k = (1 - dl / (NOVA.radius * 2.2)) * 14; this.body.vel.x += dx / dl * k; this.body.vel.z += dz / dl * k; this.body.vel.y = Math.max(this.body.vel.y, k * 0.5); this.body.grounded = false; }
            }
          },
        });
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

  _checkSigils() {
    const mine = this.sigils.get(this.local.n);
    if (!mine || !this.local.alive) return;
    for (const h of mine) {
      if (!h.armed || h.fired) continue;
      for (const e of this.ents.values()) {
        if (e === this.local || !e.alive) continue;
        if (Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) < 2.0 && Math.abs(e.pos.y - h.pos.y) < 2) {
          h.fired = true;
          this.castAbility({ ab: 'sigilBoom', id: h.id, c: [h.pos.x, h.pos.y, h.pos.z] });
          break;
        }
      }
    }
  }

  // positional sound relative to the camera
  listener() { return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, yaw: this.cam.yaw }; }
  sound(name, pos, gain = 1, falloff = 30) { Audio.at(name, pos, this.listener(), gain, falloff); }

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
        if (msg.k === 'anim') e.view.anim.play(msg.a, msg.d || {});
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
          if (prev - msg.hp >= 5) e.view.anim.play('hit');
          if (e === this.local) {
            hud.hurt(prev - msg.hp, this.ents.get(msg.by));
            Audio.play('hurt', Math.min(1, 0.4 + (prev - msg.hp) / 60));
          }
        }
        break;
      }
      case 'burn': { const e = this.ents.get(msg.n); if (e) e.burnT = msg.s; break; }
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
        e.alive = true; e.hp = MAX_HP; e.burnT = 0; e.hideAt = 0;
        e.pos.set(msg.x, msg.y, msg.z); e.vel.set(0, 0, 0); e.yaw = msg.yaw; e.snaps.length = 0;
        e.view.anim.play('respawn');
        e.view.setVisible(true);
        e.spawnProt = this.time + 1.5;
        this.fx.spawnPillar(e.pos);
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
      case 'hostLeft': this.app.leaveMatch('The match host left.'); break;
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
    if (!app.paused && !app.chat.isOpen) this.cam.look(dx, dy, app.settings.sens, app.settings.invertY);
    const canMove = me.alive && this.controlsActive && this.phase !== 'warmup';

    // ---- local player
    if (me.alive) {
      const b = this.body;
      b.yaw = this.cam.yaw; b.pitch = this.cam.pitch;
      const cmd = canMove ? { fwd: st.fwd, side: st.side, jumpPressed: input.pressed.jump, dashPressed: input.pressed.dash, aim: st.aim } : { fwd: 0, side: 0 };
      const steps = Math.min(4, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        stepMovement(b, i === 0 ? cmd : { ...cmd, jumpPressed: false, dashPressed: false }, dt / steps, this.world, (k, d) => this._localEvent(k, d));
      }
      me.pos.copy(b.pos); me.vel.copy(b.vel); me.yaw = b.yaw; me.pitch = b.pitch; me.grounded = b.grounded;
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
    for (const e of this.ents.values()) {
      const v = e.view;
      if (e.hideAt && this.time > e.hideAt && !e.alive) { v.setVisible(false); e.hideAt = 0; }
      if (!v.root.visible) continue;
      v.root.position.copy(e.pos);
      v.anim.update(dt, { pos: e.pos, yaw: e.yaw, pitch: e.pitch, vel: e.vel, grounded: e.grounded });
      v.root.rotation.y = e.yaw + v.anim.yawOffset;
      // remote land/jump inferred from state
      if (!e.isLocal) {
        if (e.grounded && !e.prevGrounded) v.anim.play('land', { vy: e.prevVy });
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
        if (this.body.dashT > 0 && e === this.local) this.fx.dashTrail(e.pos);
      }
    }
    // local view fades when the camera is jammed against it
    this.view.root.visible = me.alive || (me.hideAt && this.time < me.hideAt) ? !this.cam.tooClose : this.view.root.visible;

    this.proj.update(dt);
    this._updateAreas(dt);
    this._checkSigils();
    // altar brazier
    this.fx.brazier(this.map.altar);
    const dA = this.camera.position.distanceTo(this.map.altar);
    Audio.loop('brazier', 'fireLoop', 0.35 / (1 + (dA / 10) ** 2));

    // ---- camera + aim
    const focus = me.alive ? me.pos : (me.hideAt ? me.pos : this.body.pos);
    this.cam.update(dt, focus, st.aim && me.alive, this.fx.shakeAmt);
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
      case 'land': this.view.anim.play('land', d); if (d.vy < -6) this.sound('land', b.pos, Math.min(1, -d.vy / 14), 20); break;
      case 'dash': this.playAnim('dash', d); this.sound('dash', b.pos, 0.8, 25); this.fx.dashTrail(b.pos); break;
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
    for (const off of this._offs || []) off();
    for (const ar of this.areas) if (ar.kind === 'wall') Audio.stopLoop('wall' + ar.id);
    Audio.stopLoop('brazier');
    for (const list of this.sigils.values()) for (const h of list) h.remove();
    this.fx.dispose();
    this.proj.clear();
    // the map is shared with the lobby: only remove what the match added
    for (const e of this.ents.values()) {
      this.scene.remove(e.view.root);
      for (const mesh of e.view.meshes) mesh.material.dispose();
    }
  }
}

function distToSegXZ(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
void groundH;
