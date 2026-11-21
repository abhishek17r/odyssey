// A month calendar to pick a day (the browser's date box shows no calendar in an iPhone web app).
// calPicker({ value, today, onPick }) → { node, set(value) }. Days before today are shown but can't be picked.
// Weeks start on Monday. value / onPick use 'YYYY-MM-DD'.

import { el } from './controls.js';
import { dateKey, parseKey } from './score.js';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function calPicker({ value = null, today = dateKey(), onPick = () => {}, note = null }) {
  let sel = value;
  const start = parseKey(value || today);
  let y = start.getFullYear(), m = start.getMonth();
  const node = el('div', { className: 'calPick' });
  const head = el('div', { className: 'cpHead' });
  const prev = el('button', { type: 'button', className: 'cpNav', ariaLabel: 'Previous month', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' });
  const next = el('button', { type: 'button', className: 'cpNav', ariaLabel: 'Next month', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>' });
  const title = el('div', { className: 'cpTitle' });
  head.append(prev, title, next);
  const grid = el('div', { className: 'cpGrid', role: 'grid' });
  const foot = el('div', { className: 'cpNote' });
  node.append(head, grid, foot);

  const draw = () => {
    title.textContent = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const t0 = parseKey(today);
    prev.disabled = y < t0.getFullYear() || (y === t0.getFullYear() && m <= t0.getMonth());
    grid.innerHTML = '';
    for (const d of DOW) grid.append(el('div', { className: 'cpDow', textContent: d, ariaHidden: 'true' }));
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
    for (let i = 0; i < lead; i++) grid.append(el('span'));
    const days = new Date(y, m + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
      const k = dateKey(new Date(y, m, n));
      const b = el('button', { type: 'button', className: `cpDay${k === today ? ' today' : ''}${k === sel ? ' on' : ''}`, textContent: String(n), disabled: k < today,
        ariaLabel: parseKey(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), ariaPressed: String(k === sel) });
      b.onclick = () => { sel = k; draw(); onPick(k); };
      grid.append(b);
    }
    const n = sel && note ? note(sel) : '';
    foot.textContent = n || '';
    foot.hidden = !n;
  };
  prev.onclick = () => { m -= 1; if (m < 0) { m = 11; y -= 1; } draw(); };
  next.onclick = () => { m += 1; if (m > 11) { m = 0; y += 1; } draw(); };
  draw();
  return {
    node,
    set(v) {
      sel = v;
      if (v) { const d = parseKey(v); y = d.getFullYear(); m = d.getMonth(); }
      draw();
    },
  };
}
