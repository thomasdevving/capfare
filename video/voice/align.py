import wave, json, re, sys
from pocketsphinx import Decoder
EXTRA = {"capfare": "K AE P F EH R", "relayer": "R IY L EY ER", "gasless": "G AE S L AH S", "nep": "N EH P", "testnet": "T EH S T N EH T", "passkey": "P AE S K IY", "onchain": "AA N CH EY N", "async": "EY S IH NG K"}
def norm(t):
    t = t.lower().replace("-", " ").replace("ed25519", "e d two five five one nine")
    return re.sub(r"[^a-z' ]", " ", t).split()
def load(name):
    w = wave.open(f"{name}.wav"); return w.readframes(w.getnframes())
PCM = {n: load(n) for n in ("p1", "p2")}
def align(src, t0, t1, text):
    d = Decoder(samprate=16000, loglevel="FATAL")
    for k, v in EXTRA.items(): d.add_word(k, v, False)
    words = norm(text)
    d.set_align_text(" ".join(words))
    pcm = PCM[src][int(t0 * 16000) * 2:int(t1 * 16000) * 2]
    d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    h = d.hyp()
    al = d.get_alignment()
    segs = [] if al is None else [(e.name, round(t0 + e.start / 100, 2), round(t0 + (e.start + e.duration) / 100, 2)) for e in al if e.name not in ("<s>", "</s>", "<sil>", "(NULL)")]
    return (h.score if h else -1e12), segs
if __name__ == "__main__":
    src, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    for cand in sys.argv[4:]:
        sc, segs = align(src, t0, t1, cand)
        print(f"{sc:>12}  {cand}")
        if len(sys.argv) == 5: print(" ".join(f"{w}@{a}" for w, a, b in segs))
