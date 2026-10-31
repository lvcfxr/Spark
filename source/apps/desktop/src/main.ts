import {
  DAY_MS, autoGrade, baselineThinkMs, expectedMs, previewIntervals, speedOf,
  type CardState, type Rating, type Speed,
} from "../../../packages/core/src";
import { Store } from "./store";
import { backend, fsApi, type FsInfo } from "./backend";
import { parseApkg, parseLines, parseTable, type ImportResult } from "./importers";
import {
  SyncService, downloadMedia, getChoice, getConfig, getSession, presetConfig, queueMedia, saveConfig, setChoice,
  signIn, signInTelegram, signOut, signUp,
} from "./sync";
import {
  addToHomeScreen, checkHomeScreen, homeScreenSupported, onHomeScreenAdded, paintTelegramChrome, tgColorScheme, closingConfirmation, haptic, initTelegram, inTelegram, loadTelegram, openExternal, setBackButton, tgInitData, tgUser,
} from "./tg";
import { answerVariants, clozeFace, clozeNumbers, esc, fmt, fmtDur, isCorrect, mediaRefs, norm, stripMedia } from "./format";
import { DAY_LEVELS, dayColor, dayLevel, dayMark, fillIcons, ic, sparkMark, streakLevel, streakMark } from "./icons";
import { xpStats } from "./xp";
import { courseMediaId, embeddedCourses, loadCourseCards, loadCourses, type Course, type CourseCard } from "./courses";
import { TIPS } from "./tips";
import { detectLang, getLang, setLang, t, translateStatic, type Lang } from "./i18n";
import { AUDIO_RE, IMAGE_RE, LIMITS, VIDEO_RE, allMediaKeys, getMediaBlob, hydrateMedia, mediaDuration, mediaUrl, mimeOf, playAudio, putLocal, putMedia, setBundledMedia, setMediaSync, shrinkImage } from "./media";
import {
  LANGS, bundledDeckOf, localizeCard, communityAvailable, loadCommunity, loadCommunityCards, loadDeckMedia, loadSparkCards, loadSparkCatalog, myPublished, publishDeck, unpublishDeck,
  type CatalogDeck, type DeckCard, type MyPublished,
} from "./catalog";

declare const __VERSION__: string;
declare const __LOGO__: string;
const APP = "Spark";
let store: Store;
let sync: SyncService;
let fsInfo: FsInfo | null = null;
const $ = (id: string) => document.getElementById(id)!;
const DAY_START_HOUR = 4;
const LEARN_AHEAD = 20 * 60_000;
const uid = () => crypto.randomUUID();

