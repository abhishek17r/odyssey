// Hermes proposals (docs/brain.md, H1a): up to 3 ideas a week for your life, picked by the AI from your last week,
// your evening notes and Athena's memory; each checked by code, shown with its reasons and exactly what would
// change, and applied only when you accept. An accepted idea is a 7-day trial; then "Did it help?" compares the
// habit it was for, before and during, from your logs (code, never the AI): keep it, or drop it (undone).
// Pure: shared by the app, the server function and the tests.
//
// Two synced notes a week, so a rebuild never touches your answers:
//   notes['ai-hermes-<wk>'] (the server): { ideas: [idea], for, model, at }
//   notes['hermes-<wk>']    (the phone):  { decisions: { ideaId: 'notnow' | 'accepted' }, trials: { ideaId: trial } }
// idea:  { id, kind, title, why: [..], goalId?, taskId?, time?, days?, target?, tiny?, to?, at?, minutes?, text?, check?, hour? }
// trial: { idea, start, end, undo, ticks: { day: true|false }, outcome: null | 'kept' | 'dropped' | 'stopped', at }

import { dateKey, addDays, parseKey, weekKeyOf, weekDays, planOf, metricKey, isPaused } from './score.js';
import { digest, numbersIn } from './digest.js';
import { adherence, kindOf } from './engine.js';
import { crisisIn } from './safety.js';
import { memoryFacts } from './memory.js';
import { lowWeek } from './quests.js';
import { HOUR_SLOTS } from './playbooks.js';

export const KINDS = ['plan_session', 'set_cue', 'set_target', 'set_days', 'shrink_habit', 'move_task', 'try', 'pause_days'];
// changes that aren't habits to measure: no 7-day trial and no "Did it help?" (a trip's pause, a task moved)
export const NO_FOLLOW_UP = ['pause_days', 'move_task'];
export const TRIAL_DAYS = 7;
export const COOLDOWN_DAYS = 30;
const MIN_LOGGED_DAYS = 3; // …over at least a week of history (many people log only the days it happened)

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/!+/g, '.').trim();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (k) => { const d = parseKey(k); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
const hhmm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const ampm = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };

export const ideasId = (wk) => `ai-hermes-${wk}`;
// a moment's idea (written the moment something happens, at most one a day): notes['ai-hermes-now-<day>']
export const momentId = (day) => `ai-hermes-now-${day}`;
export const answersId = (wk) => `hermes-${wk}`;
// a note in the last week that sounds like crisis: no ideas at all (the fixed safety line answers it)
export const crisisWeek = (state, day) => Array.from({ length: 7 }, (_, i) => shift(day, -i)).some((k) => crisisIn(state.days?.[k]?.reflection));
// a hard week (under 60% on track): ideas only make things easier, and none is pushed as a notification
export const hardWeek = (state, day) => lowWeek(state, day);
const historySince = (state, day, n) => Object.keys(state.days || {}).some((k) => k <= shift(day, -n) && Object.keys(state.days[k]?.values || {}).length);
const loggedDays = (state, day, n = 14) => Array.from({ length: n }, (_, i) => shift(day, -i)).filter((k) => Object.keys(state.days?.[k]?.values || {}).length).length;

// Every idea for a week: the weekly ones, then each day's moment
export function allIdeas(state, wk) {
  const moments = weekDays(wk).map((d) => state.notes?.[momentId(d)]?.ideas || []).flat();
  const chat = (state.notes?.['hermes-chat']?.msgs || []).flatMap((m) => m.ideas || []).filter((i) => i.wk === wk);
  return [...(state.notes?.[ideasId(wk)]?.ideas || []), ...moments, ...chat];
}

// Every answer and trial from the notes of the last few weeks (for cooldowns, the active trial, the follow-up).
export function history(state, day) {
  const out = [];
  for (const [id, n] of Object.entries(state.notes || {})) {
    if (!id.startsWith('hermes-') || !n) continue;
    for (const [ideaId, t] of Object.entries(n.trials || {})) out.push({ wk: n.wk, ideaId, ...t });
    for (const [ideaId, d] of Object.entries(n.decisions || {})) if (d === 'notnow') out.push({ wk: n.wk, ideaId, idea: allIdeas(state, n.wk).find((x) => x.id === ideaId), outcome: 'notnow', start: n.wk });
  }
  return out.filter((h) => h.idea && shift(h.start || h.wk, COOLDOWN_DAYS + TRIAL_DAYS) >= day);
}
const sameIdea = (a, b) => a.kind === b.kind && (a.goalId || a.taskId || a.text) === (b.goalId || b.taskId || b.text);

