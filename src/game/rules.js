import { REGEN_DELAY, REGEN_RATE, MODES } from '../config.js';
import { BAL } from './balance.js';
import { VOID } from './sorcerer.js';

// HOST-ONLY authority: phases, HP, burning, kills, respawns, scoring, practice dummies.
// Every state change is broadcast to clients and applied locally through Match.clientHandle.
const MAX_HIT = { novaFrag: 20, novaShock: 24, novaBurn: 8, bolt: 30, orb: 45, wall: 10, leap: 30, meteor: 100, kick: 40, blast: 40, shard: 30, ray: 54, freeze: 14, heatwave: 40, lance: 62, uppercut: 30, zero: 18, zeroBoom: 100, ember: 14, igniteBoom: 34, step: 36, adolla: 130, trail: 10, adollaPath: 12, spark: 24, sparkBig: 30, starfall: 16, sigil: 80, blink: 32, nova: 100, flick: 26, blue: 18, red: 38, redSplash: 22, purple: 68, void: 10, m1: 12, m1f: 16, flash: 26, slam: 36, nullify: 42, sever: 14, severFin: 42 };
// every piece of an ultimate (blast, fragments, shockwave, burning crater, freeze) adds up to at
// most this share of max HP per victim: ultimates hit hard but never kill from full health
const ULT_ABS = new Set(['nova', 'novaFrag', 'novaShock', 'novaBurn', 'zero', 'zeroBoom', 'adolla', 'adollaPath', 'meteor', 'void', 'sever', 'severFin']);
const ULT_CAP = 0.5, ULT_WINDOW = 14;
const STUN_CHAIN = 2.2, STUN_IMMUNE = 1.6, STUN_RESET = 0.6;

export class Rules {
  constructor(match) {
    this.m = match;
    this.mode = MODES[match.cfg.mode] || MODES.ffa;
    this.killsToWin = match.killsToWin;
    this.timeLimit = match.cfg.timeLimit || this.mode.timeLimit;
    this.phase = 'warmup';
    this.phaseEnd = 0;
    this.now = 0;
    this.boardT = 0; this.hpT = 0;
    this.burns = new Map(); // n → { dps, until, by, acc }
    this.respawnAt = new Map();
    this.lastDamage = new Map();
    this.lastHit = new Map(); // anti-spam per attacker
    this.stuns = new Map(); // n → { until, chain, imm } stun budget per target
    this.ultDmg = new Map(); // "attacker>victim" → { t0, sum } ultimate damage dealt in the window
  }

  bcast(msg) {
    this.m.net.broadcast(msg);
    this.m.clientHandle(msg);
  }

  start() {
    if (this.mode.quickplay) {
      // quickplay FFA: always live, no clock, no kill limit, no scoreboard
      this.phase = 'live'; this.phaseEnd = 0; this.timeLimit = 0;
      this.spawnAll();
      this.bcast({ t: 'phase', p: 'live', tl: 0 });
      return;
    }
    if (this.m.cfg.queue) {
      // matchmaking lobby: free roam + warm-up fights until the lobby fills
      this.phase = 'queue'; this.phaseEnd = 0;
      this.spawnAll();
      this.bcast({ t: 'phase', p: 'queue', tl: 0 });
      return;
    }
    const practice = this.m.cfg.mode === 'practice';
    this.phase = practice ? 'live' : 'warmup';
    this.phaseEnd = this.now + (practice ? 0 : 4);
    this.spawnAll();
    if (practice) this.spawnDummies();
    this.bcast({ t: 'phase', p: this.phase, tl: practice ? 0 : 4 });
  }

  // lobby full → reset the warm-up scores and start the real match in place
  goLive() {
    if (this.phase !== 'queue') return;
    for (const e of this.m.ents.values()) { e.kills = 0; e.deaths = 0; e.dmg = 0; }
    this.burns.clear(); this.respawnAt.clear();
    this.phase = 'warmup'; this.phaseEnd = this.now + 5;
    this.bcast({ t: 'qlive' });
    this.spawnAll();
    this.bcast({ t: 'phase', p: 'warmup', tl: 5 });
    this.sendBoard();
  }

