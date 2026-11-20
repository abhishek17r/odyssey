-- Odyssey for the owner: usage events, the AI cost ledger and its caps, and the admin report.
-- Run in Supabase → SQL Editor after schema.sql and push.sql. Safe to run again.
-- The Athena schedule (with your real cron secret) is in .secrets/athena-setup.sql on your Mac (not in git).

-- 1. Usage events: which features get used (names and small facts only, never what people typed) -------
create table if not exists public.odyssey_events (
  id      bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null,
  name    text not null,
  props   jsonb,
  app_v   text
);
create index if not exists odyssey_events_at on public.odyssey_events (at);
create index if not exists odyssey_events_user on public.odyssey_events (user_id, at);
alter table public.odyssey_events enable row level security;
revoke all on public.odyssey_events from anon, authenticated;

-- the app sends a batch (at most 300) for the signed-in account
create or replace function public.odyssey_track(events jsonb, v text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; uid uuid := public.odyssey_uid();
begin
  insert into public.odyssey_events (user_id, at, name, props, app_v)
  select uid,
         least(now(), greatest(now() - interval '30 days', to_timestamp(((x->>'t')::bigint) / 1000.0))),
         left(x->>'n', 40),
         case when x ? 'p' and length((x->'p')::text) < 300 then x->'p' end,
         left(v, 20)
  from (select x from jsonb_array_elements(events) as x limit 300) e
  where x->>'n' ~ '^[a-z_]{2,40}$' and x->>'t' ~ '^[0-9]{12,14}$';
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.odyssey_track(jsonb, text) from public, anon;
grant execute on function public.odyssey_track(jsonb, text) to authenticated;

-- 2. The AI ledger: one row per call to the model (or per call skipped by a cap or the cache) -----------
create table if not exists public.odyssey_ai_calls (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid references auth.users (id) on delete set null,
  kind       text not null,             -- morning | evening | weekly
  model      text,
  tokens_in  int default 0,
  tokens_out int default 0,
  cached_in  int default 0,             -- prompt tokens OpenAI served from its cache (cheaper)
  cost_usd   numeric(12, 6) default 0,
  ms         int,
  outcome    text not null,             -- used | rejected (failed the checks) | error | gateway-cache
  detail     text
);
create index if not exists odyssey_ai_calls_at on public.odyssey_ai_calls (at);
create index if not exists odyssey_ai_calls_user on public.odyssey_ai_calls (user_id, at);
alter table public.odyssey_ai_calls enable row level security;
revoke all on public.odyssey_ai_calls from anon, authenticated;

-- 3. Caps: the Athena job reads these before each call; past a cap the template stays (free) ------------
create table if not exists public.odyssey_ai_config (
  id                  int primary key default 1 check (id = 1),
  enabled             boolean not null default true,
  monthly_cap_usd     numeric(10, 2) not null default 5,
  user_daily_cap_usd  numeric(10, 4) not null default 0.005,
  user_monthly_cap_usd numeric(10, 4) not null default 0.05,  -- guardrails.sql adds it to an existing setup
  inactive_days       int not null default 14,     -- no AI for accounts not seen in this many days
  updated_at          timestamptz not null default now()
);
insert into public.odyssey_ai_config (id) values (1) on conflict (id) do nothing;
alter table public.odyssey_ai_config enable row level security;
revoke all on public.odyssey_ai_config from anon, authenticated;

-- accounts and when each was last seen (records or events), for the Athena job (service role only)
create or replace function public.odyssey_accounts()
returns table (user_id uuid, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, greatest(
    (select max(r.server_at) from public.odyssey_records r where r.user_id = u.id),
    (select max(e.at) from public.odyssey_events e where e.user_id = u.id))
  from auth.users u;
$$;
revoke all on function public.odyssey_accounts() from public, anon, authenticated;

-- what's been spent: this month in all, and each account over the last 24 hours (for the caps)
create or replace function public.odyssey_ai_spend()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'month', (select coalesce(sum(cost_usd), 0) from public.odyssey_ai_calls where at >= date_trunc('month', now())),
    'day', coalesce((select jsonb_object_agg(user_id, s) from (
      select user_id, sum(cost_usd) s from public.odyssey_ai_calls
      where at >= now() - interval '24 hours' and user_id is not null group by user_id) x), '{}'::jsonb),
    'user_month', coalesce((select jsonb_object_agg(user_id, s) from (
      select user_id, sum(cost_usd) s from public.odyssey_ai_calls
      where at >= date_trunc('month', now()) and user_id is not null group by user_id) x), '{}'::jsonb));
$$;
revoke all on function public.odyssey_ai_spend() from public, anon, authenticated;

-- 4. The admin report (owner only) -----------------------------------------------------------------------
create or replace function public.odyssey_admin(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(days, 365)));
        month timestamptz := date_trunc('month', now());
        out jsonb;
