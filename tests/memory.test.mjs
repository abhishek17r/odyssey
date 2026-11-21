import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { memoryRequest, parseMemory, mergeMemory, memoryFacts, addLine, editLine, deleteLine, forgetAll, setUseNotes, triedMemory, MEMORY_ID } from '../lib/memory.js';
import { buildRequest, parseReply } from '../lib/athenaAI.js';
import { weekKeyOf } from '../lib/score.js';

const persona = (id) => PERSONAS.find((p) => p.id === id);
const setup = (id) => { const p = persona(id); const s = p.build(); s.notes ??= {}; return { s, day: todayOf(p) }; };
const good = (req) => ({
  about: 'Cutting down on smoking, with coffee as the main trigger.',
  works: ['Waiting 3 minutes before each one'],
  doesnt: ['Coffee: 91 percent of cigarettes come with it'],
  commit: [],
  know: [],
});

test('built from four weeks of data, once a week, and never while off', () => {
  const { s, day } = setup('smoker-slipping');
  const req = memoryRequest(s, day);
  assert.ok(req && req.kind === 'memory' && req.noteId === MEMORY_ID);
  assert.ok(req.input.thisWeek.habits.length && req.input.weeksBefore.length);
  s.notes.memory = { id: 'memory', kind: 'memory', lines: [], wk: weekKeyOf(day) };
  assert.equal(memoryRequest(s, day), null, 'already built this week');
  assert.ok(memoryRequest(s, day, { force: true }), 'the owner can force it');
  s.notes.memory = forgetAll(s.notes.memory);
  assert.equal(memoryRequest(s, day, { force: true }), null, 'off means off');
});

test('too little data: nothing to remember yet', () => {
  const { s, day } = setup('new-user');
  assert.equal(memoryRequest(s, day), null);
});

test('a hard night is never sent to the memory job', () => {
  const { s, day } = setup('low-mood');
  const req = memoryRequest(s, day, { force: true });
  if (!req) return; // too little data for this persona
  assert.ok(!req.input.yourWords.eveningNotes.some((n) => /hurt myself|end it|no point/i.test(n.text)));
});

test('the answer is checked: numbers from the input, no medical words, short lines', () => {
  const { s, day } = setup('smoker-slipping');
  const req = memoryRequest(s, day);
  assert.ok(parseMemory(req, JSON.stringify(good(req))));
  assert.equal(parseMemory(req, JSON.stringify({ ...good(req), works: ['Smoking 37 a day works'] })), null, 'an invented number');
  assert.equal(parseMemory(req, JSON.stringify({ ...good(req), works: ['Nicotine gum would help'] })), null, 'medical');
  assert.equal(parseMemory(req, JSON.stringify({ ...good(req), works: ['a', 'b', 'c', 'd', 'e'] })), null, 'too many');
  assert.equal(parseMemory(req, JSON.stringify({ ...good(req), about: '' })), null, 'no about');
  assert.equal(parseMemory(req, 'nope'), null);
});

test('merging keeps your lines, skips what you deleted, and caps each list', () => {
  let m = addLine(null, 'know', 'I work night shifts on Tuesdays', 1);
  m = mergeMemory(m, { about: 'A', works: ['Gym after work', 'Mornings'], doesnt: [], commit: [], know: ['i work night shifts on tuesdays'] }, { wk: 'w1' });
  assert.equal(m.lines.filter((l) => l.list === 'know').length, 1, 'no repeat of your own line');
  assert.equal(m.lines.find((l) => l.list === 'know').from, 'you');
  const gym = m.lines.find((l) => l.text === 'Gym after work');
  m = deleteLine(m, gym.id);
  assert.deepEqual(m.dropped, ['Gym after work']);
  m = mergeMemory(m, { about: 'B', works: ['Gym after work', 'Evenings'], doesnt: [], commit: [], know: [] }, { wk: 'w2' });
  assert.ok(!m.lines.some((l) => l.text === 'Gym after work'), 'a deleted line is never written again');
  assert.ok(!m.lines.some((l) => l.text === 'Mornings'), 'her old lines are replaced each week');
  assert.ok(m.lines.some((l) => l.text === 'Evenings'));
  assert.equal(m.about.text, 'B');
});

test('your edits make a line yours; your about is never overwritten', () => {
  let m = mergeMemory(null, { about: 'Hers', works: ['Mornings'], doesnt: [], commit: [], know: [] }, { wk: 'w1' });
  m = editLine(m, m.lines[0].id, 'Early mornings, before 8');
  assert.equal(m.lines[0].from, 'you');
  m = { ...m, about: { text: 'Mine', from: 'you' } };
  m = mergeMemory(m, { about: 'Hers again', works: ['Other'], doesnt: [], commit: [], know: [] }, { wk: 'w2' });
  assert.equal(m.about.text, 'Mine');
  assert.ok(m.lines.some((l) => l.text === 'Early mornings, before 8'));
});

test('turning evening notes off forgets what she learnt from them', () => {
  let m = mergeMemory(null, { about: 'A', works: [], doesnt: [], commit: [], know: ['Night shifts on Tuesdays'] }, { wk: 'w1', notes: true });
  assert.equal(m.lines[0].from, 'notes');
  m = setUseNotes(m, false);
  assert.equal(m.lines.length, 0);
  assert.equal(m.useNotes, false);
});

test('a rejected build is tried at most twice a week', () => {
  const { s, day } = setup('smoker-slipping');
  const wk = weekKeyOf(day);
  s.notes.memory = triedMemory(triedMemory(null, wk), wk);
  assert.equal(memoryRequest(s, day), null);
});

test('every Athena note is written with the memory, and never brings up what you asked her not to', () => {
  const { s, day } = setup('smoker-slipping');
  s.profile = { onboardedAt: 1, habits: [{ goalId: 'smoke', type: 'smoking' }] };
  let m = mergeMemory(null, { about: 'Cutting down, coffee is the trigger.', works: ['Waiting 3 minutes first'], doesnt: [], commit: [], know: [] }, { wk: 'w1' });
  m = addLine(m, 'avoid', 'my weight');
  m = addLine(m, 'know', 'Training for a 10 km run in March');
  s.notes.memory = m;
  assert.deepEqual(memoryFacts(s).neverMention, ['my weight']);
  const req = buildRequest('morning', s, day);
  assert.ok(req.messages[1].content.includes('Waiting 3 minutes first'));
  assert.equal(parseReply(req, JSON.stringify({ text: 'Go easy on yourself and my weight today.' })), null, 'brings up an avoided topic');
  assert.ok(parseReply(req, JSON.stringify({ text: 'One steady day for the 10 km run in March.' })), 'a number from memory counts as a fact');
  s.notes.memory = forgetAll(m);
  assert.equal(memoryFacts(s), null);
  assert.ok(!buildRequest('morning', s, day).messages[1].content.includes('"memory"'));
});
