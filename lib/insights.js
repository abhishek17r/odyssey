// What the data says, as nudges: each one names something specific and, where it can, what to do now.
// → [{ tone: 'bad' | 'warn' | 'info' | 'good', icon, title, body, action?: { label, go, arg } }]
//   go: 'today' (log habits) | 'focus' (start a session on task arg) | 'week' | 'review' | 'plan'

import {
  dateKey, parseKey, addDays, weekKeyOf, weekDays, metricKey, lastNDays, goalAvgs, goalTrendKey, rollingAvg,
  streak, ticketsInSprint, sessionsIn, reasonStats, reasonById, round1, planOf,
} from './score.js';
import { timeToStart, HOUR_BLOCKS, median, weekMetrics } from './metrics.js';
import { recommendations } from './coach.js';
import { plannedOn, kleos } from './points.js';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const val = (state, k, key) => state.days[k]?.values?.[key];
const has = (v) => v != null && v !== '';
const hm = (min) => (min >= 60 ? `${round1(min / 60)} h` : `${Math.round(min)} min`);
export const daysText = (days) => [...days].sort((a, b) => ((a + 1) % 7) - ((b + 1) % 7)).map((d) => DOW3[d]).join(' ');

export function insights(state, todayKey) {
  const out = [];
  const push = (x) => out.push(x);
  const wk = weekKeyOf(todayKey);
  const days = weekDays(wk);
  const idx = days.indexOf(todayKey);
  const plan = planOf(todayKey, state);

  // streak about to break
  const loggedToday = Object.keys(state.days[todayKey]?.values || {}).length > 0;
  const st = streak(state, todayKey);
  if (!loggedToday && st >= 2) push({ tone: 'warn', icon: '🔥', title: `Keep your ${st}-day streak`, body: 'Nothing logged today yet. One habit is enough to keep it alive.', action: { label: 'Log today', go: 'today' } });

  // either/or habits: how far from this week's target
  for (const g of plan?.goals || []) for (const m of g.metrics) {
    const key = metricKey(g, m);
    const t = Number(m.target) || 0;
    if (m.kind === 'daysPerWeek' && t > 0) {
      const done = days.filter((k) => val(state, k, key) === true).length;
      const todayOpen = !has(val(state, todayKey, key));
      const left = days.slice(idx).filter((k) => k > todayKey || todayOpen).length;
      const need = t - done;
      const name = `${g.icon || '⭐'} ${g.name}`;
      if (need <= 0) { push({ tone: 'good', icon: '🎉', title: `${g.name}: ${done}/${t} this week`, body: 'Target hit. Anything more is a bonus.' }); continue; }
      const plannedToday = m.days?.length && plannedOn(m, todayKey);
      if (need > left) push({ tone: 'bad', icon: '⚓', title: `${name} can’t reach ${t} this week`, body: `${done}/${t} done, ${left} day${left === 1 ? '' : 's'} left. Do it today anyway: never miss twice.`, action: todayOpen ? { label: 'Log it', go: 'today' } : null });
      else if (need >= left - 1 && todayOpen) push({ tone: 'warn', icon: '⏳', title: `${name}: today counts`, body: `${need} more needed with ${left} day${left === 1 ? '' : 's'} left (including today).`, action: { label: 'Log it', go: 'today' } });
      else if (plannedToday && todayOpen) push({ tone: 'info', icon: '📅', title: `${name} is planned today`, body: `Your days: ${daysText(m.days)}. ${done}/${t} so far.`, action: { label: 'Log it', go: 'today' } });
    }
  }

  // bad habits: which weekday they slip, and clean runs
  const last28 = lastNDays(todayKey, 28);
  for (const g of plan?.goals || []) for (const m of g.metrics.filter((x) => x.kind === 'perDayMax')) {
    const key = metricKey(g, m);
    const t = Number(m.target) || 0;
    const over = last28.filter((k) => has(val(state, k, key)) && Number(val(state, k, key)) > t);
    let clean = 0;
    for (let d = 1; d < 60; d++) { const v = val(state, dateKey(addDays(parseKey(todayKey), -d)), key); if (!has(v) || Number(v) > t) break; clean++; }
    if (clean >= 3) push({ tone: 'good', icon: '💪', title: `${clean} clean days of ${g.name.toLowerCase()}`, body: `Within the limit ${clean} days in a row. Keep the chain.` });
    if (over.length >= 3) {
      const byDow = {};
      for (const k of over) byDow[parseKey(k).getDay()] = (byDow[parseKey(k).getDay()] || 0) + 1;
      const [d, n] = Object.entries(byDow).sort((a, b) => b[1] - a[1])[0];
      const soon = Number(d) === parseKey(todayKey).getDay();
      push({ tone: soon ? 'warn' : 'info', icon: '🍪', title: `${g.name} goes over most on ${DOW[d]}s`, body: `Over the limit ${over.length} of the last 28 days, ${n} of them on ${DOW[d]}s.${soon ? ' That’s today: decide now what you’ll do instead.' : ' Plan around that day.'}` });
    }
  }

  // habits trending up or down (7 days vs 28)
  const g7 = goalAvgs(state, todayKey, 7);
  const g28 = goalAvgs(state, todayKey, 28);
  for (const g of plan?.goals || []) {
    const a = g7.get(goalTrendKey(g))?.avg, b = g28.get(goalTrendKey(g))?.avg;
    if (a == null || b == null) continue;
    if (a - b <= -12) push({ tone: 'warn', icon: '📉', title: `${g.name} is slipping`, body: `Scoring ${a} this week vs ${b} over 4 weeks.` });
    else if (a - b >= 12) push({ tone: 'good', icon: '📈', title: `${g.name} is improving`, body: `Scoring ${a} this week vs ${b} over 4 weeks.` });
  }

  // tasks: overdue, due soon, pace
  const tasks = ticketsInSprint(wk, state).filter((t) => !t.parentId);
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && t.due < todayKey).sort((a, b) => a.due.localeCompare(b.due));
  if (overdue.length) push({ tone: 'bad', icon: '⏰', title: `${overdue.length} task${overdue.length > 1 ? 's' : ''} overdue`, body: `Oldest: “${overdue[0].title}”. Each day overdue costs Kleos. Finish it, or move its date.`, action: { label: 'Start it', go: 'focus', arg: overdue[0].id } });
  const dueSoon = open.filter((t) => t.due && t.due >= todayKey && t.due <= dateKey(addDays(parseKey(todayKey), 1)));
  if (dueSoon.length) push({ tone: 'warn', icon: '📌', title: `${dueSoon.length} due by tomorrow`, body: dueSoon.slice(0, 3).map((t) => `“${t.title}”`).join(', '), action: { label: 'Start', go: 'focus', arg: dueSoon[0].id } });
  const doneN = tasks.length - open.length;
  const elapsed = (idx + 1) / 7;
  if (tasks.length >= 3 && doneN / tasks.length < elapsed - 0.25 && open.length) {
    const next = [...open].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.sizeH || 0) - (a.sizeH || 0))[0];
    push({ tone: 'warn', icon: '🧭', title: `${doneN}/${tasks.length} tasks done, ${Math.round(elapsed * 100)}% of the week gone`, body: `Pick one and start it now: “${next.title}”.`, action: { label: 'Start it', go: 'focus', arg: next.id } });
  }
  const prev = weekMetrics(dateKey(addDays(parseKey(wk), -7)), state, dateKey(addDays(parseKey(wk), -1)));
  if (prev.delivery.carriedOver >= 3) push({ tone: 'info', icon: '↪', title: `${prev.delivery.carriedOver} tasks carried over last week`, body: `You finished ${prev.delivery.done}. Plan about that many: a smaller list you finish beats a long one you don’t.`, action: { label: 'Plan', go: 'week' } });

  // when you start fastest
  const sess = sessionsIn(last28, state);
  if (sess.length >= 6) {
    const blocks = HOUR_BLOCKS.map(([a, , label]) => {
      const list = sess.filter((x) => { let h = new Date(x.start).getHours(); if (h < 5) h += 24; return h >= a && h < (HOUR_BLOCKS.find((b) => b[0] === a)[1]); });
      return { label, n: list.length, med: median(list.map(timeToStart)) };
    }).filter((b) => b.n >= 2);
    if (blocks.length >= 2) {
      const best = [...blocks].sort((a, b) => a.med - b.med)[0];
      const worst = [...blocks].sort((a, b) => b.med - a.med)[0];
      if (worst.med - best.med >= 3) push({ tone: 'info', icon: '🌅', title: `You start fastest: ${best.label.replace(/ \(.*/, '').toLowerCase()}`, body: `Median ${round1(best.med)} min to start then, vs ${round1(worst.med)} min ${worst.label.replace(/ \(.*/, '').toLowerCase()}. Put the hardest task there.` });
    }
  }
  // the main reason you put things off, and an experiment for it
  const rec = recommendations(state, todayKey);
  if (rec.top[0]) {
    const r = reasonById(rec.top[0].id);
    const play = rec.plays[0]?.play;
    push({ tone: 'info', icon: r?.icon || '🤔', title: `Top reason you delay: ${r?.label?.toLowerCase() || rec.top[0].id}`, body: `${hm(rec.top[0].min)} in 14 days.${play ? ` Try: ${play.title}.` : ''}`, action: play ? { label: 'See the experiment', go: 'review' } : null });
  }

  // focus time vs last week at the same point
  const thisMin = sessionsIn(days.slice(0, idx + 1), state).reduce((a, x) => a + (Number(x.workMin) || 0), 0);
  const lastMin = sessionsIn(weekDays(dateKey(addDays(parseKey(wk), -7))).slice(0, idx + 1), state).reduce((a, x) => a + (Number(x.workMin) || 0), 0);
  if (thisMin + lastMin >= 30) {
    const d = thisMin - lastMin;
    push({ tone: d >= 0 ? 'good' : 'warn', icon: '⏱', title: `${hm(thisMin)} focused this week`, body: `${d >= 0 ? `${hm(d)} more` : `${hm(-d)} less`} than last week by this day.`, action: d < 0 ? { label: 'Start a session', go: 'focus' } : null });
  }

  // Kleos: the next rank
  const K = kleos(state, todayKey);
  if (K.rank.next) push({ tone: 'info', icon: '⚡', title: `${K.rank.next.at - K.total} Kleos to ${K.rank.next.name}`, body: `${K.week >= 0 ? '+' : ''}${K.week} this week. Finishing tasks and keeping habits earn the most.`, action: { label: 'How to earn', go: 'rewards' } });

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
