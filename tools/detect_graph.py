import cv2, numpy as np, json, sys
img = cv2.imread(sys.argv[1])
H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
h, s, v = cv2.split(hsv)
# circles: saturated fill
sat = ((s > 90) & (v > 120)).astype(np.uint8)
sat = cv2.morphologyEx(sat, cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
n, lab, stats, cent = cv2.connectedComponentsWithStats(sat)
circles = []
for i in range(1, n):
    x,y,w,hh,a = stats[i]
    if a > 300 and 0.6 < w/hh < 1.6 and w < 60:
        circles.append(dict(x=float(cent[i][0]), y=float(cent[i][1]), w=int(w), h=int(hh), a=int(a)))
# squares: very dark
dark = (v < 50).astype(np.uint8)
n2, lab2, st2, c2 = cv2.connectedComponentsWithStats(dark)
squares = []
for i in range(1, n2):
    x,y,w,hh,a = st2[i]
    if a >= 12 and 0.5 < w/hh < 2 and w <= 20 and a/(w*hh) > 0.6:
        squares.append(dict(x=float(c2[i][0]), y=float(c2[i][1]), w=int(w), h=int(hh), a=int(a)))
print(len(circles), 'circles', len(squares), 'squares', file=sys.stderr)
print('circle sizes', sorted(set((c['w']) for c in circles)), file=sys.stderr)
print('square sizes', sorted([(q['w'],q['h']) for q in squares])[-15:], sorted([(q['w'],q['h']) for q in squares])[:10], file=sys.stderr)
json.dump(dict(circles=circles, squares=squares), open(sys.argv[2],'w'))
