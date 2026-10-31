import type { Rating } from "./fsrs";

/**
 * Умная оценка: вместо четырёх кнопок сложность определяется по времени раздумья
 * относительно личной нормы пользователя. Медленно → вернуть через минуты, быстро → через дни.
 */
export type Speed = "fast" | "normal" | "slow" | "veryslow" | "wrong";

export const DEFAULT_BASELINE_MS = 6000;
const MIN_SAMPLES = 15;
const MAX_THINK_MS = 120_000;

/** Личная норма: медиана времени раздумья по последним успешным ответам. */
export function baselineThinkMs(durationsMs: number[]): number {
  const xs = durationsMs.filter((d) => d > 300).map((d) => Math.min(d, MAX_THINK_MS)).slice(-200);
  if (xs.length < MIN_SAMPLES) return DEFAULT_BASELINE_MS;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const med = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.min(Math.max(med, 2000), 20_000);
}

export interface AutoGradeInput {
  thinkMs: number;
  baselineMs: number;
  /** ответ вводился с клавиатуры (время на набор учитывается в норме) */
  typed?: boolean;
  chars?: number;
  /** для typed: верно ли введено */
  correct?: boolean;
  /** карточка новая или в шагах изучения: «Легко» урезается до «Хорошо» */
  learning?: boolean;
}

export function expectedMs(baselineMs: number, typed = false, chars = 0): number {
  return baselineMs + (typed ? 300 * chars : 0);
}

export function speedOf(thinkMs: number, expected: number): Exclude<Speed, "wrong"> {
  const r = Math.min(thinkMs, MAX_THINK_MS) / expected;
  return r < 0.5 ? "fast" : r < 1.3 ? "normal" : r < 2.2 ? "slow" : "veryslow";
}

export function autoGrade(i: AutoGradeInput): { rating: Rating; speed: Speed } {
  if (i.typed && i.correct === false) return { rating: 1, speed: "wrong" };
  const speed = speedOf(i.thinkMs, expectedMs(i.baselineMs, i.typed, i.chars ?? 0));
  let rating: Rating = speed === "fast" ? 4 : speed === "normal" ? 3 : speed === "slow" ? 2 : 1;
  if (i.learning && rating === 4) rating = 3;
  return { rating, speed };
}
