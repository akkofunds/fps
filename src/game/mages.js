import { PYRO, PyroKit } from './pyro.js';
import { METEORA, MeteoraKit } from './meteora.js';

// Mage registry: definition (lobby/HUD data + model) and the owner-side kit class.
export const MAGES = {
  pyro: { ...PYRO, Kit: PyroKit },
  meteora: { ...METEORA, Kit: MeteoraKit },
};
export const MAGE_LIST = [MAGES.pyro, MAGES.meteora];
export const mageOf = (id) => MAGES[id] || MAGES.pyro;
