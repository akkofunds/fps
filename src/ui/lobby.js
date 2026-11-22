import { $, el, show, toast } from './dom.js';
import { ICONS, ABILITY_ICON } from './icons.js';
import { isAdmin } from './admin.js';
import { isPublicMage, globalCfg, isOwner as isOwnerNow } from '../core/adminAccess.js';
import { myToken, maskToken } from '../core/adminAccess.js';
import { MAGES as MAGE_DEFS, mageOf } from '../game/mages.js';
import { parseTag, sanitizeName, randomTag, saveIdentity, loadRecent } from '../core/storage.js';
import { Audio } from '../core/audio.js';
import { MODES } from '../config.js';

// Lobby UI: party cards (you in the center with your live 3D mage), mode tabs (FFA queue /
// Custom / Practice), queue timer pill, social sidebar (your tag, party, invite by tag, recent
// players), invite cards, Mages and Career tabs, settings.

const MODE_DESC = {
  ffa: 'Free-For-All quickplay: jump straight into a match on Sunvale and fight. No scoreboard, no kill limit, no timer — drop in, drop out, up to 8 mages.',
  duel: 'Duel: 1v1 on Sunvale. 3 lives each — lose your last one and you lose. Scoreboard on. Warm up on the map while we find your opponent.',
  custom: 'Custom: a private match for your party. Pick the kill limit and time limit, invite friends with their Name#1234 tag, then start.',
  practice: 'Practice: a solo range on Sunvale with training dummies. Learn your mage: string your M1s, land every ability, try your ultimate.',
};
// watermark size: the longest word of the name just spans the card (cardVw = the card's width in vw)
// eslint-disable-next-line no-unused-vars
const wmSize = (name, cardVw) => `min(${(cardVw * 1.45 / Math.max(4, ...name.split(/\s+/).map((w) => w.length))).toFixed(2)}vw, ${Math.round(cardVw * 1.45 * 16 / Math.max(4, ...name.split(/\s+/).map((w) => w.length)))}px)`;
// fanart for each mage's cards: [image, focus point]
const ART = {
  pyro: ['art/pyro.jpg', '52% 24%'],
  meteora: ['art/meteora.jpg', '48% 26%'],
  sorcerer: ['art/sorcerer.jpg', '50% 22%'],
  kineslayer: ['art/kineslayer.jpg', '64% 6%'],
  manipulator: ['art/manipulator.jpg', '62% 8%'],
  inkweaver: ['art/inkweaver.jpg', '52% 16%'],
};
const MAGES = [
  { id: 'pyro', name: 'SHOTO', icon: ICONS.flame, open: true },
  { id: 'meteora', name: 'METEORA', icon: ICONS.nova, open: true },
  { id: 'sorcerer', name: 'SORCERER', icon: ICONS.purple, open: true },
  { id: 'kineslayer', name: 'KINE SLAYER', icon: ICONS.spear, open: true },
  { id: 'manipulator', name: 'MANIPULATOR', icon: ICONS.king, open: true, admin: true }, // admin-only
  { id: 'inkweaver', name: 'INKWEAVER', icon: ICONS.talisman, open: true, admin: true }, // admin-only
  { id: 'terra', name: 'TERRA', icon: ICONS.earth },
  { id: 'volt', name: 'VOLT', icon: ICONS.storm },
  { id: 'gale', name: 'GALE', icon: ICONS.wind },
];

export class Lobby {
  constructor(app) {
    this.app = app;
    this.pm = app.pm; this.session = app.session;
    this.mode = 'ffa';
    this.queue = { searching: false };
    // the saved pick (settings.mage) is never overwritten by an access check: if it is admin-only
    // and the admin check has not finished yet, Shoto stands in until refreshAccess() restores it
    const want = app.settings.mage;
    this.mage = MAGE_DEFS[want] && this.canUse(want) ? want : 'pyro';
    this.browse = MAGE_DEFS[want] ? want : this.mage; // the mage shown in the Mages tab
    this.pm.setMage(this.mage);
    this._bind();
    this.renderParty(); this.renderSocial(); this.renderMages(); this.renderCareer();
    this.setMode('ffa');
    this.renderMotd();
  }

