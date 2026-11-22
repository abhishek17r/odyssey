import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyage, laurels, favourDays, LEGS, PORTS } from '../lib/voyage.js';
import { goalFor } from '../lib/strategies.js';
import { pointEvents, POINTS } from '../lib/points.js';

const gym = goalFor('gym', { baseline: 'none', wake: '07:00' }); // Mon + Thu, 2 a week
const weeksOf = (...wks) => Object.fromEntries(wks.map((w) => [w, { goals: [gym] }]));
const profile = { onboardedAt: Date.parse('2026-10-24T09:00'), habits: [{ goalId: 'gym', type: 'gym', baseline: 'none', barriers: [] }] };
const done = (...days) => Object.fromEntries(days.map((d) => [d, { values: { 'gym.days': true } }]));

test('good weeks sail a leg; a weak week holds the ship, never sends it back', () => {
  // weeks start Sat: 24 Oct, 31 Oct, 7 Nov, 14 Nov (current). Mondays 26 Oct, 2 Nov, 9 Nov; Thursdays 29 Oct, 5 Nov, 12 Nov.
  const s = { weeks: weeksOf('2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14'), profile,
    days: done('2026-10-26', '2026-10-29', '2026-11-09', '2026-11-12', '2026-11-16') };
  const v = voyage(s, '2026-11-17');
  assert.deepEqual(v.weeks.map((w) => (w.sailed ? 'sail' : w.storm ? 'storm' : '-')), ['sail', 'storm', 'sail']);
  assert.equal(v.leg, 2);
  assert.equal(v.port.name, PORTS[2].name);
  assert.equal(v.next.name, PORTS[3].name);
  assert.ok(v.progress > 0 && v.progress <= 1);
});

test('reaching Ithaca starts the next voyage', () => {
  assert.equal(LEGS, 12);
  const wks = Array.from({ length: 13 }, (_, i) => { const d = new Date('2026-08-22T12:00'); d.setDate(d.getDate() + 7 * i); return d.toISOString().slice(0, 10); });
  const days = {};
  for (const wk of wks) for (const off of [2, 5]) { const d = new Date(`${wk}T12:00`); d.setDate(d.getDate() + off); days[d.toISOString().slice(0, 10)] = { values: { 'gym.days': true } }; }
  const v = voyage({ weeks: weeksOf(...wks), days, profile: { ...profile, onboardedAt: Date.parse('2026-08-22T09:00') } }, '2026-11-17');
  assert.equal(v.voyage, 2);
  assert.equal(v.leg, 0);
});

test('laurels: first time, a full week, and what is next', () => {
  const s = { weeks: weeksOf('2026-11-14'), days: done('2026-11-16', '2026-11-19'), sessions: {} };
  const L = laurels(s, '2026-11-20');
  const ids = L.earned.map((l) => l.id);
  assert.ok(ids.includes('count:gym:1'));
  assert.ok(ids.includes('week:gym'));
  assert.equal(L.next.find((n) => n.goalId === 'gym').need, 10);
});

test('smoke-free laurels', () => {
  const smoke = goalFor('smoking', { baseline: 'ready', count: 10, todayKey: '2026-11-01' });
  const days = {};
  for (let i = 1; i <= 7; i++) days[`2026-11-0${i}`] = { values: { 'smoke.times_dmax': 0 } };
  const ids = laurels({ weeks: { '2026-10-31': { goals: [smoke] } }, days, sessions: {} }, '2026-11-07').earned.map((l) => l.id);
  assert.ok(ids.includes('free:1') && ids.includes('free:7'));
});

test('Athena’s favour: only on fully kept days, at most once a week, the same on every device', () => {
  const s = { weeks: weeksOf('2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14'), profile, days: {} };
  for (let d = new Date('2026-10-24T12:00'); d <= new Date('2026-11-20T12:00'); d.setDate(d.getDate() + 1)) s.days[d.toISOString().slice(0, 10)] = { values: { 'gym.days': true } };
  const a = favourDays(s, '2026-10-24', '2026-11-20');
  assert.deepEqual(a, favourDays(s, '2026-10-24', '2026-11-20'));
  const perWeek = {};
  for (const d of a) { const wk = d; perWeek[wk] = 1; }
  assert.ok(a.length <= 4);
  assert.deepEqual(favourDays({ ...s, days: {} }, '2026-10-24', '2026-11-20'), []);
});


import { market, nextUnlock } from '../lib/voyage.js';
import { kleos, MARKET } from '../lib/points.js';
test('marketplace: items unlock at their port; Kleos spent lowers the balance, not the rank', () => {
  const s = { weeks: weeksOf('2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14'), profile, days: done('2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12'), purchases: [], tickets: {}, sessions: {}, settings: {} };
  const m = market(s, '2026-11-17', 5000);
  assert.equal(m.find((x) => x.id === 'gym-clothes').unlocked, true); // 3 legs sailed
  assert.equal(m.find((x) => x.id === 'shoes').unlocked, false);
  assert.equal(nextUnlock(s, '2026-11-17').id, 'shoes');
  const before = kleos(s, '2026-11-17');
  s.purchases = [{ id: 'p', itemId: 'gym-clothes', price: 100, currency: 'kleos' }, { id: 'old', itemId: 'shoes', price: 7500 }];
  const after = kleos(s, '2026-11-17');
  assert.equal(after.total, before.total);
  assert.equal(after.balance, Math.max(0, before.total - 100));
  assert.equal(MARKET.length, 4);
});
