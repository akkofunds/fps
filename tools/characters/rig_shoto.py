"""Auto-rig SHOTO (fire/ice soldier) for Magebreak. Derived from the METEORA rig.

Input : tools/characters/src/shoto_original.glb (static A-pose mesh, Z-up, ~10.6 units)
Output: public/models/shoto.glb

Original notes (Meteora): (the meteor-girl mage) for Magebreak.

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

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'src', 'shoto_original.glb')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'shoto.glb')

S = 1.76 / 10.58  # stature ≈ 1.76 m
U = 10.58 / 136.0  # this model's units relative to the Meteora source (thresholds below scale by it)

# ---------------------------------------------------------------- skeleton (source units, Y-up, faces +Z)
BONES = [
    ('hips', None, (0.0, 5.0, 0.05)),
    ('spine', 'hips', (0.0, 5.8, 0.02)),
    ('chest', 'spine', (0.0, 6.6, -0.02)),
    ('upperChest', 'chest', (0.0, 7.4, -0.05)),
    ('neck', 'upperChest', (0.0, 8.35, -0.1)),
    ('head', 'neck', (0.0, 8.8, -0.05)),
    ('shoulder_L', 'upperChest', (0.32, 8.0, -0.12)),
    ('upperArm_L', 'shoulder_L', (1.1, 7.95, -0.17)),
    ('foreArm_L', 'upperArm_L', (1.3, 6.3, -0.22)),
    ('hand_L', 'foreArm_L', (1.4, 4.75, -0.02)),
    ('shoulder_R', 'upperChest', (-0.32, 8.0, -0.12)),
    ('upperArm_R', 'shoulder_R', (-1.1, 7.95, -0.17)),
    ('foreArm_R', 'upperArm_R', (-1.3, 6.3, -0.22)),
    ('hand_R', 'foreArm_R', (-1.4, 4.75, -0.02)),
    ('upperLeg_L', 'hips', (0.45, 4.6, 0.05)),
    ('lowerLeg_L', 'upperLeg_L', (0.56, 2.6, 0.02)),
    ('foot_L', 'lowerLeg_L', (0.74, 0.62, -0.2)),
    ('toes_L', 'foot_L', (0.84, 0.14, 0.62)),
    ('upperLeg_R', 'hips', (-0.45, 4.6, 0.05)),
    ('lowerLeg_R', 'upperLeg_R', (-0.56, 2.6, 0.02)),
    ('foot_R', 'lowerLeg_R', (-0.74, 0.62, -0.2)),
    ('toes_R', 'foot_R', (-0.84, 0.14, 0.62)),
]
TAILS = {
    'head': (0.0, 10.5, 0.0),
    'hand_L': (1.38, 3.85, 0.1),
    'hand_R': (-1.38, 3.85, 0.1),
    'toes_L': (0.86, 0.1, 1.05),
    'toes_R': (-0.86, 0.1, 1.05),
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
    key = np.round(P * 2000).astype(np.int64)
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
    SEG['hips'] = (np.array([0.0, 4.3, 0.05]), JP[IDX['spine']])
    D = np.stack([seg(Pw, *SEG[nm])[0] for nm in NAMES], 1)
    T = np.stack([seg(Pw, *SEG[nm])[1] for nm in NAMES], 1)
    nearest = D.argmin(1)
    Ds = np.sort(D, 1)
    clear = (Ds[:, 1] - Ds[:, 0]) > 4.0 * U  # unambiguous: clearly closer to one bone than any other
    G = np.full((n, len(NAMES)), np.inf)
    for i, nm in enumerate(NAMES):
        short = nm.startswith(('hand', 'toes', 'foot', 'head', 'shoulder', 'neck'))
        lo, hi = (0.05, 0.98) if short else (0.15, 0.85)
        m = (nearest == i) & clear & (T[:, i] >= lo) & (T[:, i] <= hi)
        if nm == 'head': m = (nearest == i) & (Pw[:, 1] > JP[IDX['head']][1] + 2 * U)
        if m.sum() < 6: m = (nearest == i) & (T[:, i] >= lo) & (T[:, i] <= hi)
        if m.sum() == 0:
            m = D[:, i] <= D[:, i].min() + 1.0 * U
        # keep the closest ring around the bone only
        dd = D[m, i]
        cut = np.percentile(dd, 55) if len(dd) > 8 else dd.max()
        seeds = np.where(m)[0][dd <= cut]
        seeds = largest_patch(adj, seeds)
        G[:, i] = dijkstra(adj, seeds, n)
    W = 1.0 / (G + 1.5 * U) ** 6
    W[~np.isfinite(G)] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    return W[inv]


def arm_mask(P, I):
    """Which vertices belong to an arm. Decided by distance ALONG THE SURFACE from clear arm
    seeds vs clear torso seeds: the short sleeve hangs right beside the ribs, so a straight-line
    test hands the sleeve's inner hem to the chest and it stays behind when the arm swings."""
    inv, Pw = weld(P, I)
    adj = graph(Pw, inv[I])
    x, y = Pw[:, 0], Pw[:, 1]
    arm_seed = np.where((np.abs(x) > 1.2) & (y > 4.0) & (y < 7.7))[0]
    torso_seed = np.where((np.abs(x) < 0.55) & (y > 5.6) & (y < 7.9))[0]
    da = dijkstra(adj, arm_seed, len(Pw))
    dt = dijkstra(adj, torso_seed, len(Pw))
    arm = (da < dt) & (y > 3.6) & (y < 8.3)
    # pieces not surface-connected to either seed set fall back to the straight-line test
    lost = ~np.isfinite(da) & ~np.isfinite(dt)
    arm[lost] = (np.abs(x[lost]) > 1.02) & (y[lost] > 3.6) & (y[lost] < 8.25)
    return arm[inv]


