// Spark service worker 0.43.1
const V = "spark-0.43.1", SHELL = ["./", "index.html", "config.js", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => /^spark-\d/.test(k) && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const netFirst = async (req, fallbackKey, ms) => {
  const c = await caches.open(V);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, j) => setTimeout(() => j(new Error("slow")), ms))]);
    if (r && r.ok) c.put(fallbackKey || req, r.clone());
    return r;
  } catch { const hit = await c.match(fallbackKey || req, { ignoreSearch: true }); if (hit) return hit; throw new Error("offline"); }
};
const swr = async (req) => {
  const c = await caches.open(V), hit = (await c.match(req)) || (await caches.match(req, { ignoreSearch: true }));
  const net = fetch(req).then((r) => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
};
// web-push: напоминание занятий; нажатие открывает Spark (или переключает на открытую вкладку)
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Sumi", { body: d.body || "", icon: "icon-512.png", badge: "icon-512.png", tag: d.tag || "spark", renotify: false, data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => { for (const w of ws) if (w.url.startsWith(self.registration.scope) && "focus" in w) return w.focus(); return self.clients.openWindow(url); }));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  if (req.mode === "navigate") { e.respondWith(netFirst(req, "index.html", 4000)); return; }
  if (/\/(version|changelog)\.json$/.test(u.pathname)) { e.respondWith(netFirst(req, null, 4000)); return; }
  e.respondWith(swr(req));
});
