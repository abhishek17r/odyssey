// Athena's memory (docs/brain.md, B2): a short profile of the person that persists across days and weeks, so
// every note is written knowing them. Pure: shared by the app, the server function and the tests.
//
// It lives in one synced note, notes.memory:
//   { id: 'memory', kind: 'memory', about: { text, from }, lines: [{ id, list, text, from, at }],
//     dropped: [text], off, useNotes, wk, for, tries, builtAt, model }
// lists: works (what helps you), doesnt (what gets in the way), commit (what you're working towards),
//        know (keep in mind: your schedule, an injury …), avoid (don't bring up: yours only).
// from: 'data' (Athena, from your logs), 'notes' (Athena, from your evening notes), 'you' (you wrote or edited it).
//
// Once a week the server rebuilds Athena's lines from the last four weeks (and your evening notes, if you allow
// it). Your own lines are never touched; a line you delete is remembered in `dropped` and never written again.

import { dateKey, addDays, parseKey, weekKeyOf, weekDays } from './score.js';
import { digest, numbersIn } from './digest.js';
import { crisisIn } from './safety.js';

export const MEMORY_ID = 'memory';
export const LISTS = {
  works: { title: 'What works for you', max: 6, ai: true },
  doesnt: { title: 'What gets in the way', max: 6, ai: true },
  commit: { title: 'What you’re working towards', max: 4, ai: true },
  know: { title: 'Keep in mind', max: 8, ai: true },
  avoid: { title: 'Don’t bring up', max: 6, ai: false },
};
export const ABOUT_WORDS = 60;
export const LINE_WORDS = 20;
const MIN_LOGGED_DAYS = 7;

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/!+/g, '.').trim();
const uid = () => Math.random().toString(36).slice(2, 9);

export const memoryOf = (state) => state?.notes?.[MEMORY_ID] || null;
export const memoryOff = (state) => !!memoryOf(state)?.off;
export const useNotes = (state) => memoryOf(state)?.useNotes !== false; // on unless you turn it off
export const linesIn = (m, list) => (m?.lines || []).filter((l) => l.list === list);

// What the jobs get: the memory as plain lists, or null (off, or nothing in it yet).
export function memoryFacts(state) {
  const m = memoryOf(state);
  if (!m || m.off) return null;
  const pick = (list) => linesIn(m, list).map((l) => l.text);
  const out = {
    about: m.about?.text || null,
    worksForThem: pick('works'), getsInTheWay: pick('doesnt'), workingTowards: pick('commit'), keepInMind: pick('know'), neverMention: pick('avoid'),
  };
  return out.about || Object.values(out).some((v) => Array.isArray(v) && v.length) ? out : null;
}

// An answer that brings up something on the "don't bring up" list is thrown away (unless the draft itself says it).
export function breaksAvoid(state, text, draftText = '') {
  const t = norm(text);
  const d = norm(draftText);
  return linesIn(memoryOf(state), 'avoid').some((l) => { const a = norm(l.text); return a.length >= 3 && t.includes(a) && !d.includes(a); });
}

// ---------- building it (the weekly job) ----------

const loggedDays = (state) => Object.values(state.days || {}).filter((d) => Object.keys(d?.values || {}).length).length;

// Weeks of logs in the last four (logged days ÷ 7, so 7 days across two calendar weeks is still one): under 2,
// there are no trends to see yet.
export function weeksOfData(state, day) {
  const n = Array.from({ length: 28 }, (_, i) => shift(day, -i)).filter((k) => Object.keys(state.days?.[k]?.values || {}).length).length;
  return Math.max(1, Math.floor(n / 7));
}

