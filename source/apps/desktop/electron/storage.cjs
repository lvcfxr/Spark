"use strict";
// Файловое хранилище без зависимости от Electron — чтобы тестировать обычным node.
const fs = require("fs");
const path = require("path");

const FILE = "recall-data.json";
const KEEP_BACKUPS = 40;
const PREV_EVERY_MS = 60_000;

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function readValid(file) {
  const text = fs.readFileSync(file, "utf8");
  JSON.parse(text); // бросит, если файл повреждён
  return text;
}

class Storage {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
  }
  get file() { return path.join(this.dir, FILE); }
  get backupsDir() { return path.join(this.dir, "backups"); }

  /** Данные или null (первый запуск). Если основной файл битый — берём .prev, битый сохраняем рядом. */
  load() {
    if (!fs.existsSync(this.file)) {
      return fs.existsSync(this.file + ".prev") ? readValid(this.file + ".prev") : null;
    }
    try { return readValid(this.file); } catch {
      fs.copyFileSync(this.file, this.file + `.corrupt-${Date.now()}`);
      if (fs.existsSync(this.file + ".prev")) return readValid(this.file + ".prev");
      throw new Error("Файл данных повреждён, резервной копии нет. Загрузите копию из папки backups.");
    }
  }

  /** Атомарная запись: во временный файл, затем rename. Раз в минуту обновляет .prev. */
  save(text) {
    JSON.parse(text);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, text);
    if (fs.existsSync(this.file)) {
      const prev = this.file + ".prev";
      if (!fs.existsSync(prev) || Date.now() - fs.statSync(prev).mtimeMs > PREV_EVERY_MS) fs.copyFileSync(this.file, prev);
    }
    fs.renameSync(tmp, this.file);
  }

  /** Копия в backups/. Авто — не чаще раза в день. */
  backup(manual) {
    if (!fs.existsSync(this.file)) return null;
    const d = new Date();
    const name = manual
      ? `recall-${stamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-manual.json`
      : `recall-${stamp(d)}.json`;
    const dest = path.join(this.backupsDir, name);
    if (!manual && fs.existsSync(dest)) return null;
    fs.copyFileSync(this.file, dest);
    this.prune();
    return name;
  }

  list() {
    return fs.readdirSync(this.backupsDir).filter((n) => n.endsWith(".json")).map((n) => {
      const st = fs.statSync(path.join(this.backupsDir, n));
      return { name: n, size: st.size, mtime: st.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
  }

  prune() {
    for (const b of this.list().slice(KEEP_BACKUPS)) fs.unlinkSync(path.join(this.backupsDir, b.name));
  }

  readBackup(name) { return readValid(path.join(this.backupsDir, path.basename(name))); }

  info() { return { dir: this.dir, file: this.file, backups: this.list().slice(0, 20), size: fs.existsSync(this.file) ? fs.statSync(this.file).size : 0 }; }

  /** Перенос в другую папку: если там уже есть данные — переключаемся на них, иначе копируем текущие. */
  static moveTo(current, newDir) {
    const next = new Storage(newDir);
    if (!fs.existsSync(next.file) && fs.existsSync(current.file)) fs.copyFileSync(current.file, next.file);
    return next;
  }
}

module.exports = { Storage, FILE };
