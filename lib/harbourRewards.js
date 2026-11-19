// Rewards waiting at the voyage's harbours: set by the owner on the admin page (supabase/voyage.sql), cached on
// this device. Without an account (or before the server has any), the built-in DEFAULT_REWARDS stand in.
// Claims ("I got it") are kept in settings.claims, so they sync with everything else.

import { DEFAULT_REWARDS } from '../rewards.config.js';
import { cloudOn, currentUser, rpc } from './cloud.js';

const KEY = 'harbourRewards';

export async function cachedRewards() {
  try {
    const { [KEY]: c } = await chrome.storage.local.get(KEY);
    return Array.isArray(c?.list) && c.list.length ? c.list : DEFAULT_REWARDS;
  } catch { return DEFAULT_REWARDS; }
}

// Ask the server (signed in only); keeps the last answer. → the list, or null when nothing changed
export async function refreshRewards() {
  try {
    if (!cloudOn() || !(await currentUser())) return null;
    const list = await rpc('odyssey_rewards', {});
    if (!Array.isArray(list)) return null;
    const { [KEY]: c } = await chrome.storage.local.get(KEY);
    if (JSON.stringify(c?.list || []) === JSON.stringify(list)) return null;
    await chrome.storage.local.set({ [KEY]: { list, at: Date.now() } });
    return list.length ? list : DEFAULT_REWARDS;
  } catch { return null; } // not set up yet, or offline: keep what we have
}
