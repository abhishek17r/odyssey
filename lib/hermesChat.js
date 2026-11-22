// Hermes chat (H1b): you say what's going on; Hermes answers in two or three sentences and attaches up to 3
// changes, each checked by the same code as the weekly ideas (lib/hermes.js), applied only when you accept.
// One call a message, not an agent. Pure: shared by the app, the server function and the tests.
//
// The conversation is a synced note written only by the phone (the server answers, the phone saves both):
//   notes['hermes-chat']: { msgs: [{ id, from: 'you' | 'hermes', text, at, ideas?, remember?, about? }], at }
// Kept 7 days. Athena learns from it only what you tap Remember on.

import { dateKey, addDays, parseKey, weekKeyOf, pauseOn } from './score.js';
import { crisisIn, CRISIS_LINE } from './safety.js';
import { numbersIn } from './digest.js';
import { factsForHermes, notesForHermes, hermesBase, parseHermes, history, MEDICAL } from './hermes.js';
import { memoryFacts } from './memory.js';

export const CHAT_ID = 'hermes-chat';
export const CHAT_PER_DAY = 10;
export const KEEP_DAYS = 7;
const RECENT = 6;

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/!+/g, '.').trim();
// in a chat "they" is usually tasks or notes, so only talking about the person counts
const THIRD = /\b(the user|the person|this person|the client)\b/i;
const BOUNDARY = /\b(can['’]?t|cannot|can not|don['’]?t|won['’]?t)\b[^.?]*\b(advise|advice|recommend|help with)\b/i;
// The fixed line when you ask about medicine, supplements, diet numbers or weight (code, not the AI)
export const MEDICAL_LINE = 'I can’t advise on medicines, supplements, diets or weight; a doctor or pharmacist can.';

export const chatMsgs = (state) => state.notes?.[CHAT_ID]?.msgs || [];
// your messages sent today (the daily limit; the server checks it too)
export const sentToday = (state, day) => chatMsgs(state).filter((m) => m.from === 'you' && m.day === day && !m.local).length;
export const leftToday = (state, day) => Math.max(0, CHAT_PER_DAY - sentToday(state, day));

const SYSTEM = `You are Hermes, the practical helper inside Odyssey, a habit and task app. The person tells you what's going on; you answer briefly and propose concrete changes they can accept with one tap.
Rules: only use what the facts, their messages, their notes or Athena's memory support; never give medical, medicine, supplement, diet-number or weight advice, and never suggest nicotine products or medicines to quit (say you can't advise on that, then offer help with the routine around it); cutting down smoking, scrolling or snacking is a habit in this app, so help with its routine freely; never shame; don't diagnose or comment on their mental health.
Write to them ("you"), plainly, warmly, no exclamation marks, no emoji. Every number you write must appear in the facts or their messages, or be one you set in an idea (a time, a target, minutes, a date). Reply with JSON only.`;

const TASK = `Answer their message in 1 to 3 short sentences (under 60 words): what you'd do about it, from their facts. Then propose 0 to 3 changes that would help with what they said, best first; none if they're only chatting or nothing would help.
If they say something lasting about themselves (a schedule, a pattern, what works for them) that isn't already in Athena's memory, put it in "remember" as one short line written to them (under 15 words); else null.
Kinds (use only the ids in "valid"; set every field the kind doesn't use to null):
- pause_days {from: "YYYY-MM-DD", until: "YYYY-MM-DD"}: pause all habits for a trip or illness (no penalties, streak kept); from today on, at most 14 days
- plan_session {taskId, at: "today HH:MM" | "tomorrow HH:MM", minutes 15-120}: a reminder to start a task (the day and time go in "at")
- move_task {taskId, to: "today" | "tomorrow" | "later"}
- set_cue {goalId, time "HH:MM"}: a daily reminder for a habit
- set_days {goalId, days: [0-6, Sunday = 0]}: fixed days for a days-a-week habit this week and after
- shrink_habit {goalId, tiny}: a smaller version that still counts (under 10 words)
- set_target {goalId, target}: only if they ask for it, changed by at most 2 for days a week, or at most half otherwise
- try {text, check, goalId}: a small change the app can't set (phone out of the bedroom); "text" under 12 words; "check" the yes/no question asked each evening (under 10 words)
For each: title (under 8 words), why (1 or 2 short lines, each under 18 words, from the facts or their words), hour ("HH:MM" or null).
At most one idea per habit or task. If "pausedNow" is set, they're already paused: say until when, and don't propose pause_days. Don't make a habit smaller or easier while it's on target. If "hardWeek" is true, only make things easier. Never repeat anything in "triedOrDeclined".
Return {"reply": "...", "ideas": [{"kind", "title", "why", "goalId", "taskId", "time", "days", "target", "tiny", "to", "at", "minutes", "text", "check", "from", "until", "hour"}], "remember": "..." | null}.`;

// → { kind: 'chat', model, messages, input, valid, wk, day, idPrefix } | { fixed: text } (crisis: no AI) | null
export function chatRequest(state, day, hour, text, { model = 'gpt-5.6-luna', now = Date.now() } = {}) {
  const msg = String(text || '').trim().slice(0, 500);
  if (!msg) return null;
  if (crisisIn(msg)) return { fixed: CRISIS_LINE };
  const base = hermesBase(state, day);
  const recent = chatMsgs(state).filter((m) => m.at > now - 2 * 864e5 && !m.local).slice(-RECENT).map((m) => ({ from: m.from, text: m.text }));
  const tried = history(state, day).map((h) => ({ title: h.idea.title, kind: h.idea.kind, outcome: h.outcome || 'on trial' }));
  const input = {
    message: msg, earlierMessages: recent, today: day, weekday: base.facts.weekday, timeNow: `${String(hour).padStart(2, '0')}:00`,
    askedAboutMedicine: MEDICAL.test(msg), pausedNow: (() => { const p = pauseOn(state, day); return p ? { from: p.startDay, until: p.endDay || 'until you end it' } : null; })(), facts: base.facts, hardWeek: base.hardWeek, eveningNotes: notesForHermes(state, day).slice(0, 3),
    memory: memoryFacts(state), triedOrDeclined: tried, valid: base.valid,
  };
  return {
    kind: 'chat', model, wk: weekKeyOf(day), day, idPrefix: `c${now.toString(36)}-`, input, valid: base.valid,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ task: TASK, ...input }) }],
  };
}

