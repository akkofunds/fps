"""Auto-rig METEORA from the Megumin model (tools/characters/src/megumin_original.glb).

The source is 20 static mesh parts in a natural standing pose: left hand on the hip, staff gripped
in the hand in front of the chest, a cloak hanging from the shoulders. megumin_src.load() stands her
upright, scales her to 1.52 m and mirrors the body so the staff is in the RIGHT hand (the head is
kept unmirrored, so the eyepatch stays on her left eye).

  * skin (one continuous body mesh): geodesic bone weights (distance along the surface), so the
    hand resting on the hip never drags the hip along, and vice versa;
  * skin hidden under the clothes is removed (it is what pokes through when garments stretch);
  * garments copy weights from the skin per region (torso / left arm / right arm / each leg);
  * head, hair, eyes, eyepatch, hat: rigid to the head (blended into the neck at the bottom);
  * staff: `prop_R`, the grip exactly as modelled (the runtime keeps it locked in the fist);
  * cloak: three strands of bones (left / centre / right) placed ON the modelled cloak, simulated
    at runtime (src/character/cape.js);
  * an ink outline (inverted hull) generated per part from that part's own weights.

Usage: python3 tools/characters/rig_megumin.py [out.glb]      (numpy + Pillow)
"""
import io, os, sys, heapq
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import megumin_src  # noqa: E402
from glbmesh import image_bytes  # noqa: E402
from strip_glb import write_glb  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'public', 'models', 'meteora.glb')

# ---------------------------------------------------------------- skeleton (meters, Y-up, faces +Z, her left = +X)
BONES = [
    ('hips', None, (0.0, 0.80, 0.010)),
    ('spine', 'hips', (0.0, 0.90, 0.030)),
    ('chest', 'spine', (0.0, 1.00, 0.035)),
    ('upperChest', 'chest', (0.0, 1.10, 0.020)),
    ('neck', 'upperChest', (-0.022, 1.215, 0.000)),
    ('head', 'neck', (-0.028, 1.275, 0.012)),
    ('shoulder_L', 'upperChest', (0.030, 1.185, -0.008)),
    ('upperArm_L', 'shoulder_L', (0.122, 1.178, -0.016)),
    ('foreArm_L', 'upperArm_L', (0.226, 1.000, -0.086)),
    ('hand_L', 'foreArm_L', (0.168, 0.874, -0.022)),
    ('shoulder_R', 'upperChest', (-0.032, 1.185, 0.000)),
    ('upperArm_R', 'shoulder_R', (-0.124, 1.178, -0.002)),
    ('foreArm_R', 'upperArm_R', (-0.188, 0.950, -0.026)),
    ('hand_R', 'foreArm_R', (-0.262, 1.068, 0.125)),
    ('upperLeg_L', 'hips', (0.074, 0.740, -0.004)),
    ('lowerLeg_L', 'upperLeg_L', (0.096, 0.420, -0.030)),
    ('foot_L', 'lowerLeg_L', (0.120, 0.080, -0.026)),
    ('toes_L', 'foot_L', (0.115, 0.022, 0.058)),
    ('upperLeg_R', 'hips', (-0.074, 0.740, 0.012)),
    ('lowerLeg_R', 'upperLeg_R', (-0.096, 0.420, 0.040)),
    ('foot_R', 'lowerLeg_R', (-0.145, 0.080, 0.018)),
    ('toes_R', 'foot_R', (-0.133, 0.022, 0.102)),
]
TAILS = {
    'head': (-0.035, 1.50, 0.015),
    'hand_L': (0.135, 0.800, 0.030),
    'hand_R': (-0.290, 1.115, 0.180),
    'toes_L': (0.110, 0.012, 0.110),
    'toes_R': (-0.125, 0.012, 0.155),
}
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
JP = np.array([b[2] for b in BONES], dtype=np.float64)
CHILD = {'hips': 'spine', 'spine': 'chest', 'chest': 'upperChest', 'upperChest': 'neck', 'neck': 'head',
         'shoulder_L': 'upperArm_L', 'upperArm_L': 'foreArm_L', 'foreArm_L': 'hand_L',
         'shoulder_R': 'upperArm_R', 'upperArm_R': 'foreArm_R', 'foreArm_R': 'hand_R',
         'upperLeg_L': 'lowerLeg_L', 'lowerLeg_L': 'foot_L', 'foot_L': 'toes_L',
         'upperLeg_R': 'lowerLeg_R', 'lowerLeg_R': 'foot_R', 'foot_R': 'toes_R'}
