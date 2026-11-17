// Scoring model. Pure functions, no chrome.* calls, so it can be tested in Node.
//
// A week (Saturday → Friday) is planned on Friday night as a list of GOALS.
// Six goals are built in; you set their targets each week (or switch one off).
// You can add ad hoc goals for a week and pick one or more metrics for each.
//
// Metric kinds
//   daysPerWeek — daily done / skipped (skip needs a reason)    e.g. Gym 4 days / week
//   perDayMax   — a number each day, at most the target          e.g. Scrolling ≤ 1 hour / day
//   perDayMin   — a number each day, at least the target         e.g. Meaningful work ≥ 4 hours / day
//   perWeekSum  — a number each day, adding up to a weekly total e.g. Job hunting 5 hours / week
//   oncePerWeek — a yes / no task: done once at any point in the week
//
// Each metric scores 0–100 for a day, a goal is the average of its metrics, and the
// daily score is the average of the goals.

export const PRESETS = [
  { id: 'gym', name: 'Gym', icon: '🏋️', tags: ['health'], metrics: [{ id: 'days', kind: 'daysPerWeek', unit: 'days', target: 4, skipReason: true }] },
  { id: 'hiit', name: 'Morning HIIT', icon: '🌅', tags: ['health'], metrics: [{ id: 'days', kind: 'daysPerWeek', unit: 'days', target: 3, skipReason: true }] },
  { id: 'snacking', name: 'Snacking', icon: '🍪', tags: ['health'], metrics: [{ id: 'times', kind: 'perDayMax', unit: 'times', target: 0 }] },
  { id: 'scrolling', name: 'Scrolling', icon: '📱', tags: ['health'], metrics: [{ id: 'hours', kind: 'perDayMax', unit: 'hours', target: 1 }] },
  {
    id: 'work', name: 'Meaningful work', icon: '🧠', tags: ['office'],
    metrics: [
      { id: 'hours', kind: 'perDayMin', unit: 'hours', target: 4 },
      { id: 'procrastination', kind: 'perDayMax', unit: 'min', target: 15, label: 'Procrastination before starting', reasonIfPositive: true },
    ],
  },
  {
    id: 'job', name: 'Job hunting', icon: '💼', tags: ['job'],
    metrics: [
      { id: 'hours', kind: 'perWeekSum', unit: 'hours', target: 5, label: 'Hours spent' },
      { id: 'times', kind: 'perWeekSum', unit: 'times', target: 3, label: 'Sessions (times)' },
    ],
  },
];

// Metrics you can pick for an ad hoc goal.
export const ADHOC_METRICS = [
  { id: 'times_w', kind: 'perWeekSum', unit: 'times' },
  { id: 'min_w', kind: 'perWeekSum', unit: 'min' },
  { id: 'hours_w', kind: 'perWeekSum', unit: 'hours' },
  { id: 'days_w', kind: 'daysPerWeek', unit: 'days' },
  { id: 'hours_d', kind: 'perDayMin', unit: 'hours' },
  { id: 'min_dmin', kind: 'perDayMin', unit: 'min' },
  { id: 'times_dmax', kind: 'perDayMax', unit: 'times' },
];
// (One-off yes/no tasks are tickets now, not habits.)

export const DEFAULT_TAGS = [
  { id: 'office', name: 'Office', color: '#4f86f7' },
  { id: 'job', name: 'Job hunting', color: '#9b6bdf' },
  { id: 'personal', name: 'Personal projects', color: '#ff8a3d' },
  { id: 'health', name: 'Health', color: '#1fa971' },
  { id: 'random', name: 'Random', color: '#e5669b' },
];

// Colours handed to new tags, in order.
export const TAG_PALETTE = ['#14b8a6', '#eab308', '#ef4444', '#6366f1', '#84cc16', '#0ea5e9', '#d946ef', '#a16207'];

// Tags on a goal; plans saved before tags existed fall back to the built-in defaults.
export function goalTags(g) {
  if (Array.isArray(g.tags)) return g.tags;
  return PRESETS.find((p) => g.preset && p.id === g.id)?.tags || [];
}

