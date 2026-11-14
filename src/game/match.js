import * as THREE from 'three';
import { TICK, NET_HZ, INTERP_DELAY, PHYS, PHYS_BOOST, MAX_HP, MODES, toUPS } from '../config.js';
import { buildMap } from '../maps/index.js';
import { CharacterRenderer } from '../entities/characterModel.js';
import { TracerPool, DecalPool, SparkPool } from '../effects/pools.js';
import { BhopController } from '../physics/bhopController.js';
import { WeaponSystem, traceShot, dirFromAngles } from '../weapons/weaponSystem.js';
import { WEAPONS } from '../weapons/weaponDefs.js';
import { Rules } from './rules.js';
import { Audio } from '../core/audio.js';

const BUF = 16; // interpolation ring size
const ALLY = 0x4fd8ff, ENEMY = 0xff4655, TARGET = 0xffb03a;
const _hitOut = { t: 0, ent: null, zone: '' };

function rayBox(ox, oy, oz, idx, idy, idz, minX, minY, minZ, maxX, maxY, maxZ) {
  let t1 = (minX - ox) * idx, t2 = (maxX - ox) * idx;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (minY - oy) * idy; t2 = (maxY - oy) * idy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (minZ - oz) * idz; t2 = (maxZ - oz) * idz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  return tmax >= Math.max(tmin, 0) ? Math.max(tmin, 0) : Infinity;
}
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

function makeEnt(p) {
  return {
    pid: p.id, n: p.n, name: p.name, tag: p.tag || '', team: p.team, bot: !!p.bot, practice: !!p.practice,
    hp: MAX_HP, alive: false, kills: 0, deaths: 0, hsKills: 0, dmg: 0, w: 1,
    x: 0, y: -50, z: 0, yaw: 0, pitch: 0, crouch: false, onGround: true, vx: 0, vz: 0,
    bufT: new Float64Array(BUF), bufD: new Float32Array(BUF * 7), bufHead: 0, bufCount: 0,
    rx: 0, ry: -50, rz: 0, ryaw: 0, rpitch: 0, rc: 0, rw: 1, phase: 0, deadT: 0, flash: 0, stepT: 0, firedAt: 0,
    plx: 0, plz: 0, walk: 0, direct: false, respawnAt: 0,
  };
}

export class Match {
  constructor(app, { cfg, net, isHost, localId, players }) {
    this.app = app; this.cfg = cfg; this.net = net; this.isHost = isHost; this.localId = localId;
    this.mode = MODES[cfg.mode] || MODES.duel;
    this.hud = app.hud;
    // ---- scene ----
    const scene = this.scene = new THREE.Scene();
    this.map = buildMap(cfg.map, scene);
    scene.background = new THREE.Color(this.map.sky);
    scene.fog = new THREE.Fog(...this.map.fog);
    const [hs, hg, hi] = this.map.hemi;
    scene.add(new THREE.HemisphereLight(hs, hg, hi * 2.1));
    const [sc, si, sd] = this.map.sun;
    const sun = new THREE.DirectionalLight(sc, si * 1.5); sun.position.set(...sd); scene.add(sun);
    this.chars = new CharacterRenderer(scene, 16);
    this.tracers = new TracerPool(scene, 48);
    this.decals = new DecalPool(scene, 256);
    this.sparks = new SparkPool(scene, 256);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.vm = app.viewmodels;
    this.vm.select(1);
    this.vm.onEvent = (ev) => this._vmEvent(ev);
    if (this.map.buttons) this._buildButtons();

    // ---- entities ----
    this.ents = new Map(); this.byN = [];
    players.forEach((p, i) => {
      const e = makeEnt(p); e.slot = i;
      this.ents.set(p.id, e); this.byN[p.n] = e;
    });
    this.me = this.ents.get(localId);
    this.me.local = true;
    for (const e of this.ents.values()) if (isHost && e.bot) e.direct = true;
    this.entList = [...this.ents.values()];

    // ---- local player ----
    this.ctrl = new BhopController(this.map.world);
    this.ws = new WeaponSystem();
    this.ws.infinite = cfg.mode === 'range';
    this.yaw = 0; this.pitch = 0;
    this.accum = 0;
    this.physOpts = { airAccelerate: cfg.bhop ? PHYS_BOOST.airAccelerate : PHYS.airAccelerate, airCap: cfg.bhop ? PHYS_BOOST.airCap : PHYS.airCap, frozen: false };
    this.netT = 0; this.pingT = 0; this.ping = 0;
    this.clockOff = null;
    this.phase = 'warmup'; this.phaseEndLocal = 0; this.round = 0; this.score = [0, 0];
    this.killedBy = null; this.deathT = 0;
    this.buyOpen = false; this.ended = false;
    this.curFov = 70;
    this.hitsLocal = 0; this.shotsLocal = 0;
    this.lastImpact = null;
    this.scoped = 0;
    this.landDip = 0;
    this._dir = [0, 0, 0];
    this._shotCb = this._makeShotCb();
    this._traceEnts = (ox, oy, oz, dx, dy, dz, maxT) => this.traceEnts(ox, oy, oz, dx, dy, dz, maxT, this.me);

    // ---- networking ----
    if (isHost) {
      this.rules = new Rules(this);
      net.on('msg', (pid, msg) => {
        const e = this.ents.get(pid);
        if (!e) return;
        if (msg.t === 'ping') { net.send(pid, { t: 'pong', c: msg.c }); return; }
        this.rules.handle(e.n, msg);
      });
      net.on('leave', (pid) => { const e = this.ents.get(pid); if (e) this.rules.playerLeft(e.n); });
      net.on('hello', (conn) => { if (!conn._pid) net.reject(conn, 'in-progress'); });
    } else {
      net.on('msg', (msg) => this.onNet(msg, false));
      net.on('close', () => { if (!this.ended) this.app.leaveMatch('Connection to host lost.'); });
    }

    this.hud.enterMatch(this);
    this.app.chat.setContext('match', (text, team) => this.sendChat(text, team));
    if (isHost) this.rules.start(performance.now() / 1000);
  }

