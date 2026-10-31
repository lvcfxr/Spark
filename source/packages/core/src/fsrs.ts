/**
 * Планировщик FSRS-5 (чистые функции, без побочных эффектов) + шаги изучения.
 * Состояние карточки — производная от истории повторений (см. replay.ts).
 *
 * Упрощения MVP (см. ARCHITECTURE.md): без fuzz, интервалы считаются от момента ответа
 * (граница учебного дня — в v1.0).
 */
export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export type Phase = "new" | "learning" | "review" | "relearning";

export const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

export const DEFAULT_W: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

export interface Params {
  w: readonly number[];
  desiredRetention: number;      // 0.7 … 0.97
  learningSteps: number[];       // минуты
  relearningSteps: number[];     // минуты
  maximumIntervalDays: number;
}

export const DEFAULT_PARAMS: Params = {
  w: DEFAULT_W,
  desiredRetention: 0.9,
  learningSteps: [1, 10],
  relearningSteps: [10],
  maximumIntervalDays: 36_500,
};

export interface CardState {
  phase: Phase;
  step: number;                  // индекс шага в learning/relearning
  stability: number;             // дни
  difficulty: number;            // 1…10
  due: number;                   // ms epoch
  lastReview: number | null;
  reps: number;
  lapses: number;
}

export const newCardState = (now = 0): CardState => ({
  phase: "new", step: 0, stability: 0, difficulty: 0, due: now, lastReview: null, reps: 0, lapses: 0,
});

const DECAY = -0.5;
const FACTOR = 19 / 81;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

export const retrievability = (elapsedDays: number, s: number) =>
  Math.pow(1 + (FACTOR * elapsedDays) / s, DECAY);

export const intervalForRetention = (r: number, s: number) =>
  (s / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);

const initStability = (w: readonly number[], g: Rating) => Math.max(w[g - 1]!, 0.1);
const initDifficulty = (w: readonly number[], g: number) =>
  clamp(w[4]! - Math.exp(w[5]! * (g - 1)) + 1, 1, 10);

function nextDifficulty(w: readonly number[], d: number, g: Rating): number {
  const delta = -w[6]! * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(w[7]! * initDifficulty(w, 4) + (1 - w[7]!) * damped, 1, 10);
}

function stabilityAfterRecall(w: readonly number[], d: number, s: number, r: number, g: Rating): number {
  const hard = g === 2 ? w[15]! : 1;
  const easy = g === 4 ? w[16]! : 1;
  return s * (1 + Math.exp(w[8]!) * (11 - d) * Math.pow(s, -w[9]!) * (Math.exp((1 - r) * w[10]!) - 1) * hard * easy);
}

function stabilityAfterLapse(w: readonly number[], d: number, s: number, r: number): number {
  const sf = w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp((1 - r) * w[14]!);
  return Math.min(sf, s);
}

function stabilityShortTerm(w: readonly number[], s: number, g: Rating): number {
  const next = s * Math.exp(w[17]! * (g - 3 + w[18]!));
  return g >= 2 ? Math.max(next, s) : next;
}

const toDays = (p: Params, s: number) =>
  clamp(Math.round(intervalForRetention(p.desiredRetention, s)), 1, p.maximumIntervalDays);

/** Hard < Good < Easy гарантированно различаются как минимум на день. */
function orderedIntervals(p: Params, sHard: number, sGood: number, sEasy: number) {
  const hard0 = toDays(p, sHard), good0 = toDays(p, sGood), easy0 = toDays(p, sEasy);
  const hard = Math.min(hard0, good0);
  const good = Math.max(good0, hard + 1);
  const easy = Math.max(easy0, good + 1);
  return { hard, good, easy };
}

function graduate(prev: CardState, now: number, s: number, d: number, p: Params, lapses = prev.lapses): CardState {
  return { phase: "review", step: 0, stability: s, difficulty: d, due: now + toDays(p, s) * DAY_MS,
    lastReview: now, reps: prev.reps + 1, lapses };
}

