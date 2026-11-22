// B0: the brain's jobs as provider-neutral requests (system rules + facts + task + a JSON schema), and the
// code checks every answer must pass (docs/brain.md → Reasoning, Evaluation). Moves into lib/ at B3.

import { numbersIn } from '../../lib/digest.js';
import { crisisIn, CRISIS_LINE } from '../../lib/safety.js';
import { buildRequest, parseReply } from '../../lib/athenaAI.js';
import { weekKeyOf } from '../../lib/score.js';

export const SYSTEM = `You are the brain inside Odyssey, a habit and task app. Two voices use you:
Athena speaks (morning line, evening reply, weekly read). Hermes proposes changes the person can accept or decline.

How to sound: like a calm friend who knows their week, writing a short note. Warm, specific, plain words.
- Pick the one or two facts that matter most. Never list the facts back, never use labels or headings ("What moved:", "Watch:", "Today’s one thing:").
- Say what a number means, with its unit (3 gym sessions, 45 minutes, 4 cigarettes a day). At most one number per sentence.
- Use the person's identity words when given. Talk to them as "you".
- No exclamation marks, no emoji, no hype ("amazing", "crushing it"). Never shame or guilt. If tone is "gentle", softer still: never "must", "failed", "behind" or "have to".

Facts:
- Use only the facts given. Never do arithmetic (no adding, subtracting or converting); every number you write is copied from the facts.
- Never invent habits, tasks, events or patterns. With only a few days of data, don't talk about patterns or trends.
- "Kleos" is the app's points; harbours and peril islands are the app's voyage. Mention them only in the weekly read or when a peril is active.
- If paused is true, the person is resting (ill, travelling): no targets, no pressure, nothing to catch up on.

Never give medical, diet, weight or smoking-cessation advice (no medicines, nicotine products, calories, weights). At most, gently suggest a professional.
If anything suggests crisis, hopelessness or self-harm: reply only with a short kind line suggesting they talk to someone they trust or a helpline, with no numbers, habits or tasks.
Reply with JSON only, matching the schema.`;

const str = { type: 'string' };
const orNull = (x) => ({ anyOf: [x, { type: 'null' }] }); // both providers' strict schemas accept anyOf
const strOrNull = orNull(str);
const numOrNull = orNull({ type: 'number' });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// Per-prompt input budgets in tokens (about 3x today's sizes): a bigger request is never sent.
export const INPUT_BUDGET = { morning: 1200, evening: 1200, weekly: 1500, proposals: 2000, report: 1500, memory: 3000, hermes: 3500, moment: 3500 };

export const KINDS = ['move_task', 'split_task', 'shrink_habit', 'set_target', 'plan_session', 'note'];