export const DEFAULT_SETTINGS = {
  sessionMinutes: 45, // task timer: default session length (minutes of work), changeable per session
  askWhyMinutes: 2, // ask why after a procrastination stretch at least this long
  sleepTarget: 7.5, // hours; readiness compares last night's sleep with this
  blockList: ['youtube.com', 'instagram.com', 'x.com', 'twitter.com', 'reddit.com', 'facebook.com', 'netflix.com', 'linkedin.com'],
  envChecklist: ['Phone out of reach', 'Only the tabs this needs', 'Water or coffee ready'],
  reminderTime: '21:30', // daily check-in nudge
  planTime: '20:00', // Friday planning nudge
  checkinOn: true,
  planOn: true,
  morningOn: true, // morning brief: due / overdue / due tomorrow, rewards at risk, morning check
  morningTime: '08:30',
  cuesOn: true, // a nudge at each habit's cue time (set per habit), unless it's done
  middayOn: true, // midday nudge: habits left, tasks due, focus so far
  middayTime: '13:00',
  sessionEndOn: true, // "time's up" for a running focus session (push, with the app closed)
  pushOn: false, // set when a phone turns on push; the extension then leaves the scheduled reminders to it
  tz: null, // the phone's time zone, for push times (set when push is turned on)
  playlistUrl: '', // YouTube / YouTube Music focus playlist (Me → Focus music)
  playerOn: true, // show it as a player on the focus card (starts paused)
  lockScreen: false, // show the running session on the iPhone lock screen (as Now Playing)
};

export const GREEN = 67;
export const YELLOW = 34;

export function band(score) {
  if (score == null) return 'none';
  if (score >= GREEN) return 'green';
  if (score >= YELLOW) return 'yellow';
  return 'red';
}

export const BAND_LABEL = {
  green: 'Thriving',
  yellow: 'Building',
  red: 'Fresh start tomorrow',
  none: 'Ready to check in',
};

export function unitText(m) {
  if (m.kind === 'oncePerWeek') return 'yes / no';
  const per = m.kind === 'perDayMax' || m.kind === 'perDayMin' ? 'day' : 'week';
  return `${m.unit} / ${per}`;
}

export function targetText(m) {
  const t = Number(m.target) || 0;
  if (m.kind === 'oncePerWeek') return 'done this week';
  if (m.kind === 'perDayMax') return `≤ ${t} ${unitText(m)}`;
  if (m.kind === 'perDayMin') return `≥ ${t} ${unitText(m)}`;
  return `${t} ${unitText(m)}`;
}

export const metricKey = (g, m) => `${g.id}.${m.id}`;

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 1) % 7)); // Sat → 0, Fri → 6
}
export const weekKeyOf = (dayKey) => dateKey(weekStart(parseKey(dayKey)));
export const weekDays = (wk) => Array.from({ length: 7 }, (_, i) => dateKey(addDays(parseKey(wk), i)));
export const dayIndexInWeek = (dayKey) => weekDays(weekKeyOf(dayKey)).indexOf(dayKey);
export const planOf = (dayKey, state) => state.weeks[weekKeyOf(dayKey)] || null;

// A fresh plan: every habit from last week's plan (built-in and your own) with the same targets,
// otherwise every built-in goal at its default target.
export function defaultPlan(prevPlan) {
  if (prevPlan) return structuredClone({ theme: '', goals: prevPlan.goals });
  return { theme: '', goals: structuredClone(PRESETS).map((p) => ({ ...p, preset: true })) };
}

// Habits carry over: a week with no plan gets a copy of the latest earlier plan. Mutates; true if it did.
export function carryPlan(state, wk) {
  if (state.weeks[wk]) return false;
  const prev = Object.keys(state.weeks).filter((k) => k < wk).sort().at(-1);
  if (!prev) return false;
  state.weeks[wk] = { ...defaultPlan(state.weeks[prev]), setAt: Date.now(), carriedFrom: prev };
  return true;
}

// ---------- scoring ----------

const val = (state, dayKey, key) => state.days[dayKey]?.values?.[key];

export function maxScore(n, limit) {
  if (n <= limit) return 100;
  if (limit <= 0) return [100, 40, 10][Math.ceil(n)] ?? 0; // a zero limit is strict
  return Math.max(0, Math.round(100 * (1 - (n - limit) / limit))); // 0 at double the limit
}

