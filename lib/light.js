// Odyssey Light (Claude Docs: "Odyssey · Light"), tested A/B against the classic app. Pure: the variant,
// Today as one list grouped by part of day, and "add anything" (a habit or a task, from your words).
//
// Variant: settings.variant = 'classic' | 'light'. A new person is put in one at random on first launch and
// stays there; someone already set up stays classic until they switch in Me. Every usage event carries it.

import { planOf, weekKeyOf, weekDays, metricKey, dateKey, parseKey, addDays } from './score.js';
import { parseQuickAdd } from './quickAdd.js';
import { guessType, makeHabit, limitOn } from './playbooks.js';

export const VARIANTS = ['classic', 'light'];
// → the variant this person is in, and whether it was just chosen (so the app saves it)
export function variantOf(state, rand = Math.random) {
  const v = state.settings?.variant;
  if (VARIANTS.includes(v)) return { variant: v, assigned: false };
  const fresh = !state.profile?.onboardedAt && !Object.keys(state.weeks || {}).length;
  return { variant: fresh ? (rand() < 0.5 ? 'light' : 'classic') : 'classic', assigned: true };
}

const ampm = (t) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
export const PARTS = [['morning', 'MORNING'], ['afternoon', 'AFTERNOON'], ['evening', 'EVENING'], ['any', 'ANY TIME']];
const partOf = (hhmm) => { if (!hhmm) return 'any'; const h = Number(String(hhmm).slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
const hhmmOf = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// Today as one list: the habits due today and today's tasks, each with its part of the day.
// → [{ id, kind: 'habit' | 'limit' | 'amount' | 'task', part, title, sub, done, goalId?, taskId?, key?, value?, step? }]
export function todayItems(state, day) {
  const out = [];
  const plan = planOf(day, state);
  const vals = state.days?.[day]?.values || {};
  const week = weekDays(weekKeyOf(day)).filter((k) => k <= day);
  for (const g of plan?.goals || []) {
    const m = g.metrics?.[0];
    if (!m) continue;
    const key = metricKey(g, m);
    const v = vals[key];
    const when = g.cueTime ? ampm(g.cueTime) : null;
    const part = partOf(g.cueTime);
    const base = { id: `g:${g.id}`, goalId: g.id, key, part, title: g.name };
    if (m.kind === 'daysPerWeek') {
      const doneWeek = week.filter((k) => k !== day && state.days?.[k]?.values?.[key] === true).length;
      const fixed = m.days?.length ? m.days.includes(parseKey(day).getDay()) : null;
      const due = v === true || fixed === true || (fixed === null && doneWeek < (Number(m.target) || 0));
      if (!due) continue;
      out.push({ ...base, kind: 'habit', done: v === true, sub: [when, g.tiny].filter(Boolean).join(' · ') || `${doneWeek} of ${m.target} this week` });
    } else if (m.kind === 'perDayMax') {
      const lim = limitOn(g, day);
      const n = Number(v) || 0;
      out.push({ ...base, kind: 'limit', done: false, value: n, step: m.unit === 'min' ? 5 : 1, sub: `${lim === 0 ? 'None today' : `Under ${lim}${m.unit === 'min' ? ' min' : ''}`} · ${n}${m.unit === 'min' ? ' min' : ''} so far` });
    } else {
      const t = Number(m.target) || 0;
      out.push({ ...base, kind: 'amount', done: m.kind === 'perDayMin' && t > 0 && Number(v) >= t, sub: [when, g.tiny].filter(Boolean).join(' · ') || `${t} ${m.unit || ''} a day` });
    }
  }
  for (const t of Object.values(state.tickets || {})) {
    if (t.parentId) continue;
    const doneToday = t.status === 'done' && t.doneAt && dateKey(new Date(t.doneAt)) === day;
    const dueNow = t.status !== 'done' && t.due && t.due <= day;
    if (!doneToday && !dueNow) continue;
    const at = t.remindAt ? hhmmOf(t.remindAt) : null;
    out.push({ id: `t:${t.id}`, taskId: t.id, kind: 'task', part: partOf(at), title: t.title, done: !!doneToday,
      sub: [at ? ampm(at) : null, t.sizeH ? `${t.sizeH < 1 ? `${Math.round(t.sizeH * 60)} min` : `${t.sizeH} h`}` : null, t.due < day ? 'overdue' : 'due today'].filter(Boolean).join(' · ') });
  }
  return out;
}

// "2 of 5 done": habits and tasks you can tick (limits don't count; they're kept all day)
export function doneCount(items) {
  const tickable = items.filter((i) => i.kind !== 'limit');
  return { done: tickable.filter((i) => i.done).length, of: tickable.length };
}

// ---------- add anything ----------
const HABIT_WORDS = /\b(\d+\s*(x|times|days?)\s*(a|per|each)\s*week|every\s?day|each day|daily|weekdays|every (morning|evening|night)|each (morning|evening|night)|a day\b|habit)\b/i;
const TIME_WORDS = [[/\b(mornings?|early)\b/i, '07:30'], [/\b(lunch|midday|noon)\b/i, '13:00'], [/\b(afternoons?)\b/i, '15:00'], [/\b(evenings?|after work)\b/i, '19:00'], [/\b(nights?|bedtime|before bed)\b/i, '22:00']];

function clockIn(s) {
  const m = s.match(/\bat\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
  if (!m[3] && h < 7) h += 12; // "at 6" means the evening
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}

// Your words → { kind: 'habit', goal, when, preview, details } | { kind: 'task', title, due, sizeH, preview } | { kind: 'exists', goalId } | null
export function parseAnything(text, todayKey, takenIds = []) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (!HABIT_WORDS.test(s)) {
    const q = parseQuickAdd(s, todayKey);
    if (!q.title) return null;
    const due = q.due || todayKey;
    const dueText = due === todayKey ? 'today' : due === dateKey(addDays(parseKey(todayKey), 1)) ? 'tomorrow' : parseKey(due).toLocaleDateString(undefined, { weekday: 'long' });
    return { kind: 'task', title: q.title, due, sizeH: q.sizeH, preview: `A task for ${dueText}${q.sizeH ? `, about ${q.sizeH < 1 ? `${Math.round(q.sizeH * 60)} minutes` : `${q.sizeH} h`}` : ''}.` };
  }
  const count = Number(s.match(/\b(\d+)\s*(x|times|days?)\s*(a|per|each)\s*week/i)?.[1]) || (/(every\s?day|each day|daily)/i.test(s) ? 7 : /weekdays/i.test(s) ? 5 : null);
  let when = clockIn(s);
  if (!when) for (const [re, t] of TIME_WORDS) if (re.test(s)) { when = t; break; }
  const name = s.replace(/\b\d+\s*(x|times|days?)\s*(a|per|each)\s*week\b/ig, '').replace(/\b(every\s?day|each day|daily|weekdays|habit)\b/ig, '')
    .replace(/\bat\s+\d{1,2}(:\d\d)?\s*(am|pm)?\b/ig, '').replace(/\b(in the |every |each )?(mornings?|evenings?|afternoons?|nights?|lunch|midday|noon|after work|before bed|bedtime|early)\b/ig, '')
    .replace(/[,;.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const gu = guessType(name);
  const pbId = gu.playbook || gu.type; // a named playbook, else build / cut / rule
  const nice = name.charAt(0).toUpperCase() + name.slice(1);
  const g = makeHabit(pbId, { name: nice, target: count && count <= 7 ? count : undefined }, todayKey, takenIds);
  const base = g.id.replace(/-\d+$/, '');
  if (takenIds.includes(base) && g.id !== base) return { kind: 'exists', goalId: base, preview: `You already have ${g.name}.` };
  if (when) g.cueTime = when;
  const m = g.metrics[0];
  const how = m.kind === 'perDayMax' ? `a daily limit of ${m.target}${m.unit === 'min' ? ' minutes' : ''}` : m.kind === 'daysPerWeek' ? `${m.target} day${m.target > 1 ? 's' : ''} a week` : `${m.target} ${m.unit} a day`;
  return { kind: 'habit', goal: g, when, preview: `${g.name} · ${how}`, details: [when ? `When: ${ampm(when)}, with a reminder` : 'When: any time (set a time later)', g.tiny ? `Small version: ${g.tiny}` : null].filter(Boolean) };
}

// ---------- the measure, for both variants: taps and time to log the day ----------
// → { taps, first, reported } for today, stored on this phone only (not synced)
export function logMeter(prev, day, now = Date.now()) {
  return prev?.day === day ? prev : { day, taps: 0, first: now, reported: false };
}
