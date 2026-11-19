import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sail, pickTrial, trialProgress, harbourRewards, stormReasons, HARBOURS } from '../lib/sail.js';
import { POINTS, VOYAGE } from '../rewards.config.js';
import { weekDays, dateKey, addDays, parseKey } from '../lib/score.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const W1 = '2026-11-14'; // Sat → Fri 20
const W2 = shift(W1, 7), W3 = shift(W1, 14);
const gym = { id: 'gym', name: 'Gym', icon: 'G', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3, days: [1, 3, 5] }] };
const mk = (days, weeks = [W1, W2, W3]) => ({ weeks: Object.fromEntries(weeks.map((w) => [w, { goals: [structuredClone(gym)] }])), days, tickets: {}, sessions: {}, settings: {}, pauses: [] });
const done = (ks) => Object.fromEntries(ks.map((k) => [k, { values: { 'gym.days': true } }]));

test('Kleos sails the ship; a leg reaches the next harbour', () => {
  // three gym days a week earn 3×10 + 30 = 60; enough weeks of it reach Naxos
  const days = {};
  for (let w = 0; w < 7; w++) for (const off of [2, 4, 6]) days[shift(W1, w * 7 + off)] = { values: { 'gym.days': true } };
  const weeks = Array.from({ length: 7 }, (_, i) => shift(W1, i * 7));
  const v = sail(mk(days, weeks), shift(W1, 48));
  assert.ok(v.harbour >= 1);
  assert.equal(v.at.name, HARBOURS[v.harbour].name);
  assert.ok(v.log.some((l) => l.type === 'harbour' && l.index === 1));
  assert.equal(v.peril, null);
});

test('a week below zero blows the ship to a peril; passing the trial gets it out with a bonus', () => {
  // week 1: every planned day missed (−30) → storm; week 2: gym twice passes "Gym 2 times"
  const days = { [shift(W1, 1)]: { values: {} }, ...done([shift(W2, 2), shift(W2, 4)]) };
  const mid = sail(mk(days), shift(W2, 3));
  assert.equal(mid.peril?.id, 'cyclops');
  assert.equal(mid.peril.trial.text, 'Gym 2 times this week');
  assert.deepEqual(mid.peril.progress, { have: 1, need: 2, passed: false });
  const after = sail(mk(days), shift(W2, 5));
  assert.equal(after.peril, null);
  assert.ok(after.log.some((l) => l.type === 'escape' && l.peril === 'cyclops'));
  assert.ok(after.meter >= VOYAGE.escapeBonus - 1);
});

test('a trial not passed by Friday renews, a little smaller; harbours are never lost', () => {
  const days = { [shift(W1, 1)]: { values: {} } };
  const v = sail(mk(days), shift(W3, 1));
  assert.equal(v.peril?.trial.need, 1);
  assert.equal(v.harbour, 0);
});

test('a fully paused week is never a storm', () => {
  const s = mk({ [shift(W1, 1)]: { values: {} } });
  s.pauses = [{ startDay: W1, endDay: shift(W1, 6) }];
  assert.equal(sail(s, shift(W2, 1)).peril, null);
});

test('trials come from the weakest habit; tasks when nothing is weak', () => {
  const s = mk({});
  assert.equal(pickTrial(s, W1).kind, 'days');
  assert.equal(pickTrial({ ...s, weeks: { [W1]: { goals: [] } } }, W1).kind, 'tasks');
  const t = { kind: 'tasks', need: 2 };
  s.tickets = { a: { id: 'a', status: 'done', doneAt: parseKey(shift(W2, 1)).getTime() + 3600e3 } };
  assert.deepEqual(trialProgress(s, t, W2, shift(W2, 6)), { have: 1, need: 2, passed: false });
});

test('rewards unlock at their harbour and remember claims', () => {
  const v = { voyageNo: 1, harbour: 3 };
  const r = harbourRewards(v, [{ id: 'a', harbour: 3 }, { id: 'b', harbour: 5 }], { a: 1 });
  assert.deepEqual(r.map((x) => [x.id, x.unlocked, x.claimed]), [['a', true, true], ['b', false, false]]);
});

test('the storm says what blew you there', () => {
  const s = mk({ [shift(W1, 1)]: { values: {} } });
  s.tickets = { a: { id: 'a', title: 'Doc', status: 'todo', due: shift(W1, 2) } };
  assert.equal(stormReasons(s, W1, shift(W2, 1)), '3 planned gym days missed and 1 task overdue.');
});
