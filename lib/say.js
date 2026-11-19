// What you said to Siri ("log gym", "one cigarette", "add call the bank tomorrow 30 minutes", "start focus",
// "how's my day") → one action. Pure: the server function uses it to answer Siri straight away, and the app uses
// it to apply the words when it next opens.

import { planOf, metricKey, weekKeyOf, dateKey, ticketsInSprint, ticketTitle, timeOnDay } from './score.js';
import { parseQuickAdd } from './quickAdd.js';
import { playbookIdOf } from './playbooks.js';

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60 };
const SYN = { smoking: ['cigarette', 'cigarettes', 'smoke', 'smoked', 'smokes', 'fag', 'fags'], scrolling: ['scroll', 'scrolled', 'scrolling', 'reels', 'instagram', 'insta', 'phone', 'social'], gym: ['gym', 'workout', 'worked out', 'lifted', 'training', 'trained'], focus: ['focus', 'deep work'], diet: ['diet', 'sugar', 'food rule'] };
const clean = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();

function findGoal(words, goals) {
  let best = null;
  for (const g of goals) {
    const name = clean(g.name);
    const pb = playbookIdOf(g);
    const keys = [name, ...name.split(' ').filter((w) => w.length > 3), ...(SYN[pb] || [])];
    const hit = keys.filter((k) => k && (` ${words} `).includes(` ${k} `)).sort((a, b) => b.length - a.length)[0];
    if (hit && (!best || hit.length > best.len)) best = { g, len: hit.length };
  }
  return best?.g || null;
}
const numberIn = (words) => {
  const m = words.match(/(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  for (const w of words.split(' ')) if (NUM[w]) return NUM[w];
  return null;
};

// → { kind: 'day' | 'focus' | 'task' | 'habit' | 'count' | 'unknown', goalId?, n?, unit?, task?, text }
export function parseSay(text, state, todayKey = dateKey()) {
  const raw = String(text || '').trim();
  const words = clean(raw);
  if (!words) return { kind: 'unknown', text: raw };
  if (/\b(how'?s|how is|what'?s|what is|what do i have)\b.*\b(day|today|left|on)\b|^my day$/.test(words)) return { kind: 'day', text: raw };
  const focus = words.match(/^(?:start(?: a)?|begin)? ?(?:focus|focusing|a session|session|timer)(?: on (.+))?$/) || words.match(/^start (?:a )?(?:focus )?(?:session|timer)(?: on (.+))?$/);
  if (focus) return { kind: 'focus', on: focus[1] || null, text: raw };
  const add = raw.match(/^\s*(?:add|new task|task|to ?do|remind me to|remember to|i need to)\s*[:,]?\s+(.+)$/i);
  if (add) return { kind: 'task', task: parseQuickAdd(add[1], todayKey), text: raw };
  const goals = planOf(todayKey, state)?.goals || [];
  const g = findGoal(words, goals);
  if (g) {
    const m = g.metrics?.[0];
    if (m?.kind === 'daysPerWeek' || m?.kind === 'oncePerWeek') return { kind: 'habit', goalId: g.id, name: g.name, done: !/\b(skip|skipped|didn't|did not|missed)\b/.test(words), text: raw };
    let n = numberIn(words);
    let unit = m?.unit;
    if (/\b(hour|hours|hr|hrs)\b/.test(words)) unit = 'hours';
    else if (/\b(min|mins|minute|minutes)\b/.test(words)) unit = 'min';
    if (n == null) n = 1;
    if (m?.unit === 'hours' && unit === 'min') n = Math.round((n / 60) * 100) / 100;
    if (m?.unit === 'min' && unit === 'hours') n *= 60;
    return { kind: 'count', goalId: g.id, name: g.name, n, unit: m?.unit, text: raw };
  }
  // anything else reads as a task to add
  return { kind: 'task', task: parseQuickAdd(raw, todayKey), text: raw, guessed: true };
}

// What Siri says back. → text
export function replyFor(p, state, todayKey = dateKey()) {
  if (p.kind === 'day') return daySummary(state, todayKey);
  if (p.kind === 'focus') return 'Open Odyssey and your session is ready to start.';
  if (p.kind === 'habit') return p.done ? `${p.name}: done for today.` : `${p.name}: skipped today.`;
  if (p.kind === 'count') return `${p.name}: ${p.n} ${p.unit === 'times' ? '' : p.unit} logged.`.replace(/\s+/g, ' ').replace(' .', '.');
  if (p.kind === 'task') {
    const t = p.task || {};
    const when = t.due ? (t.due === todayKey ? ' for today' : ` for ${t.due}`) : '';
    return t.title ? `Added “${t.title}”${when}.` : 'I didn’t catch a task there.';
  }
  return 'I didn’t catch that.';
}

export function daySummary(state, todayKey = dateKey()) {
  const goals = planOf(todayKey, state)?.goals || [];
  const vals = state.days?.[todayKey]?.values || {};
  const left = goals.filter((g) => g.metrics.some((m) => m.kind !== 'perWeekSum' && (vals[metricKey(g, m)] == null || vals[metricKey(g, m)] === '')));
  const due = ticketsInSprint(weekKeyOf(todayKey), state).filter((t) => !t.parentId && !t.parked && t.status !== 'done' && t.due && t.due <= todayKey);
  const focus = timeOnDay(state, todayKey).totalMin;
  const bits = [];
  bits.push(left.length ? `${left.length} habit${left.length > 1 ? 's' : ''} left: ${left.slice(0, 3).map((g) => g.name).join(', ')}` : 'All your habits are logged');
  bits.push(due.length ? `${due.length} task${due.length > 1 ? 's' : ''} due: ${due.slice(0, 2).map((t) => ticketTitle(t, state)).join(' and ')}` : 'nothing due');
  if (focus) bits.push(`${Math.round(focus)} minutes of focus so far`);
  return `${bits.join('. ')}.`;
}
