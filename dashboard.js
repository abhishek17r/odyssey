import {
  PRESETS, ADHOC_METRICS, DEFAULT_SETTINGS, dateKey, parseKey, addDays, weekKeyOf, weekDays,
  defaultPlan, dayScore, goalScore, metricScore, metricWeek, goalWeekAvg, weekSummary, reasonsIn,
  band, rollingAvg, goalAvgs, streak, lastNDays, unitText, metricKey, round1,
  goalTags, goalStatus, STATUS, tagAvgs, TAG_PALETTE, sessionsIn, sessionTotals, procrastPct, sessionGoalId,
  DELAY_REASONS, reasonById, reasonStats, sprintTickets, timedMetric,
  TICKET_STATUS, ticketList, ticketsInSprint, ticketTitle, backlogTickets, dueInfo, ticketTime, timeOnDay, timeOnDays,
} from './lib/score.js';
import {
  load, save, updateSession, updateSessions, deleteSession, addTicket, updateTicket, deleteTicket,
  listBackups, backupData, restoreBackup, snapshot, startExperiment, endExperiment, moveTicket, buyItem, undoPurchase,
  withoutDeviceKeys, replaceAll,
} from './lib/storage.js';
import { renderAccount } from './lib/account.js';
import { REWARDS, ledger, ruleFor, money, REWARD_STATUS } from './lib/rewards.js';
import { gcalUrl, nextSlot, openUrl } from './lib/gcal.js';
import { setTicketContext, ticketCard, openTicket, refreshDrawer, loggedH, isAuto, kidsOf, COLS } from './lib/tickets.js';
import { esc, tagChip, tagChips, statusPill } from './lib/ui.js';
import { buildCheckin, bindReflection } from './lib/checkin.js';
import { el, stepper, checkBtn, openDrawer, drawerOpen, toast, stepFor } from './lib/controls.js';
import { weekMetrics, HEADLINES, pick, prevWeek, QUICK_START_MIN } from './lib/metrics.js';
import {
  PLAYBOOK, LAWS, playById, activeExperiment, experimentReport, recommendations, behaviourImpact, readinessScore, votes,
} from './lib/coach.js';
import { timedHabits as timedHabitsFor, targetOptions as targetOptionsFor, resolveTarget as resolveTargetFor } from './lib/targets.js';

const $ = (s) => document.querySelector(s);
const TABS = ['today', 'board', 'backlog', 'retro', 'rewards', 'trends', 'settings']; // #plan opens the board on the week to plan
const today = dateKey();
const fmt = (k) => parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dow = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'short' });
const weekLabel = (wk) => `${fmt(wk)} – ${fmt(dateKey(addDays(parseKey(wk), 6)))}`;
const curWeek = weekKeyOf(today);
const nextWeek = dateKey(addDays(parseKey(curWeek), 7));
const prevWeekOf = (wk) => dateKey(addDays(parseKey(wk), -7));

const KIND_LABEL = {
  daysPerWeek: 'Days per week',
  perDayMax: 'At most per day',
  perDayMin: 'At least per day',
  perWeekSum: 'Per week',
};
const ADHOC_LABEL = {
  times_w: 'Times per week',
  min_w: 'Minutes per week',
  hours_w: 'Hours per week',
  days_w: 'Days per week',
  hours_d: 'Hours per day (at least)',
  done: 'Task: done (yes / no)',
};
const metricName = (m) => m.label || (m.kind === 'oncePerWeek' ? 'Task' : null) || `${m.unit[0].toUpperCase()}${m.unit.slice(1)} / ${m.kind.startsWith('perDay') ? 'day' : 'week'}`;

let state;

async function init() {
  state = await load();
  setTicketContext({ getState: () => state });
  window.addEventListener('hashchange', showTab);
  chrome.storage.onChanged.addListener(async () => {
    state = await load();
    const t = currentTab();
    if (['trends', 'retro', 'backlog', 'rewards'].includes(t)) showTab();
    if (t === 'today') refreshDay(); // keeps what you're typing
    if (t === 'board') { renderProgress(); renderTicketEditor(); } // habit drafts stay as they are
    refreshDrawer();
  });
  showTab();
}

const currentTab = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today');

function showTab() {
  if (location.hash === '#plan' || location.hash === '#plan-next') { // the board, on the week to plan (next week on Fridays)
    planWeek = location.hash === '#plan-next' || new Date().getDay() === 5 ? nextWeek : curWeek;
    habitsOpen = planWeek !== curWeek;
    history.replaceState(null, '', '#board');
  }
  const t = currentTab();
  for (const x of TABS) {
    $(`#tab-${x}`).hidden = x !== t;
    $(`nav a[href="#${x}"]`).classList.toggle('on', x === t);
  }
  ({ today: renderDay, board: renderBoard, backlog: renderBacklog, retro: renderRetro, rewards: renderRewards, trends: renderTrends, settings: renderSettings })[t]();
}

const dueBadge = (t) => { const d = dueInfo(t, today); return d ? `<span class="due ${d.cls}">${esc(d.text)}</span>` : ''; };
const rewardPill = (goalId) => { const r = ruleFor(goalId); return r ? `<span class="rewardPill" title="Paid for a week at 100% of this habit's plan">💰 ${money(r.amount)} / week at 100%</span>` : ''; };

function flash(el, text) {
  el.textContent = text;
  setTimeout(() => (el.textContent = ''), 3000);
}

const kpi = (v, label, cls = '') => `<div class="kpi"><b class="${cls}">${v}</b><span>${label}</span></div>`;
const chip = (text, b) => `<span class="cell tint-${b}">${text}</span>`;
const progress = (frac) => `<div class="bar"><div class="${frac >= 1 ? 'fill-green' : 'fill-accent'}" style="width:${Math.round(frac * 100)}%"></div></div>`;

function reasonsHtml(list) {
  if (!list.length) return 'Nothing logged. 🌱';
  return list
    .map((r) => `<div class="reason"><span class="pill">${dow(r.day)} ${fmt(r.day)}</span> <b>${esc(r.goal)}</b> · ${esc(r.what)}<br>“${esc(r.text)}”</div>`)
    .join('');
}

// ================= THIS WEEK BOARD =================

function reflectionsHtml(dayKeys) {
  const list = [...dayKeys].reverse().filter((k) => state.days[k]?.reflection);
  if (!list.length) return '<p class="muted" style="margin:0">Nothing written yet. Use the Reflection box in the popup at the end of the day.</p>';
  return list.map((k) => {
    const sc = dayScore(k, state)?.score ?? null;
    const when = parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `<div class="reflection"><div class="row" style="gap:8px;margin-bottom:4px"><b>${when}</b>${sc == null ? '' : `<span class="band ${band(sc)} small">● ${sc}</span>`}</div><div class="rtext">${esc(state.days[k].reflection)}</div></div>`;
  }).join('');
}

// The week board: plan (tasks + habits) and progress, for this week or next.
function renderBoard() {
  renderPlan();
  renderProgress();
}

// Progress for the week on the board: KPIs, the habit grid and (this week only) the timer and reasons cards.
function renderProgress() {
  const wk = planWeek;
  const live = wk === curWeek;
  $('#boardTitle').textContent = `${live ? 'This week' : 'Next week'} · ${weekLabel(wk)}`;
  $('#boardKpis').hidden = !live;
  document.querySelector('#tab-board .weekOnly').hidden = !live;
  $('#boardCard').hidden = !live || !state.weeks[wk];
  $('#habitEditor').hidden = !(habitsOpen || !live);
  $('#editHabits').hidden = !live;
  $('#editHabits').textContent = habitsOpen ? 'Close editor' : '✎ Edit habits';
  if (!live) return;
  const plan = state.weeks[curWeek];
  const s = weekSummary(curWeek, state, today);
  const statuses = (plan?.goals || []).map((g) => goalStatus(g, curWeek, state, today));
  const count = (st) => statuses.filter((x) => x === st).length;
  $('#boardKpis').innerHTML =
    kpi(s.avg ?? '—', 'week score', `band ${band(s.avg)}`) +
    kpi(`${count('done') + count('on')}<span class="small muted"> / ${statuses.length}</span>`, `on track · ${count('risk')} at risk · ${count('missed')} missed`) +
    kpi(`${s.greenDays}/${s.checkins}`, 'thriving days') +
    kpi(streak(state, today), 'check-in streak 🔥') +
    kpi(s.procrastTotal ? `${s.procrastTotal} min` : '0 min', 'procrastination this week') +
    (() => { const tw = timeOnDays(state, weekDays(curWeek).filter((k) => k <= today)); return kpi(hm(tw.totalMin), `time invested${tw.autoMin ? ` · ${hm(tw.autoMin)} est.` : ''}`); })();
  $('#boardReasons').innerHTML = reasonsHtml(reasonsIn(weekDays(curWeek).filter((k) => k <= today), state));
  $('#boardReflections').innerHTML = reflectionsHtml(weekDays(curWeek).filter((k) => k <= today));
  renderSessions(weekDays(curWeek).filter((k) => k <= today));
  $('#whyWeek').innerHTML = whyTable(weekDays(curWeek).filter((k) => k <= today));
  if (!plan) return;
  renderTagFilter(plan);

  const days = weekDays(curWeek);
  let html = `<tr><th>Goal</th>${days
    .map((k) => `<th class="day ${k === today ? 'today' : ''}">${dow(k)}<br><span class="small">${parseKey(k).getDate()}</span></th>`)
    .join('')}<th class="wk">This week</th></tr>`;

  html += `<tr><td><b>Daily score</b></td>${days
    .map((k) => {
      const sc = k <= today ? dayScore(k, state)?.score ?? null : null;
      return `<td class="day">${k > today ? '' : chip(sc ?? '·', band(sc))}</td>`;
    })
    .join('')}<td class="wk">${kpiInline(s.avg)}</td></tr>`;

  const shown = plan.goals.filter((g) => !boardTag || goalTags(g).includes(boardTag));
  if (!shown.length) html += `<tr><td colspan="9" class="muted">No goals with this tag this week.</td></tr>`;
  for (const g of shown) {
    const avg = goalWeekAvg(g, curWeek, state, today);
    const st = goalStatus(g, curWeek, state, today);
    html += `<tr class="goalHead"><td>${g.icon || '⭐'} ${esc(g.name)} <span class="tags">${tagChips(goalTags(g), state.settings.tags)}</span></td>${days
      .map((k) => {
        const gs = k <= today && state.days[k] ? goalScore(g, k, state) : null;
        return `<td class="day">${gs == null ? '' : `<span class="band ${band(gs)}">●</span>`}</td>`;
      })
      .join('')}<td class="wk">${statusPill(st, STATUS)} ${kpiInline(avg)}</td></tr>`;
    for (const m of g.metrics) {
      const key = metricKey(g, m);
      const w = metricWeek(g, m, curWeek, state, today);
      html += `<tr><td class="metricName muted">${m.label ? `${esc(m.label)} · ` : ''}<span class="small">target ${esc(targetShort(m))}</span></td>${days
        .map((k) => {
          if (k > today || !state.days[k]) return '<td class="day"></td>';
          const v = state.days[k].values?.[key];
          const sc = metricScore(g, m, k, state);
          const shown = v === true ? '✓' : v === false ? '✗' : v == null || v === '' ? '·' : round1(Number(v));
          const reason = state.days[k].reasons?.[key];
          return `<td class="day" ${reason ? `title="${esc(reason)}"` : ''}>${chip(shown, m.kind === 'perWeekSum' ? 'none' : band(sc))}</td>`;
        })
        .join('')}<td class="wk"><span class="small">${esc(w.text)}</span>${w.pct == null ? '' : progress(w.pct)}</td></tr>`;
    }
  }
  $('#boardTable').innerHTML = html;
}

