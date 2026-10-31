# Spark

Карточки с интервальными повторениями для Telegram (Mini App). Работает и в обычном браузере.

- Ядро (`packages/core`): FSRS-5, умная оценка по времени раздумья, синхронизация (журнал изменений, LWW по полям, append-only повторения). `npm test`.
- Приложение (`apps/desktop`): интерфейс (`src/`), каталог колод (`catalog/`), иконки (`brand/`). Сборка: `npm install && npm run build` → `dist-web/` (то, что лежит в корне сайта).
- Сервер (`supabase/`): `schema.sql`, функция `functions/telegram-auth`, имитатор для тестов `fake-server.cjs`.
- Настройка: `SETUP.md`. Языки: русский и английский (`apps/desktop/src/en.ts`; проверка полноты — `node scripts/i18n-keys.cjs --check`).
- Electron-версия для ПК (`apps/desktop/electron`) сохранена, но не развивается: основной продукт — Telegram.
