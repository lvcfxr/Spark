import { DEFAULT_PARAMS, newCardState, nextState, type CardState, type Params, type Rating } from "./fsrs";

export type EntityType = "deck" | "note" | "card" | "preset" | "setting";

/** Изменение одного поля одной сущности. Удаление = поле "_deleted" (надгробие). */
export interface Change {
  id: string;
  entity: EntityType;
  entityId: string;
  field: string;
  value: unknown;
  hlc: string;
  deviceId: string;
}

/** Ответ на карточку. Только добавляется, никогда не меняется. */
export interface ReviewEvent {
  id: string;
  cardId: string;
  rating: Rating;
  ts: number;
  durationMs: number;
  deviceId: string;
}

interface FieldCell { value: unknown; hlc: string }

/**
 * Реплика данных на устройстве (в приложении за ней стоит SQLite).
 * apply* — идемпотентны, коммутативны и ассоциативны ⇒ любые порядок/дубли доставки
 * сходятся к одному состоянию (CRDT: LWW-регистр на поле + grow-only множество повторений).
 */
export class Replica {
  private entities = new Map<string, Map<string, FieldCell>>();
  private reviews = new Map<string, ReviewEvent>();

  private static key(entity: EntityType, id: string) { return `${entity}:${id}`; }

  /** true, если изменение что-то поменяло. */
  applyChange(c: Change): boolean {
    const k = Replica.key(c.entity, c.entityId);
    let fields = this.entities.get(k);
    if (!fields) { fields = new Map(); this.entities.set(k, fields); }
    const cur = fields.get(c.field);
    if (cur && cur.hlc >= c.hlc) return false;
    fields.set(c.field, { value: c.value, hlc: c.hlc });
    return true;
  }

  applyReview(r: ReviewEvent): boolean {
    if (this.reviews.has(r.id)) return false;
    this.reviews.set(r.id, r);
    return true;
  }

  isDeleted(entity: EntityType, id: string): boolean {
    return this.entities.get(Replica.key(entity, id))?.get("_deleted")?.value === true;
  }

  /** Текущие значения полей; undefined, если сущности нет или она удалена. */
  get(entity: EntityType, id: string): Record<string, unknown> | undefined {
    const fields = this.entities.get(Replica.key(entity, id));
    if (!fields || this.isDeleted(entity, id)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [f, cell] of fields) if (f !== "_deleted") out[f] = cell.value;
    return out;
  }

  /** Все живые (не удалённые) сущности типа entity. */
  list(entity: EntityType): { id: string; fields: Record<string, unknown> }[] {
    const prefix = entity + ":";
    const out: { id: string; fields: Record<string, unknown> }[] = [];
    for (const k of this.entities.keys()) {
      if (!k.startsWith(prefix)) continue;
      const id = k.slice(prefix.length);
      const fields = this.get(entity, id);
      if (fields) out.push({ id, fields });
    }
    return out;
  }

  /** Все поля, включая удалённые сущности — для сравнения реплик в тестах и отладки. */
  snapshot(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [k, fields] of [...this.entities].sort(([a], [b]) => (a < b ? -1 : 1))) {
      out[k] = Object.fromEntries([...fields].sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, c]) => [f, c.value]));
    }
    return out;
  }

  reviewsFor(cardId: string): ReviewEvent[] {
    return sortReviews([...this.reviews.values()].filter((r) => r.cardId === cardId));
  }

  allReviews(): ReviewEvent[] { return sortReviews([...this.reviews.values()]); }

  /** Состояние карточки — всегда пересчёт из объединённой истории. */
  cardState(cardId: string, params: Params = DEFAULT_PARAMS): CardState {
    return replay(this.reviewsFor(cardId), params);
  }
}

/** Детерминированный порядок: по времени ответа, при равенстве — по id. */
export function sortReviews(rs: ReviewEvent[]): ReviewEvent[] {
  return [...rs].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function replay(reviews: ReviewEvent[], params: Params = DEFAULT_PARAMS): CardState {
  let state = newCardState();
  const seen = new Set<string>();
  for (const r of sortReviews(reviews)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    state = nextState(state, r.rating, r.ts, params);
  }
  return state;
}
