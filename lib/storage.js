// Everything lives in chrome.storage.local on this machine. Nothing is sent anywhere.
//
// schemaVersion  — 5
// settings       — see DEFAULT_SETTINGS, plus tags: [{ id, name, color }]
// weeks[satKey]  — the week's HABITS plan (copied from the week before if you don't plan; carriedFrom says so): { theme, goals: [{ id, name, icon, preset, tags:[tagId], metrics: [{ id, kind, unit, target, ... }] }], setAt }
// days[date]     — { values: { 'goalId.metricId': true|false|number }, reasons: { 'goalId.metricId': text }, note,
//                    reflection, complete, synced: { 'goalId.metricId': true } (filled from timer sessions), savedAt }
// tickets[id]    — sized work items in weekly sprints (see TICKETS in score.js)
// sessions[date] — task-timer sessions, filed under the day they started:
//                  [{ id, task, ticketId|null, goalId (habit the time counts toward)|null, goalName, minutes, start,
//                     workStart|null, end, procrastMin, workMin, pausedMin, delays: [{ min, reason, note, at }] }]
// activeSession  — { id, task, ticketId, goalId, minutes, start, workStart|null, phase, phaseStart, procrastMs, workMs, pausedMs, delays }
//                  phase: 'procrast' → 'work' → 'paused' → 'procrast' (resume) → 'work' …
// experiments    — [{ id, playId, reason, startDay, endDay|null }] (see PLAYBOOK in coach.js); one active at a time
// intentions     — [{ id, at (ms), ticketId|null, label, done }] — "I will work on X at TIME" reminders
// days[date].readiness — { sleepH, energy 1–5, mood 1–5, at } (morning check)
// purchases      — [{ id, itemId, name, price, at }] — from the money rewards removed in 0.2.0; kept, no longer shown
// profile        — who the user is and how they work (onboarding answers + what behaviour shows); null until set
// tactics[id]    — behaviour-engine trials: { id, habitId, tacticId, startDay, endDay|null, status, ... }
// notes[id]      — Athena's notes: { id, day, kind, text, proposals, at, seenAt }
// pauses         — [{ id, startDay, endDay|null, reason }] — sick or travelling: no penalties, streaks kept
// otherRecords   — synced records of kinds this version doesn't know yet, kept as they are
// backups        — [{ id, at, reason, schemaVersion, data: JSON string of everything else }], newest first, last 10
//
// Upgrades never delete data: each schema step converts in place, and a backup is taken first.
import {
  DEFAULT_SETTINGS, DEFAULT_TAGS, dateKey, workedMs, normaliseSession, syncDay, weekKeyOf, rollOver, carryPlan,
  dayIndexInWeek, sessionsIn, weekDays, isDayComplete,
} from './score.js';
import { track } from './usage.js';

export const SCHEMA = 5;
const KEEP_BACKUPS = 10;

export async function load() {
  let s = await chrome.storage.local.get(null);
  if (!s.schemaVersion && Object.keys(withoutDeviceKeys(s)).length === 0) {
    // a fresh install (maybe already signed in)
    s = { ...s, schemaVersion: SCHEMA };
    await chrome.storage.local.set({ schemaVersion: SCHEMA });
  }
  if (s.schemaVersion < SCHEMA) s = await upgrade(s);
  if (s.schemaVersion === SCHEMA) s = await housekeeping(s);
  // A newer schema than this code knows: read what we can, never rewrite it.
  return {
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}), pomodoroMinutes: undefined, tags: s.settings?.tags || structuredClone(DEFAULT_TAGS) },
    days: s.days || {},
    weeks: s.weeks || {},
    sessions: s.sessions || {},
    tickets: s.tickets || {},
    experiments: s.experiments || [],
    intentions: s.intentions || [],
    purchases: s.purchases || [],
    activeSession: normaliseSession(s.activeSession) || null,
    profile: s.profile || null,
    tactics: s.tactics || {},
    notes: s.notes || {},
    pauses: s.pauses || [],
    otherRecords: s.otherRecords || {},
  };
}

