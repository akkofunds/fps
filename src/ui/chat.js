import { $, el } from './dom.js';

// Bottom-left translucent chat feed. Enter (or the mobile CHAT button) opens the input and
// pauses movement input while typing; lines fade after 6 seconds of inactivity.
export class Chat {
  constructor(input) {
    this.input = input;
    this.root = $('chat'); this.feed = $('chatFeed'); this.wrap = $('chatInputWrap'); this.field = $('chatInput'); this.chan = $('chatChan');
    this.channel = 'all';
    this.sendFn = null; this.ctx = 'lobby';
    this.isOpen = false;
    input.on('chat', (ch) => this.open(ch));
    input.on('chatCancel', () => this.close());
    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.setChannel(this.channel === 'all' ? 'team' : 'all'); }
    });
    this.field.addEventListener('blur', () => { if (this.isOpen) setTimeout(() => { if (document.activeElement !== this.field) this.close(); }, 50); });
  }

  setContext(ctx, sendFn) {
    this.ctx = ctx; this.sendFn = sendFn;
    this.root.classList.toggle('lobby', ctx === 'lobby');
    if (this.isOpen) this.close();
  }

  setChannel(ch) {
    this.channel = this.ctx === 'lobby' ? 'party' : ch;
    this.chan.textContent = `[${this.channel.toUpperCase()}]`;
  }

  open(ch = 'all') {
    if (this.isOpen) return;
    this.isOpen = true;
    this.setChannel(ch);
    this.input.typing = true;
    this.root.classList.add('open');
    this.wrap.classList.remove('hidden');
    this.field.value = '';
    this.field.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.typing = false;
    this.root.classList.remove('open');
    this.wrap.classList.add('hidden');
    this.field.blur();
  }

  submit() {
    const text = this.field.value.trim();
    if (text && this.sendFn) this.sendFn(text, this.channel === 'team');
    this.close();
  }

  _push(line) {
    this.feed.appendChild(line);
    while (this.feed.children.length > 30) this.feed.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), 6000);
  }

  add(channel, name, msg, ally = false) {
    const line = el('div', 'cl');
    line.appendChild(el('span', 'ch', `[${channel === 'team' ? 'Team' : channel === 'party' ? 'Party' : 'All'}] `));
    line.appendChild(el('span', `nm${ally ? ' ally' : ''}`, `${name}: `));
    line.appendChild(document.createTextNode(msg));
    this._push(line);
  }

  system(text) { this._push(el('div', 'cl sys', text)); }
  clear() { this.feed.textContent = ''; }
}
