import * as THREE from 'three';
import { $, el, show } from './dom.js';
import { ABILITY_ICON, ICONS } from './icons.js';
import { ULT_COST, MOVE } from '../config.js';
import { BAL } from '../game/balance.js';

// In-match HUD: health, ability bar with cooldown sweeps, timer/score, kill feed, name tags,
// damage numbers, hit markers, damage direction, death/scoreboard/end screens.
// DOM writes only happen when a displayed value changes.

const proj = new THREE.Vector3(), cv = new THREE.Vector3();
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class Hud {
  constructor(app) {
    this.app = app;
    this.root = $('hud');
    this.cache = {};
    this.tags = new Map();
    this.nums = [];
    this.sbOpen = false;
    app.input.on('scoreboard', (on) => { this.sbOpen = on && !!this.board; if (this.match && this.sbOpen) this.renderBoard(); show('scoreboard', this.sbOpen && !!this.match && !this.match.ended); });
  }

  // ability bar for the local mage's kit: dash + 3 abilities + ultimate (last slot)
  _buildAbilities(kit) {
    const bar = $('abilBar');
    bar.textContent = '';
    this.ab = {};
    const slots = [['dash', 'Q'], ...kit.slots()];
    this.ultId = slots[slots.length - 1][0];
    for (const [id, key] of slots) {
      const isUlt = id === this.ultId;
      const d = el('div', 'ab' + (isUlt ? ' ult' : ''));
      if (isUlt) d.appendChild(el('div', 'ring'));
      d.insertAdjacentHTML('beforeend', ABILITY_ICON[id]);
      d.appendChild(el('div', 'sweep'));
      const k = el('div', 'key' + (isUlt ? ' big' : ''), key);
      d.appendChild(k);
      const cdv = el('div', 'cdv hidden'); d.appendChild(cdv);
      let pips = null, pct = null;
      if (id === 'dash') { pips = el('div', 'pips'); for (let i = 0; i < ((this.match && this.match.body && this.match.body.perk.dashMax) || MOVE.dashCharges); i++) pips.appendChild(el('i')); d.appendChild(pips); }
      if (isUlt) { pct = el('div', 'pct', '0%'); d.appendChild(pct); }
      d.title = (kit.def.abilities.find((a) => a.id === id) || {}).name || id;
      d.dataset.id = id;
      bar.appendChild(d);
      this.ab[id] = { d, cdv, pips, pct, last: '' };
    }
  }

  enterMatch(m) {
    this.match = m;
    this.cache = {};
    this._buildAbilities(m.kit);
    $('hpName').textContent = m.kit.def.name;
    $('hpName').style.color = m.kit.def.color;
    show('hud', true);
    show('deathScreen', false); show('endScreen', false); show('scoreboard', false);
    show('practiceHint', m.cfg.mode === 'practice');
    $('practiceHint').innerHTML = this.app.input.mode === 'touch' ? 'PRACTICE RANGE · Training dummies regenerate · Tap ☰ to leave' : 'PRACTICE RANGE · Training dummies regenerate · Press <b>Esc</b> to leave';
    // the score HUD + Tab scoreboard: Duels (and Customs) only; FFA is quickplay
    this.board = m.cfg.mode !== 'practice' && !m.mode.quickplay;
    show('topCenter', this.board);
    $('tcGoal').textContent = m.mode.lives ? `${m.mode.lives} LIVES EACH` : m.killsToWin ? `FIRST TO ${m.killsToWin}` : 'NO KILL LIMIT';
    document.querySelector('#topCenter .tc-me .tc-lbl').textContent = m.mode.lives ? 'YOUR LIVES' : 'YOU';
    $('killfeed').textContent = '';
    $('tags').textContent = ''; this.tags.clear();
    $('dmgNums').textContent = ''; this.nums.length = 0;
    $('xhair').style.setProperty('--c', this.app.settings.crosshairColor);
  }

  exitMatch() { this.match = null; show('hud', false); $('tags').textContent = ''; this.tags.clear(); }

  set(key, v, fn) { if (this.cache[key] !== v) { this.cache[key] = v; fn(v); } }

  update(dt, m) {
    const me = m.local;
    const hp = Math.max(0, Math.round(me.hp));
    this.set('hp', hp, (v) => {
      $('hpNum').textContent = v;
      $('hpFill').style.width = `${(v / BAL.hp) * 100}%`;
      $('hpGhost').style.width = `${(v / BAL.hp) * 100}%`;
      $('hpNum').parentElement.classList.toggle('low', v <= BAL.hp * 0.3);
    });
    // abilities
    const k = m.kit, b = m.body;
    for (const [id, max] of Object.entries(k.max)) {
      const a = this.ab[id];
      if (!a) continue;
      const cd = k.cd[id];
      const s = cd > 0 ? Math.ceil(cd) : 0;
      const key = `${s}|${Math.round((cd / max) * 40)}`;
      if (a.last !== key) {
        a.last = key;
        a.d.classList.toggle('cd', cd > 0); a.d.classList.toggle('ready', cd <= 0);
        a.cdv.classList.toggle('hidden', cd <= 0); a.cdv.textContent = s;
        a.d.querySelector('.sweep').style.setProperty('--p', `${(cd / max) * 100}%`);
      }
    }
    const dash = this.ab.dash;
    const dk = `${b.dashCharges}|${Math.round(b.dashRecharge * 10)}`;
    if (dash.last !== dk) {
      dash.last = dk;
      [...dash.pips.children].forEach((p, i) => p.classList.toggle('on', i < b.dashCharges));
      dash.d.classList.toggle('cd', b.dashCharges <= 0); dash.d.classList.toggle('ready', b.dashCharges > 0);
      const rem = b.dashCharges < b.perk.dashMax ? 1 - b.dashRecharge / MOVE.dashRecharge : 0;
      dash.d.querySelector('.sweep').style.setProperty('--p', `${b.dashCharges <= 0 ? rem * 100 : 0}%`);
      dash.cdv.classList.toggle('hidden', b.dashCharges > 0); dash.cdv.textContent = Math.ceil(rem * MOVE.dashRecharge);
    }
    const ult = this.ab[this.ultId];
    const up = Math.floor(k.ult);
    if (ult.last !== up) {
      ult.last = up;
      ult.d.querySelector('.ring').style.setProperty('--p', `${(up / ULT_COST) * 100}%`);
      ult.pct.textContent = up >= ULT_COST ? 'READY' : `${up}%`;
      ult.d.classList.toggle('full', up >= ULT_COST);
    }
    if (this.q) this.set('qt', Math.floor((performance.now() - this.q.start) / 1000), (v) => { document.querySelector('#queueBar .qt').textContent = fmtTime(v); });
    // top center
    if (this.board && !this.q) {
      const t = m.timeLeft;
      this.set('time', fmtTime(t), (v) => { $('tcTime').textContent = v; });
      let lead = null;
      for (const e of m.ents.values()) if (!e.dummy && e !== me && !e.left && (!lead || e.kills > lead.kills)) lead = e;
      if (m.mode.lives) {
        // duel: lives left on each side
        const L = (e) => Math.max(0, m.mode.lives - (m.phase === 'live' || m.phase === 'ended' ? e.deaths : 0));
        this.set('meK', `L${L(me)}`, () => { $('tcMe').textContent = '♥'.repeat(L(me)) || '0'; });
        this.set('lead', lead ? `${lead.name}|L${L(lead)}` : '-', () => { $('tcLeadName').textContent = lead ? lead.name.toUpperCase() : 'WAITING…'; $('tcLead').textContent = lead ? ('♥'.repeat(L(lead)) || '0') : '-'; });
      } else {
        this.set('meK', me.kills, (v) => { $('tcMe').textContent = v; });
        this.set('lead', lead ? `${lead.name}|${lead.kills}` : '-', () => { $('tcLeadName').textContent = lead ? lead.name.toUpperCase() : 'NO RIVALS'; $('tcLead').textContent = lead ? lead.kills : '-'; });
      }
    }
    // crosshair on enemy
    this.set('xt', !!m.aimEnt, (v) => $('xhair').classList.toggle('target', v));
    // death timer
    if (!me.alive && this.deathAt) {
      const left = Math.max(0, this.deathAt - performance.now() / 1000);
      this.set('dt', Math.ceil(left), (v) => { $('dsTimer').textContent = v; });
    }
    this._tags(m);
    this._nums(dt, m);
    if (this.sbOpen) { this._sbT = (this._sbT || 0) - dt; if (this._sbT <= 0) { this._sbT = 0.5; this.renderBoard(); } }
    // fade hurt overlay
    this.hurtV = Math.max(0, (this.hurtV || 0) - dt * 1.6);
    this.set('hv', Math.round(this.hurtV * 50), (v) => { $('hurtVig').style.opacity = v / 50; });
    this.hurtD = Math.max(0, (this.hurtD || 0) - dt * 1.4);
    if (this.hurtFrom && this.hurtD > 0) {
      const dx = this.hurtFrom.x - me.pos.x, dz = this.hurtFrom.z - me.pos.z;
      const a = Math.atan2(dx, dz) - m.cam.yaw;
      $('hurtDir').style.transform = `rotate(${-a}rad)`;
    }
    this.set('hd', Math.round(this.hurtD * 40), (v) => { $('hurtDir').style.opacity = v / 40; });
  }

  _tags(m) {
    const cam = m.camera, W = this.app.width, H = this.app.height;
    for (const e of m.ents.values()) {
      if (e === m.local) continue;
      let t = this.tags.get(e.n);
      if (!t) {
        t = el('div', 'ntag' + (e.dummy ? ' dummy' : ''));
        t.innerHTML = `<b></b><div class="hb"><i></i></div>`;
        t.querySelector('b').textContent = e.name;
        $('tags').appendChild(t);
        t._fill = t.querySelector('.hb i'); t._vis = null; t._hp = -1;
        this.tags.set(e.n, t);
      }
      let vis = e.alive && e.view.root.visible;
      if (vis) {
        proj.set(e.pos.x, e.pos.y + 2.05, e.pos.z);
        const d = proj.distanceTo(cam.position);
        proj.project(cam);
        vis = proj.z < 1 && d < 48 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
        if (vis) {
          // occlusion check, ~8 Hz per tag (raycasts are the costliest HUD work on slow CPUs)
          const now = performance.now();
          if (!t._occT || now - t._occT > 120) {
            t._occT = now;
            const c = cam.position;
            const dx = e.pos.x - c.x, dy = e.pos.y + 1.6 - c.y, dz = e.pos.z - c.z, l = Math.hypot(dx, dy, dz);
            t._occ = m.world.raycast(c.x, c.y, c.z, dx / l, dy / l, dz / l, l - 0.5, 0) !== Infinity;
          }
          vis = !t._occ;
        }
        if (vis) {
          // transform-only updates stay on the compositor (no layout per frame)
          t.style.transform = `translate3d(${(((proj.x + 1) / 2) * W).toFixed(1)}px, ${(((1 - proj.y) / 2) * H).toFixed(1)}px, 0) translate(-50%, -100%)`;
          const hp = Math.round(e.hp);
          if (t._hp !== hp) { t._hp = hp; t._fill.style.width = `${(hp / BAL.hp) * 100}%`; }
        }
      }
      if (t._vis !== vis) { t._vis = vis; t.style.display = vis ? '' : 'none'; }
      // off-screen enemy indicator: a red arrow on the screen edge pointing at them (+ distance)
      let off = false;
      if (e.alive && e.view.root.visible && m.local.alive) {
        cv.set(e.pos.x, e.pos.y + 1.2, e.pos.z);
        const d = cv.distanceTo(cam.position);
        cv.applyMatrix4(cam.matrixWorldInverse); // camera space: x right, y up, -z forward
        const inFront = cv.z < 0;
        let sx = 0, sy = 0;
        if (inFront) { proj.set(e.pos.x, e.pos.y + 1.2, e.pos.z).project(cam); sx = proj.x; sy = proj.y; }
        off = d < 90 && (!inFront || Math.abs(sx) > 0.96 || Math.abs(sy) > 0.94);
        if (off) {
          if (!t._arrow) { t._arrow = el('div', 'enemy-arrow'); t._arrow.innerHTML = '<i></i><span></span>'; $('tags').appendChild(t._arrow); t._ad = t._arrow.querySelector('span'); }
          const a = Math.atan2(cv.x, cv.y * (inFront ? 1 : -1) + (inFront ? 0 : 0.0001));
          const x = W / 2 + Math.sin(a) * W * 0.44, y = H / 2 - Math.cos(a) * H * (Math.cos(a) < 0 ? 0.3 : 0.4); // stays above the ability bar
          t._arrow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
          t._arrow.firstChild.style.transform = `rotate(${a.toFixed(3)}rad)`;
          const dm = Math.round(d);
          if (t._dm !== dm) { t._dm = dm; t._ad.textContent = `${dm}m`; }
        }
      }
      if (t._arrow && t._off !== off) { t._off = off; t._arrow.style.display = off ? 'block' : 'none'; }
    }
  }

  damageNumber(pos, dmg, head) {
    const d = el('div', 'dnum' + (head ? ' head' : ''), String(dmg));
    $('dmgNums').appendChild(d);
    this.nums.push({ d, p: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.4, pos.y + 0.2, pos.z + (Math.random() - 0.5) * 0.4), t: 0 });
    if (this.nums.length > 24) { const o = this.nums.shift(); o.d.remove(); }
  }
  _nums(dt, m) {
    const W = this.app.width, H = this.app.height;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t += dt;
      if (n.t > 0.9) { n.d.remove(); this.nums.splice(i, 1); continue; }
      proj.copy(n.p); proj.y += n.t * 1.2;
      proj.project(m.camera);
      if (proj.z > 1) { n.d.style.display = 'none'; continue; }
      n.d.style.display = '';
      n.d.style.transform = `translate3d(${(((proj.x + 1) / 2) * W).toFixed(1)}px, ${(((1 - proj.y) / 2) * H).toFixed(1)}px, 0) translate(-50%, -50%)`;
      n.d.style.opacity = String(Math.min(1, (0.9 - n.t) * 3));
    }
  }

  hitMarker(head) {
    const h = $('hitmark');
    h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
    h.classList.toggle('head', !!head);
  }

  hurt(amount, from) {
    this.hurtV = Math.min(1, (this.hurtV || 0) + amount / 50);
    if (from && from !== this.match.local) { this.hurtFrom = from.pos.clone(); this.hurtD = 1; }
  }

  denied(id) { const a = this.ab[id]; if (!a) return; a.d.classList.remove('deny'); void a.d.offsetWidth; a.d.classList.add('deny'); }
  flashUlt() {
    const k = this.match && this.match.kit, u = k && k.def.abilities.find((a) => a.ult);
    this.banner(((u && u.name) || 'ULTIMATE').toUpperCase().replace(/^CALAMITY: /, '') + ' READY', this.app.input.mode === 'touch' ? 'TAP X' : 'PRESS X', 1.6);
  }

  banner(t1, t2 = '', secs = 2, cls = '') {
    const b = $('banner');
    b.innerHTML = '';
    b.appendChild(el('div', 'b1 ' + cls, t1));
    if (t2) b.appendChild(el('div', 'b2', t2));
    b.classList.add('on');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.remove('on'), secs * 1000);
  }

  killFeed(k, v, ab, me) {
    const f = el('div', 'kf' + (k === me || v === me ? ' me' : ''));
    if (k && k !== v) f.appendChild(el('span', 'k', k.name));
    const ic = el('span'); ic.innerHTML = ABILITY_ICON[ab] || ICONS.skull; f.appendChild(ic);
    f.appendChild(el('span', 'v', v ? v.name : '?'));
    const feed = $('killfeed');
    feed.appendChild(f);
    while (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => f.classList.add('out'), 5000);
    setTimeout(() => f.remove(), 5600);
  }

  killBanner(v, kills) { this.banner('ELIMINATED', `${v.name.toUpperCase()} · ${kills} KILL${kills === 1 ? '' : 'S'}`, 1.8, 'kill'); }

  // livesLeft: duels only (-1 otherwise)
  deathScreen(k, ab, rt, livesLeft = -1) {
    $('dsBy').innerHTML = '';
    if (k && k !== this.match.local) { $('dsBy').append('by '); const b = el('b', '', k.name); $('dsBy').appendChild(b); }
    const out = livesLeft === 0;
    this.deathAt = out ? 0 : performance.now() / 1000 + (rt || 3);
    const t = document.querySelector('#deathScreen .ds-timer');
    if (out) t.innerHTML = 'OUT OF LIVES';
    else t.innerHTML = `${livesLeft > 0 ? `<span class="ds-lives">${'♥'.repeat(livesLeft)}</span> ${livesLeft} ${livesLeft === 1 ? 'LIFE' : 'LIVES'} LEFT · ` : ''}RESPAWN IN <b id="dsTimer">${Math.ceil(rt || 3)}</b>`;
    show('deathScreen', true);
  }
  respawned() { show('deathScreen', false); this.deathAt = 0; }

  // matchmaking lobby bar (shown while the queue is still filling); q = null hides it
  queueState(q) {
    let el = document.getElementById('queueBar');
    if (!el) { el = document.createElement('div'); el.id = 'queueBar'; el.innerHTML = '<b>FINDING PLAYERS</b><span class="qn"></span><span class="qt"></span><i>Warm up while the lobby fills · Esc to leave the queue</i>'; document.getElementById('hud').appendChild(el); }
    this.q = q && q.searching ? q : null;
    el.classList.toggle('on', !!this.q);
    if (this.q) el.querySelector('b').textContent = (q.size || 8) <= 2 ? 'FINDING OPPONENT' : 'FINDING PLAYERS';
    if (this.q) el.querySelector('.qn').textContent = `${q.found || 1} / ${q.size || 8}`;
    show('topCenter', !this.q && this.match && this.board);
  }

  phase(p, tl) {
    if (p === 'queue') { this.banner('QUEUE LOBBY', 'ROAM AND WARM UP WHILE PLAYERS JOIN', 2.4); return; }
    if (p === 'warmup') this.banner('GET READY', `MATCH STARTS IN ${Math.ceil(tl)}`, Math.max(1, tl - 0.3));
    const m = this.match;
    if (p === 'live' && m && m.cfg.mode !== 'practice') {
      if (m.mode.quickplay) this.banner('FREE-FOR-ALL', 'QUICKPLAY · DROP IN AND FIGHT', 1.8);
      else if (m.mode.lives) this.banner('DUEL', `${m.mode.lives} LIVES EACH · LAST MAGE STANDING`, 1.8);
      else this.banner('FIGHT', m.killsToWin ? `FIRST TO ${m.killsToWin} KILLS` : '', 1.6);
    }
  }

  novaWarning(c, radius, mine) {
    const me = this.match && this.match.local;
    if (mine) this.banner('CRIMSON NOVA', 'CHANTING…', 2.2);
    else if (me && Math.hypot(me.pos.x - c.x, me.pos.z - c.z) < radius + 8) this.banner('CRIMSON NOVA INCOMING', 'GET OUT OF THE CIRCLE!', 2.2, 'kill');
  }

  // ---------------------------------------------------------------- cutscene (Crimson Nova)
  cineStart(tag = 'CRIMSON NOVA', theme = '') {
    if (!this.cineEl) {
      const c = document.createElement('div'); c.id = 'cine';
      c.innerHTML = '<div class="cine-dark"></div><div class="cine-bar top"></div><div class="cine-bar bot"></div><div class="cine-sub"></div><div class="cine-tag">CRIMSON NOVA</div>';
      document.body.appendChild(c);
      this.cineEl = c;
    }
    this.cineEl.className = 'on' + (theme ? ' ' + theme : '');
    this.cineEl.querySelector('.cine-tag').textContent = tag;
    this.cineEl.querySelector('.cine-sub').textContent = '';
    document.body.classList.add('cine-on');
  }
  cineSub(text, big) {
    if (!this.cineEl) return;
    const el = this.cineEl.querySelector('.cine-sub');
    el.classList.remove('show', 'big');
    void el.offsetWidth;
    el.textContent = text;
    if (text) el.classList.add('show');
    if (big) el.classList.add('big');
  }
  // monologue line: a quiet serif typewriter at the bottom of the frame (theme: 'mono' | 'void');
  // big = a single word slammed huge in the middle. '' clears it.
  cineMono(text, theme = 'mono', big = false) {
    const e = this._cineLayer('cineMono');
    clearTimeout(this._monoT);
    if (!text) { e.classList.remove('show'); return; }
    e.className = theme + (big ? ' big' : '');
    const esc = (c) => (c === ' ' ? ' ' : c.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x])));
    const per = big ? 0.06 : Math.min(0.034, 1.1 / Math.max(1, text.length));
    // letters animate one by one, but each word stays whole when the line wraps
    let i = 0;
    e.innerHTML = '<p>' + text.split(' ').map((w) => '<em>' + [...w].map((c) => `<span style="animation-delay:${(i++ * per).toFixed(3)}s">${esc(c)}</span>`).join('') + '</em>').join(`<span style="animation-delay:${(i * per).toFixed(3)}s"> </span>`) + '</p>';
    void e.offsetWidth; e.classList.add('show');
  }
  // a step caption, top-left (what is happening, in plain words); '' hides it
  cineStep(text, n = '', sub = '') {
    const e = this._cineLayer('cineStep');
    if (!text) { e.classList.remove('show'); return; }
    e.innerHTML = `${n ? `<i>${n}</i>` : ''}<b>${text}${sub ? `<small>${sub}</small>` : ''}</b>`;
    e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  }
  cineDark(k) { if (this.cineEl) this.cineEl.querySelector('.cine-dark').style.opacity = String(k * 0.55); }
  // anime "impact frames": a few stark, high-contrast negative frames with radial speed lines
  // right as the spell lands, then cb() (the white flash)
  impactFrames(cb) {
    const cv = document.getElementById('game');
    let lines = document.getElementById('impactLines');
    if (!lines) { lines = document.createElement('div'); lines.id = 'impactLines'; document.body.appendChild(lines); }
    const frames = [
      ['grayscale(1) contrast(9) invert(1)', 1, 70],
      ['grayscale(1) contrast(9) sepia(1) saturate(12) hue-rotate(-38deg) brightness(0.9)', 1, 70],
      ['grayscale(1) contrast(9)', 1, 60],
      ['grayscale(1) contrast(9) invert(1)', 0.6, 60],
      ['', 0, 0],
    ];
    let i = 0;
    const step = () => {
      const [flt, ln, ms] = frames[i++];
      cv.style.filter = flt;
      lines.style.opacity = String(ln);
      lines.classList.toggle('inv', i % 2 === 0);
      if (ms) setTimeout(step, ms); else if (cb) cb();
    };
    step();
  }

  // dash impact frames: two quick frames of radial speed lines + a contrast pop (~0.1 s)
  dashImpact() {
    if (this._dashT && performance.now() - this._dashT < 160) return;
    this._dashT = performance.now();
    const cv = document.getElementById('game');
    let lines = document.getElementById('impactLines');
    if (!lines) { lines = document.createElement('div'); lines.id = 'impactLines'; document.body.appendChild(lines); }
    lines.classList.add('dash');
    const frames = [['contrast(1.45) saturate(1.35) brightness(1.18)', 0.85, 45], ['contrast(1.2) saturate(1.15)', 0.45, 45], ['', 0, 0]];
    let i = 0;
    const step = () => {
      const [flt, ln, ms] = frames[i++];
      if (!document.body.classList.contains('cine-on')) cv.style.filter = flt;
      lines.style.opacity = String(ln);
      if (ms) setTimeout(step, ms); else lines.classList.remove('dash');
    };
    step();
  }

  // ---- Nova cutscene motion graphics -------------------------------------------------------
  _cineLayer(id, html) {
    let e = document.getElementById(id);
    if (!e) { e = document.createElement('div'); e.id = id; if (html) e.innerHTML = html; document.body.appendChild(e); }
    return e;
  }
  // title card: red brush slashes sweep in, the title snaps into place, then everything slices away
  cineCard(title, sub, theme = '') {
    const e = this._cineLayer('cineCard');
    e.className = theme;
    e.innerHTML = `<i class="sl a"></i><i class="sl b"></i><div class="ct"><b>${title}</b><span>${sub}</span></div>`;
    void e.offsetWidth; e.classList.add('go');
    clearTimeout(this._cardT); this._cardT = setTimeout(() => e.classList.remove('go'), 1900);
  }
  // diagonal slash wipe between shots (the cut happens under the blade)
  cineWipe(red = false) {
    const e = this._cineLayer('cineWipe');
    e.classList.toggle('red', red);
    e.classList.remove('go'); void e.offsetWidth; e.classList.add('go');
  }
  // colour grade of the whole frame: '', 'warm', 'cold', 'burn'
  cineGrade(g) {
    document.body.classList.remove('grade-warm', 'grade-cold', 'grade-burn', 'grade-void', 'grade-mono');
    if (g) document.body.classList.add('grade-' + g);
  }
  // a huge rotating magic circle drawn over the frame while she chants (0..1)
  cineGlyph(k) {
    const e = this._cineLayer('cineGlyph', `<svg viewBox="-100 -100 200 200">
      <circle r="92" fill="none" stroke="#ff5a3a" stroke-width="1.2"/><circle r="84" fill="none" stroke="#ffb15a" stroke-width="0.5" stroke-dasharray="2 3"/>
      <circle r="60" fill="none" stroke="#ff5a3a" stroke-width="0.8"/>
      <polygon points="0,-84 72.7,42 -72.7,42" fill="none" stroke="#ffcf7a" stroke-width="0.7"/><polygon points="0,84 72.7,-42 -72.7,-42" fill="none" stroke="#ffcf7a" stroke-width="0.7"/>
      <g class="ticks">${Array.from({ length: 48 }, (_, i) => `<line x1="0" y1="-92" x2="0" y2="${i % 4 ? -88 : -80}" transform="rotate(${i * 7.5})" stroke="#ffb15a" stroke-width="0.6"/>`).join('')}</g></svg>`);
    e.style.opacity = String(Math.max(0, Math.min(1, k)) * 0.55);
  }

  // Unlimited Void: infinite information pouring into the mind — strobing white streaks, the
  // frame bleaching out and snapping back (k 0..1, 0 hides)
  overload(k) {
    const e = this._cineLayer('overload');
    e.style.opacity = String(Math.max(0, Math.min(1, k)));
    if (k > 0 && !this._ovT) {
      const tick = () => {
        if (parseFloat(e.style.opacity) <= 0) { this._ovT = 0; return; }
        let h = '';
        for (let i = 0; i < 26; i++) {
          const y = Math.random() * 100, w = 10 + Math.random() * 70, x = Math.random() * (100 - w);
          h += `<i style="top:${y}%;left:${x}%;width:${w}%;opacity:${0.3 + Math.random() * 0.7}"></i>`;
        }
        e.innerHTML = h;
        this._ovT = setTimeout(tick, 45);
      };
      tick();
    }
  }

  cineEnd() { if (this.cineEl) this.cineEl.className = ''; document.body.classList.remove('cine-on'); this.cineGrade(''); this.cineGlyph(0); this.cineMono(''); this.cineStep(''); }

  // full-screen white flash (nova); 0..1
  flash(k) {
    const f = $('flash');
    if (!f || k <= 0) return;
    f.style.transition = 'none'; f.style.opacity = String(k);
    void f.offsetWidth;
    f.style.transition = 'opacity 1.6s ease-out'; f.style.opacity = '0';
  }

  meteorWarning(c) {
    const me = this.match && this.match.local;
    if (me && Math.hypot(me.pos.x - c.x, me.pos.z - c.z) < 9) this.banner('INCOMING METEOR', 'MOVE!', 1.2, 'kill');
  }

  renderBoard() {
    const m = this.match;
    if (!m) return;
    const sb = $('scoreboard');
    const rows = [...m.ents.values()].filter((e) => !e.dummy && !e.left).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    sb.innerHTML = `<div class="sb-title">SCOREBOARD <span>${m.mode.label} · SUNVALE</span></div><div class="sb-row head"><span>#</span><span>PLAYER</span><span>KILLS</span><span>${m.mode.lives ? 'LIVES' : 'DEATHS'}</span><span>DAMAGE</span></div>`;
    rows.forEach((e, i) => {
      const r = el('div', 'sb-row' + (e === m.local ? ' me' : ''));
      r.appendChild(el('span', 'pl', String(i + 1)));
      const nm = el('b', '', e.name); nm.appendChild(el('span', 'muted', e.tag ? ` #${e.tag}` : ''));
      r.appendChild(nm);
      r.appendChild(el('span', '', String(e.kills))); r.appendChild(el('span', '', String(m.mode.lives ? Math.max(0, m.mode.lives - (m.phase === 'live' ? e.deaths : 0)) : e.deaths))); r.appendChild(el('span', '', String(e.dmg)));
      sb.appendChild(r);
    });
  }

  endScreen(msg, m) {
    show('deathScreen', false); show('scoreboard', false);
    const es = $('endScreen');
    const idx = msg.l.findIndex((r) => r[0] === m.local.n);
    const place = idx + 1;
    const suf = place === 1 ? 'ST' : place === 2 ? 'ND' : place === 3 ? 'RD' : 'TH';
    es.innerHTML = '';
    es.appendChild(el('div', 'end-place' + (place === 1 ? ' win' : ''), place === 1 ? 'VICTORY' : m.mode.lives ? 'DEFEAT' : `${place}${suf} PLACE`));
    es.appendChild(el('div', 'end-sub', `${m.mode.label} · ${msg.l.length} PLAYERS`));
    const head = el('div', 'sb-row head'); head.innerHTML = `<span>#</span><span>PLAYER</span><span>KILLS</span><span>${m.mode.lives ? 'LIVES' : 'DEATHS'}</span><span>DAMAGE</span>`; es.appendChild(head);
    msg.l.forEach((r, i) => {
      const e = m.ents.get(r[0]);
      const row = el('div', 'sb-row' + (e === m.local ? ' me' : ''));
      row.appendChild(el('span', 'pl', String(i + 1)));
      row.appendChild(el('b', '', e ? e.name : '?'));
      row.appendChild(el('span', '', String(r[1]))); row.appendChild(el('span', '', String(m.mode.lives ? Math.max(0, m.mode.lives - r[2]) : r[2]))); row.appendChild(el('span', '', String(r[3])));
      es.appendChild(row);
    });
    es.appendChild(el('div', 'end-foot', 'RETURNING TO LOBBY…'));
    show('endScreen', true);
    this.app.recordMatch({ place, players: msg.l.length, kills: idx >= 0 ? msg.l[idx][1] : 0, deaths: idx >= 0 ? msg.l[idx][2] : 0, dmg: idx >= 0 ? msg.l[idx][3] : 0, mode: m.mode.label, t: Date.now() });
  }
}
