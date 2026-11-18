// Review (in the app): a week in numbers against the week before, the habits, why you delayed, the
// experiment to try next, and your reflections. Same measures as the dashboard's retro.

import { weekKeyOf, weekDays, addDays, parseKey, dateKey, band, reasonById, ticketTitle } from './score.js';
import { weekMetrics, HEADLINES, pick, QUICK_START_MIN } from './metrics.js';
import { recommendations, activeExperiment, playById, LAWS } from './coach.js';
import { startExperiment } from './storage.js';
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

    // headline numbers, with the change
    const K = kleos(state, upto);
    const wkK = K.events.filter((e) => weekKeyOf(e.day) === wk).reduce((a, e) => a + e.pts, 0);
    const prevK = K.events.filter((e) => weekKeyOf(e.day) === wkAdd(wk, -1)).reduce((a, e) => a + e.pts, 0);
    const picks = [
      ['time.totalH', '⏱ Time invested', 'h', 1], ['focus.workH', 'Worked on the timer', 'h', 1],
      ['starting.medianStartMin', 'Median time to start', 'min', -1], ['starting.quickStartPct', `Started within ${QUICK_START_MIN} min`, '%', 1],
      ['focus.procrastPct', 'Time procrastinating', '%', -1], ['delivery.done', 'Tasks done', '', 1],
      ['delivery.carriedPct', 'Tasks carried over', '%', -1], ['habits.score', 'Habit score', '', 1],
    ];
    const grid = el('div', { className: 'revGrid' });
    const tile = (val, prev, name, unit, better) => {
      const d = val != null && prev != null ? Math.round((val - prev) * 10) / 10 : null;
      const cls = d == null || d === 0 || better === 0 ? 'flat' : (d > 0) === (better > 0) ? 'good' : 'bad';
      grid.append(el('div', { className: 'revTile', innerHTML: `<b>${fmt(val, unit)}</b><span>${esc(name)}</span><i class="delta ${cls}">${d == null ? '' : d === 0 ? '=' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit === '%' ? ' pts' : unit && unit !== '×' ? ` ${unit}` : ''}`}</i>` }));
    };
    for (const [path, name, unit, better] of picks) tile(pick(m, path), pick(p, path), name, unit, better);
    tile(wkK, prevK, '⚡ Kleos earned', '', 1);
    tile(m.delivery.tickets ? `${m.delivery.done}/${m.delivery.tickets}` : '—', null, 'Tasks finished / planned', '', 0);
    body.append(el('div', { className: 'groupHead', textContent: 'The numbers' }), grid);

    // habits
    const prevH = Object.fromEntries(p.habits.perHabit.map((x) => [x.id, x.avg]));
    if (m.habits.perHabit.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const h of m.habits.perHabit) {
        const d = h.avg != null && prevH[h.id] != null ? h.avg - prevH[h.id] : null;
        g.append(el('div', { className: 'cell static', innerHTML: `<span class="cIcon">${h.icon}</span><span class="cMain"><b>${esc(h.name)}</b></span><b class="band ${band(h.avg)}">${h.avg ?? '—'}</b><span class="delta ${d == null || Math.abs(d) < 3 ? 'flat' : d > 0 ? 'good' : 'bad'}">${d == null || Math.abs(d) < 3 ? '' : `${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}`}</span>` }));
      }
      body.append(el('div', { className: 'groupHead', textContent: 'Habits (score out of 100)' }), g);
    }

    // why you delayed
    const rs = m.causes.reasons.filter((x) => x.min > 0).slice(0, 5);
    if (rs.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const x of rs) {
        const r = x.id === 'unrecorded' ? { icon: '❔', label: 'No reason given' } : reasonById(x.id) || { icon: '', label: x.id };
        g.append(el('div', { className: 'cell static', innerHTML: `<span class="cIcon">${r.icon}</span><span class="cMain"><b>${esc(r.label)}</b><small>${x.sharePct}% of procrastination</small></span><b>${x.min} min</b>` }));
      }
      body.append(el('div', { className: 'groupHead', textContent: 'Why you delayed' }), g);
    }

    // tasks still open
    const open = m.delivery.ticketRows.filter((t) => !t.done);
    if (open.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const t of open.slice(0, 8)) g.append(el('div', { className: 'cell static', innerHTML: `<span class="cIcon">${t.carried ? '↪' : '○'}</span><span class="cMain"><b>${esc(state.tickets[t.id] ? ticketTitle(state.tickets[t.id], state) : t.title)}</b><small>${t.loggedH} h logged${t.sizeH ? ` of ${t.sizeH} h` : ''}</small></span>` }));
      body.append(el('div', { className: 'groupHead', textContent: wk === cur ? `Still open · ${open.length}` : `Carried over · ${open.length}` }), g);
    }

    // the next experiment
    const rec = recommendations(state, today);
    const run = activeExperiment(state);
    const play = rec.plays[0]?.play;
    const coach = el('div', { className: 'iosGroup coachBox' });
    if (run) coach.append(el('div', { className: 'cell static', innerHTML: `<span class="cIcon">🧪</span><span class="cMain"><b>Running: ${esc(playById(run.playId)?.title || run.playId)}</b><small>Keep it a week, then check the numbers here.</small></span>` }));
    else if (play) {
      const c = el('div', { className: 'playCard', innerHTML: `<div class="small muted">${esc(LAWS[play.law] || '')}</div><b>${esc(play.title)}</b><div class="small">${esc(play.why)}</div><div class="small muted">${esc(play.rule)}</div>` });
      const go = el('button', { type: 'button', className: 'primary', textContent: 'Try it this week' });
      go.onclick = async () => { await startExperiment(play.id, rec.plays[0].reason); toast('Experiment started'); onChanged(); draw(); };
      c.append(go);
      coach.append(c);
    } else coach.append(el('div', { className: 'cell static', innerHTML: '<span class="cIcon">🤔</span><span class="cMain"><small>Answer “why” when you procrastinate; a suggestion appears here.</small></span>' }));
    body.append(el('div', { className: 'groupHead', textContent: 'Try next' }), coach);

    // reflections
    const refl = weekDays(wk).filter((k) => k <= upto && state.days[k]?.reflection?.trim());
    if (refl.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const k of refl) g.append(el('div', { className: 'cell static refl', innerHTML: `<span class="cMain"><small>${parseKey(k).toLocaleDateString(undefined, { weekday: 'long' })}</small><span>${esc(state.days[k].reflection.trim())}</span></span>` }));
      body.append(el('div', { className: 'groupHead', textContent: 'Your reflections' }), g);
    }
  };
  draw();
  return openDrawer('Review', body);
}
