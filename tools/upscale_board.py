"""Makes client/public/board-hd.webp: the board photo upscaled 2x (Lanczos + light sharpening).

The game draws streets, circles and crossings as vectors on top, so the photo is only the backdrop;
the smoother upscale just keeps it from looking blocky when zoomed in. Needs Pillow.

    python tools/upscale_board.py client/public/board.webp client/public/board-hd.webp
"""
import sys

from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
up = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
up = up.filter(ImageFilter.UnsharpMask(radius=1.6, percent=60, threshold=2))
up.save(dst, quality=88, method=6)
print(f'{dst}: {up.width}x{up.height}')
