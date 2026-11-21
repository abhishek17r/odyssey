// Athena with AI: what she's told and how her answer is checked. Pure, shared by the server function and
// the tests. The engine still decides what to say (the template is her draft); the AI only rewrites the
// words, from a short summary of the person's own data. Anything that fails the checks is thrown away and
// the template stays.

import { metricKey, planOf, parseKey, isPaused } from './score.js';
import { tacticLine, kindOf } from './engine.js';
import { morningLine, eveningReply, weeklyRead } from './athena.js';
import { crisisIn } from './safety.js';
import { weekReport } from './report.js';

// Picked in the brain's B0 test set (docs/brain.md): gpt-5.6-luna passed 94% of the checks, at about ₹1.3 per user a month.
export const MODELS = { small: 'gpt-5.6-luna', large: 'gpt-5.6-luna' };
// US$ per million tokens [in, out]; override with the AI_PRICES secret (JSON) when prices change
export const PRICES = { 'gpt-5.6-luna': [0.2, 1.2], 'gpt-5-nano': [0.05, 0.4], 'gpt-5-mini': [0.25, 2.0], 'gpt-5': [1.25, 10] };
// the lowest reasoning setting: gpt-5 / -mini / -nano call it 'minimal', later models 'none'
export const effortFor = (model) => (/^gpt-5(-|$)/.test(model) ? 'minimal' : 'none');
// cached prompt tokens cost a tenth of fresh ones (OpenAI's prompt cache)
export const costOf = (model, tin, tout, prices = PRICES, cached = 0) => {
  const p = prices[model] || prices[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')] || [0, 0];
  const c = Math.min(cached || 0, tin || 0);
  return (((tin || 0) - c) * p[0] + c * p[0] * 0.1 + (tout || 0) * p[1]) / 1e6;
};

// Cost guardrails (about 3x what gpt-5.6-luna costs per call today, so they only stop runaways).
// inputTokens: a request bigger than this is never sent (the template stays). costAlert: US$ a call above which the
// ledger row is flagged and the admin page lists it.
export const GUARDS = {
  inputTokens: { morning: 1200, evening: 1200, weekly: 1500, report: 1500, goal: 1500 },
  costAlert: { morning: 0.0005, evening: 0.0002, weekly: 0.0015, report: 0.0015, goal: 0.0015 },
};
// rough token count of a request (about 3.6 characters a token for this English + JSON mix)
export const estTokens = (req) => Math.ceil((req?.messages || []).reduce((a, m) => a + String(m.content || '').length, 0) / 3.6);
export const overBudget = (req) => estTokens(req) > (GUARDS.inputTokens[req.kind] ?? 1500);
export const costAlert = (req, cost) => cost > (GUARDS.costAlert[req.kind] ?? 0.0015);

export const noteIds = { morning: (day) => `ai-morning-${day}`, evening: (day) => `ai-evening-${day}`, weekly: (wk) => `ai-weekly-${wk}`, report: (wk) => `ai-report-${wk}`, goal: (id) => `ai-goal-${id}` };
// the jobs written once a week (their note is per week, not per day)
export const WEEKLY_KINDS = ['weekly', 'report'];
export const noteIdOf = (kind, day, wk) => (WEEKLY_KINDS.includes(kind) ? noteIds[kind](wk) : noteIds[kind](day));
// what the report's weak spots hash to (its AI note is used only while the weak spots are the same)
export const reportHash = (weak) => textHash(weak.map((w) => `${w.id}|${w.why}|${w.fix}`).join('#'));
// what a habit's goal plan hashes to (its AI wording is used only while the plan and answers are the same)
export const visionHash = (v) => textHash(JSON.stringify([v?.text, v?.now, v?.around, v?.days, v?.by, (v?.plan?.blocks || []).map((b) => [b.title, b.detail])]));
export const textHash = (s) => [...String(s || '')].reduce((h, c) => ((h * 33) ^ c.charCodeAt(0)) >>> 0, 5381).toString(36);

// The same state without AI notes, so the templates (her drafts) are never written from AI output.
export const withoutAI = (state) => ({ ...state, notes: Object.fromEntries(Object.entries(state.notes || {}).filter(([k]) => !k.startsWith('ai-'))) });

const SYSTEM = `You are Athena, the quiet guide inside Odyssey, a habit app. You rewrite a short draft note in your voice.
Voice: calm, warm, specific, brief. Plain words. Use the person's own identity words when given. No exclamation marks, no emoji, no hashtags.
Never shame, never guilt. Never invent numbers, habits or events: use only the facts given. Keep every number exactly as given.
No medical, diet or smoking-cessation advice beyond gently suggesting professional help. If the facts suggest crisis or self-harm, reply only with a short kind line suggesting they talk to someone they trust or a local helpline.
At most one light reference to the Odyssey (sailing, Ithaca) and only in the weekly read.
Reply with JSON only.`;

// The facts Athena may use: identity, today's focus habits, their tactic lines, the draft.
function facts(state, day) {
  const plan = planOf(day, state);
  const habits = (state.profile?.habits || []).map((h) => plan?.goals.find((g) => g.id === h.goalId)).filter(Boolean).map((g) => {
    const m = g.metrics[0];
    const v = state.days?.[day]?.values?.[metricKey(g, m)];
    return {
      name: g.name, kind: kindOf(g), target: m.target, unit: m.unit, todayLogged: v ?? null,
      plannedToday: kindOf(g) !== 'yesno' || !m.days?.length || m.days.includes(parseKey(day).getDay()),
      startingVersion: g.tiny || null, tacticLine: tacticLine(state, g, day)?.text || null,
    };
  });
  return { identity: state.profile?.identity || null, day, paused: isPaused(state, day), habits };
}

// → { kind, model, messages, draft, maxWords } | null (nothing to write)
export function buildRequest(kind, state, day, wk, id = null) {
  const s = withoutAI(state);
  if (kind === 'morning') {
    const draft = morningLine(s, day);
    if (!draft) return null;
    return {
      kind, model: MODELS.small, draft, maxWords: 45, forHash: textHash(draft.text),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({
        task: 'Rewrite the morning line: 1 or 2 short sentences, under 45 words. Same meaning and facts as the draft; name what is planned today. Return {"text": "..."}.',
        draft: draft.text, facts: facts(s, day) }) }],
    };
  }
  if (kind === 'evening') {
    if (crisisIn(s.days[day]?.reflection)) return null; // the fixed safety line stands; never sent to the AI
    const draft = eveningReply(s, day);
    if (!draft) return null;
    return {
      kind, model: MODELS.small, draft: { text: draft }, maxWords: 50, forHash: textHash(s.days[day]?.reflection),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({
        task: 'Reply to their evening reflection in 1 or 2 sentences, under 50 words: acknowledge what they wrote, keep the day’s facts from the draft, end gently. Return {"text": "..."}.',
        reflection: String(s.days[day]?.reflection || '').slice(0, 600), draft, facts: facts(s, day) }) }],
    };
  }
  if (kind === 'weekly') {
    const draft = weeklyRead(s, day, wk);
    if (!draft) return null;
    return {
      kind, model: MODELS.large, draft, maxWords: 140, forHash: textHash(draft.lines.join('|')),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({
        task: 'Rewrite this weekly read as 4 to 7 short lines (one sentence each), under 140 words in total. Keep every number and fact from the draft lines, in the same order; you may merge or split lines. The last line closes warmly. Return {"lines": ["...", "..."]}.',
        draft: draft.lines, tone: draft.tone, identity: s.profile?.identity || null }) }],
    };
  }
  if (kind === 'goal') {
    const v = s.profile?.visions?.[id];
    if (!v?.plan?.blocks?.length) return null;
    const blocks = v.plan.blocks.map((b) => ({ weeks: b.from === b.to ? `${b.from}` : `${b.from}-${b.to}`, title: b.title, detail: b.detail, check: b.check.text }));
    return {
      kind, model: MODELS.large, draft: { blocks, goal: v.text, now: v.now, around: v.around, days: v.days }, maxWords: 60, forHash: visionHash(v), noteId: noteIds.goal(id),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({
        task: 'This is the plan for their goal, in blocks of weeks. Rewrite each block for this person: a title under 8 words and a detail of 1 or 2 sentences saying what to do in those weeks, planned around what they told you. Keep every number exactly as given and add none; never give medical advice. Same number of blocks, same order. Return {"blocks": [{"title": "...", "detail": "..."}]}.',
        goal: v.text, now: v.now || null, daysAWeek: v.days, planAround: v.around || null, blocks, identity: s.profile?.identity || null }) }],
    };
  }
  if (kind === 'report') {
    const R = weekReport(s, wk, day);
    if (!R.weak.length) return null;
    const draft = { weak: R.weak };
    return {
      kind, model: MODELS.large, draft, maxWords: 70, forHash: reportHash(R.weak),
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({
        task: 'These are the weak spots of their week, found from their data, each with a fix for next week. Rewrite each one for this person: a title under 8 words, why in one sentence, and a fix in one or two sentences that is concrete for next week (name the day, time or habit when the facts give one). Keep every number and every name exactly as given; add no new facts, and name a day of the week only if the draft names it. Same ids, same order. Return {"weak": [{"id": "...", "title": "...", "why": "...", "fix": "..."}]}.',
        weak: R.weak, onTrack: R.onTrack, tasks: R.tasks, tone: s.settings?.tone || 'direct', identity: s.profile?.identity || null, habits: facts(s, day).habits.map((h) => ({ name: h.name, target: h.target, unit: h.unit, startingVersion: h.startingVersion })) }) }],
    };
  }
  return null;
}

