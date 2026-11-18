// Usage events: which features get used, so the owner can see what matters before launch (admin.html).
// Only the feature's name and a few small facts (a source, a number of minutes); never titles, notes or
// anything you typed. Kept on the phone in a short queue and sent with your account when you're signed in;
// signed out, nothing leaves the phone and the queue just stays short.

const KEY = 'usageQueue';
const MAX = 300;
let timer = null;
let sender = null; // (events) => Promise, set by the app once it can reach the server

const store = () => (typeof chrome !== 'undefined' ? chrome.storage?.local : null);

export async function track(name, props = null) {
  const s = store();
  if (!s) return;
  try {
    const q = (await s.get(KEY))[KEY] || [];
    q.push(props ? { n: name, t: Date.now(), p: props } : { n: name, t: Date.now() });
    await s.set({ [KEY]: q.slice(-MAX) });
  } catch { /* never in the way */ }
  clearTimeout(timer);
  timer = setTimeout(flushUsage, 20000);
}

// once per day the app is opened
export async function trackOpen(dayKey) {
  const s = store();
  if (!s) return;
  const seen = (await s.get('usageOpened')).usageOpened;
  if (seen === dayKey) return;
  await s.set({ usageOpened: dayKey });
  track('app_open');
}

export function setUsageSender(fn) { sender = fn; }

let flushing = false;
export async function flushUsage() {
  const s = store();
  if (!s || !sender || flushing) return;
  flushing = true;
  try {
    const q = (await s.get(KEY))[KEY] || [];
    if (!q.length) return;
    await sender(q);
    // drop only what was sent (more may have arrived meanwhile)
    const now = (await s.get(KEY))[KEY] || [];
    await s.set({ [KEY]: now.slice(q.length) });
  } catch { /* signed out or offline: try again later */ } finally { flushing = false; }
}
