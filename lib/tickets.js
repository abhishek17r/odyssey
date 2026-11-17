// Tasks shared by the dashboard and the app: the task card and the task sheet (a drawer with title,
// status, estimate, deadline, habit, tags, subtasks, numbers, calendar, move / delete).
// Call setTicketContext({ getState }) once; everything reads the current state through it.

import {
  dueInfo, ticketList, ticketTitle, TICKET_STATUS, ticketTime, round1, dateKey, addDays, parseKey, weekKeyOf,
  sessionsIn, TAG_PALETTE,
} from './score.js';
import { updateTicket, addTicket, moveTicket, deleteTicket, load, save } from './storage.js';
import { timedHabits as timedHabitsFor } from './targets.js';
import { el, stepper, checkBtn, openDrawer, toast } from './controls.js';
import { esc, tagChip } from './ui.js';
import { gcalUrl, nextSlot, openUrl } from './gcal.js';

let ctx = { getState: () => ({ tickets: {}, sessions: {}, settings: { tags: [] }, weeks: {} }) };
export function setTicketContext(c) { ctx = c; }
const S = () => ctx.getState();

const today = dateKey();
const curWeek = weekKeyOf(today);
const nextWeek = dateKey(addDays(parseKey(curWeek), 7));
const fmt = (k) => parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const timedHabits = (wk) => timedHabitsFor(wk, S());

function habitSelect(wk, value, onChange) {
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">No habit</option>' +
    timedHabits(wk).map((g) => `<option value="${esc(g.id)}">${g.icon || '⭐'} ${esc(g.name)}</option>`).join('');
  sel.value = value || '';
  sel.title = 'Time on this task also counts toward this habit';
  sel.onchange = () => onChange(sel.value || null);
  return sel;
}

async function addTag(name = prompt('New tag name')) {
  name = (name || '').trim();
  if (!name) return null;
  const state = S();
  const existing = state.settings.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const fresh = await load();
  const tags = fresh.settings.tags;
  const tag = { id: `t-${Date.now().toString(36)}`, name, color: TAG_PALETTE[tags.length % TAG_PALETTE.length] };
  tags.push(tag);
  await save({ settings: { ...fresh.settings, tags } });
  return tag;
}

function tagPicker(d) {
  const row = el('div', { className: 'tags' });
  const draw = () => {
    row.innerHTML = S().settings.tags.map((t) => tagChip(t, { off: !d.tags.includes(t.id), attrs: `data-tag="${esc(t.id)}"` })).join('') +
      '<span class="tag off" style="--c:#a2a7b8" data-new="1">+ New tag</span>';
    row.querySelectorAll('[data-tag]').forEach((x) => (x.onclick = () => {
      const id = x.dataset.tag;
      d.tags = d.tags.includes(id) ? d.tags.filter((y) => y !== id) : [...d.tags, id];
      d.onTags?.(d.tags);
      draw();
    }));
    row.querySelector('[data-new]').onclick = async () => { const t = await addTag(); if (t) { d.tags = [...d.tags, t.id]; d.onTags?.(d.tags); draw(); } };
  };
  draw();
  return row;
}

// Hours on a ticket: timer time, or its estimate once done without the timer.
export const loggedH = (id) => { const state = S(); return state.tickets[id] ? ticketTime(state.tickets[id], state).h : 0; };
export const isAuto = (id) => { const state = S(); return !!state.tickets[id] && ticketTime(state.tickets[id], state).auto; };
export const kidsOf = (t) => ticketList(S()).filter((x) => x.parentId === t.id).sort((a, b) => a.createdAt - b.createdAt);

export const COLS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];

// A ticket card for the Kanban and the backlog. Click opens the drawer.
export function ticketCard(t, { draggable = false, actions = null } = {}) {
  const state = S();
  const parent = t.parentId && state.tickets[t.parentId];
  const kids = kidsOf(t);
  const lh = loggedH(t.id);
  const habit = t.habitId && timedHabits(t.sprint || curWeek).find((g) => g.id === t.habitId);
  const tags = (t.tags || []).map((id) => state.settings.tags.find((x) => x.id === id)).filter(Boolean);
  const card = el('div', { className: `kcard ${t.status === 'done' ? 'isDone' : ''}`, draggable, tabIndex: 0 });
  card.dataset.id = t.id;
  const d = t.status !== 'done' && dueInfo(t, today);
  const auto = isAuto(t.id);
  card.innerHTML = `${parent ? `<div class="kParent">${esc(parent.title)} ›</div>` : ''}<div class="kTitle">${esc(t.title)}</div>
    <div class="kMeta">${auto ? `<span class="kChip" title="Done without the timer: the estimate counts as time spent">⏱ ${round1(lh)} h est.</span>` : t.sizeH ? `<span class="kChip" title="Timer hours / estimate">⏱ ${round1(lh)}/${t.sizeH} h</span>` : lh ? `<span class="kChip">⏱ ${round1(lh)} h</span>` : ''}
      ${d ? `<span class="due ${d.cls}">${esc(d.text)}</span>` : ''}
      ${kids.length ? `<span class="kChip">☑ ${kids.filter((k) => k.status === 'done').length}/${kids.length}</span>` : ''}
      ${(t.sprints || []).length > 1 && t.sprint ? `<span class="kChip" title="Carried over">↪ ${(t.sprints || []).length - 1}×</span>` : ''}
      ${t.planned === false && t.sprint ? '<span class="kChip warn">unplanned</span>' : ''}
      <span class="kEnd">${tags.map((x) => `<i class="tdot" style="--c:${esc(x.color)}" title="${esc(x.name)}"></i>`).join('')}${habit ? `<span title="Counts toward ${esc(habit.name)}">${habit.icon || '⭐'}</span>` : ''}</span></div>
    ${t.sizeH ? `<div class="miniBar"><i style="width:${Math.min(100, (100 * lh) / t.sizeH)}%"></i></div>` : ''}`;
  if (actions) card.append(actions);
  card.onclick = (e) => { if (!e.target.closest('button')) openTicket(t.id); };
  card.onkeydown = (e) => { if (e.key === 'Enter') openTicket(t.id); };
  if (draggable) {
    card.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.id); card.classList.add('dragging'); };
    card.ondragend = () => card.classList.remove('dragging');
  }
  return card;
}

