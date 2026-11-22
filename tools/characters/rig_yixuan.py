"""Convert INKWEAVER (Yixuan, Zenless Zone Zero — Sketchfab "Yixuan ZZZ" by ansaldotoys2, CC-BY-4.0)
into a Magebreak mage GLB.

Input : the Sketchfab GLB (skinned, 358 joints: a 3ds Max Biped `Bip001` skeleton plus twist /
        cloth / hair / accessory helpers and her pet bird; A-pose bind; base-colour textures)
Output: public/models/inkweaver.glb

The source is already professionally skinned, so its weights are kept and its joints folded into
the game's 22-bone humanoid:
  * the Biped chain maps straight across (Pelvis → hips, Spine / Spine1 / Spine2 → spine / chest /
    upperChest, Clavicle → shoulder, Calf → lowerLeg, Toe0 → toes, …);
  * every helper joint (twists, sleeves, jacket, hair, collar, pendants, the gourd…) goes to the
    nearest Biped ancestor, so it moves with the body part it hangs from;
  * some joints have identity inverse-bind matrices (unused by the skin), so joint positions come
    from the node hierarchy at rest, mapped into bind space through a joint whose IBM is valid;
  * the pet bird (Yuansy) and the transparent hair-shadow overlay are dropped;
  * game bones have identity rest rotations at the source joint positions (the runtime retargeter
    in src/character/rig.js straightens the A-pose into the canonical stance);
  * an inverted-hull ink outline is generated on the clothes and hair (not the face).

Usage: python3 tools/characters/rig_yixuan.py SRC.glb [OUT.glb]      (numpy + Pillow)
"""
import io, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbmesh import read_glb, accessor, image_bytes  # noqa: E402
from strip_glb import write_glb  # noqa: E402

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'inkweaver.glb')
HEIGHT = 1.66    # top of the hair, metres
OUTLINE = 0.008  # ink outline thickness, metres

BONES = [  # (name, parent)
    ('hips', None), ('spine', 'hips'), ('chest', 'spine'), ('upperChest', 'chest'), ('neck', 'upperChest'), ('head', 'neck'),
    ('shoulder_L', 'upperChest'), ('upperArm_L', 'shoulder_L'), ('foreArm_L', 'upperArm_L'), ('hand_L', 'foreArm_L'),
    ('shoulder_R', 'upperChest'), ('upperArm_R', 'shoulder_R'), ('foreArm_R', 'upperArm_R'), ('hand_R', 'foreArm_R'),
    ('upperLeg_L', 'hips'), ('lowerLeg_L', 'upperLeg_L'), ('foot_L', 'lowerLeg_L'), ('toes_L', 'foot_L'),
    ('upperLeg_R', 'hips'), ('lowerLeg_R', 'upperLeg_R'), ('foot_R', 'lowerLeg_R'), ('toes_R', 'foot_R'),
    # secondary motion (never animated by the rig; driven by src/character/jiggle.js): a pivot on the
    # upper chest and the soft mass hanging from it, per side
    ('breast_L', 'upperChest'), ('breastTip_L', 'breast_L'), ('breast_R', 'upperChest'), ('breastTip_R', 'breast_R'),
    # the thighs' soft mass (source: Skn_*_Thigh_Shake)
    ('thigh_L', 'upperLeg_L'), ('thigh_R', 'upperLeg_R'),
]
# hair: the main strand of each lock is kept as a chain (hair<lock><n>, n from the scalp down); the
# branches of a lock ride on their nearest kept joint. All swung by spring bones in jiggle.js.
HAIR = {  # game chain → the source joints, scalp first
    'BA': ['Ctr_B_HairA_01', 'Ctr_B_HairA_02', 'Ctr_B_HairA_03', 'Ctr_B_HairA_04', 'Ctr_B_HairA_05', 'Ctr_B_HairA_06', 'Ctr_B_HairA_07'],
    'BB': ['Ctr_B_HairB_01', 'Ctr_B_HairB_02', 'Ctr_B_HairB_03', 'Ctr_B_HairB_04', 'Ctr_B_HairB_05', 'Ctr_B_HairB_06', 'Ctr_B_HairB_07'],
    'LA': ['Ctr_L_HairA_01', 'Ctr_L_HairA_02', 'Ctr_L_HairA_03', 'Ctr_L_HairA_04'],
    'LB': ['Ctr_L_HairB_01', 'Ctr_L_HairB_02', 'Ctr_L_HairB_03'],
    'RA': ['Ctr_R_HairA_01', 'Ctr_R_HairA_02', 'Ctr_R_HairA_04'],
    'RB': ['Ctr_R_HairB_01', 'Ctr_R_HairB_02', 'Ctr_R_HairB_03'],
    'RC': ['Ctr_R_HairC_01', 'Ctr_R_HairC_02', 'Ctr_R_HairC_03'],
    'T': ['Ctr_T_Hair_01', 'Ctr_T_Hair_02'],
}
for lock, js_ in HAIR.items():
    for k in range(len(js_)): BONES.append((f'hair{lock}{k + 1}', 'head' if k == 0 else f'hair{lock}{k}'))
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
BIP = {
    'Bip001 Pelvis': 'hips', 'Bip001 Spine': 'spine', 'Bip001 Spine1': 'chest', 'Bip001 Spine2': 'upperChest',
    'Bip001 Neck': 'neck', 'Bip001 Head': 'head',
    'Bip001 L Clavicle': 'shoulder_L', 'Bip001 L UpperArm': 'upperArm_L', 'Bip001 L Forearm': 'foreArm_L', 'Bip001 L Hand': 'hand_L',
    'Bip001 R Clavicle': 'shoulder_R', 'Bip001 R UpperArm': 'upperArm_R', 'Bip001 R Forearm': 'foreArm_R', 'Bip001 R Hand': 'hand_R',
    'Bip001 L Thigh': 'upperLeg_L', 'Bip001 L Calf': 'lowerLeg_L', 'Bip001 L Foot': 'foot_L', 'Bip001 L Toe0': 'toes_L',
    'Bip001 R Thigh': 'upperLeg_R', 'Bip001 R Calf': 'lowerLeg_R', 'Bip001 R Foot': 'foot_R', 'Bip001 R Toe0': 'toes_R',
}
# chest joints kept for the jiggle: the pivot (Skn_*_Chest) and its control joints. Cj_01 carries most
# of the skin (the main mass) → the tip bone; Cj_02..04 (the sides / underside) stay with the pivot
JIGGLE = {'Skn_L_Chest': 'breast_L', 'Skn_L_Chest_Cj_01': 'breastTip_L', 'Skn_L_Chest_Cj_02': 'breast_L', 'Skn_L_Chest_Cj_03': 'breast_L', 'Skn_L_Chest_Cj_04': 'breast_L',
          'Skn_R_Chest': 'breast_R', 'Skn_R_Chest_Cj_01': 'breastTip_R', 'Skn_R_Chest_Cj_02': 'breast_R', 'Skn_R_Chest_Cj_03': 'breast_R', 'Skn_R_Chest_Cj_04': 'breast_R'}
