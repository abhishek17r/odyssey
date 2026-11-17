// The check-in for one day: tap-to-log habit cards, shared by the popup (today) and the dashboard's Today page (any day).

import {
  planOf, weekSoFar, dayIndexInWeek, metricKey, round1, goalTags, dateKey, timedMetric, isDayComplete,
  ticketTitle, weekDays, weekKeyOf,
} from './score.js';
import { el, stepper, checkBtn, stepFor, toast } from './controls.js';
import { missedYesterday } from './coach.js';
import { esc, tagChips } from './ui.js';
import { save } from './storage.js';

export { el };

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Can the timer fill this field? Each goal's first hours/minutes metric, and procrastination.
const timerFillable = (g, m) => metricKey(g, m) === 'work.procrastination' || timedMetric(g) === m;

/**
 * The day's habits as tap-to-log cards for dayKey, rendered into box. Every change saves by itself.
 * getState() returns the current state (callers reload it on storage changes).
 * onSaved(complete) runs after any save.
 * Returns { saveNote(text), applyTimer() }.
 */
export function buildCheckin({ box, dayKey, getState, onSaved = () => {}, compact = false }) {
  const state = getState();
  const plan = planOf(dayKey, state);
  const entry = state.days[dayKey];
  const isToday = dayKey === dateKey();
  const dayWord = isToday ? 'today' : 'that day';
  const draft = { values: { ...(entry?.values || {}) }, reasons: { ...(entry?.reasons || {}) } };
  const timerFields = {}; // key → { apply } for fields the timer can fill
  const cards = []; // { g, card, sub: () => void }
  const idx = dayIndexInWeek(dayKey);
  const days = weekDays(weekKeyOf(dayKey));
  box.innerHTML = '';
  box.classList.add('habits');

  // Save one goal a moment after its last change.
  const pending = new Map();
  const queue = (g) => {
    clearTimeout(pending.get(g.id));
    pending.set(g.id, setTimeout(() => { pending.delete(g.id); saveGoals([g]); }, 350));
  };

  const whyInput = (g, key, placeholder) => {
    const input = el('input', { type: 'text', maxLength: 160, placeholder, value: draft.reasons[key] || '' });
    input.oninput = () => { draft.reasons[key] = input.value; queue(g); };
    return el('div', { className: 'hWhy' }, input);
  };

  // 7 dots for the week: done / skipped / not logged, today outlined.
  const weekDots = (g, m) => {
    const key = metricKey(g, m);
    const st = getState();
    return `<span class="dots">${days.map((k) => {
      const v = k === dayKey ? draft.values[key] : st.days[k]?.values?.[key];
      return `<i class="${v === true ? 'y' : v === false ? 'n' : ''} ${k === dayKey ? 't' : ''}" title="${k}"></i>`;
    }).join('')}</span>`;
  };

  // Skip panel: "Skipping Gym today?" → quick reasons, own words, Skip today / Cancel.
  const SKIP_REASONS = ['😴 Tired', '⏰ No time', '🤒 Unwell', '✈️ Travel', '🛌 Rest day'];
  const openSkip = (g, key, slot, onSkip) => {
    if (slot.querySelector('.skipPanel')) { slot.innerHTML = ''; return; } // tap Skip again to close
    let chosen = null;
    const chips = el('div', { className: 'reasonChips' });
    for (const r of SKIP_REASONS) {
      const b = el('button', { type: 'button', className: 'chip', textContent: r });
      b.onclick = () => { chosen = chosen === r ? null : r; chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.textContent === chosen)); };
      chips.append(b);
    }
    const words = el('input', { type: 'text', maxLength: 140, placeholder: 'In your own words (optional)' });
    const go = el('button', { type: 'button', className: 'skipGo', textContent: `Skip ${dayWord}` });
    const cancel = el('button', { type: 'button', className: 'ghost small', textContent: 'Cancel' });
    const panel = el('div', { className: 'skipPanel' },
      el('div', { className: 'spQ', textContent: `Skipping ${g.name.toLowerCase()} ${dayWord}? Why?` }), chips, words,
      el('div', { className: 'row', style: 'justify-content:flex-end;margin-top:8px' }, cancel, go));
    cancel.onclick = () => (slot.innerHTML = '');
    go.onclick = () => {
      draft.values[key] = false;
      const reason = [chosen, words.value.trim()].filter(Boolean).join(' · ');
      if (reason) draft.reasons[key] = reason; else delete draft.reasons[key];
      onSkip();
    };
    words.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
    slot.innerHTML = '';
    slot.append(panel);
  };

  // Done: a pop, a green glow and a burst of sparkles from the tick. Skipped: a shake, then it greys out.
  const celebrate = (card, from) => {
    card.dataset.fx = Date.now();
    card.classList.remove('celebrate'); void card.offsetWidth; card.classList.add('celebrate');
    const r = from.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      const sp = el('span', { className: 'spark', textContent: ['✦', '✧', '•', '★'][i % 4] });
      const a = (Math.PI * 2 * i) / 10;
      sp.style.left = `${r.left - c.left + r.width / 2}px`;
      sp.style.top = `${r.top - c.top + r.height / 2}px`;
      sp.style.setProperty('--dx', `${Math.cos(a) * (34 + (i % 3) * 10)}px`);
      sp.style.setProperty('--dy', `${Math.sin(a) * (34 + (i % 3) * 10)}px`);
      card.append(sp);
      setTimeout(() => sp.remove(), 800);
    }
    navigator.vibrate?.(15);
  };
  const sink = (card) => { card.dataset.fx = Date.now(); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); };

  const missed = new Set(missedYesterday(state, dayKey));
  for (const g of plan.goals) {
    const icon = el('div', { className: 'hIcon', textContent: g.icon || '⭐' });
    const name = el('div', { className: 'hName' });
    name.innerHTML = `${esc(g.name)}${compact ? '' : ` <span class="tags">${tagChips(goalTags(g), state.settings.tags)}</span>`}` +
      (missed.has(g.id) ? ' <span class="never" title="It slipped yesterday. Missing once is an accident; twice is the start of a new habit.">● never miss twice</span>' : '');
    const sub = el('div', { className: 'hSub' });
    const main = el('div', { className: 'hMain' }, name, sub);
    if (g.intention && !compact) main.append(el('div', { className: 'hCue', textContent: `🔁 ${g.intention}` }));
    const right = el('div', { className: 'hRight' });
    const card = el('div', { className: 'habit' }, icon, main, right);
    const single = g.metrics.length === 1;
    const subs = [];
    const refreshSubs = () => subs.forEach((f) => f());

    for (const m of g.metrics) {
      const key = metricKey(g, m);
      const t = Number(m.target) || 0;
      const slot = single ? right : el('div', { className: 'hRight' });
      const lineSub = single ? sub : el('div', { className: 'mLbl' });
      const whySlot = el('div');

      if (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') {
        if (m.kind === 'oncePerWeek' && weekSoFar(g, m, dayKey, state, false) > 0) {
          slot.append(el('span', { className: 'status st-done', textContent: '✓ done this week' }));
          subs.push(() => (lineSub.textContent = 'Done earlier this week 🎉'));
        } else {
          const skip = el('button', { type: 'button', className: 'skip', textContent: 'Skip', title: `Not ${dayWord}` });
          // under the card: the skip panel while choosing, then "Skipped · reason · Undo"
          const showWhy = () => {
            whySlot.innerHTML = '';
            const skipped = draft.values[key] === false;
            skip.hidden = draft.values[key] != null; // Skip only while it's still open
            if (skipped) {
              const undo = el('button', { type: 'button', className: 'ghost small undo', textContent: 'Undo' });
              undo.onclick = () => { draft.values[key] = null; delete draft.reasons[key]; chk.setState(null); showWhy(); refreshSubs(); queue(g); };
              whySlot.append(el('div', { className: 'skipLine' },
                el('span', { textContent: draft.reasons[key] ? `Skipped · ${draft.reasons[key]}` : 'Skipped' }), undo));
            }
          };
          const chk = checkBtn({ state: draft.values[key] ?? null, title: `${g.name}: done ${dayWord}`, onChange: (v) => {
            draft.values[key] = v;
            if (v) delete draft.reasons[key];
            showWhy(); refreshSubs(); queue(g);
            if (v) celebrate(card, chk);
          } });
          skip.onclick = () => openSkip(g, key, whySlot, () => {
            chk.setState(false);
            showWhy(); refreshSubs(); queue(g);
            sink(card);
          });
          slot.append(skip, chk);
          showWhy();
          subs.push(() => {
            const before = weekSoFar(g, m, dayKey, getState(), false);
            const done = before + (draft.values[key] === true ? 1 : 0);
            const left = 6 - idx;
            lineSub.innerHTML = m.kind === 'oncePerWeek'
              ? `Once this week · ${left} day${left === 1 ? '' : 's'} left after ${dayWord}`
              : `${weekDots(g, m)} <b>${done}/${t}</b> this week${t - before > left + 1 ? ' · <span class="never">out of reach</span>' : done >= t ? ' · 🎉 target hit' : ''}`;
            if (g.estimateMin > 0) lineSub.innerHTML += draft.values[key] === true ? ` · <span class="ok">⏱ ${g.estimateMin} min counted</span>` : ` · ~${g.estimateMin} min`;
          });
        }
      } else {
        const unit = m.unit;
        const label = m.label || (m.kind === 'perWeekSum' ? `${cap(unit)} ${dayWord}` : `${cap(unit)}`);
        const bar = el('div', { className: 'miniBar' }, el('i'));
        const showWhy = () => {
          whySlot.innerHTML = '';
          if (m.reasonIfPositive && Number(draft.values[key]) > 0) whySlot.append(whyInput(g, key, 'What held you back? (optional)'));
        };
        const ctl = stepper({
          value: draft.values[key] ?? null, step: stepFor(unit), unit: unit === 'hours' ? 'h' : unit, size: single ? 'md' : 'sm',
          onChange: (v) => { draft.values[key] = v; showWhy(); refreshSubs(); queue(g); },
        });
        const chip = el('span', { className: 'synced', title: 'Synced from the task timer. Edit sessions on the Today page to change it.' });
        slot.append(ctl, chip);
        chip.hidden = true;
        showWhy();
        subs.push(() => {
          const v = Number(draft.values[key]) || 0;
          const logged = draft.values[key] != null;
          if (m.kind === 'perWeekSum') {
            const sum = weekSoFar(g, m, dayKey, getState(), false) + v;
            lineSub.innerHTML = `${single ? '' : `${esc(label)} · `}<b>${round1(sum)}/${t} ${unit}</b> this week`;
            bar.firstChild.style.width = `${Math.min(100, t > 0 ? (100 * sum) / t : 100)}%`;
          } else if (m.kind === 'perDayMax') {
            lineSub.innerHTML = `${single ? '' : `${esc(label)} · `}at most ${t} ${unit}${logged ? (v <= t ? ' · <span class="ok">within limit</span>' : ' · <span class="never">over</span>') : ''}`;
            bar.firstChild.style.width = logged ? '100%' : '0%';
            bar.firstChild.style.background = logged && v > t ? 'var(--red)' : '';
          } else {
            lineSub.innerHTML = `${single ? '' : `${esc(label)} · `}<b>${round1(v)}/${t} ${unit}</b>${logged && v >= t ? ' · 🎉' : ''}`;
            bar.firstChild.style.width = `${Math.min(100, t > 0 ? (100 * v) / t : 100)}%`;
          }
        });
        if (single) main.append(bar); else lineSub.append(bar);
        if (timerFillable(g, m)) {
          const apply = (st) => {
            const e = st.days[dayKey];
            const synced = !!e?.synced?.[key];
            if (!synced && ctl.hidden) { draft.values[key] = e?.values?.[key] ?? null; ctl.setValue(draft.values[key]); showWhy(); }
            ctl.hidden = synced;
            chip.hidden = !synced;
            if (synced) {
              draft.values[key] = e.values[key];
              chip.textContent = `⏱ ${round1(e.values[key])} ${unit === 'hours' ? 'h' : unit}`;
              showWhy();
            }
            refreshSubs();
          };
          timerFields[key] = { apply };
          apply(state);
        }
      }
      if (!single) main.append(el('div', { className: 'metricLine' }, lineSub, slot));
      main.append(whySlot);
    }
    cards.push({ g, card, refreshSubs });
    box.append(card);
    refreshSubs();
  }
  // Each card is open, done (all answered, on target), skipped (a yes/no habit skipped) or missed
  // (answered, off target). Open ones stay on top; Done and Skipped / missed sink below, in groups.
  const hdrDone = el('div', { className: 'habitGroup done', textContent: 'Done' });
  const hdrOff = el('div', { className: 'habitGroup off', textContent: 'Skipped' });
  // per metric: yes/no → done / skipped; "at most" → done (within) or missed (over: can't be undone);
  // "at least" → done once reached, otherwise still in progress; weekly totals → done once the week's target is met.
  const metricState = (g, m, st) => {
    const v = draft.values[metricKey(g, m)];
    const t = Number(m.target) || 0;
    if (m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek') {
      if (m.kind === 'oncePerWeek' && weekSoFar(g, m, dayKey, st, false) > 0) return 'done';
      return v === true ? 'done' : v === false ? 'skipped' : 'open';
    }
    if (m.kind === 'perWeekSum') return weekSoFar(g, m, dayKey, st, false) + (Number(v) || 0) >= t ? 'done' : 'open';
    if (v == null || v === '') return 'open';
    if (m.kind === 'perDayMax') return Number(v) <= t ? 'done' : 'missed';
    return Number(v) >= t ? 'done' : 'open';
  };
  const stateOf = (g, st) => {
    const all = g.metrics.map((m) => metricState(g, m, st));
    if (all.includes('skipped')) return 'skipped';
    if (all.includes('missed')) return 'missed';
    return all.every((x) => x === 'done') ? 'done' : 'open';
  };
  const arrange = (animate = true) => {
    const before = new Map([...box.children].map((e) => [e, e.getBoundingClientRect().top]));
    const by = (k) => cards.filter((c) => c.state === k).map((c) => c.card);
    const done = by('done');
    const off = [...by('skipped'), ...by('missed')];
    hdrDone.textContent = `Done · ${done.length}`;
    hdrOff.textContent = `${by('missed').length && !by('skipped').length ? 'Missed' : by('missed').length ? 'Skipped or missed' : 'Skipped'} · ${off.length}`;
    const order = [...by('open'), ...(done.length ? [hdrDone, ...done] : []), ...(off.length ? [hdrOff, ...off] : [])];
    if (!done.length) hdrDone.remove();
    if (!off.length) hdrOff.remove();
    for (const e of order) box.insertBefore(e, ticketBox.isConnected ? ticketBox : null);
    if (!animate) return;
    for (const e of order) {
      const was = before.get(e);
      if (was == null) continue;
      const dy = was - e.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  };
  let arrangeTimer = null;
  const paint = (animate = true) => {
    const st = getState();
    let moved = false;
    for (const c of cards) {
      const k = stateOf(c.g, st);
      if (k !== c.state) {
        moved = true;
        // numbers reaching a target / going over a limit get the same effects as the tick and Skip
        const recent = Date.now() - Number(c.card.dataset.fx || 0) < 1500;
        if (animate && !recent && c.state) {
          if (k === 'done') celebrate(c.card, c.card.querySelector('.stepper') || c.card.querySelector('.hRight'));
          else if (k === 'missed') sink(c.card);
        }
      }
      c.state = k;
      c.card.classList.toggle('done', k === 'done');
      c.card.classList.toggle('skipped', k === 'skipped');
      c.card.classList.toggle('missed', k === 'missed');
    }
    if (!animate) { clearTimeout(arrangeTimer); arrange(false); }
    else if (moved) { clearTimeout(arrangeTimer); arrangeTimer = setTimeout(() => arrange(true), 750); } // let the effect play, and number steppers settle
  };

  // Tickets worked on that day (from sessions; nothing to answer here).
  const ticketBox = el('div', { className: 'habit ticketsWorked' });
  if (!compact) box.append(ticketBox);
  const renderTickets = (st) => {
    const mins = {};
    for (const x of st.sessions?.[dayKey] || []) if (x.ticketId && st.tickets?.[x.ticketId]) mins[x.ticketId] = (mins[x.ticketId] || 0) + (Number(x.workMin) || 0);
    const ids = Object.keys(mins);
    ticketBox.hidden = !ids.length;
    ticketBox.innerHTML = `<div class="hIcon">🎫</div><div class="hMain"><div class="hName">Tickets worked on <span class="small muted">· from the timer</span></div>` +
      ids.map((id) => `<div class="row between small" style="margin-top:3px"><span>${esc(ticketTitle(st.tickets[id], st))}</span><b>${round1(mins[id] / 60)} h</b></div>`).join('') + '</div>';
  };
  renderTickets(state);
  paint(false);

  // Answers for some goals. Unanswered metrics are left out (reasons are optional).
  function collect(goals) {
    const st = getState();
    const values = {};
    const reasons = {};
    const cleared = [];
    for (const g of goals) {
      for (const m of g.metrics) {
        const key = metricKey(g, m);
        if (m.kind === 'oncePerWeek') {
          if (weekSoFar(g, m, dayKey, st, false) === 0) values[key] = draft.values[key] === true;
          continue;
        }
        const v = draft.values[key];
        if (v == null || Number.isNaN(v)) { cleared.push(key); continue; }
        values[key] = v;
        const r = (draft.reasons[key] || '').trim();
        const fits = (m.kind === 'daysPerWeek' && v === false) || (m.reasonIfPositive && Number(v) > 0);
        if (r && fits) reasons[key] = r;
      }
    }
    return { values, reasons, cleared };
  }

  // Merge the given goals' answers into the day's entry. Other goals are left as they were.
  async function saveGoals(goals, extra = {}) {
    const st = getState();
    const { values, reasons, cleared } = collect(goals);
    const old = st.days[dayKey] || { values: {}, reasons: {}, note: '' };
    const mergedValues = { ...old.values, ...values };
    for (const k of cleared) delete mergedValues[k]; // un-ticked / emptied
    for (const k of Object.keys(old.synced || {})) mergedValues[k] = old.values[k]; // the timer owns these
    const mergedReasons = { ...old.reasons };
    for (const g of goals) for (const m of g.metrics) delete mergedReasons[metricKey(g, m)];
    Object.assign(mergedReasons, reasons);
    const complete = isDayComplete(st, dayKey, mergedValues);
    st.days[dayKey] = { ...old, ...extra, values: mergedValues, reasons: mergedReasons, complete, savedAt: Date.now() };
    await save({ days: st.days });
    paint();
    toast(complete ? 'Day complete 🎉' : 'Saved');
    onSaved(complete);
    return complete;
  }

  return {
    saveNote: (note) => saveGoals([], { note }),
    applyTimer: () => {
      for (const f of Object.values(timerFields)) f.apply(getState());
      renderTickets(getState());
      paint();
    },
  };
}

// Free-text reflection for a day, saved as you type.
export function bindReflection({ textarea, msgEl, getDayKey, getState }) {
  let timer = null;
  const persist = async () => {
    timer = null;
    const st = getState();
    const k = getDayKey();
    const text = textarea.value.trim();
    const old = st.days[k];
    if (!old && !text) return;
    st.days[k] = old
      ? { ...old, reflection: text }
      : { values: {}, reasons: {}, note: '', complete: false, reflection: text, savedAt: Date.now() };
    await save({ days: st.days });
    msgEl.textContent = 'Saved ✓';
    msgEl.className = 'small ok';
  };
  textarea.addEventListener('input', () => {
    msgEl.textContent = '';
    clearTimeout(timer);
    timer = setTimeout(persist, 700);
  });
  textarea.addEventListener('blur', () => { if (timer) { clearTimeout(timer); persist(); } });
  return {
    // Show the stored text unless you're typing in it right now.
    refresh() {
      if (document.activeElement !== textarea) textarea.value = getState().days[getDayKey()]?.reflection ?? '';
    },
    // Save any pending text before switching days.
    async flush() { if (timer) { clearTimeout(timer); await persist(); } },
  };
}
