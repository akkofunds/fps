import { $, el, show, toast } from './dom.js';
import { DEFAULT_BALANCE, loadBalance, saveBalance, ADMIN } from '../game/balance.js';
import { MAGE_LIST } from '../game/mages.js';
import { Audio } from '../core/audio.js';

// Admin panel, built into the normal game client and opened at /admin (or #admin).
//
// Access check: an admin code (compared in base64) and then a security question.
// NOTE: this runs entirely in the browser — anyone can read the bundled JavaScript, and base64
// is an encoding, not encryption. It keeps casual visitors out; it is not real security. Nothing
// here can touch other people's games except Custom/Practice lobbies that YOU host.
const CODE_B64 = 'QWtrbzQ3ODQ2OTA5';
const ANSWER_B64 = 'a2l3aQ==';
const SESSION_KEY = 'magebreak.admin';

const b64 = (s) => { try { return btoa(unescape(encodeURIComponent(s))); } catch { return ''; } };

export function isAdminRoute() {
  return /\/admin\/?$/.test(location.pathname) || location.hash === '#admin' || new URLSearchParams(location.search).has('admin');
}
export function isAdmin() { try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; } }
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
    if (isAdmin()) this.renderPanel(); else this.renderGate(1);
  }
  close() { show(this.root, false); }

  // ---------------------------------------------------------------- two-step gate
  renderGate(step) {
    const r = this.root;
    r.innerHTML = '';
    const box = el('div', 'admin-gate');
    box.appendChild(el('div', 'ag-title', 'ADMIN ACCESS'));
    box.appendChild(el('div', 'ag-step', step === 1 ? 'STEP 1 OF 2 · ADMIN CODE' : 'STEP 2 OF 2 · SECURITY QUESTION'));
    box.appendChild(el('label', 'ag-q', step === 1 ? 'Enter the admin code' : "What is your dog's name?"));
    const form = el('form');
    const inp = el('input');
    inp.type = step === 1 ? 'password' : 'text';
    inp.autocomplete = 'off'; inp.spellcheck = false;
    form.appendChild(inp);
    const go = el('button', 'btn-wide primary', step === 1 ? 'CONTINUE' : 'UNLOCK'); go.type = 'submit';
    form.appendChild(go);
    const back = el('button', 'btn-wide', 'BACK TO GAME'); back.type = 'button';
    back.onclick = () => { this.close(); history.replaceState(null, '', location.pathname.replace(/admin\/?$/, '') || '/'); };
    form.appendChild(back);
    const err = el('div', 'ag-err', '');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      const ok = step === 1 ? b64(v) === CODE_B64 : b64(v.toLowerCase()) === ANSWER_B64;
      if (!ok) {
        this.fails = (this.fails || 0) + 1;
        err.textContent = this.fails >= 5 ? 'Too many attempts — reload the page to try again.' : 'Incorrect.';
        if (this.fails >= 5) { inp.disabled = true; go.disabled = true; }
        inp.value = ''; inp.focus();
        return;
      }
      Audio.play('ui');
      if (step === 1) { this.renderGate(2); return; }
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
      syncAdminPerks();
      toast('Admin unlocked for this tab.');
      this.renderPanel();
    });
    box.appendChild(form);
    box.appendChild(err);
    r.appendChild(box);
    setTimeout(() => inp.focus(), 30);
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

    // -- balance
    const bal = loadBalance();
    const sec = (title, note) => { const s = el('section', 'ap-sec'); s.appendChild(el('h3', '', title)); if (note) s.appendChild(el('p', 'muted', note)); body.appendChild(s); return s; };
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
    tool('LOCK ADMIN', () => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } syncAdminPerks(); this.close(); toast('Admin locked.'); });
    s5.appendChild(trow);

    r.appendChild(p);
  }
}
