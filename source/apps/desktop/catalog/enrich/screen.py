import json, re, subprocess, sys, numpy as np
sys.path.insert(0, '.')
from ph import ph
CAT = "/home/claude/recall/apps/desktop/catalog"
VOICE = {"en-basics": "en-us", "en-irregular": "en-us", "es-basics": "es", "de-basics": "de", "ru-basics": "ru"}
def pcm(b):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", "-", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], input=b, capture_output=True).stdout
    return np.frombuffer(r, np.int16).astype(float) / 32768
def frames(x):
    n, hop = 320, 160; out = []
    for i in range(0, len(x) - n, hop):
        w = x[i:i+n] * np.hanning(n); S = np.abs(np.fft.rfft(w))**2; fr = np.fft.rfftfreq(n, 1/16000)
        out.append((10*np.log10(S.sum()+1e-12), 10*np.log10(S[fr > 3500].sum()+1e-12), 10*np.log10(S[fr < 1000].sum()+1e-12)))
    return out
rows = []
for d, v in VOICE.items():
    j = json.load(open(f"{CAT}/{d}.json")); pack = open(f"{CAT}/{d}.audio.mp3", "rb").read()
    for c in j["cards"]:
        for side in ("front", "back"):
            m = re.search(r"\[audio\]\(media:([0-9a-f]+)\)", c.get(side, ""))
            if not m: continue
            o, n = j["media"]["index"][m.group(1)]; x = pcm(pack[o:o+n])
            text = re.sub(r"\s*\[audio\].*", "", c[side])
            if d == "en-irregular" and side == "back": text = text.replace("/", ",")
            p = re.sub(r"[ˈˌː\s,.ʲ]", "", ph(text, v)); f = frames(x)
            mx = max(e for e, _, _ in f); act = [e > mx - 35 for e, _, _ in f]; act2 = [e > mx - 55 for e, _, _ in f]
            dur = sum(act) * 0.01
            # начало: есть ли шипящий (ВЧ сильнее НЧ) в первых 120 мс активной части
            first = next(i for i, a in enumerate(act2) if a)
            fric = any(h > l + 3 for e, h, l in f[first:first+12])
            rows.append((d, text, len(p), dur, dur / max(len(p), 1), fric, p))
r = np.array([x[4] for x in rows]); med = np.median(r)
print("median sec/phoneme", round(med, 3))
for d, text, n, dur, rate, fric, p in rows:
    starts_s = re.match(r"(s|ʃ|ts|tʃ|ʂ|ɕ)", p) is not None
    flag = []
    if rate > med * 2.0 or rate < med * 0.45: flag.append(f"rate {rate/med:.1f}x")
    if starts_s and not fric: flag.append("no-fricative-onset")
    if flag: print(f"{d:13s} {text:28s} {p:22s} {dur:.2f}s  {' '.join(flag)}")
