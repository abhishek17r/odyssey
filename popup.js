import {
  BAND_LABEL, dateKey, weekDays, addDays, weekKeyOf, planOf, dayScore, band, rollingAvg, streak, weekSummary,
  weekSoFar, dayIndexInWeek, metricKey, targetText, round1, goalTags, sessionTotals, workedMs, phaseMs, procrastPct,
  DELAY_REASONS, ticketTitle, ticketsInSprint, dueInfo, timeOnDay, backlogTickets, TICKET_STATUS,
  goalAvgs, goalTrendKey, lastNDays, reasonStats, reasonById, timeOnDays, parseKey, goalStatus, STATUS, metricWeek, pauseOn,
} from './lib/score.js';
import { openPlanSheet } from './lib/planSheet.js';
import { openReviewSheet } from './lib/reviewSheet.js';
import { openRewardsSheet } from './lib/rewardsSheet.js';
import { insights, daysText } from './lib/insights.js';
import { kleos, plannedOn, POINTS } from './lib/points.js';
import { moveTicket, startPause, endPause, saveOnboarding, saveTactics, logUrge, deleteTicket } from './lib/storage.js';
import { parseQuickAdd } from './lib/quickAdd.js';
import { swipeToDelete, undoToast } from './lib/controls.js';
import { openOnboarding } from './lib/onboarding.js';
import { openUrgePause } from './lib/urgePause.js';
import { runEngine, tacticLine } from './lib/engine.js';
import { morningLine, eveningReply, weeklyRead, proposals, applyProposal, decide, lineDismissed, dismissLine } from './lib/athena.js';
import { athenaRead } from './lib/reviewSheet.js';
import { voyage, LEGS } from './lib/voyage.js';
import { athena, galley } from './lib/figures.js';
import { isOnboarded, habitType } from './lib/profile.js';
import { openDrawer } from './lib/controls.js';
import { currentUser } from './lib/cloud.js';
import { VERSION } from './version.js';
import { weekMetrics } from './lib/metrics.js';
import { esc, tagChips } from './lib/ui.js';
import { buildCheckin, bindReflection } from './lib/checkin.js';
import { saveReadiness, addIntention } from './lib/storage.js';
import { stepper, scale, checkBtn, toast, celebrate, toggle } from './lib/controls.js';
import { nowPlayingOn, nowPlayingOff, nowPlayingUpdate, nowPlayingSupported, setCarrier, bindHandlers } from './lib/nowPlaying.js';
import { STATIONS, stationsOf, stationById, checkStream, radioPlay, radioPause, radioStop, radioState, radioAudio, onRadio } from './lib/radio.js';
import { gcalUrl, openUrl } from './lib/gcal.js';
import { setTicketContext, openTicket, refreshDrawer, kidsOf, loggedH } from './lib/tickets.js';
import { renderAccount } from './lib/account.js';
import { renderNotifPanel } from './lib/notifPanel.js';
import { musicEmbed, firstLink, musicTitle, playlistsOf } from './lib/music.js';
import { load, save, addTicket, updateTicket, startSession, startWork, pauseWork, resumeWork, endSession, setDelayReason } from './lib/storage.js';
import { timedHabits, targetOptions, resolveTarget } from './lib/targets.js';
import {
  readinessScore, READINESS_LABEL, focusTarget, bestStartBlock, votes, quickStartStreak, missedYesterday,
  activeExperiment, playById, LAWS, isPlayOn,
} from './lib/coach.js';
import { timeToStart, QUICK_START_MIN } from './lib/metrics.js';

const $ = (s) => document.querySelector(s);
const today = dateKey();
const isFriday = new Date().getDay() === 5;
const RING_C = 2 * Math.PI * 52;
const TIMER_C = 2 * Math.PI * 96; // the focus timer ring
const CHEER = {
  green: 'Fair winds. Keep sailing.',
  yellow: 'Steady progress. Small wins add up.',
  red: 'Rough seas today. Tomorrow is a clean slate.',
  none: 'One minute to log today.',
};

let state;
let tick = null;

async function init() {
  state = await load();
  setTicketContext({ getState: () => state });
  if (state.activeSession) askWhy(state.activeSession); // an unanswered stretch from earlier
  $('#tbDay').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  $('#dateLabel').textContent = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  render();
  const v0 = sessionStorage.getItem('view');
  showView(['today', 'week', 'trends', 'me'].includes(v0) ? v0 : 'today');
  if (state.activeSession) setFullscreen(true);
  renderAccount($('#meAccount'));
  renderExtras();
  renderMusic();
  renderNotifPanel($('#meNotif'));
  await engineTick();
  render();
  // first launch: set your course (once per launch until done; the splash covers it until it fades)
  let asked = false;
  try { asked = !!sessionStorage.getItem('onbAsked'); sessionStorage.setItem('onbAsked', '1'); } catch { /* fine */ }
  if (!isOnboarded(state) && !asked) startOnboarding();
  // links from notifications: ?open=review | plan | rewards | week
  const open = new URLSearchParams(location.search).get('open');
  if (open) {
    history.replaceState(null, '', location.pathname);
    ({ review: openReview, plan: () => openPlan(), rewards: openRewards, week: () => showView('week') })[open]?.();
  }
}

function render() {
  renderHeader();
  renderBanner();
  const plan = planOf(today, state);
  $('#noPlan').hidden = !!plan;
  $('#todayCard').hidden = !plan;
  if (plan) renderForm();
  renderDue();
  renderSession();
  renderReflection();
  renderWeek();
  renderMe();
  renderPause();
  renderCourse();
  renderAthena();
}

// ---------- header ----------

