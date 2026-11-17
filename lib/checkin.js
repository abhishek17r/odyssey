// The check-in for one day: tap-to-log habit cards, shared by the popup (today) and the dashboard's Today page (any day).

import {
  planOf, weekSoFar, dayIndexInWeek, metricKey, round1, goalTags, dateKey, timedMetric, isDayComplete,
  ticketTitle, weekDays, weekKeyOf, addDays, parseKey,
} from './score.js';
import { el, stepper, checkBtn, stepFor, toast, celebrate as celebrateFx, shake } from './controls.js';
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
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const planDays = (days) => [...days].sort((a, b) => ((a + 1) % 7) - ((b + 1) % 7)).map((d) => DOW3[d]).join(' ');

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

  const celebrate = celebrateFx;
  const sink = shake;

  // ---------- kinds of habit ----------
  // Either/or (done or skipped today: Gym, HIIT) → ✓ / Skip in the header; they move to Done / Skipped.
  // Through the day (counted as the day goes: snacking, scrolling, hours) → a meter + stepper; they stay put.
  //   Good habits have a goal to reach (at least / weekly total); bad habits have a limit to stay under (at most).
  const isYesNo = (m) => m.kind === 'daysPerWeek' || m.kind === 'oncePerWeek';
  const short = (u) => (u === 'hours' ? 'h' : u);
  const fmtN = (x) => String(round1(x));
  const per = (m) => (m.kind === 'perWeekSum' ? '/week' : '/day');
  // days in a row before this one within a limit (encouragement for bad habits)
  const cleanStreak = (g, m) => {
    let n = 0;
    for (let d = 1; d < 120; d++) {
      const v = state.days[dateKey(addDays(parseKey(dayKey), -d))]?.values?.[metricKey(g, m)];
      if (v == null || v === '' || Number(v) > Number(m.target)) break;
      n++;
    }
    return n;
  };
  // one metric's numbers → { label, msg, frac, tone: 'good' | 'warn' | 'bad' | 'none', reached, over }
  const trackInfo = (g, m, st) => {
    const v = draft.values[metricKey(g, m)];
    const logged = v != null && v !== '';
    const n = Number(v) || 0;
    const t = Number(m.target) || 0;
    const u = short(m.unit);
    if (m.kind === 'perDayMax') {
      const label = t === 0 ? 'Limit · zero' : `Limit · ≤ ${t} ${u}${per(m)}`;
      if (!logged) return { label, msg: t === 0 ? 'Limit 0 · tap − for a clean day' : `Limit ${t}${u === 'times' ? '' : ` ${u}`} · log as you go`, frac: 0, tone: 'none' };
      const uu = u === 'times' ? '' : ` ${u}`; // "over by 1", "2 left" for counts
      if (n > t) return { label, msg: `Over the limit by ${fmtN(n - t)}${uu} · tomorrow is a clean slate`, frac: 1, tone: 'bad', over: true };
      if (n === 0) return { label, msg: 'Clean so far', frac: 0, tone: 'good', reached: true };
      if (n === t) return { label, msg: `At the limit of ${t}${uu}`, frac: 1, tone: 'warn', reached: true };
      return { label, msg: `${fmtN(n)} of ${t}${uu} · ${fmtN(t - n)} left`, frac: n / t, tone: 'good', reached: true };
    }
    if (m.kind === 'perWeekSum') {
      const sum = weekSoFar(g, m, dayKey, st, false) + n;
      const label = `Goal · ${t} ${u}${per(m)}`;
      if (t > 0 && sum >= t) return { label, msg: `Week’s goal reached · ${fmtN(sum)} ${u}`, frac: 1, tone: 'good', reached: true };
      return { label, msg: `${fmtN(sum)} of ${t} ${u} this week`, frac: t ? sum / t : 0, tone: sum > 0 ? 'good' : 'none' };
    }
    const label = `Goal · ≥ ${t} ${u}${per(m)}`;
    if (t > 0 && n >= t) return { label, msg: `Goal reached · ${fmtN(n)} ${u}`, frac: 1, tone: 'good', reached: true };
    return { label, msg: logged && n > 0 ? `${fmtN(n)} of ${t} ${u}` : `Goal ${t} ${u}`, frac: t ? n / t : 0, tone: n > 0 ? 'good' : 'none' };
  };

  const missed = new Set(missedYesterday(state, dayKey));
  for (const g of plan.goals) {
    const yesNo = g.metrics.filter(isYesNo);
    const tracks = g.metrics.filter((m) => !isYesNo(m));
    const bad = tracks.length && tracks.every((m) => m.kind === 'perDayMax');
    const icon = el('div', { className: 'hIcon', textContent: g.icon || '⭐' });
    const name = el('div', { className: 'hName', textContent: g.name });
    const sub = el('div', { className: 'hSub' });
    const main = el('div', { className: 'hMain' }, name, sub);
    if (!compact) {
      const tags = tagChips(goalTags(g), state.settings.tags);
      if (tags) main.append(el('div', { className: 'tags hTags', innerHTML: tags }));
    }
    if (missed.has(g.id)) main.append(el('div', { className: 'never', title: 'It slipped yesterday. Missing once is an accident; twice is the start of a new habit.', textContent: 'Missed yesterday · never miss twice' }));
    if (g.intention && !compact) main.append(el('div', { className: 'hCue', textContent: `🔁 ${g.intention}` }));
    const right = el('div', { className: 'hRight' });
    const head = el('div', { className: 'hHead' }, icon, main, right);
    const card = el('div', { className: `habit ${yesNo.length ? 'kind-yesno' : 'kind-track'} ${bad ? 'is-bad' : 'is-good'}` }, head);
    const subs = [];
    const refreshSubs = () => subs.forEach((f) => f());

    // either/or: ✓ and Skip in the header
    for (const m of yesNo) {
      const key = metricKey(g, m);
      const t = Number(m.target) || 0;
      const whySlot = el('div', { className: 'hWhySlot' });
      if (m.kind === 'oncePerWeek' && weekSoFar(g, m, dayKey, state, false) > 0) {
        right.append(el('span', { className: 'status st-done', textContent: '✓ this week' }));
        subs.push(() => (sub.textContent = 'Done earlier this week'));
        continue;
      }
      const skip = el('button', { type: 'button', className: 'skip', textContent: 'Skip', title: `Not ${dayWord}` });
      const showWhy = () => {
        whySlot.innerHTML = '';
        skip.hidden = draft.values[key] != null; // Skip only while it's still open
        if (draft.values[key] === false) {
          const undo = el('button', { type: 'button', className: 'ghost small undo', textContent: 'Undo' });
          undo.onclick = () => { draft.values[key] = null; delete draft.reasons[key]; chk.setState(null); showWhy(); refreshSubs(); queue(g); };
          whySlot.append(el('div', { className: 'skipLine' }, el('span', { textContent: draft.reasons[key] ? `Skipped · ${draft.reasons[key]}` : 'Skipped' }), undo));
        }
      };
      const chk = checkBtn({ state: draft.values[key] ?? null, title: `${g.name}: done ${dayWord}`, onChange: (v) => {
        draft.values[key] = v;
        if (v) delete draft.reasons[key];
        showWhy(); refreshSubs(); queue(g);
        if (v) celebrate(card, chk);
      } });
      skip.onclick = () => openSkip(g, key, whySlot, () => { chk.setState(false); showWhy(); refreshSubs(); queue(g); sink(card); });
      right.append(skip, chk);
      card.append(whySlot);
      showWhy();
      subs.push(() => {
        const before = weekSoFar(g, m, dayKey, getState(), false);
        const done = before + (draft.values[key] === true ? 1 : 0);
        const left = 6 - idx;
        sub.innerHTML = m.kind === 'oncePerWeek'
          ? `Once this week · ${left} day${left === 1 ? '' : 's'} left`
          : `${weekDots(g, m)}<span class="hCount"><b>${done}/${t}</b> this week</span>${done >= t ? '<span class="hNote ok">target reached</span>' : t - before > left + 1 ? '<span class="hNote never">out of reach</span>' : ''}`;
        if (g.estimateMin > 0) sub.insertAdjacentHTML('beforeend', `<span class="hNote ${draft.values[key] === true ? 'ok' : ''}">${g.estimateMin} min</span>`);
        if (m.days?.length) {
          const on = m.days.includes(parseKey(dayKey).getDay());
          sub.insertAdjacentHTML('beforeend', `<span class="hNote ${on ? 'plan' : ''}">${on ? 'planned today' : `rest day · ${planDays(m.days)}`}</span>`);
        }
      });
    }

    // through the day: a meter row per number
    for (const m of tracks) {
      const key = metricKey(g, m);
      const lbl = el('span', { className: 'trLbl' });
      const msg = el('span', { className: 'trMsg' });
      const fill = el('i');
      const meter = el('div', { className: 'meter' }, fill);
      const whySlot = el('div');
      const showWhy = () => {
        whySlot.innerHTML = '';
        if (m.reasonIfPositive && Number(draft.values[key]) > (Number(m.target) || 0)) whySlot.append(whyInput(g, key, 'What held you back? (optional)'));
      };
      const ctl = stepper({ value: draft.values[key] ?? null, step: stepFor(m.unit), unit: short(m.unit), size: 'sm',
        onChange: (v) => { draft.values[key] = v; showWhy(); refreshSubs(); queue(g); } });
      const chip = el('span', { className: 'synced', title: 'Synced from the task timer. Edit sessions on the Today page to change it.' });
      chip.hidden = true;
      const row = el('div', { className: `track ${m.kind === 'perDayMax' ? 'limit' : 'goal'}` },
        el('div', { className: 'trTop' }, el('span', { className: 'trName', textContent: m.label && tracks.length > 1 ? m.label : '' }), lbl),
        el('div', { className: 'trRow' }, el('div', { className: 'trBody' }, meter, msg), ctl, chip),
        whySlot);
      card.append(row);
      showWhy();
      subs.push(() => {
        const info = trackInfo(g, m, getState());
        lbl.textContent = info.label;
        msg.textContent = info.msg;
        msg.className = `trMsg tone-${info.tone}`;
        fill.style.width = `${Math.max(0, Math.min(1, info.frac)) * 100}%`;
        meter.className = `meter tone-${info.tone}`;
        meter.hidden = m.kind === 'perDayMax' && Number(m.target) === 0; // a zero limit has nothing to fill
        row.classList.toggle('reached', !!info.reached);
        row.classList.toggle('over', !!info.over);
      });
      if (timerFillable(g, m)) {
        const apply = (st) => {
          const e = st.days[dayKey];
          const synced = !!e?.synced?.[key];
          if (!synced && ctl.hidden) { draft.values[key] = e?.values?.[key] ?? null; ctl.setValue(draft.values[key]); showWhy(); }
          ctl.hidden = synced;
          chip.hidden = !synced;
          if (synced) { draft.values[key] = e.values[key]; chip.textContent = `⏱ ${round1(e.values[key])} ${short(m.unit)}`; showWhy(); }
          refreshSubs();
        };
        timerFields[key] = { apply };
        apply(state);
      }
    }
    // a through-the-day habit's header line: encouragement
    if (!yesNo.length) {
      subs.push(() => {
        if (bad) {
          const n = Math.max(...tracks.map((m) => cleanStreak(g, m)));
          sub.textContent = n >= 2 ? `${n} days within the limit` : n === 1 ? 'Within the limit yesterday' : '';
        } else sub.textContent = '';
      });
    }
    const rest = yesNo.length > 0 && yesNo.every((m) => m.days?.length && !m.days.includes(parseKey(dayKey).getDay()));
    if (rest) card.classList.add('restDay');
    cards.push({ g, card, refreshSubs, yesNo: !!yesNo.length, rest });
    box.append(card);
    refreshSubs();
  }
  // Order: what's still to do and every through-the-day habit stay where they are; either/or habits that are
  // done or skipped move below, into Done and Skipped.
  const hdrDone = el('div', { className: 'habitGroup done', textContent: 'Done' });
  const hdrOff = el('div', { className: 'habitGroup off', textContent: 'Skipped' });
  const hdrRest = el('div', { className: 'habitGroup rest', textContent: 'Not planned today' });
  const stateOf = (c, st) => {
    if (c.yesNo) {
      const vals = c.g.metrics.filter(isYesNo).map((m) => (m.kind === 'oncePerWeek' && weekSoFar(c.g, m, dayKey, st, false) > 0 ? true : draft.values[metricKey(c.g, m)]));
      return vals.some((v) => v === false) ? 'skipped' : vals.every((v) => v === true) ? 'done' : c.rest ? 'rest' : 'open';
    }
    const infos = c.g.metrics.filter((m) => !isYesNo(m)).map((m) => trackInfo(c.g, m, st));
    return infos.some((i) => i.over) ? 'over' : infos.every((i) => i.reached) ? 'reached' : 'track';
  };
  const arrange = (animate = true) => {
    const before = new Map([...box.children].map((e) => [e, e.getBoundingClientRect().top]));
    const by = (k) => cards.filter((c) => c.state === k).map((c) => c.card);
    const stay = cards.filter((c) => !['done', 'skipped', 'rest'].includes(c.state)).map((c) => c.card); // in plan order
    const done = by('done');
    const off = by('skipped');
    const rest = by('rest');
    hdrDone.textContent = `Done · ${done.length}`;
    hdrOff.textContent = `Skipped · ${off.length}`;
    hdrRest.textContent = `Not planned today · ${rest.length}`;
    const order = [...stay, ...(rest.length ? [hdrRest, ...rest] : []), ...(done.length ? [hdrDone, ...done] : []), ...(off.length ? [hdrOff, ...off] : [])];
    if (!done.length) hdrDone.remove();
    if (!off.length) hdrOff.remove();
    if (!rest.length) hdrRest.remove();
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
      const k = stateOf(c, st);
      if (k !== c.state) {
        if (['done', 'skipped', 'rest'].includes(k) || ['done', 'skipped', 'rest'].includes(c.state)) moved = true;
        // a goal reached / a limit broken: the same effects as ✓ and Skip, but the card stays where it is
        const recent = Date.now() - Number(c.card.dataset.fx || 0) < 1500;
        if (animate && !recent && c.state) {
          if (k === 'reached' && !c.yesNo && c.card.classList.contains('is-good')) celebrate(c.card, c.card.querySelector('.stepper') || c.card);
          else if (k === 'over') sink(c.card);
        }
      }
      c.state = k;
      c.card.classList.toggle('done', k === 'done');
      c.card.classList.toggle('skipped', k === 'skipped');
      c.card.classList.toggle('reached', k === 'reached');
      c.card.classList.toggle('over', k === 'over');
    }
    if (!animate) { clearTimeout(arrangeTimer); arrange(false); }
    else if (moved) { clearTimeout(arrangeTimer); arrangeTimer = setTimeout(() => arrange(true), 750); } // let the effect play
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
