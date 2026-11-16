"""Auto-rig METEORA (the meteor-girl mage) for Magebreak.

Input : tools/characters/src/meteora_original.glb   (static mesh in a mid-air pose, Z-up, ~135 units)
Output: public/models/meteora.glb                   (skinned, Y-up, meters, faces +Z)

The source is posed (legs folded, one hand on the hat, staff held out), not a T-pose, so:
  * body skin weights use GEODESIC distance (Dijkstra over the welded surface) from seed rings
    on each bone, so folded limbs that touch in space (calf ↔ thigh, hand ↔ hat) don't blend;
  * clothes/boots copy weights from the nearest skin vertices (k-NN average);
  * the staff gets its own `prop_R` bone (child of the right hand) and is shortened 25% around
    the grip so it doesn't hit the ground when held upright;
  * the cape gets a `cape` bone (child of upperChest) for procedural sway;
  * the runtime retargeter (src/character/rig.js) straightens everything into the standard stance.

Usage: python3 tools/characters/rig_meteora.py [src.glb] [out.glb]   (numpy + Pillow)
"""
import io, os, sys, heapq
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbmesh import read_glb, baked_primitives, image_bytes  # noqa: E402
from strip_glb import write_glb  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'src', 'meteora_original.glb')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'meteora.glb')

S = 1.56 / 136.0  # straightened stature ≈ 1.56 m (+ hat)

# ---------------------------------------------------------------- skeleton (source units, Y-up, faces +Z)
BONES = [
    ('hips', None, (-3.0, 0.0, -6.0)),
    ('spine', 'hips', (-3.0, 12.0, -6.0)),
    ('chest', 'spine', (-3.0, 24.0, -5.5)),
    ('upperChest', 'chest', (-3.0, 33.0, -5.0)),
    ('neck', 'upperChest', (-3.2, 44.0, -5.0)),
    ('head', 'neck', (-3.5, 49.0, -4.5)),
    ('shoulder_L', 'upperChest', (-1.0, 40.5, -5.0)),
    ('upperArm_L', 'shoulder_L', (5.0, 41.0, -3.0)),
    ('foreArm_L', 'upperArm_L', (6.0, 36.0, 20.0)),
    ('hand_L', 'foreArm_L', (4.0, 54.5, 14.5)),
    ('shoulder_R', 'upperChest', (-5.0, 40.5, -5.5)),
    ('upperArm_R', 'shoulder_R', (-11.0, 40.0, -8.0)),
    ('foreArm_R', 'upperArm_R', (-19.0, 25.0, -30.0)),
    ('hand_R', 'foreArm_R', (-41.0, 18.5, -29.5)),
    ('upperLeg_L', 'hips', (2.0, -6.0, -6.0)),
    ('lowerLeg_L', 'upperLeg_L', (0.0, -22.0, 4.0)),
    ('foot_L', 'lowerLeg_L', (18.3, -22.5, -25.0)),
    ('toes_L', 'foot_L', (20.3, -31.0, -27.5)),
    ('upperLeg_R', 'hips', (-8.0, -7.0, -6.0)),
    ('lowerLeg_R', 'upperLeg_R', (-8.5, -15.0, 14.0)),
    ('foot_R', 'lowerLeg_R', (-2.2, -19.0, -16.5)),
    ('toes_R', 'foot_R', (1.2, -28.0, -16.8)),
]
TAILS = {
    'head': (-3.5, 69.0, -5.0),
    'hand_L': (2.5, 63.0, 12.0),
    'hand_R': (-50.0, 21.0, -26.5),
    'toes_L': (21.0, -36.5, -29.0),
    'toes_R': (2.2, -33.5, -17.0),
}
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
JP = np.array([b[2] for b in BONES], dtype=np.float64)
CHILD = {b[1]: b[0] for b in BONES if b[1]}
CHILD.update({'hips': 'spine', 'spine': 'chest', 'chest': 'upperChest', 'upperChest': 'neck', 'neck': 'head',
              'shoulder_L': 'upperArm_L', 'upperArm_L': 'foreArm_L', 'foreArm_L': 'hand_L',
              'shoulder_R': 'upperArm_R', 'upperArm_R': 'foreArm_R', 'foreArm_R': 'hand_R',
              'upperLeg_L': 'lowerLeg_L', 'lowerLeg_L': 'foot_L', 'foot_L': 'toes_L',
              'upperLeg_R': 'lowerLeg_R', 'lowerLeg_R': 'foot_R', 'foot_R': 'toes_R'})


