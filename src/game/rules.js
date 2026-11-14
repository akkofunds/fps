import { MODES, MAX_HP } from '../config.js';
import { BotBrain } from '../entities/bots.js';
import { WEAPONS } from '../weapons/weaponDefs.js';
import { dirFromAngles, traceShot } from '../weapons/weaponSystem.js';
import { RangePractice } from './rangePractice.js';

// HOST-ONLY authority: phases, rounds, HP, kills, respawns, bots, crates, range targets.
// Every state change is broadcast; the host applies the same messages locally.
export class Rules {
  constructor(match) {
    this.m = match;
    this.mode = MODES[match.cfg.mode] || MODES.duel;
    this.phase = 'warmup';
    this.phaseEnd = 0;
    this.round = 0;
    this.score = [0, 0];
    this.matchEnd = 0;
    this.brains = new Map();
    this.boardT = 0; this.phaseT = 0; this.snapT = 0;
    this._dir = [0, 0, 0];
    this.range = match.cfg.mode === 'range' ? new RangePractice(match, this) : null;
    for (const e of match.ents.values()) if (e.bot && !e.practice) this.brains.set(e.n, new BotBrain(match, e, 0.45 + Math.random() * 0.35));
  }

  isLive() { return this.phase === 'live'; }

  start(now) {
    if (this.range) { this.phase = 'live'; this.spawnAll(now); this.broadcastPhase(now); return; }
    if (this.mode.teams) this.newRound(now);
    else { this.phase = 'live'; this.phaseEnd = now + this.mode.timeLimit; this.spawnAll(now); this.broadcastPhase(now); }
  }

  newRound(now) {
    this.round++;
    this.phase = 'buy'; this.phaseEnd = now + 4;
    this.m.map.resetCrates && this.m.map.resetCrates();
    this.bcast({ t: 'resetCrates' });
    this.spawnAll(now);
    this.broadcastPhase(now);
  }

  spawnAll(now) {
    const used = { 0: 0, 1: 0 };
    for (const e of this.m.ents.values()) {
      if (e.practice) continue;
      let sp;
      if (this.mode.teams) { const list = this.m.map.spawns[e.team]; sp = list[(used[e.team]++ * 3 + (this.round % 2)) % list.length]; }
      else sp = this.pickFFASpawn(e);
      this.spawn(e, sp, now);
    }
  }

  pickFFASpawn(e) {
    const list = this.m.map.spawns.ffa;
    let best = list[0], bestD = -1;
    for (const s of list) {
      let md = 1e9;
      for (const o of this.m.ents.values()) { if (o === e || !o.alive || o.practice) continue; const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2; if (d < md) md = d; }
      md += Math.random() * 40;
      if (md > bestD) { bestD = md; best = s; }
    }
    return best;
  }

  spawn(e, sp, now) {
    const jx = (Math.random() - 0.5) * 0.6, jz = (Math.random() - 0.5) * 0.6;
    const msg = { t: 'spawn', n: e.n, x: sp.x + jx, y: sp.y + 0.05, z: sp.z + jz, yaw: sp.yaw || 0 };
    e.hp = MAX_HP; e.alive = true; e.respawnAt = 0;
    const brain = this.brains.get(e.n);
    if (brain) brain.spawn(msg.x, msg.y, msg.z, msg.yaw);
    this.bcast(msg);
  }

  bcast(msg, except = null) {
    this.m.net.broadcast(msg, except);
    if (except !== this.m.localId) this.m.onNet(msg, true);
  }

  broadcastPhase(now) {
    this.bcast({ t: 'phase', p: this.phase, tl: Math.max(0, this.phaseEnd - now), r: this.round, sc: this.score });
  }

  broadcastBoard() {
    const e = [];
    for (const x of this.m.ents.values()) if (!x.practice) e.push([x.n, x.kills, x.deaths, x.hsKills, x.dmg | 0]);
    this.bcast({ t: 'board', e });
  }

  // ---- damage ----
  applyHit(attN, vicN, dmg, zone, w) {
    const m = this.m;
    const a = m.byN[attN], v = m.byN[vicN];
    if (!a || !v || !v.alive) return;
    if (!a.alive && !a.practice) return;
    if (v.practice) { if (this.range) this.range.onHit(a, v, dmg, zone, w); return; }
    if (this.range) return; // humans can't hurt each other in the range
    if (this.phase !== 'live') return;
    if (this.mode.teams && a.team === v.team && a !== v) return;
    if (m.cfg.hsOnly && zone !== 'head') return;
    dmg = Math.max(0, Math.min(200, dmg));
    if (dmg <= 0) return;
    v.hp -= dmg; a.dmg += Math.min(dmg, v.hp + dmg);
    if (v.hp <= 0) {
      v.hp = 0; v.alive = false; v.deaths++;
      if (a !== v) { a.kills++; if (zone === 'head') a.hsKills++; }
      this.bcast({ t: 'kill', a: a.n, v: v.n, w, h: zone === 'head' ? 1 : 0 });
      if (!this.mode.teams) {
        v.respawnAt = performance.now() / 1000 + this.mode.respawn;
        if (a.kills >= this.mode.killsToWin) this.endMatch(a.n);
      }
      this.broadcastBoard();
    } else {
      this.bcast({ t: 'dmg', v: v.n, a: a.n, hp: v.hp, z: zone, w });
    }
  }

  damageCrate(i, dmg) {
    const c = this.m.map.crates && this.m.map.crates[i];
    if (!c || c.broken) return;
    c.hp -= dmg;
    if (c.hp <= 0) this.bcast({ t: 'crateBreak', i });
  }

