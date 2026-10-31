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
  applyTelegramTheme, closingConfirmation, haptic, initTelegram, inTelegram, loadTelegram, openExternal, setBackButton, tgInitData, tgUser,
} from "./tg";
import { answerVariants, clozeFace, clozeNumbers, esc, fmt, fmtDur, isCorrect, stripMedia } from "./format";
import { detectLang, getLang, setLang, t, translateStatic, type Lang } from "./i18n";
import { AUDIO_RE, IMAGE_RE, allMediaKeys, getMediaBlob, hydrateMedia, mediaUrl, mimeOf, playAudio, putMedia, setMediaSync, shrinkImage } from "./media";
import {
  LANGS, communityAvailable, loadCommunity, loadCommunityCards, loadSparkCards, loadSparkCatalog, myPublished, publishDeck, unpublishDeck,
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
const plain = (s: string) => stripMedia(s, "🖼", "🔊").replace(/[=*`]/g, "");

// ---------- состояние интерфейса ----------
type Kind = "basic" | "rev" | "cloze";
interface Draft { front: string; hint: string; back: string; extra: string; tags: string }
interface Review {
  deckId: string; cardId: string | null; show: boolean; typed: string | null; ok: boolean | null; done: number;
  t0: number; paused: number; baseline: number; dur: number;
  pending: { rating: Rating; speed: Speed; dur: number } | null; locking: boolean;
}
interface Browser {
  tab: "spark" | "anki"; q: string; lang: string; loading: boolean; error: string;
  decks: CatalogDeck[]; open: CatalogDeck | null; cards: DeckCard[] | null; busy: boolean;
}
type ModalType = "settings" | "stats" | "deck" | "import" | "importdecks" | "choose" | "paste" | "publish";
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
  modal: null as null | { type: ModalType; id?: string },
};
const isMobile = () => matchMedia("(max-width: 760px)").matches;
const activeId = () => (S.sel.size === 1 ? [...S.sel][0]! : null);

interface Counts { n: number; l: number; r: number }
function scan(now: number, cards: CardView[], decks: DeckView[]): Map<string, Counts> {
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
  const limit = store.settings.newPerDay;
  for (const [id, o] of out) {
    const lim = decks.find((d) => d.id === id)?.newPerDay ?? limit;
    o.n = Math.min(newAvail.get(id) ?? 0, Math.max(0, lim - (newToday.get(id) ?? 0)));
  }
  return out;
}
const sum = (m: Map<string, Counts>): Counts => [...m.values()].reduce((a, c) => ({ n: a.n + c.n, l: a.l + c.l, r: a.r + c.r }), { n: 0, l: 0, r: 0 });

function pickNext(deckId: string, now: number): string | null {
  const decks = allDecks();
  const cards = allCards().filter((c) => (deckId === "all" || c.deckId === deckId) && !c.suspended);
  const counts = scan(now, cards, decks);
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
function applyTheme() {
  const s = store.settings;
  const tgTheme = applyTelegramTheme(s.accent, "#3390ec");
  const dark = tgTheme ? tgTheme.dark : s.theme === "dark" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.dark = dark ? "1" : "0";
  if (!tgTheme) document.documentElement.style.setProperty("--accent", s.accent);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => store && applyTheme());
function applyLang() {
  const l = detectLang(store.settings.lang, tgUser()?.language_code);
  if (l !== getLang()) setLang(l);
  document.title = APP;
  translateStatic();
}

function render() {
  applyLang(); applyTheme();
  renderDecks(); renderList(); renderEditor(); renderReview(); renderBrowser(); renderModal(); updateChrome();
}

function updateChrome() {
  $("app").dataset.pane = S.pane;
  setBackButton(!!S.review || !!S.modal || !!S.browser || (isMobile() && S.pane !== "decks"));
  closingConfirmation(!!S.review);
  updateSyncInd();
}
function goBack() {
  if (S.review) closeReview();
  else if (S.modal) { S.modal = null; render(); }
  else if (S.browser?.open) { S.browser.open = null; S.browser.cards = null; renderBrowser(); updateChrome(); }
  else if (S.browser) { S.browser = null; render(); }
  else if (S.pane === "editor") { S.pane = "cards"; render(); }
  else if (S.pane === "cards") { S.pane = "decks"; render(); }
}
matchMedia("(max-width: 760px)").addEventListener("change", () => store && updateChrome());

function updateSyncInd() {
  const el = document.getElementById("sync-ind") as HTMLButtonElement | null;
  if (!el || !sync) return;
  const m: Record<string, [string, string]> = {
    idle: ["☁", t("Синхронизировано")], syncing: ["⟳", t("Синхронизация…")], error: ["⚠", t("Ошибка синхронизации")],
    offline: ["⊘", t("Нет связи — изменения сохранены на устройстве")], auth: ["🔑", t("Нужно войти заново")],
  };
  const v = m[sync.status];
  el.hidden = !v;
  if (!v) return;
  el.textContent = v[0]; el.className = `icon-btn sync-ind s-${sync.status}`;
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
  $("decks").innerHTML = row("all", "📚 " + t("Все карточки"), sum(counts)) +
    decks.map((d) => row(d.id, (d.emoji ? d.emoji + " " : "") + esc(d.name) + (d.typedMode === "on" ? ' <span class="muted" title="' + t("Ввод ответа включён для всей колоды") + '">⌨</span>' : ""), counts.get(d.id))).join("")
    + (decks.length ? "" : isMobile() ? welcomeHtml() : `<div class="hint" style="padding:10px">${t("Колод пока нет. Откройте «Каталог» — там готовые колоды.")}</div>`);
  $("deck-actions").innerHTML = decks.some((d) => d.id === S.deckId) ? `<button class="icon-btn" data-a="deck-edit" title="${t("Настройки колоды")}">⋯</button>` : "";
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
      <span>${c.suspended ? "⏸ " : ""}${c.typed ? "⌨ " : ""}${statusOf(store.stateOf(c.id), now)}</span></div></div>`;
  }).join("") + (cards.length > shown.length ? `<div class="muted" style="padding:10px;text-align:center">${t("Показаны первые 500 — уточните поиск")}</div>` : "")
    + (!cards.length ? `<div class="empty"><div class="em">🗂️</div>${S.search ? t("Ничего не найдено") : t("В этой колоде пока нет карточек.") + "<br>" + (isMobile() ? t("Нажмите ＋, чтобы создать первую.") : t("Создайте первую справа →"))}</div>` : "");
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
  <button class="tbb wide" data-a="fmt" data-k="img" title="${t("Добавить картинку")}">🖼 ${t("Картинка")}</button>
  ${cloze ? `<button class="tbb wide" data-a="fmt" data-k="cloze" title="${t("Пропуск")} (Ctrl+Shift+C)">[…] ${t("Пропуск")}</button>` : ""}</div>`;

function readDraft() {
  const g = (id: string) => ($(id) as HTMLInputElement | null)?.value;
  if (g("f-front") === undefined || activeId()) return;
  S.draft = { front: g("f-front") ?? "", hint: g("f-hint") ?? "", back: g("f-back") ?? "", extra: g("f-extra") ?? "", tags: g("f-tags") ?? "" };
}

function welcomeHtml(): string {
  return `<div class="empty welcome"><div class="logo">${__LOGO__}</div><h3>${t("Добро пожаловать в {app}", { app: APP })}</h3>
    <p>${t("Карточки для запоминания с умными повторениями. Возьмите готовую колоду из каталога или создайте свою.")}</p>
    <div class="welcome-actions"><button class="btn" data-a="browser-open">📚 ${t("Открыть каталог")}</button>
    <button class="btn sec" data-a="deck-new">＋ ${t("Создать колоду")}</button>
    <button class="btn sec" data-a="import-decks">📥 ${t("Импорт из Anki / CSV")}</button></div></div>`;
}

function renderEditor() {
  const decks = allDecks(), host = $("editor");
  if (!decks.length) { host.innerHTML = welcomeHtml(); return; }
  if (S.sel.size > 1) {
    const opts = decks.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
    host.innerHTML = `<div class="editor"><div class="m-only m-head"><button class="btn sec" data-a="m-back">‹ ${t("Карточки")}</button></div>
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
    info = `<div class="info"><span>${t("Статус")}: ${statusOf(st, now)}</span><span>${t("Повторов")}: ${st.reps}</span><span>${t("Ошибок")}: ${st.lapses}</span>${st.stability ? `<span>${t("Стабильность")}: ${t("{n} дн", { n: st.stability.toFixed(1) })}</span><span>${t("Сложность")}: ${st.difficulty.toFixed(1)}/10</span>` : ""}${card.group ? `<span>🔗 ${t("связана с другими карточками")}</span>` : ""}</div>`;
  }
  const frontLabel = kind === "cloze" ? t("Текст с пропусками") : t("Лицевая сторона");
  const frontPh = kind === "cloze" ? t("Мадрид — это {{c1::столица}} {{c2::Испании}}") : t("Вопрос или слово");
  host.innerHTML = `<div class="editor"><div class="m-only m-head"><button class="btn sec" data-a="m-back">‹ ${t("Карточки")}</button></div>${kinds}
    <label>${t("Колода")}</label><select id="f-deck">${opts}</select>
    ${TOOLBAR(kind === "cloze")}
    <label>${frontLabel}</label><textarea id="f-front" class="fld" placeholder="${esc(frontPh)}">${esc(v.front ?? "")}</textarea>
    <label>${t("Подсказка")} <span class="opt">${t("мелким под лицевой стороной")}</span></label><input type="text" id="f-hint" class="fld" placeholder="${t("напр. транскрипция, часть речи")}" value="${esc(v.hint ?? "")}">
    ${kind === "cloze" ? "" : `<label>${t("Обратная сторона")}</label><textarea id="f-back" class="fld" placeholder="${t("Ответ или перевод")}">${esc(v.back ?? "")}</textarea>`}
    <label>${t("Пояснение")} <span class="opt">${t("вставкой под ответом: пример, заметка")}</span></label><textarea id="f-extra" class="fld short" placeholder="${esc(t("# Пример") + "\n> " + t("Hablo español."))}">${esc(v.extra ?? "")}</textarea>
    <label>${t("Теги")}</label><input type="text" id="f-tags" class="fld" placeholder="${t("через пробел: глаголы B1")}" value="${esc(v.tags ?? "")}">
    <label class="chk"><input type="checkbox" id="f-typed" ${v.typed ? "checked" : ""}> ${t("Ввод ответа с клавиатуры")} <span class="muted">— ${t("при повторении нужно набрать ответ")}</span></label>
    ${card ? `<label class="chk"><input type="checkbox" id="f-susp" ${card.suspended ? "checked" : ""}> ${t("Приостановить карточку")} <span class="muted">— ${t("не показывать при повторении")}</span></label>` : ""}
    <div class="actions">${card
      ? `<button class="btn danger" data-a="card-del">${t("Удалить")}</button>${card.kind === "basic" && !card.group ? `<button class="btn sec" data-a="card-swap" title="${t("Лицевая ⇄ обратная")}">⇄ ${t("Поменять")}</button><button class="btn sec" data-a="card-mkrev" title="${t("Создать связанную обратную карточку")}">＋ ${t("Обратная")}</button>` : ""}<button class="btn sec" data-a="card-new">${t("Новая")}</button><span class="muted autosave">${t("Сохраняется автоматически")}</span>`
      : `<button class="btn" data-a="card-add">${t("Добавить")}</button><span class="muted d-only"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> — ${t("добавить и продолжить")}</span>`}</div>
    <div class="preview-wrap" id="prev">${previewHtml(card ?? null)}</div>${info}
    <p class="hint" style="margin-left:0">${t("Разметка")}: <code># ${t("подзаголовок")}</code>, <code>&gt; ${t("вставка")}</code>, <code>**${t("жирный")}**</code>, <code>*${t("курсив")}*</code>, <code>==${t("выделение")}==</code>.</p>
  </div>`;
  media(host);
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
  if (k === "img") { ($("img-file") as HTMLInputElement).click(); return; }
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
async function addImageFile(f: File) {
  if (!f.type.startsWith("image/")) return toast(t("Это не картинка"));
  const key = await putMedia(await shrinkImage(f));
  insertAtCursor(`\n![](media:${key})\n`);
}

