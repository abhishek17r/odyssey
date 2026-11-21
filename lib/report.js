// The week's report (the Report tab, and the Friday-night notification's landing). Code counts; the words
// are templates, with Athena's weekly read on top when it has one.
//
// weekReport(state, wk, todayKey) → {
//   wk, label, finished, onTrack, onTrackBefore, tasks { done, total, movedOn, doneTitles }, focusH, usualFocusH,
//   wins: [text], weak: [{ id, title, why, fix }], read (Athena's weekly read or null)
// }
// Weak spots are ranked by how much they cost the week; at most 3.

import { weekDays, weekKeyOf, parseKey, dateKey, addDays, ticketsInSprint, timeOnDays, reasonStats, reasonById, round1 } from './score.js';
import { onTrack } from './onTrack.js';
import { weeklyRead } from './athena.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const hoursOf = (min) => round1(min / 60);
// what to try when one reason for putting things off stands out
const REASON_FIX = {
  unclear: 'Before you start, write the very next step in one line.',
  toobig: 'Start with a 25-minute piece you can finish, not the whole task.',
  avoid: 'Do 10 minutes of the hard part first, then decide whether to go on.',
  energy: 'Put hard work at your best time of day; keep tired hours for small tasks.',
  mood: 'Start with something small and easy you can finish; be kind to yourself on the rest.',
  distracted: 'Put the phone in another room for each session.',
  interrupted: 'Block focus time in your calendar so others can see it.',
  perfect: 'Aim for a rough first version; you can fix it later.',
};

// The week the Report tab opens on: this week on its last day (Friday), else the last finished week.
export const reportWeekFor = (todayKey) => (weekDays(weekKeyOf(todayKey))[6] === todayKey ? weekKeyOf(todayKey) : shift(weekKeyOf(todayKey), -7));

