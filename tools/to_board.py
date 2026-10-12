import json, sys, math
sys.path.insert(0, 'tools')
from mapping import *
import cv2
st = json.load(open('work/stage.json'))
bsq = [(q['x'], q['y']) for q in b_det['squares']]
pos = {}; snapped = 0; unsnapped = []
for nid, n in st['nodes'].items():
    if nid.startswith('C'):
        i = int(nid[1:]); pos[nid] = B.get(i) or g2b(n['x'], n['y'])
    else:
        p = g2b(n['x'], n['y'])
        if nid.startswith('X'):
            best = min(bsq, key=lambda q: (q[0]-p[0])**2 + (q[1]-p[1])**2)
            d = math.hypot(best[0]-p[0], best[1]-p[1])
            if d < 6: p = best; snapped += 1
            else: unsnapped.append((nid, round(d, 1)))
        pos[nid] = p
print('snapped', snapped, 'unsnapped', len(unsnapped), unsnapped[:40], file=sys.stderr)
json.dump({k: [float(v[0]), float(v[1])] for k, v in pos.items()}, open('work/board_pos.json', 'w'))
img = cv2.imread('work/board.webp')
for a, b in st['edges']:
    cv2.line(img, tuple(map(round, pos[a])), tuple(map(round, pos[b])), (255, 0, 255), 1, cv2.LINE_AA)
for nid, p in pos.items():
    q = tuple(map(round, p))
    if nid.startswith('C'): cv2.circle(img, q, 10, (0, 255, 0), 1, cv2.LINE_AA)
    elif nid.startswith('X'):
        col = (0, 255, 255) if st['nodes'][nid].get('yellow') else (255, 255, 0)
        cv2.rectangle(img, (q[0]-4, q[1]-4), (q[0]+4, q[1]+4), col, 1)
    else: cv2.circle(img, q, 3, (0, 0, 255), -1)
big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
H, W = big.shape[:2]
k = 0
for y0 in range(0, H, H//3):
    for x0 in range(0, W, W//3):
        cv2.imwrite(f'work/ov_{k}.png', big[y0:y0+H//3+40, x0:x0+W//3+40]); k += 1
