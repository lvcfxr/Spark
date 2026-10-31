// Собирает все ключи t("…") и data-i18n из исходников. С флагом --check сверяет со словарём EN.
const fs = require("fs"), path = require("path");
const files = fs.readdirSync("src").filter((f) => f.endsWith(".ts")).map((f) => path.join("src", f));
const keys = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
}
const html = fs.readFileSync("index.template.html", "utf8");
for (const m of html.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) keys.add(m[1]);
if (process.argv.includes("--check")) {
  const src = fs.readFileSync("src/en.ts", "utf8");
  const EN = new Function(src.replace(/^export const EN[^=]*=/m, "return ").replace(/;\s*$/, ""))();
  const missing = [...keys].filter((k) => !(k in EN));
  const unused = Object.keys(EN).filter((k) => !keys.has(k));
  console.log(`keys: ${keys.size}, missing: ${missing.length}, unused: ${unused.length}`);
  if (missing.length) { console.log(JSON.stringify(missing, null, 1)); process.exit(1); }
} else console.log(JSON.stringify([...keys], null, 0));
