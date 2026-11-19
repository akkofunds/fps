"""Convert the SORCERER (Gojo Satoru, "Murasaki" Sketchfab scene) into a Magebreak mage GLB.

Input : the Sketchfab GLB (skinned, 122 joints, a 22 s Hollow Purple animation + VFX meshes)
Output: public/models/sorcerer.glb

Unlike the other mages this source is already professionally skinned, so instead of auto-rigging
we keep its weights and fold its joints into the game's 22-bone humanoid:
  * fingers → hand, eyes → head, pectoral helpers → upperChest;
  * the source has a single `chest` joint: its weights are split by height between the game's
    `chest` and `upperChest` (a new joint halfway to the neck) so the torso bends smoothly;
  * game bones have identity rest rotations at the source joint positions (the runtime
    retargeter in src/character/rig.js straightens the bind pose into the canonical stance);
  * the scene's VFX (orbs, sparks, lens flares, the star sphere) and the animation are dropped:
    the game builds its own effects;
  * morph targets are dropped (their default weights are all 0, so the base shape is kept);
  * the model's own inverted-hull ink outlines are kept (material renamed `Outline`);
  * colours come from the EMISSIVE textures (the source uses a near-black base colour factor).

Usage: python3 tools/characters/rig_sorcerer.py SRC.glb [OUT.glb]      (numpy + Pillow)
"""
import io, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbmesh import read_glb, accessor, image_bytes  # noqa: E402
from strip_glb import write_glb  # noqa: E402

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', 'public', 'models', 'sorcerer.glb')
HEIGHT = 1.9  # top of the hair, metres (a tall character)
# the source legs are very slender next to the other mages: thicken them around the bone axis
LEG_THICK = {'thigh': 1.5, 'shin': 1.45, 'foot': 1.15}

# game bone ← source joint(s)
BONES = [  # (name, parent)
    ('hips', None), ('spine', 'hips'), ('chest', 'spine'), ('upperChest', 'chest'), ('neck', 'upperChest'), ('head', 'neck'),
    ('shoulder_L', 'upperChest'), ('upperArm_L', 'shoulder_L'), ('foreArm_L', 'upperArm_L'), ('hand_L', 'foreArm_L'),
    ('shoulder_R', 'upperChest'), ('upperArm_R', 'shoulder_R'), ('foreArm_R', 'upperArm_R'), ('hand_R', 'foreArm_R'),
    ('upperLeg_L', 'hips'), ('lowerLeg_L', 'upperLeg_L'), ('foot_L', 'lowerLeg_L'), ('toes_L', 'foot_L'),
    ('upperLeg_R', 'hips'), ('lowerLeg_R', 'upperLeg_R'), ('foot_R', 'lowerLeg_R'), ('toes_R', 'foot_R'),
]
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
POS_FROM = {  # where each game joint sits (source joint name)
    'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head',
    'shoulder_L': 'shoulder.L', 'upperArm_L': 'upper_arm.L', 'foreArm_L': 'lower_arm.L', 'hand_L': 'hand.L',
    'shoulder_R': 'shoulder.R', 'upperArm_R': 'upper_arm.R', 'foreArm_R': 'lower_arm.R', 'hand_R': 'hand.R',
    'upperLeg_L': 'upper_leg.L', 'lowerLeg_L': 'lower_leg.L', 'foot_L': 'foot.L', 'toes_L': 'toes.L',
    'upperLeg_R': 'upper_leg.R', 'lowerLeg_R': 'lower_leg.R', 'foot_R': 'foot.R', 'toes_R': 'toes.R',
}


