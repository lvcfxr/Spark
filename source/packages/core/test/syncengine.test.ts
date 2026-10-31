import { describe, expect, it } from "vitest";
import {
  HlcClock, Replica, syncOnce,
  type Change, type Cursor, type PullResult, type ReviewEvent, type SyncHost, type SyncTransport,
} from "../src";

/** Сервер-журнал в памяти: тот же контракт, что у таблиц Supabase (уникальность по id, seq по порядку прихода). */
class FakeServer {
  changes: (Change & { seq: number })[] = [];
  reviews: (ReviewEvent & { seq: number })[] = [];
  pageSize = 1000;
  failNextPush = false;
  transport(): SyncTransport {
    return {
      push: async (cs, rs) => {
        if (this.failNextPush) { this.failNextPush = false; throw new Error("offline"); }
        for (const c of cs) if (!this.changes.some((x) => x.id === c.id)) this.changes.push({ ...c, seq: this.changes.length + 1 });
        for (const r of rs) if (!this.reviews.some((x) => x.id === r.id)) this.reviews.push({ ...r, seq: this.reviews.length + 1 });
      },
      pull: async (cur: Cursor): Promise<PullResult> => {
        const cs = this.changes.filter((c) => c.seq > cur.changes).slice(0, this.pageSize);
        const rs = this.reviews.filter((r) => r.seq > cur.reviews).slice(0, this.pageSize);
        const cursor = { changes: cs.length ? cs[cs.length - 1]!.seq : cur.changes, reviews: rs.length ? rs[rs.length - 1]!.seq : cur.reviews };
        const more = cursor.changes < this.changes.length || cursor.reviews < this.reviews.length;
        return { changes: cs.map(({ seq: _s, ...c }) => c), reviews: rs.map(({ seq: _s, ...r }) => r), cursor, more };
      },
    };
  }
}

class Device implements SyncHost {
  replica = new Replica();
  clock: HlcClock;
  outC = new Map<string, Change>();
  outR = new Map<string, ReviewEvent>();
  cursor: Cursor = { changes: 0, reviews: 0 };
  private n = 0;
  constructor(readonly id: string, now: () => number) { this.clock = new HlcClock(id, now); }
  edit(entityId: string, field: string, value: unknown, entity: Change["entity"] = "card") {
    const c: Change = { id: `${this.id}-c${this.n++}`, entity, entityId, field, value, hlc: this.clock.tick(), deviceId: this.id };
    this.replica.applyChange(c); this.outC.set(c.id, c);
  }
  review(cardId: string, ts: number, rating: 1 | 2 | 3 | 4 = 3) {
    const r: ReviewEvent = { id: `${this.id}-r${this.n++}`, cardId, rating, ts, durationMs: 1000, deviceId: this.id };
    this.replica.applyReview(r); this.outR.set(r.id, r);
  }
  outbox(limit: number) { return { changes: [...this.outC.values()].slice(0, limit), reviews: [...this.outR.values()].slice(0, limit) }; }
  acked(cs: string[], rs: string[]) { cs.forEach((i) => this.outC.delete(i)); rs.forEach((i) => this.outR.delete(i)); }
  mergeRemote(cs: Change[], rs: ReviewEvent[]) { cs.forEach((c) => { this.clock.receive(c.hlc); this.replica.applyChange(c); }); rs.forEach((r) => this.replica.applyReview(r)); }
  getCursor() { return this.cursor; }
  setCursor(c: Cursor) { this.cursor = c; }
  cardStateKey() { return JSON.stringify(this.replica.cardState("c1")); }
  sync(s: FakeServer) { return syncOnce(this, s.transport()); }
}

const T = Date.UTC(2026, 0, 1);