export const save = (obj) => chrome.storage.local.set(obj);

// ---------- backups ----------

// Kept on this device only: never in backups or exports, kept through restore / import / erase.
export const DEVICE_KEYS = ['backups', 'auth', 'syncMeta', 'dataOwner', 'usageQueue', 'usageOpened', 'harbourRewards']; // dataOwner: the account this device's data belongs to
const deviceOnly = async () => chrome.storage.local.get(DEVICE_KEYS);
export function withoutDeviceKeys(all) {
  const out = { ...all };
  for (const k of DEVICE_KEYS) delete out[k];
  return out;
}

// Snapshot everything (except older backups) into storage. Skips a duplicate taken in the last minute.
export async function snapshot(reason) {
  const all = await chrome.storage.local.get(null);
  const backups = all.backups || [];
  const data = withoutDeviceKeys(all);
  if (backups[0] && backups[0].reason === reason && Date.now() - backups[0].at < 60000) return backups[0];
  const b = { id: crypto.randomUUID(), at: Date.now(), reason, schemaVersion: data.schemaVersion ?? null, data: JSON.stringify(data) };
  await chrome.storage.local.set({ backups: [b, ...backups].slice(0, KEEP_BACKUPS) });
  return b;
}

export async function listBackups() {
  const { backups = [] } = await chrome.storage.local.get('backups');
  return backups.map(({ data, ...meta }) => ({ ...meta, bytes: data.length }));
}

export async function backupData(id) {
  const { backups = [] } = await chrome.storage.local.get('backups');
  return backups.find((b) => b.id === id)?.data ?? null;
}

// Restore a snapshot (taking one of the current state first). Older schemas are upgraded on next load.
export async function restoreBackup(id) {
  const raw = await backupData(id);
  if (!raw) throw new Error('backup not found');
  await snapshot('before restore');
  const keep = await deviceOnly();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ ...withoutDeviceKeys(JSON.parse(raw)), ...keep });
}

// Weekly safety copy, called from the background worker.
export async function weeklyBackup() {
  const { backups = [] } = await chrome.storage.local.get('backups');
  const last = backups.find((b) => b.reason === 'weekly');
  if (!last || Date.now() - last.at > 7 * 864e5) await snapshot('weekly');
}

// ---------- upgrades (one step per schema version; never delete) ----------

