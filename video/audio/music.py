"""Score, sound effects and mix for the CapFare film, synthesised with numpy/scipy (no samples).

    python3 video/audio/music.py full     # reads video/out/full/meta.json
    python3 video/audio/music.py x

Writes video/audio/<cut>/: music.wav (unducked), sfx.wav, vo-timing.wav (guide only: a soft tone
while each caption line is on screen, for timing a real voice-over), and mix.wav (music ducked
under the voice-over spans plus effects). 48 kHz stereo, 24-bit.

Music: 112 bpm, D major, I-V-vi-IV. Soft kick, clap on 2 and 4, band-passed shaker (3-7.5 kHz),
sine bass, Karplus-Strong plucks, a soft pad and an FM bell hook. Arrangement follows the beats
in meta.json: sparse under the opening webcam, full groove through the features and the NEAR
chapter, drums out for the honest-status part, and a bell resolve on the end card.
Effects come from the film's cues (wipes, iris, clicks in the footage, check badges, cards).
Music is low-passed at 12 kHz, effects at 7 kHz, both get a -3.5 dB high shelf above 4.5 kHz,
and the music ducks about 9 dB under voice-over spans.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48_000
BPM = 112
SPB = 60 / BPM
BAR = 4 * SPB
RNG = np.random.default_rng(7)

ROOT = os.path.join(os.path.dirname(__file__), "..")
CUT = sys.argv[1] if len(sys.argv) > 1 else "full"
META = json.load(open(os.path.join(ROOT, "out", CUT, "meta.json")))
DUR = META["duration"] + 0.5
N = int(DUR * SR)
OUT = os.path.join(os.path.dirname(__file__), CUT)
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- helpers

def midi(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def t_axis(n: int) -> np.ndarray:
    return np.arange(n) / SR


def env_ad(n: int, a: float, d: float, curve: float = 4.0) -> np.ndarray:
    t = t_axis(n)
    att = np.clip(t / max(a, 1e-4), 0, 1)
    dec = np.exp(-curve * np.clip(t - a, 0, None) / max(d, 1e-4))
    return att * dec


def add(buf: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0) -> None:
    i = int(at * SR)
    if i >= buf.shape[0] or i + len(x) <= 0:
        return
    j0 = max(0, -i)
    x = x[j0:]
    i = max(0, i)
    n = min(len(x), buf.shape[0] - i)
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += x[:n] * gain * l * np.sqrt(2)
    buf[i:i + n, 1] += x[:n] * gain * r * np.sqrt(2)


def sos_filter(x: np.ndarray, kind: str, f, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def high_shelf(x: np.ndarray, f0: float, gain_db: float) -> np.ndarray:
    """RBJ high shelf."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / 2 * np.sqrt(2)
    cw = np.cos(w0)
    b0 = A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha)
    b1 = -2 * A * ((A - 1) + (A + 1) * cw)
    b2 = A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)
    a0 = (A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha
    a1 = 2 * ((A - 1) - (A + 1) * cw)
    a2 = (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha
    return signal.lfilter([b0 / a0, b1 / a0, b2 / a0], [1, a1 / a0, a2 / a0], x, axis=0)


# ---------------------------------------------------------------- instruments

def kick() -> np.ndarray:
    n = int(0.42 * SR)
    t = t_axis(n)
    f = 46 + 70 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * env_ad(n, 0.003, 0.32, 5)
    click = sos_filter(RNG.standard_normal(n) * env_ad(n, 0.0005, 0.008, 6), "lowpass", 2500)
    return x * 0.9 + click * 0.08


def clap() -> np.ndarray:
    n = int(0.3 * SR)
    t = t_axis(n)
    noise = RNG.standard_normal(n)
    e = np.zeros(n)
    for k, d in enumerate([0.0, 0.011, 0.022]):
        e += np.exp(-np.clip(t - d, 0, None) * (220 if k < 2 else 26)) * (t >= d)
    x = sos_filter(noise * e, "bandpass", [900, 2600]) * 0.6
    return x


def shaker(accent: float) -> np.ndarray:
    n = int(0.09 * SR)
    x = RNG.standard_normal(n) * env_ad(n, 0.012, 0.06, 4)
    return sos_filter(x, "bandpass", [3000, 7500], 2) * accent


def bass_note(f: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    e = env_ad(n, 0.008, dur * 0.9, 2.2)
    return sos_filter(x * e, "lowpass", 900)


_ks_cache: dict = {}


def pluck(f: float, dur: float = 1.4) -> np.ndarray:
    key = (round(f, 2), dur)
    if key in _ks_cache:
        return _ks_cache[key]
    n = int(dur * SR)
    P = int(round(SR / f))
    y = np.zeros(n + P + 1)
    y[:P] = sos_filter(RNG.uniform(-1, 1, P), "lowpass", min(6000, f * 9))
    decay = 0.996
    k = P
    while k < n:
        m = min(P, n - k)
        y[k:k + m] = decay * 0.5 * (y[k - P:k - P + m] + y[k - P + 1:k - P + 1 + m])
        k += m
    x = y[:n] * env_ad(n, 0.002, dur, 3.0)
    x = sos_filter(x, "lowpass", 4200)
    _ks_cache[key] = x
    return x


def pad(freqs: list[float], dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    x = np.zeros(n)
    for f in freqs:
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            ph = RNG.uniform(0, 1)
            x += 2 * ((ff * t + ph) % 1) - 1  # saw
    x = sos_filter(x / (3 * len(freqs)), "lowpass", 1500, 2)
    e = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.8)
    return x * np.clip(e, 0, 1)


def bell(f: float, dur: float = 2.2, bright: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    t = t_axis(n)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * (2.2 * bright) * np.exp(-t * 3.2)
    x = np.sin(2 * np.pi * f * t + mod) * env_ad(n, 0.004, dur, 4.2)
    x += 0.3 * np.sin(2 * np.pi * f * 2 * t) * env_ad(n, 0.002, dur * 0.4, 4)
    return x


# ---------------------------------------------------------------- arrangement

beats = META["beats"]
start_of = {b["id"]: b["start"] for b in beats}
end_t = META["duration"]

def section_at(t: float) -> str:
    cur = beats[0]["id"]
    for b in beats:
        if t + 1e-6 >= b["start"]:
            cur = b["id"]
    return cur

# D major, I V vi IV: D A Bm G (MIDI roots in octave 2 for bass).
CHORDS = [
    (38, [62, 66, 69]),  # D: D F# A
    (45, [61, 64, 69]),  # A: C# E A
    (47, [62, 66, 71]),  # Bm: D F# B
    (43, [62, 67, 71]),  # G: D G B
]
ARP = [0, 1, 2, 1, 0, 2, 1, 2]
HOOK = [(0, 78), (1.5, 76), (2, 74), (3, 76), (4, 73), (5.5, 74), (6, 71), (7, 69)]  # beats within 2 bars

music = np.zeros((N, 2))
drums_on = lambda s: s not in ("intro", "status", "end")
quiet = lambda s: s in ("intro", "status")

n_bars = int(np.ceil(DUR / BAR)) + 1
for bar in range(n_bars):
    t0 = bar * BAR
    if t0 > end_t + 0.2:
        break
    sec = section_at(t0 + 0.01)
    root, tones = CHORDS[bar % 4]
    fade_end = 1.0 if t0 < end_t - 3 else max(0.0, (end_t + 0.3 - t0) / 3.3)
    # pad
    add(music, pad([midi(m - 12) for m in tones], BAR + 0.7), t0 - 0.05, (0.24 if quiet(sec) else 0.16) * fade_end, 0.0)
    # plucks (8ths), softer while someone is on camera
    pg = (0.1 if quiet(sec) else 0.11) * fade_end
    for i in range(8):
        if quiet(sec) and i % 2:
            continue
        m = tones[ARP[i] % 3] + (12 if i in (3, 7) else 0)
        add(music, pluck(midi(m)), t0 + i * SPB / 2 + 0.004 * (i % 2), pg, -0.35 if i % 2 else 0.35)
    if drums_on(sec) and t0 < end_t - 1:
        for b in range(4):
            tb = t0 + b * SPB
            if b in (0, 2):
                add(music, kick(), tb, 0.55)
            if b in (1, 3):
                add(music, clap(), tb, 0.22, 0.1)
            for s16 in range(4):
                acc = 0.5 if s16 == 2 else 0.22
                add(music, shaker(acc), tb + s16 * SPB / 4 + (0.012 if s16 % 2 else 0), 0.16, -0.25)
        # bass: root on 1, octave pickups
        pattern = [(0, 0, 1.4), (1.5, 0, 0.45), (2, 12, 0.9), (3, 0, 0.45), (3.5, 7, 0.45)]
        for (bt, off, d) in pattern:
            add(music, bass_note(midi(root + off), d * SPB), t0 + bt * SPB, 0.42)
    elif sec in ("status",):
        add(music, bass_note(midi(root), BAR * 0.95), t0, 0.22)

# Bell hook on the logo, at the start of the NEAR chapter, and on the end card.
def hook_at(t: float, gain: float = 0.16):
    bar0 = np.ceil((t - 0.05) / BAR) * BAR if t > 0 else 0
    for (b, m) in HOOK:
        add(music, bell(midi(m), 1.8), bar0 + b * SPB, gain, 0.15)

for sid, g in (("logo", 0.15), ("near", 0.11)):
    if sid in start_of:
        hook_at(start_of[sid] - 0.2, g)
if "end" in start_of:
    te = start_of["end"]
    for k, m in enumerate([74, 78, 81, 86]):
        add(music, bell(midi(m), 3.2, 0.7), te + 0.3 + k * 0.12, 0.12, -0.3 + k * 0.2)
    add(music, pad([midi(m) for m in (50, 57, 62, 66)], end_t - te + 0.3), te, 0.2)

music = sos_filter(music, "lowpass", 12_000, 4)
music = high_shelf(music, 4500, -3.5)
fade_in = np.clip(t_axis(N) / 1.2, 0, 1)
music *= fade_in[:, None]

# ---------------------------------------------------------------- effects

def whoosh(dur=0.9, lo=300, hi=2600, gain=1.0):
    n = int(dur * SR)
    t = t_axis(n)
    noise = RNG.standard_normal(n)
    out = np.zeros(n)
    hop = 1024
    for i in range(0, n, hop):
        p = i / n
        fc = lo * (hi / lo) ** np.sin(np.pi * p)
        seg = noise[i:i + hop]
        sos = signal.butter(2, [fc * 0.7, min(fc * 1.4, SR / 2 - 100)], btype="bandpass", fs=SR, output="sos")
        out[i:i + hop] = signal.sosfilt(sos, seg)
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return out * e * gain


def chime(notes, step=0.07, dur=0.6, gain=1.0, bright=0.5):
    n = int((dur + step * len(notes)) * SR)
    x = np.zeros(n)
    for k, m in enumerate(notes):
        b = bell(midi(m), dur, bright)
        i = int(k * step * SR)
        x[i:i + len(b)] += b[: n - i]
    return x * gain


def tick(f=2800, dur=0.03):
    n = int(dur * SR)
    t = t_axis(n)
    return np.sin(2 * np.pi * f * t) * env_ad(n, 0.0005, dur, 6)


def thump():
    n = int(0.25 * SR)
    t = t_axis(n)
    x = np.sin(2 * np.pi * (70 + 40 * np.exp(-t * 30)) * t) * env_ad(n, 0.002, 0.2, 5)
    paper = sos_filter(RNG.standard_normal(n) * env_ad(n, 0.002, 0.06, 5), "bandpass", [1200, 4000])
    return x * 0.7 + paper * 0.12


SFX = {
    "wipe": lambda: whoosh(0.95, 260, 2400, 0.32),
    "iris": lambda: whoosh(1.0, 180, 1500, 0.28) + np.pad(bell(midi(86), 0.6, 0.2) * 0.04, (0, int(0.4 * SR))),
    "click": lambda: tick(2600, 0.025) * 0.5 + sos_filter(RNG.standard_normal(int(0.025 * SR)) * env_ad(int(0.025 * SR), 0.0003, 0.01, 6), "bandpass", [1500, 5000]) * 0.15,
    "check": lambda: chime([81, 88], 0.075, 0.45, 0.33, 0.35),
    "deny": lambda: chime([69, 65], 0.09, 0.35, 0.22, 0.2),
    "tick": lambda: tick(1900, 0.04) * 0.35,
    "land": lambda: thump() * 0.6,
    "alert": lambda: chime([76, 81, 85], 0.11, 0.6, 0.3, 0.4),
    "coin": lambda: chime([88, 93], 0.06, 0.5, 0.26, 0.6),
    "logo": lambda: whoosh(0.8, 200, 1200, 0.3),
}
sfx = np.zeros((N, 2))
cache = {}
last = {}
for c in META["cues"]:
    k = c["kind"]
    # Avoid machine-gun repeats of the same effect.
    if k in last and c["t"] - last[k] < 0.12:
        continue
    last[k] = c["t"]
    if k not in cache:
        cache[k] = SFX.get(k, SFX["tick"])()
    pan = {"click": 0.1, "check": -0.1, "deny": -0.1}.get(k, 0.0)
    add(sfx, cache[k], c["t"], 0.9 * c.get("gain", 1), pan)
sfx = sos_filter(sfx, "lowpass", 7000, 4)
sfx = high_shelf(sfx, 4500, -3.5)

# ---------------------------------------------------------------- voice-over timing and ducking

vo = META["vo"]
spans = []
for v in vo:
    if spans and v["start"] - spans[-1][1] < 0.6:
        spans[-1][1] = v["end"]
    else:
        spans.append([v["start"], v["end"]])
duck_db = np.zeros(N)
for a, b in spans:
    duck_db[int(max(0, a - 0.15) * SR): int(min(DUR, b + 0.25) * SR)] = -9.0
# smooth: attack ~80 ms, release ~300 ms (one-pole both ways)
g = 10 ** (duck_db / 20)
sm = np.empty_like(g)
y = 1.0
aa, ar = np.exp(-1 / (0.08 * SR)), np.exp(-1 / (0.3 * SR))
for i in range(0, N, 64):  # block-rate smoothing (fast enough, inaudible stepping)
    target = g[i]
    coef = aa if target < y else ar
    y = target + (y - target) * coef ** 64
    sm[i:i + 64] = y
music_ducked = music * sm[:, None]

guide = np.zeros((N, 2))
for v in vo:
    n = int((v["end"] - v["start"]) * SR)
    t = t_axis(n)
    tone = np.sin(2 * np.pi * (196 if v.get("cam") else 233) * t) * 0.05 * np.minimum(1, np.minimum(t, (n / SR - t)) / 0.05)
    add(guide, tone, v["start"], 1.0)
    add(guide, tick(1200, 0.02) * 0.3, v["start"], 1.0)

# ---------------------------------------------------------------- write

def norm_peak(x: np.ndarray, peak_db: float) -> np.ndarray:
    p = np.max(np.abs(x)) + 1e-9
    return x * (10 ** (peak_db / 20) / p)


def write(name: str, x: np.ndarray) -> None:
    x = np.clip(x, -1, 1)
    wavfile.write(os.path.join(OUT, name), SR, (x * (2 ** 31 - 1)).astype(np.int32))


m_scale = 10 ** (-6 / 20) / (np.max(np.abs(music)) + 1e-9)
music_out = music * m_scale
music_ducked *= m_scale
sfx_out = sfx * m_scale * 1.0
mix = music_ducked * 0.85 + sfx_out


def limit(x: np.ndarray, reduce_db: float = 5.0, release: float = 0.15) -> np.ndarray:
    """Look-ahead peak limiter: takes reduce_db off the highest peaks, smooth release."""
    from scipy.ndimage import maximum_filter1d
    look = int(0.005 * SR)
    env = maximum_filter1d(np.abs(x).max(axis=1), size=2 * look + 1)
    thr = env.max() * 10 ** (-reduce_db / 20)
    target = np.minimum(1.0, thr / np.maximum(env, 1e-9))
    g = np.empty_like(target)
    y = 1.0
    rc = np.exp(-1 / (release * SR))
    blk = 32
    for i in range(0, len(target), blk):
        tg = target[i:i + blk].min()
        y = tg if tg < y else tg + (y - tg) * rc ** blk
        g[i:i + blk] = y
    return x * g[:, None]


mix = limit(mix, 5.0)
mix = norm_peak(mix, -3.0)
# final short fade-out
fo = np.clip((DUR - 0.2 - t_axis(N)) / 1.2, 0, 1)
for arr in (mix, music_out):
    arr *= fo[:, None]
write("music.wav", music_out)
write("sfx.wav", np.clip(sfx_out, -1, 1))
write("vo-timing.wav", guide)
write("mix.wav", mix)
print(f"{CUT}: {DUR:.1f}s, {len(META['cues'])} cues, {len(spans)} voice spans -> {OUT}")
