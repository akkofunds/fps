"""Convert the MANIPULATOR (Ayanokouji Kiyotaka, Sketchfab "Ayanokouji") into a Magebreak mage GLB.

Input : the Sketchfab GLB (skinned, 117 joints, a rigify metarig in T-pose; two meshes: the
        uniform `Cloth` and the head/hair `0`; colours in EMISSIVE textures, near-black base)
Output: public/models/manipulator.glb

Like rig_toji.py the source is already skinned, so its weights are kept and its joints are folded
into the game's 22-bone humanoid:
  * rigify spine chain: spine → hips, spine.001 → spine, spine.002 → chest, spine.003 → upperChest,
    spine.004 → neck, spine.006 → head; hair joints → head; the tie → upperChest / chest;
  * fingers → hand, baked into a relaxed half-fist (he fights bare-handed);
  * inverted-hull ink outlines are generated (pushed out along the normal, winding flipped).

Usage: python3 tools/characters/rig_ayanokoji.py SRC.glb [OUT.glb]      (numpy + Pillow)
"""
import io, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbmesh import read_glb, accessor, image_bytes  # noqa: E402
from strip_glb import write_glb  # noqa: E402

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'manipulator.glb')
HEIGHT = 1.77  # top of the hair, metres (Ayanokouji is 176 cm)
OUTLINE = 0.009  # ink outline thickness, metres

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
    'hips': 'spine', 'spine': 'spine.001', 'chest': 'spine.002', 'upperChest': 'spine.003', 'neck': 'spine.004', 'head': 'spine.006',
    'shoulder_L': 'shoulder.L', 'upperArm_L': 'upper_arm.L', 'foreArm_L': 'forearm.L', 'hand_L': 'hand.L',
    'shoulder_R': 'shoulder.R', 'upperArm_R': 'upper_arm.R', 'foreArm_R': 'forearm.R', 'hand_R': 'hand.R',
    'upperLeg_L': 'thigh.L', 'lowerLeg_L': 'shin.L', 'foot_L': 'foot.L', 'toes_L': 'toe.L',
    'upperLeg_R': 'thigh.R', 'lowerLeg_R': 'shin.R', 'foot_R': 'foot.R', 'toes_R': 'toe.R',
}
FINGERS = ('f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb')
# relaxed half-fist: curl per segment (degrees)
CURL = {'f_index': (38, 58, 34), 'f_middle': (42, 62, 36), 'f_ring': (46, 64, 36), 'f_pinky': (50, 64, 36), 'thumb': (12, 22, 18)}


def game_bone(s):
    s = s[:-4] if s.endswith('_end') else s
    if s.startswith(('HAIR', 'hair')): return 'head'
    if s == 'TIE.001': return 'upperChest'
    if s.startswith('TIE'): return 'chest'
    if s.startswith(FINGERS): return 'hand_' + s[-1]
    for side, G in (('.L', '_L'), ('.R', '_R')):
        if s.endswith(side):
            base = s[:-2]
            return {'shoulder': 'shoulder' + G, 'upper_arm': 'upperArm' + G, 'forearm': 'foreArm' + G, 'hand': 'hand' + G,
                    'thigh': 'upperLeg' + G, 'shin': 'lowerLeg' + G, 'foot': 'foot' + G, 'toe': 'toes' + G}[base]
    return {'spine': 'hips', 'spine.001': 'spine', 'spine.002': 'chest', 'spine.003': 'upperChest', 'spine.004': 'neck', 'spine.006': 'head'}.get(s, 'hips')


def rot_about(p, axis, deg):
    a = np.radians(deg); axis = np.asarray(axis, float) / np.linalg.norm(axis)
    x, y, z = axis; c, s = np.cos(a), np.sin(a); C = 1 - c
    R = np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = p - R @ p
    return M


