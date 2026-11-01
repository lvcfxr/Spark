"""Пакетная женская озвучка: собирает задания, запускает speech_cli.py (venv с sherpa-onnx, kokoro-onnx, onnxruntime) и кеширует wav.
Модели лежат в SHERPA_HOME (kokoro-v1.0.onnx, voices-v1.0.bin, sherpa-onnx-whisper-small, vits-piper-*)."""
import hashlib, json, os, subprocess, sys
HOME = os.environ.get("SHERPA_HOME", "/home/claude/sherpa")
PY = os.environ.get("SHERPA_PY", "/home/claude/sh/bin/python")
CACHE = os.path.join(HOME, "cache-wav"); os.makedirs(CACHE, exist_ok=True)
VER = "v5"
def wav(lang, text): return os.path.join(CACHE, hashlib.sha1(f"{VER + 'de' if lang == 'de' else VER}|{lang}|{text}".encode()).hexdigest()[:16] + ".wav")
def run(jobs, label=""):
    """jobs: (lang, text, expect|None) -> synthesize missing, return nothing (files appear in cache)."""
    todo, seen = [], set()
    for lang, text, expect in jobs:
        p = wav(lang, text)
        if p in seen or os.path.exists(p): continue
        seen.add(p); todo.append({"lang": lang, "text": text, "expect": expect or text, "out": p, "check": lang != "ja"})
    if not todo: return
    log = open(os.path.join(CACHE, f"log-{label or 'run'}.txt"), "a")
    p = subprocess.Popen([PY, os.path.join(HOME, "speech_cli.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.path.join(CACHE, "stderr.txt"), "a"), text=True, cwd=HOME)
    p.stdin.write("".join(json.dumps(j, ensure_ascii=False) + "\n" for j in todo)); p.stdin.close()
    n = 0
    for line in p.stdout:
        if line.startswith(("ok|", "FAIL|")): log.write(line); log.flush(); n += 1; print(f"\r  {label}: {n}/{len(todo)}", end="", flush=True)
    p.wait(); print()
