import { load, save, weeklyBackup } from './lib/storage.js';
import { morningBrief, eveningCheckin, habitCue } from './lib/notify.js';
import { syncNow, syncSoon, triggersSync } from './lib/syncRunner.js';
import { activeExperiment } from './lib/coach.js';
import { dateKey, addDays, weekKeyOf, dayScore, band, workedMs, phaseMs, planOf, metricKey, isDayComplete } from './lib/score.js';

const BADGE = { green: '#1fa971', yellow: '#f29d12', red: '#f0716b', none: '#a8968a' };

function nextAt(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Daily alarms; each is created only while its switch is on. Habit cues: one alarm per habit with a cue time.
async function scheduleReminders(settings, state) {
  const daily = (name, on, time) => (on && time ? chrome.alarms.create(name, { when: nextAt(time), periodInMinutes: 1440 }) : chrome.alarms.clear(name));
  daily('checkin', settings.checkinOn !== false, settings.reminderTime);
  daily('plan', settings.planOn !== false, settings.planTime);
  daily('morning', settings.morningOn !== false, settings.morningTime);
  const want = settings.cuesOn === false ? [] : (planOf(dateKey(), state || (await load()))?.goals || []).filter((g) => g.cueTime);
  for (const a of await chrome.alarms.getAll()) if (a.name.startsWith('cue:') && !want.some((g) => `cue:${g.id}` === a.name)) chrome.alarms.clear(a.name);
  for (const g of want) {
    const a = await chrome.alarms.get(`cue:${g.id}`);
    const when = nextAt(g.cueTime);
    if (!a || Math.abs(a.scheduledTime - when) > 60000) chrome.alarms.create(`cue:${g.id}`, { when, periodInMinutes: 1440 });
  }
}

// When the running session's work time will reach its length (not while paused).
function scheduleSessionEnd(a) {
  if (a?.phase !== 'work') return;
  const left = a.minutes * 60000 - workedMs(a);
  if (left > 0) chrome.alarms.create('sessionEnd', { when: Date.now() + left });
}

async function setup() {
  const st = await load();
  const { settings, activeSession } = st;
  scheduleReminders(settings, st);
  chrome.alarms.create('tick', { periodInMinutes: 30 });
  if (activeSession) {
    chrome.alarms.create('sessionTick', { periodInMinutes: 1 });
    scheduleSessionEnd(activeSession);
  }
  updateBadge();
  weeklyBackup();
  updateBlocker();
  chrome.alarms.create('sync', { periodInMinutes: 1 }); // pull other devices' changes
  syncNow();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const state = await load();
  const today = dateKey();
  if (alarm.name === 'sync') syncNow();
  if (alarm.name === 'tick') { weeklyBackup(); scheduleReminders(state.settings, state); } // new week → new habits' cues
  if (alarm.name === 'checkin') {
    const n = eveningCheckin(state, today);
    if (n) notify('checkin', n.title, n.message);
  }
  if (alarm.name === 'morning') {
    const n = morningBrief(state, today);
    if (n) notify('morning', n.title, n.message);
  }
  if (alarm.name.startsWith('cue:')) {
    const id = alarm.name.slice(4);
    const n = habitCue(state, today, id);
    if (n) notify(`cue~${id}`, n.title, n.message, n.canTick ? [{ title: '✓ Done' }] : []);
  }
  if (alarm.name === 'plan' && new Date().getDay() === 5) {
    const nextWeek = weekKeyOf(dateKey(addDays(new Date(), 1)));
    if (!state.weeks[nextWeek]) {
      notify('plan', 'Friday night — retro, then plan', 'Review this sprint’s numbers, then set next week’s habits and tickets.');
    }
  }
  if (alarm.name === 'twoMin' && state.activeSession?.phase === 'work') {
    notify('session', '✅ Two minutes in. You started.', 'That was the hard part. Keep going if it flows; the session is already a win.');
  }
  if (alarm.name.startsWith('intent:')) {
    const x = state.intentions.find((i) => `intent:${i.id}` === alarm.name);
    if (x) notify('intent', `🗓️ Time for: ${x.label}`, 'You decided to start this now. Open Odyssey and hit Start task.');
  }
  if (alarm.name === 'sessionEnd') {
    const s = state.activeSession;
    if (s?.phase === 'work') {
      notify('session', `⏰ ${s.minutes} min done`, `“${s.task}” — end the session, or keep going.`);
    }
  }
  updateBadge();
});

function notify(kind, title, message, buttons = []) {
  chrome.notifications.create(`${kind}-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2,
    ...(buttons.length ? { buttons, requireInteraction: true } : {}),
  });
}

// "✓ Done" on a habit cue: tick it for today without opening anything.
chrome.notifications.onButtonClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  if (!id.startsWith('cue~')) return;
  const goalId = id.slice(4).replace(/-\d+$/, '');
  const state = await load();
  const today = dateKey();
  const g = planOf(today, state)?.goals.find((x) => x.id === goalId);
  const m = g?.metrics.find((x) => x.kind === 'daysPerWeek');
  if (!m) return;
  const old = state.days[today] || { values: {}, reasons: {}, note: '' };
  const values = { ...old.values, [metricKey(g, m)]: true };
  state.days[today] = { ...old, values, complete: isDayComplete(state, today, values), savedAt: Date.now() };
  await save({ days: state.days });
  notify('done', `${g.icon || '⭐'} ${g.name} ✓`, 'Logged for today. That’s a vote for who you’re becoming.');
});

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  if (id.startsWith('plan')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#retro') });
    return;
  }
  try {
    await chrome.action.openPopup();
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  }
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (triggersSync(Object.keys(changes))) syncSoon(); // push local edits a moment later
  if (changes.activeSession) {
    // a session started, switched or ended (maybe on another device): keep the end alarm in step
    const a = changes.activeSession.newValue;
    if (a?.phase === 'work') scheduleSessionEnd(a); else chrome.alarms.clear('sessionEnd');
    if (a) chrome.alarms.create('sessionTick', { periodInMinutes: 1 }); else chrome.alarms.clear('sessionTick');
  }
  if (changes.settings || changes.weeks) { const st = await load(); scheduleReminders(st.settings, st); }
  if (changes.activeSession || changes.experiments || changes.settings) updateBlocker();
  updateBadge();
});

// Inversion of the 1st law (make it difficult): while the "Block the distractions" experiment is on
// and a session is running (not paused), the blocked sites don't load.
async function updateBlocker() {
  const state = await load();
  const on = activeExperiment(state)?.playId === 'blocker' && state.activeSession && state.activeSession.phase !== 'paused';
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const domains = state.settings.blockList.map((d) => d.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase()).filter(Boolean);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: on && domains.length
      ? [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: domains, resourceTypes: ['main_frame', 'sub_frame'] } }]
      : [],
  });
}

// While a session runs the badge shows its minutes: coral while procrastinating, green while working,
// yellow while paused.
// Otherwise it shows today's score.
async function updateBadge() {
  const state = await load();
  const s = state.activeSession;
  if (s) {
    const ms = s.phase === 'procrast' ? phaseMs(s, 'procrast') : workedMs(s);
    await chrome.action.setBadgeText({ text: `${Math.floor(ms / 60000)}m` });
    await chrome.action.setBadgeBackgroundColor({ color: { procrast: BADGE.red, work: BADGE.green, paused: BADGE.yellow }[s.phase] });
    return;
  }
  const score = dayScore(dateKey(), state)?.score ?? null;
  await chrome.action.setBadgeText({ text: score == null ? '?' : String(score) });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE[band(score)] });
}
