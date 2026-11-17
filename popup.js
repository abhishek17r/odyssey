import {
  BAND_LABEL, dateKey, weekDays, addDays, weekKeyOf, planOf, dayScore, band, rollingAvg, streak, weekSummary,
  weekSoFar, dayIndexInWeek, metricKey, targetText, round1, goalTags, sessionTotals, workedMs, phaseMs, procrastPct,
  DELAY_REASONS, ticketTitle, ticketsInSprint, dueInfo, timeOnDay, backlogTickets, TICKET_STATUS,
} from './lib/score.js';
import { ledger, money } from './lib/rewards.js';
import { esc, tagChips } from './lib/ui.js';
import { buildCheckin, bindReflection } from './lib/checkin.js';
import { saveReadiness, addIntention } from './lib/storage.js';
import { stepper, scale, checkBtn, toast } from './lib/controls.js';
import { gcalUrl, openUrl } from './lib/gcal.js';
import { setTicketContext, openTicket, refreshDrawer, kidsOf, loggedH } from './lib/tickets.js';
import { renderAccount } from './lib/account.js';
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
  showView(state.activeSession ? 'focus' : (sessionStorage.getItem('view') || 'today'));
  renderAccount($('#meAccount'));
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
  renderTasks();
  renderMe();
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
  $('#avg7').textContent = rollingAvg(state, today, 7) ?? '—';
  $('#streak').textContent = streak(state, today);
  const s = weekSummary(weekKeyOf(today), state, today);
  $('#weekAvg').textContent = s.avg ?? '—';
  $('#procWeek').textContent = s.procrastTotal;
  $('#votesWeek').textContent = votes(state, weekDays(weekKeyOf(today)).filter((k) => k <= today)).total;
  $('#quickStreak').textContent = quickStartStreak(state, today);
  const L = ledger(state, today);
  $('#rwBal').textContent = money(L.balance);
  $('#rwSub').textContent = L.atStake ? `💰 ${money(L.atStake)} in play` : '💰 rewards';
}

function renderBanner() {
  const el = $('#planBanner');
  el.hidden = !(isFriday && !state.weeks[weekKeyOf(dateKey(addDays(new Date(), 1)))]);
  el.textContent = '🗓️ It’s Friday. Review the sprint, then plan next week →';
  el.onclick = () => openDash('retro');
}

$('#planNow').onclick = () => openDash('plan');

// ---------- form ----------

let form = null;

function renderForm() {
  $('#note').value = state.days[today]?.note ?? '';
  form = buildCheckin({ box: $('#goalQs'), dayKey: today, getState: () => state, onSaved: () => { renderHeader(); renderProgress(); }, compact: true });
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

function renderDue() {
  const box = $('#dueBox');
  const list = dueToday();
  const soon = ticketsInSprint(weekKeyOf(today), state).filter((x) => x.status !== 'done' && x.due > today).sort((a, b) => a.due.localeCompare(b.due))[0];
  box.innerHTML = '';
  box.append(Object.assign(document.createElement('div'), { className: 'subHead', textContent: list.length ? 'Due today' : 'Tasks' }));
  if (!list.length) {
    box.insertAdjacentHTML('beforeend', `<div class="emptyLine">✓ Nothing due today${soon ? ` · next: <b>${esc(ticketTitle(soon, state))}</b> ${esc(dueInfo(soon, today).text)}` : ''}</div>`);
    return;
  }
  for (const t of list) {
    const d = dueInfo(t, today);
    const row = document.createElement('div');
    row.className = 'task';
    const chk = checkBtn({ state: null, title: 'Mark done', onChange: async () => { await updateTicket(t.id, { status: 'done' }); toast('Ticket done 🎉'); } });
    const main = document.createElement('div');
    main.className = 'tMain';
    main.innerHTML = `<div class="tTitle">${esc(ticketTitle(t, state))}</div><div class="tMeta"><span class="due ${d.cls}">${esc(d.text)}</span>${t.sizeH ? ` · ${t.sizeH} h` : ''}${t.status === 'doing' ? ' · in progress' : ''}</div>`;
    const go = Object.assign(document.createElement('button'), { className: 'playBtn', title: 'Start a focus session on this', innerHTML: '▶' });
    go.disabled = !!state.activeSession;
    go.onclick = () => startOn(`t:${t.id}`);
    const cal = Object.assign(document.createElement('button'), { className: 'ghost calMini', title: 'Block time for this in Google Calendar', textContent: '📅' });
    cal.onclick = () => openUrl(gcalUrl({ title: `🎯 ${ticketTitle(t, state)}`, details: `Focus block from Odyssey · due ${t.due}`, start: (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })(), minutes: Math.round((t.sizeH || 1) * 60) }));
    row.append(chk, main, cal, go);
    box.append(row);
  }
}

