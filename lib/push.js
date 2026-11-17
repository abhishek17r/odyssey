// Push notifications on this phone (the installed web app): turn on, test, turn off.
// The server side is the odyssey-push Edge Function; it reads the times from your synced settings.

import { CLOUD } from '../config.js';
import { rpc, callFunction, currentUser } from './cloud.js';
import { load, save } from './storage.js';

const keyBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// → 'unsupported' | 'install' (iPhone: add to Home Screen first) | 'signin' | 'denied' | 'off' | 'on'
export async function pushState() {
  if (!globalThis.ODYSSEY_WEB) return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return /iPhone|iPad/.test(navigator.userAgent) && !standalone() ? 'install' : 'unsupported';
  if (!CLOUD.pushKey) return 'unsupported';
  if (!(await currentUser())) return 'signin';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

async function setPushSettings(on) {
  const st = await load();
  st.settings.pushOn = on;
  if (on) st.settings.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await save({ settings: st.settings });
}

export async function enablePush() {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them in iPhone Settings → Notifications → Odyssey.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CLOUD.pushKey) }));
  await rpc('odyssey_push_subscribe', { sub: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  await setPushSettings(true);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await rpc('odyssey_push_unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  await setPushSettings(false);
}

export const testPush = () => callFunction('odyssey-push', { test: true });