  // ---------------------------------------------------------------- utilities
  get now() { return performance.now() / 1000; }
  isEnemy(e) { if (e === this.me) return false; if (e.practice) return true; return this.mode.teams ? e.team !== this.me.team : true; }
  enemiesOf(e) {
    const out = this._enemies || (this._enemies = []); out.length = 0;
    for (const o of this.entList) {
      if (o === e || !o.alive || o.practice) continue;
      if (this.mode.teams && o.team === e.team) continue;
      if (o === this.me) { o.x = this.ctrl.x; o.y = this.ctrl.y; o.z = this.ctrl.z; o.crouch = this.ctrl.crouched; }
      out.push(o);
    }
    return out;
  }
  toHost(msg) { if (this.isHost) this.rules.handle(this.me.n, msg); else this.net.send(msg); }

  // ---------------------------------------------------------------- hit detection
  // Ray vs character hitboxes (head box + body box with leg zone). For bot shooters the host
  // uses latest positions; the local shooter uses what it currently renders (favor the shooter).
  traceEnts(ox, oy, oz, dx, dy, dz, maxT, shooter) {
    const idx = dx !== 0 ? 1 / dx : 1e30, idy = dy !== 0 ? 1 / dy : 1e30, idz = dz !== 0 ? 1 / dz : 1e30;
    let best = maxT, be = null, bz = '';
    const latest = shooter !== this.me;
    for (let i = 0; i < this.entList.length; i++) {
      const e = this.entList[i];
      if (!e.alive || e === shooter) continue;
      let x, y, z, cr;
      if (e === this.me) { x = this.ctrl.x; y = this.ctrl.y; z = this.ctrl.z; cr = this.ctrl.crouched ? 1 : 0; }
      else if (latest) { x = e.x; y = e.y; z = e.z; cr = e.crouch ? 1 : 0; }
      else { x = e.rx; y = e.ry; z = e.rz; cr = e.rc; }
      // cheap reject: distance from ray to the character's center
      const cx = x - ox, cy = y + 1 - oy, cz = z - oz;
      const along = cx * dx + cy * dy + cz * dz;
      if (along < 0 || along > best + 1) continue;
      const px = cx - dx * along, py = cy - dy * along, pz = cz - dz * along;
      if (px * px + py * py + pz * pz > 2.0) continue;
      const hy = y + 1.66 - cr * 0.54;
      const th = rayBox(ox, oy, oz, idx, idy, idz, x - 0.155, hy - 0.16, z - 0.155, x + 0.155, hy + 0.17, z + 0.155);
      if (th < best) { best = th; be = e; bz = 'head'; }
      const top = y + 1.5 - cr * 0.5;
      const tb = rayBox(ox, oy, oz, idx, idy, idz, x - 0.26, y, z - 0.26, x + 0.26, top, z + 0.26);
      if (tb < best) {
        best = tb; be = e;
        const hyy = oy + dy * tb;
        bz = hyy < y + 0.86 - cr * 0.36 ? 'leg' : 'body';
      }
    }
    if (shooter === this.me && this.buttons) {
      for (const b of this.map.buttons) {
        const t = rayBox(ox, oy, oz, idx, idy, idz, b.x - 0.68, b.y - 0.16, b.z - 0.06, b.x + 0.68, b.y + 0.16, b.z + 0.12);
        if (t < best) { best = t; be = b; bz = 'btn'; }
      }
    }
    if (!be) return null;
    _hitOut.t = best; _hitOut.ent = be; _hitOut.zone = bz;
    return _hitOut;
  }

