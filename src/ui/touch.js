import { el, show } from './dom.js';
import { ABILITY_ICON } from './icons.js';
import { MOVE } from '../config.js';

// Mobile controls: a floating joystick on the left half, drag-to-look on the right half, and an
// ability cluster (fire, jump, dash, abilities, ultimate, focus aim). Dragging from the fire
// button also aims, like most mobile shooters. Writes into Input.touch / Input.pressed.

export class TouchControls {
  constructor(app) {
    this.app = app;
    this.input = app.input;
    this.root = el('div', 'touch-ui hidden');
    this.root.id = 'touchUI';
    document.body.appendChild(this.root);
    this.stick = el('div', 'tstick hidden'); this.knob = el('div', 'tknob'); this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);
    this.lookZone = el('div', 'tlook'); this.moveZone = el('div', 'tmove');
    this.root.appendChild(this.moveZone); this.root.appendChild(this.lookZone);
    this.btns = el('div', 'tbtns'); this.root.appendChild(this.btns);
    this.top = el('div', 'ttop'); this.root.appendChild(this.top);
    this.movePtr = null; this.lookPtrs = new Map();
    this._bindZones();
    this.active = false;
    this.cd = {};
  }

  setActive(on) { this.active = on; show(this.root, on); if (!on) this.reset(); }
  reset() { const t = this.input.touch; t.fwd = t.side = 0; t.fire = false; this.movePtr = null; this.lookPtrs.clear(); show(this.stick, false); }

  build(kit) {
    this.btns.textContent = ''; this.cd = {};
    const mk = (cls, html, label, onDown, onUp, look) => {
      const b = el('div', 'tbtn ' + cls);
      b.innerHTML = html;
      if (label) b.appendChild(el('span', 'tlbl', label));
      const cdv = el('div', 'tcd hidden'); b.appendChild(cdv);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.setPointerCapture(e.pointerId); b.classList.add('down');
        onDown && onDown();
        if (look) this.lookPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      });
      const up = (e) => { b.classList.remove('down'); onUp && onUp(); this.lookPtrs.delete(e.pointerId); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      b.addEventListener('pointermove', (e) => { if (look) this._look(e); });
      this.btns.appendChild(b);
      return { b, cdv };
    };
    const t = this.input.touch, pr = this.input.pressed;
    const fireIcon = ABILITY_ICON[kit.def.abilities[0].id];
    mk('fire', fireIcon, '', () => { t.fire = true; pr.fire = true; }, () => { t.fire = false; }, true);
    mk('jump', '<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v8H9v-8H5z"/></svg>', 'JUMP', () => { pr.jump = true; t.jump = true; }, () => { t.jump = false; });
    this.cd.dash = mk('dash', ABILITY_ICON.dash, 'Q', () => { pr.dash = true; });
    const keyOf = { E: 'e', C: 'c', V: 'v', X: 'x' };
    for (const [id, key] of kit.slots()) {
      const isUlt = key === 'X';
      this.cd[id] = mk('ab ab-' + key.toLowerCase() + (isUlt ? ' ult' : ''), ABILITY_ICON[id] || '', key, () => { pr[keyOf[key]] = true; });
    }
    mk('aim', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2"/></svg>', 'AIM', () => { t.aim = !t.aim; });
    this.top.textContent = '';
    const tb = (html, fn) => { const b = el('button', 'ttopb'); b.innerHTML = html; b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }); this.top.appendChild(b); };
    tb('☰', () => this.app.pause(true));
    tb('▤', () => { const on = !this.app.hud.sbOpen; this.app.hud.sbOpen = on; this.app.hud.renderBoard(); show('scoreboard', on); });
    tb('💬', () => this.app.chat.open('all'));
  }

  _bindZones() {
    const t = () => this.input.touch;
    this.moveZone.addEventListener('pointerdown', (e) => {
      if (this.movePtr !== null) return;
      e.preventDefault();
      this.movePtr = e.pointerId; this.moveZone.setPointerCapture(e.pointerId);
      this.ox = e.clientX; this.oy = e.clientY;
      Object.assign(this.stick.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
      this.knob.style.transform = 'translate(-50%,-50%)';
      show(this.stick, true);
    });
    this.moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.movePtr) return;
      const R = 56;
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const k = Math.min(1, l / R);
      const dead = 0.12;
      const mag = k < dead ? 0 : (k - dead) / (1 - dead);
      t().side = l > 0 ? (dx / Math.max(l, 1e-6)) * mag : 0;
      t().fwd = l > 0 ? (-dy / Math.max(l, 1e-6)) * mag : 0;
    });
    const endMove = (e) => { if (e.pointerId !== this.movePtr) return; this.movePtr = null; t().fwd = t().side = 0; show(this.stick, false); };
    this.moveZone.addEventListener('pointerup', endMove); this.moveZone.addEventListener('pointercancel', endMove);
    this.lookZone.addEventListener('pointerdown', (e) => { e.preventDefault(); this.lookZone.setPointerCapture(e.pointerId); this.lookPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    this.lookZone.addEventListener('pointermove', (e) => this._look(e));
    const endLook = (e) => this.lookPtrs.delete(e.pointerId);
    this.lookZone.addEventListener('pointerup', endLook); this.lookZone.addEventListener('pointercancel', endLook);
  }

  _look(e) {
    const p = this.lookPtrs.get(e.pointerId);
    if (!p) return;
    const k = 2.4 * (this.app.settings.touchSens || 1);
    this.input.state.lookDX += (e.clientX - p.x) * k;
    this.input.state.lookDY += (e.clientY - p.y) * k;
    p.x = e.clientX; p.y = e.clientY;
  }

  // cooldown overlays
  update(m) {
    if (!this.active) return;
    const k = m.kit, b = m.body;
    for (const [id, ref] of Object.entries(this.cd)) {
      let txt = '';
      if (id === 'dash') txt = b.dashCharges > 0 ? '' : String(Math.ceil((1 - b.dashRecharge / MOVE.dashRecharge) * MOVE.dashRecharge));
      else if (k.max[id] !== undefined) txt = k.cd[id] > 0 ? String(Math.ceil(k.cd[id])) : '';
      else txt = k.ult >= 100 ? '' : `${Math.floor(k.ult)}%`;
      if (ref.last !== txt) { ref.last = txt; ref.cdv.textContent = txt; show(ref.cdv, !!txt); ref.b.classList.toggle('cooling', !!txt); }
    }
  }
}
