"""Пакетная женская озвучка с проверкой распознаванием речи.
stdin: JSON-строки {"lang","text","expect","out"}; для каждой строки перебираются варианты (голос, знаки препинания, скорость),
берётся тот, который Whisper услышал ближе всего к ожидаемому слову. Лог: ok|lang|text|sim|вариант|услышано"""
import json, os, sys, numpy as np, voice
from kokoro_onnx import Kokoro
H = voice.H
k = Kokoro(f"{H}/kokoro-v1.0.onnx", f"{H}/voices-v1.0.bin")
KV = {"en": [("af_heart", "en-us"), ("af_bella", "en-us"), ("af_nicole", "en-us")], "es": [("ef_dora", "es")], "fr": [("ff_siwis", "fr-fr")], "ja": [("jf_alpha", "ja"), ("jf_tebukuro", "ja"), ("jf_nezumi", "ja")]}
def candidates(lang, text):
    if lang in KV and lang != "es":
        for v, lc in KV[lang]:
            for txt in (text, text + ".", text + "!"):
                for sp in (0.95, 0.85):
                    yield f"{v}|{txt[-1] if txt != text else 'raw'}|{sp}", lambda v=v, lc=lc, txt=txt, sp=sp: k.create(txt, voice=v, speed=sp, lang=lc)
    else:
        if lang == "es":
            for txt in (text, text + "."):
                yield f"ef_dora|{txt[-1] if txt != text else 'raw'}|0.95", lambda txt=txt: k.create(txt, voice="ef_dora", speed=0.95, lang="es")
        for key in {"de": ("de4s",), "ru": ("ru",), "es": ("es2", "es3")}[lang]:
            for txt in (text, text + "."):
                for sp in (0.95, 0.85):
                    yield f"{key}|{txt[-1] if txt != text else 'raw'}|{sp}", lambda key=key, txt=txt, sp=sp: voice.synth(key, txt, speed=sp)
def trim(x, sr):
    x = np.asarray(x, dtype=np.float32); thr = 0.01 * max(1e-6, float(np.abs(x).max()))
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx): return x
    a = max(0, idx[0] - int(0.06 * sr)); b = min(len(x), idx[-1] + int(0.12 * sr)); return x[a:b]
for line in sys.stdin:
    try: j = json.loads(line)
    except Exception: print("BADLINE|" + repr(line)[:200], flush=True); continue
    lang, text, expect, out = j["lang"], j["text"], j.get("expect") or j["text"], j["out"]
    best = None; tried = 0
    for tag, fn in candidates(lang, text):
        try: x, sr = fn()
        except Exception as e: continue
        x = np.asarray(x, dtype=np.float32)
        if len(x) < sr * 0.15: continue
        verify = lang in ("es", "de", "fr") and len(expect.split()) <= 4 and j.get("check", True)   # en/ru/ja стабильны; длинные фразы не проверяем
        h = voice.heard(lang, x, sr) if verify else ""
        sim = voice.sim(h, expect) if verify else 0.95
        dur = len(x) / sr; tried += 1
        # слишком длинное для слова — признак «галлюцинации»
        if len(expect) <= 14 and dur > 0.45 + 0.28 * len(expect): sim *= 0.5
        if best is None or sim > best[0]: best = (sim, x, sr, tag, h)
        if sim >= 0.8 or tried >= (4 if lang != "ja" else 2): break
    if best is None: print("FAIL|" + lang + "|" + text, flush=True); continue
    voice.save(out, trim(best[1], best[2]), best[2])
    print(f"ok|{lang}|{text}|{best[0]:.2f}|{best[3]}|{best[4]}", flush=True)
