// The brain's facts layer (docs/brain.md, layer 1): one small JSON per person per day, worked out by code from
// the same pure functions the app uses. No AI, no free text you wrote (task titles only; notes, reflections and
// habit "why"s stay out unless the person turns on "Use my notes"). Every number the AI may say comes from here.

import { planOf, weekKeyOf, weekDays, metricKey, isPaused, dateKey, addDays, parseKey, ticketList, sessionsIn, reasonById } from './score.js';
import { playbookIdOf, typeOf, weekRun, underRun, limitOn, stakeLine, triggers, byHour, weekLoad, moneyKept, ladderReady } from './playbooks.js';
import { timeToStart } from './metrics.js';
import { sail, trialText } from './sail.js';
import { kleos } from './points.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r1 = (x) => Math.round(x * 10) / 10;
const val = (state, k, key) => state.days?.[k]?.values?.[key];
const has = (v) => v != null && v !== '';
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const back = (todayKey, n, from = 1) => Array.from({ length: n }, (_, i) => shift(todayKey, -i - from));
const safe = (f, fallback = null) => { try { return f(); } catch { return fallback; } };

// one day's result for a habit: true kept / false missed / null nothing to judge
function dayOk(g, m, state, k) {
  const v = val(state, k, metricKey(g, m));
  if (m.kind === 'daysPerWeek') return v === true ? true : null; // a day off is not a miss on its own
  if (!has(v)) return null;
  if (m.kind === 'perDayMax') return Number(v) <= limitOn(g, k);
  return Number(v) >= (Number(m.target) || 0);
}
const okCount = (g, m, state, days) => days.map((k) => dayOk(g, m, state, k)).filter((x) => x === true).length;
const loggedCount = (g, m, state, days) => days.filter((k) => has(val(state, k, metricKey(g, m)))).length;

function habitFacts(g, state, todayKey, hour) {
  const m = g.metrics?.[0];
  if (!m) return null;
  const wk = weekKeyOf(todayKey);
  const days = weekDays(wk);
  const soFar = days.filter((k) => k <= todayKey);
  const left = days.filter((k) => k >= todayKey && !isPaused(state, k)).length;
  const key = metricKey(g, m);
  const type = typeOf(g);
  const pb = playbookIdOf(g);
  const out = { id: g.id, name: g.name, playbook: pb, type, unit: m.unit || null, target: Number(m.target) || 0 };
  const done = () => soFar.filter((k) => val(state, k, key) === true).length;

  if (m.kind === 'daysPerWeek') {
    const d = done();
    out.thisWeek = { done: d, stillNeeded: Math.max(0, out.target - d), daysLeft: left };
    out.run = { weeksInARowOnTarget: weekRun(g, state, todayKey).run };
    const now = okCount(g, m, state, back(todayKey, 28, 0)), before = okCount(g, m, state, back(todayKey, 28, 28));
    out.last4Weeks = type === 'rule' ? { daysKept: now, of: 28 } : { done: now, target: out.target * 4 };
    out.trend = trendOf(now, before, 2);
    // when it happens: weekends only, or back after a gap
    const doneDays = back(todayKey, 28).filter((k) => val(state, k, key) === true);
    const wkend = doneDays.filter((k) => [0, 6].includes(parseKey(k).getDay())).length;
    if (doneDays.length >= 4 && wkend === doneDays.length) out.pattern = 'only at weekends in the last 4 weeks';
    const last = back(todayKey, 60).findIndex((k) => val(state, k, key) === true);
    if (last === 0) { const prev = back(todayKey, 59, 2).findIndex((k) => val(state, k, key) === true); if (prev < 0 || prev >= 5) out.backYesterday = { afterDaysOff: prev < 0 ? null : prev + 1 }; }
    else if (last > 0) out.daysSinceLast = last + 1;
    else if (d === 0) out.daysSinceLast = null;
  } else if (m.kind === 'perDayMax') {
    out.limitToday = limitOn(g, todayKey);
    const logged = soFar.filter((k) => has(val(state, k, key)));
    out.thisWeek = { daysWithinLimit: logged.filter((k) => Number(val(state, k, key)) <= limitOn(g, k)).length, daysOverLimit: logged.filter((k) => Number(val(state, k, key)) > limitOn(g, k)).length, daysLogged: logged.length };
    out.run = { daysInARowWithinLimit: underRun(g, state, todayKey) };
    const avg = (ds) => { const vs = ds.map((k) => val(state, k, key)).filter(has).map(Number); return vs.length ? r1(sum(vs) / vs.length) : null; };
    const now = avg(back(todayKey, 7)), before = avg(back(todayKey, 7, 8));
    out.averagePerDay = { last7Days: now, the7DaysBefore: before, whenStarted: g.baseline ?? null };
    const l28 = back(todayKey, 28);
    out.last4Weeks = { daysWithinLimit: okCount(g, m, state, l28), daysLogged: loggedCount(g, m, state, l28) };
    out.trend = now == null || before == null ? 'flat' : trendOf(before, now, m.unit === 'times' ? 0.5 : 5); // lower is better
    if (pb === 'smoking' && g.smoking?.price) { const k = safe(() => moneyKept(g, state, todayKey), 0); if (k > 0) out.rupeesKeptThisMonth = Math.round(k); }
    const hours = safe(() => byHour(g, state, todayKey));
    if (hours) { const top = [...hours].sort((a, b) => b.n - a.n)[0]; if (top?.n) out.mostOftenAt = top.label.toLowerCase(); }
    const tr = safe(() => triggers(g, state, todayKey), []).slice(0, 3);
    if (tr.length) out.triggers = tr.map(({ tag, pct }) => ({ tag, percent: pct }));
  } else {
    // daily minimum (focus hours) or a weekly sum
    const got = sum(soFar.map((k) => Number(val(state, k, key)) || 0));
    const need = m.kind === 'perWeekSum' ? out.target : out.target * 5; // a daily minimum counts on working days (5 of 7), as weekRun does
    out.thisWeek = { done: r1(got), stillNeeded: r1(Math.max(0, need - got)), daysLeft: left };
    out.run = { weeksInARowOnTarget: weekRun(g, state, todayKey).run };
    const tot = (ds) => r1(sum(ds.map((k) => Number(val(state, k, key)) || 0)));
    out.last4Weeks = { total: tot(back(todayKey, 28, 0)), the4WeeksBefore: tot(back(todayKey, 28, 28)) };
    out.trend = trendOf(out.last4Weeks.total, out.last4Weeks.the4WeeksBefore, out.target * 2);
  }
  if (g.tiny) out.tiny = g.tiny;
  if (g.ladder?.length && safe(() => ladderReady(g, state, todayKey), false)) out.readyForNextRule = true;
  const st = safe(() => stakeLine(g, state, todayKey, state.days?.[todayKey]?.values || {}, hour));
  if (st?.text) out.stake = { tone: st.tone, text: plain(st.text) };
  return out;
}
const trendOf = (now, before, step) => (now - before >= step ? 'up' : before - now >= step ? 'down' : 'flat');