// This week's ideas still to answer (skips what you've answered, what's on trial, and what's in its cooldown).
export function openIdeas(state, day) {
  const wk = weekKeyOf(day);
  const today = state.notes?.[momentId(day)]?.ideas || []; // today's moment comes first
  const ideas = [...today, ...allIdeas(state, wk).filter((i) => !today.includes(i))];
  const ans = state.notes?.[answersId(wk)] || {};
  const past = history(state, day);
  return ideas.filter((i) => !i.chat && !ans.decisions?.[i.id] && !ans.trials?.[i.id]
    && !past.some((h) => h.wk !== wk && sameIdea(h.idea, i) && (!h.outcome || ['notnow', 'dropped', 'stopped'].includes(h.outcome)))
    && isValid(state, i, day));
}
export const activeTrials = (state, day) => history(state, day).filter((h) => h.start && !h.outcome && day <= h.end && !NO_FOLLOW_UP.includes(h.idea.kind));
export const dueFollowUps = (state, day) => history(state, day).filter((h) => h.start && !h.outcome && day > h.end && !NO_FOLLOW_UP.includes(h.idea.kind));
// what Hermes changed and you can still undo: running trials, and the changes that have none (a pause, a task moved)
export const undoable = (state, day) => history(state, day).filter((h) => h.start && !h.outcome && (day <= h.end || NO_FOLLOW_UP.includes(h.idea.kind)));

// ---------- the request ----------

const SYSTEM = `You are Hermes, the practical helper inside Odyssey, a habit and task app. Athena is the coach who talks; you propose concrete changes the person can accept with one tap.
Rules: only propose what the facts, their evening notes or Athena's memory clearly support; never give medical, diet-number, supplement or smoking-cessation advice; nothing about weight or body shape; never shame.
Write to them ("you"), plainly, no exclamation marks, no emoji. Every number you write must appear in the facts, or be one you set in the idea itself (a time, a target, minutes). Reply with JSON only.`;

const TASK = `Propose up to 3 ideas for this week that would most help, best first. Fewer is better: if things are going well, return {"ideas": []}.
Look across habits, tasks and their notes for a cause, not just a number: e.g. snacking and scrolling both slipping at midday → a midday walk that also counts for Walking; their note says work should move to mornings so gym fits → a morning work block and an evening gym reminder.
Kinds (use only the ids in "valid"; set every field the kind doesn't use to null):
- plan_session {taskId, at: "today HH:MM" | "tomorrow HH:MM", minutes 15-120}: a reminder to start a task at a time (the day and time go in "at", not "time")
- set_cue {goalId, time "HH:MM"}: a daily reminder for a habit at that time
- set_target {goalId, target}: an easier target only when the habit's "weeksShortBefore" is 2 or more (or, after steady weeks, one harder target), changed by at most 2 for days a week, or at most half otherwise; for a limit (type "cut") easier means a higher limit
- set_days {goalId, days: [0-6, Sunday = 0]}: fixed days for a days-a-week habit
- shrink_habit {goalId, tiny}: a smaller version that still counts (under 10 words)
- move_task {taskId, to: "today" | "tomorrow" | "later"}
- try {text, check, goalId}: a small change to their day that the app can't set for them (phone out of the bedroom, lunch away from the desk); "text" under 12 words; "check" is the yes/no question asked each evening (under 10 words); goalId = the habit it should help, or null
For each: title (under 8 words), why (1 to 3 short lines, each under 18 words, from the facts or their own words; quote their note when you use it), hour ("HH:MM", the time of day the problem happens, for a reminder then; or null).
Prefer making the habit easier to do (a reminder at the right time, a smaller starting version, fixed days) over lowering what counts; a short week alone is not a reason to lower a target. If everything is on target, return at most one idea. At most one idea per habit or task. If "hardWeek" is true, only make things easier (a smaller target or start, a better time, room in the week): never raise a target.
Never repeat anything in "triedOrDeclined". Return {"ideas": [{"kind", "title", "why", "goalId", "taskId", "time", "days", "target", "tiny", "to", "at", "minutes", "text", "check", "hour"}]}.`;

// full weeks in a row before this one, newest first, under 60% on track (up to 4)
export function weeksShort(state, day, id) {
  let n = 0;
  for (let w = 1; w <= 4; w++) {
    const days = weekDays(shift(weekKeyOf(day), -7 * w));
    const g = planOf(days[0], state)?.goals.find((x) => x.id === id);
    const r = g ? adherence(state, g, days) : null;
    if (r == null || r >= 0.6) break;
    n++;
  }
  return n;
}
export const SHORT_WEEKS = 2; // an easier target only after this many short weeks in a row