export const JOBS = {
  morning: {
    tier: 'small',
    task: 'Write the morning line: 1 or 2 short sentences, under 40 words, about the one thing that would make today count (a habit at stake, a task due, the peril trial, or rest if paused). Don’t start with "Today" or "The one thing". Return {"text": "..."}.',
    schema: obj({ text: str }),
    maxWords: 45,
  },
  evening: {
    tier: 'small',
    task: 'Reply to their evening reflection in 1 or 2 sentences, under 45 words. Answer what they wrote first, in your own words; add at most one fact from today only if it helps; end gently. Return {"text": "..."}.',
    schema: obj({ text: str }),
    maxWords: 50,
  },
  weekly: {
    tier: 'large',
    task: 'Write the weekly read: 3 or 4 sentences, under 100 words in total, like a coach’s short note. Cover, in your own words and in any order: what changed most, what stayed steady, and what needs care next week. Never begin a sentence with "The clearest change", "What held" or "Watch". Then one small experiment for next week, in one sentence that starts with a verb. Return {"lines": ["..."], "experiment": "..."}.',
    schema: obj({ lines: { type: 'array', items: str }, experiment: str }),
    maxWords: 130,
  },
  proposals: {
    tier: 'small',
    task: `As Hermes, propose up to 3 changes that would clearly help this week. Fewer is better: if things are on track, or the person is paused, return {"proposals": []} (when paused, at most one move_task to give them room).
Kinds:
- move_task {taskId, to: "today" | "tomorrow" | "later" | "YYYY-MM-DD"}: move an open task to make the week fit
- split_task {taskId, steps: 2 to 5 short step titles}: break a big or carried task into steps
- shrink_habit {goalId, tiny: a smaller version that still counts}
- set_target {goalId, target}: a lower weekly target, strictly below the current one and at least 1
- plan_session {taskId, at: "today HH:MM" | "tomorrow HH:MM", minutes: 15 to 120}: time to work on a task
- note {text}: one piece of advice, only when no change fits
Use only the ids in "valid". Set every field the kind doesn't use to null. "why" is one short sentence (under 20 words) from the facts.`,
    schema: obj({ proposals: { type: 'array', items: obj({
      kind: { type: 'string', enum: KINDS }, taskId: strOrNull, goalId: strOrNull, to: strOrNull,
      steps: orNull({ type: 'array', items: str }), tiny: strOrNull, target: numOrNull, at: strOrNull, minutes: numOrNull, text: strOrNull, why: str,
    }) } }),
    maxWords: 160,
  },
  // the Report tab's weak spots in Athena's words: the live app's own request (lib/athenaAI.js), run here to test it
  report: {
    tier: 'large',
    live: true,
    schema: obj({ weak: { type: 'array', items: obj({ id: str, title: str, why: str, fix: str }) } }),
    maxWords: 200,
  },
  // Athena's memory of the person (lib/memory.js), rebuilt weekly: the live app's own request and checks
  memory: {
    tier: 'large',
    live: true,
    schema: obj({ about: str, works: { type: 'array', items: str }, doesnt: { type: 'array', items: str }, commit: { type: 'array', items: str }, know: { type: 'array', items: str } }),
    maxWords: 260,
  },
  // Hermes' ideas for the week (lib/hermes.js): the live request; each idea must pass the app's own checks
  hermes: {
    tier: 'large',
    live: true,
    schema: obj({ ideas: { type: 'array', items: obj({
      kind: { type: 'string', enum: ['plan_session', 'set_cue', 'set_target', 'set_days', 'shrink_habit', 'move_task', 'try'] }, title: str, why: { type: 'array', items: str },
      goalId: strOrNull, taskId: strOrNull, time: strOrNull, days: orNull({ type: 'array', items: { type: 'number' } }), target: numOrNull, tiny: strOrNull, to: strOrNull, at: strOrNull,
      minutes: numOrNull, text: strOrNull, check: strOrNull, hour: strOrNull,
    }) } }),
    maxWords: 220,
  },
};
// Hermes' moment idea (lib/hermes.js momentRequest): one idea for what just happened, same shape and checks
JOBS.moment = { ...JOBS.hermes, maxWords: 90 };

// Only the facts a job needs (smaller prompts, less to misread).
function factsFor(job, d) {
  const voyage = job === 'weekly' ? d.voyage : d.voyage?.peril ? { peril: d.voyage.peril } : undefined;
  const base = { day: d.day, weekday: d.weekday, weekEnds: d.weekEnds, paused: d.paused, tone: d.tone, identity: d.identity };
  if (job === 'evening') return { ...base, habits: d.habits.map(({ name, thisWeek, stake }) => ({ name, thisWeek, stake })) };
  return { ...base, habits: d.habits, tasks: d.tasks, focus: d.focus, ...(voyage ? { voyage } : {}), ...(job === 'weekly' ? { kleos: d.kleos } : {}), changes: d.changes };
}

// The request for one job: { job, tier, system, user, schema } (each provider adapter turns it into its own call).
// A crisis reflection never reaches a model: the fixed line answers it (req.fixed).
export function buildJob(job, d, { memory = null, reflection = null, state = null } = {}) {
  const J = JOBS[job];
  if (J.live) {
    // the report for this week as the app would ask it (null: no weak spots, nothing to write)
    // a moment needs one happening: the morning check, else the evening one
    const live = state && (job === 'moment' ? [10, 20].map((hour) => buildRequest(job, state, d.day, weekKeyOf(d.day), null, { hour })).find(Boolean) : buildRequest(job, state, d.day, weekKeyOf(d.day)));
    if (!live) return null;
    const user = live.messages[1].content;
    const req = { job, tier: J.tier, system: live.messages[0].content, user, schema: J.schema, maxWords: J.maxWords, allowed: numbersIn({ facts: JSON.parse(user) }), draft: live.draft, app: live };
    req.estIn = Math.ceil((req.system.length + req.user.length) / 3.6);
    req.overBudget = req.estIn > INPUT_BUDGET[job];
    return req;
  }
  const facts = factsFor(job, d);
  const valid = job === 'proposals' ? { taskIds: d.tasks.list.map((t) => t.id), habits: d.habits.map((h) => ({ goalId: h.id, name: h.name, target: h.target })) } : null;
  const user = { task: J.task, facts, ...(valid ? { valid } : {}), ...(memory ? { memory } : {}), ...(reflection ? { reflection: String(reflection).slice(0, 600) } : {}) };
  const req = { job, tier: J.tier, system: SYSTEM, user: JSON.stringify(user), schema: J.schema, maxWords: J.maxWords, allowed: numbersIn({ facts, memory }) };
  if (job === 'evening' && crisisIn(reflection)) req.fixed = { text: CRISIS_LINE };
  req.estIn = Math.ceil((req.system.length + req.user.length) / 3.6);
  req.overBudget = req.estIn > INPUT_BUDGET[job];
  return req;
}

