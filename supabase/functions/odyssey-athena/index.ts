// odyssey-athena: writes Athena's AI notes. Called every 10 minutes by pg_cron (see .secrets/athena-setup.sql)
// with the x-cron-secret header, or by the owner from admin.html ("Run now") with their sign-in token, or by the
// app on launch for the signed-in account only ({ launch: true }). AI_LAUNCH_HOURS sets how often a launch may run:
// 0 (the default, while testing) = every launch, ignoring the time windows; 24 in prod = at most once a day, within them.
//
// For each account seen lately, with Athena on: in the morning window, after an evening reflection, and once
// a week has ended, it builds the request from lib/athenaAI.js (the template is the draft), asks the model,
// checks the answer, and saves it as a synced note. Every call goes into odyssey_ai_calls with its tokens and
// cost; past the monthly or per-account cap no call is made and the template stays.
// The deploy workflow copies ../../../lib and rewards.config.js next to this file first.
//
// Secrets (Supabase → Edge Functions → Secrets): OPENAI_API_KEY, CRON_SECRET (same as push);
// optional AI_BASE_URL (Cloudflare AI Gateway: https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai),
// CF_AIG_TOKEN (if the gateway is authenticated), AI_PRICES (JSON, to override lib/athenaAI.js), DEFAULT_TZ.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { fromRecords } from './lib/sync.js';
import { buildRequest, parseReply, costOf, PRICES, noteFor, needsNote, noteIdOf, effortFor, overBudget, costAlert, estTokens } from './lib/athenaAI.js';
import { weekKeyOf, weekDays, addDays, parseKey, dateKey } from './lib/score.js';
import { mergeMemory, triedMemory, MEMORY_ID } from './lib/memory.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const BASE = (env('AI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
const prices = (() => { try { return { ...PRICES, ...JSON.parse(env('AI_PRICES') || '{}') }; } catch { return PRICES; } })();
const MAX_CALLS_PER_RUN = 40;
const MAX_REWRITES = { morning: 2, evening: 3, weekly: 2, report: 2, goal: 3, memory: 99 }; // memory: its own once-a-week gate (lib/memory.js) // per note: a draft that keeps moving stops costing

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' },
});

async function caller(req: Request): Promise<{ cron: true } | { owner: string } | { user: string } | null> {
  if (env('CRON_SECRET') && req.headers.get('x-cron-secret') === env('CRON_SECRET')) return { cron: true };
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return null;
  const { data: o } = await db.from('odyssey_owner').select('user_id').eq('id', 1).maybeSingle();
  return o?.user_id === data.user.id ? { owner: data.user.id } : { user: data.user.id };
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
  state.notes ??= {};
  return state;
}

// the day and hour where the person is
function localNow(tz: string) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  } catch { return localNow('Asia/Kolkata'); }
}
const shift = (k: string, n: number) => dateKey(addDays(parseKey(k), n));

// What could be written for this person now: [{ req, day, wk }]
function candidates(state: any, day: string, hour: number, force: boolean) {
  const out: any[] = [];
  const wake = Number(String(state.profile?.wakeTime || '07:00').slice(0, 2));
  if (force || (hour >= Math.max(4, wake - 1) && hour < 12)) out.push({ req: buildRequest('morning', state, day), day, wk: weekKeyOf(day) });
  if (state.days?.[day]?.reflection) out.push({ req: buildRequest('evening', state, day), day, wk: weekKeyOf(day) });
  // the weekly read once the week is (nearly) over: its last day from 5 pm, or the two days after
  const cur = weekKeyOf(day);
  const last = weekDays(cur)[6];
  // …and the report's weak spots, in Athena's words (the Friday-night notification opens the report)
  for (const kind of ['weekly', 'report']) {
    if (day === last && (hour >= 17 || force)) out.push({ req: buildRequest(kind, state, last, cur), day: last, wk: cur });
    const prev = shift(cur, -7);
    if (weekDays(cur).indexOf(day) <= 1) out.push({ req: buildRequest(kind, state, weekDays(prev)[6], prev), day: weekDays(prev)[6], wk: prev });
  }
  // a habit goal's plan in Athena's words, once it's set or changed
  for (const id of Object.keys(state.profile?.visions || {})) out.push({ req: buildRequest('goal', state, day, cur, id), day, wk: cur });
  // Athena's memory: rebuilt once a week (from 5 am), and first, so this run's notes are written with it
  if (hour >= 5 || force) out.unshift({ req: buildRequest('memory', state, day, cur, null, { force }), day, wk: cur });
  return out.filter((c) => c.req);
}