function renderHeader() {
  const score = dayScore(today, state)?.score ?? null;
  const b = band(score);
  const arc = $('#ringArc');
  arc.setAttribute('stroke-dasharray', `${(RING_C * (score ?? 0)) / 100} ${RING_C}`);
  arc.setAttribute('stroke', `url(#g-${b})`);
  $('#scoreText').textContent = score ?? '—';
  $('#bandLabel').textContent = BAND_LABEL[b];
  $('#bandLabel').className = `band ${b}`;
  $('#cheer').textContent = CHEER[b];
  // Kleos: a little "+20 ⚡" whenever something you did changes today's points
  const K = kleos(state, today);
  if (lastKleos != null && K.today !== lastKleos) pointsPop(K.today - lastKleos);
  lastKleos = K.today;
}
let lastKleos = null;
function pointsPop(d) {
  const p = document.createElement('div');
  p.className = `pointsPop ${d < 0 ? 'neg' : ''}`;
  p.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d)} ${POINTS.icon}`;
  document.body.append(p);
  setTimeout(() => p.remove(), 1600);
}

function renderBanner() {
  const el = $('#planBanner');
  el.hidden = !(isFriday && !state.weeks[weekKeyOf(dateKey(addDays(new Date(), 1)))]);
  el.textContent = '🗓️ It’s Friday. Review the week, then plan the next →';
  el.onclick = () => openReview();
}

$('#planNow').onclick = () => (isOnboarded(state) ? openPlan(weekKeyOf(today)) : startOnboarding());

// ---------- onboarding, the behaviour engine, the urge pause ----------
function startOnboarding() {
  const had = isOnboarded(state);
  openOnboarding({
    state, todayKey: today, weekKey: weekKeyOf(today),
    onDone: async ({ profile, plan, settings }) => {
      await saveOnboarding({ profile, weekKey: weekKeyOf(today), plan, settings });
      state = await load();
      await engineTick(true);
      render();
      showView('today');
      toast(had ? 'Course updated' : 'Course set. Your first step is today.');
    },
  });
}
// once a day (or after onboarding): finish week-long tactic trials, start the next ones
async function engineTick(force = false) {
  try {
    if (!force && sessionStorage.getItem('engineDay') === today) return;
    sessionStorage.setItem('engineDay', today);
  } catch { /* private mode: run anyway */ }
  const recs = runEngine(state, today);
  if (recs.length) { await saveTactics(recs); state = await load(); }
}
function urgeFor(g) {
  openUrgePause({ goal: g, onDone: async (outcome) => {
    await logUrge(today, g, outcome);
    state = await load();
    renderForm(); renderHeader(); renderWeek();
    toast(outcome === 'resisted' ? 'You rode it out' : 'Logged. The next one is a fresh chance.');
  } });
}

// ---------- sheets: plan, review, rewards (in the app) ----------
const refreshAll = async () => { state = await load(); render(); if (view === 'trends') renderTrends(); };
const openPlan = (wk = weekKeyOf(today)) => openPlanSheet({ wk, onSaved: refreshAll, top: proposalsInto });

// ---------- Athena (templates for now): Today's line, the evening reply, proposals in Plan ----------
function renderAthena() {
  const box = $('#athenaLine');
  const l = !lineDismissed(state, today) ? morningLine(state, today) : null;
  box.hidden = !l;
  if (!l) return;
  box.className = `athenaLine ${l.kind}`;
  box.innerHTML = `<span class="alAvatar">${athena(40)}</span><div class="alBody"><span class="alWho">Athena</span><p>${esc(l.text)}</p></div>`;
  const x = Object.assign(document.createElement('button'), { type: 'button', className: 'alX', textContent: '×', title: 'Hide for today', ariaLabel: 'Hide for today' });
  x.onclick = async () => { await save(dismissLine(state, today)); state = await load(); renderAthena(); };
  box.append(x);
}
function renderReply() {
  const r = eveningReply(state, today);
  $('#athenaReply').hidden = !r;
  $('#athenaReply').innerHTML = r ? `<span class="arAvatar">${athena(26)}</span><span>${esc(r)}</span>` : '';
}
// Plan sheet, top: Athena's suggestions, each Accept or Not now
function proposalsInto(box, redraw) {
  const list = proposals(state, today);
  if (!list.length) return;
  box.append(Object.assign(document.createElement('div'), { className: 'groupHead athenaHead', innerHTML: `${athena(24)}<span>Athena suggests</span>` }));
  const g = document.createElement('div');
  g.className = 'iosGroup proposals';
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'cell static proposal';
    row.innerHTML = `<span class="cMain"><span>${esc(p.text)}</span></span>`;
    const yes = Object.assign(document.createElement('button'), { type: 'button', className: 'primary small', textContent: 'Accept' });
    const no = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost small', textContent: 'Not now' });
    yes.onclick = async () => { await save({ ...applyProposal(state, p, today), ...decide(state, p, 'accepted', today) }); state = await load(); toast('Done'); await redraw(); render(); };
    no.onclick = async () => { await save(decide(state, p, 'dismissed', today)); state = await load(); await redraw(); };
    const btns = document.createElement('span');
    btns.className = 'propBtns';
    btns.append(no, yes);
    row.append(btns);
    g.append(row);
  }
  box.append(g);
}
const openReview = () => openReviewSheet({ getState: () => state, today, onChanged: refreshAll });
const openRewards = () => openRewardsSheet({ getState: () => state, today, onChanged: refreshAll });

// ---------- form ----------

let form = null;

function renderForm() {
  $('#note').value = state.days[today]?.note ?? '';
  form = buildCheckin({ box: $('#goalQs'), dayKey: today, getState: () => state, onSaved: () => { renderHeader(); renderProgress(); }, compact: true,
    getTactic: (g) => tacticLine(state, g, today), onUrge: urgeFor, onPlan: () => openPlan() });
  renderProgress();
}
$('#note').addEventListener('change', () => form?.saveNote($('#note').value.trim()));

// "3/5 habits · 1 due" in the Today card's header.
function renderProgress() {
  const plan = planOf(today, state);
  if (!plan) return;
  const vals = state.days[today]?.values || {};
  const logged = plan.goals.filter((g) => g.metrics.every((m) => m.kind === 'perWeekSum' || vals[`${g.id}.${m.id}`] != null)).length;
  const due = dueToday().length;
  const tm = timeOnDay(state, today);
  $('#todayProg').innerHTML = `<b>${logged}/${plan.goals.length}</b> habits${due ? ` · <b>${due}</b> due` : ''}` +
    (tm.totalMin ? ` · <span title="Timer ${hm(tm.timerMin)}${tm.autoMin ? ` + estimated ${hm(tm.autoMin)} (done without the timer)` : ''}">⏱ <b>${hm(tm.totalMin)}</b></span>` : '');
  $('#habitsHead').textContent = logged === plan.goals.length ? 'Habits · all logged 🎉' : `Habits · ${plan.goals.length - logged} to log`;
}

// ---------- tasks due: quick actions ----------

const dueToday = () => ticketsInSprint(weekKeyOf(today), state)
  .filter((x) => x.status !== 'done' && x.due && x.due <= today)
  .sort((a, b) => a.due.localeCompare(b.due));
// due tasks you finished today stay visible, below, as done
const doneToday = () => ticketsInSprint(weekKeyOf(today), state)
  .filter((x) => x.status === 'done' && x.due && x.due <= today && x.doneAt && dateKey(new Date(x.doneAt)) === today);

// Tick → a celebration on the row, then it's marked done (and moves down). Untick → back to open.
const tickTask = (row, chk, t, reopenAs = 'todo') => async (v) => {
  if (v) { celebrate(row, chk); await new Promise((r) => setTimeout(r, 650)); }
  await updateTicket(t.id, { status: v ? 'done' : reopenAs });
  if (v) toast('Done 🎉');
};

function dueRow(t) {
  const done = t.status === 'done';
  const d = dueInfo(t, today);
  const row = document.createElement('div');
  row.className = `task ${done ? 'isDone' : ''}`;
  const chk = checkBtn({ state: done ? true : null, title: done ? 'Mark not done' : 'Mark done', onChange: (v) => tickTask(row, chk, t, 'doing')(v) });
  const main = document.createElement('div');
  main.className = 'tMain';
  main.innerHTML = `<div class="tTitle">${esc(ticketTitle(t, state))}</div><div class="tMeta">${[done ? '<span class="okText">Done today</span>' : `<span class="due ${d.cls}">${esc(d.text)}</span>`, t.sizeH ? `${t.sizeH} h` : '', !done && t.status === 'doing' ? 'in progress' : ''].filter(Boolean).join(' · ')}</div>`;
  row.append(chk, main);
  if (!done) {
    const go = Object.assign(document.createElement('button'), { className: 'playBtn', title: 'Start a focus session on this', innerHTML: '▶' });
    go.disabled = !!state.activeSession;
    go.onclick = () => startOn(`t:${t.id}`);
    row.append(go);
  }
  row.onclick = (e) => { if (!e.target.closest('button')) openTicket(t.id); };
  swipeToDelete(row, () => removeTask(t));
  return row;
}

// Delete a task (and its subtasks), with a few seconds to undo.
async function removeTask(t) {
  const before = structuredClone(state.tickets);
  const ids = [t.id, ...Object.values(before).filter((x) => x.parentId === t.id).map((x) => x.id)];
  await deleteTicket(t.id);
  state = await load();
  undoToast(`Deleted “${t.title}”`, async () => {
    const st = await load();
    for (const id of ids) st.tickets[id] = before[id];
    await save({ tickets: st.tickets });
    state = await load();
    toast('Back');
  });
}
// Add a task from plain words ("Call the bank tomorrow 30m"); `defaults` fills what the words don't say.
async function quickAddTask(text, defaults = {}) {
  const q = parseQuickAdd(text, today);
  if (!q.title) return;
  const wk = 'sprint' in defaults ? defaults.sprint : weekKeyOf(today);
  await addTicket({ title: q.title, due: q.due ?? defaults.due ?? null, sizeH: q.sizeH, sprint: wk, planned: true,
    habitId: wk && timedHabits(wk, state).some((g) => g.id === 'work') ? 'work' : null });
  toast(q.due ? `Added · due ${dueInfo({ due: q.due }, today).text.replace(/^due /, '')}` : 'Added');
}
function addTaskForm(placeholder, defaults) {
  const form = document.createElement('form');
  form.className = 'quickAdd todayAdd';
  form.innerHTML = `<span class="qaPlus">＋</span><input type="text" maxlength="100" placeholder="${placeholder}" enterkeyhint="done" />`;
  const input = form.querySelector('input');
  form.onclick = () => input.focus();
  form.onsubmit = async (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; input.value = ''; await quickAddTask(v, defaults); input.focus(); };
  return form;
}

function renderDue() {
  const box = $('#dueBox');
  const list = dueToday();
  const fin = doneToday();
  const soon = ticketsInSprint(weekKeyOf(today), state).filter((x) => x.status !== 'done' && x.due > today).sort((a, b) => a.due.localeCompare(b.due))[0];
  box.innerHTML = '';
  box.append(Object.assign(document.createElement('div'), { className: 'subHead', textContent: list.length ? `Due today · ${list.length}` : 'Tasks' }));
  if (!list.length) box.insertAdjacentHTML('beforeend', `<div class="emptyLine">✓ Nothing due today${soon ? ` · next: <b>${esc(ticketTitle(soon, state))}</b> ${esc(dueInfo(soon, today).text)}` : ''}</div>`);
  for (const t of list) box.append(dueRow(t));
  box.append(addTaskForm('Add a task… (e.g. Call the bank tomorrow 30m)', { due: today }));
  if (fin.length) {
    box.append(Object.assign(document.createElement('div'), { className: 'habitGroup done', textContent: `Done · ${fin.length}` }));
    for (const t of fin) box.append(dueRow(t));
  }
}

// Open the timer's start panel with this target picked.
function startOn(value) {
  showView('today');
  if ($('#sAsk').hidden) $('#sStartBtn').click();
  setTimeout(() => $('#sessionCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  if (value?.startsWith('t:') && state.tickets[value.slice(2)]) setPicked(value);
}

// ---------- reflection ----------

const reflection = bindReflection({
  textarea: $('#reflection'),
  msgEl: $('#reflectMsg'),
  getDayKey: () => today,
  getState: () => state,
});
const renderReflection = () => { reflection.refresh(); $('#reflectCard').open = !!$('#reflection').value.trim(); renderReply(); };

// ---------- implementation intention: when is the next session? ----------

function offerNext(rec) {
  const on = rec && isPlayOn(state, 'intention');
  $('#sNext').hidden = !on;
  if (!on) return;
  const d = new Date(Date.now() + 2 * 3600000);
  d.setMinutes(0, 0, 0);
  if (d.getHours() >= 21 || d.getHours() < 7 || d.getDate() !== new Date().getDate()) { // too late: tomorrow morning
    d.setTime(Date.now());
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  const pad = (n) => String(n).padStart(2, '0');
  $('#sNextAt').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  const t = rec.ticketId && state.tickets[rec.ticketId];
  const label = t ? ticketTitle(t, state) : rec.task;
  $('#sNextSet').onclick = async () => {
    const at = new Date($('#sNextAt').value).getTime();
    if (!(at > Date.now())) return;
    await addIntention(at, rec.ticketId || null, label);
    $('#sNext').hidden = true;
    $('#sSaved').textContent = `🗓️ “I will work on ${label} at ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.” Reminder set. `;
    const cal = Object.assign(document.createElement('a'), { textContent: '📅 Add to Google Calendar' });
    cal.onclick = () => openUrl(gcalUrl({ title: `🎯 ${label}`, details: 'Planned focus session from Odyssey', start: new Date(at), minutes: state.settings.sessionMinutes }));
    $('#sSaved').append(cal);
  };
  $('#sNextSkip').onclick = () => ($('#sNext').hidden = true);
}

// ---------- mark the ticket done after a session ----------

function offerDone(rec) {
  const t = rec?.ticketId && state.tickets[rec.ticketId];
  $('#sDone').hidden = !t || t.status === 'done';
  if (!t) return;
  $('#sDoneBtn').textContent = `✓ Mark “${ticketTitle(t, state)}” done`;
  $('#sDoneBtn').onclick = async () => {
    await updateTicket(t.id, { status: 'done' });
    $('#sDone').hidden = true;
    $('#sSaved').textContent = `“${t.title}” done 🎉`;
  };
}

// ---------- why the delay? ----------

// Ask about the latest procrastination stretch if it was long enough and has no reason yet.
function askWhy(session) {
  const box = $('#sWhy');
  const idx = (session?.delays || []).length - 1;
  const d = session?.delays?.[idx];
  if (!d || d.reason || d.min < state.settings.askWhyMinutes) { box.hidden = true; return; }
  box.hidden = false;
  $('#sWhyQ').textContent = `What held you back for ${Math.round(d.min)} min${idx ? ' after the pause' : ''}?`;
  $('#sWhyNote').value = '';
  const chips = $('#sWhyChips');
  chips.innerHTML = '';
  for (const r of DELAY_REASONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${r.icon} ${r.label}`;
    b.onclick = async () => {
      await setDelayReason(session.id, idx, r.id, $('#sWhyNote').value);
      box.hidden = true;
      $('#sSaved').textContent = `Noted: ${r.label.toLowerCase()} ✓`;
    };
    chips.append(b);
  }
  $('#sWhySkip').onclick = () => (box.hidden = true);
}