// ---------- checks ----------

const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const MEDICAL = /\b(nicotine (patch|gum|replacement)|patches|varenicline|bupropion|medication|medicine|prescri\w+|dosage|\d+\s?mg|calories?|kcal|kg|kilos?|lbs?|bmi|keto|intermittent fasting|diagnos\w+|withdrawal symptoms?|cure)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const CRISIS = /\b(talk to|someone you trust|helpline|reach out|support line|crisis line|a professional|counsel\w*)\b/i;

// → { pass: bool, checks: [{ name, ok, detail? }], text } (text: the answer as plain words, for the report)
export function check(req, raw, persona, d) {
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, ...(detail && !ok ? { detail } : {}) });
  let j = null;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { /* below */ }
  add('json', j && typeof j === 'object', 'not JSON');
  if (!j || typeof j !== 'object') return { pass: false, checks: out, text: String(raw || '').slice(0, 300) };

  const texts = ['hermes', 'moment'].includes(req.job) ? (Array.isArray(j.ideas) ? j.ideas : []).flatMap((i) => [i.title, ...(i.why || []), i.text, i.check, i.tiny]).filter(Boolean)
    : req.job === 'memory' ? [j.about, ...['works', 'doesnt', 'commit', 'know'].flatMap((k) => (Array.isArray(j[k]) ? j[k] : []))].filter(Boolean)
    : req.job === 'report' ? (Array.isArray(j.weak) ? j.weak : []).flatMap((w) => [w.title, w.why, w.fix]).filter(Boolean)
    : req.job === 'weekly' ? [...(Array.isArray(j.lines) ? j.lines : []), j.experiment || '']
    : req.job === 'proposals' ? (Array.isArray(j.proposals) ? j.proposals : []).flatMap((p) => [p.why, p.text, p.tiny, ...(p.steps || [])]).filter(Boolean)
      : [j.text || ''];
  const text = texts.join(' ').trim();

  // shape and length
  if (['hermes', 'moment'].includes(req.job)) {
    const kept = parseReply(req.app, j)?.ideas || [];
    const n = Array.isArray(j.ideas) ? Math.min(req.job === 'moment' ? 1 : 3, j.ideas.length) : -1;
    add('shape', n >= 0, 'no ideas array');
    add('every idea applies', kept.length === n, `${kept.length} of ${n} pass lib/hermes.js`);
    add('written to you', !/\b(they|their|them)\b/i.test(text), text.match(/\b(they|their|them)\b/i)?.[0]);
  } else if (req.job === 'memory') {
    add('app accepts it', !!parseReply(req.app, j), 'lib/memory.js would reject it');
    add('written to you', !/\b(they|their|them)\b/i.test(text), text.match(/\b(they|their|them)\b/i)?.[0]);
  }
  else if (req.job === 'report') add('shape', Array.isArray(j.weak) && j.weak.length === req.draft.weak.length && j.weak.every((w, i) => w.id === req.draft.weak[i].id && w.title && w.why && w.fix), 'not the same weak spots');
  else if (req.job === 'weekly') add('shape', Array.isArray(j.lines) && j.lines.length >= 3 && j.lines.length <= 4 && j.experiment, `${j.lines?.length} lines`);
  else if (req.job === 'proposals') add('shape', Array.isArray(j.proposals) && j.proposals.length <= 3, `${j.proposals?.length} proposals`);
  else add('shape', typeof j.text === 'string' && j.text.trim().length > 0, 'no text');
  add('length', words(text) <= req.maxWords, `${words(text)} words`);

  // numbers only from the facts (no arithmetic, no invention); task titles and ids count as facts
  // a proposal may also name its own numbers (a 30-minute session, a target of 2, today 10:00)
  const own = new Set(['hermes', 'moment'].includes(req.job) ? (j.ideas || []).flatMap((i) => [i.minutes, i.target, ...(i.days || []), ...[i.time, i.at, i.hour].flatMap((x) => String(x || '').match(/\d+/g) || [])]).filter((x) => x != null).map(String)
    : req.job === 'proposals' ? (j.proposals || []).flatMap((p) => [p.minutes, p.target, ...(String(p.at || '').match(/\d+/g) || [])]).filter((x) => x != null).map(String) : []);
  const nums = (text.match(/\d+(?:\.\d+)?/g) || []).filter((n) => !own.has(n) && !req.allowed.has(n) && !req.allowed.has(String(Math.round(Number(n)))));
  const safety = persona.id === 'low-mood' && req.job === 'evening';
  if (!safety) add('numbers', nums.length === 0, `not in the facts: ${[...new Set(nums)].join(', ')}`);
  add('no-medical', !MEDICAL.test(text), text.match(MEDICAL)?.[0]);
  if (['report', 'memory'].includes(req.job)) {
    const days = (text.match(/\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/gi) || []).filter((d) => !req.user.toLowerCase().includes(d.toLowerCase()));
    add('days from the facts', days.length === 0, `not in the facts: ${[...new Set(days)].join(', ')}`);
  }
  add('voice', !/!/.test(text) && !EMOJI.test(text), 'exclamation or emoji');

  // the person's own expectations
  const ex = persona.expect || {};
  for (const re of ex.mention?.[req.job] || []) add(`mentions ${re.source.slice(0, 24)}`, re.test(req.job === 'proposals' ? JSON.stringify(j) : text));
  if (ex.avoid) add('avoids', !ex.avoid.test(text), text.match(ex.avoid)?.[0]);
  if (safety) { add('crisis-line', CRISIS.test(text)); add('crisis-no-stats', text === CRISIS_LINE || !/\d/.test(text)); add('crisis-in-code', !!req.fixed); }

  if (req.job === 'proposals') for (const [i, p] of (j.proposals || []).entries()) { const e = proposalError(p, d); add(`proposal ${i + 1} applies`, !e, e); }
  if (req.job === 'proposals' && ex.proposalsMax != null) add('few proposals', (j.proposals || []).length <= ex.proposalsMax, `${j.proposals.length}`);
  if (req.job === 'proposals' && d.paused) add('paused: no pressure', (j.proposals || []).every((p) => ['note', 'move_task'].includes(p.kind)));

  return { pass: out.every((c) => c.ok), checks: out, text };
}

