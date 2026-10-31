"""Сборка курсов Spark: courses.json (описание курсов и уровней) + <id>.json (карточки) + <id>.audio.mp3 (звук слов и примеров).
У каждой карточки перевод и пояснения на двух языках: при записи на курс приложение берёт язык пользователя (ru/en).
Запуск: python3 build_courses.py <выходной каталог> [--no-audio]
Нужны: piper (en, ru), Coqui TTS в VITS_PY (es, de, fr — VITS; ja — Tacotron2), ffmpeg."""
import hashlib, json, os, re, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from concepts import UNITS, C
from lang_es_fr import ES, FR
from lang_de_en import DE, EN
from lang_ru_ja import RU, JA

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "web", "courses")
AUDIO = "--no-audio" not in sys.argv
TTS = os.environ.get("TTS_HOME", "/home/claude/tts")
VITS_PY = os.environ.get("VITS_PY", "/home/claude/ctts/bin/python")
VERSION = 1

COURSES = [  # id, язык, флаг, для кого (родной язык), название ru/en, уровень, описание ru/en
    ("es", "es", "🇪🇸", ["ru", "en"], "Испанский: первые шаги", "Spanish: first steps"),
    ("en", "en", "🇬🇧", ["ru"], "Английский: первые шаги", "English: first steps"),
    ("fr", "fr", "🇫🇷", ["ru", "en"], "Французский: первые шаги", "French: first steps"),
    ("de", "de", "🇩🇪", ["ru", "en"], "Немецкий: первые шаги", "German: first steps"),
    ("ja", "ja", "🇯🇵", ["ru", "en"], "Японский: первые шаги", "Japanese: first steps"),
    ("ru", "ru", "🇷🇺", ["en"], "Русский: первые шаги", "Russian: first steps"),
]
DESC = {
    "ru": "80 самых нужных слов и фраз в 8 уровнях: приветствия, семья, числа, еда, город, глаголы, описания и поездки. У каждого слова — произношение, озвучка и живой пример с переводом. Уровни открываются по очереди.",
    "en": "The 80 most useful words and phrases in 8 levels: greetings, family, numbers, food, town, verbs, describing and travel. Every word has pronunciation, audio and a real example with translation. Levels unlock one by one.",
}
LANG_NAME = {"es": ("испанский", "Spanish"), "en": ("английский", "English"), "fr": ("французский", "French"), "de": ("немецкий", "German"), "ja": ("японский", "Japanese"), "ru": ("русский", "Russian")}

def parse(block, ja=False):
    out = {}
    for line in block.strip().splitlines():
        p = line.split("|")
        if ja: cid, word, pron, ex, exr, nru, nen = (p + [""] * 7)[:7]
        else: cid, word, pron, ex, nru, nen = (p + [""] * 6)[:6]; exr = ""
        out[cid] = dict(word=word, pron=pron, ex=ex, exr=exr, note={"ru": nru, "en": nen})
    return out

DATA = {"es": parse(ES), "fr": parse(FR), "de": parse(DE), "en": parse(EN), "ru": parse(RU), "ja": parse(JA, ja=True)}
for k, v in DATA.items():
    missing = [c[0] for c in C if c[0] not in v]
    assert not missing, (k, missing)

# ---------- ромадзи → хирагана (чтобы отдельные слова с кандзи читались однозначно) ----------
KANA = {"a": "あ", "i": "い", "u": "う", "e": "え", "o": "お", "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ", "sa": "さ", "shi": "し", "su": "す", "se": "せ", "so": "そ",
        "ta": "た", "chi": "ち", "tsu": "つ", "te": "て", "to": "と", "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の", "ha": "は", "hi": "ひ", "fu": "ふ", "he": "へ", "ho": "ほ",
        "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も", "ya": "や", "yu": "ゆ", "yo": "よ", "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ", "wa": "わ", "wo": "を",
        "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご", "za": "ざ", "ji": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ", "da": "だ", "de": "で", "do": "ど",
        "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ", "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
        "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ", "sha": "しゃ", "shu": "しゅ", "sho": "しょ", "cha": "ちゃ", "chu": "ちゅ", "cho": "ちょ", "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
        "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ", "mya": "みゃ", "myu": "みゅ", "myo": "みょ", "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ", "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
        "ja": "じゃ", "ju": "じゅ", "jo": "じょ", "bya": "びゃ", "byu": "びゅ", "byo": "びょ", "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ"}
def romaji_to_kana(r: str) -> str:
    s = r.lower().replace("ō", "ou").replace("ū", "uu").replace("ā", "aa").replace("ī", "ii").replace("ē", "ei").replace(" ", "")
    out, i = "", 0
    while i < len(s):
        if i + 1 < len(s) and s[i] == s[i + 1] and s[i] not in "aeiouny": out += "っ"; i += 1; continue
        if s[i] == "n" and (i + 1 == len(s) or s[i + 1] not in "aeiouy"): out += "ん"; i += 1; continue
        for L in (3, 2, 1):
            if s[i:i + L] in KANA: out += KANA[s[i:i + L]]; i += L; break
        else: raise ValueError(f"romaji: {r} @ {s[i:]}")
    return out