async function ask(req: any, uid: string) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json',
        ...(env('CF_AIG_TOKEN') ? { 'cf-aig-authorization': `Bearer ${env('CF_AIG_TOKEN')}` } : {}),
        ...(BASE.includes('gateway.ai.cloudflare.com') ? { 'cf-aig-metadata': JSON.stringify({ kind: req.kind, user: uid.slice(0, 8) }) } : {}),
      },
      body: JSON.stringify({
        model: req.model, messages: req.messages, response_format: { type: 'json_object' },
        reasoning_effort: effortFor(req.model), max_completion_tokens: req.kind === 'memory' ? 1200 : ['weekly', 'report', 'goal'].includes(req.kind) ? 900 : 500,
        prompt_cache_key: `athena-${req.kind}`, // the system prompt is shared: OpenAI's cache makes it cheaper
      }),
    });
    const body = await res.json().catch(() => ({}));
    const u = body?.usage || {};
    return {
      ok: res.ok, status: res.status, ms: Date.now() - t0,
      text: body?.choices?.[0]?.message?.content || '', model: body?.model || req.model,
      tin: u.prompt_tokens || 0, tout: u.completion_tokens || 0, cached: u.prompt_tokens_details?.cached_tokens || 0,
      gatewayHit: res.headers.get('cf-aig-cache-status') === 'HIT',
      error: res.ok ? null : String(body?.error?.message || `HTTP ${res.status}`).slice(0, 200),
    };
  } catch (e: any) {
    return { ok: false, status: 0, ms: Date.now() - t0, text: '', model: req.model, tin: 0, tout: 0, cached: 0, gatewayHit: false, error: String(e?.name === 'AbortError' ? 'timeout' : e?.message).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

async function saveNote(uid: string, note: any) {
  const { error } = await db.from('odyssey_records').upsert({
    user_id: uid, kind: 'note', id: note.id, data: note, updated_at: Date.now(), deleted: false, server_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,id' });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  const who = await caller(req);
  if (!who) return json({ error: 'not allowed' }, 401);
  const body = await req.json().catch(() => ({}));
  // the app's launch run: only for the signed-in account (anyone else's token gets nothing more)
  const launchHours = Number(env('AI_LAUNCH_HOURS') || 0);
  const launch = 'user' in who || ('owner' in who && !!body.launch);
  if ('user' in who && !body.launch) return json({ error: 'not allowed' }, 401);
  // the owner's "Run now", and every launch while testing: ignore the time windows, for their own account
  const force = ('owner' in who && !!body.force) || (launch && launchHours === 0);
  if (!env('OPENAI_API_KEY')) return json({ error: 'OPENAI_API_KEY is not set' }, 500);

  const { data: cfg } = await db.from('odyssey_ai_config').select('*').eq('id', 1).maybeSingle();
  if (cfg && !cfg.enabled) return json('user' in who ? { calls: 0, report: ['off'] } : { note: 'Athena AI is turned off (admin)' });
  const { data: spend } = await db.rpc('odyssey_ai_spend');
  let month = Number(spend?.month || 0);
  const day: Record<string, number> = spend?.day || {};
  const monthCap = Number(cfg?.monthly_cap_usd ?? 5);
  const userCap = Number(cfg?.user_daily_cap_usd ?? 0.005);
  const userMonthCap = Number(cfg?.user_monthly_cap_usd ?? 0.05);
  const userMonth: Record<string, number> = spend?.user_month || {};
  if (month >= monthCap && 'user' in who) return json({ calls: 0, report: ['monthly cap'] });
  if (month >= monthCap) return json({ note: `monthly cap reached ($${month.toFixed(4)} of $${monthCap})` });

  // who: the owner alone (Run now), or every account seen in the last N days
  let users: string[];
  if ('owner' in who) users = [who.owner];
  else if ('user' in who) users = [who.user];
  else {
    const { data: acc } = await db.rpc('odyssey_accounts');
    const cutoff = Date.now() - Number(cfg?.inactive_days ?? 14) * 864e5;
    users = (acc || []).filter((a: any) => a.last_seen && Date.parse(a.last_seen) > cutoff).map((a: any) => a.user_id);
  }
  const { data: subs } = await db.from('odyssey_push_subs').select('user_id,tz');
  const tzOf = (uid: string) => subs?.find((s: any) => s.user_id === uid && s.tz)?.tz;

  const report: Record<string, string[]> = {};
  let calls = 0;
  for (const uid of users) {
    if (calls >= MAX_CALLS_PER_RUN) break;
    const r: string[] = (report[uid.slice(0, 8)] = []);
    try {
      const state = await loadState(uid);
      if (state.settings.athenaOn === false || !state.profile?.onboardedAt) { r.push('off'); continue; }
      // a launch run at most every AI_LAUNCH_HOURS (prod: 24); its time is a synced note, so every device sees it
      if (launch && launchHours > 0 && Date.now() - (state.notes['ai-launch']?.at || 0) < launchHours * 36e5) { r.push('launch: ran lately'); continue; }
      if (launch) await saveNote(uid, { id: 'ai-launch', kind: 'ai', of: 'launch', at: Date.now() });
      const { day: today, hour } = localNow(state.settings.tz || tzOf(uid) || env('DEFAULT_TZ') || 'Asia/Kolkata');
      let list = candidates(state, today, hour, force);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const id = c.req.noteId || noteIdOf(c.req.kind, c.day, c.wk);
        const existing = state.notes[id];
        if (!needsNote(c.req, existing)) continue; // already written for this draft: the cheapest cache
        if ((existing?.n || 0) >= MAX_REWRITES[c.req.kind as keyof typeof MAX_REWRITES] && !force) { r.push(`${c.req.kind}: rewrites used up`); continue; }
        if ((day[uid] || 0) >= userCap) { r.push(`${c.req.kind}: account cap`); break; }
        if ((userMonth[uid] || 0) >= userMonthCap) { r.push(`${c.req.kind}: account monthly cap`); break; }
        if (overBudget(c.req)) { r.push(`${c.req.kind}: over input budget (${estTokens(c.req)} tokens)`); continue; }
        if (month >= monthCap || calls >= MAX_CALLS_PER_RUN) break;
        calls++;
        const a = await ask(c.req, uid);
        const cost = a.gatewayHit ? 0 : costOf(a.model, a.tin, a.tout, prices, a.cached);
        month += cost;
        day[uid] = (day[uid] || 0) + cost;
        userMonth[uid] = (userMonth[uid] || 0) + cost;
        const alert = costAlert(c.req, cost);
        const reply = a.ok ? parseReply(c.req, a.text) : null;
        const outcome = !a.ok ? 'error' : !reply ? 'rejected' : a.gatewayHit ? 'gateway-cache' : 'used';
        await db.from('odyssey_ai_calls').insert({
          user_id: uid, kind: c.req.kind, model: a.model, tokens_in: a.tin, tokens_out: a.tout, cached_in: a.cached,
          cost_usd: cost, ms: a.ms, outcome, detail: a.error || (reply ? (alert ? `cost alert: $${cost.toFixed(5)}` : null) : String(a.text).slice(0, 200)),
        });
        if (c.req.kind === 'memory') {
          // merged into what's there (their own lines stay); a rejected answer is counted so it's tried at most twice a week
          const m = reply ? mergeMemory(existing, reply, { wk: c.req.wk, forHash: c.req.forHash, model: a.model, notes: c.req.input.yourWords.eveningNotes.length > 0 }) : triedMemory(existing, c.req.wk);
          await saveNote(uid, m);
          state.notes[MEMORY_ID] = m;
          if (reply) list = [c, ...candidates(state, today, hour, force).filter((x) => x.req.kind !== 'memory')]; // the rest of this run writes with the new memory
          r.push(`memory: ${outcome}`);
          continue;
        }
        if (reply) await saveNote(uid, { ...noteFor(c.req, reply, c.day, c.wk, a.model), n: (existing?.n || 0) + 1 });
        r.push(`${c.req.kind}: ${outcome}`);
      }
    } catch (e: any) {
      console.error('athena run failed for', uid.slice(0, 8), e?.message);
      r.push(`failed: ${e?.message}`);
    }
  }
  // an account's own launch sees only what was written for it, not the app's spend
  if ('user' in who) return json({ calls, report: Object.values(report)[0] || [] });
  return json({ calls, month_usd: Number(month.toFixed(6)), report });
});