  spawnAll() { for (const e of this.m.ents.values()) if (!e.dummy && !e.left) this.spawn(e); }

  spawnDummies() {
    const map = this.m.map;
    const sp = map.spawns[0];
    const l = Math.hypot(sp.x, sp.z) || 1;
    const dx = -sp.x / l, dz = -sp.z / l, px = -dz, pz = dx;
    let i = 0;
    for (const e of this.m.ents.values()) {
      if (!e.dummy) continue;
      const d = 11 + (i % 2) * 7, lat = (i - 2) * 3.6;
      const x = sp.x + dx * d + px * lat, z = sp.z + dz * d + pz * lat;
      const y = map.world.groundAt(x, z, 50);
      this.bcast({ t: 'spawn', n: e.n, x, y, z, yaw: Math.atan2(sp.x - x, sp.z - z) });
      e.home = { x, y, z };
      i++;
    }
  }

  pickSpawn(e) {
    const list = this.m.map.spawns;
    let best = list[0], bestD = -1;
    for (const s of list) {
      let md = 1e9;
      for (const o of this.m.ents.values()) { if (o === e || !o.alive) continue; const d = (o.pos.x - s.x) ** 2 + (o.pos.z - s.z) ** 2; if (d < md) md = d; }
      md += Math.random() * 60;
      if (md > bestD) { bestD = md; best = s; }
    }
    return best;
  }

  spawn(e) {
    const s = this.m.cfg.mode === 'practice' ? this.m.map.spawns[0] : this.pickSpawn(e);
    const jx = (Math.random() - 0.5) * 1.2, jz = (Math.random() - 0.5) * 1.2;
    this.respawnAt.delete(e.n);
    this.burns.delete(e.n);
    this.stuns.delete(e.n);
    this.bcast({ t: 'spawn', n: e.n, x: s.x + jx, y: this.m.world.groundAt(s.x + jx, s.z + jz, s.y + 2) + 0.02, z: s.z + jz, yaw: s.yaw });
  }

  onHit(from, msg) {
    if (this.phase !== 'live' && this.phase !== 'queue') return;
    const v = this.m.ents.get(msg.v);
    if (!v || !v.alive || v === from) return;
    if (v.spawnProt && this.m.time < v.spawnProt) return;
    const cap = MAX_HIT[msg.ab];
    if (!cap) return;
    if (BAL.godMode && this.m.cfg.mode === 'practice' && v.isLocal) return;
    let dmg = Math.max(0, Math.round(Math.min(cap, Number(msg.dmg) || 0) * BAL.dmg));
    // Unlimited Void: enemies trapped in the Sorcerer's domain hit 40% softer
    if (this.m.inEnemyDomain && this.m.inEnemyDomain(from)) dmg = Math.round(dmg * VOID.enemyDmg);
    if (ULT_ABS.has(msg.ab)) {
      const key = `${from.n}>${v.n}`, u = this.ultDmg.get(key);
      const rec = u && this.now - u.t0 < ULT_WINDOW ? u : { t0: this.now, sum: 0 };
      dmg = Math.min(dmg, Math.max(0, Math.round(BAL.hp * ULT_CAP) - rec.sum));
      rec.sum += dmg; this.ultDmg.set(key, rec);
    }
    if (!dmg) return;
    this.damage(v, dmg, from, msg.ab);
    if (v.alive && Array.isArray(msg.burn)) {
      const dps = Math.min(8, Number(msg.burn[0]) || 0), secs = Math.min(4, Number(msg.burn[1]) || 0);
      const cur = this.burns.get(v.n);
      this.burns.set(v.n, { dps, until: this.now + secs, by: from.n, acc: cur ? cur.acc : 0 });
      this.bcast({ t: 'burn', n: v.n, s: secs });
    }
    if (v.alive && Array.isArray(msg.slow)) {
      const k = Math.max(0, Math.min(1, Number(msg.slow[0]) || 0)), s = Math.max(0, Math.min(3, Number(msg.slow[1]) || 0));
      if (s > 0) this.bcast({ t: 'slow', n: v.n, k, s });
    }
    if (v.alive && msg.stun) this._stun(v, Math.max(0, Math.min(1.2, Number(msg.stun) || 0)), msg);
    if (v.alive && Array.isArray(msg.kb)) {
      const k = msg.kb.map((x) => Math.max(-16, Math.min(16, Number(x) || 0)));
      if (v.isLocal) this.m.clientHandle({ t: 'kb', n: v.n, v: k });
      else if (!v.dummy) this.m.net.send(v.id, { t: 'kb', n: v.n, v: k });
    }
  }

