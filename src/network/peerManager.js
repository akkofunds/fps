import Peer from 'peerjs';
import { Emitter } from '../core/emitter.js';
import { PEER_PREFIX } from '../config.js';

// PeerJS identity + social layer. Every player registers `<prefix><name>-<tag>` on the PeerJS
// broker, so typing a friend's Riot-style tag (Name#1234) is enough to reach them directly.
// Party = star around the leader. Matches use separate 'match' connections (see matchNet.js).

export function peerIdFor(name, tag) { return `${PEER_PREFIX}${String(name).toLowerCase()}-${tag}`; }

export function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = {
    debug: Number(new URLSearchParams(location.search).get('peerdebug') || 0),
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] },
  };
  // self-hosted broker: ?peerhost=example.com&peerport=443&peerpath=/myapp&peersecure=1
  if (q.get('peerhost')) {
    o.host = q.get('peerhost');
    o.port = Number(q.get('peerport') || 443);
    o.path = q.get('peerpath') || '/';
    o.secure = q.get('peersecure') ? q.get('peersecure') === '1' : o.port === 443;
  }
  return o;
}

export class PeerManager extends Emitter {
  constructor(identity) {
    super();
    this.identity = identity; // {name, tag}
    this.peer = null;
    this.status = 'offline';
    this.party = { leader: null, members: [], map: 'piazza', mode: 'duel' };
    this.leaderConn = null; // when member
    this.memberConns = new Map(); // when leader: id → conn
    this.pendingInvites = new Map(); // fromId → {conn, from}
    this.outgoing = new Map(); // targetId → conn
  }

  get id() { return peerIdFor(this.identity.name, this.identity.tag); }
  get me() { return { id: this.id, name: this.identity.name, tag: this.identity.tag }; }
  get isLeader() { return this.party.leader === this.id; }
  get inParty() { return this.party.members.length > 1; }

  start() {
    this._resetParty();
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.status = 'connecting'; this.emit('status', this.status);
    let peer;
    try { peer = new Peer(this.id, peerOptions()); } catch (e) { this.status = 'offline'; this.emit('status', this.status); return; }
    this.peer = peer;
    this._retries = 0;
    clearTimeout(this._offT);
    this._offT = setTimeout(() => { if (this.peer === peer && this.status !== 'online') { this.status = 'offline'; this.emit('status', this.status); } }, 9000);
    peer.on('open', () => { this._retries = 0; this.status = 'online'; this.emit('status', this.status); });
    peer.on('disconnected', () => {
      if (this.peer !== peer || peer.destroyed) return;
      if (this.status === 'online') { this.status = 'connecting'; this.emit('status', this.status); }
      const delay = Math.min(30000, 1500 * 2 ** (this._retries++));
      setTimeout(() => { if (this.peer === peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch { /* ignore */ } } }, delay);
    });
    peer.on('error', (err) => {
      const type = err && err.type;
      if (type === 'unavailable-id') { this.status = 'offline'; this.emit('idTaken'); return; }
      if (type === 'peer-unavailable') {
        const m = String(err.message || '').match(/peer\s+(\S+)/i);
        const target = m ? m[1] : null;
        this.emit('peerUnavailable', target);
        if (target && this.outgoing.has(target)) { this.outgoing.delete(target); this.emit('toast', 'Player is offline or tag not found.'); }
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed' || type === 'browser-incompatible') {
        this.status = 'offline'; this.emit('status', this.status);
      }
    });
    peer.on('connection', (conn) => this._incoming(conn));
  }

  _resetParty() {
    this.party = { leader: this.id, members: [this.me], map: this.party.map || 'piazza', mode: this.party.mode || 'duel' };
    this.emit('party', this.party);
  }

  _incoming(conn) {
    const kind = conn.metadata && conn.metadata.kind;
    if (kind === 'match') { this.emit('matchConn', conn); return; }
    if (kind !== 'party') { conn.close(); return; }
    conn.on('data', (msg) => this._partyMsg(conn, msg));
    conn.on('close', () => this._partyClosed(conn));
    conn.on('error', () => this._partyClosed(conn));
  }

