import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, HlcClock, Replica, replay, type Change, type ReviewEvent } from "../src";

/** Детерминированный ГПСЧ, чтобы fuzz-тесты воспроизводились. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const shuffle = <T,>(a: T[], r: () => number) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j]!, x[i]!]; }
  return x;
};

function mkChange(clock: HlcClock, entityId: string, field: string, value: unknown, entity: Change["entity"] = "note"): Change {
  return { id: `${clock.deviceId}-${field}-${Math.random()}`, entity, entityId, field, value, hlc: clock.tick(), deviceId: clock.deviceId };
}

describe("HLC", () => {
  it("монотонен даже при откате системных часов", () => {
    let t = 1000;
    const c = new HlcClock("a", () => t);
    const h1 = c.tick();
    t = 500;
    const h2 = c.tick();
    expect(h2 > h1).toBe(true);
  });

  it("receive продвигает часы за удалённую метку", () => {
    const fast = new HlcClock("fast", () => 10_000);
    const slow = new HlcClock("slow", () => 1_000);
    slow.receive(fast.tick());
    expect(slow.tick() > fast.tick()).toBe(true);
  });
});

describe("слияние полей (LWW на уровне поля)", () => {
  it("правки разных полей на двух устройствах сохраняются обе", () => {
    const a = new HlcClock("A", () => 1000), b = new HlcClock("B", () => 1001);
    const ca = mkChange(a, "n1", "front", "Hello");
    const cb = mkChange(b, "n1", "back", "Привет");
    const r1 = new Replica(), r2 = new Replica();
    [ca, cb].forEach((c) => r1.applyChange(c));
    [cb, ca].forEach((c) => r2.applyChange(c));
    expect(r1.get("note", "n1")).toEqual({ front: "Hello", back: "Привет" });
    expect(r2.snapshot()).toEqual(r1.snapshot());
  });

  it("одно поле: побеждает более поздняя правка", () => {
    const a = new HlcClock("A", () => 1000), b = new HlcClock("B", () => 2000);
    const r = new Replica();
    r.applyChange(mkChange(b, "n1", "front", "новое"));
    r.applyChange(mkChange(a, "n1", "front", "старое")); // пришло позже, но создано раньше
    expect(r.get("note", "n1")!.front).toBe("новое");
  });

  it("сходимость при любом порядке и дублях доставки (fuzz)", () => {
    const r0 = rng(42);
    const clocks = ["A", "B", "C"].map((d, i) => new HlcClock(d, () => 1000 + Math.floor(r0() * 50) + i));
    const changes: Change[] = [];
    for (let i = 0; i < 200; i++) {
      const c = clocks[Math.floor(r0() * 3)]!;
      changes.push(mkChange(c, `n${Math.floor(r0() * 5)}`, ["front", "back", "tags", "_deleted"][Math.floor(r0() * 4)]!, i));
    }
    const ref = new Replica();
    changes.forEach((c) => ref.applyChange(c));
    for (let s = 0; s < 20; s++) {
      const r = new Replica();
      const delivery = shuffle([...changes, ...changes.slice(0, 50)], rng(s));
      delivery.forEach((c) => r.applyChange(c));
      expect(r.snapshot()).toEqual(ref.snapshot());
    }
  });
});

describe("надгробия", () => {
  it("правка с другого устройства не воскрешает удалённое", () => {
    const a = new HlcClock("A", () => 1000), b = new HlcClock("B", () => 1000);
    const create = mkChange(a, "n1", "front", "x");
    b.receive(create.hlc);
    const del = mkChange(a, "n1", "_deleted", true);
    const edit = mkChange(b, "n1", "front", "правка в офлайне"); // B не знает об удалении
    for (const order of [[create, del, edit], [edit, del, create], [del, create, edit]]) {
      const r = new Replica();
      order.forEach((c) => r.applyChange(c));
      expect(r.get("note", "n1")).toBeUndefined();
      expect(r.isDeleted("note", "n1")).toBe(true);
    }
  });

  it("восстановление из корзины — более поздняя запись _deleted=false", () => {
    const a = new HlcClock("A", () => 1000);
    const r = new Replica();
    r.applyChange(mkChange(a, "n1", "front", "x"));
    r.applyChange(mkChange(a, "n1", "_deleted", true));
    r.applyChange(mkChange(a, "n1", "_deleted", false));
    expect(r.get("note", "n1")).toEqual({ front: "x" });
  });
});

describe("история повторений (append-only)", () => {
  const rev = (id: string, device: string, ts: number, rating: 1 | 2 | 3 | 4): ReviewEvent =>
    ({ id, cardId: "c1", rating, ts, durationMs: 3000, deviceId: device });
  const DAY = 86_400_000;
  const T = Date.UTC(2026, 0, 1);

  it("ответы с двух офлайн-устройств объединяются, ни один не теряется", () => {
    const phone = [rev("p1", "phone", T, 3), rev("p2", "phone", T + 11 * 60_000, 3), rev("p3", "phone", T + 4 * DAY, 3)];
    const pc = [rev("d1", "pc", T + 2 * DAY, 4), rev("d2", "pc", T + 6 * DAY, 1)];

    const a = new Replica(), b = new Replica();
    [...phone, ...pc].forEach((r) => a.applyReview(r));
    [...pc, ...phone].forEach((r) => b.applyReview(r));

    expect(a.reviewsFor("c1")).toHaveLength(5);
    expect(a.cardState("c1")).toEqual(b.cardState("c1"));
    expect(a.cardState("c1").reps).toBe(5);
    expect(a.cardState("c1").lapses).toBe(1);
  });

  it("повторная доставка не дублирует ответ", () => {
    const r = new Replica();
    const e = rev("x", "pc", T, 3);
    expect(r.applyReview(e)).toBe(true);
    expect(r.applyReview(e)).toBe(false);
    expect(r.reviewsFor("c1")).toHaveLength(1);
  });

  it("replay не зависит от порядка входа и дублей", () => {
    const rs = [rev("1", "a", T, 3), rev("2", "b", T + 700_000, 2), rev("3", "a", T + 3 * DAY, 3), rev("4", "b", T + 9 * DAY, 4)];
    const ref = replay(rs);
    for (let s = 0; s < 10; s++) expect(replay(shuffle([...rs, rs[0]!], rng(s)))).toEqual(ref);
  });

  it("пересчёт при смене параметров не требует миграции данных", () => {
    const rs = [rev("1", "a", T, 4), rev("2", "a", T + 16 * DAY, 3)];
    const base = replay(rs);
    const strict = replay(rs, { ...DEFAULT_PARAMS, desiredRetention: 0.95 });
    expect(strict.reps).toBe(base.reps);
    expect(strict.due).toBeLessThan(base.due);
  });
});
