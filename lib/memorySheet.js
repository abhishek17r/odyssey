// Me → What Athena knows: her memory of you, to read, edit and delete. Your lines are never changed by her;
// a line of hers you delete is never written again. "Forget everything" clears it and stops the rebuild.

import { el, openDrawer, toast, toggle } from './controls.js';
import { choose } from './dialog.js';
import { load, save } from './storage.js';
import { LISTS, MEMORY_ID, memoryOf, linesIn, addLine, editLine, deleteLine, editAbout, forgetAll, turnOn, setUseNotes } from './memory.js';
import { esc } from './ui.js';
import { track } from './usage.js';

const FROM = { data: 'from your logs', notes: 'from your evening notes', you: 'you told her' };
const HINT = {
  works: 'e.g. Gym goes best straight after work',
  doesnt: 'e.g. Late meetings on Wednesdays',
  commit: 'e.g. 100 push-ups by February',
  know: 'e.g. I work night shifts on Tuesdays',
  avoid: 'e.g. My weight',
};

// change the memory and save it (it syncs like any note)
async function change(fn) {
  const st = await load();
  st.notes ??= {};
  st.notes[MEMORY_ID] = fn(st.notes[MEMORY_ID] || null);
  await save({ notes: st.notes });
  return st;
}

export function openMemory({ getState, onChanged = () => {} }) {
  const body = el('div', { className: 'memSheet' });
  const d = openDrawer('What Athena knows', body);
  let editing = null; // a line id, 'about', or `add:<list>`
  track('sheet', { s: 'memory' });

  const draw = () => {
    const m = memoryOf(getState());
    body.innerHTML = '';
    if (m?.off) {
      body.append(el('p', { className: 'memIntro', textContent: 'Memory is off. Athena writes each note from today’s data alone, and keeps nothing about you between weeks.' }));
      const on = el('button', { type: 'button', className: 'primary', textContent: 'Turn memory back on' });
      on.onclick = () => act(turnOn, 'Memory on. Athena starts again from your next week.');
      body.append(on);
      return;
    }
    const built = m?.builtAt ? new Date(m.builtAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : null;
    body.append(el('p', { className: 'memIntro', textContent: `What Athena remembers about you, so her notes fit you. She updates it each Saturday from your logs${m?.useNotes !== false ? ' and evening notes' : ''}; your own lines stay exactly as you wrote them.${built ? ` Last updated ${built}.` : ''}` }));
    if (!m?.about && !(m?.lines || []).length) {
      body.append(el('div', { className: 'card emptyLine', textContent: 'Nothing yet. Athena starts remembering after a week of logging. You can tell her things now: add them under Keep in mind.' }));
    }

    // about
    body.append(el('h3', { className: 'rpSec', textContent: 'About you' }));
    if (editing === 'about') body.append(editor(m?.about?.text || '', 'Who you are and what you’re working on', (t) => act((x) => editAbout(x, t)), m?.about ? () => act((x) => editAbout(x, '')) : null));
    else {
      const b = el('button', { type: 'button', className: `card memAbout ${m?.about ? '' : 'empty'}`, innerHTML: m?.about ? `${esc(m.about.text)}<small>${FROM[m.about.from] || ''} · tap to edit</small>` : 'Not written yet. Tap to write it yourself.' });
      b.onclick = () => { editing = 'about'; draw(); };
      body.append(b);
    }

    // the lists
    for (const [list, L] of Object.entries(LISTS)) {
      const lines = linesIn(m, list);
      body.append(el('h3', { className: 'rpSec', innerHTML: `${esc(L.title)}${list === 'avoid' ? ' <small>Athena never mentions these</small>' : ''}` }));
      const box = el('div', { className: 'card memList' });
      for (const l of lines) {
        if (editing === l.id) { box.append(editor(l.text, HINT[list], (t) => act((x) => editLine(x, l.id, t)), () => act((x) => deleteLine(x, l.id), 'Deleted. Athena won’t write it again.'))); continue; }
        const row = el('button', { type: 'button', className: 'memLine', innerHTML: `<span>${esc(l.text)}</span><small>${FROM[l.from] || ''}</small>` });
        row.onclick = () => { editing = l.id; draw(); };
        box.append(row);
      }
      if (editing === `add:${list}`) box.append(editor('', HINT[list], (t) => act((x) => addLine(x, list, t), 'Added')));
      else if (lines.length < L.max) {
        const add = el('button', { type: 'button', className: 'memAdd', textContent: lines.length ? '+ Add' : `+ Add ${list === 'avoid' ? 'a topic' : 'one'}` });
        add.onclick = () => { editing = `add:${list}`; draw(); };
        box.append(add);
      }
      body.append(box);
    }

    // controls
    body.append(el('h3', { className: 'rpSec', textContent: 'Your control' }));
    const row = el('div', { className: 'card qFastRow' });
    row.append(el('div', { innerHTML: '<b>Learn from my evening notes</b><small>Lasting things you write in the evening (your schedule, an injury, an event coming up). Hard days are never kept. Off also forgets what she learnt from them.</small>' }),
      toggle({ checked: m?.useNotes !== false, label: 'Learn from my evening notes', onChange: (on) => act((x) => setUseNotes(x, on), on ? 'She’ll learn from your notes' : 'Notes off, and forgotten') }));
    body.append(row);
    const forget = el('button', { type: 'button', className: 'linkBtn memForget', textContent: 'Forget everything' });
    forget.onclick = async () => {
      const ok = await choose({ title: 'Forget everything?', text: 'Athena deletes all she remembers about you, including what you told her, and stops remembering until you turn it back on.', actions: [{ label: 'Forget everything', value: true, kind: 'danger' }, { label: 'Cancel', value: false }] });
      if (ok) { track('memory_forget'); await act(forgetAll, 'Forgotten'); }
    };
    body.append(forget);
  };

  const act = async (fn, msg) => {
    await change(fn);
    editing = null;
    if (msg) toast(msg);
    await onChanged();
    draw();
  };

  // an inline editor: a text box, Save, and Delete (when there's something to delete)
  const editor = (value, hint, onSave, onDelete = null) => {
    const box = el('div', { className: 'memEdit' });
    const t = el('textarea', { value, placeholder: hint, rows: 2, maxLength: 200, ariaLabel: hint });
    const save = el('button', { type: 'button', className: 'primary small', textContent: 'Save' });
    save.onclick = () => onSave(t.value);
    const cancel = el('button', { type: 'button', className: 'linkBtn', textContent: 'Cancel' });
    cancel.onclick = () => { editing = null; draw(); };
    const acts = el('div', { className: 'memActs' }, ...(onDelete ? [Object.assign(el('button', { type: 'button', className: 'linkBtn danger', textContent: 'Delete' }), { onclick: onDelete })] : []), cancel, save);
    box.append(t, acts);
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
    return box;
  };

  draw();
  return d;
}

// the Me row's value: how much she knows
export function memoryValue(state) {
  const m = memoryOf(state);
  if (m?.off) return 'Off';
  const n = (m?.lines || []).length + (m?.about ? 1 : 0);
  return n ? `${n} thing${n > 1 ? 's' : ''}` : 'Nothing yet';
}
