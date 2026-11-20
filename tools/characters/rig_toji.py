"""Convert the KINE SLAYER (Toji Fushiguro, Sketchfab "Toji Fushiguro - Jujutsu Kaisen") into a
Magebreak mage GLB.

Input : the Sketchfab GLB (skinned, 81 joints, posed in a wide fighting stance over a T-pose bind,
        with the Inverted Spear of Heaven + its chain, the Inventory Curse worm and a floor tile)
Output: public/models/kineslayer.glb

Like rig_sorcerer.py the source is already professionally skinned, so its weights are kept and its
joints folded into the game's 22-bone humanoid:
  * fingers → hand (each hand keeps the grip it has in the source stance, baked into the mesh:
    the right hand closed round the spear's grip, the left hand clenched);
  * face joints (eyes, lids, brows, lips, mouth, nose) → head; belt ropes → hips; pectoral helpers →
    upperChest; the single source chest is split by height between chest and upperChest;
  * the floor tile and the spear's chain are removed; the spear keeps exactly the position and angle
    it has in his right hand in the stance and is skinned rigidly to hand_R;
  * the worm wrapped round his shoulders stays (skinned to the torso as in the source);
  * the model's inverted-hull ink outlines are kept (material `Outline`, meshes `outline_*`);
  * colours come from the EMISSIVE textures (the source uses a near-black base colour factor).

Usage: python3 tools/characters/rig_toji.py SRC.glb [OUT.glb]      (numpy + Pillow)
"""
import io, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbmesh import read_glb, accessor, image_bytes  # noqa: E402
from strip_glb import write_glb  # noqa: E402

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'kineslayer.glb')
HEIGHT = 1.84  # top of the hair, metres (he is tall: Shoto 1.76, Sorcerer 1.78)

BONES = [  # (name, parent)
    ('hips', None), ('spine', 'hips'), ('chest', 'spine'), ('upperChest', 'chest'), ('neck', 'upperChest'), ('head', 'neck'),
    ('shoulder_L', 'upperChest'), ('upperArm_L', 'shoulder_L'), ('foreArm_L', 'upperArm_L'), ('hand_L', 'foreArm_L'),
    ('shoulder_R', 'upperChest'), ('upperArm_R', 'shoulder_R'), ('foreArm_R', 'upperArm_R'), ('hand_R', 'foreArm_R'),
    ('upperLeg_L', 'hips'), ('lowerLeg_L', 'upperLeg_L'), ('foot_L', 'lowerLeg_L'), ('toes_L', 'foot_L'),
    ('upperLeg_R', 'hips'), ('lowerLeg_R', 'upperLeg_R'), ('foot_R', 'lowerLeg_R'), ('toes_R', 'foot_R'),
]
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
POS_FROM = {
    'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head',
    'shoulder_L': 'shoulder.L', 'upperArm_L': 'upper_arm.L', 'foreArm_L': 'lower_arm.L', 'hand_L': 'hand.L',
    'shoulder_R': 'shoulder.R', 'upperArm_R': 'upper_arm.R', 'foreArm_R': 'lower_arm.R', 'hand_R': 'hand.R',
    'upperLeg_L': 'upper_leg.L', 'lowerLeg_L': 'lower_leg.L', 'foot_L': 'foot.L', 'toes_L': 'toes.L',
    'upperLeg_R': 'upper_leg.R', 'lowerLeg_R': 'lower_leg.R', 'foot_R': 'foot.R', 'toes_R': 'toes.R',
}
FINGERS = ('thumb', 'index', 'middle', 'ring', 'little')
FACE = ('eye', 'eyebrow', 'Eyelid', 'mouth', 'lip', 'nouse')
KEEP = ('Body', 'Clothes', 'Hair', 'Bukiko', 'InvertedSpearofHeaven')


