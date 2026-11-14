import { $, el, show, toast } from './dom.js';
import { MAPS, MODES } from '../config.js';
import { parseTag, sanitizeName, randomTag, saveIdentity, saveSettings } from '../core/storage.js';
import { Audio } from '../core/audio.js';

const MAP_SVG = {
  range: '<svg viewBox="0 0 64 64" fill="none" stroke="#ece8e1" stroke-width="3"><rect x="6" y="6" width="52" height="52"/><path d="M14 44h36M22 14v22M32 14v22M42 14v22"/></svg>',
  piazza: '<svg viewBox="0 0 64 64" fill="none" stroke="#ece8e1" stroke-width="3"><path d="M6 6h20v20H6zM38 6h20v18H38zM22 26h20v16H22zM26 42h12v16H26zM6 26h8v32M50 24h8v34"/></svg>',
  atrium: '<svg viewBox="0 0 64 64" fill="none" stroke="#ece8e1" stroke-width="3"><rect x="4" y="12" width="56" height="40"/><path d="M16 12v8h32v-8M16 52v-8h32v8"/><circle cx="32" cy="32" r="5"/></svg>',
};

// Lobby UI: top nav, queue timer, social/party panel, map picker, modals.
export class Lobby {
  constructor(app) {
    this.app = app;
    this.pm = app.pm;
    this.custom = { mode: 'duel', map: 'piazza', bhop: false, hsOnly: false, botFill: true };
    this._plates = [];
    this._buildMaps();
    this._bind();
  }

