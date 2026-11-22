// Odyssey Light's Today (the B side of the A/B): your day as one list, grouped by morning, afternoon, evening
// and any time; one tap to tick, − and + for limits, a play button to focus, done ones folded into a line,
// and one box that adds anything (Athena shows what it will be before you add it).

import { el, toast } from './controls.js';
import { load, save, addTicket, updateTicket, addHabit } from './storage.js';
import { todayItems, doneCount, PARTS, parseAnything } from './light.js';
import { planOf, weekKeyOf } from './score.js';
import { logEvent } from './hermesThread.js';
import { athena } from './figures.js';
import { esc } from './ui.js';
import { track } from './usage.js';

const PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
const TICK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

async function setValue(day, key, fn, logStep = 0) {
  const st = await load();
  const old = st.days[day] || { values: {}, reasons: {}, note: '' };
  const values = { ...old.values };
  const next = fn(values[key]);
  if (next == null) delete values[key]; else values[key] = next;
  const gid = key.split('.')[0];
  const log = { ...(old.log || {}) };
  if (logStep > 0) log[gid] = [...(log[gid] || []), { at: Date.now(), n: logStep }];
  st.days[day] = { ...old, values, ...(Object.keys(log).length ? { log } : {}), savedAt: Date.now() };
  await save({ days: st.days });
}

// ctx: { getState, today, onChanged, focus(target), openHabit(goal) }
export function drawLightToday(box, ctx) {
  const state = ctx.getState();
  const day = ctx.today;
  const items = todayItems(state, day);
  box.innerHTML = '';
  const c = doneCount(items);
  box.dataset.done = `${c.done}/${c.of}`;

  for (const [part, label] of PARTS) {
    const open = items.filter((i) => i.part === part && !i.done);
    const done = items.filter((i) => i.part === part && i.done);
    if (!open.length && !done.length) continue;
    box.append(el('div', { className: 'ltChunk', textContent: label }));
    for (const i of open) box.append(row(i));
    if (done.length) box.append(el('div', { className: 'ltDone', textContent: done.map((i) => `✓ ${i.title}`).join('   ') }));
  }
  if (!items.length) box.append(el('div', { className: 'card emptyLine', textContent: 'Nothing planned for today. Add a habit or a task below.' }));
  box.append(addBox());

  function row(i) {
    const r = el('div', { className: `ltRow lt-${i.kind}` });
    const t = el('button', { type: 'button', className: 'ltText', innerHTML: `<b>${esc(i.title)}${i.kind === 'task' ? ' <span class="ltTag">task</span>' : ''}</b><small>${esc(i.sub || '')}</small>` });
    t.onclick = () => {
      const g = i.goalId && planOf(day, ctx.getState())?.goals.find((x) => x.id === i.goalId);
      if (g) ctx.openHabit(g); else if (i.taskId) ctx.openTask(i.taskId);
    };
    r.append(t);
    if (i.kind === 'limit') {
      const minus = el('button', { type: 'button', className: 'ltStep', textContent: '−', ariaLabel: `Less ${i.title}` });
      const plus = el('button', { type: 'button', className: 'ltStep', textContent: '+', ariaLabel: `More ${i.title}` });
      minus.onclick = async () => { await setValue(day, i.key, (v) => Math.max(0, (Number(v) || 0) - i.step)); track('light_log', { k: 'limit' }); await ctx.onChanged(); };
      plus.onclick = async () => { await setValue(day, i.key, (v) => (Number(v) || 0) + i.step, i.step); track('light_log', { k: 'limit' }); await ctx.onChanged(); };
      r.append(el('div', { className: 'ltCtr' }, minus, el('span', { textContent: String(i.value) }), plus));
      return r;
    }
    if (i.kind === 'task' || i.goalId) {
      const p = el('button', { type: 'button', className: 'ltPlay', innerHTML: PLAY, ariaLabel: `Focus on ${i.title}` });
      p.onclick = () => { track('light_focus'); ctx.focus(i.taskId ? `t:${i.taskId}` : null); };
      if (i.kind === 'task' || i.kind === 'amount') r.append(p);
    }
    if (i.kind === 'amount') return r; // logged on its page or by the timer
    const dot = el('button', { type: 'button', className: `ltDot ${i.done ? 'on' : ''}`, innerHTML: i.done ? TICK : '', ariaLabel: `${i.title}: ${i.done ? 'done' : 'mark done'}` });
    dot.onclick = async () => {
      if (i.kind === 'task') await updateTicket(i.taskId, { status: 'done' });
      else await setValue(day, i.key, (v) => (v === true ? null : true));
      track('light_log', { k: i.kind });
      await ctx.onChanged();
    };
    r.append(dot);
    return r;
  }

  function addBox() {
    const wrap = el('div', { className: 'ltAddWrap' });
    const form = el('form', { className: 'ltAdd', autocomplete: 'off' });
    const input = el('input', { type: 'text', maxLength: 200, placeholder: 'Add anything: “gym 4 days a week”, “call mum tomorrow”', ariaLabel: 'Add a habit or a task' });
    const go = el('button', { type: 'submit', className: 'ltAddGo', textContent: '＋', ariaLabel: 'Add' });
    form.append(input, go);
    const preview = el('div', { className: 'ltPreview', hidden: true });
    wrap.append(preview, form);
    form.onsubmit = (e) => {
      e.preventDefault();
      const st = ctx.getState();
      const taken = (planOf(day, st)?.goals || []).map((g) => g.id);
      const r = parseAnything(input.value, day, taken);
      if (!r) return;
      if (r.kind === 'exists') { toast(r.preview); const g = planOf(day, st)?.goals.find((x) => x.id === r.goalId); if (g) ctx.openHabit(g); return; }
      preview.hidden = false;
      preview.innerHTML = `<div class="ltWho">${athena(28)}<p>${r.kind === 'habit' ? 'A new habit. I’ve made it easy to start:' : 'A task:'}</p></div>`;
      const card = el('div', { className: 'hmPc' }, el('b', { textContent: r.kind === 'habit' ? r.preview : r.title }),
        el('div', { className: 'hmChange', innerHTML: r.kind === 'habit' ? r.details.map(esc).join('<br>') : esc(r.preview) }));
      const add = el('button', { type: 'button', className: 'primary', textContent: 'Add it' });
      const cancel = el('button', { type: 'button', className: 'linkBtn', textContent: 'Cancel' });
      cancel.onclick = () => { preview.hidden = true; preview.innerHTML = ''; };
      add.onclick = async () => {
        add.disabled = true;
        if (r.kind === 'habit') {
          await addHabit(r.goal, weekKeyOf(day));
          const s2 = await load();
          await save(logEvent(s2, { text: `You added ${r.goal.name}`, where: 'from Today' }));
          toast(`${r.goal.name} added`);
        } else {
          await addTicket({ title: r.title, due: r.due, sizeH: r.sizeH, sprint: weekKeyOf(day), planned: true });
          toast('Added');
        }
        track('light_add', { k: r.kind });
        input.value = '';
        await ctx.onChanged();
      };
      card.append(el('div', { className: 'hmBtns' }, add, cancel));
      preview.append(card);
    };
    return wrap;
  }
}