export function minScore(n, target) {
  if (target <= 0) return 100;
  return Math.min(100, Math.round((100 * n) / target));
}

export function weekSoFar(g, m, dayKey, state, inclusive = true) {
  const days = weekDays(weekKeyOf(dayKey));
  const idx = days.indexOf(dayKey);
  const upto = days.slice(0, inclusive ? idx + 1 : idx);
  const key = metricKey(g, m);
  if (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') return upto.filter((k) => val(state, k, key) === true).length;
  return upto.reduce((s, k) => s + (Number(val(state, k, key)) || 0), 0);
}

export function metricScore(g, m, dayKey, state) {
  if (!state.days[dayKey]) return null;
  const t = Number(m.target) || 0;
  const idx = dayIndexInWeek(dayKey);
  if (m.kind === 'perWeekSum') {
    if (val(state, dayKey, metricKey(g, m)) == null) return null; // not answered yet today
    // On pace? Compare the running total with the share of the target due by today.
    if (t <= 0) return 100;
    const expected = (t * (idx + 1)) / 7;
    return Math.min(100, Math.round((100 * weekSoFar(g, m, dayKey, state)) / expected));
  }
  if (m.kind === 'oncePerWeek') {
    // A task: 100 from the day it's done. Not counted while there's still time; 0 if Friday ends without it.
    if (weekSoFar(g, m, dayKey, state) > 0) return 100;
    return idx === 6 ? 0 : null;
  }
  const v = val(state, dayKey, metricKey(g, m));
  if (v == null || v === '') return null;
  if (m.kind === 'daysPerWeek') {
    // Done → 100. Skipped → 100 while the weekly target is still reachable, else 0.
    if (v === true) return 100;
    return weekSoFar(g, m, dayKey, state, false) + (6 - idx) >= t ? 100 : 0;
  }
  if (m.kind === 'perDayMax') return maxScore(Number(v), t);
  if (m.kind === 'perDayMin') return minScore(Number(v), t);
  return null;
}

const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export function goalScore(g, dayKey, state) {
  return mean(g.metrics.map((m) => metricScore(g, m, dayKey, state)));
}

export function dayScore(dayKey, state) {
  if (!state.days[dayKey]) return null;
  const plan = planOf(dayKey, state);
  const rows = (plan?.goals || []).map((g) => ({ goal: g, score: goalScore(g, dayKey, state) }));
  return { rows, score: mean(rows.map((r) => r.score)) };
}

// ---------- weekly progress ----------

// How a metric is doing across the week so far.
export function metricWeek(g, m, wk, state, uptoKey) {
  const days = weekDays(wk).filter((k) => k <= uptoKey);
  const key = metricKey(g, m);
  const t = Number(m.target) || 0;
  const logged = days.filter((k) => { const v = val(state, k, key); return v != null && v !== ''; });
  if (m.kind === 'oncePerWeek') {
    const doneOn = logged.find((k) => val(state, k, key) === true);
    return { text: doneOn ? `Done ${parseKey(doneOn).toLocaleDateString(undefined, { weekday: 'short' })} ✓` : 'Not done yet', pct: doneOn ? 1 : 0, done: doneOn ? 1 : 0 };
  }
  if (m.kind === 'daysPerWeek' || m.kind === 'perWeekSum') {
    const done = m.kind === 'daysPerWeek'
      ? logged.filter((k) => val(state, k, key) === true).length
      : logged.reduce((s, k) => s + (Number(val(state, k, key)) || 0), 0);
    return { text: `${round1(done)} / ${t} ${m.unit}`, pct: t > 0 ? Math.min(1, done / t) : 1, done };
  }
  const nums = logged.map((k) => Number(val(state, k, key)));
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  const hit = logged.filter((k) => metricScore(g, m, k, state) === 100).length;
  return {
    text: logged.length ? `${hit}/${logged.length} days · avg ${round1(avg)} ${m.unit}` : '—',
    pct: logged.length ? hit / logged.length : null,
    avg,
  };
}

export const round1 = (x) => (x == null ? '—' : Math.round(x * 10) / 10);

// ---------- status: done / on track / at risk / missed ----------

export const STATUS = {
  done: { label: 'Done', icon: '🎉' },
  on: { label: 'On track', icon: '✓' },
  risk: { label: 'At risk', icon: '!' },
  missed: { label: 'Missed', icon: '✕' },
};
const STATUS_RANK = { done: 0, on: 1, risk: 2, missed: 3 };

// Days of the week still open: after today, plus today if today's check-in isn't complete yet.
function daysRemaining(wk, state, todayKey) {
  return weekDays(wk).filter((k) => k > todayKey || (k === todayKey && (!state.days[k] || state.days[k].complete === false))).length;
}

export function metricStatus(g, m, wk, state, todayKey) {
  const t = Number(m.target) || 0;
  const remaining = daysRemaining(wk, state, todayKey);
  const w = metricWeek(g, m, wk, state, todayKey);
  if (m.kind === 'oncePerWeek') {
    if (w.done) return 'done';
    return remaining === 0 ? 'missed' : remaining === 1 ? 'risk' : 'on';
  }
  if (m.kind === 'daysPerWeek') {
    const need = t - w.done;
    if (need <= 0) return 'done';
    return need > remaining ? 'missed' : need === remaining ? 'risk' : 'on';
  }
  if (m.kind === 'perWeekSum') {
    if (w.done >= t) return 'done';
    if (remaining === 0) return 'missed';
    const elapsed = 7 - remaining;
    if (elapsed === 0) return 'on';
    return w.done / ((t * elapsed) / 7) >= 0.9 ? 'on' : 'risk'; // on pace?
  }
  // Daily targets: share of logged days on target.
  if (w.pct == null) return 'on';
  return w.pct >= 0.8 ? 'on' : w.pct >= 0.5 ? 'risk' : 'missed';
}

// A goal is as healthy as its weakest metric.
export function goalStatus(g, wk, state, todayKey) {
  return g.metrics
    .map((m) => metricStatus(g, m, wk, state, todayKey))
    .reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), 'done');
}

