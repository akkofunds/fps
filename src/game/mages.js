import { SHOTO, ShotoKit } from './shoto.js';
import { METEORA, MeteoraKit } from './meteora.js';
import { SORCERER, SorcererKit } from './sorcerer.js';
import { KINE, KineSlayerKit } from './kineslayer.js';
import { MANIP, ManipulatorKit } from './manipulator.js';
import { INKWEAVER, InkweaverKit } from './inkweaver.js';

// Mage registry: definition (lobby/HUD data + model) and the owner-side kit class.
export const MAGES = {
  pyro: { ...SHOTO, Kit: ShotoKit }, // Shoto (keeps the 'pyro' id for saved settings / old lobbies)
  meteora: { ...METEORA, Kit: MeteoraKit },
  sorcerer: { ...SORCERER, Kit: SorcererKit },
  kineslayer: { ...KINE, Kit: KineSlayerKit },
  manipulator: { ...MANIP, Kit: ManipulatorKit, admin: true, forever: true }, // admin-only, forever
  inkweaver: { ...INKWEAVER, Kit: InkweaverKit, admin: true }, // admin-only (the owner can open her to all)
};
export const MAGE_LIST = [MAGES.pyro, MAGES.meteora, MAGES.sorcerer, MAGES.kineslayer, MAGES.manipulator, MAGES.inkweaver];
export const mageOf = (id) => MAGES[id] || MAGES.pyro;
