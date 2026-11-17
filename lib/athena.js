// Athena: short notes in a calm, warm, specific voice. For now they are written from templates, filled from
// the engine's picture of the person (their habits, today's tactic lines, their own numbers and words).
// Later an AI rewrites only the wording; these stay as the fallback. Pure: no storage, no DOM, so the push
// function on the server can use them too.
//
// Voice rules: short; specific; the user's own identity words; no shaming; no exclamation marks;
// a Greek reference at most once a week (only in the weekly read).

import {
  planOf, metricKey, dateKey, addDays, parseKey, weekKeyOf, weekDays, isPaused, streakInfo, ticketsInSprint, sessionsIn,
  lastNDays, round1,
} from './score.js';
import { tacticLine, adherence, liveTactic, kindOf, tacticById, pickTactic } from './engine.js';
import { isOnboarded, focusOf } from './profile.js';
import { tinyOf } from './strategies.js';
import { kleos } from './points.js';
import { HOUR_BLOCKS, median, timeToStart } from './metrics.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const lc = (s) => String(s || '').replace(/^./, (c) => c.toLowerCase());
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hm = (min) => (min >= 60 ? `${round1(min / 60)} h` : `${Math.round(min)} min`);
// the same words all day, a different variant on different days
const hash = (s) => [...String(s)].reduce((h, c) => ((h * 31) ^ c.charCodeAt(0)) >>> 0, 7);
const pick = (list, seed) => list.at(hash(seed) % list.length);
const identityOf = (state) => String(state.profile?.identity || '').trim().replace(/^(i am|i'm|to be|be)\s+/i, '').replace(/[.]+$/, '');
const logged = (state, k) => Object.keys(state.days?.[k]?.values || {}).length > 0;
const on = (state) => state.settings?.athenaOn !== false && isOnboarded(state);

// Focus habits in today's plan, with how today stands for each.
function focusToday(state, todayKey) {
  const plan = planOf(todayKey, state);
  return (state.profile?.habits || []).map((h) => plan?.goals.find((g) => g.id === h.goalId)).filter(Boolean).map((g) => {
    const m = g.metrics[0];
    const v = state.days[todayKey]?.values?.[metricKey(g, m)];
    const planned = kindOf(g) !== 'yesno' || !m.days?.length || m.days.includes(parseKey(todayKey).getDay());
    return { g, m, v, planned, done: v === true || (kindOf(g) === 'limit' && v != null && Number(v) <= Number(m.target)) };
  });
}

// ---------- the morning line (also the push in the morning) ----------
// → { text, kind: 'comeback' | 'slip' | 'today' | 'rest' } | null
export function morningLine(state, todayKey = dateKey()) {
  if (!on(state) || isPaused(state, todayKey)) return null;
  const who = identityOf(state);
  const habits = focusToday(state, todayKey);
  // back after two or more days away (not paused)
  const y1 = shift(todayKey, -1), y2 = shift(todayKey, -2);
  const away = [y1, y2].every((k) => !logged(state, k) && !isPaused(state, k)) && Object.keys(state.days || {}).some((k) => k < y2 && logged(state, k));
  if (away) return { kind: 'comeback', text: pick(['Welcome back. No catching up needed: just today’s smallest step.', 'Good to see you again. Start small today; that’s the whole plan.'], todayKey) };
  // a habit's moment (missed yesterday, quit day, one more to go) comes first
  for (const h of habits) {
    const tl = tacticLine(state, h.g, todayKey);
    if (tl?.moment && tl.tacticId === 'never-miss-twice') return { kind: 'slip', text: `${h.g.name} slipped yesterday. Today, just ${lc(tinyOf(h.g))}: never miss twice.` };
    if (tl?.moment && tl.tacticId === 'quit-day') return { kind: 'today', text: tl.text };
  }
  // what's still to do today: a planned yes/no habit not logged, or a daily goal not reached yet
  const planned = habits.filter((h) => h.planned && ((kindOf(h.g) === 'yesno' && h.v == null) || (kindOf(h.g) === 'goal' && h.m.kind === 'perDayMin' && !(Number(h.v) >= Number(h.m.target)))));
  const due = ticketsInSprint(weekKeyOf(todayKey), state).filter((t) => t.status !== 'done' && t.due && t.due <= todayKey);
  const parts = [];
  if (planned.length) {
    const names = planned.map((h) => h.g.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    const first = tacticLine(state, planned[0].g, todayKey);
    parts.push(`Today: ${list}.${first && !first.moment ? ` ${first.text.replace(/^This week: /, '').replace(/^./, (c) => c.toUpperCase())}.` : ''}`);
  } else if (habits.length) {
    parts.push(pick(['A lighter day for your focus habits. Keep the small promises.', 'No planned habits today. Rest counts too.'], todayKey));
  }
  if (due.length) parts.push(due.length === 1 ? `“${due[0].title}” is due.` : `${due.length} tasks are due, starting with “${due[0].title}”.`);
  else if (who && planned.length) parts.push(`Each one is a vote for ${who}.`);
  if (!parts.length) return null;
  return { kind: planned.length ? 'today' : 'rest', text: parts.slice(0, 2).join(' ').replace(/\.\./g, '.') };
}

// ---------- the evening reply, under the reflection ----------
export function eveningReply(state, todayKey = dateKey()) {
  if (!on(state)) return null;
  const text = String(state.days[todayKey]?.reflection || '').trim();
  if (text.length < 8) return null;
  const habits = focusToday(state, todayKey).filter((h) => h.planned);
  const kept = habits.filter((h) => h.done).length;
  const focusMin = sessionsIn([todayKey], state).reduce((a, x) => a + (Number(x.workMin) || 0), 0);
  const facts = [habits.length ? `${kept} of ${habits.length} focus habits kept` : '', focusMin >= 10 ? `${hm(focusMin)} focused` : ''].filter(Boolean).join(', ');
  const good = habits.length ? kept / habits.length >= 0.6 : focusMin >= 30;
  const open = good ? pick(['Thanks for writing it down.', 'Noted, and well done.', 'Good to read.'], `${todayKey}e`) : pick(['Thanks for being honest about it.', 'Some days are like that.', 'Written down is half understood.'], `${todayKey}e`);
  const close = good ? pick(['Rest well.', 'Same again tomorrow.', 'That’s how it compounds.'], `${todayKey}c`) : pick(['Tomorrow starts fresh, with the small version.', 'One small step tomorrow is enough.', 'Rest; tomorrow is a clean slate.'], `${todayKey}c`);
  return `${open} ${facts ? `Today: ${facts}. ` : ''}${close}`;
}

// ---------- the weekly read (Review, Trends, the Friday push) ----------
// → { lines: [text], tone: 'good' | 'mixed' | 'rough' } | null
export function weeklyRead(state, todayKey = dateKey(), wk = weekKeyOf(todayKey)) {
  if (!on(state)) return null;
  const plan = state.weeks?.[wk];
  if (!plan) return null;
  const days = weekDays(wk).filter((k) => k <= todayKey);
  const prevDays = weekDays(shift(wk, -7));
  const habits = (state.profile?.habits || []).map((h) => plan.goals.find((g) => g.id === h.goalId)).filter(Boolean);
  const rows = habits.map((g) => ({ g, now: adherence(state, g, days), before: adherence(state, g, prevDays) })).filter((r) => r.now != null);
  const lines = [];
  const avg = rows.length ? rows.reduce((a, r) => a + r.now, 0) / rows.length : null;
  const prevRows = rows.filter((r) => r.before != null);
  const prevAvg = prevRows.length ? prevRows.reduce((a, r) => a + r.before, 0) / prevRows.length : null;
  const sofar = days.length < 7 ? ' so far' : '';
  if (avg != null) {
    const pct = Math.round(avg * 100);
    const delta = prevAvg == null ? '' : avg - prevAvg >= 0.1 ? ', up from last week' : prevAvg - avg >= 0.1 ? ', down on last week' : ', level with last week';
    lines.push(`You kept your focus habits ${pct}% of the time this week${sofar}${delta}.`);
  }
  const best = [...rows].sort((a, b) => b.now - a.now)[0];
  const worst = [...rows].sort((a, b) => a.now - b.now)[0];
  if (best && best.now >= 0.6) lines.push(`${best.g.name} was your anchor${best.now >= 0.99 ? ': every planned day' : ''}.`);
  if (worst && worst !== best && worst.now < 0.5) {
    // which weekday it slips on, if there's a pattern over four weeks
    const m = worst.g.metrics[0];
    const k = metricKey(worst.g, m);
    const miss = lastNDays(todayKey, 28).filter((d) => !isPaused(state, d) && (kindOf(worst.g) === 'limit' ? Number(state.days[d]?.values?.[k]) > Number(m.target) : (!m.days?.length || m.days.includes(parseKey(d).getDay())) && state.days[d]?.values?.[k] !== true && d < todayKey));
    const byDow = {};
    for (const d of miss) byDow[parseKey(d).getDay()] = (byDow[parseKey(d).getDay()] || 0) + 1;
    const top = Object.entries(byDow).sort((a, b) => b[1] - a[1])[0];
    lines.push(top && top[1] >= 2 ? `${worst.g.name} slips most on ${DOW[top[0]]}s. Worth planning around.` : `${worst.g.name} had the wind against it. Next week, aim for the small version.`);
  }
  // focus and starting
  const sess = sessionsIn(days, state);
  const workMin = sess.reduce((a, x) => a + (Number(x.workMin) || 0), 0);
  if (workMin >= 30) {
    const blocks = HOUR_BLOCKS.map(([a, b, label]) => ({ label, list: sess.filter((x) => { let h = new Date(x.start).getHours(); if (h < 5) h += 24; return h >= a && h < b; }) })).filter((x) => x.list.length >= 2);
    const fastest = blocks.map((b) => ({ ...b, med: median(b.list.map(timeToStart)) })).sort((a, b) => a.med - b.med)[0];
    lines.push(`${hm(workMin)} focused${fastest ? `; you started fastest ${lc(fastest.label.replace(/ \(.*/, ''))}` : ''}.`);
  }
  // what the engine learned
  for (const g of habits) {
    const ended = Object.values(state.tactics || {}).filter((t) => t.goalId === g.id && t.endDay && weekDays(wk).includes(t.endDay)).at(-1);
    if (!ended) continue;
    const name = TACTIC_NAMES[ended.tacticId] || 'This week’s approach';
    lines.push(ended.status === 'kept' ? `${name} worked for ${g.name}: keeping it.` : `${name} didn’t move ${g.name}, so we’ll try something else.`);
    break; // one is enough
  }
  const K = kleos(state, todayKey);
  const wkK = K.events.filter((e) => weekKeyOf(e.day) === wk).reduce((a, e) => a + e.pts, 0);
  if (wkK) lines.push(`${wkK > 0 ? '+' : ''}${wkK} Kleos this week${K.rank.next ? `; ${K.rank.next.at - K.total} to ${K.rank.next.name}` : ''}.`);
  const tone = avg == null ? 'mixed' : avg >= 0.7 ? 'good' : avg >= 0.4 ? 'mixed' : 'rough';
  const who = identityOf(state);
  lines.push({
    good: pick(['Steady sailing toward Ithaca.', `Fair winds. More votes for ${who || 'who you’re becoming'}.`], wk),
    mixed: pick(['Some headwind, but the ship is moving.', 'Not a straight line, and that’s fine.'], wk),
    rough: pick(['Rough seas this week. The ship is still afloat; start small again.', 'A hard week. Next week, just the small versions.'], wk),
  }[tone]);
  return lines.length > 1 ? { lines: lines.slice(0, 7), tone } : null;
}

export const TACTIC_NAMES = {
  'tiny-start': 'The tiny version', 'if-then': 'A set time and place', 'treat-pairing': 'Pairing it with a treat',
  friction: 'Making it harder', 'urge-pause': 'The urge pause', 'tied-to-mast': 'Committing the night before',
  'show-why': 'Seeing your own numbers', 'two-options': 'Choosing your version', 'protect-streak': 'Guarding the streak',
};

// ---------- weekly proposals: small changes to accept or not ----------
// → [{ id, text, change }] (at most 3). The week they apply to: next week from Friday, else this one.
export const proposalWeek = (todayKey) => (weekDays(weekKeyOf(todayKey))[6] === todayKey ? shift(weekKeyOf(todayKey), 7) : weekKeyOf(todayKey));

export function proposals(state, todayKey = dateKey()) {
  if (!on(state) || isPaused(state, todayKey)) return [];
  const wk = weekKeyOf(todayKey);
  const plan = planOf(todayKey, state);
  if (!plan) return [];
  const decided = state.notes?.[`weekly-${proposalWeek(todayKey)}`]?.decisions || {};
  const out = [];
  const weeksBack = (n) => weekDays(shift(wk, -7 * n));
  const onboard = state.profile?.onboardedAt ? dateKey(new Date(state.profile.onboardedAt)) : todayKey;
  // a past week counts only if the habit was logged in it, or it came after onboarding (no judging empty weeks)
  const rateOf = (g, n) => {
    const days = weeksBack(n);
    const k = metricKey(g, g.metrics[0]);
    if (days[6] < onboard && !days.some((d) => state.days[d]?.values?.[k] != null)) return null;
    return adherence(state, g, days);
  };
  for (const h of state.profile?.habits || []) {
    const g = plan.goals.find((x) => x.id === h.goalId);
    if (!g) continue;
    const m = g.metrics[0];
    if (kindOf(g) === 'yesno' && m.kind === 'daysPerWeek') {
      const t = Number(m.target) || 0;
      const last3 = [1, 2, 3].map((n) => rateOf(g, n));
      if (last3.every((r) => r != null && r >= 0.9) && t < 7) {
        out.push({ id: `raise:${g.id}`, text: `${g.name} has stuck for three weeks. Ready for ${t + 1} days a week?`, change: { type: 'target', goalId: g.id, value: t + 1 } });
      } else if (last3.slice(0, 2).every((r) => r != null && r < 0.4) && t > 1) {
        out.push({ id: `lower:${g.id}`, text: `Make ${g.name} easier to win: ${t - 1} days a week for now.`, change: { type: 'target', goalId: g.id, value: t - 1 } });
      }
      if (!m.days?.length && t > 0 && t < 7) {
        // the weekdays it actually happened on most, over four weeks
        const k = metricKey(g, m);
        const counts = [0, 0, 0, 0, 0, 0, 0];
        for (const d of lastNDays(todayKey, 28)) if (state.days[d]?.values?.[k] === true) counts[parseKey(d).getDay()]++;
        const days = counts.map((c, d) => [d, c]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, t).map(([d]) => d).sort((a, b) => a - b);
        const named = days.map((d) => DOW[d].slice(0, 3)).join(', ');
        out.push({ id: `days:${g.id}`, text: `Give ${g.name} fixed days: ${named}. Planned days are easier to keep.`, change: { type: 'days', goalId: g.id, value: days } });
      }
    }
    // a trial that isn't working halfway through: switch early
    const live = liveTactic(state, g.id);
    if (live && shift(live.startDay, 4) <= todayKey) {
      const r = adherence(state, g, weekDays(wk).filter((d) => d >= live.startDay && d < todayKey));
      if (r != null && r < 0.3) {
        const next = pickTactic(state, g, todayKey, [...Object.values(state.tactics || {}).filter((x) => x.goalId === g.id), { ...live, status: 'retired' }]);
        if (next && next !== live.tacticId && tacticById(next)) out.push({ id: `tactic:${g.id}:${next}`, text: `${TACTIC_NAMES[live.tacticId] || 'This approach'} isn’t helping ${g.name}. Try ${lc(TACTIC_NAMES[next] || next)} instead?`, change: { type: 'tactic', goalId: g.id, value: next } });
      }
    }
  }
  // a big task that keeps getting carried: name its first step
  const big = ticketsInSprint(wk, state).filter((t) => t.status !== 'done' && !t.parentId && ((t.sprints || []).length > 1 || (t.due && t.due < todayKey) || Number(t.sizeH) >= 3))
    .filter((t) => !Object.values(state.tickets || {}).some((x) => x.parentId === t.id))
    .sort((a, b) => (b.sprints || []).length - (a.sprints || []).length || (Number(b.sizeH) || 0) - (Number(a.sizeH) || 0))[0];
  if (big) out.push({ id: `step:${big.id}`, text: `“${big.title}” keeps waiting. Add a first step: 25 minutes to start it.`, change: { type: 'firstStep', ticketId: big.id } });
  return out.filter((p) => !decided[p.id]).slice(0, 3);
}

// Apply an accepted proposal to (a copy of) the state → the keys to save.
export function applyProposal(state, p, todayKey = dateKey()) {
  const c = p.change;
  if (c.type === 'firstStep') {
    const t = state.tickets[c.ticketId];
    if (!t) return {};
    const id = `step-${c.ticketId}`;
    const tickets = { ...state.tickets, [id]: { id, title: 'First step: 25 minutes to start', sizeH: 0.5, status: 'todo', habitId: t.habitId ?? null, tags: [], parentId: t.id, sprint: t.sprint, sprints: [t.sprint], planned: true, due: null, createdAt: Date.now(), doneAt: null } };
    return { tickets };
  }
  if (c.type === 'tactic') {
    const live = liveTactic(state, c.goalId);
    const tactics = { ...state.tactics };
    if (live) tactics[live.id] = { ...live, endDay: shift(todayKey, -1) < live.startDay ? live.startDay : shift(todayKey, -1), status: 'retired', result: null };
    const id = `${c.goalId}:${todayKey}`;
    tactics[id] = { id, goalId: c.goalId, tacticId: c.value, startDay: todayKey, endDay: null, status: 'trial', baseline: null, result: null };
    return { tactics };
  }
  // target / days: change the plan of the week it's for, and the weeks after that are already planned
  const target = proposalWeek(todayKey);
  const weeks = structuredClone(state.weeks);
  if (!weeks[target]) {
    const prev = Object.keys(weeks).filter((k) => k < target).sort().at(-1);
    if (prev) weeks[target] = { ...structuredClone(weeks[prev]), setAt: Date.now() };
  }
  for (const wk of Object.keys(weeks).filter((k) => k >= target)) {
    const g = weeks[wk].goals.find((x) => x.id === c.goalId);
    const m = g?.metrics?.[0];
    if (!m) continue;
    if (c.type === 'target') { m.target = c.value; if (m.days?.length && m.days.length > c.value) m.days = m.days.slice(0, c.value); }
    if (c.type === 'days') { m.days = c.value; m.target = c.value.length; }
  }
  return { weeks };
}

// Remember a decision (accepted or not now) so the proposal doesn't come back that week.
export function decide(state, p, decision, todayKey = dateKey()) {
  const id = `weekly-${proposalWeek(todayKey)}`;
  const note = state.notes?.[id] || { id, kind: 'weekly', week: proposalWeek(todayKey), decisions: {} };
  return { notes: { ...(state.notes || {}), [id]: { ...note, decisions: { ...note.decisions, [p.id]: decision }, at: Date.now() } } };
}

// Today's line, dismissed for the day?
export const lineDismissed = (state, todayKey) => !!state.notes?.[`day-${todayKey}`]?.dismissed;
export function dismissLine(state, todayKey) {
  const id = `day-${todayKey}`;
  return { notes: { ...(state.notes || {}), [id]: { id, kind: 'day', day: todayKey, dismissed: true, at: Date.now() } } };
}