export const UPGRADES = {
  // 4 → 5 (0.2.0): room for the profile, tactic trials, Athena's notes and pauses. Nothing else changes.
  4: (s) => ({ ...s, schemaVersion: 5, profile: s.profile ?? null, tactics: s.tactics || {}, notes: s.notes || {}, pauses: s.pauses || [] }),
  // 3 → 4: habits and tickets are separate. One-off tasks in the plan, ad hoc subtasks and today's
  // interview-prep sessions become tickets; sessions point at tickets.
  3: (s) => {
    const tickets = { ...(s.tickets || {}) };
    const sessions = structuredClone(s.sessions || {});
    const weeks = structuredClone(s.weeks || {});
    const days = s.days || {};
    const mk = (id, t) => (tickets[id] ??= {
      id, sizeH: null, status: 'todo', habitId: null, tags: [], parentId: null, planned: true,
      createdAt: Date.now(), doneAt: null, ...t, sprints: [t.sprint],
    });
    // plan tasks (yes / no "done" goals) → planned tickets
    for (const [wk, plan] of Object.entries(weeks)) {
      plan.goals = (plan.goals || []).filter((g) => {
        if (!g.metrics?.length || !g.metrics.every((m) => m.kind === 'oncePerWeek')) return true;
        const key = `${g.id}.${g.metrics[0].id}`;
        const doneDay = Object.keys(days).filter((k) => weekKeyOf(k) === wk && days[k].values?.[key] === true).sort()[0];
        mk(`t-${g.id}`, {
          title: g.name, tags: g.tags || [], sprint: wk, sizeH: g.estimateH ?? null, createdAt: plan.setAt || Date.now(),
          status: doneDay ? 'done' : 'todo', doneAt: doneDay ? new Date(`${doneDay}T12:00`).getTime() : null,
        });
        return false;
      });
      for (const g of plan.goals) delete g.estimateH; // sizes belong to tickets now
    }
    // ad hoc subtasks → unplanned tickets
    for (const [wk, list] of Object.entries(s.adhoc || {})) {
      for (const x of list) mk(`t-${x.id}`, { title: x.name, sizeH: x.estimateH ?? null, sprint: wk, planned: false, createdAt: x.createdAt || Date.now() });
    }
    for (const [k, list] of Object.entries(sessions)) {
      for (const x of list) {
        if (x.goalId === 'adhoc') {
          Object.assign(x, { ticketId: `t-${x.subtaskId}`, goalId: null });
          tickets[`t-${x.subtaskId}`] && (tickets[`t-${x.subtaskId}`].status = 'doing');
        } else if (/interview prep/i.test(x.task || '')) {
          // 15 Nov 2026: "interview prep" sessions → an Interview prep ticket counting toward Meaningful work
          mk('t-interview-prep', { title: 'Interview prep', habitId: 'work', sprint: weekKeyOf(k), planned: false, status: 'doing', createdAt: x.start });
          Object.assign(x, { ticketId: 't-interview-prep', goalId: 'work' });
        }
        if (!('ticketId' in x)) x.ticketId = null;
        delete x.subtaskId;
      }
    }
    const a = s.activeSession ? { ...s.activeSession } : null;
    if (a?.goalId === 'adhoc') Object.assign(a, { ticketId: `t-${a.subtaskId}`, goalId: null });
    if (a) delete a.subtaskId;
    const settings = { ...(s.settings || {}) };
    if (settings.lastGoalId?.startsWith('adhoc:')) settings.lastGoalId = `t:t-${settings.lastGoalId.slice(6)}`;
    else if (settings.lastGoalId) settings.lastGoalId = `h:${settings.lastGoalId}`;
    const out = { ...s, schemaVersion: 4, tickets, sessions, weeks, settings, ...(a ? { activeSession: a } : {}) };
    delete out.adhoc;
    return out;
  },
};

async function upgrade(s) {
  if (!s.schemaVersion || !UPGRADES[s.schemaVersion]) {
    // Unknown old data: keep it untouched in a backup, start this version alongside it.
    await snapshot(`unknown schema ${s.schemaVersion ?? '(none)'}`);
    return s;
  }
  await snapshot(`before upgrade to v${SCHEMA}`);
  let cur = s;
  while (cur.schemaVersion < SCHEMA && UPGRADES[cur.schemaVersion]) cur = UPGRADES[cur.schemaVersion](cur);
  await chrome.storage.local.set(withoutDeviceKeys(cur));
  if (s.adhoc) await chrome.storage.local.remove('adhoc');
  return cur;
}

// Every load on the current schema: carry unfinished tickets into this week's sprint, and last
// week's habits into this week if it has no plan yet.
async function housekeeping(s) {
  const wk = weekKeyOf(dateKey());
  const st = { tickets: s.tickets || {}, weeks: s.weeks || {} };
  if (rollOver(st, wk)) {
    await chrome.storage.local.set({ tickets: st.tickets });
    s = { ...s, tickets: st.tickets };
  }
  if (carryPlan(st, wk)) {
    await chrome.storage.local.set({ weeks: st.weeks });
    s = { ...s, weeks: st.weeks };
  }
  return s;
}

const mins = (ms) => Math.max(0, Math.round(ms / 6000) / 10); // minutes, 1 decimal

// The 'sessionEnd' alarm fires when the session's work time reaches its length (only counted while working).
function scheduleEnd(a) {
  const left = a.minutes * 60000 - workedMs(a);
  if (left > 0) chrome.alarms.create('sessionEnd', { when: Date.now() + left });
}