// ---------- why you procrastinated / sprint tickets ----------

const reasonLabel = (id) => (id === 'unrecorded' ? '❔ Not answered' : (({ icon, label }) => `${icon} ${label}`)(reasonById(id) || { icon: '', label: id }));

function whyTable(dayKeys) {
  const stats = reasonStats(dayKeys, state);
  if (!stats.length) return '<tr><td class="muted">No procrastination stretches long enough to ask about yet.</td></tr>';
  const total = stats.reduce((a, x) => a + x.min, 0);
  return '<tr><th>Reason</th><th>Times</th><th>Minutes</th><th>Share</th><th></th></tr>' + stats.map((x) => {
    const pct = Math.round((100 * x.min) / total);
    return `<tr><td>${reasonLabel(x.id)}</td><td class="n">${x.count}</td><td class="n">${hm(x.min)}</td><td class="n">${pct}%</td>
      <td style="width:35%"><div class="whyBar" style="width:${pct}%;${x.id === 'unrecorded' ? 'background:var(--none)' : ''}"></div></td></tr>`;
  }).join('');
}


// A session's task, with its ticket (or the habit it counted toward) underneath.
function taskCell(x) {
  const t = x.ticketId && state.tickets[x.ticketId];
  if (t) {
    const title = ticketTitle(t, state);
    return `${esc(title)}${x.task && x.task !== t.title && x.task !== title ? `<div class="small muted">${esc(x.task)}</div>` : ''}`;
  }
  const id = sessionGoalId(x);
  const g = state.weeks[weekKeyOf(x.day || dateKey(new Date(x.start)))]?.goals.find((y) => y.id === id);
  const goal = g ? `${g.icon || '⭐'} ${g.name} · no ticket` : 'no ticket';
  return `${esc(x.task)}<div class="small muted">${esc(goal)}</div>`;
}

const hm = (min) => (min >= 60 ? `${round1(min / 60)} h` : `${Math.round(min)} min`);
const timeOf = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function renderSessions(dayKeys) {
  const t = sessionTotals(dayKeys, state);
  $('#sessionKpis').innerHTML =
    kpi(t.count, 'sessions') +
    kpi(t.avgStartMin == null ? '—' : hm(t.avgStartMin), 'avg time to start') +
    kpi(hm(t.procrastMin), 'procrastinating', 'band red') +
    kpi(hm(t.workMin), 'working', 'band green') +
    kpi(procrastPct(t.procrastMin, t.workMin) == null ? '—' : `${procrastPct(t.procrastMin, t.workMin)}%`, 'of session time procrastinating');
  const list = sessionsIn(dayKeys, state).reverse();
  $('#sessionTable').innerHTML = list.length
    ? '<tr><th>When</th><th>Task</th><th>To start</th><th>Worked</th><th>% procrastinating</th><th></th></tr>' +
      list.map((x) => {
        const total = x.procrastMin + x.workMin || 1;
        const pct = procrastPct(x.procrastMin, x.workMin);
        const pctBand = pct == null ? 'none' : pct >= 50 ? 'red' : pct >= 20 ? 'yellow' : 'green';
        return `<tr><td class="small"><span class="pill">${dow(x.day)}</span> ${timeOf(x.start)}</td><td>${taskCell(x)}</td>
          <td class="n band ${x.procrastMin > 15 ? 'red' : 'none'}">${hm(x.procrastMin)}</td><td class="n band green">${hm(x.workMin)}${x.pausedMin ? ` <span class="small muted">(+${hm(x.pausedMin)} paused)</span>` : ''}</td>
          <td class="n band ${pctBand}">${pct == null ? '—' : `${pct}%`}</td>
          <td><div class="bar2"><div class="p" style="width:${(100 * x.procrastMin) / total}%"></div><div class="w" style="width:${(100 * x.workMin) / total}%"></div></div></td></tr>`;
      }).join('')
    : '<tr><td class="muted">No sessions yet. Hit “▶ Start task” in the popup when you sit down to work.</td></tr>';
}

let boardTag = null;

function renderTagFilter(plan) {
  const used = new Set(plan.goals.flatMap((g) => goalTags(g)));
  const tags = state.settings.tags.filter((t) => used.has(t.id));
  const box = $('#tagFilter');
  if (boardTag && !used.has(boardTag)) boardTag = null;
  box.innerHTML = tags.length
    ? `<span class="tag${boardTag ? ' off' : ''}" style="--c:#8c7b6c" data-tag="">All</span>` +
      tags.map((t) => tagChip(t, { off: boardTag !== t.id, attrs: `data-tag="${esc(t.id)}"` })).join('')
    : '';
  box.querySelectorAll('[data-tag]').forEach((el) => (el.onclick = () => { boardTag = el.dataset.tag || null; renderBoard(); }));
}

const kpiInline = (v) => `<b class="band ${band(v)}">${v ?? '—'}</b> <span class="small muted">avg</span>`;
const targetShort = (m) => {
  const t = Number(m.target) || 0;
  if (m.kind === 'perDayMax') return `≤ ${t} ${m.unit}/day`;
  if (m.kind === 'perDayMin') return `≥ ${t} ${m.unit}/day`;
  if (m.kind === 'oncePerWeek') return 'done by Fri';
  return `${t} ${m.unit}/week`;
};

// ================= TODAY (any day) =================

let dayView = today;
let calMonth = today.slice(0, 7); // 'YYYY-MM'
let dayForm = null;
const BAND_WORD = { green: 'Thriving', yellow: 'Building', red: 'Fresh start tomorrow', none: '' };

const dayReflection = bindReflection({
  textarea: $('#dReflection'),
  msgEl: $('#dReflectMsg'),
  getDayKey: () => dayView,
  getState: () => state,
});

async function goToDay(k) {
  if (!k || k > today) return;
  await dayReflection.flush();
  dayView = k;
  calMonth = k.slice(0, 7);
  closeSessionEditor();
  picked.clear();
  $('#dReflectMsg').textContent = '';
  $('#dReflection').value = state.days[k]?.reflection ?? '';
  renderDay();
}

function renderDay() {
  const k = dayView;
  const d = parseKey(k);
  $('#dDow').textContent = d.toLocaleDateString(undefined, { weekday: 'long' }) + (k === today ? ' · today' : '');
  $('#dDate').textContent = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const wk = weekKeyOf(k);
  $('#dWeek').textContent = `Week ${weekLabel(wk)} · day ${weekDays(wk).indexOf(k) + 1} of 7${state.weeks[wk]?.theme ? ` · “${state.weeks[wk].theme}”` : ''}`;
  $('#dPick').max = today;
  $('#dPick').value = k;
  $('#dNext').disabled = k >= today;
  $('#dToday').disabled = k === today;

  const plan = state.weeks[wk];
  $('#dNoPlan').hidden = !!plan;
  $('#dCheckin').hidden = !plan;
  if (plan) {
    $('#dNote').value = state.days[k]?.note ?? '';
    dayForm = buildCheckin({ box: $('#dGoals'), dayKey: k, getState: () => state, onSaved: refreshDay });
  } else {
    dayForm = null;
  }
  $('#dReflection').value = state.days[k]?.reflection ?? '';
  refreshDay();
}