function factsFor(state, day) {
  const d = digest(state, day);
  const habits = d.habits.map(({ id, name, playbook, type, unit, target, thisWeek, run, mostOftenAt, triggers, tiny }) => {
    const g = planOf(day, state)?.goals.find((x) => x.id === id);
    return { id, name, playbook, type, unit, target, thisWeek, run, slipsMostOftenAt: mostOftenAt, triggers, startingVersion: tiny, reminderAt: g?.cueTime || null, fixedDays: g?.metrics?.[0]?.days?.length ? g.metrics[0].days : null, weeksShortBefore: weeksShort(state, day, id) };
  });
  const tasks = d.tasks.list.map(({ id, title, due, sizeH, weeksCarried }) => ({ id, title, due, sizeH, weeksCarried }));
  const lastWeek = weekDays(shift(weekKeyOf(day), -7));
  const lastWeekKept = habits.map((h) => { const g = planOf(lastWeek[0], state)?.goals.find((x) => x.id === h.id); const r = g ? adherence(state, g, lastWeek) : null; return r == null ? null : { name: h.name, percentOnTrack: Math.round(r * 100) }; }).filter(Boolean);
  return { day, weekday: d.weekday, habits, lastWeekKept, tasks, focus: d.focus && { minutesThisWeek: d.focus.minutesThisWeek, usualMinutesBeforeStarting: d.focus.usualMinutesBeforeStarting, mainReasonForDelay: d.focus.mainReasonForDelay, longestSessionsAt: d.focus.bestTimeOfDay } };
}

function notesOf(state, day) {
  return Array.from({ length: 10 }, (_, i) => shift(day, -i)).map((k) => ({ day: k, text: String(state.days?.[k]?.reflection || '').trim() }))
    .filter((n) => n.text && !crisisIn(n.text)).slice(0, 6).map((n) => ({ ...n, text: n.text.slice(0, 400) }));
}

// shared with the chat (lib/hermesChat.js)
export const factsForHermes = (state, day) => factsFor(state, day);
export const notesForHermes = (state, day) => notesOf(state, day);
export function hermesBase(state, day) {
  const facts = factsFor(state, day);
  return { facts, valid: { goalIds: facts.habits.map((h) => h.id), taskIds: facts.tasks.map((t) => t.id) }, hardWeek: hardWeek(state, day) };
}

// → { kind: 'hermes', model, messages, noteId, wk, input, valid, forHash } | null
export function hermesRequest(state, day, { model = 'gpt-5.6-luna', force = false } = {}) {
  if (state.settings?.athenaOn === false || state.settings?.hermesOn === false) return null;
  if (isPaused(state, day) || crisisWeek(state, day)) return null; // never while paused, or after a note that sounds like crisis
  if (loggedDays(state, day, 28) < MIN_LOGGED_DAYS || !historySince(state, day, 7)) return null;
  const wk = weekKeyOf(day);
  const have = state.notes?.[ideasId(wk)];
  if ((have?.ideas || (have?.tries || 0) >= 2) && !force) return null; // once a week (two tries); your answers stay in their own note
  const facts = factsFor(state, day);
  const valid = { goalIds: facts.habits.map((h) => h.id), taskIds: facts.tasks.map((t) => t.id) };
  const tried = history(state, day).map((h) => ({ title: h.idea.title, kind: h.idea.kind, outcome: h.outcome || 'on trial' }));
  const hard = hardWeek(state, day);
  const input = { facts, hardWeek: hard, eveningNotes: notesOf(state, day), memory: memoryFacts(state), triedOrDeclined: tried, valid };
  const user = JSON.stringify({ task: TASK, ...input });
  return { kind: 'hermes', model, noteId: ideasId(wk), wk, input, valid, forHash: hash(`${wk}|${user}`), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] };
}

// ---------- moments: something just happened, so one idea now ----------
// Code spots the moment; the AI writes one idea for it; code checks it like any other. At most one a day,
// three a week, the same moment not again for a week; daytime only (8 am to 9 pm); never paused or after a crisis note.