// ---------- task timer ----------

const clock = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const hm = (min) => (min >= 60 ? `${round1(min / 60)} h` : `${Math.round(min)} min`);
const timeOf = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function renderSession() {
  const a = state.activeSession;
  const card = $('#sessionCard');
  card.classList.toggle('procrast', a?.phase === 'procrast');
  card.classList.toggle('working', a?.phase === 'work');
  card.classList.toggle('paused', a?.phase === 'paused');
  $('#sIdle').hidden = !!a;
  $('#sRun').hidden = !a;
  const t = sessionTotals([today], state);
  $('#sToday').textContent = t.count
    ? `Today: ${t.count} session${t.count > 1 ? 's' : ''} · ${hm(t.procrastMin)} to get started · ${hm(t.workMin)} working`
    : '';
  card.classList.toggle('running', !!a);
  $('#qtForm').hidden = !!a;
  renderPlayer();
  clearInterval(tick);
  if (!a) return;
  $('#sSaved').textContent = '';
  $('#sFirst').hidden = !a.firstStep;
  $('#sFirst').innerHTML = a.firstStep ? `👉 <b>First:</b> ${esc(a.firstStep)}` : '';
  const tk = a.ticketId && state.tickets[a.ticketId];
  $('#sTaskName').textContent = tk ? ticketTitle(tk, state) : a.task;
  $('#sGoalName').textContent = [tk && a.task !== tk.title ? a.task : '', a.goalName && (tk || a.task !== a.goalName) ? `counts toward ${a.goalName}` : ''].filter(Boolean).join(' · ');
  $('#sWork').hidden = a.phase !== 'procrast';
  $('#sWork').textContent = a.workStart ? '▶ Back to work' : '▶ Start working';
  $('#sPause').hidden = a.phase === 'procrast';
  $('#sPause').textContent = a.phase === 'paused' ? '▶ Resume' : '⏸ Pause';
  $('#sStarted').textContent = `since ${timeOf(a.start)} · ${a.minutes} min session`;
  const len = (a.minutes || state.settings.sessionMinutes) * 60000;
  const arc = $('#tArc');
  const setArc = (frac) => (arc.style.strokeDasharray = `${Math.max(0, Math.min(1, frac)) * TIMER_C} ${TIMER_C}`);
  const upd = () => {
    const now = Date.now();
    const worked = workedMs(a, now);
    const procrast = phaseMs(a, 'procrast', now);
    const paused = phaseMs(a, 'paused', now);
    // how the session's time has gone so far
    $('#spP').style.flexGrow = procrast;
    $('#spW').style.flexGrow = worked;
    $('#spZ').style.flexGrow = paused;
    if ((state.settings.lockScreen || radioState().playing) && a) {
      const lenMs = (a.minutes || state.settings.sessionMinutes) * 60000;
      if (!upd.last || now - upd.last > 15000 || upd.phase !== a.phase) {
        upd.last = now; upd.phase = a.phase;
        const tk2 = a.ticketId && state.tickets[a.ticketId];
        nowPlayingUpdate({ task: tk2 ? ticketTitle(tk2, state) : a.task, phase: a.phase, leftMs: lenMs - worked, lengthMs: lenMs, workedMs: worked, todayMin: t.workMin + worked / 60000, station: radioState().playing ? radioState().station?.name : null });
      }
    }
    $('#lgP').textContent = clock(procrast);
    $('#lgW').textContent = clock(worked);
    $('#lgZ').textContent = clock(paused);
    if (a.phase === 'procrast') {
      const stretch = now - a.phaseStart;
      $('#sPhase').className = 'status st-missed';
      $('#sPhase').textContent = '● Procrastinating';
      $('#sClockLabel').textContent = a.workStart ? 'not back yet' : 'not started yet';
      $('#sClock').textContent = clock(stretch);
      $('#sClockSub').textContent = a.workStart ? `${clock(Math.max(0, len - worked))} of work left` : `then ${a.minutes} min of work`;
      setArc((stretch % 60000) / 60000); // sweeps once a minute while you wait
      $('#sSub').textContent = a.workStart
        ? 'Back from a pause: this counts until you press Back to work.'
        : 'Counting until you begin. Press Start working the moment you do.';
      return;
    }
    const over = worked >= len;
    const isPaused = a.phase === 'paused';
    $('#sPhase').className = `status ${isPaused ? 'st-risk' : 'st-on'}`;
    $('#sPhase').textContent = isPaused ? '❚❚ Paused' : over ? '✓ Time’s up' : '● Working';
    $('#sClockLabel').textContent = isPaused ? 'paused · left' : over ? 'over time' : 'focus left';
    $('#sClock').textContent = over ? `+${clock(worked - len)}` : clock(len - worked);
    $('#sClockSub').textContent = `${Math.round(Math.min(1, worked / len) * 100)}% of ${a.minutes} min`;
    setArc(worked / len);
    $('#sSub').textContent = isPaused ? 'Resume puts you back in procrastination until you restart.' : over ? 'Session length reached. End it, or keep going.' : '';
  };
  upd();
  tick = setInterval(upd, 1000);
}

const LENGTHS = [25, 45, 60, 90];
function renderLenChips() {
  const cur = Number($('#sMin').value);
  $('#sLenChips').innerHTML = LENGTHS.map((m) => `<button type="button" data-len="${m}" class="${m === cur ? 'on' : ''}">${m}</button>`).join('');
  $('#sLenChips').querySelectorAll('[data-len]').forEach((b) => (b.onclick = () => { $('#sMin').value = b.dataset.len; renderLenChips(); }));
}
$('#sMin').addEventListener('input', renderLenChips);
$('#sCancel').onclick = () => { $('#sAsk').hidden = true; $('#sStartBtn').hidden = false; };

$('#sStartBtn').onclick = () => {
  $('#sStartBtn').hidden = true;
  $('#sAsk').hidden = false;
  $('#sSaved').textContent = '';
  $('#sMin').value = state.settings.sessionMinutes;
  renderLenChips();
  fillGoalSelect();
  renderRitual();
  if (!picked) $('#sWhat').focus();
};
// The active experiment's start ritual (first action, environment checklist, two-minute rule, blocker).
function renderRitual() {
  const e = activeExperiment(state);
  const box = $('#sRitual');
  box.hidden = !e;
  if (!e) return;
  const p = playById(e.playId);
  let html = `<b>🧪 ${esc(p.title)}</b>`;
  if (p.id === 'firstStep') html += '<input type="text" id="rFirst" maxlength="100" placeholder="First 2-minute action, e.g. open the doc and write the heading" style="margin-top:6px" />';
  if (p.id === 'environment') html += `<div class="ritual">${state.settings.envChecklist.map((x, i) => `<label><input type="checkbox" data-env="${i}" /> ${esc(x)}</label>`).join('')}</div>`;
  if (p.id === 'twoMinute') html += '<div style="margin-top:3px">Just commit to 2 minutes. You’ll get a “you started” nudge at 2:00; the rest is a bonus.</div>';
  if (p.id === 'blocker') html += `<div style="margin-top:3px">While this session runs: ${esc(state.settings.blockList.slice(0, 4).join(', '))}${state.settings.blockList.length > 4 ? '…' : ''} won’t load.</div>`;
  if (p.id === 'intention' || p.id === 'bestTime') html += `<div style="margin-top:3px">${esc(p.rule)}</div>`;
  box.innerHTML = html;
}

// ---------- what to focus on: type anything, or pick a task ----------
// picked = 't:<ticketId>' when a task is chosen; otherwise the typed text is an ad hoc session whose time
// counts toward the habit in "Time counts toward" (and, if ticked, becomes an unplanned task).
let picked = null;

function openTasks() {
  const wk = weekKeyOf(today);
  const rank = { doing: 0, todo: 1 };
  return ticketsInSprint(wk, state).filter((t) => t.status !== 'done')
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
}

function setPicked(v) {
  picked = v;
  const t = v && state.tickets[v.slice(2)];
  document.querySelectorAll('#sPicks [data-pick]').forEach((c) => c.classList.toggle('on', c.dataset.pick === v));
  if (t) $('#sWhat').value = ticketTitle(t, state);
  $('#sAdhoc').hidden = !!t;
}

