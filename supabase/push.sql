-- Odyssey push notifications. Run in Supabase → SQL Editor after schema.sql.
-- The ready-to-run copy with your real secret is .secrets/push-setup.sql on your Mac (not in git).

-- Phones that turned push on, and what's been sent (so each notification goes out once).
create table if not exists public.odyssey_push_subs (
  endpoint   text primary key,
  sub        jsonb not null,           -- the browser's push subscription
  tz         text,                     -- the phone's time zone
  created_at timestamptz not null default now(),
  last_ok    timestamptz
);
create table if not exists public.odyssey_push_log (
  key     text primary key,            -- e.g. morning:2026-11-18, end:<session id>
  sent_at timestamptz not null default now()
);
alter table public.odyssey_push_subs enable row level security;
alter table public.odyssey_push_log  enable row level security;
revoke all on public.odyssey_push_subs from anon, authenticated;
revoke all on public.odyssey_push_log  from anon, authenticated;

-- Owner only: save / remove this phone's subscription.
create or replace function public.odyssey_push_subscribe(sub jsonb, tz text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.odyssey_is_owner() then raise exception 'not signed in as the owner' using errcode = '28000'; end if;
  insert into public.odyssey_push_subs (endpoint, sub, tz) values (sub->>'endpoint', sub, tz)
  on conflict (endpoint) do update set sub = excluded.sub, tz = excluded.tz;
end; $$;

create or replace function public.odyssey_push_unsubscribe(endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.odyssey_is_owner() then raise exception 'not signed in as the owner' using errcode = '28000'; end if;
  delete from public.odyssey_push_subs s where s.endpoint = odyssey_push_unsubscribe.endpoint;
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