export const MOMENT_HOURS = [8, 21];
export const MOMENTS_A_WEEK = 3;
const INTENT = /\b(need to|needs to|should|want to|have to|i'll|i will|going to|must|try to|plan to|from tomorrow|next week)\b/i;

// What's happening that an idea could help with now, most pressing first → [{ type, key, goalId?, taskId?, what }]
export function momentsNow(state, day, hour, now = Date.now()) {
  if (hour < MOMENT_HOURS[0] || hour >= MOMENT_HOURS[1]) return [];
  const facts = factsFor(state, day);
  const plan = planOf(day, state);
  const out = [];
  // a task due within 2 days, an hour or more of work, with no start planned
  for (const t of facts.tasks) {
    const tk = state.tickets?.[t.id]; const due = tk?.due; // the date (the facts say "today", "tomorrow")
    if (!due || due < day || due > shift(day, 2) || (t.sizeH || 0) < 1 || (tk?.remindAt && tk.remindAt > now - 864e5)) continue;
    out.push({ type: 'deadline', key: `task:${t.id}`, taskId: t.id, what: `“${t.title}” is due ${due === day ? 'today' : due === shift(day, 1) ? 'tomorrow' : 'in 2 days'}, about ${t.sizeH} h of work, and no start is planned.` });
  }
  // the hour a limit usually slips (an hour before, until it starts), after 2 or more days over this week
  for (const h of facts.habits) {
    if (h.type !== 'cut' || !h.slipsMostOftenAt || (h.thisWeek?.daysOverLimit || 0) < 2) continue;
    const slot = HOUR_SLOTS.find(([, , l]) => l.toLowerCase() === h.slipsMostOftenAt);
    if (slot && hour >= slot[0] - 1 && hour < slot[0] + 1) out.push({ type: 'slip', key: `slip:${h.id}`, goalId: h.id, what: `${h.name} usually slips in the ${h.slipsMostOftenAt === 'late' ? 'late evening' : h.slipsMostOftenAt}, which starts soon; over the limit on ${h.thisWeek.daysOverLimit} days this week.` });
  }
  // a habit missed the last 2 days when the week needs nearly every day left
  for (const h of facts.habits) {
    const g = plan?.goals.find((x) => x.id === h.id); const m = g?.metrics?.[0];
    if (!m || m.kind !== 'daysPerWeek' || h.type === 'cut' || !h.thisWeek) continue;
    const k = metricKey(g, m);
    const missed = [1, 2].every((n) => state.days?.[shift(day, -n)]?.values?.[k] !== true);
    const { stillNeeded, daysLeft } = h.thisWeek;
    if (missed && stillNeeded > 0 && stillNeeded >= daysLeft - 1 && stillNeeded <= daysLeft && historySince(state, day, 3)) {
      out.push({ type: 'missed', key: `habit:${h.id}`, goalId: h.id, what: `${h.name} was missed yesterday and the day before; ${stillNeeded} still needed with ${daysLeft} days left.` });
    }
  }
  // last night's (or today's) note asks for a change
  for (const k of [day, shift(day, -1)]) {
    const text = String(state.days?.[k]?.reflection || '');
    if (text && INTENT.test(text) && !crisisIn(text)) { out.push({ type: 'note', key: `note:${k}`, what: `Your note: “${text.slice(0, 300)}”` }); break; }
  }
  // not one that's been acted on lately, or that an idea this week already covers
  const wk = weekKeyOf(day);
  const recent = Array.from({ length: 7 }, (_, n) => state.notes?.[momentId(shift(day, -n))]?.moment?.key).filter(Boolean);
  const covered = allIdeas(state, wk);
  const first = ['slip', 'deadline', 'missed', 'note']; // the slip window is short, so it goes first
  return out.sort((a, b) => first.indexOf(a.type) - first.indexOf(b.type)).filter((m) => !recent.includes(m.key) && !covered.some((i) => (m.goalId && i.goalId === m.goalId) || (m.taskId && i.taskId === m.taskId)));
}

const MOMENT_TASK = `Something has just happened (see "moment"). Propose exactly one idea that would help with it today, or {"ideas": []} if nothing would.
If the moment names a habit (goalId) or task (taskId), the idea must be about that one. Prefer the smallest change that helps now: a start time today, a reminder before the usual slip, a smaller starting version, or something to try.
The "why" lines say what just happened, in plain words, from the facts or their note. Same kinds, fields and rules as below.
`;

// → { kind: 'moment', model, messages, noteId, wk, day, moment, input, valid, forHash } | null
export function momentRequest(state, day, hour, { model = 'gpt-5.6-luna', now = Date.now() } = {}) {
  if (state.settings?.athenaOn === false || state.settings?.hermesOn === false) return null;
  if (isPaused(state, day) || crisisWeek(state, day)) return null;
  if (loggedDays(state, day, 28) < MIN_LOGGED_DAYS || !historySince(state, day, 7)) return null;
  if (state.notes?.[momentId(day)]) return null; // one a day (a rejected answer counts)
  const wk = weekKeyOf(day);
  if (weekDays(wk).filter((d) => state.notes?.[momentId(d)]?.ideas?.length).length >= MOMENTS_A_WEEK) return null;
  const mo = momentsNow(state, day, hour, now)[0];
  if (!mo) return null;
  const facts = factsFor(state, day);
  const valid = { goalIds: facts.habits.map((h) => h.id), taskIds: facts.tasks.map((t) => t.id) };
  const tried = history(state, day).map((h) => ({ title: h.idea.title, kind: h.idea.kind, outcome: h.outcome || 'on trial' }));
  const input = { moment: { what: mo.what, goalId: mo.goalId || null, taskId: mo.taskId || null }, timeNow: `${String(hour).padStart(2, '0')}:00`, facts, hardWeek: hardWeek(state, day), eveningNotes: notesOf(state, day).slice(0, 2), memory: memoryFacts(state), triedOrDeclined: tried, valid };
  const user = JSON.stringify({ task: MOMENT_TASK + TASK.replace(/^Propose up to 3[^\n]*\n/, ''), ...input });
  return { kind: 'moment', model, noteId: momentId(day), wk, day, moment: { type: mo.type, key: mo.key, what: mo.what }, input, valid, forHash: hash(`${day}|${mo.key}`), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] };
}

