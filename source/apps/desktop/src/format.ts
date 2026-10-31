import { t } from "./i18n";
import { ic } from "./icons";
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/!\[\]\(media:([0-9a-f]{16,64})\)/g, '<img class="mimg" data-media="$1" alt="">')
    .replace(/\[audio\]\(media:([0-9a-f]{16,64})\)/g, `<button class="snd" data-a="play" data-media="$1">${ic("sound")}</button>`)
    .replace(/\[video\]\(media:([0-9a-f]{16,64})\)/g, '<video class="mvid" controls playsinline preload="metadata" data-media="$1"></video>')
    .replace(/!\[\]\(file:[^)]*\)|\[(?:audio|video)\]\(file:[^)]*\)/g, "");
}

/**
 * Лёгкая разметка карточки:
 *   # Текст   — мелкий подзаголовок (капсом, серым)
 *   > Текст   — вставка (врезка с цветной полосой)
 *   **жирный**, *курсив*, `код`, ==выделение==, ~~зачёркнутый~~
 */
export function fmt(src: string): string {
  const out: string[] = [];
  const lines = src.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.*)$/.exec(line))) out.push(`<div class="sub">${inline(m[1]!)}</div>`);
    else if (/^>\s?/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) block.push(inline(lines[i]!.replace(/^>\s?/, ""))), i++;
      i--;
      out.push(`<div class="inset">${block.join("<br>")}</div>`);
    } else out.push(line.trim() === "" ? `<div class="gap"></div>` : `<div>${inline(line)}</div>`);
  }
  return out.join("");
}

export function fmtDur(ms: number): string {
  const m = ms / 60000;
  if (m < 1) return t("<1 мин");
  if (m < 60) return t("{n} мин", { n: Math.round(m) });
  const h = m / 60;
  if (h < 24) return t("{n} ч", { n: Math.round(h) });
  const d = h / 24;
  if (d < 30) return t("{n} дн", { n: Math.round(d) });
  if (d < 365) return t("{n} мес", { n: (d / 30).toFixed(1).replace(/\.0$/, "") });
  return t("{n} г", { n: (d / 365).toFixed(1).replace(/\.0$/, "") });
}

// ---------- cloze ----------
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(CLOZE)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}
export function clozeFace(text: string, n: number): { q: string; a: string; answers: string[] } {
  const answers: string[] = [];
  const q = text.replace(CLOZE, (_m, k: string, ans: string, hint?: string) => {
    if (Number(k) === n) { answers.push(ans); return `==[${hint || "…"}]==`; }
    return ans;
  });
  const a = text.replace(CLOZE, (_m, k: string, ans: string) => (Number(k) === n ? `**${ans}**` : ans));
  return { q, a, answers };
}

// ---------- проверка ввода ----------
export const norm = (t: string) =>
  t.replace(/\*\*|`|==/g, "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,!?¡¿;:]+$/g, "");

/** Допустимые варианты ответа: вся обратная сторона и её части через «/», «;» или перенос строки. */
/** Убрать из текста ссылки на медиа (для списков и проверки ввода). */
export const stripMedia = (s: string, img = "", snd = "", vid = img) => s.replace(/!\[\]\((?:media|file):[^)]*\)/g, img).replace(/\[audio\]\((?:media|file):[^)]*\)/g, snd).replace(/\[video\]\((?:media|file):[^)]*\)/g, vid);
/** Медиа внутри текста поля: тип и ключ (для списка вложений в редакторе). */
export function mediaRefs(s: string): { kind: "image" | "audio" | "video"; key: string; raw: string }[] {
  return [...s.matchAll(/(!\[\]|\[audio\]|\[video\])\(media:([0-9a-f]{16,64})\)/g)].map((m) => ({ kind: m[1] === "![]" ? "image" : m[1] === "[audio]" ? "audio" : "video", key: m[2]!, raw: m[0] }));
}
export const answerVariants = (backIn: string): string[] => { const back = stripMedia(backIn).trim(); return [back, ...back.split(/[\n/;]/)].map((v) => v.trim()).filter(Boolean); };

export function isCorrect(typed: string, answers: string[]): boolean {
  const t = norm(typed);
  if (!t) return false;
  if (answers.some((a) => norm(a) === t)) return true;
  return answers.length > 1 && (norm(answers.join(", ")) === t || norm(answers.join(" ")) === t);
}