/** Шаги learning / relearning. Возвращает null, если карточка выпускается в review. */
function stepTransition(steps: number[], step: number, g: Rating): { step: number; delayMin: number } | null {
  if (steps.length === 0 || g === 4) return g === 1 && steps.length ? { step: 0, delayMin: steps[0]! } : null;
  if (g === 1) return { step: 0, delayMin: steps[0]! };
  if (g === 2) return { step, delayMin: steps[Math.min(step, steps.length - 1)]! };
  return step + 1 >= steps.length ? null : { step: step + 1, delayMin: steps[step + 1]! };
}

export function nextState(prev: CardState, g: Rating, now: number, p: Params = DEFAULT_PARAMS): CardState {
  const w = p.w;
  const elapsedDays = prev.lastReview == null ? 0 : Math.max(0, (now - prev.lastReview) / DAY_MS);

  switch (prev.phase) {
    case "new": {
      const s = initStability(w, g), d = initDifficulty(w, g);
      const t = stepTransition(p.learningSteps, 0, g);
      if (!t) return graduate(prev, now, s, d, p);
      return { phase: "learning", step: t.step, stability: s, difficulty: d, due: now + t.delayMin * MIN_MS,
        lastReview: now, reps: prev.reps + 1, lapses: prev.lapses };
    }
    case "learning": {
      const s = stabilityShortTerm(w, prev.stability, g), d = nextDifficulty(w, prev.difficulty, g);
      const t = stepTransition(p.learningSteps, prev.step, g);
      if (!t) return graduate(prev, now, s, d, p);
      return { ...prev, step: t.step, stability: s, difficulty: d, due: now + t.delayMin * MIN_MS,
        lastReview: now, reps: prev.reps + 1 };
    }
    case "relearning": {
      const t = stepTransition(p.relearningSteps, prev.step, g);
      if (!t) return graduate(prev, now, prev.stability, prev.difficulty, p);
      return { ...prev, step: t.step, due: now + t.delayMin * MIN_MS, lastReview: now, reps: prev.reps + 1 };
    }
    case "review": {
      const d = nextDifficulty(w, prev.difficulty, g);
      if (elapsedDays < 1) { // повтор в тот же день — краткосрочная формула
        return graduate(prev, now, stabilityShortTerm(w, prev.stability, g), d, p);
      }
      const r = retrievability(elapsedDays, prev.stability);
      if (g === 1) {
        const s = stabilityAfterLapse(w, prev.difficulty, prev.stability, r);
        const lapses = prev.lapses + 1;
        if (p.relearningSteps.length === 0) return graduate(prev, now, s, d, p, lapses);
        return { phase: "relearning", step: 0, stability: s, difficulty: d,
          due: now + p.relearningSteps[0]! * MIN_MS, lastReview: now, reps: prev.reps + 1, lapses };
      }
      const sH = stabilityAfterRecall(w, prev.difficulty, prev.stability, r, 2);
      const sG = stabilityAfterRecall(w, prev.difficulty, prev.stability, r, 3);
      const sE = stabilityAfterRecall(w, prev.difficulty, prev.stability, r, 4);
      const iv = orderedIntervals(p, sH, sG, sE);
      const [s, days] = g === 2 ? [sH, iv.hard] : g === 3 ? [sG, iv.good] : [sE, iv.easy];
      return { phase: "review", step: 0, stability: s, difficulty: d, due: now + days * DAY_MS,
        lastReview: now, reps: prev.reps + 1, lapses: prev.lapses };
    }
  }
}

/** Для подписей на кнопках оценки: через сколько карточка вернётся при каждом ответе. */
export function previewIntervals(prev: CardState, now: number, p: Params = DEFAULT_PARAMS): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const g of [1, 2, 3, 4] as Rating[]) out[g] = nextState(prev, g, now, p).due - now;
  return out;
}
