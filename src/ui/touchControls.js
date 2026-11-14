import { $, show } from './dom.js';

// Mobile controls: floating left joystick (appears under the thumb), right-side drag-to-aim
// zone, and thumb buttons. FIRE also aims while held (drag the fire button to track).
export class TouchControls {
  constructor(app) {
    this.app = app;
    this.input = app.input;
    this.root = $('touch');
    this.joy = $('joy'); this.knob = this.joy.firstElementChild;
    this.joyId = null; this.joyX = 0; this.joyY = 0;
    this.look = new Map(); // touch id → {x, y}
    const T = this.input.touch;
    const zl = $('tzL'), zr = $('tzR');
    const opt = { passive: false };

    zl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.joyId === null) {
          this.joyId = t.identifier; this.joyX = t.clientX; this.joyY = t.clientY;
          this.joy.style.left = `${t.clientX}px`; this.joy.style.top = `${t.clientY}px`;
          this.knob.style.transform = 'translate(0,0)';
          show(this.joy, true);
        } else this.look.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }, opt);
    zr.addEventListener('touchstart', (e) => { e.preventDefault(); for (const t of e.changedTouches) this.look.set(t.identifier, { x: t.clientX, y: t.clientY }); }, opt);

    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) {
          let dx = t.clientX - this.joyX, dy = t.clientY - this.joyY;
          const R = 50, d = Math.hypot(dx, dy);
          if (d > R) { dx = dx / d * R; dy = dy / d * R; }
          this.knob.style.transform = `translate(${dx}px,${dy}px)`;
          const nx = dx / R, ny = -dy / R;
          // dead zone + full speed beyond 85%
          const mag = Math.hypot(nx, ny);
          const k = mag < 0.15 ? 0 : Math.min(1, (mag - 0.15) / 0.7) / (mag || 1);
          T.side = nx * k; T.fwd = ny * k;
        } else if (this.look.has(t.identifier)) {
          const p = this.look.get(t.identifier);
          this.input.state.lookDX += (t.clientX - p.x);
          this.input.state.lookDY += (t.clientY - p.y);
          p.x = t.clientX; p.y = t.clientY;
        }
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) { this.joyId = null; T.fwd = T.side = 0; show(this.joy, false); }
        this.look.delete(t.identifier);
      }
    };
    window.addEventListener('touchmove', (e) => { if (this.active) { move(e); e.preventDefault(); } }, opt);
    window.addEventListener('touchend', end, opt);
    window.addEventListener('touchcancel', end, opt);

    // hold buttons
    const hold = (id, key, alsoLook) => {
      const b = $(id);
      b.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        T[key] = true; b.classList.add('down');
        if (alsoLook) for (const t of e.changedTouches) this.look.set(t.identifier, { x: t.clientX, y: t.clientY });
      }, opt);
      const up = (e) => { e.preventDefault(); T[key] = false; b.classList.remove('down'); };
      b.addEventListener('touchend', up, opt); b.addEventListener('touchcancel', up, opt);
    };
    hold('tFire', 'fire', true); hold('tFireL', 'fire', false); hold('tJump', 'jump', false);
    // toggles / taps
    const tap = (id, fn) => $(id).addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, opt);
    tap('tCrouch', () => { T.crouch = !T.crouch; $('tCrouch').classList.toggle('on', T.crouch); });
    tap('tScope', () => { this.input.pressed.alt = true; }); // ADS toggle / sniper scope cycle
    tap('tMode', () => { this.input.pressed.mode = true; });
    tap('tReload', () => { this.input.pressed.reload = true; });
    tap('tSwap', () => { this.input.pressed.cycle = 1; });
    tap('tBuy', () => this.input.emit('buy'));
    tap('tChat', () => this.input.emit('chat', 'all'));
    tap('tBoard', () => { this._board = !this._board; this.input.emit('scoreboard', this._board); });
    tap('tPause', () => this.app.pause(true));
    tap('tAuto', () => { const s = this.app.settings; s.autoFire = !s.autoFire; this.app.saveSettings(); this.syncAuto(); });
    this.syncAuto();
    this.active = false;
  }

  syncAuto() { $('tAuto').classList.toggle('on', !!this.app.settings.autoFire); $('tAuto').textContent = this.app.settings.autoFire ? 'AUTO: ON' : 'AUTO-FIRE'; }

  setActive(on) {
    this.active = on;
    show(this.root, on);
    if (!on) { const T = this.input.touch; T.fwd = T.side = 0; T.fire = T.jump = T.alt = T.crouch = false; this.look.clear(); this.joyId = null; show(this.joy, false); $('tCrouch').classList.remove('on'); }
  }
}
