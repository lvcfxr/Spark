// Supabase Edge Function «telegram-bot»: сам бот Spark в чате Telegram.
//  • /start — картинка-приветствие и кнопка «Открыть Spark» (Mini App открывается сразу)
//  • /news — что нового в последних версиях; /notify — включить или выключить уведомления об обновлениях
//  • ?action=broadcast — разослать список изменений новой версии всем, кто не отключил уведомления
//    (вызывает GitHub Action после публикации; повторно одну версию не шлёт)
//  • ?action=remind — раз в день (GitHub Action): написать тем, кто не занимался 7 и 30 дней (по одному разу); /remind — вкл/выкл
//  • ?action=setup — один раз: подключить вебхук, команды и кнопку меню (токен вводить никуда не нужно)
// Секреты (Edge Functions → Secrets): TELEGRAM_BOT_TOKEN — токен бота, BOT_ADMIN_SECRET — любой длинный пароль,
// по нему функция узнаёт Telegram (вебхук) и вас (setup / broadcast). SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase передаёт сам.
// При создании функции выключите «Verify JWT».

const APP_URL = (Deno.env.get("SPARK_APP_URL") ?? "https://lvcfxr.github.io/Spark/").replace(/\/?$/, "/");
const TG = Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org";
const token = () => Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const admin = () => Deno.env.get("BOT_ADMIN_SECRET") ?? "";

type Lang = "ru" | "en";
const TXT = {
  ru: {
    hello: (name: string) => `Привет${name ? ", " + name : ""}! ✨\n\n<b>Spark</b> — карточки с умными повторениями прямо в Telegram. Слова, факты, что угодно: Spark сам решит, когда что повторить, чтобы запомнилось надолго.\n\n• готовые колоды с озвучкой и транскрипцией\n• свои колоды, картинки и звук\n• серии дней и прогресс на всех устройствах\n\nНажмите кнопку ниже — и начнём.`,
    open: "✨ Открыть Spark", news: "📰 Что нового", notifyOn: "🔔 Уведомления: вкл", notifyOff: "🔕 Уведомления: выкл",
    newsTitle: "Что нового в Spark", noNews: "Список изменений пока пуст.",
    on: "Буду присылать, что нового в каждой версии. Отключить — /notify", off: "Уведомления об обновлениях выключены. Включить снова — /notify",
    update: (v: string) => `🚀 <b>Spark ${v}</b> — вышло обновление`,
    help: "Команды:\n/start — открыть Spark\n/news — что нового\n/notify — уведомления об обновлениях вкл/выкл\n/remind — напоминания о занятиях вкл/выкл",
    commands: [["start", "Открыть Spark"], ["news", "Что нового"], ["notify", "Уведомления об обновлениях"], ["remind", "Напоминания о занятиях"], ["help", "Помощь"]],
    menu: "Spark",
  },
  en: {
    hello: (name: string) => `Hi${name ? ", " + name : ""}! ✨\n\n<b>Spark</b> is flashcards with smart spaced repetition, right inside Telegram. Words, facts, anything — Spark decides when to review each card so it sticks.\n\n• ready-made decks with audio and transcription\n• your own decks with images and sound\n• day streaks and progress on every device\n\nTap the button below to start.`,
    open: "✨ Open Spark", news: "📰 What's new", notifyOn: "🔔 Notifications: on", notifyOff: "🔕 Notifications: off",
    newsTitle: "What's new in Spark", noNews: "No changes yet.",
    on: "I'll tell you what's new in each version. Turn off — /notify", off: "Update notifications are off. Turn on again — /notify",
    update: (v: string) => `🚀 <b>Spark ${v}</b> is out`,
    help: "Commands:\n/start — open Spark\n/news — what's new\n/notify — update notifications on/off\n/remind — study reminders on/off",
    commands: [["start", "Open Spark"], ["news", "What's new"], ["notify", "Update notifications"], ["remind", "Study reminders"], ["help", "Help"]],
    menu: "Spark",
  },
};
const langOf = (code?: string): Lang => (code && !/^(ru|uk|be|kk)/.test(code) ? "en" : "ru");
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

