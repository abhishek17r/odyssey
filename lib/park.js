// Park a thought: during focus, a thought that pops up is saved in one tap (typed or spoken) so the session
// isn't broken. Parked thoughts are tasks marked `parked` (so they sync like any task) and stay out of every
// task list until you sort them: Task (to Today), Note (onto the task you were working on), or Let go.

import { addTicket, updateTicket, deleteTicket, moveTicket, load } from './storage.js';
import { el, openDrawer, toast } from './controls.js';
import { weekKeyOf, dateKey } from './score.js';
import { micButton } from './speech.js';
import { track } from './usage.js';

export const parkedList = (state) => Object.values(state.tickets || {}).filter((t) => t.parked).sort((a, b) => a.createdAt - b.createdAt);
// parked during this session (or since `since`)
export const parkedSince = (state, since) => parkedList(state).filter((t) => t.createdAt >= since);

// The sheet: one field (with a mic where the phone allows), Park it. The timer keeps going underneath.
export function openPark({ session, onParked = () => {} }) {
  const body = el('div', { className: 'parkSheet' });
  const input = el('input', { type: 'text', className: 'atTitle', maxLength: 120, placeholder: 'What popped into your head?', enterKeyHint: 'done', autocomplete: 'off', ariaLabel: 'Thought' });
  const go = el('button', { type: 'submit', className: 'primary atGo', textContent: 'Park it' });
  const row = el('div', { className: 'parkField' }, input);
  const mic = micButton((text) => { input.value = text; input.dispatchEvent(new Event('input')); });
  if (mic) row.append(mic);
  const form = el('form', { className: 'atForm', autocomplete: 'off' }, row, go, el('p', { className: 'atNote', textContent: 'The timer keeps going. You’ll sort these when the session ends.' }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    await addTicket({ title: text, parked: true, parkedFrom: session?.ticketId || null, sprint: null, planned: false });
    d.close();
    toast('Parked. Back to it.');
    onParked();
  };
  body.append(form);
  const d = openDrawer('Park a thought', body);
  setTimeout(() => input.focus(), 60);
  return d;
}

// One parked thought, with its three ways out. → element
export function parkedRow(t, state, today, onDone = () => {}) {
  const from = t.parkedFrom && state.tickets[t.parkedFrom];
  const btn = (label, cls, fn) => { const b = el('button', { type: 'button', className: `chip ${cls}`, textContent: label }); b.onclick = async () => { await fn(); onDone(); }; return b; };
  const acts = el('div', { className: 'chips parkActs' },
    btn('Task', 'on', async () => { await moveTicket(t.id, weekKeyOf(today)); await updateTicket(t.id, { parked: false, due: today, planned: true }); track('thought_sorted', { a: 'task' }); toast('Added to today'); }),
    ...(from ? [btn('Note', '', async () => {
      const st = await load();
      const host = st.tickets[t.parkedFrom];
      const notes = [host?.notes, `• ${t.title}`].filter(Boolean).join('\n');
      await updateTicket(t.parkedFrom, { notes });
      await deleteTicket(t.id);
      track('thought_sorted', { a: 'note' });
      toast(`Noted on “${host?.title || 'the task'}”`);
    })] : []),
    btn('Let go', '', async () => { await deleteTicket(t.id); track('thought_sorted', { a: 'drop' }); toast('Let go'); }));
  const when = t.createdAt ? new Date(t.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  return el('div', { className: 'parkRow' },
    el('div', { className: 'parkTop' }, el('b', { textContent: t.title }), el('small', { textContent: from ? `${when} · during “${from.title}”` : when })), acts);
}

// After a session: sort what you parked during it (skippable; anything left waits in Tasks → Parked).
// reload() refreshes the app's state after each choice.
export function openSortParked({ getState, reload, since, today, onDone = () => {} }) {
  if (!parkedSince(getState(), since).length) return null;
  const body = el('div', { className: 'parkSort' });
  const d = openDrawer('Thoughts parked', body, { onClose: onDone });
  const draw = () => {
    const state = getState();
    const list = parkedSince(state, since);
    if (!list.length) { d.close(); return; }
    d.panel.querySelector('.drawerHead h2').textContent = `${list.length} thought${list.length > 1 ? 's' : ''} parked`;
    body.innerHTML = '';
    body.append(el('p', { className: 'small muted sheetNote', textContent: 'While you worked. Task: it goes to Today. Note: onto the task you were working on.' }));
    const box = el('div', { className: 'iosGroup parkList' });
    for (const t of list) box.append(parkedRow(t, state, today, async () => { await reload(); draw(); }));
    const later = el('button', { type: 'button', className: 'linkBtn', textContent: 'Sort them later' });
    later.onclick = () => d.close();
    body.append(box, later);
  };
  draw();
  return d;
}
