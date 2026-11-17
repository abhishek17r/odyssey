import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPGRADES, SCHEMA } from '../lib/storage.js';

test('upgrade 4 → 5 keeps everything and adds the new places', () => {
  const old = { schemaVersion: 4, days: { a: { values: {} } }, tickets: { t: { id: 't' } }, purchases: [{ id: 'p' }] };
  const up = UPGRADES[4](structuredClone(old));
  assert.equal(up.schemaVersion, 5);
  assert.equal(SCHEMA, 5);
  assert.deepEqual(up.days, old.days);
  assert.deepEqual(up.tickets, old.tickets);
  assert.deepEqual(up.purchases, old.purchases);
  assert.deepEqual([up.profile, up.tactics, up.notes, up.pauses], [null, {}, {}, []]);
});
