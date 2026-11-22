import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { hermesRequest, parseHermes, openIdeas, answer, activeTrials, dueFollowUps, finish, tick, followUp, changeText, ideasId, answersId, crisisWeek } from '../lib/hermes.js';
import { buildRequest, parseReply } from '../lib/athenaAI.js';
import { duePushes } from '../lib/pushPlan.js';
import { weekKeyOf, dateKey, addDays, parseKey } from '../lib/score.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const setup = (id = 'one-week-in') => { const p = PERSONAS.find((x) => x.id === id); const s = p.build(); s.notes ??= {}; s.settings ??= {}; return { s, day: todayOf(p) }; };
const goalOf = (s, day, id) => s.weeks[weekKeyOf(day)].goals.find((g) => g.id === id);

// a model answer for the one-week-in person: a work block, a gym reminder, a try, and three bad ones
function answerFor(s, day) {
  const gym = s.weeks[weekKeyOf(day)].goals.find((g) => g.playbook === 'gym' || /gym/i.test(g.name)).id;
  const task = Object.values(s.tickets).find((t) => t.status !== 'done').id;
  return { gym, task, raw: { ideas: [
    { kind: 'plan_session', title: 'Work first, gym after', why: ['Your note: push work to mornings so gym fits'], taskId: task, at: 'tomorrow 09:00', minutes: 50, hour: '09:00' },
    { kind: 'set_cue', title: 'A gym reminder at 7 pm', why: ['Gym slipped this week'], goalId: gym, time: '19:00', hour: '18:30' },
    { kind: 'try', title: 'Lunch away from your phone', why: ['Scrolling slips most at midday'], text: 'Phone in your bag over lunch', check: 'Was lunch phone-free?', goalId: null, hour: '12:45' },
  ] } };
}

test('built once a week from the facts, notes and memory; never while paused or after a crisis note', () => {
  const { s, day } = setup();
  const req = hermesRequest(s, day);
  assert.ok(req && req.kind === 'hermes' && req.noteId === ideasId(weekKeyOf(day)));
  assert.ok(req.input.eveningNotes.some((n) => /mornings/.test(n.text)));
  s.notes[ideasId(weekKeyOf(day))] = { ideas: [] };
  assert.equal(hermesRequest(s, day), null, 'already built this week');
  assert.ok(hermesRequest(s, day, { force: true }));
  const p = setup(); p.s.pauses = [{ startDay: shift(p.day, -1), endDay: null }];
  assert.equal(hermesRequest(p.s, p.day), null, 'paused');
  const c = setup(); c.s.days[c.day] = { values: {}, reflection: 'I want to end it all' };
  assert.ok(crisisWeek(c.s, c.day)); assert.equal(hermesRequest(c.s, c.day), null, 'crisis');
  assert.equal(hermesRequest(setup('new-user').s, setup('new-user').day), null, 'too little data');
});

test('each idea is checked on its own: bad ids, medical words, invented numbers and repeats are dropped', () => {
  const { s, day } = setup();
  const req = buildRequest('hermes', s, day, weekKeyOf(day));
  const { raw, gym } = answerFor(s, day);
  const bad = [
    { kind: 'set_cue', title: 'A reminder', why: ['x'], goalId: 'nope', time: '07:00' },
    { kind: 'try', title: 'Try nicotine gum', why: ['It helps'], text: 'Nicotine gum at lunch', check: 'Did you?' },
    { kind: 'set_target', title: 'Gym 2 days', why: ['You did 37 sessions'], goalId: gym, target: 2 },
  ];
  const out = parseReply(req, JSON.stringify({ ideas: [...raw.ideas.slice(0, 2), ...bad] })).ideas;
  assert.deepEqual(out.map((i) => i.kind), ['plan_session', 'set_cue']); // only 3 are read; the bad third is dropped
  assert.equal(parseReply(req, 'nope'), null);
  assert.deepEqual(parseReply(req, '{"ideas": []}').ideas, [], 'nothing to suggest is a fine answer');
});

