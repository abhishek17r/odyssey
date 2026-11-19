import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseReply, costOf, textHash, noteIds, MODELS, noteFor, needsNote, effortFor } from '../lib/athenaAI.js';
import { morningLine, eveningReply, weeklyRead } from '../lib/athena.js';
import { goalFor } from '../lib/strategies.js';

const WK = '2026-11-14';
const gym = goalFor('gym', { baseline: 'none', wake: '07:00' });
const state = (extra = {}) => ({
  weeks: { [WK]: { goals: [gym] } }, days: { '2026-11-16': { values: { 'gym.days': true }, reflection: 'Good session, felt strong.' }, '2026-11-17': { values: { x: 1 } }, '2026-11-18': { values: { x: 1 } } },
  tickets: {}, sessions: {}, settings: {}, tactics: {}, notes: {}, pauses: [],
  profile: { identity: 'someone who trains', onboardedAt: Date.parse('2026-11-15T09:00'), habits: [{ goalId: 'gym', type: 'gym', baseline: 'none', barriers: [] }] },
  ...extra,
});

test('requests carry the draft and only the person’s own facts', () => {
  const r = buildRequest('morning', state(), '2026-11-19'); // Thursday: gym planned
  assert.equal(r.model, MODELS.small);
  assert.match(r.draft.text, /Gym/);
  const user = JSON.parse(r.messages[1].content);
  assert.equal(user.facts.identity, 'someone who trains');
  assert.equal(user.facts.habits[0].name, 'Gym');
  assert.equal(buildRequest('morning', state({ profile: null }), '2026-11-19'), null);
});

test('answers are checked: length, no invented numbers, JSON', () => {
  const r = buildRequest('morning', state(), '2026-11-19');
  assert.deepEqual(parseReply(r, '{"text":"Gym today. Twenty minutes is enough."}'), { text: 'Gym today. Twenty minutes is enough.' });
  assert.equal(parseReply(r, '{"text":"You have trained 47 times."}'), null); // 47 isn't in the draft
  assert.equal(parseReply(r, 'not json'), null);
  assert.equal(parseReply(r, JSON.stringify({ text: 'word '.repeat(60) })), null);
  assert.equal(parseReply(r, '{"text":"Great job!"}').text, 'Great job.');
});

test('the weekly read keeps the facts', () => {
  const r = buildRequest('weekly', state(), '2026-11-17');
  assert.equal(r.model, MODELS.large);
  const keep = r.draft.lines.join(' ').match(/\d+/)[0];
  assert.ok(parseReply(r, JSON.stringify({ lines: [`You kept ${keep}% this week.`, 'Gym was your anchor.', 'Steady sailing.'] })));
  assert.equal(parseReply(r, JSON.stringify({ lines: ['Lovely week.', 'Keep going.'] })), null); // lost every number
});

test('the app shows the AI wording when it exists, else the template', () => {
  const s = state();
  const tmpl = morningLine(s, '2026-11-19').text;
  s.notes[noteIds.morning('2026-11-19')] = { text: 'Gym after work today; twenty minutes counts.' };
  assert.equal(morningLine(s, '2026-11-19').text, 'Gym after work today; twenty minutes counts.');
  assert.notEqual(tmpl, morningLine(s, '2026-11-19').text);
  // an evening reply only for the reflection it answered
  s.notes[noteIds.evening('2026-11-16')] = { text: 'Strong is right. Rest well.', for: textHash('Good session, felt strong.') };
  assert.equal(eveningReply(s, '2026-11-16'), 'Strong is right. Rest well.');
  s.days['2026-11-16'].reflection = 'Actually, tired.';
  assert.notEqual(eveningReply(s, '2026-11-16'), 'Strong is right. Rest well.');
  // the AI never feeds its own drafts
  assert.ok(!buildRequest('morning', s, '2026-11-19').draft.ai);
});

test('cost per call', () => {
  assert.equal(costOf('gpt-5-nano', 1e6, 1e6), 0.45);
  assert.equal(costOf('unknown-model', 1000, 1000), 0);
});

test('a note answers one draft: stale wording falls back to the template, and the server knows to rewrite', () => {
  const s = state();
  const req = buildRequest('morning', s, '2026-11-19');
  const note = noteFor(req, { text: 'Gym today, gently.' }, '2026-11-19', WK, MODELS.small);
  assert.equal(note.id, noteIds.morning('2026-11-19'));
  assert.equal(note.for, req.forHash);
  s.notes[note.id] = note;
  assert.equal(morningLine(s, '2026-11-19').text, 'Gym today, gently.');
  assert.equal(needsNote(req, note), false); // same draft: no call
  s.notes[note.id] = { ...note, for: 'something-else' };
  assert.notEqual(morningLine(s, '2026-11-19').text, 'Gym today, gently.'); // the draft moved on
  assert.equal(needsNote(req, s.notes[note.id]), true);
  const w = buildRequest('weekly', s, '2026-11-20', WK);
  const wn = noteFor(w, { lines: ['a', 'b'] }, '2026-11-20', WK, MODELS.large);
  assert.equal(wn.id, noteIds.weekly(WK));
  s.notes[wn.id] = wn;
  assert.deepEqual(weeklyRead(s, '2026-11-20', WK).lines, ['a', 'b']);
});

test('cached prompt tokens cost a tenth', () => {
  assert.equal(costOf('gpt-5-nano', 1e6, 0, undefined, 1e6), 0.005);
  assert.equal(costOf('gpt-5-nano', 1e6, 0, undefined, 0), 0.05);
});

test('the reasoning setting matches each model family', () => {
  assert.equal(effortFor('gpt-5-nano'), 'minimal');
  assert.equal(effortFor('gpt-5'), 'minimal');
  assert.equal(effortFor('gpt-5.6-luna'), 'none');
  assert.equal(costOf('gpt-5.6-luna', 1e6, 1e6), 1.4);
});