const hash = (s) => [...String(s || '')].reduce((h, c) => ((h * 33) ^ c.charCodeAt(0)) >>> 0, 5381).toString(36);

// ---------- checks ----------

export const MEDICAL = /\b(nicotine|melatonin|pills?|tablets?|drugs?|vitamins?|magnesium|ashwagandha|creatine|caffeine pills?|antidepressants?|painkillers?|ibuprofen|paracetamol|doses?|patch(es)?|gum|varenicline|bupropion|medication|medicine|supplement\w*|prescri\w+|dosage|\d+\s?mg|calories?|kcal|kg|kilos?|lbs?|bmi|keto|fasting|diet|weight|diagnos\w+|disorder|depress\w*|anxiety|adhd|addict\w*|withdrawal|cure|therap\w+)\b/i;
const DAYS = /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/gi;

// Is this idea still something the app can apply? (ids exist, values in range, the task still open …)
// a new target that asks more: a higher number, or for a limit a lower one
const harder = (m, n) => !!m && (m.kind === 'perDayMax' ? Number(n) < Number(m.target) : Number(n) > Number(m.target));

export function isValid(state, i, day) {
  const g = i.goalId ? planOf(day, state)?.goals.find((x) => x.id === i.goalId) : null;
  const m = g?.metrics?.[0];
  const t = i.taskId ? state.tickets?.[i.taskId] : null;
  switch (i.kind) {
    case 'plan_session': return !!t && t.status !== 'done' && /^(today|tomorrow) ([01]\d|2[0-3]):[0-5]\d$/.test(i.at || '') && Number(i.minutes) >= 15 && Number(i.minutes) <= 120;
    case 'set_cue': return !!g && hhmm(i.time);
    case 'set_target': {
      const n = Number(i.target);
      if (!m || !Number.isFinite(n) || n < 1 || n === Number(m.target)) return false;
      if (m.kind === 'daysPerWeek') return n <= 7 && Math.abs(n - m.target) <= 2;
      return n > 0 && Math.abs(n - m.target) <= Math.max(1, m.target * 0.5);
    }
    case 'set_days': return !!m && m.kind === 'daysPerWeek' && Array.isArray(i.days) && i.days.length >= 1 && i.days.length <= 7 && new Set(i.days).size === i.days.length && i.days.every((x) => Number.isInteger(x) && x >= 0 && x <= 6);
    case 'shrink_habit': return !!g && !!i.tiny && words(i.tiny) <= 10;
    case 'move_task': return !!t && t.status !== 'done' && ['today', 'tomorrow', 'later'].includes(i.to);
    case 'pause_days': return /^\d{4}-\d\d-\d\d$/.test(i.from || '') && /^\d{4}-\d\d-\d\d$/.test(i.until || '') && i.from >= day && i.until >= i.from && i.until <= shift(day, 21) && i.until <= shift(i.from, 13) && !(state.pauses || []).some((p) => p.startDay <= i.until && (!p.endDay || p.endDay >= i.from));
    case 'try': return !!i.text && words(i.text) <= 14 && !!i.check && words(i.check) <= 12 && !/\b(I|me|my|I'm)\b/.test(i.check) && (!i.goalId || !!g);
    default: return false;
  }
}

// The model's answer → the ideas that pass (each checked on its own; a bad one is dropped, not the rest) | null
export function parseHermes(req, raw, state, day) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!j || !Array.isArray(j.ideas)) return null;
  const allowed = numbersIn(req.input);
  const src = JSON.stringify(req.input).toLowerCase();
  const out = [];
  const mo = req.input.moment;
  for (const [n, x] of j.ideas.slice(0, mo ? 1 : 3).entries()) {
    const i = {
      id: req.idPrefix ? `${req.idPrefix}${n + 1}` : mo ? `${req.day}-m${n + 1}` : `${req.wk}-${n + 1}`, kind: x?.kind, title: clean(x?.title), why: (Array.isArray(x?.why) ? x.why : []).map(clean).filter(Boolean).slice(0, 3),
      goalId: x?.goalId || null, taskId: x?.taskId || null, hour: hhmm(x?.hour) ? x.hour : null,
    };
    if (i.goalId && !req.valid.goalIds.includes(i.goalId)) continue;
    if (i.taskId && !req.valid.taskIds.includes(i.taskId)) continue;
    for (const k of ['time', 'days', 'target', 'tiny', 'to', 'at', 'minutes', 'text', 'check', 'from', 'until']) if (x?.[k] != null) i[k] = typeof x[k] === 'string' ? clean(x[k]) : x[k];
    if (i.kind === 'plan_session' && !i.at && /^(today|tomorrow) /.test(i.time || '')) { i.at = i.time; delete i.time; } // the day and time put in the wrong field
    if (mo && ((mo.goalId && i.goalId !== mo.goalId && !(i.kind === 'try' && !i.goalId)) || (mo.taskId && i.taskId !== mo.taskId))) continue; // about the moment, not something else
    if (!KINDS.includes(i.kind) || !i.title || words(i.title) > 9 || !i.why.length || i.why.some((w) => words(w) > 22)) continue;
    const own = new Set([i.time, i.target, i.minutes, i.at, i.hour, i.from, i.until, ...(i.days || [])].filter((v) => v != null).flatMap((v) => String(v).match(/\d+/g) || []));
    const texts = [i.title, ...i.why, i.tiny, i.text, i.check].filter(Boolean);
    if (texts.some((s) => MEDICAL.test(s) || crisisIn(s) || /[\u{1F300}-\u{1FAFF}]/u.test(s))) continue;
    if (texts.some((s) => (s.match(/\d+(?:\.\d+)?/g) || []).some((v) => !allowed.has(v) && !own.has(v)))) continue;
    if (texts.some((s) => (s.match(DAYS) || []).some((d) => !src.includes(d.toLowerCase())))) continue;
    if (state && !isValid(state, i, day)) continue;
    if (state && req.input.hardWeek && i.kind === 'set_target' && harder(planOf(day, state)?.goals.find((x) => x.id === i.goalId)?.metrics[0], i.target)) continue; // a hard week: never harder
    if (i.kind === 'set_target' && state) { // an easier target only after weeks short, not to match a slow week
      const m = planOf(day, state)?.goals.find((x) => x.id === i.goalId)?.metrics[0];
      const h = req.input.facts.habits.find((x) => x.id === i.goalId);
      if (!harder(m, i.target) && (h?.weeksShortBefore ?? 0) < SHORT_WEEKS) continue;
    }
    if (state && history(state, day).some((h) => sameIdea(h.idea, i))) continue; // tried or declined lately
    if (out.some((o) => sameIdea(o, i))) continue;
    out.push(i);
  }
  return out;
}

