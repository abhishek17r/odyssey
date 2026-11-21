// Kleos ⚡: points for doing (finishing tasks, keeping habits, focus), and small minus points for planned
// days missed, limits passed and deadlines missed. Pure: worked out from state every time; the rules are in rewards.config.js.

import { POINTS, MARKET } from '../rewards.config.js';
import { dateKey, parseKey, addDays, weekKeyOf, weekDays, metricKey, ticketList, sessionsIn, isPaused } from './score.js';
import { timeToStart, QUICK_START_MIN } from './metrics.js';
import { laurels, favourDays } from './voyage.js';
import { typeOf } from './playbooks.js';
import { questEvents } from './quests.js';

export { POINTS, MARKET };
const P = POINTS;
const val = (state, k, key) => state.days[k]?.values?.[key];
const has = (v) => v != null && v !== '';
const nextDay = (k) => dateKey(addDays(parseKey(k), 1));
export const plannedOn = (m, dayKey) => !m.days?.length || m.days.includes(parseKey(dayKey).getDay());

// → [{ day, pts, kind, text }] from P.start to todayKey, newest first.
// Paid for doing, never for planning; losses only for planned days missed, limits passed and deadlines missed.
// Keep-a-rule habits and paused days never lose Kleos. Earnings are capped per day (P.dailyCap).
export function pointEvents(state, todayKey) {
  const ev = [];
  const add = (day, pts, kind, text) => { if (pts && day >= P.start && day <= todayKey && !(pts < 0 && isPaused(state, day))) ev.push({ day, pts, kind, text }); };

  // tasks: finished (bigger ones pay more), on time, and days past the deadline
  for (const t of ticketList(state)) {
    const doneDay = t.status === 'done' && t.doneAt ? dateKey(new Date(t.doneAt)) : null;
    if (doneDay) {
      const size = t.parentId ? 0 : Math.min(P.sizeBonusMax, Math.round((Number(t.sizeH) || 0) * P.perHourEstimate));
      add(doneDay, (t.parentId ? P.subtaskDone : P.taskDone) + size, 'task', `Finished “${t.title}”${size ? ` (${t.sizeH} h)` : ''}`);
      if (t.due && doneDay <= t.due && !t.parentId) add(doneDay, P.onTime, 'task', `On time: “${t.title}”`);
    }
    if (t.due && !t.parentId) {
      const end = doneDay || todayKey;
      let n = 0;
      for (let k = nextDay(t.due); k <= end && P.overduePerDay * (n + 1) >= P.overdueMax; k = nextDay(k), n++) {
        if (k === doneDay) break; // finishing on a late day isn't another day late
        add(k, P.overduePerDay, 'penalty', `Overdue: “${t.title}”`);
      }
    }
  }

  // habits, day by day
  const missedBefore = {}; // goalId → the last planned day was missed or skipped (for "back the day after")
  for (let k = P.start; k <= todayKey; k = nextDay(k)) {
    const plan = state.weeks[weekKeyOf(k)];
    if (!plan) continue;
    for (const g of plan.goals) {
      const rule = typeOf(g) === 'rule';
      g.metrics.forEach((m, mi) => {
        const key = metricKey(g, m);
        const v = val(state, k, key);
        const t = Number(m.target) || 0;
        const name = `${g.icon || '⭐'} ${g.name}`;
        if (m.kind === 'daysPerWeek') {
          if (v === true) {
            add(k, P.habitDone, 'habit', name);
            if (missedBefore[g.id]) add(k, P.comeback, 'habit', `Back on course: ${g.name}`);
            missedBefore[g.id] = false;
            const days = weekDays(weekKeyOf(k));
            const done = days.filter((d) => d <= k && val(state, d, key) === true).length;
            if (t > 0 && done === t) add(k, P.weekTargetMet, 'habit', `${g.name}: the week’s target`);
          } else if (v === false) {
            if (!rule) add(k, P.habitSkipped, 'penalty', `Skipped ${g.name}`);
            missedBefore[g.id] = true;
          } else if (k < todayKey && m.days?.length && plannedOn(m, k)) {
            if (!rule) add(k, P.habitMissedPlannedDay, 'penalty', `Missed planned ${g.name}`);
            missedBefore[g.id] = true;
          }
        } else if (m.kind === 'perDayMax' && has(v)) {
          const n = Number(v);
          if (n <= t) {
            add(k, P.limitKept, 'habit', `${name} within the limit`);
            if (missedBefore[g.id] && mi === 0) add(k, P.comeback, 'habit', `Back on course: ${g.name}`);
            if (mi === 0) missedBefore[g.id] = false;
          } else {
            if (!rule) add(k, n <= Math.max(t + 1, t * 1.2) ? P.limitSlightlyOver : P.limitBroken, 'penalty', `${g.name} over the limit`);
            if (mi === 0) missedBefore[g.id] = true;
          }
        } else if (m.kind === 'perDayMin' && has(v) && t > 0 && Number(v) >= t) {
          add(k, P.dailyGoalMet, 'habit', `${name} goal reached`);
        } else if (m.kind === 'perWeekSum' && t > 0 && has(v)) {
          const days = weekDays(weekKeyOf(k));
          const before = days.filter((d) => d < k).reduce((a, d) => a + (Number(val(state, d, key)) || 0), 0);
          if (before < t && before + Number(v) >= t) add(k, P.weekTargetMet, 'habit', `${g.name}: the week’s target`);
        }
      });
    }
  }

  // focus: each 25 minutes worked (up to a daily maximum), and quick starts
  const focusByDay = {};
  for (const x of sessionsIn(daysFrom(P.start, todayKey), state)) {
    const day = dateKey(new Date(x.start));
    focusByDay[day] = (focusByDay[day] || 0) + (Number(x.workMin) || 0);
    if ((Number(x.workMin) || 0) > 0 && timeToStart(x) <= QUICK_START_MIN) add(day, P.quickStart, 'focus', 'Quick start');
  }
  for (const [day, min] of Object.entries(focusByDay)) {
    const pts = Math.min(P.focusDailyMax, Math.floor(min / 25) * P.per25MinFocus);
    add(day, pts, 'focus', `Focus: ${Math.round(min)} min`);
  }

  // urges ridden out with the urge pause
  for (let k = P.start; k <= todayKey; k = nextDay(k)) {
    const n = Object.values(state.days[k]?.urges || {}).reduce((a, u) => a + (Number(u.resisted) || 0), 0);
    if (n) add(k, Math.min(n, P.urgeDailyCap) * P.urgeResisted, 'habit', `Rode out ${n} urge${n > 1 ? 's' : ''}`);
  }

  // a head start: habits done during their tiny-start trial, in the first two weeks after onboarding
  const onboard = state.profile?.onboardedAt ? dateKey(new Date(state.profile.onboardedAt)) : null;
  if (onboard) {
    for (const t of Object.values(state.tactics || {}).filter((x) => x.tacticId === 'tiny-start')) {
      const plan = state.weeks[weekKeyOf(t.startDay)];
      const g = plan?.goals.find((x) => x.id === t.goalId);
      const m = g?.metrics?.[0];
      if (!m || m.kind !== 'daysPerWeek') continue;
      const end = t.endDay || todayKey;
      for (let k = t.startDay; k <= end && k <= todayKey; k = nextDay(k)) {
        if (k > dateKey(addDays(parseKey(onboard), 13))) break;
        if (state.days[k]?.values?.[metricKey(g, m)] === true) add(k, P.tinyStartBonus, 'habit', `Head start: ${g.name}`);
      }
    }
  }

  // laurels and Athena's favour
  for (const l of laurels(state, todayKey).earned) add(l.day, P.laurel, 'laurel', `Laurel: ${l.title} · ${l.detail}`);
  if (state.profile?.onboardedAt) for (const d of favourDays(state, P.start, todayKey)) add(d, P.favour, 'favour', 'Athena’s favour');

  // at most P.dailyCap earned in a day: earnings past it are trimmed (losses always count)
  const byDay = {};
  for (const e of ev) if (e.pts > 0) (byDay[e.day] ??= []).push(e);
  for (const list of Object.values(byDay)) {
    let left = P.dailyCap;
    for (const e of list) { const keep = Math.max(0, Math.min(e.pts, left)); left -= keep; if (keep < e.pts) { e.capped = e.pts - keep; e.pts = keep; } }
  }
  // side quests pay on top of the daily cap (they're the stretch)
  for (const q of questEvents(state)) if (q.day >= P.start && q.day <= todayKey) ev.push({ day: q.day, pts: q.pts, kind: 'quest', text: q.text });
  return ev.filter((e) => e.pts !== 0).sort((a, b) => b.day.localeCompare(a.day));
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
