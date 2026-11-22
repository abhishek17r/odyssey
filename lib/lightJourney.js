// Odyssey Light's Journey (the B side of the A/B): the week and the voyage in one screen. Kleos and the next
// harbour in one bar, this week's habits as dots with the on-track %, Athena's one thing to change, and
// "Plan next week with Athena". The Report folds in here; past weeks are one link away.

import { el } from './controls.js';
import { sail } from './sail.js';
import { kleos, keptOn } from './points.js';
import { weekReport } from './report.js';
import { planOf, weekKeyOf, weekDays, parseKey, dateKey, addDays } from './score.js';
import { athena } from './figures.js';
import { esc } from './ui.js';

// ctx: { getState, today, openVoyage(), weakRow(w, wk) → element, plan(), openReport() }
export function drawLightJourney(box, ctx) {
  const state = ctx.getState();
  const day = ctx.today;
  const wk = weekKeyOf(day);
  const days = weekDays(wk);
  box.innerHTML = '';

  // the voyage, in one bar
  const v = sail(state, day);
  const K = kleos(state, day);
  const bar = el('button', { type: 'button', className: 'card ljVoyage', innerHTML: v.peril
    ? `<div class="ljTop"><b>A storm at ${esc(v.peril.name)}</b><span>${v.peril.progress.have} of ${v.peril.progress.need} today ›</span></div><div class="ljBar storm"><i style="width:${Math.round((100 * v.peril.progress.have) / v.peril.progress.need)}%"></i></div><small>One good day, two things done, and you sail on. Nothing is lost.</small>`
    : `<div class="ljTop"><span><b>${K.total.toLocaleString('en-IN')}</b> Kleos</span><span>${v.toNext} to ${esc(v.next.name)} ›</span></div><div class="ljBar"><i style="width:${v.pct}%"></i></div><small>Harbour ${v.harbour + 1} of 12 · +${K.week} this week</small>` });
  bar.onclick = () => ctx.openVoyage();
  box.append(bar);

  // this week: each habit as seven dots
  const R = weekReport(state, wk, day);
  const goals = planOf(day, state)?.goals || [];
  const card = el('div', { className: 'card ljWeek' });
  card.innerHTML = `<div class="ljTop"><b>This week</b><span class="ljPct">${R.onTrack == null ? '—' : `${R.onTrack}%`}</span></div>`
    + goals.map((g) => `<div class="ljHabit"><span>${esc(g.name)}</span><span class="ljDots">${days.map((k) => `<i class="${k > day ? '' : keptOn(state, g, k) ? 'on' : k === day ? 'now' : 'off'}" title="${parseKey(k).toLocaleDateString(undefined, { weekday: 'short' })}"></i>`).join('')}</span></div>`).join('')
    + `<small class="ljMeta">${R.tasks.done} of ${R.tasks.total} tasks done · ${R.focusH} h focused</small>`;
  box.append(card);

  // Athena's one thing to change: this week's weakest spot, else last week's
  const last = dateKey(addDays(parseKey(wk), -7));
  const fromWeek = R.weak.length ? wk : last;
  const w = (R.weak.length ? R.weak : weekReport(state, last, day).weak)[0];
  if (w) {
    const c = el('div', { className: 'card ljChange' });
    c.innerHTML = `<div class="ltWho">${athena(28)}<p><b>One thing to change</b>${esc(w.title)}. ${esc(w.fix)}</p></div>`;
    c.append(ctx.weakRow(w, fromWeek));
    box.append(c);
  }

  const plan = el('button', { type: 'button', className: 'primary ljPlan', textContent: 'Plan next week with Athena' });
  plan.onclick = () => ctx.plan();
  const past = el('button', { type: 'button', className: 'linkBtn ljPast', textContent: 'Past weeks and the full report ›' });
  past.onclick = () => ctx.openReport();
  box.append(plan, past, el('div', { className: 'ljChunk', textContent: 'THIS WEEK AND LATER' }));
}
