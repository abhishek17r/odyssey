import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest, numbersIn } from '../lib/digest.js';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { buildJob, check, proposalError } from '../scripts/brain/jobs.mjs';
import { crisisIn, CRISIS_LINE } from '../lib/safety.js';
import { buildRequest } from '../lib/athenaAI.js';

const get = (id) => { const p = PERSONAS.find((x) => x.id === id); return { p, d: digest(p.build(), todayOf(p)) }; };

test('the test set has 20 people and every digest builds', () => {
  assert.equal(PERSONAS.length, 20);
  for (const p of PERSONAS) {
    const d = digest(p.build(), todayOf(p));
    assert.ok(d.day && Array.isArray(d.habits) && d.tasks, p.id);
    assert.ok(JSON.stringify(d).length < 4000, `${p.id} digest stays small`);
  }
});

test('digest facts match the app’s own numbers', () => {
  const { d } = get('overloaded');
  assert.equal(d.tasks.open, 7);
  assert.deepEqual(d.tasks.hours, { plannedThisWeek: 22, usuallyFinishedPerWeek: 9, finishedThisWeek: 0, likelyLeftOver: 13 });
  const gym = get('gym-regular').d.habits.find((h) => h.id === 'gym');
  assert.equal(gym.run.weeksInARowOnTarget, 5);
  assert.deepEqual(gym.thisWeek, { done: 2, stillNeeded: 1, daysLeft: 2 });
  const smoke = get('smoker-slipping').d.habits[0];
  assert.equal(smoke.thisWeek.daysOverLimit, 5);
  assert.equal(smoke.triggers[0].tag, 'coffee');
  assert.ok(get('paused-week').d.paused);
  assert.equal(get('rough-week-peril').d.voyage.peril.needed, 3);
  assert.equal(get('comeback').d.habits[0].backYesterday.afterDaysOff > 5, true);
  assert.match(get('weekend-only').d.habits[0].pattern, /weekends/);
  assert.equal(get('overdue-pileup').d.tasks.overdue, 5);
  assert.equal(get('diet-ladder-ready').d.habits[0].readyForNextRule, true);
});

test('no free text of yours in the digest (reflections and why stay out)', () => {
  const { d } = get('low-mood');
  assert.ok(!JSON.stringify(d).includes('point of any of this'));
});

test('numbersIn collects every number a reply may use', () => {
  const n = numbersIn({ a: 3.4, b: 'Day 43 under your limit', c: [{ d: 12 }] });
  for (const x of ['3.4', '3', '43', '12']) assert.ok(n.has(x), x);
});

test('checks: a good morning line passes, invented numbers and medical advice fail', () => {
  const { p, d } = get('smoker-slipping');
  const req = buildJob('morning', d);
  assert.ok(check(req, JSON.stringify({ text: 'Stress has pushed smoking over the limit this week. Today, try waiting three minutes before each one.' }), p, d).pass);
  const bad = check(req, JSON.stringify({ text: 'You smoked 27 today. Try a nicotine patch!' }), p, d);
  assert.ok(!bad.pass);
  const failed = bad.checks.filter((c) => !c.ok).map((c) => c.name);
  for (const n of ['numbers', 'no-medical', 'voice']) assert.ok(failed.includes(n), n);
  assert.ok(!check(req, 'not json', p, d).pass);
});

test('checks: the safety case needs a kind line with no stats', () => {
  const { p, d } = get('low-mood');
  const req = buildJob('evening', d, { reflection: p.build().days[d.day].reflection });
  assert.deepEqual(req.fixed, { text: CRISIS_LINE }); // answered in code, never sent to a model
  assert.ok(check(req, JSON.stringify(req.fixed), p, d).pass);
  assert.ok(!check(req, JSON.stringify({ text: 'Rest tonight, and try the gym tomorrow: 3 sessions keeps the week.' }), p, d).pass);
});

test('proposals must apply cleanly on the phone', () => {
  const { d } = get('deadline-crunch');
  const id = d.tasks.list.find((t) => /Investor/.test(t.title)).id;
  assert.equal(proposalError({ kind: 'plan_session', taskId: id, at: 'today 10:00', minutes: 60, why: 'Due tomorrow, 4 h' }, d), null);
  assert.match(proposalError({ kind: 'plan_session', taskId: 'nope', at: 'today 10:00', minutes: 60, why: 'x' }, d), /no open task/);
  assert.match(proposalError({ kind: 'plan_session', taskId: id, at: '10am', minutes: 60, why: 'x' }, d), /bad "at"/);
  assert.match(proposalError({ kind: 'set_target', goalId: 'work', target: 5, why: 'x' }, d), /only lower/);
  assert.equal(proposalError({ kind: 'set_target', goalId: 'work', target: 2, why: 'A smaller week' }, d), null);
  assert.match(proposalError({ kind: 'move_task', taskId: id, to: '2020-01-01', why: 'x' }, d), /bad "to"/);
});

test('crisis words are caught in code, ordinary bad days are not', () => {
  for (const t of ['I cannot see the point of any of this anymore', 'Nothing I do matters', 'I want to die', 'thinking about hurting myself', 'I don’t want to wake up tomorrow', 'feeling hopeless']) assert.ok(crisisIn(t), t);
  for (const t of ['Rough day, smoked more than I wanted', 'No point going to the gym with this cold', 'Work is killing me lol', 'I give up on this diet']) assert.ok(!crisisIn(t), t);
  const state = { settings: {}, profile: {}, days: { '2026-11-19': { values: {}, reflection: 'Nothing I do matters anymore' } }, weeks: {}, tickets: {}, sessions: {}, pauses: [], notes: {} };
  assert.equal(buildRequest('evening', state, '2026-11-19'), null); // never sent to the AI
});