/** Учебный день как строка (YYYY-MM-DD; день начинается в 4:00). Не ломается при переводе часов. */
function dayKey(ts: number): string {
  const d = new Date(ts - DAY_START_HOUR * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prevKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const x = new Date(y, m - 1, d - 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
/** Серия дней подряд (сегодня или вчера — серия ещё жива), рекорд, сколько повторов сегодня. */
function dayStreak() {
  const days = new Set(store.reviews.map((r) => dayKey(r.ts)));
  const today = dayKey(Date.now());
  let streak = 0;
  for (let k = days.has(today) ? today : prevKey(today); days.has(k); k = prevKey(k)) streak++;
  let best = 0;
  for (const k of days) { if (days.has(prevKey(k))) continue; let n = 0; for (let x = k; days.has(x); ) { n++; const [y, m, d] = x.split("-").map(Number) as [number, number, number]; const nx = new Date(y, m - 1, d + 1); x = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, "0")}-${String(nx.getDate()).padStart(2, "0")}`; } best = Math.max(best, n); }
  const todayCount = store.reviews.filter((r) => dayKey(r.ts) === today).length;
  return { streak, best, today: todayCount, studiedToday: days.has(today) };
}
/** Названия уровней серии дней (созвездие растёт): 1, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300+. */
const DAY_NAMES = ["", "Первая звезда", "Пара звёзд", "Созвездие", "Ночное небо", "Комета", "Орбита", "Две луны", "Золотое созвездие", "Кольца", "Сияние", "Звездопад", "Звёздная корона", "Галактика", "Туманность", "Сверхновая"];
const MILESTONES = [3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300];

function dayStart(ts: number): number {
  const d = new Date(ts - DAY_START_HOUR * 3600_000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + DAY_START_HOUR * 3600_000;
}
function toast(text: string) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
const media = (root: ParentNode) => void hydrateMedia(root, t("файл есть только на другом устройстве"));

// ---------- модель для интерфейса ----------
interface CardView {
  id: string; deckId: string; front: string; hint: string; back: string; extra: string; tags: string;
  typed: boolean; kind: "basic" | "cloze"; n: number; group: string; rev: boolean; suspended: boolean; created: number;
}
type TypedMode = "inherit" | "on" | "off";
interface DeckView { id: string; name: string; created: number; typedMode: TypedMode; newPerDay: number | null; source: string; emoji: string }

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
function allCards(): CardView[] {
  return store.replica.list("card").map(({ id, fields: f }) => ({
    id, deckId: str(f.deckId), front: str(f.front), hint: str(f.hint), back: str(f.back), extra: str(f.extra), tags: str(f.tags),
    typed: f.typed === true, kind: f.kind === "cloze" ? "cloze" : "basic", n: Number(f.n ?? 1), group: str(f.group),
    rev: f.rev === true, suspended: f.suspended === true, created: Number(f.created ?? 0),
  }));
}
function allDecks(): DeckView[] {
  return store.replica.list("deck").map((d) => ({
    id: d.id, name: str(d.fields.name) || t("Без названия"), created: Number(d.fields.created ?? 0),
    typedMode: (d.fields.typedMode === "on" || d.fields.typedMode === "off" ? d.fields.typedMode : d.fields.auto === true ? "on" : "inherit") as TypedMode,
    newPerDay: typeof d.fields.newPerDay === "number" ? d.fields.newPerDay : null, source: str(d.fields.source), emoji: str(d.fields.emoji),
  })).sort((a, b) => a.created - b.created);
}

function face(c: CardView): { q: string; a: string; answers: string[] } {
  if (c.kind === "cloze") { const f = clozeFace(c.front, c.n); return { q: f.q, a: f.a, answers: f.answers }; }
  return { q: c.front, a: c.back, answers: answerVariants(c.back) };
}
function faceHtml(c: CardView, side: "q" | "a"): string {
  const f = face(c);
  const hint = c.hint.trim() ? `<div class="hint-line">${fmt(c.hint)}</div>` : "";
  const extra = !c.extra.trim() ? "" : /^\s*[>#]/m.test(c.extra) ? `<div class="extra">${fmt(c.extra)}</div>` : `<div class="inset">${fmt(c.extra)}</div>`;
  return side === "q" ? `<div class="q">${fmt(f.q) || '<span class="muted">…</span>'}</div>${hint}`
    : `<div class="a">${fmt(f.a) || '<span class="muted">…</span>'}</div>${extra}`;
}
const plain = (s: string) => stripMedia(s, t("[фото]"), t("[звук]"), t("[видео]")).replace(/[=*`]/g, "");

// ---------- состояние интерфейса ----------
type Kind = "basic" | "rev" | "cloze";
interface Draft { front: string; hint: string; back: string; extra: string; tags: string }
interface Review {
  deckId: string; cardId: string | null; show: boolean; typed: string | null; ok: boolean | null; done: number;
  t0: number; paused: number; baseline: number; dur: number;
  pending: { rating: Rating; speed: Speed; dur: number } | null; locking: boolean;
  /** серия правильных ответов подряд в этой сессии */
  combo: number; best: number; bump: "up" | "break" | null; milestone: number | null;
  /** занятие по уровню курса: только карточки с этим тегом, без дневного лимита новых */
  unit?: string; unitTitle?: string;
  /** опыт: сколько было в начале занятия и последнее начисление (для «+N») */
  xp0: number; xpGain: number;
}
interface Browser {
  tab: "spark" | "community" | "web"; q: string; lang: string; loading: boolean; error: string;
  decks: CatalogDeck[]; open: CatalogDeck | null; cards: DeckCard[] | null; busy: boolean;
}
type ModalType = "share-pick" | "settings" | "stats" | "deck" | "import" | "importdecks" | "choose" | "paste" | "publish" | "attach" | "record";
const S = {
  deckId: "all",
  sel: new Set<string>(),
  anchor: null as string | null,
  search: "",
  kind: "basic" as Kind,
  draft: { front: "", hint: "", back: "", extra: "", tags: "" } as Draft,
  pane: "decks" as "decks" | "cards" | "editor",
  review: null as Review | null,
  browser: null as Browser | null,
  tips: null as null | { tab: string },
  courses: null as null | { open: string | null; list: Course[]; cards: CourseCard[] | null; busy: boolean },
  /** куда добавлять медиа: карточка при повторении (сторона вопроса/ответа) или null — в редактор, в позицию курсора */
  attach: null as null | { cardId: string; side: "q" | "a" },
  modal: null as null | { type: ModalType; id?: string },
};
const isMobile = () => matchMedia("(max-width: 760px)").matches;
const activeId = () => (S.sel.size === 1 ? [...S.sel][0]! : null);

interface Counts { n: number; l: number; r: number; spare?: number }
/** Дополнительные новые карточки на сегодня («Учить ещё»), по колодам. */
const extraToday = (): Record<string, number> => { const e = store.settings.extraNew; return e && e.day === dayKey(Date.now()) ? e.by : {}; };
function scan(now: number, cards: CardView[], decks: DeckView[], unlimited = false): Map<string, Counts> {
  const today = dayStart(now), out = new Map<string, Counts>();
  const newToday = new Map<string, number>(), newAvail = new Map<string, number>();
  for (const c of cards) {
    const o = out.get(c.deckId) ?? { n: 0, l: 0, r: 0 };
    out.set(c.deckId, o);
    const st = store.states.get(c.id), fr = store.firstReview.get(c.id);
    if (fr != null && fr >= today) newToday.set(c.deckId, (newToday.get(c.deckId) ?? 0) + 1);
    if (c.suspended) continue;
    if (!st || st.phase === "new") newAvail.set(c.deckId, (newAvail.get(c.deckId) ?? 0) + 1);
    else if (st.phase === "learning" || st.phase === "relearning") { if (st.due <= now + LEARN_AHEAD) o.l++; }
    else if (st.due <= now) o.r++;
  }
  const limit = store.settings.newPerDay, extra = extraToday();
  for (const [id, o] of out) {
    const lim = (decks.find((d) => d.id === id)?.newPerDay ?? limit) + (extra[id] ?? 0);
    o.n = unlimited ? newAvail.get(id) ?? 0 : Math.min(newAvail.get(id) ?? 0, Math.max(0, lim - (newToday.get(id) ?? 0)));
    o.spare = (newAvail.get(id) ?? 0) - o.n; // новые сверх сегодняшнего лимита — их можно открыть кнопкой «Учить ещё»
  }
  return out;
}
const sum = (m: Map<string, Counts>): Counts => [...m.values()].reduce((a, c) => ({ n: a.n + c.n, l: a.l + c.l, r: a.r + c.r }), { n: 0, l: 0, r: 0 });

const hasTag = (c: CardView, tag?: string) => !tag || c.tags.split(/\s+/).includes(tag);
function pickNext(deckId: string, now: number, unit?: string): string | null {
  const decks = allDecks();
  const cards = allCards().filter((c) => (deckId === "all" || c.deckId === deckId) && !c.suspended && hasTag(c, unit));
  const counts = scan(now, cards, decks, !!unit);
  const newLeft = new Map([...counts].map(([k, v]) => [k, v.n]));
  let lNow: CardView | null = null, lAhead: CardView | null = null, rev: CardView | null = null, nw: CardView | null = null;
  const due = (c: CardView) => store.stateOf(c.id).due;
  for (const c of cards.sort((a, b) => a.created - b.created)) {
    const st = store.states.get(c.id);
    if (!st || st.phase === "new") { if (!nw && (newLeft.get(c.deckId) ?? 0) > 0) nw = c; }
    else if (st.phase === "learning" || st.phase === "relearning") {
      if (st.due <= now) { if (!lNow || st.due < due(lNow)) lNow = c; }
      else if (st.due <= now + LEARN_AHEAD && (!lAhead || st.due < due(lAhead))) lAhead = c;
    } else if (st.due <= now && (!rev || st.due < due(rev))) rev = c;
  }
  return (lNow ?? rev ?? nw ?? lAhead)?.id ?? null;
}

// ---------- тема и язык ----------
/** Палитра Spark своя; от Telegram берём только «светлая/тёмная» в режиме «Авто». */
function applyTheme() {
  const s = store.settings, root = document.documentElement;
  const tgScheme = tgColorScheme();
  const dark = s.theme === "dark" || (s.theme === "auto" && (tgScheme ? tgScheme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches));
  root.dataset.dark = dark ? "1" : "0";
  root.style.setProperty("--accent", s.accent);
  paintTelegramChrome(getComputedStyle(root).getPropertyValue("--bg").trim() || (dark ? "#0e0e10" : "#f4f4f7"));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => store && applyTheme());
function applyLang() {
  const l = detectLang(store.settings.lang, tgUser()?.language_code);
  if (l !== getLang()) setLang(l);
  document.title = APP;
  translateStatic();
}

function render() {
  applyLang(); applyTheme(); fillIcons();
  renderDecks(); renderList(); renderEditor(); renderReview(); renderBrowser(); renderTips(); renderCourses(); renderModal(); updateChrome();
}

function updateChrome() {
  $("app").dataset.pane = S.pane;
  setBackButton(!!S.review || !!S.modal || !!S.browser || !!S.tips || !!S.courses || (isMobile() && S.pane !== "decks"));
  closingConfirmation(!!S.review);
  updateSyncInd();
}
function goBack() {
  if (S.review) closeReview();
  else if (S.modal) { S.modal = null; render(); }
  else if (S.browser?.open) { S.browser.open = null; S.browser.cards = null; renderBrowser(); updateChrome(); }
  else if (S.browser) { S.browser = null; render(); }
  else if (S.tips) { S.tips = null; render(); }
  else if (S.courses?.open) { S.courses.open = null; renderCourses(); updateChrome(); }
  else if (S.courses) { S.courses = null; render(); }
  else if (S.pane === "editor") { S.pane = "cards"; render(); }
  else if (S.pane === "cards") { S.pane = "decks"; render(); }
}
matchMedia("(max-width: 760px)").addEventListener("change", () => store && updateChrome());

function updateSyncInd() {
  const el = document.getElementById("sync-ind") as HTMLButtonElement | null;
  if (!el || !sync) return;
  const m: Record<string, [string, string]> = {
    idle: ["cloud-ok", t("Синхронизировано")], syncing: ["sync", t("Синхронизация…")], error: ["alert", t("Ошибка синхронизации")],
    offline: ["cloud-off", t("Нет связи — изменения сохранены на устройстве")], auth: ["key", t("Нужно войти заново")],
  };
  const v = m[sync.status];
  el.hidden = !v;
  if (!v) return;
  if (el.dataset.st !== sync.status) { el.innerHTML = ic(v[0]); el.dataset.st = sync.status; }
  el.className = `icon-btn sync-ind s-${sync.status}`;
  const pend = store.pendingCount;
  el.title = `${v[1]}${sync.message ? ": " + sync.message : ""}${pend ? " · " + t("ждут отправки: {n}", { n: pend }) : ""}${sync.lastOk ? ` · ${new Date(sync.lastOk).toLocaleTimeString()}` : ""}`;
}

// ---------- колоды ----------
function renderDecks() {
  const now = Date.now(), decks = allDecks(), cards = allCards(), counts = scan(now, cards, decks);
  const cnt = (c?: Counts) => {
    const v = c ?? { n: 0, l: 0, r: 0 };
    const f = (x: number, k: string, tip: string) => `<span class="${x ? k : "z"}" title="${tip}">${x}</span>`;
    return `<span class="cnt">${f(v.n, "n", t("новые"))}${f(v.l, "l", t("изучаются"))}${f(v.r, "r", t("к повторению"))}</span>`;
  };
  const row = (id: string, label: string, c?: Counts) =>
    `<div class="row ${S.deckId === id ? "sel" : ""}" data-a="deck" data-id="${id}"><span class="name">${label}</span>${cnt(c)}</div>`;
  $("decks").innerHTML = `<div class="sec-h"><span>${t("Мои колоды")}</span><button class="link" data-a="browser-open">${t("Каталог")} ${ic("chevron")}</button></div>` + row("all", ic("layers", "row-ic") + " " + t("Все карточки"), sum(counts)) +
    decks.map((d) => row(d.id, (d.emoji ? d.emoji + " " : "") + esc(d.name) + (d.typedMode === "on" ? ' <span class="muted tiny-ic" title="' + t("Ввод ответа включён для всей колоды") + '">' + ic("keyboard") + "</span>" : ""), counts.get(d.id))).join("")
    + (decks.length ? "" : isMobile() ? welcomeHtml() : `<div class="hint" style="padding:10px">${t("Колод пока нет. Откройте «Каталог» — там готовые колоды.")}</div>`);
  renderStreak(decks.length > 0);
  $("deck-actions").innerHTML = decks.some((d) => d.id === S.deckId) ? `<button class="icon-btn" data-a="deck-edit" title="${t("Настройки колоды")}">${ic("more")}</button>` : "";
}

function renderStreak(_show: boolean) {
  const host = document.getElementById("streak");
  if (!host) return;
  const todayK = dayKey(Date.now()), st = dayStreak();
  host.innerHTML = heroHtml();
  try { if (st.studiedToday && !S.review && localStorage.getItem("spark.streakSeen") !== todayK) { host.firstElementChild?.classList.add("celebrate"); localStorage.setItem("spark.streakSeen", todayK); } } catch { /* без хранилища — без анимации */ }
  const mc = document.getElementById("mycourses");
  if (mc) mc.innerHTML = myCoursesHtml();
}

// ---------- список карточек ----------
function statusOf(st: CardState, now: number): string {
  if (st.phase === "new") return t("Новая");
  if (st.phase === "learning" || st.phase === "relearning") return st.due <= now ? t("Изучается") : t("через {d}", { d: fmtDur(st.due - now) });
  return st.due <= now ? t("Пора повторить") : t("через {d}", { d: fmtDur(st.due - now) });
}

function filteredCards(): CardView[] {
  const now = Date.now(), terms = S.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tags: string[] = [], text: string[] = [], flags: string[] = [];
  for (const x of terms) {
    if (x.startsWith("#") && x.length > 1) tags.push(x.slice(1));
    else if (x.startsWith("tag:")) tags.push(x.slice(4));
    else if (x.startsWith("is:")) flags.push(x.slice(3));
    else text.push(x);
  }
  return allCards().filter((c) => {
    if (S.deckId !== "all" && c.deckId !== S.deckId) return false;
    const ctags = c.tags.toLowerCase().split(/\s+/);
    if (tags.some((x) => !ctags.includes(x))) return false;
    const st = store.stateOf(c.id);
    for (const f of flags) {
      if (f === "new" && st.phase !== "new") return false;
      if (f === "due" && !(st.phase !== "new" && st.due <= now)) return false;
      if ((f === "susp" || f === "suspended") && !c.suspended) return false;
      if (f === "typed" && !c.typed) return false;
      if (f === "cloze" && c.kind !== "cloze") return false;
      if (f === "hard" && !(st.lapses >= 3)) return false;
    }
    if (text.length) { const hay = `${c.front} ${c.back} ${c.hint} ${c.extra} ${c.tags}`.toLowerCase(); if (text.some((x) => !hay.includes(x))) return false; }
    return true;
  }).sort((a, b) => b.created - a.created);
}

function renderList() {
  const now = Date.now(), cards = filteredCards(), shown = cards.slice(0, 500);
  const deck = allDecks().find((d) => d.id === S.deckId);
  $("list-title").textContent = deck ? (deck.emoji ? deck.emoji + " " : "") + deck.name : t("Все карточки");
  $("list-count").textContent = String(cards.length);
  $("cards").innerHTML = shown.map((c) => {
    const f = face(c), tags = c.tags.trim() ? c.tags.trim().split(/\s+/).slice(0, 3).map((x) => `<span class="tag">#${esc(x)}</span>`).join("") : "";
    return `<div class="card-row ${S.sel.has(c.id) ? "sel" : ""} ${c.suspended ? "susp" : ""}" data-a="card" data-id="${c.id}">
      <div class="t">${c.kind === "cloze" ? "<span class='badge'>[…]</span> " : c.rev ? "<span class='badge'>⇄</span> " : ""}${esc(plain(f.q).split("\n").find((x) => x.trim()) ?? "") || t("(пусто)")}</div>
      <div class="s"><span>${esc((c.kind === "cloze" ? f.answers.join(", ") : plain(c.back).split("\n").find((x) => x.trim())) || "")}${tags ? " " + tags : ""}</span>
      <span class="st">${c.suspended ? ic("pause", "tiny") : ""}${c.typed ? ic("keyboard", "tiny") : ""}${statusOf(store.stateOf(c.id), now)}</span></div></div>`;
  }).join("") + (cards.length > shown.length ? `<div class="muted" style="padding:10px;text-align:center">${t("Показаны первые 500 — уточните поиск")}</div>` : "")
    + (!cards.length ? `<div class="empty"><div class="em">${ic("inbox")}</div>${S.search ? t("Ничего не найдено") : t("В этой колоде пока нет карточек.") + "<br>" + (isMobile() ? t("Нажмите ＋, чтобы создать первую.") : t("Создайте первую справа →"))}</div>` : "");
}

/** Строка с переключателем в стиле iOS: подпись слева, переключатель справа. */
function switchRow(id: string, on: boolean, title: string, desc = "", plainRow = false): string {
  const inner = `<span class="sw-txt"><span class="sw-t">${title}</span>${desc ? `<span class="sw-d">${desc}</span>` : ""}</span><input type="checkbox" class="switch" id="${id}" ${on ? "checked" : ""}>`;
  return plainRow ? `<label class="sw-row">${inner}</label>` : `<label class="item sw-row">${inner}</label>`;
}

// ---------- редактор ----------
const TOOLBAR = (cloze: boolean) => `<div class="tb">
  <button class="tbb" data-a="fmt" data-k="b" title="${t("Жирный")} (Ctrl+B)"><b>B</b></button>
  <button class="tbb" data-a="fmt" data-k="i" title="${t("Курсив")} (Ctrl+I)"><i>I</i></button>
  <button class="tbb" data-a="fmt" data-k="hl" title="${t("Выделение")}">▮</button>
  <button class="tbb" data-a="fmt" data-k="code" title="${t("Код")}">&lt;/&gt;</button>
  <span class="sep"></span>
  <button class="tbb wide" data-a="fmt" data-k="sub" title="${t("Мелкий подзаголовок: строка начинается с «# »")}">${t("Подзаголовок")}</button>
  <button class="tbb wide" data-a="fmt" data-k="quote" title="${t("Вставка: строка начинается с «> »")}">${t("Вставка")}</button>
  <button class="tbb wide" data-a="fmt" data-k="img" title="${t("Добавить картинку")}">${ic("image")} ${t("Картинка")}</button>
  <button class="tbb wide" data-a="fmt" data-k="video" title="${t("Короткое видео (до {s} с)", { s: LIMITS.videoSeconds })}">${ic("video")} ${t("Видео")}</button>
  <button class="tbb wide" data-a="fmt" data-k="audio" title="${t("Записать произношение или выбрать аудиофайл")}">${ic("mic")} ${t("Звук")}</button>
  ${cloze ? `<button class="tbb wide" data-a="fmt" data-k="cloze" title="${t("Пропуск")} (Ctrl+Shift+C)">[…] ${t("Пропуск")}</button>` : ""}</div>`;

function readDraft() {
  const g = (id: string) => ($(id) as HTMLInputElement | null)?.value;
  if (g("f-front") === undefined || activeId()) return;
  S.draft = { front: g("f-front") ?? "", hint: g("f-hint") ?? "", back: g("f-back") ?? "", extra: g("f-extra") ?? "", tags: g("f-tags") ?? "" };
}

function welcomeHtml(): string {
  return `<div class="empty welcome"><div class="logo">${__LOGO__}</div><h3>${t("Добро пожаловать в {app}", { app: APP })}</h3>
    <p>${t("Карточки для запоминания с умными повторениями. Возьмите готовую колоду из каталога или создайте свою.")}</p>
    <div class="welcome-actions"><button class="btn" data-a="browser-open">${ic("catalog")} ${t("Открыть каталог")}</button>
    <button class="btn sec" data-a="deck-new">${ic("plus")} ${t("Создать колоду")}</button>
    <button class="btn sec" data-a="import-decks">${ic("import")} ${t("Импорт из Anki / CSV")}</button></div></div>`;
}

function renderEditor() {
  const decks = allDecks(), host = $("editor");
  if (!decks.length) { host.innerHTML = welcomeHtml(); return; }
  if (S.sel.size > 1) {
    const opts = decks.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
    host.innerHTML = `<div class="editor"><div class="m-only m-head"><button class="btn sec" data-a="m-back">${ic("back")} ${t("Карточки")}</button></div>
      <h2 style="margin:6px 0 4px">${t("Выбрано карточек: {n}", { n: S.sel.size })}</h2><p class="muted">${t("Ctrl/⌘+клик — добавить или убрать, Shift+клик — диапазон.")}</p>
      <div class="group"><div class="item"><span>${t("Переместить в колоду")}</span><span class="row-ctl"><select id="b-deck">${opts}</select><button class="btn sec" data-a="bulk-move">${t("Переместить")}</button></span></div>
        <div class="item"><span>${t("Добавить тег")}</span><span class="row-ctl"><input type="text" id="b-tag" placeholder="${t("глаголы")}" style="width:140px"><button class="btn sec" data-a="bulk-tag">${t("Добавить")}</button></span></div>
        <div class="item"><span>${t("Приостановить / вернуть в обучение")}</span><span class="row-ctl"><button class="btn sec" data-a="bulk-susp">${t("Приостановить")}</button><button class="btn sec" data-a="bulk-unsusp">${t("Вернуть")}</button></span></div>
        <div class="item"><span>${t("Ввод ответа")}</span><span class="row-ctl"><button class="btn sec" data-a="bulk-typed-on">${t("Включить")}</button><button class="btn sec" data-a="bulk-typed-off">${t("Выключить")}</button></span></div></div>
      <div class="actions"><button class="btn danger" data-a="bulk-del">${t("Удалить выбранные")}</button><button class="btn sec" data-a="bulk-clear">${t("Снять выделение")}</button></div></div>`;
    return;
  }
  const id = activeId(), card = id ? allCards().find((c) => c.id === id) : undefined;
  if (id && !card) S.sel.clear();
  const cur = card?.deckId ?? (S.deckId !== "all" ? S.deckId : decks[0]!.id);
  const opts = decks.map((d) => `<option value="${d.id}" ${d.id === cur ? "selected" : ""}>${esc(d.name)}</option>`).join("");
  const kind: Kind = card ? (card.kind === "cloze" ? "cloze" : "basic") : S.kind;
  const v = card ?? { front: S.draft.front, hint: S.draft.hint, back: S.draft.back, extra: S.draft.extra, tags: S.draft.tags, typed: store.settings.typedDefault, suspended: false } as Partial<CardView>;
  const kinds = card ? "" : `<div class="seg kinds">${([["basic", t("Обычная")], ["rev", t("Двусторонняя")], ["cloze", t("Пропуски")]] as [Kind, string][])
    .map(([k, n]) => `<button data-a="kind" data-k="${k}" class="${S.kind === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  let info = "";
  if (card) {
    const st = store.stateOf(card.id), now = Date.now();
    info = `<div class="info"><span>${t("Статус")}: ${statusOf(st, now)}</span><span>${t("Повторов")}: ${st.reps}</span><span>${t("Ошибок")}: ${st.lapses}</span>${st.stability ? `<span>${t("Стабильность")}: ${t("{n} дн", { n: st.stability.toFixed(1) })}</span><span>${t("Сложность")}: ${st.difficulty.toFixed(1)}/10</span>` : ""}${card.group ? `<span>${t("связана с другими карточками")}</span>` : ""}</div>`;
  }
  const frontLabel = kind === "cloze" ? t("Текст с пропусками") : t("Лицевая сторона");
  const frontPh = kind === "cloze" ? t("Мадрид — это {{c1::столица}} {{c2::Испании}}") : t("Вопрос или слово");
  host.innerHTML = `<div class="editor"><div class="m-only m-head"><button class="btn sec" data-a="m-back">${ic("back")} ${t("Карточки")}</button></div>${kinds}
    <label>${t("Колода")}</label><select id="f-deck">${opts}</select>
    ${TOOLBAR(kind === "cloze")}
    <label>${frontLabel}</label><textarea id="f-front" class="fld" placeholder="${esc(frontPh)}">${esc(v.front ?? "")}</textarea>
    <label>${t("Подсказка")} <span class="opt">${t("мелким под лицевой стороной")}</span></label><input type="text" id="f-hint" class="fld" placeholder="${t("напр. транскрипция, часть речи")}" value="${esc(v.hint ?? "")}">
    ${kind === "cloze" ? "" : `<label>${t("Обратная сторона")}</label><textarea id="f-back" class="fld" placeholder="${t("Ответ или перевод")}">${esc(v.back ?? "")}</textarea>`}
    <label>${t("Пояснение")} <span class="opt">${t("вставкой под ответом: пример, заметка")}</span></label><textarea id="f-extra" class="fld short" placeholder="${esc(t("# Пример") + "\n> " + t("Hablo español."))}">${esc(v.extra ?? "")}</textarea>
    <label>${t("Теги")}</label><input type="text" id="f-tags" class="fld" placeholder="${t("через пробел: глаголы B1")}" value="${esc(v.tags ?? "")}">
    <div id="atts-box">${card ? attachmentsHtml(card) : ""}</div>
    <div class="group sw-group">${switchRow("f-typed", !!v.typed, t("Ввод ответа с клавиатуры"), t("при повторении нужно набрать ответ"))}
    ${card ? switchRow("f-susp", card.suspended, t("Приостановить карточку"), t("не показывать при повторении")) : ""}</div>
    <div class="actions">${card
      ? `<button class="btn danger" data-a="card-del">${t("Удалить")}</button>${card.kind === "basic" && !card.group ? `<button class="btn sec" data-a="card-swap" title="${t("Лицевая ⇄ обратная")}">⇄ ${t("Поменять")}</button><button class="btn sec" data-a="card-mkrev" title="${t("Создать связанную обратную карточку")}">＋ ${t("Обратная")}</button>` : ""}<button class="btn sec" data-a="card-new">${t("Новая")}</button><span class="muted autosave">${t("Сохраняется автоматически")}</span>`
      : `<button class="btn" data-a="card-add">${t("Добавить")}</button><span class="muted d-only"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> — ${t("добавить и продолжить")}</span>`}</div>
    <div class="preview-wrap" id="prev">${previewHtml(card ?? null)}</div>${info}
    <p class="hint" style="margin-left:0">${t("Разметка")}: <code># ${t("подзаголовок")}</code>, <code>&gt; ${t("вставка")}</code>, <code>**${t("жирный")}**</code>, <code>*${t("курсив")}*</code>, <code>==${t("выделение")}==</code>.</p>
  </div>`;
  media(host);
}
function attachmentsHtml(c: CardView): string {
  const items = (["front", "back", "extra"] as const).flatMap((f) => mediaRefs(c[f]).map((m) => ({ ...m, f })));
  if (!items.length) return "";
  const icon = { image: ic("image"), video: ic("video"), audio: ic("sound") } as const;
  const where = { front: t("вопрос"), back: t("ответ"), extra: t("пояснение") } as const;
  return `<label>${t("Вложения")}</label><div class="atts">${items.map((m) => `<span class="att">${m.kind === "image" ? `<img class="mimg" data-media="${m.key}" alt="">` : icon[m.kind]}<span class="muted">${where[m.f]}</span><button class="att-x" data-a="att-del" data-f="${m.f}" data-k="${m.key}" title="${t("Удалить")}">✕</button></span>`).join("")}</div>`;
}
function previewHtml(card: CardView | null): string {
  const c = card ?? draftCard();
  if (c.kind === "cloze" && clozeNumbers(c.front).length === 0) return `<div class="preview"><span class="muted">${t("Выделите слово и нажмите «[…] Пропуск», чтобы скрыть его.")}</span></div>`;
  return `<div class="preview"><div class="pk">${t("Вопрос")}</div>${faceHtml(c, "q")}</div><div class="preview"><div class="pk">${t("Ответ")}</div>${faceHtml(c, "a")}</div>`;
}
function draftCard(): CardView {
  const g = (id: string) => ($(id) as HTMLInputElement | null)?.value ?? "";
  return { id: "", deckId: "", front: g("f-front"), hint: g("f-hint"), back: g("f-back"), extra: g("f-extra"), tags: "", typed: false,
    kind: S.kind === "cloze" ? "cloze" : "basic", n: 1, group: "", rev: false, suspended: false, created: 0 };
}
function updatePreview() {
  const id = activeId(), c = id ? allCards().find((x) => x.id === id) ?? null : null;
  const el = document.getElementById("prev");
  if (el) { el.innerHTML = previewHtml(c); media(el); }
  const box = document.getElementById("atts-box");
  if (box && c) { box.innerHTML = attachmentsHtml(c); media(box); }
}

// ---------- группы: двусторонние и cloze ----------
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function syncGroup(id: string) {
  const c = allCards().find((x) => x.id === id);
  if (!c || !c.group) return;
  const sibs = allCards().filter((x) => x.group === c.group && x.id !== id);
  if (c.kind === "cloze") {
    for (const s of sibs) for (const k of ["front", "hint", "extra", "tags"] as const) store.set("card", s.id, k, c[k]);
    const nums = clozeNumbers(c.front), all = [c, ...sibs], have = new Set(all.map((x) => x.n));
    for (const n of nums) if (!have.has(n)) store.addCardFull({ deckId: c.deckId, front: c.front, hint: c.hint, extra: c.extra, tags: c.tags, kind: "cloze", n, group: c.group });
    for (const x of all) if (!nums.includes(x.n) && nums.length) store.deleteCard(x.id);
  } else {
    for (const s of sibs) {
      store.set("card", s.id, "front", c.back); store.set("card", s.id, "back", c.front);
      store.set("card", s.id, "extra", c.extra); store.set("card", s.id, "tags", c.tags);
    }
  }
}

function addCardFromForm(): boolean {
  const g = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() ?? "";
  const front = g("f-front"), back = g("f-back"), hint = g("f-hint"), extra = g("f-extra"), tags = g("f-tags");
  const deckId = g("f-deck"), typed = ($("f-typed") as HTMLInputElement).checked;
  if (S.kind === "cloze") {
    const nums = clozeNumbers(front);
    if (!nums.length) { toast(t("Добавьте хотя бы один пропуск: {{c1::слово}}")); return false; }
    const group = uid();
    nums.forEach((n) => store.addCardFull({ deckId, front, hint, extra, tags, typed, kind: "cloze", n, group }));
    toast(t("Создано карточек: {n}", { n: nums.length }));
  } else {
    if (!front && !back) return false;
    if (S.kind === "rev") {
      const group = uid();
      store.addCardFull({ deckId, front, hint, back, extra, tags, typed, group });
      store.addCardFull({ deckId, front: back, back: front, extra, tags, typed, group, rev: true });
      toast(t("Создано 2 карточки: прямая и обратная"));
    } else store.addCardFull({ deckId, front, hint, back, extra, tags, typed });
  }
  S.draft = { front: "", hint: "", back: "", extra: "", tags };
  store.setSetting("typedDefault", typed);
  renderDecks(); renderList(); renderEditor();
  ($("f-front") as HTMLTextAreaElement).focus();
  return true;
}

// ---------- форматирование и картинки ----------
let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;
function insertAtCursor(text: string) {
  const el = lastField && document.body.contains(lastField) ? lastField : ($("f-front") as HTMLTextAreaElement | null);
  if (!el) return;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  el.value = el.value.slice(0, a) + text + el.value.slice(b);
  el.setSelectionRange(a + text.length, a + text.length);
  el.focus();
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function applyFmt(k: string) {
  if (k === "img" || k === "video" || k === "audio") {
    S.attach = null;
    if (k === "img") ($("img-file") as HTMLInputElement).click();
    else if (k === "video") ($("vid-file") as HTMLInputElement).click();
    else { S.modal = { type: "record" }; renderModal(); updateChrome(); }
    return;
  }
  const el = lastField && document.body.contains(lastField) ? lastField : ($("f-front") as HTMLTextAreaElement | null);
  if (!el) return;
  const { selectionStart: a0, selectionEnd: b0, value } = el;
  const a = a0 ?? value.length, b = b0 ?? a;
  const wrap = (l: string, r = l) => { el.value = value.slice(0, a) + l + value.slice(a, b) + r + value.slice(b); el.setSelectionRange(a + l.length, b + l.length); };
  const prefix = (p: string) => {
    const ls = value.lastIndexOf("\n", a - 1) + 1, le = (() => { const i = value.indexOf("\n", b); return i < 0 ? value.length : i; })();
    const block = value.slice(ls, le).split("\n").map((ln) => (ln.startsWith(p) ? ln.slice(p.length) : p + ln)).join("\n");
    el.value = value.slice(0, ls) + block + value.slice(le); el.setSelectionRange(ls, ls + block.length);
  };
  if (k === "b") wrap("**"); else if (k === "i") wrap("*"); else if (k === "code") wrap("`"); else if (k === "hl") wrap("==");
  else if (k === "sub") prefix("# "); else if (k === "quote") prefix("> ");
  else if (k === "cloze") { const nums = clozeNumbers(value), n = (nums.length ? Math.max(...nums) : 0) + 1; wrap(`{{c${n}::`, "}}"); }
  el.focus();
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
type MediaKind = "image" | "video" | "audio";
const kindOf = (f: Blob & { name?: string }): MediaKind | null =>
  f.type.startsWith("image/") || IMAGE_RE.test(f.name ?? "") ? "image" : f.type.startsWith("video/") || (VIDEO_RE.test(f.name ?? "") && !f.type.startsWith("audio/")) ? "video"
    : f.type.startsWith("audio/") || AUDIO_RE.test(f.name ?? "") ? "audio" : null;

/** Проверить, сохранить и вставить медиа: в редактор (позиция курсора) или в карточку при повторении. */
async function addMediaFile(want: MediaKind | null, f: Blob & { name?: string }) {
  const kind = kindOf(f);
  if (!kind || (want && kind !== want)) return toast(want === "video" ? t("Это не видео") : want === "audio" ? t("Это не аудиофайл") : t("Это не картинка"));
  let blob: Blob = f;
  if (kind === "image") blob = await shrinkImage(f);
  else if (kind === "video") {
    if (f.size > LIMITS.videoBytes) return toast(t("Видео слишком большое: до {n} МБ", { n: LIMITS.videoBytes >> 20 }));
    const d = await mediaDuration(f, "video");
    if (d > LIMITS.videoSeconds + 0.5) return toast(t("Видео слишком длинное: до {s} с", { s: LIMITS.videoSeconds }));
  } else if (f.size > LIMITS.audioBytes) return toast(t("Аудиофайл слишком большой: до {n} МБ", { n: LIMITS.audioBytes >> 20 }));
  if (!blob.type) blob = new Blob([blob], { type: mimeOf(f.name ?? "") });
  const key = await putMedia(blob);
  const marker = kind === "image" ? `![](media:${key})` : kind === "video" ? `[video](media:${key})` : `[audio](media:${key})`;
  const target = S.attach;
  if (target) {
    const c = allCards().find((x) => x.id === target.cardId);
    if (!c) return;
    const field = target.side === "q" ? "front" : c.kind === "cloze" ? "extra" : "back";
    const cur = c[field];
    store.set("card", c.id, field, (cur.trim() ? cur.replace(/\s+$/, "") + "\n" : "") + marker);
    if (c.group) syncGroup(c.id);
    S.modal = null; S.attach = null;
    haptic("success"); toast(t("Добавлено к карточке"));
    renderModal(); renderReview(); renderList(); updateChrome();
    if (kind === "audio") void playFirst(target.side === "q" ? ".rv-q" : ".ans", true);
  } else {
    if (S.modal?.type === "record") { S.modal = null; renderModal(); updateChrome(); }
    insertAtCursor(`\n${marker}\n`);
  }
}
/** Сыграть первый звук в блоке (например, произношение при показе ответа). */
async function playFirst(sel: string, force = false) {
  if (!force && !store.settings.autoAudio) return;
  const b = document.querySelector<HTMLElement>(`#overlay ${sel} .snd[data-media]`);
  if (!b) return;
  const u = await mediaUrl(b.dataset.media!);
  if (u) playAudio(u);
}

// ---------- запись звука с микрофона ----------
interface Rec { state: "idle" | "rec" | "done"; mr?: MediaRecorder; stream?: MediaStream; chunks: Blob[]; blob?: Blob; url?: string; t0: number; timer?: ReturnType<typeof setInterval> }
let rec: Rec = { state: "idle", chunks: [], t0: 0 };
const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
function stopStream() { rec.stream?.getTracks().forEach((tr) => tr.stop()); rec.stream = undefined; clearInterval(rec.timer); }
function resetRec() { stopStream(); if (rec.mr && rec.mr.state !== "inactive") rec.mr.stop(); if (rec.url) URL.revokeObjectURL(rec.url); rec = { state: "idle", chunks: [], t0: 0 }; }
async function startRec() {
  if (!canRecord()) return toast(t("Запись недоступна на этом устройстве — выберите аудиофайл"));
  resetRec();
  try { rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast(t("Нет доступа к микрофону — разрешите его или выберите аудиофайл")); }
  const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m));
  const mr = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.mr = mr; rec.chunks = []; rec.state = "rec"; rec.t0 = Date.now();
  mr.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
  mr.onstop = () => {
    stopStream();
    rec.blob = new Blob(rec.chunks, { type: mr.mimeType || mime || "audio/webm" });
    rec.url = URL.createObjectURL(rec.blob); rec.state = "done";
    if (S.modal?.type === "record") renderModal();
  };
  mr.start(250);
  haptic("light");
  rec.timer = setInterval(() => {
    const sec = (Date.now() - rec.t0) / 1000, el = document.getElementById("rec-time");
    if (el) el.textContent = `${sec.toFixed(1)} / ${LIMITS.recordSeconds} ${t("с")}`;
    if (sec >= LIMITS.recordSeconds) stopRec();
  }, 100);
  renderModal();
}
function stopRec() { clearInterval(rec.timer); if (rec.mr && rec.mr.state !== "inactive") rec.mr.stop(); }

// ---------- повторение ----------
const SPEED_LABEL = (): Record<Speed, string> => ({ fast: t("Быстро"), normal: t("Уверенно"), slow: t("С раздумьем"), veryslow: t("Долго думали"), wrong: t("Ошибка") });

function computeBaseline(): number {
  const ds: number[] = [];
  for (let i = store.reviews.length - 1; i >= 0 && ds.length < 200; i--) if (store.reviews[i]!.rating > 1) ds.push(store.reviews[i]!.durationMs);
  return baselineThinkMs(ds);
}
let hiddenAt: number | null = null;
document.addEventListener("visibilitychange", () => {
  const r = S.review;
  if (!r) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt) { r.paused += Date.now() - hiddenAt; hiddenAt = null; }
});
const thinkMs = (r: Review) => Math.min(120_000, Math.max(0, Date.now() - r.t0 - r.paused - (hiddenAt ? Date.now() - hiddenAt : 0)));

function isTyped(card: CardView, deck: DeckView | undefined): boolean {
  const m = deck?.typedMode ?? "inherit";
  if (m === "on") return true;
  if (card.typed) return true;
  return m === "off" ? false : store.settings.typedAll;
}
function ctx() {
  const r = S.review, card = r?.cardId ? allCards().find((c) => c.id === r.cardId) : null;
  if (!r || !card) return null;
  const deck = allDecks().find((d) => d.id === card.deckId);
  const f = face(card);
  const typedMode = isTyped(card, deck) && f.answers.length > 0;
  return { r, card, deck, f, typedMode, live: typedMode && !store.settings.manualGrades, learning: store.stateOf(card.id).phase !== "review" };
}

function renderReview() {
  const el = $("overlay"), r = S.review;
  el.classList.toggle("on", !!r);
  if (!r) { el.innerHTML = ""; return; }
  const now = Date.now(), decks = allDecks();
  const counts = sum(scan(now, allCards().filter((c) => (r.deckId === "all" || c.deckId === r.deckId) && hasTag(c, r.unit)), decks, !!r.unit));
  const left = r.cardId ? counts.n + counts.l + counts.r : 0;
  const total = r.done + left, frac = total ? r.done / total : 1, C = 2 * Math.PI * 17;
  const deck = decks.find((d) => d.id === r.deckId);
  const manual = store.settings.manualGrades;
  const typedNow = (() => { const c = r.cardId ? allCards().find((k) => k.id === r.cardId) : null; return c ? isTyped(c, decks.find((d) => d.id === c.deckId)) : store.settings.typedAll; })();
  const timer = manual ? "" : `<div class="tm"><div class="tm-bar"><i id="rv-bar"></i></div><span id="rv-time" class="muted"></span></div>`;
  const top = `<div class="rv-top"><button class="icon-btn" data-a="rv-close" title="${t("Закрыть")} (Esc)">${ic("close")}</button>
    <div class="t">${esc(r.unitTitle ?? deck?.name ?? t("Все карточки"))}<div class="muted" style="font-weight:400;font-size:12px"><span style="color:var(--accent)">${counts.n}</span> · <span style="color:var(--bad)">${counts.l}</span> · <span style="color:var(--good)">${counts.r}</span></div></div>
    <div class="combo lv${streakLevel(r.combo)} ${r.bump ?? ""}" title="${t("Серия правильных ответов подряд")}">${streakMark(streakLevel(r.combo))}<b>${r.combo}</b>${r.xpGain && r.bump ? `<span class="xp-pop">+${r.xpGain} XP</span>` : ""}</div>
    ${r.cardId ? `<button class="icon-btn rv-att" data-a="rv-attach" title="${t("Добавить к карточке картинку, видео или звук")}">${ic("clip")}</button>` : ""}
    <button class="kbd-toggle ${typedNow ? "on" : ""}" data-a="rv-typed" title="${t("Ввод ответа с клавиатуры: переход без Enter при верном слове")}">${ic("keyboard")}<span class="lbl"> ${t("Ввод")}: ${typedNow ? t("вкл") : t("выкл")}</span></button>
    <svg class="ring" viewBox="0 0 38 38"><circle class="bg" cx="19" cy="19" r="17"/><circle class="fg" cx="19" cy="19" r="17" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg></div>`;
  const x = ctx();
  if (!x) {
    el.innerHTML = top + `<div class="rv-body"><div class="rv-done"><div class="em done-ic">${ic("check-circle")}</div>
      <h2>${r.done ? t("Отличная работа!") : t("На сегодня всё")}</h2>
      <p class="muted">${r.done ? t("Повторено карточек: {n}", { n: r.done }) : r.unit ? t("Уровень пройден — все слова изучены.") : t("Нет карточек к повторению.")}</p>
      ${r.done ? (() => { const x = xpStats(store.reviews); return `<p class="xp-sum">${ic("spark")} ${t("Опыт за занятие: +{n}", { n: x.total - r.xp0 })} · ${t("уровень {n}", { n: x.level })}</p>`; })() : ""}
      ${r.best >= 3 ? `<p class="best-combo lv${streakLevel(r.best)}">${ic("trophy")} ${t("Лучшая серия: {n} правильных подряд", { n: r.best })}</p>` : ""}
      ${r.unit ? "" : moreHtml(r.deckId)}
      <button class="btn big" data-a="rv-close">${t("Готово")}</button></div></div>`;
    return;
  }
  const { card, f, typedMode } = x;
  const st = store.stateOf(card.id), iv = previewIntervals(st, now, store.params);
  const kind = st.phase === "new" ? t("Новая") : st.phase === "review" ? t("Повторение") : t("Изучение");
  let mid = "", foot = "";
  if (!r.show) {
    mid = typedMode ? `<input type="text" id="rv-input" class="rv-input" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${x.live ? t("Введите ответ") : t("Введите ответ и нажмите Enter")}">` : "";
    foot = typedMode
      ? `<button class="btn big" data-a="rv-check">${t("Проверить")} <kbd class="kk">Enter</kbd></button><button class="btn sec big" data-a="rv-idk">${t("Не знаю")}</button>`
      : `<button class="btn big wide" data-a="rv-show">${t("Показать ответ")} <kbd class="kk">${t("Пробел")}</kbd></button>`;
  } else {
    const res = r.typed != null && r.typed !== "" ? `<div class="rv-res ${r.ok ? "ok" : "bad"}">${r.ok ? "✓ " + t("Верно") : "✗ " + t("Ваш ответ") + ": " + esc(r.typed)}</div>` : r.typed === "" ? `<div class="rv-res bad">✗ ${t("Не знаю")}</div>` : "";
    mid = res + `<div class="ans">${faceHtml(card, "a")}</div>`;
    if (manual) {
      foot = ([[1, t("Снова")], [2, t("Трудно")], [3, t("Хорошо")], [4, t("Легко")]] as [Rating, string][])
        .map(([g, n]) => `<button class="grade g${g}" data-a="rate" data-g="${g}">${n}<small>${fmtDur(iv[g])}</small><small class="kk2">${g}</small></button>`).join("");
    } else if (r.pending && !r.locking) {
      const p = r.pending, when = fmtDur(previewIntervals(st, now, store.params)[p.rating]);
      foot = `<div class="chip sp-${p.speed}"><i class="dot"></i>${SPEED_LABEL()[p.speed]} <span class="muted">· ${t("вернётся через {d}", { d: when })}</span></div>
        <div class="foot-row"><button class="btn big" data-a="rv-next">${t("Далее")} <kbd class="kk">⏎</kbd></button>
        ${r.typed != null && r.ok === false && r.typed !== "" ? `<button class="btn sec big" data-a="rv-right" title="${t("Опечатка — засчитать")}">${t("Я был прав")} <kbd class="kk">V</kbd></button>` : p.rating > 1 ? `<button class="btn sec big" data-a="rv-forgot">${t("Не помню")} <kbd class="kk">X</kbd></button>` : ""}</div>`;
    }
  }
  el.innerHTML = top + `<div class="rv-body"><div class="rv-card ${r.locking ? "flash" : ""}"><div class="kind">${kind}${card.kind === "cloze" ? " · " + t("пропуск") : ""}</div>
    <div class="rv-q">${faceHtml(card, "q")}</div>${mid}</div></div>
    <div class="rv-foot">${timer}${foot}</div>`;
  media(el);
  comboEffects(el, r);
  if (!r.show && typedMode) ($("rv-input") as HTMLInputElement).focus();
  if (r.locking) ($("rv-input") as HTMLInputElement | null)?.setAttribute("disabled", "");
}

/** Анимация серии: «пружинка» при росте, тряска при сбросе, салют на вехах (5, 10, 20…). */
function comboEffects(el: HTMLElement, r: Review) {
  r.bump = null;
  if (!r.milestone) return;
  const n = r.milestone, tier = streakLevel(n);
  r.milestone = null;
  const parts = Array.from({ length: 18 }, (_, i) => `<i style="--a:${(i * 360) / 18 + (Math.random() * 14 - 7)}deg;--d:${70 + Math.random() * 70}px;--s:${0.6 + Math.random() * 0.7}"></i>`).join("");
  const box = document.createElement("div");
  box.className = `milestone lv${tier}`;
  box.innerHTML = `<div class="ms-burst">${parts}</div><div class="ms-n">${n}</div><div class="ms-t">${t("правильных подряд!")}</div>`;
  el.appendChild(box);
  setTimeout(() => box.remove(), 1700);
}

function toggleTyped() {
  const r = S.review;
  if (!r) return;
  const card = r.cardId ? allCards().find((c) => c.id === r.cardId) : null;
  const decks = allDecks();
  const now = card ? isTyped(card, decks.find((d) => d.id === card.deckId)) : store.settings.typedAll;
  if (r.deckId === "all" || !decks.some((d) => d.id === r.deckId)) store.setSetting("typedAll", !now);
  else store.set("deck", r.deckId, "typedMode", !now ? "on" : "off");
  if (card && !r.show) { r.t0 = Date.now(); r.paused = 0; }
  renderReview();
}
/** «Учить ещё»: +10 / +20 / +30 новых карточек сверх дневного лимита. */
function spareNew(deckId: string): Map<string, number> {
  const cards = allCards().filter((c) => (deckId === "all" || c.deckId === deckId) && !c.suspended);
  const out = new Map<string, number>();
  for (const [id, c] of scan(Date.now(), cards, allDecks())) if ((c.spare ?? 0) > 0) out.set(id, c.spare!);
  return out;
}
function moreHtml(deckId: string): string {
  const spare = [...spareNew(deckId).values()].reduce((a, b) => a + b, 0);
  if (!spare) return "";
  const opts = [10, 20, 30].filter((n) => n < spare);
  const btns = [...opts.map((n) => `<button class="btn sec" data-a="rv-more" data-n="${n}">+${n}</button>`),
    ...(opts.length < 3 ? [`<button class="btn sec" data-a="rv-more" data-n="${spare}">${opts.length ? t("все {n}", { n: spare }) : "+" + spare}</button>`] : [])].join("");
  return `<div class="rv-more"><div class="rv-more-t">${ic("plus")} ${t("Учить ещё")}</div>
    <p class="muted">${t("Новых карточек осталось: {n}. Сколько добавить на сегодня?", { n: spare })}</p><div class="rv-more-b">${btns}</div></div>`;
}
function learnMore(n: number) {
  const r = S.review;
  if (!r || n <= 0) return;
  const today = dayKey(Date.now()), spare = spareNew(r.deckId), by = { ...extraToday() };
  // раздаём по колодам по порядку, пока не наберём n
  let left = n;
  for (const d of allDecks()) { const sp = spare.get(d.id) ?? 0; if (!sp || left <= 0) continue; const k = Math.min(sp, left); by[d.id] = (by[d.id] ?? 0) + k; left -= k; }
  store.setSetting("extraNew", { day: today, by });
  haptic("success");
  showNext();
}

function startReview(deckId: string, unit?: { tag: string; title: string }) {
  haptic("light");
  S.review = { deckId, cardId: null, show: false, typed: null, ok: null, done: 0, t0: 0, paused: 0, baseline: computeBaseline(), dur: 0, pending: null, locking: false, combo: 0, best: 0, bump: null, milestone: null,
    unit: unit?.tag, unitTitle: unit?.title, xp0: xpStats(store.reviews).total, xpGain: 0 };
  showNext();
}
function showNext() {
  const r = S.review!;
  r.cardId = pickNext(r.deckId, Date.now(), r.unit);
  Object.assign(r, { show: false, typed: null, ok: null, pending: null, locking: false, t0: Date.now(), paused: 0, dur: 0 });
  if (r.done > 0 && r.done % 10 === 0) r.baseline = computeBaseline();
  hiddenAt = document.hidden ? Date.now() : null;
  renderReview(); renderDecks(); updateChrome();
  void playFirst(".rv-q");
}
function closeReview() {
  const r = S.review;
  if (r?.show && r.pending && r.cardId && !r.locking) store.answer(r.cardId, r.pending.rating, r.pending.dur);
  const studied = (r?.done ?? 0) > 0;
  S.review = null; render();
  if (studied) void offerHomeScreen();
}
/** Один раз после занятия предложить ярлык на главный экран. */
async function offerHomeScreen() {
  try { if (!homeScreenSupported() || localStorage.getItem("spark.homeOffered")) return; } catch { return; }
  const st = await checkHomeScreen();
  homeStatus = st;
  if (st === "added" || st === "unsupported") return;
  localStorage.setItem("spark.homeOffered", "1");
  const bar = document.getElementById("update-bar");
  if (!bar) return;
  bar.hidden = false;
  bar.innerHTML = `${t("Открывайте Spark одним касанием — добавьте ярлык на главный экран")} <button data-a="home-add">${t("Добавить")}</button> <button class="bar-x" data-a="bar-close">${ic("close")}</button>`;
}
function reveal() {
  const x = ctx();
  if (!x || x.r.show) return;
  const think = thinkMs(x.r);
  x.r.dur = think;
  if (!store.settings.manualGrades) {
    const g = autoGrade({ thinkMs: think, baselineMs: x.r.baseline, learning: x.learning });
    x.r.pending = { rating: g.rating, speed: g.speed, dur: think };
  }
  x.r.show = true;
  renderReview();
  void playFirst(".ans");
}
function checkTyped(valueIn?: string) {
  const x = ctx();
  if (!x || x.r.show) return;
  const value = (valueIn ?? ($("rv-input") as HTMLInputElement | null)?.value ?? "").trim();
  const ok = !!value && isCorrect(value, x.f.answers);
  const think = thinkMs(x.r);
  x.r.typed = value; x.r.ok = value ? ok : false; x.r.dur = think;
  if (!store.settings.manualGrades) {
    const g = autoGrade({ thinkMs: think, baselineMs: x.r.baseline, typed: true, correct: ok, chars: x.f.answers[0]?.length ?? 0, learning: x.learning });
    x.r.pending = { rating: g.rating, speed: g.speed, dur: think };
  }
  x.r.show = true;
  haptic(ok ? "success" : "error");
  if (ok && x.live) { x.r.locking = true; renderReview(); setTimeout(() => applyPending(), 420); }
  else { renderReview(); void playFirst(".ans"); }
}
function bumpCombo(rating: Rating) {
  const r = S.review!;
  if (rating >= 2) {
    r.combo++; r.best = Math.max(r.best, r.combo); r.bump = "up";
    if (MILESTONES.includes(r.combo)) { r.milestone = r.combo; haptic("success"); }
  } else { r.bump = r.combo > 0 ? "break" : null; r.combo = 0; }
}
function applyPending(rating?: Rating) {
  const r = S.review;
  if (!r?.cardId || !r.pending) return;
  store.answer(r.cardId, rating ?? r.pending.rating, r.pending.dur);
  bumpCombo(rating ?? r.pending.rating);
  r.xpGain = xpStats(store.reviews).lastGain;
  haptic("select");
  r.done++;
  showNext();
}
function rateManual(g: Rating) {
  const r = S.review;
  if (!r?.cardId || !r.show) return;
  store.answer(r.cardId, g, r.dur);
  bumpCombo(g);
  r.xpGain = xpStats(store.reviews).lastGain;
  haptic("select");
  r.done++;
  showNext();
}
function markRight() {
  const x = ctx();
  if (!x?.r.pending) return;
  const g = autoGrade({ thinkMs: x.r.dur, baselineMs: x.r.baseline, typed: true, correct: true, chars: x.f.answers[0]?.length ?? 0, learning: x.learning });
  applyPending(g.rating);
}
setInterval(() => {
  const r = S.review;
  if (!r?.cardId || r.show) return;
  const bar = document.getElementById("rv-bar"), txt = document.getElementById("rv-time");
  if (!bar || !txt) return;
  const x = ctx();
  if (!x) return;
  const think = thinkMs(r), exp = expectedMs(r.baseline, x.typedMode, x.f.answers[0]?.length ?? 0);
  bar.style.width = Math.min(100, (think / (exp * 2.2)) * 100) + "%";
  bar.className = "sp-" + speedOf(think, exp);
  txt.textContent = t("{n} с", { n: (think / 1000).toFixed(1) });
}, 100);

// ---------- каталог колод ----------
const langName = (code: string) => (LANGS[code] ? LANGS[code]![getLang() === "en" ? 1 : 0] : code.toUpperCase());
const deckTitle = (d: CatalogDeck) => (getLang() === "en" && d.title_en ? d.title_en : d.title);
const deckDesc = (d: CatalogDeck) => (getLang() === "en" && d.description_en ? d.description_en : d.description);
const sourceKey = (d: CatalogDeck) => `${d.source}:${d.id}`;
const installed = () => new Map(allDecks().filter((d) => d.source).map((d) => [d.source.split("@")[0]!, d]));

async function openBrowser(tab: "spark" | "community" | "web" = "spark") {
  S.browser = { tab, q: "", lang: "", loading: true, error: "", decks: [], open: null, cards: null, busy: false };
  render();
  await reloadCatalog();
}
async function reloadCatalog() {
  const b = S.browser;
  if (!b) return;
  b.loading = true; b.error = "";
  const [spark, community, mine] = await Promise.all([
    loadSparkCatalog(),
    communityAvailable() ? loadCommunity().catch((e) => { b.error = String(e.message || e); return [] as CatalogDeck[]; }) : Promise.resolve([] as CatalogDeck[]),
    communityAvailable() && getSession() ? myPublished().catch(() => [] as MyPublished[]) : Promise.resolve([] as MyPublished[]),
  ]);
  published = mine;
  if (S.browser !== b) return;
  b.decks = [...spark, ...community];
  b.loading = false;
  renderBrowser();
}

function renderTips() {
  const el = $("tips"), tp = S.tips;
  el.classList.toggle("on", !!tp);
  if (!tp) { el.innerHTML = ""; return; }
  const L = getLang(), sec = TIPS.find((x) => x.id === tp.tab) ?? TIPS[0]!;
  const tabs = `<div class="seg br-tabs">${TIPS.map((x) => `<button data-a="tips-tab" data-k="${x.id}" class="${x.id === sec.id ? "on" : ""}">${ic(x.icon)}<span>${(x.tab || x.title)[L]}</span></button>`).join("")}</div>`;
  el.innerHTML = `<div class="br-top"><button class="icon-btn" data-a="tips-close" title="${t("Закрыть")}">${ic("close")}</button><h1>${t("Советы")}</h1>${tabs}</div>
    <div class="br-body"><div class="tips-h">${esc(sec.title[L])}</div><div class="tips-list">${sec.items.map((it, i) => `<div class="tip"><div class="tip-n">${i + 1}</div><div class="tip-main"><b>${esc(it.title[L])}</b><p>${esc(it.text[L])}</p></div></div>`).join("")}</div></div>`;
}

function renderBrowser() {
  const el = $("browser"), b = S.browser;
  el.classList.toggle("on", !!b);
  if (!b) { el.innerHTML = ""; return; }
  const tab = (k: string, icon: string, label: string) => `<button data-a="br-tab" data-k="${k}" class="${b.tab === k ? "on" : ""}">${ic(icon)}<span>${label}</span></button>`;
  const tabs = `<div class="seg br-tabs">${tab("spark", "spark", APP)}${tab("community", "users", t("Сообщество"))}${tab("web", "globe", t("Браузер"))}</div>`;
  const head = `<div class="br-top"><button class="icon-btn" data-a="br-close" title="${t("Закрыть")}">${ic("close")}</button><h1>${t("Каталог колод")}</h1><button class="icon-btn" data-a="import-decks" title="${t("Импорт файла (.apkg, .csv, .txt)")}">${ic("import")}</button>${tabs}</div>`;
  if (b.open) { el.innerHTML = head + `<div class="br-body">${deckDetailHtml(b)}</div>`; media(el); return; }
  if (b.tab === "web") { el.innerHTML = head + `<div class="br-body">${webHtml()}</div>`; return; }
  const inst = installed();
  const pool = b.decks.filter((d) => (b.tab === "spark" ? d.source === "spark" && (!d.natives || d.natives.includes(getLang())) : d.source === "community"));
  const langs = [...new Set(pool.flatMap((d) => [d.lang_front, d.lang_back]).filter(Boolean))].sort();
  const q = b.q.trim().toLowerCase();
  const list = pool.filter((d) => (!b.lang || d.lang_front === b.lang || d.lang_back === b.lang)
    && (!q || `${d.title} ${d.title_en ?? ""} ${d.description} ${d.description_en ?? ""} ${d.tags.join(" ")} ${d.author ?? ""}`.toLowerCase().includes(q)));
  const chip = (code: string, label: string) => `<button class="fchip ${b.lang === code ? "on" : ""}" data-a="br-lang" data-k="${code}">${label}</button>`;
  const tile = (d: CatalogDeck) => {
    const have = inst.get(sourceKey(d));
    return `<button class="tile" data-a="br-open" data-id="${esc(sourceKey(d))}">
      <div class="tile-em">${d.emoji ? esc(d.emoji) : ic("catalog")}</div>
      <div class="tile-main"><div class="tile-t">${esc(deckTitle(d))}</div>
        <div class="tile-d">${esc(deckDesc(d))}</div>
        <div class="tile-m"><span>${t("{n} карт.", { n: d.count })}</span>${d.lang_front ? `<span>${esc(langName(d.lang_front))}${d.lang_back && d.lang_back !== d.lang_front ? " → " + esc(langName(d.lang_back)) : ""}</span>` : ""}
          ${d.audio ? `<span>${ic("sound", "tiny")} ${t("со звуком")}</span>` : ""}${d.source === "community" ? `<span>${esc(d.author || t("пользователь"))}</span>${d.downloads ? `<span>${ic("import", "tiny")} ${d.downloads}</span>` : ""}` : ""}${have ? `<span class="have">${ic("check", "tiny")} ${t("добавлена")}</span>` : ""}</div></div></button>`;
  };
  const search = `<input type="search" id="br-q" class="br-search" placeholder="${t("Поиск колод: язык, тема, автор…")}" value="${esc(b.q)}">
    ${langs.length > 1 ? `<div class="fchips">${chip("", t("Все"))}${langs.map((l) => chip(l, langName(l))).join("")}</div>` : ""}`;
  const grid = b.loading ? `<div class="empty"><div class="em spin">${ic("sync")}</div>${t("Загружаю каталог…")}</div>`
    : list.length ? `<div class="tiles">${list.map(tile).join("")}</div>` : `<div class="empty"><div class="em">${ic("search")}</div>${b.tab === "community" && !pool.length ? t("Пока никто не опубликовал колоду — станьте первым!") : t("Ничего не найдено")}</div>`;
  if (b.tab === "spark") { el.innerHTML = head + `<div class="br-body">${search}${grid}</div>`; return; }
  // Сообщество: заметная кнопка публикации + мои публикации + колоды пользователей
  const ses = getSession();
  const mine = published.map((p) => ({ p, d: allDecks().find((x) => x.id === p.local_deck_id) })).filter((x) => x.d);
  const shareCard = `<div class="share-card"><div class="share-ic">${ic("share")}</div><div class="share-main"><b>${t("Поделитесь своей колодой")}</b>
      <span>${!communityAvailable() ? t("Публикация заработает, когда владелец приложения подключит сервер (SETUP.md).")
        : !ses || !store.syncOn ? t("Чтобы публиковать, включите синхронизацию в Настройках — в Telegram вход автоматический.")
        : t("Выберите колоду — её смогут найти и добавить себе все пользователи {app}.", { app: APP })}</span></div>
      <button class="btn" data-a="share-pick" ${communityAvailable() && ses && store.syncOn ? "" : "disabled"}>${t("Опубликовать колоду")}</button></div>
    ${mine.length ? `<div class="sec-t">${t("Мои публикации")}</div><div class="group">${mine.map(({ p, d }) => `<div class="item"><span>${d!.emoji ? esc(d!.emoji) + " " : ""}${esc(d!.name)}<br><span class="muted" style="font-size:12px">${t("скачиваний: {n}", { n: p.downloads })}</span></span><span class="row-ctl"><button class="btn sec" data-a="pub-edit" data-id="${d!.id}">${t("Обновить")}</button></span></div>`).join("")}</div>` : ""}`;
  const err = b.error ? `<p class="hint">${ic("alert", "tiny")} ${t("Не удалось загрузить колоды пользователей")}: ${esc(b.error)}</p>` : "";
  el.innerHTML = head + `<div class="br-body">${shareCard}<div class="sec-t">${t("Колоды пользователей")}</div>${communityAvailable() ? search + grid : `<div class="empty"><div class="em">${ic("users")}</div>${t("Колоды пользователей появятся, когда подключён сервер синхронизации.")}</div>`}${err}</div>`;
}

function deckDetailHtml(b: Browser): string {
  const d = b.open!, have = installed().get(sourceKey(d));
  const cards = b.cards;
  const sample = cards ? cards.slice(0, 12).map((c) => localizeCard(c, deckNative(d))).map((c) => `<div class="sample"><div class="s-q">${fmt(c.front)}${c.hint ? `<div class="hint-line">${fmt(c.hint)}</div>` : ""}</div><div class="s-a">${fmt(c.back ?? "")}${c.extra ? `<div class="s-x">${fmt(c.extra)}</div>` : ""}</div></div>`).join("") : `<div class="muted">${t("Загружаю карточки…")}</div>`;
  const outdated = have && d.source === "spark" && Number(have.source.split("@")[1] ?? 0) < d.version;
  return `<div class="detail">
    <button class="btn sec" data-a="br-back">${ic("back")} ${t("Назад к каталогу")}</button>
    <div class="d-hero"><div class="d-em">${d.emoji ? esc(d.emoji) : ic("catalog")}</div><div><h2>${esc(deckTitle(d))}</h2>
      <div class="tile-m"><span>${t("{n} карт.", { n: d.count })}</span>${d.lang_front ? `<span>${esc(langName(d.lang_front))}${d.lang_back && d.lang_back !== d.lang_front ? " → " + esc(langName(d.lang_back)) : ""}</span>` : ""}<span>${d.source === "spark" ? APP : esc(d.author || t("пользователь"))}</span>${d.downloads ? `<span>${ic("import", "tiny")} ${d.downloads}</span>` : ""}</div></div></div>
    <p class="d-desc">${esc(deckDesc(d))}</p>
    <div class="d-actions">${have
      ? `<button class="btn" data-a="br-goto" data-id="${have.id}">${t("Открыть в моих колодах")}</button>${outdated ? `<button class="btn sec" data-a="br-add" ${b.busy ? "disabled" : ""}>${b.busy ? t("Обновляю…") : t("Обновить колоду")}</button>` : ""}`
      : `<button class="btn big" data-a="br-add" ${b.busy || !cards ? "disabled" : ""}>${b.busy ? t("Добавляю…") : t("Добавить в мои колоды")}</button>`}</div>
    <div class="sec-t">${t("Примеры карточек")}</div><div class="samples">${sample}</div></div>`;
}

async function openCatalogDeck(key: string) {
  const b = S.browser;
  if (!b) return;
  const d = b.decks.find((x) => sourceKey(x) === key);
  if (!d) return;
  b.open = d; b.cards = null; renderBrowser(); updateChrome();
  try { b.cards = d.source === "spark" ? await loadSparkCards(d) : await loadCommunityCards(d.id); }
  catch (e) { toast(t("Не удалось загрузить колоду") + ": " + (e as Error).message); b.open = null; }
  if (S.browser === b) renderBrowser();
}

/** На каком языке перевод встроенной колоды: язык интерфейса, если колода его поддерживает. */
const deckNative = (d: CatalogDeck) => (!d.natives || d.natives.includes(getLang()) ? getLang() : d.natives[0]!);
async function addCatalogDeck() {
  const b = S.browser;
  if (!b?.open || !b.cards || b.busy) return;
  b.busy = true; renderBrowser();
  const d = b.open, have = installed().get(sourceKey(d));
  const cardsL = b.cards.map((c) => localizeCard(c, deckNative(d)));
  const deckId = have?.id ?? store.addDeck(deckTitle(d));
  if (!have && d.emoji) store.set("deck", deckId, "emoji", d.emoji);
  store.set("deck", deckId, "source", `${sourceKey(d)}@${d.version}`);
  // звук произношения — заранее на устройство, чтобы работал и без сети
  if (d.source === "spark") { const media = await loadDeckMedia(d.id); for (const [k, blob] of media) await putLocal(k, blob).catch(() => {}); }
  // карточки сравниваем без медиа-меток: так обновление колоды не создаёт дубликатов
  const same = (s: string) => norm(stripMedia(s ?? ""));
  const existing = new Map(allCards().filter((c) => c.deckId === deckId).map((c) => [same(c.front) + "\u0000" + same(c.back), c]));
  let added = 0, updated = 0;
  for (const c of cardsL) {
    const cur = existing.get(same(c.front) + "\u0000" + same(c.back ?? ""));
    if (cur) {
      // дополнить уже добавленную карточку: звук, произношение, пояснение — правки пользователя не трогаем
      let ch = false;
      const up = (f: "front" | "back" | "hint" | "extra", v: string | undefined, ok: boolean) => { if (v && ok && cur[f] !== v) { store.set("card", cur.id, f, v); ch = true; } };
      // звук ставим, если его нет, или меняем, если это наш прежний звук из каталога («слово [audio](media:…)» через пробел)
      const ours = (v: string) => !mediaRefs(v).length || /^[^\n]* \[audio\]\(media:[0-9a-f]+\)$/.test(v);
      up("front", c.front, ours(cur.front));
      up("back", c.back, ours(cur.back));
      up("hint", c.hint, !cur.hint || (c.hint ?? "").includes(cur.hint));
      up("extra", c.extra, !cur.extra);
      if (ch) updated++;
      continue;
    }
    store.addCardFull({ deckId, front: c.front, back: c.back ?? "", hint: c.hint, extra: c.extra, tags: c.tags,
      ...(c.kind === "cloze" ? { kind: "cloze", n: c.n ?? 1 } : {}) });
    if (++added % 200 === 0) await new Promise((r) => setTimeout(r));
  }
  haptic("success");
  b.busy = false;
  toast(have ? t("Колода обновлена: новых {n}, дополнено {u}", { n: added, u: updated }) : t("Колода добавлена: {n} карточек", { n: added }));
  renderBrowser(); renderDecks(); if (S.deckId === deckId) { renderList(); renderEditor(); }
}


// ================= Курсы =================
type L2key = "ru" | "en";
const UNIT_COLORS = ["#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6", "#ef4444", "#10b981", "#06b6d4", "#f97316"];
const courseDeck = (id: string) => allDecks().find((d) => d.source.startsWith(`course:${id}@`)) ?? null;
const unitTag = (u: string) => "unit-" + u;
const courseNative = (c: Course): L2key => (c.natives.includes(getLang()) ? getLang() : c.natives[0]!) as L2key;
const uiL = (): L2key => (getLang() === "en" ? "en" : "ru");
const visibleCourses = (list: Course[]) => list.filter((c) => c.natives.includes(getLang()));
const hours = (min: number) => (min < 60 ? t("{n} мин", { n: min }) : t("~{n} ч", { n: Math.round(min / 6) / 10 }));
interface UnitStat { total: number; added: number; studied: number; status: "done" | "progress" | "open" | "locked" }
function courseStats(c: Course) {
  const deck = courseDeck(c.id), byUnit = new Map<string, { added: number; studied: number }>();
  if (deck) for (const card of allCards()) {
    if (card.deckId !== deck.id) continue;
    const u = card.tags.split(/\s+/).find((x) => x.startsWith("unit-"))?.slice(5);
    if (!u) continue;
    const o = byUnit.get(u) ?? { added: 0, studied: 0 };
    o.added++;
    const st = store.states.get(card.id);
    if (st && st.phase !== "new") o.studied++;
    byUnit.set(u, o);
  }
  let prevDone = true;
  const units: UnitStat[] = c.units.map((u) => {
    const o = byUnit.get(u.id) ?? { added: 0, studied: 0 };
    const status = o.studied >= u.count ? "done" : o.added || o.studied ? "progress" : prevDone ? "open" : "locked";
    prevDone = status === "done";
    return { total: u.count, added: o.added, studied: Math.min(o.studied, u.count), status };
  });
  const studied = units.reduce((a, u) => a + u.studied, 0);
  return { deck, units, studied, done: units.filter((u) => u.status === "done").length, pct: c.words ? Math.round((studied / c.words) * 100) : 0 };
}

async function openCourses(id: string | null = null) {
  S.courses = { open: id, list: embeddedCourses(), cards: null, busy: false };
  render();
  const list = await loadCourses();
  if (S.courses) { S.courses.list = list; renderCourses(); }
}
function courseTile(c: Course): string {
  const L = uiL(), st = courseStats(c);
  return `<button class="ctile" data-a="crs-open" data-id="${c.id}">
    <div class="ct-top"><span class="flag">${c.flag}</span><span class="lvl-badge">${esc(c.level[L])}</span>${c.audio ? `<span class="ct-snd">${ic("sound", "tiny")}</span>` : ""}</div>
    <div class="ct-t">${esc(c.title[L])}</div>
    <div class="ct-m">${t("{n} уровней", { n: c.units.length })} · ${t("{n} слов", { n: c.words })} · ${hours(c.minutes)}</div>
    ${st.deck ? `<div class="pbar"><i style="width:${Math.max(st.pct, 2)}%"></i><span>${t("{a}/{b} уровней", { a: st.done, b: c.units.length })}</span><span>${t("{a}/{b} слов", { a: st.studied, b: c.words })}</span></div>` : ""}
  </button>`;
}
function renderCourses() {
  const el = document.getElementById("courses");
  if (!el) return;
  const cs = S.courses;
  el.classList.toggle("on", !!cs);
  if (!cs) { el.innerHTML = ""; return; }
  const L = uiL(), course = cs.open ? cs.list.find((c) => c.id === cs.open) : null;
  if (!course) {
    const list = visibleCourses(cs.list);
    el.innerHTML = `<div class="br-top"><button class="icon-btn" data-a="crs-close" title="${t("Закрыть")}">${ic("close")}</button><h1>${t("Курсы")}</h1></div>
      <div class="br-body"><p class="crs-intro">${t("Курсы — это путь по уровням: слова, произношение, озвучка и примеры. Уровни открываются по очереди. Колоды из каталога остаются отдельно.")}</p>
      <div class="ctiles">${list.map(courseTile).join("") || `<div class="muted">${t("Курсы загружаются…")}</div>`}</div></div>`;
    return;
  }
  const st = courseStats(course), N = courseNative(course);
  const next = course.units.findIndex((_, i) => st.units[i]!.status === "open" || st.units[i]!.status === "progress");
  const units = course.units.map((u, i) => {
    const us = st.units[i]!, badge = us.status === "done" ? `<span class="ub done">${t("пройден")}</span>` : us.status === "progress" ? `<span class="ub prog">${t("в процессе")} · ${us.studied}/${us.total}</span>` : "";
    return `<button class="unit ${us.status}" data-a="crs-unit" data-id="${u.id}" ${cs.busy ? "disabled" : ""}>
      <span class="u-ic" style="--u:${UNIT_COLORS[i % UNIT_COLORS.length]}">${us.status === "locked" ? ic("lock") : us.status === "done" ? ic("check") : `<b>${i + 1}</b>`}</span>
      <span class="u-main"><span class="u-t">${esc(u.title[L])}</span><span class="u-m">${t("{n} слов", { n: u.count })} ${badge}</span></span>
      ${us.status === "locked" ? "" : ic("chevron", "u-chev")}</button>`;
  }).join("");
  const dueCount = st.deck ? sum(scan(Date.now(), allCards().filter((c) => c.deckId === st.deck!.id), allDecks())).r : 0;
  el.innerHTML = `<div class="c-hero"><div class="c-hero-top"><button class="icon-btn" data-a="crs-back" title="${t("Назад")}">${ic("back")}</button><span class="flag big">${course.flag}</span><button class="icon-btn" data-a="crs-close" title="${t("Закрыть")}">${ic("close")}</button></div>
      <h1>${esc(course.title[L])}</h1><div class="c-sub"><span class="lvl-badge">${esc(course.level[L])}</span> · ${t("{n} уровней", { n: course.units.length })}</div>
      <div class="pbar big"><i style="width:${Math.max(st.pct, 2)}%"></i><span>${st.pct}%</span></div>
      <div class="c-acts"><button class="btn" data-a="crs-next" ${cs.busy ? "disabled" : ""}>${ic("play")} ${cs.busy ? t("Загружаю…") : st.deck ? t("Продолжить") : t("Начать курс")}</button>
        <button class="btn sec" data-a="crs-review" ${st.deck ? "" : "disabled"}>${ic("sync")} ${t("Повторить")}${dueCount ? ` · ${dueCount}` : ""}</button></div></div>
    <div class="br-body c-body">
      <div class="sec-t">${t("Описание")}</div><p class="c-desc">${esc(course.description[L])}</p>
      <div class="c-info"><div><b>${course.words}</b><span>${t("слов")}</span></div><div><b>${hours(course.minutes)}</b><span>${t("длительность")}</span></div>
        <div><b>${course.units.length}</b><span>${t("уровней")}</span></div><div><b>${N === "ru" ? "RU" : "EN"}</b><span>${t("язык перевода")}</span></div></div>
      <div class="sec-t">${t("Уровни")}</div><div class="units">${units}</div>
      ${next < 0 && st.deck ? `<p class="muted c-fin">${t("Все уровни пройдены! Повторяйте курс, чтобы слова не забывались.")}</p>` : ""}</div>`;
}
async function startUnit(courseId: string, unitId: string) {
  const cs = S.courses, course = cs?.list.find((c) => c.id === courseId);
  if (!cs || !course || cs.busy) return;
  const i = course.units.findIndex((u) => u.id === unitId), st = courseStats(course);
  if (st.units[i]?.status === "locked") { toast(t("Сначала пройдите уровень «{u}»", { u: course.units[i - 1]!.title[uiL()] })); return; }
  cs.busy = true; renderCourses();
  try {
    const cards = await loadCourseCards(course), N = courseNative(course);
    let deck = courseDeck(course.id);
    const deckId = deck?.id ?? store.addDeck(course.title[N]);
    if (!deck) { store.set("deck", deckId, "emoji", course.flag); store.set("deck", deckId, "source", `course:${course.id}@${course.version}`); store.set("deck", deckId, "native", N); }
    const have = new Set(allCards().filter((c) => c.deckId === deckId).flatMap((c) => c.tags.split(/\s+/)));
    for (const c of cards.filter((x) => x.unit === unitId && !have.has("w-" + x.id)))
      store.addCardFull({ deckId, front: c.front, back: c.back[N], hint: c.hint, extra: c.extra[N], tags: `${unitTag(unitId)} w-${c.id}` });
    const media = await loadDeckMedia(courseMediaId(course.id));
    for (const [k, blob] of media) await putLocal(k, blob).catch(() => {});
    cs.busy = false;
    renderDecks();
    startReview(deckId, { tag: unitTag(unitId), title: `${course.flag} ${course.units[i]!.title[uiL()]}` });
  } catch (e) { cs.busy = false; toast(t("Не удалось загрузить курс") + ": " + (e as Error).message); renderCourses(); }
}
function courseNext(courseId: string) {
  const course = S.courses?.list.find((c) => c.id === courseId);
  if (!course) return;
  const st = courseStats(course);
  const i = course.units.findIndex((_, k) => st.units[k]!.status === "progress" || st.units[k]!.status === "open");
  if (i >= 0) void startUnit(courseId, course.units[i]!.id);
  else if (st.deck) startReview(st.deck.id);
}

// ================= Главная: шапка с серией, опытом и курсами =================
function heroHtml(): string {
  const st = dayStreak(), x = xpStats(store.reviews), u = tgUser(), lv = dayLevel(st.streak);
  const learned = [...store.states.values()].filter((s) => s.phase !== "new").length;
  const name = u?.first_name || t("Мой Spark");
  const photo = (u as { photo_url?: string } | null)?.photo_url;
  const avatar = photo ? `<img src="${esc(photo)}" alt="">` : `<span>${esc((u?.first_name ?? "S").slice(0, 1).toUpperCase())}</span>`;
  const next = DAY_LEVELS[lv + 1], pct = Math.round(((x.total - x.levelFrom) / Math.max(1, x.levelTo - x.levelFrom)) * 100);
  const sub = !st.studiedToday ? (st.streak > 0 ? t("Позанимайтесь сегодня, чтобы не прервать серию") : t("Начните серию — позанимайтесь сегодня"))
    : [lv ? t(DAY_NAMES[lv]!) : "", next ? t("дальше — «{name}» через {n} дн.", { name: t(DAY_NAMES[lv + 1]!), n: next - st.streak }) : ""].filter(Boolean).join(" · ");
  const n = (v: number) => v.toLocaleString(getLang() === "en" ? "en-US" : "ru-RU");
  return `<div class="hero ${st.studiedToday ? "" : "pending"}" style="--c:${dayColor(lv)}">
    <div class="hero-top"><button class="hero-user" data-a="settings"><span class="av">${avatar}</span><span class="nm">${esc(name)}</span>${ic("chevron")}</button>
      <button class="hero-lvl" data-a="stats" title="${t("{a} из {b} опыта до следующего уровня", { a: n(x.total - x.levelFrom), b: n(x.levelTo - x.levelFrom) })}">${ic("spark")}<span>${t("Ур. {n}", { n: x.level })}</span><i><b style="width:${pct}%"></b></i></button></div>
    <button class="hero-streak" data-a="stats"><span class="hs-ic">${dayMark(lv, "xl")}</span><span class="hs-n">${st.streak}</span></button>
    <button class="hs-cap" data-a="stats">${t("дней подряд")} ${ic("chevron")}</button>
    <div class="hs-sub">${sub}</div>
    <div class="hero-tiles"><div class="ht"><b>${ic("spark")} ${n(x.total)}</b><span>${t("Всего опыта")}${x.today ? ` · +${n(x.today)} ${t("сегодня")}` : ""}</span></div>
      <div class="ht"><b>${ic("layers")} ${n(learned)}</b><span>${t("Слов изучено")}</span></div></div></div>`;
}
function myCoursesHtml(): string {
  const all = embeddedCourses(), mine = all.filter((c) => courseDeck(c.id));
  const L = uiL();
  const head = `<div class="sec-h"><span>${t("Мои курсы")}</span><button class="link" data-a="courses-open">${t("Все курсы")} ${ic("chevron")}</button></div>`;
  if (!mine.length) {
    const flags = visibleCourses(all).map((c) => c.flag).join(" ");
    return head + `<button class="mc promo" data-a="courses-open"><span class="mc-flags">${flags}</span><span class="mc-t">${t("Курсы по уровням")}</span>
      <span class="mc-d">${t("Слова, произношение, озвучка и примеры — шаг за шагом")}</span><span class="mc-go">${t("Выбрать курс")} ${ic("chevron")}</span></button>`;
  }
  return head + mine.map((c) => { const st = courseStats(c); return `<button class="mc" data-a="crs-home" data-id="${c.id}">
    <span class="mc-top"><span class="flag">${c.flag}</span><span class="lvl-badge">${esc(c.level[L])}</span></span><span class="mc-t">${esc(c.title[L])}</span>
    <span class="pbar"><i style="width:${Math.max(st.pct, 2)}%"></i><span>${t("{a}/{b} уровней", { a: st.done, b: c.units.length })}</span><span>${t("{a}/{b} слов", { a: st.studied, b: c.words })}</span></span></button>`; }).join("");
}

function webHtml(): string {
  const cats = ["English", "Spanish", "German", "French", "Japanese", "Chinese", "Geography", "Medicine", "Biology", "History"];
  return `<div class="anki">
    <div class="a-card"><h3>${t("Готовые колоды из интернета")}</h3>
      <p>${t("Больше всего готовых колод — на AnkiWeb (сайт приложения Anki). Его правила разрешают скачивать колоды только через сайт, поэтому поиск откроется в браузере, а скачанный файл вы добавите сюда — вместе с картинками и звуком.")}</p>
      <ol class="steps"><li>${t("Найдите колоду и нажмите «Download» на её странице.")}</li><li>${t("Вернитесь сюда и выберите скачанный .apkg.")}</li><li>${t("Готово: колода появится в «Моих колодах».")}</li></ol></div>
    <div class="a-search"><input type="search" id="ank-q" placeholder="${t("Что ищем? Например: English 4000")}"><button class="btn" data-a="ank-go">${ic("external")} ${t("Искать")}</button></div>
    <div class="fchips">${cats.map((c) => `<button class="fchip" data-a="ank-cat" data-k="${c}">${c}</button>`).join("")}</div>
    <div class="a-import"><button class="btn big" data-a="import-decks">${ic("import")} ${t("Выбрать скачанный файл (.apkg, .csv)")}</button></div>
    <p class="hint">${t("Колоды AnkiWeb лицензируются авторами для личного изучения, поэтому их нельзя публиковать в «Сообществе». Прогресс из Anki не переносится — карточки начнутся как новые.")}</p></div>`;
}
const ankiUrl = (q: string) => `https://ankiweb.net/shared/decks${q.trim() ? "?search=" + encodeURIComponent(q.trim()) : ""}`;

// ---------- публикация своей колоды ----------
let published: MyPublished[] = [];
async function openPublish(deckId: string) {
  S.modal = { type: "publish", id: deckId };
  renderModal();
  published = await myPublished().catch(() => []);
  if (S.modal?.type === "publish") renderModal();
}
function publishHtml(deckId: string): string {
  const d = allDecks().find((x) => x.id === deckId);
  if (!d) return "";
  const cards = allCards().filter((c) => c.deckId === deckId && !c.suspended);
  const ses = getSession(), pub = published.find((p) => p.local_deck_id === deckId);
  const blocked = d.source.startsWith("apkg") ? t("Колоды, импортированные из Anki, публиковать нельзя: AnkiWeb разрешает их только для личного изучения.")
    : d.source.startsWith("spark:") || d.source.startsWith("community:") ? t("Это колода из каталога — она уже доступна всем.") : "";
  const langOpts = (sel: string) => `<option value="">—</option>` + Object.keys(LANGS).map((k) => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(langName(k))}</option>`).join("");
  const author = ses?.user.telegram?.name || ses?.user.telegram?.username || ses?.user.email.split("@")[0] || "";
  return `<div class="sheet"><h2>${t("Опубликовать в каталоге")}</h2>
    ${blocked ? `<p class="hint" style="margin-left:0">${blocked}</p><div style="text-align:right"><button class="btn" data-a="modal-close">${t("Понятно")}</button></div>` : !ses ? `<p class="hint" style="margin-left:0">${t("Чтобы публиковать колоды, включите синхронизацию (Настройки).")}</p><div style="text-align:right"><button class="btn" data-a="modal-close">${t("Понятно")}</button></div>` : `
    <p class="hint" style="margin-left:0">${t("Колоду увидят все пользователи {app}. Публикуйте только то, что сделали сами. Картинки и звук пока не публикуются — только текст.", { app: APP })}</p>
    <div class="group"><div class="item name-row nowrap"><input type="text" id="p-emoji" value="${esc(d.emoji)}" placeholder="★" maxlength="4"><input type="text" id="p-title" value="${esc(d.name)}" maxlength="80"></div>
      <div class="item"><textarea id="p-desc" maxlength="1000" placeholder="${t("О чём колода, для кого, откуда материал")}" style="min-height:80px"></textarea></div>
      <div class="item"><span>${t("Язык вопросов")}</span><select id="p-lf" style="width:160px">${langOpts("")}</select></div>
      <div class="item"><span>${t("Язык ответов")}</span><select id="p-lb" style="width:160px">${langOpts("")}</select></div>
      <div class="item"><input type="text" id="p-tags" placeholder="${t("теги через пробел")}"></div>
      <div class="item"><span>${t("Автор")}</span><input type="text" id="p-author" value="${esc(author)}" maxlength="40" style="width:180px"></div></div>
    <p class="hint">${t("Карточек: {n}", { n: cards.length })}${pub ? " · " + t("уже опубликована, скачиваний: {n}", { n: pub.downloads }) : ""}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${pub ? `<button class="btn danger" data-a="pub-remove" data-id="${pub.id}">${t("Снять с публикации")}</button>` : ""}<span style="flex:1"></span>
      <button class="btn sec" data-a="modal-close">${t("Отмена")}</button><button class="btn" data-a="pub-go" ${cards.length ? "" : "disabled"}>${pub ? t("Обновить") : t("Опубликовать")}</button></div>`}</div>`;
}
async function doPublish(deckId: string) {
  const g = (id: string) => ($(id) as HTMLInputElement).value.trim();
  const cards: DeckCard[] = allCards().filter((c) => c.deckId === deckId && !c.suspended).map((c) => ({
    front: stripMedia(c.front).trim(), back: stripMedia(c.back).trim(), ...(c.hint ? { hint: c.hint } : {}), ...(c.extra ? { extra: stripMedia(c.extra) } : {}),
    ...(c.tags ? { tags: c.tags } : {}), ...(c.kind === "cloze" ? { kind: "cloze", n: c.n } : {}),
  })).filter((c) => c.front || c.back);
  if (!g("p-title")) return toast(t("Введите название"));
  try {
    await publishDeck({ local_deck_id: deckId, title: g("p-title"), description: g("p-desc"), emoji: g("p-emoji"), lang_front: g("p-lf"), lang_back: g("p-lb"),
      tags: g("p-tags").split(/\s+/).filter(Boolean).slice(0, 10), author_name: g("p-author"), cards });
    haptic("success"); toast(t("Колода опубликована")); S.modal = null; render();
    if (S.browser) void reloadCatalog();
  } catch (e) { toast(t("Не удалось опубликовать") + ": " + (e as Error).message); }
}

// ---------- модальные окна ----------
const SYNC_LABEL = (): Record<string, string> => ({ off: t("выключена"), idle: t("синхронизировано"), syncing: t("идёт обмен…"), error: t("ошибка"), offline: t("нет связи"), auth: t("нужно войти") });

function renderModal() {
  const el = $("modal"), m = S.modal;
  el.classList.toggle("on", !!m);
  if (m?.type !== "record" && rec.state !== "idle") resetRec();
  if (!m) { el.innerHTML = ""; pending = null; return; }
  const s = store.settings;
  if (m.type === "deck") {
    const d = allDecks().find((x) => x.id === m.id);
    el.innerHTML = `<div class="sheet"><h2>${d ? t("Настройки колоды") : t("Новая колода")}</h2>
      <div class="name-row"><input type="text" id="m-emoji" value="${esc(d?.emoji || "")}" placeholder="★" maxlength="4"><input type="text" id="m-name" placeholder="${t("Например, 🇪🇸 Испанский")}" value="${esc(d?.name ?? "")}" maxlength="80"></div>
      <div class="group" style="margin-top:14px">
        <div class="item"><span><b>${t("Ввод ответа с клавиатуры")}</b><br><span class="muted" style="font-size:12px">${t("при верном слове — сразу следующая карточка, без Enter")}</span></span>
          <select id="m-typed" style="width:auto;max-width:100%;padding-right:30px">${([["inherit", t("Как в настройках")], ["on", t("Всегда вводить")], ["off", t("Не вводить")]] as [TypedMode, string][]).map(([v, n]) => `<option value="${v}" ${(d?.typedMode ?? "inherit") === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="item"><span>${t("Новых карточек в день")}<br><span class="muted" style="font-size:12px">${t("пусто — как в общих настройках ({n})", { n: s.newPerDay })}</span></span><input type="number" id="m-new" min="0" max="999" value="${d?.newPerDay ?? ""}" style="width:80px"></div></div>
      ${d ? `<div class="group"><div class="item"><span>${t("Поменять стороны")}<br><span class="muted" style="font-size:12px">${t("лицевая ⇄ обратная у всех карточек колоды")}</span></span><button class="btn sec" data-a="deck-swap">${t("Поменять")}</button></div>
        <div class="item"><span>${t("Обратные копии")}<br><span class="muted" style="font-size:12px">${t("добавить карточки «ответ → вопрос»")}</span></span><button class="btn sec" data-a="deck-rev">${t("Добавить")}</button></div>
        <div class="item"><span>${t("Опубликовать в каталоге")}<br><span class="muted" style="font-size:12px">${t("поделиться колодой со всеми пользователями")}</span></span><button class="btn sec" data-a="deck-publish">${t("Открыть")}</button></div></div>` : ""}
      <div class="actions" style="display:flex;gap:8px;margin-top:16px">
        ${d ? `<button class="btn danger" data-a="deck-del">${t("Удалить")}</button>` : ""}<span style="flex:1"></span>
        <button class="btn sec" data-a="modal-close">${t("Отмена")}</button><button class="btn" data-a="deck-save">${t("Сохранить")}</button></div></div>`;
    if (!isMobile()) $("m-name").focus();
  } else if (m.type === "share-pick") {
    const decks = allDecks();
    const ok = (d: DeckView) => !d.source.startsWith("apkg") && !d.source.startsWith("spark:") && !d.source.startsWith("community:");
    el.innerHTML = `<div class="sheet"><h2>${t("Какую колоду опубликовать?")}</h2>
      <div class="group">${decks.map((d) => { const n = allCards().filter((c) => c.deckId === d.id).length; return `<div class="item"><span>${d.emoji ? esc(d.emoji) + " " : ""}${esc(d.name)}<br><span class="muted" style="font-size:12px">${ok(d) ? t("Карточек: {n}", { n }) : d.source.startsWith("apkg") ? t("из Anki — публиковать нельзя") : t("из каталога")}</span></span>
        <button class="btn sec" data-a="pub-edit" data-id="${d.id}" ${ok(d) && n ? "" : "disabled"}>${t("Выбрать")}</button></div>`; }).join("") || `<div class="item muted">${t("У вас пока нет своих колод")}</div>`}</div>
      <div style="text-align:right;margin-top:10px"><button class="btn sec" data-a="modal-close">${t("Отмена")}</button></div></div>`;
  } else if (m.type === "attach") {
    const a = S.attach;
    el.innerHTML = `<div class="sheet"><h2>${t("Добавить к карточке")}</h2>
      <div class="group"><div class="item"><span>${t("Куда")}</span><span class="seg"><button data-a="att-side" data-k="q" class="${a?.side === "q" ? "on" : ""}">${t("Вопрос")}</button><button data-a="att-side" data-k="a" class="${a?.side !== "q" ? "on" : ""}">${t("Ответ")}</button></span></div></div>
      <div class="att-grid">
        <button class="att-btn" data-a="att-img"><span>${ic("image")}</span>${t("Картинка")}</button>
        <button class="att-btn" data-a="att-video"><span>${ic("video")}</span>${t("Видео")}<small>${t("до {s} с", { s: LIMITS.videoSeconds })}</small></button>
        <button class="att-btn" data-a="att-rec"><span>${ic("mic")}</span>${t("Записать звук")}<small>${t("произношение")}</small></button>
        <button class="att-btn" data-a="att-audio"><span>${ic("sound")}</span>${t("Аудиофайл")}</button></div>
      <div style="text-align:right;margin-top:12px"><button class="btn sec" data-a="modal-close">${t("Отмена")}</button></div></div>`;
  } else if (m.type === "record") {
    const sec = rec.state === "rec" ? ((Date.now() - rec.t0) / 1000).toFixed(1) : "0.0";
    el.innerHTML = `<div class="sheet rec"><h2>${t("Записать звук")}</h2>
      <p class="hint" style="margin-left:0">${t("Например, произношение слова. До {s} секунд.", { s: LIMITS.recordSeconds })}</p>
      <div class="rec-box">
        ${rec.state === "rec" ? `<button class="rec-btn on" data-a="rec-stop" title="${t("Стоп")}">${ic("stop")}</button><div class="rec-live"><i></i>${t("Идёт запись…")}</div>`
          : rec.state === "done" ? `<audio controls src="${rec.url}"></audio>`
          : `<button class="rec-btn" data-a="rec-start" title="${t("Записать")}" ${canRecord() ? "" : "disabled"}>${ic("record")}</button><div class="muted">${canRecord() ? t("Нажмите, чтобы начать запись") : t("Запись недоступна на этом устройстве — выберите аудиофайл")}</div>`}
        <div id="rec-time" class="muted">${rec.state === "rec" ? `${sec} / ${LIMITS.recordSeconds} ${t("с")}` : ""}</div></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn sec" data-a="att-audio">${ic("sound")} ${t("Аудиофайл…")}</button><span style="flex:1"></span>
        <button class="btn sec" data-a="modal-close">${t("Отмена")}</button>${rec.state === "done" ? `<button class="btn sec" data-a="rec-start">${t("Перезаписать")}</button><button class="btn" data-a="rec-save">${t("Сохранить")}</button>` : ""}</div></div>`;
  } else if (m.type === "publish") {
    el.innerHTML = publishHtml(m.id!);
  } else if (m.type === "importdecks" && pending) {
    const p = pending, total = p.result.decks.reduce((n, d, i) => n + (p.sel[i] ? d.cards.length : 0), 0);
    const firstSel = p.result.decks.find((_d, i) => p.sel[i])?.cards[0];
    const list = p.result.decks.slice(0, 300).map((d, i) => `<div class="item"><input type="checkbox" class="check" data-sel="${i}" ${p.sel[i] ? "checked" : ""}>
      <input type="text" data-name="${i}" value="${esc(p.names[i]!)}" style="flex:1"><span class="muted" style="white-space:nowrap">${d.cards.length}</span></div>`).join("");
    el.innerHTML = `<div class="sheet"><h2>${t("Импорт колод")}</h2>
      <p class="hint" style="margin-left:0">${p.result.source === "apkg" ? t("Файл Anki (.apkg)") : t("Текстовый файл")}: ${t("найдено колод — {n}. Отметьте нужные и при желании измените названия.", { n: p.result.decks.length })}</p>
      <div class="group" style="max-height:260px;overflow:auto">${list}</div>
      <div class="group">${switchRow("i-merge", p.merge, t("Добавлять в существующую колоду с тем же названием"))}
        ${switchRow("i-dup", p.skipDup, t("Пропускать дубликаты"))}</div>
      ${firstSel ? `<div class="preview" style="margin:10px 0;padding:12px 14px"><div class="pk">${t("Пример карточки")}</div><div>${fmt(firstSel.front.replace(/\(file:/g, "(x:")) || "…"}</div><div class="a" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">${fmt(firstSel.back.replace(/\(file:/g, "(x:")) || "…"}</div></div>` : ""}
      ${p.result.media.size ? `<p class="hint">${t("Картинки и звук: {n} файлов — будут добавлены вместе с карточками.", { n: p.result.media.size })}</p>` : ""}
      ${p.result.skippedMedia ? `<p class="hint">${t("Не найдено в файле: {n} медиафайлов — они будут пропущены.", { n: p.result.skippedMedia })}</p>` : ""}
      ${p.result.source === "apkg" ? `<p class="hint">${t("Прогресс повторений из Anki не переносится: все карточки импортируются как новые. Вложенные колоды становятся плоскими («Родитель › Дочерняя»).")}</p>` : ""}
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><span class="muted">${t("Карточек: {n}", { n: total })}</span><span style="flex:1"></span>
        <button class="btn sec" data-a="modal-close">${t("Отмена")}</button><button class="btn" data-a="import-run" ${total && !p.running ? "" : "disabled"}>${p.running ? t("Импортирую…") : t("Импортировать")}</button></div></div>`;
  } else if (m.type === "choose") {
    el.innerHTML = `<div class="sheet"><div class="logo">${__LOGO__}</div><h2 style="text-align:center;margin-bottom:4px">${t("Где хранить колоды?")}</h2>
      <p class="hint" style="text-align:center">${t("Это можно изменить позже в настройках.")}</p>
      <button class="choice" data-a="choose-cloud"><b>${t("На всех устройствах")}</b><span>${inTelegram() ? t("Вход через Telegram, без пароля. Колоды и прогресс доступны везде, где есть ваш Telegram.") : t("Нужен аккаунт (email и пароль). Колоды и прогресс доступны на всех устройствах.")}</span></button>
      <button class="choice" data-a="choose-local"><b>${t("Только на этом устройстве")}</b><span>${t("Без аккаунта. Ничего не уходит в сеть.")}</span></button></div>`;
  } else if (m.type === "paste") {
    el.innerHTML = `<div class="sheet"><h2>${t("Вставить копию данных")}</h2>
      <p class="hint" style="margin-left:0">${t("Вставьте текст копии, скопированный из {app} («Копировать копию»). Данные объединятся с текущими.", { app: APP })}</p>
      <textarea id="m-paste" style="min-height:160px" placeholder='{"app":"recall",…}'></textarea>
      <div style="display:flex;gap:8px;margin-top:14px"><span style="flex:1"></span><button class="btn sec" data-a="modal-close">${t("Отмена")}</button><button class="btn" data-a="paste-run">${t("Загрузить")}</button></div></div>`;
  } else if (m.type === "import") {
    el.innerHTML = `<div class="sheet"><h2>${t("Добавить списком")}</h2>
      <p class="hint" style="margin-left:0">${t("По одной карточке в строке: слово — перевод (также работает табуляция, «;» или «,»). Попадут в выбранную колоду.")}</p>
      <textarea id="m-bulk" style="min-height:200px" placeholder="hola — ${t("привет")}&#10;gracias — ${t("спасибо")}"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn sec" data-a="file-pick">${t("Выбрать файл…")}</button><span style="flex:1"></span>
      <button class="btn sec" data-a="modal-close">${t("Отмена")}</button><button class="btn" data-a="bulk-add">${t("Добавить")}</button></div></div>`;
    if (!isMobile()) $("m-bulk").focus();
  } else if (m.type === "settings") {
    const sw = ["#3390ec", "#34c759", "#af52de", "#7c3aed", "#ff9500", "#ff2d55"].map((c) => `<button data-a="accent" data-c="${c}" class="${s.accent === c ? "on" : ""}" style="background:${c}"></button>`).join("");
    const th = (["auto", "light", "dark"] as const).map((x, i) => `<button data-a="theme" data-t="${x}" class="${s.theme === x ? "on" : ""}">${[t("Авто"), t("Светлая"), t("Тёмная")][i]}</button>`).join("");
    const lg = ([["auto", t("Авто")], ["ru", "Русский"], ["en", "English"]] as [string, string][]).map(([v, n]) => `<button data-a="lang" data-k="${v}" class="${(s.lang ?? "auto") === v ? "on" : ""}">${n}</button>`).join("");
    el.innerHTML = `<div class="sheet"><h2>${t("Настройки")}</h2>
      ${accountGroup()}
      <h3 class="grp-t">${t("Внешний вид")}</h3>
      <div class="group"><div class="item"><span>${t("Язык")}</span><span class="seg">${lg}</span></div>
        <div class="item"><span>${t("Тема")}</span><span class="seg">${th}</span></div>
        <div class="item"><span>${t("Цвет акцента")}</span><span class="sw">${sw}</span></div></div>
      ${inTelegram() ? `<p class="hint">${t("«Авто» — светлая или тёмная, как в Telegram. Цвета у Spark свои.")}</p>` : ""}
      ${launchGroup()}
      <h3 class="grp-t">${t("Повторение")}</h3>
      <div class="group"><div class="item"><span>${t("Желаемое удержание")}<br><span class="muted" style="font-size:12px">${Math.round(s.retention * 100)}%</span></span>
        <input type="range" min="0.7" max="0.97" step="0.01" value="${s.retention}" id="s-ret"></div>
        <div class="item"><span>${t("Новых карточек в день")}</span><input type="number" id="s-new" min="0" max="999" value="${s.newPerDay}" style="width:80px"></div>
        ${switchRow("s-typed", s.typedAll, t("Вводить ответы с клавиатуры"), t("при верном слове — сразу следующая карточка, без Enter (можно переопределить для колоды)"))}
        ${switchRow("s-autoaudio", s.autoAudio, t("Автоматически проигрывать звук"), t("произношение звучит при показе карточки и ответа"))}
        ${switchRow("s-manual", s.manualGrades, t("Оценивать вручную (4 кнопки)"), t("по умолчанию выключено: сложность определяет умный таймер"))}</div>
      <p class="hint">${t("Умный таймер замеряет, сколько вы думали, и сравнивает с вашей нормой. Быстро — вернётся через дни, с раздумьем — завтра, долго или ошибка — через 5 минут. Не согласны — кнопка «Не помню».")}</p>
      ${filesGroup()}
      <h3 class="grp-t">${t("Резервная копия")}</h3>
      <div class="group"><div class="item"><span>${t("Все колоды и прогресс одним файлом")}</span>${inTelegram()
        ? `<span class="row-ctl"><button class="btn sec" data-a="copy-backup">${t("Копировать")}</button><button class="btn sec" data-a="paste-open">${t("Вставить")}</button></span>`
        : `<span class="row-ctl"><button class="btn sec" data-a="export">${t("Сохранить")}</button><button class="btn sec" data-a="import-pick">${t("Загрузить")}</button></span>`}</div></div>
      <p class="hint">${t("Загрузка копии объединяется с текущими данными, ничего не затирается.")}<br>${APP} ${__VERSION__} · ID ${store.deviceId.slice(0, 8)}</p>
      <div style="text-align:right"><button class="btn" data-a="modal-close">${t("Готово")}</button></div></div>`;
  } else if (m.type === "stats") {
    const now = Date.now(), per = new Map<number, number>();
    for (const r of store.reviews) per.set(dayStart(r.ts), (per.get(dayStart(r.ts)) ?? 0) + 1);
    const today = dayStart(now);
    const streak = dayStreak().streak;
    const month = store.reviews.filter((r) => r.ts > now - 30 * DAY_MS);
    const ret = month.length ? Math.round((month.filter((r) => r.rating > 1).length / month.length) * 100) : null;
    const cards = allCards().filter((c) => !c.suspended);
    let nNew = 0, nLearn = 0, nYoung = 0, nMature = 0;
    const forecast = new Array(14).fill(0) as number[];
    for (const c of cards) {
      const st = store.stateOf(c.id);
      if (st.phase === "new") nNew++; else if (st.phase !== "review") nLearn++; else if (st.stability >= 21) nMature++; else nYoung++;
      if (st.phase === "review") { const d = Math.max(0, Math.floor((dayStart(st.due) - today) / DAY_MS)); if (d < 14) forecast[d]!++; }
    }
    const cells: string[] = [], weeks = isMobile() ? 15 : 20;
    const dow = (new Date(today).getDay() + 6) % 7;
    const first = today - ((weeks - 1) * 7 + dow) * DAY_MS;
    const max = Math.max(1, ...per.values());
    for (let i = 0; i < weeks * 7; i++) {
      const d = first + i * DAY_MS, v = per.get(dayStart(d + 6 * 3600_000)) ?? 0;
      cells.push(d > today ? `<i style="visibility:hidden"></i>` : `<i title="${new Date(d).toLocaleDateString()}: ${v}" style="${v ? `background:color-mix(in srgb,var(--accent) ${25 + 75 * v / max}%,transparent)` : ""}"></i>`);
    }
    const fmax = Math.max(1, ...forecast);
    const seg = (n: number, c: string, l: string) => n ? `<i style="flex:${n};background:${c}" title="${l}: ${n}"></i>` : "";
    el.innerHTML = `<div class="sheet"><h2>${t("Статистика")}</h2><div class="stats3">
      <div><b>${per.get(today) ?? 0}</b><span>${t("сегодня")}</span></div><div class="stat-streak"><b>${streak} ${dayMark(dayLevel(streak), "inline")}</b><span>${t("дней подряд")}</span></div><div><b>${ret == null ? "—" : ret + "%"}</b><span>${t("удержание, 30 дн")}</span></div>
      <div><b>${cards.length}</b><span>${t("карточек")}</span></div><div><b>${nMature}</b><span>${t("зрелых (21+ дн)")}</span></div><div><b>${store.reviews.length}</b><span>${t("всего повторов")}</span></div></div>
      <div class="sec-t">${t("Активность")}</div><div class="heat">${cells.join("")}</div>
      <div class="sec-t">${t("Состав коллекции")}</div><div class="stack">${seg(nNew, "#8e8e93", t("Новые"))}${seg(nLearn, "#ff9500", t("Изучаются"))}${seg(nYoung, "#3390ec", t("Молодые"))}${seg(nMature, "#34c759", t("Зрелые"))}</div>
      <div class="legend"><span><i style="background:#8e8e93"></i>${t("новые")} ${nNew}</span><span><i style="background:#ff9500"></i>${t("изучаются")} ${nLearn}</span><span><i style="background:#3390ec"></i>${t("молодые")} ${nYoung}</span><span><i style="background:#34c759"></i>${t("зрелые")} ${nMature}</span></div>
      <div class="sec-t">${t("Прогноз на 14 дней")} <span class="muted" style="font-weight:400">(${t("повторения по дням")})</span></div>
      <div class="fc">${forecast.map((v, i) => `<div title="${v}"><i style="height:${Math.round((v / fmax) * 56) + (v ? 3 : 1)}px"></i><span>${i === 0 ? t("сег") : i}</span></div>`).join("")}</div>
      <div style="text-align:right;margin-top:10px"><button class="btn" data-a="modal-close">${t("Закрыть")}</button></div></div>`;
  }
}

/** Быстрый запуск: ярлык на главном экране и ссылка, которая открывает Spark сразу, без чата с ботом. */
let homeStatus: string = "unknown";
function botLink(): string {
  const w = window as unknown as { SPARK_CONFIG?: { botUsername?: string }; RECALL_CONFIG?: { botUsername?: string } };
  const u = (w.SPARK_CONFIG?.botUsername || w.RECALL_CONFIG?.botUsername || "Sparkling_app").replace(/^@/, "");
  return u ? `https://t.me/${u}?startapp` : "";
}
function launchGroup(): string {
  if (!inTelegram() && !botLink()) return "";
  const home = homeScreenSupported()
    ? `<div class="item"><span>${t("Ярлык на главном экране")}<br><span class="muted" style="font-size:12px">${homeStatus === "added" ? t("уже добавлен") : t("Spark откроется одним касанием, без чата с ботом")}</span></span>
        <button class="btn ${homeStatus === "added" ? "sec" : ""}" data-a="home-add" ${homeStatus === "added" ? "disabled" : ""}>${homeStatus === "added" ? ic("check", "tiny") + " " + t("Добавлен") : t("Добавить")}</button></div>` : "";
  const link = botLink() ? `<div class="item"><span>${t("Ссылка на Spark")}<br><span class="muted" style="font-size:12px">${esc(botLink().replace("https://", ""))}</span></span><button class="btn sec" data-a="copy-link">${t("Копировать")}</button></div>` : "";
  if (!home && !link) return "";
  return `<h3 class="grp-t">${t("Быстрый запуск")}</h3><div class="group">${home}${link}</div>`;
}

function accountGroup(): string {
  const cfg = getConfig(), ses = getSession(), preset = !!presetConfig();
  const cloud = store.syncOn || getChoice() === "cloud";
  const head = `<h3 class="grp-t">${t("Синхронизация")}</h3>`;
  const toggle = switchRow("s-sync", cloud, t("Колоды и прогресс на всех устройствах"), `${cloud ? (ses && store.syncOn ? `${SYNC_LABEL()[sync.status] ?? ""}${sync.message ? " · " + esc(sync.message) : ""}${store.pendingCount ? " · " + t("ждут отправки: {n}", { n: store.pendingCount }) : ""}` : t("включается…")) : t("выключено: всё хранится только на этом устройстве")}`);
  if (!cloud) return head + `<div class="group">${toggle}</div>`;
  if (!cfg) {
    return head + `<div class="group">${toggle}</div><p class="hint">${t("Сервер синхронизации не настроен. Владельцу приложения: см. инструкцию SETUP.md.")}</p>`
      + (preset ? "" : `<details class="adv"><summary>${t("Указать сервер вручную")}</summary><div class="group"><div class="item"><input type="text" id="sy-url" placeholder="https://xxxx.supabase.co"></div><div class="item"><input type="text" id="sy-key" placeholder="${t("Публичный ключ (anon / publishable)")}"></div><div class="item"><span></span><button class="btn sec" data-a="sy-savecfg">${t("Сохранить")}</button></div></div></details>`);
  }
  if (ses && store.syncOn) {
    const who = ses.user.telegram ? `Telegram · ${esc(ses.user.telegram.name || "@" + ses.user.telegram.username)}` : esc(ses.user.email);
    return head + `<div class="group">${toggle}<div class="item"><span>${who}</span><span class="row-ctl"><button class="btn sec" data-a="sy-now">${t("Обновить")}</button>${ses.user.telegram ? "" : `<button class="btn sec" data-a="sy-logout">${t("Выйти")}</button>`}</span></div></div>
      <p class="hint">${t("Колоды, карточки, прогресс, картинки и настройки сохраняются в аккаунте. Без сети всё работает и отправится позже.")}</p>`;
  }
  if (inTelegram()) {
    return head + `<div class="group">${toggle}<div class="item"><span>${t("Вход через Telegram")}</span><button class="btn" data-a="sy-tg">${t("Войти")}</button></div></div>${sync.message ? `<p class="hint">${ic("alert", "tiny")} ${esc(sync.message)}</p>` : ""}`;
  }
  return head + `<div class="group">${toggle}
    <div class="item"><input type="text" id="sy-email" placeholder="Email" autocomplete="username" inputmode="email"></div>
    <div class="item"><input type="password" id="sy-pass" placeholder="${t("Пароль (от 6 символов)")}" autocomplete="current-password"></div>
    <div class="item"><span class="muted" style="font-size:12px">${t("в Telegram вход не нужен — он автоматический")}</span><span class="row-ctl"><button class="btn sec" data-a="sy-signup">${t("Создать аккаунт")}</button><button class="btn" data-a="sy-login">${t("Войти")}</button></span></div></div>`;
}

async function enableCloudAfterLogin(userId: string) {
  store.enableSync(userId);
  setChoice("cloud");
  setMediaSync((k) => queueMedia([k]), downloadMedia);
  queueMedia((await allMediaKeys()).filter((k) => !bundledDeckOf(k)));
}
/** Telegram: вход сам, без пароля. */
async function telegramLogin(silent: boolean) {
  const cfg = getConfig(), init = tgInitData();
  if (!cfg || !init) return;
  try {
    const ses = await signInTelegram(cfg, init);
    await enableCloudAfterLogin(ses.user.id);
    if (!silent) toast(t("Вы вошли через Telegram"));
    await sync.runNow();
  } catch (e) {
    sync.message = (e as Error).message;
    if (!silent) toast(t("Не удалось войти через Telegram") + ": " + (e as Error).message);
  }
  if (S.modal?.type === "settings") renderModal();
  updateSyncInd();
}
async function doLogin(kind: "login" | "signup") {
  const g = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";
  const cfg = getConfig();
  if (!cfg) return toast(t("Сервер синхронизации не настроен"));
  const email = g("sy-email"), pass = g("sy-pass");
  if (!email || pass.length < 6) return toast(t("Введите email и пароль (от 6 символов)"));
  try {
    const ses = kind === "login" ? await signIn(cfg, email, pass) : await signUp(cfg, email, pass);
    if (!ses) return toast(t("Аккаунт создан. Подтвердите почту по письму и нажмите «Войти»"));
    await enableCloudAfterLogin(ses.user.id);
    toast(t("Вы вошли, синхронизация запущена"));
    renderModal(); await sync.runNow(); renderModal();
  } catch (e) {
    signOut();
    toast(e instanceof TypeError ? t("Нет связи с сервером") : (e as Error).message);
  }
}
async function setCloud(on: boolean) {
  if (!on) {
    setChoice("local");
    if (store.syncOn) { store.disableSync(); setMediaSync(null, null); void sync.runNow(); toast(t("Синхронизация выключена. Данные остались на устройстве")); }
    renderModal(); return;
  }
  setChoice("cloud");
  const ses = getSession();
  if (ses && getConfig()) {
    try { await enableCloudAfterLogin(ses.user.id); void sync.runNow(); toast(t("Синхронизация включена")); } catch (e) { toast((e as Error).message); }
  } else if (inTelegram()) await telegramLogin(false);
  renderModal();
}

function filesGroup(): string {
  if (!fsApi) return "";
  const i = fsInfo;
  const list = i?.backups.map((b) => `<option value="${esc(b.name)}">${esc(b.name.replace(/^recall-|^spark-|\.json$/g, ""))} · ${(b.size / 1024).toFixed(0)} KB</option>`).join("") ?? "";
  return `<h3 class="grp-t">${t("Файлы на компьютере")}</h3><div class="group"><div class="item"><span>${t("Папка данных")}<br><span class="muted" style="font-size:12px;word-break:break-all">${esc(i?.dir ?? "…")}</span></span>
      <span class="row-ctl"><button class="btn sec" data-a="fs-open">${t("Открыть")}</button><button class="btn sec" data-a="fs-choose">${t("Изменить…")}</button></span></div>
    <div class="item"><span>${t("Копии (авто — раз в день)")}<br><span class="muted" style="font-size:12px">${i?.backups.length ?? 0}</span></span>
      <button class="btn sec" data-a="fs-backup">${t("Создать сейчас")}</button></div>
    ${list ? `<div class="item"><select id="s-backup" style="flex:1">${list}</select><button class="btn sec" data-a="fs-restore">${t("Восстановить")}</button></div>` : ""}</div>`;
}
async function refreshFsInfo() { if (fsApi) { fsInfo = await fsApi.info(); if (S.modal?.type === "settings") renderModal(); } }

// ---------- импорт файлов ----------
interface Pending { result: ImportResult; sel: boolean[]; names: string[]; merge: boolean; skipDup: boolean; running: boolean }
let pending: Pending | null = null;

function b64ToFile(name: string, b64: string): File {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new File([u], name);
}
function pickFile() {
  if (fsApi) fsApi.importDialog().then((r) => r && importFile(b64ToFile(r.name, r.b64)));
  else ($("file") as HTMLInputElement).click();
}
async function importFile(file: File) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json")) {
    try { const r = store.importJSON(await file.text()); toast(t("Копия загружена: +{c} изменений, +{r} повторов", { c: r.changes, r: r.reviews })); } catch (e) { toast((e as Error).message); }
    return render();
  }
  try {
    toast(t("Читаю файл…"));
    const result = lower.endsWith(".apkg") || lower.endsWith(".colpkg") ? await parseApkg(new Uint8Array(await file.arrayBuffer())) : parseTable(await file.text(), file.name);
    const decks = result.decks.filter((d) => d.cards.length);
    if (!decks.length) return toast(t("В файле не найдено карточек"));
    const cur = allDecks().find((d) => d.id === S.deckId);
    pending = {
      result: { ...result, decks }, sel: decks.map(() => true), running: false, merge: true, skipDup: true,
      names: decks.map((d) => (result.source === "table" && cur ? cur.name : d.name)),
    };
    S.browser = null;
    S.modal = { type: "importdecks" };
    render();
  } catch (e) { toast(t("Не удалось импортировать") + ": " + (e as Error).message); }
}
async function runImport() {
  const p = pending;
  if (!p || p.running) return;
  p.running = true; renderModal();
  // медиа: сохранить нужные файлы и заменить метки (file:имя) на (media:ключ)
  const keyByName = new Map<string, string>();
  for (const [name, bytes] of p.result.media) {
    try {
      const type = mimeOf(name);
      let blob = new Blob([bytes as BlobPart], { type });
      if (IMAGE_RE.test(name)) blob = await shrinkImage(blob);
      else if (!AUDIO_RE.test(name)) continue;
      keyByName.set(name, await putMedia(blob));
    } catch { /* один битый файл не мешает остальным */ }
  }
  const swap = (s: string) => s.replace(/\((file):([^)]+)\)/g, (_m, _f, n: string) => { const k = keyByName.get(n.replace(/%29/g, ")")); return k ? `(media:${k})` : "(x:)"; })
    .replace(/!\[\]\(x:\)|\[audio\]\(x:\)/g, "");
  const existing = allDecks(), snapshot = allCards();
  let added = 0, skipped = 0, lastId = "";
  for (let i = 0; i < p.result.decks.length; i++) {
    if (!p.sel[i]) continue;
    const d = p.result.decks[i]!, name = p.names[i]!.trim() || d.name;
    const found = p.merge ? existing.find((x) => x.name.toLowerCase() === name.toLowerCase()) : undefined;
    const id = found?.id ?? store.addDeck(name);
    if (!found) { existing.push({ id, name, created: Date.now(), typedMode: "inherit", newPerDay: null, source: "", emoji: "" }); if (p.result.source === "apkg") store.set("deck", id, "source", "apkg"); }
    lastId = id;
    const seen = new Set(p.skipDup ? snapshot.filter((c) => c.deckId === id).map((c) => c.front + "\u0000" + c.back) : []);
    for (const c of d.cards) {
      const front = swap(c.front), back = swap(c.back), key = front + "\u0000" + back;
      if (p.skipDup && seen.has(key)) { skipped++; continue; }
      seen.add(key);
      store.addCardFull({ deckId: id, front, back, tags: c.tags });
      if (++added % 300 === 0) { toast(t("Импортировано: {n}…", { n: added })); await new Promise((r) => setTimeout(r)); }
    }
  }
  pending = null; S.modal = null;
  if (lastId) { S.deckId = lastId; S.sel.clear(); if (isMobile()) S.pane = "cards"; }
  toast(t("Добавлено карточек: {n}", { n: added }) + (skipped ? ", " + t("дубликатов пропущено: {n}", { n: skipped }) : ""));
  render();
}

// ---------- события ----------
const selectOnly = (id: string) => { S.sel = new Set([id]); S.anchor = id; };
const selCards = () => { const ids = S.sel; return allCards().filter((c) => ids.has(c.id)); };

document.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest(".tbb")) e.preventDefault(); });
document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (el.classList?.contains("fld")) lastField = el as HTMLInputElement | HTMLTextAreaElement;
});

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
  if (!el) { if (e.target === $("modal")) { S.modal = null; render(); } return; }
  const a = el.dataset.a!, id = el.dataset.id;
  switch (a) {
    case "deck": S.deckId = id!; S.sel.clear(); if (isMobile()) S.pane = "cards"; render(); break;
    case "card": {
      readDraft();
      if (e.shiftKey && S.anchor && !isMobile()) {
        const ids = filteredCards().map((c) => c.id), i = ids.indexOf(S.anchor), j = ids.indexOf(id!);
        if (i >= 0 && j >= 0) S.sel = new Set(ids.slice(Math.min(i, j), Math.max(i, j) + 1));
      } else if ((e.ctrlKey || e.metaKey) && !isMobile()) { S.sel.has(id!) ? S.sel.delete(id!) : S.sel.add(id!); S.anchor = id!; }
      else selectOnly(id!);
      if (isMobile()) S.pane = "editor";
      renderList(); renderEditor(); updateChrome(); break;
    }
    case "card-new": S.sel.clear(); if (isMobile()) S.pane = "editor"; renderList(); renderEditor(); updateChrome(); if (!isMobile()) ($("f-front") as HTMLTextAreaElement).focus(); break;
    case "card-add": addCardFromForm(); break;
    case "card-del": { const c = activeId(); if (c) { store.deleteCard(c); S.sel.clear(); if (isMobile()) S.pane = "cards"; toast(t("Карточка удалена")); render(); } break; }
    case "card-swap": { const c = selCards()[0]; if (c) { store.set("card", c.id, "front", c.back); store.set("card", c.id, "back", c.front); render(); } break; }
    case "card-mkrev": {
      const c = selCards()[0];
      if (c) {
        const group = c.group || uid();
        store.set("card", c.id, "group", group);
        store.addCardFull({ deckId: c.deckId, front: c.back, back: c.front, extra: c.extra, tags: c.tags, typed: c.typed, group, rev: true });
        toast(t("Обратная карточка создана")); render();
      }
      break;
    }
    case "kind": readDraft(); S.kind = el.dataset.k as Kind; renderEditor(); break;
    case "fmt": applyFmt(el.dataset.k!); break;
    case "play": { const u = el.dataset.url; if (u) playAudio(u); else void mediaUrl(el.dataset.media!).then((x) => x && playAudio(x)); break; }
    case "bulk-clear": S.sel.clear(); renderList(); renderEditor(); break;
    case "bulk-del": if (confirm(t("Удалить карточек: {n}?", { n: S.sel.size }))) { selCards().forEach((c) => store.deleteCard(c.id)); S.sel.clear(); toast(t("Удалено")); render(); } break;
    case "bulk-move": { const d = ($("b-deck") as HTMLSelectElement).value; selCards().forEach((c) => store.set("card", c.id, "deckId", d)); toast(t("Перемещено")); render(); break; }
    case "bulk-tag": {
      const tag = ($("b-tag") as HTMLInputElement).value.trim().replace(/^#/, "").replace(/\s+/g, "_");
      if (tag) { selCards().forEach((c) => { const ts = c.tags.split(/\s+/).filter(Boolean); if (!ts.includes(tag)) store.set("card", c.id, "tags", [...ts, tag].join(" ")); }); toast(t("Тег добавлен")); render(); }
      break;
    }
    case "bulk-susp": selCards().forEach((c) => store.set("card", c.id, "suspended", true)); render(); break;
    case "bulk-unsusp": selCards().forEach((c) => store.set("card", c.id, "suspended", false)); render(); break;
    case "bulk-typed-on": selCards().forEach((c) => store.set("card", c.id, "typed", true)); render(); break;
    case "bulk-typed-off": selCards().forEach((c) => store.set("card", c.id, "typed", false)); render(); break;
    case "deck-new": S.modal = { type: "deck" }; renderModal(); updateChrome(); break;
    case "deck-edit": S.modal = { type: "deck", id: S.deckId }; renderModal(); updateChrome(); break;
    case "deck-publish": if (S.modal?.id) void openPublish(S.modal.id); break;
    case "share-pick": S.modal = { type: "share-pick" }; renderModal(); updateChrome(); break;
    case "pub-edit": void openPublish(id!); break;
    case "pub-go": if (S.modal?.id) void doPublish(S.modal.id); break;
    case "pub-remove": if (id && confirm(t("Снять колоду с публикации? У тех, кто её скачал, она останется."))) void unpublishDeck(id).then(() => { toast(t("Колода снята с публикации")); S.modal = null; render(); }, (er) => toast(String(er))); break;
    case "deck-save": {
      const name = ($("m-name") as HTMLInputElement).value.trim();
      if (!name) break;
      const tm = ($("m-typed") as HTMLSelectElement).value, nv = ($("m-new") as HTMLInputElement).value.trim(), emoji = ($("m-emoji") as HTMLInputElement).value.trim();
      const did = S.modal?.id ?? store.addDeck(name);
      if (S.modal?.id) store.set("deck", did, "name", name);
      store.set("deck", did, "emoji", emoji);
      store.set("deck", did, "typedMode", tm);
      store.set("deck", did, "newPerDay", nv === "" ? null : Math.max(0, Number(nv) || 0));
      S.deckId = did; S.modal = null; if (isMobile()) S.pane = "cards"; render(); break;
    }
    case "deck-swap": if (S.modal?.id) {
      const cs = allCards().filter((c) => c.deckId === S.modal!.id);
      if (cs.length && confirm(t("Поменять местами лицевую и обратную стороны у {n} карточек? Прогресс повторений сохранится.", { n: cs.length }))) {
        cs.filter((c) => c.kind === "basic").forEach((c) => { store.set("card", c.id, "front", c.back); store.set("card", c.id, "back", c.front); });
        S.modal = null; toast(t("Стороны поменяны")); render();
      }
    } break;
    case "deck-rev": if (S.modal?.id) {
      const cs = allCards().filter((c) => c.deckId === S.modal!.id && c.kind === "basic");
      const have = new Set(cs.map((c) => c.front + "\u0000" + c.back));
      const todo = cs.filter((c) => c.front && c.back && !have.has(c.back + "\u0000" + c.front));
      if (!todo.length) { toast(t("Обратные карточки уже есть")); break; }
      todo.forEach((c) => {
        const group = c.group || uid();
        if (!c.group) store.set("card", c.id, "group", group);
        store.addCardFull({ deckId: c.deckId, front: c.back, back: c.front, extra: c.extra, tags: c.tags, typed: c.typed, group, rev: true });
      });
      S.modal = null; toast(t("Добавлено обратных карточек: {n}", { n: todo.length })); render();
    } break;
    case "deck-del": if (S.modal?.id && confirm(t("Удалить колоду вместе с карточками?"))) { store.deleteDeck(S.modal.id); S.deckId = "all"; S.sel.clear(); S.modal = null; S.pane = "decks"; render(); } break;
    case "modal-close": S.modal = null; S.attach = null; render(); break;
    case "settings": S.modal = { type: "settings" }; renderModal(); refreshFsInfo(); updateChrome();
      if (homeScreenSupported()) void checkHomeScreen().then((st) => { homeStatus = st; if (S.modal?.type === "settings") renderModal(); });
      break;
    case "pub-remove-x": break;
    case "sync-open": S.modal = { type: "settings" }; renderModal(); updateChrome(); break;
    case "lang": store.setSetting("lang", el.dataset.k as "auto"); render(); break;
    case "sy-tg": void telegramLogin(false); break;
    case "sy-login": void doLogin("login"); break;
    case "sy-signup": void doLogin("signup"); break;
    case "sy-now": void sync.runNow().then(() => renderModal()); break;
    case "sy-logout": signOut(); store.disableSync(); setMediaSync(null, null); void sync.runNow(); toast(t("Вы вышли. Данные остались на этом устройстве")); renderModal(); break;
    case "sy-savecfg": {
      const u = ($("sy-url") as HTMLInputElement).value.trim(), k = ($("sy-key") as HTMLInputElement).value.trim();
      if (u && k) { saveConfig({ url: u, key: k }); toast(t("Сервер сохранён")); if (inTelegram()) void telegramLogin(false); renderModal(); }
      break;
    }
    case "choose-local": setChoice("local"); S.modal = null; render(); break;
    case "choose-cloud": S.modal = null; render(); void setCloud(true).then(() => { if (!inTelegram()) { S.modal = { type: "settings" }; renderModal(); } }); break;
    case "home-add": addToHomeScreen(); break;
    case "copy-link": navigator.clipboard?.writeText(botLink()).then(() => toast(t("Ссылка скопирована")), () => toast(t("Не удалось скопировать"))); break;
    case "copy-backup": navigator.clipboard?.writeText(store.exportJSON()).then(() => toast(t("Копия данных скопирована в буфер обмена")), () => toast(t("Не удалось скопировать"))); break;
    case "paste-open": S.modal = { type: "paste" }; renderModal(); break;
    case "paste-run": {
      try { const r = store.importJSON(($("m-paste") as HTMLTextAreaElement).value.trim()); S.modal = null; toast(t("Копия загружена: +{c} изменений, +{r} повторов", { c: r.changes, r: r.reviews })); render(); }
      catch (er) { toast((er as Error).message || t("Неверный формат копии")); }
      break;
    }
    case "fs-open": fsApi?.openDir(); break;
    case "fs-backup": fsApi?.backupNow().then((i) => { fsInfo = i; toast(t("Копия создана")); renderModal(); }); break;
    case "fs-choose": store.flush(true); fsApi?.chooseDir().then(async (r) => {
      if (!r) return;
      fsInfo = r.info; store.dispose();
      store = new Store(await backend.load()); attachStore();
      S.sel.clear(); S.deckId = "all"; toast(t("Папка данных изменена")); render();
    }); break;
    case "fs-restore": {
      const name = ($("s-backup") as HTMLSelectElement | null)?.value;
      if (name && fsApi) fsApi.readBackup(name).then((txt) => { const r = store.importJSON(txt); toast(t("Копия загружена: +{c} изменений, +{r} повторов", { c: r.changes, r: r.reviews })); render(); }, (er) => toast(String(er)));
      break;
    }
    case "stats": S.modal = { type: "stats" }; renderModal(); updateChrome(); break;
    case "browser-open": void openBrowser("spark"); break;
    case "tips-open": S.tips = { tab: "spark" }; render(); break;
    case "courses-open": void openCourses(); break;
    case "crs-home": void openCourses(id!); break;
    case "crs-open": if (S.courses) { S.courses.open = id!; renderCourses(); updateChrome(); $("courses").scrollTop = 0; } break;
    case "crs-back": if (S.courses) { S.courses.open = null; renderCourses(); updateChrome(); } break;
    case "crs-close": S.courses = null; render(); break;
    case "crs-unit": if (S.courses?.open) void startUnit(S.courses.open, id!); break;
    case "crs-next": if (S.courses?.open) courseNext(S.courses.open); break;
    case "crs-review": { const d = S.courses?.open ? courseDeck(S.courses.open) : null; if (d) startReview(d.id); break; }
    case "tips-close": S.tips = null; render(); break;
    case "tips-tab": if (S.tips) { S.tips.tab = el.dataset.k!; renderTips(); } break;
    case "br-close": S.browser = null; render(); break;
    case "br-tab": if (S.browser) { S.browser.tab = el.dataset.k as "spark" | "community" | "web"; S.browser.open = null; S.browser.lang = ""; renderBrowser(); updateChrome(); } break;
    case "br-lang": if (S.browser) { S.browser.lang = el.dataset.k ?? ""; renderBrowser(); } break;
    case "br-open": void openCatalogDeck(id!); break;
    case "br-back": if (S.browser) { S.browser.open = null; S.browser.cards = null; renderBrowser(); updateChrome(); } break;
    case "br-add": void addCatalogDeck(); break;
    case "br-goto": S.browser = null; S.deckId = id!; S.sel.clear(); if (isMobile()) S.pane = "cards"; render(); break;
    case "ank-go": openExternal(ankiUrl(($("ank-q") as HTMLInputElement).value)); break;
    case "ank-cat": openExternal(ankiUrl(el.dataset.k!)); break;
    case "m-back": goBack(); break;
    case "bar-close": { const bar = document.getElementById("update-bar"); if (bar) bar.hidden = true; break; }
    case "reload-app": store.flush(true); location.reload(); break;
    case "study": startReview(S.deckId); break;
    case "rv-close": closeReview(); break;
    case "rv-more": learnMore(Number(el.dataset.n) || 0); break;
    case "rv-typed": toggleTyped(); break;
    case "rv-attach": if (S.review?.cardId) { S.attach = { cardId: S.review.cardId, side: S.review.show ? "a" : "q" }; S.modal = { type: "attach" }; renderModal(); updateChrome(); } break;
    case "att-side": if (S.attach) { S.attach.side = el.dataset.k as "q" | "a"; renderModal(); } break;
    case "att-img": ($("img-file") as HTMLInputElement).click(); break;
    case "att-video": ($("vid-file") as HTMLInputElement).click(); break;
    case "att-audio": ($("aud-file") as HTMLInputElement).click(); break;
    case "att-rec": S.modal = { type: "record" }; renderModal(); break;
    case "rec-start": void startRec(); break;
    case "rec-stop": stopRec(); break;
    case "rec-save": if (rec.blob) { const blob = rec.blob; resetRec(); void addMediaFile("audio", blob); } break;
    case "att-del": {
      const id = activeId(), f = el.dataset.f as "front" | "back" | "extra", k = el.dataset.k!;
      const c = id ? allCards().find((x) => x.id === id) : null;
      if (c) { store.set("card", c.id, f, c[f].replace(new RegExp(`\\n?(?:!\\[\\]|\\[(?:audio|video)\\])\\(media:${k}\\)\\n?`), "\n").trim()); if (c.group) syncGroup(c.id); renderEditor(); renderList(); }
      break;
    }
    case "rv-show": reveal(); break;
    case "rv-check": checkTyped(); break;
    case "rv-idk": checkTyped(""); break;
    case "rv-next": applyPending(); break;
    case "rv-forgot": applyPending(1); break;
    case "rv-right": markRight(); break;
    case "rate": rateManual(Number(el.dataset.g) as Rating); break;
    case "accent": store.setSetting("accent", el.dataset.c!); applyTheme(); renderModal(); break;
    case "theme": store.setSetting("theme", el.dataset.t as "auto"); applyTheme(); renderModal(); break;
    case "export": {
      if (fsApi) { fsApi.exportDialog(store.exportJSON(), `spark-backup-${new Date().toISOString().slice(0, 10)}.json`).then((p) => p && toast(t("Сохранено") + ": " + p)); break; }
      const url = URL.createObjectURL(new Blob([store.exportJSON()], { type: "application/json" }));
      const l = document.createElement("a"); l.href = url; l.download = `spark-backup-${new Date().toISOString().slice(0, 10)}.json`; l.click();
      URL.revokeObjectURL(url); break;
    }
    case "import-pick": case "import-decks": case "file-pick": pickFile(); break;
    case "import-run": void runImport(); break;
    case "bulk": S.modal = { type: "import" }; renderModal(); updateChrome(); break;
    case "bulk-add": {
      const rows = parseLines(($("m-bulk") as HTMLTextAreaElement).value);
      if (!rows.length) break;
      let deckId = S.deckId;
      if (deckId === "all") deckId = allDecks()[0]?.id ?? store.addDeck(t("Моя колода"));
      rows.forEach(([f, b]) => store.addCardFull({ deckId, front: f, back: b }));
      S.deckId = deckId; S.modal = null; toast(t("Добавлено карточек: {n}", { n: rows.length })); render(); break;
    }
  }
});

