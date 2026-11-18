import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whenPatch, whenOf, taskGroups } from '../lib/when.js';
import { weekKeyOf } from '../lib/score.js';

const T = '2026-11-18'; // a Wednesday
const cur = weekKeyOf(T);

test('choices map to a week and a deadline', () => {
  assert.deepEqual(whenPatch('today', T), { sprint: cur, due: T });
  assert.equal(whenPatch('tomorrow', T).due, '2026-11-19');
  assert.deepEqual(whenPatch('week', T), { sprint: cur, due: null });
  assert.deepEqual(whenPatch('later', T), { sprint: null, due: null });
  assert.equal(whenPatch('2027-01-10', T).sprint, null); // far off: Later, with the deadline
  assert.equal(whenPatch('2027-01-10', T).due, '2027-01-10');
});

test('a task reads back as the choice it was given', () => {
  for (const c of ['today', 'tomorrow', 'week', 'later']) assert.equal(whenOf(whenPatch(c, T), T), c);
  assert.equal(whenOf({ sprint: cur, due: '2026-11-10' }, T), 'today'); // overdue sits with today
});

test('the Tasks tab groups', () => {
  const tk = {
    a: { id: 'a', title: 'due', sprint: cur, due: T, status: 'todo' },
    b: { id: 'b', title: 'doing', sprint: cur, due: null, status: 'doing' },
    c: { id: 'c', title: 'week', sprint: cur, due: null, status: 'todo' },
    d: { id: 'd', title: 'later', sprint: null, status: 'todo' },
    e: { id: 'e', title: 'done', sprint: cur, status: 'done', doneAt: Date.parse(`${T}T10:00`) },
    f: { id: 'f', title: 'sub', parentId: 'c', sprint: cur, status: 'todo' },
  };
  const g = taskGroups(tk, T);
  assert.deepEqual(g.today.map((t) => t.id).sort(), ['a', 'b']);
  assert.deepEqual(g.week.map((t) => t.id), ['c']);
  assert.deepEqual(g.later.map((t) => t.id), ['d']);
  assert.deepEqual(g.done.map((t) => t.id), ['e']);
});