function fillGoalSelect() {
  const wk = weekKeyOf(today);
  // chips: what's in progress and next up
  const chips = openTasks().slice(0, 6);
  $('#sPicks').innerHTML = chips.map((t) => {
    const d = dueInfo(t, today);
    return `<button type="button" class="pick" data-pick="t:${esc(t.id)}">${t.status === 'doing' ? '◐ ' : ''}${esc(ticketTitle(t, state))}${d && ['overdue', 'today'].includes(d.cls) ? ` <span class="due ${d.cls}">${esc(d.text)}</span>` : ''}</button>`;
  }).join('');
  $('#sPicks').querySelectorAll('[data-pick]').forEach((c) => (c.onclick = () => {
    if (picked === c.dataset.pick) { setPicked(null); $('#sWhat').value = ''; $('#sWhat').focus(); } else setPicked(c.dataset.pick);
  }));
  // the full list (backlog too)
  $('#sGoal').innerHTML = '<option value="">Choose a task…</option>' + targetOptions(wk, null, state, { openOnly: true, withBacklog: true });
  // habit for ad hoc time
  const habits = timedHabits(wk, state);
  const lastHabit = state.settings.lastAdhocHabit;
  $('#sHabit').innerHTML = habits.map((g) => `<option value="${esc(g.id)}">${g.icon || '⭐'} ${esc(g.name)}</option>`).join('') + '<option value="">No habit</option>';
  $('#sHabit').value = lastHabit !== undefined && (lastHabit === '' || habits.some((g) => g.id === lastHabit)) ? lastHabit : habits.some((g) => g.id === 'work') ? 'work' : (habits[0]?.id || '');
  $('#sAddTask').checked = false;
  $('#sWhat').value = '';
  // start from the last task if it's still open
  const last = state.settings.lastGoalId;
  setPicked(last?.startsWith('t:') && chips.some((t) => `t:${t.id}` === last) ? last : null);
}
$('#sGoal').onchange = () => {
  const v = $('#sGoal').value;
  if (v.startsWith('t:')) setPicked(v);
  else if (v.startsWith('h:')) { setPicked(null); $('#sHabit').value = v.slice(2); }
  else if (v === '') { setPicked(null); $('#sHabit').value = ''; }
  $('#sAll').open = false;
  $('#sGoal').value = '';
};
$('#sWhat').addEventListener('input', () => {
  const t = picked && state.tickets[picked.slice(2)];
  if (t && $('#sWhat').value.trim() !== ticketTitle(t, state)) setPicked(null); // typing something else = ad hoc
});
$('#sWhat').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sGo').click(); });

