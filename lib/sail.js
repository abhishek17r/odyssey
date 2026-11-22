// The voyage, sailed by Kleos. Pure, worked out from your data every time (never stored), so every device
// shows the same.
//
// Day by day from POINTS.start: the day's Kleos moves the ship toward the next harbour (it never sails back
// past a harbour it reached). Each VOYAGE.leg of Kleos reaches the next harbour and unlocks its rewards.
// 1.10: a finished week under 60% on track is a storm: the ship waits at a peril. One good day gets it out
// (two things done: 20 Kleos or more), with +VOYAGE.escapeBonus. Nothing earned is ever taken back, and Kleos
// never goes down. Reaching Ithaca starts the next voyage.

import { POINTS, VOYAGE } from '../rewards.config.js';
import { pointEvents, keptOn, plannedOn } from './points.js';
import { HARBOURS, PERILS } from './harbours.js';
import { dateKey, addDays, parseKey, weekKeyOf, weekDays, metricKey, isPaused, weekSummary } from './score.js';

export const STORM_UNDER = 60; // a finished week under this % on track
export const GOOD_DAY = 20;     // Kleos in a day that gets you out (two things done)
// A finished week's on-track %: each habit's share of its plan, averaged (null when nothing was planned)
export function weekPct(state, wk) {
  const days = weekDays(wk);
  const xs = (state.weeks?.[wk]?.goals || []).map((g) => adherence(state, g, days)).filter((x) => x != null);
  return xs.length ? Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) : null;
}
export const LEG = 200; // Kleos from one harbour to the next: a good week or two (1.10; was 350 with the old points)
export const DAY_TRIAL = { kind: 'day', need: 1, text: 'One good day: two things done' };
import { typeOf } from './playbooks.js';
import { adherence } from './engine.js';

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
  if (t.kind === 'day') return t.text;
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
export function sail(state, todayKey = dateKey(), { leg = LEG, bonus = VOYAGE.escapeBonus } = {}) {
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
      if (d >= peril.since && pts >= GOOD_DAY) {
        log.push({ type: 'escape', day: d, peril: peril.id });
        meter += bonus; earned += bonus;
        peril = null;
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
    // end of a finished week: under 60% on track is a storm (not a paused week, not a week with no habits)
    if (!peril && d === weekDays(wk)[6] && d < todayKey && state.weeks?.[wk]?.goals?.length) {
      const days = weekDays(wk);
      const paused = days.filter((k) => isPaused(state, k)).length >= 4;
      const pct = weekPct(state, wk);
      if (pct != null && pct < STORM_UNDER && !paused) {
        const p = PERILS[storms % PERILS.length];
        storms++;
        peril = { ...p, since: shift(d, 1), trial: DAY_TRIAL, weeks: 1 };
        log.push({ type: 'storm', day: shift(d, 1), peril: p.id, pct, wk, trial: DAY_TRIAL });
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
    const started = log.filter((l) => l.type === 'storm').at(-1)?.day || todayKey;
    const today = todayKey >= peril.since ? byDay[todayKey] || 0 : 0;
    out.peril = { ...peril, progress: { have: Math.min(today, GOOD_DAY), need: GOOD_DAY, passed: false }, week: cur, day: Math.max(1, Math.round((parseKey(todayKey) - parseKey(started)) / 864e5) + 1), by: todayKey };
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

// What blew a week off course, in a few words: "Gym 25% on track and Scrolling 40%". → text | null
export function stormReasons(state, wk) {
  const days = weekDays(wk);
  const rows = (state.weeks?.[wk]?.goals || []).map((g) => {
    const kept = days.filter((k) => keptOn(state, g, k)).length;
    const m = g.metrics?.[0];
    const need = m?.kind === 'daysPerWeek' ? Number(m.target) || 0 : days.filter((k) => plannedOn(m || {}, k)).length;
    return { name: g.name, kept, need };
  }).filter((r) => r.need > 0 && r.kept < r.need).sort((a, b) => a.kept / a.need - b.kept / b.need).slice(0, 2);
  if (!rows.length) return null;
  const bits = rows.map((r) => `${r.name} ${r.kept} of ${r.need} ${r.need === 1 ? 'day' : 'days'}`);
  return `${bits.join(' and ')}.`;
}
