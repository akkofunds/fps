import { $, el, show, toast } from './dom.js';
import { DEFAULT_BALANCE, loadBalance, saveBalance, ADMIN, BAL } from '../game/balance.js';
import { MAGE_LIST } from '../game/mages.js';
import { Audio } from '../core/audio.js';

import { isAdmin, isOwner, myToken, maskToken, ownerSignIn, ownerSignOut, adminList, addAdmin, removeAdmin, removeAllAdmins, tokenHash, currentList, globalCfg, setGlobalCfg } from '../core/adminAccess.js';
import { ICONS } from './icons.js';

// Owner panel, built into the normal game client and opened at /admin (or #admin), or from the
// OWNER badge in the lobby once signed in.
//
// The OWNER signs in with the password + dog's name (they unlock the owner key on this device;
// remembered, so it's a one-time thing). Only the owner gets this panel. The owner can add
// players as ADMINS by their token (Settings → Account): every mage is open to everyone; being an admin carries no character access.
export { isAdmin, isOwner };

export function isAdminRoute() {
  return /\/admin\/?$/.test(location.pathname) || location.hash === '#admin' || new URLSearchParams(location.search).has('admin');
}
// admin perk: ultimate always ready (on by default once unlocked; toggle in the panel)
export function syncAdminPerks() {
  let pref = '1';
  try { pref = localStorage.getItem('magebreak.adminUlt') ?? '1'; } catch { /* ignore */ }
  ADMIN.ult = isOwner() && pref !== '0';
}

export class AdminPanel {
  constructor(app) {
    this.app = app;
    this.root = el('div', 'admin hidden');
    this.root.id = 'admin';
    document.body.appendChild(this.root);
    this.fpsOn = false;
  }

  open() {
    show(this.root, true);
    if (isOwner()) this.renderPanel(); else this.renderGate(1);
  }
  close() { show(this.root, false); }

  _granted() {
    syncAdminPerks();
    if (this.app.lobby) this.app.lobby.refreshAccess();
    if (this.app.lobby) { if (isOwner()) this.app.lobby.showAdminBadge(() => this.open()); else this.app.lobby.hideAdminBadge(); }
  }

  // ---------------------------------------------------------------- sign-in (password → dog's name → optional token)
  renderGate(step) {
    const r = this.root;
    r.innerHTML = '';
    const box = el('div', 'admin-gate');
    box.appendChild(el('div', 'ag-title', 'OWNER ACCESS'));
    const steps = ['STEP 1 OF 3 · PASSWORD', "STEP 2 OF 3 · SECURITY QUESTION", 'STEP 3 OF 3 · ADD AN ADMIN (OPTIONAL)'];
    box.appendChild(el('div', 'ag-step', steps[step - 1]));
    box.appendChild(el('label', 'ag-q', step === 1 ? 'Enter the admin password' : step === 2 ? "What is your dog's name?" : 'Paste the token of a player to make them an admin'));
    if (step === 3) box.appendChild(el('p', 'muted ag-note', 'Every player has a private token in Settings → Account. Every mage is open to all players. You can also do this later from the panel.'));
    const form = el('form');
    const inp = el('input');
    inp.type = step === 1 ? 'password' : 'text';
    inp.autocomplete = 'off'; inp.spellcheck = false;
    if (step === 3) inp.placeholder = 'magebreak-…';
    form.appendChild(inp);
    let nameInp = null;
    if (step === 3) {
      nameInp = el('input'); nameInp.placeholder = 'Name (optional, e.g. Akko)'; nameInp.maxLength = 24; nameInp.autocomplete = 'off';
      form.appendChild(nameInp);
      const mine = el('button', 'btn-wide', "USE THIS DEVICE'S TOKEN"); mine.type = 'button';
      mine.onclick = () => { inp.value = myToken(); if (!nameInp.value) nameInp.value = (this.app.pm && this.app.pm.identity && this.app.pm.identity.name) || ''; };
      form.appendChild(mine);
    }
    const go = el('button', 'btn-wide primary', step === 1 ? 'CONTINUE' : step === 2 ? 'SIGN IN' : 'GRANT ADMIN'); go.type = 'submit';
    form.appendChild(go);
    const back = el('button', 'btn-wide', step === 3 ? 'SKIP FOR NOW' : 'BACK TO GAME'); back.type = 'button';
    back.onclick = () => {
      if (step === 3) { this.renderPanel(); return; }
      this.close(); history.replaceState(null, '', location.pathname.replace(/admin\/?$/, '') || '/');
    };
    form.appendChild(back);
    const err = el('div', 'ag-err', '');
    const fail = (msg) => { err.textContent = msg; go.disabled = false; inp.focus(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      Audio.play('ui');
      if (step === 1) { this.pw = v; this.renderGate(2); return; }
      go.disabled = true; err.textContent = '';
      if (step === 2) {
        go.textContent = 'CHECKING…';
        const ok = await ownerSignIn(this.pw || '', v);
        this.pw = '';
        if (!ok) {
          this.fails = (this.fails || 0) + 1;
          this.renderGate(1);
          this.root.querySelector('.ag-err').textContent = 'Incorrect password or answer.';
          return;
        }
        this._granted();
        toast('Signed in as owner. This device stays signed in.');
        this.renderGate(3);
        return;
      }
      try { await addAdmin(v, nameInp.value.trim()); } catch (ex) { fail(ex.message || 'Could not add admin.'); return; }
      this._granted();
      toast('Admin added: ' + (nameInp.value.trim() || maskToken(v)) + '.');
      this.renderPanel();
    });
    box.appendChild(form);
    box.appendChild(err);
    r.appendChild(box);
    setTimeout(() => inp.focus(), 30);
  }

