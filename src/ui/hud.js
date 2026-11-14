import { $, el, show, toast } from './dom.js';
import { WEAPONS } from '../weapons/weaponDefs.js';
import { MODES } from '../config.js';

// In-match HUD. All DOM writes are diffed against the previous value so a frame where
// nothing changed touches the DOM zero times (layout/style recalcs are expensive on Chromebooks).
const ICONS = {
  1: '<svg viewBox="0 0 64 20"><path d="M2 8h30l3-3h20v3h7v3h-7v2h-9l-2 6h-5l1-6h-6l-4 4h-6l2-4H2z"/></svg>',
  2: '<svg viewBox="0 0 34 20"><path d="M2 3h28v6H14l-2 9H5l2-9H2z"/></svg>',
  3: '<svg viewBox="0 0 80 20"><path d="M2 9h18l2-3h14V3h14v3h4v3h24v2H54v2H40l-4 5h-6l2-5H18l-4 4H6l2-4H2z"/></svg>',
};
const HS_ICON = '<svg class="hs" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="none" stroke="#ff4655" stroke-width="2"/><circle cx="10" cy="10" r="2" fill="#ff4655"/><path d="M10 1v4M10 15v4M1 10h4M15 10h4" stroke="#ff4655" stroke-width="2"/></svg>';

