import { Emitter } from '../core/emitter.js';
import { HostSession, ClientSession } from '../network/matchNet.js';
import { MODES, QUEUE_START_SECONDS, PEER_PREFIX } from '../config.js';
import { loadBalance } from './balance.js';

// Serverless matchmaking over the PeerJS broker. FFA has a few well-known queue-slot IDs:
// a searching player first tries to JOIN a slot; if nobody holds it they CLAIM it and host.
// Real players only — the match starts when the lobby is full, or after QUEUE_START_SECONDS
// once at least two players are in. Customs: the party leader hosts the whole party.
const SLOTS = 4;
const mmId = (mode, slot) => `${PEER_PREFIX}mm-${mode}-${slot}`;

export class SessionController extends Emitter {
  constructor(app) {
    super();
    this.app = app; this.pm = app.pm;
    this.state = 'idle'; // idle | searching | hostQueue | clientQueue | customWait | joining | match
    this.host = null; this.client = null; this.mmPeer = null;
    this.queueStart = 0; this.mode = null; this.cfg = null;
    this.humans = [];
    this.token = 0;
    this.pm.on('matchConn', (conn) => { if (this.host && !this.host.closed) this.host.attach(conn); else { try { conn.close(); } catch { /* ignore */ } } });
    this.pm.on('go', (hostId, info) => this.joinHost(hostId, info));
    this._tick = setInterval(() => this._update(), 250);
  }

  get busy() { return this.state !== 'idle'; }
  hello() { const me = this.pm.me; return { t: 'hello', id: me.id, name: me.name, tag: me.tag, mage: me.mage }; }

  // ---------------- matchmaking (FFA quickplay / Duel)
  async startQueue(modeId = 'ffa', retry = false) {
    if (this.busy) return;
    const pm = this.pm;
    const mode = modeId === 'duel' ? 'duel' : 'ffa', M = MODES[mode];
    if (!retry) this._skip = new Set(); // queue slots that turned us away (full)
    if (pm.inParty && !pm.isLeader) { this.emit('toast', 'Only the party leader can start the queue.'); return; }
    if (pm.party.members.length > M.size) { this.emit('toast', 'Party too large.'); return; }
    if (pm.status !== 'online') { this.emit('toast', 'Matchmaking is offline — the PeerJS broker is unreachable. Try Practice.'); return; }
    const token = ++this.token;
    this.mode = mode; this.queueStart = performance.now(); this.state = 'searching';
    this.cfg = { mode, map: 'sunvale', killsToWin: M.killsToWin, timeLimit: M.timeLimit };
    this.emit('queue', { searching: true, start: this.queueStart, found: pm.party.members.length, size: M.size });
    if (pm.inParty) {
      for (let s = 0; s < SLOTS && token === this.token; s++) {
        const peer = await pm.claimId(mmId(mode, s), 4000);
        if (token !== this.token) { if (peer) peer.destroy(); return; }
        if (peer) { this._hostQueue(peer, token); return; }
      }
      if (token === this.token) this._hostQueue(null, token);
      return;
    }
    for (let s = 0; s < SLOTS; s++) {
      if (token !== this.token) return;
      if (this._skip.has(s)) continue;
      this._slot = s;
      const id = mmId(mode, s);
      const res = await pm.connectMatch(id, { ...this.hello(), mode, q: true }, 3500);
      if (token !== this.token) { if (res) res.conn.close(); return; }
      if (res) { this._clientQueue(res.conn, token); return; }
      const peer = await pm.claimId(id, 4000);
      if (token !== this.token) { if (peer) peer.destroy(); return; }
      if (peer) { this._hostQueue(peer, token); return; }
    }
    if (token === this.token) this._hostQueue(null, token);
  }