describe("синхронизация устройств", () => {
  it("изменение с ПК появляется на втором устройстве", async () => {
    const s = new FakeServer(), pc = new Device("pc", () => 1000), tg = new Device("tg", () => 1000);
    pc.edit("c1", "front", "hola"); pc.edit("c1", "back", "привет");
    expect(await pc.sync(s)).toEqual({ pushed: 2, pulled: 2 });
    await tg.sync(s);
    expect(tg.replica.get("card", "c1")).toEqual({ front: "hola", back: "привет" });
  });

  it("офлайн-правки разных полей и повторения с двух устройств сходятся без потерь", async () => {
    const s = new FakeServer(), pc = new Device("pc", () => 1000), tg = new Device("tg", () => 1005);
    pc.edit("c1", "front", "a"); await pc.sync(s); await tg.sync(s);
    pc.edit("c1", "front", "a2"); pc.review("c1", T);
    tg.edit("c1", "back", "b2"); tg.review("c1", T + 86_400_000); tg.review("c1", T + 2 * 86_400_000, 1);
    await pc.sync(s); await tg.sync(s); await pc.sync(s);
    expect(pc.replica.snapshot()).toEqual(tg.replica.snapshot());
    expect(pc.replica.get("card", "c1")).toEqual({ front: "a2", back: "b2" });
    expect(pc.replica.reviewsFor("c1")).toHaveLength(3);
    expect(tg.cardStateKey()).toBe(pc.cardStateKey());
  });

  it("удаление на одном устройстве не воскресает правкой с другого", async () => {
    const s = new FakeServer(), pc = new Device("pc", () => 1000), tg = new Device("tg", () => 1000);
    pc.edit("c1", "front", "x"); await pc.sync(s); await tg.sync(s);
    pc.edit("c1", "_deleted", true); tg.edit("c1", "front", "правка в офлайне");
    await tg.sync(s); await pc.sync(s); await tg.sync(s);
    expect(pc.replica.get("card", "c1")).toBeUndefined();
    expect(tg.replica.get("card", "c1")).toBeUndefined();
  });

  it("сбой сети: outbox сохраняется и уходит при следующей попытке; повтор безопасен", async () => {
    const s = new FakeServer(), pc = new Device("pc", () => 1000);
    pc.edit("c1", "front", "x"); pc.review("c1", T);
    s.failNextPush = true;
    await expect(pc.sync(s)).rejects.toThrow("offline");
    expect(pc.outC.size + pc.outR.size).toBe(2);
    await pc.sync(s); await pc.sync(s);
    expect(s.changes).toHaveLength(1); expect(s.reviews).toHaveLength(1);
    expect(pc.outC.size + pc.outR.size).toBe(0);
  });

  it("пагинация: большой журнал забирается по страницам", async () => {
    const s = new FakeServer(); s.pageSize = 7;
    const pc = new Device("pc", () => 1000), tg = new Device("tg", () => 1000);
    for (let i = 0; i < 40; i++) pc.edit(`c${i}`, "front", `w${i}`);
    for (let i = 0; i < 25; i++) pc.review(`c${i}`, T + i * 1000);
    await pc.sync(s); const st = await tg.sync(s);
    expect(st.pulled).toBe(65);
    expect(tg.replica.list("card")).toHaveLength(40);
    expect(tg.replica.allReviews()).toHaveLength(25);
    expect((await tg.sync(s)).pulled).toBe(0); // курсор продвинулся — повтор ничего не качает
  });

  it("порядок синхронизаций не влияет на итог (fuzz)", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      let x = seed;
      const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      const s = new FakeServer(), devs = [new Device("a", () => 1000 + Math.floor(rnd() * 20)), new Device("b", () => 1000 + Math.floor(rnd() * 20)), new Device("c", () => 1000)];
      for (let step = 0; step < 60; step++) {
        const d = devs[Math.floor(rnd() * 3)]!, r = rnd();
        if (r < 0.5) d.edit(`k${Math.floor(rnd() * 4)}`, ["front", "back", "tags", "_deleted"][Math.floor(rnd() * 4)]!, step);
        else if (r < 0.75) d.review(`k${Math.floor(rnd() * 4)}`, T + step * 60_000, (1 + Math.floor(rnd() * 4)) as 1 | 2 | 3 | 4);
        else await d.sync(s);
      }
      for (let round = 0; round < 2; round++) for (const d of devs) await d.sync(s);
      const ref = devs[0]!.replica.snapshot();
      for (const d of devs) { expect(d.replica.snapshot()).toEqual(ref); expect(d.replica.allReviews()).toEqual(devs[0]!.replica.allReviews()); }
    }
  });
});
