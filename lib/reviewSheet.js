// Review (in the app): a week in numbers against the week before, the habits, why you delayed, the
// experiment to try next, and your reflections. Same measures as the dashboard's retro.

import { weekKeyOf, weekDays, addDays, parseKey, dateKey, band, reasonById, ticketTitle } from './score.js';
import { weekMetrics, HEADLINES, pick, QUICK_START_MIN } from './metrics.js';
import { recommendations, activeExperiment, playById, LAWS } from './coach.js';
import { startExperiment, moveTicket } from './storage.js';
import { el, openDrawer, toast } from './controls.js';
import { kleos } from './points.js';
import { esc } from './ui.js';
import { weeklyRead } from './athena.js';
import { athena } from './figures.js';

const wkAdd = (wk, n) => dateKey(addDays(parseKey(wk), 7 * n));
const label = (wk) => {
  const d = weekDays(wk);
  const f = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${f(d[0])} – ${f(d[6])}`;
};
const fmt = (v, unit) => (v == null ? '—' : unit === '%' ? `${v}%` : unit === 'h' ? `${v} h` : unit === 'min' ? `${v} min` : unit === '×' ? `${v}×` : `${v}`);

export function athenaRead(read, title = 'Athena') {
  const box = el('div', { className: `athenaRead ${read.tone}` });
  box.append(el('div', { className: 'arHead', innerHTML: `${athena(32)}<b>${title}</b>${read.ai ? '<small>written with AI from your data</small>' : ''}` }));
  for (const l of read.lines) box.append(el('p', { textContent: l }));
  return box;
}

export function openReviewSheet({ getState, today, onChanged = () => {} }) {
  let wk = weekKeyOf(today);
  const body = el('div', { className: 'reviewSheet' });
  const draw = () => {
    const state = getState();
    const cur = weekKeyOf(today);
    const upto = wk === cur ? today : weekDays(wk)[6];
    const m = weekMetrics(wk, state, upto);
    const p = weekMetrics(wkAdd(wk, -1), state, weekDays(wkAdd(wk, -1))[6]);
    body.innerHTML = '';
    const seg = el('div', { className: 'seg' });
    for (const [w, t] of [[cur, 'This week'], [wkAdd(cur, -1), 'Last week']]) {
      const b = el('button', { type: 'button', className: w === wk ? 'on' : '', textContent: t });
      b.onclick = () => { wk = w; draw(); };
      seg.append(b);
    }
    body.append(seg, el('p', { className: 'small muted sheetNote', textContent: `${label(wk)}${wk === cur ? ' · so far' : ''} · vs the week before` }));
    const read = weeklyRead(state, upto, wk);
    if (read) body.append(athenaRead(read));

    // four numbers against the week before; the rest fold away below
    const K = kleos(state, upto);
    const wkK = K.events.filter((e) => weekKeyOf(e.day) === wk).reduce((a, e) => a + e.pts, 0);
    const prevK = K.events.filter((e) => weekKeyOf(e.day) === wkAdd(wk, -1)).reduce((a, e) => a + e.pts, 0);
    const tileOf = (val, prev, name, unit, better, shown = null) => {
      const d = typeof val === 'number' && typeof prev === 'number' ? Math.round((val - prev) * 10) / 10 : null;
      const cls = d == null || d === 0 || better === 0 ? 'flat' : (d > 0) === (better > 0) ? 'good' : 'bad';
      return el('div', { className: 'revTile', innerHTML: `<span>${esc(name)}</span><b>${shown ?? fmt(val, unit)} <i class="delta ${cls}">${d == null ? '' : d === 0 ? 'same' : `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit === '%' ? ' pts' : unit && unit !== '×' ? ` ${unit}` : ''}`}</i></b>` });
    };
    const four = el('div', { className: 'revGrid four' },
      tileOf(pick(m, 'habits.score'), pick(p, 'habits.score'), 'On track', '%', 1),
      tileOf(pick(m, 'time.totalH'), pick(p, 'time.totalH'), 'Focus', 'h', 1),
      tileOf(m.delivery.done, p.delivery.done, 'Tasks done', '', 1, m.delivery.tickets ? `${m.delivery.done} of ${m.delivery.tickets}` : '—'),
      tileOf(pick(m, 'starting.quickStartPct'), pick(p, 'starting.quickStartPct'), `Started within ${QUICK_START_MIN} min`, '%', 1));
    body.append(four);

    // habits: a bar each
    if (m.habits.perHabit.length) {
      const g = el('div', { className: 'iosGroup revHabits' });
      for (const h of m.habits.perHabit) {
        const v = h.avg ?? 0;
        g.append(el('div', { className: 'rhRow', innerHTML: `<span class="rhName">${esc(h.name)}</span><span class="rhBar"><i class="fill-${band(h.avg)}" style="width:${Math.max(2, Math.min(100, v))}%"></i></span><b>${h.avg ?? '—'}</b>` }));
      }
      body.append(el('div', { className: 'groupHead', textContent: 'Habits' }), g);
    }

    // still open: move each on, or to Later
    const open = m.delivery.ticketRows.filter((t) => !t.done && state.tickets[t.id] && state.tickets[t.id].status !== 'done');
    if (open.length) {
      const g = el('div', { className: 'iosGroup' });
      const next = wkAdd(cur, 1);
      for (const t of open.slice(0, 8)) {
        const tk = state.tickets[t.id];
        const row = el('div', { className: 'cell static openRow' }, el('span', { className: 'cMain' }, el('b', { textContent: ticketTitle(tk, state) }), el('small', { textContent: `${t.loggedH} h logged${t.sizeH ? ` of ${t.sizeH} h` : ''}` })));
        if (tk.sprint !== next) {
          const nb = el('button', { type: 'button', className: 'pillBtn', textContent: 'Next week' });
          nb.onclick = async () => { await moveTicket(t.id, next); toast('Moved to next week'); await onChanged(); draw(); };
          row.append(nb);
        } else row.append(el('span', { className: 'small muted', textContent: 'next week' }));
        const lb = el('button', { type: 'button', className: 'pillBtn quiet', textContent: 'Later' });
        lb.onclick = async () => { await moveTicket(t.id, null); toast('Moved to later'); await onChanged(); draw(); };
        row.append(lb);
        g.append(row);
      }
      body.append(el('div', { className: 'groupHead', textContent: `Still open · ${open.length}` }), g);
    }

    // one thing to try next
    const rec = recommendations(state, today);
    const run = activeExperiment(state);
    const play = rec.plays[0]?.play;
    const coach = el('div', { className: 'iosGroup coachBox' });
    if (run) coach.append(el('div', { className: 'cell static', innerHTML: `<span class="cMain"><b>Trying: ${esc(playById(run.playId)?.title || run.playId)}</b><small>Keep it a week, then check the numbers here.</small></span>` }));
    else if (play) {
      const c = el('div', { className: 'playCard', innerHTML: `<b>${esc(play.title)}</b><div class="small">${esc(play.why)}</div>` });
      const go = el('button', { type: 'button', className: 'primary', textContent: wk === cur ? 'Try it next week' : 'Try it this week' });
      go.onclick = async () => { await startExperiment(play.id, rec.plays[0].reason); toast('Started'); onChanged(); draw(); };
      c.append(go);
      coach.append(c);
    }
    if (coach.childElementCount) body.append(el('div', { className: 'groupHead', textContent: 'Try next' }), coach);

    // the rest, folded: why you delayed, all the numbers, your reflections
    const more = el('details', { className: 'foldGroup' }, el('summary', { textContent: 'Your reflections, why you delayed, all the numbers' }));
    const rs = m.causes.reasons.filter((x) => x.min > 0).slice(0, 5);
    if (rs.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const x of rs) {
        const r = x.id === 'unrecorded' ? { icon: '', label: 'No reason given' } : reasonById(x.id) || { icon: '', label: x.id };
        g.append(el('div', { className: 'cell static', innerHTML: `<span class="cMain"><b>${esc(r.label)}</b><small>${x.sharePct}% of procrastination</small></span><b>${x.min} min</b>` }));
      }
      more.append(el('div', { className: 'groupHead', textContent: 'Why you delayed' }), g);
    }
    const grid = el('div', { className: 'revGrid' });
    for (const [path, name, unit, better] of [['focus.workH', 'Worked on the timer', 'h', 1], ['starting.medianStartMin', 'Median time to start', 'min', -1],
      ['focus.procrastPct', 'Time procrastinating', '%', -1], ['delivery.carriedPct', 'Tasks carried over', '%', -1]]) grid.append(tileOf(pick(m, path), pick(p, path), name, unit, better));
    grid.append(tileOf(wkK, prevK, 'Kleos earned', '', 1));
    more.append(el('div', { className: 'groupHead', textContent: 'More numbers' }), grid);
    const refl = weekDays(wk).filter((k) => k <= upto && state.days[k]?.reflection?.trim());
    if (refl.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const k of refl) g.append(el('div', { className: 'cell static refl', innerHTML: `<span class="cMain"><small>${parseKey(k).toLocaleDateString(undefined, { weekday: 'long' })}</small><span>${esc(state.days[k].reflection.trim())}</span></span>` }));
      more.append(el('div', { className: 'groupHead', textContent: 'Your reflections' }), g);
    }
    body.append(more);
  };
  draw();
  return openDrawer('Review', body);
}
