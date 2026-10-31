import { syncOnce, type Change, type Cursor, type PullResult, type ReviewEvent, type SyncTransport } from "../../../packages/core/src";
import type { Store } from "./store";
import { t } from "./i18n";

// ---------- конфиг и сессия ----------
export interface SbConfig { url: string; key: string }
export interface Session { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string; telegram?: { id: number; username: string; name: string } } }
const CFG_KEY = "recall.sync.cfg", SES_KEY = "recall.sync.session";

/** Конфиг можно зашить в хостинг: config.js с window.RECALL_CONFIG = { supabaseUrl, supabaseKey }. */
export function presetConfig(): SbConfig | null {
  const w = window as unknown as { SPARK_CONFIG?: { supabaseUrl?: string; supabaseKey?: string }; RECALL_CONFIG?: { supabaseUrl?: string; supabaseKey?: string } };
  const c = w.SPARK_CONFIG?.supabaseUrl ? w.SPARK_CONFIG : w.RECALL_CONFIG;
  return c?.supabaseUrl && c?.supabaseKey ? { url: c.supabaseUrl.replace(/\/+$/, ""), key: c.supabaseKey } : null;
}
export function getConfig(): SbConfig | null {
  const p = presetConfig();
  if (p) return p;
  try { const c = JSON.parse(localStorage.getItem(CFG_KEY) ?? "null"); return c?.url && c?.key ? c : null; } catch { return null; }
}
export const saveConfig = (c: SbConfig) => localStorage.setItem(CFG_KEY, JSON.stringify({ url: c.url.trim().replace(/\/+$/, ""), key: c.key.trim() }));
export function getSession(): Session | null { try { return JSON.parse(localStorage.getItem(SES_KEY) ?? "null"); } catch { return null; } }
const saveSession = (s: Session | null) => (s ? localStorage.setItem(SES_KEY, JSON.stringify(s)) : localStorage.removeItem(SES_KEY));

/** Явный выбор пользователя: хранить только на устройстве или синхронизировать. null — ещё не выбирал. */
export type StorageChoice = "local" | "cloud";
export function getChoice(): StorageChoice | null { const v = localStorage.getItem("recall.syncChoice"); return v === "local" || v === "cloud" ? v : null; }
export const setChoice = (c: StorageChoice) => localStorage.setItem("recall.syncChoice", c);

export class AuthError extends Error {}

