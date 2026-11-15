import * as THREE from 'three';
import { $, el, show } from './dom.js';
import { ABILITY_ICON, ICONS } from './icons.js';
import { ULT_COST, MOVE } from '../config.js';
import { BAL } from '../game/balance.js';

// In-match HUD: health, ability bar with cooldown sweeps, timer/score, kill feed, name tags,
// damage numbers, hit markers, damage direction, death/scoreboard/end screens.
// DOM writes only happen when a displayed value changes.

const proj = new THREE.Vector3();
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class Hud {
  constructor(app) {
    this.app = app;
    this.root = $('hud');
    this.cache = {};
    this.tags = new Map();
    this.nums = [];
    this.sbOpen = false;
    app.input.on('scoreboard', (on) => { this.sbOpen = on; if (this.match) this.renderBoard(); show('scoreboard', on && !!this.match && !this.match.ended); });
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
      if (id === 'dash') { pips = el('div', 'pips'); for (let i = 0; i < MOVE.dashCharges; i++) pips.appendChild(el('i')); d.appendChild(pips); }
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
    show('topCenter', m.cfg.mode !== 'practice');
    $('tcGoal').textContent = m.killsToWin ? `FIRST TO ${m.killsToWin}` : 'NO KILL LIMIT';
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
      $('hpNum').parentElement.classList.toggle('low', v <= 50);
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
      const rem = b.dashCharges < MOVE.dashCharges ? 1 - b.dashRecharge / MOVE.dashRecharge : 0;
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
    // top center
    if (m.cfg.mode !== 'practice') {
      const t = m.phase === 'warmup' ? m.timeLeft : m.timeLeft;
      this.set('time', fmtTime(t), (v) => { $('tcTime').textContent = v; });
      this.set('meK', me.kills, (v) => { $('tcMe').textContent = v; });
      let lead = null;
      for (const e of m.ents.values()) if (!e.dummy && e !== me && !e.left && (!lead || e.kills > lead.kills)) lead = e;
      this.set('lead', lead ? `${lead.name}|${lead.kills}` : '-', () => { $('tcLeadName').textContent = lead ? lead.name.toUpperCase() : 'NO RIVALS'; $('tcLead').textContent = lead ? lead.kills : '-'; });
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
          // occlusion check (cheap: world only)
          const c = cam.position;
          const dx = e.pos.x - c.x, dy = e.pos.y + 1.6 - c.y, dz = e.pos.z - c.z, l = Math.hypot(dx, dy, dz);
          const hit = m.world.raycast(c.x, c.y, c.z, dx / l, dy / l, dz / l, l - 0.5, 0);
          vis = hit === Infinity;
        }
        if (vis) {
          t.style.left = `${((proj.x + 1) / 2) * W}px`; t.style.top = `${((1 - proj.y) / 2) * H}px`;
          const hp = Math.round(e.hp);
          if (t._hp !== hp) { t._hp = hp; t._fill.style.width = `${(hp / BAL.hp) * 100}%`; }
        }
      }
      if (t._vis !== vis) { t._vis = vis; t.style.display = vis ? '' : 'none'; }
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
      n.d.style.left = `${((proj.x + 1) / 2) * W}px`; n.d.style.top = `${((1 - proj.y) / 2) * H}px`;
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
  flashUlt() { this.banner('METEOR READY', 'PRESS X', 1.6); }

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

  deathScreen(k, ab, rt) {
    $('dsBy').innerHTML = '';
    if (k && k !== this.match.local) { $('dsBy').append('by '); const b = el('b', '', k.name); $('dsBy').appendChild(b); }
    this.deathAt = performance.now() / 1000 + (rt || 3);
    show('deathScreen', true);
  }
  respawned() { show('deathScreen', false); this.deathAt = 0; }

  phase(p, tl) {
    if (p === 'warmup') this.banner('GET READY', `MATCH STARTS IN ${Math.ceil(tl)}`, Math.max(1, tl - 0.3));
    if (p === 'live' && this.match && this.match.cfg.mode !== 'practice') this.banner('FIGHT', this.match.killsToWin ? `FIRST TO ${this.match.killsToWin} KILLS` : '', 1.6);
  }

  novaWarning(c, radius, mine) {
    const me = this.match && this.match.local;
    if (mine) this.banner('CRIMSON NOVA', 'CHANTING…', 2.2);
    else if (me && Math.hypot(me.pos.x - c.x, me.pos.z - c.z) < radius + 8) this.banner('CRIMSON NOVA INCOMING', 'GET OUT OF THE CIRCLE!', 2.2, 'kill');
  }

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
    sb.innerHTML = `<div class="sb-title">SCOREBOARD <span>${m.mode.label} · SUNVALE</span></div><div class="sb-row head"><span>#</span><span>PLAYER</span><span>KILLS</span><span>DEATHS</span><span>DAMAGE</span></div>`;
    rows.forEach((e, i) => {
      const r = el('div', 'sb-row' + (e === m.local ? ' me' : ''));
      r.appendChild(el('span', 'pl', String(i + 1)));
      const nm = el('b', '', e.name); nm.appendChild(el('span', 'muted', e.tag ? ` #${e.tag}` : ''));
      r.appendChild(nm);
      r.appendChild(el('span', '', String(e.kills))); r.appendChild(el('span', '', String(e.deaths))); r.appendChild(el('span', '', String(e.dmg)));
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
    es.appendChild(el('div', 'end-place' + (place === 1 ? ' win' : ''), place === 1 ? 'VICTORY' : `${place}${suf} PLACE`));
    es.appendChild(el('div', 'end-sub', `${m.mode.label} · ${msg.l.length} PLAYERS`));
    const head = el('div', 'sb-row head'); head.innerHTML = '<span>#</span><span>PLAYER</span><span>KILLS</span><span>DEATHS</span><span>DAMAGE</span>'; es.appendChild(head);
    msg.l.forEach((r, i) => {
      const e = m.ents.get(r[0]);
      const row = el('div', 'sb-row' + (e === m.local ? ' me' : ''));
      row.appendChild(el('span', 'pl', String(i + 1)));
      row.appendChild(el('b', '', e ? e.name : '?'));
      row.appendChild(el('span', '', String(r[1]))); row.appendChild(el('span', '', String(r[2]))); row.appendChild(el('span', '', String(r[3])));
      es.appendChild(row);
    });
    es.appendChild(el('div', 'end-foot', 'RETURNING TO LOBBY…'));
    show('endScreen', true);
    this.app.recordMatch({ place, players: msg.l.length, kills: idx >= 0 ? msg.l[idx][1] : 0, deaths: idx >= 0 ? msg.l[idx][2] : 0, dmg: idx >= 0 ? msg.l[idx][3] : 0, mode: m.mode.label, t: Date.now() });
  }
}
