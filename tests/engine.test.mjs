import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEngine, pickTactic, tacticLine, adherence, kindOf } from '../lib/engine.js';
import { goalFor } from '../lib/strategies.js';
import { streakInfo } from '../lib/score.js';
import { pointEvents, POINTS } from '../lib/points.js';

const WK = '2026-11-14'; // a Saturday: weeks run Sat → Fri
const gym = goalFor('gym', { baseline: 'none', wake: '07:00' }); // Mon + Thu, 2 days
const smoke = goalFor('smoking', { baseline: 'cutDown', count: 10, todayKey: '2026-11-17' });
const mk = (extra = {}) => ({
  weeks: { [WK]: { goals: [gym, smoke] }, '2026-11-21': { goals: [gym, smoke] } },
  days: {}, tickets: {}, sessions: {}, settings: {}, tactics: {}, pauses: [],
  profile: { identity: 'x', onboardedAt: Date.parse('2026-11-16T09:00'), tendency: 'questioner', motivation: 'build',
    habits: [{ goalId: 'gym', type: 'gym', baseline: 'none', barriers: ['forget'] }, { goalId: 'smoke', type: 'smoking', baseline: 'cutDown', barriers: ['urges'] }] },
  ...extra,
});

test('strategy templates make easy starting habits', () => {
  assert.equal(gym.metrics[0].target, 2);
  assert.deepEqual(gym.metrics[0].days, [1, 4]);
  assert.equal(smoke.metrics[0].target, 8);
  assert.equal(kindOf(smoke), 'limit');
  const ready = goalFor('smoking', { baseline: 'ready', count: 10, todayKey: '2026-11-17' });
  assert.equal(ready.metrics[0].target, 5);
  assert.equal(ready.quitDay, '2026-11-24');
});

test('a new habit starts with the tiny version', () => {
  const recs = runEngine(mk(), '2026-11-17');
  assert.equal(recs.length, 2);
  assert.equal(recs.find((r) => r.goalId === 'gym').tacticId, 'tiny-start');
  assert.equal(recs.find((r) => r.goalId === 'gym').id, 'gym:2026-11-17');
});

test('nothing happens before onboarding, or while a trial is running', () => {
  assert.deepEqual(runEngine(mk({ profile: null }), '2026-11-17'), []);
  const s = mk();
  for (const r of runEngine(s, '2026-11-17')) s.tactics[r.id] = r;
  assert.deepEqual(runEngine(s, '2026-11-20'), []);
});

test('after a week, a tactic that helped is kept and one that did not is swapped for a barrier match', () => {
  const s = mk();
  for (const r of runEngine(s, '2026-11-17')) s.tactics[r.id] = r;
  // gym done on both planned days (Thu 19, Mon 23): kept. Smoking over the limit every day: swapped.
  s.days['2026-11-19'] = { values: { 'gym.days': true, 'smoke.times_dmax': 12 } };
  s.days['2026-11-23'] = { values: { 'gym.days': true, 'smoke.times_dmax': 12 } };
  const recs = runEngine(s, '2026-11-24');
  const ended = (g) => recs.find((r) => r.goalId === g && r.endDay);
  const next = (g) => recs.find((r) => r.goalId === g && !r.endDay);
  assert.equal(ended('gym').status, 'kept');
  assert.equal(next('gym').tacticId, 'tiny-start');
  assert.equal(ended('smoke').status, 'retired');
  assert.ok(['urge-pause', 'friction'].includes(next('smoke').tacticId), next('smoke').tacticId);
});

test('tactics match the stated barriers', () => {
  const s = mk();
  const history = [{ tacticId: 'tiny-start', status: 'retired', startDay: '2026-11-10' }];
  assert.equal(pickTactic(s, gym, '2026-11-17', history), 'if-then'); // barrier: forget
});

test('the card line: missed yesterday comes before the trial', () => {
  const s = mk();
  for (const r of runEngine(s, '2026-11-17')) s.tactics[r.id] = r;
  assert.match(tacticLine(s, gym, '2026-11-17').text, /^This week:/);
  // Thu 19 planned and missed; next planned day Mon 23 isn't "yesterday", so check a daily habit instead
  const daily = { ...gym, id: 'walk', metrics: [{ id: 'days_w', kind: 'daysPerWeek', target: 7 }] };
  s.weeks[WK].goals.push(daily);
  assert.match(tacticLine(s, daily, '2026-11-18').text, /^Missed yesterday/);
  assert.equal(tacticLine({ ...s, pauses: [{ startDay: '2026-11-18', endDay: null }] }, daily, '2026-11-18'), null);
});

test('adherence counts planned days only', () => {
  const s = mk({ days: { '2026-11-16': { values: { 'gym.days': true } } } });
  assert.equal(adherence(s, gym, ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']), 0.5);
});

test('Aegis: a shield earned after 7 days saves the streak on a missed day', () => {
  const days = {};
  for (let d = 1; d <= 7; d++) days[`2026-11-${String(d).padStart(2, '0')}`] = { values: { a: 1 } };
  days['2026-11-09'] = { values: { a: 1 } }; // the 8th is missed
  const info = streakInfo({ days }, '2026-11-09');
  assert.equal(info.run, 8);
  assert.ok(info.events.some((e) => e.type === 'shield-used' && e.day === '2026-11-08'));
  // without the shield (only 3 days before the gap) it breaks
  assert.equal(streakInfo({ days: { '2026-11-01': { values: { a: 1 } }, '2026-11-03': { values: { a: 1 } } } }, '2026-11-03').run, 1);
});

test('Kleos: back the day after a miss, and resisted urges count', () => {
  const s = mk({ days: {
    '2026-11-16': { values: { 'smoke.times_dmax': 40 } },
    '2026-11-17': { values: { 'smoke.times_dmax': 0 }, urges: { smoke: { resisted: 2, gave: 1 } } },
  } });
  const ev = pointEvents(s, '2026-11-17');
  assert.ok(ev.some((e) => e.day === '2026-11-17' && e.text.startsWith('Back on course') && e.pts === POINTS.comeback));
  assert.ok(ev.some((e) => e.day === '2026-11-17' && e.pts === 2 * POINTS.urgeResisted));
});

test('a habit you are cutting down starts with the urge pause when urges are the barrier', () => {
  const recs = runEngine(mk(), '2026-11-17');
  assert.equal(recs.find((r) => r.goalId === 'smoke').tacticId, 'urge-pause');
});
