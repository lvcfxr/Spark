import { describe, expect, it } from "vitest";
import { DAY_MS, DEFAULT_PARAMS, autoGrade, baselineThinkMs, newCardState, nextState, DEFAULT_BASELINE_MS } from "../src";

const B = 6000;

describe("умная оценка по времени", () => {
  it("быстро → Easy, обычно → Good, с раздумьем → Hard, долго → Again", () => {
    expect(autoGrade({ thinkMs: 1500, baselineMs: B }).rating).toBe(4);
    expect(autoGrade({ thinkMs: 5000, baselineMs: B }).rating).toBe(3);
    expect(autoGrade({ thinkMs: 10_000, baselineMs: B }).rating).toBe(2);
    expect(autoGrade({ thinkMs: 20_000, baselineMs: B }).rating).toBe(1);
  });

  it("ошибка при вводе — всегда Again, как бы быстро ни ответили", () => {
    expect(autoGrade({ thinkMs: 500, baselineMs: B, typed: true, correct: false })).toEqual({ rating: 1, speed: "wrong" });
  });

  it("при вводе время набора входит в норму: длинное слово не штрафуется", () => {
    const short = autoGrade({ thinkMs: 9000, baselineMs: B, typed: true, correct: true, chars: 3 }).rating;
    const long = autoGrade({ thinkMs: 9000, baselineMs: B, typed: true, correct: true, chars: 20 }).rating;
    expect(long).toBeGreaterThan(short);
  });

  it("новая карточка: Easy урезается до Good", () => {
    expect(autoGrade({ thinkMs: 800, baselineMs: B, learning: true }).rating).toBe(3);
  });

  it("личная норма — медиана; пока мало данных, берётся значение по умолчанию", () => {
    expect(baselineThinkMs([3000, 4000])).toBe(DEFAULT_BASELINE_MS);
    expect(baselineThinkMs(Array(20).fill(3000))).toBe(3000);
    expect(baselineThinkMs(Array(20).fill(100_000))).toBe(20_000); // верхняя граница
    expect(baselineThinkMs(Array(20).fill(1000))).toBe(2000);      // нижняя граница
  });

  it("итог для пользователя: долго думал → через 5 минут, быстро → через дни", () => {
    const p = { ...DEFAULT_PARAMS, learningSteps: [5], relearningSteps: [5] };
    const T0 = Date.UTC(2026, 0, 1);
    // выучена: первый ответ Good → сразу в review
    let s = nextState(newCardState(), 3, T0, p);
    expect(s.phase).toBe("review");
    // спустя срок: быстро вспомнил
    const t1 = s.due;
    const fast = nextState(s, autoGrade({ thinkMs: 1200, baselineMs: B }).rating, t1, p);
    expect(fast.due - t1).toBeGreaterThanOrEqual(DAY_MS);
    // спустя срок: очень долго вспоминал
    const slow = nextState(s, autoGrade({ thinkMs: 30_000, baselineMs: B }).rating, t1, p);
    expect(slow.phase).toBe("relearning");
    expect(slow.due - t1).toBe(5 * 60_000);
  });
});