  botShoot(e, yaw, pitch, eyeY) {
    const m = this.m;
    const w = WEAPONS[e.w];
    const d = dirFromAngles(yaw, pitch, this._dir);
    const ox = e.x, oy = eyeY, oz = e.z;
    let nrm = null;
    const self = this;
    const end = traceShot(m.map.world, (a, b, c, dx, dy, dz, maxT) => m.traceEnts(a, b, c, dx, dy, dz, maxT, e), ox, oy, oz, d[0], d[1], d[2], w, {
      hitEntity(ent, zone, mul) {
        const dmg = (zone === 'head' ? w.head : zone === 'leg' ? w.leg : w.body) * mul;
        self.applyHit(e.n, ent.n, dmg, zone, e.w);
      },
      impact(x, y, z, nx, ny, nz, mat, obj, ww, mul) {
        nrm = [nx, ny, nz];
        if (obj && obj.data && obj.data.index !== undefined && obj.data.hp !== undefined) self.damageCrate(obj.data.index, w.body * mul);
      },
    });
    const r = (v) => Math.round(v * 100) / 100;
    this.bcast({ t: 'shot', n: e.n, o: [r(ox - Math.sin(yaw) * 0.6), r(oy - 0.15), r(oz - Math.cos(yaw) * 0.6)], e: [r(end[0]), r(end[1]), r(end[2])], nrm, w: e.w });
  }

  // ---- messages from clients ----
  handle(n, msg) {
    const m = this.m, e = m.byN[n];
    if (!e) return;
    switch (msg.t) {
      case 'u': m.ingestState(e, msg, performance.now() / 1000); break;
      case 'hit': if (typeof msg.v === 'number') this.applyHit(n, msg.v, +msg.d || 0, msg.z, msg.w | 0); break;
      case 'shot': e.firedAt = performance.now() / 1000; this.bcast({ ...msg, n }, m.net.clients ? this.pidOf(n) : null); break;
      case 'crate': this.damageCrate(msg.i | 0, +msg.d || 0); break;
      case 'btn': if (this.range) this.range.press(msg.id, e); break;
      case 'chat': {
        const out = { t: 'chat', n, m: String(msg.m || '').slice(0, 120), tm: !!msg.tm };
        if (out.tm && this.mode.teams) {
          for (const x of m.ents.values()) if (x.team === e.team && !x.bot) { if (x.n === m.me.n) m.onNet(out, true); else m.net.send(x.pid, out); }
        } else this.bcast(out);
        break;
      }
      default: break;
    }
  }
  pidOf(n) { const e = this.m.byN[n]; return e ? e.pid : null; }

  playerLeft(n) {
    const e = this.m.byN[n];
    if (!e) return;
    this.bcast({ t: 'left', n });
  }

  endMatch(winner) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.broadcastBoard();
    this.bcast({ t: 'end', win: winner, sc: this.score });
  }

  // fixed-step simulation (bots)
  fixedUpdate(dt, now) {
    const frozen = this.phase === 'buy' || this.phase === 'end';
    for (const b of this.brains.values()) b.update(dt, now, frozen);
    if (this.range) this.range.fixedUpdate(dt, now);
  }

  update(dt, now) {
    const m = this.m;
    if (this.range) this.range.update(dt, now);
    // phase transitions
    if (this.mode.teams && !this.range) {
      if (this.phase === 'buy' && now >= this.phaseEnd) { this.phase = 'live'; this.phaseEnd = now + this.mode.roundTime; this.broadcastPhase(now); }
      else if (this.phase === 'live') {
        const alive = [0, 0], total = [0, 0];
        for (const e of m.ents.values()) { if (e.practice) continue; total[e.team]++; if (e.alive) alive[e.team]++; }
        let winner = -1;
        if (total[0] === 0 || total[1] === 0) { if (now >= this.phaseEnd) winner = total[0] ? 0 : 1; }
        else if (alive[0] === 0 && alive[1] === 0) winner = 1;
        else if (alive[0] === 0) winner = 1; else if (alive[1] === 0) winner = 0;
        else if (now >= this.phaseEnd) winner = alive[0] > alive[1] ? 0 : 1;
        if (winner >= 0) {
          this.score[winner]++;
          this.phase = 'post'; this.phaseEnd = now + 3.5;
          this.bcast({ t: 'roundEnd', win: winner, sc: this.score });
          this.broadcastPhase(now);
          if (this.score[winner] >= this.mode.roundsToWin) this.matchEnd = now + 3.0;
        }
      } else if (this.phase === 'post' && now >= this.phaseEnd) {
        if (this.matchEnd) this.endMatch(this.score[0] > this.score[1] ? 0 : 1);
        else this.newRound(now);
      }
    } else if (!this.range && this.phase === 'live') {
      for (const e of m.ents.values()) if (!e.alive && e.respawnAt && now >= e.respawnAt) this.spawn(e, this.pickFFASpawn(e), now);
      if (now >= this.phaseEnd) {
        let best = null; for (const e of m.ents.values()) if (!best || e.kills > best.kills) best = e;
        this.endMatch(best ? best.n : -1);
      }
    }
    this.phaseT -= dt;
    if (this.phaseT <= 0) { this.phaseT = 1; this.broadcastPhase(now); }
    this.boardT -= dt;
    if (this.boardT <= 0) { this.boardT = 3; this.broadcastBoard(); }
  }
}