// Parts that can update without touching the form you're filling in.
function refreshDay() {
  const k = dayView;
  const e = state.days[k];
  const sc = dayScore(k, state)?.score ?? null;
  const b = band(sc);
  $('#dScore').textContent = sc ?? '—';
  $('#dScore').className = `band ${b}`;
  $('#dBand').textContent = BAND_WORD[b];
  $('#dBand').className = `band ${b} small`;
  const logged = Object.keys(e?.values || {}).length;
  const tm = timeOnDay(state, k);
  $('#dStatus').textContent = (!e || !logged ? 'Not checked in yet' : e.complete === false ? 'Partly checked in' : 'Checked in ✓') +
    (tm.totalMin ? ` · ⏱ ${hm(tm.totalMin)} invested${tm.autoMin ? ` (${hm(tm.autoMin)} estimated)` : ''}` : '');
  const plan = state.weeks[weekKeyOf(k)];
  if (plan) {
    const n = plan.goals.filter((g) => g.metrics.every((m) => m.kind === 'perWeekSum' || e?.values?.[`${g.id}.${m.id}`] != null)).length;
    $('#dHabitsHead').textContent = n === plan.goals.length ? 'Habits · all logged 🎉' : `Habits · ${n}/${plan.goals.length} logged`;
  }
  renderDayDue(k);
  $('#dSavedAt').textContent = e?.savedAt ? `last saved ${new Date(e.savedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  dayReflection.refresh();
  dayForm?.applyTimer();
  renderDaySessions(k); // the add/edit form sits apart, so it isn't wiped by updates
  renderCalendar();
}

let sessionEditor = null; // { id|null } while the add/edit form is open

function renderDaySessions(k) {
  const list = (state.sessions[k] || []).slice().sort((a, b) => a.start - b.start);
  const live = state.activeSession && dateKey(new Date(state.activeSession.start)) === k
    ? `<p class="small" style="margin:0 0 8px">⏱ Running now: <b>${esc(state.activeSession.task)}</b> (syncs when you end it)</p>` : '';
  $('#dSessions').innerHTML = live + (list.length
    ? '<table><tr><th></th><th>Started</th><th>Task</th><th>To start</th><th>Worked</th><th>% procrastinating</th><th></th></tr>' +
      list.map((x) => {
        const pct = procrastPct(x.procrastMin, x.workMin);
        const pb = pct == null ? 'none' : pct >= 50 ? 'red' : pct >= 20 ? 'yellow' : 'green';
        const flag = x.edited ? ' <span class="pill">edited</span>' : '';
        const why = (x.delays || []).filter((d) => d.reason).map((d) => `<span class="reasonTag" title="${esc(d.note || '')}">${reasonById(d.reason)?.icon || ''} ${esc(reasonById(d.reason)?.label || d.reason)} · ${Math.round(d.min)}m</span>`).join('');
        return `<tr><td><input type="checkbox" data-pick="${esc(x.id)}" ${picked.has(x.id) ? 'checked' : ''} /></td><td class="small">${timeOf(x.start)}${flag}</td><td>${taskCell(x)}</td><td class="n">${hm(x.procrastMin)}${why ? `<div>${why}</div>` : ''}</td>
          <td class="n band green">${hm(x.workMin)}${x.pausedMin ? ` <span class="small muted">(+${hm(x.pausedMin)} paused)</span>` : ''}</td>
          <td class="n band ${pb}">${pct == null ? '—' : `${pct}%`}</td>
          <td style="white-space:nowrap"><button class="ghost" data-edit="${esc(x.id)}">Edit</button><button class="ghost" data-del="${esc(x.id)}" title="Delete">✕</button></td></tr>`;
      }).join('') + '</table>'
    : '<p class="muted" style="margin:0">No sessions this day.</p>');
  $('#dSessions').querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openSessionEditor(b.dataset.edit)));
  for (const id of [...picked]) if (!list.some((x) => x.id === id)) picked.delete(id);
  $('#dSessions').querySelectorAll('[data-pick]').forEach((cb) => (cb.onchange = () => {
    if (cb.checked) picked.add(cb.dataset.pick); else picked.delete(cb.dataset.pick);
    renderBulk();
  }));
  renderBulk();
  $('#dSessions').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const x = list.find((y) => y.id === b.dataset.del);
    if (!x || !confirm(`Delete “${x.task}” (${timeOf(x.start)})? Its time comes off the check-in.`)) return;
    await deleteSession(k, x.id);
  }));
}

// ---------- bulk: rename / move several sessions ----------

const picked = new Set();
function renderBulk() {
  const n = picked.size;
  const box = $('#dBulk');
  if (!n) { box.hidden = true; return; }
  const wasHidden = box.hidden;
  box.hidden = false;
  $('#dBulkCount').textContent = `${n} session${n > 1 ? 's' : ''} selected: move to`;
  if (wasHidden) $('#dBulkTarget').innerHTML = '<option value="keep">Keep their ticket</option>' + targetOptions(weekKeyOf(dayView), 'keep');
}
$('#dBulkClear').onclick = () => { picked.clear(); renderDaySessions(dayView); };
$('#dBulkApply').onclick = async () => {
  const v = $('#dBulkTarget').value;
  const patch = v === 'keep' ? {} : resolveTarget(v, weekKeyOf(dayView));
  const name = $('#dBulkTask').value.trim();
  if (name) patch.task = name;
  if (!Object.keys(patch).length) return;
  const items = [...picked].map((id) => ({ dayKey: dayView, id }));
  picked.clear();
  $('#dBulkTask').value = '';
  $('#dBulk').hidden = true;
  await updateSessions(items, patch);
};

const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function openSessionEditor(id) {
  const k = dayView;
  const x = (state.sessions[k] || []).find((y) => y.id === id);
  if (!x) return;
  sessionEditor = { id };
  const cur = x.ticketId && state.tickets[x.ticketId] ? `t:${x.ticketId}` : sessionGoalId(x) ? `h:${sessionGoalId(x)}` : '';
  const startDefault = hhmm(x.start);
  // Sessions from before reasons existed get one stretch covering their procrastination.
  const delays = x.delays ?? (x.procrastMin > 0 ? [{ min: x.procrastMin, reason: null, note: '', at: x.start }] : []);
  $('#dSessionEdit').innerHTML = `<div class="sessEdit">
    <b>Edit session</b>
    <div class="grid2" style="margin-top:8px">
      <label>Ticket<select id="seGoal">${targetOptions(weekKeyOf(k), cur)}</select></label>
      <label>What exactly<input type="text" id="seTask" maxlength="80" value="${esc(x?.task || '')}" placeholder="optional" /></label>
      <label>Started at<input type="time" id="seStart" value="${startDefault}" /></label>
      <label>Procrastinating (min)<input type="number" id="seProc" min="0" step="1" value="${Math.round(x.procrastMin)}" /></label>
      <label>Working (min)<input type="number" id="seWork" min="0" step="1" value="${Math.round(x.workMin)}" /></label>
    </div>
    ${delays.length ? `<div style="margin-top:10px"><span class="small muted" style="font-weight:600">Why the procrastination</span>${delays.map((d, i) => `
      <div class="row" style="margin-top:6px;flex-wrap:wrap"><span class="small" style="min-width:90px">${i ? 'after pause' : 'before start'} · ${Math.round(d.min)} min</span>
        <select data-why="${i}" style="max-width:300px"><option value="">—</option>${DELAY_REASONS.map((r) => `<option value="${r.id}" ${d.reason === r.id ? 'selected' : ''}>${r.icon} ${esc(r.label)}</option>`).join('')}</select>
        <input type="text" data-whynote="${i}" maxlength="140" value="${esc(d.note || '')}" placeholder="note (optional)" style="flex:1;min-width:160px" /></div>`).join('')}</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="primary" id="seSave">Save changes</button><button id="seCancel">Cancel</button><span class="small error" id="seMsg"></span></div>
  </div>`;
  $('#seCancel').onclick = closeSessionEditor;
  $('#seSave').onclick = async () => {
    const [h, mi] = ($('#seStart').value || '').split(':').map(Number);
    if (Number.isNaN(h)) { $('#seMsg').textContent = 'Pick a start time'; return; }
    const d = parseKey(k);
    d.setHours(h, mi || 0, 0, 0);
    const target = resolveTarget($('#seGoal').value, weekKeyOf(k));
    const data = {
      task: $('#seTask').value.trim() || target.goalName || 'Focus session',
      ...target,
      delays: delays.map((d, i) => ({
        ...d,
        reason: document.querySelector(`[data-why="${i}"]`).value || null,
        note: document.querySelector(`[data-whynote="${i}"]`).value.trim(),
      })),
      start: d.getTime(),
      procrastMin: Number($('#seProc').value) || 0,
      workMin: Number($('#seWork').value) || 0,
    };
    if (!data.procrastMin && !data.workMin) { $('#seMsg').textContent = 'Enter some minutes'; return; }
    closeSessionEditor();
    await updateSession(k, x.id, data);
  };
  $('#seGoal').focus();
}

const targetOptions = (wk, cur) => targetOptionsFor(wk, cur, state);
const resolveTarget = (v, wk) => resolveTargetFor(v, wk, state);

function closeSessionEditor() {
  sessionEditor = null;
  $('#dSessionEdit').innerHTML = '';
}


function renderCalendar() {
  const [y, mo] = calMonth.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const daysIn = new Date(y, mo, 0).getDate();
  $('#calTitle').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calNext').disabled = calMonth >= today.slice(0, 7);
  const lead = (first.getDay() + 1) % 7; // columns start on Saturday
  let html = ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'].map((h) => `<div class="h">${h}</div>`).join('');
  html += '<div class="d out"></div>'.repeat(lead);
  for (let i = 1; i <= daysIn; i++) {
    const k = dateKey(new Date(y, mo - 1, i));
    const sc = k <= today ? dayScore(k, state)?.score ?? null : null;
    const cls = ['d', k > today ? 'future' : `tint-${band(sc)}`, k === today ? 'today' : '', k === dayView ? 'sel' : ''].join(' ');
    const r = state.days[k]?.reflection ? '<span class="r">✎</span>' : '';
    html += `<div class="${cls}" data-k="${k}" title="${k}${sc == null ? '' : ` · ${sc}`}">${i}${r}</div>`;
  }
  $('#calGrid').innerHTML = html;
  $('#calGrid').querySelectorAll('.d[data-k]').forEach((c) => (c.onclick = () => goToDay(c.dataset.k)));
}

const shiftMonth = (n) => {
  const [y, mo] = calMonth.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
};
$('#calPrev').onclick = () => shiftMonth(-1);
$('#calNext').onclick = () => shiftMonth(1);
$('#dPrev').onclick = () => goToDay(dateKey(addDays(parseKey(dayView), -1)));
$('#dNext').onclick = () => goToDay(dateKey(addDays(parseKey(dayView), 1)));
$('#dToday').onclick = () => goToDay(today);
$('#dPick').onchange = () => goToDay($('#dPick').value);
$('#dNote').addEventListener('change', () => dayForm?.saveNote($('#dNote').value.trim()));

// Tickets due on the day shown (and, for today, anything overdue), with a tick to finish them.
function renderDayDue(k) {
  const list = ticketList(state).filter((t) => t.due && t.sprint != null && (k === today ? t.due <= k && t.status !== 'done' : t.due === k))
    .sort((a, b) => a.due.localeCompare(b.due));
  const box = $('#dDue');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = `<div class="emptyLine">✓ Nothing due ${k === today ? 'today' : 'that day'}.</div>`; return; }
  for (const t of list) {
    const row = el('div', { className: 'task' });
    const chk = checkBtn({ state: t.status === 'done' ? true : null, title: 'Mark done', onChange: (v) => updateTicket(t.id, { status: v ? 'done' : 'doing' }) });
    const main = el('div', { className: 'tMain' });
    main.innerHTML = `<div class="tTitle">${esc(ticketTitle(t, state))}</div><div class="tMeta">${dueBadge(t)} ${t.sizeH ? `· ${t.sizeH} h` : ''} · ${TICKET_STATUS[t.status].label}</div>`;
    row.append(chk, main);
    row.onclick = (e) => { if (!e.target.closest('button')) openTicket(t.id); };
    box.append(row);
  }
}

// ================= RETRO =================

let retroWeek = curWeek;
const endOf = (wk) => dateKey(addDays(parseKey(wk), 6));
const uptoFor = (wk) => (endOf(wk) < today ? endOf(wk) : today);
const fmtNum = (v, unit) => (v == null ? '—' : `${v}${unit === '%' ? '%' : unit === '×' ? '×' : unit ? ` ${unit}` : ''}`);

function deltaHtml(cur, prev, better, unit) {
  if (cur == null || prev == null) return '<span class="delta flat">—</span>';
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return '<span class="delta flat">=</span>';
  const cls = better === 0 ? 'flat' : (d > 0) === (better > 0) ? 'good' : 'bad';
  return `<span class="delta ${cls}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit === '%' ? ' pts' : unit && unit !== '×' ? ` ${unit}` : ''}</span>`;
}

