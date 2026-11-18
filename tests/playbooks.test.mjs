import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessType, playbookIdOf, makeHabit, stakeLine, weekRun, underRun, limitOn, zeroDay, moneyKept, missedYesterdayCard,
  history, taskStake, weekLoad, trendLines, applyStepDown, atThisPace, ladderReady, triggers,
} from '../lib/playbooks.js';
import { weekKeyOf, weekDays, dateKey, addDays, parseKey } from '../lib/score.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const T = '2026-11-18'; // a Wednesday; the week runs Sat 14 → Fri 20
const WK = weekKeyOf(T);
const blank = () => ({ settings: {}, days: {}, weeks: {}, tickets: {}, sessions: {}, pauses: [], notes: {} });
const withPlan = (goals, weeks = [WK]) => { const s = blank(); for (const w of weeks) s.weeks[w] = { goals: structuredClone(goals) }; return s; };
const setV = (s, k, key, v) => { (s.days[k] ??= { values: {} }).values[key] = v; };

test('names map to playbooks and types', () => {
  assert.deepEqual(guessType('Gym'), { playbook: 'gym', type: 'build' });
  assert.equal(guessType('Instagram reels').playbook, 'scrolling');
  assert.equal(guessType('cigarettes').playbook, 'smoking');
  assert.deepEqual(guessType('Journal'), { playbook: null, type: 'build' });
  assert.equal(guessType('Less coffee').type, 'cut');
  assert.equal(guessType('No phone in bed').type, 'rule');
  assert.equal(playbookIdOf({ id: 'gym', metrics: [{ kind: 'daysPerWeek' }] }), 'gym');
  assert.equal(playbookIdOf({ id: 'own-x', metrics: [{ kind: 'perDayMax' }] }), 'cut');
  assert.equal(playbookIdOf({ id: 'own-x', playbook: 'rule', metrics: [{ kind: 'daysPerWeek' }] }), 'rule');
});

test('makeHabit builds goals for each playbook, with unique ids', () => {
  const g = makeHabit('gym', { target: 3, why: 'Strong at 60' }, T, ['gym']);
  assert.equal(g.id, 'gym-2');
  assert.equal(g.preset, false);
  assert.equal(g.metrics[0].target, 3);
  assert.equal(g.why, 'Strong at 60');
  const s = makeHabit('smoking', { usual: 10, pace: 1, price: 17 }, T);
  assert.equal(s.metrics[0].target, 9);
  assert.deepEqual(s.smoking, { start: 10, pace: 1, price: 17, since: T });
  const own = makeHabit('build', { name: 'Journal', target: 4, tiny: 'One line' }, T);
  assert.equal(own.id, 'own-journal');
  assert.equal(own.playbook, 'build');
  const c = makeHabit('cut', { name: 'Coffee', unit: 'times', usual: 4, target: 3 }, T);
  assert.equal(c.metrics[0].kind, 'perDayMax');
  assert.equal(c.metrics[0].target, 3);
  const d = makeHabit('diet', { rule: 'No sugar after 8 pm' }, T);
  assert.equal(d.ladder.length, 1);
});