// Open the timer's start panel with this target picked.
function startOn(value) {
  showView('focus');
  if ($('#sAsk').hidden) $('#sStartBtn').click();
  const sel = $('#sGoal');
  if ([...sel.options].some((o) => o.value === value)) { sel.value = value; sel.dispatchEvent(new Event('change')); }
}

// ---------- reflection ----------

const reflection = bindReflection({
  textarea: $('#reflection'),
  msgEl: $('#reflectMsg'),
  getDayKey: () => today,
  getState: () => state,
});
const renderReflection = () => reflection.refresh();

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
  $('#sGoal').focus();
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

const NEW_TICKET = '__new';

// This sprint's open tickets, habit time without a ticket, then "new ticket". The last pick is preselected.
function fillGoalSelect() {
  const wk = weekKeyOf(today);
  const sel = $('#sGoal');
  const last = state.settings.lastGoalId;
  sel.innerHTML = targetOptions(wk, null, state, { openOnly: true, withBacklog: true }) + `<option value="${NEW_TICKET}">＋ New ticket…</option>`;
  const values = [...sel.options].map((o) => o.value);
  sel.value = values.includes(last) ? last : values.includes('h:work') ? 'h:work' : values[0];
  $('#sNewHabit').innerHTML = '<option value="">Counts toward no habit</option>' +
    timedHabits(wk, state).map((g) => `<option value="${esc(g.id)}">Counts toward ${g.icon || '⭐'} ${esc(g.name)}</option>`).join('');
  $('#sNewHabit').value = timedHabits(wk, state).some((g) => g.id === 'work') ? 'work' : '';
  showNewGoal();
}
const showNewGoal = () => {
  $('#sNew').hidden = $('#sGoal').value !== NEW_TICKET;
  if (!$('#sNew').hidden) $('#sNewName').focus();
};
$('#sGoal').onchange = showNewGoal;

$('#sGo').onclick = async () => {
  let pick = $('#sGoal').value;
  const wk = weekKeyOf(today);
  if (pick === NEW_TICKET) {
    const title = $('#sNewName').value.trim();
    if (!title) { $('#sNewName').focus(); $('#sNewName').placeholder = 'Name the ticket first'; return; }
    const size = Number($('#sNewSize').value);
    const t = await addTicket({ title, sizeH: size > 0 ? size : null, habitId: $('#sNewHabit').value || null, sprint: wk, planned: false });
    state = await load();
    pick = `t:${t.id}`;
  }
  const target = resolveTarget(pick, wk, state);
  const tk = target.ticketId && state.tickets[target.ticketId];
  const task = $('#sTask').value.trim() || (tk ? tk.title : target.goalName) || 'Focus session';
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
  state = await load();
  state.settings.lastGoalId = pick;
  await save({ settings: state.settings });
  state.activeSession = await startSession(task, minutes, target, extras);
  state = await load();
  $('#sTask').value = '';
  $('#sNewName').value = '';
  $('#sNewSize').value = '';
  $('#sAsk').hidden = true;
  $('#sStartBtn').hidden = false;
  $('#sDone').hidden = true;
  renderSession();
  showView('focus');
  setFullscreen(true);
};
$('#sTask').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sGo').click(); });
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
  state.activeSession = state.activeSession?.phase === 'paused' ? await resumeWork() : await pauseWork();
  renderSession();
};
$('#sEnd').onclick = async () => {
  const rec = await endSession();
  state = await load();
  setFullscreen(false);
  renderSession();
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
  renderTasks();
  refreshDrawer();
  if (!state.activeSession) document.body.classList.remove('focusing');
  renderMini();
});

// ---------- views: Today · Focus · Tasks · Me ----------

