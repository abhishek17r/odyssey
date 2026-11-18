// "When" for a task, as the four choices the app offers (Today, Tomorrow, This week, Later) plus a picked
// date. A task lives in a week (its sprint) or in Later (no sprint), and may have a deadline.

import { dateKey, addDays, parseKey, weekKeyOf } from './score.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));

export const WHEN_CHOICES = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later']];

// → { sprint, due } for a choice, or for a date ('YYYY-MM-DD')
export function whenPatch(choice, todayKey = dateKey()) {
  const cur = weekKeyOf(todayKey);
  if (choice === 'today') return { sprint: cur, due: todayKey };
  if (choice === 'tomorrow') { const d = shift(todayKey, 1); return { sprint: weekKeyOf(d), due: d }; }
  if (choice === 'week') return { sprint: cur, due: null };
  if (choice === 'later') return { sprint: null, due: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(choice || '')) {
    const wk = weekKeyOf(choice);
    // this week or next: in that week; further out: in Later, with the deadline
    return { sprint: wk === cur || wk === shift(cur, 7) ? wk : null, due: choice };
  }
  return { sprint: cur, due: null };
}

// Which choice a task is in now: 'today' | 'tomorrow' | 'week' | 'later' | 'date'
export function whenOf(t, todayKey = dateKey()) {
  const cur = weekKeyOf(todayKey);
  if (t.due && t.due <= todayKey && t.sprint) return 'today';
  if (t.due && t.due === shift(todayKey, 1)) return 'tomorrow';
  if (t.sprint == null || t.sprint > cur) return t.due ? 'date' : 'later';
  if (t.sprint === cur && !t.due) return 'week';
  return t.due ? 'date' : 'week';
}

// The Tasks tab's groups (top-level tasks only): today (due today, overdue, or in progress), this week, later, done this week
export function taskGroups(tickets, todayKey = dateKey()) {
  const cur = weekKeyOf(todayKey);
  const all = Object.values(tickets || {}).filter((t) => !t.parentId);
  const open = all.filter((t) => t.status !== 'done');
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || 0) - (b.createdAt || 0);
  const inWeek = (t) => t.sprint === cur || (t.sprint && t.sprint < cur); // older sprints' leftovers count as this week
  const today = open.filter((t) => inWeek(t) && ((t.due && t.due <= todayKey) || t.status === 'doing')).sort(byDue);
  const ids = new Set(today.map((t) => t.id));
  return {
    today,
    week: open.filter((t) => inWeek(t) && !ids.has(t.id)).sort(byDue),
    later: open.filter((t) => t.sprint == null || t.sprint > cur).sort(byDue),
    done: all.filter((t) => t.status === 'done' && t.doneAt && weekKeyOf(dateKey(new Date(t.doneAt))) === cur).sort((a, b) => b.doneAt - a.doneAt),
  };
}

// Sizes to tap, in hours
export const SIZE_CHOICES = [[0.25, '15 min'], [0.5, '30 min'], [1, '1 h'], [2, '2 h'], [4, '4 h']];
export const sizeText = (h) => (h == null ? '' : h < 1 ? `${Math.round(h * 60)} min` : `${h} h`);
