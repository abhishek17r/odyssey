// Hermes on screen: one card on Today (a follow-up that's due, else a trial running, else this week's next idea),
// the ideas sheet (every idea with its reasons and what would change; Accept, Change it, Not now; what Hermes
// changed, with Undo), and "Did it help?" a week after you accept. Numbers on these screens come from code.

import { el, openDrawer, toast, toggle } from './controls.js';
import { load, save } from './storage.js';
import { openIdeas as ideasOpen, activeTrials, dueFollowUps, changeText, answer, finish, tick, followUp, keptLine, history, TRIAL_DAYS, isValid, withChange } from './hermes.js';
import { addTrialLine, MEMORY_ID } from './memory.js';
import { dateKey, addDays, parseKey } from './score.js';
import { esc } from './ui.js';
import { track } from './usage.js';

const MARK = '<span class="hmMark" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14c3-1 5-4 6-8 1 4 4 7 8 8"/><path d="M7 18h10"/><path d="M3 10l3 1M21 10l-3 1"/></svg></span>';
const dayN = (h, day) => Math.round((parseKey(day) - parseKey(h.start)) / 864e5) + 1;

// read fresh, change, save (everything syncs like any note or plan change)
async function write(fn) {
  const st = await load();
  const patch = fn(st);
  if (patch && Object.keys(patch).length) await save(patch);
  return patch;
}

async function accept(ctx, i) {
  await write((st) => answer(st, i, 'accepted', ctx.today));
  track('hermes_accept', { k: i.kind });
  toast(`Trying it for ${TRIAL_DAYS} days`);
  await ctx.onChanged();
}
async function notNow(ctx, i) {
  await write((st) => answer(st, i, 'notnow', ctx.today));
  track('hermes_notnow', { k: i.kind });
  await ctx.onChanged();
}

// ---------- Today ----------

export function hermesCard(box, ctx) {
  const state = ctx.getState();
  box.innerHTML = '';
  box.hidden = true;
  if (state.settings?.hermesOn === false || state.settings?.athenaOn === false) return;
  const day = ctx.today;
  const due = dueFollowUps(state, day)[0];
  const trial = activeTrials(state, day)[0];
  const ideas = ideasOpen(state, day);
  if (due) {
    const c = el('button', { type: 'button', className: 'card hmCard hmDue', innerHTML: `<div class="hmTop">${MARK}<div><small>HERMES · YOUR TRIAL ENDED</small><b>Did “${esc(due.idea.title)}” help?</b></div></div><p>Your logs from before and during, side by side. Keep it, or drop it and it's undone.</p>` });
    c.onclick = () => openFollowUp(ctx, due);
    box.append(c);
  } else if (trial && !ideas[0]?.id.startsWith(`${day}-m`)) {
    box.append(trialCard(ctx, trial));
  } else if (ideas.length) {
    const i = ideas[0];
    const now = i.id.startsWith(`${day}-m`); // today's moment: shown first, even while a trial runs
    const c = el('div', { className: 'card hmCard' });
    c.innerHTML = `<div class="hmTop">${MARK}<div><small>HERMES · ${now ? 'RIGHT NOW' : `${ideas.length > 1 ? `1 OF ${ideas.length} IDEAS` : 'AN IDEA'} THIS WEEK`}</small><b>${esc(i.title)}</b></div></div>
      <p class="hmWhy">${i.why.map((w) => `<span>${esc(w)}</span>`).join('')}</p><div class="hmChange"><b>If you accept:</b> ${esc(changeText(state, i, day))}</div>`;
    const a = el('button', { type: 'button', className: 'primary', textContent: 'Accept' });
    a.onclick = () => accept(ctx, i);
    const all = el('button', { type: 'button', className: 'soft', textContent: ideas.length > 1 ? `See all ${ideas.length}` : 'Change it' });
    all.onclick = () => openHermes(ctx, ideas.length > 1 ? null : i.id);
    const no = el('button', { type: 'button', className: 'linkBtn', textContent: 'Not now' });
    no.onclick = () => notNow(ctx, i);
    c.append(el('div', { className: 'hmBtns' }, a, all, no));
    box.append(c);
  } else return;
  box.hidden = false;
}

