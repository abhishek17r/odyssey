import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duePushes, DAILY_CAP } from '../lib/pushPlan.js';
import { goalFor } from '../lib/strategies.js';

const gym = { ...goalFor('gym', { baseline: 'none', wake: '07:00' }), cueTime: '08:40' };
const state = {
  settings: { tz: 'UTC', morningTime: '08:30', middayTime: '08:35', reminderTime: '08:45' },
  weeks: { '2026-11-14': { goals: [gym] } }, days: {}, tickets: {}, sessions: {}, tactics: {}, notes: {}, pauses: [],
  profile: { identity: 'someone who trains', onboardedAt: Date.parse('2026-11-16T09:00'), habits: [{ goalId: 'gym', type: 'gym', baseline: 'none', barriers: [] }] },
};
const at = (hhmm) => Date.parse(`2026-11-19T${hhmm}:00Z`); // a Thursday: gym is planned

test('the morning push is Athena’s line', () => {
  const p = duePushes(state, at('08:31')).find((x) => x.key.startsWith('morning:'));
  assert.equal(p.title, 'Athena');
  assert.match(p.body, /^Today: Gym\./);
});

test('at most three reminders a day; a finished session always gets through', () => {
  const sent = new Set(['morning:2026-11-19', 'midday:2026-11-19', 'cue:gym:2026-11-19']);
  assert.equal(DAILY_CAP, 3);
  assert.equal(duePushes(state, at('08:50'), sent).filter((x) => !x.key.startsWith('end:')).length, 0);
  const running = { ...state, activeSession: { id: 's', phase: 'work', minutes: 25, task: 'Doc', workMs: 0, phaseStart: at('08:00') } };
  assert.ok(duePushes(running, at('08:50'), sent).some((x) => x.key === 'end:s'));
});

test('every notification says where a tap lands', () => {
  const urls = Object.fromEntries(duePushes(state, at('08:31')).map((x) => [x.key.split(':')[0], x.url]));
  assert.equal(urls.morning, './?open=tasks');
  const cue = duePushes(state, at('08:41'), new Set(['morning:2026-11-19', 'midday:2026-11-19'])).find((x) => x.key.startsWith('cue:'));
  assert.equal(cue.url, './?open=habit&id=gym');
  const fri = Date.parse('2026-11-20T20:05:00Z');
  const rep = duePushes({ ...state, settings: { ...state.settings, planTime: '20:00' } }, fri).find((x) => x.key.startsWith('plan:'));
  assert.equal(rep.url, './?open=report&id=2026-11-14');
  assert.equal(rep.title, 'Your week is in');
  const running = { ...state, activeSession: { id: 's', phase: 'work', minutes: 25, task: 'Doc', workMs: 0, phaseStart: at('08:00') } };
  assert.equal(duePushes(running, at('08:50')).find((x) => x.key === 'end:s').url, './?open=session');
});
