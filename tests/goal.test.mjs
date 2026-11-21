import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, planNow, numberIn } from '../lib/goalPlan.js';
import { buildRequest, parseReply, noteFor, visionHash } from '../lib/athenaAI.js';

const today = '2026-11-21';
const pushups = { text: '100 push-ups in a row', by: '2027-02-21', now: '38 in a row', days: 4, around: 'Left shoulder gets sore if I do two days in a row' };

test('a number goal climbs from where you are to the goal, block by block, then a test week', () => {
  const p = makePlan(pushups, today);
  assert.equal(p.weeks, 14);
  const marks = p.blocks.slice(0, -1).map((b) => numberIn(b.title.split('up to ')[1]).n);
  assert.ok(marks.every((m, i) => m > 38 && m <= 100 && (i === 0 || m > marks[i - 1])), String(marks));
  assert.match(p.blocks.at(-1).check.text, /21 Feb: 100 push-ups in a row/);
  assert.match(p.blocks[0].detail, /Rest a day/); // planned around the sore shoulder
  // every week is in exactly one block
  const weeks = p.blocks.flatMap((b) => Array.from({ length: b.to - b.from + 1 }, (_, i) => b.from + i));
  assert.deepEqual(weeks, Array.from({ length: 14 }, (_, i) => i + 1));
});

test('a goal without numbers gets checkpoints; a short one is a single block', () => {
  const p = makePlan({ text: 'Finish the first draft of my thesis', by: '2027-01-15', days: 5 }, today);
  assert.ok(p.blocks.length >= 3);
  assert.match(p.blocks.at(-1).title, /wrap it up/);
  assert.equal(makePlan({ text: 'Read 2 books', by: '2026-12-01', now: '0', days: 7 }, today).blocks.length, 1);
});

test('where you are in the plan today', () => {
  const v = { ...pushups, start: today, plan: makePlan(pushups, today) };
  assert.equal(planNow(v, '2026-12-01').week, 2);
  assert.equal(planNow(v, '2026-11-20'), null);
});

test('Athena may reword the plan, but not add numbers or change its shape', () => {
  const v = { ...pushups, start: today, plan: makePlan(pushups, today) };
  const state = { profile: { visions: { push: v } }, days: {}, weeks: {}, notes: {}, settings: {}, tickets: {}, sessions: {} };
  const req = buildRequest('goal', state, today, '2026-11-21', 'push');
  assert.equal(req.forHash, visionHash(v));
  const good = { blocks: v.plan.blocks.map((b) => ({ title: b.title, detail: 'Train on alternate days so the shoulder rests.' })) };
  assert.equal(parseReply(req, JSON.stringify(good)).blocks.length, v.plan.blocks.length);
  assert.equal(noteFor(req, parseReply(req, JSON.stringify(good)), today, '2026-11-21', 'm').id, 'ai-goal-push');
  const extra = { blocks: good.blocks.map((b, i) => (i ? b : { ...b, detail: 'Do 250 a day.' })) };
  assert.equal(parseReply(req, JSON.stringify(extra)), null);
  assert.equal(parseReply(req, JSON.stringify({ blocks: good.blocks.slice(1) })), null);
});
