"""Contact sheet of rendered stills: python3 video/render/sheet.py <dir> <out.jpg> [cols]"""
import sys, glob, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
fs = sorted(glob.glob(os.path.join(d, "*.jpg")))
W, H = 640, 360
rows = (len(fs) + cols - 1) // cols
sheet = Image.new("RGB", (W * cols, (H + 28) * rows), "white")
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS)
    x, y = (i % cols) * W, (i // cols) * (H + 28)
    sheet.paste(im, (x, y + 28))
    dr.text((x + 8, y + 6), os.path.basename(f), fill=(0, 0, 0))
sheet.save(out, quality=88)
