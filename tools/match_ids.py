import json, sys, numpy as np
det = json.load(open(sys.argv[1])); ref = json.load(open(sys.argv[2]))
anchors = json.loads(sys.argv[3])  # {"1":[x,y],...} approximate positions in this image
nl = {int(n['name']):(n['x'],n['y']) for n in ref['node_locations']}
C = np.array([[c['x'],c['y']] for c in det['circles']])
def fit(src, dst):
    A = np.hstack([src, np.ones((len(src),1))])
    M, *_ = np.linalg.lstsq(A, dst, rcond=None); return M
ids = sorted(int(k) for k in anchors)
M = fit(np.array([nl[i] for i in ids],float), np.array([anchors[str(i)] for i in ids],float))
for it in range(4):
    P = np.hstack([np.array([nl[i] for i in range(1,196)],float), np.ones((195,1))]) @ M
    D = np.linalg.norm(P[:,None,:]-C[None,:,:], axis=2)
    assign = D.argmin(axis=1)
    dist = D[np.arange(195), assign]
    M = fit(np.array([nl[i] for i in range(1,196)],float)[dist<15], C[assign][dist<15])
dup = len(assign) - len(set(assign.tolist()))
print('dups', dup, 'maxdist', dist.max().round(1), 'worst', sorted(zip(dist.round(1), range(1,196)))[-8:], file=sys.stderr)
for k,i in enumerate(assign): det['circles'][i]['id'] = k+1
json.dump(det, open(sys.argv[1],'w'))
