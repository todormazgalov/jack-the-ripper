import json, sys
from collections import defaultdict
g = json.load(open(sys.argv[1])); ref = json.load(open(sys.argv[2]))
adj = defaultdict(set)
for a,b in g['edges']: adj[a].add(b); adj[b].add(a)
def jack_nb(c):
    seen = {c}; st = [c]; out = set()
    while st:
        u = st.pop()
        for w in adj[u]:
            if w in seen: continue
            seen.add(w)
            if w.startswith('C'): out.add(int(w[1:]))
            else: st.append(w)
    return out
mine = set()
for i in range(1,196):
    for j in jack_nb('C%d'%i): mine.add((min(i,j),max(i,j)))
R = set((e['x'],e['y']) for e in ref['roads'])
print('mine', len(mine), 'ref', len(R))
print('missing (in ref, not mine):', sorted(R-mine))
print('extra (mine, not ref):', sorted(mine-R))
nodes = {n['id']:n for n in g['nodes']}
print('yellow:', [(n['id'], round(n['x']), round(n['y'])) for n in g['nodes'] if n.get('yellow')])
print('isolated nodes:', [n for n in nodes if not adj[n]])
