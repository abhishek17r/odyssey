// A habit's playbook page: why, this week, what's at stake, the last 4 weeks, what's special to it, how it
// works, if-then plans, what Athena says, setup and data. Every change saves straight away.

import {
  HABIT_PLAYBOOKS, TYPES, playbookOf, playbookIdOf, typeOf, isGentle, stakesFor, history, triggers, byHour, heavier,
  ladderReady, athenaLines, limitOn, zeroDay, underRun, hm,
} from './playbooks.js';
import { load, updateDay, updateGoal, removeHabit } from './storage.js';
import { el, openDrawer, stepper, stepFor, toast } from './controls.js';
import { planOf, metricKey, weekKeyOf, weekDays, parseKey, dateKey, addDays, round1, reasonStats, reasonById, sessionsIn } from './score.js';
import { athena } from './figures.js';
import { esc } from './ui.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmtD = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function targetWords(g) {
  const m = g.metrics[0];
  const t = Number(m.target) || 0;
  const u = m.unit === 'hours' ? 'h' : m.unit === 'min' ? 'min' : '';
  if (m.kind === 'daysPerWeek') return `${t} a week`;
  if (m.kind === 'perDayMax') return t === 0 ? 'none a day' : `at most ${t}${u ? ` ${u}` : ''} a day`;
  if (m.kind === 'perDayMin') return `${t}${u ? ` ${u}` : ''} a day`;
  if (m.kind === 'perWeekSum') return `${t}${u ? ` ${u}` : ''} a week`;
  return '';
}