  _bind() {
    const app = this.app, pm = this.pm;
    $('btnPlay').onclick = () => { Audio.init(); Audio.resume(); Audio.play('ui', 0.6); if (app.session.busy) return; if (pm.inParty && !pm.isLeader) { toast('Waiting for the party leader to queue.'); return; } this.openModal('modeModal'); };
    $('btnCustom').onclick = () => { Audio.init(); Audio.play('ui', 0.6); if (pm.inParty && !pm.isLeader) { toast('Only the party leader can host a custom game.'); return; } this._syncCustom(); this.openModal('customModal'); };
    $('btnRange').onclick = () => { Audio.init(); Audio.play('ui', 0.6); if (app.session.busy) return; app.session.startRangeSolo(); };
    $('btnSettings').onclick = () => this.openSettings();
    $('btnCancelQ').onclick = () => app.session.cancel();
    for (const b of document.querySelectorAll('.modecard')) b.onclick = () => { this.closeModals(); app.session.startQueue(b.dataset.mode); };
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.closeModals());
    for (const m of document.querySelectorAll('.modal')) m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'namePrompt') this.closeModals(); });

    // custom game
    const seg = (id, key) => { $(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; this.custom[key] = b.dataset.v; if (key === 'mode' && b.dataset.v === 'range') this.custom.map = 'range'; if (key === 'map' && b.dataset.v === 'range') this.custom.mode = 'range'; if (key === 'mode' && b.dataset.v !== 'range' && this.custom.map === 'range') this.custom.map = 'piazza'; if (key === 'map' && b.dataset.v !== 'range' && this.custom.mode === 'range') this.custom.mode = 'ffa'; this._syncCustom(); }; };
    $('cMap').innerHTML = MAPS.map((m) => `<button data-v="${m.id}">${m.name.replace('THE ', '')}</button>`).join('');
    seg('cMode', 'mode'); seg('cMap', 'map');
    for (const [id, key] of [['cBhop', 'bhop'], ['cHs', 'hsOnly'], ['cBots', 'botFill']]) $(id).onclick = () => { this.custom[key] = !this.custom[key]; this._syncCustom(); };
    $('btnStartCustom').onclick = () => { this.closeModals(); pm.setMap(this.custom.map); app.session.startCustom({ ...this.custom }); };

    // social
    $('btnInvite').onclick = () => this._invite();
    $('friendTag').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this._invite(); });
    $('myTagBox').onclick = () => {
      const t = `${pm.identity.name}#${pm.identity.tag}`;
      try { navigator.clipboard.writeText(t).then(() => toast(`Copied ${t}`), () => toast(t)); } catch { toast(t); }
    };
    $('btnLeaveParty').onclick = () => pm.leaveParty();
    pm.on('party', () => this.renderParty());
    pm.on('invites', () => this.renderInvites());
    pm.on('invite', (from) => { toast(`${from.name}#${from.tag} invited you to their party`); Audio.play('found', 0.4); });
    pm.on('toast', (m) => toast(m));
    pm.on('status', (s) => this.renderStatus(s));
    pm.on('partyChat', (msg) => app.chat.add('party', `${msg.from.name}#${msg.from.tag}`, msg.msg, msg.from.id !== pm.id));
    pm.on('queueState', (st) => { if (st && st.el !== undefined && app.session.state !== 'match') this._followerEl = st.el; });

    // session → queue timer
    const s = app.session;
    s.on('queue', (q) => this.renderQueue(q));
    s.on('joining', (on) => { if (on) this.renderQueue({ searching: true, joining: true, start: performance.now() }); else if (!s.busy) this.renderQueue({ searching: false }); });
    s.on('found', () => { Audio.play('found', 0.7); this.queueFound = true; });
    s.on('playerFound', () => Audio.play('ui', 0.6, 0, 1.4));
    s.on('toast', (m) => toast(m));

    // settings
    this._bindSettings();
  }

  _invite() {
    const v = $('friendTag').value;
    const p = parseTag(v);
    if (!p) { toast('Enter a tag like Example#1234'); return; }
    this.pm.invite(p.name, p.tag);
    $('friendTag').value = '';
  }

  _buildMaps() {
    const box = $('maps');
    box.innerHTML = '';
    for (const m of MAPS) {
      const c = el('button', 'mapcard'); c.dataset.map = m.id;
      c.style.setProperty('--mc', m.color);
      c.innerHTML = `${MAP_SVG[m.id]}<span class="pick"></span><span class="mn">${m.name}</span><span class="ms">${m.sub}</span>`;
      c.onclick = () => { Audio.init(); Audio.play('ui', 0.5); this.pm.setMap(m.id); if (!this.pm.inParty) { this.pm.party.map = m.id; this.renderParty(); } };
      box.appendChild(c);
    }
  }

  show(on) {
    show('lobby', on);
    if (on) { this.renderParty(); this.renderInvites(); this.renderStatus(this.pm.status); }
  }

  renderStatus(s) {
    for (const id of ['netDot', 'socialDot']) $(id).className = `dot ${s}`;
    $('netDot').title = s === 'online' ? 'Connected to PeerJS broker' : s === 'connecting' ? 'Connecting…' : 'Offline (bots only)';
    $('socialHint').textContent = s === 'offline'
      ? 'Social is offline: the PeerJS broker is unreachable on this network. You can still play The Range and bot matches.'
      : 'Party members appear next to you in the lobby. Anyone in the party can pick the map; the leader starts queues and custom games. Press Enter to chat.';
  }

  renderParty() {
    const pm = this.pm, p = pm.party;
    const id = pm.identity;
    $('meTag').innerHTML = `${id.name}<span class="t">#${id.tag}</span>`;
    $('meTag').className = 'tagchip';
    $('myTagText').innerHTML = `${id.name}<span class="t">#${id.tag}</span>`;
    $('myTagText').className = 'tagchip';
    const box = $('party'); box.innerHTML = '';
    for (const m of p.members) {
      const r = el('div', `member${m.id === p.leader ? ' leader' : ''}`);
      r.innerHTML = `<span class="tagchip">${m.name}<span class="t">#${m.tag}</span></span>${m.id === p.leader ? '<span class="crown">LEADER</span>' : ''}`;
      box.appendChild(r);
    }
    $('partyCount').textContent = `${p.members.length}/5`;
    show('btnLeaveParty', p.members.length > 1);
    for (const c of document.querySelectorAll('.mapcard')) {
      const on = c.dataset.map === p.map;
      c.classList.toggle('on', on);
      c.querySelector('.pick').textContent = on ? (p.members.length > 1 ? 'PARTY PICK' : 'SELECTED') : '';
    }
    this.custom.map = p.map; if (p.map === 'range') this.custom.mode = 'range'; else if (this.custom.mode === 'range') this.custom.mode = 'ffa';
    this.app.lobbyScene.setMembers(p.members, pm.id);
    $('btnPlay').textContent = pm.inParty && !pm.isLeader ? 'READY' : 'PLAY';
  }

  renderInvites() {
    const box = $('invites'); box.innerHTML = '';
    for (const inv of this.pm.pendingInvites.values()) {
      const r = el('div', 'invite');
      r.innerHTML = `<span class="tagchip">${inv.from.name}<span class="t">#${inv.from.tag}</span></span><span class="label" style="width:100%">PARTY INVITE</span>`;
      const acts = el('div', 'acts');
      const a = el('button', 'btn red small', 'ACCEPT'); a.onclick = () => this.pm.acceptInvite(inv.from.id);
      const d = el('button', 'btn small', 'DECLINE'); d.onclick = () => this.pm.declineInvite(inv.from.id);
      acts.append(a, d); r.appendChild(acts);
      box.appendChild(r);
    }
  }

  renderQueue(q) {
    clearInterval(this._qTimer);
    if (!q || !q.searching) { show('queueTimer', false); this.queueFound = false; return; }
    show('queueTimer', true);
    $('queueTimer').classList.remove('found');
    const start = q.start || performance.now();
    const tick = () => {
      const el2 = (performance.now() - start) / 1000;
      const mm = String(Math.floor(el2 / 60)).padStart(2, '0'), ss = String(Math.floor(el2 % 60)).padStart(2, '0');
      $('qTime').textContent = `${mm}:${ss}`;
      if (this.queueFound) { $('queueTimer').classList.add('found'); $('qText').textContent = 'MATCH FOUND'; }
    };
    $('qText').textContent = q.joining ? 'JOINING PARTY MATCH...' : 'SEARCHING FOR MATCH...';
    const M = q.mode && MODES[q.mode];
    $('qSub').textContent = q.joining ? 'Connecting to party leader' : `${M ? M.label : ''} · ${q.found || 1}/${q.size || (M && M.size) || 2} PLAYERS · BOTS FILL AT 0:15${this.pm.status !== 'online' ? ' · OFFLINE' : ''}`;
    show('btnCancelQ', !q.follower);
    tick();
    this._qTimer = setInterval(tick, 250);
  }

  _syncCustom() {
    const c = this.custom;
    for (const b of $('cMode').children) b.classList.toggle('on', b.dataset.v === c.mode);
    for (const b of $('cMap').children) b.classList.toggle('on', b.dataset.v === c.map);
    $('cBhop').classList.toggle('on', c.bhop); $('cHs').classList.toggle('on', c.hsOnly); $('cBots').classList.toggle('on', c.botFill);
    const n = this.pm.party.members.length;
    $('customHint').textContent = n > 1 ? `Hosting for your party of ${n}. Members join automatically.` : 'Solo custom match — invite friends from the Social panel first to play together.';
  }

  openModal(id) { this.closeModals(); show(id, true); }
  closeModals() { for (const m of document.querySelectorAll('.modal')) if (m.id !== 'namePrompt') m.classList.add('hidden'); }

  // ---- settings ----
  openSettings() { this._syncSettings(); this.openModal('settingsModal'); }
  _syncSettings() {
    const s = this.app.settings;
    $('sSens').value = s.sens; $('sSensV').textContent = s.sens.toFixed(2);
    $('sTSens').value = s.touchSens; $('sTSensV').textContent = s.touchSens.toFixed(2);
    $('sFov').value = s.fov; $('sFovV').textContent = `${s.fov}°`;
    $('sVol').value = s.volume; $('sVolV').textContent = `${Math.round(s.volume * 100)}%`;
    $('sSpeedo').classList.toggle('on', s.speedometer); $('sAds').classList.toggle('on', !!s.adsToggle); $('sFps').classList.toggle('on', !!s.showFps);
    for (const b of $('sScale').children) b.classList.toggle('on', +b.dataset.v === s.renderScale);
    for (const b of $('sXh').children) b.classList.toggle('on', b.dataset.v === s.crosshairColor);
  }
  _bindSettings() {
    const app = this.app;
    const upd = () => { saveSettings(app.settings); this._syncSettings(); app.applySettings(); };
    $('sSens').oninput = (e) => { app.settings.sens = +e.target.value; upd(); };
    $('sTSens').oninput = (e) => { app.settings.touchSens = +e.target.value; upd(); };
    $('sFov').oninput = (e) => { app.settings.fov = +e.target.value; upd(); };
    $('sVol').oninput = (e) => { app.settings.volume = +e.target.value; upd(); };
    $('sSpeedo').onclick = () => { app.settings.speedometer = !app.settings.speedometer; upd(); };
    $('sAds').onclick = () => { app.settings.adsToggle = !app.settings.adsToggle; upd(); };
    $('sFps').onclick = () => { app.settings.showFps = !app.settings.showFps; upd(); };
    $('sScale').onclick = (e) => { const b = e.target.closest('button'); if (b) { app.settings.renderScale = +b.dataset.v; upd(); } };
    $('sXh').onclick = (e) => { const b = e.target.closest('button'); if (b) { app.settings.crosshairColor = b.dataset.v; upd(); } };
    $('btnRename').onclick = () => { this.closeModals(); app.promptName(true); };
    for (const r of document.querySelectorAll('#settingsModal input')) r.addEventListener('keydown', (e) => e.stopPropagation());
  }

  // per-frame: nameplates under the 3D models
  frame() {
    const app = this.app;
    const list = app.lobbyScene.platePositions(app.width, app.height, this._plates);
    const box = $('plates');
    const leader = this.pm.party.leader;
    let i = 0;
    for (const p of list) {
      let d = box.children[i];
      if (!d) { d = el('div', 'plate'); box.appendChild(d); }
      const key = `${p.m.id}|${p.m.id === leader}`;
      if (d._k !== key) { d._k = key; d.innerHTML = `${p.m.id === leader && list.length > 1 ? '<span class="lead">PARTY LEADER</span>' : ''}${p.m.name}<span class="t">#${p.m.tag}</span>`; }
      d.style.left = `${p.x | 0}px`; d.style.top = `${(p.y + 8) | 0}px`;
      i++;
    }
    while (box.children.length > i) box.lastChild.remove();
  }
}

// First-load / rename dialog. Resolves {name, tag} with a fresh random 4-digit tag.
export function promptNameDialog(defaultName = '') {
  return new Promise((resolve) => {
    show('namePrompt', true);
    const input = $('nameInput');
    input.value = defaultName;
    setTimeout(() => input.focus(), 50);
    const done = () => {
      const n = sanitizeName(input.value);
      if (n.length < 2) { toast('Name must be 2–14 letters, numbers or _'); return; }
      const id = { name: n, tag: randomTag() };
      saveIdentity(id);
      show('namePrompt', false);
      $('btnName').onclick = null; input.onkeydown = null;
      resolve(id);
    };
    $('btnName').onclick = done;
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(); };
  });
}
