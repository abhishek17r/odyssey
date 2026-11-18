import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../lib/quickAdd.js';

const T = '2026-11-18'; // a Wednesday
test('plain words become deadline and estimate', () => {
  assert.deepEqual(parseQuickAdd('Call the bank tomorrow 30m', T), { title: 'Call the bank', due: '2026-11-19', sizeH: 0.5 });
  assert.deepEqual(parseQuickAdd('Write report fri 2h', T), { title: 'Write report', due: '2026-11-20', sizeH: 2 });
  assert.deepEqual(parseQuickAdd('Groceries today', T), { title: 'Groceries', due: T, sizeH: null });
  assert.deepEqual(parseQuickAdd('Plan offsite next week', T), { title: 'Plan offsite', due: '2026-11-27', sizeH: null });
  assert.equal(parseQuickAdd('Review on wednesday', T).due, '2026-11-25'); // the next Wednesday
});
test('titles that only look like dates stay whole', () => {
  assert.deepEqual(parseQuickAdd('Today', T), { title: 'Today', due: null, sizeH: null });
  assert.deepEqual(parseQuickAdd('Read chapter 2', T), { title: 'Read chapter 2', due: null, sizeH: null });
});