// A goal's compliance for a week: its average daily score over the days you checked in.
export function goalWeekAvg(g, wk, state, uptoKey) {
  return mean(weekDays(wk).filter((k) => k <= uptoKey && state.days[k]).map((k) => goalScore(g, k, state)));
}

export function weekSummary(wk, state, uptoKey) {
  const days = weekDays(wk).filter((k) => k <= uptoKey && state.days[k]);
  const scores = days.map((k) => dayScore(k, state)?.score).filter((v) => v != null);
  const procrast = days.map((k) => val(state, k, 'work.procrastination')).filter((v) => v != null);
  return {
    avg: mean(scores),
    checkins: scores.length,
    greenDays: scores.filter((s) => s >= GREEN).length,
    procrastTotal: procrast.reduce((a, b) => a + Number(b), 0),
    procrastAvg: procrast.length ? Math.round(procrast.reduce((a, b) => a + Number(b), 0) / procrast.length) : null,
    planned: !!state.weeks[wk],
  };
}

// Reasons logged for skips and procrastination, newest first.
export function reasonsIn(dayKeys, state) {
  const out = [];
  for (const k of [...dayKeys].reverse()) {
    const e = state.days[k];
    if (!e?.reasons) continue;
    const plan = planOf(k, state);
    for (const [key, text] of Object.entries(e.reasons)) {
      if (!text) continue;
      const [gid, mid] = key.split('.');
      const g = plan?.goals.find((x) => x.id === gid);
      const m = g?.metrics.find((x) => x.id === mid);
      const what = m?.kind === 'daysPerWeek' ? 'skipped' : `${e.values?.[key]} ${m?.unit || ''} ${m?.label ? m.label.toLowerCase() : ''}`.trim();
      out.push({ day: k, goal: g ? `${g.icon || '⭐'} ${g.name}` : gid, what, text });
    }
  }
  return out;
}

// ---------- continuous trends ----------

export function lastNDays(endKey, n) {
  const end = parseKey(endKey);
  return Array.from({ length: n }, (_, i) => dateKey(addDays(end, i - n + 1)));
}

export function rollingAvg(state, endKey, n = 7) {
  return mean(lastNDays(endKey, n).map((k) => dayScore(k, state)?.score));
}

