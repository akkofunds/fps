import { Emitter } from './emitter.js';

// Unified input for keyboard/mouse/trackpad and touch. Gameplay reads `state` once per frame,
// UI listens to emitted actions. Touch controls write into the same state object.
export class Input extends Emitter {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.state = {
      fwd: 0, side: 0, jump: false, crouch: false, walk: false,
      fire: false, alt: false, lookDX: 0, lookDY: 0,
    };
    // edge-triggered (consumed by game each frame)
    this.pressed = { fire: false, alt: false, reload: false, slot: 0, cycle: 0, interact: false, jump: false, mode: false, inspect: false };
    this.touch = { fwd: 0, side: 0, jump: false, crouch: false, fire: false, alt: false };
    this.typing = false; // chat input focused → gameplay input suppressed
    this.enabled = false; // gameplay capture on (match running)
    this.locked = false;
    this.mouseL = false; this.mouseR = false;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.mode = coarse && (navigator.maxTouchPoints || 0) > 0 ? 'touch' : 'kbm';

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouseL = this.mouseR = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.emit('lock', this.locked);
      if (!this.locked) { this.mouseL = this.mouseR = false; }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.state.lookDX += e.movementX || 0;
      this.state.lookDY += e.movementY || 0;
    });
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._setMode('kbm'); }, { passive: true });
    window.addEventListener('touchstart', () => this._setMode('touch'), { passive: true });
    canvas.addEventListener('mousedown', (e) => {
      if (this.mode === 'touch') return;
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.mouseL = true; this.pressed.fire = true; }
      if (e.button === 2) { this.mouseR = true; this.pressed.alt = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.enabled || !this.locked || this.typing) return;
      this.pressed.cycle = e.deltaY > 0 ? 1 : -1;
    }, { passive: true });
  }

  _setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    this.emit('mode', m);
  }

  requestLock() {
    if (this.mode === 'touch' || this.locked) return;
    const plain = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ } };
    try {
      // raw (unaccelerated) mouse input where supported; falls back to a plain lock
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch { plain(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _key(e, down) {
    const code = e.code;
    if (this.typing) {
      if (down && (code === 'Escape')) this.emit('chatCancel');
      return; // chat input handles its own keys (Enter submit handled by chat)
    }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (down && !e.repeat) this._setMode('kbm');
    const was = this.keys[code];
    this.keys[code] = down;
    if (down && !was) {
      switch (code) {
        case 'Enter': case 'NumpadEnter': this.emit('chat', e.shiftKey ? 'team' : 'all'); e.preventDefault(); break;
        case 'KeyY': this.emit('chat', 'all'); e.preventDefault(); break;
        case 'KeyU': this.emit('chat', 'team'); e.preventDefault(); break;
        case 'KeyB': this.emit('buy'); break;
        case 'Escape': this.emit('escape'); break;
        case 'KeyR': this.pressed.reload = true; break;
        case 'KeyE': this.pressed.interact = true; break;
        case 'KeyF': this.pressed.inspect = true; break;
        case 'KeyX': this.pressed.mode = true; break;
        case 'Digit1': this.pressed.slot = 1; break;
        case 'Digit2': this.pressed.slot = 2; break;
        case 'Digit3': this.pressed.slot = 3; break;
        case 'KeyQ': this.pressed.cycle = -1; break;
        case 'Space': this.pressed.jump = true; break;
        case 'Tab': this.emit('scoreboard', true); break;
        default: break;
      }
    }
    if (!down && code === 'Tab') this.emit('scoreboard', false);
    if (this.enabled && (code === 'Space' || code === 'Tab' || code.startsWith('Arrow') || code === 'ControlLeft')) e.preventDefault();
  }

  // Build the per-frame movement/fire state. Returns state (mutated in place).
  poll() {
    const s = this.state, k = this.keys, t = this.touch;
    if (this.typing || !this.enabled) {
      s.fwd = s.side = 0; s.jump = s.crouch = s.walk = s.fire = s.alt = false;
      return s;
    }
    if (this.mode === 'touch') {
      s.fwd = t.fwd; s.side = t.side; s.jump = t.jump; s.crouch = t.crouch; s.walk = false;
      s.fire = t.fire; s.alt = t.alt;
    } else {
      s.fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      s.side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      s.jump = !!(k.Space);
      s.crouch = !!(k.ControlLeft || k.ControlRight || k.KeyC);
      s.walk = !!(k.ShiftLeft || k.ShiftRight);
      s.fire = this.mouseL && this.locked;
      s.alt = this.mouseR && this.locked;
    }
    return s;
  }

  consumeLook() { const dx = this.state.lookDX, dy = this.state.lookDY; this.state.lookDX = 0; this.state.lookDY = 0; return [dx, dy]; }
  clearPressed() { const p = this.pressed; p.fire = p.alt = p.reload = p.interact = p.jump = p.mode = p.inspect = false; p.slot = 0; p.cycle = 0; }
}
