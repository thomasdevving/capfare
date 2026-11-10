"""Builds the X cut around Thomas's webcam recordings.

    python3 video/voice/plan.py

Inputs: the two webcam recordings in video/ (part 1 up to "Why NEAR", part 2 from there) and
words.json (every word with its time in the recording, from align2.py/final.py: pocketsphinx
recognition checked against the script, then aligned word by word).

Writes:
  video/film/xvoice.js        scene lengths, the voice clip of each scene, caption lines with
                              word timing, and where the webcam shows (read by film.js, ?cut=x)
  video/out/cam/<part>/*.jpg  webcam frames (30 fps) the film shows inside the camera frame
  video/audio/x/voice.wav     the voice track for the X cut (48 kHz), cleaned and levelled
"""
import json, os, re, subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
V = os.path.join(HERE, "..")
SRC = {"p1": os.path.join(V, "Film op 11-11-2026 om 00.13 #3.mov"), "p2": os.path.join(V, "Film op 11-11-2026 om 00.16 #2.mov")}
W = json.load(open(os.path.join(HERE, "words.json")))
SR = 48_000
LEAD = 0.5   # voice starts this long after a scene starts (the transition is mostly done)

# What was said, as it should read in the captions. Display words map onto aligned tokens
# (e.g. "170" was said "one seventy", "NEP-141" as "N E P one four one").
SAY = {
    "170": "one seventy", "260": "two hundred sixty", "NEP-141": "n e p one four one", "ed25519": "e d two five five one nine",
    "on-chain": "onchain", "meta-transactions": "meta transactions", "cross-contract": "cross contract", "collateralised": "collateralized",
}
TEXT = [
    "Hi, my name's Thomas, and I built CapFare. So let's say you find a flight for 170 euros.",
    "A day later, the same seat costs 260 euros. Or you book, the next morning it's cheaper.",
    "CapFare locks the price of your flight, wherever you book. And it runs on NEAR.",
    "The extension recognises the flight on any booking site | and offers to lock a maximum price.",
    "A passkey creates a readable NEAR account. No seed phrase, no gas, and prepaid credit.",
    "The premium comes from a public formula on-chain. The maximum payout is locked in the vault first.",
    "Choose the deductible and a lock of three to thirty days.",
    "When the {low} price passes your cap, | you get an alert in the app, by push or by email.",
    "Claim with the original email. The payout waits for a live check of the booking | after a day, then it's paid from the vault.",
    "Only the flight, fare and price reach the chain. Edited emails, reused bookings and other people's bookings are refused.",
    "Just booked? The Drop Guarantee pays if the same flight gets cheaper.",
    "Route cover pays against the cheapest fare, up to three days either side and from nearby airports.",
    "Up to nine travellers on one policy, and a return trip bought as one.",
    "Liquidity providers fund two vaults. Every policy is fully collateralised.",
    "So why NEAR?",
    "Gasless meta-transactions through our relayer, | and readable named accounts. NEP-141 tokens,",
    "async cross-contract calls that roll back on failure, and ed25519 checks on-chain.",
    "All on the public explorer. It's a testnet prototype: live contracts, demo prices, but services not in an enclave yet.",
    "So this is CapFare, built for the NEAR Hackathon.",
]
# "low" was recognised where the script says "demo"; it is left out of the captions ({...}).


def tokens(word):
    w = re.sub(r"[.,?!:]+$", "", word)
    if w in SAY:
        return SAY[w].split()
    return re.sub(r"[^a-z' ]", " ", w.lower().replace("-", " ")).split()


def display_words(i):
    """[(display, start, end)] for line i, mapping display words onto aligned tokens."""
    toks = W[i]["words"]
    out, k = [], 0
    for raw in TEXT[i].split():
        if raw == "|":  # forced caption break
            out.append(("|", None, None))
            continue
        hidden = raw.startswith("{")
        word = raw.strip("{}")
        n = len(tokens(word))
        seg = toks[k:k + n]
        assert [re.sub(r"\(\d\)$", "", t[0]) for t in seg] == tokens(word), (i, word, seg)
        if not hidden:
            out.append((word, seg[0][1], seg[-1][2]))
        k += n
    assert k == len(toks), (i, k, len(toks))
    return out


# Scenes of the X cut: (id, length, [(line, first word, last word)], webcam).
# Webcam: (kind, [x, y, w, h], round, from, to) in scene seconds; "speech" = while the voice plays.
TOP_RIGHT = [1660, 30, 210, 210]
PLAN = [
    ("intro", 12.9, [(0, 0, None), (1, 0, None)], ("large", [96, 120, 860, 760], False, 0, "end")),
    ("logo", 5.6, [(2, 0, None)], None),
    ("find", 8.6, [(3, 0, None)], ("pip", TOP_RIGHT, True, "speech", 3.2)),
    ("account", 7.6, [(4, 0, None)], None),
    ("lock", 8.6, [(5, 0, None)], None),
    ("choices", 6.4, [(6, 0, None)], None),
    ("alerts", 7.8, [(7, 0, None)], None),
    ("claim", 12.6, [(8, 0, None)], ("pip", TOP_RIGHT, True, "speech", "speech")),
    ("verify", 10.2, [(9, 0, None)], None),
    ("drop", 7.2, [(10, 0, None)], None),
    ("flex", 7.9, [(11, 0, None)], None),
    ("travellers", 6.4, [(12, 0, None)], None),
    ("lp", 7.0, [(13, 0, None)], None),
    ("near", 19.6, [(14, 0, None), (15, 0, None), (16, 0, None), (17, 0, 4)], ("pip", TOP_RIGHT, True, "speech", 9.6)),
    ("status", 5.6, [(17, 5, 12)], ("large", [1240, 300, 560, 560], False, 0, "end")),
    ("end", 5.0, [(18, 0, None)], ("pip", [1560, 760, 260, 260], True, 0, "end")),
]


