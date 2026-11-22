// Side quests: optional one-off challenges, picked from your own data, that pay bonus Kleos (and so sail the
// ship). Pure: offers and progress are worked out from state; only what you took, reported or stopped is saved
// (profile.quests, synced with the profile).
//
// profile.quests = { fastingOn, active: quest | null, log: [quest + { status: 'done'|'missed'|'stopped', endDay }], skipped: { [offerId]: weekKey } }
// quest = { id, kind, title, why, pts, start, until, day?, need?, goalId?, taskId?, window?, reported? }
//
// Kinds: stretch (a build habit, one more than usual this week), coldturkey (a cut habit at zero for a day,
// once it's held its limit), fast (a fast day, 14:10 then 16:8, only if you turned fasting on), focus (two long
// focus sessions), oldtask (finish the task you keep carrying). At most 3 offers, one active at a time.

import { weekKeyOf, weekDays, dateKey, addDays, parseKey, metricKey, isPaused, ticketList, sessionsIn, dayScore } from './score.js';
import { typeOf, playbookIdOf, isGentle } from './playbooks.js';
import { crisisIn } from './safety.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const val = (state, k, key) => state.days?.[k]?.values?.[key];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (k) => DAY[parseKey(k).getDay()];
export const QUEST_PTS = { stretch: 50, coldturkey: 60, fast: 40, focus: 50, oldtask: 40 };
// 1.11: fasting quests are cut (niche, a safety risk, more to explain); a fast already taken still runs to its end
export const FASTING = false;
const NOUN = { smoking: 'smoke-free', scrolling: 'scroll-free' };

export const questsOf = (state) => state.profile?.quests || {};

// Who should skip a fast day, said plainly on every fasting quest.
export const FAST_SKIP = 'Skip this if you’re pregnant or breastfeeding, under 18, have diabetes or take medicine that needs food, or have had an eating disorder. If you feel unwell, eat: stopping early costs nothing. Unsure? Ask a doctor first.';

// A low or hard week: no stretch quests at all (no fasting, no cold turkey, no extra session), just room.
// Low: anything in the week's reflections that sounds like crisis, or habits under 60% on track over the last 7 days.
export function lowWeek(state, today) {
  for (let i = 0; i < 7; i++) if (crisisIn(state.days?.[shift(today, -i)]?.reflection)) return true;
  const sc = Array.from({ length: 7 }, (_, i) => dayScore(shift(today, -1 - i), state)?.score).filter((x) => x != null);
  return sc.length >= 3 && sc.reduce((a, b) => a + b, 0) / sc.length < 60;
}

