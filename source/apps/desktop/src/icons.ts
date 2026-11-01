/** Тонкие линейные иконки Spark (24×24, цвет — currentColor). Вместо эмодзи: ровнее и в одном стиле. */
const P: Record<string, string> = {
  catalog: '<rect x="3" y="7" width="13" height="13" rx="2.5"/><path d="M7.5 7V5.5A2.5 2.5 0 0 1 10 3h8.5A2.5 2.5 0 0 1 21 5.5V14a2.5 2.5 0 0 1-2.5 2.5H16"/>',
  import: '<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 16.5v1.5A2.5 2.5 0 0 0 6.5 20.5h11A2.5 2.5 0 0 0 20 18v-1.5"/>',
  stats: '<path d="M5 20V12"/><path d="M10.5 20V5"/><path d="M16 20v-6"/><path d="M21 20v-10"/>',
  settings: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 17h11"/><path d="M19 17h1"/><circle cx="17" cy="17" r="2"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  list: '<path d="M9 6.5h11"/><path d="M9 12h11"/><path d="M9 17.5h11"/><path d="M4.5 6.5h.01"/><path d="M4.5 12h.01"/><path d="M4.5 17.5h.01"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  cloud: '<path d="M7.5 18.5a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.6 9.6a4.25 4.25 0 0 1-.6 8.9z"/>',
  "cloud-ok": '<path d="M7.5 18.5a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.6 9.6a4.25 4.25 0 0 1-.6 8.9z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
  "cloud-off": '<path d="M7.5 18.5a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.6 9.6a4.25 4.25 0 0 1-.6 8.9z"/><path d="M4 4l16 16"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9"/><path d="M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3.5v3.6h-3.6"/><path d="M5.5 20.5v-3.6h3.6"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5"/><path d="m16.5 6.5 2.5 2.5"/>',
  clip: '<path d="m20.5 11.5-8.4 8.4a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.8 1.8 0 0 1-2.6-2.6l7.6-7.6"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01"/><path d="M10 10h.01"/><path d="M13.5 10h.01"/><path d="M17 10h.01"/><path d="M7.5 14h9"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-4.5-4.5L8 20"/>',
  video: '<rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="m16 10.5 5.5-3v9l-5.5-3z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>',
  share: '<path d="M12 15V3.5"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  flame: '<path d="M12 21a6.5 6.5 0 0 1-6.5-6.5c0-3.2 2.2-5.3 3.6-7.3.4 1.7 1.3 2.8 2.4 3.3C11.5 7.5 13 5 14.5 3c.4 3 5 5.4 5 11.5A6.5 6.5 0 0 1 12 21z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  inbox: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5h13L21 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V13z"/>',
  cap: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3V11"/><path d="M21.5 9v5.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
  shuffle: '<path d="M3 7h3.5c3 0 4.5 2 6 5s3 5 6 5H21"/><path d="M3 17h3.5c1.5 0 2.6-.6 3.6-1.7"/><path d="M13 8.2c1-.8 2.2-1.2 3.5-1.2H21"/><path d="m18.5 4.5 2.5 2.5-2.5 2.5"/><path d="m18.5 14.5 2.5 2.5-2.5 2.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8v.2"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.8"/><rect x="16.5" y="14" width="4" height="6" rx="1.8"/>',
  tag: '<path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5a1.4 1.4 0 0 1 0 2L14 20.5a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.2"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8.5 20.5h7"/><path d="M10 17h4v3.5h-4z"/>',
  pause: '<rect x="7" y="5.5" width="3.5" height="13" rx="1"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1"/>',
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
};

export function ic(name: string, cls = ""): string {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;
}

/** Иконки в статичной разметке: <span data-ic="stats"></span>. */
export function fillIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-ic]").forEach((el) => { if (!el.dataset.icDone) { el.innerHTML = ic(el.dataset.ic!); el.dataset.icDone = "1"; } });
}

/**
 * Знак серии Spark — живая мини-версия логотипа: две карточки «дышат», сфера пульсирует,
 * звезда-искра вращается и мерцает, вокруг летают искры (их больше на высоких уровнях). Анимация постоянная.
 * Цвет уровня задаёт родитель через --c1 (сфера) и --c3 (задняя карточка).
 */