async function tg(method: string, body: unknown) {
  const r = await fetch(`${TG}/bot${token()}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) console.log("telegram", method, JSON.stringify(j).slice(0, 300));
  return j;
}

// ---------- база (PostgREST с ключом service_role: таблицы закрыты RLS для всех остальных) ----------
async function db(path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) { console.log("db", path, r.status, (await r.text()).slice(0, 200)); return null; }
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}
interface Chat { chat_id: number; first_name?: string; lang: Lang; notify: boolean }
const getChat = async (id: number): Promise<Chat | null> => ((await db(`bot_chats?chat_id=eq.${id}&select=*`)) ?? [])[0] ?? null;
const saveChat = (c: Partial<Chat> & { chat_id: number }) =>
  db("bot_chats?on_conflict=chat_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ ...c, last_seen: new Date().toISOString() }) });

// ---------- список изменений: changelog.json лежит рядом с приложением ----------
interface Release { version: string; date?: string; ru: string[]; en: string[] }
async function changelog(): Promise<Release[]> {
  try { const r = await fetch(APP_URL + "changelog.json?t=" + Date.now()); return r.ok ? ((await r.json()) as { releases: Release[] }).releases ?? [] : []; } catch { return []; }
}
const releaseText = (r: Release, L: Lang) => `<b>${esc(r.version)}</b>${r.date ? ` · ${esc(r.date)}` : ""}\n` + (r[L] ?? r.ru).map((x) => "• " + esc(x)).join("\n");

const keyboard = (L: Lang, notify: boolean) => ({ inline_keyboard: [
  [{ text: TXT[L].open, web_app: { url: APP_URL } }],
  [{ text: TXT[L].news, callback_data: "news" }, { text: notify ? TXT[L].notifyOn : TXT[L].notifyOff, callback_data: "notify" }],
] });

async function onStart(chatId: number, from: { first_name?: string; language_code?: string }) {
  const L = langOf(from.language_code), prev = await getChat(chatId), notify = prev?.notify ?? true;
  await saveChat({ chat_id: chatId, first_name: from.first_name ?? "", lang: L, notify });
  const caption = TXT[L].hello(esc(from.first_name ?? ""));
  const r = await tg("sendPhoto", { chat_id: chatId, photo: `${APP_URL}bot/welcome-${L}.jpg`, caption, parse_mode: "HTML", reply_markup: keyboard(L, notify) });
  if (!r.ok) await tg("sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML", reply_markup: keyboard(L, notify) });
}
async function onNews(chatId: number, L: Lang) {
  const rel = (await changelog()).slice(0, 3);
  const text = rel.length ? `📰 <b>${TXT[L].newsTitle}</b>\n\n` + rel.map((r) => releaseText(r, L)).join("\n\n") : TXT[L].noNews;
  await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: TXT[L].open, web_app: { url: APP_URL } }]] } });
}
async function onNotify(chatId: number, from: { first_name?: string; language_code?: string }, msg?: { message_id: number; reply_markup?: unknown }) {
  const L = langOf(from.language_code), prev = await getChat(chatId), notify = !(prev?.notify ?? true);
  await saveChat({ chat_id: chatId, first_name: from.first_name ?? prev?.first_name ?? "", lang: L, notify });
  if (msg?.reply_markup) await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: msg.message_id, reply_markup: keyboard(L, notify) });
  await tg("sendMessage", { chat_id: chatId, text: notify ? TXT[L].on : TXT[L].off });
}

async function broadcast(force: string | null) {
  const rel = (await changelog())[0];
  if (!rel) return { ok: false, error: "changelog.json пуст или недоступен" };
  const state = ((await db("bot_state?key=eq.last_broadcast&select=value")) ?? [])[0]?.value;
  if (state === rel.version && force !== rel.version) return { ok: true, skipped: `версия ${rel.version} уже разослана` };
  const chats: Chat[] = (await db("bot_chats?notify=eq.true&select=chat_id,lang")) ?? [];
  let sent = 0, gone = 0;
  for (const c of chats) {
    const L = c.lang === "en" ? "en" : "ru";
    const r = await tg("sendMessage", { chat_id: c.chat_id, text: TXT[L].update(esc(rel.version)) + "\n\n" + (rel[L] ?? rel.ru).map((x) => "• " + esc(x)).join("\n"), parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: TXT[L].open, web_app: { url: APP_URL } }]] } });
    if (r.ok) sent++;
    else if (r.error_code === 403) { gone++; await saveChat({ chat_id: c.chat_id, notify: false }); } // бот заблокирован — больше не пишем
    await new Promise((res) => setTimeout(res, 40)); // ~25 сообщений в секунду — в пределах лимита Telegram
  }
  await db("bot_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "last_broadcast", value: rel.version }) });
  return { ok: true, version: rel.version, sent, blocked: gone, total: chats.length };
}

// ---------- напоминания после недели и месяца без занятий ----------
interface Prog { tg_id: number; words: number; due: number; level: number; xp_left: number; streak: number; best_streak: number; last_study: string; remind: boolean; stage: number }
const plural = (n: number, f: [string, string, string]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
const WORDS = (n: number, L: Lang) => L === "en" ? `${n} ${n === 1 ? "word" : "words"}` : `${n} ${plural(n, ["слово", "слова", "слов"])}`;
const CARDS = (n: number, L: Lang) => L === "en" ? `${n} ${n === 1 ? "card" : "cards"}` : `${n} ${plural(n, ["карточка", "карточки", "карточек"])}`;
function remindText(p: Prog, name: string, L: Lang, stage: 1 | 2): string {
  const w = WORDS(p.words, L), pick = <T,>(a: T[]) => a[p.tg_id % a.length]!;
  const hi = name ? esc(name) + ", " : "";
  const best = p.best_streak > 2 ? (L === "en" ? ` Your best streak is ${p.best_streak} days — you know you can do it.` : ` Ваш рекорд — ${p.best_streak} ${plural(p.best_streak, ["день", "дня", "дней"])} подряд: вы уже доказали, что это по силам.`) : "";
  if (L === "en") {
    if (stage === 1) return pick([
      `${hi}your ${w} are still here. 🌱\n\nA week off is when forgetting starts — but it's also when review works best: each recall now sticks longer than a fresh start would.${p.due ? ` ${CARDS(p.due, L)} are ripe right now.` : ""} Five minutes today keeps what you built.${best}`,
      `${hi}a week without Spark — and ${w} are waiting for you, not gone.\n\n${p.xp_left ? `Level ${p.level + 1} is only ${p.xp_left} XP away — about one short session.` : "One short session and you're back."}${p.due ? ` ${CARDS(p.due, L)} are due.` : ""}${best}`,
    ]);
    return pick([
      `${hi}a month later, ${w} are still in your Spark. 💫\n\nThey're not lost: the system keeps every card and will bring each back at the right moment — relearning is far faster than learning. Start with 10 cards, 3 minutes. I won't nag again — the door is open.${best}`,
      `${hi}it's been a month. Pauses happen — and what you learned (${w}, level ${p.level}) doesn't vanish.\n\nOpen Spark and answer 10 cards: you'll be surprised how much comes back. This is my last reminder; the rest is up to you.${best}`,
    ]);
  }
  if (stage === 1) return pick([
    `${hi}ваши ${w} никуда не делись. 🌱\n\nНеделя перерыва — как раз момент, когда забывание только начинается, а повторение работает лучше всего: сейчас каждое вспоминание закрепляется надолго.${p.due ? ` Прямо сейчас «созрели» ${CARDS(p.due, L)}.` : ""} Пять минут сегодня сохранят то, что вы уже построили.${best}`,
    `${hi}неделя без Spark — и ${w} ждут вас, а не пропали.\n\n${p.xp_left ? `До уровня ${p.level + 1} осталось всего ${p.xp_left} XP — это одно короткое занятие.` : "Одно короткое занятие — и вы снова в ритме."}${p.due ? ` На повтор ждут ${CARDS(p.due, L)}.` : ""}${best}`,
    `${hi}вы выучили ${w} и дошли до уровня ${p.level}. Это уже не ноль — и это легко сохранить. ✨\n\n${p.due ? `${CARDS(p.due, L)} просят повторения, ` : ""}несколько минут — и неделя паузы будет незаметна.${best}`,
  ]);
  return pick([
    `${hi}прошёл месяц, а ${w} всё ещё в вашем Spark. 💫\n\nОни не потеряны: система хранит каждую карточку и вернёт её в нужный момент — вспоминать намного быстрее, чем учить заново. Начните с 10 карточек, это 3 минуты. Больше напоминать не буду — дверь открыта.${best}`,
    `${hi}месяц позади. Перерывы бывают — и то, что вы выучили (${w}, уровень ${p.level}), никуда не исчезает.\n\nОткройте Spark и ответьте на 10 карточек: удивитесь, сколько вернётся сразу. Это моё последнее напоминание, дальше — как захотите.${best}`,
  ]);
}
async function remind() {
  const now = Date.now(), iso = (d: number) => new Date(now - d * 86400000).toISOString();
  const rows: Prog[] = (await db(`bot_progress?remind=eq.true&tg_id=not.is.null&last_study=lt.${encodeURIComponent(iso(7))}&stage=lt.2&select=*`)) ?? [];
  let sent = 0, skipped = 0;
  for (const p of rows) {
    const idle = (now - Date.parse(p.last_study)) / 86400000;
    const stage: 1 | 2 | 0 = idle >= 30 && p.stage < 2 ? 2 : idle >= 7 && p.stage < 1 ? 1 : 0;
    if (!stage || p.words < 1) { skipped++; continue; }
    const chat = await getChat(p.tg_id), L: Lang = chat?.lang === "en" ? "en" : "ru";
    const r = await tg("sendMessage", { chat_id: p.tg_id, text: remindText(p, chat?.first_name ?? "", L, stage), parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: stage === 2 ? TXT[L].open : (L === "en" ? "▶️ 5 minutes" : "▶️ Пять минут"), web_app: { url: APP_URL } }]] } });
    if (r.ok) sent++;
    await db(`bot_progress?tg_id=eq.${p.tg_id}`, { method: "PATCH", body: JSON.stringify({ stage: r.ok || r.error_code === 403 || r.error_code === 400 ? stage : p.stage }) });
    await new Promise((res) => setTimeout(res, 40));
  }
  return { ok: true, candidates: rows.length, sent, skipped };
}
async function onRemind(chatId: number, from: { language_code?: string }) {
  const L = langOf(from.language_code), cur = ((await db(`bot_progress?tg_id=eq.${chatId}&select=remind`)) ?? [])[0];
  if (!cur) return void (await tg("sendMessage", { chat_id: chatId, text: L === "en" ? "Open Spark once and sign in with Telegram — then reminders can be switched here." : "Откройте Spark и войдите через Telegram — тогда напоминаниями можно будет управлять здесь." }));
  const next = !cur.remind;
  await db(`bot_progress?tg_id=eq.${chatId}`, { method: "PATCH", body: JSON.stringify({ remind: next }) });
  await tg("sendMessage", { chat_id: chatId, text: next ? (L === "en" ? "Study reminders are on (at most one after a week and one after a month). Turn off — /remind" : "Напоминания включены (не больше одного через неделю и одного через месяц без занятий). Отключить — /remind") : (L === "en" ? "Study reminders are off. Turn on — /remind" : "Напоминания выключены. Включить — /remind") });
}