ARM = {'L': ('shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L'), 'R': ('shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R')}
LEG = {'L': ('upperLeg_L', 'lowerLeg_L', 'foot_L', 'toes_L'), 'R': ('upperLeg_R', 'lowerLeg_R', 'foot_R', 'toes_R')}
TORSO = ('hips', 'spine', 'chest', 'upperChest', 'neck')


def tail(n):
    return np.array(TAILS[n], dtype=np.float64) if n in TAILS else JP[IDX[CHILD[n]]]


def seg(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t


# ---------------------------------------------------------------- surface graph helpers
def weld(P, I):
    key = np.round(P * 20000).astype(np.int64)   # 0.05 mm
    _, rep, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return inv.ravel(), P[rep]


def graph(Pw, Iw):
    adj = [dict() for _ in range(len(Pw))]
    for t in Iw.reshape(-1, 3):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            if a == b: continue
            d = float(np.linalg.norm(Pw[a] - Pw[b]))
            adj[a][b] = d; adj[b][a] = d
    return adj


def dijkstra(adj, seeds, n):
    dist = np.full(n, np.inf)
    h = []
    for s in seeds: dist[s] = 0.0; h.append((0.0, int(s)))
    heapq.heapify(h)
    while h:
        d, u = heapq.heappop(h)
        if d > dist[u]: continue
        for v, w in adj[u].items():
            nd = d + w
            if nd < dist[v]: dist[v] = nd; heapq.heappush(h, (nd, v))
    return dist


def largest_patch(adj, seeds):
    sset = set(int(x) for x in seeds)
    seen, best = set(), []
    for s0 in sset:
        if s0 in seen: continue
        comp, st = [], [s0]; seen.add(s0)
        while st:
            u = st.pop(); comp.append(u)
            for v in adj[u]:
                if v in sset and v not in seen: seen.add(v); st.append(v)
        if len(comp) > len(best): best = comp
    return np.array(best)


def knn_transfer(Q, P, W, k=6):
    out = np.zeros((len(Q), W.shape[1]))
    for s in range(0, len(Q), 256):
        d = ((Q[s:s + 256, None, :] - P[None, :, :]) ** 2).sum(-1)
        kk = min(k, len(P) - 1)
        idx = np.argpartition(d, kk, axis=1)[:, :kk]
        dd = np.take_along_axis(d, idx, 1)
        w = 1.0 / (np.sqrt(dd) + 0.004) ** 2
        w /= w.sum(1, keepdims=True)
        out[s:s + 256] = (W[idx] * w[:, :, None]).sum(1)
    return out


def inner_transfer(Q, NQ, P, W, k=6, cand=32):
    """like knn_transfer, but a garment only takes weights from skin BEHIND it (inside, against its
    normal): a skirt with a hand resting on it copies the hip under it, never the hand on top"""
    out = np.zeros((len(Q), W.shape[1]))
    for s in range(0, len(Q), 256):
        q, nq = Q[s:s + 256], NQ[s:s + 256]
        d = ((q[:, None, :] - P[None, :, :]) ** 2).sum(-1)
        idx = np.argpartition(d, cand, axis=1)[:, :cand]
        dd = np.take_along_axis(d, idx, 1)
        side = ((P[idx] - q[:, None, :]) * nq[:, None, :]).sum(-1)       # < 0: behind the garment
        pen = np.where(side < 0.004, 0.0, 1e3)                             # in front: practically excluded
        score = dd + pen
        o = np.argsort(score, 1)[:, :k]
        idk = np.take_along_axis(idx, o, 1); dk = np.take_along_axis(dd, o, 1)
        w = 1.0 / (np.sqrt(dk) + 0.004) ** 2
        w /= w.sum(1, keepdims=True)
        out[s:s + 256] = (W[idk] * w[:, :, None]).sum(1)
    return out


def nearest(Q, P):
    """index of + distance to the nearest point of P for every point of Q (chunked brute force)"""
    idx = np.zeros(len(Q), int); dist = np.zeros(len(Q))
    for s in range(0, len(Q), 512):
        d = ((Q[s:s + 512, None, :] - P[None, :, :]) ** 2).sum(-1)
        j = d.argmin(1); idx[s:s + 512] = j; dist[s:s + 512] = np.sqrt(d[np.arange(len(j)), j])
    return idx, dist


def vertex_normals(P, I):
    N = np.zeros_like(P)
    tri = I.reshape(-1, 3)
    fn = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
    for k in range(3): np.add.at(N, tri[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def finalize(W):
    order = np.argsort(-W, axis=1)[:, :4]
    vals = np.take_along_axis(W, order, 1)
    vals[vals < 0.02] = 0
    s = vals.sum(1, keepdims=True)
    vals = np.where(s > 1e-9, vals / np.maximum(s, 1e-9), 0)
    vals[s[:, 0] <= 1e-9, 0] = 1  # unweighted → first bone (never happens in practice)
    return order.astype(np.uint8), vals.astype(np.float32)


# ---------------------------------------------------------------- body (skin) weights: geodesic
def body_weights(P, I):
    inv, Pw = weld(P, I)
    adj = graph(Pw, inv[I])
    n = len(Pw)
    SEGS = {nm: (JP[i], tail(nm)) for i, nm in enumerate(NAMES)}
    SEGS['hips'] = (np.array([0.0, 0.70, 0.0]), JP[IDX['spine']])  # down through the pelvis
    D = np.stack([seg(Pw, *SEGS[nm])[0] for nm in NAMES], 1)
    T = np.stack([seg(Pw, *SEGS[nm])[1] for nm in NAMES], 1)
    nearest_b = D.argmin(1)
    Ds = np.sort(D, 1)
    clear = (Ds[:, 1] - Ds[:, 0]) > 0.012
    G = np.full((n, len(NAMES)), np.inf)
    for i, nm in enumerate(NAMES):
        short = nm.startswith(('hand', 'toes', 'foot', 'head', 'shoulder', 'neck'))
        lo, hi = (0.05, 0.98) if short else (0.15, 0.85)
        m = (nearest_b == i) & clear & (T[:, i] >= lo) & (T[:, i] <= hi)
        if m.sum() < 6: m = (nearest_b == i) & (T[:, i] >= lo) & (T[:, i] <= hi)
        if m.sum() == 0: m = D[:, i] <= D[:, i].min() + 0.01
        dd = D[m, i]
        cut = np.percentile(dd, 55) if len(dd) > 8 else dd.max()
        seeds = largest_patch(adj, np.where(m)[0][dd <= cut])
        G[:, i] = dijkstra(adj, seeds, n)
    W = 1.0 / (G + 0.016) ** 6
    W[~np.isfinite(G)] = 0
    # shoulders only carry a little (the clavicle barely moves the skin)
    W[:, IDX['shoulder_L']] *= 0.5; W[:, IDX['shoulder_R']] *= 0.5
    W /= np.maximum(W.sum(1, keepdims=True), 1e-30)
    return W[inv]


def region_of_weights(W):
    """0 torso/head, 1 left arm, 2 right arm, 3 left leg, 4 right leg (by dominant bone)"""
    dom = W.argmax(1)
    c = np.zeros(len(W), int)
    for ci, names in ((1, ARM['L']), (2, ARM['R']), (3, LEG['L']), (4, LEG['R'])):
        c[np.isin(dom, [IDX[x] for x in names])] = ci
    return c


ALLOWED = {
    0: TORSO + ('upperLeg_L', 'upperLeg_R', 'shoulder_L', 'shoulder_R', 'upperArm_L', 'upperArm_R'),
    1: ('upperChest', 'chest') + ARM['L'],
    2: ('upperChest', 'chest') + ARM['R'],
    3: ('hips',) + LEG['L'],
    4: ('hips',) + LEG['R'],
}


def regioned_transfer(Q, I, P, W, regions=(0, 1, 2, 3, 4), passes=3, NQ=None):
    """Copy skin weights to a garment WITHOUT a sleeve borrowing from the ribs it hangs beside (or
    the dress hip from the hand resting on it): the garment is split into regions by distance along
    its OWN surface from unambiguous seeds, each region copies only from the matching skin region and
    only its own bones; then a light smoothing closes the seams."""
    if NQ is None: NQ = vertex_normals(Q, I)
    Wn = inner_transfer(Q, NQ, P, W)
    inv, Qw = weld(Q, I)
    adj = graph(Qw, inv[I])
    n = len(Qw)
    # unambiguous seeds by distance to the MIDDLE of a bone (mid upper arm, mid thigh, the spine):
    # never seeded near the hand on the hip, so the skirt under it stays with the torso
    def near_bone(names, rng=(0.25, 0.75), r=0.10):
        m = np.zeros(n, bool)
        for nm_ in names:
            d_, t_ = seg(Qw, JP[IDX[nm_]], tail(nm_))
            m |= (d_ < r) & (t_ > rng[0]) & (t_ < rng[1])
        return m
    seedmask = {
        0: near_bone(('spine', 'chest', 'upperChest'), (0.0, 1.0), 0.16) | near_bone(('hips',), (0.0, 1.0), 0.08),
        1: near_bone(('upperArm_L',)), 2: near_bone(('upperArm_R',)),
        3: near_bone(('lowerLeg_L', 'foot_L'), (0.1, 0.9), 0.09), 4: near_bone(('lowerLeg_R', 'foot_R'), (0.1, 0.9), 0.09),
    }
    # a torso seed must be closer to the torso than to any arm bone (sleeves hang right beside the
    # ribs, a cuff rests on the hip)
    dt_ = np.min(np.stack([seg(Qw, JP[IDX[nm_]], tail(nm_))[0] for nm_ in ('hips', 'spine', 'chest', 'upperChest')], 1), 1)
    def limb_seg(nm_):
        a_, b_ = JP[IDX[nm_]], tail(nm_)
        if nm_.startswith('upperArm'): a_ = a_ + 0.35 * (b_ - a_)   # not the shoulder end (back/shoulder blade)
        return seg(Qw, a_, b_)[0]
    da_ = np.min(np.stack([limb_seg(nm_) for nm_ in ARM['L'][1:] + ARM['R'][1:]], 1), 1)
    seedmask[0] &= dt_ < da_ - 0.01
    # an arm/leg seed must be clearly closer to its limb than to the torso seeds' bones
    D = np.full((n, 5), np.inf)
    for c in regions:
        m = seedmask[c]
        for o in regions:
            if o != c: m = m & ~seedmask[o]
        if m.any(): D[:, c] = dijkstra(adj, np.where(m)[0], n)
    cls_w = D.argmin(1)
    # pieces no seed reaches (a glove is its own little mesh): go by the skin directly underneath
    lost = ~np.isfinite(D.min(1))
    if lost.any():
        # nearest bone (geometry, not weights): a sleeve cuff resting on the hip is still nearest the wrist
        # ...decided once per separate piece, from the piece's centre
        body_bones = [nm_ for nm_ in NAMES if nm_ != 'head']
        lab = -np.ones(n, int); ncomp = 0
        for s0 in np.where(lost)[0]:
            if lab[s0] >= 0: continue
            st = [s0]; lab[s0] = ncomp
            while st:
                u = st.pop()
                for v in adj[u]:
                    if lab[v] < 0: lab[v] = ncomp; st.append(v)
            ncomp += 1
        for c in range(ncomp):
            m = lab == c
            ctr = Qw[m].mean(0)[None, :]
            db = [seg(ctr, JP[IDX[nm_]], tail(nm_))[0][0] for nm_ in body_bones]
            r = int(region_of_weights(np.eye(len(NAMES))[[IDX[body_bones[int(np.argmin(db))]]]])[0])
            cls_w[m] = r if r in regions else regions[0]
    cls = cls_w[inv]
    bcls = region_of_weights(W)
    out = np.zeros_like(Wn)
    for c in regions:
        q, src = cls == c, bcls == c
        if not q.any(): continue
        out[q] = inner_transfer(Q[q], NQ[q], P[src], W[src]) if src.sum() > 40 else Wn[q]
        keep = np.zeros(out.shape[1], bool); keep[[IDX[x] for x in ALLOWED[c]]] = True
        sub = out[q] * keep
        ok = sub.sum(1) > 1e-9
        sub[ok] /= sub[ok].sum(1, keepdims=True)
        rows = np.where(q)[0]
        out[rows[ok]] = sub[ok]
    Ww = np.zeros((n, out.shape[1])); cnt = np.zeros(n)
    np.add.at(Ww, inv, out); np.add.at(cnt, inv, 1); Ww /= np.maximum(cnt, 1)[:, None]
    nbrs = [list(adj[u]) for u in range(n)]
    for _ in range(passes):
        nxt = Ww.copy()
        for u in range(n):
            if nbrs[u]: nxt[u] = 0.55 * Ww[u] + 0.45 * Ww[nbrs[u]].mean(0)
        Ww = nxt
    return Ww[inv]


# ---------------------------------------------------------------- cloak strands
STRAND_ANG = (('L', 52.0), ('C', 0.0), ('R', -52.0))   # degrees around her, 0 = straight behind, + = her left
SEG_T = (0.0, 0.33, 0.66, 1.0)
CAPE_BONES = [f'cape_{s}{k}' for s, _ in STRAND_ANG for k in range(3)]
CAPE_PIN_Y = 1.16      # the cloak is pinned to the shoulders above this height


def cloak_frame(P):
    """per vertex: azimuth around the spine (deg, 0 = behind, + = her left) and t (0 at the
    shoulders, 1 at the hem directly below)"""
    az = np.degrees(np.arctan2(P[:, 0], -P[:, 2]))
    return az


def cloak_rig(C):
    az = cloak_frame(C)
    bottom = np.percentile(C[:, 1], 0.5)
    t = np.clip((CAPE_PIN_Y - C[:, 1]) / (CAPE_PIN_Y - bottom), 0, 1)
    pos, tails = {}, {}
    for s, ang in STRAND_ANG:
        sel = np.abs(az - ang) < 16
        Cs, ts = C[sel], t[sel]
        pts = []
        for k, tk in enumerate(SEG_T):
            w = np.exp(-((ts - tk) / 0.06) ** 2)
            if tk == 1.0: w = np.exp(-((ts - ts.max()) / 0.04) ** 2)
            pts.append((Cs * w[:, None]).sum(0) / max(w.sum(), 1e-9))
        for k in range(3): pos[f'cape_{s}{k}'] = pts[k]
        tails[f'cape_{s}2'] = pts[3]
    return pos, tails, az, t


def cloak_weights(az, t, NB, CB):
    W = np.zeros((len(az), NB))
    angs = np.array([a for _, a in STRAND_ANG])
    wL = np.clip(az / angs[0], 0, 1)
    wR = np.clip(az / angs[2], 0, 1)
    across = {'L': wL, 'C': 1 - wL - wR, 'R': wR}
    cen = np.array([(SEG_T[k] + SEG_T[k + 1]) / 2 for k in range(3)])
    down = np.stack([np.clip(1 - np.abs(t - c) / 0.33, 0, 1) for c in cen], 1)
    down[t >= cen[2], 2] = 1.0
    down[t <= cen[0], 0] = 1.0
    down /= np.maximum(down.sum(1, keepdims=True), 1e-9)
    pin = np.clip((0.1 - t) / 0.1, 0, 1)            # the top 10 % follows the chest
    for s, _ in STRAND_ANG:
        for k in range(3):
            W[:, CB[f'cape_{s}{k}']] = across[s] * down[:, k] * (1 - pin)
    W[:, IDX['upperChest']] = pin
    return W


# ---------------------------------------------------------------- main
def main():
    js, b, parts, info = megumin_src.load()
    print('source:', {k: round(float(v), 3) for k, v in info.items()})
    get = lambda key: [p for p in parts if key in p['name']]
    skin = get('Megumin skin_0')[0]
    NB = len(NAMES) + 2 + len(CAPE_BONES)
    PROP, CAPE = len(NAMES), len(NAMES) + 1
    CB = {n: len(NAMES) + 2 + i for i, n in enumerate(CAPE_BONES)}

    print('skin weights (geodesic)…', flush=True)
    Wsk = body_weights(skin['P'], skin['I'])
    skin['W'] = np.c_[Wsk, np.zeros((len(Wsk), NB - len(NAMES)))]

    # ---- garments
    torso_garments = ('DRESS', 'PANTIES', 'BELT', 'GLOVES')
    leg_garments = ('THIGH HIGH', 'THIGH BANDAGE', 'BOOTS')
    head_parts = ('head_0', 'hairF', 'hairB', 'EYES', 'EYE PATCH', 'EYEBROWS', 'HAT')
    for p in parts:
        if 'W' in p: continue
        n = len(p['P'])
        W = np.zeros((n, NB))
        nm = p['name']
        if any(k in nm for k in head_parts):
            W[:, IDX['head']] = 1
            if 'head_0' in nm or 'hairF' in nm:
                # the bottom of the head mesh (jaw/neck seam) blends into the neck like the skin it meets
                y = p['P'][:, 1]
                k = np.clip((1.30 - y) / 0.05, 0, 1)
                Wk = knn_transfer(p['P'], skin['P'], Wsk)[:, [IDX['neck'], IDX['head']]]
                Wk /= np.maximum(Wk.sum(1, keepdims=True), 1e-9)
                W[:, IDX['neck']] = k * Wk[:, 0]
                W[:, IDX['head']] = 1 - k * Wk[:, 0]
        elif 'COLLAR' in nm:
            W[:, IDX['neck']] = 1
        elif 'STAFF' in nm:
            W[:, PROP] = 1
        elif 'CLOAK' in nm:
            continue  # below, after the bones are placed
        elif any(k in nm for k in leg_garments):
            regs = (3, 4)
            W[:, :len(NAMES)] = regioned_transfer(p['P'], p['I'], skin['P'], Wsk, regions=regs, NQ=p['N'])
        elif any(k in nm for k in torso_garments):
            regs = (0, 1, 2, 3, 4) if 'DRESS' in nm else (0, 3, 4) if ('PANTIES' in nm or 'BELT' in nm) else (1, 2)
            W[:, :len(NAMES)] = regioned_transfer(p['P'], p['I'], skin['P'], Wsk, regions=regs, NQ=p['N'])
        else:
            W[:, :len(NAMES)] = knn_transfer(p['P'], skin['P'], Wsk)
        p['W'] = W
        print(' weighted', nm[:40], flush=True)

    # ---- skin hidden under clothes (pokes through when garments stretch): remove covered faces
    cover = [p for p in parts if any(k in p['name'] for k in ('DRESS', 'PANTIES', 'GLOVES', 'THIGH HIGH', 'BOOTS', 'BANDAGE'))]
    GP = np.concatenate([p['P'] for p in cover])
    GN = np.concatenate([p['N'] if p['N'] is not None else vertex_normals(p['P'], p['I']) for p in cover])
    j, d = nearest(skin['P'], GP)
    inside = ((skin['P'] - GP[j]) * GN[j]).sum(1) < 0.002
    covered = (d < 0.018) & inside
    tri = skin['I'].reshape(-1, 3)
    keep = ~covered[tri].all(1)
    print('skin faces hidden under clothes:', int((~keep).sum()), 'of', len(tri))
    skin['I'] = tri[keep].ravel().copy()

    # ---- staff: pivot on the shaft inside the fist, tail at the orb
    staff = get('STAFF_Megumin staff_0')[0]
    fist = (JP[IDX['hand_R']] + np.array(TAILS['hand_R'])) / 2
    SP = staff['P']
    jn, dn = nearest(fist[None, :], SP)
    near = SP[np.linalg.norm(SP - SP[jn[0]], axis=1) < 0.03]
    grip = near.mean(0)
    orb = get('staff light')[0]['P'].mean(0)

    # ---- cloak
    cloak = get('CLOAK')[0]
    cpos, ctails, az, t = cloak_rig(cloak['P'])
    cloak['W'] = cloak_weights(az, t, NB, CB)

    # ---- ink outline: inverted hulls generated per part from that part's own weights
    OUTLINED = ('skin_0', 'head_0', 'DRESS', 'GLOVES', 'BOOTS', 'THIGH HIGH', 'BANDAGE', 'HAT', 'hairF', 'hairB', 'CLOAK', 'STAFF_Megumin staff_0', 'BELT')
    outl = []
    for p in parts:
        if not any(k in p['name'] for k in OUTLINED): continue
        inv, Pw = weld(p['P'], p['I'])
        Nw = np.zeros_like(Pw)
        Ns = p['N'] if p['N'] is not None else vertex_normals(p['P'], p['I'])
        np.add.at(Nw, inv, Ns)
        Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-12)
        th = 0.0034 * (0.6 if any(k in p['name'] for k in ('hair', 'STAFF')) else 1.0)
        outl.append(dict(name='outline_' + p['name'].split('_Megumin')[0].replace('MEGUMIN ', '').strip().replace(' ', '_').lower(),
                         mat=None, P=p['P'] + Nw[inv] * th, N=None, UV=None, I=p['I'].reshape(-1, 3)[:, ::-1].ravel().copy(), W=p['W'].copy()))
    parts = parts + outl

    # ---------------------------------------------------------------- joints
    jnames = NAMES + ['prop_R', 'cape'] + CAPE_BONES
    jparent = [bb[1] for bb in BONES] + ['hand_R', 'upperChest'] + [('cape' if c.endswith('0') else c[:-1] + str(int(c[-1]) - 1)) for c in CAPE_BONES]
    cape_root = np.array([0.0, CAPE_PIN_Y + 0.02, -0.06])
    joints = np.vstack([JP, grip[None, :], cape_root[None, :]] + [cpos[c][None, :] for c in CAPE_BONES]).astype(np.float32)
    tails = {**TAILS, 'prop_R': tuple(orb), 'cape': tuple(cape_root + np.array([0, -0.1, -0.05])), **{k: tuple(v) for k, v in ctails.items()}}

    binbuf = bytearray(); bvs = []; accs = []
    def push(data, target=None, comp=5126, typ='VEC3', minmax=False):
        while len(binbuf) % 4: binbuf.append(0)
        raw = data.tobytes()
        bv = {'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}
        if target: bv['target'] = target
        binbuf.extend(raw); bvs.append(bv)
        a = {'bufferView': len(bvs) - 1, 'componentType': comp, 'count': len(data), 'type': typ}
        if minmax: a['min'] = data.min(0).tolist(); a['max'] = data.max(0).tolist()
        accs.append(a); return len(accs) - 1

    # textures: keep alpha (PNG) where the material blends, otherwise 2048 px JPEG
    blend_imgs = set()
    for m in js['materials']:
        bc = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if bc and m.get('alphaMode') in ('BLEND', 'MASK'): blend_imgs.add(js['textures'][bc['index']]['source'])
    images = []
    for ii in range(len(js['images'])):
        im = Image.open(io.BytesIO(image_bytes(js, b, ii)))
        im.thumbnail((2048, 2048), Image.LANCZOS)
        bio = io.BytesIO()
        if ii in blend_imgs: im.convert('RGBA').save(bio, 'PNG', optimize=True); mime = 'image/png'
        else: im.convert('RGB').save(bio, 'JPEG', quality=90); mime = 'image/jpeg'
        raw = bio.getvalue()
        while len(binbuf) % 4: binbuf.append(0)
        bvs.append({'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}); binbuf.extend(raw)
        images.append({'bufferView': len(bvs) - 1, 'mimeType': mime})
    materials = [{'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.02, 0.03, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}}]
    mat_map = {None: 0}
    for mi, m in enumerate(js['materials']):
        pb = m.get('pbrMetallicRoughness', {})
        bc = pb.get('baseColorTexture')
        out = {'name': m.get('name', f'm{mi}'), 'doubleSided': True, 'extensions': {'KHR_materials_unlit': {}},
               'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1}}
        if bc: out['pbrMetallicRoughness']['baseColorTexture'] = {'index': js['textures'][bc['index']]['source']}
        else: out['pbrMetallicRoughness']['baseColorFactor'] = pb.get('baseColorFactor', [1, 1, 1, 1])
        if m.get('alphaMode') == 'BLEND': out['alphaMode'] = 'BLEND'
        materials.append(out); mat_map[mi] = len(materials) - 1

    nodes = [{'name': 'Meteora', 'children': []}]
    jnode = {}
    for i, nm in enumerate(jnames):
        jnode[nm] = len(nodes)
        par = jparent[i]
        pp = joints[jnames.index(par)] if par else np.zeros(3, np.float32)
        nodes.append({'name': nm, 'translation': (joints[i] - pp).astype(float).tolist(), 'children': []})
    for i, nm in enumerate(jnames):
        par = jparent[i]
        (nodes[jnode[par]]['children'] if par else nodes[0]['children']).append(jnode[nm])
    for nm, tp in tails.items():
        nodes.append({'name': nm + '_end', 'translation': (np.array(tp, np.float32) - joints[jnames.index(nm)]).astype(float).tolist()})
        nodes[jnode[nm]]['children'].append(len(nodes) - 1)
    ibm = np.zeros((len(jnames), 16), np.float32)
    for i in range(len(jnames)):
        m4 = np.eye(4, dtype=np.float32); m4[:3, 3] = -joints[i]; ibm[i] = m4.T.reshape(-1)
    skins = [{'joints': [jnode[n] for n in jnames], 'skeleton': jnode['hips'], 'inverseBindMatrices': push(ibm, typ='MAT4')}]

    # drop vertices no triangle uses (most of the skin is hidden under the clothes)
    for p in parts:
        used = np.unique(p['I'])
        remap = -np.ones(len(p['P']), np.int64); remap[used] = np.arange(len(used))
        for k in ('P', 'N', 'UV', 'W'):
            if p.get(k) is not None: p[k] = p[k][used]
        p['I'] = remap[p['I']].astype(np.uint32)

    meshes = []
    for p in parts:
        J, W = finalize(p['W'])
        attrs = {'POSITION': push(p['P'].astype(np.float32), 34962, minmax=True)}
        if p['N'] is not None: attrs['NORMAL'] = push(p['N'].astype(np.float32), 34962)
        if p['UV'] is not None: attrs['TEXCOORD_0'] = push(p['UV'].astype(np.float32), 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(J, 34962, comp=5121, typ='VEC4')
        # weights as normalized bytes (4 B/vertex instead of 16); keep each row summing to exactly 255
        Wq = np.round(W * 255).astype(np.int32)
        Wq[np.arange(len(Wq)), Wq.argmax(1)] += 255 - Wq.sum(1)
        attrs['WEIGHTS_0'] = push(Wq.astype(np.uint8), 34962, comp=5121, typ='VEC4')
        accs[attrs['WEIGHTS_0']]['normalized'] = True
        idx = p['I'].astype(np.uint16 if p['I'].max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        name = p['name'] if p['name'].startswith('outline_') else p['name'].split('_Megumin')[0].replace('MEGUMIN ', '').strip().replace(' ', '_').lower() + '_' + p['name'].split('_Megumin ')[-1].replace('_0', '').replace(' ', '_').replace('-', '_')
        meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_map[p['mat']]}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'skin': 0}); nodes[0]['children'].append(len(nodes) - 1)

    gl = {'asset': {'version': '2.0', 'generator': 'magebreak rig_megumin.py'}, 'extensionsUsed': ['KHR_materials_unlit'],
          'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
          'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
          'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
          'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, gl, bytes(binbuf))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
