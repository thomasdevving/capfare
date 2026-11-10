"""Sheet of chosen footage moments: python3 video/render/frames.py out.jpg take:c take:c ..."""
import json, os, sys
from PIL import Image, ImageDraw
sys.argv.insert(1, "_") if False else None
ROOT = os.path.join(os.path.dirname(__file__), "..", "footage")
out = sys.argv[1]
picks = [a.rsplit(":", 1) for a in sys.argv[2:]]
def load(take):
    d = os.path.join(ROOT, take)
    idx = json.load(open(os.path.join(d, "index.json")))
    ev = json.load(open(os.path.join(d, "events.json")))
    idles, op = [], {}
    for e in ev:
        if e["type"] == "mark" and e["label"].endswith(":begin"): op[e["label"][:-6]] = e["t"]
        elif e["type"] == "mark" and e["label"].endswith(":end") and e["label"][:-4] in op: idles.append((op.pop(e["label"][:-4]), e["t"]))
    return d, idx, sorted(idles)
W, H, cols = 640, 400, 4
rows = (len(picks) + cols - 1) // cols
sheet = Image.new("RGB", (W * cols, (H + 22) * rows), "white")
dr = ImageDraw.Draw(sheet)
for i, (take, c) in enumerate(picks):
    d, idx, idles = load(take)
    c = float(c); off = 0
    for b, e in idles:
        if c + off >= b: off += e - b
        else: break
    r = c + off
    n = idx[0][1]
    for t, k in idx:
        if t <= r: n = k
        else: break
    im = Image.open(os.path.join(d, f"{n:05d}.jpg")).convert("RGB").resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 22)
    sheet.paste(im, (x, y + 22))
    dr.text((x + 4, y + 5), f"{take} c={c}", fill=(0, 0, 0))
sheet.save(out, quality=82)