// The answer, checked → { reply, ideas, remember } | null (rejected: the phone says it couldn't answer)
export function parseChat(req, raw, state, day) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!j || typeof j.reply !== 'string') return null;
  let reply = clean(j.reply);
  if (!reply || words(reply) > 75 || THIRD.test(reply) || crisisIn(reply) || /[\u{1F300}-\u{1FAFF}]/u.test(reply)) return null;
  // no medical talk, except saying it can't advise (the fixed line goes first when they asked)
  const sentences = reply.split(/(?<=[.?])\s+/);
  if (sentences.some((x) => MEDICAL.test(x) && !BOUNDARY.test(x))) return null;
  if (req.input.askedAboutMedicine) reply = [MEDICAL_LINE, ...sentences.filter((x) => !BOUNDARY.test(x))].join(' ').trim();
  // numbers from the facts, their messages, or the ideas' own values
  const allowed = numbersIn(req.input);
  const ideasRaw = Array.isArray(j.ideas) ? j.ideas : [];
  const own = new Set(ideasRaw.flatMap((i) => [i?.time, i?.target, i?.minutes, i?.at, i?.from, i?.until, ...(i?.days || [])]).filter((v) => v != null).flatMap((v) => String(v).match(/\d+/g) || []));
  if ((reply.match(/\d+(?:\.\d+)?/g) || []).some((v) => !allowed.has(v) && !own.has(v))) return null;
  const ideas = (parseHermes(req, { ideas: ideasRaw }, state, day) || []).map((i) => ({ ...i, chat: true, wk: req.wk }));
  let remember = typeof j.remember === 'string' ? clean(j.remember) : null;
  if (remember && (words(remember) > 16 || MEDICAL.test(remember) || crisisIn(remember) || THIRD.test(remember))) remember = null;
  return { reply, ideas, remember: remember || null };
}

// The phone saves your message and Hermes' answer together (it's the note's only writer) → the notes patch
export function withMessages(state, add, now = Date.now()) {
  const keep = chatMsgs(state).filter((m) => m.at > now - KEEP_DAYS * 864e5);
  const note = { id: CHAT_ID, kind: 'hermes', msgs: [...keep, ...add], at: now };
  return { notes: { ...(state.notes || {}), [CHAT_ID]: note } };
}

// A Remember tapped or dismissed, on that message
export function markRemember(state, msgId, outcome, now = Date.now()) {
  const msgs = chatMsgs(state).map((m) => (m.id === msgId ? { ...m, rememberDone: outcome } : m));
  return { notes: { ...(state.notes || {}), [CHAT_ID]: { ...(state.notes?.[CHAT_ID] || { id: CHAT_ID, kind: 'hermes' }), msgs, at: now } } };
}
