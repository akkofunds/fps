import Peer from 'peerjs';
import { peerOptions } from './peerManager.js';
import { PEER_PREFIX } from '../config.js';
import { currentList, adoptList, onAdminChange } from '../core/adminAccess.js';

// Shares the owner-signed admin list between players with no server: one online player holds a
// well-known PeerJS id and acts as the "directory". Everyone else connects to it, sends the list
// they have and gets the newest one back. If nobody holds it, the first player to notice claims
// it. Lists are only ever accepted when the owner's signature checks out (adminAccess.js), so the
// directory can't be used to fake admins — at worst it can withhold an update.
const DIR_ID = `${PEER_PREFIX}admin-directory`;

export class AdminDirectory {
  constructor(pm) {
    this.pm = pm;
    this.holder = null;
    this.busy = false;
    this.claiming = false;
    onAdminChange(() => { if (!this.holder && !this.busy) setTimeout(() => this.sync(), 50); });
    pm.on('status', (s) => { if (s === 'online') this.sync(); });
    pm.on('peerUnavailable', (t) => { if (t === DIR_ID) { this.busy = false; this._claim(); } });
  }

  start() {
    this.sync();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.sync(), 60000);
  }

  // exchange lists with whoever holds the directory id
  sync() {
    if (this.holder || this.busy) return;
    const peer = this.pm.peer;
    if (!peer || this.pm.status !== 'online') return;
    this.busy = true;
    let conn;
    try { conn = peer.connect(DIR_ID, { metadata: { kind: 'adminlist' }, serialization: 'json', reliable: true }); } catch { this.busy = false; return; }
    let finished = false;
    const done = () => { if (finished) return; finished = true; this.busy = false; setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 300); };
    conn.on('open', () => { try { conn.send({ t: 'list', list: currentList() }); } catch { done(); } });
    conn.on('data', async (m) => { if (m && m.t === 'list') await adoptList(m.list); done(); });
    conn.on('error', done);
    conn.on('close', done);
    setTimeout(done, 9000);
  }

  // nobody is serving the list: become the directory until this tab closes
  _claim() {
    if (this.holder || this.claiming) return;
    this.claiming = true;
    let p;
    try { p = new Peer(DIR_ID, peerOptions()); } catch { this.claiming = false; return; }
    p.on('open', () => { this.holder = p; this.claiming = false; });
    p.on('error', () => {
      // usually 'unavailable-id': someone else claimed it first — just sync with them
      this.claiming = false;
      if (this.holder === p) this.holder = null;
      try { p.destroy(); } catch { /* ignore */ }
      setTimeout(() => this.sync(), 1500);
    });
    p.on('disconnected', () => { if (this.holder === p) { this.holder = null; try { p.destroy(); } catch { /* ignore */ } setTimeout(() => this.sync(), 3000); } });
    p.on('connection', (c) => {
      c.on('data', async (m) => {
        if (!m || m.t !== 'list') return;
        await adoptList(m.list);
        try { c.send({ t: 'list', list: currentList() }); } catch { /* ignore */ }
      });
    });
    addEventListener('pagehide', () => { try { p.destroy(); } catch { /* ignore */ } });
  }
}
