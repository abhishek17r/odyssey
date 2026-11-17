import {
  BAND_LABEL, dateKey, weekDays, addDays, weekKeyOf, planOf, dayScore, band, rollingAvg, streak, weekSummary,
  weekSoFar, dayIndexInWeek, metricKey, targetText, round1, goalTags, sessionTotals, workedMs, phaseMs, procrastPct,
  DELAY_REASONS, ticketTitle, ticketsInSprint, dueInfo, timeOnDay, backlogTickets, TICKET_STATUS,
  goalAvgs, goalTrendKey, lastNDays, reasonStats, reasonById, timeOnDays, parseKey,
} from './lib/score.js';
import { weekMetrics } from './lib/metrics.js';
import { ledger, money } from './lib/rewards.js';
import { esc, tagChips } from './lib/ui.js';
import { buildCheckin, bindReflection } from './lib/checkin.js';
import { saveReadiness, addIntention } from './lib/storage.js';
import { stepper, scale, checkBtn, toast, celebrate } from './lib/controls.js';
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
  const v0 = sessionStorage.getItem('view');
  showView(['today', 'tasks', 'trends', 'me'].includes(v0) ? v0 : 'today');
  if (state.activeSession) setFullscreen(true);
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
  main.innerHTML = `<div class="tTitle">${esc(ticketTitle(t, state))}</div><div class="tMeta">${done ? '<span class="pill okPill">✓ done today</span>' : `<span class="due ${d.cls}">${esc(d.text)}</span>`}${t.sizeH ? `<span>⏱ ${t.sizeH} h</span>` : ''}${!done && t.status === 'doing' ? '<span>in progress</span>' : ''}</div>`;
  row.append(chk, main);
  if (!done) {
    const cal = Object.assign(document.createElement('button'), { className: 'ghost iconBtn', title: 'Block time for this in Google Calendar', textContent: '📅' });
    cal.onclick = () => openUrl(gcalUrl({ title: `🎯 ${ticketTitle(t, state)}`, details: `Focus block from Odyssey · due ${t.due}`, start: (() => { const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); return x; })(), minutes: Math.round((t.sizeH || 1) * 60) }));
    const go = Object.assign(document.createElement('button'), { className: 'playBtn', title: 'Start a focus session on this', innerHTML: '▶' });
    go.disabled = !!state.activeSession;
    go.onclick = () => startOn(`t:${t.id}`);
    row.append(cal, go);
  }
  return row;
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
  $('#qtForm').hidden = !!a;
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
  state.activeSession = state.activeSession?.phase === 'paused' ? await resumeWork() : await pauseWork();
  renderSession();
};
$('#sEnd').onclick = async () => {
  const rec = await endSession();
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
  renderTasks();
  if (view === 'trends') renderTrends();
  refreshDrawer();
  if (!state.activeSession) document.body.classList.remove('focusing');
  renderMini();
});

// ---------- ad hoc timer (top of Today): a description, or just "Ad hoc", and go ----------
$('#qtForm').onsubmit = async (e) => {
  e.preventDefault();
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
  for (const x of ['today', 'tasks', 'trends', 'me']) $(`#view-${x}`).hidden = x !== v;
  document.querySelectorAll('#tabbar [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'trends') renderTrends();
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

// ---------- Tasks: this week's sprint or the backlog; tap one for its sheet ----------

let tkScope = 'sprint';
const tkOpen = { done: true }; // finished tasks stay visible, below
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
  const chk = checkBtn({ state: t.status === 'done' ? true : null, title: 'Done', onChange: (v) => tickTask(row, chk, t)(v) });
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

// ---------- Trends: the last 4 weeks, in the app ----------

const bandOf = (sc) => band(sc);
function renderTrends() {
  const last7 = lastNDays(today, 7);
  const last28 = lastNDays(today, 28);
  const t7 = timeOnDays(state, last7);
  const st7 = sessionTotals(last7, state);
  const done7 = Object.values(state.tickets || {}).filter((t) => t.status === 'done' && t.doneAt && last7.includes(dateKey(new Date(t.doneAt)))).length;
  const a7 = rollingAvg(state, today, 7);
  const a28 = rollingAvg(state, today, 28);
  $('#trKpis').innerHTML = [
    [a7 ?? '—', '7-day score'], [a28 ?? '—', '28-day score'], [streak(state, today), '🔥 day streak'],
    [hm(t7.totalMin), '⏱ time · 7 d'], [st7.avgStartMin == null ? '—' : hm(st7.avgStartMin), '⏳ to start'], [done7, '✅ tasks · 7 d'],
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
