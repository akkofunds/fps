// Tiny event emitter (no allocations on emit).
export class Emitter {
  constructor() { this._h = Object.create(null); }
  on(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const a = this._h[ev]; if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  // listeners added during an emit only see later events
  emit(ev, a, b, c) { const l = this._h[ev]; if (!l) return; for (let i = 0, n = l.length; i < n && i < l.length; i++) l[i](a, b, c); }
}
