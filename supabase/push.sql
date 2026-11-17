-- Odyssey push notifications. Run in Supabase → SQL Editor after schema.sql. Safe to run again.
-- The ready-to-run copy with your real secret is .secrets/push-setup.sql on your Mac (not in git).

-- Phones that turned push on, and what's been sent (so each notification goes out once).
create table if not exists public.odyssey_push_subs (
  endpoint   text primary key,
  sub        jsonb not null,           -- the browser's push subscription
  tz         text,                     -- the phone's time zone
  created_at timestamptz not null default now(),
  last_ok    timestamptz,
  user_id    uuid references auth.users (id) on delete cascade  -- whose phone
);
create table if not exists public.odyssey_push_log (
  key     text primary key,            -- <user id>:<what>, e.g. <user id>:morning:2026-11-18
  sent_at timestamptz not null default now()
);
-- upgrade from the one-owner version: phones and sent-log entries belong to an account
alter table public.odyssey_push_subs add column if not exists user_id uuid references auth.users (id) on delete cascade;
update public.odyssey_push_subs set user_id = (select user_id from public.odyssey_owner where id = 1) where user_id is null;
update public.odyssey_push_log set key = (select user_id from public.odyssey_owner where id = 1)::text || ':' || key
  where key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' and exists (select 1 from public.odyssey_owner);
create index if not exists odyssey_push_subs_user on public.odyssey_push_subs (user_id);
alter table public.odyssey_push_subs enable row level security;
alter table public.odyssey_push_log  enable row level security;
revoke all on public.odyssey_push_subs from anon, authenticated;
revoke all on public.odyssey_push_log  from anon, authenticated;

-- The signed-in account saves / removes this phone's subscription.
create or replace function public.odyssey_push_subscribe(sub jsonb, tz text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.odyssey_uid();
begin
  insert into public.odyssey_push_subs (endpoint, sub, tz, user_id) values (sub->>'endpoint', sub, tz, uid)
  on conflict (endpoint) do update set sub = excluded.sub, tz = excluded.tz, user_id = excluded.user_id;
end; $$;

create or replace function public.odyssey_push_unsubscribe(endpoint text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.odyssey_uid();
begin
  delete from public.odyssey_push_subs s where s.endpoint = odyssey_push_unsubscribe.endpoint and s.user_id = uid;
end; $$;

revoke all on function public.odyssey_push_subscribe(jsonb, text) from public, anon;
revoke all on function public.odyssey_push_unsubscribe(text) from public, anon;
grant execute on function public.odyssey_push_subscribe(jsonb, text) to authenticated;
grant execute on function public.odyssey_push_unsubscribe(text) to authenticated;

-- Every 5 minutes, ask the odyssey-push Edge Function to send whatever is due.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'odyssey-push';
select cron.schedule('odyssey-push', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://wotlxnvhhgtrgsaggvui.supabase.co/functions/v1/odyssey-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
$$);
