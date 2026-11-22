import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointEvents, kleos, KLEOS, keptOn } from '../lib/points.js';

const plan = { goals: [
  { id: 'gym', name: 'Gym', icon: 'G', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3, days: [1, 3, 5] }] },
  { id: 'snack', name: 'Snacking', icon: 'S', metrics: [{ id: 'times', kind: 'perDayMax', target: 0 }] },
] };
const base = (extra = {}) => ({ weeks: { '2026-11-14': plan }, days: {}, tickets: {}, sessions: {}, settings: {}, ...extra });
const at = (k, h = 10) => new Date(`${k}T${String(h).padStart(2, '0')}:00:00`).getTime();

test('a planned habit kept pays 10, once a day; going over a limit pays nothing and costs nothing', () => {
  const ev = pointEvents(base({ days: { '2026-11-16': { values: { 'gym.days': true, 'snack.times': 2 } } } }), '2026-11-16');
  assert.deepEqual(ev.map((e) => [e.kind, e.pts]), [['habit', 10]]);
  const kept = pointEvents(base({ days: { '2026-11-16': { values: { 'snack.times': 0 } } } }), '2026-11-16');
  assert.equal(kept[0].text, 'Snacking');
  assert.ok(keptOn(base({ days: { '2026-11-16': { values: { 'gym.days': true } } } }), plan.goals[0], '2026-11-16'));
});

test('nothing is ever taken away: missed days, skips and overdue tasks cost nothing', () => {
  const tickets = { a: { id: 'a', title: 'Late', status: 'todo', due: '2026-11-15', createdAt: at('2026-11-14') } };
  const ev = pointEvents(base({ tickets, days: { '2026-11-16': { values: { 'gym.days': false } } } }), '2026-11-28');
  assert.equal(ev.length, 0);
  assert.ok(ev.every((e) => e.pts > 0));
});

test('a task pays only if planned before the day you did it', () => {
  const tickets = {
    planned: { id: 'planned', title: 'Planned', status: 'done', createdAt: at('2026-11-15'), doneAt: at('2026-11-16') },
    sameDay: { id: 'sameDay', title: 'Added and ticked', status: 'done', createdAt: at('2026-11-16', 9), doneAt: at('2026-11-16', 10) },
    step: { id: 'step', title: 'A step', parentId: 'planned', status: 'done', createdAt: at('2026-11-15'), doneAt: at('2026-11-16') },
  };
  const ev = pointEvents(base({ tickets }), '2026-11-16');
  assert.deepEqual(ev.map((e) => e.text), ['Finished “Planned”']);
});

test('focus pays 10 for a timed session of 20 minutes or more', () => {
  const sessions = { '2026-11-16': [{ start: at('2026-11-16'), workMin: 25 }, { start: at('2026-11-16', 12), workMin: 10 }] };
  const ev = pointEvents(base({ sessions }), '2026-11-16');
  assert.deepEqual(ev.map((e) => [e.kind, e.pts]), [['focus', 10]]);
});

test('at most 100 a day', () => {
  const tickets = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`t${i}`, { id: `t${i}`, title: `T${i}`, status: 'done', createdAt: at('2026-11-15'), doneAt: at('2026-11-16') }]));
  const k = kleos(base({ tickets }), '2026-11-16');
  assert.equal(k.today, KLEOS.dailyCap);
  assert.ok(k.total >= 0);
});
