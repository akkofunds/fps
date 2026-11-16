import { $, el, show, toast } from './dom.js';
import { DEFAULT_BALANCE, loadBalance, saveBalance, ADMIN } from '../game/balance.js';
import { MAGE_LIST } from '../game/mages.js';
import { Audio } from '../core/audio.js';

import { isAdmin, myToken, maskToken, adminSession, saveSession, api, setLocalGrant } from '../core/adminAccess.js';

// Admin panel, built into the normal game client and opened at /admin (or #admin), or from the
// ADMIN badge in the lobby once you are an admin.
//
// Sign-in: password, then the security question — both checked by the server (/api/admin), so
// neither is in the game's JavaScript. The signed-in session is remembered on this device. Then
// (optional) paste a player's token from their Settings to make them an admin everywhere.
export { isAdmin };

export function isAdminRoute() {
  return /\/admin\/?$/.test(location.pathname) || location.hash === '#admin' || new URLSearchParams(location.search).has('admin');
}
// admin perk: ultimate always ready (on by default once unlocked; toggle in the panel)
export function syncAdminPerks() {
  let pref = '1';
  try { pref = localStorage.getItem('magebreak.adminUlt') ?? '1'; } catch { /* ignore */ }
  ADMIN.ult = isAdmin() && pref !== '0';
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
    if (adminSession()) this.renderPanel(); else this.renderGate(1);
  }
  close() { show(this.root, false); }

  _granted() {
    syncAdminPerks();
    if (this.app.lobby) this.app.lobby.refreshAccess();
    if (this.app.lobby) { if (isAdmin()) this.app.lobby.showAdminBadge(() => this.open()); else this.app.lobby.hideAdminBadge(); }
  }

  // ---------------------------------------------------------------- sign-in (password → dog's name → optional token)
  renderGate(step) {
    const r = this.root;
    r.innerHTML = '';
    const box = el('div', 'admin-gate');
    box.appendChild(el('div', 'ag-title', 'ADMIN ACCESS'));
    const steps = ['STEP 1 OF 3 · PASSWORD', "STEP 2 OF 3 · SECURITY QUESTION", 'STEP 3 OF 3 · GRANT ADMIN'];
    box.appendChild(el('div', 'ag-step', steps[step - 1]));
    box.appendChild(el('label', 'ag-q', step === 1 ? 'Enter the admin password' : step === 2 ? "What is your dog's name?" : 'Paste the token of the account to make admin'));
    if (step === 3) box.appendChild(el('p', 'muted ag-note', 'Every player has a private token in Settings → Account. Paste yours (or a friend\'s) to give that account admin in the normal game — no /admin needed. You can do this later from the panel.'));
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
        const res = await api('login', { password: this.pw, pet: v });
        this.pw = '';
        if (!res.ok) {
          if (res.status === 401) { this.renderGate(1); this.root.querySelector('.ag-err').textContent = res.message || 'Incorrect.'; return; }
          fail(res.message || 'Sign-in failed.'); return;
        }
        saveSession(res);
        this._granted();
        toast('Signed in as admin on this device.');
        this.renderGate(3);
        return;
      }
      const res = await api('add', { session: adminSession(), token: v, name: nameInp.value.trim() });
      if (!res.ok) { fail(res.message || 'Could not grant admin.'); return; }
      if (v === myToken()) setLocalGrant(true);
      this._granted();
      toast('Admin granted to ' + (nameInp.value.trim() || maskToken(v)) + '.');
      this.renderPanel();
    });
    box.appendChild(form);
    box.appendChild(err);
    r.appendChild(box);
    setTimeout(() => inp.focus(), 30);
  }

  // ---------------------------------------------------------------- admins (shared list on the server)
  async renderAdmins(sec) {
    sec.querySelectorAll('.ap-admins, .ap-addadmin, .ap-warn').forEach((n) => n.remove());
    const list = el('div', 'ap-admins');
    list.appendChild(el('p', 'muted', 'Loading admins…'));
    sec.appendChild(list);
    const res = await api('list', { session: adminSession() });
    list.innerHTML = '';
    if (!res.ok) {
      if (res.error === 'session') { saveSession(null); this.renderGate(1); return; }
      const w = el('div', 'ap-warn', res.message || 'Could not load the admin list.');
      sec.insertBefore(w, list);
    } else if (!res.admins.length) list.appendChild(el('p', 'muted', 'No admin accounts yet. Add one below.'));
    for (const a of res.admins || []) {
      const row = el('div', 'ap-admin');
      const who = el('div', 'ap-who');
      who.appendChild(el('b', '', a.name || 'Unnamed'));
      who.appendChild(el('span', 'mono', maskToken(a.token)));
      if (a.token === myToken()) who.appendChild(el('span', 'ap-you', 'THIS DEVICE'));
      row.appendChild(who);
      row.appendChild(el('span', 'muted', a.added ? new Date(a.added).toLocaleDateString() : ''));
      const rm = el('button', 'btn-side danger', 'REMOVE');
      rm.onclick = async () => {
        if (!confirm(`Remove admin from ${a.name || maskToken(a.token)}?`)) return;
        const out = await api('remove', { session: adminSession(), token: a.token });
        if (!out.ok) { toast(out.message || 'Could not remove.'); return; }
        if (a.token === myToken()) setLocalGrant(false);
        this._granted(); toast('Admin removed.'); this.renderAdmins(sec);
      };
      row.appendChild(rm);
      list.appendChild(row);
    }
    // add
    const add = el('form', 'ap-addadmin');
    const ti = el('input'); ti.placeholder = 'Player token (magebreak-…)'; ti.autocomplete = 'off'; ti.spellcheck = false;
    const ni = el('input'); ni.placeholder = 'Name (optional)'; ni.maxLength = 24;
    const mine = el('button', 'btn-side', 'MY TOKEN'); mine.type = 'button'; mine.onclick = () => { ti.value = myToken(); };
    const go = el('button', 'btn-side primary', 'ADD ADMIN'); go.type = 'submit';
    add.append(ti, ni, mine, go);
    add.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = ti.value.trim(); if (!t) return;
      const out = await api('add', { session: adminSession(), token: t, name: ni.value.trim() });
      if (!out.ok) { toast(out.message || 'Could not add admin.'); return; }
      if (t === myToken()) setLocalGrant(true);
      this._granted(); toast('Admin added.'); this.renderAdmins(sec);
    });
    sec.appendChild(add);
  }

  // ---------------------------------------------------------------- panel
  renderPanel() {
    const app = this.app;
    const r = this.root;
    r.innerHTML = '';
    const p = el('div', 'admin-panel');
    const head = el('div', 'ap-head');
    head.appendChild(el('div', 'ap-title', 'MAGEBREAK · ADMIN'));
    const x = el('button', 'icon-btn small', '✕'); x.onclick = () => this.close(); head.appendChild(x);
    p.appendChild(head);
    const body = el('div', 'ap-body');
    p.appendChild(body);

    const sec = (title, note) => { const s = el('section', 'ap-sec'); s.appendChild(el('h3', '', title)); if (note) s.appendChild(el('p', 'muted', note)); body.appendChild(s); return s; };
    // -- admins
    const sA = sec('ADMINS', 'Accounts with admin in the normal game (Meteora, admin perks). Players find their token in Settings → Account.');
    this.renderAdmins(sA);

    // -- balance
    const bal = loadBalance();
    const s1 = sec('BALANCE', 'Applies to Custom and Practice games that you host. Everyone in your lobby uses your numbers. Public Free-For-All always uses the defaults.');
    const grid = el('div', 'ap-grid');
    const num = (key, label, min, max, step) => {
      const l = el('label'); l.appendChild(el('span', '', label));
      const v = el('b', '', String(bal[key]));
      const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = bal[key];
      i.oninput = () => { bal[key] = Number(i.value); v.textContent = i.value; saveBalance(bal); };
      l.appendChild(i); l.appendChild(v); grid.appendChild(l);
    };
    num('hp', 'Max health', 25, 1000, 5);
    num('speed', 'Move speed ×', 0.5, 2, 0.05);
    num('gravity', 'Gravity ×', 0.3, 2, 0.05);
    num('dmg', 'Damage ×', 0, 4, 0.05);
    num('cd', 'Cooldowns ×', 0.1, 3, 0.05);
    num('ult', 'Ult charge ×', 0, 10, 0.1);
    num('respawn', 'Respawn (s)', 0.5, 10, 0.5);
    s1.appendChild(grid);
    const chk = (key, label) => {
      const l = el('label', 'ap-chk'); const i = el('input'); i.type = 'checkbox'; i.checked = !!bal[key];
      i.onchange = () => { bal[key] = i.checked; saveBalance(bal); };
      l.appendChild(i); l.appendChild(document.createTextNode(' ' + label)); s1.appendChild(l);
    };
    // admin perk (all modes, this browser tab only)
    const au = el('label', 'ap-chk'); const ai = el('input'); ai.type = 'checkbox'; ai.checked = ADMIN.ult;
    ai.onchange = () => { try { localStorage.setItem('magebreak.adminUlt', ai.checked ? '1' : '0'); } catch { /* ignore */ } syncAdminPerks(); toast(ai.checked ? 'Admin: X ultimate always ready.' : 'Admin ultimate perk off.'); };
    au.appendChild(ai); au.appendChild(document.createTextNode(' ADMIN: X ultimate always ready — no charge, no cooldown (every mode)'));
    s1.appendChild(au);
    chk('noCooldowns', 'No cooldowns');
    chk('infiniteUlt', 'Infinite ultimate');
    chk('godMode', 'God mode (Practice only)');
    const reset = el('button', 'btn-side', 'RESET TO DEFAULTS');
    reset.onclick = () => { saveBalance({ ...DEFAULT_BALANCE }); this.renderPanel(); toast('Balance reset.'); };
    s1.appendChild(reset);

    // -- animation viewer (drives the lobby character)
    const s2 = sec('ANIMATION VIEWER', 'Plays animations on your lobby character. Drag the center card to turn the character.');
    const mrow = el('div', 'ap-row');
    for (const m of MAGE_LIST) {
      const b = el('button', 'btn-side' + (app.lobby && app.lobby.mage === m.id ? ' on' : ''), m.name);
      b.onclick = () => { app.lobby.selectMage(m.id); this.renderPanel(); };
      mrow.appendChild(b);
    }
    s2.appendChild(mrow);
    const arow = el('div', 'ap-row wrap');
    const anims = [
      ['Dash', ['dash', { dir: 0 }]], ['Back dash', ['dash', { dir: Math.PI }]], ['Roll', ['roll', { dir: 0 }]], ['Back roll', ['roll', { dir: Math.PI }]],
      ['Hit', ['hit']], ['Death', ['die']], ['Respawn', ['respawn']],
      ['Punch R', ['cast', { anim: 'boltR' }]], ['Orb', ['cast', { anim: 'orb' }]], ['Slam', ['slam']], ['Leap', ['leap']], ['Meteor call', ['cast', { anim: 'ult' }]],
      ['Staff shot', ['cast', { anim: 'mBolt' }]], ['Starfall', ['cast', { anim: 'mRaise' }]], ['Sigil', ['plant']], ['Blink', ['cast', { anim: 'mBlink' }]], ['Nova', ['nova']], ['Exhausted', ['exhausted']],
    ];
    for (const [label, [k, d]] of anims) {
      const b = el('button', 'chip', label);
      b.onclick = () => { const inst = app.lobbyScene.inst; if (inst) { if (k === 'respawn') inst.anim.play('respawn'); else inst.anim.play(k, d || {}); } };
      arow.appendChild(b);
    }
    s2.appendChild(arow);

    // -- display
    const s3 = sec('DISPLAY & DIAGNOSTICS');
    const fps = el('label', 'ap-chk'); const fi = el('input'); fi.type = 'checkbox'; fi.checked = this.fpsOn;
    fi.onchange = () => { this.fpsOn = fi.checked; show('fpsMeter', this.fpsOn); };
    fps.appendChild(fi); fps.appendChild(document.createTextNode(' Show FPS / draw calls')); s3.appendChild(fps);
    const gl = app.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    s3.appendChild(el('p', 'muted', `GPU: ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown'} · Pixel ratio ${app.renderer.getPixelRatio().toFixed(2)} · Quality ${app.settings.quality}`));

    // -- network
    const s4 = sec('MATCHMAKING SERVER', 'Use your own PeerJS signaling server instead of the public one (takes effect after reload).');
    const net = JSON.parse(localStorage.getItem('magebreak.peer') || '{}');
    const row = el('div', 'ap-row');
    const mk = (k, ph) => { const i = el('input'); i.placeholder = ph; i.value = net[k] || ''; i.oninput = () => { net[k] = i.value.trim(); localStorage.setItem('magebreak.peer', JSON.stringify(net)); }; row.appendChild(i); };
    mk('host', 'host (e.g. peer.example.com)'); mk('port', 'port'); mk('path', 'path');
    s4.appendChild(row);

    // -- tools
    const s5 = sec('TOOLS');
    const trow = el('div', 'ap-row wrap');
    const tool = (label, fn) => { const b = el('button', 'btn-side', label); b.onclick = fn; trow.appendChild(b); };
    tool('START PRACTICE', () => { this.close(); app.session.startPractice(); });
    tool('CLEAR MATCH HISTORY', () => { localStorage.removeItem('magebreak.history'); app.lobby.renderCareer(); toast('History cleared.'); });
    tool('CLEAR RECENT PLAYERS', () => { localStorage.removeItem('magebreak.recent'); app.lobby.renderSocial(); toast('Recent players cleared.'); });
    tool('SIGN OUT OF ADMIN PANEL', () => { saveSession(null); this._granted(); this.close(); toast('Signed out of the admin panel on this device.'); });
    s5.appendChild(trow);

    r.appendChild(p);
  }
}
