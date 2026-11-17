// The improvement system, after Atomic Habits (James Clear) and Whoop's data-informed coaching.
// Pure functions, no chrome.* calls.
//
//  Whoop idea                      → here
//  Recovery (readiness each morning) → readiness score from sleep, energy and mood (self-reported)
//  Strain target set by recovery   → today's focus-hours target = your baseline × readiness factor
//  Journal → "what affects recovery" → impact: days with vs without a behaviour, on your starts and focus
//  Personal baselines, not absolutes → everything compared with your own last 28 days
//
//  Atomic Habits idea              → here
//  Identity-based habits ("votes") → every quick start and every habit day on target is a vote
//  Four laws (obvious, attractive, easy, satisfying) and their inversions
//                                  → a playbook of interventions, each tied to procrastination reasons
//  Implementation intentions       → "I will work on X at TIME" reminders; habit cues in the plan
//  Two-minute rule                 → a 2-minute first milestone in each session
//  Never miss twice                → a flag on any habit that went red yesterday
//  Environment design              → pre-start checklist; distraction blocking (make it difficult)
//  One change at a time, measured  → one experiment per week, compared with the 2 weeks before it

import {
  weekDays, weekKeyOf, dateKey, parseKey, addDays, sessionsIn, reasonStats, lastNDays, planOf, goalScore,
  timedMetric, metricKey, band, DEFAULT_SETTINGS,
} from './score.js';
import { median, timeToStart, QUICK_START_MIN, HOUR_BLOCKS } from './metrics.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// ---------- readiness (Whoop "recovery", self-reported) ----------
// days[date].readiness = { sleepH, energy (1–5), mood (1–5), at }
// score = 50% sleep vs your target + 30% energy + 20% mood, 0–100.
export function readinessScore(r, sleepTarget = DEFAULT_SETTINGS.sleepTarget) {
  if (!r || r.sleepH == null || !r.energy || !r.mood) return null;
  const sleep = Math.min(100, (100 * Number(r.sleepH)) / sleepTarget);
  const scale = (v) => ((Number(v) - 1) / 4) * 100;
  return Math.round(0.5 * sleep + 0.3 * scale(r.energy) + 0.2 * scale(r.mood));
}
export const READINESS_LABEL = { green: 'Ready to push', yellow: 'Steady day', red: 'Recover and protect', none: 'How did you wake up?' };
export const READINESS_FACTOR = { green: 1.15, yellow: 0.9, red: 0.6, none: 1 };

// Hours worked on the timer per day, for days with at least one session.
const focusHoursByDay = (state, keys) =>
  keys.map((k) => (state.sessions?.[k] || []).reduce((a, x) => a + (Number(x.workMin) || 0), 0) / 60).filter((h, i) => (state.sessions?.[keys[i]] || []).length);

// Today's focus target ("strain target"): your 28-day median focus hours (or the Meaningful work
// target when there isn't enough history), scaled by today's readiness. Rounded to 0.5 h.
export function focusTarget(state, dayKey) {
  const hist = focusHoursByDay(state, lastNDays(dayKey, 29).slice(0, -1));
  const plan = planOf(dayKey, state);
  const habitTarget = Number(plan?.goals.find((g) => g.id === 'work')?.metrics.find((m) => m.id === 'hours')?.target) || 4;
  const base = hist.length >= 5 ? Math.max(median(hist), 1) : habitTarget;
  const rs = readinessScore(state.days[dayKey]?.readiness, state.settings?.sleepTarget);
  const h = Math.round(base * READINESS_FACTOR[band(rs)] * 2) / 2;
  return { hours: h, base: r1(base), basis: hist.length >= 5 ? `your 28-day median (${r1(base)} h)` : `your Meaningful work target (${habitTarget} h)`, readiness: rs };
}

// Your fastest-starting time of day over the last 28 days (needs 3+ sessions in a block).
export function bestStartBlock(state, dayKey) {
  const list = sessionsIn(lastNDays(dayKey, 28), state);
  const blocks = HOUR_BLOCKS.map(([a, b, label]) => {
    const xs = list.filter((x) => { let h = new Date(x.start).getHours(); if (h < 5) h += 24; return h >= a && h < b; });
    return { label, n: xs.length, median: median(xs.map(timeToStart)) };
  }).filter((x) => x.n >= 3).sort((a, b) => a.median - b.median);
  return blocks[0] || null;
}

// ---------- identity votes ----------
// A vote = a session started within QUICK_START_MIN, or a habit on target (scored 100) that day.
export function votes(state, dayKeys) {
  const quick = sessionsIn(dayKeys, state).filter((x) => timeToStart(x) <= QUICK_START_MIN).length;
  let habit = 0;
  for (const k of dayKeys) {
    if (!state.days[k]) continue;
    for (const g of planOf(k, state)?.goals || []) if (goalScore(g, k, state) === 100) habit++;
  }
  return { quick, habit, total: quick + habit };
}

