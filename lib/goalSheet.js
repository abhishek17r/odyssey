// The goal for a habit: where you want to get to, by when, from where you are, how many days a week, and what to
// plan around. "Make my plan" builds the blocks (lib/goalPlan.js); Athena may reword them later for you.
// Saved in profile.visions[goalId] (synced with the profile).

import { el, openDrawer, toast } from './controls.js';
import { load, save } from './storage.js';
import { dateKey, addDays, parseKey } from './score.js';
import { makePlan, planNow } from './goalPlan.js';
import { calPicker } from './calPicker.js';
import { esc } from './ui.js';

const fmt = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const months = (today, n) => { const d = parseKey(today); d.setMonth(d.getMonth() + n); return dateKey(d); };

// The plan, in Athena's words when her note answers this plan (else the code's).
export function planWords(vision, state, goalId, hash) {
  const ai = state.notes?.[`ai-goal-${goalId}`];
  if (!vision?.plan || !ai?.blocks?.length || ai.for !== hash(vision) || ai.blocks.length !== vision.plan.blocks.length) return { blocks: vision?.plan?.blocks || [], ai: false };
  return { blocks: vision.plan.blocks.map((b, i) => ({ ...b, title: ai.blocks[i].title || b.title, detail: ai.blocks[i].detail || b.detail })), ai: true };
}

// The line on the habit card: "100 push-ups in a row by 21 Feb · week 2 of 14: Build the base: up to 55"
export function visionLine(vision, today) {
  if (!vision) return null;
  const now = planNow(vision, today);
  const by = parseKey(vision.by).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return now ? `${vision.text} by ${by} · week ${now.week} of ${now.of}${now.block ? `: ${now.block.title}` : ''}` : `${vision.text} by ${by}`;
}