export function sparkMark(cls = ""): string {
  const ph = `--ph:-${((performance.now() % 6000) / 1000).toFixed(2)}s`; // фаза продолжается между перерисовками — без рывков
  // «Искра» Spark: четырёхлучевая звезда из логотипа, вытянутая вверх языком пламени; ядро мерцает, искры улетают вверх
  const star = "M15.3 2.6C18 6.4 17.3 10.4 18.3 14.1C19.1 17 22.5 18.6 26.6 20C21.7 21.3 18.2 22.5 16.8 29.4C15.2 22.7 12.3 21.3 5.4 20C11.5 18.4 14.6 16.1 14.4 11.5C14.3 8.3 13.4 5.5 15.3 2.6Z";
  return `<svg class="smark ${cls}" style="${ph}" viewBox="0 0 32 32" aria-hidden="true">
    <circle class="sk-halo" cx="16" cy="19.5" r="10.5"/>
    <g class="sk-out"><path d="${star}"/></g>
    <g class="sk-mid"><path d="${star}"/></g>
    <path class="sk-core" d="M16 16.4l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9z"/>
    <circle class="sk-em e1" cx="19.5" cy="6" r="1.1"/><circle class="sk-em e2" cx="22.5" cy="12" r=".9"/><circle class="sk-em e3" cx="10" cy="12.5" r=".85"/></svg>`;
}

/** Уровни серии: 1, 3, 5, 10, 15, 20, 25, 30+ — с каждым уровнем эффекты вокруг искры сильнее и разнообразнее. */
export const STREAK_LEVELS = [0, 1, 3, 5, 10, 15, 20, 25, 30];
export const streakLevel = (n: number) => STREAK_LEVELS.reduce((acc, v, i) => (n >= v ? i : acc), 0);
/** Искра + эффекты вокруг неё (свечение, волны, орбиты искр, мерцающие звёзды, созвездие, карточки, лучи). */
export function streakMark(level: number, cls = ""): string {
  const ph = `--ph:-${((performance.now() % 6000) / 1000).toFixed(2)}s`;
  const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("");
  return `<span class="spk lv${level}" style="${ph}"><span class="spk-fx" aria-hidden="true">
    <i class="fx-rays"></i><i class="fx-glow"></i><i class="fx-ring r1"></i><i class="fx-ring r2"></i>
    <svg class="fx-const" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/>${[0, 72, 144, 216, 288].map((a) => `<path transform="rotate(${a} 50 50)" d="M50 2.5l1.6 3.9 3.9 1.6-3.9 1.6-1.6 3.9-1.6-3.9-3.9-1.6 3.9-1.6z"/>`).join("")}</svg>
    ${many(3, (i) => `<span class="fx-orbit o${i + 1}"><i></i></span>`)}
    ${many(2, (i) => `<span class="fx-orbit fx-card c${i + 1}"><i></i></span>`)}
    ${many(4, (i) => `<i class="fx-tw w${i + 1}"></i>`)}
    ${many(5, (i) => `<i class="fx-up u${i + 1}"></i>`)}
  </span>${sparkMark(cls)}</span>`;
}

/** Серия дней — «созвездие»: значок ночного неба, где с каждым уровнем зажигаются звёзды,
 *  а вокруг появляются луны, кометы, кольца, сияние, галактика… 15 уровней. */
export const DAY_LEVELS = [0, 1, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300];
export const dayLevel = (n: number) => DAY_LEVELS.reduce((acc, v, i) => (n >= v ? i : acc), 0);
const RIM = ["#8e8e93", "#c4b5fd", "#a78bfa", "#8b5cf6", "#d08c4a", "#d08c4a", "#cbd5e1", "#cbd5e1", "#fbbf24", "#fbbf24", "#34d399", "#38bdf8", "#e0f2fe", "#c084fc", "#f472b6", "#fde68a"];
export const dayColor = (level: number) => RIM[Math.max(0, Math.min(15, level))]!;
const SKY = [["#3a3a40", "#1c1c20"], ["#3b2a6b", "#140d2b"], ["#3b2a6b", "#140d2b"], ["#41247d", "#120a2e"], ["#3a2160", "#120a26"], ["#3a2160", "#120a26"],
  ["#1e2a5c", "#0b1024"], ["#1e2a5c", "#0b1024"], ["#3b2470", "#120a26"], ["#3b2470", "#120a26"], ["#0f3b4a", "#071a24"], ["#13305e", "#08122a"],
  ["#1d3a6e", "#0a1430"], ["#3b1a6e", "#0d0620"], ["#5a1a5e", "#14061c"], ["#4a1d7a", "#0d0620"]];
