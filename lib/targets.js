// Where a timer session's time goes, shared by the popup and the dashboard.
// A choice is encoded as "t:<ticketId>" (a ticket), "h:<habitId>" (habit time, no ticket) or "" (nothing).

import { defaultPlan, timedMetric, ticketsInSprint, ticketTitle, TICKET_STATUS, parseKey, addDays, dateKey, backlogTickets, dueInfo } from './score.js';
import { esc } from './ui.js';

const prevWeek = (wk) => dateKey(addDays(parseKey(wk), -7));

// Habits a ticket's time can count toward: those with an hours / minutes metric.
export function timedHabits(wk, state) {
  const plan = state.weeks[wk] || defaultPlan(state.weeks[prevWeek(wk)]);
  return plan.goals.filter((g) => timedMetric(g));
}

// withBacklog: also list open backlog tickets (starting a session on one pulls it into this sprint).
export function targetOptions(wk, cur, state, { openOnly = false, withBacklog = false } = {}) {
  let tickets = ticketsInSprint(wk, state).filter((t) => !openOnly || t.status !== 'done' || `t:${t.id}` === cur);
  if (cur?.startsWith('t:') && !tickets.some((t) => `t:${t.id}` === cur) && state.tickets?.[cur.slice(2)]) tickets.push(state.tickets[cur.slice(2)]);
  // parents first, each followed by its subtasks
  const ordered = [];
  for (const t of tickets.filter((x) => !x.parentId)) ordered.push(t, ...tickets.filter((x) => x.parentId === t.id));
  for (const t of tickets) if (!ordered.includes(t)) ordered.push(t);
  const habits = timedHabits(wk, state);
  const opt = (v, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  const today = dateKey();
  const tOpt = (t) => {
    const d = t.status !== 'done' && dueInfo(t, today);
    return opt(`t:${t.id}`, `${TICKET_STATUS[t.status].icon} ${ticketTitle(t, state)}${d ? ` · ${d.cls === 'overdue' ? '⚠️ ' : ''}${d.text}` : ''}`);
  };
  const backlog = withBacklog ? backlogTickets(state).filter((t) => t.status !== 'done') : [];
  return (ordered.length ? `<optgroup label="Sprint tickets">${ordered.map(tOpt).join('')}</optgroup>` : '') +
    (backlog.length ? `<optgroup label="Backlog (starting one moves it into this sprint)">${backlog.map(tOpt).join('')}</optgroup>` : '') +
    (habits.length ? `<optgroup label="No ticket, just habit time">${habits.map((g) => opt(`h:${g.id}`, `${g.icon || '⭐'} ${g.name}`)).join('')}</optgroup>` : '') +
    opt('', 'Nothing (not counted toward a habit)');
}

// → { ticketId, goalId, goalName } for startSession / updateSession.
export function resolveTarget(v, wk, state) {
  if (v?.startsWith('t:')) {
    const t = state.tickets?.[v.slice(2)];
    const h = t?.habitId ? timedHabits(wk, state).find((g) => g.id === t.habitId) : null;
    return { ticketId: t?.id ?? null, goalId: t?.habitId ?? null, goalName: h?.name || '' };
  }
  if (v?.startsWith('h:')) {
    const g = timedHabits(wk, state).find((y) => y.id === v.slice(2));
    return { ticketId: null, goalId: g?.id ?? null, goalName: g?.name || '' };
  }
  return { ticketId: null, goalId: null, goalName: '' };
}
