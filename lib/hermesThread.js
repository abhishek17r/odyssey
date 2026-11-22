// Athena's one thread (1.9: Hermes' jobs became Athena's): everything she sends, in order, so you can answer or
// reply to any of it: her morning line and evening reply, the week's ideas, a moment, a trial's evening
// question, "Did it help?", the chat, and a record line for every change you made anywhere in the app.
// Plus the unread count on the Athena button and the app icon. Pure: shared by the app, the push function
// and the tests.
//
// The record is a synced note written only by the phone:
//   notes['athena-log']: { events: [{ id, at, text, ideaId?, where? }] }  (kept 30 days)

import { dateKey, addDays, parseKey, weekKeyOf, planOf, metricKey } from './score.js';
import { ideasId, momentId, answersId, history, isValid, NO_FOLLOW_UP, TRIAL_DAYS } from './hermes.js';
import { chatMsgs } from './hermesChat.js';
import { morningLine, eveningReply } from './athena.js';
import { sail, stormReasons } from './sail.js';

export const LOG_ID = 'athena-log';
const LOG_DAYS = 30;
const stop = (s) => String(s || '').replace(/\.$/, '');

// What a change says in the record (code's words, never the AI's)
export function recordText(kind, x = {}) {
  const t = x.title ? `“${x.title}”` : '';
  switch (kind) {
    case 'accepted': return `You said yes: ${stop(x.changed || x.title)}`;
    case 'notnow': return `Not now: ${t}`;
    case 'stopped': return `You undid ${t}`;
    case 'kept': return `You kept ${t}`;
    case 'dropped': return `You dropped ${t}; it's undone`;
    case 'tick': return `${x.yes ? 'Yes' : 'Not today'}: ${stop(x.check)}`;
    case 'remember': return `Athena will keep in mind: “${stop(x.text)}”`;
    default: return stop(x.text);
  }
}

// Add a record line → the notes patch (keeps the last 30 days)
export function logEvent(state, ev, now = Date.now()) {
  const old = (state.notes?.[LOG_ID]?.events || []).filter((e) => e.at > now - LOG_DAYS * 864e5);
  const e = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now, text: ev.text, ...(ev.ideaId ? { ideaId: ev.ideaId } : {}), ...(ev.where ? { where: ev.where } : {}) };
  return { notes: { ...(state.notes || {}), [LOG_ID]: { id: LOG_ID, kind: 'athena', events: [...old, e], at: now } } };
}
// A change's patch plus its record line, in one save
export function withRecord(state, patch, ev, now = Date.now()) {
  const merged = { ...state, ...patch, notes: { ...(state.notes || {}), ...(patch.notes || {}) } };
  return { ...patch, notes: logEvent(merged, ev, now).notes };
}

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const at = (day, h) => { const d = parseKey(day); d.setHours(h, 0, 0, 0); return d.getTime(); };

// An idea's state in the thread: 'open' | 'accepted' | 'undone' | 'notnow' | 'gone' (no longer applies)
export function ideaState(state, i, day) {
  const ans = state.notes?.[answersId(i.wk || weekKeyOf(i.id.slice(0, 10)))] || {};
  const n = Object.values(state.notes || {}).find((x) => x && String(x.id || '').startsWith('hermes-') && (x.trials?.[i.id] || x.decisions?.[i.id]));
  const d = ans.decisions?.[i.id] || n?.decisions?.[i.id];
  const tr = ans.trials?.[i.id] || n?.trials?.[i.id];
  if (tr && ['stopped', 'dropped'].includes(tr.outcome)) return 'undone';
  if (d === 'accepted' || tr) return 'accepted';
  if (d === 'notnow') return 'notnow';
  return isValid(state, i, day) ? 'open' : 'gone';
}