// Goals are matched across weeks by id for built-ins and by name for ad hoc goals.
export const goalTrendKey = (g) => (g.preset ? g.id : `adhoc:${g.name.trim().toLowerCase()}`);

export function goalAvgs(state, endKey, n) {
  const buckets = new Map();
  for (const k of lastNDays(endKey, n)) {
    for (const r of dayScore(k, state)?.rows || []) {
      if (r.score == null) continue;
      const key = goalTrendKey(r.goal);
      if (!buckets.has(key)) buckets.set(key, { goal: r.goal, scores: [] });
      buckets.get(key).scores.push(r.score);
    }
  }
  return new Map([...buckets].map(([key, b]) => [key, { goal: b.goal, avg: mean(b.scores) }]));
}

// Average goal score per tag over the last n days.
export function tagAvgs(state, endKey, n) {
  const buckets = new Map();
  for (const k of lastNDays(endKey, n)) {
    for (const r of dayScore(k, state)?.rows || []) {
      if (r.score == null) continue;
      for (const t of goalTags(r.goal)) {
        if (!buckets.has(t)) buckets.set(t, []);
        buckets.get(t).push(r.score);
      }
    }
  }
  return new Map([...buckets].map(([t, xs]) => [t, mean(xs)]));
}

// ---------- task-timer sessions ----------

// ---------- procrastination reasons (fixed list, so they can be counted) ----------
// Each procrastination stretch in a session is a "delay": { min, reason: id|null, note, at }.
// A session has one per stretch: before you first start, and after each Resume.
export const DELAY_REASONS = [
  { id: 'unclear', icon: '🧭', label: 'Unclear next step' },
  { id: 'toobig', icon: '🏔️', label: 'Task feels too big' },
  { id: 'avoid', icon: '🙈', label: 'Avoiding something hard / uncomfortable' },
  { id: 'energy', icon: '🔋', label: 'Low energy / tired' },
  { id: 'mood', icon: '🌧️', label: 'Anxious or low mood' },
  { id: 'distracted', icon: '📱', label: 'Distracted (phone, scrolling, messages)' },
  { id: 'interrupted', icon: '🚪', label: 'Interrupted / something urgent came up' },
  { id: 'perfect', icon: '⏳', label: 'Waiting for the right moment / perfectionism' },
  { id: 'other', icon: '✏️', label: 'Other' },
];
export const reasonById = (id) => DELAY_REASONS.find((r) => r.id === id) || null;

// Minutes and counts per reason over some days. Stretches shorter than the ask threshold with no
// reason are left out; longer ones with no reason count as 'unrecorded'. Sessions from before reasons
// existed add their procrastination to 'unrecorded'.
export function reasonStats(dayKeys, state) {
  const min = state.settings?.askWhyMinutes ?? DEFAULT_SETTINGS.askWhyMinutes;
  const out = {};
  const add = (id, m) => { out[id] ??= { id, count: 0, min: 0 }; out[id].count++; out[id].min += m; };
  for (const x of sessionsIn(dayKeys, state)) {
    if (!x.delays) { if (x.procrastMin >= min) add('unrecorded', x.procrastMin); continue; }
    for (const d of x.delays) {
      if (d.reason) add(d.reason, d.min);
      else if (d.min >= min) add('unrecorded', d.min);
    }
  }
  return Object.values(out).sort((a, b) => b.min - a.min);
}

// ---------- tickets: sized work items in a weekly sprint ----------
// tickets[id] = { id, title, sizeH|null, status: 'todo'|'doing'|'done', habitId|null, tags: [], parentId|null,
//                 sprint: weekKey (where it lives now) | null (backlog), sprints: [weekKeys it was in], planned: bool,
//                 due: dateKey|null (deadline), createdAt, doneAt|null }
// Sessions point at a ticket (ticketId). Their time counts toward the ticket and, if the ticket has a
// habitId, toward that habit's hours in the check-in (e.g. Meaningful work).
// Unfinished tickets carry over to the next sprint; `sprints` keeps the history.
export const TICKET_STATUS = {
  todo: { label: 'To do', icon: '○' },
  doing: { label: 'In progress', icon: '◐' },
  done: { label: 'Done', icon: '●' },
};
export const ticketList = (state) => Object.values(state.tickets || {});
export const ticketsInSprint = (wk, state) =>
  ticketList(state).filter((t) => (t.sprints || [t.sprint]).includes(wk)).sort((a, b) => a.createdAt - b.createdAt);
