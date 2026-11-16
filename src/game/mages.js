import { SHOTO, ShotoKit } from './shoto.js';
import { METEORA, MeteoraKit } from './meteora.js';

// Mage registry: definition (lobby/HUD data + model) and the owner-side kit class.
export const MAGES = {
  pyro: { ...SHOTO, Kit: ShotoKit }, // Shoto (keeps the 'pyro' id for saved settings / old lobbies)
  meteora: { ...METEORA, Kit: MeteoraKit },
};
export const MAGE_LIST = [MAGES.pyro, MAGES.meteora];
export const mageOf = (id) => MAGES[id] || MAGES.pyro;
