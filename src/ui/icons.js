// Inline SVG icons for abilities and UI (24×24 viewBox, filled with currentColor/CSS).
export const ICONS = {
  flame: '<svg viewBox="0 0 32 32"><path d="M16 2c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 1 3 3 4 3 4 0-4 1-7 2-10z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M3 13.5c3-.3 5.5-1.6 8-3.9-.3 1.6-1 2.8-2.1 3.8 3.4-.6 6.5-2.6 9-5.9-.2 2.6-1.2 4.6-2.8 6.1 2.1-.1 4.1-.9 5.9-2.4-1.6 4.6-5.7 7.3-10.4 7.3-3.4 0-5.9-1.9-7.6-5z"/><circle cx="19.5" cy="13" r="2.5"/></svg>',
  dash: '<svg viewBox="0 0 24 24"><path d="M4 5l7 7-7 7h4l7-7-7-7zm7 0l7 7-7 7h4l7-7-7-7z"/></svg>',
  orb: '<svg viewBox="0 0 24 24"><circle cx="13" cy="13" r="6"/><path d="M8.3 9.2C6.5 7.8 4 7.6 2 8.5c1.6.4 2.6 1.3 3.2 2.5L8.3 9.2zM9.6 6.6C9 4.4 7 2.8 4.8 2.5c1.2 1.1 1.6 2.4 1.6 3.8l3.2.3zM6.6 12.5c-2-.4-4 .3-5.1 1.9 1.4-.2 2.6.2 3.6 1l1.5-2.9z"/></svg>',
  wall: '<svg viewBox="0 0 24 24"><path d="M3 21c-.5-3 1-5 2-7 .4 1.4 1.1 2.2 2 2.6 0-3.2 1.3-5.6 3-7.6-.1 2.4.7 4 2 5 .2-2.5 1.2-4.5 3-6-.4 2.6.5 4.5 2 6 .4-1.2 1.1-2 2-2.6.6 2.6 1.6 5.2 2 9.6H3z"/></svg>',
  leap: '<svg viewBox="0 0 24 24"><path d="M12 2l6 7h-4v6h-4V9H6z"/><path d="M4 22c.6-2.4 2-3.8 3.6-4.6-.3 1.2 0 2.1.7 2.6.3-1.8 1.6-3.2 3.7-4 0 1.6.7 2.8 1.8 3.4.4-1.2 1.3-2.1 2.6-2.6-.2 1.5.4 2.7 1.6 3.4.7-.7 1.4-1.1 2-1.2-.2 1.2-.2 2.1.1 3H4z"/></svg>',
  meteor: '<svg viewBox="0 0 24 24"><circle cx="16" cy="16" r="5"/><path d="M12.6 12.4L3 2.8l1.4-.6 9.4 8.9zM11 15L2 9.6l.4-1.4 9.4 4.4zM15.6 11l-4.4-9.4 1.4-.4 5.4 9z"/></svg>',
  skull: '<svg viewBox="0 0 24 24"><path d="M12 2a8 8 0 0 0-8 8c0 2.6 1.3 4.6 3 5.8V19a1 1 0 0 0 1 1h1v2h2v-2h2v2h2v-2h1a1 1 0 0 0 1-1v-3.2c1.7-1.2 3-3.2 3-5.8a8 8 0 0 0-8-8zm-3.5 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
  burn: '<svg viewBox="0 0 32 32"><path d="M16 2c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 1 3 3 4 3 4 0-4 1-7 2-10z"/></svg>',
  rank: '<svg viewBox="0 0 40 40"><defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#c58a2f"/></linearGradient></defs><path d="M20 3l12 9-4 18-8 7-8-7-4-18z" fill="url(#rg)" stroke="#5b3a12" stroke-width="1.2"/><path d="M20 9l6 5-2 10-4 4-4-4-2-10z" fill="#fff6d6" opacity=".55"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>',
  water: '<svg viewBox="0 0 24 24"><path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/></svg>',
  earth: '<svg viewBox="0 0 24 24"><path d="M2 20l6-10 4 6 3-4 7 8z"/></svg>',
  storm: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h15a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h7v2H3z"/></svg>',
  frost: '<svg viewBox="0 0 24 24"><path d="M11 2h2v5l3-2 1 1.7-4 2.3v2h2l2.3-4L19 8l-2 3h5v2h-5l2 3-1.7 1-2.3-4h-2v2l4 2.3-1 1.7-3-2v5h-2v-5l-3 2-1-1.7 4-2.3v-2H9l-2.3 4L5 16l2-3H2v-2h5L5 8l1.7-1L9 11h2V9L7 6.7 8 5l3 2z"/></svg>',
};
export const ABILITY_ICON = { bolt: ICONS.bolt, dash: ICONS.dash, orb: ICONS.orb, wall: ICONS.wall, leap: ICONS.leap, meteor: ICONS.meteor, burn: ICONS.burn };
