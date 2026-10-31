/** Интеграция с Telegram Mini App (работает только если приложение открыто внутри Telegram). */
interface TgWebApp {
  ready(): void; expand(): void; close(): void; colorScheme: "light" | "dark";
  themeParams: Record<string, string | undefined>;
  initData: string; platform: string; isVersionAtLeast(v: string): boolean;
  initDataUnsafe?: { user?: { id: number; username?: string; first_name?: string; language_code?: string } };
  openLink?(url: string, opts?: { try_instant_view?: boolean }): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void; selectionChanged(): void };
  onEvent(e: string, cb: () => void): void;
  disableVerticalSwipes?(): void; enableClosingConfirmation?(): void; disableClosingConfirmation?(): void;
  setHeaderColor?(c: string): void; setBackgroundColor?(c: string): void;
}
const w = () => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** Telegram передаёт параметры запуска в hash: #tgWebAppData=… */
export const launchedFromTelegram = () => /tgWebAppData=|tgWebAppPlatform=/.test(location.hash) || sessionStorage.getItem("recall.tg") === "1";

export function loadTelegram(): Promise<void> {
  if (!launchedFromTelegram()) return Promise.resolve();
  sessionStorage.setItem("recall.tg", "1"); // hash пропадёт после навигации — запоминаем на сессию
  if (w()) return Promise.resolve();
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = () => res(); s.onerror = () => res();
    document.head.appendChild(s);
    setTimeout(res, 3000);
  });
}

export const inTelegram = () => !!w();

export function initTelegram(onBack: () => void, onTheme: () => void): void {
  const t = w();
  if (!t) return;
  document.documentElement.classList.add("tg");
  t.ready(); t.expand(); t.disableVerticalSwipes?.();
  t.BackButton.onClick(onBack);
  t.onEvent("themeChanged", onTheme);
}

/** Тёмная ли тема у Telegram (только для режима «Авто»). Цвета Telegram не используются — у Spark своя палитра. */
export const tgColorScheme = (): "light" | "dark" | null => w()?.colorScheme ?? null;

/** Шапка, фон и нижняя панель Telegram — в цвет Spark, чтобы не было «чужих» полос. */
export function paintTelegramChrome(bg: string): void {
  const t = w() as (TgWebApp & { setBottomBarColor?(c: string): void }) | undefined;
  if (!t) return;
  try { t.setHeaderColor?.(bg); t.setBackgroundColor?.(bg); t.setBottomBarColor?.(bg); } catch { /* старые клиенты */ }
}

/** Ярлык Mini App на главный экран телефона (Bot API 8.0+). */
type HomeStatus = "unsupported" | "unknown" | "added" | "missed";
export function homeScreenSupported(): boolean { const t = w(); return !!t && t.isVersionAtLeast("8.0") && typeof (t as unknown as { addToHomeScreen?: unknown }).addToHomeScreen === "function"; }
export function addToHomeScreen(): void { (w() as unknown as { addToHomeScreen?(): void })?.addToHomeScreen?.(); }
export function checkHomeScreen(): Promise<HomeStatus> {
  return new Promise((res) => {
    const t = w() as unknown as { checkHomeScreenStatus?(cb: (s: HomeStatus) => void): void } | undefined;
    if (!t?.checkHomeScreenStatus || !homeScreenSupported()) return res("unsupported");
    t.checkHomeScreenStatus((s) => res(s));
    setTimeout(() => res("unknown"), 2500);
  });
}
export function onHomeScreenAdded(cb: () => void) { w()?.onEvent("homeScreenAdded", cb); }

export function setBackButton(visible: boolean): void {
  const b = w()?.BackButton;
  if (b) visible ? b.show() : b.hide();
}
export function closingConfirmation(on: boolean): void {
  const t = w();
  if (on) t?.enableClosingConfirmation?.(); else t?.disableClosingConfirmation?.();
}
export function haptic(kind: "light" | "select" | "success" | "error"): void {
  const h = w()?.HapticFeedback;
  if (!h) return;
  if (kind === "select") h.selectionChanged();
  else if (kind === "light") h.impactOccurred("light");
  else h.notificationOccurred(kind);
}

export const tgInitData = () => w()?.initData ?? "";
export const tgUser = () => w()?.initDataUnsafe?.user;
/** Внешняя ссылка: в Telegram — через openLink (откроется браузер), иначе новая вкладка. */
export function openExternal(url: string): void {
  const t = w();
  if (t?.openLink) { t.openLink(url); return; }
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
