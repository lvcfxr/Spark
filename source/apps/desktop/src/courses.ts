/**
 * Курсы Spark — расширенные наборы по уровням (отдельно от «Каталога» колод).
 * courses/courses.json — список курсов и уровней, courses/<id>.json — карточки (перевод и пояснения на ru и en),
 * courses/<id>.audio.mp3 — звук слов и примеров одним файлом.
 */
import { registerMedia, type DeckMedia } from "./catalog";

export type L2 = { ru: string; en: string };
export interface CourseUnit { id: string; title: L2; count: number }
export interface Course {
  id: string; lang: string; flag: string; natives: string[]; title: L2; level: L2; description: L2; author: string;
  words: number; minutes: number; units: CourseUnit[]; version: number; file: string; audio: boolean;
}
export interface CourseCard { id: string; unit: string; front: string; hint: string; back: L2; extra: L2 }

interface Embedded { index: { courses: Course[] } | null; media: Record<string, DeckMedia> }
declare const __COURSES__: Embedded;

const DEFAULT_REMOTE = "https://lvcfxr.github.io/Spark/courses/";
export function coursesBase(): string {
  const c = (window as unknown as { SPARK_CONFIG?: { coursesUrl?: string } }).SPARK_CONFIG;
  if (c?.coursesUrl) return c.coursesUrl.replace(/\/?$/, "/");
  return /^https?:/.test(location.protocol) ? new URL("courses/", location.href).href : DEFAULT_REMOTE;
}
export const courseMediaId = (id: string) => "course:" + id;
// звук всех курсов известен заранее — карточки, пришедшие синхронизацией, найдут свой звук
for (const [id, m] of Object.entries(__COURSES__.media ?? {})) registerMedia(courseMediaId(id), { ...m, base: coursesBase() });

let cache: Course[] | null = null;
export async function loadCourses(): Promise<Course[]> {
  if (cache) return cache;
  let list = __COURSES__.index?.courses ?? [];
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(coursesBase() + "courses.json", { cache: "no-cache", signal: ctrl.signal });
    if (r.ok) {
      const remote = ((await r.json()) as { courses: Course[] }).courses;
      const byId = new Map(list.map((c) => [c.id, c]));
      for (const c of remote) { const cur = byId.get(c.id); if (!cur || c.version >= cur.version) byId.set(c.id, c); }
      list = [...byId.values()];
    }
  } catch { /* офлайн — хватит встроенного списка */ }
  cache = list;
  return list;
}
export const embeddedCourses = (): Course[] => cache ?? __COURSES__.index?.courses ?? [];

const cardsCache = new Map<string, Promise<CourseCard[]>>();
export function loadCourseCards(c: Course): Promise<CourseCard[]> {
  let p = cardsCache.get(c.id);
  if (!p) {
    p = (async () => {
      const r = await fetch(coursesBase() + c.file, { cache: "no-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { cards: CourseCard[]; media?: DeckMedia };
      if (j.media) registerMedia(courseMediaId(c.id), { ...j.media, base: coursesBase() });
      return j.cards;
    })();
    p.catch(() => cardsCache.delete(c.id));
    cardsCache.set(c.id, p);
  }
  return p;
}
