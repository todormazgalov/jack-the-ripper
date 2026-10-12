import cv2, numpy as np, json, sys
from collections import defaultdict
img = cv2.imread(sys.argv[1]); det = json.load(open(sys.argv[2])); ref = json.load(open(sys.argv[3]))
H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); v = hsv[:,:,2]
circ = det['circles']
d = (v < 90).astype(np.uint8); o = cv2.morphologyEx(d, cv2.MORPH_OPEN, np.ones((4,4),np.uint8))
n, lab, st, c = cv2.connectedComponentsWithStats(o)
sq = []
for i in range(1, n):
    x,y,w,h,a = st[i]
    if any((cc['x']-c[i][0])**2+(cc['y']-c[i][1])**2 < 16**2 for cc in circ): continue
    if c[i][0] > 880 and c[i][1] > 680: continue
    sq.append(dict(x=float(c[i][0]), y=float(c[i][1]), w=int(w), h=int(h), yellow=bool(w >= 9)))
sq.sort(key=lambda q: (round(q['y']/8), q['x']))
nodes = [dict(id='C%d'%c_['id'], x=c_['x'], y=c_['y'], r=14) for c_ in circ]
for i,q in enumerate(sq):
    nodes.append(dict(id='X%d'%(i+1), x=q['x'], y=q['y'], r=12 if q['yellow'] else 5, yellow=q['yellow']))
line = ((v < 150) & (hsv[:,:,1] < 80)).astype(np.uint8)
nodemask = np.zeros((H,W), np.uint8); idmap = -np.ones((H,W), np.int32); ring = np.zeros((H,W), np.uint8)
for k,nd in enumerate(nodes):
    p = (round(nd['x']), round(nd['y']))
    cv2.circle(nodemask, p, nd['r'], 1, -1); cv2.circle(idmap, p, nd['r']+2, k, -1); cv2.circle(ring, p, nd['r']+2, 1, -1)
seg = line & (1-nodemask); ring &= (1-nodemask)
nc, lab = cv2.connectedComponents(seg, connectivity=8)
edges = set(); junctions = []; dangling = []
for comp in range(1, nc):
    m = lab == comp
    if m.sum() < 6: continue
    ys, xs = np.where(m & (ring == 1))
    t = sorted(set(idmap[ys, xs].tolist()) - {-1})
    if len(t) == 2: edges.add((nodes[t[0]]['id'], nodes[t[1]]['id']))
    elif len(t) > 2:
        yy, xx = np.where(m); j = 'J%d' % (len(junctions)+1)
        junctions.append(dict(id=j, x=float(xx.mean()), y=float(yy.mean()), members=[nodes[k]['id'] for k in t]))
        for k in t: edges.add((nodes[k]['id'], j))
    elif len(t) == 1:
        yy, xx = np.where(m); dangling.append((nodes[t[0]]['id'], int(xx.mean()), int(yy.mean()), int(m.sum())))
# close pairs: masks nearly touching -> sample the straight segment directly
import math
close = []
for i in range(len(nodes)):
    for j in range(i+1, len(nodes)):
        a, b = nodes[i], nodes[j]
        dist = math.hypot(a['x']-b['x'], a['y']-b['y'])
        gap = dist - a['r'] - b['r']
        if gap > 10: continue
        if (a['id'],b['id']) in edges or (b['id'],a['id']) in edges: continue
        ux, uy = (b['x']-a['x'])/dist, (b['y']-a['y'])/dist
        ts = [a['r']-1 + k*(dist-a['r']-b['r']+2)/8 for k in range(9)]
        hits = 0
        for t in ts:
            x, y = a['x']+ux*t, a['y']+uy*t
            xi, yi = int(round(x)), int(round(y))
            if line[yi-1:yi+2, xi-1:xi+2].any(): hits += 1
        if hits >= 9 or (gap <= 1.0 and a["id"][0] != b["id"][0]):
            edges.add((a['id'], b['id'])); close.append((a['id'], b['id'], round(gap,1)))
print('close-pair edges', close, file=sys.stderr)
print('crossings', len(sq), 'yellow', sum(q['yellow'] for q in sq), 'edges', len(edges), 'junctions', len(junctions), 'dangling', len(dangling), file=sys.stderr)
for dd in dangling: print('DANGLING', dd, file=sys.stderr)
for j in junctions: print('JUNC', j['id'], j['members'], file=sys.stderr)
json.dump(dict(nodes=[{k:v_ for k,v_ in nd.items() if k!='r'} for nd in nodes], junctions=junctions, edges=sorted(edges)), open(sys.argv[4],'w'))
