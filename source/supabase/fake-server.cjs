"use strict";
// Локальная имитация Supabase (GoTrue + PostgREST) для интеграционных тестов клиента. НЕ для продакшена.
const http = require("http");
const crypto = require("crypto");

const BOT_TOKEN = "123456:TEST-TOKEN";
function verifyInitData(initData) {
  const params = new URLSearchParams(initData); const hash = params.get("hash"); if (!hash) return null; params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return crypto.createHmac("sha256", secret).update(check).digest("hex") === hash ? Object.fromEntries(params) : null;
}
function signInitData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAH" + user.id, user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
}
function createServer() {
  const users = new Map(), tokens = new Map(); // email -> {id,pw}; token -> userId
  const tables = { changes: [], reviews: [], shared_decks: [] };
  const storage = new Map();
  const seq = { changes: 0, reviews: 0 };
  const stats = { requests: 0, pushes: 0 };
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer, x-client-info, x-upsert", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", };
  const send = (res, code, body) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  const session = (u) => { const t = crypto.randomUUID(), r = crypto.randomUUID(); tokens.set(t, u.id); tokens.set(r, u.id); return { access_token: t, refresh_token: r, expires_in: 3600, user: { id: u.id, email: u.email } }; };

  const server = http.createServer((req, res) => {
    stats.requests++;
    if (req.method === "OPTIONS") return send(res, 204);
    if (req.headers.apikey !== "test-anon-key") return send(res, 401, { message: "bad apikey" });
    const url = new URL(req.url, "http://x");
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      const isJson = (req.headers["content-type"] ?? "").includes("json");
      const body = isJson && buf.length ? JSON.parse(buf.toString()) : null;
      const uidOf = () => tokens.get((req.headers.authorization ?? "").replace("Bearer ", ""));
      if (url.pathname === "/functions/v1/telegram-auth") {
        const d = body && verifyInitData(body.initData || "");
        if (!d) return send(res, 401, { error: "bad signature" });
        const tg = JSON.parse(d.user), email = `tg${tg.id}@telegram.spark.invalid`;
        let u = users.get(email); if (!u) { u = { id: crypto.randomUUID(), email, pw: "x" }; users.set(email, u); }
        const s = session(u); s.user.telegram = { id: tg.id, username: tg.username ?? "", name: tg.first_name ?? "" };
        return send(res, 200, s);
      }
      const sm = /^\/storage\/v1\/object\/(?:authenticated\/)?media\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (sm) {
        const uid = uidOf(); if (!uid || uid !== sm[1]) return send(res, 403, { message: "forbidden" });
        if (req.method === "POST") { storage.set(sm[1] + "/" + sm[2], { buf, type: req.headers["content-type"] }); return send(res, 200, { Key: sm[2] }); }
        const o = storage.get(sm[1] + "/" + sm[2]); if (!o) return send(res, 404, { message: "not found" });
        res.writeHead(200, { ...cors, "Content-Type": o.type }); return res.end(o.buf);
      }
      if (url.pathname === "/rest/v1/rpc/shared_deck_downloaded") {
        const d = tables.shared_decks.find((x) => x.id === body.deck && x.is_public); if (d) d.downloads++; return send(res, 204);
      }
      if (url.pathname === "/rest/v1/shared_decks") {
        const uid = uidOf(); const rows = tables.shared_decks;
        const eq = (k) => (url.searchParams.get(k) ?? "").replace(/^eq\./, "");
        if (req.method === "GET") {
          let out = rows.filter((r) => r.is_public || r.owner === uid);
          if (url.searchParams.get("is_public")) out = out.filter((r) => r.is_public);
          if (url.searchParams.get("id")) out = out.filter((r) => r.id === eq("id"));
          if (url.searchParams.get("owner")) out = out.filter((r) => r.owner === eq("owner"));
          return send(res, 200, out.sort((a, b) => b.downloads - a.downloads));
        }
        if (!uid) return send(res, 401, { message: "JWT required" });
        if (req.method === "POST") {
          const ex = rows.find((r) => r.owner === uid && r.local_deck_id === body.local_deck_id);
          if (ex) Object.assign(ex, body, { owner: uid }); else rows.push({ id: crypto.randomUUID(), downloads: 0, ...body, owner: uid });
          return send(res, 201);
        }
        if (req.method === "DELETE") { const i = rows.findIndex((r) => r.id === eq("id") && r.owner === uid); if (i >= 0) rows.splice(i, 1); return send(res, 204); }
      }
      if (url.pathname === "/auth/v1/signup") {
        if (users.has(body.email)) return send(res, 422, { msg: "User already registered" });
        const u = { id: crypto.randomUUID(), email: body.email, pw: body.password }; users.set(body.email, u); return send(res, 200, session(u));
      }
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "refresh_token") { const id = tokens.get(body.refresh_token); const u = [...users.values()].find((x) => x.id === id); return u ? send(res, 200, session(u)) : send(res, 400, { error_description: "bad refresh" }); }
        const u = users.get(body.email); return u && u.pw === body.password ? send(res, 200, session(u)) : send(res, 400, { error_description: "Invalid login credentials" });
      }
      const m = /^\/rest\/v1\/(changes|reviews)$/.exec(url.pathname);
      if (!m) return send(res, 404, {});
      const uid = tokens.get((req.headers.authorization ?? "").replace("Bearer ", ""));
      if (!uid) return send(res, 401, { message: "JWT invalid" });
      const t = m[1], rows = tables[t];
      if (req.method === "POST") {
        if (url.searchParams.get("on_conflict") !== "user_id,id" || !/ignore-duplicates/.test(req.headers.prefer ?? "")) return send(res, 400, { message: "expected upsert-ignore" });
        stats.pushes++;
        for (const r of body) if (!rows.some((x) => x.user_id === uid && x.id === r.id)) rows.push({ ...r, user_id: uid, seq: ++seq[t] });
        return send(res, 201);
      }
      const gt = Number((/^gt\.(\d+)$/.exec(url.searchParams.get("seq") ?? "") ?? [0, 0])[1]), limit = Number(url.searchParams.get("limit") ?? 1000);
      return send(res, 200, rows.filter((x) => x.user_id === uid && x.seq > gt).sort((a, b) => a.seq - b.seq).slice(0, limit));
    });
  });
  return { server, tables, storage, stats, listen: (port) => new Promise((r) => server.listen(port, r)), close: () => new Promise((r) => server.close(r)) };
}
module.exports = { createServer, signInitData, BOT_TOKEN };
