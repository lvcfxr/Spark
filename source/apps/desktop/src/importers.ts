import { t } from "./i18n";
import { unzipSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
import * as sqlMod from "sql.js/dist/sql-wasm-browser.js";
import wasmBytes from "sql.js/dist/sql-wasm-browser.wasm";

export interface ImportedCard { front: string; back: string; tags: string }
export interface ImportedDeck { name: string; cards: ImportedCard[] }
export interface ImportResult { decks: ImportedDeck[]; skippedMedia: number; source: "apkg" | "table"; media: Map<string, Uint8Array> }

// ---------- общее ----------
const NEST = " › ";

const decodeEnt = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export function htmlToText(h: string): string {
  return h
    // медиа превращаем в метки — их заменят на сохранённые файлы при импорте
    .replace(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (_m, a?: string, b?: string, c?: string) => `\n![](file:${decodeEnt(a ?? b ?? c ?? "").replace(/\)/g, "%29")})\n`)
    .replace(/\[sound:([^\]]+)\]/g, (_m, f: string) => ` [audio](file:${f.replace(/\)/g, "%29")}) `)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<hr[^>]*>/gi, "\n")
    .replace(/<\/?(b|strong)>/gi, "**")
    .replace(/\[sound:[^\]]*\]/g, "").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Одна строка «слово — перевод» (также tab, «;», «,»). */
export function parseLines(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = ["\t", " — ", " – ", " - ", ";", ","].find((s) => line.includes(s));
    if (!sep) { out.push([line, ""]); continue; }
    const i = line.indexOf(sep);
    out.push([line.slice(0, i).trim().replace(/^"|"$/g, ""), line.slice(i + sep.length).trim().replace(/^"|"$/g, "")]);
  }
  return out;
}