// One deterministic paragraph: the same numbers in words.
function retroSentence(m, p) {
  const bits = [];
  const s = m.starting, f = m.focus, d = m.delivery;
  if (s.sessions) {
    bits.push(`${s.sessions} session${s.sessions > 1 ? 's' : ''}, ${f.workH} h worked.`);
    bits.push(`Median ${s.medianStartMin} min to start${p.starting.medianStartMin != null ? ` (${p.starting.medianStartMin} last week)` : ''}; ${s.quickStartPct}% started within ${QUICK_START_MIN} min; ${f.procrastPct}% of session time went to procrastination.`);
    const top = m.causes.reasons.find((x) => x.id !== 'unrecorded');
    if (top) bits.push(`Top reason: ${reasonLabel(top.id)} (${top.sharePct}% of procrastination minutes).`);
    const worst = [...s.byTimeOfDay].sort((a, b) => b.medianStart - a.medianStart)[0];
    if (worst && s.byTimeOfDay.length > 1 && worst.medianStart > s.medianStartMin) bits.push(`Slowest starts: ${worst.label.toLowerCase()} (median ${worst.medianStart} min over ${worst.sessions} session${worst.sessions > 1 ? 's' : ''}).`);
  } else bits.push('No timed sessions this week.');
  if (d.tickets) bits.push(`Tickets: ${d.done}/${d.tickets} done, ${d.carriedOver} carried over${d.unplanned ? `, ${d.unplanned} unplanned (${d.unplannedH} h)` : ''}.`);
  if (m.habits.score != null) bits.push(`Habit score ${m.habits.score} over ${m.habits.checkins} check-in${m.habits.checkins === 1 ? '' : 's'}.`);
  return bits.join(' ');
}

function renderRetro() {
  const weeks = [...new Set([curWeek, ...Object.keys(state.weeks), ...Object.keys(state.sessions).map(weekKeyOf)])].filter((w) => w <= curWeek).sort().reverse();
  $('#retroWeek').innerHTML = weeks.map((w) => `<option value="${w}">${w === curWeek ? 'This week' : 'Week'} · ${weekLabel(w)}</option>`).join('');
  $('#retroWeek').value = retroWeek;
  $('#retroWeek').onchange = () => { retroWeek = $('#retroWeek').value; renderRetro(); };
  const wk = retroWeek;
  const m = weekMetrics(wk, state, uptoFor(wk));
  const p = weekMetrics(prevWeek(wk), state, endOf(prevWeek(wk)));
  $('#retroSub').textContent = `${weekLabel(wk)}${wk === curWeek ? ` · so far (through ${dow(uptoFor(wk))})` : ''} · compared with ${weekLabel(prevWeek(wk))}`;
  $('#retroLine').textContent = retroSentence(m, p);

  renderCoach();
  for (const [x, w] of [[m, wk], [p, prevWeek(wk)]]) {
    const ks = weekDays(w).filter((k) => k <= uptoFor(w));
    const rs = ks.map((k) => readinessScore(state.days[k]?.readiness, state.settings.sleepTarget)).filter((v) => v != null);
    x.wellbeing = { readiness: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null, votes: votes(state, ks).total };
  }
  $('#retroHead').innerHTML = '<tr><th>Measure</th><th>This week</th><th>Last week</th><th>Change</th></tr>' +
    [...HEADLINES, ['wellbeing.readiness', 'Average readiness', '', 1], ['wellbeing.votes', '🗳️ Identity votes (quick starts + habits on target)', '', 1]].map(([path, label, unit, better]) => {
      const a = pick(m, path), b = pick(p, path);
      return `<tr><td>${label}</td><td class="n"><b>${fmtNum(a, unit)}</b></td><td class="n muted">${fmtNum(b, unit)}</td><td>${deltaHtml(a, b, better, unit)}</td></tr>`;
    }).join('');

  const blocks = m.starting.byTimeOfDay;
  const maxB = Math.max(1, ...blocks.map((x) => x.medianStart || 0));
  $('#retroBlocks').innerHTML = blocks.length
    ? '<tr><th>When</th><th>Sessions</th><th>Median to start</th><th></th></tr>' + blocks.map((x) => `<tr><td>${x.label}</td><td class="n">${x.sessions}</td><td class="n">${x.medianStart} min</td>
        <td style="width:40%"><div class="whyBar" style="width:${Math.round((100 * (x.medianStart || 0)) / maxB)}%"></div></td></tr>`).join('')
    : '<tr><td class="muted">No sessions this week.</td></tr>';

  const prevR = Object.fromEntries(p.causes.reasons.map((x) => [x.id, x]));
  $('#retroReasons').innerHTML = m.causes.reasons.length
    ? '<tr><th>Reason</th><th>Min</th><th>Share</th><th>vs last week</th></tr>' + m.causes.reasons.map((x) => `<tr><td>${reasonLabel(x.id)}</td><td class="n">${x.min}</td><td class="n">${x.sharePct}%</td>
        <td>${deltaHtml(x.min, prevR[x.id]?.min ?? 0, -1, 'min')}</td></tr>`).join('')
    : '<tr><td class="muted">No procrastination stretches long enough to count.</td></tr>';

  const ids = [...new Set(Object.values(m.causes.byTicket).flatMap((o) => Object.keys(o)))];
  const rows = Object.entries(m.causes.byTicket);
  const maxCell = Math.max(1, ...rows.flatMap(([, o]) => Object.values(o)));
  const tName = (id) => (id === '(no ticket)' ? '<span class="muted">No ticket</span>' : esc(state.tickets[id] ? ticketTitle(state.tickets[id], state) : 'Deleted ticket'));
  $('#retroReasonTicket').innerHTML = rows.length
    ? `<tr><th>Ticket</th>${ids.map((id) => `<th class="small">${reasonLabel(id)}</th>`).join('')}</tr>` + rows.map(([tid, o]) => `<tr><td>${tName(tid)}</td>${ids.map((id) => {
        const v = o[id];
        return `<td class="n">${v ? `<span class="heat" style="background:color-mix(in srgb, var(--red) ${Math.round(12 + (60 * v) / maxCell)}%, transparent)">${v}</span>` : ''}</td>`;
      }).join('')}</tr>`).join('')
    : '<tr><td class="muted">Nothing yet.</td></tr>';

  const tr = m.delivery.ticketRows;
  $('#retroTickets').innerHTML = tr.length
    ? '<tr><th>Ticket</th><th>Outcome</th><th>Size</th><th>Logged</th><th>Sessions</th><th>Median to start</th><th>% procrast.</th></tr>' + tr.map((t) => `<tr>
        <td>${esc(t.title)} ${t.planned ? '' : '<span class="pill">unplanned</span>'} ${t.due ? (t.onTime === true ? '<span class="due">on time ✓</span>' : t.onTime === false ? '<span class="due late">late</span>' : dueBadge(state.tickets[t.id] || t)) : ''}</td>
        <td>${t.done ? '<span class="status st-done">● Done</span>' : t.carried ? `<span class="status st-risk">↪ ${wk === curWeek ? 'open' : 'carried over'}</span>` : `<span class="status st-on">${TICKET_STATUS[t.status].label}</span>`}</td>
        <td class="n">${t.sizeH == null ? '—' : `${t.sizeH} h`}</td><td class="n">${t.loggedH} h</td><td class="n">${t.sessions || '—'}</td>
        <td class="n">${t.medianStart == null ? '—' : `${t.medianStart} min`}</td><td class="n">${t.procrastPct == null ? '—' : `${t.procrastPct}%`}</td></tr>`).join('') +
      `<tr><td colspan="7" class="small muted">${m.delivery.done}/${m.delivery.tickets} done · ${m.delivery.sizedH} h sized · ${m.delivery.loggedH} h logged · logged ÷ size on done tickets: ${m.delivery.estimateAccuracy ?? '—'}×${m.delivery.withDeadline ? ` · done by the deadline: ${m.delivery.onTimePct ?? '—'}${m.delivery.onTimePct == null ? '' : '%'} · past deadline and open: ${m.delivery.overdue}` : ''}</td></tr>`
    : '<tr><td class="muted">No tickets in this sprint.</td></tr>';

  const prevH = Object.fromEntries(p.habits.perHabit.map((x) => [x.id, x.avg]));
  $('#retroHabits').innerHTML = m.habits.perHabit.length
    ? '<tr><th>Habit</th><th>Avg</th><th>vs last week</th></tr>' + m.habits.perHabit.map((h) => `<tr><td>${h.icon} ${esc(h.name)}</td>
        <td class="n"><b class="band ${band(h.avg)}">${h.avg ?? '—'}</b></td><td>${deltaHtml(h.avg, prevH[h.id] ?? null, 1, '')}</td></tr>`).join('')
    : '<tr><td class="muted">No habits planned.</td></tr>';

  $('#retroReflections').innerHTML = reflectionsHtml(weekDays(wk).filter((k) => k <= uptoFor(wk)));
  $('#retroDefs').innerHTML = [
    '<b>Time to start</b>: the first procrastination stretch of a session, before you first pressed Start working.',
    `<b>Started within ${QUICK_START_MIN} min</b>: share of sessions whose time to start was ${QUICK_START_MIN} min or less.`,
    '<b>% procrastinating</b>: procrastination ÷ (procrastination + work) over all sessions; paused time is left out.',
    '<b>Full length</b>: work reached 95% of the session length you set.',
    '<b>Resumes</b>: procrastination stretches after the first (each Resume after a pause).',
    `<b>No reason given</b>: minutes of stretches of ${state.settings.askWhyMinutes}+ min you didn't answer “why” for.`,
    '<b>Carried over</b>: tickets in the sprint still open when it ended.',
    '<b>Logged ÷ size</b>: timer hours ÷ size, over done tickets that had a size (1.0 = estimate spot on).',
    '<b>Done by the deadline</b>: done tickets with a deadline that were done on or before it ÷ done tickets with a deadline.',
    '<b>Past deadline</b>: tickets in the sprint, not done that week, whose deadline had passed.',
  ].map((x) => `<li>${x}</li>`).join('');

  $('#retroExport').onclick = () => {
    const data = { generatedAt: new Date().toISOString(), definitions: 'See lib/metrics.js', thisWeek: m, lastWeek: p };
    downloadJson(JSON.stringify(data, null, 2), `odyssey-metrics-${wk}.json`);
  };
}

// ---------- coach: experiments from the Atomic Habits playbook ----------

const VERDICT = {
  collecting: 'Collecting data (needs 5+ sessions before and during)',
  working: 'Working: you start faster',
  worse: 'Starts got slower',
  'no clear change': 'No clear change yet',
};

function playCard(p, extra = '') {
  return `<div class="play"><div class="law">${esc(LAWS[p.law])}</div><b>${esc(p.title)}</b>
    <div class="small" style="margin-top:3px">${esc(p.why)}</div>
    <div class="small muted" style="margin-top:3px"><b>How it runs:</b> ${esc(p.rule)}</div>
    <div class="small muted" style="margin-top:3px">Targets: ${p.reasons.map(reasonLabel).join(', ')}</div>${extra}</div>`;
}