  _makeShotCb() {
    const self = this;
    return {
      hitEntity(ent, zone, mul, x, y, z, dx, dy, dz, w) {
        if (zone === 'btn') { self.pressButton(ent.id); return; }
        self.sparks.burst(x, y, z, -dx, -dy, -dz, 7, 0.75, 0.05, 0.05, 2.5);
        if (!self.isEnemy(ent)) return;
        const dmg = (zone === 'head' ? w.head : zone === 'leg' ? w.leg : w.body) * mul;
        self.hitsLocal++;
        if (self.cfg.hsOnly && zone !== 'head') { self.hud.hitmarker(false, true); return; }
        const kill = ent.hp - dmg <= 0;
        self.hud.hitmarker(zone === 'head', false, kill);
        Audio.play(zone === 'head' ? 'head' : 'hit', zone === 'head' ? 0.9 : 0.5);
        ent.flash = 1;
        self.toHost({ t: 'hit', v: ent.n, d: Math.round(dmg * 10) / 10, z: zone, w: w.slot });
      },
      impact(x, y, z, nx, ny, nz, mat, obj, w, mul) {
        self.lastImpact = [nx, ny, nz];
        self.decals.spawn(x, y, z, nx, ny, nz, mat === 'wood' ? 1.1 : 1);
        if (mat === 'wood') { self.sparks.burst(x, y, z, nx, ny, nz, 6, 0.62, 0.42, 0.22, 3); Audio.play('wood', 0.25); }
        else self.sparks.burst(x, y, z, nx, ny, nz, 5, 1, 0.85, 0.5, 3.5);
        if (obj && obj.data && obj.data.maxHp !== undefined) self.toHost({ t: 'crate', i: obj.data.index, d: w.body * mul });
      },
    };
  }