// ---------- CSV / TSV / TXT ----------
function csvRows(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const HEAD_F = new Set(["front", "question", "term", "word", "вопрос", "слово", "термин", "лицевая сторона", "лицевая"]);
const HEAD_B = new Set(["back", "answer", "definition", "translation", "ответ", "перевод", "определение", "обратная сторона", "обратная"]);

export function parseTable(textIn: string, filename: string): ImportResult {
  let text = textIn.replace(/^﻿/, "");
  let delim: string | null = null;
  // служебные строки экспорта Anki: "#separator:tab", "#html:true", ...
  const lines = text.split(/\r?\n/);
  let skip = 0;
  while (skip < lines.length && lines[skip]!.startsWith("#")) {
    const m = /^#separator:(.+)$/.exec(lines[skip]!.trim());
    if (m) delim = ({ tab: "\t", comma: ",", semicolon: ";", space: " ", pipe: "|" } as Record<string, string>)[m[1]!.toLowerCase()] ?? m[1]!;
    skip++;
  }
  if (skip) text = lines.slice(skip).join("\n");
  if (!delim) {
    const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
    const best = ["\t", ";", ","].map((c) => ({ c, n: sample.filter((l) => l.includes(c)).length })).sort((a, b) => b.n - a.n)[0]!;
    if (sample.length && best.n >= Math.ceil(sample.length * 0.6)) delim = best.c;
  }
  let pairs: [string, string, string][];
  if (delim) {
    let rows = csvRows(text, delim);
    if (rows.length > 1 && HEAD_F.has(rows[0]![0]!.trim().toLowerCase()) && HEAD_B.has((rows[0]![1] ?? "").trim().toLowerCase())) rows = rows.slice(1);
    pairs = rows.map((r) => [r[0] ?? "", r[1] ?? "", r.length > 2 ? r.slice(2).join(" ").trim() : ""]);
  } else pairs = parseLines(text).map(([a, b]) => [a, b, ""]);
  const cards = pairs
    .map(([f, b, t]) => ({ front: /<[a-z!/]/i.test(f) ? htmlToText(f) : f.trim(), back: /<[a-z!/]/i.test(b) ? htmlToText(b) : b.trim(), tags: t }))
    .filter((c) => c.front || c.back);
  return { decks: [{ name: filename.replace(/\.[^.]+$/, "") || t("Импорт"), cards }], skippedMedia: 0, source: "table", media: new Map() };
}

// ---------- Anki .apkg ----------
interface SqlDb { prepare(sql: string): { step(): boolean; getAsObject(): Record<string, unknown>; free(): void }; close(): void }
type Row = Record<string, unknown>;
let sqlPromise: Promise<{ Database: new (data: Uint8Array) => SqlDb }> | null = null;
function getSql() {
  if (!sqlPromise) {
    const init = ((sqlMod as unknown as { default?: unknown }).default ?? sqlMod) as (c: { wasmBinary: ArrayBuffer }) => Promise<{ Database: new (d: Uint8Array) => SqlDb }>;
    const buf = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer;
    sqlPromise = init({ wasmBinary: buf });
  }
  return sqlPromise;
}
function rows(db: SqlDb, sql: string): Row[] {
  const st = db.prepare(sql), out: Row[] = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}
const hasTable = (db: SqlDb, t: string) => rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`).length > 0;
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

/** Минимальный разбор protobuf: поле → список значений (число или байты). */
function pb(buf: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const out = new Map<number, (number | Uint8Array)[]>();
  let i = 0;
  const varint = () => { let v = 0, m = 1, b: number; do { b = buf[i++]!; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
  while (i < buf.length) {
    const key = varint(), f = Math.floor(key / 8), wt = key & 7;
    let val: number | Uint8Array;
    if (wt === 0) val = varint();
    else if (wt === 2) { const n = varint(); val = buf.subarray(i, i + n); i += n; }
    else if (wt === 1) { i += 8; continue; }
    else if (wt === 5) { i += 4; continue; }
    else break;
    const a = out.get(f) ?? []; a.push(val); out.set(f, a);
  }
  return out;
}

interface Model { cloze: boolean; fields: string[]; tmpls: { q: string; a: string }[] }

function loadModels(db: SqlDb): { models: Map<number, Model>; decks: Map<number, string> } {
  const models = new Map<number, Model>(), decks = new Map<number, string>();
  if (hasTable(db, "notetypes")) { // схема Anki 2.1.50+
    for (const nt of rows(db, "SELECT id, config FROM notetypes")) {
      const cfg = nt.config instanceof Uint8Array ? pb(nt.config) : new Map();
      models.set(Number(nt.id), { cloze: (cfg.get(1)?.[0] ?? 0) === 1, fields: [], tmpls: [] });
    }
    for (const f of rows(db, "SELECT ntid, ord, name FROM fields ORDER BY ntid, ord")) models.get(Number(f.ntid))?.fields.push(String(f.name));
    for (const t of rows(db, "SELECT ntid, ord, config FROM templates ORDER BY ntid, ord")) {
      const c = t.config instanceof Uint8Array ? pb(t.config) : new Map();
      const q = c.get(1)?.[0], a = c.get(2)?.[0];
      models.get(Number(t.ntid))?.tmpls.push({ q: q instanceof Uint8Array ? utf8(q) : "", a: a instanceof Uint8Array ? utf8(a) : "" });
    }
    for (const d of rows(db, "SELECT id, name FROM decks")) decks.set(Number(d.id), String(d.name).split("\x1f").join(NEST));
  } else { // старая схема: JSON в таблице col
    const col = rows(db, "SELECT models, decks FROM col")[0];
    const ms = JSON.parse(String(col?.models ?? "{}")) as Record<string, { type?: number; flds: { name: string; ord: number }[]; tmpls: { qfmt: string; afmt: string; ord: number }[] }>;
    for (const [id, m] of Object.entries(ms)) {
      models.set(Number(id), {
        cloze: m.type === 1,
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        tmpls: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ q: t.qfmt, a: t.afmt })),
      });
    }
    const ds = JSON.parse(String(col?.decks ?? "{}")) as Record<string, { name: string }>;
    for (const [id, d] of Object.entries(ds)) decks.set(Number(id), d.name.split("::").join(NEST));
  }
  return { models, decks };
}

function renderTpl(tpl: string, fields: Record<string, string>, frontSide: string, answer: boolean): string {
  let out = tpl;
  const sec = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
  for (let i = 0; i < 6; i++) {
    const next = out.replace(sec, (_m, k: string, name: string, body: string) => ((fields[name] ?? "").trim() !== "") === (k === "#") ? body : "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    const parts = expr.split(":"), name = parts[parts.length - 1]!.trim();
    if (name === "FrontSide") return frontSide;
    if (parts[0] === "type") return answer ? fields[name] ?? "" : "";
    if (parts[0] === "hint") return "";
    return fields[name] ?? "";
  });
}

function clozeRender(text: string, k: number): { q: string; a: string; has: boolean } {
  let has = false;
  const re = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
  const q = text.replace(re, (_m, n: string, ans: string, hint?: string) => { if (+n === k) { has = true; return `[${hint || "…"}]`; } return ans; });
  const a = text.replace(re, (_m, n: string, ans: string) => (+n === k ? `**${ans}**` : ans));
  return { q, a, has };
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const maybeZstd = (b: Uint8Array) => (ZSTD_MAGIC.every((x, i) => b[i] === x) ? zstdDecompress(b) : b);

/** Медиафайлы из .apkg: старый формат — JSON {"0":"имя"}; новый — protobuf (часто сжат zstd), файлы сжаты zstd. */
function extractMedia(data: Uint8Array, wanted: Set<string>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (!wanted.size) return out;
  let mf: Uint8Array | undefined;
  try { mf = unzipSync(data, { filter: (f) => f.name === "media" }).media; } catch { return out; }
  if (!mf || !mf.length) return out;
  const nameByZip = new Map<string, string>();
  const raw = maybeZstd(mf);
  try {
    const j = JSON.parse(utf8(raw)) as Record<string, string>;
    for (const [k, v] of Object.entries(j)) nameByZip.set(k, v);
  } catch {
    (pb(raw).get(1) ?? []).forEach((e, i) => {
      if (!(e instanceof Uint8Array)) return;
      const m = pb(e), n = m.get(1)?.[0], legacy = m.get(255)?.[0];
      if (n instanceof Uint8Array) nameByZip.set(typeof legacy === "number" ? String(legacy) : String(i), utf8(n));
    });
  }
  const zipNames = new Set([...nameByZip].filter(([, n]) => wanted.has(n) || wanted.has(safeDecode(n))).map(([z]) => z));
  if (!zipNames.size) return out;
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(data, { filter: (f) => zipNames.has(f.name) }); } catch { return out; }
  for (const [z, bytes] of Object.entries(files)) {
    const name = nameByZip.get(z)!;
    try { out.set(name, maybeZstd(bytes)); } catch { /* битый файл — пропускаем */ }
  }
  // имена в HTML могут быть URL-кодированы
  for (const w of wanted) if (!out.has(w)) { const alt = [...out.keys()].find((n) => safeDecode(w) === n || safeDecode(n) === w); if (alt) out.set(w, out.get(alt)!); }
  return out;
}
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export async function parseApkg(data: Uint8Array): Promise<ImportResult> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(data, { filter: (f) => /^collection\.anki2(1|1b)?$/.test(f.name) }); }
  catch { throw new Error(t("Файл не похож на .apkg (не открывается как архив)")); }
  const pick = files["collection.anki21b"] ?? files["collection.anki21"] ?? files["collection.anki2"];
  if (!pick) throw new Error(t("В архиве нет коллекции Anki (collection.anki2*)"));
  const dbBytes = files["collection.anki21b"] ? zstdDecompress(pick) : pick;

  const SQL = await getSql();
  let db: SqlDb;
  try { db = new SQL.Database(dbBytes); rows(db, "SELECT count(*) AS n FROM notes"); }
  catch { throw new Error(t("Не удалось прочитать базу Anki. Экспортируйте колоду с галочкой «Поддержка старых версий Anki» и повторите.")); }

  try {
    if (!hasTable(db, "notetypes")) {
      const first = rows(db, "SELECT models FROM col")[0];
      if (files["collection.anki2"] && !files["collection.anki21"] && !files["collection.anki21b"] && /please update/i.test(String(first?.models ?? ""))) throw new Error("update");
    }
    const { models, decks } = loadModels(db);
    const notes = new Map<number, { mid: number; tags: string; flds: string[] }>();
    for (const n of rows(db, "SELECT id, mid, tags, flds FROM notes")) notes.set(Number(n.id), { mid: Number(n.mid), tags: String(n.tags ?? "").trim(), flds: String(n.flds).split("\x1f") });

    const byDeck = new Map<number, ImportedCard[]>();
    let skippedMedia = 0;
    for (const c of rows(db, "SELECT nid, did, ord, odid FROM cards ORDER BY id")) {
      const note = notes.get(Number(c.nid));
      const model = note && models.get(note.mid);
      if (!note || !model) continue;
      const fields: Record<string, string> = {};
      model.fields.forEach((n, i) => { fields[n] = note.flds[i] ?? ""; });
      const ord = Number(c.ord);
      let qh: string, ah: string;
      if (model.cloze) {
        const text = note.flds[0] ?? "";
        const r = clozeRender(text, ord + 1);
        if (!r.has) continue;
        const extra = fields["Back Extra"] ?? fields["Extra"] ?? note.flds[1] ?? "";
        qh = r.q; ah = r.a + (extra.trim() ? "<br><br>" + extra : "");
      } else {
        const t = model.tmpls[ord] ?? model.tmpls[0];
        if (!t) { qh = note.flds[0] ?? ""; ah = note.flds[1] ?? ""; }
        else {
          qh = renderTpl(t.q, fields, "", false);
          const full = renderTpl(t.a, fields, "", true);
          const cut = full.split(/<hr[^>]*id=["']?answer["']?[^>]*>/i);
          ah = cut.length > 1 ? cut.slice(1).join("") : full;
        }
      }
      const card: ImportedCard = { front: htmlToText(qh), back: htmlToText(ah), tags: note.tags };
      if (!card.front && !card.back) continue;
      const did = Number(c.odid) > 0 ? Number(c.odid) : Number(c.did);
      const list = byDeck.get(did) ?? [];
      list.push(card); byDeck.set(did, list);
    }
    const result: ImportedDeck[] = [...byDeck].map(([did, cards]) => ({ name: decks.get(did) ?? t("Импорт"), cards }));
    // какие файлы реально упомянуты в карточках
    const wanted = new Set<string>();
    for (const d of result) for (const c of d.cards) for (const m of `${c.front}\n${c.back}`.matchAll(/\((?:file):([^)]+)\)/g)) wanted.add(m[1]!.replace(/%29/g, ")"));
    const media = extractMedia(data, wanted);
    for (const w of wanted) if (!media.has(w)) skippedMedia++;
    return { decks: result, skippedMedia, source: "apkg", media };
  } catch (e) {
    if ((e as Error).message === "update") throw new Error(t("Файл сохранён в новом формате Anki. Экспортируйте колоду заново с галочкой «Поддержка старых версий Anki»."));
    throw e;
  } finally { db.close(); }
}
