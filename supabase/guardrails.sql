-- Cost guardrails (Odyssey 1.2.2). Run once in the Supabase SQL Editor; safe to run again.
-- Per account: US$0.005 a day and US$0.05 a month (about 3x what Athena costs on gpt-5.6-luna), on top of the
-- US$5 monthly total. ops.sql has the same definitions for a fresh setup.

alter table public.odyssey_ai_config add column if not exists user_monthly_cap_usd numeric(10, 4) not null default 0.05;
update public.odyssey_ai_config set user_daily_cap_usd = 0.005 where id = 1 and user_daily_cap_usd = 0.02;

-- what's been spent: this month in all, each account over the last 24 hours, and each account this month
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

create or replace function public.odyssey_admin_set(cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.odyssey_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  update public.odyssey_ai_config set
    enabled              = coalesce((cfg->>'enabled')::boolean, enabled),
    monthly_cap_usd      = coalesce((cfg->>'monthly_cap_usd')::numeric, monthly_cap_usd),
    user_daily_cap_usd   = coalesce((cfg->>'user_daily_cap_usd')::numeric, user_daily_cap_usd),
    user_monthly_cap_usd = coalesce((cfg->>'user_monthly_cap_usd')::numeric, user_monthly_cap_usd),
    inactive_days        = coalesce((cfg->>'inactive_days')::int, inactive_days),
    updated_at           = now()
  where id = 1;
  return (select to_jsonb(c) from public.odyssey_ai_config c where id = 1);
end; $$;
revoke all on function public.odyssey_admin_set(jsonb) from public, anon;
grant execute on function public.odyssey_admin_set(jsonb) to authenticated;
