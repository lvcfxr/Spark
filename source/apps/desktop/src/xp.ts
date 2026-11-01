/**
 * Опыт (XP) Spark. Считается из истории ответов, поэтому одинаков на всех устройствах и ничего не нужно хранить отдельно.
 *  • верно +5, «трудно» +3, ошибка −3 (штраф не смягчается сериями); первая встреча с карточкой +3
 *  • множитель серии правильных ответов: +5 % за каждый уровень серии (до ×1,4)
 *  • множитель серии дней: +3 % за каждый уровень созвездия (до ×1,45)
 *  • бонус за количество за день: 10 ответов +10, 25 → +25, 50 → +50, 100 → +100 (тоже с множителем дней)
 *  • пройден уровень курса +40, весь курс +150
 *  • уровень не понижается: штрафы не опускают ниже начала уже взятого уровня
 * Серия ответов обрывается ошибкой или перерывом больше 30 минут.
 */
import { dayLevel, streakLevel } from "./icons";

export interface XpReview { cardId: string; rating: number; ts: number }
/** cardId → уровень курса, в который входит карточка (ключ «курс:уровень», сколько в нём слов, сколько уровней в курсе). */
export type UnitMap = Map<string, { key: string; total: number; course: string; courseTotal: number }>;
export const DAILY_BONUS: [number, number][] = [[10, 10], [25, 25], [50, 50], [100, 100]];
export const XP_RULES = { good: 5, hard: 3, wrong: -3, first: 3, unit: 40, course: 150 };
const BREAK = 30 * 60_000, DAY_START_HOUR = 4;

/** Сколько всего XP нужно, чтобы достичь уровня L (уровень 1 — с нуля). */
export const xpAt = (level: number): number => (level <= 1 ? 0 : 150 * (level - 1) + 40 * (level - 1) * (level - 2));
export const levelOf = (xp: number): number => { let l = 1; while (xpAt(l + 1) <= xp) l++; return l; };