// The offers this week → [quest] (best first, at most 3)
export function offers(state, today) {
  const Q = questsOf(state);
  if (isPaused(state, today) || !state.profile?.onboardedAt && !Object.keys(state.weeks || {}).length) return [];
  const wk = weekKeyOf(today);
  const last = weekDays(wk)[6];
  const goals = state.weeks?.[wk]?.goals || [];
  // a week or so of data before any quest; and no extra strain while a limit is slipping
  const logged14 = Array.from({ length: 14 }, (_, i) => shift(today, -1 - i)).filter((d) => state.days?.[d]).length;
  if (logged14 < 5) return [];
  const slipping = goals.some((g) => { const m = g.metrics?.[0]; return m?.kind === 'perDayMax' && Array.from({ length: 4 }, (_, i) => shift(today, -1 - i)).filter((d) => { const v = val(state, d, metricKey(g, m)); return v != null && v !== '' && Number(v) > Number(m.target); }).length >= 2; });
  const low = lowWeek(state, today) || slipping;
  const out = [];
  const add = (q) => { const id = `${q.kind}:${q.goalId || q.taskId || ''}:${wk}`; if (Q.skipped?.[id] !== wk && Q.active?.id !== id && !(Q.log || []).some((x) => x.id === id)) out.push({ ...q, id, pts: QUEST_PTS[q.kind], start: today }); };

  for (const g of goals) {
    const m = g.metrics?.[0];
    if (!m) continue;
    const key = metricKey(g, m);
    const t = Number(m.target) || 0;
    // stretch: a build habit at its weekly target three weeks running → one more this week
    if (!low && typeOf(g) === 'build' && m.kind === 'daysPerWeek' && t > 0 && t < 7) {
      const hit = [1, 2, 3].every((i) => weekDays(shift(wk, -7 * i)).filter((d) => val(state, d, key) === true).length >= t);
      if (hit) {
        // the weekday you most often skip, still ahead this week
        const ahead = weekDays(wk).filter((d) => d > today);
        const doneOn = {};
        for (let i = 1; i <= 4; i++) for (const d of weekDays(shift(wk, -7 * i))) if (val(state, d, key) === true) doneOn[parseKey(d).getDay()] = (doneOn[parseKey(d).getDay()] || 0) + 1;
        const free = ahead.sort((a, b) => (doneOn[parseKey(a).getDay()] || 0) - (doneOn[parseKey(b).getDay()] || 0))[0];
        add({ kind: 'stretch', goalId: g.id, need: t + 1, until: last,
          title: `${g.name}: ${t + 1} this week, not ${t}`,
          why: `${t} a week, three weeks running. One more this week${free ? `: ${dayName(free)} is a day you usually leave free` : ''}.` });
      }
    }
    // cold turkey: a cut habit within its limit for two weeks → a whole day at zero, on your lowest day
    if (!low && m.kind === 'perDayMax' && typeOf(g) === 'cut') {
      const days = Array.from({ length: 14 }, (_, i) => shift(today, -1 - i));
      const logged = days.filter((d) => val(state, d, key) != null && val(state, d, key) !== '');
      const within = logged.filter((d) => Number(val(state, d, key)) <= t);
      if (logged.length >= 10 && within.length >= Math.ceil(logged.length * 0.85)) {
        const avg = {};
        for (const d of Array.from({ length: 28 }, (_, i) => shift(today, -1 - i))) {
          const v = val(state, d, key);
          if (v == null || v === '') continue;
          const w = parseKey(d).getDay();
          (avg[w] ??= []).push(Number(v));
        }
        const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const lowDay = Object.entries(avg).sort((a, b) => mean(a[1]) - mean(b[1]))[0];
        const next = Array.from({ length: 7 }, (_, i) => shift(today, i + 1)).find((d) => lowDay && parseKey(d).getDay() === Number(lowDay[0])) || shift(today, 1);
        const noun = NOUN[playbookIdOf(g)];
        add({ kind: 'coldturkey', goalId: g.id, day: next, until: next,
          title: noun ? `A ${noun} ${dayName(next)}` : `Cold turkey: no ${g.name.toLowerCase()} on ${dayName(next)}`,
          why: `Within your limit of ${t} on ${within.length} of the last ${logged.length} days.${lowDay ? ` ${dayName(next)}s are your lowest day (about ${Math.round(mean(lowDay[1]))}), so a whole day at zero is within reach.` : ''}` });
      }
    }
  }

  // a fast day: only if you turned fasting quests on, never with a gentle tone or in a low week
  if (FASTING && Q.fastingOn && !low && (state.settings?.tone || 'direct') !== 'gentle' && !goals.some((g) => playbookIdOf(g) === 'diet' && isGentle(g, state.settings))) {
    const kept = (Q.log || []).filter((x) => x.kind === 'fast' && x.status === 'done').length;
    const day = shift(today, 1);
    const w = kept ? { hours: 16, from: '12:00', to: '20:00', label: '16:8' } : { hours: 14, from: '10:00', to: '20:00', label: '14:10' };
    add({ kind: 'fast', day, until: day, window: w,
      title: `Fast day (${w.label}): eat between ${w.from === '12:00' ? '12' : '10 am'} and 8 pm`,
      why: kept ? `You’ve kept ${kept} fast day${kept > 1 ? 's' : ''}. This one is ${w.hours} hours, with an 8-hour window to eat.` : 'A first, easy fast: 14 hours, mostly overnight, with a 10-hour window to eat.' });
  }

  // focus: you run focus sessions, but few long ones → two of an hour or more this week
  const recent = sessionsIn(Array.from({ length: 28 }, (_, i) => shift(today, -i)), state);
  if (!low && recent.length >= 4) {
    const long = recent.filter((x) => (Number(x.workMin) || 0) >= 60).length;
    if (long < 4) add({ kind: 'focus', need: 2, until: last, title: 'Two hour-long focus sessions this week', why: `${recent.length} focus sessions in four weeks, ${long} of them an hour or longer. Two deep ones this week.` });
  }

  // the task you keep carrying: finish it this week
  const carried = ticketList(state).filter((x) => !x.parentId && x.status !== 'done' && x.sprint && (x.sprints || []).length >= 3).sort((a, b) => (b.sprints || []).length - (a.sprints || []).length)[0];
  if (carried) add({ kind: 'oldtask', taskId: carried.id, until: last, title: `Finish “${carried.title}”`, why: `Carried ${(carried.sprints || []).length - 1} weeks. Finish it, or split it and finish the first step: either counts once it’s done.` });

  const rank = { coldturkey: 0, stretch: 1, fast: 2, focus: 3, oldtask: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 1); // one on offer at a time (1.11)
}

