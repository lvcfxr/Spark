-- Recall: схема синхронизации для Supabase. Выполните целиком в SQL Editor (один раз).
-- Сервер — журнал изменений. Конфликты решает приложение, поэтому записи только добавляются.

create table if not exists public.changes (
  seq        bigint generated always as identity primary key,   -- порядок прихода; по нему клиенты забирают новое
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,                                      -- id изменения (создаёт клиент)
  entity     text not null,                                      -- deck | card | setting | ...
  entity_id  text not null,
  field      text not null,
  value      jsonb,
  hlc        text not null,                                      -- гибридные логические часы: порядок правок
  device_id  text not null,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists changes_user_seq on public.changes (user_id, seq);

create table if not exists public.reviews (
  seq         bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id          text not null,
  card_id     text not null,
  rating      smallint not null check (rating between 1 and 4),
  ts          bigint not null,                                   -- время ответа, мс
  duration_ms integer not null default 0,
  device_id   text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists reviews_user_seq on public.reviews (user_id, seq);

-- Row Level Security: каждый видит и добавляет только свои строки. Менять и удалять записи журнала нельзя.
alter table public.changes enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "own changes: read"   on public.changes;
drop policy if exists "own changes: insert" on public.changes;
drop policy if exists "own reviews: read"   on public.reviews;
drop policy if exists "own reviews: insert" on public.reviews;

create policy "own changes: read"   on public.changes for select to authenticated using (user_id = auth.uid());
create policy "own changes: insert" on public.changes for insert to authenticated with check (user_id = auth.uid());
create policy "own reviews: read"   on public.reviews for select to authenticated using (user_id = auth.uid());
create policy "own reviews: insert" on public.reviews for insert to authenticated with check (user_id = auth.uid());

revoke all on public.changes, public.reviews from anon;
grant select, insert on public.changes, public.reviews to authenticated;

-- =====================================================================
-- Каталог колод пользователей (публикация и скачивание)
-- =====================================================================
create table if not exists public.shared_decks (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_deck_id text not null,
  title         text not null check (char_length(title) between 1 and 80),
  description   text not null default '' check (char_length(description) <= 1000),
  emoji         text not null default '📘' check (char_length(emoji) <= 16),
  lang_front    text not null default '' check (char_length(lang_front) <= 8),
  lang_back     text not null default '' check (char_length(lang_back) <= 8),
  tags          text[] not null default '{}',
  author_name   text not null default '' check (char_length(author_name) <= 40),
  cards         jsonb not null check (pg_column_size(cards) < 3000000),
  card_count    integer not null check (card_count between 1 and 5000),
  downloads     integer not null default 0,
  is_public     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner, local_deck_id)
);
create index if not exists shared_decks_public on public.shared_decks (is_public, downloads desc);
alter table public.shared_decks enable row level security;
drop policy if exists "shared decks: read public or own" on public.shared_decks;
drop policy if exists "shared decks: insert own"         on public.shared_decks;
drop policy if exists "shared decks: update own"         on public.shared_decks;
drop policy if exists "shared decks: delete own"         on public.shared_decks;
create policy "shared decks: read public or own" on public.shared_decks for select to anon, authenticated using (is_public or owner = auth.uid());
create policy "shared decks: insert own"         on public.shared_decks for insert to authenticated with check (owner = auth.uid());
create policy "shared decks: update own"         on public.shared_decks for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "shared decks: delete own"         on public.shared_decks for delete to authenticated using (owner = auth.uid());
revoke all on public.shared_decks from anon, authenticated;
grant select on public.shared_decks to anon, authenticated;
grant delete on public.shared_decks to authenticated;
-- счётчик скачиваний менять напрямую нельзя — только через функцию ниже
grant insert (local_deck_id, title, description, emoji, lang_front, lang_back, tags, author_name, cards, card_count, is_public, updated_at) on public.shared_decks to authenticated;
grant update (title, description, emoji, lang_front, lang_back, tags, author_name, cards, card_count, is_public, updated_at) on public.shared_decks to authenticated;

create or replace function public.shared_deck_downloaded(deck uuid) returns void
language sql security definer set search_path = public as $$
  update public.shared_decks set downloads = downloads + 1 where id = deck and is_public;
$$;
revoke all on function public.shared_deck_downloaded(uuid) from public;
grant execute on function public.shared_deck_downloaded(uuid) to anon, authenticated;

-- =====================================================================
-- Медиа карточек (картинки, звук): приватное хранилище, у каждого своя папка <user_id>/
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 26214400)   -- до 25 МБ (короткие видео)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
drop policy if exists "media: read own"   on storage.objects;
drop policy if exists "media: insert own" on storage.objects;
drop policy if exists "media: update own" on storage.objects;
create policy "media: read own"   on storage.objects for select to authenticated using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media: insert own" on storage.objects for insert to authenticated with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media: update own" on storage.objects for update to authenticated using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- бот Spark: кто запускал бота и хочет получать новости об обновлениях ----------
create table if not exists public.bot_chats (
  chat_id bigint primary key,
  first_name text default '',
  lang text default 'ru',
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table if not exists public.bot_state (key text primary key, value text);
-- доступ только у функции telegram-bot (ключ service_role); приложению и посторонним — ничего
alter table public.bot_chats enable row level security;
alter table public.bot_state enable row level security;

-- уровень колоды (A1–C2, N5–N1) для поиска и фильтров в сообществе
alter table public.shared_decks add column if not exists level text not null default '';

-- итоги для напоминаний бота (через неделю и через месяц без занятий): только числа, без карточек
create table if not exists public.bot_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tg_id bigint,
  words int not null default 0,
  due int not null default 0,
  level int not null default 1,
  xp_left int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  last_study timestamptz,
  remind boolean not null default true,
  stage int not null default 0,          -- 0 — ничего не слали, 1 — недельное, 2 — месячное
  updated_at timestamptz not null default now()
);
alter table public.bot_progress enable row level security;
drop policy if exists bot_progress_own on public.bot_progress;
create policy bot_progress_own on public.bot_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- номер в Telegram берём из аккаунта, а не из запроса: нельзя подставить чужой; новое занятие сбрасывает счётчик напоминаний
create or replace function public.bot_progress_guard() returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  new.user_id := auth.uid();
  new.tg_id := (select (raw_user_meta_data->>'telegram_id')::bigint from auth.users where id = auth.uid());
  new.updated_at := now();
  if tg_op = 'INSERT' then new.stage := 0;
  else
    new.stage := old.stage;
    if new.last_study is not null and (old.last_study is null or new.last_study > old.last_study) then new.stage := 0; end if;
  end if;
  return new;
end $$;
drop trigger if exists bot_progress_guard on public.bot_progress;
create trigger bot_progress_guard before insert or update on public.bot_progress for each row execute function public.bot_progress_guard();