function dayKey(ts: number): string {
  const d = new Date(ts - DAY_START_HOUR * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prevKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const x = new Date(y, m - 1, d - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export interface XpStats {
  total: number; today: number; level: number; levelFrom: number; levelTo: number; lastGain: number;
  /** XP по учебным дням (для графика) и по числу ответов */
  byDay: Map<string, number>; bestDay: number; units: number; courses: number;
}
let memo: { key: string; v: XpStats } | null = null;

export function xpStats(reviews: XpReview[], now = Date.now(), units?: UnitMap): XpStats {
  const key = `${reviews.length}:${reviews.length ? reviews[reviews.length - 1]!.ts : 0}:${dayKey(now)}:${units?.size ?? 0}`;
  if (memo?.key === key) return memo.v;
  const rs = [...reviews].sort((a, b) => a.ts - b.ts);
  const seen = new Set<string>(), today = dayKey(now), byDay = new Map<string, number>();
  const unitSeen = new Map<string, Set<string>>(), unitDone = new Set<string>(), courseUnits = new Map<string, number>(), courseDone = new Set<string>();
  let total = 0, floor = 0, combo = 0, lastTs = -Infinity, day = "", dayCount = 0, streak = 0, prevDay = "", lastGain = 0, level = 1, doneUnits = 0, doneCourses = 0;
  for (const r of rs) {
    const k = dayKey(r.ts);
    if (k !== day) { streak = prevDay && prevKey(k) === prevDay ? streak + 1 : 1; prevDay = k; day = k; dayCount = 0; }
    if (r.ts - lastTs > BREAK) combo = 0;
    lastTs = r.ts;
    const dayMult = 1 + 0.03 * dayLevel(streak);
    let gain: number;
    if (r.rating >= 2) {
      combo++;
      const base = (r.rating >= 3 ? XP_RULES.good : XP_RULES.hard) + (seen.has(r.cardId) ? 0 : XP_RULES.first);
      gain = Math.round(base * (1 + 0.05 * streakLevel(combo)) * dayMult);
    } else { combo = 0; gain = XP_RULES.wrong; }
    seen.add(r.cardId);
    dayCount++;
    const bonus = DAILY_BONUS.find(([n]) => n === dayCount);
    if (bonus) gain += Math.round(bonus[1] * dayMult);
    const u = units?.get(r.cardId);
    if (u && r.rating >= 2) {
      const set = unitSeen.get(u.key) ?? new Set<string>(); set.add(r.cardId); unitSeen.set(u.key, set);
      if (set.size >= u.total && !unitDone.has(u.key)) {
        unitDone.add(u.key); doneUnits++; gain += XP_RULES.unit;
        const n = (courseUnits.get(u.course) ?? 0) + 1; courseUnits.set(u.course, n);
        if (n >= u.courseTotal && !courseDone.has(u.course)) { courseDone.add(u.course); doneCourses++; gain += XP_RULES.course; }
      }
    }
    total = Math.max(floor, total + gain);
    lastGain = gain;
    level = Math.max(level, levelOf(total)); floor = xpAt(level);
    byDay.set(k, (byDay.get(k) ?? 0) + gain);
  }
  const todayXp = byDay.get(today) ?? 0;
  const v: XpStats = { total, today: todayXp, level, levelFrom: xpAt(level), levelTo: xpAt(level + 1), lastGain, byDay, bestDay: Math.max(0, ...byDay.values()), units: doneUnits, courses: doneCourses };
  memo = { key, v };
  return v;
}

// ---------- награды за уровни ----------
export type L2 = { ru: string; en: string };
export const TITLES: [number, L2][] = [
  [1, { ru: "Новичок", en: "Newcomer" }], [3, { ru: "Ученик", en: "Learner" }], [5, { ru: "Исследователь", en: "Explorer" }], [8, { ru: "Знаток слов", en: "Word Wizard" }],
  [12, { ru: "Полиглот", en: "Polyglot" }], [16, { ru: "Мастер памяти", en: "Memory Master" }], [20, { ru: "Хранитель созвездий", en: "Star Keeper" }],
  [25, { ru: "Лингвист", en: "Linguist" }], [30, { ru: "Легенда Spark", en: "Spark Legend" }],
];
export const titleOf = (level: number): L2 => [...TITLES].reverse().find(([l]) => level >= l)![1];

export interface Theme { id: string; level: number; name: L2; css: string; accent: string }
/** Оформления: цвет акцента и шапка главной вместе (поэтому не бывает «красная тема и фиолетовая шапка»). Открываются с уровнем; «Мой цвет» — по выбранному акценту. */
export const THEMES: Theme[] = [
  { id: "night", level: 1, name: { ru: "Классика", en: "Classic" }, css: "", accent: "" },
  { id: "ocean", level: 3, name: { ru: "Океан", en: "Ocean" }, css: "radial-gradient(120% 80% at 50% 0%, #67e8f9 0%, transparent 60%), linear-gradient(165deg, #0ea5e9 0%, #1d4ed8 52%, #172554 100%)", accent: "#0ea5e9" },
  { id: "dawn", level: 5, name: { ru: "Рассвет", en: "Dawn" }, css: "radial-gradient(120% 80% at 50% 0%, #fde68a 0%, transparent 60%), linear-gradient(165deg, #f472b6 0%, #c026d3 50%, #4c1d95 100%)", accent: "#db2777" },
  { id: "forest", level: 8, name: { ru: "Лес", en: "Forest" }, css: "radial-gradient(120% 80% at 50% 0%, #86efac 0%, transparent 60%), linear-gradient(165deg, #16a34a 0%, #047857 52%, #052e2b 100%)", accent: "#16a34a" },
  { id: "sunset", level: 12, name: { ru: "Закат", en: "Sunset" }, css: "radial-gradient(120% 80% at 50% 0%, #fdba74 0%, transparent 60%), linear-gradient(165deg, #f97316 0%, #db2777 52%, #3b0764 100%)", accent: "#f97316" },
  { id: "aurora", level: 16, name: { ru: "Аврора", en: "Aurora" }, css: "radial-gradient(90% 60% at 20% 0%, #34d399 0%, transparent 60%), radial-gradient(90% 60% at 90% 20%, #a78bfa 0%, transparent 60%), linear-gradient(165deg, #0f766e 0%, #1e1b4b 100%)", accent: "#0d9488" },
  { id: "gold", level: 20, name: { ru: "Золото", en: "Gold" }, css: "radial-gradient(120% 80% at 50% 0%, #fef3c7 0%, transparent 60%), linear-gradient(165deg, #f59e0b 0%, #b45309 52%, #451a03 100%)", accent: "#d97706" },
  { id: "galaxy", level: 25, name: { ru: "Галактика", en: "Galaxy" }, css: "radial-gradient(70% 50% at 25% 10%, #f0abfc 0%, transparent 60%), radial-gradient(70% 50% at 85% 30%, #67e8f9 0%, transparent 60%), linear-gradient(165deg, #3b0764 0%, #0b0718 100%)", accent: "#a855f7" },
];
export const themeById = (id: string | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]!;

/** Все «значимые» уровни с наградами (для списка в окне уровня). */
export function rewardsList(): { level: number; kind: "title" | "theme"; ru: string; en: string }[] {
  const out: { level: number; kind: "title" | "theme"; ru: string; en: string }[] = [];
  for (const [l, t] of TITLES) if (l > 1) out.push({ level: l, kind: "title", ru: `Звание «${t.ru}»`, en: `Title “${t.en}”` });
  for (const th of THEMES) if (th.level > 1) out.push({ level: th.level, kind: "theme", ru: `Тема главной «${th.name.ru}»`, en: `Home theme “${th.name.en}”` });
  return out.sort((a, b) => a.level - b.level);
}