export class Hud {
  constructor(app) {
    this.app = app;
    this.c = {}; // cache
    this.e = {
      hud: $('hud'), hp: $('hp'), hpbar: $('hpbar').firstElementChild, hpbox: $('hpbox'), ammo: $('ammo'), wname: $('wname'),
      spd: $('spd'), speedo: $('speedo'), scA: $('scA'), scB: $('scB'), tmr: $('tmr'), phase: $('phaseLbl'), kf: $('killfeed'),
      xh: $('crosshair'), hit: $('hitmark'), dmg: $('dmgind'), vig: $('vignette'), scope: $('scope'), zoom: $('zoomLbl'),
      c1: $('c1'), c2: $('c2'), center: $('center'), dead: $('dead'), deadBy: $('deadBy'), deadSub: $('deadSub'),
      interact: $('interact'), range: $('rangePanel'), board: $('board'), buy: $('buy'), results: $('results'), net: $('netinfo'),
      slots: $('slots'), tags: $('tags'),
    };
    this.xhParts = [...this.e.xh.children];
    this.hitT = 0; this.dmgT = 0; this.centerT = 0; this.boardOn = false;
    this.fps = 0; this.fpsAcc = 0; this.fpsN = 0;
    app.input.on('scoreboard', (on) => { this.boardOn = on; show(this.e.board, on && !!this.match); });
    this.e.buy.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-slot]');
      if (b && this.match) this.match.buy(+b.dataset.slot);
      else if (ev.target.closest('[data-close]') && this.match) this.match.closeBuy();
    });
  }

  set(key, elx, prop, v) { if (this.c[key] === v) return; this.c[key] = v; elx[prop] = v; }

  enterMatch(m) {
    this.match = m; this.c = {};
    show(this.e.hud, true); show(this.e.results, false); show(this.e.dead, false); show(this.e.board, false); show(this.e.buy, false);
    show(this.e.range, !!m.map.buttons); show(this.e.scope, false);
    this.e.kf.textContent = '';
    this.e.c1.textContent = ''; this.e.c2.textContent = '';
    const M = m.mode;
    this.e.scA.parentElement.classList.toggle('hidden', !!m.map.buttons);
    if (m.map.buttons) this.range({ mode: 'static', run: false, k: 0, hs: 0, tot: 50, time: 0 }, 0, 0);
    this.center(m.map.buttons ? 'THE RANGE' : M.label, m.map.buttons ? 'Shoot or press E on the console buttons' : 'Good luck', 2.5);
    this.setHP(100);
    this.e.xh.style.setProperty('--xh', this.app.settings.crosshairColor);
  }

  exitMatch() { this.match = null; show(this.e.hud, false); show(this.e.board, false); show(this.e.buy, false); this.e.tags.textContent = ''; }

  toast(msg, ms) { toast(msg, ms); }

  setHP(v) {
    v = Math.max(0, Math.round(v));
    this.set('hp', this.e.hp, 'textContent', String(v));
    this.e.hpbar.style.width = `${v}%`;
    this.e.hpbox.classList.toggle('low', v <= 30);
  }

  setDead(att, sub = '') {
    if (!att) { show(this.e.dead, false); return; }
    this.e.deadBy.textContent = `${att.name}${att.tag ? '#' + att.tag : ''}`;
    this.e.deadSub.textContent = sub;
    show(this.e.dead, true);
  }

  center(t1, t2, secs = 2, color = '') {
    this.e.c1.textContent = t1; this.e.c2.textContent = t2;
    this.e.c1.style.color = color;
    this.e.center.style.opacity = '1';
    this.centerT = secs;
  }

  killfeed(a, v, w, hs, mine) {
    const m = this.match; if (!m) return;
    const row = el('div', `kf${mine ? ' me' : ''}`);
    const an = el('span', 'a', a ? a.name : '?');
    if (a && m.isEnemy(a) && !a.practice) an.classList.add('enemy');
    const vn = el('span', 'v', v.name);
    if (!m.isEnemy(v)) vn.classList.add('ally');
    row.appendChild(an);
    const ic = el('span'); ic.innerHTML = ICONS[w] || ICONS[1]; row.appendChild(ic);
    if (hs) { const h = el('span'); h.innerHTML = HS_ICON; row.appendChild(h); }
    row.appendChild(vn);
    this.e.kf.appendChild(row);
    while (this.e.kf.children.length > 6) this.e.kf.firstChild.remove();
    setTimeout(() => { row.style.opacity = '0'; setTimeout(() => row.remove(), 600); }, 5500);
  }

  hitmarker(head, blocked, kill) {
    const h = this.e.hit;
    h.className = blocked ? '' : kill ? 'kill' : head ? 'hs' : '';
    h.style.opacity = blocked ? '0.35' : '1';
    this.hitT = kill ? 0.35 : 0.18;
  }

  damageFrom(angle) {
    this.e.dmg.style.transform = `rotate(${-angle}rad)`;
    this.e.dmg.style.opacity = '1';
    this.e.vig.style.opacity = '0.8';
    this.dmgT = 0.8;
  }

  showBuy(on, m) {
    if (on) {
      const b = this.e.buy;
      b.innerHTML = '<div class="label">ARMORY — FREE LOADOUT</div><div class="title">BUY MENU</div>';
      const cards = el('div', 'cards');
      for (let s = 1; s <= 3; s++) {
        const w = WEAPONS[s];
        const c = el('button', 'wcard'); c.dataset.slot = s;
        c.innerHTML = `<span class="k">SLOT ${s}</span><b>${w.name}</b><span class="st">${w.mag} RDS · HEAD ${w.head} · BODY ${w.body}<br>${w.desc}</span><span class="pr">EQUIP + REFILL</span>`;
        cards.appendChild(c);
      }
      b.appendChild(cards);
      const close = el('div', 'row'); close.style.marginTop = '12px';
      close.innerHTML = '<button class="btn small ghost" data-close>CLOSE (B)</button>';
      b.appendChild(close);
      show(b, true);
      this.app.input.exitLock();
    } else {
      show(this.e.buy, false);
      if (this.match && this.app.input.mode === 'kbm' && !this.app.paused) this.app.input.requestLock();
    }
  }

  range(st, hits, shots) {
    const names = { static: 'STATIC', strafe: 'STRAFE', speed: '50-BOT SPEED TEST' };
    const hsP = st.k ? Math.round((st.hs / st.k) * 100) : 0;
    const acc = shots ? Math.round((hits / shots) * 100) : 0;
    let best = null; try { best = JSON.parse(localStorage.getItem('riftline.best50') || 'null'); } catch { /* ignore */ }
    const timeTxt = st.time ? `${st.time.toFixed(st.run ? 1 : 2)}s` : '0.0s';
    this.e.range.innerHTML = `<div class="rp-h">${names[st.mode] || st.mode} ${st.run ? '· LIVE' : '· IDLE'}</div>`
      + `<div class="rp-t">${timeTxt}</div>`
      + `<div class="rp-r"><span>KILLS</span>${st.k}${st.mode === 'speed' ? ' / ' + st.tot : ''}</div>`
      + `<div class="rp-r"><span>HEADSHOT %</span>${hsP}%</div>`
      + `<div class="rp-r"><span>ACCURACY</span>${acc}%</div>`
      + (best ? `<div class="rp-r"><span>BEST 50</span>${best.toFixed(2)}s</div>` : '')
      + `<div class="rp-hint">${st.run ? 'Shoot START to stop.' : 'Pick a drill on the console, then shoot START.'}</div>`;
  }

  results(title, sub, m) {
    this.e.c1.textContent = ''; this.e.c2.textContent = '';
    $('r1').textContent = title; $('r1').style.color = title === 'VICTORY' ? '#4fd8ff' : title === 'DEFEAT' ? '#ff4655' : '';
    $('r2').textContent = sub || 'Returning to lobby…';
    show(this.e.results, true);
    this.renderBoard(m); show(this.e.board, true);
  }

  renderBoard(m) {
    const rows = [...m.ents.values()].filter((e) => !e.practice);
    rows.sort((a, b) => (m.mode.teams ? (a.team - b.team) * 1000 : 0) + (b.kills - a.kills) || a.deaths - b.deaths);
    let html = `<div class="label" style="margin-bottom:8px">${m.mode.label} · ${m.cfg.map.toUpperCase()}${m.cfg.bhop ? ' · BHOP BOOST' : ''}${m.cfg.hsOnly ? ' · HEADSHOTS ONLY' : ''}</div><table><tr><th>PLAYER</th><th>K</th><th>D</th><th>HS%</th><th>DMG</th></tr>`;
    for (const e of rows) {
      const cls = [m.isEnemy(e) ? 'enemy' : 'ally', e === m.me ? 'me' : '', e.alive ? '' : 'dead'].join(' ');
      const hs = e.kills ? Math.round((e.hsKills / e.kills) * 100) : 0;
      const nm = `${e.name}${e.tag ? '<span style="color:#9aa5ae">#' + e.tag + '</span>' : ''}${e.bot ? ' <span style="color:#9aa5ae;font-size:11px">BOT</span>' : ''}`;
      html += `<tr class="${cls}"><td>${nm}</td><td>${e.kills}</td><td>${e.deaths}</td><td>${hs}%</td><td>${e.dmg | 0}</td></tr>`;
    }
    html += '</table>';
    if (this.c.board !== html) { this.c.board = html; this.e.board.innerHTML = html; }
  }

  frame(m, now, ups, adsE) {
    const dt = this.app.frameDt;
    // FPS meter
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    const s = this.app.settings;
    const net = `${s.showFps ? this.fps + ' FPS · ' : ''}${m.isHost ? 'HOST' + (m.net.count ? ` · ${m.net.count} PEER${m.net.count > 1 ? 'S' : ''}` : ' · LOCAL') : 'PING ' + m.ping + 'ms'}`;
    this.set('net', this.e.net, 'textContent', net);

    // ammo + weapon
    const ws = m.ws, w = ws.def, a = ws.ammo[ws.slot];
    this.set('ammo', this.e.ammo, 'innerHTML', `${a.mag}<small>/${ws.infinite ? '∞' : a.reserve}</small>`);
    const mode = ws.reloading ? 'RELOADING' : ws.inspectEnd ? 'INSPECT' : ws.slot === 3 ? (ws.zoom ? `SCOPE ${w.zooms[ws.zoom - 1]}x` : 'HIP') : `${ws.slot === 2 ? (ws.burstMode ? 'BURST' : 'SEMI') : 'AUTO'}${adsE > 0.5 ? ' · ADS' : ''}`;
    this.set('wn', this.e.wname, 'innerHTML', `<b>${w.name}</b>${mode}`);
    if (this.c.slot !== ws.slot) { this.c.slot = ws.slot; for (const d of this.e.slots.children) d.classList.toggle('on', +d.dataset.s === ws.slot); }

    // speedometer
    show(this.e.speedo, s.speedometer);
    if (s.speedometer) {
      const u = Math.round(ups);
      this.set('spd', this.e.spd, 'textContent', String(u));
      const cls = u > 600 ? 'insane' : u > 400 ? 'vfast' : u > 280 ? 'fast' : '';
      if (this.c.spdc !== cls) { this.c.spdc = cls; this.e.speedo.className = cls; }
    }

    // round / timer
    if (!m.map.buttons) {
      const tl = Math.max(0, m.phaseEndLocal - now);
      const t = `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
      this.set('tmr', this.e.tmr, 'textContent', t);
      let A, B;
      if (m.mode.teams) { A = m.score[m.me.team] || 0; B = m.score[1 - m.me.team] || 0; }
      else { A = m.me.kills; let best = 0; for (const e of m.ents.values()) if (e !== m.me && e.kills > best) best = e.kills; B = best; }
      this.set('scA', this.e.scA, 'textContent', String(A));
      this.set('scB', this.e.scB, 'textContent', String(B));
      const ph = m.mode.teams ? (m.phase === 'buy' ? 'BUY PHASE' : m.phase === 'post' ? 'ROUND OVER' : `ROUND ${m.round}`) : `FIRST TO ${MODES.ffa.killsToWin}`;
      this.set('ph', this.e.phase, 'textContent', ph);
    }

    // crosshair gap from current spread
    const spread = ws.spreadNow || 0;
    const vfov = m.camera.fov * Math.PI / 180;
    const px = Math.min(80, Math.tan(spread * Math.PI / 180) / Math.tan(vfov / 2) * (this.app.height / 2));
    const gap = Math.round(3 + px * 0.6);
    if (this.c.gap !== gap) {
      this.c.gap = gap;
      const [, l, r, u, b] = this.xhParts;
      l.style.left = `${-gap - 7}px`; r.style.left = `${gap}px`; u.style.top = `${-gap - 7}px`; b.style.top = `${gap}px`;
    }
    // crosshair fades out while aiming down sights (irons / red dot / scope take over)
    const xhO = m.me.alive ? Math.max(0, 1 - adsE / 0.35) : 0;
    const xhK = xhO.toFixed(2);
    if (this.c.xh !== xhK) { this.c.xh = xhK; this.e.xh.style.opacity = xhK; this.e.xh.style.display = xhO > 0 ? '' : 'none'; }

    // scope
    // sniper scope overlay fades in as the scope reaches the eye
    const so = ws.slot === 3 && m.me.alive ? Math.max(0, Math.min(1, (adsE - 0.82) / 0.13)) : 0;
    const soK = so.toFixed(2);
    if (this.c.scope !== soK) { this.c.scope = soK; show(this.e.scope, so > 0); this.e.scope.style.opacity = soK; }
    const zl = `${ws.zoom ? WEAPONS[3].zooms[ws.zoom - 1] : ws.lastZoom}x`;
    if (so > 0 && this.c.zl !== zl) { this.c.zl = zl; this.e.zoom.textContent = zl; }

    // transient fades
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.e.hit.style.opacity = '0'; }
    if (this.dmgT > 0) { this.dmgT -= dt; const o = Math.max(0, this.dmgT / 0.8); this.e.dmg.style.opacity = o.toFixed(2); this.e.vig.style.opacity = (o * 0.8).toFixed(2); }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) this.e.center.style.opacity = '0'; }

    // range console prompt
    if (m.map.buttons) {
      let near = false;
      const c = m.ctrl;
      for (const b of m.map.buttons) if (Math.abs(b.x - c.x) < 2.2 && Math.abs(b.z - c.z) < 2.6) near = true;
      if (this.c.ip !== near) { this.c.ip = near; show(this.e.interact, near && this.app.input.mode === 'kbm'); }
    }

    if (this.boardOn) this.renderBoard(m);
    this._tags(m);
  }

  // teammate name tags (projected; only allies, updated at most every other frame)
  _tags(m) {
    if (!m.mode.teams || m.map.buttons) return;
    this._tagFlip = !this._tagFlip; if (this._tagFlip) return;
    const cam = m.camera;
    let i = 0;
    for (const e of m.entList) {
      if (e === m.me || !e.alive || m.isEnemy(e)) continue;
      let tag = this.e.tags.children[i];
      if (!tag) { tag = el('div', 'ptag'); this.e.tags.appendChild(tag); }
      i++;
      const p = this._proj || (this._proj = new cam.position.constructor());
      p.set(e.rx, e.ry + 2.05, e.rz).project(cam);
      if (p.z > 1 || p.z < -1) { tag.style.display = 'none'; continue; }
      tag.style.display = '';
      if (tag._n !== e.name) { tag._n = e.name; tag.textContent = e.name; }
      tag.style.transform = `translate(${((p.x + 1) / 2 * this.app.width) | 0}px, ${((1 - p.y) / 2 * this.app.height) | 0}px) translate(-50%, -100%)`;
    }
    while (this.e.tags.children.length > i) this.e.tags.lastChild.remove();
  }
}
