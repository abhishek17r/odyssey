// The voyage, laurels and Athena's favour: what Kleos means over months. Pure, worked out from your data
// every time (never stored), so every device shows the same.
//
// The voyage: Troy to Ithaca in 12 legs. Each finished week that went well sails one leg; a weak week is a
// storm that holds the ship where it is. It never goes back. Reaching Ithaca starts the next voyage.
// Laurels: milestones per habit (first week, 10, 30, 100; smoke-free days and weeks; focus hours).
// Athena's favour: now and then, on a day you kept everything, a small surprise (at most once a week).

import { weekKeyOf, weekDays, dateKey, addDays, parseKey, metricKey, isPaused, sessionsIn, weekSummary, planOf } from './score.js';
import { adherence, kindOf } from './engine.js';
import { MARKET } from '../rewards.config.js';

export const PORTS = [
  { name: 'Troy', note: 'Where the voyage begins' },
  { name: 'Ismarus', note: 'The first raid, the first lesson' },
  { name: 'The Lotus-eaters', note: 'Where it’s easy to forget the way home' },
  { name: 'The Cyclops’ island', note: 'A giant problem, beaten by cunning' },
  { name: 'Aeolia', note: 'A fair wind, if you keep the bag closed' },
  { name: 'The Laestrygonians', note: 'Rough water, keep going' },
  { name: 'Aeaea', note: 'Circe’s island: a year that felt like a day' },
  { name: 'The Sirens', note: 'Tied to the mast, you sail past' },
  { name: 'Scylla and Charybdis', note: 'Choosing the smaller loss' },
  { name: 'Thrinacia', note: 'Patience with what isn’t yours yet' },
  { name: 'Ogygia', note: 'Comfortable, but not home' },
  { name: 'Scheria', note: 'Help from strangers, the last stretch' },
  { name: 'Ithaca', note: 'Home: who you set out to become' },
];
export const LEGS = PORTS.length - 1;
export const GOOD_WEEK = 0.6; // focus habits kept at least 60% of the time

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const val = (state, d, k) => state.days?.[d]?.values?.[k];

// How a week went, 0–1 (null: nothing to judge, or the whole week was paused).
export function weekRate(state, wk, uptoKey) {
  const days = weekDays(wk).filter((d) => d <= uptoKey && !isPaused(state, d));
  if (!days.length) return null;
  const plan = state.weeks?.[wk];
  const focus = (state.profile?.habits || []).map((h) => plan?.goals.find((g) => g.id === h.goalId)).filter(Boolean);
  if (focus.length) {
    const rates = focus.map((g) => adherence(state, g, days)).filter((r) => r != null);
    return rates.length ? rates.reduce((a, r) => a + r, 0) / rates.length : null;
  }
  const s = weekSummary(wk, state, days.at(-1)); // before onboarding: the week's habit score
  return s.avg == null ? null : s.avg / 100;
}

// → { voyage (1, 2 …), leg (0–12 = port reached), port, next, progress (0–1 toward the next port this week),
//     weeks: [{ wk, rate, sailed: bool, storm: bool }] }
export function voyage(state, todayKey = dateKey()) {
  const onboard = state.profile?.onboardedAt ? dateKey(new Date(state.profile.onboardedAt)) : null;
  const firstLogged = Object.keys(state.days || {}).filter((k) => Object.keys(state.days[k]?.values || {}).length).sort()[0];
  const start = weekKeyOf(onboard || firstLogged || todayKey);
  const cur = weekKeyOf(todayKey);
  let sailed = 0;
  const weeks = [];
  for (let wk = start; wk < cur; wk = shift(wk, 7)) {
    const rate = weekRate(state, wk, weekDays(wk)[6]);
    const good = rate != null && rate >= GOOD_WEEK;
    if (good) sailed++;
    weeks.push({ wk, rate, sailed: good, storm: rate != null && !good });
  }
  const now = weekRate(state, cur, todayKey);
  const voyageNo = Math.floor(sailed / LEGS) + 1;
  const leg = sailed % LEGS;
  return {
    voyage: voyageNo, leg, legsSailed: sailed,
    port: PORTS[leg], next: PORTS[leg + 1],
    progress: now == null ? 0 : Math.min(1, now / GOOD_WEEK),
    thisWeek: now, weeks,
  };
}

// ---------- laurels ----------
const LAUREL_COUNTS = [[1, 'First time'], [10, 'Ten'], [30, 'Thirty'], [100, 'A hundred']];

