import { EN } from "./en";

export type Lang = "ru" | "en";
let lang: Lang = "ru";

export const getLang = () => lang;
export function setLang(l: Lang) { lang = l; document.documentElement.lang = l; }

/**
 * Перевод: ключ — русская строка, для английского берётся из словаря EN.
 * Параметры подставляются в {name}. Если перевода нет — показывается русская строка (тест следит, чтобы такого не было).
 */
export function t(ru: string, p?: Record<string, string | number>): string {
  let s = lang === "en" ? EN[ru] ?? ru : ru;
  if (p) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (p[k] !== undefined ? String(p[k]) : m));
  return s;
}

/** auto: язык Telegram (если открыто там), иначе язык системы/браузера. Русский для ru/uk/be/kk, иначе английский. */
export function detectLang(setting: string | undefined, tgLang?: string): Lang {
  if (setting === "ru" || setting === "en") return setting;
  const code = (tgLang || navigator.language || "en").toLowerCase();
  return /^(ru|uk|be|kk)/.test(code) ? "ru" : "en";
}

/** Статические подписи в index.html: data-i18n, data-i18n-ph, data-i18n-title. */
export function translateStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh!); });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle!); });
}