function trialCard(ctx, h) {
  const state = ctx.getState();
  const day = ctx.today;
  const n = Math.min(TRIAL_DAYS, dayN(h, day));
  const c = el('div', { className: 'card hmCard' });
  const bars = Array.from({ length: TRIAL_DAYS }, (_, k) => {
    const d = dateKey(addDays(parseKey(h.start), k));
    const cls = h.idea.kind === 'try' ? (h.ticks?.[d] === true ? 'on' : h.ticks?.[d] === false ? 'off' : d === day ? 'now' : '') : d < day ? 'on' : d === day ? 'now' : '';
    return `<i class="${cls}"></i>`;
  }).join('');
  c.innerHTML = `<div class="hmTop">${MARK}<div><small>HERMES · TRYING · DAY ${n} OF ${TRIAL_DAYS}</small><b>${esc(h.idea.title)}</b></div></div>
    <div class="hmBars" role="img" aria-label="Day ${n} of ${TRIAL_DAYS}">${bars}</div>
    <p>${esc(h.idea.kind === 'try' ? h.idea.text : (h.changed || changeText(state, h.idea, day)).replace(/^./, (x) => x.toUpperCase()))}</p>`;
  const btns = el('div', { className: 'hmBtns' });
  if (h.idea.kind === 'try' && h.ticks?.[day] == null) {
    c.append(el('p', { className: 'hmAsk', textContent: h.idea.check }));
    for (const [label, v] of [['Yes', true], ['Not today', false]]) {
      const b = el('button', { type: 'button', className: v ? 'primary' : 'soft', textContent: label });
      b.onclick = async () => { await write((st) => tick(st, h, day, v)); await ctx.onChanged(); };
      btns.append(b);
    }
  }
  const stop = el('button', { type: 'button', className: 'linkBtn', textContent: 'Stop the trial' });
  stop.onclick = async () => { await write((st) => finish(st, h, 'stopped')); track('hermes_stop', { k: h.idea.kind }); toast(h.undo ? 'Stopped, and undone' : 'Stopped'); await ctx.onChanged(); };
  btns.append(stop);
  c.append(btns);
  return c;
}

// ---------- the ideas sheet ----------

export function openHermes(ctx, focusId = null) {
  const body = el('div', { className: 'hmSheet' });
  const d = openDrawer('Hermes · ideas for this week', body);
  track('sheet', { s: 'hermes' });
  let editing = focusId;
  const draw = () => {
    const state = ctx.getState();
    const day = ctx.today;
    body.innerHTML = '';
    const off = state.settings?.hermesOn === false;
    body.append(el('p', { className: 'hmIntro', textContent: off ? 'Hermes is off: no ideas, no notifications.' : 'Picked from your last week and what Athena knows about you. Nothing changes until you accept, and each one is a 7-day trial. New ideas come each Saturday.' }));
    if (!off) {
      const ideas = ideasOpen(state, day);
      if (!ideas.length) body.append(el('div', { className: 'card emptyLine', textContent: activeTrials(state, day).length ? 'Nothing else this week: one trial at a time works best.' : 'No ideas this week. Hermes suggests only when your logs point to something worth trying, and never in a paused or hard week.' }));
      for (const i of ideas) body.append(ideaCard(state, i, day));
    }
    // what Hermes changed, with Undo
    const mine = history(state, day).filter((h) => h.start && h.outcome !== 'stopped' && h.outcome !== 'dropped');
    if (mine.length) {
      body.append(el('h3', { className: 'rpSec', textContent: 'What Hermes changed' }));
      const list = el('div', { className: 'card hmDone' });
      for (const h of mine) {
        const row = el('div', { className: 'hmDoneRow', innerHTML: `<span><b>${esc(h.idea.title)}</b><small>${h.outcome === 'kept' ? 'Kept' : day > h.end ? 'Trial ended: did it help?' : `Trying, day ${Math.min(TRIAL_DAYS, dayN(h, day))} of ${TRIAL_DAYS}`}</small></span>` });
        const u = el('button', { type: 'button', className: 'linkBtn', textContent: h.undo ? 'Undo' : 'Stop' });
        u.onclick = async () => { await write((st) => finish(st, h, 'stopped')); toast(h.undo ? 'Undone' : 'Stopped'); await ctx.onChanged(); draw(); };
        row.append(u);
        list.append(row);
      }
      body.append(list);
    }
    const row = el('div', { className: 'card qFastRow' });
    row.append(el('div', { innerHTML: '<b>Hermes’ ideas</b><small>Up to 3 a week on Today, and at most one notification a day, at the hour it’s about.</small>' }),
      toggle({ checked: !off, label: 'Hermes’ ideas', onChange: async (on) => { await write((st) => ({ settings: { ...st.settings, hermesOn: on } })); toast(on ? 'Hermes on' : 'Hermes off'); await ctx.onChanged(); draw(); } }));
    body.append(row);
  };

  const ideaCard = (state, i, day) => {
    const c = el('div', { className: `card hmIdea ${editing === i.id ? 'editing' : ''}` });
    c.innerHTML = `<small class="hmKick">${esc(KIND[i.kind] || 'IDEA')}</small><b>${esc(i.title)}</b><ul>${i.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <div class="hmChange"><b>If you accept:</b> ${esc(changeText(state, i, day))}</div>`;
    const editable = ['set_cue', 'plan_session', 'set_target'].includes(i.kind);
    if (editing === i.id && editable) {
      const x = { ...i };
      let input;
      if (i.kind === 'set_target') input = el('input', { type: 'number', min: 1, max: 99, value: i.target, className: 'iosInput', ariaLabel: 'Target' });
      else input = el('input', { type: 'time', value: i.kind === 'set_cue' ? i.time : i.at.split(' ')[1], className: 'iosInput timeIn', ariaLabel: 'Time' });
      const ok = el('button', { type: 'button', className: 'primary', textContent: 'Accept this' });
      ok.onclick = () => {
        const y = withChange(x, input.value);
        if (!isValid(ctx.getState(), y, day)) { toast('That one can’t be set', 'warn'); return; }
        accept(ctx, y).then(() => { editing = null; draw(); });
      };
      c.append(el('div', { className: 'hmEdit' }, el('label', { textContent: i.kind === 'set_target' ? 'Target' : 'Time' }), input, ok));
    }
    const a = el('button', { type: 'button', className: 'primary', textContent: 'Accept' });
    a.onclick = () => accept(ctx, i).then(draw);
    const ch = el('button', { type: 'button', className: 'soft', textContent: 'Change it' });
    ch.onclick = () => { editing = editing === i.id ? null : i.id; draw(); };
    const no = el('button', { type: 'button', className: 'linkBtn', textContent: 'Not now' });
    no.onclick = () => notNow(ctx, i).then(draw);
    c.append(el('div', { className: 'hmBtns' }, a, ...(editable ? [ch] : []), no));
    return c;
  };

  draw();
  return d;
}
const KIND = { plan_session: 'A TIME TO START', set_cue: 'A REMINDER', set_target: 'A NEW TARGET', set_days: 'FIXED DAYS', shrink_habit: 'A SMALLER START', move_task: 'MAKE ROOM', try: 'SOMETHING TO TRY' };