def chunks(words):
    """Caption lines: break after a sentence (5+ words) or comma (8+), never above 12 words or 74 chars."""
    lines, cur = [], []
    for w in words:
        if w[0] == "|":
            if cur:
                lines.append(cur)
            cur = []
            continue
        cur.append(w)
        text = " ".join(x[0] for x in cur)
        end = re.search(r"[.?!]$", w[0]) and len(cur) >= 4
        comma = re.search(r"[,:]$", w[0]) and len(cur) >= 7
        if end or comma or len(cur) >= 12 or len(text) > 66:
            lines.append(cur)
            cur = []
    if cur:
        if lines and len(cur) <= 2 and len(lines[-1]) + len(cur) <= 13:
            lines[-1] += cur
        else:
            lines.append(cur)
    out = [{"text": " ".join(x[0] for x in l), "start": l[0][1], "end": l[-1][2]} for l in lines]
    if out and out[-1]["text"][-1] in ",:":  # a clip that stops mid-sentence ends the caption cleanly
        out[-1]["text"] = out[-1]["text"][:-1] + "."
    return out


beats, t = [], 0.0
for sid, dur, parts, cam in PLAN:
    src = W[parts[0][0]]["src"]
    words = []
    for line, a, b in parts:
        assert W[line]["src"] == src
        dw = display_words(line)
        words += dw[a:(b + 1 if b is not None else None)]
    spoken = [w for w in words if w[0] != "|"]
    clip_in = max(0.0, spoken[0][1] - 0.18)
    clip_out = spoken[-1][2] + 0.2
    at = LEAD
    rel = lambda x: round(x - clip_in + at, 3)
    caps = [{"text": c["text"], "start": rel(c["start"]), "end": rel(c["end"])} for c in chunks(words)]
    end_voice = rel(clip_out)
    assert end_voice <= dur - 0.4, (sid, end_voice, dur)
    b = {"id": sid, "start": round(t, 3), "dur": dur, "voice": {"src": src, "in": round(clip_in, 3), "out": round(clip_out, 3), "at": at},
         "captions": caps, "words": [{"w": w, "t": rel(s)} for w, s, e in spoken]}
    if cam:
        kind, rect, rnd, a, z = cam
        a = at if a == "speech" else a
        z = dur if z == "end" else (end_voice if z == "speech" else z)
        b["cam"] = {"kind": kind, "at": rect, "round": rnd, "from": a, "to": z}
    beats.append(b)
    t += dur
print(f"X cut with voice: {t:.1f} s, {len(beats)} scenes")
js = "// Generated by video/voice/plan.py from the webcam recordings and their word alignment.\nwindow.XVOICE = " + json.dumps({"duration": round(t, 3), "beats": beats}, indent=1) + ";\n"
open(os.path.join(V, "film", "xvoice.js"), "w").write(js)

# ---- webcam frames for the film (30 fps, 960 px wide) ----
for p, f in SRC.items():
    d = os.path.join(V, "out", "cam", p)
    if not os.path.exists(os.path.join(d, "done")):
        os.makedirs(d, exist_ok=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", f, "-vf", "fps=30,scale=960:-2", "-q:v", "3", os.path.join(d, "%05d.jpg")], check=True)
        open(os.path.join(d, "done"), "w").write("ok")

# ---- voice track ----
def load(p):
    tmp = os.path.join(V, "out", "cam", f"{p}.wav")
    if not os.path.exists(tmp):
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", SRC[p], "-vn", "-ac", "1", "-ar", str(SR), tmp], check=True)
    sr, x = wavfile.read(tmp)
    return x.astype(np.float64) / 32768.0
AUD = {p: load(p) for p in SRC}
voice = np.zeros(int((t + 1) * SR))
for b in beats:
    v = b["voice"]
    x = AUD[v["src"]][int(v["in"] * SR):int(v["out"] * SR)].copy()
    f = int(0.03 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    i = int((b["start"] + v["at"]) * SR)
    voice[i:i + len(x)] += x
# Clean-up: high-pass (rumble), gentle presence lift, slow levelling, then peak normalise.
voice = signal.sosfilt(signal.butter(2, 85, "highpass", fs=SR, output="sos"), voice)
env = np.sqrt(signal.sosfilt(signal.butter(1, 2.0, "lowpass", fs=SR, output="sos"), voice ** 2) + 1e-9)
target = 10 ** (-20 / 20)
gain = np.clip(target / env, 0.5, 3.0)
gain = signal.sosfilt(signal.butter(1, 1.0, "lowpass", fs=SR, output="sos"), gain)
voice = voice * np.where(env > 10 ** (-45 / 20), gain, 1.0)
voice *= 10 ** (-3 / 20) / (np.max(np.abs(voice)) + 1e-9)
os.makedirs(os.path.join(V, "audio", "x"), exist_ok=True)
wavfile.write(os.path.join(V, "audio", "x", "voice.wav"), SR, (voice * 32767).astype(np.int16))
print("wrote film/xvoice.js, out/cam/*, audio/x/voice.wav")