def region_weights(P, I=None):
    """Bone-distance weights with A-pose region masks: arm bones only reach the arms of their
    side, leg bones only the legs of their side, so hands resting by the thighs never couple."""
    x, y = P[:, 0], P[:, 1]
    arm = arm_mask(P, I) if I is not None else (np.abs(x) > 1.02) & (y > 3.6) & (y < 8.25)
    shoulder_zone = (np.abs(x) > 0.75) & (y > 7.3)
    D = np.stack([seg(P, JP[i], tail(nm))[0] for i, nm in enumerate(NAMES)], 1)
    for i, nm in enumerate(NAMES):
        side = 1 if nm.endswith('_L') else -1 if nm.endswith('_R') else 0
        sidem = (x * side > -0.05) if side else np.ones(len(P), bool)
        if nm.startswith(('upperArm', 'foreArm', 'hand')):
            valid = sidem & (arm | (shoulder_zone & nm.startswith('upperArm')))
        elif nm.startswith(('upperLeg', 'lowerLeg', 'foot', 'toes')):
            valid = sidem & ~arm & (y < 5.1)
        elif nm in ('head',):
            valid = y > 8.45
        elif nm in ('neck',):
            valid = y > 7.9
        elif nm.startswith('shoulder'):
            valid = sidem & ~arm & (y > 7.0)
        else:  # hips / spine / chest / upperChest
            valid = ~arm
        D[~valid, i] = np.inf
    W = 1.0 / (D + 0.06) ** 6
    W[~np.isfinite(D)] = 0
    # head is rigid (face, ears): anything above the jaw belongs to it
    W[y > 8.9] = 0; W[y > 8.9, IDX['head']] = 1
    W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    return W


def finalize(W):
    order = np.argsort(-W, axis=1)[:, :4]
    vals = np.take_along_axis(W, order, 1)
    vals[vals < 0.02] = 0
    vals /= np.maximum(vals.sum(1, keepdims=True), 1e-9)
    return order.astype(np.uint8), vals.astype(np.float32)


def components(P, I):
    key = np.round(P * 2000).astype(np.int64)
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
        w = 1.0 / (np.sqrt(dd) + 0.3 * U) ** 2
        w /= w.sum(1, keepdims=True)
        out[s:s + 256] = (W[idx] * w[:, :, None]).sum(1)
    return out