JIGGLE_POS = {'breast_L': 'Skn_L_Chest', 'breastTip_L': 'Skn_L_Chest_Cj_01', 'breast_R': 'Skn_R_Chest', 'breastTip_R': 'Skn_R_Chest_Cj_01'}
JIGGLE.update({'Skn_L_Thigh_Shake': 'thigh_L', 'Skn_R_Thigh_Shake': 'thigh_R'})
JIGGLE_POS.update({'thigh_L': 'Skn_L_Thigh_Shake', 'thigh_R': 'Skn_R_Thigh_Shake'})
for lock, js_ in HAIR.items():
    for k, src in enumerate(js_): JIGGLE[src] = f'hair{lock}{k + 1}'; JIGGLE_POS[f'hair{lock}{k + 1}'] = src
DROP_MATS = ('MAT_YiXuan_Yuansy_UI', 'material_0')   # the pet bird, the hair-shadow overlay
NO_OUTLINE = ('MAT_YiXuan_Face_UI', 'MAT_YiXuan_Eyebrows_UI', 'MAT_YiXuan_Eye_UI', 'MAT_YiXuan_Body_2_T_UI')


def strip(n):
    """'Bip001 L Forearm_046' → 'Bip001 L Forearm' (Sketchfab appends _<index>)."""
    return n.rsplit('_', 1)[0] if '_' in n and n.rsplit('_', 1)[1].isdigit() else n