const FIELD_MAP: Record<string, string> = { "f-front": "front", "f-hint": "hint", "f-back": "back", "f-extra": "extra", "f-tags": "tags" };
document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (el.id === "search") { S.search = el.value; renderList(); }
  else if (el.id === "br-q" && S.browser) {
    S.browser.q = el.value;
    const pos = el.selectionStart; renderBrowser();
    const nq = $("br-q") as HTMLInputElement; nq.focus(); nq.setSelectionRange(pos, pos);
  } else if (el.id === "rv-input") {
    const x = ctx();
    if (x?.live && !x.r.show && isCorrect(el.value, x.f.answers)) checkTyped(el.value);
  } else if (FIELD_MAP[el.id]) {
    const id = activeId();
    if (id) {
      store.set("card", id, FIELD_MAP[el.id]!, el.value);
      clearTimeout(syncTimer); syncTimer = setTimeout(() => syncGroup(id), 350);
      renderList();
    }
    updatePreview();
  } else if (el.dataset.name !== undefined && pending) pending.names[Number(el.dataset.name)] = el.value;
  else if (el.id === "s-ret") {
    store.setSetting("retention", Number(el.value));
    (el.closest(".item")!.querySelector(".muted") as HTMLElement).textContent = `${Math.round(store.settings.retention * 100)}%`;
  } else if (el.id === "s-new") store.setSetting("newPerDay", Math.max(0, Number(el.value) || 0));
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === "f-deck" && activeId()) { store.set("card", activeId()!, "deckId", el.value); render(); }
  else if (el.id === "f-typed") { if (activeId()) { store.set("card", activeId()!, "typed", (el as HTMLInputElement).checked); renderList(); } else store.setSetting("typedDefault", (el as HTMLInputElement).checked); }
  else if (el.id === "f-susp" && activeId()) { store.set("card", activeId()!, "suspended", (el as HTMLInputElement).checked); renderList(); }
  else if (el.id === "s-typed") store.setSetting("typedAll", (el as HTMLInputElement).checked);
  else if (el.id === "s-manual") store.setSetting("manualGrades", (el as HTMLInputElement).checked);
  else if (el.id === "s-autoaudio") store.setSetting("autoAudio", (el as HTMLInputElement).checked);
  else if (el.id === "s-sync") void setCloud((el as HTMLInputElement).checked);
  else if (el.dataset.sel !== undefined && pending) { pending.sel[Number(el.dataset.sel)] = (el as HTMLInputElement).checked; renderModal(); }
  else if (el.id === "i-merge" && pending) pending.merge = (el as HTMLInputElement).checked;
  else if (el.id === "i-dup" && pending) pending.skipDup = (el as HTMLInputElement).checked;
  else if (el.id === "file") {
    const f = (el as HTMLInputElement).files?.[0];
    if (f) void importFile(f);
    (el as HTMLInputElement).value = "";
  } else if (el.id === "img-file" || el.id === "vid-file" || el.id === "aud-file") {
    const f = (el as HTMLInputElement).files?.[0];
    if (f) void addMediaFile(el.id === "img-file" ? "image" : el.id === "vid-file" ? "video" : "audio", f);
    (el as HTMLInputElement).value = "";
  }
});
document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
  const target = e.target as HTMLElement;
  if (f && target.classList?.contains("fld")) { e.preventDefault(); lastField = target as HTMLTextAreaElement; S.attach = null; void addMediaFile("image", f); }
});

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const r = S.review;
  if (r) {
    const inInput = (e.target as HTMLElement).id === "rv-input";
    if (e.key === "Escape") { closeReview(); return; }
    if (r.locking) { e.preventDefault(); return; }
    if (inInput) { if (e.key === "Enter") { e.preventDefault(); checkTyped(); } return; }
    const x = ctx();
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!x) closeReview();
      else if (!r.show) { x.typedMode ? checkTyped("") : reveal(); }
      else if (store.settings.manualGrades) rateManual(3);
      else applyPending();
    } else if (!store.settings.manualGrades && r.show && (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "ч")) applyPending(1);
    else if (!store.settings.manualGrades && r.show && r.ok === false && (e.key.toLowerCase() === "v" || e.key.toLowerCase() === "м")) markRight();
    else if (store.settings.manualGrades && ["1", "2", "3", "4"].includes(e.key)) rateManual(Number(e.key) as Rating);
    return;
  }
  if (e.key === "Escape" && (S.modal || S.browser || S.tips || S.courses)) { goBack(); return; }
  if (S.modal) {
    if (e.key === "Enter" && S.modal.type === "deck" && (e.target as HTMLElement).id === "m-name") (document.querySelector('[data-a="deck-save"]') as HTMLElement)?.click();
    return;
  }
  if (S.browser || S.tips) return;
  const tag = (e.target as HTMLElement).tagName;
  if (mod && e.key === "Enter" && !activeId() && document.getElementById("f-front")) { e.preventDefault(); addCardFromForm(); }
  else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); S.sel.clear(); renderList(); renderEditor(); ($("f-front") as HTMLTextAreaElement | null)?.focus(); }
  else if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); $("search").focus(); }
  else if (mod && e.key.toLowerCase() === "b" && lastField && tag !== "BODY") { e.preventDefault(); applyFmt("b"); }
  else if (mod && e.key.toLowerCase() === "i" && lastField && tag !== "BODY") { e.preventDefault(); applyFmt("i"); }
  else if (mod && e.shiftKey && e.key.toLowerCase() === "c" && S.kind === "cloze") { e.preventDefault(); applyFmt("cloze"); }
  else if (mod && e.key.toLowerCase() === "a" && tag === "BODY") { e.preventDefault(); S.sel = new Set(filteredCards().map((c) => c.id)); renderList(); renderEditor(); }
});

