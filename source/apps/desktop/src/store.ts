import {
  DEFAULT_PARAMS, HlcClock, Replica, newCardState, nextState, replay,
  type CardState, type Change, type Cursor, type SyncHost, type EntityType, type Params, type Rating, type ReviewEvent,
} from "../../../packages/core/src";

import { backend } from "./backend";
import { t } from "./i18n";

interface SyncPersisted { on: boolean; account: string | null; cursor: Cursor; outC: string[]; outR: string[] }
interface Persisted { deviceId: string; changes: Change[]; reviews: ReviewEvent[]; sync?: SyncPersisted }

export interface Settings {
  theme: "auto" | "light" | "dark";
  accent: string;
  retention: number;
  newPerDay: number;
  typedDefault: boolean;
  manualGrades: boolean;
  typedAll: boolean;
  lang?: "auto" | "ru" | "en";
  autoAudio: boolean;
}
export const DEFAULT_SETTINGS: Settings = { theme: "auto", accent: "#7c3aed", retention: 0.9, newPerDay: 20, typedDefault: false, manualGrades: false, typedAll: true, autoAudio: true };

const uuid = () => crypto.randomUUID();

/** Локальное хранилище: журнал изменений + повторений в localStorage, поверх — Replica из ядра. */
export class Store implements SyncHost {
  replica = new Replica();
  deviceId: string;
  clock: HlcClock;
  changes: Change[] = [];
  reviews: ReviewEvent[] = [];
  states = new Map<string, CardState>();
  firstReview = new Map<string, number>();
  saveError = false;
  private lastCreated = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  onSaveError?: () => void;
  /** вызывается после локальной записи, когда синхронизация включена */
  onLocalChange?: () => void;
  syncOn = false;
  account: string | null = null;
  cursor: Cursor = { changes: 0, reviews: 0 };
  private outC = new Map<string, Change>();
  private outR = new Map<string, ReviewEvent>();

  constructor(raw: string | null) {
    let p: Persisted | null = null;
    if (raw) p = JSON.parse(raw); // повреждённые данные не маскируем — пусть ошибка будет видна
    this.deviceId = p?.deviceId ?? uuid();
    this.clock = new HlcClock(this.deviceId);
    this.merge(p?.changes ?? [], p?.reviews ?? []);
    if (p?.sync) {
      this.syncOn = p.sync.on; this.account = p.sync.account; this.cursor = p.sync.cursor ?? { changes: 0, reviews: 0 };
      const cById = new Map(this.changes.map((c) => [c.id, c])), rById = new Map(this.reviews.map((r) => [r.id, r]));
      for (const id of p.sync.outC) { const c = cById.get(id); if (c) this.outC.set(id, c); }
      for (const id of p.sync.outR) { const r = rById.get(id); if (r) this.outR.set(id, r); }
    }
    navigator.storage?.persist?.().catch(() => {});
  }

  /** Слияние чужих данных (загрузка, импорт бэкапа, в будущем — синхронизация). */
  merge(changes: Change[], reviews: ReviewEvent[]): void {
    const known = new Set(this.changes.map((c) => c.id));
    for (const c of changes) {
      this.clock.receive(c.hlc);
      this.replica.applyChange(c);
      if (!known.has(c.id)) { this.changes.push(c); known.add(c.id); }
    }
    const knownR = new Set(this.reviews.map((r) => r.id));
    for (const r of reviews) {
      this.replica.applyReview(r);
      if (!knownR.has(r.id)) { this.reviews.push(r); knownR.add(r.id); }
    }
    this.rebuildStates();
    this.persist();
  }

