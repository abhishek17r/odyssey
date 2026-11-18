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
import { whenPatch, whenOf, WHEN_CHOICES, SIZE_CHOICES, sizeText } from './when.js';

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
  const chip = (label, on, onClick) => { const b = el('button', { type: 'button', className: `chip ${on ? 'on' : ''}`, textContent: label, ariaPressed: String(!!on) }); b.onclick = onClick; return b; };
  const parent = t.parentId && state.tickets[t.parentId];

  // every change saves as you go; Done closes
  const done = el('button', { type: 'button', className: 'primary tDone', textContent: 'Done' });
  done.onclick = () => { document.activeElement?.blur?.(); setTimeout(() => document.querySelector('.drawerX')?.click(), 30); };
  const top = el('div', { className: 'tTop' }, el('span', { className: 'tSaved', textContent: '✓ Saved' }), el('span', { style: 'flex:1' }), done);
  if (parent) {
    const a = el('a', { className: 'tParent', textContent: `‹ ${parent.title}` });
    a.onclick = () => openTicket(parent.id);
    top.prepend(a);
  }
  body.append(top);

  const title = el('textarea', { className: 'tBig', rows: 1, maxLength: 80, value: t.title, ariaLabel: 'Title' });
  let tt = null;
  const saveTitle = () => { clearTimeout(tt); const v = title.value.trim(); if (v && v !== S().tickets[id]?.title) updateTicket(id, { title: v }); };
  title.oninput = () => { clearTimeout(tt); tt = setTimeout(saveTitle, 700); title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
  title.onchange = saveTitle;
  title.onblur = saveTitle;
  title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
  body.append(title);

  // status
  const seg = el('div', { className: 'seg statusSeg' });
  for (const [k, label] of COLS) {
    const b = el('button', { type: 'button', textContent: label, className: t.status === k ? `on on-${k}` : '' });
    b.onclick = () => updateTicket(id, { status: k });
    seg.append(b);
  }
  body.append(seg);

  // when: Today / Tomorrow / This week / Later, or a date
  if (!parent) {
    const w = whenOf(t, today);
    const setWhen = async (choice) => {
      const p = whenPatch(choice, today);
      if ((p.sprint ?? null) !== (S().tickets[id].sprint ?? null)) await moveTicket(id, p.sprint);
      await updateTicket(id, { due: p.due });
    };
    const chips = el('div', { className: 'chips whenChips' });
    for (const [k, label] of WHEN_CHOICES) chips.append(chip(label, w === k, () => setWhen(k)));
    const date = el('input', { type: 'date', className: `chipDate ${w === 'date' ? 'on' : ''}`, value: w === 'date' ? t.due : '', ariaLabel: 'Pick a date' });
    date.onchange = () => date.value && setWhen(date.value);
    chips.append(date);
    body.append(field(w === 'date' ? `When · ${fmt(t.due)}` : 'When', chips));
  } else {
    const due = el('input', { type: 'date', value: t.due || '' });
    due.onchange = () => updateTicket(id, { due: due.value || null });
    const pDue = parent.due;
    const warn = pDue && t.due && t.due > pDue ? el('div', { className: 'hint', style: 'color:var(--red)', textContent: `After the parent's deadline (${fmt(pDue)})` }) : null;
    body.append(field('Deadline', due, warn));
  }

  // how long
  const lh = loggedH(id);
  const sizes = el('div', { className: 'chips sizeChips' });
  const known = SIZE_CHOICES.some(([h]) => h === t.sizeH);
  for (const [h, label] of SIZE_CHOICES) sizes.append(chip(label, t.sizeH === h, () => updateTicket(id, { sizeH: t.sizeH === h ? null : h })));
  const other = stepper({ value: known ? null : t.sizeH ?? null, step: 0.5, unit: 'h', size: 'sm', onChange: (v) => updateTicket(id, { sizeH: v > 0 ? v : null }) });
  other.classList.add('sizeOther');
  sizes.append(other);
  body.append(field(`How long${lh ? ` · ${round1(lh)} h done` : ''}`, sizes));

  // steps (subtasks) as a checklist
  if (!t.parentId) {
    const list = el('div', { className: 'checklist' });
    const kids = kidsOf(t);
    for (const c of kids) {
      const chk = checkBtn({ state: c.status === 'done' ? true : null, title: 'Done', onChange: (v) => updateTicket(c.id, { status: v ? 'done' : 'todo' }) });
      const name = el('a', { className: `clTitle ${c.status === 'done' ? 'struck' : ''}`, textContent: c.title, title: 'Open this step' });
      name.onclick = () => openTicket(c.id);
      list.append(el('div', { className: 'clRow' }, chk, name));
    }
    const input = el('input', { type: 'text', maxLength: 80, placeholder: 'Add a step', enterKeyHint: 'done' });
    const add = el('button', { type: 'button', className: 'qaAdd', textContent: 'Add' });
    const form = el('form', { className: 'quickAdd small stepAdd' }, el('span', { className: 'qaPlus', textContent: '＋' }), input, add);
    add.onclick = () => form.requestSubmit();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      await addTicket({ title: name, parentId: t.id, habitId: t.habitId, sprint: t.sprint ?? null, tags: t.tags, planned: t.planned });
      setTimeout(() => document.querySelector('.drawer .stepAdd input')?.focus(), 80);
    };
    body.append(field(`Steps${kids.length ? ` · ${kids.filter((k) => k.status === 'done').length} of ${kids.length}` : ''}`, list, form));
  }

  // less-used details fold away under "More"
  const more = el('details', { className: 'tMore' }, el('summary', { textContent: 'More: if it’s missed, a habit, tags, calendar' }));
  if (!t.parentId) {
    const lossIn = el('input', { type: 'text', className: 'iosInput', maxLength: 80, value: t.loss || '', placeholder: 'e.g. ₹1,500 late fee' });
    lossIn.onchange = () => updateTicket(id, { loss: lossIn.value.trim() || null });
    more.append(field('If it’s missed… (makes it a hard deadline)', lossIn));
    if (t.loss) more.open = true;
  }
  more.append(field('Time counts toward', habitSelect(t.sprint || curWeek, t.habitId, (v) => updateTicket(id, { habitId: v }))));
  const tp = tagPicker({ tags: [...(t.tags || [])], onTags: (tags) => updateTicket(id, { tags }) });
  more.append(field('Tags', tp));
  const n = sessionsIn(Object.keys(state.sessions || {}), state).filter((x) => x.ticketId === id).length;
  const carried = (t.sprints || []).length - (t.sprint ? 1 : 0);
  more.append(field('So far', el('div', { className: 'statRow', innerHTML:
    `<div><b>${round1(lh)} h</b><span>${isAuto(id) ? 'estimated' : 'on the timer'}</span></div><div><b>${t.sizeH ? `${Math.round((100 * lh) / t.sizeH)}%` : '—'}</b><span>of estimate</span></div><div><b>${n}</b><span>sessions</span></div><div><b>${carried > 0 ? `${carried}×` : '—'}</b><span>carried over</span></div>` })));
  const calRow = el('div', { className: 'chips', style: 'margin:0 0 12px' });
  const block = el('button', { type: 'button', className: 'chip calBtn', textContent: `Block ${t.sizeH ? sizeText(t.sizeH) : 'time'} in Google Calendar`, title: 'Opens Google Calendar with a focus block for this task (change the time there)' });
  block.onclick = () => openUrl(gcalUrl({ title: `🎯 ${ticketTitle(t, state)}`, details: `Focus block from Odyssey${t.due ? ` · due ${t.due}` : ''}`, start: nextSlot(), minutes: Math.round((t.sizeH || 1) * 60) }));
  calRow.append(block);
  if (t.due) {
    const dl = el('button', { type: 'button', className: 'chip calBtn', textContent: 'Deadline in Google Calendar', title: 'All-day event on the deadline' });
    dl.onclick = () => openUrl(gcalUrl({ title: `📌 Due: ${ticketTitle(t, state)}`, details: 'Deadline from Odyssey', day: t.due }));
    calRow.append(dl);
  }
  more.append(field('Calendar', calRow));
  body.append(more);

  // move it on, or delete
  const acts = el('div', { className: 'drawerActions' });
  if (!parent && t.status !== 'done') {
    const later = t.sprint == null;
    const mv = el('button', { type: 'button', textContent: later ? 'Move to this week' : 'Move to later' });
    mv.onclick = async () => { await moveTicket(id, later ? curWeek : null); if (!later) await updateTicket(id, { due: null }); toast(later ? 'Moved to this week' : 'Moved to later'); };
    acts.append(mv);
  }
  const del = el('button', { type: 'button', className: 'dangerBtn', textContent: 'Delete' });
  del.onclick = async () => {
    if (!confirm(`Delete “${t.title}”${t.parentId ? '' : ' and its steps'}? Its focus sessions stay.`)) return;
    await deleteTicket(id);
    document.querySelector('.drawerX')?.click();
    toast('Deleted');
  };
  acts.append(del);
  body.append(acts);
  requestAnimationFrame(() => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; });
}
