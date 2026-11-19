import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest, numbersIn } from '../lib/digest.js';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { buildJob, check, proposalError } from '../scripts/brain/jobs.mjs';

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
  assert.deepEqual(d.tasks.hours, { openThisWeek: 22, usualPerWeek: 9, doneThisWeek: 0, likelySpill: 13 });
  const gym = get('gym-regular').d.habits.find((h) => h.id === 'gym');
  assert.equal(gym.run.weeksOnTarget, 5);
  assert.deepEqual(gym.week, { done: 2, need: 1, daysLeft: 2 });
  const smoke = get('smoker-slipping').d.habits[0];
  assert.equal(smoke.week.over, 5);
  assert.equal(smoke.triggers[0].tag, 'coffee');
  assert.ok(get('paused-week').d.paused);
  assert.equal(get('rough-week-peril').d.voyage.peril.need, 3);
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
  const req = buildJob('evening', d, { reflection: 'x' });
  assert.ok(check(req, JSON.stringify({ text: 'That sounds really heavy. Please talk to someone you trust tonight, or a local helpline.' }), p, d).pass);
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