def main():
    js, b = read_glb(SRC)
    N = js['nodes']
    sk = js['skins'][0]
    J = sk['joints']
    jname = [N[j]['name'].rsplit('_', 1)[0] for j in J]
    kidx = {n: k for k, n in enumerate(jname)}
    IBM = accessor(js, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    BIND = np.linalg.inv(IBM)
    jpos = {n: BIND[k][:3, 3] for k, n in enumerate(jname)}

    # ---- finger curl (forward kinematics in bind space): the palm faces down in the T-pose, the
    # fingers point along ±x, so a curl is a rotation about z (and about the finger's own knuckles)
    DELTA = np.repeat(np.eye(4)[None], len(J), 0)
    for sd, sgn in (('L', -1), ('R', 1)):
        for f in FINGERS:
            chain = [f'{f}.0{i}.{sd}' for i in (1, 2, 3)]
            acc = np.eye(4)
            for i, jn in enumerate(chain):
                axis = (0, 0, 1) if f != 'thumb' else (1 if sd == 'L' else -1, 0, 0.6)
                acc = acc @ rot_about(jpos[jn], axis, sgn * CURL[f][i] if f != 'thumb' else CURL[f][i] * (-1 if sd == 'L' else 1))
                DELTA[kidx[jn]] = acc
            DELTA[kidx[chain[-1] + '_end']] = acc

    # ---- game joint positions
    G = np.zeros((len(NAMES), 3))
    for n, s in POS_FROM.items(): G[IDX[n]] = jpos[s]
    # (the *_end joints carry no bind transform: extrapolate the fingertip from the last two knuckles)
    tip = lambda sd: (DELTA[kidx[f'f_middle.03.{sd}']] @ np.r_[jpos[f'f_middle.03.{sd}'] * 2 - jpos[f'f_middle.02.{sd}'], 1])[:3]
    tails = {
        'head': jpos['spine.006'] + np.array([0, 24.0, 0]),
        'hand_L': tip('L'), 'hand_R': tip('R'),
        'toes_L': jpos['toe.L'] + np.array([0, 0, 9.0]),
        'toes_R': jpos['toe.R'] + np.array([0, 0, 9.0]),
    }

    # ---- meshes
    parts = []
    for ni, n in enumerate(N):
        if 'mesh' not in n or 'skin' not in n: continue
        p = js['meshes'][n['mesh']]['primitives'][0]
        mat = js['materials'][p['material']]
        at = p['attributes']
        P = accessor(js, b, at['POSITION']).astype(float)
        Nn = accessor(js, b, at['NORMAL']).astype(float)
        UV = accessor(js, b, at['TEXCOORD_0']).astype(np.float32)
        I = accessor(js, b, p['indices']).astype(np.int64).reshape(-1)
        Js = accessor(js, b, at['JOINTS_0']).astype(int)
        Ws = accessor(js, b, at['WEIGHTS_0']).astype(float)
        Ph = np.c_[P, np.ones(len(P))]
        P2 = np.zeros_like(P); N2 = np.zeros_like(Nn)
        for k in range(4):
            Mk = DELTA[Js[:, k]]
            P2 += Ws[:, k:k + 1] * np.einsum('nij,nj->ni', Mk, Ph)[:, :3]
            N2 += Ws[:, k:k + 1] * np.einsum('nij,nj->ni', Mk[:, :3, :3], Nn)
        wsum = Ws.sum(1, keepdims=True)
        P = np.where(wsum > 1e-6, P2 / np.maximum(wsum, 1e-6), P)
        Nn = N2 / np.maximum(np.linalg.norm(N2, axis=1, keepdims=True), 1e-9)
        W = np.zeros((len(P), len(NAMES)))
        for k in range(4):
            for row in np.unique(Js[:, k]):
                sel = Js[:, k] == row
                W[sel, IDX[game_bone(jname[row])]] += Ws[sel, k]
        et = mat.get('emissiveTexture') or mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        tex = js['textures'][et['index']]['source']
        label = 'clothes' if mat.get('name') == 'Cloth' else 'head'
        parts.append(dict(name=label, mat=mat.get('name'), outline=False, P=P, N=Nn, UV=UV, I=I, W=W, tex=tex))
    print('parts:', [(p['name'], len(p['P'])) for p in parts])

    # ---- to metres, feet at 0
    floor = min(float(p['P'][:, 1].min()) for p in parts)
    top = max(float(p['P'][:, 1].max()) for p in parts)
    S = HEIGHT / (top - floor)
    off = np.array([0.0, -floor, 0.0])
    def T(v): return ((np.asarray(v, float) + off) * S).astype(np.float32)
    jm = T(G)
    # ink outline on the uniform only: the head's hair cards and recessed eyes do not survive a
    # pushed-out shell (it covers the eyes and draws black slabs between the strands)
    for p in [q for q in parts if q['name'] == 'clothes']:
        parts.append(dict(name='outline_' + p['name'], mat=None, outline=True, P=p['P'] + p['N'] * (OUTLINE / S), N=None, UV=None,
                          I=p['I'].reshape(-1, 3)[:, ::-1].ravel().copy(), W=p['W'].copy(), tex=None))

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
        size = 2048
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
        materials.append({'name': p['mat'], 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': img_of_src[p['tex']]}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'extensions': {'KHR_materials_unlit': {}}})
        mat_of_part[id(p)] = len(materials) - 1

    nodes = [{'name': 'Manipulator', 'children': []}]
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
        if p['N'] is not None: attrs['NORMAL'] = push(p['N'].astype(np.float32), 34962)
        if p['UV'] is not None: attrs['TEXCOORD_0'] = push(p['UV'], 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(order.astype(np.uint8), 34962, comp=5121, typ='VEC4')
        attrs['WEIGHTS_0'] = push(Wt.astype(np.float32), 34962, typ='VEC4')
        idx = p['I'].astype(np.uint16 if p['I'].max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        meshes.append({'name': p['name'], 'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_of_part[id(p)]}]})
        nodes.append({'name': p['name'], 'mesh': len(meshes) - 1, 'skin': 0}); nodes[0]['children'].append(len(nodes) - 1)

    out = {'asset': {'version': '2.0', 'generator': 'magebreak rig_ayanokoji.py'}, 'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
           'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
           'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('scale', round(S, 5), 'hips', jm[IDX['hips']].round(3), 'head', jm[IDX['head']].round(3), 'wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
