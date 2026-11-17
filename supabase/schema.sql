-- Odyssey cloud schema: username + password accounts (Supabase Auth), each with its own private data.
-- Run in Supabase → SQL Editor → New query → Run. Safe to run again (it also upgrades the older
-- one-owner version: the data already there becomes the owner account's).
--
-- How it's locked:
--   • The records table has row level security on and no policies, and the public roles have no table
--     rights: nobody reads or writes it directly.
--   • The only way in is through two functions that use the caller's own sign-in: each account reads and
--     writes only its own rows.
--   • Accounts: with new sign-ups off, only accounts you add in Supabase (Authentication → Users → Add user)
--     exist. odyssey_owner still records the first account (the one the older data belonged to).

-- 1. Tables ---------------------------------------------------------------------------------------

create table if not exists public.odyssey_records (
  kind       text        not null,          -- settings | day | week | ticket | session | experiment | intention | purchase | active
  id         text        not null,          -- e.g. a date key, a ticket id
  data       jsonb,                         -- null once deleted
  updated_at bigint      not null,          -- when the device made the edit (ms since epoch); newest wins
  deleted    boolean     not null default false,
  server_at  timestamptz not null default clock_timestamp(), -- when the server accepted it (devices pull by this)
  user_id    uuid        references auth.users (id) on delete cascade, -- whose record
  primary key (user_id, kind, id)
);

create table if not exists public.odyssey_owner (
  id      int  primary key default 1 check (id = 1),  -- exactly one row
  user_id uuid not null references auth.users (id) on delete cascade
);

alter table public.odyssey_records enable row level security;
alter table public.odyssey_owner   enable row level security;
revoke all on public.odyssey_records from anon, authenticated;
revoke all on public.odyssey_owner   from anon, authenticated;

-- 2. The first account becomes the owner ------------------------------------------------------------

create or replace function public.odyssey_claim_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.odyssey_owner (id, user_id) values (1, new.id) on conflict (id) do nothing;
  return new;
end;
$$;

-- only a confirmed account can become the owner (a half-finished email sign-up can't)
drop trigger if exists odyssey_claim_owner on auth.users;
create trigger odyssey_claim_owner after insert or update of email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null)
  execute function public.odyssey_claim_owner();

-- if your account already exists (created before this ran), the oldest confirmed one is the owner
insert into public.odyssey_owner (id, user_id)
select 1, id from auth.users where email_confirmed_at is not null order by created_at limit 1
on conflict (id) do nothing;

create or replace function public.odyssey_is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$ select auth.uid() is not null and exists (select 1 from public.odyssey_owner where user_id = auth.uid()); $$;

-- 2b. Upgrade from the one-owner version: every record belongs to an account -------------------------

alter table public.odyssey_records add column if not exists user_id uuid references auth.users (id) on delete cascade;
update public.odyssey_records set user_id = (select user_id from public.odyssey_owner where id = 1) where user_id is null;
alter table public.odyssey_records alter column user_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                 where c.conrelid = 'public.odyssey_records'::regclass and c.contype = 'p' and a.attname = 'user_id') then
    alter table public.odyssey_records drop constraint if exists odyssey_records_pkey;
    alter table public.odyssey_records add primary key (user_id, kind, id);
  end if;
end $$;
drop index if exists public.odyssey_records_pull;
create index if not exists odyssey_records_user_pull on public.odyssey_records (user_id, server_at);

-- the signed-in account, or an error
create or replace function public.odyssey_uid()
returns uuid
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return auth.uid();
end;
$$;

-- 3. Save a batch of edits: a record is only replaced by a newer edit -----------------------------------

create or replace function public.odyssey_push(rows jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer; uid uuid := public.odyssey_uid();
begin
  insert into public.odyssey_records as r (user_id, kind, id, data, updated_at, deleted, server_at)
  select uid, x->>'kind', x->>'id',
         case when coalesce((x->>'deleted')::boolean, false) then null else x->'data' end,
         (x->>'updated_at')::bigint, coalesce((x->>'deleted')::boolean, false), clock_timestamp()
  from jsonb_array_elements(rows) as x
  on conflict (user_id, kind, id) do update
    set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, server_at = clock_timestamp()
    where excluded.updated_at > r.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4. Read what changed since a time, oldest first, a page at a time ---------------------------------------

create or replace function public.odyssey_pull(since timestamptz default null, page_offset int default 0)
returns table (kind text, id text, data jsonb, updated_at bigint, deleted boolean, server_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare uid uuid := public.odyssey_uid();
begin
  return query
    select r.kind, r.id, r.data, r.updated_at, r.deleted, r.server_at
    from public.odyssey_records r
    where r.user_id = uid and (since is null or r.server_at > since)
    order by r.server_at, r.kind, r.id
    limit 1000 offset greatest(page_offset, 0);
end;
$$;

revoke all on function public.odyssey_claim_owner() from public, anon, authenticated;
revoke all on function public.odyssey_is_owner() from public, anon;
revoke all on function public.odyssey_uid() from public, anon;
grant execute on function public.odyssey_uid() to authenticated;
revoke all on function public.odyssey_push(jsonb) from public, anon;
revoke all on function public.odyssey_pull(timestamptz, int) from public, anon;
grant execute on function public.odyssey_is_owner()             to authenticated;
grant execute on function public.odyssey_push(jsonb)            to authenticated;
grant execute on function public.odyssey_pull(timestamptz, int) to authenticated;

-- 5. Earlier versions (sync key, email sign-in): remove what's left of them ----------------------------------
drop function if exists public.odyssey_check(text);
drop function if exists public.odyssey_push(text, jsonb);
drop function if exists public.odyssey_pull(text, timestamptz, int);
drop function if exists public.odyssey_key_ok(text);
drop table if exists public.odyssey_key;
drop function if exists public.push_records(jsonb);
drop table if exists public.records;
