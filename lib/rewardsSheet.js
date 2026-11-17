// Rewards (in the app): Kleos ⚡ (rank, this week, what earned or cost points, how to earn) and the ₹ wallet
// (this week's habit rewards, the marketplace, purchases).

import { REWARDS, ledger, money, REWARD_STATUS } from './rewards.js';
import { kleos, POINTS } from './points.js';
import { buyItem, undoPurchase } from './storage.js';
import { el, openDrawer, toast } from './controls.js';
import { parseKey, weekKeyOf } from './score.js';
import { esc } from './ui.js';

const P = POINTS;
const sign = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

export function openRewardsSheet({ getState, today, onChanged = () => {} }) {
  const body = el('div', { className: 'rewardsSheet' });
  let tab = 'kleos';
  const draw = () => {
    const state = getState();
    const K = kleos(state, today);
    const L = ledger(state, today);
    body.innerHTML = '';
    const seg = el('div', { className: 'seg' });
    for (const [k, t] of [['kleos', `${P.icon} ${P.name}`], ['wallet', '💰 Wallet']]) {
      const b = el('button', { type: 'button', className: k === tab ? 'on' : '', textContent: t });
      b.onclick = () => { tab = k; draw(); };
      seg.append(b);
    }
    body.append(seg);

    if (tab === 'kleos') {
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
        ['Task past its deadline', P.overduePerDay, `per day (max ${P.overdueMax})`], ['Habit skipped', P.habitSkipped, ''], ['Planned day missed', P.habitMissedPlannedDay, ''],
        ['Bad habit over its limit', P.limitBroken, ''], ['Procrastinating past 15 min', P.procrastPer10Min, `per 10 min (max ${P.procrastMaxPerSession})`], ['Streak broken', P.streakBroken, ''],
      ];
      const g = el('div', { className: 'iosGroup' });
      for (const [what, pts, note] of rules) g.append(el('div', { className: `cell static ${pts < 0 ? 'neg' : ''}`, innerHTML: `<span class="cMain"><span>${esc(what)}</span>${note ? `<small>${esc(note)}</small>` : ''}</span><b class="pts">${sign(pts)}</b>` }));
      body.append(el('div', { className: 'groupHead', textContent: 'How to earn' }), g);
      const ranks = el('div', { className: 'iosGroup' });
      for (const [at, name] of P.ranks) ranks.append(el('div', { className: `cell static ${K.total >= at ? '' : 'dim'}`, innerHTML: `<span class="cMain"><span>${K.rank.name === name ? '⚓ ' : ''}${esc(name)}</span></span><b>${at.toLocaleString('en-IN')}</b>` }));
      body.append(el('div', { className: 'groupHead', textContent: 'Ranks' }), ranks);
      return;
    }

    // wallet
    body.append(el('div', { className: 'rankCard wallet', innerHTML: `<div class="rkTop"><span class="rkLevel">Balance</span></div><div class="rkTotal">${money(L.balance)}</div>
      <div class="rkStats"><span><b>${money(L.earned)}</b> earned</span><span><b>${money(L.atStake)}</b> in play this week</span></div>` }));
    if (L.current) {
      const g = el('div', { className: 'iosGroup' });
      for (const r of L.current.rows) g.append(el('div', { className: 'cell static', innerHTML: `<span class="cIcon">${r.icon}</span><span class="cMain"><b>${esc(r.name)} · ${money(r.amount)}</b><small>${REWARD_STATUS[r.status].icon} ${REWARD_STATUS[r.status].label} · ${esc(r.text)}</small></span>` }));
      body.append(el('div', { className: 'groupHead', textContent: 'This week (pays when a habit hits 100%)' }), g);
    }
    const mk = el('div', { className: 'iosGroup' });
    for (const it of REWARDS.marketplace) {
      const can = L.balance >= it.price;
      const owned = (state.purchases || []).filter((p) => p.itemId === it.id).length;
      const buy = el('button', { type: 'button', className: can ? 'primary small' : 'small', textContent: 'Buy', disabled: !can });
      buy.onclick = async () => {
        if (!confirm(`Spend ${money(it.price)} of your rewards on ${it.name}? Balance after: ${money(L.balance - it.price)}.`)) return;
        await buyItem(it); toast(`${it.name}: enjoy it!`); onChanged(); draw();
      };
      const c = el('div', { className: 'cell static', innerHTML: `<span class="cIcon">${it.icon}</span><span class="cMain"><b>${esc(it.name)}</b><small>${money(it.price)}${can ? ' · you can afford it' : ` · ${money(it.price - Math.max(0, L.balance))} to go`}${owned ? ` · bought ${owned}×` : ''}</small><span class="miniBar"><i style="width:${Math.round(Math.max(0, Math.min(1, L.balance / it.price)) * 100)}%"></i></span></span>` });
      c.append(buy);
      mk.append(c);
    }
    body.append(el('div', { className: 'groupHead', textContent: 'Marketplace' }), mk);
    const ps = [...(state.purchases || [])].reverse();
    if (ps.length) {
      const g = el('div', { className: 'iosGroup' });
      for (const p of ps) {
        const undo = el('button', { type: 'button', className: 'ghost small', textContent: 'Undo' });
        undo.onclick = async () => { if (confirm('Undo this purchase? The money goes back to your balance.')) { await undoPurchase(p.id); onChanged(); draw(); } };
        const c = el('div', { className: 'cell static', innerHTML: `<span class="cMain"><b>${esc(p.name)}</b><small>${money(p.price)} · ${new Date(p.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></span>` });
        c.append(undo);
        g.append(c);
      }
      body.append(el('div', { className: 'groupHead', textContent: 'Bought' }), g);
    }
  };
  draw();
  return openDrawer('Rewards', body);
}