function reportHtml(e) {
  const rep = experimentReport(state, e, today);
  const cell = (k, unit, better) => {
    const a = rep.during[k], b = rep.before[k];
    return `<tr><td>${{ medianStartMin: 'Median time to start', quickStartPct: `Started within ${QUICK_START_MIN} min`, procrastPct: '% procrastinating', reasonMinPerSession: `Min of “${e.reason ? reasonById(e.reason)?.label : ''}” per session` }[k]}</td>
      <td class="n muted">${fmtNum(b, unit)}</td><td class="n"><b>${fmtNum(a, unit)}</b></td><td>${deltaHtml(a, b, better, unit)}</td></tr>`;
  };
  return `<div class="small" style="margin-top:6px">Since ${fmt(e.startDay)}${e.endDay ? ` to ${fmt(e.endDay)}` : ''} (${rep.days} day${rep.days > 1 ? 's' : ''}, ${rep.during.sessions} sessions) vs the 14 days before (${rep.before.sessions} sessions):
    <span class="verdict ${rep.verdict.split(' ')[0]}">${VERDICT[rep.verdict]}</span></div>
    <table style="margin-top:6px"><tr><th></th><th>Before</th><th>During</th><th>Change</th></tr>
    ${cell('medianStartMin', 'min', -1)}${cell('quickStartPct', '%', 1)}${cell('procrastPct', '%', -1)}${e.reason ? cell('reasonMinPerSession', 'min', -1) : ''}</table>`;
}

function renderCoach() {
  const e = activeExperiment(state);
  const rec = recommendations(state, today);
  $('#coachNow').innerHTML = e
    ? `<div class="small muted" style="font-weight:700">RUNNING NOW</div>${playCard(playById(e.playId), reportHtml(e) + '<div class="row" style="margin-top:8px"><button id="expEnd">End experiment</button><span class="small muted">Keep it if it works: run each for at least a week.</span></div>')}`
    : '<p class="small" style="margin:0">No experiment running. Pick one below: one change at a time, so the data can tell you what works.</p>';
  if (e) $('#expEnd').onclick = async () => { await endExperiment(); };

  let html = '';
  if (rec.answerWhyFirst) html += `<p class="small" style="margin:0 0 6px">⚠️ ${rec.unrecordedPct}% of the last 14 days' procrastination has no reason. Answer “why” after each stretch for a few days; the recommendations get sharper.</p>`;
  if (rec.top.length) html += `<p class="small" style="margin:0 0 4px">Last 14 days, top reasons: ${rec.top.map((x) => `${reasonLabel(x.id)} (${Math.round(x.min)} min)`).join(' · ')}</p>`;
  html += rec.plays.length
    ? `<div class="small muted" style="font-weight:700;margin-top:8px">RECOMMENDED${e ? ' NEXT' : ''}</div>` + rec.plays.map((x) => playCard(x.play, `<div class="row" style="margin-top:8px"><button class="primary" data-start="${x.play.id}" data-reason="${x.reason || ''}">${e ? 'Switch to this' : 'Start this experiment'}</button>${x.tried ? '<span class="small muted">tried before</span>' : ''}</div>`)).join('')
    : '<p class="small muted" style="margin:0">Recommendations appear once you’ve answered “why” for a few procrastination stretches.</p>';
  $('#coachRecs').innerHTML = html;

  const past = (state.experiments || []).filter((x) => x.endDay).reverse();
  $('#coachAll').innerHTML =
    (past.length ? '<div class="small muted" style="font-weight:700;margin-top:8px">PAST EXPERIMENTS</div>' + past.map((x) => playCard(playById(x.playId), reportHtml(x))).join('') : '') +
    '<div class="small muted" style="font-weight:700;margin-top:8px">THE PLAYBOOK</div>' +
    PLAYBOOK.map((p) => playCard(p, `<div class="row" style="margin-top:8px"><button data-start="${p.id}" data-reason="">${e?.playId === p.id ? 'Running' : 'Start'}</button></div>`)).join('');
  document.querySelectorAll('#tab-retro [data-start]').forEach((b) => (b.onclick = async () => {
    if (activeExperiment(state)?.playId === b.dataset.start) return;
    const p = playById(b.dataset.start);
    const reason = b.dataset.reason || p.reasons.find((rid) => rec.top.some((x) => x.id === rid)) || null;
    await startExperiment(p.id, reason);
  }));
}

// ================= PLAN =================

let planWeek = curWeek; // the week on the board
let habitsOpen = false; // habit editor open (always open for next week)
let presetDraft = [];
let adhocDraft = [];

function renderPlan() {
  const sel = $('#weekSelect');
  sel.innerHTML = [curWeek, nextWeek]
    .map((wk, i) => `<option value="${wk}">${i ? 'Next week' : 'This week'} · ${weekLabel(wk)}${state.weeks[wk] ? '' : ' · not planned'}</option>`)
    .join('');
  sel.value = planWeek;
  sel.onchange = () => { planWeek = sel.value; habitsOpen = planWeek !== curWeek; renderBoard(); };

  const saved = state.weeks[planWeek];
  const src = saved || defaultPlan(state.weeks[prevWeekOf(planWeek)]);
  $('#planStatus').textContent = saved?.carriedFrom
    ? `Habits carried over from the week of ${fmt(saved.carriedFrom)}. Change them below and Save habits.`
    : saved
    ? `Saved ${new Date(saved.setAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`
    : state.weeks[prevWeekOf(planWeek)]
      ? 'Not saved yet. Targets start from last week’s plan.'
      : 'Not saved yet. Targets start from the defaults.';
  $('#theme').value = src.theme || '';
  $('#planRetroHint').hidden = planWeek <= curWeek;

  presetDraft = PRESETS.map((p) => {
    const g = src.goals.find((x) => x.preset && x.id === p.id);
    return {
      preset: p,
      on: !!g,
      tags: [...(g ? goalTags(g) : p.tags)],
      identity: g?.identity || '',
      intention: g?.intention || '',
      estimateMin: g?.estimateMin ?? null,
      cueTime: g?.cueTime || '',
      targets: Object.fromEntries(p.metrics.map((m) => [m.id, g?.metrics.find((x) => x.id === m.id)?.target ?? m.target])),
    };
  });
  adhocDraft = src.goals
    .filter((g) => !g.preset)
    .map((g) => ({
      id: g.id,
      name: g.name,
      tags: [...goalTags(g)],
      identity: g.identity || '',
      intention: g.intention || '',
      estimateMin: g.estimateMin ?? null,
      cueTime: g.cueTime || '',
      picks: Object.fromEntries(ADHOC_METRICS.map((am) => {
        const m = g.metrics.find((x) => x.id === am.id);
        return [am.id, { on: !!m, target: m?.target ?? '' }];
      })),
    }));
  renderPresetCards();
  renderAdhocCards();
  renderTicketEditor();
}

function switchEl(checked, onChange) {
  const l = document.createElement('label');
  l.className = 'switch';
  l.innerHTML = '<input type="checkbox"><span></span>';
  const cb = l.querySelector('input');
  cb.checked = checked;
  cb.onchange = () => onChange(cb.checked);
  return l;
}

function numInput(value, onInput, max) {
  const i = document.createElement('input');
  i.type = 'number';
  i.min = 0;
  if (max) i.max = max;
  i.step = 'any';
  i.value = value;
  i.oninput = () => onInput(i.value);
  return i;
}

// Atomic Habits cues on a habit: who you're becoming, and when/where it happens.
function cueRow(d) {
  const wrap = el('div');
  const row = document.createElement('div');
  row.className = 'cueRow';
  const id = Object.assign(document.createElement('input'), { type: 'text', maxLength: 90, value: d.identity || '', placeholder: 'Identity: I am someone who… (e.g. never skips Monday gym)' });
  id.oninput = () => (d.identity = id.value);
  const cue = Object.assign(document.createElement('input'), { type: 'text', maxLength: 120, value: d.intention || '', placeholder: 'Cue: After / When … I will … (e.g. After coffee, I will open the hardest ticket)' });
  cue.oninput = () => (d.intention = cue.value);
  row.append(id, cue);
  // a time for the cue → a reminder that day, and an optional repeating calendar event
  const time = el('input', { type: 'time', value: d.cueTime || '', title: 'Reminder time (optional)' });
  time.style.width = '120px';
  time.onchange = () => (d.cueTime = time.value);
  const cal = el('button', { type: 'button', className: 'ghost small calBtn', textContent: '📅 Daily event in Google Calendar', title: 'Opens Google Calendar with a daily repeating event at this time' });
  cal.onclick = () => {
    const [h, m] = (time.value || '09:00').split(':').map(Number);
    const start = new Date(); start.setHours(h, m, 0, 0);
    const name = d.name || d.preset?.name || 'Habit';
    openUrl(gcalUrl({ title: `${d.preset?.icon || '⭐'} ${name}`, details: [d.intention, d.identity, 'From Odyssey'].filter(Boolean).join('\n'), start, minutes: d.estimateMin || 30, recur: 'DAILY' }));
  };
  wrap.append(row, el('div', { className: 'metricRow' }, el('span', { className: 'lbl', textContent: 'Cue time (optional)' }), time,
    el('span', { className: 'small muted', textContent: '· a reminder then, unless it’s done' }), cal));
  return wrap;
}

// Optional usual time for a habit: counted as time invested on days it's ticked done.
function estimateRow(d) {
  const row = el('div', { className: 'metricRow' }, el('span', { className: 'lbl', textContent: 'Usual time (optional)' }));
  row.append(stepper({ value: d.estimateMin ?? null, step: 5, unit: 'min', onChange: (v) => (d.estimateMin = v > 0 ? v : null) }),
    el('span', { className: 'small muted', textContent: '· counted as time spent on days you tick it done' }));
  return row;
}

function renderPresetCards() {
  const box = $('#presetGoals');
  box.innerHTML = '';
  for (const d of presetDraft) {
    const card = document.createElement('div');
    card.className = 'goalCard' + (d.on ? '' : ' off');
    const top = document.createElement('div');
    top.className = 'top';
    top.innerHTML = `<span style="font-size:20px">${d.preset.icon}</span><span class="nm">${d.preset.name}</span>${rewardPill(d.preset.id)}`;
    top.append(switchEl(d.on, (v) => { d.on = v; card.classList.toggle('off', !v); }));
    card.append(top, tagPicker(d), cueRow(d));
    if (!timedMetric(d.preset)) card.append(estimateRow(d));
    for (const m of d.preset.metrics) {
      const row = document.createElement('div');
      row.className = 'metricRow';
      row.innerHTML = `<span class="lbl">${m.label || KIND_LABEL[m.kind]}</span>`;
      row.append(stepper({ value: Number(d.targets[m.id]) || 0, step: stepFor(m.unit), max: m.kind === 'daysPerWeek' ? 7 : Infinity, unit: unitText(m), onChange: (v) => (d.targets[m.id] = v ?? 0) }));
      if (m.reasonIfPositive) row.insertAdjacentHTML('beforeend', '<span class="small muted">· reason asked whenever above 0</span>');
      if (m.skipReason) row.insertAdjacentHTML('beforeend', '<span class="small muted">· reason asked when skipped</span>');
      card.append(row);
    }
    box.append(card);
  }
}