  // ---------------------------------------------------------------- admins (owner-signed list)
  async renderAdmins(sec) {
    sec.querySelectorAll('.ap-admins, .ap-addadmin').forEach((n) => n.remove());
    const list = el('div', 'ap-admins');
    sec.appendChild(list);
    const mine = await tokenHash(myToken());
    const admins = adminList();
    if (!admins.length) list.appendChild(el('p', 'muted', 'No admins yet. Add one below with their token.'));
    for (const a of admins) {
      const row = el('div', 'ap-admin');
      const who = el('div', 'ap-who');
      who.appendChild(el('b', '', a.n || 'Unnamed'));
      who.appendChild(el('span', 'mono', a.m || ''));
      if (a.h === mine) who.appendChild(el('span', 'ap-you', 'THIS DEVICE'));
      row.appendChild(who);
      row.appendChild(el('span', 'muted', a.a ? new Date(a.a).toLocaleDateString() : ''));
      const rm = el('button', 'btn-side danger', 'REMOVE');
      rm.onclick = async () => {
        if (!confirm(`Remove admin from ${a.n || a.m}?`)) return;
        try { await removeAdmin(a.h); } catch (ex) { toast(ex.message); return; }
        this._granted(); toast('Admin removed.'); this.renderAdmins(sec);
      };
      row.appendChild(rm);
      list.appendChild(row);
    }
    const add = el('form', 'ap-addadmin');
    const ti = el('input'); ti.placeholder = 'Player token (magebreak-…)'; ti.autocomplete = 'off'; ti.spellcheck = false;
    const ni = el('input'); ni.placeholder = 'Name (optional)'; ni.maxLength = 24;
    const go = el('button', 'btn-side primary', 'ADD ADMIN'); go.type = 'submit';
    add.append(ti, ni, go);
    add.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = ti.value.trim(); if (!t) return;
      try { await addAdmin(t, ni.value.trim()); } catch (ex) { toast(ex.message); return; }
      this._granted(); toast('Admin added.'); this.renderAdmins(sec);
    });
    sec.appendChild(add);
  }

  // ---------------------------------------------------------------- panel (tabs)
  renderPanel(tab = this.tab || 'overview') {
    this.tab = tab;
    const r = this.root;
    r.innerHTML = '';
    const p = el('div', 'admin-panel');
    const head = el('div', 'ap-head');
    const ttl = el('div'); ttl.appendChild(el('div', 'ap-title', 'MAGEBREAK · OWNER')); ttl.appendChild(el('div', 'ap-sub', 'Everything here is signed with your owner key or stays on this device.'));
    head.appendChild(ttl);
    const x = el('button', 'icon-btn small', '✕'); x.onclick = () => this.close(); head.appendChild(x);
    p.appendChild(head);
    const wrap = el('div', 'ap-wrap');
    const nav = el('div', 'ap-nav');
    const TABS = [['overview', 'OVERVIEW'], ['admins', 'ADMINS'], ['global', 'GLOBAL'], ['balance', 'BALANCE'], ['practice', 'PRACTICE TOOLS'], ['viewer', 'VIEWER'], ['system', 'SYSTEM']];
    for (const [id, label] of TABS) {
      const b = el('button', id === tab ? 'on' : '', label);
      b.onclick = () => { Audio.play('ui', 0.5); this.renderPanel(id); };
      nav.appendChild(b);
    }
    const body = el('div', 'ap-body');
    wrap.append(nav, body);
    p.appendChild(wrap);
    r.appendChild(p);
    this.body = body;
    ({ overview: () => this.tabOverview(), admins: () => this.tabAdmins(), global: () => this.tabGlobal(), balance: () => this.tabBalance(), practice: () => this.tabPractice(), viewer: () => this.tabViewer(), system: () => this.tabSystem() })[tab]();
  }
  _sec(title, note) { const s = el('section', 'ap-sec'); s.appendChild(el('h3', '', title)); if (note) s.appendChild(el('p', 'muted', note)); this.body.appendChild(s); return s; }
  _btn(row, label, fn, cls = '') { const b = el('button', 'btn-side ' + cls, label); b.onclick = fn; row.appendChild(b); return b; }

  // ---- overview: what is going on right now
  tabOverview() {
    const app = this.app, L = currentList(), m = app.match;
    const s = this._sec('OVERVIEW');
    const cards = el('div', 'ap-cards');
    const card = (v, l, warn) => { const c = el('div', 'ap-card' + (warn ? ' warn' : '')); c.appendChild(el('b', '', String(v))); c.appendChild(el('span', '', l)); cards.appendChild(c); };
    card(adminList().length, 'ADMINS');
    card(L ? new Date(L.v).toLocaleDateString() : 'NONE', 'LIST SIGNED', !L);
    card(globalCfg().open.length, 'CHARACTERS OPENED');
    card(app.pm ? app.pm.status.toUpperCase() : '—', 'MATCHMAKING', !app.pm || app.pm.status !== 'online');
    card(app.pm ? app.pm.party.members.length : 0, 'IN YOUR PARTY');
    card(m ? `${m.mode.label}` : 'LOBBY', 'WHERE YOU ARE');
    card(m ? m.ents.size : 0, 'PLAYERS + DUMMIES');
    card(Math.round(app.lastFps || 0), 'FPS', (app.lastFps || 60) < 45);
    s.appendChild(cards);
    const q = this._sec('QUICK ACTIONS');
    const row = el('div', 'ap-row wrap');
    this._btn(row, 'START PRACTICE', () => { this.close(); app.session.startPractice(); }, 'primary');
    this._btn(row, 'POST ANNOUNCEMENT', () => this.renderPanel('global'));
    this._btn(row, 'MANAGE ADMINS', () => this.renderPanel('admins'));
    this._btn(row, 'FPS METER', () => { this.fpsOn = !this.fpsOn; show('fpsMeter', this.fpsOn); });
    q.appendChild(row);
  }

  // ---- admins
  tabAdmins() {
    const s = this._sec('ADMINS', 'Admins can play admin-only characters (Kine Slayer). Players find their token in Settings → Account. Changes travel player-to-player: they reach others the next time they are online alongside someone who has the new list.');
    const row = el('div', 'ap-row wrap');
    const search = el('input'); search.type = 'search'; search.placeholder = 'Search admins…';
    row.appendChild(search);
    this._btn(row, 'REMOVE ALL ADMINS', async () => {
      if (!adminList().length) { toast('There are no admins.'); return; }
      if (!confirm('Remove EVERY admin? Nobody but you will have admin access.')) return;
      try { await removeAllAdmins(); } catch (ex) { toast(ex.message); return; }
      this._granted(); toast('All admins removed.'); this.renderPanel('admins');
    }, 'danger');
    s.appendChild(row);
    this.renderAdmins(s).then(() => {
      search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        s.querySelectorAll('.ap-admin').forEach((r) => { r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      };
    });
  }

  // ---- global: signed settings every player receives
  tabGlobal() {
    const cfg = globalCfg();
    const s = this._sec('ANNOUNCEMENT', 'A message shown on every player\'s lobby (and as a pop-up when it changes). Signed by you, so nobody else can post one.');
    const ta = el('textarea', 'ap-text'); ta.maxLength = 200; ta.value = cfg.motd; ta.placeholder = 'e.g. New character this weekend! Duels are live.';
    s.appendChild(ta);
    const row = el('div', 'ap-row wrap');
    this._btn(row, 'POST', async () => { try { await setGlobalCfg({ motd: ta.value.trim() }); } catch (ex) { toast(ex.message); return; } toast('Announcement posted.'); }, 'primary');
    this._btn(row, 'CLEAR', async () => { try { await setGlobalCfg({ motd: '' }); } catch (ex) { toast(ex.message); return; } ta.value = ''; toast('Announcement cleared.'); });
    s.appendChild(row);
    const s2 = this._sec('CHARACTER ACCESS', 'Open an admin-only character to every player, or lock it back to admins.');
    const grid = el('div', 'ap-toggles');
    for (const m of MAGE_LIST.filter((x) => x.admin)) {
      const r = el('div', 'ap-mage');
      r.insertAdjacentHTML('beforeend', (m.id === 'manipulator' ? ICONS.king : m.id === 'inkweaver' ? ICONS.talisman : ICONS.spear) || '');
      r.appendChild(el('span', 'nm', m.name));
      if (m.forever) { r.appendChild(el('button', 'btn-side', 'ADMINS ONLY · FOREVER')); grid.appendChild(r); continue; }
      const open = cfg.open.includes(m.id);
      const b = el('button', 'btn-side' + (open ? ' on' : ''), open ? 'OPEN TO ALL' : 'ADMINS ONLY');
      b.onclick = async () => {
        const next = open ? cfg.open.filter((x) => x !== m.id) : cfg.open.concat([m.id]);
        try { await setGlobalCfg({ open: next }); } catch (ex) { toast(ex.message); return; }
        this._granted(); toast(`${m.name}: ${open ? 'admins only' : 'open to everyone'}.`); this.renderPanel('global');
      };
      r.appendChild(b);
      grid.appendChild(r);
    }
    s2.appendChild(grid);
  }

  // ---- balance: presets, sliders, cheats, export / import
  tabBalance() {
    const bal = loadBalance();
    const s0 = this._sec('PRESETS', 'Applies to Custom and Practice games that you host. Everyone in your lobby uses your numbers. Public matches always use the defaults.');
    const PRESETS = {
      DEFAULT: { ...DEFAULT_BALANCE },
      'GLASS CANNON': { ...DEFAULT_BALANCE, hp: 120, dmg: 1.2 },
      TANKY: { ...DEFAULT_BALANCE, hp: 400, respawn: 4 },
      'MOON GRAVITY': { ...DEFAULT_BALANCE, gravity: 0.45, speed: 1.15 },
      CHAOS: { ...DEFAULT_BALANCE, cd: 0.3, ult: 4, speed: 1.2 },
      'ULT SPAM': { ...DEFAULT_BALANCE, infiniteUlt: true, cd: 0.5 },
    };
    const prow = el('div', 'ap-row wrap');
    for (const [name, v] of Object.entries(PRESETS)) this._btn(prow, name, () => { saveBalance(v); toast(`Balance preset: ${name}.`); this.renderPanel('balance'); });
    s0.appendChild(prow);
    const s1 = this._sec('NUMBERS');
    const grid = el('div', 'ap-grid');
    const num = (key, label, min, max, step) => {
      const l = el('label'); l.appendChild(el('span', '', label));
      const v = el('b', '', String(bal[key]));
      const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = bal[key];
      i.oninput = () => { bal[key] = Number(i.value); v.textContent = i.value; saveBalance(bal); };
      l.appendChild(i); l.appendChild(v); grid.appendChild(l);
    };
    num('hp', 'Max health', 25, 1000, 5); num('speed', 'Move speed ×', 0.5, 2, 0.05); num('gravity', 'Gravity ×', 0.3, 2, 0.05);
    num('dmg', 'Damage ×', 0, 4, 0.05); num('cd', 'Cooldowns ×', 0.1, 3, 0.05); num('ult', 'Ult charge ×', 0, 10, 0.1); num('respawn', 'Respawn (s)', 0.5, 10, 0.5);
    s1.appendChild(grid);
    const chk = (key, label) => {
      const l = el('label', 'ap-chk'); const i = el('input'); i.type = 'checkbox'; i.checked = !!bal[key];
      i.onchange = () => { bal[key] = i.checked; saveBalance(bal); };
      l.appendChild(i); l.appendChild(document.createTextNode(' ' + label)); s1.appendChild(l);
    };
    chk('noCooldowns', 'No cooldowns'); chk('infiniteUlt', 'Infinite ultimate'); chk('godMode', 'God mode (Practice only)');
    const au = el('label', 'ap-chk'); const ai = el('input'); ai.type = 'checkbox'; ai.checked = ADMIN.ult;
    ai.onchange = () => { try { localStorage.setItem('magebreak.adminUlt', ai.checked ? '1' : '0'); } catch { /* ignore */ } syncAdminPerks(); toast(ai.checked ? 'Owner: X ultimate always ready.' : 'Owner ultimate perk off.'); };
    au.appendChild(ai); au.appendChild(document.createTextNode(' OWNER: X ultimate always ready, every mode')); s1.appendChild(au);
    const s2 = this._sec('SHARE', 'Copy your numbers to send to someone, or paste numbers someone sent you.');
    const row = el('div', 'ap-row wrap');
    this._btn(row, 'COPY AS TEXT', async () => { const t = JSON.stringify(loadBalance()); try { await navigator.clipboard.writeText(t); toast('Balance copied.'); } catch { prompt('Copy this:', t); } });
    this._btn(row, 'PASTE…', () => {
      const t = prompt('Paste balance text:'); if (!t) return;
      try { const v = JSON.parse(t); if (typeof v !== 'object' || !v) throw new Error(); saveBalance({ ...DEFAULT_BALANCE, ...v }); toast('Balance imported.'); this.renderPanel('balance'); } catch { toast('That is not balance text.'); }
    });
    this._btn(row, 'RESET TO DEFAULTS', () => { saveBalance({ ...DEFAULT_BALANCE }); this.renderPanel('balance'); toast('Balance reset.'); }, 'danger');
    s2.appendChild(row);
  }

  // ---- practice tools: work inside a Practice match (you are the host there)
  tabPractice() {
    const app = this.app, m = app.match;
    const s = this._sec('PRACTICE TOOLS', m && m.cfg.mode === 'practice' ? 'You are in Practice: these act immediately.' : 'Start Practice to use these (they never touch real matches).');
    const inPractice = () => { const mm = app.match; if (!mm || mm.cfg.mode !== 'practice') { toast('Open Practice first.'); return null; } return mm; };
    const row = el('div', 'ap-row wrap');
    if (!m || m.cfg.mode !== 'practice') this._btn(row, 'START PRACTICE', () => { this.close(); app.session.startPractice(); }, 'primary');
    this._btn(row, 'FILL ULTIMATE', () => { const mm = inPractice(); if (mm) { mm.kit.ult = 100; mm.kit.addUlt(0.01); toast('Ultimate ready.'); } });
    this._btn(row, 'RESET COOLDOWNS', () => { const mm = inPractice(); if (mm) { for (const k in mm.kit.cd) mm.kit.cd[k] = 0; mm.body.dashCharges = mm.body.perk.dashMax; toast('Cooldowns reset.'); } });
    this._btn(row, 'FULL HEAL', () => {
      const mm = inPractice(); if (!mm || !mm.rules) return;
      const e = mm.local; e.hp = BAL.hp; mm.rules.bcast({ t: 'hp', n: e.n, hp: e.hp, by: -1 }); toast('Healed.');
    });
    this._btn(row, 'HEAL DUMMIES', () => {
      const mm = inPractice(); if (!mm || !mm.rules) return;
      for (const e of mm.ents.values()) if (e.dummy) { e.hp = BAL.hp; mm.rules.bcast({ t: 'hp', n: e.n, hp: e.hp, by: -1 }); }
      toast('Dummies healed.');
    });
    this._btn(row, 'GOD MODE ' + (BAL.godMode ? 'OFF' : 'ON'), () => { BAL.godMode = !BAL.godMode; const b = loadBalance(); b.godMode = BAL.godMode; saveBalance(b); toast(`God mode ${BAL.godMode ? 'on' : 'off'}.`); this.renderPanel('practice'); });
    s.appendChild(row);
    const s2 = this._sec('SLOW MOTION', 'Practice only: slow the whole game down to study animations and effects.');
    const r2 = el('div', 'ap-row wrap');
    for (const k of [1, 0.5, 0.25, 0.1]) this._btn(r2, k === 1 ? 'NORMAL' : `${k}×`, () => { app.timeScale = k; toast(k === 1 ? 'Normal speed.' : `Slow motion ${k}×.`); this.renderPanel('practice'); }, (app.timeScale || 1) === k ? 'on' : '');
    s2.appendChild(r2);
  }

  // ---- viewer: animations + VFX on the lobby character
  tabViewer() {
    const app = this.app;
    const s = this._sec('CHARACTER', 'Pick who stands in the lobby, then play animations and effects on them (close the panel to watch).');
    const mrow = el('div', 'ap-row wrap');
    for (const m of MAGE_LIST) this._btn(mrow, m.name, () => { app.lobby.selectMage(m.id); this.renderPanel('viewer'); }, app.lobby && app.lobby.mage === m.id ? 'on' : '');
    s.appendChild(mrow);
    const play = (k, d) => { const inst = app.lobbyScene.inst; if (!inst) return; inst.anim.play(k, d || {}); };
    const s2 = this._sec('ANIMATIONS');
    const groups = [
      ['MOVEMENT', [['Dash', 'dash', { dir: 0 }], ['Back dash', 'dash', { dir: Math.PI }], ['Roll', 'roll', { dir: 0 }], ['Double jump', 'doubleJump', { dir: 0 }], ['Hit', 'hit'], ['Stagger', 'stagger'], ['Launched', 'launched'], ['Death', 'die'], ['Respawn', 'respawn']]],
      ['M1 (FISTS)', [['Jab', 'm1a'], ['Cross', 'm1b'], ['Hook', 'm1c'], ['Roundhouse', 'm1d']]],
      ['KINE SLAYER', [['Forehand', 'ksA'], ['Backhand', 'ksB'], ['Rising cut', 'ksC'], ['Thrust', 'ksD'], ['Inverted Spear', 'ksThrust'], ['Flash Step', 'ksFlash'], ['Skyfall leap', 'ksLeap'], ['Dive', 'ksDive'], ['Landing', 'ksLand']]],
      ['SORCERER', [['Blue', 'cast', { anim: 'gBlue' }], ['Red', 'cast', { anim: 'gRed' }], ['Hollow Purple', 'purple'], ['Domain', 'domain']]],
      ['SHOTO / METEORA', [['Flashfreeze', 'freeze'], ['Skate', 'skate'], ['Uppercut', 'uppercut'], ['Zero-Burn', 'zeroburn'], ['Staff shot', 'cast', { anim: 'mBolt' }], ['Starfall', 'cast', { anim: 'mRaise' }], ['Ray', 'ray'], ['Nova', 'nova']]],
    ];
    for (const [g, list] of groups) {
      s2.appendChild(el('p', 'muted', g));
      const row = el('div', 'ap-row wrap');
      for (const [label, k, d] of list) { const b = el('button', 'chip', label); b.onclick = () => play(k, d); row.appendChild(b); }
      s2.appendChild(row);
    }
    const s3 = this._sec('EFFECTS', 'Fires the effect in front of the lobby character.');
    const row = el('div', 'ap-row wrap');
    const fx = () => app.lobbyScene.fx;
    const at = (y = 1.2, f = 1.2) => { const inst = app.lobbyScene.inst, p = inst.root.position.clone(), yaw = inst.root.rotation.y; return { p: p.clone().add({ x: Math.sin(yaw) * f, y, z: Math.cos(yaw) * f }), F: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, o: p }; };
    const V = (v) => app.lobbyScene.inst.root.position.clone().set(v.x, v.y, v.z);
    const effects = [
      ['Spear slash', () => { const a = at(); for (let i = 0; i < 3; i++) setTimeout(() => fx().slashSwing((k, out) => app.lobbyScene.inst.weaponTip(out, k), V(a.F), i, a.o), i * 330); }],
      ['Spear hit', () => { const a = at(); fx().slashImpact(a.p, V(a.F), true); }],
      ['Fire / ice kick', () => { const a = at(); fx().punchSwing((out) => out.copy(a.p), V(a.F), 'frostflame', 3, a.o); }],
      ['Punch impact', () => { const a = at(); fx().punchImpact(a.p, V(a.F), 'frostflame', false); }],
      ['Heavy impact', () => { const a = at(); fx().punchImpact(a.p, V(a.F), 'frostflame', true); }],
      ['Cursed impact', () => { const a = at(); fx().punchImpact(a.p, V(a.F), 'cursed', true); }],
      ['Flash reveal', () => { const a = at(); fx().flashReveal(a.p, V(a.F)); }],
      ['Severance finale', () => { const a = at(1.2, 2); fx().severCut(a.p, a.p, a.p, V(a.F), true); }],
      ['Skyfall slam', () => { const a = at(0, 1.5); fx().skySlam(a.p); }],
      ['Impact star', () => { const a = at(); fx().impactStar(a.p, 2); }],
    ];
    for (const [label, fn] of effects) { const b = el('button', 'chip', label); b.onclick = () => { try { fn(); } catch (e) { console.warn(e); toast('That effect needs a match loaded once (start Practice).'); } }; row.appendChild(b); }
    s3.appendChild(row);
  }

  // ---- system
  tabSystem() {
    const app = this.app;
    const s = this._sec('DISPLAY & DIAGNOSTICS');
    const fps = el('label', 'ap-chk'); const fi = el('input'); fi.type = 'checkbox'; fi.checked = this.fpsOn;
    fi.onchange = () => { this.fpsOn = fi.checked; show('fpsMeter', this.fpsOn); };
    fps.appendChild(fi); fps.appendChild(document.createTextNode(' Show FPS / draw calls')); s.appendChild(fps);
    const gl = app.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    s.appendChild(el('p', 'muted', `GPU: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown'} · Pixel ratio ${app.renderer.getPixelRatio().toFixed(2)} · Quality ${app.settings.quality} · Auto-tune ×${app.settings.autoTier || 0}`));
    const r0 = el('div', 'ap-row wrap');
    this._btn(r0, 'RESET AUTO-TUNE', () => { app.settings.autoTier = 0; app.saveSettings(); toast('Auto-tune reset; reloading…'); setTimeout(() => location.reload(), 700); });
    s.appendChild(r0);
    const s4 = this._sec('MATCHMAKING SERVER', 'Use your own PeerJS signaling server instead of the public one (takes effect after reload).');
    const net = JSON.parse(localStorage.getItem('magebreak.peer') || '{}');
    const row = el('div', 'ap-row');
    const mk = (k, ph) => { const i = el('input'); i.placeholder = ph; i.value = net[k] || ''; i.oninput = () => { net[k] = i.value.trim(); localStorage.setItem('magebreak.peer', JSON.stringify(net)); }; row.appendChild(i); };
    mk('host', 'host (e.g. peer.example.com)'); mk('port', 'port'); mk('path', 'path');
    s4.appendChild(row);
    const s5 = this._sec('THIS DEVICE');
    const trow = el('div', 'ap-row wrap');
    this._btn(trow, 'CLEAR MATCH HISTORY', () => { localStorage.removeItem('magebreak.history'); app.lobby.renderCareer(); toast('History cleared.'); });
    this._btn(trow, 'CLEAR RECENT PLAYERS', () => { localStorage.removeItem('magebreak.recent'); app.lobby.renderSocial(); toast('Recent players cleared.'); });
    this._btn(trow, 'SIGN OUT (OWNER)', () => { ownerSignOut(); this._granted(); this.close(); toast('Signed out of the owner account on this device.'); }, 'danger');
    s5.appendChild(trow);
  }
}
