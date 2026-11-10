"""Drops footage frames that are not 1920x1200 from each take's index.json.

The recorder's overlay finder takes a clipped page screenshot, which briefly makes the
screencast emit a frame of the clip. The original index is kept as index.raw.json.

    python3 video/render/clean_footage.py
"""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "footage")
for take in sorted(os.listdir(ROOT)):
    d = os.path.join(ROOT, take)
    if not os.path.isfile(os.path.join(d, "done")):
        continue
    raw = os.path.join(d, "index.raw.json")
    if not os.path.exists(raw):
        os.replace(os.path.join(d, "index.json"), raw)
    idx = json.load(open(raw))
    keep = [[t, n] for t, n in idx if Image.open(os.path.join(d, f"{n:05d}.jpg")).size == (1920, 1200)]
    json.dump(keep, open(os.path.join(d, "index.json"), "w"))
    if len(keep) != len(idx):
        print(f"{take}: dropped {len(idx) - len(keep)} odd frames")
