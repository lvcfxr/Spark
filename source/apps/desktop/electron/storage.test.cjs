"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Storage } = require("./storage.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recall-"));
const s = new Storage(path.join(tmp, "a"));

assert.strictEqual(s.load(), null, "первый запуск — данных нет");
s.save('{"v":1}');
assert.strictEqual(s.load(), '{"v":1}');
s.save('{"v":2}');
assert.strictEqual(s.load(), '{"v":2}');

// повреждённый основной файл → восстановление из .prev
fs.writeFileSync(s.file, "{broken");
assert.strictEqual(s.load(), '{"v":1}', "берём .prev");
assert.ok(fs.readdirSync(s.dir).some((n) => n.includes(".corrupt-")), "битый файл сохранён рядом");

// невалидный JSON не должен затереть данные
assert.throws(() => s.save("not json"));

// бэкапы: авто раз в день, ручные всегда
s.save('{"v":3}');
assert.ok(s.backup(false));
assert.strictEqual(s.backup(false), null, "второй авто-бэкап за день не создаётся");
assert.ok(s.backup(true));
assert.strictEqual(s.list().length, 2);
assert.strictEqual(JSON.parse(s.readBackup(s.list()[0].name)).v, 3);
assert.throws(() => s.readBackup("../../etc/passwd"));

// смена папки: копирует данные; если в цели уже есть данные — не затирает
const s2 = Storage.moveTo(s, path.join(tmp, "b"));
assert.strictEqual(s2.load(), '{"v":3}');
s2.save('{"v":9}');
const s3 = Storage.moveTo(s, path.join(tmp, "b"));
assert.strictEqual(s3.load(), '{"v":9}', "существующие данные в целевой папке сохранены");

// обрезка бэкапов
for (let i = 0; i < 45; i++) fs.writeFileSync(path.join(s.backupsDir, `x${i}.json`), "{}");
s.prune();
assert.strictEqual(s.list().length, 40);

fs.rmSync(tmp, { recursive: true });
console.log("storage: ok");