// The four weeks it's built from: this week's digest in full, the three before as what changed. With under two
// weeks of data, nothing that compares weeks (trends, "usual", the 4 weeks before) is sent: it would be noise.
function weeksOf(state, day) {
  const d = digest(state, day);
  const n = weeksOfData(state, day);
  const early = n < 2;
  const habits = d.habits.map(({ name, playbook, type, target, unit, thisWeek, run, averagePerDay, last4Weeks, trend, mostOftenAt, triggers, tiny }) =>
    ({ name, playbook, type, target, unit, thisWeek, run, averagePerDay: early ? undefined : averagePerDay, last4Weeks: early ? undefined : last4Weeks,
      trend: early ? undefined : trend, slipsMostOftenAt: mostOftenAt, triggers, startingVersion: tiny }));
  const before = [1, 2, 3].map((k) => {
    const wk = shift(weekKeyOf(day), -7 * k);
    if (!weekDays(wk).some((x) => Object.keys(state.days?.[x]?.values || {}).length)) return null;
    const p = digest(state, weekDays(wk)[6]);
    return { weekEnding: weekDays(wk)[6], changes: p.changes, habits: p.habits.map((h) => ({ name: h.name, thisWeek: h.thisWeek })) };
  }).filter(Boolean);
  const tasks = { open: d.tasks.open, doneThisWeek: d.tasks.doneThisWeek, hours: d.tasks.hours, carried: d.tasks.list.filter((t) => t.weeksCarried >= 2).map((t) => ({ title: t.title, weeksCarried: t.weeksCarried })) };
  // bestTimeOfDay is when sessions run longest, not when work starts fastest: named so it isn't misread
  const f = d.focus && { minutesThisWeek: d.focus.minutesThisWeek, usualMinutesBeforeStarting: d.focus.usualMinutesBeforeStarting, mainReasonForDelay: d.focus.mainReasonForDelay,
    ...(early ? {} : { usualMinutesPerWeek: d.focus.usualMinutesPerWeek, longestSessionsAt: d.focus.bestTimeOfDay }) };
  return { weeksOfData: n, thisWeek: { day, habits, tasks, focus: f, changes: early ? [] : d.changes, paused: d.paused }, weeksBefore: before };
}

// Your own words it may learn from: goals you set, and (if allowed) the last two weeks of evening notes.
function yourWords(state, day) {
  const goals = Object.values(state.profile?.visions || {}).map((v) => ({ goal: v.text, planAround: v.around || null, daysAWeek: v.days || null, by: v.by || null })).filter((g) => g.goal);
  const notes = !useNotes(state) ? [] : Array.from({ length: 14 }, (_, i) => shift(day, -i))
    .map((k) => ({ day: k, text: String(state.days?.[k]?.reflection || '').trim() }))
    .filter((n) => n.text && !crisisIn(n.text)) // a hard night is never written into memory
    .slice(0, 8).map((n) => ({ ...n, text: n.text.slice(0, 220) }));
  const quests = (state.profile?.quests?.log || []).slice(-6).map((q) => ({ quest: q.title, status: q.status }));
  return { goals, eveningNotes: notes, quests };
}

const SYSTEM = `You are Athena, the quiet coach inside Odyssey, a habit app. You keep a short memory of one person so that every later note can be personal.
Write only what the facts or their own words show; never guess, never diagnose, never give medical, diet or smoking-cessation advice.
Plain, specific, kind words. No exclamation marks, no emoji. Every number you write must appear in the input.
Never write anything about self-harm, crisis or someone's mental health. Reply with JSON only.`;

const TASK = `Write this person's memory: what a coach should still know about them in a month. They will read it, so write to them, in the second person ("You …"), never "they".
Lasting patterns only, never this week's status (no "this week", no "behind target", no "paused", no counts left to do); the app already shows the week.
"weeksOfData" says how many weeks of logs there are. With 1, you have one week: say only what it showed, and never claim a trend, "over weeks", "usually" or "consistently".
- about: 1 or 2 sentences, under ${ABOUT_WORDS} words: what they are working on and who they want to become, in plain words. "identity" is who they want to be, not who they are yet ("You want to be …"). Don't list numbers.
- works: up to 3 conditions under which they succeed: a time of day, a day, a starting version that kept them going, a run of steady weeks, a habit trending up. One idea per line, under ${LINE_WORDS} words.
- doesnt: up to 3 recurring things that get in the way: a trigger (from "triggers", with its percent), the time a habit slips ("slipsMostOftenAt"), the main reason for delay, a habit trending down, tasks carried for weeks, breaks of several days. Same rules.
- commit: up to 2 things they are working towards in their own words: goals from "goals", or a plan or intention they wrote in an evening note ("move work to mornings so gym doesn't get missed"). Never turn app targets into goals. Empty if neither.
- know: up to 3 lasting facts from their evening notes: their schedule, an injury, who they live with, an event coming up. Not feelings, wishes or plans (plans go in commit). Empty if none.
Where their own words say what they want, never contradict them with a pattern from the data. Fewer, sharper lines are better than many; any list may be empty. Write each line as a plain observation, not an instruction. Never repeat a line in "theyWrote" or "deleted"; never contradict "theyWrote". Return {"about": "...", "works": [], "doesnt": [], "commit": [], "know": []}.`;