begin
  if not public.odyssey_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'since', since,
    'config', (select to_jsonb(c) from public.odyssey_ai_config c where id = 1),
    'totals', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'active_1d', (select count(distinct user_id) from public.odyssey_events where at > now() - interval '1 day'),
      'active_7d', (select count(distinct user_id) from public.odyssey_events where at > now() - interval '7 days'),
      'active_30d', (select count(distinct user_id) from public.odyssey_events where at > now() - interval '30 days'),
      'events', (select count(*) from public.odyssey_events where at > since),
      'ai_calls', (select count(*) from public.odyssey_ai_calls where at > since),
      'ai_cost', (select coalesce(sum(cost_usd), 0) from public.odyssey_ai_calls where at > since),
      'ai_cost_month', (select coalesce(sum(cost_usd), 0) from public.odyssey_ai_calls where at >= month),
      'ai_cost_today', (select coalesce(sum(cost_usd), 0) from public.odyssey_ai_calls where at >= date_trunc('day', now()))
    ),
    'users', coalesce((select jsonb_agg(u order by u->>'last_seen' desc nulls last) from (
      select jsonb_build_object(
        'id', au.id, 'name', regexp_replace(au.email, '@odyssey\.test$', ''), 'created', au.created_at,
        'last_seen', (select max(at) from public.odyssey_events e where e.user_id = au.id),
        'last_sync', (select max(server_at) from public.odyssey_records r where r.user_id = au.id),
        'days_active', (select count(distinct date_trunc('day', at)) from public.odyssey_events e where e.user_id = au.id and e.at > since),
        'events', (select count(*) from public.odyssey_events e where e.user_id = au.id and e.at > since),
        'focus_min', (select coalesce(sum((props->>'min')::numeric), 0) from public.odyssey_events e where e.user_id = au.id and e.at > since and e.name = 'focus_end'),
        'ai_calls', (select count(*) from public.odyssey_ai_calls a where a.user_id = au.id and a.at > since),
        'ai_cost', (select coalesce(sum(cost_usd), 0) from public.odyssey_ai_calls a where a.user_id = au.id and a.at > since),
        'ai_cost_month', (select coalesce(sum(cost_usd), 0) from public.odyssey_ai_calls a where a.user_id = au.id and a.at >= month),
        'version', (select app_v from public.odyssey_events e where e.user_id = au.id order by at desc limit 1)
      ) u from auth.users au) x), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(f order by (f->>'events')::int desc) from (
      select jsonb_build_object('name', name, 'events', count(*), 'users', count(distinct user_id),
        'last', max(at)) f
      from public.odyssey_events where at > since group by name) x), '[]'::jsonb),
    'views', coalesce((select jsonb_object_agg(v, n) from (
      select coalesce(props->>'v', props->>'s') v, count(*) n from public.odyssey_events
      where at > since and name in ('view', 'sheet') group by 1) x), '{}'::jsonb),
    'daily', coalesce((select jsonb_agg(d order by d->>'day') from (
      select jsonb_build_object('day', day, 'users', coalesce(ev.users, 0), 'events', coalesce(ev.n, 0),
        'ai_calls', coalesce(ai.calls, 0), 'ai_cost', coalesce(ai.cost, 0)) d
      from generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day') day
      left join (select date_trunc('day', at) d, count(distinct user_id) users, count(*) n from public.odyssey_events where at > since group by 1) ev on ev.d = day
      left join (select date_trunc('day', at) d, count(*) calls, sum(cost_usd) cost from public.odyssey_ai_calls where at > since group by 1) ai on ai.d = day
    ) x), '[]'::jsonb),
    'ai_by_kind', coalesce((select jsonb_agg(k order by (k->>'cost')::numeric desc) from (
      select jsonb_build_object('kind', kind, 'model', model, 'calls', count(*),
        'used', count(*) filter (where outcome = 'used'), 'rejected', count(*) filter (where outcome = 'rejected'),
        'errors', count(*) filter (where outcome = 'error'), 'gateway_cache', count(*) filter (where outcome = 'gateway-cache'),
        'avg_in', round(avg(tokens_in)), 'avg_out', round(avg(tokens_out)), 'cached_in', coalesce(sum(cached_in), 0),
        'avg_ms', round(avg(ms)), 'cost', coalesce(sum(cost_usd), 0),
        'cost_per_used', case when count(*) filter (where outcome = 'used') > 0 then sum(cost_usd) / count(*) filter (where outcome = 'used') end) k
      from public.odyssey_ai_calls where at > since group by kind, model) x), '[]'::jsonb),
    'recent_calls', coalesce((select jsonb_agg(c order by c->>'at' desc) from (
      select jsonb_build_object('at', a.at, 'user', regexp_replace(coalesce(u.email, '?'), '@odyssey\.test$', ''), 'kind', a.kind, 'model', a.model,
        'in', a.tokens_in, 'out', a.tokens_out, 'cost', a.cost_usd, 'ms', a.ms, 'outcome', a.outcome, 'detail', a.detail) c
      from public.odyssey_ai_calls a left join auth.users u on u.id = a.user_id
      order by a.at desc limit 40) x), '[]'::jsonb)
  ) into out;
  return out;
end; $$;

-- change the caps from the admin page
create or replace function public.odyssey_admin_set(cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.odyssey_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  update public.odyssey_ai_config set
    enabled            = coalesce((cfg->>'enabled')::boolean, enabled),
    monthly_cap_usd    = coalesce((cfg->>'monthly_cap_usd')::numeric, monthly_cap_usd),
    user_daily_cap_usd = coalesce((cfg->>'user_daily_cap_usd')::numeric, user_daily_cap_usd),
    user_monthly_cap_usd = coalesce((cfg->>'user_monthly_cap_usd')::numeric, user_monthly_cap_usd),
    inactive_days      = coalesce((cfg->>'inactive_days')::int, inactive_days),
    updated_at         = now()
  where id = 1;
  return (select to_jsonb(c) from public.odyssey_ai_config c where id = 1);
end; $$;

revoke all on function public.odyssey_admin(int) from public, anon;
revoke all on function public.odyssey_admin_set(jsonb) from public, anon;
grant execute on function public.odyssey_admin(int) to authenticated;
grant execute on function public.odyssey_admin_set(jsonb) to authenticated;

-- keep the event log to a year
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'odyssey-events-trim';
select cron.schedule('odyssey-events-trim', '17 3 * * *', $$ delete from public.odyssey_events where at < now() - interval '365 days' $$);
