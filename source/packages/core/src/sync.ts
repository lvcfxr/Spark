import type { Change, ReviewEvent } from "./replica";

/**
 * Движок синхронизации. Сервер — «тупой» журнал: хранит изменения и повторения в порядке прихода
 * (seq) и отдаёт всё, что новее курсора клиента. Конфликты решает клиент (LWW по HLC, append-only повторения),
 * поэтому порядок и дубли доставки не важны.
 */
export interface Cursor { changes: number; reviews: number }

export interface PullResult {
  changes: Change[];
  reviews: ReviewEvent[];
  cursor: Cursor;
  /** есть ещё данные — нужно запросить следующую страницу */
  more: boolean;
}

export interface SyncTransport {
  push(changes: Change[], reviews: ReviewEvent[]): Promise<void>;
  pull(cursor: Cursor): Promise<PullResult>;
}

export interface SyncHost {
  /** Локальные записи, ещё не подтверждённые сервером. */
  outbox(limit: number): { changes: Change[]; reviews: ReviewEvent[] };
  /** Сервер принял эти записи. */
  acked(changeIds: string[], reviewIds: string[]): void;
  /** Слить чужие записи в локальную реплику (не попадают в outbox). */
  mergeRemote(changes: Change[], reviews: ReviewEvent[]): void;
  getCursor(): Cursor;
  setCursor(c: Cursor): void;
}

export interface SyncStats { pushed: number; pulled: number }

const BATCH = 500;
const MAX_PAGES = 200;

export async function syncOnce(host: SyncHost, transport: SyncTransport): Promise<SyncStats> {
  let pushed = 0, pulled = 0;

  // 1. отправить локальное (порциями; после успеха порция уходит из outbox)
  for (;;) {
    const { changes, reviews } = host.outbox(BATCH);
    if (!changes.length && !reviews.length) break;
    await transport.push(changes, reviews);
    host.acked(changes.map((c) => c.id), reviews.map((r) => r.id));
    pushed += changes.length + reviews.length;
  }

  // 2. забрать новое с сервера
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await transport.pull(host.getCursor());
    if (res.changes.length || res.reviews.length) host.mergeRemote(res.changes, res.reviews);
    pulled += res.changes.length + res.reviews.length;
    host.setCursor(res.cursor);
    if (!res.more) break;
  }
  return { pushed, pulled };
}