// → { kind: 'memory', model, messages, forHash, noteId, input } | null (off, too little data, or already built this week)
export function memoryRequest(state, day, { model = 'gpt-5.6-luna', force = false } = {}) {
  const m = memoryOf(state);
  if (m?.off) return null;
  if (loggedDays(state) < MIN_LOGGED_DAYS) return null;
  const wk = weekKeyOf(day);
  if (!force && m?.wk === wk) return null; // once a week
  if (!force && m?.tries?.wk === wk && m.tries.n >= 2) return null; // two rejected answers this week: wait for the next
  const you = (m?.lines || []).filter((l) => l.from === 'you');
  const input = {
    ...weeksOf(state, day), yourWords: yourWords(state, day), identity: state.profile?.identity || null, tone: state.settings?.tone || 'direct',
    theyWrote: you.map((l) => ({ list: l.list, text: l.text })), deleted: (m?.dropped || []).slice(-20),
    lastAbout: m?.about?.from === 'you' ? null : m?.about?.text || null,
  };
  const user = JSON.stringify({ task: TASK, ...input });
  return {
    kind: 'memory', model, noteId: MEMORY_ID, wk, input, forHash: hashOf(`${wk}|${user}`),
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
  };
}
const hashOf = (s) => [...String(s || '')].reduce((h, c) => ((h * 33) ^ c.charCodeAt(0)) >>> 0, 5381).toString(36);

const MEDICAL = /\b(nicotine (patch|gum|replacement)|patches|varenicline|bupropion|medication|medicine|prescri\w+|dosage|\d+\s?mg|calories?|kcal|bmi|keto|diagnos\w+|disorder|depress\w*|anxiety|adhd|addict\w*|withdrawal|cure)\b/i;
const THIRD = /\b(they|they're|their|them|themselves)\b/i;
const TREND = /\b(trend\w*|over (several|recent|many|the last|past) (\d+ )?weeks|weeks in a row|for weeks|consistently|usually)\b/i;
const STATUS = /\b(this week|today|yesterday|behind (its |the |their )?target|still needed|paused)\b/i;
const DAYS = /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/gi;

// Check the model's answer → { about, works, doesnt, commit, know } | null (rejected: the memory stays as it was)
export function parseMemory(req, raw) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const src = JSON.stringify(req.input);
  const allowed = numbersIn(req.input);
  const okText = (s) => s && !/[\u{1F300}-\u{1FAFF}]/u.test(s) && !MEDICAL.test(s) && !crisisIn(s)
    && (s.match(/\d+(?:\.\d+)?/g) || []).every((n) => allowed.has(n))
    && (s.match(DAYS) || []).every((d) => src.toLowerCase().includes(d.toLowerCase()));
  const about = clean(j.about);
  if (!about || words(about) > ABOUT_WORDS || !okText(about) || THIRD.test(about)) return null; // written to them, not about them
  const early = (req.input.weeksOfData ?? 4) < 2;
  const out = { about };
  const cap = { works: 4, doesnt: 4, commit: 3, know: 4 };
  for (const list of Object.keys(cap)) {
    // a line about this week's status isn't memory: dropped, not fatal
    // …and with one week of data, neither is a claim about weeks
    const xs = Array.isArray(j[list]) ? j[list].map(clean).filter(Boolean).filter((x) => !STATUS.test(x) && !(early && TREND.test(x))) : [];
    if (xs.length > cap[list] || xs.some((x) => words(x) > LINE_WORDS || !okText(x) || THIRD.test(x))) return null;
    out[list] = xs;
  }
  if (!req.input.yourWords.eveningNotes.length && out.know.length) out.know = []; // nothing they said: nothing to know
  const Y = req.input.yourWords;
  if (!Y.goals.length && !Y.eveningNotes.length) out.commit = []; // no goals, nothing they wrote: targets aren't commitments
  out.commitFrom = Y.goals.length ? 'goals' : 'notes';
  return out;
}

