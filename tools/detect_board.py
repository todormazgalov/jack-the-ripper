import cv2, numpy as np, json, sys
img = cv2.imread(sys.argv[1]); gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
cs = cv2.HoughCircles(cv2.GaussianBlur(gray,(3,3),0), cv2.HOUGH_GRADIENT, dp=1, minDist=14,
                      param1=120, param2=18, minRadius=7, maxRadius=13)
cs = cs[0] if cs is not None else []
circles = [dict(x=float(x), y=float(y), r=float(r)) for x,y,r in cs]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
o = cv2.morphologyEx((hsv[:,:,2] < 75).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
n, lab, st, c = cv2.connectedComponentsWithStats(o)
squares = [dict(x=float(c[i][0]), y=float(c[i][1]), w=int(st[i][2]), h=int(st[i][3])) for i in range(1, n)
           if st[i][2] <= 14 and st[i][3] <= 14 and st[i][4] >= 9]
print(len(circles),'circles',len(squares),'squares', file=sys.stderr)
json.dump(dict(circles=circles, squares=squares), open(sys.argv[2],'w'))
