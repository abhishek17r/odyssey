import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { variantOf, todayItems, doneCount, parseAnything, logMeter } from '../lib/light.js';

const setup = (id) => { const p = PERSONAS.find((x) => x.id === id); return { s: p.build(), day: todayOf(p) }; };

test('the A/B: a new person is put in a side at random and kept; someone set up stays classic', () => {
  assert.deepEqual(variantOf({ settings: {}, weeks: {} }, () => 0.2), { variant: 'light', assigned: true });
  assert.deepEqual(variantOf({ settings: {}, weeks: {} }, () => 0.8), { variant: 'classic', assigned: true });
  assert.deepEqual(variantOf({ settings: { variant: 'light' } }), { variant: 'light', assigned: false });
  const { s } = setup('gym-regular');
  assert.equal(variantOf({ ...s, settings: {} }).variant, 'classic');
});

test("Light's Today: habits due today and today's tasks in one list, by part of day", () => {
  const { s, day } = setup('overdue-pileup');
  const items = todayItems(s, day);
  assert.ok(items.some((i) => i.kind === 'task' && /overdue/.test(i.sub)), 'overdue tasks are in the list');
  assert.ok(items.every((i) => ['morning', 'afternoon', 'evening', 'any'].includes(i.part)));
  const g = s.weeks[Object.keys(s.weeks).at(-1)].goals[0];
  g.cueTime = '19:00';
  assert.equal(todayItems(s, day).find((i) => i.goalId === g.id)?.part, 'evening');
  const c = doneCount(items);
  assert.ok(c.of >= c.done);
});

test('add anything: a habit with a when and a small version, a task with a day, or a pointer to what you have', () => {
  const day = '2026-11-23';
  const h = parseAnything('gym 4 days a week, evenings', day, []);
  assert.equal(h.kind, 'habit');
  assert.equal(h.goal.metrics[0].target, 4);
  assert.equal(h.goal.cueTime, '19:00');
  assert.match(h.details.join(' '), /20 minutes counts/);
  const r = parseAnything('read 10 pages every day at 10pm', day, []);
  assert.equal(r.goal.metrics[0].target, 7);
  assert.equal(r.goal.cueTime, '22:00');
  const t = parseAnything('call the bank tomorrow 30m', day, []);
  assert.deepEqual([t.kind, t.title, t.due, t.sizeH], ['task', 'call the bank', '2026-11-24', 0.5]);
  assert.equal(parseAnything('gym 3 days a week', day, ['gym']).kind, 'exists');
  assert.equal(parseAnything('   ', day, []), null);
});

test('the measure resets each day', () => {
  const m = logMeter(null, '2026-11-23', 1000);
  assert.deepEqual(m, { day: '2026-11-23', taps: 0, first: 1000, reported: false });
  assert.equal(logMeter({ ...m, taps: 3 }, '2026-11-23').taps, 3);
  assert.equal(logMeter({ ...m, taps: 3 }, '2026-11-24').taps, 0);
});

import { threadItems, unreadCount } from '../lib/hermesThread.js';
test('Light: Athena’s evening check-in asks about each habit still open, then a word for the day; Ithaca on day 3', () => {
  const p = PERSONAS.find((x) => x.id === 'gym-regular');
  const s = p.build(); s.notes ??= {}; s.settings = { ...(s.settings || {}), variant: 'light' };
  const day = todayOf(p);
  const eve = new Date(`${day}T19:00:00`).getTime();
  const ev = threadItems(s, day, eve).find((x) => x.kind === 'evening');
  assert.ok(ev, 'asked in the evening');
  assert.ok(ev.asks.length >= 1 && ev.asks.every((a) => a.key && a.name));
  assert.equal(threadItems(s, day, new Date(`${day}T10:00:00`).getTime()).some((x) => x.kind === 'evening'), false, 'not in the morning');
  assert.equal(threadItems({ ...s, settings: { ...s.settings, variant: 'classic' } }, day, eve).some((x) => x.kind === 'evening'), false, 'classic keeps its check-in sheet');
  s.settings.hermesSeen = 0;
  assert.ok(unreadCount(s, day, eve) >= 1, 'it waits on you');
  // three days in with no Ithaca: Athena asks
  s.profile = { ...(s.profile || {}), onboardedAt: eve - 3 * 864e5, identity: '' };
  assert.ok(threadItems(s, day, eve).some((x) => x.id === 'ithaca'));
});
