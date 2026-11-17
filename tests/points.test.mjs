import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointEvents, kleos, rankOf, POINTS } from '../lib/points.js';

const plan = { goals: [
  { id: 'gym', name: 'Gym', icon: 'G', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3, days: [1, 3, 5] }] },
  { id: 'snack', name: 'Snacking', icon: 'S', metrics: [{ id: 'times', kind: 'perDayMax', target: 0 }] },
] };
const base = (extra = {}) => ({ weeks: { '2026-11-14': plan }, days: {}, tickets: {}, sessions: {}, settings: {}, ...extra });

test('a habit done earns points; going over a limit costs them', () => {
  const ev = pointEvents(base({ days: { '2026-11-16': { values: { 'gym.days': true, 'snack.times': 2 } } } }), '2026-11-16');
  assert.ok(ev.some((e) => e.pts === POINTS.habitDone));
  assert.ok(ev.some((e) => e.pts === POINTS.limitBroken));
});

test('a planned day that passes unlogged costs points, but not while paused', () => {
  // 2026-11-16 is a Monday, a planned gym day
  const missed = pointEvents(base({ days: { '2026-11-15': { values: { 'snack.times': 0 } } } }), '2026-11-17');
  assert.ok(missed.some((e) => e.text === 'Missed planned Gym' && e.day === '2026-11-16'));
  const paused = pointEvents(base({ pauses: [{ startDay: '2026-11-16', endDay: '2026-11-16' }] }), '2026-11-17');
  assert.ok(!paused.some((e) => e.day === '2026-11-16' && e.pts < 0));
});

test('an overdue task costs points per day, capped', () => {
  const tickets = { t: { id: 't', title: 'Doc', status: 'todo', due: '2026-11-15', createdAt: Date.parse('2026-11-14') } };
  const ev = pointEvents(base({ tickets }), '2026-11-28').filter((e) => e.text === 'Overdue: “Doc”');
  assert.equal(ev.reduce((a, e) => a + e.pts, 0), POINTS.overdueMax);
});

test('the total never goes below zero, and ranks follow the total', () => {
  assert.ok(kleos(base({ days: { '2026-11-16': { values: { 'snack.times': 9 } } } }), '2026-11-16').total >= 0);
  assert.equal(rankOf(0).name, POINTS.ranks[0][1]);
  assert.equal(rankOf(POINTS.ranks[2][0]).level, 3);
});