$('#sGo').onclick = async () => {
  lockScreenStart();
  const wk = weekKeyOf(today);
  const text = $('#sWhat').value.trim();
  let pick = picked;
  if (!pick) {
    const habit = $('#sHabit').value;
    if ($('#sAddTask').checked && text) {
      const t = await addTicket({ title: text, habitId: habit || null, sprint: wk, planned: false });
      state = await load();
      pick = `t:${t.id}`;
    } else pick = habit ? `h:${habit}` : '';
    state.settings.lastAdhocHabit = habit;
  }
  const target = resolveTarget(pick, wk, state);
  const tk = target.ticketId && state.tickets[target.ticketId];
  const task = text || (tk ? tk.title : target.goalName) || 'Focus session';
  const n = Number($('#sMin').value);
  const minutes = n >= 1 ? Math.round(n) : state.settings.sessionMinutes;
  const e = activeExperiment(state);
  const extras = e ? { experimentId: e.id } : {};
  if (e?.playId === 'firstStep') {
    const f = $('#rFirst').value.trim();
    if (!f) { $('#rFirst').focus(); $('#rFirst').placeholder = 'Name the first action first (2 minutes, physical)'; return; }
    extras.firstStep = f;
  }
  if (e?.playId === 'environment') {
    const boxes = [...document.querySelectorAll('[data-env]')];
    extras.envChecked = boxes.filter((b) => b.checked).length === boxes.length;
  }
  if (e?.playId === 'twoMinute') extras.twoMinute = true;
  const lastAdhocHabit = state.settings.lastAdhocHabit;
  state = await load();
  state.settings.lastGoalId = pick;
  if (lastAdhocHabit !== undefined) state.settings.lastAdhocHabit = lastAdhocHabit;
  await save({ settings: state.settings });
  state.activeSession = await startSession(task, minutes, target, extras);
  state = await load();
  $('#sWhat').value = '';
  $('#sAsk').hidden = true;
  $('#sStartBtn').hidden = false;
  $('#sDone').hidden = true;
  renderSession();
  showView('today');
  setFullscreen(true);
};
$('#sMin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sGo').click(); });
$('#sWork').onclick = async () => {
  state.activeSession = await startWork();
  state = await load();
  renderSession();
  renderHeader();
  const a = state.activeSession;
  if (a?.delays?.length === 1 && a.delays[0].min <= QUICK_START_MIN) {
    const quickToday = (state.sessions[today] || []).some((x) => timeToStart(x) <= QUICK_START_MIN);
    const streakNow = quickStartStreak(state, today) + (quickToday ? 0 : 1); // this session counts once it ends
    const secs = Math.round(a.delays[0].min * 60);
    $('#sSaved').textContent = `🗳️ Vote cast: started in ${secs < 60 ? `${secs} s` : `${Math.round(a.delays[0].min)} min`}. ⚡ ${streakNow}-day quick-start streak.`;
  }
  askWhy(state.activeSession);
};
$('#sPause').onclick = async () => {
  if (state.activeSession?.phase === 'work') pauseMusic();
  state.activeSession = state.activeSession?.phase === 'paused' ? await resumeWork() : await pauseWork();
  renderSession();
};
$('#sEnd').onclick = async () => {
  const rec = await endSession();
  nowPlayingOff();
  radioStop();
  state = await load();
  setFullscreen(false);
  showView('today');
  renderSession();
  setTimeout(() => $('#sessionCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  askWhy(rec);
  offerDone(rec);
  offerNext(rec);
  if (rec) {
    const pct = procrastPct(rec.procrastMin, rec.workMin);
    $('#sSaved').textContent = `Saved: ${hm(rec.procrastMin)} procrastinating · ${hm(rec.workMin)} working` +
      (pct == null ? '' : ` · ${pct}% procrastinating`);
  }
  // Keep untouched check-in fields in step with the timer.
  form?.applyTimer();
};

chrome.storage.onChanged.addListener(async () => {
  state = await load();
  renderHeader();
  renderBanner();
  renderSession();
  renderDue();
  form?.applyTimer();
  renderProgress();
  renderWeek();
  renderMe();
  renderPause();
  renderCourse();
  renderAthena();
  renderReply();
  if (view === 'trends') renderTrends();
  refreshDrawer();
  if (!state.activeSession) document.body.classList.remove('focusing');
  renderMini();
});

// ---------- focus card extras: my playlist, the lock-screen card ----------

const isWebApp = !!globalThis.ODYSSEY_WEB;
// lock screen ⏯ → the session: play = start / back to working, pause = pause
const npHandlers = {
  play: async () => {
    const a = state.activeSession;
    if (radioResume) { radioResume = false; radioPlay(); }
    if (a?.phase === 'paused') await resumeWork();
    if ((await load()).activeSession?.phase === 'procrast') await startWork();
    state = await load(); renderSession();
  },
  pause: async () => { if (radioState().playing) radioResume = true; pauseMusic(); if (state.activeSession?.phase === 'work') { await pauseWork(); state = await load(); renderSession(); } },
  previoustrack: () => stepStation(-1),
  nexttrack: () => stepStation(1),
};
let radioResume = false;
// call at the start of a tap that starts a session (audio needs the tap)
const lockScreenStart = () => { if (isWebApp && state.settings.lockScreen && nowPlayingSupported()) nowPlayingOn(npHandlers); };

// The focus playlist (YouTube or Spotify) as a player on the focus card, loaded paused (Me → Focus music).
// It's only there while a session runs: ending the session stops the music.
const onIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// on iPhone, Spotify links open the app (the web player only plays previews unless you're signed in)
const appLink = (m) => (m.service === 'spotify' && onIOS ? m.open.replace('https://open.spotify.com/', 'spotify:').replace(/\//g, ':') : m.open);
const plName = (p, m) => p.name || (m && !m.error ? `${m.label} ${m.kind}` : 'Playlist');
let hadSession = false;
const musicSource = () => state.settings.musicSource || (state.settings.playlistUrl ? 'playlist' : 'radio');
function renderPlayer() {
  const on = state.settings.playerOn !== false;
  const radio = musicSource() === 'radio';
  $('#sRadio').hidden = !(on && radio);
  if (on && radio) renderRadioCard();
  if (hadSession && !state.activeSession) radioStop(); // the session ended (here or on another device): no music
  hadSession = !!state.activeSession;
  const m0 = radio ? null : musicEmbed(state.settings.playlistUrl);
  const m = m0 && !m0.error ? m0 : null;
  const show = !!(on && m && state.activeSession);
  $('#sPlayer').hidden = !(on && m);
  $('#sPlayer').className = `fsPlayer ${m ? m.service : ''}`;
  document.body.classList.toggle('hasPlayer', !!(on && m));
  document.body.classList.toggle('hasRadio', !!(on && radio));
  $('#sAddMusic').hidden = !on || !!m || radio;
  const open = $('#sOpenMusic');
  open.hidden = !m;
  if (m) { open.href = appLink(m); open.textContent = `↗ ${m.label}`; }
  // more than one saved: a picker on the focus card
  const list = playlistsOf(state.settings);
  const pick = $('#sMusicPick');
  pick.hidden = radio || list.length < 2;
  const sel = $('#sMusicSel');
  sel.innerHTML = '';
  for (const p of list) sel.append(new Option(plName(p, musicEmbed(p.url)), p.url, false, p.url === state.settings.playlistUrl));
  const frame = $('#sPlayerFrame');
  if (show && frame.dataset.src !== m.src) { frame.dataset.src = m.src; frame.src = m.src; } // reload only when the link changes
  if (!show && frame.dataset.src) { frame.dataset.src = ''; frame.removeAttribute('src'); } // no session: no music
}
// Pause whatever the player is playing (YouTube and Spotify both take a message).
function pauseMusic() {
  radioPause();
  const w = $('#sPlayerFrame').contentWindow;
  if (!w || !$('#sPlayerFrame').dataset.src) return;
  try {
    w.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
    w.postMessage({ command: 'pause' }, '*');
  } catch { /* not loaded yet */ }
}
// ---------- focus radio: a compact player on the focus card ----------
function renderRadioCard() {
  const box = $('#sRadio');
  const st = radioState();
  const station = st.station && (st.playing || st.loading || st.error) ? st.station : stationById(state.settings, state.settings.radioStation);
  const live = st.playing || st.loading;
  box.innerHTML = `<span class="rIcon">${station.icon}</span><span class="rMain"><b>${esc(station.name)}</b><small>${st.error ? '⚠️ Not playing · try another' : st.loading ? 'Tuning in…' : st.playing ? `● Live · ${esc(station.by)}` : esc(station.vibe)}</small></span>
    <button type="button" class="rBtn" data-r="-1" title="Previous station">⏮</button><button type="button" class="rBtn rPlay ${live ? 'on' : ''}" data-r="0" title="${live ? 'Pause' : 'Play'}">${live ? '⏸' : '▶'}</button><button type="button" class="rBtn" data-r="1" title="Next station">⏭</button>`;
  box.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => {
    const d = Number(b.dataset.r);
    if (d) stepStation(d);
    else if (radioState().playing || radioState().loading) { radioPause(); }
    else startRadio(station);
  }));
}
async function startRadio(station) {
  if (!(await radioPlay(station))) return; // the error toast comes from onRadio
  setCarrier(radioAudio());
  bindHandlers(npHandlers);
  renderSession(); // puts the focus time on the lock screen straight away
}
async function stepStation(d) {
  const list = stationsOf(state.settings);
  const cur = radioState().station || stationById(state.settings, state.settings.radioStation);
  const next = list[(list.findIndex((x) => x.id === cur.id) + d + list.length) % list.length];
  const st = await load();
  st.settings.radioStation = next.id;
  await save({ settings: st.settings });
  state = await load();
  const r = radioState();
  if (r.playing || r.loading || r.error) await startRadio(next); else renderRadioCard();
}
let radioErr = false;
onRadio((r) => {
  if (r.error && !radioErr) toast(`${r.station?.name || 'That station'} isn’t playing right now. Try another.`, 'err');
  radioErr = r.error;
  renderRadioCard();
  if (view === 'me') renderMusic();
});

$('#sAddMusic').onclick = () => { setFullscreen(false); showView('me'); setTimeout(() => $('#meMusic').scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); };
$('#sMusicSel').onchange = async (e) => { await setMusic({ active: e.target.value }); };

// Saved playlists: add (becomes the one on the focus card), pick, rename, remove.
async function setMusic({ add, active, remove, rename } = {}) {
  const st = await load();
  let list = playlistsOf(st.settings);
  if (add && !list.some((p) => p.url === add.url)) list.push(add);
  if (add) st.settings.playlistUrl = add.url;
  if (active) st.settings.playlistUrl = active;
  if (rename) list = list.map((p) => (p.url === rename.url ? { ...p, name: rename.name } : p));
  if (remove) {
    list = list.filter((p) => p.url !== remove);
    if (st.settings.playlistUrl === remove) st.settings.playlistUrl = list[0]?.url || '';
  }
  st.settings.playlists = list;
  await save({ settings: st.settings });
  state = await load();
  renderPlayer();
  renderMusic();
}

// Me → Focus music: paste a link (one tap on iPhone), your saved playlists, and whether the focus card
// shows the player.
async function setSetting(patch) {
  const st = await load();
  Object.assign(st.settings, patch);
  await save({ settings: st.settings });
  state = await load();
  renderPlayer();
  renderMusic();
}
function renderMusic() {
  const box = $('#meMusic');
  box.innerHTML = '';
  const seg = document.createElement('div');
  seg.className = 'seg musicSeg';
  for (const [k, t] of [['radio', 'Focus radio'], ['playlist', 'Your playlist']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: musicSource() === k ? 'on' : '', textContent: t });
    b.onclick = () => setSetting({ musicSource: k });
    seg.append(b);
  }
  box.append(seg);
  if (musicSource() === 'radio') { renderRadioSettings(box); return; }
  const list = playlistsOf(state.settings);
  const msg = Object.assign(document.createElement('div'), { className: 'small muted musicMsg' });
  const tryLink = async (raw, how) => {
    const v = firstLink(raw);
    const m = musicEmbed(v);
    if (!m) { msg.className = 'small error musicMsg'; msg.textContent = how === 'paste' ? 'The clipboard is empty. Copy a playlist link first.' : ''; return; }
    if (m.error) { msg.className = 'small error musicMsg'; msg.textContent = m.error; return; }
    const name = (await musicTitle(m)) || '';
    await setMusic({ add: { url: v, name } });
    toast(`${name || `${m.label} ${m.kind}`} saved`);
  };

  if (list.length) {
    const ul = document.createElement('div');
    ul.className = 'musicList';
    for (const p of list) {
      const m = musicEmbed(p.url);
      if (!m || m.error) continue;
      const on = p.url === state.settings.playlistUrl;
      const row = document.createElement('div');
      row.className = `musicNow${on ? ' on' : ''}`;
      row.innerHTML = `<div class="mIc ${m.service}">${m.service === 'spotify' ? '●' : '▶'}</div><div class="nMain"><b></b><div class="small muted">${on ? '✓ On the focus card' : `${m.label} ${m.kind} · tap to use`}</div></div>`;
      row.querySelector('b').textContent = plName(p, m);
      row.onclick = (e) => { if (!e.target.closest('a') && !on) setMusic({ active: p.url }); };
      const ren = Object.assign(document.createElement('a'), { className: 'small', textContent: 'Rename' });
      ren.onclick = () => { const n = prompt('Name this playlist', plName(p, m)); if (n != null && n.trim()) setMusic({ rename: { url: p.url, name: n.trim() } }); };
      const rm = Object.assign(document.createElement('a'), { className: 'small danger', textContent: 'Remove' });
      rm.onclick = async () => { await setMusic({ remove: p.url }); toast('Removed'); };
      row.append(ren, rm);
      ul.append(row);
    }
    box.append(ul);
    // playlists saved before names were fetched: look the name up once
    for (const p of list) if (!p.name && !renderMusic.asked?.has(p.url)) {
      (renderMusic.asked ??= new Set()).add(p.url);
      musicTitle(musicEmbed(p.url)).then((name) => name && setMusic({ rename: { url: p.url, name } }));
    }
  }

  const paste = Object.assign(document.createElement('button'), { type: 'button', className: 'primary musicPaste', textContent: list.length ? '📋 Paste another playlist' : '📋 Paste playlist link' });
  const input = Object.assign(document.createElement('input'), { type: 'url', inputMode: 'url', placeholder: 'or paste / type it here', autocomplete: 'off', className: 'musicInput' });
  paste.onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      await tryLink(text, 'paste');
    } catch {
      input.focus();
      msg.className = 'small muted musicMsg';
      msg.textContent = 'Long-press the box below and choose Paste.';
    }
  };
  input.onchange = () => tryLink(input.value, 'type');
  input.onpaste = () => setTimeout(() => tryLink(input.value, 'type'), 0);

  const how = document.createElement('div');
  how.className = 'small muted musicHow';
  how.innerHTML = 'In the app, open a playlist → <b>Share</b> → <b>Copy link</b>, come back, tap Paste.';
  const apps = document.createElement('div');
  apps.className = 'musicApps';
  const APPS = onIOS
    ? [['YouTube', 'youtube://'], ['YT Music', 'youtubemusic://'], ['Spotify', 'spotify://']]
    : [['YouTube', 'https://www.youtube.com'], ['YT Music', 'https://music.youtube.com'], ['Spotify', 'https://open.spotify.com']];
  for (const [label, href] of APPS) apps.append(Object.assign(document.createElement('a'), { className: 'pill', href, target: '_blank', rel: 'noopener', textContent: `${label} ↗` }));

  const row = document.createElement('div');
  row.className = 'notifRow';
  row.innerHTML = '<div class="nIc">▶️</div><div class="nMain"><b>Player on the focus card</b><div class="small muted">Loads paused when a session starts, stops when it ends</div></div>';
  row.append(toggle({ checked: state.settings.playerOn !== false, label: 'Player on the focus card', onChange: async (v) => {
    const st = await load();
    st.settings.playerOn = v;
    await save({ settings: st.settings });
    state = await load();
    renderPlayer();
  } }));
  box.append(paste, how, apps, input, msg, row);
}

function playerToggleRow() {
  const row = document.createElement('div');
  row.className = 'notifRow';
  row.innerHTML = '<div class="nIc">▶️</div><div class="nMain"><b>Music on the focus card</b><div class="small muted">Ready when a session starts, stops when it ends</div></div>';
  row.append(toggle({ checked: state.settings.playerOn !== false, label: 'Music on the focus card', onChange: (v) => setSetting({ playerOn: v }) }));
  return row;
}

