// The voyage, sailed by Kleos. Pure, worked out from your data every time (never stored), so every device
// shows the same.
//
// Day by day from POINTS.start: the day's Kleos moves the ship toward the next harbour (it never sails back
// past a harbour it reached). Each VOYAGE.leg of Kleos reaches the next harbour and unlocks its rewards.
// A week (Sat → Fri) that ends below zero is a storm: the ship is blown to a peril. On a peril the ship
// doesn't move; one trial, from that week's weakest habit, gets it out (+VOYAGE.escapeBonus and a laurel).
// A trial not passed by Friday renews, a little smaller. Reaching Ithaca starts the next voyage.

import { POINTS, VOYAGE } from '../rewards.config.js';
import { pointEvents } from './points.js';
import { HARBOURS, PERILS } from './harbours.js';
import { dateKey, addDays, parseKey, weekKeyOf, weekDays, metricKey, isPaused } from './score.js';
import { typeOf } from './playbooks.js';

export { HARBOURS, PERILS };
const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const val = (state, k, key) => state.days?.[k]?.values?.[key];

// The trial for a peril, from the stormy week's weakest habit. → { kind, goalId, name, need, text }
export function pickTrial(state, wk) {
  const goals = state.weeks?.[wk]?.goals || [];
  const days = weekDays(wk);
  let best = null;
  for (const g of goals) {
    const m = g.metrics?.[0];
    if (!m || typeOf(g) === 'rule') continue;
    const key = metricKey(g, m);
    const t = Number(m.target) || 0;
    if (m.kind === 'daysPerWeek' && t > 0) {
      const done = days.filter((d) => val(state, d, key) === true).length;
      const short = (t - done) / t;
      if (!best || short > best.short) best = { short, kind: 'days', goalId: g.id, name: g.name, need: Math.max(1, Math.min(t, Math.round((t * 2) / 3))) };
    } else if (m.kind === 'perDayMax') {
      const over = days.filter((d) => { const v = val(state, d, key); return v != null && v !== '' && Number(v) > t; }).length;
      const short = over / 7;
      if (over && (!best || short > best.short)) best = { short, kind: 'under', goalId: g.id, name: g.name, need: 5 };
    } else if (m.kind === 'perDayMin' && t > 0) {
      const hit = days.filter((d) => Number(val(state, d, key)) >= t).length;
      const short = 1 - hit / 5;
      if (!best || short > best.short) best = { short, kind: 'min', goalId: g.id, name: g.name, need: 3 };
    }
  }
  if (!best || best.short <= 0) best = { kind: 'tasks', goalId: null, name: 'tasks', need: 2 };
  delete best.short;
  return { ...best, text: trialText(best) };
}
export function trialText(t) {
  if (t.kind === 'days') return `${t.name} ${t.need} time${t.need === 1 ? '' : 's'} this week`;
  if (t.kind === 'under') return `Under your ${t.name.toLowerCase()} limit on ${t.need} of 7 days`;
  if (t.kind === 'min') return `${t.name}: reach your daily goal on ${t.need} days`;
  return `Finish ${t.need} task${t.need === 1 ? '' : 's'} this week`;
}
const smaller = (t) => { const need = Math.max(1, t.need - 1); return { ...t, need, text: trialText({ ...t, need }) }; };

// How a trial is going in week wk, up to uptoKey. → { have, need, passed }
export function trialProgress(state, t, wk, uptoKey) {
  const days = weekDays(wk).filter((d) => d <= uptoKey);
  const g = (state.weeks?.[wk]?.goals || []).find((x) => x.id === t.goalId) || Object.values(state.weeks || {}).flatMap((w) => w.goals || []).find((x) => x.id === t.goalId);
  const m = g?.metrics?.[0];
  let have = 0;
  if (t.kind === 'tasks') {
    have = Object.values(state.tickets || {}).filter((x) => !x.parentId && x.status === 'done' && x.doneAt && days.includes(dateKey(new Date(x.doneAt)))).length;
  } else if (m) {
    const key = metricKey(g, m);
    const tg = Number(m.target) || 0;
    if (t.kind === 'days') have = days.filter((d) => val(state, d, key) === true).length;
    if (t.kind === 'under') have = days.filter((d) => { const v = val(state, d, key); return v != null && v !== '' && Number(v) <= tg; }).length;
    if (t.kind === 'min') have = days.filter((d) => Number(val(state, d, key)) >= tg).length;
  }
  return { have: Math.min(have, t.need), need: t.need, passed: have >= t.need };
}

/**
 * → { voyageNo, harbour (0–11, reached), at: HARBOURS[harbour], next, meter, leg, toNext, pct,
 *     peril: null | { ...PERILS[i], since (week), day (1–7), trial, progress }, earned, week, log: [{ type, day, ... }] }
 * log types: 'harbour' { index, voyageNo }, 'storm' { peril, net, wk, trial }, 'escape' { peril }
 */
