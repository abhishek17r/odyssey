// Which push notifications are due right now. Pure: the Supabase Edge Function calls it every few
// minutes with your synced data; tests call it with made-up data.
//
// Each notification has a key (e.g. "morning:2026-11-18") so it's sent once. A scheduled one goes out
// any time in the 90 minutes after its time (so a missed run doesn't lose it), and only if there's
// something to say (an evening check-in when you've already logged everything stays silent).

import { DEFAULT_SETTINGS, planOf, dateKey, addDays, parseKey, weekKeyOf, isPaused } from './score.js';
import { morningBrief, eveningCheckin, habitCue, middayNudge, weeklyNudge } from './notify.js';

const WINDOW_MIN = 90;
export const DAILY_CAP = 3; // reminders a day at most (a finished focus session doesn't count)

// The time of day where you are: { dayKey 'YYYY-MM-DD', minutes since midnight, weekday 'Fri' }.
export function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { dayKey: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: parts.weekday };
}

const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

/**
 * state: the synced data (settings, days, weeks, tickets, sessions, activeSession …)
 * sent: Set of keys already sent. → [{ key, title, body, url }]
 */
export function duePushes(state, nowMs, sent = new Set()) {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const L = localNow(s.tz, new Date(nowMs));
  const within = (hhmm) => { const t = toMin(hhmm); return t != null && L.minutes >= t && L.minutes < t + WINDOW_MIN; };
  const out = [];
  // reminders already sent today count toward the cap
  let today = [...sent].filter((k) => k.includes(L.dayKey) && !k.startsWith('end:')).length;
  const add = (key, n, url = './', capped = true) => {
    if (!n || sent.has(key)) return;
    if (capped && today >= DAILY_CAP) return;
    if (capped) today++;
    out.push({ key, title: n.title, body: n.message, url });
  };

  // a running session that's reached its length
  const a = state.activeSession;
  if (s.sessionEndOn !== false && a?.phase === 'work') {
    const worked = (a.workMs || 0) + Math.max(0, nowMs - a.phaseStart);
    if (worked >= (a.minutes || s.sessionMinutes) * 60000) add(`end:${a.id}`, { title: `⏰ ${a.minutes} min done`, message: `“${a.task}”: end the session, or keep going.` }, './?open=session', false);
  }
  if (s.morningOn !== false && within(s.morningTime)) add(`morning:${L.dayKey}`, morningBrief(state, L.dayKey), './?open=tasks');
  if (s.middayOn !== false && within(s.middayTime)) add(`midday:${L.dayKey}`, middayNudge(state, L.dayKey), './?open=today');
  if (s.checkinOn !== false && within(s.reminderTime)) add(`evening:${L.dayKey}`, eveningCheckin(state, L.dayKey), './?open=checkin');
  // the week ends Friday night: the report is ready (tap → the Report tab, on this week)
  if (s.planOn !== false && L.weekday === 'Fri' && within(s.planTime) && !isPaused(state, L.dayKey)) {
    add(`plan:${L.dayKey}`, weeklyNudge(state, L.dayKey), `./?open=report&id=${weekKeyOf(L.dayKey)}`);
  }
  // reminders you set on a task: always sent (you asked for them), not counted in the daily cap
  for (const t of Object.values(state.tickets || {})) {
    const r = Number(t.remindAt);
    if (!r || t.status === 'done' || nowMs < r || nowMs >= r + WINDOW_MIN * 60000) continue;
    add(`task:${t.id}:${r}`, { title: `⏰ ${t.title}`, message: t.loss ? `If it’s missed: ${t.loss}` : t.due ? `Due ${t.due === L.dayKey ? 'today' : t.due}.` : 'You asked for a reminder.' }, `./?open=task&id=${encodeURIComponent(t.id)}`, false);
  }
  if (s.cuesOn !== false) {
    for (const g of planOf(L.dayKey, state)?.goals || []) {
      if (g.cueTime && within(g.cueTime)) add(`cue:${g.id}:${L.dayKey}`, habitCue(state, L.dayKey, g.id), `./?open=habit&id=${encodeURIComponent(g.id)}`);
    }
  }
  return out;
}