// ---------- повторение ----------
const SPEED_LABEL = (): Record<Speed, string> => ({ fast: "⚡ " + t("Быстро"), normal: "👍 " + t("Уверенно"), slow: "🤔 " + t("С раздумьем"), veryslow: "🐢 " + t("Долго думали"), wrong: "✗ " + t("Ошибка") });

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
  const counts = sum(scan(now, allCards().filter((c) => r.deckId === "all" || c.deckId === r.deckId), decks));
  const left = r.cardId ? counts.n + counts.l + counts.r : 0;
  const total = r.done + left, frac = total ? r.done / total : 1, C = 2 * Math.PI * 17;
  const deck = decks.find((d) => d.id === r.deckId);
  const manual = store.settings.manualGrades;
  const typedNow = (() => { const c = r.cardId ? allCards().find((k) => k.id === r.cardId) : null; return c ? isTyped(c, decks.find((d) => d.id === c.deckId)) : store.settings.typedAll; })();
  const timer = manual ? "" : `<div class="tm"><div class="tm-bar"><i id="rv-bar"></i></div><span id="rv-time" class="muted"></span></div>`;
  const top = `<div class="rv-top"><button class="icon-btn" data-a="rv-close" title="${t("Закрыть")} (Esc)">✕</button>
    <div class="t">${esc(deck?.name ?? t("Все карточки"))}<div class="muted" style="font-weight:400;font-size:12px"><span style="color:var(--accent)">${counts.n}</span> · <span style="color:var(--bad)">${counts.l}</span> · <span style="color:var(--good)">${counts.r}</span></div></div>
    <button class="kbd-toggle ${typedNow ? "on" : ""}" data-a="rv-typed" title="${t("Ввод ответа с клавиатуры: переход без Enter при верном слове")}">⌨<span class="lbl"> ${t("Ввод")}: ${typedNow ? t("вкл") : t("выкл")}</span></button>
    <svg class="ring" viewBox="0 0 38 38"><circle class="bg" cx="19" cy="19" r="17"/><circle class="fg" cx="19" cy="19" r="17" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg></div>`;
  const x = ctx();
  if (!x) {
    el.innerHTML = top + `<div class="rv-body"><div class="rv-done"><div class="em">${r.done ? "🎉" : "✅"}</div>
      <h2>${r.done ? t("Отличная работа!") : t("На сегодня всё")}</h2>
      <p class="muted">${r.done ? t("Повторено карточек: {n}", { n: r.done }) : t("Нет карточек к повторению.")}</p>
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
      foot = `<div class="chip sp-${p.speed}">${SPEED_LABEL()[p.speed]} <span class="muted">· ${t("вернётся через {d}", { d: when })}</span></div>
        <div class="foot-row"><button class="btn big" data-a="rv-next">${t("Далее")} <kbd class="kk">⏎</kbd></button>
        ${r.typed != null && r.ok === false && r.typed !== "" ? `<button class="btn sec big" data-a="rv-right" title="${t("Опечатка — засчитать")}">${t("Я был прав")} <kbd class="kk">V</kbd></button>` : p.rating > 1 ? `<button class="btn sec big" data-a="rv-forgot">${t("Не помню")} <kbd class="kk">X</kbd></button>` : ""}</div>`;
    }
  }
  el.innerHTML = top + `<div class="rv-body"><div class="rv-card ${r.locking ? "flash" : ""}"><div class="kind">${kind}${card.kind === "cloze" ? " · " + t("пропуск") : ""}</div>
    <div class="rv-q">${faceHtml(card, "q")}</div>${mid}</div></div>
    <div class="rv-foot">${timer}${foot}</div>`;
  media(el);
  if (!r.show && typedMode) ($("rv-input") as HTMLInputElement).focus();
  if (r.locking) ($("rv-input") as HTMLInputElement | null)?.setAttribute("disabled", "");
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
function startReview(deckId: string) {
  haptic("light");
  S.review = { deckId, cardId: null, show: false, typed: null, ok: null, done: 0, t0: 0, paused: 0, baseline: computeBaseline(), dur: 0, pending: null, locking: false };
  showNext();
}
function showNext() {
  const r = S.review!;
  r.cardId = pickNext(r.deckId, Date.now());
  Object.assign(r, { show: false, typed: null, ok: null, pending: null, locking: false, t0: Date.now(), paused: 0, dur: 0 });
  if (r.done > 0 && r.done % 10 === 0) r.baseline = computeBaseline();
  hiddenAt = document.hidden ? Date.now() : null;
  renderReview(); renderDecks(); updateChrome();
}
function closeReview() {
  const r = S.review;
  if (r?.show && r.pending && r.cardId && !r.locking) store.answer(r.cardId, r.pending.rating, r.pending.dur);
  S.review = null; render();
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
  else renderReview();
}
function applyPending(rating?: Rating) {
  const r = S.review;
  if (!r?.cardId || !r.pending) return;
  store.answer(r.cardId, rating ?? r.pending.rating, r.pending.dur);
  haptic("select");
  r.done++;
  showNext();
}
function rateManual(g: Rating) {
  const r = S.review;
  if (!r?.cardId || !r.show) return;
  store.answer(r.cardId, g, r.dur);
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

async function openBrowser(tab: "spark" | "anki" = "spark") {
  S.browser = { tab, q: "", lang: "", loading: true, error: "", decks: [], open: null, cards: null, busy: false };
  render();
  const [spark, community] = await Promise.all([
    loadSparkCatalog(),
    communityAvailable() ? loadCommunity().catch((e) => { if (S.browser) S.browser.error = String(e.message || e); return [] as CatalogDeck[]; }) : Promise.resolve([] as CatalogDeck[]),
  ]);
  if (!S.browser) return;
  S.browser.decks = [...spark, ...community];
  S.browser.loading = false;
  renderBrowser();
}

function renderBrowser() {
  const el = $("browser"), b = S.browser;
  el.classList.toggle("on", !!b);
  if (!b) { el.innerHTML = ""; return; }
  const tabs = `<div class="seg br-tabs"><button data-a="br-tab" data-k="spark" class="${b.tab === "spark" ? "on" : ""}">${t("Каталог")} ${APP}</button><button data-a="br-tab" data-k="anki" class="${b.tab === "anki" ? "on" : ""}">AnkiWeb</button></div>`;
  const head = `<div class="br-top"><button class="icon-btn" data-a="br-close" title="${t("Закрыть")}">✕</button><h1>${t("Каталог колод")}</h1>${tabs}</div>`;
  if (b.open) { el.innerHTML = head + `<div class="br-body">${deckDetailHtml(b)}</div>`; media(el); return; }
  if (b.tab === "anki") { el.innerHTML = head + `<div class="br-body">${ankiHtml()}</div>`; return; }
  const inst = installed();
  const langs = [...new Set(b.decks.flatMap((d) => [d.lang_front, d.lang_back]).filter(Boolean))].sort();
  const q = b.q.trim().toLowerCase();
  const list = b.decks.filter((d) => (!b.lang || d.lang_front === b.lang || d.lang_back === b.lang)
    && (!q || `${d.title} ${d.title_en ?? ""} ${d.description} ${d.description_en ?? ""} ${d.tags.join(" ")} ${d.author ?? ""}`.toLowerCase().includes(q)));
  const chip = (code: string, label: string) => `<button class="fchip ${b.lang === code ? "on" : ""}" data-a="br-lang" data-k="${code}">${label}</button>`;
  const tile = (d: CatalogDeck) => {
    const have = inst.get(sourceKey(d));
    return `<button class="tile" data-a="br-open" data-id="${esc(sourceKey(d))}">
      <div class="tile-em">${esc(d.emoji || "📘")}</div>
      <div class="tile-main"><div class="tile-t">${esc(deckTitle(d))}</div>
        <div class="tile-d">${esc(deckDesc(d))}</div>
        <div class="tile-m"><span>${t("{n} карт.", { n: d.count })}</span>${d.lang_front ? `<span>${esc(langName(d.lang_front))}${d.lang_back && d.lang_back !== d.lang_front ? " → " + esc(langName(d.lang_back)) : ""}</span>` : ""}
          <span class="src ${d.source}">${d.source === "spark" ? APP : t("от пользователей")}</span>${d.source === "community" && d.downloads ? `<span>⬇ ${d.downloads}</span>` : ""}${have ? `<span class="have">✓ ${t("добавлена")}</span>` : ""}</div></div></button>`;
  };
  const note = !communityAvailable()
    ? `<p class="hint">${t("Колоды от пользователей появятся, когда подключён сервер синхронизации.")}</p>`
    : b.error ? `<p class="hint">⚠ ${t("Не удалось загрузить колоды пользователей")}: ${esc(b.error)}</p>` : "";
  el.innerHTML = head + `<div class="br-body">
    <input type="search" id="br-q" class="br-search" placeholder="${t("Поиск колод: язык, тема, автор…")}" value="${esc(b.q)}">
    <div class="fchips">${chip("", t("Все"))}${langs.map((l) => chip(l, langName(l))).join("")}</div>
    ${b.loading ? `<div class="empty"><div class="em spin">⟳</div>${t("Загружаю каталог…")}</div>` : list.length ? `<div class="tiles">${list.map(tile).join("")}</div>` : `<div class="empty"><div class="em">🔎</div>${t("Ничего не найдено")}</div>`}
    ${note}
    <p class="hint">${t("Хотите поделиться своей колодой? Откройте её настройки (⋯) → «Опубликовать в каталоге».")}</p></div>`;
}

function deckDetailHtml(b: Browser): string {
  const d = b.open!, have = installed().get(sourceKey(d));
  const cards = b.cards;
  const sample = cards ? cards.slice(0, 12).map((c) => `<div class="sample"><div class="s-q">${fmt(c.front)}${c.hint ? `<div class="hint-line">${fmt(c.hint)}</div>` : ""}</div><div class="s-a">${fmt(c.back ?? "")}</div></div>`).join("") : `<div class="muted">${t("Загружаю карточки…")}</div>`;
  const outdated = have && d.source === "spark" && Number(have.source.split("@")[1] ?? 0) < d.version;
  return `<div class="detail">
    <button class="btn sec" data-a="br-back">‹ ${t("Назад к каталогу")}</button>
    <div class="d-hero"><div class="d-em">${esc(d.emoji || "📘")}</div><div><h2>${esc(deckTitle(d))}</h2>
      <div class="tile-m"><span>${t("{n} карт.", { n: d.count })}</span>${d.lang_front ? `<span>${esc(langName(d.lang_front))}${d.lang_back && d.lang_back !== d.lang_front ? " → " + esc(langName(d.lang_back)) : ""}</span>` : ""}<span>${d.source === "spark" ? APP : esc(d.author || t("пользователь"))}</span>${d.downloads ? `<span>⬇ ${d.downloads}</span>` : ""}</div></div></div>
    <p class="d-desc">${esc(deckDesc(d))}</p>
    <div class="d-actions">${have
      ? `<button class="btn" data-a="br-goto" data-id="${have.id}">${t("Открыть в моих колодах")}</button>${outdated ? `<button class="btn sec" data-a="br-add" ${b.busy ? "disabled" : ""}>${t("Добавить новые карточки")}</button>` : ""}`
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

async function addCatalogDeck() {
  const b = S.browser;
  if (!b?.open || !b.cards || b.busy) return;
  b.busy = true; renderBrowser();
  const d = b.open, have = installed().get(sourceKey(d));
  const deckId = have?.id ?? store.addDeck(deckTitle(d));
  if (!have) store.set("deck", deckId, "emoji", d.emoji || "📘");
  store.set("deck", deckId, "source", `${sourceKey(d)}@${d.version}`);
  const existing = new Set(allCards().filter((c) => c.deckId === deckId).map((c) => c.front + "\u0000" + c.back));
  let added = 0;
  for (const c of b.cards) {
    if (existing.has(c.front + "\u0000" + (c.back ?? ""))) continue;
    store.addCardFull({ deckId, front: c.front, back: c.back ?? "", hint: c.hint, extra: c.extra, tags: c.tags,
      ...(c.kind === "cloze" ? { kind: "cloze", n: c.n ?? 1 } : {}) });
    if (++added % 200 === 0) await new Promise((r) => setTimeout(r));
  }
  haptic("success");
  b.busy = false;
  toast(t("Колода добавлена: {n} карточек", { n: added }));
  renderBrowser(); renderDecks();
}

function ankiHtml(): string {
  const cats = ["English", "Spanish", "German", "French", "Japanese", "Chinese", "Geography", "Medicine", "Biology", "History"];
  return `<div class="anki">
    <div class="a-card"><h3>${t("Колоды AnkiWeb в {app}", { app: APP })}</h3>
      <p>${t("На AnkiWeb тысячи готовых колод. AnkiWeb разрешает скачивать их только через свой сайт, поэтому {app} открывает поиск в браузере, а скачанный файл вы добавляете сюда — с картинками и звуком.", { app: APP })}</p>
      <ol class="steps"><li>${t("Найдите колоду и нажмите «Download» на её странице.")}</li><li>${t("Вернитесь сюда и выберите скачанный .apkg.")}</li><li>${t("Готово: колода появится в «Моих колодах».")}</li></ol></div>
    <div class="a-search"><input type="search" id="ank-q" placeholder="${t("Что ищем на AnkiWeb? Например: English 4000")}"><button class="btn" data-a="ank-go">${t("Искать")}</button></div>
    <div class="fchips">${cats.map((c) => `<button class="fchip" data-a="ank-cat" data-k="${c}">${c}</button>`).join("")}</div>
    <div class="a-import"><button class="btn big" data-a="import-decks">📥 ${t("Выбрать скачанный .apkg")}</button></div>
    <p class="hint">${t("Колоды AnkiWeb лицензируются авторами для личного изучения, поэтому их нельзя публиковать в каталоге {app}. Прогресс из Anki не переносится — карточки начнутся как новые.", { app: APP })}</p></div>`;
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
    <div class="group"><div class="item"><input type="text" id="p-emoji" value="${esc(d.emoji || "📘")}" style="width:56px;text-align:center" maxlength="4"><input type="text" id="p-title" value="${esc(d.name)}" maxlength="80"></div>
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
    await publishDeck({ local_deck_id: deckId, title: g("p-title"), description: g("p-desc"), emoji: g("p-emoji") || "📘", lang_front: g("p-lf"), lang_back: g("p-lb"),
      tags: g("p-tags").split(/\s+/).filter(Boolean).slice(0, 10), author_name: g("p-author"), cards });
    haptic("success"); toast(t("Колода опубликована")); S.modal = null; render();
  } catch (e) { toast(t("Не удалось опубликовать") + ": " + (e as Error).message); }
}

// ---------- модальные окна ----------
const SYNC_LABEL = (): Record<string, string> => ({ off: t("выключена"), idle: t("синхронизировано"), syncing: t("идёт обмен…"), error: t("ошибка"), offline: t("нет связи"), auth: t("нужно войти") });

function renderModal() {
  const el = $("modal"), m = S.modal;
  el.classList.toggle("on", !!m);
  if (!m) { el.innerHTML = ""; pending = null; return; }
  const s = store.settings;
  if (m.type === "deck") {
    const d = allDecks().find((x) => x.id === m.id);
    el.innerHTML = `<div class="sheet"><h2>${d ? t("Настройки колоды") : t("Новая колода")}</h2>
      <div class="name-row"><input type="text" id="m-emoji" value="${esc(d?.emoji || "")}" placeholder="📘" maxlength="4"><input type="text" id="m-name" placeholder="${t("Например, 🇪🇸 Испанский")}" value="${esc(d?.name ?? "")}" maxlength="80"></div>
      <div class="group" style="margin-top:14px">
        <div class="item"><span><b>${t("Ввод ответа с клавиатуры")}</b><br><span class="muted" style="font-size:12px">${t("при верном слове — сразу следующая карточка, без Enter")}</span></span>
          <select id="m-typed" style="width:170px">${([["inherit", t("Как в настройках")], ["on", t("Всегда вводить")], ["off", t("Не вводить")]] as [TypedMode, string][]).map(([v, n]) => `<option value="${v}" ${(d?.typedMode ?? "inherit") === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="item"><span>${t("Новых карточек в день")}<br><span class="muted" style="font-size:12px">${t("пусто — как в общих настройках ({n})", { n: s.newPerDay })}</span></span><input type="number" id="m-new" min="0" max="999" value="${d?.newPerDay ?? ""}" style="width:80px"></div></div>
      ${d ? `<div class="group"><div class="item"><span>${t("Поменять стороны")}<br><span class="muted" style="font-size:12px">${t("лицевая ⇄ обратная у всех карточек колоды")}</span></span><button class="btn sec" data-a="deck-swap">${t("Поменять")}</button></div>
        <div class="item"><span>${t("Обратные копии")}<br><span class="muted" style="font-size:12px">${t("добавить карточки «ответ → вопрос»")}</span></span><button class="btn sec" data-a="deck-rev">${t("Добавить")}</button></div>
        <div class="item"><span>${t("Опубликовать в каталоге")}<br><span class="muted" style="font-size:12px">${t("поделиться колодой со всеми пользователями")}</span></span><button class="btn sec" data-a="deck-publish">${t("Открыть")}</button></div></div>` : ""}
      <div class="actions" style="display:flex;gap:8px;margin-top:16px">
        ${d ? `<button class="btn danger" data-a="deck-del">${t("Удалить")}</button>` : ""}<span style="flex:1"></span>
        <button class="btn sec" data-a="modal-close">${t("Отмена")}</button><button class="btn" data-a="deck-save">${t("Сохранить")}</button></div></div>`;
    if (!isMobile()) $("m-name").focus();
  } else if (m.type === "publish") {
    el.innerHTML = publishHtml(m.id!);
  } else if (m.type === "importdecks" && pending) {
    const p = pending, total = p.result.decks.reduce((n, d, i) => n + (p.sel[i] ? d.cards.length : 0), 0);
    const firstSel = p.result.decks.find((_d, i) => p.sel[i])?.cards[0];
    const list = p.result.decks.slice(0, 300).map((d, i) => `<div class="item"><input type="checkbox" data-sel="${i}" ${p.sel[i] ? "checked" : ""} style="width:17px;height:17px;flex:none;accent-color:var(--accent)">
      <input type="text" data-name="${i}" value="${esc(p.names[i]!)}" style="flex:1"><span class="muted" style="white-space:nowrap">${d.cards.length}</span></div>`).join("");
    el.innerHTML = `<div class="sheet"><h2>${t("Импорт колод")}</h2>
      <p class="hint" style="margin-left:0">${p.result.source === "apkg" ? t("Файл Anki (.apkg)") : t("Текстовый файл")}: ${t("найдено колод — {n}. Отметьте нужные и при желании измените названия.", { n: p.result.decks.length })}</p>
      <div class="group" style="max-height:260px;overflow:auto">${list}</div>
      <div class="group"><div class="item"><label class="lbl-row"><input type="checkbox" id="i-merge" ${p.merge ? "checked" : ""}> ${t("Добавлять в существующую колоду с тем же названием")}</label></div>
        <div class="item"><label class="lbl-row"><input type="checkbox" id="i-dup" ${p.skipDup ? "checked" : ""}> ${t("Пропускать дубликаты")}</label></div></div>
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
        ${inTelegram() ? "" : `<div class="item"><span>${t("Тема")}</span><span class="seg">${th}</span></div>`}
        <div class="item"><span>${t("Цвет акцента")}</span><span class="sw">${sw}</span></div></div>
      ${inTelegram() ? `<p class="hint">${t("Светлая и тёмная тема берутся из Telegram.")}</p>` : ""}
      <h3 class="grp-t">${t("Повторение")}</h3>
      <div class="group"><div class="item"><span>${t("Желаемое удержание")}<br><span class="muted" style="font-size:12px">${Math.round(s.retention * 100)}%</span></span>
        <input type="range" min="0.7" max="0.97" step="0.01" value="${s.retention}" id="s-ret"></div>
        <div class="item"><span>${t("Новых карточек в день")}</span><input type="number" id="s-new" min="0" max="999" value="${s.newPerDay}" style="width:80px"></div>
        <div class="item"><label class="chk" style="margin:0!important"><input type="checkbox" id="s-typed" ${s.typedAll ? "checked" : ""}> <span>${t("Вводить ответы с клавиатуры")}<br><span class="muted" style="font-weight:400">${t("при верном слове — сразу следующая карточка, без Enter (можно переопределить для колоды)")}</span></span></label></div>
        <div class="item"><label class="chk" style="margin:0!important"><input type="checkbox" id="s-manual" ${s.manualGrades ? "checked" : ""}> <span>${t("Оценивать вручную (4 кнопки)")}<br><span class="muted" style="font-weight:400">${t("по умолчанию выключено: сложность определяет умный таймер")}</span></span></label></div></div>
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
    let streak = 0;
    for (let d = per.has(today) ? today : today - DAY_MS; per.has(d); d -= DAY_MS) streak++;
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
      <div><b>${per.get(today) ?? 0}</b><span>${t("сегодня")}</span></div><div><b>${streak} 🔥</b><span>${t("дней подряд")}</span></div><div><b>${ret == null ? "—" : ret + "%"}</b><span>${t("удержание, 30 дн")}</span></div>
      <div><b>${cards.length}</b><span>${t("карточек")}</span></div><div><b>${nMature}</b><span>${t("зрелых (21+ дн)")}</span></div><div><b>${store.reviews.length}</b><span>${t("всего повторов")}</span></div></div>
      <div class="sec-t">${t("Активность")}</div><div class="heat">${cells.join("")}</div>
      <div class="sec-t">${t("Состав коллекции")}</div><div class="stack">${seg(nNew, "#8e8e93", t("Новые"))}${seg(nLearn, "#ff9500", t("Изучаются"))}${seg(nYoung, "#3390ec", t("Молодые"))}${seg(nMature, "#34c759", t("Зрелые"))}</div>
      <div class="legend"><span><i style="background:#8e8e93"></i>${t("новые")} ${nNew}</span><span><i style="background:#ff9500"></i>${t("изучаются")} ${nLearn}</span><span><i style="background:#3390ec"></i>${t("молодые")} ${nYoung}</span><span><i style="background:#34c759"></i>${t("зрелые")} ${nMature}</span></div>
      <div class="sec-t">${t("Прогноз на 14 дней")} <span class="muted" style="font-weight:400">(${t("повторения по дням")})</span></div>
      <div class="fc">${forecast.map((v, i) => `<div title="${v}"><i style="height:${Math.round((v / fmax) * 56) + (v ? 3 : 1)}px"></i><span>${i === 0 ? t("сег") : i}</span></div>`).join("")}</div>
      <div style="text-align:right;margin-top:10px"><button class="btn" data-a="modal-close">${t("Закрыть")}</button></div></div>`;
  }
}

function accountGroup(): string {
  const cfg = getConfig(), ses = getSession(), preset = !!presetConfig();
  const cloud = store.syncOn || getChoice() === "cloud";
  const head = `<h3 class="grp-t">${t("Синхронизация")}</h3>`;
  const toggle = `<div class="item"><label class="chk" style="margin:0!important"><input type="checkbox" id="s-sync" ${cloud ? "checked" : ""}> <span>${t("Колоды и прогресс на всех устройствах")}<br><span class="muted" style="font-weight:400">${cloud ? (ses && store.syncOn ? `${SYNC_LABEL()[sync.status] ?? ""}${sync.message ? " · " + esc(sync.message) : ""}${store.pendingCount ? " · " + t("ждут отправки: {n}", { n: store.pendingCount }) : ""}` : t("включается…")) : t("выключено: всё хранится только на этом устройстве")}</span></span></label></div>`;
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
    return head + `<div class="group">${toggle}<div class="item"><span>${t("Вход через Telegram")}</span><button class="btn" data-a="sy-tg">${t("Войти")}</button></div></div>${sync.message ? `<p class="hint">⚠ ${esc(sync.message)}</p>` : ""}`;
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
  queueMedia(await allMediaKeys());
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
    case "modal-close": S.modal = null; render(); break;
    case "settings": S.modal = { type: "settings" }; renderModal(); refreshFsInfo(); updateChrome(); break;
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
    case "br-close": S.browser = null; render(); break;
    case "br-tab": if (S.browser) { S.browser.tab = el.dataset.k as "spark" | "anki"; S.browser.open = null; renderBrowser(); updateChrome(); } break;
    case "br-lang": if (S.browser) { S.browser.lang = el.dataset.k ?? ""; renderBrowser(); } break;
    case "br-open": void openCatalogDeck(id!); break;
    case "br-back": if (S.browser) { S.browser.open = null; S.browser.cards = null; renderBrowser(); updateChrome(); } break;
    case "br-add": void addCatalogDeck(); break;
    case "br-goto": S.browser = null; S.deckId = id!; S.sel.clear(); if (isMobile()) S.pane = "cards"; render(); break;
    case "ank-go": openExternal(ankiUrl(($("ank-q") as HTMLInputElement).value)); break;
    case "ank-cat": openExternal(ankiUrl(el.dataset.k!)); break;
    case "m-back": goBack(); break;
    case "reload-app": store.flush(true); location.reload(); break;
    case "study": startReview(S.deckId); break;
    case "rv-close": closeReview(); break;
    case "rv-typed": toggleTyped(); break;
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
  else if (el.id === "s-sync") void setCloud((el as HTMLInputElement).checked);
  else if (el.dataset.sel !== undefined && pending) { pending.sel[Number(el.dataset.sel)] = (el as HTMLInputElement).checked; renderModal(); }
  else if (el.id === "i-merge" && pending) pending.merge = (el as HTMLInputElement).checked;
  else if (el.id === "i-dup" && pending) pending.skipDup = (el as HTMLInputElement).checked;
  else if (el.id === "file") {
    const f = (el as HTMLInputElement).files?.[0];
    if (f) void importFile(f);
    (el as HTMLInputElement).value = "";
  } else if (el.id === "img-file") {
    const f = (el as HTMLInputElement).files?.[0];
    if (f) void addImageFile(f);
    (el as HTMLInputElement).value = "";
  }
});
document.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
  const target = e.target as HTMLElement;
  if (f && target.classList?.contains("fld")) { e.preventDefault(); lastField = target as HTMLTextAreaElement; void addImageFile(f); }
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
  if (e.key === "Escape" && (S.modal || S.browser)) { goBack(); return; }
  if (S.modal) {
    if (e.key === "Enter" && S.modal.type === "deck" && (e.target as HTMLElement).id === "m-name") (document.querySelector('[data-a="deck-save"]') as HTMLElement)?.click();
    return;
  }
  if (S.browser) return;
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
  if (f.type.startsWith("image/") && (e.target as HTMLElement).closest?.(".editor")) void addImageFile(f);
  else void importFile(f);
});
addEventListener("beforeunload", () => store?.flush(true));
setInterval(() => { if (store && !S.review && !S.modal && !S.browser && document.visibilityState === "visible") renderDecks(); }, 30_000);

function attachStore() {
  store.onSaveError = () => toast(t("⚠️ Не удалось сохранить данные!"));
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
  try { store = new Store(await backend.load()); }
  catch (e) { document.body.innerHTML = `<div class="empty"><div class="em">⚠️</div><h3>Error</h3>${esc((e as Error).message)}</div>`; return; }
  sync = new SyncService(() => store, updateSyncInd, onPulled, getMediaBlob);
  attachStore();
  if (store.syncOn) setMediaSync((k) => queueMedia([k]), downloadMedia);
  (window as unknown as { __spark: unknown }).__spark = { store, S, render, sync, inTelegram, t };
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
