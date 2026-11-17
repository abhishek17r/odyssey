// What the reminder notifications say. Pure functions (the background worker sends them).
// Each returns { title, message } or null when there's nothing worth interrupting you for.

import { planOf, metricKey, dateKey, addDays, parseKey, ticketsInSprint, weekKeyOf, metricStatus, timedMetric, timeOnDay } from './score.js';
import { focusTarget } from './coach.js';
import { REWARDS, ruleFor, money } from './rewards.js';

const vals = (state, k) => state.days[k]?.values || {};
const list = (xs, n = 3) => (xs.length > n ? `${xs.slice(0, n).join(', ')} +${xs.length - n} more` : xs.join(', '));

// Habits of the day not answered yet (weekly totals don't need a daily entry).
export function unlogged(state, today) {
  const v = vals(state, today);
  return (planOf(today, state)?.goals || []).filter((g) => g.metrics.some((m) => m.kind !== 'perWeekSum' && m.kind !== 'oncePerWeek' && v[metricKey(g, m)] == null));
}

// Morning: what is due and what is at risk.
export function morningBrief(state, today) {
  const wk = weekKeyOf(today);
  const tomorrow = dateKey(addDays(parseKey(today), 1));
  const open = ticketsInSprint(wk, state).filter((t) => t.status !== 'done' && t.due);
  const overdue = open.filter((t) => t.due < today).map((t) => t.title);
  const dueToday = open.filter((t) => t.due === today).map((t) => t.title);
  const dueTomorrow = open.filter((t) => t.due === tomorrow).map((t) => t.title);
  const lines = [];
  if (overdue.length) lines.push(`⚠️ Overdue: ${list(overdue)}`);
  if (dueToday.length) lines.push(`📌 Due today: ${list(dueToday)}`);
  if (dueTomorrow.length) lines.push(`⏳ Due tomorrow: ${list(dueTomorrow)}`);
  // rewards at risk (only once the week is under way)
  if (today >= REWARDS.startWeek) {
    const plan = planOf(today, state);
    const risky = (plan?.goals || []).filter((g) => ruleFor(g.id) && g.metrics.some((m) => metricStatus(g, m, wk, state, today) === 'risk'));
    if (risky.length) lines.push(`💰 At risk: ${risky.map((g) => `${g.name} (${money(ruleFor(g.id).amount)})`).join(', ')}`);
  }
  if (!lines.length) return null;
  return {
    title: `Good morning ☀️ ${overdue.length + dueToday.length ? `${overdue.length + dueToday.length} task${overdue.length + dueToday.length > 1 ? 's' : ''} need you today` : 'Here’s your day'}`,
    message: lines.join('\n'),
  };
}

// Evening: only if the day isn't complete; names what's left.
export function eveningCheckin(state, today) {
  const e = state.days[today];
  if (e && e.complete !== false) return null;
  const left = unlogged(state, today);
  if (!left.length && e) return null;
  return {
    title: left.length ? `${left.length} habit${left.length > 1 ? 's' : ''} to log ✨` : 'Time to check in ✨',
    message: left.length ? `${list(left.map((g) => `${g.icon || '⭐'} ${g.name}`), 4)}. One tap each in the popup.` : 'One minute: log today and see your score.',
  };
}

// Midday: what's left of the day. Silent when everything's logged, nothing's due and focus is on target.
export function middayNudge(state, today) {
  const left = unlogged(state, today);
  const due = ticketsInSprint(weekKeyOf(today), state).filter((t) => t.status !== 'done' && t.due && t.due <= today);
  const ft = focusTarget(state, today);
  const doneH = Math.round((timeOnDay(state, today).totalMin / 60) * 10) / 10;
  const lines = [];
  if (left.length) lines.push(`${left.length} habit${left.length > 1 ? 's' : ''} to log: ${list(left.map((g) => g.name))}`);
  if (due.length) lines.push(`📌 ${due.length} task${due.length > 1 ? 's' : ''} due: ${list(due.map((t) => t.title), 2)}`);
  if (ft.hours > 0) lines.push(doneH >= ft.hours ? `🎯 Focus: ${doneH} h, target reached` : `🎯 Focus: ${doneH} of ${ft.hours} h so far`);
  if (!left.length && !due.length && doneH >= ft.hours) return null;
  return { title: '🌤️ Midday check', message: lines.join('\n') };
}

// A habit's cue time: nudge unless it's already done (or skipped) today.
export function habitCue(state, today, goalId) {
  const g = planOf(today, state)?.goals.find((x) => x.id === goalId);
  if (!g) return null;
  // a habit planned on certain days only gets its cue on those days
  const dow = new Date(`${today}T12:00`).getDay();
  if (g.metrics.some((m) => m.days?.length) && g.metrics.every((m) => !m.days?.length || !m.days.includes(dow))) return null;
  const v = vals(state, today);
  if (g.metrics.every((m) => v[metricKey(g, m)] != null)) return null;
  const yesNo = g.metrics.length === 1 && g.metrics[0].kind === 'daysPerWeek';
  return {
    title: `${g.icon || '⭐'} ${g.name}${g.estimateMin ? ` · ${g.estimateMin} min` : ''}`,
    message: g.intention || (g.identity ? `${g.identity}. Cast a vote for it now.` : 'Your planned time for this habit.'),
    canTick: yesNo && !timedMetric(g),
  };
}

// HH:MM → next time today/tomorrow (ms).
export function nextAt(hhmm, now = new Date()) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
