/**
 * Флаги картинками: на Windows (Telegram Desktop) у системного шрифта нет эмодзи-флагов — они превращаются в буквы «ES», «GB».
 * Поэтому флаги рисуем своими SVG; остальные эмодзи показываем как есть.
 */
const R = (x: number, y: number, w: number, h: number, c: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const H3 = (a: string, b: string, c: string) => R(0, 0, 3, .667, a) + R(0, .667, 3, .667, b) + R(0, 1.333, 3, .667, c);
const V3 = (a: string, b: string, c: string) => R(0, 0, 1, 2, a) + R(1, 0, 1, 2, b) + R(2, 0, 1, 2, c);
const FLAGS: Record<string, string> = {
  ES: R(0, 0, 3, 2, "#c60b1e") + R(0, .5, 3, 1, "#ffc400"),
  GB: R(0, 0, 3, 2, "#012169") + `<path d="M0 0L3 2M3 0L0 2" stroke="#fff" stroke-width=".4"/><path d="M0 0L3 2M3 0L0 2" stroke="#c8102e" stroke-width=".18"/><path d="M1.5 0V2M0 1H3" stroke="#fff" stroke-width=".66"/><path d="M1.5 0V2M0 1H3" stroke="#c8102e" stroke-width=".4"/>`,
  FR: V3("#0055a4", "#fff", "#ef4135"),
  DE: H3("#000", "#dd0000", "#ffce00"),
  JP: R(0, 0, 3, 2, "#fff") + `<circle cx="1.5" cy="1" r=".6" fill="#bc002d"/>`,
  RU: H3("#fff", "#0039a6", "#d52b1e"),
  IT: V3("#009246", "#fff", "#ce2b37"),
  UA: R(0, 0, 3, 1, "#0057b7") + R(0, 1, 3, 1, "#ffd700"),
  US: R(0, 0, 3, 2, "#fff") + [0, 2, 4, 6, 8, 10, 12].map((i) => R(0, i * 2 / 13, 3, 2 / 13, "#b22234")).join("") + R(0, 0, 1.2, 1.077, "#3c3b6e"),
  PT: R(0, 0, 3, 2, "#ff0000") + R(0, 0, 1.2, 2, "#006600") + `<circle cx="1.2" cy="1" r=".34" fill="#ffd700"/>`,
  CN: R(0, 0, 3, 2, "#de2910") + `<path d="M.5 .25l.12.37h.39l-.31.23.12.37-.32-.23-.31.23.12-.37-.31-.23h.39z" fill="#ffde00"/>`,
  KR: R(0, 0, 3, 2, "#fff") + `<circle cx="1.5" cy="1" r=".5" fill="#cd2e3a"/><path d="M1 1a.5.5 0 0 0 1 0a.25.25 0 0 0-.5 0a.25.25 0 0 1-.5 0z" fill="#0047a0"/>`,
  PL: R(0, 0, 3, 1, "#fff") + R(0, 1, 3, 1, "#dc143c"), TR: R(0, 0, 3, 2, "#e30a17") + `<circle cx="1.1" cy="1" r=".5" fill="#fff"/><circle cx="1.25" cy="1" r=".4" fill="#e30a17"/>`,
  NL: H3("#ae1c28", "#fff", "#21468b"), SE: R(0, 0, 3, 2, "#006aa7") + R(.9, 0, .4, 2, "#fecc00") + R(0, .8, 3, .4, "#fecc00"),
  CZ: R(0, 0, 3, 1, "#fff") + R(0, 1, 3, 1, "#d7141a") + `<path d="M0 0L1.5 1L0 2z" fill="#11457e"/>`,
  BR: R(0, 0, 3, 2, "#009b3a") + `<path d="M1.5 .2L2.7 1L1.5 1.8L.3 1z" fill="#fedf00"/><circle cx="1.5" cy="1" r=".42" fill="#002776"/>`,
  MX: V3("#006847", "#fff", "#ce1126"), AR: H3("#74acdf", "#fff", "#74acdf") + `<circle cx="1.5" cy="1" r=".2" fill="#f6b40e"/>`,
  CA: R(0, 0, 3, 2, "#fff") + R(0, 0, .75, 2, "#d52b1e") + R(2.25, 0, .75, 2, "#d52b1e") + `<path d="M1.5 .45l.2.4.35-.1-.1.55.25.15-.7.2v.35h-.0v-.35l-.7-.2.25-.15-.1-.55.35.1z" fill="#d52b1e"/>`,
  IN: H3("#ff9933", "#fff", "#138808") + `<circle cx="1.5" cy="1" r=".25" fill="none" stroke="#000080" stroke-width=".06"/>`,
};
const BASE = 0x1f1e6;
/** Экранирует текст и заменяет эмодзи-флаги на картинки (если такой флаг у нас есть). */
export function emo(s: string): string {
  const e = String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return e.replace(/([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/gu, (m, a: string, b: string) => {
    const code = String.fromCharCode(a.codePointAt(0)! - BASE + 65, b.codePointAt(0)! - BASE + 65), svg = FLAGS[code];
    return svg ? `<span class="fl" role="img" aria-label="${code}"><svg viewBox="0 0 3 2" preserveAspectRatio="none">${svg}</svg></span>` : m;
  });
}