// onUrge(g): the urge pause. onFocus(g): start a focus block. onChanged(): something saved.
export async function openPlaybook({ goalId, today, onChanged = () => {}, onUrge = null, onFocus = null }) {
  let st = await load();
  const first = planOf(today, st)?.goals.find((x) => x.id === goalId);
  if (!first) { toast('That habit isn’t in this week’s plan'); return null; }
  const body = el('div', { className: 'pbPage' });
  const d = openDrawer(first.name, body);
  d.panel.classList.add('pbDrawer');
  const changed = async (msg) => { st = await load(); if (msg) toast(msg); draw(); onChanged(); };
  const goalSave = (fn, msg) => updateGoal(goalId, fn, weekKeyOf(today)).then(() => changed(msg));

  function draw() {
    const g = planOf(today, st)?.goals.find((x) => x.id === goalId);
    if (!g) { d.close(); return; }
    const pbId = playbookIdOf(g);
    const pb = playbookOf(g);
    const type = typeOf(g);
    const m = g.metrics[0];
    const key = metricKey(g, m);
    const v = st.days[today]?.values?.[key];
    const top = body.parentElement?.scrollTop || 0;
    body.innerHTML = '';
    const section = (title, ...kids) => body.append(el('div', { className: 'groupHead', textContent: title }), ...kids);
    d.panel.querySelector('.drawerHead h2').textContent = g.name;

    body.append(el('p', { className: 'pbSub', textContent: `${TYPES[type].label} · ${targetWords(g)}${pb.name !== g.name && HABIT_PLAYBOOKS[pbId] && !['build', 'cut', 'rule'].includes(pbId) ? ` · ${pb.name} playbook` : ''}` }));

    // why, in your words
    const why = el('div', { className: `pbWhy ${g.why ? '' : 'empty'}` });
    const showWhy = () => {
      why.innerHTML = g.why ? `<small>Why · you wrote</small><p>“${esc(g.why)}”</p>` : '<small>Why does this matter to you?</small><p>Write one line. Athena will use it on hard days.</p>';
    };
    why.onclick = () => {
      if (why.querySelector('input')) return;
      const i = el('input', { type: 'text', className: 'iosInput', maxLength: 90, value: g.why || '', placeholder: 'In a few words' });
      const ok = el('button', { type: 'button', className: 'primary small', textContent: 'Save' });
      ok.onclick = (e) => { e.stopPropagation(); goalSave((x) => { const w = i.value.trim(); if (w) x.why = w; else delete x.why; }, 'Saved'); };
      i.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
      why.innerHTML = '<small>Why does this matter to you?</small>';
      why.append(el('div', { className: 'row' }, i, ok));
      setTimeout(() => i.focus(), 30);
    };
    showWhy();
    body.append(why);

    // this week + today's log
    body.append(weekCard(g, pbId, type, m, key, v));

    // what's at stake
    const stakes = stakesFor(g, st, today);
    if (stakes.length) {
      section('What’s at stake', el('div', { className: 'card pbStakes' }, ...stakes.map((s) => el('div', { className: `pbStake ${s.tone}` },
        el('span', { className: 'psL', textContent: s.label }), el('span', { innerHTML: s.html })))));
    }

    // the last 4 weeks
    section(m.kind === 'perDayMax' ? 'Last 4 weeks · under the limit?' : 'Last 4 weeks', historyGrid(g, m));

    // special to this playbook
    special(g, pbId, type, m);

    // how it works
    section('How this playbook works', el('div', { className: 'iosGroup pbRules' }, ...pb.rules.map(([t, s], i) => el('div', { className: 'cell static' },
      el('span', { className: 'pbNum', textContent: String(i + 1) }), el('span', { className: 'cMain' }, el('b', { textContent: t }), el('small', { textContent: s }))))));

    // if-then plans
    section('If-then plans', ifThen(g, pb));

    // what Athena says
    section('What Athena says', el('div', { className: 'iosGroup pbAthena' }, ...athenaLines(g, st, today).map(([when, text]) => el('div', { className: 'cell static' },
      el('span', { className: 'pbAv', innerHTML: athena(28) }), el('span', { className: 'cMain' }, el('small', { textContent: when }), el('span', { className: 'pbSays', textContent: text }))))));

    // setup
    section('Setup', setupBox(g, pbId, type, m));

    // data
    section('Data', el('div', { className: 'iosGroup pbData' },
      ...pb.now.map(([t, s]) => el('div', { className: 'cell static' }, el('span', { className: 'pbTag now', textContent: 'Now' }), el('span', { className: 'cMain' }, el('b', { textContent: t }), el('small', { textContent: s })))),
      ...pb.later.map(([t, s]) => el('div', { className: 'cell static later' }, el('span', { className: 'pbTag', textContent: 'With the app' }), el('span', { className: 'cMain' }, el('b', { textContent: t }), el('small', { textContent: s }))))),
    el('p', { className: 'small muted pbNote', textContent: 'Anything read from your phone stays on it. Only the result (“done”, “41 min”) is saved, and Athena never sees raw health data.' }));
    if (pb.help) body.append(el('p', { className: 'small muted pbNote', textContent: pb.help }));

    const rm = el('button', { type: 'button', className: 'destructive pbRemove', textContent: `Remove ${g.name} from your habits` });
    rm.onclick = async () => {
      if (!confirm(`Remove ${g.name} from this week on? Days you already logged stay.`)) return;
      await removeHabit(goalId, weekKeyOf(today));
      toast(`${g.name} removed`);
      onChanged();
      d.close();
    };
    body.append(rm);
    if (body.parentElement) body.parentElement.scrollTop = top;
  }

  // ---------- this week ----------
  function weekCard(g, pbId, type, m, key, v) {
    const card = el('div', { className: 'card pbWeek' });
    const wk = weekKeyOf(today);
    const days = weekDays(wk);
    const setToday = (fn, msg) => updateDay(today, fn).then(() => changed(msg));
    if (m.kind === 'daysPerWeek') {
      const done = days.filter((k) => st.days[k]?.values?.[key] === true).length;
      const t = Number(m.target) || 0;
      const left = days.filter((k) => k > today).length;
      card.append(el('div', { className: 'pbWHead' }, el('b', { textContent: type === 'rule' ? (g.rule || g.name) : 'This week' }),
        el('span', { className: 'muted', textContent: `${done} of ${t}${left ? ` · ${left} day${left > 1 ? 's' : ''} left` : ''}` })));
      card.append(el('div', { className: 'pbDots' }, ...days.map((k) => {
        const x = st.days[k]?.values?.[key];
        const planned = m.days?.length ? m.days.includes(parseKey(k).getDay()) : null;
        const cls = x === true ? 'done' : k === today ? 'today' : k > today ? 'future' : x === false || planned ? 'miss' : 'rest';
        return el('span', { className: 'pbDot' }, el('small', { textContent: DOW1[parseKey(k).getDay()] }), el('i', { className: cls, textContent: x === true ? '✓' : cls === 'miss' ? '–' : '' }));
      })));
      const isDone = v === true;
      const b = el('button', { type: 'button', className: isDone ? 'pbDone' : 'primary', textContent: isDone ? (type === 'rule' ? 'Kept today ✓ · undo' : 'Done today ✓ · undo') : pbId === 'gym' ? 'Log today’s session' : type === 'rule' ? 'Kept it today' : 'Done today' });
      b.onclick = () => setToday((day) => { if (isDone) delete day.values[key]; else day.values[key] = true; }, isDone ? 'Undone' : 'Logged');
      card.append(b);
      if (pbId === 'gym' && isDone) {
        const cur = st.days[today]?.pb?.[g.id] || {};
        const setPb = (patch) => setToday((day) => { day.pb = { ...(day.pb || {}), [g.id]: { ...(day.pb?.[g.id] || {}), ...patch } }; });
        const parts = el('div', { className: 'chips' }, ...HABIT_PLAYBOOKS.gym.parts.map((p) => {
          const c = el('button', { type: 'button', className: `chip ${cur.part === p ? 'on' : ''}`, textContent: p });
          c.onclick = () => setPb({ part: cur.part === p ? null : p });
          return c;
        }));
        const feels = el('div', { className: 'chips' }, ...HABIT_PLAYBOOKS.gym.feels.map(([id, label]) => {
          const c = el('button', { type: 'button', className: `chip ${cur.feel === id ? 'on' : ''}`, textContent: label });
          c.onclick = () => setPb({ feel: cur.feel === id ? null : id });
          return c;
        }));
        card.append(el('div', { className: 'lbl', textContent: 'What did you train?' }), parts, el('div', { className: 'lbl', textContent: 'How did it feel?' }), feels);
      }
      if (!isDone && g.tiny) card.append(el('p', { className: 'small muted center', textContent: `Short on time? ${g.tiny}.` }));
      return card;
    }
    // amounts: a stepper for today
    const u = m.unit === 'hours' ? 'h' : m.unit === 'min' ? 'min' : '';
    const n = Number(v) || 0;
    const t = m.kind === 'perDayMax' ? limitOn(g, today) : Number(m.target) || 0;
    const frac = t ? Math.min(1, n / t) : n ? 1 : 0;
    const over = m.kind === 'perDayMax' && n > t;
    card.append(el('div', { className: 'pbWHead' }, el('b', { textContent: `Today · ${round1(n)}${u ? ` ${u}` : ''} ${m.kind === 'perDayMax' ? `of ${t}` : `of ${t}${u ? ` ${u}` : ''}`}` }),
      el('span', { className: over ? 'bad' : 'muted', textContent: m.kind === 'perDayMax' ? (over ? `over by ${round1(n - t)}` : `${round1(t - n)}${u ? ` ${u}` : ''} left`) : n >= t ? 'done for today' : `${round1(t - n)}${u ? ` ${u}` : ''} to go` })));
    card.append(el('div', { className: `pbBar ${m.kind === 'perDayMax' ? (over ? 'over' : frac >= 0.8 ? 'warn' : '') : 'good'}` }, el('i', { style: `width:${Math.round(frac * 100)}%` })));
    const log = (delta) => setToday((day) => {
      const cur = Number(day.values[key]) || 0;
      const next = Math.max(0, round1(cur + delta));
      day.values[key] = next;
      if (m.kind === 'perDayMax') {
        const list = [...(day.log?.[g.id] || [])];
        if (delta > 0) list.push({ at: Date.now(), n: delta });
        else if (list.length) list.pop();
        day.log = { ...(day.log || {}), [g.id]: list };
      }
    });
    if (m.unit === 'min' || (pbId === 'scrolling' && m.unit === 'hours')) {
      const inc = (mins) => (m.unit === 'hours' ? mins / 60 : mins);
      const row = el('div', { className: 'pbBtns' }, ...[5, 15, 30].map((mins) => {
        const b = el('button', { type: 'button', className: 'soft', textContent: `+${mins} min` });
        b.onclick = () => log(inc(mins));
        return b;
      }));
      const minus = el('button', { type: 'button', className: 'soft', textContent: '−' });
      minus.onclick = () => log(-Math.min(n, inc(5)));
      row.prepend(minus);
      card.append(row);
    } else {
      card.append(el('div', { className: 'pbStep' }, stepper({ value: v ?? null, step: stepFor(m.unit), unit: u, onChange: (x) => log((Number(x) || 0) - n) })));
    }
    if (m.kind === 'perDayMax' && pb(g).tags) {
      const list = st.days[today]?.log?.[g.id] || [];
      const last = list.at(-1);
      if (last) {
        card.append(el('div', { className: 'lbl', textContent: 'What set off the last one?' }), el('div', { className: 'chips' }, ...pb(g).tags.map((tag) => {
          const c = el('button', { type: 'button', className: `chip ${last.tag === tag ? 'on' : ''}`, textContent: tag });
          c.onclick = () => setToday((day) => { const l = [...(day.log?.[g.id] || [])]; if (l.length) l[l.length - 1] = { ...l.at(-1), tag: l.at(-1).tag === tag ? null : tag }; day.log = { ...(day.log || {}), [g.id]: l }; });
          return c;
        })));
      }
    }
    if (m.kind === 'perDayMax' && onUrge) {
      const u2 = st.days[today]?.urges?.[g.id];
      card.append(el('div', { className: 'pbUrge' },
        el('div', {}, el('b', { textContent: pbId === 'scrolling' ? 'About to open an app?' : 'Craving right now?' }),
          el('small', { textContent: `${pbId === 'scrolling' ? 'Take a minute first, then decide.' : 'Most pass in a few minutes. Breathe with the circle.'}${u2 ? ` Today: ${u2.resisted + u2.gave} urge${u2.resisted + u2.gave === 1 ? '' : 's'}, ${u2.resisted} ridden out.` : ''}` })),
        Object.assign(el('button', { type: 'button', className: 'primary', textContent: pbId === 'scrolling' ? 'Pause first' : 'Ride it out' }), { onclick: () => onUrge(g) })));
    }
    if (type === 'build' && (m.unit === 'hours' || m.unit === 'min') && onFocus) {
      const f = el('button', { type: 'button', className: 'primary', textContent: 'Start a focus block' });
      f.onclick = () => { d.close(); onFocus(g); };
      card.append(f);
    }
    return card;
  }
  const pb = (g) => playbookOf(g);

  // ---------- 4 weeks ----------
  function historyGrid(g, m) {
    const h = history(g, st, today);
    const grid = el('div', { className: 'card pbHist' });
    grid.append(el('div', { className: 'phRow head' }, el('span'), ...weekDays(h[0].wk).map((k) => el('span', { textContent: DOW1[parseKey(k).getDay()] }))));
    for (const w of h) grid.append(el('div', { className: 'phRow' }, el('span', { className: 'phWk', textContent: fmtD(w.wk) }), ...w.cells.map((c) => el('i', { className: c }))));
    const legend = m.kind === 'perDayMax' ? [['under', 'Under the limit'], ['over', 'Over']] : m.kind === 'daysPerWeek' ? [['done', typeOf(g) === 'rule' ? 'Kept' : 'Done'], ['miss', 'Planned, missed'], ['rest', 'Rest']] : [['done', 'On target'], ['miss', 'Short']];
    grid.append(el('div', { className: 'phLegend' }, ...legend.map(([c, t]) => el('span', {}, el('i', { className: c }), t))));
    return grid;
  }

  // ---------- what's special to each playbook ----------
  function special(g, pbId, type, m) {
    const section = (title, ...kids) => body.append(el('div', { className: 'groupHead', textContent: title }), ...kids);
    const bars = (rows, cls = '') => el('div', { className: `card pbBars ${cls}` }, ...rows.map(([label, pct, text, on]) => el('div', { className: `pbBarRow ${on ? 'on' : ''}` },
      el('span', { className: 'pbbL', textContent: label }), el('span', { className: 'pbbT' }, el('i', { style: `width:${Math.max(2, Math.round(pct))}%` })), el('span', { className: 'pbbV', textContent: text }))));
    if (pbId === 'gym') {
      const hv = heavier(g, st);
      if (hv.of) section('Getting stronger', el('div', { className: 'card pbText' }, el('p', { innerHTML: `<b>${hv.up} of your last ${hv.of}</b> logged sessions felt heavier than the time before.${hv.last?.part ? ` Last time: ${esc(hv.last.part)}.` : ''}` }),
        el('p', { className: 'small muted', textContent: 'Tap “Heavier than last time” after a session where you added weight or reps.' })));
    }
    if (pbId === 'smoking' && g.smoking) {
      const s = g.smoking;
      const z = zeroDay(g);
      const steps = [];
      if (s.pace) for (let i = 0; i < s.start; i++) { const k = shift(s.since, i * s.pace * 7); steps.push([fmtD(k), ((s.start - 1 - i) / s.start) * 100, `${s.start - 1 - i} a day`, k <= today && shift(k, s.pace * 7) > today]); }
      const shown = steps.filter((x, i) => x[3] || i % Math.max(1, Math.ceil(steps.length / 8)) === 0 || i === steps.length - 1);
      const hold = el('button', { type: 'button', className: 'soft', textContent: 'Hold this limit one more week' });
      hold.onclick = () => goalSave((x) => { x.smoking.since = shift(x.smoking.since, 7); x.metrics[0].target = limitOn(x, today); }, 'Holding for a week. The date moves; the plan doesn’t break.');
      section('The plan', s.pace ? bars(shown, 'red') : el('div', { className: 'card pbText' }, el('p', { textContent: 'You’re holding your limit for now. Pick a pace in Setup when you’re ready to step down.' })));
      if (s.pace) body.append(el('p', { className: 'small muted pbNote', textContent: `${z ? `0 a day from ${fmtD(z)}.` : ''} Hard week? Hold one more; nothing breaks.` }), el('div', { className: 'pbAct' }, hold));
      const tg = triggers(g, st, today);
      section('Your triggers', tg.length ? bars(tg.slice(0, 5).map((x) => [x.tag, x.pct, `${x.pct}%`])) : el('div', { className: 'card pbText' }, el('p', { className: 'small muted', textContent: 'Tag what set each one off (on this page, after you log one). The pattern shows up here.' })));
      const zeroRun = (() => { let n = 0; for (let i = 1; i < 400; i++) { const x = st.days[shift(today, -i)]?.values?.[metricKey(g, m)]; if (x == null || Number(x) > 0) break; n++; } return n; })();
      section('When you reach 0 · from WHO', el('div', { className: 'card pbTimeline' }, ...HABIT_PLAYBOOKS.smoking.timeline.map(([days, when, what]) => el('div', { className: `ptl ${zeroRun >= Math.max(1, days) ? 'on' : ''}` }, el('i'), el('b', { textContent: when }), el('span', { textContent: what })))));
    }
    if (pbId === 'scrolling' || (type === 'cut' && pbId !== 'smoking')) {
      const bh = byHour(g, st, today);
      if (bh) {
        const max = Math.max(...bh.map((x) => x.n));
        const top = bh.reduce((a, b) => (b.n > a.n ? b : a));
        section('When it happens most', bars(bh.filter((x) => x.n || x.label !== 'Night').map((x) => [x.label, (x.n / max) * 100, String(round1(x.n)), x === top]), 'amber'),
          el('p', { className: 'small muted pbNote', textContent: `${top.label} is the big one. One plan for that moment does more than a lower limit.` }));
      }
      if (pbId === 'scrolling') section('Instead of scrolling', el('div', { className: 'card pbText' }, el('div', { className: 'chips' }, ...HABIT_PLAYBOOKS.scrolling.swaps.map((x) => el('span', { className: 'chip', textContent: x }))),
        el('p', { className: 'small muted', textContent: 'The pause suggests one of these.' })));
      if (pbId !== 'scrolling') {
        const tg = triggers(g, st, today);
        if (tg.length) section('Your triggers', bars(tg.slice(0, 5).map((x) => [x.tag, x.pct, `${x.pct}%`])));
      }
    }
    if (type === 'rule') {
      const lad = g.ladder || [{ rule: g.rule || g.name, from: today, to: null }];
      const ready = ladderReady(g, st, today);
      const used = new Set(lad.map((x) => x.rule));
      const nextOpts = (pbId === 'diet' ? HABIT_PLAYBOOKS.diet.ladder : []).filter((r) => !used.has(r));
      const list = el('div', { className: 'iosGroup pbLadder' },
        ...lad.map((x) => el('div', { className: 'cell static' }, el('span', { className: 'cMain' }, el('b', { textContent: x.rule }), el('small', { textContent: x.to ? `Kept from ${fmtD(x.from)} · now automatic` : `Since ${fmtD(x.from)}` })), el('span', { className: `pbTag ${x.to ? 'done' : 'now'}`, textContent: x.to ? '✓' : 'Now' }))),
        ...nextOpts.slice(0, 2).map((r) => el('div', { className: 'cell static next' }, el('span', { className: 'cMain' }, el('b', { textContent: r }), el('small', { textContent: ready ? 'Ready when you are' : 'Opens when this one sticks' })))));
      section('Your rule ladder', list);
      if (ready) {
        const input = el('input', { type: 'text', className: 'iosInput', maxLength: 60, placeholder: 'Next rule', value: nextOpts[0] || '' });
        const go = el('button', { type: 'button', className: 'primary', textContent: 'Start the next rule' });
        go.onclick = () => { const r = input.value.trim(); if (!r) return; goalSave((x) => { const l = x.ladder || [{ rule: x.rule || x.name, from: today, to: null }]; l.at(-1).to = today; l.push({ rule: r, from: today, to: null }); x.ladder = l; x.rule = r; x.name = r; }, 'Next rule started. The last one stays yours.'); };
        body.append(el('div', { className: 'card pbText' }, el('p', { innerHTML: '<b>This one has stuck:</b> kept on most of the last three weeks. Ready for the next?' }), input, go));
      }
    }
    if (pbId === 'focus' || (type === 'build' && (m.unit === 'hours' || m.unit === 'min'))) {
      const days = Array.from({ length: 28 }, (_, i) => shift(today, -i));
      const ss = sessionsIn(days, st).filter((x) => (x.goalId ?? 'work') === g.id || pbId === 'focus');
      const slots = [[5, 9, 'Early'], [9, 12, 'Morning'], [12, 15, 'Midday'], [15, 18, 'Afternoon'], [18, 22, 'Evening'], [22, 29, 'Late']].map(([a, b, label]) => {
        const xs = ss.filter((x) => { const h = new Date(x.start).getHours(); const hh = h < 5 ? h + 24 : h; return hh >= a && hh < b; });
        const min = xs.reduce((p, x) => p + (Number(x.workMin) || 0), 0);
        return { label, n: xs.length, avg: xs.length ? min / xs.length : 0 };
      });
      if (ss.length >= 4) {
        const max = Math.max(...slots.map((x) => x.avg));
        const best = slots.reduce((a, b) => (b.avg > a.avg ? b : a));
        section('Your best hours', bars(slots.filter((x) => x.n).map((x) => [x.label, (x.avg / max) * 100, `${Math.round(x.avg)} min`, x === best])),
          el('p', { className: 'small muted pbNote', textContent: `Sessions that start in the ${best.label.toLowerCase()} run longest for you, about ${Math.round(best.avg)} minutes. Put the hardest work there.` }));
      }
      const rs = reasonStats(days, st).filter((x) => x.id !== 'unrecorded' && x.min > 0).slice(0, 4);
      if (rs.length) {
        const tot = rs.reduce((a, x) => a + x.min, 0);
        section('What delayed you · 4 weeks', bars(rs.map((x) => { const r = reasonById(x.id); return [`${r?.icon || ''} ${r?.label || x.id}`, (100 * x.min) / tot, hm(x.min)]; })));
      }
    }
  }

  // ---------- if-then ----------
  function ifThen(g, p) {
    const box = el('div', { className: 'iosGroup pbIf' });
    const mine = g.ifthen || [];
    mine.forEach((x, i) => {
      const rm = el('button', { type: 'button', className: 'ghost small', textContent: '×', ariaLabel: 'Remove' });
      rm.onclick = () => goalSave((y) => { y.ifthen = (y.ifthen || []).filter((_, j) => j !== i); });
      box.append(el('div', { className: 'cell static' }, el('span', { className: 'cMain', innerHTML: `<span><span class="muted">When</span> ${esc(x.when)} <span class="muted">→</span> <b>${esc(x.then)}</b></span>` }), rm));
    });
    const sugg = p.ifthen.filter(([w]) => !mine.some((x) => x.when === w));
    for (const [w, t] of sugg.slice(0, 3)) {
      const b = el('button', { type: 'button', className: 'cell sugg' }, el('span', { className: 'cMain', innerHTML: `<span><span class="muted">When</span> ${esc(w)} <span class="muted">→</span> ${esc(t)}</span>` }), el('span', { className: 'cAdd', textContent: 'Add' }));
      b.onclick = () => goalSave((y) => { y.ifthen = [...(y.ifthen || []), { when: w, then: t }]; }, 'Plan added');
      box.append(b);
    }
    const w = el('input', { type: 'text', className: 'iosInput', maxLength: 60, placeholder: 'When …' });
    const t = el('input', { type: 'text', className: 'iosInput', maxLength: 60, placeholder: 'I will …' });
    const add = el('button', { type: 'button', className: 'soft', textContent: 'Add' });
    add.onclick = () => { if (!w.value.trim() || !t.value.trim()) return; goalSave((y) => { y.ifthen = [...(y.ifthen || []), { when: w.value.trim(), then: t.value.trim() }]; }, 'Plan added'); };
    box.append(el('div', { className: 'cell static pbIfNew' }, w, t, add));
    return box;
  }

  // ---------- setup ----------
  function setupBox(g, pbId, type, m) {
    const box = el('div', { className: 'iosGroup pbSetup' });
    const row = (label, ctl) => el('div', { className: 'editRow' }, el('span', { textContent: label }), ctl);
    const u = m.unit === 'hours' ? 'h' : m.unit === 'min' ? 'min' : '';
    if (!g.smoking?.pace) {
      box.append(row(m.kind === 'daysPerWeek' ? 'Days a week' : m.kind === 'perDayMax' ? 'Daily limit' : m.kind === 'perDayMin' ? 'A day' : 'A week',
        stepper({ value: Number(m.target) || 0, step: m.kind === 'daysPerWeek' ? 1 : stepFor(m.unit), min: 0, max: m.kind === 'daysPerWeek' ? 7 : 999, unit: u, size: 'sm',
          onChange: (x) => goalSave((y) => { y.metrics[0].target = x ?? 0; }) })));
    }
    if (g.smoking) {
      const pace = el('div', { className: 'chips' }, ...[[1, 'Every week'], [2, 'Every 2 weeks'], [0, 'Hold']].map(([p, label]) => {
        const c = el('button', { type: 'button', className: `chip ${g.smoking.pace === p ? 'on' : ''}`, textContent: label });
        c.onclick = () => goalSave((y) => {
          const lim = limitOn(y, today);
          y.smoking = { ...y.smoking, pace: p, start: p ? lim + 1 : y.smoking.start, since: p ? today : y.smoking.since };
          y.metrics[0].target = p ? limitOn(y, today) : lim;
        }, 'Pace changed');
        return c;
      }));
      box.append(el('div', { className: 'editRow col' }, el('span', { textContent: 'Step down one a day' }), pace));
      box.append(row('Price of one', stepper({ value: g.smoking.price || 0, step: 1, min: 0, max: 999, unit: '₹', size: 'sm', onChange: (x) => goalSave((y) => { y.smoking.price = x ?? 0; }) })));
    }
    if (type !== 'cut' || pbId !== 'smoking') {
      const tiny = el('input', { type: 'text', className: 'iosInput', maxLength: 60, value: g.tiny || '', placeholder: 'e.g. Two minutes counts' });
      tiny.onchange = () => goalSave((y) => { const x = tiny.value.trim(); if (x) y.tiny = x; else delete y.tiny; }, 'Saved');
      box.append(el('div', { className: 'editRow col' }, el('span', { textContent: type === 'cut' ? 'When an urge hits, first' : 'Smallest version that counts' }), tiny));
    }
    const cue = el('input', { type: 'time', value: g.cueTime || '', className: 'iosInput timeIn' });
    cue.onchange = () => goalSave((y) => { if (cue.value) y.cueTime = cue.value; else delete y.cueTime; }, cue.value ? `Reminder at ${cue.value}` : 'Reminder off');
    box.append(row('Reminder', cue));
    if (!playbookOf(g).gentle) {
      const tone = g.tone || st.settings.tone || 'direct';
      const seg = el('div', { className: 'chips' }, ...[['gentle', 'Gentle'], ['direct', 'Direct']].map(([id, label]) => {
        const c = el('button', { type: 'button', className: `chip ${tone === id ? 'on' : ''}`, textContent: label });
        c.onclick = () => goalSave((y) => { y.tone = id; });
        return c;
      }));
      box.append(el('div', { className: 'editRow col' }, el('span', { textContent: 'How Athena talks about this one' }), seg,
        el('small', { className: 'muted', textContent: isGentle(g, st.settings) ? 'Gentle: what you’re building, never what you’d lose.' : 'Direct: what a skip would cost, before it happens.' })));
    } else box.append(row('Athena’s tone', el('span', { className: 'muted', textContent: 'Gentle, always' })));
    if (m.kind === 'perDayMax' && underRun(g, st, today) === 0 && !g.smoking) box.append(el('p', { className: 'small muted', textContent: 'Lowering the limit a little every week or two works better than one big cut.' }));
    return box;
  }

  draw();
  return d;
}