// Close the current phase: add its time to its bucket and start the next one.
function switchPhase(a, next) {
  const now = Date.now();
  const bucket = { procrast: 'procrastMs', work: 'workMs', paused: 'pausedMs' }[a.phase];
  a[bucket] = (a[bucket] || 0) + Math.max(0, now - a.phaseStart);
  // Each procrastination stretch is kept so you can say why it happened.
  if (a.phase === 'procrast') a.delays = [...(a.delays || []), { min: mins(now - a.phaseStart), reason: null, note: '', at: now }];
  a.phase = next;
  a.phaseStart = now;
  return a;
}

// A new session always starts in procrastination mode.
// target: { ticketId, goalId, goalName } — the ticket worked on and the habit its time counts toward.
// extras: { firstStep, envChecked, experimentId, twoMinute } — from the active experiment's start ritual.
export async function startSession(task, minutes, { ticketId = null, goalId = null, goalName = '' } = {}, extras = {}) {
  const { activeSession, tickets } = await load();
  if (activeSession) await endSession();
  track('focus_start', { min: minutes, for: ticketId ? 'task' : goalId ? 'habit' : 'free' });
  const now = Date.now();
  const s = { id: crypto.randomUUID(), task, ticketId, goalId, goalName, minutes, start: now, workStart: null, phase: 'procrast', phaseStart: now, procrastMs: 0, workMs: 0, pausedMs: 0, ...extras };
  const t = ticketId && tickets[ticketId];
  if (t && t.sprint == null) Object.assign(t, inSprint(t, weekKeyOf(dateKey()), false)); // started from the backlog
  if (t && t.status === 'todo') t.status = 'doing';
  if (t) await save({ tickets });
  await save({ activeSession: s });
  chrome.alarms.create('sessionTick', { periodInMinutes: 1 });
  return s;
}

// From procrastinating to working: the countdown runs.
export async function startWork() {
  const { activeSession: a } = await load();
  if (a?.phase !== 'procrast') return a;
  switchPhase(a, 'work');
  const first = a.workStart == null;
  a.workStart ??= a.phaseStart;
  await save({ activeSession: a });
  scheduleEnd(a);
  if (first && a.twoMinute) chrome.alarms.create('twoMin', { when: Date.now() + 2 * 60000 }); // two-minute rule
  return a;
}

export async function pauseWork() {
  const { activeSession: a } = await load();
  if (a?.phase !== 'work') return a;
  switchPhase(a, 'paused');
  await save({ activeSession: a });
  await chrome.alarms.clear('sessionEnd');
  return a;
}

// Back from a pause you're procrastinating again until you press Start working.
export async function resumeWork() {
  const { activeSession: a } = await load();
  if (a?.phase !== 'paused') return a;
  switchPhase(a, 'procrast');
  await save({ activeSession: a });
  return a;
}

export async function endSession() {
  const { sessions, activeSession: a } = await load();
  if (!a) return null;
  switchPhase(a, 'ended');
  const rec = {
    id: a.id,
    task: a.task,
    goalId: a.goalId ?? null,
    goalName: a.goalName || '',
    ticketId: a.ticketId ?? null,
    minutes: a.minutes,
    start: a.start,
    workStart: a.workStart,
    end: a.phaseStart,
    procrastMin: mins(a.procrastMs),
    workMin: mins(a.workMs),
    pausedMin: mins(a.pausedMs),
    delays: a.delays || [],
    ...(a.firstStep ? { firstStep: a.firstStep } : {}),
    ...(a.envChecked != null ? { envChecked: a.envChecked } : {}),
    ...(a.experimentId ? { experimentId: a.experimentId } : {}),
  };
  const key = dateKey(new Date(a.start));
  sessions[key] = [...(sessions[key] || []), rec];
  await saveSessions(key, sessions);
  await chrome.storage.local.remove('activeSession');
  await chrome.alarms.clear('sessionEnd');
  await chrome.alarms.clear('pomodoro'); // from older versions
  await chrome.alarms.clear('sessionTick');
  await chrome.alarms.clear('twoMin');
  track('focus_end', { min: rec.workMin, planned: rec.minutes });
  return rec;
}

