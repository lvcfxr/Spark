"use strict";
// Вшивает иконку в Recall.exe без Wine (ResEdit — чистый JS). Запуск: node scripts/set-exe-icon.cjs release/win-unpacked/Recall.exe brand/icon.ico
const fs = require("fs");
const ResEdit = require("resedit");
const [exePath, icoPath] = process.argv.slice(2);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
const res = ResEdit.NtExecutableResource.from(exe);
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const g = groups[0];
const icons = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath)).icons.map((i) => i.data);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g ? g.id : 1, g ? g.lang : 1033, icons);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
const after = ResEdit.Resource.IconGroupEntry.fromEntries(ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(exePath))).entries);
console.log("icon groups:", after.length, "icons in first group:", after[0] && after[0].icons ? after[0].icons.length : "?");
