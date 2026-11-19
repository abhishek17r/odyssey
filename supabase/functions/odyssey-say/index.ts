// odyssey-say: Siri → Odyssey. An iPhone Shortcut dictates what you said and calls
//   GET /functions/v1/odyssey-say?k=<your Siri key>&t=<what you said>
// It checks the key (only its sha-256 is stored), leaves the words in your inbox for the app to apply when it opens,
// and answers in plain text for Siri to speak ("Gym: done for today.", or your day for "how's my day").
// The deploy workflow copies ../../../lib and rewards.config.js next to this file first.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { fromRecords } from './lib/sync.js';
import { parseSay, replyFor } from './lib/say.js';
import { localNow } from './lib/pushPlan.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let k = url.searchParams.get('k') || '';
  let t = url.searchParams.get('t') || '';
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    k ||= body.k || body.key || '';
    t ||= body.t || body.text || '';
  }
  t = t.trim().slice(0, 300);
  if (!k) return text('Odyssey needs your Siri key. Set up Siri again in Odyssey → Me.', 401);
  const { data: row } = await db.from('odyssey_say_keys').select('user_id').eq('key_hash', await sha256(k)).maybeSingle();
  if (!row) return text('That Siri key isn’t valid any more. Set up Siri again in Odyssey → Me.', 401);
  if (!t) return text('I didn’t hear anything.');
  // a little rate limit: at most 40 waiting in the inbox
  const { count } = await db.from('odyssey_inbox').select('id', { count: 'exact', head: true }).eq('user_id', row.user_id);
  if ((count || 0) >= 40) return text('Open Odyssey first: there’s a lot waiting from Siri.');
  try {
    const state = await loadState(row.user_id);
    const today = localNow(state.settings.tz || 'Asia/Kolkata').dayKey;
    const p = parseSay(t, state, today);
    if (p.kind !== 'day') await db.from('odyssey_inbox').insert({ user_id: row.user_id, text: t });
    const reply = replyFor(p, state, today);
    return text(p.kind === 'day' ? reply : `${reply} It’ll be in Odyssey when you open it.`);
  } catch (e: any) {
    console.error('say failed', e?.message);
    await db.from('odyssey_inbox').insert({ user_id: row.user_id, text: t });
    return text('Got it. It’ll be in Odyssey when you open it.');
  }
});