# ---------- звук ----------
CACHE = os.path.join(TTS, "cache-courses"); os.makedirs(CACHE, exist_ok=True)
PIPER = {"en": f"{TTS}/voice-en-us-lessac-medium/en-us-lessac-medium.onnx", "ru": f"{TTS}/voice-ru-irinia-medium/ru-irinia-medium.onnx"}
COQUI = {"es": (f"{TTS}/es-css10/tts_models--es--css10--vits", "-", ""), "de": (f"{TTS}/de-vits/tts_models--de--thorsten--vits", "-", ""),
         "fr": (f"{TTS}/tts_models--fr--css10--vits/tts_models--fr--css10--vits", "-", ""),
         "ja": (f"{TTS}/tts_models--ja--kokoro--tacotron2-DDC/tts_models--ja--kokoro--tacotron2-DDC", f"{TTS}/vocoder_models--ja--kokoro--hifigan_v1/vocoder_models--ja--kokoro--hifigan_v1", "ja")}
AF = ("silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.06,areverse,"
      "silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.1,areverse,apad=pad_dur=0.1,loudnorm=I=-16:TP=-1.5")
def wav_path(lang, text): return os.path.join(CACHE, hashlib.sha1(f"{lang}|v1|{text}".encode()).hexdigest()[:16] + ".wav")

def synth_all(jobs):
    """jobs: (lang, text, expected_sec). Coqui — пакетом на язык, piper — по одной."""
    by = {}
    for lang, text, exp in jobs:
        if not os.path.exists(wav_path(lang, text)): by.setdefault(lang, {})[text] = exp
    for lang, items in by.items():
        if lang in PIPER:
            for text in items:
                subprocess.run([f"{TTS}/piper_amd64/piper/piper", "-m", PIPER[lang], "-f", wav_path(lang, text), "--length_scale", "1.08", "--sentence_silence", "0.2"],
                               input=text.encode(), check=True, capture_output=True)
        else:
            model, voc, flag = COQUI[lang]
            inp = "".join(f"{t}\t{wav_path(lang, t)}\t{e:.2f}\n" for t, e in items.items())
            r = subprocess.run([VITS_PY, f"{TTS}/synth.py", model, voc] + ([flag] if flag else []), input=inp.encode(), capture_output=True)
            open(os.path.join(CACHE, f"log-{lang}.txt"), "a").write(r.stdout.decode())
            if r.returncode: raise RuntimeError(r.stderr.decode()[-2000:])
        print(f"  {lang}: {len(items)} clips", flush=True)

def mp3(lang, text) -> bytes:
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav_path(lang, text), "-af", AF, "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "40k", f"{td}/a.mp3"], check=True)
        return open(f"{td}/a.mp3", "rb").read()

def speak_word(lang, d):  # что отдаём синтезатору для отдельного слова
    return romaji_to_kana(d["pron"]) if lang == "ja" else d["word"]

# ---------- сборка ----------
os.makedirs(OUT, exist_ok=True)
if AUDIO:
    jobs = []
    for cid, lang, *_ in COURSES:
        for c in C:
            d = DATA[lang][c[0]]
            ex_len = len(d["exr"] or d["ex"])
            jobs.append((lang, speak_word(lang, d), 0.12 + 0.07 * len((d["pron"] if lang == "ja" else d["word"]).replace(" ", ""))))
            jobs.append((lang, d["ex"], 0.2 + 0.062 * ex_len))
    synth_all(jobs)

index = []
for cid, lang, flag, natives, title_ru, title_en in COURSES:
    pack, media, cards = bytearray(), {}, []
    def put(text):
        if not AUDIO: return ""
        b = mp3(lang, text); k = hashlib.sha256(b).hexdigest()[:24]
        if k not in media: media[k] = [len(pack), len(b)]; pack.extend(b)
        return f" [audio](media:{k})"
    for c in C:
        concept, unit, ru, en, exru, exen = c
        d = DATA[lang][concept]
        a_word, a_ex = put(speak_word(lang, d)), put(d["ex"])
        meaning = {"ru": ru, "en": en}
        if lang == "ru": meaning["en"] = en
        extra = {}
        for L in ("ru", "en"):
            tr = exru if L == "ru" else exen
            lines = [d["note"][L]] if d["note"].get(L) else []
            lines.append(f"> {d['ex']}{a_ex}" + (f"\n> *{d['exr']}*" if d["exr"] else "") + f"\n> — {tr}")
            extra[L] = "\n".join(lines)
        cards.append({"id": concept, "unit": unit, "front": d["word"] + a_word, "hint": d["pron"], "back": meaning, "extra": extra})
    out = {"id": cid, "version": VERSION, "cards": cards}
    if media:
        open(os.path.join(OUT, f"{cid}.audio.mp3"), "wb").write(pack)
        out["media"] = {"file": f"{cid}.audio.mp3", "type": "audio/mpeg", "index": media}
    json.dump(out, open(os.path.join(OUT, f"{cid}.json"), "w"), ensure_ascii=False, indent=0)
    units = [{"id": u, "title": {"ru": tr, "en": te}, "count": sum(1 for c in C if c[1] == u)} for u, tr, te in UNITS]
    index.append({"id": cid, "lang": lang, "flag": flag, "natives": natives, "title": {"ru": title_ru, "en": title_en},
                  "level": {"ru": "Начинающий", "en": "Beginner"}, "description": DESC, "author": "Spark",
                  "words": len(cards), "minutes": round(len(cards) * 1.5 / 5) * 5, "units": units, "version": VERSION,
                  "file": f"{cid}.json", "audio": bool(media)})
    print(f"{cid}: {len(cards)} cards, {len(media)} clips, {len(pack)//1024} KB")
json.dump({"version": VERSION, "courses": index}, open(os.path.join(OUT, "courses.json"), "w"), ensure_ascii=False, indent=1)
