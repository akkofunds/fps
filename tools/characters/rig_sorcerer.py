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


def rot_about(axis, deg, pivot):
    a = axis / np.linalg.norm(axis); t = np.radians(deg)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    R = np.eye(3) + np.sin(t) * K + (1 - np.cos(t)) * K @ K
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = pivot - R @ pivot
    return M


# relaxed hands: the source fingers are splayed flat (T-pose) and the game folds every finger into
# the hand bone, so the hands would stay stiff and spread in every pose. Bake a natural relaxed
# curl into the mesh (each finger bent at all three knuckles toward the palm, the thumb tucked a
# little) using the source finger joints, before their weights are merged into the hand.
CURL = {'index': (22, 32, 22), 'middle': (28, 38, 26), 'ring': (32, 42, 28), 'little': (36, 46, 30), 'thumb': (12, 18, 12)}


def finger_deltas(jname, jpos):
    D = [np.eye(4) for _ in jname]
    at = {n: i for i, n in enumerate(jname)}
    for sd in ('.L', '.R'):
        hand = jpos['hand' + sd]
        fdir = jpos['middle_proximal' + sd] - hand; fdir /= np.linalg.norm(fdir)
        across = jpos['little_proximal' + sd] - jpos['index_proximal' + sd]
        across -= fdir * (across @ fdir); across /= np.linalg.norm(across)
        n = np.cross(fdir, across)
        palm = n if n[1] < 0 else -n  # palms face down in the source A-pose
        for f, angs in CURL.items():
            chain = [f + '_' + k + sd for k in ('proximal', 'intermediate', 'distal')]
            d0 = jpos[chain[1]] - jpos[chain[0]]; d0 /= np.linalg.norm(d0)
            axis = across if f != 'thumb' else np.cross(d0, palm)
            sign = 1.0 if np.cross(axis, d0) @ palm > 0 else -1.0
            M = np.eye(4)
            for jn, ang in zip(chain, angs):
                M = M @ rot_about(axis, sign * ang, jpos[jn])
                D[at[jn]] = M.copy()
    return np.array(D)


# ---------------------------------------------------------------- the model's own Hollow Purple
# animation, retargeted: the body motion between these source times (after the hands-together
# hold, up to the wide firing stance), played SPEED times faster in game. The camera rig above
# `root` is removed so only the body moves.
PURPLE_T0, PURPLE_T1, PURPLE_FPS, PURPLE_SPEED = 6.5, 11.9, 30, 1.9


def quat_from_mat(R):
    U, _, Vt = np.linalg.svd(R); R = U @ Vt
    if np.linalg.det(R) < 0: R = -R
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1) * 2; w = 0.25 * s; x = (R[2, 1] - R[1, 2]) / s; y = (R[0, 2] - R[2, 0]) / s; z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2; w = (R[2, 1] - R[1, 2]) / s; x = 0.25 * s; y = (R[0, 1] + R[1, 0]) / s; z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2; w = (R[0, 2] - R[2, 0]) / s; x = (R[0, 1] + R[1, 0]) / s; y = 0.25 * s; z = (R[1, 2] + R[2, 1]) / s
    else:
        s = np.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2; w = (R[1, 0] - R[0, 1]) / s; x = (R[0, 2] + R[2, 0]) / s; y = (R[1, 2] + R[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)


def trs(t, r, sc):
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(sc)[None, :]; M[:3, 3] = t
    return M


def sample_animation(js, b, times):
    """world matrices of every node at each time (LINEAR / STEP / CUBICSPLINE value)"""
    N = js['nodes']
    base = []
    for n in N:
        if 'matrix' in n:
            M = np.array(n['matrix']).reshape(4, 4).T
            base.append(('m', M))
        else:
            base.append(('t', [np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float), np.array(n.get('scale', [1, 1, 1]), float)]))
    an = js['animations'][0]
    chans = []
    for c in an['channels']:
        sm = an['samplers'][c['sampler']]
        if c['target']['path'] not in ('translation', 'rotation', 'scale'): continue
        tin = accessor(js, b, sm['input']).ravel(); out = accessor(js, b, sm['output'])
        if sm.get('interpolation') == 'CUBICSPLINE': out = out.reshape(len(tin), 3, -1)[:, 1]
        chans.append((c['target']['node'], c['target']['path'], tin, out.reshape(len(tin), -1), sm.get('interpolation', 'LINEAR')))
    par = {}
    for i, n in enumerate(N):
        for ch in n.get('children', []): par[ch] = i
    order = []
    seen = set()
    def visit(i):
        if i in seen: return
        if i in par: visit(par[i])
        seen.add(i); order.append(i)
    for i in range(len(N)): visit(i)
    res = []
    for t in times:
        loc = {i: [v.copy() for v in base[i][1]] for i in range(len(N)) if base[i][0] == 't'}
        for ni, path, tin, out, interp in chans:
            if ni not in loc: continue
            k = int(np.clip(np.searchsorted(tin, t) - 1, 0, len(tin) - 2))
            u = 0.0 if interp == 'STEP' else float(np.clip((t - tin[k]) / max(tin[k + 1] - tin[k], 1e-9), 0, 1))
            a, c2 = out[k], out[k + 1]
            if path == 'rotation':
                if a @ c2 < 0: c2 = -c2
                v = a + (c2 - a) * u; v /= np.linalg.norm(v)
            else: v = a + (c2 - a) * u
            loc[ni][{'translation': 0, 'rotation': 1, 'scale': 2}[path]] = v
        W = {}
        for i in order:
            L = base[i][1] if base[i][0] == 'm' else trs(*loc[i])
            W[i] = (W[par[i]] @ L) if i in par else L
        res.append(W)
    return res


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
    DELTA = finger_deltas(jname, jpos)

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
        # pose the fingers into the relaxed curl (linear blend skinning with the source weights)
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

    # ---- the retargeted Hollow Purple: per game bone, the WORLD rotation relative to the bind pose
    # (exactly what the source skinning applies), plus the hips offset — src/character/animator.js
    # turns these into canonical poses with the rig's own corrections
    jnode = {nm: J[k] for k, nm in enumerate(jname)}
    root_i = next(i for i, n in enumerate(N) if n.get('name', '').startswith('root_'))
    times = np.arange(PURPLE_T0, PURPLE_T1 + 1e-6, 1 / PURPLE_FPS)
    Ws_t = sample_animation(js, b, [0.0] + list(times))
    rest_root = Ws_t[0][root_i]
    srcOf = dict(POS_FROM); srcOf['upperChest'] = 'chest'
    kidx = {nm: k for k, nm in enumerate(jname)}
    qs, hips, hip0 = [], [], None
    for W in Ws_t[1:]:
        fix = rest_root @ np.linalg.inv(W[root_i])
        frame = []
        for nm in NAMES:
            sj = srcOf[nm]
            G = fix @ W[jnode[sj]] @ IBM[kidx[sj]]
            frame.extend(np.round(quat_from_mat(G[:3, :3]), 4).tolist())
            if nm == 'hips':
                # relative to the first frame (he is standing still there): the animation's root
                # rest differs from the bind pose by a constant offset
                ph = jpos['hips']; pt = (G @ np.r_[ph, 1])[:3]
                if hip0 is None: hip0 = pt.copy()
                hips.extend(np.round((pt - hip0) * S, 4).tolist())
        qs.extend(frame)
    purple = {'fps': PURPLE_FPS * PURPLE_SPEED, 'bones': NAMES, 'q': qs, 'hip': hips}

    nodes = [{'name': 'Sorcerer', 'children': [], 'extras': {'purple': purple}}]
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