  // Stun budget: no infinite stun-locks. One continuous chain can hold a target for at most
  // STUN_CHAIN seconds (a full M1 string, finisher included); after that, or after any launching
  // finisher, the target is immune to stun for STUN_IMMUNE seconds once the stun wears off, so
  // there is always a window to dash out. The chain resets once they have been free for a moment.
  _stun(v, s, msg) {
    if (s <= 0) return;
    const now = this.now;
    const st = this.stuns.get(v.n) || { until: 0, chain: 0, imm: 0 };
    if (now < st.imm) return;                                 // immune: the hit lands, the stun doesn't
    if (now > st.until + STUN_RESET) st.chain = 0;            // they got free: a new chain
    const until = Math.max(st.until, now + s);
    let ext = until - Math.max(st.until, now);                // how much longer this keeps them stunned
    ext = Math.min(ext, Math.max(0, STUN_CHAIN - st.chain));
    if (ext <= 0.02) { st.imm = Math.max(st.imm, now + STUN_IMMUNE); this.stuns.set(v.n, st); this.bcast({ t: 'stunImm', n: v.n, s: STUN_IMMUNE }); return; }
    st.chain += ext;
    st.until = Math.max(st.until, now) + ext;
    const left = st.until - now;
    const finisher = /^(m1f|severFin|slam)$/.test(msg.ab) || (Array.isArray(msg.kb) && Number(msg.kb[1]) >= 6);
    if (st.chain >= STUN_CHAIN - 0.02 || finisher) {
      st.imm = st.until + STUN_IMMUNE;
      this.bcast({ t: 'stunImm', n: v.n, s: left + STUN_IMMUNE });
    }
    this.stuns.set(v.n, st);
    this.bcast(msg.nul ? { t: 'stun', n: v.n, s: left, nul: 1 } : { t: 'stun', n: v.n, s: left });
  }

  damage(v, dmg, from, ab) {
    v.hp = Math.max(0, v.hp - dmg);
    if (from) from.dmg += dmg;
    this.lastDamage.set(v.n, this.now);
    this.bcast({ t: 'hp', n: v.n, hp: v.hp, by: from ? from.n : -1, ab });
    if (v.hp <= 0) this.kill(v, from, ab);
  }

  kill(v, k, ab) {
    v.alive = false;
    v.deaths++;
    if (k && k !== v && !v.dummy) k.kills++;
    const rt = v.dummy ? 2 : this.phase === 'queue' ? 1.5 : BAL.respawn;
    this.respawnAt.set(v.n, this.now + rt);
    this.burns.delete(v.n);
    const lives = this.mode.lives && this.phase === 'live' ? this.mode.lives : 0;
    this.bcast({ t: 'kill', k: k ? k.n : -1, v: v.n, ab, kk: k ? k.kills : 0, vd: v.deaths, rt, out: lives && v.deaths >= lives ? 1 : 0 });
    this.sendBoard();
    if (lives && !v.dummy && v.deaths >= lives) { this.respawnAt.delete(v.n); setTimeout(() => { if (this.m.app.match === this.m) this.end(); }, 1800); return; }
    if (this.phase === 'live' && this.killsToWin && k && k.kills >= this.killsToWin) this.end();
  }