let dragDepth = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("drop").classList.add("on"); });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").classList.remove("on"); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; $("drop").classList.remove("on");
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  if (kindOf(f) && (e.target as HTMLElement).closest?.(".editor")) { S.attach = null; void addMediaFile(null, f); }
  else void importFile(f);
});
addEventListener("beforeunload", () => store?.flush(true));
setInterval(() => { if (store && !S.review && !S.modal && !S.browser && document.visibilityState === "visible") renderDecks(); }, 30_000);

function attachStore() {
  store.onSaveError = () => toast(t("Не удалось сохранить данные!"));
  store.onLocalChange = () => sync?.trigger();
}
function onPulled() {
  if (S.review) { renderDecks(); return; }
  const a = document.activeElement as HTMLElement | null;
  if (a && ["TEXTAREA", "INPUT"].includes(a.tagName)) { renderDecks(); renderList(); return; }
  render();
}
async function checkUpdate() {
  if (!/^https?:/.test(location.protocol)) return;
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    const v = ((await r.json()) as { version?: string }).version;
    const bar = document.getElementById("update-bar");
    if (v && v !== __VERSION__ && bar) { bar.hidden = false; bar.innerHTML = `${t("Доступна новая версия {v}", { v: esc(v) })} <button data-a="reload-app">${t("Обновить")}</button>`; }
  } catch { /* нет сети или version.json */ }
}