async function setup(selfUrl: string) {
  const out: Record<string, unknown> = {};
  out.webhook = await tg("setWebhook", { url: selfUrl, secret_token: admin(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  for (const L of ["ru", "en"] as Lang[]) out["commands_" + L] = await tg("setMyCommands", { commands: TXT[L].commands.map(([command, description]) => ({ command, description })), ...(L === "en" ? { language_code: "en" } : {}) });
  out.menu = await tg("setChatMenuButton", { menu_button: { type: "web_app", text: TXT.ru.menu, web_app: { url: APP_URL } } });
  return out;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (!token() || !admin()) return json(500, { error: "Задайте секреты TELEGRAM_BOT_TOKEN и BOT_ADMIN_SECRET" });
  const url = new URL(req.url), action = url.searchParams.get("action");
  if (action) {
    if ((url.searchParams.get("key") ?? req.headers.get("x-admin-secret")) !== admin()) return json(403, { error: "неверный ключ" });
    if (action === "setup") {
      const self = `${Deno.env.get("SUPABASE_URL") ?? url.origin}/functions/v1/telegram-bot`;
      return json(200, await setup(self));
    }
    if (action === "remind") return json(200, await remind());
    if (action === "broadcast") return json(200, await broadcast(url.searchParams.get("force")));
    return json(400, { error: "action: setup | broadcast" });
  }
  // обновление от Telegram: проверяем секрет вебхука
  if (req.headers.get("x-telegram-bot-api-secret-token") !== admin()) return json(403, { error: "forbidden" });
  const u = await req.json().catch(() => null);
  try {
    if (u?.message?.text && u.message.chat?.type === "private") {
      const m = u.message, cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase(), L = langOf(m.from?.language_code);
      if (cmd === "/start") await onStart(m.chat.id, m.from ?? {});
      else if (cmd === "/news") await onNews(m.chat.id, L);
      else if (cmd === "/remind") await onRemind(m.chat.id, m.from ?? {});
      else if (cmd === "/notify") await onNotify(m.chat.id, m.from ?? {});
      else await tg("sendMessage", { chat_id: m.chat.id, text: TXT[L].help, reply_markup: { inline_keyboard: [[{ text: TXT[L].open, web_app: { url: APP_URL } }]] } });
    } else if (u?.callback_query) {
      const q = u.callback_query, chatId = q.message?.chat?.id, L = langOf(q.from?.language_code);
      await tg("answerCallbackQuery", { callback_query_id: q.id });
      if (chatId && q.data === "news") await onNews(chatId, L);
      if (chatId && q.data === "notify") await onNotify(chatId, q.from ?? {}, q.message);
    }
  } catch (e) { console.log("update error", (e as Error).message); }
  return json(200, { ok: true }); // Telegram всегда получает 200, иначе будет слать то же обновление снова
});