def trs(n):
    if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
    M = np.eye(4)
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        M[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    if 'scale' in n: M[:3, :3] = M[:3, :3] @ np.diag(n['scale'])
    if 'translation' in n: M[:3, 3] = n['translation']
    return M


def main():
    js, b = read_glb(SRC)
    N = js['nodes']
    par = {}
    for i, n in enumerate(N):
        for c in n.get('children', []): par[c] = i
    world = {}
    def W(i):
        if i not in world: world[i] = (W(par[i]) if i in par else np.eye(4)) @ trs(N[i])
        return world[i]
    sk = js['skins'][0]
    J = sk['joints']
    IBM = accessor(js, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    # world (scene, at rest) → bind space, from a joint whose IBM is real
    ref = [k for k, j in enumerate(J) if strip(N[j]['name']) == 'Bip001 Head'][0]
    A = np.linalg.inv(IBM[ref]) @ np.linalg.inv(W(J[ref]))
    bindpos = lambda node: (A @ W(node))[:3, 3]

    # ---- each source joint → the game bone of its nearest Biped ancestor (itself if it is one)
    node_of = {strip(N[j]['name']): j for j in J}
    def game_of(node):
        i = node
        while i is not None:
            nm = strip(N[i].get('name', ''))
            if nm in JIGGLE: return JIGGLE[nm]
            if nm in BIP: return BIP[nm]
            i = par.get(i)
        return 'hips'
    jgame = [game_of(j) for j in J]

    G = np.zeros((len(NAMES), 3))
    for src, g in BIP.items(): G[IDX[g]] = bindpos(node_of[src])
    for g, src in JIGGLE_POS.items(): G[IDX[g]] = bindpos(node_of[src])
    fing = lambda sd, k: bindpos(node_of[f'Bip001 {sd} Finger{k}'])
    tails = {
        'head': G[IDX['head']] + np.array([0, 0.2, 0]),
        'hand_L': fing('L', 22) * 2 - fing('L', 21), 'hand_R': fing('R', 22) * 2 - fing('R', 21),
        'toes_L': G[IDX['toes_L']] + np.array([0, 0, 0.06]), 'toes_R': G[IDX['toes_R']] + np.array([0, 0, 0.06]),
    }

    # ---- meshes (positions are in bind space already: the mesh nodes sit under identity transforms
    # relative to the skeleton root, which A accounts for)
    parts = []
    for ni, n in enumerate(N):
        if 'mesh' not in n or 'skin' not in n: continue
        for p in js['meshes'][n['mesh']]['primitives']:
            mat = js['materials'][p['material']]
            if mat.get('name') in DROP_MATS: continue
            at = p['attributes']
            P = accessor(js, b, at['POSITION']).astype(float)
            Nn = accessor(js, b, at['NORMAL']).astype(float)
            UV = accessor(js, b, at['TEXCOORD_0']).astype(np.float32)
            I = accessor(js, b, p['indices']).astype(np.int64).reshape(-1)
            Js = accessor(js, b, at['JOINTS_0']).astype(int)
            Ws = accessor(js, b, at['WEIGHTS_0']).astype(float)
            Wt = np.zeros((len(P), len(NAMES)))
            for k in range(4):
                for row in np.unique(Js[:, k]):
                    sel = Js[:, k] == row
                    Wt[sel, IDX[jgame[row]]] += Ws[sel, k]
            tex = mat['pbrMetallicRoughness']['baseColorTexture']['index']
            tex = js['textures'][tex]['source']
            parts.append(dict(name=mat['name'].replace('MAT_YiXuan_', '').replace('_UI', '').lower(), mat=mat['name'], outline=False,
                              P=P, N=Nn, UV=UV, I=I, W=Wt, tex=tex))
    print('parts:', [(p['name'], len(p['P'])) for p in parts])

    # ---- to metres, feet at 0
    floor = min(float(p['P'][:, 1].min()) for p in parts)
    top = max(float(p['P'][:, 1].max()) for p in parts)
    S = HEIGHT / (top - floor)
    off = np.array([0.0, -floor, 0.0])
    def T(v): return ((np.asarray(v, float) + off) * S).astype(np.float32)
    jm = T(G)
    for p in [q for q in parts if q['mat'] not in NO_OUTLINE]:
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
        im = Image.open(io.BytesIO(image_bytes(js, b, p['tex']))).convert('RGBA')
        im = im.resize((min(2048, im.width), min(2048, im.height)), Image.LANCZOS)
        has_alpha = np.asarray(im)[:, :, 3].min() < 250
        bio = io.BytesIO()
        if has_alpha: im.save(bio, 'PNG', optimize=True); mime = 'image/png'
        else: im.convert('RGB').save(bio, 'JPEG', quality=90); mime = 'image/jpeg'
        raw = bio.getvalue()
        while len(binbuf) % 4: binbuf.append(0)
        bvs.append({'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}); binbuf.extend(raw)
        img_of_src[p['tex']] = len(images)
        images.append({'bufferView': len(bvs) - 1, 'mimeType': mime})
        print('texture', p['tex'], im.size, mime, 'alpha' if has_alpha else '')
    materials = [{'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.04, 0.04, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}}]
    mat_of_part = {}
    for p in parts:
        if p['outline']: mat_of_part[id(p)] = 0; continue
        m = {'name': p['mat'], 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': img_of_src[p['tex']]}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'extensions': {'KHR_materials_unlit': {}}}
        if images[img_of_src[p['tex']]]['mimeType'] == 'image/png': m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.4
        materials.append(m)
        mat_of_part[id(p)] = len(materials) - 1

    nodes = [{'name': 'Inkweaver', 'children': []}]
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
        Wm = p['W']
        order = np.argsort(-Wm, axis=1)[:, :4]
        Wt = np.take_along_axis(Wm, order, 1)
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

    out = {'asset': {'version': '2.0', 'generator': 'magebreak rig_yixuan.py', 'copyright': 'Yixuan ZZZ by ansaldotoys2 (Sketchfab), CC-BY-4.0'},
           'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
           'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
           'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('scale', round(S, 5), 'hips', jm[IDX['hips']].round(3), 'head', jm[IDX['head']].round(3), 'handL', jm[IDX['hand_L']].round(3),
          'footL', jm[IDX['foot_L']].round(3), 'wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
