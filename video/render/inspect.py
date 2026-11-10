"""Inspect a recorded take on its compressed timeline (waits cut out), to plan shots.

    python3 video/render/inspect.py <take> [step_seconds] [out.jpg]

Prints events with compressed times and writes a contact sheet of frames every step seconds.
"""
import json, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..", "footage")
take = sys.argv[1]
step = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
out = sys.argv[3] if len(sys.argv) > 3 else f"/tmp/{take}.jpg"
d = os.path.join(ROOT, take)
index = json.load(open(os.path.join(d, "index.json")))
events = json.load(open(os.path.join(d, "events.json")))
idles, open_ = [], {}
for e in events:
    if e["type"] != "mark":
        continue
    lab = e["label"]
    if lab.endswith(":begin"):
        open_[lab[:-6]] = e["t"]
    elif lab.endswith(":end") and lab[:-4] in open_:
        idles.append((open_.pop(lab[:-4]), e["t"]))
idles.sort()

def comp(r):
    off = 0
    for b, e in idles:
        if r >= e: off += e - b
        elif r > b: return b - off
        else: break
    return r - off

def real(c):
    off = 0
    for b, e in idles:
        if c + off >= b: off += e - b
        else: break
    return c + off

def frame(r):
    n = index[0][1]
    for t, k in index:
        if t <= r: n = k
        else: break
    return n

end = next((e["t"] for e in events if e["label"] == "end"), index[-1][0])
cend = comp(end)
print(f"{take}: real {end:.1f}s, compressed {cend:.1f}s, waits {[(round(b,1), round(e,1)) for b, e in idles]}")
for e in events:
    print(f"  c={comp(e['t']):6.2f}  {e['type']:5}  {e['label']}" + (f"  ({e['x']*1440:.0f},{e['y']*900:.0f})" if 'x' in e else ""))
ts = [i * step for i in range(int(cend / step) + 1)]
W, H, cols = 400, 250, 7
rows = (len(ts) + cols - 1) // cols
sheet = Image.new("RGB", (W * cols, (H + 20) * rows), "white")
dr = ImageDraw.Draw(sheet)
for i, c in enumerate(ts):
    im = Image.open(os.path.join(d, f"{frame(real(c)):05d}.jpg")).convert("RGB").resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 20)
    sheet.paste(im, (x, y + 20))
    dr.text((x + 4, y + 4), f"c={c:.1f}", fill=(0, 0, 0))
sheet.save(out, quality=80)
print("sheet", out)
