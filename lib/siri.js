// Siri in the app: Me → Siri (a personal key, and the one Shortcut that sends what you say), and applying what
// you said when the app opens. The server side is supabase/functions/odyssey-say and supabase/siri.sql.

import { CLOUD } from '../config.js';
import { cloudOn, currentUser, rpc } from './cloud.js';
import { parseSay, replyFor } from './say.js';
import { load, updateDay, addTicket } from './storage.js';
import { planOf, metricKey, dateKey } from './score.js';
import { whenPatch } from './when.js';
import { el, openDrawer, toast } from './controls.js';
import { track } from './usage.js';

export const sayUrl = (key) => `${CLOUD.url}/functions/v1/odyssey-say?k=${encodeURIComponent(key)}&t=`;

// Apply what was said to Siri since the app last opened. → [{ p, reply }] (also wants: 'focus' to start one)
export async function applyInbox() {
  if (!cloudOn() || !(await currentUser())) return [];
  let items;
  try { items = await rpc('odyssey_inbox_take', {}); } catch { return []; } // not set up yet
  const out = [];
  for (const it of items || []) {
    const day = dateKey(new Date(it.at));
    const st = await load();
    const p = parseSay(it.text, st, day);
    try {
      if (p.kind === 'habit' || p.kind === 'count') {
        const g = planOf(day, st)?.goals.find((x) => x.id === p.goalId);
        const m = g?.metrics?.[0];
        if (!g || !m) continue;
        const key = metricKey(g, m);
        await updateDay(day, (d) => {
          if (p.kind === 'habit') d.values[key] = p.done;
          else {
            d.values[key] = Math.round(((Number(d.values[key]) || 0) + p.n) * 100) / 100;
            if (m.kind === 'perDayMax') d.log = { ...(d.log || {}), [g.id]: [...(d.log?.[g.id] || []), { at: Date.parse(it.at), n: p.n }] };
          }
        });
      } else if (p.kind === 'task' && p.task?.title) {
        const w = whenPatch(p.task.due ? (p.task.due === day ? 'today' : p.task.due) : 'today', day);
        await addTicket({ title: p.task.title, due: w.due, sizeH: p.task.sizeH ?? null, sprint: w.sprint, planned: true });
      }
      out.push({ p, reply: replyFor(p, st, day) });
      track('siri', { k: p.kind });
    } catch { /* skip the one that failed */ }
  }
  return out;
}

// Me → Siri
export async function renderSiri(box) {
  box.innerHTML = '';
  const user = cloudOn() ? await currentUser().catch(() => null) : null;
  box.append(el('p', { className: 'small muted', style: 'margin:0 0 10px', textContent: 'Say “Hey Siri, Odyssey”, then what you want: “log gym”, “add call the bank tomorrow”, “one cigarette”, “how’s my day?”.' }));
  if (!user) { box.append(el('p', { className: 'small muted', textContent: 'Sign in first (Account, below): Siri sends your words to your account.' })); return; }
  let has = false;
  try { has = await rpc('odyssey_say_key_set', {}); } catch { box.append(el('p', { className: 'small muted', textContent: 'Siri isn’t switched on for this Odyssey yet (supabase/siri.sql).' })); return; }
  const b = el('button', { type: 'button', className: has ? 'soft' : 'primary', textContent: has ? 'Set up Siri again' : 'Set up Siri' });
  b.style.width = '100%';
  b.onclick = () => setupSheet(has);
  if (has) box.append(el('p', { className: 'small ok', style: 'margin:0 0 8px', textContent: '✓ Siri is set up on a phone. Setting it up again makes a new key; the old Shortcut stops working.' }));
  box.append(b);
}

async function setupSheet(had) {
  if (had && !confirm('A new key replaces the old one, so the Shortcut already on your phone stops working until you update it. Go on?')) return;
  let key;
  try { key = await rpc('odyssey_say_key_new', {}); } catch (e) { toast(e.message, 'err'); return; }
  track('siri_setup');
  const link = sayUrl(key);
  const copy = (text, label) => { const c = el('button', { type: 'button', className: 'soft small', textContent: label }); c.onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { prompt('Copy this', text); } }; return c; };
  const body = el('div', { className: 'siriSheet' });
  if (CLOUD.siriShortcut) {
    const add = el('a', { className: 'primary siriAdd', href: CLOUD.siriShortcut, target: '_blank', rel: 'noopener', textContent: 'Add to Siri' });
    body.append(el('p', { textContent: 'Tap Add to Siri. When Shortcuts asks for your Siri key, paste it.' }), el('div', { className: 'siriKey' }, el('code', { textContent: key }), copy(key, 'Copy key')), add);
  } else {
    body.append(el('p', { textContent: 'Make the Odyssey Shortcut once (about a minute):' }),
      el('ol', { className: 'siriSteps' },
        ...['Open Shortcuts, tap +, and name it “Odyssey”.', 'Add “Dictate Text”.', 'Add “URL Encode” (it encodes the Dictated Text).',
          'Add “Get Contents of URL”. Paste your link (copy it below), then tap at its end and add the “URL Encoded Text”.', 'Add “Speak Text” with the “Contents of URL”. Done: say “Hey Siri, Odyssey”.'].map((s) => el('li', { textContent: s }))),
      el('div', { className: 'siriKey' }, el('code', { textContent: link.replace(/k=[^&]+/, 'k=…') }), copy(link, 'Copy your link')),
      el('p', { className: 'small muted', textContent: 'The link has your personal key in it: keep it to yourself. Siri turns your voice into text on the iPhone; Odyssey only gets the text.' }));
  }
  openDrawer('Set up Siri', body);
}
