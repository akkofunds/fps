import { normMatrix } from './parts.mjs';
const XFWD = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]; // old +X forward → new -Z ; old +Z → new +X
const ZFWD = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]; // old +Z forward → new -Z
export const GUNS = {
  ak: {
    file: 'source/ak.glb', R: XFWD, scale: 0.88,
    route: (node, parent) => {
      const n = parent || node;
      if (/^Magazine_low/.test(n)) return 'mag';
      if (/^Slide_low/.test(n)) return 'charge';
      if (/^Trigger_low/.test(n)) return 'trigger';
      return 'body';
    },
  },
  glock: {
    file: 'source/glock.glb', R: XFWD, scale: 1.0,
    route: (node, parent, mesh, mat) => {
      if (mat === 'Glock17_marks_glass') return null;
      if (mat === 'Glock17_kollim' || mat === 'Glock17_linza1_glass') return 'slide';
      if (mat === 'Glock17_weapon') return 'split';
      return 'body';
    },
    // islands are in normalized space (meters, barrel -Z, origin unchanged): y up
    split: (c) => {
      const minY = c.min[1], maxY = c.max[1], minZ = c.min[2], maxZ = c.max[2];
      if (c.count === 588) return 'mag';
      if (minY >= 0.0 && maxY <= 0.032 && minZ >= -0.064 && maxZ <= -0.027) return 'trigger';
      if (minZ < -0.155 && minY > 0.045) return 'body'; // threaded barrel stays
      if (minY >= 0.045 || c.count === 2240) return 'slide';
      return 'body';
    },
  },
  sniper: {
    file: 'source/sniper.glb', R: ZFWD, scale: 0.0074,
    route: (node, parent, mesh) => {
      if (/^bolt_sniper/.test(mesh)) return 'bolt';
      if (/^boltback_sniper/.test(mesh)) return 'boltback';
      if (/^mag_sniper|^bullet_sniper/.test(mesh)) return 'mag';
      if (/^trigger_sniper/.test(mesh)) return 'trigger';
      return 'body';
    },
  },
};
export const norm = (g) => normMatrix(g.R, g.scale);