// Me → Focus music → Focus radio: pick the station the focus card starts on, try one, add your own stream.
function renderRadioSettings(box) {
  const chosen = stationById(state.settings, state.settings.radioStation).id;
  const st = radioState();
  const g = document.createElement('div');
  g.className = 'iosGroup radioList';
  const others = document.createElement('details');
  others.className = 'moreStations';
  others.open = !!renderRadioSettings.open;
  others.ontoggle = () => { renderRadioSettings.open = others.open; };
  others.innerHTML = '<summary>Other stations</summary>';
  const og = document.createElement('div');
  og.className = 'iosGroup radioList';
  others.append(og);
  for (const x of [...stationsOf(state.settings)].sort((a, b) => (b.id === chosen) - (a.id === chosen))) {
    const on = x.id === chosen;
    const playing = st.station?.id === x.id && (st.playing || st.loading);
    const row = document.createElement('div');
    row.className = `cell ${on ? 'on' : ''}`;
    row.innerHTML = `<span class="cMain"><b>${esc(x.name)}</b><small>${esc(x.vibe)}${on ? ' · plays on the focus card' : ''}</small></span>`;
    const play = Object.assign(document.createElement('button'), { type: 'button', className: `rBtn ${playing ? 'on' : ''}`, textContent: playing ? '⏸' : '▶', title: playing ? 'Pause' : 'Listen' });
    play.onclick = (e) => { e.stopPropagation(); if (playing) radioPause(); else startRadio(x); };
    row.append(play);
    if (x.custom) {
      const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost small', textContent: '✕', title: 'Remove' });
      rm.onclick = (e) => { e.stopPropagation(); if (st.station?.id === x.id) radioStop(); setSetting({ radioCustom: (state.settings.radioCustom || []).filter((c) => c.id !== x.id), ...(on ? { radioStation: STATIONS[0].id } : {}) }); };
      row.append(rm);
    }
    row.onclick = () => { if (!on) setSetting({ radioStation: x.id }); };
    (on ? g : og).append(row);
  }
  box.append(g, others);
  // your own stream
  const form = document.createElement('form');
  form.className = 'inviteRow addStream';
  const url = Object.assign(document.createElement('input'), { type: 'url', placeholder: 'Add a stream link (https://…mp3)', autocomplete: 'off', className: 'musicInput' });
  const add = Object.assign(document.createElement('button'), { type: 'submit', textContent: 'Add' });
  const msg = Object.assign(document.createElement('div'), { className: 'small muted musicMsg' });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = checkStream(url.value);
    if (err) { msg.className = 'small error musicMsg'; msg.textContent = err; return; }
    const u = new URL(url.value.trim());
    const name = prompt('Name this station', u.hostname.replace(/^www\./, '')) || u.hostname;
    const id = `c-${Date.now().toString(36)}`;
    await setSetting({ radioCustom: [...(state.settings.radioCustom || []), { id, name: name.trim(), url: u.href }], radioStation: id });
    toast('Station added');
  };
  form.append(url, add);
  others.append(form, msg);
  others.append(Object.assign(document.createElement('p'), { className: 'small muted credit', innerHTML: 'SomaFM and Radio Paradise are free and listener-supported: <a href="https://somafm.com/support/" target="_blank" rel="noopener">support SomaFM</a> · <a href="https://radioparadise.com/support" target="_blank" rel="noopener">Radio Paradise</a>. Raagam is All India Radio’s classical channel.' }));
  box.append(playerToggleRow());
}

function renderExtras() {
  renderPlayer();
  const can = isWebApp && nowPlayingSupported();
  $('#sLockRow').hidden = !can;
  if (can && !$('#sLockSw').childElementCount) {
    $('#sLockSw').append(toggle({ checked: !!state.settings.lockScreen, label: 'Show on lock screen', onChange: async (v) => {
      const st = await load();
      st.settings.lockScreen = v;
      await save({ settings: st.settings });
      state = await load();
      if (v && state.activeSession) { if (await nowPlayingOn(npHandlers)) toast('On the lock screen'); else toast('iPhone didn’t allow audio here', 'err'); renderSession(); }
      else nowPlayingOff();
    } }));
  }
}

// ---------- ad hoc timer (top of Today): a description, or just "Ad hoc", and go ----------
$('#qtForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!state.activeSession) lockScreenStart();
  if (state.activeSession) { setFullscreen(true); return; }
  const text = $('#qtWhat').value.trim() || 'Ad hoc';
  const ex = activeExperiment(state);
  if (ex?.playId === 'firstStep') { // this week's experiment asks for a first step: use the full start form
    startOn(null);
    $('#sWhat').value = text;
    setPicked(null);
    return;
  }
  const wk = weekKeyOf(today);
  const habits = timedHabits(wk, state);
  const last = state.settings.lastAdhocHabit;
  const habit = last !== undefined && (last === '' || habits.some((g) => g.id === last)) ? last : habits.some((g) => g.id === 'work') ? 'work' : '';
  const target = resolveTarget(habit ? `h:${habit}` : '', wk, state);
  const extras = ex ? { experimentId: ex.id, ...(ex.playId === 'twoMinute' ? { twoMinute: true } : {}) } : {};
  state.activeSession = await startSession(text, state.settings.sessionMinutes, target, extras);
  state = await load();
  $('#qtWhat').value = '';
  renderSession();
  showView('today');
  setFullscreen(true);
};

// ---------- views: Today · Focus · Tasks · Me ----------

