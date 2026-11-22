import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';
import { chatRequest, parseChat, withMessages, leftToday, MEDICAL_LINE, CHAT_PER_DAY, CHAT_ID } from '../lib/hermesChat.js';
import { threadItems, unreadCount, ideaState } from '../lib/hermesThread.js';
import { answer, finish, undoable, activeTrials, dueFollowUps, ideasId, momentId, isValid } from '../lib/hermes.js';
import { fixFor, atTime } from '../lib/weakFix.js';
import { duePushes } from '../lib/pushPlan.js';
import { CRISIS_LINE } from '../lib/safety.js';
import { weekKeyOf, dateKey, addDays, parseKey, isPaused } from '../lib/score.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const setup = (id = 'one-week-in') => { const p = PERSONAS.find((x) => x.id === id); const s = p.build(); s.notes ??= {}; s.settings ??= {}; return { s, day: todayOf(p) }; };
const NOW = (day, h = 10) => { const d = parseKey(day); d.setHours(h, 0, 0, 0); return d.getTime(); };

test('chat: a trip becomes a pause, checked by code; crisis never reaches the AI', () => {
  const { s, day } = setup();
  const req = chatRequest(s, day, 10, 'Flying out Thursday, back Sunday night', { now: NOW(day) });
  assert.equal(req.kind, 'chat');
  assert.ok(req.input.facts.habits.length && req.input.message.includes('Thursday'));
  const from = shift(day, 1), until = shift(day, 4);
  const out = parseChat(req, { reply: 'Then let’s keep the trip light: your habits can rest while you are away.', ideas: [{ kind: 'pause_days', title: 'Pause your habits for the trip', why: ['You are flying out Thursday'], from, until }], remember: 'You travel for work most months.' }, s, day);
  assert.equal(out.ideas.length, 1);
  assert.equal(out.ideas[0].chat, true);
  assert.equal(out.remember, 'You travel for work most months.');
  // too long a pause, or one in the past, is dropped
  assert.equal(parseChat(req, { reply: 'Okay.', ideas: [{ kind: 'pause_days', title: 'Pause', why: ['x'], from, until: shift(day, 30) }] }, s, day).ideas.length, 0);
  assert.equal(parseChat(req, { reply: 'Okay.', ideas: [{ kind: 'pause_days', title: 'Pause', why: ['x'], from: shift(day, -2), until }] }, s, day).ideas.length, 0);
  // accepted: a pause, undone cleanly, and no 7-day trial for it
  Object.assign(s, answer(s, out.ideas[0], 'accepted', day));
  assert.ok(isPaused(s, from) && !isPaused(s, day));
  assert.equal(activeTrials(s, day).length, 0, 'a pause is not a trial');
  const h = undoable(s, day)[0];
  Object.assign(s, finish(s, h, 'stopped'));
  assert.ok(!isPaused(s, from));
  assert.deepEqual(chatRequest(s, day, 10, 'I want to end it all'), { fixed: CRISIS_LINE });
});

test('chat checks: written to you, no invented numbers, no medical advice beyond the fixed line', () => {
  const { s, day } = setup();
  const req = chatRequest(s, day, 10, 'Im wiped today', { now: NOW(day) });
  assert.equal(parseChat(req, { reply: 'The user should rest.', ideas: [] }, s, day), null, 'third person');
  assert.equal(parseChat(req, { reply: 'You slept 37 hours, so rest.', ideas: [] }, s, day), null, 'a number not in the facts');
  assert.equal(parseChat(req, { reply: 'Take melatonin tonight.', ideas: [] }, s, day), null, 'medical advice');
  const med = chatRequest(s, day, 10, 'Should I take melatonin to sleep earlier?', { now: NOW(day) });
  assert.equal(med.input.askedAboutMedicine, true);
  const r = parseChat(med, { reply: 'I can’t advise on supplements. A wind-down reminder could help.', ideas: [] }, s, day);
  assert.ok(r.reply.startsWith(MEDICAL_LINE));
  assert.ok(!/supplements\. A/.test(r.reply.slice(MEDICAL_LINE.length)), 'the model’s own boundary line is replaced by the fixed one');
  assert.equal(parseChat(req, 'not json', s, day), null);
});

test('the thread: ideas, moments, chat and follow-ups in order; the unread count clears when seen', () => {
  const { s, day } = setup('deadline-crunch');
  const wk = weekKeyOf(day);
  const now = NOW(day, 11);
  s.notes[ideasId(wk)] = { ideas: [{ id: `${wk}-1`, kind: 'plan_session', title: 'Start the investor update', why: ['Due tomorrow'], taskId: 't1', at: 'today 14:00', minutes: 60 }], at: NOW(day, 6) };
  s.notes[momentId(day)] = { ideas: [], moment: { type: 'deadline', key: 'task:t1', what: 'x' }, at: NOW(day, 10) };
  Object.assign(s, withMessages(s, [{ id: 'a', from: 'you', text: 'Busy day', at: now - 60000, day }, { id: 'b', from: 'hermes', text: 'Then keep it small.', at: now - 30000 }], now));
  const items = threadItems(s, day, now);
  assert.deepEqual(items.map((x) => x.kind), ['ideas', 'you', 'hermes'], 'a moment with no idea is left out');
  assert.equal(unreadCount(s, day, now), 2, 'an open idea and an unread reply');
  s.settings.hermesSeen = now;
  assert.equal(unreadCount(s, day, now), 0);
  assert.equal(ideaState(s, items[0].ideas[0], day), 'open');
  Object.assign(s, answer(s, items[0].ideas[0], 'accepted', day));
  assert.equal(ideaState(s, items[0].ideas[0], day), 'accepted');
  // the badge count rides on every push
  s.settings.tz = 'UTC'; s.settings.hermesSeen = 0;
  const p = duePushes(s, Date.parse(`${day}T08:00:00Z`));
  if (p.length) assert.equal(typeof p[0].badge, 'number');
  // the daily limit counts your messages, not the fixed lines
  assert.equal(leftToday(s, day), CHAT_PER_DAY - 1);
  assert.ok(s.notes[CHAT_ID].msgs.length === 2);
});

test('a weak spot becomes a one-tap fix, set at your time, undone like any Hermes change', () => {
  const { s, day } = setup('procrastinator');
  const wk = weekKeyOf(day);
  const w = { id: 'habit:work', title: 'Focus slipped', why: '40% on track.', fix: 'Give it a set time.' };
  const f = fixFor(s, w, wk, day);
  assert.equal(f.idea.kind, 'set_cue');
  assert.equal(f.idea.time, '09:00', 'focus habits default to the morning');
  const idea = atTime(f.idea, '08:30');
  assert.match(idea.title, /8:30 am/);
  Object.assign(s, answer(s, idea, 'accepted', day));
  const g = s.weeks[wk].goals.find((x) => x.id === 'work');
  assert.equal(g.cueTime, '08:30');
  const h = undoable(s, day).find((x) => x.ideaId === idea.id);
  Object.assign(s, finish(s, h, 'stopped'));
  assert.notEqual(s.weeks[wk].goals.find((x) => x.id === 'work').cueTime, '08:30');
  // a big task: start it tomorrow; nothing to set for an unknown weak spot
  const t = setup('deadline-crunch');
  const big = fixFor(t.s, { id: 'tasks:big', title: 'Big tasks', why: 'x', fix: 'y' }, weekKeyOf(t.day), t.day);
  assert.equal(big.idea.kind, 'plan_session');
  assert.equal(fixFor(t.s, { id: 'delay:tired', title: 'x', why: 'x', fix: 'y' }, weekKeyOf(t.day), t.day), null);
});
