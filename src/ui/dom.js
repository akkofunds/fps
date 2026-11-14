export const $ = (id) => document.getElementById(id);
export function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
export function show(e, on = true) { (typeof e === 'string' ? $(e) : e).classList.toggle('hidden', !on); }

const toasts = () => $('toasts');
export function toast(msg, ms = 2600) {
  const t = el('div', 'toast', msg);
  toasts().appendChild(t);
  while (toasts().children.length > 4) toasts().firstChild.remove();
  setTimeout(() => t.remove(), ms);
}