// ---------- what it would change (code writes this, not the AI) ----------

export function changeText(state, i, day) {
  const g = i.goalId ? planOf(day, state)?.goals.find((x) => x.id === i.goalId) : null;
  const t = i.taskId ? state.tickets?.[i.taskId] : null;
  switch (i.kind) {
    case 'plan_session': { const [when, time] = i.at.split(' '); return `a reminder to start “${t?.title}” ${when} at ${ampm(time)}, for ${i.minutes} minutes.`; }
    case 'set_cue': return `${g?.name} reminds you every day at ${ampm(i.time)}${g?.cueTime ? ` (instead of ${ampm(g.cueTime)})` : ''}.`;
    case 'set_target': return `${g?.name}'s target goes from ${g?.metrics[0].target} to ${i.target}${g?.metrics[0].kind === 'daysPerWeek' ? ' days a week' : ` ${g?.metrics[0].unit || ''}`.trimEnd()}, for this trial.`;
    case 'set_days': return `${g?.name} is planned on ${i.days.slice().sort().map((d) => DOW[d]).join(', ')}.`;
    case 'shrink_habit': return `${g?.name}'s starting version becomes “${i.tiny}”.`;
    case 'move_task': return `“${t?.title}” moves to ${i.to === 'later' ? 'later (no date)' : i.to}.`;
    case 'pause_days': return `your habits are paused from ${dayLabel(i.from)} to ${dayLabel(i.until)}: no penalties, and your streak is kept.`;
    case 'try': return `nothing in the app changes. Each evening for ${TRIAL_DAYS} days, one question: “${i.check}”`;
    default: return '';
  }
}

