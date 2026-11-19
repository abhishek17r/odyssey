import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSay, replyFor, daySummary } from '../lib/say.js';

const T = '2026-11-18';
const goals = [
  { id: 'gym', name: 'Gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3 }] },
  { id: 'smoke', name: 'Smoking', playbook: 'smoking', metrics: [{ id: 'times_dmax', kind: 'perDayMax', unit: 'times', target: 6 }] },
  { id: 'scrolling', name: 'Scrolling', metrics: [{ id: 'hours', kind: 'perDayMax', unit: 'hours', target: 1 }] },
  { id: 'read', name: 'Reading', metrics: [{ id: 'days_w', kind: 'daysPerWeek', target: 4 }] },
];
const s = { weeks: { '2026-11-14': { goals } }, days: {}, tickets: {}, sessions: {}, settings: {} };

test('habits by name and by playbook words', () => {
  assert.deepEqual(parseSay('Log gym', s, T).goalId, 'gym');
  assert.equal(parseSay('I did my workout', s, T).goalId, 'gym');
  assert.equal(parseSay('skipped gym today', s, T).done, false);
  assert.equal(parseSay('reading done', s, T).goalId, 'read');
  const c = parseSay('one cigarette', s, T);
  assert.deepEqual([c.kind, c.goalId, c.n], ['count', 'smoke', 1]);
  assert.equal(parseSay('smoked 2', s, T).n, 2);
  const sc = parseSay('30 minutes of reels', s, T);
  assert.deepEqual([sc.goalId, sc.n], ['scrolling', 0.5]);
});

test('tasks, focus and the day', () => {
  const t = parseSay('add call the bank tomorrow 30 minutes', s, T);
  assert.equal(t.kind, 'task');
  assert.equal(t.task.title, 'call the bank');
  assert.equal(t.task.due, '2026-11-19');
  assert.equal(t.task.sizeH, 0.5);
  assert.equal(parseSay('start focus', s, T).kind, 'focus');
  assert.equal(parseSay("how's my day", s, T).kind, 'day');
  assert.equal(parseSay('buy milk', s, T).guessed, true);
  assert.match(replyFor(parseSay('log gym', s, T), s, T), /Gym: done for today/);
  assert.match(daySummary(s, T), /4 habits left/);
});