async function auth(cfg: SbConfig, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, { method: "POST", headers: { apikey: cfg.key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AuthError(String(data.error_description ?? data.msg ?? data.message ?? t("Ошибка входа ({n})", { n: res.status })));
  return data;
}
function toSession(d: Record<string, unknown>, prev?: Session | null): Session {
  const u = d.user as { id: string; email: string; telegram?: Session["user"]["telegram"] };
  return { access_token: String(d.access_token), refresh_token: String(d.refresh_token), expires_at: Math.floor(Date.now() / 1000) + Number(d.expires_in ?? 3600),
    user: { id: u.id, email: u.email, telegram: u.telegram ?? prev?.user.telegram } };
}
/** Вход через Telegram: функция telegram-auth проверяет подпись initData и возвращает сессию. Аккаунт создаётся сам. */
export async function signInTelegram(cfg: SbConfig, initData: string): Promise<Session> {
  const headers: Record<string, string> = { apikey: cfg.key, "Content-Type": "application/json" };
  if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;
  const res = await fetch(`${cfg.url}/functions/v1/telegram-auth`, { method: "POST", headers, body: JSON.stringify({ initData }) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AuthError(String(data.error ?? `telegram-auth: ${res.status}`));
  const s = toSession(data); saveSession(s); return s;
}
export async function signIn(cfg: SbConfig, email: string, password: string): Promise<Session> {
  const s = toSession(await auth(cfg, "token?grant_type=password", { email, password }));
  saveSession(s); return s;
}
/** null — аккаунт создан, но нужно подтвердить почту. */
export async function signUp(cfg: SbConfig, email: string, password: string): Promise<Session | null> {
  const d = await auth(cfg, "signup", { email, password });
  if (!d.access_token) return null;
  const s = toSession(d); saveSession(s); return s;
}
export const signOut = () => saveSession(null);

export async function authToken(cfg: SbConfig): Promise<string> { return token(cfg); }
async function token(cfg: SbConfig): Promise<string> {
  const s = getSession();
  if (!s) throw new AuthError(t("Нужно войти в аккаунт"));
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  const next = toSession(await auth(cfg, "token?grant_type=refresh_token", { refresh_token: s.refresh_token }).catch(() => { saveSession(null); throw new AuthError(t("Сессия истекла, войдите снова")); }), s);
  saveSession(next); return next.access_token;
}

// ---------- транспорт PostgREST ----------
const PAGE = 1000, CHUNK = 500;
export class SupabaseTransport implements SyncTransport {
  constructor(private cfg: SbConfig) {}
  private async req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const tok = await token(this.cfg);
    const res = await fetch(`${this.cfg.url}/rest/v1/${path}`, {
      ...init, body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      headers: { apikey: this.cfg.key, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
    });
    if (res.status === 401 || res.status === 403) throw new AuthError(t("Нет доступа: войдите заново"));
    if (!res.ok) throw new Error(t("Сервер ответил {n}", { n: res.status }) + ": " + (await res.text()).slice(0, 160));
    return res;
  }
  async push(changes: Change[], reviews: ReviewEvent[]): Promise<void> {
    const prefer = { Prefer: "resolution=ignore-duplicates,return=minimal" };
    for (let i = 0; i < changes.length; i += CHUNK) {
      const rows = changes.slice(i, i + CHUNK).map((c) => ({ id: c.id, entity: c.entity, entity_id: c.entityId, field: c.field, value: c.value ?? null, hlc: c.hlc, device_id: c.deviceId }));
      await this.req("changes?on_conflict=user_id,id", { method: "POST", json: rows, headers: prefer });
    }
    for (let i = 0; i < reviews.length; i += CHUNK) {
      const rows = reviews.slice(i, i + CHUNK).map((r) => ({ id: r.id, card_id: r.cardId, rating: r.rating, ts: r.ts, duration_ms: Math.round(r.durationMs), device_id: r.deviceId }));
      await this.req("reviews?on_conflict=user_id,id", { method: "POST", json: rows, headers: prefer });
    }
  }
  async pull(cur: Cursor): Promise<PullResult> {
    const [cs, rs] = await Promise.all([
      this.req(`changes?select=*&seq=gt.${cur.changes}&order=seq.asc&limit=${PAGE}`).then((r) => r.json() as Promise<Record<string, unknown>[]>),
      this.req(`reviews?select=*&seq=gt.${cur.reviews}&order=seq.asc&limit=${PAGE}`).then((r) => r.json() as Promise<Record<string, unknown>[]>),
    ]);
    return {
      changes: cs.map((r) => ({ id: String(r.id), entity: r.entity as Change["entity"], entityId: String(r.entity_id), field: String(r.field), value: r.value, hlc: String(r.hlc), deviceId: String(r.device_id) })),
      reviews: rs.map((r) => ({ id: String(r.id), cardId: String(r.card_id), rating: Number(r.rating) as ReviewEvent["rating"], ts: Number(r.ts), durationMs: Number(r.duration_ms), deviceId: String(r.device_id) })),
      cursor: { changes: cs.length ? Number(cs[cs.length - 1]!.seq) : cur.changes, reviews: rs.length ? Number(rs[rs.length - 1]!.seq) : cur.reviews },
      more: cs.length === PAGE || rs.length === PAGE,
    };
  }
}

// ---------- медиа в Supabase Storage (бакет media/<user_id>/<hash>) ----------
const MEDIA_OUT = "spark.mediaOut";
export function queueMedia(keys: string[]) {
  const cur = new Set<string>(JSON.parse(localStorage.getItem(MEDIA_OUT) ?? "[]"));
  keys.forEach((k) => cur.add(k));
  localStorage.setItem(MEDIA_OUT, JSON.stringify([...cur]));
}
function mediaQueue(): string[] { try { return JSON.parse(localStorage.getItem(MEDIA_OUT) ?? "[]"); } catch { return []; } }
function mediaDone(k: string) { localStorage.setItem(MEDIA_OUT, JSON.stringify(mediaQueue().filter((x) => x !== k))); }

export async function uploadPendingMedia(getBlob: (k: string) => Promise<Blob | null>, limit = 20): Promise<number> {
  const cfg = getConfig(), ses = getSession();
  if (!cfg || !ses) return 0;
  let n = 0;
  for (const k of mediaQueue().slice(0, limit)) {
    const blob = await getBlob(k);
    if (!blob) { mediaDone(k); continue; }
    const res = await fetch(`${cfg.url}/storage/v1/object/media/${ses.user.id}/${k}`, {
      method: "POST", body: blob,
      headers: { apikey: cfg.key, Authorization: `Bearer ${await token(cfg)}`, "x-upsert": "true", "Content-Type": blob.type || "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`media upload ${res.status}`);
    mediaDone(k); n++;
  }
  return n;
}
export async function downloadMedia(k: string): Promise<Blob | null> {
  const cfg = getConfig(), ses = getSession();
  if (!cfg || !ses) return null;
  const res = await fetch(`${cfg.url}/storage/v1/object/authenticated/media/${ses.user.id}/${k}`, { headers: { apikey: cfg.key, Authorization: `Bearer ${await token(cfg)}` } });
  return res.ok ? await res.blob() : null;
}

// ---------- сервис: когда и как синхронизировать ----------
export type SyncStatus = "off" | "idle" | "syncing" | "error" | "offline" | "auth";

export class SyncService {
  status: SyncStatus = "off";
  message = "";
  lastOk: number | null = null;
  private running = false;
  private again = false;
  private caughtUp = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private getStore: () => Store, private onStatus: () => void, private onPulled: () => void, private getBlob?: (k: string) => Promise<Blob | null>) {}

  get enabled(): boolean { return !!getConfig() && !!getSession() && this.getStore().syncOn; }

  private set(s: SyncStatus, msg = "") { this.status = s; this.message = msg; this.onStatus(); }

  /** Отложенный запуск: копит серию правок в один обмен. */
  trigger(delay = 1500) { clearTimeout(this.timer); this.timer = setTimeout(() => void this.runNow(), delay); }

  async runNow(): Promise<void> {
    const store = this.getStore(), cfg = getConfig();
    if (!cfg || !getSession() || !store.syncOn) { this.set("off"); return; }
    if (this.running) { this.again = true; return; }
    if (navigator.onLine === false) { this.set("offline"); return; }
    this.running = true; this.set("syncing");
    try {
      // Раз за запуск перечитываем «хвост» журнала: на сервере seq может фиксироваться не в порядке коммитов
      if (!this.caughtUp) { const c = store.getCursor(); store.setCursor({ changes: Math.max(0, c.changes - 2000), reviews: Math.max(0, c.reviews - 2000) }); this.caughtUp = true; }
      const st = await syncOnce(store, new SupabaseTransport(cfg));
      if (this.getBlob) await uploadPendingMedia(this.getBlob);
      this.lastOk = Date.now();
      this.set("idle");
      if (st.pulled > 0) this.onPulled();
    } catch (e) {
      if (e instanceof AuthError) this.set("auth", e.message);
      else if (e instanceof TypeError) this.set("offline", t("Нет связи с сервером"));
      else this.set("error", (e as Error).message);
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.trigger(500); }
    }
  }

  /** Периодические проверки: пока окно открыто — раз в 10 с; плюс при возврате в окно и появлении сети. */
  startBackground() {
    setInterval(() => { if (document.visibilityState === "visible" && this.enabled) void this.runNow(); }, 10_000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && this.enabled) void this.runNow(); });
    addEventListener("online", () => { if (this.enabled) void this.runNow(); });
    addEventListener("offline", () => { if (this.enabled) this.set("offline"); });
  }
}