function renderAdhocCards() {
  const box = $('#adhocGoals');
  box.innerHTML = '';
  adhocDraft.forEach((d, i) => {
    const card = document.createElement('div');
    card.className = 'goalCard';
    const top = document.createElement('div');
    top.className = 'top';
    top.innerHTML = '<span style="font-size:20px">⭐</span>';
    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'A habit for this week, e.g. Read, Meditate, Call family';
    name.value = d.name;
    name.oninput = () => (d.name = name.value);
    const rm = document.createElement('button');
    rm.className = 'ghost';
    rm.textContent = 'Remove';
    rm.onclick = () => { adhocDraft.splice(i, 1); renderAdhocCards(); };
    top.append(name);
    if (ruleFor(d.id)) top.insertAdjacentHTML('beforeend', rewardPill(d.id));
    top.append(rm);
    card.append(top, tagPicker(d), cueRow(d), estimateRow(d));
    const hint = el('div', { className: 'lbl small muted', style: 'margin-top:10px;font-weight:700', textContent: 'Track it by (pick one or more)' });
    const chips = el('div', { className: 'chips' });
    const rows = el('div');
    const drawRows = () => {
      chips.innerHTML = '';
      rows.innerHTML = '';
      for (const am of ADHOC_METRICS) {
        const p = d.picks[am.id];
        const c = el('button', { type: 'button', className: `chip ${p.on ? 'on' : ''}`, textContent: `${p.on ? '✓ ' : ''}${ADHOC_LABEL[am.id]}` });
        c.onclick = () => { p.on = !p.on; if (p.on && p.target === '') p.target = am.kind === 'daysPerWeek' ? 3 : 1; drawRows(); };
        chips.append(c);
        if (p.on) {
          const r = el('div', { className: 'metricRow' }, el('span', { className: 'lbl', textContent: `Target · ${ADHOC_LABEL[am.id].toLowerCase()}` }));
          r.append(stepper({ value: Number(p.target) || 0, step: stepFor(am.unit), max: am.kind === 'daysPerWeek' ? 7 : Infinity, unit: am.unit, onChange: (v) => (p.target = v ?? 0) }));
          rows.append(r);
        }
      }
    };
    drawRows();
    card.append(hint, chips, rows);
    box.append(card);
  });
}

// Colour-coded tag toggles for a goal card, plus "+ New tag".
function tagPicker(d) {
  const row = document.createElement('div');
  row.className = 'tags';
  row.style.marginTop = '8px';
  const draw = () => {
    row.innerHTML =
      state.settings.tags.map((t) => tagChip(t, { off: !d.tags.includes(t.id), attrs: `data-tag="${esc(t.id)}"` })).join('') +
      '<span class="tag off" style="--c:#c9b8a8" data-new="1">+ New tag</span>';
    row.querySelectorAll('[data-tag]').forEach((el) => (el.onclick = () => {
      const id = el.dataset.tag;
      d.tags = d.tags.includes(id) ? d.tags.filter((x) => x !== id) : [...d.tags, id];
      d.onTags?.(d.tags);
      draw();
    }));
    row.querySelector('[data-new]').onclick = async () => {
      const t = await addTag();
      if (t) { d.tags = [...d.tags, t.id]; d.onTags?.(d.tags); renderPresetCards(); renderAdhocCards(); renderTicketEditor(); }
    };
  };
  draw();
  return row;
}

async function addTag(name = prompt('New tag name')) {
  name = (name || '').trim();
  if (!name) return null;
  const existing = state.settings.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const fresh = await load();
  const tags = fresh.settings.tags;
  const tag = { id: `t-${Date.now().toString(36)}`, name, color: TAG_PALETTE[tags.length % TAG_PALETTE.length] };
  tags.push(tag);
  state.settings = { ...fresh.settings, tags };
  await save({ settings: state.settings });
  return tag;
}

$('#editHabits').onclick = () => { habitsOpen = !habitsOpen; renderProgress(); };

// The week's theme saves as you type it (a week with no plan yet gets one, copied from the week before).
$('#theme').onchange = async () => {
  const fresh = await load();
  const plan = fresh.weeks[planWeek] || { ...defaultPlan(fresh.weeks[prevWeekOf(planWeek)]), setAt: Date.now() };
  fresh.weeks[planWeek] = { ...plan, theme: $('#theme').value.trim() };
  await save({ weeks: fresh.weeks });
};

$('#addAdhoc').onclick = () => {
  adhocDraft.push({
    id: crypto.randomUUID(),
    name: '',
    tags: [],
    identity: '',
    intention: '',
    estimateMin: null,
    cueTime: '',
    picks: Object.fromEntries(ADHOC_METRICS.map((am) => [am.id, { on: false, target: '' }])),
  });
  renderAdhocCards();
  const inputs = document.querySelectorAll('#adhocGoals .top input');
  inputs[inputs.length - 1]?.focus();
};

$('#savePlan').onclick = async () => {
  const num = (v, max) => Math.min(max ?? Infinity, Math.max(0, Number(v) || 0));
  const goals = presetDraft
    .filter((d) => d.on)
    .map((d) => ({
      ...structuredClone(d.preset),
      preset: true,
      tags: d.tags,
      identity: d.identity.trim(),
      intention: d.intention.trim(),
      ...(d.estimateMin > 0 ? { estimateMin: d.estimateMin } : {}),
      ...(d.cueTime ? { cueTime: d.cueTime } : {}),
      metrics: d.preset.metrics.map((m) => ({ ...m, target: num(d.targets[m.id], m.kind === 'daysPerWeek' ? 7 : null) })),
    }));
  for (const d of adhocDraft) {
    if (!d.name.trim()) continue;
    const metrics = ADHOC_METRICS.filter((am) => d.picks[am.id].on).map((am) => ({
      ...am,
      target: num(d.picks[am.id].target, am.kind === 'daysPerWeek' ? 7 : null),
    }));
    if (!metrics.length) {
      flash($('#planMsg'), `Pick at least one metric for “${d.name.trim()}”`);
      $('#planMsg').className = 'error';
      return;
    }
    goals.push({ id: d.id, name: d.name.trim(), icon: '⭐', preset: false, tags: d.tags, identity: (d.identity || '').trim(), intention: (d.intention || '').trim(), ...(d.estimateMin > 0 ? { estimateMin: d.estimateMin } : {}), ...(d.cueTime ? { cueTime: d.cueTime } : {}), metrics });
  }
  if (!goals.length) {
    $('#planMsg').className = 'error';
    flash($('#planMsg'), 'Turn on at least one habit');
    return;
  }
  state = await load();
  state.weeks[planWeek] = { theme: $('#theme').value.trim(), goals, setAt: Date.now() };
  await save({ weeks: state.weeks });
  habitsOpen = planWeek !== curWeek;
  renderBoard();
  $('#planMsg').className = 'ok';
  flash($('#planMsg'), 'Habits saved ✓ They carry over to the weeks after until you change them.');
};

// ---------- sprint tickets (saved as you edit) ----------

const sizeVal = (v) => (v === '' || v == null || !(Number(v) > 0) ? null : Math.round(Number(v) * 10) / 10);

const timedHabits = (wk) => timedHabitsFor(wk, state);

function habitSelect(wk, value, onChange) {
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">No habit</option>' +
    timedHabits(wk).map((g) => `<option value="${esc(g.id)}">${g.icon || '⭐'} ${esc(g.name)}</option>`).join('');
  sel.value = value || '';
  sel.title = 'Time on this ticket also counts toward this habit';
  sel.onchange = () => onChange(sel.value || null);
  return sel;
}

// The sprint for the week on the board, as To do / In progress / Done.
function renderTicketEditor() {
  const wk = planWeek;
  const inSprint = ticketList(state).filter((t) => t.sprint === wk);
  const ids = new Set(inSprint.map((t) => t.id));
  const cards = inSprint.filter((t) => !t.parentId || !ids.has(t.parentId)); // subtasks live inside their parent
  const sized = inSprint.filter((t) => t.sizeH > 0 && !t.parentId);
  $('#taskSum').textContent = inSprint.length
    ? `· ${cards.filter((t) => t.status === 'done').length}/${cards.length} done · ${round1(sized.reduce((a, t) => a + t.sizeH, 0))} h estimated · ${round1(cards.reduce((a, t) => a + loggedH(t.id), 0))} h spent`
    : '';
  const board = $('#kanban');
  board.innerHTML = '';
  for (const [status, label] of COLS) {
    const list = cards.filter((t) => t.status === status)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
    const hours = list.reduce((a, t) => a + (t.sizeH || 0), 0);
    const col = el('div', { className: `kcol k-${status}` });
    col.innerHTML = `<div class="kHead"><span class="kDot"></span>${label}<span class="kCount">${list.length}</span>${hours ? `<span class="kHours">${round1(hours)} h</span>` : ''}</div>`;
    const body = el('div', { className: 'kBody' });
    for (const t of list) body.append(ticketCard(t, { draggable: true }));
    if (!list.length) body.append(el('div', { className: 'kEmpty', textContent: status === 'done' ? 'Drop finished work here' : status === 'doing' ? 'Drag a card here when you start' : 'Nothing to do. Add one below' }));
    col.append(body);
    if (status === 'todo') {
      const input = el('input', { type: 'text', maxLength: 80, placeholder: wk > curWeek ? 'Plan a task for next week…' : 'Add a task…' });
      const form = el('form', { className: 'quickAdd small' }, el('span', { className: 'qaPlus', textContent: '＋' }), input);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        input.value = '';
        await addTicket({ title, habitId: timedHabits(wk).some((g) => g.id === 'work') ? 'work' : null, sprint: wk, planned: true });
        toast('Task added');
        setTimeout(() => board.querySelector('.k-todo .quickAdd input')?.focus(), 50);
      };
      col.append(form);
    }
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if (id && state.tickets[id]?.status !== status) {
        await updateTicket(id, { status });
        toast(status === 'done' ? 'Done 🎉' : `Moved to ${label}`);
      }
    };
    board.append(col);
  }
  // next week: what will carry over
  const carrying = wk > curWeek ? ticketList(state).filter((t) => t.sprint === curWeek && t.status !== 'done' && !t.parentId) : [];
  $('#carryNote').innerHTML = carrying.length
    ? `<div class="emptyLine" style="margin-top:10px">↪ <b>${carrying.length}</b> unfinished from this week will carry over by itself: ${carrying.map((t) => esc(t.title)).join(', ')}</div>` : '';
  // the backlog, to pull from
  const bl = backlogTickets(state).filter((t) => t.status !== 'done' && !(t.parentId && state.tickets[t.parentId]?.sprint == null));
  $('#planBacklogCount').textContent = `(${bl.length})`;
  const pb = $('#planBacklog');
  pb.innerHTML = '';
  if (!bl.length) pb.innerHTML = '<div class="emptyLine">The backlog is empty. Park future tasks in the <a href="#backlog">Backlog</a> tab.</div>';
  for (const t of bl) {
    const btn = el('button', { className: 'primary small kPull', textContent: '→ Add to sprint' });
    btn.onclick = async () => { await moveTicket(t.id, planWeek); toast('Added to the sprint'); };
    pb.append(ticketCard(t, { actions: el('div', { className: 'kActions' }, btn) }));
  }
}

