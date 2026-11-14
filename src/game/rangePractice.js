import { MAX_HP } from '../config.js';

// The Range training logic (host side): STATIC / STRAFE target drills and the
// 50-BOT SPEED TEST (one target at a time, timer + headshot % + accuracy).
export class RangePractice {
  constructor(match, rules) {
    this.m = match; this.r = rules;
    this.mode = 'static';
    this.running = false;
    this.kills = 0; this.hs = 0; this.hits = 0; this.total = 50;
    this.startT = 0; this.endT = 0; this.lastResult = null;
    this.bots = [...match.ents.values()].filter((e) => e.practice);
    for (const b of this.bots) { b.alive = false; b.respawnAt = 0; b.st = { dir: 1, flip: 0, baseX: 0, speed: 0 }; }
    this.sendT = 0;
    this.idleSpawned = false;
  }

  press(id, who) {
    const now = performance.now() / 1000;
    if (id === 'start') { if (this.running) this.stop(now, false); else this.begin(now); }
    else if (id === 'static' || id === 'strafe' || id === 'speed') { if (this.running) this.stop(now, false); this.mode = id; this.idle(now); }
    this.r.bcast({ t: 'rangeBtn', id, by: who ? who.name : '' });
    this.broadcast(now);
  }

  clearBots() {
    for (const b of this.bots) { b.alive = false; b.respawnAt = 0; }
    this.r.bcast({ t: 'hideAll' });
  }

  idle(now) {
    this.clearBots();
    const spots = this.m.map.targetSpots;
    // a few warm-up targets at 10/20/30m
    [3, 12, 20].forEach((si, k) => this.place(this.bots[k], spots[si], now, this.mode === 'strafe'));
  }

  begin(now) {
    this.clearBots();
    this.running = true; this.kills = 0; this.hs = 0; this.hits = 0; this.startT = now; this.endT = 0;
    if (this.mode === 'speed') this.place(this.bots[0], this.randomSpot(), now, false);
    else for (let i = 0; i < 6; i++) this.place(this.bots[i], this.randomSpot(), now, this.mode === 'strafe');
  }

  stop(now, finished) {
    this.running = false; this.endT = now;
    if (finished) {
      const time = now - this.startT;
      this.lastResult = { time, hs: this.kills ? this.hs / this.kills : 0 };
      this.r.bcast({ t: 'rangeDone', time, hs: this.lastResult.hs, kills: this.kills });
    }
    this.idle(now);
  }

  randomSpot() { const s = this.m.map.targetSpots; return s[Math.floor(Math.random() * s.length)]; }

  place(b, spot, now, strafe) {
    if (!b) return;
    b.st.baseX = spot.x; b.st.dir = Math.random() < 0.5 ? -1 : 1; b.st.flip = now + 0.3 + Math.random() * 0.7;
    b.st.speed = strafe ? 4.2 + Math.random() * 1.6 : 0;
    b.st.strafe = strafe;
    b.yaw = 0; // targets face the shooter (+z)… yaw 0 looks -z, so face +z with PI
    b.yaw = Math.PI;
    this.r.spawn(b, { x: spot.x, y: spot.y, z: spot.z, yaw: Math.PI }, now);
    b.hp = MAX_HP;
  }

  onHit(a, v, dmg, zone, w) {
    const now = performance.now() / 1000;
    this.hits++;
    v.hp -= dmg;
    if (v.hp > 0) { this.r.bcast({ t: 'dmg', v: v.n, a: a.n, hp: v.hp, z: zone, w }); return; }
    v.hp = 0; v.alive = false;
    a.kills++; if (zone === 'head') a.hsKills++;
    this.r.bcast({ t: 'kill', a: a.n, v: v.n, w, h: zone === 'head' ? 1 : 0 });
    if (this.running) {
      this.kills++; if (zone === 'head') this.hs++;
      if (this.mode === 'speed') {
        if (this.kills >= this.total) { this.stop(now, true); return; }
        v.respawnAt = now + 0.05; v.nextSpot = this.randomSpot();
      } else { v.respawnAt = now + 0.6; v.nextSpot = this.randomSpot(); }
    } else { v.respawnAt = now + 1.0; v.nextSpot = null; }
    this.broadcast(now);
  }

  fixedUpdate(dt, now) {
    for (const b of this.bots) {
      if (!b.alive || !b.st.strafe) continue;
      const st = b.st;
      if (now >= st.flip) { st.dir = -st.dir; st.flip = now + 0.25 + Math.random() * 0.8; }
      b.x += st.dir * st.speed * dt;
      if (b.x < st.baseX - 2.6) { b.x = st.baseX - 2.6; st.dir = 1; }
      if (b.x > st.baseX + 2.6) { b.x = st.baseX + 2.6; st.dir = -1; }
      b.vx = st.dir * st.speed; b.vz = 0;
      b.x = Math.max(-13.5, Math.min(13.5, b.x));
    }
  }

  update(dt, now) {
    for (const b of this.bots) {
      if (!b.alive && b.respawnAt && now >= b.respawnAt) {
        b.respawnAt = 0;
        const spot = b.nextSpot || { x: b.x, y: b.y, z: b.z };
        this.place(b, spot, now, this.running ? this.mode === 'strafe' : this.mode === 'strafe');
      }
    }
    if (!this.idleSpawned) { this.idleSpawned = true; this.idle(now); }
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 0.25; this.broadcast(now); }
  }

  broadcast(now) {
    this.r.bcast({
      t: 'range', mode: this.mode, run: this.running, k: this.kills, hs: this.hs, tot: this.total,
      time: this.running ? now - this.startT : (this.lastResult ? this.lastResult.time : 0),
    });
  }
}