let view = 'today';
function showView(v) {
  view = v;
  try { sessionStorage.setItem('view', v); } catch { /* fine */ }
  for (const x of ['today', 'week', 'trends', 'me']) $(`#view-${x}`).hidden = x !== v;
  document.querySelectorAll('#tabbar [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'trends') renderTrends();
  window.scrollTo(0, 0);
  renderMini();
}
document.querySelectorAll('#tabbar [data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
$('#miniRing').onclick = () => showView('week');

// ---------- the running session: full screen, or a mini bar above the tabs ----------

let minimized = false;
function setFullscreen(on) {
  minimized = !on;
  document.body.classList.toggle('focusing', !!state.activeSession && on);
  renderMini();
}
$('#sMinimize').onclick = () => setFullscreen(false);
$('#miniBar').onclick = () => setFullscreen(true);
// ⋯ in the ad hoc bar: the full start form (pick a task, length), right here on Today
$('#qtMore').onclick = () => {
  if (state.activeSession) { setFullscreen(true); return; }
  const text = $('#qtWhat').value.trim();
  if ($('#sAsk').hidden) $('#sStartBtn').click();
  if (text) { setPicked(null); $('#sWhat').value = text; }
  $('#qtWhat').value = '';
  $('#sessionCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
let miniTick = null;
function renderMini() {
  const a = state.activeSession;
  const show = !!a && !document.body.classList.contains('focusing');
  $('#miniBar').hidden = !show;
  document.body.classList.toggle('hasMini', show);
  clearInterval(miniTick);
  if (!show) return;
  const tk = a.ticketId && state.tickets[a.ticketId];
  $('#mbTask').textContent = tk ? ticketTitle(tk, state) : a.task;
  const upd = () => {
    const now = Date.now();
    const len = (a.minutes || state.settings.sessionMinutes) * 60000;
    const worked = workedMs(a, now);
    $('#mbDot').className = `mbDot ${a.phase}`;
    $('#mbClock').textContent = a.phase === 'procrast' ? clock(now - a.phaseStart) : worked >= len ? `+${clock(worked - len)}` : clock(len - worked);
  };
  upd();
  miniTick = setInterval(upd, 1000);
}

// ---------- Week: the week at a glance, its habits and tasks; the backlog in a sheet ----------

const tkOpen = { done: false };
$('#tkAdd').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('#tkTitle').value.trim();
  if (!title) return;
  $('#tkTitle').value = '';
  const wk = weekKeyOf(today);
  await quickAddTask(title, { sprint: wk });
};
$('#wkPlan').onclick = () => openPlan();
$('#wkReview').onclick = () => openReview();
$('#wkRewards').onclick = () => openRewards();
$('#wkKleos').onclick = () => openRewards();
$('#wkVoyage').onclick = () => openRewards();
$('#wkBacklog').onclick = () => openBacklog();
$('#tkAdd').onclick = () => $('#tkTitle').focus();
$('#qtForm').addEventListener('click', (e) => { if (!e.target.closest('button')) $('#qtWhat').focus(); });
// rows with a switch (settings): tap anywhere on the row to flip it
document.addEventListener('click', (e) => {
  const row = e.target.closest('.notifRow');
  if (!row || e.target.closest('input, button, a, select, label')) return;
  row.querySelector('.switch input')?.click();
});

function taskRow(t) {
  const row = document.createElement('div');
  row.className = `task tkRow ${t.status === 'done' ? 'isDone' : ''}`;
  const chk = checkBtn({ state: t.status === 'done' ? true : null, title: 'Done', onChange: (v) => tickTask(row, chk, t)(v) });
  const kids = kidsOf(t);
  const d = t.status !== 'done' && dueInfo(t, today);
  const lh = loggedH(t.id);
  const parent = t.parentId && state.tickets[t.parentId];
  const main = document.createElement('div');
  main.className = 'tMain';
  main.innerHTML = `<div class="tTitle">${parent ? `<span class="muted">${esc(parent.title)} › </span>` : ''}${esc(t.title)}</div>
    <div class="tMeta">${[d ? `<span class="due ${d.cls}">${esc(d.text)}</span>` : '', t.sizeH ? `${round1(lh)} of ${t.sizeH} h` : lh ? `${round1(lh)} h` : '',
      kids.length ? `${kids.filter((k) => k.status === 'done').length} of ${kids.length} steps` : '', t.status === 'doing' ? 'in progress' : ''].filter(Boolean).join(' · ')}</div>`;
  row.append(chk, main);
  if (t.status !== 'done') {
    const go = Object.assign(document.createElement('button'), { className: 'playBtn', title: 'Focus on this', innerHTML: '▶' });
    go.disabled = !!state.activeSession;
    go.onclick = () => startOn(`t:${t.id}`);
    row.append(go);
  }
  row.onclick = (e) => { if (!e.target.closest('button')) openTicket(t.id); };
  swipeToDelete(row, () => removeTask(t));
  return row;
}

const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function renderWeek() {
  const wk = weekKeyOf(today);
  const days = weekDays(wk);
  const f = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const left = days.filter((k) => k > today).length;
  $('#wkSub').textContent = `${f(days[0])} – ${f(days[6])} · ${left ? `${left} day${left > 1 ? 's' : ''} left` : 'last day'}`;
  const K = kleos(state, today);
  $('#wkKleos').innerHTML = `<b>${K.week >= 0 ? '+' : '−'}${Math.abs(K.week)}</b><span>${POINTS.name} this week</span>`;
  // the voyage: where the ship is, and how this week is going toward the next port
  const V = voyage(state, today);
  $('#wkVoyage').innerHTML = `<span class="vsShip">${galley(30)}</span><span class="vsMain"><b>${V.legsSailed % LEGS} of ${LEGS} legs · next: ${esc(V.next?.name || 'Ithaca')}</b>
    <span class="vsBar"><i style="width:${Math.round(V.progress * 100)}%"></i></span></span><span class="chev">›</span>`;
  $('#wkVoyage').title = V.progress >= 1 ? 'A fair wind: this week sails a leg' : 'Keep your focus habits 60% of the week to sail the next leg';

  // the 7 days, coloured by score
  $('#wkDays').innerHTML = days.map((k) => {
    const sc = k <= today ? dayScore(k, state)?.score ?? null : null;
    return `<div class="wkDay ${k === today ? 'today' : ''} ${k > today ? 'future' : ''}"><span>${DOW1[parseKey(k).getDay()]}</span><i class="fill-${band(sc)}">${sc ?? ''}</i></div>`;
  }).join('');

  // the numbers that matter this week
  const plan = planOf(today, state);
  const goals = plan?.goals || [];
  const sts = goals.map((g) => goalStatus(g, wk, state, today));
  const tasks = ticketsInSprint(wk, state).filter((t) => !t.parentId);
  const doneT = tasks.filter((t) => t.status === 'done').length;
  const sum = weekSummary(wk, state, today);
  const tm = timeOnDays(state, days.filter((k) => k <= today));
  const overdue = tasks.filter((t) => t.status !== 'done' && t.due && t.due < today).length;
  $('#wkKpis').innerHTML = [
    [sum.avg ?? '—', 'week score', ''],
    [`${sts.filter((x) => x === 'done' || x === 'on').length} of ${goals.length}`, 'habits on track', ''],
    [`${doneT} of ${tasks.length}`, overdue ? `tasks · ${overdue} late` : 'tasks done', overdue ? 'red' : ''],
  ].map(([v, l, c]) => `<div class="wkKpi"><b class="${c ? `band ${c}` : ''}">${v}</b><span>${l}</span></div>`).join('');

  // habits: where each one stands this week
  $('#wkHabSub').textContent = '';
  const hb = $('#wkHabits');
  hb.innerHTML = '';
  if (!goals.length) hb.innerHTML = '<div class="emptyLine">No habits planned. Tap ✎ Plan.</div>';
  goals.forEach((g, i) => {
    const st = sts[i];
    const m = g.metrics[0];
    const key = `${g.id}.${m.id}`;
    const v = (k) => state.days[k]?.values?.[key];
    const t = Number(m.target) || 0;
    let dots = '', line = '';
    if (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') {
      const done = days.filter((k) => v(k) === true).length;
      dots = days.map((k) => {
        const planned = m.days?.length ? plannedOn(m, k) : true;
        const x = v(k);
        return `<i class="hd ${x === true ? 'yes' : x === false ? 'no' : k < today && planned && m.days?.length ? 'miss' : ''} ${planned && m.days?.length ? 'plan' : ''} ${k === today ? 'now' : ''}"></i>`;
      }).join('');
      line = `${done}/${t} days${m.days?.length ? ` · ${daysText(m.days)}` : ''}`;
    } else if (m.kind === 'perWeekSum') {
      const w = days.reduce((a, k) => a + (Number(v(k)) || 0), 0);
      dots = `<span class="hBar"><i style="width:${Math.round(Math.min(1, t ? w / t : 0) * 100)}%"></i></span>`;
      line = `${round1(w)}/${t} ${m.unit === 'hours' ? 'h' : m.unit} this week`;
    } else {
      const ok = (x) => (m.kind === 'perDayMax' ? Number(x) <= t : Number(x) >= t);
      const logged = days.filter((k) => v(k) != null && v(k) !== '');
      dots = days.map((k) => `<i class="hd ${v(k) == null || v(k) === '' ? '' : ok(v(k)) ? 'yes' : 'bad'} ${k === today ? 'now' : ''}"></i>`).join('');
      line = `${logged.filter((k) => ok(v(k))).length}/${logged.length || 0} days ${m.kind === 'perDayMax' ? 'within limit' : 'on goal'}`;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'wkHabit';
    row.innerHTML = `<span class="whIcon">${g.icon || '⭐'}</span><span class="whMain"><b>${esc(g.name)}</b><small>${esc(line)}</small><span class="whDots">${dots}</span></span><span class="status st-${st}">${STATUS[st].label}</span>`;
    row.onclick = () => showView('today');
    hb.append(row);
  });

  // tasks
  const ids = new Set(ticketsInSprint(wk, state).map((t) => t.id));
  const tops = ticketsInSprint(wk, state).filter((t) => !t.parentId || !ids.has(t.parentId));
  const order = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt;
  const box = $('#tkList');
  box.innerHTML = '';
  const open = tops.filter((t) => t.status !== 'done');
  const done = tops.filter((t) => t.status === 'done');
  $('#tkSub').textContent = open.length ? `${round1(open.reduce((a, t) => a + (t.sizeH || 0), 0))} h left` : '';
  const group = (label, items) => {
    if (!items.length) return;
    box.append(Object.assign(document.createElement('div'), { className: 'subHead', textContent: `${label} · ${items.length}` }));
    for (const t of items.sort(order)) box.append(taskRow(t));
  };
  group('In progress', open.filter((t) => t.status === 'doing'));
  group('To do', open.filter((t) => t.status === 'todo'));
  if (!open.length) box.insertAdjacentHTML('beforeend', '<div class="emptyLine">✓ Nothing open this week. Add a task above, or pull one from the backlog.</div>');
  if (done.length) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'ghost small doneToggle';
    t.textContent = `${tkOpen.done ? '▾' : '▸'} Done · ${done.length}`;
    t.onclick = () => { tkOpen.done = !tkOpen.done; renderWeek(); };
    box.append(t);
    if (tkOpen.done) for (const x of done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))) box.append(taskRow(x));
  }
  const bl = backlogTickets(state).filter((t) => t.status !== 'done' && !t.parentId);
  $('#wkBacklog').innerHTML = `<span class="blMain"><b>Backlog</b><small>${bl.length ? `${bl.length} task${bl.length > 1 ? 's' : ''} for later` : 'Park future tasks here'}</small></span><span class="chev">›</span>`;
}

// The backlog: parked tasks; pull one into this week, or add more.
function openBacklog() {
  const body = document.createElement('div');
  body.className = 'backlogSheet';
  const draw = () => {
    body.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'quickAdd';
    form.innerHTML = '<span class="qaPlus">＋</span><input type="text" maxlength="80" placeholder="Add a future task…" />';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = form.querySelector('input').value.trim();
      if (!v) return;
      await quickAddTask(v, { sprint: null });
      state = await load(); draw();
    };
    body.append(form);
    const list = backlogTickets(state).filter((t) => t.status !== 'done' && !t.parentId);
    if (!list.length) body.insertAdjacentHTML('beforeend', '<div class="emptyLine">Nothing parked. Add future tasks above.</div>');
    for (const t of list) {
      const row = taskRow(t);
      row.querySelector('.playBtn')?.remove();
      const pull = Object.assign(document.createElement('button'), { type: 'button', className: 'pullBtn', textContent: '→ Week', title: 'Move to this week' });
      pull.onclick = async (e) => { e.stopPropagation(); await moveTicket(t.id, weekKeyOf(today)); state = await load(); toast('Moved to this week'); draw(); renderWeek(); };
      row.append(pull);
      body.append(row);
    }
  };
  draw();
  openDrawer('Backlog', body);
}

// ---------- Trends: the last 4 weeks, in the app ----------

