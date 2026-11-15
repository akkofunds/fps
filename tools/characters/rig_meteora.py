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


def main():
    js, b = read_glb(SRC)
    prims = baked_primitives(js, b, 0)
    parts = []
    for nm, mat, P, N, UV, I in prims:
        parts.append(dict(name=nm, mat=mat, P=yup(P), N=yup(N) if N is not None else None, UV=UV, I=I))
    get = lambda pre: [p for p in parts if p['name'].startswith(pre)]
    body = get('body_mesh')[0]
    NB = len(NAMES) + 2  # + prop_R, cape
    PROP, CAPE = len(NAMES), len(NAMES) + 1

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
            # the source cape is frozen mid-flutter: fold it in behind her back first
            Q = p['P']
            ax_, az_ = -3.0, -15.0
            k = np.clip((40.0 - Q[:, 1]) / 38.0, 0, 1)
            Q[:, 0] = ax_ + (Q[:, 0] - ax_) * (1 - 0.5 * k)
            dz = Q[:, 2] - az_
            Q[:, 2] = az_ + np.where(dz < 0, dz * (1 - 0.62 * k), dz)
            Q[:, 2] = np.minimum(Q[:, 2], az_ + 2 + (1 - k) * 12)
            # pinned at the collar, swings below it
            y = p['P'][:, 1]
            top = JP[IDX['neck']][1] + 6
            k = np.clip((top - y) / 22.0, 0, 1) ** 1.2
            W[:, IDX['upperChest']] = 1 - k
            W[:, CAPE] = k
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

    # outline shell: nearest vertex among all other parts (weights + staff shrink)
    allP = np.concatenate([p['P'] for p in parts if 'W' in p])
    allW = np.concatenate([p['W'] for p in parts if 'W' in p])
    allS = np.concatenate([np.full(len(p['P']), p['name'].startswith(('staff', 'StaffBall'))) for p in parts if 'W' in p])
    for p in get('Megumin_stroke'):
        Q = p['P']
        near = np.zeros(len(Q), int)
        for s in range(0, len(Q), 256):
            near[s:s + 256] = ((Q[s:s + 256, None, :] - allP[None, :, :]) ** 2).sum(-1).argmin(1)
        p['W'] = allW[near]
        st = allS[near]
        Q[st] = shrink(Q[st])

    # ---------------------------------------------------------------- to meters, feet ~0
    floor = min(JP[IDX['toes_L']][1], JP[IDX['toes_R']][1])
    off = np.array([3.0, 0.0, 5.0])
    def T(v): return ((v + off) * S).astype(np.float32)
    joints = np.vstack([JP, grip[None, :], np.array([[-3.0, 42.0, -11.0]])])
    jnames = NAMES + ['prop_R', 'cape']
    jparent = [b[1] for b in BONES] + ['hand_R', 'upperChest']
    jm = T(joints)
    tails = {**TAILS, 'prop_R': staff_top, 'cape': (-3.0, 10.0, -16.0)}

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

    # textures (opaque → 1024 px JPEG)
    images = []
    for ii in range(len(js['images'])):
        im = Image.open(io.BytesIO(image_bytes(js, b, ii))).convert('RGB')
        im = im.resize((min(1024, im.width), min(1024, im.height)), Image.LANCZOS)
        bio = io.BytesIO(); im.save(bio, 'JPEG', quality=88)
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
