import { Emitter } from './emitter.js';

// Keyboard + mouse input. Gameplay reads `state` once per frame and consumes `pressed` edges.
// Bindings: WASD move, Space jump, Q dash, E Blaze Orb, C Firewall, V Flame Leap, X Meteor (ult),
// LMB Ember Bolt, RMB tighter aim, Tab scoreboard, Enter chat, Esc menu.
export class Input extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.state = { fwd: 0, side: 0, jump: false, fire: false, aim: false, lookDX: 0, lookDY: 0 };
    this.pressed = { jump: false, dash: false, e: false, c: false, v: false, x: false, fire: false };
    this.typing = false;
    this.enabled = false;
    this.locked = false;
    this.mouseL = false; this.mouseR = false;

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouseL = this.mouseR = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.emit('lock', this.locked);
      if (!this.locked) this.mouseL = this.mouseR = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.state.lookDX += e.movementX || 0;
      this.state.lookDY += e.movementY || 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.mouseL = true; this.pressed.fire = true; }
      if (e.button === 2) this.mouseR = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseL = false; if (e.button === 2) this.mouseR = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (this.locked) return;
    const plain = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ } };
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(plain); } catch { plain(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _key(e, down) {
    const code = e.code;
    if (this.typing) { if (down && code === 'Escape') this.emit('chatCancel'); return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const was = this.keys[code];
    this.keys[code] = down;
    if (down && !was) {
      switch (code) {
        case 'Enter': case 'NumpadEnter': this.emit('chat', 'all'); e.preventDefault(); break;
        case 'Escape': this.emit('escape'); break;
        case 'Space': this.pressed.jump = true; break;
        case 'KeyQ': this.pressed.dash = true; break;
        case 'KeyE': this.pressed.e = true; break;
        case 'KeyC': this.pressed.c = true; break;
        case 'KeyV': this.pressed.v = true; break;
        case 'KeyX': this.pressed.x = true; break;
        case 'Tab': this.emit('scoreboard', true); break;
        default: break;
      }
    }
    if (!down && code === 'Tab') this.emit('scoreboard', false);
    if (this.enabled && (code === 'Space' || code === 'Tab' || code.startsWith('Arrow'))) e.preventDefault();
  }

  poll() {
    const s = this.state, k = this.keys;
    if (this.typing || !this.enabled) { s.fwd = s.side = 0; s.jump = s.fire = s.aim = false; return s; }
    s.fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    s.side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    s.jump = !!k.Space;
    s.fire = this.mouseL && this.locked;
    s.aim = this.mouseR && this.locked;
    return s;
  }

  consumeLook() { const dx = this.state.lookDX, dy = this.state.lookDY; this.state.lookDX = 0; this.state.lookDY = 0; return [dx, dy]; }
  clearPressed() { const p = this.pressed; p.jump = p.dash = p.e = p.c = p.v = p.x = p.fire = false; }
}
