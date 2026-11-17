import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRecords, fromRecords, syncOnce } from '../lib/sync.js';

const sample = () => ({
  settings: { sessionMinutes: 45 },
  days: { '2026-11-17': { values: { 'gym.days': true } } },
  weeks: {}, tickets: { t1: { id: 't1', title: 'Doc' } },
  sessions: { '2026-11-17': [{ id: 's1', start: 1, workMin: 10 }] },
  experiments: [], intentions: [], purchases: [], activeSession: null,
  profile: { identity: 'someone who trains' },
  tactics: { k1: { id: 'k1', habitId: 'gym', tacticId: 'tiny-start' } },
  notes: { n1: { id: 'n1', day: '2026-11-17', kind: 'morning', text: 'Hi' } },
  pauses: [{ id: 'p1', startDay: '2026-11-10', endDay: '2026-11-12' }],
  otherRecords: { 'voyage/main': { leg: 3 } },
});

test('every kind survives a round trip through records', () => {
  const raw = sample();
  const back = fromRecords(toRecords(raw));
  for (const k of ['settings', 'days', 'tickets', 'sessions', 'profile', 'tactics', 'notes', 'pauses', 'otherRecords']) assert.deepEqual(back[k], raw[k], k);
});

test('a kind this version does not know is kept under otherRecords', () => {
  const m = new Map([['laurel/l1', { id: 'l1' }], ['settings/main', {}]]);
  assert.deepEqual(fromRecords(m).otherRecords, { 'laurel/l1': { id: 'l1' } });
});

// A tiny in-memory cloud and device.
function cloud() {
  const rows = new Map();
  let clock = 0;
  return {
    rows,
    api: {
      async push(list) { for (const r of list) rows.set(`${r.kind}/${r.id}`, { ...r, server_at: new Date(++clock * 1000).toISOString() }); return list.length; },
      async pull() { return [...rows.values()]; },
    },
  };
}
function device(initial) {
  let store = structuredClone(initial);
  return {
    read: async () => structuredClone(store),
    write: async (patch, remove) => { store = { ...store, ...patch }; for (const k of remove) delete store[k]; },
    get: () => store,
  };
}

test('a newer record kind is not deleted by a device that only keeps it as otherRecords', async () => {
  const c = cloud();
  await c.api.push([{ kind: 'laurel', id: 'l1', data: { id: 'l1' }, deleted: false, updated_at: 1 }]);
  const d = device({ settings: {} });
  let meta = (await syncOnce({ read: d.read, write: d.write, api: c.api }, undefined)).meta;
  assert.deepEqual(d.get().otherRecords, { 'laurel/l1': { id: 'l1' } });
  meta = (await syncOnce({ read: d.read, write: d.write, api: c.api }, meta)).meta;
  assert.equal(c.rows.get('laurel/l1').deleted, false, 'still there after a second sync');
});

test('first sync keeps the cloud copy and uploads what only this device has', async () => {
  const c = cloud();
  await c.api.push([{ kind: 'ticket', id: 't1', data: { id: 't1', title: 'Cloud' }, deleted: false, updated_at: 1 }]);
  const d = device({ tickets: { t1: { id: 't1', title: 'Local' }, t2: { id: 't2', title: 'Only here' } } });
  await syncOnce({ read: d.read, write: d.write, api: c.api }, undefined);
  assert.equal(d.get().tickets.t1.title, 'Cloud');
  assert.equal(c.rows.get('ticket/t2').data.title, 'Only here');
});
