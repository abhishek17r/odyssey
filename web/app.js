// Web-app glue: service worker, background-ish duties while open (sync, session alarms), sign-in sheet,
// notification permission, keep the screen awake during a focus session.

import { syncNow, syncSoon, triggersSync } from './lib/syncRunner.js';
import { cloudOn, currentUser } from './lib/cloud.js';
import { renderAccount } from './lib/account.js';
import { el, openDrawer } from './lib/controls.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---- sync: on open, when you come back, every 30 s while open, and soon after any edit ----
// the splash waits for this first sync (or 4 s, whichever is later)
syncNow().catch(() => {}).finally(() => { window.odysseyReady = true; dispatchEvent(new Event('odyssey:ready')); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
chrome.storage.onChanged.addListener((changes) => { if (triggersSync(Object.keys(changes))) syncSoon(1500); });

// ---- the alarms a focus session sets ----
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  const { activeSession: s } = await chrome.storage.local.get('activeSession');
  if (name === 'sessionEnd' && s?.phase === 'work') {
    chrome.notifications.create('session', { title: `⏰ ${s.minutes} min done`, message: `“${s.task}”: end the session, or keep going.` });
    navigator.vibrate?.([200, 100, 200]);
  }
  if (name === 'twoMin' && s?.phase === 'work') chrome.notifications.create('session', { title: '✅ Two minutes in. You started.', message: 'That was the hard part.' });
});
// a session started elsewhere (or before a reload): put its end alarm back
async function rearm() {
  const { activeSession: a } = await chrome.storage.local.get('activeSession');
  chrome.alarms.clear('sessionEnd');
  if (a?.phase === 'work') {
    const worked = (a.workMs || 0) + (Date.now() - a.phaseStart);
    const left = a.minutes * 60000 - worked;
    if (left > 0) chrome.alarms.create('sessionEnd', { when: Date.now() + left });
  }
  keepAwake(!!a && a.phase === 'work');
}
rearm();
chrome.storage.onChanged.addListener((c) => { if (c.activeSession) rearm(); });

// ---- keep the screen on while you work (where supported) ----
let lock = null;
async function keepAwake(on) {
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') { lock = await navigator.wakeLock.request('screen'); lock.onrelease = () => { lock = null; }; }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rearm(); });

// ---- account sheet (cloud button in the header) ----
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function accountSheet() {
  const box = el('div');
  const notif = el('div', { className: 'field', style: 'margin-top:18px' });
  const drawNotif = () => {
    notif.innerHTML = '<div class="lbl">Notifications</div>';
    if (!('Notification' in window)) {
      notif.append(el('p', { className: 'small muted', textContent: isStandalone ? 'This browser can’t show notifications.' : 'On iPhone, first add Odyssey to your Home Screen (Share → Add to Home Screen), then open it from there.' }));
    } else if (Notification.permission === 'granted') {
      notif.append(el('p', { className: 'small ok', textContent: '✓ On: session end and the two-minute nudge while the app is open.' }));
    } else {
      const b = el('button', { type: 'button', className: 'primary', textContent: '🔔 Turn on notifications' });
      b.onclick = async () => { await Notification.requestPermission(); drawNotif(); };
      notif.append(b);
    }
  };
  drawNotif();
  const wrap = el('div', {}, box, notif);
  openDrawer('Sign in', wrap);
  renderAccount(box, { onSignedIn: () => location.reload() });
}

async function setupAccountUi() {
  const me = document.querySelector('#meNotif');
  if (me) {
    // the app: Me → Notifications is drawn by popup.js (lib/notifPanel.js)
  } else {
    // dashboard pages: a cloud button in the header
    const top = document.querySelector('header');
    if (top) {
      const user = cloudOn() ? await currentUser() : null;
      const b = el('button', { type: 'button', className: 'cloudBtn', title: 'Account', textContent: user ? '☁️' : '☁️ Sign in' });
      b.onclick = accountSheet;
      top.append(b);
      chrome.storage.onChanged.addListener(async (c) => { if (c.auth) b.textContent = (await currentUser()) ? '☁️' : '☁️ Sign in'; });
    }
  }
  // first visit with the cloud set up: ask to sign in
  if (cloudOn() && !(await currentUser()) && !sessionStorage.getItem('askedSignIn')) { sessionStorage.setItem('askedSignIn', '1'); setTimeout(accountSheet, 400); }
}
setupAccountUi();

// dashboard pages: a way home
if (!document.querySelector('#view-today')) {
  const nav = document.querySelector('header nav');
  if (nav) nav.prepend(Object.assign(document.createElement('a'), { href: './', textContent: '‹ Home' }));
}