  get settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...(this.replica.get("setting", "global") as Partial<Settings> | undefined) };
  }

  get params(): Params {
    // Умная оценка: один шаг в 5 минут — «слабо знаю» возвращается через 5 минут, иначе через дни.
    return { ...DEFAULT_PARAMS, learningSteps: [5], relearningSteps: [5], desiredRetention: this.settings.retention };
  }

  set(entity: EntityType, id: string, field: string, value: unknown): void {
    const cur = this.replica.get(entity, id)?.[field];
    if (cur === value && field !== "_deleted") return;
    const c: Change = { id: uuid(), entity, entityId: id, field, value, hlc: this.clock.tick(), deviceId: this.deviceId };
    this.replica.applyChange(c);
    this.changes.push(c);
    if (this.syncOn) { this.outC.set(c.id, c); this.onLocalChange?.(); }
    this.persist();
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.set("setting", "global", k, v);
    if (k === "retention") this.rebuildStates();
  }

  addDeck(name: string): string {
    const id = uuid();
    this.set("deck", id, "name", name);
    this.set("deck", id, "created", Date.now());
    return id;
  }

  deleteDeck(id: string): void {
    for (const c of this.replica.list("card")) if (c.fields.deckId === id) this.set("card", c.id, "_deleted", true);
    this.set("deck", id, "_deleted", true);
  }

  addCard(deckId: string, front: string, back: string, typed: boolean = this.settings.typedDefault): string {
    const id = uuid();
    if (typed) this.set("card", id, "typed", true);
    this.set("card", id, "deckId", deckId);
    this.set("card", id, "front", front);
    this.set("card", id, "back", back);
    this.lastCreated = Math.max(Date.now(), this.lastCreated + 0.001);
    this.set("card", id, "created", this.lastCreated);
    return id;
  }

  /** Создать карточку с произвольными полями (тип, подсказка, пояснение, теги, группа…). */
  addCardFull(fields: Record<string, unknown>): string {
    const id = uuid();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== "" && v !== false) this.set("card", id, k, v);
    this.lastCreated = Math.max(Date.now(), this.lastCreated + 0.001);
    this.set("card", id, "created", this.lastCreated);
    return id;
  }

  deleteCard(id: string): void { this.set("card", id, "_deleted", true); }

  answer(cardId: string, rating: Rating, durationMs: number, now = Date.now()): void {
    const ev: ReviewEvent = { id: uuid(), cardId, rating, ts: now, durationMs, deviceId: this.deviceId };
    this.replica.applyReview(ev);
    this.reviews.push(ev);
    if (this.syncOn) { this.outR.set(ev.id, ev); this.onLocalChange?.(); }
    if (!this.firstReview.has(cardId)) this.firstReview.set(cardId, now);
    const prev = this.states.get(cardId) ?? newCardState();
    if (prev.lastReview == null || now >= prev.lastReview) this.states.set(cardId, nextState(prev, rating, now, this.params));
    else this.states.set(cardId, replay(this.replica.reviewsFor(cardId), this.params));
    this.persist();
  }

  stateOf(cardId: string): CardState { return this.states.get(cardId) ?? newCardState(); }

  rebuildStates(): void {
    const by = new Map<string, ReviewEvent[]>();
    this.firstReview.clear();
    for (const r of this.reviews) {
      let a = by.get(r.cardId);
      if (!a) by.set(r.cardId, (a = []));
      a.push(r);
    }
    this.states.clear();
    const params = this.params;
    for (const [id, rs] of by) {
      this.states.set(id, replay(rs, params));
      this.firstReview.set(id, Math.min(...rs.map((r) => r.ts)));
    }
  }

  // ---------- синхронизация (SyncHost) ----------
  /** Включить синхронизацию для аккаунта. Первый раз — вся локальная база уходит на сервер. */
  enableSync(account: string): void {
    if (this.account && this.account !== account) throw new Error(t("На этом устройстве данные уже связаны с другим аккаунтом"));
    if (!this.syncOn) { for (const c of this.changes) this.outC.set(c.id, c); for (const r of this.reviews) this.outR.set(r.id, r); }
    this.account = account; this.syncOn = true;
    this.persist();
  }
  disableSync(): void { this.syncOn = false; this.outC.clear(); this.outR.clear(); this.persist(); }
  get pendingCount(): number { return this.outC.size + this.outR.size; }
  outbox(limit: number) { return { changes: [...this.outC.values()].slice(0, limit), reviews: [...this.outR.values()].slice(0, limit) }; }
  acked(cs: string[], rs: string[]): void { cs.forEach((i) => this.outC.delete(i)); rs.forEach((i) => this.outR.delete(i)); this.persist(); }
  mergeRemote(cs: Change[], rs: ReviewEvent[]): void { this.merge(cs, rs); }
  getCursor(): Cursor { return this.cursor; }
  setCursor(c: Cursor): void { this.cursor = c; this.persist(); }

  exportJSON(): string {
    return JSON.stringify({ app: "spark", version: 1, deviceId: this.deviceId, changes: this.changes, reviews: this.reviews });
  }

  importJSON(text: string): { changes: number; reviews: number } {
    const d = JSON.parse(text);
    if ((d?.app !== "recall" && d?.app !== "spark") || !Array.isArray(d.changes) || !Array.isArray(d.reviews)) throw new Error(t("Это не файл резервной копии Spark"));
    const before = [this.changes.length, this.reviews.length];
    this.merge(d.changes, d.reviews);
    return { changes: this.changes.length - before[0]!, reviews: this.reviews.length - before[1]! };
  }

  private persist(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  dispose(): void { clearTimeout(this.timer); }

  flush(sync = false): void {
    const text = JSON.stringify({
      deviceId: this.deviceId, changes: this.changes, reviews: this.reviews,
      sync: { on: this.syncOn, account: this.account, cursor: this.cursor, outC: [...this.outC.keys()], outR: [...this.outR.keys()] },
    } satisfies Persisted);
    const fail = () => { this.saveError = true; this.onSaveError?.(); };
    try {
      if (sync) backend.saveSync(text);
      else backend.save(text).then(() => { this.saveError = false; }, fail);
    } catch { fail(); }
  }
}
