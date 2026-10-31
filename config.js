// Настройки сервера синхронизации (Supabase). Заполните и загрузите рядом с index.html.
// Anon-ключ публичный по замыслу Supabase: доступ к данным защищён правилами RLS (см. supabase/schema.sql).
// НИКОГДА не вставляйте сюда service_role-ключ.
window.RECALL_CONFIG = {
  supabaseUrl: "",   // например "https://abcdxyz.supabase.co"
  supabaseKey: "",   // ключ "anon" / "publishable"
};
