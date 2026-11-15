"""Strip meshes/materials from a GLB and repack it (pure Python, no deps).

Usage: python3 strip_glb.py in.glb out.glb --drop-material Fire
Drops every primitive using the named material(s), then removes all
accessors/bufferViews/images/textures/materials no longer referenced.
"""
import json, struct, sys, argparse

def read_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF'
    off = 12
    js = bin_ = None
    while off < len(d):
        ln, typ = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A: js = json.loads(chunk)
        elif typ == 0x004E4942: bin_ = chunk
        off += 8 + ln
    return js, bin_

def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bin_ += b'\0' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--drop-material', action='append', default=[])
    args = ap.parse_args()
    js, bin_ = read_glb(args.src)
    drop = {i for i, m in enumerate(js['materials']) if m.get('name') in args.drop_material}
    # drop primitives / meshes / nodes
    keep_mesh = {}
    meshes = []
    for i, m in enumerate(js['meshes']):
        prims = [p for p in m['primitives'] if p.get('material') not in drop]
        if prims:
            m['primitives'] = prims
            keep_mesh[i] = len(meshes); meshes.append(m)
    js['meshes'] = meshes
    for n in js['nodes']:
        if 'mesh' in n:
            if n['mesh'] in keep_mesh: n['mesh'] = keep_mesh[n['mesh']]
            else: del n['mesh']
    # materials
    used_mat = sorted({p['material'] for m in meshes for p in m['primitives'] if 'material' in p})
    mat_map = {o: i for i, o in enumerate(used_mat)}
    js['materials'] = [js['materials'][o] for o in used_mat]
    for m in meshes:
        for p in m['primitives']:
            if 'material' in p: p['material'] = mat_map[p['material']]
    # textures
    def tex_refs(obj, fn):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, dict) and 'index' in v and k.lower().endswith('texture'): fn(v)
                else: tex_refs(v, fn)
        elif isinstance(obj, list):
            for v in obj: tex_refs(v, fn)
    used_tex = set(); tex_refs(js['materials'], lambda v: used_tex.add(v['index']))
    used_tex = sorted(used_tex); tex_map = {o: i for i, o in enumerate(used_tex)}
    def remap(v): v['index'] = tex_map[v['index']]
    tex_refs(js['materials'], remap)
    js['textures'] = [js['textures'][o] for o in used_tex]
    used_img = sorted({t['source'] for t in js['textures']}); img_map = {o: i for i, o in enumerate(used_img)}
    js['images'] = [js['images'][o] for o in used_img]
    for t in js['textures']: t['source'] = img_map[t['source']]
    # accessors
    used_acc = set()
    for m in meshes:
        for p in m['primitives']:
            used_acc.update(p['attributes'].values())
            if 'indices' in p: used_acc.add(p['indices'])
    used_acc = sorted(used_acc); acc_map = {o: i for i, o in enumerate(used_acc)}
    js['accessors'] = [js['accessors'][o] for o in used_acc]
    for m in meshes:
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = acc_map[p['indices']]
    # bufferViews + repack binary
    used_bv = sorted({a['bufferView'] for a in js['accessors'] if 'bufferView' in a} | {i['bufferView'] for i in js['images']})
    bv_map = {}; out = bytearray(); bvs = []
    for o in used_bv:
        bv = dict(js['bufferViews'][o]); s = bv.get('byteOffset', 0)
        data = bin_[s:s + bv['byteLength']]
        while len(out) % 4: out.append(0)
        bv['byteOffset'] = len(out); bv['buffer'] = 0
        out += data; bv_map[o] = len(bvs); bvs.append(bv)
    js['bufferViews'] = bvs
    for a in js['accessors']: a['bufferView'] = bv_map[a['bufferView']]
    for i in js['images']: i['bufferView'] = bv_map[i['bufferView']]
    js['buffers'] = [{'byteLength': len(out)}]
    write_glb(args.dst, js, bytes(out))
    print("wrote", args.dst, len(out), 'bytes;', len(meshes), 'meshes;', [m['name'] for m in js['materials']])

if __name__ == '__main__':
    main()
