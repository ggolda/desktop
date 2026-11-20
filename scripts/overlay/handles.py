"""Finds the OBS-drawn selection handles (solid white ~8 px squares) in a window screenshot.
Usage: handles.py <png>   -> JSON list of {x, y} centers in image px (nw, n, ne, e, se, s, sw, w order not guaranteed)."""
import json
import sys

import numpy as np
from PIL import Image

im = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
white = (im[:, :, 0] >= 250) & (im[:, :, 1] >= 250) & (im[:, :, 2] >= 250)
h, w = white.shape
seen = np.zeros_like(white)
out = []
for y in range(h):
    for x in range(w):
        if not white[y, x] or seen[y, x]:
            continue
        # flood fill (iterative)
        stack = [(y, x)]
        seen[y, x] = True
        pts = []
        while stack:
            cy, cx = stack.pop()
            pts.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        ys = [p[0] for p in pts]
        xs = [p[1] for p in pts]
        bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if 6 <= bw <= 11 and 6 <= bh <= 11 and len(pts) >= 0.9 * bw * bh:
            out.append({'x': (min(xs) + max(xs)) / 2, 'y': (min(ys) + max(ys)) / 2})
print(json.dumps(out))
