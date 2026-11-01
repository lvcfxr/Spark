"""Enrich Spark's built-in decks: written pronunciation (hint), explanation + example (extra),
and pronunciation audio (piper TTS → mp3), packed into one <deck>.audio.mp3 file per deck.
Usage: python3 gen.py <catalog_dir>"""
import hashlib, json, os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from data_en import EN, IRR
from data_es_de import ES, DE
from data_ru import RU
from data_misc import CAP, EL
from data_en_side import ES_EN, DE_EN, CAP_EN, EL_EN

CAT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
PIPER = f"{HERE}/piper_amd64/piper/piper"
VOICES = {  # piper: (onnx, скорость); vits: Coqui VITS (испанский и немецкий заметно чище коротких слов у piper)
    "en": ("piper", f"{HERE}/voice-en-us-lessac-medium/en-us-lessac-medium.onnx", 1.08),
    "es": ("vits", f"{HERE}/es-css10/tts_models--es--css10--vits", 1.0),
    "de": ("vits", f"{HERE}/de-vits/tts_models--de--thorsten--vits", 1.0),
    "ru": ("piper", f"{HERE}/voice-ru-irinia-medium/ru-irinia-medium.onnx", 1.08),
}
VITS_PY = os.environ.get("VITS_PY", "/home/claude/ctts/bin/python")
CACHE = f"{HERE}/cache"; os.makedirs(CACHE, exist_ok=True)

# тишину срезаем осторожно (-60 dB и запас 60 мс), иначе тихие «с», «ш», «ф» в начале слова пропадают
AF = "apad=pad_dur=0.1,loudnorm=I=-16:TP=-1.5"   # тишину по краям уже срезал speech_cli; цепочка silenceremove+areverse у ffmpeg иногда зависает

def sentence(text: str) -> str:  # VITS обучен на предложениях: заглавная буква и точка дают чистое произношение
    t = text.strip()
    return (t[0].upper() + t[1:]) + ","   # с запятой модель не тянет и не «договаривает» конец слова

def cache_path(lang, text):
    eng, model, speed = VOICES[lang]
    if eng == "piper": return f"{CACHE}/" + hashlib.sha1(f"{lang}|{eng}|{model}|{speed}|v2|{text}".encode()).hexdigest()[:16] + ".wav"
    tag = hashlib.sha1(f"{lang}|{eng}|{model}|{speed}|v4|{text}".encode()).hexdigest()[:16]
    return f"{CACHE}/{tag}.wav"

def to_mp3(wav, mp3):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", wav, "-af", AF, "-ac", "1", "-ar", "24000",
                    "-c:a", "libmp3lame", "-b:a", "40k", mp3], check=True)

def prefetch(items):
    """VITS: одна загрузка модели на язык, все фразы пакетом."""
    by = {}
    for lang, text in items:
        if VOICES[lang][0] == "vits" and not os.path.exists(cache_path(lang, text)): by.setdefault(lang, set()).add(text)
    for lang, texts in by.items():
        with tempfile.TemporaryDirectory() as td:
            jobs = [(t, f"{td}/{i}.wav") for i, t in enumerate(sorted(texts))]
            inp = "".join(f"{sentence(t)}\t{w}\n" for t, w in jobs)
            r = subprocess.run([VITS_PY, f"{HERE}/vits.py", VOICES[lang][1]], input=inp.encode(), check=True, capture_output=True)
            open(f"{HERE}/vits-{lang}.log", "w").write(r.stdout.decode())
            for t, w in jobs: os.replace(w, cache_path(lang, t))
        print(f"vits {lang}: {len(texts)} clips")

sys.path.insert(0, HERE)
from voice import batch as vb
DRY = os.environ.get("GEN_DRY") == "1"
NEEDED: list = []
EXPECT = lambda t: re.sub(r"[.,—-]+", " ", t).strip()
def tts(lang: str, text: str) -> bytes:
    """Женский голос (Kokoro / Piper) с проверкой на слух: в кеше лежит вариант, который распознаватель услышал ближе всего к слову."""
    if DRY: NEEDED.append((lang, text, EXPECT(text))); return b"dry" + text.encode()
    with tempfile.TemporaryDirectory() as td:
        to_mp3(vb.wav(lang, text), f"{td}/a.mp3")
        return open(f"{td}/a.mp3", "rb").read()

def key(b: bytes) -> str:  # same as media.ts: SHA-256 hex, first 24 chars
    return hashlib.sha256(b).hexdigest()[:24]

def ex(note, example, tr):
    return f"{note}\n> {example} — *{tr}*"

def build(deck_id: str, version: int, rows):
    """rows: list of dicts with front/back/hint/extra and optional ('front_tts'|'back_tts', lang)."""
    pack, index, cards = bytearray(), {}, []
    for r in rows:
        c = {k: r[k] for k in ("front", "back", "hint", "extra", "front_en", "back_en", "hint_en", "extra_en") if r.get(k)}
        for side in ("front", "back"):
            spec = r.get(side + "_tts")
            if not spec: continue
            lang, text = spec
            data = tts(lang, text); k = key(data)
            if k not in index:
                index[k] = [len(pack), len(data)]; pack += data
            c[side] = f"{c[side]} [audio](media:{k})"
        cards.append(c)
    out = {"id": deck_id, "version": version, "cards": cards}
    if DRY: return len(cards)
    if index:
        open(f"{CAT}/{deck_id}.audio.mp3", "wb").write(pack)
        out["media"] = {"file": f"{deck_id}.audio.mp3", "type": "audio/mpeg", "index": index}
    json.dump(out, open(f"{CAT}/{deck_id}.json", "w"), ensure_ascii=False, indent=1)
    print(f"{deck_id}: {len(cards)} cards, {len(index)} clips, {len(pack)//1024} KB")
    return len(cards)