  // ---------------------------------------------------------------- Range buttons
  _buildButtons() {
    const n = this.map.buttons.length;
    this.buttons = new THREE.InstancedMesh(new THREE.BoxGeometry(1.36, 0.3, 0.1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 }), n);
    const m4 = new THREE.Matrix4();
    this.map.buttons.forEach((b, i) => { m4.makeTranslation(b.x, b.y, b.z + 0.03); this.buttons.setMatrixAt(i, m4); });
    this.scene.add(this.buttons);
    this.rangeState = { mode: 'static', run: false, k: 0, hs: 0, tot: 50, time: 0 };
    this._colorButtons();
  }
  _colorButtons() {
    if (!this.buttons) return;
    const c = new THREE.Color();
    this.map.buttons.forEach((b, i) => {
      if (b.id === 'start') c.set(this.rangeState.run ? 0xff4655 : 0x2ecc71);
      else c.set(this.rangeState.mode === b.id ? 0xff4655 : 0x56606b);
      this.buttons.setColorAt(i, c);
    });
    this.buttons.instanceColor.needsUpdate = true;
  }
  pressButton(id) {
    if (this._btnCooldown && this.now < this._btnCooldown) return;
    this._btnCooldown = this.now + 0.35;
    Audio.play('ui', 0.8);
    this.toHost({ t: 'btn', id });
  }

  // ---------------------------------------------------------------- state ingest / interpolation
  pushSample(e, t, x, y, z, yaw, pitch, f, w) {
    const i = e.bufHead; e.bufHead = (i + 1) % BUF; if (e.bufCount < BUF) e.bufCount++;
    e.bufT[i] = t; const d = e.bufD, o = i * 7;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = pitch; d[o + 5] = f; d[o + 6] = w;
  }
  resetBuf(e) { e.bufCount = 0; e.bufHead = 0; }

  ingestState(e, msg, now) {
    if (e === this.me) return;
    e.x = msg.x; e.y = msg.y; e.z = msg.z; e.yaw = msg.yaw; e.pitch = msg.pitch;
    e.crouch = !!(msg.f & 2); e.onGround = !!(msg.f & 4); e.w = msg.w || 1;
    this.pushSample(e, now, msg.x, msg.y, msg.z, msg.yaw, msg.pitch, msg.f, e.w);
  }

  sampleEnt(e, t) {
    if (e.bufCount === 0) { e.rx = e.x; e.ry = e.y; e.rz = e.z; e.ryaw = e.yaw; e.rpitch = e.pitch; return; }
    const n = e.bufCount, T = e.bufT, D = e.bufD;
    // find newest sample with time <= t
    let newest = (e.bufHead - 1 + BUF) % BUF;
    let a = -1, b = newest;
    for (let k = 0; k < n; k++) {
      const i = (newest - k + BUF) % BUF;
      if (T[i] <= t) { a = i; break; }
      b = i;
    }
    let ia, ib, f;
    if (a === -1) { ia = ib = b; f = 0; } // older than all samples
    else if (a === newest) { ia = ib = a; f = 0; } // newer than latest: hold
    else { ia = a; ib = b; const span = T[ib] - T[ia]; f = span > 1e-6 ? (t - T[ia]) / span : 0; }
    const oa = ia * 7, ob = ib * 7;
    e.rx = D[oa] + (D[ob] - D[oa]) * f;
    e.ry = D[oa + 1] + (D[ob + 1] - D[oa + 1]) * f;
    e.rz = D[oa + 2] + (D[ob + 2] - D[oa + 2]) * f;
    e.ryaw = lerpAngle(D[oa + 3], D[ob + 3], f);
    e.rpitch = D[oa + 4] + (D[ob + 4] - D[oa + 4]) * f;
    const fl = D[ob + 5];
    e.crouch = !!(fl & 2); e.onGround = !!(fl & 4); e.rw = D[ob + 6];
  }

  // ---------------------------------------------------------------- network messages (host broadcasts + relays)
  onNet(msg, local) {
    const now = this.now;
    switch (msg.t) {
      case 's': {
        const sample = now - msg.T;
        if (this.clockOff === null) this.clockOff = sample;
        else if (sample < this.clockOff) this.clockOff = sample; // take faster arrivals immediately
        else this.clockOff += (sample - this.clockOff) * 0.02; // drift slowly upward
        const a = msg.e;
        for (let i = 0; i < a.length; i += 8) {
          const e = this.byN[a[i]];
          if (!e || e === this.me) continue;
          e.x = a[i + 1]; e.y = a[i + 2]; e.z = a[i + 3];
          this.pushSample(e, msg.T, a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7]);
        }
        break;
      }
      case 'spawn': {
        const e = this.byN[msg.n]; if (!e) break;
        e.alive = true; e.hp = MAX_HP; e.deadT = 0; e.x = msg.x; e.y = msg.y; e.z = msg.z; e.yaw = msg.yaw;
        this.resetBuf(e);
        const t = this.isHost ? now : (this.clockOff !== null ? now - this.clockOff : now);
        this.pushSample(e, t - 1, msg.x, msg.y, msg.z, msg.yaw, 0, 4, e.w);
        e.rx = msg.x; e.ry = msg.y; e.rz = msg.z;
        if (e === this.me) {
          this.ctrl.teleport(msg.x, msg.y, msg.z); this.yaw = msg.yaw; this.pitch = 0;
          this.ws.refill(); this.killedBy = null; this.hud.setDead(null);
          this.hud.setHP(MAX_HP);
        }
        break;
      }
      case 'phase': {
        const prev = this.phase;
        this.phase = msg.p; this.phaseEndLocal = now + msg.tl; this.round = msg.r; this.score = msg.sc;
        if (prev !== msg.p) {
          if (msg.p === 'buy') { this.hud.center(`ROUND ${msg.r}`, 'BUY PHASE — press B', 2.5); }
          if (msg.p === 'live' && this.mode.teams) { this.hud.center('', 'GO', 0.8); this.closeBuy(); }
        }
        break;
      }
      case 'roundEnd': {
        this.score = msg.sc;
        const won = msg.win === this.me.team;
        this.hud.center(won ? 'ROUND WON' : 'ROUND LOST', `${msg.sc[this.me.team]} — ${msg.sc[1 - this.me.team]}`, 3, won ? '#4fd8ff' : '#ff4655');
        Audio.play('found', 0.5, 0, won ? 1.2 : 0.7);
        break;
      }
      case 'dmg': {
        const v = this.byN[msg.v]; if (!v) break;
        v.hp = msg.hp; v.flash = 1;
        if (v === this.me) { this._damaged(msg.a); this.hud.setHP(msg.hp); }
        break;
      }
      case 'kill': {
        const a = this.byN[msg.a], v = this.byN[msg.v]; if (!v) break;
        v.alive = false; v.hp = 0; v.deadT = 0.0001;
        if (a && !v.practice) { if (!this.isHost) { a.kills++; v.deaths++; if (msg.h) a.hsKills++; } }
        this.hud.killfeed(a, v, msg.w, msg.h, a === this.me || v === this.me);
        if (v === this.me) {
          this.killedBy = a; this.deathT = now; this.hud.setHP(0);
          this.hud.setDead(a, this.mode.teams && !this.map.buttons ? 'Wait for the next round' : 'Respawning…');
          if (a && a !== this.me) this._damaged(msg.a);
          this.closeBuy();
        } else if (a === this.me) {
          Audio.play('kill', 0.45, 0, msg.h ? 1.25 : 1);
          if (!v.practice) this.hud.center('', `${msg.h ? '◎ ' : ''}ELIMINATED ${v.name}`, 1.3);
        }
        break;
      }
      case 'board': for (const r of msg.e) { const e = this.byN[r[0]]; if (e) { e.kills = r[1]; e.deaths = r[2]; e.hsKills = r[3]; e.dmg = r[4]; } } break;
      case 'chat': {
        const e = this.byN[msg.n];
        this.app.chat.add(msg.tm ? 'team' : 'all', e ? `${e.name}${e.tag ? '#' + e.tag : ''}` : '?', msg.m, e && e.team === this.me.team && this.mode.teams);
        break;
      }
      case 'shot': {
        if (msg.n === this.me.n) break;
        const e = this.byN[msg.n];
        const o = msg.o, en = msg.e;
        this.tracers.spawn(o[0], o[1], o[2], en[0], en[1], en[2]);
        if (msg.nrm) { this.decals.spawn(en[0], en[1], en[2], msg.nrm[0], msg.nrm[1], msg.nrm[2]); this.sparks.burst(en[0], en[1], en[2], msg.nrm[0], msg.nrm[1], msg.nrm[2], 4, 1, 0.85, 0.5, 3); }
        this.sparks.burst(o[0], o[1], o[2], 0, 0.2, 0, 3, 1, 0.8, 0.3, 1.2, 0);
        const w = WEAPONS[msg.w] || WEAPONS[1];
        Audio.play3D(w.id, o[0], o[1], o[2], this.ctrl.x, this.ctrl.y, this.ctrl.z, this.yaw, 0.9, w.id === 'sniper' ? 90 : 55, 0.95 + Math.random() * 0.1);
        if (e) e.firedAt = now;
        break;
      }
      case 'crateBreak': {
        const c = this.map.breakCrate(msg.i);
        if (c) {
          this.decals.clearBox(c.cx - c.size / 2, c.y0, c.cz - c.size / 2, c.cx + c.size / 2, c.y0 + c.h, c.cz + c.size / 2);
          this.sparks.burst(c.cx, c.y0 + c.h / 2, c.cz, 0, 1, 0, 40, 0.62, 0.42, 0.22, 5);
          Audio.play3D('wood', c.cx, c.y0, c.cz, this.ctrl.x, this.ctrl.y, this.ctrl.z, this.yaw, 1.2, 40, 0.6);
        }
        break;
      }
      case 'resetCrates': if (!local || !this.isHost) this.map.resetCrates(); break;
      case 'range': this.rangeState = msg; this._colorButtons(); this.hud.range(msg, this.hitsLocal, this.shotsLocal); break;
      case 'rangeBtn': if (msg.id === 'start' || msg.id === this.rangeState.mode) Audio.play('ui', 0.5); break;
      case 'rangeDone': {
        let best = null; try { best = JSON.parse(localStorage.getItem('riftline.best50') || 'null'); } catch { /* ignore */ }
        const isBest = !best || msg.time < best;
        if (isBest) { try { localStorage.setItem('riftline.best50', JSON.stringify(msg.time)); } catch { /* ignore */ } }
        this.hud.center('50-BOT TEST COMPLETE', `${msg.time.toFixed(2)}s · HS ${(msg.hs * 100).toFixed(0)}%${isBest ? ' · NEW BEST' : ''}`, 5, '#2ecc71');
        Audio.play('found', 0.6);
        break;
      }
      case 'hideAll': for (const e of this.entList) if (e.practice) { e.alive = false; e.deadT = 9; } break;
      case 'left': {
        const e = this.byN[msg.n]; if (!e) break;
        this.app.chat.system(`${e.name} left the match`);
        this.chars.hide(e.slot);
        this.ents.delete(e.pid); this.byN[msg.n] = null;
        this.entList = [...this.ents.values()];
        break;
      }
      case 'end': this._end(msg); break;
      case 'pong': this.ping = Math.round((now - msg.c) * 1000); break;
      case 'hostLeft': this.app.leaveMatch('The host left the match.'); break;
      default: break;
    }
  }

  _damaged(attN) {
    const a = this.byN[attN];
    Audio.play('hit', 0.5, 0, 0.6);
    if (!a) return;
    const ang = Math.atan2(-(a.rx - this.ctrl.x), -(a.rz - this.ctrl.z)) - this.yaw;
    this.hud.damageFrom(ang);
  }

  _end(msg) {
    if (this.ended) return;
    this.ended = true;
    let title, sub = '';
    if (this.mode.teams) { const won = msg.win === this.me.team; title = won ? 'VICTORY' : 'DEFEAT'; sub = `${msg.sc[this.me.team]} — ${msg.sc[1 - this.me.team]}`; }
    else { const w = this.byN[msg.win]; title = w === this.me ? 'VICTORY' : `${w ? w.name : '?'} WINS`; }
    this.hud.results(title, sub, this);
    setTimeout(() => this.app.leaveMatch(), 7000);
  }

  sendChat(text, team) { this.toHost({ t: 'chat', m: text, tm: team }); }

  // ---------------------------------------------------------------- buy menu
  canBuy() {
    if (!this.me.alive) return false;
    if (!this.mode.teams || this.map.buttons) return true;
    return this.phase === 'buy' || (this.phase === 'live' && this.phaseEndLocal - this.now > this.mode.roundTime - 15);
  }
  toggleBuy() { if (this.buyOpen) this.closeBuy(); else if (this.canBuy()) { this.buyOpen = true; this.hud.showBuy(true, this); } else this.hud.toast('Buy menu is only available during the buy phase'); }
  closeBuy() { if (this.buyOpen) { this.buyOpen = false; this.hud.showBuy(false, this); } }
  buy(slot) {
    if (!this.canBuy()) return;
    const a = this.ws.ammo[slot], w = WEAPONS[slot];
    a.mag = w.mag; a.reserve = w.reserve;
    this.selectSlot(slot);
    Audio.play('ui', 0.7);
    this.closeBuy();
  }
  selectSlot(slot) {
    if (this.ws.select(slot, this.now)) { this.vm.select(slot); Audio.play('reload', 0.4, 0, 0.8); }
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    const now = this.now;
    const app = this.app, input = app.input, s = app.settings;
    const me = this.me;
    const inp = input.poll();
    const pressed = input.pressed;
    const alive = me.alive;

    // --- look ---
    const [ldx, ldy] = input.consumeLook();
    const zoom = this.ws.zoomFactor();
    const sensBase = input.mode === 'touch' ? 0.0042 * s.touchSens : 0.0016 * s.sens;
    const sens = sensBase / zoom;
    if (alive) {
      this.yaw -= ldx * sens;
      this.pitch -= ldy * sens;
      if (this.pitch > 1.55) this.pitch = 1.55; if (this.pitch < -1.55) this.pitch = -1.55;
    }

    // --- movement (fixed 60 Hz, interpolated rendering) ---
    const frozen = !alive || this.phase === 'buy' || this.phase === 'end' || this.ended;
    this.physOpts.frozen = frozen;
    const moveInp = this._moveInp || (this._moveInp = { fwd: 0, side: 0, jump: false, crouch: false, walk: false });
    moveInp.fwd = inp.fwd; moveInp.side = inp.side; moveInp.jump = inp.jump; moveInp.crouch = inp.crouch && alive; moveInp.walk = inp.walk;
    this.accum += dt;
    let steps = 0;
    while (this.accum >= TICK && steps < 5) {
      this.ctrl.tick(TICK, moveInp, this.yaw, this.ws.maxSpeed(), this.physOpts);
      if (this.ctrl.landed && this.ctrl.lastFallSpeed > 0.35) { Audio.play('land', 0.25); this.vm.dip = 0.03; }
      if (this.isHost) this.rules.fixedUpdate(TICK, now);
      this.accum -= TICK; steps++;
    }
    if (steps === 5) this.accum = 0;
    const alpha = this.accum / TICK;
    const c = this.ctrl;
    const px = c.px + (c.x - c.px) * alpha, py = c.py + (c.y - c.py) * alpha, pz = c.pz + (c.z - c.pz) * alpha;
    const eye = c.peye + (c.eye - c.peye) * alpha;
    me.x = c.x; me.y = c.y; me.z = c.z; me.yaw = this.yaw; me.pitch = this.pitch; me.crouch = c.crouched; me.onGround = c.onGround; me.w = this.ws.slot;

    // --- weapon switching / interact ---
    if (alive && !input.typing) {
      if (pressed.slot) this.selectSlot(pressed.slot);
      if (pressed.cycle) this.selectSlot(((this.ws.slot - 1 + pressed.cycle + 3) % 3) + 1);
      if (pressed.interact && this.map.buttons) {
        dirFromAngles(this.yaw, this.pitch, this._dir);
        const h = this.traceEnts(px, py + eye, pz, this._dir[0], this._dir[1], this._dir[2], 4, this.me);
        if (h && h.zone === 'btn') this.pressButton(h.ent.id);
      }
    }

    // --- camera ---
    const cam = this.camera;
    cam.position.set(px, py + eye - (alive ? 0 : 0.9), pz);
    const pp = this.ws.punchP * Math.PI / 180, py2 = this.ws.punchY * Math.PI / 180;
    cam.rotation.set(this.pitch + pp, this.yaw + py2, 0);
    const aspect = app.aspect;
    const hfov = s.fov * Math.PI / 180;
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / Math.max(1.0, aspect)) * 180 / Math.PI;
    const target = 2 * Math.atan(Math.tan(vfov * Math.PI / 360) / zoom) * 180 / Math.PI;
    this.curFov += (target - this.curFov) * Math.min(1, dt * 22);
    if (Math.abs(cam.fov - this.curFov) > 0.01 || cam.aspect !== aspect) { cam.fov = this.curFov; cam.aspect = aspect; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    // --- shooting ---
    let fire = inp.fire, firePressed = pressed.fire;
    if (input.mode === 'touch') { firePressed = inp.fire && !this._touchFireWas; this._touchFireWas = inp.fire; }
    if (s.autoFire && input.mode === 'touch' && alive) {
      dirFromAngles(this.yaw + py2, this.pitch + pp, this._dir);
      const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
      const wt = this.map.world.raycast(ox, oy, oz, this._dir[0], this._dir[1], this._dir[2], 120, this._afHit || (this._afHit = {}));
      const h = this.traceEnts(ox, oy, oz, this._dir[0], this._dir[1], this._dir[2], Math.min(wt, 120), this.me);
      if (h && h.zone !== 'btn' && this.isEnemy(h.ent)) { fire = true; if (!this._afWas) firePressed = true; this._afWas = true; } else this._afWas = false;
    }
    const canShoot = alive && !this.buyOpen && !this.ended && this.phase !== 'buy' && this.phase !== 'end';
    const altPressed = pressed.alt;
    if (canShoot) {
      this.ws.update({
        now, dt, fire, firePressed, altPressed, reloadPressed: pressed.reload,
        altHeld: inp.alt, modePressed: pressed.mode, inspectPressed: pressed.inspect,
        adsToggle: input.mode === 'touch' || !!s.adsToggle,
        speed: c.speed2D(), onGround: c.onGround, crouched: c.crouched, yaw: this.yaw, pitch: this.pitch,
      }, (dx, dy, dz) => this._fireLocal(dx, dy, dz), (snd) => this._wsSound(snd));
    } else if (alive && pressed.reload) this.ws.startReload(now);

    // --- host rules ---
    if (this.isHost) this.rules.update(dt, now);

    // --- network out ---
    this.netT -= dt;
    if (this.netT <= 0) {
      this.netT += 1 / NET_HZ; if (this.netT < 0) this.netT = 0;
      if (this.isHost) this._sendSnapshot(now); else this._sendState();
    }
    if (!this.isHost) { this.pingT -= dt; if (this.pingT <= 0) { this.pingT = 2; this.net.send({ t: 'ping', c: now }); } }

    // --- remote characters ---
    const renderT = this.isHost ? now - INTERP_DELAY : now - (this.clockOff || 0) - INTERP_DELAY;
    for (let i = 0; i < this.entList.length; i++) {
      const e = this.entList[i];
      if (e === me) continue;
      if (!e.alive) {
        if (e.deadT > 0) e.deadT += dt;
        if (e.deadT <= 0 || e.deadT > 3) { this.chars.hide(e.slot); continue; }
      }
      if (e.direct) { e.rx = e.x; e.ry = e.y; e.rz = e.z; e.ryaw = e.yaw; e.rpitch = e.pitch; e.rw = e.w; }
      else if (e.alive) this.sampleEnt(e, renderT);
      e.rc += ((e.crouch ? 1 : 0) - e.rc) * Math.min(1, dt * 12);
      const mvx = (e.rx - e.plx) / Math.max(dt, 1e-4), mvz = (e.rz - e.plz) / Math.max(dt, 1e-4);
      e.plx = e.rx; e.plz = e.rz;
      const sp = Math.min(12, Math.sqrt(mvx * mvx + mvz * mvz));
      e.walk += (Math.min(1, sp / 5) - e.walk) * Math.min(1, dt * 8);
      e.phase += dt * (4 + sp * 1.3) * (e.walk > 0.05 ? 1 : 0);
      // remote footsteps (silent when walking with Shift / crouched)
      if (e.alive && e.onGround && sp > 3.6 && !e.crouch) {
        e.stepT -= dt * sp;
        if (e.stepT <= 0) { e.stepT = 2.4; Audio.play3D('step', e.rx, e.ry, e.rz, c.x, c.y, c.z, this.yaw, 0.55, 22, 0.8 + Math.random() * 0.3); }
      }
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 6);
      const fall = e.alive ? 0 : Math.min(1, e.deadT * 3.5);
      this.chars.set(e.slot, e.rx, e.ry, e.rz, e.ryaw, e.rc, e.phase, e.alive ? e.walk : 0, fall, e.rpitch);
      const col = e.practice ? TARGET : this.isEnemy(e) ? ENEMY : ALLY;
      if (e._col !== col || e.flash > 0 || e._fl) { this.chars.setColor(e.slot, col, e.flash); e._col = col; e._fl = e.flash > 0; }
    }
    this.chars.hide(me.slot);
    this.chars.flush();

    // --- effects ---
    this.tracers.update(dt);
    this.sparks.update(dt);

    // --- viewmodel ---
    const speed = c.speed2D();
    const ws = this.ws, adsE = ws.adsEase();
    const scoped = ws.scoped;
    const vs = this._vs || (this._vs = {});
    vs.lookDX = ldx; vs.lookDY = ldy; vs.move = Math.min(1, speed / PHYS.runSpeed); vs.onGround = c.onGround; vs.crouch = c.crouched ? 1 : 0;
    vs.ads = adsE; vs.reloadP = ws.reloadProgress(now); vs.boltP = ws.boltProgress(now); vs.drawP = ws.drawProgress(now);
    vs.inspectP = ws.inspectProgress(now); vs.fireAge = now - ws.lastShotT; vs.visible = alive && !scoped;
    vs.slideLocked = ws.slot === 2 && ws.ammo[2].mag === 0;
    this.vm.update(dt, vs);

    // --- HUD ---
    this.hud.frame(this, now, toUPS(speed), adsE);
    if (!alive && this.map.buttons && this.isHost) { /* range: no deaths */ }
    input.clearPressed();
  }

  // sounds keyed to the baked viewmodel animations
  _vmEvent(ev) {
    switch (ev) {
      case 'magout': Audio.play('reload', 0.55, 0.15, 0.75); break;
      case 'magin': Audio.play('reload', 0.65, 0.15, 1.15); Audio.play('empty', 0.3, 0.1, 0.8); break;
      case 'rack': Audio.play('bolt', 0.6, 0.2, 1.25); break;
      case 'release': Audio.play('bolt', 0.6, 0.2, 1.6); break;
      case 'boltup': Audio.play('bolt', 0.45, 0.25, 1.5); break;
      case 'boltback': Audio.play('bolt', 0.6, 0.25, 1.0); break;
      case 'boltfwd': Audio.play('bolt', 0.6, 0.25, 1.15); break;
      case 'boltdown': Audio.play('bolt', 0.45, 0.25, 1.7); break;
      case 'cloth': Audio.play('step', 0.25, 0, 1.6); break;
      case 'draw': Audio.play('reload', 0.3, 0.1, 1.4); break;
      default: break;
    }
  }

  _wsSound(snd) {
    if (snd === 'reload') Audio.play('step', 0.25, 0, 1.3);
    else if (snd === 'empty') Audio.play('empty', 0.6);
    else if (snd === 'mode') { Audio.play('ui', 0.5); this.hud.toast(this.ws.burstMode ? 'GLOCK: 3-ROUND BURST' : 'GLOCK: SEMI-AUTO', 900); }
    else if (snd === 'zoom') Audio.play('bolt', 0.25, 0, 1.6);
  }

  _fireLocal(dx, dy, dz) {
    const cam = this.camera, w = this.ws.def;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    this.lastImpact = null;
    this.shotsLocal++;
    const end = traceShot(this.map.world, this._traceEnts, ox, oy, oz, dx, dy, dz, w, this._shotCb);
    // tracer starts at the (approximate) world-space muzzle
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const mx = ox - sy * 0.55 + cy * 0.13, my = oy - 0.1, mz = oz - cy * 0.55 - sy * 0.13;
    if (w.slot === 3 || this.ws.shotsFired % 2 === 0 || w.slot === 2) this.tracers.spawn(mx, my, mz, end[0], end[1], end[2]);
    this.vm.fire((w.kick / 0.07) * (1 - 0.3 * this.ws.adsEase()), this.now);
    Audio.play(w.id, w.id === 'sniper' ? 0.95 : 0.7, 0, 0.96 + Math.random() * 0.08);
    this.me.firedAt = this.now;
    const r = (v) => Math.round(v * 100) / 100;
    this.toHost({ t: 'shot', o: [r(mx), r(my), r(mz)], e: [r(end[0]), r(end[1]), r(end[2])], nrm: this.lastImpact, w: w.slot });
  }

  _flags() { const c = this.ctrl; return (this.me.alive ? 1 : 0) | (c.crouched ? 2 : 0) | (c.onGround ? 4 : 0) | (this.ws.ads > 0.5 ? 8 : 0); }

  _sendState() {
    const c = this.ctrl, r = (v) => Math.round(v * 100) / 100, ra = (v) => Math.round(v * 1000) / 1000;
    this.net.send({ t: 'u', x: r(c.x), y: r(c.y), z: r(c.z), yaw: ra(this.yaw), pitch: ra(this.pitch), f: this._flags(), w: this.ws.slot });
  }

  _sendSnapshot(now) {
    if (!this.net.count) return;
    const a = this._snap || (this._snap = []); a.length = 0;
    const r = (v) => Math.round(v * 100) / 100, ra = (v) => Math.round(v * 1000) / 1000;
    for (const e of this.entList) {
      if (e === this.me) { const c = this.ctrl; a.push(e.n, r(c.x), r(c.y), r(c.z), ra(this.yaw), ra(this.pitch), this._flags(), this.ws.slot); continue; }
      if (!e.alive && e.deadT > 3) continue;
      a.push(e.n, r(e.x), r(e.y), r(e.z), ra(e.yaw), ra(e.pitch), (e.alive ? 1 : 0) | (e.crouch ? 2 : 0) | (e.onGround ? 4 : 0), e.w);
    }
    this.net.broadcast({ t: 's', T: Math.round(now * 1000) / 1000, e: a });
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.vm.scene, this.vm.camera);
    renderer.autoClear = true;
  }

  dispose() {
    this.ended = true;
    this.map.dispose();
    this.chars.dispose();
    for (const o of [this.tracers.mesh, this.decals.mesh, this.sparks.points, this.buttons]) {
      if (!o) continue;
      this.scene.remove(o); o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose();
    }
    this.vm.hideShells();
  }
}
