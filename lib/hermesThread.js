// Hermes' one thread: everything Hermes sends, in order, so you can answer or reply to any of it: the week's
// ideas, a moment, a trial's evening question, "Did it help?", and the chat. Plus the unread count that sits
// on the Hermes button and on the app icon. Pure: shared by the app, the push function and the tests.

import { dateKey, addDays, parseKey, weekKeyOf } from './score.js';
import { ideasId, momentId, answersId, history, isValid, NO_FOLLOW_UP, TRIAL_DAYS } from './hermes.js';
import { chatMsgs } from './hermesChat.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const at = (day, h) => { const d = parseKey(day); d.setHours(h, 0, 0, 0); return d.getTime(); };

// An idea's state in the thread: 'open' | 'accepted' | 'undone' | 'notnow' | 'gone' (no longer applies)
export function ideaState(state, i, day) {
  const ans = state.notes?.[answersId(i.wk || weekKeyOf(i.id.slice(0, 10)))] || {};
  const n = Object.values(state.notes || {}).find((x) => x && String(x.id || '').startsWith('hermes-') && (x.trials?.[i.id] || x.decisions?.[i.id]));
  const d = ans.decisions?.[i.id] || n?.decisions?.[i.id];
  const tr = ans.trials?.[i.id] || n?.trials?.[i.id];
  if (tr && ['stopped', 'dropped'].includes(tr.outcome)) return 'undone';
  if (d === 'accepted' || tr) return 'accepted';
  if (d === 'notnow') return 'notnow';
  return isValid(state, i, day) ? 'open' : 'gone';
}

// → [{ id, at, kind: 'ideas'|'moment'|'followup'|'checkin'|'you'|'hermes', text, ideas?, h?, msg? }] oldest first
export function threadItems(state, day, now = Date.now()) {
  const out = [];
  const weeks = [weekKeyOf(shift(day, -7)), weekKeyOf(day)];
  for (const wk of weeks) {
    const n = state.notes?.[ideasId(wk)];
    if (n?.ideas?.length) out.push({ id: `w-${wk}`, at: n.at || at(wk, 6), kind: 'ideas', wk, text: `${n.ideas.length === 1 ? 'An idea' : `${n.ideas.length} ideas`} for this week, from your last week and your notes.`, ideas: n.ideas.map((i) => ({ ...i, wk })) });
  }
  for (let k = 7; k >= 0; k--) {
    const d = shift(day, -k);
    const n = state.notes?.[momentId(d)];
    if (n?.ideas?.length) out.push({ id: `m-${d}`, at: n.at || at(d, 10), kind: 'moment', text: n.moment?.what || 'Something came up today.', ideas: n.ideas.map((i) => ({ ...i, wk: weekKeyOf(d) })) });
  }
  for (const h of history(state, day)) {
    if (!h.start || NO_FOLLOW_UP.includes(h.idea.kind)) continue;
    if (day > h.end) out.push({ id: `f-${h.ideaId}`, at: at(shift(h.end, 1), 8), kind: 'followup', h, text: `Your trial “${h.idea.title}” ended. Did it help? Before and during, from your logs.` });
    else if (h.idea.kind === 'try' && !h.outcome && new Date(now).getHours() >= 18) {
      const n = Math.round((parseKey(day) - parseKey(h.start)) / 864e5) + 1;
      out.push({ id: `c-${h.ideaId}-${day}`, at: at(day, 18), kind: 'checkin', h, text: `Day ${n} of ${TRIAL_DAYS}: ${h.idea.check}` });
    }
  }
  for (const m of chatMsgs(state)) out.push({ id: m.id, at: m.at, kind: m.from === 'you' ? 'you' : 'hermes', text: m.text, ideas: m.ideas, msg: m });
  return out.filter((x) => x.at <= now + 60000).sort((a, b) => a.at - b.at);
}

// Waiting on you: an idea or moment still open, a "Did it help?" not answered, a Hermes reply not read.
// Not counted: the evening question, reminders, Athena's notes. Cleared by opening the thread.
export function unreadCount(state, day, now = Date.now()) {
  const seen = Number(state.settings?.hermesSeen) || 0;
  if (state.settings?.hermesOn === false || state.settings?.athenaOn === false) return 0;
  let n = 0;
  for (const x of threadItems(state, day, now)) {
    if (x.at <= seen) continue;
    if ((x.kind === 'ideas' || x.kind === 'moment') && x.ideas.some((i) => ideaState(state, i, day) === 'open')) n++;
    else if (x.kind === 'followup' && !x.h.outcome) n++;
    else if (x.kind === 'hermes') n++;
  }
  return n;
}
