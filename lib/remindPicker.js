// "Remind me" for a task: Off, a few one-tap times that follow its due date, or a time you pick.
// Sent as a push to your phone (Me → Notifications) at that time, even with the app closed.

import { el } from './controls.js';
import { remindChoices, remindText, toLocalInput, fromLocalInput } from './when.js';
import { dateKey } from './score.js';

// getDue() → 'YYYY-MM-DD' | null; value: ms | null; onChange(ms | null). Returns { node, redraw, value() }.
// lazy: don't draw until redraw() (when getDue isn't ready yet).
export function remindPicker({ getDue, value = null, onChange = () => {}, lazy = false }) {
  let cur = value;
  let pickedKey = null; // a one-tap choice follows the due date until you pick a time yourself
  const row = el('div', { className: 'chips remindChips' });
  const label = el('div', { className: 'remindNow' });
  const pick = el('input', { type: 'datetime-local', className: 'chipDate', ariaLabel: 'Pick a time' });
  const draw = () => {
    const today = dateKey();
    const choices = remindChoices(getDue(), today);
    if (pickedKey) { const c = choices.find(([k]) => k === pickedKey); if (c && c[2] !== cur) { cur = c[2]; onChange(cur); } if (!c) { pickedKey = null; cur = null; onChange(null); } }
    row.innerHTML = '';
    const off = el('button', { type: 'button', className: `chip ${cur ? '' : 'on'}`, textContent: 'Off', ariaPressed: String(!cur) });
    off.onclick = () => { cur = null; pickedKey = null; onChange(null); draw(); };
    row.append(off);
    for (const [k, text, ms] of choices) {
      const on = cur === ms;
      const b = el('button', { type: 'button', className: `chip ${on ? 'on' : ''}`, textContent: text, ariaPressed: String(on) });
      b.onclick = () => { cur = ms; pickedKey = k; onChange(cur); draw(); };
      row.append(b);
    }
    const custom = cur && !choices.some(([, , ms]) => ms === cur);
    pick.classList.toggle('on', !!custom);
    pick.value = cur ? toLocalInput(cur) : '';
    pick.min = toLocalInput(Date.now());
    row.append(pick);
    label.textContent = cur ? (cur > Date.now() ? `⏰ ${remindText(cur, today)}` : `Was ${remindText(cur, today)}`) : '';
    label.hidden = !cur;
  };
  pick.onchange = () => { const ms = fromLocalInput(pick.value); if (ms) { cur = ms; pickedKey = null; onChange(cur); draw(); } };
  if (!lazy) draw();
  return { node: el('div', { className: 'remindPicker' }, row, label), redraw: draw, value: () => cur };
}
