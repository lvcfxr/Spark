"""Enrich Spark's built-in decks: written pronunciation (hint), explanation + example (extra),
and pronunciation audio (piper TTS → mp3), packed into one <deck>.audio.mp3 file per deck.
Usage: python3 gen.py <catalog_dir>"""
import hashlib, json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from data_en import EN, IRR
from data_es_de import ES, DE
from data_ru import RU
from data_misc import CAP, EL

CAT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
PIPER = f"{HERE}/piper_amd64/piper/piper"
VOICES = {
    "en": (f"{HERE}/voice-en-us-lessac-medium/en-us-lessac-medium.onnx", 1.08),
    "es": (f"{HERE}/voice-es-carlfm-x-low/es-carlfm-x-low.onnx", 1.1),
    "de": (f"{HERE}/voice-de-thorsten-low/de-thorsten-low.onnx", 1.05),
    "ru": (f"{HERE}/voice-ru-irinia-medium/ru-irinia-medium.onnx", 1.08),
}
CACHE = f"{HERE}/cache"; os.makedirs(CACHE, exist_ok=True)

def tts(lang: str, text: str) -> bytes:
    model, speed = VOICES[lang]
    tag = hashlib.sha1(f"{lang}|{speed}|{text}".encode()).hexdigest()[:16]
    mp3 = f"{CACHE}/{tag}.mp3"
    if not os.path.exists(mp3):
        with tempfile.TemporaryDirectory() as td:
            wav = f"{td}/a.wav"
            subprocess.run([PIPER, "-m", model, "-f", wav, "--length_scale", str(speed), "--sentence_silence", "0.25"],
                           input=text.encode(), check=True, capture_output=True)
            af = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                  "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                  "adelay=60,apad=pad_dur=0.15,loudnorm=I=-16:TP=-1.5")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-af", af, "-ac", "1", "-ar", "24000",
                            "-c:a", "libmp3lame", "-b:a", "40k", mp3], check=True)
    return open(mp3, "rb").read()

def key(b: bytes) -> str:  # same as media.ts: SHA-256 hex, first 24 chars
    return hashlib.sha256(b).hexdigest()[:24]

def ex(note, example, tr):
    return f"{note}\n> {example} — *{tr}*"

def build(deck_id: str, version: int, rows):
    """rows: list of dicts with front/back/hint/extra and optional ('front_tts'|'back_tts', lang)."""
    pack, index, cards = bytearray(), {}, []
    for r in rows:
        c = {k: r[k] for k in ("front", "back", "hint", "extra") if r.get(k)}
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

V = 2
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
        rows.append({"front": w, "back": plain(c["back"]), "hint": f"/{ipa}/" + (f" · {old}" if old else ""), "extra": ex(note, e, tr), "front_tts": (lang, w)})
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
    rows.append({"front": w, "back": c["back"], "hint": region, "extra": fact})
build("capitals", V, rows)

rows = []
for c in load("elements"):
    w = plain(c["front"]); latin, fact = EL[w]
    num = c["hint"].split(" · ")[0]
    rows.append({"front": w, "back": c["back"], "hint": num, "extra": f"*{latin}*. {fact}"})
build("elements", V, rows)

cat = json.load(open(f"{CAT}/catalog.json"))
for d in cat["decks"]:
    d["version"] = V
    m = f"{CAT}/{d['id']}.audio.mp3"
    if os.path.exists(m):
        d["media"] = d["id"] + ".audio.mp3"; d["audio"] = True
        for k, add in (("description", " Со звуком, транскрипцией и примерами."), ("description_en", " With audio, transcription and examples.")):
            if add.strip() not in d[k]: d[k] = d[k].rstrip() + add
    else:
        for k, add in (("description", " С подсказками и короткими пояснениями."), ("description_en", " With hints and short explanations.")):
            if add.strip() not in d[k]: d[k] = d[k].rstrip() + add
json.dump(cat, open(f"{CAT}/catalog.json", "w"), ensure_ascii=False, indent=1)