// The backlog: tickets not in any sprint (sprint === null). They don't carry over; you pull them in.
export const backlogTickets = (state) => ticketList(state).filter((t) => t.sprint == null).sort((a, b) => a.createdAt - b.createdAt);

// Deadlines: t.due is a date key or null. → { text, cls } where cls is overdue | today | soon | '' .
export function dueInfo(t, todayKey) {
  if (!t?.due) return null;
  const days = Math.round((parseKey(t.due) - parseKey(todayKey)) / 864e5);
  const d = parseKey(t.due).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (t.status === 'done') return { text: `due ${d}`, cls: t.doneAt && dateKey(new Date(t.doneAt)) > t.due ? 'late' : '' };
  if (days < 0) return { text: `overdue ${-days}d (${d})`, cls: 'overdue' };
  if (days === 0) return { text: 'due today', cls: 'today' };
  if (days <= 2) return { text: `due ${d}`, cls: 'soon' };
  return { text: `due ${d}`, cls: '' };
}

export const ticketTitle = (t, state) => {
  const p = t?.parentId ? state.tickets?.[t.parentId] : null;
  return p ? `${p.title} › ${t.title}` : t?.title || '';
};
// Unfinished tickets from earlier sprints move to this one. Mutates; returns true if anything moved.
export function rollOver(state, wk) {
  let moved = false;
  for (const t of ticketList(state)) {
    if (t.status === 'done' || t.sprint == null || t.sprint >= wk) continue; // backlog tickets stay put
    t.sprint = wk;
    t.sprints = [...new Set([...(t.sprints || []), wk])];
    moved = true;
  }
  return moved;
}

// Per ticket for a sprint: size vs hours logged on the timer that week, plus how starting went.
export function sprintTickets(wk, state, uptoKey) {
  const days = weekDays(wk).filter((k) => k <= uptoKey);
  const all = sessionsIn(days, state);
  return ticketsInSprint(wk, state).map((t) => {
    const list = all.filter((x) => x.ticketId === t.id);
    const workMin = list.reduce((a, x) => a + (Number(x.workMin) || 0), 0);
    const procrastMin = list.reduce((a, x) => a + (Number(x.procrastMin) || 0), 0);
    return {
      ...t,
      name: ticketTitle(t, state),
      estimateH: t.sizeH ?? null,
      loggedH: workMin / 60,
      sessions: list.length,
      workMin,
      procrastMin,
      carried: (t.sprints || []).indexOf(wk), // sprints before this one
      doneThisWeek: t.status === 'done' && t.doneAt && weekKeyOf(dateKey(new Date(t.doneAt))) === wk,
      topReason: reasonStats(['x'], { ...state, sessions: { x: list } }).find((r) => r.id !== 'unrecorded')?.id || null,
    };
  });
}

// Which habit a session's time counts toward. Sessions saved before tickets have no goalId field
// at all and count as Meaningful work; newer ones say so explicitly (null = no habit).
export const sessionGoalId = (x) => ('goalId' in x ? x.goalId : 'work');

// The metric a goal's timed work fills in the check-in: its first hours or minutes metric.
export function timedMetric(g) {
  return g.metrics.find((m) => (m.unit === 'hours' || m.unit === 'min') && (m.kind === 'perDayMin' || m.kind === 'perWeekSum')) || null;
}

// Has every metric in the day's plan been answered (given these values)?
export function isDayComplete(state, dayKey, values = state.days[dayKey]?.values || {}) {
  const plan = planOf(dayKey, state);
  if (!plan) return false;
  return plan.goals.every((g) => g.metrics.every((m) => {
    if (m.kind === 'oncePerWeek' && weekSoFar(g, m, dayKey, state, false) > 0) return true;
    if (m.kind === 'perWeekSum') return true; // weekly totals: a day without any is just 0
    const v = values[metricKey(g, m)];
    return v != null && v !== '' && !Number.isNaN(v);
  }));
}

