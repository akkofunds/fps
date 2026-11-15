"""Shared helpers: read every mesh primitive of a GLB with node transforms baked in."""
import json, struct, numpy as np


def read_glb(path):
    d = open(path, 'rb').read()
    off, js, b = 12, None, None
    while off < len(d):
        ln, typ = struct.unpack('<II', d[off:off + 8])
        c = d[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A: js = json.loads(c)
        elif typ == 0x004E4942: b = c
        off += 8 + ln
    return js, b


def accessor(js, b, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride')
    size = np.dtype(dt).itemsize * n
    if stride and stride != size:
        raw = np.frombuffer(b, dtype=np.uint8, count=stride * a['count'], offset=o).reshape(-1, stride)[:, :size]
        r = np.frombuffer(raw.tobytes(), dtype=dt)
    else:
        r = np.frombuffer(b, dtype=dt, count=a['count'] * n, offset=o)
    return (r.reshape(-1, n) if n > 1 else r).astype(np.float64 if dt == np.float32 else np.int64).copy()


def node_matrix(n):
    if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    if 'scale' in n: M = np.diag(list(n['scale']) + [1.0]) @ M
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        T = np.eye(4); T[:3, :3] = R; M = T @ M
    if 'translation' in n:
        T = np.eye(4); T[:3, 3] = n['translation']; M = T @ M
    return M


def baked_primitives(js, b, root, root_matrix=None):
    """yield (node_name, material_index, P(N,3), N(N,3)|None, UV|None, I) in world space of `root`"""
    out = []

    def walk(ni, M):
        n = js['nodes'][ni]
        W = M @ node_matrix(n)
        if 'mesh' in n:
            for p in js['meshes'][n['mesh']]['primitives']:
                at = p['attributes']
                P = accessor(js, b, at['POSITION'])
                P = (W @ np.c_[P, np.ones(len(P))].T).T[:, :3]
                N = None
                if 'NORMAL' in at:
                    N = accessor(js, b, at['NORMAL'])
                    Nm = np.linalg.inv(W[:3, :3]).T
                    N = (Nm @ N.T).T
                    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
                UV = accessor(js, b, at['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in at else None
                I = accessor(js, b, p['indices']).astype(np.uint32) if 'indices' in p else np.arange(len(P), dtype=np.uint32)
                if np.linalg.det(W[:3, :3]) < 0: I = I.reshape(-1, 3)[:, ::-1].ravel()
                out.append((n.get('name', ''), p.get('material'), P, N, UV, I))
        for c in n.get('children', []): walk(c, W)

    walk(root, root_matrix if root_matrix is not None else np.eye(4))
    return out


def image_bytes(js, b, img_index):
    im = js['images'][img_index]; bv = js['bufferViews'][im['bufferView']]
    return b[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
