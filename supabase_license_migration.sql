-- QX License System - idempotent Supabase migration
-- Run once in Supabase SQL Editor.
-- IMPORTANT: do not put service-role keys in the extension or dashboard HTML.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_chats (
  chat_id text primary key,
  username text,
  first_name text,
  last_name text,
  start_payload text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text not null unique,
  customer_name text not null,
  customer_email text not null,
  plan text not null default '1-year',
  status text not null default 'active' check (status in ('active','suspended','revoked','expired')),
  expires_at timestamptz not null,
  max_devices integer not null default 5 check (max_devices > 0 and max_devices <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_telegram_sent_at timestamptz
);

create table if not exists public.license_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  telegram text,
  telegram_chat_id text,
  device_id text not null,
  device_name text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  license_id uuid references public.licenses(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  device_id text not null,
  device_name text,
  status text not null default 'active' check (status in ('active','revoked')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (license_id, device_id)
);

create index if not exists license_requests_status_idx on public.license_requests(status, created_at desc);
create index if not exists license_requests_email_idx on public.license_requests(lower(email));
create index if not exists licenses_status_idx on public.licenses(status, expires_at);
create index if not exists devices_license_idx on public.devices(license_id, status);
create index if not exists telegram_chats_username_idx on public.telegram_chats(lower(username));

alter table public.admin_users enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.licenses enable row level security;
alter table public.license_requests enable row level security;
alter table public.devices enable row level security;

-- No anonymous direct access to license/request/device data.
drop policy if exists admin_self_read on public.admin_users;
create policy admin_self_read on public.admin_users for select to authenticated using (user_id = auth.uid());

-- Admin check helper.
create or replace function public.qx_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

revoke all on function public.qx_is_admin() from public;
grant execute on function public.qx_is_admin() to authenticated;

-- First admin claim.
create or replace function public.claim_first_admin(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not authorized'; end if;
  select count(*) into n from public.admin_users;
  if n > 0 then raise exception 'An admin already exists'; end if;
  insert into public.admin_users(user_id,email) values(p_user_id,p_email);
  return jsonb_build_object('ok',true,'user_id',p_user_id);
end;
$$;
revoke all on function public.claim_first_admin(uuid,text) from public;
grant execute on function public.claim_first_admin(uuid,text) to authenticated;

-- Link Telegram chat to a pending request by email or submitted Telegram username.
create or replace function public.link_telegram_chat(p_email text, p_telegram_chat_id text, p_username text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.license_requests
     set telegram_chat_id = p_telegram_chat_id,
         updated_at = now()
   where status = 'pending'
     and (lower(email)=lower(p_email)
          or (p_username is not null and lower(coalesce(telegram,'')) in (lower(p_username), lower('@'||p_username))));
  get diagnostics n = row_count;
  return jsonb_build_object('linked', n > 0, 'updated', n);
end;
$$;
revoke all on function public.link_telegram_chat(text,text,text) from public;
grant execute on function public.link_telegram_chat(text,text,text) to service_role;

-- Admin request list.
create or replace function public.admin_get_license_requests()
returns setof public.license_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  return query select * from public.license_requests order by created_at desc;
end;
$$;
revoke all on function public.admin_get_license_requests() from public;
grant execute on function public.admin_get_license_requests() to authenticated;

create or replace function public.admin_get_licenses()
returns setof public.licenses
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  return query select * from public.licenses order by created_at desc;
end;
$$;
revoke all on function public.admin_get_licenses() from public;
grant execute on function public.admin_get_licenses() to authenticated;

-- Approve: creates the license in Supabase and returns the key. Telegram is sent only AFTER this succeeds in Cloudflare.
create or replace function public.admin_approve_license(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.license_requests; l public.licenses; k text;
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  select * into r from public.license_requests where id=p_request_id for update;
  if not found then raise exception 'Application not found'; end if;
  if r.status <> 'pending' then raise exception 'Application is already processed'; end if;
  if coalesce(r.telegram_chat_id,'') = '' then raise exception 'Telegram Chat ID is missing. Ask the applicant to start the bot first.'; end if;

  k := 'QX-' || upper(encode(gen_random_bytes(5),'hex')) || '-' || upper(encode(gen_random_bytes(5),'hex')) || '-' || upper(encode(gen_random_bytes(5),'hex'));
  insert into public.licenses(license_key,customer_name,customer_email,plan,status,expires_at,max_devices)
  values(k,r.name,r.email,'1-year','active',now()+interval '1 year',5)
  returning * into l;

  update public.license_requests
     set status='approved', license_id=l.id, approved_at=now(), updated_at=now()
   where id=r.id;

  return jsonb_build_object('ok',true,'license',to_jsonb(l),'request',to_jsonb(r));
end;
$$;
revoke all on function public.admin_approve_license(uuid) from public;
grant execute on function public.admin_approve_license(uuid) to authenticated;

create or replace function public.admin_reject_license(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  update public.license_requests set status='rejected', rejected_at=now(), updated_at=now() where id=p_request_id and status='pending';
  if not found then raise exception 'Pending application not found'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.admin_reject_license(uuid) from public;
grant execute on function public.admin_reject_license(uuid) to authenticated;

create or replace function public.admin_extend_license(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.licenses;
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  update public.licenses
     set expires_at = greatest(expires_at,now()) + interval '1 year', status='active', updated_at=now()
   where id=p_license_id
   returning * into l;
  if not found then raise exception 'License not found'; end if;
  return jsonb_build_object('ok',true,'license',to_jsonb(l));
end;
$$;
revoke all on function public.admin_extend_license(uuid) from public;
grant execute on function public.admin_extend_license(uuid) to authenticated;

create or replace function public.admin_reset_license_device(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  delete from public.devices where license_id=p_license_id;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.admin_reset_license_device(uuid) from public;
grant execute on function public.admin_reset_license_device(uuid) to authenticated;

create or replace function public.admin_suspend_license(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  update public.licenses set status='suspended', updated_at=now() where id=p_license_id;
  if not found then raise exception 'License not found'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.admin_suspend_license(uuid) from public;
grant execute on function public.admin_suspend_license(uuid) to authenticated;

-- Public client-side license activation. The license key + device ID are the inputs; all enforcement happens server-side in SQL.
create or replace function public.activate_license(p_license_key text, p_device_id text, p_device_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.licenses; d public.devices; active_count integer;
begin
  select * into l from public.licenses where license_key=trim(p_license_key) for update;
  if not found then raise exception 'Invalid license key'; end if;
  if l.status <> 'active' or l.expires_at <= now() then
    if l.expires_at <= now() and l.status='active' then update public.licenses set status='expired',updated_at=now() where id=l.id; end if;
    raise exception 'License is not active or has expired';
  end if;
  if coalesce(trim(p_device_id),'')='' then raise exception 'Device ID is required'; end if;

  select * into d from public.devices where license_id=l.id and device_id=trim(p_device_id) for update;
  if found then
    update public.devices set status='active',device_name=coalesce(p_device_name,device_name),last_seen=now() where id=d.id returning * into d;
  else
    select count(*) into active_count from public.devices where license_id=l.id and status='active';
    if active_count >= l.max_devices then raise exception 'Device limit reached'; end if;
    insert into public.devices(license_id,device_id,device_name) values(l.id,trim(p_device_id),p_device_name) returning * into d;
  end if;
  return jsonb_build_object('ok',true,'license',to_jsonb(l),'device',to_jsonb(d));
end;
$$;
revoke all on function public.activate_license(text,text,text) from public;
grant execute on function public.activate_license(text,text,text) to anon, authenticated;

create or replace function public.heartbeat_license(p_license_key text, p_device_id text, p_device_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.licenses; d public.devices;
begin
  select * into l from public.licenses where license_key=trim(p_license_key);
  if not found then raise exception 'Invalid license key'; end if;
  if l.status <> 'active' or l.expires_at <= now() then
    if l.expires_at <= now() and l.status='active' then update public.licenses set status='expired',updated_at=now() where id=l.id; end if;
    raise exception 'License is not active or has expired';
  end if;
  select * into d from public.devices where license_id=l.id and device_id=trim(p_device_id) and status='active' for update;
  if not found then raise exception 'This device is not registered for the license'; end if;
  update public.devices set last_seen=now(),device_name=coalesce(p_device_name,device_name) where id=d.id returning * into d;
  return jsonb_build_object('ok',true,'license',to_jsonb(l),'device',to_jsonb(d));
end;
$$;
revoke all on function public.heartbeat_license(text,text,text) from public;
grant execute on function public.heartbeat_license(text,text,text) to anon, authenticated;

-- Admin device list through REST when logged in.
drop policy if exists admin_devices_read on public.devices;
create policy admin_devices_read on public.devices for select to authenticated using (public.qx_is_admin());

-- Keep license/request tables inaccessible directly from browser; Admin uses security-definer RPCs.
revoke all on public.licenses from anon, authenticated;
revoke all on public.license_requests from anon, authenticated;
revoke all on public.telegram_chats from anon, authenticated;
revoke all on public.devices from anon;
grant select on public.devices to authenticated;

-- Service role owns the server-side tables/functions.
grant all on public.licenses, public.license_requests, public.telegram_chats, public.devices to service_role;


-- ================================================================
-- Existing production registration table compatibility
-- The Kiwi Extension currently writes to public.license_registrations.
-- The Admin/Telegram flow must use that same table end-to-end.
-- ================================================================
create table if not exists public.license_registrations (
  id bigint primary key,
  name text,
  email text,
  telegram text,
  device_id text,
  device_name text,
  status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  telegram_chat_id text
);

alter table public.license_registrations enable row level security;
alter table public.license_registrations add column if not exists license_id uuid references public.licenses(id) on delete set null;
create index if not exists license_registrations_status_idx on public.license_registrations(status, created_at desc);
create index if not exists license_registrations_license_idx on public.license_registrations(license_id);
create index if not exists license_registrations_email_idx on public.license_registrations(lower(email));

-- Telegram /start links to the REAL registration table.
drop function if exists public.link_telegram_chat(text,text,text);
create or replace function public.link_telegram_chat(p_email text, p_telegram_chat_id text, p_username text default null)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare n integer;
begin
  update public.license_registrations
     set telegram_chat_id=p_telegram_chat_id, updated_at=now()
   where status='pending'
     and (lower(coalesce(email,''))=lower(coalesce(p_email,''))
       or (p_username is not null and lower(coalesce(telegram,'')) in (lower(p_username), lower('@'||p_username))));
  get diagnostics n=row_count;
  return jsonb_build_object('linked', n>0, 'updated', n);
end;
$$;
revoke all on function public.link_telegram_chat(text,text,text) from public;
grant execute on function public.link_telegram_chat(text,text,text) to service_role;

-- Admin request list now reads the actual registration table used by the Extension.
drop function if exists public.admin_get_license_requests();
create or replace function public.admin_get_license_requests()
returns setof public.license_registrations
language plpgsql security definer set search_path=public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  return query select * from public.license_registrations order by created_at desc;
end;
$$;
revoke all on function public.admin_get_license_requests() from public;
grant execute on function public.admin_get_license_requests() to authenticated;

-- Explicit name used by the corrected Cloudflare v3 dashboard.
create or replace function public.admin_get_license_registrations()
returns setof public.license_registrations
language plpgsql security definer set search_path=public
as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  return query select * from public.license_registrations order by created_at desc;
end;
$$;
revoke all on function public.admin_get_license_registrations() from public;
grant execute on function public.admin_get_license_registrations() to authenticated;

-- Approve an existing registration, create its 1-year/5-device license,
-- and bind the resulting license back to the registration.
create or replace function public.admin_approve_license_registration(p_registration_id bigint)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare r public.license_registrations; l public.licenses; k text;
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  select * into r from public.license_registrations where id=p_registration_id for update;
  if not found then raise exception 'Registration not found'; end if;
  if coalesce(r.status,'pending') <> 'pending' then raise exception 'Registration is already processed'; end if;
  if coalesce(trim(r.telegram_chat_id),'')='' then raise exception 'Telegram Chat ID is missing. Ask the applicant to start the bot first.'; end if;
  k := 'QX-'||upper(encode(gen_random_bytes(5),'hex'))||'-'||upper(encode(gen_random_bytes(5),'hex'))||'-'||upper(encode(gen_random_bytes(5),'hex'));
  insert into public.licenses(license_key,customer_name,customer_email,plan,status,expires_at,max_devices)
  values(k,coalesce(r.name,''),coalesce(r.email,''),'1-year','active',now()+interval '1 year',5)
  returning * into l;
  update public.license_registrations
     set status='approved',license_id=l.id,approved_at=now(),updated_at=now()
   where id=r.id;
  return jsonb_build_object('ok',true,'license',to_jsonb(l),'registration',to_jsonb(r));
end;
$$;
revoke all on function public.admin_approve_license_registration(bigint) from public;
grant execute on function public.admin_approve_license_registration(bigint) to authenticated;

-- Add approval timestamps if this production table predates the new flow.
alter table public.license_registrations add column if not exists approved_at timestamptz;
alter table public.license_registrations add column if not exists rejected_at timestamptz;

create or replace function public.admin_reject_license_registration(p_registration_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.qx_is_admin() then raise exception 'Admin access required'; end if;
  update public.license_registrations set status='rejected',rejected_at=now(),updated_at=now()
   where id=p_registration_id and status='pending';
  if not found then raise exception 'Pending registration not found'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.admin_reject_license_registration(bigint) from public;
grant execute on function public.admin_reject_license_registration(bigint) to authenticated;

grant all on public.license_registrations to service_role;
