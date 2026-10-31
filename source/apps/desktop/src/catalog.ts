import { authToken, getConfig, getSession } from "./sync";

/** Колода в каталоге: встроенная (Spark) или опубликованная пользователем (community). */
export interface CatalogDeck {
  id: string; source: "spark" | "community";
  title: string; title_en?: string; description: string; description_en?: string;
  emoji: string; lang_front: string; lang_back: string; tags: string[]; count: number;
  version: number; author?: string; file?: string; downloads?: number; updated?: string;
}
export interface DeckCard { front: string; back?: string; hint?: string; extra?: string; tags?: string; kind?: string; n?: number }

interface Embedded { catalog: { decks: Omit<CatalogDeck, "source">[] }; cards: Record<string, DeckCard[]> }
declare const __CATALOG__: Embedded;

/** Где лежит каталог на хостинге: рядом с приложением (Mini App) или на GitHub Pages (для .exe). */
const DEFAULT_REMOTE = "https://lvcfxr.github.io/Spark/decks/";
function remoteBase(): string {
  const c = (window as unknown as { SPARK_CONFIG?: { catalogUrl?: string }; RECALL_CONFIG?: { catalogUrl?: string } });
  const custom = c.SPARK_CONFIG?.catalogUrl ?? c.RECALL_CONFIG?.catalogUrl;
  if (custom) return custom.replace(/\/?$/, "/");
  return /^https?:/.test(location.protocol) ? new URL("decks/", location.href).href : DEFAULT_REMOTE;
}

let sparkCache: CatalogDeck[] | null = null;

/** Встроенный каталог доступен всегда (даже офлайн); если на хостинге есть новее — берём его. */
export async function loadSparkCatalog(): Promise<CatalogDeck[]> {
  if (sparkCache) return sparkCache;
  let decks = __CATALOG__.catalog.decks.map((d) => ({ ...d, source: "spark" as const }));
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(remoteBase() + "catalog.json", { cache: "no-cache", signal: ctrl.signal });
    if (r.ok) {
      const remote = ((await r.json()) as { decks: Omit<CatalogDeck, "source">[] }).decks;
      const byId = new Map(decks.map((d) => [d.id, d]));
      for (const d of remote) { const cur = byId.get(d.id); if (!cur || d.version > cur.version) byId.set(d.id, { ...d, source: "spark" }); }
      decks = [...byId.values()];
    }
  } catch { /* офлайн или file:// — хватит встроенного */ }
  sparkCache = decks;
  return decks;
}

export async function loadSparkCards(d: CatalogDeck): Promise<DeckCard[]> {
  const local = __CATALOG__.cards[d.id];
  const embeddedVersion = __CATALOG__.catalog.decks.find((x) => x.id === d.id)?.version ?? 0;
  if (local && embeddedVersion >= d.version) return local;
  const r = await fetch(remoteBase() + (d.file ?? `${d.id}.json`), { cache: "no-cache" });
  if (!r.ok) { if (local) return local; throw new Error(`HTTP ${r.status}`); }
  return ((await r.json()) as { cards: DeckCard[] }).cards;
}

// ---------- колоды пользователей (Supabase: таблица shared_decks) ----------
export const communityAvailable = () => !!getConfig();

async function rest(path: string, init: RequestInit & { json?: unknown; auth?: boolean } = {}): Promise<Response> {
  const cfg = getConfig();
  if (!cfg) throw new Error("no-server");
  const headers: Record<string, string> = { apikey: cfg.key, "Content-Type": "application/json", ...(init.headers as Record<string, string>) };
  if (init.auth) headers.Authorization = `Bearer ${await authToken(cfg)}`;
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return res;
}

const COLS = "id,title,description,emoji,lang_front,lang_back,tags,card_count,downloads,author_name,updated_at,local_deck_id,owner";
type Row = Record<string, unknown>;
const toDeck = (r: Row): CatalogDeck => ({
  id: String(r.id), source: "community", title: String(r.title), description: String(r.description ?? ""), emoji: String(r.emoji ?? "📘"),
  lang_front: String(r.lang_front ?? ""), lang_back: String(r.lang_back ?? ""), tags: (r.tags as string[]) ?? [], count: Number(r.card_count ?? 0),
  version: Date.parse(String(r.updated_at ?? "")) || 0, author: String(r.author_name ?? ""), downloads: Number(r.downloads ?? 0), updated: String(r.updated_at ?? ""),
});

export async function loadCommunity(): Promise<CatalogDeck[]> {
  const r = await rest(`shared_decks?select=${COLS}&is_public=eq.true&order=downloads.desc&limit=300`);
  return ((await r.json()) as Row[]).map(toDeck);
}
export async function loadCommunityCards(id: string): Promise<DeckCard[]> {
  const r = await rest(`shared_decks?select=cards&id=eq.${encodeURIComponent(id)}`);
  const rows = (await r.json()) as { cards: DeckCard[] }[];
  if (!rows[0]) throw new Error("not found");
  void rest("rpc/shared_deck_downloaded", { method: "POST", json: { deck: id } }).catch(() => {});
  return rows[0].cards;
}

export interface MyPublished { id: string; local_deck_id: string; is_public: boolean; downloads: number }
export async function myPublished(): Promise<MyPublished[]> {
  const ses = getSession();
  if (!ses) return [];
  const r = await rest(`shared_decks?select=id,local_deck_id,is_public,downloads&owner=eq.${ses.user.id}`, { auth: true });
  return (await r.json()) as MyPublished[];
}

export interface PublishInput { local_deck_id: string; title: string; description: string; emoji: string; lang_front: string; lang_back: string; tags: string[]; author_name: string; cards: DeckCard[] }
export async function publishDeck(p: PublishInput): Promise<void> {
  await rest("shared_decks?on_conflict=owner,local_deck_id", {
    method: "POST", auth: true, headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    json: { ...p, card_count: p.cards.length, is_public: true, updated_at: new Date().toISOString() },
  });
}
export async function unpublishDeck(id: string): Promise<void> {
  await rest(`shared_decks?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", auth: true });
}

export const LANGS: Record<string, [string, string]> = {
  ru: ["Русский", "Russian"], en: ["English", "English"], es: ["Español", "Spanish"], de: ["Deutsch", "German"], fr: ["Français", "French"],
  it: ["Italiano", "Italian"], pt: ["Português", "Portuguese"], zh: ["中文", "Chinese"], ja: ["日本語", "Japanese"], ko: ["한국어", "Korean"],
  tr: ["Türkçe", "Turkish"], uk: ["Українська", "Ukrainian"], pl: ["Polski", "Polish"], ar: ["العربية", "Arabic"],
};
