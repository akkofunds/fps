import { Emitter } from '../core/emitter.js';

// Star topology: the match host owns game rules, HP, bots and scoring and relays state.
// Clients own their own movement (smooth, no input lag) and do shooter-side hit detection
// that the host validates. All traffic is small JSON over WebRTC data channels.

export class HostSession extends Emitter {
  constructor() {
    super();
    this.clients = new Map(); // playerId → conn
    this.pending = new Set();
    this.closed = false;
  }

  attach(conn) {
    if (this.closed) { try { conn.close(); } catch { /* ignore */ } return; }
    this.pending.add(conn);
    const onData = (msg) => {
      if (conn._pid) { this.emit('msg', conn._pid, msg); return; }
      if (msg && msg.t === 'hello') this.emit('hello', conn, msg);
    };
    conn.on('data', onData);
    const onClose = () => {
      this.pending.delete(conn);
      if (conn._pid && this.clients.get(conn._pid) === conn) { this.clients.delete(conn._pid); this.emit('leave', conn._pid); }
    };
    conn.on('close', onClose);
    conn.on('error', onClose);
    // ICE dropped without a close event: watch the underlying RTCPeerConnection
    const pc = conn.peerConnection;
    if (pc) pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') onClose(); });
  }

  accept(conn, pid, extra = {}) {
    this.pending.delete(conn);
    conn._pid = pid;
    this.clients.set(pid, conn);
    this._send(conn, { t: 'welcome', id: pid, ...extra });
  }

  reject(conn, reason) {
    this.pending.delete(conn);
    this._send(conn, { t: 'reject', reason });
    setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 400);
  }

  _send(conn, msg) { try { if (conn.open) conn.send(msg); } catch { /* ignore */ } }
  send(pid, msg) { const c = this.clients.get(pid); if (c) this._send(c, msg); }
  broadcast(msg, except = null) { for (const [pid, c] of this.clients) if (pid !== except) this._send(c, msg); }
  get count() { return this.clients.size; }

  close() {
    this.closed = true;
    for (const c of this.clients.values()) { this._send(c, { t: 'hostLeft' }); setTimeout(() => { try { c.close(); } catch { /* ignore */ } }, 200); }
    for (const c of this.pending) { try { c.close(); } catch { /* ignore */ } }
    this.clients.clear(); this.pending.clear();
  }
}

export class ClientSession extends Emitter {
  constructor(conn) {
    super();
    this.conn = conn;
    this.closed = false;
    conn.on('data', (msg) => this.emit('msg', msg));
    const onClose = () => { if (this.closed) return; this.closed = true; this.emit('close'); };
    conn.on('close', () => onClose('close'));
    conn.on('error', (e) => onClose(e));
    const pc = conn.peerConnection;
    if (pc) pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed') onClose('ice'); });
  }
  send(msg) { try { if (this.conn.open) this.conn.send(msg); } catch { /* ignore */ } }
  close() { this.closed = true; try { this.conn.close(); } catch { /* ignore */ } }
}
