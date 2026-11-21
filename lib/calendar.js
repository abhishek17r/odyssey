// The calendar: not a second phone calendar, but your Odyssey days. The month, each day tinted by how it went,
// red dots for tasks due; tap a day for its score, Kleos and focus, every habit (change any of them: this is
// also how you fill in a day you missed), and its tasks. A future day shows what's due and lets you add one.

import { dayScore, band, dateKey, parseKey, addDays, timeOnDay, planOf } from './score.js';
import { kleos } from './points.js';
import { buildCheckin } from './checkin.js';
import { el, openDrawer } from './controls.js';
import { esc } from './ui.js';
import { load } from './storage.js';
import { track } from './usage.js';

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const hm = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? (m ? `${h} h ${m} m` : `${h} h`) : `${m} min`; };

// getState(), reload() → fresh state; addTaskOn(dayKey) opens Add task for that day.
export function openCalendar({ getState, reload, today, start = null, addTaskOn = () => {}, onClose = () => {} }) {
  const body = el('div', { className: 'calSheet' });
  const d = openDrawer('', body, { onClose });
  let ym = (start || today).slice(0, 7);
  const title = (t) => { d.panel.querySelector('.drawerHead h2').textContent = t; };

  const month = () => {
    const st = getState();
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = first.getDay(); // Sunday first
    title(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    body.innerHTML = '';
    // a line for the month
    const keys = Array.from({ length: days }, (_, i) => keyOf(y, m - 1, i + 1));
    const logged = keys.filter((k) => k <= today && st.days[k] && dayScore(k, st)?.score != null);
    const good = logged.filter((k) => band(dayScore(k, st).score) === 'green').length;
    const due = Object.values(st.tickets || {}).filter((t) => !t.parentId && !t.parked && t.status !== 'done' && t.due && t.due >= today && t.due.startsWith(ym)).length;
    body.append(el('p', { className: 'vySub', textContent: [logged.length ? `${good} good day${good === 1 ? '' : 's'} of ${logged.length} logged` : 'Nothing logged this month yet', due ? `${due} task${due === 1 ? '' : 's'} due ahead` : ''].filter(Boolean).join(' · ') }));
    const prev = el('button', { type: 'button', className: 'calNav', ariaLabel: 'Month before', textContent: '‹' });
    const next = el('button', { type: 'button', className: 'calNav', ariaLabel: 'Month after', textContent: '›' });
    prev.onclick = () => { const p = new Date(y, m - 2, 1); ym = `${p.getFullYear()}-${pad(p.getMonth() + 1)}`; month(); };
    next.onclick = () => { const p = new Date(y, m, 1); ym = `${p.getFullYear()}-${pad(p.getMonth() + 1)}`; month(); };
    body.append(el('div', { className: 'calHead' }, prev, el('span', { textContent: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }), next));
    const grid = el('div', { className: 'calGrid' });
    for (const w of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('span', { className: 'calDow', textContent: w }));
    for (let i = 0; i < lead; i++) grid.append(el('span'));
    const dueOn = {};
    for (const t of Object.values(st.tickets || {})) if (!t.parentId && !t.parked && t.status !== 'done' && t.due) dueOn[t.due] = (dueOn[t.due] || 0) + 1;
    for (const k of keys) {
      const sc = k <= today && st.days[k] ? dayScore(k, st)?.score ?? null : null;
      const b = el('button', { type: 'button', className: `calDay b-${band(sc)} ${k === today ? 'today' : ''} ${k > today ? 'future' : ''}`, ariaLabel: `${parseKey(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${sc == null ? '' : `, score ${sc}`}${dueOn[k] ? `, ${dueOn[k]} due` : ''}` },
        el('b', { textContent: String(Number(k.slice(8))) }),
        el('span', { className: 'calDots', innerHTML: '<i></i>'.repeat(Math.min(3, dueOn[k] || 0)) }));
      b.onclick = () => day(k);
      grid.append(b);
    }
    body.append(el('div', { className: 'card calCard' }, grid,
      el('div', { className: 'calLegend', innerHTML: '<span><i class="b-green"></i>Good day</span><span><i class="b-yellow"></i>Mixed</span><span><i class="b-red"></i>Rough</span><span><i class="dueDot"></i>Tasks due</span>' })));
    body.append(el('p', { className: 'small muted vyNote', textContent: 'Tap any day to see it, or to fill in a day you missed.' }));
  };

  const day = (k) => {
    const st = getState();
    track('calendar_day');
    title(parseKey(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }));
    body.innerHTML = '';
    const back = el('button', { type: 'button', className: 'linkBtn backLink', textContent: '‹ Month' });
    back.onclick = () => { ym = k.slice(0, 7); month(); };
    const prev = el('button', { type: 'button', className: 'soft', textContent: '‹ Day before' });
    const next = el('button', { type: 'button', className: 'soft', textContent: 'Day after ›' });
    prev.onclick = () => day(shift(k, -1));
    next.onclick = () => day(shift(k, 1));
    body.append(back, el('div', { className: 'dayNav' }, prev, next));
    const tasks = Object.values(st.tickets || {}).filter((t) => !t.parentId && !t.parked);
    const doneOn = tasks.filter((t) => t.status === 'done' && t.doneAt && dateKey(new Date(t.doneAt)) === k);
    const dueOn = tasks.filter((t) => t.status !== 'done' && t.due === k);
    if (k <= today) {
      const sc = st.days[k] ? dayScore(k, st)?.score : null;
      const pts = kleos(st, today).events.filter((e) => e.day === k).reduce((a, e) => a + e.pts, 0);
      const focus = timeOnDay(st, k).totalMin;
      body.append(el('div', { className: 'card calStats', innerHTML: `<div><b>${sc ?? '—'}</b><small>on track</small></div><div><b>${pts >= 0 ? '+' : '−'}${Math.abs(pts)} ⚡</b><small>Kleos</small></div><div><b>${focus ? hm(focus) : '—'}</b><small>focus</small></div>` }));
      if (planOf(k, st)) {
        body.append(el('div', { className: 'groupHead', textContent: k === today ? 'Habits' : 'Habits · tap to change' }));
        const box = el('div', { className: 'card calHabits' });
        body.append(box);
        buildCheckin({ box, dayKey: k, getState, onSaved: async () => { await reload(); }, compact: true });
      }
    }
    const taskRows = [...doneOn.map((t) => [t, 'done']), ...dueOn.map((t) => [t, k < today ? 'was due' : 'due'])];
    body.append(el('div', { className: 'groupHead', textContent: 'Tasks' }));
    const list = el('div', { className: 'iosGroup' });
    for (const [t, what] of taskRows) list.append(el('div', { className: 'cell static', innerHTML: `<span class="cIcon">${what === 'done' ? '✅' : '○'}</span><span class="cMain"><span>${esc(t.title)}</span></span><small class="muted">${what}</small>` }));
    if (!taskRows.length) list.append(el('div', { className: 'cell static', innerHTML: '<span class="cMain"><small>Nothing done or due this day.</small></span>' }));
    body.append(list);
    if (k >= today) {
      const add = el('button', { type: 'button', className: 'soft calAdd', textContent: `＋ Add a task for ${k === today ? 'today' : parseKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` });
      add.onclick = () => { d.close(); addTaskOn(k); };
      body.append(add);
    }
    body.append(el('p', { className: 'small muted vyNote', textContent: 'Your Google Calendar events will show here too, read-only, once Hermes and Calendar arrive.' }));
  };

  if (start && start !== today) day(start); else month();
  return { d, month, day };
}