  // ---- invites ----
  invite(name, tag) {
    if (!this.peer || this.status !== 'online') { this.emit('toast', 'Social is offline — PeerJS broker unreachable.'); return; }
    const target = peerIdFor(name, tag);
    if (target === this.id) { this.emit('toast', "You can't invite yourself."); return; }
    if (this.party.members.some((m) => m.id === target)) { this.emit('toast', `${name}#${tag} is already in your party.`); return; }
    const conn = this.peer.connect(target, { metadata: { kind: 'party' }, serialization: 'json', reliable: true });
    this.outgoing.set(target, conn);
    conn.on('open', () => conn.send({ t: 'invite', from: this.me, leader: this.party.leader }));
    conn.on('data', (msg) => this._partyMsg(conn, msg));
    conn.on('close', () => { this.outgoing.delete(target); this._partyClosed(conn); });
    conn.on('error', () => this.outgoing.delete(target));
    setTimeout(() => { if (this.outgoing.get(target) === conn && !conn.open) { this.outgoing.delete(target); try { conn.close(); } catch { /* ignore */ } } }, 12000);
    this.emit('toast', `Invite sent to ${name}#${tag}`);
  }

  acceptInvite(fromId) {
    const inv = this.pendingInvites.get(fromId);
    if (!inv) return;
    this.pendingInvites.delete(fromId);
    this.emit('invites', [...this.pendingInvites.values()]);
    this.leaveParty(true);
    if (inv.leader === fromId) {
      this.leaderConn = inv.conn;
      inv.conn.send({ t: 'accept', from: this.me });
    } else {
      try { inv.conn.send({ t: 'decline', silent: true }); inv.conn.close(); } catch { /* ignore */ }
      const conn = this.peer.connect(inv.leader, { metadata: { kind: 'party' }, serialization: 'json', reliable: true });
      this.leaderConn = conn;
      conn.on('open', () => conn.send({ t: 'join', from: this.me }));
      conn.on('data', (msg) => this._partyMsg(conn, msg));
      conn.on('close', () => this._partyClosed(conn));
    }
  }

  declineInvite(fromId) {
    const inv = this.pendingInvites.get(fromId);
    if (!inv) return;
    this.pendingInvites.delete(fromId);
    try { inv.conn.send({ t: 'decline', from: this.me }); setTimeout(() => inv.conn.close(), 300); } catch { /* ignore */ }
    this.emit('invites', [...this.pendingInvites.values()]);
  }

  leaveParty(silent = false) {
    if (this.leaderConn) { try { this.leaderConn.send({ t: 'leave' }); this.leaderConn.close(); } catch { /* ignore */ } this.leaderConn = null; }
    for (const c of this.memberConns.values()) { try { c.send({ t: 'disband' }); c.close(); } catch { /* ignore */ } }
    this.memberConns.clear();
    this._resetParty();
    if (!silent) this.emit('toast', 'You left the party.');
  }

  setMap(map) {
    if (this.isLeader) { this.party.map = map; this._broadcastRoster(); }
    else if (this.leaderConn) this.leaderConn.send({ t: 'map', map, by: this.identity.name });
  }
  setMode(mode) { if (this.isLeader) { this.party.mode = mode; this._broadcastRoster(); } }

  chat(text) {
    const msg = { t: 'chat', from: this.me, msg: String(text).slice(0, 120) };
    if (this.isLeader) { for (const c of this.memberConns.values()) c.send(msg); this.emit('partyChat', msg); }
    else if (this.leaderConn) { this.leaderConn.send(msg); }
    else this.emit('partyChat', msg);
  }

  // Leader → members: join match hosted at hostId
  sendGo(hostId, info) { for (const c of this.memberConns.values()) c.send({ t: 'go', host: hostId, info }); }
  sendQueueState(state) { for (const c of this.memberConns.values()) c.send({ t: 'queue', state }); }

  _broadcastRoster() {
    const msg = { t: 'roster', party: this.party };
    for (const c of this.memberConns.values()) c.send(msg);
    this.emit('party', this.party);
  }

