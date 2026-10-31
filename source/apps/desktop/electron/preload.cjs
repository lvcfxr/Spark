"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("recallFS", {
  load: inv("fs:load"),
  save: inv("fs:save"),
  saveSync: (t) => ipcRenderer.sendSync("fs:saveSync", t),
  info: inv("fs:info"),
  openDir: inv("fs:openDir"),
  chooseDir: inv("fs:chooseDir"),
  backupNow: inv("fs:backupNow"),
  readBackup: inv("fs:readBackup"),
  exportDialog: inv("fs:exportDialog"),
  importDialog: inv("fs:importDialog"),
});
