"""Дописывает в json колод и курсов media.words: клип -> [язык, слово] (для подмены живой записью из Wikimedia Commons).
Запуск: python3 addwords.py   (из apps/desktop/catalog; после генерации звука и до build.mjs)"""
import json, re, glob, os
ART = {"es": r"(?:el|la|los|las|un|una)\s+", "fr": r"(?:le|la|les|un|une|l[’'])\s*", "de": r"(?:der|die|das|ein|eine)\s+", "en": r"(?:to|the|a|an)\s+", "ru": r"", "ja": r""}
def words(path, lang):
    d = json.load(open(path)); m = d.get("media")
    if not m: return 0
    out = {}
    for c in d["cards"]:
        mm = re.match(r"^(.*?)\s*\[audio\]\(media:([0-9a-f]+)\)\s*$", c["front"])
        if not mm: continue
        w, k = mm.group(1).strip(), mm.group(2)
        w = re.sub("^" + ART[lang], "", w, flags=re.I).strip() if ART[lang] else w
        if not w or re.search(r"[()/;,…]|\d", w) or len(w.split()) > 3: continue
        out[k] = [lang, w]
    m["words"] = out
    json.dump(d, open(path, "w"), ensure_ascii=False, indent=1)
    return len(out)
cat = json.load(open("catalog.json"))
for x in cat["decks"]:
    if x.get("media"): print(x["id"], words(x["file"], x["lang_front"]))
for p in glob.glob("../web/courses/*.json"):
    b = os.path.basename(p)[:-5]
    if b in ("es", "en", "fr", "de", "ja", "ru"): print(b, words(p, b))