// What the day's timer sessions say for each synced field: { 'goal.metric': value }.
// Each goal's hours (or minutes) come from the sessions timed for it; procrastination before starting
// comes from all of the day's sessions.
export function syncedValues(state, dayKey) {
  const plan = planOf(dayKey, state);
  const all = state.sessions?.[dayKey] || [];
  const out = {};
  const auto = autoTickets(state, dayKey);
  if (!plan || (!all.length && !auto.length)) return out;
  for (const g of plan.goals) {
    const m = timedMetric(g);
    const mine = all.filter((x) => sessionGoalId(x) === g.id);
    const est = auto.filter((x) => x.habitId === g.id);
    if (m && (mine.length || est.length)) {
      // timer minutes, plus the estimate of tickets finished today without the timer
      const min = mine.reduce((a, x) => a + (Number(x.workMin) || 0), 0) + est.reduce((a, x) => a + x.min, 0);
      out[metricKey(g, m)] = m.unit === 'hours' ? Math.round(min / 6) / 10 : Math.round(min);
    }
    const p = g.metrics.find((x) => metricKey(g, x) === 'work.procrastination');
    if (p && all.length) out['work.procrastination'] = Math.round(all.reduce((a, x) => a + (Number(x.procrastMin) || 0), 0));
  }
  return out;
}

// ---------- time: timer sessions, plus estimates for things done without the timer ----------
// A ticket's estimate is t.sizeH (hours); a habit's is g.estimateMin (minutes, for done / not-done habits).
// Estimates count only when the timer wasn't used: a ticket with any session never counts its estimate,
// and a parent whose subtasks have estimates leaves the counting to them.

const timedTicketIds = (state) => new Set(Object.values(state.sessions || {}).flat().map((x) => x.ticketId).filter(Boolean));

// Tickets finished on dayKey without timer time → [{ kind, id, name, min, habitId }]
export function autoTickets(state, dayKey, timed = timedTicketIds(state)) {
  const list = Object.values(state.tickets || {});
  return list
    .filter((t) => t.status === 'done' && t.doneAt && dateKey(new Date(t.doneAt)) === dayKey && t.sizeH > 0 && !timed.has(t.id)
      && !list.some((k) => k.parentId === t.id && k.sizeH > 0))
    .map((t) => ({ kind: 'ticket', id: t.id, name: t.title, min: Math.round(t.sizeH * 60), habitId: t.habitId || null }));
}