  _partyMsg(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'invite': {
        const from = msg.from;
        if (!from || !from.id) return;
        this.pendingInvites.set(from.id, { conn, from, leader: msg.leader || from.id });
        this.emit('invites', [...this.pendingInvites.values()]);
        this.emit('invite', from);
        break;
      }
      case 'accept': case 'join': {
        if (!this.isLeader) { conn.send({ t: 'decline', reason: 'not-leader' }); return; }
        if (this.party.members.length >= 5) { conn.send({ t: 'decline', reason: 'full' }); return; }
        const from = msg.from;
        conn._member = from.id;
        this.outgoing.delete(from.id);
        this.memberConns.set(from.id, conn);
        this.party.members = this.party.members.filter((m) => m.id !== from.id).concat([from]);
        this.emit('toast', `${from.name}#${from.tag} joined the party`);
        this._broadcastRoster();
        break;
      }
      case 'decline':
        if (!msg.silent && msg.from) this.emit('toast', `${msg.from.name}#${msg.from.tag} declined.`);
        else if (msg.reason === 'full') this.emit('toast', 'Party is full.');
        break;
      case 'roster':
        if (conn === this.leaderConn) { this.party = msg.party; this.emit('party', this.party); }
        break;
      case 'map':
        if (this.isLeader && typeof msg.map === 'string') { this.party.map = msg.map; this._broadcastRoster(); this.emit('toast', `${msg.by || 'Party'} picked ${msg.map.toUpperCase()}`); }
        break;
      case 'chat':
        if (this.isLeader && conn._member) { for (const c of this.memberConns.values()) c.send(msg); }
        this.emit('partyChat', msg);
        break;
      case 'leave':
        this._partyClosed(conn);
        break;
      case 'disband':
        if (conn === this.leaderConn) { this.leaderConn = null; this._resetParty(); this.emit('toast', 'Party disbanded by leader.'); }
        break;
      case 'go':
        if (conn === this.leaderConn) this.emit('go', msg.host, msg.info);
        break;
      case 'queue':
        if (conn === this.leaderConn) this.emit('queueState', msg.state);
        break;
      default: break;
    }
  }

  _partyClosed(conn) {
    if (conn === this.leaderConn) {
      this.leaderConn = null; this._resetParty(); this.emit('toast', 'Disconnected from party.');
      return;
    }
    const id = conn._member;
    if (id && this.memberConns.get(id) === conn) {
      this.memberConns.delete(id);
      const m = this.party.members.find((x) => x.id === id);
      this.party.members = this.party.members.filter((x) => x.id !== id);
      if (m) this.emit('toast', `${m.name}#${m.tag} left the party`);
      this._broadcastRoster();
    }
    for (const [k, v] of this.pendingInvites) if (v.conn === conn) { this.pendingInvites.delete(k); this.emit('invites', [...this.pendingInvites.values()]); }
  }

  // ---- matchmaking helpers ----
  // Try to register a well-known queue-slot ID. Resolves a Peer (we host) or null (taken/offline).
  claimId(id, timeout = 6000) {
    return new Promise((resolve) => {
      let done = false;
      let p;
      try { p = new Peer(id, peerOptions()); } catch { resolve(null); return; }
      const fin = (v) => { if (done) return; done = true; if (!v) { try { p.destroy(); } catch { /* ignore */ } } resolve(v); };
      p.on('open', () => fin(p));
      p.on('error', () => fin(null));
      setTimeout(() => fin(null), timeout);
    });
  }

  connectMatch(hostId, hello, timeout = 6000) {
    return new Promise((resolve) => {
      if (!this.peer || this.status !== 'online') { resolve(null); return; }
      let done = false;
      const conn = this.peer.connect(hostId, { metadata: { kind: 'match' }, serialization: 'json', reliable: true });
      const fin = (v) => { if (done) return; done = true; off(); if (!v) { try { conn.close(); } catch { /* ignore */ } } resolve(v); };
      const offU = this.on('peerUnavailable', (t) => { if (t === hostId) fin(null); });
      const off = () => offU();
      conn.on('open', () => { conn.send(hello); });
      conn.once('data', (msg) => { if (msg && msg.t === 'welcome') fin({ conn, welcome: msg }); else fin(null); });
      conn.on('error', () => fin(null));
      conn.on('close', () => fin(null));
      setTimeout(() => fin(null), timeout);
    });
  }
}
