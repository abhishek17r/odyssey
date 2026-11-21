// "On track": the week's habit score in plain words (it used to be called the week score / compliance).
// Each habit scores 0–100 each day you check in (did you hit that day's target?); a habit's week is the average
// of its days, and On track is the average across habits. The sheet shows each habit's share and day dots.

import { weekDays, planOf, goalScore, goalWeekAvg, weekSummary, metricWeek, parseKey } from './score.js';
import { el, openDrawer } from './controls.js';
import { esc } from './ui.js';

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// { pct, rows: [{ goal, pct, days: [{ key, on: true|false|null }], line }] } for a week, up to `uptoKey`
export function onTrack(wk, state, uptoKey) {
  const plan = planOf(uptoKey < weekDays(wk)[6] ? uptoKey : weekDays(wk)[6], state) || state.weeks?.[wk];
  const goals = plan?.goals || [];
  const keys = weekDays(wk).filter((k) => k <= uptoKey);
  const rows = goals.map((g) => {
    const days = keys.map((k) => { const s = state.days[k] ? goalScore(g, k, state) : null; return { key: k, on: s == null ? null : s >= 80 }; });
    const counted = days.filter((d) => d.on != null);
    const m = g.metrics[0];
    const weekly = m.kind === 'daysPerWeek' || m.kind === 'perWeekSum' || m.kind === 'oncePerWeek';
    const line = weekly
      ? `${metricWeek(g, m, wk, state, uptoKey).text} this week (a weekly target, so it counts toward the week, not each day)`
      : counted.length ? `On target ${counted.filter((d) => d.on).length} of ${counted.length} days you checked in` : 'No check-ins yet this week';
    return { goal: g, pct: goalWeekAvg(g, wk, state, uptoKey), days, line };
  });
  return { pct: weekSummary(wk, state, uptoKey).avg, rows };
}

export function openOnTrack({ wk, state, uptoKey, title = 'On track' }) {
  const o = onTrack(wk, state, uptoKey);
  const body = el('div', { className: 'otSheet' });
  body.append(el('div', { className: 'otBig', innerHTML: `<b>${o.pct == null ? '—' : `${o.pct}%`}</b><span>${uptoKey >= weekDays(wk)[6] ? 'that week' : 'this week so far'}</span>` }));
  body.append(el('p', { className: 'otWhat', textContent: 'How much of each habit’s target you hit, averaged across your habits. 100% means every habit was on target every day you checked in.' }));
  const list = el('div', { className: 'otList' });
  for (const r of o.rows) {
    const dots = r.days.map((d) => `<i class="${d.on == null ? 'n' : d.on ? 'y' : 'x'}" title="${parseKey(d.key).toLocaleDateString(undefined, { weekday: 'long' })}">${DAY[parseKey(d.key).getDay()]}</i>`).join('');
    list.append(el('div', { className: 'otRow', innerHTML: `<div class="otMain"><b>${esc(r.goal.icon || '')} ${esc(r.goal.name)}</b><small>${esc(r.line)}</small><span class="otDots" aria-hidden="true">${dots}</span></div><span class="otPct">${r.pct == null ? '—' : `${r.pct}%`}</span>` }));
  }
  if (!o.rows.length) list.append(el('div', { className: 'emptyLine', textContent: 'No habits this week.' }));
  body.append(list);
  body.append(el('p', { className: 'otFoot', textContent: 'Days you didn’t check in and paused days don’t count. This isn’t Kleos: Kleos are points for the voyage; this is only how closely you kept your habits.' }));
  return openDrawer(title, body);
}
