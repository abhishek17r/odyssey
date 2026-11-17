// odyssey-invite: the owner invites someone by email. Supabase sends the invite through the project's own
// SMTP settings (SendGrid; see SETUP.md). The link opens the app, which asks them to pick a password.
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
  const { error } = await db.auth.admin.inviteUserByEmail(e, { redirectTo: APP_URL });
  if (error) return json({ error: /already.*registered/i.test(error.message) ? 'That email already has an account.' : error.message }, 400);
  return json({ ok: true });
});