def main():
    js, b = read_glb(SRC)
    prims = baked_primitives(js, b, 0)
    # the body is two primitives sharing one vertex array: merge their index lists
    body, hair = None, None
    for nm, mat, P, N, UV, I in prims:
        part = dict(name=nm, mat=mat, P=yup(P), N=yup(N) if N is not None else None, UV=UV, I=I)
        if mat == 0:
            if body is None: body = dict(part, name='body')
            else: body['I'] = np.concatenate([body['I'], I])
        else:
            if hair is None: hair = dict(part, name='hair')
            else: hair['I'] = np.concatenate([hair['I'], I])
    parts = [body, hair]
    print('body weights (geodesic)…', len(body['P']), 'verts', flush=True)
    Wb = region_weights(body['P'], body['I'])
    ARM = arm_mask(body['P'], body['I'])
    # The model carries a built-in inner ink shell (faces whose normals point INTO the body).
    # Give those vertices the weights of the nearest outer-skin vertex so both layers deform
    # identically (otherwise the black shell pokes through when limbs bend).
    Pb, Nb = body['P'], body['N']
    # measure against each vertex's OWN dominant bone (the hands rest near the thighs)
    dom = Wb.argmax(1)
    foot = np.zeros_like(Pb)
    for i, nm in enumerate(NAMES):
        m = dom == i
        if not m.any(): continue
        a, b2 = JP[i], tail(nm)
        _, t = seg(Pb[m], a, b2)
        foot[m] = a + t[:, None] * (b2 - a)
    inward = (((Pb - foot) * Nb).sum(1) < 0) | (Wb.sum(1) < 0.5)  # facing in, or unreachable by the geodesic pass
    print('inner-shell verts', int(inward.sum()), 'of', len(Pb))
    if inward.any() and (~inward).any():
        Wb = Wb.copy()
        # copy only from the same region (an arm's shell must never borrow from the ribs)
        reg = np.where(ARM, np.sign(Pb[:, 0]), 0)
        for r in (-1, 0, 1):
            q, src = inward & (reg == r), ~inward & (reg == r)
            if q.any() and src.any(): Wb[q] = knn_transfer(Pb[q], Pb[src], Wb[src], k=3)
    body['W'] = Wb
    hair['W'] = np.zeros((len(hair['P']), len(NAMES))); hair['W'][:, IDX['head']] = 1
    # inverted-hull ink outline (pushed out along the normal, winding flipped)
    for src_p, nm in ((body, 'outline_body'), (hair, 'outline_hair')):
        Nn = src_p['N'] if src_p['N'] is not None else np.zeros_like(src_p['P'])
        parts.append(dict(name=nm, mat=None, P=src_p['P'] + Nn * 0.028, N=None, UV=None,
                          I=src_p['I'].reshape(-1, 3)[:, ::-1].ravel().copy(), W=src_p['W'].copy()))

    # ---------------------------------------------------------------- to meters, feet ~0
    floor = float(body['P'][:, 1].min())
    off = np.array([0.0, -floor, 0.0])
    def T(v): return ((v + off) * S).astype(np.float32)
    joints = JP.copy()
    jnames = list(NAMES)
    jparent = [b[1] for b in BONES]
    jm = T(joints)
    tails = dict(TAILS)

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
    materials = [{'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.02, 0.03, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}}]
    mat_map = {None: 0}
    for mi, m in enumerate(js['materials']):
        src = tex_of_mat[mi]
        if src is None:
            materials.append({'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.02, 0.03, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}})
        else:
            materials.append({'name': m.get('name', f'm{mi}'), 'doubleSided': False, 'pbrMetallicRoughness': {'baseColorTexture': {'index': src}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'extensions': {'KHR_materials_unlit': {}}})
        mat_map[mi] = len(materials) - 1

    nodes = [{'name': 'Shoto', 'children': []}]
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
        outline = p['name'].startswith('outline')
        if p['N'] is not None and not outline: attrs['NORMAL'] = push(p['N'].astype(np.float32), 34962)
        if p['UV'] is not None and not outline: attrs['TEXCOORD_0'] = push(p['UV'].astype(np.float32), 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(J, 34962, comp=5121, typ='VEC4')
        attrs['WEIGHTS_0'] = push(W, 34962, typ='VEC4')
        idx = p['I'].astype(np.uint16 if p['I'].max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        name = p['name']
        meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_map[p['mat']]}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'skin': 0}); nodes[0]['children'].append(len(nodes) - 1)

    out = {'asset': {'version': '2.0', 'generator': 'magebreak rig_shoto.py'}, 'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
           'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
           'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