  _bind() {
    const app = this.app, pm = this.pm, ses = this.session;
    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    document.querySelectorAll('.mode-tab').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    document.querySelectorAll('#lobby button').forEach((b) => b.addEventListener('mouseenter', () => Audio.play('uiHover', 0.5)));
    $('btnStart').onclick = () => { Audio.init(); Audio.play('ui'); this.start(); };
    $('btnPractice').onclick = () => { Audio.init(); Audio.play('ui'); if (ses.busy) ses.cancel(); ses.startPractice(); };
    $('btnLeaveParty').onclick = () => { Audio.play('ui'); if (pm.inParty) pm.leaveParty(); else toast('You are not in a party.'); };
    $('queuePill').onclick = () => { if (this.queue.searching && !this.queue.follower) ses.cancel(); };
    $('btnSettings').onclick = () => this.openSettings();
    $('btnRename').onclick = () => app.promptName(true);
    $('meTag').onclick = () => {
      const t = `${pm.identity.name}#${pm.identity.tag}`;
      try { navigator.clipboard.writeText(t); toast(`Copied ${t}`); } catch { toast(t); }
    };
    $('inviteForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = parseTag($('inviteInput').value);
      if (!v) { toast('Enter a tag like Name#1234'); return; }
      pm.invite(v.name, v.tag);
      $('inviteInput').value = '';
    });
    // live 3D character: drag to rotate
    pm.on('party', () => { this.renderParty(); this.renderSocial(); });
    pm.on('status', (s) => { $('netStatus').className = 'status-dot ' + s; $('netStatus').title = `Matchmaking: ${s}`; this.renderSocial(); });
    pm.on('toast', (t) => toast(t));
    pm.on('invites', () => this.renderInvites());
    pm.on('invite', () => Audio.play('found', 0.5));
    pm.on('partyChat', (msg) => app.chat.add('party', `${msg.from.name}`, msg.msg, msg.from.id === pm.id));
    pm.on('queueState', () => {});
    ses.on('toast', (t) => toast(t));
    ses.on('queue', (q) => this.setQueue(q));
    ses.on('joining', (on) => { if (on) toast('Joining party match…'); });
    ses.on('playerFound', () => Audio.play('ui', 0.6));
    ses.on('found', () => Audio.play('found', 0.8));
    // settings modal
    const s = app.settings;
    const bindRange = (id, vid, key, fmt) => {
      const r = $(id); r.value = s[key];
      const upd = () => { s[key] = Number(r.value); $(vid).textContent = fmt(s[key]); app.applySettings(); app.saveSettings(); };
      r.addEventListener('input', upd); $(vid).textContent = fmt(s[key]);
    };
    bindRange('sSens', 'vSens', 'sens', (v) => v.toFixed(2));
    bindRange('sFov', 'vFov', 'fov', (v) => `${v}°`);
    bindRange('sVol', 'vVol', 'volume', (v) => `${Math.round(v * 100)}%`);
    $('sQuality').value = s.quality;
    $('sGpu').textContent = `GPU: ${app.gpu || 'unknown'}${s.autoTier ? ` · auto-tuned ×${s.autoTier}` : ''}`;
    $('sQuality').onchange = () => { s.quality = $('sQuality').value; s.autoTier = 0; app.saveSettings(); toast('Reloading to apply graphics quality…'); setTimeout(() => location.reload(), 700); };
    $('sScale').value = String(s.renderScale || 0);
    $('sScale').onchange = () => { s.renderScale = Number($('sScale').value); app.saveSettings(); app.resize(); };
    $('btnSocial').onclick = () => { $('social').classList.toggle('open'); app.resize(); };
    $('sShoulder').value = String(s.shoulder);
    $('sShoulder').onchange = () => { s.shoulder = Number($('sShoulder').value); app.saveSettings(); app.applySettings(); };
    $('sInvert').checked = !!s.invertY;
    $('sInvert').onchange = () => { s.invertY = $('sInvert').checked; app.saveSettings(); };
    $('sPerf').value = s.perfMode || 'off';
    $('sPerf').onchange = () => { s.perfMode = $('sPerf').value; app.saveSettings(); toast('Reloading to apply optimization…'); setTimeout(() => location.reload(), 700); };
    $('sDyn').checked = s.dynamicRes !== false;
    $('sDyn').onchange = () => { s.dynamicRes = $('sDyn').checked; s.autoTune = s.dynamicRes; if (!s.dynamicRes) app.dynScale = 1; app.saveSettings(); app.resize(); };
    $('btnSettingsClose').onclick = () => { show('settings', false); };
    // account: this device's private admin token
    const tok = myToken();
    $('sToken').value = maskToken(tok);
    let shown = false;
    $('btnTokenShow').onclick = () => { shown = !shown; $('sToken').value = shown ? tok : maskToken(tok); $('btnTokenShow').textContent = shown ? 'HIDE' : 'SHOW'; };
    $('btnTokenCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(tok); toast('Token copied. Only give it to an admin.'); }
      catch { shown = true; $('sToken').value = tok; $('btnTokenShow').textContent = 'HIDE'; $('sToken').select(); toast('Select and copy the token.'); }
    };
  }

  show(on) {
    show('lobby', on);
    if (on) { this.renderParty(); this.renderSocial(); this.renderCareer(); this.app.resize(); }
  }
  frame() {
    if (this.queue.searching) {
      const s = Math.floor((performance.now() - this.queue.start) / 1000);
      const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (this._qt !== t) { this._qt = t; $('qpTime').textContent = t; }
    }
  }

  setTab(tab) {
    Audio.play('ui', 0.6);
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    show('tabPlay', tab === 'play'); show('tabMages', tab === 'mages'); show('tabCareer', tab === 'career');
    this.app.lobbyScene.setActive(tab !== 'career');
    if (tab === 'career') this.renderCareer();
  }

  setMode(mode) {
    if (this.queue.searching) { toast('Cancel the queue first.'); return; }
    this.mode = mode;
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('modeDesc').textContent = MODE_DESC[mode];
    show('customPanel', mode === 'custom');
    this._startLabel();
  }

  _startLabel() {
    const btn = $('btnStart');
    const leaderOnly = this.pm.inParty && !this.pm.isLeader;
    let label = this.mode === 'ffa' ? 'PLAY' : this.mode === 'duel' ? 'FIND DUEL' : this.mode === 'custom' ? 'START CUSTOM' : 'ENTER RANGE';
    if (this.queue.searching) label = this.queue.follower ? 'IN QUEUE' : 'IN QUEUE';
    if (leaderOnly && !this.queue.searching && this.mode !== 'practice') label = 'WAITING FOR LEADER';
    $('btnStartLabel').textContent = label;
    btn.classList.toggle('queued', !!this.queue.searching);
    btn.disabled = leaderOnly && this.mode !== 'practice' && !this.queue.searching;
    $('btnStart').style.fontSize = label.length > 12 ? '20px' : '';
  }

  start() {
    const ses = this.session;
    if (this.queue.searching) { if (!this.queue.follower) ses.cancel(); return; }
    if (this.mode === 'ffa' || this.mode === 'duel') ses.startQueue(this.mode);
    else if (this.mode === 'custom') ses.startCustom({ killsToWin: Number($('cKills').value), timeLimit: Number($('cTime').value) });
    else ses.startPractice();
  }

  setQueue(q) {
    this.queue = q;
    show('queuePill', !!q.searching);
    if (q.searching) {
      $('qpSub').textContent = q.found >= 2 ? `${q.found}/${q.size} PLAYERS · STARTING SOON` : `${q.found || 1}/${q.size} · WAITING FOR PLAYERS`;
      this._qt = null; this.frame();
    }
    this._startLabel();
  }

  // ---------------------------------------------------------------- party cards
  renderParty() {
    const pm = this.pm, box = $('partyCards');
    box.textContent = '';
    const members = pm.party.members;
    const me = members.find((m) => m.id === pm.id) || pm.me;
    const others = members.filter((m) => m.id !== pm.id);
    // order: 2 left, me, 2 right (Valorant style)
    const slots = [others[0], others[2], me, others[1], others[3]];
    slots.forEach((m, i) => {
      if (i === 2) { box.appendChild(this._card(m, true)); return; }
      if (m) box.appendChild(this._card(m, false));
      else {
        const c = el('div', 'vcard empty');
        c.appendChild(el('div', 'v-plus', '+'));
        c.appendChild(el('div', 'v-inv', 'INVITE'));
        c.onclick = () => { Audio.play('ui'); $('inviteInput').focus(); };
        box.appendChild(c);
      }
    });
    // the compact party strip on the Play screen (framed slots, you in the middle)
    const ps = $('partyStrip');
    if (ps) {
      ps.textContent = '';
      ps.appendChild(el('div', 'ps-lbl', 'PARTY'));
      for (const m of [others[0], others[2], me, others[1], others[3]]) {
        const isMe = m === me;
        const s = el('div', 'party-slot' + (isMe ? ' me' : '') + (m ? '' : ' empty'));
        s.appendChild(el('b', '', m ? (m.name || '?').trim().charAt(0).toUpperCase() : '+'));
        s.appendChild(el('span', '', m ? (isMe ? 'YOU' : m.name) : 'INVITE'));
        if (m) { s.title = `${m.name}#${m.tag || ''}`; if (pm.inParty && pm.party.leader === m.id) s.appendChild(el('i', 'crown', '♛')); }
        else s.onclick = () => { Audio.play('ui'); if ($('social').classList) $('social').classList.add('open'); $('inviteInput').focus(); };
        ps.appendChild(s);
      }
    }
    $('partyCount').textContent = `${members.length}/${MODES.ffa.size}`;
    this._heroName();
    this._startLabel();
  }

  // party banner (Valorant-style): the member's mage fanart, the mage name as a huge watermark,
  // READY and the player's name on a plate; yours is the highlighted one
  _card(m, isMe) {
    const pm = this.pm, id = MAGE_DEFS[m.mage] ? m.mage : 'pyro', md = mageOf(id), art = ART[id];
    const c = el('div', 'vcard filled' + (isMe ? ' me' : ''));
    c.style.setProperty('--accent', md.color);
    const ban = el('div', 'v-banner');
    if (art) { const img = el('div', 'v-art'); img.style.backgroundImage = `url(${art[0]})`; img.style.backgroundPosition = art[1]; ban.appendChild(img); }
    ban.appendChild(el('div', 'v-shade'));
    ban.appendChild(el('div', 'v-chev'));
    ban.appendChild(el('div', 'v-diamond'));
    const plate = el('div', 'v-plate');
    plate.appendChild(el('div', 'v-ready', isMe ? 'READY · YOU' : 'READY'));
    const nm = el('div', 'v-name', m.name); nm.title = `${m.name}#${m.tag || ''}`;
    plate.appendChild(nm);
    ban.appendChild(plate);
    c.appendChild(ban);
    c.appendChild(el('i', 'v-notch'));
    if (pm.party.leader === m.id && pm.inParty) c.appendChild(el('div', 'v-lead', '♛'));
    if (isMe) { c.title = 'Change your mage in the MAGES tab'; c.onclick = () => this.setTab('mages'); }
    return c;
  }

  // ---------------------------------------------------------------- social sidebar
  renderSocial() {
    const pm = this.pm;
    $('meName').textContent = pm.identity.name;
    $('meTag').textContent = `#${pm.identity.tag}`;
    const pl = $('partyList');
    pl.textContent = '';
    for (const m of pm.party.members) {
      const r = el('div', 'soc-row');
      r.appendChild(el('div', 'av', m.name[0].toUpperCase()));
      const nm = el('div', 'nm');
      nm.appendChild(el('b', '', `${m.name}#${m.tag}`));
      nm.appendChild(el('span', '', pm.party.leader === m.id ? 'Party leader' : 'In party'));
      r.appendChild(nm);
      pl.appendChild(r);
    }
    const rl = $('recentList');
    rl.textContent = '';
    const recent = loadRecent().filter((r) => !pm.party.members.some((m) => m.name === r.name && m.tag === r.tag));
    if (!recent.length) rl.appendChild(el('div', 'soc-empty', 'Players you match with show up here.'));
    for (const p of recent.slice(0, 8)) {
      const r = el('div', 'soc-row');
      r.appendChild(el('div', 'av', p.name[0].toUpperCase()));
      const nm = el('div', 'nm');
      nm.appendChild(el('b', '', `${p.name}#${p.tag}`));
      nm.appendChild(el('span', 'dim', 'Recently played'));
      r.appendChild(nm);
      const b = el('button', '', 'INVITE');
      b.onclick = () => { Audio.play('ui'); pm.invite(p.name, p.tag); };
      r.appendChild(b);
      rl.appendChild(r);
    }
    const st = pm.status;
    $('socFoot').textContent = st === 'online' ? 'Online — share your tag so friends can invite you.' : st === 'connecting' ? 'Connecting to matchmaking…' : 'Matchmaking offline — Practice still works.';
  }

  renderInvites() {
    const box = $('invites');
    box.textContent = '';
    for (const inv of this.pm.pendingInvites.values()) {
      const c = el('div', 'invite-card');
      const top = el('div', 'ic-top');
      top.appendChild(el('div', 'av', inv.from.name[0].toUpperCase()));
      const t = el('div'); t.appendChild(el('b', '', `${inv.from.name}#${inv.from.tag}`)); t.appendChild(el('span', '', 'invited you to their party'));
      top.appendChild(t); c.appendChild(top);
      const btns = el('div', 'ic-btns');
      const a = el('button', 'accept', 'ACCEPT'); a.onclick = () => { Audio.play('ui'); this.pm.acceptInvite(inv.from.id); };
      const d = el('button', 'decline', 'DECLINE'); d.onclick = () => { Audio.play('ui'); this.pm.declineInvite(inv.from.id); };
      btns.appendChild(a); btns.appendChild(d); c.appendChild(btns);
      box.appendChild(c);
    }
  }

  // ---------------------------------------------------------------- mages + career
  // Meteora is reserved for the unlocked admin client
  canUse(id) { const m = MAGES.find((x) => x.id === id); return !!m && m.open && (!m.admin || isAdmin() || isPublicMage(id)); }
  // re-check after the admin unlocks / locks
  refreshAccess() {
    const want = this.app.settings.mage;
    if (want && want !== this.mage && MAGE_DEFS[want] && this.canUse(want)) this._apply(want);
    else if (!this.canUse(this.mage)) this._apply('pyro'); // stand-in only: the saved pick stays saved
    this.renderMages(); this.renderParty();
  }
  _apply(id) {
    this.mage = id;
    this.pm.setMage(id);
    if (this.app.lobbyScene) this.app.lobbyScene.setMage(id);
  }

  selectMage(id) {
    if (!MAGE_DEFS[id] || id === this.mage) return;
    if (!this.canUse(id)) { toast('That mage is admin-only.'); return; }
    if (this.queue.searching) { toast('Cancel the queue to switch mages.'); return; }
    this.app.settings.mage = id; this.app.saveSettings(); // remembered across reloads
    this._apply(id);
    this.browse = id;
    Audio.play('found', 0.4);
    this.renderMages(); this.renderParty();
  }

  // big agent-select style name watermark behind the lobby character
  _heroName() {
    return; // lobby shows players only (no character showcase)
    let h = document.getElementById('heroName');
    if (!h) { h = el('div', 'hero-name'); h.id = 'heroName'; const tab = $('tabPlay'); tab.insertBefore(h, tab.firstChild); }
    const md = mageOf(this.mage);
    h.textContent = md.name;
    h.style.setProperty('--accent', md.color);
    document.body.style.setProperty('--hero', md.color);
  }

  // MAGES tab: the roster of fanart cards — click one to see it, SELECT to play it
  renderMages() {
    const ro = $('mageRoster');
    ro.textContent = '';
    if (!MAGE_DEFS[this.browse]) this.browse = this.mage;
    for (const m of MAGES) {
      const usable = this.canUse(m.id), art = ART[m.id];
      const t = el('div', 'mtile' + (usable ? '' : ' locked') + (m.id === this.mage ? ' equipped' : '') + (m.id === this.browse ? ' sel' : '') + (m.open ? '' : ' soon'));
      t.dataset.mage = m.id;
      if (art) { const img = el('div', 'mt-art'); img.style.backgroundImage = `url(${art[0]})`; img.style.backgroundPosition = art[1]; t.appendChild(img); }
      else { const ic = el('div', 'mt-icon'); ic.innerHTML = m.icon; t.appendChild(ic); }
      t.appendChild(el('div', 'mt-name', m.name));
      if (!m.open) t.appendChild(el('span', 'mt-tag', 'SOON'));
      else if (!usable) t.appendChild(el('span', 'mt-tag', 'ADMIN'));
      else if (m.id === this.mage) t.appendChild(el('span', 'mt-tag on', 'EQUIPPED'));
      t.onclick = () => {
        if (!m.open) { toast(`${m.name} is coming soon.`); return; }
        Audio.play('ui', 0.6);
        this.browse = m.id;
        if (usable && m.id !== this.mage) this.selectMage(m.id); else this.renderMages();
      };
      ro.appendChild(t);
    }
    const D = mageOf(this.browse), A = ART[this.browse], usable = this.canUse(this.browse);
    const art = $('mageArt');
    if (art) {
      art.textContent = '';
      art.style.setProperty('--accent', D.color);
      if (A) { const img = el('div', 'ma-img'); img.style.backgroundImage = `url(${A[0]})`; img.style.backgroundPosition = A[1]; art.appendChild(img); }
      const b = el('button', 'btn-start ma-select' + (this.browse === this.mage ? ' on' : ''), this.browse === this.mage ? 'EQUIPPED' : usable ? 'SELECT' : 'ADMIN ONLY');
      b.disabled = !usable || this.browse === this.mage;
      b.onclick = () => this.selectMage(this.browse);
      art.appendChild(b);
    }
    const d = $('mageDetail');
    d.textContent = '';
    d.appendChild(el('div', 'md-role', `// ${D.role}`));
    const nm = el('div', 'md-name', D.name); nm.style.color = D.color; d.appendChild(nm);
    d.appendChild(el('div', 'md-bio', D.bio));
    const list = el('div', 'md-abils');
    for (const a of D.abilities) {
      const row = el('div', 'md-ab' + (a.ult ? ' ult' : ''));
      const ic = el('div', 'ic'); ic.innerHTML = ABILITY_ICON[a.id] || ''; ic.appendChild(el('b', '', a.key)); row.appendChild(ic);
      const txt = el('div');
      txt.appendChild(el('div', 't', a.name.toUpperCase() + (a.cd ? `  ·  ${a.cd}s` : a.ult ? `  ·  ${a.cost} PTS` : '')));
      txt.appendChild(el('div', 'd', a.desc));
      row.appendChild(txt);
      list.appendChild(row);
    }
    d.appendChild(list);
  }

  renderCareer() {
    const c = $('career');
    const h = this.app.history();
    const games = h.length, wins = h.filter((x) => x.place === 1).length;
    const k = h.reduce((a, x) => a + x.kills, 0), d = h.reduce((a, x) => a + x.deaths, 0);
    c.innerHTML = '<h3>CAREER</h3>';
    const stats = el('div', 'stats');
    for (const [v, l] of [[games, 'MATCHES'], [wins, 'WINS'], [k, 'ELIMINATIONS'], [d ? (k / d).toFixed(2) : k.toFixed(2), 'K/D']]) {
      const s = el('div', 'stat'); s.appendChild(el('b', '', String(v))); s.appendChild(el('span', '', l)); stats.appendChild(s);
    }
    c.appendChild(stats);
    const hist = el('div', 'hist');
    if (!h.length) hist.appendChild(el('div', 'muted', 'No matches yet — queue up!'));
    for (const x of h.slice(0, 10)) {
      const r = el('div');
      r.appendChild(el('span', x.place === 1 ? 'win' : '', x.place === 1 ? 'VICTORY' : `#${x.place} of ${x.players}`));
      r.appendChild(el('span', '', x.mode));
      r.appendChild(el('span', '', `${x.kills} / ${x.deaths}  ·  ${x.dmg} dmg`));
      r.appendChild(el('span', 'muted', new Date(x.t).toLocaleDateString()));
      hist.appendChild(r);
    }
    c.appendChild(hist);
  }

  // the owner's announcement (signed, travels with the admin list to every player)
  renderMotd() {
    let m = document.getElementById('motd');
    if (!m) { m = el('div', 'motd mb-plate'); m.id = 'motd'; $('tabPlay').appendChild(m); }
    const t = globalCfg().motd;
    m.textContent = t; m.classList.toggle('hidden', !t);
    if (t && t !== this._motd) { this._motd = t; toast(`📣 ${t}`, 6000); }
  }

  showAdminBadge(open) { const b = $('adminBadge'); b.classList.remove('hidden'); b.onclick = open; }
  hideAdminBadge() { $('adminBadge').classList.add('hidden'); }

  openSettings() {
    Audio.play('ui');
    const st = $('sAdminStatus');
    if (st) st.textContent = isOwnerNow() ? 'OWNER' : isAdmin() ? 'ADMIN' : 'PLAYER';
    show('settings', true);
  }
  closeModals() { show('settings', false); }
}

export function promptNameDialog(prefill = '') {
  return new Promise((resolve) => {
    show('nameDialog', true);
    const inp = $('nameInput');
    inp.value = prefill;
    setTimeout(() => inp.focus(), 50);
    const form = $('nameForm');
    const onSubmit = (e) => {
      e.preventDefault();
      const name = sanitizeName(inp.value);
      if (!name) { inp.focus(); return; }
      form.removeEventListener('submit', onSubmit);
      show('nameDialog', false);
      const id = { name, tag: randomTag() };
      saveIdentity(id);
      resolve(id);
    };
    form.addEventListener('submit', onSubmit);
  });
}
