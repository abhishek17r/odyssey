// Athena with AI: what she's told and how her answer is checked. Pure, shared by the server function and
// the tests. The engine still decides what to say (the template is her draft); the AI only rewrites the
// words, from a short summary of the person's own data. Anything that fails the checks is thrown away and
// the template stays.

import { metricKey, planOf, parseKey, isPaused } from './score.js';
import { tacticLine, kindOf } from './engine.js';
import { morningLine, eveningReply, weeklyRead } from './athena.js';
import { crisisIn } from './safety.js';

export const MODELS = { small: 'gpt-5-nano', large: 'gpt-5-mini' };
// US$ per million tokens [in, out]; override with the AI_PRICES secret (JSON) when prices change
export const PRICES = { 'gpt-5-nano': [0.05, 0.4], 'gpt-5-mini': [0.25, 2.0], 'gpt-5': [1.25, 10] };
// cached prompt tokens cost a tenth of fresh ones (OpenAI's prompt cache)
export const costOf = (model, tin, tout, prices = PRICES, cached = 0) => {
  const p = prices[model] || prices[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')] || [0, 0];
  const c = Math.min(cached || 0, tin || 0);
  return (((tin || 0) - c) * p[0] + c * p[0] * 0.1 + (tout || 0) * p[1]) / 1e6;
};

export const noteIds = { morning: (day) => `ai-morning-${day}`, evening: (day) => `ai-evening-${day}`, weekly: (wk) => `ai-weekly-${wk}` };
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
export function buildRequest(kind, state, day, wk) {
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
  return null;
}

// Check the model's answer → { text } | { lines } | null (rejected: the template stays)
export function parseReply(req, raw) {
  let j;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[!]+/g, '.').trim();
  const words = (s) => s.split(' ').filter(Boolean).length;
  const numbers = (s) => (String(s).match(/\d+/g) || []).sort().join(',');
  const draftText = req.kind === 'weekly' ? req.draft.lines.join(' ') : req.draft.text;
  // every number in the answer must come from the draft (no invented facts)
  const okNumbers = (s) => (String(s).match(/\d+/g) || []).every((n) => draftText.includes(n));
  if (req.kind === 'weekly') {
    const lines = Array.isArray(j?.lines) ? j.lines.map(clean).filter(Boolean) : [];
    if (lines.length < 2 || lines.length > 8 || words(lines.join(' ')) > req.maxWords) return null;
    if (!lines.every(okNumbers)) return null;
    if (numbers(draftText) && !numbers(lines.join(' '))) return null; // lost all the facts
    return { lines };
  }
  const text = clean(j?.text);
  if (!text || words(text) > req.maxWords || !okNumbers(text)) return null;
  return { text };
}

// The note the server saves for a checked answer (synced to the phone like any note).
export function noteFor(req, reply, day, wk, model) {
  const id = req.kind === 'weekly' ? noteIds.weekly(wk) : noteIds[req.kind](day);
  return { id, kind: 'ai', of: req.kind, ...(reply.lines ? { lines: reply.lines } : { text: reply.text }), for: req.forHash, model, at: Date.now() };
}

// Is a fresh note needed? The existing note already answers this draft → no call (the cheapest cache).
export function needsNote(req, existing) {
  if (!req) return false;
  if (!existing) return true;
  return existing.for !== req.forHash;
}
