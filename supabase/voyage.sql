-- Odyssey: rewards waiting at the voyage's harbours. The owner sets them on the admin page (/admin.html);
-- each account sees the rewards for everyone plus its own. Run once in Supabase → SQL Editor (after schema.sql
-- and ops.sql). Safe to run again.

create table if not exists public.odyssey_rewards (
  id uuid primary key default gen_random_uuid(),
  harbour int not null check (harbour between 1 and 12),       -- 1 = Delos … 12 = Ithaca
  user_id uuid references auth.users (id) on delete cascade,  -- null: for everyone
  icon text not null default '🎁',
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists odyssey_rewards_user on public.odyssey_rewards (user_id);
alter table public.odyssey_rewards enable row level security; -- no policies: reached only through the functions below

-- the signed-in account's rewards (for everyone, plus its own), by harbour
create or replace function public.odyssey_rewards()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'harbour', r.harbour, 'icon', r.icon, 'name', r.name) order by r.harbour, r.created_at), '[]'::jsonb)
  from public.odyssey_rewards r
  where auth.uid() is not null and (r.user_id is null or r.user_id = auth.uid());
$$;
grant execute on function public.odyssey_rewards() to authenticated;

-- the owner: every reward, and the accounts to pick from
create or replace function public.odyssey_rewards_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.odyssey_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rewards', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'harbour', r.harbour, 'icon', r.icon, 'name', r.name, 'user_id', r.user_id,
                  'user', (select split_part(u.email, '@', 1) from auth.users u where u.id = r.user_id)) order by r.harbour, r.created_at), '[]'::jsonb)
                from public.odyssey_rewards r),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', split_part(u.email, '@', 1)) order by u.created_at), '[]'::jsonb) from auth.users u));
end $$;
grant execute on function public.odyssey_rewards_admin() to authenticated;

-- the owner: add one ({ harbour, icon, name, user_id? }) or remove one ({ id })
create or replace function public.odyssey_rewards_set(op text, r jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.odyssey_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  if op = 'add' then
    insert into public.odyssey_rewards (harbour, icon, name, user_id)
    values ((r->>'harbour')::int, coalesce(nullif(r->>'icon', ''), '🎁'), trim(r->>'name'), nullif(r->>'user_id', '')::uuid);
  elsif op = 'remove' then
    delete from public.odyssey_rewards where id = (r->>'id')::uuid;
  else
    raise exception 'unknown op %', op;
  end if;
  return public.odyssey_rewards_admin();
end $$;
grant execute on function public.odyssey_rewards_set(text, jsonb) to authenticated;
