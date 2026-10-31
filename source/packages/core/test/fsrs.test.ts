import { describe, expect, it } from "vitest";
import {
  DAY_MS, DEFAULT_PARAMS, DEFAULT_W, intervalForRetention, newCardState, nextState,
  previewIntervals, retrievability, type Rating,
} from "../src";

const T0 = Date.UTC(2026, 0, 1);

describe("FSRS", () => {
  it("R(S, S) = 0.9 и интервал при retention 0.9 равен стабильности", () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 6);
    expect(intervalForRetention(0.9, 10)).toBeCloseTo(10, 6);
  });

  it("новая карточка: Easy сразу уходит в review со стабильностью w[3]", () => {
    const s = nextState(newCardState(), 4, T0);
    expect(s.phase).toBe("review");
    expect(s.stability).toBeCloseTo(DEFAULT_W[3]!, 6);
    expect(Math.round((s.due - T0) / DAY_MS)).toBe(16);
  });

  it("новая карточка: Good идёт по шагам 1м → 10м → review", () => {
    let s = nextState(newCardState(), 3, T0);
    expect(s.phase).toBe("learning");
    expect(s.due - T0).toBe(10 * 60_000);
    s = nextState(s, 3, s.due);
    expect(s.phase).toBe("review");
    expect(s.due).toBeGreaterThan(s.lastReview! + DAY_MS - 1);
  });

  it("Again в learning возвращает на первый шаг", () => {
    let s = nextState(newCardState(), 3, T0);
    s = nextState(s, 1, s.due);
    expect(s.phase).toBe("learning");
    expect(s.step).toBe(0);
  });

  it("провал в review: lapse, relearning, стабильность не растёт", () => {
    let s = nextState(newCardState(), 4, T0);
    const before = s.stability;
    s = nextState(s, 1, s.due);
    expect(s.phase).toBe("relearning");
    expect(s.lapses).toBe(1);
    expect(s.stability).toBeLessThanOrEqual(before);
  });

  it("интервалы Hard < Good < Easy в review", () => {
    const s = nextState(newCardState(), 4, T0);
    const p = previewIntervals(s, s.due);
    expect(p[2]).toBeLessThan(p[3]);
    expect(p[3]).toBeLessThan(p[4]);
    expect(p[1]).toBeLessThan(p[2]); // relearning-шаг короче любого дня
  });

  it("выше desiredRetention — короче интервалы", () => {
    const s = nextState(newCardState(), 4, T0);
    const hi = { ...DEFAULT_PARAMS, desiredRetention: 0.95 };
    const lo = { ...DEFAULT_PARAMS, desiredRetention: 0.8 };
    const a = nextState(s, 3, s.due, hi).due - s.due;
    const b = nextState(s, 3, s.due, lo).due - s.due;
    expect(a).toBeLessThan(b);
  });

  it("серия Good растит стабильность монотонно", () => {
    let s = nextState(newCardState(), 4, T0);
    let prev = s.stability;
    for (let i = 0; i < 6; i++) {
      s = nextState(s, 3 as Rating, s.due);
      expect(s.stability).toBeGreaterThan(prev);
      prev = s.stability;
    }
  });
});