// ---------- sessions: save, add, edit, delete (each re-syncs the day's check-in) ----------

async function saveSessions(dayKey, sessions) {
  await saveSessionDays([dayKey], sessions);
}

async function saveSessionDays(dayKeys, sessions) {
  const st = await load();
  st.sessions = sessions;
  for (const k of dayKeys) syncDay(st, k);
  await save({ sessions, days: st.days });
}

export async function updateSession(dayKey, id, patch) {
  const { sessions } = await load();
  const list = sessions[dayKey] || [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const x = { ...list[i], ...patch, edited: true };
  x.procrastMin = Math.max(0, Number(x.procrastMin) || 0);
  x.workMin = Math.max(0, Number(x.workMin) || 0);
  x.end = x.start + (x.procrastMin + x.workMin + (x.pausedMin || 0)) * 60000;
  list[i] = x;
  await saveSessions(dayKey, sessions);
  return x;
}

export async function deleteSession(dayKey, id) {
  const { sessions } = await load();
  sessions[dayKey] = (sessions[dayKey] || []).filter((x) => x.id !== id);
  if (!sessions[dayKey].length) delete sessions[dayKey];
  await saveSessions(dayKey, sessions);
}

// Say why a procrastination stretch happened. Works on the running session or a saved one.
export async function setDelayReason(sessionId, idx, reason, note = '') {
  const { sessions, activeSession: a } = await load();
  const apply = (x) => {
    if (!x?.delays?.[idx]) return false;
    x.delays[idx] = { ...x.delays[idx], reason, note: note.trim() };
    return true;
  };
  if (a?.id === sessionId && apply(a)) return save({ activeSession: a });
  for (const k of Object.keys(sessions)) {
    const x = sessions[k].find((y) => y.id === sessionId);
    if (x && apply(x)) return save({ sessions });
  }
}

// Re-point or rename several sessions at once: items = [{ dayKey, id }], patch = { task?, ticketId?, goalId?, goalName? }.
export async function updateSessions(items, patch) {
  const { sessions } = await load();
  const touched = new Set();
  for (const { dayKey, id } of items) {
    const x = (sessions[dayKey] || []).find((y) => y.id === id);
    if (!x) continue;
    Object.assign(x, patch, { edited: true });
    touched.add(dayKey);
  }
  await saveSessionDays([...touched], sessions);
}

// ---------- tickets ----------

// t.sprint: a week key, null for the backlog, or left out for this week.
export async function addTicket(t) {
  const { tickets } = await load();
  if (t.parked) track('thought_parked'); else if (!t.parentId) track('task_add', { backlog: t.sprint === null, due: !!t.due, size: !!t.sizeH }); else track('subtask_add');
  const wk = 'sprint' in t ? t.sprint : weekKeyOf(dateKey());
  const id = crypto.randomUUID();
  tickets[id] = {
    id, title: t.title, sizeH: t.sizeH ?? null, status: 'todo', habitId: t.habitId ?? null, tags: t.tags || [],
    parentId: t.parentId ?? null, sprint: wk, sprints: wk ? [wk] : [], planned: t.planned ?? true, due: t.due || null, loss: t.loss || null, remindAt: t.remindAt || null,
    ...(t.parked ? { parked: true, parkedFrom: t.parkedFrom || null } : {}), ...(t.notes ? { notes: t.notes } : {}),
    createdAt: Date.now(), doneAt: null,
  };
  await save({ tickets });
  return tickets[id];
}

// Fields for a ticket entering sprint wk. Planned if it goes into a future sprint or on the sprint's first
// day (Saturday); pulled in mid-sprint it's unplanned work.
function inSprint(t, wk, planned = wk > weekKeyOf(dateKey()) || dayIndexInWeek(dateKey()) === 0) {
  return { sprint: wk, sprints: [...new Set([...(t.sprints || []), wk])], planned };
}

// Move a ticket (and its unfinished subtasks) into sprint wk, or back to the backlog (wk = null).
// Going back, a sprint it logged no time in that week drops out of its history.
export async function moveTicket(id, wk) {
  const { tickets, sessions } = await load();
  const t = tickets[id];
  if (!t) return null;
  const kids = Object.values(tickets).filter((x) => x.parentId === id && x.status !== 'done');
  for (const x of [t, ...kids]) {
    if (wk) Object.assign(x, inSprint(x, wk));
    else {
      const was = x.sprint;
      const logged = was && sessionsIn(weekDays(was), { sessions }).some((y) => y.ticketId === x.id);
      x.sprints = (x.sprints || []).filter((w) => w !== was || logged);
      x.sprint = null;
      x.planned = true; // decided again when it next enters a sprint
    }
  }
  await save({ tickets });
  return t;
}

// Change a ticket. If the habit it counts toward changes, its sessions follow and the days re-sync.
export async function updateTicket(id, patch) {
  const { tickets, sessions } = await load();
  const t = tickets[id];
  if (!t) return null;
  const habitChanged = 'habitId' in patch && patch.habitId !== t.habitId;
  if (patch.status && patch.status !== t.status) patch.doneAt = patch.status === 'done' ? Date.now() : null;
  if (patch.status === 'done' && t.status !== 'done') track(t.parentId ? 'subtask_done' : 'task_done');
  else if (Object.keys(patch).some((k) => ['title', 'due', 'sizeH', 'sprint', 'habitId', 'tags', 'loss', 'remindAt', 'notes'].includes(k))) track('task_edit', { fields: Object.keys(patch).join(',') });
  const doneDay = (x) => (x.doneAt ? dateKey(new Date(x.doneAt)) : null);
  const touched = new Set([doneDay(t)]); // the day its estimate counted before…
  Object.assign(t, patch);
  touched.add(doneDay(t)); // …and after
  await save({ tickets });
  if (habitChanged) {
    for (const [k, list] of Object.entries(sessions)) for (const x of list) if (x.ticketId === id) { x.goalId = t.habitId; touched.add(k); }
  }
  touched.delete(null);
  if (touched.size) await saveSessionDays([...touched], sessions); // re-sync: done-without-timer estimates count toward the habit
  return t;
}

// Your own order for a list of tasks (drag to reorder): rank 0, 1, 2 … in the order given.
export async function rankTickets(ids) {
  const { tickets } = await load();
  ids.forEach((id, i) => { if (tickets[id]) tickets[id].rank = i; });
  await save({ tickets });
}

// Delete a ticket (and its subtasks). Their sessions stay, without a ticket.
export async function deleteTicket(id) {
  const { tickets, sessions } = await load();
  const ids = new Set([id, ...Object.values(tickets).filter((t) => t.parentId === id).map((t) => t.id)]);
  track('task_delete');
  const days = [...ids].map((x) => tickets[x]).filter((x) => x?.doneAt).map((x) => dateKey(new Date(x.doneAt)));
  for (const x of ids) delete tickets[x];
  for (const list of Object.values(sessions)) for (const x of list) if (ids.has(x.ticketId)) x.ticketId = null;
  await save({ tickets, sessions });
  if (days.length) await saveSessionDays([...new Set(days)], sessions);
}

// ---------- profile, tactic trials, urges ----------

// Onboarding finished (or edited): the profile, this week's plan, a few settings.
export async function saveOnboarding({ profile, weekKey, plan, settings = {} }) {
  const st = await load();
  track(st.profile?.onboardedAt ? 'onboarding_edit' : 'onboarding_done', { habits: profile.habits?.length || 0 });
  st.weeks[weekKey] = plan;
  delete st.weeks[weekKey].carriedFrom;
  await save({ profile, weeks: st.weeks, settings: { ...st.settings, ...settings } });
}

// Tactic records from the engine (new trials, finished ones).
export async function saveTactics(records) {
  if (!records.length) return;
  const { tactics } = await load();
  for (const r of records) tactics[r.id] = r;
  await save({ tactics });
}

// The urge pause: 'resisted' or 'gave'. Giving in to a counted habit (cigarettes, snacks) adds one to it.
export async function logUrge(dayKey, goal, outcome) {
  track('urge', { outcome });
  const st = await load();
  const day = st.days[dayKey] || { values: {}, reasons: {}, note: '', complete: false };
  const u = { resisted: 0, gave: 0, ...(day.urges?.[goal.id] || {}) };
  u[outcome === 'resisted' ? 'resisted' : 'gave']++;
  day.urges = { ...(day.urges || {}), [goal.id]: u };
  const m = goal.metrics?.[0];
  if (outcome === 'gave' && m?.kind === 'perDayMax' && m.unit === 'times') {
    const k = `${goal.id}.${m.id}`;
    day.values = { ...day.values, [k]: (Number(day.values?.[k]) || 0) + 1 };
  }
  day.savedAt = Date.now();
  st.days[dayKey] = day;
  await save({ days: st.days });
}

// ---------- pause (sick, travelling): no penalties, streaks kept ----------

// Start a pause today, until `untilDay` (a date key, inclusive) or open-ended (null).
export async function startPause(untilDay = null, reason = '') {
  track('pause', { until: untilDay ? 'date' : 'open' });
  const { pauses } = await load();
  const today = dateKey();
  const open = pauses.filter((p) => !p.endDay || p.endDay >= today);
  if (open.some((p) => p.startDay <= today)) return null; // already paused
  const p = { id: crypto.randomUUID(), startDay: today, endDay: untilDay, reason };
  await save({ pauses: [...pauses, p] });
  return p;
}

// End the pause covering today (it ends yesterday, so today counts again).
export async function endPause() {
  const { pauses } = await load();
  const today = dateKey();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = dateKey(y);
  const next = pauses.flatMap((p) => {
    const covers = p.startDay <= today && (!p.endDay || p.endDay >= today);
    if (!covers) return [p];
    return p.startDay >= today ? [] : [{ ...p, endDay: yesterday }];
  });
  await save({ pauses: next });
}

// ---------- rewards marketplace (removed in 0.2.0; kept for old data) ----------

export async function buyItem(item) {
  track('market_claim', { item: item.id });
  const { purchases } = await load();
  const p = { id: crypto.randomUUID(), itemId: item.id, name: item.name, price: item.price, currency: 'kleos', at: Date.now() };
  await save({ purchases: [...purchases, p] });
  return p;
}

export async function undoPurchase(id) {
  const { purchases } = await load();
  await save({ purchases: purchases.filter((p) => p.id !== id) });
}

// ---------- readiness, experiments, intentions ----------

export async function saveReadiness(dayKey, r) {
  const { days } = await load();
  days[dayKey] = { values: {}, reasons: {}, note: '', complete: false, savedAt: Date.now(), ...(days[dayKey] || {}), readiness: { ...r, at: Date.now() } };
  await save({ days });
}

// Start an experiment from the playbook (ends any running one today).
export async function startExperiment(playId, reason = null) {
  const { experiments } = await load();
  const today = dateKey();
  for (const e of experiments) if (!e.endDay) e.endDay = today;
  const e = { id: crypto.randomUUID(), playId, reason, startDay: today, endDay: null };
  await save({ experiments: [...experiments, e] });
  return e;
}

export async function endExperiment() {
  const { experiments } = await load();
  for (const e of experiments) if (!e.endDay) e.endDay = dateKey();
  await save({ experiments });
}

// "I will work on <label> at <time>": stored, and an alarm reminds you then.
export async function addIntention(at, ticketId, label) {
  const { intentions } = await load();
  const x = { id: crypto.randomUUID(), at, ticketId, label, done: false };
  const keep = intentions.filter((i) => i.at > Date.now() - 864e5 * 14);
  await save({ intentions: [...keep, x] });
  chrome.alarms.create(`intent:${x.id}`, { when: at });
  return x;
}

// Replace all data (import / erase), keeping backups and this device's sign-in. With sync on, the change
// reaches your other devices too.
export async function replaceAll(data) {
  const keep = await deviceOnly();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ ...withoutDeviceKeys(data || {}), ...keep });
}

