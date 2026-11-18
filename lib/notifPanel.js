// Me → Notifications: push on this phone, and a switch + time for each reminder.
// Settings save as you change them (and sync, so the server and the extension follow).

import { load, save } from './storage.js';
import { DEFAULT_SETTINGS } from './score.js';
import { el, toast, toggle } from './controls.js';
import { pushState, enablePush, disablePush, testPush } from './push.js';

const ROWS = [
  ['sessionEndOn', null, '⏰', 'Session end', 'When a focus session reaches its length'],
  ['morningOn', 'morningTime', '☀️', 'Morning brief', 'Due and overdue tasks'],
  ['middayOn', 'middayTime', '🌤️', 'Midday nudge', 'Habits left, tasks due, focus so far'],
  ['checkinOn', 'reminderTime', '✨', 'Evening check-in', 'Only if habits are still to log'],
  ['planOn', 'planTime', '🗓️', 'Friday planning', 'Review, then plan next week'],
  ['cuesOn', null, '🔁', 'Habit cues', 'At each habit’s cue time (set it in Week → Plan)'],
];

async function setSetting(patch) {
  const st = await load();
  st.settings = { ...st.settings, ...patch };
  await save({ settings: st.settings });
}

export async function renderNotifPanel(box) {
  box.innerHTML = '';
  const st = await load();
  const s = { ...DEFAULT_SETTINGS, ...st.settings };

  // push on this phone (web app only)
  const p = await pushState();
  if (p !== 'unsupported') {
    const status = el('div', { className: 'pushStatus' });
    const say = {
      install: 'To get notifications with the app closed: add Odyssey to your Home Screen (Share → Add to Home Screen) and open it from there.',
      signin: 'Sign in first (Account, below), then turn on push.',
      denied: 'Notifications are blocked for Odyssey. Allow them in iPhone Settings → Notifications → Odyssey.',
      off: 'Get these on this phone, even with the app closed.',
      on: 'On for this phone.',
    }[p];
    status.append(el('div', { className: 'small muted', textContent: say }));
    const row = el('div', { className: 'row', style: 'gap:8px;margin-top:8px;flex-wrap:wrap' });
    if (p === 'off') {
      const b = el('button', { type: 'button', className: 'primary', textContent: '🔔 Turn on push' });
      b.onclick = async () => { b.disabled = true; try { await enablePush(); toast('Push is on'); } catch (e) { toast(e.message, 'err'); } renderNotifPanel(box); };
      row.append(b);
    }
    if (p === 'on') {
      const t = el('button', { type: 'button', textContent: 'Send a test' });
      t.onclick = async () => { t.disabled = true; try { const r = await testPush(); toast(r?.sent ? 'Sent: check your notifications' : (r?.note || 'Nothing sent'), r?.sent ? 'ok' : 'err'); } catch (e) { toast(`Test failed: ${e.message}`, 'err'); } t.disabled = false; };
      const off = el('button', { type: 'button', className: 'ghost', textContent: 'Turn off' });
      off.onclick = async () => { await disablePush(); toast('Push is off'); renderNotifPanel(box); };
      row.append(t, off);
    }
    status.append(row);
    box.append(status);
  } else if (globalThis.chrome?.runtime?.id && !globalThis.ODYSSEY_WEB) {
    box.append(el('div', { className: 'small muted', style: 'margin-bottom:8px', textContent: s.pushOn ? 'Your phone has push on, so it gets these reminders; this computer keeps the session ones.' : 'Shown on this computer while Chrome is running. Turn on push in the phone app to get them on your phone instead.' }));
  }

  // one row per reminder
  const list = el('div', { className: 'notifList' });
  for (const [onKey, timeKey, icon, title, sub] of ROWS) {
    const r = el('div', { className: `notifRow ${s[onKey] === false ? 'off' : ''}` });
    const time = timeKey ? el('input', { type: 'time', value: s[timeKey] || DEFAULT_SETTINGS[timeKey] || '' }) : null;
    if (time) time.onchange = () => time.value && setSetting({ [timeKey]: time.value });
    const sw = toggle({ checked: s[onKey] !== false, label: title, onChange: (v) => { r.classList.toggle('off', !v); setSetting({ [onKey]: v }); } });
    r.append(el('div', { className: 'nIc', textContent: icon }), el('div', { className: 'nMain' }, el('b', { textContent: title }), el('div', { className: 'small muted', textContent: sub })), ...(time ? [time] : []), sw);
    list.append(r);
  }
  box.append(list);
}
