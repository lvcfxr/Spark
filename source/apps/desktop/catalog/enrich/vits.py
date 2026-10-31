"""Coqui VITS: для каждой фразы синтезирует несколько вариантов и берёт самый «чистый»:
без внутренних пауз (модель иногда повторяет слово или добавляет лишнее) и с длительностью, близкой к ожидаемой."""
import sys, glob, warnings
warnings.filterwarnings("ignore")
import numpy as np
from TTS.utils.synthesizer import Synthesizer
d = sys.argv[1]
syn = Synthesizer(tts_checkpoint=glob.glob(d + "/model_file.pth*")[0], tts_config_path=d + "/config.json", use_cuda=False)
sr = syn.output_sample_rate
def score(w, text):
    w = np.asarray(w, dtype=float); hop = int(sr * 0.01)
    e = np.array([10 * np.log10((w[i:i + 2 * hop] ** 2).sum() + 1e-12) for i in range(0, len(w) - 2 * hop, hop)])
    act = e > e.max() - 30
    idx = np.where(act)[0]
    if not len(idx): return 1e9, 0
    span = act[idx[0]:idx[-1] + 1]
    gaps, run = 0, 0
    for a in span:
        run = 0 if a else run + 1
        if run == 13: gaps += 1          # пауза > 130 мс внутри слова/фразы
    dur = len(span) * 0.01
    exp = 0.12 + 0.075 * len(text.replace(" ", "").strip(".!?"))
    return gaps * 3 + abs(dur - exp) / exp, dur
for line in sys.stdin:
    text, out = line.rstrip("\n").split("\t")
    best = None
    base = text.rstrip(",.!? ")
    for variant in (base + ",", base + ".", base + "!", base + "…"):
        for k in range(4):
            w = syn.tts(variant)
            s, dur = score(w, base)
            if best is None or s < best[0]: best = (s, w, dur)
            if best[0] < 0.35: break
        if best[0] < 0.35: break
    syn.save_wav(best[1], out)
    print(f"ok {text} score={best[0]:.2f} dur={best[2]:.2f}", flush=True)
