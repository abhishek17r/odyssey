// Rewards (in the app): your rank and Kleos, the voyage from Troy to Ithaca, Aegis shields, laurels,
// what earned or cost points lately; how to earn and the ranks fold away below.

import { kleos, POINTS } from './points.js';
import { voyage, laurels, LEGS } from './voyage.js';
import { voyageSvg } from './voyageMap.js';
import { el, openDrawer } from './controls.js';
import { parseKey, streakInfo, SHIELD_MAX } from './score.js';
import { esc } from './ui.js';

const P = POINTS;
const sign = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
const fmtDay = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function openRewardsSheet({ getState, today }) {
  const body = el('div', { className: 'rewardsSheet' });
  const draw = () => {
    const state = getState();
    const K = kleos(state, today);
    const V = voyage(state, today);
    const S = streakInfo(state, today);
    const L = laurels(state, today);
    body.innerHTML = '';

    // rank, Kleos, shields
    const r = K.rank;
    const shields = Array.from({ length: SHIELD_MAX }, (_, i) => `<i class="${i < S.shields ? 'on' : ''}"></i>`).join('');
    body.append(el('div', { className: 'rankCard', innerHTML: `
      <div class="rkTop"><span class="rkLevel">Rank ${r.level}</span><span class="rkName">${esc(r.name)}</span></div>
      <div class="rkTotal">${K.total.toLocaleString('en-IN')} <small>${P.icon} ${P.name}</small></div>
      <div class="rkBar"><i style="width:${Math.round(Math.min(1, r.frac) * 100)}%"></i></div>
      <div class="rkNext">${r.next ? `${(r.next.at - K.total).toLocaleString('en-IN')} to ${esc(r.next.name)}` : 'The highest rank. A legend.'}</div>
      <div class="rkStats"><span><b>${sign(K.today)}</b> today</span><span><b>${sign(K.week)}</b> this week</span><span class="rkShields" title="Aegis shields: one per 7 days in a row; a missed day uses one">Aegis ${shields}</span></div>` }));

    // the voyage
    const legs = V.legsSailed % LEGS;
    const vbox = el('div', { className: 'voyageBox' });
    vbox.innerHTML = voyageSvg(V);
    vbox.append(el('div', { className: 'vmCaption', innerHTML: `<b>${V.voyage > 1 ? `Voyage ${V.voyage} · ` : ''}${legs} of ${LEGS} legs sailed</b><span>Next: ${esc(V.next?.name || 'Ithaca')}. ${esc(V.next?.note || '')}</span>
      <span class="vmWeek">This week: ${V.thisWeek == null ? 'nothing logged yet' : V.progress >= 1 ? 'a fair wind, this leg is yours' : `${Math.round(V.progress * 100)}% of the way to a fair wind`}</span>` }));
    body.append(el('div', { className: 'groupHead', textContent: 'The voyage' }), vbox,
      el('p', { className: 'small muted sheetNote', textContent: 'Each week you keep your focus habits at least 60% of the time sails one leg. A weaker week is a storm: the ship holds, it never goes back.' }));

    // laurels
    if (L.earned.length || L.next.length) {
      const g = el('div', { className: 'iosGroup laurels' });
      for (const l of [...L.earned].reverse().slice(0, 6)) g.append(el('div', { className: 'cell static', innerHTML: `<span class="lIcon">🌿</span><span class="cMain"><b>${esc(l.title)}</b><small>${esc(l.detail)} · ${fmtDay(l.day)}</small></span>` }));
      if (L.earned.length > 6) g.append(el('div', { className: 'cell static', innerHTML: `<span class="cMain"><small>and ${L.earned.length - 6} more</small></span>` }));
      for (const n of L.next) g.append(el('div', { className: 'cell static dim', innerHTML: `<span class="lIcon">○</span><span class="cMain"><b>${esc(n.title)}</b><small>${esc(n.detail)} · ${n.have} of ${n.need}</small><span class="miniBar"><i style="width:${Math.round(Math.min(1, n.have / n.need) * 100)}%"></i></span></span>` }));
      body.append(el('div', { className: 'groupHead', textContent: `Laurels · ${L.earned.length}` }), g);
    }

    // the latest Kleos, by day
    const recent = K.events.slice(0, 15);
    if (recent.length) {
      const g = el('div', { className: 'iosGroup' });
      let day = '';
      for (const e of recent) {
        if (e.day !== day) {
          day = e.day;
          g.append(el('div', { className: 'cellHead', textContent: e.day === today ? 'Today' : parseKey(e.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) }));
        }
        g.append(el('div', { className: `cell static evt ${e.pts < 0 ? 'neg' : ''}`, innerHTML: `<span class="cMain"><span>${esc(e.text)}</span></span><b class="pts">${sign(e.pts)}</b>` }));
      }
      body.append(el('div', { className: 'groupHead', textContent: 'Recent' }), g);
    } else body.append(el('p', { className: 'small muted sheetNote', textContent: 'Nothing yet. Plan a task, finish it, log a habit: points show up here.' }));

    // how to earn, ranks: folded away
    const rules = [
      ['Plan a task', P.taskCreated, `up to ${P.taskCreatedDailyCap} a day`], ['Finish a task', P.taskDone, `+${P.perHourEstimate} per estimated hour (max +${P.sizeBonusMax})`],
      ['Finish a subtask', P.subtaskDone, ''], ['Done by the deadline', P.onTime, ''], ['Habit done', P.habitDone, ''], ['Bad habit within its limit', P.limitKept, 'per day'],
      ['Daily goal reached', P.dailyGoalMet, ''], ['Weekly total reached', P.weeklyGoalMet, ''], ['Focus', P.per5MinFocus, `per 5 min (max ${P.focusMaxPerSession} a session)`],
      ['Quick start (within 2 min)', P.quickStart, ''], ['Streaks', P.streakMilestones[7], `at 3, 7, 14, 30, 60, 100 days (${Object.values(P.streakMilestones).join(' / ')})`], ['Green week', P.greenWeek, ''],
      ['A laurel', P.laurel, 'milestones: first time, 10, 30, 100, a full week, smoke-free days'], ['Athena’s favour', P.favour, 'now and then, on a day you kept everything'],
      ['Back on course after a break', P.comeback, ''], ['An urge ridden out', P.urgeResisted, `up to ${P.urgeDailyCap} a day`], ['Head start: a tiny habit done in your first two weeks', P.tinyStartBonus, ''],
      ['Task past its deadline', P.overduePerDay, `per day (max ${P.overdueMax})`], ['Habit skipped', P.habitSkipped, ''], ['Planned day missed', P.habitMissedPlannedDay, ''],
      ['Bad habit over its limit', P.limitBroken, ''], ['Procrastinating past 15 min', P.procrastPer10Min, `per 10 min (max ${P.procrastMaxPerSession})`], ['Streak broken (unless a shield saves it)', P.streakBroken, 'one Aegis shield per 7 days in a row, up to 2'],
    ];
    const how = el('details', { className: 'foldGroup' }, el('summary', { textContent: 'How to earn Kleos' }));
    const g = el('div', { className: 'iosGroup' });
    for (const [what, pts, note] of rules) g.append(el('div', { className: `cell static ${pts < 0 ? 'neg' : ''}`, innerHTML: `<span class="cMain"><span>${esc(what)}</span>${note ? `<small>${esc(note)}</small>` : ''}</span><b class="pts">${sign(pts)}</b>` }));
    how.append(g);
    const rk = el('details', { className: 'foldGroup' }, el('summary', { textContent: 'Ranks' }));
    const ranks = el('div', { className: 'iosGroup' });
    for (const [at, name] of P.ranks) ranks.append(el('div', { className: `cell static ${K.total >= at ? '' : 'dim'}`, innerHTML: `<span class="cMain"><span>${K.rank.name === name ? '⚓ ' : ''}${esc(name)}</span></span><b>${at.toLocaleString('en-IN')}</b>` }));
    rk.append(ranks);
    body.append(how, rk);
  };
  draw();
  return openDrawer('Rewards', body);
}
