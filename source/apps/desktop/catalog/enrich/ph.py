import ctypes, sys
lib = ctypes.CDLL('/home/claude/tts/piper_amd64/piper/libespeak-ng.so.1')
lib.espeak_Initialize.restype = ctypes.c_int
lib.espeak_Initialize(0x02, 0, b'/home/claude/tts/piper_amd64/piper/espeak-ng-data', 0)
lib.espeak_TextToPhonemes.restype = ctypes.c_char_p
lib.espeak_TextToPhonemes.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_int, ctypes.c_int]
def ph(text, voice):
    lib.espeak_SetVoiceByName(voice.encode())
    buf = ctypes.create_string_buffer(text.encode('utf-8'))
    p = ctypes.c_void_p(ctypes.addressof(buf)); out=[]
    while p.value:
        r = lib.espeak_TextToPhonemes(ctypes.byref(p), 1, 0x02)  # IPA
        if r: out.append(r.decode('utf-8'))
    return ' '.join(out)
if __name__ == '__main__':
    v = sys.argv[1]
    for w in sys.argv[2:]: print(w, '→', ph(w, v))
