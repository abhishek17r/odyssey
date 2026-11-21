import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offers, progress, questEvents, fastClock, FAST_SKIP } from '../lib/quests.js';
import { kleos } from '../lib/points.js';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { metricKey, weekKeyOf } from '../lib/score.js';

const get = (id, quests = {}) => { const p = PERSONAS.find((x) => x.id === id); const s = p.build(); s.profile = { ...s.profile, quests }; return { s, t: todayOf(p) }; };

test('cold turkey is offered once a limit has held, on your lowest day', () => {
  const { s, t } = get('smoker-stepping-down');
  const q = offers(s, t).find((x) => x.kind === 'coldturkey');
  assert.ok(q, 'offered');
  assert.match(q.title, /smoke-free/);
  assert.ok(q.day > t);
  assert.match(q.why, /lowest day/);
});

test('no fasting unless you turn it on; never in a low, paused, slipping or gentle week', () => {
  for (const p of PERSONAS) assert.ok(!offers(get(p.id).s, todayOf(p)).some((q) => q.kind === 'fast'), `${p.id} without the opt-in`);
  for (const id of ['low-mood', 'paused-week', 'smoker-slipping', 'gentle-journal', 'rough-week-peril', 'new-user']) {
    const { s, t } = get(id, { fastingOn: true });
    assert.ok(!offers(s, t).some((q) => ['fast', 'coldturkey', 'stretch'].includes(q.kind)), id);
  }
  assert.match(FAST_SKIP, /pregnant/);
  assert.match(FAST_SKIP, /eating disorder/);
});

test('a gym regular gets one more session this week, and it counts from the log', () => {
  const { s, t } = get('gym-regular');
  const q = offers(s, t).find((x) => x.kind === 'stretch');
  assert.ok(q && q.need === 4);
  const g = s.weeks[weekKeyOf(t)].goals.find((x) => x.id === q.goalId);
  const p0 = progress(q, s, t);
  assert.equal(p0.done, false);
  for (const d of ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']) (s.days[d] ??= { values: {} }).values[metricKey(g, g.metrics[0])] = true;
  assert.equal(progress(q, s, t).done, true);
});

test('a finished quest pays Kleos on the day it ended, past the daily cap', () => {
  const { s, t } = get('gym-regular');
  const before = kleos(s, t).total;
  s.profile.quests = { log: [{ id: 'x', kind: 'stretch', title: 'Gym: 4 this week', pts: 50, status: 'done', endDay: t }] };
  assert.equal(questEvents(s).length, 1);
  assert.equal(kleos(s, t).total, before + 50);
});

test('the fast-day clock', () => {
  const q = { day: '2026-11-22', window: { hours: 16, from: '12:00', to: '20:00' } };
  const at = (k, h) => { const d = new Date(`${k}T00:00:00`); d.setHours(h); return d.getTime(); };
  assert.equal(fastClock(q, at('2026-11-21', 19)).phase, 'before');
  const f = fastClock(q, at('2026-11-22', 10));
  assert.equal(f.phase, 'fasting');
  assert.equal(f.fastedMin, 14 * 60);
  assert.equal(fastClock(q, at('2026-11-22', 13)).phase, 'eating');
  assert.equal(fastClock(q, at('2026-11-22', 21)).phase, 'after');
});
