import json, math, sys
sys.path.insert(0, 'tools')
from mapping import *
from collections import defaultdict
g = json.load(open('work/g_graph.json'))
LOGO = lambda n: n['x'] > 1000 and n['y'] > 600
nodes = {n['id']: dict(n) for n in g['nodes'] if not LOGO(n)}
for j in g['junctions']:
    if not LOGO(j): nodes[j['id']] = dict(id=j['id'], x=j['x'], y=j['y'])
edges = [(a, b) for a, b in g['edges'] if a in nodes and b in nodes]
# junction refinement: put junction where its member lines meet (centroid of members is wrong); use component mean (already) 
adj = defaultdict(set)
for a, b in edges: adj[a].add(b); adj[b].add(a)
# --- faces (blocks) via planar traversal with straight-line angles in graph-image space
def ang(u, v): return math.atan2(nodes[v]['y'] - nodes[u]['y'], nodes[v]['x'] - nodes[u]['x'])
order = {u: sorted(adj[u], key=lambda v: ang(u, v)) for u in adj}
used = set(); faces = []
for u in adj:
    for v in adj[u]:
        if (u, v) in used: continue
        face = []; a, b = u, v
        while (a, b) not in used:
            used.add((a, b)); face.append(a)
            nb = order[b]; i = nb.index(a)
            a, b = b, nb[(i - 1) % len(nb)]
        faces.append(face)
def area(f):
    return sum(nodes[f[i]]['x'] * nodes[f[(i+1) % len(f)]]['y'] - nodes[f[(i+1) % len(f)]]['x'] * nodes[f[i]]['y'] for i in range(len(f))) / 2
faces.sort(key=area)
outer = max(faces, key=lambda f: abs(area(f)))
blocks = []
for f in faces:
    if f is outer: continue
    cs = sorted(set(int(x[1:]) for x in f if x.startswith('C')))
    blocks.append(dict(circles=cs, ring=f, area=area(f)))
print('faces', len(faces), 'blocks', len(blocks), 'outer size', len(outer), 'area signs', sorted(set(round(b['area']) > 0 for b in blocks)), file=sys.stderr)
alley = set()
for b in blocks:
    for i in b['circles']:
        for j in b['circles']:
            if i < j: alley.add((i, j))
R = set((e['x'], e['y']) for e in ref['alley'])
print('alley mine', len(alley), 'ref', len(R), file=sys.stderr)
print('alley missing', sorted(R - alley), file=sys.stderr)
print('alley extra', sorted(alley - R), file=sys.stderr)
json.dump(dict(nodes=nodes, edges=edges, blocks=blocks), open('work/stage.json', 'w'))