function taskFacts(state, todayKey) {
  const wk = weekKeyOf(todayKey);
  const tops = ticketList(state).filter((t) => !t.parentId && !t.parked);
  const open = tops.filter((t) => t.status !== 'done');
  const doneThisWeek = tops.filter((t) => t.status === 'done' && t.doneAt && weekKeyOf(dateKey(new Date(t.doneAt))) === wk);
  const daysTo = (d) => Math.round((parseKey(d) - parseKey(todayKey)) / 864e5);
  const load = safe(() => weekLoad(state, todayKey));
  const rank = (t) => (t.due ? daysTo(t.due) : 99) - (t.sprint === wk ? 1 : 0);
  const list = [...open].sort((a, b) => rank(a) - rank(b) || (a.createdAt || 0) - (b.createdAt || 0)).slice(0, 10).map((t) => {
    const x = { id: t.id, title: String(t.title || '').slice(0, 80) };
    if (t.due) { const n = daysTo(t.due); x.due = n < 0 ? `${-n} days ago` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`; }
    if (t.sizeH) x.sizeH = Number(t.sizeH);
    if (t.sprint === wk) x.thisWeek = true;
    const carried = t.sprint && t.createdAt ? Math.max(0, Math.floor((parseKey(wk) - parseKey(weekKeyOf(dateKey(new Date(t.createdAt))))) / (7 * 864e5))) : 0;
    if (carried) x.weeksCarried = carried;
    if (t.loss) x.ifMissed = String(t.loss).slice(0, 80);
    const steps = tops.length ? ticketList(state).filter((s) => s.parentId === t.id) : [];
    if (steps.length) x.steps = { done: steps.filter((s) => s.status === 'done').length, of: steps.length };
    return x;
  });
  return {
    open: open.length,
    dueToday: open.filter((t) => t.due === todayKey).length,
    overdue: open.filter((t) => t.due && t.due < todayKey).length,
    doneThisWeek: doneThisWeek.length,
    hours: load ? { plannedThisWeek: load.open, usuallyFinishedPerWeek: load.usual, finishedThisWeek: load.doneThis, likelyLeftOver: load.spill } : null,
    list,
  };
}

function focusFacts(state, todayKey) {
  const wk = weekKeyOf(todayKey);
  const mins = (ds) => Math.round(sum(sessionsIn(ds, state).map((x) => Number(x.workMin) || 0)));
  const thisWeek = weekDays(wk).filter((k) => k <= todayKey);
  const prior = [1, 2, 3, 4].map((i) => mins(weekDays(shift(wk, -7 * i))));
  const recent = sessionsIn(back(todayKey, 28, 0), state);
  if (!recent.length && !mins(thisWeek)) return null;
  const starts = recent.map(timeToStart).sort((a, b) => a - b);
  const reasons = {};
  for (const x of recent) for (const d of x.delays || []) if (d.reason) reasons[d.reason] = (reasons[d.reason] || 0) + (Number(d.min) || 0);
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  const byBlock = {};
  for (const x of recent) { if (!x.start) continue; const h = new Date(x.start).getHours(); const b = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; (byBlock[b] ??= []).push(Number(x.workMin) || 0); }
  const best = Object.entries(byBlock).map(([b, xs]) => [b, sum(xs) / xs.length]).sort((a, b) => b[1] - a[1])[0];
  return {
    minutesThisWeek: mins(thisWeek),
    usualMinutesPerWeek: prior.some((x) => x > 0) ? Math.round(sum(prior) / prior.filter((x) => x > 0).length) : null,
    sessionsLast4Weeks: recent.length,
    usualMinutesBeforeStarting: starts.length ? r1(starts[Math.floor(starts.length / 2)]) : null,
    mainReasonForDelay: top ? (reasonById(top[0])?.label || top[0]) : null,
    bestTimeOfDay: best && recent.length >= 4 ? best[0] : null,
  };
}

function voyageFacts(state, todayKey) {
  const v = safe(() => sail(state, todayKey));
  if (!v) return null;
  const out = { harbour: v.at?.name || null, nextHarbour: v.next?.name || null, kleosToNextHarbour: v.toNext };
  if (v.peril) out.peril = { name: v.peril.name, wayOut: 'one good day: two things done (20 Kleos)', kleosToday: v.peril.progress?.have ?? 0, needed: v.peril.progress?.need ?? 20 };
  return out;
}

// What moved since last week, computed (short sentences, numbers from the facts above).
function changes(habits, tasks, focus) {
  const out = [];
  for (const h of habits) {
    const a = h.averagePerDay, u = h.unit === 'min' ? 'minutes' : h.unit || '';
    if (h.run?.weeksInARowOnTarget >= 2) out.push(`${h.name}: ${h.run.weeksInARowOnTarget} weeks in a row on target`);
    if (a?.last7Days != null && a.the7DaysBefore != null && a.last7Days !== a.the7DaysBefore) out.push(`${h.name}: ${a.last7Days} ${u} a day this past week, ${a.last7Days < a.the7DaysBefore ? 'down' : 'up'} from ${a.the7DaysBefore}`);
    if (h.run?.daysInARowWithinLimit >= 3) out.push(`${h.name}: ${h.run.daysInARowWithinLimit} days in a row within the limit`);
    if (h.backYesterday) out.push(`${h.name}: back yesterday${h.backYesterday.afterDaysOff ? ` after ${h.backYesterday.afterDaysOff} days off` : ''}`);
    if (h.pattern) out.push(`${h.name}: ${h.pattern}`);
    if (h.trend === 'down' && h.type !== 'cut') out.push(`${h.name}: fewer than the 4 weeks before`);
  }
  if (tasks.overdue) out.push(`${tasks.overdue} task${tasks.overdue === 1 ? '' : 's'} overdue`);
  if (tasks.hours?.likelyLeftOver) out.push(`about ${tasks.hours.likelyLeftOver} hours more planned this week than you usually finish`);
  if (focus?.usualMinutesPerWeek && focus.minutesThisWeek < focus.usualMinutesPerWeek / 2) out.push(`focus: ${focus.minutesThisWeek} minutes so far this week, usually ${focus.usualMinutesPerWeek}`);
  return out.slice(0, 8);
}

// → the digest (docs/brain.md). hour: the local hour the digest is for (stake lines depend on it).
export function digest(state, todayKey = dateKey(), { hour = 8 } = {}) {
  const plan = planOf(todayKey, state);
  const paused = isPaused(state, todayKey);
  const habits = (plan?.goals || []).map((g) => safe(() => habitFacts(g, state, todayKey, hour))).filter(Boolean);
  const tasks = taskFacts(state, todayKey);
  const focus = safe(() => focusFacts(state, todayKey));
  const k = safe(() => kleos(state, todayKey));
  const d = {
    day: todayKey,
    weekday: parseKey(todayKey).toLocaleDateString('en-GB', { weekday: 'long' }),
    weekEnds: weekDays(weekKeyOf(todayKey))[6],
    paused,
    tone: state.settings?.tone || 'direct',
    identity: state.profile?.identity || null,
    habits, tasks, focus,
    voyage: voyageFacts(state, todayKey),
    kleos: k ? { pointsToday: k.today, pointsThisWeek: k.week } : null,
    changes: [],
  };
  d.changes = changes(habits, tasks, focus);
  return d;
}

// Every number written anywhere in a digest (or any JSON), as strings: what the AI is allowed to say.
export function numbersIn(obj) {
  const out = new Set();
  const walk = (x) => {
    if (x == null) return;
    if (typeof x === 'number') { out.add(String(x)); out.add(String(Math.round(x))); return; }
    if (typeof x === 'string') { for (const n of x.match(/\d+(?:\.\d+)?/g) || []) out.add(n); return; }
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === 'object') for (const [k, v] of Object.entries(x)) { for (const n of k.match(/\d+/g) || []) out.add(n); walk(v); }
  };
  walk(obj);
  return out;
}