// Check the model's answer → { text } | { lines } | null (rejected: the template stays)
export function parseReply(req, raw) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[!]+/g, '.').trim();
  const words = (s) => s.split(' ').filter(Boolean).length;
  const numbers = (s) => (String(s).match(/\d+/g) || []).sort().join(',');
  const draftText = req.kind === 'weekly' ? req.draft.lines.join(' ') : ['report', 'goal'].includes(req.kind) ? JSON.stringify(req.draft) + JSON.stringify(req.messages?.[1]?.content || '') : req.draft.text;
  // every number in the answer must come from the draft (no invented facts)
  const okNumbers = (s) => (String(s).match(/\d+/g) || []).every((n) => draftText.includes(n));
  // weekdays too: a day the draft doesn't name is an invented fact
  const DAYS = /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/gi;
  const okDays = (s) => (String(s).match(DAYS) || []).every((d) => draftText.toLowerCase().includes(d.toLowerCase()));
  if (req.kind === 'weekly') {
    const lines = Array.isArray(j?.lines) ? j.lines.map(clean).filter(Boolean) : [];
    if (lines.length < 2 || lines.length > 8 || words(lines.join(' ')) > req.maxWords) return null;
    if (!lines.every(okNumbers)) return null;
    if (numbers(draftText) && !numbers(lines.join(' '))) return null; // lost all the facts
    return { lines };
  }
  if (req.kind === 'goal') {
    const bs = Array.isArray(j?.blocks) ? j.blocks : [];
    if (bs.length !== req.draft.blocks.length) return null;
    const out = bs.map((b) => ({ title: clean(b?.title), detail: clean(b?.detail) }));
    if (out.some((b) => !b.title || !b.detail || words(b.title) > 10 || words(b.detail) > 45 || ![b.title, b.detail].every((x) => okNumbers(x) && okDays(x)))) return null;
    return { blocks: out };
  }
  if (req.kind === 'report') {
    const ws = Array.isArray(j?.weak) ? j.weak : [];
    if (ws.length !== req.draft.weak.length) return null;
    const out = [];
    for (let i = 0; i < ws.length; i++) {
      const w = { id: req.draft.weak[i].id, title: clean(ws[i]?.title), why: clean(ws[i]?.why), fix: clean(ws[i]?.fix) };
      if (ws[i]?.id !== w.id || !w.title || !w.why || !w.fix) return null;
      if (words(w.title) > 10 || words(w.why) > 40 || words(w.fix) > 50) return null;
      if (![w.title, w.why, w.fix].every((x) => okNumbers(x) && okDays(x))) return null;
      out.push(w);
    }
    return { weak: out };
  }
  const text = clean(j?.text);
  if (!text || words(text) > req.maxWords || !okNumbers(text)) return null;
  return { text };
}

// The note the server saves for a checked answer (synced to the phone like any note).
export function noteFor(req, reply, day, wk, model) {
  const id = req.noteId || noteIdOf(req.kind, day, wk);
  const body = reply.blocks ? { blocks: reply.blocks } : reply.weak ? { weak: reply.weak } : reply.lines ? { lines: reply.lines } : { text: reply.text };
  return { id, kind: 'ai', of: req.kind, ...body, for: req.forHash, model, at: Date.now() };
}

// Is a fresh note needed? The existing note already answers this draft → no call (the cheapest cache).
export function needsNote(req, existing) {
  if (!req) return false;
  if (!existing) return true;
  return existing.for !== req.forHash;
}
