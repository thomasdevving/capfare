from pocketsphinx import Decoder
from align import EXTRA, PCM
def align(src, t0, t1, text):
    d = Decoder(samprate=16000, loglevel="FATAL")
    for k, v in EXTRA.items(): d.add_word(k, v, False)
    d.add_jsgf_string("g", "#JSGF V1.0;\ngrammar g;\npublic <s> = " + text + ";\n")
    d.activate_search("g")
    pcm = PCM[src][int(t0 * 16000) * 2:int(t1 * 16000) * 2]
    d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    segs = [(s.word, round(t0 + s.start_frame / 100, 2), round(t0 + (s.end_frame + 1) / 100, 2)) for s in (d.seg() or []) if s.word not in ("<s>", "</s>", "<sil>", "(NULL)", "[NOISE]")]
    return (d.hyp().hypstr if d.hyp() else None), segs