test('accept applies it as a 7-day trial; stop undoes it; a dropped idea is not offered again', () => {
  const { s, day } = setup();
  const req = buildRequest('hermes', s, day, weekKeyOf(day));
  const { raw, gym, task } = answerFor(s, day);
  s.notes[ideasId(weekKeyOf(day))] = { ideas: parseReply(req, raw).ideas };
  const ideas = openIdeas(s, day);
  assert.equal(ideas.length, 3);
  assert.match(changeText(s, ideas[1], day), /reminds you every day at 7 pm/);
  const before = goalOf(s, day, gym).cueTime;
  Object.assign(s, answer(s, ideas[1], 'accepted', day));
  assert.equal(goalOf(s, day, gym).cueTime, '19:00');
  assert.equal(activeTrials(s, day).length, 1);
  assert.equal(openIdeas(s, day).length, 2, 'answered ideas leave the list');
  const h = activeTrials(s, day)[0];
  Object.assign(s, finish(s, h, 'stopped'));
  assert.equal(goalOf(s, day, gym).cueTime, before, 'undone');
  // a work block sets the task's reminder (pushed by the server) and is undone the same way
  Object.assign(s, answer(s, ideas[0], 'accepted', day));
  assert.ok(s.tickets[task].remindAt > Date.parse(day));
  // "not now" this week, and next week the same idea isn't offered again
  Object.assign(s, answer(s, ideas[2], 'notnow', day));
  const next = shift(day, 7);
  s.notes[ideasId(weekKeyOf(next))] = { ideas: [{ ...ideas[2], id: `${weekKeyOf(next)}-1` }] };
  assert.equal(openIdeas(s, next).length, 0);
});

test('a try: an evening question each day, then did it help from the answers', () => {
  const { s, day } = setup();
  const req = buildRequest('hermes', s, day, weekKeyOf(day));
  s.notes[ideasId(weekKeyOf(day))] = { ideas: parseReply(req, answerFor(s, day).raw).ideas };
  const t = openIdeas(s, day).find((i) => i.kind === 'try');
  Object.assign(s, answer(s, t, 'accepted', day));
  for (let n = 0; n < 7; n++) Object.assign(s, tick(s, activeTrials(s, shift(day, n))[0], shift(day, n), n !== 3));
  const end = shift(day, 7);
  const h = dueFollowUps(s, end)[0];
  assert.ok(h, 'the follow-up is due the day after the trial');
  const f = followUp(s, h);
  assert.equal(f.rows.at(-1).during, '6 of 7 days');
  assert.equal(f.helped, true);
  Object.assign(s, finish(s, h, 'kept'));
  assert.equal(dueFollowUps(s, end).length, 0);
});

test('one notification a day, at the hour it is about; none while paused', () => {
  const { s, day } = setup();
  const req = buildRequest('hermes', s, day, weekKeyOf(day));
  s.notes[ideasId(weekKeyOf(day))] = { ideas: parseReply(req, answerFor(s, day).raw).ideas };
  s.settings.tz = 'UTC';
  const at = (hhmm) => Date.parse(`${day}T${hhmm}:00Z`);
  const p = duePushes(s, at('12:50')).filter((x) => x.key.startsWith('hermes:'));
  assert.equal(p.length, 1);
  assert.match(p[0].url, /open=hermes/);
  assert.equal(duePushes(s, at('18:40'), new Set([p[0].key])).filter((x) => x.key.startsWith('hermes:')).length, 0, 'one a day');
  s.pauses = [{ startDay: day, endDay: null }];
  assert.equal(duePushes(s, at('12:50')).filter((x) => x.key.startsWith('hermes:')).length, 0);
});

test('change it: your time or number, and the title follows', async () => {
  const { withChange } = await import('../lib/hermes.js');
  const x = withChange({ kind: 'set_cue', title: 'A gym reminder at 7 pm', time: '19:00' }, '18:45');
  assert.equal(x.time, '18:45'); assert.equal(x.title, 'A gym reminder at 6:45 pm');
  assert.equal(withChange({ kind: 'plan_session', title: 'Start at 9 am', at: 'tomorrow 09:00' }, '08:30').at, 'tomorrow 08:30');
  assert.equal(withChange({ kind: 'set_target', title: 'Gym at 2 days', target: 2 }, 3).title, 'Gym at 3 days');
});

test('eval fixes: a time in the wrong field, a limit eased in a hard week', () => {
  const { s, day } = setup();
  const req = buildRequest('hermes', s, day, weekKeyOf(day));
  const { task } = answerFor(s, day);
  const out = parseReply(req, { ideas: [{ kind: 'plan_session', title: 'Start office work', why: ['Your note about mornings'], taskId: task, time: 'tomorrow 09:00', minutes: 60, hour: '09:00' }] }).ideas;
  assert.equal(out[0]?.at, 'tomorrow 09:00');
  const p = PERSONAS.find((x) => x.id === 'rough-week-peril'); const r = p.build(); r.notes ??= {}; r.settings ??= {}; const d = todayOf(p);
  const rq = buildRequest('hermes', r, d, weekKeyOf(d));
  assert.equal(rq.input.hardWeek, true);
  const ease = { kind: 'set_target', title: 'Ease the scrolling limit', why: ['Boredom is the recorded trigger.'], goalId: 'scrolling' };
  assert.equal(parseReply(rq, { ideas: [{ ...ease, target: 90 }] }).ideas.length, 1, 'a higher limit is easier');
  assert.equal(parseReply(rq, { ideas: [{ ...ease, target: 45 }] }).ideas.length, 0, 'a lower limit is harder');
});
