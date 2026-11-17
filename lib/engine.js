// The behaviour engine: one tactic per focus habit at a time, tried for a week and kept only if it helps
// this person. Grounded in behavioural science; users only ever see the plain-words line.
//
// Trials are stored as tactic records (synced): { id: '<goalId>:<startDay>', goalId, tacticId, startDay,
// endDay|null, status: 'trial' | 'kept' | 'retired', baseline, result }. The id is deterministic, so two
// devices running the engine on the same day write the same record.
// Day-to-day moments (missed yesterday, one to go, new week, quit day) are worked out fresh, never stored.

import { planOf, metricKey, dateKey, addDays, parseKey, weekKeyOf, weekDays, isPaused, streak } from './score.js';
import { focusOf, daysSinceOnboarding, isOnboarded } from './profile.js';
import { tinyOf } from './strategies.js';

const TRIAL_DAYS = 7;
const key = (d) => dateKey(d);
const shift = (k, n) => key(addDays(parseKey(k), n));
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export const kindOf = (g) => {
  const m = g.metrics?.[0];
  if (!m) return 'yesno';
  if (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') return 'yesno';
  if (m.kind === 'perDayMax') return 'limit';
  return 'goal';
};

// ---------- the catalogue (what the user sees is `line`; the science is in the comments) ----------
// fits(ctx): can it be used for this habit and person; barriers: what it answers; tendencies: who it suits.
export const TACTICS = [
  { // Tiny Habits, the two-minute rule
    id: 'tiny-start', barriers: ['time', 'tired', 'start', 'motivation'],
    fits: () => true,
    line: ({ g }) => `This week: ${tinyOf(g).replace(/^./, (c) => c.toLowerCase())}`,
  },
  { // implementation intentions (Gollwitzer), habit stacking
    id: 'if-then', barriers: ['forget', 'time'], tendencies: ['upholder', 'questioner'],
    fits: ({ kind }) => kind !== 'limit',
    line: ({ g }) => (g.intention ? `When: ${g.intention.replace(/^./, (c) => c.toLowerCase())}${g.cueTime ? ` (${g.cueTime})` : ''}` : 'Decide when and where: set it in Week, then Plan'),
    action: ({ g }) => (g.intention ? null : 'plan'),
  },
  { // temptation bundling (Milkman)
    id: 'treat-pairing', barriers: ['boring', 'motivation', 'tired'],
    fits: ({ kind, type }) => kind !== 'limit' && ['gym', 'procrastination', 'reading', 'custom'].includes(type),
    line: () => 'Pair it with something you enjoy, kept just for this: focus radio, a podcast',
  },
  { // urge surfing (Marlatt, Bowen)
    id: 'urge-pause', barriers: ['urges', 'stress'],
    fits: ({ kind }) => kind === 'limit',
    line: () => 'When the urge comes, tap Pause the urge and let it pass',
    action: () => 'urge',
  },
  { // choice architecture: friction for bad habits
    id: 'friction', barriers: ['urges', 'stress', 'distracted'],
    fits: ({ kind }) => kind === 'limit',
    line: () => 'Make it harder: keep it out of reach and out of sight today',
  },
  { // pre-commitment, a Ulysses contract
    id: 'tied-to-mast', barriers: ['distracted', 'motivation', 'start'], tendencies: ['upholder', 'obliger'],
    fits: ({ type }) => type === 'procrastination',
    line: () => 'Tonight, choose tomorrow’s first focus block and commit to it',
  },
  { // reason-seeking tendency: their own numbers
    id: 'show-why', barriers: [], tendencies: ['questioner'],
    fits: ({ kind }) => kind === 'yesno',
    line: ({ rate }) => (rate == null ? 'Each time counts: the numbers will show what works for you' : `You’ve kept it on ${Math.round(rate * 100)}% of planned days lately`),
  },
  { // autonomy (self-determination theory)
    id: 'two-options', barriers: ['motivation'], tendencies: ['rebel'],
    fits: ({ kind }) => kind === 'yesno',
    line: ({ g }) => `Your call today: the full version, or ${tinyOf(g).replace(/^./, (c) => c.toLowerCase())}`,
  },
  { // loss aversion, gently: only for people who said not breaking a streak drives them, after week 2
    id: 'protect-streak', barriers: ['motivation'],
    fits: ({ profile, sinceOnboard, streakLen }) => profile?.motivation === 'protect' && sinceOnboard >= 14 && streakLen >= 3,
    line: ({ streakLen }) => `Keep your ${streakLen}-day streak going`,
  },
];
export const tacticById = (id) => TACTICS.find((t) => t.id === id) || null;

// ---------- adherence: how well a habit went over some days (0–1, or null with nothing to judge) ----------
export function adherence(state, g, dayKeys) {
  const m = g.metrics?.[0];
  if (!m) return null;
  const k = metricKey(g, m);
  const val = (d) => state.days[d]?.values?.[k];
  const days = dayKeys.filter((d) => !isPaused(state, d));
  if (!days.length) return null;
  const t = Number(m.target) || 0;
  if (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') {
    if (m.days?.length) {
      const planned = days.filter((d) => m.days.includes(parseKey(d).getDay()));
      return planned.length ? planned.filter((d) => val(d) === true).length / planned.length : null;
    }
    const expected = (t / 7) * days.length;
    return expected > 0 ? Math.min(1, days.filter((d) => val(d) === true).length / expected) : null;
  }
  const logged = days.filter((d) => val(d) != null && val(d) !== '');
  if (m.kind === 'perDayMax') return logged.length ? logged.filter((d) => Number(val(d)) <= t).length / logged.length : null;
  if (m.kind === 'perDayMin') return logged.length ? logged.filter((d) => Number(val(d)) >= t).length / logged.length : null;
  const sum = days.reduce((a, d) => a + (Number(val(d)) || 0), 0);
  const expected = (t / 7) * days.length;
  return expected > 0 ? Math.min(1, sum / expected) : null;
}
const range = (from, n) => Array.from({ length: n }, (_, i) => shift(from, i));

// ---------- choosing ----------
function ctxFor(state, g, todayKey) {
  const focus = focusOf(state, g.id);
  return {
    g, kind: kindOf(g), type: focus?.type || 'custom', focus, profile: state.profile,
    sinceOnboard: daysSinceOnboarding(state, todayKey), streakLen: streak(state, todayKey),
    rate: adherence(state, g, range(shift(todayKey, -14), 14)),
  };
}

// Best next tactic for a habit: matches the stated barriers and tendency; not one that didn't work lately.
export function pickTactic(state, g, todayKey, history = []) {
  const ctx = ctxFor(state, g, todayKey);
  const barriers = ctx.focus?.barriers || [];
  const recentRetired = new Set(history.filter((x) => x.status === 'retired' && x.startDay >= shift(todayKey, -28)).map((x) => x.tacticId));
  const tried = new Set(history.map((x) => x.tacticId));
  // a brand-new habit starts tiny, unless the person is already doing it often (habits you're cutting
  // down start with whatever best answers their barriers: the urge pause or friction)
  if (!history.length && ctx.kind !== 'limit' && !['often', 'most'].includes(ctx.focus?.baseline)) return 'tiny-start';
  const scored = TACTICS.filter((t) => t.fits(ctx) && !recentRetired.has(t.id)).map((t) => ({
    t,
    score: 2 * (t.barriers || []).filter((b) => barriers.includes(b)).length
      + ((t.tendencies || []).includes(state.profile?.tendency) ? 1.5 : 0)
      + (tried.has(t.id) ? -0.5 : 0),
  })).sort((a, b) => b.score - a.score || TACTICS.indexOf(a.t) - TACTICS.indexOf(b.t));
  return scored[0]?.t.id || 'tiny-start';
}

// Run once a day (any device): end finished trials (kept or retired), start the next ones.
// → records to save (new or changed tactic records).
export function runEngine(state, todayKey = dateKey()) {
  if (!isOnboarded(state)) return [];
  const plan = planOf(todayKey, state);
  if (!plan) return [];
  const all = Object.values(state.tactics || {});
  const out = [];
  for (const h of state.profile.habits || []) {
    const g = plan.goals.find((x) => x.id === h.goalId);
    if (!g) continue;
    const history = all.filter((x) => x.goalId === g.id).sort((a, b) => (a.startDay > b.startDay ? 1 : -1));
    const live = history.filter((x) => !x.endDay).at(-1);
    if (live && shift(live.startDay, TRIAL_DAYS) > todayKey) continue; // still being tried
    if (isPaused(state, todayKey)) continue; // no changes while away
    let next;
    if (live) {
      const trialDays = range(live.startDay, TRIAL_DAYS);
      const result = adherence(state, g, trialDays);
      const baseline = live.baseline ?? null;
      const worked = result != null && (result >= 0.7 || (baseline != null && result >= baseline + 0.1));
      out.push({ ...live, endDay: shift(live.startDay, TRIAL_DAYS - 1), status: worked ? 'kept' : 'retired', result });
      next = worked ? live.tacticId : pickTactic(state, g, todayKey, [...history.slice(0, -1), { ...live, status: 'retired' }]);
    } else next = pickTactic(state, g, todayKey, history);
    out.push({
      id: `${g.id}:${todayKey}`, goalId: g.id, tacticId: next, startDay: todayKey, endDay: null, status: 'trial',
      baseline: adherence(state, g, range(shift(todayKey, -TRIAL_DAYS), TRIAL_DAYS)), result: null,
    });
  }
  return out;
}

export const liveTactic = (state, goalId) => Object.values(state.tactics || {}).filter((x) => x.goalId === goalId && !x.endDay)
  .sort((a, b) => (a.startDay > b.startDay ? 1 : -1)).at(-1) || null;

// ---------- the line a habit card shows today ----------
// → { text, tacticId, action: 'plan' | 'urge' | null, moment: true when it's a day-to-day moment } | null
export function tacticLine(state, g, todayKey = dateKey()) {
  if (!isOnboarded(state) || isPaused(state, todayKey)) return null;
  const kind = kindOf(g);
  const m = g.metrics?.[0];
  const k = m ? metricKey(g, m) : null;
  const today = state.days[todayKey]?.values?.[k];
  const open = today == null;
  // moments first
  if (g.quitDay) {
    if (todayKey < g.quitDay) return { text: `Quit day: ${fmtDay(g.quitDay)}. This week, practise pausing each urge.`, tacticId: 'quit-day', action: 'urge', moment: true };
    const n = Math.round((parseKey(todayKey) - parseKey(g.quitDay)) / 864e5);
    return { text: n === 0 ? 'Quit day. One urge at a time; each one passes.' : `Day ${n + 1} since your quit day. Each urge you ride out gets easier.`, tacticId: 'quit-day', action: 'urge', moment: true };
  }
  if (kind === 'yesno' && open && m) {
    const y = shift(todayKey, -1);
    const plannedY = !m.days?.length || m.days.includes(parseKey(y).getDay());
    const yv = state.days[y]?.values?.[k];
    const plannedToday = !m.days?.length || m.days.includes(parseKey(todayKey).getDay());
    if (plannedY && plannedToday && yv !== true && daysSinceOnboarding(state, todayKey) >= 1 && !isPaused(state, y)) {
      return { text: `Missed yesterday: ${tinyOf(g).replace(/^./, (c) => c.toLowerCase())} today. Never miss twice.`, tacticId: 'never-miss-twice', action: null, moment: true };
    }
    const days = weekDays(weekKeyOf(todayKey));
    const done = days.filter((d) => d < todayKey && state.days[d]?.values?.[k] === true).length;
    if (Number(m.target) - done === 1 && plannedToday) return { text: 'One more and this week’s target is reached.', tacticId: 'head-start', action: null, moment: true };
    if (days[0] === todayKey) {
      const last = adherence(state, g, weekDays(weekKeyOf(shift(todayKey, -7))));
      if (last != null && last < 0.5) return { text: 'New week, clean slate. Start with the small version.', tacticId: 'fresh-start', action: null, moment: true };
    }
  }
  const live = liveTactic(state, g.id);
  if (!live) return null;
  const t = tacticById(live.tacticId);
  if (!t) return null;
  const ctx = ctxFor(state, g, todayKey);
  return { text: t.line(ctx), tacticId: t.id, action: t.action?.(ctx) || null, moment: false };
}

export { DOW3 };