def game_bone(s):
    """source joint name → game bone (None = drop: the chain's bone)"""
    if s == 'neutral_bone': return None
    if s == 'spear': return 'hand_R'
    if any(s.startswith(f) for f in FACE): return 'head'
    if s.startswith('rope'): return 'hips'
    if s.startswith(FINGERS): return 'hand_' + s[-1]
    for side, G in (('.L', '_L'), ('.R', '_R')):
        if s.endswith(side):
            base = s[:-2]
            return {'chest': 'upperChest', 'shoulder': 'shoulder' + G, 'upper_arm': 'upperArm' + G, 'lower_arm': 'foreArm' + G,
                    'hand': 'hand' + G, 'upper_leg': 'upperLeg' + G, 'lower_leg': 'lowerLeg' + G, 'foot': 'foot' + G, 'toes': 'toes' + G}[base]
    return {'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}.get(s, 'hips')


def trs(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), float); x, y, z, w = n.get('rotation', [0, 0, 0, 1]); sc = np.array(n.get('scale', [1, 1, 1]), float)
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * sc[None, :]; M[:3, 3] = t
    return M


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    js, b = read_glb(SRC)
    N = js['nodes']
    sk = js['skins'][0]
    J = sk['joints']
    jname = [N[j]['name'].rsplit('_', 1)[0] for j in J]
    kidx = {n: k for k, n in enumerate(jname)}
    IBM = accessor(js, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    BIND = np.linalg.inv(IBM)              # joint world matrices at bind (T-pose)
    jpos = {n: BIND[k][:3, 3] for k, n in enumerate(jname)}
    # the posed stance (node transforms): world matrices of every joint
    par = {}
    for i, n in enumerate(N):
        for c in n.get('children', []): par[c] = i
    memo = {}
    def world(i):
        if i not in memo: memo[i] = (world(par[i]) @ trs(N[i])) if i in par else trs(N[i])
        return memo[i]
    POSED = np.array([world(j) for j in J])

    # ---- per joint, a bind-space delta: identity, except the hands' fingers (and the spear) take the
    # configuration they have in the stance, relative to their hand
    DELTA = np.repeat(np.eye(4)[None], len(J), 0)
    for sd in ('L', 'R'):
        h = kidx['hand.' + sd]
        to_bind = BIND[h] @ np.linalg.inv(POSED[h])        # posed hand frame → bind hand frame
        for k, n in enumerate(jname):
            if n.startswith(FINGERS) and n.endswith('.' + sd) or (sd == 'R' and n == 'spear'):
                DELTA[k] = to_bind @ POSED[k] @ IBM[k]

    # ---- game joint positions
    G = np.zeros((len(NAMES), 3))
    for n, s in POS_FROM.items(): G[IDX[n]] = jpos[s]
    G[IDX['upperChest']] = jpos['chest'] + (jpos['neck'] - jpos['chest']) * 0.5
    split_lo, split_hi = jpos['chest'][1], G[IDX['upperChest']][1]
    tip = lambda sd: (DELTA[kidx['middle_distal.' + sd]] @ np.r_[jpos['middle_distal.' + sd], 1])[:3]
    tails = {
        'head': jpos['head'] + np.array([0, 0.3, 0]),
        'hand_L': jpos['hand.L'] + (tip('L') - jpos['hand.L']) * 1.0,
        'hand_R': jpos['hand.R'] + (tip('R') - jpos['hand.R']) * 1.0,
        'toes_L': jpos['toes.L'] + np.array([0, 0, 0.1]),
        'toes_R': jpos['toes.R'] + np.array([0, 0, 0.1]),
    }

    # ---- meshes
    parts = []
    for ni, n in enumerate(N):
        if 'mesh' not in n or 'skin' not in n: continue      # the floor tile is unskinned
        p = js['meshes'][n['mesh']]['primitives'][0]
        mat = js['materials'][p['material']]
        mname = mat.get('name', '')
        outline = mname == 'Outline'
        if not outline and mname not in KEEP: continue
        at = p['attributes']
        P = accessor(js, b, at['POSITION']).astype(float)
        Nn = accessor(js, b, at['NORMAL']).astype(float) if 'NORMAL' in at else None
        UV = accessor(js, b, at['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in at else None
        I = accessor(js, b, p['indices']).astype(np.int64).reshape(-1, 3)
        Js = accessor(js, b, at['JOINTS_0']).astype(int)
        Ws = accessor(js, b, at['WEIGHTS_0']).astype(float)
        dom = Js[np.arange(len(Js)), Ws.argmax(1)]
        if (dom == kidx['neutral_bone']).all(): continue       # chain-only meshes
        # drop the chain: keep only triangles whose three corners are not on the chain's bone
        bad = dom == kidx['neutral_bone']
        if bad.any():
            I = I[~bad[I].any(1)]
            used = np.unique(I); remap = -np.ones(len(P), int); remap[used] = np.arange(len(used))
            P, Js, Ws = P[used], Js[used], Ws[used]
            if Nn is not None: Nn = Nn[used]
            if UV is not None: UV = UV[used]
            I = remap[I]
        # fingers / spear into the stance grip (linear blend skinning with the source weights)
        Ph = np.c_[P, np.ones(len(P))]
        P2 = np.zeros_like(P); N2 = np.zeros_like(Nn) if Nn is not None else None
        for k in range(4):
            Mk = DELTA[Js[:, k]]
            P2 += Ws[:, k:k + 1] * np.einsum('nij,nj->ni', Mk, Ph)[:, :3]
            if Nn is not None: N2 += Ws[:, k:k + 1] * np.einsum('nij,nj->ni', Mk[:, :3, :3], Nn)
        wsum = Ws.sum(1, keepdims=True)
        P = np.where(wsum > 1e-6, P2 / np.maximum(wsum, 1e-6), P)
        if Nn is not None: Nn = N2 / np.maximum(np.linalg.norm(N2, axis=1, keepdims=True), 1e-9)
        W = np.zeros((len(P), len(NAMES)))
        for k in range(4):
            for row in np.unique(Js[:, k]):
                sel = Js[:, k] == row
                gname = game_bone(jname[row])
                if gname is None: gname = 'hand_R'
                if gname == 'chest':
                    u = smoothstep(split_lo, split_hi, P[sel, 1])
                    W[sel, IDX['chest']] += Ws[sel, k] * (1 - u)
                    W[sel, IDX['upperChest']] += Ws[sel, k] * u
                else:
                    W[sel, IDX[gname]] += Ws[sel, k]
        if mname == 'InvertedSpearofHeaven' or (outline and kidx['spear'] in np.unique(dom)):
            W[:] = 0; W[:, IDX['hand_R']] = 1                   # the spear is rigid in the hand
        tex = None
        if not outline:
            et = mat.get('emissiveTexture') or mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            tex = js['textures'][et['index']]['source']
        label = {'Hair': 'hair', 'Clothes': 'clothes', 'Body': 'body', 'Bukiko': 'worm', 'InvertedSpearofHeaven': 'spear'}.get(mname)
        parts.append(dict(name=label, src_node=ni, mat=mname, outline=outline, P=P, N=Nn, UV=UV, I=I.reshape(-1), W=W, tex=tex))

    # name the outline shells after the part they wrap (the next node before them in the source)
    named = [p for p in parts if not p['outline']]
    for p in parts:
        if p['outline']:
            twin = max((q for q in named if q['src_node'] < p['src_node']), key=lambda q: q['src_node'])
            p['name'] = 'outline_' + twin['name']
    print('parts:', [(p['name'], len(p['P'])) for p in parts])

    # ---- to metres, feet at 0
    floor = min(float(p['P'][:, 1].min()) for p in parts if not p['outline'] and p['name'] != 'spear')
    top = max(float(p['P'][:, 1].max()) for p in parts if not p['outline'])
    S = HEIGHT / (top - floor)
    off = np.array([0.0, -floor, 0.0])
    def T(v): return ((np.asarray(v, float) + off) * S).astype(np.float32)
    jm = T(G)

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

    images, img_of_src = [], {}
    for p in parts:
        if p['tex'] is None or p['tex'] in img_of_src: continue
        im = Image.open(io.BytesIO(image_bytes(js, b, p['tex']))).convert('RGB')
        size = 2048 if p['name'] == 'body' else 1024  # the face needs the detail
        im = im.resize((min(size, im.width), min(size, im.height)), Image.LANCZOS)
        bio = io.BytesIO(); im.save(bio, 'JPEG', quality=90)
        raw = bio.getvalue()
        while len(binbuf) % 4: binbuf.append(0)
        bvs.append({'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}); binbuf.extend(raw)
        img_of_src[p['tex']] = len(images)
        images.append({'bufferView': len(bvs) - 1, 'mimeType': 'image/jpeg'})
    materials = [{'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.03, 0.03, 0.04, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}}]
    mat_of_part = {}
    for p in parts:
        if p['outline']: mat_of_part[id(p)] = 0; continue
        materials.append({'name': p['mat'], 'doubleSided': p['name'] == 'spear', 'pbrMetallicRoughness': {'baseColorTexture': {'index': img_of_src[p['tex']]}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'extensions': {'KHR_materials_unlit': {}}})
        mat_of_part[id(p)] = len(materials) - 1

    # the spear's two ends in hand_R space (the game uses them to trail slashes along the blade)
    sp = next(p for p in parts if p['name'] == 'spear')
    SP = T(sp['P'])
    hR = jm[IDX['hand_R']]
    d = SP - hR
    ax = np.linalg.svd(d - d.mean(0), full_matrices=False)[2][0]
    tproj = d @ ax
    tipA, tipB = SP[tproj.argmax()], SP[tproj.argmin()]
    # the blade end is the one further from the hand
    far, near = (tipA, tipB) if np.linalg.norm(tipA - hR) > np.linalg.norm(tipB - hR) else (tipB, tipA)
    extras = {'weapon': {'tip': (far - hR).round(4).tolist(), 'butt': (near - hR).round(4).tolist()}}
    print('spear tip', extras['weapon'])

    nodes = [{'name': 'KineSlayer', 'children': [], 'extras': extras}]
    jnode = {}
    for i, (nm, pr) in enumerate(BONES):
        jnode[nm] = len(nodes)
        pp = jm[IDX[pr]] if pr else np.zeros(3, np.float32)
        nodes.append({'name': nm, 'translation': (jm[i] - pp).astype(float).tolist(), 'children': []})
    for nm, pr in BONES:
        (nodes[jnode[pr]]['children'] if pr else nodes[0]['children']).append(jnode[nm])
    for nm, tp in tails.items():
        t_m = T(np.array([tp]))[0]
        nodes.append({'name': nm + '_end', 'translation': (t_m - jm[IDX[nm]]).astype(float).tolist()})
        nodes[jnode[nm]]['children'].append(len(nodes) - 1)
    ibm = np.zeros((len(NAMES), 16), np.float32)
    for i in range(len(NAMES)):
        m4 = np.eye(4, dtype=np.float32); m4[:3, 3] = -jm[i]; ibm[i] = m4.T.reshape(-1)
    skins = [{'joints': [jnode[n] for n in NAMES], 'skeleton': jnode['hips'], 'inverseBindMatrices': push(ibm, typ='MAT4')}]

    meshes = []
    for p in parts:
        W = p['W']
        order = np.argsort(-W, axis=1)[:, :4]
        Wt = np.take_along_axis(W, order, 1)
        Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
        attrs = {'POSITION': push(T(p['P']), 34962, minmax=True)}
        if p['N'] is not None and not p['outline']: attrs['NORMAL'] = push(p['N'].astype(np.float32), 34962)
        if p['UV'] is not None and not p['outline']: attrs['TEXCOORD_0'] = push(p['UV'], 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(order.astype(np.uint8), 34962, comp=5121, typ='VEC4')
        attrs['WEIGHTS_0'] = push(Wt.astype(np.float32), 34962, typ='VEC4')
        idx = p['I'].astype(np.uint16 if p['I'].max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        meshes.append({'name': p['name'], 'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_of_part[id(p)]}]})
        nodes.append({'name': p['name'], 'mesh': len(meshes) - 1, 'skin': 0}); nodes[0]['children'].append(len(nodes) - 1)

    out = {'asset': {'version': '2.0', 'generator': 'magebreak rig_toji.py'}, 'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
           'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
           'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('scale', round(S, 4), 'hips', jm[IDX['hips']].round(3), 'wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
