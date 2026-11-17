// Runs a sync against chrome.storage.local (the extension's, or the web app's stand-in) and records
// how it went in `syncMeta` ({ lastPull, shadow, at, error }). One sync at a time.

import { syncOnce, SYNCED_KEYS } from './sync.js';
import { api, cloudOn, token } from './cloud.js';
import { SCHEMA } from './storage.js';

// Storage keys whose changes should trigger a sync (not sync's own bookkeeping).
export const triggersSync = (changedKeys) => changedKeys.some((k) => SYNCED_KEYS.includes(k));

let running = null;
export function syncNow() {
  if (running) return running;
  running = (async () => {
    if (!cloudOn()) return { status: 'off' };
    let t = null;
    try { t = await token(); } catch { /* offline, or the session ended */ }
    if (!t) return { status: 'signedOut' };
    const { syncMeta = {} } = await chrome.storage.local.get('syncMeta');
    try {
      const res = await syncOnce({
        read: () => chrome.storage.local.get(SYNCED_KEYS),
        write: async (patch, remove) => {
          // cloud data is always on the current schema
          if (!(await chrome.storage.local.get('schemaVersion')).schemaVersion) patch = { ...patch, schemaVersion: SCHEMA };
          await chrome.storage.local.set(patch);
          if (remove.length) await chrome.storage.local.remove(remove);
        },
        api,
      }, syncMeta);
      await chrome.storage.local.set({ syncMeta: { ...res.meta, at: Date.now(), error: null } });
      return { status: 'ok', pushed: res.pushed, applied: res.applied };
    } catch (e) {
      await chrome.storage.local.set({ syncMeta: { ...syncMeta, error: e.message || String(e), errorAt: Date.now() } });
      return { status: 'error', error: e.message || String(e) };
    }
  })().finally(() => { running = null; });
  return running;
}

// Debounced: call after local edits.
let timer = null;
export function syncSoon(ms = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}