def tail(n):
    return np.array(TAILS[n], dtype=np.float64) if n in TAILS else JP[IDX[CHILD[n]]]


def yup(v): return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def seg(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t


# ---------------------------------------------------------------- geodesic skin weights
def weld(P, I):
    key = np.round(P * 200).astype(np.int64)
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
    """keep the biggest surface-connected cluster of seed vertices (drops stray patches on a
    neighbouring limb that merely touches this bone in the folded source pose)"""
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


def body_weights(P, I):
    inv, Pw = weld(P, I)
    Iw = inv[I]
    adj = graph(Pw, Iw)
    n = len(Pw)
    # seeding capsules: the hips capsule reaches down through the pelvis/buttocks, which no
    # bone passes through in this kneeling pose (otherwise the folded heel claims them)
    SEG = {nm: (JP[i], tail(nm)) for i, nm in enumerate(NAMES)}
    SEG['hips'] = (np.array([-3.0, -15.0, -12.0]), JP[IDX['spine']])
    D = np.stack([seg(Pw, *SEG[nm])[0] for nm in NAMES], 1)
    T = np.stack([seg(Pw, *SEG[nm])[1] for nm in NAMES], 1)
    nearest = D.argmin(1)
    Ds = np.sort(D, 1)
    clear = (Ds[:, 1] - Ds[:, 0]) > 4.0  # unambiguous: clearly closer to one bone than any other
    G = np.full((n, len(NAMES)), np.inf)
    for i, nm in enumerate(NAMES):
        short = nm.startswith(('hand', 'toes', 'foot', 'head', 'shoulder', 'neck'))
        lo, hi = (0.05, 0.98) if short else (0.15, 0.85)
        m = (nearest == i) & clear & (T[:, i] >= lo) & (T[:, i] <= hi)
        if nm == 'head': m = (nearest == i) & (Pw[:, 1] > JP[IDX['head']][1] + 2)
        if m.sum() < 6: m = (nearest == i) & (T[:, i] >= lo) & (T[:, i] <= hi)
        if m.sum() == 0:
            m = D[:, i] <= D[:, i].min() + 1.0
        # keep the closest ring around the bone only
        dd = D[m, i]
        cut = np.percentile(dd, 55) if len(dd) > 8 else dd.max()
        seeds = np.where(m)[0][dd <= cut]
        seeds = largest_patch(adj, seeds)
        G[:, i] = dijkstra(adj, seeds, n)
    W = 1.0 / (G + 1.5) ** 6
    W[~np.isfinite(G)] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    return W[inv]


def finalize(W):
    order = np.argsort(-W, axis=1)[:, :4]
    vals = np.take_along_axis(W, order, 1)
    vals[vals < 0.02] = 0
    vals /= np.maximum(vals.sum(1, keepdims=True), 1e-9)
    return order.astype(np.uint8), vals.astype(np.float32)


def components(P, I):
    key = np.round(P * 200).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    par = np.arange(inv.max() + 1)
    def f(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for t in I.reshape(-1, 3):
        a, b2, c = inv[t]; ra = f(a); par[f(b2)] = ra; par[f(c)] = ra
    return np.array([f(inv[i]) for i in range(len(P))])


def knn_transfer(Q, P, W, k=6):
    out = np.zeros((len(Q), W.shape[1]))
    for s in range(0, len(Q), 256):
        d = ((Q[s:s + 256, None, :] - P[None, :, :]) ** 2).sum(-1)
        idx = np.argpartition(d, k, axis=1)[:, :k]
        dd = np.take_along_axis(d, idx, 1)
        w = 1.0 / (np.sqrt(dd) + 0.3) ** 2
        w /= w.sum(1, keepdims=True)
        out[s:s + 256] = (W[idx] * w[:, :, None]).sum(1)
    return out


# ---------------------------------------------------------------- cape (re-draped + physics strands)
CAPE_CX, CAPE_CZ = -3.0, -6.5      # body axis (source units)
CAPE_TOP, CAPE_LEN = 45.5, 84.0    # collar height, collar → hem (hem ≈ mid-calf once standing)
STRANDS = (('L', 62.0), ('C', 0.0), ('R', -62.0))   # angle around the back (+ = her left)
SEG_T = (0.1, 0.4, 0.7, 1.0)                         # joint positions down the cape (t)
CAPE_BONES = [f'cape_{s}{k}' for s, _ in STRANDS for k in range(3)]


def cape_shape(a, t):
    """(a across ∈ [-1,1], t down ∈ [0,1]) → source-space point on the hanging cape"""
    ramp = np.clip(t / 0.09, 0, 1)
    sm = ramp * ramp * (3 - 2 * ramp)
    wrap = np.radians(150 - 50 * sm - 22 * np.clip((t - 0.09) / 0.91, 0, 1))   # around the neck → sides → behind
    R = 6.5 + 11.0 * sm + 5.0 * np.clip((t - 0.09) / 0.91, 0, 1) ** 1.2              # neck → shoulders → flared hem
    th = a * wrap
    x = CAPE_CX + R * np.sin(th)
    z = CAPE_CZ - R * np.cos(th) * 0.98 - 3.0 * t
    y = CAPE_TOP - CAPE_LEN * t
    return np.stack([x, y, z], -1)


def drape_cape(UV):
    u, v = UV[:, 0], UV[:, 1]
    t = (u.max() - u) / (u.max() - u.min())
    # across: normalise v within each band of t (the layout is a trapezoid)
    bins = np.clip((t * 24).astype(int), 0, 23)
    lo = np.array([v[bins == k].min() if (bins == k).any() else v.min() for k in range(24)])
    hi = np.array([v[bins == k].max() if (bins == k).any() else v.max() for k in range(24)])
    tc = (np.arange(24) + 0.5) / 24
    vlo, vhi = np.interp(t, tc, lo), np.interp(t, tc, hi)
    a = np.clip((v - (vlo + vhi) / 2) / np.maximum((vhi - vlo) / 2, 1e-6), -1, 1)
    return cape_shape(a, t), a, t


def vertex_normals(P, I):
    N = np.zeros_like(P)
    tri = I.reshape(-1, 3)
    fn = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
    for k in range(3): np.add.at(N, tri[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)


def cape_joint_pos():
    """head position of every cape bone (+ strand tails), on the draped surface"""
    pos, tails = {}, {}
    for sname, ang in STRANDS:
        wrap0 = 1.0  # angle → a at each t
        for k in range(3):
            t = SEG_T[k]
            ramp = min(t / 0.09, 1); sm = ramp * ramp * (3 - 2 * ramp)
            wrap = 150 - 50 * sm - 22 * np.clip((t - 0.09) / 0.91, 0, 1)
            pos[f'cape_{sname}{k}'] = cape_shape(np.array(ang / wrap), np.array(t))
        t = 1.0
        wrap = 150 - 50 - 22
        tails[f'cape_{sname}2'] = tuple(cape_shape(np.array(ang / wrap), np.array(t)).tolist())
    return pos, tails


def cape_weights(a, t, NB, CB):
    n = len(a)
    W = np.zeros((n, NB))
    ramp = np.clip(t / 0.09, 0, 1); sm = ramp * ramp * (3 - 2 * ramp)
    wrapd = 150 - 50 * sm - 22 * np.clip((t - 0.09) / 0.91, 0, 1)
    th = a * wrapd
    # across: piecewise-linear between strand angles (beyond the side strands → that strand)
    angs = np.array([g for _, g in STRANDS])  # 62, 0, -62
    wL = np.clip(th / angs[0], 0, 1)
    wR = np.clip(th / angs[2], 0, 1)
    wC = 1 - wL - wR
    across = {'L': wL, 'C': wC, 'R': wR}
    # down: hat functions centred mid-segment; the collar is pinned to the chest
    cen = np.array([(SEG_T[k] + SEG_T[k + 1]) / 2 for k in range(3)])
    h = 0.3
    down = np.stack([np.clip(1 - np.abs(t - c) / h, 0, 1) for c in cen], 1)
    down[t >= cen[2], 2] = 1.0
    down[t <= cen[0], 0] = np.maximum(down[t <= cen[0], 0], 1.0)
    down /= np.maximum(down.sum(1, keepdims=True), 1e-9)
    collar = np.clip((0.17 - t) / 0.12, 0, 1)
    for sname, _ in STRANDS:
        for k in range(3):
            W[:, CB[f'cape_{sname}{k}']] = across[sname] * down[:, k] * (1 - collar)
    W[:, IDX['upperChest']] = collar
    return W


ARM_GROUPS = {
    'L': ('shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L'),
    'R': ('shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R'),
}


def body_class(W):
    """0 = torso/legs/head, 1 = left arm, 2 = right arm (by dominant bone; shoulders count as arm),
    3 = the staff"""
    dom = W.argmax(1)
    c = np.zeros(len(W), int)
    for ci, side in ((1, 'L'), (2, 'R')):
        c[np.isin(dom, [IDX[n] for n in ARM_GROUPS[side]])] = ci
    if W.shape[1] > len(NAMES): c[dom == len(NAMES)] = 3
    return c


def regioned_transfer(Q, I, P, W, k=6, passes=3, arm_band=False, allowed=None):
    """Copy skin weights from a source surface to a garment/outline WITHOUT letting a sleeve borrow
    from the ribs it hangs beside. The target is split into left arm / right arm / torso / staff by
    distance along its OWN surface from unambiguous seeds, then each region copies only from the
    matching source region; a short smoothing pass along the target closes seams."""
    Wn = knn_transfer(Q, P, W, k=k)
    inv, Qw = weld(Q, I)
    adj = graph(Qw, inv[I])
    n = len(Qw)
    domw = np.zeros(n, int); domw[inv] = Wn.argmax(1)
    seeds = {
        1: np.isin(domw, [IDX['foreArm_L'], IDX['hand_L']]),
        2: np.isin(domw, [IDX['foreArm_R'], IDX['hand_R']]),
        0: np.isin(domw, [IDX[n_] for n_ in ('hips', 'spine', 'chest', 'upperLeg_L', 'upperLeg_R', 'head', 'neck')]),
    }
    if W.shape[1] > len(NAMES): seeds[3] = domw == len(NAMES)
    D = np.full((n, 4), np.inf)
    for c, m in seeds.items():
        if m.any(): D[:, c] = dijkstra(adj, np.where(m)[0], n)
    cls_w = D.argmin(1)
    cls_w[~np.isfinite(D.min(1))] = 0
    if allowed is not None:
        # unambiguous by plain distance: much closer to an arm bone than to the spine axis
        # (the source pose swings her right arm far back, bunching the sleeve top behind her
        # shoulder where the surface path runs through the dress back)
        dax = np.hypot(Qw[:, 0] - CAPE_CX, Qw[:, 2] - CAPE_CZ)
        for c, side in ((1, 'L'), (2, 'R')):
            da = np.min(np.stack([seg(Qw, JP[IDX[b_]], tail(b_))[0] for b_ in ('upperArm_' + side, 'foreArm_' + side, 'hand_' + side)], 1), 1)
            cls_w[(da < 0.5 * dax) & (da < 9.0) & (Qw[:, 1] > 15) & (Qw[:, 2] < CAPE_CZ - 4)] = c
    if arm_band:
        # the off-shoulder band of the dress wraps the top of each upper arm: anything outside the
        # torso's width at shoulder height belongs to that arm
        dx = Qw[:, 0] - CAPE_CX
        band = (Qw[:, 1] > 29) & (np.abs(dx) > 9.0)
        cls_w[band & (dx > 0)] = 1
        cls_w[band & (dx < 0)] = 2
    cls = cls_w[inv]
    bcls = body_class(W)
    out = np.zeros_like(Wn)
    for c in (0, 1, 2, 3):
        q, src = cls == c, bcls == c
        if q.any(): out[q] = knn_transfer(Q[q], P[src], W[src], k=k) if src.sum() > 8 else Wn[q]
    if allowed is not None:
        # each region may only follow its own bones (no head / other-arm weights leaking onto a
        # dress back, which tugs it out through the cape)
        for c, names in allowed.items():
            m = cls == c
            if not m.any(): continue
            keep = np.zeros(out.shape[1], bool); keep[[IDX[n_] for n_ in names]] = True
            sub = out[m] * keep
            ok = sub.sum(1) > 1e-6
            sub[ok] /= sub[ok].sum(1, keepdims=True)
            out[np.where(m)[0][ok]] = sub[ok]
    Ww = np.zeros((n, out.shape[1])); cnt = np.zeros(n)
    np.add.at(Ww, inv, out); np.add.at(cnt, inv, 1); Ww /= np.maximum(cnt, 1)[:, None]
    nbrs = [[v for v in adj[u] if cls_w[v] == cls_w[u]] for u in range(n)]
    for _ in range(passes):
        nxt = Ww.copy()
        for u in range(n):
            if nbrs[u]: nxt[u] = 0.5 * Ww[u] + 0.5 * Ww[nbrs[u]].mean(0)
        Ww = nxt
    # stitch the seams between regions: blend across the boundary over a couple of rings
    seam = np.array([any(cls_w[v] != cls_w[u] for v in adj[u]) for u in range(n)])
    ring = seam.copy()
    for _ in range(2): ring = ring | np.array([any(ring[v] for v in adj[u]) for u in range(n)])
    for _ in range(3):
        nxt = Ww.copy()
        for u in np.where(ring)[0]:
            nb = list(adj[u])
            if nb: nxt[u] = 0.4 * Ww[u] + 0.6 * Ww[nb].mean(0)
        Ww = nxt
    return Ww[inv]


def main():
    js, b = read_glb(SRC)
    prims = baked_primitives(js, b, 0)
    parts = []
    for nm, mat, P, N, UV, I in prims:
        parts.append(dict(name=nm, mat=mat, P=yup(P), N=yup(N) if N is not None else None, UV=UV, I=I))
    get = lambda pre: [p for p in parts if p['name'].startswith(pre)]
    body = get('body_mesh')[0]
    NB = len(NAMES) + 2 + len(CAPE_BONES)  # + prop_R, cape root, cape strands
    PROP, CAPE = len(NAMES), len(NAMES) + 1
    CB = {n: len(NAMES) + 2 + i for i, n in enumerate(CAPE_BONES)}

    print('body weights (geodesic)…', flush=True)
    Wb = body_weights(body['P'], body['I'])
    body['W'] = np.c_[Wb, np.zeros((len(Wb), 2))]
    # tuck the lower-leg skin inside the boots (the crushed back-of-knee crease would poke out)
    for side in ('L', 'R'):
        sh = IDX['lowerLeg_' + side]
        w = Wb[:, sh] + Wb[:, IDX['foot_' + side]] + Wb[:, IDX['toes_' + side]]
        a0, b0 = JP[sh], tail('lowerLeg_' + side)
        d, t = seg(body['P'], a0, b0)
        foot = a0 + t[:, None] * (b0 - a0)
        k = np.clip((w - 0.45) / 0.4, 0, 1) * np.clip((t - 0.12) / 0.2, 0, 1) * 0.3
        body['P'] = body['P'] - (body['P'] - foot) * k[:, None]

    head_parts = ('Tongue', 'Teeth', 'MouthInside', 'eyeline', 'sclera', 'eyepatch', 'hat', 'eyebrow', 'eyelash', 'hair', 'eye_mesh')
    head = IDX['head']
    for p in parts:
        if 'W' in p: continue
        n = len(p['P'])
        W = np.zeros((n, NB))
        if p['name'].startswith(head_parts):
            W[:, head] = 1
        elif p['name'].startswith(('staff', 'StaffBall')):
            W[:, PROP] = 1
        elif p['name'].startswith('cape'):
            # The source cape is frozen mid-flutter. Re-drape it from its UV layout (u: collar→hem,
            # v: across the back) into a cape hanging from her shoulders, then hang it on three
            # strands of bones (left / centre / right) that the runtime simulates with gravity.
            Q, A_, T_ = drape_cape(p['UV'])
            p['P'] = Q
            p['N'] = vertex_normals(Q, p['I'])
            W[:] = cape_weights(A_, T_, NB, CB)
        elif p['name'].startswith('Megumin_stroke'):
            continue  # outline: after everything else
        elif p['name'].startswith('boots'):
            # each boot copies only from its own leg (the folded legs touch each other)
            roots = components(p['P'], p['I'])
            dom = Wb.argmax(1)
            for r in np.unique(roots):
                m = roots == r
                c = p['P'][m].mean(0)
                side = 'L' if np.linalg.norm(c - JP[IDX['foot_L']]) < np.linalg.norm(c - JP[IDX['foot_R']]) else 'R'
                leg = [IDX[x + side] for x in ('lowerLeg_', 'foot_', 'toes_')]
                src = np.isin(dom, leg)
                Wl = np.zeros_like(Wb); Wl[:, leg] = Wb[:, leg]
                Wl /= np.maximum(Wl.sum(1, keepdims=True), 1e-9)
                W[m, :len(NAMES)] = knn_transfer(p['P'][m], body['P'][src], Wl[src])
        else:
            if p['name'].startswith('cloth'):
                W[:, :len(NAMES)] = regioned_transfer(p['P'], p['I'], body['P'], Wb[:, :len(NAMES)], allowed={
                    0: ('hips', 'spine', 'chest', 'upperChest', 'neck', 'upperLeg_L', 'upperLeg_R'),
                    1: ('chest', 'upperChest', 'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L'),
                    2: ('chest', 'upperChest', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R')})
            else:
                W[:, :len(NAMES)] = knn_transfer(p['P'], body['P'], Wb)
            if p['name'].startswith('cloth'):
                # skirt: soften toward the hips so it doesn't shred between the legs
                y = p['P'][:, 1]
                skirt = np.clip((JP[IDX['hips']][1] + 4 - y) / 12.0, 0, 1) * 0.5
                legs = [IDX[x] for x in ('upperLeg_L', 'upperLeg_R', 'lowerLeg_L', 'lowerLeg_R')]
                moved = W[:, legs].sum(1) * skirt
                W[:, legs] *= (1 - skirt)[:, None]
                W[:, IDX['hips']] += moved
        p['W'] = W

    # shorten the staff 25% around the grip (projection of the right palm on the staff axis)
    staff = get('staff_mesh')[0]
    c = staff['P'].mean(0)
    _, _, vt = np.linalg.svd(staff['P'] - c)
    ax = vt[0]
    if ax[1] < 0: ax = -ax  # point toward the orb end
    palm = (JP[IDX['hand_R']] + np.array(TAILS['hand_R'])) / 2
    grip = c + ax * ((palm - c) @ ax)
    def shrink(Q):
        t = (Q - grip) @ ax
        return Q - ax[None, :] * (t * 0.25)[:, None]
    for p in get('staff') + get('StaffBall'):
        p['P'] = shrink(p['P'])
    staff_top = grip + ax * 52  # orb centre (after the 25% shortening)

    # skin hidden under the dress never needs to render, and it is what pokes through the cloth
    # when the arm/torso weights disagree: delete body faces fully covered by the dress
    cloth = get('cloth')[0]
    cN = cloth['N'] if cloth['N'] is not None else None
    Pb = body['P']
    covered = np.zeros(len(Pb), bool)
    for s0 in range(0, len(Pb), 512):
        d = ((Pb[s0:s0 + 512, None, :] - cloth['P'][None, :, :]) ** 2).sum(-1)
        j = d.argmin(1); dist = np.sqrt(d[np.arange(len(j)), j])
        behind = ((Pb[s0:s0 + 512] - cloth['P'][j]) * cN[j]).sum(1) < 0.4 if cN is not None else np.ones(len(j), bool)
        covered[s0:s0 + 512] = (dist < 3.2) & behind
    tri = body['I'].reshape(-1, 3)
    keep = ~covered[tri].all(1)
    print('hidden body faces under the dress:', int((~keep).sum()), 'of', len(tri))
    body['I'] = tri[keep].ravel().copy()
    body['hide'] = covered

    # the top of the cape is pinned to the chest, so torso clothing right under it is never seen —
    # and the dress's stiff shoulder flaps poke through it. Remove those torso faces.
    for p in parts:
        if not p['name'].startswith(('cloth', 'body')) or 'W' not in p: continue
        Q = p['P']
        t = (CAPE_TOP - Q[:, 1]) / CAPE_LEN
        ramp = np.clip(t / 0.09, 0, 1); sm = ramp * ramp * (3 - 2 * ramp)
        R = 6.5 + 11.0 * sm + 5.0 * np.clip((t - 0.09) / 0.91, 0, 1) ** 1.2
        wrap = np.radians(150 - 50 * sm - 22 * np.clip((t - 0.09) / 0.91, 0, 1))
        dx, dz = Q[:, 0] - CAPE_CX, (Q[:, 2] - CAPE_CZ + 3.0 * t) / 0.98
        r, th = np.hypot(dx, dz), np.abs(np.arctan2(dx, -dz))
        torso = body_class(p['W'][:, :len(NAMES)]) == 0
        under = (t > 0.06) & (t < 0.2) & (r < R * 0.98) & (th < wrap * 0.8) & ((dz < 0) & torso | (dz < -2.5))
        tri = p['I'].reshape(-1, 3)
        keep = ~under[tri].all(1)
        if (~keep).any(): print('hidden under the cape collar:', p['name'][:12], int((~keep).sum()))
        p['I'] = tri[keep].ravel().copy()

    # ink outline: an inverted hull generated from each visible part with that part's OWN weights,
    # so it can never drift off the surface it outlines (the source stroke mesh borrowed weights
    # from whatever was nearest, which put black streaks on the arms and shoulders)
    stroke = get('Megumin_stroke')[0]
    parts[:] = [p for p in parts if not p['name'].startswith('Megumin_stroke')]
    OUTLINED = ('body', 'cloth', 'hat', 'hair', 'boots', 'belt', 'choker', 'staff', 'StaffBall')
    PUSH = 0.42
    for p in list(parts):
        if not p['name'].startswith(OUTLINED): continue
        inv, Pw = weld(p['P'], p['I'])
        Nw = np.zeros_like(Pw)
        Nsrc = p['N'] if p['N'] is not None else vertex_normals(p['P'], p['I'])
        np.add.at(Nw, inv, Nsrc)
        Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-9)
        thick = PUSH * (0.6 if p['name'].startswith(('hair', 'StaffBall', 'choker')) else 1.0)
        parts.append(dict(name='Megumin_stroke_' + p['name'].split('_UV')[0], mat=stroke['mat'], P=p['P'] + Nw[inv] * thick,
                          N=None, UV=None, I=p['I'].reshape(-1, 3)[:, ::-1].ravel().copy(), W=p['W'].copy()))

    # ---------------------------------------------------------------- to meters, feet ~0
    floor = min(JP[IDX['toes_L']][1], JP[IDX['toes_R']][1])
    off = np.array([3.0, 0.0, 5.0])
    def T(v): return ((v + off) * S).astype(np.float32)
    cpos, ctails = cape_joint_pos()
    joints = np.vstack([JP, grip[None, :], np.array([[CAPE_CX, CAPE_TOP - 1.0, CAPE_CZ]])] + [cpos[n][None, :] for n in CAPE_BONES])
    jnames = NAMES + ['prop_R', 'cape'] + CAPE_BONES
    jparent = [b[1] for b in BONES] + ['hand_R', 'upperChest'] + [('cape' if n.endswith('0') else n[:-1] + str(int(n[-1]) - 1)) for n in CAPE_BONES]
    jm = T(joints)
    tails = {**TAILS, 'prop_R': staff_top, 'cape': (CAPE_CX, CAPE_TOP - 9.0, CAPE_CZ - 10.0), **ctails}

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

    # textures (opaque → 2048 px JPEG)
    images = []
    for ii in range(len(js['images'])):
        im = Image.open(io.BytesIO(image_bytes(js, b, ii))).convert('RGB')
        im = im.resize((min(2048, im.width), min(2048, im.height)), Image.LANCZOS)
        bio = io.BytesIO(); im.save(bio, 'JPEG', quality=90)
        raw = bio.getvalue()
        while len(binbuf) % 4: binbuf.append(0)
        bvs.append({'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}); binbuf.extend(raw)
        images.append({'bufferView': len(bvs) - 1, 'mimeType': 'image/jpeg'})
    tex_of_mat = {}
    for mi, m in enumerate(js['materials']):
        bc = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        tex_of_mat[mi] = js['textures'][bc['index']]['source'] if bc else None
    materials = []
    mat_map = {}
    for mi, m in enumerate(js['materials']):
        src = tex_of_mat[mi]
        if src is None:
            materials.append({'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.02, 0.03, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}})
        else:
            materials.append({'name': m.get('name', f'm{mi}'), 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': src}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'extensions': {'KHR_materials_unlit': {}}})
        mat_map[mi] = len(materials) - 1

    nodes = [{'name': 'Meteora', 'children': []}]
    jnode = {}
    for i, nm in enumerate(jnames):
        jnode[nm] = len(nodes)
        par = jparent[i]
        pp = jm[jnames.index(par)] if par else np.zeros(3, np.float32)
        nodes.append({'name': nm, 'translation': (jm[i] - pp).astype(float).tolist(), 'children': []})
    for i, nm in enumerate(jnames):
        par = jparent[i]
        (nodes[jnode[par]]['children'] if par else nodes[0]['children']).append(jnode[nm])
    for nm, tp in tails.items():
        t_m = T(np.array([tp], dtype=np.float64))[0]
        nodes.append({'name': nm + '_end', 'translation': (t_m - jm[jnames.index(nm)]).astype(float).tolist()})
        nodes[jnode[nm]]['children'].append(len(nodes) - 1)
    ibm = np.zeros((len(jnames), 16), np.float32)
    for i in range(len(jnames)):
        m4 = np.eye(4, dtype=np.float32); m4[:3, 3] = -jm[i]; ibm[i] = m4.T.reshape(-1)
    skins = [{'joints': [jnode[n] for n in jnames], 'skeleton': jnode['hips'], 'inverseBindMatrices': push(ibm, typ='MAT4')}]

    meshes = []
    for p in parts:
        J, W = finalize(p['W'])
        attrs = {'POSITION': push(T(p['P']), 34962, minmax=True)}
        outline = p['name'].startswith('Megumin_stroke')
        if p['N'] is not None and not outline: attrs['NORMAL'] = push(p['N'].astype(np.float32), 34962)
        if p['UV'] is not None and not outline: attrs['TEXCOORD_0'] = push(p['UV'].astype(np.float32), 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(J, 34962, comp=5121, typ='VEC4')
        attrs['WEIGHTS_0'] = push(W, 34962, typ='VEC4')
        idx = p['I'].astype(np.uint16 if p['I'].max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        name = ('outline_' if outline else '') + p['name'].split('_UV')[0].split('_Uv')[0]
        meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_map[p['mat']]}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'skin': 0}); nodes[0]['children'].append(len(nodes) - 1)

    out = {'asset': {'version': '2.0', 'generator': 'magebreak rig_meteora.py'}, 'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
           'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
           'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
