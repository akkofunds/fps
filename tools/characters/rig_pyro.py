"""Auto-rig the Pyro character for Magebreak.

Input : tools/characters/src/fire_original.glb  (static Sketchfab mesh, Z-up, ~108 units tall)
Output: public/models/pyro.glb                  (skinned, Y-up, meters, feet at y=0, faces +Z)

Steps
 1. drop the orange fire-aura mesh (material "Fire") and the unused emissive map
 2. bake the Z-up → Y-up root transform and scale to a 1.80 m character
 3. build a 25-bone humanoid skeleton from hand-measured landmarks (all joints have
    identity rest rotations, so the runtime retargeter can work in world-aligned frames)
 4. compute skin weights per mesh island (head, arms, shirt, coat, pants, boots ...)
    with smooth joint blending, then copy them onto the black outline shell
 5. bake the glowing red eyes into the base colour, resize textures to 2048 px

Usage: python3 tools/characters/rig_pyro.py [src.glb] [out.glb]
Requires numpy + Pillow.
"""
import io, json, struct, sys, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from strip_glb import read_glb, write_glb  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'src', 'fire_original.glb')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'pyro.glb')

HEIGHT = 1.80
SRC_TOP = 108.63
S = HEIGHT / SRC_TOP

# ---------------------------------------------------------------- skeleton (source units, Y-up)
# character faces +Z, so the character's LEFT side is +X
BONES = [
    # name,          parent,        head position
    ('hips',         None,          (0.8, 53.0, -1.0)),
    ('spine',        'hips',        (0.7, 61.5, -1.4)),
    ('chest',        'spine',       (0.6, 70.5, -1.8)),
    ('upperChest',   'chest',       (0.5, 79.0, -2.3)),
    ('neck',         'upperChest',  (0.4, 87.5, -2.5)),
    ('head',         'neck',        (0.2, 92.5, -1.0)),
    ('shoulder_L',   'upperChest',  (3.0, 84.5, -2.6)),
    ('upperArm_L',   'shoulder_L',  (12.0, 83.0, -3.2)),
    ('foreArm_L',    'upperArm_L',  (16.2, 66.5, -2.4)),
    ('hand_L',       'foreArm_L',   (18.5, 54.5, -1.0)),
    ('shoulder_R',   'upperChest',  (-2.0, 84.5, -2.8)),
    ('upperArm_R',   'shoulder_R',  (-12.5, 82.5, -4.5)),
    ('foreArm_R',    'upperArm_R',  (-20.3, 68.0, -9.4)),
    ('hand_R',       'foreArm_R',   (-27.6, 59.0, -10.6)),
    ('upperLeg_L',   'hips',        (8.5, 47.5, -0.5)),
    ('lowerLeg_L',   'upperLeg_L',  (11.5, 27.5, -0.3)),
    ('foot_L',       'lowerLeg_L',  (14.5, 8.0, -3.2)),
    ('toes_L',       'foot_L',      (16.6, 2.0, 3.6)),
    ('upperLeg_R',   'hips',        (-6.8, 47.5, -0.5)),
    ('lowerLeg_R',   'upperLeg_R',  (-7.6, 27.5, 0.0)),
    ('foot_R',       'lowerLeg_R',  (-6.8, 8.0, -2.8)),
    ('toes_R',       'foot_R',      (-9.6, 2.0, 3.2)),
]
# bone tails (end points) for bones without a single child in the chain
TAILS = {
    'head': (0.0, 106.0, 0.0),
    'hand_L': (18.9, 45.2, 0.0),
    'hand_R': (-30.3, 50.5, -11.8),
    'toes_L': (17.5, 1.0, 8.6),
    'toes_R': (-10.6, 1.0, 7.9),
}
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
JP = np.array([b[2] for b in BONES], dtype=np.float64)


