/**
 * Живые произношения носителей языка из Wikimedia Commons (проект Lingua Libre и словарь Викисловарь, лицензии CC).
 * Ищем запись слова на устройстве пользователя, кладём в Cache Storage и дальше играем оттуда; нет записи или нет сети — звучит встроенная озвучка.
 */
const API = "https://commons.wikimedia.org/w/api.php";
const LL: Record<string, [string, string]> = { es: ["Q1321", "spa"], en: ["Q1860", "eng"], fr: ["Q150", "fra"], de: ["Q188", "deu"], ja: ["Q5287", "jpn"], ru: ["Q7737", "rus"] };
const WIKT: Record<string, string> = { es: "Es", en: "En-us", fr: "Fr", de: "De", ja: "Ja", ru: "Ru" };
const NEG = "spark.human.miss", CACHE = "spark-human-v1", WEEK = 7 * 86400_000;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mem = new Map<string, Promise<string | null>>();

function misses(): Record<string, number> { try { return JSON.parse(localStorage.getItem(NEG) ?? "{}"); } catch { return {}; } }
function markMiss(k: string) { try { const m = misses(); m[k] = Date.now(); localStorage.setItem(NEG, JSON.stringify(m)); } catch { /* ignore */ } }

interface Hit { title: string; url: string }
async function search(q: string): Promise<Hit[]> {
  const u = `${API}?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|mime`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json() as { query?: { pages?: Record<string, { title: string; imageinfo?: { url: string; mime?: string }[] }> } };
  return Object.values(j.query?.pages ?? {}).filter((p) => p.imageinfo?.[0]?.mime?.startsWith("audio") || /\.(wav|ogg|oga|mp3|opus|flac)$/i.test(p.title)).map((p) => ({ title: p.title, url: p.imageinfo![0]!.url }));
}

async function find(lang: string, word: string): Promise<string | null> {
  const w = word.normalize("NFC").trim(), ext = "(?:wav|ogg|oga|mp3|opus|flac)";
  const ll = LL[lang], wk = WIKT[lang];
  const tries: [string, RegExp][] = [];
  if (ll) tries.push([`intitle:"LL-${ll[0]} (${ll[1]})" "${w}"`, new RegExp(`^File:LL-${ll[0]} \\(${ll[1]}\\)-.+-${esc(w)}\\.${ext}$`, "i")]);
  if (wk) tries.push([`intitle:"${wk}-${w}"`, new RegExp(`^File:${wk}-${esc(w)}\\.${ext}$`, "i")]);
  for (const [q, re] of tries) {
    const hits = (await search(q)).filter((h) => re.test(h.title.normalize("NFC"))).sort((a, b) => a.title.localeCompare(b.title));
    if (hits.length) {
      // разные дикторы: берём стабильно, но не всегда первого
      const h = hits[[...w].reduce((a, c) => a + c.charCodeAt(0), 0) % hits.length]!;
      const r = await fetch(h.url);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (blob.size < 800 || blob.size > 600_000) continue;
      return URL.createObjectURL(blob.type.startsWith("audio") ? blob : new Blob([blob], { type: /\.ogg|\.oga|\.opus/i.test(h.url) ? "audio/ogg" : /\.mp3/i.test(h.url) ? "audio/mpeg" : "audio/wav" }));
    }
  }
  return null;
}

/** Адрес живой записи слова или null (нет записи / нет сети). Первое обращение может занять пару секунд. */
export function humanUrl(lang: string, word: string): Promise<string | null> {
  const key = `${lang}|${word.toLowerCase()}`;
  const old = mem.get(key); if (old) return old;
  const p = (async () => {
    const m = misses()[key]; if (m && Date.now() - m < WEEK) return null;
    try {
      const cache = "caches" in window ? await caches.open(CACHE) : null;
      const hit = await cache?.match("/h/" + encodeURIComponent(key));
      if (hit) return URL.createObjectURL(await hit.blob());
      const u = await find(lang, word);
      if (!u) { markMiss(key); return null; }
      if (cache) { try { await cache.put("/h/" + encodeURIComponent(key), new Response(await (await fetch(u)).blob())); } catch { /* ignore */ } }
      return u;
    } catch { return null; }   // нет сети — не запоминаем промах
  })();
  mem.set(key, p);
  p.then((v) => { if (!v) mem.delete(key); });
  return p;
}