// ================= BACKLOG =================

function renderBacklog() {
  const all = backlogTickets(state);
  const open = all.filter((t) => t.status !== 'done');
  $('#blCount').textContent = `${open.length} open · ${round1(open.reduce((a, t) => a + (t.sizeH || 0), 0))} h estimated`;
  const box = $('#blList');
  box.innerHTML = '';
  const tops = open.filter((t) => !t.parentId || state.tickets[t.parentId]?.sprint != null || !state.tickets[t.parentId]);
  tops.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
  if (!tops.length) box.innerHTML = '<div class="emptyLine">Nothing parked yet. Add future tasks above; open one to split it into subtasks.</div>';
  for (const t of tops) {
    const a = el('button', { className: 'small', textContent: '→ This sprint' });
    a.onclick = async () => { await moveTicket(t.id, curWeek); toast('Moved to this sprint'); };
    const b = el('button', { className: 'small', textContent: '→ Next' });
    b.onclick = async () => { await moveTicket(t.id, nextWeek); toast('Moved to next sprint'); };
    box.append(ticketCard(t, { actions: el('div', { className: 'kActions' }, a, b) }));
  }
}

$('#blForm').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('#blTitle').value.trim();
  if (!title) return;
  $('#blTitle').value = '';
  await addTicket({ title, sprint: null, planned: true });
  toast('Added to the backlog');
};

// ================= REWARDS =================

