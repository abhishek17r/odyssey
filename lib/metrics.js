// The measurement framework: every weekly number, computed the same way every time from the raw
// records (sessions, tickets, check-ins). Pure functions, no chrome.* calls.
//
// Definitions (a "session" is one task-timer run; a "stretch" is one procrastination period in it):
//   time to start      — the first stretch of a session (before you first pressed Start working).
//                        Sessions from before stretches were recorded use their total procrastination.
//   quick start        — time to start ≤ QUICK_START_MIN minutes.
//   % procrastinating  — procrastination ÷ (procrastination + work), over all sessions. Paused time is excluded.
//   resumes            — stretches after the first (each Resume after a pause starts one).
//   full length        — work ≥ 95% of the length you set when starting. Sessions without a length are left out.
//   reason minutes     — minutes per reason over stretches; unanswered ones ≥ the ask threshold are "unrecorded".
//   estimate accuracy  — hours logged ÷ size, over tickets that are done and sized (1.0 = spot on).
//   carried over       — tickets in the sprint that were still open when it ended (or are open now, this week).
//   on time            — done tickets with a deadline that were done on or before it ÷ done tickets with a deadline.
//   overdue            — open tickets in the sprint whose deadline has passed (as of the last day counted).
//   habit score        — the daily compliance score, averaged over the days you checked in.
//   time invested      — timer work plus estimates for tickets and habits done without the timer
//                        (estimated hours are reported apart; the starting / focus numbers use the timer only).

import {
  weekDays, weekKeyOf, dateKey, parseKey, addDays, sessionsIn, reasonStats, ticketsInSprint, ticketTitle,
  weekSummary, goalWeekAvg, DEFAULT_SETTINGS, timeOnDays,
} from './score.js';

export const QUICK_START_MIN = 2;
export const HOUR_BLOCKS = [[5, 9, 'Early (5–9)'], [9, 12, 'Morning (9–12)'], [12, 15, 'Midday (12–3)'], [15, 18, 'Afternoon (3–6)'], [18, 21, 'Evening (6–9)'], [21, 29, 'Late (9 pm+)']];

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export function median(xs) {
  const v = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);

export const prevWeek = (wk) => dateKey(addDays(parseKey(wk), -7));
export const timeToStart = (x) => (x.delays?.length ? Number(x.delays[0].min) || 0 : Number(x.procrastMin) || 0);
const blockOf = (ts) => {
  let h = new Date(ts).getHours();
  if (h < 5) h += 24;
  return HOUR_BLOCKS.find(([a, b]) => h >= a && h < b)?.[2] || HOUR_BLOCKS.at(-1)[2];
};

