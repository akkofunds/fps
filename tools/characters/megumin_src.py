"""Load the Megumin source GLB (tools/characters/src/megumin_original.glb) as upright, metric parts.

The source is a static (unskinned) FBX export: 20 mesh parts in a natural standing pose (left hand on
the hip, staff in the right hand, cloak hanging), the whole figure leaning forward ~13°. We bake the
node transforms, stand her upright (rotate about X through the feet), put the feet on y = 0 and the
pelvis on x = z = 0, and scale to 1.52 m (top of the head, excluding the hat)."""
import os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from glbmesh import read_glb, baked_primitives  # noqa: E402

SRC = os.path.join(HERE, 'src', 'megumin_original.glb')
HEIGHT = 1.52


def load(path=SRC):
    js, b = read_glb(path)
    root = js['scenes'][0]['nodes'][0]
    prims = baked_primitives(js, b, root)
    skin = [p for p in prims if p[0].endswith('Megumin skin_0')][0][2]
    # lean: ankles → base of the neck
    ank = skin[(skin[:, 1] > -1.02) & (skin[:, 1] < -0.95)].mean(0)
    neck = skin[(skin[:, 1] > 0.40) & (skin[:, 1] < 0.44)].mean(0)
    v = neck - ank
    ang = np.arctan2(v[2], v[1])        # forward lean about +X
    c, s = np.cos(-ang), np.sin(-ang)
    Rx = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    def xf(P): return (P - ank) @ Rx.T
    sk = xf(skin)
    floor = sk[:, 1].min()
    top = sk[:, 1].max()
    hipband = sk[(sk[:, 1] > floor + 0.52 * (top - floor)) & (sk[:, 1] < floor + 0.56 * (top - floor))]
    pel = np.array([(hipband[:, 0].min() + hipband[:, 0].max()) / 2, 0, hipband[:, 2].mean()])
    head_top = max(p[2][:, 1].max() for p in [(n, m, xf(P)) for n, m, P, *_ in prims if 'head_0' in n or 'hairB' in n])
    S = HEIGHT / (head_top - floor)
    off = np.array([pel[0], floor, pel[2]])
    parts = []
    for nm, mat, P, N, UV, I in prims:
        Q = (xf(P) - off) * S
        Nn = N @ Rx.T if N is not None else None
        parts.append(dict(name=nm, mat=mat, P=Q, N=Nn, UV=UV, I=I.copy()))
    # The source holds the staff in her LEFT hand; the game's rig/animations put it in the right.
    # Mirror the whole figure in X, then mirror the head parts back about the head's centre line so
    # the face (eyepatch on her left eye, hair parting) stays as modelled.
    HEADP = ('head_0', 'hairF', 'hairB', 'EYES', 'EYE PATCH', 'EYEBROWS', 'HAT', 'COLLAR')
    hd = [p for p in parts if p['name'].endswith('head_0')][0]['P']
    hx = (hd[:, 0].min() + hd[:, 0].max()) / 2
    for p in parts:
        isHead = any(k in p['name'] for k in HEADP)
        p['P'][:, 0] = -p['P'][:, 0]
        if p['N'] is not None: p['N'][:, 0] = -p['N'][:, 0]
        if isHead:  # mirror back about the (mirrored) head centre line
            p['P'][:, 0] = -2 * hx - p['P'][:, 0]
            if p['N'] is not None: p['N'][:, 0] = -p['N'][:, 0]
        else:
            p['I'] = p['I'].reshape(-1, 3)[:, ::-1].ravel().copy()
    return js, b, parts, dict(lean_deg=np.degrees(ang), scale=S, head_x=-hx)


if __name__ == '__main__':
    js, b, parts, info = load()
    print(info)
    for p in parts: print(f"{p['name'][:40]:40s} {len(p['P']):6d} min {p['P'].min(0).round(3)} max {p['P'].max(0).round(3)}")
