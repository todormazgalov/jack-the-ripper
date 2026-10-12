import json, numpy as np
g_det = json.load(open('work/g_det.json')); b_det = json.load(open('work/b_det.json')); ref = json.load(open('wcr.json'))
G = {c['id']: (c['x'], c['y']) for c in g_det['circles']}
# board circle positions: matched detection if close to affine prediction
nl = {int(n['name']): (n['x'], n['y']) for n in ref['node_locations']}
def fit(src, dst):
    A = np.hstack([np.asarray(src, float), np.ones((len(src), 1))]); M, *_ = np.linalg.lstsq(A, np.asarray(dst, float), rcond=None); return M
B0 = {c['id']: (c['x'], c['y']) for c in b_det['circles'] if 'id' in c}
ids = list(range(1, 196))
M = fit([G[i] for i in ids if i in B0], [B0[i] for i in ids if i in B0])
B = {}
for i in ids:
    p = np.array([*G[i], 1]) @ M
    if i in B0 and np.hypot(*(np.array(B0[i]) - p)) < 8: B[i] = B0[i]
Mg = fit([G[i] for i in B], [B[i] for i in B])
RES = {i: np.array(B[i]) - np.array([*G[i], 1]) @ Mg for i in B}
def g2b(x, y, k=6):
    base = np.array([x, y, 1]) @ Mg
    pts = sorted(B, key=lambda i: (G[i][0]-x)**2 + (G[i][1]-y)**2)[:k]
    w = np.array([1/(1e-3+((G[i][0]-x)**2+(G[i][1]-y)**2)) for i in pts])
    corr = sum(w[j]*RES[i] for j,i in enumerate(pts)) / w.sum()
    return tuple(base + corr)
missing_board = [i for i in ids if i not in B]
