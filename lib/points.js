// Kleos ⚡: points for creating and finishing tasks, keeping habits and streaks, and minus points for the
// behaviour you're trying to drop. Pure: worked out from state every time; the rules are in rewards.config.js.

import { POINTS } from '../rewards.config.js';
import { dateKey, parseKey, addDays, weekKeyOf, weekDays, metricKey, ticketList, sessionsIn, weekSummary, isPaused, streakInfo } from './score.js';
import { timeToStart, QUICK_START_MIN } from './metrics.js';
import { laurels, favourDays } from './voyage.js';

export { POINTS };
const P = POINTS;
const val = (state, k, key) => state.days[k]?.values?.[key];
const has = (v) => v != null && v !== '';
const nextDay = (k) => dateKey(addDays(parseKey(k), 1));
export const plannedOn = (m, dayKey) => !m.days?.length || m.days.includes(parseKey(dayKey).getDay());

// → [{ day, pts, kind, text }] from P.start to todayKey, newest first.
export function pointEvents(state, todayKey) {
  const ev = [];
  // paused days (sick, travelling) never cost points
  const add = (day, pts, kind, text) => { if (pts && day >= P.start && day <= todayKey && !(pts < 0 && isPaused(state, day))) ev.push({ day, pts, kind, text }); };

  // tasks
  const created = {};
  for (const t of ticketList(state)) {
    const c = t.createdAt && dateKey(new Date(t.createdAt));
    if (c && (created[c] = (created[c] || 0) + 1) <= P.taskCreatedDailyCap) add(c, P.taskCreated, 'task', `Planned “${t.title}”`);
    const doneDay = t.status === 'done' && t.doneAt ? dateKey(new Date(t.doneAt)) : null;
    if (doneDay) {
      const size = t.parentId ? 0 : Math.min(P.sizeBonusMax, Math.round((Number(t.sizeH) || 0) * P.perHourEstimate));
      add(doneDay, (t.parentId ? P.subtaskDone : P.taskDone) + size, 'task', `Finished “${t.title}”${size ? ` (${t.sizeH} h)` : ''}`);
      if (t.due && doneDay <= t.due) add(doneDay, P.onTime, 'task', `On time: “${t.title}”`);
    }
    if (t.due) {
      const end = doneDay || todayKey;
      let n = 0;
      for (let k = nextDay(t.due); k <= end && P.overduePerDay * (n + 1) >= P.overdueMax; k = nextDay(k), n++) {
        if (k === doneDay) break; // finishing on a late day isn't another day late
        add(k, P.overduePerDay, 'penalty', `Overdue: “${t.title}”`);
      }
    }
  }

  // habits, day by day
  for (let k = P.start; k <= todayKey; k = nextDay(k)) {
    const plan = state.weeks[weekKeyOf(k)];
    if (!plan) continue;
    for (const g of plan.goals) for (const m of g.metrics) {
      const key = metricKey(g, m);
      const v = val(state, k, key);
      const t = Number(m.target) || 0;
      if (m.kind === 'daysPerWeek') {
        if (v === true) add(k, P.habitDone, 'habit', `${g.icon || '⭐'} ${g.name}`);
        else if (v === false) add(k, P.habitSkipped, 'penalty', `Skipped ${g.name}`);
        else if (k < todayKey && m.days?.length && plannedOn(m, k)) add(k, P.habitMissedPlannedDay, 'penalty', `Missed planned ${g.name}`);
      } else if (m.kind === 'perDayMax' && has(v)) {
        if (Number(v) <= t) add(k, P.limitKept, 'habit', `${g.icon || '⭐'} ${g.name} within limit`);
        else add(k, P.limitBroken, 'penalty', `${g.name} over the limit`);
      } else if (m.kind === 'perDayMin' && has(v) && t > 0 && Number(v) >= t) {
        add(k, P.dailyGoalMet, 'habit', `${g.icon || '⭐'} ${g.name} goal reached`);
      } else if (m.kind === 'perWeekSum' && t > 0 && has(v)) {
        const days = weekDays(weekKeyOf(k));
        const before = days.filter((d) => d < k).reduce((a, d) => a + (Number(val(state, d, key)) || 0), 0);
        if (before < t && before + Number(v) >= t) add(k, P.weeklyGoalMet, 'habit', `${g.icon || '⭐'} ${g.name}: week’s goal`);
      }
    }
  }

  // focus sessions
  for (const x of sessionsIn(daysFrom(P.start, todayKey), state)) {
    const day = dateKey(new Date(x.start));
    const work = Math.min(P.focusMaxPerSession, Math.floor((Number(x.workMin) || 0) / 5) * P.per5MinFocus);
    add(day, work, 'focus', `Focus: ${x.task || 'session'} (${Math.round(x.workMin || 0)} min)`);
    if ((Number(x.workMin) || 0) > 0 && timeToStart(x) <= QUICK_START_MIN) add(day, P.quickStart, 'focus', 'Quick start');
    const over = (Number(x.procrastMin) || 0) - P.procrastFreeMin;
    if (over > 0) add(day, Math.max(P.procrastMaxPerSession, Math.ceil(over / 10) * P.procrastPer10Min), 'penalty', `${Math.round(x.procrastMin)} min procrastinating`);
  }

  // streaks (with Aegis shields), worked out by the same walk the streak number uses
  for (const e of streakInfo(state, todayKey).events) {
    if (e.type === 'milestone' && P.streakMilestones[e.run]) add(e.day, P.streakMilestones[e.run], 'streak', `🔥 ${e.run}-day streak`);
    else if (e.type === 'broken') add(e.day, P.streakBroken, 'penalty', `Streak of ${e.run} broken`);
  }

  // comebacks: logging again after two or more missed days (paused days aren't missed)
  const logged = (k) => Object.keys(state.days[k]?.values || {}).length > 0;
  let gap = 0, seen = false;
  for (let k = dateKey(addDays(parseKey(P.start), -30)); k <= todayKey; k = nextDay(k)) {
    if (logged(k)) {
      if (seen && gap >= 2) add(k, P.comeback, 'streak', 'Back on course');
      seen = true; gap = 0;
    } else if (!isPaused(state, k) && k < todayKey) gap++;
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

  // weeks that ended green
  for (let wk = weekKeyOf(P.start); wk < weekKeyOf(todayKey); wk = dateKey(addDays(parseKey(wk), 7))) {
    const s = weekSummary(wk, state, weekDays(wk)[6]);
    if (s.avg != null && s.avg >= 67) add(weekDays(wk)[6], P.greenWeek, 'streak', '🟢 Green week');
  }
  return ev.sort((a, b) => b.day.localeCompare(a.day));
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
  return {
    total,
    today: sum(events.filter((e) => e.day === todayKey)),
    week: sum(events.filter((e) => weekKeyOf(e.day) === wk)),
    events,
    rank: rankOf(total),
  };
}
