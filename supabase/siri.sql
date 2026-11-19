-- Odyssey + Siri: a personal key per account (only its hash is kept) and an inbox of what was said. The
-- odyssey-say function (Shortcuts calls it) checks the key, answers Siri and leaves the words in the inbox; the app
-- takes them when it opens and applies them. Run once in Supabase → SQL Editor (after schema.sql). Safe to run again.

create extension if not exists pgcrypto;

create table if not exists public.odyssey_say_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.odyssey_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (length(text) between 1 and 300),
  at timestamptz not null default now()
);
create index if not exists odyssey_inbox_user on public.odyssey_inbox (user_id, at);
alter table public.odyssey_say_keys enable row level security; -- no policies: only the functions below and the server
alter table public.odyssey_inbox enable row level security;

-- a new Siri key for the signed-in account (replaces the old one). The plain key is shown once.
create or replace function public.odyssey_say_key_new()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare k text := encode(gen_random_bytes(18), 'base64');
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  k := translate(k, '+/=', '-_');
  insert into public.odyssey_say_keys (user_id, key_hash) values (auth.uid(), encode(digest(k, 'sha256'), 'hex'))
  on conflict (user_id) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end $$;
grant execute on function public.odyssey_say_key_new() to authenticated;

-- does the signed-in account have a Siri key?
create or replace function public.odyssey_say_key_set()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.odyssey_say_keys where user_id = auth.uid());
$$;
grant execute on function public.odyssey_say_key_set() to authenticated;

-- take (and clear) what was said, oldest first
create or replace function public.odyssey_inbox_take()
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  with gone as (delete from public.odyssey_inbox where user_id = auth.uid() returning text, at)
  select coalesce(jsonb_agg(jsonb_build_object('text', text, 'at', at) order by at), '[]'::jsonb) into out from gone;
  return out;
end $$;
grant execute on function public.odyssey_inbox_take() to authenticated;
