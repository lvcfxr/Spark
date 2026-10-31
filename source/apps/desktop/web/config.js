// Настройки Spark для хостинга. Заполняет владелец приложения один раз (см. SETUP.md).
// Публичный ключ (anon / publishable) можно показывать: данные защищены правилами доступа (RLS).
// НИКОГДА не вставляйте сюда service_role-ключ.
window.SPARK_CONFIG = {
  supabaseUrl: "",   // например "https://abcdxyz.supabase.co"
  supabaseKey: "",   // ключ "anon" или "publishable"
  botUsername: "Sparkling_app",   // имя бота без @ — для ссылки t.me/<бот>?startapp в настройках
};
