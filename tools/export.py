import json, sys
st = json.load(open('work/stage.json')); pos = json.load(open('work/board_pos.json'))
RED = {3, 21, 27, 65, 84, 147, 149, 158}
GOULSTON = 'X99'
xs = sorted([k for k in st['nodes'] if k[0] == 'X'], key=lambda k: (round(pos[k][1] / 12), pos[k][0]))
js = sorted([k for k in st['nodes'] if k[0] == 'J'], key=lambda k: (pos[k][1], pos[k][0]))
ren = {k: 'C%d' % int(k[1:]) for k in st['nodes'] if k[0] == 'C'}
ren.update({k: 'X%d' % (i + 1) for i, k in enumerate(xs)})
ren.update({k: 'J%d' % (i + 1) for i, k in enumerate(js)})
r = lambda v: round(v, 1)
out = dict(
  board=dict(image='board.webp', width=1200, height=803),
  circles=[dict(id=i, x=r(pos['C%d' % i][0]), y=r(pos['C%d' % i][1]), red=i in RED) for i in range(1, 196)],
  crossings=[dict(id=i + 1, x=r(pos[k][0]), y=r(pos[k][1]), yellow=bool(st['nodes'][k].get('yellow')) and k != GOULSTON, goulston=k == GOULSTON) for i, k in enumerate(xs)],
  junctions=[dict(id=i + 1, x=r(pos[k][0]), y=r(pos[k][1])) for i, k in enumerate(js)],
  edges=sorted([sorted([ren[a], ren[b]]) for a, b in st['edges']]),
  blocks=sorted([b['circles'] for b in st['blocks'] if len(b['circles']) >= 2]),
)
print(len(out['circles']), len(out['crossings']), sum(c['yellow'] for c in out['crossings']), len(out['junctions']), len(out['edges']), len(out['blocks']), file=sys.stderr)
txt = json.dumps(out, separators=(',', ':'))
# one record per line for readable diffs
for key in ('circles', 'crossings', 'junctions', 'edges', 'blocks'):
    pass
s = '{\n'
s += '"board":' + json.dumps(out['board']) + ',\n'
for key in ('circles', 'crossings', 'junctions', 'edges', 'blocks'):
    s += '"%s":[\n' % key + ',\n'.join(json.dumps(x, separators=(',', ':')) for x in out[key]) + '\n]' + (',\n' if key != 'blocks' else '\n')
s += '}\n'
open(sys.argv[1], 'w').write(s)
ref = json.load(open('wcr.json'))
json.dump(dict(source='whitechapelR 0.3.0 (CRAN, MIT License, (c) 2018 Mark Ewing)', roads=[[e['x'], e['y']] for e in ref['roads']], alley=[[e['x'], e['y']] for e in ref['alley']]), open(sys.argv[2], 'w'))