// → [{ id, at, kind: 'ideas'|'moment'|'followup'|'checkin'|'you'|'hermes'|'note'|'record', text, ideas?, h?, msg?, ideaId? }] oldest first
export function threadItems(state, day, now = Date.now()) {
  const out = [];
  const weeks = [weekKeyOf(shift(day, -7)), weekKeyOf(day)];
  for (const wk of weeks) {
    const n = state.notes?.[ideasId(wk)];
    if (n?.ideas?.length) out.push({ id: `w-${wk}`, at: n.at || at(wk, 6), kind: 'ideas', wk, text: `${n.ideas.length === 1 ? 'An idea' : `${n.ideas.length} ideas`} for this week, from your last week and your notes.`, ideas: n.ideas.map((i) => ({ ...i, wk })) });
  }
  for (let k = 7; k >= 0; k--) {
    const d = shift(day, -k);
    const n = state.notes?.[momentId(d)];
    if (n?.ideas?.length) out.push({ id: `m-${d}`, at: n.at || at(d, 10), kind: 'moment', text: n.moment?.what || 'Something came up today.', ideas: n.ideas.map((i) => ({ ...i, wk: weekKeyOf(d) })) });
  }
  for (const h of history(state, day)) {
    if (!h.start || NO_FOLLOW_UP.includes(h.idea.kind)) continue;
    if (day > h.end) out.push({ id: `f-${h.ideaId}`, at: at(shift(h.end, 1), 8), kind: 'followup', h, text: `Your trial “${h.idea.title}” ended. Did it help? Before and during, from your logs.` });
    else if (h.idea.kind === 'try' && !h.outcome && new Date(now).getHours() >= 18) {
      const n = Math.round((parseKey(day) - parseKey(h.start)) / 864e5) + 1;
      out.push({ id: `c-${h.ideaId}-${day}`, at: at(day, 18), kind: 'checkin', h, text: `Day ${n} of ${TRIAL_DAYS}: ${h.idea.check}` });
    }
  }
  for (const m of chatMsgs(state)) out.push({ id: m.id, at: m.at, kind: m.from === 'you' ? 'you' : 'hermes', text: m.text, ideas: m.ideas, msg: m });
  // Athena's own notes: this morning's line (and earlier mornings' AI lines), evening replies to your notes
  if (state.settings?.athenaOn !== false) {
    for (let k = 3; k >= 0; k--) {
      const d = shift(day, -k);
      const ai = state.notes?.[`ai-morning-${d}`];
      const text = k === 0 ? (state.notes?.[`day-${d}`]?.dismissed ? null : morningLine(state, d)?.text) : ai?.text;
      if (text) out.push({ id: `am-${d}`, at: ai?.at && ai.at < at(d, 12) ? ai.at : at(d, 7), kind: 'note', text });
      if (state.days?.[d]?.reflection) { const r = eveningReply(state, d); if (r) out.push({ id: `pm-${d}`, at: state.notes?.[`ai-evening-${d}`]?.at || at(d, 21), kind: 'note', text: r }); }
    }
  }
  // Light (the A/B's B side): Athena's evening check-in, from 6 pm: each habit still open today, then a word for the day
  if (state.settings?.variant === 'light' && state.settings?.athenaOn !== false && new Date(now).getHours() >= 18) {
    const plan = planOf(day, state);
    const vals = state.days?.[day]?.values || {};
    const asks = (plan?.goals || []).filter((g) => g.metrics?.[0]?.kind === 'daysPerWeek').map((g) => ({ goalId: g.id, name: g.name, key: metricKey(g, g.metrics[0]), tiny: g.tiny || null, answer: vals[metricKey(g, g.metrics[0])] ?? null }))
      .filter((a) => {
        const g = plan.goals.find((x) => x.id === a.goalId);
        const m = g.metrics[0];
        const fixed = m.days?.length ? m.days.includes(parseKey(day).getDay()) : null;
        return a.answer != null || fixed !== false;
      });
    out.push({ id: `ev-${day}`, at: at(day, 18), kind: 'evening', text: 'Evening. A quick check-in.', asks, mood: state.days?.[day]?.mood || null });
  }
  // Light: three days in, Athena asks for your Ithaca (instead of onboarding asking it up front)
  const ob = state.profile?.onboardedAt;
  if (state.settings?.variant === 'light' && ob && !state.profile?.identity && now - ob > 2 * 864e5) {
    out.push({ id: 'ithaca', at: ob + 2 * 864e5 + 9 * 36e5, kind: 'note', text: 'Three days in. Who do you want to be at the end of this voyage? Not a goal for this week: the person. It’s your Ithaca, and I’ll keep it in mind. (Me → Your course)' });
  }
  // a storm is told by Athena, here and on Journey, never as a full-screen scare (1.10)
  try {
    const v = sail(state, day);
    const storm = v.peril && [...v.log].reverse().find((l) => l.type === 'storm');
    if (storm) {
      const why = stormReasons(state, storm.wk);
      out.push({ id: `st-${storm.day}`, at: at(storm.day, 8), kind: 'note', text: `A hard week${why ? ` (${why.replace(/\.$/, '')})` : ''}, so the ship waits out a storm at ${v.peril.name}. Nothing you've earned is lost. One good day, two things done, and you sail on.` });
    }
  } catch { /* no voyage yet */ }
  for (const e of state.notes?.[LOG_ID]?.events || []) if (e.at > now - 7 * 864e5) out.push({ id: e.id, at: e.at, kind: 'record', text: e.where ? `${e.text} · ${e.where}` : e.text, ideaId: e.ideaId });
  return out.filter((x) => x.at <= now + 60000).sort((a, b) => a.at - b.at);
}

// Waiting on you: an idea or moment still open, a "Did it help?" not answered, a Hermes reply not read.
// Not counted: the evening question, reminders, Athena's notes. Cleared by opening the thread.
export function unreadCount(state, day, now = Date.now()) {
  const seen = Number(state.settings?.hermesSeen) || 0;
  if (state.settings?.hermesOn === false || state.settings?.athenaOn === false) return 0;
  let n = 0;
  for (const x of threadItems(state, day, now)) {
    if (x.at <= seen) continue;
    if ((x.kind === 'ideas' || x.kind === 'moment') && x.ideas.some((i) => ideaState(state, i, day) === 'open')) n++;
    else if (x.kind === 'followup' && !x.h.outcome) n++;
    else if (x.kind === 'hermes') n++;
    else if (x.kind === 'evening' && (x.asks.some((a) => a.answer == null) || !x.mood)) n++;
  }
  return n;
}
