// Plan (in the app): this week's habits. Change a target, pick the days for an either/or habit, set the cue
// time and the time it takes, add or remove habits. Each change saves straight away and carries over to the
// weeks after, like the dashboard's planner.

import { PRESETS, weekKeyOf, defaultPlan, unitText, targetText, parseKey, weekDays, dateKey } from './score.js';
import { load, save } from './storage.js';
import { el, stepper, stepFor, openDrawer, toast } from './controls.js';
import { ruleFor, money } from './rewards.js';

const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const KINDS = [
  ['daysPerWeek', 'Done or skipped', 'days a week, e.g. gym', 'days'],
  ['perDayMax', 'Limit per day', 'a bad habit to keep under, e.g. snacking', 'times'],
  ['perDayMin', 'Minimum per day', 'a good habit to reach daily, e.g. reading', 'min'],
  ['perWeekSum', 'Weekly total', 'add up through the week, e.g. hours of study', 'hours'],
];

export function openPlanSheet({ wk, onSaved = () => {} }) {
  const body = el('div', { className: 'planSheet' });
  let plan = null;
  const persist = async (msg) => {
    const st = await load();
    st.weeks[wk] = { ...plan, setAt: Date.now() };
    delete st.weeks[wk].carriedFrom;
    await save({ weeks: st.weeks });
    if (msg) toast(msg);
    onSaved();
  };
  const draw = async () => {
    const st = await load();
    plan = structuredClone(st.weeks[wk] || defaultPlan(st.weeks[Object.keys(st.weeks).filter((k) => k < wk).sort().at(-1)]));
    body.innerHTML = '';
    const days = weekDays(wk);
    body.append(el('p', { className: 'small muted sheetNote', textContent: `Week of ${parseKey(days[0]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. Changes save as you go and carry over to the weeks after.` }));
    const list = el('div', { className: 'iosGroup' });
    for (const g of plan.goals) list.append(habitCell(g));
    body.append(el('div', { className: 'groupHead', textContent: `Habits · ${plan.goals.length}` }), list);

    // add: the presets you don't have, or your own
    const missing = PRESETS.filter((p) => !plan.goals.some((g) => g.preset && g.id === p.id));
    const add = el('div', { className: 'iosGroup' });
    for (const p of missing) {
      const b = el('button', { type: 'button', className: 'cell addCell' }, el('span', { className: 'cIcon', textContent: p.icon }), el('span', { className: 'cMain', textContent: p.name }), el('span', { className: 'cAdd', textContent: 'Add' }));
      b.onclick = async () => { plan.goals.push({ ...structuredClone(p), preset: true }); await persist(`${p.name} added`); draw(); };
      add.append(b);
    }
    const own = el('button', { type: 'button', className: 'cell addCell' }, el('span', { className: 'cIcon', textContent: '＋' }), el('span', { className: 'cMain', textContent: 'Your own habit' }), el('span', { className: 'cAdd', textContent: 'New' }));
    own.onclick = () => newHabit();
    add.append(own);
    body.append(el('div', { className: 'groupHead', textContent: 'Add a habit' }), add);
  };

  // one habit: a row that opens its editor in place
  function habitCell(g) {
    const box = el('div', { className: 'habitCell' });
    const sub = g.metrics.map((m) => (m.kind === 'daysPerWeek' && m.days?.length ? `${m.days.length}×/week · ${dayNames(m.days)}` : targetText(m))).join(' · ');
    const head = el('button', { type: 'button', className: 'cell' }, el('span', { className: 'cIcon', textContent: g.icon || '⭐' }),
      el('span', { className: 'cMain' }, el('b', { textContent: g.name }), el('small', { textContent: sub + (g.cueTime ? ` · 🔔 ${g.cueTime}` : '') })), el('span', { className: 'chev', textContent: '›' }));
    const edit = el('div', { className: 'habitEdit', hidden: true });
    head.onclick = () => { edit.hidden = !edit.hidden; head.classList.toggle('open', !edit.hidden); if (!edit.hidden && !edit.childElementCount) fillEditor(g, edit); };
    box.append(head, edit);
    return box;
  }

  function fillEditor(g, box) {
    const changed = () => persist();
    if (!g.preset) {
      const name = el('input', { type: 'text', value: g.name, maxLength: 40, className: 'iosInput', placeholder: 'Name' });
      name.onchange = () => { if (name.value.trim()) { g.name = name.value.trim(); changed(); } };
      box.append(row('Name', name));
    }
    for (const m of g.metrics) {
      if (m.kind === 'daysPerWeek') box.append(daysEditor(m, changed, ruleFor(g.id)));
      else box.append(row(m.label || `${m.kind === 'perDayMax' ? 'Limit' : 'Goal'} (${unitText(m)})`, stepper({ value: Number(m.target) || 0, step: stepFor(m.unit), min: 0, max: m.unit === 'hours' ? 24 : 999, size: 'sm', onChange: (v) => { m.target = v ?? 0; changed(); } })));
    }
    const cue = el('input', { type: 'time', value: g.cueTime || '', className: 'iosInput timeIn' });
    cue.onchange = () => { if (cue.value) g.cueTime = cue.value; else delete g.cueTime; changed(); };
    const clear = el('a', { className: 'small', textContent: 'Clear' });
    clear.onclick = () => { cue.value = ''; delete g.cueTime; changed(); };
    box.append(row('🔔 Cue reminder', el('div', { className: 'rowEnd' }, cue, clear)));
    box.append(row('⏱ Takes about', stepper({ value: g.estimateMin ?? null, step: 5, min: 0, max: 600, unit: 'min', size: 'sm', onChange: (v) => { if (v > 0) g.estimateMin = v; else delete g.estimateMin; changed(); } })));
    const intent = el('input', { type: 'text', value: g.intention || '', maxLength: 120, className: 'iosInput', placeholder: 'After … I will … (optional)' });
    intent.onchange = () => { g.intention = intent.value.trim(); changed(); };
    box.append(el('div', { className: 'editRow col' }, el('span', { textContent: '🔁 Cue' }), intent));
    const rm = el('button', { type: 'button', className: 'destructive', textContent: `Remove ${g.name}` });
    rm.onclick = async () => {
      if (!confirm(`Remove ${g.name} from this week's plan? Past check-ins stay.`)) return;
      plan.goals = plan.goals.filter((x) => x !== g);
      await persist(`${g.name} removed`);
      draw();
    };
    box.append(rm);
  }

  // "x days a week" and, optionally, which days
  function daysEditor(m, changed, rule) {
    const wrap = el('div', { className: 'daysEdit' });
    const count = stepper({ value: Number(m.target) || 0, step: 1, min: 0, max: 7, unit: 'days', size: 'sm', onChange: (v) => { m.target = v ?? 0; changed(); paint(); } });
    const note = el('div', { className: 'small muted' });
    const chips = el('div', { className: 'dayChips' });
    const order = weekDays(wk).map((k) => parseKey(k).getDay()); // the week's own order (starts Saturday)
    const paint = () => {
      const set = new Set(m.days || []);
      [...chips.children].forEach((b) => b.classList.toggle('on', set.has(Number(b.dataset.d))));
      count.setDisabled(set.size > 0);
      note.textContent = set.size ? `On ${dayNames(m.days)}. Days you plan it get a reminder; a planned day that passes unlogged costs Kleos.` : 'Any days. Pick days to plan them (optional).';
      if (rule?.minTarget && (Number(m.target) || 0) < rule.minTarget) note.textContent += ` ⚠️ The ${money(rule.amount)} reward needs at least ${rule.minTarget} days.`;
    };
    for (const d of order) {
      const b = el('button', { type: 'button', className: 'dayChip', textContent: DOW1[d], title: dayNames([d]) });
      b.dataset.d = d;
      b.onclick = () => {
        const set = new Set(m.days || []);
        set.has(d) ? set.delete(d) : set.add(d);
        if (set.size) { m.days = [...set].sort(); m.target = set.size; count.setValue(set.size); } else delete m.days;
        paint(); changed();
      };
      chips.append(b);
    }
    paint();
    wrap.append(row('Days a week', count), chips, note);
    return wrap;
  }

  function newHabit() {
    const f = el('div', { className: 'newHabit' });
    const name = el('input', { type: 'text', maxLength: 40, className: 'iosInput', placeholder: 'Name, e.g. Reading' });
    let kind = 'daysPerWeek';
    const kinds = el('div', { className: 'kindList' });
    const target = stepper({ value: 3, step: 1, min: 0, max: 7, unit: 'days', size: 'sm' });
    let tv = 3;
    const tRow = row('Target', target);
    const drawKinds = () => {
      kinds.innerHTML = '';
      for (const [k, label, hint] of KINDS) {
        const b = el('button', { type: 'button', className: `kindOpt ${k === kind ? 'on' : ''}` }, el('b', { textContent: label }), el('small', { textContent: hint }));
        b.onclick = () => { kind = k; drawKinds(); };
        kinds.append(b);
      }
      const unit = KINDS.find((x) => x[0] === kind)[3];
      const next = stepper({ value: kind === 'daysPerWeek' ? 3 : kind === 'perDayMax' ? 1 : kind === 'perDayMin' ? 20 : 5, step: stepFor(unit), min: 0, max: kind === 'daysPerWeek' ? 7 : 999, unit, size: 'sm', onChange: (v) => (tv = v ?? 0) });
      tv = Number(next.querySelector('input').value) || 0;
      tRow.lastChild.replaceWith(next);
    };
    drawKinds();
    const go = el('button', { type: 'button', className: 'primary', textContent: 'Add habit' });
    go.onclick = async () => {
      if (!name.value.trim()) { name.focus(); return; }
      const unit = KINDS.find((x) => x[0] === kind)[3];
      const id = crypto.randomUUID();
      const mid = { daysPerWeek: 'days_w', perDayMax: `${unit}_dmax`, perDayMin: `${unit}_dmin`, perWeekSum: `${unit}_w` }[kind];
      plan.goals.push({ id, name: name.value.trim(), icon: '⭐', preset: false, tags: [], metrics: [{ id: mid, kind, unit, target: tv }] });
      await persist(`${name.value.trim()} added`);
      sheet.close(true);
      openPlanSheet({ wk, onSaved });
    };
    const back = el('button', { type: 'button', className: 'ghost', textContent: 'Cancel' });
    back.onclick = () => draw();
    f.append(row('Name', name), el('div', { className: 'groupHead', textContent: 'Kind' }), kinds, tRow, el('div', { className: 'row', style: 'gap:8px;margin-top:12px' }, go, back));
    body.innerHTML = '';
    body.append(f);
    name.focus();
  }

  const sheet = openDrawer(wk > weekKeyOf(dateKey()) ? 'Plan next week' : 'Plan this week', body);
  draw();
  return sheet;
}

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayNames = (days) => [...days].sort((a, b) => ((a + 1) % 7) - ((b + 1) % 7)).map((d) => DOW3[d]).join(', ');
const row = (label, control) => el('div', { className: 'editRow' }, el('span', { textContent: label }), control);