async function boot() {
  await loadTelegram();
  initTelegram(goBack, () => store && applyTheme());
  onHomeScreenAdded(() => { homeStatus = "added"; const bar = document.getElementById("update-bar"); if (bar && bar.innerHTML.includes("home-add")) bar.hidden = true; toast(t("Ярлык добавлен")); if (S.modal?.type === "settings") renderModal(); });
  try { store = new Store(await backend.load()); }
  catch (e) { document.body.innerHTML = `<div class="empty"><div class="em">⚠️</div><h3>Error</h3>${esc((e as Error).message)}</div>`; return; }
  sync = new SyncService(() => store, updateSyncInd, onPulled, getMediaBlob);
  attachStore();
  if (store.syncOn) setMediaSync((k) => queueMedia([k]), downloadMedia);
  setBundledMedia(async (k) => {
    const id = bundledDeckOf(k);
    if (!id) return null;
    const all = await loadDeckMedia(id);
    for (const [key, blob] of all) await putLocal(key, blob).catch(() => {});
    return all.get(k) ?? null;
  });
  (window as unknown as { __spark: unknown }).__spark = { store, S, render, sync, inTelegram, t, sparkMark, streakMark, dayMark };
  (window as unknown as { __recall: unknown }).__recall = (window as unknown as { __spark: unknown }).__spark;
  render();
  sync.startBackground();
  void checkUpdate(); setInterval(() => void checkUpdate(), 30 * 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkUpdate(); });
  // Первый запуск. В Telegram с настроенным сервером — сразу «на всех устройствах», вход сам.
  const choice = getChoice();
  if (choice === null) {
    if (inTelegram() && getConfig()) await setCloud(true);
    else if (store.replica.list("deck").length || getSession()) setChoice(store.syncOn ? "cloud" : "local");
    else if (getConfig()) { S.modal = { type: "choose" }; renderModal(); updateChrome(); }
    else setChoice("local");
  } else if (choice === "cloud" && inTelegram() && getConfig() && !getSession()) void telegramLogin(true);
  else if (sync.enabled) void sync.runNow();
}
void boot();
export type { Lang };
