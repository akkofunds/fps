import { Emitter } from '../core/emitter.js';
import { HostSession, ClientSession } from '../network/matchNet.js';
import { MODES, QUEUE_FILL_SECONDS, PEER_PREFIX } from '../config.js';

// Serverless matchmaking: each mode has a few well-known queue-slot IDs on the PeerJS broker.
// A searching player first tries to JOIN a slot; if nobody holds it they CLAIM it and become
// the match host. The host waits for players and fills empty seats with bots after 15 s.
const SLOTS = 4;
const BOT_NAMES = ['Kestrel', 'Onyx', 'Ember', 'Drift', 'Halcyon', 'Quill', 'Rook', 'Sable', 'Vesper', 'Tundra'];
const mmId = (mode, slot) => `${PEER_PREFIX}mm-${mode}-${slot}`;

export function assignTeams(mode, humans, botFill) {
  const M = MODES[mode];
  const players = [];
  if (mode === 'range') {
    humans.forEach((h) => players.push({ ...h, team: 0 }));
    for (let i = 0; i < 8; i++) players.push({ id: `target-${i}`, name: `Target ${i + 1}`, tag: '', team: 9, bot: true, practice: true });
  } else if (!M.teams) {
    humans.forEach((h, i) => players.push({ ...h, team: i }));
    if (botFill) for (let i = humans.length; i < M.size; i++) players.push({ id: `bot-${i}`, name: `Bot ${BOT_NAMES[i % BOT_NAMES.length]}`, tag: '', team: i, bot: true });
  } else {
    const teams = [[], []];
    const groups = new Map();
    for (const h of humans) { const k = h.group || h.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
    for (const g of sorted) {
      let t = teams[0].length <= teams[1].length ? 0 : 1;
      if (teams[t].length + g.length > M.perTeam) t = 1 - t;
      for (const h of g) { const tt = teams[t].length < M.perTeam ? t : 1 - t; teams[tt].push(h); }
    }
    teams.forEach((list, t) => list.forEach((h) => players.push({ ...h, team: t })));
    if (botFill) {
      let b = 0;
      for (let t = 0; t < 2; t++) for (let i = teams[t].length; i < M.perTeam; i++) players.push({ id: `bot-${b}`, name: `Bot ${BOT_NAMES[b++ % BOT_NAMES.length]}`, tag: '', team: t, bot: true });
    }
  }
  players.forEach((p, i) => { p.n = i; delete p.group; });
  return players;
}

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
  hello() { const me = this.pm.me; return { t: 'hello', id: me.id, name: me.name, tag: me.tag }; }

  // ---------------- PLAY (matchmaking) ----------------
  async startQueue(mode) {
    if (this.busy) return;
    const pm = this.pm;
    if (pm.inParty && !pm.isLeader) { this.emit('toast', 'Only the party leader can start the queue.'); return; }
    const M = MODES[mode];
    const partySize = pm.party.members.length;
    if (M.teams ? partySize > M.perTeam : partySize > M.size) { this.emit('toast', `Party too large for ${M.label}.`); return; }
    const token = ++this.token;
    this.mode = mode; this.queueStart = performance.now(); this.state = 'searching';
    this.cfg = { mode, map: pm.party.map === 'range' ? 'piazza' : pm.party.map, bhop: false, hsOnly: false, botFill: true };
    this.emit('queue', { searching: true, mode, start: this.queueStart, found: 1, size: M.size });

    if (pm.status !== 'online') { this._hostQueue(null, token); return; }
    if (pm.inParty) {
      // parties always host so they can pull their members in
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
      const id = mmId(mode, s);
      const res = await pm.connectMatch(id, { ...this.hello(), mode, q: true }, 3500);
      if (token !== this.token) { if (res) res.conn.close(); return; }
      if (res) { this._clientQueue(res.conn, res.welcome, token); return; }
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
    this.humans = [{ id: me.id, name: me.name, tag: me.tag, group: 'host' }];
    if (mmPeer) mmPeer.on('connection', (conn) => { if (conn.metadata && conn.metadata.kind === 'match') host.attach(conn); else conn.close(); });
    host.on('hello', (conn, msg) => {
      if (this.state !== 'hostQueue' || token !== this.token) { host.reject(conn, 'closed'); return; }
      const isParty = partyIds.has(msg.id);
      if (!isParty && msg.mode !== this.mode) { host.reject(conn, 'mode'); return; }
      if (this.humans.length >= M.size || this.humans.some((h) => h.id === msg.id)) { host.reject(conn, 'full'); return; }
      if (M.teams && !isParty) {
        const strangers = this.humans.filter((h) => h.group !== 'host').length;
        const partyN = this.humans.filter((h) => h.group === 'host').length;
        if (strangers + partyN >= M.size) { host.reject(conn, 'full'); return; }
      }
      host.accept(conn, msg.id, { mode: this.mode });
      this.humans.push({ id: msg.id, name: String(msg.name).slice(0, 14), tag: String(msg.tag).slice(0, 4), group: isParty ? 'host' : msg.id });
      if (!isParty) Audio_found(this);
      this._broadcastQueue();
    });
    host.on('leave', (pid) => { if (this.state === 'hostQueue') { this.humans = this.humans.filter((h) => h.id !== pid); this._broadcastQueue(); } });
    if (pm.inParty) pm.sendGo(me.id, { queue: this.mode, start: Date.now() });
    this._broadcastQueue();
  }

  _broadcastQueue() {
    const M = MODES[this.mode];
    const st = { t: 'qstate', found: this.humans.length, size: M.size, names: this.humans.map((h) => `${h.name}#${h.tag}`) };
    if (this.host) this.host.broadcast(st);
    this.emit('queue', { searching: true, mode: this.mode, start: this.queueStart, found: st.found, size: st.size });
  }

  _clientQueue(conn, welcome, token) {
    this.state = 'clientQueue';
    const cs = this.client = new ClientSession(conn);
    const off = cs.on('msg', (msg) => {
      if (token !== this.token) return;
      if (msg.t === 'qstate') this.emit('queue', { searching: true, mode: this.mode, start: this.queueStart, found: msg.found, size: msg.size });
      else if (msg.t === 'start') { off(); offC(); this._beginClient(cs, msg); }
      else if (msg.t === 'reject' || msg.t === 'hostLeft') { off(); offC(); cs.close(); this.client = null; this.state = 'idle'; this.emit('toast', 'Match host left — searching again'); this.emit('queue', { searching: false }); setTimeout(() => this.startQueue(this.mode), 300); }
    });
    const offC = cs.on('close', () => {
      if (token !== this.token || this.state !== 'clientQueue') return;
      off(); offC(); this.client = null; this.state = 'idle';
      this.emit('queue', { searching: false }); this.emit('toast', 'Lost connection to match host.');
    });
  }

  // ---------------- party member: follow leader into a hosted match ----------------
  async joinHost(hostId, info) {
    if (this.state === 'match') return;
    this.cancel(true);
    const token = ++this.token;
    this.state = 'joining';
    this.queueStart = performance.now();
    if (info && info.queue) { this.mode = info.queue; this.emit('queue', { searching: true, mode: info.queue, start: this.queueStart, found: 1, size: MODES[info.queue].size, follower: true }); }
    else this.emit('joining', true);
    const res = await this.pm.connectMatch(hostId, { ...this.hello(), party: true }, 8000);
    if (token !== this.token) { if (res) res.conn.close(); return; }
    if (!res) { this.state = 'idle'; this.emit('joining', false); this.emit('queue', { searching: false }); this.emit('toast', 'Could not reach the party leader.'); return; }
    this._clientQueue(res.conn, res.welcome, token);
  }

  // ---------------- CUSTOM GAME (leader hosts) ----------------
  startCustom(cfg) {
    if (this.busy) return;
    const pm = this.pm;
    if (pm.inParty && !pm.isLeader) { this.emit('toast', 'Only the party leader can start a custom game.'); return; }
    const token = ++this.token;
    this.cfg = { ...cfg };
    this.mode = cfg.mode;
    const me = pm.me;
    this.humans = [{ id: me.id, name: me.name, tag: me.tag, group: 'host' }];
    if (!pm.inParty || pm.status !== 'online') { this._beginHost(); return; }
    this.state = 'customWait';
    const host = this.host = new HostSession();
    const expected = new Set(pm.party.members.map((m) => m.id).filter((id) => id !== me.id));
    host.on('hello', (conn, msg) => {
      if (this.state !== 'customWait' || !expected.has(msg.id)) { host.reject(conn, 'closed'); return; }
      host.accept(conn, msg.id, { mode: cfg.mode });
      this.humans.push({ id: msg.id, name: msg.name, tag: msg.tag, group: 'host' });
      expected.delete(msg.id);
      if (!expected.size) this._beginHost();
    });
    this.emit('joining', true);
    pm.sendGo(me.id, { custom: true });
    setTimeout(() => { if (token === this.token && this.state === 'customWait') this._beginHost(); }, 7000);
  }

  startRangeSolo() {
    if (this.busy) return;
    this.cfg = { mode: 'range', map: 'range', bhop: false, hsOnly: false, botFill: false };
    this.mode = 'range';
    const me = this.pm.me;
    this.humans = [{ id: me.id, name: me.name, tag: me.tag, group: 'host' }];
    this._beginHost();
  }

  _beginHost() {
    const cfg = this.cfg;
    if (!this.host) this.host = new HostSession();
    if (this.mmPeer) { try { this.mmPeer.disconnect(); } catch { /* ignore */ } } // free the queue slot; connections stay up
    const players = assignTeams(cfg.mode, this.humans, cfg.botFill !== false);
    for (const p of players) if (!p.bot) this.host.send(p.id, { t: 'start', cfg, players, you: p.id });
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
    const offline = !this.mmPeer;
    if (this.humans.length >= M.size) { if (!this._fullAt) this._fullAt = performance.now(); if (performance.now() - this._fullAt > 1200) { this._fullAt = 0; this.emit('found'); this._beginHost(); } return; }
    if (el >= QUEUE_FILL_SECONDS || (offline && this.pm.status !== 'online' && el >= 3)) { this.emit('found'); this._beginHost(); }
    if (this.pm.inParty && this.pm.isLeader) this.pm.sendQueueState({ el });
  }

  cancel(silent = false) {
    this.token++;
    if (this.state === 'match') return;
    if (this.client) { this.client.close(); this.client = null; }
    if (this.host) { this.host.close(); this.host = null; }
    if (this.mmPeer) { try { this.mmPeer.destroy(); } catch { /* ignore */ } this.mmPeer = null; }
    this.state = 'idle';
    if (!silent) { this.emit('queue', { searching: false }); this.emit('joining', false); }
  }

  // called after a match ends
  endMatch() {
    if (this.host) { this.host.close(); this.host = null; }
    if (this.client) { this.client.close(); this.client = null; }
    if (this.mmPeer) { try { this.mmPeer.destroy(); } catch { /* ignore */ } this.mmPeer = null; }
    this.state = 'idle';
  }
}

function Audio_found(self) { self.emit('playerFound'); }
