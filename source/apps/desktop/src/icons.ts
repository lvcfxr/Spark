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
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
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