// ---------- habits, from a playbook page ----------

// Change one day's record (values, log, pb) in place; works out whether the day is complete.
export async function updateDay(dayKey, fn) {
  const st = await load();
  const day = st.days[dayKey] || { values: {}, reasons: {}, note: '', complete: false };
  day.values = { ...(day.values || {}) };
  fn(day, st);
  day.complete = isDayComplete(st, dayKey, day.values);
  day.savedAt = Date.now();
  st.days[dayKey] = day;
  await save({ days: st.days });
  return st;
}

// Change a habit in this week's plan and every later week that has it (plans are copied week to week).
export async function updateGoal(goalId, fn, fromWeek = weekKeyOf(dateKey())) {
  const st = await load();
  let n = 0;
  for (const [wk, plan] of Object.entries(st.weeks)) {
    if (wk < fromWeek) continue;
    const g = plan.goals?.find((x) => x.id === goalId);
    if (!g) continue;
    fn(g, plan);
    delete plan.carriedFrom;
    n++;
  }
  if (n) await save({ weeks: st.weeks });
  return n;
}

// Add a habit to this week's plan (starting it from the last plan if this week has none) and later weeks.
export async function addHabit(goal, fromWeek = weekKeyOf(dateKey())) {
  const st = await load();
  if (!st.weeks[fromWeek]) {
    const prev = Object.keys(st.weeks).filter((k) => k < fromWeek).sort().at(-1);
    st.weeks[fromWeek] = { theme: '', goals: structuredClone(st.weeks[prev]?.goals || []), setAt: Date.now() };
  }
  for (const [wk, plan] of Object.entries(st.weeks)) {
    if (wk < fromWeek || plan.goals.some((g) => g.id === goal.id)) continue;
    plan.goals.push(structuredClone(goal));
    delete plan.carriedFrom;
  }
  track('habit_add', { pb: goal.playbook || null });
  await save({ weeks: st.weeks });
}

