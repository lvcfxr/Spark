import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
const VERSION = JSON.parse(readFileSync("package.json", "utf8")).version;
const cat = JSON.parse(readFileSync("catalog/catalog.json", "utf8"));
const deckJson = (d) => JSON.parse(readFileSync("catalog/" + d.file, "utf8"));
const CATALOG = { catalog: cat, cards: Object.fromEntries(cat.decks.map((d) => [d.id, deckJson(d).cards])),
  media: Object.fromEntries(cat.decks.filter((d) => deckJson(d).media).map((d) => [d.id, deckJson(d).media])) };
const deckFiles = ["catalog.json", ...cat.decks.flatMap((d) => [d.file, ...(d.media ? [d.media] : [])])];
const LOGO = readFileSync("brand/icon.svg", "utf8").replace(/\n\s*/g, "").replace(/<!--.*?-->/g, "").replace('width="512" height="512"', 'width="72" height="72"');
const r = await build({ entryPoints: ["src/main.ts"], bundle: true, minify: true, format: "iife", target: "es2020", write: false, loader: { ".wasm": "binary" }, define: { "process.env.NODE_ENV": "\"production\"", __VERSION__: JSON.stringify(VERSION), __CATALOG__: JSON.stringify(CATALOG), __LOGO__: JSON.stringify(LOGO) } });
const js = r.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const css = readFileSync("src/style.css", "utf8");
const FAVICON = "data:image/svg+xml;base64," + Buffer.from(readFileSync("brand/icon.svg")).toString("base64");
const html = readFileSync("index.template.html", "utf8").replace("FAVICON_DATA_URI", FAVICON).replace("/*CSS*/", () => css).replace("/*JS*/", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/Spark.html", html);
writeFileSync("dist/index.html", html);
copyFileSync("web/config.js", "dist/config.js");
// веб-версия для хостинга (Telegram Mini App): index.html + config.js + иконки
mkdirSync("dist-web", { recursive: true });
writeFileSync("dist-web/index.html", html);
copyFileSync("web/config.js", "dist-web/config.js");
copyFileSync("brand/icon-512.png", "dist-web/icon-512.png");
const NOCACHE = "/*\n  Cache-Control: no-cache\n/icon-512.png\n  Cache-Control: public, max-age=86400\n/decks/*.audio.mp3\n  Cache-Control: public, max-age=604800\n";
writeFileSync("dist-web/_headers", NOCACHE);                       // Netlify / Cloudflare Pages: страница всегда свежая
writeFileSync("dist-web/version.json", JSON.stringify({ version: VERSION, built: new Date().toISOString() }));
// каталог колод рядом с приложением (Mini App берёт обновления каталога отсюда без пересборки)
mkdirSync("dist-web/decks", { recursive: true });
for (const f of deckFiles) copyFileSync("catalog/" + f, "dist-web/decks/" + f);
// список изменений (бот рассылает его при обновлении) и картинки бота
copyFileSync("web/changelog.json", "dist-web/changelog.json");
mkdirSync("dist-web/bot", { recursive: true });
for (const f of readdirSync("web/bot")) copyFileSync("web/bot/" + f, "dist-web/bot/" + f);
// Патч для уже развёрнутого Mini App: всё, кроме config.js (ваши адрес и ключ не затираются)
mkdirSync("dist-web-update", { recursive: true });
for (const f of ["index.html", "icon-512.png", "_headers", "version.json", "changelog.json"]) copyFileSync("dist-web/" + f, "dist-web-update/" + f);
mkdirSync("dist-web-update/bot", { recursive: true });
for (const f of readdirSync("web/bot")) copyFileSync("web/bot/" + f, "dist-web-update/bot/" + f);
mkdirSync("dist-web-update/decks", { recursive: true });
for (const f of deckFiles) copyFileSync("catalog/" + f, "dist-web-update/decks/" + f);
console.log("dist/Spark.html", (html.length / 1024).toFixed(0) + " KB");
