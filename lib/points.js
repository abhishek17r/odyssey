// Kleos ⚡: one rule each, all for doing (1.10, the simplification plan). Pure: worked out from state every time.
//   a planned habit kept: 10, once a day per habit
//   a timed focus session of 20 minutes or more: 10
//   a task done that you planned before the day you did it: 10
//   at most 100 a day; a finished side quest pays its bonus on top
// Nothing is ever taken away: no minus points. What a skip costs is said in words, not in Kleos.

import { POINTS, MARKET } from '../rewards.config.js';
import { dateKey, parseKey, addDays, weekKeyOf, weekDays, metricKey, ticketList, sessionsIn } from './score.js';
import { limitOn } from './playbooks.js';
import { questEvents } from './quests.js';

export { POINTS, MARKET };
const P = POINTS;
// the rules, in one place (POINTS in rewards.config.js stays for the deprecated dashboard)
export const KLEOS = { each: 10, dailyCap: 100, focusMin: 20 };
const val = (state, k, key) => state.days[k]?.values?.[key];
const has = (v) => v != null && v !== '';
const nextDay = (k) => dateKey(addDays(parseKey(k), 1));
export const plannedOn = (m, dayKey) => !m.days?.length || m.days.includes(parseKey(dayKey).getDay());

// Was a habit kept on day k? (its first measure: done, within the limit, the daily minimum met, or some of the week's total)
export function keptOn(state, g, k) {
  const m = g.metrics?.[0];
  if (!m) return false;
  const v = val(state, k, metricKey(g, m));
  const t = Number(m.target) || 0;
  if (m.kind === 'daysPerWeek') return v === true;
  if (m.kind === 'perDayMax') return has(v) && Number(v) <= limitOn(g, k);
  if (m.kind === 'perDayMin') return t > 0 && has(v) && Number(v) >= t;
  if (m.kind === 'perWeekSum') return has(v) && Number(v) > 0;
  return false;
}

// → [{ day, pts, kind, text }] from P.start to todayKey, newest first
export function pointEvents(state, todayKey) {
  const ev = [];
  const add = (day, kind, text) => { if (day >= P.start && day <= todayKey) ev.push({ day, pts: KLEOS.each, kind, text }); };

  // tasks: done, and planned before the day you did them (adding and ticking in one go pays nothing)
  for (const t of ticketList(state)) {
    if (t.parentId || t.status !== 'done' || !t.doneAt) continue;
    const doneDay = dateKey(new Date(t.doneAt));
    const madeDay = t.createdAt ? dateKey(new Date(t.createdAt)) : null;
    if (madeDay && madeDay < doneDay) add(doneDay, 'task', `Finished “${t.title}”`);
  }
  // habits: each habit in that week's plan, kept, once a day
  for (let k = P.start; k <= todayKey; k = nextDay(k)) {
    for (const g of state.weeks[weekKeyOf(k)]?.goals || []) if (keptOn(state, g, k)) add(k, 'habit', g.name);
  }
  // focus: each timed session of 20 minutes or more
  for (const x of sessionsIn(daysFrom(P.start, todayKey), state)) {
    const min = Number(x.workMin) || 0;
    if (min >= KLEOS.focusMin) add(dateKey(new Date(x.start)), 'focus', `Focus: ${Math.round(min)} min`);
  }
  // at most 100 a day
  const byDay = {};
  for (const e of ev) (byDay[e.day] ??= []).push(e);
  for (const list of Object.values(byDay)) {
    let left = KLEOS.dailyCap;
    for (const e of list) { const keep = Math.max(0, Math.min(e.pts, left)); left -= keep; if (keep < e.pts) { e.capped = e.pts - keep; e.pts = keep; } }
  }
  // side quests pay on top of the cap (they're the stretch)
  for (const q of questEvents(state)) if (q.day >= P.start && q.day <= todayKey) ev.push({ day: q.day, pts: q.pts, kind: 'quest', text: q.text });
  return ev.filter((e) => e.pts > 0).sort((a, b) => b.day.localeCompare(a.day));
}

function daysFrom(a, b) {
  const out = [];
  for (let k = a; k <= b; k = nextDay(k)) out.push(k);
  return out;
}

export function rankOf(total) {
  let i = 0;
  while (i + 1 < P.ranks.length && total >= P.ranks[i + 1][0]) i++;
  const [from, name] = P.ranks[i];
  const next = P.ranks[i + 1] || null;
  return { name, level: i + 1, from, next: next ? { at: next[0], name: next[1] } : null, frac: next ? (total - from) / (next[0] - from) : 1 };
}

// → { total, today, week, events, rank, todayEvents }
export function kleos(state, todayKey) {
  const events = pointEvents(state, todayKey);
  const wk = weekKeyOf(todayKey);
  const sum = (xs) => xs.reduce((a, e) => a + e.pts, 0);
  const total = Math.max(0, sum(events));
  // spent in the marketplace (Kleos purchases only; old money purchases don't count)
  const spent = (state.purchases || []).filter((p) => p.currency === 'kleos').reduce((a, p) => a + (Number(p.price) || 0), 0);
  return {
    total, spent, balance: Math.max(0, total - spent),
    today: sum(events.filter((e) => e.day === todayKey)),
    week: sum(events.filter((e) => weekKeyOf(e.day) === wk)),
    events,
    rank: rankOf(total),
  };
}