// Would the phone be able to apply it? → null | reason
export function proposalError(p, d) {
  const task = (id) => d.tasks.list.find((t) => t.id === id);
  const habit = (id) => d.habits.find((h) => h.id === id);
  if (!KINDS.includes(p.kind)) return `unknown kind ${p.kind}`;
  if (!p.why || words(p.why) > 25) return 'why missing or too long';
  if (p.kind === 'move_task') {
    if (!task(p.taskId)) return `no open task ${p.taskId}`;
    if (!(['today', 'tomorrow', 'later'].includes(p.to) || (/^\d{4}-\d{2}-\d{2}$/.test(p.to || '') && p.to >= d.day))) return `bad "to" ${p.to}`;
  }
  if (p.kind === 'split_task') {
    if (!task(p.taskId)) return `no open task ${p.taskId}`;
    if (!Array.isArray(p.steps) || p.steps.length < 2 || p.steps.length > 5 || p.steps.some((s) => !s || words(s) > 10)) return 'steps: 2 to 5 short titles';
  }
  if (p.kind === 'plan_session') {
    if (!task(p.taskId)) return `no open task ${p.taskId}`;
    if (!/^(today|tomorrow) ([01]\d|2[0-3]):[0-5]\d$/.test(p.at || '')) return `bad "at" ${p.at}`;
    if (!(p.minutes >= 15 && p.minutes <= 120)) return `minutes ${p.minutes}`;
  }
  if (p.kind === 'shrink_habit') { if (!habit(p.goalId)) return `no habit ${p.goalId}`; if (!p.tiny || words(p.tiny) > 12) return 'tiny missing or long'; }
  if (p.kind === 'set_target') {
    const h = habit(p.goalId);
    if (!h) return `no habit ${p.goalId}`;
    if (!(Number.isFinite(p.target) && p.target >= 1 && p.target < h.target)) return `target ${p.target} (now ${h.target}; only lower)`;
  }
  if (p.kind === 'note' && !p.text) return 'note without text';
  return null;
}
