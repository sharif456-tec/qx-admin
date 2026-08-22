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

-- FIRST ADMIN SETUP ---------------------------------------------------------
-- The first authenticated account claimed through claim_first_admin becomes
-- the only admin. Later accounts cannot claim admin through this RPC.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create or replace function public.claim_first_admin(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;
  select count(*) into n from public.admin_users;
  if n > 0 then
    raise exception 'An admin already exists';
  end if;
  insert into public.admin_users(user_id,email) values(p_user_id,p_email);
  return jsonb_build_object('ok',true,'user_id',p_user_id);
end;
$$;

revoke all on function public.claim_first_admin(uuid,text) from public;
grant execute on function public.claim_first_admin(uuid,text) to authenticated;

-- Admin-only browser read. This is intentionally limited to the current user.
drop policy if exists "admin self read" on public.admin_users;
create policy "admin self read" on public.admin_users for select to authenticated using (user_id = auth.uid());