export function sail(state, todayKey = dateKey(), { leg = VOYAGE.leg, bonus = VOYAGE.escapeBonus } = {}) {
  const events = pointEvents(state, todayKey);
  const byDay = {};
  for (const e of events) byDay[e.day] = (byDay[e.day] || 0) + e.pts;
  let harbour = 0, meter = 0, voyageNo = 1, peril = null, storms = 0, earned = 0;
  const log = [];
  const start = POINTS.start;
  for (let d = start; d <= todayKey; d = shift(d, 1)) {
    const pts = byDay[d] || 0;
    if (pts > 0) earned += pts;
    const wk = weekKeyOf(d);
    if (peril) {
      if (wk >= peril.since) {
        const pr = trialProgress(state, peril.trial, wk, d);
        if (pr.passed) {
          log.push({ type: 'escape', day: d, peril: peril.id, laurel: peril.laurel });
          meter += bonus; earned += bonus;
          peril = null;
        } else if (d === weekDays(wk)[6] && d < todayKey) {
          peril = { ...peril, since: shift(wk, 7), trial: smaller(peril.trial), weeks: (peril.weeks || 1) + 1 };
        }
      }
    } else {
      meter = Math.max(0, meter + pts);
    }
    while (!peril && meter >= leg) {
      meter -= leg;
      harbour++;
      if (harbour >= HARBOURS.length) { harbour = 0; voyageNo++; }
      log.push({ type: 'harbour', day: d, index: harbour, voyageNo });
    }
    // end of a finished week: below zero is a storm
    if (!peril && d === weekDays(wk)[6] && d < todayKey) {
      const days = weekDays(wk);
      const net = days.reduce((a, k) => a + (byDay[k] || 0), 0);
      const paused = days.every((k) => isPaused(state, k));
      if (net < 0 && !paused && state.weeks?.[wk]) {
        const p = PERILS[storms % PERILS.length];
        storms++;
        const trial = pickTrial(state, wk);
        peril = { ...p, since: shift(wk, 7), trial, weeks: 1 };
        log.push({ type: 'storm', day: shift(d, 1), peril: p.id, net, wk, trial });
      }
    }
  }
  const cur = weekKeyOf(todayKey);
  const week = weekDays(cur).filter((k) => k <= todayKey).reduce((a, k) => a + (byDay[k] || 0), 0);
  const next = HARBOURS[(harbour + 1) % HARBOURS.length];
  const out = {
    voyageNo, harbour, at: HARBOURS[harbour], next, nextIndex: (harbour + 1) % HARBOURS.length,
    meter: Math.round(meter), leg, toNext: Math.max(0, Math.round(leg - meter)), pct: Math.min(100, Math.round((100 * meter) / leg)),
    earned: Math.round(earned), week, log, peril: null,
  };
  if (peril) {
    const wk = peril.since > cur ? peril.since : cur;
    const pr = peril.since > cur ? { have: 0, need: peril.trial.need, passed: false } : trialProgress(state, peril.trial, cur, todayKey);
    const started = log.filter((l) => l.type === 'storm').at(-1)?.day || todayKey;
    out.peril = { ...peril, progress: pr, week: wk, day: Math.max(1, Math.round((parseKey(todayKey) - parseKey(started)) / 864e5) + 1), by: weekDays(wk)[6] };
  }
  return out;
}

// Rewards at each harbour (1–12), with where they stand. rewards: [{ id, harbour, icon, name }]
// → [{ ...r, unlocked, claimed, here: harbour index (0–11) }]
export function harbourRewards(v, rewards, claims = {}) {
  return (rewards || []).map((r) => {
    const here = Math.max(0, Math.min(HARBOURS.length - 1, Number(r.harbour) - 1));
    return { ...r, here, unlocked: v.voyageNo > 1 || v.harbour >= here, claimed: !!claims[r.id] };
  }).sort((a, b) => a.here - b.here);
}

// What blew a week off course, in a few words: "4 planned gym days missed, 2 tasks overdue". → text | null
export function stormReasons(state, wk, todayKey = dateKey()) {
  const days = new Set(weekDays(wk));
  const ev = pointEvents(state, todayKey).filter((e) => e.pts < 0 && days.has(e.day));
  const count = {};
  const tasks = new Set();
  for (const e of ev) {
    let m;
    if ((m = e.text.match(/^Missed planned (.+)$/))) count[`m|${m[1]}`] = (count[`m|${m[1]}`] || 0) + 1;
    else if ((m = e.text.match(/^Skipped (.+)$/))) count[`s|${m[1]}`] = (count[`s|${m[1]}`] || 0) + 1;
    else if ((m = e.text.match(/^(.+) over the limit$/))) count[`o|${m[1]}`] = (count[`o|${m[1]}`] || 0) + 1;
    else if ((m = e.text.match(/^Overdue: (.+)$/))) tasks.add(m[1]);
  }
  const lower = (s) => (/[A-Z]/.test(s.slice(1)) ? s : s.toLowerCase());
  const bits = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const [kind, name] = k.split('|');
    if (kind === 'm') return `${n} planned ${lower(name)} day${n === 1 ? '' : 's'} missed`;
    if (kind === 's') return `${lower(name)} skipped ${n === 1 ? 'once' : `${n} times`}`;
    return `${lower(name)} over the limit ${n === 1 ? 'once' : `on ${n} days`}`;
  });
  if (tasks.size) bits.push(`${tasks.size} task${tasks.size === 1 ? '' : 's'} overdue`);
  const top = bits.slice(0, 3);
  return top.length ? `${top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top.at(-1)}` : top[0]}.` : null;
}