// How a quest is going → { have, need, done, over, label }
export function progress(q, state, today) {
  const over = today > q.until;
  if (q.kind === 'stretch') {
    const g = state.weeks?.[weekKeyOf(q.start)]?.goals?.find((x) => x.id === q.goalId);
    const key = g && metricKey(g, g.metrics[0]);
    const have = key ? weekDays(weekKeyOf(q.start)).filter((d) => d <= today && val(state, d, key) === true).length : 0;
    return { have, need: q.need, done: have >= q.need, over, label: `${have} of ${q.need}` };
  }
  if (q.kind === 'coldturkey') {
    const g = state.weeks?.[weekKeyOf(q.day)]?.goals?.find((x) => x.id === q.goalId);
    const v = g ? val(state, q.day, metricKey(g, g.metrics[0])) : null;
    const logged = v != null && v !== '';
    const done = logged && Number(v) === 0 && today > q.day; // counts once the day is over at zero
    const broke = logged && Number(v) > 0;
    return { have: done ? 1 : 0, need: 1, done, over: over || broke, label: today < q.day ? `on ${dayName(q.day)}` : broke ? 'not this time' : today === q.day ? 'today: zero so far' : logged ? 'zero all day' : 'log the day to finish' };
  }
  if (q.kind === 'focus') {
    const have = sessionsIn(weekDays(weekKeyOf(q.start)).filter((d) => d <= today), state).filter((x) => (Number(x.workMin) || 0) >= 60).length;
    return { have, need: q.need, done: have >= q.need, over, label: `${have} of ${q.need}` };
  }
  if (q.kind === 'oldtask') {
    const t = state.tickets?.[q.taskId];
    return { have: t?.status === 'done' ? 1 : 0, need: 1, done: t?.status === 'done', over: over || !t, label: t?.status === 'done' ? 'done' : 'open' };
  }
  // fast: your word for it, on the day or the day after
  return { have: q.reported ? 1 : 0, need: 1, done: !!q.reported, over: today > shift(q.day, 1), label: q.reported ? 'kept' : today < q.day ? `on ${dayName(q.day)}` : 'today' };
}

// The fast's clock at `now` (ms) → { phase: 'before' | 'fasting' | 'eating' | 'after', fastedMin, toWindowMin }
export function fastClock(q, now = Date.now()) {
  const at = (k, hhmm) => { const d = parseKey(k); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); };
  const open = at(q.day, q.window.from), close = at(q.day, q.window.to);
  const start = open - q.window.hours * 3600e3; // the evening before
  if (now < start) return { phase: 'before', startsIn: Math.round((start - now) / 60000) };
  if (now < open) return { phase: 'fasting', fastedMin: Math.round((now - start) / 60000), toWindowMin: Math.round((open - now) / 60000) };
  if (now < close) return { phase: 'eating', closesIn: Math.round((close - now) / 60000) };
  return { phase: 'after' };
}

// Kleos from quests: the day each one was done → [{ day, pts, text }]
export const questEvents = (state) => (questsOf(state).log || []).filter((q) => q.status === 'done' && q.endDay).map((q) => ({ day: q.endDay, pts: q.pts, text: `Side quest: ${q.title}` }));

