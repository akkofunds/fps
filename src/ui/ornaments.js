// Ornament art for the UI theme, drawn as SVG at startup and exposed to CSS as variables:
//   --orn-tl/-tr/-bl/-br : spiked steel corner filigree for framed tiles and panels
//   --wing-l / --wing-r  : swept blade "wings" either side of title plates and the start button
//   --orn-div            : a thin divider with a diamond in the middle
// (generated here rather than hand-encoded data URIs, so the shapes stay editable)

const STEEL = `<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f4f8ff"/><stop offset=".28" stop-color="#9fb3cf"/><stop offset=".5" stop-color="#3a4a63"/>
  <stop offset=".72" stop-color="#b9c9e0"/><stop offset="1" stop-color="#55667f"/></linearGradient>
  <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9cc4ff" stop-opacity=".0"/><stop offset=".55" stop-color="#7fb0ff"/><stop offset="1" stop-color="#e9f2ff"/></linearGradient></defs>`;

// one top-left corner (40×40): a bevelled bracket hugging the corner, thorns running out along both
// edges, a spike pointing out of the corner and a small inner barb
const CORNER = `
  <path d="M4 4h19l-4.5 4H8.5v10L4 22.5z" fill="url(#s)" stroke="#0b1220" stroke-width=".8"/>
  <path d="M21 4.2l14-4-9.5 7.2z" fill="url(#s)" stroke="#0b1220" stroke-width=".6"/>
  <path d="M4.2 21l-4 14 7.2-9.5z" fill="url(#s)" stroke="#0b1220" stroke-width=".6"/>
  <path d="M4 4L.5.5 7 2.5z" fill="url(#s)"/><path d="M4 4L.5.5 2.5 7z" fill="url(#s)"/>
  <path d="M9 9l8 3.5-4.2.4-.4 4.2z" fill="url(#s)" opacity=".9"/>
  <path d="M27 6.2l7-2.2-5 3.6z" fill="#cfe0ff" opacity=".55"/>`;

// a swept blade wing pointing LEFT (the title sits at its right end)
const WING = `
  <path d="M118 15 C92 11 54 4 4 3 C40 9 70 13 92 15.6 Z" fill="url(#s)" stroke="#0b1220" stroke-width=".6"/>
  <path d="M118 16.4 C96 18.5 64 23 22 27 C56 20.5 82 17.8 98 16.6 Z" fill="url(#s)" stroke="#0b1220" stroke-width=".6"/>
  <path d="M118 15.6 L104 12.5 L108 15.7 L104 18.8 Z" fill="#e9f2ff"/>
  <path d="M100 15.7 C80 14.4 54 12 30 9" stroke="url(#b)" stroke-width="1.1" fill="none" opacity=".9"/>`;

const DIV = `<path d="M0 6h88" stroke="url(#s)" stroke-width="1"/><path d="M112 6h88" stroke="url(#s)" stroke-width="1"/>
  <path d="M100 0l6 6-6 6-6-6z" fill="url(#s)" stroke="#0b1220" stroke-width=".5"/><path d="M100 3l3 3-3 3-3-3z" fill="#9cc4ff"/>`;

const uri = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${STEEL}${body}</svg>`)}")`;
const flip = (sx, sy, w, h, body) => `<g transform="translate(${sx < 0 ? w : 0} ${sy < 0 ? h : 0}) scale(${sx} ${sy})">${body}</g>`;

export function installOrnaments() {
  const r = document.documentElement.style;
  r.setProperty('--orn-tl', uri(40, 40, CORNER));
  r.setProperty('--orn-tr', uri(40, 40, flip(-1, 1, 40, 40, CORNER)));
  r.setProperty('--orn-bl', uri(40, 40, flip(1, -1, 40, 40, CORNER)));
  r.setProperty('--orn-br', uri(40, 40, flip(-1, -1, 40, 40, CORNER)));
  r.setProperty('--wing-l', uri(120, 30, WING));
  r.setProperty('--wing-r', uri(120, 30, flip(-1, 1, 120, 30, WING)));
  r.setProperty('--orn-div', uri(200, 12, DIV));
}
