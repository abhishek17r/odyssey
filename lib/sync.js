// Record-by-record sync between this device's storage and the cloud. Newest edit wins.
//
// The stored state is split into records: settings, each day, each week's plan, each ticket, each timer
// session, each experiment / intention / purchase, and the running session. A "shadow" remembers what each
// record looked like (a hash) and when it was last edited (ms) at the last sync, so this device knows what
// it changed since. `backups`, `auth` and `syncMeta` stay on the device.
//
// syncOnce: on a device's first sync it pulls everything and keeps the cloud's copy of any record both
// have, then uploads what only it has. After that it pushes its own edits first, then pulls everyone else's.

export const SYNCED_KEYS = ['settings', 'days', 'weeks', 'tickets', 'sessions', 'experiments', 'intentions', 'purchases', 'activeSession'];
const OVERLAP_MS = 5 * 60000; // re-read the last few minutes each pull, in case of late commits

// stable JSON (sorted keys) → short hash
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}
export function hash(v) {
  const s = stable(v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${s.length}`;
}

// raw storage → Map('kind/id' → data)
export function toRecords(raw) {
  const m = new Map();
  if (raw.settings) m.set('settings/main', raw.settings);
  for (const [k, v] of Object.entries(raw.days || {})) m.set(`day/${k}`, v);
  for (const [k, v] of Object.entries(raw.weeks || {})) m.set(`week/${k}`, v);
  for (const [k, v] of Object.entries(raw.tickets || {})) m.set(`ticket/${k}`, v);
  for (const [day, list] of Object.entries(raw.sessions || {})) for (const x of list || []) if (x?.id) m.set(`session/${x.id}`, { ...x, day });
  for (const x of raw.experiments || []) if (x?.id) m.set(`experiment/${x.id}`, x);
  for (const x of raw.intentions || []) if (x?.id) m.set(`intention/${x.id}`, x);
  for (const x of raw.purchases || []) if (x?.id) m.set(`purchase/${x.id}`, x);
  if (raw.activeSession) m.set('active/main', raw.activeSession);
  return m;
}

// Map → the synced storage keys (activeSession: null means remove it)
export function fromRecords(m) {
  const out = { settings: undefined, days: {}, weeks: {}, tickets: {}, sessions: {}, experiments: [], intentions: [], purchases: [], activeSession: null };
  for (const [key, data] of m) {
    const i = key.indexOf('/');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind === 'settings') out.settings = data;
    else if (kind === 'day') out.days[id] = data;
    else if (kind === 'week') out.weeks[id] = data;
    else if (kind === 'ticket') out.tickets[id] = data;
    else if (kind === 'session') { const { day, ...x } = data; (out.sessions[day] ??= []).push(x); }
    else if (kind === 'experiment') out.experiments.push(data);
    else if (kind === 'intention') out.intentions.push(data);
    else if (kind === 'purchase') out.purchases.push(data);
    else if (kind === 'active') out.activeSession = data;
  }
  for (const list of Object.values(out.sessions)) list.sort((a, b) => a.start - b.start);
  for (const k of ['experiments', 'intentions', 'purchases']) out[k].sort((a, b) => (a.at ?? a.startDay ?? 0) > (b.at ?? b.startDay ?? 0) ? 1 : -1);
  if (out.settings === undefined) delete out.settings;
  return out;
}

const split = (key) => { const i = key.indexOf('/'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };
const maxIso = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * One sync pass.
 * io: { read(): raw storage, write(patch, removeKeys), api: { push(rows), pull(sinceIso) }, now() }
 * meta: { lastPull: ISO|null, shadow: { key: { h, t } } } (returned updated; the caller saves it)
 * → { meta, pushed, pulled, applied }
 */
export async function syncOnce(io, meta = { lastPull: null, shadow: {} }) {
  const now = io.now ? io.now() : Date.now();
  meta = { lastPull: meta.lastPull || null, shadow: { ...(meta.shadow || {}) } };
  const raw = await io.read();
  const local = toRecords(raw);
  const merged = new Map(local);
  let applied = 0;
  const appliedKeys = new Set();
  let pushed = 0;
  let maxSeen = meta.lastPull;

  const apply = (rows, force) => {
    for (const r of rows) {
      const key = `${r.kind}/${r.id}`;
      maxSeen = maxIso(maxSeen, r.server_at);
      const known = meta.shadow[key];
      if (!force && known && Number(r.updated_at) <= known.t) continue;
      if (r.deleted || r.data == null) merged.delete(key);
      else merged.set(key, r.data);
      meta.shadow[key] = { h: r.deleted ? null : hash(r.data), t: Number(r.updated_at) };
      appliedKeys.add(key);
      applied++;
    }
  };

  const changes = (keys) => {
    const rows = [];
    for (const key of keys) {
      const data = merged.get(key);
      const h = data === undefined ? null : hash(data);
      const known = meta.shadow[key];
      if (known && known.h === h) continue;
      if (!known && data === undefined) continue;
      const t = Math.max(now, (known?.t || 0) + 1);
      rows.push({ ...split(key), data: data ?? null, deleted: data === undefined, updated_at: t });
      meta.shadow[key] = { h, t };
    }
    return rows;
  };

  if (!meta.lastPull) {
    // First sync on this device: the cloud's copy wins wherever both have the record.
    const rows = await io.api.pull(null);
    const remote = new Set(rows.map((r) => `${r.kind}/${r.id}`));
    apply(rows, true);
    const mine = changes([...local.keys()].filter((k) => !remote.has(k)));
    pushed = await io.api.push(mine) ?? mine.length;
  } else {
    // Push this device's edits, then take everyone else's.
    const mine = changes(new Set([...merged.keys(), ...Object.keys(meta.shadow)]));
    if (mine.length) pushed = (await io.api.push(mine)) ?? mine.length;
    const since = new Date(Math.max(0, new Date(meta.lastPull).getTime() - OVERLAP_MS)).toISOString();
    apply(await io.api.pull(since), false);
  }

  if (applied) {
    // Re-read, so edits made on this device while syncing survive; change only what came from the cloud.
    const fresh = await io.read();
    const recs = toRecords(fresh);
    for (const key of appliedKeys) { if (merged.has(key)) recs.set(key, merged.get(key)); else recs.delete(key); }
    const next = fromRecords(recs);
    const remove = [];
    if (!next.activeSession) { delete next.activeSession; if (fresh.activeSession) remove.push('activeSession'); }
    await io.write(next, remove);
  }
  // only server times, never this device's clock (it may be off); epoch = "first sync done, nothing seen yet"
  meta.lastPull = maxSeen || meta.lastPull || '1970-01-01T00:00:00.000Z';
  return { meta, pushed, applied };
}
