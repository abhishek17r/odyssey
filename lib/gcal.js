// "Add to Google Calendar": a link to Google's own pre-filled new-event page. Nothing is sent until you
// press Save there, and no sign-in or API key is needed.

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const dayStamp = (k) => k.replaceAll('-', '');
const nextDay = (k) => { const d = new Date(`${k}T12:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };

/**
 * { title, details, day (all-day, 'YYYY-MM-DD') | start (Date) + minutes, recur: 'DAILY' | 'WEEKLY;BYDAY=MO,WE' }
 */
export function gcalUrl({ title, details = '', day = null, start = null, minutes = 30, recur = null }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title });
  if (day) p.set('dates', `${dayStamp(day)}/${nextDay(day)}`);
  else if (start) p.set('dates', `${stamp(start)}/${stamp(new Date(start.getTime() + minutes * 60000))}`);
  if (details) p.set('details', details);
  if (recur) p.set('recur', `RRULE:FREQ=${recur}`);
  try { p.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* the calendar's own zone then */ }
  return `https://calendar.google.com/calendar/render?${p}`;
}

// A sensible next start for a focus block: the next whole hour, or 9:00 tomorrow if it's late.
export function nextSlot(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  if (d.getHours() >= 21 || d.getHours() < 7) { if (d.getHours() >= 21) d.setDate(d.getDate() + 1); d.setHours(9); }
  return d;
}

export const openUrl = (url) => (globalThis.chrome?.tabs?.create ? chrome.tabs.create({ url }) : window.open(url, '_blank'));
