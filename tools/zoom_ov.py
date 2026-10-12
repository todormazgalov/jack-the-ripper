import json, cv2, sys
st = json.load(open('work/stage.json')); pos = json.load(open('work/board_pos.json'))
x0, y0, x1, y1 = map(int, sys.argv[1:5]); f = 5
img = cv2.imread('work/board.webp')[y0:y1, x0:x1]
img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
P = lambda k: (round((pos[k][0]-x0)*f), round((pos[k][1]-y0)*f))
for a, b in st['edges']:
    cv2.line(img, P(a), P(b), (255, 0, 255), 1, cv2.LINE_AA)
for k in pos:
    x, y = P(k)
    if -20 < x < img.shape[1]+20 and -20 < y < img.shape[0]+20:
        cv2.putText(img, k, (x+6, y-6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255) if k[0] != 'C' else (0, 255, 0), 1, cv2.LINE_AA)
        cv2.circle(img, (x, y), 3, (0, 0, 255), -1)
cv2.imwrite(sys.argv[5], img)
