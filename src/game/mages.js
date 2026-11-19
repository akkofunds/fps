import { SHOTO, ShotoKit } from './shoto.js';
import { METEORA, MeteoraKit } from './meteora.js';
import { SORCERER, SorcererKit } from './sorcerer.js';

// Mage registry: definition (lobby/HUD data + model) and the owner-side kit class.
export const MAGES = {
  pyro: { ...SHOTO, Kit: ShotoKit }, // Shoto (keeps the 'pyro' id for saved settings / old lobbies)
  meteora: { ...METEORA, Kit: MeteoraKit },
  sorcerer: { ...SORCERER, Kit: SorcererKit, admin: true }, // admin-only
};
export const MAGE_LIST = [MAGES.pyro, MAGES.meteora, MAGES.sorcerer];
export const mageOf = (id) => MAGES[id] || MAGES.pyro;