// Habits ticked done on dayKey that have a usual time → [{ kind, id, name, icon, min }]
export function autoHabits(state, dayKey) {
  const plan = planOf(dayKey, state);
  const vals = state.days[dayKey]?.values || {};
  return (plan?.goals || [])
    .filter((g) => g.estimateMin > 0 && !timedMetric(g) && g.metrics.some((m) => (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') && vals[metricKey(g, m)] === true))
    .map((g) => ({ kind: 'habit', id: g.id, name: g.name, icon: g.icon || '⭐', min: g.estimateMin }));
}

// Time invested on a day: { timerMin, autoMin, totalMin, auto: [...] }
export function timeOnDay(state, dayKey, timed = timedTicketIds(state)) {
  const timerMin = (state.sessions?.[dayKey] || []).reduce((a, x) => a + (Number(x.workMin) || 0), 0);
  const auto = [...autoTickets(state, dayKey, timed), ...autoHabits(state, dayKey)];
  const autoMin = auto.reduce((a, x) => a + x.min, 0);
  return { timerMin: Math.round(timerMin), autoMin, totalMin: Math.round(timerMin + autoMin), auto };
}
export function timeOnDays(state, dayKeys) {
  const timed = timedTicketIds(state);
  return dayKeys.map((k) => timeOnDay(state, k, timed)).reduce((a, x) => ({ timerMin: a.timerMin + x.timerMin, autoMin: a.autoMin + x.autoMin, totalMin: a.totalMin + x.totalMin }), { timerMin: 0, autoMin: 0, totalMin: 0 });
}

// A ticket's time: timer hours if it has any; otherwise its estimate once done. → { h, auto }
export function ticketTime(t, state) {
  const min = Object.values(state.sessions || {}).flat().filter((x) => x.ticketId === t.id).reduce((a, x) => a + (Number(x.workMin) || 0), 0);
  if (min > 0) return { h: min / 60, auto: false };
  const kids = Object.values(state.tickets || {}).filter((k) => k.parentId === t.id && k.sizeH > 0);
  if (t.status === 'done' && t.sizeH > 0 && !kids.length) return { h: t.sizeH, auto: true };
  return { h: 0, auto: false };
}

// Write the timer's numbers into the day's check-in. Fields that were synced before but have no
// sessions any more are cleared. Mutates state.days; returns true if anything changed.
export function syncDay(state, dayKey) {
  const want = syncedValues(state, dayKey);
  const old = state.days[dayKey];
  const wasSynced = old?.synced || {};
  if (!old && !Object.keys(want).length) return false;
  const values = { ...(old?.values || {}) };
  for (const k of Object.keys(wasSynced)) if (!(k in want)) delete values[k];
  Object.assign(values, want);
  const synced = Object.fromEntries(Object.keys(want).map((k) => [k, true]));
  const next = {
    values: {}, reasons: {}, note: '', savedAt: Date.now(),
    ...old,
    values,
    synced,
    complete: isDayComplete(state, dayKey, values),
  };
  if (JSON.stringify(next.values) === JSON.stringify(old?.values) && JSON.stringify(synced) === JSON.stringify(wasSynced) && next.complete === old?.complete) return false;
  state.days[dayKey] = next;
  return true;
}

export function sessionsIn(dayKeys, state) {
  return dayKeys.flatMap((k) => (state.sessions?.[k] || []).map((x) => ({ ...x, day: k })));
}

// Totals over a set of days: how long it took to start, how long you worked.
// A running session moves between phases: 'procrast' → 'work' → 'paused' → 'procrast' (on resume) → 'work' …
// Time in each phase is added to its bucket when the phase ends; the current phase runs from phaseStart.
export function phaseMs(a, phase, now = Date.now()) {
  if (!a) return 0;
  const done = { procrast: a.procrastMs, work: a.workMs, paused: a.pausedMs }[phase] || 0;
  return done + (a.phase === phase ? Math.max(0, now - a.phaseStart) : 0);
}
export const workedMs = (a, now) => phaseMs(a, 'work', now);

// Sessions saved by 3.4 (workStart / pausedAt) → phases.
export function normaliseSession(a, now = Date.now()) {
  if (!a || a.phase) return a;
  const pausedMs = a.pausedMs || 0;
  if (!a.workStart) return { ...a, phase: 'procrast', phaseStart: a.start, procrastMs: 0, workMs: 0, pausedMs: 0 };
  const procrastMs = a.workStart - a.start;
  if (a.pausedAt) return { ...a, phase: 'paused', phaseStart: a.pausedAt, procrastMs, workMs: a.pausedAt - a.workStart - pausedMs, pausedMs };
  return { ...a, phase: 'work', phaseStart: now, procrastMs, workMs: now - a.workStart - pausedMs, pausedMs };
}

// Share of a session (or a total) spent procrastinating, 0–100. Paused time isn't counted.
export function procrastPct(procrastMin, workMin) {
  const total = procrastMin + workMin;
  return total > 0 ? Math.round((100 * procrastMin) / total) : null;
}

export function sessionTotals(dayKeys, state, goalId = null) {
  const list = sessionsIn(dayKeys, state).filter((x) => !goalId || sessionGoalId(x) === goalId);
  const procrastMin = list.reduce((a, x) => a + x.procrastMin, 0);
  const workMin = list.reduce((a, x) => a + x.workMin, 0);
  return {
    count: list.length,
    procrastMin: Math.round(procrastMin),
    workMin: Math.round(workMin),
    avgStartMin: list.length ? Math.round(procrastMin / list.length) : null,
  };
}

export function streak(state, todayKey) {
  let d = parseKey(todayKey);
  // A day counts once at least one goal was logged (a reflection alone doesn't).
  const logged = (k) => Object.keys(state.days[k]?.values || {}).length > 0;
  if (!logged(todayKey)) d = addDays(d, -1);
  let n = 0;
  while (logged(dateKey(d))) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