// "Change it": the idea with your time or number, its title following along
export function withChange(i, value) {
  const x = { ...i };
  const timeRe = /\b\d{1,2}(:\d\d)?\s?(am|pm)\b/i;
  if (i.kind === 'set_target') { x.title = i.title.replace(new RegExp(`\\b${i.target}\\b`), String(value)); x.target = Number(value); return x; }
  if (i.kind === 'set_cue') x.time = value;
  else if (i.kind === 'plan_session') x.at = `${i.at.split(' ')[0]} ${value}`;
  x.title = i.title.replace(timeRe, ampm(value));
  return x;
}

// ---------- accept, undo, follow-up ----------

const atMs = (day, at) => { const [when, time] = at.split(' '); const d = parseKey(when === 'tomorrow' ? shift(day, 1) : day); const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };

// Apply an accepted idea to (a copy of) the state → { patch: the keys to save, undo }
export function applyIdea(state, i, day) {
  const wk = weekKeyOf(day);
  const goalEdit = (fn) => {
    const weeks = structuredClone(state.weeks);
    let before = null;
    for (const k of Object.keys(weeks).filter((x) => x >= wk)) {
      const g = weeks[k].goals.find((x) => x.id === i.goalId);
      if (!g) continue;
      if (before == null) before = structuredClone(g);
      fn(g);
    }
    return { patch: { weeks }, undo: { goal: i.goalId, from: wk, before } };
  };
  switch (i.kind) {
    case 'set_cue': return goalEdit((g) => { g.cueTime = i.time; });
    case 'set_target': return goalEdit((g) => { g.metrics[0].target = Number(i.target); if (g.metrics[0].days?.length > i.target) g.metrics[0].days = g.metrics[0].days.slice(0, i.target); });
    case 'set_days': return goalEdit((g) => { g.metrics[0].days = i.days.slice().sort(); g.metrics[0].target = i.days.length; });
    case 'shrink_habit': return goalEdit((g) => { g.tiny = i.tiny; });
    case 'plan_session': case 'move_task': {
      const t = state.tickets[i.taskId];
      const next = { ...t };
      if (i.kind === 'plan_session') { next.remindAt = atMs(day, i.at); next.planMin = Number(i.minutes); }
      else if (i.to === 'later') next.due = null;
      else next.due = i.to === 'today' ? day : shift(day, 1);
      return { patch: { tickets: { ...state.tickets, [t.id]: next } }, undo: { ticket: t.id, before: { remindAt: t.remindAt ?? null, planMin: t.planMin ?? null, due: t.due ?? null } } };
    }
    case 'pause_days': {
      const p = { id: `hermes-${i.id}`, startDay: i.from, endDay: i.until, reason: 'Hermes' };
      return { patch: { pauses: [...(state.pauses || []), p] }, undo: { pause: p.id } };
    }
    case 'try': return { patch: {}, undo: null };
    default: return { patch: {}, undo: null };
  }
}

// Undo a change (only the fields Hermes changed; what you edited since in other fields stays)
export function undoPatch(state, undo) {
  if (!undo) return {};
  if (undo.pause) return { pauses: (state.pauses || []).filter((p) => p.id !== undo.pause) };
  if (undo.ticket) {
    const t = state.tickets?.[undo.ticket];
    return t ? { tickets: { ...state.tickets, [t.id]: { ...t, ...undo.before } } } : {};
  }
  if (undo.goal && undo.before) {
    const weeks = structuredClone(state.weeks);
    for (const k of Object.keys(weeks).filter((x) => x >= undo.from)) {
      const g = weeks[k].goals.find((x) => x.id === undo.goal);
      if (!g) continue;
      g.cueTime = undo.before.cueTime; if (g.cueTime == null) delete g.cueTime;
      g.tiny = undo.before.tiny;
      g.metrics[0] = { ...g.metrics[0], target: undo.before.metrics[0].target, days: undo.before.metrics[0].days };
    }
    return { weeks };
  }
  return {};
}