// ---------- did it help? ----------

export function openFollowUp(ctx, h) {
  const body = el('div', { className: 'hmSheet' });
  const d = openDrawer('Did it help?', body);
  track('sheet', { s: 'hermes_followup' });
  const state = ctx.getState();
  const f = followUp(state, h);
  const c = el('div', { className: 'card hmIdea' });
  c.innerHTML = `<small class="hmKick">${TRIAL_DAYS}-DAY TRIAL · ENDED ${esc(parseKey(h.end).toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase())}</small><b>${esc(h.idea.title)}</b>
    ${f.rows.length ? `<div class="hmTable"><span>FROM YOUR LOGS</span><span>BEFORE</span><span>TRIAL</span>${f.rows.map((r) => `<span>${esc(r.label)}</span><span>${esc(String(r.before))}</span><b class="${r.better ? 'up' : ''}">${esc(String(r.during))}</b>`).join('')}</div>` : '<p>Not enough logged during the trial to compare.</p>'}
    <p>${f.helped ? 'It helped. Keep it as part of your week?' : f.helped === false ? 'It didn’t clearly help. Drop it (it’s undone), or keep it if it felt right.' : 'Keep it, or drop it and it’s undone.'}</p>`;
  const keep = el('button', { type: 'button', className: f.helped === false ? 'soft' : 'primary', textContent: 'Keep it' });
  keep.onclick = async () => {
    const line = keptLine(ctx.getState(), h);
    await write((st) => {
      const p = finish(st, h, 'kept');
      if (f.helped) p.notes[MEMORY_ID] = addTrialLine(st.notes?.[MEMORY_ID] || null, line);
      return p;
    });
    track('hermes_keep', { k: h.idea.kind, helped: !!f.helped });
    toast('Kept');
    await ctx.onChanged();
    d.close();
  };
  const drop = el('button', { type: 'button', className: f.helped === false ? 'primary' : 'soft', textContent: 'Drop it' });
  drop.onclick = async () => { await write((st) => finish(st, h, 'dropped')); track('hermes_drop', { k: h.idea.kind, helped: !!f.helped }); toast(h.undo ? 'Dropped, and undone' : 'Dropped'); await ctx.onChanged(); d.close(); };
  c.append(el('div', { className: 'hmBtns' }, keep, drop));
  body.append(c);
  if (f.helped) body.append(el('div', { className: 'card hmMemory', innerHTML: `<small>ATHENA WILL REMEMBER</small><p>“${esc(keptLine(state, h))}” In What works for you, if you keep it.</p>` }));
  body.append(el('p', { className: 'hmIntro', textContent: 'Numbers come from your logs, never from the AI. A dropped idea isn’t offered again for a month.' }));
  return d;
}

// the Me row's value
export function hermesValue(state, day) {
  if (state.settings?.hermesOn === false) return 'Off';
  const t = activeTrials(state, day).length;
  const n = ideasOpen(state, day).length;
  return t ? 'Trying 1' : n ? `${n} idea${n > 1 ? 's' : ''}` : 'Nothing new';
}