const bandOf = (sc) => band(sc);
function renderTrends() {
  const box = $('#trInsights');
  box.innerHTML = '';
  // Athena's weekly read leads; the rule-based nudges are the fallback when she's switched off
  const read = weeklyRead(state, today);
  if (read) {
    const card = document.createElement('section');
    card.className = 'card';
    card.append(athenaRead(read, 'Athena · this week'));
    box.append(card);
  }
  const ins = read ? [] : insights(state, today);
  const todo = ins.filter((x) => x.tone !== 'good');
  const good = ins.filter((x) => x.tone === 'good');
  const cell = (x) => {
    const c = document.createElement('div');
    c.className = `insight ${x.tone}`;
    c.innerHTML = `<span class="inDot"></span><div class="inMain"><b>${esc(x.title)}</b><div class="small">${esc(x.body)}</div></div>`;
    if (x.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inGo';
      b.textContent = x.action.label;
      b.onclick = (e) => { e.stopPropagation(); insightGo(x.action); };
      c.append(b);
      c.classList.add('tappable');
      c.onclick = () => insightGo(x.action);
    }
    return c;
  };
  if (!read && !ins.length) box.innerHTML = '<section class="card"><div class="emptyLine">Log a few days and run some focus sessions; what matters shows up here.</div></section>';
  if (todo.length) {
    const card = document.createElement('section');
    card.className = 'card insights';
    card.innerHTML = '<h3>Worth your attention</h3>';
    todo.slice(0, 3).forEach((x) => card.append(cell(x)));
    if (todo.length > 3) {
      const more = document.createElement('details');
      more.className = 'moreIns';
      more.innerHTML = `<summary>${todo.length - 3} more</summary>`;
      todo.slice(3).forEach((x) => more.append(cell(x)));
      card.append(more);
    }
    box.append(card);
  }
  if (good.length) {
    const card = document.createElement('section');
    card.className = 'card insights good';
    card.innerHTML = `<h3>Going well</h3><ul class="wins">${good.map((x) => `<li>${esc(x.title)}</li>`).join('')}</ul>`;
    box.append(card);
  }
  const last7 = lastNDays(today, 7);
  const last28 = lastNDays(today, 28);
  const t7 = timeOnDays(state, last7);
  const st7 = sessionTotals(last7, state);
  const done7 = Object.values(state.tickets || {}).filter((t) => t.status === 'done' && t.doneAt && last7.includes(dateKey(new Date(t.doneAt)))).length;
  const a7 = rollingAvg(state, today, 7);
  const a28 = rollingAvg(state, today, 28);
  $('#trKpis').innerHTML = [
    [a7 ?? '—', '7-day score'], [streak(state, today), 'day streak'], [hm(t7.totalMin), 'focused · 7 days'],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  // 28 bars, coloured by band
  const scores = last28.map((k) => ({ k, sc: dayScore(k, state)?.score ?? null }));
  const logged = scores.filter((x) => x.sc != null);
  $('#trChartSub').textContent = logged.length ? `${logged.length} of 28 days logged` : 'No check-ins yet';
  $('#trChart').innerHTML = scores.map(({ k, sc }, i) => {
    const d = parseKey(k);
    const lbl = i % 7 === 0 || k === today ? `${d.getDate()}` : '';
    return `<div class="b28 ${k === today ? 'today' : ''}" title="${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${sc == null ? '' : ` · ${sc}`}"><i class="fill-${bandOf(sc)}" style="height:${sc == null ? 4 : Math.max(6, sc)}%"></i><span>${lbl}</span></div>`;
  }).join('');

  // habits: 7-day average, and the change from the 28-day one
  const plan = planOf(today, state);
  const g7 = goalAvgs(state, today, 7);
  const g28 = goalAvgs(state, today, 28);
  $('#trHabits').innerHTML = (plan?.goals || []).map((g) => {
    const k = goalTrendKey(g);
    const v7 = g7.get(k)?.avg ?? null;
    const v28 = g28.get(k)?.avg ?? null;
    const dlt = v7 != null && v28 != null ? v7 - v28 : null;
    return `<div class="trHab"><span class="thIcon">${g.icon || '⭐'}</span><span class="thName">${esc(g.name)}</span>
      <div class="thBar"><i class="fill-${band(v7)}" style="width:${v7 ?? 0}%"></i></div>
      <b class="thVal band ${band(v7)}">${v7 ?? '—'}</b>
      <span class="thDelta ${dlt == null || Math.abs(dlt) < 3 ? 'flat' : dlt > 0 ? 'up' : 'down'}">${dlt == null || Math.abs(dlt) < 3 ? '·' : dlt > 0 ? `▲${Math.round(dlt)}` : `▼${Math.round(-dlt)}`}</span></div>`;
  }).join('') || '<div class="emptyLine">No habits planned yet.</div>';

  // the last 4 weeks of focus
  const wk = weekKeyOf(today);
  const weeks = [0, 1, 2, 3].map((n) => dateKey(addDays(parseKey(wk), -7 * n)));
  const rows = weeks.map((w) => {
    const end = dateKey(addDays(parseKey(w), 6));
    const m = weekMetrics(w, state, end < today ? end : today);
    return { w, h: m.time.totalH, pp: m.focus.procrastPct, ms: m.starting.medianStartMin, done: m.delivery.done };
  });
  const maxH = Math.max(1, ...rows.map((r) => r.h || 0));
  $('#trWeeks').innerHTML = `<div class="trWeek head"><span>Week</span><span>Time</span><span title="% of session time procrastinating">Procr.</span><span title="Median time to start">Start</span><span title="Tasks done">Done</span></div>` + rows.map((r, i) => `
    <div class="trWeek"><span>${i === 0 ? 'This week' : parseKey(r.w).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      <span class="twTime"><i style="width:${Math.round(((r.h || 0) / maxH) * 100)}%"></i><b>${r.h ?? 0} h</b></span>
      <span>${r.pp == null ? '—' : `${r.pp}%`}</span><span>${r.ms == null ? '—' : `${r.ms} min`}</span><span>${r.done}</span></div>`).join('');

  // reasons
  const rs = reasonStats(last28, state).filter((x) => x.min > 0).slice(0, 6);
  const tot = rs.reduce((a, x) => a + x.min, 0);
  $('#trReasons').innerHTML = rs.length ? rs.map((x) => {
    const r = x.id === 'unrecorded' ? { icon: '❔', label: 'No reason given' } : reasonById(x.id) || { icon: '', label: x.id };
    return `<div class="trReason"><span class="trrName">${r.icon} ${esc(r.label)}</span><div class="thBar"><i style="width:${Math.round((100 * x.min) / tot)}%"></i></div><b>${Math.round(x.min)} min</b></div>`;
  }).join('') : '<div class="emptyLine">No procrastination logged in 4 weeks. 👏</div>';
}

function insightGo(a) {
  if (a.go === 'today') showView('today');
  else if (a.go === 'week') showView('week');
  else if (a.go === 'review') openReview();
  else if (a.go === 'rewards') openRewards();
  else if (a.go === 'plan') openPlan();
  else if (a.go === 'focus') startOn(a.arg ? `t:${a.arg}` : null);
}

// ---------- Me ----------

function renderMe() {
  const K = kleos(state, today);
  const r = K.rank;
  $('#meRank').innerHTML = `<span class="mrBadge">${POINTS.icon}</span><span class="mrMain"><small>Rank ${r.level} · ${esc(r.name)}</small><b>${K.total.toLocaleString('en-IN')} ${POINTS.name}</b>
    <span class="rkBar"><i style="width:${Math.round(Math.min(1, r.frac) * 100)}%"></i></span><small>${r.next ? `${(r.next.at - K.total).toLocaleString('en-IN')} to ${esc(r.next.name)}` : 'Top rank'}</small></span>
    <span class="chev">›</span>`;
  currentUser().then((u) => { $('#meSub').textContent = u ? `Signed in as ${u.username}` : 'Not signed in'; }).catch(() => {});
}
$('#meRank').onclick = () => openRewards();

// Me → Your course: your Ithaca and focus habits; edit the answers any time.
function renderCourse() {
  const box = $('#meCourse');
  const p = state.profile;
  box.innerHTML = '';
  if (!p?.onboardedAt) {
    box.innerHTML = '<h3>Your course</h3><p class="small muted pauseText">Pick up to three habits and Odyssey sets an easy first week, then adapts to what works for you.</p>';
  } else {
    const plan = planOf(today, state);
    const names = (p.habits || []).map((h) => plan?.goals.find((g) => g.id === h.goalId)?.name || habitType(h.type).label);
    box.innerHTML = `<h3>Your course</h3>${p.identity ? `<p class="courseIthaca">${esc(p.identity)}</p>` : ''}<p class="small muted pauseText">Focus: ${esc(names.join(', ') || 'none yet')}</p>`;
  }
  const b = Object.assign(document.createElement('button'), { type: 'button', className: p?.onboardedAt ? '' : 'primary', textContent: p?.onboardedAt ? 'Edit your answers' : 'Set your course' });
  b.onclick = startOnboarding;
  b.style.width = '100%';
  box.append(b);
  if (!p?.onboardedAt) return;
  const row = document.createElement('div');
  row.className = 'notifRow athenaToggle';
  row.innerHTML = '<div class="nMain"><b>Athena’s notes</b><div class="small muted">A line each morning, the weekly read, suggestions in Plan. Written from your own data.</div></div>';
  row.append(toggle({ checked: state.settings.athenaOn !== false, label: 'Athena’s notes', onChange: async (v) => {
    const st = await load();
    st.settings.athenaOn = v;
    await save({ settings: st.settings });
    state = await load();
    render();
  } }));
  box.append(row);
}

// ---------- pause (sick, travelling): no penalties, streaks kept ----------
const pauseUntilText = (p) => (p.endDay ? `until ${parseKey(p.endDay).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'until you resume');
function renderPause() {
  const p = pauseOn(state, today);
  const box = $('#mePause');
  box.innerHTML = '';
  const banner = $('#pausedBanner');
  banner.hidden = !p;
  if (p) {
    banner.innerHTML = `<div class="pbMain"><b>Paused ${esc(pauseUntilText(p))}</b><small>No penalties and your streak is kept. Log anything you like.</small></div>`;
    const go = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Resume' });
    go.onclick = resumeNow;
    banner.append(go);
    box.innerHTML = `<h3>Pause</h3><p class="small muted pauseText">Paused ${esc(pauseUntilText(p))}. Reminders are off and nothing counts against you.</p>`;
    const r = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Resume now' });
    r.onclick = resumeNow;
    box.append(r);
    return;
  }
  box.innerHTML = '<h3>Pause</h3><p class="small muted pauseText">Sick or travelling? Pause: reminders stop, nothing counts against you, and your streak waits.</p>';
  const row = document.createElement('div');
  row.className = 'pauseBtns';
  const until = (days) => { if (days == null) return null; const d = new Date(); d.setDate(d.getDate() + days - 1); return dateKey(d); };
  for (const [label, days] of [['3 days', 3], ['1 week', 7], ['Until I resume', null]]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.onclick = async () => { await startPause(until(days)); state = await load(); renderPause(); render(); toast('Paused. Take care.'); };
    row.append(b);
  }
  box.append(row);
}
async function resumeNow() { await endPause(); state = await load(); renderPause(); render(); toast('Welcome back'); }
$('#appVersion').textContent = `Odyssey ${VERSION}`;

// ---------- nav ----------

function openDash(tab) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#${tab}`) });
}
document.querySelectorAll('[data-open]').forEach((a) => (a.onclick = () => openDash(a.dataset.open)));

init();