def game_bone(src):
    """source joint name → game bone ('chest' is split later)"""
    s = src
    for side, G in (('.L', '_L'), ('.R', '_R')):
        if s.endswith(side):
            base = s[:-2]
            if base in ('eye',): return 'head'
            if base in ('chest',): return 'upperChest'
            if base == 'shoulder': return 'shoulder' + G
            if base == 'upper_arm': return 'upperArm' + G
            if base == 'lower_arm': return 'foreArm' + G
            if base == 'upper_leg': return 'upperLeg' + G
            if base == 'lower_leg': return 'lowerLeg' + G
            if base == 'foot': return 'foot' + G
            if base == 'toes': return 'toes' + G
            return 'hand' + G  # hand + every finger joint
    return {'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}.get(s, 'hips')


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    js, b = read_glb(SRC)
    N = js['nodes']
    sk = js['skins'][0]
    J = sk['joints']
    jname = [N[j]['name'].rsplit('_', 1)[0] for j in J]
    IBM = accessor(js, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    JW = np.linalg.inv(IBM)[:, :3, 3]  # joint positions at bind (scene space, Y-up, faces +Z, left = +X)
    jpos = dict(zip(jname, JW))

    # ---- game joint positions
    G = np.zeros((len(NAMES), 3))
    for n, s in POS_FROM.items(): G[IDX[n]] = jpos[s]
    G[IDX['upperChest']] = jpos['chest'] + (jpos['neck'] - jpos['chest']) * 0.5
    split_lo, split_hi = jpos['chest'][1], G[IDX['upperChest']][1]
    tails = {
        'head': jpos['head'] + np.array([0, 0.3, 0]),
        'hand_L': jpos['middle_distal.L'] + (jpos['middle_distal.L'] - jpos['middle_intermediate.L']) * 0.8,
        'hand_R': jpos['middle_distal.R'] + (jpos['middle_distal.R'] - jpos['middle_intermediate.R']) * 0.8,
        'toes_L': jpos['toes.L'] + np.array([0, 0, 0.1]),
        'toes_R': jpos['toes.R'] + np.array([0, 0, 0.1]),
    }

    # ---- the three body meshes and their outline shells
    parts = []
    for ni, n in enumerate(N):
        if 'mesh' not in n or 'skin' not in n: continue
        m = js['meshes'][n['mesh']]
        p = m['primitives'][0]
        mat = js['materials'][p['material']]
        mname = mat.get('name', '')
        outline = 'Outline' in mname
        if not outline and mname not in ('Hair', 'Clothes', 'Base'): continue  # VFX
        at = p['attributes']
        P = accessor(js, b, at['POSITION'])
        Nn = accessor(js, b, at['NORMAL']) if 'NORMAL' in at else None
        UV = accessor(js, b, at['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in at else None
        I = accessor(js, b, p['indices']).astype(np.uint32)
        Js = accessor(js, b, at['JOINTS_0']).astype(int)
        Ws = accessor(js, b, at['WEIGHTS_0'])
        W = np.zeros((len(P), len(NAMES)))
        for k in range(4):
            for row in np.unique(Js[:, k]):
                sel = Js[:, k] == row
                gname = game_bone(jname[row])
                if gname == 'chest':
                    # split the source chest between chest / upperChest by height
                    u = smoothstep(split_lo, split_hi, P[sel, 1])
                    W[sel, IDX['chest']] += Ws[sel, k] * (1 - u)
                    W[sel, IDX['upperChest']] += Ws[sel, k] * u
                else:
                    W[sel, IDX[gname]] += Ws[sel, k]
        # texture: the emissive map carries the colours
        tex = None
        if not outline:
            et = mat.get('emissiveTexture') or mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            tex = js['textures'][et['index']]['source']
        label = {'Hair': 'hair', 'Clothes': 'clothes', 'Base': 'body'}.get(mname)
        parts.append(dict(name=label if label else None, src_node=ni, mat=mname, outline=outline, P=P, N=Nn, UV=UV, I=I, W=W, tex=tex))
    # ---- thicker legs: push every leg vertex away from the nearest point on its leg's bone chain,
    # weighted by how much the leg drives it (so the hips / waist blend smoothly)
    def thicken(P, W):
        P = P.copy()
        for side, x0 in (('L', '.L'), ('R', '.R')):
            hip, knee, ank = jpos['upper_leg' + x0], jpos['lower_leg' + x0], jpos['foot' + x0]
            wt = W[:, IDX['upperLeg_' + side]]; ws = W[:, IDX['lowerLeg_' + side]]; wf = W[:, IDX['foot_' + side]]
            wl = wt + ws + wf
            sel = wl > 1e-3
            if not sel.any(): continue
            Q = P[sel]
            best = None
            for a, b2 in ((hip, knee), (knee, ank)):
                d = b2 - a
                t = np.clip(((Q - a) @ d) / (d @ d), 0, 1)
                c = a + t[:, None] * d
                dist = np.linalg.norm(Q - c, axis=1)
                best = (c, dist) if best is None else (np.where((dist < best[1])[:, None], c, best[0]), np.minimum(dist, best[1]))
            c = best[0]
            k = (wt[sel] * LEG_THICK['thigh'] + ws[sel] * LEG_THICK['shin'] + wf[sel] * LEG_THICK['foot']) / np.maximum(wl[sel], 1e-6)
            k = 1 + (k - 1) * np.clip(wl[sel], 0, 1)
            off = Q - c
            off[:, 1] *= np.where(wf[sel] > 0.5, 1.0, 1.0)  # keep the soles on the ground (feet barely change)
            newQ = c + off * k[:, None]
            # never let an inner thigh cross the midline into the other leg
            sg = np.sign(hip[0])
            newQ[:, 0] = np.where(sg * newQ[:, 0] < 0.012, np.where(sg * Q[:, 0] < 0.012, Q[:, 0], sg * 0.012), newQ[:, 0])
            # feet: don't push the soles below the floor
            newQ[:, 1] = np.maximum(newQ[:, 1], np.minimum(Q[:, 1], 0.0))
            P[sel] = newQ
        return P
    for p in parts: p['P'] = thicken(p['P'], p['W'])

    # name the outline shells after the part they wrap (same vertex count, node order)
    named = [p for p in parts if not p['outline']]
    for p in parts:
        if p['outline']:
            twin = min(named, key=lambda q: (abs(len(q['P']) - len(p['P'])), abs(q['src_node'] - p['src_node'])))
            p['name'] = 'outline_' + twin['name']
    print('parts:', [(p['name'], len(p['P'])) for p in parts])

    # ---- to metres, feet at 0
    floor = min(float(p['P'][:, 1].min()) for p in parts if not p['outline'])
    top = max(float(p['P'][:, 1].max()) for p in parts if not p['outline'])
    S = HEIGHT / (top - floor)
    off = np.array([0.0, -floor, 0.0])
    def T(v): return ((v + off) * S).astype(np.float32)
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

    # textures → JPEG (opaque)
    images, img_of_src = [], {}
    for p in parts:
        if p['tex'] is None or p['tex'] in img_of_src: continue
        im = Image.open(io.BytesIO(image_bytes(js, b, p['tex']))).convert('RGB')
        size = 2048 if p['name'] == 'body' else 1024  # the face needs the detail
        im = im.resize((size, size), Image.LANCZOS)
        bio = io.BytesIO(); im.save(bio, 'JPEG', quality=90)
        raw = bio.getvalue()
        while len(binbuf) % 4: binbuf.append(0)
        bvs.append({'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(raw)}); binbuf.extend(raw)
        img_of_src[p['tex']] = len(images)
        images.append({'bufferView': len(bvs) - 1, 'mimeType': 'image/jpeg'})
    materials = [{'name': 'Outline', 'pbrMetallicRoughness': {'baseColorFactor': [0.04, 0.03, 0.06, 1], 'metallicFactor': 0}, 'extensions': {'KHR_materials_unlit': {}}}]
    mat_of_part = {}
    for p in parts:
        if p['outline']: mat_of_part[id(p)] = 0; continue
        materials.append({'name': p['mat'], 'doubleSided': False, 'pbrMetallicRoughness': {'baseColorTexture': {'index': img_of_src[p['tex']]}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'extensions': {'KHR_materials_unlit': {}}})
        mat_of_part[id(p)] = len(materials) - 1

    nodes = [{'name': 'Sorcerer', 'children': []}]
    jnode = {}
    for i, (nm, par) in enumerate(BONES):
        jnode[nm] = len(nodes)
        pp = jm[IDX[par]] if par else np.zeros(3, np.float32)
        nodes.append({'name': nm, 'translation': (jm[i] - pp).astype(float).tolist(), 'children': []})
    for nm, par in BONES:
        (nodes[jnode[par]]['children'] if par else nodes[0]['children']).append(jnode[nm])
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
        # top-4 influences, renormalised
        order = np.argsort(-W, axis=1)[:, :4]
        Wt = np.take_along_axis(W, order, 1)
        Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-9)
        Jt = order.astype(np.uint8)
        attrs = {'POSITION': push(T(p['P']), 34962, minmax=True)}
        if p['N'] is not None and not p['outline']: attrs['NORMAL'] = push(p['N'].astype(np.float32), 34962)
        if p['UV'] is not None and not p['outline']: attrs['TEXCOORD_0'] = push(p['UV'], 34962, typ='VEC2')
        attrs['JOINTS_0'] = push(Jt, 34962, comp=5121, typ='VEC4')
        attrs['WEIGHTS_0'] = push(Wt.astype(np.float32), 34962, typ='VEC4')
        idx = p['I'].astype(np.uint16 if p['I'].max() < 65535 else np.uint32)
        ia = push(idx, 34963, comp=5123 if idx.dtype == np.uint16 else 5125, typ='SCALAR')
        meshes.append({'name': p['name'], 'primitives': [{'attributes': attrs, 'indices': ia, 'material': mat_of_part[id(p)]}]})
        nodes.append({'name': p['name'], 'mesh': len(meshes) - 1, 'skin': 0}); nodes[0]['children'].append(len(nodes) - 1)

    out = {'asset': {'version': '2.0', 'generator': 'magebreak rig_sorcerer.py'}, 'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': skins, 'materials': materials,
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
           'textures': [{'sampler': 0, 'source': i} for i in range(len(images))], 'images': images,
           'accessors': accs, 'bufferViews': bvs, 'buffers': [{'byteLength': len(binbuf)}]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_glb(OUT, out, bytes(binbuf))
    print('scale', round(S, 4), 'hips', jm[IDX['hips']].round(3), 'wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