const PTS: [number, number][] = [[13.5, 14], [19.5, 10.8], [26.2, 13.2], [28.6, 20.2], [24, 26.6], [15.8, 27.6], [11.2, 21.4]];
export function dayMark(level: number, cls = ""): string {
  const L = Math.max(0, Math.min(15, level)), ph = `--ph:-${((performance.now() % 8000) / 1000).toFixed(2)}s`;
  const [s1, s2] = SKY[L]!, rim = RIM[L]!, n = L >= 7 ? 7 : L, id = `ds${L}`;
  const at = (lv: number) => L >= lv;
  const line = n >= 2 ? `<path class="dm-line" d="M${PTS.slice(0, n).map((p) => p.join(" ")).join("L")}${L >= 8 ? "Z" : ""}"/>` : "";
  const stars = PTS.slice(0, Math.max(n, 0)).map((p, i) => `<circle class="dm-st" style="animation-delay:calc(var(--ph) - ${(i * 0.37).toFixed(2)}s)" cx="${p[0]}" cy="${p[1]}" r="${i === n - 1 ? 1.35 : 1.05}"/>`).join("");
  const field = at(11) ? [[-3, 4], [43, 8], [41, 34], [-1, 36], [20, -5], [20, 45]].map(([x, y], i) => `<path class="dm-tw" style="animation-delay:calc(var(--ph) - ${(i * 0.45).toFixed(2)}s)" transform="translate(${x} ${y})" d="M0 -2.2L.55 -.55 2.2 0 .55 .55 0 2.2-.55 .55-2.2 0-.55 -.55Z"/>`).join("") : "";
  return `<svg class="dmark dl${L} ${cls}" style="${ph};--rim:${rim}" viewBox="0 0 40 40" aria-hidden="true"><defs>
      <radialGradient id="${id}s" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="${s1}"/><stop offset="1" stop-color="${s2}"/></radialGradient>
      ${at(10) ? `<filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>` : ""}</defs>
    ${at(13) ? `<g class="dm-gal"><path d="M20 20c6-9 17-6 18 2M20 20c-6 9-17 6-18-2M20 20c9 6 6 17-2 18M20 20c-9-6-6-17 2-18"/></g>` : ""}
    ${at(12) ? `<g class="dm-rays">${Array.from({ length: 12 }, (_, i) => `<path transform="rotate(${i * 30} 20 20)" d="M19.2 1.5L20 -3.5 20.8 1.5Z"/>`).join("")}</g>` : ""}
    ${at(10) ? `<g class="dm-aur" filter="url(#${id}b)"><ellipse cx="11" cy="15" rx="10" ry="6"/><ellipse class="a2" cx="29" cy="25" rx="10" ry="6"/></g>` : ""}
    ${at(1) ? `<circle class="dm-halo" cx="20" cy="20" r="17.5"/>` : ""}
    ${at(9) ? `<ellipse class="dm-ring back" cx="20" cy="20" rx="25" ry="7.5" transform="rotate(-18 20 20)"/>` : ""}
    ${at(6) ? `<circle class="dm-orbit" cx="20" cy="20" r="20.5"/>` : ""}
    ${at(8) ? `<circle class="dm-wave" cx="20" cy="20" r="16"/>${at(15) ? `<circle class="dm-wave w2" cx="20" cy="20" r="16"/>` : ""}` : ""}
    <circle class="dm-sky" cx="20" cy="20" r="15" fill="url(#${id}s)"/>
    <circle class="dm-rim" cx="20" cy="20" r="15.4"/>
    ${at(8) ? `<circle class="dm-shine" cx="20" cy="20" r="15.4"/>` : ""}
    ${line}${stars}
    <path class="dm-core" d="M20 16.6l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z"/>
    ${at(9) ? `<path class="dm-ring front" d="M-3.78 27.73A25 7.5 -18 0 0 43.78 12.27"/>` : ""}
    ${at(3) ? `<g class="dm-moon m1"><circle cx="20" cy="-0.5" r="2.1"/></g>` : ""}${at(7) ? `<g class="dm-moon m2"><circle cx="20" cy="41" r="1.5"/></g>` : ""}${at(14) ? `<g class="dm-moon m3"><circle cx="-1.5" cy="20" r="1.3"/></g>` : ""}
    ${at(5) ? `<g class="dm-comet"><path d="M0 0L-9 3.2-8.6 1.2Z"/><circle r="1.25"/></g>${at(11) ? `<g class="dm-comet c2"><path d="M0 0L-7 2.6-6.7 1Z"/><circle r="1"/></g>` : ""}` : ""}
    ${field}</svg>`;
}
