"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { Storage } = require("./storage.cjs");

if (!app.requestSingleInstanceLock()) { app.quit(); }

const cfgPath = () => path.join(app.getPath("userData"), "config.json");
function readCfg() {
  for (const p of [cfgPath(), path.join(app.getPath("appData"), "Recall", "config.json"), path.join(app.getPath("appData"), "recall", "config.json")]) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* следующий */ }
  }
  return {};
}
function writeCfg(c) { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(c)); }

let storage;
function initStorage() {
  const cfg = readCfg();
  const docs = app.getPath("documents");
  // новая папка — Документы/Spark; если есть данные старой версии (Recall), продолжаем работать с ними
  const legacy = path.join(docs, "Recall");
  let dir = cfg.dataDir && fs.existsSync(cfg.dataDir) ? cfg.dataDir
    : fs.existsSync(path.join(legacy, "recall-data.json")) && !fs.existsSync(path.join(docs, "Spark", "recall-data.json")) ? legacy
    : path.join(docs, "Spark");
  try { storage = new Storage(dir); }
  catch { storage = new Storage(path.join(app.getPath("userData"), "data")); }
  try { storage.backup(false); } catch { /* бэкап не критичен */ }
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 560, title: "Spark",
    backgroundColor: "#f4f4f7", show: false, icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) e.preventDefault(); });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initStorage();

  ipcMain.handle("fs:load", () => storage.load());
  ipcMain.handle("fs:save", (_e, text) => storage.save(text));
  ipcMain.on("fs:saveSync", (e, text) => { try { storage.save(text); e.returnValue = true; } catch { e.returnValue = false; } });
  ipcMain.handle("fs:info", () => storage.info());
  ipcMain.handle("fs:openDir", () => shell.openPath(storage.dir));
  ipcMain.handle("fs:backupNow", () => { storage.backup(true); return storage.info(); });
  ipcMain.handle("fs:readBackup", (_e, name) => storage.readBackup(name));
  ipcMain.handle("fs:chooseDir", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Папка для данных Spark", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    storage = Storage.moveTo(storage, r.filePaths[0]);
    writeCfg({ ...readCfg(), dataDir: storage.dir });
    return { info: storage.info(), reload: true };
  });
  ipcMain.handle("fs:exportDialog", async (_e, text, defaultName) => {
    const r = await dialog.showSaveDialog(win, { title: "Сохранить резервную копию", defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "Spark backup", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text);
    return r.filePath;
  });
  ipcMain.handle("fs:importDialog", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Импорт", properties: ["openFile"],
      filters: [{ name: "Колоды: Anki, CSV, текст, копия Spark", extensions: ["apkg", "csv", "tsv", "txt", "json"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), b64: fs.readFileSync(r.filePaths[0]).toString("base64") };
  });

  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