// Move a habit to the backlog: out of this week's plan and later ones, kept (with its setup) in
// settings.habitBacklog so it can come back. Its past days stay.
export async function archiveHabit(goalId, fromWeek = weekKeyOf(dateKey())) {
  const st = await load();
  // its latest setup, from the newest plan that has it
  const g = Object.keys(st.weeks).sort().reverse().map((wk) => st.weeks[wk].goals?.find((x) => x.id === goalId)).find(Boolean);
  if (g) {
    const backlog = (st.settings.habitBacklog || []).filter((x) => x.id !== goalId);
    st.settings.habitBacklog = [{ ...structuredClone(g), archivedAt: Date.now() }, ...backlog];
    await save({ settings: st.settings });
  }
  await removeHabit(goalId, fromWeek);
}

// Bring a habit back from the backlog into this week's plan (and later ones).
export async function restoreHabit(goalId, fromWeek = weekKeyOf(dateKey())) {
  const st = await load();
  const g = (st.settings.habitBacklog || []).find((x) => x.id === goalId);
  if (!g) return null;
  const { archivedAt, ...goal } = g;
  void archivedAt;
  await addHabit(goal, fromWeek);
  const st2 = await load();
  st2.settings.habitBacklog = (st2.settings.habitBacklog || []).filter((x) => x.id !== goalId);
  await save({ settings: st2.settings });
  return goal;
}

// Take a habit out of this week's plan and later ones. Its past days stay.
export async function removeHabit(goalId, fromWeek = weekKeyOf(dateKey())) {
  const st = await load();
  for (const [wk, plan] of Object.entries(st.weeks)) {
    if (wk < fromWeek) continue;
    plan.goals = (plan.goals || []).filter((g) => g.id !== goalId);
    delete plan.carriedFrom;
  }
  await save({ weeks: st.weeks });
}
