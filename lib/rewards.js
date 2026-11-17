// Rewards wallet: what each week paid (worked out from check-ins, never stored), what you spent
// (state.purchases), and the balance. Pure functions; the rules live in rewards.config.js.

import { REWARDS } from '../rewards.config.js';
import { weekDays, weekKeyOf, metricKey, round1, parseKey, addDays, dateKey } from './score.js';

export { REWARDS };
export const money = (n) => `${REWARDS.currency}${Math.round(n).toLocaleString('en-IN')}`;
export const ruleFor = (goalId) => REWARDS.rules.find((r) => r.goalId === goalId) || null;

const val = (state, k, key) => state.days[k]?.values?.[key];
const has = (v) => v != null && v !== '';

// One metric over a whole week → { ok: true|false|null (null = can still go either way), text }
function metricWeekDone(g, m, wk, state, todayKey) {
  const days = weekDays(wk);
  const key = metricKey(g, m);
  const t = Number(m.target) || 0;
  const past = days.filter((k) => k <= todayKey);
  const over = days[6] < todayKey;
  if (m.kind === 'daysPerWeek') {
    const done = days.filter((k) => val(state, k, key) === true).length;
    const left = days.filter((k) => k > todayKey || (k === todayKey && val(state, k, key) !== true)).length;
    if (done >= t) return { ok: true, text: `${done}/${t} days` };
    return { ok: over || done + left < t ? false : null, text: `${done}/${t} days` };
  }
  if (m.kind === 'perWeekSum') {
    const sum = days.reduce((a, k) => a + (Number(val(state, k, key)) || 0), 0);
    if (sum >= t) return { ok: true, text: `${round1(sum)}/${t} ${m.unit}` };
    return { ok: over ? false : null, text: `${round1(sum)}/${t} ${m.unit}` };
  }
  if (m.kind === 'perDayMax' || m.kind === 'perDayMin') {
    const fine = (v) => (m.kind === 'perDayMax' ? Number(v) <= t : Number(v) >= t);
    const bad = past.filter((k) => has(val(state, k, key)) && !fine(val(state, k, key)));
    const good = days.filter((k) => has(val(state, k, key)) && fine(val(state, k, key))).length;
    const unlogged = past.filter((k) => !has(val(state, k, key)) && k < todayKey);
    const text = `${good}/7 days on target${unlogged.length ? ` · ${unlogged.length} not logged` : ''}`;
    if (bad.length) return { ok: false, text: `${text} · over on ${bad.length}` };
    if (good === 7) return { ok: true, text };
    return { ok: over ? false : null, text };
  }
  return { ok: false, text: 'not a weekly target' };
}

// A rule for one week → { goalId, name, icon, amount, status, text, paid }
//   status: earned | missed | locked (target reached, pays when the week ends) | open | notPlanned | tooEasy
export function ruleWeek(rule, wk, state, todayKey) {
  const g = state.weeks[wk]?.goals.find((x) => x.id === rule.goalId);
  const base = { goalId: rule.goalId, amount: rule.amount, name: g?.name || rule.goalId, icon: g?.icon || '⭐', paid: false };
  if (!g) return { ...base, status: 'notPlanned', text: 'Not in this week’s plan' };
  const m0 = g.metrics[0];
  const tgt = Number(m0?.target) || 0;
  if (rule.minTarget != null && tgt < rule.minTarget) return { ...base, status: 'tooEasy', text: `Target ${tgt} is below the ${rule.minTarget} needed for the reward` };
  if (rule.maxTarget != null && tgt > rule.maxTarget) return { ...base, status: 'tooEasy', text: `Limit ${tgt} is above the ${rule.maxTarget} allowed for the reward` };
  const parts = g.metrics.map((m) => metricWeekDone(g, m, wk, state, todayKey));
  const text = parts.map((p) => p.text).join(' · ');
  const over = weekDays(wk)[6] < todayKey;
  if (parts.some((p) => p.ok === false)) return { ...base, status: 'missed', text };
  if (parts.every((p) => p.ok === true)) return over ? { ...base, status: 'earned', text, paid: true } : { ...base, status: 'locked', text };
  return { ...base, status: 'open', text };
}

export const REWARD_STATUS = {
  earned: { label: 'Earned', icon: '💰' },
  locked: { label: 'Locked in, pays Friday night', icon: '🔒' },
  open: { label: 'In play', icon: '⏳' },
  missed: { label: 'Missed', icon: '✕' },
  notPlanned: { label: 'Not planned', icon: '—' },
  tooEasy: { label: 'Target too easy', icon: '⚠️' },
};

// Every week from startWeek to this one → { weeks: [{ wk, rows, earned }], earned, spent, balance, current }
export function ledger(state, todayKey) {
  const cur = weekKeyOf(todayKey);
  const weeks = [];
  for (let wk = REWARDS.startWeek; wk <= cur; wk = dateKey(addDays(parseKey(wk), 7))) {
    const rows = REWARDS.rules.map((r) => ruleWeek(r, wk, state, todayKey));
    weeks.push({ wk, rows, earned: rows.filter((r) => r.paid).reduce((a, r) => a + r.amount, 0) });
  }
  const earned = weeks.reduce((a, w) => a + w.earned, 0);
  const spent = (state.purchases || []).reduce((a, p) => a + p.price, 0);
  const current = weeks.find((w) => w.wk === cur) || null;
  const atStake = current ? current.rows.filter((r) => r.status === 'open' || r.status === 'locked').reduce((a, r) => a + r.amount, 0) : 0;
  return { weeks: weeks.reverse(), earned, spent, balance: earned - spent, current, atStake };
}