export function weekLabel(wk) {
  const d = weekDays(wk);
  const f = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${f(d[0])} – ${f(d[6])}`;
}

export function weekReport(state, wk, todayKey) {
  const days = weekDays(wk);
  const upto = todayKey < days[6] ? todayKey : days[6];
  const finished = todayKey >= days[6];
  const ot = onTrack(wk, state, upto);
  const before = onTrack(shift(wk, -7), state, days[0] > todayKey ? todayKey : shift(days[0], -1));

  // tasks planned in this week (including ones that later moved on)
  const tasks = ticketsInSprint(wk, state).filter((t) => !t.parentId);
  const doneIn = (t) => t.status === 'done' && t.doneAt && weekKeyOf(dateKey(new Date(t.doneAt))) === wk;
  const done = tasks.filter(doneIn);
  const notDone = tasks.filter((t) => !doneIn(t));
  const movedOn = notDone.filter((t) => t.sprint && t.sprint > wk).length;

  // focus: this week against the 4 before
  const focusMin = timeOnDays(state, days.filter((k) => k <= upto)).timerMin;
  const prior = [1, 2, 3, 4].map((i) => timeOnDays(state, weekDays(shift(wk, -7 * i))).timerMin).filter((x) => x > 0);
  const usualMin = prior.length >= 2 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;

  const wins = [];
  const weak = [];

  // habits: strong ones are wins; weak ones say which days slipped
  for (const r of ot.rows) {
    if (r.pct == null) continue;
    const g = r.goal;
    if (r.pct >= 90) { wins.push(`${g.name}: ${r.pct}% on track`); continue; }
    if (r.pct >= 70) continue;
    const missed = [...new Set(r.days.filter((d) => d.on === false).map((d) => DAYS[parseKey(d.key).getDay()]))];
    const when = missed.length > 3 ? 'most days' : `on ${and(missed)}`;
    const limit = g.metrics[0]?.kind === 'perDayMax';
    const tiny = g.tiny && !limit ? ` The small version counts: ${g.tiny}.` : '';
    weak.push({
      id: `habit:${g.id}`, cost: 100 - r.pct,
      title: limit ? `${g.name} went over the limit` : `${g.name} slipped`,
      why: missed.length ? `${r.pct}% on track; it ${limit ? 'went over' : 'missed'} ${when}.` : `${r.pct}% on track this week.`,
      fix: limit
        ? 'Note the time and what set it off each time it happens; when the urge comes, use Pause the urge, and plan one thing to do instead at that hour.'
        : missed.length >= 2 && missed.length <= 3
          ? `Make ${and(missed.slice(0, 2))} easier: pick a set time and a reminder for those days.${tiny}`
          : `Give it a set time each day and a reminder, so it isn't left to the evening.${tiny}`,
    });
  }

  // tasks: big ones left to the end, or carried for weeks
  // (a week still running only counts big tasks that are already late)
  const big = notDone.filter((t) => (Number(t.sizeH) || 0) >= 2 && (finished || (t.due && t.due < todayKey)));
  if (big.length >= 2) {
    weak.push({
      id: 'tasks:big', cost: 40 + 10 * big.length,
      title: finished ? 'Big tasks didn’t get done' : 'Big tasks are running late',
      why: `${big.length} ${finished ? `of the ${notDone.length} unfinished tasks were` : 'late tasks are'} 2 hours or more: ${and(big.slice(0, 3).map((t) => `“${t.title}”`))}.`,
      fix: 'Split anything over 2 hours into steps of about an hour, and put the first step on Saturday or Monday.',
    });
  }
  const carried = notDone.filter((t) => (t.sprints || []).filter((w) => w <= wk).length >= 3);
  if (carried.length) {
    const t = carried[0];
    weak.push({
      id: 'tasks:carried', cost: 45,
      title: `“${t.title}” keeps moving`,
      why: `It has been carried ${(t.sprints || []).filter((w) => w <= wk).length - 1} weeks${carried.length > 1 ? `, and ${carried.length - 1} more task${carried.length > 2 ? 's have' : ' has'} too` : ''}.`,
      fix: 'Do the first step first thing on Monday, or drop it: a task that never happens costs more than one you let go.',
    });
  }

  // focus well under usual
  if (usualMin && focusMin < usualMin * 0.6 && finished) {
    weak.push({
      id: 'focus:low', cost: 35,
      title: 'Less focus time than usual',
      why: `${hoursOf(focusMin)} h of focus, against your usual ${hoursOf(usualMin)} h.`,
      fix: 'Book three focus blocks for next week now, at the time of day you usually start fastest.',
    });
  }

  // why sessions were put off, when one reason stands out
  const rs = Object.values(reasonStats(days.filter((k) => k <= upto), state)).sort((a, b) => b.count - a.count);
  if (rs[0] && rs[0].count >= 3 && REASON_FIX[rs[0].id]) {
    const r = reasonById(rs[0].id);
    weak.push({
      id: `delay:${rs[0].id}`, cost: 25 + rs[0].count,
      title: `Starting was slow: “${r?.label || rs[0].id}”`,
      why: `That was the reason ${rs[0].count} times this week.`,
      fix: REASON_FIX[rs[0].id],
    });
  }

  if (done.length) wins.push(`${done.length} task${done.length > 1 ? 's' : ''} done${done[0] ? `, including “${done[0].title}”` : ''}`);
  if (usualMin && focusMin >= usualMin * 1.1) wins.push(`${hoursOf(focusMin)} h of focus, more than your usual ${hoursOf(usualMin)} h`);

  return {
    wk, label: weekLabel(wk), finished,
    onTrack: ot.pct, onTrackBefore: before.pct,
    tasks: { done: done.length, total: tasks.length, movedOn },
    focusH: hoursOf(focusMin), usualFocusH: usualMin ? hoursOf(usualMin) : null,
    wins: wins.slice(0, 3),
    weak: weak.sort((a, b) => b.cost - a.cost).slice(0, 3).map(({ cost, ...w }) => w),
    read: weeklyRead(state, upto, wk) || null,
  };
}

// The weak spots in Athena's words, when her note answers exactly these weak spots (else the code's words).
export function withAthena(R, state, hash) {
  const ai = state.notes?.[`ai-report-${R.wk}`];
  if (!ai?.weak?.length || !R.weak.length || ai.for !== hash(R.weak) || ai.weak.length !== R.weak.length) return R;
  return { ...R, weak: R.weak.map((w, i) => (ai.weak[i]?.id === w.id ? { ...w, ...ai.weak[i] } : w)), weakAI: true };
}
