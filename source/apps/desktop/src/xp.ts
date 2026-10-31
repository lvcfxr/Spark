/**
 * Опыт (XP) Spark. Считается из истории ответов, поэтому одинаков на всех устройствах и ничего не нужно хранить отдельно.
 *  • за ответ: верно — 10, «трудно» — 6, ошибка — 2 (старание тоже считается); первая встреча с карточкой +5
 *  • множитель серии правильных ответов: +10 % за каждый уровень (3, 5, 10, 15, 20, 25, 30+ → до ×1,8)
 *  • множитель серии дней: +5 % за каждый уровень созвездия (до ×1,75 на 300+ днях)
 *  • бонус за количество за день: 10 ответов +20, 25 → +50, 50 → +100, 100 → +200 (тоже с множителем дней)
 * Серия ответов обрывается ошибкой или перерывом больше 30 минут.
 */
import { dayLevel, streakLevel } from "./icons";

export interface XpReview { cardId: string; rating: number; ts: number }
export const DAILY_BONUS: [number, number][] = [[10, 20], [25, 50], [50, 100], [100, 200]];
const BREAK = 30 * 60_000, DAY_START_HOUR = 4;

function dayKey(ts: number): string {
  const d = new Date(ts - DAY_START_HOUR * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prevKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const x = new Date(y, m - 1, d - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export interface XpStats { total: number; today: number; level: number; levelFrom: number; levelTo: number; lastGain: number }
let memo: { key: string; v: XpStats } | null = null;

export function xpStats(reviews: XpReview[], now = Date.now()): XpStats {
  const key = `${reviews.length}:${reviews.length ? reviews[reviews.length - 1]!.ts : 0}:${dayKey(now)}`;
  if (memo?.key === key) return memo.v;
  const rs = [...reviews].sort((a, b) => a.ts - b.ts);
  const seen = new Set<string>(), today = dayKey(now);
  let total = 0, todayXp = 0, combo = 0, lastTs = -Infinity, day = "", dayCount = 0, streak = 0, prevDay = "", lastGain = 0;
  for (const r of rs) {
    const k = dayKey(r.ts);
    if (k !== day) { streak = prevDay && prevKey(k) === prevDay ? streak + 1 : 1; prevDay = k; day = k; dayCount = 0; }
    if (r.ts - lastTs > BREAK) combo = 0;
    lastTs = r.ts;
    combo = r.rating >= 2 ? combo + 1 : 0;
    const base = (r.rating >= 3 ? 10 : r.rating === 2 ? 6 : 2) + (seen.has(r.cardId) ? 0 : 5);
    seen.add(r.cardId);
    const dayMult = 1 + 0.05 * dayLevel(streak);
    let gain = Math.round(base * (1 + 0.1 * streakLevel(combo)) * dayMult);
    dayCount++;
    const bonus = DAILY_BONUS.find(([n]) => n === dayCount);
    if (bonus) gain += Math.round(bonus[1] * dayMult);
    total += gain; lastGain = gain;
    if (k === today) todayXp += gain;
  }
  const level = Math.floor((1 + Math.sqrt(1 + total / 12.5)) / 2);
  const v = { total, today: todayXp, level, levelFrom: 50 * level * (level - 1), levelTo: 50 * (level + 1) * level, lastGain };
  memo = { key, v };
  return v;
}
