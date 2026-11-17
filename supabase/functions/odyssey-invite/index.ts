// odyssey-invite: the owner invites someone by email. Supabase sends the invite through the project's own
// SMTP settings (Mailjet, Brevo …; see SETUP.md). The link opens the app, which asks them to pick a password.
// Only the owner (public.odyssey_owner) can call it.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const APP_URL = env('APP_URL') || 'https://odyssey.abhishek17r.workers.dev/';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  const { data: who } = token ? await db.auth.getUser(token) : { data: null };
  if (!who?.user) return json({ error: 'Sign in first.' }, 401);
  const { data: owner } = await db.from('odyssey_owner').select('user_id').eq('id', 1).maybeSingle();
  if (owner?.user_id !== who.user.id) return json({ error: 'Only the owner can invite people.' }, 403);

  const { email } = await req.json().catch(() => ({}));
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.endsWith('@odyssey.test')) return json({ error: 'Use a real email address.' }, 400);
  // Inviting again someone who never accepted: start over (they have no data yet), so the email goes out again.
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const old = list?.users?.find((u) => (u.email || '').toLowerCase() === e);
  if (old) {
    if (old.last_sign_in_at || old.email_confirmed_at) return json({ error: 'That email already has an account.' }, 400);
    await db.auth.admin.deleteUser(old.id);
  }

  // Sending goes through the mail server and can take a while; answer within 8 s and let it finish
  // in the background (the email still goes out; Mailjet → Statistics shows it).
  const send = db.auth.admin.inviteUserByEmail(e, { redirectTo: APP_URL })
    .then(({ error }) => { if (error) console.error('invite failed', e, error.message); return { error }; });
  // @ts-ignore EdgeRuntime is Supabase's runtime global
  globalThis.EdgeRuntime?.waitUntil?.(send);
  const r = await Promise.race([send, new Promise<null>((res) => setTimeout(() => res(null), 8000))]);
  if (r === null) return json({ ok: true, pending: true });
  if (r.error) return json({ error: /already.*registered/i.test(r.error.message) ? 'That email already has an account.' : r.error.message }, 400);
  return json({ ok: true, resent: !!old });
});
