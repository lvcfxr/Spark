"""Женская озвучка + проверка распознаванием речи (Whisper): слово принимается, только если Whisper слышит именно его."""
import re, sys, unicodedata, wave, numpy as np, sherpa_onnx
H = "/home/claude/sherpa"
KOKORO = dict(model=f"{H}/kokoro-multi-lang-v1_0/model.onnx", voices=f"{H}/kokoro-multi-lang-v1_0/voices.bin", tokens=f"{H}/kokoro-multi-lang-v1_0/tokens.txt",
              data_dir=f"{H}/kokoro-multi-lang-v1_0/espeak-ng-data", dict_dir=f"{H}/kokoro-multi-lang-v1_0/dict", lexicon=f"{H}/kokoro-multi-lang-v1_0/lexicon-us-en.txt,{H}/kokoro-multi-lang-v1_0/lexicon-zh.txt")
# язык → (движок, голос-женский, speaker id, kokoro lang)
VOICES = {"en": ("kokoro", 3, "en-us"), "es": ("kokoro", 28, "es"), "fr": ("kokoro", 30, "fr"), "ja": ("kokoro", 37, "ja")}
PIPER = {"de": "vits-piper-de_DE-eva_k-x_low", "de2": "vits-piper-de_DE-kerstin-low", "de3": "vits-piper-de_DE-ramona-low", "ru": "vits-piper-ru_RU-irina-medium", "de4": "vits-piper-de_DE-thorsten-high", "es2": "vits-piper-es_AR-daniela-high", "es3": "vits-piper-es_MX-claude-high"}
_tts = {}
def engine(key):
    if key in _tts: return _tts[key]
    if key in PIPER:
        d = f"{H}/{PIPER[key]}"; import glob
        cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=glob.glob(d + "/*.onnx")[0], tokens=d + "/tokens.txt", data_dir=d + "/espeak-ng-data"), num_threads=4))
    else:
        cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(lang=VOICES[key][2], **KOKORO), num_threads=4))
    _tts[key] = sherpa_onnx.OfflineTts(cfg); return _tts[key]
_pip = {}
def piper_model(key):
    if key in _pip: return _pip[key]
    import glob, json, onnxruntime as ort
    d = f"{H}/{PIPER[key]}"; m = glob.glob(d + "/*.onnx")[0]; cfg = json.load(open(m + ".json"))
    _pip[key] = (ort.InferenceSession(m, providers=["CPUExecutionProvider"]), cfg); return _pip[key]
def piper_synth(key, text, speed=0.95):
    from phonemizer.backend import EspeakBackend
    import espeakng_loader, os
    os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", espeakng_loader.get_library_path())
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    EspeakWrapper.set_library(espeakng_loader.get_library_path()); EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    sess, cfg = piper_model(key)
    ph = EspeakBackend(cfg["espeak"]["voice"], preserve_punctuation=True, with_stress=True).phonemize([text], strip=True)[0]
    idm = cfg["phoneme_id_map"]; ids = list(idm["^"])
    for ch in ph:
        if ch in idm: ids += idm[ch] + idm["_"]
    ids += idm["$"]
    inp = {"input": np.array([ids], dtype=np.int64), "input_lengths": np.array([len(ids)], dtype=np.int64),
           "scales": np.array([cfg["inference"].get("noise_scale", 0.667), 1.0 / speed, cfg["inference"].get("noise_w", 0.8)], dtype=np.float32)}
    if any(i.name == "sid" for i in sess.get_inputs()): inp["sid"] = np.array([0], dtype=np.int64)
    x = sess.run(None, inp)[0].squeeze().astype(np.float32)
    return x, cfg["audio"]["sample_rate"]
def pitch_shift(x, sr, ratio=1.18):
    """Сдвиг высоты с формантами вверх (rubberband): мужской голос Thorsten звучит как женский."""
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as td:
        save(f"{td}/a.wav", x, sr)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{td}/a.wav", "-af", f"rubberband=pitch={ratio}:formant=shifted", f"{td}/b.wav"], check=True)
        with wave.open(f"{td}/b.wav") as w: sr2 = w.getframerate(); y = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    return y, sr2
def synth(lang, text, speed=0.95, sid=None):
    if lang == "de4s":
        x, sr = piper_synth("de4", text, speed); return pitch_shift(x, sr)
    if lang in PIPER: return piper_synth(lang, text, speed)
    t = engine(lang); a = t.generate(text, sid=sid if sid is not None else VOICES[lang][1], speed=speed)
    return np.array(a.samples, dtype=np.float32), a.sample_rate
def save(path, x, sr):
    with wave.open(path, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())

_asr = {}
def asr(lang):
    if lang in _asr: return _asr[lang]
    d = f"{H}/sherpa-onnx-whisper-small"
    _asr[lang] = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{d}/small-encoder.int8.onnx", decoder=f"{d}/small-decoder.int8.onnx", tokens=f"{d}/small-tokens.txt", language=lang[:2], task="transcribe", num_threads=4)
    return _asr[lang]
def resample(x, sr, to=16000):
    if sr == to: return x
    n = int(len(x) * to / sr); return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
def heard(lang, x, sr):
    r = asr(lang); s = r.create_stream(); s.accept_waveform(16000, resample(np.concatenate([np.zeros(4000, np.float32), x, np.zeros(8000, np.float32)]), sr))
    r.decode_stream(s); return s.result.text.strip()
def norm(t):
    t = unicodedata.normalize("NFD", t.lower()); t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = t.replace("ё", "е").replace("ß", "ss"); return re.sub(r"[^\w]+", "", t, flags=re.U)
def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return 0.0
    import difflib; return difflib.SequenceMatcher(None, a, b).ratio()
if __name__ == "__main__":
    tests = [("es", "sí"), ("es", "la ciudad"), ("es", "adiós"), ("fr", "bonjour"), ("fr", "l'eau"), ("ja", "こんにちは"), ("ja", "水"), ("en", "people"), ("de", "Tschüss"), ("de", "das Wasser"), ("ru", "здравствуйте"), ("ru", "да")]
    for lang, w in tests:
        x, sr = synth(lang, w); print(lang, w, "→", repr(heard(lang, x, sr)), "dur %.2f" % (len(x) / sr), "sim %.2f" % sim(heard(lang, x, sr), w))