// Everything for one week (Sat → Fri), up to and including uptoKey.
export function weekMetrics(wk, state, uptoKey) {
  const days = weekDays(wk).filter((k) => k <= uptoKey);
  const sessions = sessionsIn(days, state);
  const starts = sessions.map(timeToStart);
  const procrastMin = sum(sessions.map((x) => Number(x.procrastMin) || 0));
  const workMin = sum(sessions.map((x) => Number(x.workMin) || 0));
  const withLength = sessions.filter((x) => x.minutes);
  const ask = state.settings?.askWhyMinutes ?? DEFAULT_SETTINGS.askWhyMinutes;

  // starting, by time of day and by ticket
  const byBlock = HOUR_BLOCKS.map(([, , label]) => {
    const list = sessions.filter((x) => blockOf(x.start) === label);
    return { label, sessions: list.length, medianStart: r1(median(list.map(timeToStart))) };
  }).filter((b) => b.sessions);

  // causes
  const reasons = reasonStats(days, state);
  const reasonMin = sum(reasons.map((x) => x.min));
  const unrecorded = reasons.find((x) => x.id === 'unrecorded');
  const stretches = sessions.flatMap((x) => (x.delays?.length ? x.delays.map((d) => ({ ...d, x })) : [{ min: x.procrastMin, reason: null, x }]))
    .filter((d) => d.reason || d.min >= ask);
  const reasonByTicket = {};
  const reasonByBlock = {};
  for (const d of stretches) {
    const rid = d.reason || 'unrecorded';
    const tid = d.x.ticketId || '(no ticket)';
    reasonByTicket[tid] ??= {};
    reasonByTicket[tid][rid] = r1((reasonByTicket[tid][rid] || 0) + d.min);
    const b = blockOf(d.at && d.at > 1e12 ? d.at : d.x.start);
    reasonByBlock[b] ??= {};
    reasonByBlock[b][rid] = r1((reasonByBlock[b][rid] || 0) + d.min);
  }

  // delivery
  const sprint = ticketsInSprint(wk, state);
  const isCurrent = weekKeyOf(dateKey()) === wk;
  const endOfWeek = addDays(parseKey(wk), 7).getTime();
  const doneIn = (t) => t.status === 'done' && t.doneAt && t.doneAt < endOfWeek && weekKeyOf(dateKey(new Date(t.doneAt))) === wk;
  const loggedOn = (t) => sum(sessions.filter((x) => x.ticketId === t.id).map((x) => Number(x.workMin) || 0)) / 60;
  const allLogged = (t) => sum(sessionsIn(Object.keys(state.sessions || {}), state).filter((x) => x.ticketId === t.id).map((x) => Number(x.workMin) || 0)) / 60;
  const done = sprint.filter(doneIn);
  const carried = sprint.filter((t) => !doneIn(t) && (isCurrent ? t.status !== 'done' : (t.sprints || []).some((w) => w > wk)));
  const sizedDone = done.filter((t) => t.sizeH > 0);
  const dueDone = done.filter((t) => t.due);
  const onTime = dueDone.filter((t) => dateKey(new Date(t.doneAt)) <= t.due);
  const overdue = sprint.filter((t) => t.due && t.due < uptoKey && !doneIn(t));
  const ticketRows = sprint.map((t) => {
    const list = sessions.filter((x) => x.ticketId === t.id);
    return {
      id: t.id, title: ticketTitle(t, state), planned: t.planned, status: t.status, sizeH: t.sizeH ?? null,
      loggedH: r1(loggedOn(t)), sessions: list.length, medianStart: r1(median(list.map(timeToStart))),
      procrastPct: pct(sum(list.map((x) => Number(x.procrastMin) || 0)), sum(list.map((x) => (Number(x.procrastMin) || 0) + (Number(x.workMin) || 0)))),
      done: doneIn(t), carried: carried.includes(t), due: t.due || null,
      onTime: t.due && doneIn(t) ? dateKey(new Date(t.doneAt)) <= t.due : null,
    };
  });
  const unplanned = sprint.filter((t) => !t.planned);

  const tm = timeOnDays(state, days);

  // habits
  const plan = state.weeks[wk];
  const ws = weekSummary(wk, state, uptoKey);

  return {
    week: wk,
    upto: uptoKey,
    starting: {
      sessions: sessions.length,
      medianStartMin: r1(median(starts)),
      quickStartPct: pct(starts.filter((m) => m <= QUICK_START_MIN).length, starts.length),
      byTimeOfDay: byBlock,
    },
    focus: {
      workH: r1(workMin / 60),
      procrastMin: Math.round(procrastMin),
      procrastPct: pct(procrastMin, procrastMin + workMin),
      resumesPerSession: sessions.length ? r1(sum(sessions.map((x) => Math.max(0, (x.delays?.length || 1) - 1))) / sessions.length) : null,
      fullLengthPct: pct(withLength.filter((x) => (Number(x.workMin) || 0) >= 0.95 * x.minutes).length, withLength.length),
    },
    time: {
      totalH: r1(tm.totalMin / 60),
      timerH: r1(tm.timerMin / 60),
      estimatedH: r1(tm.autoMin / 60),
    },
    causes: {
      reasons: reasons.map((x) => ({ ...x, min: r1(x.min), sharePct: pct(x.min, reasonMin) })),
      unrecordedPct: pct(unrecorded?.min || 0, reasonMin),
      byTicket: reasonByTicket,
      byTimeOfDay: reasonByBlock,
    },
    delivery: {
      tickets: sprint.length,
      done: done.length,
      donePlanned: done.filter((t) => t.planned).length,
      unplanned: unplanned.length,
      unplannedH: r1(sum(unplanned.map(loggedOn))),
      carriedOver: carried.length,
      carriedPct: pct(carried.length, sprint.length),
      sizedH: r1(sum(sprint.filter((t) => t.sizeH > 0).map((t) => t.sizeH))),
      loggedH: r1(sum(sprint.map(loggedOn))),
      withDeadline: sprint.filter((t) => t.due).length,
      onTimePct: pct(onTime.length, dueDone.length),
      overdue: overdue.length,
      estimateAccuracy: sizedDone.length ? r1(sum(sizedDone.map(allLogged)) / sum(sizedDone.map((t) => t.sizeH))) : null,
      ticketRows,
    },
    habits: {
      score: ws.avg,
      checkins: ws.checkins,
      thrivingDays: ws.greenDays,
      perHabit: (plan?.goals || []).map((g) => ({ id: g.id, name: g.name, icon: g.icon || '⭐', avg: goalWeekAvg(g, wk, state, uptoKey) })),
    },
    reflections: days.filter((k) => state.days[k]?.reflection).map((k) => ({ day: k, text: state.days[k].reflection })),
  };
}

// Which way is better for each headline number: 1 = higher is better, -1 = lower is better, 0 = neither.
export const HEADLINES = [
  ['starting.medianStartMin', 'Median time to start', 'min', -1],
  ['starting.quickStartPct', `Started within ${QUICK_START_MIN} min`, '%', 1],
  ['focus.procrastPct', '% of session time procrastinating', '%', -1],
  ['focus.workH', 'Hours worked (timer)', 'h', 1],
  ['time.totalH', 'Time invested (timer + estimates)', 'h', 1],
  ['focus.fullLengthPct', 'Sessions run to full length', '%', 1],
  ['focus.resumesPerSession', 'Resumes per session', '', -1],
  ['causes.unrecordedPct', 'Procrastination with no reason given', '%', -1],
  ['delivery.done', 'Tickets done', '', 1],
  ['delivery.carriedPct', 'Tickets carried over', '%', -1],
  ['delivery.onTimePct', 'Done by the deadline', '%', 1],
  ['delivery.overdue', 'Open tickets past deadline', '', -1],
  ['delivery.estimateAccuracy', 'Logged ÷ size (done tickets)', '×', 0],
  ['habits.score', 'Habit score', '', 1],
];
export const pick = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