// → [{ id, title, detail, day, goalId? }] earned, oldest first; plus `next`: the closest ones not yet earned.
export function laurels(state, todayKey = dateKey()) {
  const earned = [];
  const next = [];
  const seen = new Set();
  // habits across all planned weeks (latest definition wins)
  const goals = new Map();
  for (const wk of Object.keys(state.weeks || {}).sort()) for (const g of state.weeks[wk].goals || []) goals.set(g.id, g);
  const dayKeys = Object.keys(state.days || {}).filter((d) => d <= todayKey).sort();
  for (const g of goals.values()) {
    const m = g.metrics?.[0];
    if (!m) continue;
    const k = metricKey(g, m);
    const kind = kindOf(g);
    const t = Number(m.target) || 0;
    const kept = (d) => {
      const v = val(state, d, k);
      if (v == null || v === '') return false;
      if (kind === 'yesno') return v === true;
      if (kind === 'limit') return Number(v) <= t;
      return m.kind === 'perDayMin' ? Number(v) >= t && t > 0 : Number(v) > 0;
    };
    const keptDays = dayKeys.filter(kept);
    for (const [n, word] of LAUREL_COUNTS) {
      const id = `count:${g.id}:${n}`;
      if (keptDays.length >= n) earned.push({ id, title: n === 1 ? `First ${kind === 'limit' ? 'day within the limit' : 'time'}` : `${word} ${kind === 'limit' ? 'days within the limit' : 'times'}`, detail: g.name, icon: g.icon || '⭐', day: keptDays[n - 1], goalId: g.id });
      else if (!seen.has(g.id)) { seen.add(g.id); next.push({ id, title: `${word} ${kind === 'limit' ? 'days within the limit' : 'times'}`, detail: g.name, icon: g.icon || '⭐', have: keptDays.length, need: n, goalId: g.id }); }
    }
    // the first full week a yes/no habit hit its target
    if (kind === 'yesno' && m.kind === 'daysPerWeek' && t > 0) {
      const wks = [...new Set(keptDays.map(weekKeyOf))].sort();
      const hit = wks.find((wk) => weekDays(wk).filter((d) => d <= todayKey && val(state, d, k) === true).length >= t);
      if (hit) {
        const day = weekDays(hit).filter((d) => val(state, d, k) === true)[t - 1];
        earned.push({ id: `week:${g.id}`, title: 'A full week', detail: `${g.name}: the week’s target reached`, icon: g.icon || '⭐', day, goalId: g.id });
      }
    }
    // smoke-free: zero on a day, seven in a row, thirty in a row
    if (g.id === 'smoke') {
      let run = 0;
      const marks = { 1: 'First smoke-free day', 7: 'A smoke-free week', 30: 'A smoke-free month' };
      for (const d of dayKeys) {
        const v = val(state, d, k);
        run = v != null && Number(v) === 0 ? run + 1 : 0;
        if (marks[run] && !earned.some((x) => x.id === `free:${run}`)) earned.push({ id: `free:${run}`, title: marks[run], detail: 'Cigarettes', icon: '🚭', day: d, goalId: g.id });
      }
    }
  }
  // focus hours
  const sess = sessionsIn(dayKeys, state).sort((a, b) => a.start - b.start);
  let mins = 0;
  for (const [h, title] of [[10, 'Ten hours of focus'], [50, 'Fifty hours of focus'], [100, 'A hundred hours of focus']]) {
    let day = null;
    mins = 0;
    for (const x of sess) { mins += Number(x.workMin) || 0; if (mins >= h * 60) { day = dateKey(new Date(x.start)); break; } }
    if (day) earned.push({ id: `focus:${h}`, title, detail: 'Focus sessions', icon: '⏱', day });
    else { next.push({ id: `focus:${h}`, title, detail: 'Focus sessions', icon: '⏱', have: Math.round(mins / 60), need: h }); break; }
  }
  earned.sort((a, b) => (a.day > b.day ? 1 : -1));
  next.sort((a, b) => b.have / b.need - a.have / a.need);
  return { earned, next: next.slice(0, 3) };
}

// ---------- Athena's favour: a rare surprise, on a day everything planned was kept ----------
const hash = (s) => [...String(s)].reduce((h, c) => ((h * 31) ^ c.charCodeAt(0)) >>> 0, 11);
export function favourDays(state, fromKey, toKey) {
  const out = [];
  const taken = new Set();
  for (let d = fromKey; d <= toKey; d = shift(d, 1)) {
    const wk = weekKeyOf(d);
    if (taken.has(wk) || isPaused(state, d)) continue;
    const plan = planOf(d, state);
    const focus = (state.profile?.habits || []).map((h) => plan?.goals.find((g) => g.id === h.goalId)).filter(Boolean);
    const due = focus.filter((g) => kindOf(g) !== 'yesno' || !g.metrics[0].days?.length || g.metrics[0].days.includes(parseKey(d).getDay()));
    if (!due.length) continue;
    const allKept = due.every((g) => {
      const m = g.metrics[0];
      const v = val(state, d, metricKey(g, m));
      const kind = kindOf(g);
      return kind === 'yesno' ? v === true : kind === 'limit' ? v != null && Number(v) <= Number(m.target) : Number(v) >= Number(m.target);
    });
    if (allKept && hash(d) % 4 === 0) { out.push(d); taken.add(wk); }
  }
  return out;
}

// ---------- the marketplace: items unlocked at voyage ports ----------
// → [{ ...item, port, unlocked, bought: [purchases], canBuy, short }]
export function market(state, todayKey = dateKey(), balance = 0) {
  const sailed = voyage(state, todayKey).legsSailed;
  return MARKET.map((it) => {
    const bought = (state.purchases || []).filter((p) => p.itemId === it.id && p.currency === 'kleos');
    const unlocked = sailed >= it.unlockLeg;
    return { ...it, port: PORTS[Math.min(it.unlockLeg, LEGS)], unlocked, bought, canBuy: unlocked && balance >= it.price, short: Math.max(0, it.price - balance) };
  });
}
export const nextUnlock = (state, todayKey = dateKey()) => {
  const sailed = voyage(state, todayKey).legsSailed;
  return MARKET.filter((it) => it.unlockLeg > sailed).sort((a, b) => a.unlockLeg - b.unlockLeg)[0] || null;
};
