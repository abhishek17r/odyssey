// The Add-a-task sheet: a title, one-tap chips for when and how long, and a big Add task button.
// Typing "Call the bank tomorrow 30m" sets the chips for you; a chip you tap wins over the words.
// It stays open for the next one. Closing it with words still in the box keeps them as a draft.

import { parseQuickAdd } from './quickAdd.js';
import { addTicket } from './storage.js';
import { el, openDrawer, toast } from './controls.js';
import { whenPatch, WHEN_CHOICES, SIZE_CHOICES, sizeText } from './when.js';
import { parseKey } from './score.js';

const DRAFT = 'odyssey:taskDraft';
const fmt = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const store = { get: () => { try { return sessionStorage.getItem(DRAFT) || ''; } catch { return ''; } }, set: (v) => { try { if (v) sessionStorage.setItem(DRAFT, v); else sessionStorage.removeItem(DRAFT); } catch { /* fine */ } } };

// habitFor(sprint) → the habit a new task's time counts toward (or null)
export function openAddTask({ today, when = 'today', habitFor = () => null, onAdded = () => {} }) {
  let picked = { when: null, size: undefined }; // what you tapped (null / undefined: follow the words)
  const body = el('div', { className: 'addTask' });
  const input = el('input', { type: 'text', className: 'atTitle', maxLength: 100, placeholder: 'What needs doing?', enterKeyHint: 'done', autocomplete: 'off', ariaLabel: 'Task', value: store.get() });
  const hint = el('div', { className: 'atHint' });
  const whenRow = el('div', { className: 'chips whenChips' });
  const sizeRow = el('div', { className: 'chips sizeChips' });
  const go = el('button', { type: 'submit', className: 'primary atGo', textContent: 'Add task' });
  const form = el('form', { className: 'atForm', autocomplete: 'off' },
    input, hint,
    el('div', { className: 'lbl', textContent: 'When' }), whenRow,
    el('div', { className: 'lbl', textContent: 'How long' }), sizeRow,
    go, el('p', { className: 'atNote', textContent: 'Stays open for the next one.' }));
  body.append(form);

  const date = el('input', { type: 'date', className: 'chipDate', ariaLabel: 'Pick a date' });
  const current = () => {
    const q = parseQuickAdd(input.value, today);
    const w = picked.when ?? (q.due ? (q.due === today ? 'today' : q.due) : when);
    const size = picked.size !== undefined ? picked.size : q.sizeH ?? null;
    return { q, when: w, size };
  };
  const draw = () => {
    const c = current();
    whenRow.innerHTML = '';
    const tomorrow = whenPatch('tomorrow', today).due;
    const isDate = /^\d{4}/.test(c.when) && c.when !== tomorrow;
    for (const [k, label] of WHEN_CHOICES) {
      const on = c.when === k || (k === 'tomorrow' && c.when === tomorrow);
      const b = el('button', { type: 'button', className: `chip ${on ? 'on' : ''}`, textContent: label, ariaPressed: String(on) });
      b.onclick = () => { picked.when = k; draw(); };
      whenRow.append(b);
    }
    date.classList.toggle('on', isDate);
    date.value = isDate ? c.when : '';
    whenRow.append(date);
    sizeRow.innerHTML = '';
    for (const [h, label] of [...SIZE_CHOICES.slice(0, 4), [null, 'Not sure']]) {
      const on = c.size === h;
      const b = el('button', { type: 'button', className: `chip ${on ? 'on' : ''}`, textContent: label, ariaPressed: String(on) });
      b.onclick = () => { picked.size = h; draw(); };
      sizeRow.append(b);
    }
    if (c.size != null && !SIZE_CHOICES.slice(0, 4).some(([h]) => h === c.size)) sizeRow.firstChild.before(el('button', { type: 'button', className: 'chip on', textContent: sizeText(c.size) }));
    // what the words were read as
    const read = [c.q.due && picked.when == null ? (c.q.due === today ? 'today' : c.q.due === tomorrow ? 'tomorrow' : fmt(c.q.due)) : '', c.q.sizeH && picked.size === undefined ? sizeText(c.q.sizeH) : ''].filter(Boolean);
    hint.textContent = read.length ? `Read from what you typed: ${read.join(', ')}` : '';
    go.disabled = !c.q.title;
  };
  date.onchange = () => { if (date.value) { picked.when = date.value; draw(); } };
  input.oninput = () => { store.set(input.value); draw(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = current();
    if (!c.q.title) return;
    const p = whenPatch(c.when, today);
    await addTicket({ title: c.q.title, due: p.due, sizeH: c.size, sprint: p.sprint, planned: true, habitId: p.sprint ? habitFor(p.sprint) : null });
    toast(`Added${p.due ? ` · ${p.due === today ? 'today' : fmt(p.due)}` : p.sprint ? ' · this week' : ' · later'}`);
    input.value = '';
    store.set('');
    picked = { when: picked.when, size: undefined }; // keep the day you chose for the next one
    draw();
    input.focus();
    onAdded();
  };

  draw();
  const d = openDrawer('New task', body);
  setTimeout(() => input.focus(), 60);
  return d;
}
