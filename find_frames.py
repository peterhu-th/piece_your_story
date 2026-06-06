import numpy as np
from PIL import Image
import cv2

wall = cv2.imread('images/wall.png')
res_list = []
h, w, _ = wall.shape

for i in range(1, 5):
    template = cv2.imread(f'images/{i}.png')
    
    orb = cv2.ORB_create()
    kp1, des1 = orb.detectAndCompute(template, None)
    kp2, des2 = orb.detectAndCompute(wall, None)
    
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(des1, des2)
    matches = sorted(matches, key=lambda x: x.distance)
    
    src_pts = np.float32([kp1[m.queryIdx].pt for m in matches[:20]]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches[:20]]).reshape(-1, 1, 2)
    
    M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    
    if M is not None:
        h_t, w_t, _ = template.shape
        pts = np.float32([[0, 0], [0, h_t-1], [w_t-1, h_t-1], [w_t-1, 0]]).reshape(-1, 1, 2)
        dst = cv2.perspectiveTransform(pts, M)
        
        x_min = np.min(dst[:, 0, 0])
        x_max = np.max(dst[:, 0, 0])
        y_min = np.min(dst[:, 0, 1])
        y_max = np.max(dst[:, 0, 1])
        
        x_pct = x_min / w
        y_pct = y_min / h
        w_pct = (x_max - x_min) / w
        h_pct = (y_max - y_min) / h
        
        res_list.append(f'Level {i}: x: {x_pct:.4f}, y: {y_pct:.4f}, width: {w_pct:.4f}, height: {h_pct:.4f}')
    else:
        res_list.append(f'Level {i}: match failed')

print('\n'.join(res_list))