  end() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const lives = this.mode.lives;
    // duels: whoever has lives left wins (the one who left the duel loses)
    const ranked = [...this.m.ents.values()].filter((e) => !e.dummy).sort((a, b) => (lives ? (+!!a.left - +!!b.left) || a.deaths - b.deaths : 0) || b.kills - a.kills || a.deaths - b.deaths || b.dmg - a.dmg);
    this.bcast({ t: 'end', l: ranked.map((e) => [e.n, e.kills, e.deaths, e.dmg]) });
  }

  sendBoard() {
    const l = [...this.m.ents.values()].filter((e) => !e.dummy).map((e) => [e.n, e.kills, e.deaths, e.dmg]);
    this.bcast({ t: 'board', l, tl: Math.max(0, this.phaseEnd - this.now), ph: this.phase });
  }

  broadcastStates() {
    const l = [];
    for (const e of this.m.ents.values()) {
      if (!e.alive || e.left) continue;
      if (e.isLocal) { const b = this.m.body; l.push([e.n, r3(b.pos.x), r3(b.pos.y), r3(b.pos.z), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z), r3(b.yaw), r3(b.pitch), b.grounded ? 1 : 0]); }
      else if (!e.dummy) l.push([e.n, r3(e.pos.x), r3(e.pos.y), r3(e.pos.z), r2(e.vel.x), r2(e.vel.y), r2(e.vel.z), r3(e.yaw), r3(e.pitch), e.grounded ? 1 : 0]);
    }
    this.m.net.broadcast({ t: 'S', l });
  }

  update(dt) {
    this.now += dt;
    const m = this.m;
    if (this.phase === 'warmup' && this.now >= this.phaseEnd) {
      this.phase = 'live';
      this.phaseEnd = this.timeLimit ? this.now + this.timeLimit : 0;
      this.bcast({ t: 'phase', p: 'live', tl: this.timeLimit || 0 });
    }
    if (this.phase === 'live' && this.timeLimit && this.now >= this.phaseEnd) this.end();
    // burning
    for (const [n, b] of this.burns) {
      const e = m.ents.get(n);
      if (!e || !e.alive || this.now > b.until) { this.burns.delete(n); continue; }
      b.acc += b.dps * dt;
      if (b.acc >= 1) { const d = Math.floor(b.acc); b.acc -= d; this.damage(e, d, m.ents.get(b.by), 'burn'); }
    }
    // regen + respawns
    this.hpT -= dt;
    const sendHp = this.hpT <= 0;
    if (sendHp) this.hpT = 0.25;
    for (const e of m.ents.values()) {
      if (!e.alive) {
        const at = this.respawnAt.get(e.n);
        if (at !== undefined && this.now >= at && this.phase !== 'ended' && !e.left) {
          if (e.dummy) { this.respawnAt.delete(e.n); this.bcast({ t: 'spawn', n: e.n, x: e.home.x, y: e.home.y, z: e.home.z, yaw: e.yaw }); }
          else this.spawn(e);
        }
        continue;
      }
      const last = this.lastDamage.get(e.n) || -99;
      const delay = e.dummy ? 2.5 : REGEN_DELAY;
      if (e.hp < BAL.hp && this.now - last > delay && !this.burns.has(e.n)) {
        e.hp = Math.min(BAL.hp, e.hp + (e.dummy ? 200 : REGEN_RATE) * dt);
        if (sendHp || e.hp >= BAL.hp) this.bcast({ t: 'hp', n: e.n, hp: Math.round(e.hp), by: -1 });
      }
    }
    this.boardT -= dt;
    if (this.boardT <= 0) { this.boardT = 1; this.sendBoard(); }
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