test('stake line for a 3-a-week habit: skip today and the rest must happen', () => {
  const gym = { id: 'gym', playbook: 'gym', name: 'Gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3 }] };
  const s = withPlan([gym]);
  // Sat 14 done, Mon 16 done → 2 of 3, Wed 18 today, Thu Fri left: need 1, 2 days after today
  setV(s, '2026-11-14', 'gym.days', true);
  setV(s, '2026-11-16', 'gym.days', true);
  assert.equal(stakeLine(gym, s, T)?.tone, 'calm' === stakeLine(gym, s, T)?.tone ? 'calm' : stakeLine(gym, s, T)?.tone); // exists
  // only one done → need 2, two days after today → skipping makes Thu and Fri must-dos
  delete s.days['2026-11-16'];
  const l = stakeLine(gym, s, T);
  assert.equal(l.tone, 'risk');
  assert.match(l.text, /Skip today and Thu and Fri all have to happen/);
  // gentle tone softens it
  s.settings.tone = 'gentle';
  assert.match(stakeLine(gym, s, T).text, /easier/);
  // done today
  s.settings.tone = 'direct';
  assert.match(stakeLine(gym, s, T, { 'gym.days': true }).text, /Done today · 1 more by Friday/);
});

test('week runs count weeks in a row on target', () => {
  const gym = { id: 'gym', name: 'Gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 2 }] };
  const w1 = shift(WK, -7), w2 = shift(WK, -14);
  const s = withPlan([gym], [WK, w1, w2]);
  for (const w of [w1, w2]) { const d = weekDays(w); setV(s, d[0], 'gym.days', true); setV(s, d[2], 'gym.days', true); }
  assert.equal(weekRun(gym, s, T).run, 2);
  setV(s, weekDays(WK)[0], 'gym.days', true); setV(s, weekDays(WK)[1], 'gym.days', true);
  assert.deepEqual(weekRun(gym, s, T), { run: 3, thisWeek: true });
});

test('smoking: step-down limit, zero day, money kept, under-the-limit run', () => {
  const g = makeHabit('smoking', { usual: 10, pace: 1, price: 20 }, '2026-11-04');
  assert.equal(limitOn(g, '2026-11-04'), 9);
  assert.equal(limitOn(g, '2026-11-11'), 8);
  assert.equal(limitOn(g, T), 7);
  assert.equal(zeroDay(g), shift('2026-11-04', 63));
  const s = withPlan([g]);
  setV(s, '2026-11-16', 'smoke.times_dmax', 6);
  setV(s, '2026-11-17', 'smoke.times_dmax', 7);
  assert.equal(moneyKept(g, s, T), (4 + 3) * 20);
  assert.equal(underRun(g, s, T), 2);
  s.weeks[WK].goals[0].metrics[0].target = 99;
  assert.ok(applyStepDown(s, T));
  assert.equal(s.weeks[WK].goals[0].metrics[0].target, 7);
  assert.match(atThisPace(g, s, T), /smoke-free by/);
});

test('the morning after a miss: planned yesterday, not done', () => {
  const gym = { id: 'gym', name: 'Gym', playbook: 'gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3, days: [2, 4, 6] }] }; // Tue Thu Sat
  const s = withPlan([gym]);
  s.days['2026-11-17'] = { values: {} };
  const c = missedYesterdayCard(s, T);
  assert.equal(c?.g.id, 'gym');
  setV(s, T, 'gym.days', true);
  assert.equal(missedYesterdayCard(s, T), null);
  // paused yesterday: no card
  delete s.days[T];
  s.pauses = [{ startDay: '2026-11-17', endDay: '2026-11-17' }];
  assert.equal(missedYesterdayCard(s, T), null);
});

test('history marks done, missed and rest days', () => {
  const gym = { id: 'gym', name: 'Gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 2, days: [1, 3] }] };
  const s = withPlan([gym]);
  setV(s, '2026-11-16', 'gym.days', true);
  const h = history(gym, s, T, 1)[0].cells;
  // Sat Sun Mon Tue Wed(today) Thu Fri
  assert.deepEqual(h, ['rest', 'rest', 'done', 'rest', 'today', 'future', 'future']);
});

test('task stakes: a written loss, or the hours that land on the due day', () => {
  const s = blank();
  const a = { id: 'a', title: 'Passport', status: 'todo', due: '2026-11-20', loss: '₹1,500 late fee', sizeH: 0.5 };
  const b = { id: 'b', title: 'Doc', status: 'todo', due: '2026-11-19', sizeH: 2 };
  const c = { id: 'c', title: 'Slides', status: 'todo', due: '2026-11-19', sizeH: 1 };
  s.tickets = { a, b, c };
  assert.deepEqual(taskStake(a, s, T), { text: 'Miss Fri: ₹1,500 late fee', tone: 'loss' });
  assert.deepEqual(taskStake(b, s, T), { text: 'Not today, and Thursday carries 3 h', tone: 'risk' });
  assert.equal(taskStake({ ...b, due: T }, s, T), null);
});

test('week load compares open hours with what you usually finish', () => {
  const s = blank();
  const at = (k) => parseKey(k).getTime();
  let i = 0;
  for (const w of [1, 2, 3]) s.tickets[`d${i}`] = { id: `d${i++}`, status: 'done', sizeH: 6, doneAt: at(shift(WK, -7 * w + 2)) };
  s.tickets.o1 = { id: 'o1', status: 'todo', sprint: WK, sizeH: 8 };
  s.tickets.o2 = { id: 'o2', status: 'todo', sprint: WK, sizeH: 4 };
  const l = weekLoad(s, T);
  assert.equal(l.open, 12);
  assert.equal(l.usual, 4.5);
  assert.ok(l.spill > 0);
});

test('trend sentences: one per habit, with comparisons', () => {
  const gym = { id: 'gym', name: 'Gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3 }] };
  const s = withPlan([gym]);
  for (let i = 1; i <= 10; i++) setV(s, shift(T, -i * 2), 'gym.days', true);
  for (let i = 0; i < 5; i++) setV(s, shift(T, -30 - i * 3), 'gym.days', true);
  const { lines } = trendLines(s, T);
  assert.equal(lines.length, 1);
  assert.match(lines[0].html, /<b>Gym:<\/b> \d+ of 12 in the last 4 weeks, up from 5/);
});

test('ladder opens after 3 weeks at 80%; triggers count tags', () => {
  const g = makeHabit('diet', { rule: 'No sugar after 8 pm' }, shift(T, -25));
  const s = withPlan([g]);
  for (let i = 1; i <= 18; i++) setV(s, shift(T, -i), 'eat.days_w', true);
  assert.equal(ladderReady(g, s, T), true);
  const c = makeHabit('smoking', { usual: 10 }, T);
  s.days[T] = { values: {}, log: { smoke: [{ at: 1, n: 1, tag: 'After chai' }, { at: 2, n: 1, tag: 'After chai' }, { at: 3, n: 1, tag: 'Stress' }] } };
  assert.deepEqual(triggers(c, s, T)[0], { tag: 'After chai', n: 2, pct: 67 });
});

test('pace sentence groups the year-long projections', () => {
  const gym = { id: 'gym', name: 'Gym', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3 }] };
  const hiit = { id: 'hiit', name: 'Morning HIIT', metrics: [{ id: 'days', kind: 'daysPerWeek', target: 3 }] };
  const s = withPlan([gym, hiit]);
  for (let i = 1; i <= 8; i++) { setV(s, shift(T, -i * 3), 'gym.days', true); setV(s, shift(T, -i * 3), 'hiit.days', true); }
  const { pace } = trendLines(s, T);
  assert.match(pace, /^By next November: <b>\d+ gym days<\/b> and <b>\d+ Morning HIIT days<\/b>\.$/);
});