// Merge a checked answer into the memory: your lines stay first and untouched; Athena's are replaced; deleted
// lines and repeats of yours are skipped; each list is capped.
export function mergeMemory(m, reply, { wk, forHash, model, now = Date.now(), notes = false } = {}) {
  const old = m || { id: MEMORY_ID, kind: 'memory', lines: [], dropped: [] };
  const dropped = new Set((old.dropped || []).map(norm));
  const you = (old.lines || []).filter((l) => l.from === 'you');
  const seen = new Set(you.map((l) => norm(l.text)));
  const lines = [...you];
  for (const [list, L] of Object.entries(LISTS)) {
    if (!L.ai) continue;
    const have = () => lines.filter((l) => l.list === list).length;
    for (const text of reply[list] || []) {
      const n = norm(text);
      if (!n || dropped.has(n) || seen.has(n) || have() >= L.max) continue;
      seen.add(n);
      const from = list === 'know' ? (notes ? 'notes' : 'data') : list === 'commit' ? reply.commitFrom || 'data' : 'data';
      lines.push({ id: uid(), list, text, from, at: now });
    }
  }
  const about = old.about?.from === 'you' ? old.about : { text: reply.about, from: 'data' };
  return { ...old, id: MEMORY_ID, kind: 'memory', about, lines, wk, for: forHash, model, builtAt: now, tries: null };
}

// A rejected or failed build: counted, so it isn't retried more than twice a week.
export const triedMemory = (m, wk) => ({ ...(m || { id: MEMORY_ID, kind: 'memory', lines: [], dropped: [] }), tries: { wk, n: (m?.tries?.wk === wk ? m.tries.n : 0) + 1 } });

// ---------- your edits (the app) ----------

export function addLine(m, list, text, now = Date.now()) {
  const t = clean(text).slice(0, 200);
  if (!t || !LISTS[list]) return m;
  const base = m || { id: MEMORY_ID, kind: 'memory', lines: [], dropped: [] };
  return { ...base, lines: [...(base.lines || []), { id: uid(), list, text: t, from: 'you', at: now }] };
}
export function editLine(m, id, text, now = Date.now()) {
  const t = clean(text).slice(0, 200);
  if (!t) return deleteLine(m, id);
  return { ...m, lines: m.lines.map((l) => (l.id === id ? { ...l, text: t, from: 'you', at: now } : l)) };
}
export function deleteLine(m, id) {
  const l = (m?.lines || []).find((x) => x.id === id);
  if (!l) return m;
  return { ...m, lines: m.lines.filter((x) => x.id !== id), dropped: l.from === 'you' ? m.dropped || [] : [...(m.dropped || []), l.text].slice(-40) };
}
export const editAbout = (m, text) => {
  const t = clean(text).slice(0, 400);
  return { ...(m || { id: MEMORY_ID, kind: 'memory', lines: [], dropped: [] }), about: t ? { text: t, from: 'you' } : null };
};
// "Forget everything": clears it and stops the rebuild until you turn it back on.
export const forgetAll = (m) => ({ id: MEMORY_ID, kind: 'memory', lines: [], dropped: [], about: null, off: true, useNotes: m?.useNotes, at: Date.now() });
export const turnOn = (m) => ({ ...(m || { id: MEMORY_ID, kind: 'memory', lines: [], dropped: [] }), off: false, wk: null });
export const setUseNotes = (m, on) => ({
  ...(m || { id: MEMORY_ID, kind: 'memory', lines: [], dropped: [] }), useNotes: on,
  // turning notes off also forgets what Athena learnt from them
  lines: on ? m?.lines || [] : (m?.lines || []).filter((l) => l.from !== 'notes'),
});
