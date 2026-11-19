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
ICONS.spark = '<svg viewBox="0 0 24 24"><path d="M3 21l7.5-7.5"/><path d="M2.3 20.3l8-8 1.4 1.4-8 8z"/><circle cx="16" cy="8" r="4.5"/><path d="M16 1l1 3h-2zM23 8l-3 1V7zM16 15l-1-3h2zM9 8l3-1v2z"/></svg>';
ICONS.starfall = '<svg viewBox="0 0 24 24"><path d="M15 2l1.6 3.6 3.9.4-2.9 2.6.8 3.8L15 10.5l-3.4 1.9.8-3.8L9.5 6l3.9-.4z"/><path d="M10.5 12.5L3 20l1.2 1.2 7.5-7.5zM8 10L2.5 15.5l1 1L9 11zM14 14l-5.5 5.5 1 1L15 15z"/></svg>';
ICONS.sigil = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1.8a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4z"/><path d="M12 4.5l2.2 6.6h6.3l-5.1 3.7 1.9 6-5.3-3.9-5.3 3.9 1.9-6-5.1-3.7h6.3zm0 4.4l-1 3.2H7.7l2.7 1.9-1 3 2.6-1.9 2.6 1.9-1-3 2.7-1.9h-3.3z"/></svg>';
ICONS.blink = '<svg viewBox="0 0 24 24"><path d="M3 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM10 11h3v2h-3zM14.5 11h2.5v2h-2.5z"/><path d="M18 7l5 5-5 5v-3.5h-1v-3h1z"/></svg>';
ICONS.nova = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="9" rx="9" ry="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11c5 0 8 3 8 6.5S16.5 23 12 23s-8-2-8-5.5S7 11 12 11z"/><path d="M11 10h2v3h-2z"/></svg>';
export const ABILITY_ICON = { bolt: ICONS.bolt, dash: ICONS.dash, orb: ICONS.orb, wall: ICONS.wall, leap: ICONS.leap, meteor: ICONS.meteor, burn: ICONS.burn, spark: ICONS.spark, starfall: ICONS.starfall, sigil: ICONS.sigil, blink: ICONS.blink, nova: ICONS.nova };
// Pyro (Fire Force kit)
ICONS.kick = '<svg viewBox="0 0 24 24"><path d="M3 15.5l8.5-1.2 4.8-4.6 3.2 1.1-3.4 4.4c-.6.8-1.5 1.3-2.5 1.4L4 18z"/><path d="M14.5 4.5c1 2 3.4 2.6 3.4 5.2a3 3 0 0 1-6 0c0-1.6 1.1-2.2 1.4-3.6.4.9 1 1.3 1 1.3 0-1.2.1-2 .2-2.9zM2 20h9v1.6H2zM1.5 12.5h6v1.4h-6z"/></svg>';
ICONS.ignite = '<svg viewBox="0 0 24 24"><circle cx="18.5" cy="5.5" r="2.6"/><circle cx="20" cy="12" r="2.6"/><circle cx="18.5" cy="18.5" r="2.6"/><path d="M2 12l13.3-6.1.7 1.5L5.4 12l10.6 4.6-.7 1.5z"/><path d="M2 11.2h14v1.6H2z"/></svg>';
ICONS.step = '<svg viewBox="0 0 24 24"><path d="M9.5 3.5h5l.8 8.5h-6.6z"/><path d="M8.2 13h7.6l1.2 3H7z"/><path d="M2 19.5c3-2.4 6.4-3.4 10-3.4s7 1 10 3.4l-.9 1.3c-2.8-2.1-5.8-3-9.1-3s-6.3.9-9.1 3z"/><path d="M4.5 22c2.2-1.4 4.8-2.1 7.5-2.1s5.3.7 7.5 2.1"/></svg>';
ICONS.adolla = '<svg viewBox="0 0 24 24"><path d="M2 9.5h3.2c2.6 0 4.4-1.5 6.5-1.5H23v8H11.7c-2.1 0-3.9-1.5-6.5-1.5H2z"/><path d="M12 10h11v4H12z" fill="#fff6d0"/><path d="M5 4l1.5 3M9 2.5l.7 3.5M5 20l1.5-3M9 21.5l.7-3.5" stroke="currentColor" stroke-width="1.5"/></svg>';
Object.assign(ABILITY_ICON, { blast: ICONS.bolt, kick: ICONS.kick, ignite: ICONS.ignite, step: ICONS.step, adolla: ICONS.adolla, ember: ICONS.ignite, igniteBoom: ICONS.ignite, trail: ICONS.burn, adollaPath: ICONS.burn });
// Shoto (frost & flame)
ICONS.freeze = '<svg viewBox="0 0 24 24"><path d="M11 2h2v4l2.5-1.5 1 1.7L13 8.4V10h1.6l2.2-3.5 1.7 1L17 10h4v2h-4l1.5 2.5-1.7 1-2.2-3.5H13v1.6l3.5 2.2-1 1.7L13 16v4h-2v-4l-2.5 1.5-1-1.7L11 13.6V12H9.4l-2.2 3.5-1.7-1L7 12H3v-2h4L5.5 7.5l1.7-1L9.4 10H11V8.4L7.5 6.2l1-1.7L11 6z"/></svg>';
ICONS.lance = '<svg viewBox="0 0 24 24"><path d="M2 13.2l13-1.4v.4L2 13.6zM15 10l7 2-7 2c.6-1.3.6-2.7 0-4z"/><path d="M3 11h9v2H3z" opacity=".55"/><circle cx="4" cy="12" r="2.2"/></svg>';
ICONS.blitz = '<svg viewBox="0 0 24 24"><path d="M13 3l6 6-4 1 3 4-3 1 2 6-9-8 4-1-3-4 4-1z"/><path d="M2 20h8v1.6H2zM1 16.5h6v1.4H1z"/></svg>';
ICONS.zero = '<svg viewBox="0 0 24 24"><path d="M12 2l2 6 6-2-4 5 5 3-6 1 1 6-4-4-4 4 1-6-6-1 5-3-4-5 6 2z"/><circle cx="12" cy="12" r="2.6" fill="#ff8a3a"/></svg>';
Object.assign(ABILITY_ICON, { freeze: ICONS.freeze, heatwave: ICONS.freeze, shatter: ICONS.freeze, lance: ICONS.lance, blitz: ICONS.blitz, uppercut: ICONS.blitz, zero: ICONS.zero, zeroBoom: ICONS.zero, shard: ICONS.freeze, sparkBig: ICONS.spark, novaFrag: ICONS.nova, novaShock: ICONS.nova, novaBurn: ICONS.nova });
ICONS.ray = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="12" r="1.4"/><path d="M8.6 10.8L23 11.4v1.2L8.6 13.2z"/><path d="M8 9.2l6 1.6-6 .4zM8 14.8l6-1.6-6-.4z" opacity=".6"/></svg>';
Object.assign(ABILITY_ICON, { ray: ICONS.ray });
// Sorcerer (Limitless)
ICONS.purple = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".6"/><path d="M3 12h2.4M18.6 12H21M12 3v2.4M12 18.6V21" stroke="currentColor" stroke-width="1.4"/></svg>';
ICONS.flick = '<svg viewBox="0 0 24 24"><path d="M3 13.2l12-1.4v.4L3 13.6z"/><circle cx="18" cy="12" r="3.2"/><path d="M5 9.5l7 1.6v.6L5 10.2zM5 15.8l7-1.6v-.6l-7 1.7z" opacity=".55"/></svg>';
ICONS.blue = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.4"/><path d="M12 3.2a8.8 8.8 0 0 1 8.8 8.8h-1.8A7 7 0 0 0 12 5zM3.2 12A8.8 8.8 0 0 1 12 3.2V5a7 7 0 0 0-7 7zM12 20.8A8.8 8.8 0 0 1 3.2 12H5a7 7 0 0 0 7 7zM20.8 12a8.8 8.8 0 0 1-8.8 8.8V19a7 7 0 0 0 7-7z" opacity=".75"/><path d="M19 4l-3.6 3.6M5 20l3.6-3.6M5 4l3.6 3.6M19 20l-3.6-3.6" stroke="currentColor" stroke-width="1.4"/></svg>';
ICONS.red = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6"/><path d="M12 1.5l1.2 5.5h-2.4zM12 22.5l-1.2-5.5h2.4zM1.5 12l5.5-1.2v2.4zM22.5 12L17 13.2v-2.4zM4.6 4.6l4.8 3-1.7 1.7zM19.4 19.4l-4.8-3 1.7-1.7zM19.4 4.6l-3 4.8-1.7-1.7zM4.6 19.4l3-4.8 1.7 1.7z"/></svg>';
ICONS.domain = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="4.2"/><path d="M12 5.2a6.8 6.8 0 0 1 6.8 6.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 18.8A6.8 6.8 0 0 1 5.2 12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="5" cy="6" r=".8"/><circle cx="19" cy="18" r=".8"/><circle cx="18" cy="5" r=".6"/></svg>';
Object.assign(ABILITY_ICON, { flick: ICONS.flick, blue: ICONS.blue, red: ICONS.red, redSplash: ICONS.red, purple: ICONS.purple, domain: ICONS.domain, void: ICONS.domain });
ICONS.fist = '<svg viewBox="0 0 24 24"><path d="M6 9.5a2 2 0 0 1 2-2h1.2V6.6a1.6 1.6 0 0 1 3.2 0V7.5h.6V6.9a1.6 1.6 0 0 1 3.2 0v.7a1.6 1.6 0 0 1 2.8 1v4.6c0 3.8-2.6 6.3-6.3 6.3H11c-2.8 0-5-2.2-5-5z"/><path d="M1.5 10h3v1.4h-3zM1 13.2h3.6v1.4H1zM1.5 16.4h3v1.4h-3z" opacity=".6"/></svg>';
Object.assign(ABILITY_ICON, { m1: ICONS.fist, m1f: ICONS.fist });