def tail(name):
    if name in TAILS: return np.array(TAILS[name], dtype=np.float64)
    nxt = {'hips': 'spine', 'spine': 'chest', 'chest': 'upperChest', 'upperChest': 'neck', 'neck': 'head',
           'shoulder_L': 'upperArm_L', 'upperArm_L': 'foreArm_L', 'foreArm_L': 'hand_L',
           'shoulder_R': 'upperArm_R', 'upperArm_R': 'foreArm_R', 'foreArm_R': 'hand_R',
           'upperLeg_L': 'lowerLeg_L', 'lowerLeg_L': 'foot_L', 'foot_L': 'toes_L',
           'upperLeg_R': 'lowerLeg_R', 'lowerLeg_R': 'foot_R', 'foot_R': 'toes_R'}[name]
    return JP[IDX[nxt]]


# ---------------------------------------------------------------- glb helpers
def accessor(js, b, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    r = np.frombuffer(b, dtype=dt, count=a['count'] * n, offset=o)
    return (r.reshape(-1, n) if n > 1 else r).copy()


def yup(v):  # Sketchfab root matrix: (x, y, z) -> (x, z, -y)
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def components(P, I):
    key = np.round(P * 1000).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    par = np.arange(inv.max() + 1)

    def f(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for t in I.reshape(-1, 3):
        a, b2, c = inv[t]; ra = f(a); par[f(b2)] = ra; par[f(c)] = ra
    return np.array([f(inv[i]) for i in range(len(P))])


# ---------------------------------------------------------------- weighting primitives
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t


def chain_weights(P, chain, power=5.0):
    """inverse-distance weights over a chain of bones; returns (N, len(chain))"""
    D = np.stack([seg_dist(P, JP[IDX[n]], tail(n))[0] for n in chain], 1)
    W = 1.0 / np.maximum(D, 0.35) ** power
    return W / W.sum(1, keepdims=True)


def torso_weights(P):
    """vertical blend hips/spine/chest/upperChest/neck by height"""
    chain = ['hips', 'spine', 'chest', 'upperChest', 'neck']
    ys = [JP[IDX[n]][1] for n in chain] + [JP[IDX['head']][1]]
    y = P[:, 1]
    W = np.zeros((len(P), len(chain)))
    blend = 3.0
    for k, n in enumerate(chain):
        lo, hi = ys[k], ys[k + 1]
        a = smooth(lo - blend, lo + blend, y) if k > 0 else np.ones_like(y)
        b = 1 - smooth(hi - blend, hi + blend, y) if k < len(chain) - 1 else np.ones_like(y)
        W[:, k] = a * b
    W /= np.maximum(W.sum(1, keepdims=True), 1e-6)
    return chain, W


class Acc:
    """accumulates bone weights per vertex"""
    def __init__(self, n):
        self.W = np.zeros((n, len(NAMES)))

    def add(self, mask, names, w):
        idx = np.where(mask)[0]
        for k, nm in enumerate(names):
            self.W[idx, IDX[nm]] += w[:, k] if w.ndim == 2 else w

    def finalize(self):
        W = self.W
        # keep top 4
        order = np.argsort(-W, axis=1)[:, :4]
        vals = np.take_along_axis(W, order, 1)
        vals[vals < 0.01] = 0
        s = vals.sum(1, keepdims=True)
        bad = s[:, 0] <= 0
        if bad.any(): raise SystemExit(f'{bad.sum()} vertices without weights')
        vals /= s
        return order.astype(np.uint8), vals.astype(np.float32)


def arm_factor(P, side):
    """0 on the torso → 1 on the arm, using projection past the shoulder joint"""
    ua = JP[IDX[f'upperArm_{side}']]; fa = JP[IDX[f'foreArm_{side}']]
    d = (fa - ua); d /= np.linalg.norm(d)
    proj = (P - ua) @ d
    # lateral distance outside the torso also counts
    sgn = 1 if side == 'L' else -1
    lat = (P[:, 0] - 0.6) * sgn
    return np.maximum(smooth(-2.0, 2.5, proj) * smooth(7.0, 10.5, lat), 0)


def upper_body(P, acc, mask, sides=('L', 'R'), arm_radius=None):
    """shirt / coat style cloth: torso by height, clavicles at the shoulders, arms where sleeves go"""
    Q = P[mask]
    chain, Wt = torso_weights(Q)
    remain = np.ones(len(Q))
    for side in sides:
        a = arm_factor(Q, side)
        if arm_radius is not None:
            dist, _ = seg_dist(Q, JP[IDX[f'upperArm_{side}']], JP[IDX[f'hand_{side}']])
            a = a * (1 - smooth(arm_radius, arm_radius + 3.5, dist))
        a = np.minimum(a, remain)
        if a.max() > 0:
            Wa = chain_weights(Q, [f'upperArm_{side}', f'foreArm_{side}', f'hand_{side}'])
            sub = np.zeros((len(Q), 3)); sub[:] = Wa * a[:, None]
            acc.add(mask, [f'upperArm_{side}', f'foreArm_{side}', f'hand_{side}'], sub)
        remain = remain - a
        # clavicle over the top of the shoulder
        sgn = 1 if side == 'L' else -1
        c = smooth(3.0, 9.0, (Q[:, 0] - 0.6) * sgn) * smooth(77.0, 84.0, Q[:, 1]) * 0.75
        c = np.minimum(c, remain)
        acc.add(mask, [f'shoulder_{side}'], c)
        remain = remain - c
    acc.add(mask, chain, Wt * remain[:, None])


def legs(P, acc, mask, hip_top=(45.0, 56.0), cx=2.4, with_toes=False):
    Q = P[mask]
    sideL = smooth(cx - 2.5, cx + 2.5, Q[:, 0])
    h = smooth(hip_top[0], hip_top[1], Q[:, 1])
    chainL = ['upperLeg_L', 'lowerLeg_L', 'foot_L'] + (['toes_L'] if with_toes else [])
    chainR = ['upperLeg_R', 'lowerLeg_R', 'foot_R'] + (['toes_R'] if with_toes else [])
    WL = chain_weights(Q, chainL, 4.0); WR = chain_weights(Q, chainR, 4.0)
    acc.add(mask, chainL, WL * ((1 - h) * sideL)[:, None])
    acc.add(mask, chainR, WR * ((1 - h) * (1 - sideL))[:, None])
    acc.add(mask, ['hips'], h)


# ---------------------------------------------------------------- main
def main():
    js, b = read_glb(SRC)
    mats = [m['name'] for m in js['materials']]
    parts = []  # (name, material name, P, N, UV, I)
    for mi, m in enumerate(js['meshes']):
        for p in m['primitives']:
            mat = mats[p['material']]
            if mat == 'Fire':
                continue  # the orange aura
            P = yup(accessor(js, b, p['attributes']['POSITION']).astype(np.float64))
            N = yup(accessor(js, b, p['attributes']['NORMAL']).astype(np.float64)) if 'NORMAL' in p['attributes'] else None
            UV = accessor(js, b, p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else None
            I = accessor(js, b, p['indices']).astype(np.uint32)
            parts.append([m.get('name', f'mesh{mi}'), mat, P, N, UV, I])

    body = next(x for x in parts if x[1] == 'Body')
    P = body[2]
    roots = components(P, body[5])
    u, cnt = np.unique(roots, return_counts=True)
    isl = {}
    for r, c in zip(u, cnt):
        s = P[roots == r]
        isl.setdefault(int(c), []).append((r, s[:, 0].mean()))

    def island(count, which=None):
        lst = isl[count]
        if which == '+x': r = max(lst, key=lambda t: t[1])[0]
        elif which == '-x': r = min(lst, key=lambda t: t[1])[0]
        else: r = lst[0][0]
        return roots == r

    acc = Acc(len(P))
    # head + neck (includes the neck skin that tucks into the collar)
    m = island(1031); Q = P[m]
    hn = smooth(90.0, 93.5, Q[:, 1]); nu = smooth(86.0, 88.5, Q[:, 1])
    acc.add(m, ['head', 'neck', 'upperChest'], np.stack([hn, (1 - hn) * nu, (1 - hn) * (1 - nu)], 1))
    # bare arms with hands
    for side, which in (('L', '+x'), ('R', '-x')):
        m = island(909, which); Q = P[m]
        acc.add(m, [f'upperArm_{side}', f'foreArm_{side}', f'hand_{side}'],
                chain_weights(Q, [f'upperArm_{side}', f'foreArm_{side}', f'hand_{side}']))
    # shirts
    upper_body(P, acc, island(591))
    upper_body(P, acc, island(452))
    # haori coat: only its left sleeve follows the arm; the rest drapes from the torso
    m = island(1292); Q = P[m]
    low = smooth(56.0, 46.0, Q[:, 1])  # hem swings a little with the thighs
    acc_c = Acc(len(P))
    upper_body(P, acc_c, m, sides=('L',), arm_radius=7.0)
    Wc = acc_c.W[m]
    sideL = smooth(-2.0, 4.0, Q[:, 0])
    thigh = np.zeros_like(Wc)
    thigh[:, IDX['upperLeg_L']] = low * 0.3 * sideL
    thigh[:, IDX['upperLeg_R']] = low * 0.3 * (1 - sideL)
    acc.W[m] += Wc * (1 - low * 0.3)[:, None] + thigh
    # belt
    m = island(369); acc.add(m, ['hips', 'spine'], np.stack([np.full(m.sum(), 0.7), np.full(m.sum(), 0.3)], 1))
    # waist flaps below the belt
    m = island(216); Q = P[m]
    lw = smooth(58.0, 48.0, Q[:, 1]) * 0.45; sL = smooth(-1.0, 4.0, Q[:, 0])
    acc.add(m, ['hips', 'upperLeg_L', 'upperLeg_R'], np.stack([1 - lw, lw * sL, lw * (1 - sL)], 1))
    # pants, knee pads, boots
    legs(P, acc, island(1081))
    for which in ('+x', '-x'):
        legs(P, acc, island(94, which))
    for side, which in (('L', '+x'), ('R', '-x')):
        m = island(556, which); Q = P[m]
        acc.add(m, [f'lowerLeg_{side}', f'foot_{side}', f'toes_{side}'],
                chain_weights(Q, [f'lowerLeg_{side}', f'foot_{side}', f'toes_{side}'], 4.0))

    BJ, BW = acc.finalize()

    # ---------------------------------------------------------------- slim fit
    # The source outfit is very baggy. Pull the coat, shirts, belt and pants in toward the
    # skeleton with a monotonic radial squeeze (r' = r0 + (r - r0) * k beyond r0), so layers
    # keep their order (the coat stays outside the shirt) and skin-tight parts are untouched.
    cloth = island(1292) | island(591) | island(452) | island(369) | island(216) | island(1081) | island(94, '+x') | island(94, '-x')
    Wn = acc.W / np.maximum(acc.W.sum(1, keepdims=True), 1e-9)
    delta = np.zeros_like(P)
    Pc = P[cloth]; Wc_ = Wn[cloth]

    def squeeze_axis(Q, a, b, r0, k):
        dist, t = seg_dist(Q, a, b)
        foot = a + t[:, None] * (b - a)
        r_new = np.where(dist > r0, r0 + (dist - r0) * k, dist)
        return foot + (Q - foot) * (r_new / np.maximum(dist, 1e-9))[:, None]

    def squeeze_chain(Q, names, r0, k):
        best = None; bestd = None
        for n in names:
            d, _ = seg_dist(Q, JP[IDX[n]], tail(n))
            if best is None: best, bestd = np.zeros(len(Q), int), d
            else:
                better = d < bestd; best[better] = names.index(n); bestd = np.minimum(bestd, d)
        out = Q.copy()
        for i, n in enumerate(names):
            sel = best == i
            if sel.any(): out[sel] = squeeze_axis(Q[sel], JP[IDX[n]], tail(n), r0, k)
        return out

    # torso: elliptical squeeze around the spine line
    cx, cz, rx, rz, kt = 0.6, -2.0, 9.0, 7.0, 0.42
    dx, dz = Pc[:, 0] - cx, Pc[:, 2] - cz
    rn = np.sqrt((dx / rx) ** 2 + (dz / rz) ** 2)
    rn2 = np.where(rn > 1, 1 + (rn - 1) * kt, rn)
    s = rn2 / np.maximum(rn, 1e-9)
    torso_p = np.stack([cx + dx * s, Pc[:, 1], cz + dz * s], 1)
    w_torso = sum(Wc_[:, IDX[n]] for n in ('hips', 'spine', 'chest', 'upperChest', 'neck', 'shoulder_L', 'shoulder_R'))
    target = torso_p * w_torso[:, None]
    wsum = w_torso.copy()
    for side in ('L', 'R'):
        names = [f'upperArm_{side}', f'foreArm_{side}', f'hand_{side}']
        w = sum(Wc_[:, IDX[n]] for n in names)
        if w.max() > 0:
            target += squeeze_chain(Pc, names, 3.4, 0.4) * w[:, None]; wsum += w
        names = [f'upperLeg_{side}', f'lowerLeg_{side}', f'foot_{side}']
        w = sum(Wc_[:, IDX[n]] for n in names)
        if w.max() > 0:
            target += squeeze_chain(Pc, names, 4.3, 0.44) * w[:, None]; wsum += w
    target += Pc * np.maximum(0, 1 - wsum)[:, None]
    delta[cloth] = target - Pc

    # ---------------------------------------------------------------- per part
    out_parts = []
    for name, mat, Pp, Np, UV, I in parts:
        if mat == 'Body':
            J, W = BJ, BW
            Pp = Pp + delta
        elif mat == 'Hair':
            J = np.zeros((len(Pp), 4), np.uint8); J[:, 0] = IDX['head']
            W = np.zeros((len(Pp), 4), np.float32); W[:, 0] = 1
        else:  # outline shell → nearest body vertex (weights and slim-fit offset)
            J = np.zeros((len(Pp), 4), np.uint8); W = np.zeros((len(Pp), 4), np.float32)
            D = np.zeros_like(Pp)
            for s0 in range(0, len(Pp), 512):
                d = ((Pp[s0:s0 + 512, None, :] - P[None, :, :]) ** 2).sum(-1)
                nn = d.argmin(1)
                J[s0:s0 + 512] = BJ[nn]; W[s0:s0 + 512] = BW[nn]; D[s0:s0 + 512] = delta[nn]
            Pp = Pp + D
        out_parts.append((name, mat, Pp, Np, UV, I, J, W))

    # ---------------------------------------------------------------- transform to meters, feet at 0
    floor = min(p[2][:, 1].min() for p in out_parts if p[1] == 'Body')
    off = np.array([-0.8, -floor, 0.0])

    def T(v): return ((v + off) * S).astype(np.float32)

    joints_m = T(JP)

    # ---------------------------------------------------------------- write glb
    binbuf = bytearray()
    bufferViews, accessors = [], []

    def push(data, target=None, comp=5126, typ='VEC3', minmax=False, count=None):
        while len(binbuf) % 4: binbuf.append(0)
        raw = data.tobytes()
        bv = {'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}
        if target: bv['target'] = target
        binbuf.extend(raw); bufferViews.append(bv)
        a = {'bufferView': len(bufferViews) - 1, 'componentType': comp, 'count': count if count is not None else len(data), 'type': typ}
        if minmax:
            a['min'] = data.min(0).tolist(); a['max'] = data.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    # textures
    def tex_bytes(img_index):
        im = js['images'][img_index]; bv = js['bufferViews'][im['bufferView']]
        return b[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]

    body_mat = js['materials'][mats.index('Body')]
    base = Image.open(io.BytesIO(tex_bytes(js['textures'][body_mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']))).convert('RGB')
    emis = Image.open(io.BytesIO(tex_bytes(js['textures'][body_mat['emissiveTexture']['index']]['source']))).convert('RGB')
    bA = np.asarray(base).astype(np.float32); eA = np.asarray(emis).astype(np.float32) / 255.0
    glow = np.clip(eA.max(2, keepdims=True) * 1.6, 0, 1)
    bA = bA * (1 - glow) + np.array([255, 70, 30]) * glow  # glowing ember eyes
    base = Image.fromarray(np.clip(bA, 0, 255).astype(np.uint8)).resize((2048, 2048), Image.LANCZOS)
    hair_mat = js['materials'][mats.index('Hair')]
    hair = Image.open(io.BytesIO(tex_bytes(js['textures'][hair_mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']))).convert('RGB')

    images = []
    for img in (base, hair):
        bio = io.BytesIO(); img.save(bio, 'JPEG', quality=86, optimize=True, progressive=False)
        raw = np.frombuffer(bio.getvalue(), np.uint8)
        while len(binbuf) % 4: binbuf.append(0)
        bufferViews.append({'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)})
        binbuf.extend(raw.tobytes())
        images.append({'bufferView': len(bufferViews) - 1, 'mimeType': 'image/jpeg'})

    materials = [
        {'name': 'Body', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}, 'extensions': {'KHR_materials_unlit': {}}},
        {'name': 'Hair', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 1}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}, 'extensions': {'KHR_materials_unlit': {}}},
        {'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.02, 0.01, 0.01, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 1.0}, 'extensions': {'KHR_materials_unlit': {}}},
    ]
    mat_index = {'Body': 0, 'Hair': 1, 'outliner': 2}

    # nodes: 0 = root, joints next, then meshes
    nodes = [{'name': 'Pyro', 'children': []}]
    joint_node = {}
    for i, (nm, parent, _) in enumerate(BONES):
        joint_node[nm] = len(nodes)
        ppos = joints_m[IDX[parent]] if parent else np.zeros(3, np.float32)
        nodes.append({'name': nm, 'translation': (joints_m[i] - ppos).astype(float).tolist(), 'children': []})
    for i, (nm, parent, _) in enumerate(BONES):
        if parent: nodes[joint_node[parent]]['children'].append(joint_node[nm])
        else: nodes[0]['children'].append(joint_node[nm])
    # unskinned end markers (bone tails) so the runtime knows each end bone's direction
    for nm, tp in TAILS.items():
        t_m = T(np.array([tp], dtype=np.float64))[0]
        nodes.append({'name': nm + '_end', 'translation': (t_m - joints_m[IDX[nm]]).astype(float).tolist()})
        nodes[joint_node[nm]]['children'].append(len(nodes) - 1)

    ibm = np.zeros((len(BONES), 16), np.float32)
    for i in range(len(BONES)):
        m4 = np.eye(4, dtype=np.float32); m4[:3, 3] = -joints_m[i]
        ibm[i] = m4.T.reshape(-1)  # column-major
    ibm_acc = push(ibm, comp=5126, typ='MAT4')
    skins = [{'name': 'PyroSkin', 'joints': [joint_node[n] for n in NAMES], 'skeleton': joint_node['hips'], 'inverseBindMatrices': ibm_acc}]

    meshes = []
    for name, mat, Pp, Np, UV, I, J, W in out_parts:
        attrs = {'POSITION': push(T(Pp), 34962, minmax=True)}
        if Np is not None and mat != 'outliner':
            n = Np / np.maximum(np.linalg.norm(Np, axis=1, keepdims=True), 1e-9)
            attrs['NORMAL'] = push(n.astype(np.float32), 34962)
        if UV is not None and mat != 'outliner':
            attrs['TEXCOORD_0'] = push(UV.astype(np.float32), 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(J.astype(np.uint8), 34962, comp=5121, typ='VEC4')
        attrs['WEIGHTS_0'] = push(W.astype(np.float32), 34962, typ='VEC4')
        idx = I.astype(np.uint16 if I.max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        meshes.append({'name': {'Body': 'body', 'Hair': 'hair', 'outliner': 'outline'}[mat] + f'_{len(meshes)}',
                       'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_index[mat]}]})
        nodes.append({'name': meshes[-1]['name'], 'mesh': len(meshes) - 1, 'skin': 0})
        nodes[0]['children'].append(len(nodes) - 1)

    out = {
        'asset': {'version': '2.0', 'generator': 'magebreak rig_pyro.py'},
        'extensionsUsed': ['KHR_materials_unlit'],
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'textures': [{'sampler': 0, 'source': 0}, {'sampler': 0, 'source': 1}],
        'images': images,
        'accessors': accessors, 'bufferViews': bufferViews,
        'buffers': [{'byteLength': len(binbuf)}],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')
    print('joints (m):')
    for n, p in zip(NAMES, joints_m): print(f'  {n:12s} {p[0]:+.3f} {p[1]:+.3f} {p[2]:+.3f}')


if __name__ == '__main__':
    main()