// Consecutive days (back from yesterday, plus today if it has one) with at least one quick start.
export function quickStartStreak(state, todayKey) {
  const has = (k) => (state.sessions?.[k] || []).some((x) => timeToStart(x) <= QUICK_START_MIN);
  let d = parseKey(todayKey);
  if (!has(todayKey)) d = addDays(d, -1);
  let n = 0;
  while (has(dateKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

// ---------- never miss twice ----------
// Habits that scored red (< 34) yesterday. Planned rest days for days/week habits score 100, so they
// don't count as misses.
export function missedYesterday(state, todayKey) {
  const y = dateKey(addDays(parseKey(todayKey), -1));
  if (!state.days[y]) return [];
  return (planOf(y, state)?.goals || []).filter((g) => {
    const s = goalScore(g, y, state);
    return s != null && s < 34;
  }).map((g) => g.id);
}

// ---------- playbook: interventions from the four laws ----------
export const LAWS = {
  obvious: '1st law · Make it obvious',
  easy: '3rd law · Make it easy',
  difficult: 'Inversion · Make it difficult',
  satisfying: '4th law · Make it satisfying',
};

export const PLAYBOOK = [
  {
    id: 'firstStep', law: 'easy', reasons: ['unclear', 'toobig', 'avoid'],
    title: 'Name the first 2-minute action',
    why: 'Vague tasks stall. Deciding the first physical action removes the decision that keeps you from starting.',
    rule: 'Every session asks for the first action (“open the doc, write the heading”) and shows it while you start.',
  },
  {
    id: 'twoMinute', law: 'easy', reasons: ['toobig', 'avoid', 'perfect', 'mood'],
    title: 'Two-minute rule',
    why: 'A habit must be established before it can be improved. Only commit to two minutes; starting is the win.',
    rule: 'Each session celebrates the first 2 minutes of work with a notification. Anything after that is a bonus.',
  },
  {
    id: 'environment', law: 'obvious', reasons: ['distracted', 'interrupted', 'energy'],
    title: 'Prime the environment',
    why: 'Environment beats motivation. Set up the space so the right action is the obvious one.',
    rule: 'Before each session you tick a short checklist (phone away, one tab, water ready). Edit it in Settings.',
  },
  {
    id: 'blocker', law: 'difficult', reasons: ['distracted'],
    title: 'Block the distractions',
    why: 'Make bad habits difficult: add friction between you and the cue.',
    rule: 'While a session runs (not while paused), the sites in Settings → Blocked sites won’t load.',
  },
  {
    id: 'intention', law: 'obvious', reasons: ['perfect', 'interrupted', 'energy', 'mood'],
    title: 'Implementation intentions',
    why: '“I will [do X] at [time] in [place]” doubles follow-through compared with intending to “do it later”.',
    rule: 'After each session, set when the next one starts. You get a reminder then, naming the ticket.',
  },
  {
    id: 'bestTime', law: 'easy', reasons: ['energy', 'avoid', 'toobig'],
    title: 'Hard work in your best hours',
    why: 'Match the task to your energy. Your data shows when you start fastest; protect that block for the hardest ticket.',
    rule: 'The popup shows your fastest-start time of day and today’s readiness; schedule the hardest ticket there.',
  },
];
export const playById = (id) => PLAYBOOK.find((p) => p.id === id) || null;

// ---------- experiments ----------
// experiments: [{ id, playId, reason|null, startDay, endDay|null }] — one active at a time.
export const activeExperiment = (state) => (state.experiments || []).find((e) => !e.endDay) || null;
export const isPlayOn = (state, playId) => activeExperiment(state)?.playId === playId;

// Numbers an experiment is judged on, over a set of days.
export function experimentMetrics(state, dayKeys, reason) {
  const list = sessionsIn(dayKeys, state);
  const starts = list.map(timeToStart);
  const reasonMin = reason ? sum(reasonStats(dayKeys, state).filter((x) => x.id === reason).map((x) => x.min)) : null;
  return {
    sessions: list.length,
    medianStartMin: r1(median(starts)),
    quickStartPct: starts.length ? Math.round((100 * starts.filter((m) => m <= QUICK_START_MIN).length) / starts.length) : null,
    procrastPct: (() => { const p = sum(list.map((x) => Number(x.procrastMin) || 0)); const w = sum(list.map((x) => Number(x.workMin) || 0)); return p + w ? Math.round((100 * p) / (p + w)) : null; })(),
    reasonMinPerSession: reason && list.length ? r1(reasonMin / list.length) : null,
  };
}

// Experiment vs the 14 days before it started. A verdict needs 5+ sessions on each side.
export function experimentReport(state, e, todayKey) {
  const before = lastNDays(dateKey(addDays(parseKey(e.startDay), -1)), 14);
  const end = e.endDay || todayKey;
  const during = [];
  for (let d = parseKey(e.startDay); dateKey(d) <= end; d = addDays(d, 1)) during.push(dateKey(d));
  const b = experimentMetrics(state, before, e.reason);
  const a = experimentMetrics(state, during, e.reason);
  let verdict = 'collecting';
  if (a.sessions >= 5 && b.sessions >= 5 && a.medianStartMin != null && b.medianStartMin != null) {
    const d = a.medianStartMin - b.medianStartMin;
    verdict = d <= -Math.max(1, 0.2 * b.medianStartMin) ? 'working' : d >= Math.max(1, 0.2 * b.medianStartMin) ? 'worse' : 'no clear change';
  }
  return { before: b, during: a, days: during.length, verdict };
}

// What to try next: plays matching your top answered reasons over the last 14 days, best match first.
// If most procrastination has no reason, the first job is to answer "why" (data before fixes).
export function recommendations(state, todayKey) {
  const stats = reasonStats(lastNDays(todayKey, 14), state);
  const total = sum(stats.map((x) => x.min));
  const unrec = stats.find((x) => x.id === 'unrecorded')?.min || 0;
  const answered = stats.filter((x) => x.id !== 'unrecorded');
  const tried = new Set((state.experiments || []).filter((e) => e.endDay).map((e) => e.playId));
  const scored = PLAYBOOK.map((p) => {
    const hits = answered.filter((x) => p.reasons.includes(x.id));
    return { play: p, score: sum(hits.map((x) => x.min)), reason: hits.sort((a, b) => b.min - a.min)[0]?.id || null, tried: tried.has(p.id) };
  }).filter((x) => x.score > 0).sort((a, b) => (a.tried - b.tried) || (b.score - a.score));
  return {
    answerWhyFirst: total > 0 && unrec / total > 0.5,
    unrecordedPct: total ? Math.round((100 * unrec) / total) : null,
    top: answered.slice(0, 3),
    plays: scored.slice(0, 3),
  };
}

// ---------- impact (Whoop journal): what moves your starts ----------
// For each behaviour, compare days it happened with days it didn't (days with timer sessions only).
// A row needs 3+ days on each side; otherwise it says how many more are needed.
export function behaviourImpact(state, endKey, n = 28) {
  const keys = lastNDays(endKey, n).filter((k) => (state.sessions?.[k] || []).length);
  const target = state.settings?.sleepTarget ?? DEFAULT_SETTINGS.sleepTarget;
  const day = (k) => {
    const list = state.sessions[k];
    const p = sum(list.map((x) => Number(x.procrastMin) || 0));
    const w = sum(list.map((x) => Number(x.workMin) || 0));
    return { start: median(list.map(timeToStart)), focusH: w / 60, procrastPct: p + w ? (100 * p) / (p + w) : null };
  };
  const v = (k, key) => state.days[k]?.values?.[key];
  const plan = (k) => planOf(k, state);
  const target_ = (k, gid, mid) => Number(plan(k)?.goals.find((g) => g.id === gid)?.metrics.find((m) => m.id === mid)?.target);
  const behaviours = [
    ['Slept ≥ target', (k) => (state.days[k]?.readiness?.sleepH == null ? null : state.days[k].readiness.sleepH >= target)],
    ['Energy 4–5 on waking', (k) => (state.days[k]?.readiness?.energy == null ? null : state.days[k].readiness.energy >= 4)],
    ['Gym done', (k) => (typeof v(k, 'gym.days') === 'boolean' ? v(k, 'gym.days') : null)],
    ['Morning HIIT done', (k) => (typeof v(k, 'hiit.days') === 'boolean' ? v(k, 'hiit.days') : null)],
    ['Snacking within target', (k) => (v(k, 'snacking.times') == null ? null : Number(v(k, 'snacking.times')) <= target_(k, 'snacking', 'times'))],
    ['Scrolling within target', (k) => (v(k, 'scrolling.hours') == null ? null : Number(v(k, 'scrolling.hours')) <= target_(k, 'scrolling', 'hours'))],
    ['First session before noon', (k) => new Date(Math.min(...state.sessions[k].map((x) => x.start))).getHours() < 12],
  ];
  return behaviours.map(([label, f]) => {
    const yes = keys.filter((k) => f(k) === true).map(day);
    const no = keys.filter((k) => f(k) === false).map(day);
    const m = (xs, key) => r1(median(xs.map((x) => x[key])));
    const enough = yes.length >= 3 && no.length >= 3;
    return {
      label, withDays: yes.length, withoutDays: no.length, enough,
      need: enough ? 0 : Math.max(0, 3 - yes.length) + Math.max(0, 3 - no.length),
      startWith: m(yes, 'start'), startWithout: m(no, 'start'),
      focusWith: m(yes, 'focusH'), focusWithout: m(no, 'focusH'),
      procrastWith: m(yes, 'procrastPct'), procrastWithout: m(no, 'procrastPct'),
    };
  });
}

export { timedMetric, metricKey };
