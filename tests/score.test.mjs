import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streak, isPaused, pauseOn } from '../lib/score.js';

const logged = (keys) => Object.fromEntries(keys.map((k) => [k, { values: { 'gym.days': true } }]));

test('streak counts logged days back from today', () => {
  const state = { days: logged(['2026-11-15', '2026-11-16', '2026-11-17']) };
  assert.equal(streak(state, '2026-11-17'), 3);
});

test('a gap breaks the streak', () => {
  const state = { days: logged(['2026-11-14', '2026-11-16', '2026-11-17']) };
  assert.equal(streak(state, '2026-11-17'), 2);
});

test('paused days neither count nor break the streak', () => {
  const state = { days: logged(['2026-11-12', '2026-11-13', '2026-11-17']), pauses: [{ startDay: '2026-11-14', endDay: '2026-11-16' }] };
  assert.equal(streak(state, '2026-11-17'), 3);
});

test('isPaused handles open-ended and finished pauses', () => {
  const state = { pauses: [{ startDay: '2026-11-01', endDay: '2026-11-03' }, { startDay: '2026-11-10', endDay: null }] };
  assert.equal(isPaused(state, '2026-11-02'), true);
  assert.equal(isPaused(state, '2026-11-05'), false);
  assert.equal(isPaused(state, '2026-12-25'), true);
  assert.equal(pauseOn(state, '2026-11-05'), null);
});
