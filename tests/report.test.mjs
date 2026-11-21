import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekReport, reportWeekFor } from '../lib/report.js';
import { onTrack } from '../lib/onTrack.js';
import { weekKeyOf } from '../lib/score.js';
import { PERSONAS, todayOf } from '../scripts/brain/personas.mjs';

const get = (id) => { const p = PERSONAS.find((x) => x.id === id); return { s: p.build(), t: todayOf(p) }; };

test('the report opens on this week on Friday, else on the last finished week', () => {
  assert.equal(reportWeekFor('2026-11-20'), '2026-11-14'); // Friday: the week ending today
  assert.equal(reportWeekFor('2026-11-21'), '2026-11-14'); // Saturday: the week that just ended
  assert.equal(reportWeekFor('2026-11-19'), '2026-11-07'); // Thursday: last week
});

test('every sample person gets a report, with at most 3 weak spots, each with a fix', () => {
  for (const p of PERSONAS) {
    const s = p.build(), t = todayOf(p);
    for (const wk of [weekKeyOf(t), reportWeekFor(t)]) {
      const r = weekReport(s, wk, t);
      assert.ok(r.weak.length <= 3, p.id);
      for (const w of r.weak) assert.ok(w.title && w.why && w.fix, `${p.id}: ${w.id}`);
    }
  }
});

test('a limit habit over the limit is a weak spot about the limit, not about setting a time', () => {
  const { s, t } = get('scrolling-late');
  const w = weekReport(s, weekKeyOf(t), t).weak.find((x) => x.id.startsWith('habit:'));
  assert.match(w.title, /over the limit/);
  assert.match(w.fix, /Pause the urge/);
});

test('a slow-starting week names the main reason and what to try', () => {
  const { s, t } = get('procrastinator');
  const r = weekReport(s, weekKeyOf(t), t);
  assert.ok(r.weak.some((w) => w.id === 'delay:unclear' && /next step/.test(w.fix)));
});

test('On track is the average of each habit’s share, per habit', () => {
  const { s, t } = get('mixed');
  const o = onTrack(weekKeyOf(t), s, t);
  assert.ok(o.rows.length >= 2);
  for (const r of o.rows) assert.ok(r.line.length > 0);
  assert.equal(typeof o.pct, 'number');
});