  _hostQueue(mmPeer, token) {
    const pm = this.pm, M = MODES[this.mode];
    this.state = 'hostQueue';
    this.mmPeer = mmPeer;
    const host = this.host = new HostSession();
    const me = pm.me;
    const partyIds = new Set(pm.party.members.map((m) => m.id));
    this.humans = [{ id: me.id, name: me.name, tag: me.tag, mage: me.mage, n: 0 }];
    this.nextN = 1; this.pendingJoins = [];
    if (mmPeer) mmPeer.on('connection', (conn) => { if (conn.metadata && conn.metadata.kind === 'match') host.attach(conn); else conn.close(); });
    host.on('hello', (conn, msg) => {
      if (this.state !== 'hostQueue' || token !== this.token) { host.reject(conn, 'closed'); return; }
      const isParty = partyIds.has(msg.id);
      if (!isParty && msg.mode !== this.mode) { host.reject(conn, 'mode'); return; }
      if (this.humans.length >= M.size || this.humans.some((h) => h.id === msg.id)) { host.reject(conn, 'full'); return; }
      host.accept(conn, msg.id, { mode: this.mode });
      const h = { id: msg.id, name: String(msg.name).slice(0, 14), tag: String(msg.tag).slice(0, 4), mage: String(msg.mage || 'pyro').slice(0, 16), n: this.nextN++ };
      this.humans.push(h);
      // drop them straight into the lobby match
      this.host.send(h.id, { t: 'start', cfg: { ...this.cfg, queue: true }, players: this.humans.map((x) => ({ ...x })), you: h.id });
      const m = this.app.match;
      if (m && m.isHost && m.cfg.queue && m.rules) m.hostAddPlayer({ ...h }); else this.pendingJoins.push(h);
      if (!isParty && !M.quickplay) this.emit('playerFound');
      this._broadcastQueue();
    });
    host.on('leave', (pid) => { this.humans = this.humans.filter((h) => h.id !== pid); if (this.state === 'hostQueue') this._broadcastQueue(); });
    if (pm.inParty) pm.sendGo(me.id, { queue: this.mode });
    this._broadcastQueue();
    // the queue host plays in the lobby match right away
    this.emit('start', { cfg: { ...this.cfg, queue: true }, net: host, isHost: true, localId: me.id, players: this.humans.map((x) => ({ ...x })) });
  }

  // called by the app once a match object is running
  matchReady(m) {
    if (!this.pendingJoins || !m.isHost || !m.cfg.queue) return;
    for (const h of this.pendingJoins.splice(0)) if (this.humans.some((x) => x.id === h.id)) m.hostAddPlayer({ ...h });
  }

  // lobby filled: start the real match in place
  _goLive() {
    this.state = 'match';
    this._readyAt = 0;
    if (this.mmPeer) { try { this.mmPeer.disconnect(); } catch { /* ignore */ } }
    const m = this.app.match;
    if (m && m.rules) m.rules.goLive();
    this.emit('queue', { searching: false });
  }

  _broadcastQueue() {
    const M = MODES[this.mode];
    if (M.quickplay) { this.emit('queue', { searching: false }); return; } // quickplay: you're already in the match
    const st = { t: 'qstate', found: this.humans.length, size: M.size, names: this.humans.map((h) => `${h.name}#${h.tag}`) };
    if (this.host) this.host.broadcast(st);
    this.emit('queue', { searching: true, start: this.queueStart, found: st.found, size: st.size, names: st.names });
  }

  _clientQueue(conn, token) {
    this.state = 'clientQueue';
    const cs = this.client = new ClientSession(conn);
    const off = cs.on('msg', (msg) => {
      if (token !== this.token) return;
      if (msg.t === 'qstate') { if (!MODES[this.mode].quickplay) this.emit('queue', { searching: true, start: this.queueStart, found: msg.found, size: msg.size, names: msg.names }); }
      else if (msg.t === 'start') {
        if (msg.cfg && msg.cfg.queue) {
          this.emit('start', { cfg: msg.cfg, net: cs, isHost: false, localId: msg.you, players: msg.players });
          if (MODES[msg.cfg.mode] && MODES[msg.cfg.mode].quickplay) this.emit('queue', { searching: false });
          return;
        }
        off(); offC(); this._beginClient(cs, msg);
      } else if (msg.t === 'qlive') { off(); offC(); this.state = 'match'; this.emit('queue', { searching: false }); }
      else if (this.app.match && (msg.t === 'hostLeft')) { off(); offC(); /* the running lobby match handles it */ }
      else if (msg.t === 'reject' || msg.t === 'hostLeft') {
        off(); offC(); cs.close(); this.client = null; this.state = 'idle';
        const full = msg.t === 'reject' && msg.reason === 'full';
        if (full) this._skip.add(this._slot); else this.emit('toast', 'Match host left — searching again');
        this.emit('queue', { searching: false });
        setTimeout(() => this.startQueue(this.mode, full), 300);
      }
    });
    const offC = cs.on('close', () => {
      if (token !== this.token || this.state !== 'clientQueue' || this.app.match) return;
      off(); offC(); this.client = null; this.state = 'idle';
      this.emit('queue', { searching: false }); this.emit('toast', 'Lost connection to the match host.');
    });
  }

  // ---------------- party member: follow the leader into a hosted match
  async joinHost(hostId, info) {
    if (this.state === 'match') return;
    this.cancel(true);
    const token = ++this.token;
    this.state = 'joining';
    this.queueStart = performance.now();
    if (info && info.queue) { this.mode = info.queue; this.emit('queue', { searching: true, start: this.queueStart, found: 1, size: MODES[info.queue].size, follower: true }); }
    else this.emit('joining', true);
    const res = await this.pm.connectMatch(hostId, { ...this.hello(), party: true }, 8000);
    if (token !== this.token) { if (res) res.conn.close(); return; }
    if (!res) { this.state = 'idle'; this.emit('joining', false); this.emit('queue', { searching: false }); this.emit('toast', 'Could not reach the party leader.'); return; }
    this._clientQueue(res.conn, token);
  }

