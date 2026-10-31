// Supabase Edge Function «telegram-auth»: вход в Spark через Telegram без пароля.
// 1) Проверяет подпись initData от Telegram (HMAC с токеном бота) — подделать нельзя.
// 2) Находит или создаёт пользователя Supabase для этого Telegram-аккаунта.
// 3) Возвращает сессию (access/refresh token) — дальше приложение синхронизируется само.
// Секрет: TELEGRAM_BOT_TOKEN (Edge Functions → Secrets). SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY Supabase передаёт сам.
// При создании функции выключите «Verify JWT» — функция проверяет подпись Telegram сама.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Проверка по документации Telegram: secret = HMAC("WebAppData", bot_token); hash = HMAC(secret, data_check_string). */
async function verifyInitData(initData: string, botToken: string, maxAgeSec = 86400): Promise<Record<string, string> | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, check));
  if (calc !== hash) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  return Object.fromEntries(params.entries());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return json(500, { error: "TELEGRAM_BOT_TOKEN не задан в секретах функции" });

  const { initData } = await req.json().catch(() => ({ initData: "" }));
  const data = initData ? await verifyInitData(String(initData), botToken) : null;
  if (!data?.user) return json(401, { error: "Подпись Telegram не прошла проверку" });
  const tg = JSON.parse(data.user) as { id: number; username?: string; first_name?: string; language_code?: string };

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const pub = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });

  // Технический email и пароль, которые знает только эта функция (пароль выводится из токена бота).
  const email = `tg${tg.id}@telegram.spark.invalid`;
  const password = hex(await hmac(enc.encode(botToken), `spark-user:${tg.id}`));

  let res = await pub.auth.signInWithPassword({ email, password });
  if (res.error) {
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { telegram_id: tg.id, username: tg.username ?? "", name: tg.first_name ?? "", language: tg.language_code ?? "" },
    });
    if (created.error && !/already/i.test(created.error.message)) return json(500, { error: created.error.message });
    res = await pub.auth.signInWithPassword({ email, password });
    if (res.error) return json(500, { error: res.error.message });
  }
  const s = res.data.session!;
  return json(200, {
    access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
    user: { id: s.user.id, email, telegram: { id: tg.id, username: tg.username ?? "", name: tg.first_name ?? "" } },
  });
});
