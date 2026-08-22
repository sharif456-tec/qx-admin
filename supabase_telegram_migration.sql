-- Run this once in Supabase SQL Editor.
-- It creates the table used by the Cloudflare Telegram webhook.
create table if not exists public.telegram_chats (
  chat_id text primary key,
  username text,
  first_name text,
  last_name text,
  start_payload text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.telegram_chats enable row level security;

-- No public/browser policies are created intentionally. The Cloudflare webhook
-- uses the server-only SUPABASE_SERVICE_ROLE_KEY to write this table.

-- Optional helper RPC. It links a Telegram chat to a pending license request
-- when the bot is opened using /start <email>.
-- Adjust the table name/column names below if your existing request table differs.
create or replace function public.admin_link_telegram_chat(
  p_email text,
  p_telegram_chat_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.license_requests
     set telegram_chat_id = p_telegram_chat_id
   where lower(email) = lower(p_email)
     and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('linked', n > 0, 'updated', n);
exception when undefined_table or undefined_column then
  return jsonb_build_object('linked', false, 'updated', 0, 'reason', 'Adjust admin_link_telegram_chat for your existing request table/columns');
end;
$$;

-- ADMIN ACCESS --------------------------------------------------------------
-- Admin registration/first-user claiming is intentionally disabled in the
-- dashboard. The existing authorized Admin/Supervisor account must already
-- be present in public.admin_users. This prevents a random first visitor from
-- becoming an administrator.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- Legacy claim_first_admin RPC intentionally removed. Do not expose a
-- browser-side "first admin" registration flow. To authorize an existing
-- Supabase Auth user, insert that user's UUID into public.admin_users using a
-- trusted/admin SQL session, for example:
--   insert into public.admin_users(user_id,email)
--   select id,email from auth.users where email = 'YOUR_ADMIN_EMAIL';
-- Run that only for the intended administrator.

-- Admin-only browser read. This is intentionally limited to the current user.
drop policy if exists "admin self read" on public.admin_users;
create policy "admin self read" on public.admin_users for select to authenticated using (user_id = auth.uid());
