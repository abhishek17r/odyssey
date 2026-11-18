// Quick add: a task in plain words. "Call the bank tomorrow 30m" → title, deadline, estimate.
// Understood at the end of the text: today / tonight / tomorrow / a weekday (mon … sunday, the next one) /
// "next week"; and a size: 2h, 1.5h, 90m, 30 min.

import { dateKey, addDays, parseKey, weekDays, weekKeyOf } from './score.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function parseQuickAdd(text, todayKey) {
  let t = String(text || '').trim();
  let due = null;
  let sizeH = null;
  for (let i = 0; i < 3; i++) {
    const before = t;
    // size
    t = t.replace(/\s+(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)$/i, (m, n, u) => {
      const v = Number(n.replace(',', '.'));
      sizeH = /^h/i.test(u) ? v : Math.round((v / 60) * 100) / 100;
      return '';
    });
    // when
    t = t.replace(/\s+(today|tonight|tomorrow|tmrw|next week|(?:by |on )?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)$/i, (m, w) => {
      const word = w.toLowerCase().replace(/^(by|on) /, '');
      if (word === 'today' || word === 'tonight') due = todayKey;
      else if (word === 'tomorrow' || word === 'tmrw') due = dateKey(addDays(parseKey(todayKey), 1));
      else if (word === 'next week') due = weekDays(dateKey(addDays(parseKey(weekKeyOf(todayKey)), 7)))[6];
      else {
        const d = DAYS.indexOf(word.slice(0, 3));
        if (d < 0) return m;
        let n = (d - parseKey(todayKey).getDay() + 7) % 7;
        if (n === 0) n = 7; // "friday" on a Friday means next Friday
        due = dateKey(addDays(parseKey(todayKey), n));
      }
      return '';
    });
    if (t === before) break;
  }
  t = t.trim();
  return { title: t || String(text || '').trim(), due, sizeH: sizeH > 0 ? sizeH : null };
}