  // ---------------- custom game (leader hosts the party)
  startCustom(opts) {
    if (this.busy) return;
    const pm = this.pm;
    if (pm.inParty && !pm.isLeader) { this.emit('toast', 'Only the party leader can start a custom game.'); return; }
    const token = ++this.token;
    this.mode = 'custom';
    this.cfg = { mode: 'custom', map: 'sunvale', killsToWin: opts.killsToWin, timeLimit: opts.timeLimit, balance: loadBalance() };
    const me = pm.me;
    this.humans = [{ id: me.id, name: me.name, tag: me.tag, mage: me.mage }];
    this.host = new HostSession();
    if (!pm.inParty || pm.status !== 'online') { this._beginHost(); return; }
    this.state = 'customWait';
    const expected = new Set(pm.party.members.map((m) => m.id).filter((id) => id !== me.id));
    this.host.on('hello', (conn, msg) => {
      if (this.state !== 'customWait' || !expected.has(msg.id)) { this.host.reject(conn, 'closed'); return; }
      this.host.accept(conn, msg.id, { mode: 'custom' });
      this.humans.push({ id: msg.id, name: msg.name, tag: msg.tag, mage: String(msg.mage || 'pyro').slice(0, 16) });
      expected.delete(msg.id);
      if (!expected.size) this._beginHost();
    });
    this.emit('joining', true);
    pm.sendGo(me.id, { custom: true });
    setTimeout(() => { if (token === this.token && this.state === 'customWait') this._beginHost(); }, 7000);
  }

  startPractice() {
    if (this.busy) return;
    this.mode = 'practice';
    this.cfg = { mode: 'practice', map: 'sunvale', killsToWin: 0, timeLimit: 0, balance: loadBalance() };
    const me = this.pm.me;
    this.humans = [{ id: me.id, name: me.name, tag: me.tag, mage: me.mage }];
    this.host = new HostSession();
    this._beginHost();
  }

  _beginHost() {
    const cfg = this.cfg;
    if (!this.host) this.host = new HostSession();
    if (this.mmPeer) { try { this.mmPeer.disconnect(); } catch { /* ignore */ } }
    const players = this.humans.map((h, i) => ({ id: h.id, name: h.name, tag: h.tag, mage: h.mage || 'pyro', n: i }));
    for (const p of players) if (p.id !== this.pm.id) this.host.send(p.id, { t: 'start', cfg, players, you: p.id });
    this.state = 'match';
    this.emit('joining', false);
    this.emit('queue', { searching: false });
    this.emit('start', { cfg, net: this.host, isHost: true, localId: this.pm.id, players });
  }

  _beginClient(cs, msg) {
    this.state = 'match';
    this.emit('joining', false);
    this.emit('queue', { searching: false });
    this.emit('start', { cfg: msg.cfg, net: cs, isHost: false, localId: msg.you, players: msg.players });
  }

  _update() {
    if (this.state !== 'hostQueue') return;
    const M = MODES[this.mode];
    const el = (performance.now() - this.queueStart) / 1000;
    const n = this.humans.length;
    const m = this.app.match;
    if (!m || !m.rules || !m.cfg.queue) return; // lobby match still loading
    if (M.quickplay) return; // quickplay never 'goes live': it is always on, players drop in and out
    if (n >= M.size) { this.emit('found'); this._goLive(); return; }
    if (M.size <= 2) return; // duels wait for the opponent
    if (n >= M.minPlayers) {
      if (!this._readyAt) { this._readyAt = performance.now(); }
      const wait = (performance.now() - this._readyAt) / 1000;
      if (wait >= QUEUE_START_SECONDS * 0.5 && el >= QUEUE_START_SECONDS) { this._readyAt = 0; this.emit('found'); this._goLive(); }
    } else this._readyAt = 0;
  }

  cancel(silent = false) {
    this.token++;
    if (this.state === 'match') return;
    if (this.client) { this.client.close(); this.client = null; }
    if (this.host) { this.host.close(); this.host = null; }
    if (this.mmPeer) { try { this.mmPeer.destroy(); } catch { /* ignore */ } this.mmPeer = null; }
    this.state = 'idle';
    this._readyAt = 0;
    if (!silent) { this.emit('queue', { searching: false }); this.emit('joining', false); }
  }

  endMatch() {
    if (this.host) { this.host.close(); this.host = null; }
    if (this.client) { this.client.close(); this.client = null; }
    if (this.mmPeer) { try { this.mmPeer.destroy(); } catch { /* ignore */ } this.mmPeer = null; }
    this.state = 'idle';
  }
}