let view = 'today';
function showView(v) {
  view = v;
  try { sessionStorage.setItem('view', v); } catch { /* fine */ }
  for (const x of ['today', 'focus', 'tasks', 'me']) $(`#view-${x}`).hidden = x !== v;
  document.querySelectorAll('#tabbar [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  // idle on Focus: go straight to the start form (unless the last session's questions are showing)
  if (v === 'focus' && !state.activeSession && $('#sAsk').hidden && $('#sWhy').hidden && $('#sNext').hidden && $('#sDone').hidden) $('#sStartBtn').click();
  if (v === 'focus' && state.activeSession) setFullscreen(true);
  window.scrollTo(0, 0);
  renderMini();
}
document.querySelectorAll('#tabbar [data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
$('#miniRing').onclick = () => showView('me');

// ---------- the running session: full screen, or a mini bar above the tabs ----------

let minimized = false;
function setFullscreen(on) {
  minimized = !on;
  document.body.classList.toggle('focusing', !!state.activeSession && on);
  renderMini();
}
$('#sMinimize').onclick = () => setFullscreen(false);
$('#miniBar').onclick = () => { showView('focus'); setFullscreen(true); };
let miniTick = null;
function renderMini() {
  const a = state.activeSession;
  const show = !!a && (minimized || view !== 'focus') && !document.body.classList.contains('focusing');
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

// ---------- Tasks: this week's sprint or the backlog; tap one for its sheet ----------

let tkScope = 'sprint';
const tkOpen = { done: false };
document.querySelectorAll('#tkScope [data-scope]').forEach((b) => (b.onclick = () => {
  tkScope = b.dataset.scope;
  document.querySelectorAll('#tkScope [data-scope]').forEach((x) => x.classList.toggle('on', x === b));
  $('#tkTitle').placeholder = tkScope === 'sprint' ? 'Add a task…' : 'Add a future task…';
  renderTasks();
}));
$('#tkAdd').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('#tkTitle').value.trim();
  if (!title) return;
  $('#tkTitle').value = '';
  const wk = weekKeyOf(today);
  await addTicket({ title, sprint: tkScope === 'sprint' ? wk : null, habitId: tkScope === 'sprint' && timedHabits(wk, state).some((g) => g.id === 'work') ? 'work' : null, planned: true });
  toast(tkScope === 'sprint' ? 'Task added' : 'Added to the backlog');
};

function taskRow(t) {
  const row = document.createElement('div');
  row.className = `task tkRow ${t.status === 'done' ? 'isDone' : ''}`;
  const chk = checkBtn({ state: t.status === 'done' ? true : null, title: 'Done', onChange: async (v) => { await updateTicket(t.id, { status: v ? 'done' : 'todo' }); if (v) toast('Done 🎉'); } });
  const kids = kidsOf(t);
  const d = t.status !== 'done' && dueInfo(t, today);
  const lh = loggedH(t.id);
  const parent = t.parentId && state.tickets[t.parentId];
  const main = document.createElement('div');
  main.className = 'tMain';
  main.innerHTML = `<div class="tTitle">${parent ? `<span class="muted">${esc(parent.title)} › </span>` : ''}${esc(t.title)}</div>
    <div class="tMeta">${[d ? `<span class="due ${d.cls}">${esc(d.text)}</span>` : '', t.sizeH ? `⏱ ${round1(lh)}/${t.sizeH} h` : lh ? `⏱ ${round1(lh)} h` : '',
      kids.length ? `☑ ${kids.filter((k) => k.status === 'done').length}/${kids.length}` : '', t.status === 'doing' ? '<span class="pill">in progress</span>' : ''].filter(Boolean).join(' · ')}</div>`;
  row.append(chk, main);
  if (t.status !== 'done') {
    const go = Object.assign(document.createElement('button'), { className: 'playBtn', title: 'Focus on this', innerHTML: '▶' });
    go.disabled = !!state.activeSession;
    go.onclick = () => startOn(`t:${t.id}`);
    row.append(go);
  }
  row.onclick = (e) => { if (!e.target.closest('button')) openTicket(t.id); };
  return row;
}

function renderTasks() {
  const wk = weekKeyOf(today);
  const list = tkScope === 'sprint' ? ticketsInSprint(wk, state) : backlogTickets(state);
  const ids = new Set(list.map((t) => t.id));
  const tops = list.filter((t) => !t.parentId || !ids.has(t.parentId)); // subtasks live in their parent's sheet
  const order = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt;
  const box = $('#tkList');
  box.innerHTML = '';
  const open = tops.filter((t) => t.status !== 'done');
  const done = tops.filter((t) => t.status === 'done');
  $('#tkSub').textContent = tkScope === 'sprint'
    ? `${done.length}/${tops.length} done this week · ${round1(open.reduce((a, t) => a + (t.sizeH || 0), 0))} h left`
    : `${open.length} parked for later`;
  const group = (label, items) => {
    if (!items.length) return;
    box.append(Object.assign(document.createElement('div'), { className: 'subHead', textContent: `${label} · ${items.length}` }));
    for (const t of items.sort(order)) box.append(taskRow(t));
  };
  if (tkScope === 'sprint') {
    group('In progress', open.filter((t) => t.status === 'doing'));
    group('To do', open.filter((t) => t.status === 'todo'));
  } else group('Later', open);
  if (!open.length) box.insertAdjacentHTML('beforeend', `<div class="emptyLine">${tkScope === 'sprint' ? '✓ Nothing open this week. Add a task above, or pull one from the backlog.' : 'Nothing parked. Add future tasks above.'}</div>`);
  if (done.length) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'ghost small doneToggle';
    t.textContent = `${tkOpen.done ? '▾' : '▸'} Done · ${done.length}`;
    t.onclick = () => { tkOpen.done = !tkOpen.done; renderTasks(); };
    box.append(t);
    if (tkOpen.done) for (const x of done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))) box.append(taskRow(x));
  }
}

// ---------- Me ----------

function renderMe() {
  const wk = weekKeyOf(today);
  $('#meSub').textContent = `${new Date(wk + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(dateKey(addDays(new Date(wk + 'T12:00'), 6)) + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

// ---------- nav ----------

function openDash(tab) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#${tab}`) });
}
document.querySelectorAll('[data-open]').forEach((a) => (a.onclick = () => openDash(a.dataset.open)));

init();
