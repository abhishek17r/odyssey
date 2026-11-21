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
  const all = Object.values(tickets || {}).filter((t) => !t.parentId && !t.parked); // parked thoughts wait in their own group
  const open = all.filter((t) => t.status !== 'done');
  // your own order first (drag to reorder sets `rank`), then by due date, then oldest first
  const byDue = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || 0) - (b.createdAt || 0);
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

// ---------- reminders for a task (t.remindAt: ms, or null) ----------
const at = (dayKey, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = parseKey(dayKey); d.setHours(h, m, 0, 0); return d.getTime(); };
// The one-tap choices for a task due on `due` (or no date). → [[key, label, ms]] (only times still ahead)
export function remindChoices(due, todayKey = dateKey(), now = Date.now()) {
  const out = [];
  if (due) {
    if (due > todayKey) out.push(['eve', 'Evening before', at(shift(due, -1), '19:00')]);
    out.push(['morning', due === todayKey ? 'This morning' : 'Morning of', at(due, '09:00')]);
  }
  out.push(['hour', 'In 1 hour', Math.round((now + 3600e3) / 60e3) * 60e3]);
  if (!due || due > shift(todayKey, 1)) out.push(['tmrw', 'Tomorrow 9 am', at(shift(todayKey, 1), '09:00')]);
  return out.filter(([, , ms]) => ms > now);
}
// "Thu 9:00 am", "today 7:00 pm"
export function remindText(ms, todayKey = dateKey()) {
  const d = new Date(ms);
  const k = dateKey(d);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = k === todayKey ? 'today' : k === shift(todayKey, 1) ? 'tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${time}`;
}
// <input type=datetime-local> value ↔ ms
export const toLocalInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
export const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);
