// Rewards (in the app): Kleos ⚡: your rank, this week, what earned or cost points, how to earn.
// (Money rewards were removed in 0.2.0.)

import { kleos, POINTS } from './points.js';
import { el, openDrawer } from './controls.js';
import { parseKey } from './score.js';
import { esc } from './ui.js';

const P = POINTS;
const sign = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

export function openRewardsSheet({ getState, today }) {
  const body = el('div', { className: 'rewardsSheet' });
  const draw = () => {
    const state = getState();
    const K = kleos(state, today);
    body.innerHTML = '';
    {
      const r = K.rank;
      body.append(el('div', { className: 'rankCard', innerHTML: `
        <div class="rkTop"><span class="rkLevel">Rank ${r.level}</span><span class="rkName">${esc(r.name)}</span></div>
        <div class="rkTotal">${K.total.toLocaleString('en-IN')} <small>${P.icon} ${P.name}</small></div>
        <div class="rkBar"><i style="width:${Math.round(Math.min(1, r.frac) * 100)}%"></i></div>
        <div class="rkNext">${r.next ? `${(r.next.at - K.total).toLocaleString('en-IN')} to ${esc(r.next.name)}` : 'The highest rank. A legend.'}</div>
        <div class="rkStats"><span><b>${sign(K.today)}</b> today</span><span><b>${sign(K.week)}</b> this week</span></div>` }));
      // the latest events, by day
      const recent = K.events.slice(0, 40);
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
      // how to earn
      const rules = [
        ['Plan a task', P.taskCreated, `up to ${P.taskCreatedDailyCap} a day`], ['Finish a task', P.taskDone, `+${P.perHourEstimate} per estimated hour (max +${P.sizeBonusMax})`],
        ['Finish a subtask', P.subtaskDone, ''], ['Done by the deadline', P.onTime, ''], ['Habit done', P.habitDone, ''], ['Bad habit within its limit', P.limitKept, 'per day'],
        ['Daily goal reached', P.dailyGoalMet, ''], ['Weekly total reached', P.weeklyGoalMet, ''], ['Focus', P.per5MinFocus, `per 5 min (max ${P.focusMaxPerSession} a session)`],
        ['Quick start (within 2 min)', P.quickStart, ''], ['Streaks', P.streakMilestones[7], `at 3, 7, 14, 30, 60, 100 days (${Object.values(P.streakMilestones).join(' / ')})`], ['Green week', P.greenWeek, ''],
        ['Back on course after a break', P.comeback, ''], ['An urge ridden out', P.urgeResisted, `up to ${P.urgeDailyCap} a day`], ['Head start: a tiny habit done in your first two weeks', P.tinyStartBonus, ''],
        ['Task past its deadline', P.overduePerDay, `per day (max ${P.overdueMax})`], ['Habit skipped', P.habitSkipped, ''], ['Planned day missed', P.habitMissedPlannedDay, ''],
        ['Bad habit over its limit', P.limitBroken, ''], ['Procrastinating past 15 min', P.procrastPer10Min, `per 10 min (max ${P.procrastMaxPerSession})`], ['Streak broken (unless a shield saves it)', P.streakBroken, 'one Aegis shield per 7 days in a row, up to 2'],
      ];
      const g = el('div', { className: 'iosGroup' });
      for (const [what, pts, note] of rules) g.append(el('div', { className: `cell static ${pts < 0 ? 'neg' : ''}`, innerHTML: `<span class="cMain"><span>${esc(what)}</span>${note ? `<small>${esc(note)}</small>` : ''}</span><b class="pts">${sign(pts)}</b>` }));
      body.append(el('div', { className: 'groupHead', textContent: 'How to earn' }), g);
      const ranks = el('div', { className: 'iosGroup' });
      for (const [at, name] of P.ranks) ranks.append(el('div', { className: `cell static ${K.total >= at ? '' : 'dim'}`, innerHTML: `<span class="cMain"><span>${K.rank.name === name ? '⚓ ' : ''}${esc(name)}</span></span><b>${at.toLocaleString('en-IN')}</b>` }));
      body.append(el('div', { className: 'groupHead', textContent: 'Ranks' }), ranks);
    }
  };
  draw();
  return openDrawer('Rewards', body);
}
