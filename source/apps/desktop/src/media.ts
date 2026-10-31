/**
 * Медиа карточек (картинки, звук) в IndexedDB: в localStorage они не поместятся.
 * Ключ — SHA-256 содержимого (одинаковые файлы хранятся один раз). В тексте карточки:
 *   ![](media:HASH)     — картинка
 *   [audio](media:HASH) — звук
 * Медиа хранятся только на устройстве, где были добавлены (синхронизация медиа — следующий этап).
 */
const DB_NAME = "spark-media", STORE = "files";
let dbp: Promise<IDBDatabase> | null = null;
const urls = new Map<string, string>();
/** Хуки синхронизации: новая медиа → в очередь отправки; нет локально → скачать из облака. */
let onNew: ((key: string) => void) | null = null;
let remote: ((key: string) => Promise<Blob | null>) | null = null;
export function setMediaSync(onNewMedia: ((k: string) => void) | null, fetchRemote: ((k: string) => Promise<Blob | null>) | null) { onNew = onNewMedia; remote = fetchRemote; }

function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
export const AUDIO_RE = /\.(mp3|ogg|oga|wav|m4a|aac|opus|webm|flac)$/i;
export const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
/** Ограничения: «короткое видео» и «звук произношения». */
export const LIMITS = { videoBytes: 25 * 1024 * 1024, videoSeconds: 60, audioBytes: 10 * 1024 * 1024, recordSeconds: 20 };
export function mimeOf(name: string): string {
  const e = (name.split(".").pop() ?? "").toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
    mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", webm: "audio/webm", flac: "audio/flac", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", ogv: "video/ogg" } as Record<string, string>)[e] ?? "application/octet-stream";
}

/** Уменьшить большую картинку (до 1200 px, webp/jpeg), чтобы колоды не раздували память. GIF и SVG — как есть. */
export async function shrinkImage(blob: Blob): Promise<Blob> {
  if (/gif|svg/.test(blob.type) || typeof createImageBitmap !== "function") return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 300_000) return blob;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch { return blob; }
}

export async function putMedia(blob: Blob): Promise<string> {
  const key = await hex(await blob.arrayBuffer());
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  onNew?.(key);
  return key;
}

async function putLocal(key: string, blob: Blob) {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function getMediaBlob(key: string): Promise<Blob | null> {
  try {
    const d = await db();
    return await new Promise<Blob | null>((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res((r.result as Blob | undefined) ?? null); r.onerror = () => rej(r.error); });
  } catch { return null; }
}
export async function allMediaKeys(): Promise<string[]> {
  try {
    const d = await db();
    return await new Promise<string[]>((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => res(r.result.map(String)); r.onerror = () => rej(r.error); });
  } catch { return []; }
}

export async function mediaUrl(key: string): Promise<string | null> {
  const hit = urls.get(key);
  if (hit) return hit;
  try {
    let blob = await getMediaBlob(key);
    if (!blob && remote) { blob = await remote(key).catch(() => null); if (blob) await putLocal(key, blob); }
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(key, u);
    return u;
  } catch { return null; }
}

/** Подставить реальные адреса в отрисованные картинки/кнопки звука. */
export async function hydrateMedia(root: ParentNode, missingLabel: string): Promise<void> {
  const els = root.querySelectorAll<HTMLElement>("[data-media]:not([data-ready])");
  for (const el of els) {
    el.dataset.ready = "1";
    const u = await mediaUrl(el.dataset.media!);
    if (el instanceof HTMLVideoElement) {
      if (u) el.src = u;
      else el.replaceWith(Object.assign(document.createElement("span"), { className: "media-missing", textContent: "🎬 " + missingLabel }));
    } else if (el instanceof HTMLImageElement) {
      if (u) el.src = u;
      else el.replaceWith(Object.assign(document.createElement("span"), { className: "media-missing", textContent: "🖼 " + missingLabel }));
    } else if (!u) { el.classList.add("missing"); el.title = missingLabel; }
    else el.dataset.url = u;
  }
}

let current: HTMLAudioElement | null = null;
export function playAudio(url: string) {
  current?.pause();
  current = new Audio(url);
  void current.play().catch(() => {});
}

/** Длительность видео/аудио в секундах (по метаданным; NaN, если браузер не смог прочитать). */
export function mediaDuration(blob: Blob, kind: "video" | "audio"): Promise<number> {
  return new Promise((res) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    const done = (v: number) => { URL.revokeObjectURL(url); res(v); };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(NaN);
    setTimeout(() => done(NaN), 5000);
    el.src = url;
  });
}
