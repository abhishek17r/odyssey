import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningLine, eveningReply, weeklyRead, proposals, applyProposal, decide, proposalWeek } from '../lib/athena.js';
import { goalFor } from '../lib/strategies.js';
import { runEngine } from '../lib/engine.js';

const WK = '2026-11-14'; // Sat; 2026-11-17 is a Tuesday
const gym = goalFor('gym', { baseline: 'none', wake: '07:00' }); // Mon + Thu
const med = goalFor('meditation', { baseline: 'never', wake: '07:00' }); // 4 a week, any days
const base = (extra = {}) => ({
  weeks: { '2026-10-24': { goals: [gym, med] }, '2026-10-31': { goals: [gym, med] }, '2026-11-07': { goals: [gym, med] }, [WK]: { goals: [gym, med] } },
  days: {}, tickets: {}, sessions: {}, settings: {}, tactics: {}, notes: {}, pauses: [],
  profile: { identity: 'someone who trains four days a week', onboardedAt: Date.parse('2026-11-16T09:00'), tendency: 'questioner', motivation: 'build',
    habits: [{ goalId: 'gym', type: 'gym', baseline: 'none', barriers: ['forget'] }, { goalId: 'meditate', type: 'meditation', baseline: 'never', barriers: [] }] },
  ...extra,
});
const withTrials = (s, day) => { for (const r of runEngine(s, day)) s.tactics[r.id] = r; return s; };

test('quiet before onboarding, when switched off, and while paused', () => {
  assert.equal(morningLine(base({ profile: null }), '2026-11-17'), null);
  assert.equal(morningLine(base({ settings: { athenaOn: false } }), '2026-11-17'), null);
  assert.equal(morningLine(base({ pauses: [{ startDay: '2026-11-17', endDay: null }] }), '2026-11-17'), null);
});

test('the morning line names what is planned today, with the identity', () => {
  const s = withTrials(base({ days: { '2026-11-16': { values: { 'gym.days': true } } } }), '2026-11-17');
  const l = morningLine(s, '2026-11-17');
  assert.equal(l.kind, 'today');
  assert.match(l.text, /^Today: Meditation\./);
  assert.match(l.text, /vote for someone who trains four days a week/);
});

test('a slip yesterday comes first: never miss twice', () => {
  const daily = { ...med, metrics: [{ id: 'days_w', kind: 'daysPerWeek', unit: 'days', target: 7 }] };
  const s = withTrials(base({ weeks: { [WK]: { goals: [gym, daily] } }, days: { '2026-11-16': { values: { 'gym.days': true } } } }), '2026-11-17');
  assert.match(morningLine(s, '2026-11-17').text, /^Meditation slipped yesterday\. Today, just two minutes counts/);
});

test('back after days away: a welcome, no catching up', () => {
  const s = base({ days: { '2026-11-10': { values: { 'gym.days': true } } } });
  assert.equal(morningLine(s, '2026-11-17').kind, 'comeback');
});

test('the evening reply answers a reflection with the day’s facts', () => {
  const s = base({ days: { '2026-11-16': { values: { 'gym.days': true, 'meditate.days_w': true }, reflection: 'Good day, felt focused.' } } });
  assert.match(eveningReply(s, '2026-11-16'), /Today: 2 of 2 focus habits kept\./);
  assert.equal(eveningReply(base(), '2026-11-16'), null);
});

test('the weekly read: percentage, anchor, and a closing line', () => {
  const s = base({ days: { '2026-11-16': { values: { 'gym.days': true } } } });
  const r = weeklyRead(s, '2026-11-17');
  assert.match(r.lines[0], /^You kept your focus habits \d+% of the time this week so far/);
  assert.ok(r.lines.length >= 2);
});

test('proposals: fixed days for a habit without them; raise after three strong weeks', () => {
  const days = {};
  for (const wk of ['2026-10-24', '2026-10-31', '2026-11-07']) {
    for (const off of [2, 3, 5, 6]) { const d = new Date(`${wk}T12:00`); d.setDate(d.getDate() + off); days[d.toISOString().slice(0, 10)] = { values: { 'meditate.days_w': true } }; }
  }
  const ps = proposals(base({ days }), '2026-11-17');
  assert.ok(ps.find((p) => p.id === 'raise:meditate'), JSON.stringify(ps.map((p) => p.id)));
  assert.ok(ps.find((p) => p.id === 'days:meditate'));
  assert.ok(ps.length <= 3);
});

test('accepting a target change edits this week (next week from Friday); decisions stick', () => {
  const s = base();
  const p = { id: 'raise:meditate', change: { type: 'target', goalId: 'meditate', value: 5 } };
  const { weeks } = applyProposal(s, p, '2026-11-17');
  assert.equal(weeks[WK].goals.find((g) => g.id === 'meditate').metrics[0].target, 5);
  assert.equal(proposalWeek('2026-11-20'), '2026-11-21'); // Friday → next week
  const fri = applyProposal(s, p, '2026-11-20');
  assert.equal(fri.weeks['2026-11-21'].goals.find((g) => g.id === 'meditate').metrics[0].target, 5);
  assert.equal(fri.weeks[WK].goals.find((g) => g.id === 'meditate').metrics[0].target, 4);
  const { notes } = decide(s, p, 'dismissed', '2026-11-17');
  assert.equal(notes[`weekly-${WK}`].decisions['raise:meditate'], 'dismissed');
});

test('a first step for a task that keeps waiting', () => {
  const tickets = { t: { id: 't', title: 'Write the report', status: 'todo', sprint: WK, sprints: ['2026-11-07', WK], sizeH: 4, createdAt: 1 } };
  const s = base({ tickets });
  const p = proposals(s, '2026-11-17').find((x) => x.id === 'step:t');
  assert.ok(p);
  const out = applyProposal(s, p, '2026-11-17');
  assert.equal(out.tickets['step-t'].parentId, 't');
});

test('a daily goal not reached yet counts as planned today', () => {
  const work = goalFor('procrastination', { baseline: 'some', wake: '07:00' }); // 2 h a day
  const s = withTrials(base({ weeks: { [WK]: { goals: [gym, work] } }, profile: { ...base().profile, habits: [{ goalId: 'work', type: 'procrastination', baseline: 'some', barriers: [] }] },
    days: { '2026-11-17': { values: { 'work.hours': 0.5 } } } }), '2026-11-17');
  assert.match(morningLine(s, '2026-11-17').text, /^Today: Meaningful work\./);
});