function renderRewards() {
  const L = ledger(state, today);
  $('#rwKpis').innerHTML = kpi(money(L.balance), 'balance to spend', L.balance < 0 ? 'neg' : '') + kpi(money(L.earned), 'earned so far') +
    kpi(money(L.spent), 'spent') + kpi(money(L.atStake), 'still in play this week');
  $('#rwRule').innerHTML = `Paid per week (Sat → Fri) when a habit hits 100% of its plan, from the week of ${fmt(REWARDS.startWeek)}. ` +
    REWARDS.rules.map((r) => `${esc(state.weeks[curWeek]?.goals.find((g) => g.id === r.goalId)?.name || r.goalId)} ${money(r.amount)}`).join(' · ') +
    '. Rules are set in <code>rewards.config.js</code>.';
  const cur = L.current;
  $('#rwWeek').innerHTML = cur
    ? '<tr><th>Habit</th><th>Reward</th><th>Status</th><th>This week</th></tr>' + cur.rows.map((r) => `<tr><td>${r.icon} ${esc(r.name)}</td>
        <td class="n"><b>${money(r.amount)}</b></td><td><span class="status st-${{ earned: 'done', locked: 'done', open: 'on', missed: 'missed', notPlanned: 'risk', tooEasy: 'risk' }[r.status]}">${REWARD_STATUS[r.status].icon} ${REWARD_STATUS[r.status].label}</span></td>
        <td class="small">${esc(r.text)}</td></tr>`).join('')
    : `<tr><td class="muted">Rewards start the week of ${fmt(REWARDS.startWeek)}.</td></tr>`;

  $('#rwMarket').innerHTML = REWARDS.marketplace.map((it) => {
    const can = L.balance >= it.price;
    const frac = Math.max(0, Math.min(1, L.balance / it.price));
    const owned = (state.purchases || []).filter((p) => p.itemId === it.id).length;
    return `<div class="item"><div class="ic">${it.icon}</div><b>${esc(it.name)}</b><div class="pr">${money(it.price)}</div>
      ${progress(frac)}<div class="small muted">${can ? 'You can afford this' : `${money(it.price - Math.max(0, L.balance))} to go`}${owned ? ` · bought ${owned}×` : ''}</div>
      <button class="${can ? 'primary' : ''}" data-buy="${esc(it.id)}" ${can ? '' : 'disabled'}>Buy</button></div>`;
  }).join('');
  $('#rwMarket').querySelectorAll('[data-buy]').forEach((b) => (b.onclick = async () => {
    const it = REWARDS.marketplace.find((x) => x.id === b.dataset.buy);
    if (!confirm(`Spend ${money(it.price)} of your rewards on ${it.name}? Balance after: ${money(L.balance - it.price)}.`)) return;
    await buyItem(it);
  }));

  $('#rwHistory').innerHTML = L.weeks.length
    ? '<tr><th>Week</th><th>Earned</th><th></th></tr>' + L.weeks.map((w) => `<tr><td>${weekLabel(w.wk)}${w.wk === curWeek ? ' <span class="pill">now</span>' : ''}</td>
        <td class="n"><b>${w.wk === curWeek && !w.earned ? '—' : money(w.earned)}</b></td>
        <td class="small">${w.rows.map((r) => `${REWARD_STATUS[r.status].icon} ${esc(r.name)}`).join(' · ')}</td></tr>`).join('')
    : '<tr><td class="muted">No weeks yet.</td></tr>';
  const ps = [...(state.purchases || [])].reverse();
  $('#rwPurchases').innerHTML = ps.length
    ? '<tr><th>Item</th><th>Price</th><th>When</th><th></th></tr>' + ps.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${money(p.price)}</td>
        <td class="small">${new Date(p.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td><button class="ghost" data-undo="${esc(p.id)}" title="Undo this purchase and get the money back">Undo</button></td></tr>`).join('')
    : '<tr><td class="muted">Nothing bought yet.</td></tr>';
  $('#rwPurchases').querySelectorAll('[data-undo]').forEach((b) => (b.onclick = async () => {
    if (confirm('Undo this purchase? The money goes back to your balance.')) await undoPurchase(b.dataset.undo);
  }));
}

// ================= TRENDS =================

function renderTrends() {
  const a7 = rollingAvg(state, today, 7);
  const a28 = rollingAvg(state, today, 28);
  const procrast7 = lastNDays(today, 7).map((k) => state.days[k]?.values?.['work.procrastination']).filter((v) => v != null);
  const pAvg = procrast7.length ? Math.round(procrast7.reduce((a, b) => a + Number(b), 0) / procrast7.length) : null;
  $('#kpis').innerHTML = [
    kpi(a7 ?? '—', '7-day avg', `band ${band(a7)}`),
    kpi(a28 ?? '—', '28-day avg', `band ${band(a28)}`),
    kpi(streak(state, today), 'check-in streak 🔥'),
    kpi(pAvg == null ? '—' : `${pAvg} min`, 'procrastination / day (7d)'),
    kpi((() => { const t = sessionTotals(lastNDays(today, 7), state); return t.avgStartMin == null ? '—' : hm(t.avgStartMin); })(), 'avg time to start a task (7d)'),
    kpi(hm(sessionTotals(lastNDays(today, 7), state).workMin), 'timed work (7d)'),
  ].join('');

  const chart = $('#chart');
  chart.innerHTML = '';
  for (const k of lastNDays(today, 28)) {
    const sc = dayScore(k, state)?.score ?? null;
    const col = document.createElement('div');
    col.className = 'col';
    col.title = `${fmt(k)}: ${sc ?? 'no check-in'}`;
    const d = parseKey(k);
    col.innerHTML = `<div class="b fill-${band(sc)}" style="height:${sc ?? 0}%"></div><span>${d.getDay() === 6 ? fmt(k) : d.getDate()}</span>`;
    chart.append(col);
  }

  // previous weeks
  const pctCell = (p, title = '') => `<td class="n" title="${esc(title)}"><b class="band ${band(p)}">${p ?? '—'}</b></td>`;
  let rows = '';
  for (let i = 0; i < 8; i++) {
    const wk = dateKey(addDays(parseKey(curWeek), -7 * i));
    const plan = state.weeks[wk];
    const s = weekSummary(wk, state, today);
    if (!plan && !s.checkins) continue;
    const goals = plan?.goals || [];
    const presetCells = PRESETS.map((p) => {
      const g = goals.find((x) => x.preset && x.id === p.id);
      if (!g) return '<td class="muted">off</td>';
      const detail = g.metrics.map((m) => `${metricName(m)}: ${metricWeek(g, m, wk, state, today).text}`).join(' · ');
      return pctCell(goalWeekAvg(g, wk, state, today), detail);
    }).join('');
    const adhoc = goals.filter((g) => !g.preset);
    const adhocPcts = adhoc.map((g) => goalWeekAvg(g, wk, state, today)).filter((v) => v != null);
    const adhocCell = adhoc.length
      ? pctCell(adhocPcts.length ? Math.round(adhocPcts.reduce((a, b) => a + b, 0) / adhocPcts.length) : null, adhoc.map((g) => g.name).join(', '))
      : '<td class="muted">—</td>';
    rows += `<tr><td>${i === 0 ? '<b>This week</b><br>' : ''}<span class="small">${weekLabel(wk)}</span></td>
      <td class="n"><b class="band ${band(s.avg)}">${s.avg ?? '—'}</b></td>
      <td class="n">${s.greenDays}/${s.checkins}</td>${presetCells}${adhocCell}
      <td class="n">${s.procrastAvg == null ? '—' : `${s.procrastAvg} min`}</td>
      ${(() => { const t = sessionTotals(weekDays(wk), state); return `<td class="n">${t.count ? hm(t.avgStartMin) : '—'}</td><td class="n">${t.count ? hm(t.workMin) : '—'}</td>`; })()}
      ${(() => { const sized = sprintTickets(wk, state, today).filter((t) => t.estimateH != null); if (!sized.length) return '<td class="n">—</td>'; const e = sized.reduce((a, t) => a + t.estimateH, 0); const l = sized.reduce((a, t) => a + t.loggedH, 0); return `<td class="n">${round1(l)} / ${round1(e)} h <span class="small muted">${Math.round((100 * l) / e)}%</span></td>`; })()}</tr>`;
  }
  $('#weekTable').innerHTML =
    `<tr><th>Week</th><th>Score</th><th>Thriving</th>${PRESETS.map((p) => `<th>${p.icon} ${p.name}</th>`).join('')}<th>⭐ Ad hoc</th><th>Procrast. / day</th> <th>⏱ Avg to start</th><th>⏱ Timed work</th><th>🎫 Logged / size</th></tr>` +
    (rows || `<tr><td colspan="${PRESETS.length + 8}" class="muted">No weeks yet.</td></tr>`);

  // by goal (continuous)
  const g7 = goalAvgs(state, today, 7);
  const g28 = goalAvgs(state, today, 28);
  const cell = (v) => `<td class="n"><b class="band ${band(v)}">${v ?? '—'}</b></td>`;
  $('#goalTable').innerHTML =
    '<tr><th>Goal</th><th>7 days</th><th>28 days</th></tr>' +
    ([...g28.keys()]
      .map((k) => `<tr><td>${g28.get(k).goal.icon || '⭐'} ${esc(g28.get(k).goal.name)} <span class="tags">${tagChips(goalTags(g28.get(k).goal), state.settings.tags)}</span></td>${cell(g7.get(k)?.avg ?? null)}${cell(g28.get(k).avg)}</tr>`)
      .join('') || '<tr><td colspan="3" class="muted">No check-ins yet.</td></tr>');

  const t7 = tagAvgs(state, today, 7);
  const t28 = tagAvgs(state, today, 28);
  $('#tagTable').innerHTML =
    '<tr><th>Tag</th><th>7 days</th><th>28 days</th></tr>' +
    (state.settings.tags
      .filter((t) => t28.has(t.id))
      .map((t) => `<tr><td>${tagChip(t)}</td>${cell(t7.get(t.id) ?? null)}${cell(t28.get(t.id))}</tr>`)
      .join('') || '<tr><td colspan="3" class="muted">No tagged check-ins yet.</td></tr>');

  $('#why28').innerHTML = whyTable(lastNDays(today, 28));
  renderImpact();
  $('#reasons28').innerHTML = reasonsHtml(reasonsIn(lastNDays(today, 28), state).slice(0, 30));
  $('#reflections28').innerHTML = reflectionsHtml(lastNDays(today, 28));
}

function renderImpact() {
  const rows = behaviourImpact(state, today, 28);
  const pair = (a, b, unit, better) => (a == null || b == null ? '—' : `<b>${a}</b> vs ${b}${unit} ${deltaHtml(a, b, better, unit === ' h' ? 'h' : unit === '%' ? '%' : 'min')}`);
  $('#impactTable').innerHTML = '<tr><th>Behaviour</th><th>Days with / without</th><th>Median time to start</th><th>Focus hours</th><th>% procrastinating</th></tr>' +
    rows.map((x) => `<tr><td>${x.label}</td><td class="n">${x.withDays} / ${x.withoutDays}</td>${x.enough
      ? `<td>${pair(x.startWith, x.startWithout, ' min', -1)}</td><td>${pair(x.focusWith, x.focusWithout, ' h', 1)}</td><td>${pair(x.procrastWith, x.procrastWithout, '%', -1)}</td>`
      : `<td colspan="3" class="small muted">needs ${x.need} more day${x.need > 1 ? 's' : ''} of data</td>`}</tr>`).join('');
  const rs = (n) => {
    const v = lastNDays(today, n).map((k) => readinessScore(state.days[k]?.readiness, state.settings.sleepTarget)).filter((x) => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const sl = lastNDays(today, 7).map((k) => state.days[k]?.readiness?.sleepH).filter((x) => x != null);
  $('#readinessKpis').innerHTML = kpi(rs(7) ?? '—', 'readiness, 7-day avg', `band ${band(rs(7))}`) + kpi(rs(28) ?? '—', 'readiness, 28-day avg', `band ${band(rs(28))}`) +
    kpi(sl.length ? `${round1(sl.reduce((a, b) => a + b, 0) / sl.length)} h` : '—', `sleep, 7-day avg (target ${state.settings.sleepTarget} h)`);
}

// ================= SETTINGS =================

let notifDraft = {};
function renderSettings() {
  const s = state.settings;
  $('#sRemind').value = s.reminderTime;
  $('#sPlan').value = s.planTime;
  $('#sMorning').value = s.morningTime;
  notifDraft = { morningOn: s.morningOn !== false, cuesOn: s.cuesOn !== false, checkinOn: s.checkinOn !== false, planOn: s.planOn !== false };
  for (const [slot, key] of [['#swMorning', 'morningOn'], ['#swCues', 'cuesOn'], ['#swCheckin', 'checkinOn'], ['#swPlan', 'planOn']]) {
    const row = $(slot).closest('.notifRow');
    row.classList.toggle('off', !notifDraft[key]);
    $(slot).replaceChildren(switchEl(notifDraft[key], (v) => { notifDraft[key] = v; row.classList.toggle('off', !v); }));
  }
  const cues = (state.weeks[curWeek]?.goals || []).filter((g) => g.cueTime);
  $('#cueCount').textContent = cues.length ? cues.map((g) => `${g.icon || '⭐'} ${g.cueTime}`).join(' · ') : 'none set yet';
  $('#sTimer').value = s.sessionMinutes;
  $('#sAskWhy').value = s.askWhyMinutes;
  $('#sSleep').value = s.sleepTarget;
  $('#sBlock').value = s.blockList.join('\n');
  $('#sEnv').value = s.envChecklist.join('\n');
  renderBackups();
  renderTagEditor();
  renderAccount($('#accountBox'));
}

let tagDraft = [];
function renderTagEditor() {
  tagDraft = structuredClone(state.settings.tags);
  drawTagEditor();
}
function drawTagEditor() {
  const box = $('#tagEditor');
  box.innerHTML = '';
  tagDraft.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '6px';
    const color = Object.assign(document.createElement('input'), { type: 'color', value: t.color, title: 'Colour' });
    color.style.cssText = 'width:38px;height:32px;padding:2px;border-radius:8px;border:1px solid var(--line);background:#fff';
    const name = Object.assign(document.createElement('input'), { type: 'text', value: t.name, maxLength: 30 });
    const preview = document.createElement('span');
    preview.style.cssText = 'min-width:140px;flex:none';
    preview.innerHTML = tagChip(t);
    color.oninput = () => { t.color = color.value; preview.innerHTML = tagChip(t); };
    name.oninput = () => { t.name = name.value; preview.innerHTML = tagChip(t); };
    const rm = Object.assign(document.createElement('button'), { className: 'ghost', textContent: '✕', title: 'Delete tag' });
    rm.onclick = () => { tagDraft.splice(i, 1); drawTagEditor(); };
    row.append(color, name, preview, rm);
    box.append(row);
  });
}
$('#addTagBtn').onclick = () => {
  tagDraft.push({ id: `t-${Date.now().toString(36)}`, name: 'New tag', color: TAG_PALETTE[tagDraft.length % TAG_PALETTE.length] });
  drawTagEditor();
  const inputs = document.querySelectorAll('#tagEditor input[type=text]');
  inputs[inputs.length - 1]?.select();
};

$('#saveSettings').onclick = async () => {
  state.settings = {
    ...state.settings,
    reminderTime: $('#sRemind').value || DEFAULT_SETTINGS.reminderTime,
    morningTime: $('#sMorning').value || DEFAULT_SETTINGS.morningTime,
    ...notifDraft,
    planTime: $('#sPlan').value || DEFAULT_SETTINGS.planTime,
    askWhyMinutes: $('#sAskWhy').value === '' ? DEFAULT_SETTINGS.askWhyMinutes : Math.max(0, Number($('#sAskWhy').value)),
    sleepTarget: Number($('#sSleep').value) >= 4 ? Number($('#sSleep').value) : DEFAULT_SETTINGS.sleepTarget,
    blockList: $('#sBlock').value.split('\n').map((x) => x.trim()).filter(Boolean),
    envChecklist: $('#sEnv').value.split('\n').map((x) => x.trim()).filter(Boolean),
    sessionMinutes: Number($('#sTimer').value) >= 5 ? Math.round(Number($('#sTimer').value)) : DEFAULT_SETTINGS.sessionMinutes,
    tags: tagDraft.filter((t) => t.name.trim()).map((t) => ({ ...t, name: t.name.trim() })),
  };
  await save({ settings: state.settings });
  flash($('#settingsMsg'), 'Saved ✓');
};

async function renderBackups() {
  const list = await listBackups();
  $('#backupTable').innerHTML = list.length
    ? '<tr><th>When</th><th>Why</th><th>Size</th><th></th></tr>' + list.map((b) => `<tr>
        <td>${new Date(b.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
        <td>${esc(b.reason)}</td><td class="n small">${Math.max(1, Math.round(b.bytes / 1024))} KB</td>
        <td style="white-space:nowrap"><button class="ghost" data-dl="${b.id}">Download</button><button class="ghost" data-restore="${b.id}">Restore</button></td></tr>`).join('')
    : '<tr><td class="muted">No backups yet.</td></tr>';
  $('#backupTable').querySelectorAll('[data-dl]').forEach((btn) => (btn.onclick = async () => {
    const raw = await backupData(btn.dataset.dl);
    const b = list.find((x) => x.id === btn.dataset.dl);
    downloadJson(raw, `odyssey-backup-${dateKey(new Date(b.at))}-${b.reason.replace(/\W+/g, '-')}.json`);
  }));
  $('#backupTable').querySelectorAll('[data-restore]').forEach((btn) => (btn.onclick = async () => {
    const b = list.find((x) => x.id === btn.dataset.restore);
    if (!confirm(`Restore the backup from ${new Date(b.at).toLocaleString()} (${b.reason})? Your current data is backed up first.`)) return;
    await restoreBackup(b.id);
    state = await load();
    showTab();
    flash($('#settingsMsg'), 'Restored ✓');
  }));
}
$('#backupNow').onclick = async () => { await snapshot('manual'); renderBackups(); };

function downloadJson(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#exportBtn').onclick = async () => {
  const data = withoutDeviceKeys(await chrome.storage.local.get(null));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `odyssey-backup-${today}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data !== 'object' || !data || !(data.schemaVersion >= 3)) throw new Error('not a Odyssey backup');
    if (!confirm('Replace all current data with this file? A backup of the current data is kept first.')) return;
    await snapshot('before import');
    await replaceAll(data);
    state = await load();
    flash($('#settingsMsg'), 'Imported ✓');
    renderSettings();
  } catch (err) {
    alert(`Couldn't import: ${err.message}`);
  }
  e.target.value = '';
};

$('#resetBtn').onclick = async () => {
  const signedIn = !!(await chrome.storage.local.get('auth')).auth;
  if (!confirm(`Erase all check-ins, plans, tickets, sessions and settings?${signedIn ? ' You are signed in, so this erases them on your other devices too.' : ''} A backup is kept under Backups on this computer, where you can restore it.`)) return;
  await snapshot('before erase');
  await replaceAll({ schemaVersion: (await chrome.storage.local.get('schemaVersion')).schemaVersion });
  state = await load();
  showTab();
};

init();