export function openGoalSheet({ goal, today = dateKey(), getState, onSaved = () => {}, hash = () => '' }) {
  const body = el('div', { className: 'goalSheet' });
  const d = openDrawer(`${goal.name}: goal`, body);
  const existing = getState().profile?.visions?.[goal.id] || null;
  let draft = existing ? { ...existing } : { text: '', by: months(today, 3), now: '', days: Number(goal.metrics?.[0]?.target) && goal.metrics[0].kind === 'daysPerWeek' ? goal.metrics[0].target : 3, around: '' };

  const persist = async (v) => {
    const st = await load();
    const visions = { ...(st.profile?.visions || {}) };
    if (v) visions[goal.id] = v; else delete visions[goal.id];
    await save({ profile: { ...st.profile, visions } });
    onSaved();
  };

  const showPlan = (v, fresh) => {
    body.innerHTML = '';
    const words = planWords(v, getState(), goal.id, hash);
    const now = planNow(v, today);
    body.append(el('div', { className: 'card gpHead', innerHTML: `<small>${words.ai ? 'Athena · written with AI from your answers' : 'Your plan'}</small>
      <b>${esc(v.text)}</b><span>by ${esc(fmt(v.by))} · ${v.plan.weeks} weeks · ${v.days} days a week${now ? ` · now in week ${now.week}` : ''}</span>` }));
    const list = el('div', { className: 'card gpBlocks' });
    words.blocks.forEach((b, i) => {
      const on = now && now.week >= b.from && now.week <= b.to;
      list.append(el('div', { className: `gpBlock ${on ? 'on' : ''}`, innerHTML: `<span class="gpRail"><i></i>${i < words.blocks.length - 1 ? '<em></em>' : ''}</span>
        <div><small>WEEK${b.from === b.to ? ` ${b.from}` : `S ${b.from}–${b.to}`}</small><b>${esc(b.title)}</b><p>${esc(b.detail)}</p><span class="gpCheck">${esc(b.check.text)}</span></div>` }));
    });
    body.append(list);
    if (v.around) body.append(el('p', { className: 'small muted', textContent: `Planned around: ${v.around}` }));
    body.append(el('p', { className: 'small muted', textContent: 'Each block’s target shows on the habit card. If a check comes up short, repeat the block: change the goal date here.' }));
    const acts = el('div', { className: 'gpActs' });
    if (fresh) {
      const start = el('button', { type: 'button', className: 'primary', textContent: 'Start this plan' });
      start.onclick = async () => { await persist(v); toast('Goal set'); d.close(); };
      const back = el('button', { type: 'button', className: 'soft', textContent: 'Change my answers' });
      back.onclick = () => showForm();
      acts.append(start, back);
    } else {
      const edit = el('button', { type: 'button', className: 'soft', textContent: 'Change the goal' });
      edit.onclick = () => showForm();
      const rm = el('button', { type: 'button', className: 'dangerBtn', textContent: 'Remove the goal' });
      rm.onclick = async () => { if (!confirm('Remove this goal and its plan? The habit stays.')) return; await persist(null); toast('Goal removed'); d.close(); };
      acts.append(edit, rm);
    }
    body.append(acts);
  };

  const showForm = () => {
    body.innerHTML = '';
    const field = (label, ...kids) => el('div', { className: 'field' }, el('div', { className: 'lbl', textContent: label }), ...kids);
    const text = el('textarea', { className: 'iosInput gsText', rows: 2, maxLength: 200, value: draft.text, placeholder: 'e.g. Do 100 push-ups in a row' });
    const now = el('input', { type: 'text', className: 'iosInput', maxLength: 60, value: draft.now, placeholder: 'e.g. 38 in a row' });
    const around = el('textarea', { className: 'iosInput', rows: 2, maxLength: 200, value: draft.around, placeholder: 'e.g. left shoulder gets sore two days in a row' });
    const byChips = el('div', { className: 'chips' });
    const cal = calPicker({ value: draft.by, today, onPick: (k) => { draft.by = k; drawBy(); } });
    const fold = el('details', { className: 'calFold' }, el('summary', { className: 'chip', textContent: 'Pick a date…' }), cal.node);
    const drawBy = () => {
      byChips.innerHTML = '';
      for (const [n, label] of [[1, '1 month'], [3, '3 months'], [6, '6 months']]) {
        const k = months(today, n);
        const b = el('button', { type: 'button', className: `chip ${draft.by === k ? 'on' : ''}`, textContent: label });
        b.onclick = () => { draft.by = k; cal.set(k); drawBy(); };
        byChips.append(b);
      }
      fold.querySelector('summary').textContent = fmt(draft.by);
      fold.querySelector('summary').classList.add('on');
    };
    drawBy();
    const dayChips = el('div', { className: 'chips' });
    const drawDays = () => {
      dayChips.innerHTML = '';
      for (const n of [2, 3, 4, 5, 6, 7]) {
        const b = el('button', { type: 'button', className: `chip ${draft.days === n ? 'on' : ''}`, textContent: String(n) });
        b.onclick = () => { draft.days = n; drawDays(); };
        dayChips.append(b);
      }
    };
    drawDays();
    const go = el('button', { type: 'button', className: 'primary', textContent: 'Make my plan' });
    const hint = el('p', { className: 'small muted', textContent: 'Your plan is built from these answers; Athena may reword it for you later. You can change it any time.' });
    const sync = () => { go.disabled = !text.value.trim(); };
    text.oninput = sync;
    sync();
    go.onclick = () => {
      draft = { ...draft, text: text.value.trim(), now: now.value.trim(), around: around.value.trim() };
      if (draft.by <= today) { toast('Pick a date after today'); return; }
      const v = { ...draft, start: today, plan: makePlan(draft, today), setAt: Date.now() };
      showPlan(v, true);
    };
    body.append(
      field('Where do you want to get to?', text),
      field('By when', byChips, fold),
      field('Where you are now (optional)', now),
      field('Days a week', dayChips),
      field('Anything to plan around? (optional)', around),
      go, hint,
    );
    setTimeout(() => text.focus(), 60);
  };

  if (existing?.plan) showPlan(existing, false); else showForm();
  return d;
}