def load(deck_id):
    return json.load(open(f"{CAT}/{deck_id}.json"))["cards"]

def plain(s):  # strip earlier audio markers if the script is re-run
    import re
    return re.sub(r"\s*\[audio\]\(media:[0-9a-f]+\)", "", s or "").strip()

if not DRY and os.environ.get("GEN_SKIP_DRY") != "1":
    subprocess.run([sys.executable, os.path.abspath(__file__), CAT], env={**os.environ, "GEN_DRY": "1"}, check=True)
    vb.run([tuple(x) for x in json.load(open("/tmp/gen_needed.json"))], "decks")
V = 4
rows = []
for c in load("en-basics"):
    w = plain(c["front"]); ipa, note, e, tr = EN[w]
    pos = (c.get("hint") or "").split(" · ")[-1]
    rows.append({"front": w, "back": plain(c["back"]), "hint": f"/{ipa}/ · {pos}", "extra": ex(note, e, tr), "front_tts": ("en", w)})
build("en-basics", V, rows)

rows = []
for c in load("en-irregular"):
    w = plain(c["front"]); ipa, forms, say, note, e, tr = IRR[w]
    meaning = (c.get("hint") or "").split(" · ")[0]
    rows.append({"front": w, "back": plain(c["back"]), "hint": f"{meaning} · /{ipa}/", "extra": f"{forms}\n" + ex(note, e, tr),
                 "front_tts": ("en", w), "back_tts": ("en", say)})
build("en-irregular", V, rows)

for deck_id, data, lang in (("es-basics", ES, "es"), ("de-basics", DE, "de")):
    rows = []
    for c in load(deck_id):
        w = plain(c["front"]); ipa, note, e, tr = data[w]
        old = c.get("hint") or ""
        old = old.split(" · ", 1)[1] if old.startswith("/") and " · " in old else ("" if old.startswith("/") else old)
        men, nen, ten = (ES_EN if lang == "es" else DE_EN)[w]
        rows.append({"front": w, "back": plain(c["back"]), "hint": f"/{ipa}/" + (f" · {old}" if old else ""), "extra": ex(note, e, tr), "front_tts": (lang, w),
                     "back_en": men, "hint_en": f"/{ipa}/", "extra_en": ex(nen, e, ten)})
    build(deck_id, V, rows)

rows = []
for c in load("ru-basics"):
    w = plain(c["front"]); tl, ipa, note, e, tr = RU[w]
    rows.append({"front": w, "back": plain(c["back"]), "hint": f"{tl} · /{ipa}/", "extra": ex(note, e, tr), "front_tts": ("ru", w)})
build("ru-basics", V, rows)

rows = []
for c in load("capitals"):
    w = plain(c["front"]); region, fact = CAP[w]
    extra = fact + ("\n" + c["hint"] if c.get("hint") and "столиц" in c["hint"] and c["hint"] not in fact and "Африка" not in c["hint"] else "")
    ce, cap, reg, fen = CAP_EN[w]
    rows.append({"front": w, "back": c["back"], "hint": region, "extra": fact, "front_en": ce, "back_en": cap, "hint_en": reg, "extra_en": fen})
build("capitals", V, rows)

rows = []
for c in load("elements"):
    w = plain(c["front"]); latin, fact = EL[w]
    num = c["hint"].split(" · ")[0]
    nen, fen = EL_EN[w]
    rows.append({"front": w, "back": c["back"], "hint": num, "extra": f"*{latin}*. {fact}", "back_en": nen, "hint_en": num.replace("№", "No."), "extra_en": f"*{latin}*. {fen}"})
build("elements", V, rows)

if DRY:
    json.dump(NEEDED, open("/tmp/gen_needed.json", "w"), ensure_ascii=False); sys.exit(0)
cat = json.load(open(f"{CAT}/catalog.json"))
NATIVES = {"en-basics": ["ru"], "en-irregular": ["ru"], "ru-basics": ["en"]}
for d in cat["decks"]:
    d["version"] = V
    d["natives"] = NATIVES.get(d["id"], ["ru", "en"])
    d["level"] = {"en-basics": "A1", "es-basics": "A1", "de-basics": "A1", "ru-basics": "A1", "en-irregular": "A2"}.get(d["id"], "")
    if d["id"] == "capitals": d["title_en"] = "World capitals"; d["description_en"] = "60 countries and their capitals: Europe, Asia, the Americas, Africa and Oceania. With hints and short explanations."
    if d["id"] == "elements": d["title_en"] = "Chemical elements 1–30"; d["description_en"] = "Symbols of the first 30 elements of the periodic table and their names. The hint shows the atomic number. With short explanations."
    m = f"{CAT}/{d['id']}.audio.mp3"
    if os.path.exists(m):
        d["media"] = d["id"] + ".audio.mp3"; d["audio"] = True
        for k, add in (("description", " Со звуком, транскрипцией и примерами."), ("description_en", " With audio, transcription and examples.")):
            if add.strip() not in d[k]: d[k] = d[k].rstrip() + add
    else:
        for k, add in (("description", " С подсказками и короткими пояснениями."), ("description_en", " With hints and short explanations.")):
            if add.strip() not in d[k]: d[k] = d[k].rstrip() + add
json.dump(cat, open(f"{CAT}/catalog.json", "w"), ensure_ascii=False, indent=1)