// ---------- the task sheet (drawer) ----------

let drawerTicket = null;
export function openTicket(id) {
  const state = S();
  drawerTicket = id;
  const body = el('div', { className: 'tDrawer' });
  fillTicketPanel(body, id);
  openDrawer(state.tickets[id]?.parentId ? 'Subtask' : 'Task', body, { onClose: () => { drawerTicket = null; } });
}
// Redraw the open drawer after a change, unless you're typing in it.
export function refreshDrawer() {
  const state = S();
  const body = document.querySelector('.drawer .tDrawer');
  if (!body || !drawerTicket) return;
  if (!state.tickets[drawerTicket]) { document.querySelector('.drawerX')?.click(); return; }
  const a = document.activeElement;
  const typing = body.contains(a) && a.matches('input[type=text], textarea');
  if (typing && a.value.trim() && !a.closest('.quickAdd')) return; // don't wipe what's being typed
  if (typing && a.closest('.quickAdd') && a.value.trim()) return;
  const refocus = typing && a.closest('.quickAdd');
  fillTicketPanel(body, drawerTicket);
  if (refocus) body.querySelector('.quickAdd input')?.focus();
}

function fillTicketPanel(body, id) {
  const state = S();
  const t = state.tickets[id];
  body.innerHTML = '';
  const field = (label, ...kids) => el('div', { className: 'field' }, el('div', { className: 'lbl', textContent: label }), ...kids);
  const parent = t.parentId && state.tickets[t.parentId];
  if (parent) {
    const a = el('a', { textContent: `‹ ${parent.title}` });
    a.onclick = () => openTicket(parent.id);
    body.append(el('div', { className: 'small', style: 'margin-bottom:8px' }, a));
  }
  const title = el('textarea', { className: 'tBig', rows: 1, maxLength: 80, value: t.title });
  title.onchange = () => title.value.trim() && updateTicket(id, { title: title.value.trim() });
  title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
  body.append(title);

  // status
  const seg = el('div', { className: 'seg statusSeg' });
  for (const [k, label] of COLS) {
    const b = el('button', { type: 'button', textContent: `${TICKET_STATUS[k].icon} ${label}`, className: t.status === k ? `on-${k}` : '' });
    b.onclick = () => updateTicket(id, { status: k });
    seg.append(b);
  }
  body.append(field('Status', seg));

  // size + due side by side
  const size = stepper({ value: t.sizeH ?? null, step: 0.5, unit: 'h', onChange: (v) => updateTicket(id, { sizeH: v > 0 ? v : null }) });
  const due = el('input', { type: 'date', value: t.due || '' });
  due.onchange = () => updateTicket(id, { due: due.value || null });
  const quick = el('div', { className: 'chips' });
  const fri = dateKey(addDays(parseKey(curWeek), 6));
  for (const [label, k] of [['Today', today], ['Tomorrow', dateKey(addDays(parseKey(today), 1))], ['Friday', fri], ['None', null]]) {
    const b = el('button', { type: 'button', className: `chip ${t.due === k || (!t.due && !k) ? 'on' : ''}`, textContent: label });
    b.onclick = () => updateTicket(id, { due: k });
    quick.append(b);
  }
  const pDue = parent?.due;
  const warn = pDue && t.due && t.due > pDue ? el('div', { className: 'hint', style: 'color:var(--red)', textContent: `After the parent's deadline (${fmt(pDue)})` }) : null;
  const estHint = el('div', { className: 'hint', textContent: 'Optional. Done without the timer? This counts as time spent.' });
  body.append(el('div', { className: 'twoCol' }, field('Estimate (hours)', size, estHint), field('Deadline', due, quick, warn)));

  body.append(field('Time counts toward', habitSelect(t.sprint || curWeek, t.habitId, (v) => updateTicket(id, { habitId: v }))));
  const tp = tagPicker({ tags: [...(t.tags || [])], onTags: (tags) => updateTicket(id, { tags }) });
  body.append(field('Tags', tp));

  // subtasks as a checklist
  if (!t.parentId) {
    const list = el('div', { className: 'checklist' });
    const kids = kidsOf(t);
    for (const c of kids) {
      const chk = checkBtn({ state: c.status === 'done' ? true : null, title: 'Done', onChange: (v) => updateTicket(c.id, { status: v ? 'done' : 'todo' }) });
      const name = el('a', { className: `clTitle ${c.status === 'done' ? 'struck' : ''}`, textContent: c.title, title: 'Open subtask' });
      name.onclick = () => openTicket(c.id);
      const meta = el('span', { className: 'small muted' });
      const cd = c.status !== 'done' && dueInfo(c, today);
      meta.innerHTML = `${c.sizeH ? `${c.sizeH} h` : ''}${cd ? ` <span class="due ${cd.cls}">${esc(cd.text)}</span>` : ''}${c.sprint !== t.sprint ? ` · ${c.sprint ? 'in another sprint' : 'in backlog'}` : ''}`;
      list.append(el('div', { className: 'clRow' }, chk, name, meta));
    }
    const input = el('input', { type: 'text', maxLength: 80, placeholder: 'Add a subtask and press Enter' });
    const form = el('form', { className: 'quickAdd small' }, el('span', { className: 'qaPlus', textContent: '＋' }), input);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      await addTicket({ title: name, parentId: t.id, habitId: t.habitId, sprint: t.sprint ?? null, tags: t.tags, planned: t.planned });
      setTimeout(() => document.querySelector('.drawer .checklist + .quickAdd input, .drawer .quickAdd input')?.focus(), 80);
    };
    body.append(field(`Subtasks${kids.length ? ` · ${kids.filter((k) => k.status === 'done').length}/${kids.length}` : ''}`, list, form));
  }

  // numbers
  const lh = loggedH(id);
  const n = sessionsIn(Object.keys(state.sessions || {}), state).filter((x) => x.ticketId === id).length;
  const carried = (t.sprints || []).length - (t.sprint ? 1 : 0);
  body.append(field('So far', el('div', { className: 'statRow', innerHTML:
    `<div><b>${round1(lh)} h</b><span>${isAuto(id) ? 'estimated' : 'on the timer'}</span></div><div><b>${t.sizeH ? `${Math.round((100 * lh) / t.sizeH)}%` : '—'}</b><span>of estimate</span></div><div><b>${n}</b><span>sessions</span></div><div><b>${carried > 0 ? `${carried}×` : '—'}</b><span>carried over</span></div>` })));

  // where it lives + delete
  const acts = el('div', { className: 'drawerActions' });
  const mv = (label, wk, primary = false) => {
    const b = el('button', { type: 'button', className: primary ? 'primary' : '', textContent: label });
    b.onclick = async () => { await moveTicket(id, wk); toast(wk ? 'Moved to the sprint' : 'Moved to the backlog'); };
    acts.append(b);
  };
  if (t.sprint == null) { mv('→ This sprint', curWeek, true); mv('→ Next sprint', nextWeek); }
  else if (t.status !== 'done') {
    if (t.sprint === curWeek) mv('→ Next sprint', nextWeek);
    mv('↩ Backlog', null);
  }
  const calRow = el('div', { className: 'chips', style: 'margin:0 0 12px' });
  const block = el('button', { type: 'button', className: 'chip calBtn', textContent: `📅 Block ${t.sizeH ? `${t.sizeH} h` : 'time'} in Calendar`, title: 'Opens Google Calendar with a focus block for this task (change the time there)' });
  block.onclick = () => openUrl(gcalUrl({ title: `🎯 ${ticketTitle(t, state)}`, details: `Focus block from Odyssey${t.due ? ` · due ${t.due}` : ''}`, start: nextSlot(), minutes: Math.round((t.sizeH || 1) * 60) }));
  calRow.append(block);
  if (t.due) {
    const dl = el('button', { type: 'button', className: 'chip calBtn', textContent: '📅 Deadline in Calendar', title: 'All-day event on the deadline' });
    dl.onclick = () => openUrl(gcalUrl({ title: `📌 Due: ${ticketTitle(t, state)}`, details: 'Deadline from Odyssey', day: t.due }));
    calRow.append(dl);
  }
  body.append(field('Google Calendar', calRow));
  const del = el('button', { type: 'button', className: 'ghost dangerBtn', textContent: '🗑 Delete' });
  del.onclick = async () => {
    if (!confirm(`Delete “${t.title}”${t.parentId ? '' : ' and its subtasks'}? Its sessions stay, without a ticket.`)) return;
    await deleteTicket(id);
    document.querySelector('.drawerX')?.click();
    toast('Deleted');
  };
  acts.append(del);
  body.append(acts);
  requestAnimationFrame(() => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; });
}