// Your answer to an idea → the notes patch (and the state patch when accepted)
export function answer(state, i, decision, day, now = Date.now()) {
  const wk = weekKeyOf(day);
  const id = answersId(wk);
  const note = structuredClone(state.notes?.[id] || { id, kind: 'hermes', wk, decisions: {}, trials: {} });
  note.decisions[i.id] = decision;
  let patch = {};
  if (decision === 'accepted') {
    const changed = changeText(state, i, day); // said before it's applied, so it reads right later
    const a = applyIdea(state, i, day);
    patch = a.patch;
    note.trials[i.id] = { idea: i, changed, start: day, end: shift(day, TRIAL_DAYS - 1), undo: a.undo, ticks: {}, outcome: null, at: now };
  }
  note.at = now;
  return { ...patch, notes: { ...(state.notes || {}), [id]: note } };
}

const trialNote = (state, h) => answersId(h.wk);
function setTrial(state, h, fn, now = Date.now()) {
  const id = trialNote(state, h);
  const note = structuredClone(state.notes[id]);
  fn(note.trials[h.ideaId]);
  note.at = now;
  return { notes: { ...state.notes, [id]: note } };
}
// a "try" idea's evening question: yes or no for a day
export const tick = (state, h, day, yes) => setTrial(state, h, (t) => { t.ticks[day] = !!yes; });
// keep it, drop it (undone), or stop it early (undone)
export function finish(state, h, outcome, now = Date.now()) {
  const notes = setTrial(state, h, (t) => { t.outcome = outcome; t.closedAt = now; }, now);
  return outcome === 'kept' ? notes : { ...undoPatch(state, h.undo), ...notes };
}

// Did it help? Before (the 7 days before it started) and during, from your logs.
export function followUp(state, h) {
  const before = Array.from({ length: TRIAL_DAYS }, (_, n) => shift(h.start, -TRIAL_DAYS + n));
  const during = Array.from({ length: TRIAL_DAYS }, (_, n) => shift(h.start, n));
  const rows = [];
  const g = h.idea.goalId ? planOf(h.start, state)?.goals.find((x) => x.id === h.idea.goalId) : null;
  if (g) {
    const a = adherence(state, g, before);
    const b = adherence(state, g, during);
    if (a != null || b != null) rows.push({ label: `${g.name}, on track`, before: a == null ? '–' : `${Math.round(a * 100)}%`, during: b == null ? '–' : `${Math.round(b * 100)}%`, better: b != null && (a == null || b > a) });
    const m = g.metrics[0];
    const k = metricKey(g, m);
    if (kindOf(g) !== 'yesno') {
      const avg = (ds) => { const v = ds.map((d) => state.days?.[d]?.values?.[k]).filter((x) => x != null).map(Number); return v.length ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10 : null; };
      const x = avg(before); const y = avg(during);
      if (x != null || y != null) rows.push({ label: `${g.name}, ${m.unit || 'amount'} a day`, before: x ?? '–', during: y ?? '–', better: x != null && y != null && (m.kind === 'perDayMax' ? y < x : y > x) });
    }
  }
  if (h.idea.kind === 'try') {
    const yes = Object.values(h.ticks || {}).filter(Boolean).length;
    rows.push({ label: h.idea.check.replace(/\?$/, ''), before: '', during: `${yes} of ${TRIAL_DAYS} days`, better: yes >= 4 });
  }
  const helped = rows.length ? rows.filter((r) => r.better).length >= Math.ceil(rows.length / 2) : null;
  return { rows, helped };
}

// What Athena remembers from a trial you kept (a line in "What works for you", written by code from the numbers)
export function keptLine(state, h) {
  const f = followUp(state, h);
  // the row that moved most clearly: a habit that improved, else the evening answers
  const r = f.rows.find((x) => x.better && x.before !== '' && x.before !== '–' && String(x.before) !== String(x.during)) || f.rows.find((x) => x.better && x.before === '');
  if (!r) return `${h.idea.title}.`;
  return r.before === '' ? `${h.idea.title}: kept on ${r.during} of the trial.` : `${h.idea.title}: ${r.label.toLowerCase()} went from ${r.before} to ${r.during}.`;
}
