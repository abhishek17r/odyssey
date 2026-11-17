// odyssey-push: sends Odyssey's push notifications. Called every 5 minutes by pg_cron (see supabase/push.sql)
// with the x-cron-secret header, or by the app's "Send a test" button with the account's sign-in token.
//
// For each account with push on, it reads that account's synced records, asks lib/pushPlan.js what's due now, sends each one to every phone that
// turned push on, and remembers what it sent so nothing goes out twice.
// The deploy workflow copies ../../../lib and rewards.config.js next to this file first.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { fromRecords } from './lib/sync.js';
import { duePushes } from './lib/pushPlan.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails('https://odyssey.abhishek17r.workers.dev', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' },
});

// Is this request from the schedule, or from a signed-in account (the test button)?
async function caller(req: Request): Promise<{ cron: true } | { user: string } | null> {
  if (env('CRON_SECRET') && req.headers.get('x-cron-secret') === env('CRON_SECRET')) return { cron: true };
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user ? { user: data.user.id } : null;
}

// One account's records, rebuilt into the app's state.
async function loadState(userId: string) {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('odyssey_records').select('kind,id,data').eq('user_id', userId).eq('deleted', false).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  const state: any = fromRecords(new Map(all.map((r) => [`${r.kind}/${r.id}`, r.data])));
  state.settings ??= {};
  return state;
}

async function sendToAll(subs: any[], n: { title: string; body: string; url: string; key: string }) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.key.split(':')[0] }), { TTL: 3600, urgency: 'high' });
      ok++;
      await db.from('odyssey_push_subs').update({ last_ok: new Date().toISOString() }).eq('endpoint', s.endpoint);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('odyssey_push_subs').delete().eq('endpoint', s.endpoint); // phone unsubscribed
      else console.error('push failed', e?.statusCode, e?.body || e?.message);
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  const who = await caller(req);
  if (!who) return json({ error: 'not allowed' }, 401);
  const body = await req.json().catch(() => ({}));

  if ('user' in who) {
    if (!body.test) return json({ error: 'not allowed' }, 401);
    const { data: mine } = await db.from('odyssey_push_subs').select('endpoint,sub,tz').eq('user_id', who.user);
    if (!mine?.length) return json({ sent: 0, note: 'no phone has push on' });
    const ok = await sendToAll(mine, { key: 'test', title: '🔔 Odyssey', body: 'Push notifications work. You’ll get your reminders here.', url: './' });
    return json({ sent: ok });
  }

  // the schedule: everyone with a phone that has push on, each from their own data
  const { data: subs, error } = await db.from('odyssey_push_subs').select('endpoint,sub,tz,user_id');
  if (error) return json({ error: error.message }, 500);
  if (!subs?.length) return json({ sent: 0, note: 'no phone has push on' });
  const { data: logRows } = await db.from('odyssey_push_log').select('key').gte('sent_at', new Date(Date.now() - 3 * 864e5).toISOString());
  const logged = (logRows || []).map((r: any) => r.key as string);
  const byUser = new Map<string, any[]>();
  for (const s of subs) if (s.user_id) byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]);
  const report: Record<string, string[]> = {};
  let total = 0;
  for (const [uid, phones] of byUser) {
    try {
      const state = await loadState(uid);
      state.settings.tz ||= phones.find((s) => s.tz)?.tz || 'UTC';
      const sent = new Set(logged.filter((k) => k.startsWith(`${uid}:`)).map((k) => k.slice(uid.length + 1)));
      const due = duePushes(state, Date.now(), sent);
      for (const n of due) {
        await db.from('odyssey_push_log').upsert({ key: `${uid}:${n.key}`, sent_at: new Date().toISOString() }); // claim first, so a slow run can't double-send
        total += await sendToAll(phones, n);
      }
      report[uid.slice(0, 8)] = due.map((n) => n.key);
    } catch (e: any) {
      console.error('push run failed for', uid.slice(0, 8), e?.message);
    }
  }
  if (Math.random() < 0.02) await db.from('odyssey_push_log').delete().lt('sent_at', new Date(Date.now() - 30 * 864e5).toISOString());
  return json({ due: report, sent: total });
});
